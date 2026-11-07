-- Issue #4270 (Wave 7) -- implementor happy path for
-- 20280428014270_issue_4270_w7_admin_brand_group_inbox.sql, on the fully
-- replayed PG17 schema (with #4304's 20280426004304 present).
-- MINGLA-INVARIANT: I-4270-W7-INBOX-STAFF-ONLY | issue #4270 | issue_4270_brand_group_inbox answers only Mingla Support or admins; host card, owner and plan facts only to staff with Hosts and Creators access.
-- MINGLA-INVARIANT: I-4270-W7-PEOPLE-NO-EMAIL | issue #4270 | the staff Brand group people list names teammates by display name and role, never by email.
--
--   W-WAIT   a brand message sets waiting_since; a Mingla Support reply
--            clears it; a plan line, an enquiry card and a system line with a
--            sender never set it; waiting_since is the FIRST unanswered
--            message; a staff member posting as a brand teammate (no Mingla
--            Support snapshot) still leaves the group waiting
--   W-HOST   host is null for a Support teammate without Hosts and Creators
--            access, and for a brand with no host card; with access it names
--            the first host card, its owners (by name), mine, and the plan
--            (next item from today, this_week count); p_with_plan = false
--            leaves plan null
--   W-GATE   a brand teammate who is not staff is refused (42501) by both;
--            anon cannot execute either
--   W-PEOPLE names and roles in role order, 'A teammate' for an email-like
--            name, no '@' anywhere, removed teammates left out
--
-- FAILS-ON-REVERT: the functions do not exist on main (every check fails);
-- drop the Mingla Support snapshot filter -> W-WAIT fails; drop the crm gate
-- -> W-HOST fails; read p.email into display_name -> W-PEOPLE fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
-- A Support teammate without Hosts and Creators access: every real team role
-- carries crm today, so this rolled-back test seats one with a role that has
-- no areas.
alter table public.admin_team_members drop constraint if exists admin_team_members_role_check;

create temp table tp_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tp_people (who, id, email) values
  ('gia',   '42770000-0000-4000-a0f0-000000000001', 'gia.w7.4270@test.local'),
  ('kunle', '42770000-0000-4000-a0f0-000000000002', 'kunle.w7.4270@test.local'),
  ('sue',   '42770000-0000-4000-a0f0-000000000003', 'sue.w7.4270@test.local'),
  ('annie', '42770000-0000-4000-a0f1-000000000001', 'annie.w7.4270@test.local'),
  ('tobi',  '42770000-0000-4000-a0f1-000000000002', 'tobi.w7.4270@test.local'),
  ('emma',  '42770000-0000-4000-a0f1-000000000003', 'emma.w7.4270@test.local'),
  ('ray',   '42770000-0000-4000-a0f1-000000000004', 'ray.w7.4270@test.local'),
  ('bea',   '42770000-0000-4000-a0f1-000000000005', 'bea.w7.4270@test.local'),
  ('guest', '42770000-0000-4000-a0f1-000000000006', 'guest.w7.4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tp_people;
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.w7.4270@test.local', 'growth', 'active', now()),
  ('kunle.w7.4270@test.local', 'growth', 'active', now()),
  ('sue.w7.4270@test.local', 'w7_support_only', 'active', now());
insert into public.support_staff (user_id, enabled, display_name) values
  ('42770000-0000-4000-a0f0-000000000001', true, 'Gia'),
  ('42770000-0000-4000-a0f0-000000000002', true, 'Kunle'),
  ('42770000-0000-4000-a0f0-000000000003', true, 'Sue')
  on conflict (user_id) do update set enabled = true;
insert into public.ops_team_profiles (email, display_name, updated_by) values
  ('gia.w7.4270@test.local', 'Gia Ade', 'system@usemingla.com'), ('kunle.w7.4270@test.local', 'Kunle Bello', 'system@usemingla.com')
  on conflict (email) do update set display_name = excluded.display_name;

create temp table tp_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.tp_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tp_people where who = p_who;
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

create function pg_temp.tp_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tp_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tp_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tp_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tp_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tp_day(p_n integer) returns date
language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date + p_n $fn$;

-- One inbox row as JSON, read as a person.
create function pg_temp.tp_inbox(p_who text, p_conversation uuid, p_with_plan boolean default true) returns jsonb
language plpgsql as $fn$
begin
  return pg_temp.tp_j(pg_temp.tp_as(p_who, format(
    $q$select coalesce((select to_jsonb(x) from public.issue_4270_brand_group_inbox(null, %L) x where x.conversation_id = %L), '{"missing":true}'::jsonb)::text$q$,
    p_with_plan, p_conversation)));
end;
$fn$;

-- A message written at a time in the past (replica: no triggers, no push).
create function pg_temp.tp_msg(p_conversation uuid, p_sender uuid, p_type text, p_role text, p_minutes_ago integer, p_content text) returns void
language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  insert into public.messages (conversation_id, sender_id, content, message_type, sender_role_snapshot, created_at)
  values (p_conversation, p_sender, p_content, p_type, p_role, now() - make_interval(mins => p_minutes_ago));
  set local session_replication_role = origin;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures: brand A (host card, owners, a team of four, one removed), brand B
-- (no host card).
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at, default_timezone) values
  ('42770000-0000-4000-b0f0-000000000001', '42770000-0000-4000-b1f0-000000000001', 'W7 Palm Brand', 'w7-palm', 'Lagos', now() - interval '90 days', 'UTC'),
  ('42770000-0000-4000-b0f0-000000000002', '42770000-0000-4000-b1f0-000000000002', 'W7 Other Brand', 'w7-other', 'Lagos', now() - interval '90 days', 'UTC');
insert into public.profiles (id, email, display_name, first_name, last_name) values
  ('42770000-0000-4000-a0f1-000000000001', 'annie.w7.4270@test.local', 'Annie W', 'Annie', null),
  ('42770000-0000-4000-a0f1-000000000002', 'tobi.w7.4270@test.local', 'Tobi W', 'Tobi', null),
  ('42770000-0000-4000-a0f1-000000000003', 'emma.w7.4270@test.local', 'emma.w7.4270@test.local', null, null),
  ('42770000-0000-4000-a0f1-000000000004', 'ray.w7.4270@test.local', 'Ray Removed', 'Ray', null),
  ('42770000-0000-4000-a0f1-000000000005', 'bea.w7.4270@test.local', 'Bea W', 'Bea', null),
  ('42770000-0000-4000-a0f1-000000000006', 'guest.w7.4270@test.local', 'Guest W', 'Guest', null),
  ('42770000-0000-4000-a0f0-000000000002', 'kunle.w7.4270@test.local', 'Kunle Bello', 'Kunle', null)
  on conflict (id) do update set display_name = excluded.display_name, first_name = excluded.first_name, last_name = excluded.last_name;
insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at) values
  ('42770000-0000-4000-b0f0-000000000001', '42770000-0000-4000-a0f1-000000000002', 'marketing_manager', now() - interval '20 days', now() - interval '20 days', null),
  ('42770000-0000-4000-b0f0-000000000001', '42770000-0000-4000-a0f1-000000000001', 'brand_owner', now() - interval '80 days', now() - interval '80 days', null),
  ('42770000-0000-4000-b0f0-000000000001', '42770000-0000-4000-a0f1-000000000003', 'scanner', now() - interval '10 days', now() - interval '10 days', null),
  ('42770000-0000-4000-b0f0-000000000001', '42770000-0000-4000-a0f1-000000000004', 'brand_admin', now() - interval '30 days', now() - interval '30 days', now() - interval '1 day'),
  ('42770000-0000-4000-b0f0-000000000001', '42770000-0000-4000-a0f0-000000000002', 'event_manager', now() - interval '15 days', now() - interval '15 days', null),
  ('42770000-0000-4000-b0f0-000000000002', '42770000-0000-4000-a0f1-000000000005', 'brand_owner', now() - interval '20 days', now() - interval '20 days', null);
