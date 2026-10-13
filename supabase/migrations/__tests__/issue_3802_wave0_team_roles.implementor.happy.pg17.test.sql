-- Issue #3802 (Wave 0) — implementor happy-path suite for team roles (PostgreSQL 17).
--
-- Proves, on the fully replayed schema:
--   T-1  each caller resolves to its own team role (or none)
--   T-2  admin_team_can('admin_console') equals is_admin_user() for every caller
--   T-3  admin_team_my_access() contract
--   T-4  the owner can invite, change roles both ways, remove and restore
--   T-5  the two new roles get exactly what an ordinary signed-in account gets
--        from existing admin tables and functions
--   T-6  role changes are owner-only: an admin cannot write team membership
--   T-7  neither can a growth, partner or ordinary account
--   T-8  nobody can mint an owner, change the owner, or change themselves
--   T-9  an invited person activates only their own invitation, idempotently
--   T-10 one email is live in at most one of the two membership tables
--   T-11 every successful team change writes exactly one audit row
--   T-12 privilege matrix
--   T-13 the set of functions that write team membership is pinned by name
--   T-14 reads through policies that look at admin_users still work
--   T-15 the previous self-activation function still works
--
-- Transaction-contained: everything is rolled back. Never run on production.
--
-- Runs as the image's admin role because the bare CI image ships an
-- auth.users without email_confirmed_at (the hosted auth service owns that
-- column) and only the table's owner side can add it. The column is added
-- inside this transaction and rolled back with it.
--
-- Checks are RECORDED, not raised one by one: the final block lists every
-- failed check at once, so a regression shows its whole footprint.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

-- Issue #3802 amendment 1: activation now needs the invitation to have been opened. This harness opens it the moment a row becomes invited, so the assertions below keep testing membership mechanics.
-- (The invitation mechanics themselves are proven by
-- issue_3802_wave0_invite_binding.implementor.happy.pg17.test.sql.)
create function pg_temp.t3802_open_invite() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_email text := lower(btrim(NEW.email));
  v_uid uuid;
begin
  if NEW.status = 'invited' then
    select u.id into v_uid from auth.users u where lower(btrim(u.email)) = v_email order by u.id limit 1;
    if v_uid is not null then
      insert into public.admin_team_invites as i
        (email, role, token_hash, issued_by, expires_at, redeemed_at, redeemed_user_id)
      values (v_email,
              case when TG_TABLE_NAME = 'admin_users' then 'admin' else NEW.role end,
              encode(sha256(convert_to('harness:' || v_email, 'UTF8')), 'hex'),
              'harness', now() + interval '7 days', now(), v_uid)
      on conflict (email) do update
         set role = excluded.role, token_hash = excluded.token_hash, issued_by = excluded.issued_by,
             issued_at = now(), expires_at = excluded.expires_at,
             redeemed_at = excluded.redeemed_at, redeemed_user_id = excluded.redeemed_user_id;
    end if;
  end if;
  return null;
end;
$fn$;
create trigger zz_t3802_open_invite_full after insert or update on public.admin_users
  for each row execute function pg_temp.t3802_open_invite();
create trigger zz_t3802_open_invite_team after insert or update on public.admin_team_members
  for each row execute function pg_temp.t3802_open_invite();
-- Rows that were already invited before the harness was attached.
insert into public.admin_team_invites (email, role, token_hash, issued_by, expires_at, redeemed_at, redeemed_user_id)
select x.email, x.role, encode(sha256(convert_to('harness:' || x.email, 'UTF8')), 'hex'),
       'harness', now() + interval '7 days', now(), x.uid
  from (
    select lower(btrim(a.email)) as email, 'admin'::text as role,
           (select u.id from auth.users u where lower(btrim(u.email)) = lower(btrim(a.email)) order by u.id limit 1) as uid
      from public.admin_users a where a.status = 'invited'
    union all
    select t.email, t.role,
           (select u.id from auth.users u where lower(btrim(u.email)) = t.email order by u.id limit 1)
      from public.admin_team_members t where t.status = 'invited'
  ) x
 where x.uid is not null
on conflict (email) do nothing;

create temp table t3802_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802_people (who, id, email) values
  ('owner',    '38020000-0000-4000-8000-000000000001', 'issue3802-owner@test.local'),
  ('admin',    '38020000-0000-4000-8000-000000000002', 'issue3802-admin@test.local'),
  ('growth',   '38020000-0000-4000-8000-000000000003', 'issue3802-growth@test.local'),
  ('partner',  '38020000-0000-4000-8000-000000000004', 'issue3802-partner@test.local'),
  ('consumer', '38020000-0000-4000-8000-000000000005', 'issue3802-consumer@test.local'),
  ('invitee',  '38020000-0000-4000-8000-000000000006', 'issue3802-invitee@test.local'),
  ('mover',    '38020000-0000-4000-8000-000000000007', 'issue3802-mover@test.local'),
  ('newadmin', '38020000-0000-4000-8000-000000000008', 'issue3802-newadmin@test.local'),
  ('legacy',   '38020000-0000-4000-8000-000000000009', 'issue3802-legacy@test.local');

insert into auth.users (id, email, email_confirmed_at)
select id, email, now() from t3802_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802-owner@test.local', 'owner', 'active', now()),
  ('issue3802-admin@test.local', 'admin', 'active', now());
-- An invited full admin who has not signed in yet (T-6 target, T-15 subject).
insert into public.admin_users (email, role, status) values
  ('issue3802-legacy@test.local', 'admin', 'invited');

create temp table t3802_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- Run one statement as a given caller and return its single text result, or
-- 'ERR:<sqlstate>:<message>' when it raises. A raised statement leaves nothing
-- behind (the block is a subtransaction).
create function pg_temp.t3802_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'postgres') then
    select id, email into strict v_id, v_email from t3802_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who <> 'postgres' then
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

