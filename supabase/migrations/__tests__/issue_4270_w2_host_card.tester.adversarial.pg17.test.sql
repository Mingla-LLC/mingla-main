-- Issue #4270 (Wave 2) -- tester adversarial suite for
-- 20280403014270_issue_4270_w2_host_card.sql, on the fully replayed PG17
-- schema. Different angles from the implementor's happy path:
--
--   X-SHOW    D15, every route an agent has to "Host can see this": a batch
--             that mixes a hidden and a shown card is refused whole; a quick
--             add; a string "true" is a fix, not a switch; update off->on is
--             refused and changes nothing else in the same request; an agent
--             cannot undo at all; a person's undo leaves the flag alone in
--             both directions; no other function in the schema writes the
--             column and no client role can write the table
--   X-GONE    D16: no id, id null, a cancel or a repeat without an id, and an
--             agent's call are all refused before anything else is read; a
--             saved one still changes date and title, repeats, links and is
--             cancelled by an agent; another host's saved one is not found;
--             only ops_expected_event_set inserts promised events, behind
--             the gone guard; the #3980 test copy of the old save lives in
--             pg_temp and is gone after its transaction
--   X-READ    the host read: kinds incl. RSVP; a live experience that began
--             60 days ago; a private live trip, a hidden event and a deleted
--             event appear nowhere (upcoming or past); To do across three
--             host records of the brand (a deleted record's cards and an
--             archived card are not in it), a card anchored to another
--             record's promised date is, oldest due first then card number;
--             a host with no brand reads only its own cards; the team skips
--             removed and invited members and names a member with no name
--             "A teammate"; not one "@" anywhere in the read, with changes,
--             promised dates, owners and watchers all present
--   X-RECORD  ops_brand_host_record: the oldest live record wins (a deleted
--             older one is skipped; a created_at tie goes to the lower id);
--             others in order; null and unknown brands give record_id null;
--             no "@" in it; non-Hosts staff refused; anon and PUBLIC cannot run
--   X-QUICK   quick add fills only what is missing (typed instructions and
--             done means kept; blank ones filled); without a host link the
--             words say "a host"; quick is never stored and never a bad-key
--             fix; quick "true" (a string) is not quick; only a quick add
--             gets brand_plan_source host_card; an agent's quick add names
--             the agent and stays hidden
--
-- FAILS-ON-REVERT (recorded in the #4270 W2 test report):
--   * 3980 ops_expected_event_set back          -> X-GONE fails
--   * W1 ops_work_add back (no D15, no quick)   -> X-SHOW, X-QUICK fail
--   * the D15 lines removed from ops_work_update -> X-SHOW fails
--   * 3980 ops_host_on_mingla back              -> X-READ fails
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tw_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tw_people (who, id, email) values
  ('boss',  '42710000-0000-4000-a0f0-000000000001', 'bola.w4270@test.local'),
  ('ops',   '42710000-0000-4000-a0f0-000000000002', 'kemi.w4270@test.local'),
  ('nocrm', '42710000-0000-4000-a0f0-000000000003', 'nnamdi.w4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tw_people;
insert into public.admin_users (email, role, status, accepted_at) values ('bola.w4270@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values ('kemi.w4270@test.local', 'growth', 'active', now());

create temp table tw_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tw_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.tw_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tw_people where who = p_who;
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

create function pg_temp.tw_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tw_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tw_next_request();
  return pg_temp.tw_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tw_agent(p_who text, p_sql text, p_tool text default 'update_work') returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tw_next_request();
  select id, email into strict v_id, v_email from tw_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', p_tool, pg_current_xact_id(), clock_timestamp());
  return pg_temp.tw_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tw_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 700), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tw_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 700), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tw_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tw_id(p_k text) returns uuid
language sql as $fn$ select id from tw_ids where k = p_k $fn$;

create function pg_temp.tw_rev(p_id uuid) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_id $fn$;

create function pg_temp.tw_flag(p_id uuid) returns text
language sql as $fn$ select coalesce(on_brand_plan::text, '<none>') from public.ops_work_cards where id = p_id $fn$;

create function pg_temp.tw_day(p_n integer) returns timestamptz
language sql as $fn$ select (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => p_n, hours => 18) $fn$;

create function pg_temp.tw_event(p_key text, p_brand uuid, p_title text, p_type text, p_vis text, p_status text, p_day integer, p_end_days integer default 0, p_deleted boolean default false) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text, deleted_at)
  values (v_id, p_brand, p_title, 'w4270-' || left(v_id::text, 8), p_vis, p_status, 'UTC',
          case when p_status = 'draft' then null else now() - interval '90 days' end, p_type, 'W4270 Road 2',
          case when p_deleted then now() - interval '1 day' end);
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  values (v_id, pg_temp.tw_day(p_day), pg_temp.tw_day(p_day + p_end_days) + interval '2 hours', true);
  set local session_replication_role = origin;
  insert into tw_ids (k, id) values (p_key, v_id);
end;
$fn$;

-- A card written directly (no function), linked to a host record.
create function pg_temp.tw_card(p_key text, p_title text, p_status text, p_owner text, p_due_days integer, p_host uuid,
                                p_archived boolean default false, p_watcher text default null) returns uuid
