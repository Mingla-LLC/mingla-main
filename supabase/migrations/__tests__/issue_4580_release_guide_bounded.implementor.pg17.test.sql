-- MINGLA-INVARIANT: I-4580-RELEASE-GUIDE-BOUNDED | issue #4580 | ops_release_guide_apply checks Support membership at most once per call and stops taking new Feature Guide keys once public.ops_release_guide_budget() has passed, so no release can push the ingest past its statement timeout.
-- Issue #4580 -- implementor suite for
-- 20281129004580_issue_4580_release_guide_bounded.sql, on the fully replayed
-- PG17 schema. Everything is rolled back.
--
--   SC-2   ops_release_guide_watchers() returns exactly what the old inline
--          query returned (kept below as a literal), across admins, scoped
--          members with enabled / disabled / no Support rows, revoked and
--          invited members, the owner, a mixed-case spaced email, two sign-in
--          rows sharing one email, a directory email with no sign-in row, and
--          11 qualifying people (LIMIT 10 keeps the first 10 by email).
--   SC-1   300 sign-in accounts, an 8-person team, one complete release
--          naming 100 entries: ops_release_records_ingest finishes under an
--          8 s statement timeout, all 100 entries turn Live in that call, and
--          Support membership (is_support_staff) is checked at most 10 times.
--          The old body checked it once per sign-in account per entry
--          (~30,000). Counted with track_functions and
--          pg_stat_get_xact_function_calls (so this suite runs as
--          supabase_admin, like the #4179 and #4423 suites).
--   SC-3   with ops_release_guide_budget() at 0 s, one call takes exactly one
--          key, returns deferred, leaves guide_applied_at NULL and says so in
--          the Admin log (guide_deferred); the next call takes the next key.
--   SC-4   one pass turning 3 entries of one PR Live writes 1 notice
--          ("Feature Guide: 3 entries are Live (PR #n): A, B, C."), and still
--          3 guide_live log rows and the same audit rows per entry.
--   SC-5   an incomplete key tried 10 minutes ago is not retried (no new
--          guide_incomplete row); one tried 2 hours ago is.
--   POISON ops_release_record_poisoned writes one stopped row in the Admin log
--          per call and one notice to the owner per record comment; it
--          refuses a caller that is not the bridge (42501) and bad input
--          (22023).
--   LOG    ops_agent_log_action_check keeps every older action and also
--          allows guide_deferred and release_record_poisoned; the outcome rule
--          is unchanged.
--   GRANTS the three new functions are closed to anon and authenticated.
--
-- Run from the repository root as supabase_admin.
--
-- FAILS-ON-REVERT: on origin/main's definitions (71c219c91b) the new
-- functions do not exist; SC-1 counts ~30,000 is_support_staff calls, SC-3
-- takes every key under a 0 s budget, SC-4 writes 3 notices and SC-5
-- retries the recent key.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(left(p_want, 600), '<null>')));
$fn$;
-- Run a statement; return 'ok' or its SQLSTATE (nothing aborts the suite).
create function pg_temp.state(p_sql text) returns text
language plpgsql as $fn$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$fn$;
-- ops_release_guide_apply(), or the error it stopped on.
create function pg_temp.apply() returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  v := public.ops_release_guide_apply();
  return v;
exception when others then
  return jsonb_build_object('error', sqlstate, 'message', sqlerrm);
end;
$fn$;
-- The new watchers helper, or NULL where it does not exist.
create function pg_temp.new_watchers() returns text[]
language plpgsql as $fn$
declare v text[];
begin
  execute 'select public.ops_release_guide_watchers()' into v;
  return v;
exception when undefined_function then
  return null;
end;
$fn$;
-- The old inline query, word for word (owner excluded by ops_owner_email()).
create function pg_temp.old_watchers() returns text[]
language sql as $fn$
  select array(select d.email from public.admin_team_directory() d
                 join auth.users u on lower(btrim(u.email)) = d.email
                where d.status = 'active' and d.email is distinct from public.ops_owner_email() and public.is_support_staff(u.id)
                group by d.email order by d.email limit 10);
$fn$;

