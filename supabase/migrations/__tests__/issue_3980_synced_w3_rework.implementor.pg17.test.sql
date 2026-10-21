-- Issue #3980 synced program, Wave 3 rework, on the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   R-D1   a repeating host's rolling card follows its series on every run:
--          the next date to publish and its words move on as dates go live,
--          the due date is never pushed into the past, the card closes with
--          a plain reason when all 4 kept dates are live, and the same card
--          opens again when a new unpublished date enters the window
--   R-D2   switching a series to "Does not repeat" closes its rolling card
--          with a reason and leaves one card (the go-live card of the one
--          date); no card ever says "Repeats every none"; a cancelled series
--          closes its card; a one-off that starts repeating closes its
--          go-live card and gets one rolling card
--   R-D4   each kept date of a repeating series carries its own plain state
--   R-D11  brand auto-link links only on an exact match; a phone number that
--          only ends the same makes a "Pick the right card" card naming the
--          candidates and links nothing; a match on a Lost card is never
--          linked silently and makes a card asking whether to reopen it; a
--          new host card keeps the brand's email as its contact
--   R-MOVE a moved event re-words its go-live and giveaway cards with the new
--          dates; a person's save re-dates only that host's cards; the save
--          says whether automatic steps were on
--   R-TOLD a "Recently shipped" wording card stays in To review (Wave 2's What
--          hosts are told group) and on the owner's wording tab, counted once
--   R-X4   "Done but not Live" reads the newest record of an issue, and two
--          records merged at the same moment are told apart by the higher
--          pull request number

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

create temp table t3980w3_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w3_people (who, id, email) values
  ('owner',  '39880000-0000-4000-a000-000000000001', 'ed.w3r3980@test.local'),
  ('admin',  '39880000-0000-4000-a000-000000000002', 'di.w3r3980@test.local'),
  ('growth', '39880000-0000-4000-a000-000000000003', 'ada.w3r3980@test.local'),
  ('mkt',    '39880000-0000-4000-a000-000000000004', 'bo.w3r3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w3_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3r3980@test.local', 'owner', 'active', now()),
  ('di.w3r3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3r3980@test.local', 'growth', 'active', now()),
  ('bo.w3r3980@test.local', 'growth', 'active', now());

create temp table t3980w3_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980w3_ids (k text primary key, v text) on commit drop;

create function pg_temp.w3_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w3_people where who = p_who;
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

create function pg_temp.w3_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w3_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w3_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.w3_id(p_k text) returns text
language sql as $fn$ select v from t3980w3_ids where k = p_k $fn$;

create function pg_temp.w3_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980w3_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

create function pg_temp.w3_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.w3_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.w3_next_request();
  return pg_temp.w3_as(p_who, p_sql);
end;
$fn$;

-- Day 0 is today at 00:00 UTC; an event starts at 20:00 UTC on day N and went
-- public L days and one hour before that (lead = L days).
create function pg_temp.w3_day(p_n integer) returns timestamptz
language sql as $fn$ select (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => p_n, hours => 20) $fn$;

create function pg_temp.w3_event(p_key text, p_brand text, p_title text, p_vis text, p_status text, p_day integer, p_lead integer) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
  values (v_id, p_brand::uuid, p_title, 'w33980-' || lower(regexp_replace(p_title, '[^A-Za-z0-9]+', '-', 'g')) || '-' || left(v_id::text, 8),
          p_vis, p_status, 'UTC',
          case when p_lead is null then null else pg_temp.w3_day(p_day) - make_interval(days => p_lead, hours => 1) end,
          'event', 'W33980 Street 1');
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  values (v_id, pg_temp.w3_day(p_day), pg_temp.w3_day(p_day) + interval '3 hours', true);
  set local session_replication_role = origin;
  perform pg_temp.w3_keep(p_key, v_id::text);
end;
$fn$;

