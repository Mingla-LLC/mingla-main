-- Issue #3980 synced program, Wave 2 rework 3 -- TESTER adversarial suite on
-- the fully replayed PG17 schema. The implementor's suite calls the work
-- functions directly with an agent context; this one goes through the real
-- connector gateway (ops_agent_call with a hashed agent key, as team-agent
-- calls it), which is the only way an agent reaches these cards:
--   K   a person connects an agent key
--   M1  while the roadmap approval card waits for a person: MCP update_work
--       (status, person_reason), close_work and push_back answer people_only;
--       start_work is refused; the card still waits for a person
--   M2  after a PERSON sends it back to To do: MCP close_work and push_back
--       (already_done with proof) still answer people_only
--   M5  the agent's own plain card: MCP add_work, start_work, close_work work
--   M6  a person still closes the approval card
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

create temp table t3980r3t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980r3t_people (who, id, email) values
  ('owner',    '39881000-0000-4000-a000-000000000001', 'oz.r3t3980@test.local'),
  ('admin',    '39881000-0000-4000-a000-000000000002', 'ivy.r3t3980@test.local'),
  ('growth',   '39881000-0000-4000-a000-000000000003', 'kim.r3t3980@test.local'),
  ('support',  '39881000-0000-4000-a000-000000000004', 'sue.r3t3980@test.local'),
  ('offsupp',  '39881000-0000-4000-a000-000000000005', 'oli.r3t3980@test.local'),
  ('host',     '39881000-0000-4000-a000-000000000006', 'hal.r3t3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980r3t_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.r3t3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.r3t3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.r3t3980@test.local', 'growth', 'active', now()),
  ('sue.r3t3980@test.local', 'growth', 'active', now()),
  ('oli.r3t3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39881000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39881000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980r3t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980r3t_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980r3t_people where who = p_who;
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

create function pg_temp.t3980r3t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980r3t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980r3t_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980r3t_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980r3t_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980r3t_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980r3t_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980r3t_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980r3t_next_request();
  return pg_temp.t3980r3t_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980r3t_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980r3t_next_request();
  select id, email into strict v_id, v_email from t3980r3t_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980r3t_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980r3t_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
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

create function pg_temp.t3980r3t_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980r3t_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980r3t_reconcile() returns text
language sql as $fn$ select pg_temp.t3980r3t_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980r3t_record(p_pr int, p_extra jsonb default '{}') returns jsonb
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

create function pg_temp.t3980r3t_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980r3t_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980r3t_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980r3t_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.r3t3980@test.local'),
      'watchers', jsonb_build_array('ivy.r3t3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980r3t_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980r3t_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980r3t_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- A roadmap card linked to an issue that goes Live, so Bridge D drafts a
-- "Recently shipped" card and its approval card. Returns the approval card id.
create function pg_temp.t3980r3t_bridge_d(p_n int, p_card uuid, p_title text) returns uuid
language plpgsql as $fn$
declare v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (p_card, p_title, 'Hosts can do the new thing. More words.', 'later', 'published', 900 + p_n % 50);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values (p_card, p_n, 'ivy.r3t3980@test.local');
  insert into public.ops_github_items (number, kind) values (p_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980r3t_ingest(pg_temp.t3980r3t_record(90000 + p_n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', p_n, 'relation', 'fixes')))), p_n);
  perform pg_temp.t3980r3t_apply(jsonb_build_array(pg_temp.t3980r3t_gh(p_n, 'issue', 'Done', null, 'CLOSED')));
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-' || p_n;
  return v_card;
end;
$fn$;

create function pg_temp.t3980r3t_draft(p_n int) returns uuid
language sql as $fn$
  select a.entity_id from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = p_n::text
$fn$;


create temp table t3980r3t_keys (who text primary key, k text) on commit drop;

create function pg_temp.t3980r3t_newkey(p_who text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980r3t_person(p_who, $q$select public.team_agent_key_create('claude')::text$q$);
  insert into t3980r3t_keys (who, k) values (p_who, pg_temp.t3980r3t_j(v)->>'key')
  on conflict (who) do update set k = excluded.k;
  return v;
end;
$fn$;

-- One connector call through the work gateway, exactly as team-agent makes it.
create function pg_temp.t3980r3t_mcp(p_who text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980r3t_next_request();
  return pg_temp.t3980r3t_as('service', format('select public.ops_agent_call(%L, %L, %L::jsonb, %L)::text',
    (select encode(sha256(convert_to(k, 'UTF8')), 'hex') from t3980r3t_keys where who = p_who), p_tool, p_args, 'issue3980-r3-tester/1.0'));
end;
$fn$;

create function pg_temp.t3980r3t_state(p_card uuid) returns text
language sql as $fn$
  select status || ':' || coalesce(close_kind, '-') || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = p_card
$fn$;

do $r$
declare v text; v_key text; v_card uuid; v_plain uuid;
begin
  v_key := pg_temp.t3980r3t_newkey('owner');
  perform pg_temp.t3980r3t_like('K', 'the owner connects an agent key', v_key, '%"key"%');

  -- M1: every MCP writer on a card waiting for a person.
  v_card := pg_temp.t3980r3t_bridge_d(7941, '39881000-0000-4000-c100-000000000041', 'M1 hosts see the new report');
  perform pg_temp.t3980r3t_check('M1', 'the approval card waits for a person', pg_temp.t3980r3t_state(v_card), 'person:-:-');
  v := pg_temp.t3980r3t_mcp('owner', 'update_work', jsonb_build_object('id', v_card, 'expected_revision', pg_temp.t3980r3t_rev(v_card::text),
         'changes', jsonb_build_object('status', 'todo', 'reason', 'The wording needs another pass by me.')));
  perform pg_temp.t3980r3t_like('M1', 'MCP update_work status todo is people_only', v, '%"ok": false%"token": "people_only"%');
  v := pg_temp.t3980r3t_mcp('owner', 'update_work', jsonb_build_object('id', v_card, 'expected_revision', pg_temp.t3980r3t_rev(v_card::text),
         'changes', jsonb_build_object('person_reason', 'other')));
  perform pg_temp.t3980r3t_like('M1', 'MCP update_work person_reason is people_only', v, '%"ok": false%"token": "people_only"%');
  v := pg_temp.t3980r3t_mcp('owner', 'close_work', jsonb_build_object('id', v_card, 'expected_revision', pg_temp.t3980r3t_rev(v_card::text),
         'proof', '[{"kind":"text","text":"Agent closes it"}]'::jsonb));
  perform pg_temp.t3980r3t_like('M1', 'MCP close_work is people_only', v, '%"ok": false%"token": "people_only"%');
  v := pg_temp.t3980r3t_mcp('owner', 'push_back', jsonb_build_object('id', v_card, 'expected_revision', pg_temp.t3980r3t_rev(v_card::text),
         'kind', 'declined', 'reason', 'Agent says hosts do not need this one.'));
  perform pg_temp.t3980r3t_like('M1', 'MCP push_back is people_only', v, '%"ok": false%"token": "people_only"%');
  v := pg_temp.t3980r3t_mcp('owner', 'start_work', jsonb_build_object('id', v_card, 'expected_revision', pg_temp.t3980r3t_rev(v_card::text)));
  perform pg_temp.t3980r3t_like('M1', 'MCP start_work on a card waiting for a person is refused', v, '%"ok": false%');
  perform pg_temp.t3980r3t_check('M1', 'after every MCP attempt it still waits for a person', pg_temp.t3980r3t_state(v_card), 'person:-:-');

  -- M2: a person sends it back; the agent may not move it to Doing either.
  v := pg_temp.t3980r3t_person('owner', format($q$select public.ops_work_person_action(%L, 'send_back', 'Change the wording first, please.', %s)::text$q$, v_card, pg_temp.t3980r3t_rev(v_card::text)));
  perform pg_temp.t3980r3t_check('M2', 'a person sent it back to To do', pg_temp.t3980r3t_state(v_card), 'todo:-:-');
  v := pg_temp.t3980r3t_mcp('owner', 'close_work', jsonb_build_object('id', v_card, 'expected_revision', pg_temp.t3980r3t_rev(v_card::text),
         'proof', '[{"kind":"text","text":"Agent closes it"}]'::jsonb));
  perform pg_temp.t3980r3t_like('M2', 'MCP close_work on the sent-back card is people_only', v, '%"ok": false%"token": "people_only"%');
  v := pg_temp.t3980r3t_mcp('owner', 'push_back', jsonb_build_object('id', v_card, 'expected_revision', pg_temp.t3980r3t_rev(v_card::text),
         'kind', 'already_done', 'reason', 'The agent thinks this was already published.', 'proof', '[{"kind":"text","text":"It is on the roadmap"}]'::jsonb));
  perform pg_temp.t3980r3t_like('M2', 'MCP push_back already_done on the sent-back card is people_only', v, '%"ok": false%"token": "people_only"%');

  -- M5: the agent's own plain card is unaffected through MCP.
  v := pg_temp.t3980r3t_mcp('owner', 'add_work', jsonb_build_object('request_key', 'r3t-plain-mcp-1', 'cards', jsonb_build_array(jsonb_build_object(
         'title', 'M5 plain card the agent may finish', 'instructions', 'Do the plain thing.', 'done_means', 'It is done.',
         'owners', jsonb_build_array('oz.r3t3980@test.local'), 'due_on', ((now() AT TIME ZONE 'UTC')::date + 3)::text))));
    v_plain := coalesce(pg_temp.t3980r3t_j(v) #>> '{result,results,0,card,id}', pg_temp.t3980r3t_j(v) #>> '{results,0,card,id}')::uuid;
  v := pg_temp.t3980r3t_mcp('owner', 'start_work', jsonb_build_object('id', v_plain, 'expected_revision', pg_temp.t3980r3t_rev(v_plain::text)));
  perform pg_temp.t3980r3t_check('M5', 'the agent starts its plain card', (select status from public.ops_work_cards where id = v_plain), 'doing');
  v := pg_temp.t3980r3t_mcp('owner', 'close_work', jsonb_build_object('id', v_plain, 'expected_revision', pg_temp.t3980r3t_rev(v_plain::text),
         'proof', '[{"kind":"text","text":"Done by the agent"}]'::jsonb));
  perform pg_temp.t3980r3t_check('M5', 'the agent closes its plain card through MCP', pg_temp.t3980r3t_state(v_plain), 'done:done:claude');

  -- M6: a person still closes the sent-back approval card .
  v := pg_temp.t3980r3t_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Read it, will publish"}]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980r3t_rev(v_card::text)));
  perform pg_temp.t3980r3t_check('M6', 'a person closes the approval card', pg_temp.t3980r3t_state(v_card), 'done:done:-');
end $r$;

select count(*) as t3980r3t_total, count(*) filter (where not ok) as t3980r3t_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980r3t_failures
  from t3980r3t_results \gset
rollback;
select (:t3980r3t_total < 14 or :t3980r3t_failed > 0) as t3980r3t_bad \gset
\if :t3980r3t_bad
  \echo 'ISSUE-3980 W2 REWORK 3 TESTER ROADMAP AGENT ROUTES FAILED:' :t3980r3t_failed 'of' :t3980r3t_total
  \echo :t3980r3t_failures
  do $$ begin raise exception 'ISSUE-3980 W2 REWORK 3 TESTER ROADMAP AGENT ROUTES FAIL'; end $$;
\endif
\echo 'ISSUE-3980 W2 REWORK 3 TESTER ROADMAP AGENT ROUTES PASS:' :t3980r3t_total 'checks, 0 failed'
