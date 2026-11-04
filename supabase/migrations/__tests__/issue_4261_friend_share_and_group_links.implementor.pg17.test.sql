\set ON_ERROR_STOP on

-- Issue #4261 Wave A1 — personal invite link, group link, history from join.
--
--   S-01  the personal link is created once; its token is stable and 32-hex.
--   S-02  a claim connects both ways (two accepted friends rows), records a
--         `connected` claim, and the friend request carries source share_link.
--   S-03  a repeat claim returns alreadyClaimed and writes nothing.
--   S-04  your own link -> own_link.
--   S-05  already friends -> already_friends, no friend request.
--   S-06  a blocked pair -> unavailable; the block row is intact; zero writes.
--   S-07  a new claimant gets a referral credit for the link owner; an
--         account created 30 days ago gets none; joinedCount counts both.
--         (Whether it then turns `credited` is decided by the existing
--         credit_referral_on_friend_accepted trigger, which this issue does not
--         change; see the Wave A report, discovery on its `credit IS NOT NULL`
--         test. Either state is accepted here.)
--   S-08  reset -> the old token is invalid_token.
--   G-01  the group link is readable by members only.
--   G-02  join with approval -> one pending request + a join_request line that
--         members see and the joiner does not.
--   G-03  approve (plain group) -> member with history_visible_from set; older
--         messages hidden from them, newer ones visible.
--   G-04  join a session group without approval -> a pending `link` invite;
--         accepting it (accept_session_with_prefs) -> chat member + one
--         joined_by_link line.
--   G-05  a blocked joiner -> unavailable, nothing written.
--   G-06  reset by a non-admin -> not_allowed; after an admin reset the old
--         token -> not_found.
--   G-07  add_group_members: friend added, non-friend skipped, one line;
--         a session chat -> not_allowed.
--   G-08  existing members keep NULL history (no history loss), and a member
--         cannot clear their own history_visible_from.
--   G-09  deciding twice with opposite outcomes -> PT409; same outcome is
--         idempotent.
--   G-10  grants: anon has nothing on the four tables, authenticated only
--         SELECT (no TRUNCATE), RLS on; anon cannot run the RPCs and
--         authenticated cannot run the internal helpers.
--
-- MINGLA-INVARIANT: I-4261-HISTORY-FROM-JOIN | issue #4261 | A member added to a user group after it has messages cannot read messages created before they joined; existing members are unaffected.
-- MINGLA-INVARIANT: I-4261-SHARE-LINK-NEVER-UNBLOCKS | issue #4261 | Claiming a share or group link never connects, admits or unblocks a blocked pair.
--
-- FAILS-ON-REVERT (replay the chain without
-- 20280331004261_issue_4261_friend_share_and_group_links.sql): the \ir below
-- is the migration itself; without it S-01 fails on its first call
-- (get_or_create_friend_share_link does not exist), and G-03 fails on the
-- missing history_visible_from column.
--
-- Run after the full migration chain on PostgreSQL 17. The re-apply proves
-- the migration is idempotent; everything after it rolls back.

\ir ../20280331004261_issue_4261_friend_share_and_group_links.sql

BEGIN;

-- The bare PostgreSQL image has no Supabase Realtime server, so the ORCH-0931
-- session_updated broadcast trigger would fail on realtime.send. Switch that
-- one trigger off for this transaction when realtime.send is missing (the
-- ROLLBACK restores it). Same pattern as issue_4114_dm_collab.
DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

CREATE TEMP TABLE t4261a_ids (tag text PRIMARY KEY, id uuid NOT NULL);
CREATE TEMP TABLE t4261a_vals (tag text PRIMARY KEY, val text);
GRANT SELECT ON t4261a_ids TO authenticated;
GRANT SELECT, INSERT, UPDATE ON t4261a_vals TO authenticated;

