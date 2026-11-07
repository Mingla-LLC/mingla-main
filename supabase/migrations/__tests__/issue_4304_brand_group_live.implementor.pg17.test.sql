-- #4304 part 2 — Brand-group reactions, seen-by read state and inbox last speaker.
-- FAILS-ON-REVERT (measured on a local pg17 replay): dropping
-- brand_group_reactions_scoped_insert accepts an unoffered emoji
-- (unoffered_emoji_accepted); dropping brand_group_reactions_read refuses
-- Support's reaction, which has no roster row (support_reaction_refused);
-- removing the roster join from issue_4304_list_brand_group_read_state lists
-- Support (read_state_lists_support); removing the new list columns raises
-- inbox_last_speaker_wrong.
-- MINGLA-INVARIANT: I-4304-BRAND-GROUP-REACTIONS-SCOPED | issue #4304 | A reaction on a Brand-group message can be read or written only by someone who can access that Brand group, and only with an offered emoji.
-- MINGLA-INVARIANT: I-4304-BRAND-GROUP-SEEN-BY-ROSTER | issue #4304 | Brand-group read state is returned only to someone who can access the group, and lists only current accepted teammates other than the caller.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t4304_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t4304_people VALUES
  ('owner',    '43040000-0000-4000-b800-000000000001', 'live-owner-4304@test.local',    'Ada'),
  ('member',   '43040000-0000-4000-b800-000000000002', 'live-member-4304@test.local',   'Kim'),
  ('staff',    '43040000-0000-4000-b800-000000000003', 'live-staff-4304@test.local',    'Stan'),
  ('outsider', '43040000-0000-4000-b800-000000000004', 'live-outsider-4304@test.local', 'Oscar');

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT id, email, now(), jsonb_build_object('full_name', first_name) FROM t4304_people;
INSERT INTO public.profiles(id, email, first_name, last_name, display_name, username, account_type)
SELECT id, email, first_name, 'Live', first_name || ' Live', 'issue4304_' || who, 'business'
FROM t4304_people;
INSERT INTO public.creator_accounts(id, email, display_name, business_name)
SELECT id, email, first_name, 'Issue 4304 Live Host' FROM t4304_people WHERE who = 'owner';
INSERT INTO public.support_staff(user_id, enabled, available, display_name, role)
SELECT id, true, true, first_name, 'staff' FROM t4304_people WHERE who = 'staff';
INSERT INTO public.admin_team_members(email, role, status, accepted_at)
SELECT email, 'growth', 'active', now() FROM t4304_people WHERE who = 'staff';

INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('43040000-0000-4000-b900-0000000000a1', '43040000-0000-4000-b800-000000000001', 'Live Room', 'issue-4304-live-room', 'USD');
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
SELECT '43040000-0000-4000-b900-0000000000a1', id, 'marketing_manager', now()
FROM t4304_people WHERE who = 'member';

