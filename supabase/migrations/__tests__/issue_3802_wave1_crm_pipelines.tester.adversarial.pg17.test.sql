-- Issue #3802 (Wave 1) — Hosts and Creators pipelines: INDEPENDENT TESTER proof.
--
-- A different angle from the implementor suite beside this file. That suite
-- walks each function with the eight ordinary callers and the rules one at a
-- time. This one asks what happens at the edges:
--
--   XA-1   catalog: who holds any privilege on the new tables and functions
--          (the full grantee list, not two named roles), pinned search paths,
--          one schedule entry
--   XA-2   callers the first suite does not use: a session whose claims and
--          account disagree, an account that no longer exists, a session with
--          no account, an unconfirmed mailbox, the server role, and a person
--          whose access is removed in the middle of a transaction
--   XA-3   every internal helper refuses every client role
--   XA-4   every direct statement at the four tables ends in "permission
--          denied" (not in "zero rows"), for every client caller
--   XA-5   no field of any request can name the actor, the agent, the stage,
--          or a bookkeeping column
--   XA-6   delete and restore for the two new roles, with every argument shape
--   XA-7   one name is one record: spelling variants, per-pipeline scope,
--          rename, and bulk add at and over the limit
--   XA-8   request keys: a second person, a second function, different
--          arguments, malformed keys
--   XA-9   the whole stage table: every from-stage x every to-stage, with and
--          without a reason, checked against an independent rule list
--   XA-10  Live: every manual route, every kind of listing that is and is not
--          public (compared with what a signed-out visitor can read), the
--          scheduled run with no signed-in caller, zero records, repeat runs
--   XA-11  undo: someone else, an owner, the system's own moves, a later
--          entry, the time window on both sides, a deleted card
--   XA-12  the Beta leads reader per caller
--   XA-13  areas per role and the unchanged full-admin gate
--   XA-14  search and list inputs are data, never instructions; limits hold;
--          no bookkeeping field leaves
--   XA-15  the audit trail names the real person and never carries what was
--          said
--   Part 2 eight races in real separate sessions
--
-- Part 1 is one transaction, rolled back. Part 2 commits a few rows and
-- removes them. Never run on production.
--
-- Runs as the image's admin role from the repository root, like the suites
-- beside it. Checks are RECORDED and reported together.

\set ON_ERROR_STOP on
\getenv t3802x_pw PGPASSWORD
\set t3802x_mig `cat supabase/migrations/20270820003802_issue_3802_wave1_crm_pipelines.sql`

-- ===========================================================================
-- PART 1 — one transaction, rolled back.
-- ===========================================================================
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table x_mig (body text) on commit drop;
insert into x_mig values (:'t3802x_mig');

create temp table x_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into x_people values
  ('owner',    '38021111-0000-4000-a000-000000000001', 'issue3802x-owner@test.local'),
  ('admin',    '38021111-0000-4000-a000-000000000002', 'issue3802x-admin@test.local'),
  ('growth',   '38021111-0000-4000-a000-000000000003', 'issue3802x-growth@test.local'),
  ('partner',  '38021111-0000-4000-a000-000000000004', 'issue3802x-partner@test.local'),
  ('invited',  '38021111-0000-4000-a000-000000000005', 'issue3802x-invited@test.local'),
  ('revoked',  '38021111-0000-4000-a000-000000000006', 'issue3802x-revoked@test.local'),
  ('consumer', '38021111-0000-4000-a000-000000000007', 'issue3802x-consumer@test.local'),
  ('unconf',   '38021111-0000-4000-a000-000000000008', 'issue3802x-unconf@test.local');

insert into auth.users (id, email, email_confirmed_at)
select id, email, case when who = 'unconf' then null else now() end from x_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802x-owner@test.local', 'owner', 'active', now()),
  ('issue3802x-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('issue3802x-growth@test.local',  'growth',  'active',  now()),
  ('issue3802x-partner@test.local', 'partner', 'active',  now()),
  ('issue3802x-invited@test.local', 'growth',  'invited', null),
  ('issue3802x-revoked@test.local', 'partner', 'revoked', now()),
  ('issue3802x-unconf@test.local',  'growth',  'active',  now());

-- Brands with every kind of listing. "live" is what the rule should answer.
create temp table x_brands (k text primary key, id uuid not null, live boolean not null, has_event boolean not null) on commit drop;
insert into x_brands values
  ('pub_scheduled', '38021111-0000-4000-b000-000000000001', true,  true),
  ('pub_live',      '38021111-0000-4000-b000-000000000002', true,  true),
  ('pub_rsvp',      '38021111-0000-4000-b000-000000000003', true,  true),
  ('pub_trip',      '38021111-0000-4000-b000-000000000004', true,  true),
  ('pub_exp',       '38021111-0000-4000-b000-000000000005', true,  true),
  ('none',          '38021111-0000-4000-b000-000000000006', false, false),
  ('private',       '38021111-0000-4000-b000-000000000007', false, true),
  ('hidden',        '38021111-0000-4000-b000-000000000008', false, true),
  ('draft_vis',     '38021111-0000-4000-b000-000000000009', false, true),
  ('draft_status',  '38021111-0000-4000-b000-00000000000a', false, true),
  ('ended',         '38021111-0000-4000-b000-00000000000b', false, true),
  ('cancelled',     '38021111-0000-4000-b000-00000000000c', false, true),
  ('event_deleted', '38021111-0000-4000-b000-00000000000d', false, true),
  ('venue',         '38021111-0000-4000-b000-00000000000e', true,  false),
  ('venue_pending', '38021111-0000-4000-b000-00000000000f', false, false),
  ('venue_revoked', '38021111-0000-4000-b000-000000000010', false, false),
  ('brand_deleted', '38021111-0000-4000-b000-000000000011', false, true);

set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city)
select id, '38021111-0000-4000-b900-000000000001', 'Issue3802x Brand ' || k, 'issue3802x-' || replace(k, '_', '-'), 'Lagos'
from x_brands;
update public.brands set claim_status = 'verified'       where id = (select id from x_brands where k = 'venue');
update public.brands set claim_status = 'pending_review' where id = (select id from x_brands where k = 'venue_pending');
update public.brands set claim_status = 'revoked'        where id = (select id from x_brands where k = 'venue_revoked');
update public.brands set deleted_at = now()              where id = (select id from x_brands where k = 'brand_deleted');

insert into public.events (brand_id, title, slug, visibility, status, event_type, timezone, deleted_at)
select b.id, 'Issue3802x ' || b.k, 'issue3802x-ev-' || replace(b.k, '_', '-'), v.vis, v.st, v.typ, 'Africa/Lagos', v.del
from x_brands b
join (values
  ('pub_scheduled', 'public',  'scheduled', 'event',      null::timestamptz),
  ('pub_live',      'public',  'live',      'event',      null),
  ('pub_rsvp',      'public',  'scheduled', 'rsvp',       null),
  ('pub_trip',      'public',  'scheduled', 'trip',       null),
  ('pub_exp',       'public',  'scheduled', 'experience', null),
  ('private',       'private', 'scheduled', 'event',      null),
  ('hidden',        'hidden',  'scheduled', 'event',      null),
  ('draft_vis',     'draft',   'scheduled', 'event',      null),
  ('draft_status',  'public',  'draft',     'event',      null),
  ('ended',         'public',  'ended',     'event',      null),
  ('cancelled',     'public',  'cancelled', 'event',      null),
  ('event_deleted', 'public',  'scheduled', 'event',      now()),
  ('brand_deleted', 'public',  'scheduled', 'event',      null)
) as v(k, vis, st, typ, del) on v.k = b.k;

-- Search fixtures: a cap of ten, wildcard characters as plain text.
insert into public.brands (id, account_id, name, slug, city)
select ('38021111-0000-4000-b200-' || lpad(g::text, 12, '0'))::uuid, '38021111-0000-4000-b900-000000000001',
       'Issue3802x Cap ' || lpad(g::text, 2, '0'), 'issue3802x-cap-' || g, 'Lagos'
from generate_series(1, 13) g;
insert into public.brands (id, account_id, name, slug, city) values
  ('38021111-0000-4000-b300-000000000001', '38021111-0000-4000-b900-000000000001', 'Issue3802x 100% A_B',    'issue3802x-wild-1', 'Lagos'),
  ('38021111-0000-4000-b300-000000000002', '38021111-0000-4000-b900-000000000001', 'Issue3802x 100X AXB',    'issue3802x-wild-2', 'Lagos'),
  ('38021111-0000-4000-b300-000000000003', '38021111-0000-4000-b900-000000000001', E'Issue3802x Back\\Slash', 'issue3802x-wild-3', 'Lagos'),
  ('38021111-0000-4000-b300-000000000004', '38021111-0000-4000-b900-000000000001', 'Issue3802x BackXSlash',  'issue3802x-wild-4', 'Lagos');
insert into public.place_pool (id, name, lat, lng, city, is_active) values
  ('38021111-0000-4000-b400-000000000001', 'Issue3802x Open Place',   6.5, 3.4, 'Lagos', true),
  ('38021111-0000-4000-b400-000000000002', 'Issue3802x Closed Place', 6.5, 3.4, 'Lagos', false);
insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent)
values ('38021111-0000-4000-b500-000000000001', array['restaurant'], 'Issue3802x Lead', 'Lead Person', 'Lagos', 'issue3802x-lead@test.local', true);
set local session_replication_role = origin;

create temp table x_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table x_ids (k text primary key, v text) on commit drop;

-- Run one statement as a caller; return its single text result, or
-- 'ERR:<sqlstate>:<message>'. A raised statement leaves nothing behind.
create function pg_temp.x_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'service', 'cron', 'nosub', 'ghost', 'spoof', 'forged') then
    select id, email into strict v_id, v_email from x_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    elsif p_who = 'cron' then
      -- The scheduler's identity: the migration owner, no request claims.
      set local role postgres;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '', true);
    elsif p_who = 'nosub' then
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"authenticated","email":"issue3802x-owner@test.local"}', true);
    elsif p_who = 'ghost' then
      -- A session for an account that no longer exists.
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', '38021111-0000-4000-a000-0000000000ff', true);
      perform set_config('request.jwt.claims',
        '{"sub":"38021111-0000-4000-a000-0000000000ff","email":"issue3802x-owner@test.local","role":"authenticated"}', true);
    elsif p_who = 'forged' then
      -- A real team member (growth) whose claims name the owner's address.
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', '38021111-0000-4000-a000-000000000003', true);
      perform set_config('request.jwt.claim.email', 'issue3802x-owner@test.local', true);
      perform set_config('request.jwt.claims',
        '{"sub":"38021111-0000-4000-a000-000000000003","email":"issue3802x-owner@test.local","role":"authenticated","app_metadata":{"role":"owner"},"user_metadata":{"email":"issue3802x-owner@test.local"}}', true);
    elsif p_who = 'spoof' then
      -- An ordinary account whose claims carry the owner's address and role words.
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', '38021111-0000-4000-a000-000000000007', true);
      perform set_config('request.jwt.claim.email', 'issue3802x-owner@test.local', true);
      perform set_config('request.jwt.claims',
        '{"sub":"38021111-0000-4000-a000-000000000007","email":"issue3802x-owner@test.local","role":"authenticated","user_role":"owner","app_metadata":{"role":"owner","team_role":"owner"},"user_metadata":{"role":"owner","email":"issue3802x-owner@test.local"}}', true);
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

create function pg_temp.x_ok(p_test text, p_label text, p_ok boolean, p_detail text default null) returns void
language plpgsql as $fn$
begin
  insert into x_results (test, label, ok, detail) values (p_test, p_label, coalesce(p_ok, false), left(coalesce(p_detail, ''), 300));
end;
$fn$;

create function pg_temp.x_eq(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  perform pg_temp.x_ok(p_test, p_label, p_got is not distinct from p_want,
                       'got ' || coalesce(p_got, '<null>') || ' want ' || coalesce(p_want, '<null>'));
end;
$fn$;

create function pg_temp.x_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  perform pg_temp.x_ok(p_test, p_label, coalesce(p_got like p_pattern, false),
                       'got ' || coalesce(p_got, '<null>') || ' want like ' || p_pattern);
end;
$fn$;

create function pg_temp.x_id(p_k text) returns text language sql as $fn$ select v from x_ids where k = p_k $fn$;
create function pg_temp.x_keep(p_k text, p_v text) returns void language sql as $fn$
  insert into x_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;
create function pg_temp.x_brand(p_k text) returns text language sql as $fn$ select id::text from x_brands where k = p_k $fn$;

-- Everything in the four tables, as one fingerprint.
create function pg_temp.x_snap() returns text language sql as $fn$
  select md5(
    coalesce((select string_agg(r::text, '|' order by r.id) from public.crm_records r), '') || '#' ||
    coalesce((select string_agg(o::text, '|' order by o.record_id, o.owner_email) from public.crm_record_owners o), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from public.crm_activity a), '') || '#' ||
    coalesce((select string_agg(k::text, '|' order by k.actor_email, k.request_key) from public.crm_request_keys k), ''))
$fn$;
create function pg_temp.x_audit() returns int language sql as $fn$
  select count(*)::int from public.admin_audit_log where action like 'crm.%' $fn$;

-- A record put straight into a stage (the suite's own fixture path).
create function pg_temp.x_seed(p_k text, p_pipeline text, p_name text, p_stage text,
                               p_brand uuid default null, p_agreement text default null) returns uuid
language plpgsql as $fn$
declare
  v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, stage_reason, brand_id, agreement, created_by, updated_by)
  values (p_pipeline, p_name, p_stage, case when p_stage in ('lost', 'passed') then 'seeded reason' end,
          p_brand, p_agreement, 'issue3802x-seed@test.local', 'issue3802x-seed@test.local')
  returning id into v_id;
  perform pg_temp.x_keep(p_k, v_id::text);
  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- XA-10a — the scheduled run before any record exists. (First on purpose.)
-- ---------------------------------------------------------------------------
do $t$
declare
  v_a int := pg_temp.x_audit();
  v_s text := pg_temp.x_snap();
begin
  perform pg_temp.x_eq('XA-10', 'no records at the start of this suite',
    (select count(*)::text from public.crm_records), '0');
  perform pg_temp.x_eq('XA-10', 'scheduled run with zero records answers 0',
    pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), '0');
  perform pg_temp.x_eq('XA-10', 'scheduled run with zero records, again',
    pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), '0');
  perform pg_temp.x_eq('XA-10', 'zero-record run writes no audit row', pg_temp.x_audit()::text, v_a::text);
  perform pg_temp.x_eq('XA-10', 'zero-record run changes no table', pg_temp.x_snap(), v_s);

  -- The run also clears request keys older than 30 days, and only those.
  insert into public.crm_request_keys (actor_email, request_key, fn, response, created_at) values
    ('issue3802x-growth@test.local', 'xold-key-31d', 'crm_record_create', '{}'::jsonb, now() - interval '31 days'),
    ('issue3802x-growth@test.local', 'xold-key-29d', 'crm_record_create', '{}'::jsonb, now() - interval '29 days');
  perform pg_temp.x_as('cron', $$select public.crm_reconcile_live('38021111-0000-4000-ffff-000000000001')::text$$);
  perform pg_temp.x_eq('XA-10', 'a single-record run clears no request key',
    (select count(*)::text from public.crm_request_keys where request_key like 'xold-key-%'), '2');
  perform pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text');
  perform pg_temp.x_eq('XA-10', 'the full run clears only keys past 30 days',
    (select string_agg(request_key, ',') from public.crm_request_keys where request_key like 'xold-key-%'), 'xold-key-29d');
  delete from public.crm_request_keys where request_key like 'xold-key-%';
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-1 — catalog.
-- ---------------------------------------------------------------------------
-- [TEST-MOD-APPROVED #3802] 2026-10-15: Wave 6 deliberately adds one
-- closed provenance reader and two closed import-evidence tables. The catalog
-- pins below expand by exactly those three objects; all prior grants, policies,
-- and browser-denial assertions remain unchanged.
do $t$
declare
  c_client constant text[] := array['crm_config','crm_records_list','crm_record_get','crm_duplicate_check',
    'crm_link_search','crm_record_create','crm_records_bulk_create','crm_record_update','crm_record_move_stage',
    'crm_record_undo_stage_move','crm_record_set_owners','crm_record_log','crm_record_delete','crm_record_restore',
    'crm_home_summary','crm_team_summary','crm_target_set','crm_beta_leads_list','crm_beta_lead_to_host',
    'crm_contact_check'];
  r record;
  v_n int;
begin
  -- Every grantee of every new function, whoever it is.
  for r in
    select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl,
           coalesce((select array_agg(distinct coalesce(g.rolname, 'PUBLIC') order by coalesce(g.rolname, 'PUBLIC'))
                       from aclexplode(p.proacl) a left join pg_roles g on g.oid = a.grantee
                      where a.grantee <> p.proowner), '{}') as others
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'crm\_%' or p.proname = 'admin_team_directory')
  loop
    perform pg_temp.x_ok('XA-1', r.proname || ': has an explicit privilege list', r.proacl is not null);
    perform pg_temp.x_eq('XA-1', r.proname || ': grantees besides the owner', array_to_string(r.others, ','),
      case when r.proname = any (c_client) then 'authenticated,service_role' else 'service_role' end);
    perform pg_temp.x_ok('XA-1', r.proname || ': search path is pinned empty',
      coalesce(r.proconfig, '{}') @> array['search_path=""'], coalesce(r.proconfig::text, 'none'));
    perform pg_temp.x_ok('XA-1', r.proname || ': anon cannot execute', not has_function_privilege('anon', r.oid, 'EXECUTE'));
    perform pg_temp.x_ok('XA-1', r.proname || ': authenticator cannot execute', not has_function_privilege('authenticator', r.oid, 'EXECUTE'));
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'crm\_%';
  perform pg_temp.x_eq('XA-1', 'number of crm_ functions', v_n::text, '52');
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (c_client) and p.prosecdef;
  perform pg_temp.x_eq('XA-1', 'client functions that run with owner rights', v_n::text, '20');

  -- Every other function with owner rights in this migration is pinned too.
  perform pg_temp.x_ok('XA-1', 'admin_beta_leads_list keeps a pinned search path',
    (select coalesce(proconfig, '{}') @> array['search_path=public'] from pg_proc where oid = 'public.admin_beta_leads_list()'::regprocedure));

  for r in
    select c.oid, c.relname, c.relrowsecurity, c.relacl,
           coalesce((select array_agg(distinct coalesce(g.rolname, 'PUBLIC') order by coalesce(g.rolname, 'PUBLIC'))
                       from aclexplode(c.relacl) a left join pg_roles g on g.oid = a.grantee
                      where a.grantee <> c.relowner), '{}') as others
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'crm\_%'
  loop
    perform pg_temp.x_eq('XA-1', r.relname || ': grantees besides the owner', array_to_string(r.others, ','), 'service_role');
    perform pg_temp.x_ok('XA-1', r.relname || ': row security on', r.relrowsecurity);
    perform pg_temp.x_eq('XA-1', r.relname || ': policies', (select count(*)::text from pg_policy where polrelid = r.oid), '0');
    perform pg_temp.x_eq('XA-1', r.relname || ': column-level grants',
      (select count(*)::text from pg_attribute a where a.attrelid = r.oid and a.attacl is not null), '0');
    perform pg_temp.x_eq('XA-1', r.relname || ': triggers', (select count(*)::text from pg_trigger where tgrelid = r.oid and not tgisinternal), '0');
    perform pg_temp.x_ok('XA-1', r.relname || ': no client role holds anything',
      not exists (select 1 from unnest(array['anon','authenticated','authenticator']) ro,
                    unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pv
                  where has_table_privilege(ro, r.oid, pv)));
  end loop;
  perform pg_temp.x_eq('XA-1', 'number of crm_ tables',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'crm\_%'), '8');
  perform pg_temp.x_eq('XA-1', 'no view, sequence or materialised view named crm_',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v','m','S') and c.relname like 'crm\_%'), '0');
  perform pg_temp.x_eq('XA-1', 'no policy anywhere mentions a crm_ name',
    (select count(*)::text from pg_policy
      where coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '') ~ 'crm_'), '0');

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform pg_temp.x_eq('XA-1', 'one schedule entry, exact command and timing',
      (select string_agg(j.schedule || '|' || j.command || '|' || j.active::text, ';') from cron.job j where j.jobname = 'crm_reconcile_live'),
      '*/10 * * * *|SELECT public.crm_reconcile_live()|true');
    perform pg_temp.x_eq('XA-1', 'no other schedule entry calls a crm_ function',
      (select count(*)::text from cron.job j where j.command ~* 'crm_' and j.jobname <> 'crm_reconcile_live'), '0');
    perform pg_temp.x_ok('XA-1', 'the schedule owner can run the job',
      (select has_function_privilege(j.username, 'public.crm_reconcile_live(uuid)', 'EXECUTE') from cron.job j where j.jobname = 'crm_reconcile_live'));
  end if;
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-2 — callers the first suite does not use.
-- ---------------------------------------------------------------------------
create temp table x_calls (fn text primary key, sql text not null) on commit drop;
do $t$
declare
  v_rid text;
  v_aid text;
