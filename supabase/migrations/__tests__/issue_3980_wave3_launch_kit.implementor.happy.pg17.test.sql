-- Issue #3980 Wave 3 -- the launch kit, the giveaway and ads rule, go-live
-- gate cards, the Team dashboard overview and turning next steps into cards,
-- on the fully replayed PG17 schema.
-- MINGLA-INVARIANT: I-3980-RUNWAY-COMPUTED-AND-GATED | issue #3980 | Runway is computed from the public time and the first date, never typed: 28 days or more is full, 21 to 27 tight, under 21 organic; go-live gate cards close only when the event is public, and giveaway and ads cards stay blocked until it is public with 21 or more days left unless the owner or an admin overrides with a reason.
--
-- What it proves (each check is recorded and reported together):
--   W3-KIT       planning an event 40 days out proposes exactly the eight
--                kit steps, each due on its exact day, with host steps owned
--                by the host card's owner and marketing steps by the
--                planner; adding them keeps those dates; planning again
--                skips every step that has a card; an event 25 days out
--                keeps its go-live gate card although that date has passed;
--                an expected event is planned from its promised date; bad
--                options and unknown events are refused
--   W3-GATE      the giveaway and ads card is added held, waiting for
--                go-live; housekeeping leaves it held while the event is not
--                public; publishing with 30 days left frees it and closes
--                the go-live gate card itself with the public time as proof
--                and tells its owners; publishing with 15 days left holds it
--                as organic only
--   W3-OVERRIDE  only the owner or an admin, in person, with a reason, can
--                let a held card start; the reason is in the agent log and
--                housekeeping never holds it again
--   W3-TOOL      the connector's plan_work answers and its cards add
--   W3-OVERVIEW  the Team dashboard overview is for the owner and admins
--   W3-CONVERT   only the owner previews and converts next steps; the
--                preview writes nothing; each record is converted once; a
--                repeat changes nothing; host and creator records are never
--                changed; nothing was converted by the migration itself
--   W3-TITLES    a converted card is titled "<next step> · <record name>":
--                the same next step on two records gives two cards; two
--                records with the same name and next step give one card; a
--                long next step is cut with an ellipsis to the 160-character
--                title rule; the preview lists every skipped record with
--                its reason
--   W3-FREED     when housekeeping frees a held giveaway and ads card, its
--                owners and watchers are told and the agent log says so
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

create temp table t3980_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980_people (who, id, email) values
  ('owner',   '39800000-0000-4000-a000-000000000001', 'ed.w3980@test.local'),
  ('admin',   '39800000-0000-4000-a000-000000000002', 'di.w3980@test.local'),
  ('growth',  '39800000-0000-4000-a000-000000000003', 'ada.w3980@test.local'),
  ('growth2', '39800000-0000-4000-a000-000000000004', 'bo.w3980@test.local'),
  ('partner', '39800000-0000-4000-a000-000000000005', 'cy.w3980@test.local'),
  ('leaver',  '39800000-0000-4000-a000-000000000006', 'fay.w3980@test.local'),
  ('nobody',  '39800000-0000-4000-a000-000000000007', 'gus.w3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3980@test.local', 'owner', 'active', now()),
  ('di.w3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3980@test.local', 'growth', 'active', now()),
  ('bo.w3980@test.local', 'growth', 'active', now()),
  ('cy.w3980@test.local', 'partner', 'active', now()),
  ('fay.w3980@test.local', 'growth', 'revoked', now());

