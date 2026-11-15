\set ON_ERROR_STOP on

-- #4436 follow-up migration 20280708046436: server-check deck preference
-- writes and require an invitation for pending self-joins. Runs on the fully
-- replayed PG17 schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4436-OWN-PREFS-ONLY | issue #4436 | an app client writes only its own deck preferences through upsert_participant_prefs; server roles may write any accepted member's preferences; the internal writer is not executable by app clients (P-REFUSED, P-ALLOWED, P-SERVER, P-REVERT, P-CATALOG)
-- MINGLA-INVARIANT: I-4436-INVITED-SELF-JOIN | issue #4436 | an app client inserts its own pending member row only while it holds its own pending invitation for that group; the creator's own row and invitations by accepted members are unchanged (J-REFUSED, J-ALLOWED, J-REVERT)
--
-- Actors: A creator, M and V accepted members, P pending invitee (holds an
-- invitation), X signed-in stranger, I invited stranger (pending invitation,
-- no row yet).

BEGIN;

CREATE TEMP TABLE t4436p_ids(k text PRIMARY KEY, v uuid NOT NULL);
INSERT INTO t4436p_ids VALUES
  ('A', '44362222-0000-4000-8000-00000000000a'),
  ('M', '44362222-0000-4000-8000-00000000000b'),
  ('V', '44362222-0000-4000-8000-00000000000c'),
  ('P', '44362222-0000-4000-8000-00000000000d'),
  ('X', '44362222-0000-4000-8000-00000000000e'),
  ('I', '44362222-0000-4000-8000-00000000000f'),
  ('S', '44362222-0000-4000-8000-0000000000f1');
GRANT SELECT ON t4436p_ids TO authenticated, anon, service_role;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM t4436p_ids WHERE k <> 'S' LOOP
    INSERT INTO auth.users(id, email) VALUES (r.v, 'i4436p-' || lower(r.k) || '@example.test');
    INSERT INTO public.profiles(id, email) VALUES (r.v, 'i4436p-' || lower(r.k) || '@example.test')
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

INSERT INTO public.collaboration_sessions(id, name, created_by, status)
  SELECT (SELECT v FROM t4436p_ids WHERE k = 'S'), 'i4436p group', (SELECT v FROM t4436p_ids WHERE k = 'A'), 'active';
INSERT INTO public.session_participants(session_id, user_id, has_accepted)
  SELECT (SELECT v FROM t4436p_ids WHERE k = 'S'), v, k <> 'P' FROM t4436p_ids WHERE k IN ('A', 'M', 'V', 'P');
INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
  SELECT (SELECT v FROM t4436p_ids WHERE k = 'S'), (SELECT v FROM t4436p_ids WHERE k = 'A'), v, 'pending'
    FROM t4436p_ids WHERE k IN ('P', 'I');

CREATE FUNCTION public.t4436p_k(p text) RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT v FROM pg_temp.t4436p_ids WHERE k = p $f$;
GRANT EXECUTE ON FUNCTION public.t4436p_k(text) TO authenticated, anon, service_role;

