-- Issue #3980 synced program, targeted retest of the proof-pass fixes.
-- Independent tester suite, on the fully replayed PG17 schema. It attacks
-- angles the implementor suite does not:
--
--   P1-2  an old refusal with no open card makes no card; a success posted
--         BEFORE the newest refusal does not close the card; many runs make
--         one card; after a success closes it, a new refusal makes exactly
--         one new open card and leaves the closed one closed
--   P2-3  every combination of the four kept dates of a weekly series being
--         live or only unpublished (16 cases): the card names the first date
--         that is not live, with its plain state; when all four are live it
--         names the event matched to the first date; an unpublished event on
--         a date never counts as live
--   P2-4  through an agent (set_owners on a Claude key), a host's first owner
--         also owns that host's ownerless automatic cards, including one
--         anchored to the host brand's event and one where the new owner was
--         only a watcher; never a person-made card, a closed card, a card of
--         another brand, or a card someone owns
--   P2-5  through an agent, removing a host's or a creator's last owner is
--         refused per item with last_owner and nothing changes; a list of
--         only unusable addresses never empties an owned card; a swap in one
--         call still works
--   P2-2  through an agent (ops_agent_call set_expected_event): repeats month
--         in place, back to none in place, a promo moment, and an unknown
--         repeat refused with the person's own words
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

create temp table trt_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into trt_people (who, id, email) values
  ('owner',   '39940000-0000-4000-a000-000000000001', 'ed.rt3980@test.local'),
  ('growth',  '39940000-0000-4000-a000-000000000003', 'ada.rt3980@test.local'),
  ('growth2', '39940000-0000-4000-a000-000000000004', 'bo.rt3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from trt_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.rt3980@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.rt3980@test.local', 'growth', 'active', now()),
  ('bo.rt3980@test.local', 'growth', 'active', now());

create temp table trt_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table trt_ids (k text primary key, val text) on commit drop;

create function pg_temp.trt_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'service' then
    select id, email into strict v_id, v_email from trt_people where who = p_who;
  end if;
  begin
    if p_who = 'service' then
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

create function pg_temp.trt_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.trt_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.trt_next_request();
  return pg_temp.trt_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.trt_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

-- One agent request through a gateway, the way the edge function makes it.
create function pg_temp.trt_gw(p_gateway text, p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
begin
  perform pg_temp.trt_next_request();
  return pg_temp.trt_as('service', format('select public.%I(%L, %L, %L::jsonb, %L)::text',
    p_gateway, pg_temp.trt_digest((select val from trt_ids where k = p_key)), p_tool, p_args, 'issue3980rt-client/1.0'));
end;
$fn$;

create function pg_temp.trt_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into trt_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 700), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.trt_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into trt_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 700), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.trt_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.trt_today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;

create function pg_temp.trt_owners(p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '-') from public.ops_work_people p where p.card_id = p_card and p.role = 'owner'
$fn$;

create function pg_temp.trt_watchers(p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '-') from public.ops_work_people p where p.card_id = p_card and p.role = 'watcher'
$fn$;

create function pg_temp.trt_card(p_key text) returns public.ops_work_cards
language sql as $fn$ select w.* from public.ops_work_cards w where w.auto_key = p_key order by w.number desc limit 1 $fn$;

create function pg_temp.trt_refuse_at(p_at timestamptz) returns void
language plpgsql as $fn$
begin
  perform pg_temp.trt_as('service', 'select public.ops_release_status_refused()::text');
  -- The agent log is append-only; the fixture dates the newest refusal with
  -- triggers off, as if it had been written at p_at.
  set local session_replication_role = replica;
  update public.ops_agent_log set at = p_at
   where id = (select l.id from public.ops_agent_log l where l.action = 'release_record' and l.detail ? 'status_refused' order by l.at desc, l.id desc limit 1);
  set local session_replication_role = origin;
end;
$fn$;

create function pg_temp.trt_status_cards() returns text
language sql as $fn$
  select count(*) filter (where status <> 'done')::text || ' open/' || count(*) filter (where status = 'done')::text || ' done'
    from public.ops_work_cards where auto_key like 'eng\_status\_token%'