-- Sets the JWT for p_tag (call before SET LOCAL ROLE authenticated).
CREATE FUNCTION pg_temp.t4261a_as(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM t4261a_ids WHERE tag = p_tag;
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
CREATE FUNCTION pg_temp.t4261a_id(p_tag text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM t4261a_ids WHERE tag = p_tag
$f$;
-- Runs p_sql as the current role; returns 'ok' or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.t4261a_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $f$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_conv uuid;
  v_session uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['seth','lola','old','pal','blk','ada','kemi','tobi','zara','dami','chidi','stranger'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4261a-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 't4261a-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4261a_ids VALUES (v_tag, v_id);
  END LOOP;
  UPDATE public.profiles SET created_at = now() - interval '30 days' WHERE id = pg_temp.t4261a_id('old');

  -- Seth and Pal are friends; Seth blocked Blk.
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (pg_temp.t4261a_id('seth'), pg_temp.t4261a_id('pal'), 'accepted'),
    (pg_temp.t4261a_id('pal'), pg_temp.t4261a_id('seth'), 'accepted');
  INSERT INTO public.blocked_users(blocker_id, blocked_id)
    VALUES (pg_temp.t4261a_id('seth'), pg_temp.t4261a_id('blk'));

  -- Plain group "Book club": Seth (creator), Ada, Kemi; two messages from an hour ago.
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
    VALUES ('group', 'direct', 'Book club', pg_temp.t4261a_id('seth')) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES
    (v_conv, pg_temp.t4261a_id('seth')), (v_conv, pg_temp.t4261a_id('ada')), (v_conv, pg_temp.t4261a_id('kemi'));
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES
    (v_conv, pg_temp.t4261a_id('seth'), 'old book club message 1', now() - interval '1 hour'),
    (v_conv, pg_temp.t4261a_id('ada'), 'old book club message 2', now() - interval '50 minutes');
  INSERT INTO t4261a_ids VALUES ('plain', v_conv);

  -- Session group "Saturday crew": Tobi creates; Seth, Ada, Kemi accepted.
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('Saturday crew', pg_temp.t4261a_id('tobi'), 'active') RETURNING id INTO v_session;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_session, pg_temp.t4261a_id('tobi'), true),
    (v_session, pg_temp.t4261a_id('seth'), true),
    (v_session, pg_temp.t4261a_id('ada'), true),
    (v_session, pg_temp.t4261a_id('kemi'), true);
  SELECT public.resolve_session_conversation(v_session) INTO v_conv;
  IF v_conv IS NULL THEN
    RAISE EXCEPTION 'fixture: the session group chat was not created';
  END IF;
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at)
    VALUES (v_conv, pg_temp.t4261a_id('tobi'), 'old crew message', now() - interval '1 hour');
  INSERT INTO t4261a_ids VALUES ('session', v_session), ('crew', v_conv);
END $fixture$;

-- ── G-10 grants (before anything else) ─────────────────────────────────────
DO $g10$
DECLARE
  v_t text;
  v_p text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['friend_share_links','friend_share_claims','group_invite_links','group_join_requests'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN
      RAISE EXCEPTION 'G-10: RLS must be enabled on %', v_t;
    END IF;
    FOREACH v_p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || v_t, v_p) THEN
        RAISE EXCEPTION 'G-10: anon must not hold % on %', v_p, v_t;
      END IF;
      IF v_p <> 'SELECT' AND has_table_privilege('authenticated', 'public.' || v_t, v_p) THEN
        RAISE EXCEPTION 'G-10: authenticated must not hold % on %', v_p, v_t;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT') THEN
      RAISE EXCEPTION 'G-10: authenticated must read % (RLS decides rows)', v_t;
    END IF;
  END LOOP;

  FOREACH v_p IN ARRAY ARRAY[
    'public.get_or_create_friend_share_link()', 'public.reset_friend_share_link()',
    'public.claim_friend_share_link(text)', 'public.get_or_create_group_link(uuid)',
    'public.reset_group_link(uuid)', 'public.set_group_link_approval(uuid,boolean)',
    'public.group_link_preview(text)', 'public.join_group_by_link(text,text)',
    'public.decide_group_join_request(uuid,boolean)', 'public.add_group_members(uuid,uuid[])'] LOOP
    IF has_function_privilege('anon', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'G-10: anon must not execute %', v_p;
    END IF;
    IF NOT has_function_privilege('authenticated', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'G-10: authenticated must execute %', v_p;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE oid = v_p::regprocedure AND prosecdef
         AND proconfig @> ARRAY['search_path=public, pg_temp']
    ) THEN
      RAISE EXCEPTION 'G-10: % must be SECURITY DEFINER with search_path public, pg_temp', v_p;
    END IF;
  END LOOP;

  FOREACH v_p IN ARRAY ARRAY[
    'public.chat_plan_chat_kind(uuid)', 'public.chat_member_blocked(uuid,uuid)',
    'public.chat_group_is_admin(uuid,uuid)', 'public.chat_group_post_event(uuid,text,jsonb,text)',
    'public.chat_group_admit(uuid,uuid,uuid)', 'public.chat_group_is_full(uuid)'] LOOP
    IF has_function_privilege('authenticated', v_p, 'EXECUTE') OR has_function_privilege('anon', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'G-10: % is internal (service_role only)', v_p;
    END IF;
  END LOOP;
END $g10$;

-- ── S-01 .. S-08 personal link ─────────────────────────────────────────────
DO $s01$
DECLARE
  r1 jsonb;
  r2 jsonb;
BEGIN
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  r1 := public.get_or_create_friend_share_link();
  r2 := public.get_or_create_friend_share_link();
  RESET ROLE;
  IF r1 ->> 'token' IS NULL OR r1 ->> 'token' !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'S-01: token must be 32 hex (got %)', r1;
  END IF;
  IF r1 ->> 'token' <> r2 ->> 'token' THEN
    RAISE EXCEPTION 'S-01: a second call must return the same token';
  END IF;
  IF (r1 ->> 'joinedCount')::int <> 0 OR r1 ->> 'referralCode' IS NULL THEN
    RAISE EXCEPTION 'S-01: joinedCount 0 and the referral code expected (got %)', r1;
  END IF;
  IF (SELECT count(*) FROM public.friend_share_links WHERE user_id = pg_temp.t4261a_id('seth')) <> 1 THEN
    RAISE EXCEPTION 'S-01: exactly one link row';
  END IF;
  INSERT INTO t4261a_vals VALUES ('seth_token', r1 ->> 'token');
END $s01$;

DO $s02$
DECLARE
  r jsonb;
  v_tok text := (SELECT val FROM t4261a_vals WHERE tag = 'seth_token');
BEGIN
  PERFORM pg_temp.t4261a_as('lola');
  SET LOCAL ROLE authenticated;
  r := public.claim_friend_share_link(v_tok);
  RESET ROLE;
  IF (r ->> 'success')::boolean IS NOT TRUE OR r ->> 'outcome' <> 'connected'
     OR (r ->> 'alreadyClaimed')::boolean OR (r ->> 'ownerId')::uuid <> pg_temp.t4261a_id('seth')
     OR r ->> 'friendRequestId' IS NULL THEN
    RAISE EXCEPTION 'S-02: expected a connected claim (got %)', r;
  END IF;
  IF (SELECT count(*) FROM public.friends
       WHERE status = 'accepted' AND deleted_at IS NULL
         AND ((user_id = pg_temp.t4261a_id('seth') AND friend_user_id = pg_temp.t4261a_id('lola'))
           OR (user_id = pg_temp.t4261a_id('lola') AND friend_user_id = pg_temp.t4261a_id('seth')))) <> 2 THEN
    RAISE EXCEPTION 'S-02: both friends rows must be accepted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.friend_requests
       WHERE id = (r ->> 'friendRequestId')::uuid AND sender_id = pg_temp.t4261a_id('seth')
         AND receiver_id = pg_temp.t4261a_id('lola') AND status = 'accepted' AND source = 'share_link') THEN
    RAISE EXCEPTION 'S-02: the friend request must be accepted with source share_link';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.friend_share_claims
       WHERE owner_id = pg_temp.t4261a_id('seth') AND claimant_id = pg_temp.t4261a_id('lola')
         AND outcome = 'connected' AND referral_credit_created) THEN
    RAISE EXCEPTION 'S-02: a connected claim row with a referral credit expected';
  END IF;
END $s02$;

DO $s03$
DECLARE
  r jsonb;
  v_before bigint;
  v_tok text := (SELECT val FROM t4261a_vals WHERE tag = 'seth_token');
BEGIN
  v_before := (SELECT count(*) FROM public.friends) + (SELECT count(*) FROM public.friend_requests)
            + (SELECT count(*) FROM public.friend_share_claims) + (SELECT count(*) FROM public.referral_credits);
  PERFORM pg_temp.t4261a_as('lola');
  SET LOCAL ROLE authenticated;
  r := public.claim_friend_share_link(v_tok);
  RESET ROLE;
  IF (r ->> 'alreadyClaimed')::boolean IS NOT TRUE OR r ->> 'outcome' <> 'connected' THEN
    RAISE EXCEPTION 'S-03: a repeat claim must return alreadyClaimed (got %)', r;
  END IF;
  IF v_before <> (SELECT count(*) FROM public.friends) + (SELECT count(*) FROM public.friend_requests)
            + (SELECT count(*) FROM public.friend_share_claims) + (SELECT count(*) FROM public.referral_credits) THEN
    RAISE EXCEPTION 'S-03: a repeat claim must write nothing';
  END IF;
END $s03$;

DO $s04$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.claim_friend_share_link((SELECT val FROM t4261a_vals WHERE tag = 'seth_token'));
  RESET ROLE;
  IF (r ->> 'success')::boolean OR r ->> 'error' <> 'own_link' THEN
    RAISE EXCEPTION 'S-04: own link must be refused (got %)', r;
  END IF;
END $s04$;

DO $s05$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.t4261a_as('pal');
  SET LOCAL ROLE authenticated;
  r := public.claim_friend_share_link((SELECT val FROM t4261a_vals WHERE tag = 'seth_token'));
  RESET ROLE;
  IF (r ->> 'success')::boolean IS NOT TRUE OR r ->> 'outcome' <> 'already_friends' THEN
    RAISE EXCEPTION 'S-05: already friends expected (got %)', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.friend_requests
       WHERE (sender_id = pg_temp.t4261a_id('seth') AND receiver_id = pg_temp.t4261a_id('pal'))
          OR (sender_id = pg_temp.t4261a_id('pal') AND receiver_id = pg_temp.t4261a_id('seth'))) THEN
    RAISE EXCEPTION 'S-05: no friend request between friends';
  END IF;
