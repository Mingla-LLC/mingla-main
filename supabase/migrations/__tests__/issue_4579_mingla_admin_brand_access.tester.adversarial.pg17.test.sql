-- #4579 tester adversarial suite (20281202024579_issue_4579_mingla_admin_brand_access.sql).
-- PostgreSQL 17, after the full replay, run as postgres/supabase_admin. Each block is one
-- transaction that rolls back. Angles differ from the implementor suite: every re-add path is
-- driven AFTER a removal and AFTER a host-invited admin was removed; restore is attacked by every
-- non-owner kind (invited brand admin, auto-admin, event manager, a Mingla admin who is not on
-- the brand); a host forges the new columns by INSERT (not only UPDATE); the backfill re-run is
-- checked against every pre-existing role, a pending invite row and a removed row; the name rule
-- is probed at its edges; and X-LEAK proves that no #4579 reader or RPC hands a host an
-- auto-admin's email, username or email handle.
--
-- X-LEAK scope (Seth, 2026-11-23 fix plan): the platform-wide profiles read is out of scope here; #3969's final step closes it for everyone.
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

-- X-LEAK  no #4579 surface returns an auto-admin's email, username or email handle, to an
--         invited brand admin, an event manager or the owner. The generic profiles read is
--         #3969's (see header).
BEGIN;
SELECT pg_temp.fixture();
CREATE TEMP TABLE xleak(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON xleak TO authenticated;
DO $xleak_seed$
DECLARE v_conv uuid; v_guest uuid;
BEGIN
  SELECT id INTO v_conv FROM public.conversations WHERE linked_entity_type = 'brand' AND brand_id = pg_temp.u('b1');
  SELECT id INTO v_guest FROM public.conversations WHERE linked_entity_type = 'brand_guests' AND brand_id = pg_temp.u('b1');
  PERFORM pg_temp.ok(v_conv IS NOT NULL, 'X-LEAK seed: the brand group exists');
  INSERT INTO xleak VALUES ('conv', v_conv), ('guest', v_guest);
  -- The auto-admin speaks in the group (a handle snapshot on purpose) and reads it.
  INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, sender_display_name_snapshot)
  VALUES (pg_temp.u('xm1'), v_conv, pg_temp.u('k1'), 'from mingla', 'text', 't4579_k1');
  INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, reply_to_id, sender_display_name_snapshot)
  VALUES (pg_temp.u('xm2'), v_conv, pg_temp.u('hadmin'), 'reply', 'text', pg_temp.u('xm1'), 'T hadmin');
  INSERT INTO public.brand_group_reads(conversation_id, user_id, last_read_at)
  VALUES (v_conv, pg_temp.u('k1'), now()) ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = now();
  IF v_guest IS NOT NULL THEN
    INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, sender_kind, sender_display_name_snapshot, sender_role_snapshot)
    VALUES (pg_temp.u('xgm'), v_guest, NULL, 'welcome', 'text', 'brand', 'T4579 One', 'brand');
    INSERT INTO public.brand_guest_post_authors(message_id, conversation_id, author_id) VALUES (pg_temp.u('xgm'), v_guest, pg_temp.u('k1'));
  END IF;
  INSERT INTO public.community_posts(id, author_user_id, kind, title, body, review_state)
  VALUES (pg_temp.u('xpost'), pg_temp.u('k1'), 'question', 'From Mingla', 'hello hosts', 'published');
END;
$xleak_seed$;
DO $xleak$
DECLARE
  r record; q text; v text; v_all text := '';
  v_conv uuid := (SELECT id FROM xleak WHERE k = 'conv');
  v_guest uuid := (SELECT id FROM xleak WHERE k = 'guest');
  v_calls text[] := ARRAY[
    format($q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.biz_brand_team_members(%L) r$q$, pg_temp.u('b1')),
    format($q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_4173_list_brand_group_members(%L) r$q$, v_conv),
    format($q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_3988_list_brand_group_mention_candidates(%L, '', 50) r$q$, v_conv),
    format($q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_3988_list_brand_group_mention_candidates(%L, 't4579', 50) r$q$, v_conv),
    format($q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_3720_list_brand_group_messages(%L, 80, NULL) r$q$, v_conv),
    format($q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_4304_list_brand_group_read_state(%L) r$q$, v_conv),
    $q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_3720_list_brand_groups() r$q$,
    $q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_3720_list_team_mentions(50, NULL) r$q$,
    format($q$SELECT coalesce(public.issue_4579_mingla_team_state(%L)::text, '')$q$, pg_temp.u('b1')),
    $q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_3720_community_feed_v2(NULL) r$q$
  ];
