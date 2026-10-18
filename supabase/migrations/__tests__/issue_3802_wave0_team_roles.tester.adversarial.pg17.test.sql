-- Issue #3802 (Wave 0) — INDEPENDENT TESTER suite for team roles (PostgreSQL 17).
--
-- Written by the tester, not the implementor. The implementor suite walks the
-- product path one request at a time. This one asks different questions:
--
--   X-1  Shape of the new objects in the catalog: who may execute each function,
--        what each runs as, what it resolves names against; who holds anything
--        on the two membership tables; which functions in ANY schema mention
--        or write them; no existing policy or view was pointed at the new work.
--   X-2  Every direct statement a client could send at either membership table
--        (thirteen kinds, six callers INCLUDING the owner) is refused outright,
--        and both tables, their grants, policies and triggers are unchanged.
--   X-3  Email spelling: upper case, padding and other non-normalised forms in
--        either table or in the caller's own account can neither produce a
--        second live membership nor a full-admin answer.
--   X-4  Whose invitation is it: a caller without a confirmed address, without
--        an address, or carrying somebody else's address in a request claim
--        gets nothing and changes nothing.
--   X-5  Exhaustive walk: every sequence of up to three team requests (all nine
--        owner requests plus both self-activation functions, 1,463 sequences)
--        from a clean start, with eight invariants checked after every step.
--   X-6  The owner gate: a former owner, a not-yet-active owner and an admin
--        carrying the owner's address in a request claim are all refused; an
--        owner stored in mixed case can still not change or remove themself.
--   X-7  Every table whose policy reads the full-admin table still answers an
--        anonymous and an ordinary signed-in reader (sweep, not a sample).
--   X-8  A person removed everywhere cannot let themself back in, and can be
--        invited again cleanly.
--   R-1  REAL concurrency (second and third database sessions): two team
--        requests for the same person overlap. The second must wait for the
--        first, then see what it wrote. One live membership results.
--   R-2  The same request sent twice at once changes one thing and writes one
--        audit row.
--
-- Parts X-1..X-8 are transaction-contained and rolled back. Part R has to
-- COMMIT its fixtures (other sessions must see them); they are inserted with
-- triggers off, carry their own ids and addresses, and are removed by id at
-- the end. Never run on production.
--
-- Runs as the image's admin role, like the implementor suite: the bare CI
-- image ships an auth.users without email_confirmed_at, and the R part needs
-- CREATE EXTENSION and session_replication_role.
--
-- Checks are RECORDED and reported together.

\set ON_ERROR_STOP on
\getenv t3802x_pw PGPASSWORD

-- ===========================================================================
-- PART X — one transaction, rolled back.
-- ===========================================================================
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t3802x_people (who text primary key, id uuid not null, email text, confirmed boolean not null) on commit drop;
insert into t3802x_people (who, id, email, confirmed) values
  ('owner',     '38020000-0000-4000-9000-000000000001', 'issue3802t-owner@test.local', true),
  ('admin',     '38020000-0000-4000-9000-000000000002', 'issue3802t-admin@test.local', true),
  ('growth',    '38020000-0000-4000-9000-000000000003', 'issue3802t-growth@test.local', true),
  ('partner',   '38020000-0000-4000-9000-000000000004', 'issue3802t-partner@test.local', true),
  ('consumer',  '38020000-0000-4000-9000-000000000005', 'issue3802t-consumer@test.local', true),
  ('fuzz',      '38020000-0000-4000-9000-000000000006', 'issue3802t-fuzz@test.local', true),
  ('unconf',    '38020000-0000-4000-9000-000000000007', 'issue3802t-unconf@test.local', false),
  ('unconf2',   '38020000-0000-4000-9000-000000000008', 'issue3802t-unconf2@test.local', false),
  ('nomail',    '38020000-0000-4000-9000-000000000009', null, true),
  ('inv',       '38020000-0000-4000-9000-00000000000a', 'issue3802t-inv@test.local', true),
  ('mixedauth', '38020000-0000-4000-9000-00000000000b', 'Issue3802T-MixedAuth@Test.Local', true),
  ('skew',      '38020000-0000-4000-9000-00000000000c', 'Issue3802T-Skew@Test.Local', true),
  ('exowner',   '38020000-0000-4000-9000-00000000000d', 'issue3802t-exowner@test.local', true),
  ('newowner',  '38020000-0000-4000-9000-00000000000e', 'issue3802t-newowner@test.local', true),
  ('bigowner',  '38020000-0000-4000-9000-00000000000f', 'Issue3802T-BigOwner@Test.Local', true),
  ('comeback',  '38020000-0000-4000-9000-000000000010', 'issue3802t-comeback@test.local', true),
  ('unconfadm', '38020000-0000-4000-9000-000000000011', 'issue3802t-unconfadm@test.local', false);

insert into auth.users (id, email, email_confirmed_at)
select id, email, case when confirmed then now() end from t3802x_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802t-owner@test.local', 'owner', 'active', now()),
  ('issue3802t-admin@test.local', 'admin', 'active', now()),
  ('issue3802t-skew@test.local',  'admin', 'active', now()),          -- account address is spelled differently
  ('issue3802t-exowner@test.local', 'owner', 'revoked', now()),
  ('Issue3802T-BigOwner@Test.Local', 'owner', 'active', now());
insert into public.admin_users (email, role, status) values
  ('issue3802t-newowner@test.local', 'owner', 'invited'),
  ('issue3802t-unconfadm@test.local', 'admin', 'invited');
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('issue3802t-growth@test.local',    'growth',  'active', now()),
  ('issue3802t-partner@test.local',   'partner', 'active', now()),
  ('issue3802t-mixedauth@test.local', 'growth',  'active', now()),
  ('issue3802t-unconf2@test.local',   'partner', 'active', now());
insert into public.admin_team_members (email, role, status) values
  ('issue3802t-unconf@test.local', 'growth',  'invited'),
  ('issue3802t-inv@test.local',    'partner', 'invited');

create temp table t3802x_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- Run one statement as a caller; return its single text result, or
-- 'ERR:<sqlstate>:<message>'. p_claim_email overrides the address carried in
-- the request claims (the account row is untouched).
create function pg_temp.t3802x_as(p_who text, p_sql text, p_claim_email text default null) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'trusted') then
    select id, email into strict v_id, v_email from t3802x_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'trusted' then
      set local role postgres;
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', coalesce(p_claim_email, v_email, ''), true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id, 'email', coalesce(p_claim_email, v_email), 'role', 'authenticated')::text, true);
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

create function pg_temp.t3802x_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802x_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(p_got, '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3802x_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3802x_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(p_got, '<null>'), p_pattern));
end;
$fn$;

-- Everything a refused statement must leave alone: rows, grants, row-security
-- switches, policies and triggers of both membership tables.
create function pg_temp.t3802x_world() returns text
language sql as $fn$
  select md5(
       coalesce((select jsonb_agg(to_jsonb(a) order by a.email) from public.admin_users a), '[]'::jsonb)::text
    || coalesce((select jsonb_agg(to_jsonb(m) order by m.email) from public.admin_team_members m), '[]'::jsonb)::text
    || (select string_agg(c.relname || coalesce(c.relacl::text, '-') || c.relrowsecurity::text || c.relforcerowsecurity::text, ',' order by c.relname)
          from pg_class c where c.oid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass))
    || coalesce((select string_agg(p.polname || p.polcmd::text, ',' order by p.polname)
          from pg_policy p where p.polrelid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)), '')
    || coalesce((select string_agg(t.tgname || t.tgenabled::text, ',' order by t.tgname)
          from pg_trigger t where t.tgrelid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)
           and not t.tgisinternal), ''))
$fn$;

create function pg_temp.t3802x_audit() returns int
language sql as $fn$
  select count(*)::int from public.admin_audit_log where target_type = 'team_member'
$fn$;

-- Live memberships of one person, both tables, any spelling.
create function pg_temp.t3802x_live(p_email text) returns text
language sql as $fn$
  select coalesce(string_agg(x.t || ':' || x.r || ':' || x.s, ',' order by x.t), 'none')
  from (
    select 'full'::text as t, au.role as r, au.status as s
      from public.admin_users au
     where lower(btrim(au.email)) = lower(btrim(p_email)) and au.status <> 'revoked'
    union all
    select 'team', m.role, m.status
      from public.admin_team_members m
     where m.email = lower(btrim(p_email)) and m.status <> 'revoked'
  ) x
$fn$;

-- ---------------------------------------------------------------------------
-- X-1 — catalog shape.
-- ---------------------------------------------------------------------------
do $x1$
declare
  f record;
  v_owner oid;
