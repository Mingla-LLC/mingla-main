-- Issue #4270 (Wave 1) -- implementor happy path for
-- 20280427004270_issue_4270_w1_work_board_three_columns.sql, on the fully
-- replayed PG17 schema.
-- MINGLA-INVARIANT: I-4270-AGENT-NEVER-CLOSES-TAGGED | issue #4270 | a request with via set can never close or push back a card that has person_reason (a Send, Spend or Publish tag).
-- MINGLA-INVARIANT: I-4270-NO-PERSON-STATUS | issue #4270 | ops_work_cards.status is todo, doing or done; a done card has no tag.
-- MINGLA-INVARIANT: I-4270-TAG-SURVIVES-STATUS | issue #4270 | changing status between todo and doing never clears the tag; only send_back, a person, or an agent with a reason clears it.
-- MINGLA-INVARIANT: I-4270-BOARD-ORDER | issue #4270 | open columns list the earliest due first (late on top); Done lists the latest due first.
--
--   M-MOVE    the one-time move (ops_4270_move_person_cards) puts every
--             status person card in To do with its tag, archived ones too;
--             bumps the revision; writes a history line; gives an unowned
--             card the person whose agent set it to Needs a person, else
--             the person whose agent made it, only when that person is an
--             active teammate; otherwise it stays without an owner; the
--             number of cards does not change; an undo of a change made
--             before the move is refused
--   M-GUARD   an agent closing or pushing back a tagged card (To do or In
--             progress) is refused with people_only; an untagged card it
--             owns still closes; a person marks a send card sent (closed,
--             tag gone) and sends a spend card back (To do, tag gone)
--   M-ALIAS   an agent's legacy status person + reason lands as To do with
--             the tag; without a reason it is refused; todo -> doing keeps
--             the tag; taking the tag off needs a reason from an agent
--   M-FILES   a person sets an https Files link; http is refused; the card
--             JSON carries files_url and tag
--   M-ORDER   ops_work_list: To do earliest due first, Done latest due
--             first; counts carry todo, doing, done, tagged, person (=
--             tagged), due_today and overdue; a person filter lists open
--             tagged cards; ops_my_counts carries due_today_mine,
--             needs_ok_mine, waiting_on_person_mine and overdue_mine
--   M-SHAPE   the table refuses status person and a tag on a done card
--
-- FAILS-ON-REVERT: with the old ops_close_rules (status = 'person'), the
-- agent's close of a tagged To do card goes through, so M-GUARD fails; with
-- the old ops_work_update the tag is cleared on todo -> doing, so M-ALIAS
-- fails; without the move function the whole suite stops.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tw_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tw_people (who, id, email) values
  ('owner',  '42700000-0000-4000-a0ee-000000000001', 'oona.w4270@test.local'),
  ('growth', '42700000-0000-4000-a0ee-000000000003', 'gia.w4270@test.local'),
  ('hal',    '42700000-0000-4000-a0ee-000000000004', 'hal.w4270@test.local'),
  ('leaver', '42700000-0000-4000-a0ee-000000000006', 'lou.w4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tw_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.w4270@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.w4270@test.local', 'growth', 'active', now()),
  ('hal.w4270@test.local', 'growth', 'active', now()),
  ('lou.w4270@test.local', 'growth', 'revoked', now());

create temp table tw_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tw_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.tw_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tw_people where who = p_who;
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

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.tw_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tw_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tw_next_request();
  return pg_temp.tw_as(p_who, p_sql);
end;
$fn$;

-- A connected agent calling a function directly, as the gateway does.
create function pg_temp.tw_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tw_next_request();
  select id, email into strict v_id, v_email from tw_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.tw_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tw_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tw_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tw_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tw_id(p_k text) returns uuid
language sql as $fn$ select id from tw_ids where k = p_k $fn$;

create function pg_temp.tw_rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tw_ids where k = p_k) $fn$;