$fn$;

-- ---------------------------------------------------------------------------
-- P1-2 attacks.
-- ---------------------------------------------------------------------------
insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, deploy_marker)
values (88101, 'RT status record', 'https://github.com/Mingla-LLC/mingla-main/pull/88101', now() - interval '3 days', repeat('b', 40), false);

do $p12$
declare v text; c public.ops_work_cards; c2 public.ops_work_cards; i integer;
begin
  -- A refusal three hours ago, never followed by a success, and no card open:
  -- it is old news. The run makes no card (no card from stale history).
  perform pg_temp.trt_refuse_at(clock_timestamp() - interval '3 hours');
  v := pg_temp.trt_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.trt_check('P1-2', 'an old refusal with no open card makes no card', pg_temp.trt_status_cards(), '0 open/0 done');

  -- A success that was posted BEFORE a fresh refusal does not count.
  update public.ops_release_records set status_state = 'success', status_posted_at = clock_timestamp() - interval '20 minutes' where pr = 88101;
  perform pg_temp.trt_refuse_at(clock_timestamp() - interval '5 minutes');
  for i in 1..5 loop
    v := pg_temp.trt_as('service', 'select public.ops_engineering_cards_sync()::text');
  end loop;
  c := pg_temp.trt_card('eng_status_token:sync');
  perform pg_temp.trt_check('P1-2', 'a fresh refusal after an older success makes the card; five runs make exactly one', pg_temp.trt_status_cards(), '1 open/0 done');
  perform pg_temp.trt_check('P1-2', 'the card was added once in its history',
    (select count(*) from public.ops_work_events e where e.card_id = c.id and e.action in ('created', 'auto_added', 'added'))::text, '1');
  perform pg_temp.trt_check('P1-2', 'no run logged a refused key',
    (select count(*) from public.ops_agent_log l where l.detail::text like '%invalid_auto_key%')::text, '0');

  -- Three hours pass with no new refusal and no success: still open.
  set local session_replication_role = replica;
  update public.ops_agent_log set at = at - interval '3 hours' where action = 'release_record' and detail ? 'status_refused';
  set local session_replication_role = origin;
  -- (the older success moves back with it, so it still came first)
  update public.ops_release_records set status_posted_at = status_posted_at - interval '3 hours' where pr = 88101;
  v := pg_temp.trt_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.trt_check('P1-2', 'hours without a success keep the one card open', pg_temp.trt_status_cards() || '/' || (select status from public.ops_work_cards where id = c.id), '1 open/0 done/todo');

  -- A success now closes it.
  update public.ops_release_records set status_state = 'success', status_posted_at = clock_timestamp() where pr = 88101;
  v := pg_temp.trt_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.trt_check('P1-2', 'a success after the newest refusal closes it', pg_temp.trt_status_cards(), '0 open/1 done');

  -- The token breaks again: one new card, the closed one stays closed.
  perform pg_temp.trt_refuse_at(clock_timestamp() + interval '1 second');
  v := pg_temp.trt_as('service', 'select public.ops_engineering_cards_sync()::text');
  v := pg_temp.trt_as('service', 'select public.ops_engineering_cards_sync()::text');
  c2 := pg_temp.trt_card('eng_status_token:sync');
  perform pg_temp.trt_check('P1-2', 'a new refusal makes exactly one new open card; the old one stays done',
    pg_temp.trt_status_cards() || '/' || (c2.id <> c.id)::text || '/' || (select status from public.ops_work_cards where id = c.id), '1 open/1 done/true/done');
end;
$p12$;

