-- #4382 Support Desk redesign: independent tester adversarial proof.
-- A different angle from issue_4382_support_desk.implementor.pg17.test.sql:
-- cross-brand isolation, a removed brand member, stolen and squatted upload
-- ids, the admin composer's real "register as reply, send as note" path, and
-- every privileged door tried by the wrong person. Nothing here counts rows
-- globally, so it holds on a database other suites have already used.
-- MINGLA-INVARIANT: I-4382-TESTER-BRAND-ISOLATION | issue #4382 | A member of brand A, or a removed member of brand B, never reads, uploads to, replies on or sees the Product stage of brand B's ticket.
-- MINGLA-INVARIANT: I-4382-TESTER-UPLOAD-IDS-OWNED | issue #4382 | An attachment id can only be sent by the person who registered it, on the ticket it was registered for; a squatted unsent request id never reaches the real ticket.
-- MINGLA-INVARIANT: I-4382-TESTER-NOTE-FILES-PRIVATE | issue #4382 | A file registered as non-internal and then sent on an internal note becomes internal: the customer cannot read its row or its storage object.
BEGIN;

CREATE FUNCTION pg_temp.t4382x_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END;
$$;

DO $adversarial$
DECLARE
  v_staff constant uuid := '4382f000-0000-4000-8000-0000000000a1';
  v_helper constant uuid := '4382f000-0000-4000-8000-0000000000a2';
  v_owner_a constant uuid := '4382f000-0000-4000-8000-0000000000b1';
  v_owner_b constant uuid := '4382f000-0000-4000-8000-0000000000b2';
  v_mate_b constant uuid := '4382f000-0000-4000-8000-0000000000b3';
  v_gone_b constant uuid := '4382f000-0000-4000-8000-0000000000b4';
  v_explorer constant uuid := '4382f000-0000-4000-8000-0000000000c1';
  v_squatter constant uuid := '4382f000-0000-4000-8000-0000000000d1';
  v_brand_a constant uuid := '4382f000-0000-4000-8000-0000000000e1';
  v_brand_b constant uuid := '4382f000-0000-4000-8000-0000000000e2';
  v_ticket_b constant uuid := '4382f000-0000-4000-8000-000000000101';
  v_ticket_ex constant uuid := '4382f000-0000-4000-8000-000000000102';
  v_ticket_squat constant uuid := '4382f000-0000-4000-8000-000000000103';
  v_ticket_internal constant uuid := '4382f000-0000-4000-8000-000000000104';
  v_mate_upload jsonb;
  v_staff_upload jsonb;
  v_squat_upload jsonb;
  v_note_upload jsonb;
  v_result jsonb;
  v_note_message uuid;
  v_state text;
  v_raised boolean;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_staff, 'staff-4382x@example.test'),
    (v_helper, 'helper-4382x@example.test'),
    (v_owner_a, 'owner-a-4382x@example.test'),
    (v_owner_b, 'owner-b-4382x@example.test'),
    (v_mate_b, 'mate-b-4382x@example.test'),
    (v_gone_b, 'gone-b-4382x@example.test'),
    (v_explorer, 'explorer-4382x@example.test'),
    (v_squatter, 'squatter-4382x@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('staff-4382x@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status)
  VALUES ('helper-4382x@example.test', 'growth', 'active');
  INSERT INTO public.support_staff(user_id, enabled, available, display_name)
  VALUES (v_staff, true, true, 'Tess from Support'), (v_helper, true, true, 'Hal from Support')
  ON CONFLICT (user_id) DO UPDATE SET enabled = true;
  INSERT INTO public.creator_accounts(id, email, display_name, business_name) VALUES
    (v_owner_a, 'owner-a-4382x@example.test', 'Owner A', 'Brand A 4382x'),
    (v_owner_b, 'owner-b-4382x@example.test', 'Owner B', 'Brand B 4382x');
  INSERT INTO public.brands(id, name, slug, account_id) VALUES
    (v_brand_a, 'Brand A 4382x', 'brand-a-4382x', v_owner_a),
    (v_brand_b, 'Brand B 4382x', 'brand-b-4382x', v_owner_b);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
    (v_brand_a, v_owner_a, 'brand_owner', now()),
    (v_brand_b, v_owner_b, 'brand_owner', now()),
    (v_brand_b, v_mate_b, 'brand_admin', now()),
    (v_brand_b, v_gone_b, 'brand_admin', now())
  ON CONFLICT DO NOTHING;

  SET LOCAL ROLE authenticated;

  -- ── Brand B opens a brand-visible request; mate B and staff upload ──
  PERFORM pg_temp.t4382x_as(v_owner_b);
  PERFORM public.issue_4382_create_customer_ticket(
    v_ticket_b, 'host', 'payouts', 'Payout missing', 'Our payout did not arrive',
    ARRAY[]::uuid[], '{"app_version":"2.0.0"}'::jsonb, v_brand_b, 'brand');

  -- Brand A cannot open a request "about" brand B.
  PERFORM pg_temp.t4382x_as(v_owner_a);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_create_customer_ticket(
      '4382f000-0000-4000-8000-000000000199', 'host', 'payouts', NULL, 'Spoofed',
      ARRAY[]::uuid[], '{}'::jsonb, v_brand_b, 'brand');
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'brand_a_opened_ticket_for_brand_b'; END IF;

  PERFORM pg_temp.t4382x_as(v_mate_b);
  v_mate_upload := public.issue_4382_register_support_attachment(
    v_ticket_b, 'image', 'image/png', 4000, 10, 10, NULL, false);
  INSERT INTO storage.objects(bucket_id, name, owner)
  VALUES ('support-attachments', v_mate_upload->>'storage_path', v_mate_b);

  PERFORM pg_temp.t4382x_as(v_staff);
  v_staff_upload := public.issue_4382_register_support_attachment(
    v_ticket_b, 'image', 'image/png', 4000, 10, 10, NULL, true);

  -- ── Brand A sees nothing of brand B, through any door ──
  PERFORM pg_temp.t4382x_as(v_owner_a);
  IF EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_ticket_b)
     OR EXISTS (SELECT 1 FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id WHERE t.id = v_ticket_b)
     OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = (SELECT conversation_id FROM public.support_tickets WHERE id = v_ticket_b))
     OR EXISTS (SELECT 1 FROM public.support_attachments WHERE ticket_id = v_ticket_b)
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'support-attachments' AND name = v_mate_upload->>'storage_path')
     OR public.issue_4382_ticket_product_stage(v_ticket_b) IS NOT NULL THEN
    RAISE EXCEPTION 'brand_a_sees_brand_b';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_register_support_attachment(
      v_ticket_b, 'image', 'image/png', 4000, 10, 10, NULL, false);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'brand_a_uploaded_to_brand_b'; END IF;

  -- ── A removed member of brand B loses the ticket ──
  RESET ROLE;
  UPDATE public.brand_team_members SET removed_at = now()
   WHERE brand_id = v_brand_b AND user_id = v_gone_b;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382x_as(v_gone_b);
  IF EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_ticket_b)
     OR EXISTS (SELECT 1 FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id WHERE t.id = v_ticket_b)
     OR public.issue_4382_ticket_product_stage(v_ticket_b) IS NOT NULL THEN
    RAISE EXCEPTION 'removed_member_still_sees_brand_ticket';
  END IF;
  RESET ROLE;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_post_support_message(
      v_ticket_b, v_gone_b, false, 'still here?', ARRAY[]::uuid[], false, NULL, NULL, NULL, false, 'reply');
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'removed_member_replied'; END IF;

  -- ── Upload ids are owned: nobody sends another person's file ──
  -- Owner B (same brand, same ticket) tries mate B's unsent upload.
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_post_support_message(
      v_ticket_b, v_owner_b, false, 'look', ARRAY[(v_mate_upload->>'attachment_id')::uuid],
      false, NULL, NULL, NULL, false, 'reply');
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'brand_mate_sent_someone_elses_upload'; END IF;
  -- Owner B tries the staff member's internal upload on the same ticket.
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_post_support_message(
      v_ticket_b, v_owner_b, false, 'look', ARRAY[(v_staff_upload->>'attachment_id')::uuid],
      false, NULL, NULL, NULL, false, 'reply');
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'customer_sent_staff_internal_upload'; END IF;
  -- Staff cannot push its internal upload into a customer-visible reply.
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_post_support_message(
      v_ticket_b, v_staff, true, 'see attached', ARRAY[(v_staff_upload->>'attachment_id')::uuid],
      false, NULL, NULL, 'Tess', false, 'reply');
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'internal_upload_sent_as_reply'; END IF;
  IF EXISTS (SELECT 1 FROM public.support_attachments
             WHERE id IN ((v_mate_upload->>'attachment_id')::uuid, (v_staff_upload->>'attachment_id')::uuid)
               AND message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'refused_send_still_attached_a_file';
  END IF;

  -- ── The admin composer path: registered as non-internal, sent on a note ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382x_as(v_explorer);
  PERFORM public.issue_4382_create_customer_ticket(
    v_ticket_ex, 'explorer', 'broken', NULL, 'Checkout spins forever',
    ARRAY[]::uuid[], '{"os":"android"}'::jsonb, NULL, 'person');
  PERFORM pg_temp.t4382x_as(v_staff);
  v_note_upload := public.issue_4382_register_support_attachment(
    v_ticket_ex, 'image', 'image/jpeg', 9000, 20, 20, NULL, false);
  INSERT INTO storage.objects(bucket_id, name, owner)
  VALUES ('support-attachments', v_note_upload->>'storage_path', v_staff);
  RESET ROLE;
  v_result := public.issue_4382_post_support_message(
    v_ticket_ex, v_staff, true, 'Card processor logs attached', ARRAY[(v_note_upload->>'attachment_id')::uuid],
    true, NULL, NULL, 'Tess', false, 'reply');
  v_note_message := (v_result->>'message_id')::uuid;
  IF (v_result->>'is_internal')::boolean IS NOT TRUE
     OR (SELECT is_internal FROM public.support_attachments WHERE id = (v_note_upload->>'attachment_id')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'note_file_not_internal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox
             WHERE payload->>'message_id' = v_note_message::text) THEN
    RAISE EXCEPTION 'internal_note_enqueued_a_push';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382x_as(v_explorer);
  IF EXISTS (SELECT 1 FROM public.messages WHERE id = v_note_message)
     OR EXISTS (SELECT 1 FROM public.support_attachments WHERE id = (v_note_upload->>'attachment_id')::uuid)
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'support-attachments' AND name = v_note_upload->>'storage_path')
     OR public.issue_4382_can_read_attachment_object(v_note_upload->>'storage_path', v_explorer) THEN
    RAISE EXCEPTION 'customer_reads_note_file';
  END IF;
  -- The customer cannot flip a note public, nor write one.
  UPDATE public.messages SET is_internal = false WHERE id = v_note_message;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'customer_unhid_a_note'; END IF;
  v_raised := false;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, is_internal)
    SELECT conversation_id, v_explorer, 'fake note', 'text', true
      FROM public.support_tickets WHERE id = v_ticket_ex;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'customer_wrote_internal_note'; END IF;
  v_raised := false;
  BEGIN
    UPDATE public.messages SET is_internal = true
     WHERE conversation_id = (SELECT conversation_id FROM public.support_tickets WHERE id = v_ticket_ex)
       AND sender_id = v_explorer;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'customer_hid_own_message_as_note'; END IF;
  -- Customer cannot register an internal file or nest a location in client details.
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_register_support_attachment(
      v_ticket_ex, 'image', 'image/png', 100, 1, 1, NULL, true);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'customer_registered_internal_file'; END IF;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_create_customer_ticket(
      '4382f000-0000-4000-8000-000000000198', 'explorer', 'broken', NULL, 'x',
      ARRAY[]::uuid[], '{"source_screen":{"lat":6.5,"lng":3.3}}'::jsonb, NULL, 'person');
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'nested_location_accepted'; END IF;

  -- ── Draft squatting: a guessed request id never reaches the real ticket ──
  PERFORM pg_temp.t4382x_as(v_squatter);
  v_squat_upload := public.issue_4382_register_support_attachment(
    v_ticket_squat, 'image', 'image/png', 4000, 10, 10, NULL, false);
  PERFORM pg_temp.t4382x_as(v_explorer);
  -- The real owner creating that id cannot be handed the squatter's file.
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_create_customer_ticket(
      v_ticket_squat, 'explorer', 'other', NULL, 'Mine',
      ARRAY[(v_squat_upload->>'attachment_id')::uuid], '{}'::jsonb, NULL, 'person');
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'owner_attached_squatter_file'; END IF;
  PERFORM public.issue_4382_create_customer_ticket(
    v_ticket_squat, 'explorer', 'other', NULL, 'Mine', ARRAY[]::uuid[], '{}'::jsonb, NULL, 'person');
  IF EXISTS (SELECT 1 FROM public.support_attachments WHERE id = (v_squat_upload->>'attachment_id')::uuid) THEN
    RAISE EXCEPTION 'owner_sees_squatter_draft';
  END IF;
  PERFORM pg_temp.t4382x_as(v_squatter);
  IF EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_ticket_squat) THEN
    RAISE EXCEPTION 'squatter_sees_ticket';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_create_customer_ticket(
      v_ticket_squat, 'explorer', 'other', NULL, 'Take over', ARRAY[]::uuid[], '{}'::jsonb, NULL, 'person');
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'squatter_took_over_request_id'; END IF;
  RESET ROLE;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_post_support_message(
      v_ticket_squat, v_squatter, false, 'hi', ARRAY[(v_squat_upload->>'attachment_id')::uuid],
      false, NULL, NULL, NULL, false, 'reply');
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'squatter_posted_into_ticket'; END IF;
  IF (SELECT draft_ticket_id FROM public.support_attachments WHERE id = (v_squat_upload->>'attachment_id')::uuid)
     IS DISTINCT FROM v_ticket_squat THEN
    RAISE EXCEPTION 'squatter_draft_joined_ticket';
  END IF;

  -- ── An internal ticket that names a host stays invisible to that host ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382x_as(v_staff);
  PERFORM public.issue_4382_create_staff_ticket(
    v_ticket_internal, 'internal', 'Owner B looks like a fraud risk', 'Chargebacks from three cards',
    v_owner_b, v_brand_b, NULL, 'high', NULL, NULL, NULL, NULL, NULL, ARRAY[]::uuid[]);
  PERFORM pg_temp.t4382x_as(v_owner_b);
  IF EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_ticket_internal)
     OR EXISTS (SELECT 1 FROM public.conversations WHERE id = (SELECT conversation_id FROM public.support_tickets WHERE id = v_ticket_internal))
     OR public.issue_4382_ticket_product_stage(v_ticket_internal) IS NOT NULL
     OR public.issue_4382_customer_can_view_ticket(v_ticket_internal, v_owner_b) THEN
    RAISE EXCEPTION 'host_sees_internal_ticket_naming_them';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_register_support_attachment(
      v_ticket_internal, 'image', 'image/png', 4000, 10, 10, NULL, false);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'host_uploaded_to_internal_ticket'; END IF;
  RESET ROLE;
  -- The staff send path forces every message on an internal ticket internal.
  v_result := public.issue_4382_post_support_message(
    v_ticket_internal, v_staff, true, 'Calling the bank', ARRAY[]::uuid[], false, NULL, NULL, 'Tess', false, 'reply');
  IF (v_result->>'is_internal')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'internal_ticket_took_a_public_message';
  END IF;

  -- ── Privileged doors, wrong people ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382x_as(v_owner_b);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_create_staff_ticket(
      '4382f000-0000-4000-8000-000000000197', 'internal', 'x', 'y',
      NULL, NULL, NULL, 'normal', NULL, NULL, NULL, NULL, NULL, ARRAY[]::uuid[]);
  EXCEPTION WHEN insufficient_privilege OR sqlstate 'P0001' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'customer_created_staff_ticket'; END IF;
  IF EXISTS (SELECT 1 FROM public.support_product_signals)
     OR EXISTS (SELECT 1 FROM public.product_customer_update_drafts) THEN
    RAISE EXCEPTION 'customer_reads_product_items';
  END IF;
  -- Plain Support staff (no admin seat) can neither tell reporters nor close as won't do.
  PERFORM pg_temp.t4382x_as(v_helper);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_tell_reporters(gen_random_uuid(), gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'plain_staff_told_reporters'; END IF;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_set_wont_do(gen_random_uuid(), 1, 'Not doing it');
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'plain_staff_set_wont_do'; END IF;
  v_raised := false;
  BEGIN
    UPDATE public.support_product_signals SET state = 'told';
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'plain_staff_updated_signals_directly'; END IF;
  v_raised := false;
  BEGIN
    UPDATE public.support_attachments SET is_internal = false;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'attachment_rows_writable'; END IF;
  RESET ROLE;
END;
$adversarial$;

-- ── Signed-out callers reach no #4382 door ──
DO $anon$
DECLARE
  v_door text;
  v_raised boolean;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM pg_temp.t4382x_as(NULL);
  FOREACH v_door IN ARRAY ARRAY[
    'SELECT public.issue_4382_register_support_attachment(gen_random_uuid(), ''image'', ''image/png'', 10)',
    'SELECT public.issue_4382_create_customer_ticket(gen_random_uuid(), ''explorer'', ''other'', NULL, ''x'')',
    'SELECT public.issue_4382_ticket_product_stage(gen_random_uuid())',
    'SELECT public.issue_4382_tell_reporters(gen_random_uuid(), gen_random_uuid())',
    'SELECT public.is_product_operator(gen_random_uuid())',
    'SELECT count(*) FROM public.support_attachments'
  ] LOOP
    v_raised := false;
    BEGIN
      EXECUTE v_door;
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    IF NOT v_raised THEN RAISE EXCEPTION 'anon_reached: %', v_door; END IF;
  END LOOP;
  RESET ROLE;
END;
$anon$;

ROLLBACK;
