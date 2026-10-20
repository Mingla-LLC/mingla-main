-- Issue #3980 synced program, Wave 2 rework 4 -- the tester's P1 and P2 on
-- the fully replayed PG17 schema. A "Recently shipped" approval card
-- (auto_key roadmap_shipped:issue-<n>) is tied to its draft by what Bridge D
-- recorded, never by an editable link, and no agent request can change what
-- decides whether it is open, closed or tied to its draft. Each check is
-- recorded and reported together:
--   T1  the tie: a PERSON swapping the card's roadmap link to a published
--       card, or adding one, then housekeeping: the card stays open and the
--       unreviewed draft stays a draft
--   T2  the tie: a person removes the link and publishes the draft:
--       housekeeping closes the card (system); archiving another draft as not
--       needed closes its card with the "not needed" words
--   T3  through the real gateway (ops_agent_call with a hashed key): an agent
--       swapping, adding or removing a roadmap link, adding a GitHub link, or
--       blocking the card is people_only; nothing changed; housekeeping
--       keeps the card open
--   T4  start_work: an agent starting the card while it waits for a person,
--       after a person sent it back, or after a person started it, is
--       people_only with no working mark; a person can still start it
--   T5  the backstop under every writer: in an agent's request, direct
--       writes to the card (status, close, auto_key, blocked, anchor,
--       working mark), its links and its GitHub links are refused
--       (people_only); its wording and result are not; a reopen stays
--       allowed; an agent cannot create such a card. The same writes as a
--       person, or by the bridges (no signed-in person), are not refused
--   T6  the agent's own plain card is unaffected: links, start, close
--   T7  an agent can still write a result on the approval card (gateway)
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

