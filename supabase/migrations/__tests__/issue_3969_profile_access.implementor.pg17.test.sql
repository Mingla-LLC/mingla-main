\set ON_ERROR_STOP on

-- Issue #3969 — profile read and write access (implementor suite).
--
--   I-01  a signed-out caller (role anon) has no access to public.profiles:
--         SELECT, INSERT and UPDATE are refused, and the segment view that reads
--         profiles as its caller is refused too.
--   I-02  a signed-in caller sees exactly the same profiles as before: own row,
--         a friend, a stranger and an admin are visible; a profile whose owner
--         blocked the caller is not; the blocking user still sees the caller.
--   I-03  a signed-in caller cannot change profiles.phone on their own row
--         (set, replace or clear); re-sending the stored value is not a change.
--   I-04  every other own-row update still works, including the BEFORE UPDATE
--         triggers (display name sync, updated_at).
--   I-05  the service role sets phone (the verify-otp path), and the AFTER
--         UPDATE triggers still turn pending invites for that number into
--         friend requests, a session-free pair request and converted invites.
--   I-06  an active admin can still change phone from the admin console.
--
-- FAILS-ON-REVERT (replay the chain without 20271106003969): I-01 fails on its
-- first read (rows come back), I-03 fails on its first update (it succeeds).
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t3969_as(p_role text, p_user uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', p_role)::text, true);
END $fn$;

CREATE TEMP TABLE t3969_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t3969_ids TO anon, authenticated, service_role;

-- Fixture: owner, friend, stranger, a user who blocked the owner, an admin.
DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['owner', 'friend', 'stranger', 'blocker', 'admin', 'inviter'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't3969-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't3969-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t3969_ids VALUES (v_tag, v_id);
  END LOOP;

  UPDATE public.profiles SET visibility_mode = 'friends', phone = NULL, first_name = 'Before'
   WHERE id IN (SELECT id FROM t3969_ids);
  UPDATE public.profiles SET phone = '+15550396901'
   WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'stranger');

  INSERT INTO public.friends(user_id, friend_user_id, status)
    SELECT o.id, f.id, 'accepted' FROM t3969_ids o, t3969_ids f
     WHERE o.tag = 'owner' AND f.tag = 'friend';
  INSERT INTO public.blocked_users(blocker_id, blocked_id)
    SELECT b.id, o.id FROM t3969_ids b, t3969_ids o
     WHERE b.tag = 'blocker' AND o.tag = 'owner';
  INSERT INTO public.admin_users(email, role, status)
    SELECT 't3969-admin-' || id || '@example.test', 'admin', 'active'
      FROM t3969_ids WHERE tag = 'admin';

  -- Invites waiting for a number nobody holds yet.
  INSERT INTO public.pending_invites(inviter_id, phone_e164, status)
    SELECT id, '+15550396902', 'pending' FROM t3969_ids WHERE tag = 'inviter';
  INSERT INTO public.pending_pair_invites(inviter_id, phone_e164, status)
    SELECT id, '+15550396902', 'pending' FROM t3969_ids WHERE tag = 'inviter';
END
$fixture$;

-- ── I-01 signed-out caller ─────────────────────────────────────────────────
SELECT pg_temp.t3969_as('anon', NULL);
SET LOCAL ROLE anon;
DO $i01$
DECLARE
  v_n bigint;
BEGIN
  BEGIN
    SELECT count(*) INTO v_n FROM public.profiles;
    RAISE EXCEPTION 'I-01: anon read profiles (% rows)', v_n;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    SELECT count(*) INTO v_n FROM public.profiles WHERE email IS NOT NULL;
    RAISE EXCEPTION 'I-01: anon read profiles.email (% rows)', v_n;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.profiles(id, email) VALUES (gen_random_uuid(), 't3969-anon@example.test');
    RAISE EXCEPTION 'I-01: anon inserted a profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.profiles SET bio = 'anon' WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'owner');
    RAISE EXCEPTION 'I-01: anon update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    SELECT count(*) INTO v_n FROM public.profiles_with_segment;
    RAISE EXCEPTION 'I-01: anon read profiles_with_segment (% rows)', v_n;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$i01$;
RESET ROLE;

-- ── I-02 signed-in visibility is unchanged ─────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.t3969_visible_tags(p_viewer text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_tags text;
BEGIN
  PERFORM pg_temp.t3969_as('authenticated', (SELECT id FROM t3969_ids WHERE tag = p_viewer));
  SET LOCAL ROLE authenticated;
  SELECT string_agg(i.tag, ',' ORDER BY i.tag) INTO v_tags
    FROM public.profiles p JOIN t3969_ids i ON i.id = p.id;
  RESET ROLE;
  RETURN v_tags;
END $fn$;

DO $i02$
DECLARE
  v text;
BEGIN
  v := pg_temp.t3969_visible_tags('owner');
  IF v IS DISTINCT FROM 'admin,friend,inviter,owner,stranger' THEN
    RAISE EXCEPTION 'I-02: owner sees % (expected every fixture except the user who blocked them)', v;
  END IF;

  v := pg_temp.t3969_visible_tags('blocker');
  IF v IS DISTINCT FROM 'admin,blocker,friend,inviter,owner,stranger' THEN
    RAISE EXCEPTION 'I-02: blocking user sees %', v;
  END IF;

  v := pg_temp.t3969_visible_tags('stranger');
  IF v IS DISTINCT FROM 'admin,blocker,friend,inviter,owner,stranger' THEN
    RAISE EXCEPTION 'I-02: stranger sees %', v;
  END IF;

  -- Contact columns read as before for a signed-in caller (Step 1 does not change columns).
  PERFORM pg_temp.t3969_as('authenticated', (SELECT id FROM t3969_ids WHERE tag = 'owner'));
  SET LOCAL ROLE authenticated;
  IF (SELECT phone FROM public.profiles WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'stranger'))
       IS DISTINCT FROM '+15550396901' THEN
    RAISE EXCEPTION 'I-02: signed-in column read changed';
  END IF;
  RESET ROLE;
END
$i02$;

-- ── I-03 a client cannot change phone ──────────────────────────────────────
SELECT pg_temp.t3969_as('authenticated', (SELECT id FROM t3969_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
DO $i03$
DECLARE
  v_owner uuid := (SELECT id FROM t3969_ids WHERE tag = 'owner');
  v_n int;
BEGIN
  BEGIN
    UPDATE public.profiles SET phone = '+15550396902' WHERE id = v_owner;
    RAISE EXCEPTION 'I-03: client set phone on own row';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'profiles.phone can only be changed through phone verification%' THEN
      RAISE EXCEPTION 'I-03: unexpected refusal: %', SQLERRM;
    END IF;
  END;

  -- The same statement shape the editor sends: phone alongside other fields.
  BEGIN
    UPDATE public.profiles SET bio = 'with phone', phone = '+15550396903' WHERE id = v_owner;
    RAISE EXCEPTION 'I-03: client set phone alongside other fields';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$i03$;
RESET ROLE;

-- Give the owner a phone through the server, then try to replace / clear it.
SET LOCAL ROLE service_role;
UPDATE public.profiles SET phone = '+15550396904' WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'owner');
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $i03b$
DECLARE
  v_owner uuid := (SELECT id FROM t3969_ids WHERE tag = 'owner');
  v_n int;
BEGIN
  BEGIN
    UPDATE public.profiles SET phone = '+15550396905' WHERE id = v_owner;
    RAISE EXCEPTION 'I-03: client replaced phone';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.profiles SET phone = NULL WHERE id = v_owner;
    RAISE EXCEPTION 'I-03: client cleared phone';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Re-sending the stored value is not a change.
  UPDATE public.profiles SET phone = '+15550396904', bio = 'same phone' WHERE id = v_owner;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'I-03: re-sending the stored phone updated % rows', v_n;
  END IF;
END
$i03b$;
RESET ROLE;

DO $i03c$
BEGIN
  IF (SELECT phone FROM public.profiles WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'owner'))
       IS DISTINCT FROM '+15550396904' THEN
    RAISE EXCEPTION 'I-03: owner phone moved';
  END IF;
  IF (SELECT status FROM public.pending_invites WHERE phone_e164 = '+15550396902'
        AND inviter_id = (SELECT id FROM t3969_ids WHERE tag = 'inviter')) <> 'pending' THEN
    RAISE EXCEPTION 'I-03: a refused client update converted an invite';
  END IF;
END
$i03c$;

-- ── I-04 other own-row updates still work ──────────────────────────────────
SET LOCAL ROLE authenticated;
DO $i04$
DECLARE
  v_owner uuid := (SELECT id FROM t3969_ids WHERE tag = 'owner');
  v_n int;
BEGIN
  UPDATE public.profiles
     SET first_name = 'After', last_name = 'Person', bio = 'hello', updated_at = '2000-01-01'
   WHERE id = v_owner;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'I-04: own-row update touched % rows', v_n;
  END IF;
END
$i04$;
RESET ROLE;

DO $i04b$
DECLARE
  r public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.profiles WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'owner');
  IF r.bio <> 'hello' OR r.display_name <> 'After Person' THEN
    RAISE EXCEPTION 'I-04: own-row update or display name sync lost (bio %, display_name %)', r.bio, r.display_name;
  END IF;
  IF r.updated_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'I-04: updated_at trigger did not run';
  END IF;
