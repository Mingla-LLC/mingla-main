-- Issue #3802 (Wave 1) — implementor suite for the Hosts and Creators
-- pipelines (PostgreSQL 17).
--
-- Proves, on the fully replayed schema:
--   W1-1   every client function x every caller: the four active roles are
--          let in, everyone else is refused; internal functions are closed
--   W1-2   the area map per caller; admin_console still equals is_admin_user()
--   W1-3   13 kinds of direct statement x 6 callers x 4 tables are all refused
--   W1-4   one name, one record: case, spacing, punctuation, a leading @
--   W1-5   a repeated request changes nothing (request keys)
--   W1-6   bulk create: 45 created, 3 skipped, 2 invalid; 51 is too many
--   W1-7   stage rules (Live sets itself, Lost needs a reason, Booked needs a
--          signed agreement)
--   W1-8   Live: promoted once from the linked brand's public listing
--   W1-9   delete and restore are for owner and admin only
--   W1-10  every write adds exactly one audit row; a no-change call adds none
--   W1-11  a touch keeps channel, direction, message reference and reply
--          classification as separate values
--   W1-12  catalog pins: who writes each table, grants, search_path, policies,
--          the schedule, and the Beta leads reader
--   W1-13  undo: own move, most recent entry, under a minute, stage unchanged
--   W1-14  link search returns only the named keys; % and _ are literal
--   W1-15  the migration's self-check aborts on a wrong grant
--   Part 2 two overlapping creates of one name -> one record; two overlapping
--          moves of one card -> both answered, two log rows (real sessions)
--
-- Part 1 is one transaction, rolled back. Part 2 commits a few rows and
-- removes them. Never run on production.
--
-- Runs as the image's admin role, like the Wave 0 suites: the bare CI image
-- ships an auth.users without email_confirmed_at, and part 2 needs
-- CREATE EXTENSION and session_replication_role. Run from the repository root
-- (W1-15 reads the migration file).
--
-- Checks are RECORDED and reported together.

\set ON_ERROR_STOP on
\getenv t3802w_pw PGPASSWORD
\set t3802w_selfcheck `sed -n '/^DO \$check\$/,/^\$check\$;/p' supabase/migrations/20270820003802_issue_3802_wave1_crm_pipelines.sql`

-- ===========================================================================
-- PART 1 — one transaction, rolled back.
-- ===========================================================================
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t3802w_selfcheck (sql text) on commit drop;
insert into t3802w_selfcheck values (:'t3802w_selfcheck');

create temp table t3802w_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802w_people (who, id, email) values
  ('owner',    '38020000-0000-4000-c000-000000000001', 'issue3802w-owner@test.local'),
  ('admin',    '38020000-0000-4000-c000-000000000002', 'issue3802w-admin@test.local'),
  ('growth',   '38020000-0000-4000-c000-000000000003', 'issue3802w-growth@test.local'),
  ('partner',  '38020000-0000-4000-c000-000000000004', 'issue3802w-partner@test.local'),
  ('invited',  '38020000-0000-4000-c000-000000000005', 'issue3802w-invited@test.local'),
  ('revoked',  '38020000-0000-4000-c000-000000000006', 'issue3802w-revoked@test.local'),
  ('consumer', '38020000-0000-4000-c000-000000000007', 'issue3802w-consumer@test.local'),
  ('growth2',  '38020000-0000-4000-c000-000000000008', 'tunde.a@issue3802w.test.local');

insert into auth.users (id, email, email_confirmed_at)
select id, email, now() from t3802w_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802w-owner@test.local', 'owner', 'active', now()),
  ('issue3802w-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('issue3802w-growth@test.local',   'growth',  'active',  now()),
  ('issue3802w-partner@test.local',  'partner', 'active',  now()),
  ('issue3802w-invited@test.local',  'growth',  'invited', null),
  ('issue3802w-revoked@test.local',  'partner', 'revoked', now()),
  ('tunde.a@issue3802w.test.local',  'growth',  'active',  now());

-- Things a host can be linked to. Triggers and foreign keys are off for the
-- fixture rows only (they need none of the product's side effects).
set local session_replication_role = replica;
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, is_live_for_consumers) values
  ('38020000-0000-4000-c200-000000000001', 'issue3802w-lagos',   'Issue3802w Lagos',   'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5, true),
  ('38020000-0000-4000-c200-000000000002', 'issue3802w-chicago', 'Issue3802w Chicago', 'United States', 'US', 41.8, -87.6, 41.7, -87.7, 41.9, -87.5, false);
insert into public.brands (id, account_id, name, slug, city) values
  ('38020000-0000-4000-c100-000000000001', '38020000-0000-4000-c300-000000000001', 'Issue3802w Live Brand',  'issue3802w-live-brand',  'Lagos'),
  ('38020000-0000-4000-c100-000000000002', '38020000-0000-4000-c300-000000000001', 'Issue3802w Quiet Brand', 'issue3802w-quiet-brand', 'Lagos'),
  ('38020000-0000-4000-c100-000000000003', '38020000-0000-4000-c300-000000000001', 'Issue3802w Gone Brand',  'issue3802w-gone-brand',  'Lagos'),
  ('38020000-0000-4000-c100-000000000004', '38020000-0000-4000-c300-000000000001', 'Issue3802w 100% Fun_Co', 'issue3802w-fun-co',      'Lagos'),
  ('38020000-0000-4000-c100-000000000005', '38020000-0000-4000-c300-000000000001', 'Issue3802w 1000 FunXCo', 'issue3802w-funxco',      'Lagos'),
  ('38020000-0000-4000-c100-000000000006', '38020000-0000-4000-c300-000000000001', 'Issue3802w Venue Brand', 'issue3802w-venue-brand', 'Lagos');
update public.brands set deleted_at = now() where id = '38020000-0000-4000-c100-000000000003';
update public.brands set claim_status = 'verified' where id = '38020000-0000-4000-c100-000000000006';
insert into public.brands (id, account_id, name, slug, city)
select ('38020000-0000-4000-c110-' || lpad(g::text, 12, '0'))::uuid, '38020000-0000-4000-c300-000000000001',
       'Issue3802w Limit Brand ' || lpad(g::text, 2, '0'), 'issue3802w-limit-' || g, 'Lagos'
from generate_series(1, 12) g;
insert into public.events (id, brand_id, title, slug, visibility, status) values
  ('38020000-0000-4000-c400-000000000001', '38020000-0000-4000-c100-000000000001', 'Issue3802w public night', 'issue3802w-public-night', 'public', 'scheduled');
insert into public.place_pool (id, name, lat, lng, city, is_active) values
  ('38020000-0000-4000-c500-000000000001', 'Issue3802w Palm Place',   6.5, 3.4, 'Lagos', true),
  ('38020000-0000-4000-c500-000000000002', 'Issue3802w Closed Place', 6.5, 3.4, 'Lagos', false);
set local session_replication_role = origin;

create temp table t3802w_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3802w_ids (k text primary key, v text) on commit drop;

-- Run one statement as a caller; return its single text result, or
-- 'ERR:<sqlstate>:<message>'. A raised statement leaves nothing behind.
create function pg_temp.t3802w_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'postgres', 'service') then
    select id, email into strict v_id, v_email from t3802w_people where who = p_who;
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
    elsif p_who = 'postgres' then
      set local role postgres;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '', true);
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

create function pg_temp.t3802w_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802w_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3802w_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3802w_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 400), '<null>'), p_pattern));
end;
$fn$;

-- One value out of a JSON answer; a non-JSON answer (a captured error) comes
-- back as it is, so a refusal is recorded as a failed check, not a crash.
create function pg_temp.t3802w_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

-- A JSON answer as JSON; a captured error becomes an empty object, so the
-- checks that follow are recorded as failed instead of stopping the suite.
create function pg_temp.t3802w_jb(p text) returns jsonb
language plpgsql as $fn$
begin
  return coalesce(p::jsonb, '{}'::jsonb);
exception when others then
  return '{}'::jsonb;
end;
$fn$;

create function pg_temp.t3802w_uuid(p text) returns uuid
language plpgsql as $fn$
begin
  return p::uuid;
exception when others then
  return null;
end;
$fn$;

create function pg_temp.t3802w_id(p_k text) returns text
language sql as $fn$ select v from t3802w_ids where k = p_k $fn$;

create function pg_temp.t3802w_keep(p_k text, p_v text) returns void
language sql as $fn$
  insert into t3802w_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

create function pg_temp.t3802w_snapshot() returns text
language sql as $fn$
  select md5(coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.crm_records r), '[]'::jsonb)::text)
      || md5(coalesce((select jsonb_agg(to_jsonb(o) order by o.record_id, o.owner_email) from public.crm_record_owners o), '[]'::jsonb)::text)
      || md5(coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.crm_activity a), '[]'::jsonb)::text)
      || md5(coalesce((select jsonb_agg(to_jsonb(k) order by k.actor_email, k.request_key) from public.crm_request_keys k), '[]'::jsonb)::text)
$fn$;

create function pg_temp.t3802w_audit() returns int
language sql as $fn$
  select count(*)::int from public.admin_audit_log where action like 'crm.%'
$fn$;

-- Create a record as a caller and remember its id under a short name.
create function pg_temp.t3802w_make(p_k text, p_who text, p_pipeline text, p_fields text) returns text
language plpgsql as $fn$
declare
  r text;
begin
  r := pg_temp.t3802w_as(p_who, format($q$select public.crm_record_create(%L, %L::jsonb, %L)::text$q$,
                                        p_pipeline, p_fields, 'mk-' || p_k || '-' || p_who));
  perform pg_temp.t3802w_keep(p_k, pg_temp.t3802w_get(r, 'record', 'id'));
  return r;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- W1-2 — areas per caller. admin_console still equals is_admin_user().
-- ---------------------------------------------------------------------------
do $w2$
declare
  c record;
begin
  for c in
    select * from (values
      ('owner',    'true',  'true',  'true',  'true',  'false'),
      ('admin',    'true',  'false', 'true',  'true',  'false'),
      ('growth',   'false', 'false', 'true',  'true',  'true'),
      ('partner',  'false', 'false', 'true',  'true',  'true'),
      ('growth2',  'false', 'false', 'true',  'true',  'true'),
      ('invited',  'false', 'false', 'false', 'false', 'false'),
      ('revoked',  'false', 'false', 'false', 'false', 'false'),
      ('consumer', 'false', 'false', 'false', 'false', 'false')
    ) as v(who, console, manage, crm, leads, home)
  loop
    perform pg_temp.t3802w_check('W1-2', c.who || ' admin_console',
      pg_temp.t3802w_as(c.who, $q$select public.admin_team_can('admin_console')::text$q$), c.console);
    perform pg_temp.t3802w_check('W1-2', c.who || ' admin_console equals is_admin_user()',
      pg_temp.t3802w_as(c.who, $q$select (public.admin_team_can('admin_console') = public.is_admin_user())::text$q$), 'true');
    perform pg_temp.t3802w_check('W1-2', c.who || ' team_manage',
      pg_temp.t3802w_as(c.who, $q$select public.admin_team_can('team_manage')::text$q$), c.manage);
    perform pg_temp.t3802w_check('W1-2', c.who || ' crm',
      pg_temp.t3802w_as(c.who, $q$select public.admin_team_can('crm')::text$q$), c.crm);
    perform pg_temp.t3802w_check('W1-2', c.who || ' beta_leads',
      pg_temp.t3802w_as(c.who, $q$select public.admin_team_can('beta_leads')::text$q$), c.leads);
    perform pg_temp.t3802w_check('W1-2', c.who || ' role_home',
      pg_temp.t3802w_as(c.who, $q$select public.admin_team_can('role_home')::text$q$), c.home);
  end loop;

  perform pg_temp.t3802w_check('W1-2', 'areas: owner',
    public.admin_team_role_areas('owner')::text, '{admin_console,team_manage,crm,beta_leads}');
  perform pg_temp.t3802w_check('W1-2', 'areas: admin',
    public.admin_team_role_areas('admin')::text, '{admin_console,crm,beta_leads}');
  perform pg_temp.t3802w_check('W1-2', 'areas: growth',
    public.admin_team_role_areas('growth')::text, '{role_home,crm,beta_leads}');
  perform pg_temp.t3802w_check('W1-2', 'areas: partner',
    public.admin_team_role_areas('partner')::text, '{role_home,crm,beta_leads}');
  perform pg_temp.t3802w_check('W1-2', 'areas: anything else',
    public.admin_team_role_areas('nope')::text || public.admin_team_role_areas(null)::text, '{}{}');
  perform pg_temp.t3802w_check('W1-2', 'growth access lists the three areas in order',
    pg_temp.t3802w_as('growth', $q$select public.admin_team_my_access()->>'areas'$q$),
    '["role_home", "crm", "beta_leads"]');
  perform pg_temp.t3802w_check('W1-2', 'invited growth still has no areas',
    pg_temp.t3802w_as('invited', $q$select public.admin_team_my_access()->>'areas'$q$), '[]');
  -- The full-admin authority was not touched by this work.
  perform pg_temp.t3802w_check('W1-2', 'is_admin_user() body is unchanged',
    (select md5(p.prosrc) from pg_proc p where p.oid = 'public.is_admin_user()'::regprocedure),
    'dc5465a20a4246c6921be0469e261a8b');
end;
$w2$;

-- ---------------------------------------------------------------------------
-- W1-1 — every client function x every caller.
-- ---------------------------------------------------------------------------
do $w1$
declare
  r text;
  v_who text;
  f record;
  v_sql text;
  v_got text;
  v_before text;
  v_audit int;
  v_email text;