begin
  select proowner into strict v_owner from pg_proc
   where oid = 'public.is_admin_user()'::regprocedure;

  for f in
    select * from (values
      ('public.admin_team_caller_email()',               true,  false),
      ('public.admin_team_role()',                       true,  true),
      ('public.admin_team_role_areas(text)',             false, true),
      ('public.admin_team_can(text)',                    false, true),
      ('public.admin_team_guard_exclusive()',            false, false),
      ('public.admin_team_my_access()',                  true,  true),
      ('public.admin_team_activate_self()',              true,  true),
      ('public.admin_team_list()',                       true,  true),
      ('public.admin_team_set_member(text,text,text)',   true,  true)
    ) as v(sig, want_definer, want_signed_in)
  loop
    perform pg_temp.t3802x_check('X-1', f.sig || ' resolves names against nothing',
      (select p.proconfig::text from pg_proc p where p.oid = f.sig::regprocedure), '{"search_path=\"\""}');
    perform pg_temp.t3802x_check('X-1', f.sig || ' runs as expected',
      (select p.prosecdef::text from pg_proc p where p.oid = f.sig::regprocedure), f.want_definer::text);
    perform pg_temp.t3802x_check('X-1', f.sig || ' has the same owner as is_admin_user()',
      (select (p.proowner = v_owner)::text from pg_proc p where p.oid = f.sig::regprocedure), 'true');
    perform pg_temp.t3802x_check('X-1', f.sig || ' is not executable by everyone',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = f.sig::regprocedure and a.grantee = 0), '0');
    perform pg_temp.t3802x_check('X-1', f.sig || ' has an explicit grant list',
      (select (p.proacl is not null)::text from pg_proc p where p.oid = f.sig::regprocedure), 'true');
    perform pg_temp.t3802x_check('X-1', f.sig || ' anonymous execute',
      has_function_privilege('anon', f.sig, 'EXECUTE')::text, 'false');
    perform pg_temp.t3802x_check('X-1', f.sig || ' signed-in execute',
      has_function_privilege('authenticated', f.sig, 'EXECUTE')::text, f.want_signed_in::text);
    -- Nobody outside the owner, the service role and (where intended) signed-in callers.
    perform pg_temp.t3802x_check('X-1', f.sig || ' grantees',
      (select string_agg(g.rolname, ',' order by g.rolname)
         from pg_proc p, aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
        where p.oid = f.sig::regprocedure and a.grantee <> p.proowner),
      case when f.want_signed_in then 'authenticated,service_role' else 'service_role' end);
  end loop;

  -- Table grants, read from the grant list itself so ANY grantee is seen.
  perform pg_temp.t3802x_check('X-1', 'team table: grantees other than its owner',
    (select string_agg(distinct g.rolname, ',' order by g.rolname)
       from pg_class c, aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
      where c.oid = 'public.admin_team_members'::regclass and a.grantee <> c.relowner), 'service_role');
  perform pg_temp.t3802x_check('X-1', 'team table: nothing granted to everyone',
    (select count(*)::text from pg_class c, aclexplode(c.relacl) a
      where c.oid = 'public.admin_team_members'::regclass and a.grantee = 0), '0');
  perform pg_temp.t3802x_check('X-1', 'full-admin table: holders of any write privilege other than its owner',
    (select string_agg(distinct g.rolname, ',' order by g.rolname)
       from pg_class c, aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
      where c.oid = 'public.admin_users'::regclass and a.grantee <> c.relowner
        and a.privilege_type <> 'SELECT'), 'service_role');
  perform pg_temp.t3802x_check('X-1', 'full-admin table: nothing granted to everyone',
    (select count(*)::text from pg_class c, aclexplode(c.relacl) a
      where c.oid = 'public.admin_users'::regclass and a.grantee = 0), '0');
  perform pg_temp.t3802x_check('X-1', 'no column-level grant on either table',
    (select count(*)::text from pg_attribute
      where attrelid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)
        and attacl is not null), '0');
  perform pg_temp.t3802x_check('X-1', 'full-admin table: exactly one policy, a read policy',
    (select string_agg(polcmd::text, ',') from pg_policy where polrelid = 'public.admin_users'::regclass), 'r');
  perform pg_temp.t3802x_check('X-1', 'both tables keep row security on',
    (select string_agg(relrowsecurity::text, ',') from pg_class
      where oid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)), 'true,true');
  perform pg_temp.t3802x_check('X-1', 'neither table is published to subscribers',
    (select count(*)::text from pg_publication_tables
      where schemaname = 'public' and tablename in ('admin_users', 'admin_team_members')), '0');
  perform pg_temp.t3802x_check('X-1', 'no publication covers every table',
    (select count(*)::text from pg_publication where puballtables), '0');
  perform pg_temp.t3802x_check('X-1', 'neither table has a foreign key OUT (no cascade can write them)',
    (select count(*)::text from pg_constraint
      where contype = 'f'
        and conrelid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)), '0');
  perform pg_temp.t3802x_check('X-1', 'no foreign key INTO either table deletes or rewrites on change',
    (select count(*)::text from pg_constraint
      where contype = 'f'
        and confrelid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)
        and (confdeltype = 'c' or confupdtype <> 'a')), '0');
  perform pg_temp.t3802x_check('X-1', 'triggers on the two tables',
    (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname || '/' || t.tgenabled::text, ',' order by t.tgname)
       from pg_trigger t
      where t.tgrelid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)
        and not t.tgisinternal),
    'admin_team_members.admin_team_members_guard_exclusive/O,admin_users.admin_users_guard_exclusive/O');
  perform pg_temp.t3802x_check('X-1', 'no rewrite rule on either table',
    (select count(*)::text from pg_rules where schemaname = 'public'
       and tablename in ('admin_users', 'admin_team_members')), '0');
  perform pg_temp.t3802x_check('X-1', 'no view is built on either table',
    (select count(distinct c.oid)::text
       from pg_rewrite r
       join pg_class c on c.oid = r.ev_class and c.relkind in ('v', 'm')
       join pg_depend d on d.objid = r.oid and d.classid = 'pg_rewrite'::regclass
      where d.refobjid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)), '0');

  -- Writers and readers, in EVERY schema (the implementor suite pins public only).
  perform pg_temp.t3802x_check('X-1', 'functions in any schema that write a membership table',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f', 'p') and n.nspname !~ '^pg_temp'
        and p.prosrc ~* '(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(only\s+)?(public\.)?"?(admin_users|admin_team_members)\M'),
    'public.activate_invited_admin,public.admin_team_activate_self,public.admin_team_set_member');
  perform pg_temp.t3802x_check('X-1', 'functions in any schema that mention the team table at all',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f', 'p') and n.nspname !~ '^pg_temp' and p.prosrc ~* 'admin_team_members'),
    -- [TEST-MOD-APPROVED #3720] Wave 6 adds two read-only membership checks:
    -- the shared active-member predicate and the guarded Data room audit RPC.
    'public.admin_team_activate_self,public.admin_team_directory,public.admin_team_guard_exclusive,public.admin_team_list,public.admin_team_my_access,public.admin_team_role,public.admin_team_set_member,public.issue_3720_active_team_member,public.issue_3720_log_data_room_access');
  perform pg_temp.t3802x_check('X-1', 'no function builds a statement on the full-admin table at run time',
    (select count(*)::text from pg_proc p
      where p.prokind in ('f', 'p') and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
        and p.prosrc ~* 'admin_users' and p.prosrc ~* '\mexecute\s+(format|''|\$)'
        and p.prosrc ~* '\mexecute\s+[^;]*admin_users'), '0');
  -- No existing gate was pointed at the new work: no policy, anywhere, reads it.
  perform pg_temp.t3802x_check('X-1', 'no policy anywhere reads the new team functions or table',
    (select count(*)::text from pg_policies
      where coalesce(qual, '') || coalesce(with_check, '') ~* 'admin_team_'), '0');
  perform pg_temp.t3802x_check('X-1', 'the full-admin role vocabulary is closed',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'admin_users_role_check'
       and conrelid = 'public.admin_users'::regclass),
    $c$CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text])))$c$);
end;
$x1$;

-- Issue #3802 amendment 1: activation now needs the invitation to have been opened. This harness opens it the moment a row becomes invited, so the assertions below keep testing membership mechanics.
-- (The invitation mechanics themselves are proven by
-- issue_3802_wave0_invite_binding.implementor.happy.pg17.test.sql.)
create function pg_temp.t3802x_open_invite() returns trigger
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
create trigger zz_t3802x_open_invite_full after insert or update on public.admin_users
  for each row execute function pg_temp.t3802x_open_invite();
create trigger zz_t3802x_open_invite_team after insert or update on public.admin_team_members
  for each row execute function pg_temp.t3802x_open_invite();
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

