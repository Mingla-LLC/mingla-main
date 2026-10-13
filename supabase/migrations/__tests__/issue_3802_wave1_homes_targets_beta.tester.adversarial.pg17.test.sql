-- Issue #3802 (Wave 1) — role homes, monthly targets and Beta leads for the
-- whole team: INDEPENDENT TESTER proof (PostgreSQL 17).
--
-- A different angle from the implementor suite beside this file. That suite
-- walks each function with its ordinary callers and each rule once. This one
-- asks what happens at the edges:
--
--   XB-1   catalog: the full list of who holds any privilege on every new
--          function and on the new table (not two named roles), pinned search
--          paths, which functions run with owner rights
--   XB-2   a role that holds the pipelines but not Beta leads; a person whose
--          access is removed in the middle of a transaction
--   XB-3   the expected stage: odd values, a stale move to every kind of
--          target, and proof that a refused move leaves the card, its log and
--          the audit trail byte-for-byte as they were
--   XB-4   names nobody can see, the same name in two forms, and names in
--          many scripts, through add, rename and bulk add
--   XB-5   the stuck-host report: just inside and just outside 24 hours, a
--          set that changes and changes back, the two kinds of run kept
--          apart, no records at all
--   XB-6   every number on a home against a count written a different way,
--          for the day before, the day and the day after; a clamped day; the
--          week and month boundaries to the microsecond
--   XB-7   targets: every bad argument, repeats, and the audit count
--   XB-8   the lead type table over all 128 combinations against a separate
--          rule; city spellings; planted secrets never leave the reader
--   XB-9   Add to Hosts: same-name hosts, a host deleted afterwards, the name
--          taken by another lead, restore, the longest fields
--   XB-10  the invite address check: spellings of the same address, an
--          identity with no address, a blank phone, a re-send after the
--          account gains another sign-in, and what a refusal leaves behind
--   Part 2 three real sessions move one card to three different stages at the
--          same moment; three real sessions set one target at the same moment
--
-- Part 1 is one transaction, rolled back. Part 2 commits a few rows and
-- removes them. Never run on production.
--
-- Runs as the image's admin role from the repository root, like the suites
-- beside it (the bare CI image has no sign-in identity table and its account
-- table lacks two columns; they are added inside the rolled-back transaction).
-- Checks are RECORDED and reported together.

\set ON_ERROR_STOP on
\getenv t3802y_pw PGPASSWORD

-- ===========================================================================
-- PART 1 — one transaction, rolled back.
-- ===========================================================================
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  identity_data jsonb
);

create temp table y_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into y_people values
  ('owner',    '38020000-0000-4000-e000-000000000001', 'issue3802y-owner@test.local'),
  ('admin',    '38020000-0000-4000-e000-000000000002', 'issue3802y-admin@test.local'),
  ('growth',   '38020000-0000-4000-e000-000000000003', 'issue3802y-growth@test.local'),
  ('partner',  '38020000-0000-4000-e000-000000000004', 'issue3802y-partner@test.local'),
  ('growth2',  '38020000-0000-4000-e000-000000000005', 'issue3802y-growth2@test.local'),
  ('consumer', '38020000-0000-4000-e000-000000000006', 'issue3802y-consumer@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from y_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802y-owner@test.local', 'owner', 'active', now()),
  ('issue3802y-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('issue3802y-growth@test.local',  'growth',  'active', now()),
  ('issue3802y-partner@test.local', 'partner', 'active', now()),
  ('issue3802y-growth2@test.local', 'growth',  'active', now());

set local session_replication_role = replica;
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, is_live_for_consumers) values
  ('38020000-0000-4000-e200-000000000001', 'issue3802y-a', 'Yport',          'Nigeria',        'NG', 1, 1, 0, 0, 2, 2, true),
  ('38020000-0000-4000-e200-000000000002', 'issue3802y-b', U&'Y\00E3o Vila', 'Brazil',         'BR', 1, 1, 0, 0, 2, 2, false),
  ('38020000-0000-4000-e200-000000000003', 'issue3802y-c', 'Ytwin',          'United States',  'US', 1, 1, 0, 0, 2, 2, false),
  ('38020000-0000-4000-e200-000000000004', 'issue3802y-d', 'YTWIN',          'United Kingdom', 'GB', 1, 1, 0, 0, 2, 2, false);
insert into public.brands (id, account_id, name, slug, city) values
  ('38020000-0000-4000-e100-000000000001', '38020000-0000-4000-e300-000000000001', 'Issue3802y Brand One',   'issue3802y-brand-one',   'Yport'),
  ('38020000-0000-4000-e100-000000000002', '38020000-0000-4000-e300-000000000001', 'Issue3802y Brand Two',   'issue3802y-brand-two',   'Yport'),
  ('38020000-0000-4000-e100-000000000003', '38020000-0000-4000-e300-000000000001', 'Issue3802y Brand Three', 'issue3802y-brand-three', 'Yport');
set local session_replication_role = origin;

create temp table y_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.y_eq(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into y_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 300), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.y_eq(p_test text, p_label text, p_got boolean, p_want text) returns void
language sql as $fn$ select pg_temp.y_eq(p_test, p_label, p_got::text, p_want) $fn$;

create function pg_temp.y_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into y_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 300), '<null>'), p_pattern));
end;
$fn$;

-- Run one statement as a caller; its single text result, or 'ERR:<state>:<message>'.
create function pg_temp.y_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'server') then
    select id, email into strict v_id, v_email from y_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'server' then
      set local role postgres;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
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

create function pg_temp.y_make(p_who text, p_pipeline text, p_fields jsonb) returns uuid
language plpgsql as $fn$
declare
  r text;
begin
  r := pg_temp.y_as(p_who, format($q$select public.crm_record_create(%L, %L::jsonb, %L)::text$q$,
                                  p_pipeline, p_fields::text, 'yk-' || gen_random_uuid()::text));
  return (r::jsonb #>> '{record,id}')::uuid;
exception when others then
  raise exception 'y_make failed for %: %', p_fields, r;
end;
$fn$;

create function pg_temp.y_move(p_who text, p_id uuid, p_to text, p_reason text, p_expected text) returns text
language sql as $fn$
  select pg_temp.y_as(p_who, format($q$select public.crm_record_move_stage(%L, %L, %L, %L)::text$q$, p_id, p_to, p_reason, p_expected))
$fn$;

-- Everything a refused call could have touched for one card, as one string.
create function pg_temp.y_print(p_id uuid) returns text
language sql as $fn$
  select (select row_to_json(r)::text from public.crm_records r where r.id = p_id)
      || ' log=' || (select count(*) from public.crm_activity a where a.record_id = p_id)
      || ' audit=' || (select count(*) from public.admin_audit_log l where l.target_id = p_id::text)
$fn$;

-- ---------------------------------------------------------------------------
-- XB-1 — catalog: every grantee, not two named roles.
-- ---------------------------------------------------------------------------
do $xb1$
declare
  c_client text[] := array['crm_home_summary(date)', 'crm_team_summary(date)', 'crm_target_set(uuid,text,integer)',
                           'crm_beta_leads_list()', 'crm_beta_lead_to_host(uuid)', 'crm_record_move_stage(uuid,text,text,text)'];
  c_internal text[] := array['crm_stage_counts_json()', 'crm_due_json(text,date,integer)', 'crm_targets_json(date)',
                             'crm_beta_icp(text[])', 'crm_city_region(text)', 'admin_team_invite_address_verdict(text)',
                             'crm_name_key(text)', 'crm_validate_fields(text,jsonb,text)', 'crm_reconcile_live(uuid)'];
  v_fn text;
  v_got text;
begin
  foreach v_fn in array c_client loop
    select string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ',' order by coalesce(r.rolname, 'PUBLIC')) into v_got
    from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
    where p.oid = ('public.' || v_fn)::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
    perform pg_temp.y_eq('XB-1', 'who may run ' || v_fn, v_got, 'authenticated,service_role');
    perform pg_temp.y_eq('XB-1', v_fn || ' runs with owner rights and a pinned search path',
      (select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure),
      'true/search_path=""');
  end loop;
  foreach v_fn in array c_internal loop
    select string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ',' order by coalesce(r.rolname, 'PUBLIC')) into v_got
    from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
    where p.oid = ('public.' || v_fn)::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
    perform pg_temp.y_eq('XB-1', 'who may run the internal ' || v_fn, v_got, 'service_role');
    perform pg_temp.y_eq('XB-1', v_fn || ' has a pinned search path',
      (select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure),
      'search_path=""');
  end loop;

  select string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ',' order by coalesce(r.rolname, 'PUBLIC')) into v_got
  from pg_class c cross join lateral aclexplode(c.relacl) a left join pg_roles r on r.oid = a.grantee
  where c.oid = 'public.crm_targets'::regclass and a.grantee <> c.relowner;
  perform pg_temp.y_eq('XB-1', 'who holds anything on the targets table', v_got, 'service_role');
  perform pg_temp.y_eq('XB-1', 'targets table: row security on, no policy, no trigger, no foreign key, no column grant',
    (select c.relrowsecurity::text from pg_class c where c.oid = 'public.crm_targets'::regclass)
      || '/' || (select count(*) from pg_policy where polrelid = 'public.crm_targets'::regclass)
      || '/' || (select count(*) from pg_trigger where tgrelid = 'public.crm_targets'::regclass and not tgisinternal)
      || '/' || (select count(*) from pg_constraint where conrelid = 'public.crm_targets'::regclass and contype = 'f')
      || '/' || (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'crm_targets' and grantee in ('anon', 'authenticated', 'PUBLIC')),
    'true/0/0/0/0');
  perform pg_temp.y_eq('XB-1', 'no new function builds a statement at run time',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'crm\_%' or p.proname = 'admin_team_invite_address_verdict')
        and p.prosrc ~* '\mexecute\M'), '0');
  perform pg_temp.y_eq('XB-1', 'exactly one move function, four arguments, the last two optional',
    (select count(*)::text || '/' || max(pronargs)::text || '/' || max(pronargdefaults)::text from pg_proc where proname = 'crm_record_move_stage'),
    '1/4/2');

  -- Every direct statement at the table, by every client caller, is refused
  -- outright (not answered with zero rows).
  foreach v_fn in array array['owner', 'growth', 'consumer', 'anon'] loop
    perform pg_temp.y_like('XB-1', v_fn || ' cannot read the targets table',
      pg_temp.y_as(v_fn, 'select count(*)::text from public.crm_targets'), 'ERR:42501:%');
    perform pg_temp.y_like('XB-1', v_fn || ' cannot add to the targets table',
      pg_temp.y_as(v_fn, $q$insert into public.crm_targets (region_id, icp, monthly_target, created_by, updated_by) values (gen_random_uuid(), 'partner_org', 1, 'x', 'x') returning 'in'$q$), 'ERR:42501:%');
    perform pg_temp.y_like('XB-1', v_fn || ' cannot change the targets table',
      pg_temp.y_as(v_fn, $q$update public.crm_targets set monthly_target = 9 returning 'in'$q$), 'ERR:42501:%');
    perform pg_temp.y_like('XB-1', v_fn || ' cannot delete from the targets table',
      pg_temp.y_as(v_fn, $q$delete from public.crm_targets returning 'in'$q$), 'ERR:42501:%');
    perform pg_temp.y_like('XB-1', v_fn || ' cannot empty the targets table',
      pg_temp.y_as(v_fn, $q$truncate public.crm_targets$q$), 'ERR:42501:%');
  end loop;
end;
$xb1$;

-- ---------------------------------------------------------------------------
-- XB-2 — a role with the pipelines but not Beta leads; access removed mid-way.
-- The area map is replaced for the length of one block and put back.
-- ---------------------------------------------------------------------------
do $xb2$
declare
  v_def text := pg_get_functiondef('public.admin_team_role_areas(text)'::regprocedure);
  v_lead uuid := '38020000-0000-4000-e500-000000000001';
