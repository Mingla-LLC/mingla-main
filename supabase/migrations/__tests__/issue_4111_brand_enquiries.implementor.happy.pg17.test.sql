-- #4111 Wave A — happy-path executable proof for Customer enquiries.
-- FAILS-ON-REVERT: dropping the scanner exclusion from
-- issue_4111_is_enquiry_team_member, or the open-report condition from
-- issue_4111_enquiry_row_readable, makes the scanner / staff RLS checks below
-- raise. Reverting the migrations removes every function this suite calls.
-- MINGLA-INVARIANT: I-4111-ENQUIRY-STAFF-BLIND | issue #4111 | Staff and admins read an enquiry only while an open report exists; scanner-only members never read one.
-- MINGLA-INVARIANT: I-4111-ENQUIRY-RPC-ONLY | issue #4111 | No client role writes enquiry rows or enquiry messages directly.
-- MINGLA-INVARIANT: I-4111-SUBSCRIBE-SMS-SHARES-BLAST-CAP | issue #4111 | Subscribe confirmation texts count against the same per-brand monthly SMS cap as host blasts, in both directions.
\set ON_ERROR_STOP on
BEGIN;

-- The CI auth stub has no email_confirmed_at; production auth.users does.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t4111_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t4111_people VALUES
  ('owner',   '41110000-0000-4000-b800-000000000001', 'enq-owner@test.local',   'Olu'),
  ('member',  '41110000-0000-4000-b800-000000000002', 'enq-member@test.local',  'Mina'),
  ('scanner', '41110000-0000-4000-b800-000000000003', 'enq-scanner@test.local', 'Sade'),
  ('staff',   '41110000-0000-4000-b800-000000000004', 'enq-staff@test.local',   'Stan'),
  ('admin',   '41110000-0000-4000-b800-000000000005', 'enq-admin@test.local',   'Ada'),
  ('guest',   '41110000-0000-4000-b800-000000000006', 'enq-guest@test.local',   'Gabi'),
  ('stranger','41110000-0000-4000-b800-000000000007', 'enq-stranger@test.local','Xavi'),
  ('other',   '41110000-0000-4000-b800-000000000008', 'enq-other@test.local',   'Obi'),
  ('webuser', '41110000-0000-4000-b800-000000000009', 'enq-web@test.local',     'Wale'),
  ('subacct', '41110000-0000-4000-b800-00000000000a', 'enq-sub-acct@test.local','Sola');

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT id, email, now(), jsonb_build_object('full_name', first_name) FROM t4111_people;

INSERT INTO public.profiles(id, email, first_name, last_name, display_name, username, account_type)
SELECT id, email, first_name, 'Test', first_name || ' Test', 'issue4111_' || who, 'business'
FROM t4111_people;

INSERT INTO public.creator_accounts(id, email, display_name, business_name)
SELECT id, email, first_name, 'Issue 4111 Host' FROM t4111_people WHERE who IN ('owner', 'other');

INSERT INTO public.support_staff(user_id, enabled, available, display_name, role)
SELECT id, true, true, first_name, 'staff' FROM t4111_people WHERE who = 'staff';
INSERT INTO public.admin_team_members(email, role, status, accepted_at)
SELECT email, 'growth', 'active', now() FROM t4111_people WHERE who = 'staff';
INSERT INTO public.admin_users(email, role, status, accepted_at)
SELECT email, 'admin', 'active', now() FROM t4111_people WHERE who = 'admin';

INSERT INTO public.brands(id, account_id, name, slug, contact_email, default_currency) VALUES
  ('41110000-0000-4000-b900-0000000000a1', '41110000-0000-4000-b800-000000000001', 'Lantern Room', 'issue-4111-lantern', 'hello-lantern@test.local', 'USD'),
  ('41110000-0000-4000-b900-0000000000b2', '41110000-0000-4000-b800-000000000008', 'Other House', 'issue-4111-other', NULL, 'USD');

-- Creating a brand seats its account owner as brand_owner; add the rest.
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
SELECT '41110000-0000-4000-b900-0000000000a1', id,
  CASE who WHEN 'member' THEN 'marketing_manager' ELSE 'scanner' END, now()