CREATE FUNCTION pg_temp.t4436p_act(p_actor text, p_role text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(public.t4436p_k(p_actor)::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', public.t4436p_k(p_actor), 'role', p_role)::text, true);
END $f$;

CREATE FUNCTION pg_temp.t4436p_prefs(p_user text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT participant_prefs -> public.t4436p_k(p_user)::text FROM public.collaboration_sessions WHERE id = public.t4436p_k('S')
$f$;

-- p_stmt run as p_role / p_actor must raise 42501.
CREATE FUNCTION pg_temp.t4436p_refused(p_actor text, p_label text, p_stmt text, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.t4436p_act(p_actor, p_role);
  BEGIN
    PERFORM set_config('role', p_role, true);
    EXECUTE p_stmt;
    RAISE EXCEPTION 'not refused' USING ERRCODE = 'XF436';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION 'FAIL [%] %: expected 42501, got % (%)', p_actor, p_label, SQLSTATE, SQLERRM;
    END IF;
  END;
  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'PASS [%] %', p_actor, p_label;
END $f$;

-- p_stmt run as p_role / p_actor must succeed and p_check (as postgres) be true. Rolled back.
CREATE FUNCTION pg_temp.t4436p_allowed(p_actor text, p_label text, p_stmt text, p_check text, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE ok boolean;
BEGIN
  PERFORM pg_temp.t4436p_act(p_actor, p_role);
  BEGIN
    PERFORM set_config('role', p_role, true);
    EXECUTE p_stmt;
    PERFORM set_config('role', 'postgres', true);
    EXECUTE p_check INTO ok;
    IF ok IS NOT TRUE THEN RAISE EXCEPTION 'check false' USING ERRCODE = 'XF436'; END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT436';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'XT436' THEN
      RAISE EXCEPTION 'FAIL [%] %: % (%)', p_actor, p_label, SQLERRM, SQLSTATE;
    END IF;
  END;
  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'PASS [%] %', p_actor, p_label;
END $f$;

-- P-REFUSED -----------------------------------------------------------------
SELECT pg_temp.t4436p_refused('M', 'P-REFUSED member writes another member''s prefs',
  $$SELECT public.upsert_participant_prefs(t4436p_k('S'), t4436p_k('V'), '{"categories":["hijack"]}'::jsonb)$$);
SELECT pg_temp.t4436p_refused('X', 'P-REFUSED stranger writes a member''s prefs',
  $$SELECT public.upsert_participant_prefs(t4436p_k('S'), t4436p_k('V'), '{"categories":["hijack"]}'::jsonb)$$);
SELECT pg_temp.t4436p_refused('A', 'P-REFUSED creator writes a member''s prefs',
  $$SELECT public.upsert_participant_prefs(t4436p_k('S'), t4436p_k('M'), '{"categories":["hijack"]}'::jsonb)$$);
SELECT pg_temp.t4436p_refused('M', 'P-REFUSED member calls the internal writer',
  $$SELECT public.issue_4436_write_participant_prefs(t4436p_k('S'), t4436p_k('V'), '{"categories":["hijack"]}'::jsonb)$$);
SELECT pg_temp.t4436p_refused('M', 'P-REFUSED anon calls upsert_participant_prefs',
  $$SELECT public.upsert_participant_prefs(t4436p_k('S'), t4436p_k('M'), '{"categories":["hijack"]}'::jsonb)$$, 'anon');
DO $$ BEGIN
  IF pg_temp.t4436p_prefs('V') IS NOT NULL THEN RAISE EXCEPTION 'FAIL P-REFUSED V prefs changed: %', pg_temp.t4436p_prefs('V'); END IF;
  RAISE NOTICE 'PASS P-REFUSED refused writes left V''s prefs untouched';
END $$;

-- P-ALLOWED / P-SERVER --------------------------------------------------------
SELECT pg_temp.t4436p_allowed('M', 'P-ALLOWED member writes own prefs',
  $$SELECT public.upsert_participant_prefs(t4436p_k('S'), t4436p_k('M'), '{"categories":["nature"]}'::jsonb)$$,
  $$SELECT pg_temp.t4436p_prefs('M') -> 'categories' = '["nature"]'::jsonb$$);
SELECT pg_temp.t4436p_allowed('M', 'P-SERVER service_role writes a member''s prefs',
  $$SELECT public.upsert_participant_prefs(t4436p_k('S'), t4436p_k('V'), '{"categories":["drinks_and_music"]}'::jsonb)$$,
  $$SELECT pg_temp.t4436p_prefs('V') -> 'categories' = '["drinks_and_music"]'::jsonb$$, 'service_role');
DO $$ BEGIN
  -- a postgres job (no client role) keeps writing any accepted member's prefs
  PERFORM set_config('role', 'postgres', true);
  PERFORM public.upsert_participant_prefs(public.t4436p_k('S'), public.t4436p_k('V'), '{"intents":["first_date"]}'::jsonb);
  IF pg_temp.t4436p_prefs('V') -> 'intents' IS DISTINCT FROM '["first_date"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL P-SERVER postgres write';
  END IF;
  RAISE NOTICE 'PASS P-SERVER postgres writes a member''s prefs';
END $$;
DO $$ DECLARE v_state text := 'none'; BEGIN
  -- the pending invitee still cannot write prefs (accepted members only)
  PERFORM pg_temp.t4436p_act('P', 'authenticated');
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.upsert_participant_prefs(public.t4436p_k('S'), public.t4436p_k('P'), '{"categories":["x"]}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Not a participant of this session' THEN v_state := 'refused'; END IF;
  END;
  PERFORM set_config('role', 'postgres', true);
  IF v_state <> 'refused' THEN RAISE EXCEPTION 'FAIL P-ALLOWED pending own write must still be refused'; END IF;
  RAISE NOTICE 'PASS P-ALLOWED a pending invitee''s own write keeps the accepted-only rule';
END $$;

-- J-REFUSED / J-ALLOWED -------------------------------------------------------
SELECT pg_temp.t4436p_refused('X', 'J-REFUSED uninvited stranger adds own pending row',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436p_k('S'), t4436p_k('X'))$$);
SELECT pg_temp.t4436p_refused('X', 'J-REFUSED uninvited stranger adds own row with explicit false flags',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin) VALUES (t4436p_k('S'), t4436p_k('X'), false, false)$$);
SELECT pg_temp.t4436p_refused('M', 'J-REFUSED member leaves and re-adds own row without an invitation',
  $$DELETE FROM public.session_participants WHERE session_id = t4436p_k('S') AND user_id = t4436p_k('M');
    INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436p_k('S'), t4436p_k('M'))$$);
DO $$ BEGIN
  UPDATE public.collaboration_invites SET status = 'declined'
   WHERE session_id = public.t4436p_k('S') AND invited_user_id = public.t4436p_k('I');
END $$;
SELECT pg_temp.t4436p_refused('I', 'J-REFUSED a declined invitation does not admit a self-join',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436p_k('S'), t4436p_k('I'))$$);
DO $$ BEGIN
  UPDATE public.collaboration_invites SET status = 'pending'
   WHERE session_id = public.t4436p_k('S') AND invited_user_id = public.t4436p_k('I');
END $$;
SELECT pg_temp.t4436p_allowed('I', 'J-ALLOWED invited user adds own pending row',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436p_k('S'), t4436p_k('I'))$$,
  $$SELECT has_accepted IS NOT TRUE AND is_admin IS NOT TRUE FROM public.session_participants WHERE session_id = t4436p_k('S') AND user_id = t4436p_k('I')$$);
SELECT pg_temp.t4436p_refused('I', 'J-REFUSED invited user still cannot add own row as accepted',
  $$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (t4436p_k('S'), t4436p_k('I'), true)$$);
SELECT pg_temp.t4436p_allowed('M', 'J-ALLOWED accepted member invites someone as pending',
  $$INSERT INTO public.session_participants(session_id, user_id) VALUES (t4436p_k('S'), t4436p_k('X'))$$,
  $$SELECT has_accepted IS NOT TRUE FROM public.session_participants WHERE session_id = t4436p_k('S') AND user_id = t4436p_k('X')$$);
DO $$ DECLARE v_s uuid := gen_random_uuid(); ok boolean; BEGIN
  -- the creator adds their own accepted row to a new group (create flow)
  INSERT INTO public.collaboration_sessions(id, name, created_by, status) VALUES (v_s, 'i4436p new', public.t4436p_k('X'), 'pending');
  PERFORM pg_temp.t4436p_act('X', 'authenticated');
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, public.t4436p_k('X'), true);
  PERFORM set_config('role', 'postgres', true);
  SELECT has_accepted INTO ok FROM public.session_participants WHERE session_id = v_s AND user_id = public.t4436p_k('X');
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL J-ALLOWED creator own row'; END IF;
  RAISE NOTICE 'PASS J-ALLOWED creator adds own accepted row';
