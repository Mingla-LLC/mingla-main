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
  v_other_brand uuid:='17720000-0000-4000-8000-000000000011';
  v_winner uuid:='17720000-0000-4000-8000-000000000101';
  v_loser uuid:='17720000-0000-4000-8000-000000000102';
  v_extra uuid:='17720000-0000-4000-8000-000000000103';
  v_erased uuid:='17720000-0000-4000-8000-000000000104';
  v_other_person uuid:='17720000-0000-4000-8000-000000000105';
  v_conflict uuid:='17720000-0000-4000-8000-000000000201';
  v_separation uuid:='17720000-0000-4000-8000-000000000202';
  v_group uuid:='17720000-0000-4000-8000-000000000203';
  v_winner_link uuid:='17720000-0000-4000-8000-000000000301';
  v_loser_link uuid:='17720000-0000-4000-8000-000000000302';
  v_winner_email uuid:='17720000-0000-4000-8000-000000000401';
  v_promoted_email uuid:='17720000-0000-4000-8000-000000000402';
  v_loser_phone uuid:='17720000-0000-4000-8000-000000000403';
  v_erased_email uuid:='17720000-0000-4000-8000-000000000404';
  v_other_email uuid:='17720000-0000-4000-8000-000000000405';
  v_challenge uuid:='17720000-0000-4000-8000-000000000501';
  v_detail jsonb; v_result jsonb; v_replay jsonb; v_preview jsonb; v_split jsonb; v_history jsonb;
  v_merge_event uuid; v_operation uuid; v_before integer; v_denied boolean:=false; v_suppressed boolean:=false;
  v_expired boolean;
  v_completed_at timestamptz; v_snapshot_actor uuid:='17720000-0000-4000-8000-000000000006';
  v_import_batch uuid:='17720000-0000-4000-8000-000000000601';
  v_scrub_batch uuid:='17720000-0000-4000-8000-000000000602';
  v_other_batch uuid:='17720000-0000-4000-8000-000000000603';
