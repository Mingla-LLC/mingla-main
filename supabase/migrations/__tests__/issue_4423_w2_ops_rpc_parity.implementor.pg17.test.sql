-- Issue #4423 Wave 2 -- implementor suite for
-- 20280705004423_issue_4423_w2_ops_set_based_card_builders.sql,
-- 20280705014423_issue_4423_w2_ops_work_list_review_counts.sql and
-- 20280705024423_issue_4423_w2_sprint_plan_read_first.sql, on the fully
-- replayed PG17 schema. Everything is rolled back.
--
--   PARITY   ops_cards_json(ids, today, 'full') equals ops_card_json per card
--            for a fixture that covers every branch (owners and watchers,
--            closed, working with and without a chat label, quiet and live
--            claims, override, review with and without a watcher, sent back,
--            confirmed, a release card with and without its record, parent
--            and subtasks with plan steps, a card plan, active and archived
--            goals, link and missing files, threads with a deleted message,
--            live and missing links, synced and unsynced github, an expected
--            anchor that repeats and one that is cancelled, a display name
--            that looks like an address). ops_names_for equals ops_name for
--            every email and the blank cases.
--   GOLDEN   ops_work_list with no shape, ops_review_list, ops_my_counts and
--            ops_sprint_plan_get return exactly what the bodies they replace
--            return (kept below as pg_temp.old_*), for an admin, a scoped
--            member and an agent, over many queries.
--   BOARD    shape board carries exactly the board contract keys, with the
--            same values as full (links without exists); board with q also
--            carries instructions; an unknown or non-string shape is refused
--            22023 naming shape.
--   PLAN     ops_plan_cards_json equals ops_plan_card_json per card,
--            planned and not, with a baseline that lists some cards.
--   SPRINT   ops_sprint_plan_get(NULL) never calls ops_sprint_ensure while
--            this week's row exists, and still returns the sprint (one call)
--            when it is missing; ops_reconcile makes this week's and next
--            week's rows.
--   COST     I-OPS-LIST-NO-PER-ROW-NAME-LOOKUP: a 300-card board makes at
--            most one ops_name call and one crm_display_name call per
--            distinct email (the old body made about ten ops_name calls per
--            card), and runs in at most 150 ms on the runner.
--   GRANTS   the three builders are internal (no anon or authenticated
--            EXECUTE); the RPCs keep their grants.
--
-- invariant: I-OPS-LIST-NO-PER-ROW-NAME-LOOKUP -- list RPCs resolve names
--   once per distinct email (enforced by the COST block of this suite).
--
-- FAILS-ON-REVERT: on origin/main (b7b76c8a14) ops_cards_json,
-- ops_plan_cards_json and ops_names_for do not exist and ops_work_list
-- refuses shape; with ops_work_list's last statement put back to
-- ops_card_json per row, GOLDEN stays green but COST fails (about 3,000
-- ops_name calls for 300 cards).
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(left(p_want, 400), '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 400), '<null>'), p_pattern));
$fn$;

-- ───────────────────────────── people ─────────────────────────────
create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people values
  ('own', '44239000-0000-4000-a000-000000000001', 'own.w24423@test.local'),
  ('adm', '44239000-0000-4000-a000-000000000002', 'adm.w24423@test.local'),
  ('mem', '44239000-0000-4000-a000-000000000003', 'mem.w24423@test.local'),
  ('agt', '44239000-0000-4000-a000-000000000004', 'agt.w24423@test.local'),
  ('odd', '44239000-0000-4000-a000-000000000005', 'odd.w24423@test.local'),
  ('plain', '44239000-0000-4000-a000-000000000006', '_plain.w24423@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('own.w24423@test.local', 'owner', 'active', now()), ('adm.w24423@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who in ('mem', 'agt', 'odd', 'plain');
insert into public.ops_team_profiles (email, display_name, updated_by) values
  ('own.w24423@test.local', 'Owner Four', 'system@usemingla.com'),
  ('adm.w24423@test.local', 'Admin Four', 'system@usemingla.com'),
  ('odd.w24423@test.local', 'odd@looks.like.an.address', 'system@usemingla.com');

create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
-- Act as a person, the way PostgREST does (claims only; the RPCs are SECURITY DEFINER).
create function pg_temp.login(p_who text, p_agent boolean default false) returns void
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
  delete from public.team_agent_calls where actor_uid = v_id;
  if p_agent then
    insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
    values (gen_random_uuid(), v_email, v_id, 'claude', 'list_work', pg_current_xact_id(), clock_timestamp());
  end if;
end;
$fn$;

-- ───────────────────────────── SPRINT: read first ─────────────────────────────
-- Record every ops_sprint_ensure call for this suite (rolled back at the end).
create temp table tx_ensure (seq serial, d date) on commit drop;
-- ops_sprint_ensure runs as its owner, so it must be able to write here.
grant select, insert on tx_ensure to public;
grant usage on sequence tx_ensure_seq_seq to public;
create or replace function public.ops_sprint_ensure(p_date date)
 returns uuid language plpgsql security definer set search_path to 'pg_catalog', 'pg_temp'
as $fn$
declare v_monday date := p_date - (extract(isodow from p_date)::integer - 1); v_id uuid;
begin
  insert into tx_ensure (d) values (p_date);
  insert into public.ops_sprints (starts_on) values (v_monday) on conflict (starts_on) do nothing;
  select s.id into v_id from public.ops_sprints s where s.starts_on = v_monday;
  return v_id;
end;
$fn$;

do $t$
declare v jsonb; v_mon date := public.ops_monday((now() at time zone 'UTC')::date); n0 integer;
begin
  set local session_replication_role = replica;
  delete from public.ops_sprints where starts_on in (v_mon, v_mon + 7);
  set local session_replication_role = origin;
  perform pg_temp.login('adm');
  v := public.ops_sprint_plan_get(null, null);
  perform pg_temp.chk('SPRINT', 'missing row: the plan still returns this week''s sprint',
    v->'sprint'->>'starts_on', v_mon::text);
  perform pg_temp.chk('SPRINT', 'missing row: exactly one ops_sprint_ensure call made it',
    (select count(*)::text from tx_ensure), '1');
  select count(*) into n0 from tx_ensure;
  v := public.ops_sprint_plan_get(null, null);
  v := public.ops_sprint_plan_get(null, (now() at time zone 'UTC')::date);
  perform pg_temp.chk('SPRINT', 'row present: two more polls call ops_sprint_ensure zero times (no write on the poll path)',
    (select (count(*) - n0)::text from tx_ensure), '0');
  perform pg_temp.chk('SPRINT', 'row present: the poll still returns the sprint', v->'sprint'->>'starts_on', v_mon::text);
  -- ops_reconcile makes this week's and next week's rows ahead of time.
  set local session_replication_role = replica;
  delete from public.ops_sprints where starts_on in (v_mon, v_mon + 7);
  set local session_replication_role = origin;
  perform public.ops_reconcile();
  perform pg_temp.chk('SPRINT', 'ops_reconcile ensures this week and next week',
    (select string_agg(starts_on::text, ',' order by starts_on) from public.ops_sprints where starts_on in (v_mon, v_mon + 7)),
    v_mon::text || ',' || (v_mon + 7)::text);
end;
$t$;

-- ───────────────────────────── fixture ─────────────────────────────
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.card(p_k text, p jsonb) returns uuid
language plpgsql as $fn$
declare v jsonb; v_id uuid := gen_random_uuid();
begin
  v := jsonb_build_object('id', v_id, 'title', 'W2 card ' || p_k, 'instructions', 'Do the ' || p_k || ' work and say what changed.',
         'done_means', 'It is done and checked.', 'status', 'todo', 'status_id', 'a4255000-0000-4000-8000-000000000001',
         'due_on', (now() at time zone 'UTC')::date + 2, 'due_source', 'explicit',
         'sprint_id', (select id from public.ops_sprints where starts_on = public.ops_monday((now() at time zone 'UTC')::date)),
         'created_by', pg_temp.email('own'), 'updated_by', pg_temp.email('own'), 'plan', '[]'::jsonb, 'proof', '[]'::jsonb) || p;
  insert into public.ops_work_cards (id, title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, person_reason,
    kind, kit_step, anchor_kind, anchor_id, due_on, due_source, sprint_id, carried_count, plan, result, proof, close_kind, close_reason,
    closed_at, closed_by, closed_via, started_at, working_by, working_via, override_reason, override_by, override_at, created_by,
    created_via, updated_by, archived_at, archived_by, archive_reason, working_chat, working_seen_at, auto_key, files_url,
    on_brand_plan, brand_plan_source, status_id, parent_id, depth, position, start_on, estimate_minutes, description_md, plan_step,
    goal_id, in_backlog, review_requested_at, review_requested_by, review_requested_via, review_kind, review_reason,
    confirmed_by, confirmed_at, sent_back_reason, sent_back_by, sent_back_at)
  select r.id, r.title, r.instructions, r.done_means, r.status, coalesce(r.blocked, false), r.blocked_kind, r.blocked_reason, r.person_reason,
    coalesce(r.kind, 'task'), r.kit_step, r.anchor_kind, r.anchor_id, r.due_on, r.due_source, r.sprint_id, coalesce(r.carried_count, 0), r.plan,
    r.result, r.proof, r.close_kind, r.close_reason, r.closed_at, r.closed_by, r.closed_via, r.started_at, r.working_by, r.working_via,
    r.override_reason, r.override_by, r.override_at, r.created_by, r.created_via, r.updated_by, r.archived_at, r.archived_by, r.archive_reason,
    r.working_chat, r.working_seen_at, r.auto_key, r.files_url, coalesce(r.on_brand_plan, false), r.brand_plan_source, r.status_id,
    r.parent_id, coalesce(r.depth, 0), r.position, r.start_on, r.estimate_minutes, r.description_md, r.plan_step, r.goal_id,
    coalesce(r.in_backlog, false), r.review_requested_at, r.review_requested_by, r.review_requested_via, r.review_kind, r.review_reason,
    r.confirmed_by, r.confirmed_at, r.sent_back_reason, r.sent_back_by, r.sent_back_at
    from jsonb_populate_record(null::public.ops_work_cards, v) r;
  insert into tx_ids values (p_k, v_id);
  return v_id;
end;
$fn$;
create function pg_temp.people(p_k text, p_owners text[], p_watchers text[]) returns void
language sql as $fn$
  insert into public.ops_work_people (card_id, email, role, added_by, added_at)
  select pg_temp.id(p_k), pg_temp.email(o), 'owner', 'system@usemingla.com', now() - make_interval(secs => ord)
    from unnest(p_owners) with ordinality u(o, ord)
  union all
  select pg_temp.id(p_k), pg_temp.email(w), 'watcher', 'system@usemingla.com', now() - make_interval(secs => 10 + ord)
    from unnest(p_watchers) with ordinality u(w, ord);
$fn$;

do $f$
declare v_mon date := public.ops_monday((now() at time zone 'UTC')::date); v_sprint uuid; v_goal uuid; v_goal_old uuid;
        v_exp uuid := gen_random_uuid(); v_exp_off uuid := gen_random_uuid(); v_today date := (now() at time zone 'UTC')::date;
        v_done uuid := 'a4255000-0000-4000-8000-000000000003'; v_doing uuid := 'a4255000-0000-4000-8000-000000000002';
        v_review uuid := public.ops_review_status_id(); v_chat text := substr(md5('w24423 chat'), 1, 16);
begin
  set local session_replication_role = replica;
  select id into v_sprint from public.ops_sprints where starts_on = v_mon;
  insert into public.ops_sprint_goals (id, sprint_id, title, owner_email, created_by, updated_by, position)
  values (gen_random_uuid(), v_sprint, 'Ship the W2 fixture', pg_temp.email('own'), pg_temp.email('own'), pg_temp.email('own'), 0)
  returning id into v_goal;
  insert into public.ops_sprint_goals (id, sprint_id, title, owner_email, created_by, updated_by, position, archived_at, archived_by)
  values (gen_random_uuid(), v_sprint, 'An archived goal', null, pg_temp.email('own'), pg_temp.email('own'), 1, now(), pg_temp.email('own'))
  returning id into v_goal_old;
  insert into public.ops_agent_chats (owner_email, via, chat_key, label) values (pg_temp.email('agt'), 'claude', v_chat, 'Build chat');
  insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, status, cancel_reason, repeats, created_by, updated_by)
  values (v_exp, gen_random_uuid(), 'Weekly W2 night', 'event', v_today + 3, 'open', null, 'week', pg_temp.email('own'), pg_temp.email('own')),
         (v_exp_off, gen_random_uuid(), 'Cancelled W2 night', 'event', v_today + 5, 'cancelled', 'not happening', 'none', pg_temp.email('own'), pg_temp.email('own'));

  perform pg_temp.card('plain', '{}');                                       perform pg_temp.people('plain', array['own'], array['adm']);
  perform pg_temp.card('two', jsonb_build_object('person_reason', 'spend', 'estimate_minutes', 90, 'start_on', v_today));
  perform pg_temp.people('two', array['mem', 'agt'], array['adm', 'own']);
  perform pg_temp.card('nobody', jsonb_build_object('person_reason', 'publish', 'due_on', v_today - 3));
  perform pg_temp.card('odd', jsonb_build_object('person_reason', 'other'));  perform pg_temp.people('odd', array['odd', 'plain'], array['agt']);
  perform pg_temp.card('closed', jsonb_build_object('status', 'done', 'status_id', v_done, 'closed_at', now() - interval '1 hour',
    'closed_by', pg_temp.email('mem'), 'close_kind', 'done', 'closed_via', 'claude', 'result', 'Shipped it.', 'close_reason', 'All good'));
  perform pg_temp.people('closed', array['mem'], array['own']);
  perform pg_temp.card('declined', jsonb_build_object('status', 'done', 'status_id', v_done, 'closed_at', now() - interval '2 days',
    'closed_by', pg_temp.email('adm'), 'close_kind', 'declined', 'close_reason', 'Not needed'));
  perform pg_temp.card('live', jsonb_build_object('status', 'doing', 'status_id', v_doing, 'working_by', pg_temp.email('agt'),
    'working_via', 'claude', 'working_chat', v_chat, 'started_at', now() - interval '2 hours', 'working_seen_at', now() - interval '10 minutes'));
  perform pg_temp.people('live', array['agt'], array['own']);
  perform pg_temp.card('quiet', jsonb_build_object('status', 'doing', 'status_id', v_doing, 'working_by', pg_temp.email('mem'),
    'working_via', 'codex', 'working_chat', 'default', 'started_at', now() - interval '3 days'));
  perform pg_temp.people('quiet', array['mem'], array['adm']);
  perform pg_temp.card('stuck', jsonb_build_object('status', 'doing', 'status_id', v_doing, 'working_by', pg_temp.email('plain'),
    'working_via', 'claude', 'working_chat', substr(md5('unknown chat'), 1, 16), 'started_at', now() - interval '9 days'));
  perform pg_temp.card('override', jsonb_build_object('override_at', now(), 'override_by', pg_temp.email('own'), 'override_reason', 'Owner override for W2'));
  perform pg_temp.card('review', jsonb_build_object('status', 'doing', 'status_id', v_review, 'review_requested_at', now() - interval '1 hour',
    'review_requested_by', pg_temp.email('mem'), 'review_requested_via', 'claude', 'review_kind', 'done', 'review_reason', 'Please check'));
  perform pg_temp.people('review', array['mem'], array['own', 'adm']);
  perform pg_temp.card('review_alone', jsonb_build_object('status', 'doing', 'status_id', v_review, 'review_requested_at', now(),
    'review_requested_by', pg_temp.email('adm'), 'review_kind', 'already_done'));
  perform pg_temp.card('sent_back', jsonb_build_object('status', 'doing', 'status_id', v_doing, 'sent_back_at', now(),
    'sent_back_by', pg_temp.email('own'), 'sent_back_reason', 'Needs one more check'));
  perform pg_temp.people('sent_back', array['mem'], array['own']);
  perform pg_temp.card('confirmed', jsonb_build_object('status', 'done', 'status_id', v_done, 'closed_at', now(), 'closed_by', pg_temp.email('own'),
    'close_kind', 'done', 'confirmed_by', pg_temp.email('own'), 'confirmed_at', now()));
  perform pg_temp.card('release', jsonb_build_object('auto_key', 'eng_release:pr-94423', 'kind', 'task'));
  perform pg_temp.people('release', array['own'], array['adm']);
  perform pg_temp.card('release_none', jsonb_build_object('auto_key', 'eng_release:pr-94424'));
  perform pg_temp.card('auto', jsonb_build_object('auto_key', 'roadmap_shipped:issue-4423', 'person_reason', 'publish'));
  perform pg_temp.people('auto', array['own'], array['adm']);
  perform pg_temp.card('send', jsonb_build_object('person_reason', 'send',
    'proof', jsonb_build_array(jsonb_build_object('kind', 'draft', 'id', gen_random_uuid()), jsonb_build_object('kind', 'url', 'url', 'https://example.test/x'))));
  perform pg_temp.people('send', array['mem'], array['own']);
  perform pg_temp.card('parent', jsonb_build_object('goal_id', v_goal, 'description_md', 'The parent card.', 'files_url', 'https://example.test/files',
    'plan', jsonb_build_array(jsonb_build_object('n', 1, 'text', 'ignored while subtasks exist'))));
  perform pg_temp.people('parent', array['own'], array['adm']);
  perform pg_temp.card('kid1', jsonb_build_object('parent_id', pg_temp.id('parent'), 'depth', 1, 'position', 2,
    'plan_step', jsonb_build_object('tool', 'claude', 'status', 'failed', 'result', 'It broke', 'checked_at', '2026-11-01T00:00:00Z')));
  perform pg_temp.card('kid2', jsonb_build_object('parent_id', pg_temp.id('parent'), 'depth', 1, 'position', 1, 'status', 'done', 'status_id', v_done,
    'closed_at', now(), 'closed_by', pg_temp.email('own'), 'close_kind', 'done', 'plan_step', jsonb_build_object('tool', '', 'status', 'person')));
  perform pg_temp.card('kid3', jsonb_build_object('parent_id', pg_temp.id('parent'), 'depth', 1, 'position', 3, 'archived_at', now(),
    'archived_by', pg_temp.email('own'), 'archive_reason', 'Not needed'));
  perform pg_temp.card('grandkid', jsonb_build_object('parent_id', pg_temp.id('kid1'), 'depth', 2, 'position', 0));
  perform pg_temp.card('planned', jsonb_build_object('plan', jsonb_build_array(jsonb_build_object('n', 1, 'text', 'Step one', 'status', 'todo')),
    'goal_id', v_goal_old, 'carried_count', 2, 'in_backlog', true));
  perform pg_temp.card('blocked', jsonb_build_object('blocked', true, 'blocked_kind', 'manual', 'blocked_reason', 'Waiting on the venue'));
  perform pg_temp.card('anchored', jsonb_build_object('anchor_kind', 'expected', 'anchor_id', v_exp, 'kind', 'promo', 'kit_step', -7));
  perform pg_temp.card('anchored_off', jsonb_build_object('anchor_kind', 'expected', 'anchor_id', v_exp_off));
  perform pg_temp.card('anchored_event', jsonb_build_object('anchor_kind', 'event', 'anchor_id', gen_random_uuid()));
  perform pg_temp.card('linked', jsonb_build_object('on_brand_plan', true, 'brand_plan_source', 'host_card'));
  perform pg_temp.people('linked', array['adm'], array['own']);
  perform pg_temp.card('backlog_next', jsonb_build_object('sprint_id', (select id from public.ops_sprints where starts_on = v_mon + 7)));
  perform pg_temp.people('backlog_next', array['own'], array['mem']);
  perform pg_temp.card('archived', jsonb_build_object('archived_at', now(), 'archived_by', pg_temp.email('own'), 'archive_reason', 'Old card'));
  perform pg_temp.card('old_done', jsonb_build_object('status', 'done', 'status_id', v_done, 'closed_at', now() - interval '40 days',
    'closed_by', pg_temp.email('own'), 'close_kind', 'already_done', 'created_via', 'codex',
    'sprint_id', (select id from public.ops_sprints where starts_on < v_mon order by starts_on desc limit 1)));

  insert into public.ops_work_links (card_id, kind, target_id, label, added_by, added_at) values
    (pg_temp.id('linked'), 'card', pg_temp.id('plain'), 'The plain card', pg_temp.email('own'), now() - interval '2 minutes'),
    (pg_temp.id('linked'), 'host', gen_random_uuid(), 'A host that is gone', pg_temp.email('own'), now() - interval '1 minute'),
    (pg_temp.id('linked'), 'card', pg_temp.id('archived'), 'An archived card', pg_temp.email('own'), now()),
    (pg_temp.id('send'), 'host', gen_random_uuid(), 'The host to email', pg_temp.email('own'), now());
  insert into public.ops_github_items (number, kind, title, url, state, board_status, synced_at)
  values (94401, 'issue', 'W2 issue', 'https://github.com/Mingla-LLC/mingla-main/issues/94401', 'OPEN', 'In Progress', now());
  insert into public.ops_work_github (card_id, kind, number, added_by, added_at) values
    (pg_temp.id('linked'), 'issue', 94401, pg_temp.email('own'), now() - interval '1 minute'),
    (pg_temp.id('linked'), 'pull', 94402, pg_temp.email('own'), now());
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, deploy_marker, problems, deploy, migrations_added, comment_urls, issues)
  values (94423, 'W2 release', 'https://github.com/Mingla-LLC/mingla-main/pull/94423', now() - interval '1 hour', md5('w2') || substr(md5('w2x'), 1, 8), true,
          array['live_check_missing', 'migrations_pending']::text[],
          jsonb_build_object('web', jsonb_build_object('mingla-admin', 'ready', 'mingla-business', 'not_deployed', 'mingla-sites', 'failed')),
          array['20280705004423']::text[], '{}'::jsonb, '[]'::jsonb);
  insert into public.ops_work_files (card_id, kind, name, url, added_by) values
    (pg_temp.id('parent'), 'link', 'Spec', 'https://example.test/spec', pg_temp.email('own'));
  insert into public.ops_work_files (card_id, kind, name, storage_path, mime, size_bytes, added_by) values
    (pg_temp.id('parent'), 'image', 'missing.png', gen_random_uuid() || '/' || gen_random_uuid() || '/missing.png', 'image/png', 10, pg_temp.email('own'));
  insert into public.ops_work_files (card_id, kind, name, url, added_by, archived_at, archived_by) values
    (pg_temp.id('parent'), 'link', 'Old', 'https://example.test/old', pg_temp.email('own'), now(), pg_temp.email('own'));
  insert into public.ops_work_messages (card_id, author_email, body_md) values
    (pg_temp.id('parent'), pg_temp.email('own'), 'One'), (pg_temp.id('parent'), pg_temp.email('adm'), 'Two');
  insert into public.ops_work_messages (card_id, author_email, body_md, deleted_at, deleted_by) values
    (pg_temp.id('parent'), pg_temp.email('own'), '', now(), pg_temp.email('own'));
  set local session_replication_role = origin;
