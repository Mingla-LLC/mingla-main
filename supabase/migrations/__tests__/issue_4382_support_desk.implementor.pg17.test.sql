-- #4382 Support Desk redesign, Wave 1: executable contract.
-- Runs after migration replay against a disposable PostgreSQL 17 database.
-- MINGLA-INVARIANT: I-4382-SUPPORT-INTERNAL-NEVER-CUSTOMER | issue #4382 | A host, a brand member or an Explorer user never reads an internal note, an internal attachment or an internal ticket, through any table or storage policy.
-- MINGLA-INVARIANT: I-4382-SUPPORT-FILES-SIGNED-IN | issue #4382 | No support-attachments object can be read or written without signing in, and a customer writes only to a ticket they can see.
-- MINGLA-INVARIANT: I-4382-SUPPORT-REPLY-REOPENS | issue #4382 | A customer reply on a Waiting or Resolved ticket sets it back to Open; a closed ticket refuses replies with PT409.
-- MINGLA-INVARIANT: I-4382-PRODUCT-MOVES-CHECKED | issue #4382 | Product items move only new->triaged->planned->shipped->told (planned may go back to triaged, anything but told may become wont_do with a reason); planned needs a GitHub link, shipped a verified release, and a refused move raises PT409.
-- MINGLA-INVARIANT: I-4382-TOLD-ONCE | issue #4382 | Telling reporters runs once per Product item and posts exactly one message into each linked customer-visible ticket.
-- MINGLA-INVARIANT: I-4382-PRODUCT-STAGE-CUSTOMER-SAFE | issue #4382 | A ticket's Product stage reaches only its requester, a brand member on a brand-visible ticket, or Support staff, and carries only {stage, board_status_label}.
-- MINGLA-INVARIANT: I-4382-SUPPORT-MESSAGES-SERVER-PATH-ONLY | issue #4382 | No anon or signed-in browser inserts a message into a support conversation; support messages are written only by issue_4382_post_support_message and the other SECURITY DEFINER support functions or the service role.
-- MINGLA-INVARIANT: I-4382-SUPPORT-ATTACH-ONLY-UPLOADED | issue #4382 | A support attachment joins a message only when its object exists in support-attachments at its storage_path; otherwise the send is refused with PT409 attachment_not_uploaded.
-- MINGLA-INVARIANT: I-4382-LEGACY-CREATE-OWN-BRAND-ONLY | issue #4382 | The pre-#4382 create_support_ticket(text, uuid) files a ticket against a brand only when the caller is an active member or the owning account; any other brand id is dropped.
-- MINGLA-INVARIANT: I-4382-CUSTOMER-DRAFT-NO-GITHUB-TITLE | issue #4382 | Default customer update drafts use generic wording and never quote the GitHub issue title.
-- MINGLA-INVARIANT: I-4382-SUPPORT-NO-LOCATION | issue #4382 | A support ticket's client details hold app and device facts only; a location key is refused.
BEGIN;

CREATE FUNCTION pg_temp.t4382_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END;
$$;

