-- ORCH-1154 [snap-autodraft-navigate] — AMENDMENT A (drafts-visibility fix)
--
-- WHY: pg_brand_offering_counts counted PUBLISHED offerings only
-- (published_at IS NOT NULL in the WHERE). A brand whose only experiences are
-- unpublished DRAFTS therefore got experiences=0, the Hub "Experiences" tab was
-- omitted from visibleTabs, and the ORCH-1145 nav-lock redirect bounced any
-- navigation to /hub/experiences straight back to /hub/events — so the drafts a
-- snap just created were real in the DB but unreachable in the UI.
-- (INVESTIGATE_ORCH-1154_DRAFTS_NOT_VISIBLE.md, F-1 CONFIRMED ROOT CAUSE.)
--
-- FIX (ADDITIVE — design LOCKED in SPEC A.2): keep the existing published-only
-- columns events/trips/experiences UNCHANGED (a second consumer — the events
-- screen `hasNoOfferingsAtAll` empty-state copy switch — and the public brand
-- page rely on published-only semantics), and ADD three NEW columns
-- events_draft / trips_draft / experiences_draft (non-deleted, published_at IS
-- NULL). useHubTabs then ORs published+draft per type to decide tab visibility.
--
-- The published columns retain IDENTICAL values: the `published_at IS NOT NULL`
-- predicate simply moves from the row-level WHERE into each published FILTER;
-- the draft columns use `published_at IS NULL`. `deleted_at IS NULL` is
-- PRESERVED in the WHERE so it applies to ALL six columns (no deleted row is
-- ever counted, draft or published).
--
-- RETURNS-TABLE widening hazard: adding columns to a RETURNS TABLE(...) function
-- changes its return-row shape, which Postgres refuses under a bare
-- CREATE OR REPLACE ("cannot change return type of existing function"). We
-- therefore DROP FUNCTION before CREATE, then re-emit the GRANTs from
-- 20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql (DROP/CREATE
-- resets object privileges; the REVOKE/GRANT below restore the
-- authenticated-only contract). Body re-emitted from the LIVE prod definition
-- (pg_get_functiondef, project gqnoajqerqhnvulmnyvv, 2026-06-15) so no logic is
-- lost: LANGUAGE sql, SECURITY DEFINER, search_path = public, pg_temp.

BEGIN;

DROP FUNCTION IF EXISTS public.pg_brand_offering_counts(uuid);

CREATE FUNCTION public.pg_brand_offering_counts(p_brand_id uuid)
RETURNS TABLE (
  events bigint,
  trips bigint,
  experiences bigint,
  events_draft bigint,
  trips_draft bigint,
  experiences_draft bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    count(*) FILTER (WHERE event_type = 'event'      AND published_at IS NOT NULL) AS events,
    count(*) FILTER (WHERE event_type = 'trip'       AND published_at IS NOT NULL) AS trips,
    count(*) FILTER (WHERE event_type = 'experience' AND published_at IS NOT NULL) AS experiences,
    count(*) FILTER (WHERE event_type = 'event'      AND published_at IS NULL)     AS events_draft,
    count(*) FILTER (WHERE event_type = 'trip'       AND published_at IS NULL)     AS trips_draft,
    count(*) FILTER (WHERE event_type = 'experience' AND published_at IS NULL)     AS experiences_draft
  FROM public.events
  WHERE brand_id = p_brand_id
    AND deleted_at IS NULL;
$function$;

-- Restore the META-ORCH-0972 authenticated-only grant contract (DROP reset it).
REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;

COMMIT;
