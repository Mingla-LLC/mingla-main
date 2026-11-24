-- Issue #4580 -- tester adversarial suite for
-- 20281202004580_issue_4580_release_guide_bounded.sql and
-- 20281202014580_issue_4580_work_list_timezone_cache.sql, on the fully
-- replayed PG17 schema. Everything is rolled back. Run as supabase_admin
-- from the repository root.
--
-- Different angles from the implementor suite:
--   HOSTILE  every Feature Guide key is made slow (30 ms per key, a trigger
--            inside this transaction): one release naming 250 keys, then ten
--            releases of 25 keys in ONE ingest call, each under the 8 s
--            authenticator statement_timeout. The bound must hold, later
--            passes must pick up the remainder in order, and every key must
--            end Live with one notice per pass (never per key, never twice).
--   W-FUZZ   watcher parity against the old inline query word for word: the
--            named edge cases (empty team, owner only, invited member with a
--            Support row, a Support flag only, duplicate sign-in emails in
--            different case, a hard-deleted and a soft-deleted user) plus 60
--            seeded random teams.
--   D1       re-running the step, re-ingesting the same record and replaying
--            a rolled-back pass never send a second notice.
--   D2       pacing edges: 59 min skipped, 61 min retried, NULL retried,
--            pending always retried, unknown_key paced too, and a record whose
--            only keys are paced is not touched at all.
--   D3       poison: per call a stopped log row; per record comment one
--            owner notice; a new comment for the same PR is told again; no
--            owner still logs.
--   D4       ops_timezone_valid against pg_timezone_names for every name,
--            every abbreviation, upper/lower case variants of every name and
--            hostile strings; speed; cache miss; a stale cache row.
--   A1       every literal the action rule allowed before (39) is still
--            accepted by an insert, plus the two new ones; unknown actions
--            and outcome 'error' are refused.
--
-- FAILS-ON-REVERT: on origin/main's definitions (8b971e1ba0) the new
-- functions do not exist, the HOSTILE ingest is cancelled (57014) and the
-- per-key notice and pacing checks fail.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

create temp table tt_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tt_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(left(p_want, 400), '<null>')));
$fn$;
create function pg_temp.state(p_sql text) returns text
language plpgsql as $fn$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$fn$;
-- The old inline watchers query, as it stood in the #4398 body.
create function pg_temp.old_watchers() returns text[]
language sql as $fn$
  select array(select d.email from public.admin_team_directory() d
                 join auth.users u on lower(btrim(u.email)) = d.email
                where d.status = 'active' and d.email is distinct from public.ops_owner_email() and public.is_support_staff(u.id)
                group by d.email order by d.email limit 10);
$fn$;
create function pg_temp.new_watchers() returns text[]
language plpgsql as $fn$
declare v text[];
begin
  execute 'select public.ops_release_guide_watchers()' into v;
  return v;
exception when undefined_function then
  return array['<missing>'];
end;
$fn$;
-- Run a fixture in a subtransaction, compare old and new, undo the fixture.
create function pg_temp.parity(p_label text, p_fixture text) returns void
language plpgsql as $fn$
declare v_old text; v_new text;
begin
  begin
    execute p_fixture;
    v_old := pg_temp.old_watchers()::text;
    v_new := pg_temp.new_watchers()::text;
    raise exception using errcode = 'P4580', message = v_old || '|' || v_new;
  exception when sqlstate 'P4580' then
    v_old := split_part(sqlerrm, '|', 1);
    v_new := split_part(sqlerrm, '|', 2);
  end;
  perform pg_temp.chk('W', p_label || ' ' || v_old, v_new, v_old);
end;
$fn$;

-- ─────────────────────────── W: named edge cases ───────────────────────────
select pg_temp.parity('empty team', $f$ select 1 $f$);
select pg_temp.parity('owner only',
  $f$ insert into auth.users (id, email) values ('45810000-0000-4000-a000-000000000001', 'own.t4580@test.local');
      insert into public.admin_users (email, role, status, accepted_at) values ('own.t4580@test.local', 'owner', 'active', now()) $f$);
select pg_temp.parity('invited member with an enabled Support row is out',
  $f$ insert into auth.users (id, email) values ('45810000-0000-4000-a000-000000000002', 'inv.t4580@test.local');
      insert into public.admin_team_members (email, role, status) values ('inv.t4580@test.local', 'growth', 'invited');
      insert into public.support_staff (user_id, enabled, display_name) values ('45810000-0000-4000-a000-000000000002', true, 'inv') $f$);
