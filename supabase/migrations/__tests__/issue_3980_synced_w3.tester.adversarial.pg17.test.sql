-- Issue #3980 synced program, Wave 3 -- tester adversarial suite, on the
-- fully replayed PG17 schema. Different angles from the implementor's suite:
--   T-OFF     with both switches off (and brand cards once switched on and
--             off again) nothing is made, linked or carded; only the owner
--             switches; nobody writes the follow-through time directly; a
--             signed-in person cannot run the automatic jobs
--   T-ONCE    switching automatic steps on records the X3 time once: off
--             and on again never moves it; a promise saved while off gets
--             its steps on the first run after switch-on
--   T-REDATE  a moved event re-dates its steps in every open status (to do,
--             in progress, waiting for a person, blocked) and keeps the
--             status; a closed card and a typed due date are never moved
--   T-CANCEL  a cancelled or removed event closes every open step in every
--             status with "Event cancelled."; a person's close is kept
--   T-REPEAT  a repeating host keeps exactly 4 dates (month ends, long gaps,
--             count bounds), one rolling step, a published date shown once,
--             and the rolling step closes when the series is cancelled
--   T-PROMO   a venue's promo moment behaves like an event: go-live step at
--             once, Not live yet, Too late past the 3-week line, stood for by
--             its public event, then a giveaway step
--   T-BRAND   auto-link with letter case and spaces, a national phone, a card
--             already linked elsewhere, a partial email, a name differing in
--             case and spaces, a creator-only match and two matching cards;
--             one card for every brand (with or without an event), once,
--             25 a run, and nothing while switched off
--   T-X3      follow-through at the exact switch-on boundary for merges,
--             Done moves and pushes, never revived later
--   T-ATT     Needs attention counts equal its lists before and after changes
--             between reads; a person card is never "no owner"; a closed card
--             is never overdue
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

create temp table t3980w3t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w3t_people (who, id, email) values
  ('owner',  '39870000-0000-4000-a000-000000000001', 'ed.w3t3980@test.local'),
  ('admin',  '39870000-0000-4000-a000-000000000002', 'di.w3t3980@test.local'),
  ('growth', '39870000-0000-4000-a000-000000000003', 'ada.w3t3980@test.local'),
  ('mkt',    '39870000-0000-4000-a000-000000000004', 'bo.w3t3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w3t_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3t3980@test.local', 'owner', 'active', now()),
  ('di.w3t3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3t3980@test.local', 'growth', 'active', now()),
  ('bo.w3t3980@test.local', 'growth', 'active', now());

create temp table t3980w3t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980w3t_ids (k text primary key, v text) on commit drop;

create function pg_temp.w3t_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w3t_people where who = p_who;
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
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
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

create function pg_temp.w3t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w3t_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3t_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w3t_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.w3t_id(p_k text) returns text
language sql as $fn$ select v from t3980w3t_ids where k = p_k $fn$;

create function pg_temp.w3t_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980w3t_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

create function pg_temp.w3t_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.w3t_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.w3t_next_request();
  return pg_temp.w3t_as(p_who, p_sql);
end;
$fn$;

-- Day 0 is today at 00:00 UTC; an event starts at 20:00 UTC on day N and went
-- public L days and one hour before that (lead = L days).
create function pg_temp.w3t_day(p_n integer) returns timestamptz
language sql as $fn$ select (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => p_n, hours => 20) $fn$;

create function pg_temp.w3t_event(p_key text, p_brand text, p_title text, p_vis text, p_status text, p_day integer, p_lead integer) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
  values (v_id, p_brand::uuid, p_title, 'w3t3980-' || lower(regexp_replace(p_title, '[^A-Za-z0-9]+', '-', 'g')) || '-' || left(v_id::text, 8),
          p_vis, p_status, 'UTC',
          case when p_lead is null then null else pg_temp.w3t_day(p_day) - make_interval(days => p_lead, hours => 1) end,
          'event', 'W3T3980 Street 1');
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  values (v_id, pg_temp.w3t_day(p_day), pg_temp.w3t_day(p_day) + interval '3 hours', true);
  set local session_replication_role = origin;
  perform pg_temp.w3t_keep(p_key, v_id::text);
end;
$fn$;

-- The open automatic card of a key, as "<count>/<title>/<due offset>/<owners>".
create function pg_temp.w3t_card(p_key text) returns text
language sql as $fn$
  select count(*)::text || '/' || coalesce(min(w.title), '') || '/' || coalesce(min(w.due_on - (now() AT TIME ZONE 'UTC')::date)::text, '') || '/'
         || coalesce(min((select string_agg(p.email, ',' order by p.email) from public.ops_work_people p where p.card_id = w.id and p.role = 'owner')), '')
    from public.ops_work_cards w where w.auto_key = p_key and w.status <> 'done' and w.archived_at is null
$fn$;

create function pg_temp.w3t_auto_count() returns integer
language sql as $fn$
  select count(*)::integer from public.ops_work_cards w
   where w.auto_key ~ '^(golive|promo|recap|ask|series|brand_pick):' and w.archived_at is null
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures (all rolled back).
-- ---------------------------------------------------------------------------
select pg_temp.w3t_keep('today', ((now() AT TIME ZONE 'UTC')::date)::text);
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at) values
  ('39870000-0000-4000-b200-000000000001', '39870000-0000-4000-b300-000000000001', 'W3T Status Brand', 'w3t-status-brand', 'Lagos', now() - interval '60 days'),
  ('39870000-0000-4000-b200-000000000002', '39870000-0000-4000-b300-000000000002', 'W3T Weekly Brand', 'w3t-weekly-brand', 'London', now() - interval '60 days'),
  ('39870000-0000-4000-b200-000000000003', '39870000-0000-4000-b300-000000000003', 'W3T Venue Brand', 'w3t-venue-brand', 'Lagos', now() - interval '60 days');
