-- Issue #4398 (Work board v3) -- implementor suite for
-- 20280626004398_issue_4398_routes_and_people.sql,
-- 20280626014398_issue_4398_review_and_notices.sql and
-- 20280626034398_issue_4398_people_invariant.sql, on the fully replayed PG17
-- schema. Everything is rolled back.
--
--   ROUTE    every routed kind lands under its route with exactly the route
--            card's owner and watcher, whatever the maker passed; a closed
--            route card walks up to its main task, a closed main task to the
--            fallback; nowhere to go makes ONE top-level route_missing card;
--            the same auto_key twice is one card; a plan two levels down is
--            refused with a fix; an unrouted kind lands on the fallback and
--            never errors; ari_gap_digest lands on its own main task; a route
--            card that has subtasks takes the card beside them; the route
--            setting refuses a card two levels down.
--   PEOPLE   0 or 2 owners, 0 or 2 watchers, deleting the only watcher and
--            reopening a closed card with no watcher are each refused 23514
--            at commit (SET CONSTRAINTS ... IMMEDIATE stands in for the
--            commit); swapping owner and watcher in one transaction is
--            allowed; a closed card with nobody is allowed; the add and update
--            fixes; plan steps and subtasks get one owner and one watcher and
--            existing steps keep theirs.
--   REVIEW   an owner's close goes to In review, not Done; only the watcher
--            confirms (the owner and an agent are refused); Send back needs a
--            reason and returns the card to In progress with the reason in
--            the thread; the watcher's own close is Done; a system close is
--            Done; a direct UPDATE to done is refused; an agent's close_work
--            says it went to review; a parent with open subtasks is refused
--            at Mark done; the watcher cannot drag a card out of review.
--   NOTICE   bot add: Admin-only, no email, no push; a person's status change
--            tells the owner and watcher, never the person; a mention, a card
--            given to you, a review ask and a send back push; an edit is
--            Admin-only; team_inbox carries push rows only; team_activity
--            groups the rest per kind per day.
--   RELEASE  one PR with three missing items is ONE card whose checklist is
--            read live from the record, ticks item by item, and closes itself
--            when nothing is left; an open old per-kind card folds into it;
--            the Feature Guide coverage card is one standing card updated in
--            place; guide_live makes no card.
--
-- FAILS-ON-REVERT: every block fails on origin/main (eb1f1c058c): the routes
-- setting, ops_work_confirm / ops_work_send_back, the review column, the
-- invariant trigger, the six-argument ops_notify_people, team_activity and
-- ops_release_items do not exist there, and ops_auto_card_upsert writes no
-- parent there (ROUTE 1 reads parent_id IS NULL).
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '43980000-0000-4000-a000-000000000001', 'seth.v34398@test.local'),
  ('tao',  '43980000-0000-4000-a000-000000000002', 'tao.v34398@test.local'),
  ('abi',  '43980000-0000-4000-a000-000000000003', 'abi.v34398@test.local'),
  ('kun',  '43980000-0000-4000-a000-000000000004', 'kun.v34398@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('seth.v34398@test.local', 'owner', 'active', now()), ('abi.v34398@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who in ('tao', 'kun');

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
    -- #4398 (P0 retest): fire the deferred people check here, still as role authenticated, the way
    -- PostgREST commits a request (Admin and the Host app); a refusal rolls this call back.
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards immediate;
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
    reset role;
    return v_out;
  exception when others then
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
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
-- Runs p_sql, then fires the deferred invariant as a commit would; a
-- refusal is rolled back with the subtransaction.
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
create function pg_temp.rk() returns text language sql as $fn$ select 'v3-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.people(p_id uuid) returns text
language sql as $fn$
  select coalesce((select string_agg(t.who || ':' || p.role, ',' order by p.role, t.who) from public.ops_work_people p
                     join tx_people t on t.email = p.email where p.card_id = p_id), '<none>')
$fn$;
-- The watcher's review ask for a card in team_inbox: decision/needs_you/read.
create function pg_temp.ask_state(p_who text, p_k text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.person(p_who, 'select public.team_inbox()::text');
  return (select string_agg(coalesce(m->>'decision', '-') || '/' || coalesce(m->>'needs_you', '-'), ',')
            from jsonb_array_elements((v::jsonb)->'mentions') m
           where m->>'card_id' = pg_temp.id(p_k)::text and m->>'event_kind' = 'review');
end;
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
    'owners', jsonb_build_array('abi.v34398@test.local', 'kun.v34398@test.local'), 'watchers', '[]'::jsonb,
    'due_on', (now() at time zone 'UTC')::date + 1) || p_extra, 'task', null)
$fn$;
create function pg_temp.sysclose(p_k text) returns void
language sql as $fn$
  update public.ops_work_cards set status = 'done', close_kind = 'system', close_reason = 'Closed for the test.', closed_at = now(),
         closed_by = 'system@usemingla.com', closed_via = 'system', revision = revision + 1
   where id = pg_temp.id(p_k)
$fn$;

-- ───────────────────────────── the main tasks ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.add('M',  'V34398 Release hygiene main task', 'tao', 'seth');
  v := pg_temp.add('G',  'V34398 Finish release records group', 'tao', 'seth', 'M');
  v := pg_temp.add('G2', 'V34398 A card two levels down', 'tao', 'seth', 'G');
  v := pg_temp.add('K',  'V34398 Get first event details main task', 'kun', 'abi');
  v := pg_temp.add('H',  'V34398 Host launches main task', 'abi', 'seth');
  v := pg_temp.add('HC', 'V34398 Salsa launch with its own subtasks', 'seth', 'abi', 'H');
  v := pg_temp.add('HCS','V34398 Salsa make-good subtask', 'seth', 'abi', 'HC');
  v := pg_temp.add('F',  'V34398 Fallback main task', 'tao', 'seth');
  v := pg_temp.add('A',  'V34398 Ari quality and gaps main task', 'seth', 'tao');
  perform pg_temp.chk('SETUP', 'nine cards on the board',
    (select count(*)::text from tx_ids), '9');
  perform pg_temp.chk('SETUP', 'G sits under M, G2 two levels down',
    (select string_agg(depth::text, ',' order by number) from public.ops_work_cards where id in (pg_temp.id('M'), pg_temp.id('G'), pg_temp.id('G2'))), '0,1,2');
  update public.ops_settings set value = jsonb_build_object(
      'routes', jsonb_build_object('eng_release', pg_temp.id('G'), 'ask', pg_temp.id('K'), 'golive', pg_temp.id('HC'),
                                   'ari_gap_digest', pg_temp.id('A'), 'eng_deploy_failed', pg_temp.id('G')),
      'fallback', pg_temp.id('F'))
   where key = 'auto_card_routes';
  perform pg_temp.chk('SETUP', 'the routes setting exists and holds the routes',
    (select (value->'routes'->>'eng_release')::uuid = pg_temp.id('G') from public.ops_settings where key = 'auto_card_routes')::text, 'true');
