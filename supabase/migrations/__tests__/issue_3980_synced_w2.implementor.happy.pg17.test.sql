-- Issue #3980 synced program, Wave 2 -- the bridges, on the fully replayed
-- PG17 schema.
-- MINGLA-INVARIANT: I-3980-LIVE-ONLY-WITH-EVIDENCE | issue #3980 | A Feature Guide entry turns Live from a release record only when every evidence kind it requires is current and verified; an incomplete record changes nothing and says what is missing.
-- MINGLA-INVARIANT: I-3980-HOSTS-TOLD-ONLY-BY-SETH | issue #3980 | Bridge drafts for the roadmap and announcements are created as drafts only, and nothing reaches hosts until the owner or an admin publishes it.
--
-- What it proves (each check is recorded and reported together):
--   B1   the follow list holds every linked number (Work cards, roadmap
--        cards, release records, the Product Inbox), never-read first; the
--        apply takes only followed numbers, corrects an issue that is a pull
--        request, marks a missing number "Not on GitHub", logs status
--        changes; only the bridge may call either; the chips say the D-15
--        words for every board status and pull request state
--   B5   a card waits for its GitHub issues and unblocks itself only when
--        every one is Live, telling its owners; an agent cannot lift the
--        wait, a person can
--   B6   roadmap suggestions from Status and Horizon, never a lane change;
--        dismiss hides a suggestion; apply only returns the lane
--   B4   a Live issue drafts one "Recently shipped" card (a draft hosts
--        cannot see) and one person card to approve it; never twice; the
--        approval closes itself after a person publishes
--   B2   a complete record turns an entry Live with the evidence it proves
--        (D-16); an entry still missing a required kind is not changed and
--        the record lists what is missing; an incomplete record changes
--        nothing; Support teammates are told
--   B3   a ticket shows its engineering status for Support, refused for a
--        teammate without Support
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

