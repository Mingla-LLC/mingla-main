-- Issue #3980 synced program, Wave 2 rework 3 -- the tester's P1 on the fully
-- replayed PG17 schema: an agent must never close or push back a roadmap
-- approval card (auto_key roadmap_shipped:...), whatever its status, the way
-- a gate card is never an agent's to close. Each check is recorded and
-- reported together:
--   R1  an agent sending the card back to To do with a reason is refused
--       (people_only); it still waits for a person
--   R2  after a PERSON sends it back to To do, an agent's close_work and
--       both push_back kinds are refused (people_only), and it cannot move
--       the card to Doing or back to To review either
--   R3  while it waits for a person, an agent's close and push back are
--       refused (people_only)
--   R4  a card a person closed and an agent reopened still cannot be closed
--       by the agent
--   R5  a person still can: closes the sent-back card with proof, and
--       pushes back another as not needed
--   R6  an agent can still note a result on it (only moving and closing are
--       a person's)
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

create temp table t3980w2r3i_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2r3i_people (who, id, email) values
  ('owner',    '39880000-0000-4000-a000-000000000001', 'oz.w2r3i3980@test.local'),
  ('admin',    '39880000-0000-4000-a000-000000000002', 'ivy.w2r3i3980@test.local'),
  ('growth',   '39880000-0000-4000-a000-000000000003', 'kim.w2r3i3980@test.local'),
  ('support',  '39880000-0000-4000-a000-000000000004', 'sue.w2r3i3980@test.local'),
  ('offsupp',  '39880000-0000-4000-a000-000000000005', 'oli.w2r3i3980@test.local'),
  ('host',     '39880000-0000-4000-a000-000000000006', 'hal.w2r3i3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2r3i_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2r3i3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2r3i3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2r3i3980@test.local', 'growth', 'active', now()),
  ('sue.w2r3i3980@test.local', 'growth', 'active', now()),
  ('oli.w2r3i3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39880000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39880000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2r3i_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2r3i_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2r3i_people where who = p_who;
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

create function pg_temp.t3980w2r3i_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r3i_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2r3i_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r3i_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2r3i_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2r3i_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2r3i_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2r3i_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r3i_next_request();
  return pg_temp.t3980w2r3i_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2r3i_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r3i_next_request();
  select id, email into strict v_id, v_email from t3980w2r3i_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r3i_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r3i_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
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

create function pg_temp.t3980w2r3i_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2r3i_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2r3i_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2r3i_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2r3i_record(p_pr int, p_extra jsonb default '{}') returns jsonb
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

create function pg_temp.t3980w2r3i_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2r3i_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2r3i_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r3i_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2r3i3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2r3i3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2r3i_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2r3i_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2r3i_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- A roadmap card linked to an issue that goes Live, so Bridge D drafts a
-- "Recently shipped" card and its approval card. Returns the approval card id.
create function pg_temp.t3980w2r3i_bridge_d(p_n int, p_card uuid, p_title text) returns uuid
language plpgsql as $fn$
declare v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (p_card, p_title, 'Hosts can do the new thing. More words.', 'later', 'published', 900 + p_n % 50);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values (p_card, p_n, 'ivy.w2r3i3980@test.local');
  insert into public.ops_github_items (number, kind) values (p_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r3i_ingest(pg_temp.t3980w2r3i_record(90000 + p_n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', p_n, 'relation', 'fixes')))), p_n);
  perform pg_temp.t3980w2r3i_apply(jsonb_build_array(pg_temp.t3980w2r3i_gh(p_n, 'issue', 'Done', null, 'CLOSED')));
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-' || p_n;
  return v_card;
end;
$fn$;

create function pg_temp.t3980w2r3i_draft(p_n int) returns uuid
language sql as $fn$
  select a.entity_id from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = p_n::text
$fn$;

do $r$
declare v text; v_card uuid; v_card2 uuid; v_card3 uuid;
begin
  -- R1
  v_card := pg_temp.t3980w2r3i_bridge_d(7931, '39880000-0000-4000-c100-000000000031', 'R1 hosts see the new report');
  perform pg_temp.t3980w2r3i_check('R1', 'the approval card waits for a person', (select status from public.ops_work_cards where id = v_card), 'person');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_update(%L, '{"status":"todo","reason":"The wording needs another pass by me."}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R1', 'an agent sending it back to To do with a reason is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_update(%L, '{"status":"doing","reason":"I am working on the wording now."}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R1', 'an agent moving it to Doing with a reason is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_update(%L, '{"person_reason":"send"}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R1', 'an agent changing what it waits for is people_only', v, 'ERR:42501:people_only:%');
  -- R3
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Agent closes it"}]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R3', 'an agent closing it while it waits for a person is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_push_back(%L, 'declined', 'Agent says hosts do not need this one.', '[]'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R3', 'an agent pushing it back while it waits for a person is people_only', v, 'ERR:42501:people_only:%');
  perform pg_temp.t3980w2r3i_check('R1', 'after every agent attempt it still waits for a person to publish',
    (select status || ':' || coalesce(person_reason, '-') || ':' || coalesce(close_kind, '-') from public.ops_work_cards where id = v_card), 'person:publish:-');

  -- R2: a person sends it back; the agent still cannot finish it.
  v := pg_temp.t3980w2r3i_person('owner', format($q$select public.ops_work_person_action(%L, 'send_back', 'Change the wording first, please.', %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_check('R2', 'a person sent it back to To do', (select status from public.ops_work_cards where id = v_card), 'todo');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Agent closes it"}]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R2', 'an agent closing the sent-back card is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_push_back(%L, 'declined', 'Agent says hosts do not need this one.', '[]'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R2', 'an agent pushing the sent-back card back as not needed is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_push_back(%L, 'already_done', 'The agent thinks this was already published.', '[{"kind":"text","text":"It is on the roadmap"}]'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R2', 'an agent pushing the sent-back card back as already done is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_update(%L, '{"status":"doing"}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R2', 'an agent moving the sent-back card to Doing is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"other"}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R2', 'an agent moving the sent-back card back to To review is people_only', v, 'ERR:42501:people_only:%');
  perform pg_temp.t3980w2r3i_check('R2', 'the sent-back card is still open in To do, never closed by an agent',
    (select status || ':' || coalesce(close_kind, '-') || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = v_card), 'todo:-:-');
  -- R6: an agent can still write a result on it.
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_update(%L, '{"result":"Suggested wording: hosts can now see the report."}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_check('R6', 'an agent can still note a result', (select result from public.ops_work_cards where id = v_card), 'Suggested wording: hosts can now see the report.');
  -- R5: a person closes the sent-back card with proof.
  v := pg_temp.t3980w2r3i_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Read the draft, publishing it next week"}]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_check('R5', 'a person closes the sent-back card with proof',
    (select status || ':' || close_kind || ':' || closed_by || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = v_card), 'done:done:oz.w2r3i3980@test.local:-');

  -- R4: reopened by an agent, still not the agent's to close.
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_reopen(%L, 'Looking at it again.', %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_check('R4', 'the agent reopened it', (select status from public.ops_work_cards where id = v_card), 'todo');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Agent closes it"}]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R4', 'an agent closing the reopened card is people_only', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r3i_agent('owner', format($q$select public.ops_work_push_back(%L, 'declined', 'Agent says hosts do not need this one.', '[]'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r3i_rev(v_card::text)));
  perform pg_temp.t3980w2r3i_like('R4', 'an agent pushing the reopened card back is people_only', v, 'ERR:42501:people_only:%');

  -- R5: a person pushes back another one as not needed, straight from To review.
  v_card2 := pg_temp.t3980w2r3i_bridge_d(7932, '39880000-0000-4000-c100-000000000032', 'R5 hosts can pause a listing');
  v := pg_temp.t3980w2r3i_person('owner', format($q$select public.ops_work_push_back(%L, 'declined', 'Hosts do not need to hear about this one.', '[]'::jsonb, %s)::text$q$, v_card2, pg_temp.t3980w2r3i_rev(v_card2::text)));
  perform pg_temp.t3980w2r3i_check('R5', 'a person pushes another back as not needed',
    (select status || ':' || close_kind || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = v_card2), 'done:declined:-');
  -- A plain agent card is unaffected: the agent closes its own To do card.
  v_card3 := pg_temp.t3980w2r3i_card('owner', 'R5 plain card the agent may close', '[]'::jsonb, 'w2r3i-plain-1');
  v := pg_temp.t3980w2r3i_agent('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Done by the agent"}]'::jsonb, null, %s)::text$q$, v_card3, pg_temp.t3980w2r3i_rev(v_card3::text)));
  perform pg_temp.t3980w2r3i_check('R5', 'a plain card is still the agent''s to close', (select status || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = v_card3), 'done:claude');
end $r$;

select count(*) as t3980w2r3i_total, count(*) filter (where not ok) as t3980w2r3i_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2r3i_failures
  from t3980w2r3i_results \gset
rollback;

select (:t3980w2r3i_total < 21 or :t3980w2r3i_failed > 0) as t3980w2r3i_bad \gset
\if :t3980w2r3i_bad
  \echo 'ISSUE-3980 W2 REWORK 3 ROADMAP PEOPLE ONLY FAILED:' :t3980w2r3i_failed 'of' :t3980w2r3i_total
  \echo :t3980w2r3i_failures
  do $$ begin raise exception 'ISSUE-3980 W2 REWORK 3 ROADMAP PEOPLE ONLY FAIL'; end $$;
\endif
\echo 'ISSUE-3980 W2 REWORK 3 ROADMAP PEOPLE ONLY PASS:' :t3980w2r3i_total 'checks, 0 failed'
