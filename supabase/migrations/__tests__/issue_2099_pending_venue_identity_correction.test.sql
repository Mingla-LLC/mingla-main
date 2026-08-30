\set ON_ERROR_STOP on

DO $$
DECLARE v_def text;
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN RAISE EXCEPTION '#2099 requires PG17'; END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') THEN RAISE EXCEPTION '#2099 local postgres must remain non-superuser'; END IF;
  IF has_table_privilege('authenticated','public.venue_identity_correction_audit','SELECT')
     OR has_table_privilege('service_role','public.venue_identity_correction_audit','INSERT')
     OR has_function_privilege('service_role','public.issue_2099_pending_venue_dependency_inventory(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.preview_pending_venue_identity_correction(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)','EXECUTE')
  THEN RAISE EXCEPTION '#2099 privilege contract mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger et JOIN pg_roles r ON r.oid=et.evtowner
      WHERE et.evtname='issue_2099_dependency_ddl_guard' AND et.evtevent='ddl_command_start'
        AND et.evtenabled IN ('O','A') AND et.evttags IS NULL AND r.rolname='postgres') THEN
    RAISE EXCEPTION '#2099 DDL seal missing/misowned';
  END IF;
  SELECT pg_get_functiondef('public.issue_2099_dependency_ddl_guard()'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%SECURITY DEFINER%' OR v_def NOT LIKE '%LOCK TABLE public.issue_2099_dependency_schema_guard IN EXCLUSIVE MODE%'
    OR v_def NOT LIKE '%SET search_path TO ''public'', ''pg_temp''%' THEN RAISE EXCEPTION '#2099 DDL guard definition drift'; END IF;
  SELECT pg_get_functiondef('public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%LOCK TABLE public.issue_2099_dependency_schema_guard IN SHARE MODE NOWAIT%'
    OR v_def NOT LIKE '%DDL_SEAL_UNAVAILABLE%' OR v_def NOT LIKE '%SENSITIVE_STATE_NOT_EMPTY%'
    OR v_def NOT LIKE '%STAY_AUTHORING_DISABLED%' THEN RAISE EXCEPTION '#2099 writer seal/gates missing'; END IF;
END $$;

BEGIN;
DELETE FROM public.brand_hours WHERE venue_id='20990000-0000-0000-0000-000000000020';
DELETE FROM public.brand_place_pipeline_state WHERE venue_id='20990000-0000-0000-0000-000000000020';
DELETE FROM public.venue_availability_config WHERE venue_id='20990000-0000-0000-0000-000000000020';
DELETE FROM public.venue_reservation_settings WHERE venue_id='20990000-0000-0000-0000-000000000020';
DELETE FROM public.venue_listings WHERE id='20990000-0000-0000-0000-000000000020';
DELETE FROM public.place_pool WHERE id='20990000-0000-0000-0000-000000000010';
DELETE FROM public.brand_team_members WHERE brand_id='20990000-0000-0000-0000-000000000003';
DELETE FROM public.brands WHERE id='20990000-0000-0000-0000-000000000003';
DELETE FROM public.creator_accounts WHERE id='20990000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id IN ('20990000-0000-0000-0000-000000000001','20990000-0000-0000-0000-000000000002');

INSERT INTO auth.users(id,email) VALUES
  ('20990000-0000-0000-0000-000000000001','owner-2099@example.test'),
  ('20990000-0000-0000-0000-000000000002','other-2099@example.test');
INSERT INTO public.creator_accounts(id) VALUES('20990000-0000-0000-0000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,pricing_currency)
VALUES('20990000-0000-0000-0000-000000000003','20990000-0000-0000-0000-000000000001','Issue 2099 brand','issue-2099-brand','USD','USD');
UPDATE public.brand_team_members SET role='brand_owner',accepted_at=now(),removed_at=NULL
WHERE brand_id='20990000-0000-0000-0000-000000000003' AND user_id='20990000-0000-0000-0000-000000000001';
INSERT INTO public.place_pool(id,name,lat,lng,types,primary_type,is_active,is_claimed,is_servable,fetched_via,business_author_brand_id,
  business_authoring_status,business_authoring_inputs,ai_signal_scores,photo_collage_url,business_gallery_urls,opening_hours)
VALUES('20990000-0000-0000-0000-000000000010','Old venue',6.45,3.40,ARRAY['amusement_center'],'amusement_center',true,true,false,
  'business_authored','20990000-0000-0000-0000-000000000003','draft',
  '{"tier1":{"name":"Old venue","venueCategory":"play","location":"preserve"},"other":{"keep":true}}',
  '{}'::jsonb,'',ARRAY['https://example.test/preserve.jpg'],'{"weekdayDescriptions":["preserve"]}');
INSERT INTO public.venue_listings(id,brand_id,place_pool_id,slug,name,address,city,country_code,lat,lng,venue_category,claim_status)
VALUES('20990000-0000-0000-0000-000000000020','20990000-0000-0000-0000-000000000003','20990000-0000-0000-0000-000000000010',
  'oldvenue','Old venue','1 Preserve Road','Lagos','NG',6.45,3.40,'play','pending_review');
INSERT INTO public.brand_hours(brand_id,venue_id,weekday,open_time,close_time,is_closed)
SELECT '20990000-0000-0000-0000-000000000003','20990000-0000-0000-0000-000000000020',d,'09:00','17:00',false FROM generate_series(0,6) d;
INSERT INTO public.brand_place_pipeline_state(brand_id,place_pool_id,venue_id,status,tier1_completed_at,stage_status,bouncer_reasons,last_error_code,last_error_message,coaching)
VALUES('20990000-0000-0000-0000-000000000003','20990000-0000-0000-0000-000000000010','20990000-0000-0000-0000-000000000020',
  'needs_fix',now(),'{"typed":"preserve-before"}',ARRAY['typed_before'],'typed_code','', '[{"typed":"before"}]');
INSERT INTO public.venue_reservation_settings(brand_id,place_pool_id,venue_id,reservations_enabled,fee_enabled,fee_amount_cents,fee_currency,fee_refundable,cancel_cutoff_hours,no_show_fee_policy,pass_fee_override,pass_tax_override)
VALUES('20990000-0000-0000-0000-000000000003','20990000-0000-0000-0000-000000000010','20990000-0000-0000-0000-000000000020',true,true,900,'USD',false,48,'none',true,false);
INSERT INTO public.venue_availability_config(brand_id,place_pool_id,venue_id,service_periods,turn_times,buffer_minutes,max_reservations_per_slot,slot_granularity_minutes,advance_window_days,min_notice_minutes,iana_timezone,iana_timezone_source)
VALUES('20990000-0000-0000-0000-000000000003','20990000-0000-0000-0000-000000000010','20990000-0000-0000-0000-000000000020',
  '[{"day":1}]','{"2":90}',20,2,30,60,120,'Africa/Lagos','operator');
INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('STAY_VENUE_AUTHORING',true,'#2099 fixture')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20990000-0000-0000-0000-000000000002',true);
DO $$ DECLARE v jsonb; BEGIN
  v:=public.preview_pending_venue_identity_correction('20990000-0000-0000-0000-000000000020');
  IF v->>'code'<>'NOT_AUTHORIZED' THEN RAISE EXCEPTION '#2099 non-owner escaped: %',v; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','20990000-0000-0000-0000-000000000001',true);
DO $$
DECLARE p jsonb; r jsonb; retry jsonb; rollback_preview jsonb; rb jsonb; v_source uuid;
  v_address text; v_gallery text[]; v_hours jsonb; v_inputs jsonb;
BEGIN
  p:=public.preview_pending_venue_identity_correction('20990000-0000-0000-0000-000000000020');
  IF p->>'ok'<>'true' OR p->>'schema_fingerprint'<>'52f4624c994529d2e63b8f70b79a3fcfe28f3ff90dafe300bc45439e37cd2921' THEN
    RAISE EXCEPTION '#2099 eligible preview failed: %',p;
  END IF;
  r:=public.correct_pending_venue_identity(
    '20990000-0000-0000-0000-000000000020',(p->>'brand_id')::uuid,(p->>'place_pool_id')::uuid,
    (p#>>'{current,updated_at}')::timestamptz,p#>>'{current,name}',p#>>'{current,slug}',p#>>'{current,category}',
    'Ramble Away Resort','rambleawayresort','stay','Correct unused fixture identity',
    '20990000-0000-0000-0000-000000000101',p->>'schema_fingerprint',p->>'state_fingerprint');
  IF r->>'ok'<>'true' OR r#>>'{after,category}'<>'stay' THEN RAISE EXCEPTION '#2099 forward failed: %',r; END IF;
  retry:=public.correct_pending_venue_identity(
    '20990000-0000-0000-0000-000000000020',(p->>'brand_id')::uuid,(p->>'place_pool_id')::uuid,
    (p#>>'{current,updated_at}')::timestamptz,p#>>'{current,name}',p#>>'{current,slug}',p#>>'{current,category}',
    'Ramble Away Resort','rambleawayresort','stay','Correct unused fixture identity',
    '20990000-0000-0000-0000-000000000101',p->>'schema_fingerprint',p->>'state_fingerprint');
  IF retry IS DISTINCT FROM r THEN
    RAISE EXCEPTION '#2099 idempotent replay failed: % / %',r,retry;
  END IF;
  SELECT address INTO v_address FROM public.venue_listings WHERE id='20990000-0000-0000-0000-000000000020';
  SELECT business_gallery_urls,business_authoring_inputs INTO v_gallery,v_inputs FROM public.place_pool WHERE id='20990000-0000-0000-0000-000000000010';
  SELECT jsonb_agg(to_jsonb(h)-ARRAY['created_at','updated_at'] ORDER BY weekday) INTO v_hours FROM public.brand_hours h WHERE venue_id='20990000-0000-0000-0000-000000000020';
  IF v_address<>'1 Preserve Road' OR v_gallery<>ARRAY['https://example.test/preserve.jpg']
     OR v_inputs#>>'{tier1,location}'<>'preserve' OR v_inputs#>>'{other,keep}'<>'true'
     OR (SELECT primary_type FROM public.place_pool WHERE id='20990000-0000-0000-0000-000000000010')<>'lodging'
     OR (SELECT iana_timezone FROM public.venue_availability_config WHERE venue_id='20990000-0000-0000-0000-000000000020')<>'Africa/Lagos'
     OR jsonb_array_length(v_hours)<>7 THEN RAISE EXCEPTION '#2099 preservation/mapping failed'; END IF;
  IF (SELECT reservations_enabled OR fee_enabled OR fee_amount_cents IS NOT NULL FROM public.venue_reservation_settings WHERE venue_id='20990000-0000-0000-0000-000000000020')
     OR (SELECT status<>'processing' OR stage_status<>'{}' OR coaching<>'[]' FROM public.brand_place_pipeline_state WHERE venue_id='20990000-0000-0000-0000-000000000020')
     OR (SELECT service_periods<>'[]' OR buffer_minutes<>0 OR slot_granularity_minutes<>15 FROM public.venue_availability_config WHERE venue_id='20990000-0000-0000-0000-000000000020')
  THEN RAISE EXCEPTION '#2099 reset exactness failed'; END IF;

  rollback_preview:=public.preview_pending_venue_identity_correction('20990000-0000-0000-0000-000000000020');
  v_source:=(r->>'audit_id')::uuid;
  rb:=public.correct_pending_venue_identity(
    '20990000-0000-0000-0000-000000000020',(rollback_preview->>'brand_id')::uuid,(rollback_preview->>'place_pool_id')::uuid,
    (rollback_preview#>>'{current,updated_at}')::timestamptz,rollback_preview#>>'{current,name}',rollback_preview#>>'{current,slug}',rollback_preview#>>'{current,category}',
    'Old venue','oldvenue','play','Rollback fixture correction','20990000-0000-0000-0000-000000000102',
    rollback_preview->>'schema_fingerprint',rollback_preview->>'state_fingerprint','rollback',v_source);
  IF rb->>'ok'<>'true' OR rb#>>'{after,category}'<>'play'
     OR (SELECT fee_amount_cents FROM public.venue_reservation_settings WHERE venue_id='20990000-0000-0000-0000-000000000020')<>900
     OR (SELECT business_authoring_inputs#>>'{tier1,venueCategory}' FROM public.place_pool WHERE id='20990000-0000-0000-0000-000000000010')<>'play'
     OR (SELECT ai_signal_scores FROM public.place_pool WHERE id='20990000-0000-0000-0000-000000000010')<>'{}'
  THEN RAISE EXCEPTION '#2099 rollback failed: %',rb; END IF;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE public.venue_identity_correction_audit SET reason='forbidden' WHERE request_id='20990000-0000-0000-0000-000000000101';
    RAISE EXCEPTION '#2099 audit update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.venue_identity_correction_audit
      WHERE request_id IN ('20990000-0000-0000-0000-000000000101','20990000-0000-0000-0000-000000000102'))<>2 THEN
    RAISE EXCEPTION '#2099 audit cardinality mismatch';
  END IF;
  BEGIN
    UPDATE public.venue_identity_correction_audit SET reason='owner-forbidden'
      WHERE request_id='20990000-0000-0000-0000-000000000101';
    RAISE EXCEPTION '#2099 owner audit update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.venue_identity_correction_audit
      WHERE request_id='20990000-0000-0000-0000-000000000101';
    RAISE EXCEPTION '#2099 owner audit delete unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    TRUNCATE public.venue_identity_correction_audit;
    RAISE EXCEPTION '#2099 owner audit truncate unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- #2855_TESTER_ADVERSARIAL_INCLUDE
UPDATE public.place_pool SET ai_signal_scores='{"private":"must-not-leak"}' WHERE id='20990000-0000-0000-0000-000000000010';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20990000-0000-0000-0000-000000000001',true);
DO $$ DECLARE p jsonb; BEGIN
  p:=public.preview_pending_venue_identity_correction('20990000-0000-0000-0000-000000000020');
  IF p->>'code'<>'SENSITIVE_STATE_NOT_EMPTY' OR p::text LIKE '%must-not-leak%' THEN
    RAISE EXCEPTION '#2099 sensitive-state privacy failed: %',p;
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