create function pg_temp.t3802_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(p_got, '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3802_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3802_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(p_got, '<null>'), p_pattern));
end;
$fn$;

-- Canonical text of a JSON value; a non-JSON value (a captured error) is
-- returned as it is, so a refusal is recorded as a failed check, not a crash.
create function pg_temp.t3802_j(p text) returns text
language plpgsql as $fn$
begin
  return p::jsonb::text;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3802_team_snapshot() returns text
language sql as $fn$
  select coalesce((select jsonb_agg(to_jsonb(a) order by a.email) from public.admin_users a), '[]'::jsonb)::text
      || coalesce((select jsonb_agg(to_jsonb(m) order by m.email) from public.admin_team_members m), '[]'::jsonb)::text
$fn$;

create function pg_temp.t3802_audit_count() returns text
language sql as $fn$
  select count(*)::text from public.admin_audit_log where target_type = 'team_member'
$fn$;

-- ---------------------------------------------------------------------------
-- Setup THROUGH the product path: the owner invites, each person activates.
-- ---------------------------------------------------------------------------
do $setup$
declare
  r text;
begin
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-growth@test.local', 'growth', 'invited')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'owner invites growth', r, 'true');
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-partner@test.local', 'partner', 'invited')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'owner invites partner', r, 'true');
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-invitee@test.local', 'partner', 'invited')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'owner invites the invitee as partner', r, 'true');
  perform pg_temp.t3802_check('T-11', 'three invites wrote three audit rows', pg_temp.t3802_audit_count(), '3');
  perform pg_temp.t3802_check('T-11', 'invite audit rows carry the owner email',
    (select count(*)::text from public.admin_audit_log
      where target_type = 'team_member' and action = 'team.invite'
        and admin_email = 'issue3802-owner@test.local'), '3');

  -- T-3 while invited: role shown, no areas.
  r := pg_temp.t3802_as('growth', $q$select public.admin_team_my_access()::text$q$);
  perform pg_temp.t3802_check('T-3', 'invited growth access',
    pg_temp.t3802_j(r),
    pg_temp.t3802_j('{"email":"issue3802-growth@test.local","role":"growth","status":"invited","areas":[]}'));
  perform pg_temp.t3802_check('T-1', 'invited growth has no active role',
    pg_temp.t3802_as('growth', $q$select public.admin_team_role()$q$), null);

  r := pg_temp.t3802_as('growth', $q$select public.admin_team_activate_self()->>'status'$q$);
  perform pg_temp.t3802_check('T-4', 'growth activates', r, 'active');
  r := pg_temp.t3802_as('partner', $q$select public.admin_team_activate_self()->>'status'$q$);
  perform pg_temp.t3802_check('T-4', 'partner activates', r, 'active');
  perform pg_temp.t3802_check('T-11', 'two activations wrote two audit rows', pg_temp.t3802_audit_count(), '5');
end;
$setup$;

-- ---------------------------------------------------------------------------
-- T-1, T-2, T-3 — role, areas and access per caller.
-- ---------------------------------------------------------------------------
do $t123$
declare
  c record;
  v_role text;
  v_access text;
begin
  for c in
    select * from (values
      ('owner',    'owner',   'true',  'true',  'false'),
      ('admin',    'admin',   'true',  'false', 'false'),
      ('growth',   'growth',  'false', 'false', 'true'),
      ('partner',  'partner', 'false', 'false', 'true'),
      ('consumer', null,      'false', 'false', 'false'),
      ('invitee',  null,      'false', 'false', 'false')
    ) as v(who, want_role, want_console, want_manage, want_home)
  loop
    perform pg_temp.t3802_check('T-1', c.who || ' role',
      pg_temp.t3802_as(c.who, $q$select public.admin_team_role()$q$), c.want_role);
    perform pg_temp.t3802_check('T-2', c.who || ' admin_console',
      pg_temp.t3802_as(c.who, $q$select public.admin_team_can('admin_console')::text$q$), c.want_console);
    perform pg_temp.t3802_check('T-2', c.who || ' admin_console equals is_admin_user()',
      pg_temp.t3802_as(c.who, $q$select (public.admin_team_can('admin_console') = public.is_admin_user())::text$q$), 'true');
    perform pg_temp.t3802_check('T-2', c.who || ' team_manage',
      pg_temp.t3802_as(c.who, $q$select public.admin_team_can('team_manage')::text$q$), c.want_manage);
    perform pg_temp.t3802_check('T-2', c.who || ' role_home',
      pg_temp.t3802_as(c.who, $q$select public.admin_team_can('role_home')::text$q$), c.want_home);
    perform pg_temp.t3802_check('T-2', c.who || ' unknown area',
      pg_temp.t3802_as(c.who, $q$select public.admin_team_can('nope')::text$q$), 'false');
    perform pg_temp.t3802_check('T-2', c.who || ' null area',
      pg_temp.t3802_as(c.who, $q$select public.admin_team_can(null)::text$q$), 'false');
  end loop;

  -- An anonymous caller cannot even call the functions.
  perform pg_temp.t3802_like('T-1', 'anon role call refused',
    pg_temp.t3802_as('anon', $q$select public.admin_team_role()$q$), 'ERR:42501:%');
  perform pg_temp.t3802_like('T-2', 'anon can() call refused',
    pg_temp.t3802_as('anon', $q$select public.admin_team_can('admin_console')::text$q$), 'ERR:42501:%');
  -- A signed-in role with no caller identity resolves to nothing.
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  v_role := coalesce(public.admin_team_role(), '<none>');
  v_access := coalesce(public.admin_team_my_access()::text, '<none>');
  reset role;
  perform pg_temp.t3802_check('T-1', 'no caller identity -> no role', v_role, '<none>');
  perform pg_temp.t3802_check('T-3', 'no caller identity -> no access', v_access, '<none>');

  perform pg_temp.t3802_check('T-3', 'owner access',
    pg_temp.t3802_j(pg_temp.t3802_as('owner', $q$select public.admin_team_my_access()::text$q$)),
    pg_temp.t3802_j('{"email":"issue3802-owner@test.local","role":"owner","status":"active","areas":["admin_console","team_manage","crm","beta_leads"]}'));
  perform pg_temp.t3802_check('T-3', 'admin access',
    pg_temp.t3802_j(pg_temp.t3802_as('admin', $q$select public.admin_team_my_access()::text$q$)),
    pg_temp.t3802_j('{"email":"issue3802-admin@test.local","role":"admin","status":"active","areas":["admin_console","crm","beta_leads"]}'));
  perform pg_temp.t3802_check('T-3', 'growth access',
    pg_temp.t3802_j(pg_temp.t3802_as('growth', $q$select public.admin_team_my_access()::text$q$)),
    pg_temp.t3802_j('{"email":"issue3802-growth@test.local","role":"growth","status":"active","areas":["role_home","crm","beta_leads"]}'));
  perform pg_temp.t3802_check('T-3', 'partner access',
    pg_temp.t3802_j(pg_temp.t3802_as('partner', $q$select public.admin_team_my_access()::text$q$)),
    pg_temp.t3802_j('{"email":"issue3802-partner@test.local","role":"partner","status":"active","areas":["role_home","crm","beta_leads"]}'));
  perform pg_temp.t3802_check('T-3', 'invitee access (invited, no areas)',
    pg_temp.t3802_j(pg_temp.t3802_as('invitee', $q$select public.admin_team_my_access()::text$q$)),
    pg_temp.t3802_j('{"email":"issue3802-invitee@test.local","role":"partner","status":"invited","areas":[]}'));
  perform pg_temp.t3802_check('T-3', 'invited full admin access (invited, no areas)',
    pg_temp.t3802_j(pg_temp.t3802_as('legacy', $q$select public.admin_team_my_access()::text$q$)),
    pg_temp.t3802_j('{"email":"issue3802-legacy@test.local","role":"admin","status":"invited","areas":[]}'));
  perform pg_temp.t3802_check('T-3', 'consumer access is null',
    pg_temp.t3802_as('consumer', $q$select public.admin_team_my_access()::text$q$), null);
  perform pg_temp.t3802_like('T-3', 'anon access call refused',
    pg_temp.t3802_as('anon', $q$select public.admin_team_my_access()::text$q$), 'ERR:42501:%');
end;
$t123$;

-- ---------------------------------------------------------------------------
-- T-5 — containment. Every probe answers a growth person and a partner person
-- exactly as it answers an ordinary signed-in account; the admin answers
-- differently on each, so no probe is vacuous.
-- ---------------------------------------------------------------------------
insert into public.admin_audit_log (admin_email, action, target_type, target_id)
  values ('issue3802-owner@test.local', 'issue3802.seed', 'seed', 'seed');
insert into public.admin_email_log (subject, body, recipient_type)
  values ('issue3802 seed', 'seed', 'individual');
insert into public.admin_backfill_log (operation_type) values ('place_refresh');
insert into public.email_templates (name, subject, body) values ('issue3802 seed', 'seed', 'seed');
insert into public.integrations (service_name, display_name) values ('issue3802_seed', 'Issue 3802 seed');

do $t5$
declare
  p record;
  v_consumer text;
  v_admin text;
  v_who text;
  v_got text;
begin
  for p in
    select * from (values
      -- label, sql, expected for a non-admin ('%' patterns allowed)
      ('count admin_users',         $q$select count(*)::text from public.admin_users$q$,        '0'),
      ('count admin_audit_log',     $q$select count(*)::text from public.admin_audit_log$q$,    '0'),
      ('count admin_email_log',     $q$select count(*)::text from public.admin_email_log$q$,    '0'),
      ('count admin_backfill_log',  $q$select count(*)::text from public.admin_backfill_log$q$, '0'),
      ('count email_templates',     $q$select count(*)::text from public.email_templates$q$,    '0'),
      ('count integrations',        $q$select count(*)::text from public.integrations$q$,       '0'),
      ('insert admin_audit_log',    $q$with x as (insert into public.admin_audit_log (admin_email, action, target_type) values ('x@test.local', 'issue3802.probe', 'probe') returning 1) select count(*)::text from x$q$, 'ERR:42501:%'),
      ('get_admin_emails rows',     $q$select count(*)::text from public.get_admin_emails()$q$, '0'),
      ('admin_get_person',          $q$select public.admin_get_person('38020000-0000-4000-8000-000000000001')::text$q$, 'ERR:%not_authorized%'),
      ('admin_audit_probe',         $q$select public.admin_audit_probe('issue3802 probe')::text$q$, 'ERR:%not_authorized%'),
      ('admin_set_platform_take_rate', $q$select public.admin_set_platform_take_rate(-1)::text$q$, 'ERR:%not_authorized%'),
      ('admin_team_list',           $q$select count(*)::text from public.admin_team_list()$q$,  'ERR:42501:forbidden')
    ) as v(label, sql, want)
  loop
    v_consumer := pg_temp.t3802_as('consumer', p.sql);
    perform pg_temp.t3802_like('T-5', 'consumer: ' || p.label, v_consumer, p.want);
    foreach v_who in array array['growth', 'partner'] loop
      v_got := pg_temp.t3802_as(v_who, p.sql);
      perform pg_temp.t3802_like('T-5', v_who || ': ' || p.label, v_got, p.want);
      perform pg_temp.t3802_check('T-5', v_who || ' equals consumer: ' || p.label, v_got, v_consumer);
    end loop;
    -- Positive control: a full admin gets a different answer on every probe
    -- except the owner-only roster.
    v_admin := pg_temp.t3802_as('admin', p.sql);
    if p.label <> 'admin_team_list' then
      perform pg_temp.t3802_check('T-5', 'control, admin differs: ' || p.label,
        (v_admin is distinct from v_consumer)::text, 'true');
    end if;
  end loop;
end;
$t5$;

-- ---------------------------------------------------------------------------
-- T-6, T-7 — role changes are owner-only. Direct writes by every other caller
-- are refused or change nothing; the tables are byte-identical afterwards.
-- ---------------------------------------------------------------------------
do $t67$
declare
  v_before text := pg_temp.t3802_team_snapshot();
  v_audit  text := pg_temp.t3802_audit_count();
  v_who text;
  v_test text;
  w record;
  v_got text;
begin
  foreach v_who in array array['admin', 'growth', 'partner', 'consumer'] loop
    v_test := case when v_who = 'admin' then 'T-6' else 'T-7' end;
    for w in
      select * from (values
        ('make self owner',
         format($q$with x as (update public.admin_users set role = 'owner' where email = 'issue3802-%s@test.local' returning 1) select count(*)::text from x$q$, v_who)),
        ('update any role',
         $q$with x as (update public.admin_users set role = 'owner' returning 1) select count(*)::text from x$q$),
        ('insert a full admin',
         format($q$with x as (insert into public.admin_users (email, role, status) values ('issue3802-planted-%s@test.local', 'owner', 'active') returning 1) select count(*)::text from x$q$, v_who)),
        ('delete the owner',
         $q$with x as (delete from public.admin_users where email = 'issue3802-owner@test.local' returning 1) select count(*)::text from x$q$),
        ('activate someone else''s invite',
         $q$with x as (update public.admin_users set status = 'active' where email = 'issue3802-legacy@test.local' returning 1) select count(*)::text from x$q$),
        ('change an email',
         $q$with x as (update public.admin_users set email = 'issue3802-moved@test.local' where email = 'issue3802-admin@test.local' returning 1) select count(*)::text from x$q$)
      ) as v(label, sql)
    loop
      v_got := pg_temp.t3802_as(v_who, w.sql);
      perform pg_temp.t3802_check(v_test, v_who || ': ' || w.label || ' refused or changes nothing (' || v_got || ')',
        (v_got = '0' or v_got like 'ERR:42501:%')::text, 'true');
    end loop;

    perform pg_temp.t3802_like(v_test, v_who || ': direct insert into the team table',
      pg_temp.t3802_as(v_who, $q$with x as (insert into public.admin_team_members (email, role, status) values ('issue3802-planted@test.local', 'growth', 'active') returning 1) select count(*)::text from x$q$),
      'ERR:42501:%');
    perform pg_temp.t3802_like(v_test, v_who || ': direct update of the team table',
      pg_temp.t3802_as(v_who, $q$with x as (update public.admin_team_members set role = 'partner' returning 1) select count(*)::text from x$q$),
      'ERR:42501:%');
    perform pg_temp.t3802_like(v_test, v_who || ': direct read of the team table',
      pg_temp.t3802_as(v_who, $q$select count(*)::text from public.admin_team_members$q$),
      'ERR:42501:%');
    perform pg_temp.t3802_check(v_test, v_who || ': set_member invite refused',
      pg_temp.t3802_as(v_who, $q$select public.admin_team_set_member('issue3802-someone@test.local', 'admin', 'invited')::text$q$),
      'ERR:42501:forbidden');
    perform pg_temp.t3802_check(v_test, v_who || ': set_member on self refused',
      pg_temp.t3802_as(v_who, format($q$select public.admin_team_set_member('issue3802-%s@test.local', 'admin', 'active')::text$q$, v_who)),
      'ERR:42501:forbidden');
    perform pg_temp.t3802_check(v_test, v_who || ': set_member remove owner refused',
      pg_temp.t3802_as(v_who, $q$select public.admin_team_set_member('issue3802-owner@test.local', 'admin', 'revoked')::text$q$),
      'ERR:42501:forbidden');
    perform pg_temp.t3802_check(v_test, v_who || ': tables unchanged afterwards',
      (pg_temp.t3802_team_snapshot() = v_before)::text, 'true');
  end loop;

  perform pg_temp.t3802_like('T-7', 'anon: set_member call refused',
    pg_temp.t3802_as('anon', $q$select public.admin_team_set_member('issue3802-someone@test.local', 'admin', 'invited')::text$q$),
    'ERR:42501:%');
  perform pg_temp.t3802_like('T-7', 'anon: direct update refused',
    pg_temp.t3802_as('anon', $q$with x as (update public.admin_users set role = 'owner' returning 1) select count(*)::text from x$q$),
    'ERR:42501:%');
  perform pg_temp.t3802_check('T-7', 'tables unchanged after every refusal',
    (pg_temp.t3802_team_snapshot() = v_before)::text, 'true');
  perform pg_temp.t3802_check('T-11', 'refusals wrote no audit row', pg_temp.t3802_audit_count(), v_audit);
end;
$t67$;

-- ---------------------------------------------------------------------------
-- T-8 — no second owner, no change to the owner, no change to oneself.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
  values ('38020000-0000-4000-8000-000000000010', 'issue3802-owner2@test.local', now());
insert into public.admin_users (email, role, status, accepted_at)
  values ('issue3802-owner2@test.local', 'owner', 'active', now());

do $t8$
declare
  v_before text := pg_temp.t3802_team_snapshot();
  v_audit  text := pg_temp.t3802_audit_count();
begin
  perform pg_temp.t3802_check('T-8', 'owner cannot change self',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-owner@test.local', 'admin', 'active')::text$q$),
    'ERR:42501:cannot_change_self');
  perform pg_temp.t3802_check('T-8', 'owner cannot remove self',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member(' Issue3802-Owner@test.local ', 'admin', 'revoked')::text$q$),
    'ERR:42501:cannot_change_self');
  perform pg_temp.t3802_check('T-8', 'owner role can never be assigned',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-consumer@test.local', 'owner', 'invited')::text$q$),
    'ERR:22023:invalid_role');
  perform pg_temp.t3802_check('T-8', 'another owner row cannot be changed',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-owner2@test.local', 'admin', 'active')::text$q$),
    'ERR:42501:cannot_change_owner');
  perform pg_temp.t3802_check('T-8', 'another owner row cannot be removed',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-owner2@test.local', 'growth', 'revoked')::text$q$),
    'ERR:42501:cannot_change_owner');
  perform pg_temp.t3802_check('T-8', 'invalid email',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('not-an-email', 'growth', 'invited')::text$q$),
    'ERR:22023:invalid_email');
  perform pg_temp.t3802_check('T-8', 'invalid status',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-consumer@test.local', 'growth', 'banned')::text$q$),
    'ERR:22023:invalid_status');
  perform pg_temp.t3802_check('T-8', 'removing someone with no membership',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-consumer@test.local', 'growth', 'revoked')::text$q$),
    'ERR:P0002:not_found');
  perform pg_temp.t3802_check('T-8', 'tables unchanged', (pg_temp.t3802_team_snapshot() = v_before)::text, 'true');
  perform pg_temp.t3802_check('T-11', 'refused owner requests wrote no audit row', pg_temp.t3802_audit_count(), v_audit);
