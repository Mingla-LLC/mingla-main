\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- INDEPENDENT TESTER (tester2) suite: REAL concurrency.
--
-- Written by the tester, not the implementor. The two implementor suites run
-- in one session, so they cannot say anything about what happens when a sale
-- and a deletion, or two deletions, overlap. This suite opens extra database
-- sessions (dblink, loopback) and interleaves them on purpose:
--
--   R0  Structure: every table an event-scoped blocker reads has a foreign key
--       to events, every brand-scoped one to brands, and partner_splits to
--       creator_accounts. Those foreign keys are why an INSERT into any of
--       them takes FOR KEY SHARE on the parent row the deletion locks.
--   R1  A sale is in flight (inserted, not yet committed) when the deletion is
--       called. The deletion must WAIT for it, then answer `blocked` and
--       change nothing. Without the row lock on the event it would not wait,
--       would not see the uncommitted sale, and would take the event down
--       under a guest who is going.
--   R2  The deletion is held mid-write (after its preflight, before commit).
--       A second deletion of the same account must wait on the per-user lock
--       and then report `already_deleted`; a sale that starts now must wait
--       until the deletion has finished. Exactly one audit row results.
--   R3  The deletion is held mid-write, then its transaction is made to fail.
--       Every row is exactly as it was before the call: the event take-down
--       it had already written is rolled back with it.
--
-- How "a sale insert" is modelled: the buyer session runs the statement the
-- foreign key trigger itself runs (SELECT ... FOR KEY SHARE on the event) and
-- then inserts the RSVP with user triggers off, so the test does not depend
-- on (or leave rows in) the notification and ingest side tables. R0 asserts
-- the foreign keys that make a real insert take that same lock.
--
-- Unlike the sibling suites this one has to COMMIT its fixtures, because other
-- sessions must see them. Fixtures are inserted with triggers off (no side
-- rows), and the cleanup at the bottom removes every row by id. Runs as
-- supabase_admin (session_replication_role, CREATE EXTENSION). No row in
-- auth.users is used for anything but a foreign key target.
\getenv t2_pw PGPASSWORD

CREATE SCHEMA t2_3660_race;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA t2_3660_race;
SELECT n.nspname AS t2_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"t2_dblink_schema";

CREATE TABLE t2_3660_race.ids AS
SELECT
  gen_random_uuid() AS h,        -- the Host
  gen_random_uuid() AS brand,
  gen_random_uuid() AS event,
  gen_random_uuid() AS rsvp_inflight,
  gen_random_uuid() AS rsvp_late,
  replace(gen_random_uuid()::text, '-', '') AS sfx,
  format('host=127.0.0.1 port=%s dbname=postgres user=supabase_admin password=%s',
         current_setting('port'), :'t2_pw') AS conn;

-- Fixtures, committed, triggers off.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id) SELECT h FROM t2_3660_race.ids;
INSERT INTO public.creator_accounts(id, email)
SELECT h, 't2-3660-race@example.test' FROM t2_3660_race.ids;
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
SELECT brand, h, 'T2 Race', 't2-3660-race-' || sfx, 'USD' FROM t2_3660_race.ids;
INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
SELECT brand, 'acct_t2race_' || left(sfx, 10), 'US', 'USD' FROM t2_3660_race.ids;
INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
SELECT event, brand, h, 'T2 Race Upcoming', 't2-3660-race-e-' || sfx, 'scheduled'
FROM t2_3660_race.ids;
INSERT INTO public.event_dates(event_id, start_at, end_at)
SELECT event, now() + interval '5 days', now() + interval '6 days' FROM t2_3660_race.ids;
COMMIT;