-- ---------------------------------------------------------------------------
-- Keys for the agent routes (Ada's Claude key).
-- ---------------------------------------------------------------------------
do $keys$
declare v text;
begin
  v := pg_temp.trt_person('growth', $q$select public.team_agent_key_create('claude')::text$q$);
  if v like 'ERR:%' then raise exception 'fixture: key create failed: %', v; end if;
  insert into trt_ids (k, val) values ('ada.claude', v::jsonb ->> 'key');
end;
$keys$;

-- ---------------------------------------------------------------------------
-- P2-3: all 16 combinations of four kept dates live or only unpublished.
-- ---------------------------------------------------------------------------
do $p23$
declare
  m integer; i integer; v_brand uuid; v_host uuid; v_exp uuid; v_ev uuid; v_first_ev uuid; v_d date; a jsonb;
  v_want_idx integer; v_bad integer := 0; v_detail text := ''; v_state_bad integer := 0; v_unpub_hits integer := 0;
  x public.ops_expected_events;
begin
  for m in 0..15 loop
    v_brand := gen_random_uuid(); v_host := gen_random_uuid(); v_exp := gen_random_uuid(); v_first_ev := null;
    set local session_replication_role = replica;
    insert into public.brands (id, account_id, name, slug, city) values (v_brand, gen_random_uuid(), 'RT Series Brand ' || m, 'rt-series-brand-' || m, 'Lagos');
    for i in 0..3 loop
      v_d := pg_temp.trt_today() + 2 + 7 * i;
      v_ev := gen_random_uuid();
      if (m >> i) & 1 = 1 then
        insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type)
        values (v_ev, v_brand, 'RT live ' || m || '-' || i, 'rt-live-' || m || '-' || i, 'discover', 'scheduled', 'UTC', now() - interval '30 days', 'event');
        if i = 0 then v_first_ev := v_ev; end if;
      else
        -- The same date has an event, but it is only a draft: never live.
        insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type)
        values (v_ev, v_brand, 'RT draft ' || m || '-' || i, 'rt-draft-' || m || '-' || i, 'discover', 'draft', 'UTC', null, 'event');
      end if;
      insert into public.event_dates (event_id, start_at, end_at, is_master)
      values (v_ev, v_d::timestamp AT TIME ZONE 'UTC' + interval '20 hours', v_d::timestamp AT TIME ZONE 'UTC' + interval '23 hours', true);
    end loop;
    set local session_replication_role = origin;
    insert into public.crm_records (id, pipeline, name, stage, icp, brand_id, created_by, updated_by)
    values (v_host, 'hosts', 'RT Series Host ' || m, 'onboarded', 'event_organizer', v_brand, 'rt', 'rt');
    insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by)
    values (v_exp, v_host, 'RT Weekly ' || m, 'event', pg_temp.trt_today() + 2, 'week', 'rt', 'rt');
    select * into x from public.ops_expected_events where id = v_exp;

    a := public.ops_card_anchor('expected', v_exp, pg_temp.trt_today());
    v_want_idx := null;
    for i in 0..3 loop
      if (m >> i) & 1 = 0 then v_want_idx := i; exit; end if;
    end loop;
    if v_want_idx is not null then
      if a->>'kind' <> 'expected' or (a->>'start_on')::date <> pg_temp.trt_today() + 2 + 7 * v_want_idx
         or a->>'series' <> 'true' or a->>'is_public' <> 'false' then
        v_bad := v_bad + 1; v_detail := v_detail || format(' [mask %s: kind %s start %s series %s public %s]', m, a->>'kind', a->>'start_on', a->>'series', a->>'is_public');
      end if;
      if a->'state' is null or a->'state'->>'name' is null
         or a->'state' is distinct from public.ops_plain_state(public.ops_expected_anchor(x, pg_temp.trt_today() + 2 + 7 * v_want_idx), pg_temp.trt_today()) then
        v_state_bad := v_state_bad + 1;
      end if;
    else
      if a->>'kind' <> 'event' or a->>'id' <> v_first_ev::text or a->>'series' <> 'true' or a->>'is_public' <> 'true' or a->>'series_title' <> 'RT Weekly 15' then
        v_bad := v_bad + 1; v_detail := v_detail || format(' [mask 15: %s]', left(a::text, 300));
      end if;
    end if;
    -- An unpublished event never stands for a date.
    if exists (select 1 from jsonb_array_elements(public.ops_expected_occurrences(x, pg_temp.trt_today(), 4)) o
                join public.events e on e.id::text = o->>'event_id' where e.status = 'draft') then
      v_unpub_hits := v_unpub_hits + 1;
    end if;
  end loop;
  perform pg_temp.trt_check('P2-3', 'all 16 live/unpublished combinations name the first date that is not live, or the matched event when all are live', v_bad::text || v_detail, '0');
  perform pg_temp.trt_check('P2-3', 'the plain state is that date''s own state in every not-all-live case', v_state_bad::text, '0');
  perform pg_temp.trt_check('P2-3', 'an unpublished event never stands for a kept date', v_unpub_hits::text, '0');
