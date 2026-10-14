-- Issue #3802 (Wave 4, second part) -- one-time setup codes, the tools an
-- agent uses to add and change, Experience host, searchable identifiers and
-- the contact rule, on the fully replayed PG17 schema.
--
-- What it proves:
--   B-1   catalog: who may run each new function, the two new tables are
--         closed, the counts, and is_admin_user() is unchanged
--   B-2   a setup code: made by a person, stored as a digest, used once, for
--         its maker's key only; every refusal is one answer; the hourly limit
--   B-3   Experience host, and the lead type that maps to it
--   B-4   the normal form of an identifier (the table the admin web's twin is
--         held to), the cleaner, and duplicate detection by identifier
--   B-5   the contact rule: set, carried by every shape, lifted by a person,
--         never lifted or loosened by an agent
--   B-6   what an agent may log, as a truth table of 36 cases
--   B-7   add_records: 50 items in the caller's order, a repeat changes nothing
--   B-8   move_stage, set_owners, update_records, log_activity, record_reply,
--         upsert_record, check_contactable, find_records by identifier
--   B-9   request keys never replay across tools; one refused item never
--         stops the rest; a fault on the server saves nothing
--   B-10  the daily limit on records written
--   B-11  both self-check blocks pass as shipped and object to mistakes
-- Part 2 opens real sessions: two uses of one code at once, the first touch
-- logged twice at once, the same identifier added twice at once, and a
-- request that waits for its key's turn.
--
-- Run from the repository root as `supabase_admin` (it reads the migration
-- file and adds the sign-in columns this image lacks, removing them again).
-- Every key and code here is made at run time and never leaves this run.
-- Checks are RECORDED and reported together.

\set ON_ERROR_STOP on
\getenv t3802b_pw PGPASSWORD
\set t3802b_check `sed -n '/^DO \$check\$/,/^\$check\$;/p' supabase/migrations/20270831003802_issue_3802_wave4_agent_write_setup.sql`
\set t3802b_w4check `sed -n '/^DO \$w4check\$/,/^\$w4check\$;/p' supabase/migrations/20270831003802_issue_3802_wave4_agent_write_setup.sql`
\set t3802b_file `cat supabase/migrations/20270831003802_issue_3802_wave4_agent_write_setup.sql`

-- ===========================================================================
-- PART 1 -- one transaction, rolled back.
-- ===========================================================================
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  identity_data jsonb
);

create temp table t3802b_src (k text primary key, sql text) on commit drop;
insert into t3802b_src values ('check', :'t3802b_check'), ('w4check', :'t3802b_w4check'), ('file', :'t3802b_file');

create temp table t3802b_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802b_people (who, id, email) values
  ('owner',   '38020000-0000-4000-b000-000000000001', 'issue3802b-owner@test.local'),
  ('admin',   '38020000-0000-4000-b000-000000000002', 'issue3802b-admin@test.local'),
  ('growth',  '38020000-0000-4000-b000-000000000003', 'issue3802b-growth@test.local'),
  ('partner', '38020000-0000-4000-b000-000000000004', 'issue3802b-partner@test.local'),
  ('growth2', '38020000-0000-4000-b000-000000000005', 'issue3802b-growth2@test.local'),
  ('social',  '38020000-0000-4000-b000-000000000006', 'issue3802b-social@test.local'),
  ('leaver',  '38020000-0000-4000-b000-000000000007', 'issue3802b-leaver@test.local'),
  ('nobody',  '38020000-0000-4000-b000-000000000008', 'issue3802b-nobody@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3802b_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802b-owner@test.local', 'owner', 'active', now()),
  ('issue3802b-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
select email, case who when 'partner' then 'partner' else 'growth' end, 'active', now()
from t3802b_people where who in ('growth', 'partner', 'growth2', 'social', 'leaver');

set local session_replication_role = replica;
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, is_live_for_consumers) values
  ('38020000-0000-4000-b200-000000000001', 'issue3802b-raleigh', 'Issue3802b Raleigh', 'United States', 'US', 35.7, -78.6, 35.6, -78.7, 35.8, -78.5, true);
insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source) values
  ('38020000-0000-4000-b400-000000000001', array['experience_tour'], 'Issue3802b Tour One', 'Lead One', 'Nowhere', 'Issue3802b-Lead1@Test.Local', true, 'organiser_marketing'),
  ('38020000-0000-4000-b400-000000000002', array['restaurant'], 'Issue3802b Other Name', 'Lead Two', 'Nowhere', 'Issue3802b-Lead2@test.local', true, 'organiser_marketing');
set local session_replication_role = origin;

create temp table t3802b_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3802b_ids (k text primary key, v text) on commit drop;

-- Run one statement as a caller; its single text result, or
-- 'ERR:<sqlstate>:<message>'. A raised statement leaves nothing behind.
create function pg_temp.t3802b_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3802b_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    perform set_config('request.jwt.claim.role', '', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.t3802b_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802b_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3802b_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3802b_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 400), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3802b_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3802b_id(p_k text) returns text
language sql as $fn$ select v from t3802b_ids where k = p_k $fn$;

create function pg_temp.t3802b_keep(p_k text, p_v text) returns void
language sql as $fn$
  insert into t3802b_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

-- "The request ended, some minutes ago": request rows written so far look
-- like rows from an earlier transaction, outside the per-minute window.
create function pg_temp.t3802b_next_request() returns void
language sql as $fn$
  update public.team_agent_calls
     set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes'
   where xact_id <> '3'::xid8
$fn$;

-- A person in a browser session, after any agent request has ended.
create function pg_temp.t3802b_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3802b_next_request();
  return pg_temp.t3802b_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3802b_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.t3802b_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.t3802b_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then
    return v;
  end if;
  perform pg_temp.t3802b_keep(p_label, v::jsonb ->> 'key');
  perform pg_temp.t3802b_keep(p_label || '.id', v::jsonb ->> 'key_id');
  return v;
end;
$fn$;

-- One agent request, the way the edge function makes it.
create function pg_temp.t3802b_gw(p_label text, p_tool text, p_args text default '{}') returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3802b_next_request();
  return pg_temp.t3802b_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
    pg_temp.t3802b_digest(coalesce(pg_temp.t3802b_id(p_label), p_label)), p_tool, p_args, 'issue3802b-client/1.0'));
end;
$fn$;

-- A record made directly, for fixtures only.
create function pg_temp.t3802b_rec(p_pipe text, p_name text, p_stage text default null, p_rule text default null) returns uuid
language plpgsql as $fn$
declare
  v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, stage_reason, created_by, updated_by,
                                  contact_rule, contact_rule_reason, contact_rule_by, contact_rule_at)
  values (p_pipe, p_name, coalesce(p_stage, case p_pipe when 'hosts' then 'prospect' else 'identified' end),
          case when p_stage in ('lost', 'passed') then 'fixture' end,
          'issue3802b-fixture', 'issue3802b-fixture',
          p_rule, case when p_rule is not null then 'Fixture reason' end,
          case when p_rule is not null then 'issue3802b-fixture' end, case when p_rule is not null then now() end)
  returning id into v_id;
  return v_id;
end;
$fn$;

-- One use of a setup code, as the edge function makes it. Any key in the
-- answer is masked, so a failed check never prints one.
create function pg_temp.t3802b_redeem(p_code text) returns text
language sql as $fn$
  select regexp_replace(
    pg_temp.t3802b_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      pg_temp.t3802b_digest(p_code), 'setup:redeem', '{}', 'x')),
    'mgla_[cx]_[A-Za-z0-9_-]{43}', '<a key>', 'g')
$fn$;

select pg_temp.t3802b_newkey('growth', 'claude', 'growth.claude') is not null as key_growth,
       pg_temp.t3802b_newkey('growth2', 'codex', 'growth2.codex') is not null as key_growth2,
       pg_temp.t3802b_newkey('partner', 'claude', 'partner.claude') is not null as key_partner,
       pg_temp.t3802b_newkey('admin', 'claude', 'admin.claude') is not null as key_admin,
       pg_temp.t3802b_newkey('owner', 'claude', 'owner.claude') is not null as key_owner;

-- ---------------------------------------------------------------------------
-- B-1 -- catalog.
-- ---------------------------------------------------------------------------
do $b1$
declare
  f record;
  t text;