set local session_replication_role = origin;
insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by) values
  ('39870000-0000-4000-c100-000000000001', 'hosts', 'W3T Status Host', 'live', '39870000-0000-4000-b200-000000000001', 'event_organizer', 'w3t', 'w3t'),
  ('39870000-0000-4000-c100-000000000002', 'hosts', 'W3T Weekly Host', 'live', '39870000-0000-4000-b200-000000000002', 'event_organizer', 'w3t', 'w3t'),
  ('39870000-0000-4000-c100-000000000003', 'hosts', 'W3T Venue Host', 'onboarded', '39870000-0000-4000-b200-000000000003', 'restaurant_bar', 'w3t', 'w3t');
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('39870000-0000-4000-c100-000000000004', 'hosts', 'W3T Replied Host', 'replied', 'w3t', 'w3t');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39870000-0000-4000-c100-000000000001', 'ada.w3t3980@test.local', 'w3t'),
  ('39870000-0000-4000-c100-000000000002', 'ada.w3t3980@test.local', 'w3t'),
  ('39870000-0000-4000-c100-000000000003', 'ada.w3t3980@test.local', 'w3t');

-- Six drafts whose go-live cards are put in every status; a public event
-- with a giveaway card; one that is removed.
select pg_temp.w3t_event('s_todo',    '39870000-0000-4000-b200-000000000001', 'W3T Todo Night',     'draft',    'draft',     40, null),
       pg_temp.w3t_event('s_doing',   '39870000-0000-4000-b200-000000000001', 'W3T Doing Night',    'draft',    'draft',     41, null),
       pg_temp.w3t_event('s_person',  '39870000-0000-4000-b200-000000000001', 'W3T Person Night',   'draft',    'draft',     42, null),
       pg_temp.w3t_event('s_blocked', '39870000-0000-4000-b200-000000000001', 'W3T Blocked Night',  'draft',    'draft',     43, null),
       pg_temp.w3t_event('s_done',    '39870000-0000-4000-b200-000000000001', 'W3T Done Night',     'draft',    'draft',     44, null),
       pg_temp.w3t_event('s_expl',    '39870000-0000-4000-b200-000000000001', 'W3T Explicit Night', 'draft',    'draft',     45, null),
       pg_temp.w3t_event('s_promo',   '39870000-0000-4000-b200-000000000001', 'W3T Promo Night',    'discover', 'scheduled', 36, 32),
       pg_temp.w3t_event('s_gone',    '39870000-0000-4000-b200-000000000001', 'W3T Removed Night',  'draft',    'draft',     46, null);

-- A weekly series from day 10 (dates 10, 17, 24, 31).
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by)
values ('39870000-0000-4000-d100-000000000001', '39870000-0000-4000-c100-000000000002', 'W3T Weekly Supper', 'event',
        (now() AT TIME ZONE 'UTC')::date + 10, 'week', 'w3t', 'w3t');

-- A brand made after brand cards were once switched on (the switch is off
-- again): it must stay untouched while the switch is off.
update public.ops_settings set value = to_jsonb(now() - interval '1 day') where key = 'brand_auto_since';
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, contact_email, created_at) values
  ('39870000-0000-4000-b400-000000000099', '39870000-0000-4000-b300-000000000099', 'W3T Off Brand', 'w3t-off-brand', 'Lagos', 'off@w3t3980.test', now());
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- T-OFF: nothing is made while the switches are off, and the switches are
-- the owner's alone.
-- ---------------------------------------------------------------------------
do $off$
declare v text; v_today date := pg_temp.w3t_id('today')::date; v_res jsonb;
begin
  v_res := public.ops_reconcile();
  perform pg_temp.w3t_check('T-OFF', 'reconcile with drafts, a series and a Replied host makes no automatic card', pg_temp.w3t_auto_count()::text, '0');
  perform pg_temp.w3t_check('T-OFF', 'and reports no automatic-steps result', coalesce(v_res->>'auto_steps', 'null'), 'null');
  perform pg_temp.w3t_check('T-OFF', 'a brand made after an earlier switch-on is not linked or carded while brand cards are off',
    (select count(*) from public.crm_records where brand_id = '39870000-0000-4000-b400-000000000099')::text
      || '/' || coalesce(v_res->>'brand_autolink', 'null'), '0/null');
  v := pg_temp.w3t_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39870000-0000-4000-c100-000000000004', 'title', 'W3T Off Promise', 'event_type', 'event',
                       'expected_on', v_today + 60), 'w3t-off-promise-1'));
  perform pg_temp.w3t_check('T-OFF', 'a person saving a promise while off makes no step', (pg_temp.w3t_j(v)->>'status') || '/' || coalesce(pg_temp.w3t_j(v)->>'steps', 'null') || '/' || pg_temp.w3t_auto_count(), 'created/null/0');
  perform pg_temp.w3t_keep('x_off', pg_temp.w3t_j(v)->'expected'->>'id');

  perform pg_temp.w3t_like('T-OFF', 'an admin who is not the owner cannot switch automatic steps on',
    pg_temp.w3t_person('admin', 'select public.ops_setting_set(''auto_steps'', ''true''::jsonb)::text'), 'ERR:42501:%');
  perform pg_temp.w3t_like('T-OFF', 'nobody can write the follow-through start time directly',
    pg_temp.w3t_person('owner', format('select public.ops_setting_set(''follow_through_since'', %L::jsonb)::text', to_jsonb('2020-01-01T00:00:00Z'::text))),
    'ERR:22023:invalid_setting: That switch does not exist.');
  perform pg_temp.w3t_like('T-OFF', 'a switch takes only true or false', pg_temp.w3t_person('owner', 'select public.ops_setting_set(''auto_steps'', ''"true"''::jsonb)::text'), 'ERR:22023:%');
  v := pg_temp.w3t_person('owner', 'select public.ops_setting_set(''auto_steps'', ''false''::jsonb)::text');
  perform pg_temp.w3t_check('T-OFF', 'switching automatic steps OFF records no follow-through time',
    (select value::text from public.ops_settings where key = 'follow_through_since'), 'null');
  perform pg_temp.w3t_like('T-OFF', 'a signed-in person cannot run automatic steps themselves',
    pg_temp.w3t_as('growth', 'select public.ops_auto_steps(null, null)::text'), 'ERR:42501:%');
  perform pg_temp.w3t_like('T-OFF', 'nor the brand auto-link',
    pg_temp.w3t_as('owner', 'select public.ops_brand_autolink()::text'), 'ERR:42501:%');
