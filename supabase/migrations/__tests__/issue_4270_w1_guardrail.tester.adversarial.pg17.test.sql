-- Issue #4270 (Wave 1) -- tester adversarial suite for
-- 20280427004270_issue_4270_w1_work_board_three_columns.sql, on the fully
-- replayed PG17 schema. It attacks angles the implementor's happy path does
-- not:
--
--   X-AGENT    every way an agent could close, push back, untag or move a
--              tagged card: start then close, start then decline, the old
--              "status todo + reason" untag, an empty tag, a blank or
--              control-character reason, status done, the person actions,
--              undo, the legacy status person on an In progress card, and a
--              roadmap approval card through the alias
--   X-AUTO     the automatic writers: ops_auto_card_upsert keeps a tag in
--              To do and refuses a status; ops_auto_card_close clears the
--              tag when it closes; a person may still close or reopen
--   X-UNDO     undo after the move: an event whose before-snapshot still
--              says status person restores To do with the tag (never the
--              retired status); undoing a Mark sent brings the tag back on
--              an open card; undoing a tag removes it
--   X-DONE     a done card can never carry a tag, by any path
--   X-ARCH     an archived tagged card is on no list, no count and takes no
--              person action
--   X-NOOWNER  a tagged card with no owner: To review shows it to admins
--              only; the move hands it to an active teammate, skipping a
--              revoked one, and a watcher who becomes owner keeps one row
--   X-REV      stale and missing revisions are PT409 (never 40001) on every
--              write path; a repeated request key writes once
--   X-FILES    http, javascript:, no host, inner spaces (incl. a no-break space), a newline, 2,001
--              characters, upper-case scheme, a number, a direct table write
--              and an add are refused; exactly 2,000 characters and a padded
--              link are kept
--   X-CAP      the 200-card default and the 300 cap: truncated and total are
--              honest, 301 is refused
--   X-SORT     ties: open cards on the same day by card number (not title);
--              Done on the same day latest closed first, then card number
--   X-WINDOW   Done is this sprint week (#4270 rework P3-3): closed since
--              Monday 00:00 in tz (UTC by default; an unknown zone is UTC);
--              done_days 0 shows none
--   X-ALIAS    the person status filter, alone and mixed, is case-exact; a
--              repeated alias is no change
--
-- FAILS-ON-REVERT (tester, recorded in the #4270 W1 test report):
--   * old ops_work_undo (status = r.status)    -> X-UNDO fails (check violation)
--   * old ops_close_rules (status = 'person')  -> X-AGENT fails (agent closes)
--   * files_url check / validation removed      -> X-FILES fails
--   * old ops_work_list order (all ascending)   -> X-SORT fails
--
-- Run from the repository root. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('boss',  '42700000-0000-4000-a0ff-000000000001', 'boss.x4270@test.local'),
  ('gia',   '42700000-0000-4000-a0ff-000000000002', 'gia.x4270@test.local'),
  ('hal',   '42700000-0000-4000-a0ff-000000000003', 'hal.x4270@test.local'),
  ('lou',   '42700000-0000-4000-a0ff-000000000004', 'lou.x4270@test.local'),
  ('cap',   '42700000-0000-4000-a0ff-000000000005', 'cap.x4270@test.local'),
  ('tie',   '42700000-0000-4000-a0ff-000000000006', 'tie.x4270@test.local'),
  ('win',   '42700000-0000-4000-a0ff-000000000007', 'win.x4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('boss.x4270@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.x4270@test.local', 'growth', 'active', now()),
  ('hal.x4270@test.local', 'growth', 'active', now()),
  ('lou.x4270@test.local', 'growth', 'revoked', now()),
  ('cap.x4270@test.local', 'growth', 'active', now()),
  ('tie.x4270@test.local', 'growth', 'active', now()),
  ('win.x4270@test.local', 'growth', 'active', now());

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.tx_as(p_who text, p_sql text) returns text
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

create function pg_temp.tx_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tx_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tx_next_request();
  return pg_temp.tx_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tx_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tx_next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'codex', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.tx_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tx_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tx_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tx_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tx_id(p_k text) returns uuid
language sql as $fn$ select id from tx_ids where k = p_k $fn$;

create function pg_temp.tx_rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tx_ids where k = p_k) $fn$;

create function pg_temp.tx_row(p_k text) returns text
language sql as $fn$
  select w.status || '/' || coalesce(w.person_reason, '-') from public.ops_work_cards w where w.id = (select id from tx_ids where k = p_k)
$fn$;

create function pg_temp.tx_email(p_who text) returns text
language sql as $fn$ select email from tx_people where who = p_who $fn$;

-- One card written directly (triggers off). p_due_days is from ops_today.
create function pg_temp.tx_card(p_key text, p_title text, p_status text, p_reason text, p_owner text, p_due_days integer,
                                p_created_by text default 'system@usemingla.com', p_created_via text default 'system',
                                p_closed interval default null, p_archived boolean default false,
                                p_auto_key text default null) returns uuid
language plpgsql as $fn$
declare v_id uuid; v_today date := public.ops_today(NULL);
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, person_reason, due_on, due_source, sprint_id,
    created_by, created_via, updated_by, closed_at, closed_by, close_kind, archived_at, archived_by, archive_reason, auto_key)
  values (p_title, 'Do this task carefully and say what changed.', 'It is done and checked.', p_status, p_reason,
    v_today + p_due_days, 'explicit', public.ops_sprint_ensure(v_today + p_due_days),
    p_created_by, p_created_via, p_created_by,
    case when p_status = 'done' then now() - p_closed end, case when p_status = 'done' then 'gia.x4270@test.local' end,
    case when p_status = 'done' then 'done' end,
    case when p_archived then now() end, case when p_archived then 'boss.x4270@test.local' end, case when p_archived then 'Archived in the test.' end,
    p_auto_key)
  returning id into v_id;
  if p_owner is not null then
    insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  end if;
  insert into tx_ids (k, id) values (p_key, v_id);
  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- X-NOOWNER (move): old-shape cards that the implementor's fixtures do not
-- cover, moved by the one-time function.
-- ---------------------------------------------------------------------------
alter table public.ops_work_cards drop constraint ops_work_cards_status_check;
alter table public.ops_work_cards drop constraint ops_work_cards_tag_open;
set local session_replication_role = replica;
do $fx_move$
declare v_id uuid;
begin
  -- Hal's agent made it, Hal watches it and Hal's agent is still working it.
  v_id := pg_temp.tx_card('MW', 'X4270 Watcher becomes owner', 'person', 'send', null, 1, 'hal.x4270@test.local', 'claude');
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, 'hal.x4270@test.local', 'watcher', 'hal.x4270@test.local');
  update public.ops_work_cards set working_by = 'hal.x4270@test.local', working_via = 'claude', working_seen_at = now() where id = v_id;
  -- The latest agent to tag it is a revoked teammate; an older one is active.
  v_id := pg_temp.tx_card('MR', 'X4270 Latest tagger left', 'person', 'spend', null, 2);
  insert into public.ops_work_events (card_id, at, actor_email, via, action, after)
  values (v_id, now() - interval '3 days', 'gia.x4270@test.local', 'claude', 'status', '{"fields":{"status":"person"}}'),
         (v_id, now() - interval '1 day',  'lou.x4270@test.local', 'claude', 'status', '{"fields":{"status":"person"}}');
  -- A person (no via) tagged it; a person's status change is never an agent's.
  v_id := pg_temp.tx_card('MP', 'X4270 A person tagged it', 'person', 'other', null, 3);
  insert into public.ops_work_events (card_id, at, actor_email, via, action, after)
  values (v_id, now() - interval '1 day', 'gia.x4270@test.local', null, 'status', '{"fields":{"status":"person"}}');
  -- An agent event that left Needs a person (after status todo) does not count.
  v_id := pg_temp.tx_card('MT', 'X4270 Agent moved it out', 'person', 'publish', null, 4);
  insert into public.ops_work_events (card_id, at, actor_email, via, action, after)
  values (v_id, now() - interval '1 day', 'hal.x4270@test.local', 'codex', 'status', '{"fields":{"status":"todo"}}');
