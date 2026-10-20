-- Issue #3980 synced program, Wave 3 -- the operations redesign, on the fully
-- replayed PG17 schema.
-- MINGLA-INVARIANT: I-3980-AUTO-STEPS-FROM-TIMELINE | issue #3980 | Mingla makes at most one open card per automatic step key from events, promised events and repeating hosts, re-dates and closes them as the timeline changes, and makes none while the owner has automatic steps switched off.
--
-- What it proves (each check is recorded and reported together):
--   W3-STATE    the four plain states and Happened at every edge (21 and 28
--               days, a draft, a promise, the past) with sentences that use
--               the real dates
--   W3-OFF      with the switches as shipped (off), the housekeeping run and
--               saving a promised event make no card and link no brand
--   W3-AUTO     switched on: one go-live card for a draft and for a promise,
--               one giveaway and ads card for each event public early enough
--               (owned by the marketing owner), none for one public too late,
--               a recap card after an event, an "ask for their first event"
--               card with no owner; a second run makes no duplicate; a moved
--               event re-dates its card; a cancelled one closes it; a
--               promise saved by a person makes its card at once, closes the
--               ask card, re-dates on a new date and closes on cancel
--   W3-REPEAT   a weekly series keeps its next 4 dates, matches a public
--               event within 3 days, gets one rolling card and no go-live or
--               promo card for its matched date; a monthly series steps by
--               month
--   W3-READS    the host's next dated thing, the Calendar rows with states
--               and undated posts, the event panel's 8 steps, what just
--               happened, and Needs attention whose counts equal its lists
--   W3-BRAND    switched on: one matching card is linked (stage moves), no
--               match makes a host card, an ambiguous phone (two cards)
--               writes nothing and makes a card for a person to pick, older
--               brands are left alone
--   W3-X3       engineering follow-through counts only from the time
--               automatic steps were switched on: an older merge, a merge
--               before switch-on, and an issue already Done when first read
--               make no card; a later merge and an issue seen moving to Done
--               do
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

create temp table t3980w3_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w3_people (who, id, email) values
  ('owner',  '39830000-0000-4000-a000-000000000001', 'ed.w33980@test.local'),
  ('admin',  '39830000-0000-4000-a000-000000000002', 'di.w33980@test.local'),
  ('growth', '39830000-0000-4000-a000-000000000003', 'ada.w33980@test.local'),
  ('mkt',    '39830000-0000-4000-a000-000000000004', 'bo.w33980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w3_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w33980@test.local', 'owner', 'active', now()),
  ('di.w33980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w33980@test.local', 'growth', 'active', now()),
  ('bo.w33980@test.local', 'growth', 'active', now());

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
  ('39830000-0000-4000-b200-000000000001', '39830000-0000-4000-b300-000000000001', 'W33980 Palm Brand', 'w33980-palm-brand', 'Lagos', now() - interval '30 days'),
  ('39830000-0000-4000-b200-000000000003', '39830000-0000-4000-b300-000000000003', 'W33980 Recap Brand', 'w33980-recap-brand', 'Lagos', now() - interval '30 days'),
  ('39830000-0000-4000-b200-000000000004', '39830000-0000-4000-b300-000000000004', 'W33980 Weekly Brand', 'w33980-weekly-brand', 'London', now() - interval '30 days');
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by) values
  ('39830000-0000-4000-c100-000000000001', 'hosts', 'W33980 Palm Host', 'onboarded', '39830000-0000-4000-b200-000000000001', 'event_organizer', 'w3-fixture', 'w3-fixture'),
  ('39830000-0000-4000-c100-000000000003', 'hosts', 'W33980 Recap Host', 'live', '39830000-0000-4000-b200-000000000003', 'event_organizer', 'w3-fixture', 'w3-fixture'),
  ('39830000-0000-4000-c100-000000000004', 'hosts', 'W33980 Weekly Host', 'onboarded', '39830000-0000-4000-b200-000000000004', 'event_organizer', 'w3-fixture', 'w3-fixture');
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('39830000-0000-4000-c100-000000000002', 'hosts', 'W33980 Replied Host', 'replied', 'w3-fixture', 'w3-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39830000-0000-4000-c100-000000000001', 'ada.w33980@test.local', 'w3-fixture'),
  ('39830000-0000-4000-c100-000000000003', 'ada.w33980@test.local', 'w3-fixture'),
  ('39830000-0000-4000-c100-000000000004', 'ada.w33980@test.local', 'w3-fixture');

select pg_temp.w3_keep('today', ((now() AT TIME ZONE 'UTC')::date)::text);
select pg_temp.w3_event('e_draft',  '39830000-0000-4000-b200-000000000001', 'W33980 Draft Night',  'draft',    'draft',     40, null),
       pg_temp.w3_event('e_ready',  '39830000-0000-4000-b200-000000000001', 'W33980 Ready Night',  'discover', 'scheduled', 35, 30),
       pg_temp.w3_event('e_short',  '39830000-0000-4000-b200-000000000001', 'W33980 Short Night',  'discover', 'scheduled', 23, 24),
       pg_temp.w3_event('e_late',   '39830000-0000-4000-b200-000000000001', 'W33980 Late Night',   'discover', 'scheduled', 10, 10),
       pg_temp.w3_event('e_move',   '39830000-0000-4000-b200-000000000001', 'W33980 Move Night',   'draft',    'draft',     50, null),
       pg_temp.w3_event('e_cancel', '39830000-0000-4000-b200-000000000001', 'W33980 Cancel Night', 'draft',    'draft',     45, null),
       pg_temp.w3_event('e_past',   '39830000-0000-4000-b200-000000000003', 'W33980 Past Party',   'discover', 'scheduled', -3, 30),
       pg_temp.w3_event('e_weekly', '39830000-0000-4000-b200-000000000004', 'W33980 Weekly Supper', 'discover', 'scheduled', 13, 40);

