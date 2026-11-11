-- Issue #4255 rework 2 -- implementor suite for
-- 20280614064255_issue_4255_team_rework2.sql, on the fully replayed PG17
-- schema (Retest 1 FAIL at 714b61e4e4).
--
--   R2-DECIDE  P2: a tag change asks only the card's OWNERS to decide
--              (business.team_decision); a watcher of the same change gets
--              the plain update push (business.team_mention, work_update).
--              P3: the decision is the tag-change event, never the words: a
--              note ending in "· You send" or "· Needs your OK" is a mention.
--   R2-TZ      P1: team_set_my_timezone saves the device zone on the signed-in
--              staff member's profile only when empty or different; refuses
--              anon, signed-out calls and unknown or posix zones; answers a
--              host who is not staff {staff:false} and writes nothing.
--              Retest target: a Lagos-only staff account (no zone before)
--              saves Africa/Lagos and gets the due notice at 09:00 Lagos,
--              not at 09:00 New York.
--
-- FAILS-ON-REVERT (each proved by deleting the line from the migration and
-- re-running this suite on a fresh replay; see the #4255 rework 2 evidence):
--   * ops_notify_people: the "w.role = 'owner'" owner filter (R2-DECIDE watcher)
--   * ops_notify_people: v_tag_set from the event snapshots, back to the
--     text match (R2-DECIDE note)
--   * team_set_my_timezone: the pg_timezone_names check (R2-TZ unknown zone)
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null, tz text) on commit drop;
insert into tx_people (who, id, email, tz) values
  ('owner', '4255c000-0000-4000-a0f3-000000000001', 'oz.r24255@test.local',   'America/New_York'),
  ('ray',   '4255c000-0000-4000-a0f3-000000000002', 'ray.r24255@test.local',  null),
  ('gem',   '4255c000-0000-4000-a0f3-000000000003', 'gem.r24255@test.local',  'America/New_York'),
  ('host',  '4255c000-0000-4000-a0f3-000000000004', 'host.r24255@test.local', null);
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('oz.r24255@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who not in ('owner', 'host');
insert into public.profiles (id, timezone) select id, tz from tx_people
on conflict (id) do update set timezone = excluded.timezone;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tx_people where who = p_who;
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
create function pg_temp.agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tx_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from tx_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tx_ids where k = p_k) $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 'r2-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.add(p_k text, p_title text, p_owner text, p_watcher text default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'owners', jsonb_build_array(p_owner), 'due_on', (now() at time zone 'UTC')::date + 3);
  if p_watcher is not null then v_item := v_item || jsonb_build_object('watchers', jsonb_build_array(p_watcher)); end if;
  v := pg_temp.person('owner', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.tag(p_k text, p_reason text) returns text
language sql as $fn$
  select pg_temp.person('owner', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id(p_k),
    jsonb_build_object('person_reason', p_reason), pg_temp.rev(p_k)))
$fn$;
create function pg_temp.at_local(p_zone text, p_day date, p_time time) returns timestamptz
language sql as $fn$ select (p_day + p_time) at time zone p_zone $fn$;
create function pg_temp.tz(p_who text) returns text
language sql as $fn$ select coalesce(p.timezone, '<null>') from public.profiles p where p.id = (select id from tx_people where who = p_who) $fn$;