language plpgsql as $fn$
declare v_id uuid; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id,
    created_by, created_via, updated_by, closed_at, closed_by, close_kind, archived_at, archived_by, archive_reason)
  values (p_title, 'Do the work and write what changed.', 'Checked and done.', p_status,
    v_today + p_due_days, 'explicit', public.ops_sprint_ensure(v_today + p_due_days),
    'system@usemingla.com', 'system', 'system@usemingla.com',
    case when p_status = 'done' then now() end, case when p_status = 'done' then p_owner end, case when p_status = 'done' then 'done' end,
    case when p_archived then now() end, case when p_archived then p_owner end, case when p_archived then 'No longer needed.' end)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  if p_watcher is not null then
    insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_watcher, 'watcher', p_owner);
  end if;
  if p_host is not null then
    insert into public.ops_work_links (card_id, kind, target_id, label, added_by) values (v_id, 'host', p_host, 'host', p_owner);
  end if;
  insert into tw_ids (k, id) values (p_key, v_id);
  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures. Brand A: three live host records, one deleted older record.
-- Brand B: two records created at the same instant. Brand C: none.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at, profile_photo_url) values
  ('42710000-0000-4000-b0f0-00000000000a', '42710000-0000-4000-b1f0-00000000000a', 'W4270 Amber Brand', 'w4270-amber', 'Lagos', now() - interval '200 days', null),
  ('42710000-0000-4000-b0f0-00000000000b', '42710000-0000-4000-b1f0-00000000000b', 'W4270 Basil Brand', 'w4270-basil', 'Lagos', now() - interval '200 days', null),
  ('42710000-0000-4000-b0f0-00000000000c', '42710000-0000-4000-b1f0-00000000000c', 'W4270 Cedar Brand', 'w4270-cedar', 'Lagos', now() - interval '200 days', null);
insert into public.profiles (id, email, display_name, first_name, last_name) values
  ('42710000-0000-4000-a0f1-000000000001', 'ada.w4270@test.local', 'Ada W', null, null),
  ('42710000-0000-4000-a0f1-000000000002', 'femi.w4270@test.local', null, 'Femi', 'Okafor'),
  ('42710000-0000-4000-a0f1-000000000003', 'blank.w4270@test.local', '   ', null, null),
  ('42710000-0000-4000-a0f1-000000000004', 'left.w4270@test.local', 'Left W', null, null),
  ('42710000-0000-4000-a0f1-000000000005', 'asked.w4270@test.local', 'Asked W', null, null)
  on conflict (id) do nothing;
insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at) values
  ('42710000-0000-4000-b0f0-00000000000a', '42710000-0000-4000-a0f1-000000000002', 'scanner',     now() - interval '50 days', now() - interval '50 days', null),
  ('42710000-0000-4000-b0f0-00000000000a', '42710000-0000-4000-a0f1-000000000001', 'brand_owner', now() - interval '90 days', now() - interval '90 days', null),
  ('42710000-0000-4000-b0f0-00000000000a', '42710000-0000-4000-a0f1-000000000003', 'event_manager', now() - interval '40 days', now() - interval '40 days', null),
  ('42710000-0000-4000-b0f0-00000000000a', '42710000-0000-4000-a0f1-000000000004', 'brand_admin', now() - interval '60 days', now() - interval '60 days', now() - interval '2 days'),
  ('42710000-0000-4000-b0f0-00000000000a', '42710000-0000-4000-a0f1-000000000005', 'brand_admin', now() - interval '1 day', null, null);
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by, created_at, deleted_at, deleted_by) values
  ('42710000-0000-4000-c0f0-000000000000', 'hosts', 'W4270 Amber Gone',   'contacted',    '42710000-0000-4000-b0f0-00000000000a', 'event_organizer', 'w-fixture', 'w-fixture', now() - interval '300 days', now() - interval '3 days', 'w-fixture'),
  ('42710000-0000-4000-c0f0-000000000001', 'hosts', 'W4270 Amber Host',   'live',      '42710000-0000-4000-b0f0-00000000000a', 'event_organizer', 'w-fixture', 'w-fixture', now() - interval '100 days', null, null),
  ('42710000-0000-4000-c0f0-000000000002', 'hosts', 'W4270 Amber Second', 'onboarded', '42710000-0000-4000-b0f0-00000000000a', 'event_organizer', 'w-fixture', 'w-fixture', now() - interval '20 days', null, null),
  ('42710000-0000-4000-c0f0-000000000003', 'hosts', 'W4270 Amber Third',  'meeting',   '42710000-0000-4000-b0f0-00000000000a', 'event_organizer', 'w-fixture', 'w-fixture', now() - interval '5 days', null, null),
  ('42710000-0000-4000-c0f0-00000000000f', 'hosts', 'W4270 Basil Later Id', 'live',    '42710000-0000-4000-b0f0-00000000000b', 'event_organizer', 'w-fixture', 'w-fixture', '2026-01-01 00:00:00+00', null, null),
  ('42710000-0000-4000-c0f0-00000000000e', 'hosts', 'W4270 Basil Lower Id', 'live',    '42710000-0000-4000-b0f0-00000000000b', 'event_organizer', 'w-fixture', 'w-fixture', '2026-01-01 00:00:00+00', null, null),
  ('42710000-0000-4000-c0f0-000000000010', 'hosts', 'W4270 Brandless',    'contacted', null,                                    'event_organizer', 'w-fixture', 'w-fixture', now() - interval '10 days', null, null);
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('42710000-0000-4000-c0f0-000000000001', 'kemi.w4270@test.local', 'w-fixture'),
  ('42710000-0000-4000-c0f0-000000000001', 'bola.w4270@test.local', 'w-fixture'),
  ('42710000-0000-4000-c0f0-00000000000e', 'kemi.w4270@test.local', 'w-fixture');