begin
  v_rid := pg_temp.x_seed('gate', 'hosts', 'Issue3802x Gate Card', 'prospect')::text;
  perform pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'contacted')::text$$, v_rid));
  select id::text into v_aid from public.crm_activity where record_id = v_rid::uuid and kind = 'stage_move';
  perform pg_temp.x_keep('gate_act', v_aid);
  insert into x_calls values
    ('crm_config',                 $$select public.crm_config()::text$$),
    ('crm_records_list',           $$select public.crm_records_list('hosts')::text$$),
    ('crm_record_get',             format($$select public.crm_record_get(%L)::text$$, v_rid)),
    ('crm_duplicate_check',        $$select public.crm_duplicate_check('hosts', 'Issue3802x Gate Card')::text$$),
    ('crm_link_search',            $$select public.crm_link_search('brand', 'Issue3802x')::text$$),
    ('crm_record_create',          $$select public.crm_record_create('hosts', '{"name":"Issue3802x Refused"}', 'xrefuse-0001')::text$$),
    ('crm_records_bulk_create',    $$select public.crm_records_bulk_create('hosts', '[{"name":"Issue3802x Refused B"}]', 'xrefuse-0002')::text$$),
    ('crm_record_update',          format($$select public.crm_record_update(%L, '{"contact":"x"}')::text$$, v_rid)),
    ('crm_record_move_stage',      format($$select public.crm_record_move_stage(%L, 'replied')::text$$, v_rid)),
    ('crm_record_undo_stage_move', format($$select public.crm_record_undo_stage_move(%L)::text$$, v_aid)),
    ('crm_record_set_owners',      format($$select public.crm_record_set_owners(%L, array['issue3802x-owner@test.local'])::text$$, v_rid)),
    ('crm_record_log',             format($$select public.crm_record_log(%L, '{"kind":"note","body":"x"}', 'xrefuse-0003')::text$$, v_rid)),
    ('crm_record_delete',          format($$select public.crm_record_delete(%L)::text$$, v_rid)),
    ('crm_record_restore',         format($$select public.crm_record_restore(%L)::text$$, v_rid));
end;
$t$;

do $t$
declare
  c record;
  v_who text;
  v_snap text := pg_temp.x_snap();
  v_audit int := pg_temp.x_audit();
  v_got text;
begin
  foreach v_who in array array['consumer','invited','revoked','unconf','spoof','ghost','nosub','service'] loop
    for c in select * from x_calls order by fn loop
      v_got := pg_temp.x_as(v_who, c.sql);
      perform pg_temp.x_like('XA-2', v_who || ' is refused by ' || c.fn, v_got, 'ERR:42501:forbidden%');
    end loop;
  end loop;
  for c in select * from x_calls order by fn loop
    perform pg_temp.x_like('XA-2', 'anon has no way to call ' || c.fn, pg_temp.x_as('anon', c.sql), 'ERR:42501:permission denied for function%');
  end loop;

  -- Access taken away in the middle of a transaction applies to the next call.
  perform pg_temp.x_like('XA-2', 'growth is let in before the change',
    pg_temp.x_as('growth', $$select public.crm_config()->'me'->>'role'$$), 'growth');
  update public.admin_team_members set status = 'revoked' where email = 'issue3802x-growth@test.local';
  for c in select * from x_calls order by fn loop
    perform pg_temp.x_like('XA-2', 'growth, revoked a moment ago, is refused by ' || c.fn, pg_temp.x_as('growth', c.sql), 'ERR:42501:forbidden%');
  end loop;
  update public.admin_team_members set status = 'active' where email = 'issue3802x-growth@test.local';

  update public.admin_users set status = 'revoked' where email = 'issue3802x-admin@test.local';
  for c in select * from x_calls order by fn loop
    perform pg_temp.x_like('XA-2', 'admin, revoked a moment ago, is refused by ' || c.fn, pg_temp.x_as('admin', c.sql), 'ERR:42501:forbidden%');
  end loop;
  update public.admin_users set status = 'active' where email = 'issue3802x-admin@test.local';

  -- A confirmed mailbox is part of the gate for the two new roles.
  update auth.users set email_confirmed_at = null where email = 'issue3802x-partner@test.local';
  perform pg_temp.x_like('XA-2', 'partner with an unconfirmed mailbox is refused',
    pg_temp.x_as('partner', $$select public.crm_records_list('hosts')::text$$), 'ERR:42501:forbidden%');
  update auth.users set email_confirmed_at = now() where email = 'issue3802x-partner@test.local';

  perform pg_temp.x_eq('XA-2', 'no refused call changed any table', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-2', 'no refused call wrote an audit row', pg_temp.x_audit()::text, v_audit::text);

  -- The four roles are still let in afterwards (the refusals are not a blanket).
  foreach v_who in array array['owner','admin','growth','partner'] loop
    perform pg_temp.x_eq('XA-2', v_who || ' is let in and named correctly',
      pg_temp.x_as(v_who, $$select public.crm_config()->'me'->>'role'$$), v_who);
    perform pg_temp.x_eq('XA-2', v_who || ' can read the pipeline',
      pg_temp.x_as(v_who, $$select public.crm_records_list('hosts')->>'pipeline'$$), 'hosts');
  end loop;
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-3 — every internal helper refuses every client role.
-- ---------------------------------------------------------------------------
do $t$
declare
  c_internal constant text[] := array[
    $$select public.admin_team_directory()::text$$,
    $$select public.crm_ctx()::text$$,
    $$select public.crm_name_key('x')$$,
    $$select public.crm_display_name('x@y.z')$$,
    $$select public.crm_pipeline_def('hosts')::text$$,
    $$select public.crm_vocab()::text$$,
    $$select public.crm_stage_def('hosts', 'live')::text$$,
    $$select public.crm_brand_is_live(null)::text$$,
    $$select public.crm_clean_owners('[]')::text$$,
    $$select public.crm_validate_fields('hosts', '{"name":"x"}', 'create')::text$$,
    $$select public.crm_record_json(null::public.crm_records)::text$$,
    $$select public.crm_record_lite_json(null::public.crm_records)::text$$,
    $$select public.crm_activity_json(null::public.crm_activity)::text$$,
    $$select public.crm_audit('issue3802x-owner@test.local', 'crm.forged', 'crm_record', 'x', '{}')::text$$,
    $$select public.crm_request_begin('issue3802x-owner@test.local', 'xinternal-01', 'crm_record_create')::text$$,
    $$select public.crm_request_finish('issue3802x-owner@test.local', 'xinternal-02', 'crm_record_create', '{}')::text$$,
    $$select public.crm_undoable_activity(null, 'issue3802x-owner@test.local')::text$$,
    $$select public.crm_reconcile_live()::text$$,
    $$select public.crm_reconcile_live(null)::text$$,
    $$select public.crm_apply_brand_link(null)::text$$,
    $$select public.crm_record_create_core('hosts', '{"name":"Issue3802x Forged"}', 'issue3802x-owner@test.local', 'agent')::text$$];
  v_sql text;
  v_who text;
  v_snap text := pg_temp.x_snap();
  v_audit int := pg_temp.x_audit();
begin
  foreach v_who in array array['owner','admin','growth','partner','consumer','anon'] loop
    foreach v_sql in array c_internal loop
      perform pg_temp.x_like('XA-3', v_who || ' cannot run ' || substring(v_sql from 'public\.([a-z_]+)'),
        pg_temp.x_as(v_who, v_sql), 'ERR:42501:permission denied for function%');
    end loop;
  end loop;
  perform pg_temp.x_eq('XA-3', 'no table changed', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-3', 'no audit row written', pg_temp.x_audit()::text, v_audit::text);
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-4 — direct statements end in "permission denied", never in "zero rows".
-- ---------------------------------------------------------------------------
do $t$
declare
  c_tables constant text[] := array['crm_records','crm_record_owners','crm_activity','crm_request_keys'];
  c_cols   constant text[] := array['name','owner_email','body','fn'];
  c_stmts  constant text[] := array[
    'select count(*)::text from public.%1$I',
    'select 1::text from public.%1$I limit 1',
    'select %2$I::text from public.%1$I limit 1',
    'select 1::text from public.%1$I limit 1 for update',
    'select 1::text from public.%1$I limit 1 for share',
    'with x as (select * from public.%1$I) select count(*)::text from x',
    'select count(*)::text from (table public.%1$I) t',
    'insert into public.%1$I default values returning ''x''',
    'update public.%1$I set %2$I = %2$I returning ''x''',
    'update public.%1$I set %2$I = ''x'' where false returning ''x''',
    'delete from public.%1$I returning ''x''',
    'delete from public.%1$I where false returning ''x''',
    'merge into public.%1$I t using (select 1) s on false when not matched then insert default values',
    'truncate public.%1$I cascade',
    'lock table public.%1$I in access share mode',
    'alter table public.%1$I disable row level security',
    'alter table public.%1$I add column x3802 text',
    'create policy x3802 on public.%1$I for all using (true) with check (true)',
    'create index on public.%1$I (%2$I)',
    'create trigger x3802 after insert on public.%1$I for each statement execute function pg_catalog.suppress_redundant_updates_trigger()',
    'comment on table public.%1$I is ''x''',
    'drop table public.%1$I cascade'];
  v_who text;
  v_stmt text;
  v_got text;
  v_snap text := pg_temp.x_snap();
  i int;
begin
  foreach v_who in array array['anon','consumer','growth','partner','admin','owner'] loop
    for i in 1 .. 4 loop
      foreach v_stmt in array c_stmts loop
        v_got := pg_temp.x_as(v_who, format(v_stmt, c_tables[i], c_cols[i]));
        perform pg_temp.x_like('XA-4', v_who || ' on ' || c_tables[i] || ': ' || left(v_stmt, 40), v_got, 'ERR:42501:%');
      end loop;
    end loop;
  end loop;
  perform pg_temp.x_eq('XA-4', 'all four tables are exactly as before', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-4', 'all four tables still exist with row security',
    (select count(*)::text from pg_class c where c.oid in ('public.crm_records'::regclass, 'public.crm_record_owners'::regclass,
       'public.crm_activity'::regclass, 'public.crm_request_keys'::regclass) and c.relrowsecurity), '4');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-5 — nobody can name the actor, the agent, the stage or a bookkeeping
-- column through any request.
-- ---------------------------------------------------------------------------
do $t$
declare
  c_keys constant text[] := array['via','actor','actor_email','created_by','updated_by','deleted_at','deleted_by','stage',
    'stage_reason','went_live_at','id','name_key','pipeline','place_id','beta_lead_id','created_at','updated_at','admin_email'];
  v_key text;
  v_rid text := pg_temp.x_id('gate');
  v_snap text;
  v_audit int;
  v_got text;
begin
  v_snap := pg_temp.x_snap();
  v_audit := pg_temp.x_audit();
  foreach v_key in array c_keys loop
    perform pg_temp.x_like('XA-5', 'create refuses the field ' || v_key,
      pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, 'xforge-0001')::text$$,
        jsonb_build_object('name', 'Issue3802x Forge', v_key, 'live')::text)), 'ERR:22023:unknown_field:%');
    perform pg_temp.x_like('XA-5', 'update refuses the field ' || v_key,
      pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_rid,
        jsonb_build_object(v_key, 'live')::text)), 'ERR:22023:unknown_field:%');
  end loop;
  foreach v_key in array array['via','actor','actor_email','id','record_id','created_at','from_stage','to_stage','stage'] loop
    perform pg_temp.x_like('XA-5', 'a log entry refuses the field ' || v_key,
      pg_temp.x_as('growth', format($$select public.crm_record_log(%L, %L, 'xforge-0002')::text$$, v_rid,
        jsonb_build_object('kind', 'note', 'body', 'x', v_key, 'agent')::text)), 'ERR:22023:unknown_field:%');
  end loop;
  perform pg_temp.x_eq('XA-5', 'no refused field changed any table', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-5', 'no refused field wrote an audit row', pg_temp.x_audit()::text, v_audit::text);

  -- A bulk item with a forbidden field is reported, never applied.
  v_got := pg_temp.x_as('growth', $$select public.crm_records_bulk_create('hosts',
    '[{"name":"Issue3802x Forge B1","stage":"live"},{"name":"Issue3802x Forge B2","via":"agent"},{"name":"Issue3802x Forge B3","created_by":"issue3802x-owner@test.local"}]',
    'xforge-0003')::text$$);
  perform pg_temp.x_eq('XA-5', 'bulk: forbidden-field items counted invalid',
    jsonb_array_length(v_got::jsonb->'invalid')::text || '/' || jsonb_array_length(v_got::jsonb->'created')::text, '3/0');
  perform pg_temp.x_eq('XA-5', 'bulk: none of them exists',
    (select count(*)::text from public.crm_records where name like 'Issue3802x Forge%'), '0');

  -- After everything this suite's people did so far: a person is never "via".
  perform pg_temp.x_eq('XA-5', 'no log line written by a person carries via',
    (select count(*)::text from public.crm_activity where actor_email is not null and via is not null), '0');
  perform pg_temp.x_eq('XA-5', 'no audit row carries via',
    (select count(*)::text from public.admin_audit_log where action like 'crm.%' and metadata ? 'via'), '0');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-6 — delete and restore are for owner and admin, whatever is sent.
-- ---------------------------------------------------------------------------
do $t$
declare
  v_live text := pg_temp.x_seed('del_live', 'hosts', 'Issue3802x Delete Target', 'prospect')::text;
  v_gone text := pg_temp.x_seed('del_gone', 'hosts', 'Issue3802x Already Gone', 'prospect')::text;
  v_mine text;
  v_who text;
  v_arg text;
  v_snap text;
  v_audit int;
begin
  update public.crm_records set deleted_at = now(), deleted_by = 'issue3802x-owner@test.local' where id = v_gone::uuid;
  -- A card the person added and owns is no more deletable than any other.
  v_mine := pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Growth Own Card"}', 'xdelete-0001')->'record'->>'id'$$);
  v_snap := pg_temp.x_snap();
  v_audit := pg_temp.x_audit();
  foreach v_who in array array['growth','partner','consumer','invited','revoked','spoof'] loop
    foreach v_arg in array array[quote_literal(v_live), quote_literal(v_gone), quote_literal(v_mine),
                                 'null', quote_literal('38021111-0000-4000-ffff-0000000000aa')] loop
      perform pg_temp.x_like('XA-6', v_who || ' delete(' || left(v_arg, 14) || ')',
        pg_temp.x_as(v_who, format('select public.crm_record_delete(%s)::text', v_arg)), 'ERR:42501:forbidden%');
      perform pg_temp.x_like('XA-6', v_who || ' restore(' || left(v_arg, 14) || ')',
        pg_temp.x_as(v_who, format('select public.crm_record_restore(%s)::text', v_arg)), 'ERR:42501:forbidden%');
    end loop;
  end loop;
  perform pg_temp.x_eq('XA-6', 'no refused delete or restore changed any table', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-6', 'no refused delete or restore wrote an audit row', pg_temp.x_audit()::text, v_audit::text);

  -- No other function makes a card disappear or come back for them.
  perform pg_temp.x_like('XA-6', 'growth cannot blank a name',
    pg_temp.x_as('growth', format($$select public.crm_record_update(%L, '{"name":""}')::text$$, v_live)), 'ERR:22023:invalid_name:%');
  perform pg_temp.x_like('XA-6', 'growth cannot reach a deleted card by update',
    pg_temp.x_as('growth', format($$select public.crm_record_update(%L, '{"contact":"x"}')::text$$, v_gone)), 'ERR:P0002:not_found%');
  perform pg_temp.x_like('XA-6', 'growth cannot reach a deleted card by move',
    pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'contacted')::text$$, v_gone)), 'ERR:P0002:not_found%');
  perform pg_temp.x_like('XA-6', 'growth cannot reach a deleted card by owners',
    pg_temp.x_as('growth', format($$select public.crm_record_set_owners(%L, array[]::text[])::text$$, v_gone)), 'ERR:P0002:not_found%');
  perform pg_temp.x_like('XA-6', 'growth cannot reach a deleted card by log',
    pg_temp.x_as('growth', format($$select public.crm_record_log(%L, '{"kind":"note","body":"x"}', 'xdelete-0002')::text$$, v_gone)), 'ERR:P0002:not_found%');
  perform pg_temp.x_like('XA-6', 'growth cannot open a deleted card',
    pg_temp.x_as('growth', format($$select public.crm_record_get(%L)::text$$, v_gone)), 'ERR:P0002:not_found%');
  perform pg_temp.x_eq('XA-6', 'a deleted card is in no list',
    pg_temp.x_as('partner', format($$select (public.crm_records_list('hosts')->'records' @> '[{"id":"%s"}]')::text$$, v_gone)), 'false');
  perform pg_temp.x_eq('XA-6', 'the config tells growth it cannot delete',
    pg_temp.x_as('growth', $$select public.crm_config()->'me'->>'can_delete'$$), 'false');
  perform pg_temp.x_eq('XA-6', 'the config tells partner it cannot delete',
    pg_temp.x_as('partner', $$select public.crm_config()->'me'->>'can_delete'$$), 'false');

  -- Owner and admin can; each is recorded under their own name.
  perform pg_temp.x_eq('XA-6', 'admin deletes', pg_temp.x_as('admin', format($$select public.crm_record_delete(%L)->>'changed'$$, v_live)), 'true');
  perform pg_temp.x_eq('XA-6', 'owner restores', pg_temp.x_as('owner', format($$select public.crm_record_restore(%L)->>'changed'$$, v_live)), 'true');
  perform pg_temp.x_eq('XA-6', 'delete and restore are recorded under the real people',
    (select string_agg(action || '=' || admin_email, ',' order by action) from public.admin_audit_log
      where target_id = v_live and action in ('crm.record_delete', 'crm.record_restore')),
    'crm.record_delete=issue3802x-admin@test.local,crm.record_restore=issue3802x-owner@test.local');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-7 — one name, one record.
-- ---------------------------------------------------------------------------
do $t$
declare
  c_variants constant text[] := array['palm court kitchen', 'PALM-COURT KITCHEN', '@PalmCourtKitchen', '  Palm   Court    Kitchen  ',
    'palm.court.kitchen!', E'Palm\tCourt\nKitchen', 'P a l m C o u r t K i t c h e n', '(Palm) [Court] {Kitchen}', 'palm_court_kitchen', 'Palm/Court\Kitchen'];
  v_first text;
  v_other text;
  v_name text;
  v_got jsonb;
  v_snap text;
  v_audit int;
  v_items jsonb;
  i int;