-- ───────────────────────────── R2-DECIDE ─────────────────────────────
do $t$
declare v text;
begin
  -- Ray owns, Gem watches. The owner (oz) tags the card Send.
  v := pg_temp.add('DW', 'R24255 Decide watched card', pg_temp.email('ray'), pg_temp.email('gem'));
  perform pg_temp.chk('R2-DECIDE', 'control: the card was added', (v::jsonb)->'results'->0->>'status', 'added');
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('DW')::text;
  v := pg_temp.tag('DW', 'send');
  perform pg_temp.chk('R2-DECIDE', 'the owner gets exactly one decision push',
    (select count(*)::text from public.notification_outbox o where o.user_id = pg_temp.uid('ray')
      and o.category_key = 'business.team_decision' and o.payload->>'card_id' = pg_temp.id('DW')::text), '1');
  perform pg_temp.chk('R2-DECIDE', 'a watcher gets no decision push',
    (select count(*)::text from public.notification_outbox o where o.user_id = pg_temp.uid('gem')
      and o.category_key = 'business.team_decision' and o.payload->>'card_id' = pg_temp.id('DW')::text), '0');
  perform pg_temp.chk('R2-DECIDE', 'the watcher keeps the plain update push (business.team_mention, work_update)',
    (select string_agg(o.category_key || '/' || (o.payload->>'reason'), ',') from public.notification_outbox o where o.user_id = pg_temp.uid('gem')
      and o.category_key like 'business.team_%' and o.payload->>'card_id' = pg_temp.id('DW')::text), 'business.team_mention/work_update');

  -- Notes whose words end like a tag are mentions, for owner and watcher alike.
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('DW')::text;
  v := pg_temp.person('owner', format($q$select public.ops_message_post(%L, 'Ray, the deck is ready · You send', array[%L, %L], null, null, false, %L)::text$q$,
    pg_temp.id('DW'), pg_temp.email('ray'), pg_temp.email('gem'), pg_temp.rk()));
  perform pg_temp.chk('R2-DECIDE', 'a note ending in "· You send" is a mention for the owner',
    (select string_agg(o.category_key || '/' || (o.payload->>'reason'), ',') from public.notification_outbox o where o.user_id = pg_temp.uid('ray')
      and o.category_key like 'business.team_%' and o.payload->>'card_id' = pg_temp.id('DW')::text), 'business.team_mention/mention');
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('DW')::text;
  v := pg_temp.person('owner', format($q$select public.ops_message_post(%L, 'Over to you · Needs your OK', array[%L], null, null, false, %L)::text$q$,
    pg_temp.id('DW'), pg_temp.email('ray'), pg_temp.rk()));
  perform pg_temp.chk('R2-DECIDE', 'a note ending in "· Needs your OK" is a mention too',
    (select string_agg(o.category_key, ',') from public.notification_outbox o where o.user_id = pg_temp.uid('ray')
      and o.category_key like 'business.team_%' and o.payload->>'card_id' = pg_temp.id('DW')::text), 'business.team_mention');

  -- Taking the tag off is not a decision; putting it back on is.
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('DW')::text;
  v := pg_temp.tag('DW', null);
  perform pg_temp.chk('R2-DECIDE', 'taking the tag off asks nobody to decide',
    (select count(*)::text from public.notification_outbox o where o.category_key = 'business.team_decision'
      and o.payload->>'card_id' = pg_temp.id('DW')::text), '0');
  v := pg_temp.tag('DW', 'publish');
  perform pg_temp.chk('R2-DECIDE', 'putting a tag back on asks the owner again, still not the watcher',
    (select coalesce(string_agg(p.who, ',' order by p.who), 'nobody') from public.notification_outbox o join tx_people p on p.id = o.user_id
      where o.category_key = 'business.team_decision' and o.payload->>'card_id' = pg_temp.id('DW')::text), 'ray');
end;
$t$;

