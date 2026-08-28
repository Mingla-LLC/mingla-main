\set ON_ERROR_STOP on
BEGIN;

-- A lookalike sender must remain transactional/unmatched debt, even when the
-- trusted domain appears as a prefix. Substring classification would let an
-- attacker degrade every business report globally.
DO $$
DECLARE
  v_result text;
  v_campaign boolean;
BEGIN
  v_result := public.mkt_ingest_email_event(
    'svix_2714_tester_spoof',
    'email.delivered',
    'provider-2714-tester-spoof',
    jsonb_build_object(
      'type', 'email.delivered',
      'created_at', '2026-08-27T11:00:00Z',
      'data', jsonb_build_object(
        'from', 'Attacker <x@campaigns.usemingla.com.evil.example>'
      )
    )
  );
  SELECT is_campaign_event INTO v_campaign
    FROM public.marketing_email_events
   WHERE svix_id = 'svix_2714_tester_spoof';
  IF v_result <> 'unmatched' OR v_campaign THEN
    RAISE EXCEPTION '#2714 lookalike From was classified as campaign debt';
  END IF;
END $$;

-- A genuine provider-first delivery stays one raw row across retries, becomes
-- stale debt, and independently degrades both delivery and open health.
DO $$
DECLARE
  v_first text;
  v_retry text;
  v_rows integer;
  v_attempts integer;
  v_health record;
BEGIN
  v_first := public.mkt_ingest_email_event(
    'svix_2714_tester_stale',
    'email.delivered',
    'provider-2714-tester-stale',
    jsonb_build_object(
      'type', 'email.delivered',
      'created_at', '2026-08-27T11:01:00Z',
      'data', jsonb_build_object(
        'from', 'Mingla <x@campaigns.usemingla.com>'
      )
    )
  );
  IF v_first <> 'campaign_unmatched' THEN
    RAISE EXCEPTION '#2714 genuine campaign debt was not retryable: %', v_first;
  END IF;

  UPDATE public.marketing_email_events
     SET received_at = now() - interval '6 minutes'
   WHERE svix_id = 'svix_2714_tester_stale';
  v_retry := public.mkt_ingest_email_event(
    'svix_2714_tester_stale',
    'email.delivered',
    'provider-2714-tester-stale',
    jsonb_build_object(
      'type', 'email.delivered',
      'data', jsonb_build_object(
        'from', 'Mingla <x@campaigns.usemingla.com>'
      )
    )
  );
  SELECT count(*), max(reconcile_attempt_count)
    INTO v_rows, v_attempts
    FROM public.marketing_email_events
   WHERE svix_id = 'svix_2714_tester_stale';
  SELECT * INTO v_health FROM public.mkt_campaign_email_event_health();

  IF v_retry <> 'campaign_unmatched_stale' THEN
    RAISE EXCEPTION '#2714 stale retry was not surfaced: %', v_retry;
  END IF;
  IF v_rows <> 1 OR v_attempts < 2 THEN
    RAISE EXCEPTION '#2714 retry duplicated raw debt or skipped reconciliation';
  END IF;
  IF v_health.delivery_healthy OR v_health.open_healthy
     OR v_health.delivery_stale_unmatched_count < 1 THEN
    RAISE EXCEPTION '#2714 stale delivery debt did not withhold coverage';
  END IF;
END $$;

-- The aggregate boundary is app-readable but does not expose row identifiers.
DO $$
DECLARE
  v_columns text[];
BEGIN
  SELECT array_agg(p.proargnames[i] ORDER BY i)
    INTO v_columns
    FROM pg_proc p,
         generate_subscripts(p.proargnames, 1) AS i
   WHERE p.oid = 'public.mkt_campaign_email_event_health()'::regprocedure
     AND i > p.pronargs;
  IF v_columns && ARRAY[
    'email', 'recipient', 'provider_message_id', 'svix_id', 'payload',
    'message_id', 'campaign_id'
  ] THEN
    RAISE EXCEPTION '#2714 aggregate health leaks row identity: %', v_columns;
  END IF;
  IF has_function_privilege(
    'anon', 'public.mkt_campaign_email_event_health()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION '#2714 anon can read aggregate campaign health';
  END IF;
END $$;

ROLLBACK;
