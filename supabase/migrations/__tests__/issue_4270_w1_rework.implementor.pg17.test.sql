-- Issue #4270 (Wave 1 rework) -- implementor regression tests for the tester's
-- W1 defects, on the fully replayed PG17 schema
-- (20280411004270_issue_4270_w1_work_board_three_columns.sql).
-- MINGLA-INVARIANT: I-4270-COLUMNS-NEVER-CUT-BY-ANOTHER | issue #4270 | with per_status the board's limit applies to each column, so a long To do never empties In progress or Done, and each column says how many cards it has and how many came back.
-- MINGLA-INVARIANT: I-4270-DONE-THIS-WEEK | issue #4270 | Done on the board (and its count) is the cards closed since Monday 00:00 of the sprint week in the viewer's time zone (UTC when unknown); done_days asks for a rolling window instead.
--
--   R-CAP     P2-1: 304 To do, 1 In progress and 1 Done card for one owner.
--             With per_status and limit 300 the In progress and Done cards
--             come back; columns say todo 304/300 cut, doing 1/1, done 1/1;
--             truncated is true; per_status with an offset is refused;
--             without per_status the old one-page cut stays (and columns say
--             In progress came back 0 of 1)
--   R-TAG     P3-2: an agent sending an empty tag gets the bad-tag message,
--             not "say why"; the tag stays
--   R-WORDS   P3-4: tagging tells the watcher in the tag's words (never
--             "needs a person"); taking the tag off logs "no longer has its
--             Spend tag"; no ops function, and no Work Feature Guide entry,
--             says a card needs a person
--   R-WEEK    P3-3: Done and counts.done hold a card closed at Monday 00:00
--             and not one closed a minute before; done_since is returned
--
-- FAILS-ON-REVERT: put back the ops_work_list of fb0866aac (one slice over
-- every column) -> R-CAP fails; put back the v_back line without the fixes
-- check -> R-TAG fails; put back the "needs a person (...)" notice -> R-WORDS
-- fails; put back the rolling 7-day Done default -> R-WEEK fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tr_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tr_people (who, id, email) values
  ('owner',  '42700000-0000-4000-a0ef-000000000001', 'oona.r4270@test.local'),
  ('growth', '42700000-0000-4000-a0ef-000000000003', 'gia.r4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tr_people;
insert into public.admin_users (email, role, status, accepted_at) values ('oona.r4270@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values ('gia.r4270@test.local', 'growth', 'active', now());

create temp table tr_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tr_ids (k text primary key, id uuid not null) on commit drop;
create function pg_temp.tr_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tr_people where who = p_who;
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
create function pg_temp.tr_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tr_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tr_next_request();
  return pg_temp.tr_as(p_who, p_sql);
end;
$fn$;

-- A connected agent calling a function directly, as the gateway does.
create function pg_temp.tr_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tr_next_request();
  select id, email into strict v_id, v_email from tr_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.tr_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tr_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tr_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tr_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tr_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tr_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tr_id(p_k text) returns uuid
language sql as $fn$ select id from tr_ids where k = p_k $fn$;

create function pg_temp.tr_rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tr_ids where k = p_k) $fn$;

create function pg_temp.tr_row(p_k text) returns text
language sql as $fn$
  select w.status || '/' || coalesce(w.person_reason, '-') from public.ops_work_cards w where w.id = (select id from tr_ids where k = p_k)
$fn$;

create function pg_temp.tr_owners(p_k text) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '<none>') from public.ops_work_people p
   where p.card_id = (select id from tr_ids where k = p_k) and p.role = 'owner'
$fn$;

create function pg_temp.tr_card(p_key text, p_title text, p_status text, p_reason text, p_owner text, p_due_days integer,
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
    case when p_status = 'done' then now() - p_closed end, case when p_status = 'done' then 'gia.r4270@test.local' end,
    case when p_status = 'done' then 'done' end,
    case when p_archived then now() end, case when p_archived then 'oona.r4270@test.local' end, case when p_archived then 'Archived in the test.' end)
  returning id into v_id;
  if p_owner is not null then
    insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  end if;
  insert into tr_ids (k, id) values (p_key, v_id);
  return v_id;
end;
$fn$;

