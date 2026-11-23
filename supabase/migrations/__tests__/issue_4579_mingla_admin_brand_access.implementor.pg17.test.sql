-- MINGLA-INVARIANT: I-4579-MINGLA-TEAM-ENTRY | issue #4579 | INVARIANT issue_4579: hosts see granted_via='mingla_admin' members only as one "Mingla Team" entry on Team & permissions (never name, email, handle, avatar, id or count); everywhere else an auto-admin is shown only by issue_4579_admin_public_name (never an email or handle) with an is_mingla_team flag; removing Mingla Team tombstones the brand and nothing automatic re-adds it; only the owner's restore re-grants; a removed invited Mingla admin is never re-added except by an accepted invite.
--
-- #4579 (20281201014579_issue_4579_mingla_admin_brand_access.sql): PostgreSQL 17 proof after the
-- full replay, run as supabase_admin. Every block runs in one transaction and rolls back.
--
-- T-1  backfill (SC-1): each qualifying admin gets an active brand_admin mingla_admin row on every
--      live brand; an existing role (a scanner row) is kept, never downgraded; partners, invited
--      admins and the brand's own account get nothing; a re-run inserts 0; no invitation and no
--      notification outbox row is written.
-- T-2  new brand and admin lifecycle (SC-2/SC-3): a new brand gets every qualifying admin, never its
--      owner; activation grants; revoke and admin -> partner remove only mingla_admin rows with
--      removal_reason mingla_admin_revoked and write no opt-out; an invited row is left alone;
--      an email change moves the rows to the new identity.
-- T-3  host reads (SC-3/SC-12): biz_brand_team_members returns exactly one entry_kind mingla_team row
--      (no id, email, avatar) and no admin id or email anywhere; a host's direct SELECT sees no auto
--      row and a direct UPDATE of one changes nothing; clients cannot change granted_via,
--      granted_admin_user_id or removal_reason (42501).
-- T-4  remove / restore (SC-4/SC-5/SC-6): below rank 50 is forbidden; brand admin removes; all auto
--      rows go, the tombstone exists, the audit row names no admin, and grant, revoke+restore, a new
--      admin and a backfill re-run add nothing; brand admin (including an auto-admin) cannot
--      restore; the owner can; removing one auto row by member id has the same effect.
-- T-5  invited Mingla admins (SC-7, SC-5 v1): an invite row is not part of Mingla Team, survives
--      remove_mingla_team and admin revoke; when the host removes it, a per-person opt-out keeps
--      every automatic path off; an accepted invite clears it; an invite accepted onto an auto row
--      turns it into an ordinary membership that a later revoke leaves alone.
-- T-6  names (SC-9 v3, SC-14, SC-15): the public-name rule; roster, mention candidates, messages,
--      replies, read state, the group list and guest post authors show the public name with the flag
--      and never the email or handle; support replies keep their stored name; an invited member's
--      row is unchanged with is_mingla_team false.
-- T-7  parity (SC-8, SC-10, SC-11): auto-admins are brand group participants and brand-role
--      recipients; their terms acceptance records brand_terms_acceptances; payouts stay owner-only.
-- T-9  payout settings (fix pass): every payout field on the brand row is owner-only by any
--      client path; service-role and no-user server paths are unchanged.
-- T-10 Host Community (fix pass): a Mingla admin's post shows Mingla Team and the public name.
-- T-11 payouts history (fix pass): only the service role writes it; the team still reads it.
-- T-8  catalog: every host-facing reader in spec v3 section 3 calls issue_4579_; the helpers that
--      grant or revoke are not executable by authenticated.
--
-- FAILS-ON-REVERT: deleting the collapse branch fails T-3; deleting the tombstone insert or the
-- opt-out checks in issue_4579_grant_admin / grant_brand fails T-4/T-5; deleting the public-name
-- CASE in any reader fails T-6 or T-8; deleting the source guard fails T-3 (42501) and T-5.

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4579 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4579:' || p_tag)::uuid $fn$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END;
$fn$;

