\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE v_def text;
BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('local_city_programs','local_applications','locals','local_months','local_reviews','local_events'))<>6 THEN RAISE EXCEPTION 'R4 Local tables missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='issue_3872_local_seat_limit' AND NOT tgisinternal) THEN RAISE EXCEPTION 'seat trigger missing'; END IF;
  SELECT pg_get_functiondef('public.local_pick_place(uuid,boolean)'::regprocedure) INTO v_def;
  IF position('12 months' in v_def)=0 OR position('180 days' in v_def)=0 OR position('personal_tie_conflict' in v_def)=0 THEN RAISE EXCEPTION 'Local conflict authority incomplete'; END IF;
  IF has_table_privilege('anon','public.local_reviews','select') OR has_table_privilege('authenticated','public.local_reviews','insert') THEN RAISE EXCEPTION 'private Local storage leaked'; END IF;
  IF NOT has_function_privilege('anon','public.public_local_profile(uuid)','execute') OR NOT has_function_privilege('anon','public.public_place_local_reviews(uuid)','execute') THEN RAISE EXCEPTION 'public DTO missing'; END IF;
  IF has_function_privilege('authenticated','public.local_payout_record(uuid,text,text,bigint,uuid)','execute') THEN RAISE EXCEPTION 'payout authority leaked'; END IF;
  SELECT pg_get_functiondef('public.local_payout_prepare(uuid)'::regprocedure) INTO v_def;
  IF position('fx_rate_snapshots' in v_def)=0 OR position('monthly_usd_minor' in v_def)=0 THEN RAISE EXCEPTION 'payout-day FX quote missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payee_shares_payee_kind_check' AND pg_get_constraintdef(oid) LIKE '%local_month%') THEN RAISE EXCEPTION 'shared payee ledger not extended'; END IF;
  SELECT pg_get_functiondef('public.local_review_submit(uuid,integer,text,text,date,text,uuid[],text,boolean)'::regprocedure) INTO v_def;
  IF position('cardinality(p_media_job_ids)<>1' in regexp_replace(v_def,'\s','','g'))=0 THEN RAISE EXCEPTION 'Local review evidence shape guard missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.local_months'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE '%payee_share_id%payee_shares%') THEN RAISE EXCEPTION 'Local payout ledger foreign key missing'; END IF;
  SELECT pg_get_functiondef('public.admin_local_queue()'::regprocedure) INTO v_def;
  IF position('''cities''' in v_def)=0 THEN RAISE EXCEPTION 'Admin city-program creation data missing'; END IF;
END;
$test$;
ROLLBACK;