create function pg_temp.tr_watch(p_k text, p_email text) returns void
language sql as $fn$
  insert into public.ops_work_people (card_id, email, role, added_by) select id, p_email, 'watcher', p_email from tr_ids where k = p_k
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
do $fixture$
declare v_ws timestamptz := public.ops_monday(public.ops_today(NULL))::timestamp AT TIME ZONE 'UTC';
begin
  for i in 1..304 loop
    perform pg_temp.tr_card('C' || i, format('R4270 Cap card %s', lpad(i::text, 3, '0')), 'todo', null, 'gia.r4270@test.local', (i % 20) - 5);
  end loop;
  perform pg_temp.tr_card('CDOING', 'R4270 Cap in progress', 'doing', null, 'gia.r4270@test.local', 30);
  perform pg_temp.tr_card('CDONE',  'R4270 Cap done',        'done',  null, 'gia.r4270@test.local', -1, p_closed => interval '0 seconds');
  -- R-WEEK: closed at Monday 00:00 UTC, and a minute before.
  perform pg_temp.tr_card('WIN',  'R4270 Week inside',  'done', null, 'oona.r4270@test.local', -1, p_closed => now() - v_ws);
  perform pg_temp.tr_card('WOUT', 'R4270 Week outside', 'done', null, 'oona.r4270@test.local', -8, p_closed => (now() - v_ws) + interval '1 minute');
  -- R-TAG / R-WORDS: Gia's cards, watched by Oona.
  perform pg_temp.tr_card('T1', 'R4270 Approve the boost', 'todo', 'spend', 'gia.r4270@test.local', 2);
  perform pg_temp.tr_card('T2', 'R4270 Book the room',     'todo', null,    'gia.r4270@test.local', 3);
  perform pg_temp.tr_watch('T1', 'oona.r4270@test.local');
  perform pg_temp.tr_watch('T2', 'oona.r4270@test.local');
