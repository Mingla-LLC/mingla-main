-- Issue #3980 synced program, Wave 2 rework 4 -- TESTER adversarial suite.
-- Angles the implementor suite does not take, on the fully replayed PG17
-- schema, everything rolled back:
--   X1  the record the tie reads (Bridge D's community_audit_log row) cannot
--       be forged, re-pointed, edited or deleted by an agent, a person or
--       anon; the tie function and the agent test are not client-callable
--   X2  no second approval card: add_work never takes an auto_key; an agent
--       cannot turn its plain card into one; no raw move to Doing
--   X3  a closed approval card: its close cannot be rewritten by an agent and
--       the gateway gives an agent no reopen or start
--   X4  gateway edges: the same link in capitals or twice is no change; an
--       extra card link, dropping the GitHub link or waiting on another issue
--       is refused; claim gives no working mark; release never takes a
--       person's mark
--   X5  crm_ctx() agent detection: headers and claims a client controls do
--       not make a person an agent or an agent a person
--   X6  one draft per issue, ever; a deleted draft never closes the card
--   X7  people, sprint correction, housekeeping and the bridges still work
-- Run from the repository root as supabase_admin.

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

create temp table t3980w2r4t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2r4t_people (who, id, email) values
  ('owner',    '39883000-0000-4000-a000-000000000001', 'oz.w2r4t3980@test.local'),
  ('admin',    '39883000-0000-4000-a000-000000000002', 'ivy.w2r4t3980@test.local'),
  ('growth',   '39883000-0000-4000-a000-000000000003', 'kim.w2r4t3980@test.local'),
  ('support',  '39883000-0000-4000-a000-000000000004', 'sue.w2r4t3980@test.local'),
  ('offsupp',  '39883000-0000-4000-a000-000000000005', 'oli.w2r4t3980@test.local'),
  ('host',     '39883000-0000-4000-a000-000000000006', 'hal.w2r4t3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2r4t_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2r4t3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2r4t3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2r4t3980@test.local', 'growth', 'active', now()),
  ('sue.w2r4t3980@test.local', 'growth', 'active', now()),
  ('oli.w2r4t3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39883000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39883000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2r4t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2r4t_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2r4t_people where who = p_who;
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

create function pg_temp.t3980w2r4t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r4t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2r4t_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r4t_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2r4t_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2r4t_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2r4t_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2r4t_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r4t_next_request();
  return pg_temp.t3980w2r4t_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2r4t_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r4t_next_request();
  select id, email into strict v_id, v_email from t3980w2r4t_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r4t_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r4t_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
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

create function pg_temp.t3980w2r4t_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2r4t_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2r4t_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2r4t_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2r4t_record(p_pr int, p_extra jsonb default '{}') returns jsonb
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

create function pg_temp.t3980w2r4t_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2r4t_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2r4t_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r4t_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2r4t3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2r4t3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2r4t_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2r4t_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2r4t_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- A roadmap card linked to an issue that goes Live, so Bridge D drafts a
-- "Recently shipped" card and its approval card. Returns the approval card id.
create function pg_temp.t3980w2r4t_bridge_d(p_n int, p_card uuid, p_title text) returns uuid
language plpgsql as $fn$
declare v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (p_card, p_title, 'Hosts can do the new thing. More words.', 'later', 'published', 900 + p_n % 50);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values (p_card, p_n, 'ivy.w2r4t3980@test.local');
  insert into public.ops_github_items (number, kind) values (p_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r4t_ingest(pg_temp.t3980w2r4t_record(90000 + p_n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', p_n, 'relation', 'fixes')))), p_n);
  perform pg_temp.t3980w2r4t_apply(jsonb_build_array(pg_temp.t3980w2r4t_gh(p_n, 'issue', 'Done', null, 'CLOSED')));
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-' || p_n;
  return v_card;
end;
$fn$;

create function pg_temp.t3980w2r4t_draft(p_n int) returns uuid
language sql as $fn$
  select a.entity_id from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = p_n::text
$fn$;


create temp table t3980w2r4t_keys (who text primary key, k text) on commit drop;

create function pg_temp.t3980w2r4t_newkey(p_who text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r4t_person(p_who, $q$select public.team_agent_key_create('claude')::text$q$);
  insert into t3980w2r4t_keys (who, k) values (p_who, pg_temp.t3980w2r4t_j(v)->>'key')
  on conflict (who) do update set k = excluded.k;
  return v;
end;
$fn$;

-- One connector call through the work gateway, exactly as team-agent makes it.
create function pg_temp.t3980w2r4t_mcp(p_who text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r4t_next_request();
  return pg_temp.t3980w2r4t_as('service', format('select public.ops_agent_call(%L, %L, %L::jsonb, %L)::text',
    (select encode(sha256(convert_to(k, 'UTF8')), 'hex') from t3980w2r4t_keys where who = p_who), p_tool, p_args, 'issue3980-r4-tester/1.0'));
end;
$fn$;

-- A raw statement run as supabase_admin (any writer, guarded or not) while
-- the request is a person's connected agent: the gateway's request row for
-- this person in this transaction, and the person's JWT.
create function pg_temp.t3980w2r4t_raw_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r4t_next_request();
  select id, email into strict v_id, v_email from t3980w2r4t_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r4t_raw(v_id, v_email, p_sql);
end;
$fn$;

-- The same raw statement as the person (no agent request row), or with no
-- signed-in person at all (the bridges and housekeeping) when p_who is null.
create function pg_temp.t3980w2r4t_raw_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r4t_next_request();
  if p_who is not null then
    select id, email into strict v_id, v_email from t3980w2r4t_people where who = p_who;
  end if;
  return pg_temp.t3980w2r4t_raw(v_id, v_email, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r4t_raw(p_id uuid, p_email text, p_sql text) returns text
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

create function pg_temp.t3980w2r4t_state(p_card uuid) returns text
language sql as $fn$
  select status || ':' || coalesce(close_kind, '-') || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = p_card
$fn$;

create function pg_temp.t3980w2r4t_links(p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(kind || ':' || target_id::text, ',' order by kind, target_id), '-') from public.ops_work_links where card_id = p_card
$fn$;

create function pg_temp.t3980w2r4t_bridges() returns text
language sql as $fn$ select pg_temp.t3980w2r4t_as('service', 'select public.ops_github_bridges()::text') $fn$;


create temp table t3980w2r4t_info (seq serial primary key, label text, detail text) on commit drop;

do $r$
declare v text; v_key text; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_plain uuid; v_draft uuid; v_rev bigint;
        v_pub uuid := '39883000-0000-4000-c100-0000000000aa';
        c_po constant text := '%"ok": false%"token": "people_only"%';
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (v_pub, 'R4T an old card hosts already saw', 'Already out.', 'later', 'published', 991);
  v_key := pg_temp.t3980w2r4t_newkey('owner');
  perform pg_temp.t3980w2r4t_like('K', 'the owner connects an agent key', v_key, '%"key"%');

  -- X1: the record the tie reads cannot be forged, altered or deleted by an
  -- agent, a person or anon. A forged older row would win the tie (ORDER BY created_at).
  v_a := pg_temp.t3980w2r4t_bridge_d(8101, '39883000-0000-4000-c100-000000000101', 'X1 hosts see payouts sooner');
  v_draft := pg_temp.t3980w2r4t_draft(8101);
  perform pg_temp.t3980w2r4t_check('X1', 'Bridge D drafted and made the approval card', (v_a is not null and v_draft is not null)::text, 'true');
  v := pg_temp.t3980w2r4t_agent('owner', format($q$with i as (insert into public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata, created_at)
         values (null, 'draft_roadmap_card', 'community_roadmap_card', %L, '{"source":"issue_3980_bridge_d","issue":"8101"}'::jsonb, now() - interval '1 year') returning 1) select 'inserted' from i$q$, v_pub));
  perform pg_temp.t3980w2r4t_like('X1', 'an agent cannot forge an older Bridge D audit row', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_person('owner', format($q$with i as (insert into public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
         values (null, 'draft_roadmap_card', 'community_roadmap_card', %L, '{"source":"issue_3980_bridge_d","issue":"8101"}'::jsonb) returning 1) select 'inserted' from i$q$, v_pub));
  perform pg_temp.t3980w2r4t_like('X1', 'the owner (a person) cannot forge one either', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_as('anon', format($q$with i as (insert into public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
         values (null, 'draft_roadmap_card', 'community_roadmap_card', %L, '{"source":"issue_3980_bridge_d","issue":"8101"}'::jsonb) returning 1) select 'inserted' from i$q$, v_pub));
  perform pg_temp.t3980w2r4t_like('X1', 'anon cannot forge one', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_agent('owner', format($q$with u as (update public.community_audit_log set entity_id = %L where entity_id = %L returning 1) select 'updated:' || count(*) from u$q$, v_pub, v_draft));
  perform pg_temp.t3980w2r4t_like('X1', 'an agent cannot re-point the Bridge D audit row', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_person('admin', format($q$with u as (update public.community_audit_log set metadata = metadata || '{"issue":"1"}' where entity_id = %L returning 1) select 'updated:' || count(*) from u$q$, v_draft));
  perform pg_temp.t3980w2r4t_like('X1', 'an admin (a person) cannot edit it', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_agent('owner', format($q$with d as (delete from public.community_audit_log where entity_id = %L returning 1) select 'deleted:' || count(*) from d$q$, v_draft));
  perform pg_temp.t3980w2r4t_like('X1', 'an agent cannot delete it', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_person('owner', format($q$with d as (delete from public.community_audit_log where entity_id = %L returning 1) select 'deleted:' || count(*) from d$q$, v_draft));
  perform pg_temp.t3980w2r4t_like('X1', 'the owner cannot delete it', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_person('owner', $q$select public.ops_roadmap_shipped_draft('roadmap_shipped:issue-8101')::text$q$);
  perform pg_temp.t3980w2r4t_like('X1', 'a signed-in person cannot call the tie function', v, 'ERR:42501:%');
  v := pg_temp.t3980w2r4t_person('owner', $q$select public.ops_agent_request()::text$q$);
  perform pg_temp.t3980w2r4t_like('X1', 'a signed-in person cannot call the agent test', v, 'ERR:42501:%');
  perform pg_temp.t3980w2r4t_check('X1', 'the tie still names the draft Bridge D made', public.ops_roadmap_shipped_draft('roadmap_shipped:issue-8101')::text, v_draft::text);
  perform pg_temp.t3980w2r4t_check('X1', 'exactly one Bridge D row for the issue', (select count(*)::text from public.community_audit_log a where a.action = 'draft_roadmap_card' and a.metadata->>'issue' = '8101'), '1');
  perform pg_temp.t3980w2r4t_bridges();
  perform pg_temp.t3980w2r4t_check('X1', 'housekeeping keeps the unreviewed card open', pg_temp.t3980w2r4t_state(v_a), 'person:-:-');

  -- X2: a second approval card. An agent cannot make one through add_work
  -- (no auto_key from a request), nor turn its own plain card into one.
  v := pg_temp.t3980w2r4t_mcp('owner', 'add_work', jsonb_build_object('request_key', 'r4t-autokey-1', 'cards', jsonb_build_array(jsonb_build_object(
         'title', 'X2 a card claiming to be an approval card', 'instructions', 'Do it.', 'done_means', 'Done.',
         'auto_key', 'roadmap_shipped:issue-8101', 'auto', true, 'auto_kind', 'roadmap_shipped',
         'owners', jsonb_build_array('oz.w2r4t3980@test.local'), 'due_on', ((now() AT TIME ZONE 'UTC')::date + 3)::text))));
  insert into t3980w2r4t_info (label, detail) values ('X2 add_work with auto_key', left(v, 300));
  perform pg_temp.t3980w2r4t_check('X2', 'add_work refuses a card that sends auto, auto_key or auto_kind',
    (pg_temp.t3980w2r4t_j(v) #>> '{result,added}') || ':' || (pg_temp.t3980w2r4t_j(v) #>> '{result,refused}'), '0:1');
  v := pg_temp.t3980w2r4t_mcp('owner', 'add_work', jsonb_build_object('request_key', 'r4t-plain-0001', 'cards', jsonb_build_array(jsonb_build_object(
         'title', 'X2 the agent''s own plain card', 'instructions', 'Do the plain thing for the team.', 'done_means', 'It is done.',
         'owners', jsonb_build_array('oz.w2r4t3980@test.local'), 'due_on', ((now() AT TIME ZONE 'UTC')::date + 3)::text))));
  insert into t3980w2r4t_info (label, detail) values ('X2 plain add_work', left(v, 300));
  v_plain := (pg_temp.t3980w2r4t_j(v) #>> '{result,results,0,card,id}')::uuid;
  perform pg_temp.t3980w2r4t_check('X2', 'the agent''s plain card has no auto_key',
    (select coalesce(auto_key, '-') from public.ops_work_cards where id = v_plain), '-');
  perform pg_temp.t3980w2r4t_check('X2', 'still exactly one open approval card for the issue',
    (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-8101'), '1');
  v := pg_temp.t3980w2r4t_raw_agent('owner', format($q$update public.ops_work_cards set auto_key = 'roadmap_shipped:issue-8102' where id = %L$q$, v_plain));
  perform pg_temp.t3980w2r4t_like('X2', 'an agent cannot turn its plain card into an approval card (raw)', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4t_raw_agent('owner', format($q$update public.ops_work_cards set status = 'doing', person_reason = null, started_at = now() where id = %L$q$, v_a));
  perform pg_temp.t3980w2r4t_like('X2', 'an agent cannot move the approval card to Doing (raw)', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4t_raw_agent('owner', format($q$update public.ops_work_cards set due_on = due_on + 7, title = 'X1 hosts see payouts sooner (agent wording)' where id = %L$q$, v_a));
  perform pg_temp.t3980w2r4t_check('X2', 'an agent may still reword it and move its due date (raw)', v, 'OK');

  -- X3: a closed approval card. The close cannot be rewritten by an agent, and
  -- the gateway gives an agent no way to reopen it.
  v := pg_temp.t3980w2r4t_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Read it; will publish later"}]'::jsonb, null, %s)::text$q$, v_a, pg_temp.t3980w2r4t_rev(v_a::text)));
  perform pg_temp.t3980w2r4t_check('X3', 'a person closes the approval card', pg_temp.t3980w2r4t_state(v_a), 'done:done:-');
  v := pg_temp.t3980w2r4t_raw_agent('owner', format($q$update public.ops_work_cards set close_reason = 'A person published the Recently shipped card.', proof = '[{"kind":"text","text":"Agent wrote this"}]'::jsonb where id = %L$q$, v_a));
  perform pg_temp.t3980w2r4t_like('X3', 'an agent cannot rewrite the close of a done approval card (raw)', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4t_raw_agent('owner', format($q$update public.ops_work_cards set closed_by = 'kim.w2r4t3980@test.local' where id = %L$q$, v_a));
  perform pg_temp.t3980w2r4t_like('X3', 'an agent cannot change who closed it (raw)', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4t_raw_agent('owner', format($q$update public.ops_work_cards set status = 'todo', auto_key = 'roadmap_shipped:issue-8199', closed_at = null, close_kind = null where id = %L$q$, v_a));
  perform pg_temp.t3980w2r4t_like('X3', 'a reopen cannot carry a key change with it (raw)', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_a, 'expected_revision', pg_temp.t3980w2r4t_rev(v_a::text),
         'changes', jsonb_build_object('status', 'todo', 'reason', 'The agent wants this back on the board.')));
  perform pg_temp.t3980w2r4t_like('X3', 'MCP update_work cannot reopen the closed approval card', v, '%"ok": false%');
  insert into t3980w2r4t_info (label, detail) values ('X3 MCP reopen answer', left(v, 300));
  v := pg_temp.t3980w2r4t_mcp('owner', 'start_work', jsonb_build_object('id', v_a, 'expected_revision', pg_temp.t3980w2r4t_rev(v_a::text)));
  perform pg_temp.t3980w2r4t_like('X3', 'MCP start_work on the closed approval card is people_only', v, c_po);
  perform pg_temp.t3980w2r4t_check('X3', 'after every attempt the card is still closed by the person', pg_temp.t3980w2r4t_state(v_a), 'done:done:-');

  -- X4: gateway edges on an open approval card.
  v_b := pg_temp.t3980w2r4t_bridge_d(8103, '39883000-0000-4000-c100-000000000103', 'X4 hosts can split a payout');
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_b, 'expected_revision', pg_temp.t3980w2r4t_rev(v_b::text),
         'changes', jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', upper(pg_temp.t3980w2r4t_draft(8103)::text))))));
  perform pg_temp.t3980w2r4t_like('X4', 'MCP sending its own link back in capitals is not a change', v, '%"ok": true%');
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_b, 'expected_revision', pg_temp.t3980w2r4t_rev(v_b::text),
         'changes', jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', pg_temp.t3980w2r4t_draft(8103)),
                                                                  jsonb_build_object('kind', 'roadmap_card', 'id', pg_temp.t3980w2r4t_draft(8103))))));
  perform pg_temp.t3980w2r4t_like('X4', 'MCP sending its own link twice is not a change', v, '%"ok": true%');
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_b, 'expected_revision', pg_temp.t3980w2r4t_rev(v_b::text),
         'changes', jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', pg_temp.t3980w2r4t_draft(8103)),
                                                                  jsonb_build_object('kind', 'card', 'id', v_plain)))));
  perform pg_temp.t3980w2r4t_like('X4', 'MCP adding a card link next to its own is people_only', v, c_po);
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_b, 'expected_revision', pg_temp.t3980w2r4t_rev(v_b::text),
         'changes', jsonb_build_object('github', '[]'::jsonb)));
  perform pg_temp.t3980w2r4t_like('X4', 'MCP dropping its GitHub link is people_only', v, c_po);
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_b, 'expected_revision', pg_temp.t3980w2r4t_rev(v_b::text),
         'changes', jsonb_build_object('blocked_on_github', 8199)));
  perform pg_temp.t3980w2r4t_like('X4', 'MCP waiting it on another issue is refused', v, '%"ok": false%');
  insert into t3980w2r4t_info (label, detail) values ('X4 blocked_on_github answer', left(v, 300));
  v := pg_temp.t3980w2r4t_mcp('owner', 'claim', jsonb_build_object('card_id', v_b, 'targets', jsonb_build_array(jsonb_build_object('kind', 'work_card', 'id', v_b))));
  perform pg_temp.t3980w2r4t_like('X4', 'MCP claiming the approval card is refused', v, '%"ok": false%');
  v := pg_temp.t3980w2r4t_mcp('owner', 'claim', jsonb_build_object('card_id', v_b, 'targets', '[]'::jsonb));
  perform pg_temp.t3980w2r4t_check('X4', 'a claim call naming the card gives no working mark',
    (select coalesce(working_by, '-') || ':' || coalesce(working_via, '-') from public.ops_work_cards where id = v_b), '-:-');
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_b, 'request_key', 'r4t-note-0001', 'note', 'The agent read the draft and thinks it is fine.'));
  perform pg_temp.t3980w2r4t_like('X4', 'MCP note on the approval card is allowed', v, '%"ok": true%');
  perform pg_temp.t3980w2r4t_check('X4', 'after every gateway attempt it still waits for a person with its own link and GitHub link',
    pg_temp.t3980w2r4t_state(v_b) || '|' || pg_temp.t3980w2r4t_links(v_b) || '|' || (select coalesce(string_agg(number::text, ','), '-') from public.ops_work_github where card_id = v_b),
    'person:-:-|roadmap_card:' || pg_temp.t3980w2r4t_draft(8103) || '|8103');
  -- A person sends it back and starts it; the agent's release cannot take the person's mark.
  v := pg_temp.t3980w2r4t_person('owner', format($q$select public.ops_work_person_action(%L, 'send_back', 'Change the wording first, please.', %s)::text$q$, v_b, pg_temp.t3980w2r4t_rev(v_b::text)));
  v := pg_temp.t3980w2r4t_person('owner', format($q$select public.ops_work_start(%L, %s)::text$q$, v_b, pg_temp.t3980w2r4t_rev(v_b::text)));
  perform pg_temp.t3980w2r4t_check('X4', 'a person starts the sent-back approval card',
    (select status || ':' || coalesce(working_by, '-') || ':' || coalesce(working_via, '-') from public.ops_work_cards where id = v_b), 'doing:oz.w2r4t3980@test.local:-');
  v := pg_temp.t3980w2r4t_mcp('owner', 'release', jsonb_build_object('card_id', v_b));
  perform pg_temp.t3980w2r4t_check('X4', 'an agent release leaves the person working on it',
    (select status || ':' || coalesce(working_by, '-') || ':' || coalesce(working_via, '-') from public.ops_work_cards where id = v_b), 'doing:oz.w2r4t3980@test.local:-');
  v := pg_temp.t3980w2r4t_mcp('owner', 'update_work', jsonb_build_object('id', v_b, 'expected_revision', pg_temp.t3980w2r4t_rev(v_b::text),
         'changes', jsonb_build_object('owners', jsonb_build_array('kim.w2r4t3980@test.local'))));
  insert into t3980w2r4t_info (label, detail) values ('X4 MCP owners change answer', left(v, 200));
  insert into t3980w2r4t_info (label, detail) values ('X4 owners after the agent call',
    (select coalesce(string_agg(email, ',' order by email), '-') from public.ops_work_people where card_id = v_b and role = 'owner'));

  -- X5: crm_ctx agent detection cannot be spoofed by what a client controls.
  -- A person claiming to be an agent in headers or claims is still a person
  -- (allowed); an agent claiming service_role in its claims is still an agent.
  perform pg_temp.t3980w2r4t_next_request();
  perform set_config('request.headers', '{"x-mingla-agent":"claude","user-agent":"team-agent/1.0","x-client-info":"team-agent"}', true);
  perform set_config('request.jwt.claim.sub', '39883000-0000-4000-a000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"39883000-0000-4000-a000-000000000001","role":"authenticated","via":"claude","agent":"claude","app_metadata":{"agent":"claude"}}', true);
  perform pg_temp.t3980w2r4t_check('X5', 'a person whose headers and claims say agent is not an agent', public.ops_agent_request()::text, 'false');
  perform set_config('request.headers', '', true);
  perform pg_temp.t3980w2r4t_next_request();
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), 'oz.w2r4t3980@test.local', '39883000-0000-4000-a000-000000000001', 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  perform set_config('request.jwt.claim.sub', '39883000-0000-4000-a000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"sub":"39883000-0000-4000-a000-000000000001","role":"service_role"}', true);
  perform pg_temp.t3980w2r4t_check('X5', 'an agent request whose claims say service_role is still an agent', public.ops_agent_request()::text, 'true');
  begin
    delete from public.ops_work_github where card_id = v_b;
    v := 'OK';
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.t3980w2r4t_like('X5', 'and its raw GitHub link delete is refused', v, 'ERR:42501:people_only:%');
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.t3980w2r4t_next_request();
  perform pg_temp.t3980w2r4t_check('X5', 'a request row from an earlier transaction does not make a later person an agent',
    (select pg_temp.t3980w2r4t_raw('39883000-0000-4000-a000-000000000001', 'oz.w2r4t3980@test.local',
       format($q$update public.ops_work_cards set due_on = due_on where id = %L$q$, v_b))), 'OK');

  -- X6: the tie stays one-per-issue, and a missing draft never closes a card.
  v_c := pg_temp.t3980w2r4t_bridge_d(8105, '39883000-0000-4000-c100-000000000105', 'X6 hosts can pin a review');
  v := pg_temp.t3980w2r4t_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Not needed this time"}]'::jsonb, null, %s)::text$q$, v_c, pg_temp.t3980w2r4t_rev(v_c::text)));
  update public.ops_work_cards set closed_at = now() - interval '20 days' where id = v_c;
  perform pg_temp.t3980w2r4t_bridges();
  perform pg_temp.t3980w2r4t_reconcile();
  perform pg_temp.t3980w2r4t_check('X6', 'a closed approval card is never drafted again (one Bridge D row, one card)',
    (select count(*)::text from public.community_audit_log a where a.action = 'draft_roadmap_card' and a.metadata->>'issue' = '8105') || ':' ||
    (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-8105'), '1:1');
  v_d := pg_temp.t3980w2r4t_bridge_d(8106, '39883000-0000-4000-c100-000000000106', 'X6 hosts can reply to reviews');
  delete from public.community_roadmap_cards where id = pg_temp.t3980w2r4t_draft(8106);
  perform pg_temp.t3980w2r4t_bridges();
  perform pg_temp.t3980w2r4t_check('X6', 'a deleted draft never closes its approval card as published', pg_temp.t3980w2r4t_state(v_d), 'person:-:-');
  v := pg_temp.t3980w2r4t_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"The draft was removed"}]'::jsonb, null, %s)::text$q$, v_d, pg_temp.t3980w2r4t_rev(v_d::text)));
  perform pg_temp.t3980w2r4t_check('X6', 'a person can still close it', pg_temp.t3980w2r4t_state(v_d), 'done:done:-');

  -- X7: people, bridges, housekeeping and sprint rollover are not affected.
  v_e := pg_temp.t3980w2r4t_bridge_d(8107, '39883000-0000-4000-c100-000000000107', 'X7 hosts can copy a ticket tier');
  v := pg_temp.t3980w2r4t_person('admin', format($q$select public.ops_work_update(%L, %L::jsonb, %s, null)::text$q$, v_e,
         jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', pg_temp.t3980w2r4t_draft(8107)), jsonb_build_object('kind', 'roadmap_card', 'id', v_pub)),
                            'github', jsonb_build_array('#8107', '#8198')), pg_temp.t3980w2r4t_rev(v_e::text)));
  perform pg_temp.t3980w2r4t_check('X7', 'an admin (a person) changes its links and GitHub links',
    pg_temp.t3980w2r4t_links(v_e) || '|' || (select string_agg(number::text, ',' order by number) from public.ops_work_github where card_id = v_e),
    (select string_agg(x, ',' order by x) from unnest(array['roadmap_card:' || pg_temp.t3980w2r4t_draft(8107), 'roadmap_card:' || v_pub]) x) || '|8107,8198');
  v := pg_temp.t3980w2r4t_as('service', 'select public.ops_sprint_correct()::text');
  perform pg_temp.t3980w2r4t_like('X7', 'sprint correction runs with approval cards present', v, '%');
  perform pg_temp.t3980w2r4t_check('X7', 'sprint correction did not error', (v like 'ERR:%')::text, 'false');
  v := pg_temp.t3980w2r4t_reconcile();
  perform pg_temp.t3980w2r4t_check('X7', 'housekeeping (ops_reconcile) runs without an error', (v like 'ERR:%')::text, 'false');
  insert into t3980w2r4t_info (label, detail) values ('X7 reconcile', left(v, 400));
  perform pg_temp.t3980w2r4t_check('X7', 'a person linking a published card does not close the unreviewed approval card at housekeeping',
    pg_temp.t3980w2r4t_state(v_e), 'person:-:-');
  update public.community_roadmap_cards set status = 'published' where id = pg_temp.t3980w2r4t_draft(8107);
  perform pg_temp.t3980w2r4t_bridges();
  perform pg_temp.t3980w2r4t_check('X7', 'its draft published, housekeeping closes it as a person publishing',
    (select status || ':' || coalesce(closed_via, '-') || ':' || coalesce(close_reason, '-') from public.ops_work_cards where id = v_e),
    'done:system:A person published the Recently shipped card.');
end $r$;

select count(*) as t3980w2r4t_total, count(*) filter (where not ok) as t3980w2r4t_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2r4t_failures
  from t3980w2r4t_results \gset
select coalesce(string_agg(label || ': ' || detail, E'\n' order by seq), 'none') as t3980w2r4t_infos from t3980w2r4t_info \gset
rollback;

\echo :t3980w2r4t_infos
select (:t3980w2r4t_total < 50 or :t3980w2r4t_failed > 0) as t3980w2r4t_bad \gset
\if :t3980w2r4t_bad
  \echo 'ISSUE-3980 W2 REWORK 4 TESTER TIE ATTACKS FAILED:' :t3980w2r4t_failed 'of' :t3980w2r4t_total
  \echo :t3980w2r4t_failures
  do $$ begin raise exception 'ISSUE-3980 W2 REWORK 4 TESTER TIE ATTACKS FAIL'; end $$;
\endif
\echo 'ISSUE-3980 W2 REWORK 4 TESTER TIE ATTACKS PASS:' :t3980w2r4t_total 'checks, 0 failed'