DO $test$
DECLARE
  v_staff constant uuid := '43820000-0000-4000-8000-0000000000a1';
  v_host constant uuid := '43820000-0000-4000-8000-0000000000b1';
  v_mate constant uuid := '43820000-0000-4000-8000-0000000000b2';
  v_explorer constant uuid := '43820000-0000-4000-8000-0000000000c1';
  v_stranger constant uuid := '43820000-0000-4000-8000-0000000000d1';
  v_brand constant uuid := '43820000-0000-4000-8000-0000000000e1';
  v_host_ticket constant uuid := '43820000-0000-4000-8000-000000000101';
  v_explorer_ticket constant uuid := '43820000-0000-4000-8000-000000000102';
  v_internal_ticket constant uuid := '43820000-0000-4000-8000-000000000103';
  v_brand_ticket constant uuid := '43820000-0000-4000-8000-000000000104';
  v_upload jsonb;
  v_upload_two jsonb;
  v_internal_upload jsonb;
  v_result jsonb;
  v_count integer;
  v_raised boolean;
  v_note uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_staff, 'staff-4382@example.test'),
    (v_host, 'host-4382@example.test'),
    (v_mate, 'mate-4382@example.test'),
    (v_explorer, 'explorer-4382@example.test'),
    (v_stranger, 'stranger-4382@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('staff-4382@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.support_staff(user_id, enabled, available, display_name)
  VALUES (v_staff, true, true, 'Ada from Support')
  ON CONFLICT (user_id) DO UPDATE SET enabled = true;
  INSERT INTO public.creator_accounts(id, email, display_name, business_name)
  VALUES (v_host, 'host-4382@example.test', 'Host 4382', 'Brand 4382');
  INSERT INTO public.brands(id, name, slug, account_id)
  VALUES (v_brand, 'Brand 4382', 'brand-4382', v_host);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (v_brand, v_host, 'brand_owner', now()), (v_brand, v_mate, 'brand_admin', now())
  ON CONFLICT DO NOTHING;

  -- ── Explorer creates a request with a voice note and a screenshot ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_explorer);
  v_upload := public.issue_4382_register_support_attachment(
    v_explorer_ticket, 'image', 'image/jpeg', 120000, 1170, 2532, NULL, false);
  v_upload_two := public.issue_4382_register_support_attachment(
    v_explorer_ticket, 'audio', 'audio/mp4', 300000, NULL, NULL, 24000, false);
  IF (v_upload->>'draft')::boolean IS NOT TRUE
     OR v_upload->>'storage_path' !~ ('^' || v_explorer_ticket::text || '/') THEN
    RAISE EXCEPTION 'draft_upload_shape:%', v_upload;
  END IF;

  -- Storage accepts the registered path from the uploader only.
  INSERT INTO storage.objects(bucket_id, name, owner)
  VALUES ('support-attachments', v_upload->>'storage_path', v_explorer);
  v_raised := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner)
    VALUES ('support-attachments', v_explorer_ticket::text || '/' || gen_random_uuid()::text || '.jpg', v_explorer);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'unregistered_object_written'; END IF;

  -- A registered file that was never uploaded does not attach (PT409), and
  -- the refused send leaves it unattached.
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_create_customer_ticket(
      v_explorer_ticket, 'explorer', 'broken', NULL, 'The map will not load after I book',
      ARRAY[(v_upload->>'attachment_id')::uuid, (v_upload_two->>'attachment_id')::uuid],
      '{}'::jsonb, NULL, 'person');
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := SQLERRM = 'attachment_not_uploaded';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'attached_a_file_that_was_never_uploaded'; END IF;
  IF EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_explorer_ticket)
     OR EXISTS (SELECT 1 FROM public.support_attachments
                WHERE id = (v_upload_two->>'attachment_id')::uuid AND message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'refused_send_left_a_ticket_or_attachment';
  END IF;
  -- Now the voice note is uploaded too.
  INSERT INTO storage.objects(bucket_id, name, owner)
  VALUES ('support-attachments', v_upload_two->>'storage_path', v_explorer);

  -- A location in client details is refused.
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_create_customer_ticket(
      '43820000-0000-4000-8000-000000000199', 'explorer', 'broken', NULL,
      'The map will not load', ARRAY[]::uuid[],
      '{"app_version":"1.2.0","latitude":"6.5"}'::jsonb, NULL, 'person');
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'location_in_client_meta_accepted'; END IF;

  PERFORM public.issue_4382_create_customer_ticket(
    v_explorer_ticket, 'explorer', 'broken', NULL,
    'The map will not load after I book',
    ARRAY[(v_upload->>'attachment_id')::uuid, (v_upload_two->>'attachment_id')::uuid],
    '{"app_version":"1.2.0","os":"ios","os_version":"18.1","device_model":"iPhone 15","source_screen":"Map"}'::jsonb,
    NULL, 'person');
  -- Replay returns the same ticket.
  IF public.issue_4382_create_customer_ticket(
       v_explorer_ticket, 'explorer', 'broken', NULL, 'again', ARRAY[]::uuid[], '{}'::jsonb, NULL, 'person')
     <> v_explorer_ticket THEN
    RAISE EXCEPTION 'customer_create_not_idempotent';
  END IF;
  IF (SELECT count(*) FROM public.support_attachments
      WHERE ticket_id = v_explorer_ticket AND message_id IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'create_did_not_attach_files';
  END IF;

  -- ── Host creates a brand-visible request ──
  PERFORM pg_temp.t4382_as(v_host);
  PERFORM public.issue_4382_create_customer_ticket(
    v_host_ticket, 'host', 'payouts', 'Payout shows zero', 'My balance shows 0 after settlement',
    ARRAY[]::uuid[], '{"app_version":"1.2.0"}'::jsonb, v_brand, 'brand');
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_register_support_attachment(
      v_host_ticket, 'audio', 'audio/mp4', 1000, NULL, NULL, 1000, false);
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'host_voice_note_accepted'; END IF;

  -- ── Staff: an internal ticket, a person ticket, notes ──
  PERFORM pg_temp.t4382_as(v_staff);
  v_internal_upload := public.issue_4382_register_support_attachment(
    v_internal_ticket, 'image', 'image/png', 5000, 100, 100, NULL, true);
  INSERT INTO storage.objects(bucket_id, name, owner)
  VALUES ('support-attachments', v_internal_upload->>'storage_path', v_staff);
  PERFORM public.issue_4382_create_staff_ticket(
    v_internal_ticket, 'internal', 'Check Gogi menu photos', 'Photos look stretched on Android',
    v_host, v_brand, NULL, 'normal', 'Host app / Menu', NULL, NULL, NULL, NULL,
    ARRAY[(v_internal_upload->>'attachment_id')::uuid]);
  PERFORM public.issue_4382_create_staff_ticket(
    v_brand_ticket, 'brand', 'Walk the team through payouts', 'Booked a call with the owner',
    NULL, v_brand, NULL, 'normal', NULL, NULL, now() + interval '2 days', 'We will call on Friday',
    'Hi team, we will walk you through payouts setup on Friday.', ARRAY[]::uuid[]);
  IF (SELECT requester_user_id FROM public.support_tickets WHERE id = v_brand_ticket) IS NOT NULL
     OR (SELECT created_by FROM public.support_tickets WHERE id = v_brand_ticket) <> v_staff THEN
    RAISE EXCEPTION 'staff_ticket_named_staff_as_requester';
  END IF;
  RESET ROLE;

  -- An internal note on the host ticket (service-role send path).
  v_result := public.issue_4382_post_support_message(
    v_host_ticket, v_staff, true, 'Checked the ledger: settlement is delayed, not lost.',
    ARRAY[]::uuid[], true);
  v_note := (v_result->>'message_id')::uuid;
  IF (v_result->>'is_internal')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'note_not_internal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox
             WHERE payload->>'message_id' = v_note::text) THEN
    RAISE EXCEPTION 'internal_note_notified_someone';
  END IF;

  -- ── Visibility: what each person sees ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_host);
  SELECT count(*) INTO v_count FROM public.support_tickets;
  IF v_count <> 2 THEN RAISE EXCEPTION 'host_sees_%_tickets_expected_2', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_internal_ticket) THEN
    RAISE EXCEPTION 'host_sees_internal_ticket_about_them';
  END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE is_internal) THEN
    RAISE EXCEPTION 'host_reads_internal_note';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id WHERE t.id = v_host_ticket) THEN
    RAISE EXCEPTION 'host_cannot_read_own_thread';
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_attachments WHERE is_internal) THEN
    RAISE EXCEPTION 'host_reads_internal_attachment_row';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'support-attachments') THEN
    RAISE EXCEPTION 'host_reads_explorer_object';
  END IF;

  PERFORM pg_temp.t4382_as(v_mate);
  SELECT count(*) INTO v_count FROM public.support_tickets;
  IF v_count <> 2 THEN RAISE EXCEPTION 'brand_member_sees_%_expected_2', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE is_internal) THEN
    RAISE EXCEPTION 'brand_member_reads_internal_note';
  END IF;

  PERFORM pg_temp.t4382_as(v_explorer);
  SELECT count(*) INTO v_count FROM public.support_tickets;
  IF v_count <> 1 THEN RAISE EXCEPTION 'explorer_sees_%_expected_1', v_count; END IF;
  -- The screenshot and the voice note.
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'support-attachments') <> 2 THEN
    RAISE EXCEPTION 'explorer_cannot_read_own_file';
  END IF;

  PERFORM pg_temp.t4382_as(v_stranger);
  IF EXISTS (SELECT 1 FROM public.support_tickets)
     OR EXISTS (SELECT 1 FROM public.support_attachments)
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'support-attachments') THEN
    RAISE EXCEPTION 'stranger_reads_support_rows';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_register_support_attachment(
      v_host_ticket, 'image', 'image/png', 100, NULL, NULL, NULL, false);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'stranger_registered_upload_on_other_ticket'; END IF;

  PERFORM pg_temp.t4382_as(v_staff);
  -- Scoped to this suite's own rows: a database with other tickets passes too.
  IF (SELECT count(*) FROM public.support_tickets
      WHERE id IN (v_host_ticket, v_explorer_ticket, v_internal_ticket, v_brand_ticket)) <> 4
     OR NOT EXISTS (SELECT 1 FROM public.messages WHERE is_internal)
     OR NOT EXISTS (SELECT 1 FROM public.support_attachments WHERE is_internal) THEN
    RAISE EXCEPTION 'staff_cannot_read_everything';
  END IF;
  RESET ROLE;

  -- Anonymous: nothing in the store.
  SET LOCAL ROLE anon;
  PERFORM pg_temp.t4382_as(NULL);
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'support-attachments') THEN
    RAISE EXCEPTION 'anon_reads_support_object';
  END IF;
  v_raised := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name) VALUES ('support-attachments', v_upload->>'storage_path');
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'anon_wrote_support_object'; END IF;
  RESET ROLE;

  -- ── Status rules ──
  UPDATE public.support_tickets SET status = 'pending' WHERE id = v_host_ticket;
  v_result := public.issue_4382_post_support_message(
    v_host_ticket, v_mate, false, 'Any news?', ARRAY[]::uuid[], false);
  IF v_result->>'status' <> 'open' OR (v_result->>'reopened')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'reply_on_waiting_did_not_reopen:%', v_result;
  END IF;
  UPDATE public.support_tickets SET status = 'resolved', resolved_at = now() WHERE id = v_explorer_ticket;
  v_result := public.issue_4382_post_support_message(
    v_explorer_ticket, v_explorer, false, 'It happened again', ARRAY[]::uuid[], false);
  IF v_result->>'status' <> 'open'
     OR (SELECT resolved_at FROM public.support_tickets WHERE id = v_explorer_ticket) IS NOT NULL THEN
    RAISE EXCEPTION 'reply_on_resolved_did_not_reopen:%', v_result;
  END IF;
  UPDATE public.support_tickets SET status = 'closed' WHERE id = v_explorer_ticket;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_post_support_message(
      v_explorer_ticket, v_explorer, false, 'Hello?', ARRAY[]::uuid[], false);
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'closed_ticket_accepted_reply'; END IF;

  -- "Send and wait": staff reply with no promise is fine; waiting needs one.
  SELECT count(*) INTO v_count FROM public.notification_outbox
   WHERE category_key = 'business.support_status_changed'
     AND payload->>'ticket_id' = v_host_ticket::text;
  v_result := public.issue_4382_post_support_message(
    v_host_ticket, v_staff, true, 'We are on it.', ARRAY[]::uuid[], false);
  IF v_result->>'status' <> 'open' THEN RAISE EXCEPTION 'plain_staff_reply_changed_status'; END IF;
  v_result := public.issue_4382_post_support_message(
    v_host_ticket, v_staff, true, 'Settlement lands Friday.', ARRAY[]::uuid[], false,
    now() + interval '3 days', 'We will confirm the payout landed');
  IF v_result->>'status' <> 'pending'
     OR (SELECT next_update_at FROM public.support_tickets WHERE id = v_host_ticket) IS NULL THEN
    RAISE EXCEPTION 'send_and_wait_did_not_wait:%', v_result;
  END IF;
  -- The reply above is quiet on status: no status push rode along.
  IF (SELECT count(*) FROM public.notification_outbox
      WHERE category_key = 'business.support_status_changed'
        AND payload->>'ticket_id' = v_host_ticket::text) <> v_count THEN
    RAISE EXCEPTION 'reply_also_sent_status_push';
  END IF;
  -- A staff status change does reach every brand member, once each.
  UPDATE public.support_tickets SET status = 'resolved' WHERE id = v_host_ticket;
  IF (SELECT count(*) FROM public.notification_outbox
      WHERE category_key = 'business.support_status_changed'
        AND payload->>'ticket_id' = v_host_ticket::text
        AND payload->>'status' = 'resolved') <> 2 THEN
    RAISE EXCEPTION 'brand_status_push_not_two_members';
  END IF;
  -- Explorer staff reply goes to the Explorer app category.
  UPDATE public.support_tickets SET status = 'open' WHERE id = v_explorer_ticket;
  PERFORM public.issue_4382_post_support_message(
    v_explorer_ticket, v_staff, true, 'Thanks, fixed in 1.2.1', ARRAY[]::uuid[], false);
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox
                 WHERE category_key = 'explorer.support_reply' AND user_id = v_explorer
                   AND payload->>'deep_link' = 'mingla://support/' || v_explorer_ticket::text) THEN
    RAISE EXCEPTION 'explorer_reply_push_missing';
  END IF;

  -- Every support message goes through the server path: a requester's (or a
  -- brand member's) direct insert into the support conversation is refused,
  -- open or closed.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_explorer);
  v_raised := false;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    SELECT conversation_id, v_explorer, 'Direct insert on an open ticket', 'text'
      FROM public.support_tickets WHERE id = v_explorer_ticket;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'requester_direct_insert_on_open_ticket'; END IF;
  PERFORM pg_temp.t4382_as(v_mate);
  v_raised := false;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    SELECT conversation_id, v_mate, 'Direct insert by a brand member', 'text'
      FROM public.support_tickets WHERE id = v_host_ticket;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'brand_member_direct_insert'; END IF;
  RESET ROLE;
  UPDATE public.support_tickets SET status = 'closed' WHERE id = v_explorer_ticket;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_explorer);
  v_raised := false;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    SELECT conversation_id, v_explorer, 'Direct insert on a closed ticket', 'text'
      FROM public.support_tickets WHERE id = v_explorer_ticket;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'requester_direct_insert_on_closed_ticket'; END IF;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.messages WHERE content LIKE 'Direct insert%') THEN
    RAISE EXCEPTION 'direct_support_insert_landed';
  END IF;
  UPDATE public.support_tickets SET status = 'open' WHERE id = v_explorer_ticket;

  -- At most 10 images on one message.
  v_raised := false;
  BEGIN
    INSERT INTO public.support_attachments(ticket_id, message_id, storage_path, kind, mime, bytes, uploaded_by)
    SELECT v_host_ticket, v_note, v_host_ticket::text || '/' || gen_random_uuid()::text || '.png',
           'image', 'image/png', 10, v_staff
    FROM generate_series(1, 11);
  EXCEPTION WHEN sqlstate '22023' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'eleven_images_on_one_message'; END IF;

  -- Grants: no browser path writes tickets or attachments directly; the send
  -- core is service-role only.
  IF has_table_privilege('authenticated', 'public.support_tickets', 'INSERT')
     OR has_table_privilege('authenticated', 'public.support_attachments', 'INSERT')
     OR has_function_privilege('authenticated',
          'public.issue_4382_post_support_message(uuid,uuid,boolean,text,uuid[],boolean,timestamptz,text,text,boolean,text)',
          'EXECUTE')
     OR has_function_privilege('anon',
          'public.issue_4382_register_support_attachment(uuid,text,text,integer,integer,integer,integer,boolean)',
          'EXECUTE') THEN
    RAISE EXCEPTION 'support_write_privilege_exposed';
  END IF;
  IF to_regclass('public.support_internal_threads') IS NOT NULL THEN
    RAISE EXCEPTION 'support_internal_threads_still_exists';
  END IF;
