-- Issue #3980 synced program, Wave 2 -- tester adversarial suite, on the
-- fully replayed PG17 schema. Attacks the angles the implementor's happy
-- path does not:
--   B1   malformed GitHub answers (a kind GitHub never sends, a board column
--        Mingla does not know, a lower-case state, a bad merge sha, eleven
--        closing issues, control characters and 400-character titles) are
--        cleaned or skipped one by one while the rest of the batch applies;
--        more than 200 items is refused whole; a number GitHub no longer has
--        loses Live, so nothing waiting for it moves; a link saved as a pull
--        request that GitHub says is an issue is corrected; the follow list
--        drops cards closed over 30 days ago, archived cards and records
--        merged over 60 days ago, and clamps its limit; reading chips never
--        starts following a number
--   B2   a Feature Guide line naming an unknown key keeps the record
--        incomplete and turns nothing Live; an entry needing evidence the
--        record cannot prove (deployment on a change with no deploy, a
--        migration on a change with no migration) is not changed; a live
--        check pointing outside the repository proves nothing; a live check
--        dated in the future is recorded as now; an entry already Live is
--        not touched by a record that cannot prove it; a retired entry is
--        left retired; re-reading a complete record never applies it twice,
--        and a record that later loses its live check undoes nothing; an
--        admin's editor holding the old revision is refused after the flip
--   B3   the ticket's Engineering row in every state: Planned, In Progress,
--        In Review, Shipped (Done, record incomplete), Live, Not on GitHub;
--        while GitHub has never answered (unreachable) the Product Inbox
--        board word is used and is never Live; Support disabled, a host and
--        a bad source are refused
--   B4   the draft is never visible to hosts or anonymous readers through
--        any run; an issue linked to a roadmap card AND named by a Feature
--        Guide record drafts once; after a person archives the draft no
--        second draft is ever made, however many runs; the approval card
--        closes on archive as "not needed"; Done with an incomplete record
--        drafts nothing
--   B5   a card waiting for an issue and a pull request stays blocked while
--        the pull request's record is incomplete; owners are told exactly
--        once over repeated runs; a person lifts the wait with "blocked":
--        false; a person cannot strip every GitHub link from a waiting card;
--        a done card is never unblocked
--   B6   an archived roadmap card, a number GitHub says is a pull request
--        and a number GitHub does not have get no suggestion (and lose one
--        they had); a dismissed lane hides only that lane; re-linking the
--        same issue keeps the dismissal, linking another clears it;
--        an agent can neither link nor decide; issue_taken holds across
--        cards; no run ever moves a lane
--   D6   (Wave 1 rework) the Done clock survives a "not on GitHub" answer
--        and comes back unchanged, and a first sight dated in the future is
--        stamped now
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

create temp table t3980w2t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w2t_people (who, id, email) values
  ('owner',    '39830000-0000-4000-a000-000000000001', 'oz.w2t3980@test.local'),
  ('admin',    '39830000-0000-4000-a000-000000000002', 'ivy.w2t3980@test.local'),
  ('growth',   '39830000-0000-4000-a000-000000000003', 'kim.w2t3980@test.local'),
  ('support',  '39830000-0000-4000-a000-000000000004', 'sue.w2t3980@test.local'),
  ('offsupp',  '39830000-0000-4000-a000-000000000005', 'oli.w2t3980@test.local'),
  ('host',     '39830000-0000-4000-a000-000000000006', 'hal.w2t3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w2t_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w2t3980@test.local', 'owner', 'active', now() - interval '3650 days'),
  ('ivy.w2t3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w2t3980@test.local', 'growth', 'active', now()),
  ('sue.w2t3980@test.local', 'growth', 'active', now()),
  ('oli.w2t3980@test.local', 'growth', 'active', now());
set local session_replication_role = replica;
insert into public.support_staff (user_id, enabled, available, role) values
  ('39830000-0000-4000-a000-000000000004', true, true, 'staff'),
  ('39830000-0000-4000-a000-000000000005', false, false, 'staff');
set local session_replication_role = origin;

create temp table t3980w2t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980w2t_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w2t_people where who = p_who;
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

create function pg_temp.t3980w2t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w2t_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w2t_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w2t_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w2t_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w2t_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w2t_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w2t_next_request();
  return pg_temp.t3980w2t_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly.
create function pg_temp.t3980w2t_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980w2t_next_request();
  select id, email into strict v_id, v_email from t3980w2t_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980w2t_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980w2t_gh(p_n int, p_kind text, p_board text default null, p_horizon text default null,
                                   p_state text default 'OPEN', p_merged boolean default false,
                                   p_updated timestamptz default '2026-10-20T09:00:00Z') returns jsonb
