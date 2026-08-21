\set ON_ERROR_STOP on
BEGIN;
DO $behavior$
DECLARE
 v_owner uuid:='23950000-0000-4000-8000-000000000001'; v_manager uuid:='23950000-0000-4000-8000-000000000002'; v_other_owner uuid:='23950000-0000-4000-8000-000000000003';
 v_brand uuid:='23950000-0000-4000-8000-000000000010'; v_other_brand uuid:='23950000-0000-4000-8000-000000000011';
 v_p1 uuid:='23950000-0000-4000-8000-000000000101'; v_p2 uuid:='23950000-0000-4000-8000-000000000102'; v_p3 uuid:='23950000-0000-4000-8000-000000000103'; v_winner uuid:='23950000-0000-4000-8000-000000000104';
 v_batch uuid:='23950000-0000-4000-8000-000000000301'; v_pending_batch uuid:='23950000-0000-4000-8000-000000000302'; v_conflict uuid:='23950000-0000-4000-8000-000000000303'; v_merge uuid:='23950000-0000-4000-8000-000000000401';
 v_campaign uuid:='23950000-0000-4000-8000-000000000501'; v_send_request uuid:='23950000-0000-4000-8000-000000000602';
 v_result jsonb; v_replay jsonb; v_detail jsonb; v_page2 jsonb; v_picker jsonb; v_group uuid; v_second_group uuid; v_other_group uuid; v_version bigint; v_candidates jsonb; v_snapshot jsonb; v_confirmed jsonb; v_stale boolean; v_not_found boolean;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_owner),(v_manager),(v_other_owner);
 INSERT INTO public.creator_accounts(id) VALUES(v_owner),(v_manager),(v_other_owner);
 INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES(v_brand,v_owner,'Issue 2395 Brand','issue-2395-brand','USD'),(v_other_brand,v_other_owner,'Issue 2395 Other','issue-2395-other','USD');
 INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES(v_brand,v_manager,'marketing_manager',clock_timestamp());
 INSERT INTO public.brand_people(id,brand_id,display_name) VALUES(v_p1,v_brand,'Alpha % literal'),(v_p2,v_brand,'Bravo _ literal'),(v_p3,v_brand,'Imported Person'),(v_winner,v_brand,'Winner Person');
 INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary,record_state)
 VALUES('23950000-0000-4000-8000-000000000201',v_brand,v_p1,'email','alpha@example.test','brand_owned',true,true,'active');
 UPDATE public.feature_flags SET is_enabled=true WHERE flag_key IN('manual_contact_groups_v1','contact_import_v1','brand_book_blast_v1');
 PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);

 -- Executable create plus exact lost-response replay.
 v_result:=public.biz_create_manual_group_v1(v_brand,'VIP regulars',ARRAY[v_p1,v_p2],'{}','23950000-0000-4000-8000-000000000601');
 v_group:=(v_result->'group'->>'groupId')::uuid;
 v_replay:=public.biz_create_manual_group_v1(v_brand,'VIP regulars',ARRAY[v_p1,v_p2],'{}','23950000-0000-4000-8000-000000000601');
 IF v_result IS DISTINCT FROM v_replay OR (SELECT count(*) FROM public.marketing_audiences WHERE brand_id=v_brand AND query_definition='{"kind":"manual_group"}')<>1 THEN RAISE EXCEPTION 'create exact replay was not immutable'; END IF;

 -- Server and client cursors page without duplicates; literal wildcards stay literal.
 v_detail:=public.biz_get_manual_group_v1(v_brand,v_group,NULL,NULL,1);
 IF jsonb_array_length(v_detail->'members')<>1 OR v_detail->'nextCursor' IS NULL THEN RAISE EXCEPTION 'detail first cursor page missing'; END IF;
 v_page2:=public.biz_get_manual_group_v1(v_brand,v_group,NULL,v_detail->'nextCursor',1);
 IF jsonb_array_length(v_page2->'members')<>1 OR v_page2->'members'->0->>'personId'=v_detail->'members'->0->>'personId' THEN RAISE EXCEPTION 'detail cursor repeated or skipped'; END IF;
 IF (public.biz_get_manual_group_v1(v_brand,v_group,'%',NULL,100)->>'filteredTotal')::int<>1 OR (public.biz_get_manual_group_v1(v_brand,v_group,'_',NULL,100)->>'filteredTotal')::int<>1 THEN RAISE EXCEPTION 'literal search wildcard escaped incorrectly'; END IF;
 v_picker:=public.biz_get_manual_group_book_picker_v1(v_brand,v_group,NULL,NULL,1);
 IF v_picker->'nextCursor' IS NULL OR v_picker->'rows'->0->>'updatedAt' IS NULL THEN RAISE EXCEPTION 'picker cursor contract missing'; END IF;
 v_page2:=public.biz_get_manual_group_book_picker_v1(v_brand,v_group,NULL,v_picker->'nextCursor',1);
 IF v_page2->'rows'->0->>'personId'=v_picker->'rows'->0->>'personId' THEN RAISE EXCEPTION 'picker cursor repeated first row'; END IF;
 v_result:=public.biz_preview_manual_group_result_v1(v_brand,v_group,ARRAY[v_p1,v_p3],'{}');
 IF (v_result->>'currentMemberCount')::int<>2 OR (v_result->>'resultingMemberCount')::int<>3 OR (v_result->>'newMemberCount')::int<>1 THEN RAISE EXCEPTION 'bounded review aggregate did not dedupe current members'; END IF;

 -- Completed imports segment canonical Book people. Pending review is excluded from reach/version until completion or cancellation.
 INSERT INTO public.brand_contact_import_batches(id,brand_id,actor_user_id,state,file_sha256,file_name,file_size_bytes,row_count,original_headers,detected_provider,dialect,inspection_token_hash,inspection_expires_at,added_count)
 VALUES(v_batch,v_brand,v_manager,'completed',repeat('a',64),'added.csv',10,1,'["Email"]','generic','comma',repeat('b',64),now()+interval '1 hour',1);
 INSERT INTO public.brand_contact_import_rows(batch_id,row_number,row_fingerprint,outcome,canonical_person_id) VALUES(v_batch,2,repeat('c',64),'added',v_p3);
 v_result:=public.biz_add_manual_group_people_v1(v_brand,v_group,'{}',ARRAY[v_batch],'23950000-0000-4000-8000-000000000603');
 IF (v_result->>'addedCount')::int<>1 THEN RAISE EXCEPTION 'canonical imported person was not segmented'; END IF;
 INSERT INTO public.brand_person_identity_conflicts(id,brand_id,source_kind,source_id,candidate_person_ids,reason) VALUES(v_conflict,v_brand,'import',v_pending_batch,'{}','manual_review');
 INSERT INTO public.brand_contact_import_batches(id,brand_id,actor_user_id,state,file_sha256,file_name,file_size_bytes,row_count,original_headers,detected_provider,dialect,inspection_token_hash,inspection_expires_at,review_count)
 VALUES(v_pending_batch,v_brand,v_manager,'completed',repeat('d',64),'review.csv',10,1,'["Email"]','generic','comma',repeat('e',64),now()+interval '1 hour',1);
 INSERT INTO public.brand_contact_import_rows(batch_id,row_number,row_fingerprint,outcome,conflict_id) VALUES(v_pending_batch,2,repeat('f',64),'review',v_conflict);
 SELECT membership_version INTO v_version FROM public.marketing_audiences WHERE id=v_group;
 PERFORM public.biz_add_manual_group_people_v1(v_brand,v_group,'{}',ARRAY[v_pending_batch],'23950000-0000-4000-8000-000000000604');
 IF (SELECT membership_version FROM public.marketing_audiences WHERE id=v_group)<>v_version THEN RAISE EXCEPTION 'pending creation changed reach version'; END IF;
 UPDATE public.brand_person_identity_conflicts SET status='resolved_dismissed',resolved_by=v_manager,resolved_at=now() WHERE id=v_conflict;
 IF (SELECT membership_version FROM public.marketing_audiences WHERE id=v_group)<>v_version+1 THEN RAISE EXCEPTION 'pending cancellation did not change version once'; END IF;

 -- Merge/remove/re-add/split restores the loser provenance without ending a later explicit winner membership.
 INSERT INTO public.brand_person_merge_events(id,brand_id,winner_person_id,loser_person_id,reason,acted_by) VALUES(v_merge,v_brand,v_winner,v_p1,'manual_resolution',v_manager);
 PERFORM public.biz_remove_manual_group_people_v1(v_brand,v_group,ARRAY[v_winner],'23950000-0000-4000-8000-000000000605');
 PERFORM public.biz_add_manual_group_people_v1(v_brand,v_group,ARRAY[v_winner],'{}','23950000-0000-4000-8000-000000000606');
 UPDATE public.brand_person_merge_events SET status='reversed',reversed_by=v_manager,reversed_at=now() WHERE id=v_merge;
 IF NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships WHERE audience_id=v_group AND brand_person_id=v_p1 AND state='active') OR NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships WHERE audience_id=v_group AND brand_person_id=v_winner AND state='active' AND source='book_picker') THEN RAISE EXCEPTION 'split did not preserve exact provenance'; END IF;

 -- Rank-20 Manual preview plus rename/source stale guards with zero sealing.
 PERFORM public.biz_rename_manual_group_v1(v_brand,v_group,'Campaign VIPs','23950000-0000-4000-8000-000000000607');
 v_result:=public.biz_create_manual_group_v1(v_brand,'Second group','{}','{}','23950000-0000-4000-8000-000000000608'); v_second_group:=(v_result->'group'->>'groupId')::uuid;
 INSERT INTO public.marketing_campaigns(id,account_id,brand_id,audience_id,name,channel,channel_payload,status) VALUES(v_campaign,v_owner,v_brand,v_group,'Manual send','email','{"kind":"email","subject":"Hello","body_html":"Hi","body_text":"Hi"}','draft');
 v_candidates:=public.biz_marketing_book_quote_candidates(v_manager,v_campaign);
 IF v_candidates->>'audienceKind'<>'manual_group' OR (v_candidates->>'selectedCount')::int<1 THEN RAISE EXCEPTION 'rank-20 Manual preview failed'; END IF;
 v_snapshot:=v_candidates||jsonb_build_object('quoteVersion',1,'quoteHash',repeat('a',64),'contentHash','cdbb30f189c5bb93e074ebbbd4f851f1a66f350d006c1e2fdfa6acc2d6376536','quotedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reachableCount',1,'suppressedCount',0,'unavailableCount',(v_candidates->>'selectedCount')::int-1,'smsSegments',0,'estimatedCostMinor',NULL,'currency',NULL,'costKind','not_metered','rateIds','[]'::jsonb,'sourceReferences','[]'::jsonb,'candidates',(SELECT jsonb_agg(x||jsonb_build_object('segments',0,'allocatedCostMinor',NULL,'rateId',NULL,'sourceReference',NULL)) FROM jsonb_array_elements(v_candidates->'candidates') x));
 PERFORM public.biz_rename_manual_group_v1(v_brand,v_group,'Campaign VIPs renamed','23950000-0000-4000-8000-000000000609');
 v_stale:=false; BEGIN PERFORM public.biz_confirm_marketing_people_send_v2(v_manager,v_campaign,v_send_request,v_snapshot,now()+interval '1 hour'); EXCEPTION WHEN check_violation THEN v_stale:=SQLERRM LIKE '%manual_group_preview_stale%'; END;
 IF NOT v_stale OR EXISTS(SELECT 1 FROM public.marketing_book_send_executions WHERE campaign_id=v_campaign) THEN RAISE EXCEPTION 'rename stale check sealed recipients'; END IF;
 v_candidates:=public.biz_marketing_book_quote_candidates(v_manager,v_campaign);
 v_snapshot:=v_snapshot||jsonb_build_object('audienceId',v_candidates->>'audienceId','audienceKind',v_candidates->>'audienceKind','audienceVersion',(v_candidates->>'audienceVersion')::bigint,'audienceName',v_candidates->>'audienceName','quotedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'quoteHash',repeat('b',64),'candidates',(SELECT jsonb_agg(x||jsonb_build_object('segments',0,'allocatedCostMinor',NULL,'rateId',NULL,'sourceReference',NULL)) FROM jsonb_array_elements(v_candidates->'candidates') x));
 UPDATE public.marketing_campaigns SET audience_id=v_second_group WHERE id=v_campaign;
 v_stale:=false; BEGIN PERFORM public.biz_confirm_marketing_people_send_v2(v_manager,v_campaign,v_send_request,v_snapshot,now()+interval '1 hour'); EXCEPTION WHEN check_violation THEN v_stale:=SQLERRM LIKE '%manual_group_preview_stale%'; END;
 IF NOT v_stale OR EXISTS(SELECT 1 FROM public.marketing_book_send_executions WHERE campaign_id=v_campaign) THEN RAISE EXCEPTION 'source switch stale check sealed recipients'; END IF;
 UPDATE public.marketing_campaigns SET audience_id=v_group WHERE id=v_campaign;
 v_confirmed:=public.biz_confirm_marketing_people_send_v2(v_manager,v_campaign,v_send_request,v_snapshot,now()+interval '1 hour');
 v_replay:=public.biz_marketing_book_existing_result_v1(v_manager,v_campaign,v_send_request,repeat('b',64),(v_snapshot->>'quotedAt')::timestamptz,NULL,NULL,(v_confirmed->>'scheduledFor')::timestamptz);
 IF v_confirmed->>'executionId' IS NULL OR v_replay->>'executionId'<>v_confirmed->>'executionId' THEN RAISE EXCEPTION 'rank-20 confirm/existing-result replay failed'; END IF;

 -- Delete block is a committed typed result/audit/receipt; foreign-brand IDs remain non-inferable.
 v_result:=public.biz_delete_manual_group_v1(v_brand,v_group,'23950000-0000-4000-8000-000000000610');
 IF v_result->>'code'<>'manual_group_delete_blocked' OR (v_result->>'blockingCampaignCount')::int<>1 OR NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_audit WHERE audience_id=v_group AND action='delete_blocked') THEN RAISE EXCEPTION 'delete block result/audit was not persistent'; END IF;
 v_replay:=public.biz_delete_manual_group_v1(v_brand,v_group,'23950000-0000-4000-8000-000000000610'); IF v_replay IS DISTINCT FROM v_result THEN RAISE EXCEPTION 'delete block exact replay changed'; END IF;
 INSERT INTO public.marketing_audiences(id,account_id,brand_id,name,query_definition,is_system_generated,created_by) VALUES('23950000-0000-4000-8000-000000000701',v_other_owner,v_other_brand,'Other private','{"kind":"manual_group"}',false,v_other_owner) RETURNING id INTO v_other_group;
 v_not_found:=false; BEGIN PERFORM public.biz_delete_manual_group_v1(v_brand,v_other_group,'23950000-0000-4000-8000-000000000611'); EXCEPTION WHEN no_data_found THEN v_not_found:=SQLERRM LIKE '%manual_group_not_found%'; END;
 IF NOT v_not_found OR EXISTS(SELECT 1 FROM public.marketing_manual_group_audit WHERE brand_id=v_brand AND audience_id=v_other_group) THEN RAISE EXCEPTION 'cross-brand delete leaked existence'; END IF;
 UPDATE public.marketing_campaigns SET status='cancelled' WHERE id=v_campaign;
 v_result:=public.biz_delete_manual_group_v1(v_brand,v_group,'23950000-0000-4000-8000-000000000612');
 IF v_result->>'deletedAt' IS NULL OR (SELECT deleted_at FROM public.marketing_audiences WHERE id=v_group) IS NULL THEN RAISE EXCEPTION 'safe delete did not complete'; END IF;