-- A weekly series from day 5 (dates 5, 12, 19, 26: day 13's public event
-- stands for day 12) and a monthly one from day 9.
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by)
values ('39830000-0000-4000-d100-000000000001', '39830000-0000-4000-c100-000000000004', 'W33980 Weekly Supper', 'event',
        (now() AT TIME ZONE 'UTC')::date + 5, 'week', 'w3-fixture', 'w3-fixture'),
       ('39830000-0000-4000-d100-000000000002', '39830000-0000-4000-c100-000000000004', 'W33980 Month Market', 'promo_moment',
        (now() AT TIME ZONE 'UTC')::date + 9, 'month', 'w3-fixture', 'w3-fixture');

-- ---------------------------------------------------------------------------
-- W3-STATE: the plain states
-- ---------------------------------------------------------------------------
do $state$
declare v_today date := pg_temp.w3_id('today')::date; s jsonb;
  pub constant text := '{"kind":"event","is_public":true,"status":"scheduled","start_on":"%s","runway":{"lead_days":%s}}';
begin
  s := public.ops_plain_state(format('{"kind":"event","is_public":true,"start_on":"%s","runway":{"lead_days":40}}', v_today - 1)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'a date that passed is Happened', (s->>'k') || '/' || (s->>'name'), 'done/Happened');
  perform pg_temp.w3_check('W3-STATE', 'and says when', (s->>'say'), 'This happened on ' || to_char(v_today - 1, 'Dy FMDD Mon') || '.');
  s := public.ops_plain_state(format('{"kind":"event","is_public":true,"start_on":"%s","runway":{"lead_days":40}}', v_today)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'today is not past', (s->>'k'), 'ready');
  s := public.ops_plain_state(format(pub, v_today + 30, 28)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'live 28 days ahead is Ready to promote', (s->>'k') || '/' || (s->>'name') || '/' || (s->>'lead'), 'ready/Ready to promote/28');
  perform pg_temp.w3_check('W3-STATE', 'with its sentence', (s->>'say'), 'Went live 28 days before it starts, so it gets the full promo: giveaway, creators and ads.');
  s := public.ops_plain_state(format(pub, v_today + 30, 27)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'live 27 days ahead is Promote now', (s->>'k') || '/' || (s->>'name'), 'short/Promote now');
  s := public.ops_plain_state(format(pub, v_today + 30, 21)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'live 21 days ahead is Promote now', (s->>'k'), 'short');
  s := public.ops_plain_state(format(pub, v_today + 30, 20)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'live 20 days ahead is Too late for promo', (s->>'k') || '/' || (s->>'name'), 'late/Too late for promo');
  perform pg_temp.w3_check('W3-STATE', 'which says why', (s->>'say'), 'Went live only 20 days ahead. Under 3 weeks gets posts and shares, no giveaway or ads.');
  s := public.ops_plain_state(format('{"kind":"event","is_public":false,"status":"draft","start_on":"%s"}', v_today + 21)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'a draft 21 days out is Draft, not live, by 28 days before',
    (s->>'k') || '/' || (s->>'name') || '/' || (s->>'by'), 'notlive/Draft, not live/' || (v_today - 7));
  perform pg_temp.w3_check('W3-STATE', 'and says the go-live date', (s->>'say'),
    'The host has a draft in Mingla Business. Get it live by ' || to_char(v_today - 7, 'Dy FMDD Mon') || ' for the full promo.');
  s := public.ops_plain_state(format('{"kind":"event","is_public":false,"status":"draft","start_on":"%s"}', v_today + 20)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'a draft 20 days out is Too late for promo', (s->>'k'), 'late');
  perform pg_temp.w3_like('W3-STATE', 'and says the draft gets posts only', (s->>'say'), 'There’s a draft in Mingla Business, but it isn’t live%posts only.');
  s := public.ops_plain_state(format('{"kind":"expected","is_public":false,"status":"open","start_on":"%s"}', v_today + 40)::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'a promise is Not live yet', (s->>'k') || '/' || (s->>'name'), 'notlive/Not live yet');
  perform pg_temp.w3_like('W3-STATE', 'promised in words', (s->>'say'), 'The host promised this. Get it live by %');
  s := public.ops_plain_state('{"kind":"event","is_public":true}'::jsonb, v_today);
  perform pg_temp.w3_check('W3-STATE', 'no date is said plainly', (s->>'k'), 'nodate');
end;
$state$;

