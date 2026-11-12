-- Issue #4398 (Work board v3) -- INDEPENDENT TESTER adversarial suite for
-- 20280626004398_issue_4398_routes_and_people.sql,
-- 20280626014398_issue_4398_review_and_notices.sql and
-- 20280626034398_issue_4398_people_invariant.sql, on the fully replayed PG17
-- schema. Everything is rolled back. It attacks angles the implementor suite
-- does not:
--
--   ROUTE    a maker that passes its own parent and people (even people not
--            on the team) is overridden; an ARCHIVED route card walks up; a
--            route card shaped like production #153 (depth 1 with depth-2
--            children) takes a bot card at depth 2 and nothing goes to 3; a
--            reroute of a bot card that has children never pushes them to 3;
--            two different keys of one unroutable kind and repeated runs give
--            ONE route_missing alarm and one stopped log line; a closed alarm
--            comes back as one; a garbage fallback value refuses quietly; an
--            unknown prefix and ari_gap_digest with no route use the
--            fallback; ops_setting_set refuses an agent, a growth teammate, an
--            archived card and an unknown top-level key.
--   PEOPLE   ops_people_set called directly with two owners; a people row
--            moved to a CLOSED card (the old card is checked); a role flip
--            owner->watcher; delete-and-reinsert swap (allowed); unarchiving
--            an open card with no watcher; Undo restoring a two-watcher
--            snapshot; legacy reopen with two owners and no parent (refused,
--            then allowed with picked people); a legacy subtask owned by its
--            parent's watcher; a plan step naming the parent's watcher keeps
--            "Seth owner, Taofeek watcher" and keeps it on re-sync; two-owner
--            subtask_add; an add with nobody.
--   REVIEW   an agent close then a second close by the owner; a third
--            teammate confirming; a stale confirm (PT409); send back at 4,
--            5, 300 and 301 characters and with a control character; the
--            watcher's OWN agent closing (review, never Done); the owner
--            pulling a card back out of review; direct writes through
--            status_id only, closed_via = claude, an INSERT born done, and
--            the authenticated role writing the table or calling
--            ops_work_finish; a forged ops.review_confirmed GUC; close with
--            children through review; Undo of the owner's Mark done; push
--            back and Mark sent through review; the watcher's drag to Done
--            is the confirm.
--   BOT      a failed deploy stays its own card beside the per-PR release
--            card; two sync runs make no duplicate card or notice; an old
--            per-kind card is never lost when the release card cannot be
--            made, and folds once it can; a legacy feature_guide_gap:sha-*
--            card folds into the standing card; no function makes a
--            guide_live card.
--   AUTH     a card write by a signed-in person COMMITS while the session
--            role is still authenticated, as every PostgREST request does
--            (Admin and the Host app): the deferred invariant must be able to
--            run at commit in that role.
--   UNDO     undo of a Confirm that closed a child and a grandchild reopens
--            both to their columns; a non-watcher and the 61st second are
--            refused; a subtask changed since makes the whole undo refuse
--            (no half undo); the undo commits as the signed-in role with
--            every card at 1 owner and 1 watcher.
--   NOTICE   a bot close is Admin-only with no outbox; an owner's agent
--            moving a card pushes to the watcher, never the owner; a reopen
--            pushes to the other person; a due-date change is Admin-only; a
--            system actor never pushes, an unknown kind falls to edit; the
--            Host app's mark-read never touches Admin-only rows.
--
-- FAILS-ON-REVERT: on origin/main 559e3e6902 (no #4398 migrations) the first
-- block fails at once (ops_settings has no auto_card_routes row, and
-- ops_auto_card_reroute, ops_work_confirm, ops_release_items and the
-- invariant triggers do not exist).
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '43980000-0000-4000-b000-000000000001', 'seth.adv4398@test.local'),
  ('tao',  '43980000-0000-4000-b000-000000000002', 'tao.adv4398@test.local'),
  ('abi',  '43980000-0000-4000-b000-000000000003', 'abi.adv4398@test.local'),
  ('kun',  '43980000-0000-4000-b000-000000000004', 'kun.adv4398@test.local'),
  ('ola',  '43980000-0000-4000-b000-000000000005', 'ola.adv4398@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('seth.adv4398@test.local', 'owner', 'active', now()), ('abi.adv4398@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who in ('tao', 'kun', 'ola');

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
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
create function pg_temp.next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;
create function pg_temp.person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.next_request();
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'close_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.commit_check(p_sql text) returns text
language plpgsql as $fn$
begin
  begin
    execute p_sql;
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards immediate;
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
    raise exception 'ok_rollback' using errcode = 'P0001';
  exception when others then
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
    return case when sqlerrm = 'ok_rollback' then 'OK' else 'ERR:' || sqlstate || ':' || sqlerrm end;
  end;
end;
$fn$;
-- Runs p_sql as the signed-in person AND fires the deferred invariant while
-- still in that role, as a PostgREST request does at COMMIT (role
-- authenticated for the whole transaction). pg_temp.as_ resets the role
-- before the commit-time check, which hides a trigger the role cannot run.
create function pg_temp.commit_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.role', '', true);
    execute p_sql into v_out;
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards immediate;
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
    reset role;
    raise exception 'ok_rollback' using errcode = 'P0001';
  exception when others then
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
    reset role;
    return case when sqlerrm = 'ok_rollback' then 'OK' else 'ERR:' || sqlstate || ':' || sqlerrm end;
  end;
end;
$fn$;
-- Runs p_sql; returns OK or the error, never lets it escape.
create function pg_temp.try(p_sql text) returns text
language plpgsql as $fn$
begin
  begin
    execute p_sql;
    return 'OK';
  exception when others then
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tx_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from tx_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tx_ids where k = p_k) $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 'adv-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.people(p_id uuid) returns text
language sql as $fn$
  select coalesce((select string_agg(t.who || ':' || p.role, ',' order by p.role, t.who) from public.ops_work_people p
                     join tx_people t on t.email = p.email where p.card_id = p_id), '<none>')
$fn$;
create function pg_temp.st(p_k text) returns text
language sql as $fn$
  select w.status || '/' || s.name from public.ops_work_cards w join public.ops_work_statuses s on s.id = w.status_id where w.id = pg_temp.id(p_k)
$fn$;
create function pg_temp.add(p_k text, p_title text, p_owner text, p_watcher text, p_parent text default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'due_on', (now() at time zone 'UTC')::date + 3);
  if p_owner is not null then v_item := v_item || jsonb_build_object('owners', jsonb_build_array(pg_temp.email(p_owner))); end if;
  if p_watcher is not null then v_item := v_item || jsonb_build_object('watchers', jsonb_build_array(pg_temp.email(p_watcher))); end if;
  if p_parent is not null then v_item := v_item || jsonb_build_object('parent', pg_temp.id(p_parent)); end if;
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.auto(p_key text, p_title text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql as $fn$
  select public.ops_auto_card_upsert(p_key, jsonb_build_object('title', p_title,
    'instructions', 'Mingla found something to do and wrote it down here.', 'done_means', 'It is done.',
    'owners', jsonb_build_array('ola.adv4398@test.local', 'kun.adv4398@test.local', 'nobody-at-all@elsewhere.example'),
    'watchers', jsonb_build_array('ola.adv4398@test.local', 'kun.adv4398@test.local'),
    'due_on', (now() at time zone 'UTC')::date + 1) || p_extra, 'task', null)
$fn$;
create function pg_temp.routes(p_routes jsonb, p_fallback text) returns void
language sql as $fn$
  update public.ops_settings set value = jsonb_build_object('routes', p_routes, 'fallback', p_fallback) where key = 'auto_card_routes'
$fn$;
create function pg_temp.close_as(p_who text, p_k text, p_proof text default 'Checked and done.') returns text
language sql as $fn$
  select pg_temp.person(p_who, format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id(p_k),
           jsonb_build_array(jsonb_build_object('kind', 'text', 'text', p_proof)), pg_temp.rev(p_k)))