-- The open automatic card of a key, as "<count>/<title>/<due offset>/<owners>".
create function pg_temp.w3_card(p_key text) returns text
language sql as $fn$
  select count(*)::text || '/' || coalesce(min(w.title), '') || '/' || coalesce(min(w.due_on - (now() AT TIME ZONE 'UTC')::date)::text, '') || '/'
         || coalesce(min((select string_agg(p.email, ',' order by p.email) from public.ops_work_people p where p.card_id = w.id and p.role = 'owner')), '')
    from public.ops_work_cards w where w.auto_key = p_key and w.status <> 'done' and w.archived_at is null
$fn$;

create function pg_temp.w3_auto_count() returns integer
language sql as $fn$
  select count(*)::integer from public.ops_work_cards w
   where w.auto_key ~ '^(golive|promo|recap|ask|series|brand_pick):' and w.archived_at is null
$fn$;


-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at) values
  ('39880000-0000-4000-b200-000000000001', '39880000-0000-4000-b300-000000000001', 'W3R Weekly Brand', 'w3r-weekly-brand', 'Lagos', now() - interval '30 days'),
  ('39880000-0000-4000-b200-000000000002', '39880000-0000-4000-b300-000000000002', 'W3R Stop Brand', 'w3r-stop-brand', 'Lagos', now() - interval '30 days');
set local session_replication_role = origin;
insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by) values
  ('39880000-0000-4000-c100-000000000001', 'hosts', 'W3R Weekly Host', 'live', '39880000-0000-4000-b200-000000000001', 'event_organizer', 'w3r', 'w3r'),
  ('39880000-0000-4000-c100-000000000002', 'hosts', 'W3R Stop Host', 'live', '39880000-0000-4000-b200-000000000002', 'event_organizer', 'w3r', 'w3r'),
  ('39880000-0000-4000-c100-000000000003', 'hosts', 'W3R Cancel Host', 'onboarded', null, 'event_organizer', 'w3r', 'w3r'),
  ('39880000-0000-4000-c100-000000000004', 'hosts', 'W3R Once Host', 'onboarded', null, 'event_organizer', 'w3r', 'w3r');
insert into public.crm_record_owners (record_id, owner_email, added_by)
select r, 'ada.w3r3980@test.local', 'w3r' from unnest(array['39880000-0000-4000-c100-000000000001','39880000-0000-4000-c100-000000000002',
  '39880000-0000-4000-c100-000000000003','39880000-0000-4000-c100-000000000004']::uuid[]) r;
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by) values
  ('39880000-0000-4000-d100-000000000001', '39880000-0000-4000-c100-000000000001', 'W3R Weekly', 'event', (now() AT TIME ZONE 'UTC')::date + 10, 'week', 'w3r', 'w3r'),
  ('39880000-0000-4000-d100-000000000002', '39880000-0000-4000-c100-000000000002', 'W3R Stop', 'event', (now() AT TIME ZONE 'UTC')::date + 12, 'week', 'w3r', 'w3r'),
  ('39880000-0000-4000-d100-000000000003', '39880000-0000-4000-c100-000000000003', 'W3R Monthly', 'event', (now() AT TIME ZONE 'UTC')::date + 9, 'month', 'w3r', 'w3r'),
  ('39880000-0000-4000-d100-000000000004', '39880000-0000-4000-c100-000000000004', 'W3R Once', 'event', (now() AT TIME ZONE 'UTC')::date + 40, 'none', 'w3r', 'w3r');
update public.ops_settings set value = 'true'::jsonb where key = 'auto_steps';

create function pg_temp.w3r_today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;
-- The open rolling card of a series as "<count>/<due offset>/<instructions>".
create function pg_temp.w3r_series(p_exp text) returns text
language sql as $fn$
  select count(*)::text || '/' || coalesce(min(w.due_on - pg_temp.w3r_today())::text, '') || '/' || coalesce(min(w.instructions), '')
    from public.ops_work_cards w where w.auto_key = 'series:' || p_exp and w.status <> 'done' and w.archived_at is null
$fn$;