create function pg_temp.tw_row(p_k text) returns text
language sql as $fn$
  select w.status || '/' || coalesce(w.person_reason, '-') from public.ops_work_cards w where w.id = (select id from tw_ids where k = p_k)
$fn$;

create function pg_temp.tw_owners(p_k text) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '<none>') from public.ops_work_people p
   where p.card_id = (select id from tw_ids where k = p_k) and p.role = 'owner'
$fn$;

-- One card, written directly (triggers off).
create function pg_temp.tw_card(p_key text, p_title text, p_status text, p_reason text, p_owner text, p_due_days integer,
                                p_created_by text default 'system@usemingla.com', p_created_via text default 'system',
                                p_closed interval default null, p_archived boolean default false) returns uuid
language plpgsql as $fn$
declare v_id uuid; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, person_reason, due_on, due_source, sprint_id,
    created_by, created_via, updated_by, closed_at, closed_by, close_kind, archived_at, archived_by, archive_reason)
  values (p_title, 'Do this task carefully and say what changed.', 'It is done and checked.', p_status, p_reason,
    v_today + p_due_days, 'explicit', public.ops_sprint_ensure(v_today + p_due_days),
    p_created_by, p_created_via, p_created_by,
    case when p_status = 'done' then now() - p_closed end, case when p_status = 'done' then 'gia.w4270@test.local' end,
    case when p_status = 'done' then 'done' end,
    case when p_archived then now() end, case when p_archived then 'oona.w4270@test.local' end, case when p_archived then 'Archived in the test.' end)
  returning id into v_id;
  if p_owner is not null then
    insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  end if;
  insert into tw_ids (k, id) values (p_key, v_id);
  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- M-MOVE: old-shape cards, written with the old status allowed, then moved.
-- ---------------------------------------------------------------------------
alter table public.ops_work_cards drop constraint ops_work_cards_status_check;
alter table public.ops_work_cards drop constraint ops_work_cards_tag_open;
set local session_replication_role = replica;
do $fixture$
declare v_id uuid;
begin
  perform pg_temp.tw_card('P1', 'T4270 Call the venue',        'person', 'send',    'gia.w4270@test.local', 1);
  perform pg_temp.tw_card('P2', 'T4270 Agent made it',         'person', 'spend',   null, 2, 'gia.w4270@test.local', 'claude');
  v_id := pg_temp.tw_card('P3', 'T4270 Agent set it',          'person', 'publish', null, 3);
  -- Hal's agent set P3 to Needs a person; an older event by Gia's agent did too.
  insert into public.ops_work_events (card_id, at, actor_email, via, action, after)
  values (v_id, now() - interval '2 days', 'gia.w4270@test.local', 'codex', 'status', '{"fields":{"status":"person"}}'),
         (v_id, now() - interval '1 day',  'hal.w4270@test.local', 'codex', 'status', '{"fields":{"status":"person"}}');
  perform pg_temp.tw_card('P4', 'T4270 Nobody to give it to',  'person', 'other',   null, 4);
  perform pg_temp.tw_card('P5', 'T4270 Archived person card',  'person', 'publish', 'gia.w4270@test.local', 5, p_archived => true);
  perform pg_temp.tw_card('P6', 'T4270 Made by a leaver',      'person', 'send',    null, 6, 'lou.w4270@test.local', 'claude');
  perform pg_temp.tw_card('P7', 'T4270 Already todo',          'todo',   null,      'gia.w4270@test.local', 7);
  -- A change Gia made to P1 just before the move, still inside the undo window.
  insert into public.ops_work_events (card_id, at, actor_email, via, action, before, after, from_revision, to_revision)
  values (pg_temp.tw_id('P1'), clock_timestamp(), 'gia.w4270@test.local', null, 'updated',
          public.ops_card_snapshot(pg_temp.tw_id('P1')), public.ops_card_snapshot(pg_temp.tw_id('P1')), 1, 1);
