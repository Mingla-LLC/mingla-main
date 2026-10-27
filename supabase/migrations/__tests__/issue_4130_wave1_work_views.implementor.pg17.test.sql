-- Issue #4130 Wave 1 -- implementor happy path, on the fully replayed PG17
-- schema (20280110004130_issue_4130_work_views_and_team_pulse.sql):
--   W1-EVENTS  ops_events_since lists what changed on Work cards since a
--              moment, newest first, for one person (changes they made or
--              on cards they own); undone changes, removed cards and older
--              changes are left out; per person it counts cards they own
--              that closed (a "not needed" push back is not closed), cards
--              they added and changes they made
--   W1-PERIOD  ops_period_summary counts closed, closed on time, opened,
--              overdue now, carried once and twice, per person, per week,
--              biggest things shipped (a person's card, GitHub first; not a
--              timeline card), kept slipping and the review list
--   W1-PULSE   crm_team_pulse counts distinct host and creator records for a
--              period and the one before it; deleted records never count
--   W1-WAIT    one definition of "Waiting on a person": ops_my_counts
--              waiting_on_person_mine counts your own open person cards,
--              a send card whether or not its draft is ready, and equals the
--              Work board's count (ops_work_list who=mine and owner=you)
--   W1-GATE    the crm area is needed (the Team dashboard numbers need an
--              owner or admin); anon and PUBLIC cannot run them; the two
--              internal helpers cannot be run by any client; bad periods and
--              time zones are refused in words
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tw_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tw_people (who, id, email) values
  ('owner',  '41300000-0000-4000-a0ee-000000000001', 'oona.w4130@test.local'),
  ('admin',  '41300000-0000-4000-a0ee-000000000002', 'abe.w4130@test.local'),
  ('growth', '41300000-0000-4000-a0ee-000000000003', 'gia.w4130@test.local'),
  ('hal',    '41300000-0000-4000-a0ee-000000000004', 'hal.w4130@test.local'),
  ('nobody', '41300000-0000-4000-a0ee-000000000005', 'ned.w4130@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tw_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.w4130@test.local', 'owner', 'active', now()),
  ('abe.w4130@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.w4130@test.local', 'growth', 'active', now()),
  ('hal.w4130@test.local', 'growth', 'active', now());

create temp table tw_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tw_card_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.tw_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      select id, email into strict v_id, v_email from tw_people where who = p_who;
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.tw_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tw_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
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

-- One card, written directly (triggers off), owned by p_owner unless NULL.
create function pg_temp.tw_card(p_key text, p_title text, p_owner text, p_status text, p_due_days integer, p_created interval,
  p_closed interval default null, p_close_kind text default null, p_updated interval default null,
  p_auto text default null, p_archived boolean default false) returns uuid
language plpgsql as $fn$
declare v_id uuid; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, person_reason, due_on, due_source, sprint_id,
    created_by, created_at, updated_by, updated_at, closed_at, closed_by, close_kind, auto_key, archived_at, archived_by, archive_reason)
  values (p_title, 'Do this task carefully and say what changed.', 'It is done and checked.', p_status,
    case when p_status = 'person' then 'send' end, v_today + p_due_days, 'explicit', public.ops_sprint_ensure(v_today + p_due_days),
    coalesce(p_owner, 'oona.w4130@test.local'), now() - p_created, coalesce(p_owner, 'oona.w4130@test.local'), now() - coalesce(p_updated, p_created),
    case when p_status = 'done' then now() - p_closed end, case when p_status = 'done' then coalesce(p_owner, 'oona.w4130@test.local') end,
    case when p_status = 'done' then p_close_kind end, p_auto,
    case when p_archived then now() end, case when p_archived then 'oona.w4130@test.local' end, case when p_archived then 'Removed in the test.' end)
  returning id into v_id;
  if p_owner is not null then
    insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  end if;
  insert into tw_card_ids (k, id) values (p_key, v_id);
  return v_id;
end;
$fn$;

create function pg_temp.tw_id(p_key text) returns uuid
language sql as $fn$ select id from tw_card_ids where k = p_key $fn$;