begin
  for f in
    select * from (values
      ('public.crm_contact_check(text,jsonb)', true),
      ('public.team_agent_setup_create(text,text)', true),
      ('public.crm_ident_key(text,text)', false),
      ('public.crm_clean_identifiers(jsonb)', false),
      ('public.crm_identifier_matches(text,jsonb,uuid)', false),
      ('public.crm_identifiers_json(uuid)', false),
      ('public.team_agent_person(text)', false),
      ('public.team_agent_key_issue(text,text,text,text)', false),
      ('public.team_agent_setup_redeem(text,text)', false),
      ('public.team_agent_call(text,text,jsonb,text)', false)
    ) as x(fn, client)
  loop
    perform pg_temp.t3802b_check('B-1', f.fn || ': grantees are exactly the expected roles',
      (select string_agg(distinct coalesce(g.rolname, 'PUBLIC'), ',' order by coalesce(g.rolname, 'PUBLIC'))
         from pg_proc p, aclexplode(p.proacl) a left join pg_roles g on g.oid = a.grantee
        where p.oid = f.fn::regprocedure and a.privilege_type = 'EXECUTE'
          and coalesce(g.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
      case when f.client then 'authenticated,service_role' else 'service_role' end);
    perform pg_temp.t3802b_check('B-1', f.fn || ': pins an empty search path',
      (select ('search_path=""' = any (p.proconfig))::text from pg_proc p where p.oid = f.fn::regprocedure), 'true');
  end loop;
  foreach t in array array['public.crm_record_identifiers', 'public.team_agent_setup_codes'] loop
    perform pg_temp.t3802b_check('B-1', t || ': row security on, no policy, no trigger, nothing for a client role',
      (select c.relrowsecurity::text from pg_class c where c.oid = t::regclass)
        || '/' || (select count(*) from pg_policy where polrelid = t::regclass)
        || '/' || (select count(*) from pg_trigger where tgrelid = t::regclass and not tgisinternal)
        || '/' || (select count(*) from unnest(array['anon', 'authenticated']) r,
                     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                    where has_table_privilege(r, t, p)), 'true/0/0/0');
    perform pg_temp.t3802b_like('B-1', t || ': a signed-in person cannot read it',
      pg_temp.t3802b_as('growth', format('select count(*)::text from %s', t)), 'ERR:42501:%');
    perform pg_temp.t3802b_like('B-1', t || ': an anonymous caller cannot read it',
      pg_temp.t3802b_as('anon', format('select count(*)::text from %s', t)), 'ERR:42501:%');
  end loop;
  perform pg_temp.t3802b_check('B-1', 'the setup codes table has no foreign key',
    (select count(*)::text from pg_constraint where contype = 'f' and conrelid = 'public.team_agent_setup_codes'::regclass), '0');
  perform pg_temp.t3802b_check('B-1', 'the only foreign key of the identifiers table points at the records table',
    (select string_agg(confrelid::regclass::text, ',') from pg_constraint
      where contype = 'f' and conrelid = 'public.crm_record_identifiers'::regclass), 'crm_records');
  foreach t in array array['team_agent_setup_redeem(''x'', ''y'')', 'team_agent_key_issue(null, ''claude'', null, ''page'')',
                           'team_agent_person(''x'')', 'crm_ident_key(''email'', ''a@b.co'')',
                           'team_agent_call(''x'', ''setup:redeem'', ''{}''::jsonb, ''y'')'] loop
    perform pg_temp.t3802b_like('B-1', 'a signed-in person cannot run ' || split_part(t, '(', 1),
      pg_temp.t3802b_as('growth', 'select public.' || t || '::text'), 'ERR:42501:%');
    perform pg_temp.t3802b_like('B-1', 'an anonymous caller cannot run ' || split_part(t, '(', 1),
      pg_temp.t3802b_as('anon', 'select public.' || t || '::text'), 'ERR:42501:%');
  end loop;
  perform pg_temp.t3802b_check('B-1', 'there are exactly 16 team_agent_ functions and 48 crm_ functions',
    (select count(*) filter (where p.proname like 'team\_agent\_%')::text || '/' || count(*) filter (where p.proname like 'crm\_%')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'), '16/48');
  perform pg_temp.t3802b_check('B-1', 'no agent function takes a person from its caller',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'team\_agent\_%'
        and exists (select 1 from unnest(coalesce(p.proargnames, array[]::text[])) a
                     where a ~* '(actor|email|uid|user|owner|via|role|address|person)')), '0');
  perform pg_temp.t3802b_check('B-1', 'is_admin_user() has the source it had before this migration',
    (select md5(prosrc) from pg_proc where oid = 'public.is_admin_user()'::regprocedure), 'dc5465a20a4246c6921be0469e261a8b');
  perform pg_temp.t3802b_check('B-1', 'the migration file never replaces it, the role functions or the team writer',
    (select (sql !~* 'function\s+public\.(is_admin_user|admin_team_role|admin_team_can|admin_team_role_areas|admin_team_my_access|admin_team_set_member)\M')::text
       from t3802b_src where k = 'file'), 'true');
  perform pg_temp.t3802b_check('B-1', 'the gateway writes only its own two tables',
    (select (p.prosrc !~* '(insert\s+into|update|delete\s+from|truncate|merge\s+into)\s+(only\s+)?(public\.)?(crm_|admin_|team_agent_setup)')::text
       from pg_proc p where p.oid = 'public.team_agent_call(text,text,jsonb,text)'::regprocedure), 'true');
  perform pg_temp.t3802b_check('B-1', 'the limits carry the three new numbers',
    (public.team_agent_limits() ->> 'setup_code_minutes') || '/' || (public.team_agent_limits() ->> 'setup_codes_per_hour')
      || '/' || (public.team_agent_limits() ->> 'key_wait_ms') || '/' || (public.team_agent_limits() ->> 'records_written_per_day'),
    '10/10/5000/20000');
end;
$b1$;

-- ---------------------------------------------------------------------------
-- B-2 -- setup codes.
-- ---------------------------------------------------------------------------
do $b2$
declare
  v text;
  v_code text;
  v_code2 text;
  v_old uuid := pg_temp.t3802b_id('growth.claude.id')::uuid;
  v_key text;
  v_refusal constant text := '{"setup": "invalid"}';
  i int;
begin
  v := pg_temp.t3802b_person('growth', $q$select public.team_agent_setup_create('claude', 'America/New_York')::text$q$);
  v_code := v::jsonb ->> 'code';
  perform pg_temp.t3802b_check('B-2', 'a growth person gets a code of the documented shape',
    (v_code ~ '^mgls_c_[A-Za-z0-9_-]{43}$')::text, 'true');
  perform pg_temp.t3802b_check('B-2', 'it ends ten minutes after it was made, and says a key will be replaced',
    (((v::jsonb ->> 'expires_at')::timestamptz - (v::jsonb ->> 'created_at')::timestamptz) = interval '10 minutes')::text
      || '/' || (v::jsonb ->> 'replaces_key') || '/' || (v::jsonb ->> 'agent'), 'true/true/claude');
  perform pg_temp.t3802b_check('B-2', 'the answer carries exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v::jsonb) k), 'agent,code,created_at,expires_at,replaces_key');
  perform pg_temp.t3802b_check('B-2', 'the table holds its digest and nothing readable',
    (select count(*)::text from public.team_agent_setup_codes c where c.code_hash = pg_temp.t3802b_digest(v_code))
      || '/' || (select count(*) from public.team_agent_setup_codes c where to_jsonb(c)::text like '%' || v_code || '%'), '1/0');
  perform pg_temp.t3802b_check('B-2', 'the audit row holds neither the code nor its digest',
    (select count(*)::text || '/' || count(*) filter (where a.metadata::text like '%' || v_code || '%'
                                                        or a.metadata::text like '%' || pg_temp.t3802b_digest(v_code) || '%'
                                                        or a.target_id like '%mgls%')
       from public.admin_audit_log a where a.action = 'agent.setup_create' and a.admin_email = 'issue3802b-growth@test.local'), '1/0');
  perform pg_temp.t3802b_check('B-2', 'making a code changes nothing for the agent: the key still works',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'get_started'), 'ok'), 'true');
  perform pg_temp.t3802b_check('B-2', 'the person sees one code waiting, with no code in it',
    (pg_temp.t3802b_person('growth', 'select public.team_agent_keys_mine()::text')::jsonb -> 'setup' -> 0 ->> 'agent')
      || '/' || (select string_agg(k, ',' order by k)
                   from jsonb_object_keys(pg_temp.t3802b_person('growth', 'select public.team_agent_keys_mine()::text')::jsonb -> 'setup' -> 0) k),
    'claude/agent,created_at,expires_at');

  -- Refusals that never reach the row.
  perform pg_temp.t3802b_check('B-2', 'a digest that is not a digest is refused',
    pg_temp.t3802b_as('service', $q$select public.team_agent_call('nope', 'setup:redeem', '{}'::jsonb, 'x')::text$q$), v_refusal);
  perform pg_temp.t3802b_check('B-2', 'an unknown code is refused',
    pg_temp.t3802b_as('service', format($q$select public.team_agent_call(%L, 'setup:redeem', '{}'::jsonb, 'x')::text$q$,
      pg_temp.t3802b_digest('mgls_c_' || repeat('a', 43)))), v_refusal);
  perform pg_temp.t3802b_check('B-2', 'a key handed over as a code is refused',
    pg_temp.t3802b_as('service', format($q$select public.team_agent_call(%L, 'setup:redeem', '{}'::jsonb, 'x')::text$q$,
      pg_temp.t3802b_digest(pg_temp.t3802b_id('growth.claude')))), v_refusal);
  perform pg_temp.t3802b_check('B-2', 'a code handed over as a key is refused like any wrong key',
    pg_temp.t3802b_as('service', format($q$select public.team_agent_call(%L, 'get_started', '{}'::jsonb, 'x')::text$q$,
      pg_temp.t3802b_digest(v_code))), '{"auth": "invalid"}');

  -- The exchange.
  perform pg_temp.t3802b_next_request();
  v := pg_temp.t3802b_as('service', format($q$select public.team_agent_call(%L, 'setup:redeem', '{}'::jsonb, 'Setup Client/9')::text$q$,
    pg_temp.t3802b_digest(v_code)));
  v_key := v::jsonb ->> 'key';
  perform pg_temp.t3802b_check('B-2', 'the first use answers a key for the right agent',
    (v::jsonb ->> 'setup') || '/' || (v_key ~ '^mgla_c_[A-Za-z0-9_-]{43}$')::text || '/' || (v::jsonb ->> 'agent')
      || '/' || ((v::jsonb ->> 'key_prefix') = left(v_key, 14))::text, 'ok/true/claude/true');
  perform pg_temp.t3802b_check('B-2', 'the previous key for that agent is replaced at that moment',
    (select revoke_reason || '/' || revoked_by from public.team_agent_keys where id = v_old), 'replaced/issue3802b-growth@test.local');
  perform pg_temp.t3802b_check('B-2', 'the new key belongs to the code''s maker, remembers the zone and what connected',
    (select owner_email || '/' || agent || '/' || time_zone || '/' || last_used_client || '/' || (revoked_at is null)::text
       from public.team_agent_keys where key_hash = pg_temp.t3802b_digest(v_key)),
    'issue3802b-growth@test.local/claude/America/New_York/Setup Client/9/true');
  perform pg_temp.t3802b_check('B-2', 'another person''s key, and this person''s other agent, are untouched',
    (select count(*)::text from public.team_agent_keys where revoked_at is null
      and owner_email in ('issue3802b-growth2@test.local', 'issue3802b-partner@test.local', 'issue3802b-admin@test.local', 'issue3802b-owner@test.local')), '4');
  perform pg_temp.t3802b_check('B-2', 'the key''s audit row says it came from a setup code and holds no key',
    (select (a.metadata ->> 'how') || '/' || (a.metadata::text not like '%' || v_key || '%')::text
       from public.admin_audit_log a where a.action = 'agent.key_create'
        and a.target_id = (select id::text from public.team_agent_keys where key_hash = pg_temp.t3802b_digest(v_key))), 'setup_code/true');
  perform pg_temp.t3802b_check('B-2', 'the code row names the key it made',
    (select (consumed_at is not null)::text || '/' || (consumed_key_id = (select id from public.team_agent_keys where key_hash = pg_temp.t3802b_digest(v_key)))::text
       from public.team_agent_setup_codes where code_hash = pg_temp.t3802b_digest(v_code)), 'true/true');
  perform pg_temp.t3802b_keep('growth.claude', v_key);
  perform pg_temp.t3802b_check('B-2', 'the key from the exchange works',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'get_started'), 'result', 'me', 'email'), 'issue3802b-growth@test.local');
  perform pg_temp.t3802b_check('B-2', 'no request row was written for an exchange',
    (select count(*)::text from public.team_agent_calls where tool like 'setup%'), '0');

  -- A second use, and the other refusals, all one answer; none makes a key.
  perform pg_temp.t3802b_check('B-2', 'a second use of the same code is refused',
    pg_temp.t3802b_redeem(v_code), v_refusal);

  v_code := pg_temp.t3802b_person('growth2', $q$select public.team_agent_setup_create('codex')::text$q$)::jsonb ->> 'code';
  update public.team_agent_setup_codes set created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'
   where code_hash = pg_temp.t3802b_digest(v_code);
  perform pg_temp.t3802b_check('B-2', 'a code past its ten minutes is refused',
    pg_temp.t3802b_redeem(v_code), v_refusal);

  v_code := pg_temp.t3802b_person('growth2', $q$select public.team_agent_setup_create('codex')::text$q$)::jsonb ->> 'code';
  v_code2 := pg_temp.t3802b_person('growth2', $q$select public.team_agent_setup_create('codex')::text$q$)::jsonb ->> 'code';
  perform pg_temp.t3802b_check('B-2', 'a newer code for the same agent ends the one before it',
    pg_temp.t3802b_redeem(v_code), v_refusal);
  perform pg_temp.t3802b_check('B-2', 'through all of that growth2''s key was never replaced',
    (select (revoked_at is null)::text from public.team_agent_keys where id = pg_temp.t3802b_id('growth2.codex.id')::uuid), 'true');
  -- Disconnecting ends the code that is waiting.
  perform pg_temp.t3802b_person('growth2', format('select public.team_agent_key_revoke(%L)::text', pg_temp.t3802b_id('growth2.codex.id')));
  perform pg_temp.t3802b_check('B-2', 'disconnecting ends the waiting code too',
    pg_temp.t3802b_redeem(v_code2), v_refusal);
  perform pg_temp.t3802b_check('B-2', 'and no key was made for growth2',
    (select count(*)::text from public.team_agent_keys where owner_email = 'issue3802b-growth2@test.local' and revoked_at is null), '0');

  -- The owner of a code loses access, or gains another way of signing in.
  v_code := pg_temp.t3802b_person('leaver', $q$select public.team_agent_setup_create('claude')::text$q$)::jsonb ->> 'code';
  perform pg_temp.t3802b_person('owner', $q$select public.admin_team_set_member('issue3802b-leaver@test.local', 'growth', 'revoked')::text$q$);
  perform pg_temp.t3802b_check('B-2', 'a code whose maker was removed is refused',
    pg_temp.t3802b_redeem(v_code), v_refusal);
  v_code := pg_temp.t3802b_person('social', $q$select public.team_agent_setup_create('claude')::text$q$)::jsonb ->> 'code';
  insert into auth.identities (user_id, provider) values ('38020000-0000-4000-b000-000000000006', 'google');
  perform pg_temp.t3802b_check('B-2', 'a code whose maker can now sign in another way is refused',
    pg_temp.t3802b_redeem(v_code), v_refusal);
  perform pg_temp.t3802b_check('B-2', 'neither refusal made a key, and both codes are used up',
    (select count(*)::text from public.team_agent_keys where owner_email in ('issue3802b-leaver@test.local', 'issue3802b-social@test.local'))
      || '/' || (select count(*) from public.team_agent_setup_codes
                  where owner_email in ('issue3802b-leaver@test.local', 'issue3802b-social@test.local') and consumed_at is not null and consumed_key_id is null), '0/2');
  perform pg_temp.t3802b_check('B-2', 'after a refusal nobody is acting',
    pg_temp.t3802b_as('service', format($q$select (public.team_agent_call(%L, 'setup:redeem', '{}'::jsonb, 'x') ->> 'setup')
       || '/' || coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), 'nobody')$q$, pg_temp.t3802b_digest(v_code))), 'invalid/nobody');

  -- Who may make one.
  perform pg_temp.t3802b_like('B-2', 'a person without the pipelines cannot make a code',
    pg_temp.t3802b_person('nobody', $q$select public.team_agent_setup_create('claude')::text$q$), 'ERR:42501:forbidden:%');
  perform pg_temp.t3802b_like('B-2', 'an agent cannot make a code',
    pg_temp.t3802b_as('service', format($q$select (public.team_agent_call(%L, 'get_started', '{}'::jsonb, 'x') ->> 'ok')
       || '/' || public.team_agent_setup_create('claude')::text$q$, pg_temp.t3802b_digest(pg_temp.t3802b_id('partner.claude')))),
    'ERR:42501:forbidden: An agent cannot manage keys.%');
  perform pg_temp.t3802b_like('B-2', 'an unknown agent is refused in plain words',
    pg_temp.t3802b_person('partner', $q$select public.team_agent_setup_create('gemini')::text$q$), 'ERR:22023:invalid_agent: Choose Claude or Codex.');
  v_code := pg_temp.t3802b_person('partner', $q$select public.team_agent_setup_create('codex', 'Mars/Olympus')::text$q$)::jsonb ->> 'code';
  perform pg_temp.t3802b_check('B-2', 'a zone this server does not know is kept as not known, never as an error',
    (select (c.time_zone is null)::text from public.team_agent_setup_codes c where c.code_hash = pg_temp.t3802b_digest(v_code)), 'true');

  -- The eleventh in an hour.
  for i in 1..9 loop
    v := pg_temp.t3802b_person('partner', $q$select public.team_agent_setup_create('codex')::text$q$);
  end loop;
  perform pg_temp.t3802b_check('B-2', 'the tenth code in an hour is made', (v not like 'ERR:%')::text, 'true');
  perform pg_temp.t3802b_like('B-2', 'the eleventh is refused in plain words',
    pg_temp.t3802b_person('partner', $q$select public.team_agent_setup_create('codex')::text$q$),
    'ERR:22023:too_many_codes: You have copied 10 setup messages in the last hour.%');
  perform pg_temp.t3802b_check('B-2', 'only the newest of them is still waiting',
    (select count(*)::text from public.team_agent_setup_codes
      where owner_email = 'issue3802b-partner@test.local' and consumed_at is null and voided_at is null), '1');

  -- Housekeeping.
  update public.team_agent_setup_codes set created_at = now() - interval '8 days', expires_at = now() - interval '8 days' + interval '10 minutes'
   where owner_email = 'issue3802b-leaver@test.local';
  perform pg_temp.t3802b_as('service', 'select public.team_agent_housekeeping()::text');
  perform pg_temp.t3802b_check('B-2', 'the daily clean-up removes codes older than seven days and nothing younger',
    (select count(*) filter (where owner_email = 'issue3802b-leaver@test.local')::text || '/' || (count(*) filter (where owner_email = 'issue3802b-partner@test.local') > 0)::text
       from public.team_agent_setup_codes), '0/true');
end;
$b2$;

-- ---------------------------------------------------------------------------
-- B-3 -- Experience host.
-- ---------------------------------------------------------------------------
do $b3$
declare
  v text;
begin
  perform pg_temp.t3802b_check('B-3', 'hosts have seven ICPs, Experience host sixth',
    (select string_agg(i ->> 'id', ',' order by ord) from jsonb_array_elements(public.crm_pipeline_def('hosts') -> 'icps') with ordinality as t(i, ord)),
    'restaurant_bar,venue_gallery,event_organizer,community_host,trip_stay_host,experience_host,partner_org');
  perform pg_temp.t3802b_check('B-3', 'its label is Experience host',
    (select i ->> 'label' from jsonb_array_elements(public.crm_pipeline_def('hosts') -> 'icps') i where i ->> 'id' = 'experience_host'), 'Experience host');
  perform pg_temp.t3802b_check('B-3', 'creators still have their two',
    (select string_agg(i ->> 'id', ',') from jsonb_array_elements(public.crm_pipeline_def('creators') -> 'icps') i), 'ambassador,ugc_one_off');
  v := pg_temp.t3802b_person('growth', $q$select public.crm_record_create('hosts', '{"name": "B3 Kayak Tours", "icp": "experience_host"}', 'b3-create-0001')::text$q$);
  perform pg_temp.t3802b_check('B-3', 'a host is accepted with it',
    pg_temp.t3802b_get(v, 'status') || '/' || pg_temp.t3802b_get(v, 'record', 'icp'), 'created/experience_host');
  perform pg_temp.t3802b_like('B-3', 'a creator is not',
    pg_temp.t3802b_person('growth', $q$select public.crm_record_create('creators', '{"name": "B3 Creator", "icp": "experience_host"}', 'b3-create-0002')::text$q$),
    'ERR:22023:invalid_icp:%');
  v := pg_temp.t3802b_person('admin', $q$select public.crm_target_set('38020000-0000-4000-b200-000000000001', 'experience_host', 5)::text$q$);
  perform pg_temp.t3802b_check('B-3', 'a target is accepted with it', pg_temp.t3802b_get(v, 'changed'), 'true');
  perform pg_temp.t3802b_check('B-3', 'an Experience / Tour lead maps to it',
    public.crm_beta_icp(array['experience_tour']) ->> 'icp', 'experience_host');
  perform pg_temp.t3802b_check('B-3', 'find_records accepts it as a filter',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "icp": ["experience_host"]}'), 'result', 'total'), '1');
  -- The lead's email becomes an identifier of the host; a lead whose email a
  -- host already holds, under another name, is linked to that host.
  v := pg_temp.t3802b_person('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-b400-000000000001')::text$q$);
  perform pg_temp.t3802b_check('B-3', 'a lead added to Hosts carries the ICP and its email as an identifier, in its normal form',
    pg_temp.t3802b_get(v, 'status') || '/' || pg_temp.t3802b_get(v, 'record', 'icp') || '/' || pg_temp.t3802b_get(v, 'record', 'identifiers', '0', 'key'),
    'created/experience_host/issue3802b-lead1@test.local');
  v := pg_temp.t3802b_person('growth', $q$select public.crm_record_create('hosts', '{"name": "B3 Already Here", "identifiers": [{"kind": "email", "value": "issue3802b-lead2@test.local"}]}', 'b3-create-0003')::text$q$);
  v := pg_temp.t3802b_person('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-b400-000000000002')::text$q$);
  perform pg_temp.t3802b_check('B-3', 'a lead whose email a host already holds is linked to that host, never a second host',
    pg_temp.t3802b_get(v, 'status') || '/' || pg_temp.t3802b_get(v, 'record', 'name')
      || '/' || (select count(*) from public.crm_records where name = 'Issue3802b Other Name')
      || '/' || (select a.body like 'Linked to a beta lead. Same email as this beta lead. %' from public.crm_activity a
                  join public.crm_records c on c.id = a.record_id where c.name = 'B3 Already Here' and a.kind = 'note'),
    'linked/B3 Already Here/0/true');