END $$;
DO $$ DECLARE ok boolean; BEGIN
  -- a server function (definer) still admits a stranger
  INSERT INTO public.session_participants(session_id, user_id) VALUES (public.t4436p_k('S'), public.t4436p_k('X'))
    ON CONFLICT (session_id, user_id) DO NOTHING;
  SELECT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = public.t4436p_k('S') AND user_id = public.t4436p_k('X')) INTO ok;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL J-SERVER'; END IF;
  DELETE FROM public.session_participants WHERE session_id = public.t4436p_k('S') AND user_id = public.t4436p_k('X');
  RAISE NOTICE 'PASS J-SERVER a server write adds a row without an invitation';
END $$;

-- P-REVERT / J-REVERT: with the previous bodies, the refused writes succeed.
DO $$
DECLARE v_state text;
BEGIN
  BEGIN
    CREATE OR REPLACE FUNCTION public.upsert_participant_prefs(p_session_id uuid, p_user_id uuid, p_prefs jsonb)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $b$
    BEGIN
      PERFORM public.issue_4436_write_participant_prefs(p_session_id, p_user_id, p_prefs);
    END $b$;
    PERFORM pg_temp.t4436p_act('M', 'authenticated');
    PERFORM set_config('role', 'authenticated', true);
    PERFORM public.upsert_participant_prefs(public.t4436p_k('S'), public.t4436p_k('V'), '{"categories":["hijack"]}'::jsonb);
    PERFORM set_config('role', 'postgres', true);
    v_state := pg_temp.t4436p_prefs('V') ->> 'categories';
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT436';
  EXCEPTION WHEN SQLSTATE 'XT436' THEN NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
  IF v_state IS DISTINCT FROM '["hijack"]' THEN RAISE EXCEPTION 'FAIL P-REVERT without the check the write was still refused (%)', v_state; END IF;
  IF pg_temp.t4436p_prefs('V') -> 'categories' IS NOT NULL THEN RAISE EXCEPTION 'FAIL P-REVERT body not restored'; END IF;
  RAISE NOTICE 'PASS P-REVERT without the check a member overwrites another member''s prefs';