FROM t4111_people WHERE who IN ('member', 'scanner');
DO $seat$
BEGIN
  IF (SELECT count(*) FROM public.brand_team_members
      WHERE user_id IN ('41110000-0000-4000-b800-000000000001', '41110000-0000-4000-b800-000000000008')
        AND role = 'brand_owner' AND accepted_at IS NOT NULL AND removed_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'owner_seats_missing';
  END IF;
END;
$seat$;

INSERT INTO public.events(id, brand_id, title, slug, status, event_type) VALUES
  ('41110000-0000-4000-be00-0000000000e1', '41110000-0000-4000-b900-0000000000a1', 'Lantern Night', 'issue-4111-lantern-night', 'scheduled', 'event'),
  ('41110000-0000-4000-be00-0000000000e2', '41110000-0000-4000-b900-0000000000b2', 'Other Night', 'issue-4111-other-night', 'scheduled', 'event');
INSERT INTO public.event_dates(event_id, start_at, end_at, is_master) VALUES
  ('41110000-0000-4000-be00-0000000000e1', now() + interval '3 days', now() + interval '3 days 4 hours', true),
  ('41110000-0000-4000-be00-0000000000e2', now() + interval '4 days', now() + interval '4 days 4 hours', true);
INSERT INTO public.orders(id, event_id, buyer_user_id, payment_status, source) VALUES
  ('41110000-0000-4000-bf00-0000000000c1', '41110000-0000-4000-be00-0000000000e1', '41110000-0000-4000-b800-000000000006', 'paid', 'manual_import'),
  ('41110000-0000-4000-bf00-0000000000c2', '41110000-0000-4000-be00-0000000000e2', '41110000-0000-4000-b800-000000000006', 'paid', 'manual_import');

DO $proof$
DECLARE
  v_brand constant uuid := '41110000-0000-4000-b900-0000000000a1';
  v_other_brand constant uuid := '41110000-0000-4000-b900-0000000000b2';
  v_owner constant uuid := '41110000-0000-4000-b800-000000000001';
  v_member constant uuid := '41110000-0000-4000-b800-000000000002';
  v_scanner constant uuid := '41110000-0000-4000-b800-000000000003';
  v_staff constant uuid := '41110000-0000-4000-b800-000000000004';
  v_admin constant uuid := '41110000-0000-4000-b800-000000000005';
  v_guest constant uuid := '41110000-0000-4000-b800-000000000006';
  v_stranger constant uuid := '41110000-0000-4000-b800-000000000007';
  v_other constant uuid := '41110000-0000-4000-b800-000000000008';
  v_webuser constant uuid := '41110000-0000-4000-b800-000000000009';
  v_subacct constant uuid := '41110000-0000-4000-b800-00000000000a';
  v_order constant uuid := '41110000-0000-4000-bf00-0000000000c1';
  v_other_order constant uuid := '41110000-0000-4000-bf00-0000000000c2';
  v_sent jsonb;
  v_enquiry uuid;
  v_conversation uuid;
  v_group uuid;
  v_message uuid;
  v_first_message uuid;
  v_count bigint;
  v_text text;
  v_err text;
  v_json jsonb;
  v_web jsonb;
  v_web_enquiry uuid;
  v_token constant text := encode(sha256('issue-4111-token-one'::bytea), 'hex');
  v_token_old constant text := encode(sha256('issue-4111-token-old'::bytea), 'hex');
  v_who text;
  v_user uuid;
BEGIN
  -- ── Explorer guest sends about their own order ──────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);

  SELECT count(*) INTO v_count FROM public.brand_enquiry_my_plans(v_brand) p
  WHERE p.kind = 'order' AND p.id = v_order AND p.is_upcoming;
  IF v_count <> 1 THEN RAISE EXCEPTION 'my_plans_missing_own_order:%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.brand_enquiry_my_plans(v_brand) p WHERE p.id = v_other_order;
  IF v_count <> 0 THEN RAISE EXCEPTION 'my_plans_leaked_other_brand_order'; END IF;

  v_sent := public.brand_enquiry_send(v_brand, 'brand_page', 'order', v_order, 'refund_cancel',
    'Hi, can I get a refund for my two tickets please?');
  v_enquiry := (v_sent->>'enquiry_id')::uuid;
  v_conversation := (v_sent->>'conversation_id')::uuid;
  IF v_enquiry IS NULL OR v_conversation IS NULL OR v_sent->>'topic_label' <> 'Refund or cancel' THEN
    RAISE EXCEPTION 'send_result_wrong:%', v_sent;
  END IF;

  -- Cross-brand context attach is rejected.
  v_err := NULL;
  BEGIN
    PERFORM public.brand_enquiry_send(v_brand, 'brand_page', 'order', v_other_order, 'refund_cancel',
      'This order belongs to a different brand.');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'invalid_context' THEN RAISE EXCEPTION 'cross_brand_context_not_rejected:%', v_err; END IF;
  RESET ROLE;

  -- ── Fan-out: eligible team only, one Brand-group card, no group push ──
  IF EXISTS (
    (SELECT unnest(ARRAY[v_owner, v_member])
     EXCEPT SELECT user_id FROM public.notification_outbox
       WHERE category_key = 'business.brand_enquiry_new' AND payload->>'enquiry_id' = v_enquiry::text)
    UNION ALL
    (SELECT user_id FROM public.notification_outbox
       WHERE category_key = 'business.brand_enquiry_new' AND payload->>'enquiry_id' = v_enquiry::text
     EXCEPT SELECT unnest(ARRAY[v_owner, v_member]))
  ) THEN RAISE EXCEPTION 'new_enquiry_recipient_set_wrong'; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.brand_enquiry_new' AND payload->>'enquiry_id' = v_enquiry::text
      AND payload->>'deep_link' <> 'mingla-business://messages/' || v_conversation::text) THEN
    RAISE EXCEPTION 'new_enquiry_deep_link_wrong';
  END IF;

  SELECT id INTO STRICT v_group FROM public.conversations
  WHERE linked_entity_type = 'brand' AND brand_id = v_brand;
  SELECT count(*) INTO v_count FROM public.messages
  WHERE conversation_id = v_group AND message_type = 'brand_enquiry_card'
    AND sender_kind = 'system' AND card_payload->>'enquiry_id' = v_enquiry::text
    -- Wave C (20271223004111): the card never names the guest.
    AND NOT (card_payload ? 'guest_name') AND content = 'New customer enquiry · Refund or cancel';
  IF v_count <> 1 THEN RAISE EXCEPTION 'brand_group_card_count_wrong:%', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox o
    JOIN public.messages m ON m.id::text = o.payload->>'message_id'
    WHERE o.category_key = 'business.brand_group_message' AND m.message_type = 'brand_enquiry_card') THEN
    RAISE EXCEPTION 'brand_group_card_fired_group_push';
  END IF;

  -- ── RLS: who can read the enquiry, its conversation and its messages ──
  FOR v_who, v_user IN
    SELECT * FROM (VALUES ('owner', v_owner), ('member', v_member), ('guest', v_guest),
      ('scanner', v_scanner), ('staff', v_staff), ('admin', v_admin),
      ('stranger', v_stranger), ('other', v_other)) AS t(who, uid)
  LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SELECT (SELECT count(*) FROM public.brand_enquiries WHERE id = v_enquiry)
         + (SELECT count(*) FROM public.conversations WHERE id = v_conversation)
         + (SELECT count(*) FROM public.messages WHERE conversation_id = v_conversation)
    INTO v_count;
    RESET ROLE;
    IF v_who IN ('owner', 'member', 'guest') AND v_count <> 3 THEN
      RAISE EXCEPTION 'reader_cannot_read:%:%', v_who, v_count;
    ELSIF v_who NOT IN ('owner', 'member', 'guest') AND v_count <> 0 THEN
      RAISE EXCEPTION 'non_reader_can_read:%:%', v_who, v_count;
    END IF;
  END LOOP;

  -- Scanner and staff are refused by the team RPCs too.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  v_err := NULL;
  BEGIN PERFORM public.list_brand_enquiries(v_brand, NULL); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'forbidden' THEN RAISE EXCEPTION 'scanner_list_not_refused:%', v_err; END IF;
  IF jsonb_array_length(public.list_brand_enquiries(NULL, 'all')->'items') <> 0 THEN
    RAISE EXCEPTION 'scanner_all_brands_list_not_empty';
  END IF;
  v_err := NULL;
  BEGIN PERFORM public.brand_enquiry_get_thread(v_enquiry, 50); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'enquiry_unavailable' THEN RAISE EXCEPTION 'scanner_thread_not_refused:%', v_err; END IF;
  v_err := NULL;
  BEGIN PERFORM public.brand_enquiry_reply(v_enquiry, 'Scanner reply'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'enquiry_unavailable' THEN RAISE EXCEPTION 'scanner_reply_not_refused:%', v_err; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  v_err := NULL;
  BEGIN PERFORM public.brand_enquiry_get_thread(v_enquiry, 50); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'enquiry_unavailable' THEN RAISE EXCEPTION 'staff_thread_not_refused:%', v_err; END IF;
  IF jsonb_array_length(public.admin_list_reported_enquiries(100)) <> 0 THEN
    RAISE EXCEPTION 'staff_sees_unreported_enquiry';
  END IF;

  -- No direct client writes: a participant guest and a team member both fail.
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  v_err := NULL;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_conversation, v_guest, 'direct write');
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  IF v_err IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'guest_direct_message_insert_allowed:%', v_err; END IF;
  UPDATE public.messages SET content = 'edited directly' WHERE conversation_id = v_conversation AND sender_id = v_guest;
  DELETE FROM public.messages WHERE conversation_id = v_conversation AND sender_id = v_guest;
  v_err := NULL;
  BEGIN
    INSERT INTO public.conversations(type, linked_entity_type, brand_id, name, created_by)
    VALUES ('group', 'brand_enquiry', v_brand, 'forged', v_guest);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  IF v_err IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'forged_enquiry_conversation_allowed:%', v_err; END IF;
  v_err := NULL;
  BEGIN
    UPDATE public.brand_enquiries SET status = 'resolved' WHERE id = v_enquiry;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  IF v_err IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'guest_direct_enquiry_update_allowed:%', v_err; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  v_err := NULL;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_conversation, v_member, 'direct write');
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  IF v_err IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'member_direct_message_insert_allowed:%', v_err; END IF;
  RESET ROLE;

  SELECT count(*) INTO v_count FROM public.messages
  WHERE conversation_id = v_conversation AND content = 'Hi, can I get a refund for my two tickets please?'
    AND sender_kind = 'guest' AND sender_id = v_guest;
  IF v_count <> 1 THEN RAISE EXCEPTION 'guest_message_changed_by_direct_write'; END IF;

  -- ── Status machine ───────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  IF (public.list_brand_enquiries(v_brand, NULL)->'counts'->>'new')::integer <> 1 THEN
    RAISE EXCEPTION 'list_counts_new_wrong';
  END IF;
  v_message := public.brand_enquiry_reply(v_enquiry, 'Of course, we can refund that today.');
  RESET ROLE;
  SELECT status INTO v_text FROM public.brand_enquiries WHERE id = v_enquiry;
  IF v_text <> 'replied' THEN RAISE EXCEPTION 'reply_status_wrong:%', v_text; END IF;
  SELECT sender_display_name_snapshot INTO v_text FROM public.messages WHERE id = v_message;
  IF v_text <> 'Mina at Lantern Room' THEN RAISE EXCEPTION 'brand_display_snapshot_wrong:%', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.notification_outbox
  WHERE category_key = 'explorer.brand_enquiry_reply' AND user_id = v_guest
    AND payload->>'message_id' = v_message::text
    AND payload->>'deep_link' = 'mingla://chat/' || v_conversation::text || '?type=brand_enquiry&enquiryId=' || v_enquiry::text;
  IF v_count <> 1 THEN RAISE EXCEPTION 'explorer_reply_push_missing'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  v_json := public.brand_enquiry_get_thread(v_enquiry, 50);
  IF jsonb_array_length(v_json->'messages') <> 2
     OR v_json->'messages'->1->>'display' <> 'Mina at Lantern Room'
     OR v_json->'enquiry'->'guest' ? 'email' THEN
    RAISE EXCEPTION 'guest_thread_view_wrong:%', v_json;
  END IF;
  v_message := public.brand_enquiry_guest_reply(v_enquiry, 'Thank you!');
  RESET ROLE;
  SELECT status INTO v_text FROM public.brand_enquiries WHERE id = v_enquiry;
  IF v_text <> 'waiting' THEN RAISE EXCEPTION 'guest_reply_status_wrong:%', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.notification_outbox
  WHERE category_key = 'business.brand_enquiry_message' AND payload->>'message_id' = v_message::text;
  IF v_count <> 2 THEN RAISE EXCEPTION 'guest_message_team_push_count:%', v_count; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  v_json := public.brand_enquiry_get_thread(v_enquiry, 50);
  IF v_json->'enquiry'->'guest'->>'email' <> 'enq-guest@test.local'
     OR v_json->'enquiry'->'context'->>'title' <> 'Lantern Night'
     OR v_json->'messages'->1->>'display' <> 'Mina Test' THEN
    RAISE EXCEPTION 'team_thread_view_wrong:%', v_json;
  END IF;
  IF public.brand_enquiry_set_status(v_enquiry, 'resolve') <> 'resolved' THEN RAISE EXCEPTION 'resolve_failed'; END IF;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  PERFORM public.brand_enquiry_guest_reply(v_enquiry, 'One more question.');
  RESET ROLE;
  SELECT status INTO v_text FROM public.brand_enquiries WHERE id = v_enquiry;
  IF v_text <> 'waiting' THEN RAISE EXCEPTION 'resolved_to_waiting_failed:%', v_text; END IF;

  -- ── Report opens the thread to staff; dismissal closes it again ────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  PERFORM public.brand_enquiry_report(v_enquiry, 'They asked for my bank password');
  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  SELECT (SELECT count(*) FROM public.brand_enquiries WHERE id = v_enquiry)
       + (SELECT count(*) FROM public.messages WHERE conversation_id = v_conversation)
  INTO v_count;
  IF v_count <> 5 THEN RAISE EXCEPTION 'staff_cannot_read_reported:%', v_count; END IF;
  IF jsonb_array_length(public.admin_list_reported_enquiries(100)) <> 1 THEN
    RAISE EXCEPTION 'admin_list_reported_missing';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  SELECT count(*) INTO v_count FROM public.brand_enquiries WHERE id = v_enquiry;
  IF v_count <> 0 THEN RAISE EXCEPTION 'scanner_reads_reported_enquiry'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_enquiry_dismiss_report(v_enquiry);
  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  SELECT count(*) INTO v_count FROM public.messages WHERE conversation_id = v_conversation;
  IF v_count <> 0 THEN RAISE EXCEPTION 'staff_reads_after_dismissal:%', v_count; END IF;
  RESET ROLE;

  -- ── Block sender: the guest can no longer open or continue a thread ────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.brand_enquiry_block_sender(v_enquiry);
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  v_err := NULL;
  BEGIN
    PERFORM public.brand_enquiry_send(v_brand, 'brand_page', 'none', NULL, 'general_question', 'Sending again after a block.');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'enquiries_unavailable' THEN RAISE EXCEPTION 'blocked_send_not_refused:%', v_err; END IF;
  v_err := NULL;
  BEGIN PERFORM public.brand_enquiry_guest_reply(v_enquiry, 'And again.'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'enquiry_unavailable' THEN RAISE EXCEPTION 'blocked_reply_not_refused:%', v_err; END IF;
  -- A different brand is not affected by this brand's block.
  v_sent := public.brand_enquiry_send(v_other_brand, 'brand_page', 'none', NULL, 'general_question', 'Hello other brand, a question.');
  IF v_sent->>'enquiry_id' IS NULL THEN RAISE EXCEPTION 'other_brand_blocked_by_mistake'; END IF;
  RESET ROLE;

  -- ── Signed-out web path (service role, as the edge function calls it) ──
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  v_web := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'offering', 'offering',
    '41110000-0000-4000-be00-0000000000e1', 'question_before_booking',
    'Is there step-free access to the venue?', 'Wale Web', 'ENQ-WEB@test.local', '+15555550123', true,
    repeat('a', 64), false, '{}'::text[], v_token, 'Lantern Room will see your name and email.', 'v1');
  IF v_web->>'status' <> 'created' THEN RAISE EXCEPTION 'web_create_failed:%', v_web; END IF;
  v_web_enquiry := (v_web->>'enquiry_id')::uuid;

  -- Anonymous web callers cannot attach an order.
  IF public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'order', v_order,
    'refund_cancel', 'Trying to attach someone else''s order.', 'Mallory', 'mallory@test.local', NULL, false,
    repeat('b', 64), false, '{}'::text[], encode(sha256('m1'::bytea), 'hex'), NULL, NULL)->>'status' <> 'invalid' THEN
    RAISE EXCEPTION 'anon_order_context_not_refused';
  END IF;
  -- Sites general contact form shape.
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'site', 'lantern.sites.usemingla.com', 'site', 'none', NULL,
    'website_contact', 'Do you host private birthday dinners?', 'Sita Site', 'sita@test.local', NULL, false,
    repeat('c', 64), false, '{}'::text[], encode(sha256('s1'::bytea), 'hex'), 'Site disclosure', 'site-v1');
  IF v_json->>'status' <> 'created' THEN RAISE EXCEPTION 'site_create_failed:%', v_json; END IF;
  IF (SELECT source || '|' || origin || '|' || entry FROM public.brand_enquiries WHERE id = (v_json->>'enquiry_id')::uuid)
     <> 'site|lantern.sites.usemingla.com|site' THEN
    RAISE EXCEPTION 'site_row_shape_wrong';
  END IF;

  -- Per-email-per-brand rate limit: the 4th within a day is refused.
  FOR i IN 1..3 LOOP
    v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
      'general_question', 'Rate limit probe message ' || i, 'Rita', 'rita@test.local', NULL, false,
      repeat('d', 64), false, '{}'::text[], encode(sha256(('r' || i)::bytea), 'hex'), NULL, NULL);
    IF v_json->>'status' <> 'created' THEN RAISE EXCEPTION 'rate_probe_%_refused:%', i, v_json; END IF;
  END LOOP;
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'Rate limit probe message 4', 'Rita', 'rita@test.local', NULL, false,
    repeat('d', 64), false, '{}'::text[], encode(sha256('r4'::bytea), 'hex'), NULL, NULL);
  IF v_json->>'status' <> 'rate_limited' THEN RAISE EXCEPTION 'fourth_enquiry_not_rate_limited:%', v_json; END IF;
  SELECT hit_count INTO v_count FROM public.brand_follow_request_rate
  WHERE bucket_key = 'enq:eb:' || v_brand::text || ':' || public.issue_4111_email_hash('rita@test.local');
  IF v_count <> 4 THEN RAISE EXCEPTION 'rate_counter_wrong:%', v_count; END IF;

  -- A blocked email is refused silently (status blocked, no row).
  INSERT INTO public.brand_enquiry_blocks(brand_id, email_hash) VALUES (v_brand, public.issue_4111_email_hash('spam@test.local'));
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'Blocked sender trying again.', 'Spam', 'spam@test.local', NULL, false,
    repeat('e', 64), false, '{}'::text[], encode(sha256('b1'::bytea), 'hex'), NULL, NULL);
  IF v_json->>'status' <> 'blocked' OR EXISTS (SELECT 1 FROM public.brand_enquiries WHERE guest_email = 'spam@test.local') THEN
    RAISE EXCEPTION 'blocked_email_not_refused:%', v_json;
  END IF;

  -- Token: first read confirms the email; post moves status; expiry answers expired.
  IF (SELECT guest_email_confirmed_at FROM public.brand_enquiries WHERE id = v_web_enquiry) IS NOT NULL THEN
    RAISE EXCEPTION 'web_email_confirmed_too_early';
  END IF;
  v_json := public.issue_4111_thread_by_token(v_token);
  IF v_json->>'status' <> 'ok' OR jsonb_array_length(v_json->'messages') <> 1
     OR v_json->'enquiry'->'guest' ? 'email' OR v_json::text LIKE '%enq-member@%' THEN
    RAISE EXCEPTION 'token_thread_wrong:%', v_json;
  END IF;
  IF (SELECT guest_email_confirmed_at FROM public.brand_enquiries WHERE id = v_web_enquiry) IS NULL THEN
    RAISE EXCEPTION 'token_read_did_not_confirm_email';
  END IF;
  IF public.issue_4111_thread_by_token(repeat('f', 64))->>'status' <> 'invalid' THEN
    RAISE EXCEPTION 'unknown_token_not_invalid';
  END IF;
  INSERT INTO public.brand_enquiry_access_tokens(token_hash, enquiry_id, expires_at)
  VALUES (v_token_old, v_web_enquiry, now() - interval '1 minute');
  IF public.issue_4111_thread_by_token(v_token_old)->>'status' <> 'expired' THEN
    RAISE EXCEPTION 'expired_token_not_expired';
  END IF;
  RESET ROLE;

  -- Team replies; the digest claims the thread once per 10 minutes.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.brand_enquiry_reply(v_web_enquiry, 'Yes, there is a ramp at the side entrance.');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  v_json := public.issue_4111_claim_guest_digests(25);
  IF jsonb_array_length(v_json) <> 1 OR v_json->0->>'enquiry_id' <> v_web_enquiry::text
     OR jsonb_array_length(v_json->0->'messages') <> 1 THEN
    RAISE EXCEPTION 'digest_claim_wrong:%', v_json;
  END IF;
  IF jsonb_array_length(public.issue_4111_claim_guest_digests(25)) <> 0 THEN
    RAISE EXCEPTION 'digest_claimed_twice';
  END IF;
  v_json := public.issue_4111_guest_post_by_token(v_token, 'Great, thank you!', repeat('a', 64));
  IF v_json->>'status' <> 'sent' THEN RAISE EXCEPTION 'token_post_failed:%', v_json; END IF;
  RESET ROLE;
  SELECT status INTO v_text FROM public.brand_enquiries WHERE id = v_web_enquiry;
  IF v_text <> 'waiting' THEN RAISE EXCEPTION 'token_post_status_wrong:%', v_text; END IF;

  -- Explorer sign-in with the same verified email claims the web thread.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_webuser::text, true);
  SELECT count(*) INTO v_count FROM public.brand_enquiries WHERE id = v_web_enquiry;
  IF v_count <> 0 THEN RAISE EXCEPTION 'unclaimed_thread_visible'; END IF;
  IF public.claim_brand_enquiries_for_user() <> 1 THEN RAISE EXCEPTION 'claim_count_wrong'; END IF;
  SELECT count(*) INTO v_count FROM public.messages
  WHERE conversation_id = (SELECT conversation_id FROM public.brand_enquiries WHERE id = v_web_enquiry);
  IF v_count <> 3 THEN RAISE EXCEPTION 'claimed_thread_not_readable:%', v_count; END IF;
  RESET ROLE;

  -- ── Crons: 24h nudge (once) and 30-day auto-resolve ──────────────────
  UPDATE public.brand_enquiries SET last_guest_at = now() - interval '25 hours', last_brand_at = NULL, nudged_at = NULL
  WHERE id = (SELECT e.id FROM public.brand_enquiries e WHERE e.guest_email = 'sita@test.local');
  PERFORM public.issue_4111_enquiry_nudge_sweep();
  SELECT count(*) INTO v_count FROM public.notification_outbox
  WHERE category_key = 'business.brand_enquiry_nudge'
    AND payload->>'enquiry_id' = (SELECT e.id::text FROM public.brand_enquiries e WHERE e.guest_email = 'sita@test.local');
  IF v_count <> 3 THEN RAISE EXCEPTION 'nudge_rows_wrong:%', v_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'business.brand_enquiry_nudge'
    AND user_id IS NULL AND contact = 'hello-lantern@test.local') THEN
    RAISE EXCEPTION 'nudge_contact_email_missing';
  END IF;
  PERFORM public.issue_4111_enquiry_nudge_sweep();
  SELECT count(*) INTO v_count FROM public.notification_outbox WHERE category_key = 'business.brand_enquiry_nudge';
  IF v_count <> 3 THEN RAISE EXCEPTION 'nudge_repeated:%', v_count; END IF;

  UPDATE public.brand_enquiries SET last_guest_at = now() - interval '31 days', last_brand_at = now() - interval '31 days'
  WHERE guest_email = 'sita@test.local';
  PERFORM public.issue_4111_auto_resolve_idle_enquiries();
  IF (SELECT status FROM public.brand_enquiries WHERE guest_email = 'sita@test.local') <> 'resolved' THEN
    RAISE EXCEPTION 'auto_resolve_failed';
  END IF;

  -- ── Brand switch off: nothing new is accepted ────────────────────────
  UPDATE public.brands SET enquiries_enabled = false WHERE id = v_brand;
  IF (SELECT enquiries_available FROM public.business_public_brands_view WHERE id = v_brand) THEN
    RAISE EXCEPTION 'view_still_available';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  IF public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'Brand turned enquiries off.', 'Late', 'late@test.local', NULL, false,
    repeat('a', 64), false, '{}'::text[], encode(sha256('late'::bytea), 'hex'), NULL, NULL)->>'status' <> 'unavailable' THEN
    RAISE EXCEPTION 'disabled_brand_accepted_enquiry';
  END IF;
  RESET ROLE;
  UPDATE public.brands SET enquiries_enabled = true WHERE id = v_brand;

  -- ── Subscribe: account email follows; unknown email joins the book ────
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  v_json := public.issue_4111_create_subscribe_pending(v_brand, 'web', NULL, 'enq-sub-acct@test.local', NULL, false,
    encode(sha256('sub-acct'::bytea), 'hex'), NULL, repeat('a', 64), 'By subscribing you agree.', 'v1', NULL);
  IF v_json->>'status' <> 'created' THEN RAISE EXCEPTION 'subscribe_pending_failed:%', v_json; END IF;
  v_json := public.issue_4111_confirm_subscribe(encode(sha256('sub-acct'::bytea), 'hex'));
  IF v_json->>'status' <> 'confirmed' OR v_json->>'outcome' <> 'followed' THEN RAISE EXCEPTION 'account_confirm_wrong:%', v_json; END IF;
  IF public.issue_4111_confirm_subscribe(encode(sha256('sub-acct'::bytea), 'hex'))->>'status' <> 'already' THEN
    RAISE EXCEPTION 'confirm_not_idempotent';
  END IF;

  v_json := public.issue_4111_create_subscribe_pending(v_brand, 'site', 'lantern.sites.usemingla.com', 'new-reader@test.local',
    '+15555550199', true, encode(sha256('sub-new'::bytea), 'hex'), encode(sha256('sub-new-sms'::bytea), 'hex'),
    repeat('a', 64), 'Site newsletter disclosure', 'site-v1', 'Also text me.');
  IF v_json->>'status' <> 'created' OR (v_json->>'send_sms')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'subscribe_new_pending_failed:%', v_json;
  END IF;
  v_json := public.issue_4111_confirm_subscribe(encode(sha256('sub-new'::bytea), 'hex'));
  IF v_json->>'outcome' <> 'subscribed' THEN RAISE EXCEPTION 'new_confirm_wrong:%', v_json; END IF;
  v_json := public.issue_4111_confirm_subscribe(encode(sha256('sub-new-sms'::bytea), 'hex'));
  IF v_json->>'status' <> 'confirmed' OR v_json->>'channel' <> 'sms' THEN RAISE EXCEPTION 'sms_confirm_wrong:%', v_json; END IF;
  RESET ROLE;

  IF NOT EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = v_subacct AND brand_id = v_brand AND source = 'web_subscribe')
     OR NOT EXISTS (SELECT 1 FROM public.brand_follow_channel_prefs WHERE user_id = v_subacct AND brand_id = v_brand
       AND channel = 'email' AND enabled) THEN
    RAISE EXCEPTION 'account_subscriber_not_following';
  END IF;
  SELECT count(*) INTO v_count FROM public.brand_person_contact_methods cm
  WHERE cm.brand_id = v_brand AND cm.marketing_consent_state = 'granted' AND cm.marketing_consent_record_id IS NOT NULL
    AND ((cm.channel = 'email' AND cm.normalized_value = 'new-reader@test.local')
      OR (cm.channel = 'phone' AND cm.normalized_value = '+15555550199'));
  IF v_count <> 2 THEN RAISE EXCEPTION 'newsletter_contact_methods_wrong:%', v_count; END IF;
  IF (SELECT count(DISTINCT cm.brand_person_id) FROM public.brand_person_contact_methods cm
      WHERE cm.brand_id = v_brand AND cm.normalized_value IN ('new-reader@test.local', '+15555550199')) <> 1 THEN
    RAISE EXCEPTION 'newsletter_split_into_two_people';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consent_records WHERE contact = 'new-reader@test.local' AND brand_id = v_brand
      AND scope = 'marketing' AND action = 'granted' AND disclosure_text = 'Site newsletter disclosure'
      AND disclosure_version = 'site-v1' AND source = 'site_subscribe') THEN
    RAISE EXCEPTION 'newsletter_consent_record_missing';
  END IF;
  -- Enquiries never add anyone to a marketing list (D9).
  IF EXISTS (SELECT 1 FROM public.brand_person_contact_methods WHERE brand_id = v_brand
    AND normalized_value IN ('enq-guest@test.local', 'enq-web@test.local', 'rita@test.local', 'sita@test.local')) THEN
    RAISE EXCEPTION 'enquiry_added_to_contact_book';
  END IF;
  -- Subscribe texts count against the brand's monthly SMS cap.
  IF public.issue_4111_subscribe_sms_used(v_brand) <> 1 THEN RAISE EXCEPTION 'subscribe_sms_not_counted'; END IF;
END;
$proof$;

ROLLBACK;