-- ---------------------------------------------------------------------------
-- R-D1: the rolling card follows its series.
-- ---------------------------------------------------------------------------
do $d1$
declare v_id uuid; v_first uuid; c record; v jsonb;
begin
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3_check('R-D1', 'a weekly series gets one rolling card naming its first date, due today',
    pg_temp.w3r_series('39880000-0000-4000-d100-000000000001'),
    '1/0/Repeats every week. Next date to publish: ' || public.ops_day_long(pg_temp.w3r_today() + 10) || '.');
  select id into v_first from public.ops_work_cards where auto_key = 'series:39880000-0000-4000-d100-000000000001';
  perform pg_temp.w3_check('R-D1', 'a monthly series says "every month"',
    split_part(pg_temp.w3r_series('39880000-0000-4000-d100-000000000003'), '/', 3),
    'Repeats every month. Next date to publish: ' || public.ops_day_long(pg_temp.w3r_today() + 9) || '.');

  perform pg_temp.w3_event('d1_e0', '39880000-0000-4000-b200-000000000001', 'W3R Weekly One', 'discover', 'scheduled', 10, 30);
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3_check('R-D1', 'the first date goes live: the card names the next date to publish',
    pg_temp.w3r_series('39880000-0000-4000-d100-000000000001'),
    '1/0/Repeats every week. Next date to publish: ' || public.ops_day_long(pg_temp.w3r_today() + 17) || '.');
  perform pg_temp.w3_check('R-D1', 'and says it moved on, in its history',
    (select body from public.ops_work_events where card_id = v_first and action = 'redated' order by at desc limit 1),
    'Moved on: the next date to publish is ' || public.ops_day_long(pg_temp.w3r_today() + 17) || '.');
  perform pg_temp.w3_check('R-D1', 'the due date is never moved into the past (no false overdue)',
    (select (due_on >= pg_temp.w3r_today())::text from public.ops_work_cards where id = v_first), 'true');

  perform pg_temp.w3_event('d1_e1', '39880000-0000-4000-b200-000000000001', 'W3R Weekly Two', 'discover', 'scheduled', 17, 30);
  perform pg_temp.w3_event('d1_e2', '39880000-0000-4000-b200-000000000001', 'W3R Weekly Three', 'discover', 'scheduled', 24, 30);
  perform pg_temp.w3_event('d1_e3', '39880000-0000-4000-b200-000000000001', 'W3R Weekly Four', 'discover', 'scheduled', 31, 40);
  perform public.ops_auto_steps(null, null);
  select * into c from public.ops_work_cards where id = v_first;
  perform pg_temp.w3_check('R-D1', 'all 4 kept dates live: the card closes with a plain reason',
    c.status || '/' || c.close_kind || '/' || c.close_reason,
    'done/system/All 4 coming dates are live. This card opens again when the next date needs publishing.');
  perform pg_temp.w3_check('R-D1', 'no open rolling card is left to go overdue',
    pg_temp.w3r_series('39880000-0000-4000-d100-000000000001'), '0//');
  perform pg_temp.w3_check('R-D1', 'and none of the series dates makes its own go-live or promo card',
    (select count(*) from public.ops_work_cards w where w.auto_key in (
       'promo:event:' || pg_temp.w3_id('d1_e0'), 'promo:event:' || pg_temp.w3_id('d1_e1'),
       'promo:event:' || pg_temp.w3_id('d1_e2'), 'promo:event:' || pg_temp.w3_id('d1_e3')))::text, '0');
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3_check('R-D1', 'a second run keeps it closed',
    (select status from public.ops_work_cards where id = v_first), 'done');

  -- Eleven days pass: the series and its events move 11 days nearer, and a
  -- fifth date, not live yet, comes into the 4-date window.
  update public.event_dates set start_at = start_at - interval '11 days', end_at = end_at - interval '11 days'
   where event_id in (select id from public.events where brand_id = '39880000-0000-4000-b200-000000000001');
  update public.events set published_at = published_at - interval '11 days' where brand_id = '39880000-0000-4000-b200-000000000001';
  update public.ops_expected_events set expected_on = expected_on - 11 where id = '39880000-0000-4000-d100-000000000001';
  perform public.ops_auto_steps(null, null);
  select * into c from public.ops_work_cards where id = v_first;
  perform pg_temp.w3_check('R-D1', 'a new unpublished date opens the same card again',
    c.status || '/' || coalesce(c.close_reason, '-') || '/' || (c.due_on - pg_temp.w3r_today())::text || '/' || c.instructions,
    'todo/-/0/Repeats every week. Next date to publish: ' || public.ops_day_long(pg_temp.w3r_today() + 27) || '.');
  perform pg_temp.w3_check('R-D1', 'with one card for the series, and its history says why',
    (select count(*) from public.ops_work_cards where auto_key = 'series:39880000-0000-4000-d100-000000000001')::text || '/' ||
    (select body from public.ops_work_events where card_id = v_first and action = 'reopened' order by at desc limit 1),
    '1/Opened again: ' || public.ops_day_long(pg_temp.w3r_today() + 27) || ' needs publishing.');
