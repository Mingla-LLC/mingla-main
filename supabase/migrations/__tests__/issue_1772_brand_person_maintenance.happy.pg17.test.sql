\set ON_ERROR_STOP on

BEGIN;

DO $happy$
DECLARE
  v_owner uuid:='17720000-0000-4000-8000-000000000001';
  v_admin uuid:='17720000-0000-4000-8000-000000000002';
  v_manager uuid:='17720000-0000-4000-8000-000000000003';
  v_event_manager uuid:='17720000-0000-4000-8000-000000000004';
  v_support uuid:='17720000-0000-4000-8000-000000000005';
  v_brand uuid:='17720000-0000-4000-8000-000000000010';
  v_winner uuid:='17720000-0000-4000-8000-000000000101';
  v_loser uuid:='17720000-0000-4000-8000-000000000102';
  v_extra uuid:='17720000-0000-4000-8000-000000000103';
  v_erased uuid:='17720000-0000-4000-8000-000000000104';
  v_conflict uuid:='17720000-0000-4000-8000-000000000201';
  v_separation uuid:='17720000-0000-4000-8000-000000000202';
  v_group uuid:='17720000-0000-4000-8000-000000000203';
  v_winner_link uuid:='17720000-0000-4000-8000-000000000301';
  v_loser_link uuid:='17720000-0000-4000-8000-000000000302';
  v_winner_email uuid:='17720000-0000-4000-8000-000000000401';
  v_promoted_email uuid:='17720000-0000-4000-8000-000000000402';
  v_loser_phone uuid:='17720000-0000-4000-8000-000000000403';
  v_erased_email uuid:='17720000-0000-4000-8000-000000000404';
  v_challenge uuid:='17720000-0000-4000-8000-000000000501';
  v_detail jsonb; v_result jsonb; v_replay jsonb; v_preview jsonb; v_split jsonb; v_history jsonb;
  v_merge_event uuid; v_operation uuid; v_before integer; v_denied boolean:=false; v_suppressed boolean:=false;
  v_import_batch uuid:='17720000-0000-4000-8000-000000000601';
