-- #4579 tester adversarial suite (20281128004579_issue_4579_mingla_admin_brand_access.sql).
-- PostgreSQL 17, after the full replay, run as postgres/supabase_admin. Each block is one
-- transaction that rolls back. Angles differ from the implementor suite: every re-add path is
-- driven AFTER a removal and AFTER a host-invited admin was removed; restore is attacked by every
-- non-owner kind (invited brand admin, auto-admin, event manager, a Mingla admin who is not on
-- the brand); a host forges the new columns by INSERT (not only UPDATE); the backfill re-run is
-- checked against every pre-existing role, a pending invite row and a removed row; the name rule
-- is probed at its edges; and X-LEAK proves whether a host can turn a chat roster user id into
-- an admin email through profiles.
--
-- X-LEAK is EXPECTED TO FAIL on tip 5c95aec243 (tester finding P0-1 on #4579): the roster hands
-- hosts the auto-admin's user id and public.profiles lets any authenticated user read email.
-- It must pass before merge. Not registered in CI (no sidecar) until that fix lands.
--
-- fails-on-revert: X-3 fails when the brand tombstone check is deleted from
-- issue_4579_grant_admin; X-5 fails when the per-person opt-out check is deleted from
-- issue_4579_grant_brand (owner restore then re-adds a removed invited admin).

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4579 TESTER FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('t4579:' || p_tag)::uuid $fn$;

-- Run p_sql as p_user under the authenticated role; '' on success, else SQLSTATE:message.
CREATE OR REPLACE FUNCTION pg_temp.try_as(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v text := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ':' || SQLERRM; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.val_as(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.auto_count(p_brand text)
RETURNS integer LANGUAGE sql AS $fn$
  SELECT count(*)::int FROM public.brand_team_members
   WHERE brand_id = pg_temp.u(p_brand) AND granted_via = 'mingla_admin' AND removed_at IS NULL
     -- only this suite's admins, so admins already on the database do not change the counts
     AND user_id IN (pg_temp.u('k1'), pg_temp.u('k2'), pg_temp.u('kinv'), pg_temp.u('knew'), pg_temp.u('kpart'))
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.backfill()
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE r record; v integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.admin_users WHERE role IN ('admin','owner') AND status = 'active' LOOP
    v := v + public.issue_4579_grant_admin(r.id);
  END LOOP;
  RETURN v;
END;
$fn$;

-- Users: owner, hadmin (invited brand admin), evm (event manager), outsider; Mingla admins
-- k1, k2 (active), kinv (active, the host also invited them personally on B1), knew (invited,
-- activated later), kpart (partner).
CREATE OR REPLACE FUNCTION pg_temp.fixture()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['owner','hadmin','evm','outsider','k1','k2','kinv','knew','kpart'] LOOP
    INSERT INTO auth.users(id, email) VALUES (pg_temp.u(t), 't4579-' || t || '@example.test');
    INSERT INTO public.creator_accounts(id, email) VALUES (pg_temp.u(t), 't4579-' || t || '@example.test');
    INSERT INTO public.profiles(id, email, username, display_name)
      VALUES (pg_temp.u(t), 't4579-' || t || '@example.test', 't4579_' || t, 'T ' || t)
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username,
                                     display_name = EXCLUDED.display_name;
  END LOOP;
  -- Admins first (no brands yet), so brands below are granted by the new-brand trigger.
  INSERT INTO public.admin_users(id, email, role, status) VALUES
    (pg_temp.u('ak1'), 't4579-k1@example.test', 'admin', 'active'),
    (pg_temp.u('ak2'), 't4579-k2@example.test', 'owner', 'active'),
    (pg_temp.u('akinv'), 't4579-kinv@example.test', 'admin', 'active'),
    (pg_temp.u('aknew'), 't4579-knew@example.test', 'admin', 'invited'),
    (pg_temp.u('akpart'), 't4579-kpart@example.test', 'partner', 'active');
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (pg_temp.u('b1'), pg_temp.u('owner'), 'T4579 One', 't4579-x-one'),
    (pg_temp.u('b2'), pg_temp.u('owner'), 'T4579 Two', 't4579-x-two');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at) VALUES
    (pg_temp.u('b1'), pg_temp.u('hadmin'), 'brand_admin', now(), now()),
    (pg_temp.u('b1'), pg_temp.u('evm'), 'event_manager', now(), now());
END;
$fn$;

-- X-1  new brand auto-grants (real trigger path); owner never; partner and invited admin never;
--      no outbox, no host-visible audit row, no invitation; re-running the backfill adds nothing.
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 3 AND pg_temp.auto_count('b2') = 3, 'X-1 new brand: every active admin/owner gets one auto row');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_team_members WHERE user_id IN (pg_temp.u('knew'), pg_temp.u('kpart'))), 'X-1 invited and partner admins get nothing');
SELECT pg_temp.ok((SELECT count(*) FROM public.notification_outbox WHERE brand_id IN (pg_temp.u('b1'), pg_temp.u('b2'))) = 0, 'X-1 no outbox row (no invite email, no owner alert)');
SELECT pg_temp.ok((SELECT count(*) FROM public.brand_invitations WHERE brand_id IN (pg_temp.u('b1'), pg_temp.u('b2'))) = 0, 'X-1 no invitation row');
SELECT pg_temp.ok((SELECT count(*) FROM public.audit_log WHERE brand_id IN (pg_temp.u('b1'), pg_temp.u('b2'))) = 0, 'X-1 no host-visible audit row');
SELECT pg_temp.backfill();  -- admins already on the database may still be granted here
SELECT pg_temp.ok(pg_temp.backfill() = 0, 'X-1 backfill re-run inserts 0');
ROLLBACK;

