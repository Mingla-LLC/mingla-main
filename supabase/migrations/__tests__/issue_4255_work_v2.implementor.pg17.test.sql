-- Issue #4255 (Work board v2, wave W1a) -- implementor happy path for
-- 20280610004255_issue_4255_work_v2_schema.sql and
-- 20280610014255_issue_4255_work_v2_functions.sql, on the fully replayed
-- PG17 schema.
-- MINGLA-INVARIANT: I-4255-STATUS-IS-COLUMN-GROUP | issue #4255 | ops_work_cards.status always equals the group (todo, doing, done) of its status_id column; a write of either keeps the other in step.
-- MINGLA-INVARIANT: I-4255-SUBTASK-TREE | issue #4255 | a card is never its own ancestor and is at most two levels below a top-level card; an open subtask never sits under a closed card.
-- MINGLA-INVARIANT: I-4255-PARENT-CLOSES-WITH-CHILDREN-ONLY-ON-ASK | issue #4255 | a card with open subtasks closes only when the closer asked to close them too (or it is a system close or a push back), and then they close with it.
-- MINGLA-INVARIANT: I-4255-FIVE-GOALS | issue #4255 | a sprint has at most five live goals.
-- MINGLA-INVARIANT: I-4255-WORK-V2-PT409 | issue #4255 | every new Work v2 write that takes an expected revision refuses a stale one with SQLSTATE PT409 (never 40001).
--
--   C-COLS    the three seeded columns; a new card lands in To do; a status
--             change lands in the group's first column; a move to a custom
--             Active column keeps status doing; a status write from there
--             lands in To do; a mismatched write is refused; only an admin
--             in person changes columns
--   C-MOVE    a stale move is refused with PT409; Closed needs proof; with
--             proof the card closes into the chosen Closed column; out of
--             Closed it reopens
--   C-ARCH    a column's cards move to another column of its group; another
--             group, the column itself or the last column of a group is
--             refused; an archived column takes no card
--   C-TREE    subtask and sub-subtask depths; a third level, a cycle and a
--             too-deep move are refused; an open subtask under a closed card
--             is refused; archiving a card archives its subtasks; subtasks
--             share titles with open cards
--   C-CLOSE   a card with an open subtask does not close; with
--             close_children both close; a push back closes them too; an
--             open plan step never blocks a close and closes with the card
--   C-PLAN    legacy plan steps become subtasks (title, done, named owner,
--             person step owner), the plan column empties and the plan
--             reads back from subtasks; a plan written with ops_work_update
--             maps step n onto the n-th subtask and keeps a teammate's own
--             subtask title; add_work with a plan makes subtasks; the board
--             lists top-level cards with progress, show-subtasks lists all
--   C-FILE    25 MB is the cap; a stored file has an upload path, is not
--             signed before its upload and is after; archived it is gone;
--             a Files link is a link file and follows the card
--   C-MSG     a message that mentions a teammate leaves one bell item and one
--             "<who> tagged you: <card>" email; a reply tells the author; a
--             stale edit is PT409; delete hides words and files; reactions;
--             a legacy note becomes a message with its mention; ops_work_note
--             writes a message; an agent cannot mention everyone
--   C-GOAL    five goals, the sixth refused; goal title bounds; agents may
--             not plan; a card takes a goal of its sprint only; goal progress
--   C-CAP     capacity 0 to 80 in tenths; the planner sums estimates against
--             it; Start sprint keeps a baseline and a later card is added
--             mid-sprint; the review note is one line of 200
--   C-RLS     no client reads a new table directly
--
-- FAILS-ON-REVERT (proved by deleting lines from the migration, then
-- restoring): without the trigger ops_4255_a_status_sync, C-COLS fails (a
-- status change leaves the card in its old column); without the trigger
-- ops_4255_b_tree_guard, C-TREE fails (the cycle and the third level are
-- written).
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t42_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t42_people (who, id, email) values
  ('owner',  '42550000-0000-4000-a0f2-000000000001', 'oz.v4255@test.local'),
  ('admin',  '42550000-0000-4000-a0f2-000000000002', 'ade.v4255@test.local'),
  ('growth', '42550000-0000-4000-a0f2-000000000003', 'gem.v4255@test.local'),
  ('ray',    '42550000-0000-4000-a0f2-000000000004', 'ray.v4255@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t42_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.v4255@test.local', 'owner', 'active', now()),
  ('ade.v4255@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gem.v4255@test.local', 'growth', 'active', now()),
  ('ray.v4255@test.local', 'growth', 'active', now());

create temp table t42_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t42_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t42_people where who = p_who;
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

-- Earlier request rows belong to a finished request.
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

-- A connected agent calling a function directly, as the gateway does.
create function pg_temp.agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from t42_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;

create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into t42_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;

create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into t42_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;

create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into t42_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from t42_ids where k = p_k $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from t42_ids where k = p_k) $fn$;
create function pg_temp.col(p_k text) returns text
language sql as $fn$
  select w.status || '/' || s.name from public.ops_work_cards w join public.ops_work_statuses s on s.id = w.status_id
   where w.id = (select id from t42_ids where k = p_k)
$fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from t42_people where who = p_who $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 't42-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;
create function pg_temp.status_id(p_name text) returns uuid
language sql as $fn$ select id from public.ops_work_statuses where name = p_name and archived_at is null $fn$;

-- Add one card as a person; keep its id under p_k.
create function pg_temp.add(p_k text, p_who text, p_item jsonb) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(p_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;

create function pg_temp.item(p_title text, p_owner text default 'gem.v4255@test.local') returns jsonb
language sql as $fn$
  select jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'owners', jsonb_build_array(p_owner), 'due_on', pg_temp.today() + 3);
$fn$;

