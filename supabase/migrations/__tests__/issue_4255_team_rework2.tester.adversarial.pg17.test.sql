-- Issue #4255 retest 2 -- tester adversarial suite for
-- 20280614064255_issue_4255_team_rework2.sql (team_set_my_timezone and the
-- owner-only, tag-event-only decision push), on the fully replayed PG17
-- schema. Angles the implementor rework 2 suite does not take:
--
--   Z-SET     a teammate can only ever write their own profile (another
--             teammate's zone is untouched); spaces are trimmed; the same zone
--             again writes nothing; a host, an unconfirmed look-alike and
--             anon write nothing; a staff account with no profile row writes
--             nothing and gets null back
--   Z-BAD     unknown, posix/, over-long, quote-injection and empty names are
--             refused with 22023 and nothing is written
--   Z-USE     the saved zone is the one the 09:00 digest reads: once saved as
--             Africa/Lagos, a teammate who had no zone is told at 09:10 Lagos
--             and not at 09:10 New York
--   D-TAG     the decision push follows the tag event: a watcher never, an
--             owner on the first tag
--
-- FAILS-ON-REVERT (each proved by deleting the guarded line from the
-- function in a copy of the replayed database and re-running this suite; see
-- the #4255 retest 2 verdict):
--   * team_set_my_timezone: the pg_timezone_names check
--   * team_set_my_timezone: "IF NOT public.team_chat_staff(v_uid)"
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tz_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tz_people (who, id, email) values
  ('owner', '4255d000-0000-4000-a0f2-000000000001', 'oz.z4255@test.local'),
  ('ray',   '4255d000-0000-4000-a0f2-000000000002', 'ray.z4255@test.local'),
  ('gem',   '4255d000-0000-4000-a0f2-000000000003', 'gem.z4255@test.local'),
  ('host',  '4255d000-0000-4000-a0f2-000000000004', 'host.z4255@test.local'),
  ('unc',   '4255d000-0000-4000-a0f2-000000000005', 'unc.z4255@test.local'),
  ('nopro', '4255d000-0000-4000-a0f2-000000000006', 'nopro.z4255@test.local');
insert into auth.users (id, email, email_confirmed_at)
  select id, email, case when who = 'unc' then null else now() end from tz_people;
insert into public.admin_users (email, role, status, accepted_at) values ('oz.z4255@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tz_people where who in ('ray', 'gem', 'unc', 'nopro');
-- Everyone has a profile with no zone, except nopro (no profile row at all).
insert into public.profiles (id, timezone) select id, null from tz_people where who <> 'nopro'
on conflict (id) do update set timezone = null;
delete from public.profiles where id = '4255d000-0000-4000-a0f2-000000000006';
update public.profiles set timezone = 'Europe/Berlin' where id = '4255d000-0000-4000-a0f2-000000000003';

create temp table tz_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tz_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tz_people where who = p_who;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
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
create function pg_temp.as_anon(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;
create function pg_temp.person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.next_request();
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tz_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tz_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from tz_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tz_people where who = p_who $fn$;
create function pg_temp.zone(p_who text) returns text
language sql as $fn$ select coalesce((select coalesce(timezone, '<null>') from public.profiles where id = pg_temp.uid(p_who)), '<no row>') $fn$;
create function pg_temp.set_tz(p_who text, p_zone text) returns text
language sql as $fn$ select pg_temp.person(p_who, format('select public.team_set_my_timezone(%L)::text', p_zone)) $fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tz_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tz_ids where k = p_k $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tz_ids where k = p_k) $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 'tz-' || md5(random()::text || clock_timestamp()::text) $fn$;

-- ───────────────────────────── Z-SET ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.set_tz('ray', '  Africa/Lagos  ');
  perform pg_temp.chk('Z-SET', 'Ray saves his zone, trimmed, and it changed', (v::jsonb)->>'timezone' || '/' || ((v::jsonb)->>'changed'), 'Africa/Lagos/true');
  perform pg_temp.chk('Z-SET', 'it is on his profile', pg_temp.zone('ray'), 'Africa/Lagos');
  perform pg_temp.chk('Z-SET', 'nobody else''s profile moved', pg_temp.zone('gem') || '|' || pg_temp.zone('owner'), 'Europe/Berlin|<null>');
  v := pg_temp.set_tz('ray', 'Africa/Lagos');
  perform pg_temp.chk('Z-SET', 'the same zone again changes nothing', (v::jsonb)->>'changed', 'false');
  v := pg_temp.set_tz('gem', 'America/New_York');
  perform pg_temp.chk('Z-SET', 'a teammate moving zones writes only their own row', pg_temp.zone('gem') || '|' || pg_temp.zone('ray'), 'America/New_York|Africa/Lagos');
  v := pg_temp.set_tz('host', 'Africa/Lagos');
  perform pg_temp.chk('Z-SET', 'a host who is not staff is told staff false and nothing is written', ((v::jsonb)->>'staff') || '/' || pg_temp.zone('host'), 'false/<null>');
  v := pg_temp.set_tz('unc', 'Africa/Lagos');
  perform pg_temp.chk('Z-SET', 'an unconfirmed look-alike writes nothing', ((v::jsonb)->>'staff') || '/' || pg_temp.zone('unc'), 'false/<null>');
  perform pg_temp.lk('Z-SET', 'anon cannot call it', pg_temp.as_anon($q$select public.team_set_my_timezone('Africa/Lagos')::text$q$), 'ERR:42501:%');
  v := pg_temp.set_tz('nopro', 'Africa/Lagos');
  perform pg_temp.chk('Z-SET', 'staff with no profile row: nothing written, null back', coalesce((v::jsonb)->>'timezone', 'null') || '/' || pg_temp.zone('nopro'), 'null/<no row>');
end;
$t$;

-- ───────────────────────────── Z-BAD ─────────────────────────────
do $t$
declare v_bad text;
begin
  foreach v_bad in array array['Mars/Phobos', 'posix/Africa/Lagos', repeat('A', 65), 'Africa/Lagos''; drop table profiles; --', '', '   ', 'africa/lagos'] loop
    perform pg_temp.lk('Z-BAD', format('"%s" is refused', left(v_bad, 30)), pg_temp.set_tz('ray', v_bad), 'ERR:22023:team_timezone_unknown%');
  end loop;
  perform pg_temp.lk('Z-BAD', 'null is refused', pg_temp.person('ray', 'select public.team_set_my_timezone(null)::text'), 'ERR:22023:%');
  perform pg_temp.chk('Z-BAD', 'after every refusal Ray''s zone is unchanged', pg_temp.zone('ray'), 'Africa/Lagos');
end;
$t$;

-- ───────────────────────────── Z-USE ─────────────────────────────
do $t$
declare v text; v_d date := (now() at time zone 'UTC')::date;
begin
  v := pg_temp.person('owner', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', 'Z4255 Ray late card', 'instructions', 'Do the work carefully and say what changed.',
      'done_means', 'It is done and checked.', 'owners', jsonb_build_array(pg_temp.email('ray')), 'due_on', v_d + 3)), pg_temp.rk()));
  perform pg_temp.keep('LATE', ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  update public.ops_work_cards set due_on = v_d - 3 where id = pg_temp.id('LATE');
  delete from public.team_mentions where source_kind = 'work_due';
  perform public.ops_due_digest(((v_d + time '09:10') at time zone 'America/New_York'));
  perform pg_temp.chk('Z-USE', 'with Africa/Lagos saved, Ray is not told at 09:10 New York',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('ray')), '0');
  perform public.ops_due_digest(((v_d + time '09:10') at time zone 'Africa/Lagos'));
  perform pg_temp.chk('Z-USE', 'and is told at 09:10 Lagos',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('ray')), '1');
end;
$t$;

-- ───────────────────────────── D-TAG ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.person('owner', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', 'Z4255 Tag card', 'instructions', 'Do the work carefully and say what changed.',
      'done_means', 'It is done and checked.', 'owners', jsonb_build_array(pg_temp.email('ray')),
      'watchers', jsonb_build_array(pg_temp.email('gem')), 'due_on', (now() at time zone 'UTC')::date + 3)), pg_temp.rk()));
  perform pg_temp.keep('TAG', ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('TAG')::text;
  v := pg_temp.person('owner', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('TAG'),
    '{"person_reason":"send"}', pg_temp.rev('TAG')));
  perform pg_temp.chk('D-TAG', 'the first tag: the owner gets a decision, the watcher an update',
    (select string_agg(p.who || ':' || o.category_key, ',' order by p.who) from public.notification_outbox o join tz_people p on p.id = o.user_id
      where o.category_key like 'business.team_%' and o.payload->>'card_id' = pg_temp.id('TAG')::text),
    'gem:business.team_mention,ray:business.team_decision');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tz_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 20 then raise exception '#4255 rework 2 tester adversarial recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 rework 2 tester adversarial: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 rework 2 tester adversarial: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