begin
  r := pg_temp.t3802w_make('base', 'owner', 'hosts', '{"name": "W1-1 Base Host"}');
  perform pg_temp.t3802w_check('W1-1', 'owner creates the base host', pg_temp.t3802w_get(r, 'status'), 'created');
  perform pg_temp.t3802w_check('W1-1', 'a new host starts in Prospect', pg_temp.t3802w_get(r, 'record', 'stage'), 'prospect');
  perform pg_temp.t3802w_check('W1-1', 'the person who adds it owns it',
    pg_temp.t3802w_get(r, 'record', 'owners'), '["issue3802w-owner@test.local"]');
  perform pg_temp.t3802w_check('W1-1', 'a new record gets a created log line',
    (select kind || '/' || actor_email || '/' || coalesce(via, '<person>') || '/' || body
       from public.crm_activity where record_id = pg_temp.t3802w_uuid(pg_temp.t3802w_id('base'))),
    'created/issue3802w-owner@test.local/<person>/Added to the pipeline.');

  -- Allowed callers. Each function is called with a request that is valid
  -- for that person; the answer must not be a refusal.
  foreach v_who in array array['owner', 'admin', 'growth', 'partner'] loop
    select email into v_email from t3802w_people where who = v_who;
    for f in
      select * from (values
        ('crm_config',                $q$select public.crm_config()::text$q$, 'ok'),
        ('crm_records_list',          $q$select public.crm_records_list('hosts')::text$q$, 'ok'),
        ('crm_record_get',            format($q$select public.crm_record_get(%L)::text$q$, pg_temp.t3802w_id('base')), 'ok'),
        ('crm_duplicate_check',       $q$select public.crm_duplicate_check('hosts', 'zz nothing')::text$q$, 'ok'),
        ('crm_link_search',           $q$select public.crm_link_search('brand', 'Issue3802w')::text$q$, 'ok'),
        ('crm_record_create',         format($q$select public.crm_record_create('hosts', %L::jsonb, %L)::text$q$, json_build_object('name', 'W1-1 by ' || v_who)::text, 'w11-create-' || v_who), 'ok'),
        ('crm_records_bulk_create',   format($q$select public.crm_records_bulk_create('creators', %L::jsonb, %L)::text$q$, json_build_array(json_build_object('name', '@w11bulk' || v_who))::text, 'w11-bulk-' || v_who), 'ok'),
        ('crm_record_update',         format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$, pg_temp.t3802w_id('base'), json_build_object('next_action', 'ping from ' || v_who)::text), 'ok'),
        ('crm_record_move_stage',     format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, pg_temp.t3802w_id('base')), 'ok'),
        ('crm_record_undo_stage_move', $q$select public.crm_record_undo_stage_move('38020000-0000-4000-cfff-000000000001')::text$q$, 'ERR:22023:undo_expired:%'),
        ('crm_record_set_owners',     format($q$select public.crm_record_set_owners(%L, array[%L])::text$q$, pg_temp.t3802w_id('base'), v_email), 'ok'),
        ('crm_record_log',            format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "hello"}'::jsonb, %L)::text$q$, pg_temp.t3802w_id('base'), 'w11-log-' || v_who), 'ok'),
        ('crm_record_delete',         $q$select public.crm_record_delete('38020000-0000-4000-cfff-000000000002')::text$q$,
                                      case when v_who in ('owner', 'admin') then 'ERR:P0002:not_found:%' else 'ERR:42501:forbidden: Only an owner or admin can delete. Mark it as lost instead.' end),
        ('crm_record_restore',        $q$select public.crm_record_restore('38020000-0000-4000-cfff-000000000002')::text$q$,
                                      case when v_who in ('owner', 'admin') then 'ERR:P0002:not_found:%' else 'ERR:42501:forbidden: Only an owner or admin can restore a deleted record.' end)
      ) as v(fn, sql, want)
    loop
      v_got := pg_temp.t3802w_as(v_who, f.sql);
      if f.want = 'ok' then
        perform pg_temp.t3802w_check('W1-1', v_who || ' may call ' || f.fn || ' (' || left(coalesce(v_got, '<null>'), 60) || ')',
          (v_got is not null and v_got not like 'ERR:%')::text, 'true');
      else
        perform pg_temp.t3802w_like('W1-1', v_who || ' calling ' || f.fn, v_got, f.want);
      end if;
    end loop;
  end loop;

  -- Refused callers. Nothing they send changes anything.
  v_before := pg_temp.t3802w_snapshot();
  v_audit := pg_temp.t3802w_audit();
  foreach v_who in array array['invited', 'revoked', 'consumer', 'anon', 'service'] loop
    for f in
      select * from (values
        ('crm_config',                $q$select public.crm_config()::text$q$),
        ('crm_records_list',          $q$select public.crm_records_list('hosts')::text$q$),
        ('crm_record_get',            format($q$select public.crm_record_get(%L)::text$q$, pg_temp.t3802w_id('base'))),
        ('crm_duplicate_check',       $q$select public.crm_duplicate_check('hosts', 'W1-1 Base Host')::text$q$),
        ('crm_link_search',           $q$select public.crm_link_search('brand', 'Issue3802w')::text$q$),
        ('crm_record_create',         format($q$select public.crm_record_create('hosts', '{"name": "W1-1 refused"}'::jsonb, %L)::text$q$, 'w11-refused-' || v_who)),
        ('crm_records_bulk_create',   format($q$select public.crm_records_bulk_create('hosts', '[{"name": "W1-1 refused bulk"}]'::jsonb, %L)::text$q$, 'w11-refusedb-' || v_who)),
        ('crm_record_update',         format($q$select public.crm_record_update(%L, '{"next_action": "refused"}'::jsonb)::text$q$, pg_temp.t3802w_id('base'))),
        ('crm_record_move_stage',     format($q$select public.crm_record_move_stage(%L, 'replied')::text$q$, pg_temp.t3802w_id('base'))),
        ('crm_record_undo_stage_move', $q$select public.crm_record_undo_stage_move('38020000-0000-4000-cfff-000000000001')::text$q$),
        ('crm_record_set_owners',     format($q$select public.crm_record_set_owners(%L, array[]::text[])::text$q$, pg_temp.t3802w_id('base'))),
        ('crm_record_log',            format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "refused"}'::jsonb, %L)::text$q$, pg_temp.t3802w_id('base'), 'w11-refusedl-' || v_who)),
        ('crm_record_delete',         format($q$select public.crm_record_delete(%L)::text$q$, pg_temp.t3802w_id('base'))),
        ('crm_record_restore',        format($q$select public.crm_record_restore(%L)::text$q$, pg_temp.t3802w_id('base')))
      ) as v(fn, sql)
    loop
      v_got := pg_temp.t3802w_as(v_who, f.sql);
      perform pg_temp.t3802w_like('W1-1', v_who || ' is refused by ' || f.fn, v_got,
        case when v_who = 'anon' then 'ERR:42501:permission denied for function %' else 'ERR:42501:forbidden:%' end);
    end loop;
  end loop;
  perform pg_temp.t3802w_check('W1-1', 'refused requests changed nothing', pg_temp.t3802w_snapshot(), v_before);
  perform pg_temp.t3802w_check('W1-10', 'refused requests wrote no audit row', pg_temp.t3802w_audit()::text, v_audit::text);

  -- Internal functions cannot be called by any client, whatever their role.
  foreach v_who in array array['owner', 'growth', 'consumer', 'anon'] loop
    for f in
      select * from (values
        ('crm_ctx',                $q$select actor_email from public.crm_ctx()$q$),
        ('admin_team_directory',   $q$select count(*)::text from public.admin_team_directory()$q$),
        ('crm_reconcile_live',     $q$select public.crm_reconcile_live()::text$q$),
        ('crm_brand_is_live',      $q$select public.crm_brand_is_live('38020000-0000-4000-c100-000000000001')::text$q$),
        ('crm_audit',              $q$select public.crm_audit('x@test.local', 'crm.forged', 'crm_record', 'x', '{}'::jsonb)::text$q$),
        ('crm_record_create_core', $q$select public.crm_record_create_core('hosts', '{"name": "forged"}'::jsonb, 'x@test.local', 'agent')::text$q$),
        ('crm_request_finish',     $q$select public.crm_request_finish('x@test.local', 'forged-key-1', 'crm_record_create', '{}'::jsonb)::text$q$),
        ('crm_apply_brand_link',   format($q$select public.crm_apply_brand_link(%L)::text$q$, pg_temp.t3802w_id('base'))),
        ('crm_validate_fields',    $q$select public.crm_validate_fields('hosts', '{"name": "x"}'::jsonb, 'create')::text$q$),
        ('crm_name_key',           $q$select public.crm_name_key('x')$q$)
      ) as v(fn, sql)
    loop
      perform pg_temp.t3802w_like('W1-1', v_who || ' cannot call the internal ' || f.fn,
        pg_temp.t3802w_as(v_who, f.sql), 'ERR:42501:permission denied for function %');
    end loop;
  end loop;

  -- The config a person (later, an agent) is handed.
  r := pg_temp.t3802w_as('growth2', $q$select public.crm_config()::text$q$);
  perform pg_temp.t3802w_check('W1-1', 'config: me',
    pg_temp.t3802w_get(r, 'me'),
    '{"role": "growth", "email": "tunde.a@issue3802w.test.local", "can_delete": false, "display_name": "Tunde"}');
  perform pg_temp.t3802w_check('W1-1', 'config: an owner can delete',
    pg_temp.t3802w_get(pg_temp.t3802w_as('owner', $q$select public.crm_config()::text$q$), 'me', 'can_delete'), 'true');
  perform pg_temp.t3802w_check('W1-1', 'config: host stages in order',
    (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) #> '{pipelines,hosts,stages}') with ordinality x(s, o)),
    'prospect,contacted,replied,meeting,onboarded,live,lost');
  perform pg_temp.t3802w_check('W1-1', 'config: creator stages in order',
    (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) #> '{pipelines,creators,stages}') with ordinality x(s, o)),
    'identified,contacted,replied,negotiating,booked,posted,passed');
  perform pg_temp.t3802w_check('W1-1', 'config: Live is automatic and Lost is terminal',
    (pg_temp.t3802w_jb(r) #>> '{pipelines,hosts,stages,5,auto}') || '/' || (pg_temp.t3802w_jb(r) #>> '{pipelines,hosts,stages,6,terminal}'), 'true/true');
  perform pg_temp.t3802w_check('W1-1', 'config: host ICPs',
    (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) #> '{pipelines,hosts,icps}') with ordinality x(s, o)),
    'restaurant_bar,venue_gallery,event_organizer,community_host,trip_stay_host,partner_org');
  perform pg_temp.t3802w_check('W1-1', 'config: creator ICPs and reached stages',
    (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) #> '{pipelines,creators,icps}') with ordinality x(s, o))
      || '|' || (pg_temp.t3802w_jb(r) #>> '{pipelines,creators,reached_stages}') || '|' || (pg_temp.t3802w_jb(r) #>> '{pipelines,hosts,reached_stages}'),
    'ambassador,ugc_one_off|["booked", "posted"]|["onboarded", "live"]');
  perform pg_temp.t3802w_check('W1-1', 'config: pick-lists',
    (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'channels') with ordinality x(s, o))
      || '|' || (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'sources') with ordinality x(s, o))
      || '|' || (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'reply_classes') with ordinality x(s, o))
      || '|' || (select string_agg(s->>'id', ',' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'agreements') with ordinality x(s, o)),
    'email,whatsapp,instagram_dm,tiktok_dm,phone,in_person|place_pool,instagram,tiktok,referral,event,inbound|interested,question,not_now,wrong_contact|none,sent,signed');
  perform pg_temp.t3802w_check('W1-1', 'config: regions list live cities first',
    (select string_agg((s->>'name') || '=' || (s->>'is_live'), ',' order by o)
       from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'regions') with ordinality x(s, o)
      where s->>'name' like 'Issue3802w %'),
    'Issue3802w Lagos=true,Issue3802w Chicago=false');
  perform pg_temp.t3802w_check('W1-1', 'config: region keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.t3802w_jb(r) #> '{regions,0}') k), 'country_code,id,is_live,name');
  perform pg_temp.t3802w_check('W1-1', 'config: team is everyone who is not revoked',
    (select string_agg((s->>'email') || '=' || (s->>'role') || '/' || (s->>'status'), ',' order by s->>'email')
       from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'team') s where s->>'email' like '%issue3802w%'),
    'issue3802w-admin@test.local=admin/active,issue3802w-growth@test.local=growth/active,issue3802w-invited@test.local=growth/invited,issue3802w-owner@test.local=owner/active,issue3802w-partner@test.local=partner/active,tunde.a@issue3802w.test.local=growth/active');
  perform pg_temp.t3802w_check('W1-1', 'config: bulk limit', pg_temp.t3802w_get(r, 'limits', 'bulk_max'), '50');
  perform pg_temp.t3802w_check('W1-1', 'display names',
    public.crm_display_name('tunde.a@x.test') || ',' || public.crm_display_name('seth@x.test') || ','
      || public.crm_display_name('mary_jane+crm@x.test') || ',' || public.crm_display_name('a-b@x.test')
      || ',' || coalesce(public.crm_display_name(null), '<null>'),
    'Tunde,Seth,Mary,A,<null>');
  perform pg_temp.t3802w_like('W1-1', 'list: unknown pipeline',
    pg_temp.t3802w_as('growth', $q$select public.crm_records_list('venues')::text$q$), 'ERR:22023:invalid_pipeline:%');
  perform pg_temp.t3802w_check('W1-1', 'list: shape',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.t3802w_jb(pg_temp.t3802w_as('partner', $q$select public.crm_records_list('hosts')::text$q$))) k),
    'pipeline,records,truncated');
  perform pg_temp.t3802w_check('W1-1', 'record: exactly the documented keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.t3802w_jb(pg_temp.t3802w_as('partner', format($q$select public.crm_record_get(%L)::text$q$, pg_temp.t3802w_id('base')))) -> 'record') k),
    'agreement,beta_lead_id,brand_id,brand_name,channel,contact,created_at,created_by,due_on,followers,icp,id,last_touch_at,name,next_action,owners,pipeline,place_name,place_pool_id,rate,region_id,source,stage,stage_reason,touch_count,updated_at,went_live_at');
end;
$w1$;

-- ---------------------------------------------------------------------------
-- W1-3 — the tables answer no client directly. 13 statements x 6 callers x 4
-- tables, and the tables are byte-identical afterwards.
-- ---------------------------------------------------------------------------
do $w3$
declare
  v_before text := pg_temp.t3802w_snapshot();
  t record;
  s record;
  v_who text;
  v_got text;
begin
  for t in
    select * from (values
      ('public.crm_records',       'name',       $q$(pipeline, name, stage, created_by, updated_by) values ('hosts', 'planted', 'prospect', 'x', 'x')$q$),
      ('public.crm_record_owners', 'added_by',   format($q$(record_id, owner_email, added_by) values (%L, 'planted@test.local', 'x')$q$, pg_temp.t3802w_id('base'))),
      ('public.crm_activity',      'kind',       format($q$(record_id, kind, actor_email, body) values (%L, 'note', 'planted@test.local', 'planted')$q$, pg_temp.t3802w_id('base'))),
      ('public.crm_request_keys',  'fn',         $q$(actor_email, request_key, fn, response) values ('planted@test.local', 'planted-key-1', 'crm_record_create', '{}'::jsonb)$q$)
    ) as v(tbl, col, ins)
  loop
    for s in
      select * from (values
        ('count',             format($q$select count(*)::text from %s$q$, t.tbl)),
        ('read a row',        format($q$select to_jsonb(x)::text from %s x limit 1$q$, t.tbl)),
        ('read one column',   format($q$select max(%I::text) from %s$q$, t.col, t.tbl)),
        ('lock rows',         format($q$select count(*)::text from (select 1 from %s for update) q$q$, t.tbl)),
        ('share-lock rows',   format($q$select count(*)::text from (select 1 from %s for share) q$q$, t.tbl)),
        ('insert',            format($q$with x as (insert into %s %s returning 1) select count(*)::text from x$q$, t.tbl, t.ins)),
        ('insert, no return', format($q$insert into %s %s$q$, t.tbl, t.ins)),
        ('upsert',            format($q$with x as (insert into %s %s on conflict do nothing returning 1) select count(*)::text from x$q$, t.tbl, t.ins)),
        ('update',            format($q$with x as (update %s set %I = %I returning 1) select count(*)::text from x$q$, t.tbl, t.col, t.col)),
        ('update, no return', format($q$update %s set %I = %I$q$, t.tbl, t.col, t.col)),
        ('delete',            format($q$with x as (delete from %s returning 1) select count(*)::text from x$q$, t.tbl)),
        ('truncate',          format($q$truncate %s cascade$q$, t.tbl)),
        ('switch security off', format($q$alter table %s disable row level security$q$, t.tbl))
      ) as v(label, sql)
    loop
      foreach v_who in array array['owner', 'admin', 'growth', 'partner', 'consumer', 'anon'] loop
        v_got := pg_temp.t3802w_as(v_who, s.sql);
        perform pg_temp.t3802w_like('W1-3', v_who || ': ' || s.label || ' on ' || t.tbl, v_got, 'ERR:42501:%');
      end loop;
    end loop;
  end loop;
  perform pg_temp.t3802w_check('W1-3', 'tables unchanged after every direct statement', pg_temp.t3802w_snapshot(), v_before);
end;
$w3$;

-- ---------------------------------------------------------------------------
-- W1-4 — one name, one record.
-- ---------------------------------------------------------------------------
do $w4$
declare
  k record;
  r text;
  v_n int;
  v_audit int;
  v_variant text;
begin
  -- The same twelve inputs the admin web client is tested against.
  for k in
    select * from (values
      ('Palm Court Kitchen',     'palmcourtkitchen'),
      ('palm-court kitchen',     'palmcourtkitchen'),
      ('@PalmCourtKitchen',      'palmcourtkitchen'),
      ('  PALM   COURT  KITCHEN ', 'palmcourtkitchen'),
      ('Palm Court Kitchen.',    'palmcourtkitchen'),
      ('Palm_Court/Kitchen!',    'palmcourtkitchen'),
      ('Palm Court Kitchen 2',   'palmcourtkitchen2'),
      ('@lagos.eats',            'lagoseats'),
      ('Lagos Eats',             'lagoseats'),
      ('100% Fun',               '100fun'),
      ('!!!',                    '!!!'),
      ('A',                      'a')
    ) as v(input, want)
  loop
    perform pg_temp.t3802w_check('W1-4', 'name key of [' || k.input || ']', public.crm_name_key(k.input), k.want);
  end loop;

  r := pg_temp.t3802w_make('palm', 'growth', 'hosts', '{"name": "Palm Court Kitchen"}');
  perform pg_temp.t3802w_check('W1-4', 'first Palm Court Kitchen is created', pg_temp.t3802w_get(r, 'status'), 'created');
  select count(*) into v_n from public.crm_records;
  v_audit := pg_temp.t3802w_audit();

  foreach v_variant in array array['palm court kitchen', 'PALM  COURT   KITCHEN', 'palm-court kitchen', '@PalmCourtKitchen', ' Palm Court Kitchen. '] loop
    r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_create('hosts', %L::jsonb, %L)::text$q$,
           json_build_object('name', v_variant)::text, 'w14-' || md5(v_variant)));
    perform pg_temp.t3802w_check('W1-4', 'adding [' || v_variant || '] answers duplicate', pg_temp.t3802w_get(r, 'status'), 'duplicate');
    perform pg_temp.t3802w_check('W1-4', 'and names the existing record for [' || v_variant || ']',
      pg_temp.t3802w_get(r, 'existing', 'id') || '/' || pg_temp.t3802w_get(r, 'existing', 'name') || '/' || pg_temp.t3802w_get(r, 'existing', 'stage')
        || '/' || pg_temp.t3802w_get(r, 'existing', 'owners'),
      pg_temp.t3802w_id('palm') || '/Palm Court Kitchen/prospect/["issue3802w-growth@test.local"]');
  end loop;
  perform pg_temp.t3802w_check('W1-4', 'duplicates wrote no record', (select count(*)::text from public.crm_records), v_n::text);
  perform pg_temp.t3802w_check('W1-4', 'duplicates wrote no audit row', pg_temp.t3802w_audit()::text, v_audit::text);
  perform pg_temp.t3802w_check('W1-4', 'duplicates stored no request key',
    (select count(*)::text from public.crm_request_keys where request_key like 'w14-%'), '0');

  -- The index itself, for a writer that skips the function.
  perform pg_temp.t3802w_like('W1-4', 'the table refuses a second live record with the same key',
    pg_temp.t3802w_as('postgres', $q$with x as (insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values ('hosts', 'palm court-kitchen', 'prospect', 'x', 'x') returning 1) select count(*)::text from x$q$),
    'ERR:23505:%crm_records_live_name_key%');

  -- The same name in the other pipeline is a different record.
  r := pg_temp.t3802w_make('palmc', 'partner', 'creators', '{"name": "@PalmCourtKitchen"}');
  perform pg_temp.t3802w_check('W1-4', 'the same name is allowed in the other pipeline',
    pg_temp.t3802w_get(r, 'status') || '/' || pg_temp.t3802w_get(r, 'record', 'stage'), 'created/identified');

  -- Renaming into a taken name.
  r := pg_temp.t3802w_make('sunset', 'growth', 'hosts', '{"name": "Sunset Bar"}');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_update(%L, '{"name": "PALM COURT-KITCHEN"}'::jsonb)::text$q$, pg_temp.t3802w_id('sunset')));
  perform pg_temp.t3802w_check('W1-4', 'rename into a taken name is refused', r,
    'ERR:22023:duplicate_name: "Palm Court Kitchen" is already in Hosts. Open it instead.');
  perform pg_temp.t3802w_check('W1-4', 'the refused rename changed nothing',
    (select name from public.crm_records where id = pg_temp.t3802w_uuid(pg_temp.t3802w_id('sunset'))), 'Sunset Bar');
  -- Re-spelling your own name is not a duplicate.
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_update(%L, '{"name": "  Sunset   BAR "}'::jsonb)::text$q$, pg_temp.t3802w_id('sunset')));
  perform pg_temp.t3802w_check('W1-4', 're-spelling the same name is allowed and tidied',
    pg_temp.t3802w_get(r, 'changed') || '/' || pg_temp.t3802w_get(r, 'record', 'name'), 'true/Sunset BAR');

  -- Restoring into a taken name.
  r := pg_temp.t3802w_as('owner', format($q$select public.crm_record_delete(%L)::text$q$, pg_temp.t3802w_id('sunset')));
  perform pg_temp.t3802w_check('W1-4', 'owner deletes Sunset Bar', pg_temp.t3802w_get(r, 'changed'), 'true');
  r := pg_temp.t3802w_make('sunset2', 'partner', 'hosts', '{"name": "sunset bar"}');
  perform pg_temp.t3802w_check('W1-4', 'a deleted record frees its name', pg_temp.t3802w_get(r, 'status'), 'created');
  r := pg_temp.t3802w_as('owner', format($q$select public.crm_record_restore(%L)::text$q$, pg_temp.t3802w_id('sunset')));
  perform pg_temp.t3802w_check('W1-4', 'restore into a taken name is refused', r,
    'ERR:22023:duplicate_name: "sunset bar" is already in Hosts. Open it instead.');
  perform pg_temp.t3802w_check('W1-4', 'the refused restore left it deleted',
    (select (deleted_at is not null)::text from public.crm_records where id = pg_temp.t3802w_uuid(pg_temp.t3802w_id('sunset'))), 'true');

  -- The check a form runs while someone types.
  r := pg_temp.t3802w_as('growth', $q$select public.crm_duplicate_check('hosts', '  palm COURT kitchen')::text$q$);
  perform pg_temp.t3802w_check('W1-4', 'duplicate check: exact', pg_temp.t3802w_get(r, 'exact', 'id'), pg_temp.t3802w_id('palm'));
  r := pg_temp.t3802w_as('growth', $q$select public.crm_duplicate_check('hosts', 'Palm Court')::text$q$);
  perform pg_temp.t3802w_check('W1-4', 'duplicate check: a shorter name finds the similar one',
    coalesce(pg_temp.t3802w_get(r, 'exact'), '<none>') || '/' || pg_temp.t3802w_get(r, 'similar', '0', 'name'), '<none>/Palm Court Kitchen');
  r := pg_temp.t3802w_as('growth', $q$select public.crm_duplicate_check('hosts', 'The Palm Court Kitchen Lagos')::text$q$);
  perform pg_temp.t3802w_check('W1-4', 'duplicate check: a longer name finds the similar one',
    pg_temp.t3802w_get(r, 'similar', '0', 'id'), pg_temp.t3802w_id('palm'));
  r := pg_temp.t3802w_as('growth', $q$select public.crm_duplicate_check('hosts', 'pa')::text$q$);
  perform pg_temp.t3802w_check('W1-4', 'duplicate check: two letters match nothing', r, '{"exact": null, "similar": []}');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_duplicate_check('hosts', 'Palm Court Kitchen', %L)::text$q$, pg_temp.t3802w_id('palm')));
  perform pg_temp.t3802w_check('W1-4', 'duplicate check: the record being edited is left out', r, '{"exact": null, "similar": []}');
  r := pg_temp.t3802w_as('growth', $q$select public.crm_duplicate_check('hosts', 'Sunset BAR')::text$q$);
  perform pg_temp.t3802w_check('W1-4', 'duplicate check: a deleted record is never the match',
    pg_temp.t3802w_get(r, 'exact', 'id'), pg_temp.t3802w_id('sunset2'));