-- ---------------------------------------------------------------------------
-- W3-OFF: switched off as shipped, nothing is made by itself
-- ---------------------------------------------------------------------------
do $off$
declare v text; v_today date := pg_temp.w3_id('today')::date;
begin
  perform pg_temp.w3_check('W3-OFF', 'automatic steps ship off',
    (select value::text from public.ops_settings where key = 'auto_steps'), 'false');
  perform pg_temp.w3_check('W3-OFF', 'brand cards ship off',
    (select value::text from public.ops_settings where key = 'brand_auto_cards'), 'false');
  perform pg_temp.w3_check('W3-OFF', 'follow-through has no start time yet',
    (select value::text from public.ops_settings where key = 'follow_through_since'), 'null');
  perform public.ops_reconcile();
  perform pg_temp.w3_check('W3-OFF', 'the housekeeping run makes no automatic card', pg_temp.w3_auto_count()::text, '0');
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39830000-0000-4000-c100-000000000002', 'title', 'W33980 Off Promise', 'event_type', 'event',
                       'expected_on', v_today + 70), 'w3-off-1'));
  perform pg_temp.w3_check('W3-OFF', 'a person can still save a promise', pg_temp.w3_j(v)->>'status', 'created');
  perform pg_temp.w3_check('W3-OFF', 'which makes no step while switched off', (pg_temp.w3_j(v)->'steps')::text || '/' || pg_temp.w3_auto_count(), 'null/0');
  perform pg_temp.w3_keep('x_off', pg_temp.w3_j(v)->'expected'->>'id');
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39830000-0000-4000-c100-000000000002', 'id', pg_temp.w3_id('x_off'), 'status', 'cancelled',
                       'cancel_reason', 'Fixture, not needed'), 'w3-off-2'));
  perform pg_temp.w3_check('W3-OFF', 'and cancel it', pg_temp.w3_j(v)->>'status', 'cancelled');
end;
$off$;

