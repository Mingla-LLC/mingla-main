-- MINGLA-INVARIANT: I-3872-LOCAL-SEATS | issue #3872 | Seated Locals never exceed the locked city-program seat count; issue_3872_local_seat_guard and the pg17 contract test enforce it.
-- MINGLA-INVARIANT: I-3872-LOCAL-NOT-PAID-BY-PLACE | issue #3872 | A Local cannot pick a place tied to their own history or paid relationship, and every approved month is funded by Mingla through the shared payee ledger with no brand owner.
-- MINGLA-INVARIANT: I-3872-LOCAL-PUBLIC-DTO | issue #3872 | Public Local reads expose only the named profile and review allow-lists; applications, payout amounts, evidence and moderation notes remain private.
-- MINGLA-INVARIANT: I-3872-LOCAL-PENDING-VENUE-FENCE | issue #3872 | A Local month is a reviewed place dependency and remains disallowed while a pending venue identity is corrected; the #2099 schema pin is advanced only over that fail-closed lane.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE v_def text; v_live text;
BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('local_city_programs','local_applications','locals','local_months','local_reviews','local_events'))<>6 THEN RAISE EXCEPTION 'R4 Local tables missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='issue_3872_local_seat_limit' AND NOT tgisinternal) THEN RAISE EXCEPTION 'seat trigger missing'; END IF;
  -- The walkthrough moved the 12-month / 180-day rules into one helper that
  -- both the picker and the pick call (#3872 QA #18).
  SELECT pg_get_functiondef('public.issue_3872_local_place_conflict(uuid,uuid)'::regprocedure) INTO v_def;
  IF position('12 months' in v_def)=0 OR position('180 days' in v_def)=0 THEN RAISE EXCEPTION 'Local conflict authority incomplete'; END IF;
  SELECT pg_get_functiondef('public.local_pick_place(uuid,boolean)'::regprocedure) INTO v_def;
  IF position('personal_tie_conflict' in v_def)=0 OR position('issue_3872_local_place_conflict' in v_def)=0 THEN RAISE EXCEPTION 'Local pick conflict authority incomplete'; END IF;
  IF has_table_privilege('anon','public.local_reviews','select') OR has_table_privilege('authenticated','public.local_reviews','insert') THEN RAISE EXCEPTION 'private Local storage leaked'; END IF;
  IF NOT has_function_privilege('anon','public.public_local_profile(uuid)','execute') OR NOT has_function_privilege('anon','public.public_place_local_reviews(uuid)','execute') THEN RAISE EXCEPTION 'public DTO missing'; END IF;
  IF has_function_privilege('authenticated','public.local_payout_record(uuid,text,text,bigint,uuid)','execute') THEN RAISE EXCEPTION 'payout authority leaked'; END IF;
  SELECT pg_get_functiondef('public.local_payout_prepare(uuid)'::regprocedure) INTO v_def;
  IF position('fx_rate_snapshots' in v_def)=0 OR position('monthly_rate_minor' in v_def)=0 OR position('payout_currency' in v_def)=0 THEN RAISE EXCEPTION 'payout city rate/currency missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payee_shares_payee_kind_check' AND pg_get_constraintdef(oid) LIKE '%local_month%') THEN RAISE EXCEPTION 'shared payee ledger not extended'; END IF;
  SELECT pg_get_functiondef('public.local_review_submit(uuid,integer,text,text,date,text,uuid[],text,boolean)'::regprocedure) INTO v_def;
  IF position('cardinality(p_media_job_ids)<>1' in regexp_replace(v_def,'\s','','g'))=0 THEN RAISE EXCEPTION 'Local review evidence shape guard missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.local_months'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE '%payee_share_id%payee_shares%') THEN RAISE EXCEPTION 'Local payout ledger foreign key missing'; END IF;
  SELECT pg_get_functiondef('public.admin_local_queue()'::regprocedure) INTO v_def;
  IF position('''cities''' in v_def)=0 THEN RAISE EXCEPTION 'Admin city-program creation data missing'; END IF;
  IF NOT has_function_privilege('authenticated','public.local_landing()','execute') OR NOT has_function_privilege('authenticated','public.local_place_candidates(text)','execute') THEN RAISE EXCEPTION 'Local Explorer entry RPCs missing'; END IF;
  v_live := public.issue_2099_pending_venue_dependency_inventory(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ) ->> 'schema_fingerprint';
  IF v_live<>'0b2f6691528759d391240f966a45b350ef523b38eaa40598f6a0ab99fc149711' THEN RAISE EXCEPTION 'Local pending-venue dependency seal mismatch: %',v_live; END IF;
  SELECT pg_get_functiondef('public.preview_pending_venue_identity_correction(uuid)'::regprocedure) INTO v_def;
  IF position('0b2f6691528759d391240f966a45b350' in v_def)=0 OR position('474371dd0c8edfdd734c8ef5fe78b167' in v_def)>0 THEN RAISE EXCEPTION 'Local preview pin not advanced exactly once'; END IF;
  SELECT pg_get_functiondef('public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure) INTO v_def;
  IF position('0b2f6691528759d391240f966a45b350' in v_def)=0 OR position('474371dd0c8edfdd734c8ef5fe78b167' in v_def)>0 THEN RAISE EXCEPTION 'Local correction pin not advanced exactly once'; END IF;
  SELECT pg_get_functiondef('public.local_place_candidates(text)'::regprocedure) INTO v_def;
  IF position('12 months' in v_def)=0 OR position('issue_3872_local_place_conflict' in v_def)=0 OR position('eligible' in v_def)=0 OR position('reason' in v_def)=0 THEN RAISE EXCEPTION 'Local place picker eligibility reasons incomplete'; END IF;
  IF NOT has_function_privilege('authenticated','public.brand_place_local_reviews(uuid,uuid)','execute')
     OR has_function_privilege('anon','public.brand_place_local_reviews(uuid,uuid)','execute') THEN RAISE EXCEPTION 'claimed-place Local reply read authority missing'; END IF;
  SELECT pg_get_functiondef('public.local_place_reply(uuid,uuid,text)'::regprocedure) INTO v_def;
  IF position('24 hours' in v_def)=0 OR position('claim_status' in v_def)=0 THEN RAISE EXCEPTION 'place reply verification or edit window missing'; END IF;
  IF (SELECT count(*) FROM public.notification_categories WHERE key IN (
      'consumer.local.application_update','consumer.local.pick_open','consumer.local.pick_reminder',
      'consumer.local.submit_reminder','consumer.local.changes_requested','consumer.local.published',
      'consumer.local.paid','business.local.review_posted'))<>8 THEN RAISE EXCEPTION 'Local notification registry incomplete'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='issue_3872_local_application_notice_trigger' AND NOT tgisinternal)
     OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='issue_3872_local_month_notice_trigger' AND NOT tgisinternal)
     OR has_function_privilege('authenticated','public.local_timer_tick(timestamptz)','execute') THEN RAISE EXCEPTION 'Local notification authority incomplete or leaked'; END IF;
END;
$test$;
ROLLBACK;