-- Run p_sql as the given user under the authenticated role; return '' or SQLSTATE:message.
CREATE OR REPLACE FUNCTION pg_temp.try_as(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v text := '';
BEGIN
  PERFORM pg_temp.as_user(p_user);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v := SQLSTATE || ':' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$fn$;

-- T-9: run p_sql the way PostgREST does (session authenticator, role authenticated).
CREATE OR REPLACE FUNCTION pg_temp.try_api(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v text := '';
BEGIN
  PERFORM pg_temp.as_user(p_user);
  EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticator';
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v := SQLSTATE || ':' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  EXECUTE 'RESET SESSION AUTHORIZATION';
  RETURN v;
END;
$fn$;

-- Run a query returning one jsonb value as the given user.
CREATE OR REPLACE FUNCTION pg_temp.json_as(p_user uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_user(p_user);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$fn$;

-- Fixture: users, brands, members. Admin rows are inserted with triggers off, so the
-- backfill (T-1) is what grants them.
CREATE OR REPLACE FUNCTION pg_temp.fixture()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['owner','host','low','a1','a2','a3','a4','a4b','a5','partner','inv'] LOOP
    INSERT INTO auth.users(id, email) VALUES (pg_temp.u(t), 'i4579-' || t || '@example.test');
    INSERT INTO public.creator_accounts(id, email) VALUES (pg_temp.u(t), 'i4579-' || t || '@example.test');
    INSERT INTO public.profiles(id, email, username, display_name)
      VALUES (pg_temp.u(t), 'i4579-' || t || '@example.test', 'i4579_' || t || '_handle',
              CASE t WHEN 'a1' THEN 'Kunle' WHEN 'host' THEN 'Hana Host' ELSE 'i4579-' || t END);
  END LOOP;

  -- B1, B2 owned by owner; B3 owned by admin a2.
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (pg_temp.u('b1'), pg_temp.u('owner'), 'I4579 One', 'i4579-one'),
    (pg_temp.u('b2'), pg_temp.u('owner'), 'I4579 Two', 'i4579-two'),
    (pg_temp.u('b3'), pg_temp.u('a2'), 'I4579 Three', 'i4579-three');

  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at) VALUES
    (pg_temp.u('b1'), pg_temp.u('host'), 'brand_admin', now(), now()),
    (pg_temp.u('b1'), pg_temp.u('low'), 'scanner', now(), now()),
    (pg_temp.u('b1'), pg_temp.u('a3'), 'scanner', now(), now()),
    (pg_temp.u('b2'), pg_temp.u('inv'), 'event_manager', now(), now());

  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.admin_users(id, email, role, status) VALUES
    (pg_temp.u('au1'), 'i4579-a1@example.test', 'admin', 'active'),
    (pg_temp.u('au2'), 'I4579-A2@example.test ', 'owner', 'active'),
    (pg_temp.u('au3'), 'i4579-a3@example.test', 'admin', 'active'),
    (pg_temp.u('au4'), 'i4579-a4@example.test', 'admin', 'invited'),
    (pg_temp.u('aup'), 'i4579-partner@example.test', 'partner', 'active'),
    (pg_temp.u('aui'), 'i4579-inv@example.test', 'admin', 'active');
  PERFORM set_config('session_replication_role', 'origin', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.backfill()
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE r record; v integer := 0;
BEGIN
  FOR r IN SELECT au.id FROM public.admin_users au
            WHERE au.role IN ('admin', 'owner') AND au.status = 'active'
  LOOP
    v := v + public.issue_4579_grant_admin(r.id);
  END LOOP;
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.auto_active(p_brand text, p_user text)
RETURNS boolean LANGUAGE sql AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.brand_team_members m
                  WHERE m.brand_id = pg_temp.u(p_brand) AND m.user_id = pg_temp.u(p_user)
                    AND m.granted_via = 'mingla_admin' AND m.role = 'brand_admin'
                    AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.active_rows(p_brand text, p_user text)
RETURNS integer LANGUAGE sql AS $fn$
  SELECT count(*)::integer FROM public.brand_team_members m
   WHERE m.brand_id = pg_temp.u(p_brand) AND m.user_id = pg_temp.u(p_user) AND m.removed_at IS NULL
$fn$;

-- Scoped to this suite's people: admins another suite left behind may also be granted.
CREATE OR REPLACE FUNCTION pg_temp.auto_count(p_brand text)
RETURNS integer LANGUAGE sql AS $fn$
  SELECT count(*)::integer FROM public.brand_team_members m
   WHERE m.brand_id = pg_temp.u(p_brand) AND m.granted_via = 'mingla_admin' AND m.removed_at IS NULL
     AND m.user_id IN (SELECT pg_temp.u(t) FROM unnest(ARRAY['owner','host','low','a1','a2','a3','a4','a4b','a5','partner','inv']) t)
$fn$;

-- ═══ T-1 backfill ══════════════════════════════════════════════════════════════
BEGIN;
SELECT pg_temp.fixture();
DO $t1$
DECLARE v_first integer; v_again integer; v_outbox_before bigint; v_inv_before bigint;
BEGIN
  SELECT count(*) INTO v_outbox_before FROM public.notification_outbox;
  SELECT count(*) INTO v_inv_before FROM public.brand_invitations;
  v_first := pg_temp.backfill();
  PERFORM pg_temp.ok(pg_temp.auto_active('b1','a1') AND pg_temp.auto_active('b2','a1') AND pg_temp.auto_active('b3','a1'),
    'T-1 SC-1 a1 is an auto brand_admin on every live brand');
  PERFORM pg_temp.ok(pg_temp.auto_active('b1','a2') AND pg_temp.auto_active('b2','a2'),
    'T-1 SC-1 a2 (owner role, untrimmed mixed-case email) is granted');
  PERFORM pg_temp.ok(NOT pg_temp.auto_active('b3','a2') AND pg_temp.active_rows('b3','a2') = 1,
    'T-1 the brand account (a2 owns b3) gets no auto row, only its owner row');
  PERFORM pg_temp.ok(
    (SELECT role = 'scanner' AND granted_via = 'invite' FROM public.brand_team_members
      WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('a3') AND removed_at IS NULL)
    AND pg_temp.active_rows('b1','a3') = 1 AND pg_temp.auto_active('b2','a3'),
    'T-1 no downgrade: a3 keeps its scanner row on b1, unmarked, and is granted on b2');
  PERFORM pg_temp.ok(
    (SELECT role = 'event_manager' AND granted_via = 'invite' FROM public.brand_team_members
      WHERE brand_id = pg_temp.u('b2') AND user_id = pg_temp.u('inv') AND removed_at IS NULL)
    AND pg_temp.auto_active('b1','inv'),
    'T-1 an invited Mingla admin keeps the invite row and is granted elsewhere');
  PERFORM pg_temp.ok(pg_temp.active_rows('b1','partner') = 0 AND pg_temp.active_rows('b1','a4') = 0,
    'T-1 partners and invited (not yet active) admins get nothing');
  PERFORM pg_temp.ok(pg_temp.auto_count('b1') + pg_temp.auto_count('b2') + pg_temp.auto_count('b3') = 9
    AND v_first >= 9,
    format('T-1 backfill inserted 9 rows on the fixture brands (total inserted %s)', v_first));
  v_again := pg_temp.backfill();
  PERFORM pg_temp.ok(v_again = 0, 'T-1 SC-1 backfill re-run inserts 0');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.brand_invitations) = v_inv_before,
    'T-1 no invitation is created (no invite email)');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.notification_outbox) = v_outbox_before,
    'T-1 no notification outbox row (no owner alert)');
  PERFORM pg_temp.ok(
    (SELECT bool_and(m.mingla_tos_accepted_at IS NULL) FROM public.brand_team_members m WHERE m.granted_via = 'mingla_admin'),
    'T-1 auto rows start with no terms acceptance (each admin accepts for themselves)');
END;
$t1$;
ROLLBACK;

-- ═══ T-2 new brand and admin lifecycle ══════════════════════════════════════════
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
DO $t2$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug) VALUES (pg_temp.u('b4'), pg_temp.u('owner'), 'I4579 Four', 'i4579-four');
  PERFORM pg_temp.ok(pg_temp.auto_active('b4','a1') AND pg_temp.auto_active('b4','a2')
    AND pg_temp.auto_active('b4','a3') AND pg_temp.auto_active('b4','inv') AND pg_temp.auto_count('b4') = 4,
    'T-2 SC-2 a new brand gets every qualifying admin');
  INSERT INTO public.brands(id, account_id, name, slug) VALUES (pg_temp.u('b5'), pg_temp.u('a1'), 'I4579 Five', 'i4579-five');
  PERFORM pg_temp.ok(NOT pg_temp.auto_active('b5','a1') AND pg_temp.active_rows('b5','a1') = 1,
    'T-2 SC-2 never its owner');

  UPDATE public.admin_users SET status = 'active', accepted_at = now() WHERE id = pg_temp.u('au4');
  PERFORM pg_temp.ok(pg_temp.auto_active('b1','a4') AND pg_temp.auto_active('b2','a4') AND pg_temp.auto_active('b4','a4'),
    'T-2 SC-3 activation adds the admin to every brand');

  UPDATE public.admin_users SET status = 'revoked' WHERE id = pg_temp.u('au3');
  PERFORM pg_temp.ok(NOT pg_temp.auto_active('b2','a3')
    AND (SELECT removal_reason FROM public.brand_team_members WHERE brand_id = pg_temp.u('b2')
          AND user_id = pg_temp.u('a3') ORDER BY invited_at DESC LIMIT 1) = 'mingla_admin_revoked',
    'T-2 SC-3 revoke removes the auto rows with removal_reason mingla_admin_revoked');
  PERFORM pg_temp.ok(pg_temp.active_rows('b1','a3') = 1,
    'T-2 SC-3 revoke leaves the invited scanner row');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts WHERE brand_id IN (pg_temp.u('b2'), pg_temp.u('b4')))
    AND NOT EXISTS (SELECT 1 FROM public.brand_mingla_admin_optouts WHERE user_id = pg_temp.u('a3')),
    'T-2 SC-3 a revoke writes no opt-out');
  UPDATE public.admin_users SET status = 'active' WHERE id = pg_temp.u('au3');
  PERFORM pg_temp.ok(pg_temp.auto_active('b2','a3') AND pg_temp.active_rows('b2','a3') = 1,
    'T-2 restoring the admin grants again');

  UPDATE public.admin_users SET role = 'partner' WHERE id = pg_temp.u('au4');
  PERFORM pg_temp.ok(NOT pg_temp.auto_active('b1','a4') AND NOT pg_temp.auto_active('b4','a4'),
    'T-2 SC-3 admin -> partner removes the auto rows');
  UPDATE public.admin_users SET role = 'admin' WHERE id = pg_temp.u('au4');
  UPDATE public.admin_users SET email = 'i4579-a4b@example.test' WHERE id = pg_temp.u('au4');
  PERFORM pg_temp.ok(NOT pg_temp.auto_active('b1','a4') AND pg_temp.auto_active('b1','a4b') AND pg_temp.auto_active('b4','a4b'),
    'T-2 an email change moves the auto rows to the new identity');
