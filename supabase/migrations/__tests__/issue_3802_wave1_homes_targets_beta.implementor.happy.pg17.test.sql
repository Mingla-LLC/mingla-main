-- Issue #3802 (Wave 1) — implementor suite for role homes, monthly targets,
-- Beta leads for the whole team, and the server rules added with them
-- (PostgreSQL 17).
--
-- Proves, on the fully replayed schema:
--   H-1   grants and catalog shape of every new object
--   H-2   a move names the stage it saw: right stage moves, wrong stage is
--         refused and writes nothing; two- and three-argument calls are
--         unchanged
--   H-3   one name, one key: the key table, refusals on add, bulk add and
--         rename, stored names in NFC form
--   H-4   the re-key from the migration file, run again on planted rows: keys
--         recomputed, names normalised, a collision or an empty name aborts
--         with a count and changes nothing
--   H-5   a host that fails every scheduled run is reported once in 24 hours,
--         again when the set of failing hosts changes, and on every run for
--         one host
--   H-6   the two summaries: who may call them, and every number against a
--         direct count
--   H-7   targets: owner and admin only, one audit row per change, none for
--         a repeat, progress counted this month
--   H-8   the role-aware Beta leads reader: callers, shape, and what it never
--         returns
--   H-9   Add to Hosts: every type, every city case, repeat, same name, a
--         name that cannot be used, a deleted host
--   H-10  an invitation is refused when sent if the address belongs to an
--         account that signs in another way
--   H-11  a creator reaches Booked or Posted only with a signed agreement, by
--         every route, over every pair of stages
--   H-12  is_admin_user() is unchanged
--   H-13  the migration's self-check aborts on a wrong grant or a stale key
--   Part 2  two sessions move one card to different stages, each naming the
--           stage it saw: exactly one succeeds; two sessions add one lead to
--           Hosts: one host; two sessions set one new target: the second
--           waits and is answered, one row (real sessions)
--
-- Part 1 is one transaction, rolled back. Part 2 commits a few rows and
-- removes them. Never run on production.
--
-- Runs as the image's admin role, like the other #3802 suites: the bare CI
-- image ships an auth.users without email_confirmed_at or phone and has no
-- auth.identities; this suite adds them inside its own rolled-back
-- transaction. Run from the repository root (H-4 and H-13 read the migration
-- files).
--
-- Checks are RECORDED and reported together.

\set ON_ERROR_STOP on
\getenv t3802h_pw PGPASSWORD
\set t3802h_selfcheck `sed -n '/^DO \$check\$/,/^\$check\$;/p' supabase/migrations/20270823003802_issue_3802_wave1_homes_targets_beta.sql`
\set t3802h_rekey `sed -n '/^-- issue-3802-pr3 rekey: begin/,/^-- issue-3802-pr3 rekey: end/p' supabase/migrations/20270823003802_issue_3802_wave1_homes_targets_beta.sql`
\set t3802h_oldkey `sed -n '/^CREATE FUNCTION public.crm_name_key/,/^\$\$;/p' supabase/migrations/20270820003802_issue_3802_wave1_crm_pipelines.sql`

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

create temp table t3802h_src (k text primary key, sql text) on commit drop;
insert into t3802h_src values
  ('selfcheck', :'t3802h_selfcheck'),
  ('rekey', :'t3802h_rekey'),
  ('oldkey', :'t3802h_oldkey');

create temp table t3802h_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802h_people (who, id, email) values
  ('owner',    '38020000-0000-4000-d000-000000000001', 'issue3802h-owner@test.local'),
  ('admin',    '38020000-0000-4000-d000-000000000002', 'issue3802h-admin@test.local'),
  ('growth',   '38020000-0000-4000-d000-000000000003', 'issue3802h-growth@test.local'),
  ('partner',  '38020000-0000-4000-d000-000000000004', 'issue3802h-partner@test.local'),
  ('invited',  '38020000-0000-4000-d000-000000000005', 'issue3802h-invited@test.local'),
  ('revoked',  '38020000-0000-4000-d000-000000000006', 'issue3802h-revoked@test.local'),
  ('consumer', '38020000-0000-4000-d000-000000000007', 'issue3802h-consumer@test.local'),
  ('growth2',  '38020000-0000-4000-d000-000000000008', 'issue3802h-growth2@test.local');

insert into auth.users (id, email, email_confirmed_at)
select id, email, now() from t3802h_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802h-owner@test.local', 'owner', 'active', now()),
  ('issue3802h-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('issue3802h-growth@test.local',   'growth',  'active',  now()),
  ('issue3802h-partner@test.local',  'partner', 'active',  now()),
  ('issue3802h-invited@test.local',  'growth',  'invited', null),
  ('issue3802h-revoked@test.local',  'partner', 'revoked', now()),
  ('issue3802h-growth2@test.local',  'growth',  'active',  now());

-- Fixture rows only: no product side effects are wanted.
set local session_replication_role = replica;
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, is_live_for_consumers) values
  ('38020000-0000-4000-d200-000000000001', 'issue3802h-lagos',  'Issue3802h Lagos',  'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5, true),
  ('38020000-0000-4000-d200-000000000002', 'issue3802h-durham', 'Issue3802h Durham', 'United States', 'US', 35.9, -78.9, 35.8, -79.0, 36.0, -78.8, false),
  ('38020000-0000-4000-d200-000000000003', 'issue3802h-twin-a', 'Issue3802h Twin',   'United States', 'US', 1, 1, 0, 0, 2, 2, false),
  ('38020000-0000-4000-d200-000000000004', 'issue3802h-twin-b', 'issue3802h-twin',   'United Kingdom', 'GB', 1, 1, 0, 0, 2, 2, false);
insert into public.brands (id, account_id, name, slug, city) values
  ('38020000-0000-4000-d100-000000000001', '38020000-0000-4000-d300-000000000001', 'Issue3802h Brand One',   'issue3802h-brand-one',   'Lagos'),
  ('38020000-0000-4000-d100-000000000002', '38020000-0000-4000-d300-000000000001', 'Issue3802h Brand Two',   'issue3802h-brand-two',   'Lagos'),
  ('38020000-0000-4000-d100-000000000003', '38020000-0000-4000-d300-000000000001', 'Issue3802h Brand Three', 'issue3802h-brand-three', 'Lagos');
set local session_replication_role = origin;

create temp table t3802h_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3802h_ids (k text primary key, v text) on commit drop;

-- Run one statement as a caller; return its single text result, or
-- 'ERR:<sqlstate>:<message>'. The DETAIL of a refusal is kept for
-- pg_temp.t3802h_detail(). A raised statement leaves nothing behind.
create function pg_temp.t3802h_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
  v_detail text;
begin
  perform set_config('t3802h.detail', '', true);
  if p_who not in ('anon', 'postgres', 'service') then
    select id, email into strict v_id, v_email from t3802h_people where who = p_who;
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
    get stacked diagnostics v_detail = pg_exception_detail;
    reset role;
    perform set_config('t3802h.detail', coalesce(v_detail, ''), true);
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.t3802h_detail() returns text
language sql as $fn$ select current_setting('t3802h.detail', true) $fn$;

create function pg_temp.t3802h_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802h_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3802h_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3802h_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 400), '<null>'), p_pattern));
end;
$fn$;

-- A JSON answer as JSON; a captured error becomes an empty object, so the
-- checks that follow are recorded as failed instead of stopping the suite.
create function pg_temp.t3802h_jb(p text) returns jsonb
language plpgsql as $fn$
begin
  return coalesce(p::jsonb, '{}'::jsonb);
exception when others then
  return '{}'::jsonb;
end;
$fn$;

create function pg_temp.t3802h_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

-- A check made inside a block that is undone afterwards would be undone with
-- it. Such a block NOTES its checks in a variable instead (a variable keeps
-- its value when the block is rolled back) and they are recorded after it.
create function pg_temp.t3802h_note(p_label text, p_got text, p_want text, p_like boolean default false) returns jsonb
language sql as $fn$
  select jsonb_build_array(jsonb_build_object('label', p_label, 'got', p_got, 'want', p_want, 'like', p_like))
$fn$;

create function pg_temp.t3802h_record(p_test text, p_notes jsonb) returns void
language plpgsql as $fn$
declare
  n jsonb;
begin
  for n in select e from jsonb_array_elements(coalesce(p_notes, '[]'::jsonb)) e loop
    if (n->>'like')::boolean then
      perform pg_temp.t3802h_like(p_test, n->>'label', n->>'got', n->>'want');
    else
      perform pg_temp.t3802h_check(p_test, n->>'label', n->>'got', n->>'want');
    end if;
  end loop;
end;
$fn$;

create function pg_temp.t3802h_id(p_k text) returns text
language sql as $fn$ select v from t3802h_ids where k = p_k $fn$;

create function pg_temp.t3802h_keep(p_k text, p_v text) returns void
language sql as $fn$
  insert into t3802h_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

-- Everything a pipeline function could have written.
create function pg_temp.t3802h_snapshot() returns text
language sql as $fn$
  select md5(coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.crm_records r), '[]'::jsonb)::text)
      || md5(coalesce((select jsonb_agg(to_jsonb(o) order by o.record_id, o.owner_email) from public.crm_record_owners o), '[]'::jsonb)::text)
      || md5(coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.crm_activity a), '[]'::jsonb)::text)
      || md5(coalesce((select jsonb_agg(to_jsonb(q) order by q.actor_email, q.request_key) from public.crm_request_keys q), '[]'::jsonb)::text)
      || md5(coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.crm_targets t), '[]'::jsonb)::text)
$fn$;

create function pg_temp.t3802h_audit() returns int
language sql as $fn$
  select count(*)::int from public.admin_audit_log where action like 'crm.%'
$fn$;

-- Create a record as a caller and remember its id under a short name.
create function pg_temp.t3802h_make(p_k text, p_who text, p_pipeline text, p_fields jsonb) returns text
language plpgsql as $fn$
declare
  r text;
begin
  r := pg_temp.t3802h_as(p_who, format($q$select public.crm_record_create(%L, %L::jsonb, %L)::text$q$,
                                        p_pipeline, p_fields::text, 'hk-' || p_k || '-' || p_who));
  perform pg_temp.t3802h_keep(p_k, pg_temp.t3802h_get(r, 'record', 'id'));
  return r;
end;
$fn$;

create function pg_temp.t3802h_move(p_who text, p_k text, p_to text, p_reason text, p_expected text) returns text
language sql as $fn$
  select pg_temp.t3802h_as(p_who, format(
    $q$select public.crm_record_move_stage(p_id => %L, p_to => %L, p_reason => %L, p_expected_from => %L)::text$q$,
    pg_temp.t3802h_id(p_k), p_to, p_reason, p_expected))
$fn$;

-- ---------------------------------------------------------------------------
-- H-1 — grants and catalog shape.
-- ---------------------------------------------------------------------------
do $h1$
declare
  c_client constant text[] := array[
    'crm_home_summary(date)', 'crm_team_summary(date)', 'crm_target_set(uuid,text,integer)',
    'crm_beta_leads_list()', 'crm_beta_lead_to_host(uuid)', 'crm_record_move_stage(uuid,text,text,text)'];
  c_internal constant text[] := array[
    'crm_stage_counts_json()', 'crm_due_json(text,date,integer)', 'crm_targets_json(date)',
    'crm_beta_icp(text[])', 'crm_city_region(text)', 'admin_team_invite_address_verdict(text)'];
  v_fn text;
  v_role text;
  v_priv text;
  v_who text;
  v_stmt text;
