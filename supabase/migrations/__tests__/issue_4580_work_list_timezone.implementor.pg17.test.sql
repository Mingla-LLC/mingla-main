-- MINGLA-INVARIANT: I-4580-WORK-LIST-TIMEZONE-CACHED | issue #4580 | ops_work_list validates tz through public.ops_timezone_valid, whose answer equals a pg_timezone_names lookup for every input.
-- Issue #4580 -- implementor suite for
-- 20281202014580_issue_4580_work_list_timezone_cache.sql, on the fully
-- replayed PG17 schema. Everything is rolled back.
--
--   SC-8   ops_work_list no longer reads pg_timezone_names and calls
--          ops_timezone_valid; ops_timezone_valid(x) equals
--          EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = x) for every
--          zone name and for '', 'Not/AZone', 'PDT', 'UTC+5', 'EST5EDT', a
--          64-character string and NULL (false); a valid zone and an unknown
--          one give the same done_since as the old rule (Monday 00:00 in New
--          York, and in UTC).
--   FAST   a cached zone is answered in well under a millisecond on average
--          (the old lookup builds the whole zone list on every call).
--   RLS    ops_timezone_names has row level security, holds every zone name,
--          and anon / authenticated cannot read it; ops_timezone_valid is
--          closed to anon.
--
-- Run from the repository root as supabase_admin.
--
-- FAILS-ON-REVERT (proved on 71c219c91b; the replaced bodies are unchanged at
-- 8b971e1ba0): on origin/main's definitions ops_work_list
-- still searches pg_timezone_names, and ops_timezone_valid and
-- ops_timezone_names do not exist.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(left(p_want, 400), '<null>')));
$fn$;
-- Run a statement; return 'ok' or its SQLSTATE.
create function pg_temp.state(p_sql text) returns text
language plpgsql as $fn$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$fn$;
-- ops_timezone_valid(x), or NULL where it does not exist.
create function pg_temp.valid(p_tz text) returns boolean
language plpgsql as $fn$
declare v boolean;
begin
  execute 'select public.ops_timezone_valid($1)' into v using p_tz;
  return v;
exception when undefined_function then
  return null;
end;
$fn$;

-- ───────────────────────────── SC-8: the definition ─────────────────────────────
select pg_temp.chk('SC-8', 'ops_work_list no longer reads pg_timezone_names and validates tz through ops_timezone_valid',
  (select (position('pg_timezone_names' in pg_get_functiondef('public.ops_work_list(jsonb)'::regprocedure)) = 0)::text
          || '/' || (position('public.ops_timezone_valid(q->>''tz'')' in pg_get_functiondef('public.ops_work_list(jsonb)'::regprocedure)) > 0)::text),
  'true/true');

-- ───────────────────────────── SC-8: the same answer for every input ─────────────────────────────
select pg_temp.chk('SC-8', 'every zone name is valid, exactly as the catalog says',
  (select count(*) filter (where pg_temp.valid(z.name) is distinct from true)::text from pg_catalog.pg_timezone_names z), '0');
select pg_temp.chk('SC-8', 'odd inputs give the catalog''s answer (NULL is not a zone)',
  (select string_agg(coalesce(pg_temp.valid(x)::text, 'missing') || '=' ||
                     (x is not null and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = x))::text, ',' order by o)
     from unnest(array['', 'Not/AZone', 'PDT', 'UTC+5', 'EST5EDT', repeat('a', 64), null, 'america/new_york', 'UTC', 'Etc/GMT+5']) with ordinality u(x, o)),
  (select string_agg(v || '=' || v, ',' order by o)
     from unnest(array['', 'Not/AZone', 'PDT', 'UTC+5', 'EST5EDT', repeat('a', 64), null, 'america/new_york', 'UTC', 'Etc/GMT+5']) with ordinality u(x, o),
          lateral (select (x is not null and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = x))::text v) w));
-- A name a later tzdata adds (absent from the cache) still falls back to the catalog.
do $miss$
begin
  if to_regclass('public.ops_timezone_names') is not null then
    delete from public.ops_timezone_names where name = 'America/New_York';
  end if;
end;
$miss$;
select pg_temp.chk('SC-8', 'a zone missing from the cache is still valid', pg_temp.valid('America/New_York')::text, 'true');