END;
$t2$;
ROLLBACK;

-- ═══ T-3 host reads and the column guard ═══════════════════════════════════════
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
CREATE TEMP TABLE i4579_out (k text PRIMARY KEY, v jsonb);
GRANT ALL ON i4579_out TO authenticated;
DO $t3$
DECLARE v jsonb; v_text text; t text; v_err text;
BEGIN
  v := pg_temp.json_as(pg_temp.u('host'),
    format('SELECT jsonb_agg(to_jsonb(r)) FROM public.biz_brand_team_members(%L) r', pg_temp.u('b1')));
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(v) e WHERE e->>'entry_kind' = 'mingla_team') = 1
    AND pg_temp.auto_count('b1') >= 3,
    'T-3 SC-3 exactly one Mingla Team entry however many admins are on b1');
  PERFORM pg_temp.ok((SELECT bool_and(e->>'display_name' = 'Mingla Team' AND e->'user_id' = 'null'::jsonb
      AND e->'member_id' = 'null'::jsonb AND e->'email' = 'null'::jsonb AND e->'avatar_url' = 'null'::jsonb
      AND e->>'role' = 'brand_admin')
    FROM jsonb_array_elements(v) e WHERE e->>'entry_kind' = 'mingla_team'),
    'T-3 SC-3 the entry has no id, email or avatar');
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(v) e WHERE e->>'entry_kind' = 'member') = 4,
    'T-3 per-person rows: owner, host, low and the invited scanner admin');
  v_text := v::text;
  FOREACH t IN ARRAY ARRAY['a1','a2','inv'] LOOP
    PERFORM pg_temp.ok(position(pg_temp.u(t)::text IN v_text) = 0
      AND position(('i4579-' || t || '@') IN v_text) = 0,
      'T-3 SC-3 no auto-admin id or email in the team result: ' || t);
  END LOOP;

  v := pg_temp.json_as(pg_temp.u('host'),
    format('SELECT jsonb_agg(to_jsonb(m)) FROM public.brand_team_members m WHERE m.brand_id = %L', pg_temp.u('b1')));
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(v) e WHERE e->>'granted_via' = 'mingla_admin') = 0
    AND jsonb_array_length(v) = 4,
    'T-3 SC-12 a host''s direct SELECT returns no auto rows');
  v_err := pg_temp.try_as(pg_temp.u('host'), format(
    'WITH u AS (UPDATE public.brand_team_members SET removed_at = now() WHERE brand_id = %L AND user_id = %L AND removed_at IS NULL RETURNING 1) INSERT INTO i4579_out SELECT ''direct'', to_jsonb(count(*)) FROM u',
    pg_temp.u('b1'), pg_temp.u('a1')));
  PERFORM pg_temp.ok(v_err = '' AND (SELECT o.v FROM i4579_out o WHERE o.k = 'direct') = '0'::jsonb AND pg_temp.auto_active('b1','a1'),
    'T-3 a host''s direct UPDATE cannot reach an auto row');

  v_err := pg_temp.try_as(pg_temp.u('host'), format(
    'UPDATE public.brand_team_members SET granted_via = %L, granted_admin_user_id = %L WHERE brand_id = %L AND user_id = %L',
    'mingla_admin', pg_temp.u('au1'), pg_temp.u('b1'), pg_temp.u('low')));
  PERFORM pg_temp.ok(v_err LIKE '42501:%', 'T-3 SC-12 a client cannot mark a row mingla_admin (42501): ' || v_err);
  v_err := pg_temp.try_as(pg_temp.u('a1'), format(
    'UPDATE public.brand_team_members SET granted_via = %L, granted_admin_user_id = NULL WHERE brand_id = %L AND user_id = %L',
    'invite', pg_temp.u('b1'), pg_temp.u('a1')));
  PERFORM pg_temp.ok(v_err LIKE '42501:%', 'T-3 SC-12 an auto-admin cannot unmark their own row (42501): ' || v_err);
  v_err := pg_temp.try_as(pg_temp.u('host'), format(
    'UPDATE public.brand_team_members SET removal_reason = %L WHERE brand_id = %L AND user_id = %L',
    'mingla_team_removed', pg_temp.u('b1'), pg_temp.u('low')));
  PERFORM pg_temp.ok(v_err LIKE '42501:%', 'T-3 SC-12 a client cannot set removal_reason (42501)');
END;
$t3$;
ROLLBACK;

