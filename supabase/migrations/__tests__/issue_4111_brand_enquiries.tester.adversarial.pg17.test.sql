-- #4111 — independent tester adversarial proof for Customer enquiries.
--
-- The implementor suite proves the happy paths. This suite attacks the edges:
-- team members who lose access mid-life (demoted to scanner, removed), every
-- read path a non-reader could use (rows, conversations, messages,
-- participants, read receipts, every RPC), forged contexts of every kind and
-- from another brand, the global block, the per-IP and per-email limits,
-- moderation-flagged enquiries, status-machine boundaries (29 vs 31 idle days,
-- 23 vs 25 hours for the nudge, the nudge never repeating), the 10-minute
-- guest digest window, token misuse, the subscribe text link, the SMS cap,
-- and who may write read receipts on enquiry messages.
--
-- FAILS-ON-REVERT:
--   * 20271223014111 (message_reads guard): dropping its restrictive policies
--     lets a stranger write read receipts on an enquiry message
--     (raises stranger_wrote_enquiry_read_receipt).
--   * 20271223024111 (subscribe text link): reverting issue_4111_confirm_subscribe
--     to the 20271222004111 body lets a text link tapped on someone else's
--     phone follow the account that owns the email (raises
--     sms_link_followed_unproven_account).
--   * 20271223034111 (participant move guard): dropping its policy lets a
--     stranger re-point their own participant row at an enquiry and read it
--     (raises participant_row_moved_into_enquiry).
--   * Dropping the scanner or removed_at filters from
--     issue_4111_is_enquiry_team_member raises demoted_scanner_reads / removed_member_reads.
-- MINGLA-INVARIANT: I-4111-ENQUIRY-READ-RECEIPT-READER-ONLY | issue #4111 | Only a reader of an enquiry can write read receipts on its messages.
-- MINGLA-INVARIANT: I-4111-ENQUIRY-PARTICIPANT-NO-MOVE-IN | issue #4111 | Nobody re-points a participant row into an enquiry they cannot read.
-- MINGLA-INVARIANT: I-4111-SUBSCRIBE-SMS-LINK-NO-ACCOUNT | issue #4111 | A subscribe text link never follows or records consent for a Mingla account.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t4111a_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t4111a_people VALUES
  ('owner',    '4111a000-0000-4000-a800-000000000001', 'adv-owner@test.local',    'Ona'),
  ('member',   '4111a000-0000-4000-a800-000000000002', 'adv-member@test.local',   'Meri'),
  ('scanner',  '4111a000-0000-4000-a800-000000000003', 'adv-scanner@test.local',  'Scan'),
  ('demoted',  '4111a000-0000-4000-a800-000000000004', 'adv-demoted@test.local',  'Dem'),
  ('removed',  '4111a000-0000-4000-a800-000000000005', 'adv-removed@test.local',  'Rem'),
  ('staff',    '4111a000-0000-4000-a800-000000000006', 'adv-staff@test.local',    'Sta'),
  ('admin',    '4111a000-0000-4000-a800-000000000007', 'adv-admin@test.local',    'Adm'),
  ('guesta',   '4111a000-0000-4000-a800-000000000008', 'adv-guesta@test.local',   'Gia'),
  ('guestb',   '4111a000-0000-4000-a800-000000000009', 'adv-guestb@test.local',   'Gib'),
  ('stranger', '4111a000-0000-4000-a800-00000000000a', 'adv-stranger@test.local', 'Str'),
  ('other',    '4111a000-0000-4000-a800-00000000000b', 'adv-other@test.local',    'Oth'),
  ('victim',   '4111a000-0000-4000-a800-00000000000c', 'adv-victim@test.local',   'Vic'),
  ('c1',       '4111a000-0000-4000-a800-0000000000c1', 'adv-c1@test.local',       'Cea'),
  ('c2',       '4111a000-0000-4000-a800-0000000000c2', 'adv-c2@test.local',       'Ceb'),
  ('c3',       '4111a000-0000-4000-a800-0000000000c3', 'adv-c3@test.local',       'Cec'),
  ('c4',       '4111a000-0000-4000-a800-0000000000c4', 'adv-c4@test.local',       'Ced');

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT id, email, now(), jsonb_build_object('full_name', first_name) FROM t4111a_people;
INSERT INTO public.profiles(id, email, first_name, last_name, display_name, username, account_type)
SELECT id, email, first_name, 'Adv', first_name || ' Adv', 'issue4111adv_' || who, 'business'
FROM t4111a_people;
INSERT INTO public.creator_accounts(id, email, display_name, business_name)
SELECT id, email, first_name, 'Issue 4111 Adv Host' FROM t4111a_people
WHERE who IN ('owner', 'other', 'c1', 'c2', 'c3', 'c4');

INSERT INTO public.support_staff(user_id, enabled, available, display_name, role)
SELECT id, true, true, first_name, 'staff' FROM t4111a_people WHERE who = 'staff';
INSERT INTO public.admin_team_members(email, role, status, accepted_at)
SELECT email, 'growth', 'active', now() FROM t4111a_people WHERE who = 'staff';
INSERT INTO public.admin_users(email, role, status, accepted_at)
SELECT email, 'admin', 'active', now() FROM t4111a_people WHERE who = 'admin';

INSERT INTO public.brands(id, account_id, name, slug, contact_email, default_currency) VALUES
  ('4111a000-0000-4000-a900-0000000000a1', '4111a000-0000-4000-a800-000000000001', 'Adv Lantern', 'issue-4111-adv-lantern', 'adv-lantern-box@test.local', 'USD'),
  ('4111a000-0000-4000-a900-0000000000b2', '4111a000-0000-4000-a800-00000000000b', 'Adv Other', 'issue-4111-adv-other', NULL, 'USD'),
  ('4111a000-0000-4000-a900-0000000000c1', '4111a000-0000-4000-a800-0000000000c1', 'Adv C1', 'issue-4111-adv-c1', NULL, 'USD'),
  ('4111a000-0000-4000-a900-0000000000c2', '4111a000-0000-4000-a800-0000000000c2', 'Adv C2', 'issue-4111-adv-c2', NULL, 'USD'),
  ('4111a000-0000-4000-a900-0000000000c3', '4111a000-0000-4000-a800-0000000000c3', 'Adv C3', 'issue-4111-adv-c3', NULL, 'USD'),
  ('4111a000-0000-4000-a900-0000000000c4', '4111a000-0000-4000-a800-0000000000c4', 'Adv C4', 'issue-4111-adv-c4', NULL, 'USD');

INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
SELECT '4111a000-0000-4000-a900-0000000000a1', id,
  CASE who WHEN 'scanner' THEN 'scanner' ELSE 'marketing_manager' END, now()
FROM t4111a_people WHERE who IN ('member', 'scanner', 'demoted', 'removed');