end;
$b3$;

-- ---------------------------------------------------------------------------
-- B-4 -- identifiers. The table below is the one the admin web's twin of
-- crm_ident_key is asserted against (kind | value | normal form, "-" = not
-- usable); keep the two in step.
-- ---------------------------------------------------------------------------
create temp table t3802b_forms (kind text, value text, want text) on commit drop;
insert into t3802b_forms values
  ('email', ' A@B.co ', 'a@b.co'),
  ('email', 'Name.Surname+tag@Example.COM', 'name.surname+tag@example.com'),
  ('email', 'no-at-sign.example.com', '-'),
  ('email', 'two@@example.com', '-'),
  ('email', 'name@nodot', '-'),
  ('email', 'has space@example.com', '-'),
  ('email', '@example.com', '-'),
  ('email', 'a@b.c', 'a@b.c'),
  ('phone', '+234 (803) 555-0101', '2348035550101'),
  ('phone', '00 44 20 7946 0958', '442079460958'),
  ('phone', '0803 555 0101', '08035550101'),
  ('phone', '555-0101', '5550101'),
  ('phone', '12345', '-'),
  ('phone', '1234567890123456', '-'),
  ('phone', 'call me', '-'),
  ('phone', '+1 (919) 555.0103 ext', '19195550103'),
  ('handle', 'https://www.instagram.com/Palm.Court/?hl=en', 'palm.court'),
  ('handle', '@Palm.Court', 'palm.court'),
  ('handle', 'palm.court', 'palm.court'),
  ('handle', '@x', '-'),
  ('handle', 'tiktok.com/@Some_Creator', 'some_creator'),
  ('handle', 'http://twitter.com/Mingla#top', 'mingla'),
  ('handle', 'x.com/mingla?s=20', 'mingla'),
  ('handle', 'www.youtube.com/@Chan-Nel', 'chan-nel'),
  ('handle', 'linkedin.com/in/jane-doe/', 'jane-doe'),
  ('handle', 'linkedin.com/company/mingla', 'mingla'),
  ('handle', 'facebook.com/PalmCourt', 'palmcourt'),
  ('handle', 'wa.me/2348035550101', '2348035550101'),
  ('handle', 'has space', '-'),
  ('handle', 'name@example.com', '-'),
  ('handle', 'https://example.com/someone', 'example.com'),
  ('handle', repeat('a', 61), '-'),
  ('handle', repeat('a', 60), repeat('a', 60)),
  ('handle', '', '-');

do $b4$
declare
  v text;
  v_a uuid;
  v_b uuid;
