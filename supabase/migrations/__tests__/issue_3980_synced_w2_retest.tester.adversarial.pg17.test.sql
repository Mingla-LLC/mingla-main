-- Issue #3980 synced program, Wave 2 rework -- the tester's RETEST suite, on
-- the fully replayed PG17 schema. Angles the implementor's rework suite does
-- not take:
--   X1  the race path of ops_roadmap_link_set: when the check finds no other
--       card but the insert hits the unique issue index (another session's
--       link landed in between), the caller is told issue_taken in plain
--       words, never a raw duplicate-key error, and still only one card
--       holds the issue. A link row the check cannot see stands in for the
--       other session's row inside this one transaction.
--   X2  an agent cannot change what a waiting card waits for even when it
--       also says "keep waiting" (blocked_on_github true), sends a null or a
--       bare string for the links, or calls from a named chat; an agent may
--       resend the same issue as a pull request address (only the kind
--       changes) and the card still waits after the next run; an admin who
--       is not the owner can change it, is named in the agent log, and the
--       next run lifts the wait once everything it waits for is Live.
--   X3  of two complete records naming one issue that merged at the same
--       moment, Bridge D titles its draft from the higher pull request's
--       Feature Guide entry, every time.
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

create temp table t3980w2x_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2x_people (who, id, email) values
  ('owner',    '39870000-0000-4000-a000-000000000001', 'oz.w2x3980@test.local'),
  ('admin',    '39870000-0000-4000-a000-000000000002', 'ivy.w2x3980@test.local'),
  ('growth',   '39870000-0000-4000-a000-000000000003', 'kim.w2x3980@test.local'),
  ('support',  '39870000-0000-4000-a000-000000000004', 'sue.w2x3980@test.local'),
  ('offsupp',  '39870000-0000-4000-a000-000000000005', 'oli.w2x3980@test.local'),
  ('host',     '39870000-0000-4000-a000-000000000006', 'hal.w2x3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2x_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2x3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2x3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2x3980@test.local', 'growth', 'active', now()),
  ('sue.w2x3980@test.local', 'growth', 'active', now()),
  ('oli.w2x3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39870000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39870000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2x_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2x_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2x_people where who = p_who;
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

create function pg_temp.t3980w2x_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2x_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2x_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2x_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2x_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2x_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2x_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2x_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2x_next_request();
  return pg_temp.t3980w2x_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2x_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2x_next_request();
  select id, email into strict v_id, v_email from t3980w2x_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2x_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2x_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
                                   p_state text default 'OPEN', p_merged boolean default false,
                                   p_updated timestamptz default '2026-10-20T09:00:00Z') returns jsonb