end;
$t$;

-- ───────────────────────────── ROUTE ─────────────────────────────
do $t$
declare v jsonb; v_id uuid; v_n integer;
begin
  -- 1. The maker passed two owners and no watcher: the card takes the route's people.
  v := pg_temp.auto('eng_release:pr-904398', 'V34398 Finish the release of PR #904398');
  perform pg_temp.chk('ROUTE', 'a routed card is added', v->>'status', 'added');
  v_id := (v->>'id')::uuid; perform pg_temp.keep('R1', v_id);
  perform pg_temp.chk('ROUTE', 'it sits under its route card', ((select parent_id from public.ops_work_cards where id = v_id) = pg_temp.id('G'))::text, 'true');
  perform pg_temp.chk('ROUTE', 'with exactly the route card''s owner and watcher, not the maker''s three', pg_temp.people(v_id), 'tao:owner,seth:watcher');
  v := pg_temp.auto('ask:v34398-host', 'V34398 Ask a host for their first event');
  perform pg_temp.chk('ROUTE', 'another kind takes its own route''s people', pg_temp.people((v->>'id')::uuid), 'kun:owner,abi:watcher');
  -- 2. The same auto_key twice is one card, whatever its parent.
  v := pg_temp.auto('eng_release:pr-904398', 'V34398 Finish the release of PR #904398');
  perform pg_temp.chk('ROUTE', 'the same auto_key again keeps the open card', v->>'status' || '/' || ((v->>'id')::uuid = v_id)::text, 'kept/true');
  -- 3. A route card with its own subtasks takes the new card beside them.
  v := pg_temp.auto('golive:event:v34398', 'V34398 Get the Salsa event live');
  perform pg_temp.chk('ROUTE', 'a route card that has subtasks takes the card beside them',
    v->>'status' || '/' || ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('HC'))::text, 'added/true');
  perform pg_temp.chk('ROUTE', 'two levels down, with HC''s people', pg_temp.people((v->>'id')::uuid)
    || '/' || (select depth::text from public.ops_work_cards where id = (v->>'id')::uuid), 'seth:owner,abi:watcher/2');
  -- 4. A plan under a card two levels down is refused with a fix, never made.
  v := pg_temp.auto('eng_deploy_failed:pr-904398:edge', 'V34398 Fix the failed deploy',
    jsonb_build_object('plan', jsonb_build_array(jsonb_build_object('n', 1, 'text', 'Read the run', 'tool', 'person'))));
  perform pg_temp.chk('ROUTE', 'a plan two levels down is refused', v->>'status', 'refused');
  perform pg_temp.lk('ROUTE', 'with the too_deep fix', v->'fixes'->0->>'message', 'too_deep:%');
  perform pg_temp.chk('ROUTE', 'and nothing was made', (select count(*)::text from public.ops_work_cards where auto_key = 'eng_deploy_failed:pr-904398:edge'), '0');
  -- 5. An unrouted kind lands on the fallback with its people, and does not error.
  v := pg_temp.auto('zzz_made_up_digest:2026-11-16', 'V34398 A kind nobody routed');
  perform pg_temp.chk('ROUTE', 'an unrouted kind lands on the fallback',
    v->>'status' || '/' || ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('F'))::text, 'added/true');
  perform pg_temp.chk('ROUTE', 'with the fallback''s people', pg_temp.people((v->>'id')::uuid), 'tao:owner,seth:watcher');
  -- 6. ari_gap_digest (#3355) lands on its main task.
  v := pg_temp.auto('ari_gap_digest:2026-11-16', 'V34398 Ari gaps this week');
  perform pg_temp.chk('ROUTE', 'ari_gap_digest lands on the Ari main task with its people',
    ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('A'))::text || '/' || pg_temp.people((v->>'id')::uuid),
    'true/seth:owner,tao:watcher');
  -- 7. The route card closed: the card lands on its main task.
  perform pg_temp.sysclose('R1');
  perform pg_temp.sysclose('G');
  v := pg_temp.auto('eng_release:pr-904399', 'V34398 Finish the release of PR #904399');
  perform pg_temp.chk('ROUTE', 'route card closed: it lands on the main task',
    ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('M'))::text, 'true');
  -- 8. The main task closed too: the fallback.
  perform pg_temp.sysclose('M');
  v := pg_temp.auto('eng_release:pr-904400', 'V34398 Finish the release of PR #904400');
  perform pg_temp.chk('ROUTE', 'main task closed: it lands on the fallback',
    ((select parent_id from public.ops_work_cards where id = (v->>'id')::uuid) = pg_temp.id('F'))::text, 'true');
  -- 9. Everything closed: one top-level alarm, never this card at the top level.
  perform pg_temp.sysclose('F');
  v := pg_temp.auto('eng_release:pr-904401', 'V34398 Finish the release of PR #904401');
  perform pg_temp.chk('ROUTE', 'nowhere to go: refused', v->>'status', 'refused');
  perform pg_temp.chk('ROUTE', 'and the card was not made at the top level',
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_release:pr-904401'), '0');
  perform pg_temp.chk('ROUTE', 'one route_missing card, top level',
    (select count(*)::text || '/' || max(depth)::text from public.ops_work_cards where auto_key = 'route_missing:eng_release' and status <> 'done'), '1/0');
  perform pg_temp.chk('ROUTE', 'it has one owner (the board owner) and one other watcher',
    (select (cardinality(public.ops_card_people(id, 'owner')) = 1 and cardinality(public.ops_card_people(id, 'watcher')) = 1
             and (public.ops_card_people(id, 'owner'))[1] = public.ops_owner_email())::text
       from public.ops_work_cards where auto_key = 'route_missing:eng_release' and status <> 'done'), 'true');
  perform pg_temp.lk('ROUTE', 'it names the card that could not be filed',
    (select instructions from public.ops_work_cards where auto_key = 'route_missing:eng_release' and status <> 'done'), '%eng_release:pr-904401%');
  perform pg_temp.chk('ROUTE', 'a stopped log line says so',
    (select (count(*) >= 1)::text from public.ops_agent_log where action = 'card_refused' and outcome = 'stopped' and detail->>'route_missing' = 'eng_release'), 'true');
  v := pg_temp.auto('eng_release:pr-904402', 'V34398 Finish the release of PR #904402');
  perform pg_temp.chk('ROUTE', 'a second run makes no second alarm',
    (select count(*)::text from public.ops_work_cards where auto_key = 'route_missing:eng_release'), '1');
  perform pg_temp.chk('ROUTE', 'no bot card of this suite is at the top level except the alarm',
    (select count(*)::text from public.ops_work_cards where auto_key is not null and parent_id is null and created_at = now()
        and auto_key not like 'route\_missing:%'), '0');
end;
$t$;

-- The route setting is the owner's or an admin's, and refuses a card two levels down.
do $t$
declare v text;
begin
  v := pg_temp.person('seth', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('G2')), 'fallback', null)));
  perform pg_temp.lk('ROUTE', 'a route to a card two levels down is refused', v, 'ERR:22023:invalid_setting:%');
  v := pg_temp.person('tao', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K')), 'fallback', null)));
  perform pg_temp.lk('ROUTE', 'a teammate who is not owner or admin cannot change routes', v, 'ERR:42501:%');
  v := pg_temp.person('abi', format('select public.ops_setting_set(%L, %L::jsonb)::text', 'auto_card_routes',
         jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('K'), 'golive', pg_temp.id('H')), 'fallback', pg_temp.id('K'))));
  perform pg_temp.chk('ROUTE', 'an admin can, and Settings shows the route open with its people',
    (select r->>'state' || '/' || (r->'card'->>'owner') from jsonb_array_elements((v::jsonb)->'settings'->'auto_card_routes'->'routes') r where r->>'kind' = 'ask'),
    'open/' || public.ops_name(pg_temp.email('kun')));
  perform pg_temp.chk('ROUTE', 'the change is in the log',
    (select (count(*) >= 1)::text from public.ops_agent_log where action = 'setting_changed' and detail->>'key' = 'auto_card_routes'), 'true');