$fn$;
create function pg_temp.notices(p_event uuid) returns text
language sql as $fn$
  select coalesce((select string_agg(t.who || ':' || m.event_kind || ':' || m.push::text, ',' order by t.who) from public.team_mentions m
                     join tx_people t on t.id = m.target_user_id where m.source_id = p_event), '<none>')
$fn$;

-- ───────────────────────────── fixtures ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.add('M',   'ADV4398 Release hygiene', 'tao', 'seth');
  v := pg_temp.add('G',   'ADV4398 Finish release records', 'tao', 'seth', 'M');
  v := pg_temp.add('DF',  'ADV4398 Fix failed deploys', 'tao', 'seth', 'M');
  v := pg_temp.add('K',   'ADV4398 First event details', 'kun', 'abi');
  v := pg_temp.add('K2',  'ADV4398 First event asks group', 'kun', 'abi', 'K');
  v := pg_temp.add('H',   'ADV4398 Host launches', 'abi', 'seth');
  v := pg_temp.add('HC',  'ADV4398 Salsa make-good (the #153 shape)', 'seth', 'abi', 'H');
  v := pg_temp.add('HCS', 'ADV4398 Salsa make-good step', 'seth', 'abi', 'HC');
  v := pg_temp.add('F',   'ADV4398 Fallback main task', 'tao', 'seth');
  perform pg_temp.chk('SETUP', 'nine fixture cards', (select count(*)::text from tx_ids), '9');
  perform pg_temp.chk('SETUP', 'HC is depth 1 with a depth-2 child, like production #153',
    (select string_agg(depth::text, ',' order by depth) from public.ops_work_cards where id in (pg_temp.id('H'), pg_temp.id('HC'), pg_temp.id('HCS'))), '0,1,2');
  perform pg_temp.routes(jsonb_build_object('eng_release', pg_temp.id('G'), 'eng_deploy_failed', pg_temp.id('DF'),
    'ask', pg_temp.id('K2'), 'golive', pg_temp.id('HC'), 'brand_pick', pg_temp.id('H')), pg_temp.id('F')::text);
end;
$t$;

-- ───────────────────────────── ROUTE ─────────────────────────────
do $t$
declare v jsonb; v_id uuid; v_child uuid; v_t text;
begin
  -- R1. The maker names its own parent (the fallback) and people who are not on the team.
  v := pg_temp.auto('eng_deploy_failed:pr-884398:edge', 'ADV4398 Fix the failed edge deploy of PR #884398',
    jsonb_build_object('parent', pg_temp.id('F')));
  perform pg_temp.chk('ROUTE', 'R1 a maker''s own parent and non-team people do not refuse the card', v->>'status', 'added');
  v_id := (v->>'id')::uuid; perform pg_temp.keep('DF1', v_id);
  perform pg_temp.chk('ROUTE', 'R1 the route wins over the maker''s parent',
    ((select parent_id from public.ops_work_cards where id = v_id) = pg_temp.id('DF'))::text, 'true');
  perform pg_temp.chk('ROUTE', 'R1 exactly the route card''s 1 owner and 1 watcher', pg_temp.people(v_id), 'tao:owner,seth:watcher');

  -- R2. An ARCHIVED route card (not closed) walks up to its parent.
  update public.ops_work_cards set archived_at = now(), archived_by = 'system@usemingla.com', archive_reason = 'Adversarial test.' where id = pg_temp.id('K2');
  v := pg_temp.auto('ask:adv4398-host-1', 'ADV4398 Ask a host for their first event');
  perform pg_temp.chk('ROUTE', 'R2 archived route card: the card lands on its parent with its people',
    ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('K'))::text || '/' || pg_temp.people((v->>'id')::uuid),
    'true/kun:owner,abi:watcher');

  -- R3. The #153 shape: a depth-1 route card that already has depth-2 children.
  v := pg_temp.auto('golive:event:adv4398', 'ADV4398 Get the Salsa event live');
  v_id := (v->>'id')::uuid;
  perform pg_temp.chk('ROUTE', 'R3 a bot card under the #153-shaped card is depth 2 with its people',
    (select depth::text from public.ops_work_cards where id = v_id) || '/' || pg_temp.people(v_id), '2/seth:owner,abi:watcher');
  perform pg_temp.chk('ROUTE', 'R3 nothing anywhere is deeper than 2', (select coalesce(max(depth), 0)::text from public.ops_work_cards), '2');
  v := pg_temp.auto('golive:event:adv4398b', 'ADV4398 Get another event live',
    jsonb_build_object('plan', jsonb_build_array(jsonb_build_object('n', 1, 'text', 'Check the page', 'tool', 'person'))));
  perform pg_temp.lk('ROUTE', 'R3 a plan under the #153-shaped card is refused, never made silently', v->>'status' || ':' || (v->'fixes'->0->>'message'), 'refused:too_deep:%');

  -- R4. Reroute of a bot card that has its own children never pushes them to depth 3.
  v := pg_temp.auto('brand_pick:adv4398', 'ADV4398 Pick the host card for a brand');
  v_id := (v->>'id')::uuid; perform pg_temp.keep('BP', v_id);
  v_t := pg_temp.person('seth', format('select public.ops_subtask_add(%L, %L::jsonb, %L)::text', v_id,
          jsonb_build_object('title', 'ADV4398 Ask the brand which card'), pg_temp.rk()));
  v_child := ((v_t::jsonb)->'subtask'->>'id')::uuid;
  perform pg_temp.chk('ROUTE', 'R4 setup: bot card depth 1 with a depth-2 child',
    (select depth::text from public.ops_work_cards where id = v_id) || '/' || (select depth::text from public.ops_work_cards where id = v_child), '1/2');
  perform pg_temp.routes(jsonb_build_object('eng_release', pg_temp.id('G'), 'eng_deploy_failed', pg_temp.id('DF'),
    'golive', pg_temp.id('HC'), 'brand_pick', pg_temp.id('HC')), pg_temp.id('F')::text);
  perform pg_temp.chk('ROUTE', 'R4 reroute to a depth-1 route is refused when it has children', public.ops_auto_card_reroute(v_id)::text, 'false');
  perform pg_temp.chk('ROUTE', 'R4 the card and its child stay where they were (1 and 2)',
    (select depth::text from public.ops_work_cards where id = v_id) || '/' || (select depth::text from public.ops_work_cards where id = v_child)
      || '/' || ((select parent_id from public.ops_work_cards where id = v_id) = pg_temp.id('H'))::text, '1/2/true');

  -- R5. Nowhere to go: two keys of one kind, three runs, ONE alarm, one log line.
  perform pg_temp.routes('{}'::jsonb, null);
  v := pg_temp.auto('recap:adv4398-e1', 'ADV4398 Recap event one');
  perform pg_temp.chk('ROUTE', 'R5 nowhere to go: refused, not an error', v->>'status', 'refused');
  v := pg_temp.auto('recap:adv4398-e2', 'ADV4398 Recap event two');
  v := pg_temp.auto('recap:adv4398-e1', 'ADV4398 Recap event one');
  perform pg_temp.chk('ROUTE', 'R5 no recap card was made anywhere', (select count(*)::text from public.ops_work_cards where auto_key like 'recap:adv4398%'), '0');
  perform pg_temp.chk('ROUTE', 'R5 one route_missing alarm for the kind, top level, 1 owner 1 watcher',
    (select count(*)::text || '/' || max(depth)::text || '/' || max(pg_temp.people(id)) from public.ops_work_cards where auto_key = 'route_missing:recap' and status <> 'done'),
    '1/0/seth:owner,abi:watcher');
  perform pg_temp.chk('ROUTE', 'R5 one stopped log line for the kind today, not one per run',
    (select count(*)::text from public.ops_agent_log where action = 'card_refused' and outcome = 'stopped' and detail->>'route_missing' = 'recap'), '1');
  -- The board owner closes the alarm (In review); the admin confirms it; it comes back as one.
  select id into v_id from public.ops_work_cards where auto_key = 'route_missing:recap' and status <> 'done';
  perform pg_temp.keep('ALARM', v_id);
  v_t := pg_temp.close_as('seth', 'ALARM');
  perform pg_temp.chk('ROUTE', 'R5 the owner''s close of the alarm waits In review', pg_temp.st('ALARM'), 'doing/In review');
  v := pg_temp.auto('recap:adv4398-e3', 'ADV4398 Recap event three');
  perform pg_temp.chk('ROUTE', 'R5 while it waits, still one alarm', (select count(*)::text from public.ops_work_cards where auto_key = 'route_missing:recap'), '1');
  v_t := pg_temp.person('abi', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('ALARM'), pg_temp.rev('ALARM')));
  v := pg_temp.auto('recap:adv4398-e3', 'ADV4398 Recap event three');
  perform pg_temp.chk('ROUTE', 'R5 after it closed and the problem is still there: exactly one open alarm again',
    (select count(*) filter (where status <> 'done')::text || '/' || count(*)::text from public.ops_work_cards where auto_key = 'route_missing:recap'), '1/2');

  -- R6. A garbage fallback value and an unknown prefix.
  perform pg_temp.routes('{}'::jsonb, 'not-a-uuid');
  perform pg_temp.chk('ROUTE', 'R6 a garbage fallback never raises', pg_temp.try($q$select pg_temp.auto('qqq_unheard:adv1', 'ADV4398 Unknown kind one')$q$), 'OK');
  perform pg_temp.routes('{"ari_gap_digest": "00000000-0000-4000-8000-00000000dead"}'::jsonb, pg_temp.id('F')::text);
  v := pg_temp.auto('qqq_unheard:adv2', 'ADV4398 Unknown kind two');
  perform pg_temp.chk('ROUTE', 'R6 an unknown prefix lands on the fallback',
    v->>'status' || '/' || ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('F'))::text, 'added/true');
  v := pg_temp.auto('ari_gap_digest:2026-11-16', 'ADV4398 Ari gaps this week');
  perform pg_temp.chk('ROUTE', 'R6 ari_gap_digest routed to a card that does not exist falls back, no error',
    v->>'status' || '/' || ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('F'))::text || '/' || pg_temp.people((v->>'id')::uuid),
    'added/true/tao:owner,seth:watcher');