end;
$f$;

-- ───────────────────────────── PARITY ─────────────────────────────
do $t$
declare v_ids uuid[]; v_today date := (now() at time zone 'UTC')::date; a jsonb; b jsonb; v_bad text;
begin
  v_ids := array(select id from tx_ids order by k);
  foreach v_today in array array[v_today, null::date, v_today + 1] loop
    a := (select jsonb_agg(public.ops_card_json(w, v_today) order by u.ord)
            from unnest(v_ids) with ordinality u(id, ord) join public.ops_work_cards w on w.id = u.id);
    b := public.ops_cards_json(v_ids, v_today, 'full');
    select string_agg(x.ka->>'id', ',') into v_bad
      from jsonb_array_elements(a) with ordinality x(ka, n) join jsonb_array_elements(b) with ordinality y(kb, n) using (n)
     where x.ka is distinct from y.kb;
    perform pg_temp.chk('PARITY', format('ops_cards_json full = ops_card_json per card for %s fixture cards (today %s)',
      cardinality(v_ids), coalesce(v_today::text, 'null')), coalesce(v_bad, 'same') || '/' || (a = b)::text, 'same/true');
  end loop;
  perform pg_temp.chk('PARITY', 'the fixture covers at least 30 cards', (cardinality(v_ids) >= 30)::text, 'true');
  perform pg_temp.chk('PARITY', 'order follows p_ids, repeated ids keep their first place',
    (select string_agg(e->>'id', ',') from jsonb_array_elements(public.ops_cards_json(array[pg_temp.id('two'), pg_temp.id('plain'), pg_temp.id('two')], current_date, 'full')) e),
    pg_temp.id('two') || ',' || pg_temp.id('plain'));
  perform pg_temp.chk('PARITY', 'no ids, null ids: an empty array',
    public.ops_cards_json(array[]::uuid[], current_date, 'full')::text || public.ops_cards_json(null, current_date, 'board')::text, '[][]');
  -- the fixture really exercises the branches it claims
  perform pg_temp.chk('PARITY', 'branches present: working+claim, quiet working, review waiting on a teammate, release items, plan steps, anchor series',
    concat_ws('|',
      (select (e->'claim' is not null and e->'working'->>'chat_label' = 'Build chat')::text from jsonb_array_elements(b) e where e->>'id' = pg_temp.id('live')::text),
      (select (e->'claim' = 'null'::jsonb and (e->'working'->>'quiet')::boolean)::text from jsonb_array_elements(b) e where e->>'id' = pg_temp.id('quiet')::text),
      (select e->'review'->>'waiting_on' from jsonb_array_elements(b) e where e->>'id' = pg_temp.id('review_alone')::text),
      (select (jsonb_array_length(e->'release_items') >= 4)::text from jsonb_array_elements(b) e where e->>'id' = pg_temp.id('release')::text),
      (select jsonb_array_length(e->'plan')::text from jsonb_array_elements(b) e where e->>'id' = pg_temp.id('parent')::text),
      (select (e->'anchor'->>'series')::text from jsonb_array_elements(b) e where e->>'id' = pg_temp.id('anchored')::text),
      (select e->'owners'->0->>'name' from jsonb_array_elements(b) e where e->>'id' = pg_temp.id('odd')::text)),
    'true|true|A teammate|true|2|true|A teammate');
  -- names
  perform pg_temp.chk('PARITY', 'ops_names_for = ops_name for every fixture email and the blank cases',
    (select count(*) filter (where n.name is distinct from public.ops_name(n.email))::text || '/' || count(*)::text
       from public.ops_names_for(array(select email from tx_people) || array['', ' ', 'x@y', 'Mixed.Case@Example.com', null, 'own.w24423@test.local']) n),
    '0/' || ((select count(*) from tx_people) + 4)::text);
