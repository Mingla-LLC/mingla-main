-- Issue #4255 (Wave 2) -- implementor happy path for
-- 20280323004255_issue_4255_work_list_closed_range.sql, on the fully replayed
-- PG17 schema:
-- MINGLA-INVARIANT: I-4255-WORK-DONE-IN-WINDOW | issue #4255 | Work's Done lists count only cards closed inside the window; ops_work_list without the new keys answers as before.
--   R-RANGE   closed_since / closed_until pick the done cards closed inside a
--             window (since inclusive, until exclusive), whatever done_days
--             says; a card closed 40 days ago is listed for a 45-day window
--             (done_days alone stops at 60 and counts from now)
--   R-OPEN    open cards are listed exactly as before; the range only picks
--             done cards
--   R-OLD     a query with none of the new keys answers exactly as before
--             (the default 7 done days, the same cards, the same counts)
--   R-PAGE    offset pages through the list: page 1 and page 2 together are
--             every card once, `truncated` counts the offset, and the answer
--             says which offset it used
--   R-SHAPE   a range that ends before it starts, an offset out of range and
--             a range that is not a timestamp are refused in words; an
--             unknown key is still refused; anon still cannot run it
--
-- FAILS-ON-REVERT: without the migration, every R-RANGE / R-PAGE call is
-- refused with `invalid_query: The board cannot filter by "closed_since"`
-- (and "offset"), so the R-RANGE and R-PAGE checks fail.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tr_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tr_people (who, id, email) values
  ('owner',  '42550000-0000-4000-a0ee-000000000001', 'oona.w4255@test.local'),
  ('growth', '42550000-0000-4000-a0ee-000000000003', 'gia.w4255@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tr_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.w4255@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.w4255@test.local', 'growth', 'active', now());

create temp table tr_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tr_card_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.tr_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      select id, email into strict v_id, v_email from tr_people where who = p_who;
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
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

-- The query, run as Gia, as JSON.
create function pg_temp.tr_list(p_query text) returns jsonb
language sql as $fn$
  select pg_temp.tr_j(pg_temp.tr_as('growth', format('select public.ops_work_list(%L::jsonb)::text', p_query)))
$fn$;

-- The titles of the cards an answer lists, in its order, joined by "|".
create function pg_temp.tr_titles(p jsonb) returns text
language sql as $fn$
  select coalesce(string_agg(c ->> 'title', '|' order by o), '<none>')
    from jsonb_array_elements(coalesce(p -> 'cards', '[]'::jsonb)) with ordinality t(c, o)
$fn$;

-- One card, written directly (triggers off), owned by Gia.
create function pg_temp.tr_card(p_key text, p_title text, p_status text, p_due_days integer, p_closed interval default null) returns uuid
language plpgsql as $fn$
declare v_id uuid; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id,
    created_by, created_at, updated_by, updated_at, closed_at, closed_by, close_kind)
  values (p_title, 'Do this task carefully and say what changed.', 'It is done and checked.', p_status,
    v_today + p_due_days, 'explicit', public.ops_sprint_ensure(v_today + p_due_days),
    'gia.w4255@test.local', now() - interval '50 days', 'gia.w4255@test.local', now() - interval '1 day',
    case when p_status = 'done' then now() - p_closed end, case when p_status = 'done' then 'gia.w4255@test.local' end,
    case when p_status = 'done' then 'done' end)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, 'gia.w4255@test.local', 'owner', 'gia.w4255@test.local');
  insert into tr_card_ids (k, id) values (p_key, v_id);
  return v_id;
end;
$fn$;

set local session_replication_role = replica;
do $fixture$
begin
  perform pg_temp.tr_card('O1', 'R4255 Open one',          'todo',  1);
  perform pg_temp.tr_card('O2', 'R4255 Open two',          'doing', 2);
  perform pg_temp.tr_card('D2', 'R4255 Closed 2 days ago', 'done',  0, interval '2 days');
  perform pg_temp.tr_card('D10', 'R4255 Closed 10 days ago', 'done', 0, interval '10 days');
  perform pg_temp.tr_card('D40', 'R4255 Closed 40 days ago', 'done', 0, interval '40 days');