create temp table t3980w2_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2_people (who, id, email) values
  ('owner',   '39820000-0000-4000-a000-000000000001', 'ed.w23980@test.local'),
  ('admin',   '39820000-0000-4000-a000-000000000002', 'di.w23980@test.local'),
  ('growth',  '39820000-0000-4000-a000-000000000003', 'ada.w23980@test.local'),
  ('support', '39820000-0000-4000-a000-000000000004', 'sue.w23980@test.local'),
  ('partner', '39820000-0000-4000-a000-000000000005', 'cy.w23980@test.local'),
  ('host',    '39820000-0000-4000-a000-000000000006', 'hal.w23980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w23980@test.local', 'owner', 'active', now()),
  ('di.w23980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w23980@test.local', 'growth', 'active', now()),
  ('sue.w23980@test.local', 'growth', 'active', now()),
  ('cy.w23980@test.local', 'partner', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values ('39820000-0000-4000-a000-000000000004', true, true, 'staff');
set local session_replication_role = origin;

create temp table t3980w2_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980w2_ids (k text primary key, v text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2_people where who = p_who;
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

create function pg_temp.t3980w2_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2_id(p_k text) returns text
language sql as $fn$ select v from t3980w2_ids where k = p_k $fn$;

create function pg_temp.t3980w2_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980w2_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.t3980w2_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2_next_request();
  return pg_temp.t3980w2_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly: the request row
-- the connector writes first, in this transaction, then the call.
create function pg_temp.t3980w2_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2_next_request();
  select id, email into strict v_id, v_email from t3980w2_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2_as(p_who, p_sql);
end;
$fn$;

-- What GitHub said about a number, in the shape the sync hands in.
create function pg_temp.t3980w2_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
                                  p_state text default 'OPEN', p_merged boolean default false) returns jsonb
language sql as $fn$
  select jsonb_build_object('number', p_n, 'found', true, 'kind', p_kind, 'title', 'W2 item ' || p_n,
    'url', 'https://github.com/Mingla-LLC/mingla-main/' || case p_kind when 'pull' then 'pull/' else 'issues/' end || p_n,
    'state', p_state, 'merged', p_merged, 'merged_at', case when p_merged then '2026-10-20T09:00:00Z' end,
    'merge_sha', case when p_merged then repeat('a', 40) end, 'closing_issues', '[]'::jsonb,
    'board_status', p_board, 'board_horizon', p_horizon, 'updated_at', '2026-10-20T09:00:00Z')
$fn$;

create function pg_temp.t3980w2_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2_record(p_pr int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'W2 record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', to_char((now() - interval '2 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', repeat(to_hex(p_pr % 16), 40), 'merged_by', 'ed-gh', 'author', 'ed-gh',
    'issues', '[]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '["mingla-admin"]'::jsonb, 'deploy_marker', true,
    'deploy', '{"web":{"mingla-admin":"ready"},"edge":"none"}'::jsonb, 'feature_guide', '[]'::jsonb,
    'live_check', jsonb_build_object('text', 'Opened it in production and it worked', 'by_login', 'ed-gh',
      'url', 'https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-' || p_pr,
      'at', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'test_files', '["supabase/migrations/__tests__/w2_fixture.pg17.test.sql"]'::jsonb, 'problems', '[]'::jsonb) || p_extra
$fn$;

create function pg_temp.t3980w2_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-9' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('ada.w23980@test.local'),
      'watchers', jsonb_build_array('di.w23980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

-- Fixtures: three roadmap cards, an Avengers item linked from a ticket.
insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
  ('39820000-0000-4000-c100-000000000001', 'W2 Better host payouts', 'Payouts land the next day. More soon.', 'later', 'published', 900),
  ('39820000-0000-4000-c100-000000000002', 'W2 Calendar for hosts', 'See every event in one place.', 'next', 'published', 901),
  ('39820000-0000-4000-c100-000000000003', 'W2 Missing issue card', 'Linked to a number GitHub does not have.', 'now', 'published', 902);
insert into public.support_product_signals (id, client_request_id, signal_kind, state, title, problem_statement, product_area, user_journey,
  impact_summary, next_update_at, next_step, customer_reply_draft, created_by) values
  ('39820000-0000-4000-c200-000000000001', gen_random_uuid(), 'bug', 'linked', 'W2 payouts late', 'Payouts arrive late.', 'Payouts',
   'Host waits for money', 'Hosts are upset', now() + interval '1 day', 'Fix it', 'We are on it.', '39820000-0000-4000-a000-000000000004');
insert into public.product_avengers_items (id, issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status)
values ('39820000-0000-4000-c300-000000000001', 5005, 'I_w2node5005', 'PVTI_w2item5005', 'https://github.com/Mingla-LLC/mingla-main/issues/5005',
        'W2 payouts are late', 'OPEN', 'In Progress');
insert into public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by)
values ('39820000-0000-4000-c200-000000000001', '39820000-0000-4000-c300-000000000001', 'existing', '39820000-0000-4000-a000-000000000004');
insert into public.support_product_signal_sources (signal_id, source_kind, source_id, linked_by)
values ('39820000-0000-4000-c200-000000000001', 'support_ticket', '39820000-0000-4000-c400-000000000001', '39820000-0000-4000-a000-000000000004');
insert into public.product_capabilities (capability_key, title, outcome_summary, who_can_use, surfaces, how_to, limitations, support_wording,
  claimed_status, required_evidence_kinds) values
  ('w2-guide-proven', 'W2 proven entry', 'Hosts can see payouts. Search words: payouts, money.', ARRAY['staff'], ARRAY['admin'],
   'Open Admin and look at payouts there.', 'None known yet.', 'Payouts are visible to hosts in their app.', 'planned',
   ARRAY['source','test','release_record','live_check']),
  ('w2-guide-route', 'W2 entry needing a route', 'Hosts can open the calendar from anywhere today.', ARRAY['staff'], ARRAY['admin'],
   'Open Admin and look at the calendar.', 'None known yet.', 'The calendar opens from the main menu.', 'planned',
   ARRAY['source','release_record','route']),
  ('w2-guide-waiting', 'W2 entry on an incomplete record', 'Hosts can export their guest lists now.', ARRAY['staff'], ARRAY['admin'],
   'Open Admin and export the guests.', 'None known yet.', 'Guest lists export from the event page.', 'planned',
   ARRAY['source','release_record']);

-- ---------------------------------------------------------------------------
-- B1: follow list, apply, chips.
-- ---------------------------------------------------------------------------
do $b1$
declare v text; v_card text; v_list jsonb;
begin
  v_card := pg_temp.t3980w2_card('growth', 'W2 follow the payouts work', '["#5001", "#5002"]', 'w2-b1-card-0001');
  perform pg_temp.t3980w2_keep('card_follow', v_card);
  v := pg_temp.t3980w2_person('owner', $q$select public.ops_roadmap_link_set('39820000-0000-4000-c100-000000000003', '#5003')::text$q$);
  perform pg_temp.t3980w2_check('B1', 'an owner links a roadmap card to its issue, checking GitHub until it is read',
    pg_temp.t3980w2_get(v, 'issue_number') || ':' || pg_temp.t3980w2_get(v, 'issue', 'label'), '5003:Checking GitHub');
  perform pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(94001, '{"issues":[{"number":5004,"relation":"toward"}],"live_check":null,"problems":["live_check_missing"]}'), 5004);

  v := pg_temp.t3980w2_person('owner', 'select public.ops_github_follow_list(200)::text');
  perform pg_temp.t3980w2_like('B1', 'a person cannot read the follow list', v, 'ERR:42501:%');
  v := pg_temp.t3980w2_person('owner', format('select public.ops_github_items_apply(%L::jsonb)::text', '[]'));
  perform pg_temp.t3980w2_like('B1', 'a person cannot hand in GitHub status', v, 'ERR:42501:%');

  v := pg_temp.t3980w2_as('service', 'select public.ops_github_follow_list(200)::text');
  v_list := pg_temp.t3980w2_j(v);
  perform pg_temp.t3980w2_check('B1', 'the follow list holds the Work card links, the roadmap link, the record''s issue and the Product Inbox issue',
    (select string_agg(x->>'number' || ':' || (x->>'kind_hint'), ',' order by (x->>'number')::int) from jsonb_array_elements(v_list) x
      where (x->>'number')::int between 5001 and 5005), '5001:issue,5002:issue,5003:issue,5004:issue,5005:issue');
  perform pg_temp.t3980w2_check('B1', 'each followed number has a placeholder until GitHub is read',
    (select count(*)::text from public.ops_github_items where number between 5001 and 5005 and synced_at is null), '5');

  v := pg_temp.t3980w2_apply(jsonb_build_array(
    pg_temp.t3980w2_gh(5001, 'issue', 'In Progress', 'Now'),
    pg_temp.t3980w2_gh(5002, 'pull', null, null, 'MERGED', true),
    jsonb_build_object('number', 5003, 'found', false),
    pg_temp.t3980w2_gh(9876543, 'issue', 'Done')));
  perform pg_temp.t3980w2_check('B1', 'only followed numbers are taken', pg_temp.t3980w2_get(v, 'applied') || '/' || pg_temp.t3980w2_get(v, 'skipped'), '3/1');
  perform pg_temp.t3980w2_check('B1', 'a number nobody follows is never stored', (select count(*)::text from public.ops_github_items where number = 9876543), '0');
  perform pg_temp.t3980w2_check('B1', 'a link saved as an issue that GitHub says is a pull request is corrected',
    (select kind from public.ops_work_github where card_id = v_card::uuid and number = 5002), 'pull');
  perform pg_temp.t3980w2_check('B1', 'the chips read In Progress, Merged and Not on GitHub',
    (public.ops_github_status(5001)->>'label') || ',' || (public.ops_github_status(5002)->>'label') || ',' || (public.ops_github_status(5003)->>'label'),
    'In Progress,Merged,Not on GitHub');
  perform pg_temp.t3980w2_check('B1', 'the card shows the same chips',
    (select string_agg(g->>'label', ',' order by (g->>'number')::int) from jsonb_array_elements(
       pg_temp.t3980w2_j(pg_temp.t3980w2_person('growth', format('select public.ops_work_get(%L, null)::text', v_card))) #> '{card,github}') g),
    'In Progress,Merged');
  v := pg_temp.t3980w2_as('service', 'select public.ops_github_follow_list(2)::text');
  perform pg_temp.t3980w2_check('B1', 'numbers never read come first',
    (select string_agg(x->>'number', ',' order by ord) from jsonb_array_elements(pg_temp.t3980w2_j(v)) with ordinality t(x, ord)), '5004,5005');
  v := pg_temp.t3980w2_apply(jsonb_build_array(pg_temp.t3980w2_gh(5001, 'issue', 'In Review', 'Now')));
  perform pg_temp.t3980w2_check('B1', 'a status change of a number read before is logged once',
    pg_temp.t3980w2_get(v, 'changed') || '/' || (select summary from public.ops_agent_log where action = 'release_record' and target_kind = 'github'
                                                  and detail->>'number' = '5001' order by id desc limit 1),
    '[5001]/GitHub #5001 is now In Review (was In Progress).');
  v := pg_temp.t3980w2_person('growth', 'select public.ops_github_status_list(array[5001, 5002, 5001])::text');
  perform pg_temp.t3980w2_check('B1', 'a teammate on the pipelines reads chips, each number once',
    (select string_agg(x->>'number' || ':' || (x->>'label'), ',') from jsonb_array_elements(pg_temp.t3980w2_j(v) -> 'items') x), '5001:In Review,5002:Merged');
  v := pg_temp.t3980w2_person('host', 'select public.ops_github_status_list(array[5001])::text');
  perform pg_temp.t3980w2_like('B1', 'someone off the team cannot read chips', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980w2_person('growth', format('select public.ops_github_status_list(%L::int[])::text', (select array_agg(g) from generate_series(1, 51) g)));
  perform pg_temp.t3980w2_like('B1', 'at most 50 numbers at once', v, 'ERR:22023:invalid_numbers:%');
end;
$b1$;

-- D-15: the chip words for each board status and pull request state.
do $d15$
declare r record;
begin
  insert into public.ops_github_items (number, kind) values (5101, 'issue'), (5102, 'issue'), (5103, 'issue'), (5104, 'issue'),
    (5105, 'issue'), (5106, 'issue'), (5107, 'pull'), (5108, 'pull'), (5109, 'pull'), (5110, 'pull');
  perform pg_temp.t3980w2_apply(jsonb_build_array(
    pg_temp.t3980w2_gh(5101, 'issue', 'Todo'), pg_temp.t3980w2_gh(5102, 'issue', null), pg_temp.t3980w2_gh(5103, 'issue', 'In Progress'),
    pg_temp.t3980w2_gh(5104, 'issue', 'In Review'), pg_temp.t3980w2_gh(5105, 'issue', 'Done', null, 'CLOSED'),
    pg_temp.t3980w2_gh(5106, 'issue', 'Done', null, 'CLOSED'), pg_temp.t3980w2_gh(5107, 'pull'), pg_temp.t3980w2_gh(5108, 'pull', null, null, 'CLOSED'),
    pg_temp.t3980w2_gh(5109, 'pull', null, null, 'MERGED', true), pg_temp.t3980w2_gh(5110, 'pull', null, null, 'MERGED', true)));
  perform pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(5110, '{"issues":[{"number":5106,"relation":"fixes"}]}'), 5106);
  for r in select * from (values (5101, 'Planned'), (5102, 'Planned'), (5103, 'In Progress'), (5104, 'In Review'), (5105, 'Shipped'),
                                 (5106, 'Live'), (5107, 'Open'), (5108, 'Closed'), (5109, 'Merged'), (5110, 'Live')) t(n, want) loop
    perform pg_temp.t3980w2_check('D15', format('#%s reads %s', r.n, r.want), public.ops_github_status(r.n)->>'label', r.want);
  end loop;
end;
$d15$;

-- ---------------------------------------------------------------------------
-- B5: a card waits for its GitHub issues and unblocks only when all are Live.
-- ---------------------------------------------------------------------------
do $b5$
declare v text; v_card text; v_two text; v_none text; v_told int;
begin
  insert into public.ops_github_items (number, kind) values (5201, 'issue'), (5202, 'issue') on conflict do nothing;
  v_card := pg_temp.t3980w2_card('growth', 'W2 wait for the payouts issue', '["#5201"]', 'w2-b5-card-0001');
  v_two := pg_temp.t3980w2_card('growth', 'W2 wait for two issues', '["#5201", "#5202"]', 'w2-b5-card-0002');
  v_none := pg_temp.t3980w2_card('growth', 'W2 card without GitHub links', '[]', 'w2-b5-card-0003');
  v := pg_temp.t3980w2_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_none, pg_temp.t3980w2_rev(v_none)));
  perform pg_temp.t3980w2_like('B5', 'waiting for GitHub needs a GitHub link', v, 'ERR:22023:invalid_card: Link a GitHub issue or pull request first%');
  v := pg_temp.t3980w2_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2_rev(v_card)));
  perform pg_temp.t3980w2_check('B5', 'a person sets the card to wait for #5201',
    pg_temp.t3980w2_get(v, 'card', 'blocked_kind') || ' | ' || pg_temp.t3980w2_get(v, 'card', 'blocked_reason'), 'github | Waiting for #5201 to be Live.');
  perform pg_temp.t3980w2_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_two, pg_temp.t3980w2_rev(v_two)));
  v := pg_temp.t3980w2_agent('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":false}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2_rev(v_card)));
  perform pg_temp.t3980w2_like('B5', 'an agent cannot lift the wait', v, 'ERR:42501:gate_blocked: This card waits for #5201 to be Live on Mingla.%');
  v := pg_temp.t3980w2_agent('growth', format($q$select public.ops_work_update(%L, '{"blocked":false}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2_rev(v_card)));
  perform pg_temp.t3980w2_like('B5', 'nor unblock it by hand', v, 'ERR:42501:gate_blocked:%');

  -- Done on the board, but the record naming it is not complete: not Live, still waiting.
  perform pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(95001, '{"issues":[{"number":5201,"relation":"fixes"}],"live_check":null,"problems":["live_check_missing"]}'), 5201);
  perform pg_temp.t3980w2_apply(jsonb_build_array(pg_temp.t3980w2_gh(5201, 'issue', 'Done', null, 'CLOSED'), pg_temp.t3980w2_gh(5202, 'issue', 'In Progress')));
  perform pg_temp.t3980w2_check('B5', 'Done with an incomplete record is Shipped, and the card keeps waiting',
    (public.ops_github_status(5201)->>'label') || '/' || (select blocked_kind from public.ops_work_cards where id = v_card::uuid), 'Shipped/github');

  -- The record completes: #5201 is Live.
  perform pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(95001, '{"issues":[{"number":5201,"relation":"fixes"}]}'), 5201);
  v := pg_temp.t3980w2_apply(jsonb_build_array(pg_temp.t3980w2_gh(5201, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2_check('B5', 'the card unblocks by itself once #5201 is Live; its status stays To do',
    (select blocked::text || ':' || coalesce(blocked_kind, '-') || ':' || status from public.ops_work_cards where id = v_card::uuid)
      || '/' || (select body from public.ops_work_events where card_id = v_card::uuid and action = 'unblocked' order by at desc limit 1),
    'false:-:todo/Unblocked: #5201 is Live.');
  select count(*) into v_told from public.team_mentions m join auth.users u on u.id = m.target_user_id
   where m.source_kind = 'work_card' and m.body_excerpt = '#5201 is Live. "W2 wait for the payouts issue" can go ahead.';
  perform pg_temp.t3980w2_check('B5', 'its owner and watcher are told', v_told::text, '2');
  perform pg_temp.t3980w2_check('B5', 'a card that also waits for an issue not Live yet keeps waiting',
    (select blocked_kind from public.ops_work_cards where id = v_two::uuid), 'github');
  v := pg_temp.t3980w2_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":false}'::jsonb, %s)::text$q$, v_two, pg_temp.t3980w2_rev(v_two)));
  perform pg_temp.t3980w2_check('B5', 'a person can lift the wait', pg_temp.t3980w2_get(v, 'card', 'blocked'), 'false');
end;
$b5$;

-- ---------------------------------------------------------------------------
-- B6: roadmap suggestions from Status and Horizon. Nothing moves a lane.
-- ---------------------------------------------------------------------------
do $b6$
declare v text;
begin
  v := pg_temp.t3980w2_person('growth', $q$select public.ops_roadmap_link_set('39820000-0000-4000-c100-000000000001', '#5301')::text$q$);
  perform pg_temp.t3980w2_like('B6', 'only an owner or admin links roadmap cards', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980w2_person('owner', $q$select public.ops_roadmap_link_set('39820000-0000-4000-c100-000000000001', 'https://github.com/Mingla-LLC/mingla-main/pull/5301')::text$q$);
  perform pg_temp.t3980w2_like('B6', 'a pull request is refused', v, 'ERR:22023:not_an_issue: Link the issue, not a pull request.%');
  v := pg_temp.t3980w2_person('owner', $q$select public.ops_roadmap_link_set('39820000-0000-4000-c100-000000000001', '#5003')::text$q$);
  perform pg_temp.t3980w2_like('B6', 'an issue is linked to one card only', v, 'ERR:22023:issue_taken: #5003 is already linked%');
  perform pg_temp.t3980w2_person('owner', $q$select public.ops_roadmap_link_set('39820000-0000-4000-c100-000000000001', '#5301')::text$q$);
  perform pg_temp.t3980w2_person('admin', $q$select public.ops_roadmap_link_set('39820000-0000-4000-c100-000000000002', '5302')::text$q$);
  perform pg_temp.t3980w2_apply(jsonb_build_array(pg_temp.t3980w2_gh(5301, 'issue', 'In Progress', 'Later'), pg_temp.t3980w2_gh(5302, 'issue', 'Todo', 'Next')));
  v := pg_temp.t3980w2_person('owner', 'select public.ops_roadmap_links_list()::text');
  perform pg_temp.t3980w2_check('B6', 'In Progress suggests Now for a Later card; a Next card on Horizon Next has none',
    (select coalesce(c->'suggestion'->>'lane', '-') || ':' || coalesce(c->'suggestion'->>'reason', '-') from jsonb_array_elements(pg_temp.t3980w2_j(v) -> 'cards') c
      where c->>'card_id' = '39820000-0000-4000-c100-000000000001')
      || '/' || (select coalesce(c->'suggestion'->>'lane', '-') from jsonb_array_elements(pg_temp.t3980w2_j(v) -> 'cards') c
      where c->>'card_id' = '39820000-0000-4000-c100-000000000002'),
    'now:GitHub: In Progress/-');
  perform pg_temp.t3980w2_check('B6', 'the chip is on the roadmap card too',
    (select c->'issue'->>'label' from jsonb_array_elements(pg_temp.t3980w2_j(v) -> 'cards') c where c->>'card_id' = '39820000-0000-4000-c100-000000000001'),
    'In Progress');
  perform pg_temp.t3980w2_apply(jsonb_build_array(pg_temp.t3980w2_gh(5302, 'issue', 'Todo', 'Later')));
  perform pg_temp.t3980w2_check('B6', 'Horizon Later suggests Later',
    (select suggested_lane || ':' || suggested_reason from public.ops_roadmap_links where card_id = '39820000-0000-4000-c100-000000000002'), 'later:GitHub: Horizon Later');
  perform pg_temp.t3980w2_check('B6', 'nothing moved a lane',
    (select string_agg(lane, ',' order by sort_order) from public.community_roadmap_cards where id::text like '39820000-0000-4000-c100-%'), 'later,next,now');
  v := pg_temp.t3980w2_person('admin', $q$select public.ops_roadmap_suggestion_decide('39820000-0000-4000-c100-000000000001', 'apply')::text$q$);
  perform pg_temp.t3980w2_check('B6', 'apply returns the lane and still moves nothing',
    pg_temp.t3980w2_get(v, 'lane') || '/' || (select lane from public.community_roadmap_cards where id = '39820000-0000-4000-c100-000000000001'), 'now/later');
  v := pg_temp.t3980w2_person('admin', $q$select public.ops_roadmap_suggestion_decide('39820000-0000-4000-c100-000000000002', 'dismiss')::text$q$);
  perform public.ops_roadmap_suggest(null);
  perform pg_temp.t3980w2_check('B6', 'a dismissed suggestion stays hidden on the next run',
    (select coalesce(suggested_lane, '-') || ':' || dismissed_lane from public.ops_roadmap_links where card_id = '39820000-0000-4000-c100-000000000002'), '-:later');
  v := pg_temp.t3980w2_person('admin', $q$select public.ops_roadmap_suggestion_decide('39820000-0000-4000-c100-000000000002', 'apply')::text$q$);
  perform pg_temp.t3980w2_like('B6', 'there is nothing left to apply', v, 'ERR:22023:no_suggestion:%');
  v := pg_temp.t3980w2_person('growth', 'select public.ops_roadmap_links_list()::text');
  perform pg_temp.t3980w2_like('B6', 'the roadmap list is for an owner or admin', v, 'ERR:42501:forbidden:%');
end;
$b6$;

-- ---------------------------------------------------------------------------
-- B4: a Live issue drafts one "Recently shipped" card; nothing publishes.
-- ---------------------------------------------------------------------------
do $b4$
declare v text; v_draft uuid; v_card uuid; v_published int;
begin
  select count(*) into v_published from public.community_roadmap_cards where status = 'published';
  perform pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(96001, '{"issues":[{"number":5301,"relation":"fixes"}]}'), 5301);
  perform pg_temp.t3980w2_apply(jsonb_build_array(pg_temp.t3980w2_gh(5301, 'issue', 'Done', 'Later', 'CLOSED')));
  select a.entity_id into v_draft from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = '5301';
  perform pg_temp.t3980w2_check('B4', 'going Live drafts a Recently shipped card, as a draft, from the linked card',
    (select status || ':' || lane || ':' || public_title || ':' || coalesce(public_body, '-') || ':' || (shipped_at is null)::text
       from public.community_roadmap_cards where id = v_draft),
    'draft:shipped:W2 Better host payouts:Now live: Payouts land the next day.:true');
  perform pg_temp.t3980w2_check('B4', 'nothing was published', (select count(*)::text from public.community_roadmap_cards where status = 'published'), v_published::text);
  perform pg_temp.t3980w2_check('B4', 'a host cannot see the draft',
    pg_temp.t3980w2_person('host', format('select count(*)::text from public.community_roadmap_cards where id = %L', v_draft)), '0');
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-5301';
  perform pg_temp.t3980w2_check('B4', 'and a person card asks the owner to approve it',
    (select title || ' | ' || status || ':' || person_reason from public.ops_work_cards where id = v_card)
      || ' | ' || (select string_agg(email || ':' || role, ',') from public.ops_work_people where card_id = v_card)
      || ' | ' || (select string_agg(kind || ':' || label, ',') from public.ops_work_links where card_id = v_card),
    'Approve "Recently shipped": W2 Better host payouts | person:publish | ed.w23980@test.local:owner | roadmap_card:W2 Better host payouts');
  v := pg_temp.t3980w2_as('service', 'select public.ops_reconcile()::text');
  perform pg_temp.t3980w2_check('B4', 'never twice, across runs',
    (select count(*)::text from public.community_audit_log where action = 'draft_roadmap_card' and metadata->>'issue' = '5301')
      || '/' || (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-5301'), '1/1');
  v := pg_temp.t3980w2_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'W2 Better host payouts', 'Now live: payouts land the next day.', null, 'shipped', 'published')::text$q$, v_draft));
  perform pg_temp.t3980w2_as('service', 'select public.ops_reconcile()::text');
  perform pg_temp.t3980w2_check('B4', 'after a person publishes it, the approval card closes itself',
    (select status || ':' || close_kind from public.ops_work_cards where id = v_card), 'done:system');
end;
$b4$;

-- ---------------------------------------------------------------------------
-- B2: complete records turn entries Live only with every required proof.
-- ---------------------------------------------------------------------------
do $b2$
declare v text; v_rev_route int; v_ev_before int; v_told int;
begin
  select revision into v_rev_route from public.product_capabilities where capability_key = 'w2-guide-route';
  select count(*) into v_ev_before from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
   where c.capability_key like 'w2-guide-%';
  -- An incomplete record (no live check yet) changes nothing.
  perform pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(97002, '{"issues":[{"number":5401,"relation":"toward"}],"feature_guide":["w2-guide-waiting"],"live_check":null,"problems":["live_check_missing"]}'), 5401);
  perform pg_temp.t3980w2_as('service', 'select public.ops_reconcile()::text');
  perform pg_temp.t3980w2_check('B2', 'an incomplete record changes nothing',
    (select claimed_status || ':' || revision from public.product_capabilities where capability_key = 'w2-guide-waiting')
      || '/' || (select count(*)::text from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
                  where c.capability_key = 'w2-guide-waiting')
      || '/' || (select (guide_applied_at is null)::text from public.ops_release_records where pr = 97002),
    'planned:1/0/true');

  -- A complete record names two entries; one requires a route it cannot prove.
  v := pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(97001, '{"issues":[{"number":5401,"relation":"fixes"}],"feature_guide":["w2-guide-proven","w2-guide-route"]}'), 5401);
  perform pg_temp.t3980w2_check('B2', 'the record completes', pg_temp.t3980w2_get(v, 'completed'), '[97001]');
  perform pg_temp.t3980w2_check('B2', 'the proven entry is Live, effectively Live, at the next revision, due in 90 days',
    (select claimed_status || ':' || public.issue_3720_feature_guide_effective_status(id) || ':' || revision || ':'
            || (verification_due_at between now() + interval '89 days' and now() + interval '91 days')::text
       from public.product_capabilities where capability_key = 'w2-guide-proven'),
    'live:Live:2:true');
  perform pg_temp.t3980w2_check('B2', 'with the evidence the record proves (D-16), and nothing else',
    (select string_agg(e.evidence_kind || '=' || e.evidence_url, ' ' order by e.evidence_kind)
       from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key = 'w2-guide-proven' and e.is_current and e.verdict = 'verified' and e.recorded_by is null),
    'deployment=https://github.com/Mingla-LLC/mingla-main/commit/' || repeat(to_hex(97001 % 16), 40)
      || ' live_check=https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-97001'
      || ' pull_request=https://github.com/Mingla-LLC/mingla-main/pull/97001'
      || ' release_record=https://github.com/Mingla-LLC/mingla-main/issues/5401#issuecomment-997001'
      || ' source=https://github.com/Mingla-LLC/mingla-main/commit/' || repeat(to_hex(97001 % 16), 40)
      || ' test=https://github.com/Mingla-LLC/mingla-main/blob/' || repeat(to_hex(97001 % 16), 40) || '/supabase/migrations/__tests__/w2_fixture.pg17.test.sql');
  perform pg_temp.t3980w2_check('B2', 'the live check expires 90 days after it was done',
    (select (e.expires_at - e.observed_at)::text from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key = 'w2-guide-proven' and e.evidence_kind = 'live_check' and e.is_current), '90 days');
  perform pg_temp.t3980w2_check('B2', 'audited as Bridge B: six evidence rows and one save',
    (select count(*) filter (where a.action = 'evidence_recorded')::text || '/' || count(*) filter (where a.action = 'capability_saved')::text
       from public.product_truth_audit a join public.product_capabilities c on c.id = a.capability_id
      where c.capability_key = 'w2-guide-proven' and a.metadata->>'source' = 'issue_3980_bridge_b' and a.metadata->>'pr' = '97001'), '6/1');
  perform pg_temp.t3980w2_check('B2', 'the entry missing a required route is not changed at all',
    (select claimed_status || ':' || (revision = v_rev_route)::text from public.product_capabilities where capability_key = 'w2-guide-route')
      || '/' || (select count(*)::text from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
                  where c.capability_key = 'w2-guide-route'),
    'planned:true/0');
  perform pg_temp.t3980w2_check('B2', 'and the record says what is missing',
    (select string_agg(k->>'key' || ':' || (k->>'result') || coalesce(':' || (k->'missing'->>0), ''), ',' order by k->>'key')
       from public.ops_release_records r, jsonb_array_elements(r.guide_result->'keys') k where r.pr = 97001),
    'w2-guide-proven:live,w2-guide-route:incomplete:no route evidence');
  perform pg_temp.t3980w2_check('B2', 'the log says both, in words',
    (select string_agg(summary, ' | ' order by id) from public.ops_agent_log where action in ('guide_live', 'guide_incomplete') and detail->>'pr' = '97001'),
    'W2 proven entry is Live in the Feature Guide (PR #97001). | W2 entry needing a route stays Planned: no route evidence (PR #97001).');
  select count(*) into v_told from public.team_mentions m join auth.users u on u.id = m.target_user_id
   where m.source_kind = 'work_card' and m.body_excerpt like 'Mingla added: Feature Guide: W2 proven entry is Live%';
  perform pg_temp.t3980w2_check('B2', 'Support teammates watch the closed card, and they and the owner are told',
    (select string_agg(p.email, ',' order by p.email) from public.ops_work_people p join public.ops_work_cards w on w.id = p.card_id
      where w.auto_key = 'guide_live:w2-guide-proven:pr-97001' and p.role = 'watcher')
      || '/' || (select status || ':' || close_kind from public.ops_work_cards where auto_key = 'guide_live:w2-guide-proven:pr-97001')
      || '/' || v_told::text,
    'di.w23980@test.local,sue.w23980@test.local/done:system/3');
  perform pg_temp.t3980w2_as('service', 'select public.ops_reconcile()::text');
  perform pg_temp.t3980w2_check('B2', 'a record is applied once',
    (select count(*)::text from public.product_truth_audit a join public.product_capabilities c on c.id = a.capability_id
      where c.capability_key = 'w2-guide-proven' and a.action = 'capability_saved' and a.metadata->>'source' = 'issue_3980_bridge_b'), '1');
  v := pg_temp.t3980w2_person('support', $q$select public.ops_feature_guide_release('w2-guide-proven')::text$q$);
  perform pg_temp.t3980w2_check('B2', 'Support reads which PR shipped it and the result',
    pg_temp.t3980w2_get(v, 'record', 'pr') || ':' || pg_temp.t3980w2_get(v, 'result', 'result'), '97001:live');
  v := pg_temp.t3980w2_person('support', $q$select public.ops_feature_guide_release('w2-guide-waiting')::text$q$);
  perform pg_temp.t3980w2_check('B2', 'an entry on an incomplete record shows what it waits for',
    coalesce(pg_temp.t3980w2_get(v, 'record'), 'null') || ':' || pg_temp.t3980w2_get(v, 'pending', 'missing', '0'), 'null:the live check');
  v := pg_temp.t3980w2_person('partner', $q$select public.ops_feature_guide_release('w2-guide-proven')::text$q$);
  perform pg_temp.t3980w2_like('B2', 'a teammate without Support cannot', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980w2_person('growth', $q$select public.ops_release_records_list('{"incomplete":true,"limit":5}'::jsonb)::text$q$);
  perform pg_temp.t3980w2_check('B2', 'the release list shows incomplete records with their problems in words',
    (select string_agg((r->>'pr') || ':' || (r->'problems'->0->>'words'), ',' order by (r->>'pr')::int)
       from jsonb_array_elements(pg_temp.t3980w2_j(v) -> 'records') r where (r->>'pr')::int in (94001, 97002)),
    '94001:the live check,97002:the live check');
end;
$b2$;

-- ---------------------------------------------------------------------------
-- B3: a ticket shows its engineering status.
-- ---------------------------------------------------------------------------
do $b3$
declare v text;
begin
  v := pg_temp.t3980w2_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39820000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.t3980w2_check('B3', 'before the bridge reads it, the ticket shows the Product Inbox board status',
    pg_temp.t3980w2_get(v, 'linked') || ':' || pg_temp.t3980w2_get(v, 'issue', 'number') || ':' || pg_temp.t3980w2_get(v, 'label'), 'true:5005:In Progress');
  perform pg_temp.t3980w2_ingest(pg_temp.t3980w2_record(98001, '{"issues":[{"number":5005,"relation":"fixes"}]}'), 5005);
  perform pg_temp.t3980w2_apply(jsonb_build_array(pg_temp.t3980w2_gh(5005, 'issue', 'Done', null, 'CLOSED')));
  v := pg_temp.t3980w2_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39820000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.t3980w2_check('B3', 'once it is Done with a complete record the ticket says Live',
    pg_temp.t3980w2_get(v, 'label') || ':' || pg_temp.t3980w2_get(v, 'live') || ':' || pg_temp.t3980w2_get(v, 'record', 'pr'), 'Live:true:98001');
  v := pg_temp.t3980w2_person('admin', $q$select public.ops_ticket_engineering('internal_thread', '39820000-0000-4000-c400-000000000009')::text$q$);
  perform pg_temp.t3980w2_check('B3', 'an unlinked thread says so', v, '{"linked": false}');
  v := pg_temp.t3980w2_person('growth', $q$select public.ops_ticket_engineering('support_ticket', '39820000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.t3980w2_like('B3', 'a growth teammate without Support is refused', v, 'ERR:42501:forbidden:%');
end;
$b3$;

select count(*) as t3980w2_total, count(*) filter (where not ok) as t3980w2_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2_failures
  from t3980w2_results \gset
rollback;

select (:t3980w2_total < 60 or :t3980w2_failed > 0) as t3980w2_bad \gset
\if :t3980w2_bad
  \echo 'ISSUE-3980 SYNCED WAVE 2 FAILED:' :t3980w2_failed 'of' :t3980w2_total
  \echo :t3980w2_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 2 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 2 PASS:' :t3980w2_total 'checks, 0 failed'