language sql as $fn$
  select jsonb_build_object('number', p_n, 'found', true, 'kind', p_kind, 'title', 'W2X item ' || p_n,
    'url', 'https://github.com/Mingla-LLC/mingla-main/' || case p_kind when 'pull' then 'pull/' else 'issues/' end || p_n,
    'state', p_state, 'merged', p_merged, 'merged_at', case when p_merged then '2026-10-20T09:00:00Z' end,
    'merge_sha', case when p_merged then repeat('b', 40) end, 'closing_issues', '[]'::jsonb,
    'board_status', p_board, 'board_horizon', p_horizon,
    'updated_at', to_char(p_updated AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
$fn$;

create function pg_temp.t3980w2x_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2x_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2x_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2x_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2x_record(p_pr int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'W2X record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', to_char((now() - interval '3 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', repeat(to_hex(p_pr % 16), 40), 'merged_by', 'oz-gh', 'author', 'oz-gh',
    'issues', '[]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '["mingla-admin"]'::jsonb, 'deploy_marker', true,
    'deploy', '{"web":{"mingla-admin":"ready"},"edge":"none"}'::jsonb, 'feature_guide', '[]'::jsonb,
    'live_check', jsonb_build_object('text', 'Checked it in production', 'by_login', 'oz-gh',
      'url', 'https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-' || p_pr,
      'at', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'test_files', '["supabase/migrations/__tests__/w2x_fixture.pg17.test.sql"]'::jsonb, 'problems', '[]'::jsonb) || p_extra
$fn$;

create function pg_temp.t3980w2x_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2x_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2x_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2x_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2x3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2x3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2x_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2x_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2x_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;





-- ---------------------------------------------------------------------------
-- X1: the race path's issue_taken.
-- ---------------------------------------------------------------------------
do $x1$
declare v text;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
    ('39870000-0000-4000-c100-000000000011', 'X1 card B', 'B. More.', 'later', 'published', 981);
  -- Another session's link for #7811, as the check cannot see it (its card is
  -- not readable to the check's join), so the insert is the one that meets it.
  set local session_replication_role = replica;
  insert into public.ops_roadmap_links (card_id, issue_number, linked_by)
  values ('39870000-0000-4000-c100-0000000000ff', 7811, 'oz.w2x3980@test.local');
  set local session_replication_role = origin;
  v := pg_temp.t3980w2x_person('admin', $q$select public.ops_roadmap_link_set('39870000-0000-4000-c100-000000000011', '#7811')::text$q$);
  perform pg_temp.t3980w2x_check('X1', 'the second linker is told the issue is taken, in plain words', v,
    'ERR:22023:issue_taken: #7811 is already linked to "another roadmap card".');
  perform pg_temp.t3980w2x_check('X1', 'and still one card holds #7811',
    (select count(*)::text from public.ops_roadmap_links where issue_number = 7811), '1');
  perform pg_temp.t3980w2x_check('X1', 'card B holds nothing',
    (select count(*)::text from public.ops_roadmap_links where card_id = '39870000-0000-4000-c100-000000000011'), '0');
  -- A card that already holds another issue moving onto the taken one takes the same path.
  v := pg_temp.t3980w2x_person('admin', $q$select public.ops_roadmap_link_set('39870000-0000-4000-c100-000000000011', '#7812')::text$q$);
  perform pg_temp.t3980w2x_check('X1', 'card B links #7812', pg_temp.t3980w2x_get(v, 'issue_number'), '7812');
  v := pg_temp.t3980w2x_person('admin', $q$select public.ops_roadmap_link_set('39870000-0000-4000-c100-000000000011', '#7811')::text$q$);
  perform pg_temp.t3980w2x_check('X1', 'moving card B onto the taken issue is refused the same way', v,
    'ERR:22023:issue_taken: #7811 is already linked to "another roadmap card".');
  perform pg_temp.t3980w2x_check('X1', 'card B keeps #7812',
    (select issue_number::text from public.ops_roadmap_links where card_id = '39870000-0000-4000-c100-000000000011'), '7812');
end $x1$;

-- ---------------------------------------------------------------------------
-- X2: what a waiting card waits for, from more angles.
-- ---------------------------------------------------------------------------
do $x2$
declare v text; v_card text;
begin
  insert into public.ops_github_items (number, kind) values (7821, 'issue'), (7822, 'issue') on conflict do nothing;
  perform pg_temp.t3980w2x_ingest(pg_temp.t3980w2x_record(97822, '{"issues":[{"number":7822,"relation":"fixes"}]}'), 7822);
  perform pg_temp.t3980w2x_apply(jsonb_build_array(pg_temp.t3980w2x_gh(7821, 'issue', 'In Progress'), pg_temp.t3980w2x_gh(7822, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2x_check('X2', '#7822 is Live, #7821 is not', pg_temp.t3980w2x_label(7822) || '|' || pg_temp.t3980w2x_label(7821), 'Live|In Progress');
  v_card := pg_temp.t3980w2x_card('growth', 'X2 wait for the fix', '["#7821"]', 'w2x-x2-card-0001');
  v := pg_temp.t3980w2x_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2x_rev(v_card)));
  perform pg_temp.t3980w2x_check('X2', 'the card waits for #7821', pg_temp.t3980w2x_get(v, 'card', 'blocked_reason'), 'Waiting for #7821 to be Live.');

  v := pg_temp.t3980w2x_agent('growth', format($q$select public.ops_work_update(%L, '{"github":["#7822"],"blocked_on_github":true}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2x_rev(v_card)));
  perform pg_temp.t3980w2x_check('X2', 'an agent swapping to a Live issue while saying keep waiting is refused', v,
    'ERR:42501:gate_blocked: This card waits for #7821 to be Live on Mingla.');
  v := pg_temp.t3980w2x_agent('growth', format($q$select public.ops_work_update(%L, '{"github":null}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2x_rev(v_card)));
  perform pg_temp.t3980w2x_like('X2', 'an agent sending null links is refused', v, 'ERR:42501:gate_blocked:%');
  v := pg_temp.t3980w2x_agent('growth', format($q$select public.ops_work_update(%L, '{"github":"#7822"}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2x_rev(v_card)));
  perform pg_temp.t3980w2x_like('X2', 'an agent sending a bare string is refused', v, 'ERR:%');
  perform set_config('request.headers', '{"x-mingla-chat":"0123456789abcdef"}', true);
  v := pg_temp.t3980w2x_agent('growth', format($q$select public.ops_work_update(%L, '{"github":["#7822"]}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2x_rev(v_card)));
  perform set_config('request.headers', '', true);
  perform pg_temp.t3980w2x_check('X2', 'an agent in a named chat swapping is refused', v,
    'ERR:42501:gate_blocked: This card waits for #7821 to be Live on Mingla.');
  perform pg_temp.t3980w2x_check('X2', 'none of those changed the links',
    (select string_agg(number::text, ',' order by number) from public.ops_work_github where card_id = v_card::uuid), '7821');

  v := pg_temp.t3980w2x_agent('growth', format($q$select public.ops_work_update(%L, '{"github":["https://github.com/Mingla-LLC/mingla-main/pull/7821"]}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2x_rev(v_card)));
  perform pg_temp.t3980w2x_like('X2', 'an agent resending the same number as a pull request address is not refused', v, '{%');
  perform pg_temp.t3980w2x_reconcile();
  perform pg_temp.t3980w2x_check('X2', 'and the card still waits after the next run',
    (select blocked::text || ':' || blocked_kind || ':' || blocked_reason from public.ops_work_cards where id = v_card::uuid), 'true:github:Waiting for #7821 to be Live.');

  v := pg_temp.t3980w2x_person('admin', format($q$select public.ops_work_update(%L, '{"github":["#7822"]}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2x_rev(v_card)));
  perform pg_temp.t3980w2x_check('X2', 'an admin who is not the owner can change what it waits for', pg_temp.t3980w2x_get(v, 'card', 'blocked_reason'), 'Waiting for #7822 to be Live.');
  perform pg_temp.t3980w2x_check('X2', 'the agent log names the admin',
    (select actor_email || '|' || coalesce(via, 'person') || '|' || (summary like 'Ivy changed what Card % waits for: #7822 (was #7821).')::text
       from public.ops_agent_log where card_id = v_card::uuid and detail->>'waiting' = 'true' order by id desc limit 1),
    'ivy.w2x3980@test.local|person|true');
  perform pg_temp.t3980w2x_reconcile();
  perform pg_temp.t3980w2x_check('X2', 'the next run lifts the wait: everything it waits for is Live',
    (select blocked::text from public.ops_work_cards where id = v_card::uuid), 'false');
end $x2$;

-- ---------------------------------------------------------------------------
-- X3: Bridge D's title on a tie.
-- ---------------------------------------------------------------------------
do $x3$
declare v_at text := to_char((now() - interval '2 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  insert into public.product_capabilities (capability_key, title, outcome_summary, who_can_use, surfaces, how_to, limitations, support_wording, claimed_status, required_evidence_kinds) values
    ('w2x-older-entry', 'X3 lower pull request entry', 'X3 lower: hosts can use it. More.', ARRAY['staff'], ARRAY['admin'], 'Open Admin and use the race entry there.', 'None known yet.', 'X3 lower entry works for every host.', 'planned', ARRAY['source','release_record','route']),
    ('w2x-newer-entry', 'X3 higher pull request entry', 'X3 higher: hosts can use it today. More.', ARRAY['staff'], ARRAY['admin'], 'Open Admin and use the race entry there.', 'None known yet.', 'X3 higher entry works for every host.', 'planned', ARRAY['source','release_record','route']);
  insert into public.ops_github_items (number, kind) values (7831, 'issue') on conflict do nothing;
  -- The lower pull request is read first; both merged at the same second.
  perform pg_temp.t3980w2x_ingest(pg_temp.t3980w2x_record(97830, jsonb_build_object('issues', '[{"number":7831,"relation":"toward"}]'::jsonb, 'merged_at', v_at,
    'feature_guide', '["w2x-older-entry"]'::jsonb)), 7831);
  perform pg_temp.t3980w2x_ingest(pg_temp.t3980w2x_record(97831, jsonb_build_object('issues', '[{"number":7831,"relation":"fixes"}]'::jsonb, 'merged_at', v_at,
    'feature_guide', '["w2x-newer-entry"]'::jsonb)), 7831);
  perform pg_temp.t3980w2x_check('X3', 'both records complete, merged at the same moment',
    (select string_agg(pr || ':' || complete, ',' order by pr) from public.ops_release_records where pr in (97830, 97831))
      || '|' || (select count(distinct merged_at)::text from public.ops_release_records where pr in (97830, 97831)), '97830:true,97831:true|1');
  perform pg_temp.t3980w2x_apply(jsonb_build_array(pg_temp.t3980w2x_gh(7831, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2x_check('X3', 'one draft, titled from the higher pull request''s entry',
    (select string_agg(rc.public_title || ' / ' || coalesce(rc.public_body, ''), ',') from public.community_audit_log a
       join public.community_roadmap_cards rc on rc.id = a.entity_id
      where a.action = 'draft_roadmap_card' and a.metadata->>'issue' = '7831'),
    'X3 higher pull request entry / Now live: X3 higher: hosts can use it today.');
end $x3$;

select count(*) as t3980w2x_total, count(*) filter (where not ok) as t3980w2x_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2x_failures
  from t3980w2x_results \gset
rollback;

select (:t3980w2x_total < 20 or :t3980w2x_failed > 0) as t3980w2x_bad \gset
\if :t3980w2x_bad
  \echo 'ISSUE-3980 SYNCED WAVE 2 RETEST TESTER FAILED:' :t3980w2x_failed 'of' :t3980w2x_total
  \echo :t3980w2x_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 2 RETEST TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 2 RETEST TESTER PASS:' :t3980w2x_total 'checks, 0 failed'
