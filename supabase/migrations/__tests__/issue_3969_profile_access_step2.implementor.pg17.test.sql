-- MINGLA-INVARIANT: I-3969-PROFILE-ACCOUNT-FIELDS-SERVER-SET | issue #3969 | A signed-in caller cannot set their own profile account-control fields, person lookups never hand a caller an email they did not supply, and private profile fields reach a caller only through get_my_profile or a relationship-scoped definer read.
\set ON_ERROR_STOP on

-- Issue #3969 Step 2 — profile access, server step (implementor suite).
--
--   S-01  signed-out callers (anon) cannot execute the lookup RPCs, the new
--         reads or get_my_profile.
--   S-02  resolve_user_visibility_by_identifier keeps its shape; a username
--         lookup returns no email; an email lookup still resolves and returns
--         the email the caller typed; matching is deterministic.
--   S-03  a signed-in caller cannot set is_beta_tester, is_seed, account_type,
--         email_verified, referral_code or active on their own row, cannot set
--         email to anything but their sign-in email, and can only clear
--         explorer_deleted_at; ordinary edits and re-sent values still work.
--   S-04  a new own row cannot start with account-control fields set; the
--         ordinary client insert still works and gets a referral code.
--   S-05  admins, the service role and SECURITY DEFINER code are not affected.
--   S-06  get_my_profile returns exactly the caller's row; nothing without a
--         signed-in caller.
--   S-07  issue_3969_resolve_person finds by email, username and id and has
--         no email in its result.
--   S-08  issue_3969_pair_partner_details: birthday / gender only for paired
--         people and pending pair requests; blocked-by rows are left out.
--         issue_3969_friend_profile: location only for self and accepted friends.
--   S-09  issue_3969_admin_profile_contacts is admin / support only.
--   S-10  authenticated holds no TRUNCATE / TRIGGER / REFERENCES / DELETE on
--         profiles and no SELECT on profiles_with_segment; SELECT / INSERT /
--         UPDATE are unchanged (installed apps keep working); every new
--         function is SECURITY DEFINER with a pinned search_path and no
--         PUBLIC / anon EXECUTE.
--
-- FAILS-ON-REVERT (replay the chain without 20281129003969): S-01 fails on its
-- first call (anon may execute the resolver), S-02 on the username lookup
-- (email comes back), S-03 on its first update (it succeeds), S-06 / S-07 /
-- S-08 / S-09 (functions missing), S-10 (privileges still granted).
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t3969s2_as(p_role text, p_user uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN json_build_object('role', p_role)::text
         ELSE json_build_object('sub', p_user, 'role', p_role)::text END, true);
END $fn$;

CREATE TEMP TABLE t3969s2_ids (tag text PRIMARY KEY, id uuid NOT NULL, email text NOT NULL);
GRANT SELECT ON t3969s2_ids TO anon, authenticated, service_role;

-- Fixture: owner, friend, partner (paired), asked (pending pair request),
-- stranger, blocker (blocked the owner), admin, newcomer (no profile yet).
DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_email text;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['owner', 'friend', 'partner', 'asked', 'stranger', 'blocker', 'admin', 'newcomer'] LOOP
    v_id := gen_random_uuid();
    v_email := 't3969s2-' || v_tag || '-' || v_id || '@example.test';
    INSERT INTO auth.users(id, email) VALUES (v_id, v_email);
    INSERT INTO t3969s2_ids VALUES (v_tag, v_id, v_email);
  END LOOP;

  -- The signup trigger may already have created rows; make the fixture exact.
  DELETE FROM public.profiles WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'newcomer');
  INSERT INTO public.profiles(id, email)
    SELECT id, email FROM t3969s2_ids WHERE tag <> 'newcomer'
    ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles p
     SET username = 't3969s2_' || i.tag || '_' || left(i.id::text, 8),
         first_name = initcap(i.tag), last_name = 'Fixture',
         birthday = DATE '1990-05-17', gender = 'woman', location = 'Lagos ' || i.tag,
         visibility_mode = 'friends', is_beta_tester = false, is_seed = false,
         account_type = NULL, email_verified = false, active = true,
         explorer_deleted_at = NULL
    FROM t3969s2_ids i
   WHERE p.id = i.id;

  INSERT INTO public.admin_users(email, role, status)
    SELECT email, 'admin', 'active' FROM t3969s2_ids WHERE tag = 'admin';

  INSERT INTO public.friends(user_id, friend_user_id, status)
    SELECT o.id, f.id, 'accepted' FROM t3969s2_ids o, t3969s2_ids f
     WHERE o.tag = 'owner' AND f.tag = 'friend';
  INSERT INTO public.blocked_users(blocker_id, blocked_id)
    SELECT b.id, o.id FROM t3969s2_ids b, t3969s2_ids o
     WHERE b.tag = 'blocker' AND o.tag = 'owner';
