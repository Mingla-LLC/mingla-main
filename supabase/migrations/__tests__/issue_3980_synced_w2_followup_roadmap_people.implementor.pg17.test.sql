-- Issue #3980 synced program, Wave 2 follow-up -- on a "Recently shipped"
-- approval card (auto_key roadmap_shipped:issue-<n>) an agent's request can
-- never change who owns or watches it: the person who approves what hosts are
-- told is chosen by people. Checked on the fully replayed PG17 schema; each
-- check is recorded and reported together:
--   P1  through the real gateway (ops_agent_call with a hashed key), update_work
--       replacing an owner, adding an owner, adding a watcher, removing a
--       watcher, or turning a watcher into an owner is people_only, and the
--       card's people are unchanged. An agent rewording it (owners left out,
--       or sent unchanged) is still allowed
--   P2  a person can still change its owners and watchers (ops_work_update)
--   P3  the backstop under every writer: in an agent's request, a direct
--       insert, delete or role change in ops_work_people for the card is
--       people_only; a rewrite that changes nothing is not. The same writes as
--       a person, or with no signed-in person (bridges, housekeeping), are
--       not refused
--   P4  the agent's own plain card is unaffected: it can change its owners
--       and watchers
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

create temp table t3980w2fu_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2fu_people (who, id, email) values
  ('owner',    '39884000-0000-4000-a000-000000000001', 'oz.w2fu3980@test.local'),
  ('admin',    '39884000-0000-4000-a000-000000000002', 'ivy.w2fu3980@test.local'),
  ('growth',   '39884000-0000-4000-a000-000000000003', 'kim.w2fu3980@test.local'),
  ('support',  '39884000-0000-4000-a000-000000000004', 'sue.w2fu3980@test.local'),
  ('offsupp',  '39884000-0000-4000-a000-000000000005', 'oli.w2fu3980@test.local'),
  ('host',     '39884000-0000-4000-a000-000000000006', 'hal.w2fu3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2fu_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2fu3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2fu3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2fu3980@test.local', 'growth', 'active', now()),
  ('sue.w2fu3980@test.local', 'growth', 'active', now()),
  ('oli.w2fu3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39884000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39884000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2fu_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2fu_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2fu_people where who = p_who;
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

create function pg_temp.t3980w2fu_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2fu_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2fu_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2fu_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2fu_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2fu_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2fu_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2fu_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2fu_next_request();
  return pg_temp.t3980w2fu_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2fu_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2fu_next_request();
  select id, email into strict v_id, v_email from t3980w2fu_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2fu_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2fu_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
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

create function pg_temp.t3980w2fu_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2fu_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2fu_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2fu_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2fu_record(p_pr int, p_extra jsonb default '{}') returns jsonb
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

create function pg_temp.t3980w2fu_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2fu_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2fu_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2fu_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2fu3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2fu3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2fu_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2fu_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2fu_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- A roadmap card linked to an issue that goes Live, so Bridge D drafts a
-- "Recently shipped" card and its approval card. Returns the approval card id.
create function pg_temp.t3980w2fu_bridge_d(p_n int, p_card uuid, p_title text) returns uuid
language plpgsql as $fn$
declare v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (p_card, p_title, 'Hosts can do the new thing. More words.', 'later', 'published', 900 + p_n % 50);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values (p_card, p_n, 'ivy.w2fu3980@test.local');
  insert into public.ops_github_items (number, kind) values (p_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2fu_ingest(pg_temp.t3980w2fu_record(90000 + p_n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', p_n, 'relation', 'fixes')))), p_n);
  perform pg_temp.t3980w2fu_apply(jsonb_build_array(pg_temp.t3980w2fu_gh(p_n, 'issue', 'Done', null, 'CLOSED')));
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-' || p_n;
  return v_card;
end;
$fn$;

create function pg_temp.t3980w2fu_draft(p_n int) returns uuid
language sql as $fn$
  select a.entity_id from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = p_n::text
$fn$;


create temp table t3980w2fu_keys (who text primary key, k text) on commit drop;

create function pg_temp.t3980w2fu_newkey(p_who text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2fu_person(p_who, $q$select public.team_agent_key_create('claude')::text$q$);
  insert into t3980w2fu_keys (who, k) values (p_who, pg_temp.t3980w2fu_j(v)->>'key')
  on conflict (who) do update set k = excluded.k;
  return v;
end;
$fn$;

-- One connector call through the work gateway, exactly as team-agent makes it.
create function pg_temp.t3980w2fu_mcp(p_who text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2fu_next_request();
  return pg_temp.t3980w2fu_as('service', format('select public.ops_agent_call(%L, %L, %L::jsonb, %L)::text',
    (select encode(sha256(convert_to(k, 'UTF8')), 'hex') from t3980w2fu_keys where who = p_who), p_tool, p_args, 'issue3980-w2fu-implementor/1.0'));
end;
$fn$;

-- A raw statement run as supabase_admin (any writer, guarded or not) while
-- the request is a person's connected agent: the gateway's request row for
-- this person in this transaction, and the person's JWT.
create function pg_temp.t3980w2fu_raw_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2fu_next_request();
  select id, email into strict v_id, v_email from t3980w2fu_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2fu_raw(v_id, v_email, p_sql);
end;
$fn$;

-- The same raw statement as the person (no agent request row), or with no
-- signed-in person at all (the bridges and housekeeping) when p_who is null.
create function pg_temp.t3980w2fu_raw_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2fu_next_request();
  if p_who is not null then
    select id, email into strict v_id, v_email from t3980w2fu_people where who = p_who;
  end if;
  return pg_temp.t3980w2fu_raw(v_id, v_email, p_sql);
end;
$fn$;

create function pg_temp.t3980w2fu_raw(p_id uuid, p_email text, p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), true);
  perform set_config('request.jwt.claim.email', coalesce(p_email, ''), true);
  perform set_config('request.jwt.claims', case when p_id is null then '{"role":"service_role"}'
    else json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.role', '', true);
  begin
    execute p_sql;
    v_out := 'OK';
  exception when others then
    v_out := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

create function pg_temp.t3980w2fu_state(p_card uuid) returns text
language sql as $fn$
  select status || ':' || coalesce(close_kind, '-') || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = p_card
$fn$;

create function pg_temp.t3980w2fu_links(p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(kind || ':' || target_id::text, ',' order by kind, target_id), '-') from public.ops_work_links where card_id = p_card
$fn$;

create function pg_temp.t3980w2fu_bridges() returns text
language sql as $fn$ select pg_temp.t3980w2fu_as('service', 'select public.ops_github_bridges()::text') $fn$;

create function pg_temp.t3980w2fu_people(p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(role || ':' || email, ',' order by role, email), '-') from public.ops_work_people where card_id = p_card
$fn$;

do $r$
declare v text; v_key text; v_c uuid; v_c2 uuid; v_plain uuid; v_before text; v_owner text;
        c_po constant text := '%"ok": false%"token": "people_only"%';
        c_words constant text := '%changes who owns or watches this card%';
begin
  v_key := pg_temp.t3980w2fu_newkey('owner');
  perform pg_temp.t3980w2fu_like('K', 'the owner connects an agent key', v_key, '%"key"%');

  -- P1: through the gateway.
  v_c := pg_temp.t3980w2fu_bridge_d(7961, '39884000-0000-4000-c100-000000000061', 'P1 hosts see who checked in');
  perform pg_temp.t3980w2fu_check('P1', 'the approval card waits for a person', pg_temp.t3980w2fu_state(v_c), 'person:-:-');
  -- A person first gives it a known owner and watcher.
  v := pg_temp.t3980w2fu_person('owner', format($q$select public.ops_work_update(%L, %L::jsonb, %s)::text$q$, v_c,
         jsonb_build_object('owners', jsonb_build_array('oz.w2fu3980@test.local'), 'watchers', jsonb_build_array('sue.w2fu3980@test.local')),
         pg_temp.t3980w2fu_rev(v_c::text)));
  v_before := pg_temp.t3980w2fu_people(v_c);
  perform pg_temp.t3980w2fu_check('P2', 'a person sets its owner and watcher', v_before, 'owner:oz.w2fu3980@test.local,watcher:sue.w2fu3980@test.local');

  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_c, 'expected_revision', pg_temp.t3980w2fu_rev(v_c::text),
         'changes', jsonb_build_object('owners', jsonb_build_array('kim.w2fu3980@test.local'))));
  perform pg_temp.t3980w2fu_like('P1', 'MCP replacing the owner is people_only', v, c_po);
  perform pg_temp.t3980w2fu_like('P1', 'the refusal says who owns or watches', v, c_words);
  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_c, 'expected_revision', pg_temp.t3980w2fu_rev(v_c::text),
         'changes', jsonb_build_object('owners', jsonb_build_array('oz.w2fu3980@test.local', 'kim.w2fu3980@test.local'))));
  perform pg_temp.t3980w2fu_like('P1', 'MCP adding a second owner is people_only', v, c_po);
  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_c, 'expected_revision', pg_temp.t3980w2fu_rev(v_c::text),
         'changes', jsonb_build_object('watchers', jsonb_build_array('sue.w2fu3980@test.local', 'ivy.w2fu3980@test.local'))));
  perform pg_temp.t3980w2fu_like('P1', 'MCP adding a watcher is people_only', v, c_po);
  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_c, 'expected_revision', pg_temp.t3980w2fu_rev(v_c::text),
         'changes', jsonb_build_object('watchers', '[]'::jsonb)));
  perform pg_temp.t3980w2fu_like('P1', 'MCP removing the watcher is people_only', v, c_po);
  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_c, 'expected_revision', pg_temp.t3980w2fu_rev(v_c::text),
         'changes', jsonb_build_object('owners', jsonb_build_array('oz.w2fu3980@test.local', 'sue.w2fu3980@test.local'), 'watchers', '[]'::jsonb)));
  perform pg_temp.t3980w2fu_like('P1', 'MCP turning the watcher into an owner is people_only', v, c_po);
  perform pg_temp.t3980w2fu_check('P1', 'after every gateway attempt its people are unchanged', pg_temp.t3980w2fu_people(v_c), v_before);
  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_c, 'expected_revision', pg_temp.t3980w2fu_rev(v_c::text),
         'changes', jsonb_build_object('title', 'Approve "Recently shipped": P1 hosts see who checked in (agent wording)')));
  perform pg_temp.t3980w2fu_like('P1', 'MCP rewording it (owners left out) is allowed', v, '%"ok": true%');
  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_c, 'expected_revision', pg_temp.t3980w2fu_rev(v_c::text),
         'changes', jsonb_build_object('result', 'Suggested wording ready.', 'owners', jsonb_build_array('oz.w2fu3980@test.local'),
                                       'watchers', jsonb_build_array('sue.w2fu3980@test.local'))));
  perform pg_temp.t3980w2fu_like('P1', 'MCP sending its people unchanged with a result is allowed', v, '%"ok": true%');
  perform pg_temp.t3980w2fu_check('P1', 'the result is saved and its people are still unchanged',
    (select result from public.ops_work_cards where id = v_c) || '|' || pg_temp.t3980w2fu_people(v_c), 'Suggested wording ready.|' || v_before);

  -- P2: a person can still change them.
  v := pg_temp.t3980w2fu_person('owner', format($q$select public.ops_work_update(%L, %L::jsonb, %s)::text$q$, v_c,
         jsonb_build_object('owners', jsonb_build_array('kim.w2fu3980@test.local'), 'watchers', jsonb_build_array('ivy.w2fu3980@test.local')),
         pg_temp.t3980w2fu_rev(v_c::text)));
  perform pg_temp.t3980w2fu_check('P2', 'a person replaces its owner and watcher', pg_temp.t3980w2fu_people(v_c),
    'owner:kim.w2fu3980@test.local,watcher:ivy.w2fu3980@test.local');

  -- P3: the backstop. Raw writes in an agent's request.
  v_c2 := pg_temp.t3980w2fu_bridge_d(7962, '39884000-0000-4000-c100-000000000062', 'P3 hosts can print badges');
  select string_agg(email, ',') into v_owner from public.ops_work_people where card_id = v_c2 and role = 'owner';
  v_before := pg_temp.t3980w2fu_people(v_c2);
  v := pg_temp.t3980w2fu_raw_agent('owner', format($q$insert into public.ops_work_people (card_id, email, role, added_by, added_via) values (%L, 'kim.w2fu3980@test.local', 'owner', 'oz.w2fu3980@test.local', 'claude')$q$, v_c2));
  perform pg_temp.t3980w2fu_like('P3', 'a raw agent insert of an owner is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2fu_raw_agent('owner', format($q$insert into public.ops_work_people (card_id, email, role, added_by, added_via) values (%L, 'ivy.w2fu3980@test.local', 'watcher', 'oz.w2fu3980@test.local', 'claude')$q$, v_c2));
  perform pg_temp.t3980w2fu_like('P3', 'a raw agent insert of a watcher is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2fu_raw_agent('owner', format($q$delete from public.ops_work_people where card_id = %L$q$, v_c2));
  perform pg_temp.t3980w2fu_like('P3', 'a raw agent delete is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2fu_raw_agent('owner', format($q$update public.ops_work_people set role = 'watcher' where card_id = %L$q$, v_c2));
  perform pg_temp.t3980w2fu_like('P3', 'a raw agent role change is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2fu_raw_agent('owner', format($q$update public.ops_work_people set email = 'kim.w2fu3980@test.local' where card_id = %L$q$, v_c2));
  perform pg_temp.t3980w2fu_like('P3', 'a raw agent swap of the person is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2fu_raw_agent('owner', format($q$select public.ops_people_set(%L, ARRAY['kim.w2fu3980@test.local'], ARRAY[]::text[], 'oz.w2fu3980@test.local', 'claude')$q$, v_c2));
  perform pg_temp.t3980w2fu_like('P3', 'ops_people_set in an agent''s request is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2fu_raw_agent('owner', format($q$update public.ops_work_people set role = role, added_at = added_at where card_id = %L$q$, v_c2));
  perform pg_temp.t3980w2fu_check('P3', 'a raw agent rewrite that changes nothing is not refused', v, 'OK');
  perform pg_temp.t3980w2fu_check('P3', 'after every raw agent write its people are unchanged', pg_temp.t3980w2fu_people(v_c2), v_before);
  v := pg_temp.t3980w2fu_raw_person('owner', format($q$insert into public.ops_work_people (card_id, email, role, added_by) values (%L, 'ivy.w2fu3980@test.local', 'watcher', 'oz.w2fu3980@test.local')$q$, v_c2));
  perform pg_temp.t3980w2fu_check('P3', 'the same insert as a person is not refused', v, 'OK');
  v := pg_temp.t3980w2fu_raw_person(null, format($q$delete from public.ops_work_people where card_id = %L and email = 'ivy.w2fu3980@test.local'$q$, v_c2));
  perform pg_temp.t3980w2fu_check('P3', 'a delete with no signed-in person (housekeeping) is not refused', v, 'OK');
  v := pg_temp.t3980w2fu_raw_person(null, format($q$select public.ops_people_set(%L, ARRAY['kim.w2fu3980@test.local'], ARRAY['ivy.w2fu3980@test.local'], 'system@usemingla.com', null)$q$, v_c2));
  perform pg_temp.t3980w2fu_check('P3', 'ops_people_set with no signed-in person is not refused', v, 'OK');
  perform pg_temp.t3980w2fu_check('P3', 'and it changed them', pg_temp.t3980w2fu_people(v_c2), 'owner:kim.w2fu3980@test.local,watcher:ivy.w2fu3980@test.local');

  -- P4: the agent's own plain card.
  v := pg_temp.t3980w2fu_mcp('owner', 'add_work', jsonb_build_object('request_key', 'w2fu-plain-mcp-1', 'cards', jsonb_build_array(jsonb_build_object(
         'title', 'P4 plain card the agent may staff', 'instructions', 'Do the plain thing.', 'done_means', 'It is done.',
         'owners', jsonb_build_array('oz.w2fu3980@test.local'), 'due_on', ((now() AT TIME ZONE 'UTC')::date + 3)::text))));
  v_plain := (pg_temp.t3980w2fu_j(v) #>> '{result,results,0,card,id}')::uuid;
  perform pg_temp.t3980w2fu_check('P4', 'the agent added its plain card', (v_plain is not null)::text, 'true');
  v := pg_temp.t3980w2fu_mcp('owner', 'update_work', jsonb_build_object('id', v_plain, 'expected_revision', pg_temp.t3980w2fu_rev(v_plain::text),
         'changes', jsonb_build_object('owners', jsonb_build_array('oz.w2fu3980@test.local', 'kim.w2fu3980@test.local'),
                                       'watchers', jsonb_build_array('ivy.w2fu3980@test.local'))));
  perform pg_temp.t3980w2fu_like('P4', 'MCP changing the plain card''s people is allowed', v, '%"ok": true%');
  perform pg_temp.t3980w2fu_check('P4', 'the plain card''s people changed', pg_temp.t3980w2fu_people(v_plain),
    'owner:kim.w2fu3980@test.local,owner:oz.w2fu3980@test.local,watcher:ivy.w2fu3980@test.local');
end $r$;

select count(*) as t3980w2fu_total, count(*) filter (where not ok) as t3980w2fu_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2fu_failures
  from t3980w2fu_results \gset
rollback;

select (:t3980w2fu_total < 29 or :t3980w2fu_failed > 0) as t3980w2fu_bad \gset
\if :t3980w2fu_bad
  \echo 'ISSUE-3980 W2 FOLLOW-UP ROADMAP PEOPLE FAILED:' :t3980w2fu_failed 'of' :t3980w2fu_total
  \echo :t3980w2fu_failures
  do $$ begin raise exception 'ISSUE-3980 W2 FOLLOW-UP ROADMAP PEOPLE FAIL'; end $$;
\endif
\echo 'ISSUE-3980 W2 FOLLOW-UP ROADMAP PEOPLE PASS:' :t3980w2fu_total 'checks, 0 failed'