-- ---------------------------------------------------------------------------
-- W3-AUTO: switched on, the timeline makes the steps
-- ---------------------------------------------------------------------------
do $auto$
declare v text; v_today date := pg_temp.w3_id('today')::date; v_res jsonb; v_card uuid;
begin
  v := pg_temp.w3_person('growth', 'select public.ops_setting_set(''auto_steps'', ''true''::jsonb)::text');
  perform pg_temp.w3_like('W3-AUTO', 'only the owner switches it on', v, 'ERR:42501:forbidden:%');
  v := pg_temp.w3_person('owner', 'select public.ops_setting_set(''marketing_owner'', ''"bo.w33980@test.local"''::jsonb)::text');
  v := pg_temp.w3_person('owner', 'select public.ops_setting_set(''auto_steps'', ''true''::jsonb)::text');
  perform pg_temp.w3_check('W3-AUTO', 'the owner switches automatic steps on', pg_temp.w3_j(v)->'settings'->>'auto_steps', 'true');
  perform pg_temp.w3_check('W3-AUTO', 'which records when follow-through starts (X3)',
    ((pg_temp.w3_j(v)->'settings'->>'follow_through_since') is not null and (select value::text from public.ops_settings where key = 'follow_through_since') <> 'null')::text, 'true');

  v_res := public.ops_reconcile();
  perform pg_temp.w3_check('W3-AUTO', 'the housekeeping run makes the steps', ((v_res->'auto_steps'->>'added')::integer > 0)::text, 'true');
  perform pg_temp.w3_check('W3-AUTO', 'a draft gets one go-live card, owned by the host owner, due 28 days before',
    pg_temp.w3_card('golive:event:' || pg_temp.w3_id('e_draft')),
    '1/Get W33980 Draft Night live by ' || to_char(v_today + 12, 'FMDD Mon') || '/12/ada.w33980@test.local');
  perform pg_temp.w3_check('W3-AUTO', 'the go-live card is a gate counted from the event',
    (select kind || '/' || kit_step || '/' || due_source || '/' || anchor_kind from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3_id('e_draft')),
    'gate_live/-28/kit/event');
  perform pg_temp.w3_like('W3-AUTO', 'with the brief in the artifact''s words',
    (select instructions from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3_id('e_draft')),
    'Host owner. Steps before it: get the flyer, logo, prices and date (%), build the listing with the host (%).');
  perform pg_temp.w3_check('W3-AUTO', 'an event live 30 days ahead gets giveaway and ads, owned by the marketing owner',
    pg_temp.w3_card('promo:event:' || pg_temp.w3_id('e_ready')), '1/Giveaway and ads for W33980 Ready Night/14/bo.w33980@test.local');
  perform pg_temp.w3_check('W3-AUTO', 'an event live 24 days ahead too',
    split_part(pg_temp.w3_card('promo:event:' || pg_temp.w3_id('e_short')), '/', 1), '1');
  perform pg_temp.w3_check('W3-AUTO', 'an event live 10 days ahead gets no giveaway card',
    split_part(pg_temp.w3_card('promo:event:' || pg_temp.w3_id('e_late')), '/', 1), '0');
  perform pg_temp.w3_check('W3-AUTO', 'nor a go-live card', split_part(pg_temp.w3_card('golive:event:' || pg_temp.w3_id('e_late')), '/', 1), '0');
  perform pg_temp.w3_check('W3-AUTO', 'a host whose event was 3 days ago gets a recap card',
    pg_temp.w3_card('recap:' || pg_temp.w3_id('e_past')),
    '1/Recap W33980 Past Party and ask W33980 Recap Host for their next event/0/ada.w33980@test.local');
  perform pg_temp.w3_check('W3-AUTO', 'a Replied host with nothing coming up gets an ask card with no owner',
    pg_temp.w3_card('ask:39830000-0000-4000-c100-000000000002'), '1/Ask W33980 Replied Host for their first event and date/3/');
  perform pg_temp.w3_check('W3-AUTO', 'Mingla made it, from the timeline',
    (select created_by || '/' || created_via from public.ops_work_cards where auto_key = 'ask:39830000-0000-4000-c100-000000000002'),
    'system@usemingla.com/system');

  v_res := public.ops_reconcile();
  perform pg_temp.w3_check('W3-AUTO', 'a second run makes no duplicate', (v_res->'auto_steps'->>'added'), '0');
  perform pg_temp.w3_check('W3-AUTO', 'each key has exactly one open card',
    (select count(*) from (select auto_key from public.ops_work_cards where auto_key is not null and status <> 'done' group by auto_key having count(*) > 1) d)::text, '0');

  -- The event moves a week later.
  update public.event_dates set start_at = start_at + interval '7 days', end_at = end_at + interval '7 days'
   where event_id = pg_temp.w3_id('e_move')::uuid;
  v_res := public.ops_reconcile();
  perform pg_temp.w3_check('W3-AUTO', 'a moved event re-dates its card and its title',
    pg_temp.w3_card('golive:event:' || pg_temp.w3_id('e_move')),
    '1/Get W33980 Move Night live by ' || to_char(v_today + 29, 'FMDD Mon') || '/29/ada.w33980@test.local');
  perform pg_temp.w3_like('W3-AUTO', 'the card''s history says why',
    (select e.body from public.ops_work_events e join public.ops_work_cards w on w.id = e.card_id
      where w.auto_key = 'golive:event:' || pg_temp.w3_id('e_move') and e.action = 'redated' order by e.at desc limit 1),
    'Re-dated to % W33980 Move Night now starts %.');
  perform pg_temp.w3_check('W3-AUTO', 'and the log says it was re-dated',
    (select count(*) from public.ops_agent_log l join public.ops_work_cards w on w.id = l.card_id
      where w.auto_key = 'golive:event:' || pg_temp.w3_id('e_move') and l.action = 'auto_redated')::text, '1');

  -- The event is cancelled.
  set local session_replication_role = replica;
  update public.events set status = 'cancelled' where id = pg_temp.w3_id('e_cancel')::uuid;
  set local session_replication_role = origin;
  v_res := public.ops_reconcile();
  perform pg_temp.w3_check('W3-AUTO', 'a cancelled event closes its card with the reason',
    (select status || '/' || close_kind || '/' || close_reason from public.ops_work_cards where auto_key = 'golive:event:' || pg_temp.w3_id('e_cancel')),
    'done/system/Event cancelled.');

  -- A person saves the Replied host's first event.
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39830000-0000-4000-c100-000000000002', 'title', 'W33980 Rooftop Sundowner', 'event_type', 'event',
                       'expected_on', v_today + 60), 'w3-auto-1'));
  perform pg_temp.w3_keep('x_roof', pg_temp.w3_j(v)->'expected'->>'id');
  perform pg_temp.w3_check('W3-AUTO', 'saving a promise makes its go-live card at once',
    pg_temp.w3_card('golive:expected:' || pg_temp.w3_id('x_roof')),
    '1/Get W33980 Rooftop Sundowner live by ' || to_char(v_today + 32, 'FMDD Mon') || '/32/');
  perform pg_temp.w3_check('W3-AUTO', 'and closes the ask card with what was set',
    (select status || '/' || close_reason from public.ops_work_cards where auto_key = 'ask:39830000-0000-4000-c100-000000000002'),
    'done/Next event set: W33980 Rooftop Sundowner on ' || to_char(v_today + 60, 'FMDD Mon') || '.');
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39830000-0000-4000-c100-000000000002', 'id', pg_temp.w3_id('x_roof'), 'expected_on', v_today + 70), 'w3-auto-2'));
  perform pg_temp.w3_check('W3-AUTO', 'a new date re-dates the card at once',
    pg_temp.w3_card('golive:expected:' || pg_temp.w3_id('x_roof')),
    '1/Get W33980 Rooftop Sundowner live by ' || to_char(v_today + 42, 'FMDD Mon') || '/42/');
  v := pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    jsonb_build_object('record_id', '39830000-0000-4000-c100-000000000002', 'id', pg_temp.w3_id('x_roof'), 'status', 'cancelled',
                       'cancel_reason', 'The host called it off'), 'w3-auto-3'));
  perform pg_temp.w3_check('W3-AUTO', 'cancelling it closes the card',
    (select status || '/' || close_reason from public.ops_work_cards where auto_key = 'golive:expected:' || pg_temp.w3_id('x_roof')),
    'done/Event cancelled.');
  perform pg_temp.w3_check('W3-AUTO', 'a person saving a promo moment is accepted',
    pg_temp.w3_j(pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
      jsonb_build_object('record_id', '39830000-0000-4000-c100-000000000002', 'title', 'W33980 December Menu', 'event_type', 'promo_moment',
                         'expected_on', v_today + 50), 'w3-auto-4')))->'expected'->>'promo_moment', 'true');
  perform pg_temp.w3_check('W3-AUTO', 'a bad repeat is refused in words',
    pg_temp.w3_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
      jsonb_build_object('record_id', '39830000-0000-4000-c100-000000000002', 'title', 'W33980 Yearly', 'event_type', 'event',
                         'expected_on', v_today + 50, 'repeats', 'year'), 'w3-auto-5')),
    'ERR:22023:invalid_expected: Repeats must be none, week or month.');
end;
$auto$;