create function pg_temp.tw_event(p_key text, p_action text, p_ago interval, p_actor text, p_after jsonb default null, p_undone boolean default false) returns void
language sql as $fn$
  insert into public.ops_work_events (card_id, at, actor_email, action, after, undone_at, undone_by)
  values (pg_temp.tw_id(p_key), now() - p_ago, p_actor, p_action, p_after,
          case when p_undone then now() end, case when p_undone then p_actor end)
$fn$;

set local session_replication_role = replica;
do $fixture$
begin
  -- Gia's cards.
  perform pg_temp.tw_card('A', 'W4130 Closed on time',  'gia.w4130@test.local', 'done',  1, interval '3 days',  interval '30 hours', 'done');
  perform pg_temp.tw_card('B', 'W4130 Closed late',     'gia.w4130@test.local', 'done', -5, interval '10 days', interval '20 hours', 'done', null, 'golive:w4130-b');
  perform pg_temp.tw_card('C', 'W4130 Not needed',      'gia.w4130@test.local', 'done',  2, interval '3 days',  interval '20 hours', 'declined');
  perform pg_temp.tw_card('D', 'W4130 Overdue open',    'gia.w4130@test.local', 'todo', -3, interval '40 days');
  perform pg_temp.tw_card('E', 'W4130 Quiet doing',     'gia.w4130@test.local', 'doing', 5, interval '30 days', null, null, interval '9 days');
  perform pg_temp.tw_card('F', 'W4130 Slipping',        'gia.w4130@test.local', 'todo',  2, interval '20 days');
  perform pg_temp.tw_card('G', 'W4130 Removed',         'gia.w4130@test.local', 'done',  2, interval '3 days',  interval '20 hours', 'done', null, null, true);
  perform pg_temp.tw_card('I', 'W4130 Fresh',           'gia.w4130@test.local', 'todo',  7, interval '2 hours');
  -- Nobody owns this one; Hal writes a note on it.
  perform pg_temp.tw_card('H', 'W4130 Nobody owns',     null,                   'todo',  3, interval '5 days');
  insert into public.ops_work_github (card_id, number, kind, added_by)
  values (pg_temp.tw_id('A'), 41300, 'issue', 'gia.w4130@test.local');

  perform pg_temp.tw_event('A', 'status',  interval '31 hours', 'gia.w4130@test.local', '{"status":"done"}');
  perform pg_temp.tw_event('A', 'closed',  interval '30 hours', 'gia.w4130@test.local');
  perform pg_temp.tw_event('B', 'closed',  interval '20 hours', 'gia.w4130@test.local');
  perform pg_temp.tw_event('F', 'carried', interval '8 days',   'gia.w4130@test.local');
  perform pg_temp.tw_event('F', 'carried', interval '1 hour',   'gia.w4130@test.local');
  perform pg_temp.tw_event('E', 'updated', interval '2 hours',  'gia.w4130@test.local', null, true);
  perform pg_temp.tw_event('G', 'note',    interval '1 hour',   'gia.w4130@test.local');
  perform pg_temp.tw_event('D', 'note',    interval '50 hours', 'gia.w4130@test.local');
  perform pg_temp.tw_event('H', 'note',    interval '2 hours',  'hal.w4130@test.local');
end;
$fixture$;

-- Pipeline records and activity a year back, so nothing else falls in the window.
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, deleted_at, deleted_by) values
  ('41300000-0000-4000-c0ee-000000000001', 'hosts', 'W4130 Touched Host', 'contacted', 'w4130-fixture', 'w4130-fixture', null, null),
  ('41300000-0000-4000-c0ee-000000000002', 'hosts', 'W4130 Moved Host', 'contacted', 'w4130-fixture', 'w4130-fixture', null, null),
  ('41300000-0000-4000-c0ee-000000000003', 'hosts', 'W4130 Onboarded Host', 'onboarded', 'w4130-fixture', 'w4130-fixture', null, null),
  ('41300000-0000-4000-c0ee-000000000004', 'hosts', 'W4130 Earlier Host', 'contacted', 'w4130-fixture', 'w4130-fixture', null, null),
  ('41300000-0000-4000-c0ee-000000000005', 'hosts', 'W4130 Deleted Host', 'contacted', 'w4130-fixture', 'w4130-fixture', now(), 'w4130-fixture'),
  ('41300000-0000-4000-c0ee-000000000006', 'creators', 'W4130 Booked Creator', 'booked', 'w4130-fixture', 'w4130-fixture', null, null);
