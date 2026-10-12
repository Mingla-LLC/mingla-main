\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- INDEPENDENT TESTER (tester2) RETEST suite: REAL concurrency against the
-- writes the rework added.
--
-- The rework made the deletion revoke pending invitations on the brands it
-- deletes. That is a new lock, taken in the OPPOSITE order to the one an
-- invitation acceptance uses:
--
--   deletion:    brand row (FOR UPDATE)   ->  invitation row (UPDATE)
--   acceptance:  invitation row (FOR UPDATE)  ->  brand row (the membership
--                insert's foreign key takes FOR KEY SHARE on it)
--
-- Two sessions doing those at the same moment wait on each other. PostgreSQL
-- breaks the cycle by cancelling one of them. This suite makes that happen on
-- purpose, with the REAL accept function in one session and the REAL deletion
-- in another, and asserts the only two acceptable endings:
--
--   A  the deletion wins: account, brand and invitation are all closed, the
--      acceptance was refused, the invitee is a member of nothing;
--   B  the acceptance wins: the deletion failed as a whole and not one row it
--      touched is different from before the call (the event take-down it had
--      already written is gone with it).
--
-- What must never happen: both succeed, or the deletion reports `deleted`
-- while the invitation it should have closed was accepted underneath it.
--
-- Like the sibling races suite this one COMMITS its fixtures (other sessions
-- must see them), inserts them with triggers off, and removes every row by id
-- before it exits. Runs as supabase_admin.
\getenv t2_pw PGPASSWORD

CREATE SCHEMA t2r_3660_race;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA t2r_3660_race;
SELECT n.nspname AS t2_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"t2_dblink_schema";

CREATE TABLE t2r_3660_race.ids AS
SELECT
  gen_random_uuid() AS h,
  gen_random_uuid() AS inv,
  gen_random_uuid() AS brand,
  gen_random_uuid() AS event,
  replace(gen_random_uuid()::text, '-', '') AS sfx,
  format('host=127.0.0.1 port=%s dbname=postgres user=supabase_admin password=%s',
         current_setting('port'), :'t2_pw') AS conn;

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id, email)
SELECT h, 't2r-race-h-' || sfx || '@example.test' FROM t2r_3660_race.ids
UNION ALL
SELECT inv, 't2r-race-i-' || sfx || '@example.test' FROM t2r_3660_race.ids;
INSERT INTO public.creator_accounts(id, email)
SELECT h, 't2r-race-h-' || sfx || '@example.test' FROM t2r_3660_race.ids
UNION ALL
SELECT inv, 't2r-race-i-' || sfx || '@example.test' FROM t2r_3660_race.ids;
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
SELECT brand, h, 'T2R Race', 't2r-3660-race-' || sfx, 'USD' FROM t2r_3660_race.ids;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
SELECT brand, h, 'brand_owner', now(), now() FROM t2r_3660_race.ids;
INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
SELECT brand, 'acct_t2rrace_' || left(sfx, 10), 'US', 'USD' FROM t2r_3660_race.ids;
INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
SELECT event, brand, h, 'T2R Race Upcoming', 't2r-3660-race-e-' || sfx, 'scheduled'
FROM t2r_3660_race.ids;
INSERT INTO public.event_dates(event_id, start_at, end_at)
SELECT event, now() + interval '5 days', now() + interval '6 days' FROM t2r_3660_race.ids;
INSERT INTO public.brand_invitations(brand_id, email, role, invited_by, token_hash, expires_at)
SELECT brand, 't2r-race-i-' || sfx || '@example.test', 'event_manager', h,
       't2r-race-tok-' || sfx, now() + interval '7 days'
FROM t2r_3660_race.ids;
COMMIT;

CREATE FUNCTION t2r_3660_race.is_waiting(p_pid integer)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
BEGIN
  FOR i IN 1..150 LOOP
    IF EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = p_pid AND NOT l.granted) THEN
      RETURN true;
    END IF;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN false;
END;
$fn$;

