-- Issue #4571 W1 (people and goals) -- implementor suite for
-- 20281126014571_issue_4571_w1_people_and_goals.sql on the fully replayed
-- PG17 schema. Everything is rolled back.
--
-- INVARIANT ops-card-owners-and-watchers (replaces ops-card-one-owner-one-watcher, #4398) | gate ops_4571_card_people_check | test this file
-- INVARIANT ops-review-any-watcher | gate ops_work_confirm / ops_work_send_back (= ANY watcher) | test this file
-- INVARIANT ops-sprint-goal-title-3-120 | gate ops_sprint_goals_title_check, ops_sprint_goal_add, ops_sprint_goal_update | test this file
--
--   PEOPLE   2 owners + 3 watchers save and read back; 0 owners, 0 watchers
--            and 11 owners are refused at commit; 11 owners/watchers and an
--            owner named as a watcher are refused by ops_people_check with
--            the exact words; a swap in one transaction commits; done and
--            archived cards are not checked.
--   REVIEW   the owner's close asks every watcher; the card waits on any of
--            them; watcher B confirms, the other watchers are told, A's late
--            confirm is PT409; an agent is refused people_only; any watcher
--            sends back and the others are told.
--   INHERIT  subtasks, plan steps, reopen and automatic cards copy everyone.
--   GOALS    no cap; titles 3 to 120; a note saves and clears; the met tick
--            is state done set by hand; ops_sprint_set_goal and
--            ops_sprints.goal are gone.
--
-- FAILS-ON-REVERT: on origin/main the exactly-one trigger refuses the
-- 2 + 3 card, ops_4571_* do not exist, a second watcher cannot confirm and
-- the sixth goal is refused.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45710000-0000-4000-a000-000000000001', 'seth.w14571@test.local'),
  ('tao',  '45710000-0000-4000-a000-000000000002', 'tao.w14571@test.local'),
  ('abi',  '45710000-0000-4000-a000-000000000003', 'abi.w14571@test.local'),
  ('kun',  '45710000-0000-4000-a000-000000000004', 'kun.w14571@test.local'),
  ('ada',  '45710000-0000-4000-a000-000000000005', 'ada.w14571@test.local');
insert into tx_people (who, id, email)
  select 't' || lpad(g::text, 2, '0'), ('45710000-0000-4000-b000-0000000000' || lpad(g::text, 2, '0'))::uuid, 't' || lpad(g::text, 2, '0') || '.w14571@test.local'
    from generate_series(1, 11) g;
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('seth.w14571@test.local', 'owner', 'active', now()), ('abi.w14571@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who not in ('seth', 'abi');

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
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards immediate;
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
    reset role;
    return v_out;
  exception when others then
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
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
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards immediate;
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
    raise exception 'ok_rollback' using errcode = 'P0001';
  exception when others then
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
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
create function pg_temp.rk() returns text language sql as $fn$ select 'w1-' || md5(random()::text || clock_timestamp()::text) $fn$;
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
    'owners', jsonb_build_array('abi.w14571@test.local', 'kun.w14571@test.local'), 'watchers', '[]'::jsonb,
    'due_on', (now() at time zone 'UTC')::date + 1) || p_extra, 'task', null)
$fn$;
create function pg_temp.sysclose(p_k text) returns void
language sql as $fn$
  update public.ops_work_cards set status = 'done', close_kind = 'system', close_reason = 'Closed for the test.', closed_at = now(),
         closed_by = 'system@usemingla.com', closed_via = 'system', revision = revision + 1
   where id = pg_temp.id(p_k)
$fn$;

-- #4571: a card with lists of people (by who).
create function pg_temp.addp(p_k text, p_title text, p_owners text[], p_watchers text[], p_parent text default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'due_on', (now() at time zone 'UTC')::date + 3,
    'owners', to_jsonb(ARRAY(select pg_temp.email(x) from unnest(p_owners) x)),
    'watchers', to_jsonb(ARRAY(select pg_temp.email(x) from unnest(p_watchers) x)));
  if p_parent is not null then v_item := v_item || jsonb_build_object('parent', pg_temp.id(p_parent)); end if;
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.fixes(p_v text) returns text
language sql as $fn$
  select string_agg(f->>'message', ' | ' order by f->>'field', f->>'message') from jsonb_array_elements((p_v::jsonb)->'results'->0->'fixes') f