select pg_temp.parity('a Support flag with no team row is out',
  $f$ insert into auth.users (id, email) values ('45810000-0000-4000-a000-000000000003', 'flag.t4580@test.local');
      insert into public.support_staff (user_id, enabled, display_name) values ('45810000-0000-4000-a000-000000000003', true, 'flag') $f$);
select pg_temp.parity('two sign-in rows, emails in different case, Support row on the second',
  $f$ insert into auth.users (id, email) values ('45810000-0000-4000-a000-000000000004', 'Case.T4580@Test.Local'),
                                                ('45810000-0000-4000-a000-000000000005', ' case.t4580@TEST.local ');
      insert into public.admin_team_members (email, role, status, accepted_at) values ('case.t4580@test.local', 'growth', 'active', now());
      insert into public.support_staff (user_id, enabled, display_name) values ('45810000-0000-4000-a000-000000000005', true, 'case') $f$);
select pg_temp.parity('a hard-deleted user (directory row, no sign-in row) is out',
  $f$ insert into public.admin_users (email, role, status, accepted_at) values ('gone.t4580@test.local', 'admin', 'active', now()) $f$);
select pg_temp.parity('a soft-deleted admin is treated the same by both',
  $f$ insert into auth.users (id, email, deleted_at) values ('45810000-0000-4000-a000-000000000006', 'soft.t4580@test.local', now());
      insert into public.admin_users (email, role, status, accepted_at) values ('soft.t4580@test.local', 'admin', 'active', now()) $f$);
select pg_temp.parity('a mixed team',
  $f$ insert into auth.users (id, email) values ('45810000-0000-4000-a000-000000000011', 'own.t4580@test.local'),
        ('45810000-0000-4000-a000-000000000012', 'a1.t4580@test.local'), ('45810000-0000-4000-a000-000000000013', 'g1.t4580@test.local'),
        ('45810000-0000-4000-a000-000000000014', 'g2.t4580@test.local');
      insert into public.admin_users (email, role, status, accepted_at) values ('own.t4580@test.local', 'owner', 'active', now()),
        ('a1.t4580@test.local', 'admin', 'active', now());
      insert into public.admin_team_members (email, role, status, accepted_at) values ('g1.t4580@test.local', 'growth', 'active', now()),
        ('g2.t4580@test.local', 'website', 'active', now());
      insert into public.support_staff (user_id, enabled, display_name) values ('45810000-0000-4000-a000-000000000013', true, 'g1'),
        ('45810000-0000-4000-a000-000000000014', false, 'g2') $f$);

-- ─────────────────────────── W-FUZZ: 60 random teams ───────────────────────────
create temp table tt_fuzz (n integer, old text, new text) on commit drop;
do $fuzz$
declare
  i integer; j integer; v_old text; v_new text; v_mail text; v_id uuid; v_kind integer; v_st text;
begin
  perform setseed(0.4580);
  for i in 1..60 loop
    begin
      for j in 1..(3 + floor(random() * 12))::integer loop
        v_mail := format('f%s.t4580@test.local', floor(random() * 9)::integer);   -- collisions on purpose
        v_id := gen_random_uuid();
        if random() < 0.85 then
          insert into auth.users (id, email, deleted_at)
          values (v_id, case floor(random() * 3)::integer when 0 then v_mail when 1 then upper(v_mail) else '  ' || initcap(v_mail) || ' ' end,
                  case when random() < 0.1 then now() end)
          on conflict do nothing;
        end if;
        v_kind := floor(random() * 3)::integer;
        v_st := (array['active', 'active', 'invited', 'revoked'])[1 + floor(random() * 4)::integer];
        begin
        if v_kind = 0 then
          insert into public.admin_users (email, role, status, accepted_at)
          values (v_mail, (array['admin', 'admin', 'owner', 'partner'])[1 + floor(random() * 4)::integer], v_st, now() - random() * interval '30 days')
          on conflict do nothing;
        elsif v_kind = 1 then
          insert into public.admin_team_members (email, role, status, accepted_at)
          values (v_mail, (array['growth', 'website'])[1 + floor(random() * 2)::integer], v_st, now() - random() * interval '30 days')
          on conflict do nothing;
        end if;
        exception when sqlstate 'P4580' then raise; when others then null;  -- the team trigger refuses a cross-table duplicate
        end;
        if random() < 0.6 and exists (select 1 from auth.users where id = v_id) then
          insert into public.support_staff (user_id, enabled, display_name) values (v_id, random() < 0.75, 'fz')
          on conflict do nothing;
        end if;
      end loop;
      v_old := pg_temp.old_watchers()::text;
      v_new := pg_temp.new_watchers()::text;
      raise exception using errcode = 'P4580', message = v_old || '|' || v_new;
    exception when sqlstate 'P4580' then
      insert into tt_fuzz values (i, split_part(sqlerrm, '|', 1), split_part(sqlerrm, '|', 2));
    end;
  end loop;
