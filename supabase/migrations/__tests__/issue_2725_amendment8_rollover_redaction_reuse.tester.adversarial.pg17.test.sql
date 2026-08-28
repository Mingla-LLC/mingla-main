-- Issue #2725 Amendment 8 independent tester proof.
-- A venue that exhausted one ISO week must receive a fresh independent ceiling
-- next week. Safe usage receipts survive watch removal only as redacted
-- measurement data, and a racing identical synthesis fingerprint cannot replace
-- the first accepted result. Everything is transaction-scoped and rolled back.
BEGIN;

SET LOCAL session_replication_role = replica;

INSERT INTO public.brands (id, account_id, name, slug)
VALUES (
  '27250800-0000-4000-8000-000000000001',
  '27250800-0000-4000-8000-000000000002',
  'Issue 2725 Tester Budget Fixture',
  'issue-2725-tester-budget-fixture'
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category
)
VALUES (
  '27250800-0000-4000-8000-000000000011',
  '27250800-0000-4000-8000-000000000001',
  'testerbudget',
  'Tester Budget Venue',
  51.5,
  -0.1,
  'restaurant'
);

INSERT INTO public.tool_competitors (
  id, brand_id, venue_listing_id, name, city, website, created_by
)
SELECT
  md5(format('issue2725-tester-watch-%s', ordinal))::uuid,
  '27250800-0000-4000-8000-000000000001',
  '27250800-0000-4000-8000-000000000011',
  format('Tester Competitor %s', ordinal),
  'London',
  format('https://tester-competitor-%s.example', ordinal),
  '27250800-0000-4000-8000-000000000002'
FROM generate_series(1, 21) AS ordinal;

INSERT INTO public.tool_competitor_refresh_jobs (
  id, competitor_id, brand_id, venue_listing_id, trigger, due_week,
  source_set_fingerprint, idempotency_key, state, funding_lane,
  lease_owner, leased_at
)
SELECT
  md5(format('issue2725-tester-job-%s', ordinal))::uuid,
  md5(format('issue2725-tester-watch-%s', ordinal))::uuid,
  '27250800-0000-4000-8000-000000000001',
  '27250800-0000-4000-8000-000000000011',
  CASE WHEN ordinal = 2 THEN 'manual'
       WHEN ordinal = 3 THEN 'admin_retry'
       ELSE 'scheduled'
  END,
  CASE WHEN ordinal = 21 THEN DATE '2026-08-31' ELSE DATE '2026-08-24' END,
  repeat('c', 62) || lpad(ordinal::text, 2, '0'),
  repeat('d', 62) || lpad(ordinal::text, 2, '0'),
  'leased',
  CASE WHEN ordinal = 2 THEN 'manual' ELSE 'scheduled' END,
  '27250800-0000-4000-8000-000000000099',
  now()
FROM generate_series(1, 21) AS ordinal;

SET LOCAL session_replication_role = origin;