-- X-2  never downgrade: an admin already holding every role kind (owner of B2 via transfer is
--      not modelled; scanner, finance, event manager, a PENDING invite row) keeps it exactly;
--      a REMOVED old row does not block a fresh grant and is not revived.
BEGIN;
SELECT pg_temp.fixture();
SET LOCAL session_replication_role = replica;
DELETE FROM public.brand_team_members WHERE granted_via = 'mingla_admin';
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at, removed_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('k1'), 'scanner', now(), now(), NULL),
  (pg_temp.u('b1'), pg_temp.u('k2'), 'finance_manager', now(), NULL, NULL),
  (pg_temp.u('b2'), pg_temp.u('k1'), 'brand_admin', now(), now(), now() - interval '1 day');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.backfill();
SELECT pg_temp.ok((SELECT role || ':' || granted_via FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('k1') AND removed_at IS NULL) = 'scanner:invite', 'X-2 scanner kept, unmarked');
SELECT pg_temp.ok((SELECT count(*) FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('k2') AND removed_at IS NULL) = 1
              AND (SELECT granted_via FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('k2') AND removed_at IS NULL) = 'invite', 'X-2 pending invite row kept, no second row');
SELECT pg_temp.ok((SELECT count(*) FROM public.brand_team_members WHERE brand_id = pg_temp.u('b2') AND user_id = pg_temp.u('k1') AND removed_at IS NULL AND granted_via = 'mingla_admin') = 1
              AND (SELECT count(*) FROM public.brand_team_members WHERE brand_id = pg_temp.u('b2') AND user_id = pg_temp.u('k1') AND removed_at IS NOT NULL) = 1, 'X-2 removed old row not revived; fresh auto row added');
SELECT pg_temp.ok(pg_temp.backfill() = 0, 'X-2 second backfill inserts 0');
ROLLBACK;

-- X-3  removal sticks through EVERY automatic path, and only the owner can restore.
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('evm'), $$SELECT public.issue_4579_remove_mingla_team(md5('t4579:b1')::uuid)$$) LIKE 'P0001:forbidden%', 'X-3 event manager cannot remove');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('hadmin'), $$SELECT public.issue_4579_remove_mingla_team(md5('t4579:b1')::uuid)$$) = '', 'X-3 invited brand admin removes Mingla Team');
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 0 AND EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts WHERE brand_id = pg_temp.u('b1')), 'X-3 all auto rows gone, tombstone written');
SELECT pg_temp.ok(pg_temp.auto_count('b2') = 3, 'X-3 other brand untouched');
-- every re-add path
UPDATE public.admin_users SET status = 'active', accepted_at = now() WHERE id = pg_temp.u('aknew');
UPDATE public.admin_users SET role = 'admin' WHERE id = pg_temp.u('akpart');
UPDATE public.admin_users SET status = 'revoked' WHERE id = pg_temp.u('ak1');
UPDATE public.admin_users SET status = 'active' WHERE id = pg_temp.u('ak1');
UPDATE public.admin_users SET email = 'T4579-K2@example.test ' WHERE id = pg_temp.u('ak2');
DELETE FROM public.admin_users WHERE id = pg_temp.u('akinv');
INSERT INTO public.admin_users(id, email, role, status) VALUES (pg_temp.u('akinv2'), 't4579-kinv@example.test', 'admin', 'active');
SELECT pg_temp.backfill();
SELECT public.issue_4579_grant_brand(pg_temp.u('b1'));
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 0, 'X-3 activation, partner->admin, revoke+restore, email change, delete+reinsert, backfill, grant_brand: nothing re-added');
SELECT pg_temp.ok(pg_temp.auto_count('b2') = 5, 'X-3 the same paths did grant on the untombstoned brand');
-- restore attacks
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('hadmin'), $$SELECT public.issue_4579_restore_mingla_team(md5('t4579:b1')::uuid)$$) LIKE 'P0001:forbidden%', 'X-3 invited brand admin cannot restore');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('evm'), $$SELECT public.issue_4579_restore_mingla_team(md5('t4579:b1')::uuid)$$) LIKE 'P0001:forbidden%', 'X-3 event manager cannot restore');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('k1'), $$SELECT public.issue_4579_restore_mingla_team(md5('t4579:b1')::uuid)$$) LIKE 'P0001:forbidden%', 'X-3 a Mingla admin (not on the brand) cannot restore');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('k1'), $$SELECT public.issue_4579_restore_mingla_team(md5('t4579:b2')::uuid)$$) LIKE 'P0001:forbidden%', 'X-3 an auto-admin cannot restore (or call it on its own brand)');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('outsider'), $$SELECT public.issue_4579_restore_mingla_team(md5('t4579:b1')::uuid)$$) LIKE 'P0001:forbidden%', 'X-3 outsider cannot restore');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('hadmin'), $$SELECT public.issue_4579_grant_brand(md5('t4579:b1')::uuid)$$) LIKE '42501%', 'X-3 host cannot call the internal grant');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('hadmin'), $$DELETE FROM public.brand_mingla_team_optouts$$) LIKE '42501%', 'X-3 host cannot delete the tombstone');
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 0, 'X-3 still nothing after the attacks');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('owner'), $$SELECT public.issue_4579_restore_mingla_team(md5('t4579:b1')::uuid)$$) = '', 'X-3 owner restores');
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 5, 'X-3 owner restore grants every current active admin');
ROLLBACK;