language sql as $fn$
  select jsonb_build_object('number', p_n, 'found', true, 'kind', p_kind, 'title', 'W2T item ' || p_n,
    'url', 'https://github.com/Mingla-LLC/mingla-main/' || case p_kind when 'pull' then 'pull/' else 'issues/' end || p_n,
    'state', p_state, 'merged', p_merged, 'merged_at', case when p_merged then '2026-10-20T09:00:00Z' end,
    'merge_sha', case when p_merged then repeat('b', 40) end, 'closing_issues', '[]'::jsonb,
    'board_status', p_board, 'board_horizon', p_horizon,
    'updated_at', to_char(p_updated AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
$fn$;

create function pg_temp.t3980w2t_apply(p_items jsonb) returns text
language sql as $fn$ select pg_temp.t3980w2t_as('service', format('select public.ops_github_items_apply(%L::jsonb)::text', p_items)) $fn$;

create function pg_temp.t3980w2t_reconcile() returns text
language sql as $fn$ select pg_temp.t3980w2t_as('service', 'select public.ops_reconcile()::text') $fn$;

-- A merge-bot record JSON, complete unless told otherwise.
create function pg_temp.t3980w2t_record(p_pr int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'W2T record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', to_char((now() - interval '3 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', repeat(to_hex(p_pr % 16), 40), 'merged_by', 'oz-gh', 'author', 'oz-gh',
    'issues', '[]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '["mingla-admin"]'::jsonb, 'deploy_marker', true,
    'deploy', '{"web":{"mingla-admin":"ready"},"edge":"none"}'::jsonb, 'feature_guide', '[]'::jsonb,
    'live_check', jsonb_build_object('text', 'Checked it in production', 'by_login', 'oz-gh',
      'url', 'https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-' || p_pr,
      'at', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'test_files', '["supabase/migrations/__tests__/w2t_fixture.pg17.test.sql"]'::jsonb, 'problems', '[]'::jsonb) || p_extra
$fn$;

create function pg_temp.t3980w2t_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w2t_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-8' || (p_data->>'pr'),
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w2t_card(p_who text, p_title text, p_github jsonb, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w2t_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Follow the engineering work until it ships.',
      'done_means', 'The change is Live.', 'owners', jsonb_build_array('kim.w2t3980@test.local'),
      'watchers', jsonb_build_array('ivy.w2t3980@test.local'),
      'due_on', ((now() AT TIME ZONE 'UTC')::date + 5)::text, 'github', p_github)), p_key));
  return pg_temp.t3980w2t_get(v, 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w2t_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

create function pg_temp.t3980w2t_label(p_n int) returns text
language sql as $fn$ select public.ops_github_status(p_n)->>'label' $fn$;

-- Fixtures.
insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
  ('39830000-0000-4000-c100-000000000001', 'W2T Faster check-in', 'Check-in takes one tap. Then more.', 'later', 'published', 950),
  ('39830000-0000-4000-c100-000000000002', 'W2T Archived idea', 'An idea we dropped.', 'later', 'archived', 951),
  ('39830000-0000-4000-c100-000000000003', 'W2T Linked to a pull request', 'Someone typed a PR number.', 'now', 'published', 952),
  ('39830000-0000-4000-c100-000000000004', 'W2T Linked to a missing number', 'A number GitHub does not have.', 'later', 'published', 953),
  ('39830000-0000-4000-c100-000000000005', 'W2T Dismissal card', 'Testing dismissals.', 'later', 'published', 954),
  ('39830000-0000-4000-c100-000000000006', 'W2T Second card', 'Wants the same issue.', 'now', 'published', 955);
insert into public.product_capabilities (capability_key, title, outcome_summary, who_can_use, surfaces, how_to, limitations, support_wording,
  claimed_status, required_evidence_kinds)
select k, t, t || ': hosts can use it today. More words follow.', ARRAY['staff'], ARRAY['admin'],
       'Open Admin and use ' || t || ' there.', 'None known yet.', t || ' works for every host.', st, req
  from (values
    ('w2t-guide-proven', 'W2T proven entry', 'planned', ARRAY['source','release_record','live_check']),
    ('w2t-guide-deploy', 'W2T entry needing a deploy', 'planned', ARRAY['source','release_record','deployment']),
    ('w2t-guide-migration', 'W2T entry needing a migration', 'planned', ARRAY['source','release_record','migration']),
    ('w2t-guide-live-check', 'W2T entry needing a live check', 'planned', ARRAY['source','release_record','live_check']),
    ('w2t-guide-already', 'W2T entry already Live', 'live', ARRAY['source','release_record','route']),
    ('w2t-guide-retired', 'W2T retired entry', 'retired', ARRAY['source','release_record']),
    ('w2t-guide-unknown-sibling', 'W2T entry beside an unknown key', 'planned', ARRAY['source','release_record','live_check']),
    ('w2t-guide-revision', 'W2T entry an admin is editing', 'planned', ARRAY['source','release_record','live_check'])) x(k, t, st, req);

-- ---------------------------------------------------------------------------
-- B1: malformed and partial GitHub answers, the follow list's edges.
-- ---------------------------------------------------------------------------
do $b1$
declare v text; v_card text; v_old text; v_list jsonb; v_long text := repeat('x', 400);
begin
  insert into public.ops_github_items (number, kind) values
    (6101, 'issue'), (6102, 'issue'), (6103, 'issue'), (6104, 'pull'), (6105, 'pull'), (6106, 'issue'), (6107, 'issue');

  v := pg_temp.t3980w2t_apply((select jsonb_agg(jsonb_build_object('number', 6101, 'found', false)) from generate_series(1, 201)));
  perform pg_temp.t3980w2t_like('B1', 'more than 200 items is refused whole', v, 'ERR:22023:invalid_items:%');
  perform pg_temp.t3980w2t_check('B1', 'and nothing was read', (select (synced_at is null)::text from public.ops_github_items where number = 6101), 'true');

  v := pg_temp.t3980w2t_apply(jsonb_build_array(
    jsonb_build_object('number', 6101, 'found', true, 'kind', 'discussion', 'title', 'A discussion', 'state', 'OPEN'),
    jsonb_build_object('number', '6102', 'found', true, 'kind', 'issue', 'state', 'OPEN'),
    jsonb_build_object('number', -6103, 'found', true, 'kind', 'issue'),
    jsonb_build_object('number', 6106, 'found', true, 'kind', 'issue', 'state', 'open', 'board_status', 'Blocked', 'board_horizon', 'Someday',
      'title', E'Line one\nline two\ttab' || v_long, 'updated_at', 'yesterday'),
    jsonb_build_object('number', 6104, 'found', true, 'kind', 'pull', 'state', 'OPEN', 'merged', 'yes', 'merge_sha', 'not-a-sha',
      'merged_at', 'soon', 'closing_issues', jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,'12', -1, 1.5)),
    'null'::jsonb, '"6107"'::jsonb));
  perform pg_temp.t3980w2t_check('B1', 'each malformed item is skipped by itself while the rest apply',
    pg_temp.t3980w2t_get(v, 'applied') || '/' || pg_temp.t3980w2t_get(v, 'skipped'), '2/5');
  perform pg_temp.t3980w2t_check('B1', 'a kind GitHub never sends leaves the number unread',
    (select coalesce(synced_at::text, 'unread') || ':' || kind from public.ops_github_items where number = 6101), 'unread:issue');
  perform pg_temp.t3980w2t_check('B1', 'an unknown board column and horizon are not kept, so the chip says Planned; a lower-case state is read',
    (select coalesce(board_status, '-') || ':' || coalesce(board_horizon, '-') || ':' || state || ':' || coalesce(github_updated_at::text, '-')
       from public.ops_github_items where number = 6106) || ':' || pg_temp.t3980w2t_label(6106), '-:-:OPEN:-:Planned');
  perform pg_temp.t3980w2t_check('B1', 'a title with new lines, tabs and 400+ characters is one line of at most 300',
    (select (position(E'\n' in title) = 0 and position(E'\t' in title) = 0)::text || ':' || char_length(title) from public.ops_github_items where number = 6106),
    'true:300');
  perform pg_temp.t3980w2t_check('B1', 'a pull request with a bad sha, an unreadable merge time, a non-boolean merged and 14 closing issues keeps only what is real',
    (select state || ':' || coalesce(merge_sha, '-') || ':' || coalesce(merged_at::text, '-') || ':' || array_to_string(closing_issues, ',')
       from public.ops_github_items where number = 6104), 'OPEN:-:-:1,2,3,4,5,6,7,8,9,10');

  -- A pull request GitHub now says is an issue is corrected the other way too.
  v_card := pg_temp.t3980w2t_card('growth', 'W2T card linking a pull request', '["https://github.com/Mingla-LLC/mingla-main/pull/6105"]', 'w2t-b1-card-0001');
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6105, 'issue', 'In Progress')));
  perform pg_temp.t3980w2t_check('B1', 'a link saved as a pull request that GitHub says is an issue is corrected to an issue',
    (select kind from public.ops_work_github where card_id = v_card::uuid and number = 6105) || ':' || pg_temp.t3980w2t_label(6105), 'issue:In Progress');

  -- A number that was Live and then disappears from GitHub (deleted or moved away).
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96107, '{"issues":[{"number":6107,"relation":"fixes"}]}'), 6107);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6107, 'issue', 'Done', null, 'CLOSED')));
  v_old := pg_temp.t3980w2t_label(6107);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(jsonb_build_object('number', 6107, 'found', false)));
  perform pg_temp.t3980w2t_check('B1', 'a Live issue GitHub no longer has reads Not on GitHub and is not Live; its title is kept',
    v_old || '>' || pg_temp.t3980w2t_label(6107) || ':' || (public.ops_github_status(6107)->>'live') || ':'
      || (select title from public.ops_github_items where number = 6107), 'Live>Not on GitHub:false:W2T item 6107');

  -- The follow list's windows and limit.
  insert into public.ops_github_items (number, kind) values (6120, 'issue'), (6121, 'issue'), (6122, 'issue') on conflict do nothing;
  v_card := pg_temp.t3980w2t_card('growth', 'W2T card closed long ago', '["#6120"]', 'w2t-b1-card-0002');
  update public.ops_work_cards set status = 'done', close_kind = 'done', closed_at = now() - interval '31 days', closed_by = 'kim.w2t3980@test.local'
   where id = v_card::uuid;
  v_card := pg_temp.t3980w2t_card('growth', 'W2T card archived', '["#6121"]', 'w2t-b1-card-0003');
  update public.ops_work_cards set archived_at = now(), archived_by = 'kim.w2t3980@test.local', archive_reason = 'Not needed any more.' where id = v_card::uuid;
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96122, '{"issues":[{"number":6122,"relation":"toward"}]}'), 6122);
  update public.ops_release_records set merged_at = now() - interval '61 days' where pr = 96122;
  v := pg_temp.t3980w2t_as('service', 'select public.ops_github_follow_list(200)::text');
  perform pg_temp.t3980w2t_check('B1', 'a card closed 31 days ago, an archived card and a record merged 61 days ago are not followed',
    (select count(*)::text from jsonb_array_elements(pg_temp.t3980w2t_j(v)) x where (x->>'number')::int in (6120, 6121, 6122)), '0');
  v := pg_temp.t3980w2t_as('service', 'select jsonb_array_length(public.ops_github_follow_list(0))::text');
  perform pg_temp.t3980w2t_check('B1', 'a limit of 0 still returns one number', v, '1');
  v := pg_temp.t3980w2t_as('service', 'select jsonb_array_length(public.ops_github_follow_list(5000)) <= 200');
  perform pg_temp.t3980w2t_check('B1', 'a limit of 5000 is held to 200', v, 'true');
  v := pg_temp.t3980w2t_as('anon', 'select public.ops_github_follow_list(1)::text');
  perform pg_temp.t3980w2t_like('B1', 'an anonymous caller cannot read the follow list', v, 'ERR:42501:%');
  v := pg_temp.t3980w2t_as('anon', format('select public.ops_github_items_apply(%L::jsonb)::text', '[]'));
  perform pg_temp.t3980w2t_like('B1', 'nor hand in GitHub status', v, 'ERR:42501:%');

  -- Reading chips never starts following a number.
  v := pg_temp.t3980w2t_person('growth', 'select public.ops_github_status_list(array[6199])::text');
  perform pg_temp.t3980w2t_check('B1', 'a chip read for an unknown number says Checking GitHub and stores nothing',
    (select x->>'label' from jsonb_array_elements(pg_temp.t3980w2t_j(v) -> 'items') x) || ':'
      || (select count(*)::text from public.ops_github_items where number = 6199), 'Checking GitHub:0');
  v := pg_temp.t3980w2t_person('growth', 'select public.ops_github_status_list(array[6101, null]::int[])::text');
  perform pg_temp.t3980w2t_like('B1', 'a list holding an empty number is refused', v, 'ERR:22023:invalid_numbers:%');
  v := pg_temp.t3980w2t_person('growth', 'select public.ops_github_status_list(array[0])::text');
  perform pg_temp.t3980w2t_like('B1', 'number 0 is refused', v, 'ERR:22023:invalid_numbers:%');
  v := pg_temp.t3980w2t_person('offsupp', 'select public.ops_github_status_list(array[6101])::text');
  perform pg_temp.t3980w2t_check('B1', 'a pipelines teammate whose Support is switched off still reads chips through the pipelines role',
    (select x->>'number' from jsonb_array_elements(pg_temp.t3980w2t_j(v) -> 'items') x), '6101');
  v := pg_temp.t3980w2t_person('host', 'select public.ops_github_status_list(array[6101])::text');
  perform pg_temp.t3980w2t_like('B1', 'a host is refused', v, 'ERR:42501:forbidden:%');