-- ═══ T-4 remove / restore Mingla Team ═══════════════════════════════════════════
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
DO $t4$
DECLARE v jsonb; v_err text;
BEGIN
  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT public.issue_4579_mingla_team_state(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v->>'status' = 'active' AND (v->>'can_remove')::boolean AND NOT (v->>'can_restore')::boolean
    AND NOT v ? 'count',
    'T-4 state: active, brand admin can remove, cannot restore');
  v_err := pg_temp.try_as(pg_temp.u('low'), format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v_err LIKE 'P0001:forbidden%', 'T-4 SC-5 below rank 50 is forbidden');
  v_err := pg_temp.try_as(NULL, format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v_err <> '', 'T-4 anon cannot remove');

  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v = '{"status":"removed"}'::jsonb, 'T-4 SC-4 remove returns removed and no count');
  PERFORM pg_temp.ok(pg_temp.auto_count('b1') = 0
    AND (SELECT bool_and(removal_reason = 'mingla_team_removed') FROM public.brand_team_members
          WHERE brand_id = pg_temp.u('b1') AND granted_via = 'mingla_admin'),
    'T-4 SC-4 every auto row on b1 is removed (mingla_team_removed)');
  PERFORM pg_temp.ok((SELECT removed_by = pg_temp.u('host') FROM public.brand_mingla_team_optouts WHERE brand_id = pg_temp.u('b1')),
    'T-4 SC-4 the brand tombstone exists');
  PERFORM pg_temp.ok(pg_temp.active_rows('b1','a3') = 1 AND pg_temp.active_rows('b1','host') = 1,
    'T-4 invited members are untouched');
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM public.audit_log a WHERE a.brand_id = pg_temp.u('b1') AND a.action = 'mingla_team_removed') = 1
    AND NOT EXISTS (SELECT 1 FROM public.audit_log a WHERE a.brand_id = pg_temp.u('b1') AND a.action = 'mingla_team_removed'
                     AND (a.after::text LIKE '%' || pg_temp.u('a1')::text || '%' OR a.after ? 'count')),
    'T-4 one audit row, naming no admin and no count');
  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v->>'status' = 'removed', 'T-4 remove is idempotent');

  -- Nothing automatic re-adds Mingla to b1.
  PERFORM public.issue_4579_grant_admin(pg_temp.u('au1'));
  UPDATE public.admin_users SET status = 'revoked' WHERE id = pg_temp.u('au1');
  UPDATE public.admin_users SET status = 'active' WHERE id = pg_temp.u('au1');
  UPDATE public.admin_users SET status = 'active' WHERE id = pg_temp.u('au4');
  PERFORM pg_temp.backfill();
  PERFORM public.issue_4579_grant_brand(pg_temp.u('b1'));
  PERFORM pg_temp.ok(pg_temp.auto_count('b1') = 0 AND pg_temp.auto_active('b2','a4'),
    'T-4 SC-4 grant, revoke+restore, a new admin and a backfill re-run add nothing to b1');

  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT public.issue_4579_mingla_team_state(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v->>'status' = 'removed' AND NOT (v->>'can_restore')::boolean, 'T-4 state removed; brand admin cannot restore');
  v_err := pg_temp.try_as(pg_temp.u('host'), format('SELECT public.issue_4579_restore_mingla_team(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v_err LIKE 'P0001:forbidden%', 'T-4 SC-5 a brand admin cannot restore');
  -- An auto-admin on b2 cannot restore b2 after removing it.
  PERFORM pg_temp.json_as(pg_temp.u('a1'), format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b2')));
  v_err := pg_temp.try_as(pg_temp.u('a1'), format('SELECT public.issue_4579_restore_mingla_team(%L)', pg_temp.u('b2')));
  PERFORM pg_temp.ok(v_err <> '' AND pg_temp.auto_count('b2') = 0, 'T-4 SC-5 an auto-admin can remove but never restore');

  v := pg_temp.json_as(pg_temp.u('owner'), format('SELECT public.issue_4579_mingla_team_state(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok((v->>'can_restore')::boolean, 'T-4 the owner can restore');
  v := pg_temp.json_as(pg_temp.u('owner'), format('SELECT public.issue_4579_restore_mingla_team(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v = '{"status":"active"}'::jsonb
    AND pg_temp.auto_active('b1','a1') AND pg_temp.auto_active('b1','a2') AND pg_temp.auto_active('b1','a4')
    AND pg_temp.auto_active('b1','inv') AND pg_temp.active_rows('b1','a3') = 1
    AND NOT EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts WHERE brand_id = pg_temp.u('b1')),
    'T-4 SC-5 owner restore re-grants every active admin and clears the tombstone (no count returned)');
END;
$t4$;
ROLLBACK;

BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
DO $t4b$
DECLARE v_member uuid; v_err text;
BEGIN
  SELECT id INTO v_member FROM public.brand_team_members
   WHERE brand_id = pg_temp.u('b2') AND user_id = pg_temp.u('a1') AND removed_at IS NULL;
  v_err := pg_temp.try_as(pg_temp.u('owner'), format('SELECT public.biz_remove_brand_team_member(%L, %L)', pg_temp.u('b2'), v_member));
  PERFORM pg_temp.ok(v_err = '', 'T-4 SC-6 removal by member id succeeds: ' || v_err);
  PERFORM pg_temp.ok(pg_temp.auto_count('b2') = 0
    AND EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts WHERE brand_id = pg_temp.u('b2'))
    AND (SELECT removal_reason FROM public.brand_team_members WHERE id = v_member) = 'mingla_team_removed',
    'T-4 SC-6 removing one auto row removes all of Mingla Team and tombstones the brand');
  PERFORM pg_temp.backfill();
  PERFORM pg_temp.ok(pg_temp.auto_count('b2') = 0 AND pg_temp.active_rows('b2','inv') = 1,
    'T-4 SC-6 a backfill re-run adds nothing; the invited admin stays');
END;
$t4b$;
ROLLBACK;

-- ═══ T-5 invited Mingla admins ══════════════════════════════════════════════════
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
DO $t5$
DECLARE v_member uuid; v_err text; v_token text := 'i4579-token-inv'; v_token2 text := 'i4579-token-a1';
BEGIN
  PERFORM pg_temp.json_as(pg_temp.u('owner'), format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b2')));
  PERFORM pg_temp.ok(pg_temp.active_rows('b2','inv') = 1, 'T-5 SC-7 remove_mingla_team leaves an invited admin');
  UPDATE public.admin_users SET status = 'revoked' WHERE id = pg_temp.u('aui');
  PERFORM pg_temp.ok(pg_temp.active_rows('b2','inv') = 1, 'T-5 SC-7 an admin revoke leaves an invited admin');
  UPDATE public.admin_users SET status = 'active' WHERE id = pg_temp.u('aui');

  SELECT id INTO v_member FROM public.brand_team_members
   WHERE brand_id = pg_temp.u('b2') AND user_id = pg_temp.u('inv') AND removed_at IS NULL;
  v_err := pg_temp.try_as(pg_temp.u('owner'), format('SELECT public.biz_remove_brand_team_member(%L, %L)', pg_temp.u('b2'), v_member));
  PERFORM pg_temp.ok(v_err = '' AND EXISTS (SELECT 1 FROM public.brand_mingla_admin_optouts
                                             WHERE brand_id = pg_temp.u('b2') AND user_id = pg_temp.u('inv')),
    'T-5 SC-7 the host removing an invited admin writes the per-person opt-out');
  PERFORM pg_temp.json_as(pg_temp.u('owner'), format('SELECT public.issue_4579_restore_mingla_team(%L)', pg_temp.u('b2')));
  PERFORM public.issue_4579_grant_admin(pg_temp.u('aui'));
  PERFORM pg_temp.ok(pg_temp.active_rows('b2','inv') = 0 AND pg_temp.auto_active('b2','a1'),
    'T-5 SC-7 restore and grants re-add Mingla Team but not the removed invited admin');

  INSERT INTO public.brand_invitations(brand_id, email, role, token_hash, expires_at)
  VALUES (pg_temp.u('b2'), 'i4579-inv@example.test', 'event_manager', v_token, now() + interval '1 day');
  PERFORM public.accept_invite_and_transfer_brand_ownership(v_token, pg_temp.u('inv'));
  PERFORM pg_temp.ok(pg_temp.active_rows('b2','inv') = 1
    AND NOT EXISTS (SELECT 1 FROM public.brand_mingla_admin_optouts WHERE brand_id = pg_temp.u('b2') AND user_id = pg_temp.u('inv')),
    'T-5 an accepted invite brings them back and clears the opt-out');

  -- Invite accepted onto an auto row (the accept reuses the newest row). The grant
  -- happened earlier in real life: backdate it as the automatic writer would.
  PERFORM set_config('app.issue_4579_auto', 'on', true);
  UPDATE public.brand_team_members SET accepted_at = accepted_at - interval '1 day'
   WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('a1') AND removed_at IS NULL;
  PERFORM set_config('app.issue_4579_auto', '', true);
  INSERT INTO public.brand_invitations(brand_id, email, role, token_hash, expires_at)
  VALUES (pg_temp.u('b1'), 'i4579-a1@example.test', 'brand_admin', v_token2, now() + interval '1 day');
  PERFORM public.accept_invite_and_transfer_brand_ownership(v_token2, pg_temp.u('a1'));
  PERFORM pg_temp.ok(pg_temp.active_rows('b1','a1') = 1
    AND (SELECT granted_via = 'invite' AND granted_admin_user_id IS NULL FROM public.brand_team_members
          WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('a1') AND removed_at IS NULL),
    'T-5 SC-5 an invite accepted onto an auto row makes it an ordinary membership');
  UPDATE public.admin_users SET status = 'revoked' WHERE id = pg_temp.u('au1');
  PERFORM pg_temp.ok(pg_temp.active_rows('b1','a1') = 1 AND NOT pg_temp.auto_active('b2','a1'),
    'T-5 SC-5 a later admin revoke leaves that row and removes the others');
  PERFORM pg_temp.ok(NOT public.issue_4579_is_mingla_team_member(pg_temp.u('b1'), pg_temp.u('a1')),
    'T-5 an invited admin is not shown as Mingla Team');
END;
$t5$;
ROLLBACK;

-- ═══ T-6 names ═════════════════════════════════════════════════════════════════
BEGIN;
SELECT pg_temp.fixture();
DO $t6a$
DECLARE r record;
BEGIN
  -- SC-14: the email is i4579-a5@example.test, so the handle is i4579-a5.
  FOR r IN SELECT * FROM (VALUES
      (NULL::text, 'Mingla Team'), ('', 'Mingla Team'), ('   ', 'Mingla Team'),
      ('i4579-a5@example.test', 'Mingla Team'), ('I4579-A5@EXAMPLE.TEST', 'Mingla Team'),
      ('someone@else', 'Mingla Team'), ('i4579-a5', 'Mingla Team'), ('i4579a5', 'Mingla Team'),
      (repeat('a', 41), 'Mingla Team'), (E'Kun\tle', 'Mingla Team'),
      ('Kunle', 'Kunle'), ('Abimbola A.', 'Abimbola A.'), ('  Ray  ', 'Ray'),
      -- fix pass: the username (profiles.username is i4579_a5_handle) and the email handle, any case
      ('i4579_a5_handle', 'Mingla Team'), ('I4579_A5_HANDLE', 'Mingla Team'), ('  i4579_A5_handle ', 'Mingla Team'),
      ('I4579-A5', 'Mingla Team')
    ) AS v(display_name, expected)
  LOOP
    UPDATE public.profiles SET display_name = r.display_name WHERE id = pg_temp.u('a5');
    PERFORM pg_temp.ok(public.issue_4579_admin_public_name(pg_temp.u('a5')) = r.expected,
      format('T-6 SC-14 public name of %L is %L', r.display_name, r.expected));
  END LOOP;
  PERFORM pg_temp.ok(public.issue_4579_admin_public_name(pg_temp.u('nobody')) = 'Mingla Team',
    'T-6 SC-14 an unknown user is Mingla Team');
END;
$t6a$;
SELECT pg_temp.backfill();
CREATE TEMP TABLE i4579_ids (k text PRIMARY KEY, id uuid);
GRANT ALL ON i4579_ids TO authenticated;
DO $t6b$
DECLARE v_conv uuid; v_guest uuid; v_m1 uuid := pg_temp.u('m1'); v_m2 uuid := pg_temp.u('m2'); v_m3 uuid := pg_temp.u('m3');
        v_gm uuid := pg_temp.u('gm1');
BEGIN
  SELECT id INTO v_conv FROM public.conversations WHERE linked_entity_type = 'brand' AND brand_id = pg_temp.u('b1');
  SELECT id INTO v_guest FROM public.conversations WHERE linked_entity_type = 'brand_guests' AND brand_id = pg_temp.u('b1');
  INSERT INTO i4579_ids VALUES ('conv', v_conv), ('guest', v_guest);
  PERFORM pg_temp.ok(v_conv IS NOT NULL, 'T-6 the brand group exists');
  INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, sender_display_name_snapshot, created_at)
  VALUES (v_m1, v_conv, pg_temp.u('a1'), 'hello from mingla', 'text', 'i4579_a1_handle', now() - interval '3 minutes');
  INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, sender_display_name_snapshot, sender_role_snapshot, created_at)
  VALUES (v_m2, v_conv, pg_temp.u('a2'), 'support reply', 'text', 'Sam', 'Mingla Support', now() - interval '2 minutes');
  INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, reply_to_id, sender_display_name_snapshot, created_at)
  VALUES (v_m3, v_conv, pg_temp.u('host'), 'reply', 'text', v_m1, 'Hana Host', now() - interval '1 minute');
  INSERT INTO public.brand_group_reads(conversation_id, user_id, last_read_at)
  VALUES (v_conv, pg_temp.u('a1'), now()) ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = now();
  IF v_guest IS NOT NULL THEN
    INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, sender_kind, sender_display_name_snapshot, sender_role_snapshot)
    VALUES (v_gm, v_guest, NULL, 'welcome', 'text', 'brand', 'I4579 One', 'brand');
    INSERT INTO public.brand_guest_post_authors(message_id, conversation_id, author_id) VALUES (v_gm, v_guest, pg_temp.u('a1'));
  END IF;
END;
$t6b$;
DO $t6c$
DECLARE v jsonb; v_conv uuid := (SELECT id FROM i4579_ids WHERE k = 'conv'); v_guest uuid := (SELECT id FROM i4579_ids WHERE k = 'guest');
BEGIN
  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_4173_list_brand_group_members(%L) r', v_conv));
  PERFORM pg_temp.ok((SELECT e->>'display_name' = 'Kunle' AND e->'email' = 'null'::jsonb AND (e->>'is_mingla_team')::boolean
                       FROM jsonb_array_elements(v) e WHERE e->>'user_id' = pg_temp.u('a1')::text),
    'T-6 SC-9 roster: the auto-admin shows the public name, no email, flag true');
  PERFORM pg_temp.ok((SELECT e->>'display_name' = 'Mingla Team' FROM jsonb_array_elements(v) e WHERE e->>'user_id' = pg_temp.u('a2')::text),
    'T-6 SC-9 roster: a handle-like profile name falls back to Mingla Team');
  PERFORM pg_temp.ok((SELECT e->>'email' = 'i4579-host@example.test' AND NOT (e->>'is_mingla_team')::boolean
                       FROM jsonb_array_elements(v) e WHERE e->>'user_id' = pg_temp.u('host')::text)
    AND (SELECT NOT (e->>'is_mingla_team')::boolean AND e->>'email' = 'i4579-a3@example.test'
           FROM jsonb_array_elements(v) e WHERE e->>'user_id' = pg_temp.u('a3')::text),
    'T-6 SC-15 invited members (a host and an invited Mingla admin) are unchanged, flag false');
  PERFORM pg_temp.ok(position('i4579-a1@' IN v::text) = 0 AND position('i4579_a1_handle' IN v::text) = 0
    AND position('i4579-a2' IN v::text) = 0,
    'T-6 SC-9 roster never carries an auto-admin email or handle');

  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_3988_list_brand_group_mention_candidates(%L, %L, 20) r', v_conv, ''));
  PERFORM pg_temp.ok((SELECT e->>'display_name' = 'Kunle' AND e->'username' = 'null'::jsonb AND (e->>'is_mingla_team')::boolean
                       FROM jsonb_array_elements(v) e WHERE e->>'user_id' = pg_temp.u('a1')::text)
    AND position('i4579_a1_handle' IN v::text) = 0,
    'T-6 SC-9 mentions: auto-admin is mentionable by public name, no username');
  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_3988_list_brand_group_mention_candidates(%L, %L, 20) r', v_conv, 'a1_handle'));
  PERFORM pg_temp.ok(v IS NULL, 'T-6 mentions: searching the handle finds nothing');

  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_3720_list_brand_group_messages(%L, 80, NULL) r', v_conv));
  PERFORM pg_temp.ok((SELECT e->>'sender_display_name' = 'Kunle' AND (e->>'sender_is_mingla_team')::boolean
                       FROM jsonb_array_elements(v) e WHERE e->>'id' = pg_temp.u('m1')::text),
    'T-6 SC-9 messages: the public name replaces a handle snapshot, flag true');
  PERFORM pg_temp.ok((SELECT e->>'sender_display_name' = 'Sam' AND NOT (e->>'sender_is_mingla_team')::boolean
                       FROM jsonb_array_elements(v) e WHERE e->>'id' = pg_temp.u('m2')::text),
    'T-6 support replies keep their stored name');
  PERFORM pg_temp.ok((SELECT e->>'reply_sender_display_name' = 'Kunle' AND (e->>'reply_sender_is_mingla_team')::boolean
                         AND e->>'sender_display_name' = 'Hana Host' AND NOT (e->>'sender_is_mingla_team')::boolean
                       FROM jsonb_array_elements(v) e WHERE e->>'id' = pg_temp.u('m3')::text),
    'T-6 SC-9 reply preview uses the public name; the host is unchanged');
  PERFORM pg_temp.ok(position('i4579_a1_handle' IN v::text) = 0, 'T-6 messages never carry the handle');

  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_4304_list_brand_group_read_state(%L) r', v_conv));
  PERFORM pg_temp.ok((SELECT e->>'display_name' = 'Kunle' AND (e->>'is_mingla_team')::boolean
                       FROM jsonb_array_elements(v) e WHERE e->>'user_id' = pg_temp.u('a1')::text),
    'T-6 SC-9 read state: public name, flag true');

  v := pg_temp.json_as(pg_temp.u('a1'), 'SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_3720_list_brand_groups() r');
  PERFORM pg_temp.ok((SELECT e->>'last_message_sender_name' = 'Hana Host' AND NOT (e->>'last_message_sender_is_mingla_team')::boolean
                         AND (e->>'member_count')::int = (SELECT count(*) FROM public.brand_team_members m
                               WHERE m.brand_id = pg_temp.u('b1') AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)
                       FROM jsonb_array_elements(v) e WHERE e->>'brand_id' = pg_temp.u('b1')::text),
    'T-6 SC-9 group list: preview sender, and member_count counts each person');

  IF v_guest IS NOT NULL THEN
    v := pg_temp.json_as(pg_temp.u('host'), format('SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_4579_brand_guest_post_authors(%L, ARRAY[%L]::uuid[]) r', v_guest, pg_temp.u('gm1')));
    PERFORM pg_temp.ok((SELECT e->>'author_name' = 'Kunle' AND (e->>'is_mingla_team')::boolean FROM jsonb_array_elements(v) e),
      'T-6 SC-9 guest chat author: public name, flag true');
  END IF;
END;
$t6c$;
DO $t6push$
DECLARE v jsonb; v_conv uuid := (SELECT id FROM i4579_ids WHERE k = 'conv');
BEGIN
  -- The brand group push title is built from the outbox payload's sender_name.
  v := pg_temp.json_as(pg_temp.u('a1'), format(
    'SELECT to_jsonb(public.issue_3720_send_brand_group_message(%L, %L, NULL, ''{}''::uuid[], %L, ''{}''::uuid[]))',
    v_conv, 'from the Mingla side', 'brand'));
  PERFORM pg_temp.ok((SELECT sender_display_name_snapshot = 'Kunle' FROM public.messages WHERE id = (v #>> '{}')::uuid),
    'T-6 SC-9 a sent message stores the public name, not the handle');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.notification_outbox o
                              WHERE o.category_key = 'business.brand_group_message'
                                AND o.payload->>'message_id' = (v #>> '{}')
                                AND o.user_id = pg_temp.u('host')
                                AND o.payload->>'sender_name' = 'Kunle')
    AND NOT EXISTS (SELECT 1 FROM public.notification_outbox o
                     WHERE o.payload->>'message_id' = (v #>> '{}')
                       AND (o.payload::text LIKE '%i4579_a1_handle%' OR o.payload::text LIKE '%i4579-a1@%')),
    'T-6 SC-9 the push payload (title source) carries the public name, never the email or handle');
  v := pg_temp.json_as(pg_temp.u('host'), format(
    'SELECT to_jsonb(public.issue_3720_send_brand_group_message(%L, %L, NULL, ''{}''::uuid[], %L, ''{}''::uuid[]))',
    v_conv, 'from the host', 'brand'));
  PERFORM pg_temp.ok((SELECT sender_display_name_snapshot = 'Hana Host' FROM public.messages WHERE id = (v #>> '{}')::uuid),
    'T-6 SC-15 a host''s message keeps their own name');
END;
$t6push$;
DO $t6d$
DECLARE v jsonb; v_conv uuid := (SELECT id FROM i4579_ids WHERE k = 'conv');
BEGIN
  -- After Mingla Team is removed, old messages keep the rule.
  PERFORM pg_temp.json_as(pg_temp.u('owner'), format('SELECT public.issue_4579_remove_mingla_team(%L)', pg_temp.u('b1')));
  v := pg_temp.json_as(pg_temp.u('host'), format('SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_3720_list_brand_group_messages(%L, 80, NULL) r', v_conv));
  PERFORM pg_temp.ok((SELECT e->>'sender_display_name' = 'Kunle' FROM jsonb_array_elements(v) e WHERE e->>'id' = pg_temp.u('m1')::text),
    'T-6 old messages keep the public name after removal');
END;
$t6d$;
ROLLBACK;

-- ═══ T-7 parity ════════════════════════════════════════════════════════════════
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
DO $t7$
DECLARE v_err text;
BEGIN
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.conversation_participants cp JOIN public.conversations c ON c.id = cp.conversation_id
                              WHERE c.linked_entity_type = 'brand' AND c.brand_id = pg_temp.u('b1') AND cp.user_id = pg_temp.u('a1')),
    'T-7 SC-8 an auto-admin is a brand group participant');
  PERFORM pg_temp.ok(pg_temp.u('a1') IN (
      SELECT m.user_id FROM public.brand_team_members m
       WHERE m.brand_id = pg_temp.u('b1') AND m.role IN ('brand_owner', 'brand_admin', 'finance_manager', 'event_manager')
         AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL),
    'T-7 SC-8 brand-role recipient query (venue order / escalation roles) includes the auto-admin');
  PERFORM pg_temp.ok(public.biz_brand_effective_rank(pg_temp.u('b1'), pg_temp.u('a1')) = 50,
    'T-7 the auto-admin is a full Brand admin (rank 50)');
  PERFORM pg_temp.ok(NOT public.biz_can_mutate_payouts_for_brand(pg_temp.u('b1'), pg_temp.u('a1'))
    AND public.biz_can_mutate_payouts_for_brand(pg_temp.u('b1'), pg_temp.u('owner')),
    'T-7 SC-11 payouts and bank details stay owner-only');
  DELETE FROM public.brand_terms_acceptances WHERE brand_id = pg_temp.u('b1');
  UPDATE public.brand_team_members SET mingla_tos_accepted_at = now(), mingla_tos_version_accepted = '1.0'
   WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('a1') AND removed_at IS NULL;
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_terms_acceptances WHERE brand_id = pg_temp.u('b1')),
    'T-7 SC-10 an auto-admin''s terms acceptance counts for the brand');
  PERFORM pg_temp.ok(pg_temp.auto_active('b1','a1'), 'T-7 accepting terms keeps the row automatic');
END;
$t7$;
ROLLBACK;

-- ═══ T-8 catalog ═══════════════════════════════════════════════════════════════
DO $t8$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
      'public.biz_brand_team_members(uuid)',
      'public.issue_4173_list_brand_group_members(uuid)',
      'public.issue_3988_list_brand_group_mention_candidates(uuid,text,integer)',
      'public.issue_3720_list_brand_group_messages(uuid,integer,timestamp with time zone)',
      'public.issue_4304_list_brand_group_read_state(uuid)',
      'public.issue_3720_list_brand_groups()',
      'public.issue_3988_list_brand_group_media(uuid,text,timestamp with time zone,uuid,integer)',
      'public.issue_3720_list_team_mentions(integer,timestamp with time zone)',
      'public.biz_brand_form_door_reads(uuid,integer,timestamp with time zone)',
      'public.issue_4579_brand_guest_post_authors(uuid,uuid[])',
      'public.issue_3720_send_brand_group_message(uuid,text,uuid,uuid[],text,uuid[])'
    ]) AS sig
  LOOP
    PERFORM pg_temp.ok((SELECT prosrc ~ 'issue_4579_|mingla_admin' FROM pg_proc WHERE oid = r.sig::regprocedure),
      'T-8 reader applies the #4579 rule: ' || r.sig);
  END LOOP;
  FOR r IN SELECT unnest(ARRAY[
      'public.issue_4579_grant_admin(uuid)', 'public.issue_4579_revoke_admin(uuid)',
      'public.issue_4579_grant_brand(uuid)', 'public.issue_4579_apply_mingla_team_removal(uuid,uuid)'
    ]) AS sig
  LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', r.sig, 'EXECUTE')
      AND NOT has_function_privilege('anon', r.sig, 'EXECUTE'),
      'T-8 clients cannot call ' || r.sig);
  END LOOP;
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'public.issue_4579_remove_mingla_team(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.issue_4579_restore_mingla_team(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.issue_4579_mingla_team_state(uuid)', 'EXECUTE'),
    'T-8 hosts can call remove, restore and state');
  -- SC-12, two layers: clients hold no column privilege on the three columns,
  -- and the source guard refuses a change from a client role regardless.
  PERFORM pg_temp.ok(NOT has_column_privilege('authenticated', 'public.brand_team_members', 'granted_via', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.brand_team_members', 'granted_admin_user_id', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.brand_team_members', 'removal_reason', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.brand_team_members', 'granted_via', 'INSERT'),
    'T-8 SC-12 clients have no write privilege on granted_via, granted_admin_user_id, removal_reason');
  PERFORM pg_temp.ok((SELECT prosrc LIKE '%current_user IN (''authenticated'', ''anon'')%'
                         AND prosrc LIKE '%ERRCODE = ''42501''%'
                        FROM pg_proc WHERE oid = 'public.issue_4579_tg_member_source()'::regprocedure)
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'issue_4579_member_source'
                 AND tgrelid = 'public.brand_team_members'::regclass AND tgenabled = 'O'),
    'T-8 SC-12 the source guard trigger refuses client changes (42501)');
  PERFORM pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brand_mingla_team_optouts'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brand_mingla_admin_optouts'::regclass),
    'T-8 both opt-out tables have RLS on');