begin
  v_first := pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Palm Court Kitchen"}', 'xdup-00000')->'record'->>'id'$$);
  v_snap := pg_temp.x_snap();
  v_audit := pg_temp.x_audit();
  i := 0;
  foreach v_name in array c_variants loop
    i := i + 1;
    v_got := pg_temp.x_as(case when i % 2 = 0 then 'partner' else 'admin' end,
      format($$select public.crm_record_create('hosts', %L, %L)::text$$,
             jsonb_build_object('name', 'issue3802X ' || v_name)::text, 'xdup-1' || lpad(i::text, 4, '0')))::jsonb;
    perform pg_temp.x_eq('XA-7', 'variant ' || i || ' is the same record',
      (v_got->>'status') || ':' || (v_got->'existing'->>'id'), 'duplicate:' || v_first);
  end loop;
  perform pg_temp.x_eq('XA-7', 'no variant wrote anything', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-7', 'no variant wrote an audit row', pg_temp.x_audit()::text, v_audit::text);
  perform pg_temp.x_eq('XA-7', 'accented capitals and small letters share one key',
    (public.crm_name_key('Café ÉCOLE') = public.crm_name_key('café  école'))::text, 'true');

  -- The other pipeline is a different list.
  perform pg_temp.x_eq('XA-7', 'the same name is free in the other pipeline',
    pg_temp.x_as('growth', $$select public.crm_record_create('creators', '{"name":"Issue3802x Palm Court Kitchen"}', 'xdup-20001')->>'status'$$), 'created');

  -- Rename: into a taken name is refused; a new spelling of its own name is fine.
  v_other := pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Second Kitchen"}', 'xdup-20002')->'record'->>'id'$$);
  v_snap := pg_temp.x_snap();
  perform pg_temp.x_like('XA-7', 'rename into a taken name is refused',
    pg_temp.x_as('partner', format($$select public.crm_record_update(%L, '{"name":"ISSUE3802X-PALM-COURT-KITCHEN"}')::text$$, v_other)),
    'ERR:22023:duplicate_name:%');
  perform pg_temp.x_eq('XA-7', 'the refused rename wrote nothing', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-7', 'a new spelling of its own name is allowed',
    pg_temp.x_as('partner', format($$select public.crm_record_update(%L, '{"name":"Issue3802x SECOND-Kitchen"}')->'record'->>'name'$$, v_other)),
    'Issue3802x SECOND-Kitchen');

  -- A deleted card frees its name; restoring into a taken name is refused.
  perform pg_temp.x_as('admin', format($$select public.crm_record_delete(%L)::text$$, v_other));
  perform pg_temp.x_eq('XA-7', 'a deleted card frees its name',
    pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"issue3802x second kitchen"}', 'xdup-20003')->>'status'$$), 'created');
  perform pg_temp.x_like('XA-7', 'restore into a taken name is refused',
    pg_temp.x_as('admin', format($$select public.crm_record_restore(%L)::text$$, v_other)), 'ERR:22023:duplicate_name:%');
  perform pg_temp.x_eq('XA-7', 'one live record per key after all of that',
    (select coalesce(max(n), 0)::text from (select count(*) n from public.crm_records where deleted_at is null group by pipeline, name_key) s), '1');

  -- Bulk at the limit: 50 items = 44 new, 2 already there, 2 repeats inside
  -- the request, 2 that are not records at all.
  select jsonb_agg(x.item order by x.ord) into v_items from (
    select g as ord, jsonb_build_object('name', 'Issue3802x Bulk ' || lpad(g::text, 2, '0')) as item from generate_series(1, 44) g
    union all select 45, '{"name":"ISSUE3802X PALM COURT KITCHEN"}'::jsonb
    union all select 46, '{"name":"issue3802x-second-kitchen"}'::jsonb
    union all select 47, '{"name":"issue3802x bulk 01"}'::jsonb
    union all select 48, '{"name":"@Issue3802xBulk02"}'::jsonb
    union all select 49, '42'::jsonb
    union all select 50, '{"name":"Issue3802x Bulk Bad","icp":"not_an_icp"}'::jsonb) x;
  v_audit := pg_temp.x_audit();
  v_got := pg_temp.x_as('partner', format($$select public.crm_records_bulk_create('hosts', %L, 'xbulk-00001')::text$$, v_items::text))::jsonb;
  perform pg_temp.x_eq('XA-7', 'bulk of 50: created/skipped/invalid',
    jsonb_array_length(v_got->'created') || '/' || jsonb_array_length(v_got->'skipped') || '/' || jsonb_array_length(v_got->'invalid'), '44/4/2');
  perform pg_temp.x_eq('XA-7', 'bulk of 50: every item is accounted for exactly once',
    (select string_agg(idx::text, ',' order by idx) from (
       select (e->>'index')::int idx from jsonb_array_elements(v_got->'created') e
       union all select (e->>'index')::int from jsonb_array_elements(v_got->'skipped') e
       union all select (e->>'index')::int from jsonb_array_elements(v_got->'invalid') e) s),
    (select string_agg(g::text, ',' order by g) from generate_series(0, 49) g));
  perform pg_temp.x_eq('XA-7', 'bulk of 50: rows really added',
    (select count(*)::text from public.crm_records where name like 'Issue3802x Bulk %' and deleted_at is null), '44');
  perform pg_temp.x_eq('XA-7', 'bulk of 50: one summary audit row plus one per record', (pg_temp.x_audit() - v_audit)::text, '45');
  perform pg_temp.x_eq('XA-7', 'bulk of 50: every added card is owned by the person who sent it',
    (select count(*)::text from public.crm_records r where r.name like 'Issue3802x Bulk %'
       and r.created_by = 'issue3802x-partner@test.local'
       and exists (select 1 from public.crm_record_owners o where o.record_id = r.id and o.owner_email = 'issue3802x-partner@test.local')), '44');

  -- Over the limit: refused whole, and the request key is still usable.
  select jsonb_agg(jsonb_build_object('name', 'Issue3802x Over ' || g)) into v_items from generate_series(1, 51) g;
  v_snap := pg_temp.x_snap();
  perform pg_temp.x_like('XA-7', '51 items are refused',
    pg_temp.x_as('partner', format($$select public.crm_records_bulk_create('hosts', %L, 'xbulk-00002')::text$$, v_items::text)), 'ERR:22023:too_many:%');
  perform pg_temp.x_eq('XA-7', '51 items wrote nothing', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_like('XA-7', 'an empty list is refused',
    pg_temp.x_as('partner', $$select public.crm_records_bulk_create('hosts', '[]', 'xbulk-00003')::text$$), 'ERR:22023:invalid_items:%');
  perform pg_temp.x_like('XA-7', 'a list that is not a list is refused',
    pg_temp.x_as('partner', $$select public.crm_records_bulk_create('hosts', '{"name":"x"}', 'xbulk-00003')::text$$), 'ERR:22023:invalid_items:%');
  perform pg_temp.x_like('XA-7', 'an unknown pipeline is refused',
    pg_temp.x_as('partner', $$select public.crm_records_bulk_create('hosts'' or ''1''=''1', '[{"name":"x"}]', 'xbulk-00003')::text$$), 'ERR:22023:invalid_pipeline:%');
  perform pg_temp.x_eq('XA-7', 'the refused key was not used up',
    pg_temp.x_as('partner', $$select jsonb_array_length(public.crm_records_bulk_create('hosts', '[{"name":"Issue3802x After Refusal"}]', 'xbulk-00002')->'created')::text$$), '1');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-8 — request keys.
-- ---------------------------------------------------------------------------
do $t$
declare
  v_g jsonb;
  v_p jsonb;
  v_r jsonb;
  v_a text;
  v_b text;
  v_snap text;
  v_audit int;
  v_key text;
begin
  v_g := pg_temp.x_as('growth',  $$select public.crm_record_create('hosts', '{"name":"Issue3802x Key One"}', 'xshared-key-01')::text$$)::jsonb;
  -- A second person sending the same key is a new request, not a replay.
  v_p := pg_temp.x_as('partner', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Key Two"}', 'xshared-key-01')::text$$)::jsonb;
  perform pg_temp.x_eq('XA-8', 'first person: created', v_g->>'status', 'created');
  perform pg_temp.x_eq('XA-8', 'second person, same key: their own new record',
    (v_p->>'status') || ':' || (v_p ? 'replayed')::text || ':' || ((v_p->'record'->>'id') <> (v_g->'record'->>'id'))::text || ':' || (v_p->'record'->>'name'),
    'created:false:true:Issue3802x Key Two');

  -- The same person, same key, different words: the first answer, nothing new.
  v_snap := pg_temp.x_snap();
  v_audit := pg_temp.x_audit();
  v_r := pg_temp.x_as('growth', $$select public.crm_record_create('creators', '{"name":"Issue3802x Key Three"}', 'xshared-key-01')::text$$)::jsonb;
  perform pg_temp.x_eq('XA-8', 'replay with different words returns the first answer',
    (v_r->>'replayed') || ':' || (v_r->'record'->>'id') || ':' || (v_r->'record'->>'name'),
    'true:' || (v_g->'record'->>'id') || ':Issue3802x Key One');
  perform pg_temp.x_eq('XA-8', 'the replay answer equals the first answer',
    (v_r - 'replayed')::text, v_g::text);
  perform pg_temp.x_eq('XA-8', 'replay wrote nothing', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-8', 'replay wrote no audit row', pg_temp.x_audit()::text, v_audit::text);

  -- The same key against a different function is refused, and writes nothing.
  v_a := v_g->'record'->>'id';
  v_b := v_p->'record'->>'id';
  perform pg_temp.x_like('XA-8', 'a create key cannot be used for a log entry',
    pg_temp.x_as('growth', format($$select public.crm_record_log(%L, '{"kind":"note","body":"x"}', 'xshared-key-01')::text$$, v_b)), 'ERR:22023:request_key_reused:%');
  perform pg_temp.x_like('XA-8', 'a create key cannot be used for a bulk add',
    pg_temp.x_as('growth', $$select public.crm_records_bulk_create('hosts', '[{"name":"Issue3802x Key Four"}]', 'xshared-key-01')::text$$), 'ERR:22023:request_key_reused:%');
  perform pg_temp.x_eq('XA-8', 'a reused key wrote nothing', pg_temp.x_snap(), v_snap);

  -- A log key replayed at another card answers with the first card's entry.
  v_r := pg_temp.x_as('growth', format($$select public.crm_record_log(%L, '{"kind":"note","body":"first note"}', 'xlog-key-0001')::text$$, v_a))::jsonb;
  v_snap := pg_temp.x_snap();
  v_p := pg_temp.x_as('growth', format($$select public.crm_record_log(%L, '{"kind":"touch","channel":"email","direction":"outbound"}', 'xlog-key-0001')::text$$, v_b))::jsonb;
  perform pg_temp.x_eq('XA-8', 'log replay at another card returns the first entry',
    (v_p->>'replayed') || ':' || (v_p->'activity'->>'id') || ':' || (v_p->'record'->>'id'),
    'true:' || (v_r->'activity'->>'id') || ':' || v_a);
  perform pg_temp.x_eq('XA-8', 'log replay wrote nothing', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_like('XA-8', 'a log key cannot be used for a create',
    pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Key Five"}', 'xlog-key-0001')::text$$), 'ERR:22023:request_key_reused:%');
  -- Another person's log with that key is their own entry.
  v_p := pg_temp.x_as('partner', format($$select public.crm_record_log(%L, '{"kind":"note","body":"partner note"}', 'xlog-key-0001')::text$$, v_b))::jsonb;
  perform pg_temp.x_eq('XA-8', 'another person, same log key: their own entry',
    (v_p ? 'replayed')::text || ':' || (v_p->'activity'->>'body') || ':' || (v_p->'activity'->>'actor_email'),
    'false:partner note:issue3802x-partner@test.local');

  -- A key nobody stored (the answer was "duplicate") is still free.
  perform pg_temp.x_eq('XA-8', 'a duplicate answer',
    pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"issue3802x key one"}', 'xfree-key-0001')->>'status'$$), 'duplicate');
  perform pg_temp.x_eq('XA-8', 'that key then creates a different name',
    pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Key Six"}', 'xfree-key-0001')->>'status'$$), 'created');

  -- Malformed and missing keys, on all three functions.
  v_snap := pg_temp.x_snap();
  foreach v_key in array array['short_7', repeat('k', 81), 'has space 01', 'quote''key-01', 'semi;colon-01', 'percent%key01', 'ünïcödé-key-01', '', '        '] loop
    perform pg_temp.x_like('XA-8', 'create refuses the key [' || left(v_key, 14) || ']',
      pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', '{"name":"Issue3802x Bad Key"}', %L)::text$$, v_key)), 'ERR:22023:request_key_required:%');
    perform pg_temp.x_like('XA-8', 'bulk refuses the key [' || left(v_key, 14) || ']',
      pg_temp.x_as('growth', format($$select public.crm_records_bulk_create('hosts', '[{"name":"Issue3802x Bad Key"}]', %L)::text$$, v_key)), 'ERR:22023:request_key_required:%');
    perform pg_temp.x_like('XA-8', 'log refuses the key [' || left(v_key, 14) || ']',
      pg_temp.x_as('growth', format($$select public.crm_record_log(%L, '{"kind":"note","body":"x"}', %L)::text$$, v_a, v_key)), 'ERR:22023:request_key_required:%');
  end loop;
  perform pg_temp.x_like('XA-8', 'create refuses a missing key',
    pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Bad Key"}', null)::text$$), 'ERR:22023:request_key_required:%');
  perform pg_temp.x_like('XA-8', 'log refuses a missing key',
    pg_temp.x_as('growth', format($$select public.crm_record_log(%L, '{"kind":"note","body":"x"}', null)::text$$, v_a)), 'ERR:22023:request_key_required:%');
  perform pg_temp.x_eq('XA-8', 'no malformed key wrote anything', pg_temp.x_snap(), v_snap);

  -- A stored answer is not readable by someone whose access is gone.
  update public.admin_team_members set status = 'revoked' where email = 'issue3802x-growth@test.local';
  perform pg_temp.x_like('XA-8', 'a revoked person cannot replay their old key',
    pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Key One"}', 'xshared-key-01')::text$$), 'ERR:42501:forbidden%');
  update public.admin_team_members set status = 'active' where email = 'issue3802x-growth@test.local';

  perform pg_temp.x_eq('XA-8', 'stored keys belong to the person who sent them',
    (select string_agg(actor_email || '/' || fn, ',' order by actor_email, fn) from public.crm_request_keys where request_key = 'xshared-key-01'),
    'issue3802x-growth@test.local/crm_record_create,issue3802x-partner@test.local/crm_record_create');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-9 — the whole stage table against an independent rule list.
--
-- Rules, in order: the same stage changes nothing; Live is never set by a
-- person; a Live host only moves to Lost; Lost and Passed need a reason (300
-- characters at most); a creator needs a signed agreement before Booked;
-- anything else is allowed.
-- ---------------------------------------------------------------------------
create function pg_temp.x_rule(p_pipeline text, p_from text, p_to text, p_reason text, p_agreement text) returns text
language sql as $fn$
  select case
    when p_from = p_to then 'same'
    when p_to = 'live' then 'stage_sets_itself'
    when p_from = 'live' and p_to <> 'lost' then 'stage_is_live'
    when p_to in ('lost', 'passed') and (nullif(btrim(coalesce(p_reason, '')), '') is null or char_length(btrim(p_reason)) > 300) then 'reason_required'
    when p_pipeline = 'creators' and p_to in ('booked', 'posted') and p_agreement is distinct from 'signed' then 'agreement_required'
    else 'ok'
  end
$fn$;

do $t$
declare
  c_hosts    constant text[] := array['prospect','contacted','replied','meeting','onboarded','live','lost'];
  c_creators constant text[] := array['identified','contacted','replied','negotiating','booked','posted','passed'];
  v_pipe text;
  v_stages text[];
  v_from text;
  v_to text;
  v_reason text;
  v_agree text;
  v_who text;
  v_n int := 0;
  v_id uuid;
  v_got text;
  v_class text;
  v_want text;
  v_act int;
  v_aud int;
  v_row public.crm_records;
  v_bad boolean;
begin
  foreach v_pipe in array array['hosts','creators'] loop
    v_stages := case v_pipe when 'hosts' then c_hosts else c_creators end;
    foreach v_from in array v_stages loop
      foreach v_to in array v_stages loop
        foreach v_reason in array array['<none>', '   ', 'They closed for the season', repeat('r', 300), repeat('r', 301)] loop
          foreach v_agree in array (case when v_pipe = 'creators' and v_to = 'booked' then array['<none>','none','sent','signed'] else array['<none>'] end) loop
            v_n := v_n + 1;
            v_who := (array['growth','partner','admin','owner'])[1 + v_n % 4];
            v_id := pg_temp.x_seed('m', v_pipe, 'Issue3802x Move ' || v_n, v_from, null, nullif(v_agree, '<none>'));
            select count(*) into v_act from public.crm_activity where record_id = v_id;
            v_aud := pg_temp.x_audit();
            v_got := pg_temp.x_as(v_who, format('select public.crm_record_move_stage(%L, %L, %s)::text', v_id, v_to,
                       case when v_reason = '<none>' then 'null' else quote_literal(v_reason) end));
            v_class := case
              when v_got like 'ERR:22023:%' then split_part(split_part(v_got, ':', 3), ' ', 1)
              when v_got like 'ERR:%' then left(v_got, 60)
              when (v_got::jsonb->>'changed') = 'true' then 'ok'
              else 'same' end;
            v_want := pg_temp.x_rule(v_pipe, v_from, v_to, nullif(v_reason, '<none>'), nullif(v_agree, '<none>'));
            select * into v_row from public.crm_records where id = v_id;
            v_bad := v_class <> v_want
               or v_row.stage <> (case when v_want = 'ok' then v_to else v_from end)
               or (v_want = 'ok' and (v_row.stage in ('lost','passed')) <> (v_row.stage_reason is not null))
               or (v_want = 'ok' and v_row.stage in ('lost','passed') and v_row.stage_reason <> btrim(v_reason))
               or (select count(*) from public.crm_activity where record_id = v_id) - v_act <> (case when v_want = 'ok' then 1 else 0 end)
               or pg_temp.x_audit() - v_aud <> (case when v_want = 'ok' then 1 else 0 end);
            if v_bad then
              perform pg_temp.x_ok('XA-9', format('%s %s -> %s reason[%s] agreement[%s] as %s', v_pipe, v_from, v_to, left(v_reason, 12), v_agree, v_who),
                false, format('want %s got %s; stage now %s reason %s', v_want, v_class, v_row.stage, coalesce(left(v_row.stage_reason, 12), '<null>')));
            end if;
            -- A move that happened is logged under the person who made it.
            if v_want = 'ok' and not exists (
                 select 1 from public.crm_activity a join x_people p on p.email = a.actor_email
                  where a.record_id = v_id and a.kind = 'stage_move' and a.from_stage = v_from and a.to_stage = v_to
                    and a.via is null and p.who = v_who) then
              perform pg_temp.x_ok('XA-9', format('%s %s -> %s logged under %s', v_pipe, v_from, v_to, v_who), false, 'no matching log line');
            end if;
            delete from public.crm_records where id = v_id;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  perform pg_temp.x_ok('XA-9', 'every case matched the rule list',
    not exists (select 1 from x_results where test = 'XA-9' and not ok));
  perform pg_temp.x_eq('XA-9', 'stage cases walked', v_n::text, '595');

  -- A stage that does not belong to the pipeline, in either direction.
  v_id := pg_temp.x_seed('m', 'hosts', 'Issue3802x Move Wrong Pipeline', 'prospect');
  foreach v_to in array array['identified','negotiating','booked','posted','passed','LIVE','Lost',' lost','','live; drop table public.crm_records'] loop
    perform pg_temp.x_like('XA-9', 'a host cannot move to [' || v_to || ']',
      pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, %L, 'because')::text$$, v_id, v_to)), 'ERR:22023:invalid_stage:%');
  end loop;
  perform pg_temp.x_like('XA-9', 'a host cannot move to nothing',
    pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, null, 'because')::text$$, v_id)), 'ERR:22023:invalid_stage:%');
  perform pg_temp.x_eq('XA-9', 'it never moved', (select stage from public.crm_records where id = v_id), 'prospect');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-10b — Live.
-- ---------------------------------------------------------------------------
do $t$
declare
  b record;
  v_got text;
  v_id uuid;
  v_n int;
  v_expect int;
  v_first timestamptz;
begin
  -- The rule against what a signed-out visitor can actually read.
  for b in select * from x_brands order by k loop
    perform pg_temp.x_eq('XA-10', 'rule for a brand whose listing is: ' || b.k, public.crm_brand_is_live(b.id)::text, b.live::text);
    if b.has_event and b.k <> 'brand_deleted' then
      perform pg_temp.x_eq('XA-10', 'a signed-out visitor sees the same thing: ' || b.k,
        pg_temp.x_as('anon', format('select exists (select 1 from public.events_public_view e where e.brand_id = %L)::text', b.id)), b.live::text);
    end if;
  end loop;
  perform pg_temp.x_eq('XA-10', 'no brand at all', public.crm_brand_is_live(null)::text, 'false');
  perform pg_temp.x_eq('XA-10', 'a brand that does not exist', public.crm_brand_is_live('38021111-0000-4000-ffff-0000000000bb')::text, 'false');

  -- Linking on create: Live only where the listing is public.
  for b in select * from x_brands where k <> 'brand_deleted' order by k loop
    v_got := pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, %L)->'record'->>'stage'$$,
      jsonb_build_object('name', 'Issue3802x Linked ' || b.k, 'brand_id', b.id)::text, 'xlink-' || rpad(replace(b.k, '_', '-'), 14, '0')));
    perform pg_temp.x_eq('XA-10', 'a new host linked to [' || b.k || '] lands in', v_got, case when b.live then 'live' else 'onboarded' end);
  end loop;
  perform pg_temp.x_like('XA-10', 'a deleted brand cannot be linked',
    pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, 'xlink-deleted-brand')::text$$,
      jsonb_build_object('name', 'Issue3802x Linked deleted', 'brand_id', pg_temp.x_brand('brand_deleted'))::text)), 'ERR:22023:invalid_brand:%');
  perform pg_temp.x_like('XA-10', 'a creator cannot be linked to a brand',
    pg_temp.x_as('growth', format($$select public.crm_record_create('creators', %L, 'xlink-creator-brand')::text$$,
      jsonb_build_object('name', '@issue3802x_linked', 'brand_id', pg_temp.x_brand('pub_scheduled'))::text)), 'ERR:22023:field_not_for_pipeline:%');

  -- Each automatic move is the system's, once.
  perform pg_temp.x_eq('XA-10', 'every Live host got exactly one system line and one system audit row',
    (select count(*)::text from public.crm_records r
      where r.name like 'Issue3802x Linked %' and r.stage = 'live'
        and (select count(*) from public.crm_activity a where a.record_id = r.id and a.to_stage = 'live'
                and a.actor_email is null and a.via = 'system') = 1
        and (select count(*) from public.admin_audit_log l where l.target_id = r.id::text and l.action = 'crm.stage_auto_live'
                and l.admin_email = 'system' and l.actor_uid is null) = 1
        and r.went_live_at is not null),
    (select count(*)::text from x_brands where live));
  perform pg_temp.x_eq('XA-10', 'no host that is not Live carries a went-live time',
    (select count(*)::text from public.crm_records where stage <> 'live' and went_live_at is not null), '0');

  -- The scheduled run, as the scheduler: no signed-in caller at all.
  delete from public.crm_records where name like 'Issue3802x Linked %';
  v_expect := 0;
  for b in select * from x_brands order by k loop
    perform pg_temp.x_seed('sched_' || b.k, 'hosts', 'Issue3802x Sched ' || b.k, 'onboarded', b.id);
    if b.live then v_expect := v_expect + 1; end if;
  end loop;
  perform pg_temp.x_seed('sched_lost',    'hosts', 'Issue3802x Sched lost',    'lost',      pg_temp.x_brand('pub_scheduled')::uuid);
  perform pg_temp.x_seed('sched_early',   'hosts', 'Issue3802x Sched early',   'contacted', pg_temp.x_brand('pub_live')::uuid);
  perform pg_temp.x_seed('sched_nobrand', 'hosts', 'Issue3802x Sched nobrand', 'onboarded', null);
  v_id := pg_temp.x_seed('sched_deleted', 'hosts', 'Issue3802x Sched deleted', 'onboarded', pg_temp.x_brand('pub_scheduled')::uuid);
  update public.crm_records set deleted_at = now(), deleted_by = 'issue3802x-owner@test.local' where id = v_id;
  v_expect := v_expect + 1;   -- "early": a linked host in any stage before Live, except Lost
  perform pg_temp.x_eq('XA-10', 'the scheduled run promotes exactly the hosts with a public listing',
    pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), v_expect::text);
  for b in select * from x_brands order by k loop
    perform pg_temp.x_eq('XA-10', 'after the run, the host linked to [' || b.k || '] is in',
      (select stage from public.crm_records where id = pg_temp.x_id('sched_' || b.k)::uuid), case when b.live then 'live' else 'onboarded' end);
  end loop;
  perform pg_temp.x_eq('XA-10', 'a Lost host stays Lost', (select stage from public.crm_records where id = pg_temp.x_id('sched_lost')::uuid), 'lost');
  perform pg_temp.x_eq('XA-10', 'a host with no brand stays put', (select stage from public.crm_records where id = pg_temp.x_id('sched_nobrand')::uuid), 'onboarded');
  perform pg_temp.x_eq('XA-10', 'a deleted host is not touched', (select stage from public.crm_records where id = pg_temp.x_id('sched_deleted')::uuid), 'onboarded');
  v_n := pg_temp.x_audit();
  perform pg_temp.x_eq('XA-10', 'a second run changes nothing', pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), '0');
  perform pg_temp.x_eq('XA-10', 'a third run changes nothing', pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), '0');
  perform pg_temp.x_eq('XA-10', 'repeat runs write no audit row', pg_temp.x_audit()::text, v_n::text);
  perform pg_temp.x_eq('XA-10', 'one system line per promoted host, no more',
    (select coalesce(max(c), 0)::text from (select count(*) c from public.crm_activity a
       where a.to_stage = 'live' and a.record_id in (select id from public.crm_records where name like 'Issue3802x Sched %') group by a.record_id) s), '1');

  -- A listing that ends does not take Live away; a listing that appears does
  -- not bring a Lost host back.
  set local session_replication_role = replica;
  update public.events set status = 'ended' where brand_id = pg_temp.x_brand('pub_scheduled')::uuid;
  update public.events set status = 'scheduled', visibility = 'public' where brand_id = pg_temp.x_brand('private')::uuid;
  set local session_replication_role = origin;
  perform pg_temp.x_eq('XA-10', 'the run promotes the one host whose listing just became public',
    pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), '1');
  perform pg_temp.x_eq('XA-10', 'a host whose listing ended stays Live',
    (select stage from public.crm_records where id = pg_temp.x_id('sched_pub_scheduled')::uuid), 'live');
  perform pg_temp.x_eq('XA-10', 'the Lost host is still Lost',
    (select stage from public.crm_records where id = pg_temp.x_id('sched_lost')::uuid), 'lost');

  -- Lost, reopened, promoted again: the first went-live time is kept.
  v_id := pg_temp.x_id('sched_pub_live')::uuid;
  select went_live_at into v_first from public.crm_records where id = v_id;
  perform pg_temp.x_as('partner', format($$select public.crm_record_move_stage(%L, 'lost', 'paused for now')::text$$, v_id));
  perform pg_temp.x_eq('XA-10', 'a reopened host sits where the person put it until the next run',
    pg_temp.x_as('partner', format($$select public.crm_record_move_stage(%L, 'onboarded')->'record'->>'stage'$$, v_id)), 'onboarded');
  perform pg_temp.x_eq('XA-10', 'the next run brings it back to Live', pg_temp.x_as('cron', format('select public.crm_reconcile_live(%L)::text', v_id)), '1');
  perform pg_temp.x_eq('XA-10', 'the first went-live time is kept',
    (select (went_live_at = v_first)::text from public.crm_records where id = v_id), 'true');

  -- No client can start a run or the link step.
  perform pg_temp.x_like('XA-10', 'owner cannot start a run', pg_temp.x_as('owner', 'select public.crm_reconcile_live()::text'), 'ERR:42501:permission denied%');
  perform pg_temp.x_like('XA-10', 'growth cannot start a run for one card',
    pg_temp.x_as('growth', format('select public.crm_reconcile_live(%L)::text', pg_temp.x_id('sched_none'))), 'ERR:42501:permission denied%');

  -- Linking later, and the routes that must not lead to Live.
  v_id := pg_temp.x_seed('late', 'hosts', 'Issue3802x Late Link', 'contacted');
  perform pg_temp.x_eq('XA-10', 'linking a brand with no listing moves the host to Onboarded',
    pg_temp.x_as('partner', format($$select public.crm_record_update(%L, %L)->>'moved_to'$$, v_id,
      jsonb_build_object('brand_id', pg_temp.x_brand('none'))::text)), 'onboarded');
  perform pg_temp.x_like('XA-10', 'a person cannot then move it to Live',
    pg_temp.x_as('owner', format($$select public.crm_record_move_stage(%L, 'live')::text$$, v_id)), 'ERR:22023:stage_sets_itself:%');
  perform pg_temp.x_eq('XA-10', 'a run for that card promotes nothing', pg_temp.x_as('cron', format('select public.crm_reconcile_live(%L)::text', v_id)), '0');
  perform pg_temp.x_eq('XA-10', 're-linking to a brand with a listing moves it to Live',
    pg_temp.x_as('partner', format($$select public.crm_record_update(%L, %L)->>'moved_to'$$, v_id,
      jsonb_build_object('brand_id', pg_temp.x_brand('venue'))::text)), 'live');
  perform pg_temp.x_eq('XA-10', 'the edit that linked a public brand is recorded twice: the person and the system',
    (select string_agg(action || '=' || admin_email, ',' order by action) from public.admin_audit_log
      where target_id = v_id::text and action in ('crm.record_update', 'crm.stage_auto_live') and created_at >= (
        select max(created_at) from public.admin_audit_log where target_id = v_id::text and action = 'crm.stage_auto_live')),
    'crm.record_update=issue3802x-partner@test.local,crm.stage_auto_live=system');
  v_id := pg_temp.x_seed('lost_link', 'hosts', 'Issue3802x Lost Link', 'lost');
  perform pg_temp.x_eq('XA-10', 'linking a public brand to a Lost host leaves it Lost',
    pg_temp.x_as('partner', format($$select public.crm_record_update(%L, %L)->'record'->>'stage'$$, v_id,
      jsonb_build_object('brand_id', pg_temp.x_brand('pub_live'))::text)), 'lost');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-11 — undo.