end;
$fx_move$;
set local session_replication_role = origin;

do $move$
begin
  perform public.ops_4270_move_person_cards();
end;
$move$;
alter table public.ops_work_cards add constraint ops_work_cards_status_check check (status in ('todo','doing','done'));
alter table public.ops_work_cards add constraint ops_work_cards_tag_open check (person_reason is null or status <> 'done');

do $moved$
begin
  perform pg_temp.tx_check('X-NOOWNER', 'a watcher who becomes owner keeps exactly one row, as owner',
    (select string_agg(p.email || ':' || p.role, ',') from public.ops_work_people p where p.card_id = pg_temp.tx_id('MW')),
    'hal.x4270@test.local:owner');
  perform pg_temp.tx_check('X-NOOWNER', 'the move ends the working mark',
    (select coalesce(working_by, '-') || '/' || coalesce(working_via, '-') || '/' || coalesce(working_seen_at::text, '-')
       from public.ops_work_cards where id = pg_temp.tx_id('MW')), '-/-/-');
  perform pg_temp.tx_check('X-NOOWNER', 'a revoked latest tagger is skipped for the active earlier one',
    (select string_agg(p.email, ',') from public.ops_work_people p where p.card_id = pg_temp.tx_id('MR') and p.role = 'owner'),
    'gia.x4270@test.local');
  perform pg_temp.tx_check('X-NOOWNER', 'a person''s own status change hands nobody the card',
    (select count(*) from public.ops_work_people p where p.card_id = pg_temp.tx_id('MP'))::text, '0');
  perform pg_temp.tx_check('X-NOOWNER', 'an agent event that set another status hands nobody the card',
    (select count(*) from public.ops_work_people p where p.card_id = pg_temp.tx_id('MT'))::text, '0');
  perform pg_temp.tx_check('X-NOOWNER', 'all four kept their tags in To do',
    pg_temp.tx_row('MW') || ' ' || pg_temp.tx_row('MR') || ' ' || pg_temp.tx_row('MP') || ' ' || pg_temp.tx_row('MT'),
    'todo/send todo/spend todo/other todo/publish');
end;
$moved$;