END
$fixture$;

-- Relationship rows only (their own triggers and FKs are not under test here).
SET LOCAL session_replication_role = replica;
WITH rq AS (
  INSERT INTO public.pair_requests(sender_id, receiver_id, status, visibility)
    SELECT o.id, p.id, 'accepted', 'visible' FROM t3969s2_ids o, t3969s2_ids p WHERE o.tag = 'owner' AND p.tag = 'partner'
  RETURNING id, sender_id, receiver_id
)
INSERT INTO public.pairings(user_a_id, user_b_id, pair_request_id)
  SELECT LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), id FROM rq;
INSERT INTO public.pair_requests(sender_id, receiver_id, status, visibility)
  SELECT o.id, a.id, 'pending', 'visible' FROM t3969s2_ids o, t3969s2_ids a WHERE o.tag = 'owner' AND a.tag = 'asked';
SET LOCAL session_replication_role = origin;

-- ── S-01 signed-out callers ────────────────────────────────────────────────
SELECT pg_temp.t3969s2_as('anon', NULL);
SET LOCAL ROLE anon;
DO $s01$
DECLARE
  v_n bigint;
BEGIN
  BEGIN
    SELECT count(*) INTO v_n FROM public.resolve_user_visibility_by_identifier('t3969s2_owner');
    RAISE EXCEPTION 'S-01: anon executed resolve_user_visibility_by_identifier';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.get_my_profile();
    RAISE EXCEPTION 'S-01: anon executed get_my_profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.issue_3969_resolve_person('t3969s2_owner');
    RAISE EXCEPTION 'S-01: anon executed issue_3969_resolve_person';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.issue_3969_pair_partner_details(ARRAY[gen_random_uuid()]);
    RAISE EXCEPTION 'S-01: anon executed issue_3969_pair_partner_details';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.issue_3969_friend_profile(gen_random_uuid());
    RAISE EXCEPTION 'S-01: anon executed issue_3969_friend_profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.issue_3969_admin_profile_contacts(NULL, 'x@example.test');
    RAISE EXCEPTION 'S-01: anon executed issue_3969_admin_profile_contacts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.profiles_with_segment;
    RAISE EXCEPTION 'S-01: anon read profiles_with_segment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$s01$;
RESET ROLE;

-- ── S-02 the existing lookup ───────────────────────────────────────────────
DO $s02_shape$
BEGIN
  IF pg_get_function_result('public.resolve_user_visibility_by_identifier(text)'::regprocedure)
       IS DISTINCT FROM 'TABLE(user_exists boolean, can_view boolean, is_blocked boolean, profile_id uuid, username text, email text)' THEN
    RAISE EXCEPTION 'S-02: resolve_user_visibility_by_identifier result shape changed: %',
      pg_get_function_result('public.resolve_user_visibility_by_identifier(text)'::regprocedure);
  END IF;
END
$s02_shape$;

SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
DO $s02$
DECLARE
  r record;
  v_stranger t3969s2_ids%ROWTYPE;
  v_blocker t3969s2_ids%ROWTYPE;