-- ---------------------------------------------------------------------------
do $t$
declare
  v_id uuid := pg_temp.x_seed('undo', 'hosts', 'Issue3802x Undo Card', 'prospect');
  v_act text;
  v_sys text;
  v_note text;
  v_who text;
  v_snap text;
begin
  v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'contacted')->>'activity_id'$$, v_id));
  perform pg_temp.x_eq('XA-11', 'the mover is offered the undo',
    pg_temp.x_as('growth', format($$select public.crm_record_get(%L)->>'undoable_activity_id'$$, v_id)), v_act);
  v_snap := pg_temp.x_snap();
  foreach v_who in array array['partner','admin','owner'] loop
    perform pg_temp.x_eq('XA-11', v_who || ' is not offered someone else''s undo',
      pg_temp.x_as(v_who, format($$select coalesce(public.crm_record_get(%L)->>'undoable_activity_id', '<none>')$$, v_id)), '<none>');
    perform pg_temp.x_like('XA-11', v_who || ' cannot undo someone else''s move',
      pg_temp.x_as(v_who, format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_expired:%');
  end loop;
  perform pg_temp.x_like('XA-11', 'an id that is no log line',
    pg_temp.x_as('growth', $$select public.crm_record_undo_stage_move('38021111-0000-4000-ffff-0000000000cc')::text$$), 'ERR:22023:undo_expired:%');
  perform pg_temp.x_like('XA-11', 'no id at all',
    pg_temp.x_as('growth', 'select public.crm_record_undo_stage_move(null)::text'), 'ERR:22023:undo_expired:%');
  perform pg_temp.x_eq('XA-11', 'no refused undo changed anything', pg_temp.x_snap(), v_snap);

  perform pg_temp.x_eq('XA-11', 'the mover undoes it',
    pg_temp.x_as('growth', format($$select public.crm_record_undo_stage_move(%L)->'record'->>'stage'$$, v_act)), 'prospect');
  perform pg_temp.x_eq('XA-11', 'the log line is gone', (select count(*)::text from public.crm_activity where id = v_act::uuid), '0');
  perform pg_temp.x_eq('XA-11', 'the undo is recorded under the mover',
    (select admin_email || '/' || actor_uid::text from public.admin_audit_log where target_id = v_id::text and action = 'crm.stage_undo'),
    'issue3802x-growth@test.local/38021111-0000-4000-a000-000000000003');
  perform pg_temp.x_like('XA-11', 'the same undo twice',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_expired:%');

  -- The window, on both sides of the minute.
  v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'replied')->>'activity_id'$$, v_id));
  update public.crm_activity set created_at = clock_timestamp() - interval '61 seconds' where id = v_act::uuid;
  perform pg_temp.x_like('XA-11', 'a move 61 seconds old cannot be undone',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_expired:%');
  perform pg_temp.x_eq('XA-11', 'and is not offered',
    pg_temp.x_as('growth', format($$select coalesce(public.crm_record_get(%L)->>'undoable_activity_id', '<none>')$$, v_id)), '<none>');
  update public.crm_activity set created_at = clock_timestamp() - interval '55 seconds' where id = v_act::uuid;
  perform pg_temp.x_eq('XA-11', 'a move 55 seconds old can be undone',
    pg_temp.x_as('growth', format($$select public.crm_record_undo_stage_move(%L)->'record'->>'stage'$$, v_act)), 'prospect');

  -- Anything logged afterwards closes the window, whoever logged it.
  v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'meeting')->>'activity_id'$$, v_id));
  perform pg_temp.x_as('partner', format($$select public.crm_record_log(%L, '{"kind":"note","body":"called"}', 'xundo-key-001')::text$$, v_id));
  perform pg_temp.x_like('XA-11', 'a later note closes the window',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_expired:%');
  select id::text into v_note from public.crm_activity where record_id = v_id and kind = 'note';
  perform pg_temp.x_like('XA-11', 'a note is not something to undo',
    pg_temp.x_as('partner', format('select public.crm_record_undo_stage_move(%L)::text', v_note)), 'ERR:22023:undo_expired:%');
  perform pg_temp.x_eq('XA-11', 'the note is still there', (select count(*)::text from public.crm_activity where id = v_note::uuid), '1');

  -- The system's own moves are nobody's to undo.
  v_id := pg_temp.x_seed('undo_sys', 'hosts', 'Issue3802x Undo System', 'prospect');
  perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('none'))::text));
  select id::text into v_sys from public.crm_activity where record_id = v_id and via = 'system';
  foreach v_who in array array['growth','owner'] loop
    perform pg_temp.x_like('XA-11', v_who || ' cannot undo the automatic move to Onboarded',
      pg_temp.x_as(v_who, format('select public.crm_record_undo_stage_move(%L)::text', v_sys)), 'ERR:22023:undo_expired:%');
  end loop;
  v_id := pg_temp.x_seed('undo_live', 'hosts', 'Issue3802x Undo Live', 'prospect');
  perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('venue'))::text));
  for v_sys in select id::text from public.crm_activity where record_id = v_id and via = 'system' loop
    perform pg_temp.x_like('XA-11', 'growth cannot undo an automatic move on a Live host',
      pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_sys)), 'ERR:22023:undo_expired:%');
  end loop;
  perform pg_temp.x_eq('XA-11', 'the host is still Live', (select stage from public.crm_records where id = v_id), 'live');
  -- Live to Lost by one person: nobody else can put it back in Live, and
  -- neither can the mover once the minute has passed.
  v_act := pg_temp.x_as('partner', format($$select public.crm_record_move_stage(%L, 'lost', 'closed down')->>'activity_id'$$, v_id));
  foreach v_who in array array['growth','admin','owner'] loop
    perform pg_temp.x_like('XA-11', v_who || ' cannot undo another person''s Lost back into Live',
      pg_temp.x_as(v_who, format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_expired:%');
  end loop;
  update public.crm_activity set created_at = clock_timestamp() - interval '2 minutes' where id = v_act::uuid;
  perform pg_temp.x_like('XA-11', 'after the minute the mover cannot either',
    pg_temp.x_as('partner', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_expired:%');
  perform pg_temp.x_eq('XA-11', 'it stays Lost with its reason',
    (select stage || ':' || stage_reason from public.crm_records where id = v_id), 'lost:closed down');

  -- Undo of a move out of Lost puts the earlier reason back.
  v_id := pg_temp.x_seed('undo_reason', 'creators', '@issue3802x_undo_reason', 'identified');
  perform pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'passed', 'too expensive')::text$$, v_id));
  v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'contacted')->>'activity_id'$$, v_id));
  perform pg_temp.x_eq('XA-11', 'undo back into Passed keeps the original reason',
    pg_temp.x_as('growth', format($$select (r->'record'->>'stage') || ':' || (r->'record'->>'stage_reason') from public.crm_record_undo_stage_move(%L) r$$, v_act)),
    'passed:too expensive');

  -- A deleted card.
  v_id := pg_temp.x_seed('undo_del', 'hosts', 'Issue3802x Undo Deleted', 'prospect');
  v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'contacted')->>'activity_id'$$, v_id));
  perform pg_temp.x_as('admin', format('select public.crm_record_delete(%L)::text', v_id));
  perform pg_temp.x_like('XA-11', 'a move on a deleted card cannot be undone',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_expired:%');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-12 — the Beta leads reader.
-- ---------------------------------------------------------------------------
do $t$
declare
  v_who text;
begin
  foreach v_who in array array['growth','partner','consumer','invited','revoked','unconf','spoof','ghost','nosub','service'] loop
    perform pg_temp.x_eq('XA-12', v_who || ' cannot read beta leads',
      pg_temp.x_as(v_who, 'select count(*)::text from public.admin_beta_leads_list()'), 'ERR:42501:forbidden');
    perform pg_temp.x_eq('XA-12', v_who || ' cannot read one column of beta leads',
      pg_temp.x_as(v_who, 'select email from public.admin_beta_leads_list() limit 1'), 'ERR:42501:forbidden');
  end loop;
  perform pg_temp.x_like('XA-12', 'anon cannot call it',
    pg_temp.x_as('anon', 'select count(*)::text from public.admin_beta_leads_list()'), 'ERR:42501:permission denied for function%');
  foreach v_who in array array['owner','admin'] loop
    perform pg_temp.x_eq('XA-12', v_who || ' still reads the lead, as the page expects',
      pg_temp.x_as(v_who, $$select brand_name || '|' || contact_name || '|' || city || '|' || email || '|' || brand_type::text
                              from public.admin_beta_leads_list() where id = '38021111-0000-4000-b500-000000000001'$$),
      'Issue3802x Lead|Lead Person|Lagos|issue3802x-lead@test.local|{restaurant}');
    perform pg_temp.x_eq('XA-12', v_who || ' gets every lead',
      pg_temp.x_as(v_who, 'select count(*)::text from public.admin_beta_leads_list()'), (select count(*)::text from public.beta_access_leads));
  end loop;
  perform pg_temp.x_eq('XA-12', 'the answer has the same columns as before',
    pg_get_function_result('public.admin_beta_leads_list()'::regprocedure),
    'TABLE(id uuid, created_at timestamp with time zone, brand_type text[], brand_name text, contact_name text, city text, email text, source text, user_agent text, referer text)');
  perform pg_temp.x_eq('XA-12', 'the same roles may call it as before',
    (select array_to_string(array_agg(distinct g.rolname order by g.rolname), ',')
       from pg_proc p, aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
      where p.oid = 'public.admin_beta_leads_list()'::regprocedure and a.grantee <> p.proowner), 'authenticated,service_role');
  -- An admin whose access ends loses it at once.
  update public.admin_users set status = 'revoked' where email = 'issue3802x-admin@test.local';
  perform pg_temp.x_eq('XA-12', 'an admin revoked a moment ago cannot read beta leads',
    pg_temp.x_as('admin', 'select count(*)::text from public.admin_beta_leads_list()'), 'ERR:42501:forbidden');
  update public.admin_users set status = 'active' where email = 'issue3802x-admin@test.local';
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-13 — areas, and the full-admin gate left alone.
-- ---------------------------------------------------------------------------
do $t$
declare
  v_who text;
  v_role text;
  v_code text;
begin
  perform pg_temp.x_eq('XA-13', 'owner areas',   public.admin_team_role_areas('owner')::text,   '{admin_console,team_manage,crm,beta_leads}');
  perform pg_temp.x_eq('XA-13', 'admin areas',   public.admin_team_role_areas('admin')::text,   '{admin_console,crm,beta_leads}');
  perform pg_temp.x_eq('XA-13', 'growth areas',  public.admin_team_role_areas('growth')::text,  '{role_home,crm,beta_leads}');
  perform pg_temp.x_eq('XA-13', 'partner areas', public.admin_team_role_areas('partner')::text, '{role_home,crm,beta_leads}');
  foreach v_role in array array['OWNER','Owner',' owner','owner ','admin_console','superadmin','service_role','authenticated','anon',
                                'postgres','member','invited','revoked','','*','%','owner,admin','growth;partner'] loop
    perform pg_temp.x_eq('XA-13', 'no areas for the role word [' || v_role || ']', public.admin_team_role_areas(v_role)::text, '{}');
  end loop;
  perform pg_temp.x_eq('XA-13', 'no areas for no role', public.admin_team_role_areas(null)::text, '{}');

  foreach v_who in array array['owner','admin','growth','partner','invited','revoked','consumer','unconf','spoof','ghost','nosub','service'] loop
    perform pg_temp.x_eq('XA-13', v_who || ': the admin area still equals the full-admin gate',
      pg_temp.x_as(v_who, $$select (public.admin_team_can('admin_console') = public.is_admin_user())::text$$), 'true');
    perform pg_temp.x_eq('XA-13', v_who || ': full admin',
      pg_temp.x_as(v_who, 'select public.is_admin_user()::text'), (v_who in ('owner', 'admin'))::text);
    perform pg_temp.x_eq('XA-13', v_who || ': pipelines area',
      pg_temp.x_as(v_who, $$select public.admin_team_can('crm')::text$$), (v_who in ('owner', 'admin', 'growth', 'partner'))::text);
    perform pg_temp.x_eq('XA-13', v_who || ': team management area',
      pg_temp.x_as(v_who, $$select public.admin_team_can('team_manage')::text$$), (v_who = 'owner')::text);
  end loop;
  perform pg_temp.x_like('XA-13', 'the new roles still cannot read the team list',
    pg_temp.x_as('growth', 'select count(*)::text from public.admin_team_list()'), 'ERR:42501:%');

  -- The migration, minus its comments, defines none of the protected objects
  -- and writes no policy.
  select regexp_replace(body, '^\s*--[^\n]*$', '', 'gn') into v_code from x_mig;
  perform pg_temp.x_ok('XA-13', 'the migration text was read', char_length(v_code) > 20000);
  perform pg_temp.x_eq('XA-13', 'it does not define the full-admin gate or the Wave 0 role functions',
    (select count(*)::text from regexp_matches(v_code,
       'FUNCTION\s+public\.(is_admin_user|admin_team_role|admin_team_can|admin_team_my_access|admin_team_caller_email|admin_team_set_member|admin_team_issue_invite|admin_team_activate_self|admin_team_list)\s*\(', 'gi')), '0');
  perform pg_temp.x_eq('XA-13', 'it creates, alters or drops no policy',
    (select count(*)::text from regexp_matches(v_code, '(CREATE|ALTER|DROP)\s+POLICY', 'gi')), '0');
  perform pg_temp.x_eq('XA-13', 'it grants nothing to anon or to everyone',
    (select count(*)::text from regexp_matches(v_code, 'GRANT\s[^;]*\sTO\s[^;]*\m(anon|PUBLIC)\M', 'gi')), '0');
  perform pg_temp.x_eq('XA-13', 'it alters none of the tables other work owns',
    (select count(*)::text from regexp_matches(v_code,
       'ALTER\s+TABLE\s+(ONLY\s+)?public\.(admin_users|admin_team_members|admin_team_invites|admin_audit_log|brands|events|place_pool|seeding_cities|beta_access_leads)\M', 'gi')), '0');
  perform pg_temp.x_eq('XA-13', 'it creates no trigger',
    (select count(*)::text from regexp_matches(v_code, 'CREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER', 'gi')), '0');
  perform pg_temp.x_eq('XA-13', 'no crm_ function reads the membership table itself',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ 'admin_team_members' and p.proname like 'crm\_%'), null);
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-14 — inputs are data; limits hold; no bookkeeping field leaves.
-- ---------------------------------------------------------------------------
do $t$
declare
  c_record_keys constant text := 'agreement,beta_lead_id,brand_id,brand_name,channel,contact,contact_rule,contact_rule_at,contact_rule_by,contact_rule_reason,created_at,created_by,due_on,followers,icp,id,identifiers,last_touch_at,name,next_action,owners,pipeline,place_name,place_pool_id,rate,region_id,source,stage,stage_reason,touch_count,updated_at,went_live_at';
  v_got jsonb;
  v_txt text;
  v_q text;
  v_id text := pg_temp.x_id('gate');
