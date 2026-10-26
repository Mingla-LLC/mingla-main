-- #4111 Wave C — the Brand-group enquiry card names nobody and is never unread.
-- FAILS-ON-REVERT: restoring the Wave A card in issue_4111_open_enquiry (guest
-- name in content and card_payload) raises card_names_guest; dropping the
-- message_type filter from issue_3720_list_brand_groups raises
-- card_counted_as_unread.
-- MINGLA-INVARIANT: I-4111-ENQUIRY-CARD-NO-GUEST-NAME | issue #4111 | Brand-group enquiry cards never carry the guest name; staff and scanners read Brand groups.
-- MINGLA-INVARIANT: I-4111-ENQUIRY-CARD-NOT-UNREAD | issue #4111 | Enquiry cards never count toward Brand-group unread.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t4111c_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t4111c_people VALUES
  ('owner',   '4111c000-0000-4000-b800-000000000001', 'card-owner@test.local',   'Olu'),
  ('member',  '4111c000-0000-4000-b800-000000000002', 'card-member@test.local',  'Mina'),
  ('scanner', '4111c000-0000-4000-b800-000000000003', 'card-scanner@test.local', 'Sade'),
  ('staff',   '4111c000-0000-4000-b800-000000000004', 'card-staff@test.local',   'Stan'),
  ('guest',   '4111c000-0000-4000-b800-000000000006', 'card-guest@test.local',   'Zebedee');

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT id, email, now(), jsonb_build_object('full_name', first_name) FROM t4111c_people;
INSERT INTO public.profiles(id, email, first_name, last_name, display_name, username, account_type)
SELECT id, email, first_name, 'Quartermain', first_name || ' Quartermain', 'issue4111c_' || who, 'business'
FROM t4111c_people;
INSERT INTO public.creator_accounts(id, email, display_name, business_name)
SELECT id, email, first_name, 'Issue 4111 Card Host' FROM t4111c_people WHERE who = 'owner';
INSERT INTO public.support_staff(user_id, enabled, available, display_name, role)
SELECT id, true, true, first_name, 'staff' FROM t4111c_people WHERE who = 'staff';
INSERT INTO public.admin_team_members(email, role, status, accepted_at)
SELECT email, 'growth', 'active', now() FROM t4111c_people WHERE who = 'staff';

INSERT INTO public.brands(id, account_id, name, slug, contact_email, default_currency) VALUES
  ('4111c000-0000-4000-b900-0000000000a1', '4111c000-0000-4000-b800-000000000001', 'Card Room', 'issue-4111-card-room', NULL, 'USD');
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
SELECT '4111c000-0000-4000-b900-0000000000a1', id,
  CASE who WHEN 'member' THEN 'marketing_manager' ELSE 'scanner' END, now()
FROM t4111c_people WHERE who IN ('member', 'scanner');

DO $proof$
DECLARE
  v_brand constant uuid := '4111c000-0000-4000-b900-0000000000a1';
  v_owner constant uuid := '4111c000-0000-4000-b800-000000000001';
  v_member constant uuid := '4111c000-0000-4000-b800-000000000002';
  v_scanner constant uuid := '4111c000-0000-4000-b800-000000000003';
  v_staff constant uuid := '4111c000-0000-4000-b800-000000000004';
  v_guest constant uuid := '4111c000-0000-4000-b800-000000000006';
  v_sent jsonb;
  v_enquiry uuid;
  v_group uuid;
  v_count bigint;
  v_err text;
  v_row record;
  v_user uuid;