BEGIN
  INSERT INTO auth.users(id) VALUES(v_owner),(v_admin),(v_manager),(v_event_manager),(v_support);
  INSERT INTO public.creator_accounts(id) VALUES(v_owner),(v_admin),(v_manager),(v_event_manager),(v_support);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
    VALUES(v_brand,v_owner,'Issue 1772 Brand','issue-1772-brand','USD');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_admin,'brand_admin',now()),(v_brand,v_manager,'marketing_manager',now()),
    (v_brand,v_event_manager,'event_manager',now());
  INSERT INTO public.support_staff(user_id,enabled,available,display_name,role)
    VALUES(v_support,true,true,'Privacy Staff','lead');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key IN('manual_contact_groups_v1','contact_import_v1');

  INSERT INTO public.brand_people(id,brand_id,display_name) VALUES
    (v_winner,v_brand,'Jordan Winner'),(v_loser,v_brand,'Jordan Alternate'),
    (v_extra,v_brand,'Page Candidate'),(v_erased,v_brand,'Privacy Person');
  INSERT INTO public.brand_person_source_links(id,brand_id,brand_person_id,source_kind,source_id,link_method,source_occurred_at) VALUES
    (v_winner_link,v_brand,v_winner,'manual','17720000-0000-4000-8000-000000000701','manual_resolution',now()),
    (v_loser_link,v_brand,v_loser,'manual','17720000-0000-4000-8000-000000000702','manual_resolution',now());
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id) VALUES
    (v_winner,'Jordan Winner','jordan winner','primary',v_winner_link),
    (v_loser,'Jordan Alternate','jordan alternate','primary',v_loser_link),
    (v_erased,'Privacy Person','privacy person','primary',NULL);
  INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary) VALUES
    (v_winner_email,v_brand,v_winner,'email','winner@example.test','brand_owned',true,true),
    (v_promoted_email,v_brand,v_winner,'email','winner.alt@example.test','brand_owned',true,false),
    (v_loser_phone,v_brand,v_loser,'phone','+12025550172','brand_owned',true,true),
    (v_erased_email,v_brand,v_erased,'email','privacy@example.test','brand_owned',true,true);
  INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable) VALUES
    (v_winner_email,v_winner_link,'manual',true),(v_promoted_email,v_winner_link,'manual',true),(v_loser_phone,v_loser_link,'manual',true);
  INSERT INTO public.brand_person_identity_conflicts(id,brand_id,source_kind,source_id,candidate_person_ids,reason,status,resolved_by,resolved_at)
    VALUES(v_conflict,v_brand,'manual','17720000-0000-4000-8000-000000000703',ARRAY[v_winner,v_loser],'manual_review','resolved_separate',v_admin,now());
  INSERT INTO public.brand_person_identity_separations(id,brand_id,person_id,normalized_name,separated_person_id,origin_conflict_id,decided_by)
    VALUES(v_separation,v_brand,v_winner,'jordan alternate',v_loser,v_conflict,v_admin);
  INSERT INTO public.marketing_audiences(id,account_id,brand_id,name,query_definition,is_system_generated,created_by)
    VALUES(v_group,v_owner,v_brand,'Merge proof','{"kind":"manual_group"}',false,v_admin);
  INSERT INTO public.marketing_manual_group_memberships(brand_id,audience_id,brand_person_id,source,created_by)
    VALUES(v_brand,v_group,v_loser,'book_picker',v_admin);

  -- Rank 20 can read and promote, and each channel still has one primary.
  PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
  v_detail:=public.biz_get_brand_person(v_brand,v_winner);
  IF v_detail->'capabilities'->>'canMerge'<>'false' OR v_detail->>'identityVersion' IS NULL THEN
    RAISE EXCEPTION 'rank-20 detail capability/version contract failed';
  END IF;
  v_result:=public.biz_promote_brand_person_contact(v_brand,v_winner,v_promoted_email,v_detail->>'identityVersion','17720000-0000-4000-8000-000000000801');
  IF v_result->>'outcome'<>'completed' OR (SELECT count(*) FROM public.brand_person_contact_methods WHERE brand_person_id=v_winner AND channel='email' AND record_state='active' AND is_primary)<>1
     OR NOT (SELECT is_primary FROM public.brand_person_contact_methods WHERE id=v_promoted_email) THEN
    RAISE EXCEPTION 'primary promotion was not atomic';
  END IF;
  v_detail:=public.biz_get_brand_person(v_brand,v_winner);
  v_result:=public.biz_promote_brand_person_contact(v_brand,v_winner,v_promoted_email,v_detail->>'identityVersion','17720000-0000-4000-8000-000000000802');
  IF v_result->>'outcome'<>'unchanged' THEN RAISE EXCEPTION 'same primary was not an idempotent no-op'; END IF;

  -- Rank 40 cannot merge; rank 50 gets a bounded candidate page and explicit pair preview.
  PERFORM set_config('request.jwt.claim.sub',v_event_manager::text,true);
  BEGIN
    PERFORM public.biz_preview_brand_person_merge(v_brand,v_winner,v_loser);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=SQLERRM LIKE '%people_forbidden%'; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'rank-40 merge preview was not denied'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  v_result:=public.biz_list_brand_person_merge_candidates(v_brand,v_winner,NULL,NULL,1);
  IF jsonb_array_length(v_result->'rows')<>1 OR v_result->'nextCursor' IS NULL THEN RAISE EXCEPTION 'candidate paging contract failed'; END IF;
  v_preview:=public.biz_preview_brand_person_merge(v_brand,v_winner,v_loser);
  IF v_preview->>'state'<>'ready' OR v_preview->>'hadPriorSeparation'<>'true' THEN RAISE EXCEPTION 'merge preview did not expose safe separation warning'; END IF;
  v_result:=public.biz_merge_brand_people_manual(v_brand,v_winner,v_loser,v_preview->>'leftVersion',v_preview->>'rightVersion','17720000-0000-4000-8000-000000000803');
  v_merge_event:=(v_result->>'mergeEventId')::uuid;
  IF (SELECT record_status FROM public.brand_people WHERE id=v_loser)<>'merged'
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_winner AND normalized_name='jordan alternate' AND active)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_winner AND channel='phone' AND normalized_value='+12025550172' AND record_state='active' AND NOT is_primary)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_identity_separations WHERE id=v_separation AND superseded_by_merge_event_id=v_merge_event)
     OR NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships WHERE audience_id=v_group AND brand_person_id=v_winner AND state='active') THEN
    RAISE EXCEPTION 'manual merge did not preserve survivor/alternate/group truth';
  END IF;
  v_replay:=public.biz_merge_brand_people_manual(v_brand,v_winner,v_loser,v_preview->>'leftVersion',v_preview->>'rightVersion','17720000-0000-4000-8000-000000000803');
  IF v_replay->>'mergeEventId'<>v_merge_event::text OR v_replay->>'replayed'<>'true'
     OR (SELECT count(*) FROM public.brand_person_merge_events WHERE id=v_merge_event)<>1 THEN RAISE EXCEPTION 'merge receipt replay duplicated work'; END IF;
  v_history:=public.biz_list_brand_person_merge_history(v_brand,v_winner,NULL,20);
  IF v_history::text ~ '(acted_by|reversed_by|actorId)' OR v_history->'rows'->0->>'mergeEventId'<>v_merge_event::text THEN RAISE EXCEPTION 'history leaked actor or omitted event'; END IF;
  v_split:=public.biz_preview_brand_person_split(v_brand,v_merge_event);
  IF v_split->>'state'<>'safe' OR v_split->>'splitVersion' IS NULL THEN RAISE EXCEPTION 'exact split did not preflight safe'; END IF;
  v_result:=public.biz_reverse_brand_person_merge_manual(v_brand,v_merge_event,v_split->>'splitVersion','17720000-0000-4000-8000-000000000804');
  IF v_result->>'outcome'<>'reversed' OR (SELECT record_status FROM public.brand_people WHERE id=v_loser)<>'active'
     OR EXISTS(SELECT 1 FROM public.brand_person_identity_separations WHERE id=v_separation AND superseded_at IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships WHERE audience_id=v_group AND brand_person_id=v_loser AND state='active') THEN
    RAISE EXCEPTION 'exact split did not restore separation/person/group';
  END IF;

  -- Verified support-only non-user erasure, cleanup, PII scrubbing and tombstone defense.
  INSERT INTO public.brand_people_export_jobs(brand_id,export_kind,filter_hash,client_request_id,requested_by,status,storage_path,prepared_storage_path)
    VALUES(v_brand,'brand_book',repeat('e',64),'17720000-0000-4000-8000-000000000805',v_admin,'ready','private/book.csv','private/book.prepare.csv');
  v_result:=public.issue_1772_create_brand_person_erasure_challenge(v_challenge,'17720000-0000-4000-8000-000000000806','CASE-1772',v_brand,v_erased,v_erased_email,repeat('a',64),v_support);
  IF v_result->>'destination'<>'privacy@example.test' OR v_result->>'deliveryState'<>'pending' OR v_result->>'shouldDispatch'<>'true' THEN RAISE EXCEPTION 'challenge did not use the stored contact'; END IF;
  v_result:=public.issue_1772_claim_erasure_challenge_delivery(v_challenge,v_support);
  IF v_result->>'claimed'<>'true' OR v_result->>'deliveryState'<>'dispatching' THEN RAISE EXCEPTION 'first delivery claim did not win'; END IF;
  v_result:=public.issue_1772_claim_erasure_challenge_delivery(v_challenge,v_support);
  IF v_result->>'claimed'<>'false' OR (SELECT count(*) FROM public.brand_person_erasure_audit WHERE challenge_id=v_challenge AND event='challenge_dispatch_claimed')<>1 THEN
    RAISE EXCEPTION 'replayed delivery claim was not a one-shot';
  END IF;
  v_result:=public.issue_1772_execute_brand_person_erasure(v_challenge,repeat('a',64),'17720000-0000-4000-8000-000000000810',v_support);
  IF v_result->>'state'<>'delivery_unknown'
     OR EXISTS(SELECT 1 FROM public.brand_person_erasure_operations WHERE client_request_id='17720000-0000-4000-8000-000000000810')
     OR (SELECT record_status FROM public.brand_people WHERE id=v_erased)<>'active' THEN
    RAISE EXCEPTION 'unknown delivery state allowed erasure or durable receipt';
  END IF;
  PERFORM public.issue_1772_finish_erasure_challenge_delivery(v_challenge,v_support,'sent',NULL);
  v_result:=public.issue_1772_execute_brand_person_erasure(v_challenge,repeat('a',64),'17720000-0000-4000-8000-000000000807',v_support);
  v_operation:=(v_result->>'operationId')::uuid;
  IF v_result->>'state'<>'db_erased' OR NOT (v_result->'cleanupPaths' @> '["private/book.csv","private/book.prepare.csv"]'::jsonb)
     OR (SELECT display_name FROM public.brand_people WHERE id=v_erased)<>'Erased contact'
     OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_erased AND normalized_value NOT LIKE 'erased:%')
     OR EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_erased AND (display_name<>'Erased contact' OR normalized_name NOT LIKE 'erased:%'))
     OR NOT public.issue_1772_erasure_tombstoned(v_brand,'email','privacy@example.test')
     OR EXISTS(SELECT 1 FROM public.brand_people_export_jobs WHERE brand_id=v_brand AND export_kind='brand_book' AND (status<>'expired' OR storage_path IS NOT NULL OR prepared_storage_path IS NOT NULL)) THEN
    RAISE EXCEPTION 'database erasure/tombstone/export cleanup contract failed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.brand_person_erasure_audit WHERE id IS NOT NULL AND row_to_json(brand_person_erasure_audit)::text ILIKE '%privacy@example.test%') THEN
    RAISE EXCEPTION 'erasure audit retained raw PII';
  END IF;
  v_result:=public.issue_1772_complete_brand_person_erasure_cleanup(v_operation,v_support,true,NULL);
  IF v_result->>'state'<>'completed' THEN RAISE EXCEPTION 'cleanup finalization failed'; END IF;

  SELECT count(*) INTO v_before FROM public.brand_people WHERE brand_id=v_brand;
  PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
  BEGIN
    PERFORM public.biz_add_brand_person(v_brand,'Reintroduced','privacy@example.test',NULL,NULL,'17720000-0000-4000-8000-000000000808');
  EXCEPTION WHEN check_violation THEN v_suppressed:=SQLERRM LIKE '%people_erased_contact_suppressed%'; END;
  IF NOT v_suppressed OR (SELECT count(*) FROM public.brand_people WHERE brand_id=v_brand)<>v_before THEN RAISE EXCEPTION 'manual add reintroduced erased contact'; END IF;
  v_suppressed:=false;
  BEGIN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope)
      VALUES(v_brand,v_extra,'email','privacy@example.test','brand_owned');
  EXCEPTION WHEN check_violation THEN v_suppressed:=SQLERRM LIKE '%people_erased_contact_suppressed%'; END;
  IF NOT v_suppressed THEN RAISE EXCEPTION 'contact trigger did not enforce tombstone'; END IF;

  -- A tombstoned CSV row is terminally scrubbed while its valid neighbor continues.
  INSERT INTO public.brand_contact_import_batches(
    id,brand_id,actor_user_id,state,file_sha256,file_name,file_size_bytes,row_count,original_headers,detected_provider,dialect,
    inspection_token_hash,inspection_expires_at,mapping_version,normalized_mapping,mapping_digest,preview_token_hash,preview_expires_at,
    attestation_version,attestation_text,attested_brand_name,added_count
  ) VALUES(v_import_batch,v_brand,v_manager,'previewed',repeat('1',64),'contacts.csv',100,2,'["Name","Email"]','generic','comma',
    repeat('2',64),now()+interval '1 hour','v1','{}',repeat('3',64),repeat('4',64),now()+interval '1 hour','v1','approved','Issue 1772 Brand',2);
  INSERT INTO public.brand_contact_import_rows(batch_id,row_number,row_fingerprint,name,email,outcome) VALUES
    (v_import_batch,2,repeat('5',64),'Should scrub','privacy@example.test','added'),
    (v_import_batch,3,repeat('6',64),'Valid neighbor','neighbor@example.test','added');
  PERFORM public.issue_1775_execute_import(v_import_batch,v_brand,v_manager,repeat('4',64),repeat('1',64),repeat('3',64),'v1','approved','17720000-0000-4000-8000-000000000809',repeat('7',64));
  IF NOT EXISTS(SELECT 1 FROM public.brand_contact_import_rows WHERE batch_id=v_import_batch AND row_number=2 AND outcome='invalid' AND reason_code='erased_contact' AND email IS NULL AND name IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.brand_contact_import_rows WHERE batch_id=v_import_batch AND row_number=3 AND canonical_person_id IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_id=v_brand AND normalized_value='neighbor@example.test' AND record_state='active') THEN
    RAISE EXCEPTION 'CSV tombstone did not scrub-and-continue';
  END IF;