END;
$t8$;

-- ═══ T-9 payout settings are owner-only (fix pass) ═══════════════════════════════
-- Every payout or payment-routing field on the brand row, by a direct table update
-- or an RPC, needs the owner. An invited Brand admin and an auto-added Mingla admin
-- (who is also a Mingla console admin) are refused; service-role and no-user server
-- paths are unchanged.
-- FAILS-ON-REVERT: dropping trigger zz_issue_4579_payout_settings_owner_only fails
-- every "refused" line below.
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
DO $t9$
DECLARE r record; v_err text; v_who text;
BEGIN
  PERFORM pg_temp.ok(pg_temp.auto_active('b1', 'a1'), 'T-9 a1 is an auto-added Brand admin on b1');
  FOR r IN SELECT * FROM (VALUES
      ('paystack_subaccount_code = ''ACCT_t4579x'''),
      ('stripe_connect_id = ''acct_t4579x'''),
      ('stripe_payouts_enabled = true'),
      ('stripe_charges_enabled = true'),
      ('payment_provider = ''paystack'''),
      ('payment_country = ''NG'''),
      ('payout_country = ''NG'''),
      ('payout_hold_cutover_at = now()'),
      ('payments_setup_started_at = now()')
    ) AS v(set_clause)
  LOOP
    FOR v_who IN SELECT unnest(ARRAY['host', 'a1']) LOOP
      PERFORM pg_temp.ok(pg_temp.try_api(pg_temp.u(v_who), format(
          'UPDATE public.brands SET %s WHERE id = %L', r.set_clause, pg_temp.u('b1'))) LIKE '42501:payout_settings_owner_only%',
        format('T-9 %s is refused: SET %s', v_who, r.set_clause));
    END LOOP;
  END LOOP;
  PERFORM pg_temp.ok((SELECT paystack_subaccount_code IS NULL AND stripe_connect_id IS NULL AND payout_country IS NULL
                        FROM public.brands WHERE id = pg_temp.u('b1')),
    'T-9 nothing a Brand admin tried was written');
  -- The RPC path is refused too (it allowed Brand admins before).
  PERFORM pg_temp.ok(pg_temp.try_api(pg_temp.u('host'), format(
      'SELECT public.biz_set_brand_payout_country(%L, ''NG'')', pg_temp.u('b1'))) LIKE '42501:%',
    'T-9 a Brand admin cannot set the payout country through the RPC');
  PERFORM pg_temp.ok(pg_temp.try_api(pg_temp.u('a1'), format(
      'SELECT public.biz_set_brand_payout_country(%L, ''GB'')', pg_temp.u('b1'))) LIKE '42501:%',
    'T-9 an auto-added Mingla admin cannot set the payout country through the RPC');
  -- Everything else a Brand admin edits still saves.
  v_err := pg_temp.try_api(pg_temp.u('host'), format(
      'UPDATE public.brands SET description = ''new words'' WHERE id = %L', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v_err = ''
    AND (SELECT description FROM public.brands WHERE id = pg_temp.u('b1')) = 'new words',
    'T-9 a Brand admin still edits the brand profile');
  -- The owner: the RPC and a direct update both work.
  v_err := pg_temp.try_api(pg_temp.u('owner'), format(
      'SELECT public.biz_set_brand_payout_country(%L, ''GB'')', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v_err = ''
    AND (SELECT payout_country FROM public.brands WHERE id = pg_temp.u('b1')) = 'GB',
    'T-9 the owner sets the payout country');
  v_err := pg_temp.try_api(pg_temp.u('owner'), format(
      'UPDATE public.brands SET stripe_connect_id = ''acct_owner'' WHERE id = %L', pg_temp.u('b1')));
  PERFORM pg_temp.ok(v_err = ''
    AND (SELECT stripe_connect_id FROM public.brands WHERE id = pg_temp.u('b1')) = 'acct_owner',
    'T-9 the owner changes a payout field directly');
  -- Server paths: the service role (onboarding edge functions, webhooks) and no-user sessions.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticator';
  EXECUTE 'SET LOCAL ROLE service_role';
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_server', payment_provider = 'paystack'
   WHERE id = pg_temp.u('b2');
  EXECUTE 'RESET ROLE';
  EXECUTE 'RESET SESSION AUTHORIZATION';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp.ok((SELECT paystack_subaccount_code FROM public.brands WHERE id = pg_temp.u('b2')) = 'ACCT_server',
    'T-9 the service role (Stripe and Paystack onboarding) still writes payout fields');
  -- A direct database session that still carries a signed-in user's claims
  -- (an operator or a fixture) is a server path too.
  PERFORM pg_temp.as_user(pg_temp.u('host'));
  UPDATE public.brands SET stripe_payouts_enabled = true WHERE id = pg_temp.u('b2');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.ok((SELECT stripe_payouts_enabled FROM public.brands WHERE id = pg_temp.u('b2')),
    'T-9 a no-user server session (cron, migration) still writes payout fields');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_issue_4579_payout_settings_owner_only'
                              AND tgrelid = 'public.brands'::regclass AND tgenabled = 'O'),
    'T-9 the owner-only trigger is installed and enabled');