BEGIN
  INSERT INTO auth.users(id) VALUES(v_owner),(v_admin),(v_manager),(v_event_manager),(v_support),(v_snapshot_actor);
  INSERT INTO public.creator_accounts(id) VALUES(v_owner),(v_admin),(v_manager),(v_event_manager),(v_support);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
    VALUES(v_brand,v_owner,'Issue 1772 Brand','issue-1772-brand','USD'),
      (v_other_brand,v_owner,'Issue 1772 Other','issue-1772-other','USD');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_admin,'brand_admin',now()),(v_brand,v_manager,'marketing_manager',now()),
    (v_brand,v_event_manager,'event_manager',now());
  INSERT INTO public.support_staff(user_id,enabled,available,display_name,role)
    VALUES(v_support,true,true,'Privacy Staff','lead');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key IN('manual_contact_groups_v1','contact_import_v1');

  INSERT INTO public.brand_people(id,brand_id,display_name) VALUES
    (v_winner,v_brand,'Jordan Winner'),(v_loser,v_brand,'Jordan Alternate'),
    (v_extra,v_brand,'Page Candidate'),(v_erased,v_brand,'Privacy Person'),
    (v_other_person,v_other_brand,'Other Brand Person');
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
    (v_erased_email,v_brand,v_erased,'email','privacy@example.test','brand_owned',true,true),
    (v_other_email,v_other_brand,v_other_person,'email','privacy@example.test','brand_owned',true,true);
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
  v_result:=public.biz_list_brand_person_merge_candidates(v_brand,v_winner,'+12025550172',NULL,50);
  IF v_result->'rows'->0->'matchedContact'->>'id' IS DISTINCT FROM v_loser_phone::text
     OR v_result->'rows'->0->'matchedContact'->>'channel' IS DISTINCT FROM 'phone' THEN
    RAISE EXCEPTION 'candidate contact-match context was not deterministic';
  END IF;
  v_result:=public.biz_list_brand_person_merge_candidates(v_brand,v_winner,'Page Candidate',NULL,50);
  IF v_result->'rows'->0->'matchedContact' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'name-only candidate search exposed contact match context';
  END IF;
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

  -- Both canonical-person and tombstoned-address import scrubs are brand-scoped.
  INSERT INTO public.brand_contact_import_batches(
    id,brand_id,actor_user_id,state,file_sha256,file_name,file_size_bytes,row_count,original_headers,detected_provider,dialect,
    inspection_token_hash,inspection_expires_at,mapping_version,normalized_mapping,mapping_digest,preview_token_hash,preview_expires_at,
    attestation_version,attestation_text,attested_brand_name,added_count
  ) VALUES
    (v_scrub_batch,v_brand,v_manager,'previewed',repeat('8',64),'scrub.csv',100,2,'["Name","Email"]','generic','comma',
      repeat('9',64),now()+interval '1 hour','v1','{}',repeat('a',64),repeat('b',64),now()+interval '1 hour','v1','approved','Issue 1772 Brand',2),
    (v_other_batch,v_other_brand,v_manager,'previewed',repeat('c',64),'other.csv',100,2,'["Name","Email"]','generic','comma',
      repeat('d',64),now()+interval '1 hour','v1','{}',repeat('e',64),repeat('f',64),now()+interval '1 hour','v1','approved','Issue 1772 Other',2);
  INSERT INTO public.brand_contact_import_rows(batch_id,row_number,row_fingerprint,name,email,outcome,canonical_person_id) VALUES
    (v_scrub_batch,2,repeat('1',64),'Same address','privacy@example.test','added',NULL),
    (v_scrub_batch,3,repeat('2',64),'Same person','canonical@example.test','added',v_erased),
    (v_other_batch,2,repeat('3',64),'Other same address','privacy@example.test','added',NULL),
    (v_other_batch,3,repeat('4',64),'Other canonical pointer','other-canonical@example.test','added',v_erased);

  -- Verified support-only non-user erasure, cleanup, PII scrubbing and tombstone defense.
  INSERT INTO public.brand_people_export_jobs(brand_id,export_kind,filter_hash,client_request_id,requested_by,status,storage_path,prepared_storage_path)
    VALUES
      (v_brand,'brand_book',repeat('e',64),'17720000-0000-4000-8000-000000000805',v_admin,'ready','private/book.csv','private/book.prepare.csv'),
      (v_brand,'brand_book',repeat('d',64),'17720000-0000-4000-8000-000000000811',v_admin,'running','private/run.csv','private/run.prepare.csv'),
      (v_brand,'brand_book',repeat('c',64),'17720000-0000-4000-8000-000000000812',v_admin,'queued','private/queue.csv','private/queue.prepare.csv');
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
     OR EXISTS(SELECT 1 FROM public.brand_people_export_jobs WHERE brand_id=v_brand AND export_kind='brand_book'
       AND (status<>'expired' OR safe_error_code<>'privacy_erasure' OR storage_path IS NULL OR prepared_storage_path IS NULL))
     OR (v_result->'countSummary'->>'importRowCount')::integer<>2
     OR EXISTS(SELECT 1 FROM public.brand_contact_import_rows WHERE batch_id=v_scrub_batch
       AND (name IS NOT NULL OR email IS NOT NULL OR canonical_person_id IS NOT NULL OR outcome<>'invalid' OR reason_code<>'erased_contact'))
     OR EXISTS(SELECT 1 FROM public.brand_contact_import_rows WHERE batch_id=v_other_batch
       AND (name IS NULL OR email IS NULL OR outcome<>'added'))
     OR (SELECT normalized_value FROM public.brand_person_contact_methods WHERE id=v_other_email)<>'privacy@example.test' THEN
    RAISE EXCEPTION 'database erasure/tombstone/export cleanup contract failed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.brand_person_erasure_audit WHERE id IS NOT NULL AND row_to_json(brand_person_erasure_audit)::text ILIKE '%privacy@example.test%') THEN
    RAISE EXCEPTION 'erasure audit retained raw PII';
  END IF;
  v_result:=public.issue_1772_complete_brand_person_erasure_cleanup(v_operation,v_support,true,NULL);
  IF v_result->>'state'<>'completed' THEN RAISE EXCEPTION 'cleanup finalization failed'; END IF;
  SELECT completed_at INTO v_completed_at FROM public.brand_person_erasure_operations WHERE id=v_operation;
  SELECT count(*) INTO v_before FROM public.brand_person_erasure_audit WHERE operation_id=v_operation;
  v_result:=public.issue_1772_complete_brand_person_erasure_cleanup(v_operation,v_support,false,'cleanup_retry');
  IF v_result->>'state'<>'completed' OR v_result->>'replayed'<>'true'
     OR (SELECT state FROM public.brand_person_erasure_operations WHERE id=v_operation)<>'completed'
     OR (SELECT completed_at FROM public.brand_person_erasure_operations WHERE id=v_operation) IS DISTINCT FROM v_completed_at
     OR (SELECT count(*) FROM public.brand_person_erasure_audit WHERE operation_id=v_operation)<>v_before THEN
    RAISE EXCEPTION 'completed erasure cleanup was not absorbing';
  END IF;
  v_expired:=public.biz_expire_brand_people_export(
    (SELECT id FROM public.brand_people_export_jobs WHERE client_request_id='17720000-0000-4000-8000-000000000805'),
    'private/book.csv');
  IF NOT v_expired
     OR EXISTS(SELECT 1 FROM public.brand_people_export_jobs WHERE client_request_id='17720000-0000-4000-8000-000000000805' AND storage_path IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.brand_people_export_jobs WHERE client_request_id='17720000-0000-4000-8000-000000000805' AND prepared_storage_path='private/book.prepare.csv') THEN
    RAISE EXCEPTION 'export cleanup did not clear only the exact confirmed marker';
  END IF;
  v_expired:=public.biz_expire_brand_people_export(
    (SELECT id FROM public.brand_people_export_jobs WHERE client_request_id='17720000-0000-4000-8000-000000000805'),
    'private/not-the-marker.csv');
  IF v_expired THEN RAISE EXCEPTION 'export cleanup accepted a non-marker path'; END IF;
  v_expired:=public.biz_expire_brand_people_export(
    (SELECT id FROM public.brand_people_export_jobs WHERE client_request_id='17720000-0000-4000-8000-000000000805'),
    'private/book.prepare.csv');
  IF NOT v_expired
     OR EXISTS(SELECT 1 FROM public.brand_people_export_jobs WHERE client_request_id='17720000-0000-4000-8000-000000000805' AND (storage_path IS NOT NULL OR prepared_storage_path IS NOT NULL)) THEN
    RAISE EXCEPTION 'export cleanup did not clear the second confirmed marker';
  END IF;

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

  -- Actor identifiers are durable audit snapshots, not auth-account ownership.
  INSERT INTO public.brand_person_maintenance_operations(
    client_request_id,brand_id,actor_id,operation,request_hash,required_rank,outcome,result_json
  ) VALUES('17720000-0000-4000-8000-000000000820',v_brand,v_snapshot_actor,'promote_primary',repeat('8',64),20,'unchanged','{}');
  INSERT INTO public.brand_person_erasure_challenges(
    id,client_request_id,request_hash,case_reference,brand_id,person_id,contact_method_id,channel,
    contact_fingerprint,code_hash,expires_at,created_by
  ) VALUES('17720000-0000-4000-8000-000000000821','17720000-0000-4000-8000-000000000822',repeat('9',64),'CASE-SNAPSHOT',
    v_brand,v_erased,v_erased_email,'email',repeat('a',64),repeat('b',64),now()+interval '15 minutes',v_snapshot_actor);
  INSERT INTO public.brand_person_erasure_operations(
    id,client_request_id,request_hash,challenge_id,case_reference,brand_id,person_id,actor_id,state,completed_at
  ) VALUES('17720000-0000-4000-8000-000000000823','17720000-0000-4000-8000-000000000824',repeat('c',64),
    '17720000-0000-4000-8000-000000000821','CASE-SNAPSHOT',v_brand,v_erased,v_snapshot_actor,'completed',now());
  INSERT INTO public.brand_person_erasure_audit(
    operation_id,challenge_id,case_reference,brand_id,person_id,actor_id,event
  ) VALUES('17720000-0000-4000-8000-000000000823','17720000-0000-4000-8000-000000000821','CASE-SNAPSHOT',
    v_brand,v_erased,v_snapshot_actor,'completed');
  UPDATE public.brand_person_identity_separations
    SET superseded_at=now(),superseded_by=v_snapshot_actor,superseded_by_merge_event_id=v_merge_event
    WHERE id=v_separation;
  DELETE FROM auth.users WHERE id=v_snapshot_actor;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_maintenance_operations WHERE actor_id=v_snapshot_actor)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_erasure_challenges WHERE created_by=v_snapshot_actor)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_erasure_operations WHERE actor_id=v_snapshot_actor)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_erasure_audit WHERE actor_id=v_snapshot_actor)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_identity_separations WHERE id=v_separation AND superseded_by=v_snapshot_actor) THEN
    RAISE EXCEPTION 'auth deletion destroyed an immutable actor snapshot';
  END IF;