end;
$fixture$;
set local session_replication_role = origin;

do $range$
declare v jsonb; v_since text; v_until text;
begin
  -- A window from 12 days ago to 1 day ago: only the card closed 2 days ago
  -- and the one closed 10 days ago.
  v_since := to_char((now() - interval '12 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_until := to_char((now() - interval '1 day') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v := pg_temp.tr_list(format('{"owner":"gia.w4255@test.local","status":["done"],"closed_since":"%s","closed_until":"%s","done_days":0}', v_since, v_until));
  perform pg_temp.tr_check('R-RANGE', 'done cards closed inside the window, whatever done_days says',
    pg_temp.tr_titles(v), 'R4255 Closed 2 days ago|R4255 Closed 10 days ago');
  perform pg_temp.tr_check('R-RANGE', 'the counts follow the window', v -> 'counts' ->> 'done', '2');

  -- A 45-day window reaches the card closed 40 days ago.
  v_since := to_char((now() - interval '45 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v := pg_temp.tr_list(format('{"owner":"gia.w4255@test.local","status":["done"],"closed_since":"%s"}', v_since));
  perform pg_temp.tr_check('R-RANGE', 'a since-only window lists every card closed after it',
    pg_temp.tr_titles(v), 'R4255 Closed 2 days ago|R4255 Closed 10 days ago|R4255 Closed 40 days ago');

  -- Until is exclusive: a window ending at the moment the 10-day card closed leaves it out.
  v_until := to_char((select closed_at from public.ops_work_cards where id = (select id from tr_card_ids where k = 'D10')) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v := pg_temp.tr_list(format('{"owner":"gia.w4255@test.local","status":["done"],"closed_since":"%s","closed_until":"%s"}', v_since, v_until));
  perform pg_temp.tr_check('R-RANGE', 'closed_until is exclusive', pg_temp.tr_titles(v), 'R4255 Closed 40 days ago');

  -- Open cards are listed as before, with the done cards of the window after them.
  v := pg_temp.tr_list(format('{"owner":"gia.w4255@test.local","closed_since":"%s","closed_until":"%s"}',
    to_char((now() - interval '3 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(now() AT TIME ZONE 'UTC' + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  perform pg_temp.tr_check('R-OPEN', 'open cards first, then the done cards of the window',
    pg_temp.tr_titles(v), 'R4255 Open one|R4255 Open two|R4255 Closed 2 days ago');

  -- No new keys: exactly the old answer (7 done days by default).
  v := pg_temp.tr_list('{"owner":"gia.w4255@test.local"}');
  perform pg_temp.tr_check('R-OLD', 'without the new keys done_days still decides (default 7 days)',
    pg_temp.tr_titles(v), 'R4255 Open one|R4255 Open two|R4255 Closed 2 days ago');
  perform pg_temp.tr_check('R-OLD', 'the old answer says offset 0 and is not truncated',
    (v ->> 'offset') || '/' || (v ->> 'truncated') || '/' || (v ->> 'total'), '0/false/3');
  v := pg_temp.tr_list('{"owner":"gia.w4255@test.local","done_days":60}');
  perform pg_temp.tr_check('R-OLD', 'done_days 60 still reaches back 60 days',
    pg_temp.tr_titles(v), 'R4255 Open one|R4255 Open two|R4255 Closed 2 days ago|R4255 Closed 10 days ago|R4255 Closed 40 days ago');

  -- Paging: two cards a page.
  v := pg_temp.tr_list('{"owner":"gia.w4255@test.local","done_days":60,"limit":2}');
  perform pg_temp.tr_check('R-PAGE', 'page 1', pg_temp.tr_titles(v), 'R4255 Open one|R4255 Open two');
  perform pg_temp.tr_check('R-PAGE', 'page 1 is truncated', v ->> 'truncated', 'true');
  v := pg_temp.tr_list('{"owner":"gia.w4255@test.local","done_days":60,"limit":2,"offset":2}');
  perform pg_temp.tr_check('R-PAGE', 'page 2 starts after page 1', pg_temp.tr_titles(v), 'R4255 Closed 2 days ago|R4255 Closed 10 days ago');
  perform pg_temp.tr_check('R-PAGE', 'page 2 says its offset and that more follow', (v ->> 'offset') || '/' || (v ->> 'truncated'), '2/true');
  v := pg_temp.tr_list('{"owner":"gia.w4255@test.local","done_days":60,"limit":2,"offset":4}');
  perform pg_temp.tr_check('R-PAGE', 'the last page holds the rest and is not truncated', pg_temp.tr_titles(v) || '/' || (v ->> 'truncated'), 'R4255 Closed 40 days ago/false');
  v := pg_temp.tr_list('{"owner":"gia.w4255@test.local","done_days":60,"limit":2,"offset":10}');
  perform pg_temp.tr_check('R-PAGE', 'an offset past the end is an empty page, not an error', pg_temp.tr_titles(v) || '/' || (v ->> 'total'), '<none>/5');

  -- Shapes.
  perform pg_temp.tr_like('R-SHAPE', 'a window that ends before it starts is refused in words',
    pg_temp.tr_as('growth', $q$select public.ops_work_list('{"closed_since":"2026-11-02T00:00:00Z","closed_until":"2026-11-01T00:00:00Z"}'::jsonb)::text$q$),
    'ERR:22023:invalid_query: A filter has the wrong shape.%closed_since before closed_until%');
  perform pg_temp.tr_like('R-SHAPE', 'a range that is not a time is refused',
    pg_temp.tr_as('growth', $q$select public.ops_work_list('{"closed_since":"last week"}'::jsonb)::text$q$),
    'ERR:22023:invalid_query: A filter has the wrong shape.%');
  perform pg_temp.tr_like('R-SHAPE', 'a range that is a number is refused',
    pg_temp.tr_as('growth', $q$select public.ops_work_list('{"closed_until":5}'::jsonb)::text$q$),
    'ERR:22023:invalid_query: A filter has the wrong shape.%');
  perform pg_temp.tr_like('R-SHAPE', 'a negative offset is refused',
    pg_temp.tr_as('growth', $q$select public.ops_work_list('{"offset":-1}'::jsonb)::text$q$),
    'ERR:22023:invalid_query: A filter has the wrong shape.%offset 0 to 100000%');
  perform pg_temp.tr_like('R-SHAPE', 'an unknown key is still refused, naming every key it takes',
    pg_temp.tr_as('growth', $q$select public.ops_work_list('{"page":2}'::jsonb)::text$q$),
    'ERR:22023:invalid_query: The board cannot filter by "page".%closed_since, closed_until%offset.');
  perform pg_temp.tr_like('R-SHAPE', 'anon still cannot run it',
    pg_temp.tr_as('anon', $q$select public.ops_work_list('{}'::jsonb)::text$q$), 'ERR:42501:%');
  perform pg_temp.tr_check('R-SHAPE', 'the grants are unchanged (authenticated and service_role, not anon or PUBLIC)',
    (select string_agg(r, ',' order by r) from (select unnest(proacl)::text r from pg_proc where oid = 'public.ops_work_list(jsonb)'::regprocedure) x
      where r like 'anon=%' or r like '=%' or r like 'authenticated=%' or r like 'service_role=%'),
    'authenticated=X/postgres,service_role=X/postgres');
end;
$range$;

select count(*) as tr_total, count(*) filter (where not ok) as tr_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tr_failures
  from tr_results \gset
rollback;

select (:tr_total < 20 or :tr_failed > 0) as tr_bad \gset
\if :tr_bad
  \echo 'ISSUE-4255 WORK LIST CLOSED RANGE FAILED:' :tr_failed 'of' :tr_total
  \echo :tr_failures
  do $$ begin raise exception 'ISSUE-4255 WORK LIST CLOSED RANGE FAIL'; end $$;
\endif
\echo 'ISSUE-4255 WORK LIST CLOSED RANGE PASS:' :tr_total 'checks, 0 failed'
