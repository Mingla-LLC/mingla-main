-- Issue #4270 (Wave 2) -- implementor happy path for
-- 20280414014270_issue_4270_w2_host_card.sql, on the fully replayed PG17
-- schema.
-- MINGLA-INVARIANT: I-4270-NO-NEW-PROMISED-EVENTS | issue #4270 | ops_expected_event_set never adds a promised event (from a person or an agent); a saved one can still change, repeat, cancel or link (D9, D16).
-- MINGLA-INVARIANT: I-4270-AGENT-NEVER-SHOWS-HOSTS | issue #4270 | a request with via set can never switch on on_brand_plan (add or update); a person can (D15).
--
--   H-KIND    the host read lists an event, an experience and a trip with
--             their kind; a trip that began 40 days ago and ends next week is
--             listed and live; a private event and a hidden one are not
--   H-TODO    todo holds open cards linked to this host and to a second host
--             record of the same brand, oldest due first, with owners; a done
--             card and another brand's card are not in it
--   H-TEAM    team: Mingla owners by name and the brand's accepted team by
--             display name and role (a removed member and an invite are not
--             in it; no email); the brand carries photo_url and slug
--   H-ADD     a person's quick add from the host card: on_brand_plan false by
--             default, Mingla writes instructions and done means, source
--             host_card; with Host can see this on, done means says the host
--             is told; the card is in todo
--   H-AGENT   an agent cannot add a card with on_brand_plan true, nor switch
--             it on later (42501 people_only); a person can switch it on
--   H-GONE    a new promised event is refused (22023 gone) for a person and
--             for an agent through set_expected_event; a saved one still
--             changes repeats and cancels
--   H-RECORD  ops_brand_host_record: the oldest host record of the brand, the
--             others by id; none -> record_id null; a non-Hosts user -> 42501
--
--   R-LIVE    (rework P1-1) a trip on right now is Live now only, not Past
--   R-WEEK    (rework P3-1) done this week from Monday 00:00 in the viewer's
--             zone, over the same cards as To do
--   R-NAME    (rework P3-4) an owner address starting with _ . + - is never
--             returned; it reads "A teammate"
--   R-UNDO    (rework P3-5) Undo puts Host can see this back, both ways
--   R-COPY    (rework P3-3) a closed promised date points to the Host app
--
-- FAILS-ON-REVERT: put back the 3980 ops_expected_event_set -> H-GONE fails
-- (a person and an agent add a promised event); put back the W1 ops_work_add
-- -> H-AGENT and H-ADD fail; put back the 3980 ops_host_on_mingla -> H-KIND,
-- H-TODO and H-TEAM fail.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table th_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into th_people (who, id, email) values
  ('owner',  '42700000-0000-4000-a0f0-000000000001', 'oona.h4270@test.local'),
  ('growth', '42700000-0000-4000-a0f0-000000000003', 'gia.h4270@test.local'),
  ('nocrm',  '42700000-0000-4000-a0f0-000000000005', 'nora.h4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from th_people;
insert into public.admin_users (email, role, status, accepted_at) values ('oona.h4270@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values ('gia.h4270@test.local', 'growth', 'active', now());

create temp table th_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table th_ids (k text primary key, id uuid not null) on commit drop;
create function pg_temp.th_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from th_people where who = p_who;
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

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.th_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.th_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.th_next_request();
  return pg_temp.th_as(p_who, p_sql);
end;
$fn$;

-- A connected agent calling a function directly, as the gateway does.
create function pg_temp.th_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.th_next_request();
  select id, email into strict v_id, v_email from th_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.th_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.th_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into th_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.th_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into th_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.th_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.th_id(p_k text) returns uuid
language sql as $fn$ select id from th_ids where k = p_k $fn$;

create function pg_temp.th_rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from th_ids where k = p_k) $fn$;

create function pg_temp.th_row(p_k text) returns text
language sql as $fn$
  select w.status || '/' || coalesce(w.person_reason, '-') from public.ops_work_cards w where w.id = (select id from th_ids where k = p_k)
$fn$;

create function pg_temp.th_owners(p_k text) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '<none>') from public.ops_work_people p
   where p.card_id = (select id from th_ids where k = p_k) and p.role = 'owner'
