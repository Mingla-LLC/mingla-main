-- #4508 Phase 1 and Phase 2 (server) — bring a friend to an RSVP with just
-- their number. Spec: issue #4508 "Full build spec" + amendments 1-4.
--
--   1.10 event_rsvp_guests: name and email nullable (their length checks still
--        apply when present); invited_by_user_id, claimed_at,
--        brought_by_guest_id. "This isn't me" (1.18) DELETES the guest row (so
--        every reader, count and pass frees the spot with no extra filter) and
--        records the release, with its released_at, in rsvp_guest_releases,
--        which also stops further texts to that number for that event.
--   1.9  submit_event_rsvp: number-only guests (old {name,email,phone} guests
--        still accepted), the host's plus-one limit raised as an error, own
--        number / duplicate / already-listed / released numbers refused, a
--        per-inviter cap of 20 guest numbers per rolling 24 hours
--        (rsvp_guest_daily_cap), and guest rows are KEPT across a re-submit
--        when their number is still listed (claims, passes and texts survive).
--   1.11 rsvp_guest_display_name: account name, else the name given, else
--        "<Inviter first name>'s guest"; used by the host list, the scanner,
--        party passes and the admin RSVP list.
--   1.19-1.22 rsvp_guest_claim: one-tap claim when the account has proved the
--        invited number (account_owns_contact), otherwise phone_unproved; on
--        claim the inviter and guest become friends and close friends
--        (pairings.source = 'rsvp_guest', which check_pairing_allowed does not
--        count), skipped when either has blocked the other.
--   1.23 get_user_circle: a close friend made through an RSVP carries the event
--        as relationship context.
--   1.24 fetch_user_rsvp_party_passes: claimed, invite status, invite link.
--   2.1  rsvp_enqueue_guest_reminders: one reminder per unclaimed guest per
--        event, 23-24 hours before the start, on the existing RSVP queue.
--   2.3  friend-is-going notices, one per friend per event, drained by the
--        existing every-minute rsvp-notify tick.
--   2.5  events.rsvp_guests_can_bring (default off) and rsvp_guest_bring.
--
-- Application conflicts never raise 40001. Static SQL except where a column
-- may be absent on the CI image. Re-created functions name their source.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_rsvp_guests ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.event_rsvp_guests ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.event_rsvp_guests
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS brought_by_guest_id uuid NULL
    REFERENCES public.event_rsvp_guests(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS event_rsvp_guests_invited_by_idx
  ON public.event_rsvp_guests (invited_by_user_id) WHERE invited_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_rsvp_guests_brought_by_idx
  ON public.event_rsvp_guests (brought_by_guest_id) WHERE brought_by_guest_id IS NOT NULL;
COMMENT ON COLUMN public.event_rsvp_guests.name IS
  '#4508: the name given (old form, or by the guest at claim). NULL for a number-only guest; readers use rsvp_guest_display_name.';
COMMENT ON COLUMN public.event_rsvp_guests.claimed_at IS
  '#4508: when the guest claimed the pass in the app (rsvp_guest_claim).';
COMMENT ON COLUMN public.event_rsvp_guests.brought_by_guest_id IS
  '#4508 2.5: the claimed guest who brought this guest (guests bring guests).';

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rsvp_guests_can_bring boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.events.rsvp_guests_can_bring IS
  '#4508 2.5: a claimed guest may bring one more person, within total capacity. Default off.';

ALTER TABLE public.pairings
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'request';
ALTER TABLE public.pairings DROP CONSTRAINT IF EXISTS pairings_source_check;
ALTER TABLE public.pairings ADD CONSTRAINT pairings_source_check
  CHECK (source IN ('request', 'rsvp_guest'));
COMMENT ON COLUMN public.pairings.source IS
  '#4508 D1: rsvp_guest pairings (made when a brought guest claims) do not use the pairing allowance.';

ALTER TABLE public.friend_requests DROP CONSTRAINT IF EXISTS friend_requests_source_check;
ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_source_check
  CHECK (source = ANY (ARRAY['app'::text, 'map'::text, 'onboarding'::text,
    'session'::text, 'share_link'::text, 'rsvp_guest'::text]));

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS friends_going boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.notification_preferences.friends_going IS
  '#4508 2.3: push when a close friend is going to an event.';

CREATE TABLE IF NOT EXISTS public.rsvp_guest_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  rsvp_id uuid NULL REFERENCES public.event_rsvps(id) ON DELETE SET NULL,
  phone_digits text NOT NULL CHECK (phone_digits ~ '^[0-9]{7,15}$'),
  inviter_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  claim_code text NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rsvp_guest_releases_event_number UNIQUE (event_id, phone_digits)
);
CREATE INDEX IF NOT EXISTS rsvp_guest_releases_code_idx
  ON public.rsvp_guest_releases (claim_code) WHERE claim_code IS NOT NULL;
COMMENT ON TABLE public.rsvp_guest_releases IS
  '#4508 1.18: "This isn''t me". The number is never texted again for this event and cannot be re-added to it.';