end;
$t8$;

delete from public.admin_users where email = 'issue3802-owner2@test.local';

-- ---------------------------------------------------------------------------
-- T-9 — self-activation: own invitation only, role unchanged, idempotent.
-- ---------------------------------------------------------------------------
do $t9$
declare
  v_audit int := pg_temp.t3802_audit_count()::int;
  v_before text;
  r text;
begin
  -- An ordinary account calling it gets nothing and changes nothing.
  v_before := pg_temp.t3802_team_snapshot();
  perform pg_temp.t3802_check('T-9', 'consumer activation returns null',
    pg_temp.t3802_as('consumer', $q$select public.admin_team_activate_self()::text$q$), null);
  perform pg_temp.t3802_check('T-9', 'consumer activation changes nothing',
    (pg_temp.t3802_team_snapshot() = v_before)::text, 'true');
  perform pg_temp.t3802_check('T-9', 'consumer activation writes no audit row',
    pg_temp.t3802_audit_count(), v_audit::text);
  perform pg_temp.t3802_like('T-9', 'anon activation call refused',
    pg_temp.t3802_as('anon', $q$select public.admin_team_activate_self()::text$q$), 'ERR:42501:%');

  r := pg_temp.t3802_as('invitee', $q$select public.admin_team_activate_self()::text$q$);
  perform pg_temp.t3802_check('T-9', 'invitee activation result', pg_temp.t3802_j(r),
    pg_temp.t3802_j('{"email":"issue3802-invitee@test.local","role":"partner","status":"active","areas":["role_home","crm","beta_leads"]}'));
  perform pg_temp.t3802_check('T-9', 'invitee row is active with the invited role',
    (select role || '/' || status || '/' || (accepted_at is not null)::text
       from public.admin_team_members where email = 'issue3802-invitee@test.local'),
    'partner/active/true');
  perform pg_temp.t3802_check('T-9', 'only the invitee row changed',
    (select count(*)::text from public.admin_users where email = 'issue3802-legacy@test.local' and status = 'invited'), '1');
  perform pg_temp.t3802_check('T-11', 'activation wrote one audit row', pg_temp.t3802_audit_count(), (v_audit + 1)::text);
  perform pg_temp.t3802_check('T-11', 'activation audit row carries the invitee email',
    (select admin_email || '/' || action from public.admin_audit_log
      where target_type = 'team_member' and target_id = 'issue3802-invitee@test.local' and action = 'team.activate'),
    'issue3802-invitee@test.local/team.activate');

  v_before := pg_temp.t3802_team_snapshot();
  perform pg_temp.t3802_check('T-9', 'second activation returns the same access',
    pg_temp.t3802_j(pg_temp.t3802_as('invitee', $q$select public.admin_team_activate_self()::text$q$)), pg_temp.t3802_j(r));
  perform pg_temp.t3802_check('T-9', 'second activation changes nothing',
    (pg_temp.t3802_team_snapshot() = v_before)::text, 'true');
  perform pg_temp.t3802_check('T-11', 'second activation wrote no audit row', pg_temp.t3802_audit_count(), (v_audit + 1)::text);