insert into public.crm_activity (record_id, kind, actor_email, channel, direction, from_stage, to_stage, created_at, occurred_at) values
  ('41300000-0000-4000-c0ee-000000000001', 'touch', 'gia.w4130@test.local', 'whatsapp', 'outbound', null, null, now() - interval '400 days' + interval '1 hour', now() - interval '400 days'),
  ('41300000-0000-4000-c0ee-000000000001', 'touch', 'gia.w4130@test.local', 'email', 'outbound', null, null, now() - interval '400 days' + interval '2 hours', now() - interval '400 days'),
  ('41300000-0000-4000-c0ee-000000000002', 'stage_move', 'gia.w4130@test.local', null, null, 'prospect', 'contacted', now() - interval '400 days' + interval '3 hours', now() - interval '400 days'),
  ('41300000-0000-4000-c0ee-000000000003', 'stage_move', 'gia.w4130@test.local', null, null, 'replied', 'onboarded', now() - interval '400 days' + interval '4 hours', now() - interval '400 days'),
  ('41300000-0000-4000-c0ee-000000000005', 'touch', 'gia.w4130@test.local', 'whatsapp', 'outbound', null, null, now() - interval '400 days' + interval '5 hours', now() - interval '400 days'),
  ('41300000-0000-4000-c0ee-000000000006', 'stage_move', 'gia.w4130@test.local', null, null, 'negotiating', 'booked', now() - interval '400 days' + interval '6 hours', now() - interval '400 days'),
  ('41300000-0000-4000-c0ee-000000000004', 'touch', 'gia.w4130@test.local', 'whatsapp', 'outbound', null, null, now() - interval '401 days' + interval '1 hour', now() - interval '401 days');
insert into public.beta_access_leads (brand_type, brand_name, contact_name, city, email, created_at) values
  ('{restaurant}', 'W4130 Lead', 'W4130 Contact', 'Lagos', 'lead.w4130@test.local', now() - interval '400 days' + interval '7 hours');
set local session_replication_role = origin;

-- W1-EVENTS -------------------------------------------------------------------
do $events$
declare r jsonb; g jsonb;
begin
  r := pg_temp.tw_j(pg_temp.tw_as('growth', $q$select public.ops_events_since(now() - interval '36 hours', 'gia.w4130@test.local')::text$q$));
  perform pg_temp.tw_check('W1-EVENTS', 'four changes since then, for Gia', r->>'total', '4');
  perform pg_temp.tw_check('W1-EVENTS', 'newest first, undone, removed-card and older changes left out, Hal''s note on a card Gia does not own left out',
    (select string_agg((e->'card'->>'title') || ':' || (e->>'action'), ' | ' order by o) from jsonb_array_elements(r->'entries') with ordinality t(e, o)),
    'W4130 Slipping:carried | W4130 Closed late:closed | W4130 Closed on time:closed | W4130 Closed on time:status');
  perform pg_temp.tw_check('W1-EVENTS', 'a status change says where the card went',
    (select e->>'to_status' from jsonb_array_elements(r->'entries') e where e->>'action' = 'status'), 'done');
  perform pg_temp.tw_check('W1-EVENTS', 'not truncated', r->>'truncated', 'false');
  select e into g from jsonb_array_elements(r->'by_person') e where e->>'email' = 'gia.w4130@test.local';
  perform pg_temp.tw_check('W1-EVENTS', 'Gia closed two cards she owns (not the one pushed back as not needed, not the removed one)', g->>'closed', '2');
  perform pg_temp.tw_check('W1-EVENTS', 'Gia added one card since then', g->>'added', '1');
  perform pg_temp.tw_check('W1-EVENTS', 'Gia made four changes', g->>'changes', '4');
  perform pg_temp.tw_check('W1-EVENTS', 'only Gia is listed when filtered to Gia', jsonb_array_length(r->'by_person')::text, '1');

  r := pg_temp.tw_j(pg_temp.tw_as('admin', $q$select public.ops_events_since(now() - interval '36 hours')::text$q$));
  perform pg_temp.tw_check('W1-EVENTS', 'everyone: Hal''s note on the unowned card is there too',
    (select count(*)::text from jsonb_array_elements(r->'entries') e where e->'card'->>'title' = 'W4130 Nobody owns' and e->>'actor_email' = 'hal.w4130@test.local'), '1');
  perform pg_temp.tw_check('W1-EVENTS', 'everyone: Hal is counted with one change',
    (select e->>'changes' from jsonb_array_elements(r->'by_person') e where e->>'email' = 'hal.w4130@test.local'), '1');
