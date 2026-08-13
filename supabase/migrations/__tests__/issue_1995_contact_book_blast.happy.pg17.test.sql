BEGIN;
DO $test$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.feature_flags WHERE flag_key='brand_book_blast_v1' AND NOT is_enabled) THEN RAISE EXCEPTION 'default-off flag missing'; END IF;
 IF has_table_privilege('authenticated','public.marketing_book_send_executions','SELECT') THEN RAISE EXCEPTION 'execution leaked'; END IF;
 IF has_table_privilege('authenticated','public.marketing_book_send_targets','SELECT') THEN RAISE EXCEPTION 'targets leaked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='issue_1995_execution_immutable') THEN RAISE EXCEPTION 'immutable guard missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='biz_marketing_book_send_audience') THEN RAISE EXCEPTION 'sealed resolver missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='biz_confirm_marketing_book_send_v1') THEN RAISE EXCEPTION 'confirmation missing'; END IF;
END $test$;

DO $behavior$
DECLARE v_actor uuid:=gen_random_uuid(); v_team_actor uuid:=gen_random_uuid(); v_outsider uuid:=gen_random_uuid(); v_brand uuid:=gen_random_uuid(); v_person uuid:=gen_random_uuid(); v_fallback uuid:=gen_random_uuid();
 v_audience uuid:=gen_random_uuid(); v_campaign uuid:=gen_random_uuid(); v_request uuid:=gen_random_uuid(); v_result record;
 v_candidates jsonb; v_snapshot jsonb; v_confirmed jsonb; v_replay jsonb; v_resolved jsonb; v_stale boolean:=false; v_forbidden boolean:=false;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_actor),(v_team_actor),(v_outsider);
 INSERT INTO public.creator_accounts(id) VALUES(v_actor),(v_team_actor),(v_outsider);
 INSERT INTO public.brands(id,account_id,name,slug) VALUES(v_brand,v_actor,'Issue 1995','issue-1995');
 INSERT INTO public.brand_people(id,brand_id,display_name,linked_user_id) VALUES(v_person,v_brand,'Fallback Person',v_actor);
 INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary,record_state)
 VALUES(v_fallback,v_brand,v_person,'email','fallback@example.com','brand_owned',true,false,'active');
 SELECT * INTO v_result FROM public.biz_brand_person_authorized_contact(v_brand,v_person,'email','transactional');
 IF v_result.contact_method_id IS DISTINCT FROM v_fallback THEN RAISE EXCEPTION 'offering primary-first fallback drifted: %, %, %',v_result.contact_method_id,v_result.reason,v_result.allowed; END IF;
 SELECT * INTO v_result FROM public.biz_brand_person_authorized_contact_v2(v_brand,v_person,'email','marketing_blast');
 IF v_result.contact_method_id IS DISTINCT FROM v_fallback THEN RAISE EXCEPTION 'marketing fallback unavailable'; END IF;
 INSERT INTO public.brand_person_channel_suppressions(brand_id,brand_person_id,channel,scope,reason,origin_table)
 VALUES(v_brand,v_person,'email','marketing','test','test');
 SELECT * INTO v_result FROM public.biz_brand_person_authorized_contact(v_brand,v_person,'email','transactional');
 IF NOT v_result.allowed THEN RAISE EXCEPTION 'transactional offering incorrectly used marketing suppression'; END IF;
 SELECT * INTO v_result FROM public.biz_brand_person_authorized_contact_v2(v_brand,v_person,'email','marketing_blast');
 IF v_result.allowed OR v_result.reason<>'suppressed' THEN RAISE EXCEPTION 'marketing blast ignored marketing suppression'; END IF;

 -- Build a real confirmable Book campaign. The snapshot contentHash is the
 -- Edge canonical JSON digest (not PostgreSQL jsonb::text); structural content
 -- equality must accept it unchanged.
 DELETE FROM public.brand_person_channel_suppressions WHERE brand_person_id=v_person;
 UPDATE public.feature_flags SET is_enabled=true WHERE flag_key IN ('contact_import_v1','brand_book_blast_v1');
 INSERT INTO public.marketing_audiences(id,account_id,brand_id,name,query_definition,is_system_generated)
 VALUES(v_audience,v_actor,v_brand,'Your Book',jsonb_build_object('kind','all_brand_people','brand_id',v_brand::text),true);
 INSERT INTO public.marketing_campaigns(id,account_id,brand_id,audience_id,name,channel,channel_payload,status)
 VALUES(v_campaign,v_actor,v_brand,v_audience,'Hello','email','{"kind":"email","subject":"Hello","body_html":"Hi","body_text":"Hi"}'::jsonb,'draft');
 INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES(v_brand,v_team_actor,'event_manager',clock_timestamp());
 IF public.biz_marketing_book_existing_result_v1(v_team_actor,v_campaign,gen_random_uuid(),repeat('a',64),clock_timestamp(),NULL,NULL,NULL) IS NOT NULL THEN
   RAISE EXCEPTION 'authorized team pre-read fabricated an execution'; END IF;
 BEGIN PERFORM public.biz_marketing_book_existing_result_v1(v_outsider,v_campaign,gen_random_uuid(),repeat('a',64),clock_timestamp(),NULL,NULL,NULL);
 EXCEPTION WHEN insufficient_privilege THEN v_forbidden:=SQLERRM LIKE '%book_blast_forbidden%'; END;
 IF NOT v_forbidden THEN RAISE EXCEPTION 'unauthorized pre-read did not fail closed'; END IF;
 v_candidates:=public.biz_marketing_book_quote_candidates(v_actor,v_campaign);
 v_snapshot:=v_candidates || jsonb_build_object(
   'quoteVersion',1,'quoteHash',repeat('a',64),
   'contentHash','cdbb30f189c5bb93e074ebbbd4f851f1a66f350d006c1e2fdfa6acc2d6376536',
   'quotedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'reachableCount',1,'suppressedCount',0,'unavailableCount',0,'smsSegments',0,
   'estimatedCostMinor',NULL,'currency',NULL,'costKind','not_metered','rateIds','[]'::jsonb,'sourceReferences','[]'::jsonb,
   'candidates',(SELECT jsonb_agg(x || jsonb_build_object('segments',0,'allocatedCostMinor',NULL,'rateId',NULL,'sourceReference',NULL)) FROM jsonb_array_elements(v_candidates->'candidates') x)
 );

 -- Changing a value on the same contact-method ID before confirmation must
 -- reject the old preview, not silently redirect it.
 UPDATE public.brand_person_contact_methods SET normalized_value='changed-before@example.com' WHERE id=v_fallback;
 BEGIN
   PERFORM public.biz_confirm_marketing_book_send_v1(v_actor,v_campaign,v_request,v_snapshot,clock_timestamp()+interval '1 hour');
 EXCEPTION WHEN check_violation THEN
   v_stale:=SQLERRM LIKE '%book_blast_preview_stale%';
 END;
 IF NOT v_stale THEN RAISE EXCEPTION 'contact change before confirm did not stale'; END IF;

 -- Refresh with the current candidate and confirm. This succeeds only when
 -- JSON content is compared structurally while the Edge digest is retained.
 v_candidates:=public.biz_marketing_book_quote_candidates(v_actor,v_campaign);
 v_snapshot:=jsonb_set(v_snapshot,'{candidates}',
   (SELECT jsonb_agg(x || jsonb_build_object('segments',0,'allocatedCostMinor',NULL,'rateId',NULL,'sourceReference',NULL)) FROM jsonb_array_elements(v_candidates->'candidates') x));
 v_snapshot:=jsonb_set(v_snapshot,'{quotedAt}',to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 v_snapshot:=jsonb_set(v_snapshot,'{quoteHash}',to_jsonb(repeat('b',64)));
 v_confirmed:=public.biz_confirm_marketing_book_send_v1(v_actor,v_campaign,v_request,v_snapshot,clock_timestamp()+interval '1 hour');
 IF v_confirmed->>'executionId' IS NULL THEN RAISE EXCEPTION 'structural Edge snapshot did not confirm'; END IF;
 IF (SELECT content_hash FROM public.marketing_book_send_executions WHERE campaign_id=v_campaign)
    <> 'cdbb30f189c5bb93e074ebbbd4f851f1a66f350d006c1e2fdfa6acc2d6376536' THEN
   RAISE EXCEPTION 'Edge content digest not retained';
 END IF;

 -- Exact lost-response retry returns the immutable execution before draft
 -- recomputation. Altered hash remains a conflict.
 v_replay:=public.biz_confirm_marketing_book_send_v1(v_actor,v_campaign,v_request,v_snapshot,clock_timestamp()+interval '2 hours');
 IF COALESCE((v_replay->>'replay')::boolean,false) IS NOT TRUE OR v_replay->>'executionId'<>v_confirmed->>'executionId' THEN
   RAISE EXCEPTION 'exact confirmation replay did not return existing execution'; END IF;
 v_stale:=false;
 BEGIN
   PERFORM public.biz_confirm_marketing_book_send_v1(v_actor,v_campaign,v_request,jsonb_set(v_snapshot,'{quoteHash}',to_jsonb(repeat('d',64))),clock_timestamp()+interval '1 hour');
 EXCEPTION WHEN unique_violation THEN v_stale:=SQLERRM LIKE '%book_blast_idempotency_conflict%'; END;
 IF NOT v_stale THEN RAISE EXCEPTION 'altered replay did not conflict'; END IF;
 FOR v_replay IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
   jsonb_build_object('quotedAt',to_jsonb(clock_timestamp()+interval '1 minute')),
   jsonb_build_object('expectedCostMinor',1),jsonb_build_object('currency','USD')
 )) LOOP
  v_stale:=false;
  BEGIN
   PERFORM public.biz_marketing_book_existing_result_v1(v_actor,v_campaign,v_request,repeat('b',64),
    CASE WHEN v_replay?'quotedAt' THEN (v_replay->>'quotedAt')::timestamptz ELSE (v_snapshot->>'quotedAt')::timestamptz END,
    CASE WHEN v_replay?'expectedCostMinor' THEN (v_replay->>'expectedCostMinor')::bigint ELSE NULL END,
    CASE WHEN v_replay?'currency' THEN v_replay->>'currency' ELSE NULL END,(v_confirmed->>'scheduledFor')::timestamptz);
  EXCEPTION WHEN unique_violation THEN v_stale:=SQLERRM LIKE '%book_blast_idempotency_conflict%'; END;
  IF NOT v_stale THEN RAISE EXCEPTION 'altered exact replay field did not conflict: %',v_replay; END IF;
 END LOOP;

 -- An in-place value change after confirmation can only shrink the resolver;
 -- it can never redirect delivery to the new value.
 UPDATE public.brand_person_contact_methods SET normalized_value='changed-after@example.com' WHERE id=v_fallback;
 v_resolved:=public.biz_marketing_book_send_audience(v_campaign);
 IF jsonb_array_length(v_resolved->'rows')<>0 THEN RAISE EXCEPTION 'sealed contact redirected after confirmation'; END IF;
END $behavior$;
ROLLBACK;