end;
$t$;

do $t$
declare v text;
begin
  -- R7. ops_setting_set refuses what it must.
  v := pg_temp.agent('seth', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K')), 'fallback', pg_temp.id('F'))));
  perform pg_temp.lk('ROUTE', 'R7 the board owner''s agent cannot change routes', v, 'ERR:42501:%');
  v := pg_temp.person('ola', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K')), 'fallback', pg_temp.id('F'))));
  perform pg_temp.lk('ROUTE', 'R7 a growth teammate cannot change routes', v, 'ERR:42501:%');
  v := pg_temp.person('seth', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K2')), 'fallback', pg_temp.id('F'))));
  perform pg_temp.lk('ROUTE', 'R7 a route to an archived card is refused', v, 'ERR:22023:invalid_setting:%');
  v := pg_temp.person('seth', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K')), 'fallback', pg_temp.id('K2'))));
  perform pg_temp.lk('ROUTE', 'R7 an archived fallback is refused', v, 'ERR:22023:invalid_setting:%');
  v := pg_temp.person('seth', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K')), 'fallback', pg_temp.id('F'), 'extra', true)));
  perform pg_temp.lk('ROUTE', 'R7 an unknown top-level key is refused', v, 'ERR:22023:invalid_setting:%');
  v := pg_temp.person('seth', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('Ask Me', pg_temp.id('K')), 'fallback', pg_temp.id('F'))));
  perform pg_temp.lk('ROUTE', 'R7 a kind that is not a lower-case word is refused', v, 'ERR:22023:invalid_setting:%');
  v := pg_temp.person('seth', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K')), 'fallback', pg_temp.id('F'))));
  perform pg_temp.chk('ROUTE', 'R7 the owner signed in can', (v not like 'ERR:%')::text, 'true');
  perform pg_temp.routes(jsonb_build_object('eng_release', pg_temp.id('G'), 'eng_deploy_failed', pg_temp.id('DF'), 'ask', pg_temp.id('K')), pg_temp.id('F')::text);
end;
$t$;

-- ───────────────────────────── PEOPLE ─────────────────────────────
do $t$
declare v text; v_id uuid; v_q uuid; v_ev uuid;
begin
  v := pg_temp.add('P', 'ADV4398 People target', 'tao', 'seth');
  -- P1. ops_people_set straight from a SECURITY DEFINER caller with two owners.
  perform pg_temp.lk('PEOPLE', 'P1 ops_people_set with two owners is refused at commit',
    pg_temp.commit_check(format($q$select public.ops_people_set(%L, array[%L, %L], array[%L], 'system@usemingla.com', null)$q$,
      pg_temp.id('P'), pg_temp.email('tao'), pg_temp.email('kun'), pg_temp.email('seth'))), 'ERR:23514:card_people:%');
  -- P2. Moving P's owner row onto a CLOSED card: P (the old card) is checked.
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, status, close_kind, closed_at, closed_by, closed_via, created_by, updated_by)
  values ('ADV4398 Closed target', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'done', 'system', now(), 'system@usemingla.com', 'system', 'system@usemingla.com', 'system@usemingla.com')
  returning id into v_q;
  perform pg_temp.keep('Q', v_q);
  perform pg_temp.lk('PEOPLE', 'P2 moving the owner row to a closed card is refused (the old card loses its owner)',
    pg_temp.commit_check(format($q$update public.ops_work_people set card_id = %L where card_id = %L and role = 'owner'$q$, v_q, pg_temp.id('P'))),
    'ERR:23514:card_people:%');
  -- P3. A role flip owner -> watcher.
  perform pg_temp.lk('PEOPLE', 'P3 flipping the owner to a second watcher is refused',
    pg_temp.commit_check(format($q$update public.ops_work_people set role = 'watcher' where card_id = %L and role = 'owner'$q$, pg_temp.id('P'))),
    'ERR:23514:card_people:%');
  -- P4. Delete-and-reinsert swap in one transaction.
  perform pg_temp.chk('PEOPLE', 'P4 deleting both and reinserting them swapped is allowed',
    pg_temp.commit_check(format($q$delete from public.ops_work_people where card_id = %1$L;
      insert into public.ops_work_people (card_id, email, role, added_by) values (%1$L, %2$L, 'owner', 'system@usemingla.com'), (%1$L, %3$L, 'watcher', 'system@usemingla.com')$q$,
      pg_temp.id('P'), pg_temp.email('seth'), pg_temp.email('tao'))), 'OK');
  -- P5. Unarchiving an open card that has no watcher.
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, archived_at, archived_by, archive_reason, created_by, updated_by)
  values ('ADV4398 Archived legacy card', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), now(), 'system@usemingla.com', 'Old.', 'system@usemingla.com', 'system@usemingla.com')
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, pg_temp.email('tao'), 'owner', 'system@usemingla.com');
  perform pg_temp.chk('PEOPLE', 'P5 an archived card with no watcher is allowed', pg_temp.commit_check('select 1'), 'OK');
  perform pg_temp.lk('PEOPLE', 'P5 unarchiving it is refused',
    pg_temp.commit_check(format($q$update public.ops_work_cards set archived_at = null, archived_by = null, archive_reason = null where id = %L$q$, v_id)),
    'ERR:23514:card_people:%');
  -- P6. Undo that would restore a two-watcher snapshot.
  v := pg_temp.person('seth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('P'),
         jsonb_build_object('watchers', jsonb_build_array(pg_temp.email('abi')), 'owners', jsonb_build_array(pg_temp.email('tao'))), pg_temp.rev('P')));
  v_ev := ((v::jsonb)->>'event_id')::uuid;
  perform pg_temp.chk('PEOPLE', 'P6 setup: the swap to tao/abi went through', pg_temp.people(pg_temp.id('P')), 'tao:owner,abi:watcher');
  update public.ops_work_events set before = jsonb_set(before, '{people}', (before->'people') || jsonb_build_array(jsonb_build_object(
      'email', pg_temp.email('kun'), 'role', 'watcher', 'added_by', 'system@usemingla.com', 'added_via', null, 'added_at', now())))
   where id = v_ev;
  perform pg_temp.lk('PEOPLE', 'P6 an undo that would put back two watchers is refused at commit',
    pg_temp.commit_check(format($q$select pg_temp.person('seth', %L)$q$, format('select public.ops_work_undo(%L)::text', v_ev))), 'ERR:23514:card_people:%');