end;
$b1$;

-- ---------------------------------------------------------------------------
-- D6 (Wave 1 rework): the Done clock and the Wave 2 apply.
-- ---------------------------------------------------------------------------
do $d6$
declare v_since timestamptz;
begin
  insert into public.ops_github_items (number, kind) values (6201, 'issue'), (6202, 'issue');
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6201, 'issue', 'Done', null, 'CLOSED', false, now() - interval '3 days')));
  select done_since into v_since from public.ops_github_items where number = 6201;
  perform pg_temp.t3980w2t_check('D6', 'first sight of an issue already Done counts from its last update',
    (abs(extract(epoch from (v_since - (now() - interval '3 days')))) < 5)::text, 'true');
  perform pg_temp.t3980w2t_apply(jsonb_build_array(jsonb_build_object('number', 6201, 'found', false)));
  perform pg_temp.t3980w2t_check('D6', 'a "not on GitHub" answer keeps the Done time',
    (select (done_since = v_since)::text from public.ops_github_items where number = 6201), 'true');
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6201, 'issue', 'Done', null, 'CLOSED', false, now())));
  perform pg_temp.t3980w2t_check('D6', 'and when GitHub has it again, still Done, the clock is unchanged',
    (select (done_since = v_since)::text from public.ops_github_items where number = 6201), 'true');
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6202, 'issue', 'Done', null, 'CLOSED', false, now() + interval '10 days')));
  perform pg_temp.t3980w2t_check('D6', 'a first sight dated in the future is stamped now, never later',
    (select (done_since <= now())::text from public.ops_github_items where number = 6202), 'true');