CREATE TABLE IF NOT EXISTS public.rsvp_guest_invite_log (
  id bigserial PRIMARY KEY,
  inviter_key text NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  phone_digits text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvp_guest_invite_log_window_idx
  ON public.rsvp_guest_invite_log (inviter_key, created_at);
COMMENT ON TABLE public.rsvp_guest_invite_log IS
  '#4508 1.9: one row per guest number added by an inviter (user:<id> or phone:<digits>); the 24-hour cap counts these, so removing and re-adding does not reset it.';

CREATE TABLE IF NOT EXISTS public.rsvp_guest_connections (
  guest_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  inviter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pairing_id uuid NULL REFERENCES public.pairings(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('connected', 'already_friends', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvp_guest_connections_pairing_idx
  ON public.rsvp_guest_connections (pairing_id) WHERE pairing_id IS NOT NULL;
COMMENT ON TABLE public.rsvp_guest_connections IS
  '#4508 1.21-1.23: the friendship a claimed RSVP guest made, and the event it came through.';

CREATE TABLE IF NOT EXISTS public.rsvp_friend_going_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'taken')),
  created_at timestamptz NOT NULL DEFAULT now(),
  taken_at timestamptz NULL,
  CONSTRAINT rsvp_friend_going_notices_once UNIQUE (event_id, friend_user_id)
);
CREATE INDEX IF NOT EXISTS rsvp_friend_going_notices_pending_idx
  ON public.rsvp_friend_going_notices (created_at) WHERE status = 'pending';
COMMENT ON TABLE public.rsvp_friend_going_notices IS
  '#4508 2.3: "{Name} is going to {event}". At most one per friend per event, ever.';

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['rsvp_guest_releases', 'rsvp_guest_invite_log',
    'rsvp_guest_connections', 'rsvp_friend_going_notices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END
$rls$;
REVOKE ALL ON SEQUENCE public.rsvp_guest_invite_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.rsvp_guest_invite_log_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Names
-- ---------------------------------------------------------------------------
-- The inviter of a guest: who added the number, else the party's primary.
CREATE OR REPLACE FUNCTION public.rsvp_guest_inviter_names(p_guest_id uuid)
RETURNS TABLE (inviter_user_id uuid, first_name text, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  WITH src AS (
    SELECT COALESCE(g.invited_by_user_id, r.user_id) AS uid,
           COALESCE(
             NULLIF(btrim(p.first_name), ''),
             NULLIF(split_part(btrim(COALESCE(p.display_name, '')), ' ', 1), ''),
             NULLIF(split_part(btrim(COALESCE(
               CASE WHEN g.invited_by_user_id IS NULL OR g.invited_by_user_id = r.user_id
                 THEN r.guest_name END, '')), ' ', 1), ''),
             NULLIF(btrim(p.username), '')
           ) AS first_name,
           COALESCE(
             NULLIF(btrim(p.last_name), ''),
             NULLIF(btrim(substr(btrim(COALESCE(p.display_name, '')),
               length(split_part(btrim(COALESCE(p.display_name, '')), ' ', 1)) + 1)), ''),
             NULLIF(btrim(substr(btrim(COALESCE(
               CASE WHEN g.invited_by_user_id IS NULL OR g.invited_by_user_id = r.user_id
                 THEN r.guest_name END, '')),
               length(split_part(btrim(COALESCE(
                 CASE WHEN g.invited_by_user_id IS NULL OR g.invited_by_user_id = r.user_id
                   THEN r.guest_name END, '')), ' ', 1)) + 1)), '')
           ) AS last_name
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      LEFT JOIN public.profiles p ON p.id = COALESCE(g.invited_by_user_id, r.user_id)
     WHERE g.id = p_guest_id
  )
  SELECT src.uid,
         src.first_name,
         CASE
           WHEN src.first_name IS NULL THEN NULL
           WHEN src.last_name IS NULL OR src.last_name = 'Guest' THEN src.first_name
           ELSE src.first_name || ' ' || upper(left(src.last_name, 1)) || '.'
         END
    FROM src;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_inviter_names(uuid) IS
  '#4508: the inviter of a guest (who added the number, else the primary): account id, first name, and "First L." for texts.';
REVOKE ALL ON FUNCTION public.rsvp_guest_inviter_names(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_inviter_names(uuid) TO service_role;

-- 1.11 The guest's display name everywhere.
CREATE OR REPLACE FUNCTION public.rsvp_guest_display_name(p_guest_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    NULLIF(btrim(p.display_name), ''),
    NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), ''),
    NULLIF(btrim(g.name), ''),
    (SELECT n.first_name || '''s guest' FROM public.rsvp_guest_inviter_names(g.id) n
      WHERE n.first_name IS NOT NULL),
    'Guest')
    FROM public.event_rsvp_guests g
    LEFT JOIN public.profiles p ON p.id = g.matched_user_id
   WHERE g.id = p_guest_id;
$function$;
COMMENT ON FUNCTION public.rsvp_guest_display_name(uuid) IS
  '#4508 1.11: matched account name, else the name given, else "<Inviter first name>''s guest", else "Guest".';
REVOKE ALL ON FUNCTION public.rsvp_guest_display_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_display_name(uuid) TO service_role;

-- The state of the invite text for one guest (1.14 / 1.15 / 1.24).
CREATE OR REPLACE FUNCTION public.rsvp_guest_invite_status(p_guest_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT CASE
             WHEN d.status = 'sent' THEN 'sent'
             WHEN d.status IN ('failed_terminal', 'ambiguous') THEN 'failed'
             ELSE 'sending'
           END
      FROM public.rsvp_notifications n
      JOIN public.rsvp_notification_deliveries d
        ON d.notification_id = n.id AND d.channel = 'sms'
     WHERE n.template_key IN ('rsvp_pass', 'rsvp_approved', 'rsvp_waitlist_promoted')
       AND n.payload->>'guestId' = p_guest_id::text
     ORDER BY n.created_at DESC
     LIMIT 1
  ), 'not_texted');
$function$;
COMMENT ON FUNCTION public.rsvp_guest_invite_status(uuid) IS
  '#4508: sent | sending | failed | not_texted for the guest''s invite text. A failed or suppressed text is never retried.';
REVOKE ALL ON FUNCTION public.rsvp_guest_invite_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_invite_status(uuid) TO service_role;

-- Numbers an account has proved or holds (own-number refusal).
CREATE OR REPLACE FUNCTION public.rsvp_account_phone_digits(p_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_out text[] := '{}';
  v_auth text;
BEGIN
  IF p_user_id IS NULL THEN RETURN v_out; END IF;
  SELECT coalesce(array_agg(DISTINCT d) FILTER (WHERE d <> ''), '{}') INTO v_out
    FROM (
      SELECT regexp_replace(coalesce(v.phone_e164, ''), '\D', '', 'g') AS d
        FROM public.verified_phone_identities v WHERE v.user_id = p_user_id
      UNION ALL
      SELECT regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
        FROM public.profiles p WHERE p.id = p_user_id
    ) s;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'phone'
  ) THEN
    EXECUTE 'SELECT regexp_replace(coalesce(phone, ''''), ''\D'', '''', ''g'') FROM auth.users WHERE id = $1'
      INTO v_auth USING p_user_id;
    IF coalesce(v_auth, '') <> '' AND NOT (v_auth = ANY (v_out)) THEN
      v_out := v_out || v_auth;
    END IF;
  END IF;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_account_phone_digits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_account_phone_digits(uuid) TO service_role;

-- Is this number (digits) already on the event's list, outside one party?
CREATE OR REPLACE FUNCTION public.rsvp_number_on_event_list(
  p_event_id uuid, p_digits text, p_except_rsvp_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
     WHERE r.event_id = p_event_id
       AND r.id IS DISTINCT FROM p_except_rsvp_id
       AND r.rsvp_status <> 'not_going'
       AND regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = p_digits
  ) OR EXISTS (
    SELECT 1 FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.id IS DISTINCT FROM p_except_rsvp_id
       AND r.rsvp_status <> 'not_going'
       AND regexp_replace(coalesce(r.guest_phone, ''), '\D', '', 'g') = p_digits
  );
$function$;
REVOKE ALL ON FUNCTION public.rsvp_number_on_event_list(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_number_on_event_list(uuid, text, uuid) TO service_role;

-- Is this account already on the event's list, outside one party?
CREATE OR REPLACE FUNCTION public.rsvp_user_on_event_list(
  p_event_id uuid, p_user_id uuid, p_except_rsvp_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.event_rsvps r
       WHERE r.event_id = p_event_id AND r.user_id = p_user_id
         AND r.id IS DISTINCT FROM p_except_rsvp_id
         AND r.rsvp_status <> 'not_going'
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvp_guests g
        JOIN public.event_rsvps r ON r.id = g.rsvp_id
       WHERE r.event_id = p_event_id AND g.matched_user_id = p_user_id
         AND r.id IS DISTINCT FROM p_except_rsvp_id
         AND r.rsvp_status <> 'not_going'
    ));
$function$;
REVOKE ALL ON FUNCTION public.rsvp_user_on_event_list(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_user_on_event_list(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Close friends through an RSVP do not use the pairing allowance (D1).
--    check_pairing_allowed: baseline 20260505000000 line 3877; only the count
--    changes (it skips source = 'rsvp_guest'). search_path as #4423 W5 set it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_pairing_allowed(p_user_id uuid)
RETURNS TABLE(allowed boolean, current_count integer, max_allowed integer, tier text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_tier TEXT; v_limits JSONB; v_max INTEGER; v_count INTEGER;
BEGIN
  v_tier := get_effective_tier(p_user_id);
  v_limits := get_tier_limits(v_tier);
  v_max := (v_limits->>'max_pairings')::INTEGER;
  SELECT COUNT(*) INTO v_count FROM pairings
   WHERE (user_a_id = p_user_id OR user_b_id = p_user_id)
     AND source <> 'rsvp_guest';
  IF v_max = -1 THEN allowed := true; ELSE allowed := (v_count < v_max); END IF;
  current_count := v_count; max_allowed := v_max; tier := v_tier;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Friendship on claim (1.21, 1.22). Reuses the friend and pairing tables
--    exactly as accept_friend_request_atomic / accept_pair_request_atomic
--    write them; never touches a block, never deletes one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4508_connect_rsvp_pair(
  p_inviter uuid, p_guest_user uuid, p_guest_id uuid, p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_a uuid;
  v_b uuid;
  v_pairing uuid;
  v_request uuid;
  v_already boolean;
  v_outcome text;
BEGIN
  IF p_inviter IS NULL OR p_guest_user IS NULL OR p_inviter = p_guest_user THEN
    RETURN jsonb_build_object('friendship', 'none', 'closeFriend', false);
  END IF;

  IF public.has_block_between(p_inviter, p_guest_user) OR EXISTS (
    SELECT 1 FROM public.friends f
     WHERE f.status = 'blocked' AND f.deleted_at IS NULL
       AND ((f.user_id = p_inviter AND f.friend_user_id = p_guest_user)
         OR (f.user_id = p_guest_user AND f.friend_user_id = p_inviter))
  ) THEN
    INSERT INTO public.rsvp_guest_connections(guest_id, event_id, inviter_user_id,
      guest_user_id, outcome)
    VALUES (p_guest_id, p_event_id, p_inviter, p_guest_user, 'blocked')
    ON CONFLICT (guest_id) DO NOTHING;
    RETURN jsonb_build_object('friendship', 'blocked', 'closeFriend', false);
  END IF;

  v_already := EXISTS (
    SELECT 1 FROM public.friends WHERE user_id = p_inviter AND friend_user_id = p_guest_user
       AND status = 'accepted' AND deleted_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.friends WHERE user_id = p_guest_user AND friend_user_id = p_inviter
       AND status = 'accepted' AND deleted_at IS NULL
  );

  IF NOT v_already THEN
    INSERT INTO public.friends (user_id, friend_user_id, status)
    VALUES (p_inviter, p_guest_user, 'accepted'), (p_guest_user, p_inviter, 'accepted')
    ON CONFLICT (user_id, friend_user_id)
    DO UPDATE SET status = 'accepted', deleted_at = NULL, updated_at = now();
    INSERT INTO public.friend_requests (sender_id, receiver_id, status, source)
    VALUES (p_inviter, p_guest_user, 'accepted', 'rsvp_guest')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING;
    -- A pending request either way is settled, as accepting would settle it.
    UPDATE public.friend_requests SET status = 'accepted', updated_at = now()
     WHERE status = 'pending'
       AND ((sender_id = p_inviter AND receiver_id = p_guest_user)
         OR (sender_id = p_guest_user AND receiver_id = p_inviter));
  END IF;

  -- Close friend: a pairing in canonical order, made free (source rsvp_guest).
  IF p_inviter < p_guest_user THEN v_a := p_inviter; v_b := p_guest_user;
  ELSE v_a := p_guest_user; v_b := p_inviter; END IF;
  SELECT id INTO v_pairing FROM public.pairings WHERE user_a_id = v_a AND user_b_id = v_b;
  IF v_pairing IS NULL THEN
    -- An active pair request either way is reused (its unique index allows
    -- one pending-or-accepted request per direction).
    SELECT pr.id INTO v_request FROM public.pair_requests pr
     WHERE pr.status IN ('pending', 'accepted')
       AND ((pr.sender_id = p_inviter AND pr.receiver_id = p_guest_user)
         OR (pr.sender_id = p_guest_user AND pr.receiver_id = p_inviter))
     ORDER BY (pr.status = 'accepted') DESC, pr.created_at
     LIMIT 1
     FOR UPDATE;
    IF v_request IS NULL THEN
      INSERT INTO public.pair_requests (sender_id, receiver_id, status, visibility)
      VALUES (p_inviter, p_guest_user, 'accepted', 'visible')
      RETURNING id INTO v_request;
    ELSE
      UPDATE public.pair_requests SET status = 'accepted', visibility = 'visible'
       WHERE id = v_request AND status = 'pending';
    END IF;
    INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id, source)
    VALUES (v_a, v_b, v_request, 'rsvp_guest')
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING
    RETURNING id INTO v_pairing;
    IF v_pairing IS NULL THEN
      SELECT id INTO v_pairing FROM public.pairings WHERE user_a_id = v_a AND user_b_id = v_b;
    END IF;
  END IF;

  v_outcome := CASE WHEN v_already THEN 'already_friends' ELSE 'connected' END;
  INSERT INTO public.rsvp_guest_connections(guest_id, event_id, inviter_user_id,
    guest_user_id, pairing_id, outcome)
  VALUES (p_guest_id, p_event_id, p_inviter, p_guest_user, v_pairing, v_outcome)
  ON CONFLICT (guest_id) DO NOTHING;

  RETURN jsonb_build_object('friendship', v_outcome, 'closeFriend', v_pairing IS NOT NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_connect_rsvp_pair(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_connect_rsvp_pair(uuid, uuid, uuid, uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 5. submit_event_rsvp (20281119004508, from 20271215004063 lines 500-772).
--    Unchanged: signature, grants, the event and #1902 gates, #1857 phone
--    authority, the #4063 anonymous guard, approval and capacity resolution,
--    the parent upsert and pass minting. Changed (marked #4508): guest
--    validation (3b), capacity counts guests a claimed guest brought, and the
--    guest child set (6) keeps rows whose number is still listed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_event_rsvp(
  p_event_id   uuid,
  p_user_id    uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count  integer DEFAULT 0,
  p_guests      jsonb   DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL,
  p_guest_phone_country_iso text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event       public.events%ROWTYPE;
  v_master_count integer;
  v_master_end_at timestamptz;
  v_plus        integer;
  v_confirmed   integer;
  v_status      text;
  v_approval    text;
  v_name        text;
  v_existing_id uuid;
  v_guest       jsonb;
  v_guest_id    uuid;
  v_gname       text;
  v_gemail      text;
  v_gphone      text;
  v_gphone_country_iso text;
  v_token_hash  text;
  v_qr          text;
  v_primary_qr  text;
  -- #4508
  v_max_guests  integer;
  v_digits      text;
  v_seen        text[] := '{}';
  v_own         text[] := '{}';
  v_brought     integer := 0;
  v_match       uuid;
  v_kept        public.event_rsvp_guests%ROWTYPE;
  v_new_count   integer := 0;
  v_recent      integer;
  v_inviter_key text;
  v_guests_out  jsonb;
BEGIN
  -- 1. Load + gate the event (FOR UPDATE serializes concurrent submits).
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND
     OR v_event.event_type <> 'rsvp'
     OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp_not_open';
  END IF;

  -- #1902: preserve the deployed authoritative acquisition boundary. This
  -- precedes every validation, capacity, identity, guest, pass, and delivery write.
  SELECT count(*)::integer, max(ed.end_at)
    INTO v_master_count, v_master_end_at
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
     AND ed.is_master IS TRUE;

  IF v_master_count <> 1 OR v_master_end_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1902',
      MESSAGE = 'rsvp_date_unavailable';
  END IF;

  IF v_master_end_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1901',
      MESSAGE = 'rsvp_event_ended';
  END IF;

  IF p_rsvp_status NOT IN ('going', 'not_going', 'maybe') THEN
    RAISE EXCEPTION 'rsvp_status_invalid';
  END IF;

  -- 2. Contact gate for link guests (anon — no user_id).
  v_name := NULLIF(btrim(COALESCE(p_guest_name, '')), '');
  IF p_user_id IS NULL THEN
    IF v_name IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
      RAISE EXCEPTION 'rsvp_contact_required';
    END IF;
  END IF;
  IF v_name IS NULL THEN
    v_name := COALESCE(NULLIF(btrim(p_guest_email), ''), 'Guest');
  END IF;

  -- #1857: changed writers accept only strict E.164 and explicit ISO provenance.
  IF NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL
     AND btrim(p_guest_phone) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'rsvp_phone_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND p_guest_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'rsvp_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'rsvp_phone_country_without_phone' USING ERRCODE = '22023';
  END IF;

  -- #4063 W0: an anonymous submission never changes an RSVP that already exists for that email.
  IF p_user_id IS NULL AND EXISTS (
    SELECT 1
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND lower(btrim(r.guest_email)) = lower(btrim(p_guest_email))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4063',
      MESSAGE = 'rsvp_already_exists';
  END IF;

  -- 3. Clamp plus_count.
  v_plus := GREATEST(COALESCE(p_plus_count, 0), 0);
  IF v_event.rsvp_allow_plus_ones THEN
    v_plus := LEAST(v_plus, v_event.rsvp_plus_ones_max);
  ELSE
    v_plus := 0;
  END IF;

  -- 3b. Per-guest validation. #4508 1.9: a guest needs only a phone number;
  --     name and email are optional (older apps still send them). The host's
  --     plus-one limit is an error, not a silent clamp. The inviter's own
  --     number and duplicates are refused.
  IF p_rsvp_status = 'not_going' THEN
    p_guests := '[]'::jsonb;
    v_plus := 0;
  ELSE
    IF jsonb_typeof(COALESCE(p_guests, '[]'::jsonb)) <> 'array' THEN
      p_guests := '[]'::jsonb;
    END IF;
    p_guests := COALESCE(p_guests, '[]'::jsonb);
    v_max_guests := CASE WHEN v_event.rsvp_allow_plus_ones
      THEN COALESCE(v_event.rsvp_plus_ones_max, 0) ELSE 0 END;
    IF jsonb_array_length(p_guests) > v_max_guests THEN
      RAISE EXCEPTION 'rsvp_plus_ones_exceeded' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_guests) <> v_plus THEN
      RAISE EXCEPTION 'rsvp_guest_count_mismatch';
    END IF;
    v_own := public.rsvp_account_phone_digits(p_user_id);
    IF NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL THEN
      v_own := v_own || regexp_replace(p_guest_phone, '\D', '', 'g');
    END IF;
    FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
      IF jsonb_typeof(v_guest) <> 'object'
         OR v_guest - ARRAY['name','email','phone','phoneCountryIso'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'rsvp_guest_keys_invalid' USING ERRCODE = '22023';
      END IF;
      IF NULLIF(btrim(COALESCE(v_guest->>'phone', '')), '') IS NULL THEN
        RAISE EXCEPTION 'rsvp_guest_contact_required';
      END IF;
      IF btrim(v_guest->>'phone') !~ '^\+[1-9][0-9]{7,14}$' THEN
        RAISE EXCEPTION 'rsvp_guest_phone_invalid' USING ERRCODE = '22023';
      END IF;
      IF (v_guest ? 'name' AND jsonb_typeof(v_guest->'name') NOT IN ('string', 'null'))
         OR length(btrim(COALESCE(v_guest->>'name', ''))) > 120 THEN
        RAISE EXCEPTION 'rsvp_guest_keys_invalid' USING ERRCODE = '22023';
      END IF;
      IF NULLIF(btrim(COALESCE(v_guest->>'email', '')), '') IS NOT NULL
         AND (btrim(v_guest->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
           OR length(btrim(v_guest->>'email')) > 254) THEN
        RAISE EXCEPTION 'rsvp_guest_email_invalid' USING ERRCODE = '22023';
      END IF;
      IF v_guest ? 'phoneCountryIso'
         AND jsonb_typeof(v_guest->'phoneCountryIso') <> 'null'
         AND (jsonb_typeof(v_guest->'phoneCountryIso') <> 'string'
           OR (v_guest->>'phoneCountryIso') !~ '^[A-Z]{2}$') THEN
        RAISE EXCEPTION 'rsvp_guest_phone_country_invalid' USING ERRCODE = '22023';
      END IF;
      v_digits := regexp_replace(v_guest->>'phone', '\D', '', 'g');
      IF v_digits = ANY (v_own) THEN
        RAISE EXCEPTION 'rsvp_guest_own_number' USING ERRCODE = '22023';
      END IF;
      IF v_digits = ANY (v_seen) THEN
        RAISE EXCEPTION 'rsvp_guest_duplicate' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.rsvp_guest_releases rel
         WHERE rel.event_id = p_event_id AND rel.phone_digits = v_digits
      ) THEN
        RAISE EXCEPTION 'rsvp_guest_released' USING ERRCODE = '22023';
      END IF;
      v_seen := v_seen || v_digits;
    END LOOP;
  END IF;

  -- #4508 2.5: guests a claimed guest brought ride on this party's count.
  IF p_user_id IS NOT NULL AND p_rsvp_status <> 'not_going' THEN
    SELECT count(*)::integer INTO v_brought
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
     WHERE r.event_id = p_event_id AND r.user_id = p_user_id
       AND g.brought_by_guest_id IS NOT NULL;
  END IF;

  -- 4. Resolve approval + attendance (UNCHANGED from ORCH-1150 maybe version).
  v_approval := CASE WHEN v_event.rsvp_approval_mode = 'manual' THEN 'pending' ELSE 'approved' END;

  IF p_rsvp_status = 'not_going' THEN
    v_status := 'not_going';
  ELSIF p_rsvp_status = 'maybe' THEN
    v_status := 'maybe';
    v_approval := 'approved';
  ELSIF v_event.rsvp_capacity IS NULL THEN
    v_status := 'going';
  ELSE
    SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND (p_user_id IS NULL OR r.user_id IS DISTINCT FROM p_user_id);
    IF (v_confirmed + 1 + v_plus + v_brought) > v_event.rsvp_capacity THEN
      IF v_event.rsvp_approval_mode = 'manual' THEN
        v_status := 'going';
      ELSIF v_event.rsvp_waitlist_enabled THEN
        v_status := 'waitlisted';
        v_approval := 'approved';
      ELSE
        RAISE EXCEPTION 'rsvp_full';
      END IF;
    ELSE
      v_status := 'going';
    END IF;
  END IF;

  -- 5. UPSERT the parent row.
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND user_id = p_user_id;
  ELSIF NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND lower(guest_email) = lower(btrim(p_guest_email));
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.event_rsvps
       SET rsvp_status = v_status,
           approval_status = v_approval,
           plus_count = v_plus,
           guest_name = v_name,
           guest_email = COALESCE(NULLIF(btrim(p_guest_email), ''), guest_email),
           guest_phone = COALESCE(NULLIF(btrim(p_guest_phone), ''), guest_phone),
           guest_phone_country_iso = CASE WHEN NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN guest_phone_country_iso ELSE p_guest_phone_country_iso END,
           waitlisted_at = CASE WHEN v_status = 'waitlisted' THEN COALESCE(waitlisted_at, now()) ELSE NULL END
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.event_rsvps
      (event_id, user_id, guest_name, guest_email, guest_phone, guest_phone_country_iso,
       rsvp_status, approval_status, plus_count, waitlisted_at)
    VALUES
      (p_event_id, p_user_id, v_name,
       NULLIF(btrim(p_guest_email), ''), NULLIF(btrim(p_guest_phone), ''), p_guest_phone_country_iso,
       v_status, v_approval, v_plus,
       CASE WHEN v_status = 'waitlisted' THEN now() ELSE NULL END)
    RETURNING id INTO v_existing_id;
  END IF;

  -- 6. #4508: the guest child set. A guest whose number is still listed keeps
  --    its row (claim, pass and texts survive a re-submit); a number no longer
  --    listed is removed; a new number is added. Guests a claimed guest
  --    brought stay unless the party is no longer going or maybe.
  DELETE FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = v_existing_id
     AND (v_status = 'not_going'
       OR (g.brought_by_guest_id IS NULL
         AND regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') <> ALL (v_seen)));

  v_inviter_key := CASE
    WHEN p_user_id IS NOT NULL THEN 'user:' || p_user_id::text
    ELSE 'phone:' || regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g')
  END;

  IF jsonb_array_length(COALESCE(p_guests, '[]'::jsonb)) > 0 THEN
    FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
      v_gname  := NULLIF(btrim(COALESCE(v_guest->>'name', '')), '');
      v_gemail := NULLIF(btrim(COALESCE(v_guest->>'email', '')), '');
      v_gphone := btrim(v_guest->>'phone');
      v_digits := regexp_replace(v_gphone, '\D', '', 'g');
      v_gphone_country_iso := NULLIF(v_guest->>'phoneCountryIso','');

      SELECT * INTO v_kept FROM public.event_rsvp_guests g
       WHERE g.rsvp_id = v_existing_id AND g.brought_by_guest_id IS NULL
         AND regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = v_digits
       ORDER BY g.created_at
       LIMIT 1;
      IF FOUND THEN
        UPDATE public.event_rsvp_guests
           SET name = COALESCE(v_gname, name),
               email = COALESCE(v_gemail, email),
               phone_country_iso = COALESCE(v_gphone_country_iso, phone_country_iso)
         WHERE id = v_kept.id;
        v_guest_id := v_kept.id;
        v_qr := v_kept.qr_code;
      ELSE
        IF public.rsvp_number_on_event_list(p_event_id, v_digits, v_existing_id) THEN
          RAISE EXCEPTION 'rsvp_guest_already_listed' USING ERRCODE = '22023';
        END IF;
        -- #4508 0.2: never the primary's own account.
        v_match := NULLIF(public.biz_resolve_verified_user(v_gemail, v_gphone), p_user_id);
        IF v_match IS NOT NULL
           AND public.rsvp_user_on_event_list(p_event_id, v_match, v_existing_id) THEN
          RAISE EXCEPTION 'rsvp_guest_already_listed' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.event_rsvp_guests (rsvp_id, name, email, phone, phone_country_iso,
          matched_user_id, invited_by_user_id)
        VALUES (v_existing_id, v_gname, v_gemail, v_gphone, v_gphone_country_iso,
          v_match, p_user_id)
        RETURNING id INTO v_guest_id;
        INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
        VALUES (v_inviter_key, p_event_id, v_digits);
        v_new_count := v_new_count + 1;
        v_qr := NULL;
      END IF;

      -- Mint the per-guest signed pass ONLY on a going resolution.
      IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL AND v_qr IS NULL THEN
        SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
          FROM public.biz_rsvp_mint_qr(v_guest_id, p_qr_token_pepper) m;
        UPDATE public.event_rsvp_guests
           SET qr_token_hash = v_token_hash, qr_code = v_qr
         WHERE id = v_guest_id;
      END IF;
    END LOOP;
  END IF;

  -- #4508 1.9: at most 20 guest numbers per inviter per rolling 24 hours.
  IF v_new_count > 0 THEN
    SELECT count(*)::integer INTO v_recent
      FROM public.rsvp_guest_invite_log l
     WHERE l.inviter_key = v_inviter_key
       AND l.created_at > now() - interval '24 hours';
    IF v_recent > 20 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4508', MESSAGE = 'rsvp_guest_daily_cap';
    END IF;
  END IF;

  -- #4508: plus_count is the party's guest rows (the primary's and any a
  -- claimed guest brought).
  UPDATE public.event_rsvps
     SET plus_count = (SELECT count(*)::integer FROM public.event_rsvp_guests g
                        WHERE g.rsvp_id = v_existing_id)
   WHERE id = v_existing_id;

  -- 7. Mint the PRIMARY's signed pass ONLY for going, idempotent on qr_token_hash.
  v_primary_qr := NULL;
  IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
    SELECT qr_code INTO v_primary_qr FROM public.event_rsvps
     WHERE id = v_existing_id AND qr_token_hash IS NOT NULL;
    IF v_primary_qr IS NULL THEN
      SELECT m.token_hash, m.qr_code INTO v_token_hash, v_primary_qr
        FROM public.biz_rsvp_mint_qr(v_existing_id, p_qr_token_pepper) m;
      UPDATE public.event_rsvps
         SET qr_token_hash = v_token_hash, qr_code = v_primary_qr
       WHERE id = v_existing_id;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'guestId', g.id,
           'phoneLast4', right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 4),
           'onMingla', g.matched_user_id IS NOT NULL,
           'displayName', public.rsvp_guest_display_name(g.id),
           'claimed', g.claimed_at IS NOT NULL,
           'broughtByGuest', g.brought_by_guest_id IS NOT NULL
         ) ORDER BY g.created_at, g.id), '[]'::jsonb)
    INTO v_guests_out
    FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = v_existing_id;

  RETURN jsonb_build_object(
    'rsvpId', v_existing_id,
    'status', v_status,
    'approvalStatus', v_approval,
    'capacityFull', (v_status = 'waitlisted'),
    'confirmationToken', v_primary_qr,
    'guests', v_guests_out
  );
END;
$$;

COMMENT ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) IS '#4063: an anonymous submission never changes an RSVP that already exists for that email. I-4063-RSVP-SUBMIT-GUARD. #4508: number-only guests, server plus-one limit, own/duplicate/listed/released numbers refused, 20 guest numbers per inviter per 24h, guest rows kept across re-submits.';

REVOKE ALL ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) TO service_role;


-- ---------------------------------------------------------------------------
-- 6. The guest link: resolve, release ("This isn't me"), claim, bring.
--    The token is the guest's claim-link code (claim_links, subject
--    rsvp_guest, the /c/ link texted to the guest). A code identifies a guest
--    for display; it never grants ownership: claiming needs a proven number.
--    All four are service_role only; the claim-link edge function calls them
--    (rate limits, and the signed-in user id from the verified JWT).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_guest_for_code(p_code text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT l.subject_id FROM public.claim_links l
   WHERE l.code = upper(btrim(coalesce(p_code, '')))
     AND l.purpose = 'claim' AND l.subject_kind = 'rsvp_guest'
     AND l.revoked_at IS NULL
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_for_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_for_code(text) TO service_role;

CREATE OR REPLACE FUNCTION public.rsvp_guest_resolve(p_code text, p_viewer uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_event record;
  v_inviter record;
  v_status text;
  v_release public.rsvp_guest_releases%ROWTYPE;
BEGIN
  IF upper(btrim(coalesce(p_code, ''))) !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_guest FROM public.event_rsvp_guests
   WHERE id = public.rsvp_guest_for_code(p_code);
  IF NOT FOUND THEN
    SELECT * INTO v_release FROM public.rsvp_guest_releases
     WHERE claim_code = upper(btrim(p_code)) LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('status', 'released'); END IF;
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id;
  SELECT e.id, e.title, e.slug, e.status, e.deleted_at, e.location_text, e.visibility,
         e.timezone, b.name AS brand_name, b.slug AS brand_slug,
         md.start_at, md.end_at, md.timezone AS date_timezone
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN LATERAL (
      SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
       WHERE d.event_id = e.id AND d.is_master IS TRUE
       ORDER BY d.start_at, d.id LIMIT 1
    ) md ON true
   WHERE e.id = v_rsvp.event_id;
  SELECT * INTO v_inviter FROM public.rsvp_guest_inviter_names(v_guest.id);

  v_status := CASE
    WHEN v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
      OR coalesce(v_event.end_at, v_event.start_at) < now() THEN 'ended'
    WHEN v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN 'not_eligible'
    WHEN v_guest.claimed_at IS NOT NULL THEN 'claimed'
    ELSE 'open'
  END;

  RETURN jsonb_build_object(
    'status', v_status,
    'guestId', v_guest.id,
    'rsvpId', v_rsvp.id,
    'inviterName', coalesce(v_inviter.label, 'A friend'),
    'inviterFirstName', v_inviter.first_name,
    'inviterHasAccount', v_inviter.inviter_user_id IS NOT NULL,
    'phoneLast4', right(regexp_replace(coalesce(v_guest.phone, ''), '\D', '', 'g'), 4),
    'claimedByViewer', p_viewer IS NOT NULL AND v_guest.claimed_at IS NOT NULL
      AND v_guest.matched_user_id = p_viewer,
    'viewerCanClaim', p_viewer IS NOT NULL AND v_status = 'open'
      AND p_viewer IS DISTINCT FROM v_rsvp.user_id
      AND p_viewer IS DISTINCT FROM v_inviter.inviter_user_id
      AND public.account_owns_contact(p_viewer, NULL, v_guest.phone),
    'viewerIsInviter', p_viewer IS NOT NULL
      AND (p_viewer = v_rsvp.user_id OR p_viewer = v_inviter.inviter_user_id),
    'event', jsonb_build_object(
      'id', v_event.id,
      'title', v_event.title,
      'startsAt', v_event.start_at,
      'endsAt', v_event.end_at,
      'timezone', coalesce(v_event.date_timezone, v_event.timezone),
      'venueLine', v_event.location_text,
      'brandName', v_event.brand_name,
      'eventUrl', CASE WHEN v_event.brand_slug IS NOT NULL AND v_event.slug IS NOT NULL
        THEN 'https://host.usemingla.com/e/' || v_event.brand_slug || '/' || v_event.slug END
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_resolve(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_resolve(text, uuid) TO service_role;

-- 1.18 "This isn't me": frees the spot, stops texts to the number for this
-- event, and returns the inviter so the caller can tell them in-app.
CREATE OR REPLACE FUNCTION public.rsvp_guest_release(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_inviter record;
  v_title text;
  v_digits text;
BEGIN
  SELECT * INTO v_guest FROM public.event_rsvp_guests
   WHERE id = public.rsvp_guest_for_code(p_code)
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.rsvp_guest_releases
                WHERE claim_code = upper(btrim(coalesce(p_code, ''))))
    THEN RETURN jsonb_build_object('outcome', 'already_released'); END IF;
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_guest.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_claimed');
  END IF;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id FOR UPDATE;
  SELECT * INTO v_inviter FROM public.rsvp_guest_inviter_names(v_guest.id);
  SELECT title INTO v_title FROM public.events WHERE id = v_rsvp.event_id;
  v_digits := regexp_replace(coalesce(v_guest.phone, ''), '\D', '', 'g');

  INSERT INTO public.rsvp_guest_releases(event_id, rsvp_id, phone_digits,
    inviter_user_id, claim_code)
  VALUES (v_rsvp.event_id, v_rsvp.id, v_digits, v_inviter.inviter_user_id,
    upper(btrim(p_code)))
  ON CONFLICT (event_id, phone_digits) DO UPDATE
    SET released_at = now(), claim_code = EXCLUDED.claim_code;

  -- No further texts: every queued delivery for this guest is closed.
  UPDATE public.rsvp_notification_deliveries d
     SET status = 'failed_terminal', safe_error_code = 'rsvp_guest_released',
         processing_started_at = NULL, lease_id = NULL, updated_at = now()
    FROM public.rsvp_notifications n
   WHERE d.notification_id = n.id
     AND n.payload->>'guestId' = v_guest.id::text
     AND d.status IN ('pending', 'failed_retryable', 'deferred');
  UPDATE public.claim_links SET revoked_at = now()
   WHERE purpose = 'claim' AND subject_kind = 'rsvp_guest'
     AND subject_id = v_guest.id AND revoked_at IS NULL;

  DELETE FROM public.event_rsvp_guests WHERE id = v_guest.id;
  UPDATE public.event_rsvps
     SET plus_count = (SELECT count(*)::integer FROM public.event_rsvp_guests g
                        WHERE g.rsvp_id = v_rsvp.id)
   WHERE id = v_rsvp.id;

  RETURN jsonb_build_object(
    'outcome', 'released',
    'eventId', v_rsvp.event_id,
    'eventTitle', v_title,
    'inviterUserId', v_inviter.inviter_user_id,
    'phoneLast4', right(v_digits, 4)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_release(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_release(text) TO service_role;

-- 1.19-1.22 Claim. One tap when the account has proved the invited number
-- (a code received at it: the possession ledger or a confirmed GoTrue phone);
-- otherwise phone_unproved, and the app proves the number with send-otp /
-- verify-otp first. A code proved for a DIFFERENT number never claims.
CREATE OR REPLACE FUNCTION public.rsvp_guest_claim(
  p_user_id uuid, p_code text, p_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_inviter record;
  v_name text := NULLIF(btrim(coalesce(p_name, '')), '');
  v_friend jsonb;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim' USING ERRCODE = '22023'; END IF;
  IF v_name IS NOT NULL AND length(v_name) > 120 THEN
    RAISE EXCEPTION 'rsvp_guest_name_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_guest FROM public.event_rsvp_guests
   WHERE id = public.rsvp_guest_for_code(p_code)
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.rsvp_guest_releases
                WHERE claim_code = upper(btrim(coalesce(p_code, ''))))
    THEN RETURN jsonb_build_object('outcome', 'released'); END IF;
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id;
  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id;
  IF v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
     OR v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
    RETURN jsonb_build_object('outcome', 'ineligible');
  END IF;
  IF v_guest.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_guest.matched_user_id = p_user_id
        THEN 'already_claimed' ELSE 'claimed_by_other' END,
      'guestId', v_guest.id, 'rsvpId', v_rsvp.id, 'eventId', v_rsvp.event_id);
  END IF;
  SELECT * INTO v_inviter FROM public.rsvp_guest_inviter_names(v_guest.id);
  IF p_user_id = v_rsvp.user_id OR p_user_id = v_inviter.inviter_user_id THEN
    RETURN jsonb_build_object('outcome', 'own_party');
  END IF;
  IF public.rsvp_user_on_event_list(v_rsvp.event_id, p_user_id, NULL)
     AND v_guest.matched_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('outcome', 'already_on_list');
  END IF;
  IF NOT public.account_owns_contact(p_user_id, NULL, v_guest.phone) THEN
    RETURN jsonb_build_object(
      'outcome', 'phone_unproved',
      'phoneLast4', right(regexp_replace(coalesce(v_guest.phone, ''), '\D', '', 'g'), 4));
  END IF;
  IF v_guest.matched_user_id IS NOT NULL AND v_guest.matched_user_id <> p_user_id THEN
    RAISE EXCEPTION 'conflict_rsvp_guest_claim' USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.event_rsvp_guests
     SET matched_user_id = p_user_id,
         claimed_at = now(),
         name = COALESCE(v_name, name)
   WHERE id = v_guest.id;

  -- 1.21 Only now: friends and close friends, free (D1, D2).
  v_friend := public.issue_4508_connect_rsvp_pair(
    v_inviter.inviter_user_id, p_user_id, v_guest.id, v_rsvp.event_id);

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'guestId', v_guest.id,
    'rsvpId', v_rsvp.id,
    'eventId', v_rsvp.event_id,
    'inviterUserId', v_inviter.inviter_user_id,
    'inviterName', coalesce(v_inviter.label, 'A friend'),
    'friendship', v_friend->>'friendship',
    'closeFriend', coalesce((v_friend->>'closeFriend')::boolean, false)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_claim(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_claim(uuid, text, text) TO service_role;

-- Amendment 4: the live match under the number field. Signed-out callers get
-- only yes/no (never a name). Blocks hide the account either way.
CREATE OR REPLACE FUNCTION public.rsvp_guest_lookup(
  p_viewer uuid, p_event_id uuid, p_phone text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_user uuid;
  v_profile jsonb;
  v_listed boolean;
BEGIN
  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  IF p_viewer IS NOT NULL AND v_digits = ANY (public.rsvp_account_phone_digits(p_viewer)) THEN
    RETURN jsonb_build_object('valid', true, 'isYou', true, 'onMingla', true,
      'alreadyOnList', false, 'released', false);
  END IF;
  v_user := public.biz_resolve_verified_user(NULL, v_phone);
  IF v_user IS NOT NULL AND p_viewer IS NOT NULL AND (
    public.has_block_between(p_viewer, v_user) OR EXISTS (
      SELECT 1 FROM public.friends f
       WHERE f.status = 'blocked' AND f.deleted_at IS NULL
         AND ((f.user_id = p_viewer AND f.friend_user_id = v_user)
           OR (f.user_id = v_user AND f.friend_user_id = p_viewer)))
  ) THEN
    v_user := NULL;
  END IF;
  v_listed := p_event_id IS NOT NULL AND (
    public.rsvp_number_on_event_list(p_event_id, v_digits, (
      SELECT r.id FROM public.event_rsvps r
       WHERE r.event_id = p_event_id AND r.user_id = p_viewer LIMIT 1))
    OR (v_user IS NOT NULL AND public.rsvp_user_on_event_list(p_event_id, v_user, (
      SELECT r.id FROM public.event_rsvps r
       WHERE r.event_id = p_event_id AND r.user_id = p_viewer LIMIT 1))));
  IF v_user IS NOT NULL AND p_viewer IS NOT NULL THEN
    SELECT jsonb_build_object(
             'id', p.id,
             'displayName', coalesce(NULLIF(btrim(p.display_name), ''),
               NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')),
             'username', p.username,
             'avatarUrl', p.avatar_url)
      INTO v_profile FROM public.profiles p WHERE p.id = v_user;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'valid', true,
    'isYou', false,
    'onMingla', v_user IS NOT NULL,
    'alreadyOnList', coalesce(v_listed, false),
    'released', p_event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.rsvp_guest_releases rel
       WHERE rel.event_id = p_event_id AND rel.phone_digits = v_digits),
    'user', v_profile
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_lookup(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_lookup(uuid, uuid, text) TO service_role;

-- 2.5 A claimed guest brings one more person (host setting, default off).
CREATE OR REPLACE FUNCTION public.rsvp_guest_bring(
  p_user_id uuid, p_guest_id uuid, p_phone text, p_phone_country_iso text,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_confirmed integer;
  v_new uuid;
  v_token_hash text;
  v_qr text;
  v_recent integer;
BEGIN
  IF p_user_id IS NULL OR p_guest_id IS NULL THEN
    RAISE EXCEPTION 'invalid_claim' USING ERRCODE = '22023';
  END IF;
  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'rsvp_guest_phone_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_phone_country_iso IS NOT NULL AND p_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'rsvp_guest_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  v_digits := regexp_replace(v_phone, '\D', '', 'g');

  SELECT r.* INTO v_rsvp FROM public.event_rsvps r
    JOIN public.event_rsvp_guests g ON g.rsvp_id = r.id
   WHERE g.id = p_guest_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  -- Same lock order as submit_event_rsvp: the event first.
  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id FOR UPDATE;
  SELECT * INTO v_guest FROM public.event_rsvp_guests WHERE id = p_guest_id FOR UPDATE;
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = v_guest.rsvp_id FOR UPDATE;

  IF v_guest.matched_user_id IS DISTINCT FROM p_user_id OR v_guest.claimed_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_your_pass');
  END IF;
  IF NOT v_event.rsvp_guests_can_bring THEN
    RETURN jsonb_build_object('outcome', 'not_allowed');
  END IF;
  IF v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
     OR v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
    RETURN jsonb_build_object('outcome', 'ineligible');
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_rsvp_guests b WHERE b.brought_by_guest_id = v_guest.id) THEN
    RETURN jsonb_build_object('outcome', 'already_brought');
  END IF;
  IF v_digits = ANY (public.rsvp_account_phone_digits(p_user_id)) THEN
    RAISE EXCEPTION 'rsvp_guest_own_number' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rsvp_guest_releases rel
              WHERE rel.event_id = v_event.id AND rel.phone_digits = v_digits) THEN
    RAISE EXCEPTION 'rsvp_guest_released' USING ERRCODE = '22023';
  END IF;
  IF public.rsvp_number_on_event_list(v_event.id, v_digits, NULL) THEN
    RAISE EXCEPTION 'rsvp_guest_already_listed' USING ERRCODE = '22023';
  END IF;
  IF v_event.rsvp_capacity IS NOT NULL THEN
    SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
      FROM public.event_rsvps r
     WHERE r.event_id = v_event.id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved';
    IF v_confirmed + 1 > v_event.rsvp_capacity THEN
      RETURN jsonb_build_object('outcome', 'rsvp_full');
    END IF;
  END IF;

  INSERT INTO public.event_rsvp_guests (rsvp_id, phone, phone_country_iso,
    matched_user_id, invited_by_user_id, brought_by_guest_id)
  VALUES (v_rsvp.id, v_phone, p_phone_country_iso,
    NULLIF(NULLIF(public.biz_resolve_verified_user(NULL, v_phone), p_user_id), v_rsvp.user_id),
    p_user_id, v_guest.id)
  RETURNING id INTO v_new;
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  VALUES ('user:' || p_user_id::text, v_event.id, v_digits);
  SELECT count(*)::integer INTO v_recent FROM public.rsvp_guest_invite_log l
   WHERE l.inviter_key = 'user:' || p_user_id::text
     AND l.created_at > now() - interval '24 hours';
  IF v_recent > 20 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4508', MESSAGE = 'rsvp_guest_daily_cap';
  END IF;
  IF p_qr_token_pepper IS NOT NULL THEN
    SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
      FROM public.biz_rsvp_mint_qr(v_new, p_qr_token_pepper) m;
    UPDATE public.event_rsvp_guests SET qr_token_hash = v_token_hash, qr_code = v_qr
     WHERE id = v_new;
  END IF;
  UPDATE public.event_rsvps
     SET plus_count = (SELECT count(*)::integer FROM public.event_rsvp_guests g
                        WHERE g.rsvp_id = v_rsvp.id)
   WHERE id = v_rsvp.id;
  -- The new guest's pass text (idempotent per guest).
  PERFORM public.enqueue_rsvp_pass(v_rsvp.id, p_qr_token_pepper);
  RETURN jsonb_build_object('outcome', 'added', 'guestId', v_new, 'rsvpId', v_rsvp.id,
    'eventId', v_event.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_bring(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_bring(uuid, uuid, text, text, text) TO service_role;

-- What rsvp-notify needs to write a guest's invite or reminder text.
CREATE OR REPLACE FUNCTION public.rsvp_guest_message_context(p_guest_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN g.id IS NULL THEN jsonb_build_object('exists', false)
  ELSE jsonb_build_object(
    'exists', true,
    'claimed', g.claimed_at IS NOT NULL,
    'guestId', g.id,
    'rsvpId', r.id,
    'eventId', e.id,
    'eventTitle', e.title,
    'eventStartAt', md.start_at,
    'eventTimezone', coalesce(md.timezone, e.timezone),
    'inviterLabel', coalesce(n.label, 'A friend'),
    'inviterFirstName', n.first_name,
    'eligible', r.rsvp_status = 'going' AND r.approval_status = 'approved'
      AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
  ) END
    FROM (SELECT p_guest_id AS id) q
    LEFT JOIN public.event_rsvp_guests g ON g.id = q.id
    LEFT JOIN public.event_rsvps r ON r.id = g.rsvp_id
    LEFT JOIN public.events e ON e.id = r.event_id
    LEFT JOIN LATERAL (
      SELECT d.start_at, d.timezone FROM public.event_dates d
       WHERE d.event_id = e.id AND d.is_master IS TRUE
       ORDER BY d.start_at, d.id LIMIT 1
    ) md ON true
    LEFT JOIN LATERAL public.rsvp_guest_inviter_names(g.id) n ON true;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_guest_message_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_guest_message_context(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. 2.1 Reminder: one text 23-24 hours before the start to a guest who has
--    not claimed and whose invite text was delivered. Idempotency key per
--    guest = at most one, ever. Rides the existing RSVP queue; the existing
--    every-minute rsvp-notify tick calls this before claiming deliveries.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_enqueue_guest_reminders(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rsvp_notifications
    (event_id, rsvp_id, channel, recipient, status, template_key, payload,
     idempotency_key, attempt_count)
  SELECT r.event_id, r.id, NULL, NULL, 'pending', 'rsvp_guest_reminder',
         jsonb_build_object(
           'template_key', 'rsvp_guest_reminder',
           'rsvp_id', r.id,
           'event_id', r.event_id,
           'guestId', g.id,
           'role', 'guest',
           'eventName', e.title,
           'brandId', e.brand_id
         ),
         'rsvp_guest_reminder:' || g.id::text, 0
    FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id = g.rsvp_id
    JOIN public.events e ON e.id = r.event_id
    JOIN LATERAL (
      SELECT d.start_at FROM public.event_dates d
       WHERE d.event_id = e.id AND d.is_master IS TRUE
       ORDER BY d.start_at, d.id LIMIT 1
    ) md ON true
   WHERE g.claimed_at IS NULL
     AND g.phone ~ '^\+[1-9][0-9]{7,14}$'
     AND g.created_at < now() - interval '6 hours'
     AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
     AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
     AND md.start_at > now() + interval '23 hours'
     AND md.start_at <= now() + interval '24 hours'
     AND EXISTS (
       SELECT 1 FROM public.rsvp_notifications n
         JOIN public.rsvp_notification_deliveries d
           ON d.notification_id = n.id AND d.channel = 'sms' AND d.status = 'sent'
        WHERE n.rsvp_id = r.id AND n.payload->>'guestId' = g.id::text
          AND n.template_key IN ('rsvp_pass', 'rsvp_approved', 'rsvp_waitlist_promoted')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.rsvp_notifications x
        WHERE x.idempotency_key = 'rsvp_guest_reminder:' || g.id::text
     )
   ORDER BY md.start_at, g.id
   LIMIT LEAST(GREATEST(coalesce(p_limit, 200), 1), 500)
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.rsvp_enqueue_guest_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_enqueue_guest_reminders(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. 2.3 Friends see where you're going. When someone is going (approved)
--    with "Show me as going" on, each close friend gets one notice per event,
--    unless that friend turned friends_going off, is already on the list, or
--    either blocked the other. Never blocks the RSVP write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_issue_4508_friend_going()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.user_id IS NULL OR NEW.rsvp_status <> 'going'
     OR NEW.approval_status <> 'approved' OR NOT NEW.show_me_as_going THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND OLD.rsvp_status = 'going' AND OLD.approval_status = 'approved'
     AND OLD.show_me_as_going THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO public.rsvp_friend_going_notices(event_id, actor_user_id, friend_user_id)
    SELECT NEW.event_id, NEW.user_id, f.other
      FROM (
        SELECT CASE WHEN p.user_a_id = NEW.user_id THEN p.user_b_id ELSE p.user_a_id END AS other
          FROM public.pairings p
         WHERE NEW.user_id IN (p.user_a_id, p.user_b_id)
      ) f
      JOIN public.events e ON e.id = NEW.event_id
     WHERE e.visibility = 'public' AND e.deleted_at IS NULL
       AND e.status IN ('scheduled', 'live')
       AND EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.event_id = e.id AND d.start_at > now())
       AND NOT public.has_block_between(NEW.user_id, f.other)
       AND NOT public.rsvp_user_on_event_list(NEW.event_id, f.other, NULL)
       AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np
                        WHERE np.user_id = f.other
                          AND (np.friends_going = false OR np.push_enabled = false))
    ON CONFLICT (event_id, friend_user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_4508_friend_going_enqueue_failed event=%', NEW.event_id;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_issue_4508_friend_going() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4508_friend_going ON public.event_rsvps;
CREATE TRIGGER issue_4508_friend_going
AFTER INSERT OR UPDATE OF rsvp_status, approval_status, show_me_as_going, user_id
ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4508_friend_going();

-- Taken at most once (status pending -> taken in the same statement that
-- returns it), re-checking the friend's preference and list at send time.
CREATE OR REPLACE FUNCTION public.issue_4508_take_friend_going_notices(p_limit integer DEFAULT 50)
RETURNS TABLE (notice_id uuid, event_id uuid, friend_user_id uuid, actor_user_id uuid,
  actor_name text, event_title text, send boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT n.id FROM public.rsvp_friend_going_notices n
     WHERE n.status = 'pending'
     ORDER BY n.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
  ), taken AS (
    UPDATE public.rsvp_friend_going_notices n
       SET status = 'taken', taken_at = now()
      FROM due WHERE n.id = due.id
    RETURNING n.*
  )
  SELECT t.id, t.event_id, t.friend_user_id, t.actor_user_id,
         coalesce(NULLIF(btrim(p.first_name), ''),
           NULLIF(split_part(btrim(coalesce(p.display_name, '')), ' ', 1), ''),
           NULLIF(btrim(p.username), ''), 'A friend'),
         e.title,
         (e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
           AND NOT public.rsvp_user_on_event_list(t.event_id, t.friend_user_id, NULL)
           AND NOT public.has_block_between(t.actor_user_id, t.friend_user_id)
           AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np
                            WHERE np.user_id = t.friend_user_id
                              AND (np.friends_going = false OR np.push_enabled = false))
           AND EXISTS (SELECT 1 FROM public.event_rsvps r
                        WHERE r.event_id = t.event_id AND r.user_id = t.actor_user_id
                          AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
                          AND r.show_me_as_going))
    FROM taken t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p ON p.id = t.actor_user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4508_take_friend_going_notices(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4508_take_friend_going_notices(integer) TO service_role;


-- ---------------------------------------------------------------------------
-- 9. Readers (1.11, 1.24, 1.25, 1.26).
-- fetch_user_rsvp_party_passes (20270204001447 lines 486-529): same rows and
-- grants; the guest name follows 1.11, and each row adds claimed, invited_by,
-- the invite text status and the guest's invite link. Only the party's
-- primary sees a guest's invite link and status (the Nudge and the success
-- screen); a matched guest sees only their own row, as before.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fetch_user_rsvp_party_passes(uuid);
CREATE FUNCTION public.fetch_user_rsvp_party_passes(p_rsvp_id uuid)
RETURNS TABLE (
  entity_type text,
  entity_id uuid,
  display_name text,
  qr_code text,
  claimed boolean,
  invited_by_name text,
  invite_status text,
  invite_link text,
  phone_last4 text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $function$
  SELECT 'primary'::text, r.id,
         COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(r.guest_name,'Guest'),r.guest_name),
         r.qr_code,
         true, NULL::text, NULL::text, NULL::text, NULL::text
    FROM public.event_rsvps r
    JOIN public.events e ON e.id=r.event_id
    LEFT JOIN public.profiles p ON p.id=r.user_id
   WHERE r.id=p_rsvp_id
     AND r.user_id=auth.uid()
     AND r.rsvp_status='going'
     AND r.approval_status='approved'
     AND r.qr_code IS NOT NULL
     AND e.deleted_at IS NULL
     AND e.status<>'cancelled'
  UNION ALL
  SELECT 'guest'::text, g.id,
         public.rsvp_guest_display_name(g.id),
         g.qr_code,
         g.claimed_at IS NOT NULL,
         (SELECT n.label FROM public.rsvp_guest_inviter_names(g.id) n),
         CASE WHEN r.user_id=auth.uid() THEN public.rsvp_guest_invite_status(g.id) END,
         CASE WHEN r.user_id=auth.uid() THEN (
           SELECT 'https://usemingla.com/c/' || l.code FROM public.claim_links l
            WHERE l.purpose='claim' AND l.subject_kind='rsvp_guest'
              AND l.subject_id=g.id AND l.revoked_at IS NULL
            ORDER BY l.created_at DESC LIMIT 1) END,
         CASE WHEN r.user_id=auth.uid()
           THEN right(regexp_replace(coalesce(g.phone,''),'\D','','g'),4) END
    FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id=g.rsvp_id
    JOIN public.events e ON e.id=r.event_id
   WHERE r.id=p_rsvp_id
     AND (r.user_id=auth.uid() OR g.matched_user_id=auth.uid())
     AND r.rsvp_status='going'
     AND r.approval_status='approved'
     AND g.qr_code IS NOT NULL
     AND e.deleted_at IS NULL
     AND e.status<>'cancelled'
   ORDER BY 1 DESC, 2;
$function$;
REVOKE ALL ON FUNCTION public.fetch_user_rsvp_party_passes(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_user_rsvp_party_passes(uuid)
  TO authenticated;


-- host_list_rsvp_guests (20270204001447 lines 650-679): only plus_checkins
-- changes: name follows 1.11 and each guest adds invitedByName, claimed,
-- onMingla and broughtByGuestId. Email columns may be empty for guests.
-- Host console: preserve existing 18-column contract and append check-in truth.
CREATE OR REPLACE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)
RETURNS TABLE (
  id uuid,event_id uuid,user_id uuid,guest_name text,guest_email text,guest_phone text,
  rsvp_status text,approval_status text,plus_count integer,waitlisted_at timestamptz,
  promoted_at timestamptz,created_at timestamptz,display_name text,username text,
  avatar_url text,email text,phone text,source text,checked_in_at timestamptz,
  checked_in_by uuid,plus_checked_in_count integer,plus_checkins jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND
    public.biz_brand_effective_rank(e.brand_id,auth.uid())>=public.biz_role_rank('event_manager'))
  THEN RAISE EXCEPTION 'insufficient_event_permission'; END IF;
  RETURN QUERY SELECT r.id,r.event_id,r.user_id,r.guest_name,r.guest_email,r.guest_phone,
    r.rsvp_status,r.approval_status,r.plus_count,r.waitlisted_at,r.promoted_at,r.created_at,
    COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(r.guest_name,'Guest'),r.guest_name),
    p.username,p.avatar_url,COALESCE(NULLIF(btrim(p.email),''),NULLIF(btrim(r.guest_email),'')),
    COALESCE(NULLIF(btrim(p.phone),''),NULLIF(btrim(r.guest_phone),'')),
    CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END,r.checked_in_at,r.checked_in_by,
    (SELECT count(*)::integer FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',public.rsvp_guest_display_name(g.id),
      'checkedInAt',g.checked_in_at,'checkedInBy',g.checked_in_by,
      'invitedByName',(SELECT n.label FROM public.rsvp_guest_inviter_names(g.id) n),
      'claimed',g.claimed_at IS NOT NULL,'onMingla',g.matched_user_id IS NOT NULL,
      'broughtByGuestId',g.brought_by_guest_id) ORDER BY g.created_at)
      FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id),'[]'::jsonb)
  FROM public.event_rsvps r LEFT JOIN public.profiles p ON p.id=r.user_id
  WHERE r.event_id=p_event_id ORDER BY
    CASE WHEN r.approval_status='pending' THEN 0 WHEN r.rsvp_status='going' AND r.approval_status='approved' THEN 1
      WHEN r.rsvp_status='waitlisted' THEN 2 WHEN r.rsvp_status='maybe' THEN 3 ELSE 4 END,r.created_at;
END;
$$;

-- biz_rsvp_scan (20270204001447): only attendeeDisplayName (1.11) and the
-- added invitedByName change.
CREATE OR REPLACE FUNCTION public.biz_rsvp_scan(p_event_id uuid, p_qr_payload text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  c_before constant interval := interval '120 minutes';
  c_after constant interval := interval '360 minutes';
  v_actor uuid := auth.uid(); v_match text[]; v_entity_id uuid;
  v_rsvp public.event_rsvps%ROWTYPE; v_guest public.event_rsvp_guests%ROWTYPE;
  v_event_id uuid; v_outcome text := 'not_found'; v_now timestamptz := now();
  v_next_start timestamptz; v_last_end timestamptz; v_scan_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND public.biz_brand_effective_rank(e.brand_id,v_actor)
        >= public.biz_role_rank('event_manager'))
    OR EXISTS (SELECT 1 FROM public.event_scanners es WHERE es.event_id=p_event_id
      AND es.user_id=v_actor AND es.removed_at IS NULL
      AND COALESCE((es.permissions->>'scan')::boolean,true))
    OR EXISTS (SELECT 1 FROM public.events e JOIN public.brand_team_members m ON m.brand_id=e.brand_id
      WHERE e.id=p_event_id AND m.user_id=v_actor AND m.role='scanner'
        AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'scanner_not_authorized'; END IF;

  v_match := regexp_match(COALESCE(p_qr_payload,''),
    '^mingla:v1:rsvp:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NOT NULL THEN
    v_entity_id := v_match[1]::uuid;
    SELECT * INTO v_rsvp FROM public.event_rsvps
      WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
    IF NOT FOUND THEN
      SELECT * INTO v_guest FROM public.event_rsvp_guests
        WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
      IF FOUND THEN SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id=v_guest.rsvp_id; END IF;
    END IF;
    IF v_rsvp.id IS NOT NULL THEN
      v_event_id := v_rsvp.event_id;
      IF v_event_id <> p_event_id THEN v_outcome := 'wrong_event';
      ELSIF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
        v_outcome := CASE WHEN v_rsvp.approval_status='denied' THEN 'revoked' ELSE 'not_eligible' END;
      ELSIF EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
        AND (e.deleted_at IS NOT NULL OR e.status='cancelled')) THEN v_outcome := 'revoked';
      ELSIF (CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END) IS NOT NULL
        THEN v_outcome := 'duplicate';
      ELSIF NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id) THEN v_outcome := 'success';
      ELSIF EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id
        AND v_now BETWEEN start_at-c_before AND end_at+c_after) THEN v_outcome := 'success';
      ELSE
        SELECT min(start_at) INTO v_next_start FROM public.event_dates
          WHERE event_id=p_event_id AND start_at-c_before > v_now;
        IF v_next_start IS NOT NULL THEN v_outcome := 'not_yet_open';
        ELSE v_outcome := 'event_ended';
          SELECT max(end_at) INTO v_last_end FROM public.event_dates WHERE event_id=p_event_id;
        END IF;
      END IF;
      IF v_outcome='success' THEN
        IF v_guest.id IS NOT NULL THEN UPDATE public.event_rsvp_guests
          SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_guest.id;
        ELSE UPDATE public.event_rsvps SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_rsvp.id;
        END IF;
      END IF;
    END IF;
  END IF;
  INSERT INTO public.rsvp_scan_events(requested_event_id,matched_event_id,rsvp_id,guest_id,
    scanner_user_id,outcome,metadata)
  VALUES(p_event_id,v_event_id,
    CASE WHEN v_guest.id IS NULL THEN v_rsvp.id ELSE NULL END,v_guest.id,v_actor,v_outcome,
    jsonb_strip_nulls(jsonb_build_object('source','scan-rsvp','nextStartAt',v_next_start,'lastEndAt',v_last_end)))
  RETURNING id INTO v_scan_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'result',v_outcome,'scanId',v_scan_id,
    'entityType',CASE WHEN v_outcome IN ('success','duplicate') THEN
      CASE WHEN v_guest.id IS NULL THEN 'primary' ELSE 'guest' END END,
    'entityId',CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(v_guest.id,v_rsvp.id) END,
    'attendeeDisplayName',CASE WHEN v_outcome IN ('success','duplicate') THEN
      CASE WHEN v_guest.id IS NOT NULL THEN public.rsvp_guest_display_name(v_guest.id)
        ELSE v_rsvp.guest_name END END,
    -- #4508 1.25: who brought an unclaimed guest, for the door.
    'invitedByName',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NOT NULL THEN
      (SELECT n.label FROM public.rsvp_guest_inviter_names(v_guest.id) n) END,
    'nextStartAt',v_next_start,'lastEndAt',v_last_end,'checkedInAt',
    CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END,v_now) END));
END;
$$;
REVOKE ALL ON FUNCTION public.biz_rsvp_scan(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_rsvp_scan(uuid,text) TO authenticated;

-- admin_list_event_rsvps (20261224000000): only plus_guests changes (1.26): the
-- 1.11 name, invitedByName and claimed. Guests may have no email.
CREATE OR REPLACE FUNCTION public.admin_list_event_rsvps(
  p_event_id uuid,
  p_limit    int DEFAULT 25,
  p_offset   int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total    bigint;
  v_rows     jsonb;
  v_counts   jsonb;
  v_capacity int;
  v_headcount bigint;
  v_limit    int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset   int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO v_total FROM public.event_rsvps r WHERE r.event_id = p_event_id;
  SELECT rsvp_capacity INTO v_capacity FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(sum(1 + COALESCE(r.plus_count, 0))
                  FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'), 0)
  INTO v_headcount
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  SELECT jsonb_build_object(
    'going',               count(*) FILTER (WHERE r.rsvp_status = 'going'),
    'not_going',           count(*) FILTER (WHERE r.rsvp_status = 'not_going'),
    'waitlisted',          count(*) FILTER (WHERE r.rsvp_status = 'waitlisted'),
    'maybe',               count(*) FILTER (WHERE r.rsvp_status = 'maybe'),
    'pending',             count(*) FILTER (WHERE r.approval_status = 'pending'),
    'approved',            count(*) FILTER (WHERE r.approval_status = 'approved'),
    'denied',              count(*) FILTER (WHERE r.approval_status = 'denied'),
    'confirmed_attending', count(*) FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'),
    'total_headcount',     v_headcount,
    'capacity',            v_capacity,
    'capacity_remaining',  CASE WHEN v_capacity IS NULL THEN NULL ELSE v_capacity - v_headcount END
  )
  INTO v_counts
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  -- ORCH-1334: LEFT JOIN profiles in the ranked CTE to resolve app-member identity
  -- (whitelisted columns only) + a source discriminator. The 'Guest' sentinel
  -- resolves to the real profile name at read time.
  WITH ranked AS (
    SELECT r.*,
           p.display_name AS profile_display_name,
           p.username     AS profile_username,
           p.avatar_url   AS profile_avatar_url,
           p.email        AS profile_email,
           p.phone        AS profile_phone,
           row_number() OVER (ORDER BY r.created_at DESC, r.id) AS rn
    FROM public.event_rsvps r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.event_id = p_event_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rsvp_id',         r.id,
      'guest_name',      r.guest_name,
      'guest_email',     r.guest_email,
      'guest_phone',     r.guest_phone,
      'user_id',         r.user_id,
      'rsvp_status',     r.rsvp_status,
      'approval_status', r.approval_status,
      'plus_count',      r.plus_count,
      'waitlisted_at',   r.waitlisted_at,
      'promoted_at',     r.promoted_at,
      'created_at',      r.created_at,
      -- ORCH-1334 appended identity/provenance keys (whitelisted profile columns).
      'display_name',    COALESCE(NULLIF(btrim(r.profile_display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name),
      'username',        r.profile_username,
      'avatar_url',      r.profile_avatar_url,
      'email',           COALESCE(NULLIF(btrim(r.profile_email), ''), NULLIF(btrim(r.guest_email), '')),
      'phone',           COALESCE(NULLIF(btrim(r.profile_phone), ''), NULLIF(btrim(r.guest_phone), '')),
      'source',          CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END,
      'plus_guests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', public.rsvp_guest_display_name(g.id), 'email', g.email, 'phone', g.phone,
          'invitedByName', (SELECT n.label FROM public.rsvp_guest_inviter_names(g.id) n),
          'claimed', g.claimed_at IS NOT NULL) ORDER BY g.created_at)
        FROM public.event_rsvp_guests g WHERE g.rsvp_id = r.id
      ), '[]'::jsonb)
    ) ORDER BY r.rn
  ), '[]'::jsonb)
  INTO v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0), 'counts', v_counts);
END;
$$;


-- get_user_circle (20260724000005): only tier_close and its combined row
-- change (1.23: source rsvp_guest, context the event, "through {event}").
-- Return shape unchanged, so CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION public.get_user_circle(
  p_viewer_user_id uuid,
  p_limit int DEFAULT 60,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  user_id                     uuid,
  tier                        text,
  display_name                text,
  username                    text,
  avatar_url                  text,
  has_business_app            boolean,
  relationship_source         text,
  relationship_label          text,
  relationship_context_type   text,
  relationship_context_id     uuid,
  relationship_context_title  text,
  relationship_source_count   int,
  sort_score                  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR v_caller <> p_viewer_user_id THEN
    RAISE EXCEPTION 'get_user_circle: unauthorized (caller=%, requested=%)', v_caller, p_viewer_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'get_user_circle: p_limit out of range (must be 1..200)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH
  consumer_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'consumer'
  ),
  dual_app_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'business'
  ),
  event_recency AS (
    SELECT
      ed.event_id,
      MAX(COALESCE(ed.end_at, ed.start_at)) AS event_at
    FROM public.event_dates ed
    GROUP BY ed.event_id
  ),
  tier_close AS (
    SELECT
      CASE WHEN p.user_a_id = p_viewer_user_id THEN p.user_b_id ELSE p.user_a_id END AS other_id,
      EXTRACT(EPOCH FROM p.created_at)::bigint * 1000 AS rel_created_ms,
      -- #4508 1.23: a close friend made through an RSVP carries the event.
      rc.event_id AS rsvp_event_id,
      CASE WHEN rc.event_id IS NULL THEN NULL
        WHEN rce.visibility IN ('public', 'discover') THEN rce.title
        ELSE 'a private event' END AS rsvp_event_title
    FROM public.pairings p
    LEFT JOIN LATERAL (
      SELECT c.event_id FROM public.rsvp_guest_connections c
       WHERE c.pairing_id = p.id ORDER BY c.created_at LIMIT 1
    ) rc ON true
    LEFT JOIN public.events rce ON rce.id = rc.event_id
    WHERE p_viewer_user_id IN (p.user_a_id, p.user_b_id)
  ),
  tier_friend AS (
    SELECT
      f.friend_user_id AS other_id,
      EXTRACT(EPOCH FROM f.updated_at)::bigint * 1000 AS rel_created_ms
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
      AND f.friend_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
  ),
  viewer_friends AS (
    SELECT f.friend_user_id AS fid
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
  ),
  viewer_events AS (
    SELECT DISTINCT o.event_id AS eid
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE o.buyer_user_id = p_viewer_user_id
      AND o.payment_status = 'paid'
      AND e.deleted_at IS NULL
      AND e.event_type IN ('event', 'trip')
  ),
  tier_fof_candidates AS (
    SELECT
      f2.friend_user_id AS other_id,
      f2.user_id AS mutual_friend_id,
      COALESCE(NULLIF(TRIM(pr.display_name), ''), NULLIF(TRIM(pr.username), ''), 'a friend') AS mutual_friend_name,
      EXTRACT(EPOCH FROM f2.updated_at)::bigint * 1000 AS rel_created_ms
    FROM public.friends f2
    JOIN public.profiles pr ON pr.id = f2.user_id
    WHERE f2.user_id IN (SELECT vf.fid FROM viewer_friends vf)
      AND f2.status = 'accepted'
      AND f2.deleted_at IS NULL
      AND f2.friend_user_id <> p_viewer_user_id
      AND f2.friend_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
      AND f2.friend_user_id NOT IN (SELECT tf.other_id FROM tier_friend tf)
  ),
  tier_fof_ranked AS (
    SELECT
      tfc.*,
      COUNT(*) OVER (PARTITION BY tfc.other_id)::int AS source_count,
      ROW_NUMBER() OVER (
        PARTITION BY tfc.other_id
        ORDER BY tfc.rel_created_ms DESC, LOWER(tfc.mutual_friend_name) ASC, tfc.mutual_friend_id ASC
      ) AS rn
    FROM tier_fof_candidates tfc
  ),
  tier_fof AS (
    SELECT
      tfr.other_id,
      tfr.rel_created_ms,
      tfr.mutual_friend_id,
      tfr.mutual_friend_name,
      tfr.source_count
    FROM tier_fof_ranked tfr
    WHERE tfr.rn = 1
  ),
  tier_coattendee_event_matches AS (
    SELECT
      o2.buyer_user_id AS other_id,
      e.id AS event_id,
      e.event_type,
      CASE
        WHEN e.visibility IN ('public', 'discover') THEN e.title
        WHEN e.event_type = 'trip' THEN 'Shared private trip'
        ELSE 'Shared private event'
      END AS safe_event_title,
      CASE
        WHEN e.event_type = 'trip' AND e.visibility IN ('public', 'discover') THEN 'Also joined ' || e.title
        WHEN e.event_type = 'trip' THEN 'Shared private trip'
        WHEN COALESCE(er.event_at, MAX(o2.created_at)) >= now() AND e.visibility IN ('public', 'discover')
          THEN 'Also going to ' || e.title
        WHEN COALESCE(er.event_at, MAX(o2.created_at)) >= now() THEN 'Shared private event'
        WHEN e.visibility IN ('public', 'discover') THEN 'Also attended ' || e.title
        ELSE 'Shared private event'
      END AS event_relationship_label,
      MAX(EXTRACT(EPOCH FROM COALESCE(er.event_at, o2.created_at))::bigint * 1000) AS rel_created_ms,
      COALESCE(er.event_at, MAX(o2.created_at)) AS event_at
    FROM public.orders o2
    JOIN public.events e ON e.id = o2.event_id
    LEFT JOIN event_recency er ON er.event_id = o2.event_id
    WHERE o2.event_id IN (SELECT ve.eid FROM viewer_events ve)
      AND e.deleted_at IS NULL
      AND e.event_type IN ('event', 'trip')
      AND o2.payment_status = 'paid'
      AND o2.buyer_user_id IS NOT NULL
      AND o2.buyer_user_id <> p_viewer_user_id
      AND o2.buyer_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
      AND o2.buyer_user_id NOT IN (SELECT tf.other_id FROM tier_friend tf)
    GROUP BY o2.buyer_user_id, e.id, e.event_type, e.title, e.visibility, er.event_at
  ),
  tier_coattendee_ranked AS (
    SELECT
      tcem.*,
      COUNT(*) OVER (PARTITION BY tcem.other_id)::int AS source_count,
      ROW_NUMBER() OVER (
        PARTITION BY tcem.other_id
        ORDER BY
          CASE WHEN tcem.event_at >= now() THEN 0 ELSE 1 END ASC,
          tcem.rel_created_ms DESC,
          LOWER(tcem.safe_event_title) ASC,
          tcem.event_id ASC
      ) AS rn
    FROM tier_coattendee_event_matches tcem
  ),
  tier_coattendee AS (
    SELECT
      tcr.other_id,
      tcr.rel_created_ms,
      tcr.event_id,
      tcr.event_type,
      tcr.safe_event_title,
      tcr.event_relationship_label,
      tcr.source_count
    FROM tier_coattendee_ranked tcr
    WHERE tcr.rn = 1
  ),
  tier_extended_sources AS (
    SELECT
      tf.other_id,
      tf.rel_created_ms,
      1 AS source_priority,
      'friend_of_friend'::text AS raw_relationship_source,
      'Friend of ' || tf.mutual_friend_name AS relationship_label,
      'user'::text AS relationship_context_type,
      tf.mutual_friend_id AS relationship_context_id,
      tf.mutual_friend_name AS relationship_context_title,
      tf.source_count AS relationship_source_count
    FROM tier_fof tf
    UNION ALL
    SELECT
      tc.other_id,
      tc.rel_created_ms,
      2 AS source_priority,
      'co_attendee'::text AS raw_relationship_source,
      tc.event_relationship_label AS relationship_label,
      tc.event_type::text AS relationship_context_type,
      tc.event_id AS relationship_context_id,
      tc.safe_event_title AS relationship_context_title,
      tc.source_count AS relationship_source_count
    FROM tier_coattendee tc
  ),
  tier_extended_ranked AS (
    SELECT
      tes.*,
      (
        SELECT COUNT(DISTINCT tes2.raw_relationship_source)
        FROM tier_extended_sources tes2
        WHERE tes2.other_id = tes.other_id
      ) AS source_type_count,
      MAX(tes.rel_created_ms) OVER (PARTITION BY tes.other_id) AS max_rel_created_ms,
      ROW_NUMBER() OVER (
        PARTITION BY tes.other_id
        ORDER BY tes.source_priority DESC, tes.rel_created_ms DESC, LOWER(tes.relationship_label) ASC, tes.relationship_context_id ASC
      ) AS rn
    FROM tier_extended_sources tes
  ),
  tier_extended AS (
    SELECT
      ter.other_id,
      ter.max_rel_created_ms AS rel_created_ms,
      CASE WHEN ter.source_type_count > 1 THEN 'mixed' ELSE ter.raw_relationship_source END AS relationship_source,
      ter.relationship_label,
      ter.relationship_context_type,
      ter.relationship_context_id,
      ter.relationship_context_title,
      ter.relationship_source_count
    FROM tier_extended_ranked ter
    WHERE ter.rn = 1
  ),
  combined AS (
    SELECT
      tc.other_id,
      'close'::text AS tier,
      tc.rel_created_ms,
      CASE WHEN tc.rsvp_event_id IS NOT NULL THEN 'rsvp_guest' ELSE 'paired' END::text AS relationship_source,
      'Close friend'::text AS relationship_label,
      CASE WHEN tc.rsvp_event_id IS NOT NULL THEN 'event' END::text AS relationship_context_type,
      tc.rsvp_event_id AS relationship_context_id,
      tc.rsvp_event_title AS relationship_context_title,
      1::int AS relationship_source_count
    FROM tier_close tc
    UNION ALL
    SELECT
      tf.other_id,
      'friend'::text AS tier,
      tf.rel_created_ms,
      'friend'::text AS relationship_source,
      'Friend'::text AS relationship_label,
      NULL::text AS relationship_context_type,
      NULL::uuid AS relationship_context_id,
      NULL::text AS relationship_context_title,
      1::int AS relationship_source_count
    FROM tier_friend tf
    UNION ALL
    SELECT
      te.other_id,
      'extended'::text AS tier,
      te.rel_created_ms,
      te.relationship_source,
      te.relationship_label,
      te.relationship_context_type,
      te.relationship_context_id,
      te.relationship_context_title,
      te.relationship_source_count
    FROM tier_extended te
  )
  SELECT
    c.other_id AS user_id,
    c.tier,
    pr.display_name,
    pr.username,
    pr.avatar_url,
    (c.other_id IN (SELECT dau.user_id FROM dual_app_users dau)) AS has_business_app,
    c.relationship_source,
    c.relationship_label,
    c.relationship_context_type,
    c.relationship_context_id,
    c.relationship_context_title,
    c.relationship_source_count,
    ((CASE c.tier WHEN 'close' THEN 3 WHEN 'friend' THEN 2 ELSE 1 END)::bigint * (1::bigint << 50))
      + GREATEST(
          c.rel_created_ms,
          COALESCE((
            SELECT MAX(EXTRACT(EPOCH FROM COALESCE(er2.event_at, o3.created_at))::bigint * 1000)
            FROM public.orders o3
            JOIN public.events e2 ON e2.id = o3.event_id
            LEFT JOIN event_recency er2 ON er2.event_id = o3.event_id
            WHERE o3.payment_status = 'paid'
              AND o3.buyer_user_id = c.other_id
              AND e2.deleted_at IS NULL
              AND e2.event_type IN ('event', 'trip')
              AND o3.event_id IN (SELECT ve2.eid FROM viewer_events ve2)
          ), 0)
        ) AS sort_score
  FROM combined c
  JOIN public.profiles pr ON pr.id = c.other_id
  WHERE c.other_id IN (SELECT cu.user_id FROM consumer_users cu)
    AND c.other_id <> p_viewer_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.friends fb
      WHERE fb.user_id = p_viewer_user_id
        AND fb.friend_user_id = c.other_id
        AND fb.status = 'blocked'
        AND fb.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.friends rb
      WHERE rb.user_id = c.other_id
        AND rb.friend_user_id = p_viewer_user_id
        AND rb.status = 'blocked'
        AND rb.deleted_at IS NULL
    )
  ORDER BY sort_score DESC, c.other_id ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_circle(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_circle(uuid, int, int) TO authenticated;

COMMIT;
