-- =====================================================================================
-- Issue #1931 — identity-bound Private event read and ticket checkout.
-- CONSOLIDATED FORWARD MIGRATION (the sole #1931 migration — SC-51).
--
-- RELEASED SET ONLY. Authorized by the APPROVED independent review of Amendment 6:
--   Amendment 3 §5 items 1, 2 (less the legacy-exchange RPC clause), 3, 4 and 6,
--   as corrected by Amendment 4 §B/§C/§D/§K, Amendment 5 §C/§D/§E and Amendment 6
--   §B/§C/§D, plus Amendment 5 §C.3's released item 7.
--
-- EVERYTHING ELSE IS FROZEN, including frozen item 5 — the legacy `?oi=` ingress in
-- full. Nothing here reads or writes `public.brand_offering_invite_tokens` or
-- `public.brand_offering_invites`, and nothing here re-emits
-- `public.biz_validate_offering_invite_token` (SC-55).
--
-- Every released path lands with `issue_1931_private_event_access_ready()` FALSE, and
-- the operator RPC is UNCONDITIONALLY unable to return true (SC-45). There is no
-- runtime kill-switch for a #1931 regression on the live ticket money path, which is
-- the premise the freeze rests on.
--
-- Ordering floor: strictly greater than 20270412001795 (SC-51). Collision scan against
-- origin/main and every sibling worktree is attached to the implementation report.
-- No historical migration is edited.
-- =====================================================================================

BEGIN;

-- Bounded lock timeout for every statement targeting the live #1930 money tables
-- (Amendment 5 §E.2). Metadata-only work.
SET LOCAL lock_timeout = '4s';

-- =====================================================================================
-- SECTION 1 — Service-owned #1931 tables (base SPEC §2, Amendment 1 §2, Amendment 2 §A)
--
-- Every table: RLS enabled AND forced, REVOKE ALL FROM PUBLIC/anon/authenticated,
-- service-role-only access. No raw token, code, capability, contact, IP or user agent
-- is stored anywhere in this section.
-- =====================================================================================

-- 1.1 — one row per event; monotonic epoch that never decreases.
CREATE TABLE IF NOT EXISTS public.private_event_access_state (
  event_id                uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  epoch                   bigint      NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  active                  boolean     NOT NULL DEFAULT false,
  setup_state             text        NOT NULL DEFAULT 'needs_setup'
                            CHECK (setup_state IN ('needs_setup','preparing','ready','failed_manual_review')),
  last_transition_id      uuid,
  last_transition_reason  text CHECK (last_transition_reason IS NULL OR char_length(last_transition_reason) <= 64),
  activated_at            timestamptz,
  deactivated_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Epoch is monotonic. This guard is the invariant, not a convention.
CREATE OR REPLACE FUNCTION public.issue_1931_access_state_epoch_monotonic()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.epoch < OLD.epoch THEN
    RAISE EXCEPTION 'private_access_epoch_would_decrease';
  END IF;
  IF NEW.event_id <> OLD.event_id THEN
    RAISE EXCEPTION 'private_access_event_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS issue_1931_access_state_epoch_monotonic ON public.private_event_access_state;
CREATE TRIGGER issue_1931_access_state_epoch_monotonic
  BEFORE UPDATE ON public.private_event_access_state
  FOR EACH ROW EXECUTE FUNCTION public.issue_1931_access_state_epoch_monotonic();

-- 1.2 — token/event/epoch activation ledger. Stores no raw token and no contact.
-- The FK to the #1770 token table is READ-ONLY: SC-55(c) prohibits writes to that
-- table, and explicitly does not prohibit a read-only reference.
CREATE TABLE IF NOT EXISTS public.private_event_invite_token_epochs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id      uuid NOT NULL REFERENCES public.brand_offering_invite_tokens(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  epoch         bigint NOT NULL CHECK (epoch > 0),
  state         text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  activated_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  CONSTRAINT private_event_invite_token_epochs_unique UNIQUE (token_id, event_id, epoch)
);
CREATE INDEX IF NOT EXISTS private_event_invite_token_epochs_event_epoch_idx
  ON public.private_event_invite_token_epochs (event_id, epoch) WHERE state = 'active';

-- 1.3 — challenge binding. Code hash only; never the code, never the contact.
CREATE TABLE IF NOT EXISTS public.private_event_access_challenges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  token_epoch_id           uuid REFERENCES public.private_event_invite_token_epochs(id) ON DELETE CASCADE,
  epoch                    bigint NOT NULL CHECK (epoch > 0),
  contact_method_kind      text NOT NULL CHECK (contact_method_kind IN ('email','phone')),
  code_hash                text CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  state                    text NOT NULL DEFAULT 'claimed'
                             CHECK (state IN ('claimed','provider_unknown','sent','verified','expired','revoked','locked')),
  attempt_count            integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
  send_ordinal             integer NOT NULL DEFAULT 1 CHECK (send_ordinal >= 1),
  provider_idempotency_key text UNIQUE,
  provider_accepted_at     timestamptz,
  abuse_key_hash           text CHECK (abuse_key_hash IS NULL OR abuse_key_hash ~ '^[0-9a-f]{64}$'),
  expires_at               timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS private_event_access_challenges_event_idx
  ON public.private_event_access_challenges (event_id, epoch);

-- 1.4 — grants. Capability hash only; raw capabilities are never stored.
CREATE TABLE IF NOT EXISTS public.private_event_access_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  token_epoch_id      uuid REFERENCES public.private_event_invite_token_epochs(id) ON DELETE CASCADE,
  epoch               bigint NOT NULL CHECK (epoch > 0),
  principal_kind      text NOT NULL CHECK (principal_kind IN ('authenticated_user','verified_contact_guest')),
  bound_user_id       uuid,
  bound_contact_hash  text CHECK (bound_contact_hash IS NULL OR bound_contact_hash ~ '^[0-9a-f]{64}$'),
  capability_hash     text NOT NULL UNIQUE CHECK (capability_hash ~ '^[0-9a-f]{64}$'),
  state               text NOT NULL DEFAULT 'active'
                        CHECK (state IN ('active','revoked','expired','converted')),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  converted_at        timestamptz,
  converted_order_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_event_access_grants_principal_binding CHECK (
    (principal_kind = 'authenticated_user'      AND bound_user_id IS NOT NULL)
    OR (principal_kind = 'verified_contact_guest' AND bound_contact_hash IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS private_event_access_grants_event_epoch_idx
  ON public.private_event_access_grants (event_id, epoch) WHERE state = 'active';

-- 1.5 — one-use, <=2-minute web/native exchange handoffs.
CREATE TABLE IF NOT EXISTS public.private_event_access_handoffs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id     uuid NOT NULL REFERENCES public.private_event_access_grants(id) ON DELETE CASCADE,
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  epoch        bigint NOT NULL CHECK (epoch > 0),
  code_hash    text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','consumed','revoked','expired')),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 1.6 — append-only bounded operational events. Opaque IDs and stable reason classes
-- only: never a raw token, code, capability, contact, IP, user agent or provider secret.
CREATE TABLE IF NOT EXISTS public.private_event_access_security_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      uuid REFERENCES public.events(id) ON DELETE CASCADE,
  subject_kind  text NOT NULL CHECK (subject_kind IN ('challenge','grant','handoff','revocation','rate_limit','transition','origin')),
  subject_id    uuid,
  reason_class  text NOT NULL CHECK (char_length(reason_class) BETWEEN 3 AND 64),
  abuse_key_hash text CHECK (abuse_key_hash IS NULL OR abuse_key_hash ~ '^[0-9a-f]{64}$'),
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS private_event_access_security_events_event_idx
  ON public.private_event_access_security_events (event_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.issue_1931_security_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'private_access_security_events_append_only';
END $function$;

DROP TRIGGER IF EXISTS issue_1931_security_events_append_only ON public.private_event_access_security_events;
CREATE TRIGGER issue_1931_security_events_append_only
  BEFORE UPDATE OR DELETE ON public.private_event_access_security_events
  FOR EACH ROW EXECUTE FUNCTION public.issue_1931_security_events_append_only();

-- 1.7 — singleton runtime capability row. DEFAULT FALSE and, this release, unable to
-- become true by any path (SC-45).
CREATE TABLE IF NOT EXISTS public.private_event_access_runtime (
  singleton                   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled                     boolean NOT NULL DEFAULT false,
  enabled_at                  timestamptz,
  disabled_at                 timestamptz,
  -- Amendment 4 §F.1: (b) and (c) are RECORDED OPERATOR ATTESTATIONS, not
  -- database-verifiable facts. PostgreSQL cannot observe either, and this schema
  -- must not imply otherwise.
  revocation_execute_attestation text,
  provider_test_leg_attestation  text,
  schema_smoke_attestation       text,
  attested_by                    text,
  attested_at                    timestamptz
);
INSERT INTO public.private_event_access_runtime (singleton, enabled)
VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;

-- 1.8 — private media metadata (Amendment 1 §2). No raw provider locator is ever
-- exposed through any client view or RPC.
CREATE TABLE IF NOT EXISTS public.private_event_media (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  access_epoch        bigint NOT NULL CHECK (access_epoch > 0),
  kind                text NOT NULL CHECK (kind IN ('cover','poster','gallery','video')),
  ordinal             integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  opaque_media_id     text NOT NULL UNIQUE CHECK (opaque_media_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  provider            text NOT NULL CHECK (provider IN ('supabase_private','bunny_private')),
  provider_object_id  text NOT NULL,
  mime_type           text,
  byte_length         bigint CHECK (byte_length IS NULL OR byte_length >= 0),
  checksum_sha256     text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  lifecycle           text NOT NULL DEFAULT 'preparing'
                        CHECK (lifecycle IN ('preparing','ready','revoking','revoked','failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_event_media_slot_unique UNIQUE (event_id, access_epoch, kind, ordinal)
);

-- 1.9 — the ONE persisted fail-closed transition authority (Amendment 2 §A).
-- One active row per event. This is the sole relation the ordinary-read predicate reads.
CREATE TABLE IF NOT EXISTS public.event_private_media_transition_jobs (
  transition_id                          uuid PRIMARY KEY,
  event_id                               uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  direction                              text NOT NULL CHECK (direction IN ('enter_private','leave_private')),
  target_visibility                      text NOT NULL CHECK (target_visibility IN ('private','public','hidden')),
  state                                  text NOT NULL DEFAULT 'preparing' CHECK (state IN (
                                            'preparing','ready_to_finalize','finalizing','completed',
                                            'failed_retryable','failed_manual_review','cleanup_pending',
                                            'cancelled_pre_revoke')),
  ordinary_read_blocked_at               timestamptz,
  expected_event_updated_at              timestamptz NOT NULL,
  source_fingerprint                     text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_snapshot                        jsonb,
  controlled_origin_revocation_started_at   timestamptz,
  controlled_origin_revocation_completed_at timestamptz,
  private_epoch_before                   bigint,
  attempt                                integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  error_class                            text CHECK (error_class IS NULL OR char_length(error_class) <= 64),
  created_at                             timestamptz NOT NULL DEFAULT now(),
  updated_at                             timestamptz NOT NULL DEFAULT now()
);

-- "One active row per event" is an invariant, not a convention.
CREATE UNIQUE INDEX IF NOT EXISTS event_private_media_transition_jobs_one_active
  ON public.event_private_media_transition_jobs (event_id)
  WHERE state NOT IN ('completed','cancelled_pre_revoke');

CREATE INDEX IF NOT EXISTS event_private_media_transition_jobs_block_idx
  ON public.event_private_media_transition_jobs (event_id)
  WHERE ordinary_read_blocked_at IS NOT NULL
    AND state NOT IN ('completed','cancelled_pre_revoke');

-- 1.10 — FROZEN ITEM 5 SCHEMA, LANDED INERT (Amendment 6 §B.2).
-- The legacy `?oi=` ingress is frozen IN FULL. This table is the zero-authority
-- resume-handle store the ingress will need at freeze-lift. It is landed here ONLY so
-- SC-51's sole-#1931-migration rule survives freeze-lift without a second migration.
--
-- It is INERT AND UNREACHABLE: service-only, forced RLS, revoked from PUBLIC/anon/
-- authenticated, and NO released code path — SQL, Edge, Vercel or client — reads or
-- writes it. There is no released interceptor that could reach it (SC-55(b)), and no
-- released #1931 SQL references it below this statement.
CREATE TABLE IF NOT EXISTS public.private_event_legacy_resume_handles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  handle_hash       text NOT NULL UNIQUE CHECK (handle_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text CHECK (browser_binding_hash IS NULL OR browser_binding_hash ~ '^[0-9a-f]{64}$'),
  state             text NOT NULL DEFAULT 'pending_identity_proof'
                      CHECK (state IN ('pending_identity_proof','consumed','expired','revoked')),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---- Uniform service-only posture for every #1931 relation -------------------------
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'private_event_access_state',
    'private_event_invite_token_epochs',
    'private_event_access_challenges',
    'private_event_access_grants',
    'private_event_access_handoffs',
    'private_event_access_security_events',
    'private_event_access_runtime',
    'private_event_media',
    'event_private_media_transition_jobs',
    'private_event_legacy_resume_handles'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', r);
  END LOOP;
END $$;

-- =====================================================================================
-- SECTION 2 — SPEC §8 item 4: inert additive columns (Amendment 4 §D.2, Amendment 5 §E)
--
-- Nullable, NO DEFAULT, NO NOT NULL, NO CHECK, NO trigger, NO rewrite, NO foreign key
-- to any pre-existing table, NO index (Amendment 5 §E.2 struck the partial index).
-- NO released code path writes or reads them (SC-54).
-- =====================================================================================

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS issue_1931_grant_id       uuid REFERENCES public.private_event_access_grants(id),
  ADD COLUMN IF NOT EXISTS issue_1931_token_epoch_id uuid REFERENCES public.private_event_invite_token_epochs(id),
  ADD COLUMN IF NOT EXISTS issue_1931_access_epoch   bigint,
  ADD COLUMN IF NOT EXISTS issue_1931_principal_kind text;

ALTER TABLE public.ticket_checkout_provider_attempts
  ADD COLUMN IF NOT EXISTS issue_1931_grant_id     uuid REFERENCES public.private_event_access_grants(id),
  ADD COLUMN IF NOT EXISTS issue_1931_access_epoch bigint;

-- SC-54(d) — the `supabase_realtime` publication carries NO column list
-- (20260606000100_orch_0852_realtime_checkout_sessions.sql:28), so the published set is
-- the whole row and an added column silently enters the buyer-facing replication tuple
-- consumed by `useOrderRealtimeSubscription` at three mount sites. Pin the published
-- column set to exactly the pre-#1931 set. The set is computed from the catalog rather
-- than hard-coded, so this is correct under drift.
DO $$
DECLARE
  v_cols text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public'
       AND tablename='ticket_checkout_sessions'
  ) THEN
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
      INTO v_cols
      FROM pg_attribute a
     WHERE a.attrelid = 'public.ticket_checkout_sessions'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname NOT LIKE 'issue\_1931\_%';

    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.ticket_checkout_sessions';
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_checkout_sessions (%s)',
      v_cols);
  END IF;
END $$;

-- =====================================================================================
-- SECTION 3 — the ordinary-reader predicate, exposed through EXACTLY ONE helper
-- (Amendment 4 §B.3)
-- =====================================================================================

-- The authoritative Amendment 2 §A predicate and nothing else. Returns a bare boolean:
-- it exposes no job field, no snapshot value, no provider locator and no error text
-- (Amendment 4 §B.3.4).
--
-- SECURITY DEFINER and postgres-owned so that invoker-rights readers evaluated as
-- `anon` — the `events` SELECT policy, `events_public_view`,
-- `events_with_master_date_view` — can call it without `anon` ever holding a privilege
-- on `event_private_media_transition_jobs`. `postgres` carries BYPASSRLS, so the
-- FORCE ROW LEVEL SECURITY posture Amendment 2 §A mandates on the jobs table and
-- SC-53(c)'s no-vacuity requirement are satisfied simultaneously (Amendment 5 §F.5).
CREATE OR REPLACE FUNCTION public.issue_1931_event_ordinary_read_blocked(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.event_private_media_transition_jobs j
     WHERE j.event_id = p_event_id
       AND j.ordinary_read_blocked_at IS NOT NULL
       AND j.state NOT IN ('completed','cancelled_pre_revoke')
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_1931_event_ordinary_read_blocked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_1931_event_ordinary_read_blocked(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.issue_1931_event_ordinary_read_blocked(uuid) IS
  '#1931 Amendment 2 §A ordinary-reader predicate. TRUE only while an active transition '
  'job has installed an ordinary-read block for the event. Deny-only: it can remove rows '
  'or raise a denial and can never admit a read that the landed definition denies.';

-- =====================================================================================
-- SECTION 4 — readiness and the operator RPC (base SPEC §3, Amendment 3 §3.2,
-- Amendment 4 §F)
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.issue_1931_private_event_access_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE((SELECT enabled FROM public.private_event_access_runtime WHERE singleton), false)
$function$;

REVOKE ALL ON FUNCTION public.issue_1931_private_event_access_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1931_private_event_access_ready() TO service_role;

-- Amendment 4 §F.2 — for THIS release the operator RPC is UNCONDITIONALLY unable to
-- return true, by an explicit hard refusal that is independent of all four evidence
-- gates and raises exactly `private_access_release_frozen`.
--
-- The refusal is the FIRST executable statement in the body. It cannot be reached
-- around, and no argument value can bypass it. The four-check logic and its own revert
-- criterion are DEFERRED to the freeze-lift amendment as SC-45B and are not authorized
-- now.
CREATE OR REPLACE FUNCTION public.issue_1931_enable_private_event_access(
  p_revocation_execute_attestation text,
  p_provider_test_leg_attestation  text,
  p_schema_smoke_attestation       text,
  p_attested_by                    text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- #1931 released set: the frozen set stays frozen regardless of any evidence.
  -- Amendment 3 §5 frozen item 1 requires this RPC be PROVABLY unable to return true.
  RAISE EXCEPTION 'private_access_release_frozen';
END $function$;

REVOKE ALL ON FUNCTION public.issue_1931_enable_private_event_access(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1931_enable_private_event_access(text,text,text,text)
  TO service_role;

COMMENT ON FUNCTION public.issue_1931_enable_private_event_access(text,text,text,text) IS
  '#1931 operator arming RPC. FROZEN for this release: raises private_access_release_frozen '
  'unconditionally and can never set readiness true. Checks (b) and (c) of Amendment 3 §3.2 '
  'are RECORDED OPERATOR ATTESTATIONS, not database-verifiable facts (Amendment 4 §F.1).';

-- =====================================================================================
-- SECTION 5 — service-only access, media and transition authority
-- (Amendment 3 §5 released item 2, LESS the legacy-exchange RPC which is FROZEN)
--
-- Every one of these denies while readiness is false (SC-46). The readiness check is
-- the FIRST executable statement in each body, so each denial fixture fails for the
-- readiness reason and no other.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.issue_1931_rotate_private_event_access_epoch(
  p_event_id uuid, p_new_visibility text, p_transition_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;
  RAISE EXCEPTION 'private_access_not_ready';
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1931_prepare_private_event_media(
  p_event_id uuid, p_expected_revision timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;
  RAISE EXCEPTION 'private_access_not_ready';
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1931_begin_enter_private(
  p_event_id uuid, p_expected_updated_at timestamptz, p_source_fingerprint text, p_transition_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;
  RAISE EXCEPTION 'private_access_not_ready';
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1931_finalize_enter_private(p_transition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;
  RAISE EXCEPTION 'private_access_not_ready';
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1931_cancel_enter_private(p_transition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;
  RAISE EXCEPTION 'private_access_not_ready';
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1931_begin_leave_private(
  p_event_id uuid, p_target_visibility text, p_expected_updated_at timestamptz,
  p_source_fingerprint text, p_transition_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;
  RAISE EXCEPTION 'private_access_not_ready';
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1931_finalize_leave_private(p_transition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;
  RAISE EXCEPTION 'private_access_not_ready';
END $function$;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'issue_1931_rotate_private_event_access_epoch(uuid,text,uuid)',
    'issue_1931_prepare_private_event_media(uuid,timestamptz)',
    'issue_1931_begin_enter_private(uuid,timestamptz,text,uuid)',
    'issue_1931_finalize_enter_private(uuid)',
    'issue_1931_cancel_enter_private(uuid)',
    'issue_1931_begin_leave_private(uuid,text,timestamptz,text,uuid)',
    'issue_1931_finalize_leave_private(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', s);
  END LOOP;
END $$;

-- =====================================================================================
-- SECTION 6 — centralized ordinary-reader blocking (Amendment 3 §5 released item 3)
--
-- DENY-ONLY (Amendment 4 §B.2.1): every insertion below is a conjunct that can only
-- remove rows or raise the object's OWN landed denial. None is paired with an admitting
-- branch. Each body is re-emitted forward at the body resolved by the implementation-
-- time per-object latest-definer scan (Amendment 4 §B.1.1); the scan output and the
-- per-object body diffs are attached to the implementation report.
--
-- Set (A) — the derived members carrying the block — is exactly the SC-53 floor:
-- the objects Amendment 2 §A names by identifier. Set (B), the exclusion register with
-- per-object evidenced reasons, is attached to the implementation report.
-- =====================================================================================

-- 6.1 — the `events` SELECT policy for anon/authenticated.
-- Latest definer: 20260515000005_orch_0763d_event_lifecycle_repair.sql:105-114 (invoker
-- rights — the USING expression runs with the querying role's privileges, which is why
-- it must call the helper and must never name the jobs table; SC-53(a)).
DROP POLICY IF EXISTS "Public can read published events (anon or authenticated)" ON public.events;
CREATE POLICY "Public can read published events (anon or authenticated)"
ON public.events
FOR SELECT
TO authenticated, anon
USING (
  deleted_at IS NULL
  AND visibility = 'public'
  AND status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
  AND NOT public.issue_1931_event_ordinary_read_blocked(id)
);

-- 6.2 — events_public_view. Latest definer:
-- 20260505000000_baseline_squash_orch_0729.sql:8250 (security_invoker='true').
CREATE OR REPLACE VIEW "public"."events_public_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "brand_id",
    "title",
    "description",
    "slug",
    "location_text",
    "location_geo",
    "online_url",
    "is_online",
    "is_recurring",
    "is_multi_date",
    "recurrence_rules",
    "cover_media_url",
    "cover_media_type",
    "theme",
    "organiser_contact",
    "visibility",
    "show_on_discover",
    "show_in_swipeable_deck",
    "status",
    "published_at",
    "timezone",
    "created_at",
    "updated_at"
   FROM "public"."events"
  WHERE (("deleted_at" IS NULL) AND ("visibility" = 'public'::"text") AND ("status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"]))
    AND NOT "public"."issue_1931_event_ordinary_read_blocked"("id"));

-- 6.3 — business_public_events_view
-- Latest definer resolved at implementation time: 20270116000869_issue_868_cover_gallery_read_layer.sql:862 (security_invoker=false — definer rights, so it does NOT inherit the events RLS block and needs its own conjunct)
CREATE OR REPLACE VIEW public.business_public_events_view AS
  SELECT e.id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    b.description AS brand_description,
    b.profile_photo_url AS brand_profile_photo_url,
    b.display_attendee_count AS brand_display_attendee_count,
    b.address AS brand_address,
    b.cover_media_url AS brand_cover_media_url,
    b.theme_color AS brand_theme_color,
    b.theme_font AS brand_theme_font,
    b.theme_animation AS brand_theme_animation,
    e.title,
    e.description,
    e.slug,
    e.event_type,
    e.location_text,
    e.online_url,
    e.is_online,
    e.is_recurring,
    e.is_multi_date,
    e.recurrence_rules,
    e.cover_media_url,
    e.cover_media_type,
    e.visibility,
    e.show_on_discover,
    e.status,
    e.published_at,
    e.timezone,
    e.created_at,
    e.updated_at,
    (e.theme - 'business_draft'::text) AS public_theme,
    e.theme_color_override,
    e.theme_font_override,
    e.theme_animation_override,
    e.currency,
    e.cover_media_provider,
    e.cover_media_source_url,
    e.cover_media_credit,
    e.cover_media_credit_url,
    e.cover_media_alt,
    ed.start_at AS master_start_at,
    ed.end_at AS master_end_at,
    ed.timezone AS master_timezone,
    ed.id AS master_event_date_id,
    e.city,
    e.party_types,
    e.vibe_tags,
    e.music_genres,
    e.location_geo,
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region   AS pricing_region,
    b.pricing_currency AS pricing_currency,
    (e.pricing_locked_at IS NOT NULL) AS pricing_locked,
    (
      SELECT public.compute_all_in_cents(
               MIN(tt.price_cents),
               COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
               COALESCE(e.pass_service_fee, b.default_pass_service_fee),
               (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
             )
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.price_cents > 0
        AND tt.deleted_at IS NULL
    ) AS display_price_cents,
    -- ORCH-1150 RSVP host-control columns (inert for non-RSVP rows).
    e.rsvp_discoverable,
    e.rsvp_capacity,
    e.rsvp_allow_plus_ones,
    e.rsvp_plus_ones_max,
    e.rsvp_waitlist_enabled,
    e.rsvp_approval_mode,
    (
      SELECT COALESCE(SUM(1 + r.plus_count), 0)::integer
      FROM public.event_rsvps r
      WHERE r.event_id = e.id
        AND r.rsvp_status = 'going'
        AND r.approval_status = 'approved'
    ) AS rsvp_going_count,
    -- ORCH-1167 — city-level privacy centroid. location_geo (the exact pin) is
    -- unchanged at its position.
    e.city_geo,
    -- ORCH-1291 [rsvp-chip-in] — voluntary contribution config. Appended LAST so
    -- CREATE OR REPLACE keeps every existing column's name, type AND order. Inert
    -- (enabled=false, amounts NULL) for every non-chip-in event; the shared
    -- RsvpOfferingBody renders the guest panel only when enabled reaches it.
    e.rsvp_contribution_enabled,
    e.rsvp_contribution_suggested_cents,
    e.rsvp_contribution_min_cents,
    -- issue #868 [cover-gallery] — ADDITIONAL image/GIF gallery items (hero
    -- indices 1..N). Appended LAST so CREATE OR REPLACE keeps every existing
    -- column's name, type AND order. INDEPENDENT of cover_media_url/_type; the
    -- buyer-web mapper (publicEventViewRowToEvent) + SSR socialPreview (select *)
    -- read it, defaulting [] when absent.
    e.cover_media_gallery
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.visibility = 'public'::text
    AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]))
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);

-- 6.4 — pg_public_event_by_slug
-- Latest definer resolved at implementation time: 20270116000869_issue_868_cover_gallery_read_layer.sql:25 (definer). #1931 ADDS the executable fixture Amendment 4 §B.1.2 mandates before re-emitting it.
CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(
  p_brand_slug text,
  p_event_slug text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      (e.theme - 'business_draft'::text) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      COALESCE(
        ((e.theme #>> '{business_event,hideAddressUntilTicket}')::boolean),
        true
      ) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'event'           -- standard ticketed ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text),
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev;
$function$;

-- 6.5 — pg_direct_event_checkout_bundle
-- Latest definer resolved at implementation time: 20270324001929_issue_1929_hidden_direct_checkout.sql:3 (definer, anon-EXECUTE, allowlisted). Reuses the landed NULL-on-denial contract; #1931 adds no new return shape (Amendment 4 §B.2.3).
CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(
  p_event_id uuid DEFAULT NULL,
  p_brand_slug text DEFAULT NULL,
  p_event_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      (e.theme - 'business_draft'::text) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      COALESCE(
        ((e.theme #>> '{business_event,hideAddressUntilTicket}')::boolean),
        true
      ) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.address       AS brand_address,
      b.cover_media_url AS brand_cover_media_url,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE (
      (p_event_id IS NOT NULL AND p_brand_slug IS NULL AND p_event_slug IS NULL AND e.id = p_event_id)
      OR
      (p_event_id IS NULL
       AND NULLIF(pg_catalog.btrim(p_brand_slug), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(p_event_slug), '') IS NOT NULL
       AND b.slug = p_brand_slug
       AND e.slug = p_event_slug)
    )
      AND e.event_type = 'event'
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE pg_catalog.json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text),
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.location_geo::public.geometry),
          'lng', public.ST_X(ev.location_geo::public.geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.city_geo),
          'lng', public.ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', pg_catalog.json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'address', ev.brand_address,
        'coverMediaUrl', ev.brand_cover_media_url,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev;
$function$;

-- 6.6 — pg_discover_business_events
-- Latest definer resolved at implementation time: 20270323001919_issue_1919_provider_neutral_paid_readiness.sql:3591 (definer, anon-EXECUTE, allowlisted)
CREATE OR REPLACE FUNCTION public.pg_discover_business_events(
  p_cities text[],
  p_lower_bound timestamptz,
  p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL,
  p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20,
  p_center_lng double precision DEFAULT NULL,   -- issue #1020 geo-radius fallback
  p_center_lat double precision DEFAULT NULL,   -- issue #1020 geo-radius fallback
  p_radius_km double precision DEFAULT NULL     -- issue #1020 geo-radius fallback
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH base AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug,
      e.location_text,
      e.location_geo,
      e.online_url,
      e.is_online,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      e.timezone,
      e.currency,
      e.city,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.event_type,
      b.slug AS brand_slug,
      b.name AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      ed.start_at AS master_start_at,
      ed.end_at AS master_end_at,
      ed.timezone AS master_timezone,
      (
        SELECT MIN(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_min_cents,
      (
        SELECT MAX(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_max_cents,
      EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.available_online IS TRUE
          AND tt.price_cents > 0
      ) AS has_paid_online,
      (
        SELECT public.compute_all_in_cents(
          MIN(tt.price_cents),
          COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
          COALESCE(e.pass_service_fee, b.default_pass_service_fee),
          (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
        )
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.price_cents > 0
          AND tt.deleted_at IS NULL
      ) AS display_price_cents,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    INNER JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    INNER JOIN public.event_dates ed
      ON ed.event_id = e.id
     AND ed.is_master IS TRUE
     AND ed.end_at >= p_lower_bound
    WHERE e.deleted_at IS NULL
      AND e.visibility = 'public'
      -- ORCH-1150: admit opted-in RSVP rows alongside ticketed events.
      AND ( e.event_type = 'event'
         OR (e.event_type = 'rsvp' AND e.rsvp_discoverable = true) )
      AND e.status = ANY (ARRAY['scheduled', 'live'])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      -- issue #1020: geo-radius OR-fallback on the venue pin. A sub-municipality
      -- venue (city label != browsed city) still surfaces when its pin sits inside
      -- the browsed metro radius; also rescues NULL-city rows that carry a pin.
      -- Every PostGIS symbol AND both type names are public.-qualified because
      -- this function runs under SET search_path = '' (bare ST_*/geometry/geography
      -- would throw does-not-exist). ST_DWithin on geography takes metres.
      AND (
            e.city = ANY (p_cities)
         OR (
              p_center_lng IS NOT NULL
              AND p_center_lat IS NOT NULL
              AND p_radius_km  IS NOT NULL
              AND e.location_geo IS NOT NULL
              AND public.ST_DWithin(
                    public.ST_SetSRID(e.location_geo::public.geometry, 4326)::public.geography,
                    public.ST_SetSRID(public.ST_MakePoint(p_center_lng, p_center_lat), 4326)::public.geography,
                    p_radius_km * 1000
                  )
            )
      )
      AND (p_upper_start IS NULL OR ed.start_at <= p_upper_start)
      AND (p_party_types IS NULL OR cardinality(p_party_types) = 0 OR e.party_types && p_party_types)
      AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags) = 0 OR e.vibe_tags && p_vibe_tags)
      AND (p_music_genres IS NULL OR cardinality(p_music_genres) = 0 OR e.music_genres && p_music_genres)
  ),
  gated AS (
    SELECT *
    FROM base
    WHERE NOT (has_paid_online AND NOT public.pg_brand_can_collect(brand_id))
  ),
  ranked AS (
    SELECT
      g.*,
      COUNT(*) OVER () AS total_count
    FROM gated g
    ORDER BY master_start_at ASC NULLS LAST
    OFFSET GREATEST(p_offset, 0)
    LIMIT GREATEST(p_limit, 0)
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT total_count FROM ranked LIMIT 1), 0),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'brand_id', r.brand_id,
            'title', r.title,
            'description', r.description,
            'slug', r.slug,
            'location_text', r.location_text,
            'location_geo', r.location_geo,
            'online_url', r.online_url,
            'is_online', r.is_online,
            'cover_media_url', r.cover_media_url,
            'cover_media_type', r.cover_media_type,
            'theme', r.theme,
            'timezone', r.timezone,
            'currency', r.currency,
            'city', r.city,
            'party_types', r.party_types,
            'vibe_tags', r.vibe_tags,
            'music_genres', r.music_genres,
            'event_type', r.event_type,
            'brand_slug', r.brand_slug,
            'brand_name', r.brand_name,
            'brand_profile_photo_url', r.brand_profile_photo_url,
            'master_start_at', r.master_start_at,
            'master_end_at', r.master_end_at,
            'master_timezone', r.master_timezone,
            'price_min_cents', r.price_min_cents,
            'price_max_cents', r.price_max_cents,
            'display_price_cents', r.display_price_cents,
            'pricing_currency', r.pricing_currency
          )
          ORDER BY r.master_start_at ASC NULLS LAST
        )
        FROM ranked r
      ),
      '[]'::jsonb
    )
  );
$function$;

-- 6.7 — pg_public_ticket_types_remaining
-- Latest definer resolved at implementation time: 20260724000006_orch_0946_public_ticket_types_remaining.sql:18 (definer, anon-EXECUTE, allowlisted). #1931 ADDS the executable fixture Amendment 4 §B.1.2 mandates before re-emitting it.
CREATE OR REPLACE FUNCTION public.pg_public_ticket_types_remaining(
  p_event_id uuid
)
RETURNS TABLE (
  ticket_type_id uuid,
  sold           integer,
  remaining      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    tt.id AS ticket_type_id,
    COALESCE(s.sold, 0)::int AS sold,
    CASE
      WHEN tt.is_unlimited THEN NULL
      WHEN tt.quantity_total IS NULL THEN NULL
      ELSE GREATEST(tt.quantity_total - COALESCE(s.sold, 0), 0)::int
    END AS remaining
  FROM public.ticket_types tt
  LEFT JOIN (
    SELECT t.ticket_type_id, COUNT(*)::int AS sold
    FROM public.tickets t
    WHERE t.status IN ('valid', 'used', 'transferred')
    GROUP BY t.ticket_type_id
  ) s ON s.ticket_type_id = tt.id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND NOT public.issue_1931_event_ordinary_read_blocked(p_event_id);
$$;

-- 6.8 — pg_public_social_proof
-- Latest definer resolved at implementation time: 20261225000000_orch_1338_social_proof_guest_reads.sql:71 (definer, anon-EXECUTE, allowlisted)
CREATE OR REPLACE FUNCTION public.pg_public_social_proof(
  p_event_id uuid
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event          record;
  v_private        boolean;
  v_hide_remaining boolean;
  v_viewer         uuid;
  v_going          bigint  := 0;
  v_capacity       integer := NULL;
  v_sample         json    := '[]'::json;
BEGIN
  -- GUARD 1 — resolve the event row (public + live-page status set; no data
  -- read happens unless this passes).
  SELECT e.id, e.event_type, e.rsvp_capacity, e.theme
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.visibility = 'public'::text
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
     AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- GUARD 2 — host gates, read server-side from the resolved row (D2).
  v_private := COALESCE(
    (v_event.theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false);
  v_hide_remaining := COALESCE(
    (v_event.theme #>> '{business_event,settings,hideRemainingCount}')::boolean,
    false);

  -- GUARD 3 — viewer (NULL for anon). Drives block-exclusion of the sample
  -- only; the anon and authed payload SHAPES are identical (D1).
  v_viewer := auth.uid();

  IF v_event.event_type = 'rsvp' THEN
    -- [ORCH-1338 FN-A RSVP-BRANCH-BEGIN] (COMMS-0057: reads event_rsvps ONLY)
    -- Going = SUM(1 + plus_count) over going+approved rows — byte-identical to
    -- pg_public_rsvp_by_slug / submit_event_rsvp (ORCH-1150 maybe = cap-neutral).
    SELECT COALESCE(SUM(1 + r.plus_count), 0)
      INTO v_going
      FROM public.event_rsvps r
     WHERE r.event_id = v_event.id
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved';

    v_capacity := v_event.rsvp_capacity; -- NULL = unlimited (open invite).

    IF NOT v_private THEN
      -- Avatar-cluster sample: first-in going+approved LINKED guests whose
      -- profile is non-private AND carries a real avatar (glyph fill comes
      -- from the count client-side — 15% avatar reality, F-6/F-11).
      SELECT COALESCE(json_agg(json_build_object(
               'avatarUrl', s.avatar_url,
               'isMinglaUser', true
             ) ORDER BY s.sort_created_at ASC, s.sort_row_id ASC), '[]'::json)
        INTO v_sample
        FROM (
          SELECT p.avatar_url,
                 r.created_at AS sort_created_at,
                 r.id         AS sort_row_id
            FROM public.event_rsvps r
            JOIN public.profiles p ON p.id = r.user_id
           WHERE r.event_id = v_event.id
             AND r.rsvp_status = 'going'
             AND r.approval_status = 'approved'
             AND r.user_id IS NOT NULL
             AND p.visibility_mode IN ('public', 'friends')
             AND p.avatar_url IS NOT NULL
             AND length(btrim(p.avatar_url)) > 0
             AND (
               v_viewer IS NULL
               OR (NOT public.is_blocked_by(p.id, v_viewer)
                   AND NOT public.is_blocked_by(v_viewer, p.id))
             )
           ORDER BY r.created_at ASC, r.id ASC
           LIMIT 5
        ) s;
    END IF;
    -- [ORCH-1338 FN-A RSVP-BRANCH-END]
  ELSE
    -- [ORCH-1338 FN-A TICKETED-BRANCH-BEGIN] (COMMS-0057: reads tickets /
    -- ticket_types / orders ONLY — event / trip / experience)
    -- Going = ABSOLUTE count of live tickets (ORCH-0946 sold formula, matches
    -- biz_ticket_checkout_create_session). Computed under DEFINER — this is
    -- the F-3 fix: no more deriving sold from per-tier remaining, no
    -- unlimited-capacity hole.
    SELECT COUNT(*)
      INTO v_going
      FROM public.tickets t
     WHERE t.event_id = v_event.id
       AND t.status IN ('valid', 'used', 'transferred');

    -- Capacity: NULL iff ANY non-deleted tier is unlimited/uncapped (rule 9 —
    -- scarcity is never fabricated from partial capacity), else Σ quantity_total.
    SELECT CASE
             WHEN EXISTS (
               SELECT 1
                 FROM public.ticket_types tt
                WHERE tt.event_id = v_event.id
                  AND tt.deleted_at IS NULL
                  AND (COALESCE(tt.is_unlimited, false) OR tt.quantity_total IS NULL)
             ) THEN NULL
             ELSE (
               SELECT SUM(tt.quantity_total)::integer
                 FROM public.ticket_types tt
                WHERE tt.event_id = v_event.id
                  AND tt.deleted_at IS NULL
             )
           END
      INTO v_capacity;

    IF NOT v_private THEN
      -- Sample = DISTINCT order BUYERS owning ≥1 live ticket (D3: buyers only;
      -- seats carry no identity), first-in by earliest order, same profile
      -- privacy + avatar + block predicates as the RSVP branch.
      SELECT COALESCE(json_agg(json_build_object(
               'avatarUrl', s.avatar_url,
               'isMinglaUser', true
             ) ORDER BY s.first_order_at ASC, s.buyer_id ASC), '[]'::json)
        INTO v_sample
        FROM (
          SELECT p.avatar_url,
                 buyers.first_order_at,
                 buyers.buyer_id
            FROM (
              SELECT o.buyer_user_id     AS buyer_id,
                     MIN(o.created_at)   AS first_order_at
                FROM public.orders o
                JOIN public.tickets t
                  ON t.order_id = o.id
                 AND t.status IN ('valid', 'used', 'transferred')
               WHERE o.event_id = v_event.id
                 AND o.buyer_user_id IS NOT NULL
               GROUP BY o.buyer_user_id
            ) buyers
            JOIN public.profiles p ON p.id = buyers.buyer_id
           WHERE p.visibility_mode IN ('public', 'friends')
             AND p.avatar_url IS NOT NULL
             AND length(btrim(p.avatar_url)) > 0
             AND (
               v_viewer IS NULL
               OR (NOT public.is_blocked_by(p.id, v_viewer)
                   AND NOT public.is_blocked_by(v_viewer, p.id))
             )
           ORDER BY buyers.first_order_at ASC, buyers.buyer_id ASC
           LIMIT 5
        ) s;
    END IF;
    -- [ORCH-1338 FN-A TICKETED-BRANCH-END]
  END IF;

  RETURN json_build_object(
    'eventId', v_event.id,
    'entityType', v_event.event_type,
    'goingCount', v_going,
    'capacity', v_capacity,
    'privateGuestList', v_private,
    'hideRemainingCount', v_hide_remaining,
    'sample', v_sample
  );
END;
$function$;

-- 6.9 — pg_public_brand_upcoming
-- Latest definer resolved at implementation time: 20270323001919_issue_1919_provider_neutral_paid_readiness.sql:3476 (definer, anon-EXECUTE, allowlisted)
CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(
  p_brand_slug text,
  p_cursor_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  offering_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  offering_type text,
  offering_slug text,
  title text,
  description text,
  cover_media_url text,
  cover_media_type text,
  theme jsonb,
  starts_at timestamptz,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH offerings AS (
    SELECT
      e.id AS offering_id,
      e.brand_id,
      b.slug AS brand_slug,
      b.name AS brand_name,
      e.event_type AS offering_type,
      e.slug AS offering_slug,
      e.title,
      e.description,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      CASE e.event_type
        WHEN 'event' THEN ed.start_at
        WHEN 'rsvp' THEN ed.start_at
        WHEN 'trip' THEN ed.start_at
        WHEN 'experience' THEN NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz
      END AS starts_at,
      (
        SELECT min(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
      ) AS price_from_cents,
      e.currency::text AS currency,
      (
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.ticket_types tt
          WHERE tt.event_id = e.id
            AND tt.deleted_at IS NULL
            AND tt.price_cents > 0
        )
      ) AS is_free,
      e.published_at
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.published_at IS NOT NULL
      AND e.status IN ('scheduled', 'live')
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.ticket_types tt
           WHERE tt.event_id = e.id
             AND tt.available_online = true
             AND tt.deleted_at IS NULL
             AND tt.price_cents > 0
        )
        OR public.pg_brand_can_collect(e.brand_id)
      )
  )
  SELECT
    o.offering_id,
    o.brand_id,
    o.brand_slug,
    o.brand_name,
    o.offering_type,
    o.offering_slug,
    o.title,
    o.description,
    o.cover_media_url,
    o.cover_media_type,
    o.theme,
    o.starts_at,
    o.price_from_cents,
    o.currency,
    o.is_free,
    o.published_at
  FROM offerings o
  WHERE o.starts_at IS NOT NULL
    AND o.starts_at > COALESCE(p_cursor_at, now())
  ORDER BY o.starts_at ASC, o.published_at DESC
  LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1);
$function$;

-- 6.10 — biz_ticket_checkout_create_session
-- Latest definer resolved at implementation time: 20270403001930_issue_1930_checkout_current_truth.sql:916 (definer, service-role only). Reached by SC-53 clause (v): ticket-checkout-create/index.ts:529-530 invokes it by name on behalf of an unauthenticated buyer.
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,p_buyer_user_id uuid,p_buyer_name text,p_buyer_email text,
  p_buyer_phone_e164 text,p_marketing_opt_in boolean,p_lines jsonb,
  p_idempotency_key text,p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_existing record;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  -- Preserve the canonical fresh-checkout error vocabulary consumed by the
  -- #1929 direct-checkout clients. Current truth still runs before the legacy
  -- idempotency owner; only the public token remains backward-compatible.
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;
  -- #1931 Amendment 4 §B.2.2 — deny-only conjunct reusing the EXISTING
  -- `event_not_selling` string, so the canonical fresh-checkout error vocabulary
  -- consumed by the #1929 direct-checkout clients is unchanged.
  IF public.issue_1931_event_ordinary_read_blocked(v_event.id) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- Preserve the canonical ORCH-0791 / ORCH-0829-B replay contract in the
  -- latest public authority. Current event truth is locked and accepted before
  -- any in-flight continuation can be returned.
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

  -- Keep the wrapper response explicit so the public authority owns the same
  -- stable checkout contract on both replay and fresh-session paths.
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
END $$;

-- =====================================================================================
-- SECTION 7 — preexisting Private rows are backfilled as `needs_setup`, NEVER activated
-- (Amendment 1 §3, SC-35)
--
-- Old links and old grants are never reactivated or silently attached. epoch stays 0 and
-- active stays false, so nothing here can admit a read or a checkout. Until an organiser
-- completes preparation and explicitly reissues invitations — both of which are FROZEN
-- this release — buyer and Consumer pages stay generic-unavailable and checkout stays
-- denied, which is exactly the state this release ships.
-- =====================================================================================

INSERT INTO public.private_event_access_state (event_id, epoch, active, setup_state, last_transition_reason)
SELECT e.id, 0, false, 'needs_setup', 'backfill_issue_1931'
  FROM public.events e
 WHERE e.visibility = 'private'
   AND e.deleted_at IS NULL
   AND e.event_type = 'event'
ON CONFLICT (event_id) DO NOTHING;

DO $$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.private_event_access_state
   WHERE setup_state = 'needs_setup' AND last_transition_reason = 'backfill_issue_1931';
  RAISE NOTICE '#1931 backfill: % preexisting Private standard event(s) recorded as needs_setup (none activated).', v_count;
END $$;

-- =====================================================================================
-- SECTION 8 — documentation of the released/frozen boundary, on the objects themselves
-- =====================================================================================

COMMENT ON TABLE public.event_private_media_transition_jobs IS
  '#1931 Amendment 2 §A single persisted fail-closed transition authority. One active row '
  'per event. Service-only, FORCE RLS, revoked from PUBLIC/anon/authenticated: ordinary '
  'readers reach it ONLY through public.issue_1931_event_ordinary_read_blocked().';

COMMENT ON TABLE public.private_event_legacy_resume_handles IS
  '#1931 FROZEN ITEM 5 schema, landed INERT under Amendment 6 §B.2. The legacy `?oi=` '
  'ingress is frozen in full; no released code path — SQL, Edge, Vercel or client — reads '
  'or writes this table. It exists only so SC-51''s sole-#1931-migration rule survives '
  'freeze-lift without a second migration.';

COMMENT ON COLUMN public.ticket_checkout_sessions.issue_1931_grant_id IS
  '#1931 SPEC §8 item 4 binding. INERT this release: nullable, no default, no check, no '
  'trigger, no index, and no released path reads or writes it (SC-54). Excluded from the '
  'supabase_realtime published column set.';

COMMIT;