begin
  v_got := pg_temp.x_as('growth', $$select public.crm_link_search('brand', 'Issue3802x Cap')::text$$)::jsonb;
  perform pg_temp.x_eq('XA-14', 'thirteen matches, ten returned', jsonb_array_length(v_got->'results')::text, '10');
  perform pg_temp.x_eq('XA-14', 'a brand result carries only its named keys',
    (select string_agg(distinct ks, ';') from (select (select string_agg(k, ',' order by k) from jsonb_object_keys(e) k) ks
       from jsonb_array_elements(v_got->'results') e) s), 'city,id,is_live,name,slug');
  v_got := pg_temp.x_as('growth', $$select public.crm_link_search('place', 'Issue3802x')::text$$)::jsonb;
  perform pg_temp.x_eq('XA-14', 'a place result carries only its named keys, and a closed place is left out',
    (select string_agg((select string_agg(k, ',' order by k) from jsonb_object_keys(e) k) || '=' || (e->>'name'), ';')
       from jsonb_array_elements(v_got->'results') e), 'city,id,name=Issue3802x Open Place');
  perform pg_temp.x_eq('XA-14', 'a deleted brand is not offered',
    pg_temp.x_as('growth', $$select jsonb_array_length(public.crm_link_search('brand', 'Issue3802x Brand brand_deleted')->'results')::text$$), '0');

  -- Wildcard characters are plain characters.
  perform pg_temp.x_eq('XA-14', 'percent is a plain character',
    pg_temp.x_as('growth', $$select string_agg(e->>'name', ';') from jsonb_array_elements(public.crm_link_search('brand', 'Issue3802x 100%')->'results') e$$), 'Issue3802x 100% A_B');
  perform pg_temp.x_eq('XA-14', 'underscore is a plain character',
    pg_temp.x_as('growth', $$select string_agg(e->>'name', ';') from jsonb_array_elements(public.crm_link_search('brand', 'A_B')->'results') e$$), 'Issue3802x 100% A_B');
  perform pg_temp.x_eq('XA-14', 'backslash is a plain character',
    pg_temp.x_as('growth', $$select string_agg(e->>'name', ';') from jsonb_array_elements(public.crm_link_search('brand', E'Back\\Sl')->'results') e$$), E'Issue3802x Back\\Slash');
  perform pg_temp.x_eq('XA-14', 'a lone percent pair matches no brand of this suite',
    pg_temp.x_as('growth', $$select count(*)::text from jsonb_array_elements(public.crm_link_search('brand', '%%')->'results') e where e->>'name' like 'Issue3802x%'$$), '0');
  perform pg_temp.x_eq('XA-14', 'a lone underscore pair matches no brand of this suite',
    pg_temp.x_as('growth', $$select count(*)::text from jsonb_array_elements(public.crm_link_search('brand', '__')->'results') e where e->>'name' like 'Issue3802x%'$$), '0');
  perform pg_temp.x_eq('XA-14', 'one character searches nothing',
    pg_temp.x_as('growth', $$select jsonb_array_length(public.crm_link_search('brand', 'I')->'results')::text$$), '0');

  -- Hostile text in every text argument.
  foreach v_q in array array[
    $q$x'; drop table public.crm_records; --$q$, $q$' or '1'='1$q$, $q$") or true --$q$, $q$%' union select null,null,null,null,null --$q$,
    $q$\'; select pg_sleep(10); --$q$, $q$$$; drop table public.crm_activity; $$$q$, repeat('a%_\', 5000)] loop
    perform pg_temp.x_eq('XA-14', 'search treats [' || left(v_q, 20) || '] as text',
      pg_temp.x_as('growth', format('select jsonb_array_length(public.crm_link_search(%L, %L)->%L)::text', 'brand', v_q, 'results')), '0');
    perform pg_temp.x_like('XA-14', 'search kind [' || left(v_q, 20) || '] is refused',
      pg_temp.x_as('growth', format('select public.crm_link_search(%L, %L)::text', v_q, 'Issue3802x')), 'ERR:22023:invalid_kind:%');
    perform pg_temp.x_like('XA-14', 'list pipeline [' || left(v_q, 20) || '] is refused',
      pg_temp.x_as('growth', format('select public.crm_records_list(%L)::text', v_q)), 'ERR:22023:invalid_pipeline:%');
    perform pg_temp.x_like('XA-14', 'duplicate-check pipeline [' || left(v_q, 20) || '] is refused',
      pg_temp.x_as('growth', format('select public.crm_duplicate_check(%L, %L)::text', v_q, 'x')), 'ERR:22023:invalid_pipeline:%');
    perform pg_temp.x_ok('XA-14', 'duplicate check takes [' || left(v_q, 20) || '] as a name',
      pg_temp.x_as('growth', format('select public.crm_duplicate_check(%L, %L)::text', 'hosts', v_q)) like '{%');
  end loop;
  perform pg_temp.x_like('XA-14', 'a name of hostile text is stored as a name, or refused for length',
    pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, 'xhostile-0001')->'record'->>'name'$$,
      jsonb_build_object('name', $q$Issue3802x'; drop table public.crm_records; --$q$)::text)), $q$Issue3802x'; drop table public.crm_records; --$q$);
  perform pg_temp.x_eq('XA-14', 'every table is still there',
    (select count(*)::text from pg_class where oid in ('public.crm_records'::regclass, 'public.crm_activity'::regclass)), '2');

  -- What a record looks like on the way out.
  v_got := pg_temp.x_as('partner', format('select public.crm_record_get(%L)::text', v_id))::jsonb;
  perform pg_temp.x_eq('XA-14', 'a record carries exactly its named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_got->'record') k), c_record_keys);
  -- [TEST-MOD-APPROVED #3802] 2026-10-15: record details append the
  -- read-only imports summary; record/list payload keys remain pinned below.
  perform pg_temp.x_eq('XA-14', 'opening a record returns exactly five parts',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_got) k), 'activity,imports,links,record,undoable_activity_id');
  v_got := pg_temp.x_as('partner', $$select public.crm_records_list('hosts')::text$$)::jsonb;
  perform pg_temp.x_eq('XA-14', 'every listed record carries exactly its named keys',
    (select string_agg(distinct ks, ';') from (select (select string_agg(k, ',' order by k) from jsonb_object_keys(e) k) ks
       from jsonb_array_elements(v_got->'records') e) s), c_record_keys);
  perform pg_temp.x_eq('XA-14', 'the list holds every live host and no deleted one',
    jsonb_array_length(v_got->'records')::text || ':' || (v_got->>'truncated'),
    (select count(*)::text from public.crm_records where pipeline = 'hosts' and deleted_at is null) || ':false');
  perform pg_temp.x_eq('XA-14', 'the hosts list holds no creator',
    (select count(*)::text from jsonb_array_elements(v_got->'records') e where e->>'pipeline' <> 'hosts'), '0');

  -- The team list a member sees: current people only.
  v_got := pg_temp.x_as('partner', 'select public.crm_config()::text')::jsonb;
  perform pg_temp.x_eq('XA-14', 'a team entry carries exactly its named keys',
    (select string_agg(distinct ks, ';') from (select (select string_agg(k, ',' order by k) from jsonb_object_keys(e) k) ks
       from jsonb_array_elements(v_got->'team') e) s), 'display_name,email,role,status');
  perform pg_temp.x_eq('XA-14', 'a revoked person and an ordinary account are not on the team list',
    (select count(*)::text from jsonb_array_elements(v_got->'team') e
      where e->>'email' in ('issue3802x-revoked@test.local', 'issue3802x-consumer@test.local')), '0');
  perform pg_temp.x_eq('XA-14', 'this suite''s current people are, one row each',
    (select string_agg((e->>'email') || '=' || (e->>'role') || '/' || (e->>'status'), ',' order by e->>'email')
       from jsonb_array_elements(v_got->'team') e where e->>'email' like 'issue3802x-%'),
    'issue3802x-admin@test.local=admin/active,issue3802x-growth@test.local=growth/active,issue3802x-invited@test.local=growth/invited,issue3802x-owner@test.local=owner/active,issue3802x-partner@test.local=partner/active,issue3802x-unconf@test.local=growth/active');
  perform pg_temp.x_like('XA-14', 'a revoked person cannot be made an owner of a card',
    pg_temp.x_as('partner', format($$select public.crm_record_set_owners(%L, array['issue3802x-revoked@test.local'])::text$$, v_id)), 'ERR:22023:unknown_owner:%');
  perform pg_temp.x_like('XA-14', 'an outsider cannot be made an owner of a card',
    pg_temp.x_as('partner', format($$select public.crm_record_set_owners(%L, array['issue3802x-consumer@test.local'])::text$$, v_id)), 'ERR:22023:unknown_owner:%');
  perform pg_temp.x_like('XA-14', 'more than ten owners is refused',
    pg_temp.x_as('partner', format($$select public.crm_record_set_owners(%L, (select array_agg('p' || g || '@test.local') from generate_series(1, 11) g))::text$$, v_id)),
    'ERR:22023:too_many_owners:%');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-15 — the audit trail.
-- ---------------------------------------------------------------------------
do $t$
declare
  c_mark constant text := 'ZXSENTINEL3802';
  v_id text;
  v_n int;
  v_step text;
  v_sql text;
  v_action text;
  v_steps text[][];
begin
  v_n := pg_temp.x_audit();
  v_id := pg_temp.x_as('partner', $$select public.crm_record_create('creators', '{"name":"@issue3802x_audit"}', 'xaudit-00001')->'record'->>'id'$$);
  perform pg_temp.x_eq('XA-15', 'create: one audit row', (pg_temp.x_audit() - v_n)::text, '1');
  v_steps := array[
    array['update',     format($$select public.crm_record_update(%L, '{"agreement":"signed","followers":1200}')::text$$, v_id), 'crm.record_update', '1'],
    array['update same',format($$select public.crm_record_update(%L, '{"agreement":"signed","followers":"1200"}')::text$$, v_id), '', '0'],
    array['move',       format($$select public.crm_record_move_stage(%L, 'booked')::text$$, v_id), 'crm.stage_move', '1'],
    array['move same',  format($$select public.crm_record_move_stage(%L, 'booked')::text$$, v_id), '', '0'],
    array['owners',     format($$select public.crm_record_set_owners(%L, array['issue3802x-growth@test.local','issue3802x-partner@test.local'])::text$$, v_id), 'crm.owners_set', '1'],
    array['owners same',format($$select public.crm_record_set_owners(%L, array[' ISSUE3802X-PARTNER@test.local ','issue3802x-growth@test.local','issue3802x-growth@test.local'])::text$$, v_id), '', '0'],
    array['note',       format($$select public.crm_record_log(%L, '{"kind":"note","body":"%s said hello"}', 'xaudit-00002')::text$$, v_id, c_mark), 'crm.log_add', '1'],
    array['note again', format($$select public.crm_record_log(%L, '{"kind":"note","body":"%s said hello"}', 'xaudit-00002')::text$$, v_id, c_mark), '', '0'],
    array['touch',      format($$select public.crm_record_log(%L, '{"kind":"touch","channel":"instagram_dm","direction":"inbound","reply_class":"interested","body":"%s","message_ref":"https://example.test/%s"}', 'xaudit-00003')::text$$, v_id, c_mark, c_mark), 'crm.log_add', '1'],
    array['create again', $$select public.crm_record_create('creators', '{"name":"@issue3802x_audit"}', 'xaudit-00001')::text$$, '', '0'],
    array['create dup', $$select public.crm_record_create('creators', '{"name":"issue3802x audit"}', 'xaudit-00004')::text$$, '', '0']];
  for i in 1 .. array_length(v_steps, 1) loop
    v_n := pg_temp.x_audit();
    v_step := pg_temp.x_as('partner', v_steps[i][2]);
    perform pg_temp.x_ok('XA-15', v_steps[i][1] || ': answered', v_step not like 'ERR:%', v_step);
    perform pg_temp.x_eq('XA-15', v_steps[i][1] || ': audit rows added', (pg_temp.x_audit() - v_n)::text, v_steps[i][4]);
    if v_steps[i][4] = '1' then
      perform pg_temp.x_eq('XA-15', v_steps[i][1] || ': recorded under the real person and account',
        (select action || '|' || admin_email || '|' || actor_uid::text || '|' || target_type || '|' || target_id
           from public.admin_audit_log where action like 'crm.%' order by created_at desc, id desc limit 1),
        v_steps[i][3] || '|issue3802x-partner@test.local|38021111-0000-4000-a000-000000000004|crm_record|' || v_id);
    end if;
  end loop;
  perform pg_temp.x_eq('XA-15', 'what was said is in the log',
    (select count(*)::text from public.crm_activity where record_id = v_id::uuid and (body like '%' || c_mark || '%' or message_ref like '%' || c_mark || '%')), '2');
  perform pg_temp.x_eq('XA-15', 'what was said is nowhere in the audit trail',
    (select count(*)::text from public.admin_audit_log where metadata::text like '%' || c_mark || '%' or coalesce(reason, '') like '%' || c_mark || '%'), '0');
  perform pg_temp.x_eq('XA-15', 'the touch keeps its parts apart',
    (select channel || '|' || direction || '|' || reply_class || '|' || (message_ref like 'https://example.test/%')::text
       from public.crm_activity where record_id = v_id::uuid and kind = 'touch'), 'instagram_dm|inbound|interested|true');

  -- A team member whose session claims carry someone else's address is
  -- still recorded, and treated, as themselves.
  v_n := pg_temp.x_audit();
  perform pg_temp.x_eq('XA-15', 'claims naming the owner do not change who the person is',
    pg_temp.x_as('forged', $$select (c->'me'->>'email') || '|' || (c->'me'->>'role') || '|' || (c->'me'->>'can_delete') from public.crm_config() c$$),
    'issue3802x-growth@test.local|growth|false');
  perform pg_temp.x_eq('XA-15', 'a write under such claims is logged under the real person',
    pg_temp.x_as('forged', format($$select public.crm_record_log(%L, '{"kind":"note","body":"claims test"}', 'xaudit-00009')->'activity'->>'actor_email'$$, v_id)),
    'issue3802x-growth@test.local');
  perform pg_temp.x_eq('XA-15', 'and audited under the real person and account',
    (select admin_email || '|' || actor_uid::text from public.admin_audit_log where action like 'crm.%' order by created_at desc, id desc limit 1)
      || '|' || (pg_temp.x_audit() - v_n)::text,
    'issue3802x-growth@test.local|38021111-0000-4000-a000-000000000003|1');
  perform pg_temp.x_like('XA-15', 'such claims do not open delete',
    pg_temp.x_as('forged', format('select public.crm_record_delete(%L)::text', v_id)), 'ERR:42501:forbidden%');

  -- Every pipeline audit row this suite caused names a real team person with
  -- their own account, or the system with none.
  perform pg_temp.x_eq('XA-15', 'no pipeline audit row has an actor that is not the caller',
    (select count(*)::text from public.admin_audit_log l
      where l.action like 'crm.%'
        and not (l.admin_email = 'system' and l.actor_uid is null)
        and not exists (select 1 from x_people p where p.email = l.admin_email and p.id = l.actor_uid
                           and p.who in ('owner', 'admin', 'growth', 'partner'))), '0');
  perform pg_temp.x_eq('XA-15', 'the system is the actor only for automatic Live moves',
    (select coalesce(string_agg(distinct action, ','), 'crm.stage_auto_live') from public.admin_audit_log where action like 'crm.%' and admin_email = 'system'),
    'crm.stage_auto_live');

  -- The two new roles cannot write or change the trail themselves.
  v_n := (select count(*) from public.admin_audit_log);
  perform pg_temp.x_like('XA-15', 'growth cannot add an audit row by hand',
    pg_temp.x_as('growth', $$insert into public.admin_audit_log (admin_email, action, target_type, target_id)
                             values ('issue3802x-owner@test.local', 'crm.record_delete', 'crm_record', 'x') returning 'added'$$), 'ERR:42501:%');
  perform pg_temp.x_ok('XA-15', 'partner cannot change an audit row by hand',
    pg_temp.x_as('partner', $$with u as (update public.admin_audit_log set admin_email = 'issue3802x-owner@test.local' where action like 'crm.%' returning 1) select count(*)::text from u$$) ~ '^(0|ERR:42501:.*)$');
  perform pg_temp.x_ok('XA-15', 'partner cannot remove an audit row by hand',
    pg_temp.x_as('partner', $$with d as (delete from public.admin_audit_log where action like 'crm.%' returning 1) select count(*)::text from d$$) ~ '^(0|ERR:42501:.*)$');
  perform pg_temp.x_ok('XA-15', 'partner cannot read the audit trail by hand',
    pg_temp.x_as('partner', $$select count(*)::text from public.admin_audit_log where action like 'crm.%'$$) ~ '^(0|ERR:42501:.*)$');
  perform pg_temp.x_eq('XA-15', 'the audit trail has the same number of rows', (select count(*)::text from public.admin_audit_log), v_n::text);
end;
$t$;

-- ===========================================================================
-- RETEST additions (XA-16..XA-21). Added after the pipeline rules were
-- tightened; nothing above this line was changed for them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- XA-16 — a host is in Live only while its linked brand has a public listing,
-- on every write that touches the stage or the link.
-- ---------------------------------------------------------------------------
do $t$
declare
  b record;
  v_id uuid;
  v_got jsonb;
  v_txt text;
  v_act text;
  v_snap text;
  v_audit int;
  v_first timestamptz;
begin
  -- Listings with "discover" visibility, and one public listing whose
  -- ordinary reads are being withheld.
  perform set_config('session_replication_role', 'replica', true);
  insert into x_brands values
    ('disc_scheduled', '38021111-0000-4000-b000-0000000000d1', true,  false),
    ('disc_live',      '38021111-0000-4000-b000-0000000000d2', true,  false),
    ('disc_draft',     '38021111-0000-4000-b000-0000000000d3', false, false),
    ('disc_ended',     '38021111-0000-4000-b000-0000000000d4', false, false),
    ('disc_cancelled', '38021111-0000-4000-b000-0000000000d5', false, false),
    ('disc_deleted',   '38021111-0000-4000-b000-0000000000d6', false, false),
    ('pub_withheld',   '38021111-0000-4000-b000-0000000000d7', false, false);
  insert into public.brands (id, account_id, name, slug, city)
  select id, '38021111-0000-4000-b900-000000000001', 'Issue3802x Brand ' || k, 'issue3802x-' || replace(k, '_', '-'), 'Lagos'
    from x_brands where k like 'disc\_%' or k = 'pub_withheld';
  insert into public.events (brand_id, title, slug, visibility, status, deleted_at)
  select x.id, 'Issue3802x ' || x.k, 'issue3802x-ev-' || replace(x.k, '_', '-'), v.vis, v.st, v.del
    from x_brands x join (values
      ('disc_scheduled', 'discover', 'scheduled', null::timestamptz),
      ('disc_live',      'discover', 'live',      null),
      ('disc_draft',     'discover', 'draft',     null),
      ('disc_ended',     'discover', 'ended',     null),
      ('disc_cancelled', 'discover', 'cancelled', null),
      ('disc_deleted',   'discover', 'scheduled', now()),
      ('pub_withheld',   'public',   'scheduled', null)) as v(k, vis, st, del) on v.k = x.k;
  insert into public.event_private_media_transition_jobs
    (transition_id, event_id, direction, target_visibility, state, expected_event_updated_at, source_fingerprint, ordinary_read_blocked_at)
  select gen_random_uuid(), e.id, 'enter_private', 'private', 'preparing', now(), repeat('a', 64), now()
    from public.events e where e.brand_id = pg_temp.x_brand('pub_withheld')::uuid;
  perform set_config('session_replication_role', 'origin', true);
  -- Earlier sections moved two fixtures; put the two this section relies on back.
  perform set_config('session_replication_role', 'replica', true);
  update public.events set status = 'scheduled', visibility = 'public' where brand_id = pg_temp.x_brand('pub_scheduled')::uuid;
  update public.events set visibility = 'private' where brand_id = pg_temp.x_brand('private')::uuid;
  perform set_config('session_replication_role', 'origin', true);

  for b in select * from x_brands where k like 'disc\_%' or k = 'pub_withheld' order by k loop
    perform pg_temp.x_eq('XA-16', 'rule for a brand whose listing is: ' || b.k, public.crm_brand_is_live(b.id)::text, b.live::text);
    perform pg_temp.x_eq('XA-16', 'a new host linked to [' || b.k || '] lands in',
      pg_temp.x_as('partner', format($$select public.crm_record_create('hosts', %L, %L)->'record'->>'stage'$$,
        jsonb_build_object('name', 'Issue3802x Disc ' || b.k, 'brand_id', b.id)::text, 'xdisc-' || rpad(replace(b.k, '_', '-'), 14, '0'))),
      case when b.live then 'live' else 'onboarded' end);
  end loop;
  perform pg_temp.x_eq('XA-16', 'a signed-out visitor cannot read the withheld public listing either',
    pg_temp.x_as('anon', format('select exists (select 1 from public.events_public_view e where e.brand_id = %L)::text', pg_temp.x_brand('pub_withheld'))), 'false');
  perform pg_temp.x_eq('XA-16', 'the scheduled run promotes none of the hosts just linked to a listing that is not public',
    pg_temp.x_as('cron', $$select count(*)::text from public.crm_records r where r.name like 'Issue3802x Disc %' and r.stage = 'onboarded'
                             and public.crm_reconcile_live(r.id) > 0$$), '0');

  -- A Live host whose link is changed: Live only where the new brand has a
  -- public listing, Onboarded otherwise, with one system line saying so.
  for b in select * from x_brands where k <> 'brand_deleted' order by k loop
    v_id := pg_temp.x_seed('relink', 'hosts', 'Issue3802x Relink ' || b.k, 'prospect');
    perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id,
      jsonb_build_object('brand_id', pg_temp.x_brand('venue'))::text));
    select went_live_at into v_first from public.crm_records where id = v_id and stage = 'live';
    v_audit := pg_temp.x_audit();
    v_got := pg_temp.x_as('partner', format($$select public.crm_record_update(%L, %L)::text$$, v_id,
      jsonb_build_object('brand_id', b.id)::text))::jsonb;
    perform pg_temp.x_eq('XA-16', 'a Live host re-linked to [' || b.k || '] is then in',
      (v_got->'record'->>'stage') || '/' || coalesce(v_got->>'moved_to', '<none>'),
      case when b.k = 'venue' then 'live/<none>' when b.live then 'live/<none>' else 'onboarded/onboarded' end);
    perform pg_temp.x_eq('XA-16', '[' || b.k || '] the stored stage agrees, and the first went-live time is kept',
      (select stage || '/' || (went_live_at = v_first)::text from public.crm_records where id = v_id),
      case when b.live then 'live/true' else 'onboarded/true' end);
    perform pg_temp.x_eq('XA-16', '[' || b.k || '] system lines back out of Live',
      (select count(*)::text from public.crm_activity where record_id = v_id and from_stage = 'live' and to_stage = 'onboarded'
          and actor_email is null and via = 'system'), case when b.live then '0' else '1' end);
    if b.k <> 'venue' then
      perform pg_temp.x_eq('XA-16', '[' || b.k || '] the edit is one audit row under the person',
        (pg_temp.x_audit() - v_audit)::text || ':' || (select admin_email from public.admin_audit_log where action like 'crm.%' order by created_at desc, id desc limit 1),
        '1:issue3802x-partner@test.local');
    end if;
    perform pg_temp.x_ok('XA-16', '[' || b.k || '] never Live without a linked brand that has a public listing',
      (select r.stage <> 'live' or public.crm_brand_is_live(r.brand_id) from public.crm_records r where r.id = v_id));
  end loop;

  -- Clearing the link, by every spelling of "nothing".
  foreach v_txt in array array['{"brand_id":null}', '{"brand_id":""}', '{"brand_id":"   "}'] loop
    v_id := pg_temp.x_seed('unlink', 'hosts', 'Issue3802x Unlink ' || md5(v_txt), 'prospect');
    perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('pub_live'))::text));
    perform pg_temp.x_eq('XA-16', 'clearing the link of a Live host with ' || v_txt,
      pg_temp.x_as('growth', format($$select (r->'record'->>'stage') || '/' || (r->>'moved_to') || '/' || coalesce(r->'record'->>'brand_id', '<none>')
                                        from public.crm_record_update(%L, %L) r$$, v_id, v_txt)), 'onboarded/onboarded/<none>');
  end loop;
  v_snap := pg_temp.x_snap();
  perform pg_temp.x_like('XA-16', 'a Live host cannot be pointed at a deleted brand',
    pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, pg_temp.x_id('relink'),
      jsonb_build_object('brand_id', pg_temp.x_brand('brand_deleted'))::text)), 'ERR:22023:invalid_brand:%');
  perform pg_temp.x_eq('XA-16', 'and nothing changed', pg_temp.x_snap(), v_snap);

  -- Edits that do not touch the link never move a Live host, even after its
  -- listing has gone away; nor does sending the same link again.
  v_id := pg_temp.x_seed('lapse', 'hosts', 'Issue3802x Lapse', 'prospect');
  perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('disc_live'))::text));
  perform set_config('session_replication_role', 'replica', true);
  update public.events set status = 'ended' where brand_id = pg_temp.x_brand('disc_live')::uuid;
  perform set_config('session_replication_role', 'origin', true);
  perform pg_temp.x_eq('XA-16', 'the listing is gone now', public.crm_brand_is_live(pg_temp.x_brand('disc_live')::uuid)::text, 'false');
  perform pg_temp.x_eq('XA-16', 'an unrelated edit leaves the host in Live',
    pg_temp.x_as('partner', format($$select public.crm_record_update(%L, '{"contact":"Ada","next_action":"call"}')->'record'->>'stage'$$, v_id)), 'live');
  perform pg_temp.x_eq('XA-16', 'sending the same link again changes nothing',
    pg_temp.x_as('partner', format($$select (r->>'changed') || '/' || (r->'record'->>'stage') from public.crm_record_update(%L, %L) r$$, v_id,
      jsonb_build_object('brand_id', pg_temp.x_brand('disc_live'))::text)), 'false/live');
  perform pg_temp.x_eq('XA-16', 'the scheduled run does not take Live away', 
    pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text') || '/' || (select stage from public.crm_records where id = v_id), '0/live');
  -- ...but an undo is a write that puts it back into Live, so the rule is
  -- checked at that moment.
  v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'lost', 'closed')->>'activity_id'$$, v_id));
  v_snap := pg_temp.x_snap();
  v_audit := pg_temp.x_audit();
  perform pg_temp.x_like('XA-16', 'undo back into Live is refused once the listing is gone',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_not_live:%');
  perform pg_temp.x_eq('XA-16', 'the refused undo changed nothing and wrote no audit row',
    (pg_temp.x_snap() = v_snap)::text || '/' || (pg_temp.x_audit() - v_audit)::text, 'true/0');

  -- Undo back into Live, link by link.
  v_id := pg_temp.x_seed('undo_link', 'hosts', 'Issue3802x Undo Link', 'prospect');
  perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('pub_live'))::text));
  v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'lost', 'closed')->>'activity_id'$$, v_id));
  perform pg_temp.x_eq('XA-16', 'clearing the link of a Lost host leaves it Lost',
    pg_temp.x_as('growth', format($$select (r->'record'->>'stage') || '/' || coalesce(r->>'moved_to', '<none>') from public.crm_record_update(%L, '{"brand_id":null}') r$$, v_id)), 'lost/<none>');
  perform pg_temp.x_like('XA-16', 'undo into Live with no linked brand is refused',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_not_live:%');
  perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('none'))::text));
  perform pg_temp.x_like('XA-16', 'undo into Live with a brand that has no listing is refused',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_not_live:%');
  perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('private'))::text));
  perform pg_temp.x_like('XA-16', 'undo into Live with a brand whose listing is private is refused',
    pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:undo_not_live:%');
  perform pg_temp.x_eq('XA-16', 'it is still Lost with its reason',
    (select stage || ':' || stage_reason from public.crm_records where id = v_id), 'lost:closed');
  perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, v_id, jsonb_build_object('brand_id', pg_temp.x_brand('disc_scheduled'))::text));
  perform pg_temp.x_eq('XA-16', 'undo into Live works once the linked brand has a public listing',
    pg_temp.x_as('growth', format($$select public.crm_record_undo_stage_move(%L)->'record'->>'stage'$$, v_act)), 'live');

  -- After every route above: the rule holds for every host a function wrote,
  -- except where only the listing changed afterwards.
  perform pg_temp.x_eq('XA-16', 'no host is in Live without a linked brand',
    (select count(*)::text from public.crm_records where stage = 'live' and brand_id is null), '0');
  -- (disc_live lapsed above; the "private" brand's listing was public for a
  -- while in XA-10 and its host was promoted then.)
  perform pg_temp.x_eq('XA-16', 'every Live host with no public listing is one whose listing lapsed in this suite',
    (select coalesce(string_agg(distinct x.k, ',' order by x.k), '<none>') from public.crm_records r join x_brands x on x.id = r.brand_id
      where r.stage = 'live' and r.deleted_at is null and not public.crm_brand_is_live(r.brand_id)), 'disc_live,private');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-17 — a creator is at Booked or later only with a signed agreement, by