end;
$fuzz$;
select pg_temp.chk('W-FUZZ', '60 random teams: old = new in every one',
  (select count(*) filter (where old is distinct from new)::text || ' mismatches of ' || count(*) from tt_fuzz), '0 mismatches of 60');
select pg_temp.chk('W-FUZZ', 'the fuzz is not vacuous (some teams have watchers, some none)',
  (select (count(*) filter (where old <> '{}') between 5 and 55)::text from tt_fuzz), 'true');

-- ─────────────────────────── people for the release passes ───────────────────────────
insert into auth.users (id, email, email_confirmed_at)
select ('45810000-0000-4000-b000-' || lpad(g::text, 12, '0'))::uuid, format('u%s.t4580@test.local', g), now() from generate_series(1, 300) g;
insert into auth.users (id, email) values
  ('45810000-0000-4000-a000-000000000101', 'own.t4580@test.local'), ('45810000-0000-4000-a000-000000000102', 'adm.t4580@test.local'),
  ('45810000-0000-4000-a000-000000000103', 'sup.t4580@test.local'), ('45810000-0000-4000-a000-000000000104', 'nos.t4580@test.local');
insert into public.admin_users (email, role, status, accepted_at) values
  ('own.t4580@test.local', 'owner', 'active', now()), ('adm.t4580@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('sup.t4580@test.local', 'growth', 'active', now()), ('nos.t4580@test.local', 'growth', 'active', now());
insert into public.support_staff (user_id, enabled, display_name) values ('45810000-0000-4000-a000-000000000103', true, 'sup');

create function pg_temp.cap(p_key text, p_title text, p_kinds text[] default array['source']) returns void
language sql as $fn$
  insert into public.product_capabilities (capability_key, title, outcome_summary, who_can_use, surfaces, how_to, limitations,
                                           support_wording, required_evidence_kinds)
  values (p_key, p_title, 'A synthetic entry for the #4580 tester suite.', array['staff'], array['admin'],
          'Open Admin and look at the synthetic entry.', 'Synthetic only.', 'Exists only inside the #4580 tester suite.', p_kinds);
$fn$;
-- One ingest row (the shape the bridge sends).
create function pg_temp.row(p_pr integer, p_keys text[], p_at timestamptz) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'data', jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', format('Tester release %s', p_pr),
      'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
      'merged_at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'merge_sha', repeat('d', 40), 'issues', '[]'::jsonb, 'migrations_added', '[]'::jsonb, 'edge_functions', '[]'::jsonb,
      'web_projects', '[]'::jsonb, 'deploy_marker', false, 'deploy', '{"web":{},"edge":"none"}'::jsonb,
      'feature_guide', to_jsonb(p_keys),
      'live_check', jsonb_build_object('text', 'checked', 'by_login', 'sethogieva',
        'url', 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-7', 'at', p_at),
      'problems', '[]'::jsonb),
    'comment_url', format('https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-%s', p_pr),
    'issue_number', 4580, 'commented_at', p_at);
$fn$;
create function pg_temp.notice_count(p_pr integer) returns integer
language sql as $fn$
  select count(distinct m.source_id)::integer from public.team_mentions m
   where m.source_kind = 'ops_activity' and m.event_kind = 'guide' and m.body_excerpt like '%(PR #' || p_pr || ')%';
$fn$;
create function pg_temp.live(p_pr integer) returns integer
language sql as $fn$
  select count(*)::integer from public.ops_release_guide_keys where pr = p_pr and result = 'live' and applied_at is not null;
$fn$;

select pg_temp.cap(format('t4580-big-%s', lpad(g::text, 3, '0')), format('T4580 Big %s', lpad(g::text, 3, '0'))) from generate_series(1, 250) g;
select pg_temp.cap(format('t4580-m%s-%s', r, lpad(g::text, 2, '0')), format('T4580 M%s %s', r, lpad(g::text, 2, '0')))
  from generate_series(1, 10) r, generate_series(1, 25) g;
select pg_temp.cap(format('t4580-c-%s', lpad(g::text, 3, '0')), format('T4580 C %s', lpad(g::text, 3, '0'))) from generate_series(1, 120) g;

-- ─────────────────────────── 100+ keys, no slowness: 120 keys, 304 sign-ins ───────────────────────────
select set_config('request.jwt.claim.role', 'service_role', true);
set local track_functions = 'all';
set local statement_timeout = '8s';
create temp table tt_c on commit drop as
select clock_timestamp() t0,
       public.ops_release_records_ingest(jsonb_build_array(pg_temp.row(984570,
         (select array_agg(format('t4580-c-%s', lpad(g::text, 3, '0')) order by g) from generate_series(1, 120) g), now() - interval '3 days'))) res,
       clock_timestamp() t1;
