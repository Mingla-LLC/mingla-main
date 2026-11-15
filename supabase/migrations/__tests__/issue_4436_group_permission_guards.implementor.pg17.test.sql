\set ON_ERROR_STOP on

-- #4436 migration 20280708014436: guard who can change group membership and
-- group settings (session_participants and collaboration_sessions), on the
-- fully replayed PG17 schema. Everything is rolled back.
--
-- MINGLA-INVARIANT: I-4436-GROUP-WRITE-GUARD | issue #4436 | app client roles (authenticated, anon) never change admin status, acceptance or ownership of a group or its member rows; only server functions that check the caller do (T-REFUSED, T-ALLOWED, T-SERVER, T-REVERT, T-CATALOG)
--
-- Actors: A creator (accepted admin), M accepted member, P pending invitee,
-- V accepted member, X not in the group.
--   T-REFUSED  each client write outside the allowed fields raises 42501.
--   T-ALLOWED  each legitimate client write still changes the row.
--   T-SERVER   a postgres write and a SECURITY DEFINER function still change
--              admin status and acceptance.
--   T-REVERT   with both triggers dropped (inside this transaction) a
--              member's own admin change succeeds, so T-REFUSED fails
--              without the migration.
--   T-CATALOG  both triggers exist, are enabled, BEFORE and FOR EACH ROW;
--              both functions are SECURITY INVOKER with a pinned search_path
--              and are not executable by client roles.
-- Run from the repository root as postgres.

BEGIN;

CREATE TEMP TABLE t4436_ids(k text PRIMARY KEY, v uuid NOT NULL);
INSERT INTO t4436_ids VALUES
  ('A', '44360000-0000-4000-8000-00000000000a'),
  ('M', '44360000-0000-4000-8000-00000000000b'),
  ('P', '44360000-0000-4000-8000-00000000000c'),
  ('V', '44360000-0000-4000-8000-00000000000d'),
  ('X', '44360000-0000-4000-8000-00000000000e'),
  ('S', '44360000-0000-4000-8000-0000000000f1');
GRANT SELECT ON t4436_ids TO authenticated;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM t4436_ids WHERE k <> 'S' LOOP
    INSERT INTO auth.users(id, email) VALUES (r.v, 'i4436-' || lower(r.k) || '@example.test');
    INSERT INTO public.profiles(id, email) VALUES (r.v, 'i4436-' || lower(r.k) || '@example.test')
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

INSERT INTO public.collaboration_sessions(id, name, created_by, status, session_type)
  SELECT (SELECT v FROM t4436_ids WHERE k = 'S'), 'i4436 group',
         (SELECT v FROM t4436_ids WHERE k = 'A'), 'active', 'group_hangout';
INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin)
  SELECT (SELECT v FROM t4436_ids WHERE k = 'S'), v, k <> 'P', k = 'A'
    FROM t4436_ids WHERE k IN ('A', 'M', 'P', 'V');

-- Helpers live in public so the authenticated role can resolve them; the
-- transaction rolls them back.
CREATE FUNCTION public.t4436_k(p text) RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT v FROM pg_temp.t4436_ids WHERE k = p $f$;
GRANT EXECUTE ON FUNCTION public.t4436_k(text) TO authenticated;

CREATE FUNCTION pg_temp.t4436_act(p_actor text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', public.t4436_k(p_actor)::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', public.t4436_k(p_actor), 'role', 'authenticated')::text, true);
END $f$;