-- every route: a move from any stage (skips included), an edit, an undo, an
-- add, a bulk add.
-- ---------------------------------------------------------------------------
do $t$
declare
  c_stages constant text[] := array['identified','contacted','replied','negotiating','booked','posted','passed'];
  v_from text;
  v_to text;
  v_agree text;
  v_who text;
  v_id uuid;
  v_got text;
  v_want text;
  v_act text;
  v_n int := 0;
  v_snap text;
  v_audit int;
  v_stage text;
begin
  -- Moves into Booked and into Posted, from every stage, with every agreement.
  foreach v_from in array c_stages loop
    foreach v_to in array array['booked', 'posted'] loop
      foreach v_agree in array array['<none>', 'none', 'sent', 'signed'] loop
        v_n := v_n + 1;
        v_who := (array['growth','partner','admin','owner'])[1 + v_n % 4];
        v_id := pg_temp.x_seed('agr', 'creators', '@issue3802x_agr_' || v_n, v_from, null, nullif(v_agree, '<none>'));
        v_snap := pg_temp.x_snap();
        v_got := pg_temp.x_as(v_who, format('select public.crm_record_move_stage(%L, %L)::text', v_id, v_to));
        v_want := case when v_from = v_to then 'same' when v_agree = 'signed' then 'ok' else 'agreement_required' end;
        perform pg_temp.x_eq('XA-17', format('%s -> %s with agreement [%s] as %s', v_from, v_to, v_agree, v_who),
          case when v_got like 'ERR:22023:agreement_required:%' then 'agreement_required'
               when v_got like 'ERR:%' then left(v_got, 60)
               when (v_got::jsonb->>'changed') = 'true' then 'ok' else 'same' end
            || '/' || (select stage from public.crm_records where id = v_id),
          v_want || '/' || case when v_want = 'ok' then v_to else v_from end);
        if v_want <> 'ok' then
          perform pg_temp.x_eq('XA-17', format('%s -> %s [%s] wrote nothing', v_from, v_to, v_agree), pg_temp.x_snap(), v_snap);
        end if;
        delete from public.crm_records where id = v_id;
      end loop;
    end loop;
  end loop;
  perform pg_temp.x_eq('XA-17', 'move cases walked', v_n::text, '56');

  -- While there, the agreement cannot become anything but signed; before and
  -- after (Passed) it can.
  foreach v_stage in array c_stages loop
    v_id := pg_temp.x_seed('agr_edit', 'creators', '@issue3802x_agr_edit_' || v_stage, v_stage, null, 'signed');
    foreach v_agree in array array['"none"', '"sent"', 'null', '""', '"  "'] loop
      v_snap := pg_temp.x_snap();
      v_got := pg_temp.x_as('partner', format($$select public.crm_record_update(%L, %L)->'record'->>'stage'$$, v_id, '{"agreement":' || v_agree || '}'));
      if v_stage in ('booked', 'posted') then
        perform pg_temp.x_like('XA-17', format('at %s the agreement cannot become %s', v_stage, v_agree), v_got, 'ERR:22023:agreement_required:%');
        perform pg_temp.x_eq('XA-17', format('at %s, %s wrote nothing', v_stage, v_agree), pg_temp.x_snap(), v_snap);
      else
        perform pg_temp.x_eq('XA-17', format('at %s the agreement can become %s', v_stage, v_agree), v_got, v_stage);
        update public.crm_records set agreement = 'signed' where id = v_id;
      end if;
    end loop;
    perform pg_temp.x_eq('XA-17', format('at %s other fields are still editable', v_stage),
      pg_temp.x_as('partner', format($$select (r->>'changed') || '/' || (r->'record'->>'agreement') from public.crm_record_update(%L, '{"rate":"200 per post","followers":900,"agreement":"signed"}') r$$, v_id)),
      'true/signed');
  end loop;

  -- Undo back into Booked or Posted needs it at that moment.
  foreach v_stage in array array['booked', 'posted'] loop
    v_id := pg_temp.x_seed('agr_undo', 'creators', '@issue3802x_agr_undo_' || v_stage, v_stage, null, 'signed');
    v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'negotiating')->>'activity_id'$$, v_id));
    perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, '{"agreement":"sent"}')::text$$, v_id));
    v_snap := pg_temp.x_snap();
    v_audit := pg_temp.x_audit();
    perform pg_temp.x_like('XA-17', 'undo back into ' || v_stage || ' without a signed agreement is refused',
      pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:agreement_required:%');
    perform pg_temp.x_eq('XA-17', 'the refused undo into ' || v_stage || ' changed nothing',
      (pg_temp.x_snap() = v_snap)::text || '/' || (pg_temp.x_audit() - v_audit)::text, 'true/0');
    perform pg_temp.x_as('growth', format($$select public.crm_record_update(%L, '{"agreement":"signed"}')::text$$, v_id));
    perform pg_temp.x_eq('XA-17', 'with it signed again the undo into ' || v_stage || ' works',
      pg_temp.x_as('growth', format($$select public.crm_record_undo_stage_move(%L)->'record'->>'stage'$$, v_act)), v_stage);

    -- Out to Passed, unsign there (allowed), undo: refused.
    v_act := pg_temp.x_as('growth', format($$select public.crm_record_move_stage(%L, 'passed', 'went quiet')->>'activity_id'$$, v_id));
    perform pg_temp.x_eq('XA-17', 'in Passed the agreement may be cleared',
      pg_temp.x_as('growth', format($$select coalesce(public.crm_record_update(%L, '{"agreement":null}')->'record'->>'agreement', '<none>')$$, v_id)), '<none>');
    perform pg_temp.x_like('XA-17', 'undo from Passed back into ' || v_stage || ' without it is refused',
      pg_temp.x_as('growth', format('select public.crm_record_undo_stage_move(%L)::text', v_act)), 'ERR:22023:agreement_required:%');
    perform pg_temp.x_eq('XA-17', 'it stays in Passed with its reason',
      (select stage || ':' || stage_reason from public.crm_records where id = v_id), 'passed:went quiet');
  end loop;

  -- An add never starts there, whatever is sent.
  perform pg_temp.x_eq('XA-17', 'a new creator with a signed agreement starts in the first stage',
    pg_temp.x_as('growth', $$select public.crm_record_create('creators', '{"name":"@issue3802x_agr_new","agreement":"signed"}', 'xagr-new-0001')->'record'->>'stage'$$), 'identified');
  perform pg_temp.x_eq('XA-17', 'bulk-added creators with a signed agreement start in the first stage',
    pg_temp.x_as('growth', $$select string_agg(distinct e->'record'->>'stage', ',') from jsonb_array_elements(public.crm_records_bulk_create('creators',
      '[{"name":"@issue3802x_agr_b1","agreement":"signed"},{"name":"@issue3802x_agr_b2","agreement":"signed","followers":10}]', 'xagr-new-0002')->'created') e$$), 'identified');
  perform pg_temp.x_like('XA-17', 'an add cannot name the stage',
    pg_temp.x_as('growth', $$select public.crm_record_create('creators', '{"name":"@issue3802x_agr_x","agreement":"signed","stage":"posted"}', 'xagr-new-0003')::text$$), 'ERR:22023:unknown_field:%');

  perform pg_temp.x_eq('XA-17', 'no creator a function wrote sits at Booked or Posted without a signed agreement',
    (select count(*)::text from public.crm_records where pipeline = 'creators' and stage in ('booked', 'posted') and agreement is distinct from 'signed'), '0');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-18 — names. What this suite holds the functions to:
--   * letters and digits of any script, and emoji (alone too), are names;
--   * every kind of blank space is one space, and the ends are trimmed;
--   * characters that only steer direction or cannot be seen are removed, so
--     they never make a second record or an empty-looking card;
--   * a name with nothing visible left is refused in plain words.
-- ---------------------------------------------------------------------------
do $t$
declare
  r record;
  v_got text;
  v_id text;
  v_snap text;
begin
  -- Refused, each with the function's own message (never a table error).
  v_snap := pg_temp.x_snap();
  for r in select * from (values
      ('empty', ''), ('spaces', '    '), ('tab and newline', E'\t\n\r'),
      ('no-break space', U&'\00A0'), ('wide space', U&'\3000'), ('thin spaces', U&'\2009\200A\2003'),
      ('zero-width space', U&'\200B'), ('zero-width joiners', U&'\200D\200C'), ('word joiner', U&'\2060'),
      ('byte-order mark', U&'\FEFF'), ('soft hyphen', U&'\00AD'), ('direction marks', U&'\200E\200F'),
      ('direction overrides', U&'\202A\202B\202C\202D\202E'), ('direction isolates', U&'\2066\2067\2068\2069'),
      ('variation marks', U&'\FE0F\FE0E'), ('blank filler', U&'\3164'), ('line separators', U&'\2028\2029'),
      ('a mix of all of them', U&'\00A0\200B \FEFF\202E\3000\200D\FE0F\00AD')) as t(label, name) loop
    perform pg_temp.x_like('XA-18', 'add refuses a name that is only: ' || r.label,
      pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, %L)::text$$,
        jsonb_build_object('name', r.name)::text, 'xname-r-' || md5(r.label))), 'ERR:22023:invalid_name:%');
    perform pg_temp.x_like('XA-18', 'rename refuses a name that is only: ' || r.label,
      pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, pg_temp.x_id('gate'),
        jsonb_build_object('name', r.name)::text)), 'ERR:22023:invalid_name:%');
  end loop;
  perform pg_temp.x_eq('XA-18', 'no refused name wrote anything', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_like('XA-18', 'a bulk item with an unseen name is listed as invalid, in plain words',
    pg_temp.x_as('growth', format($$select public.crm_records_bulk_create('hosts', %L, 'xname-bulk-001')->'invalid'->0->>'error'$$,
      jsonb_build_array(jsonb_build_object('name', U&'\200B\00A0'))::text)), 'invalid_name:%');

  -- Allowed, and stored clean.
  for r in select * from (values
      ('emoji alone',            U&'\+01F525',                                 U&'\+01F525'),
      ('an emoji family',        U&'\+01F468\200D\+01F469\200D\+01F467',       U&'\+01F468\200D\+01F469\200D\+01F467'),
      ('Arabic',                 U&'\0645\0637\0639\0645 \0627\0644\0646\062E\0644\0629', U&'\0645\0637\0639\0645 \0627\0644\0646\062E\0644\0629'),
      ('Yoruba with tone marks', U&'Il\00E9 \1ECCj\00E0',                      U&'Il\00E9 \1ECCj\00E0'),
      ('Japanese',               U&'\30AB\30D5\30A7',                          U&'\30AB\30D5\30A7'),
      ('mixed-width spaces',     U&'\3000Wide\2003\00A0Space\2009Bar\3000',    'Wide Space Bar'),
      ('direction override',     U&'\202EIssue3802x Flip\202C Name\200F',      'Issue3802x Flip Name'),
      ('zero-width inside',      U&'Issue3802x Zero\200BWidth\FEFF Name',      'Issue3802x ZeroWidth Name'),
      ('soft hyphen inside',     U&'Issue3802x Soft\00ADHyphen',               'Issue3802x SoftHyphen'),
      ('control characters',     E'Issue3802x \x01Ctrl\x1F Name',              'Issue3802x Ctrl Name'),
      ('line breaks',            E'Issue3802x\nTwo\r\nLines',                  'Issue3802x Two Lines')) as t(label, name, stored) loop
    v_got := pg_temp.x_as('partner', format($$select public.crm_record_create('hosts', %L, %L)->'record'->>'name'$$,
      jsonb_build_object('name', r.name)::text, 'xname-a-' || md5(r.label)));
    perform pg_temp.x_eq('XA-18', 'allowed and stored clean: ' || r.label, v_got, r.stored);
  end loop;

  -- The same name with unseen characters, other spaces or direction marks is
  -- the same record, on every path that compares names.
  for r in select * from (values
      ('plain',                      'issue3802x flip name'),
      ('with direction marks',       U&'\200FIssue3802x\202E Flip Name'),
      ('with zero-width characters', U&'I\200Bssue3802x F\200Dlip N\FEFFame'),
      ('with wide spaces',           U&'Issue3802x\3000Flip\00A0\2003Name'),
      ('with a soft hyphen',         U&'Issue3802x Fl\00ADip Name')) as t(label, name) loop
    perform pg_temp.x_eq('XA-18', 'add finds the existing record: ' || r.label,
      pg_temp.x_as('growth', format($$select (r->>'status') || ':' || (r->'existing'->>'name') from public.crm_record_create('hosts', %L, %L) r$$,
        jsonb_build_object('name', r.name)::text, 'xname-d-' || md5(r.label))), 'duplicate:Issue3802x Flip Name');
    perform pg_temp.x_eq('XA-18', 'the duplicate check finds it too: ' || r.label,
      pg_temp.x_as('growth', format($$select public.crm_duplicate_check('hosts', %L)->'exact'->>'name'$$, r.name)), 'Issue3802x Flip Name');
    perform pg_temp.x_like('XA-18', 'rename into it is refused: ' || r.label,
      pg_temp.x_as('growth', format($$select public.crm_record_update(%L, %L)::text$$, pg_temp.x_id('gate'),
        jsonb_build_object('name', r.name)::text)), 'ERR:22023:duplicate_name:%');
  end loop;
  perform pg_temp.x_eq('XA-18', 'an emoji with and without its variation mark is one record',
    pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, 'xname-e-000001')->>'status'$$, jsonb_build_object('name', U&'\2764\FE0F')::text))
    || '/' || pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, 'xname-e-000002')->>'status'$$, jsonb_build_object('name', U&'\2764')::text)),
    'created/duplicate');

  -- Length is counted after cleaning.
  perform pg_temp.x_eq('XA-18', '160 visible characters padded with unseen ones is accepted',
    pg_temp.x_as('growth', format($$select char_length(public.crm_record_create('hosts', %L, 'xname-l-000001')->'record'->>'name')::text$$,
      jsonb_build_object('name', U&'\200B\00A0' || 'Issue3802x ' || repeat('n', 149) || U&'\3000\FEFF')::text)), '160');
  perform pg_temp.x_like('XA-18', '161 visible characters is refused',
    pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, 'xname-l-000002')::text$$,
      jsonb_build_object('name', 'Issue3802x ' || repeat('m', 150))::text)), 'ERR:22023:invalid_name:%');

  -- Other text fields get the same cleaning; an unseen-only value is "not sent".
  v_id := pg_temp.x_as('growth', format($$select public.crm_record_create('hosts', %L, 'xname-f-000001')->'record'->>'id'$$,
    jsonb_build_object('name', 'Issue3802x Field Clean', 'contact', U&'\202EAda\200B  \3000Obi\00A0', 'next_action', U&'\200B\FEFF')::text));
  perform pg_temp.x_eq('XA-18', 'contact is stored clean, and an unseen-only next action is empty',
    (select contact || '/' || coalesce(next_action, '<none>') from public.crm_records where id = v_id::uuid), 'Ada Obi/<none>');
  perform pg_temp.x_eq('XA-18', 'every stored name in this suite is trimmed and has no unseen character',
    (select count(*)::text from public.crm_records where name <> btrim(name) or name ~ '[​‎‏‪-‮⁠-⁯﻿ ­　]' or name ~ '\s{2,}'), '0');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-19 — the time a log entry happened, and the reason of a move, are