end;
$p23$;

-- ---------------------------------------------------------------------------
-- Fixtures for P2-4 and P2-5.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39940000-0000-4000-b100-000000000001', '39940000-0000-4000-b300-000000000001', 'RT Palm Brand', 'rt-palm-brand', 'Lagos'),
  ('39940000-0000-4000-b100-000000000002', '39940000-0000-4000-b300-000000000002', 'RT Other Brand', 'rt-other-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39940000-0000-4000-b400-000000000001', '39940000-0000-4000-b100-000000000001', 'RT Palm Opening', 'rt-palm-opening', 'discover', 'scheduled', 'UTC', now() - interval '2 days', 'event'),
  ('39940000-0000-4000-b400-000000000002', '39940000-0000-4000-b100-000000000002', 'RT Other Night', 'rt-other-night', 'discover', 'scheduled', 'UTC', now() - interval '2 days', 'event');
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, icp, brand_id, created_by, updated_by) values
  ('39940000-0000-4000-c100-000000000001', 'hosts', 'RT Palm Host', 'onboarded', 'event_organizer', '39940000-0000-4000-b100-000000000001', 'rt', 'rt'),
  ('39940000-0000-4000-c100-000000000002', 'hosts', 'RT Owned Host', 'contacted', 'event_organizer', null, 'rt', 'rt'),
  ('39940000-0000-4000-c100-000000000003', 'creators', 'RT Owned Creator', 'identified', null, null, 'rt', 'rt'),
  ('39940000-0000-4000-c100-000000000004', 'hosts', 'RT Expected Host', 'onboarded', 'event_organizer', null, 'rt', 'rt');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39940000-0000-4000-c100-000000000002', 'ada.rt3980@test.local', 'rt'),
  ('39940000-0000-4000-c100-000000000003', 'ada.rt3980@test.local', 'rt'),
  ('39940000-0000-4000-c100-000000000004', 'ada.rt3980@test.local', 'rt');
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by) values
  ('39940000-0000-4000-d100-000000000001', '39940000-0000-4000-c100-000000000004', 'RT Launch Night', 'event', (now() AT TIME ZONE 'UTC')::date + 30, 'none', 'rt', 'rt');

-- Cards for RT Palm Host (no owner yet), made the way the automatic steps make them.
create function pg_temp.trt_auto(p_key text, p_title text, p_owners text[], p_watchers text[], p_kind text, p_anchor jsonb) returns uuid
language plpgsql as $fn$
declare v jsonb;
begin
  v := public.ops_auto_card_upsert(p_key, jsonb_build_object(
    'title', p_title, 'instructions', 'Do the step for the host, then mark it done here.', 'done_means', 'The step is done and visible.',
    'owners', to_jsonb(coalesce(p_owners, '{}'::text[])), 'watchers', to_jsonb(coalesce(p_watchers, '{}'::text[])),
    'due_on', pg_temp.trt_today() + 5,
    'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', '39940000-0000-4000-c100-000000000001'))), p_kind, p_anchor);
  return (v->>'id')::uuid;
end;
$fn$;

