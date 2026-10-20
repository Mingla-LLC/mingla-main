-- Issue #3980 synced program, Wave 2 rework -- the implementor's regression
-- suite for the tester's CONDITIONAL verdict, on the fully replayed PG17
-- schema. Each check is recorded and reported together:
--   R1  an agent cannot add, remove or swap the GitHub links of a card that
--       waits for GitHub (gate_blocked words), so it cannot lift the wait by
--       pointing it at an issue that is already Live; a person can, and the
--       agent log names the person
--   R2  Bridge D takes a lock per issue before it looks for an earlier
--       draft, so two overlapping runs make one draft
--   R3  one GitHub issue belongs to one roadmap card (a unique index), and a
--       second card is told which card has it
--   R4  a GitHub item without "found" is malformed: skipped, and nothing
--       Mingla knew about the number is cleared
--   R5  a ticket whose issue GitHub no longer has says "Not on GitHub"
--   R6  of two release records that merged at the same moment, the higher
--       pull request number is the newest, everywhere
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

create temp table t3980w2r_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2r_people (who, id, email) values
  ('owner',    '39850000-0000-4000-a000-000000000001', 'oz.w2r3980@test.local'),
  ('admin',    '39850000-0000-4000-a000-000000000002', 'ivy.w2r3980@test.local'),
  ('growth',   '39850000-0000-4000-a000-000000000003', 'kim.w2r3980@test.local'),
  ('support',  '39850000-0000-4000-a000-000000000004', 'sue.w2r3980@test.local'),
  ('offsupp',  '39850000-0000-4000-a000-000000000005', 'oli.w2r3980@test.local'),
  ('host',     '39850000-0000-4000-a000-000000000006', 'hal.w2r3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2r_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2r3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2r3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2r3980@test.local', 'growth', 'active', now()),
  ('sue.w2r3980@test.local', 'growth', 'active', now()),
  ('oli.w2r3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39850000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39850000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2r_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2r_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2r_people where who = p_who;
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

create function pg_temp.t3980w2r_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2r_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2r_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2r_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2r_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2r_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r_next_request();
  return pg_temp.t3980w2r_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2r_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r_next_request();
  select id, email into strict v_id, v_email from t3980w2r_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
                                   p_state text default 'OPEN', p_merged boolean default false,
                                   p_updated timestamptz default '2026-10-20T09:00:00Z') returns jsonb
