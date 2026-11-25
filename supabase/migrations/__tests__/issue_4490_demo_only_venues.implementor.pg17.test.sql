-- #4490: internal demo places cannot be made servable by any ordinary write.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_demo uuid := '4490d000-0000-4000-8000-000000000001';
  v_regular uuid := '4490d000-0000-4000-8000-000000000002';
  v_deleted uuid := '4490d000-0000-4000-8000-000000000003';
  v_value boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'place_pool'
      AND column_name = 'demo_only'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'FAIL: place_pool.demo_only must be non-null with a false default';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.place_pool'::regclass
      AND conname = 'place_pool_demo_only_unservable'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'FAIL: the demo-only serving constraint must exist and be validated';
  END IF;

  INSERT INTO public.place_pool (
    id, google_place_id, name, lat, lng, demo_only, is_servable
  ) VALUES (
    v_demo, 'issue-4490-demo-only', 'Issue 4490 demo', 6.4501, 3.4001, true, true
  );

  SELECT is_servable INTO v_value FROM public.place_pool WHERE id = v_demo;
  IF v_value IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: a demo-only insert tried to become servable';
  END IF;

  UPDATE public.place_pool SET is_servable = true WHERE id = v_demo;
  SELECT is_servable INTO v_value FROM public.place_pool WHERE id = v_demo;
  IF v_value IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: a later write resurrected a demo-only place';
  END IF;

  UPDATE public.place_pool SET demo_only = false WHERE id = v_demo;
  SELECT is_servable INTO v_value FROM public.place_pool WHERE id = v_demo;
  IF v_value IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: clearing demo_only fabricated a serving approval';
  END IF;

  INSERT INTO public.place_pool (
    id, google_place_id, name, lat, lng, is_servable
  ) VALUES (
    v_regular, 'issue-4490-regular', 'Issue 4490 regular', 6.4502, 3.4002, true
  );

  SELECT is_servable INTO v_value FROM public.place_pool WHERE id = v_regular;
  IF v_value IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: the demo invariant changed an ordinary place';
  END IF;

  INSERT INTO public.place_pool (
    id, google_place_id, name, lat, lng, deleted_at, is_active, is_servable
  ) VALUES (
    v_deleted, 'issue-4490-deleted', 'Issue 4490 deleted', 6.4503, 3.4003,
    now(), true, true
  );

  IF EXISTS (
    SELECT 1 FROM public.place_pool
    WHERE id = v_deleted AND (is_active IS TRUE OR is_servable IS TRUE)
  ) THEN
    RAISE EXCEPTION 'FAIL: the existing deleted-place invariant regressed';
  END IF;

  RAISE NOTICE 'PASS: demo-only and deleted places stay out of discovery while ordinary places are unchanged';
END
$test$;

ROLLBACK;