-- checked in plain words.
-- ---------------------------------------------------------------------------
do $t$
declare
  r record;
  v_id text := pg_temp.x_id('gate');
  v_got text;
  v_snap text;
  v_n int := 0;
begin
  v_snap := pg_temp.x_snap();
  for r in select * from (values
      ('-infinity'), ('infinity'), ('epoch'), ('1999-12-31T23:59:59Z'), ('2019-12-31T23:59:59Z'), ('2019-12-31T23:59:59.999999+00'),
      ('2020-01-01T00:00:00+14'), ('0001-01-01T00:00:00Z'), ('4713-01-01 BC'), ('tomorrow'), ('2999-01-01T00:00:00Z'),
      ('not a time'), ('2026-02-30T10:00:00Z'), ('allballs'), ('1e10'), ('{}')) as t(v) loop
    v_n := v_n + 1;
    perform pg_temp.x_like('XA-19', 'a log entry refuses the time [' || r.v || ']',
      pg_temp.x_as('growth', format($$select public.crm_record_log(%L, %L, %L)::text$$, v_id,
        jsonb_build_object('kind', 'note', 'body', 'x', 'occurred_at', r.v)::text, 'xtime-r-' || lpad(v_n::text, 4, '0'))), 'ERR:22023:invalid_occurred_at:%');
  end loop;
  perform pg_temp.x_like('XA-19', 'six minutes ahead is refused',
    pg_temp.x_as('growth', format($$select public.crm_record_log(%L, %L, 'xtime-r-ahead6')::text$$, v_id,
      jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'occurred_at', (clock_timestamp() + interval '6 minutes'))::text)), 'ERR:22023:invalid_occurred_at:%');
  perform pg_temp.x_eq('XA-19', 'no refused time wrote anything', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-19', 'the first moment of 2020 (UTC) is accepted',
    pg_temp.x_as('growth', format($$select ((public.crm_record_log(%L, '{"kind":"note","body":"x","occurred_at":"2020-01-01T00:00:00Z"}', 'xtime-a-000001')->'activity'->>'occurred_at')::timestamptz = '2020-01-01T00:00:00Z')::text$$, v_id)), 'true');
  perform pg_temp.x_eq('XA-19', 'the same moment written in another zone is accepted',
    pg_temp.x_as('growth', format($$select ((public.crm_record_log(%L, '{"kind":"note","body":"x","occurred_at":"2020-01-01T01:00:00+01:00"}', 'xtime-a-000002')->'activity'->>'occurred_at')::timestamptz = '2020-01-01T00:00:00Z')::text$$, v_id)), 'true');
  perform pg_temp.x_ok('XA-19', 'four minutes ahead is accepted',
    pg_temp.x_as('growth', format($$select public.crm_record_log(%L, %L, 'xtime-a-000003')::text$$, v_id,
      jsonb_build_object('kind', 'note', 'body', 'x', 'occurred_at', (clock_timestamp() + interval '4 minutes'))::text)) like '{%');
  perform pg_temp.x_eq('XA-19', 'no stored log time is outside the window',
    (select count(*)::text from public.crm_activity where occurred_at < '2020-01-01T00:00:00Z' or occurred_at > clock_timestamp() + interval '5 minutes' or not isfinite(occurred_at)), '0');

  -- A note of unseen characters only is no note; a note keeps its line breaks.
  perform pg_temp.x_like('XA-19', 'a note with nothing visible is refused',
    pg_temp.x_as('growth', format($$select public.crm_record_log(%L, %L, 'xnote-r-000001')::text$$, v_id,
      jsonb_build_object('kind', 'note', 'body', U&'\200B\00A0\FEFF  \3000')::text)), 'ERR:22023:invalid_body:%');
  perform pg_temp.x_eq('XA-19', 'a note keeps its line breaks and loses its unseen characters',
    pg_temp.x_as('growth', format($$select public.crm_record_log(%L, %L, 'xnote-a-000001')->'activity'->>'body'$$, v_id,
      jsonb_build_object('kind', 'note', 'body', E'  Line one​\nLine two 　')::text)), E'Line one\nLine two');

  -- The reason of a move to Lost or Passed.
  v_id := pg_temp.x_seed('reason', 'hosts', 'Issue3802x Reason Card', 'prospect')::text;
  v_snap := pg_temp.x_snap();
  for r in select * from (values
      ('nothing', null), ('empty', ''), ('spaces', '   '), ('no-break spaces', U&'\00A0\00A0'), ('zero-width only', U&'\200B\FEFF\200D'),
      ('direction marks only', U&'\202E\202C'), ('301 characters', repeat('r', 301)), ('301 after trimming', '  ' || repeat('r', 301) || '  ')) as t(label, v) loop
    perform pg_temp.x_like('XA-19', 'Lost refuses a reason that is: ' || r.label,
      pg_temp.x_as('partner', format('select public.crm_record_move_stage(%L, %L, %s)::text', v_id, 'lost', coalesce(quote_literal(r.v), 'null'))), 'ERR:22023:reason_required:%');
  end loop;
  perform pg_temp.x_eq('XA-19', 'no refused reason wrote anything', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-19', 'a reason is stored clean',
    pg_temp.x_as('partner', format('select public.crm_record_move_stage(%L, %L, %L)->%L->>%L', v_id, 'lost', U&'\00A0 Closed\200B  for\3000good \202E', 'record', 'stage_reason')), 'Closed for good');
  perform pg_temp.x_eq('XA-19', '300 characters padded with unseen ones is accepted',
    pg_temp.x_as('partner', format('select char_length(public.crm_record_move_stage(%L, %L, %L)->%L->>%L)::text',
      pg_temp.x_seed('reason2', 'creators', '@issue3802x_reason', 'identified'), 'passed', U&'\200B ' || repeat('r', 300) || U&'\00A0', 'record', 'stage_reason')), '300');
  perform pg_temp.x_eq('XA-19', 'a reason sent with a move to an ordinary stage is not kept',
    pg_temp.x_as('partner', format($$select coalesce(public.crm_record_move_stage(%L, 'contacted', 'ignored words')->'record'->>'stage_reason', '<none>')$$,
      pg_temp.x_seed('reason3', 'hosts', 'Issue3802x Reason Three', 'prospect'))), '<none>');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-20 — bulk add when something goes wrong.
-- ---------------------------------------------------------------------------
create function pg_temp.x_fault() returns trigger language plpgsql as $fn$
begin
  if new.name like 'Issue3802x Fault%' then
    raise exception 'issue3802x injected fault';
  end if;
  return new;
end;
$fn$;

do $t$
declare
  v_items text;
  v_got text;
  v_snap text;
  v_audit int;
begin
  -- Items a caller got wrong are listed one by one; the good ones are added.
  v_got := pg_temp.x_as('partner', $$select public.crm_records_bulk_create('hosts', (
    '[1, null, "a", [], {}, {"name":null}, {"name":{"a":1}}, {"name":"Issue3802x Odd","due_on":"9999-99-99"}, {"name":"Issue3802x Odd","followers":1},
      {"name":"Issue3802x Odd","brand_id":"zz"}, {"name":"Issue3802x Odd","owners":[1,[2],{"a":1},null]}, {"name":"Issue3802x Odd","region_id":123},
      {"name":"Issue3802x Odd","due_on":"0000-01-01"}, {"name":"Issue3802x Odd","icp":["restaurant_bar"]}, {"name":"Issue3802x Odd","channel":"fax"},
      {"name":"Issue3802x Odd","contact":"' || repeat('c', 301) || '"}, {"name":"Issue3802x Odd Good","due_on":"2026-10-31","contact":"x"}]')::jsonb, 'xfault-odd-01')::text$$);
  perform pg_temp.x_ok('XA-20', 'odd items do not stop the request', v_got like '{%', v_got);
  if v_got not like '{%' then v_got := '{"created":[],"skipped":[],"invalid":[]}'; end if;
  perform pg_temp.x_eq('XA-20', 'odd items: created/skipped/invalid',
    jsonb_array_length(v_got::jsonb->'created') || '/' || jsonb_array_length(v_got::jsonb->'skipped') || '/' || jsonb_array_length(v_got::jsonb->'invalid'), '1/0/16');
  perform pg_temp.x_eq('XA-20', 'every reason is one of the functions'' own messages',
    (select count(*)::text from jsonb_array_elements(v_got::jsonb->'invalid') e where (e->>'error') !~ '^[a-z_]+: \S'), '0');
  perform pg_temp.x_eq('XA-20', 'no reason mentions a table or a constraint',
    (select count(*)::text from jsonb_array_elements(v_got::jsonb->'invalid') e where (e->>'error') ~* 'relation|constraint|violates|crm_records|syntax|sqlstate'), '0');

  -- A fault that is not the caller's: the whole request stops, nothing is
  -- saved, nothing is kept under the key, and the same request works later.
  create trigger x3802_fault before insert on public.crm_records for each row execute function pg_temp.x_fault();
  select jsonb_agg(jsonb_build_object('name', n))::text into v_items
    from unnest(array['Issue3802x Before Fault One', 'Issue3802x Before Fault Two', 'Issue3802x Fault Here', 'Issue3802x After Fault']) n;
  v_snap := pg_temp.x_snap();
  v_audit := pg_temp.x_audit();
  set local client_min_messages = error;
  v_got := pg_temp.x_as('growth', format($$select public.crm_records_bulk_create('hosts', %L, 'xfault-key-01')::text$$, v_items));
  perform pg_temp.x_like('XA-20', 'a fault inside the list stops the request with a retry answer', v_got, 'ERR:40001:try_again:%');
  perform pg_temp.x_ok('XA-20', 'the answer says nothing about what went wrong inside', v_got !~* 'injected|trigger|relation|crm_records', v_got);
  perform pg_temp.x_eq('XA-20', 'nothing was saved, not even the items before the fault', pg_temp.x_snap(), v_snap);
  perform pg_temp.x_eq('XA-20', 'no audit row was written', pg_temp.x_audit()::text, v_audit::text);
  perform pg_temp.x_eq('XA-20', 'the request key was not kept',
    (select count(*)::text from public.crm_request_keys where request_key = 'xfault-key-01'), '0');
  v_got := pg_temp.x_as('growth', format($$select public.crm_records_bulk_create('hosts', %L, 'xfault-key-01')::text$$, v_items));
  perform pg_temp.x_like('XA-20', 'while the fault lasts, the same request gets the same retry answer', v_got, 'ERR:40001:try_again:%');
  perform pg_temp.x_like('XA-20', 'a single add that hits the fault is not reported as the caller''s mistake',
    pg_temp.x_as('growth', $$select public.crm_record_create('hosts', '{"name":"Issue3802x Fault Single"}', 'xfault-key-02')::text$$), 'ERR:P0001:%');
  reset client_min_messages;
  drop trigger x3802_fault on public.crm_records;
  v_got := pg_temp.x_as('growth', format($$select public.crm_records_bulk_create('hosts', %L, 'xfault-key-01')::text$$, v_items));
  perform pg_temp.x_eq('XA-20', 'once the fault is gone the same request, same key, adds all four',
    jsonb_array_length(v_got::jsonb->'created') || '/' || (v_got::jsonb ? 'replayed')::text, '4/false');
  perform pg_temp.x_eq('XA-20', 'and a further repeat is a repeat',
    pg_temp.x_as('growth', format($$select public.crm_records_bulk_create('hosts', %L, 'xfault-key-01')->>'replayed'$$, v_items)), 'true');
  perform pg_temp.x_eq('XA-20', 'four records, once',
    (select count(*)::text from public.crm_records where name like 'Issue3802x %Fault%'), '4');
end;
$t$;

-- ---------------------------------------------------------------------------
-- XA-21 — the scheduled run when one host cannot be promoted.
-- ---------------------------------------------------------------------------
create function pg_temp.x_fault_live() returns trigger language plpgsql as $fn$
begin
  if new.name like 'Issue3802x Stuck%' and new.stage = 'live' then
    raise exception 'issue3802x injected fault';
  end if;
  return new;
end;
$fn$;

do $t$
declare
  v_before int;
  v_audit int;
  v_got text;
  v_id uuid;
begin
  -- A clean run first: nothing left to promote, and no failure row.
  perform pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text');
  perform pg_temp.x_eq('XA-21', 'a clean run records no failure',
    (select count(*)::text from public.admin_audit_log where action = 'crm.reconcile_failed'), '0');

  perform pg_temp.x_seed('stuck1', 'hosts', 'Issue3802x Stuck One', 'onboarded', pg_temp.x_brand('venue')::uuid);
  perform pg_temp.x_seed('stuck2', 'hosts', 'Issue3802x Stuck Two', 'meeting',   pg_temp.x_brand('pub_live')::uuid);
  perform pg_temp.x_seed('fine1',  'hosts', 'Issue3802x Fine One',  'onboarded', pg_temp.x_brand('venue')::uuid);
  perform pg_temp.x_seed('fine2',  'hosts', 'Issue3802x Fine Two',  'replied',   pg_temp.x_brand('disc_scheduled')::uuid);
  perform pg_temp.x_seed('fine3',  'hosts', 'Issue3802x Fine Three','onboarded', pg_temp.x_brand('pub_rsvp')::uuid);
  create trigger x3802_fault_live before update on public.crm_records for each row execute function pg_temp.x_fault_live();
  v_audit := pg_temp.x_audit();
  set local client_min_messages = error;
  v_got := pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text');
  perform pg_temp.x_eq('XA-21', 'the run finishes and answers with the number it promoted', v_got, '3');
  perform pg_temp.x_eq('XA-21', 'the three healthy hosts are Live',
    (select string_agg(stage, ',' order by name) from public.crm_records where name like 'Issue3802x Fine %'), 'live,live,live');
  perform pg_temp.x_eq('XA-21', 'the two that failed are exactly where they were, with no half-written line',
    (select string_agg(r.stage || ':' || (r.went_live_at is null)::text || ':' || (select count(*) from public.crm_activity a where a.record_id = r.id), ',' order by r.name)
       from public.crm_records r where r.name like 'Issue3802x Stuck %'), 'onboarded:true:0,meeting:true:0');
  perform pg_temp.x_eq('XA-21', 'one failure row, by the system, with both counts',
    (select string_agg(admin_email || '|' || coalesce(actor_uid::text, '<none>') || '|' || target_type || '|' || (metadata->>'failed') || '|' || (metadata->>'promoted'), ';')
       from public.admin_audit_log where action = 'crm.reconcile_failed'), 'system|<none>|crm_pipeline|2|3');
  perform pg_temp.x_eq('XA-21', 'audit rows for that run: three promotions and the one failure row', (pg_temp.x_audit() - v_audit)::text, '4');
  perform pg_temp.x_eq('XA-21', 'the failure row carries no host name and no error text',
    (select count(*)::text from public.admin_audit_log where action = 'crm.reconcile_failed' and metadata::text ~* 'stuck|injected|fault'), '0');

  -- A person linking a brand while promotion fails: the link is saved, the
  -- host waits in Onboarded, and the person is not shown an error.
  v_id := pg_temp.x_seed('stuck3', 'hosts', 'Issue3802x Stuck Three', 'contacted');
  v_got := pg_temp.x_as('partner', format($$select (r->'record'->>'stage') || '/' || (r->>'moved_to') from public.crm_record_update(%L, %L) r$$, v_id,
    jsonb_build_object('brand_id', pg_temp.x_brand('venue'))::text));
  perform pg_temp.x_eq('XA-21', 'linking still works while promotion fails', v_got, 'onboarded/onboarded');

  -- The next runs: still failing, then healthy.
  perform pg_temp.x_eq('XA-21', 'the next run tries again and promotes nothing new', pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), '0');
  select count(*) into v_before from public.admin_audit_log where action = 'crm.reconcile_failed';
  reset client_min_messages;
  drop trigger x3802_fault_live on public.crm_records;
  perform pg_temp.x_eq('XA-21', 'once the fault is gone the skipped hosts are promoted', pg_temp.x_as('cron', 'select public.crm_reconcile_live()::text'), '3');
  perform pg_temp.x_eq('XA-21', 'and that healthy run adds no failure row',
    (select count(*)::text from public.admin_audit_log where action = 'crm.reconcile_failed'), v_before::text);
  perform pg_temp.x_eq('XA-21', 'all of them are Live, each with one system line into Live',
    (select count(*)::text from public.crm_records r where (r.name like 'Issue3802x Stuck %' or r.name like 'Issue3802x Fine %') and r.stage = 'live'
        and (select count(*) from public.crm_activity a where a.record_id = r.id and a.to_stage = 'live' and a.via = 'system') = 1), '6');
  perform pg_temp.x_like('XA-21', 'no client can read or start any of this',
    pg_temp.x_as('owner', 'select public.crm_reconcile_live()::text'), 'ERR:42501:permission denied%');
end;
$t$;

do $n$
declare
  v_n int;
  v_g int;
begin
  select count(*), count(distinct test) into v_n, v_g from x_results where test in ('XA-16','XA-17','XA-18','XA-19','XA-20','XA-21');
  if v_g < 6 or v_n < 400 then
    perform pg_temp.x_ok('XA-21', 'the retest groups all ran', false, v_n || ' checks in ' || v_g || ' groups');
  end if;
  raise notice 'ISSUE-3802 WAVE1 TESTER retest groups XA-16..XA-21: % checks ran (verdict below covers them)', v_n;
end;
$n$;

-- Verdict for part 1.
do $v$
declare
  v_total int;
  v_failed int;
  v_tests int;
  r record;
begin
  select count(*), count(*) filter (where not ok), count(distinct test) into v_total, v_failed, v_tests from x_results;
  if v_failed > 0 then
    for r in select * from x_results where not ok order by seq limit 60 loop
      raise warning 'ISSUE-3802 WAVE1 TESTER FAILED % — % [%]', r.test, r.label, r.detail;
    end loop;
    raise exception 'ISSUE-3802 WAVE1 TESTER FAIL (part 1): % of % checks failed', v_failed, v_total;
  end if;
  if v_tests < 15 or v_total < 1500 then
    raise exception 'ISSUE-3802 WAVE1 TESTER FAIL (part 1): only % checks in % groups ran', v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 WAVE1 TESTER PASS (part 1): % checks across XA-1..XA-15, 0 failed', v_total;
end;
$v$;

rollback;

-- ===========================================================================
-- PART 2 — races in real separate sessions. A few accounts, brands and
-- pipeline records are committed and removed.
-- ===========================================================================
create schema t3802x_race;
select count(*) = 0 as t3802x_made_dblink from pg_extension where extname = 'dblink' \gset
create extension if not exists dblink with schema t3802x_race;
select n.nspname as t3802x_dblink_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'dblink' \gset
set search_path = public, t3802x_race, :"t3802x_dblink_schema";
select set_config('t3802x.conn',
  format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s',
         current_setting('port'), current_database(), current_user, :'t3802x_pw'), false) is not null as conn_ready;

create table t3802x_race.results (seq serial primary key, label text, ok boolean, detail text);

create function t3802x_race.cleanup() returns void language plpgsql as $fn$
begin
  delete from public.admin_audit_log l
   where l.admin_email like 'issue3802x-race-%'
      or l.target_id in (select r.id::text from public.crm_records r
                          where r.created_by like 'issue3802x-race-%' or r.name like 'Issue3802x Race %');
  -- Children first, by hand: this runs with triggers off, so nothing cascades.
  delete from public.crm_activity a
   where a.actor_email like 'issue3802x-race-%'
      or a.record_id in (select r.id from public.crm_records r
                          where r.created_by like 'issue3802x-race-%' or r.name like 'Issue3802x Race %')
      or not exists (select 1 from public.crm_records r where r.id = a.record_id);
  delete from public.crm_record_owners o
   where o.owner_email like 'issue3802x-race-%'
      or o.record_id in (select r.id from public.crm_records r
                          where r.created_by like 'issue3802x-race-%' or r.name like 'Issue3802x Race %')
      or not exists (select 1 from public.crm_records r where r.id = o.record_id);
  delete from public.crm_records where created_by like 'issue3802x-race-%' or name like 'Issue3802x Race %';
  delete from public.crm_request_keys where actor_email like 'issue3802x-race-%';
  delete from public.events where slug like 'issue3802x-race-%';
  delete from public.brands where slug like 'issue3802x-race-%';
  delete from public.admin_users where lower(btrim(email)) like 'issue3802x-race-%';
  delete from auth.users where email like 'issue3802x-race-%';
end;
$fn$;

-- One statement in its own committed session, as a person (0 = the suite itself).
create function t3802x_race.solo(p_who int, p_sql text) returns text language plpgsql as $fn$
declare
  v_out text;
begin
  perform dblink_connect('t3802x_s', current_setting('t3802x.conn'));
  perform dblink_exec('t3802x_s', 'begin');
  if p_who > 0 then
  perform dblink_exec('t3802x_s', 'set local role authenticated');
  end if;
  perform * from dblink('t3802x_s', format(
    $q$select set_config('request.jwt.claim.sub', '38021111-0000-4000-c900-00000000000%s', true),
              set_config('request.jwt.claims', '{"sub":"38021111-0000-4000-c900-00000000000%s","role":"authenticated"}', true)$q$,
    p_who, p_who)) as t(a text, b text);
  select x into v_out from dblink('t3802x_s', p_sql) as t(x text);
  perform dblink_exec('t3802x_s', 'commit');
  perform dblink_disconnect('t3802x_s');
  return v_out;
exception when others then
  if 't3802x_s' = any (coalesce(dblink_get_connections(), '{}')) then perform dblink_disconnect('t3802x_s'); end if;
  return 'ERR:' || sqlerrm;
end;
$fn$;