begin
  insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source)
  values (v_lead, array['restaurant'], 'Issue3802y Area Lead', 'A', 'Yport', 'issue3802y-area@test.local', true, 'organiser_marketing');

  create or replace function public.admin_team_role_areas(p_role text) returns text[]
  language sql immutable set search_path = '' as $f$
    select case p_role
      when 'owner'   then array['admin_console','team_manage','crm','beta_leads']
      when 'admin'   then array['admin_console','crm','beta_leads']
      when 'growth'  then array['role_home','crm']
      when 'partner' then array['role_home','beta_leads']
      else array[]::text[] end
  $f$;

  -- growth: pipelines yes, Beta leads no.
  perform pg_temp.y_like('XB-2', 'pipelines without Beta leads: the reader refuses in plain words',
    pg_temp.y_as('growth', 'select public.crm_beta_leads_list()::text'), 'ERR:42501:forbidden: Your account cannot open Beta leads.%');
  perform pg_temp.y_like('XB-2', 'pipelines without Beta leads: Add to Hosts refuses',
    pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', v_lead)), 'ERR:42501:forbidden: Your account cannot open Beta leads.%');
  perform pg_temp.y_eq('XB-2', 'pipelines without Beta leads: the home still answers, with no lead count at all',
    (pg_temp.y_as('growth', 'select public.crm_home_summary()::text')::jsonb -> 'beta_leads_new')::text, 'null');
  perform pg_temp.y_eq('XB-2', 'that refusal says the same for a lead that exists and one that does not',
    pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', gen_random_uuid())),
    pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', v_lead)));
  -- partner: Beta leads yes, pipelines no. The pipeline gate comes first.
  perform pg_temp.y_like('XB-2', 'Beta leads without the pipelines: the reader refuses',
    pg_temp.y_as('partner', 'select public.crm_beta_leads_list()::text'), 'ERR:42501:%');
  perform pg_temp.y_like('XB-2', 'Beta leads without the pipelines: Add to Hosts refuses and makes no host',
    pg_temp.y_as('partner', format('select public.crm_beta_lead_to_host(%L)::text', v_lead)), 'ERR:42501:%');
  perform pg_temp.y_eq('XB-2', 'no host was made by any of those calls',
    (select count(*)::text from public.crm_records where beta_lead_id = v_lead), '0');

  execute v_def;
  perform pg_temp.y_eq('XB-2', 'with the real area map back, the same person reads the list',
    (pg_temp.y_as('growth', 'select public.crm_beta_leads_list()::text')::jsonb ->> 'total') ~ '^\d+$', 'true');

  -- The team dashboard, by everyone who is not an owner or admin.
  perform pg_temp.y_eq('XB-2', 'the team dashboard answers an owner and an admin',
    (pg_temp.y_as('owner', 'select public.crm_team_summary()::text') like '{%')::text || '/' || (pg_temp.y_as('admin', 'select public.crm_team_summary()::text') like '{%')::text, 'true/true');
  perform pg_temp.y_eq('XB-2', 'it refuses the two team roles in plain words, and an ordinary account and a signed-out caller outright',
    pg_temp.y_as('growth', 'select public.crm_team_summary()::text') || '|' || pg_temp.y_as('partner', $q$select public.crm_team_summary('2026-01-01')::text$q$)
      || '|' || left(pg_temp.y_as('consumer', 'select public.crm_team_summary()::text'), 10) || '|' || left(pg_temp.y_as('anon', 'select public.crm_team_summary()::text'), 10),
    'ERR:42501:forbidden: Only an owner or admin can open the team dashboard.|ERR:42501:forbidden: Only an owner or admin can open the team dashboard.|ERR:42501:|ERR:42501:');

  -- Access removed between two calls of one transaction.
  perform pg_temp.y_eq('XB-2', 'before removal the home answers',
    pg_temp.y_as('growth2', 'select public.crm_home_summary()::text') like '{%', 'true');
  update public.admin_team_members set status = 'revoked' where email = 'issue3802y-growth2@test.local';
  perform pg_temp.y_like('XB-2', 'after removal the home refuses at once', pg_temp.y_as('growth2', 'select public.crm_home_summary()::text'), 'ERR:42501:%');
  perform pg_temp.y_like('XB-2', 'after removal the reader refuses at once', pg_temp.y_as('growth2', 'select public.crm_beta_leads_list()::text'), 'ERR:42501:%');
  perform pg_temp.y_like('XB-2', 'after removal Add to Hosts refuses at once',
    pg_temp.y_as('growth2', format('select public.crm_beta_lead_to_host(%L)::text', v_lead)), 'ERR:42501:%');
  update public.admin_team_members set status = 'active' where email = 'issue3802y-growth2@test.local';

  -- An admin taken out of the full-admin table loses the dashboard and targets.
  update public.admin_users set status = 'revoked' where email = 'issue3802y-admin@test.local';
  perform pg_temp.y_like('XB-2', 'a removed admin cannot open the team dashboard', pg_temp.y_as('admin', 'select public.crm_team_summary()::text'), 'ERR:42501:%');
  perform pg_temp.y_like('XB-2', 'a removed admin cannot set a target',
    pg_temp.y_as('admin', $q$select public.crm_target_set('38020000-0000-4000-e200-000000000001', 'partner_org', 3)::text$q$), 'ERR:42501:%');
  update public.admin_users set status = 'active' where email = 'issue3802y-admin@test.local';
  perform pg_temp.y_eq('XB-2', 'nothing was written by the refused target call', (select count(*)::text from public.crm_targets), '0');
end;
$xb2$;

-- ---------------------------------------------------------------------------
-- XB-3 — the expected stage.
-- ---------------------------------------------------------------------------
do $xb3$
declare
  v_id uuid := pg_temp.y_make('growth', 'hosts', '{"name": "XB3 Card"}');
  v_cr uuid := pg_temp.y_make('growth', 'creators', '{"name": "XB3 Creator"}');
  v_before text;
  v_to text;
  v_bad text;
begin
  perform pg_temp.y_move('growth', v_id, 'contacted', null, 'prospect');
  v_before := pg_temp.y_print(v_id);

  -- A stale move, to every stage it could be aimed at, with and without a reason.
  foreach v_to in array array['replied', 'meeting', 'onboarded', 'live', 'lost', 'prospect'] loop
    perform pg_temp.y_like('XB-3', 'a stale move to ' || v_to || ' is refused as stale, whatever else is wrong with it',
      pg_temp.y_move('partner', v_id, v_to, case when v_to = 'lost' then 'a reason' end, 'prospect'),
      'ERR:22023:stage_changed: This card is in Contacted now, not Prospect, so nothing was moved.%');
  end loop;
  perform pg_temp.y_like('XB-3', 'a stale move to Lost with no reason is still refused as stale, not for the reason',
    pg_temp.y_move('partner', v_id, 'lost', null, 'meeting'), 'ERR:22023:stage_changed: This card is in Contacted now, not Meeting%');

  -- Values that are not a stage of this pipeline.
  foreach v_bad in array array['', ' ', 'CONTACTED', 'contacted ', 'booked', 'identified', 'null', 'contacted; drop table x', U&'contacted\200B'] loop
    perform pg_temp.y_like('XB-3', 'an expected stage of ' || quote_literal(v_bad) || ' is refused as not a stage',
      pg_temp.y_move('partner', v_id, 'meeting', null, v_bad), 'ERR:22023:invalid_stage: %');
  end loop;
  perform pg_temp.y_like('XB-3', 'a creator stage named for a creator card of another stage is stale, and names both stages',
    pg_temp.y_move('growth', v_cr, 'replied', null, 'contacted'), 'ERR:22023:stage_changed: This card is in Identified now, not Contacted%');
  perform pg_temp.y_like('XB-3', 'the agreement rule still holds when the expected stage is right',
    pg_temp.y_move('growth', v_cr, 'booked', null, 'identified'), 'ERR:22023:agreement_required:%');

  perform pg_temp.y_eq('XB-3', 'after seventeen refusals the card, its log and its audit trail are exactly as they were',
    pg_temp.y_print(v_id), v_before);

  -- Already there is an answer whatever was expected, and writes nothing.
  perform pg_temp.y_eq('XB-3', 'moving to where the card already is answers "not changed", even with a wrong expected stage',
    pg_temp.y_move('partner', v_id, 'contacted', null, 'meeting')::jsonb ->> 'changed', 'false');
  perform pg_temp.y_eq('XB-3', 'and that wrote nothing either', pg_temp.y_print(v_id), v_before);

  -- The right expected stage moves it, once.
  perform pg_temp.y_eq('XB-3', 'the right expected stage moves the card',
    pg_temp.y_move('partner', v_id, 'meeting', null, 'contacted')::jsonb ->> 'changed', 'true');
  perform pg_temp.y_like('XB-3', 'the same call again is now stale',
    pg_temp.y_move('growth', v_id, 'replied', null, 'contacted'), 'ERR:22023:stage_changed: This card is in Meeting now, not Contacted%');
  perform pg_temp.y_eq('XB-3', 'two moves were logged in all',
    (select count(*)::text from public.crm_activity where record_id = v_id and kind = 'stage_move'), '2');

  -- Callers that send two or three arguments are as before.
  perform pg_temp.y_eq('XB-3', 'three arguments, by position, still move the card',
    pg_temp.y_as('growth', format('select public.crm_record_move_stage(%L, %L, null)::text', v_id, 'onboarded'))::jsonb ->> 'changed', 'true');
  perform pg_temp.y_eq('XB-3', 'three arguments, by name, still move the card',
    pg_temp.y_as('growth', format('select public.crm_record_move_stage(p_id => %L, p_to => %L, p_reason => null)::text', v_id, 'meeting'))::jsonb ->> 'changed', 'true');
  perform pg_temp.y_eq('XB-3', 'two arguments, by name, still move the card',
    pg_temp.y_as('growth', format('select public.crm_record_move_stage(p_to => %L, p_id => %L)::text', 'replied', v_id))::jsonb ->> 'changed', 'true');
  perform pg_temp.y_like('XB-3', 'a signed-in account with no team access is refused before anything is read',
    pg_temp.y_move('consumer', v_id, 'meeting', null, 'replied'), 'ERR:42501:%');
  perform pg_temp.y_like('XB-3', 'a signed-out caller is refused', pg_temp.y_move('anon', v_id, 'meeting', null, 'replied'), 'ERR:42501:%');
end;
$xb3$;

-- ---------------------------------------------------------------------------
-- XB-4 — names.
-- ---------------------------------------------------------------------------
do $xb4$
declare
  r record;
  v_first text;
  v_second text;
  v_id uuid;
  v_bulk jsonb;
begin
  -- Nothing visible: refused on add, whatever it is made of.
  for r in select * from (values
      ('a blank braille cell',              U&'\2800'),
      ('three blank braille cells and a tag', U&'\2800\2800\2800\+0E007F'),
      ('the language tag',                  U&'\+0E0001'),
      ('tag letters',                       U&'\+0E0041\+0E0042'),
      ('the last variation selector',       U&'\+0E01EF'),
      ('two variation selectors',           U&'\FE0F\+0E0100'),
      ('musical beam marks',                U&'\+01D173\+01D17A'),
      ('a lone acute accent',               U&'\0301'),
      ('a space, an accent, a space',       U&' \0301 '),
      ('a spacing diaeresis',               U&'\00A8'),
      ('a lone enclosing circle',           U&'\20DD'),
      ('four Hangul fillers',               U&'\3164\FFA0\115F\1160'),
      ('direction marks only',              U&'\202E\2066\2069'),
      ('a joiner and a selector',           U&'\200D\FE0F'),
      ('a soft hyphen and a no-break space', U&'\00AD\00A0'),
      ('hieroglyph format marks',           U&'\+013430\+01343F'),
      ('a shorthand format mark',           U&'\+01BCA0')
    ) as t(label, name) loop
    perform pg_temp.y_like('XB-4', r.label || ' is not a name',
      pg_temp.y_as('growth', format($q$select public.crm_record_create('creators', %L::jsonb, %L)::text$q$,
        jsonb_build_object('name', r.name)::text, 'yk-' || gen_random_uuid()::text)), 'ERR:22023:invalid_name:%');
  end loop;

  -- The key itself (what city matching and lead matching use, with no
  -- cleaning in front of it) drops the same characters.
  perform pg_temp.y_eq('XB-4', 'the key of each of those, asked directly, is empty',
    (select count(*)::text from (values (U&'\2800'), (U&'\+0E0001'), (U&'\+0E0041\+0E0042'), (U&'\+0E01EF'), (U&'\+01D173\+01D17A'), (U&'\0301'), (U&' \0301 '),
        (U&'\00A8'), (U&'\20DD'), (U&'\3164\FFA0\115F\1160'), (U&'\202E\2066\2069'), (U&'\200D\FE0F'), (U&'\00AD\00A0'), (U&'\+013430\+01343F'), (U&'\+01BCA0'), (U&'\+0110BD'))
      as t(n) where public.crm_name_key(t.n) <> ''), '0');
  perform pg_temp.y_eq('XB-4', 'and inside a name they change nothing about its key',
    (select count(*)::text from (values (U&'Palm\2800 Court'), (U&'Pa\+0E0041lm Court'), (U&'Palm\+01D173Court'), (U&'P\200Dalm Co\FE0Furt'), (U&'Palm\+01BCA0 Co\+013430urt'), (U&'Palm \3164Court'))
      as t(n) where public.crm_name_key(t.n) is distinct from 'palmcourt'), '0');
  perform pg_temp.y_eq('XB-4', 'a city typed with such a character in it still finds its Launch City',
    (public.crm_city_region(U&'Y\2800port') ->> 'note') || '/' || (public.crm_city_region(U&'Yp\+0E0041ort, NG') ->> 'note'), 'set/set');

  -- One name in two forms is one record.
  for r in select * from (values
      ('composed and decomposed accent',  U&'XB4 Caf\00E9',            U&'XB4 Cafe\0301'),
      ('full-width and plain letters',    'XB4 Wide',                  U&'\FF38\FF22\FF14 \FF37\FF49\FF44\FF45'),
      ('a ligature',                      'XB4 fish',                  U&'XB4 \FB01sh'),
      ('tag characters inside',           'XB4 Tagged',                U&'XB4\+0E0041 Tag\+0E0062ged'),
      ('a blank braille cell inside',     'XB4 Braille',               U&'XB4\2800Braille'),
      ('a musical mark inside',           'XB4 Music',                 U&'XB4\+01D173Music'),
      ('a heart with and without its selector', U&'XB4 \2764',         U&'XB4 \2764\FE0F'),
      ('the angstrom sign and a decomposed umlaut', U&'XB4 \00C5ngstr\00F6m', U&'XB4 \212Bngstro\0308m'),
      ('half-width and full-width kana',  U&'XB4 \30AB',               U&'XB4 \FF76'),
      ('a superscript digit',             'XB4 x2',                    U&'XB4 x\00B2'),
      ('a circled digit',                 'XB4 no 1',                  U&'XB4 no \2460'),
      ('a dotted capital I',              'XB4 istanbul',              U&'XB4 \0130stanbul'),
      ('a no-break space',                'XB4 nb sp',                 U&'XB4\00A0nb\3000sp'),
      ('joiners inside a word',           'XB4 joined',                U&'XB4 jo\200Din\200Ced')
    ) as t(label, a, b) loop
    v_first := pg_temp.y_as('growth', format($q$select public.crm_record_create('creators', %L::jsonb, %L)::text$q$,
      jsonb_build_object('name', r.a)::text, 'yk-' || gen_random_uuid()::text));
    v_second := pg_temp.y_as('partner', format($q$select public.crm_record_create('creators', %L::jsonb, %L)::text$q$,
      jsonb_build_object('name', r.b)::text, 'yk-' || gen_random_uuid()::text));
    perform pg_temp.y_eq('XB-4', r.label || ': the second spelling is the same record',
      (v_first::jsonb ->> 'status') || ' then ' || (v_second::jsonb ->> 'status') || ' ' || ((v_second::jsonb #>> '{existing,id}') = (v_first::jsonb #>> '{record,id}'))::text,
      'created then duplicate true');
    perform pg_temp.y_eq('XB-4', r.label || ': the duplicate check finds it before anything is sent',
      pg_temp.y_as('partner', format($q$select public.crm_duplicate_check('creators', %L)::text$q$, r.b))::jsonb #>> '{exact,id}',
      v_first::jsonb #>> '{record,id}');
  end loop;
  perform pg_temp.y_eq('XB-4', 'letters of two alphabets that look alike stay two records',
    (pg_temp.y_as('growth', format($q$select public.crm_record_create('creators', %L::jsonb, 'yk-ab1-38020000-0000-4000-e800-000000000001')::text$q$, jsonb_build_object('name', 'XB4 AB')::text))::jsonb ->> 'status')
      || '/' || (pg_temp.y_as('growth', format($q$select public.crm_record_create('creators', %L::jsonb, 'yk-ab2-38020000-0000-4000-e800-000000000001')::text$q$, jsonb_build_object('name', U&'XB4 \0410\0412')::text))::jsonb ->> 'status'),
    'created/created');

  -- Names that must still be accepted, and stored in one form.
  for r in select * from (values
      ('Arabic with vowel marks',     U&'\0645\0637\0639\0645 \0627\0644\0646\0651\064E\062E\0650\064A\0644'),
      ('Hebrew with points',          U&'\05D1\05B5\05BC\05D9\05EA \05E7\05E4\05D4'),
      ('Thai',                        U&'\0E23\0E49\0E32\0E19\0E2D\0E32\0E2B\0E32\0E23'),
      ('Devanagari',                  U&'\0926\093F\0932\094D\0932\0940 \0922\093E\092C\093E'),
      ('Japanese',                    U&'\6771\4EAC\30E9\30FC\30E1\30F3'),
      ('Korean',                      U&'\D55C\AD6D \C2DD\B2F9'),
      ('Yoruba with tone marks',      U&'\1EB8\0300b\00E1 \00D2\0323\0301d\1EB9\0300'),
      ('two emoji',                   U&'\+01F355\+01F37A'),
      ('a family emoji (joined)',     U&'\+01F468\200D\+01F469\200D\+01F467'),
      ('a flag',                      U&'\+01F1F3\+01F1EC'),
      ('a thumbs-up with a skin tone', U&'\+01F44D\+01F3FD'),
      ('one letter with a combining accent', U&'a\0301'),
      ('symbols only',                '&&&'),
      ('one digit',                   '7')
    ) as t(label, name) loop
    v_first := pg_temp.y_as('growth', format($q$select public.crm_record_create('hosts', %L::jsonb, %L)::text$q$,
      jsonb_build_object('name', r.name)::text, 'yk-' || gen_random_uuid()::text));
    perform pg_temp.y_eq('XB-4', r.label || ' is a name', v_first::jsonb ->> 'status', 'created');
    perform pg_temp.y_eq('XB-4', r.label || ': stored in one form, with a key that matches',
      (select (c.name = normalize(c.name, NFC))::text || '/' || (c.name_key = public.crm_name_key(c.name))::text || '/' || (c.name_key <> '')::text
         from public.crm_records c where c.id = (v_first::jsonb #>> '{record,id}')::uuid), 'true/true/true');
  end loop;
  perform pg_temp.y_eq('XB-4', 'a decomposed name is stored composed',
    (select encode(convert_to(c.name, 'UTF8'), 'hex') from public.crm_records c where c.pipeline = 'creators' and c.name_key = public.crm_name_key(U&'XB4 Caf\00E9')),
    encode(convert_to(U&'XB4 Caf\00E9', 'UTF8'), 'hex'));

  -- Rename and bulk add go through the same rule.
  v_id := pg_temp.y_make('growth', 'creators', '{"name": "XB4 Rename Base"}');
  perform pg_temp.y_like('XB-4', 'rename to a blank braille cell is refused',
    pg_temp.y_as('growth', format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$, v_id, jsonb_build_object('name', U&'\2800')::text)), 'ERR:22023:invalid_name:%');
  perform pg_temp.y_like('XB-4', 'rename to a lone accent is refused',
    pg_temp.y_as('growth', format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$, v_id, jsonb_build_object('name', U&'\0301')::text)), 'ERR:22023:invalid_name:%');
  perform pg_temp.y_like('XB-4', 'rename to the full-width spelling of another record is refused as a duplicate',
    pg_temp.y_as('growth', format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$, v_id, jsonb_build_object('name', U&'\FF38\FF22\FF14 \FF46\FF49\FF53\FF48')::text)), 'ERR:22023:duplicate_name:%');
  perform pg_temp.y_eq('XB-4', 'rename to its own full-width spelling is allowed (it is the same record)',
    pg_temp.y_as('growth', format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$, v_id, jsonb_build_object('name', U&'XB4 \FF32ename Base')::text)) like '{%', 'true');
  v_bulk := pg_temp.y_as('growth', format($q$select public.crm_records_bulk_create('creators', %L::jsonb, 'yk-bulk-38020000-0000-4000-e800-000000000001')::text$q$,
    jsonb_build_array(jsonb_build_object('name', 'XB4 Bulk One'), jsonb_build_object('name', U&'\FF38\FF22\FF14 \FF22\FF55\FF4C\FF4B \FF2F\FF4E\FF45'),
                      jsonb_build_object('name', U&'\2800'), jsonb_build_object('name', U&'\+0E0041'),
                      jsonb_build_object('name', U&'XB4 Bulk Tw\0301o'), jsonb_build_object('name', U&'XB4 Bulk T\1E83o'))::text))::jsonb;
  perform pg_temp.y_eq('XB-4', 'bulk add: two added, two refused as not names, two skipped as the same name in another form',
    jsonb_array_length(v_bulk -> 'created')::text || '/' || jsonb_array_length(v_bulk -> 'invalid')::text || '/' || jsonb_array_length(v_bulk -> 'skipped')::text,
    '2/2/2');
  perform pg_temp.y_eq('XB-4', 'after all of that: every stored key matches, every name is in one form, no two live records share a key',
    (select count(*)::text from public.crm_records c where c.name_key is distinct from public.crm_name_key(c.name))
      || '/' || (select count(*)::text from public.crm_records c where c.name is distinct from normalize(c.name, NFC))
      || '/' || (select count(*)::text from (select 1 from public.crm_records c where c.deleted_at is null group by c.pipeline, c.name_key having count(*) > 1) d),
    '0/0/0');
end;
$xb4$;

-- ---------------------------------------------------------------------------
-- XB-5 — the stuck-host report.
-- ---------------------------------------------------------------------------
create function pg_temp.y_fault() returns trigger
language plpgsql as $fn$
begin
  if new.stage = 'live' and new.name = any (string_to_array(current_setting('t3802y.fault_names', true), '|')) then
    raise exception 'issue3802y planted fault' using errcode = '55000';
  end if;
  return new;
end;
$fn$;

create function pg_temp.y_rows() returns text
language sql as $fn$
  select coalesce(string_agg((metadata ->> 'scope') || ':' || (metadata ->> 'failed') || '/' || (metadata ->> 'promoted'), ' ' order by metadata ->> 'scope', metadata ->> 'failed', metadata ->> 'promoted'), '-')
    from public.admin_audit_log where action = 'crm.reconcile_failed'
$fn$;

do $xb5$
declare
  v_one uuid;
  v_two uuid;
  v_fp1 text;
begin
  perform pg_temp.y_eq('XB-5', 'no pipeline records with a brand: the scheduled run promotes nothing and reports nothing',
    pg_temp.y_as('server', 'select public.crm_reconcile_live()::text') || ' ' || pg_temp.y_rows(), '0 -');

  create trigger t3802y_fault before insert or update on public.crm_records
    for each row execute function pg_temp.y_fault();
  perform set_config('t3802y.fault_names', 'XB5 Stuck One|XB5 Stuck Two', true);
  v_one := pg_temp.y_make('growth', 'hosts', '{"name": "XB5 Stuck One", "brand_id": "38020000-0000-4000-e100-000000000001"}');
  v_two := pg_temp.y_make('growth', 'hosts', '{"name": "XB5 Stuck Two", "brand_id": "38020000-0000-4000-e100-000000000002"}');
  perform pg_temp.y_make('growth', 'hosts', '{"name": "XB5 Fine", "brand_id": "38020000-0000-4000-e100-000000000003"}');

  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status) values
    ('38020000-0000-4000-e420-000000000001', '38020000-0000-4000-e100-000000000001', 'Issue3802y one',   'issue3802y-one',   'public', 'scheduled'),
    ('38020000-0000-4000-e420-000000000003', '38020000-0000-4000-e100-000000000003', 'Issue3802y three', 'issue3802y-three', 'public', 'scheduled');
  set local session_replication_role = origin;

  perform pg_temp.y_eq('XB-5', 'first run: the host that can be promoted is, the stuck one is reported once',
    pg_temp.y_as('server', 'select public.crm_reconcile_live()::text') || ' ' || pg_temp.y_rows(), '1 scheduled:1/1');
  select metadata ->> 'fingerprint' into v_fp1 from public.admin_audit_log where action = 'crm.reconcile_failed';
  perform pg_temp.y_eq('XB-5', 'the fingerprint is not the host id and not a hash anyone could match to a name',
    (v_fp1 ~ '^[0-9a-f]{32}$')::text || '/' || (v_fp1 = md5(v_one::text))::text || '/' || (v_fp1 = md5('XB5 Stuck One'))::text, 'true/true/false');

  for i in 1..12 loop
    perform public.crm_reconcile_live();
  end loop;
  perform pg_temp.y_eq('XB-5', 'twelve more runs (two hours of the schedule): still one report', pg_temp.y_rows(), 'scheduled:1/1');

  update public.admin_audit_log set created_at = clock_timestamp() - interval '23 hours 59 minutes' where action = 'crm.reconcile_failed';
  perform public.crm_reconcile_live();
  perform pg_temp.y_eq('XB-5', 'a report 23 hours 59 minutes old still covers the same hosts', pg_temp.y_rows(), 'scheduled:1/1');
  update public.admin_audit_log set created_at = clock_timestamp() - interval '24 hours 1 second' where action = 'crm.reconcile_failed';
  perform public.crm_reconcile_live();
  perform public.crm_reconcile_live();
  perform pg_temp.y_eq('XB-5', 'a report 24 hours and a second old no longer does: one new report, then quiet again', pg_temp.y_rows(), 'scheduled:1/0 scheduled:1/1');

  -- A run for one host reports every time and is never mistaken for the schedule.
  perform public.crm_reconcile_live(v_one);
  perform public.crm_reconcile_live(v_one);
  perform pg_temp.y_eq('XB-5', 'two runs for the one host: two reports of their own kind', pg_temp.y_rows(), 'record:1/0 record:1/0 scheduled:1/0 scheduled:1/1');
  delete from public.admin_audit_log where action = 'crm.reconcile_failed' and metadata ->> 'scope' = 'scheduled';
  perform public.crm_reconcile_live();
  perform pg_temp.y_eq('XB-5', 'reports of single-host runs do not silence the schedule (same hosts, same fingerprint)',
    pg_temp.y_rows() || ' ' || (select count(distinct metadata ->> 'fingerprint') from public.admin_audit_log where action = 'crm.reconcile_failed'),
    'record:1/0 record:1/0 scheduled:1/0 1');

  -- The set changes, then changes back.
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status) values
    ('38020000-0000-4000-e420-000000000002', '38020000-0000-4000-e100-000000000002', 'Issue3802y two', 'issue3802y-two', 'public', 'scheduled');
  set local session_replication_role = origin;
  perform public.crm_reconcile_live();
  perform public.crm_reconcile_live();
  perform pg_temp.y_eq('XB-5', 'a second host starts failing: reported at once, and once', pg_temp.y_rows(), 'record:1/0 record:1/0 scheduled:1/0 scheduled:2/0');
  perform set_config('t3802y.fault_names', 'XB5 Stuck One', true);
  perform pg_temp.y_eq('XB-5', 'one of the two recovers: the next run promotes one host',
    pg_temp.y_as('server', 'select public.crm_reconcile_live()::text'), '1');
  perform pg_temp.y_eq('XB-5', 'and it is the one that recovered', (select stage from public.crm_records where id = v_two), 'live');
  perform pg_temp.y_eq('XB-5', 'the set is back to the one already reported today: no new report',
    pg_temp.y_rows(), 'record:1/0 record:1/0 scheduled:1/0 scheduled:2/0');
  perform pg_temp.y_eq('XB-5', 'no report names a host, a business or the error',
    (select count(*)::text from public.admin_audit_log l where l.action = 'crm.reconcile_failed'
        and (l.metadata::text ~* 'stuck|planted|55000' or l.metadata::text like '%' || v_one::text || '%' or l.metadata::text like '%' || v_two::text || '%'
             or (select count(*) from jsonb_object_keys(l.metadata)) <> 4)), '0');
  perform pg_temp.y_eq('XB-5', 'the stuck host is untouched and still linked',
    (select stage || '/' || (brand_id is not null)::text from public.crm_records where id = v_one), 'onboarded/true');

  drop trigger t3802y_fault on public.crm_records;
  perform pg_temp.y_eq('XB-5', 'with the fault gone the host is promoted and nothing more is reported',
    pg_temp.y_as('server', 'select public.crm_reconcile_live()::text') || ' ' || pg_temp.y_rows(), '1 record:1/0 record:1/0 scheduled:1/0 scheduled:2/0');
end;
$xb5$;

-- ---------------------------------------------------------------------------
-- XB-6 — the numbers, against counts written a different way.
-- ---------------------------------------------------------------------------
create function pg_temp.y_due(p_owner text, p_today date, p_pipe text) returns text
language sql as $fn$
  select count(*) filter (where r.due_on < p_today) || '/' || count(*) filter (where r.due_on = p_today)
    from public.crm_records r
   where r.pipeline = p_pipe and r.deleted_at is null and r.due_on <= p_today and r.stage not in ('lost', 'passed')
     and (p_owner is null or r.id in (select o.record_id from public.crm_record_owners o where o.owner_email = p_owner))
$fn$;

do $xb6$
declare
  v_utc date := (now() at time zone 'utc')::date;
  v_week timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  c_region constant text := '38020000-0000-4000-e200-000000000001';
  c_other constant text := '38020000-0000-4000-e200-000000000002';
  v_id uuid;
  v_del uuid;
  v_lost uuid;
  v_today date;
  v_who text;
  v_email text;
  v_pipe text;
  v_j jsonb;
  v_bad int := 0;
  v_n int := 0;
  v_ids uuid[];
  r record;
begin
  -- Cards due around today, with one, two and no owners, in both pipelines.
  perform pg_temp.y_make('growth',  'hosts',    jsonb_build_object('name', 'XB6 yesterday mine',      'due_on', v_utc - 1, 'owners', jsonb_build_array('issue3802y-growth@test.local')));
  perform pg_temp.y_make('growth',  'hosts',    jsonb_build_object('name', 'XB6 today shared',        'due_on', v_utc,     'owners', jsonb_build_array('issue3802y-growth@test.local', 'issue3802y-growth2@test.local')));
  perform pg_temp.y_make('growth',  'hosts',    jsonb_build_object('name', 'XB6 tomorrow mine',       'due_on', v_utc + 1, 'owners', jsonb_build_array('issue3802y-growth@test.local')));
  perform pg_temp.y_make('growth2', 'hosts',    jsonb_build_object('name', 'XB6 today theirs',        'due_on', v_utc,     'owners', jsonb_build_array('issue3802y-growth2@test.local')));
  perform pg_temp.y_make('partner', 'hosts',    jsonb_build_object('name', 'XB6 a year ago',          'due_on', v_utc - 400, 'owners', jsonb_build_array('issue3802y-partner@test.local')));
  perform pg_temp.y_make('growth',  'creators', jsonb_build_object('name', 'XB6 creator today',       'due_on', v_utc,     'owners', jsonb_build_array('issue3802y-growth@test.local')));
  v_id := pg_temp.y_make('owner',   'creators', jsonb_build_object('name', 'XB6 creator nobody',      'due_on', v_utc - 1));
  perform pg_temp.y_as('owner', format($q$select public.crm_record_set_owners(%L, '{}')::text$q$, v_id));
  v_lost := pg_temp.y_make('growth', 'hosts',   jsonb_build_object('name', 'XB6 today but lost',      'due_on', v_utc,     'owners', jsonb_build_array('issue3802y-growth@test.local')));
  perform pg_temp.y_move('growth', v_lost, 'lost', 'closed', 'prospect');
  v_id := pg_temp.y_make('growth', 'creators',  jsonb_build_object('name', 'XB6 creator passed',      'due_on', v_utc - 2, 'owners', jsonb_build_array('issue3802y-growth@test.local')));
  perform pg_temp.y_move('growth', v_id, 'passed', 'no', 'identified');
  v_del := pg_temp.y_make('growth', 'hosts',    jsonb_build_object('name', 'XB6 today but deleted',   'due_on', v_utc,     'owners', jsonb_build_array('issue3802y-growth@test.local')));
  perform pg_temp.y_as('owner', format('select public.crm_record_delete(%L)::text', v_del));

  foreach v_today in array array[v_utc - 1, v_utc, v_utc + 1] loop
    for v_who, v_email in select who, email from y_people where who in ('owner', 'growth', 'growth2', 'partner') loop
      v_j := pg_temp.y_as(v_who, format('select public.crm_home_summary(%L)::text', v_today))::jsonb;
      foreach v_pipe in array array['hosts', 'creators'] loop
        v_n := v_n + 1;
        if (v_j #>> array['due', 'mine', v_pipe, 'overdue']) || '/' || (v_j #>> array['due', 'mine', v_pipe, 'today']) is distinct from pg_temp.y_due(v_email, v_today, v_pipe)
           or (v_j #>> array['due', 'team', v_pipe, 'overdue']) || '/' || (v_j #>> array['due', 'team', v_pipe, 'today']) is distinct from pg_temp.y_due(null, v_today, v_pipe)
           or (v_j ->> 'today') is distinct from v_today::text
           or jsonb_array_length(v_j #> array['due', 'team', v_pipe, 'rows']) <> 0
           or jsonb_array_length(v_j #> array['due', 'mine', v_pipe, 'rows'])
                <> (v_j #>> array['due', 'mine', v_pipe, 'overdue'])::int + (v_j #>> array['due', 'mine', v_pipe, 'today'])::int then
          v_bad := v_bad + 1;
        end if;
      end loop;
    end loop;
  end loop;
  perform pg_temp.y_eq('XB-6', 'what is due: 3 days x 4 people x 2 pipelines, mine and team, against a separate count', v_bad::text || ' wrong of ' || v_n::text, '0 wrong of 24');

  v_j := pg_temp.y_as('growth', format('select public.crm_home_summary(%L)::text', v_utc))::jsonb;
  perform pg_temp.y_eq('XB-6', 'mine means co-owned too; lost, passed, deleted and not-yet-due cards are left out',
    (select string_agg(x ->> 'name', ', ' order by x ->> 'due_on', x ->> 'name') from jsonb_array_elements(v_j #> '{due,mine,hosts,rows}') x),
    'XB6 yesterday mine, XB6 today shared');
  perform pg_temp.y_eq('XB-6', 'a card with no owner is in the team count and in nobody''s own',
    (v_j #>> '{due,team,creators,overdue}') || '/' || (v_j #>> '{due,mine,creators,overdue}'), '1/0');
  perform pg_temp.y_eq('XB-6', 'a row carries what the screen needs and no bookkeeping',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_j #> '{due,mine,hosts,rows,0}') k),
    'due_on,icp,id,name,next_action,owners,pipeline,region_id,stage');

  -- A day more than one away from the server's is not believed.
  for r in select * from (values ((v_utc + 2)::text), ((v_utc - 2)::text), ('0001-01-01'), ('9999-12-31'), ('infinity'), ('-infinity')) as t(d) loop
    perform pg_temp.y_eq('XB-6', 'a viewer''s day of ' || r.d || ' is replaced by the server''s',
      pg_temp.y_as('growth', format('select public.crm_home_summary(%L)::text', r.d))::jsonb ->> 'today', v_utc::text);
    perform pg_temp.y_eq('XB-6', 'the team dashboard treats ' || r.d || ' the same way',
      pg_temp.y_as('admin', format('select public.crm_team_summary(%L)::text', r.d))::jsonb ->> 'today', v_utc::text);
  end loop;
  perform pg_temp.y_eq('XB-6', 'no day sent means the server''s day',
    pg_temp.y_as('growth', 'select public.crm_home_summary(null)::text')::jsonb ->> 'today', v_utc::text);
  perform pg_temp.y_eq('XB-6', 'stage counts add up to the records there are',
    (select sum((s ->> 'count')::int)::text from jsonb_array_elements(v_j #> '{stages,hosts}') s),
    (select count(*)::text from public.crm_records where pipeline = 'hosts' and deleted_at is null));

  -- This week by person: the first microsecond of Monday counts, the one before does not.
  v_id := pg_temp.y_make('growth2', 'hosts', '{"name": "XB6 week probe"}');
  perform pg_temp.y_as('growth2', format($q$select public.crm_record_log(%L, '{"kind":"touch","channel":"email","direction":"outbound","body":"a"}', 'yk-w1-38020000-0000-4000-e800-000000000001')::text$q$, v_id));
  perform pg_temp.y_as('growth2', format($q$select public.crm_record_log(%L, '{"kind":"touch","channel":"email","direction":"outbound","body":"b"}', 'yk-w2-38020000-0000-4000-e800-000000000001')::text$q$, v_id));
  perform pg_temp.y_as('growth2', format($q$select public.crm_record_log(%L, '{"kind":"touch","channel":"email","direction":"outbound","body":"c"}', 'yk-w3-38020000-0000-4000-e800-000000000001')::text$q$, v_id));
  select array_agg(a.id order by a.body) into v_ids from public.crm_activity a where a.record_id = v_id and a.kind = 'touch';
  update public.crm_activity set created_at = v_week where id = v_ids[1];
  update public.crm_activity set created_at = v_week - interval '1 microsecond' where id = v_ids[2];
  insert into public.crm_activity (record_id, kind, actor_email, body, occurred_at, created_at)
  values (v_id, 'note', 'issue3802y-gone@test.local', 'by someone who has left', now(), now());
  v_j := pg_temp.y_as('admin', 'select public.crm_team_summary()::text')::jsonb;
  v_bad := 0;
  for r in select x from jsonb_array_elements(v_j -> 'by_person') x loop
    if (r.x ->> 'touches') || '/' || (r.x ->> 'stage_moves') || '/' || (r.x ->> 'added')
         is distinct from (select count(*) filter (where kind = 'touch') || '/' || count(*) filter (where kind = 'stage_move') || '/' || count(*) filter (where kind = 'created')
                             from public.crm_activity where actor_email = r.x ->> 'email' and created_at >= v_week)
       or (r.x ->> 'overdue') || '/' || (r.x ->> 'due_today')
         is distinct from (select count(*) filter (where c.due_on < v_utc) || '/' || count(*) filter (where c.due_on = v_utc)
                             from public.crm_records c join public.crm_record_owners o on o.record_id = c.id
                            where o.owner_email = r.x ->> 'email' and c.deleted_at is null and c.stage not in ('lost', 'passed')) then
      v_bad := v_bad + 1;
    end if;
  end loop;
  perform pg_temp.y_eq('XB-6', 'this week by person: every person''s five numbers against a separate count', v_bad::text, '0');
  perform pg_temp.y_eq('XB-6', 'the touch logged in the first microsecond of the week counts; the one a microsecond earlier does not',
    (select x ->> 'touches' from jsonb_array_elements(v_j -> 'by_person') x where x ->> 'email' = 'issue3802y-growth2@test.local'), '2');
  perform pg_temp.y_eq('XB-6', 'the week starts on Monday at midnight UTC',
    to_char((v_j ->> 'week_start')::timestamptz at time zone 'utc', 'ID HH24:MI:SS'), '1 00:00:00');
  perform pg_temp.y_eq('XB-6', 'someone who logged this week but is not on the team is listed last, marked as former, with no role',
    (v_j -> 'by_person' -> -1 ->> 'email') || '/' || (v_j -> 'by_person' -> -1 ->> 'status') || '/' || coalesce(v_j -> 'by_person' -> -1 ->> 'role', '<none>'),
    'issue3802y-gone@test.local/former/<none>');
  perform pg_temp.y_eq('XB-6', 'the owner is listed first', v_j -> 'by_person' -> 0 ->> 'role', 'owner');
  perform pg_temp.y_eq('XB-6', 'nothing a person logged this week is left out of the table',
    (select sum((x ->> 'touches')::int + (x ->> 'stage_moves')::int + (x ->> 'added')::int)::text from jsonb_array_elements(v_j -> 'by_person') x),
    (select count(*)::text from public.crm_activity where actor_email is not null and created_at >= v_week and kind in ('touch', 'stage_move', 'created')));

  -- Targets: what "done" counts, to the microsecond of the month.
  perform pg_temp.y_as('admin', format('select public.crm_target_set(%L, %L, 3)::text', c_region, 'event_organizer'));
  perform pg_temp.y_as('admin', format('select public.crm_target_set(%L, %L, 1000)::text', c_region, 'venue_gallery'));
  for r in select * from (values ('XB6T this month', c_region), ('XB6T first microsecond', c_region), ('XB6T last microsecond before', c_region),
                                 ('XB6T earlier, left, came back', c_region), ('XB6T reached then lost', c_region), ('XB6T reached then deleted', c_region),
                                 ('XB6T reached then moved back', c_region), ('XB6T other region', c_other), ('XB6T reached then ICP changed', c_region),
                                 ('XB6T never reached', c_region)) as t(name, region) loop
    v_id := pg_temp.y_make('growth', 'hosts', jsonb_build_object('name', r.name, 'icp', 'event_organizer', 'region_id', r.region));
    if r.name <> 'XB6T never reached' then
      perform pg_temp.y_move('growth', v_id, 'onboarded', null, 'prospect');
    end if;
    if r.name = 'XB6T first microsecond' then
      update public.crm_activity set created_at = v_month where record_id = v_id and to_stage = 'onboarded';
    elsif r.name = 'XB6T last microsecond before' then
      update public.crm_activity set created_at = v_month - interval '1 microsecond' where record_id = v_id and to_stage = 'onboarded';
    elsif r.name = 'XB6T earlier, left, came back' then
      update public.crm_activity set created_at = v_month - interval '20 days' where record_id = v_id and to_stage = 'onboarded';
      perform pg_temp.y_move('growth', v_id, 'meeting', null, 'onboarded');
      perform pg_temp.y_move('growth', v_id, 'onboarded', null, 'meeting');
    elsif r.name = 'XB6T reached then lost' then
      perform pg_temp.y_move('growth', v_id, 'lost', 'closed', 'onboarded');
    elsif r.name = 'XB6T reached then deleted' then
      perform pg_temp.y_as('owner', format('select public.crm_record_delete(%L)::text', v_id));
    elsif r.name = 'XB6T reached then moved back' then
      perform pg_temp.y_move('growth', v_id, 'replied', null, 'onboarded');
    elsif r.name = 'XB6T reached then ICP changed' then
      perform pg_temp.y_as('growth', format($q$select public.crm_record_update(%L, '{"icp": "venue_gallery"}')::text$q$, v_id));
    end if;
  end loop;
  v_j := pg_temp.y_as('partner', 'select public.crm_home_summary()::text')::jsonb;
  perform pg_temp.y_eq('XB-6', 'done counts only hosts that first reached Onboarded or Live this month and are still there; in pipeline leaves out lost, deleted, another region and another ICP',
    (select string_agg((t ->> 'icp') || ' ' || (t ->> 'done') || ' of ' || (t ->> 'monthly_target') || ', ' || (t ->> 'in_pipeline') || ' in pipeline', '; ' order by t ->> 'icp')
       from jsonb_array_elements(v_j -> 'targets') t),
    'event_organizer 2 of 3, 6 in pipeline; venue_gallery 1 of 1000, 1 in pipeline');
  perform pg_temp.y_eq('XB-6', 'the month starts on the first, UTC', v_j ->> 'month_start', to_char(v_month at time zone 'utc', 'YYYY-MM-DD'));
  perform pg_temp.y_eq('XB-6', 'a Founding partner reads targets and is told they cannot set them', v_j ->> 'can_set_targets', 'false');
  perform pg_temp.y_eq('XB-6', 'an admin is told they can',
    pg_temp.y_as('admin', 'select public.crm_home_summary()::text')::jsonb ->> 'can_set_targets', 'true');
end;
$xb6$;

-- ---------------------------------------------------------------------------
-- XB-7 — targets: every bad argument, repeats, the audit count.
-- ---------------------------------------------------------------------------
do $xb7$
declare
  c_region constant text := '38020000-0000-4000-e200-000000000002';
  v_audit int := (select count(*) from public.admin_audit_log where action like 'crm.target%');
  v_rows int := (select count(*) from public.crm_targets);
  r record;
  v_j jsonb;
begin
  for r in select * from (values
      ('zero',                 format('%L, %L, 0', c_region, 'partner_org'),        'ERR:22023:invalid_target:%'),
      ('one over the top',     format('%L, %L, 1001', c_region, 'partner_org'),     'ERR:22023:invalid_target:%'),
      ('a negative number',    format('%L, %L, -1', c_region, 'partner_org'),       'ERR:22023:invalid_target:%'),
      ('the largest integer',  format('%L, %L, 2147483647', c_region, 'partner_org'), 'ERR:22023:invalid_target:%'),
      ('a creator ICP',        format('%L, %L, 5', c_region, 'food'),               'ERR:22023:invalid_icp:%'),
      ('an ICP in capitals',   format('%L, %L, 5', c_region, 'PARTNER_ORG'),        'ERR:22023:invalid_icp:%'),
      ('no ICP',               format('%L, null, 5', c_region),                     'ERR:22023:invalid_icp:%'),
      ('a region that is not a Launch City', format('%L, %L, 5', gen_random_uuid(), 'partner_org'), 'ERR:22023:invalid_region:%'),
      ('no region',            format('null, %L, 5', 'partner_org'),                'ERR:22023:invalid_region:%')
    ) as t(label, args, want) loop
    perform pg_temp.y_like('XB-7', 'a target with ' || r.label || ' is refused in plain words',
      pg_temp.y_as('owner', 'select public.crm_target_set(' || r.args || ')::text'), r.want);
  end loop;
  perform pg_temp.y_eq('XB-7', 'nine refusals wrote no target and no audit row',
    ((select count(*) from public.crm_targets) - v_rows)::text || '/' || ((select count(*) from public.admin_audit_log where action like 'crm.target%') - v_audit)::text, '0/0');
  perform pg_temp.y_eq('XB-7', 'removing a target that is not there is an answer, not an error',
    pg_temp.y_as('owner', format('select public.crm_target_set(%L, %L, null)::text', c_region, 'partner_org'))::jsonb ->> 'changed', 'false');

  v_j := pg_temp.y_as('owner', format('select public.crm_target_set(%L, %L, 1)::text', c_region, 'partner_org'))::jsonb;
  perform pg_temp.y_eq('XB-7', 'the smallest target is set, and the answer says there was none before',
    (v_j ->> 'changed') || '/' || coalesce(v_j ->> 'previous', '<none>') || '/' || (v_j #>> '{target,monthly_target}'), 'true/<none>/1');
  v_j := pg_temp.y_as('admin', format('select public.crm_target_set(%L, %L, 1000)::text', c_region, 'partner_org'))::jsonb;
  perform pg_temp.y_eq('XB-7', 'the largest target replaces it, by another person, and the answer carries the old number for Undo',
    (v_j ->> 'changed') || '/' || (v_j ->> 'previous') || '/' || (v_j #>> '{target,monthly_target}'), 'true/1/1000');
  for i in 1..3 loop
    v_j := pg_temp.y_as('admin', format('select public.crm_target_set(%L, %L, 1000)::text', c_region, 'partner_org'))::jsonb;
  end loop;
  perform pg_temp.y_eq('XB-7', 'the same number three more times changes nothing', v_j ->> 'changed', 'false');
  v_j := pg_temp.y_as('owner', format('select public.crm_target_set(%L, %L, %s)::text', c_region, 'partner_org', 1))::jsonb;
  v_j := pg_temp.y_as('owner', format('select public.crm_target_set(%L, %L, null)::text', c_region, 'partner_org'))::jsonb;
  perform pg_temp.y_eq('XB-7', 'removal answers with the number that was removed', (v_j ->> 'changed') || '/' || (v_j ->> 'previous') || '/' || coalesce(v_j ->> 'target', '<none>'), 'true/1/<none>');
  perform pg_temp.y_eq('XB-7', 'four real changes wrote four audit rows; five repeats and no-ops wrote none',
    ((select count(*) from public.admin_audit_log where action like 'crm.target%') - v_audit)::text, '4');
  perform pg_temp.y_eq('XB-7', 'each audit row names the real person and the slice, and nothing else',
    (select string_agg(l.action || ' ' || l.admin_email || ' ' || (select string_agg(k, ',' order by k) from jsonb_object_keys(l.metadata) k), ' | ' order by l.action desc, l.admin_email)
       from public.admin_audit_log l where l.action like 'crm.target%' and l.metadata ->> 'icp' = 'partner_org'),
    'crm.target_set issue3802y-admin@test.local after,before,icp,region_id | crm.target_set issue3802y-owner@test.local after,before,icp,region_id | crm.target_set issue3802y-owner@test.local after,before,icp,region_id | crm.target_remove issue3802y-owner@test.local before,icp,region_id');
  for r in select who from y_people where who in ('growth', 'partner', 'consumer') loop
    perform pg_temp.y_like('XB-7', r.who || ' cannot set, change or remove a target',
      pg_temp.y_as(r.who, format('select public.crm_target_set(%L, %L, 5)::text', c_region, 'partner_org'))
        || pg_temp.y_as(r.who, format('select public.crm_target_set(%L, %L, null)::text', '38020000-0000-4000-e200-000000000001', 'event_organizer')),
      'ERR:42501:%ERR:42501:%');
  end loop;
  perform pg_temp.y_like('XB-7', 'a signed-out caller cannot set a target',
    pg_temp.y_as('anon', format('select public.crm_target_set(%L, %L, 5)::text', c_region, 'partner_org')), 'ERR:42501:%');
  perform pg_temp.y_eq('XB-7', 'the target those callers aimed at is still there',
    (select monthly_target::text from public.crm_targets where icp = 'event_organizer'), '3');
end;
$xb7$;

-- ---------------------------------------------------------------------------
-- XB-8 — the lead type table, city spellings, and what the reader never says.
-- ---------------------------------------------------------------------------
do $xb8$
declare
  c_types constant text[] := array['restaurant', 'cafe_bar', 'club_nightlife', 'venue_space', 'event_organiser', 'experience_tour', 'other'];
  c_icps  constant text[] := array['restaurant_bar', 'restaurant_bar', 'venue_gallery', 'venue_gallery', 'event_organizer', 'trip_stay_host', null];
  v_mask int;
  v_chosen text[];
  v_icps text[];
  v_want text;
  v_got jsonb;
  v_bad int := 0;
  v_who text;
  v_j jsonb;
  r record;
begin
  for v_mask in 0..127 loop
    select coalesce(array_agg(c_types[i]) filter (where (v_mask >> (i - 1)) & 1 = 1), '{}'),
           coalesce(array_agg(distinct c_icps[i]) filter (where (v_mask >> (i - 1)) & 1 = 1 and c_icps[i] is not null), '{}')
      into v_chosen, v_icps from generate_series(1, 7) i;
    v_want := case cardinality(v_icps) when 1 then v_icps[1] || '|set' when 0 then '|none' else '|several' end;
    v_got := public.crm_beta_icp(v_chosen);
    if coalesce(v_got ->> 'icp', '') || '|' || (v_got ->> 'note') is distinct from v_want then
      v_bad := v_bad + 1;
    end if;
  end loop;
  perform pg_temp.y_eq('XB-8', 'all 128 combinations of the seven lead types give the ICP a separate rule expects', v_bad::text, '0');
  perform pg_temp.y_eq('XB-8', 'the order and repetition of types change nothing',
    (public.crm_beta_icp(array['cafe_bar', 'restaurant', 'cafe_bar']) ->> 'icp') || '/' || (public.crm_beta_icp(array['other', 'venue_space', 'club_nightlife', 'other']) ->> 'icp'),
    'restaurant_bar/venue_gallery');
  perform pg_temp.y_eq('XB-8', 'no types at all is "none", never a guess',
    (public.crm_beta_icp(null) ->> 'note') || '/' || (public.crm_beta_icp('{}') ->> 'note') || '/' || coalesce(public.crm_beta_icp('{}') ->> 'icp', '<none>'), 'none/none/<none>');

  for r in select * from (values
      ('Yport', 'set'), ('yport', 'set'), ('  YPORT ', 'set'), ('Yport, Nigeria', 'set'), ('yport,ng', 'set'), (', Yport', 'set'),
      (U&'\FF39\FF50\FF4F\FF52\FF54', 'set'), ('Y.p.o.r.t', 'set'), (U&'Ya\0303o Vila', 'set'), ('Yao Vila', 'not_launch_city'),
      ('Yport Island', 'not_launch_city'), ('New Yport', 'not_launch_city'), ('Yport / Ytwin', 'not_launch_city'),
      ('Ytwin', 'ambiguous'), ('ytwin, somewhere', 'ambiguous'), ('', 'not_launch_city'), (',', 'not_launch_city'), (U&'\2800', 'not_launch_city')
    ) as t(city, want) loop
    perform pg_temp.y_eq('XB-8', 'a city typed as ' || quote_literal(r.city) || ' is ' || r.want, public.crm_city_region(r.city) ->> 'note', r.want);
  end loop;
  perform pg_temp.y_eq('XB-8', 'an ambiguous or unknown city carries no region at all',
    coalesce(public.crm_city_region('Ytwin') ->> 'region_id', '<none>') || '/' || coalesce(public.crm_city_region('Nowhere') ->> 'region_id', '<none>'), '<none>/<none>');

  -- Leads with every private field filled in with a marker.
  insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, phone, consent, source, user_agent, referer, ip_hash) values
    ('38020000-0000-4000-e500-000000000011', array['restaurant'],                'XB8 One',   'Contact One', 'Yport',  'issue3802y-one@test.local',   '+15550000011', true, 'organiser_marketing_hero', 'YSECRET-agent-1', 'https://ysecret.example/ref', 'YSECRET-hash-1'),
    ('38020000-0000-4000-e500-000000000012', array['cafe_bar', 'club_nightlife'], 'XB8 Two',   'Contact Two', 'Ytwin',  'issue3802y-two@test.local',   '+15550000012', true, 'organiser_marketing_nav',  'YSECRET-agent-2', null,                          'YSECRET-hash-2'),
    ('38020000-0000-4000-e500-000000000013', array['other'],                     'XB8 Three', 'Contact Three', 'Atlantis', 'issue3802y-three@test.local', '+15550000013', true, 'organiser_marketing',     null,              null,                          null);
  foreach v_who in array array['owner', 'admin', 'growth', 'partner'] loop
    v_j := pg_temp.y_as(v_who, 'select public.crm_beta_leads_list()::text')::jsonb;
    perform pg_temp.y_eq('XB-8', v_who || ': the reader carries the contact name and email and none of the private fields',
      (v_j::text like '%Contact One%')::text || '/' || (v_j::text like '%issue3802y-one@test.local%')::text
        || '/' || (v_j::text ~* 'YSECRET|\+1555|phone|user_agent|referer|ip_hash|consent')::text, 'true/true/false');
    perform pg_temp.y_eq('XB-8', v_who || ': a lead has exactly these ten fields',
      (select string_agg(k, ',' order by k) from jsonb_object_keys(v_j -> 'leads' -> 0) k),
      'brand_name,brand_types,city,contact_name,created_at,email,host,id,source,suggested');
    perform pg_temp.y_eq('XB-8', v_who || ': the home and (for admins) the dashboard carry no lead detail at all',
      (pg_temp.y_as(v_who, 'select public.crm_home_summary()::text') ~* 'YSECRET|\+1555|issue3802y-one@|Contact One')::text, 'false');
  end loop;
  perform pg_temp.y_eq('XB-8', 'the full-admin reader is unchanged: refused for the two new roles, open to an admin',
    left(pg_temp.y_as('growth', 'select count(*)::text from public.admin_beta_leads_list()'), 9) || '/' || left(pg_temp.y_as('partner', 'select count(*)::text from public.admin_beta_leads_list()'), 9)
      || '/' || (pg_temp.y_as('admin', 'select count(*)::text from public.admin_beta_leads_list()') ~ '^\d+$')::text, 'ERR:42501/ERR:42501/true');
  perform pg_temp.y_like('XB-8', 'no client caller reads the leads table directly, private fields or not',
    pg_temp.y_as('growth', 'select count(*)::text from public.beta_access_leads where phone is not null'), '%');
  perform pg_temp.y_eq('XB-8', 'and a direct read returns no row to the two new roles',
    coalesce(nullif(pg_temp.y_as('growth', 'select count(*)::text from public.beta_access_leads'), '0'), 'none')
      like any (array['none', 'ERR:42501:%']), 'true');
  v_j := pg_temp.y_as('growth', 'select public.crm_beta_leads_list()::text')::jsonb;
  perform pg_temp.y_eq('XB-8', 'each lead says what Add to Hosts would carry over',
    (select string_agg((l ->> 'brand_name') || ' ' || (l #>> '{suggested,icp_note}') || '/' || (l #>> '{suggested,region_note}') || '/' || coalesce(l #>> '{suggested,icp_label}', '-') || '/' || coalesce(l #>> '{suggested,region_name}', '-'), '; ' order by l ->> 'brand_name')
       from jsonb_array_elements(v_j -> 'leads') l where l ->> 'brand_name' like 'XB8 %'),
    'XB8 One set/set/Restaurant or bar/Yport; XB8 Three none/not_launch_city/-/-; XB8 Two several/ambiguous/-/-');
end;
$xb8$;

-- ---------------------------------------------------------------------------
-- XB-9 — Add to Hosts after the first press.
-- ---------------------------------------------------------------------------
do $xb9$
declare
  c_one constant uuid := '38020000-0000-4000-e500-000000000011';
  c_two constant uuid := '38020000-0000-4000-e500-000000000012';
  c_twin constant uuid := '38020000-0000-4000-e500-000000000021';
  c_long constant uuid := '38020000-0000-4000-e500-000000000022';
  c_blank constant uuid := '38020000-0000-4000-e500-000000000023';
  v_j jsonb;
  v_h1 uuid;
  v_h2 uuid;
  v_hand uuid;
  v_audit int := (select count(*) from public.admin_audit_log where action like 'crm.beta%');
begin
  v_j := pg_temp.y_as('partner', format('select public.crm_beta_lead_to_host(%L)::text', c_one))::jsonb;
  v_h1 := (v_j #>> '{record,id}')::uuid;
  perform pg_temp.y_eq('XB-9', 'the first press makes the host: Inbound, by email, the mapped ICP and region, the presser as owner, the lead tied to it',
    (v_j ->> 'status') || '/' || (v_j #>> '{record,source}') || '/' || (v_j #>> '{record,channel}') || '/' || (v_j #>> '{record,icp}') || '/' || (v_j #>> '{record,region_id}')
      || '/' || (v_j #>> '{record,owners,0}') || '/' || (v_j #>> '{record,beta_lead_id}') || '/' || (v_j #>> '{record,stage}'),
    'created/inbound/email/restaurant_bar/38020000-0000-4000-e200-000000000001/issue3802y-partner@test.local/' || c_one::text || '/prospect');
  perform pg_temp.y_eq('XB-9', 'the contact line is the email, then the contact name; never the phone',
    v_j #>> '{record,contact}', 'issue3802y-one@test.local' || U&' \00B7 ' || 'Contact One');
  perform pg_temp.y_eq('XB-9', 'nothing private went onto the host or into its log or audit rows',
    ((select row_to_json(c)::text from public.crm_records c where c.id = v_h1)
      || (select string_agg(coalesce(a.body, ''), ' ') from public.crm_activity a where a.record_id = v_h1)
      || (select string_agg(l.metadata::text, ' ') from public.admin_audit_log l where l.target_id = v_h1::text) ~* 'YSECRET|\+1555')::text, 'false');
  perform pg_temp.y_eq('XB-9', 'the audit rows for the conversion carry ids and notes, no name and no address',
    (select string_agg(l.action || ':' || (l.metadata::text ~* 'issue3802y-one@|Contact One')::text, ',' order by l.id) from public.admin_audit_log l where l.target_id = v_h1::text and l.action like 'crm.beta%'),
    'crm.beta_lead_convert:false');

  -- Pressed again by everyone, ten times.
  for i in 1..10 loop
    v_j := pg_temp.y_as((array['owner', 'admin', 'growth', 'partner', 'growth2'])[1 + i % 5], format('select public.crm_beta_lead_to_host(%L)::text', c_one))::jsonb;
  end loop;
  perform pg_temp.y_eq('XB-9', 'ten more presses by five people: "already a host", the same host, nothing written',
    (v_j ->> 'status') || '/' || ((v_j #>> '{record,id}')::uuid = v_h1)::text || '/' || (select count(*) from public.crm_records where beta_lead_id = c_one)
      || '/' || ((select count(*) from public.admin_audit_log where action like 'crm.beta%') - v_audit), 'exists/true/1/1');

  -- A host made by hand with the name of another lead: linked, never doubled.
  v_hand := pg_temp.y_make('growth2', 'hosts', '{"name": "xb8  TWO"}');
  v_j := pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', c_two))::jsonb;
  perform pg_temp.y_eq('XB-9', 'a lead whose business is already a hand-made host is linked to it; the host keeps its owner and its own fields',
    (v_j ->> 'status') || '/' || ((v_j #>> '{record,id}')::uuid = v_hand)::text
      || '/' || (select string_agg(o.owner_email, ',') from public.crm_record_owners o where o.record_id = v_hand)
      || '/' || (select coalesce(c.source, '<none>') || '/' || (c.beta_lead_id = c_two)::text from public.crm_records c where c.id = v_hand),
    'linked/true/issue3802y-growth2@test.local/<none>/true');
  perform pg_temp.y_eq('XB-9', 'pressed again it is "already a host"',
    pg_temp.y_as('partner', format('select public.crm_beta_lead_to_host(%L)::text', c_two))::jsonb ->> 'status', 'exists');

  -- A second lead from the same business as lead one.
  insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source) values
    (c_twin, array['venue_space'], U&'\FF38\FF22\FF18  one', 'Twin', 'Yport', 'issue3802y-twin@test.local', true, 'organiser_marketing');
  v_j := pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', c_twin))::jsonb;
  perform pg_temp.y_eq('XB-9', 'a second lead with the same business name (in another spelling) is told the host exists; nothing is made or changed',
    (v_j ->> 'status') || '/' || ((v_j #>> '{record,id}')::uuid = v_h1)::text || '/' || (select count(*) from public.crm_records where beta_lead_id = c_twin), 'duplicate/true/0');
  perform pg_temp.y_eq('XB-9', 'the list shows that lead as "a host with this name exists", not as new',
    (select (l #>> '{host,linked}') || '/' || (l #>> '{host,id}') from jsonb_array_elements(pg_temp.y_as('partner', 'select public.crm_beta_leads_list()::text')::jsonb -> 'leads') l where l ->> 'id' = c_twin::text),
    'false/' || v_h1::text);

  -- The host is deleted afterwards.
  perform pg_temp.y_as('owner', format('select public.crm_record_delete(%L)::text', v_h1));
  perform pg_temp.y_eq('XB-9', 'once the host is deleted both leads read "Add to Hosts" again, for everyone',
    (select string_agg(coalesce(l ->> 'host', 'add'), '/' order by l ->> 'id') from jsonb_array_elements(pg_temp.y_as('partner', 'select public.crm_beta_leads_list()::text')::jsonb -> 'leads') l where l ->> 'id' in (c_one::text, c_twin::text)),
    'add/add');
  v_j := pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', c_twin))::jsonb;
  v_h2 := (v_j #>> '{record,id}')::uuid;
  perform pg_temp.y_eq('XB-9', 'the second lead can now be added, and gets its own mapping',
    (v_j ->> 'status') || '/' || (v_j #>> '{record,icp}') || '/' || (v_h2 <> v_h1)::text, 'created/venue_gallery/true');
  perform pg_temp.y_eq('XB-9', 'the first lead is then told the name is taken (by the other lead''s host)',
    pg_temp.y_as('partner', format('select public.crm_beta_lead_to_host(%L)::text', c_one))::jsonb ->> 'status', 'duplicate');
  perform pg_temp.y_like('XB-9', 'restoring the deleted host is refused in plain words while the name is taken',
    pg_temp.y_as('owner', format('select public.crm_record_restore(%L)::text', v_h1)), 'ERR:22023:duplicate_name:%');
  perform pg_temp.y_as('growth', format($q$select public.crm_record_update(%L, '{"name": "XB8 Annex"}')::text$q$, v_h2));
  v_j := pg_temp.y_as('partner', format('select public.crm_beta_lead_to_host(%L)::text', c_one))::jsonb;
  perform pg_temp.y_eq('XB-9', 'with the name free again the first lead becomes a new host', v_j ->> 'status', 'created');
  perform pg_temp.y_like('XB-9', 'restoring the first deleted host is still refused: its name and its lead both belong to a live host now',
    pg_temp.y_as('owner', format('select public.crm_record_restore(%L)::text', v_h1)), 'ERR:22023:duplicate_name:%');
  perform pg_temp.y_eq('XB-9', 'through all of that no lead is on two live hosts and no name is on two live hosts',
    (select count(*)::text from (select 1 from public.crm_records where deleted_at is null and beta_lead_id is not null group by beta_lead_id having count(*) > 1) d)
      || '/' || (select count(*)::text from (select 1 from public.crm_records where deleted_at is null group by pipeline, name_key having count(*) > 1) d), '0/0');

  -- The longest lead the form allows, and a name nobody can see.
  insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source) values
    (c_long, array['event_organiser'], 'XB9 ' || repeat('N', 116), repeat('C', 80), repeat('y', 80), repeat('e', 64) || '@' || repeat('d', 180) || '.example', true, 'organiser_marketing'),
    (c_blank, array['restaurant'], U&'\2800', 'Blank', 'Yport', 'issue3802y-blank@test.local', true, 'organiser_marketing');
  v_j := pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', c_long))::jsonb;
  perform pg_temp.y_eq('XB-9', 'the longest lead becomes a host; the contact line is cut at 300 and the email is never the part that is cut',
    (v_j ->> 'status') || '/' || char_length(v_j #>> '{record,contact}') || '/' || ((v_j #>> '{record,contact}') like repeat('e', 64) || '@' || repeat('d', 180) || '.example' || U&' \00B7 ' || '%')::text
      || '/' || (v_j ->> 'region_note'), 'created/300/true/not_launch_city');
  perform pg_temp.y_like('XB-9', 'a lead whose business name has nothing visible in it is refused in words that say what to do',
    pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', c_blank)),
    'ERR:22023:lead_name_unusable: This lead''s business name cannot be used as a host name. Add the host by hand from Hosts.');
  perform pg_temp.y_eq('XB-9', 'and that refusal made no host', (select count(*)::text from public.crm_records where beta_lead_id = c_blank), '0');
  perform pg_temp.y_like('XB-9', 'a lead that is not there is "no longer here"',
    pg_temp.y_as('growth', format('select public.crm_beta_lead_to_host(%L)::text', gen_random_uuid())), 'ERR:P0002:not_found: That beta lead is no longer here.');
  perform pg_temp.y_like('XB-9', 'no lead id at all is the same answer',
    pg_temp.y_as('growth', 'select public.crm_beta_lead_to_host(null)::text'), 'ERR:P0002:not_found:%');
end;
$xb9$;

-- ---------------------------------------------------------------------------
-- XB-10 — the invite address check.
-- ---------------------------------------------------------------------------
do $xb10$
declare
  r record;
  v_id uuid;
  v_before text;
  v_got text;
  v_seq int := 0;
begin
  for r in select * from (values
      -- label, address of the account, phone, identity provider, identity address, invited as, verdict
      ('no account',                                          null,                            null,           null,     null,                              'issue3802y-i0@test.local',     'ok'),
      ('an account that signs in with this email only',       'issue3802y-i1@test.local',      null,           'email',  'issue3802y-i1@test.local',        'issue3802y-i1@test.local',     'ok'),
      ('a phone that is only spaces',                         'issue3802y-i2@test.local',      '   ',          'email',  'issue3802y-i2@test.local',        'issue3802y-i2@test.local',     'ok'),
      ('a phone number on the account',                       'issue3802y-i3@test.local',      '+15550000003', 'email',  'issue3802y-i3@test.local',        'issue3802y-i3@test.local',     'conflict'),
      ('a phone identity',                                    'issue3802y-i4@test.local',      null,           'phone',  null,                              'issue3802y-i4@test.local',     'conflict'),
      ('a social identity under another address',             'issue3802y-i5@test.local',      null,           'google', 'someone-else@gmail.example',      'issue3802y-i5@test.local',     'conflict'),
      ('a social identity that names no address',             'issue3802y-i6@test.local',      null,           'apple',  null,                              'issue3802y-i6@test.local',     'conflict'),
      ('a social identity under the same address, typed differently', 'issue3802y-i7@test.local', null,        'google', ' ISSUE3802Y-I7@test.local ',      'issue3802y-i7@test.local',     'conflict'),
      ('the invite typed in capitals with spaces, phone account', 'issue3802y-i8@test.local',  '+15550000008', 'email',  'issue3802y-i8@test.local',        '  ISSUE3802Y-I8@TEST.LOCAL ',  'conflict'),
      ('the account stored in capitals, social under another address', 'Issue3802Y-I9@Test.Local', null,       'apple',  'hidden@privaterelay.example',     'issue3802y-i9@test.local',     'conflict')
    ) as t(label, acct, phone, provider, ident_email, invited, want) loop
    v_seq := v_seq + 1;
    if r.acct is not null then
      v_id := ('38020000-0000-4000-e700-0000000000' || lpad(v_seq::text, 2, '0'))::uuid;
      insert into auth.users (id, email, email_confirmed_at, phone) values (v_id, r.acct, now(), r.phone);
      if r.provider is not null then
        insert into auth.identities (user_id, provider, identity_data)
        values (v_id, r.provider, case when r.ident_email is null then '{"sub": "x"}'::jsonb else jsonb_build_object('sub', 'x', 'email', r.ident_email) end);
      end if;
    end if;
    perform pg_temp.y_eq('XB-10', r.label || ': the check answers ' || r.want, public.admin_team_invite_address_verdict(r.invited), r.want);

    v_before := (select count(*) from public.admin_team_members) || '/' || (select count(*) from public.admin_team_invites) || '/' || (select count(*) from public.admin_audit_log where action like 'team.%');
    v_got := pg_temp.y_as('owner', format('select public.admin_team_issue_invite(%L, %L, %L)::text', r.invited, 'growth', md5(r.label) || md5(r.label || 'x')));
    if r.want = 'conflict' then
      perform pg_temp.y_eq('XB-10', r.label || ': the owner is refused with the one code', v_got, 'ERR:22023:address_in_use');
      perform pg_temp.y_eq('XB-10', r.label || ': the refusal leaves no member, no invitation and no audit row',
        (select count(*) from public.admin_team_members) || '/' || (select count(*) from public.admin_team_invites) || '/' || (select count(*) from public.admin_audit_log where action like 'team.%'), v_before);
    else
      perform pg_temp.y_eq('XB-10', r.label || ': the owner''s invitation is issued', v_got::jsonb ->> 'status', 'invited');
      perform pg_temp.y_eq('XB-10', r.label || ': only the hash of the link is kept, under the lower-case address',
        (select (i.token_hash = md5(r.label) || md5(r.label || 'x'))::text || '/' || (i.email = lower(btrim(r.invited)))::text from public.admin_team_invites i where i.email = lower(btrim(r.invited))), 'true/true');
    end if;
    -- Nobody but the owner learns anything: the same refusal for every address.
    perform pg_temp.y_eq('XB-10', r.label || ': an admin, the two team roles and an ordinary account are refused the same way for it',
      pg_temp.y_as('admin', format('select public.admin_team_issue_invite(%L, %L, %L)::text', r.invited, 'growth', repeat('a', 64)))
        || '|' || pg_temp.y_as('growth', format('select public.admin_team_issue_invite(%L, %L, %L)::text', r.invited, 'growth', repeat('a', 64)))
        || '|' || pg_temp.y_as('partner', format('select public.admin_team_issue_invite(%L, %L, %L)::text', r.invited, 'growth', repeat('a', 64)))
        || '|' || pg_temp.y_as('consumer', format('select public.admin_team_issue_invite(%L, %L, %L)::text', r.invited, 'growth', repeat('a', 64))),
      'ERR:42501:forbidden|ERR:42501:forbidden|ERR:42501:forbidden|ERR:42501:forbidden');
    perform pg_temp.y_like('XB-10', r.label || ': the check itself cannot be called by any client',
      pg_temp.y_as('owner', format('select public.admin_team_invite_address_verdict(%L)', r.invited)) || pg_temp.y_as('anon', format('select public.admin_team_invite_address_verdict(%L)', r.invited)),
      'ERR:42501:%ERR:42501:%');
  end loop;

  -- A re-send after the invited account gains another sign-in.
  v_before := (select row_to_json(i)::text from public.admin_team_invites i where i.email = 'issue3802y-i1@test.local')
    || (select row_to_json(m)::text from public.admin_team_members m where m.email = 'issue3802y-i1@test.local');
  update auth.users set phone = '+15550000099' where email = 'issue3802y-i1@test.local';
  perform pg_temp.y_eq('XB-10', 'a re-send to someone whose account has since gained a phone number is refused',
    pg_temp.y_as('owner', format('select public.admin_team_issue_invite(%L, %L, %L)::text', 'issue3802y-i1@test.local', 'growth', repeat('b', 64))), 'ERR:22023:address_in_use');
  perform pg_temp.y_eq('XB-10', 'so is a re-send with another role',
    pg_temp.y_as('owner', format('select public.admin_team_issue_invite(%L, %L, %L)::text', 'issue3802y-i1@test.local', 'partner', repeat('c', 64))), 'ERR:22023:address_in_use');
  perform pg_temp.y_eq('XB-10', 'the refused re-sends changed neither the earlier invitation nor the person''s row',
    (select row_to_json(i)::text from public.admin_team_invites i where i.email = 'issue3802y-i1@test.local')
      || (select row_to_json(m)::text from public.admin_team_members m where m.email = 'issue3802y-i1@test.local'), v_before);
  update auth.users set phone = null where email = 'issue3802y-i1@test.local';
  perform pg_temp.y_eq('XB-10', 'once the other sign-in is gone the re-send goes through',
    pg_temp.y_as('owner', format('select public.admin_team_issue_invite(%L, %L, %L)::text', 'issue3802y-i1@test.local', 'growth', repeat('d', 64)))::jsonb ->> 'status', 'invited');

  -- Someone who already has access is told so first, whatever their account looks like.
  update auth.users set phone = '+15550000098' where email = 'issue3802y-growth@test.local';
  perform pg_temp.y_like('XB-10', 'an active teammate is "already active", not "address in use"',
    pg_temp.y_as('owner', format('select public.admin_team_issue_invite(%L, %L, %L)::text', 'issue3802y-growth@test.local', 'growth', repeat('e', 64))), 'ERR:23505:already_active');
  perform pg_temp.y_eq('XB-10', 'and they keep their access',
    (select status from public.admin_team_members where email = 'issue3802y-growth@test.local'), 'active');
end;
$xb10$;

-- ---------------------------------------------------------------------------
-- Verdict (part 1).
-- ---------------------------------------------------------------------------
do $verdict$
declare
  v_total int;
  v_failed int;
  v_tests text;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from y_results;
  if v_total < 360 then
    raise exception 'ISSUE-3802 HOMES TESTER FAIL: only % checks ran; the suite did not execute fully', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from y_results where not ok order by seq limit 80 loop
      raise warning 'ISSUE-3802 HOMES TESTER FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    select string_agg(distinct test, ', ' order by test) into v_tests from y_results where not ok;
    raise exception 'ISSUE-3802 HOMES TESTER FAIL: % of % checks failed in: %', v_failed, v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 HOMES TESTER PASS (part 1): % checks across XB-1..XB-10, 0 failed', v_total;
end;
$verdict$;

rollback;

-- ===========================================================================
-- PART 2 — real concurrency, three sessions at a time. Three accounts, one
-- card and one target are committed and removed.
-- ===========================================================================
create schema t3802y_race;
select count(*) = 0 as t3802y_made_dblink from pg_extension where extname = 'dblink' \gset
create extension if not exists dblink with schema t3802y_race;
select n.nspname as t3802y_dblink_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'dblink' \gset
set search_path = public, :"t3802y_dblink_schema";
select set_config('t3802y.conn',
  format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s',
         current_setting('port'), current_database(), current_user, :'t3802y_pw'), false) is not null as conn_ready;

create table t3802y_race.results (seq serial primary key, label text, ok boolean, detail text);

begin;
delete from public.crm_activity where record_id in (select id from public.crm_records where created_by like 'issue3802y-race-%');
delete from public.crm_record_owners where record_id in (select id from public.crm_records where created_by like 'issue3802y-race-%');
delete from public.crm_records where created_by like 'issue3802y-race-%';
delete from public.crm_targets where created_by like 'issue3802y-race-%' or updated_by like 'issue3802y-race-%';
set local session_replication_role = replica;
delete from public.admin_audit_log where admin_email like 'issue3802y-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802y-race-%';
delete from auth.users where email like 'issue3802y-race-%';
delete from public.seeding_cities where google_place_id = 'issue3802y-race-city';
insert into auth.users (id, email) values
  ('38020000-0000-4000-e900-000000000001', 'issue3802y-race-1@test.local'),
  ('38020000-0000-4000-e900-000000000002', 'issue3802y-race-2@test.local'),
  ('38020000-0000-4000-e900-000000000003', 'issue3802y-race-3@test.local');
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802y-race-1@test.local', 'admin', 'active', now()),
  ('issue3802y-race-2@test.local', 'admin', 'active', now()),
  ('issue3802y-race-3@test.local', 'admin', 'active', now());
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, is_live_for_consumers) values
  ('38020000-0000-4000-e930-000000000001', 'issue3802y-race-city', 'Issue3802y Race City', 'Nigeria', 'NG', 1, 1, 0, 0, 2, 2, false);
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('38020000-0000-4000-e910-000000000001', 'hosts', 'Issue3802y Race Card', 'prospect', 'issue3802y-race-1@test.local', 'issue3802y-race-1@test.local');
commit;

do $race$
declare
  c_conn constant text := current_setting('t3802y.conn');
  c_card constant text := '38020000-0000-4000-e910-000000000001';
  c_city constant text := '38020000-0000-4000-e930-000000000001';
  c_conns constant text[] := array['t3802y_c1', 't3802y_c2', 't3802y_c3'];
  c_to constant text[] := array['contacted', 'replied', 'lost'];
  v_c text;
  v_n int;
  v_r text;
  v_err text;
  v_moved int := 0;
  v_stale int := 0;
  v_other int := 0;
  v_changed int := 0;
  v_left text[];
begin
  -- RX-1: three people send three different moves for one card, all naming
  -- Prospect, before any of them has finished. Exactly one goes through.
  begin
    v_n := 0;
    foreach v_c in array c_conns loop
      v_n := v_n + 1;
      perform dblink_connect(v_c, c_conn);
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-e900-00000000000%s', true) || set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-e900-00000000000%s","role":"authenticated"}', true)$q$,
        v_n, v_n)) as t(x text);
    end loop;
    v_n := 0;
    foreach v_c in array c_conns loop
      v_n := v_n + 1;
      perform dblink_send_query(v_c, format(
        $q$select public.crm_record_move_stage(%L, %L, %L, 'prospect')::text$q$, c_card, c_to[v_n], case when c_to[v_n] = 'lost' then 'race' end));
    end loop;
    -- Whoever holds the row finishes first and is settled first; each of the
    -- others then sees the stage the card is really in. A session is only
    -- read once it has an answer, so nothing here can wait on a lock.
    v_left := c_conns;
    for i in 1..400 loop
      exit when cardinality(v_left) = 0;
      foreach v_c in array v_left loop
        continue when dblink_is_busy(v_c) = 1;
        v_r := null;
        begin
          select x into v_r from dblink_get_result(v_c, false) as t(x text);
        exception when others then
          v_r := null;
        end;
        v_err := coalesce(dblink_error_message(v_c), '');
        perform * from dblink_get_result(v_c, false) as t(x text);
        if v_r is not null and (v_r::jsonb ->> 'changed') = 'true' then
          v_moved := v_moved + 1;
          perform dblink_exec(v_c, 'commit');
        elsif v_err like '%stage_changed: This card is in % now, not Prospect, so nothing was moved.%' then
          v_stale := v_stale + 1;
          perform dblink_exec(v_c, 'rollback');
        else
          v_other := v_other + 1;
          insert into t3802y_race.results (label, ok, detail) values ('RX-1 an unexpected answer', false, coalesce(left(v_r, 80), '<none>') || ' / ' || left(v_err, 160));
          perform dblink_exec(v_c, 'rollback');
        end if;
        v_left := array_remove(v_left, v_c);
      end loop;
      perform pg_sleep(0.05);
    end loop;
    if cardinality(v_left) > 0 then
      insert into t3802y_race.results (label, ok, detail) values ('RX-1 every session answered', false, array_to_string(v_left, ','));
    end if;
    insert into t3802y_race.results (label, ok, detail)
    values ('RX-1 three different moves at once: one goes through, two are refused as stale', v_moved = 1 and v_stale = 2 and v_other = 0,
            format('moved=%s stale=%s other=%s', v_moved, v_stale, v_other));
    insert into t3802y_race.results (label, ok, detail)
    select 'RX-1 the card moved once: one log line, one audit row, and it is in one of the three stages',
           (select count(*) from public.crm_activity where record_id = c_card::uuid and kind = 'stage_move') = 1
             and (select count(*) from public.admin_audit_log where target_id = c_card and action = 'crm.stage_move') = 1
             and c.stage = any (c_to),
           c.stage from public.crm_records c where c.id = c_card::uuid;
  exception when others then
    insert into t3802y_race.results (label, ok, detail) values ('RX-1 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array c_conns loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then
      perform dblink_disconnect(v_c);
    end if;
  end loop;

  -- RX-2: three admins set the same target to three different numbers at once.
  begin
    v_n := 0;
    foreach v_c in array c_conns loop
      v_n := v_n + 1;
      perform dblink_connect(v_c, c_conn);
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-e900-00000000000%s', true) || set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-e900-00000000000%s","role":"authenticated"}', true)$q$,
        v_n, v_n)) as t(x text);
      perform dblink_send_query(v_c, format($q$select public.crm_target_set(%L, 'partner_org', %s)::text$q$, c_city, 10 + v_n));
    end loop;
    v_err := '';
    v_left := c_conns;
    for i in 1..400 loop
      exit when cardinality(v_left) = 0;
      foreach v_c in array v_left loop
        continue when dblink_is_busy(v_c) = 1;
        v_r := null;
        begin
          select x into v_r from dblink_get_result(v_c, false) as t(x text);
        exception when others then
          v_r := null;
        end;
        v_err := v_err || coalesce(dblink_error_message(v_c), '');
        perform * from dblink_get_result(v_c, false) as t(x text);
        if v_r is not null and (v_r::jsonb ->> 'changed') = 'true' then
          v_changed := v_changed + 1;
        end if;
        perform dblink_exec(v_c, 'commit');
        v_left := array_remove(v_left, v_c);
      end loop;
      perform pg_sleep(0.05);
    end loop;
    if cardinality(v_left) > 0 then
      insert into t3802y_race.results (label, ok, detail) values ('RX-2 every session answered', false, array_to_string(v_left, ','));
    end if;
    insert into t3802y_race.results (label, ok, detail)
    select 'RX-2 three numbers at once for one target: all three are taken in turn, one row is left, three audit rows, no error',
           v_changed = 3 and count(*) = 1 and max(t.monthly_target) between 11 and 13
             and (select count(*) from public.admin_audit_log where action = 'crm.target_set' and admin_email like 'issue3802y-race-%') = 3
             and replace(v_err, 'OK', '') = '',
           format('changed=%s rows=%s number=%s errors=%s', v_changed, count(*), max(t.monthly_target), left(v_err, 120))
      from public.crm_targets t where t.region_id = c_city::uuid and t.icp = 'partner_org';
    insert into t3802y_race.results (label, ok, detail)
    select 'RX-2 the audit rows chain: each "before" is the number the one before it set',
           (select count(*) from public.admin_audit_log l where l.action = 'crm.target_set' and l.admin_email like 'issue3802y-race-%' and l.metadata ->> 'before' is null) = 1
             and (select count(*) from public.admin_audit_log a join public.admin_audit_log b
                    on b.metadata ->> 'before' = a.metadata ->> 'after'
                  where a.action = 'crm.target_set' and b.action = 'crm.target_set' and a.admin_email like 'issue3802y-race-%' and b.admin_email like 'issue3802y-race-%') = 2,
           (select string_agg(coalesce(l.metadata ->> 'before', 'none') || '>' || (l.metadata ->> 'after'), ' ' order by l.id) from public.admin_audit_log l where l.action = 'crm.target_set' and l.admin_email like 'issue3802y-race-%');
  exception when others then
    insert into t3802y_race.results (label, ok, detail) values ('RX-2 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array c_conns loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then
      perform dblink_disconnect(v_c);
    end if;
  end loop;
end;
$race$;

select count(*) as t3802y_race_total,
       count(*) filter (where not ok) as t3802y_race_failed,
       coalesce(string_agg(label || ' [' || coalesce(detail, '') || ']', '; ' order by seq) filter (where not ok), 'none') as t3802y_race_failures
  from t3802y_race.results \gset

-- Remove the committed rows, whatever the verdict.
begin;
delete from public.crm_activity where record_id in (select id from public.crm_records where created_by like 'issue3802y-race-%');
delete from public.crm_record_owners where record_id in (select id from public.crm_records where created_by like 'issue3802y-race-%');
delete from public.crm_records where created_by like 'issue3802y-race-%';
delete from public.crm_targets where created_by like 'issue3802y-race-%' or updated_by like 'issue3802y-race-%';
set local session_replication_role = replica;
delete from public.admin_audit_log where admin_email like 'issue3802y-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802y-race-%';
delete from auth.users where email like 'issue3802y-race-%';
delete from public.seeding_cities where google_place_id = 'issue3802y-race-city';
commit;
reset search_path;
\if :t3802y_made_dblink
drop extension if exists dblink;
\endif
drop schema t3802y_race cascade;

select (:t3802y_race_total < 4 or :t3802y_race_failed > 0) as t3802y_race_bad \gset
\if :t3802y_race_bad
  \echo 'ISSUE-3802 HOMES TESTER FAILED (part 2):' :t3802y_race_failures
  do $$ begin raise exception 'ISSUE-3802 HOMES TESTER FAIL: concurrency checks failed or did not run'; end $$;
\endif
\echo 'ISSUE-3802 HOMES TESTER PASS (part 2):' :t3802y_race_total 'concurrency checks, 0 failed'