end;
$t$;

-- ───────────────────────────── old bodies (the ones this wave replaces) ─────────────────────────────
-- Verbatim copies of the bodies this wave replaces (origin/main b7b76c8a14,
-- identical to production on 13 Nov), renamed into pg_temp.
CREATE FUNCTION pg_temp.old_ops_work_list(p_query jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; q jsonb := CASE WHEN jsonb_typeof(p_query) = 'object' THEN p_query ELSE '{}'::jsonb END; v_bad text;
  v_today date; v_status text[]; v_who text := 'all'; v_owner text; v_event uuid; v_expected uuid; v_record uuid; v_week date;
  v_q text; v_like text; v_done_days integer := 7; v_limit integer := 200; v_cards jsonb; v_total integer; v_counts jsonb; v_ids uuid[];
  v_closed_since timestamptz; v_closed_until timestamptz; v_offset integer := 0;
  -- #4270 rework: a page per column, and one meaning of "this week".
  v_per_status boolean := false; v_tz text := 'UTC'; v_done_default boolean := true; v_week_start timestamptz;
  v_sts text[]; v_rns integer[]; v_pick uuid[]; v_columns jsonb; v_cut boolean;
  -- #4255: subtasks, custom columns, goals and the backlog.
  v_subtasks boolean := false; v_parent uuid; v_status_ids uuid[]; v_goal uuid; v_backlog boolean; v_sids uuid[]; v_status_columns jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT k INTO v_bad FROM jsonb_object_keys(q) k
   WHERE k NOT IN ('status','who','owner','event_id','expected_id','record_id','week','q','done_days','today','limit',
                   'closed_since','closed_until','offset','per_status','tz','subtasks','parent_id','status_id','goal_id','backlog') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('invalid_query: The board cannot filter by "%s". It takes status, who, owner, event_id, expected_id, record_id, week, q, done_days, closed_since, closed_until, today, limit, offset, per_status, tz, subtasks, parent_id, status_id, goal_id and backlog.', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_today := public.ops_today(CASE WHEN jsonb_typeof(q->'today') = 'string' THEN (q->>'today')::date END);
    IF q ? 'status' AND jsonb_typeof(q->'status') <> 'null' THEN
      IF jsonb_typeof(q->'status') <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(q->'status') s WHERE jsonb_typeof(s) <> 'string' OR s #>> '{}' NOT IN ('todo','doing','person','done')) THEN
        RAISE EXCEPTION 'bad' USING ERRCODE = '22023';
      END IF;
      v_status := ARRAY(SELECT s FROM jsonb_array_elements_text(q->'status') s);
    END IF;
    IF jsonb_typeof(q->'who') = 'string' THEN
      v_who := q->>'who';
      IF v_who NOT IN ('all','mine','watching') THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    IF jsonb_typeof(q->'owner') = 'string' THEN
      v_owner := public.ops_team_email(q->>'owner');
      IF v_owner IS NULL THEN v_owner := lower(btrim(q->>'owner')); END IF;
    END IF;
    IF jsonb_typeof(q->'event_id') = 'string' THEN v_event := (q->>'event_id')::uuid; END IF;
    IF jsonb_typeof(q->'expected_id') = 'string' THEN v_expected := (q->>'expected_id')::uuid; END IF;
    IF jsonb_typeof(q->'record_id') = 'string' THEN v_record := (q->>'record_id')::uuid; END IF;
    IF jsonb_typeof(q->'week') = 'string' THEN v_week := public.ops_monday((q->>'week')::date); END IF;
    IF jsonb_typeof(q->'q') = 'string' THEN
      v_q := public.ops_one_line(q->>'q');
      IF char_length(COALESCE(v_q, '')) > 160 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_like := replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
    END IF;
    IF q ? 'done_days' AND jsonb_typeof(q->'done_days') <> 'null' THEN
      v_done_default := false;
      v_done_days := (q->>'done_days')::integer;
      IF v_done_days NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    IF q ? 'limit' AND jsonb_typeof(q->'limit') <> 'null' THEN
      v_limit := (q->>'limit')::integer;
      IF v_limit NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    -- #4255: done cards closed inside a window, and paging.
    IF q ? 'closed_since' AND jsonb_typeof(q->'closed_since') <> 'null' THEN
      IF jsonb_typeof(q->'closed_since') <> 'string' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_closed_since := (q->>'closed_since')::timestamptz;
    END IF;
    IF q ? 'closed_until' AND jsonb_typeof(q->'closed_until') <> 'null' THEN
      IF jsonb_typeof(q->'closed_until') <> 'string' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_closed_until := (q->>'closed_until')::timestamptz;
    END IF;
    IF v_closed_since IS NOT NULL AND v_closed_until IS NOT NULL AND v_closed_until <= v_closed_since THEN
      RAISE EXCEPTION 'bad' USING ERRCODE = '22023';
    END IF;
    IF q ? 'offset' AND jsonb_typeof(q->'offset') <> 'null' THEN
      v_offset := (q->>'offset')::integer;
      IF v_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    -- #4270 rework (P2-1): per_status puts the limit on each column, so a
    -- long To do never pushes In progress or Done off the page.
    IF q ? 'per_status' AND jsonb_typeof(q->'per_status') <> 'null' THEN
      IF jsonb_typeof(q->'per_status') <> 'boolean' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_per_status := (q->>'per_status')::boolean;
      IF v_per_status AND v_offset > 0 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    -- #4270 rework (P3-3): the viewer's time zone. Done "this week" starts
    -- at 00:00 on the Monday of the sprint (the Monday of today) there. An
    -- unknown zone counts as UTC, so a browser with a newer zone name still
    -- loads the board.
    IF q ? 'tz' AND jsonb_typeof(q->'tz') <> 'null' THEN
      IF jsonb_typeof(q->'tz') <> 'string' OR char_length(q->>'tz') > 64 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = q->>'tz') THEN v_tz := q->>'tz'; END IF;
    END IF;
    -- #4255: subtasks (top-level cards only unless asked), one card's
    -- subtasks, columns, a goal and the backlog.
    IF q ? 'subtasks' AND jsonb_typeof(q->'subtasks') <> 'null' THEN
      IF jsonb_typeof(q->'subtasks') <> 'boolean' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_subtasks := (q->>'subtasks')::boolean;
    END IF;
    IF jsonb_typeof(q->'parent_id') = 'string' THEN v_parent := (q->>'parent_id')::uuid; END IF;
    IF q ? 'status_id' AND jsonb_typeof(q->'status_id') <> 'null' THEN
      IF jsonb_typeof(q->'status_id') <> 'array' OR jsonb_array_length(q->'status_id') > 50 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_status_ids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(q->'status_id') x);
    END IF;
    IF jsonb_typeof(q->'goal_id') = 'string' THEN v_goal := (q->>'goal_id')::uuid; END IF;
    IF q ? 'backlog' AND jsonb_typeof(q->'backlog') <> 'null' THEN
      IF jsonb_typeof(q->'backlog') <> 'boolean' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_backlog := (q->>'backlog')::boolean;
    END IF;
  EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_query: A filter has the wrong shape. Use status (todo, doing, done; person lists open cards with a Send, Spend or Publish tag), who (all, mine, watching), ids from Mingla, a week date, up to 160 characters of search, done_days 0 to 60, closed_since before closed_until, limit 1 to 300, offset 0 to 100000 (not with per_status), per_status true or false and tz as a time zone name.' USING ERRCODE = '22023';
  END;
  -- Done with no window given: closed since Monday 00:00 of this sprint, in tz.
  v_week_start := (public.ops_monday(v_today)::timestamp AT TIME ZONE v_tz);

  WITH base AS (
    SELECT w.id, w.status, w.due_on, w.number, w.person_reason, w.closed_at, w.status_id FROM public.ops_work_cards w
     WHERE w.archived_at IS NULL
       AND (CASE WHEN v_parent IS NOT NULL THEN w.parent_id = v_parent ELSE v_subtasks OR w.parent_id IS NULL END)  -- #4255
       AND (v_goal IS NULL OR w.goal_id = v_goal)
       AND (v_backlog IS NULL OR w.in_backlog = v_backlog)
       AND (v_who = 'all'
            OR (v_who = 'mine' AND EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email AND p.role = 'owner'))
            OR (v_who = 'watching' AND EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email AND p.role = 'watcher')))
       AND (v_owner IS NULL OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v_owner AND p.role = 'owner'))
       AND (v_event IS NULL OR (w.anchor_kind = 'event' AND w.anchor_id = v_event)
            OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = 'event' AND l.target_id = v_event))
       AND (v_expected IS NULL OR (w.anchor_kind = 'expected' AND w.anchor_id = v_expected)
            OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = 'expected' AND l.target_id = v_expected))
       AND (v_record IS NULL OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind IN ('host','creator') AND l.target_id = v_record))
       AND (v_week IS NULL OR w.sprint_id = (SELECT s.id FROM public.ops_sprints s WHERE s.starts_on = v_week))
       AND (v_like IS NULL OR w.title ILIKE '%' || v_like || '%' ESCAPE E'\\' OR w.instructions ILIKE '%' || v_like || '%' ESCAPE E'\\'
            OR ('card ' || w.number::text) = lower(v_q) OR w.number::text = v_q)
       AND (w.status <> 'done' OR v_week IS NOT NULL
            OR (CASE WHEN v_closed_since IS NOT NULL OR v_closed_until IS NOT NULL
                     THEN w.closed_at IS NOT NULL
                          AND (v_closed_since IS NULL OR w.closed_at >= v_closed_since)
                          AND (v_closed_until IS NULL OR w.closed_at < v_closed_until)
                     WHEN v_done_default THEN w.closed_at >= v_week_start
                     ELSE w.closed_at >= now() - make_interval(days => v_done_days) END))),
  picked AS (
    -- #4255: the board's own column order, then each card's place in its column.
    SELECT b.id, b.status, b.status_id, (SELECT s.position FROM public.ops_work_statuses s WHERE s.id = b.status_id) AS col,
           row_number() OVER (PARTITION BY b.status_id
                              ORDER BY CASE WHEN b.status <> 'done' THEN b.due_on END ASC,
                                       CASE WHEN b.status = 'done' THEN b.due_on END DESC,
                                       CASE WHEN b.status = 'done' THEN b.closed_at END DESC, b.number)::integer AS rn
      FROM base b
     WHERE (v_status IS NULL OR b.status = ANY (v_status)
            OR ('person' = ANY (v_status) AND b.status <> 'done' AND b.person_reason IS NOT NULL))
       AND (v_status_ids IS NULL OR b.status_id = ANY (v_status_ids)))
  -- #4270: three columns. Open cards earliest due first (late on top); Done
  -- latest due first. "person" in a filter means open cards with a tag; the
  -- person count stays (= tagged) for one release so older agents still read it.
  SELECT jsonb_build_object('todo', count(*) FILTER (WHERE b.status = 'todo'), 'doing', count(*) FILTER (WHERE b.status = 'doing'),
                            'done', count(*) FILTER (WHERE b.status = 'done'),
                            'tagged', count(*) FILTER (WHERE b.status <> 'done' AND b.person_reason IS NOT NULL),
                            'person', count(*) FILTER (WHERE b.status <> 'done' AND b.person_reason IS NOT NULL),
                            'due_today', count(*) FILTER (WHERE b.status <> 'done' AND b.due_on = v_today),
                            'overdue', count(*) FILTER (WHERE b.status <> 'done' AND b.due_on < v_today)),
         (SELECT count(*) FROM picked),
         (SELECT array_agg(p.id ORDER BY p.col, p.status_id, p.rn) FROM picked p),
         (SELECT array_agg(p.status ORDER BY p.col, p.status_id, p.rn) FROM picked p),
         (SELECT array_agg(p.rn ORDER BY p.col, p.status_id, p.rn) FROM picked p),
         (SELECT array_agg(p.status_id ORDER BY p.col, p.status_id, p.rn) FROM picked p)
    INTO v_counts, v_total, v_ids, v_sts, v_rns, v_sids
    FROM base b;
  -- (picked is the filtered list with each card's place in its own column.)
  IF v_per_status THEN
    v_pick := ARRAY(SELECT u.id FROM unnest(COALESCE(v_ids, ARRAY[]::uuid[]), COALESCE(v_rns, ARRAY[]::integer[])) WITH ORDINALITY u(id, rn, ord)
                     WHERE u.rn <= v_limit ORDER BY u.ord);
  ELSE
    v_pick := COALESCE(v_ids[v_offset + 1:v_offset + v_limit], ARRAY[]::uuid[]);
  END IF;
  -- Each column: how many cards it has in all, how many came back, and
  -- whether it is cut. The board's tabs and headers read these.
  SELECT jsonb_object_agg(k.st, jsonb_build_object('total', COALESCE(t.total, 0), 'shown', COALESCE(t.shown, 0),
                                                   'truncated', COALESCE(t.shown, 0) < COALESCE(t.total, 0)))
    INTO v_columns
    FROM unnest(ARRAY['todo','doing','done']) k(st)
    LEFT JOIN (SELECT u.st, count(*) AS total, count(*) FILTER (WHERE u.id = ANY (v_pick)) AS shown
                 FROM unnest(COALESCE(v_ids, ARRAY[]::uuid[]), COALESCE(v_sts, ARRAY[]::text[])) u(id, st) GROUP BY u.st) t ON t.st = k.st;
  -- #4255: the same for every column of the board.
  SELECT COALESCE(jsonb_object_agg(t.sid, jsonb_build_object('total', t.total, 'shown', t.shown, 'truncated', t.shown < t.total)), '{}'::jsonb)
    INTO v_status_columns
    FROM (SELECT u.sid, count(*) AS total, count(*) FILTER (WHERE u.id = ANY (v_pick)) AS shown
            FROM unnest(COALESCE(v_ids, ARRAY[]::uuid[]), COALESCE(v_sids, ARRAY[]::uuid[])) u(id, sid) GROUP BY u.sid) t;
  v_cut := CASE WHEN v_per_status THEN EXISTS (SELECT 1 FROM jsonb_each(v_columns) e WHERE (e.value->>'truncated')::boolean)
                ELSE v_total > v_offset + v_limit END;
  SELECT COALESCE(jsonb_agg(public.ops_card_json(w, v_today) ORDER BY u.ord), '[]'::jsonb) INTO v_cards
    FROM unnest(v_pick) WITH ORDINALITY u(id, ord)
    JOIN public.ops_work_cards w ON w.id = u.id;
  RETURN jsonb_build_object('cards', v_cards, 'total', v_total, 'truncated', v_cut, 'counts', v_counts,
    'columns', v_columns, 'status_columns', v_status_columns, 'subtasks', v_subtasks, 'per_status', v_per_status, 'limit', v_limit,
    'offset', v_offset, 'done_since', CASE WHEN v_done_default AND v_week IS NULL AND v_closed_since IS NULL AND v_closed_until IS NULL THEN v_week_start END,
    'sprint', public.ops_sprint_json(COALESCE(v_week, public.ops_monday(v_today))), 'today', v_today);
END;
$function$;

CREATE FUNCTION pg_temp.old_ops_review_list(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_today date := public.ops_today(p_today); v_admin boolean := public.is_admin_user(); v_out jsonb; v_need jsonb;
        v_wording jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT jsonb_build_object(
    'cards', COALESCE(jsonb_agg(public.ops_card_json(w, v_today) ORDER BY array_position(ARRAY['spend','publish','other'], w.person_reason), w.due_on, w.number), '[]'::jsonb),
    'counts', jsonb_build_object('spend', count(*) FILTER (WHERE w.person_reason = 'spend'),
                                 'publish', count(*) FILTER (WHERE w.person_reason = 'publish'),
                                 'other', count(*) FILTER (WHERE w.person_reason = 'other')))
    INTO v_out
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason IN ('spend','publish','other')
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  SELECT COALESCE(jsonb_agg(public.ops_card_json(w, v_today) ORDER BY w.due_on, w.number), '[]'::jsonb) INTO v_need
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason = 'send'
     AND NOT public.ops_send_draft_waiting(w.id, w.proof)
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  -- What hosts are told: only the owner and admins see and decide it.
  SELECT COALESCE(jsonb_agg(public.ops_card_json(w, v_today) || jsonb_build_object('roadmap', (
           SELECT jsonb_build_object('id', rc.id, 'public_title', rc.public_title, 'public_body', rc.public_body,
                                     'internal_note', rc.internal_note, 'lane', rc.lane, 'status', rc.status)
             FROM public.community_roadmap_cards rc
            WHERE rc.id = public.ops_roadmap_shipped_draft(w.auto_key)))
           ORDER BY w.due_on, w.number), '[]'::jsonb) INTO v_wording
    FROM public.ops_work_cards w
   WHERE v_admin AND v.via IS NULL AND w.archived_at IS NULL AND w.status <> 'done' AND w.auto_key LIKE 'roadmap\_shipped:%';
  RETURN v_out || jsonb_build_object('draft_needed', v_need, 'wording', v_wording,
    'counts', (v_out->'counts') || jsonb_build_object('draft_needed', jsonb_array_length(v_need), 'wording', jsonb_array_length(v_wording)));
END;
$function$;

CREATE FUNCTION pg_temp.old_ops_my_counts(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_today date := public.ops_today(p_today); v_review jsonb := pg_temp.old_ops_review_list(p_today);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  RETURN (SELECT jsonb_build_object(
    'open_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner'),
    -- #4270: the tag replaces the status; waiting_on_person_mine stays (= needs_ok_mine) for agents.
    'waiting_on_person_mine', count(*) FILTER (WHERE w.status <> 'done' AND w.person_reason IS NOT NULL AND p.role = 'owner'),
    'needs_ok_mine', count(*) FILTER (WHERE w.status <> 'done' AND w.person_reason IS NOT NULL AND p.role = 'owner'),
    'due_today_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner' AND w.due_on = v_today),
    -- A wording card is listed under Spend or publish and on What hosts are
    -- told; it is counted once, as wording.
    'needs_person_mine', (SELECT count(*) FROM jsonb_array_elements(v_review->'cards') c
                           WHERE c->>'auto_kind' IS DISTINCT FROM 'roadmap_shipped'
                              OR jsonb_array_length(v_review->'wording') = 0),
    'draft_needed_mine', jsonb_array_length(v_review->'draft_needed'),
    'wording_mine', jsonb_array_length(v_review->'wording'),
    'overdue_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner' AND w.due_on < v_today),
    'watching_open', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'watcher'))
    FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = v.actor_email
   WHERE w.archived_at IS NULL);