-- ───────────────────────────── C-COLS ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.chk('C-COLS', 'three seeded columns, one per group, in order',
    (select string_agg(name || ':' || grp, ',' order by position) from public.ops_work_statuses where archived_at is null),
    'To do:todo,In progress:doing,Done:done');
  v := pg_temp.add('A', 'growth', pg_temp.item('V4255 Column card'));
  perform pg_temp.chk('C-COLS', 'a new card lands in To do', pg_temp.col('A'), 'todo/To do');
  v := pg_temp.person('growth', format('select public.ops_work_update(%L, ''{"status":"doing"}''::jsonb, %s)::text', pg_temp.id('A'), pg_temp.rev('A')));
  perform pg_temp.chk('C-COLS', 'a status change lands in the group''s first column', pg_temp.col('A'), 'doing/In progress');
  -- a custom Active column, by an admin in person
  v := pg_temp.person('growth', $q$select public.ops_status_add('Review', '#C27A12', 'doing')::text$q$);
  perform pg_temp.lk('C-COLS', 'a teammate who is not an admin cannot add a column', v, 'ERR:42501:forbidden:%');
  v := pg_temp.agent('owner', $q$select public.ops_status_add('Review', '#C27A12', 'doing')::text$q$);
  perform pg_temp.lk('C-COLS', 'an agent cannot add a column', v, 'ERR:42501:forbidden:%');
  v := pg_temp.person('admin', $q$select public.ops_status_add('Review', '#C27A12', 'doing')::text$q$);
  perform pg_temp.chk('C-COLS', 'an admin adds Review after In progress, colour stored lower case',
    (select string_agg(name || ':' || grp || ':' || color, ',' order by position) from public.ops_work_statuses where archived_at is null),
    'To do:todo:#8a847b,In progress:doing:#2f6fd6,Review:doing:#c27a12,Done:done:#1f8a5b');
  v := pg_temp.person('admin', $q$select public.ops_status_add('review', '#000000', 'todo')::text$q$);
  perform pg_temp.lk('C-COLS', 'a second column with the same name is refused', v, 'ERR:22023:duplicate_column:%');
  v := pg_temp.person('growth', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('A'), pg_temp.status_id('Review'), pg_temp.rev('A')));
  perform pg_temp.chk('C-COLS', 'a move to Review keeps status doing', pg_temp.col('A'), 'doing/Review');
  perform pg_temp.chk('C-COLS', 'the card JSON names its column',
    (v::jsonb)->'card'->'column'->>'name' || '/' || ((v::jsonb)->'card'->>'status_id' = pg_temp.status_id('Review')::text)::text, 'Review/true');
  v := pg_temp.person('growth', format('select public.ops_work_update(%L, ''{"title":"V4255 Column card renamed"}''::jsonb, %s)::text', pg_temp.id('A'), pg_temp.rev('A')));
  perform pg_temp.chk('C-COLS', 'a change that leaves the status alone leaves the column alone', pg_temp.col('A'), 'doing/Review');
  v := pg_temp.person('growth', format('select public.ops_work_update(%L, ''{"status":"todo"}''::jsonb, %s)::text', pg_temp.id('A'), pg_temp.rev('A')));
  perform pg_temp.chk('C-COLS', 'a status write from Review lands in To do', pg_temp.col('A'), 'todo/To do');
  begin
    update public.ops_work_cards set status = 'done', status_id = pg_temp.status_id('Review') where id = pg_temp.id('A');
    perform pg_temp.chk('C-COLS', 'a write where status and column disagree is refused', 'written', 'refused');
  exception when others then
    perform pg_temp.lk('C-COLS', 'a write where status and column disagree is refused', sqlerrm, 'status_mismatch:%');
  end;
  update public.ops_work_cards set status_id = pg_temp.status_id('Review') where id = pg_temp.id('A');
  perform pg_temp.chk('C-COLS', 'a write of the column alone sets the status', pg_temp.col('A'), 'doing/Review');
  perform pg_temp.chk('C-COLS', 'ops_config lists the columns and says who may change them',
    pg_temp.person('admin', $q$select (public.ops_config()->'me'->>'can_columns') || '/' || jsonb_array_length(public.ops_config()->'columns')$q$), 'true/4');
  perform pg_temp.chk('C-COLS', 'a teammate reads the columns but cannot change them',
    pg_temp.person('growth', $q$select (public.ops_status_list()->>'can_change') || '/' || jsonb_array_length(public.ops_status_list()->'columns')$q$), 'false/4');
end;
$t$;

-- ───────────────────────────── C-MOVE ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.add('M', 'growth', pg_temp.item('V4255 Move card'));
  v := pg_temp.person('growth', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('M'), pg_temp.status_id('Review'), pg_temp.rev('M') - 1));
  perform pg_temp.lk('C-MOVE', 'a stale move is refused with PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.person('growth', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('M'), pg_temp.status_id('Done'), pg_temp.rev('M')));
  perform pg_temp.lk('C-MOVE', 'into Closed without proof the close rules refuse it', v, 'ERR:%');
  perform pg_temp.chk('C-MOVE', 'and the card has not moved', pg_temp.col('M'), 'todo/To do');
  v := pg_temp.person('admin', $q$select public.ops_status_add('Shipped', '#1f8a5b', 'done')::text$q$);
  v := pg_temp.person('growth', format('select public.ops_work_move(%L, %L, %s, ''[{"kind":"text","text":"Checked it by hand."}]''::jsonb, ''Done.'')::text',
    pg_temp.id('M'), pg_temp.status_id('Shipped'), pg_temp.rev('M')));
  perform pg_temp.chk('C-MOVE', 'with proof it closes into the chosen Closed column', pg_temp.col('M'), 'done/Shipped');
  perform pg_temp.chk('C-MOVE', 'the close is a real close (who, when, kind)',
    (select (closed_by = pg_temp.email('growth'))::text || '/' || close_kind from public.ops_work_cards where id = pg_temp.id('M')), 'true/done');
  v := pg_temp.person('growth', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('M'), pg_temp.status_id('Review'), pg_temp.rev('M')));
  perform pg_temp.chk('C-MOVE', 'out of Closed it reopens into the chosen column', pg_temp.col('M'), 'doing/Review');
  perform pg_temp.chk('C-MOVE', 'and the close is gone', (select coalesce(close_kind, 'none') from public.ops_work_cards where id = pg_temp.id('M')), 'none');
  v := pg_temp.person('growth', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('M'), gen_random_uuid(), pg_temp.rev('M')));
  perform pg_temp.lk('C-MOVE', 'a column that is not there is refused', v, 'ERR:P0002:not_found:%');
end;
$t$;