end;
$off$;

-- ---------------------------------------------------------------------------
-- T-ONCE: switching on records the X3 time once; off and on again keeps it.
-- ---------------------------------------------------------------------------
do $once$
declare v text; v_first text;
begin
  v := pg_temp.w3t_person('owner', 'select public.ops_setting_set(''auto_steps'', ''true''::jsonb)::text');
  v_first := (select value #>> '{}' from public.ops_settings where key = 'follow_through_since');
  perform pg_temp.w3t_check('T-ONCE', 'switching on records when follow-through starts',
    (public.ops_try_timestamptz(v_first) is not null and public.ops_try_timestamptz(v_first) <= now())::text, 'true');
  perform pg_temp.w3t_check('T-ONCE', 'the settings the screen reads show the same time',
    pg_temp.w3t_j(v)->'settings'->>'follow_through_since', v_first);
  -- Pretend it was switched on long ago, then off and on again.
  update public.ops_settings set value = to_jsonb('2026-01-05T10:00:00+00:00'::text) where key = 'follow_through_since';
  v := pg_temp.w3t_person('owner', 'select public.ops_setting_set(''auto_steps'', ''false''::jsonb)::text');
  v := pg_temp.w3t_person('owner', 'select public.ops_setting_set(''auto_steps'', ''true''::jsonb)::text');
  perform pg_temp.w3t_check('T-ONCE', 'switching off and on again never moves the follow-through start',
    (select value #>> '{}' from public.ops_settings where key = 'follow_through_since'), '2026-01-05T10:00:00+00:00');
  update public.ops_settings set value = coalesce(to_jsonb(v_first), 'null'::jsonb) where key = 'follow_through_since';
  -- The promise saved while off gets its steps on the first run now.
  perform public.ops_reconcile();
  perform pg_temp.w3t_check('T-ONCE', 'the promise saved while off gets its go-live card on the first run after switch-on',
    split_part(pg_temp.w3t_card('golive:expected:' || pg_temp.w3t_id('x_off')), '/', 1), '1');
  perform pg_temp.w3t_check('T-ONCE', 'the brand made while brand cards were off is still untouched',
    (select count(*) from public.crm_records where brand_id = '39870000-0000-4000-b400-000000000099')::text, '0');
end;
$once$;

-- ---------------------------------------------------------------------------
-- T-REDATE: a moved event re-dates its steps in every open status; done and
-- explicit due dates are never touched. T-CANCEL: a cancelled or removed
-- event closes every open step, whatever its status.
-- ---------------------------------------------------------------------------
do $redate$
declare v_today date := pg_temp.w3t_id('today')::date; k text; v text;
begin
  perform pg_temp.w3t_check('T-REDATE', 'each draft has its one go-live card before anything moves',
    (select string_agg(split_part(pg_temp.w3t_card('golive:event:' || pg_temp.w3t_id(x)), '/', 1), ',' order by x)
       from unnest(array['s_blocked','s_doing','s_done','s_expl','s_person','s_todo']) x), '1,1,1,1,1,1');
  perform pg_temp.w3t_check('T-REDATE', 'the public event has its giveaway card',
    split_part(pg_temp.w3t_card('promo:event:' || pg_temp.w3t_id('s_promo')), '/', 1), '1');
  update public.ops_work_cards set status = 'doing', started_at = now() where auto_key = 'golive:event:' || pg_temp.w3t_id('s_doing');
  update public.ops_work_cards set status = 'person', person_reason = 'other' where auto_key = 'golive:event:' || pg_temp.w3t_id('s_person');
  update public.ops_work_cards set blocked = true, blocked_kind = 'manual', blocked_reason = 'Held by a person'
   where auto_key = 'golive:event:' || pg_temp.w3t_id('s_blocked');
  update public.ops_work_cards set status = 'done', close_kind = 'done', closed_at = now(), closed_by = 'ada.w3t3980@test.local', close_reason = 'Done by hand'
   where auto_key = 'golive:event:' || pg_temp.w3t_id('s_done');
  update public.ops_work_cards set due_source = 'explicit', due_on = due_on + 1 where auto_key = 'golive:event:' || pg_temp.w3t_id('s_expl');
  update public.ops_work_cards set status = 'doing', started_at = now() where auto_key = 'promo:event:' || pg_temp.w3t_id('s_promo');

  -- Every event moves 5 days later.
  update public.event_dates set start_at = start_at + interval '5 days', end_at = end_at + interval '5 days'
   where event_id in (select i0.v::uuid from t3980w3t_ids i0 where i0.k like 's\_%');
  perform public.ops_reconcile();
  foreach k in array array['s_todo:45','s_doing:46','s_person:47','s_blocked:48'] loop
    perform pg_temp.w3t_check('T-REDATE', split_part(k, ':', 1) || ' card is re-dated to 28 days before the new date, keeping its status',
      (select status || '/' || (due_on - v_today) || '/' || title from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id(split_part(k, ':', 1))),
      (select status from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id(split_part(k, ':', 1)))
        || '/' || (split_part(k, ':', 2)::integer - 28) || '/Get W3T ' || initcap(replace(split_part(k, ':', 1), 's_', '')) || ' Night live by '
        || to_char(v_today + split_part(k, ':', 2)::integer - 28, 'FMDD Mon'));
  end loop;
  perform pg_temp.w3t_check('T-REDATE', 'the person card is still waiting for a person after the re-date',
    (select status || '/' || person_reason from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id('s_person')), 'person/other');
  perform pg_temp.w3t_check('T-REDATE', 'the blocked card is still blocked after the re-date',
    (select blocked::text || '/' || blocked_kind from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id('s_blocked')), 'true/manual');
  perform pg_temp.w3t_check('T-REDATE', 'a card a person closed is never re-dated',
    (select due_on - v_today from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id('s_done'))::text, '16');
  perform pg_temp.w3t_check('T-REDATE', 'a due date a person typed is never re-dated',
    (select (due_on - v_today) || '/' || due_source from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id('s_expl')), '18/explicit');
  perform pg_temp.w3t_check('T-REDATE', 'the giveaway card in progress moves to 21 days before the new date',
    (select status || '/' || (due_on - v_today) from public.ops_work_cards where auto_key = 'promo:event:' || pg_temp.w3t_id('s_promo')), 'doing/20');
  perform public.ops_reconcile();
  perform pg_temp.w3t_check('T-REDATE', 'a second run re-dates nothing again (one re-date event per card)',
    (select count(*) from public.ops_work_events e join public.ops_work_cards w on w.id = e.card_id
      where w.auto_key = 'golive:event:' || pg_temp.w3t_id('s_doing') and e.action = 'redated')::text, '1');

  -- Every event is cancelled; one is removed.
  set local session_replication_role = replica;
  update public.events set status = 'cancelled' where id in (select i0.v::uuid from t3980w3t_ids i0 where i0.k like 's\_%' and i0.k <> 's_gone');
  update public.events set deleted_at = now() where id = pg_temp.w3t_id('s_gone')::uuid;
  set local session_replication_role = origin;
  perform public.ops_reconcile();
  foreach k in array array['s_todo','s_doing','s_person','s_blocked','s_expl','s_gone'] loop
    perform pg_temp.w3t_check('T-CANCEL', k || ' card closes with the reason, whatever its status',
      (select status || '/' || close_kind || '/' || close_reason || '/' || blocked::text from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id(k)),
      'done/system/Event cancelled./false');
  end loop;
  perform pg_temp.w3t_check('T-CANCEL', 'the giveaway card in progress closes too',
    (select status || '/' || close_reason from public.ops_work_cards where auto_key = 'promo:event:' || pg_temp.w3t_id('s_promo')), 'done/Event cancelled.');
  perform pg_temp.w3t_check('T-CANCEL', 'a card a person already closed keeps their reason',
    (select close_kind || '/' || close_reason from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3t_id('s_done')), 'done/Done by hand');
  perform public.ops_reconcile();
  perform pg_temp.w3t_check('T-CANCEL', 'no step comes back for a cancelled event on the next run',
    (select count(*) from public.ops_work_cards w where w.status <> 'done' and w.archived_at is null
      and w.anchor_kind = 'event' and w.anchor_id in (select i0.v::uuid from t3980w3t_ids i0 where i0.k like 's\_%'))::text, '0');
end;
$redate$;

-- ---------------------------------------------------------------------------
-- T-REPEAT: a repeating host keeps exactly 4 dates and one rolling step.
-- ---------------------------------------------------------------------------
do $repeat$
declare v_today date := pg_temp.w3t_id('today')::date; x public.ops_expected_events; j jsonb; i integer;
begin
  select * into x from public.ops_expected_events where id = '39870000-0000-4000-d100-000000000001';
  perform pg_temp.w3t_check('T-REPEAT', 'the weekly series has exactly 4 dates',
    (select string_agg(((e->>'on')::date - v_today)::text, ',' order by (e->>'on')::date) from jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) e), '10,17,24,31');
  perform pg_temp.w3t_check('T-REPEAT', 'one rolling card, after three more runs too',
    (select count(*) from public.ops_work_cards where auto_key = 'series:' || x.id and status <> 'done')::text, '1');
  for i in 1..3 loop perform public.ops_reconcile(); end loop;
  perform pg_temp.w3t_check('T-REPEAT', 'still exactly one open rolling card and no go-live card per date',
    (select count(*) from public.ops_work_cards where auto_key = 'series:' || x.id and status <> 'done')::text
      || '/' || (select count(*) from public.ops_work_cards where auto_key like 'golive:expected:' || x.id || '%'), '1/0');
  -- The host publishes the second date (day 18, within 3 days of day 17).
  perform pg_temp.w3t_event('r_live', '39870000-0000-4000-b200-000000000002', 'W3T Weekly Supper 2', 'discover', 'scheduled', 18, 40);
  perform public.ops_reconcile();
  j := pg_temp.w3t_j(pg_temp.w3t_person('growth', format('select public.ops_calendar(%L, %L, %L)::text', v_today, v_today + 60, v_today)));
  perform pg_temp.w3t_check('T-REPEAT', 'the Calendar shows the 4 dates once each: 3 promised and the public one in place of its date',
    (select string_agg(((e->>'expected_on')::date - v_today)::text, ',' order by (e->>'expected_on')::date) from jsonb_array_elements(j->'expected') e where e->>'series_id' = x.id::text)
      || '+' || (select string_agg(((e->>'start_on')::date - v_today)::text, ',') from jsonb_array_elements(j->'events') e where e->>'id' = pg_temp.w3t_id('r_live')), '10,24,31+18');
  perform pg_temp.w3t_check('T-REPEAT', 'the published series date makes no go-live or giveaway card of its own',
    (select count(*) from public.ops_work_cards where auto_key in ('golive:event:' || pg_temp.w3t_id('r_live'), 'promo:event:' || pg_temp.w3t_id('r_live')))::text, '0');
  perform pg_temp.w3t_check('T-REPEAT', 'the housekeeping run never links the series to one event',
    (select status from public.ops_expected_events where id = x.id), 'open');
  -- Month ends and long gaps.
  x.expected_on := '2027-01-31'; x.repeats := 'month';
  perform pg_temp.w3t_check('T-REPEAT', 'a monthly series from 31 Jan keeps 4 dates on each month''s last possible day',
    (select string_agg(e->>'on', ',' order by (e->>'on')::date) from jsonb_array_elements(public.ops_expected_occurrences(x, '2027-01-01', 4)) e),
    '2027-01-31,2027-02-28,2027-03-31,2027-04-30');
  perform pg_temp.w3t_check('T-REPEAT', 'asked from five years on, still exactly 4 dates from that day',
    (select count(*)::text || '/' || min(e->>'on') from jsonb_array_elements(public.ops_expected_occurrences(x, '2032-03-15', 4)) e), '4/2032-03-31');
  x.repeats := 'week'; x.expected_on := '2027-01-04';
  perform pg_temp.w3t_check('T-REPEAT', 'a weekly series asked a year on keeps 4 dates on its weekday',
    (select count(*)::text || '/' || string_agg(distinct to_char((e->>'on')::date, 'Dy'), ',') from jsonb_array_elements(public.ops_expected_occurrences(x, '2028-01-01', 4)) e), '4/Mon');
  perform pg_temp.w3t_check('T-REPEAT', 'the count is kept between 1 and 12',
    jsonb_array_length(public.ops_expected_occurrences(x, '2027-01-01', 0))::text || '/' || jsonb_array_length(public.ops_expected_occurrences(x, '2027-01-01', 500))::text, '1/12');
  -- The host stops the series: its rolling card closes.
  perform pg_temp.w3t_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39870000-0000-4000-c100-000000000002', 'id', '39870000-0000-4000-d100-000000000001', 'status', 'cancelled',
                       'cancel_reason', 'The supper club stopped'), 'w3t-series-stop-1'));
  perform pg_temp.w3t_check('T-REPEAT', 'cancelling the series closes its one rolling card',
    (select string_agg(status || '/' || coalesce(close_reason, ''), ',') from public.ops_work_cards where auto_key = 'series:39870000-0000-4000-d100-000000000001'), 'done/Event cancelled.');