END;
$function$;

CREATE FUNCTION pg_temp.old_ops_sprint_plan_get(p_sprint_id uuid DEFAULT NULL::uuid, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_today date := public.ops_today(p_today); s public.ops_sprints; prev public.ops_sprints; v_planned boolean;
        v_review jsonb; v_goals jsonb; v_capacity jsonb; v_in jsonb; v_backlog jsonb; v_cap_min numeric; v_est_min numeric;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_sprint_id IS NULL THEN
    SELECT * INTO s FROM public.ops_sprints x WHERE x.id = public.ops_sprint_ensure(v_today);
  ELSE
    SELECT * INTO s FROM public.ops_sprints x WHERE x.id = p_sprint_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That sprint is not here.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_planned := s.planned_at IS NOT NULL;
  SELECT * INTO prev FROM public.ops_sprints x WHERE x.starts_on = s.starts_on - 7;
  IF prev.id IS NOT NULL THEN
    SELECT COALESCE(sum(public.ops_capacity_hours(prev.id, d.email)), 0) * 60 INTO v_cap_min
      FROM public.admin_team_directory() d WHERE d.status = 'active';
    SELECT COALESCE(sum(w.estimate_minutes), 0) INTO v_est_min
      FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL;
    v_review := jsonb_build_object('sprint', public.ops_sprint_json(prev.starts_on),
      'planned', CASE WHEN prev.plan_baseline IS NOT NULL THEN jsonb_array_length(prev.plan_baseline)
                      ELSE (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL AND w.parent_id IS NULL) END,
      'done', (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND w.status = 'done'),
      'carried', (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND w.carried_count > 0),
      'goals', (SELECT count(*) FROM public.ops_sprint_goals g WHERE g.sprint_id = prev.id AND g.archived_at IS NULL),
      'goals_hit', (SELECT count(*) FROM public.ops_sprint_goals g WHERE g.sprint_id = prev.id AND g.archived_at IS NULL
                     AND public.ops_goal_json(g, v_today)->>'state' = 'done'),
      'capacity_used_pct', CASE WHEN v_cap_min > 0 THEN round(100 * v_est_min / v_cap_min) END,
      'note', prev.review_note, 'revision', prev.revision);
  END IF;
  SELECT COALESCE(jsonb_agg(public.ops_goal_json(g, v_today) ORDER BY g.position, g.created_at), '[]'::jsonb) INTO v_goals
    FROM public.ops_sprint_goals g WHERE g.sprint_id = s.id AND g.archived_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', d.email, 'name', public.ops_name(d.email),
           'hours', k.hours, 'hours_default', CASE WHEN k.hours IS NULL THEN public.ops_capacity_hours(s.id, d.email) END,
           'planned_minutes', pl.minutes,
           'over', COALESCE(pl.minutes > COALESCE(k.hours, public.ops_capacity_hours(s.id, d.email)) * 60, false))
         ORDER BY (d.role = 'owner') DESC, d.email), '[]'::jsonb) INTO v_capacity
    FROM public.admin_team_directory() d
    LEFT JOIN public.ops_sprint_capacity k ON k.sprint_id = s.id AND k.email = d.email
    CROSS JOIN LATERAL (SELECT COALESCE(sum(w.estimate_minutes), 0) AS minutes
                          FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.role = 'owner' AND p.email = d.email
                         WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.status <> 'done' AND NOT w.in_backlog) pl
   WHERE d.status = 'active';
  SELECT COALESCE(jsonb_agg(public.ops_plan_card_json(w, s.plan_baseline, v_planned) ORDER BY w.carried_count DESC, w.due_on, w.number), '[]'::jsonb) INTO v_in
    FROM public.ops_work_cards w WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND NOT w.in_backlog;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.carried DESC, x.due_on, x.number), '[]'::jsonb) INTO v_backlog
    FROM (SELECT public.ops_plan_card_json(w, s.plan_baseline, false) AS j, w.carried_count AS carried, w.due_on, w.number
            FROM public.ops_work_cards w JOIN public.ops_sprints ws ON ws.id = w.sprint_id
           WHERE w.archived_at IS NULL AND w.parent_id IS NULL AND w.status <> 'done'
             AND (w.in_backlog OR ws.starts_on > s.starts_on)
           ORDER BY w.carried_count DESC, w.due_on, w.number LIMIT 300) x;
  RETURN jsonb_build_object('sprint', public.ops_sprint_json(s.starts_on), 'planned', v_planned, 'planned_at', s.planned_at,
    'planned_by_name', CASE WHEN s.planned_by IS NOT NULL THEN public.ops_name(s.planned_by) END,
    'revision', s.revision, 'review', v_review, 'goals', v_goals, 'capacity', v_capacity, 'in_sprint', v_in, 'backlog', v_backlog,
    'today', v_today, 'can_plan', v.via IS NULL);
