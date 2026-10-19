\set ON_ERROR_STOP on

-- Issue #3969 — profile read and write access (adversarial suite). The
-- implementor suite proves the intended paths; this one checks the edges.
--
--   T-01  catalog shape: anon holds no table or column privilege on profiles;
--         authenticated and service_role keep theirs; the "except blocked"
--         policy is scoped to authenticated with its expression unchanged; the
--         phone guard is one BEFORE UPDATE OF phone trigger, SECURITY INVOKER,
--         with a pinned search_path, not executable by client roles.
--   T-02  the guard keys on the role the statement runs as, not on request
--         claims: an authenticated statement carrying a service_role claim is
--         still refused.
--   T-03  an upsert (INSERT ... ON CONFLICT DO UPDATE) cannot change phone.
--   T-04  a refused update is atomic and has no side effects: the other
--         columns in the statement are not written and no pending invite for
--         the number is converted.
--   T-05  an admin_users row that is not active does not unlock the phone edit.
--   T-06  server code running as its owner (SECURITY DEFINER) still sets phone
--         when a signed-in user calls it.
--   T-07  anon DELETE and upsert are refused, as well as SELECT.
--
-- FAILS-ON-REVERT (replay the chain without 20271106003969): T-01 fails on its
-- first privilege assertion; T-02, T-03 and T-05 fail because the update lands.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t3969a_as(p_role text, p_user uuid, p_claim_role text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(p_claim_role, p_role), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', COALESCE(p_claim_role, p_role))::text, true);
END $fn$;

CREATE TEMP TABLE t3969a_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t3969a_ids TO anon, authenticated, service_role;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['owner', 'former_admin', 'inviter'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't3969a-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't3969a-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t3969a_ids VALUES (v_tag, v_id);
  END LOOP;
  UPDATE public.profiles SET phone = NULL, bio = 'original' WHERE id IN (SELECT id FROM t3969a_ids);

  INSERT INTO public.admin_users(email, role, status)
    SELECT 't3969a-former_admin-' || id || '@example.test', 'admin', 'revoked'
      FROM t3969a_ids WHERE tag = 'former_admin';
  INSERT INTO public.pending_invites(inviter_id, phone_e164, status)
    SELECT id, '+15550396911', 'pending' FROM t3969a_ids WHERE tag = 'inviter';
END
$fixture$;

-- ── T-01 catalog shape ─────────────────────────────────────────────────────
DO $t01$
DECLARE
  v_priv text;
  v_n int;
  v_pol record;
  v_fn record;
BEGIN
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.profiles', v_priv) THEN
      RAISE EXCEPTION 'T-01: anon still holds % on profiles', v_priv;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'profiles' AND grantee IN ('anon', 'PUBLIC');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T-01: % column privileges remain for anon/PUBLIC', v_n;
  END IF;

  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.profiles', v_priv)
       OR NOT has_table_privilege('service_role', 'public.profiles', v_priv) THEN
      RAISE EXCEPTION 'T-01: authenticated/service_role lost % on profiles', v_priv;
    END IF;
  END LOOP;

  SELECT * INTO v_pol FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND policyname = 'Profiles viewable except by blocked users';
  IF v_pol.roles::text <> '{authenticated}' OR v_pol.cmd <> 'SELECT' OR v_pol.permissive <> 'PERMISSIVE' THEN
    RAISE EXCEPTION 'T-01: policy shape is roles % cmd % %', v_pol.roles, v_pol.cmd, v_pol.permissive;
  END IF;
  IF v_pol.qual <> '((auth.uid() = id) OR (NOT is_blocked_by(id, auth.uid())))' THEN
    RAISE EXCEPTION 'T-01: policy expression changed: %', v_pol.qual;
  END IF;

  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
     AND t.tgfoid = to_regprocedure('public.issue_3969_profiles_phone_server_only()');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'T-01: expected one phone guard trigger, found %', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'issue_3969_profiles_phone_server_only'
       AND t.tgrelid = 'public.profiles'::regclass
       AND t.tgenabled = 'O'
       AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF phone ON public.profiles FOR EACH ROW%'
  ) THEN
    RAISE EXCEPTION 'T-01: phone guard is not an enabled BEFORE UPDATE OF phone row trigger';
  END IF;

  SELECT p.prosecdef, p.proconfig INTO v_fn FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.issue_3969_profiles_phone_server_only()');
  IF v_fn.prosecdef THEN
    RAISE EXCEPTION 'T-01: phone guard must be SECURITY INVOKER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_fn.proconfig) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'T-01: phone guard has no pinned search_path';
  END IF;
  IF has_function_privilege('anon', 'public.issue_3969_profiles_phone_server_only()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3969_profiles_phone_server_only()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-01: phone guard is executable by a client role';
  END IF;
END
$t01$;

-- ── T-02 a claim is not a role ─────────────────────────────────────────────
SELECT pg_temp.t3969a_as('authenticated', (SELECT id FROM t3969a_ids WHERE tag = 'owner'), 'service_role');
SET LOCAL ROLE authenticated;
DO $t02$
BEGIN
  UPDATE public.profiles SET phone = '+15550396911' WHERE id = (SELECT id FROM t3969a_ids WHERE tag = 'owner');
  RAISE EXCEPTION 'T-02: authenticated statement with a service_role claim changed phone';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$t02$;
RESET ROLE;

-- ── T-03 upsert ────────────────────────────────────────────────────────────
SELECT pg_temp.t3969a_as('authenticated', (SELECT id FROM t3969a_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
DO $t03$
DECLARE
  v_owner uuid := (SELECT id FROM t3969a_ids WHERE tag = 'owner');
BEGIN
  INSERT INTO public.profiles(id, phone) VALUES (v_owner, '+15550396911')
  ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone;
  RAISE EXCEPTION 'T-03: upsert changed phone';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$t03$;

-- ── T-04 refused update is atomic, no side effects ─────────────────────────
DO $t04$
BEGIN
  UPDATE public.profiles SET bio = 'changed', phone = '+15550396911'
   WHERE id = (SELECT id FROM t3969a_ids WHERE tag = 'owner');
  RAISE EXCEPTION 'T-04: combined update changed phone';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$t04$;
RESET ROLE;

DO $t04b$
DECLARE
  v_owner uuid := (SELECT id FROM t3969a_ids WHERE tag = 'owner');
  v_inviter uuid := (SELECT id FROM t3969a_ids WHERE tag = 'inviter');
BEGIN
  IF (SELECT bio FROM public.profiles WHERE id = v_owner) <> 'original'
     OR (SELECT phone FROM public.profiles WHERE id = v_owner) IS NOT NULL THEN
    RAISE EXCEPTION 'T-04: a refused update wrote to the row';
  END IF;
  IF (SELECT status FROM public.pending_invites WHERE inviter_id = v_inviter) <> 'pending'
     OR EXISTS (SELECT 1 FROM public.friend_requests WHERE sender_id = v_inviter AND receiver_id = v_owner) THEN
    RAISE EXCEPTION 'T-04: a refused update converted a pending invite';
  END IF;
END
$t04b$;

-- ── T-05 a non-active admin row unlocks nothing ────────────────────────────
SELECT pg_temp.t3969a_as('authenticated', (SELECT id FROM t3969a_ids WHERE tag = 'former_admin'));
SET LOCAL ROLE authenticated;
DO $t05$
BEGIN
  UPDATE public.profiles SET phone = '+15550396912' WHERE id = (SELECT id FROM t3969a_ids WHERE tag = 'former_admin');
  RAISE EXCEPTION 'T-05: a revoked admin changed phone';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$t05$;
RESET ROLE;

-- ── T-06 owner-run server code still sets phone ────────────────────────────
CREATE FUNCTION pg_temp.t3969a_server_sets_phone(p_id uuid, p_phone text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $fn$
  UPDATE public.profiles SET phone = p_phone WHERE id = p_id;
$fn$;
GRANT EXECUTE ON FUNCTION pg_temp.t3969a_server_sets_phone(uuid, text) TO authenticated;

SELECT pg_temp.t3969a_as('authenticated', (SELECT id FROM t3969a_ids WHERE tag = 'owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3969a_server_sets_phone((SELECT id FROM t3969a_ids WHERE tag = 'owner'), '+15550396911');
RESET ROLE;
DO $t06$
DECLARE
  v_owner uuid := (SELECT id FROM t3969a_ids WHERE tag = 'owner');
  v_inviter uuid := (SELECT id FROM t3969a_ids WHERE tag = 'inviter');
BEGIN
  IF (SELECT phone FROM public.profiles WHERE id = v_owner) IS DISTINCT FROM '+15550396911' THEN
    RAISE EXCEPTION 'T-06: owner-run server code could not set phone';
  END IF;
  IF (SELECT status FROM public.pending_invites WHERE inviter_id = v_inviter) <> 'converted' THEN
    RAISE EXCEPTION 'T-06: invite did not convert on the server path';
  END IF;
END
$t06$;

-- ── T-07 anon write shapes ─────────────────────────────────────────────────
SELECT pg_temp.t3969a_as('anon', NULL);
SET LOCAL ROLE anon;
DO $t07$
DECLARE
  v_owner uuid := (SELECT id FROM t3969a_ids WHERE tag = 'owner');
BEGIN
  BEGIN
    DELETE FROM public.profiles WHERE id = v_owner;
    RAISE EXCEPTION 'T-07: anon delete was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.profiles(id, email) VALUES (v_owner, 'x@example.test')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
    RAISE EXCEPTION 'T-07: anon upsert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.profiles WHERE id = v_owner;
    RAISE EXCEPTION 'T-07: anon point read was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$t07$;
RESET ROLE;

ROLLBACK;

\echo 'issue #3969 adversarial suite: PASS'