END
$happy$;

DO $security$
DECLARE v_table text; v_proc regprocedure; v_actor_shape text;
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
  FOREACH v_actor_shape IN ARRAY ARRAY[
    'brand_person_identity_separations.superseded_by',
    'brand_person_maintenance_operations.actor_id',
    'brand_person_erasure_challenges.created_by',
    'brand_person_erasure_operations.actor_id',
    'brand_person_erasure_audit.actor_id'
  ] LOOP
    IF EXISTS(
      SELECT 1 FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=ANY(con.conkey)
      WHERE con.contype='f' AND con.conrelid=split_part(v_actor_shape,'.',1)::regclass
        AND att.attname=split_part(v_actor_shape,'.',2)
    ) THEN
      RAISE EXCEPTION 'actor snapshot gained an auth foreign key: %',v_actor_shape;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.issue_1772_lock_brand_person_address(uuid,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_1772_lock_brand_person_address(uuid,text,text)','EXECUTE')
     OR NOT (SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=public, pg_temp']::text[]
       FROM pg_proc WHERE oid='public.issue_1772_lock_brand_person_address(uuid,text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'address lock helper privilege/volatility contract failed';
  END IF;
END
$security$;

ROLLBACK;

-- Deterministic two-session proof for the novel-address edge: erasure's
-- person-first lock blocks a canonical writer whose address was not present in
-- the original scan; after deletion that writer revalidates and fails closed.
-- The second psql connects over the image's loopback-trust line as the built-in
-- supabase_admin. No credential, provider or remote service is involved.
\setenv ISSUE1772_TEST_DB :DBNAME
\! rm -f /tmp/issue_1772_novel_writer.log /tmp/issue_1772_novel_writer.done
BEGIN;
INSERT INTO auth.users(id) VALUES('17720000-0000-4000-8000-000000000901');
INSERT INTO public.creator_accounts(id) VALUES('17720000-0000-4000-8000-000000000901');
INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES('17720000-0000-4000-8000-000000000902','17720000-0000-4000-8000-000000000901','Issue 1772 Novel Race','issue-1772-novel-race','USD');
INSERT INTO public.brand_people(id,brand_id,display_name)
  VALUES('17720000-0000-4000-8000-000000000903','17720000-0000-4000-8000-000000000902','Novel Address Target');
COMMIT;

BEGIN;
SELECT 1 FROM public.brand_people
  WHERE id='17720000-0000-4000-8000-000000000903' FOR UPDATE;
\! (psql -h 127.0.0.1 -U supabase_admin -d "$ISSUE1772_TEST_DB" -v ON_ERROR_STOP=1 -c "INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary) VALUES('17720000-0000-4000-8000-000000000904','17720000-0000-4000-8000-000000000902','17720000-0000-4000-8000-000000000903','email','novel-after-scan@example.test','brand_owned',true,true) RETURNING id" > /tmp/issue_1772_novel_writer.log 2>&1; printf '%s' "$?" > /tmp/issue_1772_novel_writer.done) &
SELECT pg_sleep(0.15);
DO $blocked$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_stat_activity
    WHERE datname=current_database() AND usename='supabase_admin'
      AND query LIKE '%17720000-0000-4000-8000-000000000904%'
      AND wait_event_type='Lock'
  ) THEN
    RAISE EXCEPTION 'novel-address writer did not serialize on the target person';
  END IF;
END
$blocked$;
UPDATE public.brand_people
  SET record_status='deleted',display_name='Erased contact',deleted_at=now(),updated_at=now()
  WHERE id='17720000-0000-4000-8000-000000000903';
COMMIT;

\! for attempt in $(seq 1 100); do test -f /tmp/issue_1772_novel_writer.done && exit 0; sleep 0.05; done; exit 1
CREATE TEMP TABLE issue_1772_novel_writer_log(line text);
\copy issue_1772_novel_writer_log FROM '/tmp/issue_1772_novel_writer.log'
DO $writer_result$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM issue_1772_novel_writer_log WHERE line LIKE '%people_not_found%')
     OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE id='17720000-0000-4000-8000-000000000904') THEN
    RAISE EXCEPTION 'novel-address writer survived target erasure';
  END IF;
