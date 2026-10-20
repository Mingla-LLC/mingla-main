-- Issue #3980 synced program, Wave 3 rework -- tester adversarial suite, on
-- the fully replayed PG17 schema. Different angles from the implementor's
-- rework suite. ops_auto_steps takes today only within a day of the real
-- date, so time is moved by moving a host's whole world (its promised
-- dates, its events, and its card's due date) nearer by the same number
-- of days; the day after is also run directly. The attacks are:
--   RT-D1  a monthly rolling card whose next date lies ahead moves its due
--          date forward when that date goes live (never stuck, never
--          overdue); a monthly date nobody published rolls on to the next
--          date the day after, not overdue; when all 4 kept dates are live
--          the card stays closed while the next date is still more than a
--          week from its go-live day, then opens again due exactly on that
--          go-live day; an evening event in a time zone behind UTC (its
--          start falls on the next UTC day) still counts as that week's
--          date; a run that changes nothing writes nothing; a closed card
--          of a cancelled series never opens again; a series cancelled
--          while a person is working its card closes it; a card a person
--          closed is not made again by the next run
--   RT-D2  a series switched between weekly and "Does not repeat" three
--          times by a person, through the real save, never has two open
--          cards for that host's dates and never keeps its rolling card
--          open when it no longer repeats, has one rolling card each time
--          it repeats, never says "every none", and weekly to monthly
--          re-words the rolling card
--   RT-D11 brand auto-link: the same number written in its national form
--          and with its country code links (same country); two brands that
--          share one card's number: the first links, the second gets a
--          pick card and the card keeps the first brand; two exact
--          candidates link nothing; an exact match beside a near match
--          links nothing; a near match on a Lost card links nothing and
--          leaves it Lost; a Lost exact match is asked about once, not
--          again on the next run
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
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
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create temp table rt3980_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into rt3980_people (who, id, email) values
  ('owner',  '39890000-0000-4000-a000-000000000001', 'ed.rt3980@test.local'),
  ('growth', '39890000-0000-4000-a000-000000000003', 'ada.rt3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from rt3980_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.rt3980@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.rt3980@test.local', 'growth', 'active', now());

create temp table rt3980_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table rt3980_ids (k text primary key, v text) on commit drop;

create function pg_temp.rt_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from rt3980_people where who = p_who;
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

create function pg_temp.rt_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.rt_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.rt_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into rt3980_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.rt_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.rt_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into rt3980_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;
create function pg_temp.rt_id(p_k text) returns text
language sql as $fn$ select v from rt3980_ids where k = p_k $fn$;

create function pg_temp.rt_d() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;

-- A public (or draft) event of a brand starting at an exact moment, made
-- public long before.
create function pg_temp.rt_event_at(p_key text, p_brand text, p_title text, p_start timestamptz, p_public boolean) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
  values (v_id, p_brand::uuid, p_title, 'rt3980-' || left(v_id::text, 8),
          'discover', case when p_public then 'scheduled' else 'draft' end, 'America/New_York',
          case when p_public then now() - interval '60 days' end, 'event', 'RT3980 Street 1');
  insert into public.event_dates (event_id, start_at, end_at, is_master) values (v_id, p_start, p_start + interval '3 hours', true);
  set local session_replication_role = origin;
  perform pg_temp.rt_keep(p_key, v_id::text);
end;
$fn$;

-- A public event at 20:00 UTC on a day.
create function pg_temp.rt_event(p_key text, p_brand text, p_title text, p_on date) returns void
language sql as $fn$ select pg_temp.rt_event_at(p_key, p_brand, p_title, (p_on::timestamp + interval '20 hours') AT TIME ZONE 'UTC', true) $fn$;