-- ---------------------------------------------------------------------------
-- X-2 — every direct statement, six callers including the owner, both tables.
-- A refusal must be the privilege refusal (42501): "it matched no rows" is not
-- accepted here, because that is what a leftover write privilege looks like.
-- ---------------------------------------------------------------------------
do $x2$
declare
  v_world text := pg_temp.t3802x_world();
  v_audit int := pg_temp.t3802x_audit();
  v_who text;
  v_tab text;
  s record;
  v_got text;
begin
  foreach v_who in array array['anon', 'consumer', 'growth', 'partner', 'admin', 'owner'] loop
    foreach v_tab in array array['public.admin_users', 'public.admin_team_members'] loop
      for s in
        select * from (values
          ('insert',               $q$insert into %s (email, role, status) values ('issue3802t-planted@test.local', 'admin', 'active')$q$),
          ('update role',          $q$update %s set role = 'owner'$q$),
          ('update status',        $q$update %s set status = 'active'$q$),
          ('update email',         $q$update %s set email = 'issue3802t-moved@test.local' where email = 'issue3802t-admin@test.local'$q$),
          ('delete',               $q$delete from %s$q$),
          ('truncate',             $q$truncate %s$q$),
          ('insert-or-update',     $q$insert into %s (email, role, status) values ('issue3802t-growth@test.local', 'admin', 'active') on conflict (email) do update set status = 'active'$q$),
          ('merge',                $q$merge into %s t using (select 1) s on true when matched then update set status = 'active'$q$),
          ('row lock',             $q$select 1 from %s for update$q$),
          ('table lock',           $q$lock table %s in exclusive mode$q$),
          ('switch triggers off',  $q$alter table %s disable trigger all$q$),
          ('add a policy',         $q$create policy issue3802t_open on %s for all using (true) with check (true)$q$),
          ('switch row security off', $q$alter table %s disable row level security$q$)
        ) as v(label, sql)
      loop
        v_got := pg_temp.t3802x_as(v_who, format(s.sql, v_tab));
        perform pg_temp.t3802x_like('X-2', v_who || ' / ' || v_tab || ' / ' || s.label, v_got, 'ERR:42501:%');
      end loop;
    end loop;
    perform pg_temp.t3802x_check('X-2', v_who || ': both tables, their grants, policies and triggers unchanged',
      (pg_temp.t3802x_world() = v_world)::text, 'true');
  end loop;
  -- Reading the team table directly is refused for everyone, the owner included.
  foreach v_who in array array['anon', 'consumer', 'growth', 'admin', 'owner'] loop
    perform pg_temp.t3802x_like('X-2', v_who || ': direct read of the team table',
      pg_temp.t3802x_as(v_who, $q$select count(*)::text from public.admin_team_members$q$), 'ERR:42501:%');
  end loop;
  -- The two internal helpers cannot be called by a client at all.
  foreach v_who in array array['anon', 'consumer', 'growth', 'admin', 'owner'] loop
    perform pg_temp.t3802x_like('X-2', v_who || ': internal identity helper',
      pg_temp.t3802x_as(v_who, $q$select public.admin_team_caller_email()$q$), 'ERR:42501:%');
  end loop;
  perform pg_temp.t3802x_check('X-2', 'no audit row from any refusal', pg_temp.t3802x_audit()::text, v_audit::text);
end;
$x2$;

-- A session-local table with the team table's name is never picked up by the
-- team functions (they resolve every name explicitly).
do $x2b$
declare
  v_got text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '38020000-0000-4000-9000-000000000005', true);
  begin
    create temp table admin_team_members (email text, role text, status text);
    insert into admin_team_members values ('issue3802t-consumer@test.local', 'growth', 'active');
    v_got := coalesce(public.admin_team_role(), '<none>') || '/' || coalesce(public.admin_team_my_access()::text, '<none>')
          || '/' || public.admin_team_can('admin_console')::text || '/' || public.admin_team_can('role_home')::text;
    drop table admin_team_members;
  exception when others then
    v_got := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform pg_temp.t3802x_check('X-2', 'a session-local look-alike of the team table is ignored', v_got, '<none>/<none>/false/false');
end;
$x2b$;

-- ---------------------------------------------------------------------------
-- X-3 — email spelling.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('38020000-0000-4000-9000-000000000020', 'issue3802t-legacy@test.local', now());
insert into t3802x_people values ('legacy', '38020000-0000-4000-9000-000000000020', 'issue3802t-legacy@test.local', true);
-- Rows spelled the way only a hand edit could have left them.
insert into public.admin_users (email, role, status, accepted_at) values
  ('Issue3802T-Legacy@Test.Local', 'admin', 'active', now()),
  (' issue3802t-pad@test.local ',  'admin', 'invited', null),
  ('issue3802t-other@test.local',  'admin', 'active', now());

do $x3$
declare
  r text;
  e text;
