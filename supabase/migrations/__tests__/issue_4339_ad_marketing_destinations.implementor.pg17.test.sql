\set ON_ERROR_STOP on
-- #4339 round B — the 17 new marketing destinations are listed by the
-- campaign builder's route reader with their exact paths.
BEGIN;
DO $test$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.ad_marketing_route_rows() r
  WHERE r.entity_slug LIKE 'host-%' AND r.path LIKE '/host/%' AND r.entity_slug <> 'host-download';
  IF v_count <> 7 THEN
    RAISE EXCEPTION '#4339: expected 7 host landing destinations, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.ad_marketing_route_rows() r
  WHERE r.entity_slug LIKE 'city-%' AND r.path = '/cities/' || substring(r.entity_slug FROM 6);
  IF v_count <> 10 THEN
    RAISE EXCEPTION '#4339: expected 10 city destinations, got %', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_marketing_route_rows() r
    WHERE r.entity_slug = 'host-events' AND r.path = '/host/events' AND r.result_kind = 'installs'
  ) THEN
    RAISE EXCEPTION '#4339: host-events destination missing';
  END IF;
END
$test$;
ROLLBACK;