end;
$t$;

do $t$
declare v text; v_id uuid; v_step uuid;
begin
  -- P7. A legacy closed top-level card with two owners and no watcher.
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, status, close_kind, closed_at, closed_by, closed_via, created_by, updated_by)
  values ('ADV4398 Legacy two owners', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'done', 'system', now(), 'system@usemingla.com', 'system', 'system@usemingla.com', 'system@usemingla.com')
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values
    (v_id, pg_temp.email('tao'), 'owner', 'system@usemingla.com'), (v_id, pg_temp.email('kun'), 'owner', 'system@usemingla.com');
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s)::text', v_id, (select revision from public.ops_work_cards where id = v_id)));
  perform pg_temp.lk('PEOPLE', 'P7 reopening a legacy two-owner card with no parent is refused, naming the problem', v, 'ERR:23514:card_people: This card has 2 owners and no watcher.%');
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s, %L, %L)::text', v_id, (select revision from public.ops_work_cards where id = v_id),
         pg_temp.email('kun'), pg_temp.email('seth')));
  perform pg_temp.chk('PEOPLE', 'P7 with an owner and watcher picked it reopens with exactly those two',
    (select status from public.ops_work_cards where id = v_id) || '/' || pg_temp.people(v_id), 'todo/kun:owner,seth:watcher');
  -- P8. A legacy closed subtask owned by its parent's watcher, no watcher.
  v := pg_temp.add('P2', 'ADV4398 Parent of legacy steps', 'tao', 'seth');
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, status, close_kind, closed_at, closed_by, closed_via, parent_id, created_by, updated_by)
  values ('ADV4398 Seth checks the copy', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'done', 'system', now(), 'system@usemingla.com', 'system', pg_temp.id('P2'), 'system@usemingla.com', 'system@usemingla.com')
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, pg_temp.email('seth'), 'owner', 'system@usemingla.com');
  v := pg_temp.person('tao', format('select public.ops_work_reopen(%L, null, %s)::text', v_id, (select revision from public.ops_work_cards where id = v_id)));
  perform pg_temp.chk('PEOPLE', 'P8 a reopened legacy step owned by the parent''s watcher: Seth owner, Taofeek watcher',
    (select status from public.ops_work_cards where id = v_id) || '/' || pg_temp.people(v_id), 'todo/seth:owner,tao:watcher');
  -- P9. Plan steps: a new step naming the parent's watcher, and re-syncs keep it.
  perform public.ops_plan_sync(pg_temp.id('P2'), jsonb_build_array(
    jsonb_build_object('n', 1, 'text', 'seth.adv4398@test.local approves the copy', 'tool', 'person', 'status', 'todo')), pg_temp.email('tao'), null);
  select id into v_step from public.ops_work_cards where parent_id = pg_temp.id('P2') and plan_step is not null order by position, number limit 1;
  perform pg_temp.chk('PEOPLE', 'P9 a new step naming the parent''s watcher: Seth owner, Taofeek watcher', pg_temp.people(v_step), 'seth:owner,tao:watcher');
  perform public.ops_plan_sync(pg_temp.id('P2'), jsonb_build_array(
    jsonb_build_object('n', 1, 'text', 'seth.adv4398@test.local approves the copy and the photo', 'tool', 'person', 'status', 'todo'),
    jsonb_build_object('n', 2, 'text', 'Read it back', 'tool', 'person', 'status', 'todo')), pg_temp.email('tao'), null);
  perform pg_temp.chk('PEOPLE', 'P9 a re-sync keeps the existing step''s people', pg_temp.people(v_step), 'seth:owner,tao:watcher');
  perform public.ops_plan_sync(pg_temp.id('P2'), jsonb_build_array(
    jsonb_build_object('n', 1, 'text', 'seth.adv4398@test.local approves the copy and the photo', 'tool', 'person', 'status', 'done'),
    jsonb_build_object('n', 2, 'text', 'Read it back', 'tool', 'person', 'status', 'todo')), pg_temp.email('tao'), null);
  perform pg_temp.chk('PEOPLE', 'P9 ticking a step through the plan closes it (no review for a checklist tick), people kept',
    (select status from public.ops_work_cards where id = v_step) || '/' || pg_temp.people(v_step), 'done/seth:owner,tao:watcher');
  -- P10. subtask_add with two owners; an add with nobody.
  v := pg_temp.person('seth', format('select public.ops_subtask_add(%L, %L::jsonb, %L)::text', pg_temp.id('P2'),
         jsonb_build_object('title', 'ADV4398 Two-owner subtask', 'owners', jsonb_build_array(pg_temp.email('tao'), pg_temp.email('kun'))), pg_temp.rk()));
  perform pg_temp.lk('PEOPLE', 'P10 a two-owner subtask is refused', v, '%A card has one owner. Pick one person.%');
  v := pg_temp.add('NOBODY', 'ADV4398 Card for nobody', null, null);
  perform pg_temp.chk('PEOPLE', 'P10 an add with neither owner nor watcher is refused with both fixes, never guessed',
    (v::jsonb)->'results'->0->>'status' || '/' ||
    (select string_agg(f->>'message', ' | ' order by f->>'field') from jsonb_array_elements((v::jsonb)->'results'->0->'fixes') f where f->>'field' in ('owners','watchers')),
    'refused/A card has one owner. Pick one person. | A card has one watcher, who is not the owner.');
  perform pg_temp.chk('PEOPLE', 'every open card of this suite passes the invariant now',
    (select count(*)::text from public.ops_work_cards w where w.status <> 'done' and w.archived_at is null
       and (cardinality(public.ops_card_people(w.id, 'owner')) <> 1 or cardinality(public.ops_card_people(w.id, 'watcher')) <> 1)), '0');
end;
$t$;