end;
$w4$;

-- ---------------------------------------------------------------------------
-- W1-5 — a repeated request changes nothing.
-- ---------------------------------------------------------------------------
do $w5$
declare
  r1 text;
  r2 text;
  v_before text;
  v_audit int;
begin
  r1 := pg_temp.t3802w_as('growth', $q$select public.crm_record_create('hosts', '{"name": "Replay Venue", "icp": "restaurant_bar"}'::jsonb, 'w15-create-0001')::text$q$);
  perform pg_temp.t3802w_check('W1-5', 'first create', pg_temp.t3802w_get(r1, 'status') || '/' || coalesce(pg_temp.t3802w_get(r1, 'replayed'), '<first>'), 'created/<first>');
  perform pg_temp.t3802w_keep('replay', pg_temp.t3802w_get(r1, 'record', 'id'));
  v_before := pg_temp.t3802w_snapshot();
  v_audit := pg_temp.t3802w_audit();

  r2 := pg_temp.t3802w_as('growth', $q$select public.crm_record_create('hosts', '{"name": "Replay Venue", "icp": "restaurant_bar"}'::jsonb, 'w15-create-0001')::text$q$);
  perform pg_temp.t3802w_check('W1-5', 'replayed create is marked', pg_temp.t3802w_get(r2, 'replayed'), 'true');
  perform pg_temp.t3802w_check('W1-5', 'replayed create returns the first answer',
    (pg_temp.t3802w_jb(r2) - 'replayed')::text, pg_temp.t3802w_jb(r1)::text);
  -- A replay with different words still answers with the first result.
  r2 := pg_temp.t3802w_as('growth', $q$select public.crm_record_create('creators', '{"name": "Something Else"}'::jsonb, 'w15-create-0001')::text$q$);
  perform pg_temp.t3802w_check('W1-5', 'a replay never runs a second request',
    pg_temp.t3802w_get(r2, 'record', 'id') || '/' || pg_temp.t3802w_get(r2, 'replayed'), pg_temp.t3802w_id('replay') || '/true');
  perform pg_temp.t3802w_check('W1-5', 'replays wrote nothing', pg_temp.t3802w_snapshot(), v_before);
  perform pg_temp.t3802w_check('W1-5', 'replays wrote no audit row', pg_temp.t3802w_audit()::text, v_audit::text);

  -- Another person may use the same key: keys are per person.
  r2 := pg_temp.t3802w_as('partner', $q$select public.crm_record_create('hosts', '{"name": "Replay Venue Two"}'::jsonb, 'w15-create-0001')::text$q$);
  perform pg_temp.t3802w_check('W1-5', 'the same key from another person is its own request',
    pg_temp.t3802w_get(r2, 'status') || '/' || coalesce(pg_temp.t3802w_get(r2, 'replayed'), '<first>'), 'created/<first>');

  -- Log entries.
  r1 := pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "Called, no answer."}'::jsonb, 'w15-log-0001')::text$q$, pg_temp.t3802w_id('replay')));
  perform pg_temp.t3802w_check('W1-5', 'first log entry', pg_temp.t3802w_get(r1, 'activity', 'body'), 'Called, no answer.');
  v_before := pg_temp.t3802w_snapshot();
  v_audit := pg_temp.t3802w_audit();
  r2 := pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "Called, no answer."}'::jsonb, 'w15-log-0001')::text$q$, pg_temp.t3802w_id('replay')));
  perform pg_temp.t3802w_check('W1-5', 'replayed log entry is marked and identical',
    pg_temp.t3802w_get(r2, 'replayed') || '/' || ((pg_temp.t3802w_jb(r2) - 'replayed') = pg_temp.t3802w_jb(r1))::text, 'true/true');
  perform pg_temp.t3802w_check('W1-5', 'the log has one such line',
    (select count(*)::text from public.crm_activity where record_id = pg_temp.t3802w_uuid(pg_temp.t3802w_id('replay')) and kind = 'note'), '1');
  perform pg_temp.t3802w_check('W1-5', 'the replayed log entry wrote nothing', pg_temp.t3802w_snapshot(), v_before);
  perform pg_temp.t3802w_check('W1-5', 'the replayed log entry wrote no audit row', pg_temp.t3802w_audit()::text, v_audit::text);

  -- A key belongs to one kind of request.
  perform pg_temp.t3802w_like('W1-5', 'a create key cannot be reused for a log entry',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "x"}'::jsonb, 'w15-create-0001')::text$q$, pg_temp.t3802w_id('replay'))),
    'ERR:22023:request_key_reused:%');
  perform pg_temp.t3802w_like('W1-5', 'a log key cannot be reused for a create',
    pg_temp.t3802w_as('growth', $q$select public.crm_record_create('hosts', '{"name": "Key Reuse"}'::jsonb, 'w15-log-0001')::text$q$),
    'ERR:22023:request_key_reused:%');
  perform pg_temp.t3802w_like('W1-5', 'a create key cannot be reused for a bulk create',
    pg_temp.t3802w_as('growth', $q$select public.crm_records_bulk_create('hosts', '[{"name": "Key Reuse"}]'::jsonb, 'w15-create-0001')::text$q$),
    'ERR:22023:request_key_reused:%');

  -- A key is required and has a shape.
  perform pg_temp.t3802w_like('W1-5', 'create without a key',
    pg_temp.t3802w_as('growth', $q$select public.crm_record_create('hosts', '{"name": "No Key"}'::jsonb, null)::text$q$),
    'ERR:22023:request_key_required: Send a request key (8 to 80 letters, digits, - or _) so a repeat changes nothing.');
  perform pg_temp.t3802w_like('W1-5', 'create with a short key',
    pg_temp.t3802w_as('growth', $q$select public.crm_record_create('hosts', '{"name": "No Key"}'::jsonb, 'short')::text$q$),
    'ERR:22023:request_key_required:%');
  perform pg_temp.t3802w_like('W1-5', 'create with a key that has other characters',
    pg_temp.t3802w_as('growth', $q$select public.crm_record_create('hosts', '{"name": "No Key"}'::jsonb, 'has spaces in it')::text$q$),
    'ERR:22023:request_key_required:%');
  perform pg_temp.t3802w_like('W1-5', 'log without a key',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "x"}'::jsonb, null)::text$q$, pg_temp.t3802w_id('replay'))),
    'ERR:22023:request_key_required:%');
  perform pg_temp.t3802w_like('W1-5', 'bulk create without a key',
    pg_temp.t3802w_as('growth', $q$select public.crm_records_bulk_create('hosts', '[{"name": "No Key"}]'::jsonb, '')::text$q$),
    'ERR:22023:request_key_required:%');
  perform pg_temp.t3802w_check('W1-5', 'nothing called No Key or Key Reuse exists',
    (select count(*)::text from public.crm_records where name in ('No Key', 'Key Reuse', 'Something Else')), '0');
end;
$w5$;

-- ---------------------------------------------------------------------------
-- W1-6 — bulk create.
-- ---------------------------------------------------------------------------
do $w6$
declare
  v_items jsonb;
  r text;
  r2 text;
  v_n int;
  v_audit int;
  v_before text;