END $s05$;

DO $s06$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.t4261a_as('blk');
  SET LOCAL ROLE authenticated;
  r := public.claim_friend_share_link((SELECT val FROM t4261a_vals WHERE tag = 'seth_token'));
  RESET ROLE;
  IF (r ->> 'success')::boolean OR r ->> 'error' <> 'unavailable' THEN
    RAISE EXCEPTION 'S-06: a blocked pair must get unavailable (got %)', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blocked_users
       WHERE blocker_id = pg_temp.t4261a_id('seth') AND blocked_id = pg_temp.t4261a_id('blk')) THEN
    RAISE EXCEPTION 'S-06: the block row must stay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.friend_requests WHERE pg_temp.t4261a_id('blk') IN (sender_id, receiver_id))
     OR EXISTS (SELECT 1 FROM public.friends WHERE pg_temp.t4261a_id('blk') IN (user_id, friend_user_id))
     OR EXISTS (SELECT 1 FROM public.friend_share_claims WHERE claimant_id = pg_temp.t4261a_id('blk'))
     OR EXISTS (SELECT 1 FROM public.referral_credits WHERE referred_id = pg_temp.t4261a_id('blk')) THEN
    RAISE EXCEPTION 'S-06: a blocked claim must write nothing';
  END IF;
END $s06$;