BEGIN
  IF v_guest IS NOT NULL THEN
    v_calls := v_calls || format($q$SELECT coalesce(jsonb_agg(to_jsonb(r))::text, '') FROM public.issue_4579_brand_guest_post_authors(%L, ARRAY[%L]::uuid[]) r$q$, v_guest, pg_temp.u('xgm'));
  END IF;
  FOR r IN SELECT * FROM unnest(ARRAY['hadmin', 'evm', 'owner']) AS t(who) LOOP
    FOREACH q IN ARRAY v_calls LOOP
      BEGIN
        v := pg_temp.val_as(pg_temp.u(r.who), q);
      EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
        EXECUTE 'RESET ROLE';
        v := '';  -- a caller the reader refuses sees nothing at all
      END;
      v := lower(coalesce(v, ''));
      v_all := v_all || v;
      PERFORM pg_temp.ok(position('t4579-k1@' IN v) = 0 AND position('t4579-k2@' IN v) = 0
                         AND position('t4579_k1' IN v) = 0 AND position('t4579_k2' IN v) = 0
                         AND position('"t4579-k1"' IN v) = 0,
        format('X-LEAK %s: %s returns no auto-admin email, username or handle', r.who, left(q, 110)));
    END LOOP;
  END LOOP;
  -- The probe is live: the readers did return the auto-admin, by public name.
  PERFORM pg_temp.ok(position('t k1' IN v_all) > 0, 'X-LEAK the readers do show the auto-admin, by public name');
END;
$xleak$;
ROLLBACK;