begin
  -- 45 new names, 3 duplicates (two of a record that exists, one repeated
  -- inside this request), 2 invalid. 50 in all.
  select jsonb_agg(x.item order by x.ord) into v_items from (
    select g as ord, jsonb_build_object('name', 'Bulk Host ' || lpad(g::text, 2, '0'), 'icp', 'venue_gallery') as item
      from generate_series(1, 45) g
    union all select 46, '{"name": "palm court kitchen"}'::jsonb
    union all select 47, '{"name": "@PalmCourtKitchen", "source": "instagram"}'::jsonb
    union all select 48, '{"name": "BULK-HOST 01"}'::jsonb
    union all select 49, '{"name": "   "}'::jsonb
    union all select 50, '{"name": "Bulk Bad ICP", "icp": "ambassador"}'::jsonb
  ) x;
  select count(*) into v_n from public.crm_records;
  v_audit := pg_temp.t3802w_audit();

  r := pg_temp.t3802w_as('partner', format($q$select public.crm_records_bulk_create('hosts', %L::jsonb, 'w16-bulk-0001')::text$q$, v_items::text));
  perform pg_temp.t3802w_check('W1-6', '50 items: 45 created, 3 skipped, 2 invalid',
    jsonb_array_length(pg_temp.t3802w_jb(r) -> 'created') || '/' || jsonb_array_length(pg_temp.t3802w_jb(r) -> 'skipped') || '/' || jsonb_array_length(pg_temp.t3802w_jb(r) -> 'invalid'),
    '45/3/2');
  perform pg_temp.t3802w_check('W1-6', '45 records were written', (select (count(*) - v_n)::text from public.crm_records), '45');
  perform pg_temp.t3802w_check('W1-6', 'skipped items say which and why',
    (select string_agg((s->>'index') || ':' || (s->>'reason') || ':' || (s #>> '{existing,name}'), ',' order by (s->>'index')::int)
       from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'skipped') s),
    '45:duplicate:Palm Court Kitchen,46:duplicate:Palm Court Kitchen,47:duplicate:Bulk Host 01');
  perform pg_temp.t3802w_check('W1-6', 'invalid items say which and why',
    (select string_agg((s->>'index') || ':' || split_part(s->>'error', ':', 1), ',' order by (s->>'index')::int)
       from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'invalid') s),
    '48:invalid_name,49:invalid_icp');
  perform pg_temp.t3802w_check('W1-6', 'an invalid item explains itself',
    pg_temp.t3802w_jb(r) #>> '{invalid,1,error}',
    'invalid_icp: ambassador is not an ICP for hosts. Use one of: restaurant_bar, venue_gallery, event_organizer, community_host, trip_stay_host, partner_org.');
  perform pg_temp.t3802w_check('W1-6', 'created items keep their position and are owned by the sender',
    (pg_temp.t3802w_jb(r) #>> '{created,0,index}') || '/' || (pg_temp.t3802w_jb(r) #>> '{created,44,index}') || '/' || (pg_temp.t3802w_jb(r) #>> '{created,44,record,name}')
      || '/' || (pg_temp.t3802w_jb(r) #>> '{created,44,record,owners}') || '/' || (pg_temp.t3802w_jb(r) #>> '{created,44,record,icp}'),
    '0/44/Bulk Host 45/["issue3802w-partner@test.local"]/venue_gallery');
  perform pg_temp.t3802w_check('W1-10', 'bulk: one summary audit row plus one per record',
    (pg_temp.t3802w_audit() - v_audit)::text, '46');
  perform pg_temp.t3802w_check('W1-10', 'bulk: the summary row carries the three counts',
    (select (metadata->>'created') || '/' || (metadata->>'skipped') || '/' || (metadata->>'invalid') || '/' || admin_email
       from public.admin_audit_log where action = 'crm.bulk_create' and target_id = 'hosts'
       order by created_at desc limit 1),
    '45/3/2/issue3802w-partner@test.local');

  v_before := pg_temp.t3802w_snapshot();
  v_audit := pg_temp.t3802w_audit();
  r2 := pg_temp.t3802w_as('partner', format($q$select public.crm_records_bulk_create('hosts', %L::jsonb, 'w16-bulk-0001')::text$q$, v_items::text));
  perform pg_temp.t3802w_check('W1-6', 'a repeated bulk request returns the first answer',
    pg_temp.t3802w_get(r2, 'replayed') || '/' || ((pg_temp.t3802w_jb(r2) - 'replayed') = pg_temp.t3802w_jb(r))::text, 'true/true');
  perform pg_temp.t3802w_check('W1-6', 'a repeated bulk request wrote nothing', pg_temp.t3802w_snapshot(), v_before);
  perform pg_temp.t3802w_check('W1-10', 'a repeated bulk request wrote no audit row', pg_temp.t3802w_audit()::text, v_audit::text);

  -- 51 items.
  select jsonb_agg(jsonb_build_object('name', 'Too Many ' || g)) into v_items from generate_series(1, 51) g;
  perform pg_temp.t3802w_check('W1-6', '51 items are refused',
    pg_temp.t3802w_as('partner', format($q$select public.crm_records_bulk_create('hosts', %L::jsonb, 'w16-bulk-0002')::text$q$, v_items::text)),
    'ERR:22023:too_many: Send at most 50 records in one request.');
  perform pg_temp.t3802w_check('W1-6', 'and none of the 51 was written',
    (select count(*)::text from public.crm_records where name like 'Too Many %'), '0');
  perform pg_temp.t3802w_like('W1-6', 'an empty list is refused',
    pg_temp.t3802w_as('partner', $q$select public.crm_records_bulk_create('hosts', '[]'::jsonb, 'w16-bulk-0003')::text$q$), 'ERR:22023:invalid_items:%');
  perform pg_temp.t3802w_like('W1-6', 'something that is not a list is refused',
    pg_temp.t3802w_as('partner', $q$select public.crm_records_bulk_create('hosts', '{"name": "x"}'::jsonb, 'w16-bulk-0004')::text$q$), 'ERR:22023:invalid_items:%');
  perform pg_temp.t3802w_like('W1-6', 'an unknown pipeline is refused',
    pg_temp.t3802w_as('partner', $q$select public.crm_records_bulk_create('venues', '[{"name": "x"}]'::jsonb, 'w16-bulk-0005')::text$q$), 'ERR:22023:invalid_pipeline:%');
  -- One item that is not an object does not stop the others.
  r := pg_temp.t3802w_as('partner', $q$select public.crm_records_bulk_create('creators', '[{"name": "@bulkone"}, "just text", {"name": "@bulktwo", "stage": "booked"}]'::jsonb, 'w16-bulk-0006')::text$q$);
  perform pg_temp.t3802w_check('W1-6', 'a bad item never stops the rest',
    jsonb_array_length(pg_temp.t3802w_jb(r) -> 'created') || '/' || jsonb_array_length(pg_temp.t3802w_jb(r) -> 'invalid') || '/'
      || split_part(pg_temp.t3802w_jb(r) #>> '{invalid,0,error}', ':', 1) || '/' || split_part(pg_temp.t3802w_jb(r) #>> '{invalid,1,error}', ':', 1),
    '1/2/invalid_fields/unknown_field');
end;
$w6$;

-- ---------------------------------------------------------------------------
-- Field validation (shared by create, bulk create and update).
-- ---------------------------------------------------------------------------
do $fields$
declare
  r text;
  f record;
begin
  r := pg_temp.t3802w_make('full', 'growth', 'hosts', format(
    '{"name": " Full   Host ", "icp": "event_organizer", "region_id": "38020000-0000-4000-c200-000000000001", "contact": " Ada · ada@example.com ", "channel": "whatsapp", "source": "referral", "next_action": "Send deck", "due_on": "2026-10-31", "place_pool_id": "38020000-0000-4000-c500-000000000001", "owners": ["ISSUE3802W-partner@test.local ", "issue3802w-growth@test.local", "issue3802w-partner@test.local"]}'));
  perform pg_temp.t3802w_check('W1-4', 'create stores every field, tidied',
    concat_ws('|', pg_temp.t3802w_get(r, 'record', 'name'), pg_temp.t3802w_get(r, 'record', 'icp'), pg_temp.t3802w_get(r, 'record', 'region_id'),
      pg_temp.t3802w_get(r, 'record', 'contact'), pg_temp.t3802w_get(r, 'record', 'channel'), pg_temp.t3802w_get(r, 'record', 'source'),
      pg_temp.t3802w_get(r, 'record', 'next_action'), pg_temp.t3802w_get(r, 'record', 'due_on'), pg_temp.t3802w_get(r, 'record', 'place_name'),
      pg_temp.t3802w_get(r, 'record', 'owners'), pg_temp.t3802w_get(r, 'record', 'stage')),
    'Full Host|event_organizer|38020000-0000-4000-c200-000000000001|Ada · ada@example.com|whatsapp|referral|Send deck|2026-10-31|Issue3802w Palm Place|["issue3802w-growth@test.local", "issue3802w-partner@test.local"]|prospect');
  r := pg_temp.t3802w_make('unowned', 'growth', 'hosts', '{"name": "Unassigned Host", "owners": []}');
  perform pg_temp.t3802w_check('W1-4', 'an empty owners list means unassigned', pg_temp.t3802w_get(r, 'record', 'owners'), '[]');

  for f in
    select * from (values
      ('hosts',    '{"name": "V1", "stage": "live"}',                         'ERR:22023:unknown_field:%'),
      ('hosts',    '{"name": "V2", "icp": "ambassador"}',                     'ERR:22023:invalid_icp:%'),
      ('hosts',    '{"name": "V3", "region_id": "38020000-0000-4000-cfff-00000000dead"}', 'ERR:22023:invalid_region:%'),
      ('hosts',    '{"name": "V4", "region_id": "not-a-uuid"}',               'ERR:22023:invalid_region:%'),
      ('hosts',    '{"name": "V5", "channel": "fax"}',                        'ERR:22023:invalid_channel: fax is not a known channel. Use one of: email, whatsapp, instagram_dm, tiktok_dm, phone, in_person.'),
      ('hosts',    '{"name": "V6", "source": "billboard"}',                   'ERR:22023:invalid_source:%'),
      ('hosts',    '{"name": "V7", "due_on": "31/10/2026"}',                  'ERR:22023:invalid_due_on:%'),
      ('hosts',    '{"name": "V8", "due_on": "2026-13-45"}',                  'ERR:22023:invalid_due_on:%'),
      ('hosts',    '{"name": "V9", "brand_id": "38020000-0000-4000-c100-000000000003"}', 'ERR:22023:invalid_brand:%'),
      ('hosts',    '{"name": "V10", "brand_id": "38020000-0000-4000-cfff-00000000dead"}', 'ERR:22023:invalid_brand:%'),
      ('hosts',    '{"name": "V11", "place_pool_id": "38020000-0000-4000-cfff-00000000dead"}', 'ERR:22023:invalid_place:%'),
      ('hosts',    '{"name": "V12", "followers": 10}',                        'ERR:22023:field_not_for_pipeline: "followers" only applies to Creators. Leave it out for a host.'),
      ('hosts',    '{"name": "V13", "agreement": "signed"}',                  'ERR:22023:field_not_for_pipeline:%'),
      ('creators', '{"name": "V14", "brand_id": "38020000-0000-4000-c100-000000000001"}', 'ERR:22023:field_not_for_pipeline: "brand_id" only applies to Hosts. Leave it out for a creator.'),
      ('creators', '{"name": "V15", "followers": -1}',                        'ERR:22023:invalid_followers:%'),
      ('creators', '{"name": "V16", "followers": "lots"}',                    'ERR:22023:invalid_followers:%'),
      ('creators', '{"name": "V17", "agreement": "verbal"}',                  'ERR:22023:invalid_agreement:%'),
      ('creators', '{"name": "V18", "icp": "restaurant_bar"}',                'ERR:22023:invalid_icp:%'),
      ('hosts',    '{"icp": "restaurant_bar"}',                               'ERR:22023:invalid_name:%'),
      ('hosts',    '{"name": ["a", "b"]}',                                    'ERR:22023:invalid_value:%'),
      ('hosts',    '{"name": "V21", "owners": ["nobody@test.local"]}',        'ERR:22023:unknown_owner: nobody@test.local is not on the team.%'),
      ('hosts',    '{"name": "V22", "owners": ["issue3802w-revoked@test.local"]}', 'ERR:22023:unknown_owner:%'),
      ('hosts',    '{"name": "V23", "owners": "issue3802w-growth@test.local"}', 'ERR:22023:invalid_owners:%'),
      ('venues',   '{"name": "V24"}',                                         'ERR:22023:invalid_pipeline:%')
    ) as v(pipeline, fields, want)
  loop
    perform pg_temp.t3802w_like('W1-4', 'create refuses ' || f.fields,
      pg_temp.t3802w_as('growth', format($q$select public.crm_record_create(%L, %L::jsonb, %L)::text$q$, f.pipeline, f.fields, 'wf-' || md5(f.fields))),
      f.want);
  end loop;
  perform pg_temp.t3802w_like('W1-4', 'a 161-character name is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_create('hosts', %L::jsonb, 'wf-long-name-1')::text$q$, json_build_object('name', repeat('n', 161))::text)),
    'ERR:22023:invalid_name:%');
  perform pg_temp.t3802w_check('W1-4', 'no refused create left a record',
    (select count(*)::text from public.crm_records where name ~ '^V[0-9]+$' or name like 'nnnn%'), '0');

  -- Update: patch, clear, no change, unknown key.
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"contact": "", "channel": null, "due_on": "2026-11-05", "icp": "partner_org"}'::jsonb)::text$q$, pg_temp.t3802w_id('full')));
  perform pg_temp.t3802w_check('W1-4', 'update patches and clears',
    concat_ws('|', pg_temp.t3802w_get(r, 'changed'), coalesce(pg_temp.t3802w_get(r, 'record', 'contact'), '<null>'),
      coalesce(pg_temp.t3802w_get(r, 'record', 'channel'), '<null>'), pg_temp.t3802w_get(r, 'record', 'due_on'),
      pg_temp.t3802w_get(r, 'record', 'icp'), pg_temp.t3802w_get(r, 'record', 'source')),
    'true|<null>|<null>|2026-11-05|partner_org|referral');
  perform pg_temp.t3802w_check('W1-10', 'update audit row holds only the changed keys, before and after',
    (select (metadata->'before')::text || ' -> ' || (metadata->'after')::text || ' by ' || admin_email
       from public.admin_audit_log where action = 'crm.record_update' and target_id = pg_temp.t3802w_id('full')
       order by created_at desc limit 1),
    '{"icp": "event_organizer", "due_on": "2026-10-31", "channel": "whatsapp", "contact": "Ada · ada@example.com"} -> {"icp": "partner_org", "due_on": "2026-11-05", "channel": null, "contact": null} by issue3802w-partner@test.local');
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"place_pool_id": null}'::jsonb)::text$q$, pg_temp.t3802w_id('full')));
  perform pg_temp.t3802w_check('W1-4', 'update removes the place link',
    pg_temp.t3802w_get(r, 'changed') || '/' || coalesce(pg_temp.t3802w_get(r, 'record', 'place_pool_id'), '<none>') || '/' || coalesce(pg_temp.t3802w_get(r, 'record', 'place_name'), '<none>'),
    'true/<none>/<none>');
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"place_pool_id": "38020000-0000-4000-c500-000000000001"}'::jsonb)::text$q$, pg_temp.t3802w_id('full')));
  perform pg_temp.t3802w_check('W1-4', 'update sets the place link, and says so in the audit row',
    pg_temp.t3802w_get(r, 'record', 'place_pool_id') || '/' || pg_temp.t3802w_get(r, 'record', 'place_name') || '/'
      || (select (metadata->'before')::text || ' -> ' || (metadata->'after')::text from public.admin_audit_log
           where action = 'crm.record_update' and target_id = pg_temp.t3802w_id('full') order by created_at desc limit 1),
    '38020000-0000-4000-c500-000000000001/Issue3802w Palm Place/{"place_pool_id": null} -> {"place_pool_id": "38020000-0000-4000-c500-000000000001"}');
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"place_pool_id": "38020000-0000-4000-c500-000000000001"}'::jsonb)::text$q$, pg_temp.t3802w_id('full')));
  perform pg_temp.t3802w_check('W1-4', 'the same place link again changes nothing', pg_temp.t3802w_get(r, 'changed'), 'false');
  perform pg_temp.t3802w_check('W1-4', 'update refuses stage',
    pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"stage": "live"}'::jsonb)::text$q$, pg_temp.t3802w_id('full'))),
    'ERR:22023:unknown_field: "stage" cannot be changed here. Use crm_record_move_stage for stage and crm_record_set_owners for owners.');
  perform pg_temp.t3802w_like('W1-4', 'update refuses owners',
    pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"owners": []}'::jsonb)::text$q$, pg_temp.t3802w_id('full'))),
    'ERR:22023:unknown_field: "owners" cannot be changed here.%');
  perform pg_temp.t3802w_like('W1-4', 'update refuses an internal column',
    pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"deleted_at": null, "went_live_at": "2026-01-01", "beta_lead_id": null}'::jsonb)::text$q$, pg_temp.t3802w_id('full'))),
    'ERR:22023:unknown_field:%');
  perform pg_temp.t3802w_like('W1-4', 'update cannot blank the name',
    pg_temp.t3802w_as('partner', format($q$select public.crm_record_update(%L, '{"name": ""}'::jsonb)::text$q$, pg_temp.t3802w_id('full'))),
    'ERR:22023:invalid_name:%');
  perform pg_temp.t3802w_like('W1-4', 'update of a record that is not there',
    pg_temp.t3802w_as('partner', $q$select public.crm_record_update('38020000-0000-4000-cfff-000000000009', '{"contact": "x"}'::jsonb)::text$q$),
    'ERR:P0002:not_found:%');

  -- Owners.
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_set_owners(%L, array[' Issue3802W-Admin@test.local', 'issue3802w-invited@test.local', 'issue3802w-admin@test.local'])::text$q$, pg_temp.t3802w_id('full')));
  perform pg_temp.t3802w_check('W1-4', 'owners are replaced, normalised and de-duplicated',
    pg_temp.t3802w_get(r, 'changed') || '/' || pg_temp.t3802w_get(r, 'record', 'owners'),
    'true/["issue3802w-admin@test.local", "issue3802w-invited@test.local"]');
  perform pg_temp.t3802w_check('W1-10', 'owners audit row has before and after',
    (select (metadata->'before')::text || ' -> ' || (metadata->'after')::text
       from public.admin_audit_log where action = 'crm.owners_set' and target_id = pg_temp.t3802w_id('full')
       order by created_at desc limit 1),
    '["issue3802w-growth@test.local", "issue3802w-partner@test.local"] -> ["issue3802w-admin@test.local", "issue3802w-invited@test.local"]');
  perform pg_temp.t3802w_like('W1-4', 'an owner who is not on the team is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_set_owners(%L, array['issue3802w-consumer@test.local'])::text$q$, pg_temp.t3802w_id('full'))),
    'ERR:22023:unknown_owner: issue3802w-consumer@test.local is not on the team.%');
  perform pg_temp.t3802w_like('W1-4', 'more than 10 owners is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_set_owners(%L, (select array_agg('p' || g || '@test.local') from generate_series(1, 11) g))::text$q$, pg_temp.t3802w_id('full'))),
    'ERR:22023:too_many_owners:%');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_set_owners(%L, null)::text$q$, pg_temp.t3802w_id('full')));
  perform pg_temp.t3802w_check('W1-4', 'no owners means unassigned',
    pg_temp.t3802w_get(r, 'changed') || '/' || pg_temp.t3802w_get(r, 'record', 'owners'), 'true/[]');
end;
$fields$;

-- ---------------------------------------------------------------------------
-- W1-7 — stage rules.
-- ---------------------------------------------------------------------------
do $w7$
declare
  r text;
  v_id text;
  v_cid text;
begin
  r := pg_temp.t3802w_make('stage', 'growth', 'hosts', '{"name": "Stage Rules Host"}');
  v_id := pg_temp.t3802w_id('stage');
  perform pg_temp.t3802w_check('W1-7', 'a stage of the other pipeline is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'booked')::text$q$, v_id)),
    'ERR:22023:invalid_stage: booked is not a stage of hosts. Use one of: prospect, contacted, replied, meeting, onboarded, live, lost.');
  perform pg_temp.t3802w_like('W1-7', 'no stage at all is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, null)::text$q$, v_id)), 'ERR:22023:invalid_stage:%');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'prospect')::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-7', 'moving to the same stage changes nothing',
    pg_temp.t3802w_get(r, 'changed') || '/' || coalesce(pg_temp.t3802w_get(r, 'activity_id'), '<none>'), 'false/<none>');
  perform pg_temp.t3802w_check('W1-7', 'a person can never set Live',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'live')::text$q$, v_id)),
    'ERR:22023:stage_sets_itself: Live sets itself when the linked brand has a public listing. Move the card to Onboarded and link the brand instead.');
  perform pg_temp.t3802w_check('W1-7', 'nor can the owner',
    left(pg_temp.t3802w_as('owner', format($q$select public.crm_record_move_stage(%L, 'live', 'please')::text$q$, v_id)), 27),
    'ERR:22023:stage_sets_itself');
  perform pg_temp.t3802w_check('W1-7', 'Lost without a reason is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost')::text$q$, v_id)),
    'ERR:22023:reason_required: Add one line saying why, so the next person knows.');
  perform pg_temp.t3802w_like('W1-7', 'Lost with only spaces is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', '   ')::text$q$, v_id)), 'ERR:22023:reason_required:%');
  perform pg_temp.t3802w_like('W1-7', 'Lost with a 301-character reason is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', repeat('x', 301))::text$q$, v_id)), 'ERR:22023:reason_required:%');
  perform pg_temp.t3802w_check('W1-7', 'still in Prospect after every refusal',
    (select stage || '/' || coalesce(stage_reason, '<none>') from public.crm_records where id = pg_temp.t3802w_uuid(v_id)), 'prospect/<none>');

  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'meeting', 'not a terminal stage')::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-7', 'a normal move stores no reason',
    pg_temp.t3802w_get(r, 'record', 'stage') || '/' || coalesce(pg_temp.t3802w_get(r, 'record', 'stage_reason'), '<none>'), 'meeting/<none>');
  perform pg_temp.t3802w_check('W1-7', 'the move is logged with both stages',
    (select from_stage || '>' || to_stage || '/' || actor_email || '/' || coalesce(body, '<none>')
       from public.crm_activity where id = pg_temp.t3802w_uuid(pg_temp.t3802w_get(r, 'activity_id'))),
    'prospect>meeting/issue3802w-growth@test.local/<none>');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', '  Closed for the season  ')::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-7', 'Lost with a reason stores it',
    pg_temp.t3802w_get(r, 'record', 'stage') || '/' || pg_temp.t3802w_get(r, 'record', 'stage_reason'), 'lost/Closed for the season');
  perform pg_temp.t3802w_check('W1-7', 'and logs it',
    (select from_stage || '>' || to_stage || '/' || body from public.crm_activity where id = pg_temp.t3802w_uuid(pg_temp.t3802w_get(r, 'activity_id'))),
    'meeting>lost/Closed for the season');
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-7', 'moving out of Lost clears the reason',
    pg_temp.t3802w_get(r, 'record', 'stage') || '/' || coalesce(pg_temp.t3802w_get(r, 'record', 'stage_reason'), '<none>'), 'contacted/<none>');
  perform pg_temp.t3802w_like('W1-7', 'moving a record that is not there',
    pg_temp.t3802w_as('partner', $q$select public.crm_record_move_stage('38020000-0000-4000-cfff-000000000009', 'contacted')::text$q$), 'ERR:P0002:not_found:%');

  -- Creators: Booked needs the agreement marked signed.
  r := pg_temp.t3802w_make('creator', 'growth', 'creators', '{"name": "@stagecreator", "followers": 12000, "agreement": "sent", "rate": "$200 a post"}');
  v_cid := pg_temp.t3802w_id('creator');
  perform pg_temp.t3802w_check('W1-7', 'a creator keeps its deal fields',
    pg_temp.t3802w_get(r, 'record', 'followers') || '/' || pg_temp.t3802w_get(r, 'record', 'agreement') || '/' || pg_temp.t3802w_get(r, 'record', 'rate')
      || '/' || pg_temp.t3802w_get(r, 'record', 'stage'), '12000/sent/$200 a post/identified');
  perform pg_temp.t3802w_check('W1-7', 'Booked without a signed agreement is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'booked')::text$q$, v_cid)),
    'ERR:22023:agreement_required: Mark the agreement as signed before moving to Booked.');
  perform pg_temp.t3802w_like('W1-7', 'a host stage is not a creator stage',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'onboarded')::text$q$, v_cid)), 'ERR:22023:invalid_stage:%');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_update(%L, '{"agreement": "signed"}'::jsonb)::text$q$, v_cid));
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'booked')::text$q$, v_cid));
  perform pg_temp.t3802w_check('W1-7', 'Booked with a signed agreement is allowed', pg_temp.t3802w_get(r, 'record', 'stage'), 'booked');
  perform pg_temp.t3802w_like('W1-7', 'Passed without a reason is refused',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'passed')::text$q$, v_cid)), 'ERR:22023:reason_required:%');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'passed', 'Rate too high')::text$q$, v_cid));
  perform pg_temp.t3802w_check('W1-7', 'Passed with a reason stores it',
    pg_temp.t3802w_get(r, 'record', 'stage') || '/' || pg_temp.t3802w_get(r, 'record', 'stage_reason'), 'passed/Rate too high');

  -- The table agrees, for a writer that skips the functions.
  perform pg_temp.t3802w_like('W1-7', 'the table refuses Lost without a reason',
    pg_temp.t3802w_as('postgres', format($q$with x as (update public.crm_records set stage = 'lost', stage_reason = null where id = %L returning 1) select count(*)::text from x$q$, v_id)),
    'ERR:23514:%crm_records_reason_check%');
  perform pg_temp.t3802w_like('W1-7', 'the table refuses a reason on a stage that is not terminal',
    pg_temp.t3802w_as('postgres', format($q$with x as (update public.crm_records set stage_reason = 'why' where id = %L returning 1) select count(*)::text from x$q$, v_id)),
    'ERR:23514:%crm_records_reason_check%');
  perform pg_temp.t3802w_like('W1-7', 'the table refuses a creator stage on a host',
    pg_temp.t3802w_as('postgres', format($q$with x as (update public.crm_records set stage = 'booked' where id = %L returning 1) select count(*)::text from x$q$, v_id)),
    'ERR:23514:%crm_records_stage_check%');
  perform pg_temp.t3802w_like('W1-7', 'the table refuses a brand on a creator',
    pg_temp.t3802w_as('postgres', format($q$with x as (update public.crm_records set brand_id = '38020000-0000-4000-c100-000000000001' where id = %L returning 1) select count(*)::text from x$q$, v_cid)),
    'ERR:23514:%crm_records_host_only%');