end;
$d1$;

-- ---------------------------------------------------------------------------
-- R-D2: a series that stops repeating, is cancelled, or starts repeating.
-- ---------------------------------------------------------------------------
do $d2$
declare v text; v_card uuid; c record;
begin
  perform public.ops_auto_steps(null, null);
  select id into v_card from public.ops_work_cards where auto_key = 'series:39880000-0000-4000-d100-000000000002' and status <> 'done';
  perform pg_temp.w3_check('R-D2', 'the weekly series has its open rolling card', (v_card is not null)::text, 'true');
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39880000-0000-4000-c100-000000000002', 'id', '39880000-0000-4000-d100-000000000002',
                            'repeats', 'none', 'expected_on', (pg_temp.w3r_today() + 60)::text), 'w3r-d2-none-0001'));
  perform pg_temp.w3_check('R-D2', 'a person switches the series to "Does not repeat"', pg_temp.w3_j(v)->>'status', 'updated');
  select * into c from public.ops_work_cards where id = v_card;
  perform pg_temp.w3_check('R-D2', 'its rolling card closes with a reason',
    c.status || '/' || c.close_reason, 'done/The dates no longer repeat, so this card is not needed.');
  perform pg_temp.w3_check('R-D2', 'one open card is left for that host''s date: the go-live card',
    (select string_agg(split_part(auto_key, ':', 1), ',' order by auto_key) from public.ops_work_cards w
      where w.status <> 'done' and w.archived_at is null
        and (w.auto_key like '%39880000-0000-4000-d100-000000000002%')), 'golive');
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3_check('R-D2', 'a second run makes no second card',
    (select count(*) from public.ops_work_cards w where w.status <> 'done' and w.auto_key like '%39880000-0000-4000-d100-000000000002%')::text, '1');
  perform pg_temp.w3_check('R-D2', 'no card anywhere says "Repeats every none"',
    (select count(*) from public.ops_work_cards where instructions ilike '%every none%')::text, '0');

  -- A cancelled monthly series closes its card.
  select id into v_card from public.ops_work_cards where auto_key = 'series:39880000-0000-4000-d100-000000000003' and status <> 'done';
  update public.ops_expected_events set status = 'cancelled', cancel_reason = 'W3R stopped' where id = '39880000-0000-4000-d100-000000000003';
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3_check('R-D2', 'a cancelled series closes its rolling card',
    (select status || '/' || close_reason from public.ops_work_cards where id = v_card), 'done/Event cancelled.');

  -- A one-off that starts repeating: its go-live card closes, one rolling card.
  perform pg_temp.w3_check('R-D2', 'the one-off date has its go-live card',
    split_part(pg_temp.w3_card('golive:expected:39880000-0000-4000-d100-000000000004'), '/', 1), '1');
  update public.ops_expected_events set repeats = 'week', expected_on = pg_temp.w3r_today() + 20 where id = '39880000-0000-4000-d100-000000000004';
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3_check('R-D2', 'once it repeats, the go-live card closes and says why',
    (select status || '/' || close_reason from public.ops_work_cards where auto_key = 'golive:expected:39880000-0000-4000-d100-000000000004'),
    'done/The dates now repeat. One rolling card keeps them live.');
  perform pg_temp.w3_check('R-D2', 'and one rolling card covers the series',
    split_part(pg_temp.w3r_series('39880000-0000-4000-d100-000000000004'), '/', 1), '1');