-- Time moves on by n days for one host: its promised dates, its events and
-- its rolling card's due date all come n days nearer.
create function pg_temp.rt_shift(p_exp text, p_brand text, p_days integer) returns void
language plpgsql as $fn$
begin
  update public.ops_expected_events set expected_on = expected_on - p_days where id = p_exp::uuid;
  update public.event_dates set start_at = start_at - make_interval(days => p_days), end_at = end_at - make_interval(days => p_days)
   where event_id in (select id from public.events where brand_id = p_brand::uuid);
  update public.events set published_at = published_at - make_interval(days => p_days) where brand_id = p_brand::uuid;
  update public.ops_work_cards set due_on = due_on - p_days where auto_key = 'series:' || p_exp;
end;
$fn$;

-- The open rolling card of a series, as "<count>/<due minus the given day>/<instructions>".
create function pg_temp.rt_series(p_exp text, p_day date) returns text
language sql as $fn$
  select count(*)::text || '/' || coalesce(min(w.due_on - p_day)::text, '') || '/' || coalesce(min(w.instructions), '')
    from public.ops_work_cards w where w.auto_key = 'series:' || p_exp and w.status <> 'done' and w.archived_at is null
$fn$;

-- Every open card for one host's promised dates (rolling or go-live).
create function pg_temp.rt_open_for(p_exp text) returns text
language sql as $fn$
  select count(*)::text || ':' || coalesce(string_agg(split_part(w.auto_key, ':', 1), ',' order by w.auto_key), '')
    from public.ops_work_cards w where w.status <> 'done' and w.archived_at is null and w.auto_key like '%' || p_exp || '%'
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at)
select ('39890000-0000-4000-b200-00000000000' || n)::uuid, ('39890000-0000-4000-b300-00000000000' || n)::uuid,
       'RT Brand ' || n, 'rt3980-brand-' || n, 'Raleigh', now() - interval '60 days'
  from generate_series(1, 9) n;
set local session_replication_role = origin;
insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by)
select ('39890000-0000-4000-c100-00000000000' || n)::uuid, 'hosts', 'RT Host ' || n, 'live',
       ('39890000-0000-4000-b200-00000000000' || n)::uuid, 'event_organizer', 'rt', 'rt'
  from generate_series(1, 9) n;
insert into public.crm_record_owners (record_id, owner_email, added_by)
select ('39890000-0000-4000-c100-00000000000' || n)::uuid, 'ada.rt3980@test.local', 'rt' from generate_series(1, 9) n;
-- 1 monthly, next date 30 days ahead   2 weekly, an evening in New York
-- 3 weekly, switched by a person       7 weekly, cancelled once closed
-- 8 monthly, a date today nobody published   6 weekly, worked then cancelled
-- 9 weekly, a card a person closes
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by) values
  ('39890000-0000-4000-d100-000000000001', '39890000-0000-4000-c100-000000000001', 'RT Monthly', 'event', pg_temp.rt_d() + 30, 'month', 'rt', 'rt'),
  ('39890000-0000-4000-d100-000000000002', '39890000-0000-4000-c100-000000000002', 'RT Friday', 'event', pg_temp.rt_d() + 3, 'week', 'rt', 'rt'),
  ('39890000-0000-4000-d100-000000000003', '39890000-0000-4000-c100-000000000003', 'RT Switch', 'event', pg_temp.rt_d() + 10, 'week', 'rt', 'rt'),
  ('39890000-0000-4000-d100-000000000006', '39890000-0000-4000-c100-000000000006', 'RT Worked', 'event', pg_temp.rt_d() + 5, 'week', 'rt', 'rt'),
  ('39890000-0000-4000-d100-000000000007', '39890000-0000-4000-c100-000000000007', 'RT Parked', 'event', pg_temp.rt_d() + 2, 'week', 'rt', 'rt'),
  ('39890000-0000-4000-d100-000000000008', '39890000-0000-4000-c100-000000000008', 'RT Missed', 'event', pg_temp.rt_d(), 'month', 'rt', 'rt'),
  ('39890000-0000-4000-d100-000000000009', '39890000-0000-4000-c100-000000000009', 'RT Closed', 'event', pg_temp.rt_d() + 4, 'week', 'rt', 'rt');