end;
$w7$;

-- ---------------------------------------------------------------------------
-- W1-8 — Live sets itself from the linked brand's public listing.
-- ---------------------------------------------------------------------------
do $w8$
declare
  r text;
  v_q text;
  v_l text;
  v_lost text;
  v_un text;
  v_venue text;
  v_audit int;
  v_before text;
begin
  perform pg_temp.t3802w_check('W1-8', 'what counts as a public listing',
    concat_ws(',', public.crm_brand_is_live('38020000-0000-4000-c100-000000000001')::text,
      public.crm_brand_is_live('38020000-0000-4000-c100-000000000002')::text,
      public.crm_brand_is_live('38020000-0000-4000-c100-000000000003')::text,
      public.crm_brand_is_live('38020000-0000-4000-c100-000000000006')::text,
      public.crm_brand_is_live('38020000-0000-4000-cfff-00000000dead')::text,
      public.crm_brand_is_live(null)::text),
    'true,false,false,true,false,false');

  -- Linking a brand with no listing moves a Prospect to Onboarded.
  r := pg_temp.t3802w_make('quiet', 'growth', 'hosts', '{"name": "Quiet Host"}');
  v_q := pg_temp.t3802w_id('quiet');
  v_audit := pg_temp.t3802w_audit();
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_update(%L, '{"brand_id": "38020000-0000-4000-c100-000000000002"}'::jsonb)::text$q$, v_q));
  perform pg_temp.t3802w_check('W1-8', 'linking a brand moves Prospect to Onboarded',
    pg_temp.t3802w_get(r, 'moved_to') || '/' || pg_temp.t3802w_get(r, 'record', 'stage') || '/' || pg_temp.t3802w_get(r, 'record', 'brand_name'),
    'onboarded/onboarded/Issue3802w Quiet Brand');
  perform pg_temp.t3802w_check('W1-8', 'with a system log line',
    (select string_agg(coalesce(actor_email, '<system>') || '/' || via || '/' || from_stage || '>' || to_stage || '/' || body, ' ;; ' order by created_at)
       from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_q) and kind = 'stage_move'),
    '<system>/system/prospect>onboarded/Linked to Issue3802w Quiet Brand. Stage moved to Onboarded.');
  perform pg_temp.t3802w_check('W1-10', 'the link wrote one audit row, with the move noted',
    (pg_temp.t3802w_audit() - v_audit)::text || '/' || (select metadata->>'moved_to' from public.admin_audit_log
       where action = 'crm.record_update' and target_id = v_q order by created_at desc limit 1), '1/onboarded');
  perform pg_temp.t3802w_check('W1-8', 'the record view shows the brand has no listing yet',
    pg_temp.t3802w_get(pg_temp.t3802w_as('partner', format($q$select public.crm_record_get(%L)::text$q$, v_q)), 'links', 'brand'),
    '{"id": "38020000-0000-4000-c100-000000000002", "name": "Issue3802w Quiet Brand", "slug": "issue3802w-quiet-brand", "is_live": false}');

  -- Nothing to promote yet. Run the way the schedule runs it: no signed-in
  -- person, no request claims.
  perform pg_temp.t3802w_check('W1-8', 'the scheduled run promotes nothing while there is no listing',
    pg_temp.t3802w_as('postgres', $q$select public.crm_reconcile_live()::text$q$), '0');

  -- The brand publishes its first event.
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status) values
    ('38020000-0000-4000-c400-000000000002', '38020000-0000-4000-c100-000000000002', 'Issue3802w first listing', 'issue3802w-first-listing', 'public', 'live');
  set local session_replication_role = origin;
  v_audit := pg_temp.t3802w_audit();
  perform pg_temp.t3802w_check('W1-8', 'the scheduled run promotes the host once',
    pg_temp.t3802w_as('postgres', $q$select public.crm_reconcile_live()::text$q$), '1');
  perform pg_temp.t3802w_check('W1-8', 'the host is Live, with the time it went live',
    (select stage || '/' || (went_live_at is not null)::text || '/' || updated_by from public.crm_records where id = pg_temp.t3802w_uuid(v_q)), 'live/true/system');
  perform pg_temp.t3802w_check('W1-8', 'with one system log line for Live',
    (select count(*)::text || '/' || max(coalesce(actor_email, '<system>') || '/' || via || '/' || from_stage || '>' || to_stage || '/' || body)
       from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_q) and to_stage = 'live'),
    '1/<system>/system/onboarded>live/First listing went live. Stage moved to Live automatically.');
  perform pg_temp.t3802w_check('W1-10', 'and one audit row by the system',
    (pg_temp.t3802w_audit() - v_audit)::text || '/' || (select admin_email || '/' || (metadata->>'from') || '>' || (metadata->>'to') || '/' || (actor_uid is null)::text
       from public.admin_audit_log where action = 'crm.stage_auto_live' and target_id = v_q), '1/system/onboarded>live/true');
  v_before := pg_temp.t3802w_snapshot();
  v_audit := pg_temp.t3802w_audit();
  perform pg_temp.t3802w_check('W1-8', 'a second run promotes nothing',
    pg_temp.t3802w_as('postgres', $q$select public.crm_reconcile_live()::text$q$), '0');
  perform pg_temp.t3802w_check('W1-8', 'a second run as the service role promotes nothing either',
    pg_temp.t3802w_as('service', $q$select public.crm_reconcile_live()::text$q$), '0');
  perform pg_temp.t3802w_check('W1-8', 'a second run wrote nothing', pg_temp.t3802w_snapshot(), v_before);
  perform pg_temp.t3802w_check('W1-10', 'a second run wrote no audit row', pg_temp.t3802w_audit()::text, v_audit::text);

  -- A Live host only moves to Lost.
  perform pg_temp.t3802w_check('W1-7', 'a Live host cannot be moved back',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'onboarded')::text$q$, v_q)),
    'ERR:22023:stage_is_live: This host has a public listing, so it stays in Live. Mark it as lost if the relationship ended.');
  perform pg_temp.t3802w_like('W1-7', 'nor to the first stage',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_move_stage(%L, 'prospect')::text$q$, v_q)), 'ERR:22023:stage_is_live:%');
  perform pg_temp.t3802w_like('W1-7', 'Lost from Live still needs a reason',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost')::text$q$, v_q)), 'ERR:22023:reason_required:%');

  -- The listing ends: the host is not demoted.
  set local session_replication_role = replica;
  delete from public.events where id = '38020000-0000-4000-c400-000000000002';
  set local session_replication_role = origin;
  perform pg_temp.t3802w_check('W1-8', 'a host is not demoted when the listing ends',
    pg_temp.t3802w_as('postgres', $q$select public.crm_reconcile_live()::text$q$) || '/' || (select stage from public.crm_records where id = pg_temp.t3802w_uuid(v_q)), '0/live');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', 'Stopped hosting')::text$q$, v_q));
  perform pg_temp.t3802w_check('W1-7', 'a Live host can be marked Lost', pg_temp.t3802w_get(r, 'record', 'stage'), 'lost');

  -- Linking a brand that already has a listing: Onboarded, then Live, at once.
  r := pg_temp.t3802w_make('linked', 'partner', 'hosts', '{"name": "Linked Host", "brand_id": "38020000-0000-4000-c100-000000000001"}');
  v_l := pg_temp.t3802w_id('linked');
  perform pg_temp.t3802w_check('W1-8', 'a host added with a live brand goes to Live at once',
    pg_temp.t3802w_get(r, 'moved_to') || '/' || pg_temp.t3802w_get(r, 'record', 'stage'), 'live/live');
  perform pg_temp.t3802w_check('W1-8', 'through Onboarded, both by the system',
    (select string_agg(from_stage || '>' || to_stage || ':' || via, ',' order by created_at) from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_l) and kind = 'stage_move'),
    'prospect>onboarded:system,onboarded>live:system');
  perform pg_temp.t3802w_check('W1-8', 'a verified venue counts as a listing',
    pg_temp.t3802w_get(pg_temp.t3802w_make('venue', 'partner', 'hosts', '{"name": "Venue Host", "brand_id": "38020000-0000-4000-c100-000000000006"}'), 'record', 'stage'), 'live');

  -- A Lost host is never promoted.
  r := pg_temp.t3802w_make('losthost', 'growth', 'hosts', '{"name": "Lost Host"}');
  v_lost := pg_temp.t3802w_id('losthost');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', 'Not interested')::text$q$, v_lost));
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_update(%L, '{"brand_id": "38020000-0000-4000-c100-000000000001"}'::jsonb)::text$q$, v_lost));
  perform pg_temp.t3802w_check('W1-8', 'linking a live brand to a Lost host leaves it Lost',
    coalesce(pg_temp.t3802w_get(r, 'moved_to'), '<none>') || '/' || pg_temp.t3802w_get(r, 'record', 'stage'), '<none>/lost');
  -- An unlinked host is never promoted; nor is a creator.
  r := pg_temp.t3802w_make('unlinked', 'growth', 'hosts', '{"name": "Unlinked Host"}');
  v_un := pg_temp.t3802w_id('unlinked');
  perform pg_temp.t3802w_check('W1-8', 'a full run leaves Lost and unlinked hosts alone',
    pg_temp.t3802w_as('postgres', $q$select public.crm_reconcile_live()::text$q$) || '/'
      || (select stage from public.crm_records where id = pg_temp.t3802w_uuid(v_lost)) || '/' || (select stage from public.crm_records where id = pg_temp.t3802w_uuid(v_un)),
    '0/lost/prospect');
  -- A host past Onboarded keeps its stage when a quiet brand is linked.
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'meeting')::text$q$, v_un));
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_update(%L, '{"brand_id": "38020000-0000-4000-c100-000000000004"}'::jsonb)::text$q$, v_un));
  perform pg_temp.t3802w_check('W1-8', 'a Meeting host linked to a quiet brand moves to Onboarded',
    pg_temp.t3802w_get(r, 'moved_to') || '/' || pg_temp.t3802w_get(r, 'record', 'stage'), 'onboarded/onboarded');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_update(%L, '{"brand_id": null}'::jsonb)::text$q$, v_un));
  perform pg_temp.t3802w_check('W1-8', 'removing the link moves nothing',
    coalesce(pg_temp.t3802w_get(r, 'moved_to'), '<none>') || '/' || pg_temp.t3802w_get(r, 'record', 'stage') || '/' || coalesce(pg_temp.t3802w_get(r, 'record', 'brand_id'), '<none>'),
    '<none>/onboarded/<none>');
  -- A deleted host is never promoted.
  r := pg_temp.t3802w_make('delhost', 'growth', 'hosts', '{"name": "Deleted Linked Host"}');
  r := pg_temp.t3802w_as('owner', format($q$select public.crm_record_delete(%L)::text$q$, pg_temp.t3802w_id('delhost')));
  update public.crm_records set brand_id = '38020000-0000-4000-c100-000000000001' where id = pg_temp.t3802w_uuid(pg_temp.t3802w_id('delhost'));
  perform pg_temp.t3802w_check('W1-8', 'a deleted host is never promoted',
    pg_temp.t3802w_as('postgres', $q$select public.crm_reconcile_live()::text$q$) || '/' || (select stage from public.crm_records where id = pg_temp.t3802w_uuid(pg_temp.t3802w_id('delhost'))),
    '0/prospect');

  -- The scheduled run also clears request keys older than 30 days.
  insert into public.crm_request_keys (actor_email, request_key, fn, response, created_at) values
    ('issue3802w-growth@test.local', 'w18-old-key-0001', 'crm_record_create', '{}'::jsonb, now() - interval '31 days'),
    ('issue3802w-growth@test.local', 'w18-new-key-0001', 'crm_record_create', '{}'::jsonb, now() - interval '29 days');
  perform pg_temp.t3802w_as('postgres', format($q$select public.crm_reconcile_live(%L)::text$q$, v_un));
  perform pg_temp.t3802w_check('W1-8', 'a one-record run clears no keys',
    (select count(*)::text from public.crm_request_keys where request_key like 'w18-%'), '2');
  perform pg_temp.t3802w_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802w_check('W1-8', 'the scheduled run clears keys older than 30 days only',
    (select string_agg(request_key, ',') from public.crm_request_keys where request_key like 'w18-%'), 'w18-new-key-0001');
end;
$w8$;

-- ---------------------------------------------------------------------------
-- W1-9 — delete and restore are for owner and admin.
-- ---------------------------------------------------------------------------
do $w9$
declare
  r text;
  v_id text;
  v_who text;
  v_before text;
  v_audit int;