END;
$t9$;
ROLLBACK;

-- ═══ T-10 Host Community: a Mingla admin's post shows Mingla Team (fix pass) ═════
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
INSERT INTO public.community_posts(id, author_user_id, kind, title, body, review_state) VALUES
  (pg_temp.u('p_admin'), pg_temp.u('a2'), 'question', 'From Mingla', 'hello', 'published'),
  (pg_temp.u('p_host'), pg_temp.u('host'), 'question', 'From a host', 'hi there', 'published');
DO $t10$
DECLARE v jsonb;
BEGIN
  v := pg_temp.json_as(pg_temp.u('owner'), 'SELECT jsonb_agg(to_jsonb(r)) FROM public.issue_3720_community_feed_v2(NULL) r');
  PERFORM pg_temp.ok((SELECT e->>'brand_label' = 'Mingla Team' AND e->>'author_label' = 'Mingla Team'
                        FROM jsonb_array_elements(v) e WHERE e->>'id' = pg_temp.u('p_admin')::text),
    'T-10 a Mingla admin''s post: brand Mingla Team, public name (a handle-like name falls back), never a host brand');
  PERFORM pg_temp.ok((SELECT e->>'brand_label' = 'I4579 One' AND e->>'author_label' = 'Hana Host'
                        FROM jsonb_array_elements(v) e WHERE e->>'id' = pg_temp.u('p_host')::text),
    'T-10 a host''s post keeps their own brand and name');
  PERFORM pg_temp.ok(position('i4579-a2' IN v::text) = 0 AND position('i4579_a2' IN v::text) = 0,
    'T-10 the feed never carries the admin''s email, handle or username');