create temp table t3980_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980_ids (k text primary key, v text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980_people where who = p_who;
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

create function pg_temp.t3980_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980_id(p_k text) returns text
language sql as $fn$ select v from t3980_ids where k = p_k $fn$;

create function pg_temp.t3980_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.t3980_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

-- A person in a browser session.
create function pg_temp.t3980_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980_next_request();
  return pg_temp.t3980_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly: the request row
-- the connector writes first, in this transaction, then the call.
create function pg_temp.t3980_agent_sql(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980_next_request();
  select id, email into strict v_id, v_email from t3980_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.t3980_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.t3980_keep(p_label, pg_temp.t3980_j(v) ->> 'key');
  return v;
end;
$fn$;

-- One agent request through a gateway, the way the edge function makes it.
create function pg_temp.t3980_gw(p_label text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980_next_request();
  return pg_temp.t3980_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.t3980_digest(coalesce(pg_temp.t3980_id(p_label), p_label)), p_tool, p_args, 'issue3980-client/1.0'));
end;
$fn$;

create function pg_temp.t3980_work(p_label text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.t3980_gw(p_label, p_tool, p_args, 'ops_agent_call') $fn$;

create function pg_temp.t3980_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'w3980-fixture', 'w3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

create function pg_temp.t3980_touch(p_record uuid, p_ago interval) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
  values (p_record, 'touch', 'ada.w3980@test.local', 'whatsapp', 'outbound', 'Fixture outbound message', now() - p_ago)
$fn$;


select pg_temp.t3980_newkey('growth', 'claude', 'A') is not null as key_a;
select pg_temp.t3980_newkey('owner', 'claude', 'O') is not null as key_o;

-- Nothing was converted by the migration itself.
select pg_temp.t3980_keep('conversions_at_start', (select count(*)::text from public.ops_next_action_conversions));

-- ---------------------------------------------------------------------------
-- Fixtures. Day 0 is today at 00:00 UTC; each event starts at 20:00 UTC on
-- day N.
-- ---------------------------------------------------------------------------
create function pg_temp.t3980_day(p_n integer) returns timestamptz
language sql as $fn$ select (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => p_n, hours => 20) $fn$;

create function pg_temp.t3980_event(p_key text, p_title text, p_day integer) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
  values (v_id, '39800000-0000-4000-b200-000000000001', p_title,
          'w3980-' || lower(regexp_replace(p_title, '[^A-Za-z0-9]+', '-', 'g')) || '-' || left(v_id::text, 8),
          'draft', 'draft', 'UTC', null, 'event', 'W3980 Secret Street 9');
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  values (v_id, pg_temp.t3980_day(p_day), pg_temp.t3980_day(p_day) + interval '3 hours', true);
  set local session_replication_role = origin;
  perform pg_temp.t3980_keep(p_key, v_id::text);
end;
$fn$;

-- Make an event public on Mingla, listed p_lead days and one hour before it starts.
create function pg_temp.t3980_publish(p_key text, p_day integer, p_lead integer) returns void
language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  update public.events set visibility = 'discover', status = 'scheduled',
         published_at = pg_temp.t3980_day(p_day) - make_interval(days => p_lead, hours => 1)
   where id = pg_temp.t3980_id(p_key)::uuid;
  set local session_replication_role = origin;
end;
$fn$;

create function pg_temp.t3980_reconcile() returns text
language plpgsql as $fn$
begin
  return pg_temp.t3980_as('service', 'select public.ops_reconcile()::text');
end;
$fn$;

create function pg_temp.t3980_card(p_res text, p_step integer) returns jsonb
language sql as $fn$
  select e from jsonb_array_elements(coalesce(pg_temp.t3980_j(p_res)->'cards', '[]'::jsonb)) e where (e->>'kit_step')::integer = p_step
$fn$;

create function pg_temp.t3980_kit(p_anchor text, p_step integer) returns public.ops_work_cards
language sql as $fn$
  select w.* from public.ops_work_cards w where w.anchor_id = pg_temp.t3980_id(p_anchor)::uuid and w.kit_step = p_step and w.archived_at is null
$fn$;

set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b200-000000000001', '39800000-0000-4000-b300-000000000002', 'W3980 Linked Brand', 'w3980-linked-brand', 'Lagos');
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, created_by, updated_by) values
  ('39800000-0000-4000-c100-000000000001', 'hosts', 'W3980 Palm Host', 'onboarded', '39800000-0000-4000-b200-000000000001', 'w3980-fixture', 'w3980-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39800000-0000-4000-c100-000000000001', 'ada.w3980@test.local', 'w3980-fixture');

select pg_temp.t3980_keep('today', ((now() AT TIME ZONE 'UTC')::date)::text);
select pg_temp.t3980_keep('host', '39800000-0000-4000-c100-000000000001');

select pg_temp.t3980_event('e_kit', 'W3980 Kit Night', 40),
       pg_temp.t3980_event('e_late', 'W3980 Late Night', 30),
       pg_temp.t3980_event('e_mid', 'W3980 Mid Night', 25),
       pg_temp.t3980_event('e_agent', 'W3980 Agent Night', 45);

-- ---------------------------------------------------------------------------
-- W3-KIT: the eight steps, their days and their owners
-- ---------------------------------------------------------------------------
do $kit$
declare v text; v_today date := pg_temp.t3980_id('today')::date; s integer; v_want integer[] := array[5, 9, 12, 14, 19, 26, 33, 42];
        i integer := 0; v_add text; v_items jsonb;
begin
  v := pg_temp.t3980_person('growth2', format('select public.ops_launch_kit_preview(%L, %L, %L::jsonb, %L)::text',
         'event', pg_temp.t3980_id('e_kit'), '{"watcher_emails":["di.w3980@test.local"]}', v_today));
  perform pg_temp.t3980_check('W3-KIT', 'an event 40 days out gets exactly the eight kit steps, in order',
    (select string_agg(e->>'kit_step', ',' order by (e->>'kit_step')::integer) from jsonb_array_elements(pg_temp.t3980_j(v)->'cards') e),
    '-35,-31,-28,-26,-21,-14,-7,2');
  perform pg_temp.t3980_check('W3-KIT', 'nothing is skipped', jsonb_array_length(pg_temp.t3980_j(v)->'skipped')::text, '0');
  foreach s in array array[-35, -31, -28, -26, -21, -14, -7, 2] loop
    i := i + 1;
    perform pg_temp.t3980_check('W3-KIT', format('step %s is due on day %s', s, v_want[i]),
      pg_temp.t3980_card(v, s)->>'due_on', (v_today + v_want[i])::text);
  end loop;
  perform pg_temp.t3980_check('W3-KIT', 'host steps are owned by the host card''s owner',
    (select string_agg(distinct e->'owners'->>0, ',') from jsonb_array_elements(pg_temp.t3980_j(v)->'cards') e
      where (e->>'kit_step')::integer in (-35, -31, -28, 2)), 'ada.w3980@test.local');
  perform pg_temp.t3980_check('W3-KIT', 'marketing steps are owned by the person planning',
    (select string_agg(distinct e->'owners'->>0, ',') from jsonb_array_elements(pg_temp.t3980_j(v)->'cards') e
      where (e->>'kit_step')::integer in (-26, -21, -14, -7)), 'bo.w3980@test.local');
  perform pg_temp.t3980_check('W3-KIT', 'the watcher named is on every card',
    (select count(*) from jsonb_array_elements(pg_temp.t3980_j(v)->'cards') e where e->'watchers' = '["di.w3980@test.local"]'::jsonb)::text, '8');
  perform pg_temp.t3980_check('W3-KIT', 'the gate title names the go-live day',
    pg_temp.t3980_card(v, -28)->>'title', 'Go-live gate: W3980 Kit Night public by ' || to_char(v_today + 12, 'FMDD Mon'));
  perform pg_temp.t3980_check('W3-KIT', 'the host is named in the instructions',
    (pg_temp.t3980_card(v, -35)->>'instructions' like 'Ask W3980 Palm Host for the flyer%')::text, 'true');
  perform pg_temp.t3980_check('W3-KIT', 'kinds: one go-live gate card and one giveaway and ads card',
    (pg_temp.t3980_card(v, -28)->>'kind') || '/' || (pg_temp.t3980_card(v, -21)->>'kind') || '/' || (pg_temp.t3980_card(v, -14)->>'kind'),
    'gate_live/promo/task');
  perform pg_temp.t3980_check('W3-KIT', 'each card links the event and the host card',
    (pg_temp.t3980_card(v, 2)->'links' @> jsonb_build_array(jsonb_build_object('kind', 'host', 'id', pg_temp.t3980_id('host')),
      jsonb_build_object('kind', 'event', 'id', pg_temp.t3980_id('e_kit'))))::text, 'true');
  perform pg_temp.t3980_check('W3-KIT', 'the giveaway rule says the card will wait for go-live',
    pg_temp.t3980_j(v)->'promo_gate'->>'kind', 'waiting_go_live');
  perform pg_temp.t3980_check('W3-KIT', 'planning writes nothing',
    (select count(*) from public.ops_work_cards where anchor_id = pg_temp.t3980_id('e_kit')::uuid)::text, '0');

  -- the proposed cards add as they are
  v_add := pg_temp.t3980_person('growth2', format('select public.ops_work_add(%L::jsonb, %L)::text', pg_temp.t3980_j(v)->'cards', 'w3980-kit-add-1'));
  perform pg_temp.t3980_check('W3-KIT', 'the eight proposed cards add as they are',
    pg_temp.t3980_get(v_add, 'added') || '/' || pg_temp.t3980_get(v_add, 'refused') || '/' || pg_temp.t3980_get(v_add, 'duplicate'), '8/0/0');
  perform pg_temp.t3980_check('W3-KIT', 'each added card keeps its kit day and follows the event',
    (select string_agg(w.kit_step || ':' || (w.due_on - v_today) || ':' || w.due_source, ',' order by w.kit_step) from public.ops_work_cards w
      where w.anchor_id = pg_temp.t3980_id('e_kit')::uuid),
    '-35:5:kit,-31:9:kit,-28:12:kit,-26:14:kit,-21:19:kit,-14:26:kit,-7:33:kit,2:42:kit');

  v := pg_temp.t3980_person('growth2', format('select public.ops_launch_kit_preview(%L, %L, %L::jsonb, %L)::text', 'event', pg_temp.t3980_id('e_kit'), '{}', v_today));
  perform pg_temp.t3980_check('W3-KIT', 'planning again proposes nothing and skips every step that has a card',
    jsonb_array_length(pg_temp.t3980_j(v)->'cards') || '/' ||
    (select count(*) from jsonb_array_elements(pg_temp.t3980_j(v)->'skipped') e where e->>'reason' = 'card_exists' and e->'card'->>'id' is not null), '0/8');

  -- 25 days out, not public: the first steps have passed, the go-live
  -- gate card is kept although its day has passed (go-live is still possible)
  v := pg_temp.t3980_person('growth2', format('select public.ops_launch_kit_preview(%L, %L, %L::jsonb, %L)::text', 'event', pg_temp.t3980_id('e_mid'), '{}', v_today));
  perform pg_temp.t3980_check('W3-KIT', 'an event 25 days out skips the three steps whose day has passed',
    (select string_agg((e->>'kit_step') || ':' || (e->>'reason'), ',' order by (e->>'kit_step')::integer) from jsonb_array_elements(pg_temp.t3980_j(v)->'skipped') e),
    '-35:date_passed,-31:date_passed,-26:date_passed');
  perform pg_temp.t3980_check('W3-KIT', 'and keeps the go-live gate card, due three days ago',
    pg_temp.t3980_card(v, -28)->>'due_on', (v_today - 3)::text);
  v_items := jsonb_build_array(pg_temp.t3980_card(v, -28));
  v_add := pg_temp.t3980_person('growth2', format('select public.ops_work_add(%L::jsonb, %L)::text', v_items, 'w3980-mid-add-1'));
  perform pg_temp.t3980_check('W3-KIT', 'that gate card adds with its kit day',
    pg_temp.t3980_get(v_add, 'added') || '/' || (select w.due_source || ':' || (w.due_on - v_today) from public.ops_work_cards w
      where w.anchor_id = pg_temp.t3980_id('e_mid')::uuid and w.kit_step = -28), '1/kit:-3');

  -- an expected event is planned from its promised date
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', pg_temp.t3980_id('host'), 'title', 'W3980 Promised Night', 'event_type', 'event', 'expected_on', v_today + 50),
         'w3980-exp-1'));
  perform pg_temp.t3980_keep('x_exp', pg_temp.t3980_get(v, 'expected', 'id'));
  v := pg_temp.t3980_person('growth', format('select public.ops_launch_kit_preview(%L, %L, %L::jsonb, %L)::text', 'expected', pg_temp.t3980_id('x_exp'), '{}', v_today));
  perform pg_temp.t3980_check('W3-KIT', 'an expected event 50 days out gets the eight steps from its promised date',
    jsonb_array_length(pg_temp.t3980_j(v)->'cards') || '/' || (pg_temp.t3980_card(v, -35)->>'due_on') || '/' || (pg_temp.t3980_card(v, -35)->'anchor'->>'kind'),
    '8/' || (v_today + 15)::text || '/expected');

  -- refusals
  v := pg_temp.t3980_person('growth', format('select public.ops_launch_kit_preview(%L, %L, %L::jsonb)::text', 'event', pg_temp.t3980_id('e_kit'), '{"host_owner_emails":["stranger@example.com"]}'));
  perform pg_temp.t3980_like('W3-KIT', 'an owner who is not on the team is refused', v, 'ERR:22023:invalid_owners: "stranger@example.com" is not on the team.%');
  v := pg_temp.t3980_person('growth', format('select public.ops_launch_kit_preview(%L, %L, %L::jsonb)::text', 'event', pg_temp.t3980_id('e_kit'), '{"owners":["ada.w3980@test.local"]}'));
  perform pg_temp.t3980_like('W3-KIT', 'an unknown option is refused', v, 'ERR:22023:invalid_options:%');
  v := pg_temp.t3980_person('growth', format('select public.ops_launch_kit_preview(%L, %L)::text', 'event', gen_random_uuid()));
  perform pg_temp.t3980_like('W3-KIT', 'an event that is not there is refused', v, 'ERR:P0002:not_found:%');
  v := pg_temp.t3980_person('nobody', format('select public.ops_launch_kit_preview(%L, %L)::text', 'event', pg_temp.t3980_id('e_kit')));
  perform pg_temp.t3980_like('W3-KIT', 'someone off the team cannot plan', v, 'ERR:42501:%');
  v := pg_temp.t3980_as('anon', format('select public.ops_launch_kit_preview(%L, %L)::text', 'event', pg_temp.t3980_id('e_kit')));
  perform pg_temp.t3980_like('W3-KIT', 'anon cannot plan', v, 'ERR:42501:%');