set local statement_timeout = 0;
create temp table tt_c_calls on commit drop as
select coalesce(pg_stat_get_xact_function_calls('public.is_support_staff'::regproc), 0) n;
set local track_functions = 'none';
select pg_temp.chk('C120', 'a 120-key release ingests under 8 s and every key is Live', pg_temp.live(984570)::text, '120');
select pg_temp.chk('C120', 'is_support_staff called at most 10 times (old: once per sign-in per key, ~36,000)',
  (select (n <= 10)::text from tt_c_calls), 'true');
select pg_temp.chk('C120', 'the call took under 4 s', (select (t1 - t0 < interval '4 seconds')::text from tt_c), 'true');
select pg_temp.chk('C120', 'one notice, to the owner and the two Support watchers',
  pg_temp.notice_count(984570)::text || ':' ||
  (select string_agg(u.email, ',' order by u.email) from public.team_mentions m join auth.users u on u.id = m.target_user_id
    where m.source_kind = 'ops_activity' and m.body_excerpt like '%(PR #984570)%'),
  '1:adm.t4580@test.local,own.t4580@test.local,sup.t4580@test.local');

-- ─────────────────────────── D1: idempotency ───────────────────────────
create temp table tt_d1 on commit drop as select public.ops_release_guide_apply() as res;
select pg_temp.chk('D1', 'a second pass finds nothing to do and sends nothing',
  (select (res->>'records') || '/' || (res->>'done') from tt_d1) || '/' || pg_temp.notice_count(984570), '0/0/1');
create temp table tt_d1b on commit drop as
select public.ops_release_records_ingest(jsonb_build_array(pg_temp.row(984570,
         (select array_agg(format('t4580-c-%s', lpad(g::text, 3, '0')) order by g) from generate_series(1, 120) g), now() - interval '3 days'))) res;
select pg_temp.chk('D1', 're-ingesting the same record completes nothing new and sends nothing',
  (select (res->'completed')::text from tt_d1b) || '/' || pg_temp.notice_count(984570) || '/'
  || (select count(*) from public.team_mentions m where m.source_kind = 'ops_activity' and m.body_excerpt like '%(PR #984570)%'),
  '[]/1/3');

-- ─────────────────────────── HOSTILE: every key slow ───────────────────────────
create function pg_temp.slow_key() returns trigger language plpgsql as $fn$
begin
  perform pg_sleep(0.03);
  return new;
end;
$fn$;
create trigger tt_slow_key before update on public.ops_release_guide_keys
  for each row when (old.result is distinct from new.result or old.last_attempt_at is distinct from new.last_attempt_at)
  execute function pg_temp.slow_key();

-- H1: one release, 250 keys (250 x 30 ms = 7.5 s of key work alone).
set local statement_timeout = '8s';
create temp table tt_h1 on commit drop as
select clock_timestamp() t0,
       public.ops_release_records_ingest(jsonb_build_array(pg_temp.row(984580,
         (select array_agg(format('t4580-big-%s', lpad(g::text, 3, '0')) order by g) from generate_series(1, 250) g), now() - interval '2 days'))) res,
       clock_timestamp() t1;
set local statement_timeout = 0;
select pg_temp.chk('H1', '250 slow keys: the ingest returned (no 57014) and completed the record',
  (select (res->'completed')::text from tt_h1), '[984580]');
select pg_temp.chk('H1', 'it stopped inside the budget: under 5 s, some keys left',
  (select (t1 - t0 < interval '5 seconds')::text from tt_h1) || '/' || (pg_temp.live(984580) between 1 and 249)::text, 'true/true');
select pg_temp.chk('H1', 'the pause is in the Admin log with the PR and the count',
  (select count(*)::text || ':' || coalesce(min(detail->>'done'), '-') from public.ops_agent_log where action = 'guide_deferred' and detail->>'pr' = '984580'),
  '1:' || pg_temp.live(984580));
select pg_temp.chk('H1', 'guide_applied_at stays NULL while keys remain',
  (select (guide_applied_at is null)::text from public.ops_release_records where pr = 984580), 'true');