DO $s07$
DECLARE
  r jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.referral_credits
       WHERE referrer_id = pg_temp.t4261a_id('seth') AND referred_id = pg_temp.t4261a_id('lola')
         AND status IN ('pending', 'credited')) THEN
    RAISE EXCEPTION 'S-07: the new claimant must create a referral credit for the link owner';
  END IF;
  PERFORM pg_temp.t4261a_as('old');
  SET LOCAL ROLE authenticated;
  r := public.claim_friend_share_link((SELECT val FROM t4261a_vals WHERE tag = 'seth_token'));
  RESET ROLE;
  IF r ->> 'outcome' <> 'connected' THEN
    RAISE EXCEPTION 'S-07: the old account still connects (got %)', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.referral_credits WHERE referred_id = pg_temp.t4261a_id('old')) THEN
    RAISE EXCEPTION 'S-07: an account created 30 days ago must not create a referral credit';
  END IF;
  IF EXISTS (SELECT 1 FROM public.friend_share_claims
       WHERE claimant_id = pg_temp.t4261a_id('old') AND referral_credit_created) THEN
    RAISE EXCEPTION 'S-07: referral_credit_created must be false for the old account';
  END IF;
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.get_or_create_friend_share_link();
  RESET ROLE;
  IF (r ->> 'joinedCount')::int <> 2 THEN
    RAISE EXCEPTION 'S-07: joinedCount must count the two connected claims (got %)', r;
  END IF;
