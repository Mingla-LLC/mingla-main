BEGIN;

DO $test$
DECLARE
  v_flag text := pg_get_functiondef(
    'public.issue_1389_flag_enabled(text)'::regprocedure
  );
BEGIN
  IF v_flag LIKE '%STAY_PUBLIC_PAGES%'
     OR v_flag LIKE '%STAY_RESERVE_READS'' THEN true%'
     OR v_flag NOT LIKE '%p_flag = ''STAY_RESERVE_WRITES''%' THEN
    RAISE EXCEPTION 'issue_1392 tester: drain context can widen a non-write flag';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.issue_1389_flag_enabled(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.issue_1389_flag_enabled(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1392 tester: internal flag authority became callable';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_preview text := pg_get_functiondef(
    'public.issue_1426_cancel_preview(uuid,uuid[],bigint,uuid)'::regprocedure
  );
  v_cancel text := pg_get_functiondef(
    'public.issue_1426_cancel(uuid,text,text,text,uuid)'::regprocedure
  );
BEGIN
  IF v_preview NOT LIKE '%auth.uid() IS NULL%'
     OR v_cancel NOT LIKE '%auth.uid() IS NULL%'
     OR v_preview NOT LIKE '%issue_1392_cancel_preview_base%'
     OR v_cancel NOT LIKE '%issue_1392_cancel_base(%' THEN
    RAISE EXCEPTION 'issue_1392 tester: wrapper bypasses auth or permission owner';
  END IF;
  IF v_preview LIKE '%INSERT INTO%'
     OR v_preview LIKE '%UPDATE public.feature_flags%'
     OR v_cancel LIKE '%INSERT INTO%'
     OR v_cancel LIKE '%UPDATE public.feature_flags%' THEN
    RAISE EXCEPTION 'issue_1392 tester: wrapper invents data or mutates flags';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_dispatch text := pg_get_functiondef(
    'public.biz_manage_stay_reservation(text,jsonb,bigint,uuid)'::regprocedure
  );
BEGIN
  IF (length(v_dispatch) - length(replace(v_dispatch, 'STAY_RESERVE_READS', '')))
       / length('STAY_RESERVE_READS') <> 1
     OR (length(v_dispatch) - length(replace(v_dispatch, 'STAY_RESERVE_WRITES', '')))
       / length('STAY_RESERVE_WRITES') <> 1 THEN
    RAISE EXCEPTION 'issue_1392 tester: gate is duplicated, missing, or ambiguous';
  END IF;
  IF strpos(v_dispatch, 'STAY_RESERVE_READS')
       > strpos(v_dispatch, 'issue_1388_quote_stay_cart')
     OR strpos(v_dispatch, 'STAY_RESERVE_WRITES')
       > strpos(v_dispatch, 'issue_1388_create_stay_group') THEN
    RAISE EXCEPTION 'issue_1392 tester: a side effect can run before its gate';
  END IF;
  IF (length(v_dispatch) - length(replace(
       v_dispatch,
       'issue_1431_attach_stay_attribution',
       ''
     ))) / length('issue_1431_attach_stay_attribution') <> 1
     OR strpos(v_dispatch, 'issue_1431_attach_stay_attribution')
       < strpos(v_dispatch, 'issue_1388_create_stay_group') THEN
    RAISE EXCEPTION 'issue_1392 tester: inherited attribution was lost or reordered';
  END IF;
END;
$test$;

ROLLBACK;