$fn$;
-- Who got a notice for an event, as who:kind, sorted.
create function pg_temp.told(p_event uuid) returns text
language sql as $fn$
  select coalesce(string_agg(t.who || ':' || m.event_kind, ',' order by t.who), '<nobody>') from public.team_mentions m
    join tx_people t on t.id = m.target_user_id where m.source_id = p_event
$fn$;

-- ───────────────────────────── PEOPLE ─────────────────────────────
do $t$
declare v text; v_id uuid; j jsonb;
begin
  v := pg_temp.addp('C5', 'W14571 Two owners three watchers', array['tao', 'kun'], array['seth', 'abi', 'ada']);
  perform pg_temp.chk('PEOPLE', 'a card with 2 owners and 3 watchers is added', (v::jsonb)->'results'->0->>'status', 'added');
  perform pg_temp.chk('PEOPLE', 'it reads back with all five', pg_temp.people(pg_temp.id('C5')),
    'kun:owner,tao:owner,abi:watcher,ada:watcher,seth:watcher');
  perform pg_temp.chk('PEOPLE', 'and passes the gate at commit', pg_temp.commit_check('select 1'), 'OK');
  j := (select public.ops_card_json(w, current_date) from public.ops_work_cards w where w.id = pg_temp.id('C5'));
  perform pg_temp.chk('PEOPLE', 'card JSON lists every owner and watcher',
    jsonb_array_length(j->'owners')::text || '/' || jsonb_array_length(j->'watchers')::text, '2/3');
  perform pg_temp.chk('PEOPLE', 'and has no sprint goal key', (j->'sprint' ? 'goal')::text, 'false');
  perform pg_temp.chk('PEOPLE', 'the board builder agrees on the people',
    (select jsonb_array_length(x->'owners')::text || '/' || jsonb_array_length(x->'watchers')::text || '/' || (x->'sprint' ? 'goal')::text
       from jsonb_array_elements(public.ops_cards_json(array[pg_temp.id('C5')], current_date, 'full')) x), '2/3/false');

  -- update_work with lists.
  v := pg_temp.person('seth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('C5'),
         jsonb_build_object('owners', jsonb_build_array(pg_temp.email('tao'), pg_temp.email('kun'), pg_temp.email('t01')),
                            'watchers', jsonb_build_array(pg_temp.email('seth'), pg_temp.email('abi'))), pg_temp.rev('C5')));
  perform pg_temp.chk('PEOPLE', 'update_work saves 3 owners and 2 watchers', pg_temp.people(pg_temp.id('C5')),
    'kun:owner,t01:owner,tao:owner,abi:watcher,seth:watcher');

  -- The words, from ops_people_check.
  v := pg_temp.addp('X0', 'W14571 No owners', array[]::text[], array['seth']);
  perform pg_temp.chk('PEOPLE', 'no owner is refused with the words', pg_temp.fixes(v), 'A card needs at least one owner.');
  v := pg_temp.addp('X1', 'W14571 No watchers', array['tao'], array[]::text[]);
  perform pg_temp.chk('PEOPLE', 'no watcher is refused with the words', pg_temp.fixes(v), 'A card needs at least one watcher, who is not an owner.');
  v := pg_temp.addp('X2', 'W14571 Eleven owners', array['t01','t02','t03','t04','t05','t06','t07','t08','t09','t10','t11'], array['seth']);
  perform pg_temp.chk('PEOPLE', '11 owners are refused with the words', pg_temp.fixes(v), 'A card has at most 10 owners.');
  v := pg_temp.addp('X3', 'W14571 Eleven watchers', array['seth'], array['t01','t02','t03','t04','t05','t06','t07','t08','t09','t10','t11']);
  perform pg_temp.chk('PEOPLE', '11 watchers are refused with the words', pg_temp.fixes(v), 'A card has at most 10 watchers.');
  v := pg_temp.addp('X4', 'W14571 Ten of each', array['t01','t02','t03','t04','t05','t06','t07','t08','t09','t10'],
                    array['seth','abi','tao','kun','ada','t11']);
  perform pg_temp.chk('PEOPLE', '10 owners are accepted', (v::jsonb)->'results'->0->>'status', 'added');
  v := pg_temp.addp('X5', 'W14571 Owner as watcher', array['tao', 'kun'], array['tao', 'seth']);
  perform pg_temp.chk('PEOPLE', 'an owner named as a watcher is refused, never dropped', (v::jsonb)->'results'->0->>'status', 'refused');
  perform pg_temp.chk('PEOPLE', 'with their name in the words', pg_temp.fixes(v),
    public.ops_name(pg_temp.email('tao')) || ' owns this card, so they cannot also watch it.');
  perform pg_temp.chk('PEOPLE', 'nothing was made', (select count(*)::text from public.ops_work_cards where title = 'W14571 Owner as watcher'), '0');
  v := pg_temp.person('seth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('C5'),
         jsonb_build_object('watchers', jsonb_build_array(pg_temp.email('seth'), pg_temp.email('tao'))), pg_temp.rev('C5')));
  perform pg_temp.lk('PEOPLE', 'update_work refuses an owner as a watcher too', v,
    'ERR:22023:invalid_card: ' || public.ops_name(pg_temp.email('tao')) || ' owns this card, so they cannot also watch it.%');
  v := pg_temp.person('seth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('C5'),
         jsonb_build_object('owners', '[]'::jsonb), pg_temp.rev('C5')));
  perform pg_temp.lk('PEOPLE', 'removing the last owner is refused', v, 'ERR:22023:invalid_card: A card needs at least one owner.%');

  -- The gate at commit, whoever writes.
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  values ('W14571 Raw card', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'system@usemingla.com', 'system@usemingla.com') returning id into v_id;
  perform pg_temp.keep('RAW', v_id);
  insert into public.ops_work_people (card_id, email, role, added_by)
    select v_id, pg_temp.email(x), 'watcher', 'system@usemingla.com' from unnest(array['seth']) x;
  perform pg_temp.lk('PEOPLE', '0 owners is refused at commit (23514)', pg_temp.commit_check('select 1'),
    'ERR:23514:card_people: A card needs at least one owner and at least one watcher, and nobody can be both.');
  insert into public.ops_work_people (card_id, email, role, added_by)
    select v_id, pg_temp.email(x), 'owner', 'system@usemingla.com' from unnest(array['t01','t02','t03','t04','t05','t06','t07','t08','t09','t10','t11']) x;
  perform pg_temp.lk('PEOPLE', '11 owners is refused at commit', pg_temp.commit_check('select 1'), 'ERR:23514:card_people:%');
  delete from public.ops_work_people where card_id = v_id and email = pg_temp.email('t11');
  perform pg_temp.chk('PEOPLE', '10 owners and 1 watcher commit', pg_temp.commit_check('select 1'), 'OK');
  perform pg_temp.lk('PEOPLE', '0 watchers is refused at commit',
    pg_temp.commit_check(format($q$delete from public.ops_work_people where card_id = %L and role = 'watcher'$q$, v_id)), 'ERR:23514:card_people:%');
  perform pg_temp.chk('PEOPLE', 'a swap inside one transaction commits',
    pg_temp.commit_check(format($q$update public.ops_work_people set role = 'watcher' where card_id = %L and email = %L;
                                  update public.ops_work_people set role = 'owner' where card_id = %L and email = %L$q$,
                                v_id, pg_temp.email('t01'), v_id, pg_temp.email('seth'))), 'OK');
  perform pg_temp.chk('PEOPLE', 'a done card is not checked',
    pg_temp.commit_check(format($q$update public.ops_work_cards set status = 'done', close_kind = 'system', closed_at = now(), closed_by = 'system@usemingla.com', closed_via = 'system' where id = %L;
                                  delete from public.ops_work_people where card_id = %L$q$, v_id, v_id)), 'OK');
  perform pg_temp.chk('PEOPLE', 'an archived card is not checked',
    pg_temp.commit_check(format($q$update public.ops_work_cards set archived_at = now(), archived_by = 'system@usemingla.com', archive_reason = 'Test.' where id = %L;
                                  delete from public.ops_work_people where card_id = %L$q$, v_id, v_id)), 'OK');
  update public.ops_work_cards set archived_at = now(), archived_by = 'system@usemingla.com', archive_reason = 'Test cleanup.' where id = v_id;
  perform pg_temp.chk('PEOPLE', 'the old exactly-one gate is gone',
    (select count(*)::text from pg_trigger where tgname like 'ops\_4398\_card\_people%'), '0');
  perform pg_temp.chk('PEOPLE', 'the new gate is on both tables, deferred',
    (select string_agg(tgrelid::regclass::text || ':' || tgdeferrable::text || ':' || tginitdeferred::text, ',' order by tgname)
       from pg_trigger where tgname like 'ops\_4571\_card\_people%'), 'ops_work_cards:true:true,ops_work_people:true:true');