end;
$d6$;

-- ---------------------------------------------------------------------------
-- B5: waiting for GitHub.
-- ---------------------------------------------------------------------------
do $b5$
declare v text; v_card text; v_lone text; v_done text; v_told int; v_events int;
begin
  insert into public.ops_github_items (number, kind) values (6301, 'issue'), (6302, 'pull'), (6303, 'issue') on conflict do nothing;
  v_card := pg_temp.t3980w2t_card('growth', 'W2T wait for an issue and its pull request', '["#6301", "https://github.com/Mingla-LLC/mingla-main/pull/6302"]', 'w2t-b5-card-0001');
  v_lone := pg_temp.t3980w2t_card('growth', 'W2T wait for one issue', '["#6303"]', 'w2t-b5-card-0002');
  v_done := pg_temp.t3980w2t_card('growth', 'W2T done card that waited', '["#6301"]', 'w2t-b5-card-0003');
  perform pg_temp.t3980w2t_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_card, pg_temp.t3980w2t_rev(v_card)));
  perform pg_temp.t3980w2t_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_lone, pg_temp.t3980w2t_rev(v_lone)));
  perform pg_temp.t3980w2t_person('growth', format($q$select public.ops_work_update(%L, '{"blocked_on_github":true}'::jsonb, %s)::text$q$, v_done, pg_temp.t3980w2t_rev(v_done)));
  update public.ops_work_cards set status = 'done', close_kind = 'done', closed_at = now(), closed_by = 'kim.w2t3980@test.local' where id = v_done::uuid;

  v := pg_temp.t3980w2t_person('growth', format($q$select public.ops_work_update(%L, '{"github":[]}'::jsonb, %s)::text$q$, v_lone, pg_temp.t3980w2t_rev(v_lone)));
  perform pg_temp.t3980w2t_like('B5', 'a person cannot strip every GitHub link from a waiting card', v, 'ERR:22023:invalid_card: A card waiting for GitHub keeps at least one GitHub link%');

  -- The issue goes Live; the pull request merged but its record is not complete.
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96301, '{"issues":[{"number":6301,"relation":"fixes"}]}'), 6301);
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(6302, '{"issues":[{"number":6399,"relation":"toward"}],"live_check":null,"problems":["live_check_missing"]}'), 6301);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6301, 'issue', 'Done', null, 'CLOSED'),
    pg_temp.t3980w2t_gh(6302, 'pull', null, null, 'MERGED', true)));
  perform pg_temp.t3980w2t_check('B5', 'the issue is Live but its pull request is only Merged',
    pg_temp.t3980w2t_label(6301) || '/' || pg_temp.t3980w2t_label(6302), 'Live/Merged');
  perform pg_temp.t3980w2t_check('B5', 'so the card keeps waiting: every link must be Live',
    (select blocked::text || ':' || blocked_kind from public.ops_work_cards where id = v_card::uuid), 'true:github');
  perform pg_temp.t3980w2t_check('B5', 'a done card is never unblocked',
    (select blocked::text || ':' || coalesce(blocked_kind, '-') from public.ops_work_cards where id = v_done::uuid), 'true:github');

  -- The pull request's record completes: now every link is Live.
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(6302, '{"issues":[{"number":6399,"relation":"toward"}]}'), 6301);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6302, 'pull', null, null, 'MERGED', true)));
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6301, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2t_reconcile();
  select count(*) into v_told from public.team_mentions m
   where m.source_kind = 'work_card' and m.body_excerpt like '#6301, #6302 are Live.%';
  select count(*) into v_events from public.ops_work_events where card_id = v_card::uuid and action = 'unblocked';
  perform pg_temp.t3980w2t_check('B5', 'it unblocks once both are Live, and over four more runs its owner and watcher are told exactly once',
    (select blocked::text from public.ops_work_cards where id = v_card::uuid) || '/' || v_events || '/' || v_told, 'false/1/2');

  -- A person lifts a wait with the plain blocked switch.
  v := pg_temp.t3980w2t_person('growth', format($q$select public.ops_work_update(%L, '{"blocked":false}'::jsonb, %s)::text$q$, v_lone, pg_temp.t3980w2t_rev(v_lone)));
  perform pg_temp.t3980w2t_check('B5', 'a person lifts the wait with "blocked": false',
    pg_temp.t3980w2t_get(v, 'card', 'blocked') || ':' || coalesce(pg_temp.t3980w2t_get(v, 'card', 'blocked_kind'), '-'), 'false:-');