-- ───────────────────────────── REVIEW ─────────────────────────────
do $t$
declare v text; v_done uuid := public.ops_status_default('done');
begin
  -- V1. The owner's agent closes; the owner closes again.
  v := pg_temp.add('RC', 'ADV4398 Review via the agent', 'tao', 'seth');
  v := pg_temp.agent('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('RC'),
         jsonb_build_array(jsonb_build_object('kind', 'card', 'id', pg_temp.id('P'), 'text', 'Read the card back.')), pg_temp.rev('RC')));
  perform pg_temp.chk('REVIEW', 'V1 the owner''s agent close waits In review', pg_temp.st('RC'), 'doing/In review');
  v := pg_temp.close_as('tao', 'RC');
  perform pg_temp.lk('REVIEW', 'V1 a second close while it waits is refused, not a second ask', v, 'ERR:22023:in_review:%');
  -- V2. A third teammate, and a stale confirm.
  v := pg_temp.person('kun', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('RC'), pg_temp.rev('RC')));
  perform pg_temp.lk('REVIEW', 'V2 a teammate who is neither owner nor watcher cannot confirm', v, 'ERR:42501:not_watcher:%');
  v := pg_temp.person('abi', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('RC'), pg_temp.rev('RC')));
  perform pg_temp.lk('REVIEW', 'V2 an admin who is not the watcher cannot confirm', v, 'ERR:42501:not_watcher:%');
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('RC'), pg_temp.rev('RC') - 1));
  perform pg_temp.lk('REVIEW', 'V2 a stale confirm is PT409', v, 'ERR:PT409:%');
  v := pg_temp.agent('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('RC'), 'Agents cannot send back.', pg_temp.rev('RC')));
  perform pg_temp.lk('REVIEW', 'V2 the watcher''s agent cannot send back', v, 'ERR:42501:people_only:%');
  -- V3. Send back boundaries.
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('RC'), 'abcd', pg_temp.rev('RC')));
  perform pg_temp.lk('REVIEW', 'V3 a 4-character reason is refused', v, 'ERR:22023:reason_required:%');
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('RC'), repeat('x', 301), pg_temp.rev('RC')));
  perform pg_temp.lk('REVIEW', 'V3 a 301-character reason is refused', v, 'ERR:22023:reason_required:%');
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('RC'), 'abc' || chr(7) || 'defgh', pg_temp.rev('RC')));
  perform pg_temp.lk('REVIEW', 'V3 a reason with a control character is refused', v, 'ERR:22023:reason_required:%');
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('RC'), repeat('y', 300), pg_temp.rev('RC')));
  perform pg_temp.chk('REVIEW', 'V3 a 300-character reason is accepted: back to In progress', pg_temp.st('RC'), 'doing/In progress');
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('RC'), 'Fix 1', pg_temp.rev('RC')));
  perform pg_temp.lk('REVIEW', 'V3 send back when it is not in review is refused', v, 'ERR:22023:not_in_review:%');
  v := pg_temp.close_as('tao', 'RC');
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('RC'), 'Fix 1', pg_temp.rev('RC')));
  perform pg_temp.chk('REVIEW', 'V3 a 5-character reason is accepted', (select sent_back_reason from public.ops_work_cards where id = pg_temp.id('RC')), 'Fix 1');

  -- V4. The watcher's OWN agent closing is not a confirm.
  v := pg_temp.add('RW', 'ADV4398 Watcher agent close', 'tao', 'seth');
  v := pg_temp.agent('seth', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('RW'),
         jsonb_build_array(jsonb_build_object('kind', 'card', 'id', pg_temp.id('P'), 'text', 'Read the card back.')), pg_temp.rev('RW')));
  perform pg_temp.lk('REVIEW', 'V4 the watcher''s own agent cannot close it (an agent never confirms)', v, 'ERR:42501:not_your_card:%');
  perform pg_temp.chk('REVIEW', 'V4 and the card is not Done', pg_temp.st('RW'), 'todo/To do');
  v := pg_temp.close_as('tao', 'RW');
  -- V5. The owner pulls it back out: the ask is withdrawn.
  v := pg_temp.person('tao', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('RW'), public.ops_status_in_progress(), pg_temp.rev('RW')));
  perform pg_temp.chk('REVIEW', 'V5 the owner moving it out of review withdraws the ask',
    pg_temp.st('RW') || '/' || (select (review_requested_at is null)::text from public.ops_work_cards where id = pg_temp.id('RW')), 'doing/In progress/true');
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('RW'), pg_temp.rev('RW')));
  perform pg_temp.lk('REVIEW', 'V5 and the watcher can no longer confirm it', v, 'ERR:22023:not_in_review:%');

  -- V6. Direct writes.
  v := pg_temp.add('RD', 'ADV4398 Direct writes', 'tao', 'seth');
  perform pg_temp.lk('REVIEW', 'V6 an UPDATE of status_id alone to the Done column is refused',
    pg_temp.try(format($q$update public.ops_work_cards set status_id = %L where id = %L$q$, v_done, pg_temp.id('RD'))), 'ERR:42501:review_required:%');
  perform pg_temp.lk('REVIEW', 'V6 an UPDATE to done that claims an agent closed it is refused',
    pg_temp.try(format($q$update public.ops_work_cards set status = 'done', close_kind = 'done', closed_at = now(), closed_by = %L, closed_via = 'claude' where id = %L$q$,
      pg_temp.email('tao'), pg_temp.id('RD'))), 'ERR:42501:review_required:%');
  perform pg_temp.lk('REVIEW', 'V6 an INSERT born done (not a plan step, no parent) is refused',
    pg_temp.try($q$insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, status, close_kind, closed_at, closed_by, created_by, updated_by)
      values ('ADV4398 Born done', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit', public.ops_sprint_ensure(current_date),
              'done', 'done', now(), 'tao.adv4398@test.local', 'tao.adv4398@test.local', 'tao.adv4398@test.local')$q$), 'ERR:42501:review_required:%');
  v := pg_temp.person('tao', format($q$with x as (update public.ops_work_cards set status = 'done' where id = %L returning 1) select count(*)::text from x$q$, pg_temp.id('RD')));
  perform pg_temp.lk('REVIEW', 'V6 the authenticated role cannot write the table at all', v, 'ERR:42501:permission denied%');
  v := pg_temp.person('tao', format($q$select public.ops_work_finish((select w from public.ops_work_cards w where w.id = %L), %L, null, 'done', null, null, '[]'::jsonb, false)::text$q$,
         pg_temp.id('RD'), pg_temp.email('seth')));
  perform pg_temp.lk('REVIEW', 'V6 the authenticated role cannot call ops_work_finish (no forged watcher)', v, 'ERR:42501:permission denied%');
  v := pg_temp.person('tao', format($q$select set_config('ops.review_confirmed', 'on', true) || public.ops_work_close(%L, %L::jsonb, null, %s)::text$q$,
         pg_temp.id('RD'), jsonb_build_array(jsonb_build_object('kind', 'text', 'text', 'Forged the flag.')), pg_temp.rev('RD')));
  perform pg_temp.chk('REVIEW', 'V6 a forged ops.review_confirmed flag does not let the owner close: still In review', pg_temp.st('RD'), 'doing/In review');

  -- V7. Close with children, through review.
  v := pg_temp.add('CP', 'ADV4398 Parent with an open child', 'tao', 'seth');
  v := pg_temp.add('CPS', 'ADV4398 The open child', 'kun', 'tao', 'CP');
  v := pg_temp.person('tao', format('select public.ops_work_move(%L, %L, %s, %L::jsonb, null, true)::text', pg_temp.id('CP'), v_done, pg_temp.rev('CP'),
         jsonb_build_array(jsonb_build_object('kind', 'text', 'text', 'All of it is done.'))));
  perform pg_temp.chk('REVIEW', 'V7 dragging a parent to Done with close-children waits In review; the child stays open',
    pg_temp.st('CP') || '|' || pg_temp.st('CPS') || '|' || (select review_close_children::text from public.ops_work_cards where id = pg_temp.id('CP')),
    'doing/In review|todo/To do|true');
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('CP'), pg_temp.rev('CP')));
  perform pg_temp.chk('REVIEW', 'V7 the watcher''s confirm closes the parent and its child', pg_temp.st('CP') || '|' || pg_temp.st('CPS'), 'done/Done|done/Done');

  -- V8. Undo of the owner's Mark done, and of the watcher's own close.
  v := pg_temp.add('RU', 'ADV4398 Undo the ask', 'tao', 'seth');
  v := pg_temp.close_as('tao', 'RU');
  v := pg_temp.person('tao', format('select public.ops_work_undo(%L)::text', ((v::jsonb)->>'event_id')::uuid));
  perform pg_temp.chk('REVIEW', 'V8 the owner''s Undo of Mark done puts the card back and withdraws the ask',
    pg_temp.st('RU') || '/' || (select (review_requested_at is null and review_kind is null)::text from public.ops_work_cards where id = pg_temp.id('RU')), 'todo/To do/true');
  v := pg_temp.close_as('seth', 'RU');
  perform pg_temp.chk('REVIEW', 'V8 the watcher''s own close is Done', pg_temp.st('RU'), 'done/Done');
  v := pg_temp.person('seth', format('select public.ops_work_undo(%L)::text', ((v::jsonb)->>'event_id')::uuid));
  perform pg_temp.chk('REVIEW', 'V8 the watcher''s Undo of their own close reopens it, unconfirmed',
    pg_temp.st('RU') || '/' || (select coalesce(confirmed_by, '-') from public.ops_work_cards where id = pg_temp.id('RU')), 'todo/To do/-');

  -- V9. Push back and Mark sent go through review too.
  v := pg_temp.add('PB', 'ADV4398 Push back', 'tao', 'seth');
  v := pg_temp.person('tao', format('select public.ops_work_push_back(%L, %L, %L, %L::jsonb, %s)::text', pg_temp.id('PB'), 'declined',
         'The host cancelled the event, so this is not needed.', '[]', pg_temp.rev('PB')));
  perform pg_temp.chk('REVIEW', 'V9 the owner''s push back waits In review', pg_temp.st('PB'), 'doing/In review');
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('PB'), pg_temp.rev('PB')));
  perform pg_temp.chk('REVIEW', 'V9 confirmed, it closes as not needed, closed by the owner',
    (select status || '/' || close_kind || '/' || closed_by || '/' || confirmed_by from public.ops_work_cards where id = pg_temp.id('PB')),
    'done/declined/' || pg_temp.email('tao') || '/' || pg_temp.email('seth'));
  v := pg_temp.add('MS', 'ADV4398 Mark sent', 'tao', 'seth');
  v := pg_temp.person('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('MS'), '{"person_reason":"send"}', pg_temp.rev('MS')));
  v := pg_temp.person('tao', format('select public.ops_work_person_action(%L, %L, null, %s)::text', pg_temp.id('MS'), 'mark_sent', pg_temp.rev('MS')));
  perform pg_temp.chk('REVIEW', 'V9 the owner''s Mark sent waits In review', pg_temp.st('MS'), 'doing/In review');
  -- V10. The watcher's drag to Done is the confirm.
  v := pg_temp.person('seth', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('MS'), v_done, pg_temp.rev('MS')));
  perform pg_temp.chk('REVIEW', 'V10 the watcher dragging it to Done confirms it',
    (select status || '/' || closed_by || '/' || confirmed_by from public.ops_work_cards where id = pg_temp.id('MS')),
    'done/' || pg_temp.email('tao') || '/' || pg_temp.email('seth'));