CREATE FUNCTION t2r_3660_race.snap()
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT md5(concat_ws('|',
    (SELECT to_jsonb(t)::text FROM public.creator_accounts t, t2r_3660_race.ids i WHERE t.id = i.h),
    (SELECT to_jsonb(t)::text FROM public.brands t, t2r_3660_race.ids i WHERE t.id = i.brand),
    (SELECT to_jsonb(t)::text FROM public.events t, t2r_3660_race.ids i WHERE t.id = i.event),
    (SELECT to_jsonb(t)::text FROM public.stripe_connect_accounts t, t2r_3660_race.ids i
      WHERE t.brand_id = i.brand),
    (SELECT count(*)::text FROM public.audit_log t, t2r_3660_race.ids i
      WHERE t.action = 'host_account.deleted' AND t.target_id = i.h::text)
  ));
$fn$;

DO $$
DECLARE
  v record;
  v_pid_del integer;
  v_pid_acc integer;
  v_before text;
  v_del_text text;
  v_del_err text;
  v_acc_err text;
  v_del jsonb;
  v_inv_status text;
  v_member boolean;
  v_deleted boolean;
  c_claims constant text :=
    $q$SELECT set_config('request.jwt.claim.role', 'service_role', false),
              set_config('request.jwt.claims', '{"role":"service_role"}', false)$q$;
