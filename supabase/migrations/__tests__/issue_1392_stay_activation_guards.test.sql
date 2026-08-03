BEGIN;

DO $test$
DECLARE
  v_dispatch text;
  v_flag text;
BEGIN
  SELECT pg_get_functiondef(
    'public.biz_manage_stay_reservation(text,jsonb,bigint,uuid)'::regprocedure
  ) INTO v_dispatch;
  IF v_dispatch NOT LIKE '%STAY_RESERVE_READS%'
     OR v_dispatch NOT LIKE '%STAY_RESERVE_WRITES%'
     OR v_dispatch NOT LIKE '%issue_1431_attach_stay_attribution%'
     OR strpos(v_dispatch, 'STAY_RESERVE_READS')
        > strpos(v_dispatch, 'issue_1388_quote_stay_cart')
     OR strpos(v_dispatch, 'STAY_RESERVE_WRITES')
        > strpos(v_dispatch, 'issue_1388_create_stay_group') THEN
    RAISE EXCEPTION 'issue_1392: gates or inherited attribution are absent, or a gate runs too late';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_1389_flag_enabled(text)'::regprocedure
  ) INTO v_flag;
  IF v_flag NOT LIKE '%mingla.stay_obligation_drain%'
     OR v_flag NOT LIKE '%cancel_existing_obligation%'
     OR v_flag NOT LIKE '%p_flag = ''STAY_RESERVE_WRITES''%' THEN
    RAISE EXCEPTION 'issue_1392: cancellation drain is not exact to Stay writes';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_failed boolean := false;
BEGIN
  UPDATE public.feature_flags SET is_enabled = false
  WHERE flag_key LIKE 'STAY\_%' ESCAPE '\';
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1392-4000-8000-000000000001',
    true
  );

  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'quote',
      jsonb_build_object(
        'venueId', '00000000-1392-4000-8000-000000000002',
        'lines', jsonb_build_array(jsonb_build_object()),
        'idempotencyKey', 'issue-1392-quote-dark'
      ),
      NULL,
      '00000000-1392-4000-8000-000000000003'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%stay_rail_not_enabled%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'issue_1392: quote did not fail at the dark read gate';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'create_group',
      jsonb_build_object(
        'quoteId', '00000000-1392-4000-8000-000000000004',
        'idempotencyKey', 'issue-1392-group-dark',
        'guest', jsonb_build_object()
      ),
      1,
      '00000000-1392-4000-8000-000000000005'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%stay_rail_not_enabled%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'issue_1392: group creation did not fail at the dark write gate';
  END IF;
END;
$test$;

DO $test$
BEGIN
  UPDATE public.feature_flags SET is_enabled = false
  WHERE flag_key IN ('STAY_RESERVE_READS', 'STAY_RESERVE_WRITES');
  IF public.issue_1389_flag_enabled('STAY_RESERVE_READS')
     OR public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'issue_1392: dark flags unexpectedly enabled';
  END IF;
  PERFORM set_config(
    'mingla.stay_obligation_drain',
    'cancel_existing_obligation',
    true
  );
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'issue_1392: cancellation drain did not preserve obligations';
  END IF;
  IF public.issue_1389_flag_enabled('STAY_RESERVE_READS') THEN
    RAISE EXCEPTION 'issue_1392: cancellation drain widened quote reads';
  END IF;
  IF public.issue_1389_flag_enabled('UNKNOWN_STAY_FLAG') THEN
    RAISE EXCEPTION 'issue_1392: unknown flag did not fail closed';
  END IF;
END;
$test$;

DO $test$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.issue_1426_cancel_preview(uuid,uuid[],bigint,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.issue_1426_cancel(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1392: anonymous cancellation drain access widened';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.issue_1426_cancel_preview(uuid,uuid[],bigint,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.issue_1426_cancel(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1392: authenticated cancellation drain unavailable';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.issue_1392_cancel_preview_base(uuid,uuid[],bigint,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.issue_1392_cancel_base(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1392: internal cancellation base became callable';
  END IF;
END;
$test$;

ROLLBACK;