-- X-4  removing ONE auto row by member id (the old RPC, by an invited brand admin who learned
--      the id) removes all of Mingla Team and tombstones.
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('hadmin'), format('SELECT public.biz_remove_brand_team_member(%L::uuid, %L::uuid)', pg_temp.u('b1'),
  (SELECT id FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('k1') AND removed_at IS NULL))) = '', 'X-4 remove one auto row by id');
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 0 AND EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts WHERE brand_id = pg_temp.u('b1')), 'X-4 all auto rows gone + tombstone');
SELECT pg_temp.backfill();
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 0, 'X-4 backfill re-adds nothing');
ROLLBACK;

-- X-5  a personally invited admin: unaffected by Mingla Team removal and admin revoke; once the
--      host removes them they stay off even through the OWNER'S restore and a re-activation.
BEGIN;
SELECT pg_temp.fixture();
-- the host's invite accepted onto kinv's auto row on B1 (the accept RPC's row reuse)
UPDATE public.brand_team_members SET role = 'event_manager', accepted_at = now()
 WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('kinv') AND removed_at IS NULL;
SELECT pg_temp.ok((SELECT granted_via FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('kinv') AND removed_at IS NULL) = 'invite', 'X-5 accepted invite turns the auto row into an invite row');
SELECT pg_temp.try_as(pg_temp.u('owner'), $$SELECT public.issue_4579_remove_mingla_team(md5('t4579:b1')::uuid)$$);
UPDATE public.admin_users SET status = 'revoked' WHERE id = pg_temp.u('akinv');
SELECT pg_temp.ok((SELECT role FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('kinv') AND removed_at IS NULL) = 'event_manager', 'X-5 invite row survives Mingla Team removal and admin revoke');
UPDATE public.admin_users SET status = 'active' WHERE id = pg_temp.u('akinv');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('owner'), format('SELECT public.biz_remove_brand_team_member(%L::uuid, %L::uuid)', pg_temp.u('b1'),
  (SELECT id FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('kinv') AND removed_at IS NULL))) = '', 'X-5 owner removes the invited admin');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_mingla_admin_optouts WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('kinv')), 'X-5 per-person opt-out written');
SELECT pg_temp.try_as(pg_temp.u('owner'), $$SELECT public.issue_4579_restore_mingla_team(md5('t4579:b1')::uuid)$$);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('kinv') AND removed_at IS NULL), 'X-5 the owner''s restore does not re-add the removed invited admin');
UPDATE public.admin_users SET status = 'revoked' WHERE id = pg_temp.u('akinv');
UPDATE public.admin_users SET status = 'active' WHERE id = pg_temp.u('akinv');
SELECT pg_temp.backfill();
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_team_members WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('kinv') AND removed_at IS NULL), 'X-5 owner restore, revoke+activate and backfill never re-add the removed invited admin');
SELECT pg_temp.ok(pg_temp.auto_count('b1') = 2, 'X-5 owner restore re-added the other admins');
ROLLBACK;