insert into public.conversations (id, type, linked_entity_type, brand_id, name, is_enabled) values
  ('42770000-0000-4000-e0f0-000000000001', 'group', 'brand', '42770000-0000-4000-b0f0-000000000001', 'W7 Palm Brand · Brand group', true),
  ('42770000-0000-4000-e0f0-000000000002', 'group', 'brand', '42770000-0000-4000-b0f0-000000000002', 'W7 Other Brand · Brand group', true);
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, next_action, due_on, created_by, updated_by, created_at) values
  ('42770000-0000-4000-c0f0-000000000001', 'hosts', 'W7 Palm Host', 'live', '42770000-0000-4000-b0f0-000000000001', 'event_organizer', 'Check the recap post', pg_temp.tp_day(2), 'w7-fixture', 'w7-fixture', now() - interval '60 days'),
  ('42770000-0000-4000-c0f0-000000000002', 'hosts', 'W7 Palm Second', 'onboarded', '42770000-0000-4000-b0f0-000000000001', 'event_organizer', null, null, 'w7-fixture', 'w7-fixture', now() - interval '10 days');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('42770000-0000-4000-c0f0-000000000001', 'gia.w7.4270@test.local', 'w7-fixture'),
  ('42770000-0000-4000-c0f0-000000000002', 'kunle.w7.4270@test.local', 'w7-fixture');