CREATE FUNCTION pg_temp.t4304_as(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $function$
DECLARE v_result text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  EXECUTE p_sql INTO v_result;
  RESET ROLE;
  RETURN 'OK:' || COALESCE(v_result, '');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$function$;

DO $proof$
DECLARE
  v_owner constant uuid := '43040000-0000-4000-b800-000000000001';
  v_member constant uuid := '43040000-0000-4000-b800-000000000002';
  v_staff constant uuid := '43040000-0000-4000-b800-000000000003';
  v_outsider constant uuid := '43040000-0000-4000-b800-000000000004';
  v_group uuid;
  v_message uuid;
  v_result text;
  v_row record;
BEGIN
  SELECT id INTO STRICT v_group FROM public.conversations
  WHERE linked_entity_type = 'brand' AND brand_id = '43040000-0000-4000-b900-0000000000a1';

  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, created_at)
  VALUES (v_group, v_member, 'Doors at 7?', 'text', clock_timestamp())
  RETURNING id INTO v_message;

  -- (1) Reactions: a teammate reacts with an offered emoji.
  v_result := pg_temp.t4304_as(v_member, format(
    'INSERT INTO public.direct_message_reactions(message_id,user_id,emoji) VALUES (%L,%L,%L) RETURNING id::text',
    v_message, v_member, '❤️'));
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'member_reaction_refused:%', v_result; END IF;

  -- Support reacts without a roster row.
  v_result := pg_temp.t4304_as(v_staff, format(
    'INSERT INTO public.direct_message_reactions(message_id,user_id,emoji) VALUES (%L,%L,%L) RETURNING id::text',
    v_message, v_staff, '👍'));
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'support_reaction_refused:%', v_result; END IF;

  -- An outsider cannot react to a Brand-group message.
  v_result := pg_temp.t4304_as(v_outsider, format(
    'INSERT INTO public.direct_message_reactions(message_id,user_id,emoji) VALUES (%L,%L,%L) RETURNING id::text',
    v_message, v_outsider, '❤️'));
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'outsider_reacted:%', v_result; END IF;

  -- An emoji the app does not offer is refused in a Brand group.
  v_result := pg_temp.t4304_as(v_member, format(
    'INSERT INTO public.direct_message_reactions(message_id,user_id,emoji) VALUES (%L,%L,%L) RETURNING id::text',
    v_message, v_member, '🍕'));
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'unoffered_emoji_accepted:%', v_result; END IF;

  -- Everyone who can read the group sees both reactions; the outsider sees none.
  v_result := pg_temp.t4304_as(v_staff, format(
    'SELECT count(*)::text FROM public.direct_message_reactions WHERE message_id=%L', v_message));
  IF v_result <> 'OK:2' THEN RAISE EXCEPTION 'support_cannot_see_reaction:%', v_result; END IF;
  v_result := pg_temp.t4304_as(v_owner, format(
    'SELECT count(*)::text FROM public.direct_message_reactions WHERE message_id=%L', v_message));
  IF v_result <> 'OK:2' THEN RAISE EXCEPTION 'owner_cannot_see_reaction:%', v_result; END IF;
  v_result := pg_temp.t4304_as(v_outsider, format(
    'SELECT count(*)::text FROM public.direct_message_reactions WHERE message_id=%L', v_message));
  IF v_result <> 'OK:0' THEN RAISE EXCEPTION 'outsider_sees_reaction:%', v_result; END IF;

  -- A teammate removes their own reaction.
  v_result := pg_temp.t4304_as(v_member, format(
    'WITH gone AS (DELETE FROM public.direct_message_reactions WHERE message_id=%L AND user_id=%L RETURNING 1) SELECT count(*)::text FROM gone',
    v_message, v_member));
  IF v_result <> 'OK:1' THEN RAISE EXCEPTION 'member_unreact_failed:%', v_result; END IF;

  -- (2) Seen-by: owner and Support read; the member sees only the owner.
  PERFORM pg_temp.t4304_as(v_owner, format('SELECT public.issue_3720_mark_brand_group_read(%L)::text', v_group));
  PERFORM pg_temp.t4304_as(v_staff, format('SELECT public.issue_3720_mark_brand_group_read(%L)::text', v_group));
  v_result := pg_temp.t4304_as(v_member, format(
    'SELECT jsonb_agg(jsonb_build_object(''user_id'',r.user_id,''name'',r.display_name))::text FROM public.issue_4304_list_brand_group_read_state(%L) r',
    v_group));
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'member_read_state_failed:%', v_result; END IF;
  IF v_result NOT LIKE '%' || v_owner::text || '%' OR v_result NOT LIKE '%Ada Live%' THEN
    RAISE EXCEPTION 'read_state_missing_owner:%', v_result;
  END IF;
  IF v_result LIKE '%' || v_staff::text || '%' THEN RAISE EXCEPTION 'read_state_lists_support:%', v_result; END IF;
  IF v_result LIKE '%' || v_member::text || '%' THEN RAISE EXCEPTION 'read_state_lists_caller:%', v_result; END IF;

  v_result := pg_temp.t4304_as(v_outsider, format(
    'SELECT count(*)::text FROM public.issue_4304_list_brand_group_read_state(%L)', v_group));
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'outsider_read_state_not_refused:%', v_result; END IF;

  -- (3) Inbox: last speaker and type.
  v_result := pg_temp.t4304_as(v_owner, format(
    'SELECT concat_ws(''|'',g.last_message_sender_id,g.last_message_sender_name,g.last_message_type) FROM public.issue_3720_list_brand_groups() g WHERE g.conversation_id=%L',
    v_group));
  IF v_result <> 'OK:' || v_member::text || '|Kim Live|text' THEN
    RAISE EXCEPTION 'inbox_last_speaker_wrong:%', v_result;
  END IF;

  IF has_function_privilege('anon', 'public.issue_4304_list_brand_group_read_state(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.issue_4304_list_brand_group_read_state(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3720_list_brand_groups()', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants_wrong';
  END IF;
END;
$proof$;

ROLLBACK;