begin
  r := pg_temp.t3802w_make('del', 'growth', 'hosts', '{"name": "Delete Me Host", "owners": ["issue3802w-growth@test.local"]}');
  v_id := pg_temp.t3802w_id('del');
  v_before := pg_temp.t3802w_snapshot();
  v_audit := pg_temp.t3802w_audit();
  foreach v_who in array array['growth', 'partner', 'growth2'] loop
    perform pg_temp.t3802w_check('W1-9', v_who || ' cannot delete, even their own record',
      pg_temp.t3802w_as(v_who, format($q$select public.crm_record_delete(%L)::text$q$, v_id)),
      'ERR:42501:forbidden: Only an owner or admin can delete. Mark it as lost instead.');
    perform pg_temp.t3802w_check('W1-9', v_who || ' cannot restore',
      pg_temp.t3802w_as(v_who, format($q$select public.crm_record_restore(%L)::text$q$, v_id)),
      'ERR:42501:forbidden: Only an owner or admin can restore a deleted record.');
  end loop;
  foreach v_who in array array['invited', 'revoked', 'consumer'] loop
    perform pg_temp.t3802w_like('W1-9', v_who || ' cannot delete',
      pg_temp.t3802w_as(v_who, format($q$select public.crm_record_delete(%L)::text$q$, v_id)), 'ERR:42501:forbidden:%');
  end loop;
  perform pg_temp.t3802w_check('W1-9', 'refused deletes changed nothing', pg_temp.t3802w_snapshot(), v_before);
  perform pg_temp.t3802w_check('W1-10', 'refused deletes wrote no audit row', pg_temp.t3802w_audit()::text, v_audit::text);

  r := pg_temp.t3802w_as('admin', format($q$select public.crm_record_delete(%L)::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-9', 'an admin deletes', pg_temp.t3802w_jb(r)::text,
    format('{"id": "%s", "name": "Delete Me Host", "changed": true, "pipeline": "hosts"}', v_id));
  perform pg_temp.t3802w_check('W1-9', 'the row is kept, marked deleted by them',
    (select deleted_by || '/' || (deleted_at is not null)::text from public.crm_records where id = pg_temp.t3802w_uuid(v_id)), 'issue3802w-admin@test.local/true');
  perform pg_temp.t3802w_check('W1-10', 'delete wrote one audit row with name and pipeline',
    (pg_temp.t3802w_audit() - v_audit)::text || '/' || (select admin_email || '/' || (metadata->>'name') || '/' || (metadata->>'pipeline')
       from public.admin_audit_log where action = 'crm.record_delete' and target_id = v_id), '1/issue3802w-admin@test.local/Delete Me Host/hosts');
  perform pg_temp.t3802w_check('W1-9', 'deleting again changes nothing',
    pg_temp.t3802w_get(pg_temp.t3802w_as('owner', format($q$select public.crm_record_delete(%L)::text$q$, v_id)), 'changed'), 'false');
  perform pg_temp.t3802w_check('W1-10', 'deleting again wrote no audit row', (pg_temp.t3802w_audit() - v_audit)::text, '1');

  -- A deleted record is gone from every read and every write.
  perform pg_temp.t3802w_check('W1-9', 'gone from the list',
    (select count(*)::text from jsonb_array_elements(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_records_list('hosts')::text$q$)) -> 'records') x where x->>'id' = v_id), '0');
  perform pg_temp.t3802w_like('W1-9', 'gone from get',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_get(%L)::text$q$, v_id)), 'ERR:P0002:not_found:%');
  perform pg_temp.t3802w_check('W1-9', 'gone from the duplicate check',
    pg_temp.t3802w_as('growth', $q$select public.crm_duplicate_check('hosts', 'Delete Me Host')::text$q$), '{"exact": null, "similar": []}');
  perform pg_temp.t3802w_like('W1-9', 'cannot be edited',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_update(%L, '{"contact": "x"}'::jsonb)::text$q$, v_id)), 'ERR:P0002:not_found:%');
  perform pg_temp.t3802w_like('W1-9', 'cannot be moved',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, v_id)), 'ERR:P0002:not_found:%');
  perform pg_temp.t3802w_like('W1-9', 'cannot be logged against',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "x"}'::jsonb, 'w19-log-0001')::text$q$, v_id)), 'ERR:P0002:not_found:%');
  perform pg_temp.t3802w_like('W1-9', 'cannot be given owners',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_set_owners(%L, array[]::text[])::text$q$, v_id)), 'ERR:P0002:not_found:%');

  r := pg_temp.t3802w_as('owner', format($q$select public.crm_record_restore(%L)::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-9', 'the owner restores it, as it was',
    pg_temp.t3802w_get(r, 'changed') || '/' || pg_temp.t3802w_get(r, 'record', 'name') || '/' || pg_temp.t3802w_get(r, 'record', 'owners'),
    'true/Delete Me Host/["issue3802w-growth@test.local"]');
  perform pg_temp.t3802w_check('W1-9', 'restoring again changes nothing',
    pg_temp.t3802w_get(pg_temp.t3802w_as('admin', format($q$select public.crm_record_restore(%L)::text$q$, v_id)), 'changed'), 'false');
  perform pg_temp.t3802w_check('W1-10', 'restore wrote one audit row',
    (pg_temp.t3802w_audit() - v_audit)::text || '/' || (select admin_email from public.admin_audit_log where action = 'crm.record_restore' and target_id = v_id),
    '2/issue3802w-owner@test.local');
  perform pg_temp.t3802w_check('W1-9', 'and it is back in the list',
    (select count(*)::text from jsonb_array_elements(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_records_list('hosts')::text$q$)) -> 'records') x where x->>'id' = v_id), '1');
end;
$w9$;

-- ---------------------------------------------------------------------------
-- W1-10 — one audit row per write, none for a call that changes nothing, and
-- what was said never reaches the audit log.
-- ---------------------------------------------------------------------------
do $w10$
declare
  r text;
  v_id text;
  v_a int;
  s record;
begin
  v_a := pg_temp.t3802w_audit();
  r := pg_temp.t3802w_make('audit', 'partner', 'creators', '{"name": "@auditcreator"}');
  v_id := pg_temp.t3802w_id('audit');
  perform pg_temp.t3802w_check('W1-10', 'create: +1', (pg_temp.t3802w_audit() - v_a)::text, '1');

  for s in
    select * from (values
      (1,  'update, real change',      format($q$select public.crm_record_update(%L, '{"contact": "dm only"}'::jsonb)::text$q$, v_id), 1, 'crm.record_update'),
      (2,  'update, same value',       format($q$select public.crm_record_update(%L, '{"contact": " dm only "}'::jsonb)::text$q$, v_id), 0, null),
      (3,  'update, nothing sent',     format($q$select public.crm_record_update(%L, '{}'::jsonb)::text$q$, v_id), 0, null),
      (4,  'move',                     format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, v_id), 1, 'crm.stage_move'),
      (5,  'move to the same stage',   format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, v_id), 0, null),
      (6,  'set owners',               format($q$select public.crm_record_set_owners(%L, array['issue3802w-growth@test.local'])::text$q$, v_id), 1, 'crm.owners_set'),
      (7,  'set the same owners',      format($q$select public.crm_record_set_owners(%L, array[' ISSUE3802W-growth@test.local'])::text$q$, v_id), 0, null),
      (8,  'log a note',               format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "W1-10-PRIVATE-WORDS said in confidence"}'::jsonb, 'w110-log-0001')::text$q$, v_id), 1, 'crm.log_add'),
      (9,  'log a touch',              format($q$select public.crm_record_log(%L, '{"kind": "touch", "channel": "instagram_dm", "direction": "inbound", "body": "W1-10-PRIVATE-WORDS again", "message_ref": "W1-10-PRIVATE-REF", "reply_class": "question"}'::jsonb, 'w110-log-0002')::text$q$, v_id), 1, 'crm.log_add'),
      (10, 'a refused move',           format($q$select public.crm_record_move_stage(%L, 'passed')::text$q$, v_id), 0, null),
      (11, 'a refused update',         format($q$select public.crm_record_update(%L, '{"icp": "nope"}'::jsonb)::text$q$, v_id), 0, null)
    ) as v(ord, label, sql, want, action)
    order by 1
  loop
    v_a := pg_temp.t3802w_audit();
    r := pg_temp.t3802w_as('partner', s.sql);
    perform pg_temp.t3802w_check('W1-10', s.label || ': +' || s.want, (pg_temp.t3802w_audit() - v_a)::text, s.want::text);
    if s.want = 1 then
      perform pg_temp.t3802w_check('W1-10', s.label || ': the row names the person and the action',
        (select admin_email || '/' || action || '/' || target_type || '/' || (actor_uid = '38020000-0000-4000-c000-000000000004')::text
           from public.admin_audit_log where action like 'crm.%' and target_id = v_id order by created_at desc limit 1),
        'issue3802w-partner@test.local/' || s.action || '/crm_record/true');
    end if;
  end loop;

  perform pg_temp.t3802w_check('W1-10', 'what was said is in the log',
    (select count(*)::text from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_id) and body like '%W1-10-PRIVATE-WORDS%'), '2');
  perform pg_temp.t3802w_check('W1-10', 'and never in the audit log',
    (select count(*)::text from public.admin_audit_log where metadata::text like '%W1-10-PRIVATE-%' or coalesce(reason, '') like '%W1-10-PRIVATE-%'), '0');
  perform pg_temp.t3802w_check('W1-10', 'the touch audit row carries kind, channel and direction only',
    (select (metadata - 'activity_id')::text from public.admin_audit_log where action = 'crm.log_add' and target_id = v_id order by created_at desc limit 1),
    '{"kind": "touch", "channel": "instagram_dm", "direction": "inbound"}');
  perform pg_temp.t3802w_check('W1-10', 'every pipeline audit row names a real team member or the system',
    (select count(*)::text from public.admin_audit_log l
      where l.action like 'crm.%' and l.admin_email <> 'system'
        and not exists (select 1 from t3802w_people p where p.email = l.admin_email)), '0');
  perform pg_temp.t3802w_check('W1-10', 'no pipeline row was written by a person as the system',
    (select count(*)::text from public.admin_audit_log l where l.action like 'crm.%' and l.admin_email = 'system' and l.action <> 'crm.stage_auto_live'), '0');
end;
$w10$;

-- ---------------------------------------------------------------------------
-- W1-11 — touches and notes.
-- ---------------------------------------------------------------------------
do $w11$
declare
  r text;
  v_id text;
  v_n int;
  f record;
begin
  r := pg_temp.t3802w_make('touch', 'growth', 'hosts', '{"name": "Touch Host", "channel": "email"}');
  v_id := pg_temp.t3802w_id('touch');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "touch", "channel": "whatsapp", "direction": "outbound", "body": " Sent the intro. "}'::jsonb, 'w111-log-0001')::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-11', 'an outbound touch',
    concat_ws('|', pg_temp.t3802w_get(r, 'activity', 'kind'), pg_temp.t3802w_get(r, 'activity', 'channel'), pg_temp.t3802w_get(r, 'activity', 'direction'),
      pg_temp.t3802w_get(r, 'activity', 'body'), pg_temp.t3802w_get(r, 'activity', 'actor_name'), coalesce(pg_temp.t3802w_get(r, 'activity', 'via'), '<person>'),
      pg_temp.t3802w_get(r, 'record', 'touch_count')),
    'touch|whatsapp|outbound|Sent the intro.|Issue3802w|<person>|1');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "touch", "channel": "instagram_dm", "direction": "inbound", "message_ref": "https://example.com/dm/42", "reply_class": "interested", "occurred_at": "2026-10-01T09:30:00Z"}'::jsonb, 'w111-log-0002')::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-11', 'an inbound touch keeps each value in its own column',
    (select concat_ws('|', kind, channel, direction, message_ref, reply_class, coalesce(body, '<none>'), occurred_at at time zone 'UTC')
       from public.crm_activity where id = pg_temp.t3802w_uuid(pg_temp.t3802w_get(r, 'activity', 'id'))),
    'touch|instagram_dm|inbound|https://example.com/dm/42|interested|<none>|2026-10-01 09:30:00');
  perform pg_temp.t3802w_check('W1-11', 'the record counts its touches and knows the latest',
    pg_temp.t3802w_get(r, 'record', 'touch_count') || '/' || (pg_temp.t3802w_get(r, 'record', 'last_touch_at') is not null)::text, '2/true');
  select count(*) into v_n from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_id);

  for f in
    select * from (values
      ('a reply classification on a message you sent', '{"kind": "touch", "channel": "email", "direction": "outbound", "reply_class": "interested"}',
        'ERR:22023:invalid_reply_class: A reply classification only applies to a message they sent you.'),
      ('an unknown reply classification', '{"kind": "touch", "channel": "email", "direction": "inbound", "reply_class": "angry"}', 'ERR:22023:invalid_reply_class:%'),
      ('a touch without a channel',       '{"kind": "touch", "direction": "outbound"}', 'ERR:22023:invalid_channel:%'),
      ('a touch on an unknown channel',   '{"kind": "touch", "channel": "fax", "direction": "outbound"}', 'ERR:22023:invalid_channel:%'),
      ('a touch without a direction',     '{"kind": "touch", "channel": "email"}', 'ERR:22023:invalid_direction:%'),
      ('a touch with a wrong direction',  '{"kind": "touch", "channel": "email", "direction": "sideways"}', 'ERR:22023:invalid_direction:%'),
      ('a note without words',            '{"kind": "note"}', 'ERR:22023:invalid_body: Write what happened first.'),
      ('a note of only spaces',           '{"kind": "note", "body": "   "}', 'ERR:22023:invalid_body:%'),
      ('a note with a channel',           '{"kind": "note", "body": "x", "channel": "email"}', 'ERR:22023:field_not_for_kind:%'),
      ('an unknown kind',                 '{"kind": "call", "body": "x"}', 'ERR:22023:invalid_kind:%'),
      ('a stage move through the log',    '{"kind": "stage_move", "from_stage": "prospect", "to_stage": "live"}', 'ERR:22023:unknown_field:%'),
      ('no kind',                         '{"body": "x"}', 'ERR:22023:invalid_kind:%'),
      ('an unknown key',                  '{"kind": "note", "body": "x", "via": "agent"}', 'ERR:22023:unknown_field: "via" is not part of a log entry.%'),
      ('a claimed author',                '{"kind": "note", "body": "x", "actor_email": "issue3802w-owner@test.local"}', 'ERR:22023:unknown_field:%'),
      ('a time that is not a time',       '{"kind": "note", "body": "x", "occurred_at": "yesterday-ish"}', 'ERR:22023:invalid_occurred_at:%'),
      ('something that is not an object', '"just text"', 'ERR:22023:invalid_entry:%')
    ) as v(label, entry, want)
  loop
    perform pg_temp.t3802w_like('W1-11', 'log refuses ' || f.label,
      pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, %L::jsonb, %L)::text$q$, v_id, f.entry, 'w111-' || md5(f.entry))), f.want);
  end loop;
  perform pg_temp.t3802w_like('W1-11', 'log refuses a time more than 5 minutes ahead',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, %L::jsonb, 'w111-future-0001')::text$q$, v_id,
      json_build_object('kind', 'note', 'body', 'x', 'occurred_at', clock_timestamp() + interval '10 minutes')::text)),
    'ERR:22023:invalid_occurred_at: That time is in the future.%');
  perform pg_temp.t3802w_like('W1-11', 'log refuses 4001 characters',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, %L::jsonb, 'w111-long-0001')::text$q$, v_id,
      json_build_object('kind', 'note', 'body', repeat('x', 4001))::text)), 'ERR:22023:invalid_body:%');
  perform pg_temp.t3802w_check('W1-11', 'no refused entry was written',
    (select count(*)::text from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_id)), v_n::text);
  perform pg_temp.t3802w_check('W1-11', 'no refused entry kept its request key',
    (select count(*)::text from public.crm_request_keys where request_key like 'w111-%' and request_key not in ('w111-log-0001', 'w111-log-0002')), '0');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_log(%L, %L::jsonb, 'w111-soon-0001')::text$q$, v_id,
    json_build_object('kind', 'note', 'body', 'clock skew', 'occurred_at', clock_timestamp() + interval '2 minutes')::text));
  perform pg_temp.t3802w_check('W1-11', 'a time two minutes ahead is accepted (clock skew)', pg_temp.t3802w_get(r, 'activity', 'body'), 'clock skew');

  -- The table agrees, for a writer that skips the function.
  perform pg_temp.t3802w_like('W1-11', 'the table refuses a reply classification on an outbound touch',
    pg_temp.t3802w_as('postgres', format($q$insert into public.crm_activity (record_id, kind, actor_email, channel, direction, reply_class) values (%L, 'touch', 'x@test.local', 'email', 'outbound', 'interested')$q$, v_id)),
    'ERR:23514:%crm_activity_reply_check%');
  perform pg_temp.t3802w_like('W1-11', 'the table refuses a note without words',
    pg_temp.t3802w_as('postgres', format($q$insert into public.crm_activity (record_id, kind, actor_email, body) values (%L, 'note', 'x@test.local', '  ')$q$, v_id)),
    'ERR:23514:%crm_activity_note_check%');
  perform pg_temp.t3802w_like('W1-11', 'the table refuses a touch without a direction',
    pg_temp.t3802w_as('postgres', format($q$insert into public.crm_activity (record_id, kind, actor_email, channel) values (%L, 'touch', 'x@test.local', 'email')$q$, v_id)),
    'ERR:23514:%crm_activity_touch_check%');
  perform pg_temp.t3802w_like('W1-11', 'the table refuses a line with no author that is not the system',
    pg_temp.t3802w_as('postgres', format($q$insert into public.crm_activity (record_id, kind, body) values (%L, 'note', 'anonymous')$q$, v_id)),
    'ERR:23514:%crm_activity_actor_check%');

  -- The record view lists the log newest first.
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_get(%L)::text$q$, v_id));
  perform pg_temp.t3802w_check('W1-11', 'record view: log entry keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.t3802w_jb(r) #> '{activity,0}') k),
    'actor_email,actor_name,body,channel,direction,from_stage,id,kind,message_ref,occurred_at,reply_class,to_stage,via');
  perform pg_temp.t3802w_check('W1-11', 'record view: newest first, the dated reply last but one',
    (select string_agg(coalesce(a->>'body', a->>'reply_class'), ' < ' order by o) from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'activity') with ordinality x(a, o)),
    'clock skew < Sent the intro. < Added to the pipeline. < interested');
  perform pg_temp.t3802w_check('W1-11', 'record view: top-level keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.t3802w_jb(r)) k), 'activity,links,record,undoable_activity_id');
end;
$w11$;

-- ---------------------------------------------------------------------------
-- W1-13 — undo.
-- ---------------------------------------------------------------------------
do $w13$
declare
  r text;
  v_id text;
  v_act text;
  v_audit int;
  v_n int;
begin
  r := pg_temp.t3802w_make('undo', 'growth', 'hosts', '{"name": "Undo Host"}');
  v_id := pg_temp.t3802w_id('undo');

  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, v_id));
  v_act := pg_temp.t3802w_get(r, 'activity_id');
  perform pg_temp.t3802w_check('W1-13', 'the mover is offered the undo',
    pg_temp.t3802w_get(pg_temp.t3802w_as('growth', format($q$select public.crm_record_get(%L)::text$q$, v_id)), 'undoable_activity_id'), v_act);
  perform pg_temp.t3802w_check('W1-13', 'nobody else is',
    coalesce(pg_temp.t3802w_get(pg_temp.t3802w_as('growth2', format($q$select public.crm_record_get(%L)::text$q$, v_id)), 'undoable_activity_id'), '<none>'), '<none>');
  perform pg_temp.t3802w_check('W1-13', 'another person cannot undo it',
    pg_temp.t3802w_as('growth2', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act)),
    'ERR:22023:undo_expired: That move can no longer be undone. Move the card back by hand.');
  perform pg_temp.t3802w_like('W1-13', 'not even the owner',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act)), 'ERR:22023:undo_expired:%');
  perform pg_temp.t3802w_check('W1-13', 'still Contacted', (select stage from public.crm_records where id = pg_temp.t3802w_uuid(v_id)), 'contacted');

  v_audit := pg_temp.t3802w_audit();
  select count(*) into v_n from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_id);
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act));
  perform pg_temp.t3802w_check('W1-13', 'the mover undoes it',
    pg_temp.t3802w_get(r, 'changed') || '/' || pg_temp.t3802w_get(r, 'record', 'stage'), 'true/prospect');
  perform pg_temp.t3802w_check('W1-13', 'the log line is gone',
    (select count(*)::text from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_id)) || '/' || (select count(*)::text from public.crm_activity where id = pg_temp.t3802w_uuid(v_act)),
    (v_n - 1)::text || '/0');
  perform pg_temp.t3802w_check('W1-10', 'undo wrote one audit row',
    (pg_temp.t3802w_audit() - v_audit)::text || '/' || (select admin_email || '/' || (metadata #>> '{before,stage}') || '>' || (metadata #>> '{after,stage}')
       from public.admin_audit_log where action = 'crm.stage_undo' and target_id = v_id), '1/issue3802w-growth@test.local/contacted>prospect');
  perform pg_temp.t3802w_like('W1-13', 'it cannot be undone twice',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act)), 'ERR:22023:undo_expired:%');

  -- After a later log entry.
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'replied')::text$q$, v_id));
  v_act := pg_temp.t3802w_get(r, 'activity_id');
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "They called back."}'::jsonb, 'w113-log-0001')::text$q$, v_id));
  perform pg_temp.t3802w_like('W1-13', 'not after something else was logged',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act)), 'ERR:22023:undo_expired:%');
  perform pg_temp.t3802w_check('W1-13', 'and the record view no longer offers it',
    coalesce(pg_temp.t3802w_get(pg_temp.t3802w_as('growth', format($q$select public.crm_record_get(%L)::text$q$, v_id)), 'undoable_activity_id'), '<none>'), '<none>');

  -- After a minute.
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'meeting')::text$q$, v_id));
  v_act := pg_temp.t3802w_get(r, 'activity_id');
  -- (Every line of this card is aged together, so the move stays the newest.)
  update public.crm_activity set created_at = created_at - interval '61 seconds' where record_id = pg_temp.t3802w_uuid(v_id);
  perform pg_temp.t3802w_like('W1-13', 'not after a minute',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act)), 'ERR:22023:undo_expired:%');
  update public.crm_activity set created_at = created_at + interval '10 seconds' where record_id = pg_temp.t3802w_uuid(v_id);
  -- (51 seconds old now: still inside the window; the next case reuses it.)

  -- After the stage changed underneath it.
  update public.crm_records set stage = 'onboarded' where id = pg_temp.t3802w_uuid(v_id);
  perform pg_temp.t3802w_like('W1-13', 'not when the card has moved since',
    pg_temp.t3802w_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act)), 'ERR:22023:undo_expired:%');
  update public.crm_records set stage = 'meeting' where id = pg_temp.t3802w_uuid(v_id);
  perform pg_temp.t3802w_check('W1-13', 'inside the minute, with the stage as it was, it works',
    pg_temp.t3802w_get(pg_temp.t3802w_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, v_act)), 'record', 'stage'), 'replied');

  -- Undoing a move to Lost, and a move out of Lost.
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', 'Wrong number')::text$q$, v_id));
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, pg_temp.t3802w_get(r, 'activity_id')));
  perform pg_temp.t3802w_check('W1-13', 'undoing a move to Lost clears the reason',
    pg_temp.t3802w_get(r, 'record', 'stage') || '/' || coalesce(pg_temp.t3802w_get(r, 'record', 'stage_reason'), '<none>'), 'replied/<none>');
  r := pg_temp.t3802w_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', 'Wrong number')::text$q$, v_id));
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, v_id));
  r := pg_temp.t3802w_as('partner', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, pg_temp.t3802w_get(r, 'activity_id')));
  perform pg_temp.t3802w_check('W1-13', 'undoing a move out of Lost puts the reason back',
    pg_temp.t3802w_get(r, 'record', 'stage') || '/' || pg_temp.t3802w_get(r, 'record', 'stage_reason'), 'lost/Wrong number');

  -- Only stage moves can be undone, and only a person's.
  perform pg_temp.t3802w_like('W1-13', 'a note is not a move',
    pg_temp.t3802w_as('partner', format($q$select public.crm_record_undo_stage_move(%L)::text$q$,
      (select id from public.crm_activity where record_id = pg_temp.t3802w_uuid(v_id) and kind = 'note' limit 1))), 'ERR:22023:undo_expired:%');
  perform pg_temp.t3802w_like('W1-13', 'a system move cannot be undone by anyone',
    pg_temp.t3802w_as('owner', format($q$select public.crm_record_undo_stage_move(%L)::text$q$,
      (select id from public.crm_activity where via = 'system' and to_stage = 'live' order by created_at desc limit 1))), 'ERR:22023:undo_expired:%');
  perform pg_temp.t3802w_like('W1-13', 'no id at all',
    pg_temp.t3802w_as('growth', $q$select public.crm_record_undo_stage_move(null)::text$q$), 'ERR:22023:undo_expired:%');