END $s07$;

DO $s08$
DECLARE
  r jsonb;
  v_old text := (SELECT val FROM t4261a_vals WHERE tag = 'seth_token');
BEGIN
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.reset_friend_share_link();
  RESET ROLE;
  IF r ->> 'token' = v_old OR r ->> 'token' !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'S-08: reset must issue a new token';
  END IF;
  PERFORM pg_temp.t4261a_as('chidi');
  SET LOCAL ROLE authenticated;
  r := public.claim_friend_share_link(v_old);
  RESET ROLE;
  IF r ->> 'error' <> 'invalid_token' THEN
    RAISE EXCEPTION 'S-08: the old token must be invalid_token (got %)', r;
  END IF;
END $s08$;

-- ── G-01 .. G-10 group link ────────────────────────────────────────────────
DO $g01$
DECLARE
  r jsonb;
  v_n int;
  v_err text;
BEGIN
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.get_or_create_group_link(pg_temp.t4261a_id('plain'));
  RESET ROLE;
  IF (r ->> 'requireApproval')::boolean IS NOT TRUE OR (r ->> 'canManage')::boolean IS NOT TRUE
     OR (r ->> 'memberCount')::int <> 3 OR r ->> 'token' !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'G-01: link for the creator (got %)', r;
  END IF;
  INSERT INTO t4261a_vals VALUES ('plain_token', r ->> 'token');

  PERFORM pg_temp.t4261a_as('ada');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.group_invite_links WHERE conversation_id = pg_temp.t4261a_id('plain');
  r := public.get_or_create_group_link(pg_temp.t4261a_id('plain'));
  RESET ROLE;
  IF v_n <> 1 OR (r ->> 'canManage')::boolean THEN
    RAISE EXCEPTION 'G-01: a member reads the link but cannot manage it (rows %, %)', v_n, r;
  END IF;

  PERFORM pg_temp.t4261a_as('stranger');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.group_invite_links;
  v_err := pg_temp.t4261a_try(format('SELECT public.get_or_create_group_link(%L)', pg_temp.t4261a_id('plain')));
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'G-01: a non-member must read zero link rows (got %)', v_n;
  END IF;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'G-01: a non-member cannot get the link (got %)', v_err;
  END IF;
END $g01$;

DO $g02$
DECLARE
  r jsonb;
  r2 jsonb;
  v_n int;
BEGIN
  PERFORM pg_temp.t4261a_as('zara');
  SET LOCAL ROLE authenticated;
  r := public.group_link_preview((SELECT val FROM t4261a_vals WHERE tag = 'plain_token'));
  IF r ->> 'name' <> 'Book club' OR (r ->> 'isMember')::boolean OR (r ->> 'memberCount')::int <> 3 THEN
    RAISE EXCEPTION 'G-02: preview (got %)', r;
  END IF;
  r := public.join_group_by_link((SELECT val FROM t4261a_vals WHERE tag = 'plain_token'), NULL);
  r2 := public.join_group_by_link((SELECT val FROM t4261a_vals WHERE tag = 'plain_token'), NULL);
  SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = pg_temp.t4261a_id('plain');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'G-02: the joiner must read no messages before joining (got %)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.group_join_requests WHERE id = (r ->> 'requestId')::uuid;
  RESET ROLE;
  IF r ->> 'status' <> 'requested' OR r ->> 'requestId' IS NULL OR r2 ->> 'requestId' <> r ->> 'requestId' THEN
    RAISE EXCEPTION 'G-02: one pending request, the repeat returns it (got % / %)', r, r2;
  END IF;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'G-02: the joiner reads their own request';
  END IF;
  INSERT INTO t4261a_vals VALUES ('zara_request', r ->> 'requestId');

  PERFORM pg_temp.t4261a_as('ada');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.messages
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND message_type = 'system'
     AND card_payload ->> 'kind' = 'group_event' AND card_payload ->> 'event' = 'join_request'
     AND card_payload ->> 'requestId' = r ->> 'requestId'
     AND content = 'Zara wants to join';
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'G-02: members must see exactly one join_request line (got %)', v_n;
  END IF;
  IF (SELECT message_id FROM public.group_join_requests WHERE id = (r ->> 'requestId')::uuid) IS NULL THEN
    RAISE EXCEPTION 'G-02: the request stores its card message';
  END IF;