begin
  foreach v_fn in array c_client loop
    perform pg_temp.t3802h_check('H-1', 'grants on the client function ' || v_fn,
      has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE')::text
        || '/' || has_function_privilege('service_role', 'public.' || v_fn, 'EXECUTE')::text, 'false/true/true');
    perform pg_temp.t3802h_check('H-1', v_fn || ' runs as its owner',
      (select prosecdef::text from pg_proc where oid = ('public.' || v_fn)::regprocedure), 'true');
  end loop;
  foreach v_fn in array c_internal loop
    perform pg_temp.t3802h_check('H-1', 'grants on the internal function ' || v_fn,
      has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE')::text
        || '/' || has_function_privilege('service_role', 'public.' || v_fn, 'EXECUTE')::text, 'false/false/true');
  end loop;
  foreach v_fn in array c_client || c_internal loop
    perform pg_temp.t3802h_check('H-1', v_fn || ' holds nothing for PUBLIC and pins an empty search_path',
      (select (not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))::text || '/' || (p.proacl is not null)::text
              || '/' || coalesce(array_to_string(p.proconfig, ','), '<none>')
         from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure),
      'true/true/search_path=""');
    perform pg_temp.t3802h_check('H-1', v_fn || ' is written in plain ASCII',
      (select (octet_length(p.prosrc) = char_length(p.prosrc))::text from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure), 'true');
  end loop;

  perform pg_temp.t3802h_check('H-1', 'the move function exists once, with four arguments',
    (select count(*)::text || '/' || max(pronargs)::text || '/' || max(pg_get_function_identity_arguments(oid))
       from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crm_record_move_stage'),
    '1/4/p_id uuid, p_to text, p_reason text, p_expected_from text');
  perform pg_temp.t3802h_like('H-1', 'the move function says how to use the expected stage',
    obj_description('public.crm_record_move_stage(uuid,text,text,text)'::regprocedure, 'pg_proc'),
    '%p_expected_from is the stage the caller last saw the card in%stage_changed%');
  perform pg_temp.t3802h_check('H-1', 'the invitation issuer kept its grants',
    has_function_privilege('anon', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')::text || '/'
      || has_function_privilege('authenticated', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')::text || '/'
      || has_function_privilege('service_role', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')::text, 'false/true/true');

  -- The targets table.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      perform pg_temp.t3802h_check('H-1', v_role || ' ' || v_priv || ' on crm_targets',
        has_table_privilege(v_role, 'public.crm_targets', v_priv)::text, 'false');
    end loop;
    perform pg_temp.t3802h_check('H-1', v_role || ' has no column privilege on crm_targets',
      (select count(*)::text from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'crm_targets' and grantee = v_role), '0');
  end loop;
  perform pg_temp.t3802h_check('H-1', 'crm_targets: grantees besides the owner',
    (select string_agg(distinct coalesce(g.rolname, 'PUBLIC'), ',' order by coalesce(g.rolname, 'PUBLIC'))
       from pg_class c, aclexplode(c.relacl) a left join pg_roles g on g.oid = a.grantee
      where c.oid = 'public.crm_targets'::regclass and a.grantee <> c.relowner), 'service_role');
  perform pg_temp.t3802h_check('H-1', 'crm_targets: row security on, no policy, no trigger, no foreign key',
    (select relrowsecurity::text from pg_class where oid = 'public.crm_targets'::regclass)
      || '/' || (select count(*)::text from pg_policy where polrelid = 'public.crm_targets'::regclass)
      || '/' || (select count(*)::text from pg_trigger where tgrelid = 'public.crm_targets'::regclass and not tgisinternal)
      || '/' || (select count(*)::text from pg_constraint where contype = 'f'
                  and (conrelid = 'public.crm_targets'::regclass or confrelid = 'public.crm_targets'::regclass)),
    'true/0/0/0');
  perform pg_temp.t3802h_check('H-1', 'no view reads crm_targets',
    (select count(*)::text from pg_views where schemaname not in ('pg_catalog', 'information_schema') and definition ~* '\mcrm_targets\M'), '0');

  -- Every direct statement at the table is refused, for every kind of caller.
  foreach v_who in array array['owner', 'admin', 'growth', 'partner', 'consumer', 'anon'] loop
    foreach v_stmt in array array[
      $q$select count(*)::text from public.crm_targets$q$,
      $q$with x as (insert into public.crm_targets (region_id, icp, monthly_target, created_by, updated_by) values (gen_random_uuid(), 'partner_org', 5, 'x', 'x') returning 1) select count(*)::text from x$q$,
      $q$with x as (update public.crm_targets set monthly_target = 999 returning 1) select count(*)::text from x$q$,
      $q$with x as (delete from public.crm_targets returning 1) select count(*)::text from x$q$]
    loop
      perform pg_temp.t3802h_check('H-1', v_who || ' cannot reach crm_targets directly: ' || left(v_stmt, 40),
        pg_temp.t3802h_as(v_who, v_stmt), 'ERR:42501:permission denied for table crm_targets');
    end loop;
  end loop;

  -- Asked as the migration role, the way the grant guard is run in CI.
  set local role postgres;
  select count(*)::text into v_stmt from public.audit_overbroad_table_grants() where not is_baselined;
  reset role;
  perform pg_temp.t3802h_check('H-1', 'grant guard reports nothing new', v_stmt, '0');
end;
$h1$;

-- ---------------------------------------------------------------------------
-- H-2 — a move names the stage it saw.
-- ---------------------------------------------------------------------------
do $h2$
declare
  r text;
  v_snap text;
  v_audit int;
begin
  perform pg_temp.t3802h_make('h2', 'growth', 'hosts', '{"name": "H2 Card"}');
  perform pg_temp.t3802h_make('h2old', 'growth', 'hosts', '{"name": "H2 Old Caller"}');

  -- Right stage: moved.
  v_audit := pg_temp.t3802h_audit();
  r := pg_temp.t3802h_move('growth', 'h2', 'contacted', null, 'prospect');
  perform pg_temp.t3802h_check('H-2', 'naming the right stage moves the card',
    pg_temp.t3802h_get(r, 'changed') || '/' || pg_temp.t3802h_get(r, 'record', 'stage'), 'true/contacted');
  perform pg_temp.t3802h_check('H-2', 'that move wrote one audit row', (pg_temp.t3802h_audit() - v_audit)::text, '1');

  -- Wrong stage: refused, nothing written.
  v_snap := pg_temp.t3802h_snapshot();
  v_audit := pg_temp.t3802h_audit();
  r := pg_temp.t3802h_move('partner', 'h2', 'replied', null, 'prospect');
  perform pg_temp.t3802h_check('H-2', 'naming a stage the card has left is refused in plain words', r,
    'ERR:22023:stage_changed: This card is in Contacted now, not Prospect, so nothing was moved. Read the card again and move it from where it is.');
  perform pg_temp.t3802h_check('H-2', 'the refusal carries the stage the card is in now', pg_temp.t3802h_detail(), 'contacted');
  perform pg_temp.t3802h_check('H-2', 'the refusal wrote no row, no log line and no audit row',
    pg_temp.t3802h_snapshot() || '/' || (pg_temp.t3802h_audit() - v_audit)::text, v_snap || '/0');

  -- A move into a stage that needs a reason is still refused first for the stale stage.
  r := pg_temp.t3802h_move('growth', 'h2', 'lost', 'No budget', 'meeting');
  perform pg_temp.t3802h_like('H-2', 'a stale move to Lost is refused the same way', r, 'ERR:22023:stage_changed: This card is in Contacted now, not Meeting,%');

  -- "Already there" stays an answer whatever stage was named.
  r := pg_temp.t3802h_move('growth', 'h2', 'contacted', null, 'meeting');
  perform pg_temp.t3802h_check('H-2', 'a card already in the target stage answers changed: false', pg_temp.t3802h_get(r, 'changed'), 'false');

  -- Not a stage at all.
  r := pg_temp.t3802h_move('growth', 'h2', 'replied', null, 'booked');
  perform pg_temp.t3802h_like('H-2', 'an expected stage from the other pipeline is not a stage', r, 'ERR:22023:invalid_stage: booked is not a stage of hosts. Use one of:%');
  r := pg_temp.t3802h_move('growth', 'h2', 'replied', null, '');
  perform pg_temp.t3802h_like('H-2', 'an empty expected stage is not a stage', r, 'ERR:22023:invalid_stage:%');
  perform pg_temp.t3802h_check('H-2', 'none of those moved the card',
    (select stage from public.crm_records where id = pg_temp.t3802h_id('h2')::uuid), 'contacted');

  -- The rules that were there before still apply after the stage matches.
  r := pg_temp.t3802h_move('growth', 'h2', 'live', null, 'contacted');
  perform pg_temp.t3802h_like('H-2', 'Live still sets itself', r, 'ERR:22023:stage_sets_itself:%');
  r := pg_temp.t3802h_move('growth', 'h2', 'lost', null, 'contacted');
  perform pg_temp.t3802h_like('H-2', 'Lost still needs a reason', r, 'ERR:22023:reason_required:%');
  r := pg_temp.t3802h_move('growth', 'h2', 'lost', 'No budget this year', 'contacted');
  perform pg_temp.t3802h_check('H-2', 'with the right stage and a reason the card is marked lost',
    pg_temp.t3802h_get(r, 'record', 'stage') || '/' || pg_temp.t3802h_get(r, 'record', 'stage_reason'), 'lost/No budget this year');

  -- Callers that send two or three arguments behave as before.
  r := pg_temp.t3802h_as('growth', format($q$select public.crm_record_move_stage(%L, 'contacted')::text$q$, pg_temp.t3802h_id('h2old')));
  perform pg_temp.t3802h_check('H-2', 'two positional arguments still move the card', pg_temp.t3802h_get(r, 'changed'), 'true');
  r := pg_temp.t3802h_as('growth', format($q$select public.crm_record_move_stage(p_id => %L, p_to => 'replied', p_reason => null)::text$q$, pg_temp.t3802h_id('h2old')));
  perform pg_temp.t3802h_check('H-2', 'three named arguments (the deployed client) still move the card', pg_temp.t3802h_get(r, 'changed'), 'true');
  r := pg_temp.t3802h_as('growth', format($q$select public.crm_record_move_stage(%L, 'lost', 'Closed down')::text$q$, pg_temp.t3802h_id('h2old')));
  perform pg_temp.t3802h_check('H-2', 'three positional arguments still carry the reason',
    pg_temp.t3802h_get(r, 'record', 'stage') || '/' || pg_temp.t3802h_get(r, 'record', 'stage_reason'), 'lost/Closed down');
  r := pg_temp.t3802h_as('growth', format($q$select public.crm_record_move_stage(%L, 'contacted', null, null)::text$q$, pg_temp.t3802h_id('h2old')));
  perform pg_temp.t3802h_check('H-2', 'no expected stage moves the card from wherever it is', pg_temp.t3802h_get(r, 'record', 'stage'), 'contacted');

  -- Still gated first.
  perform pg_temp.t3802h_like('H-2', 'someone outside the team is refused before anything is read',
    pg_temp.t3802h_move('consumer', 'h2', 'replied', null, 'lost'), 'ERR:42501:forbidden:%');
end;
$h2$;

-- ---------------------------------------------------------------------------
-- H-3 — one name, one key.
-- ---------------------------------------------------------------------------
do $h3$
declare
  c record;
  r text;
  v text;
  v_n int := 0;
  v_snap text;
  c_unseen constant text[] := array[
    U&'\2800',                        -- a blank braille cell
    U&'\+0E0041\+0E0042',             -- tag characters
    U&'\FE0F',                        -- a variation mark alone
    U&'\+0E0100',                     -- an ideographic variation mark alone
    U&'\+01D173\+01D17A',             -- musical format characters
    U&'\0301',                        -- a combining mark alone
    U&'\200B\2800 \+0E0020\0301',     -- a mix of all of them
    U&'\+0110BD\+013430\+01BCA0',     -- format characters from three scripts
    U&'\093F',                        -- a Devanagari vowel sign alone
    U&'\0E34\0E48',                   -- Thai marks alone
    U&'\05B4\05C1',                   -- Hebrew points alone
    U&'\064E\0651',                   -- Arabic marks alone
    U&'\20DD',                        -- an enclosing mark alone
    U&'\+01D159\+016FE4\+01DA9B',     -- three characters with no shape
    U&'\E000\+0F0000',                -- private-use characters
    U&'\0378\0600'                    -- an unassigned and a format character
  ];
begin
  -- The same inputs the admin web client is tested against.
  for c in
    select * from (values
      ('plain',                 'Palm Court',                                       'palmcourt'),
      ('full-width',            U&'\FF30\FF41\FF4C\FF4D \FF23\FF4F\FF55\FF52\FF54', 'palmcourt'),
      ('ligature',              U&'\FB01sh',                                        'fish'),
      ('composed accent',       U&'Caf\00E9',                                       U&'caf\00E9'),
      ('decomposed accent',     U&'Cafe\0301',                                      U&'caf\00E9'),
      ('emoji',                 U&'\+01F355',                                       U&'\+01F355'),
      ('emoji with a mark',     U&'\+01F355\FE0F',                                  U&'\+01F355'),
      ('non-Latin',             U&'\0645\0637\0639\0645',                           U&'\0645\0637\0639\0645'),
      ('symbols',               '&&&',                                              '&&&'),
      ('kelvin sign',           U&'\212A',                                          'k'),
      ('blank braille',         U&'\2800',                                          ''),
      ('tag characters',        U&'\+0E0041\+0E0042',                               ''),
      ('variation mark alone',  U&'\FE0F',                                          ''),
      ('ideographic variation', U&'\+0E0100',                                       ''),
      ('musical format',        U&'\+01D173\+01D17A',                               ''),
      ('combining mark alone',  U&'\0301',                                          ''),
      ('Devanagari mark alone', U&'\093F',                                          ''),
      ('Thai mark alone',       U&'\0E34',                                          ''),
      ('Hebrew point alone',    U&'\05B4',                                          ''),
      ('Arabic mark alone',     U&'\064E',                                          ''),
      ('enclosing mark alone',  U&'\20DD',                                          ''),
      ('spacing mark alone',    U&'\0903',                                          ''),
      ('marks of five scripts', U&'\0301\093F\0E34\05B4\+01E8D0',                   ''),
      ('shapeless note head',   U&'\+01D159',                                       ''),
      ('script filler',         U&'\+016FE4',                                       ''),
      ('sign fill modifier',    U&'\+01DA9B',                                       ''),
      ('private use',           U&'\E000\+0F0000\+100000',                          ''),
      ('unassigned',            U&'\0378\+0E0080',                                  ''),
      ('format character',      U&'\0600\200E',                                     ''),
      ('joiners alone',         U&'\200C\200D',                                     ''),
      ('accented Latin',        U&'\00C9cole Fran\00E7aise',                         U&'\00E9colefran\00E7aise'),
      ('Hebrew with points',    U&'\05E9\05B4\05C1\05DC\05D5\05DD',                  U&'\05E9\05DC\05D5\05DD'),
      ('Arabic with marks',     U&'\0645\064E\0637\0639\064E\0645',                  U&'\0645\0637\0639\0645'),
      ('kana',                  U&'\3059\3057 \30E9\30FC\30E1\30F3',                 U&'\3059\3057\30E9\30FC\30E1\30F3'),
      ('CJK',                   U&'\65E5\672C\6599\7406',                           U&'\65E5\672C\6599\7406'),
      ('Hangul',                U&'\D55C\AD6D \C2DD\B2F9',                          U&'\D55C\AD6D\C2DD\B2F9'),
      ('star symbols',          U&'\2605\2605',                                     U&'\2605\2605'),
      ('emoji with a joiner',   U&'\+01F468\200D\+01F373',                          U&'\+01F468\+01F373'),
      ('flag emoji',            U&'\+01F1F3\+01F1EC',                               U&'\+01F1F3\+01F1EC'),
      ('Palm Court Kitchen',    'Palm Court Kitchen',                               'palmcourtkitchen'),
      ('palm-court kitchen',    'palm-court kitchen',                               'palmcourtkitchen'),
      ('@PalmCourtKitchen',     '@PalmCourtKitchen',                                'palmcourtkitchen'),
      ('spaced capitals',       '  PALM   COURT  KITCHEN ',                         'palmcourtkitchen'),
      ('Palm Court Kitchen.',   'Palm Court Kitchen.',                              'palmcourtkitchen'),
      ('Palm_Court/Kitchen!',   'Palm_Court/Kitchen!',                              'palmcourtkitchen'),
      ('Palm Court Kitchen 2',  'Palm Court Kitchen 2',                             'palmcourtkitchen2'),
      ('@lagos.eats',           '@lagos.eats',                                      'lagoseats'),
      ('Lagos Eats',            'Lagos Eats',                                       'lagoseats'),
      ('100% Fun',              '100% Fun',                                         '100fun'),
      ('!!!',                   '!!!',                                              '!!!'),
      ('A',                     'A',                                                'a'),
      ('@ @',                   '@ @',                                              '@@'),
      ('@!',                    '@!',                                               '@!')
    ) as v(label, input, want)
  loop
    perform pg_temp.t3802h_check('H-3', 'name key of ' || c.label, public.crm_name_key(c.input), c.want);
  end loop;
  perform pg_temp.t3802h_check('H-3', 'a tone-marked name keeps the key it had before',
    public.crm_name_key(U&'\1EB8\0300gb\00E1'), U&'\1EB9gb\00E1');

  -- Refusals: add, bulk add, rename.
  perform pg_temp.t3802h_make('h3base', 'growth', 'hosts', '{"name": "H3 Base"}');
  v_snap := pg_temp.t3802h_snapshot();
  foreach v in array c_unseen loop
    v_n := v_n + 1;
    perform pg_temp.t3802h_check('H-3', format('add: a name with nothing visible in it (%s) is refused', v_n),
      pg_temp.t3802h_as('growth', format($q$select public.crm_record_create('hosts', %L::jsonb, %L)::text$q$,
        jsonb_build_object('name', v)::text, 'h3-add-' || lpad(v_n::text, 4, '0'))),
      'ERR:22023:invalid_name: Add a name between 1 and 160 characters.');
    perform pg_temp.t3802h_check('H-3', format('rename: a name with nothing visible in it (%s) is refused', v_n),
      pg_temp.t3802h_as('growth', format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$,
        pg_temp.t3802h_id('h3base'), jsonb_build_object('name', v)::text)),
      'ERR:22023:invalid_name: Add a name between 1 and 160 characters.');
    r := pg_temp.t3802h_as('growth', format($q$select public.crm_records_bulk_create('hosts', %L::jsonb, %L)::text$q$,
        jsonb_build_array(jsonb_build_object('name', v))::text, 'h3-bulk-' || lpad(v_n::text, 4, '0')));
    perform pg_temp.t3802h_like('H-3', format('bulk add: a name with nothing visible in it (%s) is listed as invalid', v_n),
      pg_temp.t3802h_jb(r)->'invalid'->0->>'error', 'invalid_name:%');
    perform pg_temp.t3802h_check('H-3', format('bulk add: nothing was created for it (%s)', v_n),
      jsonb_array_length(pg_temp.t3802h_jb(r)->'created')::text, '0');
  end loop;
  perform pg_temp.t3802h_check('H-3', 'none of those refusals added or changed a record',
    (select count(*)::text || '/' || max(name) filter (where id = pg_temp.t3802h_id('h3base')::uuid) from public.crm_records where name like 'H3 %'),
    '1/H3 Base');

  -- One record however it is spelled.
  r := pg_temp.t3802h_make('h3fw', 'growth', 'hosts', jsonb_build_object('name', 'H3 Palm Court'));
  perform pg_temp.t3802h_check('H-3', 'the plain spelling is created', pg_temp.t3802h_get(r, 'status'), 'created');
  r := pg_temp.t3802h_as('partner', format($q$select public.crm_record_create('hosts', %L::jsonb, 'h3-fullwidth-0001')::text$q$,
        jsonb_build_object('name', U&'\FF28\FF13 \FF30\FF41\FF4C\FF4D \FF23\FF4F\FF55\FF52\FF54')::text));
  perform pg_temp.t3802h_check('H-3', 'the full-width spelling is the same record',
    pg_temp.t3802h_get(r, 'status') || '/' || (pg_temp.t3802h_get(r, 'existing', 'id') = pg_temp.t3802h_id('h3fw'))::text, 'duplicate/true');
  r := pg_temp.t3802h_make('h3acc', 'growth', 'hosts', jsonb_build_object('name', U&'H3 Cafe\0301 Lune'));
  perform pg_temp.t3802h_check('H-3', 'a name typed with a separate accent is created', pg_temp.t3802h_get(r, 'status'), 'created');
  perform pg_temp.t3802h_check('H-3', 'and is stored in its composed (NFC) form',
    (select encode(convert_to(name, 'UTF8'), 'hex') from public.crm_records where id = pg_temp.t3802h_id('h3acc')::uuid),
    encode(convert_to(U&'H3 Caf\00E9 Lune', 'UTF8'), 'hex'));
  r := pg_temp.t3802h_as('partner', format($q$select public.crm_record_create('hosts', %L::jsonb, 'h3-composed-0001')::text$q$,
        jsonb_build_object('name', U&'H3 Caf\00E9 Lune')::text));
  perform pg_temp.t3802h_check('H-3', 'the composed spelling is the same record', pg_temp.t3802h_get(r, 'status'), 'duplicate');
  r := pg_temp.t3802h_as('growth', format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$,
        pg_temp.t3802h_id('h3base'), jsonb_build_object('name', U&'\FF28\FF13 Palm Court')::text));
  perform pg_temp.t3802h_like('H-3', 'renaming onto another record''s name in full-width letters is refused', r, 'ERR:22023:duplicate_name:%');
  r := pg_temp.t3802h_as('growth', format($q$select public.crm_duplicate_check('hosts', %L)::text$q$, U&'\FF28\FF13 \FF30\FF41\FF4C\FF4D \FF23\FF4F\FF55\FF52\FF54'));
  perform pg_temp.t3802h_check('H-3', 'the duplicate check finds it from the full-width spelling',
    pg_temp.t3802h_get(r, 'exact', 'id'), pg_temp.t3802h_id('h3fw'));

  -- Still accepted: a name in any script, with its marks attached to letters.
  for c in
    select * from (values
      ('h3s1', U&'H3 \0915\093F\0924\093E\092C \0918\0930'),      -- Devanagari
      ('h3s2', U&'H3 \0E01\0E34\0E19\0E02\0E49\0E32\0E27'),          -- Thai
      ('h3s3', U&'H3 \05E9\05B4\05C1\05DC\05D5\05DD'),              -- Hebrew with points
      ('h3s4', U&'H3 \0645\064E\0637\0652\0639\064E\0645'),          -- Arabic with marks
      ('h3s5', U&'H3 \3059\3057\30E9\30FC\30E1\30F3'),              -- kana
      ('h3s6', U&'H3 \65E5\672C\6599\7406'),                        -- CJK
      ('h3s7', U&'H3 \00C9cole Fran\00E7aise'),                      -- accented Latin
      ('h3s8', U&'H3 \+01F468\200D\+01F373 Kitchen')                -- an emoji made with a joiner
    ) as v(k, name)
  loop
    r := pg_temp.t3802h_make(c.k, 'growth', 'hosts', jsonb_build_object('name', c.name));
    perform pg_temp.t3802h_check('H-3', 'a name in its own script is accepted and stored as typed (' || c.k || ')',
      pg_temp.t3802h_get(r, 'status') || '/' || (select encode(convert_to(x.name, 'UTF8'), 'hex') from public.crm_records x where x.id = pg_temp.t3802h_id(c.k)::uuid),
      'created/' || encode(convert_to(normalize(c.name, NFC), 'UTF8'), 'hex'));
  end loop;
  r := pg_temp.t3802h_make('h3strip', 'growth', 'hosts', jsonb_build_object('name', U&'H3 Str\E000ip\0600ped\0378 \+01D159Name'));
  perform pg_temp.t3802h_check('H-3', 'private-use, format, unassigned and shapeless characters inside a name are removed before it is stored',
    (select name from public.crm_records where id = pg_temp.t3802h_id('h3strip')::uuid), 'H3 Stripped Name');
  r := pg_temp.t3802h_make('h3emoji', 'growth', 'hosts', jsonb_build_object('name', U&'\+01F355\+01F355'));
  perform pg_temp.t3802h_check('H-3', 'an emoji-only name is still accepted', pg_temp.t3802h_get(r, 'status'), 'created');
  r := pg_temp.t3802h_make('h3arabic', 'growth', 'hosts', jsonb_build_object('name', U&'\0645\0637\0639\0645 \0627\0644\0646\062E\064A\0644'));
  perform pg_temp.t3802h_check('H-3', 'a non-Latin name is still accepted', pg_temp.t3802h_get(r, 'status'), 'created');
  r := pg_temp.t3802h_make('h3hidden', 'growth', 'hosts', jsonb_build_object('name', U&'H3 Hid\2800den\+0E0041 Name'));
  perform pg_temp.t3802h_check('H-3', 'hidden characters inside a name are removed before it is stored',
    (select name from public.crm_records where id = pg_temp.t3802h_id('h3hidden')::uuid), 'H3 Hidden Name');

  perform pg_temp.t3802h_check('H-3', 'every stored key is what the function answers',
    (select count(*)::text from public.crm_records where name_key is distinct from public.crm_name_key(name)), '0');
  perform pg_temp.t3802h_check('H-3', 'every stored name is in NFC form',
    (select count(*)::text from public.crm_records where name is distinct from normalize(name, NFC)), '0');
  perform pg_temp.t3802h_check('H-3', 'underneath, the table itself refuses a name with nothing visible',
    (select case when exists (select 1 from pg_constraint where conrelid = 'public.crm_records'::regclass and conname = 'crm_records_name_check'
                                and convalidated and pg_get_constraintdef(oid) like '%crm_name_key(name) <> ''''::text%') then 'present' else 'missing' end), 'present');
end;
$h3$;

-- ---------------------------------------------------------------------------
-- H-4 — the re-key, as written in the migration file, run on planted rows.
-- Each case puts the previous key function back, plants rows keyed by it,
-- runs the migration's own lines, and is undone afterwards.
-- ---------------------------------------------------------------------------
do $h4$
declare
  v_rekey text := (select sql from t3802h_src where k = 'rekey');
  v_old   text := replace((select sql from t3802h_src where k = 'oldkey'), 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
  v_got text;
  v_keys text;
  v_notes jsonb := '[]'::jsonb;
begin
  perform pg_temp.t3802h_check('H-4', 'the re-key lines were read from the migration file',
    (v_rekey like '-- issue-3802-pr3 rekey: begin%' and v_rekey like '%LOCK TABLE public.crm_records IN SHARE ROW EXCLUSIVE MODE;%'
      and v_rekey like '%UPDATE public.crm_records SET name = normalize(name, NFC);%' and length(v_rekey) > 1500)::text, 'true');
  perform pg_temp.t3802h_check('H-4', 'the previous key function was read from its migration file',
    (v_old like 'CREATE OR REPLACE FUNCTION public.crm_name_key(p_name text)%' and v_old not like '%NFKC%')::text, 'true');
  if v_rekey is null or v_old is null or v_rekey not like '%UPDATE public.crm_records%' then
    return;
  end if;

  -- Case 1: rows that do not collide are re-keyed and normalised.
  begin
    execute v_old;
    insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, updated_at) values
      ('38020000-0000-4000-d400-000000000001', 'hosts', U&'\FF28\FF14 \FF33\FF4F\FF4C\FF4F', 'prospect', 'issue3802h-plant', 'issue3802h-plant', '2026-01-02 03:04:05+00'),
      ('38020000-0000-4000-d400-000000000002', 'hosts', U&'H4 Cafe\0301 Solo',              'prospect', 'issue3802h-plant', 'issue3802h-plant', '2026-01-02 03:04:05+00'),
      ('38020000-0000-4000-d400-000000000003', 'creators', 'H4 Plain Solo',                 'identified', 'issue3802h-plant', 'issue3802h-plant', '2026-01-02 03:04:05+00');
    insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, updated_at, deleted_at, deleted_by) values
      ('38020000-0000-4000-d400-000000000004', 'hosts', U&'\FF28\FF14 \FF27\FF4F\FF4E\FF45', 'prospect', 'issue3802h-plant', 'issue3802h-plant', '2026-01-02 03:04:05+00', now(), 'issue3802h-plant');
    select string_agg(name_key, '|' order by id) into v_keys from public.crm_records where created_by = 'issue3802h-plant';
    v_notes := v_notes || pg_temp.t3802h_note('planted under the previous rule, the keys are the previous ones',
      v_keys, U&'\FF48\FF14\FF53\FF4F\FF4C\FF4F' || '|h4cafesolo|h4plainsolo|' || U&'\FF48\FF14\FF47\FF4F\FF4E\FF45');
    execute v_rekey;
    v_notes := v_notes || pg_temp.t3802h_note('after the re-key every planted key is the new one, a deleted row included',
      (select string_agg(name_key, '|' order by id) from public.crm_records where created_by = 'issue3802h-plant'),
      'h4solo|h4caf' || U&'\00E9' || 'solo|h4plainsolo|h4gone');
    v_notes := v_notes || pg_temp.t3802h_note('no stored key anywhere differs from the function''s answer',
      (select count(*)::text from public.crm_records where name_key is distinct from public.crm_name_key(name)), '0');
    v_notes := v_notes || pg_temp.t3802h_note('the decomposed name was rewritten in NFC form',
      (select encode(convert_to(name, 'UTF8'), 'hex') from public.crm_records where id = '38020000-0000-4000-d400-000000000002'),
      encode(convert_to(U&'H4 Caf\00E9 Solo', 'UTF8'), 'hex'));
    v_notes := v_notes || pg_temp.t3802h_note('who changed a record last, and when, were left alone',
      (select count(distinct updated_at)::text || '/' || min(updated_by) || '/' || min(updated_at)::date::text
         from public.crm_records where created_by = 'issue3802h-plant'), '1/issue3802h-plant/2026-01-02');
    v_notes := v_notes || pg_temp.t3802h_note('the name rule is back on the table',
      (select count(*)::text from pg_constraint where conrelid = 'public.crm_records'::regclass and conname = 'crm_records_name_check' and convalidated), '1');
    raise exception 'issue3802h_undo';
  exception when others then
    if sqlerrm <> 'issue3802h_undo' then
      v_notes := v_notes || pg_temp.t3802h_note('case 1 ran without an unexpected error', sqlstate || ': ' || sqlerrm, 'no error');
    end if;
  end;

  -- Case 2: two live rows that would share a key abort the re-key.
  begin
    execute v_old;
    insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
      ('38020000-0000-4000-d400-000000000011', 'hosts', U&'\FF28\FF14 \FF34\FF57\FF49\FF4E', 'prospect', 'issue3802h-plant', 'issue3802h-plant'),
      ('38020000-0000-4000-d400-000000000012', 'hosts', 'H4 Twin', 'prospect', 'issue3802h-plant', 'issue3802h-plant');
    select string_agg(name_key, '|' order by id) into v_keys from public.crm_records where created_by = 'issue3802h-plant';
    begin
      execute v_rekey;
      v_got := 'the re-key went through';
    exception when others then
      v_got := sqlerrm;
    end;
    v_notes := v_notes || pg_temp.t3802h_note('two records that would share a key stop the re-key with a count', v_got,
      'issue 3802 pr3 pre-flight: 0 record name(s) have nothing visible under the new rule and 1 name key(s) are shared by more than one record;%', true);
    v_notes := v_notes || pg_temp.t3802h_note('the message names no record', (v_got not ilike '%twin%')::text, 'true');
    v_notes := v_notes || pg_temp.t3802h_note('and nothing was changed: keys, the key function and the name rule are as they were',
      (select string_agg(name_key, '|' order by id) from public.crm_records where created_by = 'issue3802h-plant')
        || '/' || (select (prosrc not like '%NFKC%')::text from pg_proc where oid = 'public.crm_name_key(text)'::regprocedure)
        || '/' || (select count(*)::text from pg_constraint where conrelid = 'public.crm_records'::regclass and conname = 'crm_records_name_check'),
      v_keys || '/true/1');
    raise exception 'issue3802h_undo';
  exception when others then
    if sqlerrm <> 'issue3802h_undo' then
      v_notes := v_notes || pg_temp.t3802h_note('case 2 ran without an unexpected error', sqlstate || ': ' || sqlerrm, 'no error');
    end if;
  end;

  -- Case 3: a name with nothing visible under the new rule aborts it too.
  begin
    execute v_old;
    insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, deleted_at, deleted_by) values
      ('38020000-0000-4000-d400-000000000021', 'creators', U&'\2800\2800', 'identified', 'issue3802h-plant', 'issue3802h-plant', now(), 'issue3802h-plant');
    begin
      execute v_rekey;
      v_got := 'the re-key went through';
    exception when others then
      v_got := sqlerrm;
    end;
    v_notes := v_notes || pg_temp.t3802h_note('a name with nothing visible stops the re-key with a count, deleted or not', v_got,
      'issue 3802 pr3 pre-flight: 1 record name(s) have nothing visible under the new rule and 0 name key(s)%', true);
    raise exception 'issue3802h_undo';
  exception when others then
    if sqlerrm <> 'issue3802h_undo' then
      v_notes := v_notes || pg_temp.t3802h_note('case 3 ran without an unexpected error', sqlstate || ': ' || sqlerrm, 'no error');
    end if;
  end;

  perform pg_temp.t3802h_record('H-4', v_notes);
  perform pg_temp.t3802h_check('H-4', 'every case was undone: the key function is the new one and no planted row is left',
    (select (prosrc like '%NFKC%')::text from pg_proc where oid = 'public.crm_name_key(text)'::regprocedure)
      || '/' || (select count(*)::text from public.crm_records where created_by = 'issue3802h-plant'), 'true/0');
end;
$h4$;

-- ---------------------------------------------------------------------------
-- H-5 — a stuck host is reported once a day, not on every run.
-- ---------------------------------------------------------------------------
create function pg_temp.t3802h_fault() returns trigger
language plpgsql as $fn$
begin
  if new.stage = 'live' and new.name = any (string_to_array(current_setting('t3802h.fault_names', true), '|')) then
    raise exception 'issue3802h planted fault' using errcode = '55000';
  end if;
  return new;
end;
$fn$;

create function pg_temp.t3802h_failed(p_scope text) returns text
language sql as $fn$
  select count(*)::text from public.admin_audit_log
   where action = 'crm.reconcile_failed' and metadata->>'scope' = p_scope
$fn$;

do $h5$
declare
  v_one text;
  v_audit int;
begin
  create trigger t3802h_fault before insert or update on public.crm_records
    for each row execute function pg_temp.t3802h_fault();
  perform set_config('t3802h.fault_names', 'H5 Stuck One|H5 Stuck Two', true);

  -- Linked while the brands have no listing yet, so nothing is promoted now.
  v_one := pg_temp.t3802h_get(pg_temp.t3802h_make('h5a', 'growth', 'hosts', '{"name": "H5 Stuck One", "brand_id": "38020000-0000-4000-d100-000000000001"}'), 'record', 'id');
  perform pg_temp.t3802h_make('h5b', 'growth', 'hosts', '{"name": "H5 Stuck Two", "brand_id": "38020000-0000-4000-d100-000000000002"}');
  perform pg_temp.t3802h_make('h5c', 'growth', 'hosts', '{"name": "H5 Fine", "brand_id": "38020000-0000-4000-d100-000000000003"}');
  perform pg_temp.t3802h_check('H-5', 'nothing has been reported before the first run',
    pg_temp.t3802h_failed('scheduled') || '/' || pg_temp.t3802h_failed('record'), '0/0');

  -- Brand One and Brand Three get a public listing: one host is stuck, one is fine.
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status) values
    ('38020000-0000-4000-d420-000000000001', '38020000-0000-4000-d100-000000000001', 'Issue3802h night one',   'issue3802h-night-one',   'public', 'scheduled'),
    ('38020000-0000-4000-d420-000000000003', '38020000-0000-4000-d100-000000000003', 'Issue3802h night three', 'issue3802h-night-three', 'public', 'scheduled');
  set local session_replication_role = origin;

  v_audit := pg_temp.t3802h_audit();
  perform pg_temp.t3802h_check('H-5', 'the first scheduled run promotes the host it can',
    pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$), '1');
  perform pg_temp.t3802h_check('H-5', 'and reports the stuck host once', pg_temp.t3802h_failed('scheduled'), '1');
  perform pg_temp.t3802h_check('H-5', 'the row says how many, which kind of run, and a fingerprint; nothing else',
    (select (select string_agg(k, ',' order by k) from jsonb_object_keys(l.metadata) k) || ' | ' || (l.metadata->>'failed') || '/' || (l.metadata->>'promoted')
            || ' | ' || ((l.metadata->>'fingerprint') ~ '^[0-9a-f]{32}$')::text || ' | ' || l.admin_email || '/' || l.target_type || '/' || l.target_id
       from public.admin_audit_log l where l.action = 'crm.reconcile_failed'),
    'failed,fingerprint,promoted,scope | 1/1 | true | system/crm_pipeline/hosts');
  perform pg_temp.t3802h_check('H-5', 'the row carries no host id, name or error text',
    (select count(*)::text from public.admin_audit_log l
      where l.action = 'crm.reconcile_failed' and (l.metadata::text ilike '%' || v_one || '%' or l.metadata::text ~* 'stuck|planted|fault|55000')), '0');

  -- The same host fails again and again: no new row.
  perform pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802h_check('H-5', 'two more scheduled runs with the same stuck host add no row',
    pg_temp.t3802h_failed('scheduled') || '/' || (pg_temp.t3802h_audit() - v_audit)::text, '1/2');
  perform pg_temp.t3802h_check('H-5', 'the stuck host is still where it was, with its link',
    (select stage || '/' || (brand_id is not null)::text from public.crm_records where id = v_one::uuid), 'onboarded/true');

  -- A run for the one host reports every time.
  perform pg_temp.t3802h_check('H-5', 'a run for the one host promotes nothing and still answers',
    pg_temp.t3802h_as('postgres', format($q$select public.crm_reconcile_live(%L)::text$q$, v_one)), '0');
  perform pg_temp.t3802h_as('postgres', format($q$select public.crm_reconcile_live(%L)::text$q$, v_one));
  perform pg_temp.t3802h_check('H-5', 'each run for the one host is reported', pg_temp.t3802h_failed('record'), '2');
  perform pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802h_check('H-5', 'those rows do not count as the scheduled report: still one',
    pg_temp.t3802h_failed('scheduled'), '1');

  -- A day later the same stuck host is reported again, once.
  set local session_replication_role = replica;
  update public.admin_audit_log set created_at = created_at - interval '24 hours 1 minute'
   where action = 'crm.reconcile_failed';
  set local session_replication_role = origin;
  perform pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802h_check('H-5', 'after 24 hours the same stuck host is reported again', pg_temp.t3802h_failed('scheduled'), '2');
  perform pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802h_check('H-5', 'and only once', pg_temp.t3802h_failed('scheduled'), '2');

  -- The set of stuck hosts changes: reported at once.
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status) values
    ('38020000-0000-4000-d420-000000000002', '38020000-0000-4000-d100-000000000002', 'Issue3802h night two', 'issue3802h-night-two', 'public', 'scheduled');
  set local session_replication_role = origin;
  perform pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802h_check('H-5', 'a second stuck host changes the set and is reported at once',
    pg_temp.t3802h_failed('scheduled') || '/' || (select max(metadata->>'failed') from public.admin_audit_log
      where action = 'crm.reconcile_failed' and metadata->>'scope' = 'scheduled' and created_at > now() - interval '1 hour'), '3/2');
  perform pg_temp.t3802h_check('H-5', 'the two sets have different fingerprints',
    (select count(distinct metadata->>'fingerprint')::text from public.admin_audit_log
      where action = 'crm.reconcile_failed' and metadata->>'scope' = 'scheduled'), '2');
  perform pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$);
  perform pg_temp.t3802h_check('H-5', 'and the new set is then reported once too', pg_temp.t3802h_failed('scheduled'), '3');

  -- The fault goes away: both are promoted, and a clean run reports nothing.
  perform set_config('t3802h.fault_names', '', true);
  perform pg_temp.t3802h_check('H-5', 'once the fault is gone both hosts are promoted',
    pg_temp.t3802h_as('postgres', $q$select public.crm_reconcile_live()::text$q$), '2');
  perform pg_temp.t3802h_check('H-5', 'a clean run adds no report', pg_temp.t3802h_failed('scheduled'), '3');
  drop trigger t3802h_fault on public.crm_records;
end;
$h5$;

-- ---------------------------------------------------------------------------
-- H-6 — the two summaries: callers, and every number against a direct count.
-- ---------------------------------------------------------------------------
do $h6$
declare
  c_today constant date := (now() at time zone 'utc')::date;
  v_who text;
  r text;
  j jsonb;
  v_direct jsonb;
begin
  -- What is due, for whom.
  perform pg_temp.t3802h_make('h6over',  'growth',  'hosts', jsonb_build_object('name', 'H6 Overdue Host',  'due_on', c_today - 3, 'next_action', 'Call back'));
  perform pg_temp.t3802h_make('h6today', 'growth',  'hosts', jsonb_build_object('name', 'H6 Today Host',    'due_on', c_today));
  perform pg_temp.t3802h_make('h6later', 'growth',  'hosts', jsonb_build_object('name', 'H6 Later Host',    'due_on', c_today + 4));
  perform pg_temp.t3802h_make('h6lost',  'growth',  'hosts', jsonb_build_object('name', 'H6 Lost Host',     'due_on', c_today - 9));
  perform pg_temp.t3802h_move('growth', 'h6lost', 'lost', 'Closed', 'prospect');
  perform pg_temp.t3802h_make('h6gone',  'growth',  'hosts', jsonb_build_object('name', 'H6 Deleted Host',  'due_on', c_today - 1));
  perform pg_temp.t3802h_as('owner', format($q$select public.crm_record_delete(%L)::text$q$, pg_temp.t3802h_id('h6gone')));
  perform pg_temp.t3802h_make('h6other', 'growth2', 'hosts', jsonb_build_object('name', 'H6 Other Owner',   'due_on', c_today - 1));
  perform pg_temp.t3802h_make('h6cre',   'growth',  'creators', jsonb_build_object('name', 'H6 Today Creator', 'due_on', c_today));
  perform pg_temp.t3802h_make('h6none',  'growth',  'hosts', jsonb_build_object('name', 'H6 Unowned Overdue', 'due_on', c_today - 2, 'owners', '[]'::jsonb));
  perform pg_temp.t3802h_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "touch", "channel": "email", "direction": "outbound"}'::jsonb, 'h6-touch-0001')::text$q$, pg_temp.t3802h_id('h6over')));
  perform pg_temp.t3802h_as('growth', format($q$select public.crm_record_log(%L, '{"kind": "note", "body": "Left a message"}'::jsonb, 'h6-note-0001')::text$q$, pg_temp.t3802h_id('h6over')));
  -- Someone who is no longer on the team logged a touch this week.
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction)
  values (pg_temp.t3802h_id('h6over')::uuid, 'touch', 'issue3802h-former@test.local', 'phone', 'outbound');

  -- Who may call the home summary.
  foreach v_who in array array['owner', 'admin', 'growth', 'partner'] loop
    perform pg_temp.t3802h_check('H-6', v_who || ' gets the home summary, with their own role',
      pg_temp.t3802h_get(pg_temp.t3802h_as(v_who, $q$select public.crm_home_summary()::text$q$), 'me', 'role'),
      case v_who when 'owner' then 'owner' when 'admin' then 'admin' when 'growth' then 'growth' else 'partner' end);
  end loop;
  foreach v_who in array array['invited', 'revoked', 'consumer', 'service'] loop
    perform pg_temp.t3802h_like('H-6', v_who || ' is refused the home summary',
      pg_temp.t3802h_as(v_who, $q$select public.crm_home_summary()::text$q$), 'ERR:42501:forbidden: Your account cannot use Hosts and Creators.%');
    perform pg_temp.t3802h_like('H-6', v_who || ' is refused the team dashboard',
      pg_temp.t3802h_as(v_who, $q$select public.crm_team_summary()::text$q$), 'ERR:42501:forbidden:%');
  end loop;
  perform pg_temp.t3802h_like('H-6', 'anon cannot call the home summary',
    pg_temp.t3802h_as('anon', $q$select public.crm_home_summary()::text$q$), 'ERR:42501:permission denied for function %');
  perform pg_temp.t3802h_like('H-6', 'anon cannot call the team dashboard',
    pg_temp.t3802h_as('anon', $q$select public.crm_team_summary()::text$q$), 'ERR:42501:permission denied for function %');
  foreach v_who in array array['growth', 'partner', 'growth2'] loop
    perform pg_temp.t3802h_check('H-6', v_who || ' is refused the team dashboard in plain words',
      pg_temp.t3802h_as(v_who, $q$select public.crm_team_summary()::text$q$),
      'ERR:42501:forbidden: Only an owner or admin can open the team dashboard.');
  end loop;

  -- The home summary for a Sales and marketing person.
  r := pg_temp.t3802h_as('growth', format($q$select public.crm_home_summary(%L)::text$q$, c_today));
  j := pg_temp.t3802h_jb(r);
  perform pg_temp.t3802h_check('H-6', 'the answer has exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k),
    'beta_leads_new,can_set_targets,due,me,month_start,stages,targets,today');
  perform pg_temp.t3802h_check('H-6', 'who it is for, today and the month',
    (j->'me'->>'email') || '/' || (j->'me'->>'display_name') || '/' || (j->>'today') || '/' || (j->>'month_start') || '/' || (j->>'can_set_targets'),
    'issue3802h-growth@test.local/Issue3802h/' || c_today::text || '/' || date_trunc('month', c_today::timestamp)::date::text || '/false');
  select jsonb_object_agg(p.pipe, (
           select jsonb_agg(jsonb_build_object('id', s.def->>'id', 'label', s.def->>'label',
                    'count', (select count(*) from public.crm_records x where x.pipeline = p.pipe and x.deleted_at is null and x.stage = s.def->>'id')) order by s.ord)
             from jsonb_array_elements(public.crm_pipeline_def(p.pipe)->'stages') with ordinality s(def, ord)))
    into v_direct from unnest(array['hosts', 'creators']) p(pipe);
  perform pg_temp.t3802h_check('H-6', 'stage counts equal a direct count of the table, every stage of both pipelines in order',
    (j->'stages')::text, v_direct::text);
  perform pg_temp.t3802h_check('H-6', 'the stage counts add up to every record that is not deleted',
    (select sum((e->>'count')::int)::text from jsonb_array_elements((j->'stages'->'hosts') || (j->'stages'->'creators')) e),
    (select count(*)::text from public.crm_records where deleted_at is null));
  perform pg_temp.t3802h_check('H-6', 'my hosts: one overdue, one today; lost, deleted, later and other people''s are left out',
    (j #>> '{due,mine,hosts,overdue}') || '/' || (j #>> '{due,mine,hosts,today}') || '/' || (j #>> '{due,mine,hosts,truncated}')
      || '/' || (select string_agg(e->>'name', ',' order by o) from jsonb_array_elements(j #> '{due,mine,hosts,rows}') with ordinality x(e, o)),
    '1/1/false/H6 Overdue Host,H6 Today Host');
  perform pg_temp.t3802h_check('H-6', 'my creators: one today',
    (j #>> '{due,mine,creators,overdue}') || '/' || (j #>> '{due,mine,creators,today}') || '/' || (j #>> '{due,mine,creators,rows,0,name}'),
    '0/1/H6 Today Creator');
  perform pg_temp.t3802h_check('H-6', 'a due row carries exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(j #> '{due,mine,hosts,rows,0}') k),
    'due_on,icp,id,name,next_action,owners,pipeline,region_id,stage');
  perform pg_temp.t3802h_check('H-6', 'the team''s numbers are counts only, and equal a direct count',
    (j #>> '{due,team,hosts,overdue}') || '/' || (j #>> '{due,team,hosts,today}') || '/' || jsonb_array_length(j #> '{due,team,hosts,rows}')::text,
    (select count(*) filter (where due_on < c_today)::text || '/' || count(*) filter (where due_on = c_today)::text || '/0'
       from public.crm_records where pipeline = 'hosts' and deleted_at is null and due_on <= c_today and stage <> 'lost'));
  perform pg_temp.t3802h_check('H-6', 'new beta leads equals a direct count',
    j->>'beta_leads_new',
    (select count(*)::text from public.beta_access_leads l where not exists (
       select 1 from public.crm_records x where x.pipeline = 'hosts' and x.deleted_at is null
          and (x.beta_lead_id = l.id or x.name_key = public.crm_name_key(l.brand_name)))));

  -- Whose "today" it is.
  perform pg_temp.t3802h_check('H-6', 'a day one ahead of the server is the viewer''s today',
    pg_temp.t3802h_get(pg_temp.t3802h_as('growth', format($q$select public.crm_home_summary(%L)::text$q$, c_today + 1)), 'today'), (c_today + 1)::text);
  perform pg_temp.t3802h_check('H-6', 'a day one behind the server is the viewer''s today',
    pg_temp.t3802h_get(pg_temp.t3802h_as('growth', format($q$select public.crm_home_summary(%L)::text$q$, c_today - 1)), 'today'), (c_today - 1)::text);
  perform pg_temp.t3802h_check('H-6', 'a day further off is not trusted: the server''s day is used',
    pg_temp.t3802h_get(pg_temp.t3802h_as('growth', format($q$select public.crm_home_summary(%L)::text$q$, c_today + 40)), 'today')
      || '/' || pg_temp.t3802h_get(pg_temp.t3802h_as('growth', $q$select public.crm_home_summary('1999-01-01')::text$q$), 'today')
      || '/' || pg_temp.t3802h_get(pg_temp.t3802h_as('growth', $q$select public.crm_home_summary(null)::text$q$), 'today'),
    c_today::text || '/' || c_today::text || '/' || c_today::text);
  perform pg_temp.t3802h_check('H-6', 'an owner may set targets; a founding partner may not',
    pg_temp.t3802h_get(pg_temp.t3802h_as('owner', $q$select public.crm_home_summary()::text$q$), 'can_set_targets')
      || '/' || pg_temp.t3802h_get(pg_temp.t3802h_as('admin', $q$select public.crm_home_summary()::text$q$), 'can_set_targets')
      || '/' || pg_temp.t3802h_get(pg_temp.t3802h_as('partner', $q$select public.crm_home_summary()::text$q$), 'can_set_targets'), 'true/true/false');
  perform pg_temp.t3802h_check('H-6', 'a founding partner sees the same team numbers and none of their own (they own nothing)',
    (pg_temp.t3802h_jb(pg_temp.t3802h_as('partner', format($q$select public.crm_home_summary(%L)::text$q$, c_today))) #> '{due,team}')::text
      || '/' || (pg_temp.t3802h_jb(pg_temp.t3802h_as('partner', format($q$select public.crm_home_summary(%L)::text$q$, c_today))) #>> '{due,mine,hosts,overdue}'),
    (j #> '{due,team}')::text || '/0');

  -- The team dashboard.
  r := pg_temp.t3802h_as('admin', format($q$select public.crm_team_summary(%L)::text$q$, c_today));
  j := pg_temp.t3802h_jb(r);
  perform pg_temp.t3802h_check('H-6', 'the team answer has exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k),
    'beta_leads_new,by_person,due,me,month_start,stages,targets,today,week_start');
  perform pg_temp.t3802h_check('H-6', 'the week starts on Monday 00:00 UTC',
    ((j->>'week_start')::timestamptz = date_trunc('week', now() at time zone 'utc') at time zone 'utc')::text
      || '/' || extract(isodow from (j->>'week_start')::timestamptz at time zone 'utc')::text, 'true/1');
  perform pg_temp.t3802h_check('H-6', 'the team stage counts equal the direct count', (j->'stages')::text, v_direct::text);
  perform pg_temp.t3802h_check('H-6', 'everything due across the team, with rows, equals a direct count',
    (j #>> '{due,hosts,overdue}') || '/' || (j #>> '{due,hosts,today}') || '/' || jsonb_array_length(j #> '{due,hosts,rows}')::text
      || '/' || (j #>> '{due,creators,today}') || '/' || (j #>> '{due,hosts,truncated}'),
    (select count(*) filter (where due_on < c_today)::text || '/' || count(*) filter (where due_on = c_today)::text || '/' || count(*)::text
       from public.crm_records where pipeline = 'hosts' and deleted_at is null and due_on <= c_today and stage <> 'lost')
      || '/' || (select count(*)::text from public.crm_records where pipeline = 'creators' and deleted_at is null and due_on = c_today and stage <> 'passed')
      || '/false');
  perform pg_temp.t3802h_check('H-6', 'the due rows are oldest first, and include a card nobody owns',
    (j #>> '{due,hosts,rows,0,due_on}') || '/' || (select count(*)::text from jsonb_array_elements(j #> '{due,hosts,rows}') e where e->>'name' = 'H6 Unowned Overdue'),
    (select min(due_on)::text from public.crm_records where pipeline = 'hosts' and deleted_at is null and stage <> 'lost') || '/1');
  perform pg_temp.t3802h_check('H-6', 'every teammate is listed, the owner first, then anyone else who logged something',
    (select string_agg(e->>'email', ',' order by o) from jsonb_array_elements(j->'by_person') with ordinality x(e, o) where e->>'email' like 'issue3802h-%'),
    'issue3802h-owner@test.local,issue3802h-admin@test.local,issue3802h-growth@test.local,issue3802h-growth2@test.local,issue3802h-invited@test.local,issue3802h-partner@test.local,issue3802h-former@test.local');
  perform pg_temp.t3802h_check('H-6', 'someone no longer on the team is marked, with no role',
    (select (e->>'role') is null from jsonb_array_elements(j->'by_person') e where e->>'email' = 'issue3802h-former@test.local')::text
      || '/' || (select e->>'status' || '/' || (e->>'touches') from jsonb_array_elements(j->'by_person') e where e->>'email' = 'issue3802h-former@test.local'),
    'true/former/1');
  perform pg_temp.t3802h_check('H-6', 'one person''s week equals a direct count of the log',
    (select (e->>'touches') || '/' || (e->>'stage_moves') || '/' || (e->>'added') || '/' || (e->>'overdue') || '/' || (e->>'due_today')
       from jsonb_array_elements(j->'by_person') e where e->>'email' = 'issue3802h-growth@test.local'),
    (select count(*) filter (where kind = 'touch')::text || '/' || count(*) filter (where kind = 'stage_move')::text || '/' || count(*) filter (where kind = 'created')::text
       from public.crm_activity where actor_email = 'issue3802h-growth@test.local'
        and created_at >= date_trunc('week', now() at time zone 'utc') at time zone 'utc')
      || '/' || (select count(*) filter (where x.due_on < c_today)::text || '/' || count(*) filter (where x.due_on = c_today)::text
                   from public.crm_records x join public.crm_record_owners o on o.record_id = x.id and o.owner_email = 'issue3802h-growth@test.local'
                  where x.deleted_at is null and x.stage not in ('lost', 'passed')));
  perform pg_temp.t3802h_check('H-6', 'the system is not a person',
    (select count(*)::text from jsonb_array_elements(j->'by_person') e where e->>'email' is null or e->>'email' = 'system'), '0');
  perform pg_temp.t3802h_check('H-6', 'reading either summary writes nothing',
    (select count(*)::text from public.admin_audit_log where action like 'crm.%summary%'), '0');
end;
$h6$;

-- ---------------------------------------------------------------------------
-- H-7 — targets.
-- ---------------------------------------------------------------------------
do $h7$
declare
  c_lagos constant text := '38020000-0000-4000-d200-000000000001';
  c_durham constant text := '38020000-0000-4000-d200-000000000002';
  v_who text;
  r text;
  v_audit int;
  v_snap text;
  v_gone uuid := gen_random_uuid();
begin
  foreach v_who in array array['growth', 'partner', 'growth2'] loop
    perform pg_temp.t3802h_check('H-7', v_who || ' cannot set a target',
      pg_temp.t3802h_as(v_who, format($q$select public.crm_target_set(%L, 'event_organizer', 12)::text$q$, c_lagos)),
      'ERR:42501:forbidden: Only an owner or admin can set targets.');
  end loop;
  foreach v_who in array array['invited', 'revoked', 'consumer', 'service'] loop
    perform pg_temp.t3802h_like('H-7', v_who || ' cannot set a target',
      pg_temp.t3802h_as(v_who, format($q$select public.crm_target_set(%L, 'event_organizer', 12)::text$q$, c_lagos)), 'ERR:42501:forbidden:%');
  end loop;
  perform pg_temp.t3802h_like('H-7', 'anon cannot call it at all',
    pg_temp.t3802h_as('anon', format($q$select public.crm_target_set(%L, 'event_organizer', 12)::text$q$, c_lagos)), 'ERR:42501:permission denied for function %');

  v_snap := pg_temp.t3802h_snapshot();
  v_audit := pg_temp.t3802h_audit();
  perform pg_temp.t3802h_like('H-7', 'a region that is not a Launch City is refused',
    pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'event_organizer', 12)::text$q$, gen_random_uuid())), 'ERR:22023:invalid_region:%');
  perform pg_temp.t3802h_like('H-7', 'no region is refused',
    pg_temp.t3802h_as('owner', $q$select public.crm_target_set(null, 'event_organizer', 12)::text$q$), 'ERR:22023:invalid_region:%');
  perform pg_temp.t3802h_like('H-7', 'a creator ICP is not a host ICP',
    pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'ambassador', 12)::text$q$, c_lagos)), 'ERR:22023:invalid_icp: ambassador is not an ICP for hosts. Use one of:%');
  foreach r in array array['0', '-3', '1001', '2147483647'] loop
    perform pg_temp.t3802h_check('H-7', 'a target of ' || r || ' is refused in plain words',
      pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'event_organizer', %s)::text$q$, c_lagos, r)),
      'ERR:22023:invalid_target: A monthly target is a whole number from 1 to 1000. Send nothing to remove the target.');
  end loop;
  perform pg_temp.t3802h_check('H-7', 'none of those refusals wrote anything',
    pg_temp.t3802h_snapshot() || '/' || (pg_temp.t3802h_audit() - v_audit)::text, v_snap || '/0');

  -- Set, repeat, change, remove, repeat.
  r := pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'event_organizer', 12)::text$q$, c_lagos));
  perform pg_temp.t3802h_check('H-7', 'an owner sets a target',
    pg_temp.t3802h_get(r, 'changed') || '/' || coalesce(pg_temp.t3802h_get(r, 'previous'), 'none') || '/' || pg_temp.t3802h_get(r, 'target', 'monthly_target')
      || '/' || pg_temp.t3802h_get(r, 'target', 'region_name') || '/' || pg_temp.t3802h_get(r, 'target', 'icp_label'),
    'true/none/12/Issue3802h Lagos/Event organizer');
  perform pg_temp.t3802h_check('H-7', 'one audit row, with the region, the ICP and the numbers',
    (pg_temp.t3802h_audit() - v_audit)::text || '/' || (select l.admin_email || '/' || l.target_type || '/' || (l.metadata->>'region_id') || '/' || (l.metadata->>'icp')
        || '/' || coalesce(l.metadata->>'before', 'none') || '/' || (l.metadata->>'after') from public.admin_audit_log l where l.action = 'crm.target_set'),
    '1/issue3802h-owner@test.local/crm_target/' || c_lagos || '/event_organizer/none/12');
  v_snap := pg_temp.t3802h_snapshot();
  r := pg_temp.t3802h_as('admin', format($q$select public.crm_target_set(%L, 'event_organizer', 12)::text$q$, c_lagos));
  perform pg_temp.t3802h_check('H-7', 'the same number again changes nothing and writes nothing',
    pg_temp.t3802h_get(r, 'changed') || '/' || pg_temp.t3802h_get(r, 'previous') || '/' || (pg_temp.t3802h_audit() - v_audit)::text || '/' || (pg_temp.t3802h_snapshot() = v_snap)::text,
    'false/12/1/true');
  r := pg_temp.t3802h_as('admin', format($q$select public.crm_target_set(%L, 'event_organizer', 15)::text$q$, c_lagos));
  perform pg_temp.t3802h_check('H-7', 'an admin changes it; the answer carries the number it was',
    pg_temp.t3802h_get(r, 'changed') || '/' || pg_temp.t3802h_get(r, 'previous') || '/' || pg_temp.t3802h_get(r, 'target', 'monthly_target') || '/' || (pg_temp.t3802h_audit() - v_audit)::text,
    'true/12/15/2');
  perform pg_temp.t3802h_check('H-7', 'still one row for that region and ICP, last changed by the admin',
    (select count(*)::text || '/' || max(updated_by) || '/' || max(created_by) from public.crm_targets where region_id = c_lagos::uuid and icp = 'event_organizer'),
    '1/issue3802h-admin@test.local/issue3802h-owner@test.local');
  r := pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'event_organizer', null)::text$q$, c_lagos));
  perform pg_temp.t3802h_check('H-7', 'sending no number removes it',
    pg_temp.t3802h_get(r, 'changed') || '/' || pg_temp.t3802h_get(r, 'previous') || '/' || coalesce(pg_temp.t3802h_get(r, 'target'), 'none')
      || '/' || (select count(*)::text from public.crm_targets) || '/' || (select count(*)::text from public.admin_audit_log where action = 'crm.target_remove' and metadata->>'before' = '15'),
    'true/15/none/0/1');
  r := pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'event_organizer', null)::text$q$, c_lagos));
  perform pg_temp.t3802h_check('H-7', 'removing it again changes nothing and writes nothing',
    pg_temp.t3802h_get(r, 'changed') || '/' || (pg_temp.t3802h_audit() - v_audit)::text, 'false/3');
  r := pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'event_organizer', 15)::text$q$, c_lagos));
  perform pg_temp.t3802h_check('H-7', 'the undo of a removal is the same call with the previous number',
    pg_temp.t3802h_get(r, 'changed') || '/' || pg_temp.t3802h_get(r, 'target', 'monthly_target'), 'true/15');
  perform pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'event_organizer', 2)::text$q$, c_lagos));
  perform pg_temp.t3802h_as('owner', format($q$select public.crm_target_set(%L, 'restaurant_bar', 4)::text$q$, c_durham));

  -- Progress. Three event organizers in Lagos: one reached Onboarded this
  -- month, one reached it last month, one reached it and was then lost.
  perform pg_temp.t3802h_make('h7a', 'growth', 'hosts', jsonb_build_object('name', 'H7 This Month', 'icp', 'event_organizer', 'region_id', c_lagos));
  perform pg_temp.t3802h_make('h7b', 'growth', 'hosts', jsonb_build_object('name', 'H7 Last Month', 'icp', 'event_organizer', 'region_id', c_lagos));
  perform pg_temp.t3802h_make('h7c', 'growth', 'hosts', jsonb_build_object('name', 'H7 Then Lost',  'icp', 'event_organizer', 'region_id', c_lagos));
  perform pg_temp.t3802h_make('h7d', 'growth', 'hosts', jsonb_build_object('name', 'H7 Still Early', 'icp', 'event_organizer', 'region_id', c_lagos));
  perform pg_temp.t3802h_make('h7e', 'growth', 'hosts', jsonb_build_object('name', 'H7 Other Region', 'icp', 'event_organizer', 'region_id', c_durham));
  perform pg_temp.t3802h_move('growth', 'h7a', 'onboarded', null, 'prospect');
  perform pg_temp.t3802h_move('growth', 'h7b', 'onboarded', null, 'prospect');
  perform pg_temp.t3802h_move('growth', 'h7c', 'onboarded', null, 'prospect');
  perform pg_temp.t3802h_move('growth', 'h7c', 'lost', 'Changed their mind', 'onboarded');
  perform pg_temp.t3802h_move('growth', 'h7e', 'onboarded', null, 'prospect');
  update public.crm_activity set created_at = date_trunc('month', now() at time zone 'utc') at time zone 'utc' - interval '1 second'
   where record_id = pg_temp.t3802h_id('h7b')::uuid and kind = 'stage_move';

  r := pg_temp.t3802h_as('partner', $q$select public.crm_home_summary()::text$q$);
  perform pg_temp.t3802h_check('H-7', 'everyone on the team reads the targets with their progress, by region then ICP',
    (select string_agg((e->>'region_name') || ':' || (e->>'icp') || ':' || (e->>'in_pipeline') || ':' || (e->>'done') || ':' || (e->>'monthly_target'), ' | ' order by o)
       from jsonb_array_elements(pg_temp.t3802h_jb(r)->'targets') with ordinality x(e, o)),
    'Issue3802h Durham:restaurant_bar:0:0:4 | Issue3802h Lagos:event_organizer:3:1:2');
  perform pg_temp.t3802h_check('H-7', 'a target row carries exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.t3802h_jb(r)->'targets'->0) k),
    'done,icp,icp_label,id,in_pipeline,monthly_target,region_id,region_name');
  perform pg_temp.t3802h_check('H-7', 'the team dashboard shows the same targets',
    (pg_temp.t3802h_jb(pg_temp.t3802h_as('owner', $q$select public.crm_team_summary()::text$q$))->'targets')::text,
    (pg_temp.t3802h_jb(r)->'targets')::text);

  -- A target whose city has since left the list is still shown, unnamed.
  insert into public.crm_targets (region_id, icp, monthly_target, created_by, updated_by) values (v_gone, 'partner_org', 3, 'issue3802h', 'issue3802h');
  perform pg_temp.t3802h_check('H-7', 'a target whose city is gone is listed last with no region name',
    (select (e->>'region_name') is null from jsonb_array_elements(pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_home_summary()::text$q$))->'targets') with ordinality x(e, o)
      order by o desc limit 1)::text, 'true');

  -- The table's own backstop.
  begin
    insert into public.crm_targets (region_id, icp, monthly_target, created_by, updated_by) values (gen_random_uuid(), 'ambassador', 3, 'x', 'x');
    r := 'accepted';
  exception when check_violation then
    r := 'refused by the table';
  end;
  perform pg_temp.t3802h_check('H-7', 'underneath, the table refuses an ICP that is not a host ICP', r, 'refused by the table');
  begin
    insert into public.crm_targets (region_id, icp, monthly_target, created_by, updated_by) values (c_lagos::uuid, 'event_organizer', 9, 'x', 'x');
    r := 'accepted';
  exception when unique_violation then
    r := 'refused by the table';
  end;
  perform pg_temp.t3802h_check('H-7', 'and a second row for the same region and ICP', r, 'refused by the table');
end;
$h7$;

-- ---------------------------------------------------------------------------
-- H-8 — the role-aware Beta leads reader.
-- ---------------------------------------------------------------------------
insert into public.beta_access_leads (id, created_at, brand_type, brand_name, contact_name, city, email, phone, consent, source, user_agent, referer, ip_hash) values
  ('38020000-0000-4000-d600-000000000001', now() - interval '1 minute',  array['restaurant'],                 'H8 Suya Spot',      'Ada Obi',   'issue3802h lagos',           'issue3802h-lead1@test.local', '+15550003802', true, 'organiser_marketing',      'issue3802h-agent-secret', 'https://issue3802h-referer-secret.test', 'issue3802h-iphash-secret'),
  ('38020000-0000-4000-d600-000000000002', now() - interval '2 minutes', array['cafe_bar', 'restaurant'],     'H8 Two Types',      'Bola',      'Issue3802h Lagos, Nigeria',  'issue3802h-lead2@test.local', null,           true, 'organiser_marketing_nav',  null, null, null),
  ('38020000-0000-4000-d600-000000000003', now() - interval '3 minutes', array['club_nightlife', 'restaurant'], 'H8 Mixed Types',  'Chidi',     'Atlantis',                   'issue3802h-lead3@test.local', null,           true, 'organiser_marketing',      null, null, null),
  ('38020000-0000-4000-d600-000000000004', now() - interval '4 minutes', array['other'],                      'H8 Other Type',     'Dayo',      'Issue3802h Twin',            'issue3802h-lead4@test.local', null,           true, 'organiser_marketing_hero', null, null, null);

do $h8$
declare
  v_who text;
  r text;
  j jsonb;
  l jsonb;
  v_notes jsonb := '[]'::jsonb;
begin
  foreach v_who in array array['owner', 'admin', 'growth', 'partner'] loop
    perform pg_temp.t3802h_check('H-8', v_who || ' reads beta leads',
      (select count(*)::text from jsonb_array_elements(pg_temp.t3802h_jb(pg_temp.t3802h_as(v_who, $q$select public.crm_beta_leads_list()::text$q$))->'leads') e
        where e->>'brand_name' like 'H8 %'), '4');
  end loop;
  foreach v_who in array array['invited', 'revoked', 'consumer', 'service'] loop
    perform pg_temp.t3802h_like('H-8', v_who || ' is refused beta leads',
      pg_temp.t3802h_as(v_who, $q$select public.crm_beta_leads_list()::text$q$), 'ERR:42501:forbidden:%');
  end loop;
  perform pg_temp.t3802h_like('H-8', 'anon cannot call the reader',
    pg_temp.t3802h_as('anon', $q$select public.crm_beta_leads_list()::text$q$), 'ERR:42501:permission denied for function %');

  r := pg_temp.t3802h_as('partner', $q$select public.crm_beta_leads_list()::text$q$);
  j := pg_temp.t3802h_jb(r);
  perform pg_temp.t3802h_check('H-8', 'the answer has exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k), 'leads,new_count,total,truncated');
  perform pg_temp.t3802h_check('H-8', 'totals equal a direct count; nothing is in Hosts yet',
    (j->>'total') || '/' || (j->>'new_count') || '/' || (j->>'truncated'),
    (select count(*)::text || '/' || count(*)::text || '/false' from public.beta_access_leads));
  select e into l from jsonb_array_elements(j->'leads') e where e->>'id' = '38020000-0000-4000-d600-000000000001';
  perform pg_temp.t3802h_check('H-8', 'a lead carries exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(l) k),
    'brand_name,brand_types,city,contact_name,created_at,email,host,id,source,suggested');
  perform pg_temp.t3802h_check('H-8', 'the suggestion carries exactly the named keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(l->'suggested') k),
    'icp,icp_label,icp_note,region_id,region_name,region_note');
  perform pg_temp.t3802h_check('H-8', 'the contact name and email are there for the whole team',
    (l->>'contact_name') || '/' || (l->>'email') || '/' || (l->>'city') || '/' || (l->'brand_types')::text || '/' || (l->>'source'),
    'Ada Obi/issue3802h-lead1@test.local/issue3802h lagos/["restaurant"]/organiser_marketing');
  perform pg_temp.t3802h_check('H-8', 'the phone number, device, referrer and network fields never leave',
    (r !~* 'phone|user_agent|referer|ip_hash|consent')::text || '/' || (r not like '%+15550003802%')::text || '/' || (r !~* 'issue3802h-(agent|referer|iphash)-secret')::text,
    'true/true/true');
  perform pg_temp.t3802h_check('H-8', 'newest first',
    (select string_agg(e->>'brand_name', ',' order by o) from jsonb_array_elements(j->'leads') with ordinality x(e, o) where e->>'brand_name' like 'H8 %'),
    'H8 Suya Spot,H8 Two Types,H8 Mixed Types,H8 Other Type');
  perform pg_temp.t3802h_check('H-8', 'what Add to Hosts would carry over, per lead',
    (select string_agg(coalesce(e #>> '{suggested,icp}', '-') || ':' || (e #>> '{suggested,icp_note}') || ':' || coalesce(e #>> '{suggested,region_name}', '-') || ':' || (e #>> '{suggested,region_note}'), ' | ' order by o)
       from jsonb_array_elements(j->'leads') with ordinality x(e, o) where e->>'brand_name' like 'H8 %'),
    'restaurant_bar:set:Issue3802h Lagos:set | restaurant_bar:set:Issue3802h Lagos:set | -:several:-:not_launch_city | -:none:-:ambiguous');
  perform pg_temp.t3802h_check('H-8', 'no lead is a host yet',
    (select count(*)::text from jsonb_array_elements(j->'leads') e where e->>'brand_name' like 'H8 %' and jsonb_typeof(e->'host') <> 'null'), '0');

  -- A host with the same name, added by hand, shows as "already there".
  perform pg_temp.t3802h_make('h8same', 'growth', 'hosts', '{"name": "h8 other-type"}');
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_leads_list()::text$q$));
  perform pg_temp.t3802h_check('H-8', 'a host with the same name is shown, not linked, and the lead is no longer new',
    (select (e #>> '{host,id}') || '/' || (e #>> '{host,linked}') || '/' || (e #>> '{host,stage}') from jsonb_array_elements(j->'leads') e where e->>'brand_name' = 'H8 Other Type')
      || '/' || (j->>'new_count'),
    pg_temp.t3802h_id('h8same') || '/false/prospect/' || ((select count(*) from public.beta_access_leads) - 1)::text);

  -- The area decides, not the role name: a teammate who can use Hosts and
  -- Creators but does not hold the beta_leads area is refused by both beta
  -- functions and gets no beta lead count. (Every role holds the area today,
  -- so the map is changed here, inside a block that is undone.)
  begin
    create or replace function public.admin_team_role_areas(p_role text) returns text[]
    language sql immutable set search_path = '' as $f$
      select case p_role
        when 'owner'   then array['admin_console','team_manage','crm','beta_leads']
        when 'admin'   then array['admin_console','crm','beta_leads']
        when 'growth'  then array['role_home','crm','beta_leads']
        when 'partner' then array['role_home','crm']
        else array[]::text[]
      end
    $f$;
    v_notes := v_notes || pg_temp.t3802h_note('without the beta_leads area the reader refuses, in plain words',
      pg_temp.t3802h_as('partner', $q$select public.crm_beta_leads_list()::text$q$),
      'ERR:42501:forbidden: Your account cannot open Beta leads. Ask the owner to give you team access.');
    v_notes := v_notes || pg_temp.t3802h_note('without the beta_leads area Add to Hosts refuses, in plain words',
      pg_temp.t3802h_as('partner', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000002')::text$q$),
      'ERR:42501:forbidden: Your account cannot open Beta leads. Ask the owner to give you team access.');
    v_notes := v_notes || pg_temp.t3802h_note('and the home summary gives them no beta lead count, while the rest still works',
      coalesce(pg_temp.t3802h_get(pg_temp.t3802h_as('partner', $q$select public.crm_home_summary()::text$q$), 'beta_leads_new'), 'none')
        || '/' || pg_temp.t3802h_get(pg_temp.t3802h_as('partner', $q$select public.crm_home_summary()::text$q$), 'me', 'role'),
      'none/partner');
    v_notes := v_notes || pg_temp.t3802h_note('someone who still holds the area is unaffected',
      (pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_leads_list()::text$q$)) ? 'leads')::text, 'true');
    raise exception 'issue3802h_undo';
  exception when others then
    if sqlerrm <> 'issue3802h_undo' then
      v_notes := v_notes || pg_temp.t3802h_note('the area case ran without an unexpected error', sqlstate || ': ' || sqlerrm, 'no error');
    end if;
  end;
  perform pg_temp.t3802h_record('H-8', v_notes);
  perform pg_temp.t3802h_check('H-8', 'the area map is back as it was',
    array_to_string(public.admin_team_role_areas('partner'), ','), 'role_home,crm,beta_leads');

  -- The full-admin reader is untouched.
  perform pg_temp.t3802h_check('H-8', 'the full-admin reader still refuses the rest of the team',
    pg_temp.t3802h_as('growth', $q$select count(*)::text from public.admin_beta_leads_list()$q$) || ' | ' || pg_temp.t3802h_as('partner', $q$select count(*)::text from public.admin_beta_leads_list()$q$),
    'ERR:42501:forbidden | ERR:42501:forbidden');
  perform pg_temp.t3802h_check('H-8', 'and still answers an owner',
    pg_temp.t3802h_as('owner', $q$select count(*)::text from public.admin_beta_leads_list() where brand_name like 'H8 %'$q$), '4');
  perform pg_temp.t3802h_check('H-8', 'a direct read of the leads table still shows the team no row',
    pg_temp.t3802h_as('growth', $q$select count(*)::text from public.beta_access_leads$q$), '0');
end;
$h8$;

-- ---------------------------------------------------------------------------
-- H-9 — Add to Hosts.
-- ---------------------------------------------------------------------------
do $h9$
declare
  c record;
  r text;
  j jsonb;
  v_n int := 0;
  v_id uuid;
  v_snap text;
  v_audit int;
  v_first text;
begin
  -- Every type, and the pairs that do and do not give one answer.
  for c in
    select * from (values
      (array['restaurant'],                    'restaurant_bar',  'set',     'Restaurant'),
      (array['cafe_bar'],                      'restaurant_bar',  'set',     U&'Caf\00E9 / Bar'),
      (array['club_nightlife'],                'venue_gallery',   'set',     'Club / Nightlife'),
      (array['venue_space'],                   'venue_gallery',   'set',     'Venue / Space'),
      (array['event_organiser'],               'event_organizer', 'set',     'Event organiser'),
      (array['experience_tour'],               'trip_stay_host',  'set',     'Experience / Tour'),
      (array['other'],                         null,              'none',    'Other'),
      (array['restaurant', 'cafe_bar'],        'restaurant_bar',  'set',     U&'Caf\00E9 / Bar, Restaurant'),
      (array['club_nightlife', 'venue_space', 'other'], 'venue_gallery', 'set', 'Club / Nightlife, Other, Venue / Space'),
      (array['restaurant', 'event_organiser'], null,              'several', 'Event organiser, Restaurant'),
      (array['other', 'other'],                null,              'none',    'Other')
    ) as v(types, icp, note, labels)
  loop
    perform pg_temp.t3802h_check('H-9', 'type to ICP for ' || array_to_string(c.types, '+'),
      coalesce(public.crm_beta_icp(c.types)->>'icp', '-') || '|' || (public.crm_beta_icp(c.types)->>'note') || '|' || (public.crm_beta_icp(c.types)->>'labels'),
      coalesce(c.icp, '-') || '|' || c.note || '|' || c.labels);
  end loop;
  perform pg_temp.t3802h_check('H-9', 'no types at all is "none"', public.crm_beta_icp(null)->>'note' || '/' || (public.crm_beta_icp(array[]::text[])->>'note'), 'none/none');

  -- Every city case.
  for c in
    select * from (values
      ('issue3802h lagos',             '38020000-0000-4000-d200-000000000001', 'set'),
      ('ISSUE3802H  LAGOS ',           '38020000-0000-4000-d200-000000000001', 'set'),
      ('Issue3802h Lagos, Nigeria',    '38020000-0000-4000-d200-000000000001', 'set'),
      ('Issue3802h Durham',            '38020000-0000-4000-d200-000000000002', 'set'),
      ('Issue3802h Durham NC',         null,                                   'not_launch_city'),
      ('Atlantis',                     null,                                   'not_launch_city'),
      ('Issue3802h Twin',              null,                                   'ambiguous'),
      ('issue3802h twin, somewhere',   null,                                   'ambiguous'),
      ('',                             null,                                   'not_launch_city'),
      (', ,',                          null,                                   'not_launch_city')
    ) as v(city, region, note)
  loop
    perform pg_temp.t3802h_check('H-9', 'city to region for [' || c.city || ']',
      coalesce(public.crm_city_region(c.city)->>'region_id', '-') || '|' || (public.crm_city_region(c.city)->>'note'),
      coalesce(c.region, '-') || '|' || c.note);
  end loop;
  perform pg_temp.t3802h_check('H-9', 'no city at all is not a Launch City', public.crm_city_region(null)->>'note', 'not_launch_city');

  -- Who may add.
  foreach r in array array['invited', 'revoked', 'consumer', 'service'] loop
    perform pg_temp.t3802h_like('H-9', r || ' cannot add a lead to Hosts',
      pg_temp.t3802h_as(r, $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000001')::text$q$), 'ERR:42501:forbidden:%');
  end loop;
  perform pg_temp.t3802h_like('H-9', 'anon cannot call it at all',
    pg_temp.t3802h_as('anon', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000001')::text$q$), 'ERR:42501:permission denied for function %');
  perform pg_temp.t3802h_check('H-9', 'a lead that is not there is said so',
    pg_temp.t3802h_as('growth', format($q$select public.crm_beta_lead_to_host(%L)::text$q$, gen_random_uuid())), 'ERR:P0002:not_found: That beta lead is no longer here.');

  -- First press: one host, mapped, owned by the person who pressed.
  v_audit := pg_temp.t3802h_audit();
  r := pg_temp.t3802h_as('partner', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000001')::text$q$);
  j := pg_temp.t3802h_jb(r);
  v_first := j #>> '{record,id}';
  perform pg_temp.t3802h_check('H-9', 'the first press creates the host and says what was carried over',
    (j->>'status') || '/' || (j->>'icp_note') || '/' || (j->>'region_note') || '/' || (j->>'city'), 'created/set/set/issue3802h lagos');
  perform pg_temp.t3802h_check('H-9', 'the host: name, first stage, source Inbound, channel Email, mapped ICP and region, the presser as owner, the lead linked',
    (select x.name || '|' || x.stage || '|' || x.source || '|' || x.channel || '|' || x.icp || '|' || x.region_id || '|' || x.beta_lead_id || '|' || x.created_by
              || '|' || (select string_agg(o.owner_email, ',') from public.crm_record_owners o where o.record_id = x.id)
       from public.crm_records x where x.id = v_first::uuid),
    'H8 Suya Spot|prospect|inbound|email|restaurant_bar|38020000-0000-4000-d200-000000000001|38020000-0000-4000-d600-000000000001|issue3802h-partner@test.local|issue3802h-partner@test.local');
  perform pg_temp.t3802h_check('H-9', 'the contact is the email, then the name',
    (select contact from public.crm_records where id = v_first::uuid), 'issue3802h-lead1@test.local ' || chr(183) || ' Ada Obi');
  perform pg_temp.t3802h_check('H-9', 'the log says where it came from, in the presser''s name',
    (select string_agg(a.kind || ':' || coalesce(a.actor_email, 'system') || ':' || coalesce(a.body, ''), ' | ' order by a.kind)
       from public.crm_activity a where a.record_id = v_first::uuid),
    'created:issue3802h-partner@test.local:Added to the pipeline. | note:issue3802h-partner@test.local:Added from a beta lead. Type chosen: Restaurant. City as typed: issue3802h lagos.');
  perform pg_temp.t3802h_check('H-9', 'two audit rows for one conversion: the record and the lead',
    (pg_temp.t3802h_audit() - v_audit)::text || '/' || (select string_agg(l.action, ',' order by l.action) from public.admin_audit_log l where l.target_id = v_first and l.action like 'crm.%'),
    '2/crm.beta_lead_convert,crm.record_create');
  perform pg_temp.t3802h_check('H-9', 'the lead''s audit row carries the lead and the mapping, never a name or an address',
    (select (select string_agg(k, ',' order by k) from jsonb_object_keys(l.metadata) k) || ' | ' || (l.metadata::text !~* 'suya|ada obi|@test\.local')::text
       from public.admin_audit_log l where l.action = 'crm.beta_lead_convert' and l.target_id = v_first),
    'icp,icp_note,lead_id,region_id,region_note | true');

  -- Pressed again, by the same person and by someone else: nothing happens.
  v_snap := pg_temp.t3802h_snapshot();
  v_audit := pg_temp.t3802h_audit();
  foreach r in array array['partner', 'partner', 'growth', 'owner'] loop
    j := pg_temp.t3802h_jb(pg_temp.t3802h_as(r, $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000001')::text$q$));
    v_n := v_n + 1;
    perform pg_temp.t3802h_check('H-9', format('press %s, by %s, answers that it is already a host', v_n + 1, r),
      (j->>'status') || '/' || (j #>> '{record,id}'), 'exists/' || v_first);
  end loop;
  perform pg_temp.t3802h_check('H-9', 'none of those presses wrote anything; there is still one host for the lead',
    (pg_temp.t3802h_snapshot() = v_snap)::text || '/' || (pg_temp.t3802h_audit() - v_audit)::text
      || '/' || (select count(*)::text from public.crm_records where beta_lead_id = '38020000-0000-4000-d600-000000000001'), 'true/0/1');
  perform pg_temp.t3802h_check('H-9', 'the reader now shows that lead as a linked host',
    (select (e #>> '{host,id}') || '/' || (e #>> '{host,linked}') from jsonb_array_elements(pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_leads_list()::text$q$))->'leads') e
      where e->>'id' = '38020000-0000-4000-d600-000000000001'), v_first || '/true');

  -- Several types with one answer; a city with a country after the comma.
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000002')::text$q$));
  perform pg_temp.t3802h_check('H-9', 'two types that mean one ICP carry it over; the city before the comma is matched',
    (j->>'status') || '/' || (j #>> '{record,icp}') || '/' || (j #>> '{record,region_id}') || '/' || (j->>'icp_note') || '/' || (j->>'region_note'),
    'created/restaurant_bar/38020000-0000-4000-d200-000000000001/set/set');
  -- Types that disagree; a city that is not a Launch City.
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000003')::text$q$));
  perform pg_temp.t3802h_check('H-9', 'types that disagree leave the ICP empty; an unknown city leaves the region empty; neither is guessed',
    (j->>'status') || '/' || coalesce(j #>> '{record,icp}', 'none') || '/' || coalesce(j #>> '{record,region_id}', 'none') || '/' || (j->>'icp_note') || '/' || (j->>'region_note') || '/' || (j->>'city'),
    'created/none/none/several/not_launch_city/Atlantis');
  perform pg_temp.t3802h_like('H-9', 'the log keeps what they chose and typed, so a person can pick',
    (select a.body from public.crm_activity a where a.record_id = (j #>> '{record,id}')::uuid and a.kind = 'note'),
    'Added from a beta lead. Type chosen: Club / Nightlife, Restaurant. City as typed: Atlantis.');

  -- A host with the same name already exists (added by hand in H-8), with no lead: link it.
  v_audit := pg_temp.t3802h_audit();
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('growth2', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000004')::text$q$));
  perform pg_temp.t3802h_check('H-9', 'a same-name host with no lead is linked, not doubled',
    (j->>'status') || '/' || (j #>> '{record,id}') || '/' || (select count(*)::text from public.crm_records where name_key = 'h8othertype' and deleted_at is null)
      || '/' || (select beta_lead_id::text from public.crm_records where id = pg_temp.t3802h_id('h8same')::uuid),
    'linked/' || pg_temp.t3802h_id('h8same') || '/1/38020000-0000-4000-d600-000000000004');
  perform pg_temp.t3802h_check('H-9', 'the link is one audit row and one log line; the host keeps its owner and its name',
    (pg_temp.t3802h_audit() - v_audit)::text || '/' || (select count(*)::text from public.admin_audit_log where action = 'crm.beta_lead_link' and target_id = pg_temp.t3802h_id('h8same'))
      || '/' || (select count(*)::text from public.crm_activity where record_id = pg_temp.t3802h_id('h8same')::uuid and kind = 'note' and body like 'Linked to a beta lead.%')
      || '/' || (select name || '/' || (select string_agg(o.owner_email, ',') from public.crm_record_owners o where o.record_id = x.id) from public.crm_records x where x.id = pg_temp.t3802h_id('h8same')::uuid),
    '1/1/1/h8 other-type/issue3802h-growth@test.local');
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('partner', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000004')::text$q$));
  perform pg_temp.t3802h_check('H-9', 'pressed again, a linked lead answers that it is already a host', j->>'status', 'exists');

  -- A second lead with the same business name: the host already carries a lead.
  insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source) values
    ('38020000-0000-4000-d600-000000000005', array['restaurant'], 'H8  SUYA spot!', 'Efe', 'Issue3802h Durham', 'issue3802h-lead5@test.local', true, 'organiser_marketing');
  v_snap := pg_temp.t3802h_snapshot();
  v_audit := pg_temp.t3802h_audit();
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000005')::text$q$));
  perform pg_temp.t3802h_check('H-9', 'a second lead with the same business name is told the host exists; nothing is written',
    (j->>'status') || '/' || (j #>> '{record,id}') || '/' || (pg_temp.t3802h_snapshot() = v_snap)::text || '/' || (pg_temp.t3802h_audit() - v_audit)::text,
    'duplicate/' || v_first || '/true/0');

  -- A business name that cannot be a host name.
  insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source) values
    ('38020000-0000-4000-d600-000000000006', array['restaurant'], U&'\2800\2800', 'Femi', 'Issue3802h Lagos', 'issue3802h-lead6@test.local', true, 'organiser_marketing');
  v_snap := pg_temp.t3802h_snapshot();
  perform pg_temp.t3802h_check('H-9', 'a business name with nothing visible in it is refused in plain words, and nothing is written',
    pg_temp.t3802h_as('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000006')::text$q$) || '/' || (pg_temp.t3802h_snapshot() = v_snap)::text,
    'ERR:22023:lead_name_unusable: This lead''s business name cannot be used as a host name. Add the host by hand from Hosts./true');

  -- A long email and a long name: the email is never the part that is cut.
  insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source) values
    ('38020000-0000-4000-d600-000000000007', array['venue_space'], 'H9 Long Contact', repeat('n', 80), 'Issue3802h Lagos',
     repeat('e', 220) || '@issue3802h-long.test.local', true, 'organiser_marketing');
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000007')::text$q$));
  perform pg_temp.t3802h_check('H-9', 'a long contact is cut to 300 characters with the whole email kept',
    (j->>'status') || '/' || char_length(j #>> '{record,contact}')::text || '/' || ((j #>> '{record,contact}') like repeat('e', 220) || '@issue3802h-long.test.local ' || chr(183) || ' nnn%')::text,
    'created/300/true');

  -- A deleted host frees its lead; restoring the old one afterwards is refused.
  perform pg_temp.t3802h_as('owner', format($q$select public.crm_record_delete(%L)::text$q$, v_first));
  perform pg_temp.t3802h_check('H-9', 'after its host is deleted the lead is new again',
    (select coalesce(e->>'host', 'none') from jsonb_array_elements(pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_leads_list()::text$q$))->'leads') e
      where e->>'id' = '38020000-0000-4000-d600-000000000001'), 'none');
  j := pg_temp.t3802h_jb(pg_temp.t3802h_as('growth', $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d600-000000000001')::text$q$));
  perform pg_temp.t3802h_check('H-9', 'and can be added again, as a new host',
    (j->>'status') || '/' || ((j #>> '{record,id}') <> v_first)::text, 'created/true');
  perform pg_temp.t3802h_like('H-9', 'bringing the deleted host back is then refused',
    pg_temp.t3802h_as('owner', format($q$select public.crm_record_restore(%L)::text$q$, v_first)), 'ERR:22023:duplicate_name:%');
  perform pg_temp.t3802h_check('H-9', 'a lead is never two live hosts',
    (select coalesce(max(n), 0)::text from (select count(*) n from public.crm_records where beta_lead_id is not null and deleted_at is null group by beta_lead_id) x), '1');
end;
$h9$;

-- ---------------------------------------------------------------------------
-- H-10 — an invitation is refused when sent, if the address cannot be used.
-- The cases mirror the check made when an invitation is opened
-- (supabase/functions/_shared/__tests__/adminTeamInvite.issue3802.test.ts).
-- ---------------------------------------------------------------------------
do $h10$
declare
  c record;
  r text;
  v_who text;
  v_before text;
  v_audit int;
  v_id uuid;
  v_notes jsonb := '[]'::jsonb;
begin
  for c in
    select * from (values
      ('no account',                                   'issue3802h-nobody@test.local',  null, null, null, 'ok'),
      ('an account that signs in with this email',     'issue3802h-emailonly@test.local', null, 'email', 'issue3802h-emailonly@test.local', 'ok'),
      ('an account with no sign-in method recorded',   'issue3802h-bare@test.local',    null, null, 'account', 'ok'),
      ('an account with a phone number',               'issue3802h-phone@test.local',   '+15550103802', 'email', 'issue3802h-phone@test.local', 'conflict'),
      ('an email sign-in and a Google one, same email', 'issue3802h-both@test.local',   null, 'google', 'issue3802h-both@test.local', 'conflict'),
      ('an account with a blank phone number',         'issue3802h-blankphone@test.local', '   ', 'email', 'issue3802h-blankphone@test.local', 'ok'),
      ('an account with a phone sign-in',              'issue3802h-phoneid@test.local', null, 'phone', null, 'conflict'),
      ('a Google sign-in under another email',         'issue3802h-google@test.local',  null, 'google', 'someone-else@test.local', 'conflict'),
      ('a Google sign-in under this same email',       'issue3802h-googlesame@test.local', null, 'google', '  Issue3802H-GoogleSame@Test.Local ', 'conflict'),
      ('an Apple sign-in under this same email',       'issue3802h-applesame@test.local', null, 'apple', 'issue3802h-applesame@test.local', 'conflict'),
      ('a sign-in method this app has never heard of', 'issue3802h-other@test.local',   null, 'sso:example', 'issue3802h-other@test.local', 'conflict'),
      ('an Apple sign-in with no email at all',        'issue3802h-apple@test.local',   null, 'apple', null, 'conflict')
    ) as v(label, email, phone, provider, identity_email, want)
  loop
    if c.label <> 'no account' then
      v_id := gen_random_uuid();
      insert into auth.users (id, email, phone, email_confirmed_at, created_at) values (v_id, c.email, c.phone, now(), now());
      if c.provider is not null then
        insert into auth.identities (user_id, provider, identity_data)
        values (v_id, c.provider, case when c.identity_email is null then '{}'::jsonb else jsonb_build_object('email', c.identity_email) end);
      end if;
      if c.label like 'an email sign-in and a Google one%' then
        insert into auth.identities (user_id, provider, identity_data) values (v_id, 'email', jsonb_build_object('email', c.email));
      end if;
    end if;
    perform pg_temp.t3802h_check('H-10', 'verdict for ' || c.label,
      pg_temp.t3802h_as('service', format($q$select public.admin_team_invite_address_verdict(%L)$q$, c.email)), c.want);
    perform pg_temp.t3802h_check('H-10', 'verdict for ' || c.label || ', however the address is spelled',
      pg_temp.t3802h_as('service', format($q$select public.admin_team_invite_address_verdict(%L)$q$, '  ' || upper(c.email) || ' ')), c.want);

    -- The owner sends an invitation to it.
    v_before := (select count(*)::text from public.admin_team_members) || '/' || (select count(*)::text from public.admin_users)
      || '/' || (select count(*)::text from public.admin_team_invites) || '/' || (select count(*)::text from public.admin_audit_log where action like 'team.%');
    r := pg_temp.t3802h_as('owner', format($q$select public.admin_team_issue_invite(%L, 'growth', %L)::text$q$, c.email, md5(c.email) || md5(c.label)));
    if c.want = 'conflict' then
      perform pg_temp.t3802h_check('H-10', 'the owner inviting ' || c.label || ' is refused', r, 'ERR:22023:address_in_use');
      perform pg_temp.t3802h_check('H-10', 'and nothing was written for ' || c.label,
        (select count(*)::text from public.admin_team_members) || '/' || (select count(*)::text from public.admin_users)
          || '/' || (select count(*)::text from public.admin_team_invites) || '/' || (select count(*)::text from public.admin_audit_log where action like 'team.%'),
        v_before);
    else
      perform pg_temp.t3802h_check('H-10', 'the owner inviting ' || c.label || ' goes through as before',
        pg_temp.t3802h_get(r, 'status') || '/' || pg_temp.t3802h_get(r, 'email') || '/' || (select count(*)::text from public.admin_team_invites where email = c.email),
        'invited/' || c.email || '/1');
    end if;
    -- Anyone who is not the owner learns nothing about the address.
    foreach v_who in array array['admin', 'growth', 'partner', 'consumer'] loop
      perform pg_temp.t3802h_check('H-10', v_who || ' inviting ' || c.label || ' gets the same refusal as for any address',
        pg_temp.t3802h_as(v_who, format($q$select public.admin_team_issue_invite(%L, 'growth', %L)::text$q$, c.email, md5(c.email) || md5(c.label))),
        'ERR:42501:forbidden');
    end loop;
  end loop;
  perform pg_temp.t3802h_like('H-10', 'anon cannot ask at all',
    pg_temp.t3802h_as('anon', $q$select public.admin_team_issue_invite('issue3802h-phone@test.local', 'growth', repeat('a', 64))::text$q$), 'ERR:42501:permission denied for function %');
  foreach v_who in array array['owner', 'admin', 'growth', 'consumer', 'anon'] loop
    perform pg_temp.t3802h_like('H-10', v_who || ' cannot ask the verdict directly',
      pg_temp.t3802h_as(v_who, $q$select public.admin_team_invite_address_verdict('issue3802h-phone@test.local')$q$), 'ERR:42501:permission denied for function %');
  end loop;

  -- Someone already invited whose account later gains another sign-in: a
  -- re-send is refused and their standing invitation is left as it is.
  insert into auth.identities (user_id, provider, identity_data)
  select u.id, 'phone', '{}'::jsonb from auth.users u where u.email = 'issue3802h-emailonly@test.local';
  v_before := (select token_hash || '/' || role from public.admin_team_invites where email = 'issue3802h-emailonly@test.local');
  perform pg_temp.t3802h_check('H-10', 'a re-send to an address that has since become unusable is refused',
    pg_temp.t3802h_as('owner', format($q$select public.admin_team_issue_invite('issue3802h-emailonly@test.local', 'growth', %L)::text$q$, repeat('b', 64))),
    'ERR:22023:address_in_use');
  perform pg_temp.t3802h_check('H-10', 'their earlier invitation and their place on the team are untouched',
    (select token_hash || '/' || role from public.admin_team_invites where email = 'issue3802h-emailonly@test.local')
      || ' ' || (select status from public.admin_team_members where email = 'issue3802h-emailonly@test.local'),
    v_before || ' invited');

  -- Someone who already has access is still told so first (the earlier rule).
  perform pg_temp.t3802h_check('H-10', 'an active teammate is still refused as already active',
    pg_temp.t3802h_as('owner', format($q$select public.admin_team_issue_invite('issue3802h-growth@test.local', 'growth', %L)::text$q$, repeat('c', 64))),
    'ERR:23505:already_active');

  -- Where the sign-in tables cannot be read, the answer is "unknown" and the
  -- invitation is not blocked.
  begin
    drop table auth.identities;
    v_notes := v_notes || pg_temp.t3802h_note('without the sign-in tables the verdict is unknown, not an error',
      pg_temp.t3802h_as('service', $q$select public.admin_team_invite_address_verdict('issue3802h-phoneid@test.local')$q$), 'unknown');
    v_notes := v_notes || pg_temp.t3802h_note('and "unknown" does not block an invitation',
      pg_temp.t3802h_get(pg_temp.t3802h_as('owner', format($q$select public.admin_team_issue_invite('issue3802h-unknown@test.local', 'partner', %L)::text$q$, repeat('d', 64))), 'status'),
      'invited');
    raise exception 'issue3802h_undo';
  exception when others then
    if sqlerrm <> 'issue3802h_undo' then
      v_notes := v_notes || pg_temp.t3802h_note('the missing-table case ran without an unexpected error', sqlstate || ': ' || sqlerrm, 'no error');
    end if;
  end;
  perform pg_temp.t3802h_record('H-10', v_notes);
  perform pg_temp.t3802h_check('H-10', 'the sign-in table is back after that case', (to_regclass('auth.identities') is not null)::text, 'true');
end;
$h10$;

-- ---------------------------------------------------------------------------
-- H-11 — a creator reaches Booked or Posted only with a signed agreement.
-- An oracle over every pair of stages and every agreement value, through the
-- move function with its new signature, then the edit and the undo.
-- ---------------------------------------------------------------------------
do $h11$
declare
  c_stages constant text[] := array['identified', 'contacted', 'replied', 'negotiating', 'booked', 'posted', 'passed'];
  c_agreements constant text[] := array['none', 'sent', 'signed', null];
  v_from text;
  v_to text;
  v_agr text;
  v_id uuid;
  v_n int := 0;
  v_wrong int := 0;
  v_detail text := '';
  v_want_ok boolean;
  r text;
  v_after record;
begin
  foreach v_from in array c_stages loop
    foreach v_to in array c_stages loop
      continue when v_from = v_to;
      foreach v_agr in array c_agreements loop
        v_n := v_n + 1;
        v_id := gen_random_uuid();
        insert into public.crm_records (id, pipeline, name, stage, stage_reason, agreement, created_by, updated_by)
        values (v_id, 'creators', 'H11 Creator ' || v_n, v_from, case when v_from = 'passed' then 'seeded' end, v_agr,
                'issue3802h-growth@test.local', 'issue3802h-growth@test.local');
        r := pg_temp.t3802h_as('growth', format(
          $q$select public.crm_record_move_stage(p_id => %L, p_to => %L, p_reason => %L, p_expected_from => %L)::text$q$,
          v_id, v_to, case when v_to = 'passed' then 'Not a fit' end, v_from));
        v_want_ok := not (v_to in ('booked', 'posted') and v_agr is distinct from 'signed');
        select stage, agreement into v_after from public.crm_records where id = v_id;
        if v_want_ok is distinct from (pg_temp.t3802h_get(r, 'changed') = 'true')
           or (not v_want_ok and r not like 'ERR:22023:agreement_required:%')
           or v_after.stage is distinct from (case when v_want_ok then v_to else v_from end)
           or (v_after.stage in ('booked', 'posted') and v_after.stage <> v_from and v_after.agreement is distinct from 'signed') then
          v_wrong := v_wrong + 1;
          v_detail := v_detail || format('[%s->%s agreement %s: %s] ', v_from, v_to, coalesce(v_agr, 'null'), left(r, 80));
        end if;
      end loop;
    end loop;
  end loop;
  perform pg_temp.t3802h_check('H-11', 'every pair of stages and every agreement value was tried', v_n::text, '168');
  perform pg_temp.t3802h_check('H-11', 'the move function lets a creator into Booked or Posted only with a signed agreement, and refuses nothing else',
    v_wrong::text || ' ' || v_detail, '0 ');

  -- The edit: a creator in Booked or Posted keeps a signed agreement.
  perform pg_temp.t3802h_make('h11', 'growth', 'creators', '{"name": "H11 Route Creator", "agreement": "signed"}');
  perform pg_temp.t3802h_move('growth', 'h11', 'booked', null, 'identified');
  foreach v_agr in array array['none', 'sent'] loop
    perform pg_temp.t3802h_like('H-11', 'in Booked, changing the agreement to ' || v_agr || ' is refused',
      pg_temp.t3802h_as('growth', format($q$select public.crm_record_update(%L, %L::jsonb)::text$q$, pg_temp.t3802h_id('h11'), jsonb_build_object('agreement', v_agr)::text)),
      'ERR:22023:agreement_required:%');
  end loop;
  perform pg_temp.t3802h_like('H-11', 'in Booked, clearing the agreement is refused',
    pg_temp.t3802h_as('growth', format($q$select public.crm_record_update(%L, '{"agreement": null}'::jsonb)::text$q$, pg_temp.t3802h_id('h11'))),
    'ERR:22023:agreement_required:%');

  -- The undo: back into Booked needs the agreement to be signed at that moment.
  r := pg_temp.t3802h_move('growth', 'h11', 'negotiating', null, 'booked');
  perform pg_temp.t3802h_as('growth', format($q$select public.crm_record_update(%L, '{"agreement": "sent"}'::jsonb)::text$q$, pg_temp.t3802h_id('h11')));
  perform pg_temp.t3802h_like('H-11', 'an undo back into Booked is refused once the agreement is no longer signed',
    pg_temp.t3802h_as('growth', format($q$select public.crm_record_undo_stage_move(%L)::text$q$, pg_temp.t3802h_get(r, 'activity_id'))),
    'ERR:22023:%');
  perform pg_temp.t3802h_check('H-11', 'no creator moved by a function sits in Booked or Posted without a signed agreement',
    (select count(*)::text from public.crm_records x
      where x.pipeline = 'creators' and x.stage in ('booked', 'posted') and x.agreement is distinct from 'signed' and x.deleted_at is null
        and exists (select 1 from public.crm_activity a where a.record_id = x.id and a.kind = 'stage_move' and a.to_stage = x.stage)), '0');
  -- New records always start in the first stage, whatever is sent.
  perform pg_temp.t3802h_like('H-11', 'a new creator cannot be created straight into a later stage',
    pg_temp.t3802h_as('growth', $q$select public.crm_record_create('creators', '{"name": "H11 Skip", "stage": "booked"}'::jsonb, 'h11-skip-0001')::text$q$),
    'ERR:22023:unknown_field:%');
end;
$h11$;

-- ---------------------------------------------------------------------------
-- H-12 — is_admin_user() is unchanged.
-- ---------------------------------------------------------------------------
do $h12$
begin
  perform pg_temp.t3802h_check('H-12', 'is_admin_user() has the source it had before this migration',
    (select md5(prosrc) from pg_proc where oid = 'public.is_admin_user()'::regprocedure), 'dc5465a20a4246c6921be0469e261a8b');
  perform pg_temp.t3802h_check('H-12', 'the migration file never replaces it',
    (select (sql !~* 'function\s+public\.is_admin_user')::text from (select string_agg(sql, ' ') as sql from t3802h_src) s), 'true');
  perform pg_temp.t3802h_check('H-12', 'it still answers true for owner and admin only',
    pg_temp.t3802h_as('owner', 'select public.is_admin_user()::text') || '/' || pg_temp.t3802h_as('admin', 'select public.is_admin_user()::text')
      || '/' || pg_temp.t3802h_as('growth', 'select public.is_admin_user()::text') || '/' || pg_temp.t3802h_as('partner', 'select public.is_admin_user()::text')
      || '/' || pg_temp.t3802h_as('consumer', 'select public.is_admin_user()::text'), 'true/true/false/false/false');
end;
$h12$;

-- ---------------------------------------------------------------------------
-- H-13 — the migration's self-check, run against deliberate mistakes. Each
-- mistake is made inside a block that is undone when the self-check objects.
-- ---------------------------------------------------------------------------
do $h13$
declare
  v_sql text := (select sql from t3802h_src where k = 'selfcheck');
  v_old text := replace((select sql from t3802h_src where k = 'oldkey'), 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
  m record;
  v_got text;
begin
  perform pg_temp.t3802h_check('H-13', 'the self-check block was read from the migration file',
    (v_sql like 'DO $check$%' and v_sql like '%$check$;%' and v_sql like '%public.crm_targets%' and length(v_sql) > 4000)::text, 'true');
  if v_sql is null or v_sql not like 'DO $check$%' then
    return;
  end if;

  begin
    execute v_sql;
    v_got := 'passed';
  exception when others then
    v_got := 'ERR:' || sqlerrm;
  end;
  perform pg_temp.t3802h_check('H-13', 'as shipped, the self-check passes', v_got, 'passed');

  for m in
    select * from (values
      ('the targets table readable by signed-in users', $q$grant select on public.crm_targets to authenticated$q$, '%authenticated holds SELECT on public.crm_targets%'),
      ('the targets table writable by anon',            $q$grant insert on public.crm_targets to anon$q$, '%anon holds INSERT on public.crm_targets%'),
      ('one targets column readable by signed-in users', $q$grant select (monthly_target) on public.crm_targets to authenticated$q$, '%authenticated holds%on public.crm_targets%'),
      ('a policy on the targets table',                 $q$create policy issue3802h_planted on public.crm_targets for select using (true)$q$, '%a policy exists on public.crm_targets%'),
      ('row security switched off on the targets table', $q$alter table public.crm_targets disable row level security$q$, '%row security is off on public.crm_targets%'),
      ('a trigger on the targets table',                $q$create trigger issue3802h_planted before insert on public.crm_targets for each row execute function pg_temp.t3802h_fault()$q$, '%a trigger exists on public.crm_targets%'),
      ('a summary helper opened to signed-in users',    $q$grant execute on function public.crm_due_json(text, date, integer) to authenticated$q$, '%authenticated can execute the internal public.crm_due_json(text,date,integer)%'),
      ('the address check opened to signed-in users',   $q$grant execute on function public.admin_team_invite_address_verdict(text) to authenticated$q$, '%authenticated can execute the internal public.admin_team_invite_address_verdict(text)%'),
      ('the home summary opened to anon',               $q$grant execute on function public.crm_home_summary(date) to anon$q$, '%anon can execute public.crm_home_summary(date)%'),
      ('Add to Hosts opened to everyone',               $q$grant execute on function public.crm_beta_lead_to_host(uuid) to public$q$, '%can execute public.crm_beta_lead_to_host(uuid)%'),
      ('the team dashboard closed to signed-in users',  $q$revoke execute on function public.crm_team_summary(date) from authenticated$q$, '%authenticated cannot execute public.crm_team_summary(date)%'),
      ('a second move function',                        $q$create function public.crm_record_move_stage(p_id uuid, p_to text) returns jsonb language sql set search_path = '' as 'select null::jsonb'$q$, '%crm_ function(s) are not in the checked list%'),
      ('a stray pipeline function',                     $q$create function public.crm_issue3802h_stray() returns int language sql as 'select 1'$q$, '%crm_ function(s) are not in the checked list%'),
      ('the invitation issuer opened to anon',          $q$grant execute on function public.admin_team_issue_invite(text, text, text) to anon$q$, '%admin_team_issue_invite(text,text,text) grants changed%'),
      ('the full-admin beta leads reader opened to anon', $q$grant execute on function public.admin_beta_leads_list() to anon$q$, '%anon can execute admin_beta_leads_list()%'),
      ('the key function put back without re-keying',   v_old, '%a stored name key differs from crm_name_key(name)%')
    ) as v(label, mistake, want)
  loop
    begin
      if m.label = 'the key function put back without re-keying' then
        -- A stored key that only the new rule gives.
        insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
        values ('hosts', U&'\FF28\FF11\FF13 Stale', 'prospect', 'issue3802h-plant', 'issue3802h-plant');
      end if;
      execute m.mistake;
      execute v_sql;
      v_got := 'passed';
      raise exception 'issue3802h_undo_the_mistake';
    exception when others then
      if sqlerrm = 'issue3802h_undo_the_mistake' then
        v_got := 'the self-check did not object';
      else
        v_got := sqlerrm;
      end if;
    end;
    perform pg_temp.t3802h_like('H-13', 'the self-check objects to ' || m.label, v_got, m.want);
  end loop;

  begin
    execute v_sql;
    v_got := 'passed';
  exception when others then
    v_got := 'ERR:' || sqlerrm;
  end;
  perform pg_temp.t3802h_check('H-13', 'every mistake was undone: the self-check passes again', v_got, 'passed');
end;
$h13$;

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
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802h_results;
  if v_total < 550 then
    raise exception 'ISSUE-3802 HOMES FAIL: only % checks ran; the suite did not execute fully', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from t3802h_results where not ok order by seq limit 80 loop
      raise warning 'ISSUE-3802 HOMES FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    select string_agg(distinct test, ', ' order by test) into v_tests from t3802h_results where not ok;
    raise exception 'ISSUE-3802 HOMES FAIL: % of % checks failed in: %', v_failed, v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 HOMES PASS (part 1): % checks across H-1..H-13, 0 failed', v_total;
end;
$verdict$;

rollback;

-- ===========================================================================
-- PART 2 — real concurrency. Two accounts, one card and one beta lead are
-- committed and removed.
-- ===========================================================================
create schema t3802h_race;
select count(*) = 0 as t3802h_made_dblink from pg_extension where extname = 'dblink' \gset
create extension if not exists dblink with schema t3802h_race;
select n.nspname as t3802h_dblink_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'dblink' \gset
set search_path = public, :"t3802h_dblink_schema";
select set_config('t3802h.conn',
  format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s',
         current_setting('port'), current_database(), current_user, :'t3802h_pw'), false) is not null as conn_ready;

create table t3802h_race.results (seq serial primary key, label text, ok boolean, detail text);

-- Leftovers from an interrupted earlier run, then this run's people. Two full
-- admins: that role needs no confirmed-mailbox column, which this image lacks
-- outside part 1.
begin;
delete from public.crm_activity where actor_email like 'issue3802h-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802h-race-%');
delete from public.crm_record_owners where owner_email like 'issue3802h-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802h-race-%');
delete from public.crm_records where created_by like 'issue3802h-race-%';
delete from public.crm_request_keys where actor_email like 'issue3802h-race-%';
delete from public.beta_access_leads where email like 'issue3802h-race-%';
delete from public.crm_targets where created_by like 'issue3802h-race-%';
set local session_replication_role = replica;
delete from public.seeding_cities where google_place_id = 'issue3802h-race-city';
delete from public.admin_audit_log where admin_email like 'issue3802h-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802h-race-%';
delete from auth.users where email like 'issue3802h-race-%';
insert into auth.users (id, email) values
  ('38020000-0000-4000-d900-000000000001', 'issue3802h-race-1@test.local'),
  ('38020000-0000-4000-d900-000000000002', 'issue3802h-race-2@test.local');
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802h-race-1@test.local', 'admin', 'active', now()),
  ('issue3802h-race-2@test.local', 'admin', 'active', now());
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('38020000-0000-4000-d910-000000000001', 'hosts', 'Issue3802h Race Card', 'prospect', 'issue3802h-race-1@test.local', 'issue3802h-race-1@test.local');
insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, consent, source) values
  ('38020000-0000-4000-d920-000000000001', array['restaurant'], 'Issue3802h Race Lead', 'Race', 'Nowhere', 'issue3802h-race-lead@test.local', true, 'organiser_marketing');
set local session_replication_role = replica;
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, is_live_for_consumers) values
  ('38020000-0000-4000-d930-000000000001', 'issue3802h-race-city', 'Issue3802h Race City', 'Nigeria', 'NG', 1, 1, 0, 0, 2, 2, false);
set local session_replication_role = origin;
commit;

do $race$
declare
  c_conn constant text := current_setting('t3802h.conn');
  v_c text;
  v_n int;
  v_pid int;
  v_waited boolean;
  v_r1 text;
  v_r2 text;
  v_err text;
  i int;
begin
  -- R-1: two people move one card to DIFFERENT stages at the same moment,
  -- each naming the stage they saw. Exactly one succeeds.
  begin
    v_n := 0;
    foreach v_c in array array['t3802h_c1', 't3802h_c2'] loop
      v_n := v_n + 1;
      perform dblink_connect(v_c, c_conn);
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-d900-00000000000%s', true) || set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-d900-00000000000%s","role":"authenticated"}', true)$q$,
        v_n, v_n)) as t(x text);
    end loop;

    select x into v_r1 from dblink('t3802h_c1',
      $q$select public.crm_record_move_stage('38020000-0000-4000-d910-000000000001', 'contacted', null, 'prospect')::text$q$) as t(x text);
    select x into v_pid from dblink('t3802h_c2', 'select pg_backend_pid()') as t(x int);
    perform dblink_send_query('t3802h_c2',
      $q$select public.crm_record_move_stage('38020000-0000-4000-d910-000000000001', 'replied', null, 'prospect')::text$q$);
    v_waited := false;
    for i in 1..200 loop
      select exists (select 1 from pg_locks l where l.pid = v_pid and not l.granted) into v_waited;
      exit when v_waited or dblink_is_busy('t3802h_c2') = 0;
      perform pg_sleep(0.05);
    end loop;
    insert into t3802h_race.results (label, ok, detail)
    values ('R-1 the second move waits for the first', v_waited, 'waited=' || v_waited::text);

    perform dblink_exec('t3802h_c1', 'commit');
    v_r2 := null;
    begin
      select x into v_r2 from dblink_get_result('t3802h_c2', false) as t(x text);
    exception when others then
      v_r2 := null;
    end;
    v_err := coalesce(dblink_error_message('t3802h_c2'), '');
    perform * from dblink_get_result('t3802h_c2', false) as t(x text);
    perform dblink_exec('t3802h_c2', 'rollback');

    insert into t3802h_race.results (label, ok, detail)
    values ('R-1 the first move went through', coalesce((v_r1::jsonb ->> 'changed') = 'true', false), coalesce(left(v_r1, 80), '<null>'));
    insert into t3802h_race.results (label, ok, detail)
    values ('R-1 the second move is refused: the card is no longer where it was seen',
            v_r2 is null and v_err like '%stage_changed: This card is in Contacted now, not Prospect%',
            coalesce(left(v_r2, 80), '<no answer>') || ' / ' || left(v_err, 160));
    insert into t3802h_race.results (label, ok, detail)
    select 'R-1 the card is in the first mover''s stage', stage = 'contacted', stage
      from public.crm_records where id = '38020000-0000-4000-d910-000000000001';
    insert into t3802h_race.results (label, ok, detail)
    select 'R-1 exactly one move was logged and audited',
           (select count(*) from public.crm_activity where record_id = '38020000-0000-4000-d910-000000000001' and kind = 'stage_move') = 1
             and (select count(*) from public.admin_audit_log where target_id = '38020000-0000-4000-d910-000000000001' and action = 'crm.stage_move') = 1,
           (select count(*)::text from public.crm_activity where record_id = '38020000-0000-4000-d910-000000000001' and kind = 'stage_move');
  exception when others then
    insert into t3802h_race.results (label, ok, detail)
    values ('R-1 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array array['t3802h_c1', 't3802h_c2'] loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then
      perform dblink_disconnect(v_c);
    end if;
  end loop;

  -- R-2: two people press Add to Hosts on one lead at the same moment.
  begin
    v_n := 0;
    foreach v_c in array array['t3802h_c1', 't3802h_c2'] loop
      v_n := v_n + 1;
      perform dblink_connect(v_c, c_conn);
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-d900-00000000000%s', true) || set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-d900-00000000000%s","role":"authenticated"}', true)$q$,
        v_n, v_n)) as t(x text);
    end loop;

    select x into v_r1 from dblink('t3802h_c1',
      $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d920-000000000001')::text$q$) as t(x text);
    select x into v_pid from dblink('t3802h_c2', 'select pg_backend_pid()') as t(x int);
    perform dblink_send_query('t3802h_c2',
      $q$select public.crm_beta_lead_to_host('38020000-0000-4000-d920-000000000001')::text$q$);
    v_waited := false;
    for i in 1..200 loop
      select exists (select 1 from pg_locks l where l.pid = v_pid and not l.granted) into v_waited;
      exit when v_waited or dblink_is_busy('t3802h_c2') = 0;
      perform pg_sleep(0.05);
    end loop;
    insert into t3802h_race.results (label, ok, detail)
    values ('R-2 the second press waits for the first', v_waited, 'waited=' || v_waited::text);

    perform dblink_exec('t3802h_c1', 'commit');
    select x into v_r2 from dblink_get_result('t3802h_c2', false) as t(x text);
    v_err := coalesce(dblink_error_message('t3802h_c2'), '');
    perform * from dblink_get_result('t3802h_c2', false) as t(x text);
    perform dblink_exec('t3802h_c2', 'commit');

    insert into t3802h_race.results (label, ok, detail)
    values ('R-2 the first press creates the host', coalesce((v_r1::jsonb ->> 'status') = 'created', false), coalesce(left(v_r1, 80), '<null>'));
    insert into t3802h_race.results (label, ok, detail)
    values ('R-2 the second press is told the lead is already that host',
            coalesce((v_r2::jsonb ->> 'status') = 'exists' and (v_r2::jsonb #>> '{record,id}') = (v_r1::jsonb #>> '{record,id}'), false),
            coalesce(left(v_r2, 160), '<null>') || ' ' || v_err);
    insert into t3802h_race.results (label, ok, detail)
    select 'R-2 exactly one host exists for the lead, owned by the first presser',
           count(*) = 1 and max(created_by) = 'issue3802h-race-1@test.local', count(*)::text || ' ' || coalesce(max(created_by), '')
      from public.crm_records where beta_lead_id = '38020000-0000-4000-d920-000000000001' and deleted_at is null;
  exception when others then
    insert into t3802h_race.results (label, ok, detail)
    values ('R-2 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array array['t3802h_c1', 't3802h_c2'] loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then
      perform dblink_disconnect(v_c);
    end if;
  end loop;

  -- R-3: two admins set the same new target at the same moment. The second
  -- waits its turn and is answered like any later change: never a raw error,
  -- never two rows.
  begin
    v_n := 0;
    foreach v_c in array array['t3802h_c1', 't3802h_c2'] loop
      v_n := v_n + 1;
      perform dblink_connect(v_c, c_conn);
      perform dblink_exec(v_c, 'begin');
      perform dblink_exec(v_c, 'set local role authenticated');
      perform * from dblink(v_c, format(
        $q$select set_config('request.jwt.claim.sub', '38020000-0000-4000-d900-00000000000%s', true) || set_config('request.jwt.claims', '{"sub":"38020000-0000-4000-d900-00000000000%s","role":"authenticated"}', true)$q$,
        v_n, v_n)) as t(x text);
    end loop;

    select x into v_r1 from dblink('t3802h_c1',
      $q$select public.crm_target_set('38020000-0000-4000-d930-000000000001', 'partner_org', 5)::text$q$) as t(x text);
    select x into v_pid from dblink('t3802h_c2', 'select pg_backend_pid()') as t(x int);
    perform dblink_send_query('t3802h_c2',
      $q$select public.crm_target_set('38020000-0000-4000-d930-000000000001', 'partner_org', 7)::text$q$);
    v_waited := false;
    for i in 1..200 loop
      select exists (select 1 from pg_locks l where l.pid = v_pid and not l.granted and l.locktype = 'advisory') into v_waited;
      exit when v_waited or dblink_is_busy('t3802h_c2') = 0;
      perform pg_sleep(0.05);
    end loop;
    insert into t3802h_race.results (label, ok, detail)
    values ('R-3 the second target change waits its turn on the per-target lock', v_waited, 'waited=' || v_waited::text);

    perform dblink_exec('t3802h_c1', 'commit');
    v_r2 := null;
    begin
      select x into v_r2 from dblink_get_result('t3802h_c2', false) as t(x text);
    exception when others then
      v_r2 := null;
    end;
    v_err := coalesce(dblink_error_message('t3802h_c2'), '');
    perform * from dblink_get_result('t3802h_c2', false) as t(x text);
    begin
      perform dblink_exec('t3802h_c2', 'commit');
    exception when others then
      null;
    end;

    insert into t3802h_race.results (label, ok, detail)
    values ('R-3 the first change set the target', coalesce((v_r1::jsonb ->> 'changed') = 'true' and (v_r1::jsonb ->> 'previous') is null, false), coalesce(left(v_r1, 80), '<null>'));
    insert into t3802h_race.results (label, ok, detail)
    values ('R-3 the second change is answered as a change from the first number, not with an error',
            coalesce((v_r2::jsonb ->> 'changed') = 'true' and (v_r2::jsonb ->> 'previous') = '5', false),
            coalesce(left(v_r2, 80), '<no answer>') || ' / ' || left(v_err, 120));
    insert into t3802h_race.results (label, ok, detail)
    select 'R-3 one row holds the later number, and each change wrote one audit row',
           count(*) = 1 and max(monthly_target) = 7
             and (select count(*) from public.admin_audit_log where action = 'crm.target_set' and admin_email like 'issue3802h-race-%') = 2,
           count(*)::text || ' row(s), target ' || coalesce(max(monthly_target)::text, '-')
      from public.crm_targets where region_id = '38020000-0000-4000-d930-000000000001';
  exception when others then
    insert into t3802h_race.results (label, ok, detail)
    values ('R-3 ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
  end;
  foreach v_c in array array['t3802h_c1', 't3802h_c2'] loop
    if v_c = any (coalesce(dblink_get_connections(), '{}')) then
      perform dblink_disconnect(v_c);
    end if;
  end loop;
end;
$race$;

select count(*) as t3802h_race_total,
       count(*) filter (where not ok) as t3802h_race_failed,
       coalesce(string_agg(label || ' [' || coalesce(detail, '') || ']', '; ' order by seq) filter (where not ok), 'none') as t3802h_race_failures
  from t3802h_race.results \gset

-- Remove the committed rows, whatever the verdict.
begin;
delete from public.crm_activity where actor_email like 'issue3802h-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802h-race-%');
delete from public.crm_record_owners where owner_email like 'issue3802h-race-%'
   or record_id in (select id from public.crm_records where created_by like 'issue3802h-race-%');
delete from public.crm_records where created_by like 'issue3802h-race-%';
delete from public.crm_request_keys where actor_email like 'issue3802h-race-%';
delete from public.beta_access_leads where email like 'issue3802h-race-%';
delete from public.crm_targets where created_by like 'issue3802h-race-%';
set local session_replication_role = replica;
delete from public.seeding_cities where google_place_id = 'issue3802h-race-city';
delete from public.admin_audit_log where admin_email like 'issue3802h-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802h-race-%';
delete from auth.users where email like 'issue3802h-race-%';
commit;
reset search_path;
\if :t3802h_made_dblink
drop extension if exists dblink;
\endif
drop schema t3802h_race cascade;

select (:t3802h_race_total < 13 or :t3802h_race_failed > 0) as t3802h_race_bad \gset
\if :t3802h_race_bad
  \echo 'ISSUE-3802 HOMES FAILED (part 2):' :t3802h_race_failures
  do $$ begin raise exception 'ISSUE-3802 HOMES FAIL: concurrency checks failed or did not run'; end $$;
\endif
\echo 'ISSUE-3802 HOMES PASS (part 2):' :t3802h_race_total 'concurrency checks, 0 failed'