-- ───────────────────────────── R2-TZ ─────────────────────────────
do $t$
declare v text; v_d date := (now() at time zone 'Africa/Lagos')::date;
begin
  perform pg_temp.chk('R2-TZ', 'control: Ray has no time zone yet', pg_temp.tz('ray'), '<null>');
  perform pg_temp.lk('R2-TZ', 'anon cannot call it',
    pg_temp.as_anon($q$select public.team_set_my_timezone('Africa/Lagos')::text$q$), 'ERR:42501:%');
  perform pg_temp.lk('R2-TZ', 'an unknown zone is refused',
    pg_temp.person('ray', $q$select public.team_set_my_timezone('Not/AZone')::text$q$), 'ERR:22023:%');
  perform pg_temp.lk('R2-TZ', 'a posix zone is refused',
    pg_temp.person('ray', $q$select public.team_set_my_timezone('posix/Africa/Lagos')::text$q$), 'ERR:22023:%');
  perform pg_temp.lk('R2-TZ', 'an empty zone is refused',
    pg_temp.person('ray', $q$select public.team_set_my_timezone('  ')::text$q$), 'ERR:22023:%');
  perform pg_temp.chk('R2-TZ', 'nothing was written by the refusals', pg_temp.tz('ray'), '<null>');

  v := pg_temp.person('ray', $q$select public.team_set_my_timezone(' Africa/Lagos ')::text$q$);
  perform pg_temp.chk('R2-TZ', 'an empty zone is filled from the device', v, '{"staff": true, "changed": true, "timezone": "Africa/Lagos"}');
  perform pg_temp.chk('R2-TZ', 'the profile now reads Africa/Lagos', pg_temp.tz('ray'), 'Africa/Lagos');
  v := pg_temp.person('ray', $q$select public.team_set_my_timezone('Africa/Lagos')::text$q$);
  perform pg_temp.chk('R2-TZ', 'the same zone again writes nothing', (v::jsonb)->>'changed', 'false');
  v := pg_temp.person('gem', $q$select public.team_set_my_timezone('Europe/London')::text$q$);
  perform pg_temp.chk('R2-TZ', 'a different zone replaces the old one', (v::jsonb)->>'changed' || '/' || pg_temp.tz('gem'), 'true/Europe/London');
  v := pg_temp.person('host', $q$select public.team_set_my_timezone('Africa/Lagos')::text$q$);
  perform pg_temp.chk('R2-TZ', 'a host who is not staff is answered staff:false', (v::jsonb)->>'staff', 'false');
  perform pg_temp.chk('R2-TZ', 'and the host''s profile is untouched', pg_temp.tz('host'), '<null>');
  perform pg_temp.lk('R2-TZ', 'nobody can write someone else''s zone (no such argument)',
    pg_temp.person('ray', format($q$select public.team_set_my_timezone('Asia/Tokyo', %L)::text$q$, pg_temp.uid('gem'))), 'ERR:42883:%');

  -- Retest target: Ray (Lagos only) owns a card due today. Told at 09:00
  -- Lagos, not at 09:00 New York.
  v := pg_temp.person('owner', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', 'R24255 Due today', 'instructions', 'Do the work carefully and say what changed.',
      'done_means', 'It is done and checked.', 'owners', jsonb_build_array(pg_temp.email('ray')), 'due_on', v_d)), pg_temp.rk()));
  perform pg_temp.chk('R2-TZ', 'control: the due card was added', (v::jsonb)->'results'->0->>'status', 'added');
  delete from public.team_mentions where source_kind = 'work_due';
  perform public.ops_due_digest(pg_temp.at_local('America/New_York', v_d, '09:10'));
  perform pg_temp.chk('R2-TZ', 'at 09:10 New York, Ray in Lagos is not told',
    (select count(*)::text from public.team_mentions tm where tm.source_kind = 'work_due' and tm.target_user_id = pg_temp.uid('ray')), '0');
  perform public.ops_due_digest(pg_temp.at_local('Africa/Lagos', v_d, '09:10'));
  perform pg_temp.chk('R2-TZ', 'at 09:10 Lagos, Ray is told once, with a due push',
    (select count(*)::text from public.notification_outbox o where o.user_id = pg_temp.uid('ray') and o.category_key = 'business.team_due'
      and o.payload->>'mention_id' in (select tm.id::text from public.team_mentions tm where tm.source_kind = 'work_due' and tm.target_user_id = pg_temp.uid('ray'))), '1');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 20 then raise exception '#4255 rework 2 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 rework 2 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 rework 2 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