END;
$t10$;
ROLLBACK;

-- ═══ T-11 the payouts history is written only by the service role (fix pass) ════
-- FAILS-ON-REVERT: restoring the FOR ALL "Brand admin plus can manage payouts"
-- policy (and the client write grants) fails the "refused" lines.
BEGIN;
SELECT pg_temp.fixture();
SELECT pg_temp.backfill();
INSERT INTO public.payouts(id, brand_id, stripe_payout_id, amount_cents, currency, status)
VALUES (pg_temp.u('po1'), pg_temp.u('b1'), 'po_t4579', 1000, 'GBP', 'pending');
DO $t11$
DECLARE v_who text; v_err text; v_n text;
BEGIN
  FOREACH v_who IN ARRAY ARRAY['host', 'a1', 'owner'] LOOP
    PERFORM pg_temp.ok(pg_temp.try_api(pg_temp.u(v_who), format(
        'INSERT INTO public.payouts(brand_id, stripe_payout_id, amount_cents, currency, status) VALUES (%L, ''po_forged'', 5000, ''GBP'', ''paid'')',
        pg_temp.u('b1'))) LIKE '42501:%',
      format('T-11 %s cannot insert a payout row', v_who));
    PERFORM pg_temp.ok(pg_temp.try_api(pg_temp.u(v_who), format(
        'UPDATE public.payouts SET status = ''paid'', amount_cents = 1 WHERE id = %L', pg_temp.u('po1'))) LIKE '42501:%',
      format('T-11 %s cannot change a payout row', v_who));
    PERFORM pg_temp.ok(pg_temp.try_api(pg_temp.u(v_who), format(
        'DELETE FROM public.payouts WHERE id = %L', pg_temp.u('po1'))) LIKE '42501:%',
      format('T-11 %s cannot delete a payout row', v_who));
  END LOOP;
  PERFORM pg_temp.ok((SELECT status = 'pending' AND amount_cents = 1000 FROM public.payouts WHERE id = pg_temp.u('po1'))
    AND NOT EXISTS (SELECT 1 FROM public.payouts WHERE stripe_payout_id = 'po_forged'),
    'T-11 the payout row is untouched and nothing was forged');
  -- The team still reads it.
  v_n := (pg_temp.json_as(pg_temp.u('host'), format('SELECT to_jsonb(count(*)) FROM public.payouts WHERE id = %L', pg_temp.u('po1'))))::text;
  PERFORM pg_temp.ok(v_n = '1', 'T-11 a Brand admin still reads the payouts history');
  -- The service role (the webhook) still writes.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticator';
  EXECUTE 'SET LOCAL ROLE service_role';
  UPDATE public.payouts SET status = 'paid' WHERE id = pg_temp.u('po1');
  EXECUTE 'RESET ROLE';
  EXECUTE 'RESET SESSION AUTHORIZATION';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp.ok((SELECT status FROM public.payouts WHERE id = pg_temp.u('po1')) = 'paid',
    'T-11 the service role (webhook) still writes payouts');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.payouts', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.payouts', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.payouts', 'DELETE')
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payouts'
                     AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE') AND 'authenticated' = ANY (roles)),
    'T-11 clients hold no write grant or write policy on payouts');
END;
$t11$;
ROLLBACK;