$fn$;


create function pg_temp.th_day(p_n integer) returns timestamptz
language sql as $fn$ select (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => p_n, hours => 20) $fn$;

create function pg_temp.th_event(p_key text, p_brand uuid, p_title text, p_type text, p_vis text, p_status text, p_day integer, p_end_days integer default 0) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
  values (v_id, p_brand, p_title, 'h4270-' || left(v_id::text, 8), p_vis, p_status, 'UTC',
          case when p_status = 'draft' then null else now() - interval '60 days' end, p_type, 'H4270 Street 1');
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  values (v_id, pg_temp.th_day(p_day), pg_temp.th_day(p_day + p_end_days) + interval '3 hours', true);
  set local session_replication_role = origin;
  insert into th_ids (k, id) values (p_key, v_id);
end;
$fn$;

create function pg_temp.th_card(p_key text, p_title text, p_status text, p_owner text, p_due_days integer, p_host uuid) returns uuid
language plpgsql as $fn$
declare v_id uuid; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id,
    created_by, created_via, updated_by, closed_at, closed_by, close_kind)
  values (p_title, 'Do this task carefully and say what changed.', 'It is done and checked.', p_status,
    v_today + p_due_days, 'explicit', public.ops_sprint_ensure(v_today + p_due_days),
    'system@usemingla.com', 'system', 'system@usemingla.com',
    case when p_status = 'done' then now() end, case when p_status = 'done' then p_owner end, case when p_status = 'done' then 'done' end)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  insert into public.ops_work_links (card_id, kind, target_id, label, added_by) values (v_id, 'host', p_host, 'host', p_owner);
  insert into th_ids (k, id) values (p_key, v_id);
  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures: one brand with two host records, another brand, a team.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at, profile_photo_url) values
  ('42700000-0000-4000-b0f0-000000000001', '42700000-0000-4000-b1f0-000000000001', 'H4270 Palm Brand', 'h4270-palm', 'Lagos', now() - interval '90 days', 'https://example.test/palm.jpg'),
  ('42700000-0000-4000-b0f0-000000000002', '42700000-0000-4000-b1f0-000000000002', 'H4270 Other Brand', 'h4270-other', 'Lagos', now() - interval '90 days', null),
  ('42700000-0000-4000-b0f0-000000000003', '42700000-0000-4000-b1f0-000000000003', 'H4270 Lonely Brand', 'h4270-lonely', 'Lagos', now() - interval '90 days', null);
insert into public.profiles (id, email, display_name) values
  ('42700000-0000-4000-a0f1-000000000001', 'annie.h4270@test.local', 'Annie H'),
  ('42700000-0000-4000-a0f1-000000000002', 'tobi.h4270@test.local', 'Tobi H'),
  ('42700000-0000-4000-a0f1-000000000003', 'gone.h4270@test.local', 'Gone H'),
  ('42700000-0000-4000-a0f1-000000000004', 'invite.h4270@test.local', 'Invite H')
  on conflict (id) do nothing;
insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at) values
  ('42700000-0000-4000-b0f0-000000000001', '42700000-0000-4000-a0f1-000000000001', 'brand_owner', now() - interval '80 days', now() - interval '80 days', null),
  ('42700000-0000-4000-b0f0-000000000001', '42700000-0000-4000-a0f1-000000000002', 'marketing_manager', now() - interval '20 days', now() - interval '20 days', null),
  ('42700000-0000-4000-b0f0-000000000001', '42700000-0000-4000-a0f1-000000000003', 'scanner', now() - interval '30 days', now() - interval '30 days', now() - interval '1 day'),
  ('42700000-0000-4000-b0f0-000000000001', '42700000-0000-4000-a0f1-000000000004', 'brand_admin', now() - interval '2 days', null, null);
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by, created_at) values
  ('42700000-0000-4000-c0f0-000000000001', 'hosts', 'H4270 Palm Host', 'live', '42700000-0000-4000-b0f0-000000000001', 'event_organizer', 'h-fixture', 'h-fixture', now() - interval '60 days'),
  ('42700000-0000-4000-c0f0-000000000002', 'hosts', 'H4270 Palm Second', 'onboarded', '42700000-0000-4000-b0f0-000000000001', 'event_organizer', 'h-fixture', 'h-fixture', now() - interval '10 days'),
  ('42700000-0000-4000-c0f0-000000000003', 'hosts', 'H4270 Other Host', 'live', '42700000-0000-4000-b0f0-000000000002', 'event_organizer', 'h-fixture', 'h-fixture', now() - interval '60 days');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('42700000-0000-4000-c0f0-000000000001', 'gia.h4270@test.local', 'h-fixture'),
  ('42700000-0000-4000-c0f0-000000000003', 'gia.h4270@test.local', 'h-fixture');