do $fx$
declare v_res jsonb;
begin
  insert into trt_ids values ('ask', pg_temp.trt_auto('ask:39940000-0000-4000-c100-000000000001', 'Ask RT Palm Host for their first event', null, null, 'task', null)::text);
  insert into trt_ids values ('watch', pg_temp.trt_auto('recap:39940000-0000-4000-c100-000000000001', 'Recap RT Palm Host', null, array['ada.rt3980@test.local', 'bo.rt3980@test.local'], 'task', null)::text);
  insert into trt_ids values ('owned', pg_temp.trt_auto('promo:event:39940000-0000-4000-b400-000000000001', 'Promote RT Palm Opening', array['bo.rt3980@test.local'], null, 'task', null)::text);
  insert into trt_ids values ('closed', pg_temp.trt_auto('golive:expected:39940000-0000-4000-d100-0000000000ff', 'Old go-live RT Palm Host', null, null, 'task', null)::text);
  perform public.ops_auto_card_close((select val from trt_ids where k = 'closed')::uuid, 'Fixture closed.', '[]'::jsonb);
  -- An automatic card anchored to the host brand's event, with no host link.
  v_res := public.ops_auto_card_upsert('golive:event:39940000-0000-4000-b400-000000000001', jsonb_build_object(
    'title', 'Get RT Palm Opening live', 'instructions', 'Publish the event so promotion can start.', 'done_means', 'The event is public.',
    'owners', '[]'::jsonb, 'watchers', '[]'::jsonb, 'due_on', pg_temp.trt_today() + 5), 'task',
    jsonb_build_object('kind', 'event', 'id', '39940000-0000-4000-b400-000000000001'));
  insert into trt_ids values ('evanchor', v_res->>'id');
  -- The same for another brand's event: never this host's.
  v_res := public.ops_auto_card_upsert('golive:event:39940000-0000-4000-b400-000000000002', jsonb_build_object(
    'title', 'Get RT Other Night live', 'instructions', 'Publish the event so promotion can start.', 'done_means', 'The event is public.',
    'owners', '[]'::jsonb, 'watchers', '[]'::jsonb, 'due_on', pg_temp.trt_today() + 5), 'task',
    jsonb_build_object('kind', 'event', 'id', '39940000-0000-4000-b400-000000000002'));
  insert into trt_ids values ('otherbrand', v_res->>'id');
end;
$fx$;

-- A person-made card linked to the host, with no owner (not automatic).
insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id, created_by, updated_by)
values ('RT person-made card for Palm', 'A person wrote this card for the host by hand.', 'It is done by hand.', 'todo', (now() AT TIME ZONE 'UTC')::date + 4, 'explicit',
        (select public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date)), 'ed.rt3980@test.local', 'ed.rt3980@test.local');
insert into trt_ids values ('manual', (select id::text from public.ops_work_cards where title = 'RT person-made card for Palm'));
insert into public.ops_work_links (card_id, kind, target_id, label, added_by)
select (select val from trt_ids where k = 'manual')::uuid, 'host', '39940000-0000-4000-c100-000000000001', 'RT Palm Host', 'ed.rt3980@test.local';