update public.ops_settings set value = 'true'::jsonb where key = 'auto_steps';

-- ---------------------------------------------------------------------------
-- RT-D1: time moves on.
-- ---------------------------------------------------------------------------
do $d1$
declare
  d date := pg_temp.rt_d();
  e1 date := pg_temp.rt_d() + 30;
  e2 date := ((pg_temp.rt_d() + 30) + interval '1 month')::date;
  e3 date := ((pg_temp.rt_d() + 30) + interval '2 months')::date;
  e4 date := ((pg_temp.rt_d() + 30) + interval '3 months')::date;
  v_card uuid; v_rev integer; c record; v jsonb;
begin
  perform public.ops_auto_steps(d, null);
  -- Monthly: the card names 30 days ahead, due 2 days ahead (30 - 28).
  perform pg_temp.rt_check('RT-D1', 'a monthly series 30 days out gets its card due on its go-live day',
    pg_temp.rt_series('39890000-0000-4000-d100-000000000001', d),
    '1/2/Repeats every month. Next date to publish: ' || public.ops_day_long(e1) || '.');
  select id into v_card from public.ops_work_cards where auto_key = 'series:39890000-0000-4000-d100-000000000001';
  perform pg_temp.rt_event('m1', '39890000-0000-4000-b200-000000000001', 'RT Monthly One', e1);
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'its first date goes live: the due date moves forward to the next date''s go-live day',
    pg_temp.rt_series('39890000-0000-4000-d100-000000000001', d),
    '1/' || ((e2 - 28) - d)::text || '/Repeats every month. Next date to publish: ' || public.ops_day_long(e2) || '.');
  -- A run that changes nothing writes nothing (no new revision, no event).
  select revision into v_rev from public.ops_work_cards where id = v_card;
  perform public.ops_auto_steps(d, null);
  perform public.ops_auto_steps(d + 1, null);
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'runs that change nothing (today and the day after) leave the card''s revision alone',
    (select revision from public.ops_work_cards where id = v_card)::text, v_rev::text);
  perform pg_temp.rt_check('RT-D1', 'and the day after it is still not overdue',
    (select (due_on > d + 1)::text from public.ops_work_cards where id = v_card), 'true');

  -- All four kept dates live: closed with the plain reason.
  perform pg_temp.rt_event('m2', '39890000-0000-4000-b200-000000000001', 'RT Monthly Two', e2);
  perform pg_temp.rt_event('m3', '39890000-0000-4000-b200-000000000001', 'RT Monthly Three', e3);
  perform pg_temp.rt_event('m4', '39890000-0000-4000-b200-000000000001', 'RT Monthly Four', e4);
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'all 4 kept dates live: the monthly card closes',
    (select status || '/' || close_kind from public.ops_work_cards where id = v_card), 'done/system');
  -- The last kept date stops being public: its go-live day is months away,
  -- so nothing opens yet.
  update public.events set deleted_at = now() where id = pg_temp.rt_id('m4')::uuid;
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'an unpublished date months away does not open the card early',
    (select status from public.ops_work_cards where id = v_card) || '/' ||
    (select count(*) from public.ops_work_cards where auto_key = 'series:39890000-0000-4000-d100-000000000001')::text, 'done/1');
  -- The first date stops being public (its go-live day is 2 days away): the
  -- same card opens again, due on that go-live day, not today.
  update public.events set deleted_at = null where id = pg_temp.rt_id('m4')::uuid;
  update public.events set deleted_at = now() where id = pg_temp.rt_id('m1')::uuid;
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'a date needing publishing within a week opens the same card, due on its go-live day',
    pg_temp.rt_series('39890000-0000-4000-d100-000000000001', d) || '/' ||
    (select count(*) from public.ops_work_cards where auto_key = 'series:39890000-0000-4000-d100-000000000001')::text,
    '1/2/Repeats every month. Next date to publish: ' || public.ops_day_long(e1) || './1');

  -- A monthly date today that nobody published rolls on the next day.
  perform pg_temp.rt_check('RT-D1', 'a monthly date today nobody published: the card is due today',
    split_part(pg_temp.rt_series('39890000-0000-4000-d100-000000000008', d), '/', 2), '0');
  perform public.ops_auto_steps(d + 1, null);
  perform pg_temp.rt_check('RT-D1', 'the next day it names next month''s date and is not overdue',
    (select (due_on >= d + 1)::text || '/' || instructions from public.ops_work_cards
      where auto_key = 'series:39890000-0000-4000-d100-000000000008' and status <> 'done'),
    'true/Repeats every month. Next date to publish: ' || public.ops_day_long((d + interval '1 month')::date) || '.');

  -- An evening event in New York starts on the next UTC day: it still
  -- stands for that week's date.
  perform pg_temp.rt_event_at('ny1', '39890000-0000-4000-b200-000000000002', 'RT Friday Night',
    ((d + 3)::timestamp + interval '21 hours') AT TIME ZONE 'America/New_York', true);
  perform pg_temp.rt_check('RT-D1', 'the New York evening starts on the next UTC day',
    ((select start_at from public.event_dates where event_id = pg_temp.rt_id('ny1')::uuid) AT TIME ZONE 'UTC')::date::text, (d + 4)::text);
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'and still counts as that week''s date: the card names the week after',
    split_part(pg_temp.rt_series('39890000-0000-4000-d100-000000000002', d), '/', 3),
    'Repeats every week. Next date to publish: ' || public.ops_day_long(d + 10) || '.');

  -- A closed card of a cancelled series never opens again.
  perform pg_temp.rt_event('p1', '39890000-0000-4000-b200-000000000007', 'RT Parked One', d + 2);
  perform pg_temp.rt_event('p2', '39890000-0000-4000-b200-000000000007', 'RT Parked Two', d + 9);
  perform pg_temp.rt_event('p3', '39890000-0000-4000-b200-000000000007', 'RT Parked Three', d + 16);
  perform pg_temp.rt_event('p4', '39890000-0000-4000-b200-000000000007', 'RT Parked Four', d + 23);
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'a weekly series with all 4 dates live has no open card',
    split_part(pg_temp.rt_series('39890000-0000-4000-d100-000000000007', d), '/', 1), '0');
  update public.ops_expected_events set status = 'cancelled', cancel_reason = 'RT stopped' where id = '39890000-0000-4000-d100-000000000007';
  perform pg_temp.rt_shift('39890000-0000-4000-d100-000000000007', '39890000-0000-4000-b200-000000000007', 8);
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'cancelled while closed: a week later (a new date in the window) nothing opens',
    pg_temp.rt_open_for('39890000-0000-4000-d100-000000000007'), '0:');

  -- Cancelled while a person is working its card.
  update public.ops_work_cards set status = 'doing' where auto_key = 'series:39890000-0000-4000-d100-000000000006' and status <> 'done';
  update public.ops_expected_events set status = 'cancelled', cancel_reason = 'RT host stopped' where id = '39890000-0000-4000-d100-000000000006';
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D1', 'a series cancelled while its card is in progress closes the card',
    (select string_agg(status || '/' || close_reason, ',') from public.ops_work_cards where auto_key = 'series:39890000-0000-4000-d100-000000000006'),
    'done/Event cancelled.');

  -- A card a person closed is not made again by the next run.
  update public.ops_work_cards set status = 'done', close_kind = 'done', close_reason = 'RT handled by hand', closed_at = now(),
         closed_by = 'ada.rt3980@test.local', closed_via = NULL
   where auto_key = 'series:39890000-0000-4000-d100-000000000009' and status <> 'done';
  perform public.ops_auto_steps(d, null);
  perform public.ops_auto_steps(d + 1, null);
  perform pg_temp.rt_check('RT-D1', 'a rolling card a person closed is not made or opened again by the next runs',
    pg_temp.rt_open_for('39890000-0000-4000-d100-000000000009') || '/' ||
    (select count(*) from public.ops_work_cards where auto_key = 'series:39890000-0000-4000-d100-000000000009')::text, '0:/1');