end;
$fixture$;
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- R-CAP (P2-1)
-- ---------------------------------------------------------------------------
do $cap$
declare v jsonb; v_t text;
begin
  v := pg_temp.tr_j(pg_temp.tr_person('growth', $q$select public.ops_work_list('{"owner":"gia.r4270@test.local","limit":300,"per_status":true}'::jsonb)::text$q$));
  perform pg_temp.tr_check('R-CAP', 'per_status: In progress and Done come back next to a long To do',
    format('%s doing=%s done=%s', jsonb_array_length(v->'cards'),
      (select count(*) from jsonb_array_elements(v->'cards') c where c->>'status' = 'doing'),
      (select count(*) from jsonb_array_elements(v->'cards') c where c->>'status' = 'done')), '302 doing=1 done=1');
  perform pg_temp.tr_check('R-CAP', 'each column says how many it has and how many came back',
    format('%s/%s/%s %s/%s/%s %s/%s/%s',
      v #>> '{columns,todo,total}', v #>> '{columns,todo,shown}', v #>> '{columns,todo,truncated}',
      v #>> '{columns,doing,total}', v #>> '{columns,doing,shown}', v #>> '{columns,doing,truncated}',
      v #>> '{columns,done,total}', v #>> '{columns,done,shown}', v #>> '{columns,done,truncated}'),
    '306/300/true 1/1/false 1/1/false'); -- 304 cap cards and T1, T2
  perform pg_temp.tr_check('R-CAP', 'the list says it is cut and gives the true total', (v->>'truncated') || ' ' || (v->>'total'), 'true 308');
  perform pg_temp.tr_check('R-CAP', 'To do is still late first, In progress after it, Done last',
    (select string_agg(DISTINCT c->>'status', ',') from jsonb_array_elements(v->'cards') with ordinality t(c, o) where o in (1, 301, 302))
      || ' ' || (v #>> '{cards,300,status}') || ' ' || (v #>> '{cards,301,status}'), 'doing,done,todo doing done');
  v_t := pg_temp.tr_person('growth', $q$select public.ops_work_list('{"owner":"gia.r4270@test.local","per_status":true,"offset":10}'::jsonb)::text$q$);
  perform pg_temp.tr_like('R-CAP', 'per_status with an offset is refused', v_t, 'ERR:22023:invalid_query:%');
  v_t := pg_temp.tr_person('growth', $q$select public.ops_work_list('{"owner":"gia.r4270@test.local","per_status":"yes"}'::jsonb)::text$q$);
  perform pg_temp.tr_like('R-CAP', 'per_status must be true or false', v_t, 'ERR:22023:invalid_query:%');
  v := pg_temp.tr_j(pg_temp.tr_person('growth', $q$select public.ops_work_list('{"owner":"gia.r4270@test.local","limit":300}'::jsonb)::text$q$));
  perform pg_temp.tr_check('R-CAP', 'without per_status one page is cut across columns, and columns say so',
    format('%s %s/%s', jsonb_array_length(v->'cards'), v #>> '{columns,doing,shown}', v #>> '{columns,doing,total}'), '300 0/1');
end;
$cap$;

-- ---------------------------------------------------------------------------
-- R-WEEK (P3-3)
-- ---------------------------------------------------------------------------
do $week$
declare v jsonb;
begin
  v := pg_temp.tr_j(pg_temp.tr_person('owner', $q$select public.ops_work_list('{"owner":"oona.r4270@test.local"}'::jsonb)::text$q$));
  perform pg_temp.tr_check('R-WEEK', 'Done is the sprint week: closed at Monday 00:00 in, a minute before out',
    (select string_agg(c->>'title', '|') from jsonb_array_elements(v->'cards') c) || ' done=' || (v #>> '{counts,done}'),
    'R4270 Week inside done=1');
  perform pg_temp.tr_check('R-WEEK', 'done_since names the Monday 00:00 the column starts at',
    ((v->>'done_since')::timestamptz = (public.ops_monday(public.ops_today(NULL))::timestamp AT TIME ZONE 'UTC'))::text, 'true');
end;
$week$;

-- ---------------------------------------------------------------------------
-- R-TAG (P3-2) and R-WORDS (P3-4)
-- ---------------------------------------------------------------------------
do $tag$
declare v text;
begin
  v := pg_temp.tr_agent('growth', format($q$select public.ops_work_update(%L, '{"person_reason":""}'::jsonb, %s)::text$q$, pg_temp.tr_id('T1'), pg_temp.tr_rev('T1')));
  perform pg_temp.tr_like('R-TAG', 'an empty tag from an agent gets the bad-tag message', v, 'ERR:22023:invalid_card:%A Send, Spend or Publish tag must say which%');
  perform pg_temp.tr_check('R-TAG', 'and the tag stays', pg_temp.tr_row('T1'), 'todo/spend');
  v := pg_temp.tr_agent('growth', format($q$select public.ops_work_update(%L, '{"person_reason":null}'::jsonb, %s)::text$q$, pg_temp.tr_id('T1'), pg_temp.tr_rev('T1')));
  perform pg_temp.tr_like('R-TAG', 'taking a real tag off with no reason still asks why', v, 'ERR:22023:reason_required:%');

  v := pg_temp.tr_agent('growth', format($q$select public.ops_work_update(%L, '{"person_reason":"publish"}'::jsonb, %s)::text$q$, pg_temp.tr_id('T2'), pg_temp.tr_rev('T2')));
  perform pg_temp.tr_check('R-WORDS', 'the agent tags a card', pg_temp.tr_row('T2'), 'todo/publish');
  perform pg_temp.tr_check('R-WORDS', 'the watcher is told in the tag''s words',
    (select string_agg(m.body_excerpt, ' | ') from public.team_mentions m join tr_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and p.who = 'owner' and m.body_excerpt like '%R4270 Book the room%'),
    (select format('%s: R4270 Book the room · You publish', public.ops_actor_label('gia.r4270@test.local', 'claude'))));
  perform pg_temp.tr_check('R-WORDS', 'the agent log names the tag',
    (select summary from public.ops_agent_log where card_id = pg_temp.tr_id('T2') and action = 'needs_person' order by id desc limit 1),
    (select format('Card %s is tagged Publish: R4270 Book the room', number) from public.ops_work_cards where id = pg_temp.tr_id('T2')));
  v := pg_temp.tr_agent('growth', format($q$select public.ops_work_update(%L, '{"person_reason":null,"reason":"The host paid for it."}'::jsonb, %s)::text$q$, pg_temp.tr_id('T1'), pg_temp.tr_rev('T1')));
  perform pg_temp.tr_check('R-WORDS', 'taking the tag off is logged in the tag''s words',
    (select summary from public.ops_agent_log where card_id = pg_temp.tr_id('T1') and action = 'updated' order by id desc limit 1),
    (select format('Card %s no longer has its Spend tag: The host paid for it.', number) from public.ops_work_cards where id = pg_temp.tr_id('T1')));
  perform pg_temp.tr_check('R-WORDS', 'nobody on these cards is told a card "needs a person"',
    (select count(*) from public.team_mentions m where m.body_excerpt ~* '(needs?|waiting on) a person' and m.created_at > now() - interval '1 hour')::text, '0');
  perform pg_temp.tr_check('R-WORDS', 'no Work Feature Guide entry says a card needs a person',
    (select count(*) from public.product_capabilities c where c.capability_key in ('staff-work-board', 'staff-drafts')
      and concat_ws(' ', c.outcome_summary, c.how_to, c.limitations, c.support_wording) ~* '(needs?|waiting on) a person')::text, '0');
  perform pg_temp.tr_check('R-WORDS', 'no ops function writes "needs a person" outside a comment',
    (select coalesce(string_agg(DISTINCT p.proname, ','), 'none') from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       regexp_matches(p.prosrc, '([^\n]*(?:[Nn]eeds? a person|[Ww]aiting on a person)[^\n]*)', 'g') m
      where n.nspname = 'public' and p.proname like 'ops\_%' and btrim(m[1]) !~ '^--' and m[1] !~ '--[^'']*(needs? a person|Needs a person)'),
    'none');
end;
$tag$;

select count(*) as tr_total, count(*) filter (where not ok) as tr_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tr_failures
  from tr_results \gset
rollback;

select (:tr_total < 17 or :tr_failed > 0) as tr_bad \gset
\if :tr_bad
  \echo 'ISSUE-4270 W1 REWORK FAILED:' :tr_failed 'of' :tr_total
  \echo :tr_failures
  do $$ begin raise exception 'ISSUE-4270 W1 REWORK FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W1 REWORK PASS:' :tr_total 'checks, 0 failed'