-- ---------------------------------------------------------------------------
-- Fixtures for the rest (new shape only).
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
do $fx$
begin
  perform pg_temp.tx_card('A1', 'X4270 Agent starts then closes',    'todo',  'send',    'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('A2', 'X4270 Agent old untag',             'doing', 'spend',   'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('A3', 'X4270 Agent bad untags',            'todo',  'publish', 'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('A4', 'X4270 Agent alias on doing',        'doing', null,      'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('A5', 'X4270 Roadmap approval card',       'todo',  'other',   'gia.x4270@test.local', 1,
                          p_auto_key => 'roadmap_shipped:00000000-0000-4000-a0ff-0000000000aa');
  perform pg_temp.tx_card('A6', 'X4270 Person closes tagged',        'doing', 'other',   'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('A7', 'X4270 Auto card with tag',          'todo',  'send',    'gia.x4270@test.local', 1,
                          p_auto_key => 'x_test:auto-close-1');
  perform pg_temp.tx_card('U1', 'X4270 Undo old snapshot',           'todo',  null,      'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('U2', 'X4270 Undo mark sent',              'todo',  'send',    'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('U3', 'X4270 Undo a tag',                  'todo',  null,      'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('D1', 'X4270 Done card',                   'done',  null,      'gia.x4270@test.local', -1, p_closed => interval '1 hour');
  perform pg_temp.tx_card('R1', 'X4270 Archived tagged',             'todo',  'send',    'gia.x4270@test.local', 0, p_archived => true);
  perform pg_temp.tx_card('N1', 'X4270 No owner tagged',             'todo',  'spend',   null, 2);
  perform pg_temp.tx_card('V1', 'X4270 Revision card',               'todo',  'send',    'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('V2', 'X4270 Revision plain',              'todo',  null,      'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('F1', 'X4270 Files card',                  'todo',  null,      'gia.x4270@test.local', 1);
  perform pg_temp.tx_card('L1', 'X4270 Alias filter tagged doing',   'doing', 'publish', 'hal.x4270@test.local', 1);
  perform pg_temp.tx_card('L2', 'X4270 Alias filter plain',          'todo',  null,      'hal.x4270@test.local', 1);
  perform pg_temp.tx_card('L3', 'X4270 Alias filter done',           'done',  null,      'hal.x4270@test.local', 0, p_closed => interval '1 hour');
end;
$fx$;
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- X-AGENT
-- ---------------------------------------------------------------------------
do $agent$
declare v text;
begin
  -- start, then close or decline
  v := pg_temp.tx_agent('gia', format('select public.ops_work_start(%L, %s)::text', pg_temp.tx_id('A1'), pg_temp.tx_rev('A1')));
  perform pg_temp.tx_check('X-AGENT', 'an agent may start a tagged card and the tag survives', pg_temp.tx_row('A1'), 'doing/send');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"I sent it to the host."}]'::jsonb, 'Sent.', %s)::text$q$,
    pg_temp.tx_id('A1'), pg_temp.tx_rev('A1')));
  perform pg_temp.tx_like('X-AGENT', 'after starting it, the agent still cannot close it', v, 'ERR:42501:people_only:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_push_back(%L, 'declined', 'Not needed any more, the host replied.', NULL, %s)::text$q$,
    pg_temp.tx_id('A1'), pg_temp.tx_rev('A1')));
  perform pg_temp.tx_like('X-AGENT', 'nor decline it while In progress', v, 'ERR:42501:people_only:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.tx_id('A1'), pg_temp.tx_rev('A1')));
  perform pg_temp.tx_like('X-AGENT', 'nor use the person''s Mark sent', v, 'ERR:42501:people_only:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_person_action(%L, 'send_back', 'Change the copy first please.', %s)::text$q$, pg_temp.tx_id('A1'), pg_temp.tx_rev('A1')));
  perform pg_temp.tx_like('X-AGENT', 'nor the person''s Send back', v, 'ERR:42501:people_only:%');
  perform pg_temp.tx_check('X-AGENT', 'the started card is still In progress with its tag', pg_temp.tx_row('A1'), 'doing/send');

  -- the old Wave 2 way of leaving Needs a person no longer untags
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"status":"todo","reason":"The host said no need."}'::jsonb, %s)::text$q$,
    pg_temp.tx_id('A2'), pg_temp.tx_rev('A2')));
  perform pg_temp.tx_check('X-AGENT', 'status todo with a reason moves the card but keeps the tag', pg_temp.tx_row('A2'), 'todo/spend');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Paid."}]'::jsonb, NULL, %s)::text$q$,
    pg_temp.tx_id('A2'), pg_temp.tx_rev('A2')));
  perform pg_temp.tx_like('X-AGENT', 'so the agent still cannot close it', v, 'ERR:42501:people_only:%');

  -- bad ways to take the tag off
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"person_reason":""}'::jsonb, %s)::text$q$, pg_temp.tx_id('A3'), pg_temp.tx_rev('A3')));
  perform pg_temp.tx_like('X-AGENT', 'an empty tag is refused', v, 'ERR:22023:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"person_reason":"","reason":"The host did it."}'::jsonb, %s)::text$q$, pg_temp.tx_id('A3'), pg_temp.tx_rev('A3')));
  perform pg_temp.tx_like('X-AGENT', 'an empty tag with a reason is still refused, not read as no tag', v, 'ERR:22023:invalid_card:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"person_reason":null,"reason":"    "}'::jsonb, %s)::text$q$, pg_temp.tx_id('A3'), pg_temp.tx_rev('A3')));
  perform pg_temp.tx_like('X-AGENT', 'a blank reason is no reason', v, 'ERR:22023:reason_required:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, jsonb_build_object('person_reason', null, 'reason', 'ok' || chr(7) || ' fine'), %s)::text$q$, pg_temp.tx_id('A3'), pg_temp.tx_rev('A3')));
  perform pg_temp.tx_like('X-AGENT', 'a reason with a control character is no reason', v, 'ERR:22023:reason_required:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"person_reason":null,"reason":7}'::jsonb, %s)::text$q$, pg_temp.tx_id('A3'), pg_temp.tx_rev('A3')));
  perform pg_temp.tx_like('X-AGENT', 'a reason that is not text is no reason', v, 'ERR:22023:reason_required:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"status":"done"}'::jsonb, %s)::text$q$, pg_temp.tx_id('A3'), pg_temp.tx_rev('A3')));
  perform pg_temp.tx_like('X-AGENT', 'status done is refused', v, 'ERR:22023:invalid_card:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"status":"Person","person_reason":"send"}'::jsonb, %s)::text$q$, pg_temp.tx_id('A3'), pg_temp.tx_rev('A3')));
  perform pg_temp.tx_like('X-AGENT', 'the alias is exact: Person is refused', v, 'ERR:22023:invalid_card:%');
  perform pg_temp.tx_check('X-AGENT', 'after every refusal the card keeps its tag and revision', pg_temp.tx_row('A3') || ' rev ' || pg_temp.tx_rev('A3'), 'todo/publish rev 1');
  v := pg_temp.tx_agent('gia', (select format('select public.ops_work_undo(%L)::text', e.id) from public.ops_work_events e where e.card_id = pg_temp.tx_id('A2') order by e.at desc limit 1));
  perform pg_temp.tx_like('X-AGENT', 'an agent cannot undo', v, 'ERR:42501:people_only:%');

  -- the legacy alias on an In progress card puts it in To do and ends the working mark
  update public.ops_work_cards set working_by = 'gia.x4270@test.local', working_via = 'codex', working_seen_at = now() where id = pg_temp.tx_id('A4');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"spend"}'::jsonb, %s)::text$q$, pg_temp.tx_id('A4'), pg_temp.tx_rev('A4')));
  perform pg_temp.tx_check('X-AGENT', 'status person on an In progress card: To do with the tag, nobody working it',
    (select status || '/' || coalesce(person_reason, '-') || '/' || coalesce(working_by, '-') from public.ops_work_cards where id = pg_temp.tx_id('A4')),
    'todo/spend/-');

  -- roadmap approval card: the alias, a start and an untag are all refused
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"send"}'::jsonb, %s)::text$q$, pg_temp.tx_id('A5'), pg_temp.tx_rev('A5')));
  perform pg_temp.tx_like('X-AGENT', 'roadmap card: the alias cannot swap its tag', v, 'ERR:42501:people_only:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"status":"doing"}'::jsonb, %s)::text$q$, pg_temp.tx_id('A5'), pg_temp.tx_rev('A5')));
  perform pg_temp.tx_like('X-AGENT', 'roadmap card: an agent cannot move it', v, 'ERR:42501:people_only:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"person_reason":null,"reason":"Hosts were already told."}'::jsonb, %s)::text$q$, pg_temp.tx_id('A5'), pg_temp.tx_rev('A5')));
  perform pg_temp.tx_like('X-AGENT', 'roadmap card: an agent cannot untag it even with a reason', v, 'ERR:42501:people_only:%');
  perform pg_temp.tx_check('X-AGENT', 'the roadmap card is unchanged', pg_temp.tx_row('A5') || ' rev ' || pg_temp.tx_rev('A5'), 'todo/other rev 1');