end;
$t$;

-- ───────────────────────────── REVIEW ─────────────────────────────
do $t$
declare v text; j jsonb; v_rev bigint;
begin
  v := pg_temp.addp('R', 'W14571 Review card', array['tao', 'kun'], array['seth', 'abi', 'ada']);
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, %L, %s)::text', pg_temp.id('R'),
         '[{"kind":"text","text":"Both videos are posted."}]', 'Posted both videos.', pg_temp.rev('R')));
  j := v::jsonb;
  perform pg_temp.chk('REVIEW', 'the owner''s close goes to In review',
    ((select status_id from public.ops_work_cards where id = pg_temp.id('R')) = public.ops_review_status_id())::text, 'true');
  perform pg_temp.chk('REVIEW', 'every watcher gets a review notice', pg_temp.told((j->>'event_id')::uuid), 'abi:review,ada:review,seth:review');
  perform pg_temp.chk('REVIEW', 'the answer lists every watcher', jsonb_array_length(j->'review'->'watchers')::text, '3');
  perform pg_temp.lk('REVIEW', 'and says one of them confirms', j->>'message', 'Sent to % or % for review. The card waits In review until one of them confirms it%');
  perform pg_temp.chk('REVIEW', 'the card waits on any of them',
    (select (public.ops_card_json(w, current_date)->'review'->'waiting_on_all')::text from public.ops_work_cards w where w.id = pg_temp.id('R')),
    (select jsonb_agg(public.ops_name(p.email) order by p.added_at, p.email)::text from public.ops_work_people p where p.card_id = pg_temp.id('R') and p.role = 'watcher'));
  perform pg_temp.chk('REVIEW', 'the board builder agrees',
    (select (x->'review'->'waiting_on_all')::text from jsonb_array_elements(public.ops_cards_json(array[pg_temp.id('R')], current_date, 'board')) x),
    (select (public.ops_card_json(w, current_date)->'review'->'waiting_on_all')::text from public.ops_work_cards w where w.id = pg_temp.id('R')));
  perform pg_temp.chk('REVIEW', 'waiting_on stays as the first watcher for older readers',
    (select public.ops_card_json(w, current_date)->'review'->>'waiting_on' from public.ops_work_cards w where w.id = pg_temp.id('R')),
    public.ops_name((public.ops_card_people(pg_temp.id('R'), 'watcher'))[1]));
  v := pg_temp.person('tao', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('R'), pg_temp.rev('R')));
  perform pg_temp.lk('REVIEW', 'an owner cannot confirm', v, 'ERR:42501:not_watcher: Only a watcher of this card confirms it (%');
  v := pg_temp.agent('abi', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('R'), pg_temp.rev('R')));
  perform pg_temp.lk('REVIEW', 'an agent cannot confirm', v, 'ERR:42501:people_only:%');
  v := pg_temp.agent('abi', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('R'), 'Post the link first.', pg_temp.rev('R')));
  perform pg_temp.lk('REVIEW', 'an agent cannot send back', v, 'ERR:42501:people_only:%');
  v_rev := pg_temp.rev('R');
  -- seth is the last watcher by address, so a first-watcher-only confirm would refuse him.
  v := pg_temp.person('seth', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('R'), v_rev));
  perform pg_temp.chk('REVIEW', 'watcher B (seth, not the first) confirms: done, confirmed by seth',
    (select status || '/' || confirmed_by from public.ops_work_cards where id = pg_temp.id('R')), 'done/' || pg_temp.email('seth'));
  perform pg_temp.chk('REVIEW', 'the owners and the other watchers are told',
    pg_temp.told(((v::jsonb)->>'event_id')::uuid), 'abi:status,ada:status,kun:status,tao:status');
  v := pg_temp.person('abi', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('R'), v_rev));
  perform pg_temp.lk('REVIEW', 'watcher A''s late confirm is a stale write', v, 'ERR:PT409:stale_write:%');
  perform pg_temp.chk('REVIEW', 'and the reloaded card shows Done', (select status from public.ops_work_cards where id = pg_temp.id('R')), 'done');

  -- Any watcher sends back; the other watchers are told.
  v := pg_temp.addp('S', 'W14571 Send back card', array['tao'], array['seth', 'ada']);
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('S'),
         '[{"kind":"text","text":"Done."}]', pg_temp.rev('S')));
  v := pg_temp.person('ada', format('select public.ops_work_send_back(%L, %L, %s)::text', pg_temp.id('S'), 'Post the link to the video.', pg_temp.rev('S')));
  perform pg_temp.chk('REVIEW', 'watcher ada sends it back',
    (select (status_id = public.ops_status_in_progress())::text || '/' || sent_back_by from public.ops_work_cards where id = pg_temp.id('S')),
    'true/' || pg_temp.email('ada'));
  perform pg_temp.chk('REVIEW', 'the owner gets sent_back and the other watcher a status notice',
    pg_temp.told(((v::jsonb)->>'event_id')::uuid), 'seth:status,tao:sent_back');
  -- A second watcher's own close is the confirm.
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('S'),
         '[{"kind":"text","text":"Link posted."}]', pg_temp.rev('S')));
  v := pg_temp.person('ada', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('S'),
         '[{"kind":"text","text":"Checked."}]', pg_temp.rev('S')));
  perform pg_temp.chk('REVIEW', 'any watcher closing a card that waits on them confirms it',
    (select status || '/' || confirmed_by from public.ops_work_cards where id = pg_temp.id('S')), 'done/' || pg_temp.email('ada'));