-- ---------------------------------------------------------------------------
-- W3-REPEAT: repeating hosts
-- ---------------------------------------------------------------------------
do $repeat$
declare v_today date := pg_temp.w3_id('today')::date; x public.ops_expected_events; o jsonb;
begin
  select * into x from public.ops_expected_events where id = '39830000-0000-4000-d100-000000000001';
  o := public.ops_expected_occurrences(x, v_today, 4);
  perform pg_temp.w3_check('W3-REPEAT', 'a weekly series keeps its next 4 dates',
    (select string_agg(((e->>'on')::date - v_today)::text, ',' order by (e->>'on')::date) from jsonb_array_elements(o) e), '5,12,19,26');
  perform pg_temp.w3_check('W3-REPEAT', 'the date a public event stands for (within 3 days) is matched to it',
    (select string_agg(e->>'live', ',' order by (e->>'on')::date) from jsonb_array_elements(o) e), 'false,true,false,false');
  perform pg_temp.w3_check('W3-REPEAT', 'it is that event',
    (select e->>'event_id' from jsonb_array_elements(o) e where (e->>'live')::boolean), pg_temp.w3_id('e_weekly'));
  perform pg_temp.w3_check('W3-REPEAT', 'from a later day it moves on',
    (select string_agg(((e->>'on')::date - v_today)::text, ',' order by (e->>'on')::date)
       from jsonb_array_elements(public.ops_expected_occurrences(x, v_today + 6, 4)) e), '12,19,26,33');
  select * into x from public.ops_expected_events where id = '39830000-0000-4000-d100-000000000002';
  perform pg_temp.w3_check('W3-REPEAT', 'a monthly series steps by month',
    (select string_agg((e->>'on'), ',' order by (e->>'on')::date) from jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) e),
    (select string_agg(((v_today + 9) + make_interval(months => k))::date::text, ',' order by k) from generate_series(0, 3) k));
  perform pg_temp.w3_check('W3-REPEAT', 'the weekly host gets one rolling card, due today',
    pg_temp.w3_card('series:39830000-0000-4000-d100-000000000001'), '1/Keep 4 weeks of W33980 Weekly Host dates live/0/ada.w33980@test.local');
  perform pg_temp.w3_like('W3-REPEAT', 'naming the next date to publish',
    (select instructions from public.ops_work_cards where auto_key = 'series:39830000-0000-4000-d100-000000000001'),
    'Repeats every week. Next date to publish: ' || to_char(v_today + 5, 'Dy FMDD Mon') || '.');
  perform pg_temp.w3_check('W3-REPEAT', 'the public date of the series makes no giveaway or go-live card',
    (select count(*) from public.ops_work_cards where auto_key in ('promo:event:' || pg_temp.w3_id('e_weekly'), 'golive:event:' || pg_temp.w3_id('e_weekly')))::text, '0');
  perform pg_temp.w3_check('W3-REPEAT', 'a series is never linked to one event by the housekeeping run',
    (select status from public.ops_expected_events where id = '39830000-0000-4000-d100-000000000001'), 'open');
end;
$repeat$;