END;
$function$;

-- ───────────────────────────── GOLDEN ─────────────────────────────
do $t$
declare u record; q text; a jsonb; b jsonb; v_cases integer := 0; v_same integer := 0; v_diff text;
  qs text[] := array[
    '{}', '{"who":"all"}', '{"who":"mine"}', '{"who":"watching"}', '{"who":"mine","done_days":0,"limit":50}',
    '{"who":"watching","done_days":0,"limit":20}', '{"who":"all","limit":300,"per_status":true}',
    '{"who":"all","limit":300,"per_status":true,"subtasks":true,"tz":"Africa/Lagos"}', '{"status":["todo"]}', '{"status":["person"]}',
    '{"q":"W2 card"}', '{"offset":3,"limit":5}', '{"subtasks":true,"limit":300}', '{"backlog":true}', '{"done_days":60,"limit":300}',
    '{"closed_since":"2020-01-01T00:00:00Z","limit":300}', '{"shape":"full","who":"all"}', '{"shape":null}'];
begin
  for u in select * from (values ('own', false), ('mem', false), ('agt', true)) x(who, agent) loop
    perform pg_temp.login(u.who, u.agent);
    foreach q in array qs loop
      a := pg_temp.old_ops_work_list((q::jsonb) - 'shape'); b := public.ops_work_list(q::jsonb);
      v_cases := v_cases + 1;
      if a = b then v_same := v_same + 1; else v_diff := coalesce(v_diff || '; ', '') || u.who || ' ' || q; end if;
    end loop;
    a := pg_temp.old_ops_work_list(jsonb_build_object('parent_id', pg_temp.id('parent'), 'subtasks', true));
    b := public.ops_work_list(jsonb_build_object('parent_id', pg_temp.id('parent'), 'subtasks', true));
    v_cases := v_cases + 1; if a = b then v_same := v_same + 1; else v_diff := coalesce(v_diff || '; ', '') || u.who || ' parent'; end if;
    perform pg_temp.chk('GOLDEN', u.who || ': ops_review_list equals the old body', (pg_temp.old_ops_review_list(null) = public.ops_review_list(null))::text, 'true');
    perform pg_temp.chk('GOLDEN', u.who || ': ops_my_counts equals the old body', public.ops_my_counts(null)::text, pg_temp.old_ops_my_counts(null)::text);
    perform pg_temp.chk('GOLDEN', u.who || ': ops_sprint_plan_get(this week) equals the old body',
      (pg_temp.old_ops_sprint_plan_get(null, null) = public.ops_sprint_plan_get(null, null))::text, 'true');
    perform pg_temp.chk('GOLDEN', u.who || ': ops_sprint_plan_get(next week) equals the old body',
      (pg_temp.old_ops_sprint_plan_get((select id from public.ops_sprints where starts_on = public.ops_monday(current_date) + 7), null)
       = public.ops_sprint_plan_get((select id from public.ops_sprints where starts_on = public.ops_monday(current_date) + 7), null))::text, 'true');
  end loop;
  perform pg_temp.chk('GOLDEN', format('ops_work_list with no shape (or shape full) equals the old body in %s cases', v_cases),
    coalesce(v_diff, 'all same'), 'all same');
  perform pg_temp.login('own');
  a := public.ops_review_list(null);
  perform pg_temp.chk('GOLDEN', 'the review queue sees the fixture: spend, publish and other cards, the send card, the wording card',
    concat_ws('|',
      (select string_agg(c->>'person_reason', ',' order by c->>'person_reason') from jsonb_array_elements(a->'cards') c
        where (c->>'id')::uuid in (pg_temp.id('two'), pg_temp.id('nobody'), pg_temp.id('odd'), pg_temp.id('auto'))),
      (select count(*)::text from jsonb_array_elements(a->'draft_needed') c where (c->>'id')::uuid = pg_temp.id('send')),
      (select count(*)::text from jsonb_array_elements(a->'wording') c where (c->>'id')::uuid = pg_temp.id('auto') and c ? 'roadmap')),
    'other,publish,publish,spend|1|1');
