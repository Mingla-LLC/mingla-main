\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_table text;
  v_flag text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_payment_attempts',
    'stay_payment_allocations',
    'stay_money_ledger',
    'stay_cancel_previews',
    'stay_refunds',
    'stay_refund_allocations',
    'stay_provider_events',
    'stay_payout_line_snapshots'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'C-1 FAIL: missing Stay commerce table %', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class relation
      WHERE relation.oid = to_regclass('public.' || v_table)
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'C-1 FAIL: forced RLS missing on %', v_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       OR has_table_privilege(
         'authenticated', 'public.' || v_table, 'INSERT'
       ) THEN
      RAISE EXCEPTION 'C-1 FAIL: client DML leaked on %', v_table;
    END IF;
  END LOOP;

  FOREACH v_flag IN ARRAY ARRAY[
    'STAY_RESERVE_WRITES',
    'STAY_STRIPE_COMMERCE',
    'STAY_PAYSTACK_COMMERCE',
    'STAY_NOTIFICATIONS'
  ]
  LOOP
    IF COALESCE((
      SELECT flag.is_enabled
      FROM public.feature_flags flag
      WHERE flag.flag_key = v_flag
    ), true) THEN
      RAISE EXCEPTION 'C-1 FAIL: % must ship dark', v_flag;
    END IF;
  END LOOP;
  RAISE NOTICE 'C-1 PASS: commerce catalog is forced-RLS and dark';
END;
$catalog$;

DO $contracts$
DECLARE
  v_prepare text;
  v_finalize text;
  v_fee text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1389_prepare_payment(uuid,text,bigint,uuid)'::regprocedure
  ) INTO v_prepare;
  SELECT pg_get_functiondef(
    'public.issue_1389_finalize_payment(text,text,text,text,text,bigint,text,bigint,text)'
      ::regprocedure
  ) INTO v_finalize;
  SELECT pg_get_functiondef(
    'public.record_stay_provider_fee(uuid,integer,text)'::regprocedure
  ) INTO v_fee;
  IF v_prepare NOT LIKE '%resolve_brand_pricing_inputs%'
     OR v_prepare NOT LIKE '%pg_brand_can_collect%'
     OR v_prepare NOT LIKE '%STAY_RESERVE_WRITES%'
     OR v_prepare NOT LIKE '%STAY_STRIPE_COMMERCE%'
     OR v_prepare NOT LIKE '%STAY_PAYSTACK_COMMERCE%'
     OR strpos(v_prepare, 'p_amount') > 0
     OR strpos(v_prepare, 'p_currency') > 0 THEN
    RAISE EXCEPTION 'C-2 FAIL: provider money is not server-authoritative';
  END IF;
  IF v_finalize NOT LIKE '%provider_evidence_mismatch%'
     OR v_finalize NOT LIKE '%refund_due%'
     OR v_finalize NOT LIKE '%stay_inventory_commitments%'
     OR v_finalize NOT LIKE '%stay_reservation_confirmed%' THEN
    RAISE EXCEPTION 'C-2 FAIL: verified success atomicity weakened';
  END IF;
  IF v_fee NOT LIKE '%platform_remainder%'
     OR v_fee NOT LIKE '%provider_remainder%'
     OR v_fee NOT LIKE '%stay_provider_fee_allocation_mismatch%' THEN
    RAISE EXCEPTION 'C-2 FAIL: exact per-line fee allocation missing';
  END IF;
  RAISE NOTICE 'C-2 PASS: payment, finalization, and fee math are authoritative';
END;
$contracts$;

DO $shared_rails$
DECLARE
  v_source_constraint text;
  v_payout_constraint text;
BEGIN
  SELECT string_agg(pg_get_constraintdef(oid), ' ')
  INTO v_source_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.source_refunds'::regclass
    AND contype = 'c';
  SELECT string_agg(pg_get_constraintdef(oid), ' ')
  INTO v_payout_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.payout_release_items'::regclass
    AND contype = 'c';
  IF v_source_constraint NOT LIKE '%stay_reservation%'
     OR v_source_constraint NOT LIKE '%stay_cancellation%'
     OR v_payout_constraint NOT LIKE '%stay_reservation%' THEN
    RAISE EXCEPTION 'C-3 FAIL: shared refund/payout rail lacks typed Stay';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.stay_payment_attempts'::regclass
      AND tgname = 'stay_payment_late_success_refund'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'C-3 FAIL: automatic late-success refund missing';
  END IF;
  RAISE NOTICE 'C-3 PASS: Stay reuses typed shared refund and payout rails';
END;
$shared_rails$;

DO $operations$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.stay_reservation_events'::regclass
      AND tgname = 'stay_reservation_event_notification'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_1389_stay_reservation_sweep'
      AND schedule = '*/5 * * * *'
  ) THEN
    RAISE EXCEPTION 'C-4 FAIL: durable notification or sweep missing';
  END IF;
  RAISE NOTICE 'C-4 PASS: transactional fanout and expiry backstop exist';
END;
$operations$;

ROLLBACK;