BEGIN
  SELECT * INTO v FROM t2r_3660_race.ids;
  PERFORM dblink_connect('t2r_del', v.conn);
  PERFORM dblink_connect('t2r_acc', v.conn);
  PERFORM dblink_connect('t2r_hold', v.conn);
  PERFORM * FROM dblink('t2r_del', c_claims) AS t(a text, b text);
  PERFORM * FROM dblink('t2r_acc', c_claims) AS t(a text, b text);
  SELECT pid INTO v_pid_del FROM dblink('t2r_del', 'SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO v_pid_acc FROM dblink('t2r_acc', 'SELECT pg_backend_pid()') AS t(pid integer);

  v_before := t2r_3660_race.snap();

  -- Hold the deletion after its preflight and its event take-down, before it
  -- reaches the invitation: it now owns the brand row lock.
  PERFORM dblink_exec('t2r_hold', 'BEGIN');
  PERFORM * FROM dblink('t2r_hold', format(
    'SELECT 1 FROM public.stripe_connect_accounts WHERE brand_id = %L FOR UPDATE', v.brand))
    AS t(x integer);
  IF dblink_send_query('t2r_del', format(
       'SELECT public.biz_delete_host_account(%L)::text', v.h)) <> 1 THEN
    RAISE EXCEPTION 't2r 3660 race: could not send the deletion';
  END IF;
  IF NOT t2r_3660_race.is_waiting(v_pid_del) THEN
    RAISE EXCEPTION 't2r 3660 race: the deletion was not held mid-write';
  END IF;

  -- The invitee accepts now, through the real function: it takes the
  -- invitation row, then needs the brand row the deletion owns.
  IF dblink_send_query('t2r_acc', format(
       'SELECT public.accept_invite_and_transfer_brand_ownership(%L, %L)::text',
       't2r-race-tok-' || v.sfx, v.inv)) <> 1 THEN
    RAISE EXCEPTION 't2r 3660 race: could not send the acceptance';
  END IF;
  IF NOT t2r_3660_race.is_waiting(v_pid_acc) THEN
    RAISE EXCEPTION 't2r 3660 race: the acceptance did not wait for the deletion''s brand lock (it went through underneath a deletion in flight)';
  END IF;

  -- Let the deletion run on into the invitation the acceptance owns.
  PERFORM dblink_exec('t2r_hold', 'COMMIT');

  -- Collect both outcomes without raising here.
  BEGIN
    SELECT r INTO v_del_text FROM dblink_get_result('t2r_del', false) AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_del_text := NULL;
  END;
  v_del_err := NULLIF(dblink_error_message('t2r_del'), 'OK');
  PERFORM * FROM dblink_get_result('t2r_del', false) AS t(r text);
  BEGIN
    PERFORM * FROM dblink_get_result('t2r_acc', false) AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  v_acc_err := NULLIF(dblink_error_message('t2r_acc'), 'OK');
  PERFORM * FROM dblink_get_result('t2r_acc', false) AS t(r text);

  IF v_del_text IS NOT NULL AND v_del_text LIKE '{%' THEN
    v_del := v_del_text::jsonb;
  END IF;
  SELECT bi.status INTO v_inv_status FROM public.brand_invitations bi WHERE bi.brand_id = v.brand;
  SELECT EXISTS (SELECT 1 FROM public.brand_team_members m
                 WHERE m.brand_id = v.brand AND m.user_id = v.inv AND m.removed_at IS NULL)
    INTO v_member;
  SELECT c.deleted_at IS NOT NULL INTO v_deleted FROM public.creator_accounts c WHERE c.id = v.h;

  RAISE NOTICE 't2r 3660 race outcome: deletion=% / deletion error=% / acceptance error=% / invitation=% / invitee is member=%',
    COALESCE(v_del->>'status', 'no answer'), COALESCE(v_del_err, 'none'),
    COALESCE(v_acc_err, 'none'), v_inv_status, v_member;

  IF v_del->>'status' = 'deleted' THEN
    -- Ending A: the deletion won.
    IF v_acc_err IS NULL OR v_member OR v_inv_status IS DISTINCT FROM 'revoked' OR NOT v_deleted
       OR NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v.brand AND deleted_at IS NOT NULL)
       OR NOT EXISTS (SELECT 1 FROM public.events WHERE id = v.event AND deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION 't2r 3660 race: the deletion reported deleted but the acceptance also got through, or the deletion is incomplete (acceptance error=%, invitation=%, member=%)',
        v_acc_err, v_inv_status, v_member;
    END IF;
  ELSIF v_del IS NULL AND v_del_err IS NOT NULL THEN
    -- Ending B: the acceptance won; the deletion failed as a whole.
    IF v_before IS DISTINCT FROM t2r_3660_race.snap() THEN
      RAISE EXCEPTION 't2r 3660 race: a deletion that lost the race left a change behind (error was: %)', v_del_err;
    END IF;
    IF v_acc_err IS NOT NULL OR NOT v_member OR v_inv_status IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 't2r 3660 race: BOTH sides failed (deletion: %, acceptance: %)', v_del_err, v_acc_err;
    END IF;
  ELSE
    RAISE EXCEPTION 't2r 3660 race: unexpected deletion answer % (error %)', v_del_text, v_del_err;
  END IF;

  PERFORM dblink_disconnect('t2r_del');
  PERFORM dblink_disconnect('t2r_acc');
  PERFORM dblink_disconnect('t2r_hold');
  RAISE NOTICE 'issue_3660 host account deletion tester2 retest races PASS';
END;
$$;

-- Cleanup: every committed row, by id, triggers off.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.audit_log a USING t2r_3660_race.ids i
 WHERE a.user_id IN (i.h, i.inv) OR a.brand_id = i.brand OR a.target_id = i.h::text;
DELETE FROM public.event_checkout_admission_state s USING t2r_3660_race.ids i
 WHERE s.event_id = i.event;
DELETE FROM public.event_dates d USING t2r_3660_race.ids i WHERE d.event_id = i.event;
DELETE FROM public.events e USING t2r_3660_race.ids i WHERE e.id = i.event;
DELETE FROM public.stripe_connect_accounts s USING t2r_3660_race.ids i WHERE s.brand_id = i.brand;
DELETE FROM public.brand_invitations b USING t2r_3660_race.ids i WHERE b.brand_id = i.brand;
DELETE FROM public.brand_team_members m USING t2r_3660_race.ids i WHERE m.brand_id = i.brand;
DELETE FROM public.brand_reach_refresh_state s USING t2r_3660_race.ids i WHERE s.brand_id = i.brand;
DELETE FROM public.brands b USING t2r_3660_race.ids i WHERE b.id = i.brand;
DELETE FROM public.creator_accounts c USING t2r_3660_race.ids i WHERE c.id IN (i.h, i.inv);
DELETE FROM auth.users u USING t2r_3660_race.ids i WHERE u.id IN (i.h, i.inv);
COMMIT;
RESET search_path;
DROP SCHEMA t2r_3660_race CASCADE;