end;
$events$;

-- W1-PERIOD -------------------------------------------------------------------
do $period$
declare r jsonb; g jsonb; t jsonb;
begin
  r := pg_temp.tw_j(pg_temp.tw_as('growth', $q$select public.ops_period_summary(now() - interval '14 days', now(), 'gia.w4130@test.local', 'UTC')::text$q$));
  t := r->'totals';
  perform pg_temp.tw_check('W1-PERIOD', 'closed: two (not the push back, not the removed card)', t->>'closed', '2');
  perform pg_temp.tw_check('W1-PERIOD', 'closed on or before the due date: one', t->>'on_time', '1');
  perform pg_temp.tw_check('W1-PERIOD', 'opened in the period: four', t->>'opened', '4');
  perform pg_temp.tw_check('W1-PERIOD', 'overdue now: one', t->>'overdue_now', '1');
  perform pg_temp.tw_check('W1-PERIOD', 'open now: four', t->>'open_now', '4');
  perform pg_temp.tw_check('W1-PERIOD', 'carried at least once: one', t->>'carried', '1');
  perform pg_temp.tw_check('W1-PERIOD', 'carried two or more times: one', t->>'carried_twice', '1');
  select e into g from jsonb_array_elements(r->'by_person') e where e->>'email' = 'gia.w4130@test.local';
  perform pg_temp.tw_check('W1-PERIOD', 'Gia by person: closed, on time, opened, open, late, quiet, carried',
    concat_ws(',', g->>'closed', g->>'on_time', g->>'opened', g->>'open_now', g->>'late_now', g->>'quiet_now', g->>'carried'), '2,1,4,4,1,1,1');
  perform pg_temp.tw_check('W1-PERIOD', 'the weeks add up to the cards closed',
    (select sum((w->>'closed')::integer)::text from jsonb_array_elements(r->'weeks') w), '2');
  perform pg_temp.tw_check('W1-PERIOD', 'each week counts Gia''s closed cards by person',
    (select sum(coalesce((w->'by_person'->>'gia.w4130@test.local')::integer, 0))::text from jsonb_array_elements(r->'weeks') w), '2');
  perform pg_temp.tw_check('W1-PERIOD', 'weeks start on a Monday',
    (select bool_and(extract(isodow from (w->>'week')::date) = 1)::text from jsonb_array_elements(r->'weeks') w), 'true');
  perform pg_temp.tw_check('W1-PERIOD', 'biggest things shipped: the person-written card with GitHub, not the timeline card',
    (select string_agg((s->>'title') || ':' || (s->>'github'), ',') from jsonb_array_elements(r->'shipped') s), 'W4130 Closed on time:true');
  perform pg_temp.tw_check('W1-PERIOD', 'kept slipping: carried twice',
    (select string_agg((s->>'title') || ':' || (s->>'times'), ',') from jsonb_array_elements(r->'slipping') s), 'W4130 Slipping:2');
  perform pg_temp.tw_check('W1-PERIOD', 'review list for Gia: the late card first, then the quiet one',
    (select string_agg(s->>'title', ',' order by o) from jsonb_array_elements(r->'review') with ordinality x(s, o)), 'W4130 Overdue open,W4130 Quiet doing');
  perform pg_temp.tw_check('W1-PERIOD', 'the late card says how late',
    (select s->>'late_days' from jsonb_array_elements(r->'review') s where s->>'title' = 'W4130 Overdue open'), '3');
  perform pg_temp.tw_check('W1-PERIOD', 'the quiet card says how quiet',
    (select s->>'quiet_days' from jsonb_array_elements(r->'review') s where s->>'title' = 'W4130 Quiet doing'), '9');

  r := pg_temp.tw_j(pg_temp.tw_as('admin', $q$select public.ops_period_summary(now() - interval '14 days', now())::text$q$));
  perform pg_temp.tw_check('W1-PERIOD', 'everyone: the card nobody owns is on the review list as no owner',
    (select s->>'no_owner' from jsonb_array_elements(r->'review') s where s->>'title' = 'W4130 Nobody owns'), 'true');
  perform pg_temp.tw_check('W1-PERIOD', 'no time zone given: UTC', r->>'tz', 'UTC');