select pg_temp.tw_event('ev',   '42710000-0000-4000-b0f0-00000000000a', 'W4270 Night Market', 'event',      'discover', 'scheduled', 9),
       pg_temp.tw_event('rsvp', '42710000-0000-4000-b0f0-00000000000a', 'W4270 Free Reading', 'rsvp',       'discover', 'scheduled', 11),
       pg_temp.tw_event('ex',   '42710000-0000-4000-b0f0-00000000000a', 'W4270 Clay Course',  'experience', 'discover', 'live',      -60, 70),
       pg_temp.tw_event('ptrip','42710000-0000-4000-b0f0-00000000000a', 'W4270 Secret Trip',  'trip',       'private',  'live',      -10, 20),
       pg_temp.tw_event('hid',  '42710000-0000-4000-b0f0-00000000000a', 'W4270 Hidden Party', 'event',      'hidden',   'draft',     14),
       pg_temp.tw_event('del',  '42710000-0000-4000-b0f0-00000000000a', 'W4270 Deleted Gig',  'event',      'discover', 'scheduled', 6, 0, true),
       pg_temp.tw_event('hidp', '42710000-0000-4000-b0f0-00000000000a', 'W4270 Hidden Past',  'event',      'hidden',   'ended',     -5),
       pg_temp.tw_event('pub',  '42710000-0000-4000-b0f0-00000000000a', 'W4270 Public Past',  'event',      'discover', 'scheduled', -4);

select pg_temp.tw_card('T1', 'W4270 First host, due in four', 'todo',  'kemi.w4270@test.local', 4, '42710000-0000-4000-c0f0-000000000001', false, 'bola.w4270@test.local'),
       pg_temp.tw_card('T2', 'W4270 Third host, late',        'doing', 'kemi.w4270@test.local', -3, '42710000-0000-4000-c0f0-000000000003'),
       pg_temp.tw_card('T3', 'W4270 Second host, due in four', 'todo', 'bola.w4270@test.local', 4, '42710000-0000-4000-c0f0-000000000002'),
       pg_temp.tw_card('T4', 'W4270 Deleted host card',        'todo', 'kemi.w4270@test.local', 1, '42710000-0000-4000-c0f0-000000000000'),
       pg_temp.tw_card('T5', 'W4270 Archived card',            'todo', 'kemi.w4270@test.local', 2, '42710000-0000-4000-c0f0-000000000001', true),
       pg_temp.tw_card('T6', 'W4270 Brandless own card',       'todo', 'kemi.w4270@test.local', 2, '42710000-0000-4000-c0f0-000000000010'),
       pg_temp.tw_card('T7', 'W4270 Done card',                'done', 'kemi.w4270@test.local', -1, '42710000-0000-4000-c0f0-000000000002'),
       pg_temp.tw_card('XS', 'W4270 Shown by a person',        'todo', 'kemi.w4270@test.local', 6, '42710000-0000-4000-c0f0-000000000001');

-- Promised dates saved before Wave 2 (written directly; nothing can add one now).
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, created_via, updated_by, updated_via) values
  ('42710000-0000-4000-d0f0-000000000001', '42710000-0000-4000-c0f0-000000000001', 'W4270 Promised Supper', 'event', (now() AT TIME ZONE 'UTC')::date + 25, 'none', 'kemi.w4270@test.local', null, 'kemi.w4270@test.local', null),
  ('42710000-0000-4000-d0f0-000000000002', '42710000-0000-4000-c0f0-000000000002', 'W4270 Second Promise',  'event', (now() AT TIME ZONE 'UTC')::date + 35, 'none', 'kemi.w4270@test.local', null, 'kemi.w4270@test.local', null),
  ('42710000-0000-4000-d0f0-000000000003', '42710000-0000-4000-c0f0-00000000000e', 'W4270 Basil Promise',   'event', (now() AT TIME ZONE 'UTC')::date + 15, 'none', 'kemi.w4270@test.local', null, 'kemi.w4270@test.local', null),
  ('42710000-0000-4000-d0f0-000000000004', '42710000-0000-4000-c0f0-000000000001', 'W4270 Promised Picnic',  'event', (now() AT TIME ZONE 'UTC')::date + 50, 'week', 'bola.w4270@test.local', null, 'bola.w4270@test.local', null);

-- A card anchored to the second record's promised date (no host link).
insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id, anchor_kind, anchor_id, created_by, created_via, updated_by)
values ('W4270 Anchored to the second promise', 'Do the work and write what changed.', 'Checked and done.', 'todo',
        (now() AT TIME ZONE 'UTC')::date + 4, 'explicit', public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date + 4),
        'expected', '42710000-0000-4000-d0f0-000000000002', 'system@usemingla.com', 'system', 'system@usemingla.com');
insert into tw_ids (k, id) select 'T8', id from public.ops_work_cards where title = 'W4270 Anchored to the second promise';
insert into public.ops_work_people (card_id, email, role, added_by) values (pg_temp.tw_id('T8'), 'kemi.w4270@test.local', 'owner', 'w-fixture');

