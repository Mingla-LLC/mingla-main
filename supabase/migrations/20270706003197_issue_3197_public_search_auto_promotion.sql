-- issue #3197 — every public Host page that meets the #2986 content rules is
-- indexable within a minute of qualifying.
--
-- THE DEFECT. #2986 (20270614002986) built the whole search lifecycle: the
-- deny-by-default `x-robots-tag`, the sitemap reader, the promotion RPC and the
-- table trigger that refuses an unready page. Nothing ever called the promotion
-- RPC. Production held zero `public_search_documents` rows, so every brand,
-- event and venue page served `noindex` and `/sitemap.xml` was an empty
-- `<urlset>` from 2026-09-01. A switch with no caller (#2168, #2222, #2290).
--
-- POLICY CHANGE — READ THIS BEFORE TRUSTING ANY #2986 COMMENT.
-- Seth decided on 2026-09-12 (#3197): "All brands' public RSVP, events, trips,
-- venue, experience public pages should be indexable on creation." That
-- deliberately SUPERSEDES the #2986 review model, whose migration text says
-- pages "remain public_noindex until an administrator or service job verifies
-- the page and explicitly promotes it" and "no publication side effect promotes
-- a page". That file is pinned by three CI gates and is not edited; the table
-- comment below is updated instead, and docs/INVARIANT_REGISTRY.md records it.
--
--   * There is NO approval table and NO brand allowlist. Any brand, event
--     (including RSVP), trip, experience or verified venue whose page passes
--     the unchanged #2986 content predicate becomes `search_ready`.
--   * Every row this reconciler writes asserts ALL #2986 checklist keys for its
--     kind as `true`. Four of them have no data behind them in production today
--     (image rights, moderation, brand identity/ownership, trip and experience
--     inclusions/fulfillment). They are asserted BY PRODUCT POLICY, not
--     verified, and every row says so: `change_source = 'issue_3197_auto_policy'`
--     and a `change_reason` naming the decision.
--   * The content floor still decides. A page with no real content stays
--     `public_noindex`.
--
-- QUALIFIED INVENTORY (brands). #2986's brand predicate counts events whose
-- `events.status` is scheduled/live, and production never advances that status:
-- `/b/smokerhythm` and `/b/wegoagainexhibition` would be indexed claiming
-- "Upcoming" events that ended in July and August. A brand therefore qualifies
-- only when at least one of its offerings has a master `event_dates` row with
-- `end_at > now()` AND that offering itself passes its own #2986 content floor.
-- The second half is load-bearing, not decoration: on 2026-09-12 the only
-- future-dated public event under `smokerhythm` is a QA fixture whose own page
-- fails the floor (38-character description), and "end_at > now()" alone would
-- have indexed `/b/smokerhythm` on the strength of it.
--
-- NO NAME-BASED TEST FILTER. Production QA content uses at least seven naming
-- shapes (`issue-3040-…`, `qa2396-…`, `testsimulation-…`, `scan-test`,
-- `chipinpersisttest1026`, `…-two-day-demo`, `runtime-qa-1821`), and a pattern
-- wide enough to catch them also catches real titles ("Demo Day", a magazine's
-- "Issue 2025" launch). Every current test brand fails the content floor (no
-- description, no image, no events). Seth accepted, in the decision above, that
-- test-looking brands which DO pass the floor will be indexed.
--
-- WHY A CRON RECONCILER AND NOT A PUBLISH TRIGGER. "On creation" is honoured by
-- a per-minute sweep. A trigger on `events`/`ticket_types` would put search
-- failures on the host's publish and checkout write path, and demotion already
-- happens at read time: the resolver serves `stale`/`draft` the moment a source
-- stops qualifying. The sweep only promotes, refreshes, rebinds and cleans up.
--
-- WHY A DEFINER WRITING THE TABLE, NOT `upsert_public_search_document`. Under
-- pg_cron there is no JWT, so that RPC's first guard raises `not_authorized`.
-- This function writes `public_search_documents` directly, and the #2986 table
-- trigger `tg_validate_public_search_document` still re-checks every promotion
-- (content floor, checklist, exact source token, facts id, review window). No
-- guard is bypassed.
--
-- WHAT THE RECONCILER MAY WRITE. At rest, its rows are only ever `search_ready`;
-- otherwise the row is gone. It never writes `draft`, `stale`,
-- `expired_archived`, `gone` or `redirected`: the resolver returns those states
-- verbatim or before its integrity check, so they 404 a republished page or
-- hand a slug heir a 410/308. A demotion is one audited UPDATE to
-- `public_noindex` carrying the reason, then a DELETE, inside the same
-- subtransaction, so no other session can ever observe the intermediate row.
--
-- KEYED BY ENTITY, NOT SLUG. A path reused by a different brand or event (an
-- "heir") inherits nothing: a row whose `entity_id` differs from the path's
-- current `facts.id` is rebound to the heir when the heir qualifies, and
-- otherwise cleared.
--
-- INDEXNOW (#3176). `enqueue_public_search_indexnow` is an AFTER trigger on
-- `public_search_documents`, so every promotion, source refresh and demotion
-- this reconciler writes also queues an IndexNow `updated`/`deleted` URL. A
-- `review_refresh` does not move `source_updated_at` and queues nothing. The
-- queue is delivered only by the operator-run IndexNow sender; this migration
-- schedules no delivery.
--
-- DEAD-MAN SWITCH. `review_due_at` is now()+48h and is refreshed only when
-- fewer than 24h remain. If the job stops, every page falls back to `stale`
-- (noindex, out of the sitemap) within 48 hours, and
-- `issue_3197_public_search_converged` reports the stall within minutes.
--
-- THIS MIGRATION WRITES ZERO ROWS. The first cron tick after apply promotes.

BEGIN;

-- Captured before any DDL; the closing check proves nothing was written.
SELECT set_config('issue_3197.documents_before',
  (SELECT count(*) FROM public.public_search_documents)::text, true);
SELECT set_config('issue_3197.audit_before',
  (SELECT count(*) FROM public.public_search_document_audit)::text, true);
-- The #3176 IndexNow outbox is absent on a filtered replay that omits #3176;
-- -1 records "no table" so the closing check compares like with like.
DO $before$
DECLARE v_outbox bigint := -1;
BEGIN
  IF to_regclass('public.search_indexnow_outbox') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.search_indexnow_outbox' INTO v_outbox;
  END IF;
  PERFORM set_config('issue_3197.outbox_before', v_outbox::text, true);
END;
$before$;

-- ---------------------------------------------------------------------------
-- 1. The checklist this policy asserts, per kind. The key sets are copied from
--    `public_search_validation_complete` (20270614002986 lines 232-243); the
--    closing check proves they still satisfy it for all five kinds.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_3197_public_search_policy_checks(p_kind text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT CASE p_kind
    WHEN 'event' THEN '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true,"_policy":"issue_3197_auto_policy"}'::jsonb
    WHEN 'trip' THEN '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"schedule_verified":true,"location_verified":true,"itinerary_verified":true,"destination_verified":true,"operator_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true,"_policy":"issue_3197_auto_policy"}'::jsonb
    WHEN 'experience' THEN '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"schedule_verified":true,"location_verified":true,"operator_verified":true,"duration_verified":true,"inclusions_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true,"_policy":"issue_3197_auto_policy"}'::jsonb
    WHEN 'brand' THEN '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"identity_verified":true,"inventory_verified":true,"ownership_source_verified":true,"action_or_inventory_verified":true,"_policy":"issue_3197_auto_policy"}'::jsonb
    WHEN 'venue' THEN '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"identity_verified":true,"location_verified":true,"contact_hours_verified_when_shown":true,"offering_context_verified":true,"address_privacy_verified":true,"_policy":"issue_3197_auto_policy"}'::jsonb
    ELSE NULL
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The single, read-only eligibility verdict for one entity. The reconciler,
--    the convergence monitor and the tests all ask this function, so they can
--    never disagree about what qualifies.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_3197_public_search_decide(p_kind text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_path text;
  v_brand_id uuid;
  v_event_type text;
  v_found boolean := false;
  v_path_valid boolean := false;
  v_source jsonb;
  v_state text;
  v_facts_id text;
  v_token timestamptz;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF p_kind IN ('event','trip','experience') THEN
    SELECT CASE e.event_type
             WHEN 'event' THEN '/e/'
             WHEN 'rsvp' THEN '/e/'
             WHEN 'trip' THEN '/t/'
             WHEN 'experience' THEN '/exp/'
           END || b.slug || '/' || e.slug,
           b.id, e.event_type
      INTO v_path, v_brand_id, v_event_type
      FROM public.events e
      JOIN public.brands b ON b.id = e.brand_id
     WHERE e.id = p_entity_id;
    v_found := FOUND;
    IF v_found AND NOT ((p_kind = 'event' AND v_event_type IN ('event','rsvp'))
                        OR v_event_type = p_kind) THEN
      v_blockers := v_blockers || 'kind_mismatch'::text;
    END IF;
  ELSIF p_kind = 'brand' THEN
    SELECT '/b/' || b.slug, b.id INTO v_path, v_brand_id
      FROM public.brands b WHERE b.id = p_entity_id;
    v_found := FOUND;
  ELSIF p_kind = 'venue' THEN
    SELECT '/b/' || b.slug || '/v/' || v.slug, b.id INTO v_path, v_brand_id
      FROM public.venue_listings v
      JOIN public.brands b ON b.id = v.brand_id
     WHERE v.id = p_entity_id;
    v_found := FOUND;
  ELSE
    v_blockers := v_blockers || 'unknown_kind'::text;
  END IF;

  IF p_kind IN ('event','trip','experience','brand','venue') AND NOT v_found THEN
    v_blockers := v_blockers || 'entity_missing'::text;
  END IF;

  -- #3232: a mixed-case or otherwise non-canonical slug has no valid public
  -- path. Report it and call nothing that could raise on it.
  v_path_valid := v_path IS NOT NULL
    AND public.public_search_path_kind(v_path) IS NOT DISTINCT FROM p_kind;
  IF v_found AND NOT v_path_valid THEN
    v_blockers := v_blockers || 'path_grammar'::text;
  END IF;

  IF v_path_valid THEN
    v_source := public.public_search_source_facts(v_path, p_kind);
    v_state := v_source->>'sourceState';
    v_facts_id := v_source->'facts'->>'id';
    v_token := (v_source->'facts'->>'sourceUpdatedAt')::timestamptz;
    IF v_state IS DISTINCT FROM 'visible' THEN
      v_blockers := v_blockers || ('source_' || COALESCE(v_state, 'missing'));
    ELSIF v_facts_id IS DISTINCT FROM p_entity_id::text THEN
      v_blockers := v_blockers || 'path_owned_by_other_entity'::text;
    ELSIF v_token IS NULL THEN
      v_blockers := v_blockers || 'source_token_missing'::text;
    END IF;
  END IF;

  -- The #2986 per-kind content floor, reused unchanged.
  IF v_found AND NOT public.public_search_source_is_search_ready(p_kind, p_entity_id) THEN
    v_blockers := v_blockers || 'content_floor'::text;
  END IF;

  -- Qualified inventory: at least one upcoming offering that is itself
  -- indexable. `events.status` alone is not trusted (it never advances).
  IF p_kind = 'brand' AND v_found AND NOT EXISTS (
       SELECT 1
         FROM public.events e
        WHERE e.brand_id = p_entity_id
          AND e.deleted_at IS NULL
          AND e.event_type IN ('event','rsvp','trip','experience')
          AND EXISTS (SELECT 1 FROM public.event_dates d
                       WHERE d.event_id = e.id AND d.is_master AND d.end_at > now())
          AND public.public_search_source_is_search_ready(
                CASE WHEN e.event_type IN ('event','rsvp') THEN 'event' ELSE e.event_type END,
                e.id)) THEN
    v_blockers := v_blockers || 'no_qualified_inventory'::text;
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind,
    'entityId', p_entity_id,
    'brandId', v_brand_id,
    'path', v_path,
    'pathValid', v_path_valid,
    'sourceState', v_state,
    'factsId', v_facts_id,
    'sourceUpdatedAt', v_token,
    'eligible', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'checks', public.issue_3197_public_search_policy_checks(p_kind));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The reconciler. Called by pg_cron every minute (section 6).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_3197_reconcile_public_search()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  c_source CONSTANT text := 'issue_3197_auto_policy';
  c_policy CONSTANT text := 'All #2986 checklist keys for this kind are asserted true by product policy (Seth, 2026-09-12, #3197), not individually verified.';
  c_review CONSTANT interval := interval '48 hours';
  c_refresh_below CONSTANT interval := interval '24 hours';
  v_row record;
  v_cand record;
  v_d jsonb;
  v_heir jsonb;
  v_src jsonb;
  v_why text;
  v_rows int := 0;
  v_candidates int := 0;
  v_promoted int := 0;
  v_refreshed int := 0;
  v_rebound int := 0;
  v_demoted int := 0;
  v_cleared int := 0;
  v_unchanged int := 0;
  v_held int := 0;
  v_foreign int := 0;
  v_skipped_path int := 0;
  v_raced jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_summary jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('issue_3197_public_search_reconcile')) THEN
    RETURN jsonb_build_object('skipped', 'locked');
  END IF;

  -- Pass 1: every existing row, so orphans and heirs are always revisited.
  FOR v_row IN
    SELECT d.id, d.entity_kind, d.entity_id, d.canonical_path, d.lifecycle_state,
           d.change_source, d.validation_checks, d.source_updated_at, d.review_due_at
      FROM public.public_search_documents d
     ORDER BY d.canonical_path
  LOOP
    v_rows := v_rows + 1;
    BEGIN
      v_src := public.public_search_source_facts(v_row.canonical_path, v_row.entity_kind);

      IF v_src->>'sourceState' = 'visible'
         AND (v_src->'facts'->>'id') IS DISTINCT FROM v_row.entity_id::text THEN
        -- An heir now owns this path. Whatever the row says about its
        -- predecessor (search_ready, gone, redirected, an operator hold) must
        -- not decide the heir's page.
        v_heir := public.issue_3197_public_search_decide(
          v_row.entity_kind, (v_src->'facts'->>'id')::uuid);
        IF (v_heir->>'eligible')::boolean
           AND v_heir->>'path' = v_row.canonical_path
           AND NOT EXISTS (
             SELECT 1 FROM public.public_search_documents o
              WHERE o.entity_kind = v_row.entity_kind
                AND o.entity_id = (v_heir->>'entityId')::uuid
                AND o.lifecycle_state <> 'redirected'
                AND o.id <> v_row.id) THEN
          UPDATE public.public_search_documents
             SET entity_id = (v_heir->>'entityId')::uuid,
                 lifecycle_state = 'search_ready',
                 redirect_target_path = NULL,
                 validation_checks = v_heir->'checks',
                 source_updated_at = (v_heir->>'sourceUpdatedAt')::timestamptz,
                 verified_at = now(),
                 review_due_at = now() + c_review,
                 search_ready_at = NULL,
                 change_reason = 'Path reassigned by the #3197 auto policy from entity '
                   || v_row.entity_id::text || ' to ' || (v_heir->>'entityId')
                   || '; the new owner passed the #2986 content floor. ' || c_policy,
                 change_source = c_source,
                 updated_by = NULL,
                 is_test_record = false
           WHERE id = v_row.id;
          v_rebound := v_rebound + 1;
        ELSE
          DELETE FROM public.public_search_documents WHERE id = v_row.id;
          v_cleared := v_cleared + 1;
        END IF;

      ELSIF v_row.change_source = c_source THEN
        v_d := public.issue_3197_public_search_decide(v_row.entity_kind, v_row.entity_id);
        IF (v_d->>'eligible')::boolean AND v_d->>'path' = v_row.canonical_path THEN
          IF v_row.lifecycle_state = 'search_ready'
             AND v_row.source_updated_at IS NOT DISTINCT FROM (v_d->>'sourceUpdatedAt')::timestamptz
             AND v_row.validation_checks = v_d->'checks'
             AND v_row.review_due_at > now() + c_refresh_below THEN
            v_unchanged := v_unchanged + 1;
          ELSE
            v_why := CASE
              WHEN v_row.lifecycle_state <> 'search_ready' THEN 'state_restored'
              WHEN v_row.source_updated_at IS DISTINCT FROM (v_d->>'sourceUpdatedAt')::timestamptz THEN 'source_changed'
              WHEN v_row.validation_checks <> v_d->'checks' THEN 'checks_changed'
              ELSE 'review_refresh' END;
            UPDATE public.public_search_documents
               SET lifecycle_state = 'search_ready',
                   redirect_target_path = NULL,
                   validation_checks = v_d->'checks',
                   source_updated_at = (v_d->>'sourceUpdatedAt')::timestamptz,
                   verified_at = now(),
                   review_due_at = now() + c_review,
                   change_reason = 'Re-indexed by the #3197 auto policy (' || v_why
                     || '): the #2986 content floor passed. ' || c_policy,
                   change_source = c_source,
                   updated_by = NULL,
                   is_test_record = false
             WHERE id = v_row.id;
            v_refreshed := v_refreshed + 1;
          END IF;
        ELSE
          -- Demotion: one audited row carrying the reason, then gone. Never a
          -- lasting non-search_ready state (see header).
          UPDATE public.public_search_documents
             SET lifecycle_state = 'public_noindex',
                 redirect_target_path = NULL,
                 verified_at = NULL,
                 review_due_at = NULL,
                 change_reason = left('Removed from search by the #3197 auto policy: '
                   || COALESCE(CASE WHEN (v_d->>'eligible')::boolean THEN 'path_changed'
                                    ELSE (SELECT string_agg(b, ',') FROM jsonb_array_elements_text(v_d->'blockers') b) END,
                               'not_eligible')
                   || '. ' || c_policy, 500),
                 change_source = c_source,
                 updated_by = NULL
           WHERE id = v_row.id;
          DELETE FROM public.public_search_documents WHERE id = v_row.id;
          v_demoted := v_demoted + 1;
        END IF;

      ELSIF v_src->>'sourceState' = 'visible' THEN
        -- An operator row for the SAME entity (written through the #2986 RPC).
        -- The operator decision wins; delete the row to release it.
        v_held := v_held + 1;
      ELSE
        -- An operator row for a path with no visible source (gone/redirected
        -- history, a private page). Not this policy's business.
        v_foreign := v_foreign + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = '22023' AND SQLERRM = 'public_search_readiness_incomplete' THEN
        -- The source moved between the verdict and the write (checkout churn).
        -- The next tick retries; the convergence monitor catches a repeat.
        v_raced := v_raced || jsonb_build_object('path', v_row.canonical_path, 'entityId', v_row.entity_id);
      ELSE
        v_errors := v_errors || jsonb_build_object(
          'phase', 'row', 'path', v_row.canonical_path, 'kind', v_row.entity_kind,
          'entityId', v_row.entity_id, 'sqlstate', SQLSTATE, 'message', left(SQLERRM, 200));
      END IF;
    END;
  END LOOP;

  -- Pass 2: every public entity that could have a page, promoted if it
  -- qualifies and has no row yet.
  FOR v_cand IN
    SELECT 'brand'::text AS kind, b.id AS entity_id
      FROM public.brands b
      JOIN public.creator_accounts ca ON ca.id = b.account_id AND ca.deleted_at IS NULL
     WHERE b.deleted_at IS NULL
    UNION ALL
    SELECT CASE WHEN e.event_type IN ('event','rsvp') THEN 'event' ELSE e.event_type END, e.id
      FROM public.events e
      JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
      JOIN public.creator_accounts ca ON ca.id = b.account_id AND ca.deleted_at IS NULL
     WHERE e.deleted_at IS NULL
       AND e.event_type IN ('event','rsvp','trip','experience')
       AND e.status IN ('scheduled','live')
       AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    UNION ALL
    SELECT 'venue'::text, v.id
      FROM public.venue_listings v
      JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
      JOIN public.creator_accounts ca ON ca.id = b.account_id AND ca.deleted_at IS NULL
     WHERE v.claim_status = 'verified'
     ORDER BY 1, 2
  LOOP
    v_candidates := v_candidates + 1;
    BEGIN
      IF NOT EXISTS (
           SELECT 1 FROM public.public_search_documents d
            WHERE d.entity_kind = v_cand.kind
              AND d.entity_id = v_cand.entity_id
              AND d.lifecycle_state <> 'redirected') THEN
        v_d := public.issue_3197_public_search_decide(v_cand.kind, v_cand.entity_id);
        IF NOT (v_d->>'pathValid')::boolean THEN
          v_skipped_path := v_skipped_path + 1;
          IF jsonb_array_length(v_skipped) < 20 THEN
            v_skipped := v_skipped || jsonb_build_object('kind', v_cand.kind, 'entityId', v_cand.entity_id, 'path', v_d->>'path');
          END IF;
        ELSIF (v_d->>'eligible')::boolean THEN
          IF EXISTS (SELECT 1 FROM public.public_search_documents d
                      WHERE d.canonical_path = v_d->>'path') THEN
            -- Pass 1 left an operator row on this path.
            v_held := v_held + 1;
          ELSE
            INSERT INTO public.public_search_documents(
              entity_kind, entity_id, canonical_path, lifecycle_state, redirect_target_path,
              validation_checks, source_updated_at, verified_at, review_due_at,
              change_reason, change_source, updated_by, is_test_record)
            VALUES (
              v_cand.kind, v_cand.entity_id, v_d->>'path', 'search_ready', NULL,
              v_d->'checks', (v_d->>'sourceUpdatedAt')::timestamptz, now(), now() + c_review,
              'Indexed by the #3197 auto policy: the #2986 content floor passed'
                || CASE WHEN v_cand.kind = 'brand' THEN ' with at least one upcoming indexable offering' ELSE '' END
                || '. ' || c_policy,
              c_source, NULL, false);
            v_promoted := v_promoted + 1;
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = '22023' AND SQLERRM = 'public_search_readiness_incomplete' THEN
        v_raced := v_raced || jsonb_build_object('kind', v_cand.kind, 'entityId', v_cand.entity_id);
      ELSE
        v_errors := v_errors || jsonb_build_object(
          'phase', 'candidate', 'kind', v_cand.kind, 'entityId', v_cand.entity_id,
          'sqlstate', SQLSTATE, 'message', left(SQLERRM, 200));
      END IF;
    END;
  END LOOP;

  v_summary := jsonb_build_object(
    'policy', c_source,
    'rows', v_rows,
    'candidates', v_candidates,
    'promoted', v_promoted,
    'refreshed', v_refreshed,
    'rebound', v_rebound,
    'demoted', v_demoted,
    'cleared', v_cleared,
    'unchanged', v_unchanged,
    'held', v_held,
    'foreignUntouched', v_foreign,
    'skippedPath', v_skipped_path,
    'skippedPaths', v_skipped,
    'raced', v_raced,
    'errors', v_errors);
  RAISE LOG 'issue_3197_public_search_reconcile %', v_summary;
  RETURN v_summary;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Divergence between what qualifies and what the public readers serve.
--    Read-only. An operator hold is reported, never counted as divergence.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_3197_public_search_divergence()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  c_source CONSTANT text := 'issue_3197_auto_policy';
  c_settle CONSTANT interval := interval '2 minutes';
  v_sitemap text[];
  v_cand record;
  v_row record;
  v_d jsonb;
  v_src jsonb;
  v_state text;
  v_candidates int := 0;
  v_eligible int := 0;
  v_held int := 0;
  v_indexed int := 0;
  v_settling int := 0;
  v_skipped_path int := 0;
  v_divergences jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(array_agg(s.canonical_path), ARRAY[]::text[]) INTO v_sitemap
    FROM public.list_public_search_sitemap() s;

  FOR v_cand IN
    SELECT 'brand'::text AS kind, b.id AS entity_id
      FROM public.brands b
      JOIN public.creator_accounts ca ON ca.id = b.account_id AND ca.deleted_at IS NULL
     WHERE b.deleted_at IS NULL
    UNION ALL
    SELECT CASE WHEN e.event_type IN ('event','rsvp') THEN 'event' ELSE e.event_type END, e.id
      FROM public.events e
      JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
      JOIN public.creator_accounts ca ON ca.id = b.account_id AND ca.deleted_at IS NULL
     WHERE e.deleted_at IS NULL
       AND e.event_type IN ('event','rsvp','trip','experience')
       AND e.status IN ('scheduled','live')
       AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    UNION ALL
    SELECT 'venue'::text, v.id
      FROM public.venue_listings v
      JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
      JOIN public.creator_accounts ca ON ca.id = b.account_id AND ca.deleted_at IS NULL
     WHERE v.claim_status = 'verified'
  LOOP
    v_candidates := v_candidates + 1;
    v_d := public.issue_3197_public_search_decide(v_cand.kind, v_cand.entity_id);
    IF NOT (v_d->>'pathValid')::boolean THEN
      v_skipped_path := v_skipped_path + 1;
    ELSIF (v_d->>'eligible')::boolean THEN
      v_eligible := v_eligible + 1;
      IF EXISTS (SELECT 1 FROM public.public_search_documents d
                  WHERE d.change_source <> c_source
                    AND ((d.entity_kind = v_cand.kind AND d.entity_id = v_cand.entity_id
                          AND d.lifecycle_state <> 'redirected')
                         OR d.canonical_path = v_d->>'path')) THEN
        v_held := v_held + 1;
      ELSIF (v_d->>'sourceUpdatedAt')::timestamptz > now() - c_settle THEN
        v_settling := v_settling + 1;
      ELSE
        v_state := public.resolve_public_search_document(v_d->>'path')->>'state';
        IF v_state = 'search_ready' AND (v_d->>'path') = ANY (v_sitemap) THEN
          v_indexed := v_indexed + 1;
        ELSE
          v_divergences := v_divergences || jsonb_build_object(
            'divergence', 'eligible_not_indexed', 'kind', v_cand.kind,
            'entityId', v_cand.entity_id, 'path', v_d->>'path', 'resolved', v_state,
            'inSitemap', (v_d->>'path') = ANY (v_sitemap));
        END IF;
      END IF;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT d.entity_kind, d.entity_id, d.canonical_path, d.lifecycle_state, d.change_source, d.updated_at
      FROM public.public_search_documents d
     ORDER BY d.canonical_path
  LOOP
    v_src := public.public_search_source_facts(v_row.canonical_path, v_row.entity_kind);
    IF v_src->>'sourceState' = 'visible'
       AND (v_src->'facts'->>'id') IS DISTINCT FROM v_row.entity_id::text THEN
      v_divergences := v_divergences || jsonb_build_object(
        'divergence', 'path_owned_by_other_entity', 'kind', v_row.entity_kind,
        'entityId', v_row.entity_id, 'path', v_row.canonical_path,
        'currentEntityId', v_src->'facts'->>'id', 'state', v_row.lifecycle_state);
    ELSIF v_row.change_source = c_source THEN
      IF v_row.lifecycle_state <> 'search_ready' THEN
        v_divergences := v_divergences || jsonb_build_object(
          'divergence', 'own_row_not_search_ready', 'kind', v_row.entity_kind,
          'entityId', v_row.entity_id, 'path', v_row.canonical_path, 'state', v_row.lifecycle_state);
      ELSE
        v_d := public.issue_3197_public_search_decide(v_row.entity_kind, v_row.entity_id);
        IF NOT ((v_d->>'eligible')::boolean AND v_d->>'path' = v_row.canonical_path) THEN
          v_divergences := v_divergences || jsonb_build_object(
            'divergence', 'own_row_no_longer_qualifies', 'kind', v_row.entity_kind,
            'entityId', v_row.entity_id, 'path', v_row.canonical_path, 'blockers', v_d->'blockers');
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'eligible', v_eligible,
    'held', v_held,
    'settling', v_settling,
    'indexed', v_indexed,
    'skippedPath', v_skipped_path,
    'divergences', v_divergences);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The monitor. Raises (so the failed run shows on the #1647 pg_cron tile)
--    when the reconciler is unscheduled or stalled, or when a divergence
--    persists across a full reconcile cycle. A divergence seen once is
--    re-checked after `p_recheck_after`: a page whose end time or sale window
--    passed a few seconds before this run is the reconciler's next tick, not a
--    defect.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_3197_assert_public_search_converged(
  p_recheck_after interval DEFAULT interval '75 seconds',
  p_max_reconcile_age interval DEFAULT interval '5 minutes')
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_last_success timestamptz;
  v_runs bigint;
  v_first jsonb;
  v_second jsonb;
  v_persistent jsonb;
BEGIN
  IF (SELECT count(*) FROM cron.job j
       WHERE j.jobname = 'issue_3197_public_search_reconcile'
         AND j.active
         AND j.schedule = '* * * * *'
         AND j.command = 'SELECT public.issue_3197_reconcile_public_search();') <> 1 THEN
    RAISE EXCEPTION 'issue_3197_public_search_reconciler_unscheduled';
  END IF;

  IF p_max_reconcile_age IS NOT NULL THEN
    SELECT max(r.start_time) FILTER (WHERE r.status = 'succeeded'), count(*)
      INTO v_last_success, v_runs
      FROM cron.job_run_details r
      JOIN cron.job j ON j.jobid = r.jobid
     WHERE j.jobname = 'issue_3197_public_search_reconcile';
    -- A job with no run history at all was scheduled moments ago; one with
    -- history but no recent success has stalled or is failing.
    IF v_runs > 0 AND (v_last_success IS NULL OR v_last_success < now() - p_max_reconcile_age) THEN
      RAISE EXCEPTION 'issue_3197_public_search_reconciler_stalled: last success %, % run(s) recorded',
        v_last_success, v_runs;
    END IF;
  END IF;

  v_first := public.issue_3197_public_search_divergence();
  IF jsonb_array_length(v_first->'divergences') = 0 THEN
    RETURN v_first || jsonb_build_object('converged', true);
  END IF;

  IF p_recheck_after IS NOT NULL AND p_recheck_after > interval '0' THEN
    PERFORM pg_sleep(extract(epoch FROM p_recheck_after));
  END IF;
  v_second := public.issue_3197_public_search_divergence();

  SELECT COALESCE(jsonb_agg(s.item), '[]'::jsonb) INTO v_persistent
    FROM jsonb_array_elements(v_second->'divergences') s(item)
   WHERE EXISTS (
     SELECT 1 FROM jsonb_array_elements(v_first->'divergences') f(item)
      WHERE f.item->>'divergence' = s.item->>'divergence'
        AND f.item->>'entityId' = s.item->>'entityId'
        AND f.item->>'path' = s.item->>'path');

  IF jsonb_array_length(v_persistent) > 0 THEN
    RAISE EXCEPTION 'issue_3197_public_search_diverged: %', left(v_persistent::text, 4000);
  END IF;
  RETURN v_second || jsonb_build_object('converged', true, 'transient', v_first->'divergences');
END;
$function$;

ALTER FUNCTION public.issue_3197_public_search_policy_checks(text) OWNER TO postgres;
ALTER FUNCTION public.issue_3197_public_search_decide(text,uuid) OWNER TO postgres;
ALTER FUNCTION public.issue_3197_reconcile_public_search() OWNER TO postgres;
ALTER FUNCTION public.issue_3197_public_search_divergence() OWNER TO postgres;
ALTER FUNCTION public.issue_3197_assert_public_search_converged(interval,interval) OWNER TO postgres;

-- Supabase default privileges grant EXECUTE on every new public function to
-- anon and authenticated. None of these is a public reader.
REVOKE ALL ON FUNCTION public.issue_3197_public_search_policy_checks(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3197_public_search_decide(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3197_reconcile_public_search() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3197_public_search_divergence() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3197_assert_public_search_converged(interval,interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3197_public_search_decide(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3197_reconcile_public_search() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3197_public_search_divergence() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3197_assert_public_search_converged(interval,interval) TO service_role;

COMMENT ON TABLE public.public_search_documents IS
  '#2986 public-search lifecycle overlay. POLICY CHANGED by #3197 (Seth, 2026-09-12): pages are no longer promoted by individual review. issue_3197_reconcile_public_search() runs every minute and writes search_ready for every brand, event, trip, experience and verified venue that passes the #2986 content floor, asserting every checklist key by product policy (change_source issue_3197_auto_policy). Operator rows written through upsert_public_search_document still take precedence for their entity.';
COMMENT ON FUNCTION public.issue_3197_reconcile_public_search() IS
  '#3197 per-minute search reconciler. Writes only search_ready rows (or deletes its own), keyed by entity; never draft, stale, expired_archived, gone or redirected. Every checklist key it writes is asserted by product policy, not verified.';
COMMENT ON FUNCTION public.issue_3197_assert_public_search_converged(interval,interval) IS
  '#3197 convergence monitor. Raises when the reconciler is unscheduled or stalled, or when a page that qualifies stays unindexed (or an indexed page stays unqualified) across a full reconcile cycle.';

-- ---------------------------------------------------------------------------
-- 6. The callers. Literal unschedule-if-exists then schedule (the #2290 gate
--    models this idiom; a dynamic `PERFORM cron.unschedule(v_job)` is not).
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('issue_3197_public_search_reconcile')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_3197_public_search_reconcile');
SELECT cron.schedule('issue_3197_public_search_reconcile', '* * * * *',
  $cron$SELECT public.issue_3197_reconcile_public_search();$cron$);

SELECT cron.unschedule('issue_3197_public_search_converged')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_3197_public_search_converged');
SELECT cron.schedule('issue_3197_public_search_converged', '*/10 * * * *',
  $cron$SELECT public.issue_3197_assert_public_search_converged();$cron$);

-- ---------------------------------------------------------------------------
-- 7. Migration-time proof. Refuses to apply unless every posture below holds.
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_fn text;
  v_kind text;
  v_outbox bigint := -1;
BEGIN
  IF (SELECT count(*) FROM public.public_search_documents)
       <> current_setting('issue_3197.documents_before')::bigint
     OR (SELECT count(*) FROM public.public_search_document_audit)
       <> current_setting('issue_3197.audit_before')::bigint THEN
    RAISE EXCEPTION '#3197 migration must write zero search documents; the first cron tick promotes';
  END IF;
  IF to_regclass('public.search_indexnow_outbox') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.search_indexnow_outbox' INTO v_outbox;
  END IF;
  IF v_outbox <> current_setting('issue_3197.outbox_before')::bigint THEN
    RAISE EXCEPTION '#3197 migration must queue zero IndexNow URLs; the first cron tick promotes';
  END IF;

  IF (SELECT count(*) FROM cron.job
       WHERE jobname = 'issue_3197_public_search_reconcile' AND active AND schedule = '* * * * *'
         AND command = 'SELECT public.issue_3197_reconcile_public_search();') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'issue_3197_public_search_reconcile') <> 1 THEN
    RAISE EXCEPTION '#3197 reconcile job is not scheduled exactly once with its literal command';
  END IF;
  IF (SELECT count(*) FROM cron.job
       WHERE jobname = 'issue_3197_public_search_converged' AND active AND schedule = '*/10 * * * *'
         AND command = 'SELECT public.issue_3197_assert_public_search_converged();') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'issue_3197_public_search_converged') <> 1 THEN
    RAISE EXCEPTION '#3197 convergence job is not scheduled exactly once with its literal command';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3197_public_search_decide(text,uuid)',
    'public.issue_3197_reconcile_public_search()',
    'public.issue_3197_public_search_divergence()',
    'public.issue_3197_assert_public_search_converged(interval,interval)'
  ] LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p
          WHERE p.oid = v_fn::regprocedure
            AND p.prosecdef
            AND pg_get_userbyid(p.proowner) = 'postgres'
            AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp') THEN
      RAISE EXCEPTION '#3197 % security posture drifted', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#3197 service_role lost EXECUTE on %', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3197_public_search_policy_checks(text)',
    'public.issue_3197_public_search_decide(text,uuid)',
    'public.issue_3197_reconcile_public_search()',
    'public.issue_3197_public_search_divergence()',
    'public.issue_3197_assert_public_search_converged(interval,interval)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#3197 % is executable by anon or authenticated', v_fn;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid = 'public.issue_3197_public_search_policy_checks(text)'::regprocedure
                AND (p.prosecdef OR p.provolatile <> 'i'
                     OR array_to_string(p.proconfig, ',') <> 'search_path=""')) THEN
    RAISE EXCEPTION '#3197 policy checklist helper posture drifted';
  END IF;

  -- The asserted checklist must satisfy #2986's validator for all five kinds,
  -- every asserted key must be exactly true, and no kind may be missing.
  FOREACH v_kind IN ARRAY ARRAY['event','trip','experience','brand','venue'] LOOP
    IF NOT public.public_search_validation_complete(v_kind, public.issue_3197_public_search_policy_checks(v_kind)) THEN
      RAISE EXCEPTION '#3197 policy checklist for % no longer satisfies public_search_validation_complete', v_kind;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(public.issue_3197_public_search_policy_checks(v_kind)) e
                WHERE e.key <> '_policy' AND e.value <> 'true'::jsonb) THEN
      RAISE EXCEPTION '#3197 policy checklist for % asserts a non-true key', v_kind;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.public_search_documents', 'SELECT')
     OR has_table_privilege('authenticated', 'public.public_search_documents', 'SELECT') THEN
    RAISE EXCEPTION '#3197 the search overlay became directly readable';
  END IF;
  IF NOT has_function_privilege('anon', 'public.resolve_public_search_document(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.list_public_search_sitemap()', 'EXECUTE') THEN
    RAISE EXCEPTION '#3197 the #2986 public readers lost anon EXECUTE';
  END IF;
END;
$check$;

COMMIT;