end;
$t$;

-- ───────────────────────────── PEOPLE ─────────────────────────────
do $t$
declare v text; v_id uuid;
begin
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(jsonb_build_object(
    'title', 'V34398 Two owners', 'instructions', 'Do the work carefully and say what changed.', 'done_means', 'It is done.',
    'owners', jsonb_build_array(pg_temp.email('tao'), pg_temp.email('kun')), 'watchers', jsonb_build_array(pg_temp.email('seth')),
    'due_on', (now() at time zone 'UTC')::date + 3)), pg_temp.rk()));
  perform pg_temp.chk('PEOPLE', 'two owners are refused with the fix', (v::jsonb)->'results'->0->'fixes'->0->>'message', 'A card has one owner. Pick one person.');
  v := pg_temp.add('NW', 'V34398 No watcher', 'tao', null);
  perform pg_temp.chk('PEOPLE', 'no watcher is refused with the fix',
    (select f->>'message' from jsonb_array_elements((v::jsonb)->'results'->0->'fixes') f where f->>'field' = 'watchers'), 'A card has one watcher, who is not the owner.');
  v := pg_temp.add('SW', 'V34398 Owner as watcher', 'tao', 'tao');
  perform pg_temp.chk('PEOPLE', 'the owner as watcher is refused', (v::jsonb)->'results'->0->>'status', 'refused');
  v := pg_temp.add('P', 'V34398 People card', 'tao', 'seth');
  perform pg_temp.chk('PEOPLE', 'control: one owner and one watcher is added', (v::jsonb)->'results'->0->>'status', 'added');
  v := pg_temp.person('seth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('P'),
         jsonb_build_object('owners', jsonb_build_array(pg_temp.email('tao'), pg_temp.email('kun'))), pg_temp.rev('P')));
  perform pg_temp.lk('PEOPLE', 'an update that leaves two owners is refused', v, 'ERR:22023:invalid_card: A card has one owner. Pick one person.%');
  v := pg_temp.person('seth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('P'),
         jsonb_build_object('watchers', '[]'::jsonb), pg_temp.rev('P')));
  perform pg_temp.lk('PEOPLE', 'an update that leaves no watcher is refused', v, 'ERR:22023:invalid_card: A card has one watcher, who is not the owner.%');

  -- The invariant at commit, whoever writes.
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  values ('V34398 Raw card', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'system@usemingla.com', 'system@usemingla.com') returning id into v_id;
  perform pg_temp.keep('RAW', v_id);
  perform pg_temp.lk('PEOPLE', 'an open card with no people is refused at commit',
    pg_temp.commit_check('select 1'), 'ERR:23514:card_people:%');
  insert into public.ops_work_people (card_id, email, role, added_by) values
    (v_id, pg_temp.email('tao'), 'owner', 'system@usemingla.com'), (v_id, pg_temp.email('kun'), 'owner', 'system@usemingla.com'),
    (v_id, pg_temp.email('seth'), 'watcher', 'system@usemingla.com');
  perform pg_temp.lk('PEOPLE', 'two owners are refused at commit', pg_temp.commit_check('select 1'), 'ERR:23514:card_people:%');
  delete from public.ops_work_people where card_id = v_id and email = pg_temp.email('kun');
  perform pg_temp.chk('PEOPLE', 'one owner and one watcher passes', pg_temp.commit_check('select 1'), 'OK');
  perform pg_temp.lk('PEOPLE', 'two watchers are refused at commit',
    pg_temp.commit_check(format($q$insert into public.ops_work_people (card_id, email, role, added_by) values (%L, %L, 'watcher', 'system@usemingla.com')$q$, v_id, pg_temp.email('abi'))),
    'ERR:23514:card_people:%');
  perform pg_temp.lk('PEOPLE', 'deleting the only watcher is refused at commit',
    pg_temp.commit_check(format($q$delete from public.ops_work_people where card_id = %L and role = 'watcher'$q$, v_id)), 'ERR:23514:card_people:%');
  perform pg_temp.chk('PEOPLE', 'swapping the owner and the watcher in one transaction is allowed',
    pg_temp.commit_check(format($q$update public.ops_work_people set role = case role when 'owner' then 'watcher' else 'owner' end where card_id = %L$q$, v_id)), 'OK');
  -- Closed with nobody: allowed. Reopened with no watcher: refused.
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, status, close_kind, closed_at, closed_by, closed_via, created_by, updated_by)
  values ('V34398 Closed raw card', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'done', 'system', now(), 'system@usemingla.com', 'system', 'system@usemingla.com', 'system@usemingla.com')
  returning id into v_id;
  perform pg_temp.keep('CLOSED', v_id);
  perform pg_temp.chk('PEOPLE', 'a closed card with nobody is allowed', pg_temp.commit_check('select 1'), 'OK');
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, pg_temp.email('tao'), 'owner', 'system@usemingla.com');
  perform pg_temp.lk('PEOPLE', 'reopening a closed card that has no watcher is refused at commit',
    pg_temp.commit_check(format($q$update public.ops_work_cards set status = 'todo', close_kind = null, closed_at = null, closed_by = null, closed_via = null where id = %L$q$, v_id)),
    'ERR:23514:card_people:%');
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s)::text', v_id, (select revision from public.ops_work_cards where id = v_id)));
  perform pg_temp.chk('PEOPLE', 'ops_work_reopen with no parent says exactly who to add', v,
    'ERR:23514:card_people: This card has no watcher. Pick one watcher (not ' || public.ops_name(pg_temp.email('tao')) || ', the owner), then reopen it.');
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s, null, %L)::text', v_id, (select revision from public.ops_work_cards where id = v_id), pg_temp.email('seth')));
  perform pg_temp.chk('PEOPLE', 'and reopens with the watcher the person picked',
    (select status from public.ops_work_cards where id = v_id) || '/' || pg_temp.people(v_id), 'todo/tao:owner,seth:watcher');
  -- A closed subtask with nobody takes its parent's owner and watcher on reopen.
  v := pg_temp.add('P2', 'V34398 Parent of a closed subtask', 'tao', 'seth');
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, status, close_kind, closed_at, closed_by, closed_via, parent_id, created_by, updated_by)
  values ('V34398 Closed subtask with nobody', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'done', 'system', now(), 'system@usemingla.com', 'system', pg_temp.id('P2'), 'system@usemingla.com', 'system@usemingla.com')
  returning id into v_id;
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s)::text', v_id, (select revision from public.ops_work_cards where id = v_id)));
  perform pg_temp.chk('PEOPLE', 'a closed subtask with nobody reopens with its parent''s owner and watcher',
    (select status from public.ops_work_cards where id = v_id) || '/' || pg_temp.people(v_id), 'todo/tao:owner,seth:watcher');

  -- Subtasks and plan steps carry one owner and one watcher.
  v := pg_temp.person('seth', format('select public.ops_subtask_add(%L, %L::jsonb, %L)::text', pg_temp.id('P'),
         jsonb_build_object('title', 'V34398 Subtask with no people'), pg_temp.rk()));
  perform pg_temp.chk('PEOPLE', 'a subtask with no people takes its parent''s', pg_temp.people(((v::jsonb)->'subtask'->>'id')::uuid), 'tao:owner,seth:watcher');
  v := pg_temp.person('seth', format('select public.ops_subtask_add(%L, %L::jsonb, %L)::text', pg_temp.id('P'),
         jsonb_build_object('title', 'V34398 Subtask Seth does', 'owners', jsonb_build_array(pg_temp.email('seth'))), pg_temp.rk()));
  perform pg_temp.chk('PEOPLE', 'a subtask owned by the parent''s watcher is watched by the parent''s owner', pg_temp.people(((v::jsonb)->'subtask'->>'id')::uuid), 'seth:owner,tao:watcher');
  update public.ops_work_people set role = role where card_id = pg_temp.id('P');
  perform public.ops_plan_sync(pg_temp.id('P'), jsonb_build_array(
    jsonb_build_object('n', 1, 'text', 'Draft the copy', 'tool', 'person', 'status', 'todo'),
    jsonb_build_object('n', 2, 'text', 'Ask the host', 'tool', 'crm', 'status', 'todo'),
    jsonb_build_object('n', 3, 'text', 'Read it back', 'tool', 'person', 'status', 'todo')), pg_temp.email('seth'), null);
  perform pg_temp.chk('PEOPLE', 'every new plan step has one owner and one different watcher',
    (select count(*)::text || '/' || bool_and(cardinality(public.ops_card_people(id, 'owner')) = 1 and cardinality(public.ops_card_people(id, 'watcher')) = 1)::text
       from public.ops_work_cards where parent_id = pg_temp.id('P') and plan_step is not null), '3/true');
  perform pg_temp.chk('PEOPLE', 'a step with no named person is the parent''s owner, watched by the parent''s watcher',
    (select pg_temp.people(id) from public.ops_work_cards where parent_id = pg_temp.id('P') and plan_step is not null and title = 'Read it back'),
    'tao:owner,seth:watcher');
  -- An existing step keeps its people when the plan changes.
  update public.ops_work_people set email = pg_temp.email('kun') where role = 'owner'
     and card_id = (select id from public.ops_work_cards where parent_id = pg_temp.id('P') and plan_step is not null order by position limit 1);
  perform public.ops_plan_sync(pg_temp.id('P'), jsonb_build_array(
    jsonb_build_object('n', 1, 'text', 'Draft the copy again', 'tool', 'person', 'status', 'todo')), pg_temp.email('seth'), null);
  perform pg_temp.chk('PEOPLE', 'an existing step keeps its people',
    (select pg_temp.people(id) from public.ops_work_cards where parent_id = pg_temp.id('P') and plan_step is not null order by position limit 1), 'kun:owner,seth:watcher');
  -- Clean up the raw cards so later blocks start from valid data.
  update public.ops_work_cards set archived_at = now(), archived_by = 'system@usemingla.com', archive_reason = 'Test cleanup.' where id in (pg_temp.id('RAW'), pg_temp.id('CLOSED'));
  perform pg_temp.chk('PEOPLE', 'the suite''s open cards all pass the invariant', pg_temp.commit_check('select 1'), 'OK');