end;
$d2$;

-- ---------------------------------------------------------------------------
-- R-D4: each kept date of a series carries its own state for the host card.
-- ---------------------------------------------------------------------------
do $d4$
declare v jsonb;
begin
  select public.ops_expected_json(x, pg_temp.w3r_today()) into v from public.ops_expected_events x where x.id = '39880000-0000-4000-d100-000000000004';
  perform pg_temp.w3_check('R-D4', 'a weekly series lists 4 kept dates, each with its own plain state',
    jsonb_array_length(v->'occurrences')::text || '/' ||
    (select string_agg(o->'state'->>'name', ',' order by (o->>'on')::date) from jsonb_array_elements(v->'occurrences') o),
    '4/Too late for promo,Not live yet,Not live yet,Not live yet');
end;
$d4$;

-- ---------------------------------------------------------------------------
-- R-D11: brand auto-link only on exact matches.
-- ---------------------------------------------------------------------------
do $d11$
declare v jsonb;
begin
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('39880000-0000-4000-c200-000000000001', 'hosts', 'W3R Exact Email', 'contacted', 'w3r', 'w3r'),
    ('39880000-0000-4000-c200-000000000002', 'hosts', 'W3R Tail Phone', 'contacted', 'w3r', 'w3r'),
    ('39880000-0000-4000-c200-000000000004', 'hosts', 'W3R Intl Phone', 'contacted', 'w3r', 'w3r');
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by) values
    ('39880000-0000-4000-c200-000000000003', 'hosts', 'W3R Lost Card', 'lost', 'Not now', 'w3r', 'w3r');
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
    ('39880000-0000-4000-c200-000000000001', 'email', 'exact@w3rmatch.test', public.crm_ident_key('email', 'exact@w3rmatch.test'), 'w3r'),
    ('39880000-0000-4000-c200-000000000002', 'phone', '+2348091112222', public.crm_ident_key('phone', '+2348091112222'), 'w3r'),
    ('39880000-0000-4000-c200-000000000003', 'email', 'gone@w3rmatch.test', public.crm_ident_key('email', 'gone@w3rmatch.test'), 'w3r'),
    ('39880000-0000-4000-c200-000000000004', 'phone', '+2348075554444', public.crm_ident_key('phone', '+2348075554444'), 'w3r');
  update public.ops_settings set value = 'true'::jsonb where key = 'brand_auto_cards';
  update public.ops_settings set value = to_jsonb(now() - interval '1 hour') where key = 'brand_auto_since';
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, contact_email, contact_phone) values
    ('39880000-0000-4000-b500-000000000001', '39880000-0000-4000-b300-000000000011', 'W3R Exact Brand', 'w3r-exact-brand', 'Lagos', ' EXACT@w3rmatch.test ', null),
    ('39880000-0000-4000-b500-000000000002', '39880000-0000-4000-b300-000000000012', 'W3R Tail Brand', 'w3r-tail-brand', 'Lagos', null, '091112222'),
    ('39880000-0000-4000-b500-000000000003', '39880000-0000-4000-b300-000000000013', 'W3R Lost Brand', 'w3r-lost-brand', 'Lagos', 'gone@w3rmatch.test', null),
    ('39880000-0000-4000-b500-000000000004', '39880000-0000-4000-b300-000000000014', 'W3R Fresh Brand', 'w3r-fresh-brand', 'Lagos', 'fresh@w3rmatch.test', null),
    ('39880000-0000-4000-b500-000000000005', '39880000-0000-4000-b300-000000000015', 'W3R Intl Brand', 'w3r-intl-brand', 'Lagos', null, '+234 807 555 4444');
  set local session_replication_role = origin;
  v := public.ops_brand_autolink();
  perform pg_temp.w3_check('R-D11', 'the same email links its one card',
    (select string_agg(name, ',') from public.crm_records where brand_id = '39880000-0000-4000-b500-000000000001'), 'W3R Exact Email');
  perform pg_temp.w3_check('R-D11', 'the same full international phone links its one card',
    (select string_agg(name, ',') from public.crm_records where brand_id = '39880000-0000-4000-b500-000000000005'), 'W3R Intl Phone');
  perform pg_temp.w3_check('R-D11', 'a phone number that only ends the same links nothing',
    (select count(*) from public.crm_records where brand_id = '39880000-0000-4000-b500-000000000002')::text, '0');
  perform pg_temp.w3_like('R-D11', 'and makes a "Pick the right card" card naming the candidate',
    (select title || ' | ' || instructions from public.ops_work_cards where auto_key = 'brand_pick:39880000-0000-4000-b500-000000000002' and status <> 'done'),
    'Pick the right card for W3R Tail Brand | %ends the same%W3R Tail Phone%');
  perform pg_temp.w3_check('R-D11', 'that card links the candidate host card',
    (select count(*) from public.ops_work_links l join public.ops_work_cards w on w.id = l.card_id
      where w.auto_key = 'brand_pick:39880000-0000-4000-b500-000000000002' and l.kind = 'host'
        and l.target_id = '39880000-0000-4000-c200-000000000002')::text, '1');
  perform pg_temp.w3_check('R-D11', 'a match on a Lost card is not linked silently',
    (select coalesce(brand_id::text, 'none') || '/' || stage from public.crm_records where id = '39880000-0000-4000-c200-000000000003'), 'none/lost');
  perform pg_temp.w3_check('R-D11', 'and makes a card asking whether to reopen it',
    (select title from public.ops_work_cards where auto_key = 'brand_lost:39880000-0000-4000-b500-000000000003' and status <> 'done'),
    'Reopen W3R Lost Card? W3R Lost Brand signed up on Mingla');
  perform pg_temp.w3_check('R-D11', 'a brand nobody matches gets a host card that keeps its email as the contact',
    (select contact from public.crm_records where brand_id = '39880000-0000-4000-b500-000000000004'), 'fresh@w3rmatch.test');
  v := public.ops_brand_autolink();
  perform pg_temp.w3_check('R-D11', 'a second run makes nothing more',
    (select count(*) from public.ops_work_cards where auto_key ~ '^brand_(pick|lost):39880000')::text || '/' ||
    (select count(*) from public.crm_records where name like 'W3R % Brand')::text, '2/1');