END $$;
DO $$
DECLARE v_n bigint := 0;
BEGIN
  BEGIN
    ALTER TABLE public.session_participants DISABLE TRIGGER issue_4436_guard_member_write;
    PERFORM pg_temp.t4436p_act('X', 'authenticated');
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO public.session_participants(session_id, user_id) VALUES (public.t4436p_k('S'), public.t4436p_k('X'));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT436';
  EXCEPTION WHEN SQLSTATE 'XT436' THEN NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL J-REVERT without the guard the self-join was still refused'; END IF;
  RAISE NOTICE 'PASS J-REVERT without the guard an uninvited stranger adds their own row';
END $$;

-- P-CATALOG -------------------------------------------------------------------
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.issue_4436_write_participant_prefs(uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4436_write_participant_prefs(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL P-CATALOG the internal writer is executable by a client role';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.upsert_participant_prefs(uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.upsert_participant_prefs(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL P-CATALOG upsert_participant_prefs grants changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.upsert_participant_prefs(uuid,uuid,jsonb)'::regprocedure
                  AND prosecdef AND proconfig @> ARRAY['search_path=public, extensions, pg_temp']) THEN
    RAISE EXCEPTION 'FAIL P-CATALOG upsert_participant_prefs must stay SECURITY DEFINER with a pinned search_path';
  END IF;
  RAISE NOTICE 'PASS P-CATALOG grants and search_path';
END $$;

ROLLBACK;
