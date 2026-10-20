-- Issue #3980 synced program, final proof pass (Wave 4, P1) -- tester
-- adversarial suite, on the fully replayed PG17 schema, after all four waves
-- are integrated. It attacks the joins between the waves that no single-wave
-- suite reaches:
--   PP-1  the order of news is reversed: GitHub says Done first (the issue
--         only reads Shipped, nothing waiting moves, nothing is drafted for
--         hosts), and the release record completes later. The 10-minute run
--         then unblocks the waiting card once, drafts one "Recently shipped"
--         card that hosts and anonymous readers never see, makes one
--         approval card for a person, and the ticket reads Live; later runs
--         repeat none of it.
--   PP-2  follow-through starts at switch-on (X3) while Bridge B does not:
--         a complete record merged before switch-on still turns its Feature
--         Guide entry Live, an incomplete record merged before switch-on
--         makes no engineering card, the same problems merged after
--         switch-on make one card each, a second run makes no duplicate, and
--         with automatic steps never switched on nothing is followed up.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create temp table tpp_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tpp_people (who, id, email) values
  ('owner',   '39970000-0000-4000-a000-000000000001', 'oona.pp3980@test.local'),
  ('growth',  '39970000-0000-4000-a000-000000000002', 'gus.pp3980@test.local'),
  ('support', '39970000-0000-4000-a000-000000000003', 'suki.pp3980@test.local'),
  ('host',    '39970000-0000-4000-a000-000000000004', 'hana.pp3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tpp_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.pp3980@test.local', 'owner', 'active', now() - interval '7300 days');
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gus.pp3980@test.local', 'growth', 'active', now()),
  ('suki.pp3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values ('39970000-0000-4000-a000-000000000003', true, true, 'staff');
set local session_replication_role = origin;

create temp table tpp_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.tpp_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from tpp_people where who = p_who;
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

create function pg_temp.tpp_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tpp_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tpp_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.tpp_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.tpp_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tpp_reconcile() returns text
language sql as $fn$ select pg_temp.tpp_as('service', 'select public.ops_reconcile()::text') $fn$;

create function pg_temp.tpp_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.tpp_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.tpp_issue(p_n int, p_board text) returns jsonb
language sql as $fn$
  select jsonb_build_object('number', p_n, 'found', true, 'kind', 'issue', 'title', 'PP issue ' || p_n,
    'url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_n, 'state', case when p_board = 'Done' then 'CLOSED' else 'OPEN' end,
    'merged', false, 'merged_at', null, 'merge_sha', null, 'closing_issues', '[]'::jsonb,
    'board_status', p_board, 'board_horizon', 'Now', 'updated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
$fn$;

-- A merge-bot record JSON; p_hours_ago sets the merge time; complete unless p_extra says otherwise.
create function pg_temp.tpp_record(p_pr int, p_hours_ago int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'PP record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', to_char((now() - make_interval(hours => p_hours_ago)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', repeat(to_hex(p_pr % 16), 40), 'merged_by', 'oona-gh', 'author', 'oona-gh',
    'issues', '[]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '["mingla-admin"]'::jsonb, 'deploy_marker', true,
    'deploy', '{"web":{"mingla-admin":"ready"},"edge":"none"}'::jsonb, 'feature_guide', '[]'::jsonb,
    'live_check', jsonb_build_object('text', 'Checked it in production', 'by_login', 'oona-gh',
      'url', 'https://github.com/Mingla-LLC/mingla-main/issues/9700#issuecomment-' || p_pr,
      'at', to_char((now() - interval '10 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'test_files', '["supabase/migrations/__tests__/pp_fixture.pg17.test.sql"]'::jsonb, 'problems', '[]'::jsonb) || p_extra
$fn$;

create function pg_temp.tpp_ingest(p_data jsonb, p_issue int) returns text
language sql as $fn$
  select pg_temp.tpp_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data,
      'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-7' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

-- Fixtures: a planned staff entry the PP-2 record names, a roadmap card, a ticket chain.
insert into public.product_capabilities (capability_key, title, outcome_summary, who_can_use, surfaces, how_to, limitations, support_wording,
  claimed_status, required_evidence_kinds)
values ('pp-proof-entry', 'PP proof entry', 'PP proof entry: the team can use it today. More words follow.', ARRAY['staff'], ARRAY['admin'],
  'Open Admin and use it there.', 'None known yet.', 'It works for every host.', 'planned', ARRAY['source', 'release_record', 'live_check']);
insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
  ('39970000-0000-4000-c100-000000000001', 'PP Trips publish with dates', 'Trips with dates publish every time.', 'now', 'published', 970);
set local session_replication_role = replica;
insert into public.conversations (id) values ('39970000-0000-4000-c500-000000000001') on conflict do nothing;
insert into public.support_tickets (id, requester_user_id, requester_segment, subject, status, priority, conversation_id)
values ('39970000-0000-4000-c400-000000000001', '39970000-0000-4000-a000-000000000004', 'business', 'PP trip will not publish', 'open', 'normal', '39970000-0000-4000-c500-000000000001');
insert into public.support_product_signals (id, client_request_id, signal_kind, state, title, problem_statement, product_area, user_journey, impact_summary, next_update_at, next_step, customer_reply_draft, created_by)
values ('39970000-0000-4000-c600-000000000001', gen_random_uuid(), 'bug', 'linked', 'PP trips', 'Trips do not publish.', 'Trips', 'Publish a trip', 'Hosts cannot publish.', now() + interval '1 day', 'Engineering fixes it.', 'We are on it.', '39970000-0000-4000-a000-000000000003');
insert into public.support_product_signal_sources (signal_id, source_kind, source_id, linked_by)
values ('39970000-0000-4000-c600-000000000001', 'support_ticket', '39970000-0000-4000-c400-000000000001', '39970000-0000-4000-a000-000000000003');
insert into public.product_avengers_items (id, issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status, board_horizon)
values ('39970000-0000-4000-c700-000000000001', 9701, 'I_pp9701', 'PVTI_pp9701', 'https://github.com/Mingla-LLC/mingla-main/issues/9701', 'PP trips', 'OPEN', 'In Progress', 'Now');
insert into public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by)
values ('39970000-0000-4000-c600-000000000001', '39970000-0000-4000-c700-000000000001', 'existing', '39970000-0000-4000-a000-000000000003');
set local session_replication_role = origin;

-- ======================================================================
-- PP-1: Done first, the record later.
-- ======================================================================
do $pp1$
declare v text; v_card text; v_rev bigint; v_drafts int; v_events int; v_told int;
begin
  -- Gus's card waits for #9701; the owner links the roadmap card to #9701.
  v := pg_temp.tpp_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(jsonb_build_object(
    'title', 'PP relaunch the trip once #9701 is Live', 'instructions', 'Relaunch the trip when trips publish again.',
    'done_means', 'The trip is published again.', 'owners', jsonb_build_array('gus.pp3980@test.local'),
    'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', jsonb_build_array('#9701'))), 'pp1-card-0001'));
  v_card := pg_temp.tpp_get(v, 'results', '0', 'card', 'id');
  select revision into v_rev from public.ops_work_cards where id = v_card::uuid;
  v := pg_temp.tpp_person('growth', format('select public.ops_work_update(%L::uuid, %L::jsonb, %s, %L)::text', v_card, '{"blocked_on_github": true}', v_rev, 'pp1-block-0001'));
  perform pg_temp.tpp_check('PP-1', 'a person sets the card to wait for #9701', (select blocked::text || ':' || blocked_kind from public.ops_work_cards where id = v_card::uuid), 'true:github');
  v := pg_temp.tpp_person('owner', $q$select public.ops_roadmap_link_set('39970000-0000-4000-c100-000000000001', '#9701')::text$q$);
  perform pg_temp.tpp_check('PP-1', 'the owner links the roadmap card to #9701', pg_temp.tpp_get(v, 'issue_number'), '9701');

  -- GitHub: #9701 is Done. No record yet.
  v := pg_temp.tpp_apply(jsonb_build_array(pg_temp.tpp_issue(9701, 'Done')));
  perform pg_temp.tpp_check('PP-1', 'Done without a complete record reads Shipped, not Live', public.ops_github_status(9701)->>'label', 'Shipped');
  v := pg_temp.tpp_reconcile();
  perform pg_temp.tpp_check('PP-1', 'nothing waiting for a Shipped issue moves', (select blocked::text from public.ops_work_cards where id = v_card::uuid), 'true');
  perform pg_temp.tpp_check('PP-1', 'nothing is drafted for hosts while it is only Shipped',
    (select count(*)::text from public.community_roadmap_cards where public_title = 'PP Trips publish with dates' and status = 'draft'), '0');
  v := pg_temp.tpp_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39970000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.tpp_check('PP-1', 'the ticket reads Shipped and not Live', pg_temp.tpp_get(v, 'label') || ':' || pg_temp.tpp_get(v, 'live'), 'Shipped:false');

  -- The release record completes later.
  v := pg_temp.tpp_ingest(pg_temp.tpp_record(97010, 2, '{"issues":[{"number":9701,"relation":"fixes"}]}'::jsonb), 9701);
  perform pg_temp.tpp_check('PP-1', 'the record is complete', (select complete::text from public.ops_release_records where pr = 97010), 'true');
  perform pg_temp.tpp_check('PP-1', 'Done plus a complete record reads Live', public.ops_github_status(9701)->>'label', 'Live');
  v := pg_temp.tpp_reconcile();
  perform pg_temp.tpp_check('PP-1', 'the next run unblocks the waiting card', (select blocked::text || ':' || status from public.ops_work_cards where id = v_card::uuid), 'false:todo');
  select count(*) into v_events from public.ops_work_events where card_id = v_card::uuid and action = 'unblocked';
  perform pg_temp.tpp_check('PP-1', 'one unblocked event', v_events::text, '1');
  select count(*) into v_drafts from public.community_roadmap_cards where public_title = 'PP Trips publish with dates' and status = 'draft' and lane = 'shipped';
  perform pg_temp.tpp_check('PP-1', 'one Recently shipped draft, as a draft', v_drafts::text, '1');
  perform pg_temp.tpp_check('PP-1', 'one approval card for a person',
    (select count(*)::text || ':' || min(status) || ':' || min(person_reason) from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-9701'), '1:person:publish');
  v := pg_temp.tpp_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39970000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.tpp_check('PP-1', 'the ticket reads Live and names the complete record',
    pg_temp.tpp_get(v, 'label') || ':' || pg_temp.tpp_get(v, 'live') || ':' || pg_temp.tpp_get(v, 'record', 'pr') || ':' || pg_temp.tpp_get(v, 'record', 'complete'), 'Live:true:97010:true');
  -- Hosts and anonymous readers never see the draft.
  v := pg_temp.tpp_as('host', $q$select count(*)::text from public.community_roadmap_cards where public_title = 'PP Trips publish with dates' and status = 'draft'$q$);
  -- (a refused read is also no draft)
  perform pg_temp.tpp_check('PP-1', 'a host reads no draft', case when v like 'ERR:%' then '0' else v end, '0');
  v := pg_temp.tpp_as('anon', $q$select count(*)::text from public.community_roadmap_cards where public_title = 'PP Trips publish with dates' and status = 'draft'$q$);
  perform pg_temp.tpp_check('PP-1', 'an anonymous reader reads no draft', case when v like 'ERR:%' then '0' else v end, '0');
  -- Later runs repeat nothing.
  v := pg_temp.tpp_reconcile();
  v := pg_temp.tpp_apply(jsonb_build_array(pg_temp.tpp_issue(9701, 'Done')));
  v := pg_temp.tpp_reconcile();
  perform pg_temp.tpp_check('PP-1', 'still one draft after two more runs',
    (select count(*)::text from public.community_roadmap_cards where public_title = 'PP Trips publish with dates' and status = 'draft'), '1');
  perform pg_temp.tpp_check('PP-1', 'still one unblocked event after two more runs',
    (select count(*)::text from public.ops_work_events where card_id = v_card::uuid and action = 'unblocked'), '1');
  perform pg_temp.tpp_check('PP-1', 'still one approval card after two more runs',
    (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-9701'), '1');
  perform pg_temp.tpp_check('PP-1', 'no run published anything',
    (select count(*)::text from public.community_roadmap_cards where public_title = 'PP Trips publish with dates' and lane = 'shipped' and status = 'published'), '0');
end;
$pp1$;

-- ======================================================================
-- PP-2: follow-through from switch-on (X3); Bridge B is not held back.
-- ======================================================================
do $pp2$
declare v text;
begin
  -- Automatic steps never switched on: nothing is followed up at all.
  perform pg_temp.tpp_check('PP-2', 'follow_through_since starts empty', public.ops_setting('follow_through_since')::text, 'null');
  v := pg_temp.tpp_ingest(pg_temp.tpp_record(97020, 1, '{"web_projects":["mingla-admin"],"deploy_marker":false,"deploy":{"web":{"mingla-admin":"not_deployed"},"edge":"none"},"live_check":null,"feature_guide":null}'::jsonb), 97020);
  v := pg_temp.tpp_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.tpp_check('PP-2', 'switched off: an incomplete record makes no engineering card',
    (select count(*)::text from public.ops_work_cards where auto_key ~ '^eng_[a-z_]+:pr-97020(:|$)'), '0');

  -- The owner switches automatic steps on; follow-through starts now.
  v := pg_temp.tpp_person('owner', $q$select public.ops_setting_set('auto_steps', 'true'::jsonb)::text$q$);
  perform pg_temp.tpp_check('PP-2', 'switch-on records follow_through_since', (public.ops_setting('follow_through_since') is not null and public.ops_setting('follow_through_since') <> 'null'::jsonb)::text, 'true');
  update public.ops_settings set value = to_jsonb(now() - interval '1 hour') where key = 'follow_through_since';

  -- Before switch-on: a complete record naming a planned entry still turns it Live (Bridge B).
  v := pg_temp.tpp_ingest(pg_temp.tpp_record(97021, 3, '{"feature_guide":["pp-proof-entry"]}'::jsonb), 97021);
  perform pg_temp.tpp_check('PP-2', 'a record merged before switch-on still turns its entry Live',
    (select claimed_status from public.product_capabilities where capability_key = 'pp-proof-entry'), 'live');
  -- Before switch-on: an incomplete record makes no follow-through card.
  v := pg_temp.tpp_ingest(pg_temp.tpp_record(97022, 3, '{"issues":[],"problems":["no_issue","feature_guide_missing","web_not_deployed","live_check_missing"],"deploy_marker":false,"deploy":{"web":{"mingla-admin":"not_deployed"},"edge":"none"},"live_check":null,"feature_guide":null}'::jsonb), 97022);
  -- After switch-on: the same problems make one card each.
  v := pg_temp.tpp_ingest(pg_temp.tpp_record(97023, 0, '{"issues":[],"problems":["no_issue","feature_guide_missing","web_not_deployed","live_check_missing"],"deploy_marker":false,"deploy":{"web":{"mingla-admin":"not_deployed"},"edge":"none"},"live_check":null,"feature_guide":null}'::jsonb), 97023);
  v := pg_temp.tpp_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.tpp_check('PP-2', 'merged before switch-on: no engineering card',
    (select count(*)::text from public.ops_work_cards where auto_key ~ '^eng_[a-z_]+:pr-97022(:|$)'), '0');
  perform pg_temp.tpp_check('PP-2', 'merged after switch-on: no issue, guide line and not deployed each make one card',
    (select string_agg(split_part(auto_key, ':', 1), ',' order by auto_key) from public.ops_work_cards where auto_key ~ '^eng_[a-z_]+:pr-97023(:|$)'),
    'eng_guide_missing,eng_no_issue,eng_not_deployed');
  perform pg_temp.tpp_check('PP-2', 'the card for whoever merged has the owner as owner (no GitHub login match)',
    (select string_agg(distinct p.email, ',') from public.ops_work_people p join public.ops_work_cards c on c.id = p.card_id
      where c.auto_key ~ '^eng_[a-z_]+:pr-97023(:|$)' and p.role = 'owner'), 'oona.pp3980@test.local');
  v := pg_temp.tpp_as('service', 'select public.ops_engineering_cards_sync()::text');
  v := pg_temp.tpp_reconcile();
  perform pg_temp.tpp_check('PP-2', 'a second sync and a run make no duplicate',
    (select count(*)::text from public.ops_work_cards where auto_key ~ '^eng_[a-z_]+:pr-9702[0-3](:|$)'), '3');
  perform pg_temp.tpp_check('PP-2', 'the record switched off earlier still makes nothing (merged before switch-on)',
    (select count(*)::text from public.ops_work_cards where auto_key ~ '^eng_[a-z_]+:pr-97020(:|$)'), '0');
end;
$pp2$;

select count(*) as tpp_total, count(*) filter (where not ok) as tpp_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tpp_failures
  from tpp_results \gset
rollback;

select (:tpp_total < 25 or :tpp_failed > 0) as tpp_bad \gset
\if :tpp_bad
  \echo 'ISSUE-3980 SYNCED PROOF PASS TESTER FAILED:' :tpp_failed 'of' :tpp_total
  \echo :tpp_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED PROOF PASS TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED PROOF PASS TESTER PASS:' :tpp_total 'checks, 0 failed'