-- Something Mingla did by itself on the host card (the read's "changes").
select public.ops_log_write('system@usemingla.com', 'system', 'updated', 'ok', pg_temp.tw_id('T1'), 'work_card', pg_temp.tw_id('T1'),
  'W4270 Card moved by itself for Amber', '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- X-SHOW (D15)
-- ---------------------------------------------------------------------------
do $show$
declare v_t text; v jsonb; v_due text := ((now() AT TIME ZONE 'UTC')::date + 5)::text; v_ev uuid; v_rev bigint;
begin
  -- a batch: the first card hidden, the second shown. Nothing is added.
  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_add(jsonb_build_array(
    jsonb_build_object('title', 'W4270 Agent hidden batch card', 'instructions', 'Do the work and write what changed.', 'done_means', 'Checked and done.',
      'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L),
    jsonb_build_object('title', 'W4270 Agent shown batch card', 'instructions', 'Do the work and write what changed.', 'done_means', 'Checked and done.',
      'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L, 'on_brand_plan', true)), 'w4270-show-0001')::text$q$, v_due, v_due), 'add_work');
  perform pg_temp.tw_like('X-SHOW', 'a batch with one shown card is refused whole', v_t, 'ERR:42501:people_only: A person decides what hosts see.%');
  perform pg_temp.tw_check('X-SHOW', 'and neither card of the batch exists',
    (select count(*) from public.ops_work_cards where title like 'W4270 Agent % batch card')::text, '0');

  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object('quick', true,
    'title', 'W4270 Agent quick shown', 'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L, 'on_brand_plan', true,
    'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', '42710000-0000-4000-c0f0-000000000001')))), 'w4270-show-0002')::text$q$, v_due), 'add_work');
  perform pg_temp.tw_like('X-SHOW', 'an agent''s quick add cannot show the host either', v_t, 'ERR:42501:people_only:%');

  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object(
    'title', 'W4270 Agent string true', 'instructions', 'Do the work and write what changed.', 'done_means', 'Checked and done.',
    'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L, 'on_brand_plan', 'true')), 'w4270-show-0003')::text$q$, v_due), 'add_work');
  perform pg_temp.tw_check('X-SHOW', 'a string "true" is a fix to make, never a switch',
    (pg_temp.tw_j(v_t) #>> '{results,0,status}') || '/' ||
    (select count(*) from jsonb_array_elements(pg_temp.tw_j(v_t) #> '{results,0,fixes}') f where f->>'field' = 'on_brand_plan')::text || '/' ||
    (select count(*) from public.ops_work_cards where title = 'W4270 Agent string true')::text, 'refused/1/0');

  -- update: off -> on with a title change in the same request.
  v_rev := pg_temp.tw_rev(pg_temp.tw_id('T1'));
  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true,"title":"W4270 Renamed by the agent"}'::jsonb, %s, 'w4270-show-0004')::text$q$,
    pg_temp.tw_id('T1'), v_rev));
  perform pg_temp.tw_like('X-SHOW', 'an agent cannot switch it on in an update', v_t, 'ERR:42501:people_only: A person decides what hosts see.%');
  perform pg_temp.tw_check('X-SHOW', 'and the rest of that request did not happen',
    (select title || '/' || on_brand_plan::text || '/' || (revision = v_rev)::text from public.ops_work_cards where id = pg_temp.tw_id('T1')),
    'W4270 First host, due in four/false/true');

  -- a person shows XS; the agent may hide it; nobody but a person can undo, and undo never shows it again.
  v_t := pg_temp.tw_person('ops', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true}'::jsonb, %s, 'w4270-show-0005')::text$q$,
    pg_temp.tw_id('XS'), pg_temp.tw_rev(pg_temp.tw_id('XS'))));
  perform pg_temp.tw_check('X-SHOW', 'a person switches it on', pg_temp.tw_flag(pg_temp.tw_id('XS')), 'true');
  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true}'::jsonb, %s, 'w4270-show-0006')::text$q$,
    pg_temp.tw_id('XS'), pg_temp.tw_rev(pg_temp.tw_id('XS'))));
  perform pg_temp.tw_check('X-SHOW', 'an agent sending true on a card already shown changes nothing and is no error',
    (pg_temp.tw_j(v_t) ? 'card')::text || '/' || pg_temp.tw_flag(pg_temp.tw_id('XS')), 'true/true');
  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_update(%L, '{"on_brand_plan":false}'::jsonb, %s, 'w4270-show-0007')::text$q$,
    pg_temp.tw_id('XS'), pg_temp.tw_rev(pg_temp.tw_id('XS'))));
  perform pg_temp.tw_check('X-SHOW', 'an agent may hide it', pg_temp.tw_flag(pg_temp.tw_id('XS')), 'false');
  select e.id into v_ev from public.ops_work_events e where e.card_id = pg_temp.tw_id('XS') order by e.at desc, e.id desc limit 1;
  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_undo(%L)::text$q$, v_ev));
  perform pg_temp.tw_like('X-SHOW', 'an agent cannot undo its hide (that would show it)', v_t, 'ERR:42501:%');
  v_t := pg_temp.tw_person('ops', format($q$select public.ops_work_undo(%L)::text$q$, v_ev));
  perform pg_temp.tw_check('X-SHOW', 'the person cannot undo the agent''s change either; the card stays hidden',
    (v_t like 'ERR:22023:undo_expired%')::text || '/' || pg_temp.tw_flag(pg_temp.tw_id('XS')), 'true/false');

  -- a person's own undo puts the flag back too, both ways (W2 rework P3-5:
  -- Undo never reports success while leaving the flag as it was).
  v_t := pg_temp.tw_person('ops', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true,"title":"W4270 Shown and renamed"}'::jsonb, %s, 'w4270-show-0008')::text$q$,
    pg_temp.tw_id('XS'), pg_temp.tw_rev(pg_temp.tw_id('XS'))));
  select e.id into v_ev from public.ops_work_events e where e.card_id = pg_temp.tw_id('XS') order by e.at desc, e.id desc limit 1;
  v_t := pg_temp.tw_person('ops', format($q$select public.ops_work_undo(%L)::text$q$, v_ev));
  perform pg_temp.tw_check('X-SHOW', 'undo puts the title back and switches Host can see this back off',
    (select title || '/' || on_brand_plan::text from public.ops_work_cards where id = pg_temp.tw_id('XS')), 'W4270 Shown by a person/false');
  v_t := pg_temp.tw_person('ops', format($q$select public.ops_work_update(%L, '{"on_brand_plan":false,"title":"W4270 Hidden and renamed"}'::jsonb, %s, 'w4270-show-0009')::text$q$,
    pg_temp.tw_id('XS'), pg_temp.tw_rev(pg_temp.tw_id('XS'))));
  select e.id into v_ev from public.ops_work_events e where e.card_id = pg_temp.tw_id('XS') order by e.at desc, e.id desc limit 1;
  v_t := pg_temp.tw_person('ops', format($q$select public.ops_work_undo(%L)::text$q$, v_ev));
  perform pg_temp.tw_check('X-SHOW', 'undo of a hide puts the title back and keeps it hidden',
    (select title || '/' || on_brand_plan::text from public.ops_work_cards where id = pg_temp.tw_id('XS')), 'W4270 Shown by a person/false');

  -- the schema: only the W2 readers and writers know the column; no client role writes the table.
  perform pg_temp.tw_check('X-SHOW', 'no other function in public names on_brand_plan',
    (select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ilike '%on_brand_plan%'
        and p.proname not in ('ops_validate_card','ops_work_add','ops_work_update','ops_card_json','ops_card_lite','ops_field_words','ops_work_undo')
        -- Wave 3: the brand plan reads and writes (people and the brand's own team; never an agent)
        and p.proname not like 'brand\_plan\_%' and p.proname not like 'ops\_brand\_plan%'), '');
  perform pg_temp.tw_check('X-SHOW', 'authenticated and anon cannot insert or update ops_work_cards',
    (has_table_privilege('authenticated', 'public.ops_work_cards', 'UPDATE') or has_table_privilege('authenticated', 'public.ops_work_cards', 'INSERT')
     or has_table_privilege('anon', 'public.ops_work_cards', 'UPDATE') or has_column_privilege('authenticated', 'public.ops_work_cards', 'on_brand_plan', 'UPDATE'))::text, 'false');
end;
$show$;

-- ---------------------------------------------------------------------------
-- X-GONE (D16)
-- ---------------------------------------------------------------------------
do $gone$
declare v_t text; v_on text := ((now() AT TIME ZONE 'UTC')::date + 45)::text; v_before bigint := (select count(*) from public.ops_expected_events);
begin
  v_t := pg_temp.tw_person('boss', format($q$select public.ops_expected_event_set(jsonb_build_object('record_id', '42710000-0000-4000-c0f0-000000000001',
    'title', 'W4270 Fresh promise', 'event_type', 'trip', 'expected_on', %L, 'repeats', 'month'), 'w4270-gone-0001')::text$q$, v_on));
  perform pg_temp.tw_like('X-GONE', 'an owner cannot add a repeating promised trip', v_t, 'ERR:22023:gone: Promised dates can no longer be added.%');
  v_t := pg_temp.tw_person('boss', $q$select public.ops_expected_event_set('{"record_id":"42710000-0000-4000-c0f0-000000000001","title":"W4270 Cancel a new one","event_type":"event","status":"cancelled","cancel_reason":"No longer"}'::jsonb, 'w4270-gone-0002')::text$q$);
  perform pg_temp.tw_like('X-GONE', 'a new one sent as cancelled is gone, not a cancel fix', v_t, 'ERR:22023:gone:%');
  v_t := pg_temp.tw_person('boss', $q$select public.ops_expected_event_set('{"title":"W4270 No record at all"}'::jsonb, 'w4270-gone-0003')::text$q$);
  perform pg_temp.tw_like('X-GONE', 'gone comes before the host check (no record_id)', v_t, 'ERR:22023:gone:%');
  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_expected_event_set(jsonb_build_object('record_id', '42710000-0000-4000-c0f0-000000000001',
    'title', 'W4270 Agent promise', 'event_type', 'event', 'expected_on', %L), 'w4270-gone-0004')::text$q$, v_on), 'set_expected_event');
  perform pg_temp.tw_like('X-GONE', 'the agent tool cannot add one', v_t, 'ERR:22023:gone:%');
  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_expected_event_set(jsonb_build_object('record_id', '42710000-0000-4000-c0f0-000000000001', 'id', null,
    'title', 'W4270 Agent null id', 'event_type', 'event', 'expected_on', %L), 'w4270-gone-0005')::text$q$, v_on), 'set_expected_event');
  perform pg_temp.tw_like('X-GONE', 'id null is a new one: gone', v_t, 'ERR:22023:gone:%');
  perform pg_temp.tw_check('X-GONE', 'not one promised event was added', ((select count(*) from public.ops_expected_events) - v_before)::text, '0');

  -- saved ones keep working
  v_t := pg_temp.tw_person('ops', format($q$select public.ops_expected_event_set(jsonb_build_object('record_id', '42710000-0000-4000-c0f0-000000000001',
    'id', '42710000-0000-4000-d0f0-000000000001', 'title', 'W4270 Promised Supper moved', 'expected_on', %L), 'w4270-gone-0006')::text$q$, v_on));
  perform pg_temp.tw_check('X-GONE', 'a saved one changes its title and date',
    (select title || '/' || expected_on::text from public.ops_expected_events where id = '42710000-0000-4000-d0f0-000000000001'), 'W4270 Promised Supper moved/' || v_on);
  v_t := pg_temp.tw_agent('ops', $q$select public.ops_expected_event_set('{"record_id":"42710000-0000-4000-c0f0-000000000001","id":"42710000-0000-4000-d0f0-000000000001","repeats":"month"}'::jsonb, 'w4270-gone-0007')::text$q$, 'set_expected_event');
  perform pg_temp.tw_check('X-GONE', 'an agent can still make a saved one repeat',
    (select repeats from public.ops_expected_events where id = '42710000-0000-4000-d0f0-000000000001'), 'month');
  v_t := pg_temp.tw_agent('ops', $q$select public.ops_expected_event_set('{"record_id":"42710000-0000-4000-c0f0-000000000001","id":"42710000-0000-4000-d0f0-000000000002","title":"W4270 Stolen promise"}'::jsonb, 'w4270-gone-0008')::text$q$, 'set_expected_event');
  perform pg_temp.tw_like('X-GONE', 'another host''s saved one is not found through this host', v_t, 'ERR:P0002:not_found:%');
  perform pg_temp.tw_check('X-GONE', 'and it is unchanged',
    (select title from public.ops_expected_events where id = '42710000-0000-4000-d0f0-000000000002'), 'W4270 Second Promise');
  v_t := pg_temp.tw_agent('ops', $q$select public.ops_expected_event_set('{"record_id":"42710000-0000-4000-c0f0-000000000001","id":"42710000-0000-4000-d0f0-000000000001","repeats":"none","status":"cancelled","cancel_reason":"The host made it in the Host app."}'::jsonb, 'w4270-gone-0009')::text$q$, 'set_expected_event');
  perform pg_temp.tw_check('X-GONE', 'an agent can still cancel a saved one',
    (select status from public.ops_expected_events where id = '42710000-0000-4000-d0f0-000000000001'), 'cancelled');

  -- the schema: one insert path, behind the guard; no test copy in a lasting schema.
  perform pg_temp.tw_check('X-GONE', 'only ops_expected_event_set inserts promised events (outside pg_temp)',
    (select coalesce(string_agg(n.nspname || '.' || p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%' and p.prosrc ~* 'insert\s+into\s+(public\.)?ops_expected_events'), 'public.ops_expected_event_set');
  perform pg_temp.tw_check('X-GONE', 'and its gone guard comes before its insert',
    (select (strpos(p.prosrc, 'gone: Promised dates') between 1 and strpos(p.prosrc, 'INSERT INTO public.ops_expected_events'))::text
       from pg_proc p where p.oid = 'public.ops_expected_event_set(jsonb,text)'::regprocedure), 'true');
  perform pg_temp.tw_check('X-GONE', 'no lasting function is the #3980 test copy of the old save',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname not like 'pg_temp%' and (p.proname like 't4270%' or p.prosrc like '%t4270_promise%'))::text, '0');
end;
$gone$;

-- ---------------------------------------------------------------------------
-- X-READ
-- ---------------------------------------------------------------------------
do $read$
declare v jsonb; v_b jsonb;
begin
  v := pg_temp.tw_j(pg_temp.tw_person('ops', $q$select public.ops_host_on_mingla('42710000-0000-4000-c0f0-000000000001')::text$q$));
  perform pg_temp.tw_check('X-READ', 'kinds, RSVP included; the experience on for 60 days is listed and live (a past one stays within 30 days, not live)',
    (select string_agg(replace(e->>'title', 'W4270 ', '') || ':' || (e->>'kind') || ':' || (e->>'live'), ',' order by e->>'start_at') from jsonb_array_elements(v->'events') e),
    'Clay Course:experience:true,Public Past:event:false,Night Market:event:false,Free Reading:rsvp:false');
  perform pg_temp.tw_check('X-READ', 'the private live trip, the hidden and the deleted events are nowhere in the read',
    (v::text ~ 'Secret Trip|Hidden Party|Deleted Gig|Hidden Past')::text, 'false');
  perform pg_temp.tw_check('X-READ', 'past lists the public past event',
    (select string_agg(replace(p->>'title', 'W4270 ', ''), ',') from jsonb_array_elements(v->'past') p where p->>'title' like 'W4270 Public%'), 'Public Past');
  perform pg_temp.tw_check('X-READ', 'To do: every live host record of the brand and the anchored card, oldest due first then card number',
    (select string_agg(replace(c->>'title', 'W4270 ', ''), '|' order by o) from jsonb_array_elements(v->'todo') with ordinality t(c, o)),
    (select string_agg(replace(w.title, 'W4270 ', ''), '|' order by w.due_on, w.number) from public.ops_work_cards w
      where w.id in (pg_temp.tw_id('T2'), pg_temp.tw_id('T1'), pg_temp.tw_id('T3'), pg_temp.tw_id('T8'), pg_temp.tw_id('XS'))));
  perform pg_temp.tw_check('X-READ', 'the deleted record''s, the archived, the done and the brandless cards are not in To do',
    (select count(*) from jsonb_array_elements(v->'todo') c where c->>'title' in ('W4270 Deleted host card','W4270 Archived card','W4270 Done card','W4270 Brandless own card'))::text, '0');
  perform pg_temp.tw_check('X-READ', 'the late doing card says overdue; owners and watchers by name',
    (select (c->>'overdue') || '/' || (c->>'status') from jsonb_array_elements(v->'todo') c where c->>'title' = 'W4270 Third host, late')
      || ' ' || (select (c #>> '{watchers,0,name}') from jsonb_array_elements(v->'todo') c where c->>'title' = 'W4270 First host, due in four'),
    'true/doing ' || public.ops_name('bola.w4270@test.local'));
  perform pg_temp.tw_check('X-READ', 'done this week counts the done card of the second record',
    v->>'done_count', '1');
  perform pg_temp.tw_check('X-READ', 'brand team by role order, removed and invited left out, a nameless member is A teammate',
    (select string_agg((m->>'name') || '/' || (m->>'role'), ',' order by o) from jsonb_array_elements(v #> '{team,brand_members}') with ordinality t(m, o)),
    'Ada W/brand_owner,A teammate/event_manager,Femi Okafor/scanner');
  perform pg_temp.tw_check('X-READ', 'the read carries changes, a promised date, owners and watchers',
    (jsonb_array_length(v->'changes') > 0 and jsonb_array_length(v->'expected') > 0 and jsonb_array_length(v #> '{team,owners}') = 2)::text, 'true');
  perform pg_temp.tw_check('X-READ', 'not one @ anywhere in the host read', (strpos(v::text, '@') = 0)::text, 'true');

  v_b := pg_temp.tw_j(pg_temp.tw_person('ops', $q$select public.ops_host_on_mingla('42710000-0000-4000-c0f0-000000000010')::text$q$));
  perform pg_temp.tw_check('X-READ', 'a host with no brand: no brand, no events, To do is only its own card',
    coalesce(v_b->>'brand', 'null') || ' ' || jsonb_array_length(v_b->'events') || ' '
      || (select string_agg(replace(c->>'title', 'W4270 ', ''), '|') from jsonb_array_elements(v_b->'todo') c)
      || ' ' || jsonb_array_length(v_b #> '{team,brand_members}'),
    'null 0 Brandless own card 0');
  perform pg_temp.tw_like('X-READ', 'a deleted host record is not found',
    pg_temp.tw_person('ops', $q$select public.ops_host_on_mingla('42710000-0000-4000-c0f0-000000000000')::text$q$), 'ERR:P0002:not_found:%');
  perform pg_temp.tw_like('X-READ', 'staff without Hosts access cannot read a host card',
    pg_temp.tw_person('nocrm', $q$select public.ops_host_on_mingla('42710000-0000-4000-c0f0-000000000001')::text$q$), 'ERR:42501:%');
end;
$read$;

-- ---------------------------------------------------------------------------
-- X-RECORD
-- ---------------------------------------------------------------------------
do $record$
declare v jsonb;
begin
  v := pg_temp.tw_j(pg_temp.tw_person('ops', $q$select public.ops_brand_host_record('42710000-0000-4000-b0f0-00000000000a')::text$q$));
  perform pg_temp.tw_check('X-RECORD', 'the oldest live record wins (the deleted older one is skipped); the others in order',
    (v->>'record_id') || ' ' || (v->>'other_record_ids'),
    '42710000-0000-4000-c0f0-000000000001 ["42710000-0000-4000-c0f0-000000000002", "42710000-0000-4000-c0f0-000000000003"]');
  perform pg_temp.tw_check('X-RECORD', 'owners are names, no @ anywhere',
    jsonb_array_length(v->'owners') || ' ' || (strpos(v::text, '@') = 0)::text, '2 true');
  v := pg_temp.tw_j(pg_temp.tw_person('ops', $q$select public.ops_brand_host_record('42710000-0000-4000-b0f0-00000000000b')::text$q$));
  perform pg_temp.tw_check('X-RECORD', 'two records made at the same instant: the lower id wins',
    (v->>'record_id') || ' ' || (v->>'name'), '42710000-0000-4000-c0f0-00000000000e W4270 Basil Lower Id');
  perform pg_temp.tw_check('X-RECORD', 'a brand with no host card, a null brand and an unknown one: record_id null',
    pg_temp.tw_person('ops', $q$select public.ops_brand_host_record('42710000-0000-4000-b0f0-00000000000c')::text$q$) || ' '
      || pg_temp.tw_person('ops', $q$select public.ops_brand_host_record(null)::text$q$) || ' '
      || pg_temp.tw_person('ops', $q$select public.ops_brand_host_record('42710000-0000-4000-b0f0-0000000000ff')::text$q$),
    '{"record_id": null} {"record_id": null} {"record_id": null}');
  perform pg_temp.tw_like('X-RECORD', 'staff without Hosts access are refused',
    pg_temp.tw_person('nocrm', $q$select public.ops_brand_host_record('42710000-0000-4000-b0f0-00000000000a')::text$q$), 'ERR:42501:%');
  perform pg_temp.tw_check('X-RECORD', 'anon and PUBLIC cannot run it; it is security definer with a fixed search_path',
    (has_function_privilege('anon', 'public.ops_brand_host_record(uuid)', 'EXECUTE')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'public.ops_brand_host_record(uuid)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text || '/'
      || (select p.prosecdef::text || '/' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.ops_brand_host_record(uuid)'::regprocedure),
    'false/true/search_path=pg_catalog, pg_temp');
end;
$record$;

-- ---------------------------------------------------------------------------
-- X-QUICK (C-6)
-- ---------------------------------------------------------------------------
do $quick$
declare v jsonb; v_t text; v_due text := ((now() AT TIME ZONE 'UTC')::date + 2)::text; v_id uuid;
begin
  v := pg_temp.tw_j(pg_temp.tw_person('ops', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object('quick', true,
    'title', 'W4270 Typed instructions kept', 'instructions', 'Ring the venue and confirm the date.', 'done_means', '   ',
    'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L, 'on_brand_plan', true,
    'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', '42710000-0000-4000-c0f0-000000000002')))), 'w4270-quick-0001')::text$q$, v_due)));
  v_id := (v #>> '{results,0,card,id}')::uuid;
  perform pg_temp.tw_check('X-QUICK', 'typed instructions are kept, a blank done means is filled for a shown card',
    (select instructions || ' | ' || done_means || ' | ' || brand_plan_source from public.ops_work_cards where id = v_id),
    'Ring the venue and confirm the date. | Done and the host is told in the Brand group. | host_card');

  v := pg_temp.tw_j(pg_temp.tw_person('ops', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object('quick', true,
    'title', 'W4270 Quick without a host', 'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L)), 'w4270-quick-0002')::text$q$, v_due)));
  v_id := (v #>> '{results,0,card,id}')::uuid;
  perform pg_temp.tw_check('X-QUICK', 'without a host link the words say a host; hidden by default',
    (select instructions || ' | ' || done_means || ' | ' || on_brand_plan::text from public.ops_work_cards where id = v_id),
    format('Added by %s from a host''s host card. | Done with proof on this card. | false', public.ops_actor_label('kemi.w4270@test.local', NULL)));

  v := pg_temp.tw_j(pg_temp.tw_person('ops', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object('quick', 'true',
    'title', 'W4270 String quick', 'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L)), 'w4270-quick-0003')::text$q$, v_due)));
  perform pg_temp.tw_check('X-QUICK', 'quick "true" (a string) is not quick: instructions and done means are fixes, quick is not',
    (v #>> '{results,0,status}') || ' ' ||
    (select string_agg(f->>'field', ',' order by f->>'field') from jsonb_array_elements(v #> '{results,0,fixes}') f), 'refused done_means,instructions');

  v := pg_temp.tw_j(pg_temp.tw_person('ops', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object('quick', false,
    'title', 'W4270 Full person add', 'instructions', 'Do the work and write what changed.', 'done_means', 'Checked and done.',
    'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L)), 'w4270-quick-0004')::text$q$, v_due)));
  v_id := (v #>> '{results,0,card,id}')::uuid;
  perform pg_temp.tw_check('X-QUICK', 'a plain add (quick false) is added with no source',
    (v #>> '{results,0,status}') || ' ' || (select coalesce(brand_plan_source, '-') from public.ops_work_cards where id = v_id), 'added -');
  perform pg_temp.tw_check('X-QUICK', 'quick is never stored on a card',
    (select count(*) from public.ops_work_cards w where w.title like 'W4270 %' and (to_jsonb(w) ? 'quick' or w.plan::text like '%quick%'))::text, '0');

  v_t := pg_temp.tw_agent('ops', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object('quick', true,
    'title', 'W4270 Agent quick hidden', 'owners', jsonb_build_array('kemi.w4270@test.local'), 'due_on', %L,
    'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', '42710000-0000-4000-c0f0-000000000001')))), 'w4270-quick-0005')::text$q$, v_due), 'add_work');
  v_id := (pg_temp.tw_j(v_t) #>> '{results,0,card,id}')::uuid;
  perform pg_temp.tw_check('X-QUICK', 'an agent''s quick add names the agent and stays hidden',
    (select (instructions = format('Added by %s from W4270 Amber Host''s host card.', public.ops_actor_label('kemi.w4270@test.local', 'claude')))::text
            || '/' || on_brand_plan::text from public.ops_work_cards where id = v_id), 'true/false');
end;
$quick$;

select count(*) as tw_total, count(*) filter (where not ok) as tw_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tw_failures
  from tw_results \gset
rollback;

-- The #3980 suites' copy of the old save lives in pg_temp, inside their
-- transaction: after a rollback it is gone from this session too.
begin;
\ir issue_4270_promised_event_before_d16.fixture.sql
select (to_regproc('pg_temp.t4270_promise_create') is not null) as tw_fixture_in \gset
rollback;
select (to_regproc('pg_temp.t4270_promise_create') is null
        and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname not like 'pg_temp%' and p.proname like 't4270%')) as tw_fixture_out \gset

select (:tw_total < 50 or :tw_failed > 0 or not :'tw_fixture_in'::boolean or not :'tw_fixture_out'::boolean) as tw_bad \gset
\if :tw_bad
  \echo 'ISSUE-4270 W2 TESTER FAILED:' :tw_failed 'of' :tw_total 'fixture in/out:' :tw_fixture_in :tw_fixture_out
  \echo :tw_failures
  do $$ begin raise exception 'ISSUE-4270 W2 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W2 TESTER PASS:' :tw_total 'checks, 0 failed; the #3980 test copy stays in pg_temp'