END $g02$;

DO $g03$
DECLARE
  r jsonb;
  v_hidden int;
  v_new int;
  v_from timestamptz;
BEGIN
  PERFORM pg_temp.t4261a_as('ada');
  SET LOCAL ROLE authenticated;
  r := public.decide_group_join_request((SELECT val FROM t4261a_vals WHERE tag = 'zara_request')::uuid, true);
  RESET ROLE;
  IF r ->> 'status' <> 'approved' THEN
    RAISE EXCEPTION 'G-03: approve (got %)', r;
  END IF;
  SELECT history_visible_from INTO v_from FROM public.conversation_participants
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND user_id = pg_temp.t4261a_id('zara');
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'G-03: the new member must have history_visible_from set';
  END IF;
  INSERT INTO public.messages(conversation_id, sender_id, content)
    VALUES (pg_temp.t4261a_id('plain'), pg_temp.t4261a_id('kemi'), 'welcome zara');

  PERFORM pg_temp.t4261a_as('zara');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_hidden FROM public.messages
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND content LIKE 'old book club message%';
  SELECT count(*) INTO v_new FROM public.messages
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND content = 'welcome zara';
  RESET ROLE;
  IF v_hidden <> 0 THEN
    RAISE EXCEPTION 'G-03: messages from before the join must be invisible (got %)', v_hidden;
  END IF;
  IF v_new <> 1 THEN
    RAISE EXCEPTION 'G-03: messages after the join must be visible (got %)', v_new;
  END IF;
END $g03$;

DO $g04$
DECLARE
  r jsonb;
  v_err text;
  v_n int;
BEGIN
  -- Tobi (session creator) turns approval off.
  PERFORM pg_temp.t4261a_as('tobi');
  SET LOCAL ROLE authenticated;
  r := public.get_or_create_group_link(pg_temp.t4261a_id('crew'));
  INSERT INTO t4261a_vals VALUES ('crew_token', r ->> 'token');
  r := public.set_group_link_approval(pg_temp.t4261a_id('crew'), false);
  RESET ROLE;
  IF (r ->> 'requireApproval')::boolean THEN
    RAISE EXCEPTION 'G-04: approval must be off';
  END IF;

  -- Seth (member, not admin) cannot change it.
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261a_try(format('SELECT public.set_group_link_approval(%L, true)', pg_temp.t4261a_id('crew')));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'G-04: a non-admin cannot change approval (got %)', v_err;
  END IF;

  PERFORM pg_temp.t4261a_as('dami');
  SET LOCAL ROLE authenticated;
  r := public.join_group_by_link((SELECT val FROM t4261a_vals WHERE tag = 'crew_token'), NULL);
  RESET ROLE;
  IF r ->> 'status' <> 'invited' OR (r ->> 'sessionId')::uuid <> pg_temp.t4261a_id('session') OR r ->> 'inviteId' IS NULL THEN
    RAISE EXCEPTION 'G-04: a session group join without approval is a pending link invite (got %)', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.collaboration_invites
       WHERE id = (r ->> 'inviteId')::uuid AND invite_method = 'link' AND status = 'pending'
         AND invited_user_id = pg_temp.t4261a_id('dami') AND inviter_id = pg_temp.t4261a_id('tobi')) THEN
    RAISE EXCEPTION 'G-04: the invite row must be pending/link from the link creator';
  END IF;
  IF public.is_conversation_participant(pg_temp.t4261a_id('crew'), pg_temp.t4261a_id('dami')) THEN
    RAISE EXCEPTION 'G-04: not a member until the invite is accepted';
  END IF;

  PERFORM pg_temp.t4261a_as('dami');
  SET LOCAL ROLE authenticated;
  PERFORM public.accept_session_with_prefs(
    pg_temp.t4261a_id('session'), (r ->> 'inviteId')::uuid, NULL, NULL,
    ARRAY[]::text[], ARRAY[]::text[], 'walking', 30);
  RESET ROLE;
  IF NOT public.is_conversation_participant(pg_temp.t4261a_id('crew'), pg_temp.t4261a_id('dami')) THEN
    RAISE EXCEPTION 'G-04: accepting makes them a chat member';
  END IF;
  SELECT count(*) INTO v_n FROM public.messages
   WHERE conversation_id = pg_temp.t4261a_id('crew') AND card_payload ->> 'kind' = 'group_event'
     AND card_payload ->> 'event' = 'joined_by_link' AND card_payload ->> 'userId' = pg_temp.t4261a_id('dami')::text;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'G-04: exactly one joined_by_link line (got %)', v_n;
  END IF;
  IF (SELECT history_visible_from FROM public.conversation_participants
       WHERE conversation_id = pg_temp.t4261a_id('crew') AND user_id = pg_temp.t4261a_id('dami')) IS NULL THEN
    RAISE EXCEPTION 'G-04: a session-group joiner also starts from their join';
  END IF;