end;
$d11$;

-- ---------------------------------------------------------------------------
-- R-X4: two records merged at the same moment, the higher number wins.
-- ---------------------------------------------------------------------------
do $x4$
begin
  update public.ops_settings set value = to_jsonb(now() - interval '3 days') where key = 'follow_through_since';
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, merged_by_login, issues, deploy_marker, problems, feature_guide, complete)
  values (990401, 'W3R older', 'https://github.com/Mingla-LLC/mingla-main/pull/990401', now() - interval '2 days',
          repeat('c', 40), 'nobody', '[{"number":990401}]', false, '{}', '{}', true),
         (990402, 'W3R newer', 'https://github.com/Mingla-LLC/mingla-main/pull/990402', now() - interval '2 days',
          repeat('d', 40), 'nobody', '[{"number":990401}]', false, '{live_check_missing}', '{}', false);
  insert into public.ops_github_items (number, kind, board_status, done_since, title)
  values (990401, 'issue', 'Done', now() - interval '30 hours', 'W3R tie');
  perform public.ops_engineering_cards_sync();
  perform pg_temp.w3_check('R-X4', 'the higher pull request of two merged at once is the newest record (incomplete, so a card)',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-990401' and status <> 'done')::text, '1');
end;
$x4$;

-- ---------------------------------------------------------------------------
-- R-MOVE: a moved event re-words its cards; a person's save re-dates only
-- that host's cards; the save says whether automatic steps were on.
-- ---------------------------------------------------------------------------
do $mv$
declare v text; v_e text; v_f text; v_p text;
begin
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, created_at) values
    ('39880000-0000-4000-b200-000000000005', '39880000-0000-4000-b300-000000000005', 'W3R East Brand', 'w3r-east-brand', 'Lagos', now() - interval '30 days'),
    ('39880000-0000-4000-b200-000000000006', '39880000-0000-4000-b300-000000000006', 'W3R West Brand', 'w3r-west-brand', 'Lagos', now() - interval '30 days');
  set local session_replication_role = origin;
  insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by) values
    ('39880000-0000-4000-c100-000000000005', 'hosts', 'W3R East Host', 'onboarded', '39880000-0000-4000-b200-000000000005', 'event_organizer', 'w3r', 'w3r'),
    ('39880000-0000-4000-c100-000000000006', 'hosts', 'W3R West Host', 'onboarded', '39880000-0000-4000-b200-000000000006', 'event_organizer', 'w3r', 'w3r');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values
    ('39880000-0000-4000-c100-000000000005', 'ada.w3r3980@test.local', 'w3r'), ('39880000-0000-4000-c100-000000000006', 'ada.w3r3980@test.local', 'w3r');
  perform pg_temp.w3_event('mv_e', '39880000-0000-4000-b200-000000000005', 'W3R East Night', 'discover', 'draft', 50, null);
  perform pg_temp.w3_event('mv_f', '39880000-0000-4000-b200-000000000006', 'W3R West Night', 'discover', 'draft', 50, null);
  perform pg_temp.w3_event('mv_p', '39880000-0000-4000-b200-000000000006', 'W3R West Party', 'discover', 'scheduled', 40, 30);
  perform public.ops_auto_steps(null, null);
  v_e := 'golive:event:' || pg_temp.w3_id('mv_e'); v_f := 'golive:event:' || pg_temp.w3_id('mv_f'); v_p := 'promo:event:' || pg_temp.w3_id('mv_p');
  perform pg_temp.w3_check('R-MOVE', 'both drafts have their go-live card due 28 days before',
    split_part(pg_temp.w3_card(v_e), '/', 3) || ',' || split_part(pg_temp.w3_card(v_f), '/', 3), '22,22');
  update public.event_dates set start_at = start_at + interval '7 days', end_at = end_at + interval '7 days'
   where event_id in (pg_temp.w3_id('mv_e')::uuid, pg_temp.w3_id('mv_f')::uuid);
  update public.event_dates set start_at = start_at + interval '5 days', end_at = end_at + interval '5 days'
   where event_id = pg_temp.w3_id('mv_p')::uuid;
  -- A person saves a promised date on the East host only.
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39880000-0000-4000-c100-000000000005', 'title', 'W3R East Later', 'event_type', 'event',
                            'expected_on', (pg_temp.w3r_today() + 120)::text, 'repeats', 'none'), 'w3r-mv-east-0001'));
  perform pg_temp.w3_check('R-MOVE', 'the save says automatic steps were on', pg_temp.w3_j(v)->>'auto_steps', 'true');
  perform pg_temp.w3_check('R-MOVE', 'that save re-dates the East card only',
    split_part(pg_temp.w3_card(v_e), '/', 3) || ',' || split_part(pg_temp.w3_card(v_f), '/', 3), '29,22');
  perform pg_temp.w3_check('R-MOVE', 'the East card''s words use the new dates',
    (select instructions from public.ops_work_cards where auto_key = v_e and status <> 'done'),
    format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
           public.ops_day_words(pg_temp.w3r_today() + 57 - 35), public.ops_day_words(pg_temp.w3r_today() + 57 - 31)));
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3_check('R-MOVE', 'the housekeeping run then re-dates the West card',
    split_part(pg_temp.w3_card(v_f), '/', 3), '29');
  perform pg_temp.w3_check('R-MOVE', 'a moved public event''s giveaway card uses the new dates',
    (select instructions from public.ops_work_cards where auto_key = v_p and status <> 'done'),
    format('Starts %s. Creators post %s, reminder %s. Money is spent only after a person approves it in Needs you.',
           public.ops_day_words(pg_temp.w3r_today() + 45 - 21), public.ops_day_words(pg_temp.w3r_today() + 45 - 14),
           public.ops_day_words(pg_temp.w3r_today() + 45 - 7)));
  -- With automatic steps off, the save says so and adds nothing.
  update public.ops_settings set value = 'false'::jsonb where key = 'auto_steps';
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39880000-0000-4000-c100-000000000005', 'title', 'W3R East Off', 'event_type', 'event',
                            'expected_on', (pg_temp.w3r_today() + 130)::text, 'repeats', 'none'), 'w3r-mv-east-0002'));
  perform pg_temp.w3_check('R-MOVE', 'with automatic steps off the save says they were off and made no steps',
    (pg_temp.w3_j(v)->>'auto_steps') || '/' || coalesce(pg_temp.w3_j(v)->>'steps', 'none'), 'false/none');
  update public.ops_settings set value = 'true'::jsonb where key = 'auto_steps';