select pg_temp.th_event('ev',   '42700000-0000-4000-b0f0-000000000001', 'H4270 Supper Club', 'event',      'discover', 'scheduled', 12),
       pg_temp.th_event('ex',   '42700000-0000-4000-b0f0-000000000001', 'H4270 Pottery Class', 'experience', 'discover', 'scheduled', 20),
       pg_temp.th_event('trip', '42700000-0000-4000-b0f0-000000000001', 'H4270 Long Trip',    'trip',       'discover', 'scheduled', -40, 47),
       pg_temp.th_event('priv', '42700000-0000-4000-b0f0-000000000001', 'H4270 Private Night', 'event',     'private',  'scheduled', 15),
       pg_temp.th_event('hid',  '42700000-0000-4000-b0f0-000000000001', 'H4270 Hidden Night',  'event',     'hidden',   'draft',     16);

select pg_temp.th_card('K1', 'H4270 Call Annie about the venue', 'todo',  'gia.h4270@test.local', 5, '42700000-0000-4000-c0f0-000000000001'),
       pg_temp.th_card('K2', 'H4270 Late recap for the second host', 'doing', 'gia.h4270@test.local', -2, '42700000-0000-4000-c0f0-000000000002'),
       pg_temp.th_card('K3', 'H4270 Done last week', 'done',  'gia.h4270@test.local', -1, '42700000-0000-4000-c0f0-000000000001'),
       pg_temp.th_card('K4', 'H4270 Another brand card', 'todo',  'gia.h4270@test.local', 1, '42700000-0000-4000-c0f0-000000000003');

-- A promised event saved before Wave 2 (written directly: nothing can add one now).
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, created_via, updated_by, updated_via)
values ('42700000-0000-4000-d0f0-000000000001', '42700000-0000-4000-c0f0-000000000001', 'H4270 Promised Brunch', 'event',
        (now() AT TIME ZONE 'UTC')::date + 30, 'none', 'gia.h4270@test.local', null, 'gia.h4270@test.local', null);