-- ---------------------------------------------------------------------------
-- W3-READS: next dated thing, Calendar, event panel, what just happened,
-- Needs attention
-- ---------------------------------------------------------------------------
do $reads$
declare v text; j jsonb; v_today date := pg_temp.w3_id('today')::date; g text; v_card uuid;
begin
  v := pg_temp.w3_person('growth', format('select public.ops_host_next(%L::uuid[], %L)::text',
    '{39830000-0000-4000-c100-000000000001,39830000-0000-4000-c100-000000000003,39830000-0000-4000-c100-000000000004}', v_today));
  j := pg_temp.w3_j(v)->'hosts';
  perform pg_temp.w3_check('W3-READS', 'the next dated thing of a host is its soonest event, with its state',
    (select r->'next'->>'title' || '/' || (r->'next'->'state'->>'k') from jsonb_array_elements(j) r where r->>'record_id' = '39830000-0000-4000-c100-000000000001'),
    'W33980 Late Night/late');
  perform pg_temp.w3_check('W3-READS', 'a Live host with nothing coming up needs a next event',
    (select (r->>'needs_next') || '/' || coalesce(r->>'next', 'null') from jsonb_array_elements(j) r where r->>'record_id' = '39830000-0000-4000-c100-000000000003'),
    'true/null');
  perform pg_temp.w3_check('W3-READS', 'a repeating host''s next date is its series',
    (select (r->'next'->>'kind') || '/' || (r->'next'->>'repeats') || '/' || ((r->'next'->>'start_on')::date - v_today)
       from jsonb_array_elements(j) r where r->>'record_id' = '39830000-0000-4000-c100-000000000004'), 'expected/true/5');
  perform pg_temp.w3_like('W3-READS', 'a stranger cannot read it', pg_temp.w3_as('anon', 'select public.ops_host_next(''{}''::uuid[])::text'), 'ERR:42501:%');

  v := pg_temp.w3_person('growth', format('select public.ops_calendar(%L, %L, %L)::text', v_today, v_today + 60, v_today));
  j := pg_temp.w3_j(v);
  perform pg_temp.w3_check('W3-READS', 'Calendar events carry their plain state',
    (select e->'state'->>'k' from jsonb_array_elements(j->'events') e where e->>'id' = pg_temp.w3_id('e_ready')), 'ready');
  perform pg_temp.w3_check('W3-READS', 'a draft is Draft, not live',
    (select e->'state'->>'name' from jsonb_array_elements(j->'events') e where e->>'id' = pg_temp.w3_id('e_draft')), 'Draft, not live');
  perform pg_temp.w3_check('W3-READS', 'the weekly series shows its 3 dates no public event stands for',
    (select string_agg(((e->>'expected_on')::date - v_today)::text, ',' order by (e->>'expected_on')::date)
       from jsonb_array_elements(j->'expected') e where e->>'series_id' = '39830000-0000-4000-d100-000000000001'), '5,19,26');
  perform pg_temp.w3_check('W3-READS', 'each as Not live yet',
    (select string_agg(distinct e->'state'->>'k', ',') from jsonb_array_elements(j->'expected') e where e->>'series_id' = '39830000-0000-4000-d100-000000000001'),
    'late,notlive');
  perform pg_temp.w3_check('W3-READS', 'posts with no date are counted', (j ? 'posts_undated')::text, 'true');

  v := pg_temp.w3_person('growth', format('select public.ops_anchor_detail(%L, %L::uuid, %L)::text', 'event', pg_temp.w3_id('e_ready'), v_today));
  j := pg_temp.w3_j(v);
  perform pg_temp.w3_check('W3-READS', 'the event panel lists 8 steps', jsonb_array_length(j->'steps')::text, '8');
  perform pg_temp.w3_check('W3-READS', 'public means the steps up to go-live are done',
    (select string_agg((s->>'state'), ',' order by ((s->>'step'))::integer) from jsonb_array_elements(j->'steps') s), 'done,done,done,open,open,open,open,open');
  perform pg_temp.w3_check('W3-READS', 'with the artifact''s step words',
    (select string_agg((s->>'title'), '|' order by ((s->>'step'))::integer) from jsonb_array_elements(j->'steps') s),
    'Get the flyer, logo, prices and date|Build the listing with the host|Live on Mingla|Write the brief, pick creators|Start the giveaway and ads|Creators post|Reminder push|Recap and ask for the next event');
  perform pg_temp.w3_check('W3-READS', 'and counts 3 done', j->>'done_count', '3');
  perform pg_temp.w3_check('W3-READS', 'the panel says the state sentence', j->>'say',
    'Went live 30 days before it starts, so it gets the full promo: giveaway, creators and ads.');
  perform pg_temp.w3_check('W3-READS', 'the old kit key stays for one release', (j ? 'kit')::text, 'true');
  v := pg_temp.w3_person('growth', format('select public.ops_anchor_detail(%L, %L::uuid, %L)::text', 'event', pg_temp.w3_id('e_late'), v_today));
  perform pg_temp.w3_check('W3-READS', 'too late skips the giveaway step',
    (select (s->>'state') from jsonb_array_elements(pg_temp.w3_j(v)->'steps') s where ((s->>'step'))::integer = -21), 'skip');
  v := pg_temp.w3_person('growth', format('select public.ops_anchor_detail(%L, %L::uuid, %L)::text', 'event', pg_temp.w3_id('e_draft'), v_today));
  perform pg_temp.w3_like('W3-READS', 'what just happened on the event names the step Mingla added',
    (select string_agg(c->>'words', ' | ') from jsonb_array_elements(pg_temp.w3_j(v)->'changes') c), '%Mingla added Card % Get W33980 Draft Night live by %');
  v := pg_temp.w3_person('growth', format('select public.ops_recent_changes(%L, %L::uuid)::text', 'host', '39830000-0000-4000-c100-000000000002'));
  perform pg_temp.w3_like('W3-READS', 'what just happened on the host says the ask card closed itself',
    (select string_agg(c->>'words', ' | ') from jsonb_array_elements(pg_temp.w3_j(v)->'items') c), '%closed itself: Next event set: W33980 December Menu%');
  perform pg_temp.w3_check('W3-READS', 'at most 8 lines',
    (jsonb_array_length(pg_temp.w3_j(v)->'items') <= 8)::text, 'true');

  -- Needs attention: an overdue card and a stuck one join the lists.
  select id into v_card from public.ops_work_cards where auto_key = 'promo:event:' || pg_temp.w3_id('e_short');
  update public.ops_work_cards set due_on = v_today - 2 where id = v_card;
  update public.ops_work_cards set status = 'doing', started_at = now() - interval '9 days', updated_at = now() - interval '9 days'
   where auto_key = 'recap:' || pg_temp.w3_id('e_past');
  update public.ops_work_events set at = now() - interval '9 days'
   where card_id = (select id from public.ops_work_cards where auto_key = 'recap:' || pg_temp.w3_id('e_past'));
  v := pg_temp.w3_person('growth', format('select public.ops_attention(%L)::text', v_today));
  j := pg_temp.w3_j(v);
  foreach g in array array['noowner','overdue','missing','stuck','nonext','engineering'] loop
    perform pg_temp.w3_check('W3-READS', 'Needs attention counts ' || g || ' as many as it lists',
      j->'counts'->>g, jsonb_array_length(j->'groups'->g)::text);
  end loop;
  perform pg_temp.w3_check('W3-READS', 'the total is the sum of the lists', j->>'total',
    (select sum(jsonb_array_length(value))::text from jsonb_each(j->'groups')));
  perform pg_temp.w3_check('W3-READS', 'a host with no owner is listed with Assign to me',
    (select i->>'fix' from jsonb_array_elements(j->'groups'->'noowner') i where i->>'id' = '39830000-0000-4000-c100-000000000002'), 'assign_me');
  perform pg_temp.w3_check('W3-READS', 'a host missing its details is listed with Fill in',
    (select i->>'reason' || '/' || (i->>'fix') from jsonb_array_elements(j->'groups'->'missing') i where i->>'id' = '39830000-0000-4000-c100-000000000002'),
    'Missing type, region, contact/fill_in');
  perform pg_temp.w3_check('W3-READS', 'an overdue card is listed',
    (select i->>'reason' from jsonb_array_elements(j->'groups'->'overdue') i where i->>'id' = v_card::text),
    'Due ' || to_char(v_today - 2, 'FMDD Mon') || ', 2 days ago');
  perform pg_temp.w3_like('W3-READS', 'a card in progress with no update for a week is stuck',
    (select i->>'reason' from jsonb_array_elements(j->'groups'->'stuck') i
      where i->>'id' = (select id::text from public.ops_work_cards where auto_key = 'recap:' || pg_temp.w3_id('e_past'))), 'In progress, no update for 9 days');
  perform pg_temp.w3_check('W3-READS', 'the Live host with nothing coming up has no next event',
    (select count(*) from jsonb_array_elements(j->'groups'->'nonext') i where i->>'id' = '39830000-0000-4000-c100-000000000003')::text, '1');
  perform pg_temp.w3_check('W3-READS', 'the live totals are printed', (j->'live_totals' ? 'brands_without_card')::text, 'true');