END $g04$;

DO $g05$
DECLARE
  v_err text;
BEGIN
  PERFORM pg_temp.t4261a_as('blk');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261a_try(format('SELECT public.join_group_by_link(%L, NULL)', (SELECT val FROM t4261a_vals WHERE tag = 'plain_token')));
  RESET ROLE;
  IF v_err <> '42501:unavailable' THEN
    RAISE EXCEPTION 'G-05: a joiner blocked by a member gets unavailable (got %)', v_err;
  END IF;
  IF EXISTS (SELECT 1 FROM public.group_join_requests WHERE user_id = pg_temp.t4261a_id('blk'))
     OR public.is_conversation_participant(pg_temp.t4261a_id('plain'), pg_temp.t4261a_id('blk')) THEN
    RAISE EXCEPTION 'G-05: nothing written for a blocked joiner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blocked_users
       WHERE blocker_id = pg_temp.t4261a_id('seth') AND blocked_id = pg_temp.t4261a_id('blk')) THEN
    RAISE EXCEPTION 'G-05: the block row must stay';
  END IF;
END $g05$;

DO $g06$
DECLARE
  r jsonb;
  v_err text;
  v_old text := (SELECT val FROM t4261a_vals WHERE tag = 'plain_token');
BEGIN
  PERFORM pg_temp.t4261a_as('kemi');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261a_try(format('SELECT public.reset_group_link(%L)', pg_temp.t4261a_id('plain')));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'G-06: a non-admin reset must be not_allowed (got %)', v_err;
  END IF;
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.reset_group_link(pg_temp.t4261a_id('plain'));
  RESET ROLE;
  IF r ->> 'token' = v_old THEN
    RAISE EXCEPTION 'G-06: reset must change the token';
  END IF;
  UPDATE t4261a_vals SET val = r ->> 'token' WHERE tag = 'plain_token';
  PERFORM pg_temp.t4261a_as('chidi');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261a_try(format('SELECT public.join_group_by_link(%L, NULL)', v_old));
  RESET ROLE;
  IF v_err <> 'P0002:not_found' THEN
    RAISE EXCEPTION 'G-06: the old group token must be not_found (got %)', v_err;
  END IF;
END $g06$;

DO $g07$
DECLARE
  r jsonb;
  v_err text;
  v_n int;
BEGIN
  PERFORM pg_temp.t4261a_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.add_group_members(pg_temp.t4261a_id('plain'),
         ARRAY[pg_temp.t4261a_id('pal'), pg_temp.t4261a_id('stranger'), pg_temp.t4261a_id('ada')]);
  v_err := pg_temp.t4261a_try(format('SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])',
             pg_temp.t4261a_id('crew'), pg_temp.t4261a_id('pal')));
  RESET ROLE;
  IF r -> 'added' <> jsonb_build_array(pg_temp.t4261a_id('pal'))
     OR NOT (r -> 'skipped' @> jsonb_build_array(pg_temp.t4261a_id('stranger'), pg_temp.t4261a_id('ada'))) THEN
    RAISE EXCEPTION 'G-07: friend added, non-friend and existing member skipped (got %)', r;
  END IF;
  IF NOT public.is_conversation_participant(pg_temp.t4261a_id('plain'), pg_temp.t4261a_id('pal'))
     OR public.is_conversation_participant(pg_temp.t4261a_id('plain'), pg_temp.t4261a_id('stranger')) THEN
    RAISE EXCEPTION 'G-07: membership after add_group_members';
  END IF;
  SELECT count(*) INTO v_n FROM public.messages
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND card_payload ->> 'event' = 'members_added'
     AND content = 'Seth added 1 person';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'G-07: one members_added line (got %)', v_n;
  END IF;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'G-07: a session chat uses the existing invite flow (got %)', v_err;
  END IF;