end;
$t$;

-- ───────────────────────────── BOARD ─────────────────────────────
do $t$
declare v_board jsonb; v_full jsonb; v_keys text; v_text jsonb; v_err text; v_same text;
  v_contract text := 'anchor,archived,auto,auto_kind,blocked,blocked_kind,carried_count,claim,closed_at,depth,due_on,estimate_minutes,files_count,goal,id,in_backlog,links,number,overdue,owners,parent,person_reason,position,proof,release_items,review,revision,sent_back,start_on,status,status_id,subtasks,tag,thread_count,title,watchers,working';
begin
  perform pg_temp.login('own');
  v_board := public.ops_work_list('{"who":"all","limit":300,"per_status":true,"subtasks":true,"shape":"board"}'::jsonb);
  v_full := public.ops_work_list('{"who":"all","limit":300,"per_status":true,"subtasks":true}'::jsonb);
  select string_agg(distinct ks, ';') into v_keys
    from (select (select string_agg(k, ',' order by k) from jsonb_object_keys(c) k) ks from jsonb_array_elements(v_board->'cards') c) x;
  perform pg_temp.chk('BOARD', 'every board card carries exactly the board contract keys', v_keys, v_contract);
  perform pg_temp.chk('BOARD', 'board returns the same cards, in the same order, with the same counts and columns',
    ((select array_agg(c->>'id') from jsonb_array_elements(v_board->'cards') c) = (select array_agg(c->>'id') from jsonb_array_elements(v_full->'cards') c)
     and (v_board - 'cards') = (v_full - 'cards'))::text, 'true');
  select string_agg(b->>'id' || ':' || k, ',') into v_same
    from jsonb_array_elements(v_board->'cards') with ordinality bx(b, n)
    join jsonb_array_elements(v_full->'cards') with ordinality fx(f, n) using (n)
    cross join lateral jsonb_object_keys(b) k
   where (k <> 'links' and b->k is distinct from f->k)
      or (k = 'links' and b->k is distinct from (select coalesce(jsonb_agg(l - 'exists'), '[]'::jsonb) from jsonb_array_elements(f->'links') l));
  perform pg_temp.chk('BOARD', 'every board value equals the full value (links without exists)', coalesce(v_same, 'same'), 'same');
  perform pg_temp.chk('BOARD', 'board links keep kind and id (Admin linked filter); proof keeps kind and id (draft ids)',
    (select string_agg(l->>'kind', ',' order by l->>'kind') from jsonb_array_elements(v_board->'cards') c, jsonb_array_elements(c->'links') l where c->>'id' = pg_temp.id('send')::text)
    || '|' || (select string_agg(p->>'kind', ',') from jsonb_array_elements(v_board->'cards') c, jsonb_array_elements(c->'proof') p where c->>'id' = pg_temp.id('send')::text),
    'host|draft,url');
  v_text := public.ops_work_list('{"who":"all","q":"W2 card","shape":"board"}'::jsonb);
  perform pg_temp.chk('BOARD', 'board with q also carries the full instructions text',
    (select string_agg(distinct ((c ? 'instructions') and c->>'instructions' = (select w.instructions from public.ops_work_cards w where w.id = (c->>'id')::uuid))::text, ',')
       from jsonb_array_elements(v_text->'cards') c) || '/' || (jsonb_array_length(v_text->'cards') > 0)::text, 'true/true');
  begin
    perform public.ops_work_list('{"shape":"tiny"}'::jsonb); v_err := 'no error';
  exception when others then v_err := sqlstate || ':' || sqlerrm; end;
  perform pg_temp.lk('BOARD', 'an unknown shape is refused 22023 and names shape', v_err, '22023:invalid_query:%shape%');
  begin
    perform public.ops_work_list('{"shape":["board"]}'::jsonb); v_err := 'no error';
  exception when others then v_err := sqlstate || ':' || sqlerrm; end;
  perform pg_temp.lk('BOARD', 'a non-string shape is refused 22023 and names shape', v_err, '22023:invalid_query:%shape%');
  begin
    perform public.ops_cards_json(array[pg_temp.id('plain')], current_date, 'board_textx'); v_err := 'no error';
  exception when others then v_err := sqlstate || ':' || sqlerrm; end;
  perform pg_temp.lk('BOARD', 'the builder refuses an unknown shape too', v_err, '22023:%shape%');
  begin
    perform public.ops_work_list('{"pages":1}'::jsonb); v_err := 'no error';
  exception when others then v_err := sqlstate || ':' || sqlerrm; end;
  perform pg_temp.lk('BOARD', 'the unknown-key message lists shape among the keys', v_err, '22023:invalid_query: The board cannot filter by "pages".%backlog and shape.');