-- ───────────────────────────── C-ARCH ─────────────────────────────
do $t$
declare v text; v_rev bigint;
begin
  select revision into v_rev from public.ops_work_statuses where id = pg_temp.status_id('Review');
  v := pg_temp.person('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('Review'), pg_temp.status_id('To do'), v_rev));
  perform pg_temp.lk('C-ARCH', 'cards may not change group when their column is archived', v, 'ERR:22023:invalid_column:%');
  v := pg_temp.person('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('Review'), pg_temp.status_id('Review'), v_rev));
  perform pg_temp.lk('C-ARCH', 'a column cannot take its own cards', v, 'ERR:22023:invalid_column:%');
  v := pg_temp.person('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('Review'), pg_temp.status_id('In progress'), v_rev - 1));
  perform pg_temp.lk('C-ARCH', 'a stale archive is refused with PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.person('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('Review'), pg_temp.status_id('In progress'), v_rev));
  perform pg_temp.chk('C-ARCH', 'Review is archived and its two cards move to In progress',
    ((v::jsonb)->>'moved') || '/' || pg_temp.col('A') || '/' || pg_temp.col('M'), '2/doing/In progress/doing/In progress');
  perform pg_temp.chk('C-ARCH', 'the live columns are numbered again',
    (select string_agg(name || ':' || position, ',' order by position) from public.ops_work_statuses where archived_at is null),
    'To do:0,In progress:1,Done:2,Shipped:3');
  v := pg_temp.person('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('To do'), pg_temp.status_id('In progress'),
    (select revision from public.ops_work_statuses where name = 'To do')));
  perform pg_temp.lk('C-ARCH', 'the last Not started column cannot be archived', v, 'ERR:22023:last_column:%');
  begin
    update public.ops_work_cards set status_id = (select id from public.ops_work_statuses where name = 'Review') where id = pg_temp.id('A');
    perform pg_temp.chk('C-ARCH', 'an archived column takes no card', 'written', 'refused');
  exception when others then
    perform pg_temp.lk('C-ARCH', 'an archived column takes no card', sqlerrm, 'column_archived:%');
  end;
end;
$t$;

-- ───────────────────────────── C-TREE ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.add('P', 'growth', pg_temp.item('V4255 Parent card'));
  v := pg_temp.person('growth', format('select public.ops_subtask_add(%L, ''{"title":"Send the email"}''::jsonb, %L)::text', pg_temp.id('P'), pg_temp.rk()));
  perform pg_temp.keep('S1', ((v::jsonb)->'subtask'->>'id')::uuid);
  perform pg_temp.chk('C-TREE', 'a subtask needs only a title: depth 1, the parent''s due date and sprint',
    (select w.depth || '/' || (w.due_on = p.due_on)::text || '/' || (w.sprint_id = p.sprint_id)::text || '/' || w.position
       from public.ops_work_cards w join public.ops_work_cards p on p.id = w.parent_id where w.id = pg_temp.id('S1')), '1/true/true/0');
  v := pg_temp.add('T', 'growth', pg_temp.item('Send the email'));
  perform pg_temp.chk('C-TREE', 'an open top-level card may share a subtask''s title', (v::jsonb)->'results'->0->>'status', 'added');
  v := pg_temp.person('growth', format('select public.ops_subtask_add(%L, ''{"title":"Write the words"}''::jsonb, %L)::text', pg_temp.id('S1'), pg_temp.rk()));
  perform pg_temp.keep('S2', ((v::jsonb)->'subtask'->>'id')::uuid);
  perform pg_temp.chk('C-TREE', 'a sub-subtask is depth 2', (select depth::text from public.ops_work_cards where id = pg_temp.id('S2')), '2');
  v := pg_temp.person('growth', format('select public.ops_subtask_add(%L, ''{"title":"Too deep a step"}''::jsonb, %L)::text', pg_temp.id('S2'), pg_temp.rk()));
  perform pg_temp.lk('C-TREE', 'a third level is refused', v, '%Subtasks go two levels deep at most%');
  begin
    update public.ops_work_cards set parent_id = pg_temp.id('S2') where id = pg_temp.id('P');
    perform pg_temp.chk('C-TREE', 'a card cannot become a subtask of its own subtask', 'written', 'refused');
  exception when others then
    perform pg_temp.lk('C-TREE', 'a card cannot become a subtask of its own subtask', sqlerrm, 'invalid_parent:%');
  end;
  begin
    update public.ops_work_cards set parent_id = pg_temp.id('S1') where id = pg_temp.id('T');
    update public.ops_work_cards set parent_id = pg_temp.id('T') where id = pg_temp.id('S1');
    perform pg_temp.chk('C-TREE', 'a two-card loop is refused', 'written', 'refused');
  exception when others then
    perform pg_temp.lk('C-TREE', 'a two-card loop is refused', sqlerrm, 'invalid_parent:%');
  end;
  begin
    update public.ops_work_cards set depth = 0 where id = pg_temp.id('S2');
    perform pg_temp.chk('C-TREE', 'depth cannot be written by hand', (select depth::text from public.ops_work_cards where id = pg_temp.id('S2')), '2');
  exception when others then
    perform pg_temp.chk('C-TREE', 'depth cannot be written by hand', sqlerrm, 'kept');
  end;
  v := pg_temp.add('Q', 'growth', pg_temp.item('V4255 Second parent'));
  v := pg_temp.person('growth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('S1'),
    jsonb_build_object('parent', pg_temp.id('Q')), pg_temp.rev('S1')));
  perform pg_temp.chk('C-TREE', 'a subtask moves to another card with its own subtask',
    (select w.parent_id = pg_temp.id('Q') from public.ops_work_cards w where w.id = pg_temp.id('S1'))::text || '/' ||
    (select depth::text from public.ops_work_cards where id = pg_temp.id('S2')), 'true/2');
  v := pg_temp.person('growth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('Q'),
    jsonb_build_object('parent', pg_temp.id('P')), pg_temp.rev('Q')));
  perform pg_temp.lk('C-TREE', 'a card with a sub-subtask cannot go under another card (too deep)', v, 'ERR:22023:too_deep:%');
  v := pg_temp.person('growth', format('select public.ops_work_close(%L, ''[{"kind":"text","text":"Checked it by hand."}]''::jsonb, NULL, %s)::text', pg_temp.id('P'), pg_temp.rev('P')));
  v := pg_temp.person('growth', format('select public.ops_subtask_add(%L, ''{"title":"Late step"}''::jsonb, %L)::text', pg_temp.id('P'), pg_temp.rk()));
  perform pg_temp.lk('C-TREE', 'no new open subtask under a closed card', v, '%The parent card is closed%');
  v := pg_temp.agent('ray', format('select public.ops_subtask_add(%L, ''{"title":"Agent step"}''::jsonb, %L)::text', pg_temp.id('Q'), pg_temp.rk()));
  perform pg_temp.lk('C-TREE', 'an agent adds a subtask only under a card its person owns', v, '%Your person is not an owner of the parent card%');
  v := pg_temp.agent('growth', format('select public.ops_subtask_add(%L, ''{"title":"Agent step","owners":["ray.v4255@test.local"],"description":"Copy the text below and send it to the venue today."}''::jsonb, %L)::text', pg_temp.id('Q'), pg_temp.rk()));
  perform pg_temp.chk('C-TREE', 'its person''s agent can, with an owner and a description that becomes the instructions',
    (v::jsonb)->>'status' || '/' || ((v::jsonb)->'subtask'->'owners'->0->>'email') || '/' ||
    (select instructions from public.ops_work_cards where id = ((v::jsonb)->'subtask'->>'id')::uuid),
    'added/ray.v4255@test.local/Copy the text below and send it to the venue today.');
  v := pg_temp.person('admin', format('select public.ops_work_archive(%L, ''Not needed now.'')::text', pg_temp.id('Q')));
  perform pg_temp.chk('C-TREE', 'archiving a card archives its subtasks and theirs',
    (select count(*)::text from public.ops_work_cards where parent_id in (pg_temp.id('Q'), pg_temp.id('S1')) and archived_at is null), '0');
end;
$t$;

