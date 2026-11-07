-- Issue #4270 (Wave 1 rework) -- tester retest of P2-1 and P3-3 on the fully
-- replayed PG17 schema. Different angles from the implementor's rework test:
--
--   Y-CAP   P2-1, per column paging: 303 To do, 3 In progress, 3 Done this
--           week for one owner. With per_status and limit 300 every column
--           still shows and each says its real total; with limit 2 each
--           column gives its own first two (To do oldest due, Done latest
--           due); columns agree with counts; per_status needs a boolean and
--           no offset; without per_status the old single page is unchanged
--           (an agent's 200 still cuts In progress off).
--   Y-WEEK  P3-3, "this week" across zones and the Monday boundary: for
--           today the UTC day and the days either side, in UTC,
--           America/Los_Angeles, Pacific/Auckland and Asia/Kolkata, Done
--           starts at 00:00 on the Monday of the viewer's today in the
--           viewer's zone; a card closed one second before that is out, one
--           closed at it is in; counts.done and columns.done always equal
--           the Done column; a card closed between the Los Angeles and the
--           UTC Monday is Done for a UTC viewer and not for a Los Angeles one.
--
-- FAILS-ON-REVERT (recorded in the #4270 W2 test report): the pre-rework
-- ops_work_list (one slice across columns, rolling 7 days) -> Y-CAP and
-- Y-WEEK fail.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table ty_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into ty_people (who, id, email) values
  ('cap', '42720000-0000-4000-a0f0-000000000001', 'cap.y4270@test.local'),
  ('wk',  '42720000-0000-4000-a0f0-000000000002', 'week.y4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ty_people;
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('cap.y4270@test.local', 'growth', 'active', now()), ('week.y4270@test.local', 'growth', 'active', now());

create temp table ty_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.ty_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from ty_people where who = p_who;
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

create function pg_temp.ty_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into ty_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.ty_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into ty_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.ty_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.ty_list(p_who text, p_query jsonb) returns jsonb
language sql as $fn$ select pg_temp.ty_j(pg_temp.ty_as(p_who, format('select public.ops_work_list(%L::jsonb)::text', p_query::text))) $fn$;

create function pg_temp.ty_card(p_title text, p_status text, p_owner text, p_due_days integer, p_closed timestamptz default null) returns void
language plpgsql as $fn$
declare v_id uuid; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id,
    created_by, created_via, updated_by, closed_at, closed_by, close_kind)
  values (p_title, 'Do the work and write what changed.', 'Checked and done.', p_status,
    v_today + p_due_days, 'explicit', public.ops_sprint_ensure(v_today + p_due_days),
    'system@usemingla.com', 'system', 'system@usemingla.com',
    case when p_status = 'done' then coalesce(p_closed, now()) end, case when p_status = 'done' then p_owner end,
    case when p_status = 'done' then 'done' end)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Y-CAP fixtures: 303 To do, 3 In progress, 3 Done (closed this minute).
-- ---------------------------------------------------------------------------
do $fx$
begin
  for i in 1..303 loop
    perform pg_temp.ty_card(format('Y4270 Cap todo %s', lpad(i::text, 3, '0')), 'todo', 'cap.y4270@test.local', (i % 40) - 10);
  end loop;
  perform pg_temp.ty_card('Y4270 Cap doing late',  'doing', 'cap.y4270@test.local', -4);
  perform pg_temp.ty_card('Y4270 Cap doing soon',  'doing', 'cap.y4270@test.local', 3);
  perform pg_temp.ty_card('Y4270 Cap doing later', 'doing', 'cap.y4270@test.local', 9);
  perform pg_temp.ty_card('Y4270 Cap done early due', 'done', 'cap.y4270@test.local', -6);
  perform pg_temp.ty_card('Y4270 Cap done mid due',   'done', 'cap.y4270@test.local', -2);
  perform pg_temp.ty_card('Y4270 Cap done late due',  'done', 'cap.y4270@test.local', 5);
end;
$fx$;

do $cap$
declare v jsonb; v_t text;
begin
  v := pg_temp.ty_list('cap', '{"who":"mine","limit":300,"per_status":true}');
  perform pg_temp.ty_check('Y-CAP', 'past a 300 To do, In progress and Done still show',
    (select string_agg(s || '=' || n, ' ' order by s) from (select c->>'status' s, count(*) n from jsonb_array_elements(v->'cards') c group by 1) z),
    'doing=3 done=3 todo=300');
  perform pg_temp.ty_check('Y-CAP', 'each column says its real total, what came back and whether it is cut',
    format('%s/%s/%s %s/%s/%s %s/%s/%s', v #>> '{columns,todo,total}', v #>> '{columns,todo,shown}', v #>> '{columns,todo,truncated}',
      v #>> '{columns,doing,total}', v #>> '{columns,doing,shown}', v #>> '{columns,doing,truncated}',
      v #>> '{columns,done,total}', v #>> '{columns,done,shown}', v #>> '{columns,done,truncated}'),
    '303/300/true 3/3/false 3/3/false');
  perform pg_temp.ty_check('Y-CAP', 'columns and counts agree; the list says it is cut',
    format('%s %s %s %s', ((v #>> '{counts,todo}') = (v #>> '{columns,todo,total}'))::text, ((v #>> '{counts,doing}') = (v #>> '{columns,doing,total}'))::text,
      ((v #>> '{counts,done}') = (v #>> '{columns,done,total}'))::text, v->>'truncated'), 'true true true true');

  v := pg_temp.ty_list('cap', '{"who":"mine","limit":2,"per_status":true}');
  perform pg_temp.ty_check('Y-CAP', 'limit 2 per column: To do oldest due, In progress oldest due, Done latest due',
    (select string_agg(c->>'status' || ':' || (c->>'due_on'), ' ' order by o) from jsonb_array_elements(v->'cards') with ordinality t(c, o)),
    (select string_agg(x, ' ') from (
       (select 'todo:' || due_on::text x from public.ops_work_cards w where title like 'Y4270 Cap todo%' order by due_on, number limit 2)
       union all (select 'doing:' || ((now() AT TIME ZONE 'UTC')::date - 4)::text)
       union all (select 'doing:' || ((now() AT TIME ZONE 'UTC')::date + 3)::text)
       union all (select 'done:' || ((now() AT TIME ZONE 'UTC')::date + 5)::text)
       union all (select 'done:' || ((now() AT TIME ZONE 'UTC')::date - 2)::text)) z));
  perform pg_temp.ty_check('Y-CAP', 'every column is cut at 2 and says so; totals stay true',
    format('%s/%s %s/%s %s/%s', v #>> '{columns,todo,shown}', v #>> '{columns,todo,total}', v #>> '{columns,doing,shown}', v #>> '{columns,doing,total}',
      v #>> '{columns,done,shown}', v #>> '{columns,done,total}'), '2/303 2/3 2/3');

  v_t := pg_temp.ty_as('cap', $q$select public.ops_work_list('{"who":"mine","per_status":true,"offset":1}'::jsonb)::text$q$);
  perform pg_temp.ty_like('Y-CAP', 'per_status with an offset is refused', v_t, 'ERR:22023:invalid_query:%');
  v_t := pg_temp.ty_as('cap', $q$select public.ops_work_list('{"who":"mine","per_status":"true"}'::jsonb)::text$q$);
  perform pg_temp.ty_like('Y-CAP', 'per_status must be a boolean', v_t, 'ERR:22023:invalid_query:%');

  v := pg_temp.ty_list('cap', '{"who":"mine"}');
  perform pg_temp.ty_check('Y-CAP', 'without per_status the agent''s single page is unchanged: 200, In progress past the cut',
    format('%s %s %s', jsonb_array_length(v->'cards'), v->>'per_status',
      (select count(*) from jsonb_array_elements(v->'cards') c where c->>'status' <> 'todo')), '200 false 0');
end;
$cap$;

-- ---------------------------------------------------------------------------
-- Y-WEEK: for each zone and each allowed today, cards closed one second
-- before and exactly at the viewer's Monday 00:00.
-- ---------------------------------------------------------------------------
do $week$
declare
  v jsonb; v_tz text; v_off integer; v_today date; v_ws timestamptz; v_utc date := (now() AT TIME ZONE 'UTC')::date;
  v_bad text := '';
  v_la timestamptz; v_u timestamptz;
begin
  foreach v_tz in array array['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata'] loop
    foreach v_off in array array[-1, 0, 1] loop
      v_today := v_utc + v_off;
      v_ws := public.ops_monday(v_today)::timestamp AT TIME ZONE v_tz;
      delete from public.ops_work_cards w using public.ops_work_people p
       where p.card_id = w.id and p.email = 'week.y4270@test.local';
      perform pg_temp.ty_card('Y4270 Week before', 'done', 'week.y4270@test.local', -1, v_ws - interval '1 second');
      perform pg_temp.ty_card('Y4270 Week at',     'done', 'week.y4270@test.local', -1, v_ws);
      perform pg_temp.ty_card('Y4270 Week now',    'done', 'week.y4270@test.local', 0, now());
      v := pg_temp.ty_list('wk', jsonb_build_object('who', 'mine', 'today', v_today, 'tz', v_tz, 'limit', 300, 'per_status', true));
      if (v->>'done_since')::timestamptz is distinct from v_ws then
        v_bad := v_bad || format(' [%s %s done_since %s, want %s]', v_tz, v_today, v->>'done_since', v_ws);
      end if;
      if (select string_agg(replace(c->>'title', 'Y4270 Week ', ''), ',' order by c->>'title') from jsonb_array_elements(v->'cards') c)
         is distinct from (case when v_ws <= now() then 'at,now' else null end) then
        v_bad := v_bad || format(' [%s %s cards %s]', v_tz, v_today,
          (select string_agg(c->>'title', ',') from jsonb_array_elements(v->'cards') c));
      end if;
      if (v #>> '{counts,done}') is distinct from (v #>> '{columns,done,total}')
         or (v #>> '{columns,done,total}')::integer <> jsonb_array_length(v->'cards') then
        v_bad := v_bad || format(' [%s %s counts %s columns %s cards %s]', v_tz, v_today, v #>> '{counts,done}', v #>> '{columns,done,total}', jsonb_array_length(v->'cards'));
      end if;
    end loop;
  end loop;
  perform pg_temp.ty_check('Y-WEEK', 'every zone and every allowed today: Monday 00:00 there, one second before is out, at it is in, counts agree',
    nullif(v_bad, ''), null);

  -- Between the Los Angeles Monday and the UTC Monday (LA is behind UTC).
  v_la := public.ops_monday(v_utc)::timestamp AT TIME ZONE 'America/Los_Angeles';
  v_u  := public.ops_monday(v_utc)::timestamp AT TIME ZONE 'UTC';
  delete from public.ops_work_cards w using public.ops_work_people p where p.card_id = w.id and p.email = 'week.y4270@test.local';
  perform pg_temp.ty_card('Y4270 Week between zones', 'done', 'week.y4270@test.local', -1, v_u + (v_la - v_u) / 2);
  perform pg_temp.ty_check('Y-WEEK', 'closed between the UTC and the Los Angeles Monday: Done for UTC, not for Los Angeles',
    format('utc=%s la=%s',
      pg_temp.ty_list('wk', jsonb_build_object('who', 'mine', 'today', v_utc, 'tz', 'UTC')) #>> '{counts,done}',
      pg_temp.ty_list('wk', jsonb_build_object('who', 'mine', 'today', v_utc, 'tz', 'America/Los_Angeles')) #>> '{counts,done}'),
    'utc=1 la=0');
  perform pg_temp.ty_check('Y-WEEK', 'a today two days off is not trusted: the UTC day is used',
    (pg_temp.ty_list('wk', jsonb_build_object('who', 'mine', 'today', v_utc + 2, 'tz', 'UTC')) ->> 'today'), v_utc::text);
end;
$week$;

select count(*) as ty_total, count(*) filter (where not ok) as ty_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as ty_failures
  from ty_results \gset
rollback;

select (:ty_total < 11 or :ty_failed > 0) as ty_bad \gset
\if :ty_bad
  \echo 'ISSUE-4270 W1 RETEST TESTER FAILED:' :ty_failed 'of' :ty_total
  \echo :ty_failures
  do $$ begin raise exception 'ISSUE-4270 W1 RETEST TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W1 RETEST TESTER PASS:' :ty_total 'checks, 0 failed'
