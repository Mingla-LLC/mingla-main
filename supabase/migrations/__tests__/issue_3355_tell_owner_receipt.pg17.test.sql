-- MINGLA-INVARIANT: I-ARI-OWNER-NOTE-ONCE-PER-APPROVAL | issue #3355 | public.ari_tell_owner_in_brand_group posts a teammate's note to the owner in the brand group chat at most once per approval: it sends only the exact words of the approved tell_owner_in_brand_group proposal, inside the #1972 operation receipt, and a retry of the same approval returns the recorded note without posting again.
--
-- Bundle 5 (20280604003355). Reverting the migration (no
-- ari_tell_owner_in_brand_group) fails the first call below.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('33550000-b500-4000-8000-000000000001','b5-owner@test.local','{"full_name":"Olu Owner"}'),
  ('33550000-b500-4000-8000-000000000002','b5-member@test.local','{"full_name":"Ada Member"}'),
  ('33550000-b500-4000-8000-000000000003','b5-outsider@test.local','{"full_name":"Out Sider"}');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-b500-4000-8000-000000000001','b5-owner@test.local','Olu Owner','b5_owner','business'),
  ('33550000-b500-4000-8000-000000000002','b5-member@test.local','Ada Member','b5_member','business'),
  ('33550000-b500-4000-8000-000000000003','b5-outsider@test.local','Out Sider','b5_outsider','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-b500-4000-8000-000000000001','b5-owner@test.local','Olu Owner','B5 Host'),
  ('33550000-b500-4000-8000-000000000003','b5-outsider@test.local','Out Sider','B5 Other Host');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('33550000-b500-4000-8000-0000000000b1','33550000-b500-4000-8000-000000000001','Lantern Supper Club','b5-lantern-supper-club'),
  ('33550000-b500-4000-8000-0000000000b2','33550000-b500-4000-8000-000000000001','Harbour Nights','b5-harbour-nights');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('33550000-b500-4000-8000-0000000000b1','33550000-b500-4000-8000-000000000002','event_manager',now()),
  ('33550000-b500-4000-8000-0000000000b2','33550000-b500-4000-8000-000000000002','event_manager',now());
INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
  ('33550000-b500-4000-8000-0000000000c1','33550000-b500-4000-8000-000000000002','33550000-b500-4000-8000-0000000000b1'),
  ('33550000-b500-4000-8000-0000000000c3','33550000-b500-4000-8000-000000000003','33550000-b500-4000-8000-0000000000b1');

DO $b5note$
DECLARE
  v_brand constant uuid := '33550000-b500-4000-8000-0000000000b1';
  v_member constant uuid := '33550000-b500-4000-8000-000000000002';
  v_outsider constant uuid := '33550000-b500-4000-8000-000000000003';
  v_note constant text := 'Ada asked Ari to set up payments for Lantern Supper Club. Only the owner can do this. Could you take a look? It''s in Mingla Host under Lantern Supper Club > Payments.';
  v_group uuid;
  v_op uuid := gen_random_uuid();
  v_op_two uuid := gen_random_uuid();
  v_op_altered uuid := gen_random_uuid();
  v_op_outsider uuid := gen_random_uuid();
  v_op_pending uuid := gen_random_uuid();
  v_op_other_tool uuid := gen_random_uuid();
  v_op_cross uuid := gen_random_uuid();
  v_other_group uuid;
  v_args jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_error text;
  v_count bigint;
