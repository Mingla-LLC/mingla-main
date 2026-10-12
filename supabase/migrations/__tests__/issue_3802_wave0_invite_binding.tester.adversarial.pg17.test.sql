-- Issue #3802 (Wave 0) — INDEPENDENT TESTER suite for one-time team
-- invitations (PostgreSQL 17).
--
-- Written by the tester, not the implementor. The implementor suite walks the
-- product path (invite, open, activate) one request at a time. This suite asks
-- a different set of questions, aimed at the guarantees rather than the flow:
--
--   AX-1  The secret never leaves the database. No function a client can call,
--         and no row a client can reach, carries the stored hash; the owner's
--         own invitation read returns no hash column; the table refuses every
--         one of the eight privileges to anon and authenticated.
--   AX-2  The binding is to one account. With the invitation opened for account
--         U, clearing or re-pointing redeemed_user_id (done as postgres) stops
--         activation; only the exact account bound to the row activates.
--   AX-3  Peek/redeem state precedence at the boundaries: redeemed-and-expired
--         answers 'used' (redeemed is checked first); expired-not-redeemed
--         answers 'expired'; a row exactly at now() for expiry is expired.
--   AX-4  The client can never redeem. Peek and redeem are refused to every
--         signed-in and anonymous caller, so single use cannot be bypassed from
--         outside the service role.
--   AX-5  Only the owner issues or lists. growth, partner, admin, an ordinary
--         account and anon are all refused, and nothing is written.
--   AX-6  already_active is fully transactional: the refusal leaves the person's
--         membership, their accepted_at and the audit log byte-for-byte as they
--         were, and creates no invitation row.
--   AX-7  Role binding across tables: an admin invitation only ever flips
--         admin_users; a growth/partner invitation only ever flips the team
--         table; a role rewritten underneath an opened invitation blocks it.
--   AX-8  One address per table however spelled, proven against the postgres
--         superuser for BOTH membership tables.
--   AX-9  The hash format is enforced: issue_invite refuses a non-hex token and
--         a direct non-hex insert violates the table CHECK.
--
-- All parts are transaction-contained and rolled back. Never run on production.
--
-- Runs as the image's admin role, like the implementor suites: the bare CI
-- image ships an auth.users without email_confirmed_at, and only the owning
-- side can add it. The column is added inside the rolled-back transaction.
--
-- "Opening the link" is simulated by calling admin_team_redeem_invite as the
-- service role, exactly as the accept edge function does.
--
-- Checks are RECORDED and reported together; the suite fails if any check fails
-- OR if fewer than the expected number of checks ran.

\set ON_ERROR_STOP on

begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t3802t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802t_people (who, id, email) values
  ('owner',    '38027000-0000-4000-b000-000000000001', 'issue3802t-owner@test.local'),
  ('admin',    '38027000-0000-4000-b000-000000000002', 'issue3802t-admin@test.local'),
  ('consumer', '38027000-0000-4000-b000-000000000003', 'issue3802t-consumer@test.local'),
  ('g',        '38027000-0000-4000-b000-000000000004', 'issue3802t-g@test.local'),
  ('p',        '38027000-0000-4000-b000-000000000005', 'issue3802t-p@test.local'),
  ('a',        '38027000-0000-4000-b000-000000000006', 'issue3802t-a@test.local'),
  ('bindu',    '38027000-0000-4000-b000-000000000007', 'issue3802t-bind@test.local'),
  ('bindv',    '38027000-0000-4000-b000-000000000008', 'Issue3802T-Bind@Test.Local'),
  ('secret',   '38027000-0000-4000-b000-000000000009', 'issue3802t-secret@test.local'),
  ('prec',     '38027000-0000-4000-b000-00000000000a', 'issue3802t-prec@test.local'),
  ('role',     '38027000-0000-4000-b000-00000000000b', 'issue3802t-role@test.local'),
  ('act',      '38027000-0000-4000-b000-00000000000c', 'issue3802t-act@test.local');