end;
$agent$;

-- The alias on an In progress card is logged as tagged for a person once.
do $told$
declare v_n integer;
begin
  select count(*) into v_n from public.ops_agent_log l where l.card_id = pg_temp.tx_id('A4') and l.action = 'needs_person';
  perform pg_temp.tx_check('X-AGENT', 'the alias on an In progress card logs needs_person once', v_n::text, '1');
end;
$told$;

-- ---------------------------------------------------------------------------
-- X-AUTO
-- ---------------------------------------------------------------------------
do $auto$
declare v jsonb; v_t text;
begin
  v := public.ops_auto_card_upsert('x_test:auto-upsert-1',
    jsonb_build_object('title', 'X4270 Auto made tagged', 'instructions', 'Send the host the welcome note.', 'done_means', 'The note is sent.',
      'owners', jsonb_build_array('gia.x4270@test.local'), 'due_on', public.ops_today(NULL) + 2, 'person_reason', 'publish'), 'task', NULL);
  perform pg_temp.tx_check('X-AUTO', 'an automatic card with a tag lands in To do with it',
    (select status || '/' || coalesce(person_reason, '-') from public.ops_work_cards where id = (v->>'id')::uuid), 'todo/publish');
  v := public.ops_auto_card_upsert('x_test:auto-upsert-2',
    jsonb_build_object('title', 'X4270 Auto with a status', 'instructions', 'Send the host the welcome note.', 'done_means', 'The note is sent.',
      'owners', jsonb_build_array('gia.x4270@test.local'), 'due_on', public.ops_today(NULL) + 2, 'status', 'person', 'person_reason', 'send'), 'task', NULL);
  perform pg_temp.tx_check('X-AUTO', 'an automatic card cannot choose its status', v->>'status', 'refused');
  v := public.ops_auto_card_close(pg_temp.tx_id('A7'), 'The event went live.', '[{"text":"Checked by Mingla."}]'::jsonb);
  perform pg_temp.tx_check('X-AUTO', 'an automatic close clears the tag as it closes', v->>'status' || ' ' || pg_temp.tx_row('A7'), 'closed done/-');
  v_t := pg_temp.tx_person('gia', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"I approved it on the call."}]'::jsonb, 'Approved.', %s)::text$q$,
    pg_temp.tx_id('A6'), pg_temp.tx_rev('A6')));
  perform pg_temp.tx_check('X-AUTO', 'a person closes a tagged In progress card with proof; the tag goes', pg_temp.tx_row('A6'), 'done/-');
  v_t := pg_temp.tx_person('gia', format($q$select public.ops_work_reopen(%L, 'Reopening to check it again.', %s)::text$q$, pg_temp.tx_id('A6'), pg_temp.tx_rev('A6')));
  perform pg_temp.tx_check('X-AUTO', 'reopening never brings the tag back', pg_temp.tx_row('A6'), 'todo/-');
end;
$auto$;

-- ---------------------------------------------------------------------------
-- X-UNDO
-- ---------------------------------------------------------------------------
do $undo$
declare v text; v_snap jsonb; v_event uuid;
begin
  -- An event written after the move whose before-snapshot still says status
  -- person (an old snapshot shape): undo must land in To do with the tag.
  v_snap := public.ops_card_snapshot(pg_temp.tx_id('U1'));
  v_snap := jsonb_set(jsonb_set(v_snap, '{fields,status}', '"person"'), '{fields,person_reason}', '"publish"');
  insert into public.ops_work_events (card_id, at, actor_email, via, action, before, after, from_revision, to_revision)
  values (pg_temp.tx_id('U1'), clock_timestamp(), 'gia.x4270@test.local', null, 'status', v_snap,
          public.ops_card_snapshot(pg_temp.tx_id('U1')), pg_temp.tx_rev('U1'), pg_temp.tx_rev('U1'))
  returning id into v_event;
  v := pg_temp.tx_person('gia', format('select public.ops_work_undo(%L)::text', v_event));
  perform pg_temp.tx_check('X-UNDO', 'undo of a person snapshot restores To do with the tag, never the status',
    coalesce(pg_temp.tx_row('U1'), v) || ' ' || case when v like 'ERR:%' then v else 'ok' end, 'todo/publish ok');

  -- Mark sent, then undo: an open card with its tag again.
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.tx_id('U2'), pg_temp.tx_rev('U2')));
  perform pg_temp.tx_check('X-UNDO', 'Mark sent closes it', pg_temp.tx_row('U2'), 'done/-');
  v := pg_temp.tx_person('gia', format('select public.ops_work_undo(%L)::text', (pg_temp.tx_j(v)->>'event_id')));
  perform pg_temp.tx_check('X-UNDO', 'undoing Mark sent reopens it in To do with the tag',
    coalesce(pg_temp.tx_row('U2'), v) || ' ' || (select coalesce(closed_at::text, '-') from public.ops_work_cards where id = pg_temp.tx_id('U2')), 'todo/send -');

  -- A person tags a card, then undoes it.
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"person_reason":"spend"}'::jsonb, %s)::text$q$, pg_temp.tx_id('U3'), pg_temp.tx_rev('U3')));
  perform pg_temp.tx_check('X-UNDO', 'a person tags a card', pg_temp.tx_row('U3'), 'todo/spend');
  v := pg_temp.tx_person('gia', format('select public.ops_work_undo(%L)::text', (pg_temp.tx_j(v)->>'event_id')));
  perform pg_temp.tx_check('X-UNDO', 'and undoing it takes the tag off again', coalesce(pg_temp.tx_row('U3'), v), 'todo/-');