END;
$test$;

-- ── Product pipeline: checked moves, Told once, one message per reporter ──
DO $pipeline$
DECLARE
  v_op constant uuid := '43820000-0000-4000-8000-0000000000a2';
  v_helper constant uuid := '43820000-0000-4000-8000-0000000000a3';
  v_one constant uuid := '43820000-0000-4000-8000-0000000000c2';
  v_two constant uuid := '43820000-0000-4000-8000-0000000000c3';
  v_signal uuid;
  v_ticket_one constant uuid := '43820000-0000-4000-8000-000000000201';
  v_ticket_two constant uuid := '43820000-0000-4000-8000-000000000202';
  v_ticket_internal constant uuid := '43820000-0000-4000-8000-000000000203';
  v_item uuid;
  v_draft uuid;
  v_rev integer;
  v_raised boolean;
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_op, 'operator-4382@example.test'),
    (v_helper, 'helper-4382@example.test'),
    (v_one, 'reporter-one-4382@example.test'),
    (v_two, 'reporter-two-4382@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('operator-4382@example.test', 'partner', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  -- A Support teammate on the team but without an admin seat.
  INSERT INTO public.admin_team_members(email, role, status)
  VALUES ('helper-4382@example.test', 'growth', 'active');
  INSERT INTO public.support_staff(user_id, enabled, available)
  VALUES (v_helper, true, true), (v_op, true, true)
  ON CONFLICT (user_id) DO UPDATE SET enabled = true;

  IF NOT public.is_product_operator(v_op) OR public.is_product_operator(v_helper)
     OR NOT public.issue_4382_is_staff(v_helper) THEN
    RAISE EXCEPTION 'product_operator_rule_wrong';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_one);
  PERFORM public.issue_4382_create_customer_ticket(v_ticket_one, 'explorer', 'broken', NULL,
    'The map is blank', ARRAY[]::uuid[], '{}'::jsonb, NULL, 'person');
  PERFORM pg_temp.t4382_as(v_two);
  PERFORM public.issue_4382_create_customer_ticket(v_ticket_two, 'explorer', 'broken', NULL,
    'Map blank for me too', ARRAY[]::uuid[], '{}'::jsonb, NULL, 'person');

  -- Any Support staff member sends to Product and links.
  PERFORM pg_temp.t4382_as(v_helper);
  PERFORM public.issue_4382_create_staff_ticket(v_ticket_internal, 'internal', 'Map tiles fail',
    'Seen on our own test phone', NULL, NULL, NULL, 'normal', NULL, NULL, NULL, NULL, NULL, ARRAY[]::uuid[]);
  v_signal := public.issue_3720_create_product_signal(
    '43820000-0000-4000-8000-000000000301', 'support_ticket', v_ticket_one, 'bug',
    'Map is blank', 'Explorer map shows no tiles', 'Explorer / Map', 'Open the map',
    'Cannot find places', 1, 'high', now() + interval '2 days', 'Triage', 'We are looking at it.');
  v_rev := public.issue_3720_link_product_signal_source(v_signal, 1, 'support_ticket', v_ticket_two);
  v_rev := public.issue_3720_link_product_signal_source(v_signal, v_rev, 'support_ticket', v_ticket_internal);
  IF (SELECT state FROM public.support_product_signals WHERE id = v_signal) <> 'new' THEN
    RAISE EXCEPTION 'new_signal_not_new';
  END IF;

  -- Support staff without a seat cannot triage.
  v_raised := false;
  BEGIN
    PERFORM public.issue_3720_update_product_signal(v_signal, v_rev, 'triaged', 'high',
      now() + interval '2 days', 'Triage', 'We are looking at it.');
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'support_staff_triaged'; END IF;

  -- Skipping a stage is refused with PT409 (never 40001).
  RESET ROLE;
  v_raised := false;
  BEGIN
    UPDATE public.support_product_signals SET state = 'shipped' WHERE id = v_signal;
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'new_to_shipped_allowed'; END IF;
  v_raised := false;
  BEGIN
    UPDATE public.support_product_signals SET state = 'triaged' WHERE id = v_signal;
    UPDATE public.support_product_signals SET state = 'planned' WHERE id = v_signal;
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'planned_without_github_link'; END IF;
  v_raised := false;
  BEGIN
    UPDATE public.support_product_signals SET state = 'wont_do' WHERE id = v_signal;
  EXCEPTION WHEN sqlstate '22023' OR check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'wont_do_without_reason'; END IF;

  -- The operator triages; the GitHub link apply plans it.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_op);
  SELECT revision INTO v_rev FROM public.support_product_signals WHERE id = v_signal;
  v_rev := public.issue_3720_update_product_signal(v_signal, v_rev, 'triaged', 'high',
    now() + interval '2 days', 'Link to GitHub', 'We are looking at it.');
  RESET ROLE;
  INSERT INTO public.product_avengers_items(issue_number, issue_node_id, project_item_id,
    issue_url, issue_title, issue_state, board_status)
  VALUES (943821, 'I_4382_node', 'PVTI_4382', 'https://github.com/Mingla-LLC/mingla-main/issues/943821',
    'Explorer map tiles', 'OPEN', 'In Progress')
  RETURNING id INTO v_item;
  INSERT INTO public.product_signal_avengers_links(signal_id, item_id, link_kind, linked_by)
  VALUES (v_signal, v_item, 'existing', v_op);
  UPDATE public.support_product_signals SET state = 'planned' WHERE id = v_signal;
  -- planned may go back to triaged and forward again.
  UPDATE public.support_product_signals SET state = 'triaged' WHERE id = v_signal;
  UPDATE public.support_product_signals SET state = 'planned' WHERE id = v_signal;

  -- Told before shipped is refused; told by hand is refused.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_op);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_tell_reporters(v_signal, gen_random_uuid());
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'told_before_shipped'; END IF;

  -- Verified live: shipped, with a Live draft to approve.
  RESET ROLE;
  UPDATE public.product_avengers_items SET board_status = 'Done' WHERE id = v_item;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_op);
  PERFORM public.issue_3720_verify_product_release(v_signal,
    'https://github.com/Mingla-LLC/mingla-main/issues/943821#issuecomment-1');
  RESET ROLE;
  IF (SELECT state FROM public.support_product_signals WHERE id = v_signal) <> 'shipped' THEN
    RAISE EXCEPTION 'verified_release_did_not_ship';
  END IF;
  v_raised := false;
  BEGIN
    UPDATE public.support_product_signals SET state = 'told' WHERE id = v_signal;
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'told_set_by_hand'; END IF;

  SELECT id INTO v_draft FROM public.product_customer_update_drafts
   WHERE signal_id = v_signal AND customer_status = 'Live' ORDER BY created_at DESC LIMIT 1;
  -- The default "it's live" wording is generic and never quotes the GitHub
  -- issue title; no draft for this item quotes it either.
  IF (SELECT body FROM public.product_customer_update_drafts WHERE id = v_draft)
     IS DISTINCT FROM 'Good news: the problem you reported has been fixed and is now live. Thanks for telling us about it.'
     OR EXISTS (SELECT 1 FROM public.product_customer_update_drafts
                WHERE signal_id = v_signal AND body LIKE '%Explorer map tiles%') THEN
    RAISE EXCEPTION 'customer_draft_quotes_the_github_title';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_op);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_tell_reporters(v_signal, v_draft);
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'told_with_unapproved_wording'; END IF;
  PERFORM public.issue_3720_approve_product_customer_draft(v_draft,
    'The map is fixed and live now. Thank you for telling us.');

  v_result := public.issue_4382_tell_reporters(v_signal, v_draft);
  IF (v_result->>'tickets_told')::integer <> 2 THEN
    RAISE EXCEPTION 'told_ticket_count_%', v_result;
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.issue_4382_tell_reporters(v_signal, v_draft);
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := SQLERRM = 'already_told';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'told_ran_twice'; END IF;
  RESET ROLE;

  -- Each reporter: exactly one message, one push, ticket resolved. The
  -- internal ticket got nothing.
  IF (SELECT count(*) FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id
      WHERE t.id = v_ticket_one AND m.content LIKE 'The map is fixed%') <> 1
     OR (SELECT count(*) FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id
      WHERE t.id = v_ticket_two AND m.content LIKE 'The map is fixed%') <> 1
     OR (SELECT count(*) FROM public.messages m JOIN public.support_tickets t ON t.conversation_id = m.conversation_id
      WHERE t.id = v_ticket_internal AND m.content LIKE 'The map is fixed%') <> 0 THEN
    RAISE EXCEPTION 'told_messages_not_one_per_reporter';
  END IF;
  IF (SELECT count(*) FROM public.notification_outbox
      WHERE category_key = 'explorer.support_product_update' AND user_id IN (v_one, v_two)) <> 2
     OR EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE category_key IN ('explorer.support_status_changed', 'explorer.support_reply')
        AND payload->>'ticket_id' IN (v_ticket_one::text, v_ticket_two::text)) THEN
    RAISE EXCEPTION 'told_pushes_not_one_per_reporter';
  END IF;
  IF (SELECT count(*) FROM public.support_tickets WHERE id IN (v_ticket_one, v_ticket_two) AND status = 'resolved') <> 2
     OR (SELECT state FROM public.support_product_signals WHERE id = v_signal) <> 'told'
     OR (SELECT state FROM public.product_customer_update_drafts WHERE id = v_draft) <> 'sent' THEN
    RAISE EXCEPTION 'told_end_state_wrong';
  END IF;
  -- Told is final: not even wont_do.
  v_raised := false;
  BEGIN
    UPDATE public.support_product_signals SET state = 'wont_do', wont_do_reason = 'late' WHERE id = v_signal;
  EXCEPTION WHEN sqlstate 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'told_reopened'; END IF;

  -- #1529: these producers make a conscious country decision (push only, no SMS).
  IF EXISTS (SELECT 1 FROM public.notification_outbox
             WHERE category_key IN ('business.support_status_changed', 'business.support_product_update',
                                    'explorer.support_reply', 'explorer.support_status_changed',
                                    'explorer.support_product_update')
               AND country_code IS NOT NULL) THEN
    RAISE EXCEPTION 'customer_support_alert_carried_a_country';
  END IF;
