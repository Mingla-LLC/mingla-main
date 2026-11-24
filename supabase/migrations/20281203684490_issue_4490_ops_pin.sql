-- Issue #4490, spec 08 O5 part A (file number 611490; the spec's slot 52 /
-- 524490 would sort before the Till migrations it depends on): staff PINs on a
-- shared Till device, PIN sessions, step-up and the audit trail.
--
-- What this adds (spec 08 §3 O5 "Till device login" + "Migration 52", §11.4
-- item 1 / §12 items 5 and 8):
-- - brand_member_pins: one bcrypt hash per brand membership
--   (extensions.crypt + gen_salt('bf', 10)), the lockout counters. Service role
--   only: RLS on, no grants to anon or authenticated, no policies.
-- - venue_staff_switch_sessions: a PIN session on ONE Till device login at ONE
--   venue. Only the sha256 of the 32-byte token is stored; it expires within
--   12 hours, locks after the venue's auto_lock_minutes without a call, and is
--   bound to the device account's auth session (signing the device out ends
--   it everywhere). Service role only.
-- - venue_pin_attempts: every PIN try on a device (the per-device limit, 20 in
--   10 minutes, and the 24-hour count behind the hard lock). Service role only.
-- - venue_pin_approvals: a fresh PIN entry at the moment of a refund, a void of
--   a sent item, a day reopen or an export (step-up), by the person selling or
--   by a manager on the spot (§11.4 item 1); also a manager approving a Till
--   device sign-out. Service role only.
-- - RPCs (all INTERNAL: SECURITY DEFINER, search_path '', service role only):
--   pin_gate, pin_is_weak, pin_set, pin_reset, pin_status, pin_team, pin_staff,
--   pin_check (shared by unlock and step-up), pin_unlock, pin_session_resolve,
--   pin_session_end, pin_sessions_end_all, pin_approve, pin_actor_assert,
--   floor_audit, till_void_on_device; trigger functions pin_money_row_guard,
--   floor_audit_paid, floor_audit_refund, floor_audit_void.
--
-- The server gate. A signed-in account that is a Till device at venue V (the
-- venue.till_device capability, with the Till released at V) has every Till
-- sale, payment, refund, void and close action refused unless the request
-- carries a live PIN session; the edge then acts as the PIN member (their own
-- rights at V, never more) and records the device user. Two database
-- backstops make that true even for a request already in flight:
-- - BEFORE INSERT on venue_till_payments and venue_till_refunds: a Till device
--   is never the actor of a money row, and a row whose device_user_id differs
--   from its actor needs a live session on that device at that venue for that
--   actor (or a fresh approval by that actor on it), read FOR SHARE in the same
--   transaction. A session ended before the row commits refuses it; one ended
--   after waits for it (the payment happened before the end).
-- - issue_4490_till_void_on_device asserts the same in the void's transaction
--   and refuses a sent item without step-up.
-- Nothing changes for an account that is not a Till device: its rows carry
-- device_user_id = actor (as every row before this migration does) and the
-- guard does nothing for them. Before this migration no account is gated
-- (the edge treats a missing pin_gate as "not gated").
--
-- T19 (money already taken never needs a PIN): apply_payment, tap_record,
-- confirm_return and the webhooks only UPDATE payment rows; the guard is on
-- INSERT only, so no recording path ever checks a PIN.
--
-- Audit (audit_log; user_id = the member, after.device_user_id = the device):
-- till.pay (a Till payment becomes paid), till.refund, till.void (a Till line
-- or a Till round's item voided), pin.set, pin.reset, pin.locked. till.close,
-- till.reopen and stock.set are written by parts B and C through
-- issue_4490_floor_audit. Never a PIN, a hash or a token in any row.
--
-- [TRANSITIONAL] #4579: brand_team_members.granted_via does not exist on this
-- branch yet. A row marked granted_via = 'mingla_admin' (an auto-added Mingla
-- admin) is not venue staff on "Who's selling?" and cannot switch in with a
-- PIN; the filter reads the column through to_jsonb(row) so it is a no-op until
-- #4579's column lands and correct from then on. Exit: #4579 on main; then
-- read the column directly.

BEGIN;

-- ===========================================================================
-- 1. Tables (service role only).
-- ===========================================================================
CREATE TABLE public.brand_member_pins (
  member_id uuid PRIMARY KEY REFERENCES public.brand_team_members(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  pin_hash text NOT NULL CHECK (pin_hash LIKE '$2%'),
  failed_count smallint NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 5),
  failed_window_started_at timestamptz NULL,
  locked_until timestamptz NULL,
  hard_locked boolean NOT NULL DEFAULT false,
  set_at timestamptz NOT NULL DEFAULT now(),
  reset_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.brand_member_pins IS
  '#4490 spec 08 O5: a member''s Till PIN (bcrypt hash only) and its lockout. Service role only; never readable by clients.';

CREATE TABLE public.venue_staff_switch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  device_user_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES public.brand_team_members(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  auth_session_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  ended_reason text NULL CHECK (ended_reason IS NULL OR ended_reason IN (
    'ended', 'switched', 'auto_lock', 'device_signed_out', 'pin_reset')),
  CONSTRAINT venue_staff_switch_sessions_expiry CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '12 hours'),
  CONSTRAINT venue_staff_switch_sessions_end_shape CHECK ((ended_at IS NULL) = (ended_reason IS NULL)),
  CONSTRAINT venue_staff_switch_sessions_not_self CHECK (device_user_id <> member_user_id)
);
CREATE UNIQUE INDEX venue_staff_switch_sessions_one_live
  ON public.venue_staff_switch_sessions (device_user_id, venue_id) WHERE ended_at IS NULL;
CREATE INDEX venue_staff_switch_sessions_member
  ON public.venue_staff_switch_sessions (member_user_id) WHERE ended_at IS NULL;
COMMENT ON TABLE public.venue_staff_switch_sessions IS
  '#4490 spec 08 O5: a PIN session on a Till device login. Only the sha256 of the token is stored. Service role only.';

CREATE TABLE public.venue_pin_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_user_id uuid NOT NULL,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  member_id uuid NULL REFERENCES public.brand_team_members(id) ON DELETE SET NULL,
  -- true = right PIN, false = wrong PIN, NULL = not checked (locked, limited).
  ok boolean NULL,
  purpose text NOT NULL CHECK (purpose IN ('unlock', 'refund', 'void_sent', 'reopen', 'export', 'sign_out')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_pin_attempts_device_at ON public.venue_pin_attempts (device_user_id, at);
CREATE INDEX venue_pin_attempts_member_at ON public.venue_pin_attempts (member_id, at) WHERE ok = false;
COMMENT ON TABLE public.venue_pin_attempts IS
  '#4490 spec 08 O5: every PIN try on a Till device (per-device limit, 24-hour hard lock). No PIN is stored. Service role only.';

CREATE TABLE public.venue_pin_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NULL REFERENCES public.venue_staff_switch_sessions(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  device_user_id uuid NOT NULL,
  seller_user_id uuid NULL,
  approver_member_id uuid NOT NULL REFERENCES public.brand_team_members(id) ON DELETE CASCADE,
  approver_user_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('refund', 'void_sent', 'reopen', 'export', 'sign_out')),
  target text NULL CHECK (target IS NULL OR char_length(target) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_pin_approvals_session_shape CHECK ((session_id IS NULL) = (purpose = 'sign_out'))
);
CREATE INDEX venue_pin_approvals_session ON public.venue_pin_approvals (session_id, approver_user_id, created_at);
COMMENT ON TABLE public.venue_pin_approvals IS
  '#4490 spec 08 O5 / §11.4 item 1: a fresh PIN entry (step-up) by the seller or a manager on the spot. Service role only.';

ALTER TABLE public.brand_member_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_staff_switch_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_pin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_pin_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_member_pins, public.venue_staff_switch_sessions,
  public.venue_pin_attempts, public.venue_pin_approvals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_member_pins, public.venue_staff_switch_sessions,
  public.venue_pin_attempts, public.venue_pin_approvals TO service_role;

-- ===========================================================================
-- 2. Small helpers.
-- ===========================================================================

-- Is this account a gated Till device at this venue (the Till released there)?
CREATE OR REPLACE FUNCTION public.issue_4490_pin_gate(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND public.issue_4490_is_till_device(p_venue_id, p_user_id)
    AND public.issue_4490_till_enabled(p_venue_id);
$function$;

-- 4 to 6 digits; not one digit repeated (0000) and not a straight run up or
-- down (1234, 4321, 012345, 987654).
CREATE OR REPLACE FUNCTION public.issue_4490_pin_is_weak(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_up boolean := true;
  v_down boolean := true;
  v_same boolean := true;
  i int;
  d int;
  prev int;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN true;
  END IF;
  prev := substr(p_pin, 1, 1)::int;
  FOR i IN 2..char_length(p_pin) LOOP
    d := substr(p_pin, i, 1)::int;
    IF d <> prev + 1 THEN v_up := false; END IF;
    IF d <> prev - 1 THEN v_down := false; END IF;
    IF d <> prev THEN v_same := false; END IF;
    prev := d;
  END LOOP;
  RETURN v_up OR v_down OR v_same;
END;
$function$;

-- The brand membership is an auto-added Mingla admin (#4579). [TRANSITIONAL]
-- read through to_jsonb so it is false until #4579's column exists.
CREATE OR REPLACE FUNCTION public.issue_4490_pin_member_is_mingla_admin(p_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT to_jsonb(m) ->> 'granted_via' = 'mingla_admin'
    FROM public.brand_team_members m WHERE m.id = p_member_id), false);
$function$;

-- Who may reset a member's PIN (spec 08 §4 item 5): brand_admin+ or
-- venue.manage_money at a venue the member is granted. Account sign-in only
-- (the edge refuses a Till device or a request carrying a PIN session).
CREATE OR REPLACE FUNCTION public.issue_4490_pin_can_reset(p_actor uuid, p_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.id = p_member_id
      AND (
        public.biz_brand_effective_rank(m.brand_id, p_actor) >= public.biz_role_rank('brand_admin')
        OR EXISTS (
          SELECT 1 FROM public.brand_team_member_venue_grants g
          WHERE g.member_id = m.id
            AND public.issue_4490_user_has_venue_capability(g.venue_id, p_actor, 'venue.manage_money')
        )
      )
  );
$function$;

-- A "manager" at a venue for a Till device sign-out: brand_admin+ or
-- venue.manage_money at that venue.
CREATE OR REPLACE FUNCTION public.issue_4490_pin_can_manage_venue(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_listings v
    WHERE v.id = p_venue_id
      AND (
        public.biz_brand_effective_rank(v.brand_id, p_user_id) >= public.biz_role_rank('brand_admin')
        OR public.issue_4490_user_has_venue_capability(v.id, p_user_id, 'venue.manage_money')
      )
  );
$function$;

-- A member who may enter a PIN at this venue: accepted, not removed, not a
-- Till device and not an auto-added Mingla admin; to switch in ('unlock') they
-- must be able to sell there; to approve (step-up, sign-out) they must be able
-- to sell, handle money or manage the venue (a finance manager may refund but
-- not sell: spec 08 §4 item 5). The approval's own rights are checked by
-- issue_4490_pin_approve.
CREATE OR REPLACE FUNCTION public.issue_4490_pin_member_eligible(p_venue_id uuid, p_member_id uuid, p_purpose text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_team_members m
    JOIN public.venue_listings v ON v.id = p_venue_id AND v.brand_id = m.brand_id
    WHERE m.id = p_member_id
      AND m.accepted_at IS NOT NULL
      AND m.removed_at IS NULL
      AND NOT public.issue_4490_is_till_device(p_venue_id, m.user_id)
      AND NOT public.issue_4490_pin_member_is_mingla_admin(m.id)
      AND (
        public.issue_4490_can_sell(p_venue_id, m.user_id)
        OR (p_purpose <> 'unlock' AND (
          public.issue_4490_can_manage_money(p_venue_id, m.user_id)
          OR public.issue_4490_pin_can_manage_venue(p_venue_id, m.user_id)))
      )
  );
$function$;

-- The device user for the current transaction (set by the device wrappers).
CREATE OR REPLACE FUNCTION public.issue_4490_pin_current_device(p_fallback uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v text := NULLIF(current_setting('mingla.issue_4490_device_user', true), '');
BEGIN
  IF v IS NOT NULL AND v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v::uuid;
  END IF;
  RETURN p_fallback;
END;
$function$;

-- ===========================================================================
-- 3. The audit helper (parts B and C call it for till.close, till.reopen and
--    stock.set). Never pass a PIN, a hash or a token in p_after.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_floor_audit(
  p_brand_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_action NOT IN ('till.pay', 'till.void', 'till.refund', 'till.close', 'till.reopen',
                      'pin.set', 'pin.reset', 'pin.locked', 'stock.set') THEN
    RAISE EXCEPTION 'floor_audit_action_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
  VALUES (p_actor, p_brand_id, p_action, p_target_type, p_target_id,
    COALESCE(p_after, '{}'::jsonb) - 'pin' - 'token' - 'pin_hash' - 'token_hash'
      || jsonb_build_object('device_user_id', COALESCE(p_device_user, p_actor)));
END;
$function$;

-- ===========================================================================
-- 4. PIN set / reset / status (account sign-in only; the edge refuses a Till
--    device account and any request carrying a PIN session).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_pin_set(p_member uuid, p_user uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
  v_pin public.brand_member_pins%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Own membership only.
  SELECT * INTO v_member FROM public.brand_team_members
  WHERE id = p_member AND user_id = p_user AND accepted_at IS NOT NULL AND removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- A Till device login never has a PIN (a PIN never signs anyone in).
  IF EXISTS (SELECT 1 FROM public.brand_team_member_venue_grants g
             WHERE g.member_id = v_member.id AND 'venue.till_device' = ANY(g.capabilities)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = '22023';
  END IF;
  IF public.issue_4490_pin_is_weak(p_pin) THEN
    RAISE EXCEPTION 'pin_weak' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pin FROM public.brand_member_pins WHERE member_id = v_member.id FOR UPDATE;
  IF FOUND AND v_pin.hard_locked THEN
    -- "Ask a manager to unlock your PIN": a hard lock lifts only by a reset.
    RAISE EXCEPTION 'pin_hard_locked' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.brand_member_pins (member_id, brand_id, pin_hash, set_at, updated_at)
  VALUES (v_member.id, v_member.brand_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), now(), now())
  ON CONFLICT (member_id) DO UPDATE
  SET pin_hash = EXCLUDED.pin_hash, failed_count = 0, failed_window_started_at = NULL,
      locked_until = NULL, hard_locked = false, set_at = now(), reset_by_user_id = NULL, updated_at = now();
  PERFORM public.issue_4490_floor_audit(v_member.brand_id, p_user, p_user, 'pin.set',
    'brand_team_member', v_member.id::text, jsonb_build_object('member_id', v_member.id));
  RETURN jsonb_build_object('ok', true, 'setAt', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pin_reset(p_actor uuid, p_member uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
  v_had boolean;
  v_ended int;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_member FROM public.brand_team_members WHERE id = p_member;
  IF NOT FOUND OR NOT public.issue_4490_pin_can_reset(p_actor, p_member) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Never from a Till device login (a PIN session never resets PINs).
  IF EXISTS (SELECT 1 FROM public.brand_team_members a
             JOIN public.brand_team_member_venue_grants g ON g.member_id = a.id
             WHERE a.user_id = p_actor AND a.brand_id = v_member.brand_id AND a.removed_at IS NULL
               AND 'venue.till_device' = ANY(g.capabilities)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Serialise with an unlock of the same member (its row lock).
  PERFORM 1 FROM public.brand_member_pins WHERE member_id = p_member FOR UPDATE;
  DELETE FROM public.brand_member_pins WHERE member_id = p_member;
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  v_had := v_ended > 0;
  UPDATE public.venue_staff_switch_sessions
  SET ended_at = now(), ended_reason = 'pin_reset'
  WHERE member_id = p_member AND ended_at IS NULL;
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  PERFORM public.issue_4490_floor_audit(v_member.brand_id, p_actor, p_actor, 'pin.reset',
    'brand_team_member', v_member.id::text,
    jsonb_build_object('member_id', v_member.id, 'member_user_id', v_member.user_id,
      'had_pin', v_had, 'sessions_ended', v_ended));
  RETURN jsonb_build_object('ok', true, 'hadPin', v_had);
END;
$function$;

-- The signed-in member's own PIN state for one brand (Team > Till PIN).
CREATE OR REPLACE FUNCTION public.issue_4490_pin_status(p_user uuid, p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
  v_pin public.brand_member_pins%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_member FROM public.brand_team_members
  WHERE brand_id = p_brand_id AND user_id = p_user AND accepted_at IS NOT NULL AND removed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pin FROM public.brand_member_pins WHERE member_id = v_member.id;
  RETURN jsonb_build_object(
    'memberId', v_member.id,
    'tillDevice', EXISTS (SELECT 1 FROM public.brand_team_member_venue_grants g
                          WHERE g.member_id = v_member.id AND 'venue.till_device' = ANY(g.capabilities)),
    'hasPin', v_pin.member_id IS NOT NULL,
    'setAt', v_pin.set_at,
    'hardLocked', COALESCE(v_pin.hard_locked, false),
    'lockedUntil', CASE WHEN v_pin.locked_until > now() THEN v_pin.locked_until END);
END;
$function$;

-- PIN state of the members the actor may reset (Team > member > Till PIN).
CREATE OR REPLACE FUNCTION public.issue_4490_pin_team(p_actor uuid, p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'memberId', m.id, 'userId', m.user_id,
        'hasPin', p.member_id IS NOT NULL, 'setAt', p.set_at,
        'hardLocked', COALESCE(p.hard_locked, false),
        'lockedUntil', CASE WHEN p.locked_until > now() THEN p.locked_until END)
      ORDER BY m.accepted_at, m.id)
    FROM public.brand_team_members m
    LEFT JOIN public.brand_member_pins p ON p.member_id = m.id
    WHERE m.brand_id = p_brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
      AND public.issue_4490_pin_can_reset(p_actor, m.id)), '[]'::jsonb);
END;
$function$;

-- ===========================================================================
-- 5. "Who's selling?" (the device's list; no secrets, no emails).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_pin_staff(p_venue_id uuid, p_device_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_staff jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_pin_gate(p_venue_id, p_device_user) THEN
    RETURN jsonb_build_object('gated', false);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'memberId', m.id,
      'name', COALESCE(
        NULLIF(btrim(ca.display_name), ''),
        NULLIF(btrim(pr.display_name), ''),
        NULLIF(btrim(concat_ws(' ', NULLIF(btrim(pr.first_name), ''), NULLIF(btrim(pr.last_name), ''))), ''),
        'Team member'),
      'role', m.role,
      'profile', (SELECT g.access_profile FROM public.brand_team_member_venue_grants g
                  WHERE g.member_id = m.id AND g.venue_id = p_venue_id LIMIT 1),
      'canSell', public.issue_4490_can_sell(p_venue_id, m.user_id),
      'canApprove', public.issue_4490_can_manage_money(p_venue_id, m.user_id),
      'canManage', public.issue_4490_pin_can_manage_venue(p_venue_id, m.user_id))
    ORDER BY m.accepted_at, m.id), '[]'::jsonb)
  INTO v_staff
  FROM public.brand_team_members m
  JOIN public.brand_member_pins pin ON pin.member_id = m.id
  LEFT JOIN public.creator_accounts ca ON ca.id = m.user_id AND ca.deleted_at IS NULL
  LEFT JOIN public.profiles pr ON pr.id = m.user_id
  WHERE m.brand_id = v_venue.brand_id
    AND m.user_id <> p_device_user
    AND public.issue_4490_pin_member_eligible(p_venue_id, m.id, 'approve');
  RETURN jsonb_build_object(
    'gated', true,
    'venueName', v_venue.name,
    'autoLockMinutes', COALESCE((SELECT s.auto_lock_minutes FROM public.venue_till_settings s
                                 WHERE s.venue_id = p_venue_id), 2),
    'staff', v_staff,
    -- §12 item 5: sign the device out with its own email code when no
    -- manager at the venue has a PIN.
    'managerHasPin', EXISTS (SELECT 1 FROM jsonb_array_elements(v_staff) e
                             WHERE (e->>'canManage')::boolean));
END;
$function$;

-- ===========================================================================
-- 6. The PIN check (shared by unlock and step-up). Returns a result instead of
--    raising so attempt rows and counters always commit. Answers the same
--    for "unknown member", "no PIN set" and "wrong PIN" (one bcrypt at cost
--    10 on every path), except the tries-left count a real member's wrong PIN
--    needs for "Wrong PIN. {n} tries left".
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_pin_check(
  p_venue_id uuid,
  p_device_user uuid,
  p_member uuid,
  p_pin text,
  p_purpose text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- A valid bcrypt salt at cost 10: the "no such PIN" path costs one real hash.
  c_dummy constant text := '$2a$10$AAAAAAAAAAAAAAAAAAAAAA';
  v_member public.brand_team_members%ROWTYPE;
  v_pin public.brand_member_pins%ROWTYPE;
  v_hash text;
  v_match boolean;
  v_device_tries int;
  v_day int;
  v_failed int;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- One PIN try at a time per device: the per-device count cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4490_pin_device:' || p_device_user::text, 0));
  SELECT count(*) INTO v_device_tries FROM public.venue_pin_attempts
  WHERE device_user_id = p_device_user AND at > now() - interval '10 minutes';
  IF v_device_tries >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'device_limited');
  END IF;

  IF p_member IS NOT NULL AND public.issue_4490_pin_member_eligible(p_venue_id, p_member, p_purpose) THEN
    SELECT * INTO v_member FROM public.brand_team_members WHERE id = p_member;
    IF v_member.user_id <> p_device_user THEN
      SELECT * INTO v_pin FROM public.brand_member_pins WHERE member_id = p_member FOR UPDATE;
    END IF;
  END IF;
  v_hash := COALESCE(v_pin.pin_hash, c_dummy);
  v_match := extensions.crypt(COALESCE(p_pin, ''), v_hash) = v_hash
    AND v_pin.member_id IS NOT NULL
    AND COALESCE(p_pin, '') ~ '^[0-9]{4,6}$';

  IF v_pin.member_id IS NULL THEN
    INSERT INTO public.venue_pin_attempts (device_user_id, venue_id, member_id, ok, purpose)
    VALUES (p_device_user, p_venue_id, NULL, false, p_purpose);
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong', 'triesLeft', NULL);
  END IF;
  IF v_pin.hard_locked THEN
    INSERT INTO public.venue_pin_attempts (device_user_id, venue_id, member_id, ok, purpose)
    VALUES (p_device_user, p_venue_id, v_pin.member_id, NULL, p_purpose);
    RETURN jsonb_build_object('ok', false, 'reason', 'hard_locked');
  END IF;
  IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > now() THEN
    INSERT INTO public.venue_pin_attempts (device_user_id, venue_id, member_id, ok, purpose)
    VALUES (p_device_user, p_venue_id, v_pin.member_id, NULL, p_purpose);
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'lockedUntil', v_pin.locked_until);
  END IF;

  INSERT INTO public.venue_pin_attempts (device_user_id, venue_id, member_id, ok, purpose)
  VALUES (p_device_user, p_venue_id, v_pin.member_id, v_match, p_purpose);
  IF v_match THEN
    UPDATE public.brand_member_pins
    SET failed_count = 0, failed_window_started_at = NULL, locked_until = NULL, updated_at = now()
    WHERE member_id = v_pin.member_id;
    RETURN jsonb_build_object('ok', true, 'memberId', v_member.id, 'memberUserId', v_member.user_id,
      'brandId', v_member.brand_id);
  END IF;

  v_failed := v_pin.failed_count + 1;
  SELECT count(*) INTO v_day FROM public.venue_pin_attempts a
  WHERE a.member_id = v_pin.member_id AND a.ok = false
    AND a.at > GREATEST(now() - interval '24 hours', v_pin.set_at);
  IF v_day >= 10 THEN
    UPDATE public.brand_member_pins
    SET hard_locked = true, failed_count = 0, locked_until = NULL, updated_at = now()
    WHERE member_id = v_pin.member_id;
    PERFORM public.issue_4490_floor_audit(v_member.brand_id, v_member.user_id, p_device_user, 'pin.locked',
      'brand_team_member', v_member.id::text,
      jsonb_build_object('member_id', v_member.id, 'venue_id', p_venue_id, 'lock', 'until_reset'));
    RETURN jsonb_build_object('ok', false, 'reason', 'hard_locked');
  END IF;
  IF v_failed >= 5 THEN
    UPDATE public.brand_member_pins
    SET failed_count = 0, failed_window_started_at = NULL,
        locked_until = now() + interval '5 minutes', updated_at = now()
    WHERE member_id = v_pin.member_id;
    PERFORM public.issue_4490_floor_audit(v_member.brand_id, v_member.user_id, p_device_user, 'pin.locked',
      'brand_team_member', v_member.id::text,
      jsonb_build_object('member_id', v_member.id, 'venue_id', p_venue_id, 'lock', '5_minutes',
        'until', now() + interval '5 minutes'));
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'lockedUntil', now() + interval '5 minutes');
  END IF;
  UPDATE public.brand_member_pins
  SET failed_count = v_failed, failed_window_started_at = COALESCE(failed_window_started_at, now()),
      updated_at = now()
  WHERE member_id = v_pin.member_id;
  RETURN jsonb_build_object('ok', false, 'reason', 'wrong', 'triesLeft', 5 - v_failed);
END;
$function$;

-- ===========================================================================
-- 7. Sessions.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_pin_unlock(
  p_venue_id uuid,
  p_device_user uuid,
  p_member uuid,
  p_pin text,
  p_auth_session uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_check jsonb;
  v_token bytea;
  v_session public.venue_staff_switch_sessions%ROWTYPE;
  v_auto smallint;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_till_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  -- A PIN never signs anyone in: only a signed-in Till device login switches.
  IF NOT public.issue_4490_is_till_device(p_venue_id, p_device_user) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_check := public.issue_4490_pin_check(p_venue_id, p_device_user, p_member, p_pin, 'unlock');
  IF (v_check->>'ok')::boolean IS NOT TRUE THEN
    RETURN v_check;
  END IF;
  -- One live session per device and venue: switching ends the previous one.
  UPDATE public.venue_staff_switch_sessions
  SET ended_at = now(), ended_reason = 'switched'
  WHERE device_user_id = p_device_user AND venue_id = p_venue_id AND ended_at IS NULL;
  v_token := extensions.gen_random_bytes(32);
  INSERT INTO public.venue_staff_switch_sessions (
    venue_id, brand_id, device_user_id, member_id, member_user_id, token_hash, auth_session_id,
    expires_at, last_seen_at
  ) VALUES (
    p_venue_id, v_venue.brand_id, p_device_user, (v_check->>'memberId')::uuid,
    (v_check->>'memberUserId')::uuid, extensions.digest(v_token, 'sha256'), p_auth_session,
    now() + interval '12 hours', now()
  ) RETURNING * INTO v_session;
  SELECT s.auto_lock_minutes INTO v_auto FROM public.venue_till_settings s WHERE s.venue_id = p_venue_id;
  RETURN jsonb_build_object(
    'ok', true,
    'token', encode(v_token, 'hex'),
    'sessionId', v_session.id,
    'expiresAt', v_session.expires_at,
    'autoLockMinutes', COALESCE(v_auto, 2),
    'member', jsonb_build_object(
      'memberId', v_session.member_id,
      'userId', v_session.member_user_id,
      'name', COALESCE(public.issue_4490_floor_person_name(v_session.member_user_id, p_venue_id), 'Team member'),
      'canApprove', public.issue_4490_can_manage_money(p_venue_id, v_session.member_user_id)));
END;
$function$;

-- Checks device, venue, expiry, idle (auto_lock_minutes) and the device's auth
-- session on every call, and touches last_seen_at. One refusal code for every
-- reason (no oracle).
CREATE OR REPLACE FUNCTION public.issue_4490_pin_session_resolve(
  p_token_hash bytea,
  p_device_user uuid,
  p_venue_id uuid,
  p_auth_session uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_session public.venue_staff_switch_sessions%ROWTYPE;
  v_auto smallint;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT s.auto_lock_minutes INTO v_auto FROM public.venue_till_settings s WHERE s.venue_id = p_venue_id;
  v_auto := COALESCE(v_auto, 2);
  SELECT * INTO v_session FROM public.venue_staff_switch_sessions
  WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND
     OR v_session.ended_at IS NOT NULL
     OR v_session.device_user_id <> p_device_user
     OR v_session.venue_id <> p_venue_id
     OR v_session.expires_at <= now()
     OR v_session.last_seen_at <= now() - make_interval(mins => v_auto)
     OR v_session.auth_session_id IS DISTINCT FROM p_auth_session
     OR NOT public.issue_4490_pin_gate(p_venue_id, p_device_user)
     OR NOT public.issue_4490_pin_member_eligible(p_venue_id, v_session.member_id, 'unlock') THEN
    RAISE EXCEPTION 'pin_session_invalid' USING ERRCODE = '28000';
  END IF;
  UPDATE public.venue_staff_switch_sessions SET last_seen_at = now() WHERE id = v_session.id;
  RETURN jsonb_build_object(
    'sessionId', v_session.id,
    'memberId', v_session.member_id,
    'memberUserId', v_session.member_user_id,
    'deviceUserId', v_session.device_user_id,
    'expiresAt', v_session.expires_at,
    'autoLockMinutes', v_auto,
    'memberName', COALESCE(public.issue_4490_floor_person_name(v_session.member_user_id, p_venue_id), 'Team member'),
    'canApprove', public.issue_4490_can_manage_money(p_venue_id, v_session.member_user_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pin_session_end(
  p_token_hash bytea,
  p_device_user uuid,
  p_venue_id uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count int;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.venue_staff_switch_sessions
  SET ended_at = now(),
      ended_reason = CASE WHEN p_reason = 'auto_lock' THEN 'auto_lock' ELSE 'ended' END
  WHERE token_hash = p_token_hash AND device_user_id = p_device_user AND venue_id = p_venue_id
    AND ended_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Ends every live session of a device (sign-out of the Till device login).
CREATE OR REPLACE FUNCTION public.issue_4490_pin_sessions_end_all(p_device_user uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count int;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.venue_staff_switch_sessions
  SET ended_at = now(), ended_reason = 'device_signed_out'
  WHERE device_user_id = p_device_user AND ended_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- ===========================================================================
-- 8. Step-up (a fresh PIN at that moment) and the manager's approval on the
--    spot. The person entering the PIN must hold money rights at the venue
--    for refund / void_sent / reopen / export, and manager rights for a
--    device sign-out (no PIN session needed for that one).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_pin_approve(
  p_token_hash bytea,
  p_device_user uuid,
  p_venue_id uuid,
  p_auth_session uuid,
  p_member uuid,
  p_pin text,
  p_purpose text,
  p_target text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_session jsonb;
  v_member uuid := p_member;
  v_check jsonb;
  v_user uuid;
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_purpose NOT IN ('refund', 'void_sent', 'reopen', 'export', 'sign_out')
     OR (p_target IS NOT NULL AND char_length(p_target) > 80) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_pin_gate(p_venue_id, p_device_user) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_purpose <> 'sign_out' THEN
    -- Raises pin_session_invalid for an ended, expired, idle or foreign token.
    v_session := public.issue_4490_pin_session_resolve(p_token_hash, p_device_user, p_venue_id, p_auth_session);
    v_member := COALESCE(p_member, (v_session->>'memberId')::uuid);
  END IF;
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_check := public.issue_4490_pin_check(p_venue_id, p_device_user, v_member, p_pin, p_purpose);
  IF (v_check->>'ok')::boolean IS NOT TRUE THEN
    RETURN v_check;
  END IF;
  v_user := (v_check->>'memberUserId')::uuid;
  IF (p_purpose = 'sign_out' AND NOT public.issue_4490_pin_can_manage_venue(p_venue_id, v_user))
     OR (p_purpose <> 'sign_out' AND NOT public.issue_4490_can_manage_money(p_venue_id, v_user)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_rights');
  END IF;
  INSERT INTO public.venue_pin_approvals (
    session_id, venue_id, brand_id, device_user_id, seller_user_id, approver_member_id, approver_user_id,
    purpose, target
  ) VALUES (
    (v_session->>'sessionId')::uuid, p_venue_id, (v_check->>'brandId')::uuid, p_device_user,
    (v_session->>'memberUserId')::uuid, v_member, v_user, p_purpose, p_target
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'approvalId', v_id, 'approverUserId', v_user,
    'approverMemberId', v_member,
    'sellerUserId', v_session->>'memberUserId');
END;
$function$;

-- ===========================================================================
-- 9. The in-transaction assert (money rows, the device void, and part B's
--    close / reopen / cash movements).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_pin_actor_assert(
  p_venue_id uuid,
  p_actor uuid,
  p_device_user uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_session public.venue_staff_switch_sessions%ROWTYPE;
BEGIN
  IF p_device_user IS NULL OR p_device_user = p_actor THEN
    -- Acting as itself: never a Till device (it needs someone's PIN).
    IF public.issue_4490_is_till_device(p_venue_id, p_actor) THEN
      RAISE EXCEPTION 'pin_session_required' USING ERRCODE = '28000';
    END IF;
    RETURN;
  END IF;
  IF NOT public.issue_4490_is_till_device(p_venue_id, p_device_user) THEN
    RAISE EXCEPTION 'pin_session_invalid' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_session FROM public.venue_staff_switch_sessions
  WHERE device_user_id = p_device_user AND venue_id = p_venue_id AND ended_at IS NULL
    AND expires_at > now()
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pin_session_invalid' USING ERRCODE = '28000';
  END IF;
  IF v_session.member_user_id = p_actor THEN
    RETURN;
  END IF;
  -- A manager approving on the spot (§11.4 item 1): their fresh approval on
  -- this very session.
  IF EXISTS (SELECT 1 FROM public.venue_pin_approvals a
             WHERE a.session_id = v_session.id AND a.approver_user_id = p_actor
               AND a.created_at > now() - interval '2 minutes') THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'pin_session_invalid' USING ERRCODE = '28000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pin_money_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
BEGIN
  IF TG_TABLE_NAME = 'venue_till_payments' THEN
    SELECT s.venue_id INTO v_venue FROM public.venue_till_sales s WHERE s.id = NEW.sale_id;
    PERFORM public.issue_4490_pin_actor_assert(v_venue, NEW.taken_by_user_id, NEW.device_user_id);
  ELSE
    SELECT s.venue_id INTO v_venue FROM public.venue_till_payments p
    JOIN public.venue_till_sales s ON s.id = p.sale_id WHERE p.id = NEW.payment_id;
    PERFORM public.issue_4490_pin_actor_assert(v_venue, NEW.by_user_id, NEW.device_user_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_pin_money_row_guard
  BEFORE INSERT ON public.venue_till_payments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_pin_money_row_guard();
CREATE TRIGGER issue_4490_pin_money_row_guard
  BEFORE INSERT ON public.venue_till_refunds
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_pin_money_row_guard();

-- ===========================================================================
-- 10. The void on a Till device: the session asserted in the void's own
--     transaction, a sent item only with step-up, the device recorded.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_till_void_on_device(
  p_sale_id uuid,
  p_line_id uuid,
  p_order_item_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_reason text,
  p_restock boolean,
  p_expected_version integer,
  p_stepped_up boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
  v_sent boolean := false;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT s.venue_id INTO v_venue FROM public.venue_till_sales s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.issue_4490_pin_actor_assert(v_venue, p_actor, p_device_user);
  IF p_order_item_id IS NOT NULL THEN
    SELECT o.fulfillment_status <> 'held' INTO v_sent
    FROM public.venue_order_items i JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE i.id = p_order_item_id;
  ELSIF p_line_id IS NOT NULL THEN
    SELECT o.fulfillment_status <> 'held' INTO v_sent
    FROM public.venue_till_lines l JOIN public.venue_orders o ON o.id = l.venue_order_id
    WHERE l.id = p_line_id AND l.kind = 'menu_round';
  END IF;
  IF COALESCE(v_sent, false) AND NOT COALESCE(p_stepped_up, false) THEN
    RAISE EXCEPTION 'pin_step_up_required' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('mingla.issue_4490_device_user', p_device_user::text, true);
  RETURN public.issue_4490_till_void(p_sale_id, p_line_id, p_order_item_id, p_actor, p_reason,
    p_restock, p_expected_version);
END;
$function$;

-- ===========================================================================
-- 11. Audit rows written beside the money (no PIN, hash or token ever).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_floor_audit_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
BEGIN
  IF NEW.state = 'paid' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'paid') THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = NEW.sale_id;
    PERFORM public.issue_4490_floor_audit(v_sale.brand_id, NEW.taken_by_user_id, NEW.device_user_id,
      'till.pay', 'venue_till_payment', NEW.id::text,
      jsonb_build_object('sale_id', NEW.sale_id, 'venue_id', v_sale.venue_id, 'method', NEW.method,
        'amount_minor', NEW.amount_minor, 'tip_minor', NEW.tip_minor, 'paid_late', NEW.paid_late,
        'server_user_id', NEW.server_user_id));
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER issue_4490_floor_audit_paid
  AFTER INSERT OR UPDATE OF state ON public.venue_till_payments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_floor_audit_paid();

CREATE OR REPLACE FUNCTION public.issue_4490_floor_audit_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_approval uuid;
BEGIN
  SELECT s.* INTO v_sale FROM public.venue_till_payments p
  JOIN public.venue_till_sales s ON s.id = p.sale_id WHERE p.id = NEW.payment_id;
  IF NEW.device_user_id IS DISTINCT FROM NEW.by_user_id THEN
    SELECT a.id INTO v_approval FROM public.venue_pin_approvals a
    WHERE a.device_user_id = NEW.device_user_id AND a.approver_user_id = NEW.by_user_id
      AND a.purpose = 'refund' AND a.created_at > now() - interval '2 minutes'
    ORDER BY a.created_at DESC LIMIT 1;
  END IF;
  PERFORM public.issue_4490_floor_audit(v_sale.brand_id, NEW.by_user_id, NEW.device_user_id,
    'till.refund', 'venue_till_refund', NEW.id::text,
    jsonb_build_object('payment_id', NEW.payment_id, 'sale_id', v_sale.id, 'venue_id', v_sale.venue_id,
      'method', NEW.method, 'amount_minor', NEW.amount_minor, 'tip_minor', NEW.tip_minor,
      'approval_id', v_approval));
  RETURN NULL;
END;
$function$;

CREATE TRIGGER issue_4490_floor_audit_refund
  AFTER INSERT ON public.venue_till_refunds
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_floor_audit_refund();

CREATE OR REPLACE FUNCTION public.issue_4490_floor_audit_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_actor uuid := NEW.voided_by_user_id;
BEGIN
  IF TG_TABLE_NAME = 'venue_till_lines' THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = NEW.sale_id;
    PERFORM public.issue_4490_floor_audit(v_sale.brand_id, v_actor,
      public.issue_4490_pin_current_device(v_actor), 'till.void', 'venue_till_line', NEW.id::text,
      jsonb_build_object('sale_id', NEW.sale_id, 'venue_id', v_sale.venue_id, 'kind', NEW.kind,
        'amount_minor', NEW.amount_minor, 'reason', NEW.void_reason));
  ELSE
    SELECT s.* INTO v_sale FROM public.venue_orders o
    JOIN public.venue_till_sales s ON s.session_id = o.session_id
    WHERE o.id = NEW.venue_order_id;
    IF v_sale.id IS NULL THEN
      RETURN NULL; -- not a Till round
    END IF;
    PERFORM public.issue_4490_floor_audit(v_sale.brand_id, v_actor,
      public.issue_4490_pin_current_device(v_actor), 'till.void', 'venue_order_item', NEW.id::text,
      jsonb_build_object('sale_id', v_sale.id, 'venue_id', v_sale.venue_id, 'order_id', NEW.venue_order_id,
        'quantity', NEW.quantity, 'amount_minor', NEW.line_total_cents, 'reason', NEW.void_reason));
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER issue_4490_floor_audit_void
  AFTER UPDATE OF voided_at ON public.venue_till_lines
  FOR EACH ROW WHEN (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL)
  EXECUTE FUNCTION public.issue_4490_floor_audit_void();
CREATE TRIGGER issue_4490_floor_audit_void
  AFTER UPDATE OF voided_at ON public.venue_order_items
  FOR EACH ROW WHEN (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL)
  EXECUTE FUNCTION public.issue_4490_floor_audit_void();

-- ===========================================================================
-- 12. Grants: every function internal (database functions and the service
--     role only).
-- ===========================================================================
REVOKE ALL ON FUNCTION
  public.issue_4490_pin_gate(uuid, uuid),
  public.issue_4490_pin_is_weak(text),
  public.issue_4490_pin_member_is_mingla_admin(uuid),
  public.issue_4490_pin_member_eligible(uuid, uuid, text),
  public.issue_4490_pin_can_reset(uuid, uuid),
  public.issue_4490_pin_can_manage_venue(uuid, uuid),
  public.issue_4490_pin_current_device(uuid),
  public.issue_4490_floor_audit(uuid, uuid, uuid, text, text, text, jsonb),
  public.issue_4490_pin_set(uuid, uuid, text),
  public.issue_4490_pin_reset(uuid, uuid),
  public.issue_4490_pin_status(uuid, uuid),
  public.issue_4490_pin_team(uuid, uuid),
  public.issue_4490_pin_staff(uuid, uuid),
  public.issue_4490_pin_check(uuid, uuid, uuid, text, text),
  public.issue_4490_pin_unlock(uuid, uuid, uuid, text, uuid),
  public.issue_4490_pin_session_resolve(bytea, uuid, uuid, uuid),
  public.issue_4490_pin_session_end(bytea, uuid, uuid, text),
  public.issue_4490_pin_sessions_end_all(uuid),
  public.issue_4490_pin_approve(bytea, uuid, uuid, uuid, uuid, text, text, text),
  public.issue_4490_pin_actor_assert(uuid, uuid, uuid),
  public.issue_4490_pin_money_row_guard(),
  public.issue_4490_till_void_on_device(uuid, uuid, uuid, uuid, uuid, text, boolean, integer, boolean),
  public.issue_4490_floor_audit_paid(),
  public.issue_4490_floor_audit_refund(),
  public.issue_4490_floor_audit_void()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_pin_gate(uuid, uuid),
  public.issue_4490_pin_is_weak(text),
  public.issue_4490_pin_member_is_mingla_admin(uuid),
  public.issue_4490_pin_member_eligible(uuid, uuid, text),
  public.issue_4490_pin_can_reset(uuid, uuid),
  public.issue_4490_pin_can_manage_venue(uuid, uuid),
  public.issue_4490_pin_current_device(uuid),
  public.issue_4490_floor_audit(uuid, uuid, uuid, text, text, text, jsonb),
  public.issue_4490_pin_set(uuid, uuid, text),
  public.issue_4490_pin_reset(uuid, uuid),
  public.issue_4490_pin_status(uuid, uuid),
  public.issue_4490_pin_team(uuid, uuid),
  public.issue_4490_pin_staff(uuid, uuid),
  public.issue_4490_pin_check(uuid, uuid, uuid, text, text),
  public.issue_4490_pin_unlock(uuid, uuid, uuid, text, uuid),
  public.issue_4490_pin_session_resolve(bytea, uuid, uuid, uuid),
  public.issue_4490_pin_session_end(bytea, uuid, uuid, text),
  public.issue_4490_pin_sessions_end_all(uuid),
  public.issue_4490_pin_approve(bytea, uuid, uuid, uuid, uuid, text, text, text),
  public.issue_4490_pin_actor_assert(uuid, uuid, uuid),
  public.issue_4490_till_void_on_device(uuid, uuid, uuid, uuid, uuid, text, boolean, integer, boolean)
TO service_role;

COMMIT;