end;
$b5$;

-- ---------------------------------------------------------------------------
-- B6: suggestions only.
-- ---------------------------------------------------------------------------
do $b6$
declare v text; v_lanes text;
begin
  select string_agg(id::text || '=' || lane, ',' order by id) into v_lanes from public.community_roadmap_cards where id::text like '39830000-0000-4000-c100-%';
  -- The archived card is linked while still published, then archived by a person.
  update public.community_roadmap_cards set status = 'published' where id = '39830000-0000-4000-c100-000000000002';
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000002', '#6402')::text$q$);
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000003', '#6403')::text$q$);
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000004', '#6404')::text$q$);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6402, 'issue', 'In Progress'), pg_temp.t3980w2t_gh(6403, 'issue', 'Todo', 'Next'),
    pg_temp.t3980w2t_gh(6404, 'issue', 'In Progress')));
  perform pg_temp.t3980w2t_check('B6', 'two later cards on In Progress issues are suggested Now, a Now card on Horizon Next is suggested Next',
    (select string_agg(coalesce(suggested_lane, '-'), ',' order by card_id) from public.ops_roadmap_links
      where card_id in ('39830000-0000-4000-c100-000000000002', '39830000-0000-4000-c100-000000000003', '39830000-0000-4000-c100-000000000004')),
    'now,next,now');
  update public.community_roadmap_cards set status = 'archived' where id = '39830000-0000-4000-c100-000000000002';
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6403, 'pull', null, null, 'OPEN'),
    jsonb_build_object('number', 6404, 'found', false)));
  perform pg_temp.t3980w2t_check('B6', 'an archived card, a number GitHub says is a pull request and a missing number lose their suggestion',
    (select string_agg(coalesce(suggested_lane, '-'), ',' order by card_id) from public.ops_roadmap_links
      where card_id in ('39830000-0000-4000-c100-000000000002', '39830000-0000-4000-c100-000000000003', '39830000-0000-4000-c100-000000000004')),
    '-,-,-');
  v := pg_temp.t3980w2t_person('owner', 'select public.ops_roadmap_links_list()::text');
  perform pg_temp.t3980w2t_check('B6', 'and the roadmap list shows none of them a suggestion',
    (select count(*)::text from jsonb_array_elements(pg_temp.t3980w2t_j(v) -> 'cards') c
      where c->>'card_id' like '39830000-0000-4000-c100-%' and c->'suggestion' is not null and jsonb_typeof(c->'suggestion') <> 'null'), '0');

  -- Dismissals hide only the lane that was dismissed.
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000005', '#6405')::text$q$);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6405, 'issue', 'Todo', 'Next')));
  perform pg_temp.t3980w2t_person('admin', $q$select public.ops_roadmap_suggestion_decide('39830000-0000-4000-c100-000000000005', 'dismiss')::text$q$);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6405, 'issue', 'In Review', 'Next')));
  perform pg_temp.t3980w2t_check('B6', 'after dismissing Next, In Review still suggests Now',
    (select suggested_lane || ':' || suggested_reason from public.ops_roadmap_links where card_id = '39830000-0000-4000-c100-000000000005'), 'now:GitHub: In Review');
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6405, 'issue', 'Todo', 'Next')));
  perform pg_temp.t3980w2t_check('B6', 'and back on Horizon Next the dismissed lane stays hidden',
    (select coalesce(suggested_lane, '-') from public.ops_roadmap_links where card_id = '39830000-0000-4000-c100-000000000005'), '-');
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000005', 'https://github.com/Mingla-LLC/mingla-main/issues/6405')::text$q$);
  perform pg_temp.t3980w2t_check('B6', 're-linking the same issue keeps the dismissal',
    (select coalesce(dismissed_lane, '-') || ':' || coalesce(suggested_lane, '-') from public.ops_roadmap_links where card_id = '39830000-0000-4000-c100-000000000005'), 'next:-');
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000005', '#6406')::text$q$);
  perform pg_temp.t3980w2t_check('B6', 'linking another issue clears it',
    (select coalesce(dismissed_lane, '-') || ':' || issue_number from public.ops_roadmap_links where card_id = '39830000-0000-4000-c100-000000000005'), '-:6406');

  -- issue_taken across cards; agents can neither link nor decide.
  v := pg_temp.t3980w2t_person('admin', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000006', '#6406')::text$q$);
  perform pg_temp.t3980w2t_like('B6', 'an issue already on another card is refused, naming that card', v, 'ERR:22023:issue_taken: #6406 is already linked to "W2T Dismissal card".%');
  v := pg_temp.t3980w2t_agent('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000006', '#6407')::text$q$);
  perform pg_temp.t3980w2t_like('B6', 'the owner''s agent cannot link a roadmap card', v, 'ERR:42501:forbidden:%');
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6402, 'issue', 'In Progress')));
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000001', '#6401')::text$q$);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6401, 'issue', 'In Progress')));
  v := pg_temp.t3980w2t_agent('owner', $q$select public.ops_roadmap_suggestion_decide('39830000-0000-4000-c100-000000000001', 'apply')::text$q$);
  perform pg_temp.t3980w2t_like('B6', 'nor decide on a suggestion', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980w2t_person('admin', $q$select public.ops_roadmap_suggestion_decide('39830000-0000-4000-c100-000000000001', 'delete')::text$q$);
  perform pg_temp.t3980w2t_like('B6', 'a decision other than apply or dismiss is refused', v, 'ERR:22023:invalid_decision:%');
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_check('B6', 'no run, apply or dismissal moved any lane',
    (select string_agg(id::text || '=' || lane, ',' order by id) from public.community_roadmap_cards where id::text like '39830000-0000-4000-c100-%'), v_lanes);
end;
$b6$;

-- ---------------------------------------------------------------------------
-- B4: drafts never reach hosts; one per issue, ever.
-- ---------------------------------------------------------------------------
do $b4$
declare v text; v_draft uuid; v_card uuid; v_drafts int; v_hosts text; v_anon text;
begin
  -- Linked to a roadmap card AND named by a Feature Guide record: one draft.
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96401, '{"issues":[{"number":6401,"relation":"fixes"}],"feature_guide":["w2t-guide-proven"]}'), 6401);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6401, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_reconcile();
  select count(*) into v_drafts from public.community_audit_log a where a.action = 'draft_roadmap_card' and a.metadata->>'issue' = '6401';
  select a.entity_id into v_draft from public.community_audit_log a where a.action = 'draft_roadmap_card' and a.metadata->>'issue' = '6401' limit 1;
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-6401';
  perform pg_temp.t3980w2t_check('B4', 'an issue linked to a roadmap card and named by a Feature Guide record drafts once, titled from the roadmap card',
    v_drafts || ':' || (select public_title || ':' || status from public.community_roadmap_cards where id = v_draft), '1:W2T Faster check-in:draft');
  v_hosts := pg_temp.t3980w2t_person('host', format('select count(*)::text from public.community_roadmap_cards where id = %L', v_draft));
  v_anon := pg_temp.t3980w2t_as('anon', format('select count(*)::text from public.community_roadmap_cards where id = %L', v_draft));
  perform pg_temp.t3980w2t_check('B4', 'after several runs a host and an anonymous reader still see nothing of it',
    v_hosts || '/' || coalesce(nullif(v_anon, ''), '0'), '0/' || case when v_anon like 'ERR:%' then v_anon else '0' end);

  -- A person archives the draft as not needed.
  perform pg_temp.t3980w2t_person('owner', format($q$select public.community_upsert_roadmap_card(%L, 'W2T Faster check-in', 'Now live.', null, 'shipped', 'archived')::text$q$, v_draft));
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_check('B4', 'the approval card closes itself as not needed',
    (select status || ':' || close_kind || ':' || coalesce(close_reason, proof::text) from public.ops_work_cards where id = v_card),
    'done:system:A person marked the Recently shipped card not needed.');
  -- Fifteen days later, more runs: never a second draft or approval card.
  update public.ops_work_cards set closed_at = now() - interval '15 days' where id = v_card;
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6401, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_check('B4', 'after a person archived the draft, no run ever drafts that issue again',
    (select count(*)::text from public.community_audit_log a where a.action = 'draft_roadmap_card' and a.metadata->>'issue' = '6401')
      || '/' || (select count(*)::text from public.community_roadmap_cards where public_title = 'W2T Faster check-in' and lane = 'shipped')
      || '/' || (select count(*)::text from public.ops_work_cards where auto_key = 'roadmap_shipped:issue-6401'), '1/1/1');

  -- Done with an incomplete record drafts nothing.
  perform pg_temp.t3980w2t_person('owner', $q$select public.ops_roadmap_link_set('39830000-0000-4000-c100-000000000006', '#6408')::text$q$);
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96408, '{"issues":[{"number":6408,"relation":"fixes"}],"live_check":null,"problems":["live_check_missing"]}'), 6408);
  perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(6408, 'issue', 'Done', null, 'CLOSED')));
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_check('B4', 'Done on the board with an incomplete record is Shipped and drafts nothing',
    pg_temp.t3980w2t_label(6408) || '/' || (select count(*)::text from public.community_audit_log a where a.action = 'draft_roadmap_card' and a.metadata->>'issue' = '6408'),
    'Shipped/0');
  perform pg_temp.t3980w2t_check('B4', 'no bridge ever published or archived a roadmap card by itself',
    (select count(*)::text from public.community_audit_log a where a.entity_type = 'community_roadmap_card' and a.actor_user_id is null
       and a.action <> 'draft_roadmap_card' and a.created_at >= now() - interval '1 hour'), '0');