BEGIN
  SELECT id INTO STRICT v_group FROM public.conversations
   WHERE linked_entity_type = 'brand' AND brand_id = v_brand;
  SELECT id INTO STRICT v_other_group FROM public.conversations
   WHERE linked_entity_type = 'brand' AND brand_id = '33550000-b500-4000-8000-0000000000b2';
  v_args := jsonb_build_object(
    'brand_id', v_brand, 'about', 'payment_setup',
    'send_to', 'Lantern Supper Club group chat', 'message', v_note);
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES
    (v_op,v_member,'33550000-b500-4000-8000-0000000000c1','tell_owner_in_brand_group',v_args,'executing','ari',v_brand,now(),now()),
    (v_op_two,v_member,'33550000-b500-4000-8000-0000000000c1','tell_owner_in_brand_group',v_args,'executing','ari',v_brand,now(),now()),
    (v_op_altered,v_member,'33550000-b500-4000-8000-0000000000c1','tell_owner_in_brand_group',v_args,'executing','ari',v_brand,now(),now()),
    (v_op_outsider,v_outsider,'33550000-b500-4000-8000-0000000000c3','tell_owner_in_brand_group',v_args,'executing','ari',v_brand,now(),now()),
    (v_op_pending,v_member,'33550000-b500-4000-8000-0000000000c1','tell_owner_in_brand_group',v_args,'pending','ari',v_brand,now(),NULL),
    (v_op_cross,v_member,'33550000-b500-4000-8000-0000000000c1','tell_owner_in_brand_group',v_args,'executing','ari',v_brand,now(),now()),
    (v_op_other_tool,v_member,'33550000-b500-4000-8000-0000000000c1','update_brand',v_args,'executing','ari',v_brand,now(),now());

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_member, 'role', 'authenticated')::text, true);

  -- 1. The first confirm posts the approved words once, as the teammate.
  v_first := public.ari_tell_owner_in_brand_group(v_op, v_group, v_note);
  IF (v_first->>'sent')::boolean IS NOT TRUE
     OR (v_first->>'replayed')::boolean IS NOT FALSE
     OR (v_first->>'conversation_id')::uuid <> v_group THEN
    RAISE EXCEPTION 'B5-1 first send result wrong: %', v_first;
  END IF;
  SELECT count(*) INTO v_count FROM public.messages
   WHERE conversation_id = v_group AND content = v_note AND sender_id = v_member;
  IF v_count <> 1 OR NOT EXISTS (
       SELECT 1 FROM public.messages WHERE id = (v_first->>'message_id')::uuid) THEN
    RAISE EXCEPTION 'B5-1 the note did not post exactly once as the teammate (count %)', v_count;
  END IF;

  -- 2. A retry of the same approval reads the posted note back; no second post.
  v_replay := public.ari_tell_owner_in_brand_group(v_op, v_group, v_note);
  IF v_replay->>'message_id' IS DISTINCT FROM v_first->>'message_id'
     OR (v_replay->>'replayed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'B5-2 the retry did not replay the recorded note: % vs %', v_replay, v_first;
  END IF;
  SELECT count(*) INTO v_count FROM public.messages
   WHERE conversation_id = v_group AND content = v_note;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'B5-2 the retry posted again (count %)', v_count;
  END IF;

  -- 3. A different approval is a different note.
  v_second := public.ari_tell_owner_in_brand_group(v_op_two, v_group, v_note);
  IF v_second->>'message_id' IS NOT DISTINCT FROM v_first->>'message_id' THEN
    RAISE EXCEPTION 'B5-3 a second approval replayed the first';
  END IF;

  -- 4. Words the teammate never approved are refused; nothing posts.
  BEGIN
    PERFORM public.ari_tell_owner_in_brand_group(v_op_altered, v_group, v_note || ' Please hurry.');
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'operation_binding_mismatch' THEN
    RAISE EXCEPTION 'B5-4 altered words were not refused (error=%)', v_error;
  END IF;

  -- 5. An approval that is not executing yet is refused (the receipt checks).
  BEGIN
    PERFORM public.ari_tell_owner_in_brand_group(v_op_pending, v_group, v_note);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'operation_not_executing' THEN
    RAISE EXCEPTION 'B5-5 a pending approval was not refused (error=%)', v_error;
  END IF;

  -- 5b. An approval for a different change can never send a note.
  BEGIN
    PERFORM public.ari_tell_owner_in_brand_group(v_op_other_tool, v_group, v_note);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'operation_binding_mismatch' THEN
    RAISE EXCEPTION 'B5-5b another tool''s approval was not refused (error=%)', v_error;
  END IF;

  -- 5c. A teammate on two brands can't post brand A's approved note in
  --     brand B's group (the destination is bound to the approval's brand).
  BEGIN
    PERFORM public.ari_tell_owner_in_brand_group(v_op_cross, v_other_group, v_note);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'operation_binding_mismatch'
     OR EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = v_other_group AND content = v_note) THEN
    RAISE EXCEPTION 'B5-5c a note went to another brand''s group (error=%)', v_error;
  END IF;

  -- 6. Someone else's approval is not this caller's to send.
  BEGIN
    PERFORM public.ari_tell_owner_in_brand_group(v_op_outsider, v_group, v_note);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'operation_binding_mismatch' THEN
    RAISE EXCEPTION 'B5-6 another user''s approval was not refused (error=%)', v_error;
  END IF;

  -- 7. A caller outside the brand group posts nothing and leaves no receipt.
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.ari_tell_owner_in_brand_group(v_op_outsider, v_group, v_note);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'conversation_unavailable' THEN
    RAISE EXCEPTION 'B5-7 a caller outside the group was not refused (error=%)', v_error;
  END IF;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.agent_operation_receipts WHERE operation_id = v_op_outsider) THEN
    RAISE EXCEPTION 'B5-7 a refused send left a receipt';
  END IF;
  SELECT count(*) INTO v_count FROM public.messages
   WHERE conversation_id = v_group AND content = v_note;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'B5-7 refused sends changed the group (count %)', v_count;
  END IF;

  -- 8. A retry reads the posted note back first, and only its own.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  v_replay := public.ari_tell_owner_receipt(v_op);
  IF v_replay->>'message_id' IS DISTINCT FROM v_first->>'message_id'
     OR (v_replay->>'replayed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'B5-8 the receipt read did not return the posted note: %', v_replay;
  END IF;
  IF public.ari_tell_owner_receipt(v_op_altered) IS NOT NULL THEN
    RAISE EXCEPTION 'B5-8 a refused approval has a receipt';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  IF public.ari_tell_owner_receipt(v_op) IS NOT NULL THEN
    RAISE EXCEPTION 'B5-8 another user read the teammate''s receipt';
  END IF;
  RESET ROLE;

  -- 9. A note whose answer was lost is settled as sent by the stuck-row
  --    reconcile (the receipt is the proof), never as failed_unknown.
  UPDATE public.agent_pending_actions
     SET executing_started_at = now() - interval '15 minutes',
         execution_attested_at = now() - interval '15 minutes'
   WHERE id IN (v_op, v_op_altered);
  PERFORM public.agent_pending_action_reconcile_stale(v_member);
  IF (SELECT status FROM public.agent_pending_actions WHERE id = v_op) <> 'executed'
     OR (SELECT executed_result->>'message_id' FROM public.agent_pending_actions WHERE id = v_op)
        IS DISTINCT FROM v_first->>'message_id' THEN
    RAISE EXCEPTION 'B5-9 a posted note was not settled as sent: %',
      (SELECT status FROM public.agent_pending_actions WHERE id = v_op);
  END IF;
  IF (SELECT status FROM public.agent_pending_actions WHERE id = v_op_altered) <> 'failed_unknown' THEN
    RAISE EXCEPTION 'B5-9 a note with no receipt was not settled as unknown';
  END IF;

  -- 10. Signed-out callers cannot reach it.
  IF has_function_privilege('anon', 'public.ari_tell_owner_in_brand_group(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ari_tell_owner_receipt(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ari_tell_owner_in_brand_group(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5-10 grants wrong';
  END IF;
END;
$b5note$;

SELECT 'issue_3355_tell_owner_receipt: all tests passed' AS result;

ROLLBACK;