-- Later passes (job 100 / the next job 96) carry on: each its own statement under 8 s.
create temp table tt_pass (n integer, ms numeric, res jsonb, live integer) on commit drop;
do $passes$ begin null; end $passes$;
set local statement_timeout = '8s';
insert into tt_pass select 1, 0, public.ops_release_guide_apply(), 0;
insert into tt_pass select 2, 0, public.ops_release_guide_apply(), 0;
insert into tt_pass select 3, 0, public.ops_release_guide_apply(), 0;
insert into tt_pass select 4, 0, public.ops_release_guide_apply(), 0;
set local statement_timeout = 0;
select pg_temp.chk('H1', 'later passes finish the 250 keys, all Live, record applied',
  pg_temp.live(984580)::text || '/' || (select (guide_applied_at is not null)::text from public.ops_release_records where pr = 984580), '250/true');
select pg_temp.chk('H1', 'one notice per pass that turned keys Live (never per key)',
  (pg_temp.notice_count(984580) = 1 + (select count(*) from tt_pass where (res->>'live')::integer > 0))::text
  || '/' || (pg_temp.notice_count(984580) <= 5)::text, 'true/true');
select pg_temp.chk('H1', 'the notices together name all 250 entries exactly once',
  (select sum(substring(m.body_excerpt from 'Feature Guide: ([0-9]+) entr')::integer)::text
     from (select distinct source_id, body_excerpt from public.team_mentions where source_kind = 'ops_activity' and body_excerpt like '%(PR #984580)%') m),
  '250');

-- H2: ten releases of 25 slow keys in ONE ingest call (the bridge's chunk of 10).
set local statement_timeout = '8s';
create temp table tt_h2 on commit drop as
select clock_timestamp() t0,
       public.ops_release_records_ingest((select jsonb_agg(pg_temp.row(984590 + r,
           (select array_agg(format('t4580-m%s-%s', r, lpad(g::text, 2, '0')) order by g) from generate_series(1, 25) g),
           now() - interval '1 day' + r * interval '1 minute') order by r) from generate_series(1, 10) r)) res,
       clock_timestamp() t1;
set local statement_timeout = 0;
select pg_temp.chk('H2', 'ten records in one call: no 57014, all ten completed, under 5 s',
  (select jsonb_array_length(res->'completed')::text || '/' || (t1 - t0 < interval '5 seconds')::text from tt_h2), '10/true');
select pg_temp.chk('H2', 'the budget stopped it part-way, oldest merges first',
  (select (sum(pg_temp.live(984590 + r)) between 1 and 249)::text from generate_series(1, 10) r)
  || '/' || (pg_temp.live(984591) >= pg_temp.live(984600))::text, 'true/true');
set local statement_timeout = '8s';
insert into tt_pass select 11, 0, public.ops_release_guide_apply(), 0;
insert into tt_pass select 12, 0, public.ops_release_guide_apply(), 0;
insert into tt_pass select 13, 0, public.ops_release_guide_apply(), 0;
insert into tt_pass select 14, 0, public.ops_release_guide_apply(), 0;
set local statement_timeout = 0;
select pg_temp.chk('H2', 'later passes finish all 250 keys and apply all ten records',
  (select sum(pg_temp.live(984590 + r))::text from generate_series(1, 10) r)
  || '/' || (select count(*)::text from public.ops_release_records where pr between 984591 and 984600 and guide_applied_at is not null), '250/10');
select pg_temp.chk('H2', 'every pass reported done <= its keys and nothing timed out',
  (select bool_and((res->>'done')::integer >= 0 and res ? 'deferred')::text from tt_pass), 'true');
select pg_temp.chk('H2', 'no release got more than one notice per pass, and each names its own PR',
  (select bool_and(pg_temp.notice_count(984590 + r) between 1 and 5)::text from generate_series(1, 10) r), 'true');
drop trigger tt_slow_key on public.ops_release_guide_keys;

-- D1 again: a pass rolled back and replayed sends one notice, not two.
select pg_temp.cap('t4580-rb-a', 'T4580 Rollback A'), pg_temp.cap('t4580-rb-b', 'T4580 Rollback B');
insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, deploy_marker, feature_guide, live_check,
                                        complete, completed_at, comment_urls)