end;
$undo$;

-- ---------------------------------------------------------------------------
-- X-DONE
-- ---------------------------------------------------------------------------
do $done$
declare v text;
begin
  begin
    update public.ops_work_cards set status = 'done', closed_at = now(), close_kind = 'done' where id = pg_temp.tx_id('A3');
    v := 'accepted';
  exception when check_violation then v := 'refused';
  end;
  perform pg_temp.tx_check('X-DONE', 'closing a tagged card without clearing the tag is refused by the table', v, 'refused');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"person_reason":"send"}'::jsonb, %s)::text$q$, pg_temp.tx_id('D1'), pg_temp.tx_rev('D1')));
  perform pg_temp.tx_like('X-DONE', 'a done card cannot be tagged through an update', v, 'ERR:22023:card_closed:%');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.tx_id('D1'), pg_temp.tx_rev('D1')));
  perform pg_temp.tx_like('X-DONE', 'a done card takes no person action', v, 'ERR:22023:wrong_action:%');
  perform pg_temp.tx_check('X-DONE', 'no done card anywhere carries a tag',
    (select count(*) from public.ops_work_cards where status = 'done' and person_reason is not null)::text, '0');
end;
$done$;

-- ---------------------------------------------------------------------------
-- X-ARCH and X-NOOWNER (lists)
-- ---------------------------------------------------------------------------
do $arch$
declare v jsonb; v_t text;
begin
  v := pg_temp.tx_j(pg_temp.tx_person('gia', $q$select public.ops_work_list('{"who":"mine","status":["person"]}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-ARCH', 'an archived tagged card is not on the board''s tagged list',
    (select count(*) from jsonb_array_elements(v->'cards') c where (c->>'id')::uuid = pg_temp.tx_id('R1'))::text, '0');
  v := pg_temp.tx_j(pg_temp.tx_person('gia', 'select public.ops_my_counts(NULL)::text'));
  perform pg_temp.tx_check('X-ARCH', 'nor in my counts (Needs your OK and due today exclude it)',
    format('needs_ok=%s due_today=%s', v->>'needs_ok_mine', v->>'due_today_mine'),
    format('needs_ok=%s due_today=%s',
      (select count(*) from public.ops_work_cards w join public.ops_work_people p on p.card_id = w.id and p.role = 'owner' and p.email = 'gia.x4270@test.local'
        where w.archived_at is null and w.status <> 'done' and w.person_reason is not null),
      (select count(*) from public.ops_work_cards w join public.ops_work_people p on p.card_id = w.id and p.role = 'owner' and p.email = 'gia.x4270@test.local'
        where w.archived_at is null and w.status <> 'done' and w.due_on = public.ops_today(NULL))));
  v := pg_temp.tx_j(pg_temp.tx_person('gia', 'select public.ops_review_list(NULL)::text'));
  perform pg_temp.tx_check('X-ARCH', 'nor in To review',
    (select count(*) from jsonb_array_elements(coalesce(v->'cards','[]') || coalesce(v->'draft_needed','[]')) c where (c->>'id')::uuid = pg_temp.tx_id('R1'))::text, '0');
  v_t := pg_temp.tx_person('gia', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.tx_id('R1'), pg_temp.tx_rev('R1')));
  perform pg_temp.tx_like('X-ARCH', 'and it takes no person action', v_t, 'ERR:P0002:not_found:%');

  v := pg_temp.tx_j(pg_temp.tx_person('boss', 'select public.ops_review_list(NULL)::text'));
  perform pg_temp.tx_check('X-NOOWNER', 'an admin sees a tagged card with no owner in To review',
    (select count(*) from jsonb_array_elements(v->'cards') c where (c->>'id')::uuid = pg_temp.tx_id('N1'))::text, '1');
  v := pg_temp.tx_j(pg_temp.tx_person('hal', 'select public.ops_review_list(NULL)::text'));
  perform pg_temp.tx_check('X-NOOWNER', 'a teammate who is not on it does not',
    (select count(*) from jsonb_array_elements(v->'cards') c where (c->>'id')::uuid = pg_temp.tx_id('N1'))::text, '0');
  v_t := pg_temp.tx_agent('gia', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Paid."}]'::jsonb, NULL, %s)::text$q$, pg_temp.tx_id('N1'), pg_temp.tx_rev('N1')));
  perform pg_temp.tx_like('X-NOOWNER', 'no agent can close a tagged card that has no owner', v_t, 'ERR:42501:%');
  v := pg_temp.tx_j(pg_temp.tx_person('boss', format($q$select public.ops_work_list('{"q":"No owner tagged"}'::jsonb)::text$q$)));
  perform pg_temp.tx_check('X-NOOWNER', 'the board JSON shows it with no owners and its tag',
    (select (c->'owners')::text || ' ' || (c->>'tag') from jsonb_array_elements(v->'cards') c where (c->>'id')::uuid = pg_temp.tx_id('N1')), '[] spend');
end;
$arch$;

-- ---------------------------------------------------------------------------
-- X-REV
-- ---------------------------------------------------------------------------
do $rev$
declare v text; v2 text; r bigint;
begin
  r := pg_temp.tx_rev('V1');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"title":"X4270 Revision card renamed"}'::jsonb, %s)::text$q$, pg_temp.tx_id('V1'), r - 1));
  perform pg_temp.tx_like('X-REV', 'update with a stale revision is PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"title":"X4270 Revision card renamed"}'::jsonb, NULL)::text$q$, pg_temp.tx_id('V1')));
  perform pg_temp.tx_like('X-REV', 'update with no revision is PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.tx_id('V1'), r + 5));
  perform pg_temp.tx_like('X-REV', 'Mark sent with a stale revision is PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Done it."}]'::jsonb, NULL, %s)::text$q$, pg_temp.tx_id('V1'), r + 5));
  perform pg_temp.tx_like('X-REV', 'close with a stale revision is PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_start(%L, %s)::text$q$, pg_temp.tx_id('V1'), r + 5));
  perform pg_temp.tx_like('X-REV', 'start with a stale revision is PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.tx_agent('gia', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"spend"}'::jsonb, %s)::text$q$, pg_temp.tx_id('V1'), r + 5));
  perform pg_temp.tx_like('X-REV', 'the alias with a stale revision is PT409', v, 'ERR:PT409:stale_write:%');
  perform pg_temp.tx_check('X-REV', 'no write ever answered 40001',
    (select count(*) from tx_results where detail like '%40001%')::text, '0');
  perform pg_temp.tx_check('X-REV', 'the stale writes changed nothing', pg_temp.tx_row('V1') || ' rev ' || pg_temp.tx_rev('V1'), 'todo/send rev ' || r);
  -- one request key, sent twice: one write
  r := pg_temp.tx_rev('V2');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"person_reason":"send"}'::jsonb, %s, 'x4270-replay-0001')::text$q$, pg_temp.tx_id('V2'), r));
  v2 := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"person_reason":"send"}'::jsonb, %s, 'x4270-replay-0001')::text$q$, pg_temp.tx_id('V2'), r));
  perform pg_temp.tx_check('X-REV', 'a repeated request key writes once', pg_temp.tx_row('V2') || ' rev ' || pg_temp.tx_rev('V2'), 'todo/send rev ' || (r + 1));
  perform pg_temp.tx_check('X-REV', 'and answers the same event', pg_temp.tx_j(v2)->>'event_id', pg_temp.tx_j(v)->>'event_id');