begin
  perform pg_temp.t3802b_check('B-4', 'every row of the normal-form table gives its documented key',
    (select coalesce(string_agg(kind || ':' || value || '=>' || coalesce(public.crm_ident_key(kind, value), '-'), '; '), 'all')
       from t3802b_forms where coalesce(public.crm_ident_key(kind, value), '-') is distinct from want), 'all');
  perform pg_temp.t3802b_check('B-4', 'the table holds at least 24 rows', (select (count(*) >= 24)::text from t3802b_forms), 'true');
  perform pg_temp.t3802b_check('B-4', 'an unknown kind or a missing value has no key',
    coalesce(public.crm_ident_key('fax', '12345678'), '-') || coalesce(public.crm_ident_key('email', null), '-'), '--');

  -- The cleaner.
  perform pg_temp.t3802b_check('B-4', 'the cleaner drops repeats, orders by kind then key, and reads the platform from a profile address',
    public.crm_clean_identifiers('[{"kind": "handle", "value": "https://instagram.com/Palm.Court"}, {"kind": "handle", "value": "@palm.court"},
                                    {"kind": "email", "value": " Hello@Palm.co "}, {"kind": "phone", "value": "+1 919 555 0100"}]')::text,
    '[{"kind": "email", "value": "Hello@Palm.co", "platform": null, "value_key": "hello@palm.co"}, {"kind": "handle", "value": "https://instagram.com/Palm.Court", "platform": "instagram", "value_key": "palm.court"}, {"kind": "phone", "value": "+1 919 555 0100", "platform": null, "value_key": "19195550100"}]');
  perform pg_temp.t3802b_check('B-4', 'nothing in gives nothing out',
    coalesce(public.crm_clean_identifiers(null)::text, 'null') || '/' || coalesce(public.crm_clean_identifiers('null')::text, 'null')
      || '/' || public.crm_clean_identifiers('[]')::text, 'null/null/[]');
  perform pg_temp.t3802b_like('B-4', 'an unusable value is refused, naming its kind',
    pg_temp.t3802b_as('service', $q$select public.crm_clean_identifiers('[{"kind": "email", "value": "nope"}]')::text$q$),
    'ERR:22023:invalid_identifier: "nope" is not a usable email. An email needs a name, an @ and a domain.');
  perform pg_temp.t3802b_like('B-4', 'an extra key is refused',
    pg_temp.t3802b_as('service', $q$select public.crm_clean_identifiers('[{"kind": "email", "value": "a@b.co", "key": "a@b.co"}]')::text$q$),
    'ERR:22023:invalid_identifiers: Send identifiers as a list of at most 20 items%');
  perform pg_temp.t3802b_like('B-4', 'more than twenty are refused',
    pg_temp.t3802b_as('service', $q$select public.crm_clean_identifiers((select jsonb_agg(jsonb_build_object('kind', 'email', 'value', 'n' || g || '@b.co')) from generate_series(1, 21) g))::text$q$),
    'ERR:22023:invalid_identifiers:%');
  perform pg_temp.t3802b_like('B-4', 'a platform on an email is refused',
    pg_temp.t3802b_as('service', $q$select public.crm_clean_identifiers('[{"kind": "email", "value": "a@b.co", "platform": "instagram"}]')::text$q$),
    'ERR:22023:invalid_identifiers: A platform goes with a handle only%');

  -- Create with identifiers; a second record with the same one.
  v := pg_temp.t3802b_person('growth', $q$select public.crm_record_create('hosts',
    '{"name": "B4 Palm Court", "identifiers": [{"kind": "handle", "value": "@Palm.Court", "platform": "instagram"}, {"kind": "phone", "value": "+234 803 555 0101"}, {"kind": "email", "value": "hello@palmcourt.example"}]}',
    'b4-create-0001')::text$q$);
  v_a := (v::jsonb #>> '{record,id}')::uuid;
  perform pg_temp.t3802b_check('B-4', 'a record is created with its three identifiers, as typed and in their normal form',
    pg_temp.t3802b_get(v, 'status') || '/' || (v::jsonb #> '{record,identifiers}')::text,
    'created/[{"key": "hello@palmcourt.example", "kind": "email", "value": "hello@palmcourt.example", "platform": null}, {"key": "palm.court", "kind": "handle", "value": "@Palm.Court", "platform": "instagram"}, {"key": "2348035550101", "kind": "phone", "value": "+234 803 555 0101", "platform": null}]');
  perform pg_temp.t3802b_check('B-4', 'the audit row counts the identifiers and holds none of them',
    (select (a.metadata ->> 'identifiers') || '/' || (a.metadata::text !~* 'palm\.court|5550101|hello@')::text
       from public.admin_audit_log a where a.action = 'crm.record_create' and a.target_id = v_a::text), '3/true');
  v := pg_temp.t3802b_person('growth2', $q$select public.crm_record_create('hosts',
    '{"name": "B4 Another Name", "identifiers": [{"kind": "handle", "value": "instagram.com/palm.court"}]}', 'b4-create-0002')::text$q$);
  perform pg_temp.t3802b_check('B-4', 'a different name with the same handle, written as a profile address, is a duplicate by identifier',
    pg_temp.t3802b_get(v, 'status') || '/' || pg_temp.t3802b_get(v, 'reason') || '/' || pg_temp.t3802b_get(v, 'existing', 'id')
      || '/' || pg_temp.t3802b_get(v, 'matched_on', '0', 'rule') || '/' || pg_temp.t3802b_get(v, 'others'),
    'duplicate/identifier/' || v_a || '/exact/0');
  v := pg_temp.t3802b_person('growth2', $q$select public.crm_record_create('hosts',
    '{"name": "B4 Local Phone", "identifiers": [{"kind": "phone", "value": "0803 555 0101"}]}', 'b4-create-0003')::text$q$);
  perform pg_temp.t3802b_check('B-4', 'a phone number in its local form matches by its last nine digits',
    pg_temp.t3802b_get(v, 'status') || '/' || pg_temp.t3802b_get(v, 'reason') || '/' || pg_temp.t3802b_get(v, 'matched_on', '0', 'rule'),
    'duplicate/identifier/last_9_digits');
  v := pg_temp.t3802b_person('growth2', $q$select public.crm_record_create('hosts', '{"name": "b4 palm  court"}', 'b4-create-0004')::text$q$);
  perform pg_temp.t3802b_check('B-4', 'a duplicate by name says so', pg_temp.t3802b_get(v, 'status') || '/' || pg_temp.t3802b_get(v, 'reason'), 'duplicate/name');
  perform pg_temp.t3802b_check('B-4', 'none of those made a record',
    (select count(*)::text from public.crm_records where name like 'B4 %'), '1');
  v := pg_temp.t3802b_person('growth2', $q$select public.crm_record_create('hosts',
    '{"name": "B4 Shared Manager", "identifiers": [{"kind": "email", "value": "hello@palmcourt.example"}], "allow_shared_identifier": true}', 'b4-create-0005')::text$q$);
  v_b := (v::jsonb #>> '{record,id}')::uuid;
  perform pg_temp.t3802b_check('B-4', 'a person may add anyway', pg_temp.t3802b_get(v, 'status'), 'created');
  perform pg_temp.t3802b_like('B-4', 'the same in the creators pipeline is not a duplicate of a host',
    pg_temp.t3802b_person('growth', $q$select public.crm_record_create('creators',
      '{"name": "B4 Creator", "identifiers": [{"kind": "handle", "value": "palm.court"}]}', 'b4-create-0006')::text$q$), '%"status": "created"%');

  -- Update.
  perform pg_temp.t3802b_like('B-4', 'adding an identifier another record holds is refused, naming that record',
    pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"identifiers": [{"kind": "email", "value": "hello@palmcourt.example"}, {"kind": "handle", "value": "palm.court"}]}')::text$q$, v_b)),
    'ERR:22023:duplicate_identifier: "@Palm.Court" already belongs to "B4 Palm Court" in Hosts. Open that record instead.');
  v := pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"identifiers": [{"kind": "email", "value": "hello@palmcourt.example"}, {"kind": "handle", "value": "shared.manager", "platform": "tiktok"}]}')::text$q$, v_b));
  perform pg_temp.t3802b_check('B-4', 'a record that already shares a detail can still gain one of its own',
    pg_temp.t3802b_get(v, 'changed') || '/' || jsonb_array_length(v::jsonb #> '{record,identifiers}'), 'true/2');
  perform pg_temp.t3802b_check('B-4', 'the same list again, in another order, changes nothing',
    pg_temp.t3802b_get(pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"identifiers": [{"kind": "handle", "value": "@Shared.Manager", "platform": "tiktok"}, {"kind": "email", "value": "HELLO@palmcourt.example"}]}')::text$q$, v_b)), 'changed'), 'false');
  perform pg_temp.t3802b_check('B-4', 'the audit row of the change counts identifiers and holds none',
    (select (a.metadata #>> '{before,identifiers}') || '>' || (a.metadata #>> '{after,identifiers}') || '/' || (a.metadata::text !~* 'shared\.manager|hello@')::text
       from public.admin_audit_log a where a.action = 'crm.record_update' and a.target_id = v_b::text order by a.created_at desc limit 1), '1>2/true');
  v := pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"identifiers": []}')::text$q$, v_b));
  perform pg_temp.t3802b_check('B-4', 'removing all identifiers leaves none',
    pg_temp.t3802b_get(v, 'changed') || '/' || (v::jsonb #> '{record,identifiers}')::text
      || '/' || (select count(*) from public.crm_record_identifiers where record_id = v_b), 'true/[]/0');
  perform pg_temp.t3802b_check('B-4', 'the stored key always equals the function''s answer',
    (select count(*)::text from public.crm_record_identifiers i where i.value_key is distinct from public.crm_ident_key(i.kind, i.value)), '0');
  perform pg_temp.t3802b_like('B-4', 'a row whose key is not the normal form cannot be stored',
    pg_temp.t3802b_as('service', format($q$insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values (%L, 'email', 'A@B.co', 'A@B.co', 'x') returning id::text$q$, v_b)),
    'ERR:23514:%');
  perform pg_temp.t3802b_keep('b4.a', v_a::text);
  perform pg_temp.t3802b_keep('b4.b', v_b::text);
end;
$b4$;

-- ---------------------------------------------------------------------------
-- B-5 -- the contact rule.
-- ---------------------------------------------------------------------------
do $b5$
declare
  v text;
  v_a uuid := pg_temp.t3802b_id('b4.a')::uuid;
begin
  perform pg_temp.t3802b_like('B-5', 'Do not contact without a reason is refused',
    pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"contact_rule": "do_not_contact"}')::text$q$, v_a)),
    'ERR:22023:reason_required: Say in one line why, so the next person and their agent know.');
  perform pg_temp.t3802b_like('B-5', 'an unknown rule is refused, naming the two',
    pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"contact_rule": "ignore", "contact_rule_reason": "x"}')::text$q$, v_a)),
    'ERR:22023:invalid_contact_rule: ignore is not a contact rule. Use do_not_contact, warm_intro_only, or leave it empty.');
  perform pg_temp.t3802b_like('B-5', 'a reason with no rule is refused',
    pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"contact_rule_reason": "x"}')::text$q$, v_a)),
    'ERR:22023:invalid_contact_rule: A reason goes with a contact rule.%');
  v := pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"contact_rule": "warm_intro_only", "contact_rule_reason": "  Knows  the founder "}')::text$q$, v_a));
  perform pg_temp.t3802b_check('B-5', 'with a reason it is set, with who and when',
    pg_temp.t3802b_get(v, 'record', 'contact_rule') || '/' || pg_temp.t3802b_get(v, 'record', 'contact_rule_reason')
      || '/' || pg_temp.t3802b_get(v, 'record', 'contact_rule_by') || '/' || (pg_temp.t3802b_get(v, 'record', 'contact_rule_at') is not null)::text,
    'warm_intro_only/Knows the founder/issue3802b-growth@test.local/true');
  -- An agent: tighten yes, loosen and lift no, reason yes.
  v := pg_temp.t3802b_gw('partner.claude', 'update_records', format('{"updates": [{"id": "%s", "changes": {"contact_rule": "do_not_contact"}}]}', v_a));
  perform pg_temp.t3802b_check('B-5', 'an agent may tighten it, and the stored reason is kept',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'status') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'record', 'contact_rule')
      || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'record', 'contact_rule_reason')
      || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'record', 'contact_rule_by'),
    'updated/do_not_contact/Knows the founder/issue3802b-partner@test.local');
  v := pg_temp.t3802b_gw('partner.claude', 'update_records', format('{"updates": [{"id": "%s", "changes": {"contact_rule": "warm_intro_only"}}, {"id": "%s", "changes": {"contact_rule": null}}, {"id": "%s", "changes": {"contact_rule_reason": "Seth''s personal contact"}}]}', v_a, v_a, v_a));
  perform pg_temp.t3802b_check('B-5', 'an agent cannot loosen it or lift it, and can change its reason',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'token') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '1', 'error', 'token')
      || '/' || pg_temp.t3802b_get(v, 'result', 'results', '2', 'status') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '2', 'record', 'contact_rule'),
    'contact_rule_locked/contact_rule_locked/updated/do_not_contact');
  perform pg_temp.t3802b_check('B-5', 'the refusal tells the agent what to do',
    pg_temp.t3802b_get(v, 'result', 'results', '1', 'error', 'message'),
    'Only a person can lift or loosen a contact rule. Tell your person why you think it should change.');
  -- Every shape carries it.
  v := pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "q": "B4 Palm"}');
  perform pg_temp.t3802b_check('B-5', 'find_records carries it',
    pg_temp.t3802b_get(v, 'result', 'records', '0', 'contact_rule') || '/' || pg_temp.t3802b_get(v, 'result', 'records', '0', 'contact_rule_reason'),
    'do_not_contact/Seth''s personal contact');
  perform pg_temp.t3802b_check('B-5', 'find_records filters by it',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "contact_rule": "do_not_contact"}'), 'result', 'total')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "contact_rule": "any"}'), 'result', 'total')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "contact_rule": "warm_intro_only"}'), 'result', 'total'),
    '1/1/0');
  perform pg_temp.t3802b_like('B-5', 'an unknown filter value is refused',
    pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "contact_rule": "maybe"}'), '%"token": "invalid_arguments"%');
  perform pg_temp.t3802b_check('B-5', 'get_record carries it',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'get_record', format('{"id": "%s"}', v_a)), 'result', 'record', 'contact_rule'), 'do_not_contact');
  perform pg_temp.t3802b_check('B-5', 'check_names carries it',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'check_names', '{"pipeline": "hosts", "names": ["b4 palm court"]}'), 'result', 'names', '0', 'exact', 'contact_rule'), 'do_not_contact');
  v := pg_temp.t3802b_gw('growth.claude', 'check_contactable', '{"pipeline": "hosts", "candidates": [{"name": "B4 PALM COURT"}]}');
  perform pg_temp.t3802b_check('B-5', 'check_contactable says so as its verdict, with the reason',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'verdict') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'record', 'contact_rule_reason')
      || '/' || pg_temp.t3802b_get(v, 'result', 'counts', 'do_not_contact'), 'do_not_contact/Seth''s personal contact/1');
  perform pg_temp.t3802b_person('growth', format($q$select public.crm_record_set_owners(%L, array['issue3802b-growth@test.local'])::text$q$, v_a));
  perform pg_temp.t3802b_person('growth', format($q$select public.crm_record_update(%L, '{"due_on": "2026-01-05"}')::text$q$, v_a));
  perform pg_temp.t3802b_check('B-5', 'a row of my_day carries it',
    (select r ->> 'contact_rule' from jsonb_array_elements(pg_temp.t3802b_gw('growth.claude', 'my_day')::jsonb #> '{result,due,mine,hosts,rows}') r where r ->> 'id' = v_a::text), 'do_not_contact');
  -- An agent's outbound touch on it.
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "touch", "channel": "email", "direction": "outbound", "body": "Hi"}], "request_key": "b5-log-00001"}', v_a));
  perform pg_temp.t3802b_check('B-5', 'an agent''s outbound touch on it is refused, with the reason in the words',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'token') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'message'),
    'do_not_contact/"B4 Palm Court" is marked Do not contact: Seth''s personal contact. Nothing was logged. Do not message them; tell your person.');
  -- A person lifts it; the reason goes with it.
  v := pg_temp.t3802b_person('growth2', format($q$select public.crm_record_update(%L, '{"contact_rule": null}')::text$q$, v_a));
  perform pg_temp.t3802b_check('B-5', 'a person can lift it, and the reason, who and when go with it',
    pg_temp.t3802b_get(v, 'changed') || '/' || coalesce(pg_temp.t3802b_get(v, 'record', 'contact_rule'), 'null') || coalesce(pg_temp.t3802b_get(v, 'record', 'contact_rule_reason'), 'null')
      || coalesce(pg_temp.t3802b_get(v, 'record', 'contact_rule_by'), 'null') || coalesce(pg_temp.t3802b_get(v, 'record', 'contact_rule_at'), 'null'), 'true/nullnullnullnull');
  perform pg_temp.t3802b_check('B-5', 'the audit rows of the rule carry it as it was and as it is, with the agent it came through',
    (select string_agg(coalesce(a.metadata #>> '{before,contact_rule}', '-') || '>' || coalesce(a.metadata #>> '{after,contact_rule}', '-')
                       || ':' || coalesce(a.metadata ->> 'via', 'person'), ' ' order by a.created_at)
       from public.admin_audit_log a where a.action = 'crm.record_update' and a.target_id = v_a::text and (a.metadata -> 'after') ? 'contact_rule'),
    '->warm_intro_only:person warm_intro_only>do_not_contact:claude do_not_contact>-:person');
  -- Set at creation.
  v := pg_temp.t3802b_person('growth', $q$select public.crm_record_create('hosts', '{"name": "B5 Marked At Birth", "contact_rule": "do_not_contact", "contact_rule_reason": "Asked us not to"}', 'b5-create-0001')::text$q$);
  perform pg_temp.t3802b_check('B-5', 'a rule can be set when a record is added',
    pg_temp.t3802b_get(v, 'record', 'contact_rule') || '/' || pg_temp.t3802b_get(v, 'record', 'contact_rule_by'), 'do_not_contact/issue3802b-growth@test.local');
  perform pg_temp.t3802b_like('B-5', 'and needs its reason there too',
    pg_temp.t3802b_person('growth', $q$select public.crm_record_create('hosts', '{"name": "B5 No Reason", "contact_rule": "do_not_contact"}', 'b5-create-0002')::text$q$),
    'ERR:22023:reason_required:%');
end;
$b5$;

-- ---------------------------------------------------------------------------
-- B-6 -- what an agent may log: 2 callers x 3 entries x touched or not x 3
-- rules = 36 cases. Refused exactly when an agent logs an outbound touch on
-- a record that carries a rule or has been touched before.
-- ---------------------------------------------------------------------------
do $b6$
declare
  c record;
  v_id uuid;
  v text;
  v_got text;
  v_want text;
  v_bad text := '';
  v_n int := 0;
  v_entry text;
begin
  for c in
    select w.who, e.entry, t.touched, r.rule
    from unnest(array['agent', 'person']) as w(who),
         unnest(array['note', 'inbound', 'outbound']) as e(entry),
         unnest(array[false, true]) as t(touched),
         unnest(array['none', 'warm_intro_only', 'do_not_contact']) as r(rule)
  loop
    v_n := v_n + 1;
    v_id := pg_temp.t3802b_rec('hosts', 'B6 case ' || v_n, null, nullif(c.rule, 'none'));
    if c.touched then
      insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
      values (v_id, 'touch', 'issue3802b-fixture', 'email', 'inbound', 'They wrote first', now() - interval '400 days');
    end if;
    v_entry := case c.entry
      when 'note' then '"kind": "note", "body": "A note"'
      when 'inbound' then '"kind": "touch", "channel": "email", "direction": "inbound", "body": "Their words"'
      else '"kind": "touch", "channel": "email", "direction": "outbound", "body": "My words"' end;
    if c.who = 'agent' then
      v := pg_temp.t3802b_gw('growth.claude', 'log_activity',
             format('{"entries": [{"id": "%s", %s}], "request_key": "b6-case-%s"}', v_id, v_entry, lpad(v_n::text, 4, '0')));
      v_got := coalesce(pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'token'), pg_temp.t3802b_get(v, 'result', 'results', '0', 'status'));
    else
      v := pg_temp.t3802b_person('growth', format('select public.crm_record_log(%L, %L::jsonb, %L)::text', v_id, '{' || v_entry || '}', 'b6-case-' || lpad(v_n::text, 4, '0')));
      v_got := case when v like 'ERR:%' then split_part(v, ':', 3) else 'logged' end;
    end if;
    v_want := case
      when c.who = 'agent' and c.entry = 'outbound' and c.rule <> 'none' then c.rule
      when c.who = 'agent' and c.entry = 'outbound' and c.touched then 'needs_a_person'
      else 'logged' end;
    if v_got is distinct from v_want then
      v_bad := v_bad || format('[%s %s touched=%s rule=%s: got %s want %s] ', c.who, c.entry, c.touched, c.rule, v_got, v_want);
    end if;
    if v_want = 'logged' then
      if (select a.via is distinct from case c.who when 'agent' then 'claude' end from public.crm_activity a
           where a.record_id = v_id and a.actor_email = 'issue3802b-growth@test.local') then
        v_bad := v_bad || format('[%s %s: wrong via] ', c.who, c.entry);
      end if;
    elsif exists (select 1 from public.crm_activity a where a.record_id = v_id and a.actor_email = 'issue3802b-growth@test.local') then
      v_bad := v_bad || format('[%s %s: a refused entry was written] ', c.who, c.entry);
    end if;
  end loop;
  perform pg_temp.t3802b_check('B-6', 'all 36 cases of the rule', v_n::text || ' ' || v_bad, '36 ');

  -- The edges of the rule, on one record.
  v_id := pg_temp.t3802b_rec('hosts', 'B6 Edges');
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "touch", "channel": "email", "direction": "outbound"}], "request_key": "b6-edge-0001"}', v_id));
  perform pg_temp.t3802b_check('B-6', 'an agent''s outbound touch with no text is refused',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'token') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'message'),
    'invalid_body/Log the message you sent, word for word.');
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "touch", "channel": "email", "direction": "outbound", "body": "First hello"}], "request_key": "b6-edge-0002"}', v_id));
  perform pg_temp.t3802b_check('B-6', 'the first message to someone never contacted is logged, as the person, via the agent',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'status') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'activity', 'via')
      || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'activity', 'actor_email') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'activity', 'body'),
    'logged/claude/issue3802b-growth@test.local/First hello');
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "touch", "channel": "email", "direction": "outbound", "body": "First hello"}], "request_key": "b6-edge-0002"}', v_id));
  perform pg_temp.t3802b_check('B-6', 'the same accepted touch sent again with its key is a replay, not a refusal',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'status') || '/' || (select count(*) from public.crm_activity where record_id = v_id and kind = 'touch'), 'replayed/1');
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "touch", "channel": "email", "direction": "outbound", "body": "Following up", "occurred_at": "2021-01-01T00:00:00Z"}], "request_key": "b6-edge-0003"}', v_id));
  perform pg_temp.t3802b_check('B-6', 'a second outbound touch is a person''s, even dated before the first',
    pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'token') || '/' || pg_temp.t3802b_get(v, 'result', 'results', '0', 'error', 'message'),
    'needs_a_person/"B6 Edges" has already been contacted, so a follow-up or an answer is your person''s to send and log. Tell them what you would say.');
  v := pg_temp.t3802b_person('growth', format($q$select public.crm_record_log(%L, '{"kind": "touch", "channel": "email", "direction": "outbound", "body": "Following up"}', 'b6-edge-0004')::text$q$, v_id));
  perform pg_temp.t3802b_check('B-6', 'the person logs the follow-up, with no via',
    (v::jsonb #>> '{activity,body}') || '/' || coalesce(v::jsonb #>> '{activity,via}', 'none'), 'Following up/none');
  -- A card moved by hand to Contacted, never touched: its first touch is still an agent's to log.
  v_id := pg_temp.t3802b_rec('hosts', 'B6 Moved By Hand', 'contacted');
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "touch", "channel": "whatsapp", "direction": "outbound", "body": "Hello"}], "request_key": "b6-edge-0005"}', v_id));
  perform pg_temp.t3802b_check('B-6', 'the stage is not part of the rule', pg_temp.t3802b_get(v, 'result', 'results', '0', 'status'), 'logged');
end;
$b6$;

-- ---------------------------------------------------------------------------
-- B-7 -- add_records: 50 items, of which 3 repeat a name, 2 repeat an
-- identifier (one by the last nine digits of a phone number) and 2 are
-- invalid.
-- ---------------------------------------------------------------------------
do $b7$
declare
  v_args jsonb;
  v text;
  v2 text;
  r jsonb;