-- ═══ Retest 1 (fix pass 8036f8aa0d..8a0016cccf): payout settings are owner-only ═══
-- Angles the implementor's T-9 / T-11 do not take: a payout field smuggled into an
-- otherwise allowed update (atomic refusal), an ownership grab first, a console admin
-- who is NOT on the brand (the "Admins can update brands for claim review" policy), a
-- multi-row update that mixes an owned and a non-owned row, the owner's own multi-row
-- update, a same-value write (no over-blocking), and payouts history writes by a
-- console admin. Run the way PostgREST runs (session authenticator, role authenticated).
-- fails-on-revert: X-9 fails when trigger zz_issue_4579_payout_settings_owner_only is
-- dropped; X-10 fails when the old FOR ALL payouts policy and client grants come back.
CREATE OR REPLACE FUNCTION pg_temp.try_api(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v text := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticator';
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ':' || SQLERRM; END;
  EXECUTE 'RESET ROLE';
  EXECUTE 'RESET SESSION AUTHORIZATION';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END;
$fn$;

-- X-9  brand payout fields by every non-owner shape; the owner and harmless edits still work.
BEGIN;
SELECT pg_temp.fixture();
DO $x9$
DECLARE v text; v_b1 uuid := pg_temp.u('b1'); v_b2 uuid := pg_temp.u('b2');
BEGIN
  -- The owner removes Mingla Team from b2, so k2 is a console admin who is not on b2.
  v := pg_temp.try_api(pg_temp.u('owner'), format('SELECT public.issue_4579_remove_mingla_team(%L)', v_b2));
  PERFORM pg_temp.ok(v = '' AND pg_temp.auto_count('b2') = 0, 'X-9 seed: Mingla Team removed from b2 by the owner');

  -- (a) a payout field smuggled into an allowed profile edit: the whole update is refused.
  v := pg_temp.try_api(pg_temp.u('hadmin'), format(
    'UPDATE public.brands SET description = ''smuggled'', payout_country = ''GB'' WHERE id = %L', v_b1));
  PERFORM pg_temp.ok(v LIKE '42501:payout_settings_owner_only%', 'X-9 invited Brand admin: payout field inside a profile edit is refused');
  PERFORM pg_temp.ok((SELECT description IS DISTINCT FROM 'smuggled' AND payout_country IS NULL FROM public.brands WHERE id = v_b1),
    'X-9 the refused update wrote nothing (atomic)');

  -- (b) take ownership first: refused, so the owner-only rule cannot be sidestepped.
  v := pg_temp.try_api(pg_temp.u('hadmin'), format('UPDATE public.brands SET account_id = %L WHERE id = %L', pg_temp.u('hadmin'), v_b1));
  PERFORM pg_temp.ok(v <> '' AND (SELECT account_id FROM public.brands WHERE id = v_b1) = pg_temp.u('owner'),
    'X-9 a Brand admin cannot make themselves the owner');
  v := pg_temp.try_api(pg_temp.u('k1'), format('UPDATE public.brands SET account_id = %L WHERE id = %L', pg_temp.u('k1'), v_b1));
  PERFORM pg_temp.ok(v <> '' AND (SELECT account_id FROM public.brands WHERE id = v_b1) = pg_temp.u('owner'),
    'X-9 an auto-added admin cannot make themselves the owner');

  -- (c) an auto-added admin who is also a console admin, on the brand.
  v := pg_temp.try_api(pg_temp.u('k1'), format('UPDATE public.brands SET stripe_connect_id = ''acct_k1'' WHERE id = %L', v_b1));
  PERFORM pg_temp.ok(v LIKE '42501:payout_settings_owner_only%', 'X-9 auto-added console admin on the brand is refused');

  -- (d) a console admin NOT on the brand, through the admin claim-review update policy.
  v := pg_temp.try_api(pg_temp.u('k2'), format('UPDATE public.brands SET paystack_subaccount_code = ''ACCT_k2'' WHERE id = %L', v_b2));
  PERFORM pg_temp.ok(v LIKE '42501:payout_settings_owner_only%', 'X-9 console admin off the brand is refused (claim-review policy)');
  v := pg_temp.try_api(pg_temp.u('k2'), format('UPDATE public.brands SET payout_hold_cutover_at = now(), payments_setup_started_at = now() WHERE id = %L', v_b2));
  PERFORM pg_temp.ok(v LIKE '42501:payout_settings_owner_only%', 'X-9 console admin cannot stamp the hold cutover or setup start');
  v := pg_temp.try_api(pg_temp.u('k2'), format('UPDATE public.brands SET description = ''claim note'' WHERE id = %L', v_b2));
  PERFORM pg_temp.ok(v = '' AND (SELECT description FROM public.brands WHERE id = v_b2) = 'claim note',
    'X-9 console admin claim-review edits (non-payout) still save');

  -- (e) multi-row: a non-owner touching two brands in one statement changes neither.
  v := pg_temp.try_api(pg_temp.u('k1'), format(
    'UPDATE public.brands SET stripe_payouts_enabled = true WHERE id IN (%L, %L)', v_b1, v_b2));
  PERFORM pg_temp.ok(v LIKE '42501:payout_settings_owner_only%'
    AND NOT EXISTS (SELECT 1 FROM public.brands WHERE id IN (v_b1, v_b2) AND stripe_payouts_enabled IS TRUE),
    'X-9 a multi-row non-owner update is refused whole');

  -- (f) same-value write by a Brand admin: allowed (no over-blocking of a full-row save).
  v := pg_temp.try_api(pg_temp.u('hadmin'), format(
    'UPDATE public.brands SET name = name, payout_country = payout_country, stripe_connect_id = stripe_connect_id, description = ''same values'' WHERE id = %L', v_b1));
  PERFORM pg_temp.ok(v = '' AND (SELECT description FROM public.brands WHERE id = v_b1) = 'same values',
    'X-9 a full-row save with unchanged payout values still works for a Brand admin');

  -- (g) the owner: a multi-row update of their own brands works.
  v := pg_temp.try_api(pg_temp.u('owner'), format(
    'UPDATE public.brands SET payout_hold_cutover_at = now() WHERE id IN (%L, %L)', v_b1, v_b2));
  PERFORM pg_temp.ok(v = '' AND (SELECT count(*) FROM public.brands WHERE id IN (v_b1, v_b2) AND payout_hold_cutover_at IS NOT NULL) = 2,
    'X-9 the owner updates payout fields on both own brands');
  -- and the owner through the RPC.
  v := pg_temp.try_api(pg_temp.u('owner'), format('SELECT public.biz_set_brand_payout_country(%L, ''GB'')', v_b2));
  PERFORM pg_temp.ok(v = '' AND (SELECT payout_country FROM public.brands WHERE id = v_b2) = 'GB',
    'X-9 the owner sets the bank country through the RPC');
  -- (h) the auto-added admin through the RPC on a brand where the owner already chose: refused.
  v := pg_temp.try_api(pg_temp.u('k1'), format('SELECT public.biz_set_brand_payout_country(%L, ''NG'')', v_b1));
  PERFORM pg_temp.ok(v LIKE '42501:%' AND (SELECT payout_country FROM public.brands WHERE id = v_b1) IS NULL,
    'X-9 auto-added admin cannot set the bank country through the RPC');
END;
$x9$;
ROLLBACK;

-- X-10 payouts history: a console admin off the brand, and every team kind, cannot write it.
BEGIN;
SELECT pg_temp.fixture();
INSERT INTO public.payouts(id, brand_id, stripe_payout_id, amount_cents, currency, status)
VALUES (pg_temp.u('xpo'), pg_temp.u('b2'), 'po_x10', 1000, 'GBP', 'pending');
DO $x10$
DECLARE v text; v_who text;
BEGIN
  v := pg_temp.try_api(pg_temp.u('owner'), format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b2')));
  FOREACH v_who IN ARRAY ARRAY['k2', 'k1', 'owner', 'outsider'] LOOP
    v := pg_temp.try_api(pg_temp.u(v_who), format('UPDATE public.payouts SET status = ''paid'', amount_cents = 1 WHERE id = %L', pg_temp.u('xpo')));
    PERFORM pg_temp.ok(v LIKE '42501:%', format('X-10 %s cannot change a payout row', v_who));
    v := pg_temp.try_api(pg_temp.u(v_who), format(
      'INSERT INTO public.payouts(brand_id, stripe_payout_id, amount_cents, currency, status) VALUES (%L, ''po_x10_forged'', 9, ''GBP'', ''paid'')', pg_temp.u('b2')));
    PERFORM pg_temp.ok(v LIKE '42501:%', format('X-10 %s cannot insert a payout row', v_who));
  END LOOP;
  PERFORM pg_temp.ok((SELECT status = 'pending' AND amount_cents = 1000 FROM public.payouts WHERE id = pg_temp.u('xpo'))
    AND NOT EXISTS (SELECT 1 FROM public.payouts WHERE stripe_payout_id = 'po_x10_forged'),
    'X-10 the payout row is untouched and nothing was forged');
  PERFORM pg_temp.ok(pg_temp.val_as(pg_temp.u('owner'), format('SELECT count(*)::text FROM public.payouts WHERE id = %L', pg_temp.u('xpo'))) = '1',
    'X-10 the owner still reads the payouts history');
END;
$x10$;
ROLLBACK;

-- X-11 name rule, username angle (fix pass): a display name equal to the username in another
--      letter case or with padding, where the email handle is unrelated, falls back; a real
--      first name that merely starts like the username does not.
-- fails-on-revert: X-11 fails when the username comparison is deleted from
-- issue_4579_admin_public_name.
BEGIN;
SELECT pg_temp.fixture();
UPDATE auth.users SET email = 'ops.desk.t4579@example.test' WHERE id = pg_temp.u('k1');
UPDATE public.profiles SET username = 'kunle_adeyemi99', display_name = '  Kunle_Adeyemi99 ' WHERE id = pg_temp.u('k1');
SELECT pg_temp.ok(public.issue_4579_admin_public_name(pg_temp.u('k1')) = 'Mingla Team', 'X-11 display name = username (case, padding) falls back');
UPDATE public.profiles SET display_name = 'KUNLE_ADEYEMI99' WHERE id = pg_temp.u('k1');
SELECT pg_temp.ok(public.issue_4579_admin_public_name(pg_temp.u('k1')) = 'Mingla Team', 'X-11 upper-case username falls back');
UPDATE public.profiles SET display_name = 'Kunle' WHERE id = pg_temp.u('k1');
SELECT pg_temp.ok(public.issue_4579_admin_public_name(pg_temp.u('k1')) = 'Kunle', 'X-11 a first name that is a prefix of the username is kept');
UPDATE public.profiles SET username = NULL, display_name = 'kunle_adeyemi99' WHERE id = pg_temp.u('k1');
SELECT pg_temp.ok(public.issue_4579_admin_public_name(pg_temp.u('k1')) = 'kunle_adeyemi99', 'X-11 no username: the rule does not invent a match (handle rule unrelated)');
ROLLBACK;

-- X-12 older Community readers (retest 2, P2-2 fix): through the v1 feed and comments_v2 an
--      active Mingla admin is never shown by a handle, whatever shape the leak takes: a display
--      name that is the email (upper-cased, padded), the email's local part, or the username; an
--      admin_users email that differs from the sign-in email only by case and padding is still
--      recognised; the admin's own pending post (is_mine path) is masked too; no admin label in
--      either reader equals or contains any of the suite's usernames, emails or local parts; a
--      host keeps their own name and a staff answer keeps its staff name (no over-masking).
-- fails-on-revert: restoring the 20271103003720 v1 feed body or the 20271108073720
-- comments_v2 body (raw profiles.display_name) fails X-12.
BEGIN;
SELECT pg_temp.fixture();
-- k1: display name is the sign-in email, upper-cased and padded.
UPDATE public.profiles SET display_name = '  T4579-K1@EXAMPLE.TEST ' WHERE id = pg_temp.u('k1');
-- k2: display name is the email's local part in another case.
UPDATE public.profiles SET display_name = 'T4579-K2' WHERE id = pg_temp.u('k2');
-- kinv: display name is the username; the admin row's email differs only by case and padding.
UPDATE public.profiles SET username = 'kinv_ops', display_name = 'Kinv_Ops' WHERE id = pg_temp.u('kinv');
UPDATE public.admin_users SET email = '  T4579-KINV@Example.Test ' WHERE id = pg_temp.u('akinv');
UPDATE public.profiles SET display_name = 'Ada Owner' WHERE id = pg_temp.u('owner');
INSERT INTO public.community_posts(id, author_user_id, kind, title, body, review_state) VALUES
  (pg_temp.u('xp_k1'), pg_temp.u('k1'), 'question', 'x12 k1', 'body', 'published'),
  (pg_temp.u('xp_kinv'), pg_temp.u('kinv'), 'question', 'x12 kinv', 'body', 'published'),
  (pg_temp.u('xp_k2_pending'), pg_temp.u('k2'), 'question', 'x12 k2 pending', 'body', 'pending'),
  (pg_temp.u('xp_owner'), pg_temp.u('owner'), 'question', 'x12 owner', 'body', 'published');
INSERT INTO public.community_post_comments(id, post_id, author_user_id, body, staff_answer, staff_display_name) VALUES
  (pg_temp.u('xc_k1'), pg_temp.u('xp_owner'), pg_temp.u('k1'), 'c k1', false, NULL),
  (pg_temp.u('xc_k2'), pg_temp.u('xp_owner'), pg_temp.u('k2'), 'c k2', false, NULL),
  (pg_temp.u('xc_kinv'), pg_temp.u('xp_owner'), pg_temp.u('kinv'), 'c kinv', false, NULL),
  (pg_temp.u('xc_owner'), pg_temp.u('xp_owner'), pg_temp.u('owner'), 'c owner', false, NULL),
  (pg_temp.u('xc_staff'), pg_temp.u('xp_owner'), pg_temp.u('k2'), 'c staff', true, 'Mingla Support');
DO $x12$
DECLARE feed jsonb; own jsonb; cm jsonb; lbl text; bad text;
BEGIN
  PERFORM pg_temp.ok(public.issue_4579_is_active_mingla_admin_uid(pg_temp.u('kinv')),
    'X-12 an admin row whose email differs only by case and padding is still an active admin');
  feed := pg_temp.val_as(pg_temp.u('owner'), $$SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)::text FROM public.issue_3720_community_feed(NULL) r$$)::jsonb;
  own  := pg_temp.val_as(pg_temp.u('k2'), $$SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)::text FROM public.issue_3720_community_feed(NULL) r$$)::jsonb;
  cm   := pg_temp.val_as(pg_temp.u('owner'), format('SELECT coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb)::text FROM public.issue_3720_community_comments_v2(%L) r', pg_temp.u('xp_owner')))::jsonb;

  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(feed) e WHERE e->>'id' = pg_temp.u('xp_k1')::text) = 'Mingla Team',
    'X-12 v1 feed: an admin whose display name is their email (case, padding) shows Mingla Team');
  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(feed) e WHERE e->>'id' = pg_temp.u('xp_kinv')::text) = 'Mingla Team',
    'X-12 v1 feed: an admin whose display name is their username shows Mingla Team (admin row email in another case)');
  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(feed) e WHERE e->>'id' = pg_temp.u('xp_owner')::text) = 'Ada Owner',
    'X-12 v1 feed: a host keeps their own name');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(feed) e WHERE e->>'id' = pg_temp.u('xp_k2_pending')::text),
    'X-12 v1 feed: another member never sees an admin''s pending post');
  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(own) e WHERE e->>'id' = pg_temp.u('xp_k2_pending')::text) = 'Mingla Team',
    'X-12 v1 feed: the admin''s own pending post (is_mine) is masked too');

  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(cm) e WHERE e->>'id' = pg_temp.u('xc_k1')::text) = 'Mingla Team',
    'X-12 comments_v2: email-shaped display name shows Mingla Team');
  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(cm) e WHERE e->>'id' = pg_temp.u('xc_k2')::text) = 'Mingla Team',
    'X-12 comments_v2: local-part display name shows Mingla Team');
  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(cm) e WHERE e->>'id' = pg_temp.u('xc_kinv')::text) = 'Mingla Team',
    'X-12 comments_v2: username display name shows Mingla Team');
  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(cm) e WHERE e->>'id' = pg_temp.u('xc_owner')::text) = 'Ada Owner',
    'X-12 comments_v2: a host keeps their own name');
  PERFORM pg_temp.ok((SELECT e->>'author_label' FROM jsonb_array_elements(cm) e WHERE e->>'id' = pg_temp.u('xc_staff')::text) = 'Mingla Support',
    'X-12 comments_v2: a staff answer keeps its staff name');

  -- Sweep: no label from an admin author, in either reader, equals or contains a handle.
  SELECT string_agg(lbl2, ', ') INTO bad FROM (
    SELECT e->>'author_label' AS lbl2 FROM jsonb_array_elements(feed || own || cm) e
  ) s
  WHERE EXISTS (
    SELECT 1 FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
     WHERE u.id IN (pg_temp.u('k1'), pg_temp.u('k2'), pg_temp.u('kinv'))
       AND (position(lower(split_part(u.email::text, '@', 1)) IN lower(s.lbl2)) > 0
            OR position('@' IN s.lbl2) > 0
            OR (p.username IS NOT NULL AND position(lower(p.username) IN lower(s.lbl2)) > 0))
  );
  PERFORM pg_temp.ok(bad IS NULL, 'X-12 sweep: no admin label in either reader carries an email, local part or username (' || coalesce(bad, 'none') || ')');
END;
$x12$;
ROLLBACK;