end;
$b4$;

-- ---------------------------------------------------------------------------
-- B2: Feature Guide Live only with every proof the entry needs.
-- ---------------------------------------------------------------------------
do $b2$
declare v text; v_rev int; v_ev int; v_obs timestamptz;
begin
  -- [TEST-MOD-APPROVED #4179] An unknown key keeps the record incomplete;
  -- the known sibling is invalidated immediately but cannot turn Live.
  v := pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96501, '{"feature_guide":["w2t-guide-unknown-sibling","w2t-guide-no-such-entry"]}'));
  perform pg_temp.t3980w2t_check('B2', 'a Feature Guide line naming an unknown key keeps the record incomplete and names the key',
    (select complete::text || ':' || array_to_string(problems, ',') from public.ops_release_records where pr = 96501),
    'false:unknown_feature_guide_key:w2t-guide-no-such-entry');
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_check('B2', 'and its known sibling is not turned Live',
    (select claimed_status || ':' || revision from public.product_capabilities where capability_key = 'w2t-guide-unknown-sibling'), 'planned:2');

  -- [TEST-MOD-APPROVED #4179] Evidence the record cannot prove leaves the
  -- named capability invalidated and records the missing proof per key.
  v := pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96502, '{"feature_guide":["w2t-guide-deploy","w2t-guide-migration"],"web_projects":[],"deploy":{"web":{},"edge":"none"}}'));
  perform pg_temp.t3980w2t_check('B2', 'a docs-only record completes', pg_temp.t3980w2t_get(v, 'completed'), '[96502]');
  perform pg_temp.t3980w2t_check('B2', 'an entry needing a deployment or migration is invalidated but gets no unproved evidence',
    (select string_agg(capability_key || '=' || claimed_status || ':' || revision || ':'
                         || (select count(*) from public.product_capability_evidence e where e.capability_id = c.id), ',' order by capability_key)
       from public.product_capabilities c where capability_key in ('w2t-guide-deploy', 'w2t-guide-migration')),
    'w2t-guide-deploy=planned:2:0,w2t-guide-migration=planned:2:0');
  perform pg_temp.t3980w2t_check('B2', 'and the record names what each misses',
    (select string_agg(k->>'key' || ':' || (k->'details'->'missing'->>0), ',' order by k->>'key') from public.ops_release_records r, jsonb_array_elements(r.guide_result->'keys') k
      where r.pr = 96502), 'w2t-guide-deploy:no deployment evidence,w2t-guide-migration:no migration evidence');

  -- [TEST-MOD-APPROVED #4179] A live check that points outside the repository proves nothing.
  v := pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96503, '{"feature_guide":["w2t-guide-live-check"],"live_check":{"text":"Looks fine","by_login":"oz-gh","url":"https://evil.example/Mingla-LLC/mingla-main/issues/1#issuecomment-1","at":"2026-10-20T08:00:00Z"}}'));
  perform pg_temp.t3980w2t_check('B2', 'a live check linking outside the repository does not count as live check evidence',
    (select claimed_status from public.product_capabilities where capability_key = 'w2t-guide-live-check') || '/'
      || (select k->'details'->'missing'->>0 from public.ops_release_records r, jsonb_array_elements(r.guide_result->'keys') k where r.pr = 96503),
    'planned/no live check evidence');

  -- A live check dated in the future is recorded as now, so it never expires late.
  v := pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96504, jsonb_build_object('feature_guide', jsonb_build_array('w2t-guide-proven'),
    'issues', jsonb_build_array(jsonb_build_object('number', 6401, 'relation', 'toward')),
    'live_check', jsonb_build_object('text', 'Checked', 'by_login', 'oz-gh', 'url', 'https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-96504',
      'at', to_char((now() + interval '30 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))));
  select e.observed_at into v_obs from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
   where c.capability_key = 'w2t-guide-proven' and e.evidence_kind = 'live_check' and e.is_current;
  perform pg_temp.t3980w2t_check('B2', 'a live check dated a month ahead is recorded as now and expires in 90 days from now',
    (v_obs <= now())::text || ':' || (select (e.expires_at <= now() + interval '90 days')::text from public.product_capability_evidence e
      join public.product_capabilities c on c.id = e.capability_id where c.capability_key = 'w2t-guide-proven' and e.evidence_kind = 'live_check' and e.is_current),
    'true:true');

  -- [TEST-MOD-APPROVED #4179] A source change invalidates an already-live
  -- entry even when the record cannot yet prove it; a retired entry stays retired.
  select revision into v_rev from public.product_capabilities where capability_key = 'w2t-guide-already';
  v := pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96505, '{"feature_guide":["w2t-guide-already","w2t-guide-retired"]}'));
  perform pg_temp.t3980w2t_check('B2', 'an entry already Live keeps its claim but advances revision without inventing evidence',
    (select claimed_status || ':' || (revision = v_rev + 1)::text || ':' || (select count(*) from public.product_capability_evidence e where e.capability_id = c.id)
       from public.product_capabilities c where capability_key = 'w2t-guide-already'), 'live:true:0');
  perform pg_temp.t3980w2t_check('B2', 'a retired entry is left retired',
    (select claimed_status || ':' || revision from public.product_capabilities where capability_key = 'w2t-guide-retired') || '/'
      || (select string_agg(k->>'key' || ':' || (k->>'result'), ',' order by k->>'key') from public.ops_release_records r, jsonb_array_elements(r.guide_result->'keys') k where r.pr = 96505),
    'retired:1/w2t-guide-already:incomplete,w2t-guide-retired:retired');

  -- Applied once: re-reading the complete record, then a version that lost its live check, changes nothing more.
  select count(*) into v_ev from public.product_truth_audit a join public.product_capabilities c on c.id = a.capability_id where c.capability_key = 'w2t-guide-proven';
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96504, jsonb_build_object('feature_guide', jsonb_build_array('w2t-guide-proven'),
    'issues', jsonb_build_array(jsonb_build_object('number', 6401, 'relation', 'toward')))));
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96504, '{"feature_guide":["w2t-guide-proven"],"live_check":null,"problems":["live_check_missing"]}'));
  perform pg_temp.t3980w2t_reconcile();
  perform pg_temp.t3980w2t_check('B2', 're-reading a complete record never applies it twice, and losing its live check later undoes nothing',
    (select claimed_status from public.product_capabilities where capability_key = 'w2t-guide-proven') || '/'
      || ((select count(*) from public.product_truth_audit a join public.product_capabilities c on c.id = a.capability_id where c.capability_key = 'w2t-guide-proven') = v_ev)::text,
    'live/true');

  -- [TEST-MOD-APPROVED #4179] The revision guard: invalidation and the
  -- completed release each advance the revision, so a stale editor is refused.
  select revision into v_rev from public.product_capabilities where capability_key = 'w2t-guide-revision';
  perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(96506, '{"feature_guide":["w2t-guide-revision"]}'));
  v := pg_temp.t3980w2t_person('admin', format($q$select public.issue_3720_save_feature_capability('w2t-guide-revision', %s, 'W2T entry an admin is editing',
    'W2T entry an admin is editing: hosts can use it today. Edited.', array['staff'], array['admin'], 'Open Admin and use W2T entry an admin is editing there.',
    'None known yet.', 'W2T entry an admin is editing works for every host.', 'planned',
    array['source','release_record','live_check'], null)::text$q$, v_rev));
  perform pg_temp.t3980w2t_like('B2', 'an admin saving with the revision from before the flip is refused, so the flip is never overwritten', v, 'ERR:PT409:stale_revision%');
  perform pg_temp.t3980w2t_check('B2', 'and the entry stays Live',
    (select claimed_status || ':' || (revision = v_rev + 2)::text from public.product_capabilities where capability_key = 'w2t-guide-revision'), 'live:true');