end;
$t$;

-- ───────────────────────────── REVIEW ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  v := pg_temp.add('C', 'V34398 Review card', 'tao', 'seth');
  -- An owner's close goes to In review.
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, %L, %s)::text', pg_temp.id('C'),
         '[{"kind":"text","text":"Both videos are posted."}]', 'Posted both videos.', pg_temp.rev('C')));
  j := v::jsonb;
  perform pg_temp.chk('REVIEW', 'the owner''s close does not close it', (select status from public.ops_work_cards where id = pg_temp.id('C')), 'doing');
  perform pg_temp.chk('REVIEW', 'it waits in the review column',
    ((select status_id from public.ops_work_cards where id = pg_temp.id('C')) = public.ops_review_status_id())::text, 'true');
  perform pg_temp.chk('REVIEW', 'the answer names the watcher', j->'review'->>'watcher', pg_temp.email('seth'));
  perform pg_temp.lk('REVIEW', 'and says it went for review', j->>'message', 'Sent to % for review.%');
  perform pg_temp.chk('REVIEW', 'the result and proof are kept',
    (select result || '/' || jsonb_array_length(proof)::text from public.ops_work_cards where id = pg_temp.id('C')), 'Posted both videos./1');
  perform pg_temp.chk('REVIEW', 'the watcher is asked to confirm: a push with the decision flag',
    (select event_kind || '/' || push::text || '/' || decision::text from public.team_mentions
      where target_user_id = pg_temp.uid('seth') and source_id = (j->>'event_id')::uuid), 'review/true/true');
  perform pg_temp.chk('REVIEW', 'the card says who it waits on', (select public.ops_card_json(w, current_date)->'review'->>'waiting_on' from public.ops_work_cards w where w.id = pg_temp.id('C')),
    public.ops_name(pg_temp.email('seth')));
  -- Only the watcher confirms.
  v := pg_temp.person('tao', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('C'), pg_temp.rev('C')));
  perform pg_temp.lk('REVIEW', 'the owner cannot confirm their own card', v, 'ERR:42501:not_watcher:%');
  v := pg_temp.agent('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('C'), pg_temp.rev('C')));
  perform pg_temp.lk('REVIEW', 'an agent cannot confirm', v, 'ERR:42501:people_only:%');
  -- Send back needs a reason.
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('C'), '', pg_temp.rev('C')));
  perform pg_temp.lk('REVIEW', 'send back without a reason is refused', v, 'ERR:22023:reason_required:%');
  v := pg_temp.person('seth', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('C'), public.ops_status_in_progress(), pg_temp.rev('C')));
  perform pg_temp.lk('REVIEW', 'the watcher cannot drag it out of review', v, 'ERR:22023:use_send_back:%');
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('C'), 'Post the link to the published video.', pg_temp.rev('C')));
  perform pg_temp.chk('REVIEW', 'send back returns it to In progress',
    (select (status_id = public.ops_status_in_progress())::text || '/' || (review_requested_at is null)::text || '/' || sent_back_reason
       from public.ops_work_cards where id = pg_temp.id('C')), 'true/true/Post the link to the published video.');
  perform pg_temp.chk('REVIEW', 'the reason goes in the thread',
    (select count(*)::text from public.ops_work_messages where card_id = pg_temp.id('C') and body_md = 'Sent back: Post the link to the published video.'), '1');
  perform pg_temp.chk('REVIEW', 'the owner is told: a sent_back push',
    (select event_kind || '/' || push::text from public.team_mentions where target_user_id = pg_temp.uid('tao') and event_kind = 'sent_back'
        and source_id = ((v::jsonb)->>'event_id')::uuid), 'sent_back/true');
  -- Asked again, then confirmed by the watcher.
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('C'),
         '[{"kind":"text","text":"The link is on the card now."}]', pg_temp.rev('C')));
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('C'), pg_temp.rev('C')));
  perform pg_temp.chk('REVIEW', 'the watcher''s confirm closes it: done, closed by the owner, confirmed by the watcher',
    (select status || '/' || closed_by || '/' || confirmed_by from public.ops_work_cards where id = pg_temp.id('C')),
    'done/' || pg_temp.email('tao') || '/' || pg_temp.email('seth'));

  -- The watcher's own close is the confirm.
  v := pg_temp.add('CW', 'V34398 Watcher closes it', 'tao', 'seth');
  v := pg_temp.person('seth', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('CW'),
         '[{"kind":"text","text":"Checked it myself."}]', pg_temp.rev('CW')));
  perform pg_temp.chk('REVIEW', 'the watcher''s own close is Done at once',
    (select status || '/' || confirmed_by from public.ops_work_cards where id = pg_temp.id('CW')), 'done/' || pg_temp.email('seth'));
  -- A system close is Done.
  v := pg_temp.add('CS', 'V34398 System closes it', 'tao', 'seth');
  perform public.ops_auto_card_close(pg_temp.id('CS'), 'The data shows it is fixed.', '[]'::jsonb);
  perform pg_temp.chk('REVIEW', 'a system close is Done', (select status || '/' || coalesce(confirmed_by, '-') from public.ops_work_cards where id = pg_temp.id('CS')), 'done/-');
  -- A direct write cannot skip review.
  v := pg_temp.add('CD', 'V34398 Direct write', 'tao', 'seth');
  begin
    update public.ops_work_cards set status = 'done', close_kind = 'done', closed_at = now(), closed_by = pg_temp.email('tao'), closed_via = null
     where id = pg_temp.id('CD');
    perform pg_temp.chk('REVIEW', 'a direct UPDATE to done is refused', 'updated', 'refused');
  exception when others then
    perform pg_temp.chk('REVIEW', 'a direct UPDATE to done is refused', sqlstate || ':' || split_part(sqlerrm, ':', 1), '42501:review_required');
  end;
  -- An agent's close_work lands In review and says so.
  v := pg_temp.agent('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('CD'),
         jsonb_build_array(jsonb_build_object('kind', 'card', 'id', pg_temp.id('CW'), 'text', 'Read Card back: it is done.')), pg_temp.rev('CD')));
  perform pg_temp.lk('REVIEW', 'an agent''s close goes to review and says so', (v::jsonb)->>'message', 'Sent to % for review.%');
  perform pg_temp.chk('REVIEW', 'and remembers it came from the agent',
    (select review_requested_via from public.ops_work_cards where id = pg_temp.id('CD')), 'claude');
  -- A parent with open subtasks is refused at Mark done.
  v := pg_temp.add('CP', 'V34398 Parent with work left', 'tao', 'seth');
  v := pg_temp.add('CPS', 'V34398 Open child', 'tao', 'seth', 'CP');
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('CP'),
         '[{"kind":"text","text":"Done with the parent."}]', pg_temp.rev('CP')));
  perform pg_temp.lk('REVIEW', 'a parent with open subtasks is refused at Mark done', v, 'ERR:22023:open_subtasks:%');