end;
$w13$;

-- ---------------------------------------------------------------------------
-- W1-14 — link search.
-- ---------------------------------------------------------------------------
do $w14$
declare
  r text;
begin
  r := pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', 'issue3802w live')::text$q$);
  perform pg_temp.t3802w_check('W1-14', 'brand rows carry exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.t3802w_jb(r) #> '{results,0}') k), 'city,id,is_live,name,slug');
  perform pg_temp.t3802w_check('W1-14', 'a brand row',
    (pg_temp.t3802w_jb(r) #> '{results,0}')::text,
    '{"id": "38020000-0000-4000-c100-000000000001", "city": "Lagos", "name": "Issue3802w Live Brand", "slug": "issue3802w-live-brand", "is_live": true}');
  r := pg_temp.t3802w_as('growth', $q$select public.crm_link_search('place', 'issue3802w')::text$q$);
  perform pg_temp.t3802w_check('W1-14', 'place rows carry exactly the named keys, active places only',
    (pg_temp.t3802w_jb(r) -> 'results')::text, '[{"id": "38020000-0000-4000-c500-000000000001", "city": "Lagos", "name": "Issue3802w Palm Place"}]');
  perform pg_temp.t3802w_check('W1-14', 'a deleted brand is never offered',
    jsonb_array_length(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', 'Issue3802w Gone')::text$q$)) -> 'results')::text, '0');

  -- % and _ mean themselves.
  r := pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', '100% Fun')::text$q$);
  perform pg_temp.t3802w_check('W1-14', '% is searched for as typed',
    (select string_agg(x->>'name', ',') from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'results') x), 'Issue3802w 100% Fun_Co');
  r := pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', 'Fun_Co')::text$q$);
  perform pg_temp.t3802w_check('W1-14', '_ is searched for as typed',
    (select string_agg(x->>'name', ',') from jsonb_array_elements(pg_temp.t3802w_jb(r) -> 'results') x), 'Issue3802w 100% Fun_Co');
  perform pg_temp.t3802w_check('W1-14', 'a search of only wildcards finds nothing',
    jsonb_array_length(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', '%%')::text$q$)) -> 'results')::text
      || '/' || jsonb_array_length(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_link_search('place', '__')::text$q$)) -> 'results')::text,
    '0/0');
  perform pg_temp.t3802w_check('W1-14', 'a backslash is searched for as typed',
    jsonb_array_length(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', 'Fun\Co')::text$q$)) -> 'results')::text
      || '/' || jsonb_array_length(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', '100\')::text$q$)) -> 'results')::text,
    '0/0');
  perform pg_temp.t3802w_check('W1-14', 'one letter finds nothing',
    pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', ' i ')::text$q$), '{"kind": "brand", "results": []}');
  perform pg_temp.t3802w_check('W1-14', 'at most ten',
    jsonb_array_length(pg_temp.t3802w_jb(pg_temp.t3802w_as('growth', $q$select public.crm_link_search('brand', 'Issue3802w Limit Brand')::text$q$)) -> 'results')::text, '10');
  perform pg_temp.t3802w_like('W1-14', 'only brands and places can be searched',
    pg_temp.t3802w_as('growth', $q$select public.crm_link_search('users', 'seth')::text$q$), 'ERR:22023:invalid_kind:%');
end;
$w14$;

-- ---------------------------------------------------------------------------
-- W1-12 — catalog pins. A new writer, grant or policy must be added here
-- deliberately.
-- ---------------------------------------------------------------------------
do $w12$
declare
  c_client constant text[] := array[
    'crm_config()', 'crm_duplicate_check(text,text,uuid)', 'crm_link_search(text,text)',
    'crm_record_create(text,jsonb,text)', 'crm_record_delete(uuid)', 'crm_record_get(uuid)',
    'crm_record_log(uuid,jsonb,text)', 'crm_record_move_stage(uuid,text,text)', 'crm_record_restore(uuid)',
    'crm_record_set_owners(uuid,text[])', 'crm_record_undo_stage_move(uuid)', 'crm_record_update(uuid,jsonb)',
    'crm_records_bulk_create(text,jsonb,text)', 'crm_records_list(text)'];
  c_internal constant text[] := array[
    'admin_team_directory()', 'crm_activity_json(crm_activity)', 'crm_apply_brand_link(uuid)',
    'crm_audit(text,text,text,text,jsonb)', 'crm_brand_is_live(uuid)', 'crm_clean_owners(jsonb)', 'crm_ctx()',
    'crm_display_name(text)', 'crm_name_key(text)', 'crm_pipeline_def(text)', 'crm_reconcile_live(uuid)',
    'crm_record_create_core(text,jsonb,text,text)', 'crm_record_json(crm_records)', 'crm_record_lite_json(crm_records)',
    'crm_request_begin(text,text,text)', 'crm_request_finish(text,text,text,jsonb)', 'crm_stage_def(text,text)',
    'crm_undoable_activity(uuid,text)', 'crm_validate_fields(text,jsonb,text)', 'crm_vocab()'];
  v_fn text;
  v_tbl text;
  v_role text;
  v_priv text;
  w record;
  v_guard text;
  v_who text;
begin
  perform pg_temp.t3802w_check('W1-12', 'every pipeline function is one of the named ones',
    (select string_agg(p.oid::regprocedure::text, ' ' order by p.oid::regprocedure::text)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'crm\_%' or p.proname = 'admin_team_directory')),
    (select string_agg(x, ' ' order by x) from unnest(c_client || c_internal) x));
  perform pg_temp.t3802w_check('W1-12', 'no pipeline function lives outside public',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname <> 'public' and n.nspname !~ '^pg_' and p.proname like 'crm\_%'), '0');

  foreach v_fn in array c_client loop
    perform pg_temp.t3802w_check('W1-12', 'grants on the client function ' || v_fn,
      has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE')::text
        || '/' || has_function_privilege('service_role', 'public.' || v_fn, 'EXECUTE')::text, 'false/true/true');
    perform pg_temp.t3802w_check('W1-12', v_fn || ' runs as its owner',
      (select prosecdef::text from pg_proc where oid = ('public.' || v_fn)::regprocedure), 'true');
  end loop;
  foreach v_fn in array c_internal loop
    perform pg_temp.t3802w_check('W1-12', 'grants on the internal function ' || v_fn,
      has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE')::text
        || '/' || has_function_privilege('service_role', 'public.' || v_fn, 'EXECUTE')::text, 'false/false/true');
  end loop;
  foreach v_fn in array c_client || c_internal loop
    perform pg_temp.t3802w_check('W1-12', v_fn || ' holds nothing for PUBLIC and pins an empty search_path',
      (select (not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))::text || '/' || (p.proacl is not null)::text
              || '/' || coalesce(array_to_string(p.proconfig, ','), '<none>')
         from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure),
      'true/true/search_path=""');
  end loop;

  foreach v_tbl in array array['public.crm_records', 'public.crm_record_owners', 'public.crm_activity', 'public.crm_request_keys'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        perform pg_temp.t3802w_check('W1-12', v_role || ' ' || v_priv || ' on ' || v_tbl,
          has_table_privilege(v_role, v_tbl, v_priv)::text, 'false');
      end loop;
      perform pg_temp.t3802w_check('W1-12', v_role || ' has no column privilege on ' || v_tbl,
        (select count(*)::text from information_schema.column_privileges
          where table_schema = 'public' and 'public.' || table_name = v_tbl and grantee = v_role), '0');
    end loop;
    perform pg_temp.t3802w_check('W1-12', 'the trusted server role keeps ' || v_tbl,
      has_table_privilege('service_role', v_tbl, 'SELECT')::text || '/' || has_table_privilege('service_role', v_tbl, 'INSERT')::text, 'true/true');
    perform pg_temp.t3802w_check('W1-12', 'row security is on and there is no policy on ' || v_tbl,
      (select relrowsecurity::text from pg_class where oid = v_tbl::regclass) || '/'
        || (select count(*)::text from pg_policy where polrelid = v_tbl::regclass), 'true/0');
    perform pg_temp.t3802w_check('W1-12', 'no trigger on ' || v_tbl,
      (select count(*)::text from pg_trigger where tgrelid = v_tbl::regclass and not tgisinternal), '0');
  end loop;

  -- Who writes each table, by name, in every schema.
  for w in
    select * from (values
      ('crm_records',       'public.crm_apply_brand_link,public.crm_reconcile_live,public.crm_record_create_core,public.crm_record_delete,public.crm_record_log,public.crm_record_move_stage,public.crm_record_restore,public.crm_record_set_owners,public.crm_record_undo_stage_move,public.crm_record_update'),
      ('crm_record_owners', 'public.crm_record_create_core,public.crm_record_set_owners'),
      ('crm_activity',      'public.crm_apply_brand_link,public.crm_reconcile_live,public.crm_record_create_core,public.crm_record_log,public.crm_record_move_stage,public.crm_record_undo_stage_move'),
      ('crm_request_keys',  'public.crm_reconcile_live,public.crm_request_finish')
    ) as v(tbl, want)
  loop
    perform pg_temp.t3802w_check('W1-12', 'functions that write ' || w.tbl,
      (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prokind in ('f', 'p') and n.nspname !~ '^pg_temp'
          and p.prosrc ~* ('(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(only\s+)?(public\.)?"?' || w.tbl || '\M')),
      w.want);
  end loop;
  perform pg_temp.t3802w_check('W1-12', 'the one function that sets a host to Live',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname !~ '^pg_temp' and p.prosrc ~* 'set\s+stage\s*=\s*''live'''),
    'public.crm_reconcile_live');
  perform pg_temp.t3802w_check('W1-12', 'the functions that change a stage at all',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname !~ '^pg_temp' and p.prosrc ~* 'update\s+public\.crm_records\s+set\s+stage\s*='),
    'public.crm_apply_brand_link,public.crm_reconcile_live,public.crm_record_move_stage,public.crm_record_undo_stage_move');
  perform pg_temp.t3802w_check('W1-12', 'the one function that removes a log line',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname !~ '^pg_temp' and p.prosrc ~* 'delete\s+from\s+(public\.)?crm_activity\M'),
    'public.crm_record_undo_stage_move');
  perform pg_temp.t3802w_check('W1-12', 'no pipeline function builds a statement at run time',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'crm\_%' and p.prosrc ~* '\mexecute\s'), '0');
  perform pg_temp.t3802w_check('W1-12', 'every client function gates before anything else',
    (select string_agg(p.proname, ',' order by p.proname)
       from pg_proc p
      where p.oid = any (select ('public.' || x)::regprocedure::oid from unnest(c_client) x)
        and p.prosrc !~* '^\s*declare.*?\mbegin\s+(--[^\n]*\n\s*)*(select \* into v from public\.crm_ctx\(\);|if not public\.is_admin_user\(\) then\s+raise exception ''forbidden:[^;]*;\s+end if;\s+select \* into v from public\.crm_ctx\(\);)'),
    null);
  perform pg_temp.t3802w_check('W1-12', 'no policy on any table mentions a pipeline or team function or table',
    (select count(*)::text from pg_policies
      where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~* '\m(crm_|admin_team_)'), '0');
  perform pg_temp.t3802w_check('W1-12', 'no view reads a pipeline table',
    (select count(*)::text from pg_views where schemaname not in ('pg_catalog', 'information_schema') and definition ~* '\mcrm_(records|record_owners|activity|request_keys)\M'), '0');
  perform pg_temp.t3802w_check('W1-12', 'no foreign key points from a pipeline table at another table, or the other way',
    (select count(*)::text from pg_constraint c
      where c.contype = 'f'
        and (c.conrelid::regclass::text like 'crm\_%') <> (c.confrelid::regclass::text like 'crm\_%')), '0');
  -- Other work inventories every table that has a column with one of these
  -- names; a pipeline link must not enter that inventory.
  perform pg_temp.t3802w_check('W1-12', 'no pipeline column uses a name the venue-identity inventory keys on',
    (select count(*)::text from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relname like 'crm\_%' and a.attnum > 0 and not a.attisdropped
        and a.attname in ('venue_id', 'serving_venue_id', 'duplicate_of_venue_id', 'place_pool_id')), '0');
  perform pg_temp.t3802w_check('W1-12', 'the two unique rules exist',
    (select string_agg(c.relname || ':' || pg_get_expr(i.indpred, i.indrelid), ' | ' order by c.relname)
       from pg_index i join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'public.crm_records'::regclass and i.indisunique and not i.indisprimary and i.indisvalid),
    'crm_records_live_beta_lead:((beta_lead_id IS NOT NULL) AND (deleted_at IS NULL)) | crm_records_live_name_key:(deleted_at IS NULL)');

  -- Asked as the migration role, the way the grant guard is run in CI.
  set local role postgres;
  select count(*)::text into v_guard from public.audit_overbroad_table_grants() where not is_baselined;
  reset role;
  perform pg_temp.t3802w_check('W1-12', 'grant guard reports nothing new', v_guard, '0');

  -- The schedule, where the scheduler exists.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform pg_temp.t3802w_check('W1-12', 'one scheduled job, every 10 minutes, calling the one function',
      (select string_agg(j.schedule || ' | ' || btrim(j.command) || ' | ' || j.active::text, ' ;; ') from cron.job j where j.jobname = 'crm_reconcile_live'),
      '*/10 * * * * | SELECT public.crm_reconcile_live() | true');
  else
    perform pg_temp.t3802w_check('W1-12', 'no scheduler on this database (nothing to check)', 'skipped', 'skipped');
  end if;

  -- The Beta leads reader is limited to full admins.
  insert into public.beta_access_leads (brand_type, brand_name, contact_name, city, email, consent, source)
  values (array['restaurant'], 'Issue3802w Lead', 'Ada', 'Lagos', 'issue3802w-lead@test.local', true, 'organiser_marketing');
  foreach v_who in array array['owner', 'admin'] loop
    perform pg_temp.t3802w_check('W1-12', v_who || ' still reads beta leads',
      pg_temp.t3802w_as(v_who, $q$select count(*)::text from public.admin_beta_leads_list() where brand_name = 'Issue3802w Lead'$q$), '1');
  end loop;
  foreach v_who in array array['growth', 'partner', 'invited', 'revoked', 'consumer', 'service'] loop
    perform pg_temp.t3802w_check('W1-12', v_who || ' is refused by the full-admin beta leads reader',
      pg_temp.t3802w_as(v_who, $q$select count(*)::text from public.admin_beta_leads_list()$q$), 'ERR:42501:forbidden');
  end loop;
  perform pg_temp.t3802w_like('W1-12', 'anon cannot call the beta leads reader',
    pg_temp.t3802w_as('anon', $q$select count(*)::text from public.admin_beta_leads_list()$q$), 'ERR:42501:permission denied for function %');
  perform pg_temp.t3802w_check('W1-12', 'the beta leads reader kept its shape and grants',
    (select pg_get_function_result(p.oid) || ' | ' || p.prosecdef::text || ' | ' || p.provolatile::text
            || ' | ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
            || has_function_privilege('anon', p.oid, 'EXECUTE')::text
       from pg_proc p where p.oid = 'public.admin_beta_leads_list()'::regprocedure),
    'TABLE(id uuid, created_at timestamp with time zone, brand_type text[], brand_name text, contact_name text, city text, email text, source text, user_agent text, referer text) | true | s | truetruefalse');