-- Runs p_stmt as the authenticated client p_actor; it must raise 42501.
CREATE FUNCTION pg_temp.t4436_refused(p_actor text, p_label text, p_stmt text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.t4436_act(p_actor);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_stmt;
    RAISE EXCEPTION 'not refused' USING ERRCODE = 'XF436';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION 'FAIL T-REFUSED [%] %: expected 42501, got % (%)', p_actor, p_label, SQLSTATE, SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'PASS T-REFUSED [%] %', p_actor, p_label;
END $f$;

-- Runs p_stmt as the authenticated client p_actor; it must change at least
-- one row and p_check (run as postgres afterwards) must be true. Rolled back.
CREATE FUNCTION pg_temp.t4436_allowed(p_actor text, p_label text, p_stmt text, p_check text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE n bigint; ok boolean;
BEGIN
  PERFORM pg_temp.t4436_act(p_actor);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'postgres', true);
    EXECUTE p_check INTO ok;
    IF n < 1 OR ok IS NOT TRUE THEN
      RAISE EXCEPTION 'rows=% check=%', n, ok USING ERRCODE = 'XF436';
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT436';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'XT436' THEN
      RAISE EXCEPTION 'FAIL T-ALLOWED [%] %: % (%)', p_actor, p_label, SQLERRM, SQLSTATE;
    END IF;
  END;
  RAISE NOTICE 'PASS T-ALLOWED [%] %', p_actor, p_label;
END $f$;

-- T-REFUSED ---------------------------------------------------------------
SELECT pg_temp.t4436_refused('M', 'member sets own is_admin',
  $$UPDATE public.session_participants SET is_admin = true WHERE session_id = t4436_k('S') AND user_id = t4436_k('M')$$);
SELECT pg_temp.t4436_refused('P', 'pending invitee sets own is_admin',
  $$UPDATE public.session_participants SET is_admin = true WHERE session_id = t4436_k('S') AND user_id = t4436_k('P')$$);
SELECT pg_temp.t4436_refused('M', 'member sets own role',
  $$UPDATE public.session_participants SET role = 'admin' WHERE session_id = t4436_k('S') AND user_id = t4436_k('M')$$);
SELECT pg_temp.t4436_refused('P', 'pending invitee sets own has_accepted',
  $$UPDATE public.session_participants SET has_accepted = true WHERE session_id = t4436_k('S') AND user_id = t4436_k('P')$$);
SELECT pg_temp.t4436_refused('M', 'member changes own row user_id',
  $$UPDATE public.session_participants SET user_id = t4436_k('X') WHERE session_id = t4436_k('S') AND user_id = t4436_k('M')$$);
SELECT pg_temp.t4436_refused('M', 'member changes group created_by',
  $$UPDATE public.collaboration_sessions SET created_by = t4436_k('M') WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_refused('P', 'pending invitee changes group created_by',
  $$UPDATE public.collaboration_sessions SET created_by = t4436_k('P') WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_refused('A', 'creator changes group created_by',
  $$UPDATE public.collaboration_sessions SET created_by = t4436_k('M') WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_refused('M', 'member changes max_participants',
  $$UPDATE public.collaboration_sessions SET max_participants = 1000 WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_refused('M', 'member changes invite_code',
  $$UPDATE public.collaboration_sessions SET invite_code = 'I4436NEW' WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_refused('M', 'member changes session_type',
  $$UPDATE public.collaboration_sessions SET session_type = 'board' WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_refused('P', 'pending invitee renames group',
  $$UPDATE public.collaboration_sessions SET name = 'i4436 renamed' WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_refused('M', 'member adds someone as accepted admin',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin) VALUES (t4436_k('S'), t4436_k('X'), true, true)$$);
SELECT pg_temp.t4436_refused('M', 'member adds someone as pending admin',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin) VALUES (t4436_k('S'), t4436_k('X'), false, true)$$);
SELECT pg_temp.t4436_refused('M', 'member adds someone as accepted',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (t4436_k('S'), t4436_k('X'), true)$$);
SELECT pg_temp.t4436_refused('P', 'pending invitee adds someone as accepted admin',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin) VALUES (t4436_k('S'), t4436_k('X'), true, true)$$);
SELECT pg_temp.t4436_refused('X', 'non-member adds own row as accepted admin',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin) VALUES (t4436_k('S'), t4436_k('X'), true, true)$$);
SELECT pg_temp.t4436_refused('X', 'non-member adds own row as accepted',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (t4436_k('S'), t4436_k('X'), true)$$);
SELECT pg_temp.t4436_refused('P', 'pending invitee invites someone',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436_k('S'), t4436_k('X'))$$);

-- T-ALLOWED ---------------------------------------------------------------
SELECT pg_temp.t4436_allowed('M', 'member mutes own notifications',
  $$UPDATE public.session_participants SET notifications_muted = true WHERE session_id = t4436_k('S') AND user_id = t4436_k('M')$$,
  $$SELECT notifications_muted FROM public.session_participants WHERE session_id = t4436_k('S') AND user_id = t4436_k('M')$$);
SELECT pg_temp.t4436_allowed('A', 'creator makes a member admin',
  $$UPDATE public.session_participants SET is_admin = true WHERE session_id = t4436_k('S') AND user_id = t4436_k('M')$$,
  $$SELECT is_admin FROM public.session_participants WHERE session_id = t4436_k('S') AND user_id = t4436_k('M')$$);
SELECT pg_temp.t4436_allowed('A', 'creator removes own admin flag',
  $$UPDATE public.session_participants SET is_admin = false WHERE session_id = t4436_k('S') AND user_id = t4436_k('A')$$,
  $$SELECT NOT is_admin FROM public.session_participants WHERE session_id = t4436_k('S') AND user_id = t4436_k('A')$$);
SELECT pg_temp.t4436_allowed('M', 'accepted member changes group status',
  $$UPDATE public.collaboration_sessions SET status = 'voting' WHERE id = t4436_k('S')$$,
  $$SELECT status = 'voting' FROM public.collaboration_sessions WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_allowed('M', 'accepted member renames group and touches activity time',
  $$UPDATE public.collaboration_sessions SET name = 'i4436 renamed', last_activity_at = now() WHERE id = t4436_k('S')$$,
  $$SELECT name = 'i4436 renamed' FROM public.collaboration_sessions WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_allowed('A', 'creator changes invite_code and max_participants',
  $$UPDATE public.collaboration_sessions SET invite_code = 'I4436NEW', max_participants = 12 WHERE id = t4436_k('S')$$,
  $$SELECT invite_code = 'I4436NEW' AND max_participants = 12 FROM public.collaboration_sessions WHERE id = t4436_k('S')$$);
SELECT pg_temp.t4436_allowed('X', 'invite-code join adds own pending row',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436_k('S'), t4436_k('X'))$$,
  $$SELECT has_accepted IS NOT TRUE AND is_admin IS NOT TRUE FROM public.session_participants WHERE session_id = t4436_k('S') AND user_id = t4436_k('X')$$);
SELECT pg_temp.t4436_allowed('M', 'accepted member invites someone as pending',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (t4436_k('S'), t4436_k('X'), false)$$,
  $$SELECT has_accepted IS NOT TRUE FROM public.session_participants WHERE session_id = t4436_k('S') AND user_id = t4436_k('X')$$);
SELECT pg_temp.t4436_allowed('A', 'creator invites someone as pending',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (t4436_k('S'), t4436_k('X'), false)$$,
  $$SELECT has_accepted IS NOT TRUE FROM public.session_participants WHERE session_id = t4436_k('S') AND user_id = t4436_k('X')$$);

-- T-SERVER ----------------------------------------------------------------
CREATE FUNCTION public.t4436_server_accept_and_promote(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
  $f$ UPDATE public.session_participants SET has_accepted = true, is_admin = true
       WHERE session_id = public.t4436_k('S') AND user_id = p_user $f$;
GRANT EXECUTE ON FUNCTION public.t4436_server_accept_and_promote(uuid) TO authenticated;

DO $$
DECLARE ok boolean;
BEGIN
  -- a definer function called by a client
  PERFORM pg_temp.t4436_act('P');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.t4436_server_accept_and_promote(public.t4436_k('P'));
  PERFORM set_config('role', 'postgres', true);
  SELECT has_accepted AND is_admin INTO ok FROM public.session_participants
   WHERE session_id = public.t4436_k('S') AND user_id = public.t4436_k('P');
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL T-SERVER definer accept and promote'; END IF;
  RAISE NOTICE 'PASS T-SERVER definer accept and promote';

  -- a direct postgres write
  UPDATE public.session_participants SET is_admin = true
   WHERE session_id = public.t4436_k('S') AND user_id = public.t4436_k('V');
  UPDATE public.collaboration_sessions SET max_participants = 20 WHERE id = public.t4436_k('S');
  SELECT sp.is_admin AND cs.max_participants = 20 INTO ok
    FROM public.session_participants sp JOIN public.collaboration_sessions cs ON cs.id = sp.session_id
   WHERE sp.session_id = public.t4436_k('S') AND sp.user_id = public.t4436_k('V');
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL T-SERVER postgres write'; END IF;
  RAISE NOTICE 'PASS T-SERVER postgres write';
END $$;

-- T-REVERT ----------------------------------------------------------------
DO $$
DECLARE n bigint; ok boolean;
BEGIN
  BEGIN
    DROP TRIGGER issue_4436_guard_member_write ON public.session_participants;
    DROP TRIGGER issue_4436_guard_group_write ON public.collaboration_sessions;
    PERFORM pg_temp.t4436_act('M');
    PERFORM set_config('role', 'authenticated', true);
    UPDATE public.session_participants SET is_admin = true
     WHERE session_id = public.t4436_k('S') AND user_id = public.t4436_k('M');
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'postgres', true);
    SELECT is_admin INTO ok FROM public.session_participants
     WHERE session_id = public.t4436_k('S') AND user_id = public.t4436_k('M');
    IF n <> 1 OR ok IS NOT TRUE THEN
      RAISE EXCEPTION 'without the guards the write was still blocked (rows=%)', n USING ERRCODE = 'XF436';
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT436';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'XT436' THEN
      RAISE EXCEPTION 'FAIL T-REVERT: % (%)', SQLERRM, SQLSTATE;
    END IF;
  END;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('issue_4436_guard_member_write', 'issue_4436_guard_group_write')) <> 2 THEN
    RAISE EXCEPTION 'FAIL T-REVERT: triggers were not restored by the rollback';
  END IF;
  RAISE NOTICE 'PASS T-REVERT without the guards a member''s own admin change succeeds';
END $$;

-- T-CATALOG ---------------------------------------------------------------
DO $$
DECLARE r record; v_count integer := 0;
BEGIN
  FOR r IN
    SELECT t.tgname, t.tgenabled, t.tgtype, c.relname, p.oid AS fn, p.prosecdef, p.proconfig
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND (t.tgname, c.relname, p.proname) IN (
         ('issue_4436_guard_member_write', 'session_participants', 'tg_issue_4436_guard_member_write'),
         ('issue_4436_guard_group_write', 'collaboration_sessions', 'tg_issue_4436_guard_group_write'))
  LOOP
    v_count := v_count + 1;
    IF r.tgenabled <> 'O' THEN RAISE EXCEPTION 'FAIL T-CATALOG % is not enabled (%)', r.tgname, r.tgenabled; END IF;
    IF (r.tgtype & 1) = 0 THEN RAISE EXCEPTION 'FAIL T-CATALOG % is not FOR EACH ROW', r.tgname; END IF;
    IF (r.tgtype & 2) = 0 THEN RAISE EXCEPTION 'FAIL T-CATALOG % is not BEFORE', r.tgname; END IF;
    IF (r.tgtype & 16) = 0 THEN RAISE EXCEPTION 'FAIL T-CATALOG % does not fire on UPDATE', r.tgname; END IF;
    IF r.tgname = 'issue_4436_guard_member_write' AND (r.tgtype & 4) = 0 THEN
      RAISE EXCEPTION 'FAIL T-CATALOG % does not fire on INSERT', r.tgname;
    END IF;
    IF r.prosecdef THEN RAISE EXCEPTION 'FAIL T-CATALOG % function is SECURITY DEFINER', r.tgname; END IF;
    IF NOT coalesce(r.proconfig::text[] @> ARRAY['search_path=public, pg_temp'], false) THEN
      RAISE EXCEPTION 'FAIL T-CATALOG % function search_path not pinned (%)', r.tgname, r.proconfig;
    END IF;
    IF has_function_privilege('authenticated', r.fn, 'EXECUTE') OR has_function_privilege('anon', r.fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL T-CATALOG % function is executable by a client role', r.tgname;
    END IF;
  END LOOP;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL T-CATALOG expected 2 guard triggers, found %', v_count; END IF;
  RAISE NOTICE 'PASS T-CATALOG both guard triggers present and locked down';
END $$;

ROLLBACK;