end;
$rev$;

-- ---------------------------------------------------------------------------
-- X-FILES
-- ---------------------------------------------------------------------------
do $files$
declare v text; v_bad text; v_long text := 'https://example.com/' || repeat('a', 1980); -- 2,000 characters
begin
  perform pg_temp.tx_check('X-FILES', 'the long fixture is exactly 2,000 characters', char_length(v_long)::text, '2000');
  foreach v_bad in array array[
    'http://drive.example.com/x', 'javascript:alert(1)', 'https://', 'https://a b', 'https://ok.example.com/' || chr(10),
    'HTTPS://drive.example.com/x', 'ftp://drive.example.com/x', '//drive.example.com/x', v_long || 'b',
    'https://ok.example.com/' || chr(9) || 'x', 'https://a' || chr(160) || 'b'] loop
    v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, jsonb_build_object('files_url', %L::text), %s)::text$q$,
      pg_temp.tx_id('F1'), v_bad, pg_temp.tx_rev('F1')));
    perform pg_temp.tx_like('X-FILES', 'refused: ' || left(replace(replace(replace(v_bad, chr(10), '\n'), chr(9), '\t'), chr(160), '<nbsp>'), 40), v, 'ERR:22023:invalid_card:%Links start with https://%');
  end loop;
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"files_url":12345}'::jsonb, %s)::text$q$, pg_temp.tx_id('F1'), pg_temp.tx_rev('F1')));
  perform pg_temp.tx_like('X-FILES', 'refused: a number', v, 'ERR:22023:invalid_card:%');
  perform pg_temp.tx_check('X-FILES', 'nothing was saved by the refusals',
    (select coalesce(files_url, '<null>') || ' rev ' || revision from public.ops_work_cards where id = pg_temp.tx_id('F1')), '<null> rev 1');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, jsonb_build_object('files_url', %L::text), %s)::text$q$, pg_temp.tx_id('F1'), v_long, pg_temp.tx_rev('F1')));
  perform pg_temp.tx_check('X-FILES', 'exactly 2,000 characters is kept', char_length(pg_temp.tx_j(v) #>> '{card,files_url}')::text, '2000');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_update(%L, '{"files_url":"   https://drive.example.com/padded   "}'::jsonb, %s)::text$q$, pg_temp.tx_id('F1'), pg_temp.tx_rev('F1')));
  perform pg_temp.tx_check('X-FILES', 'a padded link is trimmed and kept', pg_temp.tx_j(v) #>> '{card,files_url}', 'https://drive.example.com/padded');
  v := pg_temp.tx_person('gia', format($q$select public.ops_work_add('[{"title":"X4270 Added with a bad link","instructions":"Make the flyer and upload it.","done_means":"The flyer is uploaded.","owners":["gia.x4270@test.local"],"due_on":"%s","files_url":"javascript:alert(document.cookie)"}]'::jsonb, 'x4270-add-badlink-1')::text$q$, public.ops_today(NULL) + 3));
  perform pg_temp.tx_check('X-FILES', 'an add with a javascript: link is refused', pg_temp.tx_j(v) #>> '{results,0,status}', 'refused');
  begin
    update public.ops_work_cards set files_url = 'javascript:alert(1)' where id = pg_temp.tx_id('F1');
    v := 'accepted';
  exception when check_violation then v := 'refused';
  end;
  perform pg_temp.tx_check('X-FILES', 'the table itself refuses a non-https link', v, 'refused');
  begin
    update public.ops_work_cards set files_url = 'https://' || repeat('a', 1993) where id = pg_temp.tx_id('F1');
    v := 'accepted';
  exception when check_violation then v := 'refused';
  end;
  perform pg_temp.tx_check('X-FILES', 'and a link over 2,000 characters', v, 'refused');
end;
$files$;

-- ---------------------------------------------------------------------------
-- X-CAP: 305 open cards for one owner.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
do $fx_cap$
begin
  for i in 1..304 loop
    perform pg_temp.tx_card('C' || i, format('X4270 Cap card %s', lpad(i::text, 3, '0')), 'todo', null, 'cap.x4270@test.local', (i % 20) - 5);
  end loop;
  perform pg_temp.tx_card('CDOING', 'X4270 Cap in progress', 'doing', null, 'cap.x4270@test.local', 30);
end;
$fx_cap$;
set local session_replication_role = origin;

do $cap$
declare v jsonb; v_t text;
begin
  v := pg_temp.tx_j(pg_temp.tx_person('cap', $q$select public.ops_work_list('{"owner":"cap.x4270@test.local"}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-CAP', 'the default list is 200 cards, says it is cut and gives the true total',
    format('%s %s %s', jsonb_array_length(v->'cards'), v->>'truncated', v->>'total'), '200 true 305');
  v := pg_temp.tx_j(pg_temp.tx_person('cap', $q$select public.ops_work_list('{"owner":"cap.x4270@test.local","limit":300}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-CAP', 'the board''s 300 is still cut at 305 and says so',
    format('%s %s %s', jsonb_array_length(v->'cards'), v->>'truncated', v->>'total'), '300 true 305');
  perform pg_temp.tx_check('X-CAP', 'counts are for every card, not the page',
    format('todo=%s doing=%s', v #>> '{counts,todo}', v #>> '{counts,doing}'), 'todo=304 doing=1');
  perform pg_temp.tx_check('X-CAP', 'the page is To do first, so the In progress card is past the cut',
    (select count(*) from jsonb_array_elements(v->'cards') c where c->>'status' = 'doing')::text, '0');
  v_t := pg_temp.tx_person('cap', $q$select public.ops_work_list('{"owner":"cap.x4270@test.local","limit":301}'::jsonb)::text$q$);
  perform pg_temp.tx_like('X-CAP', 'limit 301 is refused', v_t, 'ERR:22023:invalid_query:%');
  v := pg_temp.tx_j(pg_temp.tx_person('cap', $q$select public.ops_work_list('{"owner":"cap.x4270@test.local","limit":300,"offset":300}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-CAP', 'the next page holds the last five, the In progress card last',
    format('%s %s %s', jsonb_array_length(v->'cards'), v->>'truncated', v #>> '{cards,4,title}'), '5 false X4270 Cap in progress');
  perform pg_temp.tx_check('X-CAP', 'the first page is late first: its first card is the latest-late',
    (select min(due_on)::text from public.ops_work_cards w join public.ops_work_people p on p.card_id = w.id and p.email = 'cap.x4270@test.local'),
    (pg_temp.tx_j(pg_temp.tx_person('cap', $q$select public.ops_work_list('{"owner":"cap.x4270@test.local","limit":1}'::jsonb)::text$q$)) #>> '{cards,0,due_on}'));
end;
$cap$;

-- ---------------------------------------------------------------------------
-- X-SORT and X-WINDOW
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
do $fx_sort$
declare v_ws timestamptz := public.ops_monday(public.ops_today(NULL))::timestamp AT TIME ZONE 'UTC';
begin
  -- Same due day, inserted zulu before alpha: card number decides, not title.
  perform pg_temp.tx_card('S1', 'X4270 Tie zulu',    'todo',  null,   'tie.x4270@test.local', 2);
  perform pg_temp.tx_card('S2', 'X4270 Tie alpha',   'todo',  'send', 'tie.x4270@test.local', 2);
  perform pg_temp.tx_card('S3', 'X4270 Tie mike',    'todo',  null,   'tie.x4270@test.local', 2);
  perform pg_temp.tx_card('S4', 'X4270 Tie late',    'todo',  null,   'tie.x4270@test.local', -9);
  perform pg_temp.tx_card('S5', 'X4270 Tie doing b', 'doing', null,   'tie.x4270@test.local', 1);
  perform pg_temp.tx_card('S6', 'X4270 Tie doing a', 'doing', 'spend','tie.x4270@test.local', 1);
  -- Done: same due day; T1 and T3 closed at the same moment, T2 earlier.
  perform pg_temp.tx_card('T1', 'X4270 Done same due, closed 1h', 'done', null, 'tie.x4270@test.local', -1, p_closed => interval '1 hour');
  perform pg_temp.tx_card('T2', 'X4270 Done same due, closed 3h', 'done', null, 'tie.x4270@test.local', -1, p_closed => interval '3 hours');
  perform pg_temp.tx_card('T3', 'X4270 Done same due, closed 1h too', 'done', null, 'tie.x4270@test.local', -1, p_closed => interval '1 hour');
  perform pg_temp.tx_card('T4', 'X4270 Done due today, closed 5h', 'done', null, 'tie.x4270@test.local', 0, p_closed => interval '5 hours');
  -- Window
  -- #4270 rework: closed at Monday 00:00 UTC (inside) and one minute before (outside).
  perform pg_temp.tx_card('W1', 'X4270 Window inside',  'done', null, 'win.x4270@test.local', -6, p_closed => now() - v_ws);
  perform pg_temp.tx_card('W2', 'X4270 Window outside', 'done', null, 'win.x4270@test.local', -7, p_closed => (now() - v_ws) + interval '1 minute');
  perform pg_temp.tx_card('W3', 'X4270 Window open',    'todo', null, 'win.x4270@test.local', 1);
end;
$fx_sort$;
set local session_replication_role = origin;

do $sort$
declare v jsonb;
begin
  -- done_days 7: the closed-hours-ago fixtures stay in whatever day of the week the suite runs.
  v := pg_temp.tx_j(pg_temp.tx_person('tie', $q$select public.ops_work_list('{"owner":"tie.x4270@test.local","done_days":7}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-SORT', 'ties on a due day go by card number; late first; Done latest due, then latest closed, then number',
    (select string_agg(replace(c->>'title', 'X4270 ', ''), '|' order by o) from jsonb_array_elements(v->'cards') with ordinality t(c, o)),
    'Tie late|Tie zulu|Tie alpha|Tie mike|Tie doing b|Tie doing a|Done due today, closed 5h|Done same due, closed 1h|Done same due, closed 1h too|Done same due, closed 3h');

  v := pg_temp.tx_j(pg_temp.tx_person('win', $q$select public.ops_work_list('{"owner":"win.x4270@test.local"}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-WINDOW', 'Done holds a card closed at Monday 00:00, not one closed a minute before',
    (select string_agg(replace(c->>'title', 'X4270 ', ''), '|' order by o) from jsonb_array_elements(v->'cards') with ordinality t(c, o)),
    'Window open|Window inside');
  perform pg_temp.tx_check('X-WINDOW', 'the strip count of Done is the same week as the column',
    v #>> '{counts,done}', '1');
  perform pg_temp.tx_check('X-WINDOW', 'done_since is Monday 00:00 UTC by default',
    ((v->>'done_since')::timestamptz = (public.ops_monday(public.ops_today(NULL))::timestamp AT TIME ZONE 'UTC'))::text, 'true');
  v := pg_temp.tx_j(pg_temp.tx_person('win', $q$select public.ops_work_list('{"owner":"win.x4270@test.local","tz":"Pacific/Kiritimati"}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-WINDOW', 'with tz the week starts at Monday 00:00 in that zone',
    ((v->>'done_since')::timestamptz = (public.ops_monday(public.ops_today(NULL))::timestamp AT TIME ZONE 'Pacific/Kiritimati'))::text, 'true');
  v := pg_temp.tx_j(pg_temp.tx_person('win', $q$select public.ops_work_list('{"owner":"win.x4270@test.local","tz":"Mars/Olympus"}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-WINDOW', 'an unknown zone is read as UTC and still loads',
    ((v->>'done_since')::timestamptz = (public.ops_monday(public.ops_today(NULL))::timestamp AT TIME ZONE 'UTC'))::text, 'true');
  v := pg_temp.tx_j(pg_temp.tx_person('win', $q$select public.ops_work_list('{"owner":"win.x4270@test.local","done_days":7}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-WINDOW', 'done_days still asks for a rolling window and has no done_since',
    coalesce(v->>'done_since', 'none'), 'none');
  v := pg_temp.tx_j(pg_temp.tx_person('win', $q$select public.ops_work_list('{"owner":"win.x4270@test.local","done_days":0}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-WINDOW', 'done_days 0 shows no Done card', (v #>> '{counts,done}') || ' ' || jsonb_array_length(v->'cards'), '0 1');
end;
$sort$;

-- ---------------------------------------------------------------------------
-- X-ALIAS
-- ---------------------------------------------------------------------------
do $alias$
declare v jsonb; v_t text; r bigint;
begin
  v := pg_temp.tx_j(pg_temp.tx_person('hal', $q$select public.ops_work_list('{"owner":"hal.x4270@test.local","q":"Alias filter","status":["person"]}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-ALIAS', 'the person filter lists a tagged In progress card, never a done or untagged one',
    (select string_agg(replace(c->>'title', 'X4270 ', ''), '|' order by o) from jsonb_array_elements(v->'cards') with ordinality t(c, o)) || ' total ' || (v->>'total'),
    'Alias filter tagged doing total 1');
  v := pg_temp.tx_j(pg_temp.tx_person('hal', $q$select public.ops_work_list('{"owner":"hal.x4270@test.local","q":"Alias filter","status":["person","todo"]}'::jsonb)::text$q$));
  perform pg_temp.tx_check('X-ALIAS', 'person and todo together: the tagged card and the To do card, once each',
    (select string_agg(replace(c->>'title', 'X4270 ', ''), '|' order by o) from jsonb_array_elements(v->'cards') with ordinality t(c, o)),
    'Alias filter plain|Alias filter tagged doing');
  v_t := pg_temp.tx_person('hal', $q$select public.ops_work_list('{"status":["Person"]}'::jsonb)::text$q$);
  perform pg_temp.tx_like('X-ALIAS', 'the filter is exact', v_t, 'ERR:22023:invalid_query:%');
  r := pg_temp.tx_rev('L1');
  v := pg_temp.tx_j(pg_temp.tx_agent('hal', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"publish"}'::jsonb, %s)::text$q$, pg_temp.tx_id('L1'), r)));
  perform pg_temp.tx_check('X-ALIAS', 'the alias with the same tag on an In progress card moves it to To do (one change)',
    pg_temp.tx_row('L1') || ' rev ' || pg_temp.tx_rev('L1') || ' changed ' || (v->>'changed'), 'todo/publish rev ' || (r + 1) || ' changed true');
  r := pg_temp.tx_rev('L1');
  v := pg_temp.tx_j(pg_temp.tx_agent('hal', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"publish"}'::jsonb, %s)::text$q$, pg_temp.tx_id('L1'), r)));
  perform pg_temp.tx_check('X-ALIAS', 'sent again it is no change and writes no history',
    'rev ' || pg_temp.tx_rev('L1') || ' changed ' || (v->>'changed'), 'rev ' || r || ' changed false');
  v_t := pg_temp.tx_agent('hal', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"pay"}'::jsonb, %s)::text$q$, pg_temp.tx_id('L2'), pg_temp.tx_rev('L2')));
  perform pg_temp.tx_like('X-ALIAS', 'the alias with an unknown tag is refused', v_t, 'ERR:22023:invalid_card:%');
end;
$alias$;

select count(*) as tx_total, count(*) filter (where not ok) as tx_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tx_failures
  from tx_results \gset
rollback;

select (:tx_total < 70 or :tx_failed > 0) as tx_bad \gset
\if :tx_bad
  \echo 'ISSUE-4270 W1 TESTER FAILED:' :tx_failed 'of' :tx_total
  \echo :tx_failures
  do $$ begin raise exception 'ISSUE-4270 W1 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W1 TESTER PASS:' :tx_total 'checks, 0 failed'