-- Two overlapping sessions. The first runs its statement and holds its
-- transaction open; the second starts; then the first commits or rolls back.
-- p_who: 1 or 2 = that person; 0 = the scheduler (no signed-in caller).
create function t3802x_race.pair(p_who1 int, p_sql1 text, p_who2 int, p_sql2 text, p_end1 text default 'commit',
                                 out r1 text, out r2 text, out waited boolean) language plpgsql as $fn$
declare
  c_conn constant text := current_setting('t3802x.conn');
  v_c text;
  v_who int;
  v_pid int;
  i int;
begin
  waited := false;
  for v_c, v_who in values ('t3802x_c1', p_who1), ('t3802x_c2', p_who2) loop
    perform dblink_connect(v_c, c_conn);
    perform dblink_exec(v_c, 'begin');
    if v_who > 0 then
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38021111-0000-4000-c900-00000000000%s', true),
                  set_config('request.jwt.claims', '{"sub":"38021111-0000-4000-c900-00000000000%s","role":"authenticated"}', true)$q$,
        v_who, v_who)) as t(a text, b text);
    end if;
  end loop;
  begin
    select x into r1 from dblink('t3802x_c1', p_sql1) as t(x text);
  exception when others then
    r1 := 'ERR:' || sqlerrm;
  end;
  select x into v_pid from dblink('t3802x_c2', 'select pg_backend_pid()') as t(x int);
  perform dblink_send_query('t3802x_c2', p_sql2);
  for i in 1 .. 100 loop
    perform pg_sleep(0.05);
    waited := cardinality(pg_blocking_pids(v_pid)) > 0;
    exit when waited or dblink_is_busy('t3802x_c2') = 0;
  end loop;
  -- Give a statement that is about to wait a moment longer before deciding it did not.
  if not waited then
    perform pg_sleep(0.3);
    waited := cardinality(pg_blocking_pids(v_pid)) > 0;
  end if;
  perform dblink_exec('t3802x_c1', p_end1);
  select x into r2 from dblink_get_result('t3802x_c2', false) as t(x text);
  if r2 is null then
    r2 := 'ERR:' || coalesce(dblink_error_message('t3802x_c2'), '');
  end if;
  perform * from dblink_get_result('t3802x_c2', false) as t(x text);
  perform dblink_exec('t3802x_c2', 'commit', false);
  perform dblink_disconnect('t3802x_c1');
  perform dblink_disconnect('t3802x_c2');
exception when others then
  foreach v_c in array array['t3802x_c1', 't3802x_c2'] loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then perform dblink_disconnect(v_c); end if;
  end loop;
  r1 := coalesce(r1, '') || ' HARNESS:' || sqlerrm;
end;
$fn$;

create function t3802x_race.rec(p_label text, p_ok boolean, p_detail text) returns void language sql as $fn$
  insert into t3802x_race.results (label, ok, detail) values (p_label, coalesce(p_ok, false), left(coalesce(p_detail, ''), 400)) $fn$;

begin;
set local session_replication_role = replica;
select t3802x_race.cleanup();
insert into auth.users (id, email) values
  ('38021111-0000-4000-c900-000000000001', 'issue3802x-race-1@test.local'),
  ('38021111-0000-4000-c900-000000000002', 'issue3802x-race-2@test.local');
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802x-race-1@test.local', 'admin', 'active', now()),
  ('issue3802x-race-2@test.local', 'admin', 'active', now());
insert into public.brands (id, account_id, name, slug, city) values
  ('38021111-0000-4000-c800-000000000001', '38021111-0000-4000-c700-000000000001', 'Issue3802x Race Brand', 'issue3802x-race-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status) values
  ('38021111-0000-4000-c810-000000000001', '38021111-0000-4000-c800-000000000001', 'Issue3802x race night', 'issue3802x-race-night', 'public', 'scheduled');
insert into public.crm_records (id, pipeline, name, stage, brand_id, created_by, updated_by) values
  -- These two are linked to the public brand only just before their race, so
  -- the real scheduled run (every 10 minutes) cannot promote them first.
  ('38021111-0000-4000-c910-000000000004', 'hosts', 'Issue3802x Race Lost First',  'onboarded', null, 'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local'),
  ('38021111-0000-4000-c910-000000000005', 'hosts', 'Issue3802x Race Live First',  'onboarded', null, 'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local'),
  ('38021111-0000-4000-c910-000000000006', 'hosts', 'Issue3802x Race Undo',        'prospect',  null, 'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local');
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, deleted_at, deleted_by) values
  ('38021111-0000-4000-c910-000000000007', 'hosts', 'Issue3802x Race Restore', 'prospect', 'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local', now(), 'issue3802x-race-1@test.local');
commit;

do $race$
declare
  p record;
  v_items1 text;
  v_items2 text;
  v_act text;
begin
  -- C-1: two people bulk-add overlapping lists (spelled differently).
  select jsonb_agg(jsonb_build_object('name', 'Issue3802x Race Bulk ' || g))::text into v_items1 from generate_series(1, 5) g;
  select jsonb_agg(jsonb_build_object('name', 'issue3802x-race-BULK-' || g))::text into v_items2 from generate_series(3, 7) g;
  select * into p from t3802x_race.pair(
    1, format($q$select public.crm_records_bulk_create('hosts', %L, 'xrace-bulk-01')::text$q$, v_items1),
    2, format($q$select public.crm_records_bulk_create('hosts', %L, 'xrace-bulk-02')::text$q$, v_items2));
  perform t3802x_race.rec('C-1 the second bulk add waited for the first', p.waited, p.r2);
  perform t3802x_race.rec('C-1 first: 5 created', p.r1 like '{%' and jsonb_array_length(p.r1::jsonb->'created') = 5, p.r1);
  perform t3802x_race.rec('C-1 second: 2 created, 3 skipped as duplicates, none invalid',
    p.r2 like '{%' and jsonb_array_length(p.r2::jsonb->'created') = 2 and jsonb_array_length(p.r2::jsonb->'skipped') = 3
      and jsonb_array_length(p.r2::jsonb->'invalid') = 0, p.r2);
  perform t3802x_race.rec('C-1 seven records, one per name',
    (select count(*) = 7 and count(distinct name_key) = 7 from public.crm_records
      where name_key like 'issue3802xracebulk%' and deleted_at is null), null);

  -- C-2: the first add is rolled back; the second must not be told "duplicate".
  select * into p from t3802x_race.pair(
    1, $q$select public.crm_record_create('hosts', '{"name":"Issue3802x Race Rollback"}', 'xrace-roll-01')->>'status'$q$,
    2, $q$select public.crm_record_create('hosts', '{"name":"issue3802x race rollback"}', 'xrace-roll-02')->>'status'$q$, 'rollback');
  perform t3802x_race.rec('C-2 the second add waited', p.waited, p.r2);
  perform t3802x_race.rec('C-2 after the first is rolled back the second is created', p.r1 = 'created' and p.r2 = 'created', p.r1 || '/' || p.r2);
  perform t3802x_race.rec('C-2 exactly one record, the second person''s',
    (select count(*) = 1 and min(created_by) = 'issue3802x-race-2@test.local' from public.crm_records
      where name_key = 'issue3802xracerollback' and deleted_at is null), null);

  -- C-3: one person, one request key, two sessions at once.
  select * into p from t3802x_race.pair(
    1, $q$select public.crm_record_create('hosts', '{"name":"Issue3802x Race Same Key"}', 'xrace-same-key')::text$q$,
    1, $q$select public.crm_record_create('hosts', '{"name":"Issue3802x Race Same Key"}', 'xrace-same-key')::text$q$);
  perform t3802x_race.rec('C-3 the repeat waited for the first', p.waited, p.r2);
  perform t3802x_race.rec('C-3 the repeat got the first answer back, marked as a repeat',
    p.r1 like '{%' and p.r2 like '{%' and (p.r2::jsonb->>'replayed') = 'true' and not (p.r1::jsonb ? 'replayed')
      and (p.r2::jsonb - 'replayed') = p.r1::jsonb, p.r2);
  perform t3802x_race.rec('C-3 one record, one stored key, one audit row',
    (select count(*) = 1 from public.crm_records where name_key = 'issue3802xracesamekey')
    and (select count(*) = 1 from public.crm_request_keys where request_key = 'xrace-same-key')
    and (select count(*) = 1 from public.admin_audit_log where action = 'crm.record_create' and metadata->>'name' = 'Issue3802x Race Same Key'), null);

  -- C-4: two people, the same key, different names: neither waits for the other's key.
  select * into p from t3802x_race.pair(
    1, $q$select public.crm_record_create('hosts', '{"name":"Issue3802x Race Key A"}', 'xrace-two-people')->>'status'$q$,
    2, $q$select public.crm_record_create('hosts', '{"name":"Issue3802x Race Key B"}', 'xrace-two-people')->>'status'$q$);
  perform t3802x_race.rec('C-4 both created, and the second did not wait', p.r1 = 'created' and p.r2 = 'created' and not p.waited,
    p.r1 || '/' || p.r2 || '/' || p.waited::text);

  -- C-5: a person marks a host Lost while the scheduled run is about to promote it.
  perform t3802x_race.rec('C-5 fixture linked', t3802x_race.solo(0, $q$update public.crm_records set brand_id = '38021111-0000-4000-c800-000000000001'
    where id = '38021111-0000-4000-c910-000000000004' and stage = 'onboarded' returning 'linked'$q$) = 'linked', null);
  select * into p from t3802x_race.pair(
    1, $q$select public.crm_record_move_stage('38021111-0000-4000-c910-000000000004', 'lost', 'closed')->'record'->>'stage'$q$,
    0, $q$select public.crm_reconcile_live('38021111-0000-4000-c910-000000000004')::text$q$);
  perform t3802x_race.rec('C-5 the run waited for the person', p.waited, p.r2);
  perform t3802x_race.rec('C-5 the run promoted nothing and the host is Lost',
    p.r1 = 'lost' and p.r2 = '0' and (select stage = 'lost' and went_live_at is null from public.crm_records where id = '38021111-0000-4000-c910-000000000004'),
    p.r1 || '/' || p.r2);

  -- C-6: the run promotes a host while a person is moving it somewhere else.
  perform t3802x_race.rec('C-6 fixture linked', t3802x_race.solo(0, $q$update public.crm_records set brand_id = '38021111-0000-4000-c800-000000000001'
    where id = '38021111-0000-4000-c910-000000000005' and stage = 'onboarded' returning 'linked'$q$) = 'linked', null);
  select * into p from t3802x_race.pair(
    0, $q$select public.crm_reconcile_live('38021111-0000-4000-c910-000000000005')::text$q$,
    2, $q$select public.crm_record_move_stage('38021111-0000-4000-c910-000000000005', 'meeting')::text$q$);
  perform t3802x_race.rec('C-6 the person waited for the run', p.waited, p.r2);
  perform t3802x_race.rec('C-6 the person is told it is Live now, and it stays Live',
    p.r1 = '1' and p.r2 like 'ERR:%stage_is_live%' and (select stage = 'live' from public.crm_records where id = '38021111-0000-4000-c910-000000000005'),
    p.r1 || '/' || p.r2);
  perform t3802x_race.rec('C-6 one system line, no line from the person',
    (select count(*) filter (where via = 'system') = 1 and count(*) filter (where actor_email is not null) = 0
       from public.crm_activity where record_id = '38021111-0000-4000-c910-000000000005'), null);

  -- C-7: an undo arrives while someone else is moving the same card.
  v_act := t3802x_race.solo(1, $q$select public.crm_record_move_stage('38021111-0000-4000-c910-000000000006', 'contacted')->>'activity_id'$q$);
  select * into p from t3802x_race.pair(
    2, $q$select public.crm_record_move_stage('38021111-0000-4000-c910-000000000006', 'replied')->'record'->>'stage'$q$,
    1, format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act));
  perform t3802x_race.rec('C-7 the undo waited for the other move', p.waited, p.r2);
  perform t3802x_race.rec('C-7 the undo is refused and the other person''s move stands',
    p.r1 = 'replied' and p.r2 like 'ERR:%undo_expired%'
      and (select stage = 'replied' from public.crm_records where id = '38021111-0000-4000-c910-000000000006'), p.r1 || '/' || p.r2);
  perform t3802x_race.rec('C-7 both moves are still in the log',
    (select count(*) = 2 from public.crm_activity where record_id = '38021111-0000-4000-c910-000000000006' and kind = 'stage_move'), v_act);

  -- C-8: a deleted card is restored while someone adds a new card with its name.
  select * into p from t3802x_race.pair(
    2, $q$select public.crm_record_create('hosts', '{"name":"issue3802x race restore"}', 'xrace-restore-1')->>'status'$q$,
    1, $q$select public.crm_record_restore('38021111-0000-4000-c910-000000000007')::text$q$);
  perform t3802x_race.rec('C-8 the restore waited for the add', p.waited, p.r2);
  perform t3802x_race.rec('C-8 the restore is refused as a duplicate name', p.r1 = 'created' and p.r2 like 'ERR:%duplicate_name%', p.r1 || '/' || p.r2);
  perform t3802x_race.rec('C-8 one live record with that name; the old one is still deleted',
    (select count(*) filter (where deleted_at is null) = 1 and count(*) = 2 from public.crm_records where name_key = 'issue3802xracerestore'), null);

  -- RETEST additions (C-9..C-11): the rules that were tightened, under a race.
  perform t3802x_race.rec('C-9..C-11 fixtures', t3802x_race.solo(0, $q$with ins as (
    insert into public.crm_records (id, pipeline, name, stage, brand_id, agreement, went_live_at, created_by, updated_by) values
      ('38021111-0000-4000-c910-000000000009', 'hosts',    'Issue3802x Race Unlink',  'onboarded', null, null, null, 'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local'),
      ('38021111-0000-4000-c910-00000000000a', 'hosts',    'Issue3802x Race Undo Live', 'live', '38021111-0000-4000-c800-000000000001', null, now(), 'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local'),
      ('38021111-0000-4000-c910-00000000000b', 'creators', 'Issue3802x Race Creator', 'booked', null, 'signed', null, 'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local')
    returning 1) select count(*)::text from ins$q$) = '3', null);

  -- C-9: the run promotes a host while a person is clearing its brand link.
  perform t3802x_race.solo(0, $q$update public.crm_records set brand_id = '38021111-0000-4000-c800-000000000001'
    where id = '38021111-0000-4000-c910-000000000009' returning 'linked'$q$);
  select * into p from t3802x_race.pair(
    0, $q$select public.crm_reconcile_live('38021111-0000-4000-c910-000000000009')::text$q$,
    2, $q$select (r->'record'->>'stage') || '/' || coalesce(r->>'moved_to', '<none>') from public.crm_record_update('38021111-0000-4000-c910-000000000009', '{"brand_id":null}') r$q$);
  perform t3802x_race.rec('C-9 the person waited for the run', p.waited, p.r2);
  perform t3802x_race.rec('C-9 the host is not left in Live without a brand',
    p.r1 = '1' and p.r2 = 'onboarded/onboarded'
      and (select stage = 'onboarded' and brand_id is null from public.crm_records where id = '38021111-0000-4000-c910-000000000009'), p.r1 || '/' || p.r2);
  perform t3802x_race.rec('C-9 the log shows into Live and back out, both by the system',
    (select string_agg(from_stage || '>' || to_stage || ':' || coalesce(via, '-'), ',' order by created_at) from public.crm_activity
      where record_id = '38021111-0000-4000-c910-000000000009') = 'onboarded>live:system,live>onboarded:system', null);

  -- C-10: an undo back into Live arrives while someone clears the brand link.
  v_act := t3802x_race.solo(1, $q$select public.crm_record_move_stage('38021111-0000-4000-c910-00000000000a', 'lost', 'closed')->>'activity_id'$q$);
  select * into p from t3802x_race.pair(
    2, $q$select public.crm_record_update('38021111-0000-4000-c910-00000000000a', '{"brand_id":null}')->'record'->>'stage'$q$,
    1, format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act));
  perform t3802x_race.rec('C-10 the undo waited for the link change', p.waited, p.r2);
  perform t3802x_race.rec('C-10 the undo is refused and the host stays Lost with no brand',
    p.r1 = 'lost' and p.r2 like 'ERR:%undo_not_live%'
      and (select stage = 'lost' and brand_id is null and stage_reason = 'closed' from public.crm_records where id = '38021111-0000-4000-c910-00000000000a'), p.r1 || '/' || p.r2);

  -- C-11: an undo back into Booked arrives while someone unsigns the agreement.
  v_act := t3802x_race.solo(1, $q$select public.crm_record_move_stage('38021111-0000-4000-c910-00000000000b', 'negotiating')->>'activity_id'$q$);
  select * into p from t3802x_race.pair(
    2, $q$select public.crm_record_update('38021111-0000-4000-c910-00000000000b', '{"agreement":"sent"}')->'record'->>'agreement'$q$,
    1, format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act));
  perform t3802x_race.rec('C-11 the undo waited for the edit', p.waited, p.r2);
  perform t3802x_race.rec('C-11 the undo is refused and the creator stays in Negotiating',
    p.r1 = 'sent' and p.r2 like 'ERR:%agreement_required%'
      and (select stage = 'negotiating' and agreement = 'sent' from public.crm_records where id = '38021111-0000-4000-c910-00000000000b'), p.r1 || '/' || p.r2);
  -- C-12: a person clears the brand link just as the run has picked the host.
  -- (Linked only now, so the real scheduled run cannot get there first.)
  perform t3802x_race.rec('C-12 fixture', t3802x_race.solo(0, $q$insert into public.crm_records (id, pipeline, name, stage, brand_id, created_by, updated_by)
    values ('38021111-0000-4000-c910-00000000000c', 'hosts', 'Issue3802x Race Picked', 'onboarded', '38021111-0000-4000-c800-000000000001',
            'issue3802x-race-1@test.local', 'issue3802x-race-1@test.local') returning 'added'$q$) = 'added', null);
  select * into p from t3802x_race.pair(
    2, $q$select (r->'record'->>'stage') || '/' || coalesce(r->'record'->>'brand_id', '<none>') from public.crm_record_update('38021111-0000-4000-c910-00000000000c', '{"brand_id":null}') r$q$,
    0, $q$select public.crm_reconcile_live('38021111-0000-4000-c910-00000000000c')::text$q$);
  perform t3802x_race.rec('C-12 the run waited for the person', p.waited, p.r2);
  perform t3802x_race.rec('C-12 the run looks again and promotes nothing',
    p.r1 = 'onboarded/<none>' and p.r2 = '0'
      and (select stage = 'onboarded' and brand_id is null and went_live_at is null from public.crm_records where id = '38021111-0000-4000-c910-00000000000c')
      and not exists (select 1 from public.admin_audit_log where target_id = '38021111-0000-4000-c910-00000000000c' and action = 'crm.stage_auto_live'),
    p.r1 || '/' || p.r2);

  perform t3802x_race.rec('after the races: no Live host without a brand, no Booked or Posted creator without a signed agreement',
    not exists (select 1 from public.crm_records where (stage = 'live' and brand_id is null)
                   or (pipeline = 'creators' and stage in ('booked', 'posted') and agreement is distinct from 'signed')), null);
  if (select count(*) from t3802x_race.results) < 33 then
    perform t3802x_race.rec('all eleven races ran', false, (select count(*)::text from t3802x_race.results));
  end if;
  if (select count(*) from t3802x_race.results) < 36 then
    perform t3802x_race.rec('the twelfth race ran too', false, (select count(*)::text from t3802x_race.results));
  end if;

  -- After every race: never two live records with one name.
  perform t3802x_race.rec('no pipeline holds two live records with one name',
    not exists (select 1 from public.crm_records where deleted_at is null group by pipeline, name_key having count(*) > 1), null);
end;
$race$;

select count(*) as t3802x_race_total,
       count(*) filter (where not ok) as t3802x_race_failed,
       coalesce(string_agg(label || ' [' || coalesce(detail, '') || ']', '; ' order by seq) filter (where not ok), 'none') as t3802x_race_failures
  from t3802x_race.results \gset

-- Remove the committed rows, whatever the verdict.
begin;
set local session_replication_role = replica;
select t3802x_race.cleanup();
commit;
select (select count(*) from public.crm_records where name like 'Issue3802x Race %' or created_by like 'issue3802x-race-%')
     + (select count(*) from public.crm_activity a where a.actor_email like 'issue3802x-race-%'
           or not exists (select 1 from public.crm_records r where r.id = a.record_id))
     + (select count(*) from public.crm_record_owners o where o.owner_email like 'issue3802x-race-%'
           or not exists (select 1 from public.crm_records r where r.id = o.record_id))
     + (select count(*) from public.crm_request_keys where actor_email like 'issue3802x-race-%')
     + (select count(*) from public.admin_audit_log where admin_email like 'issue3802x-race-%')
     + (select count(*) from auth.users where email like 'issue3802x-race-%')
     + (select count(*) from public.brands where slug like 'issue3802x-race-%') as t3802x_left \gset
reset search_path;
\if :t3802x_made_dblink
drop extension if exists dblink;
\endif
drop schema t3802x_race cascade;

select (:t3802x_race_total < 25 or :t3802x_race_failed > 0 or :t3802x_left > 0) as t3802x_race_bad \gset
\if :t3802x_race_bad
  \echo 'ISSUE-3802 WAVE1 TESTER FAILED (part 2):' :t3802x_race_failures '; rows left behind:' :t3802x_left
  do $$ begin raise exception 'ISSUE-3802 WAVE1 TESTER FAIL: races failed, did not run, or left rows behind'; end $$;
\endif
\echo 'ISSUE-3802 WAVE1 TESTER PASS (part 2):' :t3802x_race_total 'checks across 8 races, 0 failed'