-- ───────────────────────────── SC-8: done_since keeps the old rule ─────────────────────────────
insert into auth.users (id, email, email_confirmed_at) values ('45800000-0000-4000-d000-000000000001', 'own.tz4580@test.local', now());
insert into public.admin_users (email, role, status, accepted_at) values ('own.tz4580@test.local', 'owner', 'active', now());
select set_config('request.jwt.claim.sub', '45800000-0000-4000-d000-000000000001', true);
select set_config('request.jwt.claims', json_build_object('sub', '45800000-0000-4000-d000-000000000001', 'email', 'own.tz4580@test.local',
                                                          'role', 'authenticated')::text, true);
select pg_temp.chk('SC-8', 'a valid zone: done_since is Monday 00:00 in New York',
  (select (public.ops_work_list('{"tz":"America/New_York","shape":"board"}'::jsonb)->>'done_since')::timestamptz::text),
  (select (public.ops_monday(public.ops_today(null))::timestamp at time zone 'America/New_York')::text));
select pg_temp.chk('SC-8', 'an unknown zone counts as UTC, as before',
  (select (public.ops_work_list('{"tz":"Nope/Zone","shape":"board"}'::jsonb)->>'done_since')::timestamptz::text),
  (select (public.ops_monday(public.ops_today(null))::timestamp at time zone 'UTC')::text));
select pg_temp.chk('SC-8', 'a too-long or non-string tz is still refused 22023',
  pg_temp.state(format('select public.ops_work_list(%L::jsonb)', jsonb_build_object('tz', repeat('a', 65))))
  || ',' || pg_temp.state($q$select public.ops_work_list('{"tz":5}'::jsonb)$q$), '22023,22023');

-- ───────────────────────────── FAST ─────────────────────────────
create temp table tx_fast (what text, ms numeric) on commit drop;
do $fast$
declare t0 timestamptz; i integer; v boolean;
begin
  if to_regprocedure('public.ops_timezone_valid(text)') is null then
    insert into tx_fast values ('cached', null);
    return;
  end if;
  t0 := clock_timestamp();
  for i in 1..500 loop
    execute 'select public.ops_timezone_valid($1)' into v using 'Europe/London';
  end loop;
  insert into tx_fast values ('cached', extract(epoch from clock_timestamp() - t0) * 1000 / 500);
  t0 := clock_timestamp();
  for i in 1..20 loop
    v := exists (select 1 from pg_catalog.pg_timezone_names z where z.name = 'Europe/London');
  end loop;
  insert into tx_fast values ('catalog', extract(epoch from clock_timestamp() - t0) * 1000 / 20);
end;
$fast$;
do $show$
begin
  raise notice 'FAST timing: cached % ms per call, catalog lookup % ms per call',
    (select round(ms, 3) from tx_fast where what = 'cached'), (select round(ms, 3) from tx_fast where what = 'catalog');
end;
$show$;
select pg_temp.chk('FAST', 'a cached zone is answered in under 0.5 ms on average',
  (select (ms < 0.5)::text from tx_fast where what = 'cached'), 'true');

-- ───────────────────────────── RLS and grants ─────────────────────────────
select pg_temp.chk('RLS', 'ops_timezone_names has row level security and holds every zone name',
  (select c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.ops_timezone_names'))
    || '/' || (select (count(*) = 0)::text from pg_catalog.pg_timezone_names z
                where to_regclass('public.ops_timezone_names') is null
                   or z.name <> 'America/New_York' and not pg_temp.valid(z.name)),
  'true/true');
select pg_temp.chk('RLS', 'anon and authenticated cannot read ops_timezone_names',
  (select coalesce(has_table_privilege('anon', to_regclass('public.ops_timezone_names'), 'SELECT')::text, 'missing') || '/'
       || coalesce(has_table_privilege('authenticated', to_regclass('public.ops_timezone_names'), 'SELECT')::text, 'missing')),
  'false/false');
select pg_temp.chk('RLS', 'ops_timezone_valid is closed to anon and pins its search_path',
  (select coalesce(has_function_privilege('anon', to_regprocedure('public.ops_timezone_valid(text)'), 'EXECUTE')::text, 'missing') || '/'
       || coalesce((select p.prosecdef::text || ':' || array_to_string(p.proconfig, ';') from pg_proc p
                     where p.oid = to_regprocedure('public.ops_timezone_valid(text)')), 'missing')),
  'false/true:search_path=pg_catalog, pg_temp');

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 10 then raise exception '#4580 work list time zone implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4580 work list time zone implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4580 work list time zone implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