end;
$d1$;

-- ---------------------------------------------------------------------------
-- RT-D2: a person switches a series back and forth through the real save.
-- ---------------------------------------------------------------------------
do $d2$
declare d date := pg_temp.rt_d(); v text; i integer;
begin
  perform public.ops_auto_steps(d, null);
  perform pg_temp.rt_check('RT-D2', 'the weekly series starts with its one rolling card',
    pg_temp.rt_open_for('39890000-0000-4000-d100-000000000003'), '1:series');
  for i in 1..3 loop
    v := pg_temp.rt_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
           jsonb_build_object('record_id', '39890000-0000-4000-c100-000000000003', 'id', '39890000-0000-4000-d100-000000000003',
                              'repeats', 'none', 'expected_on', (d + 40)::text), 'rt-d2-none-000' || i));
    perform pg_temp.rt_check('RT-D2', format('switch %s to "Does not repeat": saved', i), pg_temp.rt_j(v)->>'status', 'updated');
    -- Never two open cards for one host's dates. (Whether the go-live card
    -- comes back after the first round trip is a separate finding: the
    -- closed go-live card of the earlier round blocks a new one.)
    perform pg_temp.rt_check('RT-D2', format('switch %s to "Does not repeat": no rolling card stays open, never two cards', i),
      (split_part(pg_temp.rt_open_for('39890000-0000-4000-d100-000000000003'), ':', 1)::integer <= 1
       and pg_temp.rt_open_for('39890000-0000-4000-d100-000000000003') not like '%series%')::text, 'true');
    if i = 1 then
      perform pg_temp.rt_check('RT-D2', 'the first switch to "Does not repeat" leaves the go-live card',
        pg_temp.rt_open_for('39890000-0000-4000-d100-000000000003'), '1:golive');
    end if;
    v := pg_temp.rt_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
           jsonb_build_object('record_id', '39890000-0000-4000-c100-000000000003', 'id', '39890000-0000-4000-d100-000000000003',
                              'repeats', 'week', 'expected_on', (d + 10)::text), 'rt-d2-week-000' || i));
    perform pg_temp.rt_check('RT-D2', format('switch %s back to weekly: saved', i), pg_temp.rt_j(v)->>'status', 'updated');
    perform pg_temp.rt_check('RT-D2', format('switch %s back to weekly: one open card, the rolling card', i),
      pg_temp.rt_open_for('39890000-0000-4000-d100-000000000003'), '1:series');
  end loop;
  perform pg_temp.rt_check('RT-D2', 'no card anywhere says "every none"',
    (select count(*) from public.ops_work_cards where instructions ilike '%every none%' or close_reason ilike '%every none%')::text, '0');
  v := pg_temp.rt_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39890000-0000-4000-c100-000000000003', 'id', '39890000-0000-4000-d100-000000000003',
                            'repeats', 'month', 'expected_on', (d + 10)::text), 'rt-d2-month-0001'));
  perform pg_temp.rt_check('RT-D2', 'weekly to monthly: still one rolling card, now saying every month',
    pg_temp.rt_series('39890000-0000-4000-d100-000000000003', d),
    '1/0/Repeats every month. Next date to publish: ' || public.ops_day_long(d + 10) || '.');