end;
$reads$;

-- ---------------------------------------------------------------------------
-- W3-BRAND: brand auto-link
-- ---------------------------------------------------------------------------
do $brand$
declare v text; v_res jsonb; v_rec public.crm_records;
begin
  -- Host cards that hold the contact details new brands will sign up with.
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('39830000-0000-4000-c200-000000000001', 'hosts', 'W33980 Email Match Host', 'contacted', 'w3-fixture', 'w3-fixture'),
    ('39830000-0000-4000-c200-000000000002', 'hosts', 'W33980 Phone One', 'contacted', 'w3-fixture', 'w3-fixture'),
    ('39830000-0000-4000-c200-000000000003', 'hosts', 'W33980 Phone Two', 'contacted', 'w3-fixture', 'w3-fixture');
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
    ('39830000-0000-4000-c200-000000000001', 'email', 'hello@w33980match.test', public.crm_ident_key('email', 'hello@w33980match.test'), 'w3-fixture'),
    ('39830000-0000-4000-c200-000000000002', 'phone', '08012345678', public.crm_ident_key('phone', '08012345678'), 'w3-fixture'),
    ('39830000-0000-4000-c200-000000000003', 'phone', '+2348012345678', public.crm_ident_key('phone', '+2348012345678'), 'w3-fixture');
  -- Older brand: before the switch, never touched.
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, contact_email, created_at) values
    ('39830000-0000-4000-b400-000000000009', '39830000-0000-4000-b300-000000000009', 'W33980 Old Brand', 'w33980-old-brand', 'Lagos', 'hello@w33980match.test', now() - interval '2 days');
  set local session_replication_role = origin;

  v := pg_temp.w3_person('owner', 'select public.ops_setting_set(''brand_auto_cards'', ''true''::jsonb)::text');
  perform pg_temp.w3_check('W3-BRAND', 'the owner switches brand cards on', pg_temp.w3_j(v)->'settings'->>'brand_auto_cards', 'true');

  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, contact_email, contact_phone) values
    ('39830000-0000-4000-b400-000000000001', '39830000-0000-4000-b300-000000000011', 'W33980 Email Brand', 'w33980-email-brand', 'Lagos', 'Hello@W33980Match.test', null),
    ('39830000-0000-4000-b400-000000000002', '39830000-0000-4000-b300-000000000012', 'W33980 New Rooftop', 'w33980-new-rooftop', 'Lagos', 'nobody@w33980fresh.test', null),
    ('39830000-0000-4000-b400-000000000003', '39830000-0000-4000-b300-000000000013', 'W33980 Phone Brand', 'w33980-phone-brand', 'Lagos', null, '+234 801 234 5678');
  set local session_replication_role = origin;

  v_res := public.ops_reconcile();
  perform pg_temp.w3_check('W3-BRAND', 'one run links one, makes one card, and asks a person once',
    (v_res->'brand_autolink'->>'linked') || '/' || (v_res->'brand_autolink'->>'created') || '/' || (v_res->'brand_autolink'->>'pick'), '1/1/1');
  select * into v_rec from public.crm_records where id = '39830000-0000-4000-c200-000000000001';
  perform pg_temp.w3_check('W3-BRAND', 'the one card with the same email is linked and moves to Onboarded',
    coalesce(v_rec.brand_id::text, 'none') || '/' || v_rec.stage, '39830000-0000-4000-b400-000000000001/onboarded');
  perform pg_temp.w3_check('W3-BRAND', 'its log says why, in words',
    (select body from public.crm_activity where record_id = v_rec.id and kind = 'note' and via = 'system' order by occurred_at desc limit 1),
    'Brand W33980 Email Brand linked by itself: same email as this card.');
  perform pg_temp.w3_check('W3-BRAND', 'a brand nobody matches gets a host card in Onboarded, with no owner',
    (select c.name || '/' || c.stage || '/' || coalesce(c.source, '') || '/' || (select count(*) from public.crm_record_owners o where o.record_id = c.id)
       from public.crm_records c where c.brand_id = '39830000-0000-4000-b400-000000000002'), 'W33980 New Rooftop/onboarded/inbound/0');
  perform pg_temp.w3_check('W3-BRAND', 'an ambiguous phone (two cards) links nothing',
    (select count(*) from public.crm_records where brand_id = '39830000-0000-4000-b400-000000000003')::text
      || '/' || (select count(*) from public.crm_records where id in ('39830000-0000-4000-c200-000000000002', '39830000-0000-4000-c200-000000000003') and brand_id is not null),
    '0/0');
  perform pg_temp.w3_like('W3-BRAND', 'and makes a card for a person to pick, naming both cards',
    (select title || ' | ' || instructions from public.ops_work_cards where auto_key = 'brand_pick:39830000-0000-4000-b400-000000000003'),
    'Pick the host card for W33980 Phone Brand | %W33980 Phone One, W33980 Phone Two%');
  perform pg_temp.w3_check('W3-BRAND', 'the older brand is left alone',
    (select count(*) from public.crm_records where brand_id = '39830000-0000-4000-b400-000000000009')::text, '0');
  v_res := public.ops_reconcile();
  perform pg_temp.w3_check('W3-BRAND', 'a second run does nothing more',
    (v_res->'brand_autolink'->>'linked') || '/' || (v_res->'brand_autolink'->>'created') || '/' || (v_res->'brand_autolink'->>'pick')
      || '/' || (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39830000-0000-4000-b400-000000000003'), '0/0/0/1');
  perform pg_temp.w3_check('W3-BRAND', 'only Mingla''s brand link writes pipeline tables',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'ops\_%' and p.prosrc ~* '(update|insert\s+into)\s+public\.crm_'), 'ops_brand_autolink_one');
end;
$brand$;

-- ---------------------------------------------------------------------------
-- W3-X3: follow-through only from switch-on
-- ---------------------------------------------------------------------------
do $x3$
declare v_since timestamptz; v jsonb;
begin
  v_since := (select (value #>> '{}')::timestamptz from public.ops_settings where key = 'follow_through_since');
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, merged_by_login, issues, deploy_marker, problems, feature_guide)
  values (990101, 'W33980 old merge', 'https://github.com/Mingla-LLC/mingla-main/pull/990101', v_since - interval '3 days',
          repeat('a', 40), 'nobody', '[]', false, '{no_issue}', '{}'),
         (990102, 'W33980 new merge', 'https://github.com/Mingla-LLC/mingla-main/pull/990102', v_since + interval '1 minute',
          repeat('b', 40), 'nobody', '[]', false, '{no_issue}', '{}');
  perform public.ops_engineering_cards_sync();
  perform pg_temp.w3_check('W3-X3', 'a merge from before switch-on makes no follow-through card',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_no_issue:pr-990101')::text, '0');
  perform pg_temp.w3_check('W3-X3', 'a merge after switch-on does',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_no_issue:pr-990102' and status <> 'done')::text, '1');

  -- Issues: one already Done the first time Mingla read it, one seen moving.
  insert into public.ops_github_items (number, kind) values (990201, 'issue'), (990202, 'issue');
  perform pg_temp.w3_as('service', 'select public.ops_github_items_apply(''[{"number":990201,"found":true,"kind":"issue","title":"W33980 old done","state":"CLOSED","board_status":"Done","updated_at":"2026-01-01T00:00:00Z"},{"number":990202,"found":true,"kind":"issue","title":"W33980 moving","state":"OPEN","board_status":"In Progress","updated_at":"2026-01-01T00:00:00Z"}]''::jsonb)::text');
  perform pg_temp.w3_as('service', 'select public.ops_github_items_apply(''[{"number":990202,"found":true,"kind":"issue","title":"W33980 moving","state":"CLOSED","board_status":"Done","updated_at":"2026-01-01T00:00:00Z"}]''::jsonb)::text');
  perform pg_temp.w3_check('W3-X3', 'an issue already Done when first read has no Done time (history)',
    (select coalesce(done_seen_at::text, 'none') from public.ops_github_items where number = 990201), 'none');
  perform pg_temp.w3_check('W3-X3', 'an issue seen moving to Done has one',
    (select (done_seen_at is not null)::text from public.ops_github_items where number = 990202), 'true');
  -- A day later, with switch-on two days ago.
  update public.ops_settings set value = to_jsonb(now() - interval '2 days') where key = 'follow_through_since';
  update public.ops_github_items set done_seen_at = now() - interval '25 hours' where number = 990202;
  update public.ops_github_items set github_updated_at = now() - interval '300 days' where number = 990201;
  perform public.ops_engineering_cards_sync();
  perform pg_temp.w3_check('W3-X3', 'the issue that was already Done makes no "Done but not Live" card',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-990201')::text, '0');
  perform pg_temp.w3_check('W3-X3', 'the one seen moving after switch-on does',
    (select count(*) from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-990202' and status <> 'done')::text, '1');
  -- Before any switch-on: nothing is followed up.
  update public.ops_settings set value = 'null'::jsonb where key = 'follow_through_since';
  perform public.ops_engineering_cards_sync();
  perform pg_temp.w3_check('W3-X3', 'with no switch-on time, the follow-through cards close themselves',
    (select count(*) from public.ops_work_cards where auto_key in ('eng_no_issue:pr-990102', 'eng_done_not_live:issue-990202') and status <> 'done')::text, '0');
end;
$x3$;

select count(*) as w3_total, count(*) filter (where not ok) as w3_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w3_failures
  from t3980w3_results \gset
rollback;

select (:w3_total < 80 or :w3_failed > 0) as w3_bad \gset
\if :w3_bad
  \echo 'ISSUE-3980 SYNCED WAVE 3 FAILED:' :w3_failed 'of' :w3_total
  \echo :w3_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 3 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 3 PASS:' :w3_total 'checks, 0 failed'