-- ---------------------------------------------------------------------------
-- P2-4: an agent gives the host its first owner.
-- ---------------------------------------------------------------------------
do $p24$
declare v text; id_of text;
begin
  perform pg_temp.trt_check('P2-4', 'before: the person-made card is linked to the host and the fixtures are ownerless',
    pg_temp.trt_owners((select val from trt_ids where k = 'ask')::uuid) || '|' || pg_temp.trt_owners((select val from trt_ids where k = 'evanchor')::uuid)
      || '|' || pg_temp.trt_owners((select val from trt_ids where k = 'manual')::uuid) || '|' || pg_temp.trt_owners((select val from trt_ids where k = 'watch')::uuid),
    '-|-|-|-');
  v := pg_temp.trt_gw('team_agent_call', 'ada.claude', 'set_owners', jsonb_build_object('items', jsonb_build_array(
         jsonb_build_object('id', '39940000-0000-4000-c100-000000000001', 'owner_emails', jsonb_build_array('ada.rt3980@test.local')))));
  perform pg_temp.trt_check('P2-4', 'the agent''s set_owners saves the host''s first owner', pg_temp.trt_j(v) #>> '{result,results,0,status}', 'updated');
  perform pg_temp.trt_check('P2-4', 'its ownerless Ask card is Ada''s now', pg_temp.trt_owners((select val from trt_ids where k = 'ask')::uuid), 'ada.rt3980@test.local');
  perform pg_temp.trt_check('P2-4', 'a card anchored to the host brand''s event is Ada''s too', pg_temp.trt_owners((select val from trt_ids where k = 'evanchor')::uuid), 'ada.rt3980@test.local');
  perform pg_temp.trt_check('P2-4', 'where Ada only watched, she owns it now and the other watcher stays a watcher',
    pg_temp.trt_owners((select val from trt_ids where k = 'watch')::uuid) || '|' || pg_temp.trt_watchers((select val from trt_ids where k = 'watch')::uuid),
    'ada.rt3980@test.local|bo.rt3980@test.local');
  perform pg_temp.trt_check('P2-4', 'a card Bo owns is never taken', pg_temp.trt_owners((select val from trt_ids where k = 'owned')::uuid), 'bo.rt3980@test.local');
  perform pg_temp.trt_check('P2-4', 'a closed card is left alone', pg_temp.trt_owners((select val from trt_ids where k = 'closed')::uuid), '-');
  perform pg_temp.trt_check('P2-4', 'a person-made card is left alone (automatic cards only)', pg_temp.trt_owners((select val from trt_ids where k = 'manual')::uuid), '-');
  perform pg_temp.trt_check('P2-4', 'another brand''s card is left alone', pg_temp.trt_owners((select val from trt_ids where k = 'otherbrand')::uuid), '-');
  perform pg_temp.trt_check('P2-4', 'the change is Ada''s, via her agent, in the card''s history',
    (select e.actor_email || '/' || coalesce(e.via, '-') from public.ops_work_events e
      where e.card_id = (select val from trt_ids where k = 'ask')::uuid and e.action = 'people' order by e.at desc limit 1),
    'ada.rt3980@test.local/claude');
  perform pg_temp.trt_check('P2-4', 'exactly three cards were adopted, each once',
    (select count(*) from public.ops_work_events e where e.action = 'people' and e.body like 'Owned by % with the host card RT Palm Host.')::text, '3');
end;
$p24$;

-- ---------------------------------------------------------------------------
-- P2-5: the last owner stays, through the agent too.
-- ---------------------------------------------------------------------------
do $p25$
declare v text;
begin
  v := pg_temp.trt_gw('team_agent_call', 'ada.claude', 'set_owners', jsonb_build_object('items', jsonb_build_array(
         jsonb_build_object('id', '39940000-0000-4000-c100-000000000002', 'owner_emails', '[]'::jsonb),
         jsonb_build_object('id', '39940000-0000-4000-c100-000000000003', 'owner_emails', '[]'::jsonb))));
  perform pg_temp.trt_check('P2-5', 'the agent cannot remove a host''s or a creator''s last owner: both refused with last_owner',
    (pg_temp.trt_j(v) #>> '{result,results,0,error,token}') || '/' || (pg_temp.trt_j(v) #>> '{result,results,1,error,token}'), 'last_owner/last_owner');
  v := pg_temp.trt_person('growth', format('select public.crm_record_set_owners(%L, %L::text[])::text',
         '39940000-0000-4000-c100-000000000002', array['   ', 'not-an-address']));
  perform pg_temp.trt_like('P2-5', 'a list of only unusable addresses never empties an owned card', v, 'ERR:22023:%');
  perform pg_temp.trt_check('P2-5', 'nothing changed on either card',
    (select string_agg(owner_email, ',' order by owner_email) from public.crm_record_owners
      where record_id in ('39940000-0000-4000-c100-000000000002', '39940000-0000-4000-c100-000000000003')),
    'ada.rt3980@test.local,ada.rt3980@test.local');
  v := pg_temp.trt_gw('team_agent_call', 'ada.claude', 'set_owners', jsonb_build_object('items', jsonb_build_array(
         jsonb_build_object('id', '39940000-0000-4000-c100-000000000002', 'owner_emails', jsonb_build_array('bo.rt3980@test.local')))));
  perform pg_temp.trt_check('P2-5', 'a swap to another person in one call still works',
    (pg_temp.trt_j(v) #>> '{result,results,0,status}') || '/' || (select string_agg(owner_email, ',') from public.crm_record_owners where record_id = '39940000-0000-4000-c100-000000000002'),
    'updated/bo.rt3980@test.local');
end;
$p25$;

-- ---------------------------------------------------------------------------
-- P2-2: an agent changes repeats in place and saves a promo moment.
-- ---------------------------------------------------------------------------
do $p22$
declare v text; v_rev bigint;
begin
  select revision into v_rev from public.ops_expected_events where id = '39940000-0000-4000-d100-000000000001';
  v := pg_temp.trt_gw('ops_agent_call', 'ada.claude', 'set_expected_event', jsonb_build_object('request_key', 'rt-repeat-month-0001',
         'record_id', '39940000-0000-4000-c100-000000000004', 'id', '39940000-0000-4000-d100-000000000001', 'repeats', 'month'));
  perform pg_temp.trt_check('P2-2', 'the agent makes a saved one-off repeat every month, in place',
    (select status || '/' || repeats || '/' || (revision - v_rev)::text || '/' || expected_on::text from public.ops_expected_events where id = '39940000-0000-4000-d100-000000000001'),
    'open/month/1/' || (pg_temp.trt_today() + 30)::text);
  v := pg_temp.trt_gw('ops_agent_call', 'ada.claude', 'set_expected_event', jsonb_build_object('request_key', 'rt-repeat-none-0001',
         'record_id', '39940000-0000-4000-c100-000000000004', 'id', '39940000-0000-4000-d100-000000000001', 'repeats', 'none'));
  perform pg_temp.trt_check('P2-2', 'and back to once, in place, with one row on the card',
    (select string_agg(status || '/' || repeats, ',') from public.ops_expected_events where record_id = '39940000-0000-4000-c100-000000000004'), 'open/none');
  v := pg_temp.trt_gw('ops_agent_call', 'ada.claude', 'set_expected_event', jsonb_build_object('request_key', 'rt-repeat-bad-0001',
         'record_id', '39940000-0000-4000-c100-000000000004', 'id', '39940000-0000-4000-d100-000000000001', 'repeats', 'fortnight'));
  perform pg_temp.trt_like('P2-2', 'an unknown repeat is refused with the person''s own words', v, '%Repeats must be none, week or month.%');
  perform pg_temp.trt_check('P2-2', 'and the row is unchanged',
    (select repeats from public.ops_expected_events where id = '39940000-0000-4000-d100-000000000001'), 'none');
  v := pg_temp.trt_gw('ops_agent_call', 'ada.claude', 'set_expected_event', jsonb_build_object('request_key', 'rt-moment-0001',
         'record_id', '39940000-0000-4000-c100-000000000002', 'title', 'RT Detty December menu', 'event_type', 'promo_moment',
         'expected_on', pg_temp.trt_today() + 50, 'repeats', 'none'));
  perform pg_temp.trt_check('P2-2', 'the agent saves a promo moment',
    (select event_type || '/' || created_by from public.ops_expected_events where record_id = '39940000-0000-4000-c100-000000000002'),
    'promo_moment/ada.rt3980@test.local');
end;
$p22$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
do $report$
declare r record; v_fail integer := 0; v_total integer := 0;
begin
  for r in select * from trt_results order by seq loop
    v_total := v_total + 1;
    if r.ok then raise notice 'PASS [%] %', r.test, r.label;
    else v_fail := v_fail + 1; raise warning 'FAIL [%] % -- %', r.test, r.label, r.detail; end if;
  end loop;
  if v_total = 0 then raise exception 'issue 3980 proof-fix retest: no checks ran'; end if;
  if v_fail > 0 then raise exception 'issue 3980 proof-fix retest: % of % checks failed', v_fail, v_total; end if;
  raise notice 'issue 3980 proof-fix retest: all % checks passed', v_total;
end;
$report$;

rollback;