-- ───────────────────────────── C-CLOSE ─────────────────────────────
do $t$
declare v text; v_sub uuid;
begin
  v := pg_temp.add('K', 'growth', pg_temp.item('V4255 Card with an open subtask'));
  v := pg_temp.person('growth', format('select public.ops_subtask_add(%L, ''{"title":"Open step"}''::jsonb, %L)::text', pg_temp.id('K'), pg_temp.rk()));
  v_sub := ((v::jsonb)->'subtask'->>'id')::uuid;
  v := pg_temp.person('growth', format('select public.ops_work_close(%L, ''[{"kind":"text","text":"Checked it by hand."}]''::jsonb, NULL, %s)::text', pg_temp.id('K'), pg_temp.rev('K')));
  perform pg_temp.lk('C-CLOSE', 'a card with an open subtask does not close', v, 'ERR:22023:open_subtasks: This card has 1 open subtask.%');
  v := pg_temp.person('growth', format('select public.ops_work_move(%L, %L, %s, ''[{"kind":"text","text":"Checked it by hand."}]''::jsonb, NULL, true)::text',
    pg_temp.id('K'), pg_temp.status_id('Done'), pg_temp.rev('K')));
  perform pg_temp.chk('C-CLOSE', 'close_children closes the card and its subtask',
    pg_temp.col('K') || '/' || (select status || ':' || close_kind || ':' || close_reason from public.ops_work_cards where id = v_sub),
    'done/Done/done:done:Closed with Card ' || (select number from public.ops_work_cards where id = pg_temp.id('K')) || '.');
  perform pg_temp.chk('C-CLOSE', 'the ask does not outlive the move', coalesce(current_setting('ops.close_children', true), ''), '');
  v := pg_temp.add('K2', 'growth', pg_temp.item('V4255 Pushed back card'));
  v := pg_temp.person('growth', format('select public.ops_subtask_add(%L, ''{"title":"Open step"}''::jsonb, %L)::text', pg_temp.id('K2'), pg_temp.rk()));
  v_sub := ((v::jsonb)->'subtask'->>'id')::uuid;
  v := pg_temp.person('growth', format('select public.ops_work_push_back(%L, ''declined'', ''Not needed any more, the host cancelled.'', ''[]''::jsonb, %s)::text',
    pg_temp.id('K2'), pg_temp.rev('K2')));
  perform pg_temp.chk('C-CLOSE', 'a push back closes the open subtasks with it',
    (select status || ':' || close_kind from public.ops_work_cards where id = v_sub), 'done:declined');
  -- An open step from a plan never blocks a close (closing never waited for
  -- plan steps); it closes with the card as a system close.
  v := pg_temp.add('K3', 'growth', pg_temp.item('V4255 Card with an open plan step') || '{"plan":[{"n":1,"text":"Check the venue","tool":"person"}]}'::jsonb);
  v := pg_temp.person('growth', format('select public.ops_work_close(%L, ''[{"kind":"text","text":"Checked it by hand."}]''::jsonb, NULL, %s)::text', pg_temp.id('K3'), pg_temp.rev('K3')));
  perform pg_temp.chk('C-CLOSE', 'an open plan step does not block the close and closes with it as a system close',
    pg_temp.col('K3') || '/' || (select status || ':' || close_kind from public.ops_work_cards where parent_id = pg_temp.id('K3')), 'done/Done/done:system');
end;
$t$;