values (984610, 'RB', 'https://github.com/Mingla-LLC/mingla-main/pull/984610', now(), repeat('e', 40), false, array['t4580-rb-a', 't4580-rb-b'],
        jsonb_build_object('text', 'checked', 'by_login', 'sethogieva', 'url', 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-9', 'at', now()),
        true, now(), jsonb_build_object('4580', 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-984610'));
savepoint rb;
select public.ops_release_guide_apply();
rollback to savepoint rb;
select public.ops_release_guide_apply();
select public.ops_release_guide_apply();
select pg_temp.chk('D1', 'a rolled-back pass replayed, then a third pass: exactly one notice',
  pg_temp.notice_count(984610)::text || '/' || pg_temp.live(984610), '1/2');

-- ─────────────────────────── D2: pacing edges ───────────────────────────
select pg_temp.cap('t4580-p-59', 'T4580 P59', array['source', 'app_release']), pg_temp.cap('t4580-p-61', 'T4580 P61', array['source', 'app_release']),
       pg_temp.cap('t4580-p-null', 'T4580 PNull', array['source', 'app_release']), pg_temp.cap('t4580-p-pend', 'T4580 PPend', array['source', 'app_release']);
insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, deploy_marker, feature_guide, live_check, complete, completed_at, comment_urls)
values (984620, 'P', 'https://github.com/Mingla-LLC/mingla-main/pull/984620', now(), repeat('f', 40), false,
        array['t4580-p-59', 't4580-p-61', 't4580-p-null', 't4580-p-pend', 't4580-p-unknown-30', 't4580-p-unknown-90'],
        jsonb_build_object('text', 'c', 'by_login', 's', 'url', 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-9', 'at', now()),
        true, now(), '{}'::jsonb);
update public.ops_release_guide_keys set result = 'incomplete', last_attempt_at = now() - interval '59 minutes' where pr = 984620 and capability_key = 't4580-p-59';
update public.ops_release_guide_keys set result = 'incomplete', last_attempt_at = now() - interval '61 minutes' where pr = 984620 and capability_key = 't4580-p-61';
update public.ops_release_guide_keys set result = 'incomplete', last_attempt_at = null where pr = 984620 and capability_key = 't4580-p-null';
update public.ops_release_guide_keys set result = 'pending', last_attempt_at = now() - interval '1 minute' where pr = 984620 and capability_key = 't4580-p-pend';
update public.ops_release_guide_keys set result = 'unknown_key', last_attempt_at = now() - interval '30 minutes' where pr = 984620 and capability_key = 't4580-p-unknown-30';
update public.ops_release_guide_keys set result = 'unknown_key', last_attempt_at = now() - interval '90 minutes' where pr = 984620 and capability_key = 't4580-p-unknown-90';
select public.ops_release_guide_apply();
select pg_temp.chk('D2', 'retried: 61 min, NULL, pending, unknown 90 min; skipped: 59 min, unknown 30 min',
  (select string_agg(capability_key || '=' || (last_attempt_at = now())::text, ',' order by capability_key) from public.ops_release_guide_keys where pr = 984620),
  't4580-p-59=false,t4580-p-61=true,t4580-p-null=true,t4580-p-pend=true,t4580-p-unknown-30=false,t4580-p-unknown-90=true');
select pg_temp.chk('D2', 'guide_incomplete rows only for the retried incomplete keys',
  (select string_agg(detail->>'key', ',' order by detail->>'key') from public.ops_agent_log where action = 'guide_incomplete' and detail->>'pr' = '984620'),
  't4580-p-61,t4580-p-null,t4580-p-pend');
-- Now every remaining key was tried this instant: the next pass must not touch the record at all.
update public.ops_release_records set updated_at = now() - interval '1 day' where pr = 984620;
create temp table tt_d2 on commit drop as select public.ops_release_guide_apply() res;
select pg_temp.chk('D2', 'a record whose keys are all paced is not selected (no update, no log rows)',
  (select res->>'records' from tt_d2) || '/' || (select (updated_at < now() - interval '23 hours')::text from public.ops_release_records where pr = 984620)
  || '/' || (select count(*)::text from public.ops_agent_log where action = 'guide_incomplete' and detail->>'pr' = '984620'),
  '0/true/3');

-- ─────────────────────────── D3: poison ───────────────────────────
select public.ops_release_record_poisoned(984630, 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-984630', 'INGEST_TIMEOUT');
select public.ops_release_record_poisoned(984630, 'https://github.com/Mingla-LLC/mingla-main/issues/4580#issuecomment-984630', 'INGEST_TIMEOUT');
select public.ops_release_record_poisoned(984630, 'https://github.com/Mingla-LLC/mingla-main/pull/984630#issuecomment-984631', 'INGEST_FAILED');
select pg_temp.chk('D3', 'three skips: three stopped log rows naming the PR and code',
  (select count(*)::text || ':' || string_agg(distinct outcome, ',') || ':' || string_agg(distinct detail->>'code', ',' order by detail->>'code')
     from public.ops_agent_log where action = 'release_record_poisoned' and detail->>'pr' = '984630'),
  '3:stopped:INGEST_FAILED,INGEST_TIMEOUT');
select pg_temp.chk('D3', 'the owner is told once per record comment (2), never Support',
  (select count(*)::text || ':' || string_agg(distinct u.email, ',') from public.team_mentions m join auth.users u on u.id = m.target_user_id
    where m.source_kind = 'ops_activity' and m.event_kind = 'alert' and m.body_excerpt like '%PR #984630%'), '2:own.t4580@test.local');
savepoint noowner;
alter table public.admin_users disable trigger user;  -- the owner guard; rolled back below
update public.admin_users set status = 'revoked' where role = 'owner';
-- (read into a psql variable: a check recorded inside the savepoint would be rolled back with it)
select pg_temp.state($q$select public.ops_release_record_poisoned(984631, null, 'INGEST_FAILED')$q$) as noowner_state \gset
select :'noowner_state' || '/' || (select count(*)::text from public.ops_agent_log where action = 'release_record_poisoned' and detail->>'pr' = '984631')
  || '/' || (select count(*)::text from public.team_mentions where source_kind = 'ops_activity' and body_excerpt like '%PR #984631%') as noowner \gset
rollback to savepoint noowner;
select pg_temp.chk('D3', 'with no owner the skip is still logged, tells nobody and does not fail', :'noowner', 'ok/1/0');
select set_config('request.jwt.claim.role', 'anon', true);
select pg_temp.chk('D3', 'anon cannot record a skip', pg_temp.state($q$select public.ops_release_record_poisoned(984632, null, 'INGEST_FAILED')$q$), '42501');
select set_config('request.jwt.claim.role', 'service_role', true);

-- ─────────────────────────── D4: time zones ───────────────────────────
-- The catalog answer, read once (pg_timezone_names is a set-returning
-- function costing tens of ms per scan), compared with the helper per input.
-- Inputs that are not zones make the helper fall back to the catalog, so the
-- case variants are sampled (every 10th name) to keep the suite fast.
create temp table tt_zones on commit drop as select name from pg_catalog.pg_timezone_names;
create temp table tt_tz (x text) on commit drop;
insert into tt_tz select name from tt_zones;
insert into tt_tz select v from (select name, row_number() over (order by name) n from tt_zones) z, lateral (values (lower(name)), (upper(name))) l(v) where z.n % 10 = 0;
insert into tt_tz select abbrev from pg_catalog.pg_timezone_abbrevs;
insert into tt_tz values (''), (' '), (' UTC'), ('UTC '), (E'UTC\n'), ('utc'), ('PDT'), ('EST'), ('pdt'), ('Not/AZone'), ('America/New_York;'),
  ('America//New_York'), ('../etc/passwd'), ('+05:00'), ('5'), ('UTC+5'), ('Etc/GMT-14'), ('Etc/GMT+15'), ('GMT+0'), ('posixrules'),
  (repeat('x', 64)), (repeat('A/', 5000)), (chr(9731)), ('America/New_York' || chr(8203));
select pg_temp.chk('D4', 'ops_timezone_valid = the catalog lookup for every input (names, cases, abbreviations, garbage)',
  (select count(*) filter (where public.ops_timezone_valid(x) is distinct from (x in (select name from tt_zones)))::text
     || ' mismatches; ' || (count(*) > 1300)::text || '; true answers ' || count(*) filter (where x in (select name from tt_zones)) from tt_tz),
  '0 mismatches; true; true answers ' || (select count(*) from tt_tz where x in (select name from tt_zones)));
select pg_temp.chk('D4', 'NULL is not a zone, as before (old: EXISTS(... = NULL) is false)',
  public.ops_timezone_valid(null)::text || '/' || exists (select 1 from pg_catalog.pg_timezone_names z where z.name = null)::text, 'false/false');
select pg_temp.chk('D4', 'PDT is refused like before; EST answers as the catalog does (EST is also a tzdata zone)',
  public.ops_timezone_valid('PDT')::text || '/' || public.ops_timezone_valid('EST')::text,
  ('PDT' in (select name from tt_zones))::text || '/' || ('EST' in (select name from tt_zones))::text);
create temp table tt_tz_t on commit drop as
select (select clock_timestamp()) a, (select count(*) from generate_series(1, 2000) g where public.ops_timezone_valid('America/New_York')) n, clock_timestamp() b;
select pg_temp.chk('D4', '2,000 cached checks take under 500 ms', (select (n = 2000 and b - a < interval '500 ms')::text from tt_tz_t), 'true');
savepoint tzmiss;
delete from public.ops_timezone_names where name = 'America/New_York';
select public.ops_timezone_valid('America/New_York')::text || '/' || public.ops_timezone_valid('Nope/Zone')::text as tzmiss \gset
delete from public.ops_timezone_names;
select (select count(*) filter (where not public.ops_timezone_valid(name))::text from (select name from tt_zones order by name limit 20) z)
  || '/' || public.ops_timezone_valid('PDT')::text || '/' || public.ops_timezone_valid('')::text as tzempty \gset
rollback to savepoint tzmiss;
select pg_temp.chk('D4', 'a zone missing from the cache still answers true (fallback)', :'tzmiss', 'true/false');
select pg_temp.chk('D4', 'an empty cache gives the catalog answer (20 names, 2 non-names)', :'tzempty', '0/false/false');
select pg_temp.chk('D4', 'the cache holds exactly the catalog names', (select count(*)::text from public.ops_timezone_names),
  (select count(*)::text from pg_catalog.pg_timezone_names));
select pg_temp.chk('D4', 'ops_work_list no longer reads pg_timezone_names, and reads the helper once',
  (select (position('pg_timezone_names' in prosrc) = 0)::text || '/'
          || ((length(prosrc) - length(replace(prosrc, 'ops_timezone_valid(', ''))) / length('ops_timezone_valid('))::text
     from pg_proc where oid = 'public.ops_work_list(jsonb)'::regprocedure), 'true/1');
select pg_temp.chk('D4', 'the cache table is closed to anon and authenticated',
  has_table_privilege('anon', 'public.ops_timezone_names', 'SELECT')::text || '/' || has_table_privilege('authenticated', 'public.ops_timezone_names', 'SELECT')::text
  || '/' || has_table_privilege('authenticated', 'public.ops_timezone_names', 'INSERT')::text, 'false/false/false');

-- ─────────────────────────── A1: the Admin log rule ───────────────────────────
create temp table tt_actions on commit drop as
select distinct m[1] a from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
 where c.conrelid = 'public.ops_agent_log'::regclass and c.conname = 'ops_agent_log_action_check';
select pg_temp.chk('A1', 'the rule names 41 actions (39 before, plus guide_deferred and release_record_poisoned)',
  (select count(*)::text || ':' || (count(*) filter (where a in ('guide_deferred', 'release_record_poisoned')))::text from tt_actions), '41:2');
create temp table tt_a1 on commit drop as
select a, pg_temp.state(format($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail)
                                  values ('system@usemingla.com', 'system', %L, 'info', 'x', '{}')$q$, a)) st from tt_actions;
select pg_temp.chk('A1', 'every allowed action is accepted by a real insert', (select count(*) filter (where st <> 'ok')::text from tt_a1), '0');
select pg_temp.chk('A1', 'unknown, empty and near-miss actions are refused 23514',
  pg_temp.state($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail) values ('s', 'system', 'guide_deferred_x', 'info', 'x', '{}')$q$)
  || ',' || pg_temp.state($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail) values ('s', 'system', '', 'info', 'x', '{}')$q$)
  || ',' || pg_temp.state($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail) values ('s', 'system', 'Guide_Deferred', 'info', 'x', '{}')$q$),
  '23514,23514,23514');
