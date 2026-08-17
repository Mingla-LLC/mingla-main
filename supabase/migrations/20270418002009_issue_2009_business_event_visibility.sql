-- =====================================================================
-- issue #2009 — published ticketed-event visibility mutation.
--
-- Contract chain, in precedence order:
--   BINDING SPEC AMENDMENT 3  #issuecomment-5317187049  (CONTROLLING)
--   BINDING SPEC AMENDMENT 1  #issuecomment-5283729259
--   BINDING SPEC (original)   #issuecomment-5283447438  (SC-1..SC-24)
--   INVESTIGATION             #issuecomment-5283447211
--   AMENDMENT 2               #issuecomment-5284302847  (SC-31..37 HELD IN
--                             ABEYANCE by Amendment 3; only its §D Admin
--                             compatibility clause is implemented here)
--
-- WHAT THIS SHIPS (Amendment 3 §3 — the synchronous half only):
--   1. public.event_discovery_generation      — service-only singleton +
--      reader/bumper helpers (SC-14/SC-15 server half).
--   2. public.event_visibility_transition_effects — append-only, service-only
--      deterministic effect ledger keyed by transition_id (Amendment 1 §D).
--      NO `phase` column: the two-phase Private coordinator is out of scope.
--   3. public.business_set_event_visibility(...) — the narrow Business RPC.
--      Public <-> Unlisted is ONE synchronous change. Private fails closed
--      with the stable code `private_visibility_unavailable`.
--   4. A BEFORE UPDATE OF visibility guard on public.events that (a) fails
--      the Private boundary closed for EVERY writer while #2144 is frozen and
--      (b) blocks a direct `authenticated`/`anon` table UPDATE so PostgREST
--      cannot bypass the RPC (SC-8).
--   5. An AFTER UPDATE OF visibility coordinator that owns the discovery
--      generation increment, the exact OR-predicate share-revocation
--      cardinality (Amendment 1 §E) and the one effect row per real
--      transition.
--   6. public.admin_set_offering_visibility replaced (Amendment 2 §D, retained
--      by Amendment 3 §3): synchronous Public/Hidden behaviour preserved
--      byte-for-byte; any Private boundary on a standard ticketed event
--      returns the stable `private_transition_requires_business`. The Admin
--      client copy mapping already shipped with #1931 and is NOT duplicated.
--
-- SCOPE NARROWING, DELIBERATE AND DOCUMENTED:
--   Every #2009 guard below is scoped to `event_type = 'event'` — the standard
--   ticketed event, which is the ONLY offering the SPEC covers ("It covers
--   standard published ticketed events only"). RSVP rows are `event_type =
--   'rsvp'` and `biz_update_live_rsvp` writes `visibility = 'private'` for
--   them today; an unscoped Private block would break that shipped path and
--   violate SC-22. Trips and experiences are likewise untouched.
--
-- NOT SHIPPED HERE, BY INSTRUCTION (Amendment 3 §2):
--   the two-phase coordinator, the effects `phase` column, any issue_1931_*
--   call site, pending/retry/cancel machinery, and the discover-merged-events
--   consumption of the generation (Amendment 3 §4 does not allowlist the edge
--   function this pass; the generation is incremented and readable, the
--   Explorer read side lands with #2144's reconciliation).
--
-- Forward-only. Never down-migrate visibility/audit/share history.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Event-discovery generation — a dedicated service-only singleton.
--    NOT app_config: that table is broadly readable to `authenticated` and is
--    the wrong control plane for a privacy invalidation primitive (SPEC §4).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_discovery_generation (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton IS TRUE),
  generation  bigint  NOT NULL DEFAULT 1 CHECK (generation > 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.event_discovery_generation (singleton) VALUES (true)
  ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.event_discovery_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_discovery_generation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_discovery_generation FROM PUBLIC;
REVOKE ALL ON TABLE public.event_discovery_generation FROM anon, authenticated;
GRANT SELECT ON TABLE public.event_discovery_generation TO service_role;

COMMENT ON TABLE public.event_discovery_generation IS
  'issue #2009 — monotonic event-discovery cache generation. Incremented in the '
  'same transaction as every real standard-event visibility transition. Read by '
  'discover-merged-events (service role only) to key its L1/L2/lock namespaces.';

CREATE OR REPLACE FUNCTION public.issue_2009_event_discovery_generation()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT generation FROM public.event_discovery_generation WHERE singleton;
$function$;

ALTER FUNCTION public.issue_2009_event_discovery_generation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_2009_event_discovery_generation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_2009_event_discovery_generation() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2009_event_discovery_generation() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2009_bump_event_discovery_generation()
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_next bigint;
BEGIN
  UPDATE public.event_discovery_generation
     SET generation = generation + 1,
         updated_at = now()
   WHERE singleton
  RETURNING generation INTO v_next;
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'event_discovery_generation_missing';
  END IF;
  RETURN v_next;
END;
$function$;

ALTER FUNCTION public.issue_2009_bump_event_discovery_generation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_2009_bump_event_discovery_generation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_2009_bump_event_discovery_generation() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2009_bump_event_discovery_generation() TO service_role;

-- ---------------------------------------------------------------------
-- 2. Deterministic transition-effect ledger (Amendment 1 §D).
--    One row per REAL transition, keyed by a transition_id the Business RPC
--    generates AFTER the authorized row lock and hands to the trigger through
--    transaction-local trusted context. Timestamps and post-update scans are
--    forbidden as a count source — the RPC reads back BY THIS EXACT ID.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_visibility_transition_effects (
  transition_id                 uuid PRIMARY KEY,
  event_id                      uuid NOT NULL,
  old_visibility                text NOT NULL,
  new_visibility                text NOT NULL,
  revoked_share_count           integer NOT NULL DEFAULT 0 CHECK (revoked_share_count >= 0),
  representation_mismatch_count integer NOT NULL DEFAULT 0 CHECK (representation_mismatch_count >= 0),
  writer_class                  text NOT NULL CHECK (writer_class IN ('business','admin_or_trusted')),
  discovery_generation          bigint NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_visibility_transition_effects_event_idx
  ON public.event_visibility_transition_effects (event_id, created_at DESC);

ALTER TABLE public.event_visibility_transition_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_visibility_transition_effects FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_visibility_transition_effects FROM PUBLIC;
REVOKE ALL ON TABLE public.event_visibility_transition_effects FROM anon, authenticated;
GRANT SELECT ON TABLE public.event_visibility_transition_effects TO service_role;

COMMENT ON TABLE public.event_visibility_transition_effects IS
  'issue #2009 — append-only operational evidence for one real events.visibility '
  'transition. Carries the EXACT share-revocation cardinality captured by GET '
  'DIAGNOSTICS inside the owning trigger. Not a user-facing audit: the Business '
  'RPC alone writes audit_log event.visibility_changed. Stores no share code, '
  'source reference, invitation data or buyer data.';

CREATE OR REPLACE FUNCTION public.issue_2009_transition_effects_append_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
BEGIN
  -- The ledger is evidence. Nobody rewrites it; only the table owner (an
  -- operations/migration context) may prune. Clients hold no privileges on
  -- the table at all, so this is defence in depth, not the only control.
  IF current_user <> 'postgres' OR TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'event_visibility_transition_effects_append_only';
  END IF;
  RETURN OLD;
END;
$function$;

ALTER FUNCTION public.issue_2009_transition_effects_append_only() OWNER TO postgres;

DROP TRIGGER IF EXISTS issue_2009_transition_effects_append_only
  ON public.event_visibility_transition_effects;
CREATE TRIGGER issue_2009_transition_effects_append_only
  BEFORE UPDATE OR DELETE ON public.event_visibility_transition_effects
  FOR EACH ROW EXECUTE FUNCTION public.issue_2009_transition_effects_append_only();

-- ---------------------------------------------------------------------
-- 3. Partial indexes for BOTH branches of the Amendment 1 §E OR predicate.
--    The predicate may never be narrowed to suit an index.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS content_share_links_active_event_source_key_idx
  ON public.content_share_links (source_key)
  WHERE state = 'active' AND entity_kind = 'event';

CREATE INDEX IF NOT EXISTS content_share_links_active_event_reference_idx
  ON public.content_share_links ((source_reference ->> 'eventId'))
  WHERE state = 'active' AND entity_kind = 'event';

-- ---------------------------------------------------------------------
-- 4. BEFORE UPDATE OF visibility — the write guard / coordinator boundary.
--
--    SECURITY INVOKER on purpose: the whole test is `current_user`, which
--    inside any SECURITY DEFINER function owned by postgres is `postgres`,
--    and for a PostgREST client is `authenticated` / `anon`. A SECURITY
--    DEFINER trigger would read its own owner and could never tell them
--    apart.
--
--    Fires only when the column is NAMED, and returns immediately when the
--    value did not actually change, so an UPDATE that leaves visibility
--    alone is never blocked (SPEC §2).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_2009_event_visibility_write_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.visibility IS NOT DISTINCT FROM OLD.visibility THEN
    RETURN NEW;
  END IF;
  -- #2009 owns the standard ticketed event only. RSVP ('rsvp'), trips and
  -- experiences keep their pre-#2009 behaviour exactly (SC-22).
  IF NEW.event_type IS DISTINCT FROM 'event' AND OLD.event_type IS DISTINCT FROM 'event' THEN
    RETURN NEW;
  END IF;

  -- Private fails closed for EVERY writer. #1931 shipped containment only:
  -- all eight of its transition/arming functions are refusal stubs ending in
  -- `private_access_release_frozen`, so there is no finalizer context that
  -- could legitimately cross this boundary. Unfreezing is tracked as #2144.
  IF 'private' IN (OLD.visibility, NEW.visibility) THEN
    RAISE EXCEPTION 'private_visibility_unavailable';
  END IF;

  -- SC-8 — a direct PostgREST table UPDATE cannot bypass the narrow RPC.
  -- Every trusted SECURITY DEFINER writer (business_publish_event_draft,
  -- biz_update_live_rsvp, admin_set_offering_visibility,
  -- business_set_event_visibility) runs as `postgres` and passes.
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'event_visibility_direct_update_blocked';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.issue_2009_event_visibility_write_guard() OWNER TO postgres;

DROP TRIGGER IF EXISTS issue_2009_events_visibility_guard ON public.events;
CREATE TRIGGER issue_2009_events_visibility_guard
  BEFORE UPDATE OF visibility ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_2009_event_visibility_write_guard();

-- ---------------------------------------------------------------------
-- 5. AFTER UPDATE OF visibility — the sole owner of transition side effects
--    for EVERY trusted writer (Business RPC, Admin RPC, service migration).
--
--    Business supplies a transaction-local transition_id + writer class; any
--    other trusted writer gets its own id and the `admin_or_trusted` class.
--    The trigger NEVER writes a Business audit row — audit ownership is
--    exclusive to business_set_event_visibility (Amendment 1 §D.5).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_2009_event_visibility_effects()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_transition_id uuid;
  v_writer_class  text;
  v_revoked       integer := 0;
  v_mismatch      integer := 0;
  v_generation    bigint;
  v_key           text;
BEGIN
  IF NEW.visibility IS NOT DISTINCT FROM OLD.visibility THEN
    RETURN NEW;
  END IF;
  IF NEW.event_type IS DISTINCT FROM 'event' AND OLD.event_type IS DISTINCT FROM 'event' THEN
    RETURN NEW;
  END IF;

  v_transition_id := NULLIF(current_setting('mingla.issue_2009_transition_id', true), '')::uuid;
  v_writer_class  := NULLIF(current_setting('mingla.issue_2009_writer_class', true), '');

  IF v_transition_id IS NULL THEN
    -- Admin or another trusted writer: it does not return a count to its
    -- legacy caller, but it still gets identical generation/share safety and
    -- an attributable effect row.
    IF v_writer_class IS NOT NULL THEN
      RAISE EXCEPTION 'event_visibility_transition_context_invalid';
    END IF;
    v_transition_id := gen_random_uuid();
    v_writer_class  := 'admin_or_trusted';
  ELSIF v_writer_class IS DISTINCT FROM 'business' THEN
    -- Malformed Business context is rejected, never accepted.
    RAISE EXCEPTION 'event_visibility_transition_context_invalid';
  END IF;

  v_generation := public.issue_2009_bump_event_discovery_generation();

  IF NEW.visibility = 'private' THEN
    -- Unreachable while the guard above fails the Private boundary closed.
    -- Retained because it is the exact Amendment 1 §E predicate the #2144
    -- reconciliation consumes; it is never a substitute for that gate.
    v_key := 'event:' || NEW.id::text;

    -- Lock the target set FIRST so the mismatch count and the revocation
    -- cardinality below describe exactly the SAME rows.
    PERFORM l.id
       FROM public.content_share_links l
      WHERE l.entity_kind = 'event'
        AND l.state = 'active'
        AND (l.source_key = v_key OR l.source_reference ->> 'eventId' = NEW.id::text)
        FOR UPDATE;

    -- IS DISTINCT FROM, not NOT(... AND ...): a link whose source_reference
    -- carries no `eventId` at all yields NULL under three-valued logic, and a
    -- NULL predicate silently drops the row from the count. That row is
    -- exactly the drifted historical representation this counter exists to
    -- surface, so the comparison must be NULL-safe.
    SELECT count(*) INTO v_mismatch
      FROM public.content_share_links l
     WHERE l.entity_kind = 'event'
       AND l.state = 'active'
       AND (l.source_key = v_key OR l.source_reference ->> 'eventId' = NEW.id::text)
       AND (l.source_key IS DISTINCT FROM v_key
            OR (l.source_reference ->> 'eventId') IS DISTINCT FROM NEW.id::text);

    UPDATE public.content_share_links
       SET state = 'revoked', revoked_at = now(), updated_at = now()
     WHERE entity_kind = 'event'
       AND state = 'active'
       AND (source_key = v_key OR source_reference ->> 'eventId' = NEW.id::text);
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  END IF;

  INSERT INTO public.event_visibility_transition_effects (
    transition_id, event_id, old_visibility, new_visibility,
    revoked_share_count, representation_mismatch_count, writer_class,
    discovery_generation
  ) VALUES (
    v_transition_id, NEW.id, OLD.visibility, NEW.visibility,
    v_revoked, v_mismatch, v_writer_class, v_generation
  );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.issue_2009_event_visibility_effects() OWNER TO postgres;

DROP TRIGGER IF EXISTS issue_2009_events_visibility_effects ON public.events;
CREATE TRIGGER issue_2009_events_visibility_effects
  AFTER UPDATE OF visibility ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_2009_event_visibility_effects();

-- ---------------------------------------------------------------------
-- 6. public.business_set_event_visibility — the narrow Business mutation.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.business_set_event_visibility(uuid, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.business_set_event_visibility(
  p_event_id             uuid,
  p_requested_visibility text,
  p_reason               text,
  p_expected_updated_at  timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_requested     text;
  v_target        text;
  v_reason        text;
  v_event         public.events%ROWTYPE;
  v_previous      text;
  v_new_updated   timestamptz;
  v_transition_id uuid;
  v_effect        public.event_visibility_transition_effects%ROWTYPE;
BEGIN
  -- (1) caller identity, BEFORE any target read.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- (2) value: only the three Business labels. `hidden`, `discover` and
  --     `draft` are stored-only and are rejected here, so Business can never
  --     write them (SC-4).
  v_requested := btrim(lower(coalesce(p_requested_visibility, '')));
  IF v_requested NOT IN ('public', 'unlisted', 'private') THEN
    RAISE EXCEPTION 'invalid_visibility';
  END IF;
  v_target := CASE v_requested WHEN 'unlisted' THEN 'hidden' ELSE v_requested END;

  -- (3) reason.
  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;

  -- (4) Amendment 1 §C — the FIRST target-event read and the ONLY acquisition
  --     of its row lock is this one authorization-bearing statement. A
  --     wrong-brand or below-rank caller never locks the row, and a missing,
  --     deleted, foreign-brand and below-rank target are indistinguishable.
  SELECT e.* INTO v_event
    FROM public.events AS e
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL
     AND public.biz_brand_effective_rank_for_caller(e.brand_id)
         >= public.biz_role_rank('event_manager')
   FOR UPDATE OF e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- (5) type + status, only after the authorized lock.
  IF v_event.event_type IS DISTINCT FROM 'event'
     OR v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_editable';
  END IF;

  v_previous := v_event.visibility;

  -- (6) same-value no-op, evaluated BEFORE stale rejection so a network retry
  --     carrying a pre-success timestamp is idempotent (SPEC §2.7). It writes
  --     nothing: no timestamp, no generation, no audit, no effect row.
  IF v_previous = v_target THEN
    RETURN jsonb_build_object(
      'eventId',                  v_event.id,
      'requestedVisibility',      v_requested,
      'storedVisibility',         v_target,
      'previousStoredVisibility', v_previous,
      'updatedAt',                v_event.updated_at,
      'changed',                  false,
      'revokedShareCount',        0
    );
  END IF;

  -- (7) Private fails closed at the authoritative layer (Amendment 3 §3).
  --     #1931 shipped containment only; every transition primitive it
  --     defines raises `private_access_release_frozen`, so there is nothing
  --     to call and no readiness that can become true this release. The
  --     server stays authoritative when client capability state is stale.
  IF v_target = 'private' OR v_previous = 'private' THEN
    RAISE EXCEPTION 'private_visibility_unavailable';
  END IF;

  -- (8) optimistic concurrency. Mandatory for a real change.
  IF p_expected_updated_at IS NULL
     OR p_expected_updated_at IS DISTINCT FROM v_event.updated_at THEN
    RAISE EXCEPTION 'stale_event_visibility';
  END IF;

  -- (9) the single event UPDATE, wrapped in the trusted transaction-local
  --     context the effects trigger consumes.
  v_transition_id := gen_random_uuid();
  PERFORM set_config('mingla.issue_2009_transition_id', v_transition_id::text, true);
  PERFORM set_config('mingla.issue_2009_writer_class', 'business', true);

  UPDATE public.events
     SET visibility = v_target,
         updated_at = now()
   WHERE id = v_event.id
  RETURNING updated_at INTO v_new_updated;

  PERFORM set_config('mingla.issue_2009_transition_id', '', true);
  PERFORM set_config('mingla.issue_2009_writer_class', '', true);

  -- (10) read the effect back BY THE EXACT GENERATED ID. Never by timestamp,
  --      never by a later broad scan.
  SELECT * INTO v_effect
    FROM public.event_visibility_transition_effects
   WHERE transition_id = v_transition_id;
  IF NOT FOUND
     OR v_effect.event_id       IS DISTINCT FROM v_event.id
     OR v_effect.old_visibility IS DISTINCT FROM v_previous
     OR v_effect.new_visibility IS DISTINCT FROM v_target
     OR v_effect.writer_class   IS DISTINCT FROM 'business' THEN
    -- Rolls the event update, generation change, revocations and effect row
    -- back together — no partial residue.
    RAISE EXCEPTION 'event_visibility_effect_missing';
  END IF;

  -- (11) exactly one bounded append-only Business audit row, carrying the
  --      SAME count that is returned. No share codes, no tokens, no contacts.
  INSERT INTO public.audit_log (
    user_id, brand_id, event_id, action, target_type, target_id, before, after
  ) VALUES (
    auth.uid(), v_event.brand_id, v_event.id,
    'event.visibility_changed', 'event', v_event.id,
    jsonb_build_object(
      'storedVisibility',   v_previous,
      'businessVisibility', CASE v_previous WHEN 'hidden' THEN 'unlisted' ELSE v_previous END
    ),
    jsonb_build_object(
      'storedVisibility',   v_target,
      'businessVisibility', v_requested,
      'reason',             v_reason,
      'revokedShareCount',  v_effect.revoked_share_count,
      'transitionId',       v_transition_id
    )
  );

  RETURN jsonb_build_object(
    'eventId',                  v_event.id,
    'requestedVisibility',      v_requested,
    'storedVisibility',         v_target,
    'previousStoredVisibility', v_previous,
    'updatedAt',                v_new_updated,
    'changed',                  true,
    'revokedShareCount',        v_effect.revoked_share_count
  );
END;
$function$;

ALTER FUNCTION public.business_set_event_visibility(uuid, text, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.business_set_event_visibility(uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_set_event_visibility(uuid, text, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_set_event_visibility(uuid, text, text, timestamptz)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.business_set_event_visibility(uuid, text, text, timestamptz) IS
  'issue #2009 — the ONLY authoritative Business mutation for a standard '
  'published ticketed event visibility. Public <-> Unlisted (stored hidden) is '
  'one synchronous change. Private fails closed with private_visibility_unavailable '
  'until #2144 lands.';

-- ---------------------------------------------------------------------
-- 7. Admin compatibility (Amendment 2 §D, retained by Amendment 3 §3).
--    The body is the ORCH-1277 GOLDEN template verbatim plus ONE new clause:
--    a Private boundary on a standard ticketed event is refused, non-mutating,
--    with the stable code the Admin client already maps
--    (mingla-admin/src/services/offeringsService.js — shipped with #1931,
--    NOT duplicated here). Public/Hidden behaviour and admin_write_audit are
--    unchanged, so the Admin console response stays byte-compatible.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_offering_visibility(
  p_event_id  uuid,
  p_visibility text,
  p_reason    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_visibility NOT IN ('public', 'discover', 'private', 'hidden', 'draft') THEN
    RAISE EXCEPTION 'invalid_visibility';
  END IF;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE e.id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  -- issue #2009 — Private on a standard ticketed event needs Mingla Business's
  -- two-phase media/access preparation (#2144). Refuse before every write.
  IF (v_before->>'event_type') = 'event'
     AND (p_visibility = 'private' OR (v_before->>'visibility') = 'private')
     AND p_visibility IS DISTINCT FROM (v_before->>'visibility') THEN
    RAISE EXCEPTION 'private_transition_requires_business';
  END IF;
  UPDATE public.events SET visibility = p_visibility, updated_at = now()
   WHERE id = p_event_id RETURNING to_jsonb(events) INTO v_after;
  PERFORM public.admin_write_audit('offering.set_visibility', 'offering', p_event_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

ALTER FUNCTION public.admin_set_offering_visibility(uuid, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.admin_set_offering_visibility(uuid, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_offering_visibility(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. Self-assert: ACLs are the security boundary, so prove them at apply time.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.business_set_event_visibility(uuid,text,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #2009: business_set_event_visibility is EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.business_set_event_visibility(uuid,text,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #2009: authenticated lost EXECUTE on business_set_event_visibility';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.business_set_event_visibility(uuid,text,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #2009: service_role lost EXECUTE on business_set_event_visibility';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_2009_event_discovery_generation()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_2009_event_discovery_generation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #2009: the discovery-generation reader is not service-only';
  END IF;
  IF has_table_privilege('authenticated', 'public.event_visibility_transition_effects', 'SELECT')
     OR has_table_privilege('anon', 'public.event_visibility_transition_effects', 'SELECT') THEN
    RAISE EXCEPTION 'issue #2009: the transition-effect ledger is readable by a client role';
  END IF;
  IF has_table_privilege('authenticated', 'public.event_discovery_generation', 'SELECT')
     OR has_table_privilege('anon', 'public.event_discovery_generation', 'SELECT') THEN
    RAISE EXCEPTION 'issue #2009: the discovery-generation singleton is readable by a client role';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_offering_visibility(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #2009: admin_set_offering_visibility became EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_offering_visibility(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #2009: authenticated lost EXECUTE on admin_set_offering_visibility (Admin UI would break)';
  END IF;
END $$;