end;
$t$;

-- ───────────────────────────── PLAN ─────────────────────────────
do $t$
declare v_ids uuid[]; v_base jsonb; a jsonb; b jsonb; p boolean;
begin
  v_ids := array(select id from tx_ids order by k desc);
  v_base := jsonb_build_array(jsonb_build_object('id', pg_temp.id('plain')), jsonb_build_object('id', pg_temp.id('parent')),
                              jsonb_build_object('title', 'no id here'), jsonb_build_object('id', null));
  foreach p in array array[true, false] loop
    a := (select jsonb_agg(public.ops_plan_card_json(w, v_base, p) order by u.ord) from unnest(v_ids) with ordinality u(id, ord) join public.ops_work_cards w on w.id = u.id);
    b := public.ops_plan_cards_json(v_ids, v_base, p);
    perform pg_temp.chk('PLAN', format('ops_plan_cards_json = ops_plan_card_json per card (planned %s, baseline with gaps)', p), (a = b)::text, 'true');
    a := (select jsonb_agg(public.ops_plan_card_json(w, null, p) order by u.ord) from unnest(v_ids) with ordinality u(id, ord) join public.ops_work_cards w on w.id = u.id);
    b := public.ops_plan_cards_json(v_ids, null, p);
    perform pg_temp.chk('PLAN', format('ops_plan_cards_json = ops_plan_card_json per card (planned %s, no baseline)', p), (a = b)::text, 'true');
  end loop;
  perform pg_temp.chk('PLAN', 'added_mid_sprint is true only for planned cards outside the baseline',
    (select string_agg((e->>'added_mid_sprint'), ',' order by e->>'number') from jsonb_array_elements(public.ops_plan_cards_json(array[pg_temp.id('plain'), pg_temp.id('two')], v_base, true)) e),
    'false,true');
