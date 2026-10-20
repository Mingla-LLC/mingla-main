-- Issue #3980 synced program, Wave 2 rework 2 -- the server side of the
-- tester's P2, on the fully replayed PG17 schema. Bridge D's approval card
-- (auto_kind roadmap_shipped) asks a person to publish or archive a drafted
-- "Recently shipped" roadmap card. "Mark published" checks that an EVENT is
-- public, so it can never work on it; Admin now offers "Open the draft in
-- Roadmap" and "Close with proof" instead. Each check is recorded and
-- reported together:
--   H1  the approval card waits in To review with auto_kind roadmap_shipped
--       and the roadmap card linked (what Admin groups and links by)
--   H2  a person closes it with proof; an agent cannot; nothing drafts again
--       afterwards, and a later publish of the draft leaves the closed card
--       as the person closed it
--   H3  it still closes itself when a person archives the draft (not needed)
--       or publishes it
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

create temp table t3980w2r2_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2r2_people (who, id, email) values
  ('owner',    '39860000-0000-4000-a000-000000000001', 'oz.w2rr3980@test.local'),
  ('admin',    '39860000-0000-4000-a000-000000000002', 'ivy.w2rr3980@test.local'),
  ('growth',   '39860000-0000-4000-a000-000000000003', 'kim.w2rr3980@test.local'),
  ('support',  '39860000-0000-4000-a000-000000000004', 'sue.w2rr3980@test.local'),
  ('offsupp',  '39860000-0000-4000-a000-000000000005', 'oli.w2rr3980@test.local'),
  ('host',     '39860000-0000-4000-a000-000000000006', 'hal.w2rr3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2r2_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2rr3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2rr3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2rr3980@test.local', 'growth', 'active', now()),
  ('sue.w2rr3980@test.local', 'growth', 'active', now()),
  ('oli.w2rr3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39860000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39860000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2r2_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2r2_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2r2_people where who = p_who;
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

create function pg_temp.t3980w2r2_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r2_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2r2_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r2_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2r2_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2r2_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2r2_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2r2_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r2_next_request();
  return pg_temp.t3980w2r2_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2r2_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r2_next_request();
  select id, email into strict v_id, v_email from t3980w2r2_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r2_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r2_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
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

create function pg_temp.t3980w2r2_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2r2_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2r2_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2r2_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2r2_record(p_pr int, p_extra jsonb default '{}') returns jsonb
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

create function pg_temp.t3980w2r2_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2r2_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2r2_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r2_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2rr3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2rr3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2r2_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2r2_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2r2_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- A roadmap card linked to an issue that goes Live, so Bridge D drafts a
-- "Recently shipped" card and its approval card. Returns the approval card id.
create function pg_temp.t3980w2r2_bridge_d(p_n int, p_card uuid, p_title text) returns uuid
language plpgsql as $fn$
declare v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (p_card, p_title, 'Hosts can do the new thing. More words.', 'later', 'published', 900 + p_n % 50);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values (p_card, p_n, 'ivy.w2rr3980@test.local');
  insert into public.ops_github_items (number, kind) values (p_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r2_ingest(pg_temp.t3980w2r2_record(90000 + p_n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', p_n, 'relation', 'fixes')))), p_n);
  perform pg_temp.t3980w2r2_apply(jsonb_build_array(pg_temp.t3980w2r2_gh(p_n, 'issue', 'Done', null, 'CLOSED')));
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-' || p_n;
  return v_card;
end;
$fn$;

create function pg_temp.t3980w2r2_draft(p_n int) returns uuid
language sql as $fn$
  select a.entity_id from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = p_n::text
$fn$;

-- ---------------------------------------------------------------------------
-- H1 + H2: a person closes the approval card with proof.
-- ---------------------------------------------------------------------------
do $h2$
declare v text; v_card uuid; v_draft uuid; v_closed_at timestamptz;
begin
  v_card := pg_temp.t3980w2r2_bridge_d(7811, '39860000-0000-4000-c100-000000000011', 'H2 hosts see payouts sooner');
  v_draft := pg_temp.t3980w2r2_draft(7811);
  perform pg_temp.t3980w2r2_check('H1', 'Bridge D drafted the card and its approval card',
    (v_draft is not null)::text || ':' || coalesce((select status || ':' || person_reason from public.ops_work_cards where id = v_card), '<none>'), 'true:person:publish');
  v := pg_temp.t3980w2r2_person('owner', 'select public.ops_review_list(null)::text');
  perform pg_temp.t3980w2r2_check('H1', 'To review lists it with auto_kind roadmap_shipped and the drafted roadmap card linked',
    (select c->>'auto_kind' || ':' || (c->'links' @> jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_draft)))::text
       from jsonb_array_elements(pg_temp.t3980w2r2_j(v)->'cards') c where c->>'id' = v_card::text), 'roadmap_shipped:true');

  -- The path Admin no longer offers: "Mark published" checks an event, and this card has none.
  v := pg_temp.t3980w2r2_person('owner', format($q$select public.ops_work_person_action(%L, 'mark_published', null, %s)::text$q$, v_card, pg_temp.t3980w2r2_rev(v_card::text)));
  perform pg_temp.t3980w2r2_like('H2', 'Mark published can never close it (no event)', v, 'ERR:22023:not_public_yet:%');

  -- An agent cannot close a card that waits for a person.
  v := pg_temp.t3980w2r2_agent('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"The agent says it is published"}]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980w2r2_rev(v_card::text)));
  perform pg_temp.t3980w2r2_like('H2', 'an agent cannot close it', v, 'ERR:42501:people_only:%');

  -- A person can, with proof.
  v := pg_temp.t3980w2r2_person('owner', format($q$select public.ops_work_close(%L, '[]'::jsonb, null, %s)::text$q$, v_card, pg_temp.t3980w2r2_rev(v_card::text)));
  perform pg_temp.t3980w2r2_like('H2', 'closing needs at least one line of proof', v, 'ERR:22023:proof_required:%');
  v := pg_temp.t3980w2r2_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Published the Recently shipped card on the roadmap"}]'::jsonb, 'Checked the wording first.', %s)::text$q$, v_card, pg_temp.t3980w2r2_rev(v_card::text)));
  perform pg_temp.t3980w2r2_check('H2', 'a person closes it with proof',
    pg_temp.t3980w2r2_get(v, 'card', 'status') || ':' || (select close_kind || ':' || closed_by || ':' || coalesce(closed_via, 'person') || ':' || (proof->0->>'text') from public.ops_work_cards where id = v_card),
    'done:done:oz.w2rr3980@test.local:person:Published the Recently shipped card on the roadmap');
  select closed_at into v_closed_at from public.ops_work_cards where id = v_card;

  perform pg_temp.t3980w2r2_reconcile();
  perform pg_temp.t3980w2r2_check('H2', 'nothing drafts again after the person closed it',
    (select count(*)::text from public.community_audit_log where action = 'draft_roadmap_card' and metadata->>'issue' = '7811')
      || '/' || (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-7811'), '1/1');

  -- The draft is published later: the card the person closed stays as they closed it.
  v := pg_temp.t3980w2r2_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'H2 hosts see payouts sooner', 'Now live: payouts land sooner.', null, 'shipped', 'published')::text$q$, v_draft));
  v := pg_temp.t3980w2r2_reconcile();
  perform pg_temp.t3980w2r2_check('H2', 'a later publish leaves the closed card as the person closed it',
    (select status || ':' || close_kind || ':' || closed_by || ':' || (closed_at = v_closed_at)::text from public.ops_work_cards where id = v_card),
    'done:done:oz.w2rr3980@test.local:true');
end $h2$;

-- ---------------------------------------------------------------------------
-- H3: it still closes itself when the draft is archived or published.
-- ---------------------------------------------------------------------------
do $h3$
declare v text; v_archived uuid; v_published uuid; v_d1 uuid; v_d2 uuid;
begin
  v_archived := pg_temp.t3980w2r2_bridge_d(7812, '39860000-0000-4000-c100-000000000012', 'H3 not needed after all');
  v_published := pg_temp.t3980w2r2_bridge_d(7813, '39860000-0000-4000-c100-000000000013', 'H3 hosts get the new thing');
  v_d1 := pg_temp.t3980w2r2_draft(7812);
  v_d2 := pg_temp.t3980w2r2_draft(7813);
  perform pg_temp.t3980w2r2_check('H3', 'two approval cards wait for a person',
    (select string_agg(status, ',' order by auto_key) from public.ops_work_cards where id in (v_archived, v_published)), 'person,person');
  v := pg_temp.t3980w2r2_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'H3 not needed after all', 'Now live: x.', null, 'shipped', 'archived')::text$q$, v_d1));
  v := pg_temp.t3980w2r2_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'H3 hosts get the new thing', 'Now live: the new thing.', null, 'shipped', 'published')::text$q$, v_d2));
  v := pg_temp.t3980w2r2_reconcile();
  perform pg_temp.t3980w2r2_check('H3', 'archiving the draft closes its approval card by itself',
    (select status || ':' || close_kind || ':' || coalesce(close_reason, '-') from public.ops_work_cards where id = v_archived),
    'done:system:A person marked the Recently shipped card not needed.');
  perform pg_temp.t3980w2r2_check('H3', 'publishing the draft closes its approval card by itself',
    (select status || ':' || close_kind || ':' || coalesce(close_reason, '-') from public.ops_work_cards where id = v_published),
    'done:system:A person published the Recently shipped card.');
end $h3$;

select count(*) as t3980w2r2_total, count(*) filter (where not ok) as t3980w2r2_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2r2_failures
  from t3980w2r2_results \gset
rollback;

select (:t3980w2r2_total < 11 or :t3980w2r2_failed > 0) as t3980w2r2_bad \gset
\if :t3980w2r2_bad
  \echo 'ISSUE-3980 SYNCED WAVE 2 REWORK 2 FAILED:' :t3980w2r2_failed 'of' :t3980w2r2_total
  \echo :t3980w2r2_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 2 REWORK 2 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 2 REWORK 2 PASS:' :t3980w2r2_total 'checks, 0 failed'