insert into auth.users (id, email, email_confirmed_at)
select id, email, now() from t3802t_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802t-owner@test.local', 'owner', 'active', now());

create temp table t3802t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- Run one statement as a named caller; return its single text result, or
-- 'ERR:<sqlstate>:<message>'. A raised statement leaves nothing behind.
create function pg_temp.t3802t_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'postgres', 'service') then
    select id, email into strict v_id, v_email from t3802t_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    elsif p_who = 'postgres' then
      set local role postgres;
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.t3802t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(p_got, '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3802t_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3802t_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(p_got, '<null>'), p_pattern));
end;
$fn$;

-- The stored form of a made-up link secret.
create function pg_temp.t3802t_h(p text) returns text
language sql immutable as $fn$
  select encode(sha256(convert_to('issue3802t:' || p, 'UTF8')), 'hex')
$fn$;

create function pg_temp.t3802t_issue(p_who text, p_role text, p_secret text) returns text
language sql as $fn$
  select pg_temp.t3802t_as('owner', format(
    $q$select public.admin_team_issue_invite(%L, %L, %L)::text$q$,
    'issue3802t-' || p_who || '@test.local', p_role, pg_temp.t3802t_h(p_secret)))
$fn$;

create function pg_temp.t3802t_open(p_secret text, p_who text) returns text
language sql as $fn$
  select pg_temp.t3802t_as('service', format(
    $q$select public.admin_team_redeem_invite(%L, %L)->>'state'$q$,
    pg_temp.t3802t_h(p_secret), (select id from t3802t_people where who = p_who)))
$fn$;

create function pg_temp.t3802t_team() returns text
language sql as $fn$
  select coalesce((select jsonb_agg(to_jsonb(a) order by a.email) from public.admin_users a), '[]'::jsonb)::text
      || coalesce((select jsonb_agg(to_jsonb(m) order by m.email) from public.admin_team_members m), '[]'::jsonb)::text
$fn$;

create function pg_temp.t3802t_audit() returns int
language sql as $fn$
  select count(*)::int from public.admin_audit_log where target_type = 'team_member'
$fn$;

-- ===========================================================================
-- AX-1 — the secret never leaves the database.
-- ===========================================================================
do $ax1$
declare r text; v text;
begin
  perform pg_temp.t3802t_issue('g', 'growth', 'g-secret-1');
  perform pg_temp.t3802t_issue('secret', 'admin', 'sec-1');

  -- No client-callable function hands any caller the hash.
  perform pg_temp.t3802t_check('AX-1', 'issue result (to owner) carries no secret or hash',
    (pg_temp.t3802t_issue('p', 'partner', 'p-secret-1')::jsonb
       ?| array['token','token_hash','hash','secret','link'])::text, 'false');

  -- The owner's invitation read exposes no hash column at all.
  perform pg_temp.t3802t_check('AX-1', 'invite_states columns are email/state/expires/issued only',
    pg_temp.t3802t_as('owner', $q$select string_agg(key, ',' order by key)
       from (select jsonb_object_keys(to_jsonb(s)) as key
             from (select * from public.admin_team_invite_states() limit 1) s) k$q$),
    'email,expires_at,issued_at,state');

  perform pg_temp.t3802t_check('AX-1', 'invite_states text never contains a 64-hex run',
    (pg_temp.t3802t_as('owner', $q$select coalesce(string_agg(to_jsonb(s)::text, '|'), '')
       from public.admin_team_invite_states() s$q$) ~ '[0-9a-f]{64}')::text, 'false');

  -- my_access and list, the two things a signed-in member reads, never carry it.
  perform pg_temp.t3802t_check('AX-1', 'owner my_access carries no hash',
    (pg_temp.t3802t_as('owner', $q$select public.admin_team_my_access()::text$q$) ~ '[0-9a-f]{64}')::text, 'false');
  perform pg_temp.t3802t_check('AX-1', 'owner team list carries no hash',
    (coalesce(pg_temp.t3802t_as('owner', $q$select jsonb_agg(to_jsonb(l))::text from public.admin_team_list() l$q$), '') ~ '[0-9a-f]{64}')::text, 'false');

  -- The table itself is closed to both client roles for every privilege.
  foreach v in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    perform pg_temp.t3802t_check('AX-1', 'anon lacks '||v||' on admin_team_invites',
      has_table_privilege('anon', 'public.admin_team_invites', v)::text, 'false');
    perform pg_temp.t3802t_check('AX-1', 'authenticated lacks '||v||' on admin_team_invites',
      has_table_privilege('authenticated', 'public.admin_team_invites', v)::text, 'false');
  end loop;

  -- A signed-in member who tries to read the table directly is refused.
  perform pg_temp.t3802t_like('AX-1', 'authenticated direct select is denied',
    pg_temp.t3802t_as('g', $q$select count(*)::text from public.admin_team_invites$q$), 'ERR:42501:%');
end;
$ax1$;

-- ===========================================================================
-- AX-2 — the binding is to one account.
-- ===========================================================================
do $ax2$
declare v_team text; v_bind uuid;
begin
  perform pg_temp.t3802t_issue('bind', 'admin', 'bind-1');
  -- open for the exact account 'bindu'
  perform pg_temp.t3802t_check('AX-2', 'open binds to the account that redeemed',
    pg_temp.t3802t_open('bind-1', 'bindu'), 'redeemed');
  select redeemed_user_id into v_bind from public.admin_team_invites where email = 'issue3802t-bind@test.local';
  perform pg_temp.t3802t_check('AX-2', 'redeemed_user_id is the opener',
    (v_bind = (select id from t3802t_people where who = 'bindu'))::text, 'true');

  -- a second account with the SAME normalised address (different spelling) cannot activate
  perform pg_temp.t3802t_check('AX-2', 'the case-variant account cannot activate',
    pg_temp.t3802t_as('bindv', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802t_check('AX-2', 'legacy path, case-variant account, returns without error',
    pg_temp.t3802t_as('bindv', $q$select coalesce(nullif(public.activate_invited_admin()::text, ''), 'void')$q$), 'void');
  perform pg_temp.t3802t_check('AX-2', 'still invited in admin_users',
    (select status from public.admin_users where email = 'issue3802t-bind@test.local'), 'invited');

  -- break the binding as postgres: null it, then even the real opener cannot activate
  update public.admin_team_invites set redeemed_user_id = null, redeemed_at = null
    where email = 'issue3802t-bind@test.local';
  perform pg_temp.t3802t_check('AX-2', 'with the binding cleared, the opener cannot activate',
    pg_temp.t3802t_as('bindu', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802t_check('AX-2', 'admin_users still invited after cleared binding',
    (select status from public.admin_users where email = 'issue3802t-bind@test.local'), 'invited');
end;
$ax2$;

-- ===========================================================================
-- AX-3 — state precedence at the boundaries.
-- ===========================================================================
do $ax3$
begin
  -- redeemed AND expired -> 'used' (redeemed is checked first)
  perform pg_temp.t3802t_issue('prec', 'growth', 'prec-1');
  perform pg_temp.t3802t_open('prec-1', 'prec');
  update public.admin_team_invites set expires_at = now() - interval '1 day'
    where email = 'issue3802t-prec@test.local';
  perform pg_temp.t3802t_check('AX-3', 'redeemed-and-expired peeks as used',
    pg_temp.t3802t_as('service', format($q$select public.admin_team_invite_peek(%L)->>'state'$q$, pg_temp.t3802t_h('prec-1'))), 'used');
  perform pg_temp.t3802t_check('AX-3', 'redeem of a used link answers used',
    pg_temp.t3802t_open('prec-1', 'prec'), 'used');

  -- expired, not redeemed -> 'expired'; and a row exactly at now() is expired
  perform pg_temp.t3802t_as('owner', $q$select public.admin_team_set_member('issue3802t-prec@test.local','growth','revoked')$q$);
  perform pg_temp.t3802t_issue('prec', 'growth', 'prec-2');
  update public.admin_team_invites set expires_at = now()
    where email = 'issue3802t-prec@test.local';
  perform pg_temp.t3802t_check('AX-3', 'a link whose expiry is exactly now is expired',
    pg_temp.t3802t_open('prec-2', 'prec'), 'expired');
  perform pg_temp.t3802t_check('AX-3', 'peek agrees it is expired',
    pg_temp.t3802t_as('service', format($q$select public.admin_team_invite_peek(%L)->>'state'$q$, pg_temp.t3802t_h('prec-2'))), 'expired');
end;
$ax3$;

-- ===========================================================================
-- AX-4 — the client can never peek or redeem.
-- ===========================================================================
do $ax4$
declare w text;
begin
  perform pg_temp.t3802t_issue('a', 'admin', 'a-1');
  foreach w in array array['owner','admin','g','p','consumer'] loop
    perform pg_temp.t3802t_like('AX-4', w||' cannot peek',
      pg_temp.t3802t_as(w, format($q$select public.admin_team_invite_peek(%L)::text$q$, pg_temp.t3802t_h('a-1'))), 'ERR:42501:%');
    perform pg_temp.t3802t_like('AX-4', w||' cannot redeem',
      pg_temp.t3802t_as(w, format($q$select public.admin_team_redeem_invite(%L, %L)::text$q$,
        pg_temp.t3802t_h('a-1'), (select id from t3802t_people where who = 'a'))), 'ERR:42501:%');
  end loop;
  perform pg_temp.t3802t_like('AX-4', 'anon cannot peek',
    pg_temp.t3802t_as('anon', format($q$select public.admin_team_invite_peek(%L)::text$q$, pg_temp.t3802t_h('a-1'))), 'ERR:42501:%');
  perform pg_temp.t3802t_like('AX-4', 'anon cannot redeem',
    pg_temp.t3802t_as('anon', format($q$select public.admin_team_redeem_invite(%L, %L)::text$q$,
      pg_temp.t3802t_h('a-1'), (select id from t3802t_people where who = 'a'))), 'ERR:42501:%');
  -- it is still openable by the service role, so the gate did not simply break it
  perform pg_temp.t3802t_check('AX-4', 'the service role still opens it', pg_temp.t3802t_open('a-1','a'), 'redeemed');
end;
$ax4$;

-- ===========================================================================
-- AX-5 — only the owner issues or lists.
-- ===========================================================================
do $ax5$
declare w text; v_before text; v_audit int;
begin
  v_before := pg_temp.t3802t_team();
  v_audit  := pg_temp.t3802t_audit();
  foreach w in array array['admin','g','p','consumer'] loop
    perform pg_temp.t3802t_like('AX-5', w||' cannot issue an invite',
      pg_temp.t3802t_as(w, format($q$select public.admin_team_issue_invite(%L,'growth',%L)::text$q$,
        'issue3802t-newbie@test.local', pg_temp.t3802t_h('x'))), 'ERR:42501:forbidden%');
    perform pg_temp.t3802t_like('AX-5', w||' cannot list invite states',
      pg_temp.t3802t_as(w, $q$select count(*)::text from public.admin_team_invite_states()$q$), 'ERR:42501:forbidden%');
  end loop;
  perform pg_temp.t3802t_like('AX-5', 'anon cannot issue an invite',
    pg_temp.t3802t_as('anon', format($q$select public.admin_team_issue_invite(%L,'growth',%L)::text$q$,
      'issue3802t-newbie@test.local', pg_temp.t3802t_h('x'))), 'ERR:%');
  perform pg_temp.t3802t_check('AX-5', 'no membership changed by the refused calls',
    (pg_temp.t3802t_team() = v_before)::text, 'true');
  perform pg_temp.t3802t_check('AX-5', 'no audit row from the refused calls',
    pg_temp.t3802t_audit()::text, v_audit::text);
  perform pg_temp.t3802t_check('AX-5', 'no stray newbie invitation exists',
    (select count(*)::text from public.admin_team_invites where email = 'issue3802t-newbie@test.local'), '0');
end;
$ax5$;

-- ===========================================================================
-- AX-6 — already_active is fully transactional.
-- ===========================================================================
do $ax6$
declare v_team text; v_audit int; v_invites text; v_acc timestamptz;
begin
  -- make 'act' a genuinely active admin: invite, open, activate as themselves
  perform pg_temp.t3802t_issue('act', 'admin', 'act-1');
  perform pg_temp.t3802t_open('act-1', 'act');
  perform pg_temp.t3802t_as('act', $q$select public.admin_team_activate_self()$q$);
  perform pg_temp.t3802t_check('AX-6', 'the person is active', (select status from public.admin_users where email='issue3802t-act@test.local'), 'active');

  select accepted_at into v_acc from public.admin_users where email = 'issue3802t-act@test.local';
  v_team := pg_temp.t3802t_team();
  v_audit := pg_temp.t3802t_audit();
  v_invites := coalesce((select jsonb_agg(to_jsonb(i) order by i.email)::text from public.admin_team_invites i), '[]');

  perform pg_temp.t3802t_check('AX-6', 'inviting the active person is refused with already_active',
    pg_temp.t3802t_issue('act', 'growth', 'act-2'), 'ERR:23505:already_active');
  perform pg_temp.t3802t_check('AX-6', 'the membership is byte-for-byte unchanged', (pg_temp.t3802t_team() = v_team)::text, 'true');
  perform pg_temp.t3802t_check('AX-6', 'accepted_at is unchanged',
    ((select accepted_at from public.admin_users where email='issue3802t-act@test.local') = v_acc)::text, 'true');
  perform pg_temp.t3802t_check('AX-6', 'the audit log is unchanged', pg_temp.t3802t_audit()::text, v_audit::text);
  perform pg_temp.t3802t_check('AX-6', 'no invitation row was created by the refused invite',
    (coalesce((select jsonb_agg(to_jsonb(i) order by i.email)::text from public.admin_team_invites i), '[]') = v_invites)::text, 'true');
end;
$ax6$;

-- ===========================================================================
-- AX-7 — role binding across the two tables.
-- ===========================================================================
do $ax7$
begin
  -- an admin invitation only flips admin_users
  perform pg_temp.t3802t_issue('role', 'admin', 'role-1');
  perform pg_temp.t3802t_open('role-1', 'role');
  perform pg_temp.t3802t_as('role', $q$select public.admin_team_activate_self()$q$);
  perform pg_temp.t3802t_check('AX-7', 'admin invitation activated in admin_users',
    (select status from public.admin_users where email = 'issue3802t-role@test.local'), 'active');
  perform pg_temp.t3802t_check('AX-7', 'nothing landed in the team table',
    (select count(*)::text from public.admin_team_members where email = 'issue3802t-role@test.local'), '0');

  -- reset, invite as growth, rewrite the row's role under the opened invite
  perform pg_temp.t3802t_as('owner', $q$select public.admin_team_set_member('issue3802t-role@test.local','growth','revoked')$q$);
  perform pg_temp.t3802t_issue('role', 'growth', 'role-2');
  perform pg_temp.t3802t_open('role-2', 'role');
  update public.admin_team_members set role = 'partner'
    where email = 'issue3802t-role@test.local' and status = 'invited';
  perform pg_temp.t3802t_check('AX-7', 'a role rewritten under the opened invite blocks activation',
    pg_temp.t3802t_as('role', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802t_check('AX-7', 'the membership stays invited',
    (select status from public.admin_team_members where email = 'issue3802t-role@test.local'), 'invited');
end;
$ax7$;

-- ===========================================================================
-- AX-8 — one address per table however spelled, for the postgres superuser.
-- ===========================================================================
do $ax8$
begin
  perform pg_temp.t3802t_check('AX-8', 'a case/padding variant in admin_users is refused for postgres',
    pg_temp.t3802t_as('postgres', $q$insert into public.admin_users(email,role,status)
      values (' Issue3802T-Owner@Test.Local ','admin','revoked') returning 'inserted'$q$),
    'ERR:23505:duplicate key value violates unique constraint "admin_users_email_normalised_key"');

  -- The team table's own CHECK blocks a non-normalised spelling before any
  -- index sees it, so the normalised index there is a defence-in-depth guard:
  -- assert it exists, is unique and is valid (it protects a future in which the
  -- CHECK is relaxed).
  perform pg_temp.t3802t_check('AX-8', 'the team-table normalised index is unique and valid',
    (select (x.indisunique and x.indisvalid)::text
       from pg_catalog.pg_index x
       join pg_catalog.pg_class c on c.oid = x.indexrelid
      where c.relname = 'admin_team_members_email_normalised_key'), 'true');
  -- A non-normalised direct insert is refused by that table's CHECK.
  perform pg_temp.t3802t_like('AX-8', 'a non-normalised team-table row is refused for postgres',
    pg_temp.t3802t_as('postgres', $q$insert into public.admin_team_members(email,role,status)
      values (' Issue3802T-Dup@Test.Local ','growth','revoked') returning 'inserted'$q$),
    'ERR:23514:%');
end;
$ax8$;

-- ===========================================================================
-- AX-9 — the hash format is enforced.
-- ===========================================================================
do $ax9$
begin
  perform pg_temp.t3802t_check('AX-9', 'issue_invite refuses a non-hex token',
    pg_temp.t3802t_as('owner', $q$select public.admin_team_issue_invite('issue3802t-badhash@test.local','growth','not-a-hash')::text$q$),
    'ERR:22023:invalid_token');
  perform pg_temp.t3802t_check('AX-9', 'issue_invite refuses a null token',
    pg_temp.t3802t_as('owner', $q$select public.admin_team_issue_invite('issue3802t-badhash@test.local','growth', null)::text$q$),
    'ERR:22023:invalid_token');
  perform pg_temp.t3802t_like('AX-9', 'a direct non-hex insert violates the table CHECK',
    pg_temp.t3802t_as('postgres', $q$insert into public.admin_team_invites(email,role,token_hash,expires_at,issued_by)
      values ('issue3802t-badhash@test.local','growth','ZZZ',now()+interval '1 day','x') returning 'inserted'$q$),
    'ERR:23514:%');
  perform pg_temp.t3802t_check('AX-9', 'no invitation exists for the rejected address',
    (select count(*)::text from public.admin_team_invites where email = 'issue3802t-badhash@test.local'), '0');
end;
$ax9$;

-- ===========================================================================
-- Verdict.
-- ===========================================================================
do $verdict$
declare v_total int; v_failed int; v_tests text; r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802t_results;
  if v_total < 70 then
    raise exception 'ISSUE-3802 TESTER INVITES FAIL: only % checks ran; the suite did not execute fully', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from t3802t_results where not ok order by seq limit 60 loop
      raise warning 'ISSUE-3802 TESTER INVITES FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    select string_agg(distinct test, ', ' order by test) into v_tests from t3802t_results where not ok;
    raise exception 'ISSUE-3802 TESTER INVITES FAIL: % of % checks failed in: %', v_failed, v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 TESTER INVITES PASS: % checks across AX-1..AX-9, 0 failed', v_total;
end;
$verdict$;

rollback;