end;
$fixture$;
set local session_replication_role = origin;

create temp table tw_before on commit drop as
  select count(*) as n from public.ops_work_cards;

do $move$
declare v jsonb;
begin
  v := public.ops_4270_move_person_cards();
  perform pg_temp.tw_check('M-MOVE', 'the move reports its counts', v::text,
    '{"moved": 6, "owned": 2, "no_owner": 2, "given_owner": 2}');
end;
$move$;

-- The new checks go back on and hold for every moved row.
alter table public.ops_work_cards add constraint ops_work_cards_status_check check (status in ('todo','doing','done'));
alter table public.ops_work_cards add constraint ops_work_cards_tag_open check (person_reason is null or status <> 'done');

do $moved$
declare v text;
begin
  perform pg_temp.tw_check('M-MOVE', 'no card keeps the person status',
    (select count(*) from public.ops_work_cards where status = 'person')::text, '0');
  perform pg_temp.tw_check('M-MOVE', 'the number of cards is unchanged',
    (select count(*) from public.ops_work_cards)::text, (select n from tw_before)::text);
  perform pg_temp.tw_check('M-MOVE', 'every moved card is in To do with its tag',
    pg_temp.tw_row('P1') || ' ' || pg_temp.tw_row('P2') || ' ' || pg_temp.tw_row('P3') || ' ' || pg_temp.tw_row('P4') || ' '
      || pg_temp.tw_row('P5') || ' ' || pg_temp.tw_row('P6'),
    'todo/send todo/spend todo/publish todo/other todo/publish todo/send');
  perform pg_temp.tw_check('M-MOVE', 'a card already in To do is left alone', pg_temp.tw_row('P7') || ' rev ' || pg_temp.tw_rev('P7'), 'todo/- rev 1');
  perform pg_temp.tw_check('M-MOVE', 'each moved card went up one revision',
    pg_temp.tw_rev('P1') || ',' || pg_temp.tw_rev('P4') || ',' || pg_temp.tw_rev('P5'), '2,2,2');
  perform pg_temp.tw_check('M-MOVE', 'an owned card keeps its owner', pg_temp.tw_owners('P1'), 'gia.w4270@test.local');
  perform pg_temp.tw_check('M-MOVE', 'an agent-made card goes to the person whose agent made it', pg_temp.tw_owners('P2'), 'gia.w4270@test.local');
  perform pg_temp.tw_check('M-MOVE', 'an agent-tagged card goes to the person whose agent tagged it last', pg_temp.tw_owners('P3'), 'hal.w4270@test.local');
  perform pg_temp.tw_check('M-MOVE', 'with nobody to give it to, it has no owner', pg_temp.tw_owners('P4'), '<none>');
  perform pg_temp.tw_check('M-MOVE', 'a revoked teammate is never made owner', pg_temp.tw_owners('P6'), '<none>');
  perform pg_temp.tw_check('M-MOVE', 'the given owner is added by Mingla',
    (select p.added_by || '/' || coalesce(p.added_via, '-') from public.ops_work_people p where p.card_id = pg_temp.tw_id('P2') and p.role = 'owner'),
    'system@usemingla.com/-');
  perform pg_temp.tw_check('M-MOVE', 'each moved card has one history line saying so',
    (select count(*) from public.ops_work_events e where e.card_id in (select id from tw_ids) and e.actor_email = 'system@usemingla.com'
        and e.via = 'system' and e.action = 'status' and e.body like 'Moved to To do. It keeps its % tag (#4270).')::text, '6');
  perform pg_temp.tw_check('M-MOVE', 'the history line names the tag',
    (select e.body from public.ops_work_events e where e.card_id = pg_temp.tw_id('P4') and e.actor_email = 'system@usemingla.com'),
    'Moved to To do. It keeps its Needs your OK tag (#4270).');
  perform pg_temp.tw_check('M-MOVE', 'the history line keeps the before and after',
    (select (e.before->'fields'->>'status') || '>' || (e.after->'fields'->>'status') from public.ops_work_events e
      where e.card_id = pg_temp.tw_id('P1') and e.actor_email = 'system@usemingla.com'), 'person>todo');
  perform pg_temp.tw_like('M-MOVE', 'the agent log has one summary',
    (select summary from public.ops_agent_log where actor_email = 'system@usemingla.com' and detail->>'issue' = '4270' order by id desc limit 1),
    'Moved 6 cards to To do with their Send, Spend or Publish tag (#4270): 2 had an owner, 2 got one, 2 have no owner.');
  v := pg_temp.tw_person('growth', format('select public.ops_work_undo(%L)::text',
    (select e.id from public.ops_work_events e where e.card_id = pg_temp.tw_id('P1') and e.actor_email = 'gia.w4270@test.local')));
  perform pg_temp.tw_like('M-MOVE', 'an undo of a change made before the move is refused', v, 'ERR:22023:undo_expired:%');
  perform pg_temp.tw_check('M-MOVE', 'and P1 stays in To do with its tag', pg_temp.tw_row('P1'), 'todo/send');
  perform pg_temp.tw_check('M-MOVE', 'a second run moves nothing', public.ops_4270_move_person_cards()::text,
    '{"moved": 0, "owned": 0, "no_owner": 0, "given_owner": 0}');