-- ───────────────────────────── people ─────────────────────────────
-- 300 sign-in accounts that are nobody on the team.
insert into auth.users (id, email, email_confirmed_at)
select ('45800000-0000-4000-b000-' || lpad(g::text, 12, '0'))::uuid, format('u%s.r4580@test.local', g), now()
  from generate_series(1, 300) g;
create temp table tx_people (who text primary key, id uuid, auth_email text, dir_email text) on commit drop;
insert into tx_people values
  ('own',  '45800000-0000-4000-a000-000000000001', 'own.r4580@test.local',     'own.r4580@test.local'),
  ('adm1', '45800000-0000-4000-a000-000000000002', 'adm1.r4580@test.local',    'adm1.r4580@test.local'),
  ('adm2', '45800000-0000-4000-a000-000000000003', 'adm2.r4580@test.local',    'adm2.r4580@test.local'),
  ('sup1', '45800000-0000-4000-a000-000000000004', 'sup1.r4580@test.local',    'sup1.r4580@test.local'),
  ('sup2', '45800000-0000-4000-a000-000000000005', '  Sup2.R4580@Test.Local ', 'sup2.r4580@test.local'),
  ('dis',  '45800000-0000-4000-a000-000000000006', 'dis.r4580@test.local',     'dis.r4580@test.local'),
  ('nos',  '45800000-0000-4000-a000-000000000007', 'nos.r4580@test.local',     'nos.r4580@test.local'),
  ('rev',  '45800000-0000-4000-a000-000000000008', 'rev.r4580@test.local',     'rev.r4580@test.local'),
  ('inv',  '45800000-0000-4000-a000-000000000009', 'inv.r4580@test.local',     'inv.r4580@test.local'),
  ('dup',  '45800000-0000-4000-a000-00000000000a', 'dup.r4580@test.local',     'dup.r4580@test.local'),
  ('dup2', '45800000-0000-4000-a000-00000000000b', ' DUP.r4580@test.local',    'dup.r4580@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, auth_email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('own.r4580@test.local', 'owner', 'active', now()),
  ('adm1.r4580@test.local', 'admin', 'active', now()),
  ('adm2.r4580@test.local', 'admin', 'active', now()),
  ('inv.r4580@test.local', 'admin', 'invited', null),
  ('dup.r4580@test.local', 'admin', 'active', now()),
  ('ghost.r4580@test.local', 'admin', 'active', now());  -- no sign-in account
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('sup1.r4580@test.local', 'growth', 'active', now()),
  ('sup2.r4580@test.local', 'growth', 'active', now()),
  ('dis.r4580@test.local', 'growth', 'active', now()),
  ('nos.r4580@test.local', 'growth', 'active', now()),
  ('rev.r4580@test.local', 'growth', 'revoked', now());
insert into public.support_staff (user_id, enabled, display_name)
select id, who <> 'dis', who from tx_people where who in ('sup1', 'sup2', 'dis', 'rev');

-- ───────────────────────────── SC-2: the same people ─────────────────────────────
select pg_temp.chk('SC-2', 'watchers equal the old inline query',
  pg_temp.new_watchers()::text, pg_temp.old_watchers()::text);
select pg_temp.chk('SC-2', 'watchers are exactly the five qualifying people, by email',
  pg_temp.new_watchers()::text,
  array['adm1.r4580@test.local', 'adm2.r4580@test.local', 'dup.r4580@test.local', 'sup1.r4580@test.local', 'sup2.r4580@test.local']::text);
savepoint eleven;
insert into auth.users (id, email, email_confirmed_at)
select ('45800000-0000-4000-c000-' || lpad(g::text, 12, '0'))::uuid, format('zz%s.r4580@test.local', g), now() from generate_series(1, 6) g;
insert into public.admin_users (email, role, status, accepted_at)
select format('zz%s.r4580@test.local', g), 'admin', 'active', now() from generate_series(1, 6) g;
select pg_temp.chk('SC-2', '11 qualifying people: equal to the old query', pg_temp.new_watchers()::text, pg_temp.old_watchers()::text);
select pg_temp.chk('SC-2', '11 qualifying people: LIMIT 10 keeps the first 10 by email',
  (select cardinality(w)::text || ':' || (w[10]) || ':' || (not 'zz6.r4580@test.local' = any (w))::text from pg_temp.new_watchers() w),
  '10:zz5.r4580@test.local:true');
rollback to savepoint eleven;

-- ───────────────────────────── catalog fixtures ─────────────────────────────
create function pg_temp.cap(p_key text, p_title text, p_kinds text[] default array['source']) returns void
language sql as $fn$
  insert into public.product_capabilities (capability_key, title, outcome_summary, who_can_use, surfaces, how_to, limitations,
                                           support_wording, required_evidence_kinds)
  values (p_key, p_title, 'A synthetic Feature Guide entry for the #4580 suite.', array['staff'], array['admin'],
          'Open Admin and look at the synthetic entry.', 'Synthetic only.', 'This entry exists only inside the #4580 suite.', p_kinds);
$fn$;
select pg_temp.cap(format('r4580-bulk-%s', lpad(g::text, 3, '0')), format('R4580 Bulk %s', lpad(g::text, 3, '0'))) from generate_series(1, 100) g;
select pg_temp.cap('r4580-sc3-a', 'R4580 Budget A'), pg_temp.cap('r4580-sc3-b', 'R4580 Budget B'), pg_temp.cap('r4580-sc3-c', 'R4580 Budget C');
select pg_temp.cap('r4580-sc4-a', 'R4580 Alpha'), pg_temp.cap('r4580-sc4-b', 'R4580 Bravo'), pg_temp.cap('r4580-sc4-c', 'R4580 Charlie');
select pg_temp.cap('r4580-sc5-a', 'R4580 Recent', array['source', 'app_release']),
       pg_temp.cap('r4580-sc5-b', 'R4580 Stale', array['source', 'app_release']);

-- A complete release record, written straight into the table (the capture
-- trigger makes its pending keys).
create function pg_temp.record(p_pr integer, p_keys text[]) returns void
language sql as $fn$
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, deploy_marker, feature_guide, live_check,
                                          complete, completed_at, comment_urls)
  values (p_pr, format('Release %s', p_pr), 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr, now(), repeat('b', 40), false, p_keys,
          jsonb_build_object('text', 'checked', 'by_login', 'sethogieva', 'url', 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-1', 'at', now()),
          true, now(), jsonb_build_object('4580', format('https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-%s', p_pr)));
$fn$;
-- Distinct Live notices that name a PR.
create function pg_temp.notices(p_pr integer) returns text
language sql as $fn$
  select count(distinct m.source_id)::text from public.team_mentions m
   where m.source_kind = 'ops_activity' and m.event_kind = 'guide' and m.body_excerpt like '%(PR #' || p_pr || ')%';
$fn$;

-- ───────────────────────────── SC-1: 100 entries, one ingest call ─────────────────────────────
select set_config('request.jwt.claim.role', 'service_role', true);
create temp table tx_bulk_records on commit drop as
select jsonb_build_array(jsonb_build_object(
  'data', jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', 994580, 'title', 'Bulk release of 100 entries',
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/994580', 'merged_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', repeat('c', 40), 'issues', '[]'::jsonb, 'migrations_added', '[]'::jsonb, 'edge_functions', '[]'::jsonb,
    'web_projects', '[]'::jsonb, 'deploy_marker', false, 'deploy', '{"web":{},"edge":"none"}'::jsonb,
    'feature_guide', (select jsonb_agg(format('r4580-bulk-%s', lpad(g::text, 3, '0')) order by g) from generate_series(1, 100) g),
    'live_check', jsonb_build_object('text', 'checked', 'by_login', 'sethogieva',
      'url', 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-2', 'at', now()),
    'problems', '[]'::jsonb),
  'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-994580',
  'issue_number', 4580, 'commented_at', now())) as p;
set local track_functions = 'all';
set local statement_timeout = '8s';
create temp table tx_ingest on commit drop as
select clock_timestamp() as t0, public.ops_release_records_ingest((select p from tx_bulk_records)) as res, clock_timestamp() as t1;
set local statement_timeout = 0;
create temp table tx_support_calls on commit drop as
select coalesce(pg_stat_get_xact_function_calls('public.is_support_staff'::regproc), 0) as n;
set local track_functions = 'none';
select pg_temp.chk('SC-1', 'the ingest stored and completed the release', (select (res->'completed')::text from tx_ingest), '[994580]');
select pg_temp.chk('SC-1', 'all 100 entries turned Live in that call',
  (select count(*) filter (where result = 'live' and applied_at is not null)::text from public.ops_release_guide_keys where pr = 994580), '100');
select pg_temp.chk('SC-1', 'the release is fully applied', (select (guide_applied_at is not null)::text from public.ops_release_records where pr = 994580), 'true');
select pg_temp.chk('SC-1', 'Support membership checked at most 10 times for 100 entries',
  (select n::text || ':' || (n <= 10)::text from tx_support_calls), (select n::text from tx_support_calls) || ':true');
select pg_temp.chk('SC-1', 'the ingest stayed under the 4 s budget it gives the step',
  (select (t1 - t0 < interval '4 seconds')::text from tx_ingest), 'true');
select pg_temp.chk('SC-1', 'one Live notice for the release', pg_temp.notices(994580), '1');
select pg_temp.chk('SC-1', 'the notice names the count, the first three and the rest',
  (select string_agg(distinct m.body_excerpt, ' | ') from public.team_mentions m
    where m.source_kind = 'ops_activity' and m.body_excerpt like '%(PR #994580)%'),
  'Feature Guide: 100 entries are Live (PR #994580): R4580 Bulk 001, R4580 Bulk 002, R4580 Bulk 003 and 97 more.');
select pg_temp.chk('SC-1', 'the notice reaches the owner and the five Support watchers',
  (select string_agg(u.email, ',' order by u.email) from public.team_mentions m join auth.users u on u.id = m.target_user_id
    where m.source_kind = 'ops_activity' and m.body_excerpt like '%(PR #994580)%'),
  '  Sup2.R4580@Test.Local ,adm1.r4580@test.local,adm2.r4580@test.local,dup.r4580@test.local,own.r4580@test.local,sup1.r4580@test.local');

-- ───────────────────────────── SC-3: the time budget ─────────────────────────────
create or replace function public.ops_release_guide_budget() returns interval
language sql stable set search_path = pg_catalog, pg_temp as $fn$ select interval '0 seconds' $fn$;
select pg_temp.record(994581, array['r4580-sc3-a', 'r4580-sc3-b', 'r4580-sc3-c']);
create temp table tx_sc3 (n integer, res jsonb) on commit drop;
insert into tx_sc3 select 1, pg_temp.apply();
select pg_temp.chk('SC-3', 'a 0 s budget: the first call takes one key and is deferred',
  (select coalesce(res->>'error', (res->>'done') || '/' || (res->>'deferred')) from tx_sc3 where n = 1), '1/true');
select pg_temp.chk('SC-3', 'after the first call: one entry Live, two still pending',
  (select string_agg(capability_key || ':' || result, ',' order by capability_key) from public.ops_release_guide_keys where pr = 994581),
  'r4580-sc3-a:live,r4580-sc3-b:pending,r4580-sc3-c:pending');
select pg_temp.chk('SC-3', 'guide_applied_at stays NULL while entries are pending',
  (select (guide_applied_at is null)::text from public.ops_release_records where pr = 994581), 'true');
select pg_temp.chk('SC-3', 'the pause is in the Admin log',
  (select count(*)::text from public.ops_agent_log where action = 'guide_deferred' and detail->>'pr' = '994581' and detail->>'done' = '1'), '1');
insert into tx_sc3 select 2, pg_temp.apply();
select pg_temp.chk('SC-3', 'the second call takes the next key',
  (select string_agg(capability_key || ':' || result, ',' order by capability_key) from public.ops_release_guide_keys where pr = 994581),
  'r4580-sc3-a:live,r4580-sc3-b:live,r4580-sc3-c:pending');
create or replace function public.ops_release_guide_budget() returns interval
language sql stable set search_path = pg_catalog, pg_temp as $fn$ select interval '4 seconds' $fn$;
insert into tx_sc3 select 3, pg_temp.apply();
select pg_temp.chk('SC-3', 'with the real budget the rest goes in one call and the release is applied',
  (select coalesce(res->>'error', (res->>'deferred')) from tx_sc3 where n = 3)
    || '/' || (select (guide_applied_at is not null)::text from public.ops_release_records where pr = 994581), 'false/true');

-- ───────────────────────────── SC-4: one notice per release pass ─────────────────────────────
select pg_temp.record(994582, array['r4580-sc4-a', 'r4580-sc4-b', 'r4580-sc4-c']);
create temp table tx_sc4 on commit drop as select pg_temp.apply() as res;
select pg_temp.chk('SC-4', 'the pass turned the three entries Live',
  (select count(*)::text from public.ops_release_guide_keys where pr = 994582 and result = 'live'), '3');
select pg_temp.chk('SC-4', 'exactly one Live notice for the release', pg_temp.notices(994582), '1');
select pg_temp.chk('SC-4', 'the notice names the three entries',
  (select string_agg(distinct m.body_excerpt, ' | ') from public.team_mentions m
    where m.source_kind = 'ops_activity' and m.body_excerpt like '%(PR #994582)%'),
  'Feature Guide: 3 entries are Live (PR #994582): R4580 Alpha, R4580 Bravo, R4580 Charlie.');
select pg_temp.chk('SC-4', 'still one guide_live log row per entry',
  (select count(*)::text from public.ops_agent_log where action = 'guide_live' and detail->>'pr' = '994582'), '3');
select pg_temp.chk('SC-4', 'still the same audit rows per entry (4 evidence + 1 save each)',
  (select count(*)::text from public.product_truth_audit where metadata->>'source' = 'issue_4179_bridge_b' and metadata->>'pr' = '994582'), '15');
select pg_temp.chk('SC-4', 'a guide_live notice is still never a Work card',
  (select count(*)::text from public.ops_work_cards where auto_key like 'guide\_live%'), '0');

-- ───────────────────────────── SC-5: hourly retry of incomplete keys ─────────────────────────────
select pg_temp.record(994583, array['r4580-sc5-a', 'r4580-sc5-b']);
update public.ops_release_guide_keys set result = 'incomplete', last_attempt_at = now() - interval '10 minutes'
 where pr = 994583 and capability_key = 'r4580-sc5-a';
update public.ops_release_guide_keys set result = 'incomplete', last_attempt_at = now() - interval '2 hours'
 where pr = 994583 and capability_key = 'r4580-sc5-b';
create temp table tx_sc5 on commit drop as select pg_temp.apply() as res;
select pg_temp.chk('SC-5', 'a key tried 10 minutes ago is not retried',
  (select (last_attempt_at = now() - interval '10 minutes')::text from public.ops_release_guide_keys where pr = 994583 and capability_key = 'r4580-sc5-a'), 'true');
select pg_temp.chk('SC-5', 'and gets no new guide_incomplete row',
  (select count(*)::text from public.ops_agent_log where action = 'guide_incomplete' and detail->>'key' = 'r4580-sc5-a'), '0');
select pg_temp.chk('SC-5', 'a key tried 2 hours ago is retried',
  (select (last_attempt_at = now())::text || ':' || result from public.ops_release_guide_keys where pr = 994583 and capability_key = 'r4580-sc5-b'),
  'true:incomplete');
select pg_temp.chk('SC-5', 'and logs its guide_incomplete row',
  (select count(*)::text from public.ops_agent_log where action = 'guide_incomplete' and detail->>'key' = 'r4580-sc5-b'), '1');

-- ───────────────────────────── POISON ─────────────────────────────
select pg_temp.chk('POISON', 'the bridge records a skipped record',
  pg_temp.state($q$select public.ops_release_record_poisoned(994590, 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-994590', 'INGEST_TIMEOUT')$q$), 'ok');
select pg_temp.chk('POISON', 'twice for the same record comment',
  pg_temp.state($q$select public.ops_release_record_poisoned(994590, 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-994590', 'INGEST_TIMEOUT')$q$), 'ok');
select pg_temp.chk('POISON', 'one stopped row in the Admin log per call',
  (select count(*)::text || ':' || coalesce(min(outcome), '-') || ':' || coalesce(min(detail->>'code'), '-')
     from public.ops_agent_log where action = 'release_record_poisoned' and detail->>'pr' = '994590'), '2:stopped:INGEST_TIMEOUT');
select pg_temp.chk('POISON', 'the owner is told once per record comment',
  (select count(*)::text || ':' || coalesce(min(u.email), '-') from public.team_mentions m join auth.users u on u.id = m.target_user_id
    where m.source_kind = 'ops_activity' and m.body_excerpt like '%PR #994590%'), '1:own.r4580@test.local');
select pg_temp.chk('POISON', 'a record with no comment link is accepted',
  pg_temp.state($q$select public.ops_release_record_poisoned(994591, null, 'INGEST_FAILED')$q$), 'ok');
select pg_temp.chk('POISON', 'bad input is refused 22023',
  pg_temp.state($q$select public.ops_release_record_poisoned(0, null, 'INGEST_FAILED')$q$)
  || ',' || pg_temp.state($q$select public.ops_release_record_poisoned(10000000, null, 'INGEST_FAILED')$q$)
  || ',' || pg_temp.state($q$select public.ops_release_record_poisoned(1, 'https://example.com/x', 'INGEST_FAILED')$q$)
  || ',' || pg_temp.state($q$select public.ops_release_record_poisoned(1, null, 'not a code')$q$)
  || ',' || pg_temp.state($q$select public.ops_release_record_poisoned(1, null, null)$q$),
  '22023,22023,22023,22023,22023');
select set_config('request.jwt.claim.role', 'authenticated', true);
select pg_temp.chk('POISON', 'a caller that is not the bridge is refused 42501',
  pg_temp.state($q$select public.ops_release_record_poisoned(994592, null, 'INGEST_FAILED')$q$), '42501');
select set_config('request.jwt.claim.role', 'service_role', true);

-- ───────────────────────────── LOG ─────────────────────────────
select pg_temp.chk('LOG', 'the Admin log keeps the older actions and learns the two new ones',
  (select (pg_get_constraintdef(oid) like '%backfill_confirmed%' and pg_get_constraintdef(oid) like '%card_added%'
           and pg_get_constraintdef(oid) like '%guide_deferred%' and pg_get_constraintdef(oid) like '%release_record_poisoned%')::text
     from pg_constraint where conrelid = 'public.ops_agent_log'::regclass and conname = 'ops_agent_log_action_check'), 'true');
select pg_temp.chk('LOG', 'an unknown action is still refused 23514',
  pg_temp.state($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail) values ('system@usemingla.com', 'system', 'not_an_action', 'info', 'x', '{}')$q$), '23514');
select pg_temp.chk('LOG', 'the outcome rule is unchanged (error is still refused 23514)',
  pg_temp.state($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail) values ('system@usemingla.com', 'system', 'guide_deferred', 'error', 'x', '{}')$q$), '23514');

-- ───────────────────────────── GRANTS ─────────────────────────────
select pg_temp.chk('GRANTS', 'the new functions are closed to anon and authenticated, open to service_role',
  (select string_agg(r || ':' || coalesce(has_function_privilege(r, to_regprocedure(f), 'EXECUTE')::text, 'missing'), ',' order by f, r)
     from unnest(array['public.ops_release_guide_watchers()', 'public.ops_release_guide_budget()',
                       'public.ops_release_record_poisoned(integer, text, text)']) f,
          unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:true,anon:false,authenticated:false,service_role:true,anon:false,authenticated:false,service_role:true');
select pg_temp.chk('GRANTS', 'the definer functions pin their search_path',
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '-'), ',' order by p.proname)
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('ops_release_guide_watchers', 'ops_release_record_poisoned', 'ops_release_guide_apply')),
  'ops_release_guide_apply:true:search_path=pg_catalog, pg_temp,ops_release_guide_watchers:true:search_path=pg_catalog, pg_temp,ops_release_record_poisoned:true:search_path=pg_catalog, pg_temp');

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 30 then raise exception '#4580 release guide implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4580 release guide implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4580 release guide implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
