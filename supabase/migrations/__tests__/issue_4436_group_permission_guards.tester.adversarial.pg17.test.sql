\set ON_ERROR_STOP on

-- #4436 migration 20280708014436: independent coverage of the group write
-- guards on session_participants and collaboration_sessions, from angles the
-- implementor suite does not take. Everything is rolled back.
--
-- MINGLA-INVARIANT: I-4436-GROUP-WRITE-GUARD-EDGES | issue #4436 | the group write guards hold for mixed-column writes, upserts, joined updates, NULL values, rejoining, the anon role and session-level settings, while unchanged values and server roles still pass (G-MIXED, G-SAME, G-NULL, G-UPSERT, G-JOIN, G-REJOIN, G-CREATOR, G-LATER, G-ANON, G-SESSION, G-SERVICE)
--
-- Actors: A creator (accepted admin), M accepted member, P pending invitee,
-- V accepted member (keeps the group above its minimum size), X not in the group.
--   G-MIXED    a write that mixes an allowed and a guarded column is refused
--              as a whole and leaves the row unchanged.
--   G-SAME     writing a guarded column with its current value is allowed.
--   G-NULL     NULL is a change for guarded columns; a NULL-valued insert
--              never yields an accepted or admin row.
--   G-UPSERT   INSERT ... ON CONFLICT DO UPDATE goes through the same guard.
--   G-JOIN     UPDATE ... FROM goes through the same guard.
--   G-REJOIN   leaving and re-adding your own row never regains acceptance
--              or admin status.
--   G-CREATOR  the creator still cannot add someone else as accepted or admin.
--   G-LATER    a pending invitee accepted by the server gets member rights
--              and nothing more.
--   G-ANON     the anon role cannot write guarded fields, with or without a
--              subject claim.
--   G-SESSION  a client session cannot switch role, switch off triggers or
--              alter the guard.
--   G-SERVICE  service_role still changes guarded fields.
-- Run from the repository root as postgres.

BEGIN;

CREATE TEMP TABLE t4436g_ids(k text PRIMARY KEY, v uuid NOT NULL);
INSERT INTO t4436g_ids VALUES
  ('A', '44361111-0000-4000-8000-00000000000a'),
  ('M', '44361111-0000-4000-8000-00000000000b'),
  ('P', '44361111-0000-4000-8000-00000000000c'),
  ('V', '44361111-0000-4000-8000-00000000000d'),
  ('X', '44361111-0000-4000-8000-00000000000e'),
  ('S', '44361111-0000-4000-8000-0000000000f1');
GRANT SELECT ON t4436g_ids TO authenticated, anon, service_role;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM t4436g_ids WHERE k <> 'S' LOOP
    INSERT INTO auth.users(id, email) VALUES (r.v, 'i4436g-' || lower(r.k) || '@example.test');
    INSERT INTO public.profiles(id, email) VALUES (r.v, 'i4436g-' || lower(r.k) || '@example.test')
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

INSERT INTO public.collaboration_sessions(id, name, created_by, status, session_type, invite_code, max_participants)
  SELECT (SELECT v FROM t4436g_ids WHERE k = 'S'), 'i4436g group',
         (SELECT v FROM t4436g_ids WHERE k = 'A'), 'active', 'group_hangout', 'I4436GOLD', 8;
INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin)
  SELECT (SELECT v FROM t4436g_ids WHERE k = 'S'), v, k <> 'P', k = 'A'
    FROM t4436g_ids WHERE k IN ('A', 'M', 'P', 'V');

CREATE FUNCTION public.t4436g_k(p text) RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT v FROM pg_temp.t4436g_ids WHERE k = p $f$;
GRANT EXECUTE ON FUNCTION public.t4436g_k(text) TO authenticated, anon, service_role;

-- Snapshot of the guarded state, compared before and after refused writes.
CREATE FUNCTION pg_temp.t4436g_state() RETURNS text LANGUAGE sql AS $f$
  SELECT (SELECT string_agg(user_id::text || ':' || coalesce(is_admin::text, 'null') || ':'
                 || coalesce(has_accepted::text, 'null') || ':' || coalesce(role, 'null') || ':'
                 || notifications_muted::text, ',' ORDER BY user_id)
            FROM public.session_participants WHERE session_id = public.t4436g_k('S'))
      || '|' || (SELECT concat_ws(':', name, created_by, invite_code, max_participants, session_type)
                   FROM public.collaboration_sessions WHERE id = public.t4436g_k('S'))