DO $proof$
DECLARE
  ordinal integer;
  reservation uuid;
  first_receipt uuid;
  second_receipt uuid;
  first_result jsonb := '{"winner":"first"}'::jsonb;
  second_result jsonb := '{"winner":"second"}'::jsonb;
  accepted jsonb;
  watch_updated_at timestamptz;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tool_competitor_intel_config
    WHERE scheduler_enabled
       OR global_daily_limit_microusd <> 0
       OR default_brand_daily_limit_microusd <> 0
  ) OR EXISTS (
    SELECT 1 FROM public.tool_competitor_provider_capabilities
    WHERE kind IN ('website', 'instagram') AND enabled
  ) THEN
    RAISE EXCEPTION 'Amendment 8 rollout did not remain OFF/0';
  END IF;

  FOR ordinal IN 1..20 LOOP
    SELECT public.issue_2725_reserve_budget(
      md5(format('issue2725-tester-job-%s', ordinal))::uuid,
      '27250800-0000-4000-8000-000000000099',
      50000
    ) INTO reservation;
    IF reservation IS NULL THEN
      RAISE EXCEPTION 'current-week reservation % was denied before $1', ordinal;
    END IF;
  END LOOP;

  IF (
    SELECT sum(reserved_microusd)
    FROM public.tool_competitor_budget_ledger
    WHERE venue_listing_id = '27250800-0000-4000-8000-000000000011'
      AND iso_week = DATE '2026-08-24'
  ) <> 1000000 THEN
    RAISE EXCEPTION 'current ISO week did not stop exactly at $1';
  END IF;

  SELECT public.issue_2725_reserve_budget(
    md5('issue2725-tester-job-21')::uuid,
    '27250800-0000-4000-8000-000000000099',
    50000
  ) INTO reservation;
  IF reservation IS NULL THEN
    RAISE EXCEPTION 'next ISO week incorrectly inherited the exhausted prior week';
  END IF;
  IF (
    SELECT count(*)
    FROM public.tool_competitor_venue_week_budget_boundaries
    WHERE venue_listing_id = '27250800-0000-4000-8000-000000000011'
      AND iso_week IN (DATE '2026-08-24', DATE '2026-08-31')
  ) <> 2 THEN
    RAISE EXCEPTION 'venue/week serialization key did not separate ISO weeks';
  END IF;

  SELECT public.issue_2725_record_model_usage(
    md5('issue2725-tester-job-21')::uuid,
    '27250800-0000-4000-8000-000000000099',
    jsonb_build_object(
      'model_id', 'gemini-2.5-flash',
      'prompt_contract_version', 'competitor-brief-v2.8',
      'canonical_input_fingerprint', repeat('e', 64),
      'request_bytes', 1216,
      'prompt_tokens', 350,
      'candidate_tokens', 500,
      'thinking_tokens', 0,
      'total_tokens', 850,
      'provider_model_version', 'gemini-2.5-flash-001',
      'latency_ms', 321,
      'finish_reason', 'STOP',
      'result_class', 'accepted',
      'pricing_version', 'gemini-2.5-flash-standard-2026-08',
      'reserved_microusd', 50000,
      'actual_microusd', 1355,
      'usage_complete', true
    )
  ) INTO first_receipt;

  IF NOT EXISTS (
    SELECT 1 FROM public.tool_competitor_model_usage_receipts
    WHERE id = first_receipt
      AND prompt_tokens = 350
      AND candidate_tokens = 500
      AND thinking_tokens = 0
      AND total_tokens = 850
      AND actual_microusd = 1355
      AND reserved_microusd = 50000
      AND usage_complete
  ) THEN
    RAISE EXCEPTION 'measured receipt fields were not persisted exactly';
  END IF;

  SELECT public.issue_2725_accept_synthesis(
    md5('issue2725-tester-job-21')::uuid,
    '27250800-0000-4000-8000-000000000099',
    'gemini-2.5-flash',
    'competitor-brief-v2.8',
    repeat('e', 64)::char(64),
    first_result,
    first_receipt
  ) INTO accepted;
  IF accepted <> first_result THEN
    RAISE EXCEPTION 'first validated synthesis was not accepted';
  END IF;

  UPDATE public.tool_competitor_refresh_jobs
  SET state = 'succeeded', lease_owner = NULL, leased_at = NULL, finished_at = now()
  WHERE id = md5('issue2725-tester-job-21')::uuid;
  INSERT INTO public.tool_competitor_refresh_jobs (
    id, competitor_id, brand_id, venue_listing_id, trigger, due_week,
    source_set_fingerprint, idempotency_key, state, funding_lane,
    lease_owner, leased_at
  ) VALUES (
    md5('issue2725-tester-racing-job')::uuid,
    md5('issue2725-tester-watch-21')::uuid,
    '27250800-0000-4000-8000-000000000001',
    '27250800-0000-4000-8000-000000000011',
    'admin_retry',
    DATE '2026-08-31',
    repeat('f', 64),
    repeat('1', 64),
    'leased',
    'scheduled',
    '27250800-0000-4000-8000-000000000099',
    now()
  );
  SELECT public.issue_2725_reserve_budget(
    md5('issue2725-tester-racing-job')::uuid,
    '27250800-0000-4000-8000-000000000099',
    50000
  ) INTO reservation;
  IF reservation IS NULL THEN
    RAISE EXCEPTION 'racing job was unexpectedly denied its valid reservation';
  END IF;

  SELECT public.issue_2725_record_model_usage(
    md5('issue2725-tester-racing-job')::uuid,
    '27250800-0000-4000-8000-000000000099',
    jsonb_build_object(
      'model_id', 'gemini-2.5-flash',
      'prompt_contract_version', 'competitor-brief-v2.8',
      'canonical_input_fingerprint', repeat('e', 64),
      'request_bytes', 1216,
      'prompt_tokens', 350,
      'candidate_tokens', 501,
      'thinking_tokens', 0,
      'total_tokens', 851,
      'provider_model_version', 'gemini-2.5-flash-001',
      'latency_ms', 400,
      'finish_reason', 'STOP',
      'result_class', 'accepted',
      'pricing_version', 'gemini-2.5-flash-standard-2026-08',
      'reserved_microusd', 50000,
      'actual_microusd', 1358,
      'usage_complete', true
    )
  ) INTO second_receipt;
  SELECT public.issue_2725_accept_synthesis(
    md5('issue2725-tester-racing-job')::uuid,
    '27250800-0000-4000-8000-000000000099',
    'gemini-2.5-flash',
    'competitor-brief-v2.8',
    repeat('e', 64)::char(64),
    second_result,
    second_receipt
  ) INTO accepted;
  IF accepted <> first_result OR (
    SELECT count(*) FROM public.tool_competitor_synthesis_results
    WHERE competitor_id = md5('issue2725-tester-watch-21')::uuid
      AND canonical_input_fingerprint = repeat('e', 64)::char(64)
  ) <> 1 THEN
    RAISE EXCEPTION 'a later varying result replaced the first validated winner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tool_competitor_model_usage_receipts'
      AND column_name IN (
        'raw_prompt', 'prompt_content', 'response_body', 'model_response',
        'provider_body', 'secret'
      )
  ) THEN
    RAISE EXCEPTION 'usage receipt schema exposes raw model content or secrets';
  END IF;

  SELECT updated_at INTO watch_updated_at
  FROM public.tool_competitors
  WHERE id = md5('issue2725-tester-watch-21')::uuid;
  PERFORM public.issue_2725_watch_remove(
    '27250800-0000-4000-8000-000000000001',
    md5('issue2725-tester-watch-21')::uuid,
    watch_updated_at
  );

  IF (
    SELECT count(*) FROM public.tool_competitor_model_usage_receipts
    WHERE id IN (first_receipt, second_receipt)
      AND competitor_id IS NULL
      AND venue_listing_id IS NULL
      AND job_id IS NULL
      AND redacted_at IS NOT NULL
      AND prompt_tokens IS NOT NULL
      AND actual_microusd IS NOT NULL
  ) <> 2 OR EXISTS (
    SELECT 1 FROM public.tool_competitor_synthesis_results
    WHERE competitor_id = md5('issue2725-tester-watch-21')::uuid
  ) THEN
    RAISE EXCEPTION 'watch removal did not redact receipts and purge model content';
  END IF;
END
$proof$;

ROLLBACK;