INSERT INTO public.events(id, brand_id, title, slug, status, event_type) VALUES
  ('4111a000-0000-4000-ae00-0000000000e1', '4111a000-0000-4000-a900-0000000000a1', 'Adv Night', 'issue-4111-adv-night', 'scheduled', 'event'),
  ('4111a000-0000-4000-ae00-0000000000e2', '4111a000-0000-4000-a900-0000000000b2', 'Adv Other Night', 'issue-4111-adv-other-night', 'scheduled', 'event'),
  ('4111a000-0000-4000-ae00-0000000000e3', '4111a000-0000-4000-a900-0000000000a1', 'Adv Draft', 'issue-4111-adv-draft', 'draft', 'event');
INSERT INTO public.event_dates(event_id, start_at, end_at, is_master) VALUES
  ('4111a000-0000-4000-ae00-0000000000e1', now() + interval '3 days', now() + interval '3 days 4 hours', true),
  ('4111a000-0000-4000-ae00-0000000000e2', now() + interval '4 days', now() + interval '4 days 4 hours', true),
  ('4111a000-0000-4000-ae00-0000000000e3', now() + interval '5 days', now() + interval '5 days 4 hours', true);
INSERT INTO public.orders(id, event_id, buyer_user_id, payment_status, source) VALUES
  ('4111a000-0000-4000-af00-0000000000d1', '4111a000-0000-4000-ae00-0000000000e1', '4111a000-0000-4000-a800-000000000008', 'paid', 'manual_import'),
  ('4111a000-0000-4000-af00-0000000000d2', '4111a000-0000-4000-ae00-0000000000e1', '4111a000-0000-4000-a800-000000000009', 'paid', 'manual_import'),
  ('4111a000-0000-4000-af00-0000000000d3', '4111a000-0000-4000-ae00-0000000000e2', '4111a000-0000-4000-a800-000000000008', 'paid', 'manual_import');
INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, rsvp_status, approval_status) VALUES
  ('4111a000-0000-4000-af00-0000000000f1', '4111a000-0000-4000-ae00-0000000000e1', '4111a000-0000-4000-a800-000000000009', 'Gib Adv', 'going', 'approved');
INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category) VALUES
  ('4111a000-0000-4000-ad00-0000000000a1', '4111a000-0000-4000-a900-0000000000a1', 'advlantern', 'Adv Lantern Room', 35.9, -79.0, 'restaurant'),
  ('4111a000-0000-4000-ad00-0000000000b2', '4111a000-0000-4000-a900-0000000000b2', 'advother', 'Adv Other Room', 35.8, -78.9, 'restaurant');
INSERT INTO public.reservations(id, brand_id, venue_id, reserved_for, party_size, consumer_user_id, status, created_via) VALUES
  ('4111a000-0000-4000-ac00-0000000000a1', '4111a000-0000-4000-a900-0000000000a1', '4111a000-0000-4000-ad00-0000000000a1',
   now() + interval '2 days', 2, '4111a000-0000-4000-a800-000000000009', 'confirmed', 'consumer');

DO $proof$
DECLARE
  v_brand constant uuid := '4111a000-0000-4000-a900-0000000000a1';
  v_brand_b constant uuid := '4111a000-0000-4000-a900-0000000000b2';
  v_owner constant uuid := '4111a000-0000-4000-a800-000000000001';
  v_member constant uuid := '4111a000-0000-4000-a800-000000000002';
  v_scanner constant uuid := '4111a000-0000-4000-a800-000000000003';
  v_demoted constant uuid := '4111a000-0000-4000-a800-000000000004';
  v_removed constant uuid := '4111a000-0000-4000-a800-000000000005';
  v_staff constant uuid := '4111a000-0000-4000-a800-000000000006';
  v_admin constant uuid := '4111a000-0000-4000-a800-000000000007';
  v_guesta constant uuid := '4111a000-0000-4000-a800-000000000008';
  v_guestb constant uuid := '4111a000-0000-4000-a800-000000000009';
  v_stranger constant uuid := '4111a000-0000-4000-a800-00000000000a';
  v_other constant uuid := '4111a000-0000-4000-a800-00000000000b';
  v_victim constant uuid := '4111a000-0000-4000-a800-00000000000c';
  v_order_a constant uuid := '4111a000-0000-4000-af00-0000000000d1';
  v_order_b constant uuid := '4111a000-0000-4000-af00-0000000000d2';
  v_order_a_other_brand constant uuid := '4111a000-0000-4000-af00-0000000000d3';
  v_rsvp_b constant uuid := '4111a000-0000-4000-af00-0000000000f1';
  v_event constant uuid := '4111a000-0000-4000-ae00-0000000000e1';
  v_event_other constant uuid := '4111a000-0000-4000-ae00-0000000000e2';
  v_event_draft constant uuid := '4111a000-0000-4000-ae00-0000000000e3';
  v_venue constant uuid := '4111a000-0000-4000-ad00-0000000000a1';
  v_venue_other constant uuid := '4111a000-0000-4000-ad00-0000000000b2';
  v_resv_b constant uuid := '4111a000-0000-4000-ac00-0000000000a1';
  v_ip constant text := repeat('a', 64);
  v_sent jsonb;
  v_json jsonb;
  v_e1 uuid; v_c1 uuid;
  v_e2 uuid; v_c2 uuid;
  v_w1 uuid; v_w2 uuid; v_spam uuid; v_spam_conv uuid;
  v_brand_msg uuid;
  v_e2_msg uuid;
  v_conv_own uuid;
  v_count bigint;
  v_text text;
  v_err text;
  v_who text;
  v_user uuid;
  v_kind text;
  v_tok_w1 constant text := encode(sha256('adv-4111-w1'::bytea), 'hex');
  v_tok_w2 constant text := encode(sha256('adv-4111-w2'::bytea), 'hex');
  v_tok_spam constant text := encode(sha256('adv-4111-spam'::bytea), 'hex');
  v_tok_new constant text := encode(sha256('adv-4111-new-link'::bytea), 'hex');
  v_before integer;
  i integer;
