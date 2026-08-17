-- Issue #2101 — optional event-scoped authenticated named-buyer ticket checkout.
--
-- Binding contract: original SPEC (issue #2101 comment 5300746040) plus
-- Amendments 1-7. Server authority is the real fence; the client is advisory.
--
-- Default remains UNRESTRICTED: with no policy row, or with mode
-- 'unrestricted', every response, money computation, idempotency key, capacity
-- decision and provider request is byte/semantically compatible with #1930 and
-- #2079 truth. No hard-coded identity, no production-only bypass, no
-- fail-open.
--
-- Lock order (Amendment 3 §A3.1), one shared serialization order everywhere:
--   events row  ->  brands row  ->  access policy  ->  membership
--   ->  checkout session  ->  provider attempt  ->  outbox
-- There is no advisory lock and no brand-before-event path.

-- ---------------------------------------------------------------------------
-- A4 — canonical username uniqueness. Abort BEFORE creating the index if the
-- live data cannot support exact-equality lookup; only then add the partial
-- unique index so future writes are unambiguous.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_collisions bigint;
BEGIN
  SELECT count(*) INTO v_collisions FROM (
    SELECT lower(btrim(username)) AS canonical
    FROM public.profiles
    WHERE username IS NOT NULL
    GROUP BY 1
    HAVING count(*) > 1
  ) dup;
  IF v_collisions > 0 THEN
    RAISE EXCEPTION 'issue_2101_canonical_username_collisions_require_audited_reconciliation';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_canonical_unique
  ON public.profiles (lower(btrim(username))) WHERE username IS NOT NULL;

-- ---------------------------------------------------------------------------
-- A1 / A5 — durable model.
-- ---------------------------------------------------------------------------
CREATE TABLE public.event_ticket_checkout_access (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  mode text NOT NULL DEFAULT 'unrestricted'
    CHECK (mode IN ('unrestricted','named_buyers')),
  config_revision bigint NOT NULL DEFAULT 0 CHECK (config_revision >= 0),
  restrictive_epoch bigint NOT NULL DEFAULT 0 CHECK (restrictive_epoch >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.event_ticket_checkout_allowed_buyers (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  membership_epoch bigint NOT NULL DEFAULT 1 CHECK (membership_epoch > 0),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  UNIQUE (event_id, buyer_user_id)
);
CREATE INDEX event_ticket_checkout_allowed_buyers_active_idx
  ON public.event_ticket_checkout_allowed_buyers(event_id)
  WHERE removed_at IS NULL;

-- Append-only evidence. Historical UUIDs are immutable scalar facts with NO
-- cascading FK, so account/event deletion can neither erase nor block them.
CREATE TABLE public.event_ticket_checkout_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  event_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL CHECK (action IN (
    'add_self','add_username','remove','set_mode')),
  target_buyer_user_id uuid,
  before_mode text,
  after_mode text,
  before_config_revision bigint,
  after_config_revision bigint,
  before_restrictive_epoch bigint,
  after_restrictive_epoch bigint,
  outcome text NOT NULL CHECK (outcome IN ('changed','noop')),
  payload_fingerprint text NOT NULL,
  result_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_ticket_checkout_access_audit_event_idx
  ON public.event_ticket_checkout_access_audit(event_id, created_at);

ALTER TABLE public.event_ticket_checkout_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticket_checkout_allowed_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticket_checkout_access_audit ENABLE ROW LEVEL SECURITY;

-- No table policies and no direct application writes anywhere. Only the
-- postgres-owned, fixed-search-path definer functions below touch these rows.
REVOKE ALL ON public.event_ticket_checkout_access
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.event_ticket_checkout_allowed_buyers
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.event_ticket_checkout_access_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- brand_id may never disagree with the event it describes.
CREATE OR REPLACE FUNCTION public.issue_2101_access_brand_consistency()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
DECLARE v_brand uuid;
BEGIN
  SELECT brand_id INTO v_brand FROM public.events WHERE id=NEW.event_id;
  IF v_brand IS NULL OR v_brand <> NEW.brand_id THEN
    RAISE EXCEPTION 'issue_2101_access_brand_mismatch';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_access_brand_consistency()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_2101_access_brand_consistency
  BEFORE INSERT OR UPDATE OF event_id, brand_id
  ON public.event_ticket_checkout_access
  FOR EACH ROW EXECUTE FUNCTION public.issue_2101_access_brand_consistency();

-- Audit is append-only by trigger IN ADDITION to the revoked grants.
CREATE OR REPLACE FUNCTION public.issue_2101_audit_append_only()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'issue_2101_access_audit_is_append_only';
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_audit_append_only()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_2101_audit_no_update
  BEFORE UPDATE ON public.event_ticket_checkout_access_audit
  FOR EACH ROW EXECUTE FUNCTION public.issue_2101_audit_append_only();
CREATE TRIGGER issue_2101_audit_no_delete
  BEFORE DELETE ON public.event_ticket_checkout_access_audit
  FOR EACH ROW EXECUTE FUNCTION public.issue_2101_audit_append_only();
CREATE TRIGGER issue_2101_audit_no_truncate
  BEFORE TRUNCATE ON public.event_ticket_checkout_access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.issue_2101_audit_append_only();

-- ---------------------------------------------------------------------------
-- A1 — immutable snapshot columns. Snapshot membership IDs are scalar UUID
-- facts with NO membership FK, so later membership/account deletion can neither
-- erase payment evidence nor block deletion.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN checkout_access_mode_snapshot text NOT NULL DEFAULT 'unrestricted'
    CHECK (checkout_access_mode_snapshot IN ('unrestricted','named_buyers')),
  ADD COLUMN checkout_access_restrictive_epoch_snapshot bigint NOT NULL DEFAULT 0
    CHECK (checkout_access_restrictive_epoch_snapshot >= 0),
  ADD COLUMN checkout_access_membership_id_snapshot uuid,
  ADD COLUMN checkout_access_membership_epoch_snapshot bigint;

ALTER TABLE public.ticket_checkout_provider_attempts
  ADD COLUMN checkout_access_mode_snapshot text NOT NULL DEFAULT 'unrestricted'
    CHECK (checkout_access_mode_snapshot IN ('unrestricted','named_buyers')),
  ADD COLUMN checkout_access_restrictive_epoch_snapshot bigint NOT NULL DEFAULT 0
    CHECK (checkout_access_restrictive_epoch_snapshot >= 0),
  ADD COLUMN checkout_access_membership_id_snapshot uuid,
  ADD COLUMN checkout_access_membership_epoch_snapshot bigint;

-- ---------------------------------------------------------------------------
-- A2.1 — the exact eligible-auth predicate. Used for the Business actor, the
-- Add-my-account target, the Add-username target, the current brand-owner
-- counterparty, and every fresh/continuation checkout decision. There is no
-- fallback to email, role, JWT presence, profile existence, email_confirmed_at,
-- metadata, or a stale membership.
-- ---------------------------------------------------------------------------
-- ACCESS PATH NOTE (semantics unchanged, binding is preserved exactly).
-- `deleted_at`, `is_anonymous`, `banned_until` and `confirmed_at` are
-- GoTrue-MANAGED columns. They exist on live Supabase, but `auth.users` in the
-- migration-apply base image is the pre-GoTrue stub that carries none of them
-- (the same fact `issue-873` and `issue-1529` provision around in their own
-- workflows). A `LANGUAGE sql` body binds its column references at CREATE time,
-- so naming them literally aborts the ENTIRE repository migration chain on that
-- image — not just this issue's tests.
--
-- Reading them off `to_jsonb(u)` is byte-equivalent wherever the columns exist,
-- and it FAILS CLOSED where they do not: a missing `confirmed_at` yields NULL,
-- the `IS NOT NULL` test is false, and no identity is eligible. There is no
-- direction in which a drifted catalog can make a restricted sale purchasable.
-- The #2101 PostgreSQL suite provisions the four columns and then asserts this
-- function agrees with the literal-column form row for row.
CREATE OR REPLACE FUNCTION public.issue_2101_eligible_identity(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.profiles p ON p.id=u.id
    CROSS JOIN LATERAL (SELECT to_jsonb(u) AS j) au
    WHERE u.id=p_user_id
      AND (au.j->>'deleted_at') IS NULL
      AND COALESCE((au.j->>'is_anonymous')::boolean,false)=false
      AND ((au.j->>'banned_until') IS NULL
           OR (au.j->>'banned_until')::timestamptz<=now())
      AND (au.j->>'confirmed_at') IS NOT NULL
      AND p.active IS TRUE
  )
$function$;
REVOKE ALL ON FUNCTION public.issue_2101_eligible_identity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- A2.2 — the durable seller principal is the event's CURRENT brand owner,
-- events.brand_id -> brands.id -> brands.account_id (creator_accounts.id, which
-- is the auth user id). Blocks are rejected in BOTH directions.
CREATE OR REPLACE FUNCTION public.issue_2101_current_brand_owner(p_brand_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
  SELECT b.account_id
  FROM public.brands b
  JOIN public.creator_accounts ca ON ca.id=b.account_id
  WHERE b.id=p_brand_id
    AND b.deleted_at IS NULL
    AND ca.deleted_at IS NULL
$function$;
REVOKE ALL ON FUNCTION public.issue_2101_current_brand_owner(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The SINGLE interpretation of mode, identity validity, block truth and
-- membership. Both the locking authorization owner and the nonlocking public
-- advisory projection consume THIS function; no parallel decision logic exists.
-- Returns: 'unrestricted' | 'sign_in_required' | 'allowed' | 'restricted'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_2101_named_buyer_state(
  p_event_id uuid, p_buyer_user_id uuid
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_mode text;
  v_brand_id uuid;
  v_owner_id uuid;
BEGIN
  SELECT e.brand_id INTO v_brand_id FROM public.events e
    WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 'restricted'; END IF;

  SELECT a.mode INTO v_mode FROM public.event_ticket_checkout_access a
    WHERE a.event_id=p_event_id;
  IF NOT FOUND OR v_mode='unrestricted' THEN RETURN 'unrestricted'; END IF;

  IF p_buyer_user_id IS NULL THEN RETURN 'sign_in_required'; END IF;
  IF NOT public.issue_2101_eligible_identity(p_buyer_user_id) THEN
    RETURN 'restricted';
  END IF;

  v_owner_id := public.issue_2101_current_brand_owner(v_brand_id);
  IF v_owner_id IS NULL
     OR NOT public.issue_2101_eligible_identity(v_owner_id) THEN
    RETURN 'restricted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users bu
    WHERE (bu.blocker_id=v_owner_id AND bu.blocked_id=p_buyer_user_id)
       OR (bu.blocker_id=p_buyer_user_id AND bu.blocked_id=v_owner_id)
  ) THEN
    RETURN 'restricted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_ticket_checkout_allowed_buyers m
    WHERE m.event_id=p_event_id
      AND m.buyer_user_id=p_buyer_user_id
      AND m.removed_at IS NULL
  ) THEN
    RETURN 'restricted';
  END IF;

  RETURN 'allowed';
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_named_buyer_state(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Current snapshot facts for a fresh session write. Nonlocking; the caller
-- already holds event -> brand.
CREATE OR REPLACE FUNCTION public.issue_2101_current_access_snapshot(
  p_event_id uuid, p_buyer_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_mode text := 'unrestricted';
  v_epoch bigint := 0;
  v_membership_id uuid;
  v_membership_epoch bigint;
BEGIN
  SELECT a.mode, a.restrictive_epoch INTO v_mode, v_epoch
    FROM public.event_ticket_checkout_access a WHERE a.event_id=p_event_id;
  IF NOT FOUND THEN
    v_mode := 'unrestricted';
    v_epoch := 0;
  END IF;
  IF v_mode='named_buyers' AND p_buyer_user_id IS NOT NULL THEN
    SELECT m.membership_id, m.membership_epoch
      INTO v_membership_id, v_membership_epoch
      FROM public.event_ticket_checkout_allowed_buyers m
     WHERE m.event_id=p_event_id AND m.buyer_user_id=p_buyer_user_id
       AND m.removed_at IS NULL;
  END IF;
  RETURN jsonb_build_object(
    'mode', v_mode,
    'restrictiveEpoch', v_epoch,
    'membershipId', v_membership_id,
    'membershipEpoch', v_membership_epoch);
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_current_access_snapshot(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A1 §A3 / A3 §A3.3 — the SOLE authorization predicate. VOLATILE because it
-- acquires event -> brand row locks. service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_2101_ticket_checkout_access_decision(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_snapshot_mode text DEFAULT NULL,
  p_snapshot_restrictive_epoch bigint DEFAULT NULL,
  p_snapshot_membership_id uuid DEFAULT NULL,
  p_snapshot_membership_epoch bigint DEFAULT NULL
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_policy public.event_ticket_checkout_access%ROWTYPE;
  v_member public.event_ticket_checkout_allowed_buyers%ROWTYPE;
  v_state text;
  v_continuation boolean := p_snapshot_mode IS NOT NULL;
BEGIN
  -- One shared serialization order: event, then brand. Never the reverse.
  SELECT e.* INTO v_event FROM public.events e WHERE e.id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RETURN 'event_unavailable';
  END IF;
  SELECT b.* INTO v_brand FROM public.brands b
    WHERE b.id=v_event.brand_id AND b.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'event_unavailable'; END IF;

  SELECT * INTO v_policy FROM public.event_ticket_checkout_access
    WHERE event_id=p_event_id;

  -- No row or explicit 'unrestricted' is the legacy path. Membership snapshots
  -- are ignored; named -> unrestricted is an EXPANSION, so every current
  -- session stays valid.
  IF NOT FOUND OR v_policy.mode='unrestricted' THEN
    RETURN 'allowed_unrestricted';
  END IF;

  v_state := public.issue_2101_named_buyer_state(p_event_id, p_buyer_user_id);
  IF v_state='sign_in_required' THEN RETURN 'sign_in_required'; END IF;
  IF v_state<>'allowed' THEN RETURN 'checkout_restricted'; END IF;

  IF v_continuation THEN
    SELECT * INTO v_member FROM public.event_ticket_checkout_allowed_buyers
      WHERE event_id=p_event_id AND buyer_user_id=p_buyer_user_id
        AND removed_at IS NULL;
    IF p_snapshot_mode<>'named_buyers'
       OR p_snapshot_restrictive_epoch IS DISTINCT FROM v_policy.restrictive_epoch
       OR p_snapshot_membership_id IS DISTINCT FROM v_member.membership_id
       OR p_snapshot_membership_epoch IS DISTINCT FROM v_member.membership_epoch
    THEN
      RETURN 'snapshot_stale';
    END IF;
  END IF;

  RETURN 'allowed_named';
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_ticket_checkout_access_decision(
  uuid,uuid,text,bigint,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2101_ticket_checkout_access_decision(
  uuid,uuid,text,bigint,uuid,bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- A2 — the exact active-checkout set, service-only, called only AFTER the
-- event lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_2101_event_has_active_ticket_checkout(
  p_event_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.event_id=p_event_id AND s.order_id IS NULL AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.status IN ('pending_free','requires_payment','processing_payment',
                       'awaiting_web_redirect')
  ) OR EXISTS (
    SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.event_id=p_event_id AND s.order_id IS NULL
      AND s.reversal_state IN ('neutralization_pending','paid_reversal_pending')
  ) OR EXISTS (
    SELECT 1 FROM public.ticket_checkout_provider_attempts a
    JOIN public.ticket_checkout_sessions s ON s.id=a.checkout_session_id
    WHERE s.event_id=p_event_id AND s.order_id IS NULL
      AND a.state IN ('claimed','provider_unknown','ready',
                      'neutralization_pending','paid_reversal_pending')
  ) OR EXISTS (
    SELECT 1 FROM public.checkout_sale_revocation_outbox o
    WHERE o.event_id=p_event_id
      AND o.subject_type='ticket_checkout_session'
      AND o.state IN ('queued','leased','provider_unknown',
                      'paid_reversal_pending','failed_retryable')
  )
$function$;
REVOKE ALL ON FUNCTION public.issue_2101_event_has_active_ticket_checkout(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2101_event_has_active_ticket_checkout(uuid)
  TO service_role;

-- A3.2 — brand-scoped, READ-ONLY predicate for the owner-transfer trigger. It
-- must not lock events, sessions, attempts or outbox rows: the trigger already
-- holds the brand row lock supplied by the UPDATE.
CREATE OR REPLACE FUNCTION public.issue_2101_brand_has_active_named_ticket_checkout(
  p_brand_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.event_ticket_checkout_access a
      ON a.event_id=e.id AND a.mode='named_buyers'
    WHERE e.brand_id=p_brand_id
      AND public.issue_2101_event_has_active_ticket_checkout(e.id)
  )
$function$;
REVOKE ALL ON FUNCTION public.issue_2101_brand_has_active_named_ticket_checkout(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_2101_guard_brand_owner_transfer()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
BEGIN
  IF OLD.account_id IS NOT DISTINCT FROM NEW.account_id THEN RETURN NEW; END IF;
  IF public.issue_2101_brand_has_active_named_ticket_checkout(NEW.id) THEN
    RAISE EXCEPTION 'ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_guard_brand_owner_transfer()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS issue_2101_guard_brand_owner_transfer ON public.brands;
CREATE TRIGGER issue_2101_guard_brand_owner_transfer
  BEFORE UPDATE OF account_id ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.issue_2101_guard_brand_owner_transfer();

-- ---------------------------------------------------------------------------
-- A3 §4 — the ONE bounded public advisory read. Nonlocking, STABLE, and it
-- cannot authorize checkout. It reveals no revision, member ID, member count,
-- or existence distinction among absent/private/inactive/blocked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_public_ticket_checkout_access_state(
  p_event_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_mode text := 'unrestricted';
  v_state text;
BEGIN
  SELECT * INTO v_event FROM public.events
    WHERE id=p_event_id AND deleted_at IS NULL
      AND visibility IN ('public','hidden');
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT a.mode INTO v_mode FROM public.event_ticket_checkout_access a
    WHERE a.event_id=p_event_id;
  IF NOT FOUND THEN v_mode := 'unrestricted'; END IF;

  IF v_mode='unrestricted' THEN
    RETURN jsonb_build_object('schemaVersion',1,'mode','unrestricted',
      'state','unrestricted');
  END IF;

  v_state := public.issue_2101_named_buyer_state(p_event_id, auth.uid());
  RETURN jsonb_build_object('schemaVersion',1,'mode','named_buyers',
    'state', CASE
      WHEN v_state='sign_in_required' THEN 'sign_in_required'
      WHEN v_state='allowed' THEN 'allowed'
      ELSE 'restricted' END);
END $function$;
REVOKE ALL ON FUNCTION public.pg_public_ticket_checkout_access_state(uuid)
  FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.pg_public_ticket_checkout_access_state(uuid)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- A6 — Business authority helpers. Order is mandatory:
--   authenticate -> lock event -> prove owner rank -> find request ID.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_2101_lock_event_prove_owner(
  p_event_id uuid
) RETURNS public.events LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_event public.events%ROWTYPE; v_caller uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL OR NOT public.issue_2101_eligible_identity(v_caller) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT e.* INTO v_event FROM public.events e WHERE e.id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  PERFORM 1 FROM public.brands b
    WHERE b.id=v_event.brand_id AND b.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF public.biz_brand_effective_rank_for_caller(v_event.brand_id)
     < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN v_event;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_lock_event_prove_owner(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_2101_payload_fingerprint(
  p_actor uuid, p_event_id uuid, p_action text, p_subject text,
  p_expected_config_revision bigint
) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=public,pg_temp AS $function$
  SELECT encode(extensions.digest(
    jsonb_build_object(
      'schemaVersion',1,'actor',p_actor,'eventId',p_event_id,'action',p_action,
      'subject',p_subject,'expectedConfigRevision',p_expected_config_revision
    )::text,'sha256'),'hex')
$function$;
REVOKE ALL ON FUNCTION public.issue_2101_payload_fingerprint(
  uuid,uuid,text,text,bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Replay evidence: the audit row IS the replay record. Same actor/event/action/
-- fingerprint returns the exact stored result; any mismatch is a conflict.
CREATE OR REPLACE FUNCTION public.issue_2101_replay_result(
  p_request_id uuid, p_actor uuid, p_event_id uuid, p_action text,
  p_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
DECLARE v_row public.event_ticket_checkout_access_audit%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.event_ticket_checkout_access_audit
    WHERE request_id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.actor_user_id IS DISTINCT FROM p_actor
     OR v_row.event_id<>p_event_id
     OR v_row.action<>p_action
     OR v_row.payload_fingerprint<>p_fingerprint THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN v_row.result_snapshot;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_replay_result(uuid,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Materialize the implicit (unrestricted, 0, 0) policy so A1's transition
-- matrix applies uniformly.
CREATE OR REPLACE FUNCTION public.issue_2101_materialize_policy(
  p_event_id uuid, p_brand_id uuid, p_actor uuid
) RETURNS public.event_ticket_checkout_access LANGUAGE plpgsql VOLATILE
SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_policy public.event_ticket_checkout_access%ROWTYPE;
BEGIN
  SELECT * INTO v_policy FROM public.event_ticket_checkout_access
    WHERE event_id=p_event_id FOR UPDATE;
  IF FOUND THEN RETURN v_policy; END IF;
  INSERT INTO public.event_ticket_checkout_access(
    event_id,brand_id,mode,config_revision,restrictive_epoch,created_by,updated_by)
  VALUES(p_event_id,p_brand_id,'unrestricted',0,0,p_actor,p_actor)
  RETURNING * INTO v_policy;
  RETURN v_policy;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_materialize_policy(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_2101_write_audit(
  p_request_id uuid, p_event_id uuid, p_brand_id uuid, p_actor uuid,
  p_action text, p_target uuid, p_before public.event_ticket_checkout_access,
  p_after public.event_ticket_checkout_access, p_outcome text,
  p_fingerprint text, p_membership_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := jsonb_build_object(
    'schemaVersion',1,
    'outcome',p_outcome,
    'eventId',p_event_id,
    'mode',p_after.mode,
    'configRevision',p_after.config_revision,
    'restrictiveEpoch',p_after.restrictive_epoch,
    'membershipId',p_membership_id);
  INSERT INTO public.event_ticket_checkout_access_audit(
    request_id,event_id,brand_id,actor_user_id,action,target_buyer_user_id,
    before_mode,after_mode,before_config_revision,after_config_revision,
    before_restrictive_epoch,after_restrictive_epoch,outcome,payload_fingerprint,
    result_snapshot)
  VALUES(p_request_id,p_event_id,p_brand_id,p_actor,p_action,p_target,
    p_before.mode,p_after.mode,p_before.config_revision,p_after.config_revision,
    p_before.restrictive_epoch,p_after.restrictive_epoch,p_outcome,p_fingerprint,
    v_result);
  RETURN v_result;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_write_audit(
  uuid,uuid,uuid,uuid,text,uuid,public.event_ticket_checkout_access,
  public.event_ticket_checkout_access,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Caller-relative projection (A4). A private/blocked target is the neutral
-- label with every public identity field null; the caller's own row is
-- "My account".
CREATE OR REPLACE FUNCTION public.issue_2101_project_members(
  p_event_id uuid, p_caller uuid, p_owner uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
  SELECT COALESCE(jsonb_agg(member_row ORDER BY member_row->>'addedAt'),'[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'membershipId', m.membership_id,
      'addedAt', m.added_at,
      'isSelf', (m.buyer_user_id=p_caller),
      'label', CASE
        WHEN m.buyer_user_id=p_caller THEN 'My account'
        WHEN p.visibility_mode='public' AND p.active IS TRUE
          AND NOT EXISTS (
            SELECT 1 FROM public.blocked_users bu
            WHERE (bu.blocker_id=p_owner AND bu.blocked_id=m.buyer_user_id)
               OR (bu.blocker_id=m.buyer_user_id AND bu.blocked_id=p_owner))
          THEN COALESCE(p.display_name,p.username,'Approved account')
        ELSE 'Approved private account' END,
      'username', CASE
        WHEN p.visibility_mode='public' AND p.active IS TRUE
          AND NOT EXISTS (
            SELECT 1 FROM public.blocked_users bu
            WHERE (bu.blocker_id=p_owner AND bu.blocked_id=m.buyer_user_id)
               OR (bu.blocker_id=m.buyer_user_id AND bu.blocked_id=p_owner))
          THEN p.username ELSE NULL END,
      'displayName', CASE
        WHEN p.visibility_mode='public' AND p.active IS TRUE
          AND NOT EXISTS (
            SELECT 1 FROM public.blocked_users bu
            WHERE (bu.blocker_id=p_owner AND bu.blocked_id=m.buyer_user_id)
               OR (bu.blocker_id=m.buyer_user_id AND bu.blocked_id=p_owner))
          THEN p.display_name ELSE NULL END,
      'avatarUrl', CASE
        WHEN p.visibility_mode='public' AND p.active IS TRUE
          AND NOT EXISTS (
            SELECT 1 FROM public.blocked_users bu
            WHERE (bu.blocker_id=p_owner AND bu.blocked_id=m.buyer_user_id)
               OR (bu.blocker_id=m.buyer_user_id AND bu.blocked_id=p_owner))
          THEN p.avatar_url ELSE NULL END
    ) AS member_row
    FROM public.event_ticket_checkout_allowed_buyers m
    JOIN public.profiles p ON p.id=m.buyer_user_id
    WHERE m.event_id=p_event_id AND m.removed_at IS NULL
  ) projected
$function$;
REVOKE ALL ON FUNCTION public.issue_2101_project_members(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A6 — the five narrow Business RPCs. authenticated only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_get(
  p_event_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_policy public.event_ticket_checkout_access%ROWTYPE;
  v_owner uuid;
BEGIN
  v_event := public.issue_2101_lock_event_prove_owner(p_event_id);
  v_owner := public.issue_2101_current_brand_owner(v_event.brand_id);
  SELECT * INTO v_policy FROM public.event_ticket_checkout_access
    WHERE event_id=p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('schemaVersion',1,'eventId',p_event_id,
      'mode','unrestricted','configRevision',0,'restrictiveEpoch',0,
      'maxActiveBuyers',20,'members','[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('schemaVersion',1,'eventId',p_event_id,
    'mode',v_policy.mode,'configRevision',v_policy.config_revision,
    'restrictiveEpoch',v_policy.restrictive_epoch,'maxActiveBuyers',20,
    'members',public.issue_2101_project_members(p_event_id,auth.uid(),v_owner));
END $function$;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_get(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_get(uuid)
  TO authenticated;

-- Shared add path. p_target is already resolved and proven eligible.
CREATE OR REPLACE FUNCTION public.issue_2101_add_member(
  p_event_id uuid, p_target uuid, p_expected_config_revision bigint,
  p_request_id uuid, p_action text, p_subject text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_before public.event_ticket_checkout_access%ROWTYPE;
  v_after public.event_ticket_checkout_access%ROWTYPE;
  v_member public.event_ticket_checkout_allowed_buyers%ROWTYPE;
  v_actor uuid; v_fp text; v_replay jsonb; v_active integer; v_exists boolean;
BEGIN
  v_event := public.issue_2101_lock_event_prove_owner(p_event_id);
  v_actor := auth.uid();
  v_fp := public.issue_2101_payload_fingerprint(
    v_actor,p_event_id,p_action,p_subject,p_expected_config_revision);
  v_replay := public.issue_2101_replay_result(
    p_request_id,v_actor,p_event_id,p_action,v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  v_before := public.issue_2101_materialize_policy(
    p_event_id,v_event.brand_id,v_actor);
  -- NULL-SAFE ON PURPOSE. `p_expected_config_revision` is client-supplied, so a
  -- caller can pass NULL. With plain `<>` that comparison yields NULL, the IF is
  -- not taken, and the CAS the contract requires ("exact expected_revision") is
  -- SKIPPED — the mutation proceeds on a stale view. IS DISTINCT FROM treats a
  -- NULL expectation as "not the current revision", which is the fail-closed
  -- reading: it raises STALE_ACCESS_POLICY and the caller refetches.
  IF v_before.config_revision IS DISTINCT FROM p_expected_config_revision THEN
    RAISE EXCEPTION 'STALE_ACCESS_POLICY';
  END IF;

  SELECT * INTO v_member FROM public.event_ticket_checkout_allowed_buyers
    WHERE event_id=p_event_id AND buyer_user_id=p_target FOR UPDATE;
  v_exists := FOUND;

  -- Adding an active member is a no-op: no counter moves, no session is
  -- invalidated, and the audit records 'noop'.
  IF v_exists AND v_member.removed_at IS NULL THEN
    RETURN public.issue_2101_write_audit(p_request_id,p_event_id,v_event.brand_id,
      v_actor,p_action,p_target,v_before,v_before,'noop',v_fp,
      v_member.membership_id);
  END IF;

  SELECT count(*) INTO v_active FROM public.event_ticket_checkout_allowed_buyers
    WHERE event_id=p_event_id AND removed_at IS NULL;
  IF v_active >= 20 THEN RAISE EXCEPTION 'MAX_ACTIVE_BUYERS'; END IF;

  IF v_exists THEN
    -- Re-add clears the removal and advances ONLY this buyer's epoch, so the
    -- removed-buyer snapshot stays invalid while every other buyer keeps theirs.
    UPDATE public.event_ticket_checkout_allowed_buyers
      SET membership_epoch=membership_epoch+1, removed_at=NULL, removed_by=NULL,
          added_by=v_actor, added_at=now()
      WHERE membership_id=v_member.membership_id
      RETURNING * INTO v_member;
  ELSE
    INSERT INTO public.event_ticket_checkout_allowed_buyers(
      event_id,buyer_user_id,membership_epoch,added_by)
    VALUES(p_event_id,p_target,1,v_actor)
    RETURNING * INTO v_member;
  END IF;

  -- Adding a buyer is an EXPANSION: config_revision advances, the restrictive
  -- epoch does not, and no existing allowed session is invalidated.
  UPDATE public.event_ticket_checkout_access
    SET config_revision=config_revision+1, updated_by=v_actor, updated_at=now()
    WHERE event_id=p_event_id RETURNING * INTO v_after;

  RETURN public.issue_2101_write_audit(p_request_id,p_event_id,v_event.brand_id,
    v_actor,p_action,p_target,v_before,v_after,'changed',v_fp,
    v_member.membership_id);
END $function$;
REVOKE ALL ON FUNCTION public.issue_2101_add_member(
  uuid,uuid,bigint,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_add_self(
  p_event_id uuid, p_expected_config_revision bigint, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL OR NOT public.issue_2101_eligible_identity(v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN public.issue_2101_add_member(p_event_id,v_actor,
    p_expected_config_revision,p_request_id,'add_self','self');
END $function$;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_add_self(
  uuid,bigint,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_add_self(
  uuid,bigint,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_add_username(
  p_event_id uuid, p_username text, p_expected_config_revision bigint,
  p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_canonical text; v_target uuid; v_owner uuid;
BEGIN
  -- Owner authority is proven BEFORE any identity lookup, replay lookup, or
  -- membership projection, so a non-owner learns nothing about any account.
  v_event := public.issue_2101_lock_event_prove_owner(p_event_id);
  v_owner := public.issue_2101_current_brand_owner(v_event.brand_id);
  v_canonical := lower(btrim(COALESCE(p_username,'')));
  IF v_canonical='' THEN RAISE EXCEPTION 'BUYER_NOT_AVAILABLE'; END IF;

  -- Exact normalized-username equality only. Never email, phone, substring,
  -- display name, or auth.users data.
  SELECT p.id INTO v_target FROM public.profiles p
    WHERE lower(btrim(p.username))=v_canonical
      AND p.active IS TRUE
      AND p.visibility_mode='public';
  IF NOT FOUND
     OR NOT public.issue_2101_eligible_identity(v_target)
     OR v_owner IS NULL
     OR EXISTS (
       SELECT 1 FROM public.blocked_users bu
       WHERE (bu.blocker_id=v_owner AND bu.blocked_id=v_target)
          OR (bu.blocker_id=v_target AND bu.blocked_id=v_owner))
  THEN
    -- Missing, private, inactive, blocked and ambiguous are ONE answer.
    RAISE EXCEPTION 'BUYER_NOT_AVAILABLE';
  END IF;

  RETURN public.issue_2101_add_member(p_event_id,v_target,
    p_expected_config_revision,p_request_id,'add_username',v_canonical);
END $function$;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_add_username(
  uuid,text,bigint,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_add_username(
  uuid,text,bigint,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_remove(
  p_event_id uuid, p_membership_id uuid, p_expected_config_revision bigint,
  p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_before public.event_ticket_checkout_access%ROWTYPE;
  v_after public.event_ticket_checkout_access%ROWTYPE;
  v_member public.event_ticket_checkout_allowed_buyers%ROWTYPE;
  v_actor uuid; v_fp text; v_replay jsonb;
BEGIN
  v_event := public.issue_2101_lock_event_prove_owner(p_event_id);
  v_actor := auth.uid();
  v_fp := public.issue_2101_payload_fingerprint(
    v_actor,p_event_id,'remove',p_membership_id::text,p_expected_config_revision);
  v_replay := public.issue_2101_replay_result(
    p_request_id,v_actor,p_event_id,'remove',v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  v_before := public.issue_2101_materialize_policy(
    p_event_id,v_event.brand_id,v_actor);
  -- NULL-SAFE ON PURPOSE. `p_expected_config_revision` is client-supplied, so a
  -- caller can pass NULL. With plain `<>` that comparison yields NULL, the IF is
  -- not taken, and the CAS the contract requires ("exact expected_revision") is
  -- SKIPPED — the mutation proceeds on a stale view. IS DISTINCT FROM treats a
  -- NULL expectation as "not the current revision", which is the fail-closed
  -- reading: it raises STALE_ACCESS_POLICY and the caller refetches.
  IF v_before.config_revision IS DISTINCT FROM p_expected_config_revision THEN
    RAISE EXCEPTION 'STALE_ACCESS_POLICY';
  END IF;

  SELECT * INTO v_member FROM public.event_ticket_checkout_allowed_buyers
    WHERE membership_id=p_membership_id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUYER_NOT_AVAILABLE'; END IF;

  IF v_member.removed_at IS NOT NULL THEN
    RETURN public.issue_2101_write_audit(p_request_id,p_event_id,v_event.brand_id,
      v_actor,'remove',v_member.buyer_user_id,v_before,v_before,'noop',v_fp,
      v_member.membership_id);
  END IF;

  -- Removal while named is RESTRICTIVE: it must fail atomically, before any
  -- mutation or audit row, if a nonterminal checkout exists for this event.
  IF v_before.mode='named_buyers'
     AND public.issue_2101_event_has_active_ticket_checkout(p_event_id) THEN
    RAISE EXCEPTION 'ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE';
  END IF;

  UPDATE public.event_ticket_checkout_allowed_buyers
    SET membership_epoch=membership_epoch+1, removed_at=now(), removed_by=v_actor
    WHERE membership_id=p_membership_id RETURNING * INTO v_member;

  UPDATE public.event_ticket_checkout_access
    SET config_revision=config_revision+1, updated_by=v_actor, updated_at=now()
    WHERE event_id=p_event_id RETURNING * INTO v_after;

  RETURN public.issue_2101_write_audit(p_request_id,p_event_id,v_event.brand_id,
    v_actor,'remove',v_member.buyer_user_id,v_before,v_after,'changed',v_fp,
    v_member.membership_id);
END $function$;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_remove(
  uuid,uuid,bigint,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_remove(
  uuid,uuid,bigint,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_set_mode(
  p_event_id uuid, p_mode text, p_expected_config_revision bigint,
  p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_before public.event_ticket_checkout_access%ROWTYPE;
  v_after public.event_ticket_checkout_access%ROWTYPE;
  v_actor uuid; v_fp text; v_replay jsonb;
BEGIN
  IF p_mode NOT IN ('unrestricted','named_buyers') THEN
    RAISE EXCEPTION 'INVALID_ACCESS_MODE';
  END IF;
  v_event := public.issue_2101_lock_event_prove_owner(p_event_id);
  v_actor := auth.uid();
  v_fp := public.issue_2101_payload_fingerprint(
    v_actor,p_event_id,'set_mode',p_mode,p_expected_config_revision);
  v_replay := public.issue_2101_replay_result(
    p_request_id,v_actor,p_event_id,'set_mode',v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  v_before := public.issue_2101_materialize_policy(
    p_event_id,v_event.brand_id,v_actor);
  -- NULL-SAFE ON PURPOSE. `p_expected_config_revision` is client-supplied, so a
  -- caller can pass NULL. With plain `<>` that comparison yields NULL, the IF is
  -- not taken, and the CAS the contract requires ("exact expected_revision") is
  -- SKIPPED — the mutation proceeds on a stale view. IS DISTINCT FROM treats a
  -- NULL expectation as "not the current revision", which is the fail-closed
  -- reading: it raises STALE_ACCESS_POLICY and the caller refetches.
  IF v_before.config_revision IS DISTINCT FROM p_expected_config_revision THEN
    RAISE EXCEPTION 'STALE_ACCESS_POLICY';
  END IF;

  IF v_before.mode=p_mode THEN
    RETURN public.issue_2101_write_audit(p_request_id,p_event_id,v_event.brand_id,
      v_actor,'set_mode',NULL,v_before,v_before,'noop',v_fp,NULL);
  END IF;

  IF p_mode='named_buyers' THEN
    -- unrestricted -> named_buyers is the policy-wide RESTRICTION. It fails
    -- before mutation/audit while any nonterminal checkout exists, and it is
    -- the ONLY transition that advances restrictive_epoch.
    IF public.issue_2101_event_has_active_ticket_checkout(p_event_id) THEN
      RAISE EXCEPTION 'ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE';
    END IF;
    UPDATE public.event_ticket_checkout_access
      SET mode='named_buyers', config_revision=config_revision+1,
          restrictive_epoch=restrictive_epoch+1, updated_by=v_actor,
          updated_at=now()
      WHERE event_id=p_event_id RETURNING * INTO v_after;
  ELSE
    -- named_buyers -> unrestricted is an EXPANSION.
    UPDATE public.event_ticket_checkout_access
      SET mode='unrestricted', config_revision=config_revision+1,
          updated_by=v_actor, updated_at=now()
      WHERE event_id=p_event_id RETURNING * INTO v_after;
  END IF;

  RETURN public.issue_2101_write_audit(p_request_id,p_event_id,v_event.brand_id,
    v_actor,'set_mode',NULL,v_before,v_after,'changed',v_fp,NULL);
END $function$;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_set_mode(
  uuid,text,bigint,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_set_mode(
  uuid,text,bigint,uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- A3 — the amended #1930 / #2079 enforcement graph. Every signature is
-- preserved; only the access recheck and the event -> brand lock ordering are
-- added. Unrestricted events keep byte/semantic legacy behavior.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      OR NOT tt.available_online
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      OR (NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_claim_ticket_provider_attempt(
  p_checkout_session_id uuid,
  p_event_id uuid,
  p_provider text,
  p_flow text,
  p_request_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_event public.events%ROWTYPE; v_session public.ticket_checkout_sessions%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_reason text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','revoked'); END IF;
  -- #2101 A3.1 — brand lock immediately after the event lock, before any
  -- admission-state, session, attempt or outbox row lock.
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  v_reason:=public.issue_1930_event_sale_reason(v_event);
  INSERT INTO public.event_checkout_admission_state(event_id,epoch,sellable,reason)
  VALUES(p_event_id,1,v_reason='sellable',v_reason)
  ON CONFLICT(event_id) DO UPDATE SET sellable=EXCLUDED.sellable,reason=EXCLUDED.reason
  RETURNING * INTO v_admission;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.event_id<>p_event_id
     OR NOT public.issue_1930_ticket_session_authorized(p_checkout_session_id,p_event_id) THEN
    IF FOUND AND v_session.revoked_at IS NULL THEN
      UPDATE public.ticket_checkout_sessions SET revoked_at=now(),revoked_reason=v_reason,
        reversal_state='neutralization_pending',status='failed',failed_at=now(),updated_at=now(),
        idempotency_key=idempotency_key||':revoked:'||id::text
      WHERE id=p_checkout_session_id;
    END IF;
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE checkout_session_id=p_checkout_session_id FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.provider<>p_provider OR v_attempt.flow<>p_flow
       OR v_attempt.request_fingerprint<>p_request_fingerprint THEN
      RETURN jsonb_build_object('outcome','flow_conflict');
    END IF;
    RETURN jsonb_build_object('outcome',CASE WHEN v_attempt.state='ready' THEN 'existing_ready'
      WHEN v_attempt.state='provider_unknown' THEN 'provider_unknown' ELSE 'in_progress' END,
      'attemptId',v_attempt.id,'epoch',v_attempt.claimed_epoch,
      'providerObjectId',v_attempt.provider_object_id,
      'providerCheckoutId',v_attempt.provider_checkout_id,
      'providerReference',v_attempt.provider_reference);
  END IF;
  INSERT INTO public.ticket_checkout_provider_attempts(
    checkout_session_id,event_id,brand_id,provider,flow,claimed_epoch,
    provider_idempotency_key,request_fingerprint,
    checkout_access_mode_snapshot,checkout_access_restrictive_epoch_snapshot,
    checkout_access_membership_id_snapshot,checkout_access_membership_epoch_snapshot)
  VALUES(p_checkout_session_id,p_event_id,v_session.brand_id,p_provider,p_flow,v_admission.epoch,
    'ticket_checkout:'||p_checkout_session_id::text||':'||p_flow,p_request_fingerprint,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot)
  RETURNING * INTO v_attempt;
  UPDATE public.ticket_checkout_sessions SET admission_epoch=v_admission.epoch,
    provider_attempt_id=v_attempt.id,provider_flow=p_flow,updated_at=now()
  WHERE id=p_checkout_session_id;
  RETURN jsonb_build_object('outcome','fresh_claim','attemptId',v_attempt.id,
    'epoch',v_attempt.claimed_epoch,'idempotencyKey',v_attempt.provider_idempotency_key);
END $function$;
REVOKE ALL ON FUNCTION public.issue_1930_claim_ticket_provider_attempt(uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_claim_ticket_provider_attempt(uuid,uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_commit_ticket_provider_attempt(
  p_attempt_id uuid,p_claimed_epoch bigint,p_provider_object_id text,
  p_provider_checkout_id text,p_provider_reference text,p_continuation_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_event public.events%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_snapshot_lost boolean;
BEGIN
  SELECT e.* INTO v_event FROM public.ticket_checkout_provider_attempts a
    JOIN public.events e ON e.id=a.event_id WHERE a.id=p_attempt_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','missing'); END IF;
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state
    WHERE event_id=v_event.id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=p_attempt_id FOR UPDATE;
  -- #2101 — the attempt's frozen snapshots must still equal the session's.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=v_attempt.checkout_session_id FOR UPDATE;
  v_snapshot_lost :=
    v_session.id IS NULL
    OR v_attempt.checkout_access_mode_snapshot
       IS DISTINCT FROM v_session.checkout_access_mode_snapshot
    OR v_attempt.checkout_access_restrictive_epoch_snapshot
       IS DISTINCT FROM v_session.checkout_access_restrictive_epoch_snapshot
    OR v_attempt.checkout_access_membership_id_snapshot
       IS DISTINCT FROM v_session.checkout_access_membership_id_snapshot
    OR v_attempt.checkout_access_membership_epoch_snapshot
       IS DISTINCT FROM v_session.checkout_access_membership_epoch_snapshot;
  IF v_attempt.claimed_epoch<>p_claimed_epoch OR v_admission.epoch<>p_claimed_epoch
     OR v_snapshot_lost
     OR public.issue_1930_event_sale_reason(v_event)<>'sellable'
     OR NOT public.issue_1930_ticket_session_authorized(v_attempt.checkout_session_id,v_event.id) THEN
    UPDATE public.ticket_checkout_provider_attempts SET state='neutralization_pending',
      provider_object_id=COALESCE(provider_object_id,p_provider_object_id),
      provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id),
      provider_reference=COALESCE(provider_reference,p_provider_reference),
      continuation_fingerprint=COALESCE(continuation_fingerprint,p_continuation_fingerprint),
      updated_at=now()
      WHERE id=p_attempt_id AND state NOT IN ('neutralized','paid_reversed');
    INSERT INTO public.checkout_sale_revocation_outbox(
      subject_type,subject_id,event_id,provider_attempt_id,target_epoch,reason)
    VALUES('ticket_checkout_session',v_attempt.checkout_session_id,v_event.id,v_attempt.id,
      GREATEST(v_admission.epoch,p_claimed_epoch),'commit_epoch_lost') ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  UPDATE public.ticket_checkout_provider_attempts SET state='ready',
    provider_object_id=COALESCE(provider_object_id,p_provider_object_id),
    provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id),
    provider_reference=COALESCE(provider_reference,p_provider_reference),
    continuation_fingerprint=p_continuation_fingerprint,ready_at=COALESCE(ready_at,now()),updated_at=now()
  WHERE id=p_attempt_id AND state IN ('claimed','provider_unknown','ready');
  RETURN jsonb_build_object('outcome','ready');
END $function$;
REVOKE ALL ON FUNCTION public.issue_1930_commit_ticket_provider_attempt(uuid,bigint,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_commit_ticket_provider_attempt(uuid,bigint,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_preflight(
  p_checkout_session_id uuid,p_buyer_status_token_hash text
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_session.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  -- The possession token remains required and is checked first; access loss
  -- returns the existing bounded 'unavailable' without revealing why.
  IF v_session.buyer_status_token_hash IS DISTINCT FROM p_buyer_status_token_hash THEN
    RETURN 'forbidden';
  END IF;
  IF NOT public.issue_1930_ticket_session_authorized(v_session.id,v_session.event_id) THEN
    RETURN 'unavailable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts a
    WHERE a.id=v_session.provider_attempt_id AND a.state='ready'
      AND a.claimed_epoch=v_session.admission_epoch) THEN RETURN 'in_progress'; END IF;
  RETURN 'present_allowed';
END $function$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_preflight(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_preflight(uuid,text)
  TO service_role;

-- The #2079 five-argument late-reversal authority and its provider-evidence
-- interpretation are UNCHANGED. #2101 only adds access loss to the existing
-- #2079 invalid-admission conditional (through issue_1930_ticket_session_authorized),
-- and the brand lock immediately after the event lock.
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,p_stripe_payment_intent_id text,
  p_stripe_charge_id text,p_stripe_payment_method_type text,p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_event public.events%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_result jsonb; v_reversal jsonb;
  v_observed_provider text;
BEGIN
  SELECT e.* INTO v_event FROM public.ticket_checkout_sessions s
    JOIN public.events e ON e.id=s.event_id WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id FOR UPDATE;
  IF v_session.order_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','finalized','orderId',v_session.order_id); END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id FOR UPDATE;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state WHERE event_id=v_event.id FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' OR v_session.revoked_at IS NOT NULL
     OR v_session.admission_epoch IS NULL OR v_admission.epoch<>v_session.admission_epoch
     OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
    v_observed_provider:=CASE
      WHEN v_attempt.id IS NOT NULL THEN v_attempt.provider
      WHEN COALESCE(p_stripe_payment_intent_id,'') ~ '^pi_[A-Za-z0-9]+$'
        AND COALESCE(p_stripe_charge_id,'') ~ '^ch_[A-Za-z0-9]+$' THEN 'stripe'
      WHEN COALESCE(p_stripe_payment_intent_id,'') !~ '^pi_[A-Za-z0-9]+$'
        AND COALESCE(p_stripe_payment_intent_id,'')<>''
        AND COALESCE(p_stripe_charge_id,'') ~ '^[0-9]+$' THEN 'paystack'
      ELSE NULL END;
    IF v_observed_provider IS NULL THEN
      UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
        failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id;
      INSERT INTO public.checkout_sale_revocation_outbox(subject_type,subject_id,event_id,
        provider_attempt_id,target_epoch,reason,state,last_error_code)
      VALUES('ticket_checkout_session',v_session.id,v_session.event_id,v_attempt.id,
        COALESCE(v_attempt.claimed_epoch,v_session.admission_epoch,1),
        'paid_provider_reference_missing','provider_unknown','paid_provider_reference_missing')
      ON CONFLICT(subject_type,subject_id,target_epoch) DO UPDATE SET state='provider_unknown',
        last_error_code=EXCLUDED.last_error_code,updated_at=now();
      RETURN jsonb_build_object('outcome','paid_reversal_pending',
        'reversalReason','paid_provider_reference_missing');
    END IF;
    v_reversal:=public.issue_1930_mint_ticket_late_reversal(v_session.id,
      v_observed_provider,p_stripe_payment_intent_id,
      CASE WHEN v_observed_provider='paystack' THEN p_stripe_charge_id ELSE NULL END,
      CASE WHEN v_observed_provider='stripe' THEN p_stripe_charge_id ELSE NULL END);
    RETURN jsonb_build_object('outcome','paid_reversal_pending',
      'reversalReason',COALESCE(v_reversal->>'reason',v_reversal->>'outcome'));
  END IF;
  v_result:=public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id,
    p_stripe_payment_intent_id,p_stripe_charge_id,p_stripe_payment_method_type,
    p_qr_token_pepper,p_stripe_customer_id_on_connected_account,
    p_saved_payment_method_id,p_installment_plan_root);
  RETURN jsonb_build_object('outcome','finalized')||COALESCE(v_result,'{}'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)
  TO service_role;

-- Fresh decision BEFORE idempotency replay; snapshot the decision onto the new
-- session. A replay is returned only if its buyer ID and current/snapshot
-- decision still authorize it.
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,p_buyer_user_id uuid,p_buyer_name text,p_buyer_email text,
  p_buyer_phone_e164 text,p_marketing_opt_in boolean,p_lines jsonb,
  p_idempotency_key text,p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_existing record;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_decision text;
  v_replay_decision text;
  v_snapshot jsonb;
  v_mode text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  -- #2101 A3.1 — brand lock immediately after the event lock.
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- #2101 — fresh decision BEFORE the idempotency replay owner.
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, p_buyer_user_id);
  IF v_decision='sign_in_required' THEN
    RAISE EXCEPTION 'checkout_sign_in_required';
  END IF;
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN
    RAISE EXCEPTION 'checkout_restricted';
  END IF;
  v_snapshot := public.issue_2101_current_access_snapshot(p_event_id,p_buyer_user_id);
  v_mode := v_snapshot->>'mode';

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key=p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key=idempotency_key || ':tombstone:' || id::text,
             status=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at=now()
       WHERE id=v_existing.id;
    ELSE
      v_replay_decision := public.issue_2101_ticket_checkout_access_decision(
        p_event_id, v_existing.buyer_user_id,
        v_existing.checkout_access_mode_snapshot,
        v_existing.checkout_access_restrictive_epoch_snapshot,
        v_existing.checkout_access_membership_id_snapshot,
        v_existing.checkout_access_membership_epoch_snapshot);
      IF v_replay_decision NOT IN ('allowed_unrestricted','allowed_named')
         OR (v_mode='named_buyers'
             AND v_existing.buyer_user_id IS DISTINCT FROM p_buyer_user_id) THEN
        RAISE EXCEPTION 'checkout_restricted';
      END IF;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;
  END IF;

  v_result:=public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice);

  v_session_id := (v_result->>'checkoutSessionId')::uuid;
  IF v_session_id IS NOT NULL THEN
    UPDATE public.ticket_checkout_sessions SET
      checkout_access_mode_snapshot=v_mode,
      checkout_access_restrictive_epoch_snapshot=
        COALESCE((v_snapshot->>'restrictiveEpoch')::bigint,0),
      checkout_access_membership_id_snapshot=
        NULLIF(v_snapshot->>'membershipId','')::uuid,
      checkout_access_membership_epoch_snapshot=
        NULLIF(v_snapshot->>'membershipEpoch','')::bigint
    WHERE id=v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId',v_result->'checkoutSessionId',
    'eventId',v_result->'eventId',
    'brandId',v_result->'brandId',
    'status',v_result->'status',
    'totalCents',v_result->'totalCents',
    'subtotalCents',v_result->'subtotalCents',
    'currency',v_result->'currency',
    'stripeAccountId',v_result->'stripeAccountId',
    'orderId',v_result->'orderId',
    'items',v_result->'items',
    'lineItems',v_result->'lineItems',
    'installmentSchedule',v_result->'installmentSchedule'
  );
END $function$;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) TO service_role;

COMMENT ON TABLE public.event_ticket_checkout_access IS
  '#2101: optional event-scoped checkout policy. Absent row == unrestricted legacy behavior.';
COMMENT ON TABLE public.event_ticket_checkout_allowed_buyers IS
  '#2101: canonical Mingla auth user IDs allowed to check out. Active iff removed_at IS NULL.';
COMMENT ON TABLE public.event_ticket_checkout_access_audit IS
  '#2101: append-only policy evidence and replay record. No email, phone, token, IP or payload.';
COMMENT ON FUNCTION public.issue_2101_ticket_checkout_access_decision(
  uuid,uuid,text,bigint,uuid,bigint) IS
  '#2101: the SOLE checkout authorization predicate. VOLATILE (takes event -> brand locks); service_role only.';