end;
$t$;

-- ───────────────────────────── NOTICE ─────────────────────────────
do $t$
declare v text; v_id uuid;
begin
  delete from public.notification_outbox where user_id in (select id from tx_people);
  -- Bot add: Admin-only, no email, no push.
  v_id := (pg_temp.auto('ask:v34398-notice', 'V34398 Ask another host')->>'id')::uuid;
  perform pg_temp.chk('NOTICE', 'a bot add is an Admin-only notice for its owner and watcher',
    (select string_agg(t.who || ':' || m.event_kind || ':' || m.push::text, ',' order by t.who) from public.team_mentions m
       join tx_people t on t.id = m.target_user_id join public.ops_work_events e on e.id = m.source_id where e.card_id = v_id),
    'abi:bot:false,kun:bot:false');
  perform pg_temp.chk('NOTICE', 'a bot add never pushes or emails',
    (select count(*)::text from public.notification_outbox where payload->>'card_id' = v_id::text), '0');
  -- A person's status change tells the owner and watcher, not the person.
  v := pg_temp.add('N', 'V34398 Notice card', 'tao', 'abi');
  delete from public.notification_outbox where user_id in (select id from tx_people);
  v := pg_temp.person('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('N'), '{"status":"doing"}', pg_temp.rev('N')));
  perform pg_temp.chk('NOTICE', 'a person''s status change tells the watcher (a push), never the person',
    (select string_agg(t.who || ':' || m.event_kind || ':' || m.push::text, ',' order by t.who) from public.team_mentions m
       join tx_people t on t.id = m.target_user_id where m.source_id = ((v::jsonb)->>'event_id')::uuid), 'abi:status:true');
  perform pg_temp.chk('NOTICE', 'and the watcher gets the email',
    (select count(*)::text from public.notification_outbox where user_id = pg_temp.uid('abi') and category_key = 'admin.team_mention'
       and payload->>'card_id' = pg_temp.id('N')::text), '1');
  -- An edit is Admin-only.
  v := pg_temp.person('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('N'),
         '{"title":"V34398 Notice card renamed"}', pg_temp.rev('N')));
  perform pg_temp.chk('NOTICE', 'an edit is an Admin-only notice',
    (select string_agg(t.who || ':' || m.event_kind || ':' || m.push::text, ',') from public.team_mentions m
       join tx_people t on t.id = m.target_user_id where m.source_id = ((v::jsonb)->>'event_id')::uuid), 'abi:edit:false');
  -- A mention pushes.
  v := pg_temp.person('tao', format('select public.ops_message_post(%L, %L, %L::text[])::text', pg_temp.id('N'), 'Can you look at this?',
         array[pg_temp.email('kun')]));
  perform pg_temp.chk('NOTICE', 'a mention pushes',
    (select m.event_kind || ':' || m.push::text from public.team_mentions m where m.target_user_id = pg_temp.uid('kun')
       and m.source_id = ((v::jsonb)->>'event_id')::uuid), 'mention:true');
  -- A card given to you pushes.
  v := pg_temp.add('NA', 'V34398 Given to Kunle', 'kun', 'abi');
  perform pg_temp.chk('NOTICE', 'a card a person gives you pushes',
    (select m.event_kind || ':' || m.push::text from public.team_mentions m
       join public.ops_work_events e on e.id = m.source_id where e.card_id = pg_temp.id('NA') and m.target_user_id = pg_temp.uid('kun')), 'assigned:true');
  -- An Admin activity notice that is not a card.
  perform public.ops_activity_notice('guide', md5('v34398-guide')::uuid, array[pg_temp.email('seth')], 'Feature Guide: X is Live (PR #1).', null);
  -- team_inbox carries push rows only; team_activity groups the rest.
  v := pg_temp.person('abi', 'select public.team_inbox(null, 100)::text');
  perform pg_temp.chk('NOTICE', 'team_inbox carries no Admin-only notice',
    (select count(*)::text from jsonb_array_elements((v::jsonb)->'mentions') x
      where x->>'id' in (select id::text from public.team_mentions where target_user_id = pg_temp.uid('abi') and not push)), '0');
  perform pg_temp.chk('NOTICE', 'and it carries the status push with its card',
    (select (x->'card'->>'number' is not null)::text || '/' || (x->>'event_kind') from jsonb_array_elements((v::jsonb)->'mentions') x
      where x->>'event_kind' = 'status' limit 1), 'true/status');
  v := pg_temp.person('abi', 'select public.team_activity(14)::text');
  perform pg_temp.chk('NOTICE', 'team_activity groups the bot adds one line per kind per day',
    (select count(*)::text || '/' || bool_and((g->>'count')::integer >= 1 and jsonb_array_length(g->'items') = least((g->>'count')::integer, 20))::text
       from jsonb_array_elements((v::jsonb)->'groups') g where g->>'kind' = 'bot' and g->>'group' = 'added'), '1/true');
  perform pg_temp.chk('NOTICE', 'and lists the push notices under For you',
    (select (jsonb_array_length((v::jsonb)->'you') >= 1)::text), 'true');
  v := pg_temp.person('abi', $q$select public.team_activity_mark_read('mingla')::text$q$);
  perform pg_temp.chk('NOTICE', 'Mark all read clears Mingla activity only',
    (select count(*) filter (where not push and read_at is null)::text || '/' || (count(*) filter (where push and read_at is null) >= 1)::text
       from public.team_mentions where target_user_id = pg_temp.uid('abi')), '0/true');
  v := pg_temp.person('seth', 'select public.team_badge()::text');
  perform pg_temp.chk('NOTICE', 'the Host app badge never counts an Admin-only notice',
    (select ((v::jsonb)->>'mentions')::integer = count(*) filter (where push and read_at is null and source_kind <> 'team_message')
       from public.team_mentions where target_user_id = pg_temp.uid('seth'))::text, 'true');
  perform pg_temp.chk('NOTICE', 'the one rule: system actions never push', public.ops_notify_push('status', 'system@usemingla.com')::text, 'false');