end;
$t$;

-- ───────────────────────────── INHERIT ─────────────────────────────
do $t$
declare v text; v_sub uuid;
begin
  v := pg_temp.addp('P', 'W14571 Parent card', array['tao', 'kun'], array['seth', 'abi', 'ada']);
  v := pg_temp.person('seth', format('select public.ops_subtask_add(%L, %L::jsonb, %L)::text', pg_temp.id('P'),
         jsonb_build_object('title', 'W14571 Subtask with no people'), pg_temp.rk()));
  perform pg_temp.chk('INHERIT', 'a subtask with no people takes all of its parent''s',
    pg_temp.people(((v::jsonb)->'subtask'->>'id')::uuid), 'kun:owner,tao:owner,abi:watcher,ada:watcher,seth:watcher');
  v := pg_temp.person('seth', format('select public.ops_subtask_add(%L, %L::jsonb, %L)::text', pg_temp.id('P'),
         jsonb_build_object('title', 'W14571 Subtask Seth owns', 'owners', jsonb_build_array(pg_temp.email('seth'))), pg_temp.rk()));
  perform pg_temp.chk('INHERIT', 'a subtask owned by a parent watcher takes the other watchers',
    pg_temp.people(((v::jsonb)->'subtask'->>'id')::uuid), 'seth:owner,abi:watcher,ada:watcher');
  v := pg_temp.addp('Q', 'W14571 Parent watched by its subtask owner', array['tao'], array['seth']);
  v := pg_temp.person('seth', format('select public.ops_subtask_add(%L, %L::jsonb, %L)::text', pg_temp.id('Q'),
         jsonb_build_object('title', 'W14571 Seth does it', 'owners', jsonb_build_array(pg_temp.email('seth'))), pg_temp.rk()));
  perform pg_temp.chk('INHERIT', 'no other watcher: the parent''s owners watch it',
    pg_temp.people(((v::jsonb)->'subtask'->>'id')::uuid), 'seth:owner,tao:watcher');
  -- A plan step with no named person.
  perform public.ops_plan_sync(pg_temp.id('P'), jsonb_build_array(
    jsonb_build_object('n', 1, 'text', 'Read it back', 'tool', 'person', 'status', 'todo')), pg_temp.email('seth'), null);
  perform pg_temp.chk('INHERIT', 'a new plan step takes all of its parent''s people',
    (select pg_temp.people(id) from public.ops_work_cards where parent_id = pg_temp.id('P') and plan_step is not null),
    'kun:owner,tao:owner,abi:watcher,ada:watcher,seth:watcher');
  perform pg_temp.chk('INHERIT', 'the suite''s open cards pass the gate', pg_temp.commit_check('select 1'), 'OK');

  -- Reopen: no people given keeps the card's own; lists given replace them.
  v := pg_temp.addp('O', 'W14571 Reopen card', array['tao'], array['seth']);
  perform public.ops_auto_card_close(pg_temp.id('O'), 'Closed for the test.', '[]'::jsonb);
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s, %L::jsonb, %L::jsonb)::text', pg_temp.id('O'), pg_temp.rev('O'),
         jsonb_build_array(pg_temp.email('tao'), pg_temp.email('kun')), jsonb_build_array(pg_temp.email('seth'), pg_temp.email('ada'))));
  perform pg_temp.chk('INHERIT', 'reopen takes lists of owners and watchers',
    (select status from public.ops_work_cards where id = pg_temp.id('O')) || '/' || pg_temp.people(pg_temp.id('O')),
    'todo/kun:owner,tao:owner,ada:watcher,seth:watcher');
  perform public.ops_auto_card_close(pg_temp.id('O'), 'Closed again.', '[]'::jsonb);
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s, %L::jsonb, %L::jsonb)::text', pg_temp.id('O'), pg_temp.rev('O'),
         jsonb_build_array(pg_temp.email('tao')), jsonb_build_array(pg_temp.email('tao'))));
  perform pg_temp.chk('INHERIT', 'reopen refuses an owner as a watcher', v,
    'ERR:23514:card_people: ' || public.ops_name(pg_temp.email('tao')) || ' owns this card, so they cannot also watch it. Pick the people, then reopen it.');
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, status, close_kind, closed_at, closed_by, closed_via, parent_id, created_by, updated_by)
  values ('W14571 Closed subtask with nobody', 'Written straight into the table.', 'It is done.', current_date + 2, 'explicit',
          public.ops_sprint_ensure(current_date), 'done', 'system', now(), 'system@usemingla.com', 'system', pg_temp.id('P'), 'system@usemingla.com', 'system@usemingla.com')
  returning id into v_sub;
  v := pg_temp.person('seth', format('select public.ops_work_reopen(%L, null, %s)::text', v_sub, (select revision from public.ops_work_cards where id = v_sub)));
  perform pg_temp.chk('INHERIT', 'a closed subtask with nobody reopens with all of its parent''s people',
    (select status from public.ops_work_cards where id = v_sub) || '/' || pg_temp.people(v_sub), 'todo/kun:owner,tao:owner,abi:watcher,ada:watcher,seth:watcher');

  -- Automatic cards copy everyone on the route card.
  v := pg_temp.addp('RT', 'W14571 Route card', array['tao', 'kun'], array['seth', 'abi']);
  update public.ops_settings set value = jsonb_build_object('routes', jsonb_build_object('ask', pg_temp.id('RT')), 'fallback', pg_temp.id('RT'))
   where key = 'auto_card_routes';
  v := (pg_temp.auto('ask:w14571-host', 'W14571 Ask a host for their first event'))::text;
  perform pg_temp.chk('INHERIT', 'an automatic card takes all four of its route card''s people',
    pg_temp.people(((v::jsonb)->>'id')::uuid), 'kun:owner,tao:owner,abi:watcher,seth:watcher');
  perform pg_temp.chk('INHERIT', 'Settings lists every name on the route',
    (select jsonb_array_length(r->'card'->'owners')::text || '/' || jsonb_array_length(r->'card'->'watchers')::text
       from jsonb_array_elements(public.ops_auto_routes_json()->'routes') r where r->>'kind' = 'ask'), '2/2');
  perform pg_temp.chk('INHERIT', 'the route answer keeps the first of each for brand_plan_host_add',
    (public.ops_auto_route('ask')->>'owner') || '/' || jsonb_array_length(public.ops_auto_route('ask')->'owners')::text,
    (public.ops_card_people(pg_temp.id('RT'), 'owner'))[1] || '/2');