end;
$repeat$;

-- ---------------------------------------------------------------------------
-- T-PROMO: a venue's promo moment behaves like an event.
-- ---------------------------------------------------------------------------
do $promo$
declare v_today date := pg_temp.w3t_id('today')::date; v text; j jsonb; v_id text; v_late text;
begin
  v := pg_temp.w3t_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39870000-0000-4000-c100-000000000003', 'title', 'W3T December Menu', 'event_type', 'promo_moment',
                       'expected_on', v_today + 40), 'w3t-promo-1'));
  v_id := pg_temp.w3t_j(v)->'expected'->>'id';
  perform pg_temp.w3t_check('T-PROMO', 'saving a promo moment makes its go-live card at once, owned by the host owner',
    pg_temp.w3t_card('golive:expected:' || v_id), '1/Get W3T December Menu live by ' || to_char(v_today + 12, 'FMDD Mon') || '/12/ada.w3t3980@test.local');
  perform pg_temp.w3t_check('T-PROMO', 'it is the host''s next dated thing, flagged as a promo moment, Not live yet',
    (select (r->'next'->>'promo_moment') || '/' || (r->'next'->'state'->>'name')
       from jsonb_array_elements(pg_temp.w3t_j(pg_temp.w3t_person('growth', 'select public.ops_host_next(''{39870000-0000-4000-c100-000000000003}''::uuid[])::text'))->'hosts') r),
    'true/Not live yet');
  j := pg_temp.w3t_j(pg_temp.w3t_person('growth', format('select public.ops_calendar(%L, %L, %L)::text', v_today, v_today + 60, v_today)));
  perform pg_temp.w3t_check('T-PROMO', 'the Calendar shows it with the same state as an event',
    (select (e->>'promo_moment') || '/' || (e->'state'->>'k') from jsonb_array_elements(j->'expected') e where e->>'id' = v_id), 'true/notlive');
  v := pg_temp.w3t_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39870000-0000-4000-c100-000000000003', 'title', 'W3T Late Brunch', 'event_type', 'promo_moment',
                       'expected_on', v_today + 15), 'w3t-promo-2'));
  v_late := pg_temp.w3t_j(v)->'expected'->>'id';
  perform pg_temp.w3t_check('T-PROMO', 'a promo moment past the 3-week line is Too late for promo and gets no go-live card',
    (pg_temp.w3t_j(v)->'expected'->'state'->>'k') || '/' || split_part(pg_temp.w3t_card('golive:expected:' || v_late), '/', 1), 'late/0');
  -- The venue publishes it on Mingla two days later than promised.
  perform pg_temp.w3t_event('p_menu', '39870000-0000-4000-b200-000000000003', 'W3T December Menu Night', 'discover', 'scheduled', 42, 41);
  perform public.ops_reconcile();
  perform pg_temp.w3t_check('T-PROMO', 'the public event within 3 days stands for the promo moment',
    (select status || '/' || coalesce(event_id::text, '') from public.ops_expected_events where id = v_id::uuid), 'fulfilled/' || pg_temp.w3t_id('p_menu'));
  perform pg_temp.w3t_check('T-PROMO', 'its go-live card closes itself once it is public',
    (select status || '/' || close_kind from public.ops_work_cards where auto_key = 'golive:expected:' || v_id), 'done/system');
  perform pg_temp.w3t_check('T-PROMO', 'and it now gets its giveaway card like any public event',
    split_part(pg_temp.w3t_card('promo:event:' || pg_temp.w3t_id('p_menu')), '/', 1), '1');