end;
$t$;

-- ───────────────────────────── RELEASE ─────────────────────────────
do $t$
declare v jsonb; v_id uuid; v_old uuid;
begin
  -- Routes back to open cards for the release kinds.
  update public.ops_work_cards set status = 'todo', close_kind = null, close_reason = null, closed_at = null, closed_by = null, closed_via = null
   where id in (pg_temp.id('M'), pg_temp.id('F'));
  update public.ops_work_cards set status = 'todo', close_kind = null, close_reason = null, closed_at = null, closed_by = null, closed_via = null
   where id = pg_temp.id('G');
  update public.ops_settings set value = jsonb_build_object('routes', jsonb_build_object('eng_release', pg_temp.id('G')), 'fallback', pg_temp.id('F'))
   where key = 'auto_card_routes';
  update public.ops_settings set value = to_jsonb(now() - interval '10 days') where key = 'follow_through_since';
  insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, merged_by_login, issues, deploy_marker, deploy, problems, feature_guide)
  values (994398, 'V34398 three things missing', 'https://github.com/Mingla-LLC/mingla-main/pull/994398', now() - interval '1 hour',
          repeat('c', 40), 'nobody', '[]', false, '{"web":{"mingla-admin":"not_deployed"}}', '{no_issue,feature_guide_missing,web_not_deployed}', null);
  -- An open card of an old per-PR kind for the same PR.
  v := public.ops_auto_card_upsert('eng_record_pending:pr-994398', jsonb_build_object('title', 'V34398 Finish the release record of PR #994398',
    'instructions', 'The old kind of card, made before #4398.', 'done_means', 'The record is complete.', 'due_on', current_date + 1), 'task', null);
  v_old := (v->>'id')::uuid;
  perform public.ops_engineering_cards_sync();
  select id into v_id from public.ops_work_cards where auto_key = 'eng_release:pr-994398' and status <> 'done';
  perform pg_temp.chk('RELEASE', 'one card for the PR, under #2971''s stand-in, titled for the PR',
    (select count(*)::text || '/' || max(title) || '/' || bool_and(parent_id = pg_temp.id('G'))::text from public.ops_work_cards
      where auto_key like 'eng\_release:pr-994398' and status <> 'done'), '1/Finish the release of PR #994398/true');
  perform pg_temp.chk('RELEASE', 'no other per-PR card for it',
    (select count(*)::text from public.ops_work_cards where auto_key ~ '^eng_(no_issue|guide_missing|not_deployed|live_check|migrations):pr-994398' and status <> 'done'), '0');
  perform pg_temp.chk('RELEASE', 'its checklist has the three open items',
    (select string_agg(i->>'key', ',' order by i->>'key') from jsonb_array_elements(public.ops_release_items(994398)) i where not (i->>'done')::boolean),
    'deploy:mingla-admin,guide,issue');
  perform pg_temp.chk('RELEASE', 'the card shows the live checklist',
    (select jsonb_array_length(public.ops_card_json(w, current_date)->'release_items') >= 4 from public.ops_work_cards w where w.id = v_id)::text, 'true');
  perform pg_temp.lk('RELEASE', 'the old per-kind card is folded into it, naming it',
    (select status || ':' || close_kind || ':' || close_reason from public.ops_work_cards where id = v_old),
    'done:system:Folded into Card % Finish the release of PR #994398.');
  -- Tick one item at a time; the record is the only truth.
  update public.ops_release_records set problems = '{feature_guide_missing,web_not_deployed}' where pr = 994398;
  perform public.ops_engineering_cards_sync();
  perform pg_temp.chk('RELEASE', 'the issue link ticks off; the card stays open',
    (select string_agg(i->>'key', ',' order by i->>'key') from jsonb_array_elements(public.ops_release_items(994398)) i where not (i->>'done')::boolean)
      || '/' || (select status from public.ops_work_cards where id = v_id), 'deploy:mingla-admin,guide/todo');
  update public.ops_release_records set problems = '{web_not_deployed}', feature_guide = '{}' where pr = 994398;
  perform public.ops_engineering_cards_sync();
  perform pg_temp.chk('RELEASE', 'the Feature Guide line ticks off', (select status from public.ops_work_cards where id = v_id), 'todo');
  begin
    v := public.ops_work_finish((select w from public.ops_work_cards w where w.id = v_id), pg_temp.email('tao'), null, 'done', null, null, '[]'::jsonb, false);
    perform pg_temp.chk('RELEASE', 'the owner cannot mark a release card done (it closes itself)', 'reached', 'refused');
  exception when others then
    perform pg_temp.lk('RELEASE', 'the owner cannot mark a release card done (it closes itself)', sqlerrm, 'self_closing:%');
  end;