end;
$t$;

-- ───────────────────────────── COST (I-OPS-LIST-NO-PER-ROW-NAME-LOOKUP) ─────────────────────────────
do $t$
declare v_mon date := public.ops_monday((now() at time zone 'UTC')::date); v_t0 timestamptz; v_ms numeric; v_best numeric := 1e9;
        v jsonb; v_names bigint; v_display bigint; v_people integer; i integer;
begin
  -- 300 more open cards in To do, each with an owner and a watcher drawn from the team.
  set local session_replication_role = replica;
  insert into public.ops_work_cards (title, instructions, done_means, status, status_id, due_on, due_source, sprint_id, created_by, updated_by)
  select 'W2 bulk ' || g, 'Bulk card ' || g || ' for the cost check.', 'It is done and checked.', 'todo', 'a4255000-0000-4000-8000-000000000001',
         current_date + g % 9, 'explicit', (select id from public.ops_sprints where starts_on = v_mon), pg_temp.email('own'), pg_temp.email('own')
    from generate_series(1, 300) g;
  insert into public.ops_work_people (card_id, email, role, added_by)
  select w.id, (array[pg_temp.email('own'), pg_temp.email('adm'), pg_temp.email('mem'), pg_temp.email('agt')])[1 + w.number % 4], 'owner', 'system@usemingla.com'
    from public.ops_work_cards w where w.title like 'W2 bulk %'
  union all
  select w.id, (array[pg_temp.email('odd'), pg_temp.email('plain')])[1 + w.number % 2], 'watcher', 'system@usemingla.com'
    from public.ops_work_cards w where w.title like 'W2 bulk %';
  set local session_replication_role = origin;
  perform pg_temp.login('own');
  set local track_functions = 'all';
  v := public.ops_work_list('{"who":"all","limit":300,"per_status":true,"subtasks":true,"shape":"board","status_id":["a4255000-0000-4000-8000-000000000001"]}'::jsonb);
  select coalesce(sum(calls) filter (where funcname = 'ops_name'), 0), coalesce(sum(calls) filter (where funcname = 'crm_display_name'), 0)
    into v_names, v_display from pg_stat_xact_user_functions where schemaname = 'public';
  select count(distinct p.email) into v_people from public.ops_work_people p
   where p.card_id in (select (c->>'id')::uuid from jsonb_array_elements(v->'cards') c);
  perform pg_temp.chk('COST', 'the board returns 300 cards', jsonb_array_length(v->'cards')::text, '300');
  -- Constant overhead only: ops_name(NULL) once, plus the sprint goals' owner
  -- names (ops_sprint_json, unchanged). The old body made about ten per card.
  perform pg_temp.chk('COST', format('300 cards: ops_name calls stay constant (got %s, at most 5) and crm_display_name runs about once per distinct email (got %s for %s people)',
    v_names, v_display, v_people), (v_names <= 5 and v_display <= v_people + 12)::text, 'true');
  for i in 1..5 loop
    v_t0 := clock_timestamp();
    v := public.ops_work_list('{"who":"all","limit":300,"per_status":true,"subtasks":true,"shape":"board","status_id":["a4255000-0000-4000-8000-000000000001"]}'::jsonb);
    v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
    v_best := least(v_best, v_ms);
  end loop;
  raise notice '#4423 COST: board of 300 cards best of 5 = % ms, % KB', round(v_best, 1), octet_length(v::text) / 1024;
  perform pg_temp.chk('COST', format('a 300-card board runs in at most 150 ms (best of 5: %s ms)', round(v_best, 1)), (v_best <= 150)::text, 'true');
end;
$t$;

-- ───────────────────────────── GRANTS ─────────────────────────────
select pg_temp.chk('GRANTS', 'the builders are internal: no anon or authenticated EXECUTE',
  (select string_agg(r || ':' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by f, r)
     from unnest(array['public.ops_cards_json(uuid[], date, text)', 'public.ops_plan_cards_json(uuid[], jsonb, boolean)', 'public.ops_names_for(text[])']) f,
          unnest(array['anon', 'authenticated']) r),
  'anon:false,authenticated:false,anon:false,authenticated:false,anon:false,authenticated:false');
select pg_temp.chk('GRANTS', 'the RPCs keep authenticated EXECUTE and stay closed to anon',
  (select string_agg(has_function_privilege('authenticated', f, 'EXECUTE')::text || '/' || has_function_privilege('anon', f, 'EXECUTE')::text, ',' order by f)
     from unnest(array['public.ops_work_list(jsonb)', 'public.ops_review_list(date)', 'public.ops_my_counts(date)', 'public.ops_sprint_plan_get(uuid, date)']) f),
  'true/false,true/false,true/false,true/false');
select pg_temp.chk('GRANTS', 'the builders are SECURITY DEFINER with a pinned search_path',
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '-'), ',' order by p.proname)
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ops_cards_json', 'ops_plan_cards_json', 'ops_names_for')),
  'ops_cards_json:true:search_path=pg_catalog, pg_temp,ops_names_for:true:search_path=pg_catalog, pg_temp,ops_plan_cards_json:true:search_path=pg_catalog, pg_temp');

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 30 then raise exception '#4423 W2 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4423 W2 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4423 W2 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