BEGIN
  SELECT * INTO v_stranger FROM t3969s2_ids WHERE tag = 'stranger';
  SELECT * INTO v_blocker FROM t3969s2_ids WHERE tag = 'blocker';

  SELECT * INTO r FROM public.resolve_user_visibility_by_identifier(
    't3969s2_stranger_' || left(v_stranger.id::text, 8));
  IF NOT r.user_exists OR r.profile_id IS DISTINCT FROM v_stranger.id THEN
    RAISE EXCEPTION 'S-02: username lookup did not resolve (%)', row_to_json(r);
  END IF;
  IF r.email IS NOT NULL THEN
    RAISE EXCEPTION 'S-02: username lookup returned an email';
  END IF;

  -- Mixed case and padding: the caller typed this email.
  SELECT * INTO r FROM public.resolve_user_visibility_by_identifier('  ' || upper(v_stranger.email) || ' ');
  IF NOT r.user_exists OR r.profile_id IS DISTINCT FROM v_stranger.id OR r.email IS DISTINCT FROM v_stranger.email THEN
    RAISE EXCEPTION 'S-02: email lookup changed (%)', row_to_json(r);
  END IF;

  SELECT * INTO r FROM public.resolve_user_visibility_by_identifier('t3969s2-nobody@example.test');
  IF r.user_exists OR r.profile_id IS NOT NULL OR r.email IS NOT NULL THEN
    RAISE EXCEPTION 'S-02: unknown email resolved (%)', row_to_json(r);
  END IF;

  -- Block flags unchanged.
  SELECT * INTO r FROM public.resolve_user_visibility_by_identifier(
    't3969s2_blocker_' || left(v_blocker.id::text, 8));
  IF r.can_view OR NOT r.is_blocked OR r.email IS NOT NULL THEN
    RAISE EXCEPTION 'S-02: blocked lookup changed (%)', row_to_json(r);
  END IF;
END
$s02$;
RESET ROLE;

-- Two rows carrying one email in different case (the unique constraint is
-- case-sensitive, lookups are not): the row whose sign-in email it is wins,
-- even when the other row is older.
UPDATE public.profiles SET email = upper((SELECT email FROM t3969s2_ids WHERE tag = 'friend')),
                           created_at = '2000-01-01'
 WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'stranger');
SET LOCAL ROLE authenticated;
DO $s02b$
DECLARE
  r record;
  q record;
BEGIN
  SELECT * INTO r FROM public.resolve_user_visibility_by_identifier((SELECT email FROM t3969s2_ids WHERE tag = 'friend'));
  IF r.profile_id IS DISTINCT FROM (SELECT id FROM t3969s2_ids WHERE tag = 'friend') THEN
    RAISE EXCEPTION 'S-02: shared email resolved to the row that does not own it';
  END IF;
  SELECT * INTO q FROM public.issue_3969_resolve_person((SELECT email FROM t3969s2_ids WHERE tag = 'friend'));
  IF q.profile_id IS DISTINCT FROM r.profile_id THEN
    RAISE EXCEPTION 'S-07: resolve_person and the existing lookup disagree on a shared email';
  END IF;
END
$s02b$;
RESET ROLE;
UPDATE public.profiles SET email = (SELECT email FROM t3969s2_ids WHERE tag = 'stranger')
 WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'stranger');

-- ── S-03 account-control fields on the caller's own row ────────────────────
SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
DO $s03$
DECLARE
  v_owner uuid := (SELECT id FROM t3969s2_ids WHERE tag = 'owner');
  v_stmt text;
  v_n int;
BEGIN
  FOREACH v_stmt IN ARRAY ARRAY[
    'UPDATE public.profiles SET is_beta_tester = true WHERE id = $1',
    'UPDATE public.profiles SET is_seed = true WHERE id = $1',
    'UPDATE public.profiles SET account_type = ''business'' WHERE id = $1',
    'UPDATE public.profiles SET email_verified = true WHERE id = $1',
    'UPDATE public.profiles SET referral_code = ''MGL-T3969S2CODE'' WHERE id = $1',
    'UPDATE public.profiles SET active = false WHERE id = $1',
    'UPDATE public.profiles SET explorer_deleted_at = now() WHERE id = $1',
    'UPDATE public.profiles SET email = ''t3969s2-someone-else@example.test'' WHERE id = $1',
    'UPDATE public.profiles SET email = NULL WHERE id = $1',
    'UPDATE public.profiles SET bio = ''with a guarded field'', is_beta_tester = true WHERE id = $1'
  ] LOOP
    BEGIN
      EXECUTE v_stmt USING v_owner;
      RAISE EXCEPTION 'S-03: accepted: %', v_stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE 'profiles.% is managed by Mingla' THEN
        RAISE EXCEPTION 'S-03: unexpected refusal for %: %', v_stmt, SQLERRM;
      END IF;
    END;
  END LOOP;

  -- Email to the caller's own sign-in email (case-insensitive) is allowed.
  UPDATE public.profiles SET email = upper((SELECT email FROM t3969s2_ids WHERE tag = 'owner')) WHERE id = v_owner;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'S-03: own sign-in email refused'; END IF;

  -- The profile editor shapes still work, and re-sending stored values is not a change.
  UPDATE public.profiles
     SET first_name = 'Owner', last_name = 'Edited', bio = 'hello', birthday = DATE '1991-01-02',
         gender = 'man', country = 'NG', preferred_language = 'en', timezone = 'Africa/Lagos',
         visibility_mode = 'friends', show_activity = true, coach_mark_step = 3,
         has_completed_onboarding = true, onboarding_step = 4, location = 'Lagos',
         is_beta_tester = false, is_seed = false, active = true, account_type = NULL,
         email_verified = false, explorer_deleted_at = NULL
   WHERE id = v_owner;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'S-03: ordinary own-row update touched % rows', v_n; END IF;