language sql as $fn$
  select jsonb_build_object('number', p_n, 'found', true, 'kind', p_kind, 'title', 'W2R item ' || p_n,
    'url', 'https://github.com/Mingla-LLC/mingla-main/' || case p_kind when 'pull' then 'pull/' else 'issues/' end || p_n,
    'state', p_state, 'merged', p_merged, 'merged_at', case when p_merged then '2026-10-20T09:00:00Z' end,
    'merge_sha', case when p_merged then repeat('b', 40) end, 'closing_issues', '[]'::jsonb,
    'board_status', p_board, 'board_horizon', p_horizon,
    'updated_at', to_char(p_updated AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
$fn$;

create function pg_temp.t3980w2r_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2r_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2r_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2r_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2r_record(p_pr int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'W2R record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', to_char((now() - interval '3 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', repeat(to_hex(p_pr % 16), 40), 'merged_by', 'oz-gh', 'author', 'oz-gh',
    'issues', '[]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '["mingla-admin"]'::jsonb, 'deploy_marker', true,
    'deploy', '{"web":{"mingla-admin":"ready"},"edge":"none"}'::jsonb, 'feature_guide', '[]'::jsonb,
    'live_check', jsonb_build_object('text', 'Checked it in production', 'by_login', 'oz-gh',
      'url', 'https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-' || p_pr,
      'at', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'test_files', '["supabase/migrations/__tests__/w2r_fixture.pg17.test.sql"]'::jsonb, 'problems', '[]'::jsonb) || p_extra
$fn$;

create function pg_temp.t3980w2r_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2r_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2r_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2r3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2r3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2r_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2r_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2r_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;



-- ---------------------------------------------------------------------------
-- R1: what a waiting card waits for is the person's to change.
-- ---------------------------------------------------------------------------
do $r1$
declare v text; v_card text;
begin
  insert into public.ops_github_items (number, kind) values (7111, 'issue'), (7112, 'issue'), (7113, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r_ingest(pg_temp.t3980w2r_record(97112, '{"issues":[{"number":7112,"relation":"fixes"}]}'), 7112);
  perform pg_temp.t3980w2r_apply(jsonb_build_array(pg_temp.t3980w2r_gh(7111, 'issue', 'In Progress'), pg_temp.t3980w2r_gh(7112, 'issue', 'Done', null, 'CLOSED'),
    pg_temp.t3980w2r_gh(7113, 'issue', 'Todo')));
  perform pg_temp.t3980w2r_check('R1', 'the Live issue used to swap to is Live', pg_temp.t3980w2r_label(7112), 'Live');
  v_card := pg_temp.t3980w2r_card('growth', 'R1 wait for the real fix', '["#7111"]', 'w2r-r1-card-0001');
  v := pg_temp.t3980w2r_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r_rev(v_card)));
  perform pg_temp.t3980w2r_check('R1', 'a person sets the card to wait for #7111', pg_temp.t3980w2r_get(v, 'card', 'blocked_reason'), 'Waiting for #7111 to be Live.');

  v := pg_temp.t3980w2r_agent('growth', format($q$select public.ops_work_update(%L, '{"github":["#7112"]}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r_rev(v_card)));
  perform pg_temp.t3980w2r_check('R1', 'an agent swapping the link to a Live issue is refused with the gate words', v,
    'ERR:42501:gate_blocked: This card waits for #7111 to be Live on Mingla.');
  v := pg_temp.t3980w2r_agent('growth', format($q$select public.ops_work_update(%L, '{"github":["#7111","#7112"]}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r_rev(v_card)));
  perform pg_temp.t3980w2r_like('R1', 'an agent adding a link is refused', v, 'ERR:42501:gate_blocked: This card waits for #7111 to be Live on Mingla.');
  v := pg_temp.t3980w2r_agent('growth', format($q$select public.ops_work_update(%L, '{"github":[]}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r_rev(v_card)));
  perform pg_temp.t3980w2r_like('R1', 'an agent removing the link is refused', v, 'ERR:42501:gate_blocked:%');
  v := pg_temp.t3980w2r_agent('growth', format($q$select public.ops_work_update(%L, '{"github":["#7111"],"instructions":"Follow the engineering work until it ships to hosts."}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r_rev(v_card)));
  perform pg_temp.t3980w2r_check('R1', 'an agent sending the same links with another change is not refused', pg_temp.t3980w2r_get(v, 'changed'), 'true');
  perform pg_temp.t3980w2r_reconcile();
  perform pg_temp.t3980w2r_check('R1', 'after the next run the card still waits (#7111 is In Progress)',
    (select blocked::text || ':' || blocked_kind from public.ops_work_cards where id = v_card::uuid), 'true:github');
  perform pg_temp.t3980w2r_check('R1', 'the card still waits for #7111 only',
    (select string_agg(number::text, ',' order by number) from public.ops_work_github where card_id = v_card::uuid), '7111');

  v := pg_temp.t3980w2r_person('growth', format($q$select public.ops_work_update(%L, '{"github":["#7111","#7113"]}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r_rev(v_card)));
  perform pg_temp.t3980w2r_check('R1', 'a person can change what the card waits for', pg_temp.t3980w2r_get(v, 'card', 'blocked_reason'), 'Waiting for #7111, #7113 to be Live.');
  perform pg_temp.t3980w2r_check('R1', 'the agent log names the person who changed it',
    (select actor_email || '|' || coalesce(via, 'person') || '|' || (summary like '%changed what Card % waits for: #7111, #7113 (was #7111).')::text
       from public.ops_agent_log where card_id = v_card::uuid and detail->>'waiting' = 'true' order by id desc limit 1),
    'kim.w2r3980@test.local|person|true');
end $r1$;

-- ---------------------------------------------------------------------------
-- R2: Bridge D queues on a lock per issue.
-- ---------------------------------------------------------------------------
do $r2$
declare v_n int := 7211; v_locks int; v jsonb;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values ('39850000-0000-4000-c100-000000000021', 'R2 roadmap card', 'Hosts can do the new thing. More.', 'later', 'published', 990);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values ('39850000-0000-4000-c100-000000000021', v_n, 'ivy.w2r3980@test.local');
  insert into public.ops_github_items (number, kind) values (v_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r_ingest(pg_temp.t3980w2r_record(97211, '{"issues":[{"number":7211,"relation":"fixes"}]}'), v_n);
  perform pg_temp.t3980w2r_apply(jsonb_build_array(pg_temp.t3980w2r_gh(v_n, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2r_check('R2', 'one draft for the Live issue',
    (select count(*)::text from public.community_audit_log where action = 'draft_roadmap_card' and metadata->>'issue' = v_n::text), '1');
  select count(*) into v_locks from pg_catalog.pg_locks l
   where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 2
     and l.classid::bigint = ((pg_catalog.hashtext('ops_roadmap_shipped')::bigint + 4294967296) % 4294967296) and l.objid::bigint = v_n;
  perform pg_temp.t3980w2r_check('R2', 'drafting held the per-issue lock until the end of the transaction', v_locks::text, '1');
  set local role service_role;
  v := public.ops_github_bridges();
  reset role;
  perform pg_temp.t3980w2r_check('R2', 'a second run drafts nothing more', (v->>'drafted') || ':' ||
    (select count(*)::text from public.community_roadmap_cards where public_title = 'R2 roadmap card' and status = 'draft'), '0:1');
end $r2$;

-- ---------------------------------------------------------------------------
-- R3: one issue, one roadmap card.
-- ---------------------------------------------------------------------------
do $r3$
declare v text; v_err text;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
    ('39850000-0000-4000-c100-000000000031', 'R3 card A', 'A. More.', 'later', 'published', 991),
    ('39850000-0000-4000-c100-000000000032', 'R3 card B', 'B. More.', 'later', 'published', 992);
  perform pg_temp.t3980w2r_check('R3', 'ops_roadmap_links.issue_number is unique',
    (select bool_or(i.indisunique)::text from pg_index i where i.indrelid = 'public.ops_roadmap_links'::regclass
        and pg_get_indexdef(i.indexrelid) like '%(issue_number)'), 'true');
  v := pg_temp.t3980w2r_person('admin', $q$select public.ops_roadmap_link_set('39850000-0000-4000-c100-000000000031', '#7301')::text$q$);
  perform pg_temp.t3980w2r_check('R3', 'card A takes #7301', pg_temp.t3980w2r_get(v, 'issue_number'), '7301');
  v := pg_temp.t3980w2r_person('admin', $q$select public.ops_roadmap_link_set('39850000-0000-4000-c100-000000000032', '#7301')::text$q$);
  perform pg_temp.t3980w2r_check('R3', 'card B is told card A has it', v, 'ERR:22023:issue_taken: #7301 is already linked to "R3 card A".');
  begin
    insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values ('39850000-0000-4000-c100-000000000032', 7301, 'ivy.w2r3980@test.local');
    v_err := 'inserted';
  exception when unique_violation then v_err := 'unique_violation';
  end;
  perform pg_temp.t3980w2r_check('R3', 'a second card can never hold the issue, even past the check', v_err, 'unique_violation');
  perform pg_temp.t3980w2r_check('R3', 'one card holds #7301', (select count(*)::text from public.ops_roadmap_links where issue_number = 7301), '1');
end $r3$;

-- ---------------------------------------------------------------------------
-- R4: an item without "found" changes nothing.
-- ---------------------------------------------------------------------------
do $r4$
declare v text;
begin
  insert into public.ops_github_items (number, kind) values (7401, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r_ingest(pg_temp.t3980w2r_record(97401, '{"issues":[{"number":7401,"relation":"fixes"}]}'), 7401);
  perform pg_temp.t3980w2r_apply(jsonb_build_array(pg_temp.t3980w2r_gh(7401, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2r_check('R4', 'before: Live', pg_temp.t3980w2r_label(7401), 'Live');
  v := pg_temp.t3980w2r_apply(jsonb_build_array(jsonb_build_object('number', 7401, 'kind', 'issue', 'state', 'OPEN')));
  perform pg_temp.t3980w2r_check('R4', 'an item without "found" is skipped', pg_temp.t3980w2r_get(v, 'applied') || ':' || pg_temp.t3980w2r_get(v, 'skipped'), '0:1');
  v := pg_temp.t3980w2r_apply(jsonb_build_array(jsonb_build_object('number', 7401, 'found', null, 'kind', 'issue')));
  perform pg_temp.t3980w2r_check('R4', 'a null "found" is skipped too', pg_temp.t3980w2r_get(v, 'skipped'), '1');
  v := pg_temp.t3980w2r_apply(jsonb_build_array(jsonb_build_object('found', true, 'kind', 'issue')));
  perform pg_temp.t3980w2r_check('R4', 'an item without a number is skipped', pg_temp.t3980w2r_get(v, 'skipped'), '1');
  perform pg_temp.t3980w2r_check('R4', 'nothing Mingla knew was cleared',
    (select pg_temp.t3980w2r_label(7401) || '|' || coalesce(board_status, 'NULL') || '|' || coalesce(title, 'NULL') || '|' || coalesce(state, 'NULL')
       from public.ops_github_items where number = 7401), 'Live|Done|W2R item 7401|CLOSED');
end $r4$;

-- ---------------------------------------------------------------------------
-- R5: a ticket whose issue GitHub no longer has.
-- ---------------------------------------------------------------------------
do $r5$
declare v text;
begin
  insert into public.support_product_signals (id, client_request_id, signal_kind, state, title, problem_statement, product_area, user_journey,
    impact_summary, next_update_at, next_step, customer_reply_draft, created_by)
  values ('39850000-0000-4000-c200-000000000051', gen_random_uuid(), 'bug', 'linked', 'R5 signal', 'Something is wrong.', 'Payouts', 'Host waits',
    'Hosts are upset', now() + interval '1 day', 'Fix it', 'We are on it.', '39850000-0000-4000-a000-000000000004');
  insert into public.product_avengers_items (id, issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status) values
    ('39850000-0000-4000-c300-000000000051', 7501, 'I_r5', 'PVTI_r5', 'https://github.com/Mingla-LLC/mingla-main/issues/7501', 'R5 issue', 'OPEN', 'In Progress');
  insert into public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by) values
    ('39850000-0000-4000-c200-000000000051', '39850000-0000-4000-c300-000000000051', 'existing', '39850000-0000-4000-a000-000000000004');
  insert into public.support_product_signal_sources (signal_id, source_kind, source_id, linked_by) values
    ('39850000-0000-4000-c200-000000000051', 'support_ticket', '39850000-0000-4000-c400-000000000051', '39850000-0000-4000-a000-000000000004');
  v := pg_temp.t3980w2r_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39850000-0000-4000-c400-000000000051')::text$q$);
  perform pg_temp.t3980w2r_check('R5', 'before the bridge reads it, the Product Inbox word stands in', pg_temp.t3980w2r_get(v, 'label'), 'In Progress');
  insert into public.ops_github_items (number, kind) values (7501, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r_apply(jsonb_build_array(jsonb_build_object('number', 7501, 'found', false)));
  v := pg_temp.t3980w2r_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39850000-0000-4000-c400-000000000051')::text$q$);
  perform pg_temp.t3980w2r_check('R5', 'once GitHub says it has no such issue, the ticket says Not on GitHub like every other surface',
    pg_temp.t3980w2r_get(v, 'label') || '|' || coalesce(pg_temp.t3980w2r_get(v, 'board_status'), 'NULL') || '|' || pg_temp.t3980w2r_label(7501),
    'Not on GitHub|NULL|Not on GitHub');
end $r5$;

-- ---------------------------------------------------------------------------
-- R6: ties on the newest record break on the pull request number.
-- ---------------------------------------------------------------------------
do $r6$
declare v text; v_at text := to_char((now() - interval '2 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  insert into public.ops_github_items (number, kind) values (7601, 'issue') on conflict do nothing;
  -- The lower pull request is complete and read first; the higher one, merged
  -- at the same second, still misses its live check.
  perform pg_temp.t3980w2r_ingest(pg_temp.t3980w2r_record(97600, jsonb_build_object('issues', '[{"number":7601,"relation":"toward"}]'::jsonb, 'merged_at', v_at)), 7601);
  perform pg_temp.t3980w2r_ingest(pg_temp.t3980w2r_record(97601, jsonb_build_object('issues', '[{"number":7601,"relation":"toward"}]'::jsonb, 'merged_at', v_at,
    'live_check', null, 'problems', '["live_check_missing"]'::jsonb)), 7601);
  perform pg_temp.t3980w2r_check('R6', 'the two records merged at the same moment, one complete',
    (select string_agg(pr || ':' || complete, ',' order by pr) from public.ops_release_records where pr in (97600, 97601))
      || '|' || (select count(distinct merged_at)::text from public.ops_release_records where pr in (97600, 97601)), '97600:true,97601:false|1');
  perform pg_temp.t3980w2r_apply(jsonb_build_array(pg_temp.t3980w2r_gh(7601, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2r_check('R6', 'the chip reads the higher pull request: Shipped, not Live', pg_temp.t3980w2r_label(7601), 'Shipped');
  insert into public.support_product_signals (id, client_request_id, signal_kind, state, title, problem_statement, product_area, user_journey,
    impact_summary, next_update_at, next_step, customer_reply_draft, created_by)
  values ('39850000-0000-4000-c200-000000000061', gen_random_uuid(), 'bug', 'linked', 'R6 signal', 'Something is wrong.', 'Payouts', 'Host waits',
    'Hosts are upset', now() + interval '1 day', 'Fix it', 'We are on it.', '39850000-0000-4000-a000-000000000004');
  insert into public.product_avengers_items (id, issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status) values
    ('39850000-0000-4000-c300-000000000061', 7601, 'I_r6', 'PVTI_r6', 'https://github.com/Mingla-LLC/mingla-main/issues/7601', 'R6 issue', 'CLOSED', 'Done');
  insert into public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by) values
    ('39850000-0000-4000-c200-000000000061', '39850000-0000-4000-c300-000000000061', 'existing', '39850000-0000-4000-a000-000000000004');
  insert into public.support_product_signal_sources (signal_id, source_kind, source_id, linked_by) values
    ('39850000-0000-4000-c200-000000000061', 'support_ticket', '39850000-0000-4000-c400-000000000061', '39850000-0000-4000-a000-000000000004');
  v := pg_temp.t3980w2r_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39850000-0000-4000-c400-000000000061')::text$q$);
  perform pg_temp.t3980w2r_check('R6', 'the ticket names the higher pull request as its record',
    pg_temp.t3980w2r_get(v, 'record', 'pr') || ':' || pg_temp.t3980w2r_get(v, 'record', 'complete'), '97601:false');
end $r6$;

select count(*) as t3980w2r_total, count(*) filter (where not ok) as t3980w2r_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2r_failures
  from t3980w2r_results \gset
rollback;

select (:t3980w2r_total < 28 or :t3980w2r_failed > 0) as t3980w2r_bad \gset
\if :t3980w2r_bad
  \echo 'ISSUE-3980 SYNCED WAVE 2 REWORK FAILED:' :t3980w2r_failed 'of' :t3980w2r_total
  \echo :t3980w2r_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 2 REWORK FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 2 REWORK PASS:' :t3980w2r_total 'checks, 0 failed'