-- X-6  hosts forge or reach the new columns and tables.
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('hadmin'), format(
  'INSERT INTO public.brand_team_members(brand_id,user_id,role,invited_at,accepted_at,granted_via,granted_admin_user_id) VALUES (%L,%L,''brand_admin'',now(),now(),''mingla_admin'',%L)',
  pg_temp.u('b1'), pg_temp.u('outsider'), pg_temp.u('ak1'))) <> '', 'X-6 host cannot INSERT a forged mingla_admin row');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('hadmin'), $$UPDATE public.brand_team_members SET granted_via = 'mingla_admin' WHERE user_id = md5('t4579:evm')::uuid$$) LIKE '42501%', 'X-6 host cannot relabel a member as Mingla');
SELECT pg_temp.ok(pg_temp.val_as(pg_temp.u('hadmin'), $$SELECT count(*)::text FROM public.brand_team_members WHERE granted_via = 'mingla_admin'$$) = '0', 'X-6 host SELECT sees no auto rows');
SELECT pg_temp.ok(pg_temp.val_as(pg_temp.u('hadmin'), $$WITH u AS (UPDATE public.brand_team_members SET removed_at = now() WHERE granted_via = 'mingla_admin' RETURNING 1) SELECT count(*)::text FROM u$$) = '0', 'X-6 host direct UPDATE reaches no auto row');
SELECT pg_temp.ok(pg_temp.val_as(pg_temp.u('hadmin'), $$SELECT count(*)::text FROM public.admin_users$$) = '0', 'X-6 host reads no admin_users');
SELECT pg_temp.ok(pg_temp.val_as(pg_temp.u('hadmin'), $$SELECT count(*)::text FROM public.biz_brand_team_members(md5('t4579:b1')::uuid) WHERE entry_kind = 'mingla_team' AND user_id IS NULL AND email IS NULL AND member_id IS NULL$$) = '1'
              AND pg_temp.val_as(pg_temp.u('hadmin'), $$SELECT count(*)::text FROM public.biz_brand_team_members(md5('t4579:b1')::uuid) WHERE email ILIKE 't4579-k%'$$) = '0', 'X-6 team list: one Mingla Team entry, no admin email');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('outsider'), $$SELECT public.issue_4579_mingla_team_state(md5('t4579:b1')::uuid)$$) LIKE '42501%', 'X-6 outsider cannot read Mingla Team state');
ROLLBACK;

-- X-7  name rule edges (spec v3 section 2).
BEGIN;
SELECT pg_temp.fixture();
CREATE TEMP TABLE name_cases(dn text, expected text) ON COMMIT DROP;
INSERT INTO name_cases VALUES
  (NULL, 'Mingla Team'), ('', 'Mingla Team'), ('   ', 'Mingla Team'),
  ('t4579-k1@example.test', 'Mingla Team'), ('T4579-K1@EXAMPLE.TEST', 'Mingla Team'),
  ('t4579-k1', 'Mingla Team'), ('t4579k1', 'Mingla Team'), ('t4579_k1', 'Mingla Team'),
  ('someone@else.test', 'Mingla Team'), (repeat('a', 41), 'Mingla Team'), (E'Ku\nnle', 'Mingla Team'),
  ('  Kunle  ', 'Kunle'), ('Abimbola A.', 'Abimbola A.'), (repeat('A', 40), repeat('A', 40));
DO $x7$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM name_cases LOOP
    UPDATE public.profiles SET display_name = r.dn WHERE id = pg_temp.u('k1');
    v := public.issue_4579_admin_public_name(pg_temp.u('k1'));
    PERFORM pg_temp.ok(v = r.expected, format('X-7 display_name %L -> %L (got %L)', r.dn, r.expected, v));
  END LOOP;
END;
$x7$;
ROLLBACK;

-- X-8  payouts stay owner-only for an auto-admin (rank 50 < 60).
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.ok(NOT public.biz_can_mutate_payouts_for_brand(pg_temp.u('b1'), pg_temp.u('k1'))
              AND public.biz_can_mutate_payouts_for_brand(pg_temp.u('b1'), pg_temp.u('owner')), 'X-8 payouts: auto-admin false, owner true');
SELECT pg_temp.ok(pg_temp.try_as(pg_temp.u('k1'), format('INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id) VALUES (%L, ''acct_t4579'')', pg_temp.u('b1'))) LIKE '42501%', 'X-8 auto-admin cannot insert a connect account');
ROLLBACK;

-- X-LEAK  a host turns the roster's auto-admin user id into an email. EXPECTED TO FAIL until
--         P0-1 is fixed (see header).
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.ok(pg_temp.val_as(pg_temp.u('evm'), format(
  'SELECT count(*)::text FROM public.profiles WHERE id = %L AND email IS NOT NULL', pg_temp.u('k1'))) = '0',
  'X-LEAK host cannot read an auto-admin''s email from profiles by user id');
ROLLBACK;