END
$s03$;
RESET ROLE;

DO $s03_check$
DECLARE
  r public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.profiles WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'owner');
  IF r.is_beta_tester OR r.is_seed OR r.account_type IS NOT NULL OR r.email_verified OR NOT r.active
     OR r.explorer_deleted_at IS NOT NULL OR r.referral_code = 'MGL-T3969S2CODE' THEN
    RAISE EXCEPTION 'S-03: a refused field moved (%)', row_to_json(r);
  END IF;
  IF r.bio <> 'hello' OR r.display_name <> 'Owner Edited' THEN
    RAISE EXCEPTION 'S-03: ordinary edit lost (bio %, display_name %)', r.bio, r.display_name;
  END IF;
END
$s03_check$;

-- Reactivation: the server marks the account deleted, the app clears it.
SET LOCAL ROLE service_role;
UPDATE public.profiles SET explorer_deleted_at = now() WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'owner');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $s03_reactivate$
DECLARE
  v_owner uuid := (SELECT id FROM t3969s2_ids WHERE tag = 'owner');
  v_n int;
BEGIN
  BEGIN
    UPDATE public.profiles SET explorer_deleted_at = now() - interval '1 day' WHERE id = v_owner;
    RAISE EXCEPTION 'S-03: client moved explorer_deleted_at to another time';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- The exact reactivation body the app sends.
  UPDATE public.profiles SET explorer_deleted_at = NULL, has_completed_onboarding = false WHERE id = v_owner;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'S-03: reactivation refused'; END IF;
END
$s03_reactivate$;
RESET ROLE;
DO $s03_reactivated$
BEGIN
  IF (SELECT explorer_deleted_at FROM public.profiles WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'owner')) IS NOT NULL THEN
    RAISE EXCEPTION 'S-03: reactivation did not clear explorer_deleted_at';
  END IF;
END
$s03_reactivated$;

-- ── S-04 a new own row ─────────────────────────────────────────────────────
SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'newcomer'));
SET LOCAL ROLE authenticated;
DO $s04$
DECLARE
  v_me t3969s2_ids%ROWTYPE;
  v_stmt text;
  v_n int;
BEGIN
  SELECT * INTO v_me FROM t3969s2_ids WHERE tag = 'newcomer';
  FOREACH v_stmt IN ARRAY ARRAY[
    'INSERT INTO public.profiles(id, email, account_type) VALUES ($1, $2, ''business'')',
    'INSERT INTO public.profiles(id, email, is_seed) VALUES ($1, $2, true)',
    'INSERT INTO public.profiles(id, email, email_verified) VALUES ($1, $2, true)',
    'INSERT INTO public.profiles(id, email, referral_code) VALUES ($1, $2, ''MGL-T3969S2PICK'')',
    'INSERT INTO public.profiles(id, email, active) VALUES ($1, $2, false)',
    'INSERT INTO public.profiles(id, email, explorer_deleted_at) VALUES ($1, $2, now())',
    'INSERT INTO public.profiles(id, email) VALUES ($1, ''t3969s2-not-mine@example.test'')'
  ] LOOP
    BEGIN
      EXECUTE v_stmt USING v_me.id, v_me.email;
      RAISE EXCEPTION 'S-04: accepted: %', v_stmt;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- The app's fallback insert (useAuthSimple) still works.
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, created_at, updated_at)
    VALUES (v_me.id, v_me.email, 'newcomer', 'newcomer', '', now(), now());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'S-04: ordinary own insert refused'; END IF;
END
$s04$;
RESET ROLE;
DO $s04_check$
BEGIN
  IF (SELECT referral_code FROM public.profiles WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'newcomer')) IS NULL THEN
    RAISE EXCEPTION 'S-04: the referral code trigger did not run after the guard';
  END IF;
END
$s04_check$;