END
$writer_result$;

DELETE FROM public.brand_people WHERE id='17720000-0000-4000-8000-000000000903';
DELETE FROM public.brands WHERE id='17720000-0000-4000-8000-000000000902';
DELETE FROM public.creator_accounts WHERE id='17720000-0000-4000-8000-000000000901';
DELETE FROM auth.users WHERE id='17720000-0000-4000-8000-000000000901';
\! rm -f /tmp/issue_1772_novel_writer.log /tmp/issue_1772_novel_writer.done

\echo 'issue #1772 happy SQL + novel-address serialization passed'

-- #1977's new RSVP-domain batch writer remains available, while the legacy
-- Book roster wrapper must keep accepting canonical person keys and returning
-- the projected roster row that existing callers consume.
BEGIN;
INSERT INTO auth.users(id) VALUES
  ('17720100-0000-4000-8000-000000000001'),
  ('17720100-0000-4000-8000-000000000002');
INSERT INTO public.creator_accounts(id)
  VALUES('17720100-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency)
VALUES('17720100-0000-4000-8000-000000000010','17720100-0000-4000-8000-000000000001',
  'Issue 1772 RSVP Compatibility','issue-1772-rsvp-compatibility','USD');
INSERT INTO public.events(id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at)
VALUES('17720100-0000-4000-8000-000000000020','17720100-0000-4000-8000-000000000010',
  '17720100-0000-4000-8000-000000000001','rsvp','Issue 1772 RSVP Compatibility',
  'issue-1772-rsvp-compatibility','scheduled','public','USD','UTC','{}','auto',false,'{}',now(),now());
INSERT INTO public.brand_people(id,brand_id,display_name)
VALUES('17720100-0000-4000-8000-000000000030','17720100-0000-4000-8000-000000000010','Legacy Roster Guest');
INSERT INTO public.brand_offering_invites(id,brand_id,event_id,brand_person_id,origin)
VALUES('17720100-0000-4000-8000-000000000040','17720100-0000-4000-8000-000000000010',
  '17720100-0000-4000-8000-000000000020','17720100-0000-4000-8000-000000000030','wizard');
INSERT INTO public.event_rsvps(id,event_id,user_id,guest_name,guest_email,guest_phone,rsvp_status,
  approval_status,plus_count,created_at)
VALUES('17720100-0000-4000-8000-000000000060','17720100-0000-4000-8000-000000000020',NULL,
  'Legacy Roster Guest','legacy-roster@example.test',NULL,'going','pending',0,now());
INSERT INTO public.brand_person_source_links(id,brand_id,brand_person_id,source_kind,source_id,
  offering_invite_id,link_method,source_occurred_at)
VALUES('17720100-0000-4000-8000-000000000061','17720100-0000-4000-8000-000000000010',
  '17720100-0000-4000-8000-000000000030','event_rsvp','17720100-0000-4000-8000-000000000060',
  '17720100-0000-4000-8000-000000000040','invite_token',now());
INSERT INTO public.guest_roster_brand_rollouts(brand_id,phase)
VALUES('17720100-0000-4000-8000-000000000010','internal_read');
UPDATE public.feature_flags SET is_enabled=true
  WHERE flag_key IN('guest_roster_read_enabled','guest_roster_single_actions_enabled');

DO $legacy_rsvp_wrapper$
DECLARE v jsonb; v_denied boolean:=false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','17720100-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.biz_guest_roster_set_rsvp_approval(
      '17720100-0000-4000-8000-000000000020',
      'person:17720100-0000-4000-8000-000000000030','approve',
      '17720100-0000-4000-8000-000000000070');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied:=SQLERRM LIKE '%guest_roster_forbidden%';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'legacy RSVP wrapper authority did not fail closed'; END IF;

  PERFORM set_config('request.jwt.claim.sub','17720100-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.biz_guest_roster_set_rsvp_approval(
      '17720100-0000-4000-8000-000000000020',
      'person:17720100-0000-4000-8000-000000000030','approve',
      '17720100-0000-4000-8000-000000000071');
    RAISE EXCEPTION 'legacy RSVP wrapper ignored the rollout gate';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%guest_roster_action_invalid%' THEN RAISE; END IF;
  END;

  UPDATE public.guest_roster_brand_rollouts SET phase='single_actions'
    WHERE brand_id='17720100-0000-4000-8000-000000000010';
  v:=public.biz_guest_roster_set_rsvp_approval(
    '17720100-0000-4000-8000-000000000020',
    'person:17720100-0000-4000-8000-000000000030','approve',
    '17720100-0000-4000-8000-000000000072');
  IF v->>'rosterKey'<>'person:17720100-0000-4000-8000-000000000030'
     OR v->>'personId'<>'17720100-0000-4000-8000-000000000030'
     OR v->>'rsvpId'<>'17720100-0000-4000-8000-000000000060'
     OR v->>'primaryStatus'<>'going'
     OR (SELECT approval_status FROM public.event_rsvps
       WHERE id='17720100-0000-4000-8000-000000000060')<>'approved' THEN
    RAISE EXCEPTION 'legacy person-key RSVP wrapper lost projected roster DTO: %',v;
  END IF;

  UPDATE public.event_rsvps SET approval_status='denied'
    WHERE id='17720100-0000-4000-8000-000000000060';
  BEGIN
    PERFORM public.biz_guest_roster_set_rsvp_approval(
      '17720100-0000-4000-8000-000000000020',
      'person:17720100-0000-4000-8000-000000000030','approve',
      '17720100-0000-4000-8000-000000000073');
    RAISE EXCEPTION 'legacy RSVP wrapper accepted a stale status';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM NOT LIKE '%guest_roster_status_changed%' THEN RAISE; END IF;
  END;
END
$legacy_rsvp_wrapper$;
ROLLBACK;

\echo 'issue #1772 happy SQL + novel-address serialization + legacy RSVP compatibility passed'