-- ---------------------------------------------------------------------------
-- W-WAIT
-- ---------------------------------------------------------------------------
do $wait$
declare
  A constant uuid := '42770000-0000-4000-e0f0-000000000001';
  B constant uuid := '42770000-0000-4000-e0f0-000000000002';
  annie constant uuid := '42770000-0000-4000-a0f1-000000000001';
  tobi constant uuid := '42770000-0000-4000-a0f1-000000000002';
  kunle constant uuid := '42770000-0000-4000-a0f0-000000000002';
  guest constant uuid := '42770000-0000-4000-a0f1-000000000006';
  bea constant uuid := '42770000-0000-4000-a0f1-000000000005';
  v jsonb;
begin
  v := pg_temp.tp_inbox('sue', A);
  perform pg_temp.tp_check('W-WAIT', 'an empty group is listed and nobody waits', (v->>'conversation_id') || '|' || coalesce(v->>'waiting_since', '<null>'), A::text || '|<null>');

  perform pg_temp.tp_msg(A, annie, 'text', null, 300, 'Hi Mingla');
  v := pg_temp.tp_inbox('sue', A);
  perform pg_temp.tp_check('W-WAIT', 'a brand message makes the group wait', ((v->>'waiting_since') is not null and (v->>'last_staff_reply_at') is null)::text, 'true');

  perform pg_temp.tp_msg(A, kunle, 'text', 'Mingla Support', 240, 'On it');
  perform pg_temp.tp_msg(A, null, 'system', null, 180, 'Gia added “Menu reveal” to the plan for Sat 7 Nov.');
  perform pg_temp.tp_msg(A, guest, 'brand_enquiry_card', null, 120, 'An enquiry');
  perform pg_temp.tp_msg(A, annie, 'system', null, 90, 'Annie joined as Owner');
  v := pg_temp.tp_inbox('sue', A);
  perform pg_temp.tp_check('W-WAIT', 'a Support reply clears it; a plan line, an enquiry card and a system line never set it',
    coalesce(v->>'waiting_since', '<null>') || '|' || ((v->>'last_staff_reply_at')::timestamptz between now() - interval '241 minutes' and now() - interval '239 minutes')::text,
    '<null>|true');

  perform pg_temp.tp_msg(A, annie, 'text', null, 50, 'Can you push Sunday?');
  perform pg_temp.tp_msg(A, tobi, 'image', null, 40, 'photo');
  perform pg_temp.tp_msg(A, kunle, 'text', null, 30, 'As the brand: thanks!');
  v := pg_temp.tp_inbox('sue', A);
  perform pg_temp.tp_check('W-WAIT', 'waiting_since is the first unanswered message, and a staff teammate posting as the brand does not answer',
    ((v->>'waiting_since')::timestamptz between now() - interval '51 minutes' and now() - interval '49 minutes')::text, 'true');

  perform pg_temp.tp_msg(B, bea, 'text', null, 20, 'Hello?');
  v := pg_temp.tp_inbox('gia', B);
  perform pg_temp.tp_check('W-WAIT', 'brand B waits with no Support reply ever',
    ((v->>'waiting_since')::timestamptz between now() - interval '21 minutes' and now() - interval '19 minutes')::text, 'true');

  perform pg_temp.tp_msg(A, kunle, 'text', 'Mingla Support', 10, 'Yes, it is on the plan.');
  v := pg_temp.tp_inbox('sue', A);
  perform pg_temp.tp_check('W-WAIT', 'a later Support reply clears it again', coalesce(v->>'waiting_since', '<null>'), '<null>');
end;
$wait$;

-- ---------------------------------------------------------------------------
-- W-HOST
-- ---------------------------------------------------------------------------
do $host$
declare
  A constant uuid := '42770000-0000-4000-e0f0-000000000001';
  B constant uuid := '42770000-0000-4000-e0f0-000000000002';
  v jsonb; v_t text;