-- ── S-05 admins, service role and definer code ─────────────────────────────
SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'admin'));
SET LOCAL ROLE authenticated;
UPDATE public.profiles
   SET is_beta_tester = true, account_type = 'business', email = 't3969s2-admin-set@example.test'
 WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'stranger');
RESET ROLE;

SELECT pg_temp.t3969s2_as('service_role', NULL);
SET LOCAL ROLE service_role;
UPDATE public.profiles SET is_seed = true, active = false, explorer_deleted_at = now(), email_verified = true
 WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'stranger');
RESET ROLE;

-- A SECURITY DEFINER writer called by a signed-in user (the shape of
-- handle_new_user and the admin_* helpers) runs as its owner.
CREATE FUNCTION public.t3969s2_definer_writer(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  UPDATE public.profiles SET referral_code = 'MGL-T3969S2DEF', is_beta_tester = false WHERE id = p_id;
$fn$;
GRANT EXECUTE ON FUNCTION public.t3969s2_definer_writer(uuid) TO authenticated;
SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
SELECT public.t3969s2_definer_writer((SELECT id FROM t3969s2_ids WHERE tag = 'stranger'));
RESET ROLE;

DO $s05$
DECLARE
  r public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.profiles WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'stranger');
  IF r.account_type IS DISTINCT FROM 'business' OR r.email IS DISTINCT FROM 't3969s2-admin-set@example.test' THEN
    RAISE EXCEPTION 'S-05: admin update did not land (%)', row_to_json(r);
  END IF;
  IF NOT r.is_seed OR r.active OR r.explorer_deleted_at IS NULL OR NOT r.email_verified THEN
    RAISE EXCEPTION 'S-05: service role update did not land (%)', row_to_json(r);
  END IF;
  IF r.referral_code IS DISTINCT FROM 'MGL-T3969S2DEF' OR r.is_beta_tester THEN
    RAISE EXCEPTION 'S-05: definer update did not land (%)', row_to_json(r);
  END IF;
END
$s05$;
UPDATE public.profiles
   SET email = (SELECT email FROM t3969s2_ids WHERE tag = 'stranger'), is_seed = false, active = true,
       explorer_deleted_at = NULL, email_verified = false, account_type = NULL
 WHERE id = (SELECT id FROM t3969s2_ids WHERE tag = 'stranger');

-- ── S-06 get_my_profile ────────────────────────────────────────────────────
SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
DO $s06$
DECLARE
  v_n int;
  r public.profiles%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_n FROM public.get_my_profile();
  IF v_n <> 1 THEN RAISE EXCEPTION 'S-06: get_my_profile returned % rows', v_n; END IF;
  SELECT * INTO r FROM public.get_my_profile();
  IF r.id IS DISTINCT FROM (SELECT id FROM t3969s2_ids WHERE tag = 'owner')
     OR lower(r.email) IS DISTINCT FROM lower((SELECT email FROM t3969s2_ids WHERE tag = 'owner'))
     OR r.birthday IS DISTINCT FROM DATE '1991-01-02' THEN
    RAISE EXCEPTION 'S-06: get_my_profile returned the wrong row or fields (%)', row_to_json(r);
  END IF;
END
$s06$;
RESET ROLE;

SELECT pg_temp.t3969s2_as('authenticated', NULL);
SET LOCAL ROLE authenticated;
DO $s06b$
BEGIN
  IF (SELECT count(*) FROM public.get_my_profile()) <> 0 THEN
    RAISE EXCEPTION 'S-06: get_my_profile returned rows without a signed-in caller';
  END IF;
END
$s06b$;
RESET ROLE;

-- ── S-07 issue_3969_resolve_person ─────────────────────────────────────────
DO $s07_shape$
BEGIN
  IF pg_get_function_result('public.issue_3969_resolve_person(text)'::regprocedure) ILIKE '%email%' THEN
    RAISE EXCEPTION 'S-07: resolve_person result carries an email column';
  END IF;
END
$s07_shape$;

SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
DO $s07$
DECLARE
  v_s t3969s2_ids%ROWTYPE;
  r record;
