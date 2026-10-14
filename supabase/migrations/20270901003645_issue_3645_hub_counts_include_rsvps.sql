-- Issue #3645 — a brand's RSVPs count towards its Hub "Events" tab.
--
-- WHAT WAS BROKEN. `pg_brand_offering_counts` counted `event_type = 'event'`
-- only. An RSVP is listed on the Hub Events tab, but a brand whose only
-- Events-tab rows were RSVPs (for example trips plus one RSVP) got
-- events = 0 and events_draft = 0, so the Events tab was not shown and the
-- RSVP could not be reached from Hub.
--
-- WHAT CHANGES. Re-emitted from the latest definition
-- (20261004000001_orch_1154_offering_counts_include_drafts.sql) with ONE
-- change: the two events counts read `event_type IN ('event', 'rsvp')`.
-- Everything else is byte-for-byte the same: the six columns and their order,
-- LANGUAGE sql, SECURITY DEFINER, search_path, the `deleted_at IS NULL` and
-- `published_at` filters, and the authenticated-only grants. The return shape
-- is unchanged, so this is a CREATE OR REPLACE and privileges are kept; the
-- grants are restated so the file stands alone.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.pg_brand_offering_counts(p_brand_id uuid)
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
    count(*) FILTER (WHERE event_type IN ('event', 'rsvp') AND published_at IS NOT NULL) AS events,
    count(*) FILTER (WHERE event_type = 'trip'       AND published_at IS NOT NULL) AS trips,
    count(*) FILTER (WHERE event_type = 'experience' AND published_at IS NOT NULL) AS experiences,
    count(*) FILTER (WHERE event_type IN ('event', 'rsvp') AND published_at IS NULL)     AS events_draft,
    count(*) FILTER (WHERE event_type = 'trip'       AND published_at IS NULL)     AS trips_draft,
    count(*) FILTER (WHERE event_type = 'experience' AND published_at IS NULL)     AS experiences_draft
  FROM public.events
  WHERE brand_id = p_brand_id
    AND deleted_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;

-- Verify.
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.pg_brand_offering_counts(uuid)'::regprocedure);
  IF position('''rsvp''' in v_def) = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: pg_brand_offering_counts does not count RSVPs';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.pg_brand_offering_counts(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'issue_3645_verify: pg_brand_offering_counts lost SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.pg_brand_offering_counts(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.pg_brand_offering_counts(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: pg_brand_offering_counts grants changed';
  END IF;
END;
$$;

COMMIT;