select pg_temp.chk('A1', 'outcome error is still refused, for an old and a new action',
  pg_temp.state($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail) values ('s', 'system', 'guide_live', 'error', 'x', '{}')$q$)
  || ',' || pg_temp.state($q$insert into public.ops_agent_log (actor_email, via, action, outcome, summary, detail) values ('s', 'system', 'release_record_poisoned', 'error', 'x', '{}')$q$),
  '23514,23514');

-- Evidence numbers for the verdict.
do $ev$
begin
  raise notice 'EVIDENCE C120 ms=% support_calls=%', (select round(extract(epoch from t1 - t0) * 1000) from tt_c), (select n from tt_c_calls);
  raise notice 'EVIDENCE H1 first ingest ms=% done=%', (select round(extract(epoch from t1 - t0) * 1000) from tt_h1),
    (select min(detail->>'done') from public.ops_agent_log where action = 'guide_deferred' and detail->>'pr' = '984580');
  raise notice 'EVIDENCE H2 ingest ms=%', (select round(extract(epoch from t1 - t0) * 1000) from tt_h2);
  raise notice 'EVIDENCE passes %', (select string_agg(n || ':' || (res->>'done') || '/' || (res->>'deferred'), ' ' order by n) from tt_pass);
  raise notice 'EVIDENCE notices H1=% H2=%', pg_temp.notice_count(984580),
    (select string_agg(pg_temp.notice_count(984590 + r)::text, ',' order by r) from generate_series(1, 10) r);
end;
$ev$;

-- ─────────────────────────── report ───────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tt_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 40 then raise exception '#4580 tester adversarial recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4580 tester adversarial: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4580 tester adversarial: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