end;
$t$;

-- ───────────────────────────── BOT ─────────────────────────────
do $t$
declare v jsonb; v_old uuid; v_n integer; v_rel uuid;
begin
  update public.ops_settings set value = to_jsonb(now() - interval '10 days') where key = 'follow_through_since';
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, merged_by_login, issues, deploy_marker, deploy, problems, feature_guide)
  values (884398, 'ADV4398 failed deploy and no issue', 'https://github.com/Mingla-LLC/mingla-main/pull/884398', now() - interval '3 hours',
          repeat('d', 40), 'nobody', '[]', false, '{"web":{"mingla-admin":"failed"}}', '{no_issue,web_deploy_failed}', '{}');
  perform public.ops_engineering_cards_sync();
  perform pg_temp.chk('BOT', 'B1 a failed deploy keeps its own card under its route, beside the one release card',
    (select string_agg(split_part(auto_key, ':', 1) || '@' || case parent_id when pg_temp.id('DF') then 'DF' when pg_temp.id('G') then 'G' else '?' end, ',' order by auto_key)
       from public.ops_work_cards where auto_key like '%:pr-884398%' and status <> 'done'),
    'eng_deploy_failed@DF,eng_release@G');
  select count(*) into v_n from public.team_mentions m join public.ops_work_events e on e.id = m.source_id
   join public.ops_work_cards w on w.id = e.card_id where w.auto_key like '%:pr-884398%';
  perform public.ops_engineering_cards_sync();
  perform public.ops_engineering_cards_sync();
  perform pg_temp.chk('BOT', 'B2 two more sync runs: still one release card and one deploy card, no new notices',
    (select count(*)::text from public.ops_work_cards where auto_key in ('eng_release:pr-884398', 'eng_deploy_failed:pr-884398:mingla-admin')) || '/' ||
    ((select count(*) from public.team_mentions m join public.ops_work_events e on e.id = m.source_id
       join public.ops_work_cards w on w.id = e.card_id where w.auto_key like '%:pr-884398%') = v_n)::text, '2/true');
  perform pg_temp.chk('BOT', 'B2 the bot adds never pushed or emailed',
    (select count(*)::text from public.notification_outbox o where o.payload->>'card_id' in
       (select id::text from public.ops_work_cards where auto_key like '%:pr-884398%')), '0');

  -- B3. Old per-kind card, and the release card cannot be made: never lost.
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, merged_by_login, issues, deploy_marker, deploy, problems, feature_guide)
  values (884399, 'ADV4398 live check missing', 'https://github.com/Mingla-LLC/mingla-main/pull/884399', now() - interval '3 days',
          repeat('e', 40), 'nobody', '[{"number": 4398}]', true, '{"web":{}}', '{live_check_missing}', '{}');
  v := public.ops_auto_card_upsert('eng_live_check:pr-884399', jsonb_build_object('title', 'ADV4398 Do the live check of PR #884399',
    'instructions', 'The old kind of card, made before #4398.', 'done_means', 'The live check is posted.', 'due_on', current_date + 1), 'task', null);
  v_old := (v->>'id')::uuid;
  perform pg_temp.chk('BOT', 'B3 setup: the old per-kind card is open', (select status from public.ops_work_cards where id = v_old), 'todo');
  perform pg_temp.routes('{}'::jsonb, null);
  perform public.ops_engineering_cards_sync();
  perform pg_temp.chk('BOT', 'B3 nowhere to put the release card: the old card stays open (not lost) and the alarm says so',
    (select status from public.ops_work_cards where id = v_old) || '/' ||
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_release:pr-884399') || '/' ||
    (select count(*)::text from public.ops_work_cards where auto_key = 'route_missing:eng_release' and status <> 'done'), 'todo/0/1');
  perform pg_temp.routes(jsonb_build_object('eng_release', pg_temp.id('G'), 'eng_deploy_failed', pg_temp.id('DF')), pg_temp.id('F')::text);
  perform public.ops_engineering_cards_sync();
  select id into v_rel from public.ops_work_cards where auto_key = 'eng_release:pr-884399' and status <> 'done';
  perform pg_temp.lk('BOT', 'B3 with a route back, it folds into the release card as a system close that names it',
    (select status || ':' || close_kind || ':' || close_reason from public.ops_work_cards where id = v_old),
    'done:system:Folded into Card ' || (select number from public.ops_work_cards where id = v_rel) || '%');
  perform pg_temp.chk('BOT', 'B3 the release card carries the live check item, open',
    (select string_agg(i->>'key', ',') from jsonb_array_elements(public.ops_release_items(884399)) i where not (i->>'done')::boolean), 'live_check');
  update public.ops_release_records set problems = '{}', complete = true where pr = 884399;
  perform public.ops_engineering_cards_sync();
  perform pg_temp.chk('BOT', 'B3 the live check posted: the release card closes itself, no review',
    (select status || ':' || close_kind || ':' || coalesce(confirmed_by, '-') from public.ops_work_cards where id = v_rel), 'done:system:-');

  -- B4. No function in the database still makes a guide_live card.
  perform pg_temp.chk('BOT', 'B4 no function body makes a guide_live card',
    (select coalesce(string_agg(p.proname, ','), 'none') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ 'ops_auto_card_upsert\([^;]*guide_live'), 'none');
