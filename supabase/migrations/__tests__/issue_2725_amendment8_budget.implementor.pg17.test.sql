-- Issue #2725 Amendment 8: executable PG17 proof that every model-backed lane
-- shares one serialized $1.00 venue/ISO-week ceiling. Fixtures and effects are
-- transaction-scoped and rolled back.
BEGIN;

SET LOCAL session_replication_role = replica;

INSERT INTO public.brands (id, account_id, name, slug)
VALUES (
  '27250000-0000-4000-8000-000000000001',
  '27250000-0000-4000-8000-000000000002',
  'Issue 2725 Budget Fixture',
  'issue-2725-budget-fixture'
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category
)
VALUES
  (
    '27250000-0000-4000-8000-000000000011',
    '27250000-0000-4000-8000-000000000001',
    'budgeta',
    'Budget Venue A',
    51.5,
    -0.1,
    'restaurant'
  ),
  (
    '27250000-0000-4000-8000-000000000012',
    '27250000-0000-4000-8000-000000000001',
    'budgetb',
    'Budget Venue B',
    51.6,
    -0.2,
    'restaurant'
  );

INSERT INTO public.tool_competitors (
  id, brand_id, venue_listing_id, name, city, website, created_by
)
SELECT
  md5(format('issue2725-watch-%s', ordinal))::uuid,
  '27250000-0000-4000-8000-000000000001',
  CASE WHEN ordinal = 22
    THEN '27250000-0000-4000-8000-000000000012'::uuid
    ELSE '27250000-0000-4000-8000-000000000011'::uuid
  END,
  format('Competitor %s', ordinal),
  'London',
  format('https://competitor-%s.example', ordinal),
  '27250000-0000-4000-8000-000000000002'
FROM generate_series(1, 22) AS ordinal;

INSERT INTO public.tool_competitor_refresh_jobs (
  id, competitor_id, brand_id, venue_listing_id, trigger, due_week,
  source_set_fingerprint, idempotency_key, state, funding_lane,
  lease_owner, leased_at
)
SELECT
  md5(format('issue2725-job-%s', ordinal))::uuid,
  md5(format('issue2725-watch-%s', ordinal))::uuid,
  '27250000-0000-4000-8000-000000000001',
  CASE WHEN ordinal = 22
    THEN '27250000-0000-4000-8000-000000000012'::uuid
    ELSE '27250000-0000-4000-8000-000000000011'::uuid
  END,
  CASE WHEN ordinal = 2 THEN 'manual'
       WHEN ordinal = 3 THEN 'admin_retry'
       ELSE 'scheduled'
  END,
  DATE '2026-08-24',
  repeat('a', 62) || lpad(ordinal::text, 2, '0'),
  repeat('b', 62) || lpad(ordinal::text, 2, '0'),
  'leased',
  CASE WHEN ordinal = 2 THEN 'manual' ELSE 'scheduled' END,
  '27250000-0000-4000-8000-000000000099',
  now()
FROM generate_series(1, 22) AS ordinal;

SET LOCAL session_replication_role = origin;

DO $proof$
DECLARE
  ordinal integer;
  reservation uuid;
  accounted bigint;
  deferred_state text;
  model_fingerprint char(64);
  model_capabilities jsonb;
BEGIN
  FOR ordinal IN 1..20 LOOP
    SELECT public.issue_2725_reserve_budget(
      md5(format('issue2725-job-%s', ordinal))::uuid,
      '27250000-0000-4000-8000-000000000099',
      50000
    ) INTO reservation;
    IF reservation IS NULL THEN
      RAISE EXCEPTION 'reservation % was denied before the exact $1 ceiling', ordinal;
    END IF;
  END LOOP;

  SELECT sum(CASE state
    WHEN 'settled' THEN actual_microusd
    WHEN 'released' THEN 0
    ELSE reserved_microusd
  END)
  INTO accounted
  FROM public.tool_competitor_budget_ledger
  WHERE venue_listing_id = '27250000-0000-4000-8000-000000000011'
    AND iso_week = DATE '2026-08-24';
  IF accounted <> 1000000 THEN
    RAISE EXCEPTION 'venue/week ceiling accounting was %, expected 1000000', accounted;
  END IF;

  SELECT public.issue_2725_reserve_budget(
    md5('issue2725-job-21')::uuid,
    '27250000-0000-4000-8000-000000000099',
    50000
  ) INTO reservation;
  SELECT state INTO deferred_state
  FROM public.tool_competitor_refresh_jobs
  WHERE id = md5('issue2725-job-21')::uuid;
  IF reservation IS NOT NULL OR deferred_state <> 'budget_deferred' THEN
    RAISE EXCEPTION '21st reservation crossed the hard ceiling: reservation %, state %',
      reservation, deferred_state;
  END IF;

  SELECT public.issue_2725_reserve_budget(
    md5('issue2725-job-22')::uuid,
    '27250000-0000-4000-8000-000000000099',
    50000
  ) INTO reservation;
  IF reservation IS NULL THEN
    RAISE EXCEPTION 'a different venue incorrectly shared the first venue ceiling';
  END IF;

  SELECT public.issue_2725_source_set_fingerprint(
    md5('issue2725-watch-22')::uuid
  ), public.issue_2725_capability_snapshot(
    md5('issue2725-watch-22')::uuid
  ) INTO model_fingerprint, model_capabilities;
  UPDATE public.tool_competitor_refresh_jobs
  SET source_set_fingerprint = model_fingerprint,
      capability_snapshot = model_capabilities
  WHERE id = md5('issue2725-job-22')::uuid;
  PERFORM public.issue_2725_finish_job(
    md5('issue2725-job-22')::uuid,
    '27250000-0000-4000-8000-000000000099',
    'failure',
    'model_usage_missing',
    model_fingerprint,
    model_capabilities,
    '{}'::jsonb
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.tool_competitor_refresh_jobs j
    JOIN public.tool_competitor_budget_ledger b ON b.job_id = j.id
    WHERE j.id = md5('issue2725-job-22')::uuid
      AND j.state = 'failed_terminal'
      AND b.state = 'measurement_failed'
      AND b.actual_microusd IS NULL
  ) THEN
    RAISE EXCEPTION 'missing model usage was falsely settled or retried';
  END IF;

  IF (SELECT count(*)
      FROM public.tool_competitor_venue_week_budget_boundaries
      WHERE iso_week = DATE '2026-08-24'
        AND venue_listing_id IN (
          '27250000-0000-4000-8000-000000000011',
          '27250000-0000-4000-8000-000000000012'
        )) <> 2 THEN
    RAISE EXCEPTION 'venue/week serialization boundaries were not isolated';
  END IF;
END
$proof$;

ROLLBACK;