end;
$b2$;

-- ---------------------------------------------------------------------------
-- B3: the ticket's Engineering row in every state.
-- ---------------------------------------------------------------------------
do $b3$
declare v text; r record; i int := 0;
begin
  for r in select * from (values
      (6601, 'Todo', null::text, 'Planned'), (6602, 'In Progress', null, 'In Progress'), (6603, 'In Review', null, 'In Review'),
      (6604, 'Done', 'incomplete', 'Shipped'), (6605, 'Done', 'complete', 'Live'), (6606, 'Done', 'unread', 'Shipped'),
      (6607, 'Todo', 'unread', 'Planned'), (6608, 'In Review', 'unread', 'In Review'), (6609, null, 'unread', 'Planned')) t(n, board, rec, want) loop
    i := i + 1;
    insert into public.support_product_signals (id, client_request_id, signal_kind, state, title, problem_statement, product_area, user_journey,
      impact_summary, next_update_at, next_step, customer_reply_draft, created_by)
    values (('39830000-0000-4000-c200-00000000000' || i)::uuid, gen_random_uuid(), 'bug', 'linked', 'W2T signal ' || r.n, 'Something is wrong.',
      'Payouts', 'Host waits', 'Hosts are upset', now() + interval '1 day', 'Fix it', 'We are on it.', '39830000-0000-4000-a000-000000000004');
    insert into public.product_avengers_items (id, issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status)
    values (('39830000-0000-4000-c300-00000000000' || i)::uuid, r.n, 'I_w2t' || r.n, 'PVTI_w2t' || r.n,
      'https://github.com/Mingla-LLC/mingla-main/issues/' || r.n, 'W2T issue ' || r.n, 'OPEN', r.board);
    insert into public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by)
    values (('39830000-0000-4000-c200-00000000000' || i)::uuid, ('39830000-0000-4000-c300-00000000000' || i)::uuid, 'existing', '39830000-0000-4000-a000-000000000004');
    insert into public.support_product_signal_sources (signal_id, source_kind, source_id, linked_by)
    values (('39830000-0000-4000-c200-00000000000' || i)::uuid, 'support_ticket', ('39830000-0000-4000-c400-00000000000' || i)::uuid, '39830000-0000-4000-a000-000000000004');
    -- What Mingla's cache knows: read from GitHub, missing, or never answered (unreachable).
    insert into public.ops_github_items (number, kind) values (r.n, 'issue') on conflict do nothing;
    if r.rec = 'missing' then
      perform pg_temp.t3980w2t_apply(jsonb_build_array(jsonb_build_object('number', r.n, 'found', false)));
    elsif r.rec is distinct from 'unread' then
      if r.rec in ('incomplete', 'complete') then
        perform pg_temp.t3980w2t_ingest(pg_temp.t3980w2t_record(90000 + r.n, jsonb_build_object('issues', jsonb_build_array(jsonb_build_object('number', r.n, 'relation', 'fixes')))
          || case when r.rec = 'incomplete' then '{"live_check":null,"problems":["live_check_missing"]}'::jsonb else '{}'::jsonb end), r.n);
      end if;
      perform pg_temp.t3980w2t_apply(jsonb_build_array(pg_temp.t3980w2t_gh(r.n, 'issue', r.board, null, case when r.board = 'Done' then 'CLOSED' else 'OPEN' end)));
    end if;
    v := pg_temp.t3980w2t_person('support', format('select public.ops_ticket_engineering(''support_ticket'', %L)::text', '39830000-0000-4000-c400-00000000000' || i));
    perform pg_temp.t3980w2t_check('B3', format('#%s (board %s, cache %s) reads %s and is Live only when %s', r.n, coalesce(r.board, 'none'), coalesce(r.rec, 'read'), r.want, r.want = 'Live'),
      pg_temp.t3980w2t_get(v, 'label') || ':' || pg_temp.t3980w2t_get(v, 'live'), r.want || ':' || (r.want = 'Live')::text);
  end loop;
  v := pg_temp.t3980w2t_person('support', $q$select public.ops_ticket_engineering('support_ticket', '39830000-0000-4000-c400-000000000004')::text$q$);
  perform pg_temp.t3980w2t_check('B3', 'a Shipped ticket names its incomplete record',
    pg_temp.t3980w2t_get(v, 'record', 'pr') || ':' || pg_temp.t3980w2t_get(v, 'record', 'complete'), '96604:false');
  v := pg_temp.t3980w2t_person('offsupp', $q$select public.ops_ticket_engineering('support_ticket', '39830000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.t3980w2t_like('B3', 'a teammate whose Support is switched off is refused', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980w2t_person('host', $q$select public.ops_ticket_engineering('support_ticket', '39830000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.t3980w2t_like('B3', 'a host is refused', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980w2t_as('anon', $q$select public.ops_ticket_engineering('support_ticket', '39830000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.t3980w2t_like('B3', 'an anonymous caller is refused', v, 'ERR:42501:%');
  v := pg_temp.t3980w2t_person('support', $q$select public.ops_ticket_engineering('brand_message', '39830000-0000-4000-c400-000000000001')::text$q$);
  perform pg_temp.t3980w2t_like('B3', 'a source that is not a ticket or staff thread is refused', v, 'ERR:22023:invalid_source:%');
end;
$b3$;

select count(*) as t3980w2t_total, count(*) filter (where not ok) as t3980w2t_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w2t_failures
  from t3980w2t_results \gset
rollback;

select (:t3980w2t_total < 70 or :t3980w2t_failed > 0) as t3980w2t_bad \gset
\if :t3980w2t_bad
  \echo 'ISSUE-3980 SYNCED WAVE 2 TESTER FAILED:' :t3980w2t_failed 'of' :t3980w2t_total
  \echo :t3980w2t_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 2 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 2 TESTER PASS:' :t3980w2t_total 'checks, 0 failed'