end;
$t$;

do $t$
declare v jsonb; v_old uuid;
begin
  -- B5. A legacy per-commit coverage card folds into the standing card.
  perform pg_temp.routes(jsonb_build_object('feature_guide_gap', pg_temp.id('G')), pg_temp.id('F')::text);
  update public.ops_work_cards set status = 'done', close_kind = 'system', closed_at = now(), closed_by = 'system@usemingla.com', closed_via = 'system'
   where auto_key like 'feature\_guide\_gap:%' and status <> 'done';
  v := public.ops_auto_card_upsert('feature_guide_gap:sha-abc1234', jsonb_build_object('title', 'ADV4398 Feature Guide coverage stopped at abc1234',
    'instructions', 'The old per-commit coverage card.', 'done_means', 'Coverage is current.', 'due_on', current_date + 1), 'task', null);
  v_old := (v->>'id')::uuid;
  update public.ops_feature_guide_coverage set audited_through_sha = repeat('4', 40), observed_head_sha = repeat('5', 40), state = 'pending',
         blocked_sha = null, blocked_pr = null, blocked_reason = null where singleton;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.ops_feature_guide_coverage_reconcile();
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.lk('BOT', 'B5 the legacy sha card folds into the standing card (system close)',
    (select status || ':' || close_kind || ':' || close_reason from public.ops_work_cards where id = v_old), 'done:system:Folded into Card %');
  perform pg_temp.chk('BOT', 'B5 exactly one open coverage card, the standing one',
    (select count(*)::text || '/' || max(auto_key) from public.ops_work_cards where auto_key like 'feature\_guide\_gap:%' and status <> 'done'),
    '1/feature_guide_gap:current');
end;
$t$;

-- ───────────────────────────── NOTICE ─────────────────────────────
do $t$
declare v text; v_id uuid; v_ev uuid; v_m1 uuid; v_m2 uuid;
begin
  delete from public.notification_outbox where user_id in (select id from tx_people);
  perform pg_temp.routes(jsonb_build_object('ask', pg_temp.id('K')), pg_temp.id('F')::text);
  -- N1. A bot close.
  v_id := (pg_temp.auto('ask:adv4398-notice', 'ADV4398 Ask another host')->>'id')::uuid;
  perform public.ops_auto_card_close(v_id, 'The host answered.', '[]'::jsonb);
  select id into v_ev from public.ops_work_events where card_id = v_id and action = 'auto_closed';
  perform pg_temp.chk('NOTICE', 'N1 a bot close is Admin-only for owner and watcher', pg_temp.notices(v_ev), 'abi:bot:false,kun:bot:false');
  perform pg_temp.chk('NOTICE', 'N1 and nothing reaches the outbox', (select count(*)::text from public.notification_outbox where payload->>'card_id' = v_id::text), '0');
  -- N2. The owner's agent moves a card: the watcher hears, never the owner.
  v := pg_temp.add('NM', 'ADV4398 Notice card', 'tao', 'abi');
  v := pg_temp.agent('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('NM'), '{"status":"doing"}', pg_temp.rev('NM')));
  perform pg_temp.chk('NOTICE', 'N2 the owner''s agent moving a card pushes to the watcher only', pg_temp.notices(((v::jsonb)->>'event_id')::uuid), 'abi:status:true');
  -- N4. A due-date change is Admin-only.
  v := pg_temp.person('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('NM'),
         jsonb_build_object('due_on', (now() at time zone 'UTC')::date + 9), pg_temp.rev('NM')));
  perform pg_temp.lk('NOTICE', 'N4 a due-date change is an Admin-only notice', pg_temp.notices(((v::jsonb)->>'event_id')::uuid), 'abi:edit:false');
  -- N3. The watcher closes; the owner reopens; the watcher hears the reopen.
  v := pg_temp.close_as('abi', 'NM');
  perform pg_temp.chk('NOTICE', 'N3 the watcher''s own close pushes to the owner only', pg_temp.notices(((v::jsonb)->>'event_id')::uuid), 'tao:status:true');
  v := pg_temp.person('tao', format('select public.ops_work_reopen(%L, %L, %s)::text', pg_temp.id('NM'), 'One more thing to do.', pg_temp.rev('NM')));
  perform pg_temp.chk('NOTICE', 'N3 the owner''s reopen pushes to the watcher only', pg_temp.notices(((v::jsonb)->>'event_id')::uuid), 'abi:status:true');
  -- N5. The one table, called directly.
  perform pg_temp.chk('NOTICE', 'N5 the one table', concat_ws(',',
      public.ops_notify_push('mention', 'tao@x'), public.ops_notify_push('review', 'tao@x'), public.ops_notify_push('sent_back', 'tao@x'),
      public.ops_notify_push('status', 'tao@x'), public.ops_notify_push('assigned', 'tao@x'), public.ops_notify_push('bot', 'tao@x'),
      public.ops_notify_push('guide', 'tao@x'), public.ops_notify_push('edit', 'tao@x'), public.ops_notify_push('alert', 'tao@x'),
      public.ops_notify_push('status', ' SYSTEM@usemingla.com ')),
    't,t,t,t,t,f,f,f,f,f');
  insert into public.ops_work_events (card_id, actor_email, via, action, body, to_revision) values (pg_temp.id('NM'), 'system@usemingla.com', 'system', 'note', 'x', 1) returning id into v_ev;
  perform public.ops_notify_people(pg_temp.id('NM'), v_ev, array[pg_temp.email('tao')], 'system@usemingla.com', 'Mingla moved it.', 'status');
  perform pg_temp.chk('NOTICE', 'N5 a status notice from the system actor never pushes', pg_temp.notices(v_ev), 'tao:status:false');
  insert into public.ops_work_events (card_id, actor_email, via, action, body, to_revision) values (pg_temp.id('NM'), pg_temp.email('kun'), null, 'note', 'x', 1) returning id into v_ev;
  perform public.ops_notify_people(pg_temp.id('NM'), v_ev, array[pg_temp.email('tao'), pg_temp.email('kun')], pg_temp.email('kun'), 'Something.', 'made_up_kind');
  perform pg_temp.chk('NOTICE', 'N5 an unknown kind falls to Admin-only edit, and the actor is never told', pg_temp.notices(v_ev), 'tao:edit:false');
  -- N6. The Host app's Mark all read never touches Admin-only rows.
  select id into v_m1 from public.team_mentions where target_user_id = pg_temp.uid('abi') and push and read_at is null limit 1;
  select id into v_m2 from public.team_mentions where target_user_id = pg_temp.uid('abi') and not push and read_at is null limit 1;
  perform pg_temp.chk('NOTICE', 'N6 setup: abi has an unread push row and an unread Admin-only row', (v_m1 is not null and v_m2 is not null)::text, 'true');
  v := pg_temp.person('abi', $q$select public.team_inbox_mark_read('all', null)::text$q$);
  perform pg_temp.chk('NOTICE', 'N6 team_inbox_mark_read reads the push row and leaves the Admin-only row unread',
    (select (read_at is not null)::text from public.team_mentions where id = v_m1) || '/' || (select (read_at is null)::text from public.team_mentions where id = v_m2), 'true/true');