END
$happy$;

DO $security$
DECLARE v_table text; v_proc regprocedure;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'brand_person_maintenance_operations','brand_person_erasure_keys','brand_person_erasure_challenges',
    'brand_person_erasure_operations','brand_person_erasure_tombstones','brand_person_erasure_audit'
  ] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=format('public.%I',v_table)::regclass)
       OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=v_table)
       OR EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=v_table AND grantee IN('anon','authenticated')) THEN
      RAISE EXCEPTION 'private RLS/grant contract failed: %',v_table;
    END IF;
  END LOOP;
  FOREACH v_proc IN ARRAY ARRAY[
    'public.biz_merge_brand_people_manual(uuid,uuid,uuid,text,text,uuid)'::regprocedure,
    'public.biz_promote_brand_person_contact(uuid,uuid,uuid,text,uuid)'::regprocedure,
    'public.biz_reverse_brand_person_merge_manual(uuid,uuid,text,uuid)'::regprocedure,
    'public.issue_1772_execute_brand_person_erasure(uuid,text,uuid,uuid)'::regprocedure
  ] LOOP
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']::text[] FROM pg_proc WHERE oid=v_proc) THEN
      RAISE EXCEPTION 'definer/search path contract failed: %',v_proc;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.biz_merge_brand_people_manual(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_1772_execute_brand_person_erasure(uuid,text,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'client execution grant leaked';
  END IF;
END
$security$;

ROLLBACK;