BEGIN
  -- The guest (an Explorer user named "Zebedee Quartermain") sends an enquiry.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  v_sent := public.brand_enquiry_send(v_brand, 'brand_page', 'none', NULL, 'private_hire',
    'Hello, can we book the whole room for twelve people?');
  v_enquiry := (v_sent->>'enquiry_id')::uuid;
  RESET ROLE;

  SELECT id INTO STRICT v_group FROM public.conversations
  WHERE linked_entity_type = 'brand' AND brand_id = v_brand;

  -- (a) The stored card: topic only.
  SELECT count(*) INTO v_count FROM public.messages
  WHERE conversation_id = v_group AND message_type = 'brand_enquiry_card'
    AND card_payload->>'enquiry_id' = v_enquiry::text;
  IF v_count <> 1 THEN RAISE EXCEPTION 'card_missing:%', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.messages
    WHERE conversation_id = v_group AND message_type = 'brand_enquiry_card'
      AND (content ILIKE '%Zebedee%' OR content ILIKE '%Quartermain%'
        OR card_payload::text ILIKE '%Zebedee%' OR card_payload ? 'guest_name')) THEN
    RAISE EXCEPTION 'card_names_guest';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages
    WHERE conversation_id = v_group AND message_type = 'brand_enquiry_card'
      AND content = 'New customer enquiry · Private hire or big group'
      AND card_payload->>'topic_label' = 'Private hire or big group') THEN
    RAISE EXCEPTION 'card_copy_wrong';
  END IF;

  -- Everyone who can read the Brand group (team, scanner, staff) sees a card
  -- that names nobody, with the enquiry id the Host app needs for Open.
  FOR v_user IN SELECT unnest(ARRAY[v_owner, v_member, v_scanner, v_staff]) LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SELECT * INTO v_row FROM public.issue_3720_list_brand_group_messages(v_group, 80, NULL) m
    WHERE m.message_type = 'brand_enquiry_card';
    IF NOT FOUND THEN RAISE EXCEPTION 'card_not_listed_for:%', v_user; END IF;
    IF v_row.card_payload->>'enquiry_id' IS DISTINCT FROM v_enquiry::text
       OR v_row.card_payload ? 'guest_name'
       OR concat_ws(' ', v_row.content, v_row.sender_display_name, v_row.card_payload::text) ILIKE '%Zebedee%' THEN
      RAISE EXCEPTION 'listed_card_wrong_for:%:%', v_user, row_to_json(v_row);
    END IF;
    SELECT count(*) INTO v_count FROM public.issue_3720_list_brand_groups() g
    WHERE g.conversation_id = v_group AND g.last_message_preview ILIKE '%Zebedee%';
    IF v_count <> 0 THEN RAISE EXCEPTION 'group_preview_names_guest_for:%', v_user; END IF;
    RESET ROLE;
  END LOOP;

  -- Opening the enquiry is still gated: staff and scanners are refused.
  FOR v_user IN SELECT unnest(ARRAY[v_scanner, v_staff]) LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_err := NULL;
    BEGIN PERFORM public.brand_enquiry_get_thread(v_enquiry, 50); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    RESET ROLE;
    IF v_err IS DISTINCT FROM 'enquiry_unavailable' THEN RAISE EXCEPTION 'open_not_gated_for:%:%', v_user, v_err; END IF;
  END LOOP;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF public.brand_enquiry_get_thread(v_enquiry, 50)->'enquiry'->'guest'->>'name' IS DISTINCT FROM 'Zebedee Quartermain' THEN
    RAISE EXCEPTION 'team_open_lost_guest_name';
  END IF;

  -- (b) The card is never unread for the team.
  SELECT g.unread_count INTO v_count FROM public.issue_3720_list_brand_groups() g WHERE g.conversation_id = v_group;
  IF v_count IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'card_counted_as_unread:%', v_count; END IF;
  RESET ROLE;

  -- A real teammate message still counts, so the filter is only the card.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, created_at)
  VALUES (v_group, v_member, 'Sound check at 7', 'text', clock_timestamp());
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT g.unread_count INTO v_count FROM public.issue_3720_list_brand_groups() g WHERE g.conversation_id = v_group;
  IF v_count IS DISTINCT FROM 1::bigint THEN RAISE EXCEPTION 'teammate_message_not_unread:%', v_count; END IF;
  RESET ROLE;
END;
$proof$;

ROLLBACK;