begin
  -- Plan: a post today (this week, next) and a task in 8 days (never this week).
  v_t := pg_temp.tp_as('gia', format($q$select public.ops_brand_plan_add('42770000-0000-4000-c0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'W7 Doors open tonight', 'on', %L), 'w7-plan-0001')::text$q$, pg_temp.tp_day(0)));
  perform pg_temp.tp_like('W-HOST', 'the post was added', v_t, '%"added"%');
  v_t := pg_temp.tp_as('gia', format($q$select public.ops_brand_plan_add('42770000-0000-4000-c0f0-000000000001',
    jsonb_build_object('type', 'task', 'title', 'W7 Book a photographer', 'on', %L), 'w7-plan-0002')::text$q$, pg_temp.tp_day(8)));
  perform pg_temp.tp_like('W-HOST', 'the task was added', v_t, '%"added"%');

  v := pg_temp.tp_inbox('sue', A);
  perform pg_temp.tp_check('W-HOST', 'a Support teammate without Hosts and Creators access gets host = null',
    coalesce(v->>'host', '<null>') || '|' || (v ? 'waiting_since')::text, '<null>|true');

  v := pg_temp.tp_inbox('gia', A);
  perform pg_temp.tp_check('W-HOST', 'with access: the first host card, its stage, ICP, next action and due date',
    concat_ws('|', v #>> '{host,record_id}', v #>> '{host,name}', v #>> '{host,stage}', v #>> '{host,icp}', v #>> '{host,next_action}', v #>> '{host,due_on}'),
    concat_ws('|', '42770000-0000-4000-c0f0-000000000001', 'W7 Palm Host', 'live', 'event_organizer', 'Check the recap post', pg_temp.tp_day(2)::text));
  perform pg_temp.tp_check('W-HOST', 'owners by name, and mine for an owner',
    (v #> '{host,owners}')::text || '|' || (v #>> '{host,mine}'),
    '[{"name": "Gia Ade", "email": "gia.w7.4270@test.local"}]|true');
  perform pg_temp.tp_check('W-HOST', 'the next plan item is today''s post; one item this week',
    concat_ws('|', v #>> '{host,plan,next,kind}', v #>> '{host,plan,next,title}', v #>> '{host,plan,next,on}', v #>> '{host,plan,this_week}'),
    concat_ws('|', 'post', 'W7 Doors open tonight', pg_temp.tp_day(0)::text, '1'));

  v := pg_temp.tp_inbox('kunle', A);
  perform pg_temp.tp_check('W-HOST', 'not mine for a teammate who does not own the first host card', v #>> '{host,mine}', 'false');

  v := pg_temp.tp_inbox('gia', A, false);
  perform pg_temp.tp_check('W-HOST', 'the light refresh skips the plan', coalesce(v #>> '{host,plan}', '<null>') || '|' || (v #>> '{host,record_id}'),
    '<null>|42770000-0000-4000-c0f0-000000000001');

  v := pg_temp.tp_inbox('gia', B);
  perform pg_temp.tp_check('W-HOST', 'a brand with no host card has host = null', coalesce(v->>'host', '<null>'), '<null>');
end;
$host$;

-- ---------------------------------------------------------------------------
-- W-GATE
-- ---------------------------------------------------------------------------
do $gate$
begin
  perform pg_temp.tp_like('W-GATE', 'a brand teammate who is not staff cannot read the inbox',
    pg_temp.tp_as('annie', $q$select count(*)::text from public.issue_4270_brand_group_inbox()$q$), 'ERR:42501:forbidden:%');
  perform pg_temp.tp_like('W-GATE', 'nor the people list of their own group',
    pg_temp.tp_as('annie', $q$select count(*)::text from public.issue_4270_brand_group_people('42770000-0000-4000-e0f0-000000000001')$q$), 'ERR:42501:conversation_unavailable%');
  perform pg_temp.tp_check('W-GATE', 'anon cannot execute either',
    has_function_privilege('anon', 'public.issue_4270_brand_group_inbox(date,boolean)', 'EXECUTE')::text || '|'
      || has_function_privilege('anon', 'public.issue_4270_brand_group_people(uuid)', 'EXECUTE')::text,
    'false|false');
  perform pg_temp.tp_check('W-GATE', 'staff can',
    has_function_privilege('authenticated', 'public.issue_4270_brand_group_inbox(date,boolean)', 'EXECUTE')::text, 'true');
end;
$gate$;

-- ---------------------------------------------------------------------------
-- W-PEOPLE
-- ---------------------------------------------------------------------------
do $people$
declare v_t text;
begin
  v_t := pg_temp.tp_as('sue', $q$select string_agg(display_name || ':' || role, ', ') from public.issue_4270_brand_group_people('42770000-0000-4000-e0f0-000000000001')$q$);
  perform pg_temp.tp_check('W-PEOPLE', 'names and roles in role order; an email-like name is A teammate; a removed teammate is left out',
    v_t, 'Annie W:brand_owner, Kunle Bello:event_manager, Tobi W:marketing_manager, A teammate:scanner');
  perform pg_temp.tp_check('W-PEOPLE', 'no @ anywhere', (v_t like '%@%')::text, 'false');
  v_t := pg_temp.tp_as('gia', $q$select string_agg(display_name || ':' || role, ', ') from public.issue_4270_brand_group_people('42770000-0000-4000-e0f0-000000000002')$q$);
  perform pg_temp.tp_check('W-PEOPLE', 'another group lists its own team', v_t, 'Bea W:brand_owner');
end;
$people$;

select count(*) as tp_total, count(*) filter (where not ok) as tp_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tp_failures
  from tp_results \gset
rollback;

select (:tp_total < 20 or :tp_failed > 0) as tp_bad \gset
\if :tp_bad
  \echo 'ISSUE-4270 W7 FAILED:' :tp_failed 'of' :tp_total
  \echo :tp_failures
  do $$ begin raise exception 'ISSUE-4270 W7 FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W7 PASS:' :tp_total 'checks, 0 failed'