END $g07$;

DO $g08$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.conversation_participants
   WHERE history_visible_from IS NOT NULL
     AND ((conversation_id = pg_temp.t4261a_id('plain') AND user_id IN (pg_temp.t4261a_id('seth'), pg_temp.t4261a_id('ada'), pg_temp.t4261a_id('kemi')))
       OR (conversation_id = pg_temp.t4261a_id('crew') AND user_id IN (pg_temp.t4261a_id('tobi'), pg_temp.t4261a_id('seth'), pg_temp.t4261a_id('ada'), pg_temp.t4261a_id('kemi'))));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'G-08: existing members keep NULL history (got % set)', v_n;
  END IF;
  PERFORM pg_temp.t4261a_as('ada');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.messages
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND content LIKE 'old book club message%';
  RESET ROLE;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'G-08: existing members still read the old messages (got %)', v_n;
  END IF;

  -- Zara cannot clear her own history start (the policy lets her update her row).
  PERFORM pg_temp.t4261a_as('zara');
  SET LOCAL ROLE authenticated;
  UPDATE public.conversation_participants SET history_visible_from = NULL
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND user_id = pg_temp.t4261a_id('zara');
  SELECT count(*) INTO v_n FROM public.messages
   WHERE conversation_id = pg_temp.t4261a_id('plain') AND content LIKE 'old book club message%';
  RESET ROLE;
  IF v_n <> 0 OR (SELECT history_visible_from FROM public.conversation_participants
       WHERE conversation_id = pg_temp.t4261a_id('plain') AND user_id = pg_temp.t4261a_id('zara')) IS NULL THEN
    RAISE EXCEPTION 'G-08: history_visible_from must not be clearable by the member';
  END IF;
END $g08$;

DO $g09$
DECLARE
  r jsonb;
  v_err text;
BEGIN
  PERFORM pg_temp.t4261a_as('chidi');
  SET LOCAL ROLE authenticated;
  r := public.join_group_by_link((SELECT val FROM t4261a_vals WHERE tag = 'plain_token'), NULL);
  RESET ROLE;
  INSERT INTO t4261a_vals VALUES ('chidi_request', r ->> 'requestId');

  PERFORM pg_temp.t4261a_as('ada');
  SET LOCAL ROLE authenticated;
  r := public.decide_group_join_request((SELECT val FROM t4261a_vals WHERE tag = 'chidi_request')::uuid, false);
  IF r ->> 'status' <> 'declined' THEN
    RAISE EXCEPTION 'G-09: decline (got %)', r;
  END IF;
  r := public.decide_group_join_request((SELECT val FROM t4261a_vals WHERE tag = 'chidi_request')::uuid, false);
  IF r ->> 'status' <> 'declined' THEN
    RAISE EXCEPTION 'G-09: the same decision again is idempotent (got %)', r;
  END IF;
  v_err := pg_temp.t4261a_try(format('SELECT public.decide_group_join_request(%L, true)', (SELECT val FROM t4261a_vals WHERE tag = 'chidi_request')));
  RESET ROLE;
  IF v_err <> 'PT409:conflict_already_decided' THEN
    RAISE EXCEPTION 'G-09: the opposite decision must be PT409 (got %)', v_err;
  END IF;
  IF public.is_conversation_participant(pg_temp.t4261a_id('plain'), pg_temp.t4261a_id('chidi')) THEN
    RAISE EXCEPTION 'G-09: a declined joiner is not a member';
  END IF;

  -- A fresh request inside the 24 h cooldown writes nothing.
  PERFORM pg_temp.t4261a_as('chidi');
  SET LOCAL ROLE authenticated;
  r := public.join_group_by_link((SELECT val FROM t4261a_vals WHERE tag = 'plain_token'), NULL);
  RESET ROLE;
  IF r ->> 'status' <> 'requested' OR r ? 'requestId' THEN
    RAISE EXCEPTION 'G-09: cooldown answers requested without a new request (got %)', r;
  END IF;
  IF (SELECT count(*) FROM public.group_join_requests WHERE user_id = pg_temp.t4261a_id('chidi')) <> 1 THEN
    RAISE EXCEPTION 'G-09: no second request inside the cooldown';
  END IF;
END $g09$;

ROLLBACK;

\echo 'issue_4261_friend_share_and_group_links: all assertions passed'