-- Poll until a backend is waiting on a lock (true) or the budget runs out (false).
CREATE FUNCTION t2_3660_race.is_waiting(p_pid integer, p_locktype text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
BEGIN
  FOR i IN 1..150 LOOP
    IF EXISTS (
      SELECT 1 FROM pg_locks l
      WHERE l.pid = p_pid AND NOT l.granted
        AND (p_locktype IS NULL OR l.locktype = p_locktype)
    ) THEN
      RETURN true;
    END IF;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN false;
END;
$fn$;

CREATE FUNCTION t2_3660_race.snap()
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT md5(concat_ws('|',
    (SELECT to_jsonb(t)::text FROM public.creator_accounts t, t2_3660_race.ids i WHERE t.id = i.h),
    (SELECT to_jsonb(t)::text FROM public.brands t, t2_3660_race.ids i WHERE t.id = i.brand),
    (SELECT to_jsonb(t)::text FROM public.events t, t2_3660_race.ids i WHERE t.id = i.event),
    (SELECT to_jsonb(t)::text FROM public.stripe_connect_accounts t, t2_3660_race.ids i
      WHERE t.brand_id = i.brand),
    (SELECT count(*)::text FROM public.audit_log t, t2_3660_race.ids i
      WHERE t.user_id = i.h OR t.brand_id = i.brand)
  ));
$fn$;

DO $$
DECLARE
  v record;
  v_pid_del1 integer;
  v_pid_del2 integer;
  v_pid_buyer integer;
  v_before text;
  v_result jsonb;
  v_result2 jsonb;
  v_text text;
  v_count integer;
  v_missing text;
  c_claims constant text :=
    $q$SELECT set_config('request.jwt.claim.role', 'service_role', false),
              set_config('request.jwt.claims', '{"role":"service_role"}', false)$q$;
BEGIN
  SELECT * INTO v FROM t2_3660_race.ids;

  -- ==========================================================================
  -- R0 — the foreign keys the row locks rely on.
  -- ==========================================================================
  SELECT string_agg(x.child || '->' || x.parent, ', ') INTO v_missing
  FROM (VALUES
    ('public.orders', 'public.events'),
    ('public.tickets', 'public.events'),
    ('public.event_rsvps', 'public.events'),
    ('public.event_rsvp_contributions', 'public.events'),
    ('public.ticket_checkout_sessions', 'public.events'),
    ('public.reservations', 'public.brands'),
    ('public.stay_reservation_groups', 'public.brands'),
    ('public.venue_orders', 'public.brands'),
    ('public.brand_payout_releases', 'public.brands'),
    ('public.organiser_payout_debts', 'public.brands'),
    ('public.partner_splits', 'public.creator_accounts')
  ) AS x(child, parent)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = x.child::regclass
      AND c.confrelid = x.parent::regclass
      AND c.convalidated
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 't2 3660 R0: a blocker table has no foreign key to the row the deletion locks: %', v_missing;
  END IF;

  PERFORM dblink_connect('t2_buyer', v.conn);
  PERFORM dblink_connect('t2_del1', v.conn);
  PERFORM dblink_connect('t2_del2', v.conn);
  PERFORM dblink_connect('t2_hold', v.conn);
  PERFORM * FROM dblink('t2_del1', c_claims) AS t(a text, b text);
  PERFORM * FROM dblink('t2_del2', c_claims) AS t(a text, b text);
  SELECT pid INTO v_pid_del1 FROM dblink('t2_del1', 'SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO v_pid_del2 FROM dblink('t2_del2', 'SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO v_pid_buyer FROM dblink('t2_buyer', 'SELECT pg_backend_pid()') AS t(pid integer);

  -- ==========================================================================
  -- R1 — a sale in flight when the deletion is called.
  -- ==========================================================================
  v_before := t2_3660_race.snap();
  PERFORM dblink_exec('t2_buyer', 'BEGIN');
  -- what the foreign key trigger of an INSERT does:
  PERFORM * FROM dblink('t2_buyer', format(
    'SELECT 1 FROM public.events WHERE id = %L FOR KEY SHARE', v.event)) AS t(x integer);
  PERFORM dblink_exec('t2_buyer', 'SET LOCAL session_replication_role = replica');
  PERFORM dblink_exec('t2_buyer', format(
    $q$INSERT INTO public.event_rsvps
         (id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
       VALUES (%L, %L, 'T2 Race Guest', 't2-race-guest@example.test', '+12015550198',
               'going', 'approved')$q$, v.rsvp_inflight, v.event));
  -- the sale is NOT committed yet.

  IF dblink_send_query('t2_del1', format(
       'SELECT public.biz_delete_host_account(%L)::text', v.h)) <> 1 THEN
    RAISE EXCEPTION 't2 3660 R1: could not send the deletion';
  END IF;
  IF NOT t2_3660_race.is_waiting(v_pid_del1) THEN
    -- It did not wait. Whatever it answered, it answered without the sale.
    SELECT r INTO v_text FROM dblink_get_result('t2_del1') AS t(r text);
    PERFORM dblink_exec('t2_buyer', 'ROLLBACK');
    RAISE EXCEPTION 't2 3660 R1: the deletion did NOT wait for a sale in flight on its event; it answered %', v_text;
  END IF;

  PERFORM dblink_exec('t2_buyer', 'COMMIT');
  SELECT r::jsonb INTO v_result FROM dblink_get_result('t2_del1') AS t(r text);
  PERFORM * FROM dblink_get_result('t2_del1') AS t(r text);
  IF v_result->>'status' IS DISTINCT FROM 'blocked'
     OR v_result->'blockers'->0->>'code' IS DISTINCT FROM 'tickets_sold' THEN
    RAISE EXCEPTION 't2 3660 R1: after the sale committed the deletion must be blocked(tickets_sold); got %', v_result;
  END IF;
  IF v_before IS DISTINCT FROM t2_3660_race.snap() THEN
    RAISE EXCEPTION 't2 3660 R1: a deletion blocked by a concurrent sale changed a row';
  END IF;

  -- The guest changes their mind; the event has nobody again. Done in the
  -- buyer session so it is committed (this block is one open transaction).
  PERFORM dblink_exec('t2_buyer', 'SET session_replication_role = replica');
  PERFORM dblink_exec('t2_buyer', format(
    'DELETE FROM public.event_rsvps WHERE id = %L', v.rsvp_inflight));
  PERFORM dblink_exec('t2_buyer', 'SET session_replication_role = origin');

  -- ==========================================================================
  -- R3 — held mid-write, then the transaction fails: nothing remains.
  --      (Runs before R2 because R2 really deletes the account.)
  -- ==========================================================================
  v_before := t2_3660_race.snap();
  PERFORM dblink_exec('t2_hold', 'BEGIN');
  PERFORM * FROM dblink('t2_hold', format(
    'SELECT 1 FROM public.stripe_connect_accounts WHERE brand_id = %L FOR UPDATE', v.brand))
    AS t(x integer);
  -- lock_timeout makes the held statement fail instead of waiting for ever:
  -- a failure in the middle of the write sequence, after the event take-down.
  PERFORM dblink_exec('t2_del1', 'SET lock_timeout = ''1500ms''');
  IF dblink_send_query('t2_del1', format(
       'SELECT public.biz_delete_host_account(%L)::text', v.h)) <> 1 THEN
    RAISE EXCEPTION 't2 3660 R3: could not send the deletion';
  END IF;
  IF NOT t2_3660_race.is_waiting(v_pid_del1) THEN
    RAISE EXCEPTION 't2 3660 R3: the deletion was not held at the payout-row write';
  END IF;
  -- While it is held, its uncommitted event take-down is invisible to us.
  IF EXISTS (SELECT 1 FROM public.events WHERE id = v.event AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 R3: an uncommitted take-down is visible to another session';
  END IF;
  -- Collect the failure (lock timeout) without raising here.
  BEGIN
    SELECT r INTO v_text FROM dblink_get_result('t2_del1', false) AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_text := SQLERRM;
  END;
  PERFORM * FROM dblink_get_result('t2_del1', false) AS t(r text);
  IF dblink_error_message('t2_del1') NOT ILIKE '%lock timeout%'
     AND COALESCE(v_text, '') NOT ILIKE '%lock timeout%' THEN
    RAISE EXCEPTION 't2 3660 R3: expected the held deletion to fail on lock timeout; got result=% error=%',
      v_text, dblink_error_message('t2_del1');
  END IF;
  PERFORM dblink_exec('t2_hold', 'ROLLBACK');
  PERFORM dblink_exec('t2_del1', 'RESET lock_timeout');
  IF v_before IS DISTINCT FROM t2_3660_race.snap() THEN
    RAISE EXCEPTION 't2 3660 R3: a deletion that failed mid-write left a change behind';
  END IF;

  -- ==========================================================================
  -- R2 — two deletions and a sale, all overlapping.
  -- ==========================================================================
  PERFORM dblink_exec('t2_hold', 'BEGIN');
  PERFORM * FROM dblink('t2_hold', format(
    'SELECT 1 FROM public.stripe_connect_accounts WHERE brand_id = %L FOR UPDATE', v.brand))
    AS t(x integer);

  -- Deletion 1: passes the preflight, takes the event down, then is held.
  IF dblink_send_query('t2_del1', format(
       'SELECT public.biz_delete_host_account(%L)::text', v.h)) <> 1 THEN
    RAISE EXCEPTION 't2 3660 R2: could not send deletion 1';
  END IF;
  IF NOT t2_3660_race.is_waiting(v_pid_del1) THEN
    RAISE EXCEPTION 't2 3660 R2: deletion 1 was not held mid-write';
  END IF;

  -- Deletion 2 of the SAME account: must queue on the per-user advisory lock.
  IF dblink_send_query('t2_del2', format(
       'SELECT public.biz_delete_host_account(%L)::text', v.h)) <> 1 THEN
    RAISE EXCEPTION 't2 3660 R2: could not send deletion 2';
  END IF;
  IF NOT t2_3660_race.is_waiting(v_pid_del2, 'advisory') THEN
    RAISE EXCEPTION 't2 3660 R2: a second deletion of the same account did not queue on the per-user lock';
  END IF;

  -- A sale that starts now: its foreign key lock must wait for deletion 1.
  IF dblink_send_query('t2_buyer', format(
       'SELECT 1 FROM public.events WHERE id = %L FOR KEY SHARE', v.event)) <> 1 THEN
    RAISE EXCEPTION 't2 3660 R2: could not send the sale';
  END IF;
  IF NOT t2_3660_race.is_waiting(v_pid_buyer) THEN
    RAISE EXCEPTION 't2 3660 R2: a sale started during the deletion did not wait for it';
  END IF;

  -- Nothing is visible yet.
  IF EXISTS (SELECT 1 FROM public.creator_accounts WHERE id = v.h AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 R2: the account is marked deleted before the deletion committed';
  END IF;

  PERFORM dblink_exec('t2_hold', 'COMMIT');

  SELECT r::jsonb INTO v_result FROM dblink_get_result('t2_del1') AS t(r text);
  PERFORM * FROM dblink_get_result('t2_del1') AS t(r text);
  SELECT r::jsonb INTO v_result2 FROM dblink_get_result('t2_del2') AS t(r text);
  PERFORM * FROM dblink_get_result('t2_del2') AS t(r text);
  PERFORM * FROM dblink_get_result('t2_buyer') AS t(x integer);
  PERFORM * FROM dblink_get_result('t2_buyer') AS t(x integer);

  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'already_deleted')::boolean IS NOT FALSE
     OR (v_result->>'events_taken_down')::integer <> 1
     OR jsonb_array_length(v_result->'stripe_accounts') <> 1 THEN
    RAISE EXCEPTION 't2 3660 R2: deletion 1 wrong: %', v_result;
  END IF;
  IF v_result2->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result2->>'already_deleted')::boolean IS NOT TRUE
     OR jsonb_array_length(v_result2->'stripe_accounts') <> 0
     OR jsonb_array_length(v_result2->'brand_ids') <> 0 THEN
    RAISE EXCEPTION 't2 3660 R2: deletion 2 must report already_deleted with nothing to detach: %', v_result2;
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_log
   WHERE user_id = v.h AND action = 'host_account.deleted';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 't2 3660 R2: two overlapping deletions wrote % host_account.deleted audit rows', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v.event AND deleted_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v.brand AND deleted_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.creator_accounts WHERE id = v.h AND deleted_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.stripe_connect_accounts
                    WHERE brand_id = v.brand AND detached_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 R2: the committed deletion is not complete';
  END IF;

  PERFORM dblink_disconnect('t2_buyer');
  PERFORM dblink_disconnect('t2_del1');
  PERFORM dblink_disconnect('t2_del2');
  PERFORM dblink_disconnect('t2_hold');

  RAISE NOTICE 'issue_3660 host account deletion tester2 races PASS';
END;
$$;

-- Cleanup: every committed row, by id, triggers off.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.audit_log a USING t2_3660_race.ids i
 WHERE a.user_id = i.h OR a.brand_id = i.brand;
DELETE FROM public.event_checkout_admission_state s USING t2_3660_race.ids i
 WHERE s.event_id = i.event;
DELETE FROM public.event_rsvps r USING t2_3660_race.ids i WHERE r.event_id = i.event;
DELETE FROM public.event_dates d USING t2_3660_race.ids i WHERE d.event_id = i.event;
DELETE FROM public.events e USING t2_3660_race.ids i WHERE e.id = i.event;
DELETE FROM public.stripe_connect_accounts s USING t2_3660_race.ids i WHERE s.brand_id = i.brand;
DELETE FROM public.brand_team_members m USING t2_3660_race.ids i WHERE m.brand_id = i.brand;
-- written by a trigger on the event take-down:
DELETE FROM public.brand_reach_refresh_state s USING t2_3660_race.ids i WHERE s.brand_id = i.brand;
DELETE FROM public.brands b USING t2_3660_race.ids i WHERE b.id = i.brand;
DELETE FROM public.creator_accounts c USING t2_3660_race.ids i WHERE c.id = i.h;
DELETE FROM auth.users u USING t2_3660_race.ids i WHERE u.id = i.h;
COMMIT;
RESET search_path;
DROP SCHEMA t2_3660_race CASCADE;