end;
$t$;

-- ───────────────────────── COMMIT AS A SIGNED-IN PERSON ─────────────────────────
-- Admin and the Host app call these functions through PostgREST, whose whole
-- transaction (COMMIT included) runs as role authenticated. The deferred
-- invariant fires at COMMIT, outside the SECURITY DEFINER function.
do $t$
declare v text;
begin
  v := pg_temp.add('CA', 'ADV4398 Commit as a person', 'tao', 'seth');
  perform pg_temp.chk('AUTH', 'A1 a signed-in owner adds a card and the request commits (PostgREST role)',
    pg_temp.commit_as('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(jsonb_build_object(
      'title', 'ADV4398 Added by a signed-in person', 'instructions', 'Do the work carefully and say what changed.', 'done_means', 'It is done.',
      'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth')),
      'due_on', (now() at time zone 'UTC')::date + 3)), pg_temp.rk())), 'OK');
  perform pg_temp.chk('AUTH', 'A2 a signed-in owner starts a card and the request commits (PostgREST role)',
    pg_temp.commit_as('tao', format('select public.ops_work_start(%L, %s)::text', pg_temp.id('CA'), pg_temp.rev('CA'))), 'OK');
end;
$t$;

-- ───────────────────────── UNDO OF A CONFIRM THAT CLOSED SUBTASKS ─────────────────────────
-- (retest 2) Undo of a Confirm reopens the subtasks it closed (child and
-- grandchild), refuses the whole undo if a subtask changed since, refuses a
-- non-watcher and the 61st second, and the people invariant holds at commit
-- for the signed-in role.
do $t$
declare v text; v_ev text; v_c_col uuid; v_late text; v_done uuid := public.ops_status_default('done');
begin
  v := pg_temp.add('UP', 'ADV4398 Undo parent', 'tao', 'seth');
  v := pg_temp.add('UC', 'ADV4398 Undo child', 'kun', 'tao', 'UP');
  v := pg_temp.add('UG', 'ADV4398 Undo grandchild', 'ola', 'kun', 'UC');
  v := pg_temp.person('kun', format('select public.ops_work_start(%L, %s)::text', pg_temp.id('UC'), pg_temp.rev('UC')));
  v_c_col := (select status_id from public.ops_work_cards where id = pg_temp.id('UC'));
  v := pg_temp.person('tao', format('select public.ops_work_move(%L, %L, %s, %L::jsonb, null, true)::text', pg_temp.id('UP'), v_done,
         pg_temp.rev('UP'), '[{"kind":"text","text":"All of it is done."}]'));
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('UP'), pg_temp.rev('UP')));
  v_ev := (v::jsonb)->>'event_id';
  perform pg_temp.chk('UNDO', 'U0 setup: the confirm closed parent, child and grandchild',
    pg_temp.st('UP') || '|' || pg_temp.st('UC') || '|' || pg_temp.st('UG'), 'done/Done|done/Done|done/Done');
  -- U1. Non-watchers are refused.
  v := pg_temp.person('tao', format('select public.ops_work_undo(%L)::text', v_ev));
  perform pg_temp.lk('UNDO', 'U1 the owner cannot undo the watcher''s confirm', v, 'ERR:22023:undo_expired:%');
  v := pg_temp.person('abi', format('select public.ops_work_undo(%L)::text', v_ev));
  perform pg_temp.lk('UNDO', 'U1 an admin who is not the watcher cannot undo it', v, 'ERR:22023:undo_expired:%');
  -- U2. Past 60 seconds: refused (tried in a subtransaction, then put back).
  begin
    update public.ops_work_events set at = at - interval '61 seconds' where id = v_ev::uuid;
    v_late := pg_temp.person('seth', format('select public.ops_work_undo(%L)::text', v_ev));
    raise exception 'put_back' using errcode = 'P0001';
  exception when others then
    if sqlerrm <> 'put_back' then raise; end if;
  end;
  perform pg_temp.lk('UNDO', 'U2 after 60 seconds the undo is refused', v_late, 'ERR:22023:undo_expired:%');
  perform pg_temp.chk('UNDO', 'U2 and nothing moved', pg_temp.st('UP') || '|' || pg_temp.st('UC') || '|' || pg_temp.st('UG'), 'done/Done|done/Done|done/Done');
  -- U3. The undo, committed as the signed-in watcher: the deferred people check passes in that role.
  perform pg_temp.chk('UNDO', 'U3 the undo commits as the signed-in watcher (people invariant at COMMIT)',
    pg_temp.commit_as('seth', format('select public.ops_work_undo(%L)::text', v_ev)), 'OK');
  v := pg_temp.person('seth', format('select public.ops_work_undo(%L)::text', v_ev));
  perform pg_temp.chk('UNDO', 'U3 parent back In review, child back In progress in its own column, grandchild back To do',
    pg_temp.st('UP') || '|' || (select status || '/' || (status_id = v_c_col)::text from public.ops_work_cards where id = pg_temp.id('UC')) || '|' || pg_temp.st('UG'),
    'doing/In review|doing/true|todo/To do');
  perform pg_temp.chk('UNDO', 'U3 every reopened card has exactly 1 owner and 1 watcher, unchanged',
    pg_temp.people(pg_temp.id('UP')) || '|' || pg_temp.people(pg_temp.id('UC')) || '|' || pg_temp.people(pg_temp.id('UG')),
    'tao:owner,seth:watcher|kun:owner,tao:watcher|ola:owner,kun:watcher');
  -- U4. Confirm again, then change a subtask in the meantime: the undo is refused whole (atomic).
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('UP'), pg_temp.rev('UP')));
  v_ev := (v::jsonb)->>'event_id';
  perform pg_temp.chk('UNDO', 'U4 setup: confirmed again, all three Done', pg_temp.st('UP') || '|' || pg_temp.st('UC') || '|' || pg_temp.st('UG'),
    'done/Done|done/Done|done/Done');
  update public.ops_work_cards set result = 'Changed by someone after the confirm.', revision = revision + 1 where id = pg_temp.id('UG');
  v := pg_temp.person('seth', format('select public.ops_work_undo(%L)::text', v_ev));
  perform pg_temp.lk('UNDO', 'U4 a subtask changed since the confirm: the undo is refused', v, 'ERR:22023:undo_expired:%');
  perform pg_temp.chk('UNDO', 'U4 refused whole: parent, child and grandchild all still Done (no half undo)',
    pg_temp.st('UP') || '|' || pg_temp.st('UC') || '|' || pg_temp.st('UG'), 'done/Done|done/Done|done/Done');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 70 then raise exception '#4398 tester recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4398 tester: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4398 tester adversarial: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