BEGIN
  -- ════════════════════════════════════════════════════════════════════════
  -- 1. Context forgery (signed-in). Every refusal creates nothing.
  -- ════════════════════════════════════════════════════════════════════════
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_guesta::text, true);

  FOR v_kind, v_user IN
    SELECT * FROM (VALUES
      ('order', v_order_b),                 -- someone else's order, same brand
      ('order', v_order_a_other_brand),     -- own order, other brand
      ('rsvp', v_rsvp_b),                   -- someone else's RSVP
      ('reservation', v_resv_b),            -- someone else's reservation
      ('stay', gen_random_uuid()),          -- unknown stay
      ('venue_order', gen_random_uuid()),   -- unknown venue order
      ('offering', v_event_other),          -- another brand's offering
      ('offering', v_event_draft),          -- a draft offering
      ('venue', v_venue_other)              -- another brand's venue
    ) AS t(k, id)
  LOOP
    v_err := NULL;
    BEGIN
      PERFORM public.brand_enquiry_send(v_brand, 'brand_page', v_kind, v_user, 'something_else',
        'Forged context attempt for the adversarial suite.');
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err IS DISTINCT FROM 'invalid_context' THEN
      RAISE EXCEPTION 'forged_context_accepted:%:%', v_kind, v_err;
    END IF;
  END LOOP;
  -- Shape forgery: a kind with no id, and an id with kind none.
  v_err := NULL;
  BEGIN
    PERFORM public.brand_enquiry_send(v_brand, 'brand_page', 'order', NULL, 'something_else', 'Kind without an id at all.');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'invalid_context' THEN RAISE EXCEPTION 'kind_without_id_accepted:%', v_err; END IF;
  v_err := NULL;
  BEGIN
    PERFORM public.brand_enquiry_send(v_brand, 'brand_page', 'none', v_order_a, 'something_else', 'An id with kind none.');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'invalid_context' THEN RAISE EXCEPTION 'id_without_kind_accepted:%', v_err; END IF;
  -- A signed-in caller cannot claim to be a Mingla Site.
  v_err := NULL;
  BEGIN
    PERFORM public.brand_enquiry_send(v_brand, 'site', 'none', NULL, 'website_contact', 'Pretending to be a site.', 'site');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'signed_in_site_source_accepted'; END IF;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.brand_enquiries WHERE brand_id = v_brand;
  IF v_count <> 0 THEN RAISE EXCEPTION 'forgery_left_rows:%', v_count; END IF;

  -- Legit: guest A about their own order (E1); guest B about their RSVP (E2).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guesta::text, true);
  v_sent := public.brand_enquiry_send(v_brand, 'brand_page', 'order', v_order_a, 'refund_cancel',
    'Guest A asks about their own tickets.');
  v_e1 := (v_sent->>'enquiry_id')::uuid; v_c1 := (v_sent->>'conversation_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', v_guestb::text, true);
  v_sent := public.brand_enquiry_send(v_brand, 'brand_page', 'rsvp', v_rsvp_b, 'bring_guest',
    'Guest B asks about bringing a friend.');
  v_e2 := (v_sent->>'enquiry_id')::uuid; v_c2 := (v_sent->>'conversation_id')::uuid;
  -- Team replies once in E1 so there are brand messages to read.
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  v_brand_msg := public.brand_enquiry_reply(v_e1, 'Team reply for guest A.');
  RESET ROLE;

  -- Anonymous (service role, as the edge calls it) can never attach a booking.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  FOR v_kind IN SELECT unnest(ARRAY['order','rsvp','reservation','stay','venue_order']) LOOP
    v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', v_kind,
      CASE v_kind WHEN 'order' THEN v_order_a WHEN 'rsvp' THEN v_rsvp_b WHEN 'reservation' THEN v_resv_b ELSE gen_random_uuid() END,
      'refund_cancel', 'Anonymous booking attach attempt.', 'Anon', 'anon-attach@test.local', NULL, false,
      repeat('b', 64), false, '{}'::text[], encode(sha256(('adv-anon-' || v_kind)::bytea), 'hex'), NULL, NULL);
    IF v_json->>'status' <> 'invalid' THEN RAISE EXCEPTION 'anon_booking_attach_not_refused:%:%', v_kind, v_json; END IF;
  END LOOP;
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'offering', 'offering', v_event_other,
    'question_before_booking', 'Anonymous cross-brand offering attempt.', 'Anon', 'anon-attach@test.local', NULL, false,
    repeat('b', 64), false, '{}'::text[], encode(sha256('adv-anon-offering'::bytea), 'hex'), NULL, NULL);
  IF v_json->>'status' <> 'invalid_context' THEN RAISE EXCEPTION 'anon_cross_brand_offering_accepted:%', v_json; END IF;
  -- A service-role helper called by an ordinary signed-in user is refused.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_err := NULL;
  BEGIN
    PERFORM public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
      'general_question', 'Direct call to the service helper.', 'X', 'x@test.local', NULL, false,
      NULL, false, '{}'::text[], repeat('c', 64), NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  IF v_err IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'service_helper_open_to_users:%', v_err; END IF;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.brand_enquiries WHERE guest_email = 'anon-attach@test.local';
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon_attach_left_rows:%', v_count; END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 2. Who can read E1 — every table and every RPC.
  -- ════════════════════════════════════════════════════════════════════════
  -- Lose access mid-life: one member is demoted to scanner, one is removed.
  UPDATE public.brand_team_members SET role = 'scanner' WHERE brand_id = v_brand AND user_id = v_demoted;
  UPDATE public.brand_team_members SET removed_at = now() WHERE brand_id = v_brand AND user_id = v_removed;

  FOR v_who, v_user IN
    SELECT * FROM (VALUES
      ('owner', v_owner), ('member', v_member), ('guesta', v_guesta),
      ('scanner', v_scanner), ('demoted', v_demoted), ('removed', v_removed), ('staff', v_staff),
      ('admin', v_admin), ('guestb', v_guestb), ('stranger', v_stranger), ('other', v_other)
    ) AS t(w, u)
  LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SELECT
      (SELECT count(*) FROM public.brand_enquiries WHERE id = v_e1)
      + (SELECT count(*) FROM public.conversations WHERE id = v_c1)
      + (SELECT count(*) FROM public.messages WHERE conversation_id = v_c1)
      + (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_c1)
    INTO v_count;
    v_err := NULL;
    BEGIN
      v_json := public.brand_enquiry_get_thread(v_e1);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    SELECT count(*) INTO v_before FROM jsonb_array_elements(public.list_brand_enquiries(NULL, 'all')->'items') item
    WHERE item->>'id' = v_e1::text;
    RESET ROLE;

    IF v_who IN ('owner', 'member') THEN
      -- enquiry 1 + conversation 1 + messages 2 (participants are hidden from the team: 0)
      IF v_count < 4 OR v_err IS NOT NULL OR v_before <> 1 THEN
        RAISE EXCEPTION 'team_reader_refused:%:%:%:%', v_who, v_count, v_err, v_before;
      END IF;
    ELSIF v_who = 'guesta' THEN
      IF v_count <> 5 OR v_err IS NOT NULL OR v_before <> 0 THEN
        RAISE EXCEPTION 'guest_reader_wrong:%:%:%', v_count, v_err, v_before;
      END IF;
    ELSE
      IF v_count <> 0 THEN
        RAISE EXCEPTION '%_reads:%', CASE v_who WHEN 'demoted' THEN 'demoted_scanner' WHEN 'removed' THEN 'removed_member' ELSE v_who END, v_count;
      END IF;
      IF v_err IS DISTINCT FROM 'enquiry_unavailable' THEN RAISE EXCEPTION 'thread_rpc_open_to:%:%', v_who, v_err; END IF;
      IF v_before <> 0 THEN RAISE EXCEPTION 'list_rpc_leaks_to:%', v_who; END IF;
    END IF;
  END LOOP;

  -- Non-readers are refused by every write RPC too, and none of them changes E1.
  FOR v_who, v_user IN
    SELECT * FROM (VALUES ('scanner', v_scanner), ('demoted', v_demoted), ('removed', v_removed),
      ('staff', v_staff), ('admin', v_admin), ('guestb', v_guestb), ('stranger', v_stranger)) AS t(w, u)
  LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    FOR i IN 1..6 LOOP
      v_err := NULL;
      BEGIN
        CASE i
          WHEN 1 THEN PERFORM public.brand_enquiry_reply(v_e1, 'Not my enquiry.');
          WHEN 2 THEN PERFORM public.brand_enquiry_set_status(v_e1, 'resolve');
          WHEN 3 THEN PERFORM public.brand_enquiry_block_sender(v_e1);
          WHEN 4 THEN PERFORM public.brand_enquiry_report(v_e1, 'Opening it to staff.');
          WHEN 5 THEN PERFORM public.brand_enquiry_guest_reply(v_e1, 'Writing as the guest.');
          WHEN 6 THEN PERFORM public.list_brand_enquiries(v_brand, 'all');
        END CASE;
      EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
      END;
      IF v_err IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'write_rpc_open:%:%:%', v_who, i, v_err; END IF;
    END LOOP;
    RESET ROLE;
  END LOOP;
  IF (SELECT reported_at FROM public.brand_enquiries WHERE id = v_e1) IS NOT NULL
     OR (SELECT status FROM public.brand_enquiries WHERE id = v_e1) <> 'replied'
     OR (SELECT count(*) FROM public.messages WHERE conversation_id = v_c1) <> 2 THEN
    RAISE EXCEPTION 'refused_writes_changed_enquiry';
  END IF;

  -- Guest A cannot see guest B's thread, and B cannot see A's.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guesta::text, true);
  SELECT count(*) INTO v_count FROM public.brand_enquiries WHERE id = v_e2;
  v_count := v_count + (SELECT count(*) FROM public.messages WHERE conversation_id = v_c2)
    + (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_c2);
  RESET ROLE;
  IF v_count <> 0 THEN RAISE EXCEPTION 'guest_reads_other_guest:%', v_count; END IF;

  -- Hijack: re-pointing one's own participant row (from a chat one does belong
  -- to) at an enquiry's conversation is refused, for a stranger and for a
  -- member who saw the conversation id before being made scanner-only.
  FOR v_user IN SELECT unnest(ARRAY[v_stranger, v_demoted, v_removed]) LOOP
    INSERT INTO public.conversations(type, linked_entity_type, created_by)
    VALUES ('direct', 'direct', v_user) RETURNING id INTO v_conv_own;
    INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv_own, v_user);
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_err := NULL;
    BEGIN
      UPDATE public.conversation_participants SET conversation_id = v_c1
      WHERE conversation_id = v_conv_own AND user_id = v_user;
    EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
    END;
    SELECT count(*) INTO v_count FROM public.messages WHERE conversation_id = v_c1;
    RESET ROLE;
    IF v_err IS DISTINCT FROM '42501' OR v_count <> 0 THEN
      RAISE EXCEPTION 'participant_row_moved_into_enquiry:%:%:%', v_user, v_err, v_count;
    END IF;
  END LOOP;
  -- The guest can still update their own row in place.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guesta::text, true);
  UPDATE public.conversation_participants SET last_read_at = now(), notifications_muted = true
  WHERE conversation_id = v_c1 AND user_id = v_guesta;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  IF v_count <> 1 THEN RAISE EXCEPTION 'guest_cannot_update_own_participation:%', v_count; END IF;

  -- Staff: only while a report is open. Guest B reports E2; staff and admin
  -- read E2 (not E1); dismissal closes it again on every path.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guestb::text, true);
  PERFORM public.brand_enquiry_report(v_e2, 'Rude replies.');
  FOR v_user IN SELECT unnest(ARRAY[v_staff, v_admin]) LOOP
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SELECT count(*) INTO v_count FROM public.messages WHERE conversation_id = v_c2;
    IF v_count = 0 THEN RESET ROLE; RAISE EXCEPTION 'staff_blind_to_open_report'; END IF;
    SELECT count(*) INTO v_count FROM public.messages WHERE conversation_id = v_c1;
    IF v_count <> 0 THEN RESET ROLE; RAISE EXCEPTION 'report_on_e2_opened_e1'; END IF;
  END LOOP;
  -- The scanner is still blind while the report is open.
  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  SELECT count(*) INTO v_count FROM public.messages WHERE conversation_id = v_c2;
  IF v_count <> 0 THEN RESET ROLE; RAISE EXCEPTION 'scanner_reads_reported'; END IF;
  -- A guest can't use admin RPCs.
  PERFORM set_config('request.jwt.claim.sub', v_guestb::text, true);
  v_err := NULL;
  BEGIN PERFORM public.admin_enquiry_dismiss_report(v_e2); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'forbidden' THEN RESET ROLE; RAISE EXCEPTION 'guest_dismissed_report:%', v_err; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_enquiry_dismiss_report(v_e2);
  FOR v_user IN SELECT unnest(ARRAY[v_staff, v_admin]) LOOP
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SELECT (SELECT count(*) FROM public.messages WHERE conversation_id = v_c2)
      + (SELECT count(*) FROM public.brand_enquiries WHERE id = v_e2)
      + (SELECT count(*) FROM public.conversations WHERE id = v_c2)
      + jsonb_array_length(public.admin_list_reported_enquiries(100))
    INTO v_count;
    v_err := NULL;
    BEGIN PERFORM public.brand_enquiry_get_thread(v_e2); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_count <> 0 OR v_err IS DISTINCT FROM 'enquiry_unavailable' THEN
      RESET ROLE; RAISE EXCEPTION 'staff_reads_after_dismissal:%:%', v_count, v_err;
    END IF;
  END LOOP;
  -- Block everywhere needs an OPEN report: a dismissed one is refused.
  v_err := NULL;
  BEGIN PERFORM public.admin_enquiry_block_everywhere(v_e2); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'report_not_found' THEN RESET ROLE; RAISE EXCEPTION 'block_everywhere_on_dismissed:%', v_err; END IF;
  RESET ROLE;

  -- ════════════════════════════════════════════════════════════════════════
  -- 3. Read receipts on enquiry messages (Explorer read status).
  -- ════════════════════════════════════════════════════════════════════════
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guesta::text, true);
  INSERT INTO public.message_reads(message_id, user_id) VALUES (v_brand_msg, v_guesta)
  ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now();
  -- The upsert path (what the app sends) runs twice without error.
  INSERT INTO public.message_reads(message_id, user_id) VALUES (v_brand_msg, v_guesta)
  ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now();
  SELECT count(*) INTO v_count FROM public.message_reads WHERE message_id = v_brand_msg AND user_id = v_guesta;
  IF v_count <> 1 THEN RESET ROLE; RAISE EXCEPTION 'guest_read_receipt_missing:%', v_count; END IF;
  -- Someone who cannot read the thread cannot write a receipt for it.
  FOR v_user IN SELECT unnest(ARRAY[v_stranger, v_guestb, v_scanner, v_staff]) LOOP
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_err := NULL;
    BEGIN
      INSERT INTO public.message_reads(message_id, user_id) VALUES (v_brand_msg, v_user);
    EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
    END;
    IF v_err IS DISTINCT FROM '42501' THEN RESET ROLE; RAISE EXCEPTION 'stranger_wrote_enquiry_read_receipt:%:%', v_user, v_err; END IF;
  END LOOP;
  -- The guest cannot point their own receipt row at someone else's message.
  RESET ROLE;
  SELECT id INTO v_e2_msg FROM public.messages WHERE conversation_id = v_c2 LIMIT 1;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_guesta::text, true);
  v_err := NULL;
  BEGIN
    UPDATE public.message_reads SET message_id = v_e2_msg
    WHERE message_id = v_brand_msg AND user_id = v_guesta;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  IF v_err IS DISTINCT FROM '42501' THEN RESET ROLE; RAISE EXCEPTION 'receipt_repointed_to_other_thread:%', v_err; END IF;
  -- Ordinary (non-enquiry) chats keep their old behaviour: the guard is scoped.
  RESET ROLE;

  -- ════════════════════════════════════════════════════════════════════════
  -- 4. Abuse: limits, blocks, moderation.
  -- ════════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  -- Per IP: five distinct senders from one IP pass, the sixth is refused.
  FOR i IN 1..6 LOOP
    v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
      'general_question', 'Same IP, different sender number ' || i, 'Ip ' || i, 'adv-ip-' || i || '@test.local', NULL, false,
      v_ip, false, '{}'::text[], encode(sha256(('adv-ip-' || i)::bytea), 'hex'), NULL, NULL);
    IF i <= 5 AND v_json->>'status' <> 'created' THEN RAISE EXCEPTION 'ip_probe_refused_early:%:%', i, v_json; END IF;
    IF i = 6 AND v_json->>'status' <> 'rate_limited' THEN RAISE EXCEPTION 'ip_limit_not_enforced:%', v_json; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.brand_enquiries WHERE guest_email = 'adv-ip-6@test.local') THEN
    RAISE EXCEPTION 'ip_limited_row_created';
  END IF;
  -- Per email across brands: ten pass (spread so the per-brand limit is not
  -- what stops it), the eleventh is refused.
  FOR i IN 1..11 LOOP
    v_json := public.issue_4111_create_web_enquiry(
      (ARRAY['4111a000-0000-4000-a900-0000000000c1','4111a000-0000-4000-a900-0000000000c2',
             '4111a000-0000-4000-a900-0000000000c3','4111a000-0000-4000-a900-0000000000c4']::uuid[])[1 + (i - 1) % 4],
      'web', NULL, 'brand_page', 'none', NULL, 'general_question', 'Same email many brands ' || i,
      'Many', 'adv-many@test.local', NULL, false, encode(sha256(('adv-many-ip-' || i)::bytea), 'hex'),
      false, '{}'::text[], encode(sha256(('adv-many-' || i)::bytea), 'hex'), NULL, NULL);
    IF i <= 10 AND v_json->>'status' <> 'created' THEN RAISE EXCEPTION 'email_probe_refused_early:%:%', i, v_json; END IF;
    IF i = 11 AND v_json->>'status' <> 'rate_limited' THEN RAISE EXCEPTION 'email_daily_limit_not_enforced:%', v_json; END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.brand_enquiries WHERE guest_email = 'adv-many@test.local';
  IF v_count <> 10 THEN RAISE EXCEPTION 'email_limit_row_count:%', v_count; END IF;
  -- Email case and spaces do not reset the counters.
  v_json := public.issue_4111_create_web_enquiry('4111a000-0000-4000-a900-0000000000c1', 'web', NULL, 'brand_page',
    'none', NULL, 'general_question', 'Upper-case evasion attempt.', 'Many', '  ADV-Many@Test.Local ', NULL, false,
    encode(sha256('adv-many-ip-x'::bytea), 'hex'), false, '{}'::text[], encode(sha256('adv-many-x'::bytea), 'hex'), NULL, NULL);
  IF v_json->>'status' <> 'rate_limited' THEN RAISE EXCEPTION 'case_evades_email_limit:%', v_json; END IF;

  -- An IP block is silent and creates nothing.
  INSERT INTO public.brand_enquiry_blocks(brand_id, ip_hash) VALUES (v_brand, repeat('d', 64));
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'From a blocked IP address.', 'Blk', 'adv-blk-ip@test.local', NULL, false,
    repeat('d', 64), false, '{}'::text[], encode(sha256('adv-blk-ip'::bytea), 'hex'), NULL, NULL);
  IF v_json->>'status' <> 'blocked' THEN RAISE EXCEPTION 'ip_block_ignored:%', v_json; END IF;

  -- Moderation flag: delivered to the inbox, but no push, no card, no nudge.
  SELECT count(*) INTO v_before FROM public.notification_outbox WHERE brand_id = v_brand;
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'Buy cheap followers now at a scam link.', 'Spammy', 'adv-spam@test.local', NULL, false,
    repeat('e', 64), true, ARRAY['spam'], v_tok_spam, NULL, NULL);
  v_spam := (v_json->>'enquiry_id')::uuid; v_spam_conv := (v_json->>'conversation_id')::uuid;
  IF v_json->>'status' <> 'created' OR NOT (SELECT spam_flag FROM public.brand_enquiries WHERE id = v_spam) THEN
    RAISE EXCEPTION 'spam_not_delivered_flagged:%', v_json;
  END IF;
  v_json := public.issue_4111_guest_post_by_token(v_tok_spam, 'And again, more spam.', repeat('e', 64));
  IF v_json->>'status' <> 'sent' THEN RAISE EXCEPTION 'spam_followup_post_failed:%', v_json; END IF;
  IF (SELECT count(*) FROM public.notification_outbox WHERE brand_id = v_brand) <> v_before THEN
    RAISE EXCEPTION 'spam_sent_push';
  END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE message_type::text = 'brand_enquiry_card'
             AND card_payload->>'enquiry_id' = v_spam::text) THEN
    RAISE EXCEPTION 'spam_sent_card';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_json := public.list_brand_enquiries(v_brand, 'all');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_json->'items') item
                 WHERE item->>'id' = v_spam::text AND (item->>'spam_flag')::boolean) THEN
    RESET ROLE; RAISE EXCEPTION 'spam_missing_from_inbox';
  END IF;
  v_count := (v_json->'counts'->>'needs_reply')::bigint;
  SELECT count(*) INTO v_before FROM public.brand_enquiries
  WHERE brand_id = v_brand AND status IN ('new','waiting') AND NOT spam_flag;
  RESET ROLE;
  IF v_count <> v_before THEN RAISE EXCEPTION 'spam_counted_in_badge:%:%', v_count, v_before; END IF;

  -- Global block (Admin "Block everywhere") stops the guest on EVERY brand,
  -- signed in or not. Guest A is reported by the team, then blocked by staff.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM public.brand_enquiry_report(v_e1, 'Abusive.');
  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  PERFORM public.admin_enquiry_block_everywhere(v_e1);
  PERFORM set_config('request.jwt.claim.sub', v_guesta::text, true);
  v_err := NULL;
  BEGIN
    PERFORM public.brand_enquiry_send(v_brand_b, 'brand_page', 'none', NULL, 'general_question', 'Trying another brand after a global block.');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'enquiries_unavailable' THEN RESET ROLE; RAISE EXCEPTION 'global_block_ignored_signed_in:%', v_err; END IF;
  v_err := NULL;
  BEGIN PERFORM public.brand_enquiry_guest_reply(v_e1, 'Still here.'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'enquiry_unavailable' THEN RESET ROLE; RAISE EXCEPTION 'global_block_reply_allowed:%', v_err; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_json := public.issue_4111_create_web_enquiry(v_brand_b, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'Signed out, other brand, globally blocked.', 'Gia', 'Adv-GuestA@test.local', NULL, false,
    repeat('f', 64), false, '{}'::text[], encode(sha256('adv-global'::bytea), 'hex'), NULL, NULL);
  IF v_json->>'status' <> 'blocked' THEN RAISE EXCEPTION 'global_block_ignored_web:%', v_json; END IF;
  IF EXISTS (SELECT 1 FROM public.brand_enquiries WHERE brand_id = v_brand_b) THEN
    RAISE EXCEPTION 'global_block_left_rows';
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 5. Tokens: no cross-thread use, expired is refused for read AND write.
  -- ════════════════════════════════════════════════════════════════════════
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'venue', v_venue,
    'table_reservation', 'Web guest one wants a table.', 'Wun', 'adv-w1@test.local', '+14155550111', true,
    repeat('1', 64), false, '{}'::text[], v_tok_w1, NULL, NULL);
  v_w1 := (v_json->>'enquiry_id')::uuid;
  v_json := public.issue_4111_create_web_enquiry(v_brand, 'web', NULL, 'brand_page', 'none', NULL,
    'general_question', 'Web guest two has a question.', 'Two', 'adv-w2@test.local', NULL, false,
    repeat('2', 64), false, '{}'::text[], v_tok_w2, NULL, NULL);
  v_w2 := (v_json->>'enquiry_id')::uuid;
  IF v_w1 IS NULL OR v_w2 IS NULL THEN RAISE EXCEPTION 'web_fixture_failed:%', v_json; END IF;
  v_json := public.issue_4111_guest_post_by_token(v_tok_w1, 'Written with token one.', NULL);
  IF (SELECT count(*) FROM public.messages m JOIN public.brand_enquiries e ON e.conversation_id = m.conversation_id
      WHERE e.id = v_w2 AND m.content = 'Written with token one.') <> 0 THEN
    RAISE EXCEPTION 'token_crossed_threads';
  END IF;
  -- The guest view never carries the guest's email, phone or team identity.
  v_json := public.issue_4111_thread_by_token(v_tok_w1);
  IF v_json::text ~* 'adv-w1@test.local|4155550111|adv-member@|adv-owner@' THEN
    RAISE EXCEPTION 'guest_view_leaks_contact:%', v_json;
  END IF;
  IF (v_json->'enquiry'->'guest') ? 'email' OR (v_json->'enquiry'->'guest') ? 'phone' THEN
    RAISE EXCEPTION 'guest_view_has_contact_keys';
  END IF;
  UPDATE public.brand_enquiry_access_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = v_tok_w2;
  SELECT count(*) INTO v_before FROM public.messages m JOIN public.brand_enquiries e ON e.conversation_id = m.conversation_id WHERE e.id = v_w2;
  v_json := public.issue_4111_guest_post_by_token(v_tok_w2, 'Posting with an expired link.', NULL);
  IF v_json->>'status' <> 'expired' THEN RAISE EXCEPTION 'expired_post_not_refused:%', v_json; END IF;
  IF (SELECT count(*) FROM public.messages m JOIN public.brand_enquiries e ON e.conversation_id = m.conversation_id WHERE e.id = v_w2) <> v_before THEN
    RAISE EXCEPTION 'expired_post_wrote';
  END IF;
  IF public.issue_4111_thread_by_token(v_tok_w2)->>'status' <> 'expired'
     OR (SELECT expires_at FROM public.brand_enquiry_access_tokens WHERE token_hash = v_tok_w2) > now() THEN
    RAISE EXCEPTION 'expired_token_revived';
  END IF;
  -- Garbage tokens are invalid, never an error.
  IF public.issue_4111_thread_by_token('not-a-hash')->>'status' <> 'invalid'
     OR public.issue_4111_guest_post_by_token(repeat('0', 64), 'x', NULL)->>'status' <> 'invalid' THEN
    RAISE EXCEPTION 'garbage_token_not_invalid';
  END IF;
  -- "Email me a new link" with the wrong email, or someone else's enquiry id, issues nothing.
  IF public.issue_4111_reissue_link('adv-w1@test.local', v_w2, v_tok_new, NULL)->>'status' <> 'none'
     OR public.issue_4111_reissue_link('nobody@test.local', NULL, v_tok_new, NULL)->>'status' <> 'none'
     OR EXISTS (SELECT 1 FROM public.brand_enquiry_access_tokens WHERE token_hash = v_tok_new) THEN
    RAISE EXCEPTION 'new_link_issued_to_wrong_owner';
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 6. Notification payloads never carry guest email or phone.
  -- ════════════════════════════════════════════════════════════════════════
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox o
    WHERE o.category_key LIKE '%brand_enquiry%'
      AND o.payload::text ~* '@test\.local|\+1415555|guest_email|guest_phone'
  ) THEN
    RAISE EXCEPTION 'outbox_payload_leaks_contact';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.messages m WHERE m.message_type::text = 'brand_enquiry_card'
      AND (m.content || COALESCE(m.card_payload::text, '')) ~* 'Gia|Gib|Wun|@test\.local'
  ) THEN
    RAISE EXCEPTION 'brand_group_card_names_guest';
  END IF;
  -- Scanners and removed members get no enquiry push.
  -- (The demoted and removed members were still on the team when E1 and E2
  -- arrived; everything after their change must skip them.)
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key LIKE 'business.brand_enquiry%'
             AND (user_id IN (v_scanner, v_staff, v_admin)
                  OR (user_id IN (v_demoted, v_removed)
                      AND payload->>'enquiry_id' NOT IN (v_e1::text, v_e2::text)))) THEN
    RAISE EXCEPTION 'enquiry_push_to_non_team';
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 7. Status machine boundaries.
  -- ════════════════════════════════════════════════════════════════════════
  -- A second guest message while 'new' stays 'new' (still waiting for a first reply).
  PERFORM public.issue_4111_guest_post_by_token(v_tok_w1, 'Second note before any reply.', NULL);
  IF (SELECT status FROM public.brand_enquiries WHERE id = v_w1) <> 'new' THEN RAISE EXCEPTION 'new_left_new_on_guest_message'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  -- Reopen with no brand reply ever → new; invalid action refused.
  PERFORM public.brand_enquiry_set_status(v_w1, 'resolve');
  IF public.brand_enquiry_set_status(v_w1, 'reopen') <> 'new' THEN RESET ROLE; RAISE EXCEPTION 'reopen_without_reply_not_new'; END IF;
  v_err := NULL;
  BEGIN PERFORM public.brand_enquiry_set_status(v_w1, 'delete'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'invalid_action' THEN RESET ROLE; RAISE EXCEPTION 'bad_action_accepted:%', v_err; END IF;
  PERFORM public.brand_enquiry_reply(v_w1, 'We have a table for you.');
  IF (SELECT status FROM public.brand_enquiries WHERE id = v_w1) <> 'replied' THEN RESET ROLE; RAISE EXCEPTION 'reply_not_replied'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM public.issue_4111_guest_post_by_token(v_tok_w1, 'Thanks, one more question.', NULL);
  IF (SELECT status FROM public.brand_enquiries WHERE id = v_w1) <> 'waiting' THEN RAISE EXCEPTION 'guest_after_reply_not_waiting'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.brand_enquiry_set_status(v_w1, 'resolve');
  -- Reopen when the guest wrote last → waiting.
  IF public.brand_enquiry_set_status(v_w1, 'reopen') <> 'waiting' THEN RESET ROLE; RAISE EXCEPTION 'reopen_after_guest_not_waiting'; END IF;
  PERFORM public.brand_enquiry_set_status(v_w1, 'resolve');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM public.issue_4111_guest_post_by_token(v_tok_w1, 'Writing again reopens it.', NULL);
  IF (SELECT status || ':' || (resolved_at IS NULL)::text FROM public.brand_enquiries WHERE id = v_w1) <> 'waiting:true' THEN
    RAISE EXCEPTION 'guest_on_resolved_not_reopened';
  END IF;

  -- Auto-resolve: 29 idle days stays open, 31 resolves, an old guest message
  -- with a recent brand reply is not idle, an already-resolved row keeps its time.
  UPDATE public.brand_enquiries SET last_guest_at = now() - interval '29 days', last_brand_at = NULL,
    status = 'waiting' WHERE id = v_w2;
  UPDATE public.brand_enquiries SET last_guest_at = now() - interval '40 days', last_brand_at = now() - interval '1 day',
    status = 'replied' WHERE id = v_w1;
  UPDATE public.brand_enquiries SET last_guest_at = now() - interval '31 days', last_brand_at = NULL WHERE id = v_spam;
  UPDATE public.brand_enquiries SET status = 'resolved', resolved_at = now() - interval '60 days',
    last_guest_at = now() - interval '90 days', last_brand_at = NULL WHERE id = v_e2;
  PERFORM public.issue_4111_auto_resolve_idle_enquiries();
  IF (SELECT status FROM public.brand_enquiries WHERE id = v_w2) <> 'waiting' THEN RAISE EXCEPTION 'auto_resolved_at_29_days'; END IF;
  IF (SELECT status FROM public.brand_enquiries WHERE id = v_w1) <> 'replied' THEN RAISE EXCEPTION 'auto_resolved_recent_brand_reply'; END IF;
  IF (SELECT status FROM public.brand_enquiries WHERE id = v_spam) <> 'resolved' THEN RAISE EXCEPTION 'not_auto_resolved_at_31_days'; END IF;
  IF (SELECT resolved_at FROM public.brand_enquiries WHERE id = v_e2) > now() - interval '59 days' THEN
    RAISE EXCEPTION 'auto_resolve_rewrote_resolved_time';
  END IF;

  -- Nudge: 23h no, 25h yes, once; brand replied after the guest no; scanner never.
  UPDATE public.brand_enquiries SET nudged_at = now() WHERE brand_id = v_brand AND id NOT IN (v_w1, v_w2);
  UPDATE public.brand_enquiries SET status = 'waiting', last_guest_at = now() - interval '23 hours', last_brand_at = NULL WHERE id = v_w2;
  UPDATE public.brand_enquiries SET status = 'waiting', last_guest_at = now() - interval '25 hours',
    last_brand_at = now() - interval '24 hours' WHERE id = v_w1;
  PERFORM public.issue_4111_enquiry_nudge_sweep();
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'business.brand_enquiry_nudge') THEN
    RAISE EXCEPTION 'nudged_too_early_or_after_reply';
  END IF;
  UPDATE public.brand_enquiries SET last_guest_at = now() - interval '25 hours' WHERE id = v_w2;
  PERFORM public.issue_4111_enquiry_nudge_sweep();
  SELECT count(*) INTO v_count FROM public.notification_outbox
  WHERE category_key = 'business.brand_enquiry_nudge' AND payload->>'enquiry_id' = v_w2::text;
  -- owner + member (eligible team) + the brand contact box = 3
  IF v_count <> 3 THEN RAISE EXCEPTION 'nudge_recipients_wrong:%', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'business.brand_enquiry_nudge'
             AND user_id IN (v_scanner, v_demoted, v_removed)) THEN
    RAISE EXCEPTION 'nudge_to_non_team';
  END IF;
  -- The guest writes again and waits another 25h: still exactly one nudge.
  UPDATE public.brand_enquiries SET last_guest_at = now() - interval '26 hours' WHERE id = v_w2;
  PERFORM public.issue_4111_enquiry_nudge_sweep();
  PERFORM public.issue_4111_enquiry_nudge_sweep();
  SELECT count(*) INTO v_count FROM public.notification_outbox
  WHERE category_key = 'business.brand_enquiry_nudge' AND payload->>'enquiry_id' = v_w2::text;
  IF v_count <> 3 THEN RAISE EXCEPTION 'nudge_fired_twice:%', v_count; END IF;

  -- Guest digest: at most once per 10 minutes, only new brand messages.
  UPDATE public.brand_enquiries SET guest_emailed_at = now() WHERE guest_user_id IS NULL;
  UPDATE public.brand_enquiries SET last_brand_at = clock_timestamp(), guest_emailed_at = NULL WHERE id = v_w1;
  v_json := public.issue_4111_claim_guest_digests(100);
  IF jsonb_array_length(v_json) <> 1 OR v_json->0->>'enquiry_id' <> v_w1::text THEN
    RAISE EXCEPTION 'digest_first_claim_wrong:%', v_json;
  END IF;
  UPDATE public.brand_enquiries SET last_brand_at = clock_timestamp() + interval '1 second' WHERE id = v_w1;
  IF jsonb_array_length(public.issue_4111_claim_guest_digests(100)) <> 0 THEN
    RAISE EXCEPTION 'digest_inside_10_minutes';
  END IF;
  UPDATE public.brand_enquiries SET guest_emailed_at = now() - interval '9 minutes' WHERE id = v_w1;
  IF jsonb_array_length(public.issue_4111_claim_guest_digests(100)) <> 0 THEN
    RAISE EXCEPTION 'digest_at_9_minutes';
  END IF;
  UPDATE public.brand_enquiries SET guest_emailed_at = now() - interval '11 minutes' WHERE id = v_w1;
  v_json := public.issue_4111_claim_guest_digests(100);
  IF jsonb_array_length(v_json) <> 1 THEN RAISE EXCEPTION 'digest_missing_after_10_minutes:%', v_json; END IF;
  -- A failed send restores the previous time so the next run retries.
  PERFORM public.issue_4111_complete_guest_digest(v_w1, NULL, false, (v_json->0->>'previous_emailed_at')::timestamptz);
  IF (SELECT guest_emailed_at FROM public.brand_enquiries WHERE id = v_w1) > now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'digest_failure_not_restored';
  END IF;
  -- A globally/brand blocked guest gets no digest.
  INSERT INTO public.brand_enquiry_blocks(brand_id, email_hash) VALUES (NULL, public.issue_4111_email_hash('adv-w1@test.local'));
  IF jsonb_array_length(public.issue_4111_claim_guest_digests(100)) <> 0 THEN RAISE EXCEPTION 'digest_to_blocked_guest'; END IF;
  -- … and a blocked web guest's post is silently dropped.
  SELECT count(*) INTO v_before FROM public.messages m WHERE m.conversation_id = (SELECT conversation_id FROM public.brand_enquiries WHERE id = v_w1);
  IF public.issue_4111_guest_post_by_token(v_tok_w1, 'Blocked guest writes.', NULL)->>'status' <> 'blocked'
     OR (SELECT count(*) FROM public.messages m WHERE m.conversation_id = (SELECT conversation_id FROM public.brand_enquiries WHERE id = v_w1)) <> v_before THEN
    RAISE EXCEPTION 'blocked_web_post_written';
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 8. Subscribe: the text link proves the phone, not the email.
  -- ════════════════════════════════════════════════════════════════════════
  -- Someone types the victim's (account) email with THEIR OWN phone and taps
  -- the text link they receive. The victim never confirmed anything.
  v_json := public.issue_4111_create_subscribe_pending(v_brand, 'web', NULL, 'adv-victim@test.local', '+14155550199', true,
    encode(sha256('adv-sub-email'::bytea), 'hex'), encode(sha256('adv-sub-sms'::bytea), 'hex'),
    repeat('9', 64), 'Disclosure', 'v1', 'SMS disclosure');
  IF v_json->>'status' <> 'created' OR (v_json->>'send_sms')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'sub_fixture_failed:%', v_json;
  END IF;
  -- Before any link: nothing on.
  IF EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = v_victim AND brand_id = v_brand)
     OR EXISTS (SELECT 1 FROM public.brand_person_contact_methods WHERE brand_id = v_brand AND normalized_value = '+14155550199') THEN
    RAISE EXCEPTION 'subscribed_before_any_link';
  END IF;
  v_json := public.issue_4111_confirm_subscribe(encode(sha256('adv-sub-sms'::bytea), 'hex'));
  IF v_json->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'sms_confirm_failed:%', v_json; END IF;
  IF EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = v_victim AND brand_id = v_brand)
     OR EXISTS (SELECT 1 FROM public.brand_follow_channel_prefs WHERE user_id = v_victim AND brand_id = v_brand AND enabled)
     OR EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = v_victim AND brand_id = v_brand) THEN
    RAISE EXCEPTION 'sms_link_followed_unproven_account';
  END IF;
  -- The phone that was proven is subscribed (marketing consent recorded for it).
  IF NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods WHERE brand_id = v_brand
                 AND channel = 'phone' AND normalized_value = '+14155550199' AND marketing_consent_state = 'granted') THEN
    RAISE EXCEPTION 'proven_phone_not_subscribed';
  END IF;
  -- When the victim then taps the EMAIL link themselves, they follow with email on, and SMS stays off for the account.
  v_json := public.issue_4111_confirm_subscribe(encode(sha256('adv-sub-email'::bytea), 'hex'));
  IF v_json->>'outcome' <> 'followed' THEN RAISE EXCEPTION 'email_confirm_not_followed:%', v_json; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_follow_channel_prefs WHERE user_id = v_victim AND brand_id = v_brand AND channel = 'email' AND enabled)
     OR EXISTS (SELECT 1 FROM public.brand_follow_channel_prefs WHERE user_id = v_victim AND brand_id = v_brand AND channel = 'sms' AND enabled) THEN
    RAISE EXCEPTION 'email_link_channel_prefs_wrong';
  END IF;

  -- Expired pending: no follow, no contact.
  v_json := public.issue_4111_create_subscribe_pending(v_brand_b, 'web', NULL, 'adv-late@test.local', NULL, false,
    encode(sha256('adv-sub-late'::bytea), 'hex'), NULL, NULL, 'Disclosure', 'v1', NULL);
  UPDATE public.brand_subscribe_pending SET expires_at = now() - interval '1 second' WHERE email = 'adv-late@test.local';
  IF public.issue_4111_confirm_subscribe(encode(sha256('adv-sub-late'::bytea), 'hex'))->>'status' <> 'expired'
     OR EXISTS (SELECT 1 FROM public.brand_person_contact_methods WHERE normalized_value = 'adv-late@test.local') THEN
    RAISE EXCEPTION 'expired_subscribe_confirmed';
  END IF;

  -- The SMS cap is counted: at 100 texts this month no new link is texted.
  INSERT INTO public.brand_subscribe_pending(brand_id, email, phone_e164, wants_sms, email_token_hash, sms_token_hash,
    sms_sent_at, disclosure_text, disclosure_version, expires_at)
  SELECT v_brand_b, 'adv-cap-' || g || '@test.local', '+1415555' || lpad(g::text, 4, '0'), true,
    encode(sha256(('adv-cap-e-' || g)::bytea), 'hex'), encode(sha256(('adv-cap-s-' || g)::bytea), 'hex'),
    now(), 'Disclosure', 'v1', now() + interval '72 hours'
  FROM generate_series(1, 100) g;
  v_json := public.issue_4111_create_subscribe_pending(v_brand_b, 'web', NULL, 'adv-cap-over@test.local', '+14155559999', true,
    encode(sha256('adv-cap-over-e'::bytea), 'hex'), encode(sha256('adv-cap-over-s'::bytea), 'hex'),
    repeat('8', 64), 'Disclosure', 'v1', 'SMS disclosure');
  IF v_json->>'status' <> 'created' OR (v_json->>'send_sms')::boolean IS NOT FALSE
     OR EXISTS (SELECT 1 FROM public.brand_subscribe_pending WHERE email = 'adv-cap-over@test.local'
                AND (sms_sent_at IS NOT NULL OR sms_token_hash IS NOT NULL)) THEN
    RAISE EXCEPTION 'sms_cap_not_enforced:%', v_json;
  END IF;
  IF public.issue_4111_subscribe_sms_used(v_brand_b) <> 100 THEN RAISE EXCEPTION 'sms_cap_count_wrong'; END IF;
  -- An unsent text link cannot be confirmed.
  IF public.issue_4111_confirm_subscribe(encode(sha256('adv-cap-over-s'::bytea), 'hex'))->>'status' <> 'invalid' THEN
    RAISE EXCEPTION 'unsent_sms_link_confirmed';
  END IF;

  -- Account and non-account emails get the same answer shape from the pending step.
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.issue_4111_create_subscribe_pending(v_brand, 'web', NULL,
        'adv-stranger@test.local', NULL, false, encode(sha256('adv-shape-a'::bytea), 'hex'), NULL, NULL, 'D', 'v1', NULL)) k)
     IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.issue_4111_create_subscribe_pending(v_brand, 'web', NULL,
        'adv-nobody-at-all@test.local', NULL, false, encode(sha256('adv-shape-b'::bytea), 'hex'), NULL, NULL, 'D', 'v1', NULL)) k) THEN
    RAISE EXCEPTION 'pending_shape_reveals_account';
  END IF;
END;
$proof$;

ROLLBACK;