create temp table t3980w2r4i_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2r4i_people (who, id, email) values
  ('owner',    '39882000-0000-4000-a000-000000000001', 'oz.w2r4i3980@test.local'),
  ('admin',    '39882000-0000-4000-a000-000000000002', 'ivy.w2r4i3980@test.local'),
  ('growth',   '39882000-0000-4000-a000-000000000003', 'kim.w2r4i3980@test.local'),
  ('support',  '39882000-0000-4000-a000-000000000004', 'sue.w2r4i3980@test.local'),
  ('offsupp',  '39882000-0000-4000-a000-000000000005', 'oli.w2r4i3980@test.local'),
  ('host',     '39882000-0000-4000-a000-000000000006', 'hal.w2r4i3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2r4i_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2r4i3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2r4i3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2r4i3980@test.local', 'growth', 'active', now()),
  ('sue.w2r4i3980@test.local', 'growth', 'active', now()),
  ('oli.w2r4i3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39882000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39882000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2r4i_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2r4i_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2r4i_people where who = p_who;
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

create function pg_temp.t3980w2r4i_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r4i_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2r4i_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2r4i_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2r4i_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2r4i_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2r4i_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2r4i_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r4i_next_request();
  return pg_temp.t3980w2r4i_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2r4i_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r4i_next_request();
  select id, email into strict v_id, v_email from t3980w2r4i_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r4i_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r4i_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
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

create function pg_temp.t3980w2r4i_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2r4i_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2r4i_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2r4i_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2r4i_record(p_pr int, p_extra jsonb default '{}') returns jsonb
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

create function pg_temp.t3980w2r4i_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2r4i_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2r4i_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r4i_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2r4i3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2r4i3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2r4i_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2r4i_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2r4i_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- A roadmap card linked to an issue that goes Live, so Bridge D drafts a
-- "Recently shipped" card and its approval card. Returns the approval card id.
create function pg_temp.t3980w2r4i_bridge_d(p_n int, p_card uuid, p_title text) returns uuid
language plpgsql as $fn$
declare v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (p_card, p_title, 'Hosts can do the new thing. More words.', 'later', 'published', 900 + p_n % 50);
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values (p_card, p_n, 'ivy.w2r4i3980@test.local');
  insert into public.ops_github_items (number, kind) values (p_n, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2r4i_ingest(pg_temp.t3980w2r4i_record(90000 + p_n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', p_n, 'relation', 'fixes')))), p_n);
  perform pg_temp.t3980w2r4i_apply(jsonb_build_array(pg_temp.t3980w2r4i_gh(p_n, 'issue', 'Done', null, 'CLOSED')));
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-' || p_n;
  return v_card;
end;
$fn$;

create function pg_temp.t3980w2r4i_draft(p_n int) returns uuid
language sql as $fn$
  select a.entity_id from public.community_audit_log a
   where a.action = 'draft_roadmap_card' and a.metadata->>'source' = 'issue_3980_bridge_d' and a.metadata->>'issue' = p_n::text
$fn$;


create temp table t3980w2r4i_keys (who text primary key, k text) on commit drop;

create function pg_temp.t3980w2r4i_newkey(p_who text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2r4i_person(p_who, $q$select public.team_agent_key_create('claude')::text$q$);
  insert into t3980w2r4i_keys (who, k) values (p_who, pg_temp.t3980w2r4i_j(v)->>'key')
  on conflict (who) do update set k = excluded.k;
  return v;
end;
$fn$;

-- One connector call through the work gateway, exactly as team-agent makes it.
create function pg_temp.t3980w2r4i_mcp(p_who text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2r4i_next_request();
  return pg_temp.t3980w2r4i_as('service', format('select public.ops_agent_call(%L, %L, %L::jsonb, %L)::text',
    (select encode(sha256(convert_to(k, 'UTF8')), 'hex') from t3980w2r4i_keys where who = p_who), p_tool, p_args, 'issue3980-r4-implementor/1.0'));
end;
$fn$;

-- A raw statement run as supabase_admin (any writer, guarded or not) while
-- the request is a person's connected agent: the gateway's request row for
-- this person in this transaction, and the person's JWT.
create function pg_temp.t3980w2r4i_raw_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r4i_next_request();
  select id, email into strict v_id, v_email from t3980w2r4i_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2r4i_raw(v_id, v_email, p_sql);
end;
$fn$;

-- The same raw statement as the person (no agent request row), or with no
-- signed-in person at all (the bridges and housekeeping) when p_who is null.
create function pg_temp.t3980w2r4i_raw_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2r4i_next_request();
  if p_who is not null then
    select id, email into strict v_id, v_email from t3980w2r4i_people where who = p_who;
  end if;
  return pg_temp.t3980w2r4i_raw(v_id, v_email, p_sql);
end;
$fn$;

create function pg_temp.t3980w2r4i_raw(p_id uuid, p_email text, p_sql text) returns text
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

create function pg_temp.t3980w2r4i_state(p_card uuid) returns text
language sql as $fn$
  select status || ':' || coalesce(close_kind, '-') || ':' || coalesce(closed_via, '-') from public.ops_work_cards where id = p_card
$fn$;

create function pg_temp.t3980w2r4i_links(p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(kind || ':' || target_id::text, ',' order by kind, target_id), '-') from public.ops_work_links where card_id = p_card
$fn$;

create function pg_temp.t3980w2r4i_bridges() returns text
language sql as $fn$ select pg_temp.t3980w2r4i_as('service', 'select public.ops_github_bridges()::text') $fn$;

do $r$
declare v text; v_key text; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid; v_c6 uuid; v_plain uuid;
        v_pub uuid := '39882000-0000-4000-c100-0000000000aa'; v_links text; v_rev bigint;
        c_po constant text := '%"ok": false%"token": "people_only"%';
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order)
  values (v_pub, 'R4 an old card hosts already saw', 'Already out.', 'later', 'published', 990);
  v_key := pg_temp.t3980w2r4i_newkey('owner');
  perform pg_temp.t3980w2r4i_like('K', 'the owner connects an agent key', v_key, '%"key"%');

  -- T1: the tie is what Bridge D recorded, not the card's links (a person may edit them).
  v_c1 := pg_temp.t3980w2r4i_bridge_d(7951, '39882000-0000-4000-c100-000000000051', 'T1 hosts see the new report');
  perform pg_temp.t3980w2r4i_check('T1', 'the approval card waits for a person', pg_temp.t3980w2r4i_state(v_c1), 'person:-:-');
  perform pg_temp.t3980w2r4i_check('T1', 'the tie names the draft Bridge D recorded',
    (select public.ops_roadmap_shipped_draft(auto_key)::text from public.ops_work_cards where id = v_c1), pg_temp.t3980w2r4i_draft(7951)::text);
  v := pg_temp.t3980w2r4i_person('owner', format($q$select public.ops_work_update(%L, %L::jsonb, %s)::text$q$, v_c1,
         jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_pub))), pg_temp.t3980w2r4i_rev(v_c1::text)));
  perform pg_temp.t3980w2r4i_check('T1', 'a person can swap the link', pg_temp.t3980w2r4i_links(v_c1), 'roadmap_card:' || v_pub);
  perform pg_temp.t3980w2r4i_bridges();
  perform pg_temp.t3980w2r4i_check('T1', 'after a swap to a published card and housekeeping, the card is still open', pg_temp.t3980w2r4i_state(v_c1), 'person:-:-');
  perform pg_temp.t3980w2r4i_check('T1', 'the unreviewed draft is still a draft',
    (select status from public.community_roadmap_cards where id = pg_temp.t3980w2r4i_draft(7951)), 'draft');
  v := pg_temp.t3980w2r4i_person('owner', format($q$select public.ops_work_update(%L, %L::jsonb, %s)::text$q$, v_c1,
         jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_pub),
           jsonb_build_object('kind', 'roadmap_card', 'id', pg_temp.t3980w2r4i_draft(7951)))), pg_temp.t3980w2r4i_rev(v_c1::text)));
  perform pg_temp.t3980w2r4i_bridges();
  perform pg_temp.t3980w2r4i_check('T1', 'with its own draft and a published card linked, housekeeping still keeps it open', pg_temp.t3980w2r4i_state(v_c1), 'person:-:-');
  perform pg_temp.t3980w2r4i_check('T1', 'a card made by hand never gets a draft tie',
    (select public.ops_roadmap_shipped_draft(null)::text), null);
  perform pg_temp.t3980w2r4i_check('T1', 'a key of another kind never gets a draft tie',
    (select public.ops_roadmap_shipped_draft('eng_no_issue:issue-7951')::text), null);

  -- T2: a person removes the link, then publishes the draft: the card closes itself.
  v_c2 := pg_temp.t3980w2r4i_bridge_d(7952, '39882000-0000-4000-c100-000000000052', 'T2 hosts can copy an event');
  v := pg_temp.t3980w2r4i_person('owner', format($q$select public.ops_work_update(%L, '{"links":[]}'::jsonb, %s)::text$q$, v_c2, pg_temp.t3980w2r4i_rev(v_c2::text)));
  perform pg_temp.t3980w2r4i_check('T2', 'a person removed the link', pg_temp.t3980w2r4i_links(v_c2), '-');
  perform pg_temp.t3980w2r4i_bridges();
  perform pg_temp.t3980w2r4i_check('T2', 'the draft is not published yet, so the card stays open', pg_temp.t3980w2r4i_state(v_c2), 'person:-:-');
  update public.community_roadmap_cards set status = 'published' where id = pg_temp.t3980w2r4i_draft(7952);
  perform pg_temp.t3980w2r4i_bridges();
  perform pg_temp.t3980w2r4i_check('T2', 'a person published the draft; housekeeping closes the card with no link left',
    pg_temp.t3980w2r4i_state(v_c2), 'done:system:system');
  perform pg_temp.t3980w2r4i_check('T2', 'it says a person published it',
    (select close_reason from public.ops_work_cards where id = v_c2), 'A person published the Recently shipped card.');
  v_c3 := pg_temp.t3980w2r4i_bridge_d(7953, '39882000-0000-4000-c100-000000000053', 'T2 hosts can pause a listing');
  update public.community_roadmap_cards set status = 'archived' where id = pg_temp.t3980w2r4i_draft(7953);
  perform pg_temp.t3980w2r4i_bridges();
  perform pg_temp.t3980w2r4i_check('T2', 'a person archived the draft; housekeeping closes the card as not needed',
    (select status || ':' || close_reason from public.ops_work_cards where id = v_c3), 'done:A person marked the Recently shipped card not needed.');

  -- T3: an agent through the real gateway may not change what the card links to or waits for.
  v_c4 := pg_temp.t3980w2r4i_bridge_d(7954, '39882000-0000-4000-c100-000000000054', 'T3 hosts can export guests');
  v_links := pg_temp.t3980w2r4i_links(v_c4);
  perform pg_temp.t3980w2r4i_check('T3', 'the approval card links its draft', v_links, 'roadmap_card:' || pg_temp.t3980w2r4i_draft(7954));
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text),
         'changes', jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_pub)))));
  perform pg_temp.t3980w2r4i_like('T3', 'MCP swapping the roadmap link is people_only', v, c_po);
  perform pg_temp.t3980w2r4i_like('T3', 'the refusal names links (the update guard, not only the backstop)', v, '%changes what this card links to or waits for%');
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text),
         'changes', jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', pg_temp.t3980w2r4i_draft(7954)),
                                                                  jsonb_build_object('kind', 'roadmap_card', 'id', v_pub)))));
  perform pg_temp.t3980w2r4i_like('T3', 'MCP adding a second roadmap link is people_only', v, c_po);
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text),
         'changes', jsonb_build_object('links', '[]'::jsonb)));
  perform pg_temp.t3980w2r4i_like('T3', 'MCP removing the roadmap link is people_only', v, c_po);
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text),
         'changes', jsonb_build_object('github', jsonb_build_array('#7954', '#7999'))));
  perform pg_temp.t3980w2r4i_like('T3', 'MCP adding a GitHub link is people_only', v, c_po);
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text),
         'changes', jsonb_build_object('blocked', true, 'blocked_reason', 'Waiting for the agent to decide.')));
  perform pg_temp.t3980w2r4i_like('T3', 'MCP blocking the card is people_only', v, c_po);
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text),
         'changes', jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', pg_temp.t3980w2r4i_draft(7954)))),
         'title', 'ignored'));
  perform pg_temp.t3980w2r4i_like('T3', 'MCP sending the same link back is not a change', v, '%"ok": true%');
  perform pg_temp.t3980w2r4i_check('T3', 'after every attempt the links are unchanged', pg_temp.t3980w2r4i_links(v_c4), v_links);
  perform pg_temp.t3980w2r4i_check('T3', 'and the GitHub links and block too',
    (select coalesce(string_agg(number::text, ','), '-') from public.ops_work_github where card_id = v_c4) || ':' ||
    (select blocked::text from public.ops_work_cards where id = v_c4), '7954:false');
  perform pg_temp.t3980w2r4i_bridges();
  perform pg_temp.t3980w2r4i_check('T3', 'housekeeping keeps the unreviewed card open', pg_temp.t3980w2r4i_state(v_c4), 'person:-:-');

  -- T4: start_work is a person's on this card, in every status.
  v := pg_temp.t3980w2r4i_mcp('owner', 'start_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text)));
  perform pg_temp.t3980w2r4i_like('T4', 'MCP start_work while it waits for a person is people_only', v, c_po);
  v := pg_temp.t3980w2r4i_person('owner', format($q$select public.ops_work_person_action(%L, 'send_back', 'Change the wording first, please.', %s)::text$q$, v_c4, pg_temp.t3980w2r4i_rev(v_c4::text)));
  perform pg_temp.t3980w2r4i_check('T4', 'a person sent it back to To do', pg_temp.t3980w2r4i_state(v_c4), 'todo:-:-');
  v := pg_temp.t3980w2r4i_mcp('owner', 'start_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text)));
  perform pg_temp.t3980w2r4i_like('T4', 'MCP start_work on the sent-back card is people_only', v, c_po);
  perform pg_temp.t3980w2r4i_like('T4', 'the refusal is start_work''s own', v, '%Only a person starts this card%');
  perform pg_temp.t3980w2r4i_check('T4', 'the card is still in To do with no working mark',
    (select status || ':' || coalesce(working_by, '-') || ':' || coalesce(working_via, '-') from public.ops_work_cards where id = v_c4), 'todo:-:-');
  v := pg_temp.t3980w2r4i_agent('owner', format($q$select public.ops_work_start(%L, %s)::text$q$, v_c4, pg_temp.t3980w2r4i_rev(v_c4::text)));
  perform pg_temp.t3980w2r4i_like('T4', 'an agent calling ops_work_start directly is people_only', v, 'ERR:42501:people_only: A person approves what hosts are told. Only a person starts this card.');
  v := pg_temp.t3980w2r4i_person('owner', format($q$select public.ops_work_start(%L, %s)::text$q$, v_c4, pg_temp.t3980w2r4i_rev(v_c4::text)));
  perform pg_temp.t3980w2r4i_check('T4', 'a person starts it',
    (select status || ':' || coalesce(working_by, '-') || ':' || coalesce(working_via, '-') from public.ops_work_cards where id = v_c4), 'doing:oz.w2r4i3980@test.local:-');
  v := pg_temp.t3980w2r4i_mcp('owner', 'start_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text)));
  perform pg_temp.t3980w2r4i_like('T4', 'MCP start_work on the card a person started is people_only (no takeover)', v, c_po);
  perform pg_temp.t3980w2r4i_check('T4', 'the person is still the one working on it',
    (select status || ':' || coalesce(working_by, '-') || ':' || coalesce(working_via, '-') from public.ops_work_cards where id = v_c4), 'doing:oz.w2r4i3980@test.local:-');

  -- T7: the agent can still write a result on it through the gateway.
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_c4, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c4::text),
         'changes', jsonb_build_object('result', 'Suggested wording: hosts can export their guest list.')));
  perform pg_temp.t3980w2r4i_like('T7', 'MCP writing a result is allowed', v, '%"ok": true%');
  perform pg_temp.t3980w2r4i_check('T7', 'the result is saved', (select result from public.ops_work_cards where id = v_c4), 'Suggested wording: hosts can export their guest list.');

  -- T5: the backstop under every writer. Raw writes in an agent's request.
  v_c5 := pg_temp.t3980w2r4i_bridge_d(7955, '39882000-0000-4000-c100-000000000055', 'T5 hosts can tag guests');
  v_rev := pg_temp.t3980w2r4i_rev(v_c5::text);
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set status = 'done', close_kind = 'done', closed_at = now(), closed_by = 'oz.w2r4i3980@test.local', closed_via = 'claude' where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent close is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set status = 'todo', person_reason = null where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent status move is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set person_reason = 'other' where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent person_reason change is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set auto_key = 'roadmap_shipped:issue-7951' where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent change of the key is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set auto_key = null where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent removal of the key is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set blocked = true, blocked_kind = 'manual', blocked_reason = 'Agent blocks it now.' where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent block is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set anchor_kind = 'event', anchor_id = gen_random_uuid() where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent anchor change is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set working_by = 'oz.w2r4i3980@test.local', working_via = 'claude' where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent working mark is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set archived_at = now() where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent archive is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$insert into public.ops_work_links (card_id, kind, target_id, label, added_by, added_via) values (%L, 'roadmap_card', %L, 'Old card', 'oz.w2r4i3980@test.local', 'claude')$q$, v_c5, v_pub));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent link insert is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$delete from public.ops_work_links where card_id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent link delete is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_links set target_id = %L where card_id = %L$q$, v_pub, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent link re-point is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_links set label = 'T5 hosts can tag guests (again)' where card_id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_check('T5', 'a label refresh of the same link is not a change', v, 'OK');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$insert into public.ops_work_github (card_id, kind, number, added_by, added_via) values (%L, 'issue', 7998, 'oz.w2r4i3980@test.local', 'claude')$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent GitHub link insert is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$delete from public.ops_work_github where card_id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'a raw agent GitHub link delete is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$insert into public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan, created_by, created_via, updated_by, updated_via, auto_key)
         select 'T5 fake approval card', instructions, done_means, 'todo', 'task', current_date + 3, 'explicit', sprint_id, '[]'::jsonb, 'oz.w2r4i3980@test.local', 'claude', 'oz.w2r4i3980@test.local', 'claude', 'roadmap_shipped:issue-7997' from public.ops_work_cards where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_like('T5', 'an agent cannot create such a card', v, 'ERR:42501:people_only:%');
  perform pg_temp.t3980w2r4i_check('T5', 'after every raw agent write the card is as it was',
    (select status || ':' || coalesce(person_reason, '-') || ':' || coalesce(auto_key, '-') || ':' || blocked::text || ':' || coalesce(working_by, '-') || ':' || (archived_at is null)::text || ':' || revision::text
       from public.ops_work_cards where id = v_c5), 'person:publish:roadmap_shipped:issue-7955:false:-:true:' || v_rev);
  perform pg_temp.t3980w2r4i_check('T5', 'and its links and GitHub links too',
    pg_temp.t3980w2r4i_links(v_c5) || '|' || (select coalesce(string_agg(number::text, ','), '-') from public.ops_work_github where card_id = v_c5),
    'roadmap_card:' || pg_temp.t3980w2r4i_draft(7955) || '|7955');
  v := pg_temp.t3980w2r4i_raw_agent('owner', format($q$update public.ops_work_cards set title = 'T5 hosts can tag their guests', result = 'Agent note' where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_check('T5', 'a raw agent wording and result change is allowed', v, 'OK');
  -- The same writes as the person (no agent request) and by the bridges are not refused.
  v := pg_temp.t3980w2r4i_raw_person('owner', format($q$insert into public.ops_work_links (card_id, kind, target_id, label, added_by) values (%L, 'roadmap_card', %L, 'Old card', 'oz.w2r4i3980@test.local')$q$, v_c5, v_pub));
  perform pg_temp.t3980w2r4i_check('T5', 'the same link insert as the person is allowed', v, 'OK');
  v := pg_temp.t3980w2r4i_raw_person(null, format($q$delete from public.ops_work_links where card_id = %L and target_id = %L$q$, v_c5, v_pub));
  perform pg_temp.t3980w2r4i_check('T5', 'a link delete with no signed-in person (bridges) is allowed', v, 'OK');
  v := pg_temp.t3980w2r4i_raw_person('owner', format($q$update public.ops_work_cards set status = 'done', person_reason = null, close_kind = 'done', closed_at = now(), closed_by = 'oz.w2r4i3980@test.local' where id = %L$q$, v_c5));
  perform pg_temp.t3980w2r4i_check('T5', 'the same close as the person is allowed', v, 'OK');
  -- A reopen in an agent's request only reopens: allowed.
  v := pg_temp.t3980w2r4i_agent('owner', format($q$select public.ops_work_reopen(%L, 'Looking at it again.', %s)::text$q$, v_c5, pg_temp.t3980w2r4i_rev(v_c5::text)));
  perform pg_temp.t3980w2r4i_check('T5', 'an agent reopen still reopens it', pg_temp.t3980w2r4i_state(v_c5), 'todo:-:-');
  v := pg_temp.t3980w2r4i_mcp('owner', 'close_work', jsonb_build_object('id', v_c5, 'expected_revision', pg_temp.t3980w2r4i_rev(v_c5::text),
         'proof', '[{"kind":"text","text":"Agent closes it"}]'::jsonb));
  perform pg_temp.t3980w2r4i_like('T5', 'and still cannot close it', v, c_po);
  -- The system closes it once its draft is published, even in the same transaction as an agent's request.
  update public.community_roadmap_cards set status = 'published' where id = pg_temp.t3980w2r4i_draft(7955);
  perform pg_temp.t3980w2r4i_bridges();
  perform pg_temp.t3980w2r4i_check('T5', 'housekeeping (no signed-in person) still closes it', pg_temp.t3980w2r4i_state(v_c5), 'done:system:system');

  -- T6: the agent's own plain card is unaffected.
  v := pg_temp.t3980w2r4i_mcp('owner', 'add_work', jsonb_build_object('request_key', 'r4i-plain-mcp-1', 'cards', jsonb_build_array(jsonb_build_object(
         'title', 'T6 plain card the agent may finish', 'instructions', 'Do the plain thing.', 'done_means', 'It is done.',
         'owners', jsonb_build_array('oz.w2r4i3980@test.local'), 'due_on', ((now() AT TIME ZONE 'UTC')::date + 3)::text))));
  v_plain := (pg_temp.t3980w2r4i_j(v) #>> '{result,results,0,card,id}')::uuid;
  v := pg_temp.t3980w2r4i_mcp('owner', 'update_work', jsonb_build_object('id', v_plain, 'expected_revision', pg_temp.t3980w2r4i_rev(v_plain::text),
         'changes', jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_pub)), 'github', jsonb_build_array('#7996'))));
  perform pg_temp.t3980w2r4i_check('T6', 'the agent links its plain card', pg_temp.t3980w2r4i_links(v_plain), 'roadmap_card:' || v_pub);
  v := pg_temp.t3980w2r4i_mcp('owner', 'start_work', jsonb_build_object('id', v_plain, 'expected_revision', pg_temp.t3980w2r4i_rev(v_plain::text)));
  perform pg_temp.t3980w2r4i_check('T6', 'the agent starts its plain card', (select status || ':' || coalesce(working_via, '-') from public.ops_work_cards where id = v_plain), 'doing:claude');
  v := pg_temp.t3980w2r4i_mcp('owner', 'close_work', jsonb_build_object('id', v_plain, 'expected_revision', pg_temp.t3980w2r4i_rev(v_plain::text),
         'proof', '[{"kind":"text","text":"Done by the agent"}]'::jsonb));
  perform pg_temp.t3980w2r4i_check('T6', 'the agent closes its plain card', pg_temp.t3980w2r4i_state(v_plain), 'done:done:claude');
end $r$;

select count(*) as t3980w2r4i_total, count(*) filter (where not ok) as t3980w2r4i_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2r4i_failures
  from t3980w2r4i_results \gset
rollback;

select (:t3980w2r4i_total < 60 or :t3980w2r4i_failed > 0) as t3980w2r4i_bad \gset
\if :t3980w2r4i_bad
  \echo 'ISSUE-3980 W2 REWORK 4 ROADMAP TIE FAILED:' :t3980w2r4i_failed 'of' :t3980w2r4i_total
  \echo :t3980w2r4i_failures
  do $$ begin raise exception 'ISSUE-3980 W2 REWORK 4 ROADMAP TIE FAIL'; end $$;
\endif
\echo 'ISSUE-3980 W2 REWORK 4 ROADMAP TIE PASS:' :t3980w2r4i_total 'checks, 0 failed'