end;
$t9$;

-- ---------------------------------------------------------------------------
-- T-4 (continued) + T-11 — the owner changes roles both ways, removes, restores.
-- ---------------------------------------------------------------------------
do $t4$
declare
  v_audit int := pg_temp.t3802_audit_count()::int;
  r text;
begin
  -- Invite a full admin through the product path; they activate.
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('Issue3802-NewAdmin@test.local', 'admin', 'invited')::text$q$);
  perform pg_temp.t3802_check('T-4', 'owner invites an admin', pg_temp.t3802_j(r),
    pg_temp.t3802_j('{"email":"issue3802-newadmin@test.local","role":"admin","status":"invited","changed":true,"previous":null}'));
  perform pg_temp.t3802_check('T-1', 'invited admin is not yet an admin',
    pg_temp.t3802_as('newadmin', $q$select public.is_admin_user()::text$q$), 'false');
  perform pg_temp.t3802_check('T-4', 'invited admin activates',
    pg_temp.t3802_as('newadmin', $q$select public.admin_team_activate_self()->>'role'$q$), 'admin');
  perform pg_temp.t3802_check('T-1', 'activated admin resolves to admin',
    pg_temp.t3802_as('newadmin', $q$select public.admin_team_role() || '/' || public.is_admin_user()::text$q$), 'admin/true');
  v_audit := v_audit + 2;
  perform pg_temp.t3802_check('T-11', 'admin invite + activation wrote two audit rows', pg_temp.t3802_audit_count(), v_audit::text);

  -- A repeated identical request changes nothing and writes nothing.
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-newadmin@test.local', 'admin', 'active')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'repeat request reports changed:false', r, 'false');
  perform pg_temp.t3802_check('T-11', 'repeat request wrote no audit row', pg_temp.t3802_audit_count(), v_audit::text);

  -- mover: invited growth -> active -> admin -> partner -> removed -> restored.
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'growth', 'invited')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'owner invites mover as growth', r, 'true');
  -- The owner cannot switch on someone who has never signed in.
  perform pg_temp.t3802_check('T-4', 'never-activated person cannot be made active',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'growth', 'active')::text$q$),
    'ERR:22023:never_activated');
  -- Remove the pending invite, then try to "undo to active": still never activated.
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'growth', 'revoked')::text$q$);
  perform pg_temp.t3802_check('T-4', 'owner removes a pending invite', pg_temp.t3802_j(r),
    pg_temp.t3802_j('{"email":"issue3802-mover@test.local","role":"growth","status":"revoked","changed":true,"previous":{"role":"growth","status":"invited"}}'));
  perform pg_temp.t3802_check('T-4', 'undo-to-active for a never-activated person is refused',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'growth', 'active')::text$q$),
    'ERR:22023:never_activated');
  -- Undo the removal the right way: restore the invite.
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'growth', 'invited')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'owner restores the invite', r, 'true');
  v_audit := v_audit + 3;   -- invite, remove, invite
  perform pg_temp.t3802_check('T-11', 'invite, remove, re-invite wrote three audit rows', pg_temp.t3802_audit_count(), v_audit::text);
  perform pg_temp.t3802_check('T-11', 'their actions are two invites and one removal',
    (select string_agg(action || '=' || n, ',' order by action)
       from (select action, count(*) as n from public.admin_audit_log
              where target_type = 'team_member' and target_id = 'issue3802-mover@test.local'
              group by action) a),
    'team.invite=2,team.remove=1');

  perform pg_temp.t3802_check('T-4', 'mover activates',
    pg_temp.t3802_as('mover', $q$select public.admin_team_activate_self()->>'role'$q$), 'growth');
  v_audit := v_audit + 1;
  perform pg_temp.t3802_check('T-2', 'mover as growth is not a full admin',
    pg_temp.t3802_as('mover', $q$select public.is_admin_user()::text$q$), 'false');

  -- growth -> admin
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'admin', 'active')::text$q$);
  perform pg_temp.t3802_check('T-4', 'growth -> admin', pg_temp.t3802_j(r),
    pg_temp.t3802_j('{"email":"issue3802-mover@test.local","role":"admin","status":"active","changed":true,"previous":{"role":"growth","status":"active"}}'));
  perform pg_temp.t3802_check('T-4', 'after growth -> admin they are a full admin',
    pg_temp.t3802_as('mover', $q$select public.is_admin_user()::text || '/' || public.admin_team_role()$q$), 'true/admin');
  perform pg_temp.t3802_check('T-10', 'after growth -> admin the non-admin row is revoked',
    (select status from public.admin_team_members where email = 'issue3802-mover@test.local'), 'revoked');
  v_audit := v_audit + 1;
  perform pg_temp.t3802_check('T-11', 'role change wrote one audit row', pg_temp.t3802_audit_count(), v_audit::text);
  perform pg_temp.t3802_check('T-11', 'role change audit row',
    (select admin_email || '/' || action || '/' || (metadata->'before'->>'role') || '>' || (metadata->'after'->>'role')
       from public.admin_audit_log
      where target_type = 'team_member' and target_id = 'issue3802-mover@test.local' and action = 'team.role_change'),
    'issue3802-owner@test.local/team.role_change/growth>admin');

  -- admin -> partner
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'partner', 'active')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'admin -> partner', r, 'true');
  perform pg_temp.t3802_check('T-4', 'after admin -> partner they are not a full admin',
    pg_temp.t3802_as('mover', $q$select public.is_admin_user()::text || '/' || public.admin_team_role()$q$), 'false/partner');
  perform pg_temp.t3802_check('T-4', 'the full-admin row is revoked, not deleted',
    (select status from public.admin_users where email = 'issue3802-mover@test.local'), 'revoked');
  v_audit := v_audit + 1;

  -- remove
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'partner', 'revoked')::text$q$);
  perform pg_temp.t3802_check('T-4', 'remove access', pg_temp.t3802_j(r),
    pg_temp.t3802_j('{"email":"issue3802-mover@test.local","role":"partner","status":"revoked","changed":true,"previous":{"role":"partner","status":"active"}}'));
  perform pg_temp.t3802_check('T-4', 'removed person has no role and no access',
    coalesce(pg_temp.t3802_as('mover', $q$select coalesce(public.admin_team_role(), '<none>') || '/' || coalesce(public.admin_team_my_access()::text, '<none>')$q$), '<null>'),
    '<none>/<none>');
  v_audit := v_audit + 1;
  -- removing again: nothing to do
  perform pg_temp.t3802_check('T-4', 'removing again reports changed:false',
    pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'partner', 'revoked')->>'changed'$q$), 'false');
  perform pg_temp.t3802_check('T-11', 'second removal wrote no audit row', pg_temp.t3802_audit_count(), v_audit::text);

  -- undo the removal: allowed, because they activated before.
  r := pg_temp.t3802_as('owner', $q$select public.admin_team_set_member('issue3802-mover@test.local', 'partner', 'active')->>'changed'$q$);
  perform pg_temp.t3802_check('T-4', 'undo removal to active', r, 'true');
  perform pg_temp.t3802_check('T-4', 'restored person is partner again',
    pg_temp.t3802_as('mover', $q$select public.admin_team_role()$q$), 'partner');
  v_audit := v_audit + 1;
  perform pg_temp.t3802_check('T-11', 'restore wrote one audit row', pg_temp.t3802_audit_count(), v_audit::text);
  perform pg_temp.t3802_check('T-11', 'restore audit action',
    (select count(*)::text from public.admin_audit_log
      where target_type = 'team_member' and target_id = 'issue3802-mover@test.local'
        and action = 'team.restore' and admin_email = 'issue3802-owner@test.local'), '1');
  perform pg_temp.t3802_check('T-11', 'every team audit row names a real caller',
    (select count(*)::text from public.admin_audit_log l
      where l.target_type = 'team_member'
        and not exists (select 1 from t3802_people p where p.email = l.admin_email)), '0');

  -- Owner-only roster: one row per person, owner first.
  perform pg_temp.t3802_check('T-4', 'roster: one row per person',
    pg_temp.t3802_as('owner', $q$select (count(*) = count(distinct email))::text from public.admin_team_list()$q$), 'true');
  perform pg_temp.t3802_check('T-4', 'roster: mover shows the live row',
    pg_temp.t3802_as('owner', $q$select role || '/' || status from public.admin_team_list() where email = 'issue3802-mover@test.local'$q$), 'partner/active');
  perform pg_temp.t3802_check('T-4', 'roster: caller is flagged',
    pg_temp.t3802_as('owner', $q$select string_agg(email, ',') from public.admin_team_list() where is_self$q$), 'issue3802-owner@test.local');
  perform pg_temp.t3802_like('T-6', 'roster refused for an admin',
    pg_temp.t3802_as('admin', $q$select count(*)::text from public.admin_team_list()$q$), 'ERR:42501:forbidden');