end;
$t$;

-- ───────────────────────────── INBOX ─────────────────────────────
do $t$
declare v text; c jsonb;
begin
  v := pg_temp.addp('IB', 'W14571 Inbox card', array['tao', 'kun'], array['seth', 'ada']);
  v := pg_temp.person('tao', format('select public.ops_work_close(%L, %L::jsonb, null, %s)::text', pg_temp.id('IB'),
         '[{"kind":"text","text":"Done."}]', pg_temp.rev('IB')));
  v := pg_temp.person('ada', 'select public.team_inbox()::text');
  c := (select m->'card' from jsonb_array_elements((v::jsonb)->'mentions') m where m->>'card_id' = pg_temp.id('IB')::text limit 1);
  perform pg_temp.chk('INBOX', 'the Host app feed lists every owner and watcher',
    jsonb_array_length(c->'owners')::text || '/' || jsonb_array_length(c->'watchers')::text || '/'
      || jsonb_array_length(c->'owner_emails')::text || '/' || jsonb_array_length(c->'watcher_emails')::text, '2/2/2/2');
  perform pg_temp.chk('INBOX', 'and keeps the single keys for builds on phones',
    (c->>'owner_email') || '/' || (c->>'watcher_email'),
    (select min(email) from public.ops_work_people where card_id = pg_temp.id('IB') and role = 'owner') || '/'
      || (select min(email) from public.ops_work_people where card_id = pg_temp.id('IB') and role = 'watcher'));