begin
  select jsonb_build_object('pipeline', 'hosts', 'request_key', 'b7-batch-0001', 'records', jsonb_agg(x.item order by x.n))
    into v_args
  from (
    select g as n, jsonb_build_object('name', 'B7 Host ' || g, 'icp', 'experience_host',
             'identifiers', jsonb_build_array(
               jsonb_build_object('kind', 'email', 'value', 'b7-' || g || '@hosts.example'),
               jsonb_build_object('kind', 'phone', 'value', '+234 803 555 ' || lpad((1000 + g)::text, 4, '0'))))
           || case when g = 5 then jsonb_build_object('first_touch', jsonb_build_object('channel', 'email', 'direction', 'outbound', 'body', 'Hello five'))
                   when g = 6 then jsonb_build_object('first_touch', jsonb_build_object('channel', 'fax', 'direction', 'outbound', 'body', 'Hello six'))
                   else '{}'::jsonb end as item
      from generate_series(0, 42) g
    union all select 43, '{"name": "b7  HOST 0"}'::jsonb
    union all select 44, '{"name": "B7 Host 1", "first_touch": {"channel": "email", "direction": "outbound", "body": "Hello again"}}'::jsonb
    union all select 45, '{"name": "B7-Host-2"}'::jsonb
    union all select 46, '{"name": "B7 Other Name A", "identifiers": [{"kind": "email", "value": "B7-3@Hosts.Example"}]}'::jsonb
    union all select 47, '{"name": "B7 Other Name B", "identifiers": [{"kind": "phone", "value": "0803 555 1004"}]}'::jsonb
    union all select 48, '{"name": "B7 Bad ICP", "icp": "ambassador"}'::jsonb
    union all select 49, '{"name": "B7 Bad Identifier", "identifiers": [{"kind": "email", "value": "nope"}]}'::jsonb
  ) x;
  v := pg_temp.t3802b_gw('growth.claude', 'add_records', v_args::text);
  r := v::jsonb -> 'result';
  perform pg_temp.t3802b_check('B-7', 'the counts', (r -> 'counts')::text,
    '{"exists": 5, "created": 43, "invalid": 2, "touches_logged": 1, "touches_refused": 2}');
  perform pg_temp.t3802b_check('B-7', 'one result for each item, in the caller''s order',
    jsonb_array_length(r -> 'results')::text || '/' || (select bool_and((e ->> 'index')::int = ord - 1)::text from jsonb_array_elements(r -> 'results') with ordinality as t(e, ord)), '50/true');
  perform pg_temp.t3802b_check('B-7', 'each status sits where its item was',
    (select string_agg(left(e ->> 'status', 1), '' order by ord) from jsonb_array_elements(r -> 'results') with ordinality as t(e, ord)),
    repeat('c', 43) || 'eeeeeii');
  perform pg_temp.t3802b_check('B-7', 'a repeated name says so and names the record that is there',
    (r #>> '{results,43,reason}') || '/' || (r #>> '{results,43,existing,name}') || '/' || (r #>> '{results,45,reason}'), 'name/B7 Host 0/name');
  perform pg_temp.t3802b_check('B-7', 'a repeated email says so, with what matched',
    (r #>> '{results,46,reason}') || '/' || (r #>> '{results,46,existing,name}') || '/' || (r #>> '{results,46,matched_on,0,kind}') || '/' || (r #>> '{results,46,matched_on,0,rule}'),
    'identifier/B7 Host 3/email/exact');
  perform pg_temp.t3802b_check('B-7', 'a phone number in its local form matches by its last nine digits',
    (r #>> '{results,47,reason}') || '/' || (r #>> '{results,47,existing,name}') || '/' || (r #>> '{results,47,matched_on,0,rule}'),
    'identifier/B7 Host 4/last_9_digits');
  perform pg_temp.t3802b_check('B-7', 'an invalid item explains itself with a token and words',
    (r #>> '{results,48,error,token}') || '/' || (r #>> '{results,49,error,token}') || '/' || ((r #>> '{results,49,error,message}') like '"nope" is not a usable email.%')::text,
    'invalid_icp/invalid_identifier/true');
  perform pg_temp.t3802b_check('B-7', 'a first touch is logged on a new record',
    (r #>> '{results,5,touch,status}') || '/' || (r #>> '{results,5,touch,activity,via}') || '/' || (r #>> '{results,5,record,touch_count}'), 'logged/claude/1');
  perform pg_temp.t3802b_check('B-7', 'a first touch that is refused does not undo its record',
    (r #>> '{results,6,status}') || '/' || (r #>> '{results,6,touch,status}') || '/' || (r #>> '{results,6,touch,error,token}'), 'created/refused/invalid_channel');
  perform pg_temp.t3802b_check('B-7', 'a first touch on a record that was already there is not logged, and says why',
    (r #>> '{results,44,status}') || '/' || (r #>> '{results,44,touch,status}') || '/' || (r #>> '{results,44,touch,error,token}'), 'exists/refused/exists');
  perform pg_temp.t3802b_check('B-7', '43 records exist, each added by the person, via the agent',
    (select count(*)::text || '/' || count(*) filter (where c.created_by = 'issue3802b-growth@test.local')
       from public.crm_records c where c.name like 'B7 %' and c.deleted_at is null)
      || '/' || (select count(*) from public.crm_activity a join public.crm_records c on c.id = a.record_id
                  where c.name like 'B7 %' and a.kind = 'created' and a.via = 'claude' and a.actor_email = 'issue3802b-growth@test.local')
      || '/' || (select count(*) from public.admin_audit_log a where a.action = 'crm.record_create' and a.admin_email = 'issue3802b-growth@test.local'
                  and a.metadata ->> 'via' = 'claude' and a.metadata ->> 'name' like 'B7 %'), '43/43/43/43');
  perform pg_temp.t3802b_check('B-7', 'the request row holds counts only',
    (select c.items::text || '/' || c.outcome || '/' || c.summary::text from public.team_agent_calls c where c.tool = 'add_records' order by c.started_at desc limit 1),
    '44/ok/{"exists": 5, "logged": 1, "created": 43, "refused": 4, "replayed": 0}');
  -- The same request again.
  v2 := pg_temp.t3802b_gw('growth.claude', 'add_records', v_args::text);
  perform pg_temp.t3802b_check('B-7', 'the same request key again returns the same results, marked as a replay',
    ((v2::jsonb #> '{result,results}') - 5 = (r -> 'results') - 5)::text || '/' || (v2::jsonb #>> '{result,replayed}')
      || '/' || (v2::jsonb #>> '{result,results,5,touch,status}'), 'true/true/replayed');
  perform pg_temp.t3802b_check('B-7', 'and writes nothing',
    (select count(*)::text from public.crm_records c where c.name like 'B7 %')
      || '/' || (select count(*) from public.crm_activity a join public.crm_records c on c.id = a.record_id where c.name like 'B7 %')
      || '/' || (select c.items::text from public.team_agent_calls c where c.tool = 'add_records' order by c.started_at desc, c.id limit 1), '43/44/0');
  -- Shape.
  perform pg_temp.t3802b_like('B-7', 'no request key is refused in plain words',
    pg_temp.t3802b_gw('growth.claude', 'add_records', '{"pipeline": "hosts", "records": [{"name": "B7 No Key"}]}'), '%"token": "request_key_required"%');
  perform pg_temp.t3802b_like('B-7', 'fifty-one items are refused whole',
    pg_temp.t3802b_gw('growth.claude', 'add_records', jsonb_build_object('pipeline', 'hosts', 'request_key', 'b7-batch-0002',
      'records', (select jsonb_agg(jsonb_build_object('name', 'B7 Over ' || g)) from generate_series(1, 51) g))::text), '%"token": "too_many_items"%');
  perform pg_temp.t3802b_like('B-7', 'an item that is not an object is refused whole',
    pg_temp.t3802b_gw('growth.claude', 'add_records', '{"pipeline": "hosts", "records": ["B7 Text"], "request_key": "b7-batch-0003"}'), '%"token": "invalid_arguments"%');
  perform pg_temp.t3802b_like('B-7', 'an agent cannot add a second record that shares a contact detail',
    pg_temp.t3802b_gw('growth.claude', 'add_records', '{"pipeline": "hosts", "records": [{"name": "B7 Shared", "identifiers": [{"kind": "email", "value": "b7-3@hosts.example"}], "allow_shared_identifier": true}], "request_key": "b7-batch-0004"}'),
    '%"token": "field_not_for_agents", "message": "Only a person can add a second record that shares a contact detail. Ask your person."%');
  perform pg_temp.t3802b_check('B-7', 'none of the refused requests made a record',
    (select count(*)::text from public.crm_records c where c.name ~ '^B7 (No Key|Over|Text|Shared)'), '0');
end;
$b7$;

-- ---------------------------------------------------------------------------
-- B-8 -- the other tools.
-- ---------------------------------------------------------------------------
do $b8$
declare
  v text;
  v_c uuid;   -- a Contacted host
  v_m uuid;   -- a Meeting host
  v_l uuid;   -- a Lost host
  v_p uuid;   -- a Prospect
  v_x uuid;
  v_gone constant text := '38020000-0000-4000-bfff-000000000001';
begin
  v_c := pg_temp.t3802b_rec('hosts', 'B8 Contacted', 'contacted');
  v_m := pg_temp.t3802b_rec('hosts', 'B8 Meeting', 'meeting');
  v_l := pg_temp.t3802b_rec('hosts', 'B8 Lost', 'lost');
  v_p := pg_temp.t3802b_rec('hosts', 'B8 Prospect');
  perform pg_temp.t3802b_rec('hosts', 'B8 Untouched');

  -- move_stage.
  v := pg_temp.t3802b_gw('partner.claude', 'move_stage', format(
    '{"moves": [{"id": "%s", "to": "contacted", "expected_from": "prospect"}, {"id": "%s", "to": "meeting", "expected_from": "prospect"}, {"id": "%s", "to": "meeting", "expected_from": "meeting"}, {"id": "%s", "to": "meeting"}, {"id": "%s", "to": "replied", "expected_from": "prospect"}, {"id": "%s", "to": "live", "expected_from": "contacted"}, {"id": "not-an-id", "to": "replied", "expected_from": "prospect"}]}',
    v_p, v_c, v_m, v_c, v_gone, v_p));
  perform pg_temp.t3802b_check('B-8', 'move_stage: each item has its own answer, in order',
    (select string_agg(coalesce(e #>> '{error,token}', e ->> 'status'), ',' order by ord) from jsonb_array_elements(v::jsonb #> '{result,results}') with ordinality as t(e, ord)),
    'moved,stage_changed,already_there,invalid_arguments,not_found,stage_sets_itself,invalid_id');
  perform pg_temp.t3802b_check('B-8', 'move_stage: a stale stage moves nothing and names where the card is',
    (v::jsonb #>> '{result,results,1,error,message}') || '/' || (select stage from public.crm_records where id = v_c),
    'This card is in Contacted now, not Prospect, so nothing was moved. Read the card again and move it from where it is./contacted');
  perform pg_temp.t3802b_check('B-8', 'move_stage: a move without the stage it was seen in is refused in its place',
    v::jsonb #>> '{result,results,3,error,message}', '"moves[3].expected_from" is missing or the wrong kind. Send the stage you saw the card in.');
  perform pg_temp.t3802b_check('B-8', 'move_stage: the move is logged as the person, via the agent, and the counts add up',
    (select a.actor_email || '/' || a.via || '/' || a.from_stage || '>' || a.to_stage from public.crm_activity a where a.record_id = v_p and a.kind = 'stage_move')
      || '/' || (v::jsonb #> '{result,counts}')::text,
    'issue3802b-partner@test.local/claude/prospect>contacted/{"error": 5, "moved": 1, "already_there": 1}');

  -- set_owners.
  v := pg_temp.t3802b_gw('growth.claude', 'set_owners', format(
    '{"items": [{"id": "%s", "owner_emails": ["issue3802b-partner@test.local", "Issue3802b-Growth@test.local"]}, {"id": "%s", "owner_emails": ["stranger@elsewhere.example"]}, {"id": "%s", "owner_emails": []}]}', v_p, v_c, v_m));
  perform pg_temp.t3802b_check('B-8', 'set_owners: set, refused for someone not on the team, and unchanged for no change',
    (v::jsonb #>> '{result,results,0,status}') || '/' || (v::jsonb #> '{result,results,0,record,owners}')::text
      || '/' || (v::jsonb #>> '{result,results,1,error,token}') || '/' || (v::jsonb #>> '{result,results,2,status}'),
    'updated/["issue3802b-growth@test.local", "issue3802b-partner@test.local"]/unknown_owner/unchanged');

  -- update_records.
  v := pg_temp.t3802b_gw('growth.claude', 'update_records', format(
    '{"updates": [{"id": "%s", "changes": {"next_action": "Call Friday", "due_on": "2026-11-02", "identifiers": [{"kind": "handle", "value": "@b8.prospect"}]}}, {"id": "%s", "changes": {"stage": "live"}}, {"id": "%s", "changes": {"next_action": "Call Friday"}}, {"id": "%s", "changes": {"contact": null}, "extra": 1}]}',
    v_p, v_c, v_p, v_c));
  perform pg_temp.t3802b_check('B-8', 'update_records: updated, refused for a field it cannot change, unchanged, and refused for an extra key',
    (v::jsonb #>> '{result,results,0,status}') || '/' || (v::jsonb #>> '{result,results,0,record,next_action}') || '/' || (v::jsonb #>> '{result,results,0,record,identifiers,0,key}')
      || '/' || (v::jsonb #>> '{result,results,1,error,token}') || '/' || (v::jsonb #>> '{result,results,2,status}') || '/' || (v::jsonb #>> '{result,results,3,error,token}'),
    'updated/Call Friday/b8.prospect/unknown_field/unchanged/unknown_field');
  perform pg_temp.t3802b_check('B-8', 'update_records: the audit row carries the agent',
    (select a.metadata ->> 'via' from public.admin_audit_log a where a.action = 'crm.record_update' and a.target_id = v_p::text order by a.created_at desc limit 1), 'claude');

  -- record_reply.
  v := pg_temp.t3802b_gw('growth.claude', 'record_reply', format(
    '{"replies": [{"id": "%s", "channel": "instagram_dm", "body": "Sure, call me Friday", "reply_class": "interested"}, {"id": "%s", "channel": "email", "body": "See you then"}, {"id": "%s", "channel": "email", "body": "Actually we are back"}, {"id": "%s", "channel": "email", "body": "Not for us", "move_to": "lost"}, {"id": "%s", "channel": "email", "body": "  "}, {"id": "%s", "channel": "email", "body": "x", "extra": true}], "request_key": "b8-reply-0001"}',
    v_c, v_m, v_l, v_p, v_c, v_c));
  perform pg_temp.t3802b_check('B-8', 'record_reply: a Contacted host is logged and moves to Replied',
    (v::jsonb #>> '{result,results,0,status}') || '/' || (v::jsonb #>> '{result,results,0,moved_to}') || '/' || (v::jsonb #>> '{result,results,0,record,stage}')
      || '/' || (v::jsonb #>> '{result,results,0,activity,direction}') || '/' || (v::jsonb #>> '{result,results,0,activity,body}') || '/' || (v::jsonb #>> '{result,results,0,activity,via}'),
    'logged/replied/replied/inbound/Sure, call me Friday/claude');
  perform pg_temp.t3802b_check('B-8', 'record_reply: a Meeting host is logged and stays, saying why',
    (v::jsonb #>> '{result,results,1,status}') || '/' || coalesce(v::jsonb #>> '{result,results,1,moved_to}', 'null') || '/' || (v::jsonb #>> '{result,results,1,move_note}'),
    'logged/null/Already in Meeting, so the card stayed where it is.');
  perform pg_temp.t3802b_check('B-8', 'record_reply: a Lost host is logged and stays, saying why',
    (v::jsonb #>> '{result,results,2,status}') || '/' || coalesce(v::jsonb #>> '{result,results,2,moved_to}', 'null') || '/' || (v::jsonb #>> '{result,results,2,move_note}'),
    'logged/null/This card is in Lost, so it stayed there. Move it yourself if they are back.');
  perform pg_temp.t3802b_check('B-8', 'record_reply: a move to Lost with no reason keeps the reply and says what the move needs',
    (v::jsonb #>> '{result,results,3,status}') || '/' || coalesce(v::jsonb #>> '{result,results,3,moved_to}', 'null') || '/' || ((v::jsonb #>> '{result,results,3,move_note}') like 'reason_required:%')::text
      || '/' || (select count(*) from public.crm_activity a where a.record_id = v_p and a.kind = 'touch' and a.direction = 'inbound')
      || '/' || (select stage from public.crm_records where id = v_p),
    'logged/null/true/1/contacted');
  perform pg_temp.t3802b_check('B-8', 'record_reply: no words, or an extra key, is refused in its place',
    (v::jsonb #>> '{result,results,4,error,token}') || '/' || (v::jsonb #>> '{result,results,5,error,token}'), 'invalid_body/unknown_field');
  v := pg_temp.t3802b_gw('growth.claude', 'record_reply', format(
    '{"replies": [{"id": "%s", "channel": "instagram_dm", "body": "Sure, call me Friday", "reply_class": "interested"}], "request_key": "b8-reply-0001"}', v_c));
  perform pg_temp.t3802b_check('B-8', 'record_reply: the same reply again with its key is a replay and logs nothing',
    (v::jsonb #>> '{result,results,0,status}') || '/' || (select count(*) from public.crm_activity a where a.record_id = v_c and a.kind = 'touch'), 'replayed/1');
  v := pg_temp.t3802b_gw('growth.claude', 'record_reply', format(
    '{"replies": [{"id": "%s", "channel": "email", "body": "We closed", "move_to": "lost", "reason": "Closed down"}], "request_key": "b8-reply-0002"}', v_m));
  perform pg_temp.t3802b_check('B-8', 'record_reply: a move that is asked for, with its reason, is made',
    (v::jsonb #>> '{result,results,0,moved_to}') || '/' || (v::jsonb #>> '{result,results,0,record,stage_reason}'), 'lost/Closed down');

  -- upsert_record.
  v := pg_temp.t3802b_gw('growth.claude', 'upsert_record',
    '{"pipeline": "creators", "record": {"name": "B8 New Creator", "icp": "ambassador", "identifiers": [{"kind": "handle", "value": "tiktok.com/@b8.creator"}]}, "touch": {"channel": "tiktok_dm", "direction": "outbound", "body": "Love your videos"}, "request_key": "b8-upsert-0001"}');
  v_x := (v::jsonb #>> '{result,record,id}')::uuid;
  perform pg_temp.t3802b_check('B-8', 'upsert_record: a new name is created and its touch logged',
    (v::jsonb #>> '{result,status}') || '/' || (v::jsonb #>> '{result,touch,status}') || '/' || (v::jsonb #>> '{result,record,touch_count}')
      || '/' || (v::jsonb #>> '{result,record,identifiers,0,platform}') || '/' || (v::jsonb #>> '{result,replayed}'), 'created/logged/1/tiktok/false');
  v := pg_temp.t3802b_gw('growth.claude', 'upsert_record',
    '{"pipeline": "creators", "record": {"name": "B8 New Creator", "icp": "ambassador", "identifiers": [{"kind": "handle", "value": "tiktok.com/@b8.creator"}]}, "touch": {"channel": "tiktok_dm", "direction": "outbound", "body": "Love your videos"}, "request_key": "b8-upsert-0001"}');
  perform pg_temp.t3802b_check('B-8', 'upsert_record: the same request again is a replay of both',
    (v::jsonb #>> '{result,status}') || '/' || (v::jsonb #>> '{result,touch,status}') || '/' || (v::jsonb #>> '{result,replayed}')
      || '/' || (select count(*) from public.crm_activity a where a.record_id = v_x and a.kind = 'touch'), 'created/replayed/true/1');
  v := pg_temp.t3802b_gw('growth.claude', 'upsert_record',
    '{"pipeline": "creators", "record": {"name": "A Different Name", "icp": "ugc_one_off", "contact": "changed", "identifiers": [{"kind": "handle", "value": "@B8.Creator"}]}, "touch": {"channel": "tiktok_dm", "direction": "outbound", "body": "Again"}, "request_key": "b8-upsert-0002"}');
  perform pg_temp.t3802b_check('B-8', 'upsert_record: an existing, touched record is found by its handle, left as it is, and the touch is a person''s',
    (v::jsonb #>> '{result,status}') || '/' || (v::jsonb #>> '{result,reason}') || '/' || (v::jsonb #>> '{result,record,id}') || '/' || (v::jsonb #>> '{result,record,name}')
      || '/' || (v::jsonb #>> '{result,record,icp}') || '/' || coalesce(v::jsonb #>> '{result,record,contact}', 'null')
      || '/' || (v::jsonb #>> '{result,touch,status}') || '/' || (v::jsonb #>> '{result,touch,error,token}'),
    'exists/identifier/' || v_x || '/B8 New Creator/ambassador/null/refused/needs_a_person');
  v := pg_temp.t3802b_gw('growth.claude', 'upsert_record', format(
    '{"pipeline": "hosts", "record": {"name": "b8 untouched", "icp": "venue_gallery", "next_action": "changed"}, "touch": {"channel": "email", "direction": "outbound", "body": "First words"}, "request_key": "b8-upsert-0003"}'));
  perform pg_temp.t3802b_check('B-8', 'upsert_record: an existing record that was never contacted gets its first touch, and none of its fields change',
    (v::jsonb #>> '{result,status}') || '/' || (v::jsonb #>> '{result,reason}') || '/' || (v::jsonb #>> '{result,touch,status}')
      || '/' || (v::jsonb #>> '{result,record,name}') || '/' || coalesce(v::jsonb #>> '{result,record,icp}', 'null')
      || '/' || coalesce(v::jsonb #>> '{result,record,next_action}', 'null') || '/' || (v::jsonb #>> '{result,record,touch_count}'),
    'exists/name/logged/B8 Untouched/null/null/1');
  v := pg_temp.t3802b_gw('growth.claude', 'upsert_record',
    '{"pipeline": "hosts", "record": {"name": "B8 Meeting"}, "touch": {"channel": "email", "direction": "inbound", "body": "They wrote"}, "request_key": "b8-upsert-0004"}');
  perform pg_temp.t3802b_check('B-8', 'upsert_record: a reply is always logged on the record that is there',
    (v::jsonb #>> '{result,status}') || '/' || (v::jsonb #>> '{result,touch,status}') || '/' || (v::jsonb #>> '{result,touch,activity,direction}'), 'exists/logged/inbound');

  -- check_contactable and search.
  v := pg_temp.t3802b_gw('growth.claude', 'check_contactable',
    '{"pipeline": "creators", "candidates": [{"identifiers": [{"kind": "handle", "value": "https://www.tiktok.com/@B8.Creator?lang=en"}]}, {"name": "Somebody New", "identifiers": [{"kind": "email", "value": "new@creators.example"}]}, {"name": "x", "identifiers": [{"kind": "email", "value": "b8.c"}]}, {}, {"name": "B8 New Creator Two"}]}');
  perform pg_temp.t3802b_check('B-8', 'check_contactable: a handle written as a profile address finds the record that stores it',
    (v::jsonb #>> '{result,results,0,verdict}') || '/' || (v::jsonb #>> '{result,results,0,match}') || '/' || (v::jsonb #>> '{result,results,0,record,id}')
      || '/' || (v::jsonb #>> '{result,results,0,matched_on,0,rule}') || '/' || (v::jsonb #>> '{result,results,0,record,last_touch,text}'),
    'exists/identifier/' || v_x || '/exact/Love your videos');
  perform pg_temp.t3802b_check('B-8', 'check_contactable: someone new is new; a fragment of an email is not an email; an empty candidate is invalid; a close name is offered',
    (v::jsonb #>> '{result,results,1,verdict}') || '/' || (v::jsonb #>> '{result,results,2,verdict}') || '/' || (v::jsonb #>> '{result,results,3,verdict}')
      || '/' || (v::jsonb #>> '{result,results,4,verdict}') || '/' || (v::jsonb #>> '{result,results,4,similar,0,name}') || '/' || (v::jsonb #> '{result,counts}')::text,
    'new/invalid/invalid/new/B8 New Creator/{"new": 2, "exists": 1, "invalid": 2, "do_not_contact": 0, "warm_intro_only": 0}');
  v := pg_temp.t3802b_gw('growth.claude', 'check_contactable',
    '{"pipeline": "hosts", "candidates": [{"name": "Unknown Venue", "identifiers": [{"kind": "phone", "value": "0803 555 1007"}]}, {"name": "B7 Host 9", "identifiers": [{"kind": "email", "value": "b7-10@hosts.example"}]}]}');
  perform pg_temp.t3802b_check('B-8', 'check_contactable: a local phone number finds the record that stores it internationally; a name and an identifier of two records say both',
    (v::jsonb #>> '{result,results,0,verdict}') || '/' || (v::jsonb #>> '{result,results,0,record,name}') || '/' || (v::jsonb #>> '{result,results,0,matched_on,0,rule}')
      || '/' || (v::jsonb #>> '{result,results,1,match}') || '/' || (v::jsonb #>> '{result,results,1,record,name}') || '/' || (v::jsonb #>> '{result,results,1,other_matches}'),
    'exists/B7 Host 7/last_9_digits/both/B7 Host 10/1');
  perform pg_temp.t3802b_check('B-8', 'check_contactable: the browser gets the same answer from the same function',
    (pg_temp.t3802b_person('growth', $q$select public.crm_contact_check('hosts', '[{"name": "Unknown Venue", "identifiers": [{"kind": "phone", "value": "0803 555 1007"}]}]')::text$q$)::jsonb #>> '{results,0,record,name}'), 'B7 Host 7');
  perform pg_temp.t3802b_like('B-8', 'check_contactable: fifty-one candidates are refused whole',
    pg_temp.t3802b_gw('growth.claude', 'check_contactable', jsonb_build_object('pipeline', 'hosts',
      'candidates', (select jsonb_agg(jsonb_build_object('name', 'n' || g)) from generate_series(1, 51) g))::text), '%"token": "too_many"%');
  perform pg_temp.t3802b_check('B-8', 'find_records: an email, the digits of a phone, a handle with or without @, and part of a handle all find the record',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "q": "B7-12@hosts.example"}'), 'result', 'records', '0', 'name')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "q": "08035551013"}'), 'result', 'records', '0', 'name')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "q": "555 1014"}'), 'result', 'records', '0', 'name')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "q": "@B8.Prospect"}'), 'result', 'records', '0', 'name')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "q": "b8.pros"}'), 'result', 'records', '0', 'name')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('growth.claude', 'find_records', '{"pipeline": "hosts", "q": "b8"}'), 'result', 'total'),
    'B7 Host 12/B7 Host 13/B7 Host 14/B8 Prospect/B8 Prospect/5');

  -- Roles and words.
  perform pg_temp.t3802b_check('B-8', 'a partner, an admin and the owner can each write through their own key, as themselves',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('partner.claude', 'upsert_record', '{"pipeline": "hosts", "record": {"name": "B8 By Partner"}, "request_key": "b8-role-0001"}'), 'result', 'record', 'created_by')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('admin.claude', 'upsert_record', '{"pipeline": "hosts", "record": {"name": "B8 By Admin"}, "request_key": "b8-role-0002"}'), 'result', 'record', 'created_by')
      || '/' || pg_temp.t3802b_get(pg_temp.t3802b_gw('owner.claude', 'upsert_record', '{"pipeline": "hosts", "record": {"name": "B8 By Owner"}, "request_key": "b8-role-0003"}'), 'result', 'record', 'created_by'),
    'issue3802b-partner@test.local/issue3802b-admin@test.local/issue3802b-owner@test.local');
  perform pg_temp.t3802b_like('B-8', 'team_summary is still for an owner or admin only',
    pg_temp.t3802b_gw('growth.claude', 'team_summary'), '%"ok": false%"token": "forbidden"%');
  perform pg_temp.t3802b_check('B-8', 'get_started says it reads and writes, and tells the agent nothing about adding a region',
    (pg_temp.t3802b_gw('growth.claude', 'get_started')::jsonb #>> '{result,status}' like 'This connection reads and writes.%')::text
      || '/' || ((pg_temp.t3802b_gw('growth.claude', 'get_started')::jsonb #> '{result,me}') ? 'can_add_region')::text
      || '/' || jsonb_array_length(pg_temp.t3802b_gw('growth.claude', 'get_started')::jsonb #> '{result,rules}')
      || '/' || jsonb_array_length(pg_temp.t3802b_gw('growth.claude', 'get_started')::jsonb #> '{result,routines}'), 'true/false/14/6');
  perform pg_temp.t3802b_check('B-8', 'every routine names only tools that exist',
    (select count(*)::text from jsonb_array_elements(public.team_agent_guide_def() -> 'routines') r,
       lateral regexp_matches(r ->> 'text', '\m([a-z]+_[a-z_]+)\M', 'g') m
      where m[1] not in ('my_day', 'find_records', 'needs_reply', 'count_by', 'list_beta_leads', 'check_contactable', 'add_records', 'record_reply')), '0');
  perform pg_temp.t3802b_check('B-8', 'config tells an owner or admin, and nobody else, that they can add a city',
    (pg_temp.t3802b_person('admin', 'select public.crm_config()::text')::jsonb #>> '{me,can_add_region}')
      || '/' || (pg_temp.t3802b_person('growth', 'select public.crm_config()::text')::jsonb #>> '{me,can_add_region}'), 'true/false');
  perform pg_temp.t3802b_like('B-8', 'a city that is not a Launch City is refused in words that say what to do',
    pg_temp.t3802b_person('growth', $q$select public.crm_record_create('hosts', '{"name": "B8 Nowhere", "region_id": "38020000-0000-4000-b200-0000000000ff"}', 'b8-region-0001')::text$q$),
    'ERR:22023:invalid_region: That city is not in the Launch Cities list. Use an id from crm_config().regions, or leave the region out and ask an owner or admin to add the city.');
end;
$b8$;

-- ---------------------------------------------------------------------------
-- B-9 -- request keys across tools; one refused item; a fault on the server.
-- ---------------------------------------------------------------------------
do $b9$
declare
  v text;
  v_a uuid := pg_temp.t3802b_rec('hosts', 'B9 One');
  v_b uuid := pg_temp.t3802b_rec('hosts', 'B9 Two');
  v_before bigint;
begin
  -- One request key, four tools: no tool replays another's answer.
  v := pg_temp.t3802b_gw('growth.claude', 'add_records', '{"pipeline": "hosts", "records": [{"name": "B9 Added", "first_touch": {"channel": "email", "direction": "outbound", "body": "Hi"}}], "request_key": "b9-same-key-01"}');
  perform pg_temp.t3802b_check('B-9', 'add_records with the key', v::jsonb #>> '{result,results,0,status}', 'created');
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "note", "body": "A note"}], "request_key": "b9-same-key-01"}', v_a));
  perform pg_temp.t3802b_check('B-9', 'log_activity with the same key logs its own entry', v::jsonb #>> '{result,results,0,status}', 'logged');
  v := pg_temp.t3802b_gw('growth.claude', 'record_reply', format('{"replies": [{"id": "%s", "channel": "email", "body": "A reply"}], "request_key": "b9-same-key-01"}', v_a));
  perform pg_temp.t3802b_check('B-9', 'record_reply with the same key logs its own entry', v::jsonb #>> '{result,results,0,status}', 'logged');
  v := pg_temp.t3802b_gw('growth.claude', 'upsert_record', '{"pipeline": "hosts", "record": {"name": "B9 Upserted"}, "touch": {"channel": "email", "direction": "outbound", "body": "Hi"}, "request_key": "b9-same-key-01"}');
  perform pg_temp.t3802b_check('B-9', 'upsert_record with the same key adds and logs its own',
    (v::jsonb #>> '{result,status}') || '/' || (v::jsonb #>> '{result,touch,status}') || '/' || (v::jsonb #>> '{result,replayed}'), 'created/logged/false');
  perform pg_temp.t3802b_check('B-9', 'six stored keys, each under the function it was used for',
    (select string_agg(k.request_key || '=' || k.fn, ' ' order by k.request_key) from public.crm_request_keys k
      where k.actor_email = 'issue3802b-growth@test.local' and k.request_key like 'b9-same-key-01%'),
    'b9-same-key-01=crm_records_bulk_create b9-same-key-01-c=crm_record_create b9-same-key-01-l0=crm_record_log b9-same-key-01-r0=crm_record_log b9-same-key-01-t0=crm_record_log b9-same-key-01-u=crm_record_log');
  perform pg_temp.t3802b_like('B-9', 'a request key that is too long to derive from is refused',
    pg_temp.t3802b_gw('growth.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "note", "body": "x"}], "request_key": "%s"}', v_a, repeat('k', 71))),
    '%"token": "request_key_required"%');

  -- One refused item never stops the rest.
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format(
    '{"entries": [{"id": "%s", "kind": "note", "body": "First"}, {"id": "%s", "kind": "shout", "body": "x"}, {"id": "38020000-0000-4000-bfff-000000000002", "kind": "note", "body": "x"}, {"id": "%s", "kind": "note", "body": "Last"}], "request_key": "b9-mixed-0001"}', v_a, v_a, v_b));
  perform pg_temp.t3802b_check('B-9', 'a refused item and a missing record sit beside two that were logged',
    (select string_agg(coalesce(e #>> '{error,token}', e ->> 'status'), ',' order by ord) from jsonb_array_elements(v::jsonb #> '{result,results}') with ordinality as t(e, ord))
      || '/' || (v::jsonb #> '{result,counts}')::text, 'logged,invalid_kind,not_found,logged/{"error": 2, "logged": 2, "replayed": 0}');
  perform pg_temp.t3802b_check('B-9', 'the request row holds those counts and no text',
    (select c.items::text || '/' || c.summary::text from public.team_agent_calls c where c.tool = 'log_activity' order by c.started_at desc, c.id limit 1),
    '2/{"logged": 2, "refused": 2, "replayed": 0}');

  -- A fault on the server at one item saves nothing from the whole request.
  select count(*) into v_before from public.crm_activity;
  create function pg_temp.t3802b_fault() returns trigger language plpgsql as $f$
  begin
    if new.body = 'issue3802b-fault' then
      raise exception 'planted fault' using errcode = 'XX000';
    end if;
    return new;
  end;
  $f$;
  create trigger issue3802b_fault before insert on public.crm_activity for each row execute function pg_temp.t3802b_fault();
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format(
    '{"entries": [{"id": "%s", "kind": "note", "body": "Kept?"}, {"id": "%s", "kind": "note", "body": "issue3802b-fault"}], "request_key": "b9-fault-0001"}', v_a, v_b));
  perform pg_temp.t3802b_check('B-9', 'the answer is try_again, naming the item, in plain words',
    (v::jsonb #>> '{ok}') || '/' || (v::jsonb #>> '{error,token}') || '/' || (v::jsonb #>> '{error,message}'),
    'false/try_again/Something went wrong on our side at item 2, so nothing in this request was saved. Send the same request again.');
  perform pg_temp.t3802b_check('B-9', 'nothing was saved: no log line, no stored key',
    ((select count(*) from public.crm_activity) = v_before)::text || '/' || (select count(*) from public.crm_request_keys where request_key like 'b9-fault-%'), 'true/0');
  perform pg_temp.t3802b_check('B-9', 'the request is recorded as that outcome, with no counts',
    (select c.outcome || '/' || c.items || '/' || c.summary::text from public.team_agent_calls c where c.tool = 'log_activity' order by c.started_at desc, c.id limit 1), 'try_again/0/{}');
  drop trigger issue3802b_fault on public.crm_activity;
  v := pg_temp.t3802b_gw('growth.claude', 'log_activity', format(
    '{"entries": [{"id": "%s", "kind": "note", "body": "Kept?"}, {"id": "%s", "kind": "note", "body": "issue3802b-fault"}], "request_key": "b9-fault-0001"}', v_a, v_b));
  perform pg_temp.t3802b_check('B-9', 'the same request sent again goes through', (v::jsonb #> '{result,counts}')::text, '{"error": 0, "logged": 2, "replayed": 0}');
  perform pg_temp.t3802b_check('B-9', 'no text in any agent answer names an internal function of the keys',
    (pg_temp.t3802b_gw('growth.claude', 'get_started') !~ 'team_agent_|admin_team_')::text, 'true');
end;
$b9$;

-- ---------------------------------------------------------------------------
-- B-10 -- the daily limit on records written.
-- ---------------------------------------------------------------------------
do $b10$
declare
  v text;
  v_key uuid := (select id from public.team_agent_keys where key_hash = pg_temp.t3802b_digest(pg_temp.t3802b_id('admin.claude')));
  v_id uuid := pg_temp.t3802b_rec('hosts', 'B10 One');
begin
  perform pg_temp.t3802b_next_request();
  delete from public.team_agent_calls where key_id = v_key;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, outcome, items)
  values (v_key, 'issue3802b-admin@test.local', '38020000-0000-4000-b000-000000000002', 'claude', 'add_records', '3'::xid8,
          date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', 'ok', 19999);
  v := pg_temp.t3802b_gw('admin.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "note", "body": "The last one"}], "request_key": "b10-limit-001"}', v_id));
  perform pg_temp.t3802b_check('B-10', 'one short of the limit, a write is served', v::jsonb #>> '{result,results,0,status}', 'logged');
  v := pg_temp.t3802b_gw('admin.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "note", "body": "One too many"}], "request_key": "b10-limit-002"}', v_id));
  perform pg_temp.t3802b_check('B-10', 'at 20,000 records written the next write is told so',
    (v::jsonb #>> '{limited,token}') || '/' || (v::jsonb #>> '{limited,message}'),
    'daily_limit/Your agent reached today''s limit of 20000 records written. It resets at midnight UTC. Ask the owner if you need more.');
  perform pg_temp.t3802b_check('B-10', 'and nothing was logged',
    (select count(*)::text from public.crm_activity where record_id = v_id), '1');
  perform pg_temp.t3802b_check('B-10', 'reads still work',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('admin.claude', 'find_records', '{"pipeline": "hosts", "q": "B10"}'), 'result', 'total'), '1');
  perform pg_temp.t3802b_check('B-10', 'another key is unaffected',
    pg_temp.t3802b_get(pg_temp.t3802b_gw('owner.claude', 'log_activity', format('{"entries": [{"id": "%s", "kind": "note", "body": "Owner"}], "request_key": "b10-limit-003"}', v_id)), 'result', 'results', '0', 'status'), 'logged');
end;
$b10$;

-- ---------------------------------------------------------------------------
-- B-11 -- both self-check blocks, as shipped and against mistakes.
-- ---------------------------------------------------------------------------
do $b11$
declare
  m record;
  v_got text;
  v_sql text;
begin
  for m in
    select * from (values
      ('check',   'as shipped', null, 'passed'),
      ('w4check', 'as shipped', null, 'passed'),
      ('check',   'the contactable check opened to anon', $q$grant execute on function public.crm_contact_check(text, jsonb) to anon$q$, '%anon can execute public.crm_contact_check(text,jsonb)%'),
      ('check',   'the normal form opened to signed-in users', $q$grant execute on function public.crm_ident_key(text, text) to authenticated$q$, '%authenticated can execute the internal public.crm_ident_key(text,text)%'),
      ('check',   'the identifiers table readable by signed-in users', $q$grant select on public.crm_record_identifiers to authenticated$q$, '%authenticated holds SELECT on public.crm_record_identifiers%'),
      ('check',   'a policy on the identifiers table', $q$create policy issue3802b_planted on public.crm_record_identifiers for select using (true)$q$, '%a policy exists on public.crm_record_identifiers%'),
      ('check',   'a stray pipeline function', $q$create function public.crm_issue3802b_stray() returns int language sql as 'select 1'$q$, '%crm_ function(s) are not in the checked list%'),
      ('check',   'an ICP the records table does not accept', $q$alter table public.crm_records drop constraint crm_records_icp_check, add constraint crm_records_icp_check check (icp is null or icp <> 'experience_host') not valid$q$, '%crm_pipeline_def and the crm_records CHECK constraints disagree%'),
      ('w4check', 'the exchange opened to signed-in users', $q$grant execute on function public.team_agent_setup_redeem(text, text) to authenticated$q$, '%authenticated can execute the internal public.team_agent_setup_redeem(text,text)%'),
      ('w4check', 'the key maker opened to signed-in users', $q$grant execute on function public.team_agent_key_issue(text, text, text, text) to authenticated$q$, '%authenticated can execute the internal public.team_agent_key_issue(text,text,text,text)%'),
      ('w4check', 'the access rule opened to anon', $q$grant execute on function public.team_agent_person(text) to anon$q$, '%anon can execute public.team_agent_person(text)%'),
      ('w4check', 'making a code closed to signed-in users', $q$revoke execute on function public.team_agent_setup_create(text, text) from authenticated$q$, '%authenticated cannot execute public.team_agent_setup_create(text,text)%'),
      ('w4check', 'the setup codes readable by signed-in users', $q$grant select on public.team_agent_setup_codes to authenticated$q$, '%authenticated holds SELECT on public.team_agent_setup_codes%'),
      ('w4check', 'one setup codes column readable by anon', $q$grant select (code_hash) on public.team_agent_setup_codes to anon$q$, '%anon holds%on public.team_agent_setup_codes%'),
      ('w4check', 'a policy on the setup codes', $q$create policy issue3802b_planted on public.team_agent_setup_codes for select using (true)$q$, '%a policy exists on public.team_agent_setup_codes%'),
      ('w4check', 'another function that writes setup codes', $q$create function public.issue3802b_unspend() returns void language sql security definer set search_path = '' as 'update public.team_agent_setup_codes set consumed_at = null'$q$, '%the functions that write setup codes are%issue3802b_unspend%'),
      ('w4check', 'another function that writes keys', $q$create function public.issue3802b_revive() returns void language sql security definer set search_path = '' as 'update public.team_agent_keys set revoked_at = null, revoked_by = null, revoke_reason = null'$q$, '%the functions that write keys are%issue3802b_revive%'),
      ('w4check', 'another function that writes identifiers', $q$create function public.issue3802b_plant() returns void language sql security definer set search_path = '' as 'delete from public.crm_record_identifiers'$q$, '%the functions that write identifiers are%issue3802b_plant%'),
      ('w4check', 'the log function without the rule for agents', $q$create or replace function public.crm_record_log(p_id uuid, p_entry jsonb, p_request_key text) returns jsonb language sql security definer set search_path = '' as 'select null::jsonb'$q$, '%crm_record_log() no longer holds the rule for what an agent may log%'),
      ('w4check', 'the update function without the lock on a contact rule', $q$create or replace function public.crm_record_update(p_id uuid, p_changes jsonb) returns jsonb language sql security definer set search_path = '' as 'select null::jsonb'$q$, '%the functions that write identifiers are%'),
      ('w4check', 'an ICP the targets table does not accept', $q$alter table public.crm_targets drop constraint crm_targets_icp_check, add constraint crm_targets_icp_check check (icp <> 'experience_host') not valid$q$, '%crm_pipeline_def and the crm_targets CHECK constraint disagree%'),
      ('w4check', 'a digest that need not be unique', $q$alter table public.team_agent_setup_codes drop constraint team_agent_setup_codes_hash_key$q$, '%the setup code digest is not unique and checked%'),
      ('w4check', 'a stray agent function', $q$create function public.team_agent_issue3802b_stray() returns int language sql set search_path = '' as 'select 1'$q$, '%team_agent_ function(s) are not in the checked list%')
    ) as v(blk, label, mistake, want)
  loop
    select sql into v_sql from t3802b_src where k = m.blk;
    begin
      if m.mistake is not null then
        execute m.mistake;
      end if;
      execute v_sql;
      v_got := 'passed';
      if m.mistake is not null then
        raise exception 'issue3802b_undo_the_mistake';
      end if;
    exception when others then
      if sqlerrm <> 'issue3802b_undo_the_mistake' then
        v_got := sqlerrm;
      end if;
    end;
    if m.mistake is null then
      perform pg_temp.t3802b_check('B-11', m.blk || ': ' || m.label || ', the self-check passes', v_got, 'passed');
    else
      perform pg_temp.t3802b_like('B-11', m.blk || ': the self-check objects to ' || m.label, v_got, m.want);
    end if;
  end loop;
  select sql into v_sql from t3802b_src where k = 'w4check';
  begin
    execute v_sql;
    v_got := 'passed';
  exception when others then
    v_got := sqlerrm;
  end;
  perform pg_temp.t3802b_check('B-11', 'every mistake was undone: the self-check passes again', v_got, 'passed');
end;
$b11$;

do $verdict$
declare
  v_total int;
  v_failed int;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802b_results;
  for r in select * from t3802b_results where not ok order by seq loop
    raise warning 'ISSUE-3802 AGENT WRITE FAILED % | % | %', r.test, r.label, r.detail;
  end loop;
  if v_failed > 0 or v_total < 150 then
    raise exception 'ISSUE-3802 AGENT WRITE FAIL: % of % checks failed (at least 150 must run)', v_failed, v_total;
  end if;
  raise notice 'ISSUE-3802 AGENT WRITE PASS (part 1): % checks across B-1..B-11, 0 failed', v_total;
end;
$verdict$;

rollback;

-- ===========================================================================
-- PART 2 -- real sessions. Two full admins, their keys and a few records are
-- committed and removed. Keys and codes are made here at run time.
-- ===========================================================================
drop schema if exists t3802b_race cascade;
create schema t3802b_race;
select count(*) = 0 as t3802b_made_dblink from pg_extension where extname = 'dblink' \gset
create extension if not exists dblink with schema t3802b_race;
select n.nspname as t3802b_dblink_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'dblink' \gset
select count(*) = 0 as t3802b_made_column from information_schema.columns
 where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at' \gset
alter table auth.users add column if not exists email_confirmed_at timestamptz;
set search_path = public, :"t3802b_dblink_schema";
select set_config('t3802b.conn',
  format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s',
         current_setting('port'), current_database(), current_user, :'t3802b_pw'), false) is not null as conn_ready;

create table t3802b_race.results (seq serial primary key, label text, ok boolean, detail text);
create table t3802b_race.keys (n int primary key, key text not null, digest text not null);
insert into t3802b_race.keys (n, key, digest)
select g, k.key, encode(sha256(convert_to(k.key, 'UTF8')), 'hex')
from generate_series(1, 2) g,
     lateral (select 'mgla_' || case g when 1 then 'c' else 'x' end || '_'
                     || left(translate(encode(sha256(convert_to(gen_random_uuid()::text || g, 'UTF8')), 'base64'), '+/=', '-_a'), 43) as key) k;

begin;
-- Records first, with their log lines and identifiers.
delete from public.crm_records where created_by like 'issue3802b-race-%';
set local session_replication_role = replica;
delete from public.crm_request_keys where actor_email like 'issue3802b-race-%';
delete from public.team_agent_calls where owner_email like 'issue3802b-race-%';
delete from public.team_agent_setup_codes where owner_email like 'issue3802b-race-%';
delete from public.team_agent_keys where owner_email like 'issue3802b-race-%';
delete from public.admin_audit_log where admin_email like 'issue3802b-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802b-race-%';
delete from auth.users where email like 'issue3802b-race-%';
insert into auth.users (id, email, email_confirmed_at) values
  ('38020000-0000-4000-b900-000000000001', 'issue3802b-race-1@test.local', now()),
  ('38020000-0000-4000-b900-000000000002', 'issue3802b-race-2@test.local', now());
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802b-race-1@test.local', 'admin', 'active', now()),
  ('issue3802b-race-2@test.local', 'admin', 'active', now());
set local session_replication_role = origin;
insert into public.team_agent_keys (owner_email, agent, key_prefix, key_hash)
select 'issue3802b-race-' || n || '@test.local', case n when 1 then 'claude' else 'codex' end, left(key, 14), digest
from t3802b_race.keys;
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('38020000-0000-4000-b910-000000000001', 'hosts', 'Issue3802b Race Host', 'prospect', 'issue3802b-race-1@test.local', 'issue3802b-race-1@test.local');
commit;

do $race$
declare
  c_conn constant text := current_setting('t3802b.conn');
  d1 text := (select digest from t3802b_race.keys where n = 1);
  d2 text := (select digest from t3802b_race.keys where n = 2);
  c_rec constant text := '38020000-0000-4000-b910-000000000001';
  v_c text;
  v1 text;
  v2 text;
  v_code text;
  v_t timestamptz;
  v_ms numeric;
  i int;
begin
  begin
    foreach v_c in array array['t3802b_c1', 't3802b_c2', 't3802b_c3'] loop
      perform dblink_connect(v_c, c_conn);
    end loop;

    -- P-1: one code, used twice at the same moment.
    perform dblink_exec('t3802b_c1', 'begin');
    perform dblink_exec('t3802b_c1', 'set local role authenticated');
    perform * from dblink('t3802b_c1',
      $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-b900-000000000001', true)$q$) as t(x text);
    perform * from dblink('t3802b_c1',
      $q$select set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-b900-000000000001","role":"authenticated","email":"issue3802b-race-1@test.local"}', true)$q$) as t(x text);
    perform * from dblink('t3802b_c1',
      $q$select set_config('request.jwt.claim.email', 'issue3802b-race-1@test.local', true)$q$) as t(x text);
    select x into v_code from dblink('t3802b_c1', $q$select public.team_agent_setup_create('claude') ->> 'code'$q$) as t(x text);
    perform dblink_exec('t3802b_c1', 'commit');
    insert into t3802b_race.results (label, ok, detail)
    values ('P-1 a code is made in a real signed-in session', v_code ~ '^mgls_c_[A-Za-z0-9_-]{43}$', (v_code is not null)::text);
    foreach v_c in array array['t3802b_c1', 't3802b_c2'] loop
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role service_role');
    end loop;
    select x into v1 from dblink('t3802b_c1', format(
      $q$select public.team_agent_call(%L, 'setup:redeem', '{}'::jsonb, 'race/1.0') ->> 'setup'$q$,
      encode(sha256(convert_to(v_code, 'UTF8')), 'hex'))) as t(x text);
    perform dblink_send_query('t3802b_c2', format(
      $q$select public.team_agent_call(%L, 'setup:redeem', '{}'::jsonb, 'race/2.0') ->> 'setup'$q$,
      encode(sha256(convert_to(v_code, 'UTF8')), 'hex')));
    perform pg_sleep(0.4);
    insert into t3802b_race.results (label, ok, detail)
    values ('P-1 while the first use is open, the second one waits', dblink_is_busy('t3802b_c2') = 1, v1);
    perform dblink_exec('t3802b_c1', 'commit');
    select x into v2 from dblink_get_result('t3802b_c2') as t(x text);
    perform * from dblink_get_result('t3802b_c2') as t(x text);
    perform dblink_exec('t3802b_c2', 'commit');
    insert into t3802b_race.results (label, ok, detail)
    values ('P-1 of two uses of one code at once, one is served and one is refused',
            v1 = 'ok' and v2 = 'invalid', coalesce(v1, '<null>') || ' / ' || coalesce(v2, '<null>'));
    insert into t3802b_race.results (label, ok, detail)
    select 'P-1 exactly one key was made, and the one before it was replaced',
           count(*) filter (where revoked_at is null) = 1 and count(*) filter (where revoke_reason = 'replaced') = 1, count(*)::text
      from public.team_agent_keys where owner_email = 'issue3802b-race-1@test.local' and agent = 'claude';
    -- The first person's working key is now the one the code made: put the
    -- known digest back for the rest of this part.
    perform dblink_exec('t3802b_c3', $q$update public.team_agent_keys set revoked_at = now(), revoked_by = 'system', revoke_reason = 'owner'
     where owner_email = 'issue3802b-race-1@test.local' and revoked_at is null$q$);
    perform dblink_exec('t3802b_c3', format($q$update public.team_agent_keys set revoked_at = null, revoked_by = null, revoke_reason = null where key_hash = %L$q$, d1));

    -- P-2: two agents log "the first touch" on one record at the same moment.
    foreach v_c in array array['t3802b_c1', 't3802b_c2'] loop
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role service_role');
    end loop;
    select x into v1 from dblink('t3802b_c1', format(
      $q$select public.team_agent_call(%L, 'log_activity', %L::jsonb, 'race/1.0') #>> '{result,results,0,status}'$q$, d1,
      format('{"entries": [{"id": "%s", "kind": "touch", "channel": "email", "direction": "outbound", "body": "First, from one"}], "request_key": "race-touch-0001"}', c_rec))) as t(x text);
    perform dblink_send_query('t3802b_c2', format(
      $q$select coalesce(r #>> '{result,results,0,error,token}', r #>> '{result,results,0,status}', r::text)
           from public.team_agent_call(%L, 'log_activity', %L::jsonb, 'race/2.0') as r$q$, d2,
      format('{"entries": [{"id": "%s", "kind": "touch", "channel": "email", "direction": "outbound", "body": "First, from two"}], "request_key": "race-touch-0002"}', c_rec)));
    perform pg_sleep(0.4);
    perform dblink_exec('t3802b_c1', 'commit');
    select x into v2 from dblink_get_result('t3802b_c2') as t(x text);
    perform * from dblink_get_result('t3802b_c2') as t(x text);
    perform dblink_exec('t3802b_c2', 'commit');
    insert into t3802b_race.results (label, ok, detail)
    values ('P-2 of two first touches at once, one is logged and the other is a person''s',
            v1 = 'logged' and v2 = 'needs_a_person', coalesce(v1, '<null>') || ' / ' || coalesce(v2, '<null>'));
    insert into t3802b_race.results (label, ok, detail)
    select 'P-2 the record holds exactly one touch, via the first agent', count(*) = 1 and min(via) = 'claude', count(*)::text
      from public.crm_activity where record_id = c_rec::uuid and kind = 'touch';

    -- P-3: the same handle added under two names at the same moment.
    foreach v_c in array array['t3802b_c1', 't3802b_c2'] loop
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role service_role');
    end loop;
    select x into v1 from dblink('t3802b_c1', format(
      $q$select public.team_agent_call(%L, 'add_records', %L::jsonb, 'race/1.0') #>> '{result,results,0,status}'$q$, d1,
      '{"pipeline": "hosts", "records": [{"name": "Issue3802b Race Alpha", "identifiers": [{"kind": "handle", "value": "@issue3802b.race"}]}], "request_key": "race-add-00001"}')) as t(x text);
    perform dblink_send_query('t3802b_c2', format(
      $q$select (r #>> '{result,results,0,status}') || '/' || coalesce(r #>> '{result,results,0,reason}', '-') || '/' || coalesce(r #>> '{result,results,0,existing,name}', '-')
           from public.team_agent_call(%L, 'add_records', %L::jsonb, 'race/2.0') as r$q$, d2,
      '{"pipeline": "hosts", "records": [{"name": "Issue3802b Race Beta", "identifiers": [{"kind": "handle", "value": "instagram.com/Issue3802b.Race"}]}], "request_key": "race-add-00002"}'));
    perform pg_sleep(0.4);
    insert into t3802b_race.results (label, ok, detail)
    values ('P-3 while the first add is open, the second one waits', dblink_is_busy('t3802b_c2') = 1, v1);
    perform dblink_exec('t3802b_c1', 'commit');
    select x into v2 from dblink_get_result('t3802b_c2') as t(x text);
    perform * from dblink_get_result('t3802b_c2') as t(x text);
    perform dblink_exec('t3802b_c2', 'commit');
    insert into t3802b_race.results (label, ok, detail)
    values ('P-3 of two adds of one handle at once, one is created and the other is told who holds it',
            v1 = 'created' and v2 = 'exists/identifier/Issue3802b Race Alpha', coalesce(v1, '<null>') || ' / ' || coalesce(v2, '<null>'));
    insert into t3802b_race.results (label, ok, detail)
    select 'P-3 one record holds that handle', count(*) = 1, count(*)::text
      from public.crm_record_identifiers where kind = 'handle' and value_key = 'issue3802b.race';

    -- P-4: a request that waits for its key's turn is told to come back.
    perform dblink_exec('t3802b_c1', 'begin');
    perform dblink_exec('t3802b_c1', 'set local role service_role');
    select x into v1 from dblink('t3802b_c1', format(
      $q$select public.team_agent_call(%L, 'get_started', '{}'::jsonb, 'race/1.0') ->> 'ok'$q$, d1)) as t(x text);
    v_t := clock_timestamp();
    perform dblink_send_query('t3802b_c2', format(
      $q$select public.team_agent_call(%L, 'my_day', '{}'::jsonb, 'race/1.0')::text$q$, d1));
    select x into v2 from dblink('t3802b_c3', format(
      $q$select public.team_agent_call(%L, 'get_started', '{}'::jsonb, 'race/2.0') ->> 'ok'$q$, d2)) as t(x text);
    v_ms := extract(epoch from (clock_timestamp() - v_t)) * 1000;
    insert into t3802b_race.results (label, ok, detail)
    values ('P-4 while one key''s request is open, another key is answered at once', v2 = 'true' and v_ms < 2000, coalesce(v2, '<null>') || ' in ' || round(v_ms) || ' ms');
    -- Wait for its answer for at most twelve seconds: a request that never
    -- gives up is a failed check here, never a suite that never ends.
    for i in 1..120 loop
      exit when dblink_is_busy('t3802b_c2') = 0;
      perform pg_sleep(0.1);
    end loop;
    if dblink_is_busy('t3802b_c2') = 1 then
      perform dblink_cancel_query('t3802b_c2');
      begin
        perform * from dblink_get_result('t3802b_c2') as t(x text);
      exception
        when query_canceled then null;
        when others then null;
      end;
      perform * from dblink_get_result('t3802b_c2') as t(x text);
      v2 := '{"waited":"more than twelve seconds, and was stopped by this suite"}';
    else
      select x into v2 from dblink_get_result('t3802b_c2') as t(x text);
      perform * from dblink_get_result('t3802b_c2') as t(x text);
    end if;
    v_ms := extract(epoch from (clock_timestamp() - v_t)) * 1000;
    insert into t3802b_race.results (label, ok, detail)
    values ('P-4 the request that waited five seconds is told to come back in two, in plain words',
            v2::jsonb #>> '{limited,token}' = 'busy' and v2::jsonb #>> '{limited,retry_after_s}' = '2'
              and v2::jsonb #>> '{limited,message}' = 'Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.'
              and v_ms between 4500 and 9000,
            left(coalesce(v2, '<null>'), 200) || ' after ' || round(v_ms) || ' ms');
    select x into v1 from dblink('t3802b_c1', $q$select (select via from public.crm_ctx())$q$) as t(x text);
    perform dblink_exec('t3802b_c1', 'commit');
    insert into t3802b_race.results (label, ok, detail)
    values ('P-4 the request that held the turn is unaffected', v1 is not distinct from 'claude', coalesce(v1, '<null>'));
    insert into t3802b_race.results (label, ok, detail)
    select 'P-4 the request that gave up is recorded as limited, and counts toward nothing',
           count(*) filter (where tool = 'my_day' and outcome = 'limited') = 1 and count(*) filter (where tool = 'my_day' and outcome <> 'limited') = 0,
           string_agg(tool || ':' || outcome, ',')
      from public.team_agent_calls where owner_email = 'issue3802b-race-1@test.local' and tool = 'my_day';
    select x into v2 from dblink('t3802b_c2', format(
      $q$select public.team_agent_call(%L, 'my_day', '{}'::jsonb, 'race/1.0') ->> 'ok'$q$, d1)) as t(x text);
    insert into t3802b_race.results (label, ok, detail)
    values ('P-4 sent again once the turn is free, it is served', v2 is not distinct from 'true', coalesce(v2, '<null>'));
    select x into v2 from dblink('t3802b_c2', $q$select current_setting('lock_timeout')$q$) as t(x text);
    insert into t3802b_race.results (label, ok, detail)
    values ('P-4 the connection''s own lock setting is as it was', v2 is not distinct from '0', coalesce(v2, '<null>'));
  exception when others then
    insert into t3802b_race.results (label, ok, detail)
    values ('part 2 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array coalesce(dblink_get_connections(), '{}') loop
    perform dblink_disconnect(v_c);
  end loop;
end;
$race$;

select count(*) as t3802b_race_total,
       count(*) filter (where not ok) as t3802b_race_failed,
       coalesce(string_agg(label || ' [' || coalesce(detail, '') || ']', '; ' order by seq) filter (where not ok), 'none') as t3802b_race_failures
  from t3802b_race.results \gset

-- Remove the committed rows, whatever the verdict.
begin;
-- Records first, with their log lines and identifiers.
delete from public.crm_records where created_by like 'issue3802b-race-%';
set local session_replication_role = replica;
delete from public.crm_request_keys where actor_email like 'issue3802b-race-%';
delete from public.team_agent_calls where owner_email like 'issue3802b-race-%';
delete from public.team_agent_setup_codes where owner_email like 'issue3802b-race-%';
delete from public.team_agent_keys where owner_email like 'issue3802b-race-%';
delete from public.admin_audit_log where admin_email like 'issue3802b-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802b-race-%';
delete from auth.users where email like 'issue3802b-race-%';
commit;
reset search_path;
\if :t3802b_made_column
alter table auth.users drop column if exists email_confirmed_at;
\endif
\if :t3802b_made_dblink
drop extension if exists dblink;
\endif
drop schema t3802b_race cascade;

select (:t3802b_race_total < 15 or :t3802b_race_failed > 0) as t3802b_race_bad \gset
\if :t3802b_race_bad
  \echo 'ISSUE-3802 AGENT WRITE FAILED (part 2):' :t3802b_race_failures
  do $$ begin raise exception 'ISSUE-3802 AGENT WRITE FAIL: real-session checks failed or did not run'; end $$;
\endif
\echo 'ISSUE-3802 AGENT WRITE PASS (part 2):' :t3802b_race_total 'real-session checks, 0 failed'