END
$i04b$;

-- ── I-05 the server sets phone and the invites convert ─────────────────────
SELECT pg_temp.t3969_as('service_role', NULL);
SET LOCAL ROLE service_role;
UPDATE public.profiles SET phone = '+15550396902' WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'friend');
RESET ROLE;

DO $i05$
DECLARE
  v_friend uuid := (SELECT id FROM t3969_ids WHERE tag = 'friend');
  v_inviter uuid := (SELECT id FROM t3969_ids WHERE tag = 'inviter');
BEGIN
  IF (SELECT phone FROM public.profiles WHERE id = v_friend) IS DISTINCT FROM '+15550396902' THEN
    RAISE EXCEPTION 'I-05: service role phone update did not land';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.friend_requests WHERE sender_id = v_inviter AND receiver_id = v_friend) THEN
    RAISE EXCEPTION 'I-05: no friend request from the pending invite';
  END IF;
  IF (SELECT status FROM public.pending_invites WHERE inviter_id = v_inviter) <> 'converted' THEN
    RAISE EXCEPTION 'I-05: pending invite not converted';
  END IF;
  IF (SELECT status FROM public.pending_pair_invites WHERE inviter_id = v_inviter) <> 'converted' THEN
    RAISE EXCEPTION 'I-05: pending pair invite not converted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pair_requests
                  WHERE sender_id = v_inviter AND receiver_id = v_friend
                    AND visibility = 'hidden_until_friend') THEN
    RAISE EXCEPTION 'I-05: no pair request from the pending pair invite';
  END IF;
END
$i05$;

-- The server can also clear a phone (verify-otp / send-otp / delete-user).
SET LOCAL ROLE service_role;
UPDATE public.profiles SET phone = NULL WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'stranger');
RESET ROLE;
DO $i05b$
BEGIN
  IF (SELECT phone FROM public.profiles WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'stranger')) IS NOT NULL THEN
    RAISE EXCEPTION 'I-05: service role could not clear phone';
  END IF;
END
$i05b$;

-- ── I-06 an active admin can still edit phone ──────────────────────────────
SELECT pg_temp.t3969_as('authenticated', (SELECT id FROM t3969_ids WHERE tag = 'admin'));
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET phone = '+15550396906' WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'stranger');
RESET ROLE;
DO $i06$
BEGIN
  IF (SELECT phone FROM public.profiles WHERE id = (SELECT id FROM t3969_ids WHERE tag = 'stranger'))
       IS DISTINCT FROM '+15550396906' THEN
    RAISE EXCEPTION 'I-06: admin phone edit did not land';
  END IF;
END
$i06$;

ROLLBACK;

\echo 'issue #3969 implementor suite: PASS'