end;
$period$;

-- W1-PULSE --------------------------------------------------------------------
do $pulse$
declare r jsonb;
begin
  r := pg_temp.tw_j(pg_temp.tw_as('admin', $q$select public.crm_team_pulse(now() - interval '400 days', now() - interval '399 days')::text$q$));
  perform pg_temp.tw_check('W1-PULSE', 'hosts contacted: two records (two touches on one count once; the deleted one never)', r->'now'->>'hosts_contacted', '2');
  perform pg_temp.tw_check('W1-PULSE', 'hosts onboarded: one', r->'now'->>'hosts_onboarded', '1');
  perform pg_temp.tw_check('W1-PULSE', 'host moves by stage', ((r->'now'->'moves'->'hosts') = '{"contacted": 1, "onboarded": 1}'::jsonb)::text, 'true');
  perform pg_temp.tw_check('W1-PULSE', 'creator moves by stage', ((r->'now'->'moves'->'creators') = '{"booked": 1}'::jsonb)::text, 'true');
  perform pg_temp.tw_check('W1-PULSE', 'beta leads that arrived', r->'now'->>'beta_leads', '1');
  perform pg_temp.tw_check('W1-PULSE', 'the period before: one host contacted', r->'before'->>'hosts_contacted', '1');
  perform pg_temp.tw_check('W1-PULSE', 'the owner can read it too',
    pg_temp.tw_j(pg_temp.tw_as('owner', $q$select public.crm_team_pulse(now() - interval '400 days', now() - interval '399 days')::text$q$))->'now'->>'hosts_onboarded', '1');
end;
$pulse$;

-- W1-GATE ---------------------------------------------------------------------
do $gate$
begin
  perform pg_temp.tw_like('W1-GATE', 'no crm area: events refused',
    pg_temp.tw_as('nobody', $q$select public.ops_events_since(now() - interval '1 day')::text$q$), 'ERR:42501:forbidden:%');
  perform pg_temp.tw_like('W1-GATE', 'no crm area: period refused',
    pg_temp.tw_as('nobody', $q$select public.ops_period_summary(now() - interval '7 days', now())::text$q$), 'ERR:42501:forbidden:%');
  perform pg_temp.tw_like('W1-GATE', 'a teammate who is not owner or admin: Team dashboard numbers refused',
    pg_temp.tw_as('growth', $q$select public.crm_team_pulse(now() - interval '7 days', now())::text$q$), 'ERR:42501:forbidden:%');
  perform pg_temp.tw_like('W1-GATE', 'anon cannot run the events read',
    pg_temp.tw_as('anon', $q$select public.ops_events_since(now() - interval '1 day')::text$q$), 'ERR:42501:%');
  perform pg_temp.tw_like('W1-GATE', 'anon cannot run the Team dashboard numbers',
    pg_temp.tw_as('anon', $q$select public.crm_team_pulse(now() - interval '7 days', now())::text$q$), 'ERR:42501:%');
  perform pg_temp.tw_like('W1-GATE', 'a signed-in teammate cannot run the internal events helper',
    pg_temp.tw_as('growth', $q$select count(*)::text from public.ops_events_window(now() - interval '1 day', null)$q$), 'ERR:42501:%');
  perform pg_temp.tw_like('W1-GATE', 'a signed-in teammate cannot run the internal cards helper',
    pg_temp.tw_as('growth', $q$select count(*)::text from public.ops_period_cards(now() - interval '1 day', now(), null)$q$), 'ERR:42501:%');
  perform pg_temp.tw_like('W1-GATE', 'more than 62 days back is refused in words',
    pg_temp.tw_as('growth', $q$select public.ops_events_since(now() - interval '70 days')::text$q$), 'ERR:22023:invalid_query: Pick a moment%');
  perform pg_temp.tw_like('W1-GATE', 'a period over 120 days is refused in words',
    pg_temp.tw_as('growth', $q$select public.ops_period_summary(now() - interval '121 days', now())::text$q$), 'ERR:22023:invalid_query: Pick a period%');
  perform pg_temp.tw_like('W1-GATE', 'an unknown time zone is refused in words',
    pg_temp.tw_as('growth', $q$select public.ops_period_summary(now() - interval '7 days', now(), null, 'Mars/Olympus')::text$q$), 'ERR:22023:invalid_query: That time zone%');
  perform pg_temp.tw_check('W1-GATE', 'PUBLIC holds no execute on the three reads',
    (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid in ('public.ops_events_since(timestamptz,text)'::regprocedure, 'public.ops_period_summary(timestamptz,timestamptz,text,text)'::regprocedure,
                      'public.crm_team_pulse(timestamptz,timestamptz)'::regprocedure) and a.grantee = 0), '0');