end;
$promo$;

-- ---------------------------------------------------------------------------
-- T-BRAND: brand auto-link variants, and one card for every brand, once.
-- ---------------------------------------------------------------------------
do $brand$
declare v_res jsonb; v text; i integer;
begin
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('39870000-0000-4000-c200-000000000001', 'hosts', 'W3T Email Card', 'contacted', 'w3t', 'w3t'),
    ('39870000-0000-4000-c200-000000000002', 'hosts', 'W3T Phone Card', 'contacted', 'w3t', 'w3t'),
    ('39870000-0000-4000-c200-000000000003', 'hosts', 'W3T Linked Card', 'onboarded', 'w3t', 'w3t'),
    ('39870000-0000-4000-c200-000000000006', 'hosts', 'W3T Same Name Brand', 'prospect', 'w3t', 'w3t'),
    ('39870000-0000-4000-c200-000000000008', 'hosts', 'W3T Twin One', 'contacted', 'w3t', 'w3t'),
    ('39870000-0000-4000-c200-000000000009', 'hosts', 'W3T Twin Two', 'contacted', 'w3t', 'w3t');
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('39870000-0000-4000-c200-000000000007', 'creators', 'W3T Creator Card', 'identified', 'w3t', 'w3t');
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, created_at) values
    ('39870000-0000-4000-b500-000000000098', '39870000-0000-4000-b300-000000000098', 'W3T Elsewhere Brand', 'w3t-elsewhere-brand', 'Lagos', now() - interval '90 days');
  set local session_replication_role = origin;
  update public.crm_records set brand_id = '39870000-0000-4000-b500-000000000098' where id = '39870000-0000-4000-c200-000000000003';
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
    ('39870000-0000-4000-c200-000000000001', 'email', 'Owner@W3TMatch.test', public.crm_ident_key('email', 'Owner@W3TMatch.test'), 'w3t'),
    ('39870000-0000-4000-c200-000000000002', 'phone', '+2348091112222', public.crm_ident_key('phone', '+2348091112222'), 'w3t'),
    ('39870000-0000-4000-c200-000000000003', 'email', 'linked@w3tmatch.test', public.crm_ident_key('email', 'linked@w3tmatch.test'), 'w3t'),
    ('39870000-0000-4000-c200-000000000007', 'email', 'creator@w3tmatch.test', public.crm_ident_key('email', 'creator@w3tmatch.test'), 'w3t'),
    ('39870000-0000-4000-c200-000000000008', 'email', 'twin@w3tmatch.test', public.crm_ident_key('email', 'twin@w3tmatch.test'), 'w3t'),
    ('39870000-0000-4000-c200-000000000009', 'email', 'twin@w3tmatch.test', public.crm_ident_key('email', 'twin@w3tmatch.test'), 'w3t');

  v := pg_temp.w3t_person('owner', 'select public.ops_setting_set(''brand_auto_cards'', ''true''::jsonb)::text');
  perform pg_temp.w3t_check('T-BRAND', 'switching brand cards on keeps the earlier start time',
    ((select (value #>> '{}')::timestamptz from public.ops_settings where key = 'brand_auto_since') < now() - interval '12 hours')::text, 'true');
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, contact_email, contact_phone) values
    ('39870000-0000-4000-b500-000000000001', '39870000-0000-4000-b300-000000000011', 'W3T Case Brand', 'w3t-case-brand', 'Lagos', '  OWNER@w3tmatch.TEST  ', null),
    ('39870000-0000-4000-b500-000000000002', '39870000-0000-4000-b300-000000000012', 'W3T Spaced Phone', 'w3t-spaced-phone', 'Lagos', null, ' 0809 111 2222 '),
    ('39870000-0000-4000-b500-000000000003', '39870000-0000-4000-b300-000000000013', 'W3T Linked Elsewhere', 'w3t-linked-elsewhere', 'Lagos', 'linked@w3tmatch.test', null),
    ('39870000-0000-4000-b500-000000000005', '39870000-0000-4000-b300-000000000015', 'W3T Partial Email', 'w3t-partial-email', 'Lagos', 'owner@w3tmatch.test.uk', null),
    ('39870000-0000-4000-b500-000000000006', '39870000-0000-4000-b300-000000000016', '  w3t same NAME brand ', 'w3t-same-name', 'Lagos', 'fresh6@w3tmatch.test', null),
    ('39870000-0000-4000-b500-000000000007', '39870000-0000-4000-b300-000000000017', 'W3T Creator Match', 'w3t-creator-match', 'Lagos', 'creator@w3tmatch.test', null),
    ('39870000-0000-4000-b500-000000000008', '39870000-0000-4000-b300-000000000018', 'W3T Twin Brand', 'w3t-twin-brand', 'Lagos', 'twin@w3tmatch.test', null),
    ('39870000-0000-4000-b500-000000000009', '39870000-0000-4000-b300-000000000019', 'W3T Live Brand', 'w3t-live-brand', 'Lagos', 'fresh9@w3tmatch.test', null),
    ('39870000-0000-4000-b500-000000000010', '39870000-0000-4000-b300-000000000020', 'W3T Quiet Brand', 'w3t-quiet-brand', 'Lagos', null, null);
  set local session_replication_role = origin;
  perform pg_temp.w3t_event('b_live', '39870000-0000-4000-b500-000000000009', 'W3T Live Brand Night', 'discover', 'scheduled', 30, 30);

  v_res := public.ops_reconcile();
  perform pg_temp.w3t_check('T-BRAND', 'an email with other letter case and spaces links the one card that has it',
    (select string_agg(name || '/' || stage, ',') from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000001'), 'W3T Email Card/onboarded');
  perform pg_temp.w3t_check('T-BRAND', 'a spaced national phone links the card that has it with the country code',
    (select string_agg(name, ',') from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000002'), 'W3T Phone Card');
  perform pg_temp.w3t_check('T-BRAND', 'a card already linked to another brand is never re-linked',
    (select brand_id::text from public.crm_records where id = '39870000-0000-4000-c200-000000000003'), '39870000-0000-4000-b500-000000000098');
  perform pg_temp.w3t_like('T-BRAND', 'and that brand gets a card for a person to pick, naming the linked card',
    (select instructions from public.ops_work_cards where auto_key = 'brand_pick:39870000-0000-4000-b500-000000000003' and status <> 'done'),
    '%share its email or phone: W3T Linked Card.%');
  perform pg_temp.w3t_check('T-BRAND', 'a partial email (same start, longer domain) matches nobody and gets its own card',
    (select string_agg(name || '/' || stage, ',') from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000005'), 'W3T Partial Email/onboarded');
  perform pg_temp.w3t_check('T-BRAND', 'a name that differs only in case and spaces makes no second card',
    (select count(*) from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000006')::text || '/'
      || (select count(*) from public.crm_records where pipeline = 'hosts' and lower(btrim(name)) = 'w3t same name brand' and deleted_at is null)::text, '0/1');
  perform pg_temp.w3t_check('T-BRAND', 'it asks a person to pick instead',
    (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39870000-0000-4000-b500-000000000006' and status <> 'done')::text, '1');
  perform pg_temp.w3t_check('T-BRAND', 'a match on a creator card only is not a host match: the brand gets its own host card',
    (select string_agg(name || '/' || pipeline, ',') from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000007'), 'W3T Creator Match/hosts');
  perform pg_temp.w3t_check('T-BRAND', 'two cards with the brand''s email: nothing is linked',
    (select count(*) from public.crm_records where id in ('39870000-0000-4000-c200-000000000008', '39870000-0000-4000-c200-000000000009') and brand_id is not null)::text
      || '/' || (select count(*) from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000008')::text, '0/0');
  perform pg_temp.w3t_check('T-BRAND', 'a brand with a public event gets its card in Live, with no owner',
    (select stage || '/' || (select count(*) from public.crm_record_owners o where o.record_id = c.id) from public.crm_records c where c.brand_id = '39870000-0000-4000-b500-000000000009'), 'live/0');
  perform pg_temp.w3t_check('T-BRAND', 'a brand with no event and no contact details gets its card in Onboarded',
    (select name || '/' || stage from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000010'), 'W3T Quiet Brand/onboarded');
  perform pg_temp.w3t_check('T-BRAND', 'the brand made while brand cards were off is carded now (made after the start time)',
    (select count(*) from public.crm_records where brand_id = '39870000-0000-4000-b400-000000000099')::text, '1');
  for i in 1..3 loop v_res := public.ops_reconcile(); end loop;
  perform pg_temp.w3t_check('T-BRAND', 'three more runs: every new brand still has at most one host card and one open pick card',
    (select count(*) from (select brand_id from public.crm_records where brand_id::text like '39870000-0000-4000-b%' group by brand_id having count(*) > 1) d)::text
      || '/' || (select count(*) from (select auto_key from public.ops_work_cards where auto_key like 'brand_pick:%' and status <> 'done' group by auto_key having count(*) > 1) d)::text
      || '/' || (v_res->'brand_autolink'->>'linked') || (v_res->'brand_autolink'->>'created') || (v_res->'brand_autolink'->>'pick'), '0/0/000');
  -- Switched off: a brand made now is left alone.
  v := pg_temp.w3t_person('owner', 'select public.ops_setting_set(''brand_auto_cards'', ''false''::jsonb)::text');
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city) values
    ('39870000-0000-4000-b500-000000000011', '39870000-0000-4000-b300-000000000021', 'W3T After Off Brand', 'w3t-after-off', 'Lagos');
  set local session_replication_role = origin;
  perform public.ops_reconcile();
  perform pg_temp.w3t_check('T-BRAND', 'after switching brand cards off a new brand gets nothing',
    (select count(*) from public.crm_records where brand_id = '39870000-0000-4000-b500-000000000011')::text, '0');
  -- At most 25 brands a run.
  v := pg_temp.w3t_person('owner', 'select public.ops_setting_set(''brand_auto_cards'', ''true''::jsonb)::text');
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city)
  select ('39870000-0000-4000-b600-' || lpad(g::text, 12, '0'))::uuid, ('39870000-0000-4000-b700-' || lpad(g::text, 12, '0'))::uuid,
         'W3T Bulk Brand ' || g, 'w3t-bulk-' || g, 'Lagos' from generate_series(1, 30) g;
  set local session_replication_role = origin;
  v_res := public.ops_reconcile();
  perform pg_temp.w3t_check('T-BRAND', 'a run handles at most 25 brands',
    ((v_res->'brand_autolink'->>'created')::integer + (v_res->'brand_autolink'->>'linked')::integer + (v_res->'brand_autolink'->>'pick')::integer)::text, '25');
  v_res := public.ops_reconcile();
  perform pg_temp.w3t_check('T-BRAND', 'the rest follow on the next run, each once',
    (select count(*) from public.crm_records where brand_id::text like '39870000-0000-4000-b600-%')::text
      || '/' || (select count(distinct brand_id) from public.crm_records where brand_id::text like '39870000-0000-4000-b600-%')::text, '30/30');
end;
$brand$;

-- ---------------------------------------------------------------------------
-- T-X3: follow-through only for merges, Done moves and pushes at or after the
-- switch-on time, at the exact boundary.
-- ---------------------------------------------------------------------------
do $x3$
declare v_since timestamptz;
begin
  v_since := coalesce((select (value #>> '{}')::timestamptz from public.ops_settings where key = 'follow_through_since'), now());
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, merged_by_login, issues, deploy_marker, problems, feature_guide) values
    (990301, 'W3T merged a second before', 'https://github.com/Mingla-LLC/mingla-main/pull/990301', v_since - interval '1 second', repeat('c', 40), 'nobody', '[]', false, '{no_issue}', '{}'),
    (990302, 'W3T merged at switch-on', 'https://github.com/Mingla-LLC/mingla-main/pull/990302', v_since, repeat('d', 40), 'nobody', '[]', false, '{no_issue}', '{}'),
    (990303, 'W3T merged a second after', 'https://github.com/Mingla-LLC/mingla-main/pull/990303', v_since + interval '1 second', repeat('e', 40), 'nobody', '[]', false, '{no_issue}', '{}');
  insert into public.ops_github_items (number, kind, board_status, done_since, not_found) values
    (990311, 'issue', 'Done', v_since - interval '1 second', false),
    (990312, 'issue', 'Done', v_since, false),
    (990313, 'issue', 'Done', v_since + interval '1 second', false);
  insert into public.ops_main_commits (sha, committed_at, subject, author_login, pr) values
    (repeat('1', 40), v_since - interval '1 second', 'W3T pushed a second before', 'nobody', null),
    (repeat('2', 40), v_since + interval '1 second', 'W3T pushed a second after', 'nobody', null);
  -- The Done moves are older than a day, so their cards are due now.
  update public.ops_settings set value = to_jsonb(v_since - interval '2 days') where key = 'follow_through_since';
  update public.ops_github_items set done_since = done_since - interval '2 days' where number in (990311, 990312, 990313);
  update public.ops_release_records set merged_at = merged_at - interval '2 days' where pr in (990301, 990302, 990303);
  update public.ops_main_commits set committed_at = committed_at - interval '2 days' where sha in (repeat('1', 40), repeat('2', 40));
  perform public.ops_engineering_cards_sync();
  perform pg_temp.w3t_check('T-X3', 'a merge one second before switch-on makes no card',
    (select count(*) from public.ops_work_cards where auto_key like 'eng\_%:pr-990301%')::text, '0');
  perform pg_temp.w3t_check('T-X3', 'a merge exactly at switch-on does',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_no_issue:pr-990302' and status <> 'done')::text, '1');
  perform pg_temp.w3t_check('T-X3', 'a merge one second after does',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_no_issue:pr-990303' and status <> 'done')::text, '1');
  perform pg_temp.w3t_check('T-X3', 'an issue Done one second before switch-on makes no "Done but not Live" card',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-990311')::text, '0');
  perform pg_temp.w3t_check('T-X3', 'an issue Done exactly at switch-on, and one after, each get one',
    (select count(*) from public.ops_work_cards where auto_key in ('eng_done_not_live:issue-990312', 'eng_done_not_live:issue-990313') and status <> 'done')::text, '2');
  perform pg_temp.w3t_check('T-X3', 'a push without a pull request before switch-on makes no card; one after does',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_no_pr_push:1111111')::text
      || '/' || (select count(*) from public.ops_work_cards where auto_key = 'eng_no_pr_push:2222222' and status <> 'done')::text, '0/1');
  perform public.ops_engineering_cards_sync();
  perform pg_temp.w3t_check('T-X3', 'a second run adds nothing and never revives the old ones',
    (select count(*) from public.ops_work_cards where auto_key ~ '^eng_.*(990301|990311|1111111)')::text
      || '/' || (select count(*) from public.ops_work_cards where auto_key in ('eng_no_issue:pr-990302', 'eng_no_issue:pr-990303',
                 'eng_done_not_live:issue-990312', 'eng_done_not_live:issue-990313', 'eng_no_pr_push:2222222'))::text, '0/5');
end;
$x3$;

-- ---------------------------------------------------------------------------
-- T-ATT: Needs attention counts equal its lists, before and after changes.
-- ---------------------------------------------------------------------------
do $att$
declare v_today date := pg_temp.w3t_id('today')::date; j jsonb; j2 jsonb; g text; v_card uuid; v_person uuid; v_done uuid;
begin
  -- An ownerless card waiting for a person (not "no owner": Needs you is its owner),
  -- an overdue card a person closed, and an overdue open card.
  select id into v_person from public.ops_work_cards where auto_key = 'ask:39870000-0000-4000-c100-000000000004' and status <> 'done';
  if v_person is null then
    select id into v_person from public.ops_work_cards where status <> 'done' and archived_at is null
       and not exists (select 1 from public.ops_work_people p where p.card_id = ops_work_cards.id and p.role = 'owner') limit 1;
  end if;
  update public.ops_work_cards set status = 'person', person_reason = 'other' where id = v_person;
  select id into v_done from public.ops_work_cards where status = 'done' and archived_at is null limit 1;
  update public.ops_work_cards set due_on = v_today - 9 where id = v_done;
  select id into v_card from public.ops_work_cards where auto_key like 'series:%' or (status = 'todo' and archived_at is null) order by status = 'todo' desc limit 1;
  update public.ops_work_cards set due_on = v_today - 3, status = 'todo' where id = v_card and status <> 'done';
  j := pg_temp.w3t_j(pg_temp.w3t_person('growth', format('select public.ops_attention(%L)::text', v_today)));
  foreach g in array array['noowner','overdue','missing','stuck','nonext','engineering'] loop
    perform pg_temp.w3t_check('T-ATT', g || ' counts exactly what it lists', j->'counts'->>g, jsonb_array_length(j->'groups'->g)::text);
  end loop;
  perform pg_temp.w3t_check('T-ATT', 'the total is the sum of the lists', j->>'total', (select sum(jsonb_array_length(value))::text from jsonb_each(j->'groups')));
  perform pg_temp.w3t_check('T-ATT', 'a card waiting for a person is never listed as having no owner',
    (select count(*) from jsonb_array_elements(j->'groups'->'noowner') i where i->>'id' = v_person::text)::text, '0');
  perform pg_temp.w3t_check('T-ATT', 'a closed card is never overdue',
    (select count(*) from jsonb_array_elements(j->'groups'->'overdue') i where i->>'id' = v_done::text)::text, '0');
  perform pg_temp.w3t_check('T-ATT', 'the engineering follow-through cards are listed under Engineering',
    ((j->'counts'->>'engineering')::integer >= 4)::text, 'true');
  -- Change things between two reads: every count follows its list.
  update public.ops_work_cards set status = 'done', close_kind = 'done', closed_at = now(), closed_by = 'ada.w3t3980@test.local'
   where id in (select (i->>'id')::uuid from jsonb_array_elements(j->'groups'->'overdue') i limit 1);
  delete from public.crm_record_owners where record_id = '39870000-0000-4000-c100-000000000001';
  j2 := pg_temp.w3t_j(pg_temp.w3t_person('growth', format('select public.ops_attention(%L)::text', v_today)));
  foreach g in array array['noowner','overdue','missing','stuck','nonext','engineering'] loop
    perform pg_temp.w3t_check('T-ATT', 'after changes, ' || g || ' still counts exactly what it lists', j2->'counts'->>g, jsonb_array_length(j2->'groups'->g)::text);
  end loop;
  perform pg_temp.w3t_check('T-ATT', 'the host that lost its owner joins No owner',
    (select count(*) from jsonb_array_elements(j->'groups'->'noowner') i where i->>'id' = '39870000-0000-4000-c100-000000000001')::text
      || '/' || (select count(*) from jsonb_array_elements(j2->'groups'->'noowner') i where i->>'id' = '39870000-0000-4000-c100-000000000001')::text, '0/1');
  perform pg_temp.w3t_check('T-ATT', 'and the card closed between the reads leaves Overdue',
    ((j->'counts'->>'overdue')::integer - (j2->'counts'->>'overdue')::integer)::text, '1');
  perform pg_temp.w3t_like('T-ATT', 'a stranger cannot read Needs attention', pg_temp.w3t_as('anon', 'select public.ops_attention()::text'), 'ERR:42501:%');
end;
$att$;

select count(*) as w3t_total, count(*) filter (where not ok) as w3t_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w3t_failures
  from t3980w3t_results \gset
rollback;

select (:w3t_total < 90 or :w3t_failed > 0) as w3t_bad \gset
\if :w3t_bad
  \echo 'ISSUE-3980 SYNCED WAVE 3 TESTER FAILED:' :w3t_failed 'of' :w3t_total
  \echo :w3t_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 3 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 3 TESTER PASS:' :w3t_total 'checks, 0 failed'
