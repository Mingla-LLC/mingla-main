-- issue #2728 -- repair the per-tier sold-count RPC after #2491 added a
-- ticket_types.sold_count column. The lateral output deliberately shares the
-- column name, so its qualifier is load-bearing for SQL-function startup.

BEGIN;

CREATE TEMP TABLE issue_2728_function_before ON COMMIT DROP AS
SELECT
  p.proowner,
  p.prolang,
  p.prorettype,
  p.proargtypes,
  p.proargnames,
  p.provolatile,
  p.prosecdef,
  p.proconfig,
  p.proacl,
  obj_description(p.oid, 'pg_proc') AS description
FROM pg_proc p
WHERE p.oid = 'public.biz_trip_tickets_sold_by_tier(uuid)'::regprocedure;

CREATE OR REPLACE FUNCTION public.biz_trip_tickets_sold_by_tier(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.biz_is_event_manager_plus(p_event_id, auth.uid()) THEN (
      SELECT COALESCE(
        jsonb_object_agg(tt.id::text, c.sold_count),
        '{}'::jsonb
      )
      FROM public.ticket_types tt
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS sold_count
        FROM public.tickets t
        WHERE t.ticket_type_id = tt.id
          AND t.status IN ('valid', 'used', 'transferred')
      ) c ON true
      WHERE tt.event_id = p_event_id
        AND tt.deleted_at IS NULL
    )
    ELSE '{}'::jsonb
  END;
$function$;

DO $probe$
DECLARE
  v_actual jsonb;
  v_definition text;
  v_metadata_preserved boolean;
BEGIN
  IF (SELECT count(*) FROM issue_2728_function_before) <> 1 THEN
    RAISE EXCEPTION 'issue #2728: pre-repair function metadata was not captured exactly once';
  END IF;

  SELECT pg_get_functiondef('public.biz_trip_tickets_sold_by_tier(uuid)'::regprocedure)
    INTO v_definition;
  IF position('jsonb_object_agg(tt.id::text, c.sold_count)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'issue #2728: repaired function does not select the qualified lateral count';
  END IF;

  -- Execution is required in addition to definition inspection: SQL-language
  -- functions are analysed on startup, which is where the 42702 regression hit.
  SELECT public.biz_trip_tickets_sold_by_tier(
    'ffffffff-ffff-4fff-8fff-ffffffff2728'::uuid
  ) INTO v_actual;
  IF v_actual IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'issue #2728: nonexistent event returned %, expected {}', v_actual;
  END IF;

  SELECT ROW(
           p.proowner,
           p.prolang,
           p.prorettype,
           p.proargtypes,
           p.proargnames,
           p.provolatile,
           p.prosecdef,
           p.proconfig,
           p.proacl,
           obj_description(p.oid, 'pg_proc')
         ) IS NOT DISTINCT FROM ROW(
           b.proowner,
           b.prolang,
           b.prorettype,
           b.proargtypes,
           b.proargnames,
           b.provolatile,
           b.prosecdef,
           b.proconfig,
           b.proacl,
           b.description
         )
    INTO v_metadata_preserved
  FROM pg_proc p
  CROSS JOIN issue_2728_function_before b
  WHERE p.oid = 'public.biz_trip_tickets_sold_by_tier(uuid)'::regprocedure;

  IF v_metadata_preserved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'issue #2728: function security, signature, owner, ACL, or comment changed';
  END IF;
END $probe$;

COMMIT;