-- ---------------------------------------------------------------------------
-- H-KIND, H-TODO, H-TEAM
-- ---------------------------------------------------------------------------
do $read$
declare v jsonb;
begin
  v := pg_temp.th_j(pg_temp.th_person('growth', $q$select public.ops_host_on_mingla('42700000-0000-4000-c0f0-000000000001')::text$q$));
  perform pg_temp.th_check('H-KIND', 'events, experiences and trips each say their kind; private and hidden are off',
    (select string_agg(replace(e->>'title', 'H4270 ', '') || ':' || (e->>'kind'), ',' order by e->>'start_at') from jsonb_array_elements(v->'events') e),
    'Long Trip:trip,Supper Club:event,Pottery Class:experience');
  perform pg_temp.th_check('H-KIND', 'a trip that began 40 days ago and ends next week is live; the others are not',
    (select string_agg(replace(e->>'title', 'H4270 ', '') || ':' || (e->>'live'), ',' order by e->>'start_at') from jsonb_array_elements(v->'events') e),
    'Long Trip:true,Supper Club:false,Pottery Class:false');
  perform pg_temp.th_check('H-TODO', 'open cards for both host records of the brand, oldest due first; not done, not another brand',
    (select string_agg(replace(c->>'title', 'H4270 ', ''), '|' order by o) from jsonb_array_elements(v->'todo') with ordinality t(c, o)),
    'Late recap for the second host|Call Annie about the venue');
  perform pg_temp.th_check('H-TODO', 'each row has owners by name, overdue, on_brand_plan and files_url',
    (v #>> '{todo,0,owners,0,name}') || ' ' || (v #>> '{todo,0,overdue}') || ' ' || (v #>> '{todo,0,on_brand_plan}') || ' ' || ((v->'todo'->0) ? 'files_url')::text,
    public.ops_name('gia.h4270@test.local') || ' true false true');
  perform pg_temp.th_check('H-TEAM', 'Mingla owners by name, and no email anywhere in the read',
    (select string_agg(o->>'name', ',') from jsonb_array_elements(v #> '{team,owners}') o) || ' ' || (v::text ~ '"email"')::text,
    public.ops_name('gia.h4270@test.local') || ' false');
  perform pg_temp.th_check('H-TEAM', 'the brand team: accepted members by name and role, never an email',
    (select string_agg((m->>'name') || '/' || (m->>'role'), ',') from jsonb_array_elements(v #> '{team,brand_members}') m)
      || ' ' || ((v #> '{team,brand_members}')::text ~ '@')::text, 'Annie H/brand_owner,Tobi H/marketing_manager false');
  perform pg_temp.th_check('H-TEAM', 'the brand carries its photo and slug',
    (v #>> '{brand,photo_url}') || ' ' || (v #>> '{brand,slug}'), 'https://example.test/palm.jpg h4270-palm');
end;
$read$;

-- ---------------------------------------------------------------------------
-- H-ADD, H-AGENT
-- ---------------------------------------------------------------------------
do $add$
declare v jsonb; v_t text; v_due text := ((now() AT TIME ZONE 'UTC')::date + 3)::text; v_id uuid;
begin
  v := pg_temp.th_j(pg_temp.th_person('growth', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object(
    'quick', true, 'title', 'H4270 Chase the venue contract', 'owners', jsonb_build_array('gia.h4270@test.local'),
    'due_on', %L, 'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', '42700000-0000-4000-c0f0-000000000001')))), 'h4270-add-0001')::text$q$, v_due)));
  perform pg_temp.th_check('H-ADD', 'a quick add from the host card is added', v #>> '{results,0,status}', 'added');
  v_id := (v #>> '{results,0,card,id}')::uuid;
  perform pg_temp.th_check('H-ADD', 'Host can see this is off by default; the source is the host card',
    (select on_brand_plan::text || '/' || coalesce(brand_plan_source, '-') from public.ops_work_cards where id = v_id), 'false/host_card');
  perform pg_temp.th_check('H-ADD', 'Mingla writes the instructions and done means',
    (select instructions || ' | ' || done_means from public.ops_work_cards where id = v_id),
    format('Added by %s from H4270 Palm Host''s host card. | Done with proof on this card.', public.ops_actor_label('gia.h4270@test.local', NULL)));
  v := pg_temp.th_j(pg_temp.th_person('growth', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object(
    'quick', true, 'title', 'H4270 Share the poster with the host', 'owners', jsonb_build_array('gia.h4270@test.local'), 'on_brand_plan', true,
    'due_on', %L, 'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', '42700000-0000-4000-c0f0-000000000001')))), 'h4270-add-0002')::text$q$, v_due)));
  v_id := (v #>> '{results,0,card,id}')::uuid;
  perform pg_temp.th_check('H-ADD', 'with Host can see this on, the host is told when it is done',
    (select on_brand_plan::text || '/' || done_means from public.ops_work_cards where id = v_id), 'true/Done and the host is told in the Brand group.');
  perform pg_temp.th_check('H-ADD', 'the card JSON carries on_brand_plan and its source',
    (v #>> '{results,0,card,on_brand_plan}') || '/' || (v #>> '{results,0,card,brand_plan_source}'), 'true/host_card');
  v := pg_temp.th_j(pg_temp.th_person('growth', $q$select public.ops_host_on_mingla('42700000-0000-4000-c0f0-000000000001')::text$q$));
  perform pg_temp.th_check('H-ADD', 'both are in the host card''s To do',
    (select count(*) from jsonb_array_elements(v->'todo') c where c->>'title' in ('H4270 Chase the venue contract', 'H4270 Share the poster with the host'))::text, '2');
  v_t := pg_temp.th_person('growth', $q$select public.ops_work_add('[{"title":"H4270 Bad flag","on_brand_plan":"yes"}]'::jsonb, 'h4270-add-0003')::text$q$);
  perform pg_temp.th_check('H-ADD', 'Host can see this must be true or false',
    (select count(*) from jsonb_array_elements(pg_temp.th_j(v_t) #> '{results,0,fixes}') f where f->>'field' = 'on_brand_plan')::text, '1');

  v_t := pg_temp.th_agent('growth', format($q$select public.ops_work_add(jsonb_build_array(jsonb_build_object(
    'title', 'H4270 Agent shows the host', 'instructions', 'Do this task carefully and say what changed.', 'done_means', 'It is done and checked.',
    'owners', jsonb_build_array('gia.h4270@test.local'), 'on_brand_plan', true, 'due_on', %L)), 'h4270-add-0004')::text$q$, v_due));
  perform pg_temp.th_like('H-AGENT', 'an agent cannot add a card the host can see', v_t, 'ERR:42501:people_only: A person decides what hosts see.%');
  v_t := pg_temp.th_agent('growth', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true}'::jsonb, %s)::text$q$,
    pg_temp.th_id('K1'), (select revision from public.ops_work_cards where id = pg_temp.th_id('K1'))));
  perform pg_temp.th_like('H-AGENT', 'an agent cannot switch it on later', v_t, 'ERR:42501:people_only: A person decides what hosts see.%');
  v_t := pg_temp.th_person('growth', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true}'::jsonb, %s)::text$q$,
    pg_temp.th_id('K1'), (select revision from public.ops_work_cards where id = pg_temp.th_id('K1'))));
  perform pg_temp.th_check('H-AGENT', 'a person can',
    (pg_temp.th_j(v_t) #>> '{card,on_brand_plan}') || '/' || (select on_brand_plan::text from public.ops_work_cards where id = pg_temp.th_id('K1')), 'true/true');
  v_t := pg_temp.th_agent('growth', format($q$select public.ops_work_update(%L, '{"on_brand_plan":false}'::jsonb, %s)::text$q$,
    pg_temp.th_id('K1'), (select revision from public.ops_work_cards where id = pg_temp.th_id('K1'))));
  perform pg_temp.th_check('H-AGENT', 'an agent may switch it off (that hides, it never shows)',
    (select on_brand_plan::text from public.ops_work_cards where id = pg_temp.th_id('K1')), 'false');
end;
$add$;

-- ---------------------------------------------------------------------------
-- H-GONE
-- ---------------------------------------------------------------------------
do $gone$
declare v_t text; v_on text := ((now() AT TIME ZONE 'UTC')::date + 40)::text;
begin
  v_t := pg_temp.th_person('growth', format($q$select public.ops_expected_event_set(jsonb_build_object('record_id', '42700000-0000-4000-c0f0-000000000001',
    'title', 'H4270 New Promise', 'event_type', 'event', 'expected_on', %L), 'h4270-exp-0001')::text$q$, v_on));
  perform pg_temp.th_like('H-GONE', 'a person cannot add a promised event', v_t, 'ERR:22023:gone: Promised dates can no longer be added. Hosts create events in the Host app.');
  perform pg_temp.th_check('H-GONE', 'nothing was added',
    (select count(*) from public.ops_expected_events where title = 'H4270 New Promise')::text, '0');
  v_t := pg_temp.th_agent('growth', format($q$select public.ops_expected_event_set(jsonb_build_object('record_id', '42700000-0000-4000-c0f0-000000000001',
    'title', 'H4270 Agent Promise', 'event_type', 'event', 'expected_on', %L, 'id', null), 'h4270-exp-0002')::text$q$, v_on));
  perform pg_temp.th_like('H-GONE', 'an agent cannot either (id null is a new one)', v_t, 'ERR:22023:gone:%');
  v_t := pg_temp.th_person('growth', $q$select public.ops_expected_event_set('{"record_id":"42700000-0000-4000-c0f0-000000000001","id":"42700000-0000-4000-d0f0-000000000001","repeats":"week"}'::jsonb, 'h4270-exp-0003')::text$q$);
  perform pg_temp.th_check('H-GONE', 'a saved promised event still changes how often it repeats',
    coalesce(pg_temp.th_j(v_t) #>> '{status}', v_t) || '/' || (select repeats from public.ops_expected_events where id = '42700000-0000-4000-d0f0-000000000001'), 'updated/week');
  v_t := pg_temp.th_person('growth', $q$select public.ops_expected_event_set('{"record_id":"42700000-0000-4000-c0f0-000000000001","id":"42700000-0000-4000-d0f0-000000000001","status":"cancelled","cancel_reason":"The host moved it to the Host app."}'::jsonb, 'h4270-exp-0004')::text$q$);
  perform pg_temp.th_check('H-GONE', 'and can be cancelled',
    coalesce(pg_temp.th_j(v_t) #>> '{status}', v_t) || '/' || (select status from public.ops_expected_events where id = '42700000-0000-4000-d0f0-000000000001'), 'cancelled/cancelled');
end;
$gone$;

-- ---------------------------------------------------------------------------
-- H-RECORD
-- ---------------------------------------------------------------------------
do $record$
declare v jsonb; v_t text;
begin
  v := pg_temp.th_j(pg_temp.th_person('growth', $q$select public.ops_brand_host_record('42700000-0000-4000-b0f0-000000000001')::text$q$));
  perform pg_temp.th_check('H-RECORD', 'the oldest host record of the brand, the other by id, owners by name',
    (v->>'record_id') || ' ' || (v->>'name') || ' ' || (v->>'other_record_ids') || ' ' || (v #>> '{owners,0}'),
    format('42700000-0000-4000-c0f0-000000000001 H4270 Palm Host ["42700000-0000-4000-c0f0-000000000002"] %s', public.ops_name('gia.h4270@test.local')));
  v := pg_temp.th_j(pg_temp.th_person('growth', $q$select public.ops_brand_host_record('42700000-0000-4000-b0f0-000000000003')::text$q$));
  perform pg_temp.th_check('H-RECORD', 'a brand with no host card has none', v::text, '{"record_id": null}');
  v_t := pg_temp.th_person('nocrm', $q$select public.ops_brand_host_record('42700000-0000-4000-b0f0-000000000001')::text$q$);
  perform pg_temp.th_like('H-RECORD', 'someone without Hosts access is refused', v_t, 'ERR:42501:%');
  perform pg_temp.th_check('H-RECORD', 'anon cannot run it',
    has_function_privilege('anon', 'public.ops_brand_host_record(uuid)', 'EXECUTE')::text, 'false');
end;
$record$;

-- ---------------------------------------------------------------------------
-- Rework (tester W2): R-LIVE, R-WEEK, R-NAME, R-UNDO, R-COPY
-- ---------------------------------------------------------------------------
do $rework$
declare v jsonb; v_t text; v_today date := (now() AT TIME ZONE 'UTC')::date; v_mon date; v_d1 uuid; v_d2 uuid; v_d3 uuid;
        v_ev uuid := pg_temp.th_id('ev'); v_rev bigint; v_event uuid; v_base integer;
begin
  -- R-LIVE (P1-1): a trip on right now is Live now only, and not a past event.
  v := pg_temp.th_j(pg_temp.th_person('growth', $q$select public.ops_host_on_mingla('42700000-0000-4000-c0f0-000000000001')::text$q$));
  perform pg_temp.th_check('R-LIVE', 'the trip on right now says Live now, never Happened',
    (select (e #>> '{state,k}') || '/' || (e #>> '{state,name}') from jsonb_array_elements(v->'events') e where e->>'title' = 'H4270 Long Trip'), 'live/Live now');
  perform pg_temp.th_check('R-LIVE', 'and it is not under Past events',
    (select count(*) from jsonb_array_elements(v->'past') p where p->>'title' = 'H4270 Long Trip')::text, '0');
  perform pg_temp.th_check('R-LIVE', 'an event still to come keeps its plain state',
    (select (e #>> '{state,k}') <> 'live' and (e #>> '{state,k}') <> 'done' from jsonb_array_elements(v->'events') e where e->>'title' = 'H4270 Supper Club')::text, 'true');

  -- R-WEEK (P3-1): done this week starts at Monday 00:00 in the viewer's zone,
  -- over the same cards as To do (an event-anchored card counts too).
  v_mon := public.ops_monday(v_today);
  update public.ops_work_cards set closed_at = (v_mon - 3)::timestamp AT TIME ZONE 'UTC' where id = pg_temp.th_id('K3');
  v_d1 := pg_temp.th_card('D1', 'H4270 Done after the LA Monday', 'done', 'gia.h4270@test.local', 0, '42700000-0000-4000-c0f0-000000000001');
  v_d2 := pg_temp.th_card('D2', 'H4270 Done between the two Mondays', 'done', 'gia.h4270@test.local', 0, '42700000-0000-4000-c0f0-000000000002');
  v_d3 := pg_temp.th_card('D3', 'H4270 Done launch step of the brand', 'done', 'gia.h4270@test.local', 0, '42700000-0000-4000-c0f0-000000000001');
  update public.ops_work_cards set closed_at = (v_mon::timestamp AT TIME ZONE 'America/Los_Angeles') + interval '1 minute' where id = v_d1;
  update public.ops_work_cards set closed_at = (v_mon::timestamp AT TIME ZONE 'America/Los_Angeles') - interval '1 minute' where id = v_d2;
  delete from public.ops_work_links where card_id = v_d3;
  update public.ops_work_cards set anchor_kind = 'event', anchor_id = v_ev,
         closed_at = (v_mon::timestamp AT TIME ZONE 'America/Los_Angeles') + interval '2 minutes' where id = v_d3;
  v := pg_temp.th_j(pg_temp.th_person('growth', format($q$select public.ops_host_on_mingla('42700000-0000-4000-c0f0-000000000001', %L, 'America/Los_Angeles')::text$q$, v_today)));
  perform pg_temp.th_check('R-WEEK', 'in Los Angeles: closed after its Monday 00:00 (host-linked and event-anchored)', v->>'done_count', '2');
  perform pg_temp.th_check('R-WEEK', 'the read says when the week started',
    ((v->>'done_since')::timestamptz = (v_mon::timestamp AT TIME ZONE 'America/Los_Angeles'))::text, 'true');
  v := pg_temp.th_j(pg_temp.th_person('growth', format($q$select public.ops_host_on_mingla('42700000-0000-4000-c0f0-000000000001', %L, 'UTC')::text$q$, v_today)));
  perform pg_temp.th_check('R-WEEK', 'in UTC the card closed between the two Mondays counts too; last week''s does not', v->>'done_count', '3');
  v := pg_temp.th_j(pg_temp.th_person('growth', format($q$select public.ops_host_on_mingla('42700000-0000-4000-c0f0-000000000001', %L, 'Not/AZone')::text$q$, v_today)));
  perform pg_temp.th_check('R-WEEK', 'an unknown zone counts as UTC', v->>'done_count', '3');

  -- R-NAME (P3-4): an owner whose address starts with _ is "A teammate", never the address.
  insert into public.crm_record_owners (record_id, owner_email, added_by) values
    ('42700000-0000-4000-c0f0-000000000001', '_ops.w4270@test.local', 'h-fixture'),
    ('42700000-0000-4000-c0f0-000000000001', '+plus.w4270@test.local', 'h-fixture');
  v := pg_temp.th_j(pg_temp.th_person('growth', $q$select public.ops_host_on_mingla('42700000-0000-4000-c0f0-000000000001')::text$q$));
  perform pg_temp.th_check('R-NAME', 'the host read names them A teammate and carries no address',
    (select string_agg(o->>'name', ',' order by o->>'name') from jsonb_array_elements(v #> '{team,owners}') o where o->>'name' = 'A teammate') || ' ' || (v::text ~ 'w4270@')::text,
    'A teammate,A teammate false');
  v := pg_temp.th_j(pg_temp.th_person('growth', $q$select public.ops_brand_host_record('42700000-0000-4000-b0f0-000000000001')::text$q$));
  perform pg_temp.th_check('R-NAME', 'the Brand group host record has no address either', (v::text ~ '@')::text, 'false');
  perform pg_temp.th_check('R-NAME', 'ops_name never returns an address (_ . + -)',
    public.ops_name('_a@x.test') || '|' || public.ops_name('.b@x.test') || '|' || public.ops_name('+c@x.test') || '|' || public.ops_name('-d@x.test') || '|' || public.ops_name(null),
    'A teammate|A teammate|A teammate|A teammate|A teammate');
  perform pg_temp.th_check('R-NAME', 'an ordinary address keeps its email-made name', public.ops_name('tunde.a@x.test'), 'Tunde');

  -- R-UNDO (P3-5): a person's Undo puts Host can see this back, both ways.
  v_rev := pg_temp.th_rev('K1');
  v := pg_temp.th_j(pg_temp.th_person('growth', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true}'::jsonb, %s)::text$q$, pg_temp.th_id('K1'), v_rev)));
  v_event := (v->>'event_id')::uuid;
  perform pg_temp.th_check('R-UNDO', 'switching it on gives an undo', (v_event is not null)::text || '/' || (v #>> '{card,on_brand_plan}'), 'true/true');
  v_t := pg_temp.th_as('growth', format($q$select public.ops_work_undo(%L)::text$q$, v_event));
  perform pg_temp.th_check('R-UNDO', 'Undo switches it off again',
    coalesce(pg_temp.th_j(v_t) #>> '{card,on_brand_plan}', v_t) || '/' || (select on_brand_plan::text from public.ops_work_cards where id = pg_temp.th_id('K1')), 'false/false');
  update public.ops_work_cards set on_brand_plan = true where id = pg_temp.th_id('K1');
  v_rev := pg_temp.th_rev('K1');
  v := pg_temp.th_j(pg_temp.th_person('growth', format($q$select public.ops_work_update(%L, '{"on_brand_plan":false}'::jsonb, %s)::text$q$, pg_temp.th_id('K1'), v_rev)));
  v_t := pg_temp.th_as('growth', format($q$select public.ops_work_undo(%L)::text$q$, (v->>'event_id')::uuid));
  perform pg_temp.th_check('R-UNDO', 'Undo of switching it off switches it on again',
    (select on_brand_plan::text from public.ops_work_cards where id = pg_temp.th_id('K1')), 'true');

  -- R-COPY (P3-3): a closed promised date points to the Host app.
  v_t := pg_temp.th_person('growth', $q$select public.ops_expected_event_set('{"record_id":"42700000-0000-4000-c0f0-000000000001","id":"42700000-0000-4000-d0f0-000000000001","repeats":"none"}'::jsonb, 'h4270-exp-0005')::text$q$);
  perform pg_temp.th_check('R-COPY', 'a cancelled promised date says new events are made in the Host app',
    v_t, 'ERR:22023:expected_closed: This expected event was cancelled. New events are made in the Host app.');
end;
$rework$;

select count(*) as th_total, count(*) filter (where not ok) as th_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as th_failures
  from th_results \gset
rollback;

select (:th_total < 40 or :th_failed > 0) as th_bad \gset
\if :th_bad
  \echo 'ISSUE-4270 W2 FAILED:' :th_failed 'of' :th_total
  \echo :th_failures
  do $$ begin raise exception 'ISSUE-4270 W2 FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W2 PASS:' :th_total 'checks, 0 failed'