end;
$t$;

-- ───────────────────────────── GOALS ─────────────────────────────
do $t$
declare v text; v_sprint uuid := public.ops_sprint_ensure(current_date); g jsonb; i integer;
begin
  delete from public.ops_sprint_goals where sprint_id = v_sprint;
  for i in 1..7 loop
    v := pg_temp.person('seth', format('select public.ops_sprint_goal_add(%L, %L)::text', v_sprint, 'W14571 goal number ' || i));
  end loop;
  perform pg_temp.lk('GOALS', 'a sprint takes a sixth and seventh goal (no cap)', v, '{"goal":%');
  perform pg_temp.chk('GOALS', 'seven live goals', (select count(*)::text from public.ops_sprint_goals where sprint_id = v_sprint and archived_at is null), '7');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_add(%L, %L, null, %L)::text', v_sprint, repeat('g', 120), 'Ship it by Friday.'));
  g := (v::jsonb)->'goal';
  perform pg_temp.chk('GOALS', 'a 120-character title saves, with a note', char_length(g->>'title')::text || '/' || (g->>'note'), '120/Ship it by Friday.');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_add(%L, %L)::text', v_sprint, repeat('g', 121)));
  perform pg_temp.chk('GOALS', 'a 121-character title is refused', v, 'ERR:22023:invalid_goal: Say the goal in 3 to 120 characters.');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_add(%L, %L)::text', v_sprint, 'ab'));
  perform pg_temp.chk('GOALS', 'a 2-character title is refused', v, 'ERR:22023:invalid_goal: Say the goal in 3 to 120 characters.');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_add(%L, %L, null, %L)::text', v_sprint, 'W14571 long note', repeat('n', 501)));
  perform pg_temp.chk('GOALS', 'a 501-character note is refused', v, 'ERR:22023:invalid_goal: Keep the note to 500 characters.');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_update(%L, %L::jsonb, %s)::text', g->>'id',
         jsonb_build_object('note', 'Now Thursday.', 'title', repeat('h', 120)), g->>'revision'));
  g := (v::jsonb)->'goal';
  perform pg_temp.chk('GOALS', 'update saves a note and a 120-character title', (g->>'note') || '/' || char_length(g->>'title')::text, 'Now Thursday./120');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_update(%L, %L::jsonb, %s)::text', g->>'id', '{"title":"' || repeat('h', 121) || '"}', g->>'revision'));
  perform pg_temp.chk('GOALS', 'update refuses 121 characters', v, 'ERR:22023:invalid_goal: Say the goal in 3 to 120 characters.');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_update(%L, %L::jsonb, %s)::text', g->>'id', '{"note":null}', g->>'revision'));
  g := (v::jsonb)->'goal';
  perform pg_temp.chk('GOALS', 'a null note clears it', coalesce(g->>'note', '<null>'), '<null>');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_update(%L, %L::jsonb, %s)::text', g->>'id', '{"state":"done"}', g->>'revision'));
  g := (v::jsonb)->'goal';
  perform pg_temp.chk('GOALS', 'the met tick is state done set by hand', (g->>'state') || '/' || (g->>'set_by_hand'), 'done/true');
  v := pg_temp.person('seth', format('select public.ops_sprint_goal_update(%L, %L::jsonb, %s)::text', g->>'id', '{"state":null}', g->>'revision'));
  g := (v::jsonb)->'goal';
  perform pg_temp.chk('GOALS', 'unticking hands it back to the numbers', (g->>'set_by_hand') || '/' || (g->>'state' = g->>'auto_state')::text, 'false/true');
  perform pg_temp.chk('GOALS', 'the sprint JSON lists every goal and no single goal',
    (select jsonb_array_length(public.ops_sprint_json(starts_on)->'goals')::text || '/' || (public.ops_sprint_json(starts_on) ? 'goal')::text
       from public.ops_sprints where id = v_sprint), '8/false');
  perform pg_temp.chk('GOALS', 'the team overview has no single goal', (public.ops_team_overview(current_date)->'sprint' ? 'goal')::text, 'false');
  perform pg_temp.chk('GOALS', 'ops_sprint_set_goal is gone', (to_regprocedure('public.ops_sprint_set_goal(date,text)') is null)::text, 'true');
  perform pg_temp.chk('GOALS', 'ops_sprints.goal is gone',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ops_sprints' and column_name = 'goal'), '0');
  perform pg_temp.chk('GOALS', 'the old three-argument goal add is gone',
    (to_regprocedure('public.ops_sprint_goal_add(uuid,text,text)') is null)::text, 'true');
  perform pg_temp.chk('GOALS', 'the new goal add is people-callable only',
    has_function_privilege('authenticated', 'public.ops_sprint_goal_add(uuid,text,text,text)', 'execute')::text || '/'
      || has_function_privilege('anon', 'public.ops_sprint_goal_add(uuid,text,text,text)', 'execute')::text, 'true/false');
  perform pg_temp.chk('GOALS', 'the helpers are not callable by clients',
    has_function_privilege('authenticated', 'public.ops_4571_inherit_watchers(uuid,text[])', 'execute')::text || '/'
      || has_function_privilege('authenticated', 'public.ops_4571_any_of(text[])', 'execute')::text, 'false/false');
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
  if v_all < 60 then raise exception '#4571 W1 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W1 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W1 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