end;
$t$;
do $t$
declare v_id uuid;
begin
  select id into v_id from public.ops_work_cards where auto_key = 'eng_release:pr-994398' and status <> 'done';
  update public.ops_release_records set problems = '{}', complete = true, deploy = '{"web":{"mingla-admin":"ready"}}' where pr = 994398;
  perform public.ops_engineering_cards_sync();
  perform pg_temp.chk('RELEASE', 'the last item fixed: the card closes itself (a system close)',
    (select status || ':' || close_kind from public.ops_work_cards where id = v_id), 'done:system');
  -- guide_live makes no card.
  perform pg_temp.chk('RELEASE', 'ops_release_guide_apply makes no guide_live card',
    (select (prosrc not like '%ops_auto_card_upsert(format(''guide_live%' and prosrc like '%ops_activity_notice(''guide''%')::text
       from pg_proc where proname = 'ops_release_guide_apply'), 'true');
end;
$t$;

-- The Feature Guide coverage card is one standing card, updated in place.
do $t$
declare v_first uuid; v_rev bigint;
begin
  update public.ops_settings set value = jsonb_build_object('routes', jsonb_build_object('feature_guide_gap', pg_temp.id('G')), 'fallback', pg_temp.id('F'))
   where key = 'auto_card_routes';
  update public.ops_work_cards set status = 'done', close_kind = 'system', closed_at = now(), closed_by = 'system@usemingla.com', closed_via = 'system'
   where auto_key like 'feature\_guide\_gap:%' and status <> 'done';
  update public.ops_feature_guide_coverage set audited_through_sha = repeat('1', 40), observed_head_sha = repeat('2', 40), state = 'pending',
         blocked_sha = null, blocked_pr = null, blocked_reason = null where singleton;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.ops_feature_guide_coverage_reconcile();
  select id, revision into v_first, v_rev from public.ops_work_cards where auto_key = 'feature_guide_gap:current' and status <> 'done';
  perform pg_temp.chk('RELEASE', 'coverage stopped: one standing card', (v_first is not null)::text, 'true');
  update public.ops_feature_guide_coverage set observed_head_sha = repeat('3', 40), state = 'pending', blocked_sha = null, blocked_pr = null, blocked_reason = null where singleton;
  perform public.ops_feature_guide_coverage_reconcile();
  perform pg_temp.chk('RELEASE', 'coverage stops elsewhere: the same card, updated in place',
    (select count(*)::text || '/' || bool_and(id = v_first)::text || '/' || bool_and(revision > v_rev)::text || '/' || max(left(title, 45))
       from public.ops_work_cards where auto_key like 'feature\_guide\_gap:%' and status <> 'done'),
    '1/true/true/Feature Guide coverage stopped at 333333333');
  perform set_config('request.jwt.claims', '', true);
