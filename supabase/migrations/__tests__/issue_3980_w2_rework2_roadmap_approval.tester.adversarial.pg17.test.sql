-- Issue #3980 synced program, Wave 2 rework 2 -- tester adversarial suite for
-- Bridge D's roadmap approval card (auto_kind roadmap_shipped), on the fully
-- replayed PG17 schema. Angles the implementor's suite does not take:
--   A1  every other way an agent could finish the card is refused while it
--       waits for a person: push back (declined, already_done), the person
--       actions, and a status change to done
--   A2  a person's send back is the only way it leaves To review without
--       closing; an agent sending it back must say why
--   A3  the issue goes Live, not Live, Live again (reopened and closed) after
--       the person closed the card: nothing is drafted again, no second card
--   A4  a second complete record naming the same issue drafts nothing more
--   A5  the draft archived, then published again by a person: the closed card
--       stays as the system closed it, nothing is drafted again
--   A6  a draft that is still a draft never closes the card, and the draft is
--       never published by any bridge run
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

create temp table t3980w2r2t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2r2t_people (who, id, email) values
  ('owner',    '39870000-0000-4000-a000-000000000001', 'oz.w2rt3980@test.local'),
  ('admin',    '39870000-0000-4000-a000-000000000002', 'ivy.w2rt3980@test.local'),
  ('growth',   '39870000-0000-4000-a000-000000000003', 'kim.w2rt3980@test.local'),
  ('support',  '39870000-0000-4000-a000-000000000004', 'sue.w2rt3980@test.local'),
  ('offsupp',  '39870000-0000-4000-a000-000000000005', 'oli.w2rt3980@test.local'),
  ('host',     '39870000-0000-4000-a000-000000000006', 'hal.w2rt3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2r2t_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2rt3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2rt3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2rt3980@test.local', 'growth', 'active', now()),
  ('sue.w2rt3980@test.local', 'growth', 'active', now()),
  ('oli.w2rt3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39870000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39870000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2r2t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2r2t_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2r2t_people where who = p_who;
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

create function pg_temp.t3980w2r2t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r2t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2r2t_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r2t_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2r2t_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2r2t_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2r2t_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2r2t_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r2t_next_request();
  return pg_temp.t3980w2r2t_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2r2t_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r2t_next_request();
  select id, email into strict v_id, v_email from t3980w2r2t_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r2t_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r2t_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
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

create function pg_temp.t3980w2r2t_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2r2t_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2r2t_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2r2t_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2r2t_record(p_pr int, p_extra jsonb default '{}') returns jsonb
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

create function pg_temp.t3980w2r2t_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2r2t_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2r2t_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r2t_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2rt3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2rt3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2r2t_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2r2t_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2r2t_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- A roadmap card linked to an issue that goes Live, so Bridge D drafts a
-- "Recently shipped" card and its approval card. Returns the approval card id.
create function pg_temp.t3980w2r2t_bridge_d(p_n int, p_card uuid, p_title text) returns uuid
language plpgsql as $fn$
declare v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (p_card, p_title, 'Hosts can do the new thing. More words.', 'later', 'published', 900 + p_n % 50);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values (p_card, p_n, 'ivy.w2rt3980@test.local');
  insert into public.ops_github_items (number, kind) values (p_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r2t_ingest(pg_temp.t3980w2r2t_record(90000 + p_n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', p_n, 'relation', 'fixes')))), p_n);
  perform pg_temp.t3980w2r2t_apply(jsonb_build_array(pg_temp.t3980w2r2t_gh(p_n, 'issue', 'Done', null, 'CLOSED')));
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-' || p_n;
  return v_card;
end;
$fn$;

create function pg_temp.t3980w2r2t_draft(p_n int) returns uuid
language sql as $fn$
  select a.entity_id from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = p_n::text
$fn$;

-- ---------------------------------------------------------------------------
-- A1 + A2: an agent cannot finish the card any other way; send back.
-- ---------------------------------------------------------------------------
do $a1$
declare v text; v_card uuid; v_rev bigint;
begin
  v_card := pg_temp.t3980w2r2t_bridge_d(7911, '39870000-0000-4000-c100-000000000011', 'A1 hosts see the new report');
  perform pg_temp.t3980w2r2t_check('A1', 'the approval card waits for a person', (select status from public.ops_work_cards where id = v_card), 'person');

  v := pg_temp.t3980w2r2t_agent('owner', format($q$select public.ops_work_push_back(%L, 'already_done', 'The agent thinks this was already published.', '[{"kind":"text","text":"It is on the roadmap"}]'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r2t_rev(v_card::text)));
  perform pg_temp.t3980w2r2t_like('A1', 'an agent cannot push it back as already done', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r2t_agent('owner', format($q$select public.ops_work_push_back(%L, 'declined', 'The agent thinks hosts do not need to hear this.', '[]'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r2t_rev(v_card::text)));
  perform pg_temp.t3980w2r2t_like('A1', 'an agent cannot push it back as not needed', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r2t_agent('owner', format($q$select public.ops_work_person_action(%L, 'mark_published', 'published', %s)::text$q$, v_card, pg_temp.t3980w2r2t_rev(v_card::text)));
  perform pg_temp.t3980w2r2t_like('A1', 'an agent cannot use a person action', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r2t_agent('owner', format($q$select public.ops_work_update(%L, '{"status":"done"}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r2t_rev(v_card::text)));
  perform pg_temp.t3980w2r2t_check('A1', 'an agent cannot set it to done', (select status from public.ops_work_cards where id = v_card), 'person');
  v := pg_temp.t3980w2r2t_agent('owner', format($q$select public.ops_work_update(%L, '{"status":"todo"}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2r2t_rev(v_card::text)));
  perform pg_temp.t3980w2r2t_like('A2', 'an agent moving it out of To review must say why', v, 'ERR:22023:reason_required:%');
  perform pg_temp.t3980w2r2t_check('A1', 'after every agent attempt it still waits for a person, never closed',
    (select status || ':' || coalesce(close_kind, '-') from public.ops_work_cards where id = v_card), 'person:-');

  -- A person sends it back: it leaves To review open (not closed), nothing is drafted again.
  v := pg_temp.t3980w2r2t_person('owner', format($q$select public.ops_work_person_action(%L, 'send_back', 'Change the wording first, please.', %s)::text$q$, v_card, pg_temp.t3980w2r2t_rev(v_card::text)));
  perform pg_temp.t3980w2r2t_check('A2', 'a person sends it back to To do, still open',
    (select status || ':' || coalesce(person_reason, '-') || ':' || coalesce(close_kind, '-') from public.ops_work_cards where id = v_card), 'todo:-:-');
  v := pg_temp.t3980w2r2t_reconcile();
  perform pg_temp.t3980w2r2t_check('A2', 'the bridges do not draft again or reopen a second card after a send back',
    (select count(*)::text from public.community_audit_log where action = 'draft_roadmap_card' and metadata->>'issue' = '7911')
      || '/' || (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-7911'), '1/1');
  -- Publishing the draft still closes the sent-back card by itself.
  v := pg_temp.t3980w2r2t_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'A1 hosts see the new report', 'Now live: the report.', null, 'shipped', 'published')::text$q$, pg_temp.t3980w2r2t_draft(7911)));
  v := pg_temp.t3980w2r2t_reconcile();
  perform pg_temp.t3980w2r2t_check('A2', 'publishing the draft closes the sent-back card by itself',
    (select status || ':' || close_kind from public.ops_work_cards where id = v_card), 'done:system');
end $a1$;

-- ---------------------------------------------------------------------------
-- A3 + A4: Live, not Live, Live again; a second record for the same issue.
-- ---------------------------------------------------------------------------
do $a3$
declare v text; v_card uuid; v_draft uuid;
begin
  v_card := pg_temp.t3980w2r2t_bridge_d(7912, '39870000-0000-4000-c100-000000000012', 'A3 hosts get faster payouts');
  v_draft := pg_temp.t3980w2r2t_draft(7912);
  v := pg_temp.t3980w2r2t_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Read the draft, publishing it next week"}]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980w2r2t_rev(v_card::text)));
  perform pg_temp.t3980w2r2t_check('A3', 'a person closed it with proof', (select status || ':' || close_kind from public.ops_work_cards where id = v_card), 'done:done');
  -- The issue is reopened (not Live), then closed again (Live).
  v := pg_temp.t3980w2r2t_apply(jsonb_build_array(pg_temp.t3980w2r2t_gh(7912, 'issue', 'In Progress', 'Now', 'OPEN', false, '2026-10-20T10:00:00Z')));
  perform pg_temp.t3980w2r2t_check('A3', 'the reopened issue is not Live', (pg_temp.t3980w2r2t_label(7912) = 'Live')::text, 'false');
  v := pg_temp.t3980w2r2t_apply(jsonb_build_array(pg_temp.t3980w2r2t_gh(7912, 'issue', 'Done', null, 'CLOSED', false, '2026-10-20T11:00:00Z')));
  v := pg_temp.t3980w2r2t_reconcile();
  -- A second complete record naming the same issue.
  perform pg_temp.t3980w2r2t_ingest(pg_temp.t3980w2r2t_record(97912, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', 7912, 'relation', 'fixes')))), 7912);
  v := pg_temp.t3980w2r2t_reconcile();
  perform pg_temp.t3980w2r2t_check('A3', 'Live again and a second record draft nothing more and add no second card',
    (select count(*)::text from public.community_audit_log where action = 'draft_roadmap_card' and metadata->>'issue' = '7912')
      || '/' || (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-7912')
      || '/' || (select count(*)::text from public.community_roadmap_cards where public_title = 'A3 hosts get faster payouts' and status = 'draft'), '1/1/1');
  perform pg_temp.t3980w2r2t_check('A3', 'the card stays as the person closed it, the draft stays a draft',
    (select status || ':' || close_kind || ':' || closed_by from public.ops_work_cards where id = v_card) || ':' || (select status from public.community_roadmap_cards where id = v_draft),
    'done:done:oz.w2rt3980@test.local:draft');
end $a3$;

-- ---------------------------------------------------------------------------
-- A5 + A6: archived then published again; a draft never closes the card.
-- ---------------------------------------------------------------------------
do $a5$
declare v text; v_card uuid; v_draft uuid; v_closed timestamptz; v_reason text;
begin
  v_card := pg_temp.t3980w2r2t_bridge_d(7913, '39870000-0000-4000-c100-000000000013', 'A5 hosts can pause a listing');
  v_draft := pg_temp.t3980w2r2t_draft(7913);
  -- A6: three bridge runs over a draft: the card stays open, the draft stays a draft.
  v := pg_temp.t3980w2r2t_reconcile(); v := pg_temp.t3980w2r2t_reconcile(); v := pg_temp.t3980w2r2t_reconcile();
  perform pg_temp.t3980w2r2t_check('A6', 'a draft never closes the card and no bridge publishes it',
    (select status from public.ops_work_cards where id = v_card) || ':' || (select status || ':' || coalesce(shipped_at::text, '-') from public.community_roadmap_cards where id = v_draft), 'person:draft:-');
  -- A5: archived (not needed), the card closes by itself; then a person publishes the draft after all.
  v := pg_temp.t3980w2r2t_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'A5 hosts can pause a listing', 'Now live: x.', null, 'shipped', 'archived')::text$q$, v_draft));
  v := pg_temp.t3980w2r2t_reconcile();
  select closed_at, close_reason into v_closed, v_reason from public.ops_work_cards where id = v_card;
  perform pg_temp.t3980w2r2t_check('A5', 'archiving closes it by itself', v_reason, 'A person marked the Recently shipped card not needed.');
  v := pg_temp.t3980w2r2t_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'A5 hosts can pause a listing', 'Now live: hosts can pause a listing.', null, 'shipped', 'published')::text$q$, v_draft));
  v := pg_temp.t3980w2r2t_reconcile();
  perform pg_temp.t3980w2r2t_check('A5', 'published after all: the closed card stays as it was, nothing drafted again',
    (select status || ':' || close_kind || ':' || (closed_at = v_closed)::text || ':' || close_reason from public.ops_work_cards where id = v_card)
      || '/' || (select count(*)::text from public.community_audit_log where action = 'draft_roadmap_card' and metadata->>'issue' = '7913'),
    'done:system:true:A person marked the Recently shipped card not needed./1');
end $a5$;

select count(*) as t3980w2r2t_total, count(*) filter (where not ok) as t3980w2r2t_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2r2t_failures
  from t3980w2r2t_results \gset
rollback;

select (:t3980w2r2t_total < 17 or :t3980w2r2t_failed > 0) as t3980w2r2t_bad \gset
\if :t3980w2r2t_bad
  \echo 'ISSUE-3980 W2 REWORK 2 ROADMAP APPROVAL TESTER FAILED:' :t3980w2r2t_failed 'of' :t3980w2r2t_total
  \echo :t3980w2r2t_failures
  do $$ begin raise exception 'ISSUE-3980 W2 REWORK 2 ROADMAP APPROVAL TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 W2 REWORK 2 ROADMAP APPROVAL TESTER PASS:' :t3980w2r2t_total 'checks, 0 failed'