END;
$pipeline$;

-- ── The move-across left a consistent world ──
DO $moved$
BEGIN
  IF EXISTS (SELECT 1 FROM public.support_product_signal_sources WHERE source_kind = 'internal_thread') THEN
    RAISE EXCEPTION 'source_still_points_at_a_staff_thread';
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_tickets
             WHERE imported_from = 'internal_thread' AND (origin <> 'staff' OR visibility <> 'internal'))
     OR EXISTS (SELECT 1 FROM public.support_tickets
             WHERE imported_from = 'beta_feedback'
               AND (origin <> 'customer' OR visibility <> 'person' OR requester_segment <> 'explorer'))
     OR EXISTS (SELECT 1 FROM public.issue_4382_beta_feedback_import import
             WHERE NOT EXISTS (SELECT 1 FROM public.support_attachments a
                               WHERE a.message_id = import.message_id AND a.kind = 'audio'))
     OR (SELECT count(*) FROM public.issue_4382_beta_feedback_import)
        <> (SELECT count(*) FROM public.beta_feedback) THEN
    RAISE EXCEPTION 'move_across_inconsistent';
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_product_signals
             WHERE state NOT IN ('new', 'triaged', 'planned', 'shipped', 'told', 'wont_do')) THEN
    RAISE EXCEPTION 'old_product_state_left';
  END IF;
  IF has_function_privilege('authenticated',
       'public.issue_4382_enqueue_customer_alert(uuid,text,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4382_tell_reporters(uuid,uuid)', 'EXECUTE')
     OR to_regprocedure('public.issue_3988_create_brand_support_ticket(uuid,text,text,uuid,text,timestamptz,text)') IS NOT NULL
     OR to_regprocedure('public.issue_3720_create_internal_thread(uuid,text,text,text,uuid,text,text,timestamptz,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'retired_or_private_function_exposed';
  END IF;
END;
$moved$;

-- ── The customer-safe Product stage of a ticket ──
DO $stage$
DECLARE
  v_partner constant uuid := '43820000-0000-4000-8000-0000000000a4';
  v_plain_staff constant uuid := '43820000-0000-4000-8000-0000000000a5';
  v_host constant uuid := '43820000-0000-4000-8000-0000000000b4';
  v_mate constant uuid := '43820000-0000-4000-8000-0000000000b5';
  v_stranger constant uuid := '43820000-0000-4000-8000-0000000000d4';
  v_brand constant uuid := '43820000-0000-4000-8000-0000000000e4';
  v_person_ticket constant uuid := '43820000-0000-4000-8000-000000000401';
  v_brand_ticket constant uuid := '43820000-0000-4000-8000-000000000402';
  v_lonely_ticket constant uuid := '43820000-0000-4000-8000-000000000403';
  v_signal uuid;
  v_item uuid;
  v_rev integer;
  v_stage jsonb;
  v_legacy uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_partner, 'partner-stage-4382@example.test'),
    (v_plain_staff, 'plain-staff-stage-4382@example.test'),
    (v_host, 'host-stage-4382@example.test'),
    (v_mate, 'mate-stage-4382@example.test'),
    (v_stranger, 'stranger-stage-4382@example.test');
  -- A founding partner holds an active partner seat; plain Support staff has
  -- a team seat but no admin seat.
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('partner-stage-4382@example.test', 'partner', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status)
  VALUES ('plain-staff-stage-4382@example.test', 'growth', 'active');
  INSERT INTO public.support_staff(user_id, enabled, available)
  VALUES (v_partner, true, true), (v_plain_staff, true, true)
  ON CONFLICT (user_id) DO UPDATE SET enabled = true;
  IF public.is_product_operator(v_partner) IS NOT TRUE THEN
    RAISE EXCEPTION 'active_partner_is_not_product_operator';
  END IF;
  IF public.is_product_operator(v_plain_staff) IS NOT FALSE
     OR public.issue_4382_is_staff(v_plain_staff) IS NOT TRUE THEN
    RAISE EXCEPTION 'plain_support_staff_is_product_operator';
  END IF;
  UPDATE public.admin_users SET status = 'revoked' WHERE email = 'partner-stage-4382@example.test';
  IF public.is_product_operator(v_partner) THEN
    RAISE EXCEPTION 'revoked_partner_is_product_operator';
  END IF;
  UPDATE public.admin_users SET status = 'active' WHERE email = 'partner-stage-4382@example.test';

  INSERT INTO public.creator_accounts(id, email, display_name, business_name)
  VALUES (v_host, 'host-stage-4382@example.test', 'Host stage 4382', 'Brand stage 4382');
  INSERT INTO public.brands(id, name, slug, account_id)
  VALUES (v_brand, 'Brand stage 4382', 'brand-stage-4382', v_host);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (v_brand, v_host, 'brand_owner', now()), (v_brand, v_mate, 'brand_admin', now())
  ON CONFLICT DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_host);
  PERFORM public.issue_4382_create_customer_ticket(v_person_ticket, 'host', 'payouts', 'Just me',
    'Only I should see this one', ARRAY[]::uuid[], '{}'::jsonb, v_brand, 'person');
  PERFORM public.issue_4382_create_customer_ticket(v_brand_ticket, 'host', 'payouts', 'Our team',
    'The whole team can see this one', ARRAY[]::uuid[], '{}'::jsonb, v_brand, 'brand');
  PERFORM public.issue_4382_create_customer_ticket(v_lonely_ticket, 'host', 'other', 'No Product item',
    'Nothing for Product here', ARRAY[]::uuid[], '{}'::jsonb, v_brand, 'person');

  -- The pre-#4382 create (installed Host builds) keeps only the caller's own
  -- brand: a stranger's brand id is dropped, a member's is kept.
  PERFORM pg_temp.t4382_as(v_stranger);
  v_legacy := public.create_support_ticket('Filed against a brand I am not in', v_brand);
  IF (SELECT brand_id FROM public.support_tickets WHERE id = v_legacy) IS NOT NULL THEN
    RAISE EXCEPTION 'legacy_create_kept_a_strangers_brand';
  END IF;
  PERFORM pg_temp.t4382_as(v_mate);
  v_legacy := public.create_support_ticket('Filed by a team member', v_brand);
  IF (SELECT brand_id FROM public.support_tickets WHERE id = v_legacy) IS DISTINCT FROM v_brand THEN
    RAISE EXCEPTION 'legacy_create_dropped_a_members_brand';
  END IF;
  PERFORM pg_temp.t4382_as(v_host);
  v_legacy := public.create_support_ticket('Filed by the owner', v_brand);
  IF (SELECT brand_id FROM public.support_tickets WHERE id = v_legacy) IS DISTINCT FROM v_brand THEN
    RAISE EXCEPTION 'legacy_create_dropped_the_owners_brand';
  END IF;

  -- Plain Support staff sends to Product and links the brand ticket.
  PERFORM pg_temp.t4382_as(v_plain_staff);
  v_signal := public.issue_3720_create_product_signal(
    '43820000-0000-4000-8000-000000000411', 'support_ticket', v_person_ticket, 'bug',
    'Payout zero', 'Balance shows zero after settlement', 'Host / Payouts', 'Open payouts',
    'Cannot see money', 1, 'high', now() + interval '2 days', 'Triage', 'Looking at it.');
  v_rev := public.issue_3720_link_product_signal_source(v_signal, 1, 'support_ticket', v_brand_ticket);

  -- new: the requester, staff, and a brand member on the BRAND ticket see it.
  PERFORM pg_temp.t4382_as(v_host);
  v_stage := public.issue_4382_ticket_product_stage(v_person_ticket);
  IF v_stage IS DISTINCT FROM '{"stage":"passed_to_product","board_status_label":null}'::jsonb THEN
    RAISE EXCEPTION 'requester_stage_new_%', v_stage;
  END IF;
  -- Nothing private: exactly two keys.
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_stage) k) <> ARRAY['board_status_label', 'stage'] THEN
    RAISE EXCEPTION 'stage_leaks_extra_keys_%', v_stage;
  END IF;
  IF public.issue_4382_ticket_product_stage(v_lonely_ticket) IS NOT NULL THEN
    RAISE EXCEPTION 'ticket_without_product_item_has_stage';
  END IF;
  PERFORM pg_temp.t4382_as(v_mate);
  IF public.issue_4382_ticket_product_stage(v_brand_ticket)->>'stage' IS DISTINCT FROM 'passed_to_product' THEN
    RAISE EXCEPTION 'brand_member_cannot_see_brand_ticket_stage';
  END IF;
  -- A brand member on a PERSON ticket gets nothing.
  IF public.issue_4382_ticket_product_stage(v_person_ticket) IS NOT NULL THEN
    RAISE EXCEPTION 'brand_member_saw_person_ticket_stage';
  END IF;
  -- A stranger gets nothing, and no error either.
  PERFORM pg_temp.t4382_as(v_stranger);
  IF public.issue_4382_ticket_product_stage(v_person_ticket) IS NOT NULL
     OR public.issue_4382_ticket_product_stage(v_brand_ticket) IS NOT NULL
     OR public.issue_4382_ticket_product_stage(gen_random_uuid()) IS NOT NULL THEN
    RAISE EXCEPTION 'stranger_saw_a_stage';
  END IF;
  PERFORM pg_temp.t4382_as(v_plain_staff);
  IF public.issue_4382_ticket_product_stage(v_person_ticket)->>'stage' IS DISTINCT FROM 'passed_to_product' THEN
    RAISE EXCEPTION 'staff_cannot_see_stage';
  END IF;

  -- triaged, then planned with the GitHub board moving.
  PERFORM pg_temp.t4382_as(v_partner);
  SELECT revision INTO v_rev FROM public.support_product_signals WHERE id = v_signal;
  v_rev := public.issue_3720_update_product_signal(v_signal, v_rev, 'triaged', 'high',
    now() + interval '2 days', 'Link to GitHub', 'Looking at it.');
  PERFORM pg_temp.t4382_as(v_host);
  IF public.issue_4382_ticket_product_stage(v_person_ticket)->>'stage' IS DISTINCT FROM 'passed_to_product' THEN
    RAISE EXCEPTION 'triaged_stage_wrong';
  END IF;
  RESET ROLE;
  INSERT INTO public.product_avengers_items(issue_number, issue_node_id, project_item_id,
    issue_url, issue_title, issue_state, board_status)
  VALUES (943822, 'I_4382_stage_node', 'PVTI_4382_stage',
    'https://github.com/Mingla-LLC/mingla-main/issues/943822', 'Payout zero', 'OPEN', 'Todo')
  RETURNING id INTO v_item;
  INSERT INTO public.product_signal_avengers_links(signal_id, item_id, link_kind, linked_by)
  VALUES (v_signal, v_item, 'existing', v_partner);
  UPDATE public.support_product_signals SET state = 'planned' WHERE id = v_signal;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_host);
  IF public.issue_4382_ticket_product_stage(v_person_ticket)
     IS DISTINCT FROM '{"stage":"passed_to_product","board_status_label":"Todo"}'::jsonb THEN
    RAISE EXCEPTION 'planned_todo_stage_wrong';
  END IF;
  RESET ROLE;
  UPDATE public.product_avengers_items SET board_status = 'In Progress' WHERE id = v_item;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_host);
  IF public.issue_4382_ticket_product_stage(v_person_ticket)
     IS DISTINCT FROM '{"stage":"being_built","board_status_label":"In Progress"}'::jsonb THEN
    RAISE EXCEPTION 'in_progress_stage_wrong';
  END IF;
  RESET ROLE;
  UPDATE public.product_avengers_items SET board_status = 'In Review' WHERE id = v_item;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_mate);
  IF public.issue_4382_ticket_product_stage(v_brand_ticket)->>'stage' IS DISTINCT FROM 'final_checks'
     OR public.issue_4382_ticket_product_stage(v_person_ticket) IS NOT NULL THEN
    RAISE EXCEPTION 'in_review_stage_wrong';
  END IF;

  -- shipped: the banner goes away (the Told message carries the news).
  RESET ROLE;
  UPDATE public.product_avengers_items SET board_status = 'Done' WHERE id = v_item;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4382_as(v_partner);
  PERFORM public.issue_3720_verify_product_release(v_signal,
    'https://github.com/Mingla-LLC/mingla-main/issues/943822#issuecomment-1');
  PERFORM pg_temp.t4382_as(v_host);
  IF public.issue_4382_ticket_product_stage(v_person_ticket) IS NOT NULL THEN
    RAISE EXCEPTION 'shipped_still_has_stage';
  END IF;
  RESET ROLE;

  IF has_function_privilege('anon', 'public.issue_4382_ticket_product_stage(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.issue_4382_ticket_product_stage(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'stage_function_grants_wrong';
  END IF;
END;
$stage$;

ROLLBACK;