end;
$d2$;

-- ---------------------------------------------------------------------------
-- RT-D11: brand auto-link.
-- ---------------------------------------------------------------------------
do $d11$
declare v jsonb;
begin
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('39890000-0000-4000-c200-000000000001', 'hosts', 'RT National Form', 'contacted', 'rt', 'rt'),
    ('39890000-0000-4000-c200-000000000003', 'hosts', 'RT Shared Number', 'contacted', 'rt', 'rt'),
    ('39890000-0000-4000-c200-000000000004', 'hosts', 'RT Two A', 'contacted', 'rt', 'rt'),
    ('39890000-0000-4000-c200-000000000005', 'hosts', 'RT Two B', 'contacted', 'rt', 'rt'),
    ('39890000-0000-4000-c200-000000000006', 'hosts', 'RT Exact Beside', 'contacted', 'rt', 'rt'),
    ('39890000-0000-4000-c200-000000000007', 'hosts', 'RT Near Beside', 'contacted', 'rt', 'rt');
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by) values
    ('39890000-0000-4000-c200-000000000008', 'hosts', 'RT Lost Exact', 'lost', 'Not now', 'rt', 'rt'),
    ('39890000-0000-4000-c200-000000000009', 'hosts', 'RT Lost Near', 'lost', 'Not now', 'rt', 'rt');
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
  select r::uuid, k, val, public.crm_ident_key(k, val), 'rt' from (values
    ('39890000-0000-4000-c200-000000000001', 'phone', '0809 111 2299'),
    ('39890000-0000-4000-c200-000000000003', 'phone', '+2348033334499'),
    ('39890000-0000-4000-c200-000000000004', 'email', 'two@rt3980.test'),
    ('39890000-0000-4000-c200-000000000005', 'phone', '+2348055556699'),
    ('39890000-0000-4000-c200-000000000006', 'email', 'beside@rt3980.test'),
    ('39890000-0000-4000-c200-000000000007', 'phone', '+2348077778899'),
    ('39890000-0000-4000-c200-000000000008', 'email', 'lost@rt3980.test'),
    ('39890000-0000-4000-c200-000000000009', 'phone', '+2348099990099')) t(r, k, val);
  update public.ops_settings set value = 'true'::jsonb where key = 'brand_auto_cards';
  update public.ops_settings set value = to_jsonb(now() - interval '1 hour') where key = 'brand_auto_since';
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, contact_email, contact_phone, created_at) values
    ('39890000-0000-4000-b500-000000000001', '39890000-0000-4000-b600-000000000001', 'RT Same Country', 'rt3980-same-country', 'Lagos', null, '+234 809 111 2299', now() - interval '50 minutes'),
    ('39890000-0000-4000-b500-000000000002', '39890000-0000-4000-b600-000000000002', 'RT Share First', 'rt3980-share-first', 'Lagos', null, '+234 803 333 4499', now() - interval '40 minutes'),
    ('39890000-0000-4000-b500-000000000003', '39890000-0000-4000-b600-000000000003', 'RT Share Second', 'rt3980-share-second', 'Lagos', null, '+2348033334499', now() - interval '30 minutes'),
    ('39890000-0000-4000-b500-000000000004', '39890000-0000-4000-b600-000000000004', 'RT Two Matches', 'rt3980-two-matches', 'Lagos', 'TWO@rt3980.test', '+234 805 555 6699', now() - interval '20 minutes'),
    ('39890000-0000-4000-b500-000000000005', '39890000-0000-4000-b600-000000000005', 'RT Exact And Near', 'rt3980-exact-near', 'Lagos', 'beside@rt3980.test', '7778899', now() - interval '15 minutes'),
    ('39890000-0000-4000-b500-000000000006', '39890000-0000-4000-b600-000000000006', 'RT Lost Exact Brand', 'rt3980-lost-exact', 'Lagos', 'lost@rt3980.test', null, now() - interval '10 minutes'),
    ('39890000-0000-4000-b500-000000000007', '39890000-0000-4000-b600-000000000007', 'RT Lost Near Brand', 'rt3980-lost-near', 'Lagos', null, '9990099', now() - interval '5 minutes');
  set local session_replication_role = origin;
  v := public.ops_brand_autolink();
  perform pg_temp.rt_check('RT-D11', 'the same Nigerian number, national form on the card and +234 on the brand, links',
    (select coalesce(brand_id::text, 'none') from public.crm_records where id = '39890000-0000-4000-c200-000000000001'),
    '39890000-0000-4000-b500-000000000001');
  perform pg_temp.rt_check('RT-D11', 'two brands share one card''s number: the card keeps the first brand',
    (select coalesce(brand_id::text, 'none') from public.crm_records where id = '39890000-0000-4000-c200-000000000003'),
    '39890000-0000-4000-b500-000000000002');
  perform pg_temp.rt_check('RT-D11', 'and the second brand gets a pick card naming that card, linking nothing',
    (select count(*) from public.ops_work_cards w join public.ops_work_links l on l.card_id = w.id and l.kind = 'host'
      where w.auto_key = 'brand_pick:39890000-0000-4000-b500-000000000003' and w.status <> 'done'
        and l.target_id = '39890000-0000-4000-c200-000000000003')::text || '/' ||
    (select count(*) from public.crm_records where brand_id = '39890000-0000-4000-b500-000000000003')::text, '1/0');
  perform pg_temp.rt_check('RT-D11', 'two exact candidates (email on one, phone on the other) link nothing and make one pick card',
    (select count(*) from public.crm_records where brand_id = '39890000-0000-4000-b500-000000000004')::text || '/' ||
    (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39890000-0000-4000-b500-000000000004' and status <> 'done')::text, '0/1');
  perform pg_temp.rt_check('RT-D11', 'an exact email beside a near phone match links nothing; both cards are offered',
    (select count(*) from public.crm_records where brand_id = '39890000-0000-4000-b500-000000000005')::text || '/' ||
    (select count(*) from public.ops_work_links l join public.ops_work_cards w on w.id = l.card_id
      where w.auto_key = 'brand_pick:39890000-0000-4000-b500-000000000005' and l.kind = 'host'
        and l.target_id in ('39890000-0000-4000-c200-000000000006', '39890000-0000-4000-c200-000000000007'))::text, '0/2');
  perform pg_temp.rt_check('RT-D11', 'a near match on a Lost card links nothing and leaves it Lost',
    (select coalesce(brand_id::text, 'none') || '/' || stage from public.crm_records where id = '39890000-0000-4000-c200-000000000009'), 'none/lost');
  perform pg_temp.rt_check('RT-D11', 'a Lost exact match is not linked and is asked about',
    (select coalesce(brand_id::text, 'none') || '/' || stage from public.crm_records where id = '39890000-0000-4000-c200-000000000008') || '/' ||
    (select count(*) from public.ops_work_cards where auto_key = 'brand_lost:39890000-0000-4000-b500-000000000006' and status <> 'done')::text,
    'none/lost/1');
  v := public.ops_brand_autolink();
  v := public.ops_brand_autolink();
  perform pg_temp.rt_check('RT-D11', 'two more runs make no second card for any of these brands',
    (select count(*) from public.ops_work_cards where auto_key ~ '^brand_(pick|lost):39890000-0000-4000-b500')::text, '5');
  perform pg_temp.rt_check('RT-D11', 'and no brand is ever linked to a Lost card',
    (select count(*) from public.crm_records where stage = 'lost' and brand_id is not null and name like 'RT %')::text, '0');
end;
$d11$;

select count(*) as rt_total, count(*) filter (where not ok) as rt_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as rt_failures
  from rt3980_results \gset
rollback;

select (:rt_total < 30 or :rt_failed > 0) as rt_bad \gset
\if :rt_bad
  \echo 'ISSUE-3980 SYNCED WAVE 3 REWORK TESTER FAILED:' :rt_failed 'of' :rt_total
  \echo :rt_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 3 REWORK TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 3 REWORK TESTER PASS:' :rt_total 'checks, 0 failed'
