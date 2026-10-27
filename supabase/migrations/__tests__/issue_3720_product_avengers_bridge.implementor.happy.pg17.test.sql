-- #3720 Completion Wave 4 — executable Product Inbox ↔ Avengers happy path.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('37200000-0000-4000-8000-000000000401','wave4-admin@test.local'),
  ('37200000-0000-4000-8000-000000000402','wave4-outsider@test.local');
INSERT INTO public.admin_users(email,role,status) VALUES
  ('wave4-admin@test.local','admin','active');

INSERT INTO public.support_product_signals(
  id,client_request_id,signal_kind,state,title,problem_statement,product_area,
  user_journey,impact_summary,affected_people,priority,next_update_at,next_step,
  customer_reply_draft,created_by
) VALUES
  ('37200000-0000-4000-8000-000000000411','37200000-0000-4000-8000-000000000421',
   'bug','ready_product','Private host calendar report','Private support evidence stays here.',
   'Host app','Host publishes a card.','Host cannot verify publishing.',2,'high',now()+interval '1 day',
   'Product reviews public-safe wording.','We are reviewing the publishing state.',
   '37200000-0000-4000-8000-000000000401'),
  ('37200000-0000-4000-8000-000000000412','37200000-0000-4000-8000-000000000422',
   'feature','ready_product','Private feature request','Private customer details stay here.',
   'Explorer','Explorer plans a trip.','Explorer needs a clearer planning view.',1,'normal',now()+interval '1 day',
   'Product reviews public-safe wording.','We are reviewing the request.',
   '37200000-0000-4000-8000-000000000401');

DO $proof$
DECLARE
  v_admin constant uuid := '37200000-0000-4000-8000-000000000401';
  v_signal constant uuid := '37200000-0000-4000-8000-000000000411';
  v_create_signal constant uuid := '37200000-0000-4000-8000-000000000412';
  v_search uuid;v_link uuid;v_create_search uuid;v_create uuid;v_revision integer;v_stale boolean:=false;v_gate boolean:=false;v_pending_gate boolean:=false;
  v_item uuid;
  v_snapshot jsonb := jsonb_build_object(
    'repository','Mingla-LLC/mingla-main','issue_number',4001,
    'issue_node_id','I_kwDOtest4001','project_item_id','PVTI_test4001',
    'issue_url','https://github.com/Mingla-LLC/mingla-main/issues/4001',
    'issue_title','Host calendar cards need reliable publishing state','issue_state','OPEN',
    'board_status','In Progress','board_work_type','Bug','board_product','Business',
    'board_theme','Business Tooling','board_priority','P1','board_estimate','3',
    'board_horizon','Now','board_quarter','Q4 2026','board_refined','Yes',
    'board_sprint','Sprint 20','issue_updated_at',now()::text
  );
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_revision:=public.issue_3720_save_product_avengers_review(
    v_signal,0,'Host calendar cards need reliable publishing state',
    'Hosts cannot reliably tell whether a scheduled calendar card is published.',
    'Hosts can confirm the exact publishing state before sharing their calendar.',
    ARRAY['A published card has one unambiguous state','A failed publish can be retried'],
    'Business','Business Tooling','P1','3','Now','Q4 2026');
  IF v_revision<>1 THEN RAISE EXCEPTION 'review_revision_not_one'; END IF;
  BEGIN
    PERFORM public.issue_3720_save_product_avengers_review(
      v_signal,0,'Stale title','A sufficiently long public problem statement.',
      'A sufficiently long intended outcome.',ARRAY['One useful acceptance criterion'],
      'Business','Business Tooling','P1','3','Now','Q4 2026');
  EXCEPTION WHEN sqlstate 'PT409' THEN v_stale:=true; END;
  IF NOT v_stale THEN RAISE EXCEPTION 'stale_review_was_not_rejected'; END IF;
  v_search:=public.issue_3720_queue_product_avengers_command(v_signal,'search','{}'::jsonb,gen_random_uuid());
  RESET ROLE;

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF public.issue_3720_claim_product_avengers_command(v_search) IS NULL THEN RAISE EXCEPTION 'search_not_claimed'; END IF;
  PERFORM public.issue_3720_complete_product_avengers_search(v_search,jsonb_build_array(jsonb_build_object(
    'number',4001,'title','Existing matching issue',
    'url','https://github.com/Mingla-LLC/mingla-main/issues/4001','state','OPEN')));
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.issue_3720_set_product_avengers_no_fit(v_signal,'The candidate must be reviewed before a new issue can be created.');
  BEGIN
    PERFORM public.issue_3720_queue_product_avengers_command(v_signal,'create_issue','{}'::jsonb,gen_random_uuid());
  EXCEPTION WHEN invalid_parameter_value THEN v_pending_gate:=true; END;
  IF NOT v_pending_gate THEN RAISE EXCEPTION 'pending_candidate_did_not_block_create'; END IF;
  PERFORM public.issue_3720_record_product_avengers_candidate(v_signal,4001,'selected',NULL);
  v_link:=public.issue_3720_queue_product_avengers_command(v_signal,'link_existing',jsonb_build_object('issue_number',4001),gen_random_uuid());
  RESET ROLE;

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.issue_3720_claim_product_avengers_command(v_link);
  v_item:=public.issue_3720_apply_product_avengers_snapshot(v_link,v_signal,'existing',v_snapshot);
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM public.product_signal_avengers_links WHERE signal_id=v_signal AND item_id=v_item AND link_kind='existing') THEN
    RAISE EXCEPTION 'existing_issue_link_missing';
  END IF;
  IF (SELECT state FROM public.support_product_signals WHERE id=v_signal)<>'linked' THEN RAISE EXCEPTION 'signal_not_linked'; END IF;
  IF (SELECT customer_status FROM public.product_avengers_items WHERE id=v_item)<>'Being built' THEN RAISE EXCEPTION 'status_translation_wrong'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.product_customer_update_drafts WHERE signal_id=v_signal AND state='draft') THEN RAISE EXCEPTION 'customer_draft_missing'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.issue_3720_save_product_avengers_review(
    v_create_signal,0,'Explorer planning view should show clearer progress',
    'Explorers cannot understand the current state of a trip planning action.',
    'Explorers can see a clear and current planning state.',ARRAY['The current state is shown in plain language'],
    'Explorer','Discovery & Deck','P2','3','Next','Q1 2027');
  BEGIN
    PERFORM public.issue_3720_queue_product_avengers_command(v_create_signal,'create_issue','{}'::jsonb,gen_random_uuid());
  EXCEPTION WHEN invalid_parameter_value THEN v_gate:=true; END;
  IF NOT v_gate THEN RAISE EXCEPTION 'create_without_search_was_allowed'; END IF;
  v_create_search:=public.issue_3720_queue_product_avengers_command(v_create_signal,'search','{}'::jsonb,gen_random_uuid());
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.issue_3720_claim_product_avengers_command(v_create_search);
  PERFORM public.issue_3720_complete_product_avengers_search(v_create_search,'[]'::jsonb);
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.issue_3720_set_product_avengers_no_fit(v_create_signal,'The completed search found no issue that covers this outcome.');
  v_create:=public.issue_3720_queue_product_avengers_command(v_create_signal,'create_issue','{}'::jsonb,gen_random_uuid());
  IF v_create IS NULL THEN RAISE EXCEPTION 'gated_create_not_queued'; END IF;
  RESET ROLE;
END;
$proof$;
ROLLBACK;