-- ───────────────────────────── C-PLAN ─────────────────────────────
do $t$
declare v text; v_card uuid; v_subs text; v_rev bigint;
begin
  -- A card as it was before #4255: its plan in the plan column.
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id, plan, created_by, updated_by)
  values ('V4255 Legacy plan card', 'Walk the plan with the host.', 'Every step is marked.', 'todo', pg_temp.today() + 5, 'explicit',
    public.ops_sprint_ensure(pg_temp.today()),
    jsonb_build_array(
      jsonb_build_object('n', 1, 'text', 'Call the host', 'tool', 'person', 'status', 'done', 'result', 'Called'),
      jsonb_build_object('n', 2, 'text', 'Ray checks the flyer', 'tool', 'list_content', 'status', 'todo'),
      jsonb_build_object('n', 3, 'text', 'Log the reply', 'tool', 'record_reply', 'status', 'failed')),
    'system@usemingla.com', 'system@usemingla.com')
  returning id into v_card;
  perform pg_temp.keep('L', v_card);
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_card, 'gem.v4255@test.local', 'owner', 'system@usemingla.com');
  v_rev := pg_temp.rev('L');
  v := public.ops_4255_plan_to_subtasks()::text;
  perform pg_temp.chk('C-PLAN', 'the backfill turns the legacy plan into three subtasks', (v::jsonb)->>'subtasks', '3');
  select string_agg(w.title || ':' || w.status || ':' || coalesce((select string_agg(p.email, '+') from public.ops_work_people p where p.card_id = w.id), '-'), ',' order by w.position)
    into v_subs from public.ops_work_cards w where w.parent_id = v_card;
  perform pg_temp.chk('C-PLAN', 'titles, done steps closed, the named teammate and the person step''s owner',
    v_subs, 'Call the host:done:gem.v4255@test.local,Ray checks the flyer:todo:ray.v4255@test.local,Log the reply:todo:-');
  perform pg_temp.chk('C-PLAN', 'the plan column is empty and the card''s revision went up',
    (select plan::text || '/' || (revision = v_rev + 1)::text from public.ops_work_cards where id = v_card), '[]/true');
  perform pg_temp.chk('C-PLAN', 'the plan reads back from the subtasks in its old shape',
    (select string_agg((s->>'n') || ':' || (s->>'tool') || ':' || (s->>'status') || ':' || coalesce(s->>'result', '-'), ',' order by (s->>'n')::int)
       from jsonb_array_elements(public.ops_plan_from_subtasks(v_card)) s),
    '1:person:done:Called,2:list_content:todo:-,3:record_reply:failed:-');
  perform pg_temp.chk('C-PLAN', 'the backfill runs once', (public.ops_4255_plan_to_subtasks()->>'cards'), '0');
  -- A teammate adds their own subtask; then a plan arrives with step 4.
  v := pg_temp.person('growth', format('select public.ops_subtask_add(%L, ''{"title":"Book the room"}''::jsonb, %L)::text', v_card, pg_temp.rk()));
  v := pg_temp.person('growth', format($q$select public.ops_work_update(%L, '{"plan":[
      {"n":1,"text":"Call the host","tool":"person","status":"done","result":"Called"},
      {"n":2,"text":"Ray checks the flyer","tool":"list_content","status":"done","result":"Flyer is right"},
      {"n":3,"text":"Log the reply","tool":"record_reply","status":"todo"},
      {"n":4,"text":"Ask about the room","tool":"person","status":"done"},
      {"n":5,"text":"Send the recap","tool":"person"}]}'::jsonb, %s)::text$q$, v_card, pg_temp.rev('L')));
  select string_agg(w.title || ':' || w.status, ',' order by w.position) into v_subs from public.ops_work_cards w where w.parent_id = v_card and w.archived_at is null;
  perform pg_temp.chk('C-PLAN', 'step n is the n-th subtask; a teammate''s own subtask keeps its title; step 5 is added',
    v_subs, 'Call the host:done,Ray checks the flyer:done,Log the reply:todo,Book the room:done,Send the recap:todo');
  perform pg_temp.chk('C-PLAN', 'the step''s result is kept',
    (select s->>'result' from jsonb_array_elements(public.ops_plan_from_subtasks(v_card)) s where s->>'n' = '2'), 'Flyer is right');
  v := pg_temp.person('growth', format($q$select public.ops_work_update(%L, '{"plan":[
      {"n":1,"text":"Call the host","tool":"person","status":"todo"}]}'::jsonb, %s)::text$q$, v_card, pg_temp.rev('L')));
  select string_agg(w.title || ':' || w.status, ',' order by w.position) into v_subs from public.ops_work_cards w where w.parent_id = v_card and w.archived_at is null;
  perform pg_temp.chk('C-PLAN', 'a shorter plan reopens step 1 and removes only the open plan subtasks it no longer has',
    v_subs, 'Call the host:todo,Ray checks the flyer:done,Book the room:done');
  -- add_work with a plan
  v := pg_temp.add('W', 'growth', pg_temp.item('V4255 Planned card') || '{"plan":[{"n":1,"text":"Draft it","tool":"person"},{"n":2,"text":"Ship it","tool":"person"}]}'::jsonb);
  perform pg_temp.chk('C-PLAN', 'add_work with a plan makes its subtasks',
    (select string_agg(title, ',' order by position) from public.ops_work_cards where parent_id = pg_temp.id('W')), 'Draft it,Ship it');
  perform pg_temp.chk('C-PLAN', 'the card JSON carries progress and the plan',
    ((v::jsonb)->'results'->0->'card'->'subtasks'->>'total') || '/' || jsonb_array_length((v::jsonb)->'results'->0->'card'->'plan'), '2/2');
  -- the board: top-level by default, subtasks on ask
  perform pg_temp.chk('C-PLAN', 'the board lists top-level cards only by default, with their progress',
    pg_temp.person('growth', $q$select (select count(*) from jsonb_array_elements(public.ops_work_list('{"q":"Ship it"}')->'cards'))::text
      || '/' || (select c->'subtasks'->>'total' from jsonb_array_elements(public.ops_work_list('{"q":"V4255 Planned card"}')->'cards') c)$q$), '0/2');
  perform pg_temp.chk('C-PLAN', 'one card''s subtasks by parent_id',
    pg_temp.person('growth', format($q$select (select string_agg(c->>'title', ',' order by c->>'title') from jsonb_array_elements(public.ops_work_list('{"parent_id":"%s"}')->'cards') c)$q$, pg_temp.id('W'))),
    'Draft it,Ship it');
  perform pg_temp.chk('C-PLAN', 'show subtasks lists them with their parent',
    pg_temp.person('growth', $q$select (select string_agg(c->>'title' || '<' || coalesce(c->'parent'->>'title', '-'), ',' order by c->>'title') from jsonb_array_elements(public.ops_work_list('{"q":"Ship it","subtasks":true}')->'cards') c)$q$),
    'Ship it<V4255 Planned card');
  perform pg_temp.chk('C-PLAN', 'ops_work_get carries the subtasks in order with the breadcrumb',
    pg_temp.person('growth', format($q$select (select string_agg(s->>'title', ',' order by (s->>'position')::int) from jsonb_array_elements(public.ops_work_get(%L)->'subtasks') s)
      || '/' || (public.ops_work_get(%L)->'ancestors'->0->>'title')$q$, pg_temp.id('W'),
      (select id from public.ops_work_cards where title = 'Ship it' and parent_id = pg_temp.id('W')))),
    'Draft it,Ship it/V4255 Planned card');
end;
$t$;

-- ───────────────────────────── C-FILE ─────────────────────────────
do $t$
declare v text; v_file uuid; v_path text;
begin
  v := pg_temp.add('F', 'growth', pg_temp.item('V4255 Files card') || '{"files_url":"https://drive.google.com/drive/folders/abc"}'::jsonb);
  perform pg_temp.chk('C-FILE', 'a Files link is a link file',
    (select kind || ':' || name || ':' || url from public.ops_work_files where card_id = pg_temp.id('F') and from_files_url and archived_at is null),
    'link:drive.google.com:https://drive.google.com/drive/folders/abc');
  v := pg_temp.person('growth', format($q$select public.ops_file_add(%L, '{"kind":"document","name":"Run sheet.pdf","mime":"application/pdf","size_bytes":26214401}'::jsonb)::text$q$, pg_temp.id('F')));
  perform pg_temp.chk('C-FILE', 'a file over 25 MB is refused', v, 'ERR:22023:file_too_big: Run sheet.pdf is over 25 MB. Share it as a link instead.');
  v := pg_temp.person('growth', format($q$select public.ops_file_add(%L, '{"kind":"image","name":"poster.svg","mime":"image/svg+xml","size_bytes":2000}'::jsonb)::text$q$, pg_temp.id('F')));
  perform pg_temp.lk('C-FILE', 'a picture type the card does not take is refused', v, 'ERR:22023:invalid_file: Pictures can be%');
  v := pg_temp.person('growth', format($q$select public.ops_file_add(%L, '{"kind":"document","name":"Run sheet (final).pdf","mime":"application/pdf","size_bytes":26214400}'::jsonb)::text$q$, pg_temp.id('F')));
  v_file := ((v::jsonb)->'file'->>'id')::uuid;
  v_path := (v::jsonb)->'upload'->>'path';
  perform pg_temp.chk('C-FILE', 'exactly 25 MB is taken, with a private upload path',
    ((v::jsonb)->'upload'->>'bucket') || '/' || (v_path = pg_temp.id('F')::text || '/' || v_file::text || '/Run_sheet_final_.pdf')::text, 'ops-work-files/true');
  -- The bucket's shape depends on the storage version (the migration probes it):
  -- never public, and 25 MB wherever the limit column exists.
  perform pg_temp.chk('C-FILE', 'the bucket is private with a 25 MB limit',
    (select coalesce(to_jsonb(b)->>'public', 'false') || '/' || coalesce(to_jsonb(b)->>'file_size_limit', '26214400')
       from storage.buckets b where b.id = 'ops-work-files'), 'false/26214400');
  v := pg_temp.person('ray', format('select public.ops_file_sign(%L)::text', v_file));
  perform pg_temp.lk('C-FILE', 'not signed before the upload is there', v, 'ERR:22023:not_uploaded:%');
  perform pg_temp.chk('C-FILE', 'the uploader may put the object; nobody else may',
    pg_temp.person('growth', format('select public.ops_file_can_upload(%L)::text', v_path)) || '/' || pg_temp.person('ray', format('select public.ops_file_can_upload(%L)::text', v_path)), 'true/false');
  insert into storage.objects (bucket_id, name) values ('ops-work-files', v_path);
  v := pg_temp.person('ray', format('select public.ops_file_sign(%L)::text', v_file));
  perform pg_temp.chk('C-FILE', 'after the upload a teammate gets the path to sign for 5 minutes',
    ((v::jsonb)->>'path' = v_path)::text || '/' || ((v::jsonb)->>'expires_in'), 'true/300');
  perform pg_temp.chk('C-FILE', 'the card lists two files', pg_temp.person('ray', format($q$select jsonb_array_length(public.ops_work_get(%L)->'files')::text$q$, pg_temp.id('F'))), '2');
  v := pg_temp.person('ray', format('select public.ops_file_archive(%L)::text', v_file));
  perform pg_temp.lk('C-FILE', 'a teammate who did not add it and does not own the card cannot remove it', v, 'ERR:42501:forbidden:%');
  v := pg_temp.person('growth', format('select public.ops_file_archive(%L)::text', v_file));
  perform pg_temp.chk('C-FILE', 'archived, it is neither signed nor readable',
    pg_temp.person('ray', format('select public.ops_file_sign(%L)::text', v_file)) || '|' || pg_temp.person('ray', format('select public.ops_file_can_read(%L)::text', v_path)),
    'ERR:P0002:not_found: That file is no longer here.|false');
  v := pg_temp.person('growth', format($q$select public.ops_work_update(%L, '{"files_url":"https://www.canva.com/design/xyz"}'::jsonb, %s)::text$q$, pg_temp.id('F'), pg_temp.rev('F')));
  perform pg_temp.chk('C-FILE', 'the link file follows the Files link',
    (select string_agg(url, ',') from public.ops_work_files where card_id = pg_temp.id('F') and from_files_url and archived_at is null), 'https://www.canva.com/design/xyz');
end;
$t$;

-- ───────────────────────────── C-MSG ─────────────────────────────
do $t$
declare v text; v_msg uuid; v_reply uuid; v_rev bigint; v_card uuid; v_ev uuid;
begin
  v := pg_temp.add('G', 'growth', pg_temp.item('V4255 Thread card'));
  v_card := pg_temp.id('G');
  v := pg_temp.person('owner', format($q$select public.ops_message_post(%L, 'Can you **check** the venue today?', array['Ray'], null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  v_msg := ((v::jsonb)->'message'->>'id')::uuid;
  perform pg_temp.chk('C-MSG', 'a mention by name tells that teammate once', (v::jsonb)->>'told', '1');
  perform pg_temp.chk('C-MSG', 'one bell item for the mention',
    (select count(*)::text from public.team_mentions m where m.target_user_id = '42550000-0000-4000-a0f2-000000000004' and m.source_id = ((v::jsonb)->>'event_id')::uuid), '1');
  perform pg_temp.chk('C-MSG', 'one email with the #4255 subject that names the card',
    (select string_agg(o.payload->>'title', '|') from public.notification_outbox o
      where o.category_key = 'admin.team_mention' and o.user_id = '42550000-0000-4000-a0f2-000000000004' and o.payload->>'card_id' = v_card::text
        and o.payload->>'body' like '%check%'),
    public.ops_actor_label('oz.v4255@test.local', NULL) || ' tagged you: V4255 Thread card');
  perform pg_temp.chk('C-MSG', 'the message has a note event for the history',
    (select action from public.ops_work_events where id = ((v::jsonb)->>'event_id')::uuid), 'note');
  v := pg_temp.person('ray', format($q$select public.ops_message_post(%L, 'On it.', '{}', %L, null, false, %L)::text$q$, v_card, v_msg, pg_temp.rk()));
  v_reply := ((v::jsonb)->'message'->>'id')::uuid;
  perform pg_temp.chk('C-MSG', 'a reply tells the author of the message', (v::jsonb)->>'told', '1');
  perform pg_temp.chk('C-MSG', 'the thread nests the reply under its message',
    pg_temp.person('growth', format($q$select (public.ops_message_list(%L)->'messages'->0->'replies'->0->>'body') || '/' || jsonb_array_length(public.ops_message_list(%L)->'messages')$q$, v_card, v_card)), 'On it./1');
  select revision into v_rev from public.ops_work_messages where id = v_msg;
  v := pg_temp.person('owner', format($q$select public.ops_message_edit(%L, 'Can you check the venue by noon?', %s)::text$q$, v_msg, v_rev - 1));
  perform pg_temp.lk('C-MSG', 'a stale edit is refused with PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.person('ray', format($q$select public.ops_message_edit(%L, 'Hijacked', %s)::text$q$, v_msg, v_rev));
  perform pg_temp.lk('C-MSG', 'only the author edits', v, 'ERR:42501:forbidden:%');
  v := pg_temp.person('owner', format($q$select public.ops_message_edit(%L, 'Can you check the venue by noon?', %s)::text$q$, v_msg, v_rev));
  perform pg_temp.chk('C-MSG', 'the author edits it', ((v::jsonb)->'message'->>'body') || '/' || ((v::jsonb)->'message'->>'edited_at' is not null)::text, 'Can you check the venue by noon?/true');
  v := pg_temp.person('ray', format($q$select public.ops_message_react(%L, '👍')::text$q$, v_msg));
  v := pg_temp.person('growth', format($q$select public.ops_message_react(%L, '👍')::text$q$, v_msg));
  perform pg_temp.chk('C-MSG', 'two reactions count as one emoji twice', (v::jsonb)->'message'->'reactions'->0->>'count', '2');
  v := pg_temp.person('growth', format($q$select public.ops_message_react(%L, '👍', false)::text$q$, v_msg));
  perform pg_temp.chk('C-MSG', 'a reaction is taken back', (v::jsonb)->'message'->'reactions'->0->>'count', '1');
  select revision into v_rev from public.ops_work_messages where id = v_reply;
  v := pg_temp.person('ray', format('select public.ops_message_delete(%L, %s)::text', v_reply, v_rev));
  perform pg_temp.chk('C-MSG', 'a deleted message keeps no words',
    (select (deleted_at is not null)::text || '/' || body_md from public.ops_work_messages where id = v_reply), 'true/');
  perform pg_temp.chk('C-MSG', 'and leaves the thread',
    pg_temp.person('growth', format($q$select jsonb_array_length(public.ops_message_list(%L)->'messages'->0->'replies')::text$q$, v_card)), '0');
  v := pg_temp.agent('growth', format($q$select public.ops_message_post(%L, 'Everyone look', '{}', null, null, true, %L)::text$q$, v_card, pg_temp.rk()));
  perform pg_temp.lk('C-MSG', 'an agent never mentions everyone', v, 'ERR:42501:forbidden:%');
  v := pg_temp.agent('ray', format($q$select public.ops_message_post(%L, 'Hello', '{}', null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  perform pg_temp.lk('C-MSG', 'an agent posts only on a card its person owns or watches', v, 'ERR:42501:not_your_card:%');
  v := pg_temp.agent('growth', format($q$select public.ops_message_post(%L, 'Venue confirmed by phone.', '{}', null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  perform pg_temp.chk('C-MSG', 'an owner''s agent posts with its label',
    ((v::jsonb)->'message'->>'agent') || '/' || ((v::jsonb)->'message'->>'author_name'), 'true/' || public.ops_actor_label('gem.v4255@test.local', 'claude'));
  v := pg_temp.person('growth', format($q$select public.ops_work_note(%L, 'A note from the old box.', array['oz.v4255@test.local'], %L)::text$q$, v_card, pg_temp.rk()));
  perform pg_temp.chk('C-MSG', 'ops_work_note writes a thread message and answers as before',
    (select body_md from public.ops_work_messages where id = ((v::jsonb)->>'message_id')::uuid) || '/' || ((v::jsonb)->>'told') || '/' ||
    ((select action from public.ops_work_events where id = ((v::jsonb)->>'event_id')::uuid)), 'A note from the old box./1/note');
  -- a note written before #4255, with its mention
  insert into public.ops_work_events (card_id, actor_email, via, action, body) values (v_card, 'ray.v4255@test.local', NULL, 'note', 'An old note for Gem.')
  returning id into v_ev;
  insert into public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link)
  values ('work_card', v_ev, '42550000-0000-4000-a0f2-000000000004', '42550000-0000-4000-a0f2-000000000003', 'An old note for Gem.', 'https://admin.usemingla.com/#/work-board?card=' || v_card);
  v := public.ops_4255_notes_to_messages()::text;
  v := v || '/' || public.ops_4255_notes_to_messages()::text;
  perform pg_temp.chk('C-MSG', 'the notes backfill copies an old note once, with its mention',
    v || '/' || (select body_md || ':' || array_to_string(mentions, ',') from public.ops_work_messages where event_id = v_ev), '1/0/An old note for Gem.:gem.v4255@test.local');
  perform pg_temp.chk('C-MSG', 'the card JSON counts the thread',
    pg_temp.person('growth', format($q$select public.ops_work_get(%L)->'card'->>'thread_count'$q$, v_card)), '4');
end;
$t$;

-- ───────────────────────────── C-GOAL ─────────────────────────────
do $t$
declare v text; v_sprint uuid := public.ops_sprint_ensure(pg_temp.today()); v_goal uuid; v_next uuid := public.ops_sprint_ensure(pg_temp.today() + 7); i integer;
begin
  for i in 1..5 loop
    v := pg_temp.person('growth', format('select public.ops_sprint_goal_add(%L, %L, %L)::text', v_sprint, 'V4255 goal ' || i, case when i = 1 then 'Gem' end));
    if i = 1 then v_goal := ((v::jsonb)->'goal'->>'id')::uuid; end if;
  end loop;
  perform pg_temp.chk('C-GOAL', 'five live goals, the first owned by Gem',
    (select count(*)::text from public.ops_sprint_goals where sprint_id = v_sprint and archived_at is null and title like 'V4255 goal %') || '/' ||
    (select owner_email from public.ops_sprint_goals where id = v_goal), '5/gem.v4255@test.local');
  v := pg_temp.person('growth', format('select public.ops_sprint_goal_add(%L, %L)::text', v_sprint, 'V4255 goal six'));
  perform pg_temp.lk('C-GOAL', 'a sixth goal is refused', v, 'ERR:22023:too_many_goals:%');
  v := pg_temp.person('growth', format('select public.ops_sprint_goal_add(%L, %L)::text', v_next, 'ab'));
  perform pg_temp.lk('C-GOAL', 'a goal is 3 to 80 characters', v, 'ERR:22023:invalid_goal:%');
  v := pg_temp.agent('growth', format('select public.ops_sprint_goal_add(%L, %L)::text', v_next, 'Agent goal'));
  perform pg_temp.lk('C-GOAL', 'an agent does not plan the sprint', v, 'ERR:42501:people_only:%');
  v := pg_temp.add('GC', 'growth', pg_temp.item('V4255 Goal card') || jsonb_build_object('goal', v_goal, 'estimate_minutes', 600));
  perform pg_temp.chk('C-GOAL', 'add_work takes a goal of this sprint and an estimate',
    (select (goal_id = v_goal)::text || '/' || estimate_minutes from public.ops_work_cards where id = pg_temp.id('GC')), 'true/600');
  v := pg_temp.person('growth', format('select public.ops_sprint_goal_add(%L, %L)::text', v_next, 'V4255 next week goal'));
  v := pg_temp.person('growth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('GC'),
    jsonb_build_object('goal', (v::jsonb)->'goal'->>'id'), pg_temp.rev('GC')));
  perform pg_temp.lk('C-GOAL', 'a card takes only a goal of its own sprint', v, 'ERR:22023:invalid_card:%That goal belongs to another sprint%');
  perform pg_temp.chk('C-GOAL', 'goal progress counts its cards',
    pg_temp.person('growth', format($q$select (g->>'cards') || '/' || (g->>'done') || '/' || (g->>'open_minutes') from jsonb_array_elements(public.ops_sprint_plan_get(%L)->'goals') g where g->>'id' = %L$q$, v_sprint, v_goal)),
    '1/0/600');
  v := pg_temp.person('growth', format($q$select public.ops_sprint_goal_update(%L, '{"state":"at_risk"}'::jsonb, %s)::text$q$, v_goal,
    (select revision from public.ops_sprint_goals where id = v_goal) - 1));
  perform pg_temp.lk('C-GOAL', 'a stale goal change is refused with PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.person('growth', format($q$select public.ops_sprint_goal_update(%L, '{"state":"at_risk"}'::jsonb, %s)::text$q$, v_goal,
    (select revision from public.ops_sprint_goals where id = v_goal)));
  perform pg_temp.chk('C-GOAL', 'a state set by hand holds while the numbers have not changed direction',
    ((v::jsonb)->'goal'->>'state') || '/' || ((v::jsonb)->'goal'->>'set_by_hand'), 'at_risk/true');
  v := pg_temp.person('growth', format('select public.ops_sprint_goal_archive(%L, %s)::text', v_goal, (select revision from public.ops_sprint_goals where id = v_goal)));
  perform pg_temp.chk('C-GOAL', 'archiving a goal takes it off its cards',
    ((v::jsonb)->>'cards') || '/' || (select coalesce(goal_id::text, 'none') from public.ops_work_cards where id = pg_temp.id('GC')), '1/none');
end;
$t$;

-- ───────────────────────────── C-CAP ─────────────────────────────
do $t$
declare v text; v_sprint uuid := public.ops_sprint_ensure(pg_temp.today()); v_rev bigint; v_late uuid;
begin
  v := pg_temp.person('growth', format('select public.ops_sprint_capacity_set(%L, %L, 80.1)::text', v_sprint, 'gem.v4255@test.local'));
  perform pg_temp.lk('C-CAP', 'more than 80 hours is refused', v, 'ERR:22023:invalid_capacity:%');
  v := pg_temp.person('growth', format('select public.ops_sprint_capacity_set(%L, %L, -1)::text', v_sprint, 'gem.v4255@test.local'));
  perform pg_temp.lk('C-CAP', 'fewer than 0 hours is refused', v, 'ERR:22023:invalid_capacity:%');
  v := pg_temp.person('growth', format('select public.ops_sprint_capacity_set(%L, %L, 2.25)::text', v_sprint, 'gem.v4255@test.local'));
  perform pg_temp.lk('C-CAP', 'hours go in tenths', v, 'ERR:22023:invalid_capacity:%');
  v := pg_temp.person('growth', format('select public.ops_sprint_capacity_set(%L, %L, 0)::text', v_sprint, 'ray.v4255@test.local'));
  perform pg_temp.chk('C-CAP', '0 hours is a real number', (v::jsonb)->>'hours', '0.0');
  v := pg_temp.person('growth', format('select public.ops_sprint_capacity_set(%L, %L, 80)::text', v_sprint, 'gem.v4255@test.local'));
  v := pg_temp.person('growth', format('select public.ops_sprint_capacity_set(%L, %L, 8)::text', v_sprint, 'Gem'));
  perform pg_temp.chk('C-CAP', 'a name finds the teammate and the number is replaced', (v::jsonb)->>'hours', '8.0');
  v := pg_temp.agent('growth', format('select public.ops_sprint_capacity_set(%L, %L, 8)::text', v_sprint, 'Gem'));
  perform pg_temp.lk('C-CAP', 'an agent cannot set hours', v, 'ERR:42501:people_only:%');
  v := pg_temp.add('E1', 'growth', pg_temp.item('V4255 Estimated card') || '{"estimate_minutes":540}'::jsonb);
  perform pg_temp.chk('C-CAP', 'the planner sums Gem''s estimates against her hours and flags over 100%',
    pg_temp.person('growth', format($q$select (c->>'hours') || '/' || (c->>'planned_minutes') || '/' || (c->>'over') from jsonb_array_elements(public.ops_sprint_plan_get(%L)->'capacity') c where c->>'email' = 'gem.v4255@test.local'$q$, v_sprint)),
    '8.0/1140/true');
  select revision into v_rev from public.ops_sprints where id = v_sprint;
  v := pg_temp.person('growth', format('select public.ops_sprint_start(%L, %s)::text', v_sprint, v_rev - 1));
  perform pg_temp.lk('C-CAP', 'a stale start is refused with PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.person('growth', format('select public.ops_sprint_start(%L, %s)::text', v_sprint, v_rev));
  perform pg_temp.chk('C-CAP', 'Start sprint keeps the cards in the sprint as the baseline',
    (select (jsonb_array_length(plan_baseline) > 0)::text || '/' ||
            exists (select 1 from jsonb_array_elements(plan_baseline) b where b->>'id' = pg_temp.id('E1')::text and b->>'estimate_minutes' = '540')::text
       from public.ops_sprints where id = v_sprint), 'true/true');
  v := pg_temp.person('growth', format('select public.ops_sprint_start(%L, %s)::text', v_sprint, v_rev + 1));
  perform pg_temp.lk('C-CAP', 'a sprint starts once', v, 'ERR:22023:already_started:%');
  v := pg_temp.add('E2', 'growth', pg_temp.item('V4255 Late card'));
  perform pg_temp.chk('C-CAP', 'a card added after the start is added mid-sprint, one from before is not',
    pg_temp.person('growth', format($q$select string_agg((c->>'title') || ':' || (c->>'added_mid_sprint'), ',' order by c->>'title') from jsonb_array_elements(public.ops_sprint_plan_get(%L)->'in_sprint') c where c->>'title' in ('V4255 Late card', 'V4255 Estimated card')$q$, v_sprint)),
    'V4255 Estimated card:false,V4255 Late card:true');
  v := pg_temp.person('growth', format($q$select public.ops_work_update(%L, '{"in_backlog":true}'::jsonb, %s)::text$q$, pg_temp.id('E2'), pg_temp.rev('E2')));
  perform pg_temp.chk('C-CAP', 'a card put in the backlog leaves the sprint list and is in the backlog',
    pg_temp.person('growth', format($q$select (select count(*) from jsonb_array_elements(public.ops_sprint_plan_get(%L)->'in_sprint') c where c->>'title' = 'V4255 Late card')::text || '/' || (select count(*) from jsonb_array_elements(public.ops_sprint_plan_get(%L)->'backlog') c where c->>'title' = 'V4255 Late card')::text$q$, v_sprint, v_sprint)),
    '0/1');
  select revision into v_rev from public.ops_sprints where id = v_sprint;
  v := pg_temp.person('growth', format('select public.ops_sprint_review_note_set(%L, %L, %s)::text', v_sprint, repeat('x', 201), v_rev));
  perform pg_temp.lk('C-CAP', 'the review note is at most 200 characters', v, 'ERR:22023:invalid_note:%');
  v := pg_temp.person('growth', format('select public.ops_sprint_review_note_set(%L, %L, %s)::text', v_sprint, 'Good week, two cards carried.', v_rev));
  perform pg_temp.chk('C-CAP', 'the review note is saved on the sprint', (select review_note from public.ops_sprints where id = v_sprint), 'Good week, two cards carried.');
end;
$t$;

-- ───────────────────────────── C-RLS ─────────────────────────────
do $t$
declare t text;
begin
  foreach t in array array['ops_work_statuses','ops_work_files','ops_work_messages','ops_work_message_reactions','ops_sprint_goals','ops_sprint_capacity'] loop
    perform pg_temp.chk('C-RLS', t || ': row security on, no client privilege',
      (select relrowsecurity::text from pg_class where oid = ('public.' || t)::regclass) || '/' ||
      has_table_privilege('authenticated', 'public.' || t, 'SELECT')::text || '/' || has_table_privilege('anon', 'public.' || t, 'SELECT')::text,
      'true/false/false');
  end loop;
  perform pg_temp.lk('C-RLS', 'a teammate cannot read the thread table directly',
    pg_temp.person('growth', 'select count(*)::text from public.ops_work_messages'), 'ERR:42501:%');
  perform pg_temp.chk('C-RLS', 'internal helpers are not callable by clients',
    has_function_privilege('authenticated', 'public.ops_plan_sync(uuid, jsonb, text, text)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.ops_4255_plan_to_subtasks()', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.ops_work_move(uuid, uuid, bigint, jsonb, text, boolean)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.ops_work_move(uuid, uuid, bigint, jsonb, text, boolean)', 'EXECUTE')::text,
    'false/false/false/true');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from t42_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 100 then raise exception '#4255 work v2 recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 work v2: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 work v2: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