end;
$kit$;

-- ---------------------------------------------------------------------------
-- W3-GATE: held until go-live; the gate card closes itself
-- ---------------------------------------------------------------------------
do $gate$
declare v text; c public.ops_work_cards; v_today date := pg_temp.t3980_id('today')::date; v_add text; v_items jsonb;
begin
  c := pg_temp.t3980_kit('e_kit', -21);
  perform pg_temp.t3980_check('W3-GATE', 'the giveaway and ads card is added held, waiting for go-live',
    c.blocked || '/' || c.blocked_kind || '/' || c.blocked_reason,
    'true/waiting_go_live/Waiting for go-live: W3980 Kit Night must be public with at least 21 days left (by ' || to_char(v_today + 19, 'FMDD Mon') || ').');

  perform pg_temp.t3980_reconcile();
  c := pg_temp.t3980_kit('e_kit', -21);
  perform pg_temp.t3980_check('W3-GATE', 'housekeeping leaves it held while the event is not public', c.blocked_kind, 'waiting_go_live');
  perform pg_temp.t3980_check('W3-GATE', 'and leaves the go-live gate card open', (pg_temp.t3980_kit('e_kit', -28)).status, 'todo');

  -- public with 30 days left: free to start, and the gate closes itself
  perform pg_temp.t3980_publish('e_kit', 40, 30);
  v := pg_temp.t3980_reconcile();
  perform pg_temp.t3980_check('W3-GATE', 'housekeeping reports one card freed and one gate closed',
    pg_temp.t3980_get(v, 'promo_unblocked') || '/' || pg_temp.t3980_get(v, 'gates_closed'), '1/1');
  c := pg_temp.t3980_kit('e_kit', -21);
  perform pg_temp.t3980_check('W3-GATE', 'published with 30 days left, the giveaway and ads card is free to start',
    c.blocked::text || '/' || coalesce(c.blocked_kind, '-'), 'false/-');
  perform pg_temp.t3980_check('W3-GATE', 'the agent log says go-live was met',
    (select summary from public.ops_agent_log where card_id = c.id and action = 'unblocked' order by id desc limit 1),
    format('Card %s: Go-live met: 30 days ahead.', c.number));
  perform pg_temp.t3980_check('W3-FREED', 'freeing the giveaway and ads card is one agent log entry by housekeeping',
    (select count(*) || '/' || min(via) || '/' || min(outcome) from public.ops_agent_log where card_id = c.id and action = 'unblocked'), '1/system/info');
  perform pg_temp.t3980_check('W3-FREED', 'every owner and watcher of the freed card is told',
    (select string_agg(p.who, ',' order by p.who) from public.team_mentions m join t3980_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and m.deep_link like '%' || c.id::text
        and m.body_excerpt = 'Go-live met: W3980 Kit Night is public on Mingla with 30 days left. The giveaway and ads card can start.'),
    (select string_agg(p.who, ',' order by p.who) from public.ops_work_people wp join t3980_people p on p.email = wp.email where wp.card_id = c.id));
  perform pg_temp.t3980_check('W3-FREED', 'the watcher named when the kit was planned is among them',
    (select count(*) from public.team_mentions m join t3980_people p on p.id = m.target_user_id
       join public.ops_work_people wp on wp.card_id = c.id and wp.email = p.email and wp.role = 'watcher'
      where p.who = 'admin' and m.source_kind = 'work_card' and m.deep_link like '%' || c.id::text
        and m.body_excerpt like 'Go-live met: W3980 Kit Night is public on Mingla with 30 days left.%')::text, '1');
  c := pg_temp.t3980_kit('e_kit', -28);
  perform pg_temp.t3980_check('W3-GATE', 'the go-live gate card closed itself',
    c.status || '/' || c.close_kind || '/' || c.closed_via || '/' || c.closed_by, 'done/system/system/system@usemingla.com');
  perform pg_temp.t3980_check('W3-GATE', 'its proof is the public time, checked by Mingla',
    (c.proof->0->>'kind') || '/' || (c.proof->0->>'verified') || '/' || (c.proof->0->>'id') || '/' || (c.proof->0->>'text'),
    'event_public/true/' || pg_temp.t3980_id('e_kit') || '/Public on Mingla since ' || to_char(v_today + 10, 'FMDD Mon') || ', 30 days before it starts.');
  perform pg_temp.t3980_check('W3-GATE', 'the gate closing is in the agent log',
    (select count(*) from public.ops_agent_log where card_id = c.id and action = 'gate_closed' and via = 'system')::text, '1');
  perform pg_temp.t3980_check('W3-GATE', 'its owner is told',
    (select count(*) from public.team_mentions m join t3980_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and p.who = 'growth' and m.deep_link like '%' || c.id::text
        and m.body_excerpt = 'Go-live met: W3980 Kit Night is public on Mingla. The gate card closed itself.')::text, '1');
  v := pg_temp.t3980_reconcile();
  perform pg_temp.t3980_check('W3-GATE', 'a second run changes nothing',
    pg_temp.t3980_get(v, 'promo_unblocked') || '/' || pg_temp.t3980_get(v, 'promo_blocked') || '/' || pg_temp.t3980_get(v, 'gates_closed'), '0/0/0');

  -- 30 days out, planned now: then published with only 15 days left
  v := pg_temp.t3980_person('growth2', format('select public.ops_launch_kit_preview(%L, %L, %L::jsonb, %L)::text', 'event', pg_temp.t3980_id('e_late'), '{}', v_today));
  v_add := pg_temp.t3980_person('growth2', format('select public.ops_work_add(%L::jsonb, %L)::text', pg_temp.t3980_j(v)->'cards', 'w3980-late-add-1'));
  perform pg_temp.t3980_check('W3-GATE', 'an event 30 days out gets its six remaining steps', pg_temp.t3980_get(v_add, 'added'), '6');
  perform pg_temp.t3980_publish('e_late', 30, 15);
  perform pg_temp.t3980_reconcile();
  c := pg_temp.t3980_kit('e_late', -21);
  perform pg_temp.t3980_check('W3-GATE', 'published with 15 days left, the giveaway and ads card is organic only',
    c.blocked || '/' || c.blocked_kind || '/' || c.blocked_reason,
    -- [TEST-MOD-APPROVED #3980] synced Wave 3 rework 2 (deviation 6): the reason uses the four plain states; the kind stays organic_only.
    'true/organic_only/Too late for promo: W3980 Late Night went live 15 days before it starts, under 3 weeks, so it gets posts only. No giveaway or ads.');
  perform pg_temp.t3980_check('W3-GATE', 'its gate card still closes itself, saying 15 days',
    (pg_temp.t3980_kit('e_late', -28)).status || '/' || ((pg_temp.t3980_kit('e_late', -28)).proof->0->>'text'),
    'done/Public on Mingla since ' || to_char(v_today + 15, 'FMDD Mon') || ', 15 days before it starts.');
  perform pg_temp.t3980_keep('late_promo', c.id::text);
  perform pg_temp.t3980_keep('late_rev', c.revision::text);

  -- a person cannot free it by hand, and an agent cannot start it
  v := pg_temp.t3980_person('growth2', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', c.id, '{"blocked":false}', c.revision));
  perform pg_temp.t3980_like('W3-GATE', 'unblocking it by hand is refused', v, 'ERR:42501:gate_blocked:%');
end;
$gate$;

-- ---------------------------------------------------------------------------
-- W3-OVERRIDE: owner or admin, in person, with a reason
-- ---------------------------------------------------------------------------
do $over$
declare v text; c public.ops_work_cards; v_id text := pg_temp.t3980_id('late_promo');
begin
  v := pg_temp.t3980_person('growth2', format('select public.ops_gate_override(%L, %L)::text', v_id, 'The host is paying for the boost themselves.'));
  perform pg_temp.t3980_like('W3-OVERRIDE', 'a Sales and marketing teammate cannot override', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980_person('partner', format('select public.ops_gate_override(%L, %L)::text', v_id, 'The host is paying for the boost themselves.'));
  perform pg_temp.t3980_like('W3-OVERRIDE', 'a founding partner cannot override', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980_agent_sql('owner', 'claude', format('select public.ops_gate_override(%L, %L)::text', v_id, 'The host is paying for the boost themselves.'));
  perform pg_temp.t3980_like('W3-OVERRIDE', 'the owner''s agent cannot override', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980_person('owner', format('select public.ops_gate_override(%L, %L)::text', v_id, ''));
  perform pg_temp.t3980_like('W3-OVERRIDE', 'the owner without a reason is refused', v, 'ERR:22023:reason_required:%');
  v := pg_temp.t3980_person('owner', format('select public.ops_gate_override(%L, %L)::text', v_id, 'too short'));
  perform pg_temp.t3980_like('W3-OVERRIDE', 'a reason under 10 characters is refused', v, 'ERR:22023:reason_required:%');
  c := (select w from public.ops_work_cards w where w.id = v_id::uuid);
  perform pg_temp.t3980_check('W3-OVERRIDE', 'after every refusal the card is still held', c.blocked_kind, 'organic_only');

  v := pg_temp.t3980_person('admin', format('select public.ops_gate_override(%L, %L)::text', v_id, 'The host is paying for the boost themselves.'));
  perform pg_temp.t3980_check('W3-OVERRIDE', 'an admin with a reason lets it start',
    pg_temp.t3980_get(v, 'card', 'blocked') || '/' || pg_temp.t3980_get(v, 'card', 'override', 'reason') || '/' || pg_temp.t3980_get(v, 'card', 'override', 'by_name'),
    'false/The host is paying for the boost themselves./Di');
  perform pg_temp.t3980_like('W3-OVERRIDE', 'the reason is in the agent log under the admin''s name',
    (select summary from public.ops_agent_log where card_id = v_id::uuid and action = 'gate_override' and actor_email = 'di.w3980@test.local' and via is null),
    'Di let Card % start before go-live: The host is paying for the boost themselves.');
  perform pg_temp.t3980_check('W3-OVERRIDE', 'the card''s owner is told, with the reason',
    (select count(*) from public.team_mentions m join t3980_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and p.who = 'growth2' and m.deep_link like '%' || v_id
        and m.body_excerpt like '%start before go-live: The host is paying for the boost themselves.')::text, '1');
  perform pg_temp.t3980_reconcile();
  perform pg_temp.t3980_check('W3-OVERRIDE', 'housekeeping never holds an overridden card again',
    (select blocked::text from public.ops_work_cards where id = v_id::uuid), 'false');
  v := pg_temp.t3980_person('owner', format('select public.ops_gate_override(%L, %L)::text', v_id, 'The host is paying for the boost themselves.'));
  perform pg_temp.t3980_like('W3-OVERRIDE', 'a card that is not held cannot be overridden', v, 'ERR:22023:not_blocked:%');
end;
$over$;

-- ---------------------------------------------------------------------------
-- W3-TOOL: plan_work through the connector
-- ---------------------------------------------------------------------------
do $tool$
declare v text; v_add text;
begin
  v := pg_temp.t3980_work('A', 'plan_work', format('{"event_id":"%s"}', pg_temp.t3980_id('e_agent')));
  perform pg_temp.t3980_check('W3-TOOL', 'plan_work answers with the eight steps',
    pg_temp.t3980_get(v, 'ok') || '/' || jsonb_array_length(pg_temp.t3980_j(v)->'result'->'cards'), 'true/8');
  perform pg_temp.t3980_check('W3-TOOL', 'the marketing steps go to the agent''s person',
    pg_temp.t3980_j(v)->'result'->'cards'->3->'owners'->>0, 'ada.w3980@test.local');
  v_add := pg_temp.t3980_work('A', 'add_work', jsonb_build_object('cards', pg_temp.t3980_j(v)->'result'->'cards', 'request_key', 'w3980-agent-kit-1')::text);
  perform pg_temp.t3980_check('W3-TOOL', 'the cards plan_work proposes add through add_work',
    pg_temp.t3980_get(v_add, 'ok') || '/' || pg_temp.t3980_get(v_add, 'result', 'added'), 'true/8');
  v := pg_temp.t3980_work('A', 'plan_work', format('{"event_id":"%s","expected_event_id":"%s"}', pg_temp.t3980_id('e_agent'), pg_temp.t3980_id('x_exp')));
  perform pg_temp.t3980_check('W3-TOOL', 'both an event and an expected event is refused', pg_temp.t3980_get(v, 'error', 'token'), 'invalid_arguments');
  v := pg_temp.t3980_work('A', 'plan_work', '{}');
  perform pg_temp.t3980_check('W3-TOOL', 'neither is refused', pg_temp.t3980_get(v, 'error', 'token'), 'invalid_arguments');
  v := pg_temp.t3980_work('A', 'plan_work', '{"event_id":"not-an-id"}');
  perform pg_temp.t3980_check('W3-TOOL', 'a broken id is refused in plain words', pg_temp.t3980_get(v, 'error', 'token'), 'invalid_arguments');
end;
$tool$;

-- ---------------------------------------------------------------------------
-- W3-OVERVIEW: the Team dashboard
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('39800000-0000-4000-c100-000000000009', 'hosts', 'W3980 Ownerless Host', 'prospect', 'w3980-fixture', 'w3980-fixture');

do $overview$
declare v text;
begin
  v := pg_temp.t3980_person('growth', 'select public.ops_team_overview()::text');
  perform pg_temp.t3980_like('W3-OVERVIEW', 'a Sales and marketing teammate cannot read it', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980_person('admin', 'select public.ops_team_overview()::text');
  perform pg_temp.t3980_check('W3-OVERVIEW', 'an admin reads runway counts, the sprint and the at-risk list',
    (pg_temp.t3980_j(v)->'runway' ? 'counts')::text || '/' || (pg_temp.t3980_j(v)->'sprint' ? 'by_person')::text || '/' || (pg_temp.t3980_j(v) ? 'expected_soon')::text,
    'true/true/true');
  perform pg_temp.t3980_check('W3-OVERVIEW', 'host cards with no owner are counted',
    pg_temp.t3980_get(v, 'hosts_without_owner'),
    (select count(*)::text from public.crm_records c where c.pipeline = 'hosts' and c.deleted_at is null
       and not exists (select 1 from public.crm_record_owners o where o.record_id = c.id)));
  perform pg_temp.t3980_check('W3-OVERVIEW', 'each person''s open cards are counted',
    (select e->>'open' from jsonb_array_elements(pg_temp.t3980_j(v)->'sprint'->'by_person') e where e->>'email' = 'bo.w3980@test.local'),
    (select count(*)::text from public.ops_work_cards w join public.ops_work_people p on p.card_id = w.id
      where p.email = 'bo.w3980@test.local' and p.role = 'owner' and w.status <> 'done' and w.archived_at is null));
  v := pg_temp.t3980_person('owner', 'select public.ops_team_overview()::text');
  perform pg_temp.t3980_check('W3-OVERVIEW', 'the owner reads it', (pg_temp.t3980_j(v) ? 'sprint')::text, 'true');
end;
$overview$;

-- ---------------------------------------------------------------------------
-- W3-CONVERT: next steps into cards, once, owner only
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, next_action, due_on, created_by, updated_by, deleted_at, deleted_by) values
  ('39800000-0000-4000-c200-000000000001', 'hosts', 'W3980 Menu Host', 'contacted', 'Send the menu photos', (now() AT TIME ZONE 'UTC')::date - 10, 'w3980-fixture', 'w3980-fixture', null, null),
  ('39800000-0000-4000-c200-000000000002', 'hosts', 'W3980 Roof Host', 'replied', 'Call about the rooftop night', (now() AT TIME ZONE 'UTC')::date + 9, 'w3980-fixture', 'w3980-fixture', null, null),
  ('39800000-0000-4000-c200-000000000003', 'creators', 'W3980 Reel Creator', 'negotiating', 'Agree the reel rate', null, 'w3980-fixture', 'w3980-fixture', null, null),
  ('39800000-0000-4000-c200-000000000005', 'hosts', 'W3980 Short Host', 'contacted', 'ok', null, 'w3980-fixture', 'w3980-fixture', null, null),
  ('39800000-0000-4000-c200-000000000006', 'hosts', 'W3980 Gone Host', 'contacted', 'Send the deck', null, 'w3980-fixture', 'w3980-fixture', now(), 'w3980-fixture'),
  ('39800000-0000-4000-c200-000000000007', 'hosts', 'W3980 Same Host', 'contacted', 'W3980 Late Night recap check', null, 'w3980-fixture', 'w3980-fixture', null, null);
insert into public.crm_records (id, pipeline, name, stage, stage_reason, next_action, created_by, updated_by) values
  ('39800000-0000-4000-c200-000000000004', 'hosts', 'W3980 Lost Host', 'lost', 'They closed for the season.', 'Never again', 'w3980-fixture', 'w3980-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39800000-0000-4000-c200-000000000001', 'ada.w3980@test.local', 'w3980-fixture'),
  ('39800000-0000-4000-c200-000000000003', 'bo.w3980@test.local', 'w3980-fixture'),
  ('39800000-0000-4000-c200-000000000003', 'fay.w3980@test.local', 'w3980-fixture'),
  ('39800000-0000-4000-c200-000000000007', 'ada.w3980@test.local', 'w3980-fixture');
-- an open card already has the title record 7's next step would get
insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
values ('W3980 Late Night recap check · W3980 Same Host', 'Check the recap numbers with the host.', 'The recap is checked.', (now() AT TIME ZONE 'UTC')::date + 3,
        'explicit', public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date + 3), 'ed.w3980@test.local', 'ed.w3980@test.local');

select pg_temp.t3980_keep('crm_hash', (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_records c));

create function pg_temp.t3980_row(p_res text, p_id text) returns jsonb
language sql as $fn$
  select e from jsonb_array_elements(coalesce(pg_temp.t3980_j(p_res)->'rows', pg_temp.t3980_j(p_res)->'results', '[]'::jsonb)) e
   where e->>'record_id' = p_id
$fn$;

do $convert$
declare v text; v_today date := pg_temp.t3980_id('today')::date;
        h1 text := '39800000-0000-4000-c200-000000000001'; h2 text := '39800000-0000-4000-c200-000000000002';
        h3 text := '39800000-0000-4000-c200-000000000003'; h4 text := '39800000-0000-4000-c200-000000000004';
        h5 text := '39800000-0000-4000-c200-000000000005'; h6 text := '39800000-0000-4000-c200-000000000006';
        h7 text := '39800000-0000-4000-c200-000000000007'; v_cards bigint;
begin
  perform pg_temp.t3980_check('W3-CONVERT', 'nothing was converted by the migration itself', pg_temp.t3980_id('conversions_at_start'), '0');

  v := pg_temp.t3980_person('admin', 'select public.ops_next_action_preview()::text');
  perform pg_temp.t3980_like('W3-CONVERT', 'an admin cannot preview', v, 'ERR:42501:owner_only:%');
  v := pg_temp.t3980_person('growth', 'select public.ops_next_action_preview()::text');
  perform pg_temp.t3980_like('W3-CONVERT', 'a Sales and marketing teammate cannot preview', v, 'ERR:42501:owner_only:%');
  v := pg_temp.t3980_agent_sql('owner', 'claude', 'select public.ops_next_action_preview()::text');
  perform pg_temp.t3980_like('W3-CONVERT', 'the owner''s agent cannot preview', v, 'ERR:42501:owner_only:%');

  v_cards := (select count(*) from public.ops_work_cards);
  v := pg_temp.t3980_person('owner', 'select public.ops_next_action_preview()::text');
  perform pg_temp.t3980_check('W3-CONVERT', 'the preview lists open records with a next step, and what stops each',
    ((pg_temp.t3980_row(v, h1)->>'issue') is null)::text || '/' || (pg_temp.t3980_row(v, h2)->>'issue') || '/' || ((pg_temp.t3980_row(v, h3)->>'issue') is null)::text
      || '/' || (pg_temp.t3980_row(v, h5)->>'issue') || '/' || (pg_temp.t3980_row(v, h7)->>'issue'),
    'true/no_owner/true/too_short/duplicate_title');
  perform pg_temp.t3980_check('W3-CONVERT', 'lost and removed records are not listed',
    ((pg_temp.t3980_row(v, h4) is null) and (pg_temp.t3980_row(v, h6) is null))::text, 'true');
  perform pg_temp.t3980_check('W3-CONVERT', 'the proposed card for an overdue next step',
    (pg_temp.t3980_row(v, h1)->'proposed'->>'title') || '|' || (pg_temp.t3980_row(v, h1)->'proposed'->>'instructions') || '|'
      || (pg_temp.t3980_row(v, h1)->'proposed'->>'done_means') || '|' || (pg_temp.t3980_row(v, h1)->'proposed'->>'due_on') || '|'
      || (pg_temp.t3980_row(v, h1)->'proposed'->>'owners'),
    'Send the menu photos · W3980 Menu Host|Follow up with W3980 Menu Host (host): Send the menu photos. Log what happens on the card.|The next step for W3980 Menu Host is done and logged on the record.|'
      || (v_today + 2)::text || '|["ada.w3980@test.local"]');
  perform pg_temp.t3980_check('W3-CONVERT', 'a due date ahead is kept, and a former teammate is not an owner',
    (pg_temp.t3980_row(v, h2)->'proposed'->>'due_on') || '|' || (pg_temp.t3980_row(v, h3)->'proposed'->>'owners'),
    (v_today + 9)::text || '|["bo.w3980@test.local"]');
  perform pg_temp.t3980_check('W3-CONVERT', 'previewing writes nothing',
    ((select count(*) from public.ops_work_cards) = v_cards and (select count(*) from public.ops_next_action_conversions) = 0)::text, 'true');

  v := pg_temp.t3980_person('admin', format('select public.ops_next_action_convert(%L::uuid[], null, %L)::text', array[h1], 'w3980-conv-0'));
  perform pg_temp.t3980_like('W3-CONVERT', 'an admin cannot convert', v, 'ERR:42501:owner_only:%');
  v := pg_temp.t3980_agent_sql('owner', 'claude', format('select public.ops_next_action_convert(%L::uuid[], null, %L)::text', array[h1], 'w3980-conv-0'));
  perform pg_temp.t3980_like('W3-CONVERT', 'the owner''s agent cannot convert', v, 'ERR:42501:owner_only:%');
  v := pg_temp.t3980_person('owner', format('select public.ops_next_action_convert(%L::uuid[], null, null)::text', array[h1]));
  perform pg_temp.t3980_like('W3-CONVERT', 'a convert without a request key is refused', v, 'ERR:22023:request_key_required:%');
  perform pg_temp.t3980_check('W3-CONVERT', 'after every refusal nothing was converted',
    (select count(*)::text from public.ops_next_action_conversions), '0');

  v := pg_temp.t3980_person('owner', format('select public.ops_next_action_convert(%L::uuid[], null, %L)::text', array[h1, h2, h3, h7], 'w3980-conv-1'));
  perform pg_temp.t3980_check('W3-CONVERT', 'the chosen ready records become cards; no owner and a repeated title do not',
    pg_temp.t3980_get(v, 'added') || '/' || pg_temp.t3980_get(v, 'refused') || '/' || (pg_temp.t3980_row(v, h1)->>'status') || '/'
      || (pg_temp.t3980_row(v, h2)->>'status') || '/' || (pg_temp.t3980_row(v, h3)->>'status') || '/' || (pg_temp.t3980_row(v, h7)->>'status'),
    '2/2/added/refused/added/refused');
  perform pg_temp.t3980_check('W3-CONVERT', 'the card links its record and is owned by its owner',
    (select string_agg(l.kind || ':' || p.email, ',') from public.ops_work_cards w
       join public.ops_work_links l on l.card_id = w.id join public.ops_work_people p on p.card_id = w.id and p.role = 'owner'
      where w.id = (pg_temp.t3980_row(v, h1)->>'card_id')::uuid and l.target_id = h1::uuid), 'host:ada.w3980@test.local');
  perform pg_temp.t3980_check('W3-CONVERT', 'its owner is told',
    (select count(*) from public.team_mentions m join t3980_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and p.who = 'growth' and m.deep_link like '%' || (pg_temp.t3980_row(v, h1)->>'card_id'))::text, '1');

  v := pg_temp.t3980_person('owner', format('select public.ops_next_action_convert(%L::uuid[], null, %L)::text', array[h1, h2, h3, h7], 'w3980-conv-1'));
  perform pg_temp.t3980_check('W3-CONVERT', 'the same request again changes nothing',
    pg_temp.t3980_get(v, 'replayed') || '/' || (select count(*) from public.ops_next_action_conversions), 'true/2');

  v := pg_temp.t3980_person('owner', format('select public.ops_next_action_convert(%L::uuid[], %L, %L)::text', array[h1, h2], 'bo.w3980@test.local', 'w3980-conv-2'));
  perform pg_temp.t3980_check('W3-CONVERT', 'a record already converted is skipped; a fallback owner takes the one with none',
    (pg_temp.t3980_row(v, h1)->>'status') || '/' || (pg_temp.t3980_row(v, h2)->>'status') || '/'
      || (select string_agg(p.email, ',') from public.ops_work_people p where p.card_id = (pg_temp.t3980_row(v, h2)->>'card_id')::uuid and p.role = 'owner'),
    'skipped/added/bo.w3980@test.local');
  perform pg_temp.t3980_check('W3-CONVERT', 'each record is converted once',
    (select count(*) || '/' || count(distinct record_id) from public.ops_next_action_conversions), '3/3');
  v := pg_temp.t3980_person('owner', 'select public.ops_next_action_preview()::text');
  perform pg_temp.t3980_check('W3-CONVERT', 'the preview now shows them as converted',
    (pg_temp.t3980_row(v, h1)->>'issue') || '/' || (pg_temp.t3980_row(v, h2)->>'issue'), 'already_converted/already_converted');
  perform pg_temp.t3980_check('W3-CONVERT', 'host and creator records were never changed',
    (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_records c), pg_temp.t3980_id('crm_hash'));
  perform pg_temp.t3980_check('W3-CONVERT', 'one summary line in the agent log per convert',
    (select count(*)::text from public.ops_agent_log where action = 'converted' and actor_email = 'ed.w3980@test.local'), '2');
end;
$convert$;

-- ---------------------------------------------------------------------------
-- W3-TITLES: titles carry the record name; same name and next step dedupe
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, next_action, created_by, updated_by) values
  ('39800000-0000-4000-c200-000000000008', 'hosts', 'W3980 Twin A', 'contacted', 'Send the welcome pack', 'w3980-fixture', 'w3980-fixture'),
  ('39800000-0000-4000-c200-000000000009', 'hosts', 'W3980 Twin B', 'contacted', 'Send the welcome pack', 'w3980-fixture', 'w3980-fixture'),
  ('39800000-0000-4000-c200-000000000010', 'hosts', 'W3980 Double Host', 'contacted', 'Confirm the double booking', 'w3980-fixture', 'w3980-fixture'),
  -- a live name is unique within a pipeline, so the same name is a host and a creator
  ('39800000-0000-4000-c200-000000000011', 'creators', 'W3980 Double Host', 'contacted', 'Confirm the double booking', 'w3980-fixture', 'w3980-fixture'),
  ('39800000-0000-4000-c200-000000000012', 'creators', 'W3980 Long Creator', 'contacted', repeat('Walk through the whole partnership plan ', 4), 'w3980-fixture', 'w3980-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by)
select x::uuid, 'ada.w3980@test.local', 'w3980-fixture' from unnest(array[
  '39800000-0000-4000-c200-000000000008', '39800000-0000-4000-c200-000000000009', '39800000-0000-4000-c200-000000000010',
  '39800000-0000-4000-c200-000000000011', '39800000-0000-4000-c200-000000000012']) x;

do $titles$
declare v text; v_conv text; v_long text;
        h2 text := '39800000-0000-4000-c200-000000000002'; h5 text := '39800000-0000-4000-c200-000000000005';
        h7 text := '39800000-0000-4000-c200-000000000007';
        a text := '39800000-0000-4000-c200-000000000008'; b text := '39800000-0000-4000-c200-000000000009';
        d1 text := '39800000-0000-4000-c200-000000000010'; d2 text := '39800000-0000-4000-c200-000000000011';
        lg text := '39800000-0000-4000-c200-000000000012';
begin
  v := pg_temp.t3980_person('owner', 'select public.ops_next_action_preview()::text');
  perform pg_temp.t3980_check('W3-TITLES', 'the same next step on two records gives two titles, each naming its record',
    (pg_temp.t3980_row(v, a)->'proposed'->>'title') || '|' || (pg_temp.t3980_row(v, b)->'proposed'->>'title') || '|'
      || coalesce(pg_temp.t3980_row(v, a)->>'issue', '-') || '|' || coalesce(pg_temp.t3980_row(v, b)->>'issue', '-'),
    'Send the welcome pack · W3980 Twin A|Send the welcome pack · W3980 Twin B|-|-');
  perform pg_temp.t3980_check('W3-TITLES', 'the same name and next step: the later record repeats the earlier one',
    coalesce(pg_temp.t3980_row(v, d1)->>'issue', '-') || '|' || (pg_temp.t3980_row(v, d2)->>'issue') || '|'
      || (pg_temp.t3980_row(v, d2)->'duplicate_of'->>'record_id') || '|' || (pg_temp.t3980_row(v, d2)->>'reason'),
    '-|duplicate_record|' || d1 || '|Same name and next step as W3980 Double Host, which becomes the one card for both.');
  v_long := pg_temp.t3980_row(v, lg)->'proposed'->>'title';
  perform pg_temp.t3980_check('W3-TITLES', 'a long next step is cut with an ellipsis and the name is kept',
    char_length(v_long)::text || '|' || (v_long like 'Walk through the whole partnership plan Walk%… · W3980 Long Creator')::text, '160|true');
  perform pg_temp.t3980_check('W3-TITLES', 'the preview lists every skipped record with its reason, and no ready one',
    (select string_agg((e->>'record_id') || ':' || (e->>'issue') || ':' || ((e->>'reason') <> '')::text, ',' order by e->>'record_id')
       from jsonb_array_elements(pg_temp.t3980_j(v)->'skipped') e
      where e->>'record_id' in (h2, h5, h7, a, b, d1, d2, lg)),
    h2 || ':already_converted:true,' || h5 || ':too_short:true,' || h7 || ':duplicate_title:true,' || d2 || ':duplicate_record:true');
  perform pg_temp.t3980_check('W3-TITLES', 'the skipped list matches every row that is not ready',
    (jsonb_array_length(pg_temp.t3980_j(v)->'skipped'))::text || '/' || pg_temp.t3980_get(v, 'totals', 'skipped'),
    (select count(*) from jsonb_array_elements(pg_temp.t3980_j(v)->'rows') e where e->>'issue' is not null)::text || '/'
      || (select count(*) from jsonb_array_elements(pg_temp.t3980_j(v)->'rows') e where e->>'issue' is not null)::text);
  perform pg_temp.t3980_check('W3-TITLES', 'the open card the repeated title collides with is named',
    (pg_temp.t3980_row(v, h7)->'duplicate_of'->>'title'), 'W3980 Late Night recap check · W3980 Same Host');

  v_conv := pg_temp.t3980_person('owner', format('select public.ops_next_action_convert(%L::uuid[], null, %L)::text', array[a, b, d1, d2, lg], 'w3980-conv-3'));
  perform pg_temp.t3980_check('W3-TITLES', 'twins become two cards, the repeated record joins its twin''s card, the long one adds',
    pg_temp.t3980_get(v_conv, 'added') || '/' || pg_temp.t3980_get(v_conv, 'skipped') || '/' || pg_temp.t3980_get(v_conv, 'refused') || '/'
      || (pg_temp.t3980_row(v_conv, a)->>'status') || '/' || (pg_temp.t3980_row(v_conv, b)->>'status') || '/'
      || (pg_temp.t3980_row(v_conv, d1)->>'status') || '/' || (pg_temp.t3980_row(v_conv, d2)->>'status') || ':' || (pg_temp.t3980_row(v_conv, d2)->>'reason') || '/'
      || (pg_temp.t3980_row(v_conv, lg)->>'status'),
    '4/1/0/added/added/added/skipped:duplicate_record/added');
  perform pg_temp.t3980_check('W3-TITLES', 'the two records with the same name and next step share one card',
    (select count(distinct card_id)::text || '/' || count(*)::text from public.ops_next_action_conversions where record_id in (d1::uuid, d2::uuid)), '1/2');
  perform pg_temp.t3980_check('W3-TITLES', 'the twins'' cards carry their titles',
    (select string_agg(w.title, '|' order by w.title) from public.ops_work_cards w
      where w.id in ((pg_temp.t3980_row(v_conv, a)->>'card_id')::uuid, (pg_temp.t3980_row(v_conv, b)->>'card_id')::uuid)),
    'Send the welcome pack · W3980 Twin A|Send the welcome pack · W3980 Twin B');
  v := pg_temp.t3980_person('owner', 'select public.ops_next_action_preview()::text');
  perform pg_temp.t3980_check('W3-TITLES', 'afterwards the repeated record shows as converted',
    pg_temp.t3980_row(v, d2)->>'issue', 'already_converted');
  perform pg_temp.t3980_check('W3-TITLES', 'host and creator records were still never changed',
    (select count(*)::text from public.crm_records c where c.id in (a::uuid, b::uuid, d1::uuid, d2::uuid, lg::uuid) and c.updated_by = 'w3980-fixture'), '5');
end;
$titles$;

select count(*) as t3980_total, count(*) filter (where not ok) as t3980_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980_failures
  from t3980_results \gset
rollback;

select (:t3980_total < 70 or :t3980_failed > 0) as t3980_bad \gset
\if :t3980_bad
  \echo 'ISSUE-3980 WAVE 3 FAILED:' :t3980_failed 'of' :t3980_total
  \echo :t3980_failures
  do $$ begin raise exception 'ISSUE-3980 WAVE 3 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 WAVE 3 PASS:' :t3980_total 'checks, 0 failed'