end;
$gate$;

-- W1-WAIT: two send cards for Gia, one with its draft ready, one without.
do $wait$
declare v_draft uuid; v_mine jsonb; v_board jsonb; v_owner jsonb;
begin
  perform pg_temp.tw_card('S1', 'W4130 Send with draft ready', 'gia.w4130@test.local', 'person', 2, interval '1 day');
  perform pg_temp.tw_card('S2', 'W4130 Send needs a draft',    'gia.w4130@test.local', 'person', 2, interval '1 day');
  perform pg_temp.tw_card('S3', 'W4130 Hal waits too',         'hal.w4130@test.local', 'person', 2, interval '1 day');
  insert into public.team_drafts (owner_email, record_id, channel, body, original_body, created_via, request_key)
  values ('gia.w4130@test.local', gen_random_uuid(), 'email', 'Hello from the test.', 'Hello from the test.', 'claude', 'w4130-wait-s1')
  returning id into v_draft;
  update public.ops_work_cards set proof = jsonb_build_array(jsonb_build_object('kind', 'draft', 'id', v_draft))
   where id = pg_temp.tw_id('S1');
  perform pg_temp.tw_check('W1-WAIT', 'fixture: the first send card has its draft ready',
    public.ops_send_draft_waiting(pg_temp.tw_id('S1'), (select proof from public.ops_work_cards where id = pg_temp.tw_id('S1')))::text, 'true');

  v_mine := pg_temp.tw_j(pg_temp.tw_as('growth', $q$select public.ops_my_counts()::text$q$));
  v_board := pg_temp.tw_j(pg_temp.tw_as('growth', $q$select public.ops_work_list('{"who":"mine","status":["person"],"done_days":0,"limit":1}'::jsonb)::text$q$));
  v_owner := pg_temp.tw_j(pg_temp.tw_as('growth', $q$select public.ops_work_list('{"owner":"gia.w4130@test.local","done_days":0,"limit":1}'::jsonb)::text$q$));
  perform pg_temp.tw_check('W1-WAIT', 'your own waiting cards count the send card whose draft is ready',
    v_mine ->> 'waiting_on_person_mine', '2');
  perform pg_temp.tw_check('W1-WAIT', 'the Work menu count equals the Work board (who=mine)',
    v_mine ->> 'waiting_on_person_mine', v_board -> 'counts' ->> 'person');
  perform pg_temp.tw_check('W1-WAIT', 'and equals the board filtered to you (owner chip)',
    v_mine ->> 'waiting_on_person_mine', v_owner -> 'counts' ->> 'person');
  perform pg_temp.tw_check('W1-WAIT', 'the older keys left the ready send card out (why the pages disagreed)',
    ((v_mine ->> 'needs_person_mine')::int + (v_mine ->> 'draft_needed_mine')::int)::text, '1');
  perform pg_temp.tw_check('W1-WAIT', 'someone else''s waiting card is not yours',
    pg_temp.tw_j(pg_temp.tw_as('hal', $q$select public.ops_my_counts()::text$q$)) ->> 'waiting_on_person_mine', '1');
end;
$wait$;

select count(*) as tw_total, count(*) filter (where not ok) as tw_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tw_failures
  from tw_results \gset
rollback;

select (:tw_total < 40 or :tw_failed > 0) as tw_bad \gset
\if :tw_bad
  \echo 'ISSUE-4130 WAVE1 WORK VIEWS FAILED:' :tw_failed 'of' :tw_total
  \echo :tw_failures
  do $$ begin raise exception 'ISSUE-4130 WAVE1 WORK VIEWS FAIL'; end $$;
\endif
\echo 'ISSUE-4130 WAVE1 WORK VIEWS PASS:' :tw_total 'checks, 0 failed'