END $behavior$;
ROLLBACK;

-- Two independent PostgreSQL 17 sessions are released onto the same request
-- together. The receipt advisory lock makes the loser replay the exact result
-- instead of racing into a duplicate group/name/receipt failure.
CREATE EXTENSION IF NOT EXISTS dblink;
BEGIN;
DO $seed$
DECLARE v_owner uuid:='23950000-0000-4000-8000-000000000801'; v_manager uuid:='23950000-0000-4000-8000-000000000802'; v_brand uuid:='23950000-0000-4000-8000-000000000803';
BEGIN
 INSERT INTO auth.users(id) VALUES(v_owner),(v_manager);
 INSERT INTO public.creator_accounts(id) VALUES(v_owner),(v_manager);
 INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES(v_brand,v_owner,'Issue 2395 Race','issue-2395-race','USD');
 INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES(v_brand,v_manager,'marketing_manager',clock_timestamp());
 UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='manual_contact_groups_v1';
END $seed$;
COMMIT;
SELECT dblink_connect('issue2395_a','dbname='||current_database());
SELECT dblink_connect('issue2395_b','dbname='||current_database());
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('23950000-0000-4000-8000-000000000804',2395));
SELECT dblink_send_query('issue2395_a',$q$SELECT public.biz_create_manual_group_v1('23950000-0000-4000-8000-000000000803','Concurrent group','{}','{}','23950000-0000-4000-8000-000000000804') FROM (SELECT set_config('request.jwt.claim.sub','23950000-0000-4000-8000-000000000802',false)) s$q$);
SELECT dblink_send_query('issue2395_b',$q$SELECT public.biz_create_manual_group_v1('23950000-0000-4000-8000-000000000803','Concurrent group','{}','{}','23950000-0000-4000-8000-000000000804') FROM (SELECT set_config('request.jwt.claim.sub','23950000-0000-4000-8000-000000000802',false)) s$q$);
COMMIT;
CREATE TEMP TABLE issue_2395_concurrent_results(result jsonb);
INSERT INTO issue_2395_concurrent_results SELECT result FROM dblink_get_result('issue2395_a') AS t(result jsonb);
INSERT INTO issue_2395_concurrent_results SELECT result FROM dblink_get_result('issue2395_b') AS t(result jsonb);
DO $assert$
BEGIN
 IF (SELECT count(*) FROM issue_2395_concurrent_results)<>2
    OR (SELECT count(DISTINCT result) FROM issue_2395_concurrent_results)<>1
    OR (SELECT count(*) FROM public.marketing_audiences WHERE brand_id='23950000-0000-4000-8000-000000000803' AND query_definition='{"kind":"manual_group"}')<>1
    OR (SELECT count(*) FROM public.marketing_manual_group_mutation_receipts WHERE client_request_id='23950000-0000-4000-8000-000000000804')<>1 THEN
  RAISE EXCEPTION 'concurrent exact request did not converge to one immutable result';
 END IF;
END $assert$;
SELECT dblink_disconnect('issue2395_a');
SELECT dblink_disconnect('issue2395_b');