BEGIN
  SELECT * INTO v_s FROM t3969s2_ids WHERE tag = 'stranger';
  SELECT * INTO r FROM public.issue_3969_resolve_person(v_s.email);
  IF NOT r.user_exists OR r.profile_id IS DISTINCT FROM v_s.id OR NOT r.can_view OR r.is_blocked THEN
    RAISE EXCEPTION 'S-07: by email (%)', row_to_json(r);
  END IF;
  SELECT * INTO r FROM public.issue_3969_resolve_person(upper('t3969s2_stranger_' || left(v_s.id::text, 8)));
  IF r.profile_id IS DISTINCT FROM v_s.id THEN RAISE EXCEPTION 'S-07: by username (%)', row_to_json(r); END IF;
  SELECT * INTO r FROM public.issue_3969_resolve_person(v_s.id::text);
  IF r.profile_id IS DISTINCT FROM v_s.id THEN RAISE EXCEPTION 'S-07: by id (%)', row_to_json(r); END IF;
  SELECT * INTO r FROM public.issue_3969_resolve_person((SELECT id FROM t3969s2_ids WHERE tag = 'blocker')::text);
  IF r.can_view OR NOT r.is_blocked THEN RAISE EXCEPTION 'S-07: block flags (%)', row_to_json(r); END IF;
  SELECT * INTO r FROM public.issue_3969_resolve_person('   ');
  IF r.user_exists THEN RAISE EXCEPTION 'S-07: blank identifier resolved'; END IF;
END
$s07$;
RESET ROLE;