$f$;

CREATE FUNCTION pg_temp.t4436g_act(p_actor text, p_role text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(public.t4436g_k(p_actor)::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', public.t4436g_k(p_actor), 'role', p_role)::text, true);
END $f$;

-- p_stmt (one or more statements) run as p_role / p_actor must raise 42501
-- and leave the guarded state unchanged.
CREATE FUNCTION pg_temp.t4436g_refused(p_actor text, p_label text, p_stmt text, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE before text := pg_temp.t4436g_state(); after text;
BEGIN
  BEGIN
    PERFORM pg_temp.t4436g_act(p_actor, p_role);
    PERFORM set_config('role', p_role, true);
    EXECUTE p_stmt;
    RAISE EXCEPTION 'not refused' USING ERRCODE = 'XF436';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      PERFORM set_config('role', 'postgres', true);
      RAISE EXCEPTION 'FAIL [%] %: expected 42501, got % (%)', p_actor, p_label, SQLSTATE, SQLERRM;
    END IF;
  END;
  PERFORM set_config('role', 'postgres', true);
  after := pg_temp.t4436g_state();
  IF after IS DISTINCT FROM before THEN
    RAISE EXCEPTION 'FAIL [%] %: state changed (% -> %)', p_actor, p_label, before, after;
  END IF;
  RAISE NOTICE 'PASS [%] % refused', p_actor, p_label;
END $f$;

-- p_stmt run as p_role / p_actor must succeed, touch at least p_min rows of
-- its last statement, and p_check (as postgres) must be true. Rolled back.
CREATE FUNCTION pg_temp.t4436g_allowed(p_actor text, p_label text, p_stmt text, p_check text,
                                       p_role text DEFAULT 'authenticated', p_min int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n bigint; ok boolean;
BEGIN
  BEGIN
    PERFORM pg_temp.t4436g_act(p_actor, p_role);
    PERFORM set_config('role', p_role, true);
    EXECUTE p_stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'postgres', true);
    EXECUTE p_check INTO ok;
    IF n < p_min OR ok IS NOT TRUE THEN
      RAISE EXCEPTION 'rows=% check=%', n, ok USING ERRCODE = 'XF436';
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT436';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'XT436' THEN
      PERFORM set_config('role', 'postgres', true);
      RAISE EXCEPTION 'FAIL [%] %: % (%)', p_actor, p_label, SQLERRM, SQLSTATE;
    END IF;
  END;
  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'PASS [%] % allowed', p_actor, p_label;
END $f$;

-- G-MIXED -----------------------------------------------------------------
SELECT pg_temp.t4436g_refused('M', 'G-MIXED own mute plus own admin flag',
  $$UPDATE public.session_participants SET notifications_muted = true, is_admin = true
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M')$$);
SELECT pg_temp.t4436g_refused('P', 'G-MIXED own mute plus own acceptance',
  $$UPDATE public.session_participants SET notifications_muted = true, has_accepted = true
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$);
SELECT pg_temp.t4436g_refused('M', 'G-MIXED group name plus invite code',
  $$UPDATE public.collaboration_sessions SET name = 'i4436g renamed', invite_code = 'I4436GNEW'
     WHERE id = t4436g_k('S')$$);
SELECT pg_temp.t4436g_refused('M', 'G-MIXED group status plus owner',
  $$UPDATE public.collaboration_sessions SET status = 'voting', created_by = t4436g_k('M')
     WHERE id = t4436g_k('S')$$);

-- G-SAME ------------------------------------------------------------------
SELECT pg_temp.t4436g_allowed('M', 'G-SAME own row with current admin and acceptance values',
  $$UPDATE public.session_participants SET is_admin = false, has_accepted = true, role = 'member',
            notifications_muted = true
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M')$$,
  $$SELECT notifications_muted AND NOT is_admin FROM public.session_participants
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M')$$);
SELECT pg_temp.t4436g_allowed('P', 'G-SAME pending own row with current acceptance value',
  $$UPDATE public.session_participants SET has_accepted = false, notifications_muted = true
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$,
  $$SELECT notifications_muted AND NOT has_accepted FROM public.session_participants
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$);
SELECT pg_temp.t4436g_allowed('M', 'G-SAME group row with current owner and creator-only values',
  $$UPDATE public.collaboration_sessions
       SET created_by = t4436g_k('A'), invite_code = 'I4436GOLD', max_participants = 8,
           session_type = 'group_hangout', name = 'i4436g same'
     WHERE id = t4436g_k('S')$$,
  $$SELECT name = 'i4436g same' AND created_by = t4436g_k('A') FROM public.collaboration_sessions
     WHERE id = t4436g_k('S')$$);

-- G-NULL ------------------------------------------------------------------
SELECT pg_temp.t4436g_refused('M', 'G-NULL own admin flag to NULL',
  $$UPDATE public.session_participants SET is_admin = NULL
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M')$$);
SELECT pg_temp.t4436g_refused('P', 'G-NULL own acceptance to NULL',
  $$UPDATE public.session_participants SET has_accepted = NULL
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$);
SELECT pg_temp.t4436g_refused('M', 'G-NULL own role to NULL',
  $$UPDATE public.session_participants SET role = NULL
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M')$$);
SELECT pg_temp.t4436g_refused('M', 'G-NULL group owner to NULL',
  $$UPDATE public.collaboration_sessions SET created_by = NULL WHERE id = t4436g_k('S')$$);
SELECT pg_temp.t4436g_refused('M', 'G-NULL invite code to NULL',
  $$UPDATE public.collaboration_sessions SET invite_code = NULL WHERE id = t4436g_k('S')$$);
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    PERFORM pg_temp.t4436g_act('X', 'authenticated');
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin, role)
      VALUES (public.t4436g_k('S'), public.t4436g_k('X'), NULL, NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- refusing is also acceptable
  END;
  PERFORM set_config('role', 'postgres', true);
  SELECT coalesce(bool_or(has_accepted IS TRUE OR is_admin IS TRUE), false)
         OR public.chat_group_is_admin(public.t4436g_k('S'), public.t4436g_k('X'))
    INTO ok FROM public.session_participants
   WHERE session_id = public.t4436g_k('S') AND user_id = public.t4436g_k('X');
  IF ok THEN RAISE EXCEPTION 'FAIL [X] G-NULL insert with NULL flags produced an accepted or admin row'; END IF;
  DELETE FROM public.session_participants WHERE session_id = public.t4436g_k('S') AND user_id = public.t4436g_k('X');
  RAISE NOTICE 'PASS [X] G-NULL insert with NULL flags never yields an accepted or admin row';
END $$;

-- G-UPSERT ----------------------------------------------------------------
SELECT pg_temp.t4436g_refused('M', 'G-UPSERT own row conflict sets admin flag',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436g_k('S'), t4436g_k('M'))
    ON CONFLICT (session_id, user_id) DO UPDATE SET is_admin = true$$);
SELECT pg_temp.t4436g_refused('P', 'G-UPSERT own row conflict sets acceptance',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436g_k('S'), t4436g_k('P'))
    ON CONFLICT (session_id, user_id) DO UPDATE SET has_accepted = true$$);
SELECT pg_temp.t4436g_refused('M', 'G-UPSERT conflict copies flags from the proposed row',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin)
      VALUES (t4436g_k('S'), t4436g_k('M'), true, true)
    ON CONFLICT (session_id, user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin$$);
SELECT pg_temp.t4436g_refused('M', 'G-UPSERT group row conflict sets owner',
  $$INSERT INTO public.collaboration_sessions(id, name, created_by) VALUES (t4436g_k('S'), 'i4436g up', t4436g_k('M'))
    ON CONFLICT (id) DO UPDATE SET created_by = EXCLUDED.created_by$$);
SELECT pg_temp.t4436g_refused('M', 'G-UPSERT group row conflict sets max_participants',
  $$INSERT INTO public.collaboration_sessions(id, name, created_by) VALUES (t4436g_k('S'), 'i4436g up', t4436g_k('M'))
    ON CONFLICT (id) DO UPDATE SET max_participants = 999$$);

-- G-JOIN ------------------------------------------------------------------
SELECT pg_temp.t4436g_refused('M', 'G-JOIN update from group row sets own admin flag',
  $$UPDATE public.session_participants sp SET is_admin = true
      FROM public.collaboration_sessions cs
     WHERE cs.id = sp.session_id AND cs.id = t4436g_k('S') AND sp.user_id = t4436g_k('M')$$);
SELECT pg_temp.t4436g_refused('P', 'G-JOIN update from member rows renames group',
  $$UPDATE public.collaboration_sessions cs SET name = 'i4436g joined'
      FROM public.session_participants sp
     WHERE sp.session_id = cs.id AND cs.id = t4436g_k('S') AND sp.user_id = t4436g_k('P')$$);

-- G-REJOIN ----------------------------------------------------------------
SELECT pg_temp.t4436g_refused('M', 'G-REJOIN leave then re-add own row as accepted',
  $$DELETE FROM public.session_participants WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M');
    INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (t4436g_k('S'), t4436g_k('M'), true)$$);
SELECT pg_temp.t4436g_refused('P', 'G-REJOIN leave then re-add own row as admin',
  $$DELETE FROM public.session_participants WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P');
    INSERT INTO public.session_participants(session_id, user_id, is_admin) VALUES (t4436g_k('S'), t4436g_k('P'), true)$$);
SELECT pg_temp.t4436g_allowed('M', 'G-REJOIN leave then re-add own row comes back pending',
  $$DELETE FROM public.session_participants WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M');
    INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436g_k('S'), t4436g_k('M'))$$,
  $$SELECT has_accepted IS NOT TRUE AND is_admin IS NOT TRUE
           AND NOT public.chat_group_is_admin(t4436g_k('S'), t4436g_k('M'))
      FROM public.session_participants WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('M')$$);

-- G-CREATOR ---------------------------------------------------------------
SELECT pg_temp.t4436g_refused('A', 'G-CREATOR adds someone as accepted',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (t4436g_k('S'), t4436g_k('X'), true)$$);
SELECT pg_temp.t4436g_refused('A', 'G-CREATOR adds someone as pending admin',
  $$INSERT INTO public.session_participants(session_id, user_id, is_admin) VALUES (t4436g_k('S'), t4436g_k('X'), true)$$);
SELECT pg_temp.t4436g_refused('A', 'G-CREATOR accepts on behalf of a pending invitee',
  $$UPDATE public.session_participants SET has_accepted = true WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$);

-- G-SERVICE ---------------------------------------------------------------
SELECT pg_temp.t4436g_allowed('M', 'G-SERVICE service_role accepts and promotes',
  $$UPDATE public.session_participants SET has_accepted = true, is_admin = true
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$,
  $$SELECT has_accepted AND is_admin FROM public.session_participants
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$, 'service_role');
SELECT pg_temp.t4436g_allowed('M', 'G-SERVICE service_role changes group owner',
  $$UPDATE public.collaboration_sessions SET created_by = t4436g_k('M') WHERE id = t4436g_k('S')$$,
  $$SELECT created_by = t4436g_k('M') FROM public.collaboration_sessions WHERE id = t4436g_k('S')$$, 'service_role');

-- G-ANON ------------------------------------------------------------------
SELECT pg_temp.t4436g_refused('X', 'G-ANON inserts an accepted admin row without a subject',
  $$SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin) VALUES (t4436g_k('S'), t4436g_k('X'), true, true)$$,
  'anon');
DO $$
DECLARE before text := pg_temp.t4436g_state();
BEGIN
  BEGIN
    PERFORM pg_temp.t4436g_act('M', 'anon');
    PERFORM set_config('role', 'anon', true);
    UPDATE public.session_participants SET is_admin = true
     WHERE session_id = public.t4436g_k('S') AND user_id = public.t4436g_k('M');
    UPDATE public.collaboration_sessions SET created_by = public.t4436g_k('M') WHERE id = public.t4436g_k('S');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
  IF pg_temp.t4436g_state() IS DISTINCT FROM before THEN
    RAISE EXCEPTION 'FAIL [M] G-ANON anon with a subject claim changed guarded fields';
  END IF;
  RAISE NOTICE 'PASS [M] G-ANON anon with a subject claim changes nothing';
END $$;

-- G-LATER -----------------------------------------------------------------
-- The pending invitee is accepted by the server (postgres), then acts.
UPDATE public.session_participants SET has_accepted = true
 WHERE session_id = public.t4436g_k('S') AND user_id = public.t4436g_k('P');
SELECT pg_temp.t4436g_allowed('P', 'G-LATER newly accepted member invites someone as pending',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436g_k('S'), t4436g_k('X'))$$,
  $$SELECT has_accepted IS NOT TRUE FROM public.session_participants
     WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('X')$$);
SELECT pg_temp.t4436g_allowed('P', 'G-LATER newly accepted member renames group',
  $$UPDATE public.collaboration_sessions SET name = 'i4436g later' WHERE id = t4436g_k('S')$$,
  $$SELECT name = 'i4436g later' FROM public.collaboration_sessions WHERE id = t4436g_k('S')$$);
SELECT pg_temp.t4436g_refused('P', 'G-LATER newly accepted member sets own admin flag',
  $$UPDATE public.session_participants SET is_admin = true WHERE session_id = t4436g_k('S') AND user_id = t4436g_k('P')$$);
SELECT pg_temp.t4436g_refused('P', 'G-LATER newly accepted member changes the owner',
  $$UPDATE public.collaboration_sessions SET created_by = t4436g_k('P') WHERE id = t4436g_k('S')$$);
SELECT pg_temp.t4436g_refused('P', 'G-LATER newly accepted member changes invite code',
  $$UPDATE public.collaboration_sessions SET invite_code = 'I4436GLAT' WHERE id = t4436g_k('S')$$);

-- G-SESSION ---------------------------------------------------------------
-- Acting as authenticated, a client cannot switch triggers off or replace the
-- guard. Role membership is checked from the catalog below, because this
-- harness logs in as postgres rather than through the API gateway.
DO $$
DECLARE stmt text; ok_count int := 0;
BEGIN
  PERFORM pg_temp.t4436g_act('M', 'authenticated');
  FOREACH stmt IN ARRAY ARRAY[
    'SET LOCAL session_replication_role = replica',
    'ALTER TABLE public.session_participants DISABLE TRIGGER issue_4436_guard_member_write',
    'ALTER TABLE public.collaboration_sessions DISABLE TRIGGER issue_4436_guard_group_write',
    'ALTER TABLE public.session_participants DISABLE TRIGGER USER',
    'DROP TRIGGER issue_4436_guard_member_write ON public.session_participants',
    'CREATE OR REPLACE FUNCTION public.tg_issue_4436_guard_member_write() RETURNS trigger LANGUAGE plpgsql AS $b$ BEGIN RETURN NEW; END $b$'
  ] LOOP
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      EXECUTE stmt;
      RAISE EXCEPTION 'FAIL G-SESSION not refused: %', stmt USING ERRCODE = 'XF436';
    EXCEPTION WHEN insufficient_privilege THEN ok_count := ok_count + 1;
    END;
  END LOOP;
  PERFORM set_config('role', 'postgres', true);
  IF ok_count <> 6 THEN RAISE EXCEPTION 'FAIL G-SESSION only % of 6 refused', ok_count; END IF;
  RAISE NOTICE 'PASS G-SESSION % trigger and guard changes refused for authenticated', ok_count;
END $$;

DO $$ BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgenabled = 'O'
        AND tgname IN ('issue_4436_guard_member_write', 'issue_4436_guard_group_write')) <> 2 THEN
    RAISE EXCEPTION 'FAIL G-SESSION guard triggers are not both present and enabled';
  END IF;
  IF pg_has_role('authenticated', 'service_role', 'MEMBER') OR pg_has_role('anon', 'service_role', 'MEMBER')
     OR pg_has_role('authenticated', 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION 'FAIL G-SESSION a client role can assume a server role';
  END IF;
  RAISE NOTICE 'PASS G-SESSION guards intact and client roles cannot assume server roles';
END $$;

ROLLBACK;