end;
$mv$;

-- ---------------------------------------------------------------------------
-- R-TOLD: a "Recently shipped" wording card is listed in To review (Wave 2's
-- What hosts are told group) and on the owner's wording tab, counted once.
-- ---------------------------------------------------------------------------
do $told$
declare v jsonb; m jsonb; v_res jsonb;
begin
  v_res := public.ops_auto_card_upsert('roadmap_shipped:issue-990498', jsonb_build_object(
    'title', 'Approve what hosts are told about W3R payouts', 'instructions', 'Read the drafted Recently shipped wording and publish it or say it is not needed.',
    'done_means', 'The wording is published or marked not needed.', 'person_reason', 'publish',
    'owners', jsonb_build_array('ed.w3r3980@test.local'), 'watchers', '[]'::jsonb, 'due_on', pg_temp.w3r_today() + 1), 'task', null);
  perform pg_temp.w3_check('R-TOLD', 'the wording card is made, waiting for a person', v_res->>'status', 'added');
  v := pg_temp.w3_j(pg_temp.w3_person('owner', 'select public.ops_review_list(null)::text'));
  perform pg_temp.w3_check('R-TOLD', 'To review lists it (Wave 2 group) and the wording tab lists it',
    (select count(*) from jsonb_array_elements(v->'cards') c where c->>'auto_kind' = 'roadmap_shipped')::text || '/' ||
    (select count(*) from jsonb_array_elements(v->'wording') c where c->>'auto_kind' = 'roadmap_shipped')::text, '1/1');
  m := pg_temp.w3_j(pg_temp.w3_person('owner', 'select public.ops_my_counts(null)::text'));
  perform pg_temp.w3_check('R-TOLD', 'the owner''s counts hold it once, as wording',
    (m->>'needs_person_mine') || '/' || (m->>'wording_mine'),
    ((select count(*) from jsonb_array_elements(v->'cards') c where c->>'auto_kind' IS DISTINCT FROM 'roadmap_shipped'))::text || '/1');
end;
$told$;

select count(*) as w3r_total, count(*) filter (where not ok) as w3r_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w3r_failures
  from t3980w3_results \gset
rollback;

select (:w3r_total < 30 or :w3r_failed > 0) as w3r_bad \gset
\if :w3r_bad
  \echo 'ISSUE-3980 SYNCED WAVE 3 REWORK FAILED:' :w3r_failed 'of' :w3r_total
  \echo :w3r_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 3 REWORK FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 3 REWORK PASS:' :w3r_total 'checks, 0 failed'