-- ── S-08 relationship-scoped reads ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
DO $s08$
DECLARE
  v_ids uuid[];
  r record;
  v_n int;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM t3969s2_ids WHERE tag IN ('partner', 'asked', 'stranger', 'blocker', 'friend');

  SELECT count(*) INTO v_n FROM public.issue_3969_pair_partner_details(v_ids);
  IF v_n <> 4 THEN RAISE EXCEPTION 'S-08: expected 4 rows (blocker left out), got %', v_n; END IF;

  FOR r IN SELECT i.tag, d.* FROM public.issue_3969_pair_partner_details(v_ids) d JOIN t3969s2_ids i ON i.id = d.id LOOP
    IF r.first_name IS NULL THEN RAISE EXCEPTION 'S-08: % lost its name', r.tag; END IF;
    IF r.tag IN ('partner', 'asked') AND (r.birthday IS DISTINCT FROM DATE '1990-05-17' OR r.gender IS DISTINCT FROM 'woman') THEN
      RAISE EXCEPTION 'S-08: % should see birthday / gender (%)', r.tag, row_to_json(r);
    END IF;
    IF r.tag IN ('stranger', 'friend') AND (r.birthday IS NOT NULL OR r.gender IS NOT NULL) THEN
      RAISE EXCEPTION 'S-08: % birthday / gender leaked (%)', r.tag, row_to_json(r);
    END IF;
  END LOOP;

  -- Friend profile sheet.
  SELECT * INTO r FROM public.issue_3969_friend_profile((SELECT id FROM t3969s2_ids WHERE tag = 'friend'));
  IF r.location IS DISTINCT FROM 'Lagos friend' OR r.first_name IS DISTINCT FROM 'Friend' THEN
    RAISE EXCEPTION 'S-08: friend sheet (%)', row_to_json(r);
  END IF;
  SELECT * INTO r FROM public.issue_3969_friend_profile((SELECT id FROM t3969s2_ids WHERE tag = 'stranger'));
  IF r.id IS NULL OR r.location IS NOT NULL THEN
    RAISE EXCEPTION 'S-08: stranger sheet location leaked or row missing (%)', row_to_json(r);
  END IF;
  SELECT * INTO r FROM public.issue_3969_friend_profile((SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
  IF r.location IS DISTINCT FROM 'Lagos' THEN RAISE EXCEPTION 'S-08: own sheet location (%)', row_to_json(r); END IF;
  SELECT count(*) INTO v_n FROM public.issue_3969_friend_profile((SELECT id FROM t3969s2_ids WHERE tag = 'blocker'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'S-08: a profile whose owner blocked the caller came back'; END IF;
END
$s08$;
RESET ROLE;

-- The friend view is symmetric: the friend sees the owner's location.
SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'friend'));
SET LOCAL ROLE authenticated;
DO $s08b$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.issue_3969_friend_profile((SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
  IF r.location IS DISTINCT FROM 'Lagos' THEN RAISE EXCEPTION 'S-08: reverse friend sheet (%)', row_to_json(r); END IF;
  -- The friend is not paired with the owner: no birthday.
  SELECT * INTO r FROM public.issue_3969_pair_partner_details(ARRAY[(SELECT id FROM t3969s2_ids WHERE tag = 'owner')]);
  IF r.birthday IS NOT NULL THEN RAISE EXCEPTION 'S-08: friend read the owner''s birthday'; END IF;
END
$s08b$;
RESET ROLE;

-- ── S-09 admin read ────────────────────────────────────────────────────────
SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
DO $s09$
DECLARE
  v_n int;
BEGIN
  BEGIN
    SELECT count(*) INTO v_n FROM public.issue_3969_admin_profile_contacts(NULL, (SELECT email FROM t3969s2_ids WHERE tag = 'stranger'));
    RAISE EXCEPTION 'S-09: a non-admin read admin profile contacts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$s09$;
RESET ROLE;

SELECT pg_temp.t3969s2_as('authenticated', (SELECT id FROM t3969s2_ids WHERE tag = 'admin'));
SET LOCAL ROLE authenticated;
DO $s09b$
DECLARE
  r record;
  v_n int;
BEGIN
  SELECT * INTO r FROM public.issue_3969_admin_profile_contacts(NULL, upper((SELECT email FROM t3969s2_ids WHERE tag = 'stranger')));
  IF r.id IS DISTINCT FROM (SELECT id FROM t3969s2_ids WHERE tag = 'stranger') OR r.email IS NULL THEN
    RAISE EXCEPTION 'S-09: admin email lookup (%)', row_to_json(r);
  END IF;
  SELECT count(*) INTO v_n FROM public.issue_3969_admin_profile_contacts(
    (SELECT array_agg(id) FROM t3969s2_ids WHERE tag IN ('owner', 'friend')), NULL);
  IF v_n <> 2 THEN RAISE EXCEPTION 'S-09: admin id lookup returned % rows', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.issue_3969_admin_profile_contacts(NULL, NULL);
  IF v_n <> 0 THEN RAISE EXCEPTION 'S-09: an empty admin lookup returned rows'; END IF;
END
$s09b$;
RESET ROLE;

-- ── S-10 privileges ────────────────────────────────────────────────────────
DO $s10$
DECLARE
  v_priv text;
  v_fn text;
  v_bad text;
BEGIN
  FOREACH v_priv IN ARRAY ARRAY['TRUNCATE', 'TRIGGER', 'REFERENCES', 'DELETE'] LOOP
    IF has_table_privilege('authenticated', 'public.profiles', v_priv) THEN
      RAISE EXCEPTION 'S-10: authenticated still holds % on profiles', v_priv;
    END IF;
    IF has_table_privilege('anon', 'public.profiles', v_priv) THEN
      RAISE EXCEPTION 'S-10: anon holds % on profiles', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.profiles', v_priv) THEN
      RAISE EXCEPTION 'S-10: authenticated lost % on profiles (installed apps need it)', v_priv;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.profiles_with_segment', 'SELECT')
     OR has_table_privilege('anon', 'public.profiles_with_segment', 'SELECT') THEN
    RAISE EXCEPTION 'S-10: profiles_with_segment is still readable by a client role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.profiles', 'DELETE') THEN
    RAISE EXCEPTION 'S-10: service_role lost DELETE on profiles';
  END IF;

  IF has_function_privilege('anon', 'public.resolve_user_visibility_by_identifier(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.resolve_user_visibility_by_identifier(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S-10: resolver EXECUTE is not authenticated-only';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_my_profile()',
    'public.issue_3969_resolve_person(text)',
    'public.issue_3969_pair_partner_details(uuid[])',
    'public.issue_3969_friend_profile(uuid)',
    'public.issue_3969_admin_profile_contacts(uuid[],text)',
    'public.issue_3969_is_own_auth_email(text)',
    'public.resolve_user_visibility_by_identifier(text)'
  ] LOOP
    SELECT CASE
             WHEN NOT p.prosecdef THEN 'not SECURITY DEFINER'
             WHEN NOT COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp'] THEN 'search_path not pinned'
             WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon may execute'
             WHEN EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'PUBLIC may execute'
             WHEN NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'authenticated may not execute'
           END
      INTO v_bad
      FROM pg_proc p WHERE p.oid = v_fn::regprocedure;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'S-10: % %', v_fn, v_bad;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'public.issue_3969_profiles_account_fields_server_only()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S-10: the guard trigger function is directly executable';
  END IF;
END
$s10$;

ROLLBACK;

\echo 'issue #3969 step 2 implementor suite: PASS'