end;
$t$;

-- ───────────────────────────── UNDO and SECURITY ─────────────────────────────
-- Undo of a Confirm and of a Send back puts the card back In review with its
-- request (the same 60-second undo window and event record). The trigger
-- functions that read ops tables run as SECURITY DEFINER and no client can
-- call them.
do $t$
declare v text; v_ev text;
begin
  v := pg_temp.add('U', 'V34398 Undo card', 'tao', 'seth');
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('U'),
         '[{"kind":"text","text":"Posted it."}]', pg_temp.rev('U')));
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('U'), pg_temp.rev('U')));
  v_ev := (v::jsonb)->>'event_id';
  perform pg_temp.chk('UNDO', 'the watcher confirms it', (select status from public.ops_work_cards where id = pg_temp.id('U')), 'done');
  perform pg_temp.chk('UNDO', 'a confirmed review stops asking the watcher, though unread', pg_temp.ask_state('seth', 'U'), 'false/false');
  v := pg_temp.person('tao', format('select public.ops_work_undo(%L)::text', v_ev));
  perform pg_temp.lk('UNDO', 'only the watcher who confirmed can undo it', v, 'ERR:22023:undo_expired:%');
  v := pg_temp.person('seth', format('select public.ops_work_undo(%L)::text', v_ev));
  perform pg_temp.chk('UNDO', 'undoing Confirm puts it back In review, asked by the owner, not confirmed',
    (select status || '/' || (status_id = public.ops_review_status_id())::text || '/' || coalesce(review_requested_by, '-') || '/'
            || coalesce(confirmed_by, '-') || '/' || coalesce(closed_by, '-') from public.ops_work_cards where id = pg_temp.id('U')),
    'doing/true/' || pg_temp.email('tao') || '/-/-');
  perform pg_temp.chk('UNDO', 'back In review, the ask stands again', pg_temp.ask_state('seth', 'U'), 'true/true');
  v := pg_temp.person('seth', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('U'), 'Add the second link too.', pg_temp.rev('U')));
  v_ev := (v::jsonb)->>'event_id';
  perform pg_temp.chk('UNDO', 'then the watcher sends it back', (select (status_id = public.ops_status_in_progress())::text || '/' || coalesce(sent_back_reason, '-')
    from public.ops_work_cards where id = pg_temp.id('U')), 'true/Add the second link too.');
  v := pg_temp.person('seth', format('select public.ops_work_undo(%L)::text', v_ev));
  perform pg_temp.chk('UNDO', 'undoing Send back puts it back In review with its request',
    (select status || '/' || (status_id = public.ops_review_status_id())::text || '/' || coalesce(review_requested_by, '-') || '/' || coalesce(sent_back_reason, '-')
       from public.ops_work_cards where id = pg_temp.id('U')), 'doing/true/' || pg_temp.email('tao') || '/-');
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('U'), pg_temp.rev('U')));
  perform pg_temp.chk('UNDO', 'and the watcher can confirm it again', (select status || '/' || coalesce(confirmed_by, '-') from public.ops_work_cards where id = pg_temp.id('U')),
    'done/' || pg_temp.email('seth'));

  perform pg_temp.chk('SECURITY', 'the people check and the review guards run as their owner',
    (select string_agg(proname || ':' || prosecdef, ',' order by proname) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('ops_4398_card_people_check', 'ops_4398_review_guard', 'ops_4398_review_column_guard')),
    'ops_4398_card_people_check:true,ops_4398_review_column_guard:true,ops_4398_review_guard:true');
  perform pg_temp.chk('SECURITY', 'no client role can call them',
    (select bool_or(has_function_privilege(r, f, 'EXECUTE'))::text from unnest(array['anon', 'authenticated']) r,
      unnest(array['public.ops_4398_card_people_check()', 'public.ops_4398_review_guard()', 'public.ops_4398_review_column_guard()',
                   'public.ops_default_watcher(text,text[])']) f), 'false');
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
  if v_all < 60 then raise exception '#4398 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4398 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4398 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