end;
$w12$;

-- ---------------------------------------------------------------------------
-- W1-15 — the migration's self-check, run against deliberate mistakes. Each
-- mistake is made inside a block that is undone when the self-check objects.
-- ---------------------------------------------------------------------------
do $w15$
declare
  v_sql text := (select sql from t3802w_selfcheck);
  m record;
  v_got text;
begin
  perform pg_temp.t3802w_check('W1-15', 'the self-check block was read from the migration file',
    (v_sql like 'DO $check$%' and v_sql like '%$check$;%' and length(v_sql) > 2000)::text, 'true');
  if v_sql is null or v_sql not like 'DO $check$%' then
    return;
  end if;

  begin
    execute v_sql;
    v_got := 'passed';
  exception when others then
    v_got := 'ERR:' || sqlerrm;
  end;
  perform pg_temp.t3802w_check('W1-15', 'as shipped, the self-check passes', v_got, 'passed');

  for m in
    select * from (values
      ('an internal function opened to signed-in users', $q$grant execute on function public.crm_ctx() to authenticated$q$, '%authenticated can execute the internal public.crm_ctx()%'),
      ('the promoter opened to signed-in users',         $q$grant execute on function public.crm_reconcile_live(uuid) to authenticated$q$, '%authenticated can execute the internal public.crm_reconcile_live(uuid)%'),
      ('the directory opened to signed-in users',        $q$grant execute on function public.admin_team_directory() to authenticated$q$, '%authenticated can execute the internal public.admin_team_directory()%'),
      ('a client function opened to anon',               $q$grant execute on function public.crm_records_list(text) to anon$q$, '%anon can execute public.crm_records_list(text)%'),
      ('a client function opened to everyone',           $q$grant execute on function public.crm_record_get(uuid) to public$q$, '%can execute public.crm_record_get(uuid)%'),
      ('a client function closed to signed-in users',    $q$revoke execute on function public.crm_config() from authenticated$q$, '%authenticated cannot execute public.crm_config()%'),
      ('a table readable by signed-in users',            $q$grant select on public.crm_records to authenticated$q$, '%authenticated holds SELECT on public.crm_records%'),
      ('a table writable by anon',                       $q$grant insert on public.crm_activity to anon$q$, '%anon holds INSERT on public.crm_activity%'),
      ('one column readable by signed-in users',         $q$grant select (name) on public.crm_records to authenticated$q$, '%authenticated holds%on public.crm_records%'),
      ('a policy on a pipeline table',                   $q$create policy issue3802w_planted on public.crm_record_owners for select using (true)$q$, '%a policy exists on public.crm_record_owners%'),
      ('row security switched off',                      $q$alter table public.crm_request_keys disable row level security$q$, '%row security is off on public.crm_request_keys%'),
      ('a stray pipeline function',                      $q$create function public.crm_issue3802w_stray() returns int language sql as 'select 1'$q$, '%crm_ function(s) are not in the checked list%'),
      ('the name rule dropped',                          $q$drop index public.crm_records_live_name_key$q$, '%expected 2 valid unique partial indexes%'),
      ('a non-admin role given the admin console',       $q$create or replace function public.admin_team_role_areas(p_role text) returns text[] language sql immutable set search_path = '' as $f$ select case p_role when 'growth' then array['role_home','crm','admin_console'] else array[]::text[] end $f$$q$, '%a non-admin role was given an admin area%'),
      ('the beta leads reader opened to anon',           $q$grant execute on function public.admin_beta_leads_list() to anon$q$, '%anon can execute admin_beta_leads_list()%'),
      ('a stage the table does not accept',              $q$alter table public.crm_records drop constraint crm_records_stage_check, add constraint crm_records_stage_check check (stage <> 'meeting') not valid$q$, '%crm_pipeline_def and the crm_records CHECK constraints disagree%')
    ) as v(label, mistake, want)
  loop
    begin
      execute m.mistake;
      execute v_sql;
      v_got := 'passed';
      raise exception 'issue3802w_undo_the_mistake';
    exception when others then
      if sqlerrm = 'issue3802w_undo_the_mistake' then
        v_got := 'the self-check did not object';
      else
        v_got := sqlerrm;
      end if;
    end;
    perform pg_temp.t3802w_like('W1-15', 'the self-check objects to ' || m.label, v_got, m.want);
  end loop;

  begin
    execute v_sql;
    v_got := 'passed';
  exception when others then
    v_got := 'ERR:' || sqlerrm;
  end;
  perform pg_temp.t3802w_check('W1-15', 'every mistake was undone: the self-check passes again', v_got, 'passed');
end;
$w15$;

-- ---------------------------------------------------------------------------
-- Verdict (part 1). Every failed check is listed; one or more fails the suite.
-- ---------------------------------------------------------------------------
do $verdict$
declare
  v_total int;
  v_failed int;
  v_tests text;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802w_results;
  if v_total < 1000 then
    raise exception 'ISSUE-3802 WAVE1 FAIL: only % checks ran; the suite did not execute fully', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from t3802w_results where not ok order by seq limit 80 loop
      raise warning 'ISSUE-3802 WAVE1 FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    select string_agg(distinct test, ', ' order by test) into v_tests from t3802w_results where not ok;
    raise exception 'ISSUE-3802 WAVE1 FAIL: % of % checks failed in: %', v_failed, v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 WAVE1 PASS (part 1): % checks across W1-1..W1-15, 0 failed', v_total;
end;
$verdict$;

rollback;

-- ===========================================================================
-- PART 2 — real concurrency. Two team rows, two accounts and a few pipeline
-- records are committed and removed.
-- ===========================================================================
create schema t3802w_race;
select count(*) = 0 as t3802w_made_dblink from pg_extension where extname = 'dblink' \gset
create extension if not exists dblink with schema t3802w_race;
select n.nspname as t3802w_dblink_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'dblink' \gset
set search_path = public, :"t3802w_dblink_schema";
select set_config('t3802w.conn',
  format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s',
         current_setting('port'), current_database(), current_user, :'t3802w_pw'), false) is not null as conn_ready;

create table t3802w_race.results (seq serial primary key, label text, ok boolean, detail text);

-- Leftovers from an interrupted earlier run, then this run's people. Two full
-- admins: that role needs no confirmed-mailbox column, which this image lacks
-- outside part 1.
begin;
delete from public.crm_activity where actor_email like 'issue3802w-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802w-race-%');
delete from public.crm_record_owners where owner_email like 'issue3802w-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802w-race-%');
delete from public.crm_records where created_by like 'issue3802w-race-%';
delete from public.crm_request_keys where actor_email like 'issue3802w-race-%';
set local session_replication_role = replica;
delete from public.admin_audit_log where admin_email like 'issue3802w-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802w-race-%';
delete from auth.users where email like 'issue3802w-race-%';
insert into auth.users (id, email) values
  ('38020000-0000-4000-c900-000000000001', 'issue3802w-race-1@test.local'),
  ('38020000-0000-4000-c900-000000000002', 'issue3802w-race-2@test.local');
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802w-race-1@test.local', 'admin', 'active', now()),
  ('issue3802w-race-2@test.local', 'admin', 'active', now());
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('38020000-0000-4000-c910-000000000001', 'hosts', 'Issue3802w Race Card', 'prospect', 'issue3802w-race-1@test.local', 'issue3802w-race-1@test.local');
commit;

do $race$
declare
  c_conn constant text := current_setting('t3802w.conn');
  v_c text;
  v_n int;
  v_pid int;
  v_waited boolean;
  v_r1 text;
  v_r2 text;
  v_err text;
  i int;
begin
  -- R-1: two people add the same name at the same moment.
  begin
    v_n := 0;
    foreach v_c in array array['t3802w_c1', 't3802w_c2'] loop
      v_n := v_n + 1;
      perform dblink_connect(v_c, c_conn);
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-c900-00000000000%s', true) || set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-c900-00000000000%s","role":"authenticated"}', true)$q$,
        v_n, v_n)) as t(x text);
    end loop;

    select x into v_r1 from dblink('t3802w_c1',
      $q$select public.crm_record_create('hosts', '{"name": "Issue3802w Race Venue"}'::jsonb, 'race-create-0001')::text$q$) as t(x text);
    select x into v_pid from dblink('t3802w_c2', 'select pg_backend_pid()') as t(x int);
    perform dblink_send_query('t3802w_c2',
      $q$select public.crm_record_create('hosts', '{"name": "issue3802w-race venue"}'::jsonb, 'race-create-0002')::text$q$);
    v_waited := false;
    for i in 1..200 loop
      select exists (select 1 from pg_locks l where l.pid = v_pid and not l.granted) into v_waited;
      exit when v_waited or dblink_is_busy('t3802w_c2') = 0;
      perform pg_sleep(0.05);
    end loop;
    insert into t3802w_race.results (label, ok, detail)
    values ('R-1 the second add waits for the first', v_waited, 'waited=' || v_waited::text);

    perform dblink_exec('t3802w_c1', 'commit');
    select x into v_r2 from dblink_get_result('t3802w_c2', false) as t(x text);
    v_err := coalesce(dblink_error_message('t3802w_c2'), '');
    perform * from dblink_get_result('t3802w_c2', false) as t(x text);
    perform dblink_exec('t3802w_c2', 'commit');

    insert into t3802w_race.results (label, ok, detail)
    values ('R-1 the first add is created', (v_r1::jsonb ->> 'status') = 'created', left(v_r1, 120));
    insert into t3802w_race.results (label, ok, detail)
    values ('R-1 the second add is told it is a duplicate of the first',
            coalesce((v_r2::jsonb ->> 'status') = 'duplicate' and (v_r2::jsonb #>> '{existing,id}') = (v_r1::jsonb #>> '{record,id}'), false),
            coalesce(left(v_r2, 160), '<null>') || ' ' || v_err);
    insert into t3802w_race.results (label, ok, detail)
    select 'R-1 exactly one record exists', count(*) = 1, count(*)::text
      from public.crm_records where pipeline = 'hosts' and name_key = 'issue3802wracevenue' and deleted_at is null;
  exception when others then
    insert into t3802w_race.results (label, ok, detail)
    values ('R-1 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array array['t3802w_c1', 't3802w_c2'] loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then
      perform dblink_disconnect(v_c);
    end if;
  end loop;

  -- R-2: two people move the same card at the same moment.
  begin
    v_n := 0;
    foreach v_c in array array['t3802w_c1', 't3802w_c2'] loop
      v_n := v_n + 1;
      perform dblink_connect(v_c, c_conn);
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-c900-00000000000%s', true) || set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-c900-00000000000%s","role":"authenticated"}', true)$q$,
        v_n, v_n)) as t(x text);
    end loop;

    select x into v_r1 from dblink('t3802w_c1',
      $q$select public.crm_record_move_stage('38020000-0000-4000-c910-000000000001', 'contacted')::text$q$) as t(x text);
    select x into v_pid from dblink('t3802w_c2', 'select pg_backend_pid()') as t(x int);
    perform dblink_send_query('t3802w_c2',
      $q$select public.crm_record_move_stage('38020000-0000-4000-c910-000000000001', 'replied')::text$q$);
    v_waited := false;
    for i in 1..200 loop
      select exists (select 1 from pg_locks l where l.pid = v_pid and not l.granted) into v_waited;
      exit when v_waited or dblink_is_busy('t3802w_c2') = 0;
      perform pg_sleep(0.05);
    end loop;
    insert into t3802w_race.results (label, ok, detail)
    values ('R-2 the second move waits for the first', v_waited, 'waited=' || v_waited::text);

    perform dblink_exec('t3802w_c1', 'commit');
    select x into v_r2 from dblink_get_result('t3802w_c2', false) as t(x text);
    v_err := coalesce(dblink_error_message('t3802w_c2'), '');
    perform * from dblink_get_result('t3802w_c2', false) as t(x text);
    perform dblink_exec('t3802w_c2', 'commit');

    insert into t3802w_race.results (label, ok, detail)
    values ('R-2 both moves are answered',
            coalesce((v_r1::jsonb ->> 'changed') = 'true' and (v_r2::jsonb ->> 'changed') = 'true', false),
            coalesce(left(v_r1, 60), '<null>') || ' / ' || coalesce(left(v_r2, 60), '<null>') || ' ' || v_err);
    insert into t3802w_race.results (label, ok, detail)
    select 'R-2 the card ends in the later stage', stage = 'replied', stage
      from public.crm_records where id = '38020000-0000-4000-c910-000000000001';
    insert into t3802w_race.results (label, ok, detail)
    select 'R-2 the log has both moves, in order, each from the stage before it',
           coalesce(string_agg(from_stage || '>' || to_stage || ':' || actor_email, ',' order by created_at), '')
             = 'prospect>contacted:issue3802w-race-1@test.local,contacted>replied:issue3802w-race-2@test.local',
           coalesce(string_agg(from_stage || '>' || to_stage || ':' || actor_email, ',' order by created_at), '<none>')
      from public.crm_activity where record_id = '38020000-0000-4000-c910-000000000001' and kind = 'stage_move';
  exception when others then
    insert into t3802w_race.results (label, ok, detail)
    values ('R-2 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array array['t3802w_c1', 't3802w_c2'] loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then
      perform dblink_disconnect(v_c);
    end if;
  end loop;
end;
$race$;

select count(*) as t3802w_race_total,
       count(*) filter (where not ok) as t3802w_race_failed,
       coalesce(string_agg(label || ' [' || coalesce(detail, '') || ']', '; ' order by seq) filter (where not ok), 'none') as t3802w_race_failures
  from t3802w_race.results \gset

-- Remove the committed rows, whatever the verdict.
begin;
delete from public.crm_activity where actor_email like 'issue3802w-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802w-race-%');
delete from public.crm_record_owners where owner_email like 'issue3802w-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802w-race-%');
delete from public.crm_records where created_by like 'issue3802w-race-%';
delete from public.crm_request_keys where actor_email like 'issue3802w-race-%';
set local session_replication_role = replica;
delete from public.admin_audit_log where admin_email like 'issue3802w-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802w-race-%';
delete from auth.users where email like 'issue3802w-race-%';
commit;
reset search_path;
\if :t3802w_made_dblink
drop extension if exists dblink;
\endif
drop schema t3802w_race cascade;

select (:t3802w_race_total < 7 or :t3802w_race_failed > 0) as t3802w_race_bad \gset
\if :t3802w_race_bad
  \echo 'ISSUE-3802 WAVE1 FAILED (part 2):' :t3802w_race_failures
  do $$ begin raise exception 'ISSUE-3802 WAVE1 FAIL: concurrency checks failed or did not run'; end $$;
\endif
\echo 'ISSUE-3802 WAVE1 PASS (part 2):' :t3802w_race_total 'concurrency checks, 0 failed'