begin
  -- The team table refuses to store anything but the normal form.
  foreach e in array array[' issue3802t-n1@test.local', 'issue3802t-n1@test.local ', 'ISSUE3802T-N1@test.local', 'Issue3802t-n1@Test.Local', ''] loop
    perform pg_temp.t3802x_like('X-3', 'team table refuses non-normal form [' || e || ']',
      pg_temp.t3802x_as('trusted', format($q$with x as (insert into public.admin_team_members (email, role, status) values (%L, 'growth', 'invited') returning 1) select count(*)::text from x$q$, e)),
      'ERR:23514:%');
  end loop;
  perform pg_temp.t3802x_like('X-3', 'team table refuses a later respelling',
    pg_temp.t3802x_as('trusted', $q$with x as (update public.admin_team_members set email = 'Issue3802T-Growth@test.local' where email = 'issue3802t-growth@test.local' returning 1) select count(*)::text from x$q$),
    'ERR:23514:%');

  -- A live full-admin row in another spelling still blocks a team row.
  perform pg_temp.t3802x_like('X-3', 'mixed-case live full admin blocks a team row',
    pg_temp.t3802x_as('trusted', $q$with x as (insert into public.admin_team_members (email, role, status) values ('issue3802t-legacy@test.local', 'growth', 'invited') returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');
  perform pg_temp.t3802x_like('X-3', 'padded invited full admin blocks a team row',
    pg_temp.t3802x_as('trusted', $q$with x as (insert into public.admin_team_members (email, role, status) values ('issue3802t-pad@test.local', 'partner', 'active') returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');
  -- And a live team row blocks a full-admin row in any spelling, on insert,
  -- on revival and on a change of address.
  foreach e in array array['ISSUE3802T-GROWTH@test.local', ' issue3802t-growth@test.local', 'Issue3802T-Growth@Test.Local  '] loop
    perform pg_temp.t3802x_like('X-3', 'live team row blocks a full-admin row spelled [' || e || ']',
      pg_temp.t3802x_as('trusted', format($q$with x as (insert into public.admin_users (email, role, status) values (%L, 'admin', 'invited') returning 1) select count(*)::text from x$q$, e)),
      'ERR:23505:team_membership_conflict%');
  end loop;
  perform pg_temp.t3802x_like('X-3', 'a full-admin row cannot be re-addressed onto a live team member',
    pg_temp.t3802x_as('trusted', $q$with x as (update public.admin_users set email = 'Issue3802T-Partner@Test.Local' where email = 'issue3802t-other@test.local' returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');
  perform pg_temp.t3802x_check('X-3', 'a revoked full-admin row in another spelling is allowed beside a live team row',
    pg_temp.t3802x_as('trusted', $q$with x as (insert into public.admin_users (email, role, status) values ('Issue3802T-Partner@Test.Local', 'admin', 'revoked') returning 1) select count(*)::text from x$q$),
    '1');
  perform pg_temp.t3802x_like('X-3', '...and cannot be revived while the team row is live',
    pg_temp.t3802x_as('trusted', $q$with x as (update public.admin_users set status = 'active' where email = 'Issue3802T-Partner@Test.Local' returning 1) select count(*)::text from x$q$),
    'ERR:23505:team_membership_conflict%');

  -- The owner moves a mixed-case full admin to a team role, typing it a third way.
  r := pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('  ISSUE3802T-LEGACY@test.LOCAL ', 'growth', 'invited')::text$q$);
  perform pg_temp.t3802x_check('X-3', 'owner request is normalised and sees the mixed-case row',
    (r::jsonb - 'previous')::text || '|' || (r::jsonb -> 'previous')::text,
    '{"role": "growth", "email": "issue3802t-legacy@test.local", "status": "invited", "changed": true}|{"role": "admin", "status": "active"}');
  perform pg_temp.t3802x_check('X-3', 'exactly one live membership afterwards, in the team table',
    pg_temp.t3802x_live('issue3802t-legacy@test.local'), 'team:growth:invited');
  perform pg_temp.t3802x_check('X-3', 'the mixed-case full-admin row was revoked, not left live',
    (select status from public.admin_users where email = 'Issue3802T-Legacy@Test.Local'), 'revoked');
  perform pg_temp.t3802x_check('X-3', 'they are no longer a full admin',
    pg_temp.t3802x_as('legacy', $q$select public.is_admin_user()::text || '/' || coalesce(public.admin_team_role(), '<none>')$q$),
    'false/<none>');

  -- The caller's own account spelled in mixed case.
  perform pg_temp.t3802x_check('X-3', 'mixed-case account resolves to its team role, never to full admin',
    pg_temp.t3802x_as('mixedauth', $q$select public.admin_team_role() || '/' || public.is_admin_user()::text || '/' || public.admin_team_can('admin_console')::text$q$),
    'growth/false/false');
  perform pg_temp.t3802x_check('X-3', 'access payload carries the normal form',
    pg_temp.t3802x_as('mixedauth', $q$select public.admin_team_my_access()->>'email'$q$), 'issue3802t-mixedauth@test.local');
  -- A full-admin row and an account that differ only in spelling: the existing
  -- gate says no, so the new functions must say no as well (never yes).
  perform pg_temp.t3802x_check('X-3', 'spelling mismatch on a full-admin row grants nothing anywhere',
    pg_temp.t3802x_as('skew', $q$select public.is_admin_user()::text || '/' || coalesce(public.admin_team_role(), '<none>') || '/' || public.admin_team_can('admin_console')::text || '/' || public.admin_team_can('team_manage')::text || '/' || public.admin_team_can('role_home')::text$q$),
    'false/<none>/false/false/false');

  -- Addresses the owner-only writer must refuse outright.
  foreach e in array array[
    E'issue3802t-tab\t@test.local', E'issue3802t-nl@test.local\n', E'\tissue3802t-lead@test.local',
    'issue3802t two@test.local', 'issue3802t@@test.local', 'issue3802t@test', '@test.local',
    'issue3802t@', 'a@b@c.d', '   ', ''
  ] loop
    perform pg_temp.t3802x_check('X-3', 'owner request refuses malformed address #' || md5(e),
      pg_temp.t3802x_as('owner', format($q$select public.admin_team_set_member(%L, 'growth', 'invited')::text$q$, e)),
      'ERR:22023:invalid_email');
  end loop;
  perform pg_temp.t3802x_check('X-3', 'owner request refuses a missing address',
    pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member(null, 'growth', 'invited')::text$q$), 'ERR:22023:invalid_email');
  perform pg_temp.t3802x_check('X-3', 'owner request refuses a missing role',
    pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('issue3802t-x@test.local', null, 'invited')::text$q$), 'ERR:22023:invalid_role');
  perform pg_temp.t3802x_check('X-3', 'owner request refuses a missing status',
    pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('issue3802t-x@test.local', 'growth', null)::text$q$), 'ERR:22023:invalid_status');
  foreach e in array array['Owner', 'OWNER', ' owner', 'owner ', 'Admin', 'superadmin', 'growth,admin', ''] loop
    perform pg_temp.t3802x_check('X-3', 'owner request refuses role [' || e || ']',
      pg_temp.t3802x_as('owner', format($q$select public.admin_team_set_member('issue3802t-x@test.local', %L, 'invited')::text$q$, e)),
      'ERR:22023:invalid_role');
  end loop;
  perform pg_temp.t3802x_check('X-3', 'no email is live in both tables, in any spelling',
    (select count(*)::text
       from public.admin_users au
       join public.admin_team_members m on m.email = lower(btrim(au.email))
      where au.status <> 'revoked' and m.status <> 'revoked'), '0');
end;
$x3$;

-- ---------------------------------------------------------------------------
-- X-4 — whose invitation is it.
-- ---------------------------------------------------------------------------
do $x4$
declare
  v_world text := pg_temp.t3802x_world();
  v_audit int := pg_temp.t3802x_audit();
begin
  -- An account whose address was never confirmed.
  perform pg_temp.t3802x_check('X-4', 'unconfirmed account sees no invitation',
    pg_temp.t3802x_as('unconf', $q$select public.admin_team_my_access()::text$q$), null);
  perform pg_temp.t3802x_check('X-4', 'unconfirmed account cannot accept an invitation',
    pg_temp.t3802x_as('unconf', $q$select public.admin_team_activate_self()::text$q$), 'ERR:42501:not_authenticated');
  perform pg_temp.t3802x_check('X-4', 'unconfirmed account with a stored active team row still has no role',
    pg_temp.t3802x_as('unconf2', $q$select coalesce(public.admin_team_role(), '<none>') || '/' || public.admin_team_can('role_home')::text || '/' || coalesce(public.admin_team_my_access()::text, '<none>')$q$),
    '<none>/false/<none>');
  perform pg_temp.t3802x_check('X-4', 'unconfirmed invited full admin cannot accept through the new function',
    pg_temp.t3802x_as('unconfadm', $q$select public.admin_team_activate_self()::text$q$), 'ERR:42501:not_authenticated');
  perform pg_temp.t3802x_check('X-4', 'unconfirmed invited full admin sees no invitation',
    pg_temp.t3802x_as('unconfadm', $q$select public.admin_team_my_access()::text$q$), null);
  -- An account with no address at all.
  perform pg_temp.t3802x_check('X-4', 'account without an address has nothing',
    pg_temp.t3802x_as('nomail', $q$select coalesce(public.admin_team_role(), '<none>') || '/' || coalesce(public.admin_team_my_access()::text, '<none>')$q$),
    '<none>/<none>');
  perform pg_temp.t3802x_check('X-4', 'account without an address cannot accept anything',
    pg_temp.t3802x_as('nomail', $q$select public.admin_team_activate_self()::text$q$), 'ERR:42501:not_authenticated');

  -- Somebody else's address carried in the request claims. The new functions
  -- read the account, never the claim.
  perform pg_temp.t3802x_check('X-4', 'claimed address of an invited team member shows nothing',
    pg_temp.t3802x_as('consumer', $q$select public.admin_team_my_access()::text$q$, 'issue3802t-inv@test.local'), null);
  perform pg_temp.t3802x_check('X-4', 'claimed address of an invited team member accepts nothing',
    pg_temp.t3802x_as('consumer', $q$select public.admin_team_activate_self()::text$q$, 'issue3802t-inv@test.local'), null);
  perform pg_temp.t3802x_check('X-4', 'claimed address of an invited full admin accepts nothing',
    pg_temp.t3802x_as('consumer', $q$select public.admin_team_activate_self()::text$q$, 'issue3802t-unconfadm@test.local'), null);
  perform pg_temp.t3802x_check('X-4', 'claimed address of the owner gives no role',
    pg_temp.t3802x_as('consumer', $q$select coalesce(public.admin_team_role(), '<none>') || '/' || public.admin_team_can('team_manage')::text$q$, 'issue3802t-owner@test.local'),
    '<none>/false');
  perform pg_temp.t3802x_check('X-4', 'claimed address of the owner cannot write',
    pg_temp.t3802x_as('consumer', $q$select public.admin_team_set_member('issue3802t-consumer@test.local', 'admin', 'invited')::text$q$, 'issue3802t-owner@test.local'),
    'ERR:42501:forbidden');
  perform pg_temp.t3802x_check('X-4', 'claimed address of the owner cannot list',
    pg_temp.t3802x_as('consumer', $q$select count(*)::text from public.admin_team_list()$q$, 'issue3802t-owner@test.local'),
    'ERR:42501:forbidden');
  perform pg_temp.t3802x_check('X-4', 'an admin claiming the owner address is still an admin',
    pg_temp.t3802x_as('admin', $q$select public.admin_team_role() || '/' || public.admin_team_can('team_manage')::text$q$, 'issue3802t-owner@test.local'),
    'admin/false');
  perform pg_temp.t3802x_check('X-4', 'an admin claiming the owner address cannot write',
    pg_temp.t3802x_as('admin', $q$select public.admin_team_set_member('issue3802t-consumer@test.local', 'admin', 'invited')::text$q$, 'issue3802t-owner@test.local'),
    'ERR:42501:forbidden');

  -- The previous self-activation function never reaches the team table.
  perform pg_temp.t3802x_check('X-4', 'previous activation function called by an invited team member',
    coalesce(pg_temp.t3802x_as('inv', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802x_check('X-4', '...leaves their invitation pending',
    pg_temp.t3802x_live('issue3802t-inv@test.local'), 'team:partner:invited');
  perform pg_temp.t3802x_check('X-4', '...and gives them no full-admin answer',
    pg_temp.t3802x_as('inv', $q$select public.is_admin_user()::text$q$), 'false');

  perform pg_temp.t3802x_check('X-4', 'nothing changed in either table', (pg_temp.t3802x_world() = v_world)::text, 'true');
  perform pg_temp.t3802x_check('X-4', 'no audit row written', pg_temp.t3802x_audit()::text, v_audit::text);
end;
$x4$;

-- ---------------------------------------------------------------------------
-- X-5 — exhaustive walk. Every sequence of up to three requests about one
-- person who starts with no membership: the nine owner requests, the new
-- self-activation and the previous self-activation. Each sequence runs in its
-- own subtransaction and is undone. After EVERY step:
--
--   I1  at most one live membership across both tables
--   I2  nobody is 'active' unless that person accepted, themself, earlier in
--       the sequence (the owner alone can never switch a mailbox on)
--   I3  what the person can do is exactly what the tables say: a full-admin
--       answer if and only if an active full-admin row; a team role answers
--       no on every existing admin gate
--   I4  no owner row is ever created for them; the team table holds only the
--       two non-admin roles; the real owner's row never changes
--   I5  one audit row per change, none otherwise
--   I6  a refused or repeated request changes nothing
--   I7  rows are never deleted
--   I8  an existing-gate lookup done the way server code does it (by address
--       and active status in the full-admin table) agrees with I3
-- ---------------------------------------------------------------------------
create function pg_temp.t3802x_walk(p_seq text[]) returns jsonb
language plpgsql as $fn$
declare
  c_email constant text := 'issue3802t-fuzz@test.local';
  v_owner_row text;
  v_op text;
  v_parts text[];
  v_res text;
  v_snap_before text;
  v_snap_after text;
  v_live_before text;
  v_live_after text;
  v_audit_before int;
  v_audit_after int;
  v_rows_before int;
  v_rows_after int;
  v_accepted boolean := false;
  v_changed boolean;
  v_expect_audit int;
  v_view text;
  v_want_view text;
  v_viol text[] := '{}';
  v_reached text[] := '{}';
  v_steps int := 0;
  v_tag text;
begin
  select md5(to_jsonb(a)::text) into v_owner_row from public.admin_users a where a.email = 'issue3802t-owner@test.local';
  foreach v_op in array p_seq loop
    v_steps := v_steps + 1;
    v_tag := array_to_string(p_seq, ' > ') || ' @' || v_steps;
    select coalesce((select jsonb_agg(to_jsonb(a) order by a.email) from public.admin_users a where lower(btrim(a.email)) = c_email), '[]')::text
        || coalesce((select jsonb_agg(to_jsonb(m)) from public.admin_team_members m where m.email = c_email), '[]')::text
      into v_snap_before;
    v_live_before := pg_temp.t3802x_live(c_email);
    v_audit_before := pg_temp.t3802x_audit();
    select (select count(*) from public.admin_users a where lower(btrim(a.email)) = c_email)
         + (select count(*) from public.admin_team_members m where m.email = c_email) into v_rows_before;

    if v_op = 'A' then
      v_res := pg_temp.t3802x_as('fuzz', $q$select public.admin_team_activate_self()::text$q$);
    elsif v_op = 'L' then
      v_res := pg_temp.t3802x_as('fuzz', $q$select public.activate_invited_admin()::text$q$);
    else
      v_parts := string_to_array(v_op, ':');
      v_res := pg_temp.t3802x_as('owner',
        format($q$select public.admin_team_set_member(%L, %L, %L)::text$q$, c_email, v_parts[1], v_parts[2]));
    end if;

    select coalesce((select jsonb_agg(to_jsonb(a) order by a.email) from public.admin_users a where lower(btrim(a.email)) = c_email), '[]')::text
        || coalesce((select jsonb_agg(to_jsonb(m)) from public.admin_team_members m where m.email = c_email), '[]')::text
      into v_snap_after;
    v_live_after := pg_temp.t3802x_live(c_email);
    v_audit_after := pg_temp.t3802x_audit();
    select (select count(*) from public.admin_users a where lower(btrim(a.email)) = c_email)
         + (select count(*) from public.admin_team_members m where m.email = c_email) into v_rows_after;
    v_reached := v_reached || v_live_after;

    -- I1
    if position(',' in v_live_after) > 0 then
      v_viol := v_viol || ('I1 two live memberships [' || v_live_after || '] ' || v_tag);
    end if;
    -- I2
    if v_op in ('A', 'L') and v_live_before like '%:invited' and v_live_after like '%:active' then
      v_accepted := true;
    end if;
    if v_live_after like '%:active' and not v_accepted then
      v_viol := v_viol || ('I2 active without the person accepting [' || v_live_after || '] ' || v_tag);
    end if;
    if exists (select 1 from public.admin_users a where lower(btrim(a.email)) = c_email and a.status = 'active' and a.accepted_at is null)
       or exists (select 1 from public.admin_team_members m where m.email = c_email and m.status = 'active' and m.accepted_at is null) then
      v_viol := v_viol || ('I2 active row with no acceptance time ' || v_tag);
    end if;
    -- I3
    v_view := pg_temp.t3802x_as('fuzz', $q$select coalesce(public.admin_team_role(), '-') || '|' || public.is_admin_user()::text || '|' || public.admin_team_can('admin_console')::text || '|' || public.admin_team_can('team_manage')::text || '|' || public.admin_team_can('role_home')::text || '|' || coalesce(public.admin_team_my_access()->>'role', '-') || ':' || coalesce(public.admin_team_my_access()->>'status', '-') || ':' || coalesce(public.admin_team_my_access()->>'areas', '-')$q$);
    v_want_view := case
      when v_live_after = 'full:admin:active'   then 'admin|true|true|false|false|admin:active:["admin_console", "crm", "beta_leads"]'
      when v_live_after = 'full:admin:invited'  then '-|false|false|false|false|admin:invited:[]'
      when v_live_after = 'team:growth:active'  then 'growth|false|false|false|true|growth:active:["role_home", "crm", "beta_leads"]'
      when v_live_after = 'team:partner:active' then 'partner|false|false|false|true|partner:active:["role_home", "crm", "beta_leads"]'
      when v_live_after = 'team:growth:invited' then '-|false|false|false|false|growth:invited:[]'
      when v_live_after = 'team:partner:invited' then '-|false|false|false|false|partner:invited:[]'
      when v_live_after = 'none'                then '-|false|false|false|false|-:-:-'
      else '<unexpected live state ' || v_live_after || '>' end;
    if v_view is distinct from v_want_view then
      v_viol := v_viol || ('I3 access [' || coalesce(v_view, '<null>') || '] does not match stored state [' || v_live_after || '] ' || v_tag);
    end if;
    -- I4
    if exists (select 1 from public.admin_users a where lower(btrim(a.email)) = c_email and a.role <> 'admin')
       or exists (select 1 from public.admin_team_members m where m.role not in ('growth', 'partner')) then
      v_viol := v_viol || ('I4 role outside the allowed set ' || v_tag);
    end if;
    if (select md5(to_jsonb(a)::text) from public.admin_users a where a.email = 'issue3802t-owner@test.local') is distinct from v_owner_row then
      v_viol := v_viol || ('I4 the owner row changed ' || v_tag);
    end if;
    -- I5, I6
    v_changed := v_snap_after is distinct from v_snap_before;
    v_expect_audit := case
      when v_op = 'A' and v_changed then 1
      when v_op = 'L' then 0
      when v_op not in ('A', 'L') and v_res not like 'ERR:%' and (v_res::jsonb ->> 'changed') = 'true' then 1
      else 0 end;
    if v_audit_after - v_audit_before <> v_expect_audit then
      v_viol := v_viol || (format('I5 audit rows %s, expected %s ', v_audit_after - v_audit_before, v_expect_audit) || v_tag);
    end if;
    if v_op not in ('A', 'L') then
      if v_res like 'ERR:%' and v_changed then
        v_viol := v_viol || ('I6 a refused request changed rows [' || v_res || '] ' || v_tag);
      end if;
      if v_res not like 'ERR:%' and ((v_res::jsonb ->> 'changed') = 'true') is distinct from v_changed then
        v_viol := v_viol || ('I6 reported changed=' || (v_res::jsonb ->> 'changed') || ' but rows changed=' || v_changed::text || ' ' || v_tag);
      end if;
      if v_res like 'ERR:%' and v_res not in ('ERR:22023:never_activated', 'ERR:P0002:not_found') then
        v_viol := v_viol || ('I6 unexpected refusal [' || v_res || '] ' || v_tag);
      end if;
    end if;
    -- I7
    if v_rows_after < v_rows_before then
      v_viol := v_viol || ('I7 a row was deleted ' || v_tag);
    end if;
    -- I8
    if (v_live_after = 'full:admin:active') is distinct from
       exists (select 1 from public.admin_users a where a.email = c_email and a.status = 'active') then
      v_viol := v_viol || ('I8 server-style lookup disagrees ' || v_tag);
    end if;
  end loop;
  return jsonb_build_object('steps', v_steps, 'viol', to_jsonb(v_viol[1:3]), 'nviol', coalesce(array_length(v_viol, 1), 0),
                            'reached', to_jsonb(v_reached));
end;
$fn$;

do $x5$
declare
  ops constant text[] := array[
    'admin:invited', 'admin:active', 'admin:revoked',
    'growth:invited', 'growth:active', 'growth:revoked',
    'partner:invited', 'partner:active', 'partner:revoked',
    'A', 'L'];
  n constant int := 11;
  len int; i int; j int; k int;
  v_seq text[];
  v_out jsonb;
  v_seqs int := 0;
  v_steps int := 0;
  v_nviol int := 0;
  v_first text[] := '{}';
  v_reached text[] := '{}';
  v_world text := pg_temp.t3802x_world();
  s text;
begin
  for len in 1..3 loop
    for i in 1..n loop
      for j in 1..(case when len >= 2 then n else 1 end) loop
        for k in 1..(case when len >= 3 then n else 1 end) loop
          v_seq := case len when 1 then array[ops[i]] when 2 then array[ops[i], ops[j]] else array[ops[i], ops[j], ops[k]] end;
          begin
            v_out := pg_temp.t3802x_walk(v_seq);
            raise exception 'undo this sequence' using errcode = 'T3802';
          exception when sqlstate 'T3802' then
            null;
          end;
          v_seqs := v_seqs + 1;
          v_steps := v_steps + (v_out ->> 'steps')::int;
          v_nviol := v_nviol + (v_out ->> 'nviol')::int;
          if coalesce(array_length(v_first, 1), 0) < 12 then
            v_first := v_first || array(select jsonb_array_elements_text(v_out -> 'viol'));
          end if;
          v_reached := array(select distinct x from unnest(v_reached || array(select jsonb_array_elements_text(v_out -> 'reached'))) x);
        end loop;
      end loop;
    end loop;
  end loop;

  perform pg_temp.t3802x_check('X-5', 'sequences walked', v_seqs::text, '1463');
  perform pg_temp.t3802x_check('X-5', 'steps walked', v_steps::text, '4246');
  perform pg_temp.t3802x_check('X-5', 'invariant violations: ' || coalesce(array_to_string(v_first[1:12], ' || '), ''), v_nviol::text, '0');
  -- The walk is not vacuous: every membership state was reached.
  foreach s in array array['none', 'full:admin:invited', 'full:admin:active', 'team:growth:invited', 'team:growth:active', 'team:partner:invited', 'team:partner:active'] loop
    perform pg_temp.t3802x_check('X-5', 'state reached: ' || s, (s = any (v_reached))::text, 'true');
  end loop;
  perform pg_temp.t3802x_check('X-5', 'no other state was ever reached',
    (select count(*)::text from unnest(v_reached) x
      where x not in ('none', 'full:admin:invited', 'full:admin:active', 'team:growth:invited', 'team:growth:active', 'team:partner:invited', 'team:partner:active')), '0');
  perform pg_temp.t3802x_check('X-5', 'every sequence was undone', (pg_temp.t3802x_world() = v_world)::text, 'true');
end;
$x5$;

-- ---------------------------------------------------------------------------
-- X-6 — the owner gate.
-- ---------------------------------------------------------------------------
do $x6$
declare
  v_world text := pg_temp.t3802x_world();
  v_audit int := pg_temp.t3802x_audit();
  v_who text;
  v_role text;
  v_status text;
  v_target text;
begin
  -- A former owner and an owner who has not accepted yet are not the owner.
  foreach v_who in array array['exowner', 'newowner'] loop
    perform pg_temp.t3802x_check('X-6', v_who || ': no owner role',
      pg_temp.t3802x_as(v_who, $q$select coalesce(public.admin_team_role(), '<none>') || '/' || public.admin_team_can('team_manage')::text || '/' || public.is_admin_user()::text$q$),
      '<none>/false/false');
    perform pg_temp.t3802x_check('X-6', v_who || ': cannot write',
      pg_temp.t3802x_as(v_who, $q$select public.admin_team_set_member('issue3802t-consumer@test.local', 'admin', 'invited')::text$q$), 'ERR:42501:forbidden');
    perform pg_temp.t3802x_check('X-6', v_who || ': cannot list',
      pg_temp.t3802x_as(v_who, $q$select count(*)::text from public.admin_team_list()$q$), 'ERR:42501:forbidden');
  end loop;
  -- An invited owner row is never opened by the new activation into an owner
  -- who can then be changed by someone else; and nobody can touch that row.
  foreach v_target in array array['issue3802t-exowner@test.local', 'issue3802t-newowner@test.local', ' ISSUE3802T-BIGOWNER@test.local', 'issue3802t-bigowner@test.local'] loop
    foreach v_status in array array['invited', 'active', 'revoked'] loop
      perform pg_temp.t3802x_check('X-6', 'owner row [' || v_target || '] cannot be set to growth/' || v_status,
        pg_temp.t3802x_as('owner', format($q$select public.admin_team_set_member(%L, 'growth', %L)::text$q$, v_target, v_status)),
        'ERR:42501:cannot_change_owner');
    end loop;
  end loop;

  -- An owner stored in mixed case is still the owner, and still cannot change
  -- or remove themself however the address is typed.
  perform pg_temp.t3802x_check('X-6', 'mixed-case owner resolves to owner',
    pg_temp.t3802x_as('bigowner', $q$select public.admin_team_role() || '/' || public.admin_team_can('team_manage')::text$q$), 'owner/true');
  foreach v_target in array array['Issue3802T-BigOwner@Test.Local', 'issue3802t-bigowner@test.local', '  ISSUE3802T-BIGOWNER@TEST.LOCAL  '] loop
    foreach v_role in array array['admin', 'growth', 'partner'] loop
      foreach v_status in array array['invited', 'active', 'revoked'] loop
        perform pg_temp.t3802x_check('X-6', 'mixed-case owner cannot set self [' || v_target || '] to ' || v_role || '/' || v_status,
          pg_temp.t3802x_as('bigowner', format($q$select public.admin_team_set_member(%L, %L, %L)::text$q$, v_target, v_role, v_status)),
          'ERR:42501:cannot_change_self');
      end loop;
    end loop;
  end loop;
  -- The owner tries every request on themself and on the other owner.
  foreach v_role in array array['admin', 'growth', 'partner'] loop
    foreach v_status in array array['invited', 'active', 'revoked'] loop
      perform pg_temp.t3802x_check('X-6', 'owner cannot set self to ' || v_role || '/' || v_status,
        pg_temp.t3802x_as('owner', format($q$select public.admin_team_set_member('issue3802t-owner@test.local', %L, %L)::text$q$, v_role, v_status)),
        'ERR:42501:cannot_change_self');
    end loop;
  end loop;

  -- An admin (not the owner) calls every new function.
  perform pg_temp.t3802x_check('X-6', 'admin: role and areas',
    pg_temp.t3802x_as('admin', $q$select public.admin_team_role() || '/' || public.admin_team_can('admin_console')::text || '/' || public.admin_team_can('team_manage')::text || '/' || public.admin_team_can('role_home')::text$q$),
    'admin/true/false/false');
  perform pg_temp.t3802x_check('X-6', 'admin: self-activation returns their own access and changes nothing',
    (pg_temp.t3802x_as('admin', $q$select public.admin_team_activate_self()::text$q$)::jsonb ->> 'role'), 'admin');
  perform pg_temp.t3802x_check('X-6', 'admin: roster refused',
    pg_temp.t3802x_as('admin', $q$select count(*)::text from public.admin_team_list()$q$), 'ERR:42501:forbidden');
  foreach v_target in array array['issue3802t-admin@test.local', 'issue3802t-owner@test.local', 'issue3802t-growth@test.local', 'issue3802t-consumer@test.local', 'issue3802t-inv@test.local'] loop
    foreach v_role in array array['owner', 'admin', 'growth', 'partner'] loop
      foreach v_status in array array['invited', 'active', 'revoked'] loop
        perform pg_temp.t3802x_check('X-6', 'admin cannot set ' || v_target || ' to ' || v_role || '/' || v_status,
          pg_temp.t3802x_as('admin', format($q$select public.admin_team_set_member(%L, %L, %L)::text$q$, v_target, v_role, v_status)),
          'ERR:42501:forbidden');
      end loop;
    end loop;
  end loop;
  -- A team member tries to lift themself or a colleague.
  foreach v_who in array array['growth', 'partner'] loop
    foreach v_role in array array['owner', 'admin', 'growth', 'partner'] loop
      perform pg_temp.t3802x_check('X-6', v_who || ' cannot set self to ' || v_role,
        pg_temp.t3802x_as(v_who, format($q$select public.admin_team_set_member('issue3802t-%s@test.local', %L, 'active')::text$q$, v_who, v_role)),
        'ERR:42501:forbidden');
    end loop;
    perform pg_temp.t3802x_check('X-6', v_who || ': self-activation returns their own access and changes nothing',
      (pg_temp.t3802x_as(v_who, $q$select public.admin_team_activate_self()::text$q$)::jsonb ->> 'role'), v_who);
  end loop;

  perform pg_temp.t3802x_check('X-6', 'nothing changed in either table', (pg_temp.t3802x_world() = v_world)::text, 'true');
  perform pg_temp.t3802x_check('X-6', 'no audit row written', pg_temp.t3802x_audit()::text, v_audit::text);
end;
$x6$;

-- ---------------------------------------------------------------------------
-- X-7 — every table whose policy reads the full-admin table still answers.
-- A reader may be refused some other table (as before this change); a refusal
-- that names a membership table would mean its SELECT was taken away.
-- ---------------------------------------------------------------------------
do $x7$
declare
  t record;
  v_who text;
  v_got text;
  v_n int := 0;
begin
  for t in
    select distinct schemaname, tablename
      from pg_policies
     where coalesce(qual, '') || coalesce(with_check, '') ~* '\madmin_users\M'
       and not (schemaname = 'public' and tablename = 'admin_users')
     order by 1, 2
  loop
    v_n := v_n + 1;
    foreach v_who in array array['anon', 'consumer', 'growth'] loop
      v_got := pg_temp.t3802x_as(v_who, format('select count(*)::text from %I.%I', t.schemaname, t.tablename));
      insert into t3802x_results (test, label, ok, detail)
      values ('X-7', v_who || ' reads ' || t.schemaname || '.' || t.tablename,
              v_got ~ '^[0-9]+$'
              or (v_got like 'ERR:42501:permission denied for table %'
                  and v_got !~ 'admin_users|admin_team_members'),
              'got ' || coalesce(v_got, '<null>'));
    end loop;
  end loop;
  perform pg_temp.t3802x_check('X-7', 'the sweep covered at least twenty tables', (v_n >= 20)::text, 'true');
  foreach v_who in array array['anon', 'authenticated'] loop
    perform pg_temp.t3802x_check('X-7', v_who || ' still holds SELECT on the full-admin table',
      has_table_privilege(v_who, 'public.admin_users', 'SELECT')::text, 'true');
  end loop;
  perform pg_temp.t3802x_check('X-7', 'anonymous direct read answers with no rows',
    pg_temp.t3802x_as('anon', $q$select count(*)::text from public.admin_users$q$), '0');
  perform pg_temp.t3802x_check('X-7', 'team member direct read answers with no rows',
    pg_temp.t3802x_as('growth', $q$select count(*)::text from public.admin_users$q$), '0');
  -- The inline form existing policies use, evaluated as each caller.
  foreach v_who in array array['growth', 'partner', 'consumer', 'unconf2'] loop
    perform pg_temp.t3802x_check('X-7', v_who || ': inline full-admin lookup is false',
      pg_temp.t3802x_as(v_who, $q$select exists (select 1 from public.admin_users au where lower(au.email) = lower(current_setting('request.jwt.claim.email', true)) and au.status = 'active')::text$q$),
      'false');
  end loop;
  perform pg_temp.t3802x_check('X-7', 'control: the same lookup is true for an admin',
    pg_temp.t3802x_as('admin', $q$select exists (select 1 from public.admin_users au where lower(au.email) = lower(current_setting('request.jwt.claim.email', true)) and au.status = 'active')::text$q$),
    'true');
end;
$x7$;

-- ---------------------------------------------------------------------------
-- X-8 — removed everywhere, then invited again.
-- ---------------------------------------------------------------------------
do $x8$
declare
  r text;
  v_world text;
  v_audit int;
begin
  -- Through the product path: growth, accepted, promoted, then removed.
  r := pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('issue3802t-comeback@test.local', 'growth', 'invited')->>'changed'$q$);
  r := r || pg_temp.t3802x_as('comeback', $q$select public.admin_team_activate_self()->>'status'$q$);
  r := r || pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('issue3802t-comeback@test.local', 'admin', 'active')->>'changed'$q$);
  r := r || pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('issue3802t-comeback@test.local', 'admin', 'revoked')->>'changed'$q$);
  perform pg_temp.t3802x_check('X-8', 'setup: invited, accepted, promoted, removed', r, 'trueactivetruetrue');
  perform pg_temp.t3802x_check('X-8', 'they hold a revoked row in BOTH tables',
    (select status from public.admin_users where email = 'issue3802t-comeback@test.local') || '/' ||
    (select status from public.admin_team_members where email = 'issue3802t-comeback@test.local'), 'revoked/revoked');

  -- A removed person cannot let themself back in by any function.
  v_world := pg_temp.t3802x_world();
  v_audit := pg_temp.t3802x_audit();
  perform pg_temp.t3802x_check('X-8', 'removed person: no role, no access, no existing-gate answer',
    pg_temp.t3802x_as('comeback', $q$select coalesce(public.admin_team_role(), '<none>') || '/' || coalesce(public.admin_team_my_access()::text, '<none>') || '/' || public.is_admin_user()::text$q$),
    '<none>/<none>/false');
  perform pg_temp.t3802x_check('X-8', 'removed person: self-activation gives nothing',
    pg_temp.t3802x_as('comeback', $q$select public.admin_team_activate_self()::text$q$), null);
  perform pg_temp.t3802x_check('X-8', 'removed person: previous activation function gives nothing',
    coalesce(pg_temp.t3802x_as('comeback', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802x_check('X-8', 'removed person: cannot write',
    pg_temp.t3802x_as('comeback', $q$select public.admin_team_set_member('issue3802t-comeback@test.local', 'admin', 'active')::text$q$), 'ERR:42501:forbidden');
  perform pg_temp.t3802x_check('X-8', 'removed person: nothing changed', (pg_temp.t3802x_world() = v_world)::text, 'true');
  perform pg_temp.t3802x_check('X-8', 'removed person: no audit row', pg_temp.t3802x_audit()::text, v_audit::text);

  -- Invited again in the other role.
  r := pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('issue3802t-comeback@test.local', 'partner', 'invited')::text$q$);
  perform pg_temp.t3802x_check('X-8', 'invite again reports the role they last held',
    (r::jsonb -> 'previous')::text || '/' || (r::jsonb ->> 'changed'), '{"role": "admin", "status": "revoked"}/true');
  perform pg_temp.t3802x_check('X-8', 'one live membership: an invitation',
    pg_temp.t3802x_live('issue3802t-comeback@test.local'), 'team:partner:invited');
  perform pg_temp.t3802x_check('X-8', 'the new invitation carries no old acceptance',
    (select (accepted_at is null)::text from public.admin_team_members where email = 'issue3802t-comeback@test.local'), 'true');
  perform pg_temp.t3802x_check('X-8', 'the owner cannot switch the fresh invitation on for them',
    pg_temp.t3802x_as('owner', $q$select public.admin_team_set_member('issue3802t-comeback@test.local', 'partner', 'active')::text$q$), 'ERR:22023:never_activated');
  perform pg_temp.t3802x_check('X-8', 'invited again: shown the invitation, no areas, no role',
    pg_temp.t3802x_as('comeback', $q$select (public.admin_team_my_access()->>'role') || '/' || (public.admin_team_my_access()->>'status') || '/' || (public.admin_team_my_access()->>'areas') || '/' || coalesce(public.admin_team_role(), '<none>')$q$),
    'partner/invited/[]/<none>');
  perform pg_temp.t3802x_check('X-8', 'they accept and are a partner, not a full admin',
    pg_temp.t3802x_as('comeback', $q$select (public.admin_team_activate_self()->>'role') || '/' || public.is_admin_user()::text$q$), 'partner/false');
  perform pg_temp.t3802x_check('X-8', 'their old full-admin row stays revoked',
    (select status from public.admin_users where email = 'issue3802t-comeback@test.local'), 'revoked');
  perform pg_temp.t3802x_check('X-8', 'the roster shows them once, as a partner',
    pg_temp.t3802x_as('owner', $q$select string_agg(role || '/' || status, ',') from public.admin_team_list() where email = 'issue3802t-comeback@test.local'$q$),
    'partner/active');
end;
$x8$;

-- ---------------------------------------------------------------------------
-- Verdict for part X.
-- ---------------------------------------------------------------------------
do $verdict$
declare
  v_total int;
  v_failed int;
  v_tests text;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802x_results;
  if v_total < 572 then
    raise exception 'ISSUE-3802 TESTER FAIL: only % checks ran; the suite did not execute fully', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from t3802x_results where not ok order by seq limit 60 loop
      raise warning 'ISSUE-3802 TESTER FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    select string_agg(distinct test, ', ' order by test) into v_tests from t3802x_results where not ok;
    raise exception 'ISSUE-3802 TESTER FAIL: % of % checks failed in: %', v_failed, v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 TESTER PASS (part X): % checks across X-1..X-8, 0 failed', v_total;
end;
$verdict$;

rollback;

-- ===========================================================================
-- PART R — real concurrency. Fixtures are committed and removed by id.
-- ===========================================================================
create schema t3802x_race;
select count(*) = 0 as t3802x_made_dblink from pg_extension where extname = 'dblink' \gset
create extension if not exists dblink with schema t3802x_race;
select n.nspname as t3802x_dblink_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'dblink' \gset
set search_path = public, :"t3802x_dblink_schema";
select set_config('t3802x.conn',
  format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s',
         current_setting('port'), current_database(), current_user, :'t3802x_pw'), false) is not null as conn_ready;

create table t3802x_race.results (seq serial primary key, label text, ok boolean, detail text);

-- Leftovers from an interrupted earlier run, then the fixtures. Triggers off:
-- no side rows are created, and none are left behind.
begin;
set local session_replication_role = replica;
delete from public.admin_audit_log where target_type = 'team_member' and target_id like 'issue3802t-race-%';
delete from public.admin_team_members where email like 'issue3802t-race-%';
delete from public.admin_users where lower(email) like 'issue3802t-race-%';
delete from auth.users where id = '38020000-0000-4000-a000-000000000001';
insert into auth.users (id, email) values ('38020000-0000-4000-a000-000000000001', 'issue3802t-race-owner@test.local');
insert into public.admin_users (email, role, status, accepted_at)
  values ('issue3802t-race-owner@test.local', 'owner', 'active', now());
commit;

do $race$
declare
  c_conn constant text := current_setting('t3802x.conn');
  c_owner constant text := '38020000-0000-4000-a000-000000000001';
  v_c text;
  v_pid int;
  v_waited boolean;
  v_r1 text;
  v_r2 text;
  i int;
  v_case record;
begin
  for v_case in
    select * from (values
      -- label, target as typed by session 1, request 1, target as typed by session 2, request 2
      ('R-1', ' Issue3802T-Race-A@Test.Local ', 'growth', 'invited', 'issue3802t-race-a@test.local', 'admin',  'invited'),
      ('R-2', 'issue3802t-race-b@test.local',   'partner', 'invited', 'ISSUE3802T-RACE-B@test.local', 'partner', 'invited')
    ) as v(label, e1, role1, status1, e2, role2, status2)
  loop
    begin
      foreach v_c in array array['t3802x_c1', 't3802x_c2'] loop
        perform dblink_connect(v_c, c_conn);
        perform dblink_exec(v_c, 'begin');
        perform * from dblink(v_c, format(
          $q$select set_config('request.jwt.claim.sub', %L, true), set_config('request.jwt.claims', %L, true)$q$,
          c_owner, json_build_object('sub', c_owner, 'email', 'issue3802t-race-owner@test.local', 'role', 'authenticated')::text))
          as t(a text, b text);
        perform dblink_exec(v_c, 'set local role authenticated');
      end loop;

      -- Session 1 makes its request and does NOT commit.
      select x into v_r1 from dblink('t3802x_c1',
        format($q$select public.admin_team_set_member(%L, %L, %L)::text$q$, v_case.e1, v_case.role1, v_case.status1)) as t(x text);
      insert into t3802x_race.results (label, ok, detail)
      values (v_case.label || ' first request applies', (v_r1::jsonb ->> 'changed') = 'true', v_r1);

      -- Session 2 makes its request while the first is still open.
      select x into v_pid from dblink('t3802x_c2', 'select pg_backend_pid()') as t(x int);
      perform dblink_send_query('t3802x_c2',
        format($q$select public.admin_team_set_member(%L, %L, %L)::text$q$, v_case.e2, v_case.role2, v_case.status2));
      v_waited := false;
      for i in 1..200 loop
        select exists (select 1 from pg_locks l where l.pid = v_pid and not l.granted) into v_waited;
        exit when v_waited or dblink_is_busy('t3802x_c2') = 0;
        perform pg_sleep(0.05);
      end loop;
      insert into t3802x_race.results (label, ok, detail)
      values (v_case.label || ' second request waits for the first', v_waited, 'waited=' || v_waited::text);
      insert into t3802x_race.results (label, ok, detail)
      values (v_case.label || ' nothing is visible before the first commits',
              not exists (select 1 from public.admin_team_members where email like 'issue3802t-race-' || lower(right(v_case.label, 1)) || '%')
              and not exists (select 1 from public.admin_users where lower(email) like 'issue3802t-race-' || lower(right(v_case.label, 1)) || '%'), '');

      perform dblink_exec('t3802x_c1', 'commit');
      select x into v_r2 from dblink_get_result('t3802x_c2', false) as t(x text);
      perform * from dblink_get_result('t3802x_c2', false) as t(x text);
      perform dblink_exec('t3802x_c2', 'commit');

      if v_case.label = 'R-1' then
        insert into t3802x_race.results (label, ok, detail)
        values ('R-1 second request saw what the first wrote',
                coalesce((v_r2::jsonb -> 'previous')::text = '{"role": "growth", "status": "invited"}' and (v_r2::jsonb ->> 'changed') = 'true', false),
                coalesce(v_r2, '<no result>'));
        insert into t3802x_race.results (label, ok, detail)
        select 'R-1 exactly one live membership afterwards', x = 'full:admin:invited', x
          from (select coalesce(string_agg(s, ',' order by s), 'none') as x from (
                  select 'full:' || role || ':' || status as s from public.admin_users
                   where lower(btrim(email)) = 'issue3802t-race-a@test.local' and status <> 'revoked'
                  union all
                  select 'team:' || role || ':' || status from public.admin_team_members
                   where email = 'issue3802t-race-a@test.local' and status <> 'revoked') q) y;
        insert into t3802x_race.results (label, ok, detail)
        select 'R-1 two audit rows, an invite then a role change', x = 'team.invite,team.role_change', coalesce(x, '<none>')
          from (select string_agg(action, ',' order by created_at, action) as x from public.admin_audit_log
                 where target_type = 'team_member' and target_id = 'issue3802t-race-a@test.local') y;
      else
        insert into t3802x_race.results (label, ok, detail)
        values ('R-2 the duplicate request changes nothing',
                coalesce((v_r2::jsonb ->> 'changed') = 'false', false), coalesce(v_r2, '<no result>'));
        insert into t3802x_race.results (label, ok, detail)
        select 'R-2 one row, one invitation', x = '1/invited/0', x
          from (select (select count(*) from public.admin_team_members where email = 'issue3802t-race-b@test.local')::text
                    || '/' || coalesce((select status from public.admin_team_members where email = 'issue3802t-race-b@test.local'), '-')
                    || '/' || (select count(*) from public.admin_users where lower(btrim(email)) = 'issue3802t-race-b@test.local')::text as x) y;
        insert into t3802x_race.results (label, ok, detail)
        select 'R-2 exactly one audit row', x = '1', x
          from (select count(*)::text as x from public.admin_audit_log
                 where target_type = 'team_member' and target_id = 'issue3802t-race-b@test.local') y;
      end if;
    exception when others then
      insert into t3802x_race.results (label, ok, detail)
      values (v_case.label || ' ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
    end;
    foreach v_c in array array['t3802x_c1', 't3802x_c2'] loop
      if v_c = any (coalesce(dblink_get_connections(), '{}')) then
        perform dblink_disconnect(v_c);
      end if;
    end loop;
  end loop;
end;
$race$;

select count(*) as t3802x_race_total,
       count(*) filter (where not ok) as t3802x_race_failed,
       coalesce(string_agg(label || ' [' || coalesce(detail, '') || ']', '; ' order by seq) filter (where not ok), 'none') as t3802x_race_failures
  from t3802x_race.results \gset

-- Remove every fixture by id, whatever the verdict.
begin;
set local session_replication_role = replica;
delete from public.admin_audit_log where target_type = 'team_member' and target_id like 'issue3802t-race-%';
delete from public.admin_team_members where email like 'issue3802t-race-%';
delete from public.admin_users where lower(email) like 'issue3802t-race-%';
delete from auth.users where id = '38020000-0000-4000-a000-000000000001';
commit;
reset search_path;
\if :t3802x_made_dblink
drop extension if exists dblink;
\endif
drop schema t3802x_race cascade;

select (:t3802x_race_total < 12 or :t3802x_race_failed > 0) as t3802x_race_bad \gset
\if :t3802x_race_bad
  \echo 'ISSUE-3802 TESTER FAILED (part R):' :t3802x_race_failures
  do $$ begin raise exception 'ISSUE-3802 TESTER FAIL: concurrency checks failed or did not run'; end $$;
\endif
\echo 'ISSUE-3802 TESTER PASS (part R):' :t3802x_race_total 'concurrency checks, 0 failed'