end;
$moved$;

-- ---------------------------------------------------------------------------
-- M-GUARD, M-ALIAS, M-FILES
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
do $fixture2$
begin
  perform pg_temp.tw_card('G1', 'T4270 Tagged to do',       'todo',  'send',  'gia.w4270@test.local', 1);
  perform pg_temp.tw_card('G2', 'T4270 Tagged in progress', 'doing', 'spend', 'gia.w4270@test.local', 1);
  perform pg_temp.tw_card('G3', 'T4270 Plain to do',        'todo',  null,    'gia.w4270@test.local', 1);
  perform pg_temp.tw_card('G4', 'T4270 Agent hands it over','todo',  null,    'gia.w4270@test.local', 1);
  perform pg_temp.tw_card('G5', 'T4270 Files link card',    'todo',  null,    'gia.w4270@test.local', 1);
end;
$fixture2$;
set local session_replication_role = origin;

do $guard$
declare v text;
begin
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Sent it"}]'::jsonb, NULL, %s)::text$q$,
    pg_temp.tw_id('G1'), pg_temp.tw_rev('G1')));
  perform pg_temp.tw_like('M-GUARD', 'an agent cannot close a tagged To do card', v, 'ERR:42501:people_only: A person does this card''s Send, Spend or Publish step and closes it.%');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Paid it"}]'::jsonb, NULL, %s)::text$q$,
    pg_temp.tw_id('G2'), pg_temp.tw_rev('G2')));
  perform pg_temp.tw_like('M-GUARD', 'an agent cannot close a tagged In progress card', v, 'ERR:42501:people_only:%');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_push_back(%L, 'already_done', 'It was already sent last week.', '[{"kind":"text","text":"Sent before"}]'::jsonb, %s)::text$q$,
    pg_temp.tw_id('G1'), pg_temp.tw_rev('G1')));
  perform pg_temp.tw_like('M-GUARD', 'an agent cannot push back a tagged card as already done', v, 'ERR:42501:people_only:%');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_push_back(%L, 'declined', 'This should not be paid for now.', NULL, %s)::text$q$,
    pg_temp.tw_id('G2'), pg_temp.tw_rev('G2')));
  perform pg_temp.tw_like('M-GUARD', 'an agent cannot decline a tagged card', v, 'ERR:42501:people_only:%');
  perform pg_temp.tw_check('M-GUARD', 'both tagged cards are still open with their tags', pg_temp.tw_row('G1') || ' ' || pg_temp.tw_row('G2'), 'todo/send doing/spend');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Did it"}]'::jsonb, NULL, %s)::text$q$,
    pg_temp.tw_id('G3'), pg_temp.tw_rev('G3')));
  perform pg_temp.tw_check('M-GUARD', 'an agent still closes an untagged card it owns', coalesce(pg_temp.tw_j(v) #>> '{card,status}', v), 'done');
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.tw_id('G1'), pg_temp.tw_rev('G1')));
  perform pg_temp.tw_check('M-GUARD', 'a person marks a tagged To do card sent: it closes and the tag goes', coalesce(pg_temp.tw_row('G1'), v), 'done/-');
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_person_action(%L, 'send_back', 'Change the amount first.', %s)::text$q$, pg_temp.tw_id('G2'), pg_temp.tw_rev('G2')));
  perform pg_temp.tw_check('M-GUARD', 'a person sends a tagged In progress card back: To do, tag gone', coalesce(pg_temp.tw_row('G2'), v), 'todo/-');
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.tw_id('G2'), pg_temp.tw_rev('G2')));
  perform pg_temp.tw_like('M-GUARD', 'a card without a tag has no person action', v, 'ERR:22023:wrong_action: This card has no Send, Spend or Publish tag.%');

  -- M-ALIAS
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_update(%L, '{"status":"person"}'::jsonb, %s)::text$q$, pg_temp.tw_id('G4'), pg_temp.tw_rev('G4')));
  perform pg_temp.tw_like('M-ALIAS', 'the legacy status person without a reason is refused', v, 'ERR:22023:invalid_card: A Send, Spend or Publish tag must say which%');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"publish"}'::jsonb, %s)::text$q$, pg_temp.tw_id('G4'), pg_temp.tw_rev('G4')));
  perform pg_temp.tw_check('M-ALIAS', 'the legacy status person lands as To do with the tag',
    coalesce((pg_temp.tw_j(v) #>> '{card,status}') || '/' || (pg_temp.tw_j(v) #>> '{card,tag}'), v), 'todo/publish');
  perform pg_temp.tw_check('M-ALIAS', 'the agent log says it is tagged for a person',
    (select count(*) from public.ops_agent_log where card_id = pg_temp.tw_id('G4') and action = 'needs_person')::text, '1');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_update(%L, '{"status":"doing"}'::jsonb, %s)::text$q$, pg_temp.tw_id('G4'), pg_temp.tw_rev('G4')));
  perform pg_temp.tw_check('M-ALIAS', 'todo -> doing keeps the tag', coalesce(pg_temp.tw_row('G4'), v), 'doing/publish');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_update(%L, '{"status":"todo"}'::jsonb, %s)::text$q$, pg_temp.tw_id('G4'), pg_temp.tw_rev('G4')));
  perform pg_temp.tw_check('M-ALIAS', 'doing -> todo keeps the tag', coalesce(pg_temp.tw_row('G4'), v), 'todo/publish');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_update(%L, '{"person_reason":null}'::jsonb, %s)::text$q$, pg_temp.tw_id('G4'), pg_temp.tw_rev('G4')));
  perform pg_temp.tw_like('M-ALIAS', 'an agent taking the tag off must say why', v, 'ERR:22023:reason_required:%');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_update(%L, '{"person_reason":null,"reason":"The host published it themselves."}'::jsonb, %s)::text$q$, pg_temp.tw_id('G4'), pg_temp.tw_rev('G4')));
  perform pg_temp.tw_check('M-ALIAS', 'with a reason the tag comes off', coalesce(pg_temp.tw_row('G4'), v), 'todo/-');
  v := pg_temp.tw_agent('growth', format($q$select public.ops_work_update(%L, '{"status":"done"}'::jsonb, %s)::text$q$, pg_temp.tw_id('G4'), pg_temp.tw_rev('G4')));
  perform pg_temp.tw_like('M-ALIAS', 'status done is not a change; closing needs proof', v, 'ERR:22023:invalid_card: Status can be todo or doing.%');

  -- M-FILES
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_update(%L, '{"files_url":"https://drive.example.com/folder/abc"}'::jsonb, %s)::text$q$, pg_temp.tw_id('G5'), pg_temp.tw_rev('G5')));
  perform pg_temp.tw_check('M-FILES', 'a person sets an https Files link', coalesce(pg_temp.tw_j(v) #>> '{card,files_url}', v), 'https://drive.example.com/folder/abc');
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_update(%L, '{"files_url":"http://drive.example.com/folder/abc"}'::jsonb, %s)::text$q$, pg_temp.tw_id('G5'), pg_temp.tw_rev('G5')));
  perform pg_temp.tw_like('M-FILES', 'an http link is refused', v, 'ERR:22023:invalid_card: Links start with https://%');
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_update(%L, '{"files_url":""}'::jsonb, %s)::text$q$, pg_temp.tw_id('G5'), pg_temp.tw_rev('G5')));
  perform pg_temp.tw_check('M-FILES', 'an empty link clears it', coalesce(pg_temp.tw_j(v) #>> '{card,files_url}', '<null>'), '<null>');
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_add('[{"title":"T4270 Added with files","instructions":"Make the flyer and upload it.","done_means":"The flyer is uploaded.","owners":["gia.w4270@test.local"],"due_on":"%s","files_url":"https://files.example.com/x"}]'::jsonb, 'r4270-add-files-1')::text$q$, (now() AT TIME ZONE 'UTC')::date + 3));
  perform pg_temp.tw_check('M-FILES', 'a card added with a Files link keeps it',
    coalesce(pg_temp.tw_j(v) #>> '{results,0,card,files_url}', v), 'https://files.example.com/x');
  v := pg_temp.tw_person('growth', format($q$select public.ops_work_add('[{"title":"T4270 Added tagged","instructions":"Send the host the reminder.","done_means":"The reminder is sent.","owners":["gia.w4270@test.local"],"due_on":"%s","person_reason":"send"}]'::jsonb, 'r4270-add-tag-1')::text$q$, (now() AT TIME ZONE 'UTC')::date + 3));
  perform pg_temp.tw_check('M-FILES', 'a card added with a tag lands in To do with it',
    coalesce((pg_temp.tw_j(v) #>> '{results,0,card,status}') || '/' || (pg_temp.tw_j(v) #>> '{results,0,card,tag}'), v), 'todo/send');
end;
$guard$;

-- ---------------------------------------------------------------------------
-- M-ORDER: Oona's own cards, so the list is only these.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
do $fixture3$
begin
  perform pg_temp.tw_card('O1', 'T4270 Due in three days', 'todo',  null,   'oona.w4270@test.local', 3);
  perform pg_temp.tw_card('O2', 'T4270 Two days late',     'todo',  null,   'oona.w4270@test.local', -2);
  perform pg_temp.tw_card('O3', 'T4270 Due today',         'todo',  'send', 'oona.w4270@test.local', 0);
  perform pg_temp.tw_card('O4', 'T4270 Doing tomorrow',    'doing', null,   'oona.w4270@test.local', 1);
  perform pg_temp.tw_card('O5', 'T4270 Done due earlier',  'done',  null,   'oona.w4270@test.local', -3, p_closed => interval '1 day');
  perform pg_temp.tw_card('O6', 'T4270 Done due later',    'done',  null,   'oona.w4270@test.local', 2, p_closed => interval '2 days');
end;
$fixture3$;
set local session_replication_role = origin;

do $order$
declare v jsonb; v_c jsonb;
begin
  v := pg_temp.tw_j(pg_temp.tw_person('owner', $q$select public.ops_work_list('{"owner":"oona.w4270@test.local"}'::jsonb)::text$q$));
  perform pg_temp.tw_check('M-ORDER', 'To do earliest due first, then In progress, then Done latest due first',
    (select string_agg(c->>'title', '|' order by o) from jsonb_array_elements(v->'cards') with ordinality t(c, o)),
    'T4270 Two days late|T4270 Due today|T4270 Due in three days|T4270 Doing tomorrow|T4270 Done due later|T4270 Done due earlier');
  v_c := v->'counts';
  perform pg_temp.tw_check('M-ORDER', 'counts carry the three columns and what is due',
    format('todo=%s doing=%s done=%s tagged=%s person=%s due_today=%s overdue=%s', v_c->>'todo', v_c->>'doing', v_c->>'done',
      v_c->>'tagged', v_c->>'person', v_c->>'due_today', v_c->>'overdue'),
    'todo=3 doing=1 done=2 tagged=1 person=1 due_today=1 overdue=1');
  v := pg_temp.tw_j(pg_temp.tw_person('owner', $q$select public.ops_work_list('{"owner":"oona.w4270@test.local","status":["person"]}'::jsonb)::text$q$));
  perform pg_temp.tw_check('M-ORDER', 'a person filter lists the open tagged cards',
    (select string_agg(c->>'title', '|' order by o) from jsonb_array_elements(v->'cards') with ordinality t(c, o)), 'T4270 Due today');
  v := pg_temp.tw_j(pg_temp.tw_person('owner', 'select public.ops_my_counts(NULL)::text'));
  perform pg_temp.tw_check('M-ORDER', 'my counts: due today, overdue, needs your OK and the old key',
    format('due_today_mine=%s overdue_mine=%s needs_ok_mine=%s waiting_on_person_mine=%s open_mine=%s',
      v->>'due_today_mine', v->>'overdue_mine', v->>'needs_ok_mine', v->>'waiting_on_person_mine', v->>'open_mine'),
    'due_today_mine=1 overdue_mine=1 needs_ok_mine=1 waiting_on_person_mine=1 open_mine=4');
  v := pg_temp.tw_j(pg_temp.tw_person('owner', 'select public.ops_config(NULL)::text'));
  perform pg_temp.tw_check('M-ORDER', 'the statuses are To do, In progress and Done',
    (select string_agg(s->>'label', ',' order by o) from jsonb_array_elements(v->'statuses') with ordinality t(s, o)), 'To do,In progress,Done');
end;
$order$;

-- ---------------------------------------------------------------------------
-- M-SHAPE
-- ---------------------------------------------------------------------------
do $shape$
declare v text;
begin
  begin
    update public.ops_work_cards set status = 'person' where id = pg_temp.tw_id('O1');
    v := 'accepted';
  exception when check_violation then v := 'refused';
  end;
  perform pg_temp.tw_check('M-SHAPE', 'the table refuses status person', v, 'refused');
  begin
    update public.ops_work_cards set person_reason = 'send' where id = pg_temp.tw_id('O5');
    v := 'accepted';
  exception when check_violation then v := 'refused';
  end;
  perform pg_temp.tw_check('M-SHAPE', 'the table refuses a tag on a done card', v, 'refused');
  perform pg_temp.tw_check('M-SHAPE', 'no client can run the one-time move',
    (has_function_privilege('authenticated', 'public.ops_4270_move_person_cards()', 'EXECUTE')
      or has_function_privilege('anon', 'public.ops_4270_move_person_cards()', 'EXECUTE')
      or has_function_privilege('service_role', 'public.ops_4270_move_person_cards()', 'EXECUTE'))::text, 'false');
end;
$shape$;

select count(*) as tw_total, count(*) filter (where not ok) as tw_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tw_failures
  from tw_results \gset
rollback;

select (:tw_total < 49 or :tw_failed > 0) as tw_bad \gset
\if :tw_bad
  \echo 'ISSUE-4270 W1 FAILED:' :tw_failed 'of' :tw_total
  \echo :tw_failures
  do $$ begin raise exception 'ISSUE-4270 W1 FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W1 PASS:' :tw_total 'checks, 0 failed'