end;
$t4$;

-- ---------------------------------------------------------------------------
-- T-10 — one live membership per email across both tables, for every writer.
-- ---------------------------------------------------------------------------
insert into public.admin_users (email, role, status)
  values ('issue3802-growth@test.local', 'admin', 'revoked')
  on conflict (email) do nothing;

do $t10$
begin
  perform pg_temp.t3802_like('T-10', 'live non-admin row for an active admin is refused',
    pg_temp.t3802_as('postgres', $q$with x as (insert into public.admin_team_members (email, role, status) values ('issue3802-admin@test.local', 'growth', 'active') returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');
  perform pg_temp.t3802_like('T-10', 'invited non-admin row for an active admin is refused',
    pg_temp.t3802_as('postgres', $q$with x as (insert into public.admin_team_members (email, role, status) values ('issue3802-admin@test.local', 'partner', 'invited') returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');
  perform pg_temp.t3802_like('T-10', 'reviving a full-admin row for an active growth person is refused',
    pg_temp.t3802_as('postgres', $q$with x as (update public.admin_users set status = 'active' where email = 'issue3802-growth@test.local' returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');
  perform pg_temp.t3802_like('T-10', 'a new full-admin row for an active partner person is refused',
    pg_temp.t3802_as('postgres', $q$with x as (insert into public.admin_users (email, role, status) values ('issue3802-partner@test.local', 'admin', 'invited') returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');
  perform pg_temp.t3802_check('T-10', 'a revoked row alongside a live one is allowed',
    pg_temp.t3802_as('postgres', $q$with x as (insert into public.admin_team_members (email, role, status) values ('issue3802-admin@test.local', 'growth', 'revoked') returning 1) select count(*)::text from x$q$),
    '1');
  perform pg_temp.t3802_like('T-10', 'the non-admin table can never hold a full-admin role',
    pg_temp.t3802_as('postgres', $q$with x as (insert into public.admin_team_members (email, role, status) values ('issue3802-roleprobe@test.local', 'admin', 'invited') returning 1) select count(*)::text from x$q$),
    'ERR:23514:%');
  perform pg_temp.t3802_like('T-10', 'the full-admin table can never hold a non-admin role',
    pg_temp.t3802_as('postgres', $q$with x as (insert into public.admin_users (email, role, status) values ('issue3802-roleprobe@test.local', 'growth', 'invited') returning 1) select count(*)::text from x$q$),
    'ERR:23514:%');
  perform pg_temp.t3802_check('T-10', 'no email is live in both tables',
    (select count(*)::text
       from public.admin_users au
       join public.admin_team_members m on m.email = lower(btrim(au.email))
      where au.status <> 'revoked' and m.status <> 'revoked'), '0');
end;
$t10$;

-- ---------------------------------------------------------------------------
-- T-12 — privilege matrix.
-- ---------------------------------------------------------------------------
do $t12$
declare
  v_role text;
  v_priv text;
  v_fn text;
  v_guard text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      perform pg_temp.t3802_check('T-12', v_role || ' ' || v_priv || ' on admin_team_members',
        has_table_privilege(v_role, 'public.admin_team_members', v_priv)::text, 'false');
    end loop;
    foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      perform pg_temp.t3802_check('T-12', v_role || ' ' || v_priv || ' on admin_users',
        has_table_privilege(v_role, 'public.admin_users', v_priv)::text, 'false');
    end loop;
    perform pg_temp.t3802_check('T-12', v_role || ' keeps SELECT on admin_users',
      has_table_privilege(v_role, 'public.admin_users', 'SELECT')::text, 'true');
    perform pg_temp.t3802_check('T-12', v_role || ' has no column-level write on admin_users',
      (select count(*)::text from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'admin_users'
          and grantee = v_role and privilege_type in ('INSERT','UPDATE','REFERENCES')), '0');
  end loop;

  foreach v_fn in array array[
    'public.admin_team_set_member(text,text,text)', 'public.admin_team_list()',
    'public.admin_team_activate_self()', 'public.admin_team_my_access()',
    'public.admin_team_can(text)', 'public.admin_team_role()', 'public.admin_team_role_areas(text)'
  ] loop
    perform pg_temp.t3802_check('T-12', 'anon cannot execute ' || v_fn,
      has_function_privilege('anon', v_fn, 'EXECUTE')::text, 'false');
    perform pg_temp.t3802_check('T-12', 'authenticated can execute ' || v_fn,
      has_function_privilege('authenticated', v_fn, 'EXECUTE')::text, 'true');
  end loop;
  foreach v_fn in array array['public.admin_team_caller_email()', 'public.admin_team_guard_exclusive()'] loop
    perform pg_temp.t3802_check('T-12', 'anon cannot execute ' || v_fn,
      has_function_privilege('anon', v_fn, 'EXECUTE')::text, 'false');
    perform pg_temp.t3802_check('T-12', 'authenticated cannot execute ' || v_fn,
      has_function_privilege('authenticated', v_fn, 'EXECUTE')::text, 'false');
  end loop;

  perform pg_temp.t3802_check('T-12', 'no write policy on admin_users',
    (select count(*)::text from pg_policy where polrelid = 'public.admin_users'::regclass and polcmd <> 'r'), '0');
  perform pg_temp.t3802_check('T-12', 'the read policy on admin_users is still there',
    (select count(*)::text from pg_policy where polrelid = 'public.admin_users'::regclass
       and polname = 'Admins can read admin_users' and polcmd = 'r'), '1');
  perform pg_temp.t3802_check('T-12', 'no policy at all on admin_team_members',
    (select count(*)::text from pg_policy where polrelid = 'public.admin_team_members'::regclass), '0');
  perform pg_temp.t3802_check('T-12', 'row security is on for admin_team_members',
    (select relrowsecurity::text from pg_class where oid = 'public.admin_team_members'::regclass), 'true');
  perform pg_temp.t3802_check('T-12', 'full-admin role vocabulary is unchanged',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'admin_users_role_check'),
    $c$CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text])))$c$);
  -- Asked as the migration role, the way the guard is run in CI: the image
  -- admin role also sees extension-owned views the guard does not baseline.
  set local role postgres;
  select count(*)::text into v_guard from public.audit_overbroad_table_grants() where not is_baselined;
  reset role;
  perform pg_temp.t3802_check('T-12', 'grant guard reports nothing new', v_guard, '0');
end;
$t12$;

-- ---------------------------------------------------------------------------
-- T-13 — the set of functions that write team membership is pinned by name.
-- A new writer must be added here deliberately.
-- ---------------------------------------------------------------------------
do $t13$
begin
  perform pg_temp.t3802_check('T-13', 'functions that write team membership',
    (select string_agg(p.proname, ',' order by p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?"?(admin_users|admin_team_members)\M'),
    'activate_invited_admin,admin_team_activate_self,admin_team_set_member');
end;
$t13$;

-- ---------------------------------------------------------------------------
-- T-14 — policies on other tables read admin_users as the calling role. Those
-- reads must keep answering (with no rows), not raise a permission error.
-- ---------------------------------------------------------------------------
do $t14$
begin
  perform pg_temp.t3802_check('T-14', 'anon read through a policy that looks at admin_users',
    pg_temp.t3802_as('anon', $q$select count(*)::text from public.rule_sets$q$), '0');
  perform pg_temp.t3802_check('T-14', 'signed-in read through a policy that looks at admin_users',
    pg_temp.t3802_as('consumer', $q$select count(*)::text from public.admin_email_log$q$), '0');
  perform pg_temp.t3802_check('T-14', 'anon direct read of admin_users answers with no rows',
    pg_temp.t3802_as('anon', $q$select count(*)::text from public.admin_users$q$), '0');
end;
$t14$;

-- ---------------------------------------------------------------------------
-- T-15 — the previous self-activation function is untouched and still works.
-- ---------------------------------------------------------------------------
do $t15$
begin
  perform pg_temp.t3802_check('T-15', 'legacy invite is still pending',
    (select status from public.admin_users where email = 'issue3802-legacy@test.local'), 'invited');
  perform pg_temp.t3802_check('T-15', 'activate_invited_admin() runs for the invited caller',
    coalesce(pg_temp.t3802_as('legacy', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802_check('T-15', 'their row is now active',
    (select status || '/' || (accepted_at is not null)::text from public.admin_users where email = 'issue3802-legacy@test.local'),
    'active/true');
  perform pg_temp.t3802_check('T-15', 'and they resolve to admin',
    pg_temp.t3802_as('legacy', $q$select public.admin_team_role() || '/' || public.is_admin_user()::text$q$), 'admin/true');
end;
$t15$;

-- ---------------------------------------------------------------------------
-- Verdict. Every failed check is listed; one or more fails the suite.
-- ---------------------------------------------------------------------------
do $verdict$
declare
  v_total int;
  v_failed int;
  v_tests text;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802_results;
  if v_total < 320 then
    raise exception 'ISSUE-3802 FAIL: only % checks ran; the suite did not execute fully', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from t3802_results where not ok order by seq loop
      raise warning 'ISSUE-3802 FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    select string_agg(distinct test, ', ' order by test) into v_tests from t3802_results where not ok;
    raise exception 'ISSUE-3802 FAIL: % of % checks failed in: %', v_failed, v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 PASS: % checks across T-1..T-15, 0 failed', v_total;
end;
$verdict$;

rollback;
