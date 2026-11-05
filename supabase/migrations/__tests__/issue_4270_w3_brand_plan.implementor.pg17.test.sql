-- Issue #4270 (Wave 3) -- implementor happy path for
-- 20280403024270_issue_4270_w3_brand_plan.sql, on the fully replayed PG17
-- schema.
-- MINGLA-INVARIANT: I-4270-HOST-PLAN-MEMBERSHIP | issue #4270 | every host plan function answers not_found, the same words, for a missing brand and for someone outside it; only marketing managers and up add (D14).
-- MINGLA-INVARIANT: I-4270-HOST-EDITS-OWN-ONLY | issue #4270 | a host changes or removes only items they added, while Mingla has not started on them (D7).
-- MINGLA-INVARIANT: I-4270-DRIVE-LINK-STAFF-ONLY | issue #4270 | the host plan never carries the Drive link, copy, notes, owners or staff addresses; its link is the plan link (D12, D13).
-- MINGLA-INVARIANT: I-4270-HOST-SEES-ONLY-FLAGGED-CARDS | issue #4270 | a Work card is on the plan only with Host can see this on (D4).
-- MINGLA-INVARIANT: I-4270-PLAN-IS-A-READ | issue #4270 | plan items are the Calendar rows, Work cards and events themselves; moving a post moves it on the plan with no copy.
--
--   P-STATE  the host state mapping and its words
--   P-STAFF  the staff plan merges the brand's dated post, a card its host
--            sees on a second host record, an event and a promised event
--            (Promised); not another brand's, not an unflagged card, not a
--            private event; staff see the Drive link apart from the link
--   P-HOST   the host plan: exact key sets, the plan link only, no address,
--            the team's own private event, no promised event
--   P-MEMBER a scanner reads but cannot add; outsiders, another brand's
--            owner and a missing brand all get the same not_found; anon
--            cannot run the host functions
--   P-HADD   a host post is a Calendar Idea at 12:00 UTC owned by the host
--            card's owners; replay; past date, unknown key
--   P-HTASK  a host task is a To do card the host sees, owned by the host
--            card's owners, watched by the other host record's owners (D21)
--   P-CLASH  D24: " · brand", then the ask to change the name
--   P-OWN    D7: own items only, PT409 on an old revision, locked once
--            Mingla starts; remove is a soft delete
--   P-SADD   staff add a post (plan link, Drive link untouched) and a task;
--            an agent cannot
--   P-SLINK  staff set the link on any task on the plan, https only
--   P-CAL    Calendar brand, collaborator (Creators only), plan link (https
--            only, never in audit metadata), host state, lines on add, move
--            and rename (OQ-5); ops_calendar rows carry the brand
--   P-LINE   quiet system lines (no sender) in the Brand group
--   P-WHEN   an event sits on the date it is on now or next; live means a
--            date is on right now (both plans)
--   P-RW     the Wave 3 test fixes: hidden items, hidden characters and
--            addresses in links, titles answer the same either way, a limit on
--            changes, can_edit needs write rank, venue staff read only, a raced
--            title, the form's task defaults, the Host can see this line
--
-- FAILS-ON-REVERT: drop the membership statement from brand_plan_for_host ->
-- P-MEMBER fails; drop the brand_plan_line calls -> P-LINE fails; read
-- drive_url into the host post item -> P-HOST fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table tp_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tp_people (who, id, email) values
  ('growth', '42730000-0000-4000-a0f0-000000000003', 'gia.p4270@test.local'),
  ('staff2', '42730000-0000-4000-a0f0-000000000004', 'kunle.p4270@test.local'),
  ('annie',  '42730000-0000-4000-a0f1-000000000001', 'annie.p4270@test.local'),
  ('tobi',   '42730000-0000-4000-a0f1-000000000002', 'tobi.p4270@test.local'),
  ('sam',    '42730000-0000-4000-a0f1-000000000003', 'sam.p4270@test.local'),
  ('bea',    '42730000-0000-4000-a0f1-000000000004', 'bea.p4270@test.local'),
  ('nina',   '42730000-0000-4000-a0f1-000000000005', 'nina.p4270@test.local'),
  ('vic',    '42730000-0000-4000-a0f1-000000000006', 'vic.p4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tp_people;
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.p4270@test.local', 'growth', 'active', now()), ('kunle.p4270@test.local', 'growth', 'active', now());
insert into public.ops_team_profiles (email, display_name, updated_by) values ('gia.p4270@test.local', 'Gia Ade', 'system@usemingla.com'), ('kunle.p4270@test.local', 'Kunle Bello', 'system@usemingla.com')
  on conflict (email) do update set display_name = excluded.display_name;

create temp table tp_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tp_ids (k text primary key, id uuid not null) on commit drop;
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

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.tp_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tp_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tp_next_request();
  return pg_temp.tp_as(p_who, p_sql);
end;
$fn$;

-- A connected agent calling a function directly, as the gateway does.
create function pg_temp.tp_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tp_next_request();
  select id, email into strict v_id, v_email from tp_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.tp_as(p_who, p_sql);
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

create function pg_temp.tp_id(p_k text) returns uuid
language sql as $fn$ select id from tp_ids where k = p_k $fn$;

create function pg_temp.tp_rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tp_ids where k = p_k) $fn$;

create function pg_temp.tp_row(p_k text) returns text
language sql as $fn$
  select w.status || '/' || coalesce(w.person_reason, '-') from public.ops_work_cards w where w.id = (select id from tp_ids where k = p_k)
$fn$;

create function pg_temp.tp_owners(p_k text) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '<none>') from public.ops_work_people p
   where p.card_id = (select id from tp_ids where k = p_k) and p.role = 'owner'
$fn$;


create function pg_temp.tp_owners_of(p_id uuid) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '<none>') from public.ops_work_people p where p.card_id = p_id and p.role = 'owner'
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures: brand A (two host records), brand B, events, posts and cards.
-- ---------------------------------------------------------------------------
create function pg_temp.tp_day(p_n integer) returns date
language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date + p_n $fn$;

set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at, default_timezone) values
  ('42730000-0000-4000-b0f0-000000000001', '42730000-0000-4000-b1f0-000000000001', 'P4270 Palm Brand', 'p4270-palm', 'Lagos', now() - interval '90 days', 'UTC'),
  ('42730000-0000-4000-b0f0-000000000002', '42730000-0000-4000-b1f0-000000000002', 'P4270 Other Brand', 'p4270-other', 'Lagos', now() - interval '90 days', 'UTC');
insert into public.profiles (id, email, display_name, first_name) values
  ('42730000-0000-4000-a0f1-000000000001', 'annie.p4270@test.local', 'Annie P', 'Annie'),
  ('42730000-0000-4000-a0f1-000000000002', 'tobi.p4270@test.local', 'Tobi P', 'Tobi'),
  ('42730000-0000-4000-a0f1-000000000003', 'sam.p4270@test.local', 'Sam P', 'Sam'),
  ('42730000-0000-4000-a0f1-000000000004', 'bea.p4270@test.local', 'Bea P', 'Bea'),
  ('42730000-0000-4000-a0f1-000000000005', 'nina.p4270@test.local', 'Nina P', 'Nina')
  on conflict (id) do update set display_name = excluded.display_name, first_name = excluded.first_name;
insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at) values
  ('42730000-0000-4000-b0f0-000000000001', '42730000-0000-4000-a0f1-000000000001', 'brand_owner', now() - interval '80 days', now() - interval '80 days'),
  ('42730000-0000-4000-b0f0-000000000001', '42730000-0000-4000-a0f1-000000000002', 'marketing_manager', now() - interval '20 days', now() - interval '20 days'),
  ('42730000-0000-4000-b0f0-000000000001', '42730000-0000-4000-a0f1-000000000003', 'scanner', now() - interval '20 days', now() - interval '20 days'),
  ('42730000-0000-4000-b0f0-000000000001', '42730000-0000-4000-a0f1-000000000006', 'venue_staff', now() - interval '20 days', now() - interval '20 days'),
  ('42730000-0000-4000-b0f0-000000000002', '42730000-0000-4000-a0f1-000000000004', 'brand_owner', now() - interval '20 days', now() - interval '20 days');
insert into public.conversations (id, type, linked_entity_type, brand_id, name, is_enabled) values
  ('42730000-0000-4000-e0f0-000000000001', 'group', 'brand', '42730000-0000-4000-b0f0-000000000001', 'P4270 Palm Brand · Brand group', true),
  ('42730000-0000-4000-e0f0-000000000002', 'group', 'brand', '42730000-0000-4000-b0f0-000000000002', 'P4270 Other Brand · Brand group', true);
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by, created_at) values
  ('42730000-0000-4000-c0f0-000000000001', 'hosts', 'P4270 Palm Host', 'live', '42730000-0000-4000-b0f0-000000000001', 'event_organizer', 'p-fixture', 'p-fixture', now() - interval '60 days'),
  ('42730000-0000-4000-c0f0-000000000002', 'hosts', 'P4270 Palm Second', 'onboarded', '42730000-0000-4000-b0f0-000000000001', 'event_organizer', 'p-fixture', 'p-fixture', now() - interval '10 days'),
  ('42730000-0000-4000-c0f0-000000000003', 'hosts', 'P4270 Other Host', 'live', '42730000-0000-4000-b0f0-000000000002', 'event_organizer', 'p-fixture', 'p-fixture', now() - interval '60 days');
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('42730000-0000-4000-c0f0-000000000009', 'creators', 'P4270 Creator Kemi', 'identified', 'p-fixture', 'p-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('42730000-0000-4000-c0f0-000000000001', 'gia.p4270@test.local', 'p-fixture'),
  ('42730000-0000-4000-c0f0-000000000002', 'kunle.p4270@test.local', 'p-fixture'),
  ('42730000-0000-4000-c0f0-000000000003', 'gia.p4270@test.local', 'p-fixture');

do $fx$
declare v_id uuid;
begin
  set local session_replication_role = replica;
  -- a public event, a private one (the team sees it; staff plans do not), a cancelled one (nobody)
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text) values
    ('42730000-0000-4000-f0f0-000000000001', '42730000-0000-4000-b0f0-000000000001', 'P4270 Supper Club', 'p4270-supper', 'discover', 'scheduled', 'UTC', now() - interval '5 days', 'event', 'P4270 Street'),
    ('42730000-0000-4000-f0f0-000000000002', '42730000-0000-4000-b0f0-000000000001', 'P4270 Private Night', 'p4270-private', 'private', 'scheduled', 'UTC', now() - interval '5 days', 'event', 'P4270 Street'),
    ('42730000-0000-4000-f0f0-000000000003', '42730000-0000-4000-b0f0-000000000001', 'P4270 Called Off', 'p4270-off', 'discover', 'cancelled', 'UTC', now() - interval '5 days', 'event', 'P4270 Street');
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  select e, (pg_temp.tp_day(d)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.tp_day(d)::timestamp + time '23:00') AT TIME ZONE 'UTC', true
    from (values ('42730000-0000-4000-f0f0-000000000001'::uuid, 8), ('42730000-0000-4000-f0f0-000000000002'::uuid, 9), ('42730000-0000-4000-f0f0-000000000003'::uuid, 10)) x(e, d);
  set local session_replication_role = origin;
end;
$fx$;

-- posts: a dated idea of brand A with a Drive link, notes and a plan link; an
-- undated idea of brand A; a dated post of brand B.
insert into public.content_calendar_items (id, title, owner_emails, publish_at, notes, drive_url, copy_text, brand_id, plan_link_url, created_by, updated_by) values
  ('42730000-0000-4000-d0f0-000000000001', 'P4270 Menu reveal carousel', ARRAY['gia.p4270@test.local'], (pg_temp.tp_day(5)::timestamp + time '18:00') AT TIME ZONE 'UTC',
   'Staff notes only', 'https://drive.google.com/p4270-secret', 'Staff copy only', '42730000-0000-4000-b0f0-000000000001', 'https://www.canva.com/p4270', 'gia.p4270@test.local', 'gia.p4270@test.local'),
  ('42730000-0000-4000-d0f0-000000000002', 'P4270 Undated idea', ARRAY['gia.p4270@test.local'], null, null, null, null, '42730000-0000-4000-b0f0-000000000001', null, 'gia.p4270@test.local', 'gia.p4270@test.local'),
  ('42730000-0000-4000-d0f0-000000000003', 'P4270 Dress code post', ARRAY['gia.p4270@test.local'], (pg_temp.tp_day(6)::timestamp + time '12:00') AT TIME ZONE 'UTC', null, null, null, '42730000-0000-4000-b0f0-000000000002', null, 'gia.p4270@test.local', 'gia.p4270@test.local');

-- cards: one the host sees on the second host record, one the host does not see, one of brand B.
do $cards$
declare v_id uuid; v_k text; v_t text; v_r uuid; v_on boolean; v_due integer;
begin
  for v_k, v_t, v_r, v_on, v_due in values
    ('C1', 'P4270 Share the poster', '42730000-0000-4000-c0f0-000000000002'::uuid, true, 6),
    ('C2', 'P4270 Chase the contract', '42730000-0000-4000-c0f0-000000000001'::uuid, false, 4),
    ('C3', 'P4270 Other brand task', '42730000-0000-4000-c0f0-000000000003'::uuid, true, 4) loop
    insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id, files_url, on_brand_plan, brand_plan_source,
      created_by, updated_by)
    values (v_t, 'Do this task carefully and say what changed.', 'It is done and checked.', 'todo', pg_temp.tp_day(v_due), 'explicit',
      public.ops_sprint_ensure(pg_temp.tp_day(0)), case when v_k = 'C1' then 'https://dropbox.com/p4270' end, v_on, 'host_card',
      'gia.p4270@test.local', 'gia.p4270@test.local') returning id into v_id;
    insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, 'gia.p4270@test.local', 'owner', 'gia.p4270@test.local');
    insert into public.ops_work_links (card_id, kind, target_id, label, added_by) values (v_id, 'host', v_r, 'host', 'gia.p4270@test.local');
    insert into tp_ids (k, id) values (v_k, v_id);
  end loop;
end;
$cards$;

insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by)
values ('42730000-0000-4000-d1f0-000000000001', '42730000-0000-4000-c0f0-000000000001', 'P4270 Promised Brunch', 'event', pg_temp.tp_day(12), 'none', 'gia.p4270@test.local', 'gia.p4270@test.local');

create function pg_temp.tp_lines() returns text
language sql as $fn$
  select coalesce(string_agg(m.content, ' | ' order by m.created_at, m.id), '') from public.messages m
   where m.conversation_id = '42730000-0000-4000-e0f0-000000000001' and m.message_type = 'system'
$fn$;
create function pg_temp.tp_line_count() returns integer
language sql as $fn$
  select count(*)::integer from public.messages m where m.conversation_id in ('42730000-0000-4000-e0f0-000000000001', '42730000-0000-4000-e0f0-000000000002')
$fn$;

-- ---------------------------------------------------------------------------
-- P-STATE, P-STAFF, P-HOST, P-MEMBER
-- ---------------------------------------------------------------------------
do $read$
declare v jsonb; v_t text; v_from date := pg_temp.tp_day(-7); v_to date := pg_temp.tp_day(60); v_post jsonb;
begin
  perform pg_temp.tp_check('P-STATE', 'Idea with a date, Writing, Design, Review, Scheduled, Published',
    concat_ws(',', public.brand_plan_post_state('idea', now()), public.brand_plan_post_state('writing', now()), public.brand_plan_post_state('design', now()),
      public.brand_plan_post_state('review', now()), public.brand_plan_post_state('scheduled', now()), public.brand_plan_post_state('published', now())),
    'planned,being_made,being_made,in_review,scheduled,posted');
  perform pg_temp.tp_check('P-STATE', 'an Idea without a date is not on the plan', coalesce(public.brand_plan_post_state('idea', null), '<off>'), '<off>');
  perform pg_temp.tp_check('P-STATE', 'the words', concat_ws(',', public.brand_plan_state_words('planned'), public.brand_plan_state_words('being_made'),
    public.brand_plan_state_words('in_review'), public.brand_plan_state_words('scheduled'), public.brand_plan_state_words('posted')),
    'Planned,Being made,In review,Scheduled,Posted');

  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_brand_plan('42730000-0000-4000-c0f0-000000000001', %L, %L)::text$q$, v_from, v_to)));
  perform pg_temp.tp_check('P-STAFF', 'one plan: the brand''s dated post, the card its host sees (any host record), its event and its promised event',
    (select string_agg((i->>'kind') || ':' || replace(i->>'title', 'P4270 ', ''), ',' order by i->>'on') from jsonb_array_elements(v->'items') i),
    'post:Menu reveal carousel,task:Share the poster,event:Supper Club,promised:Promised Brunch');
  perform pg_temp.tp_check('P-STAFF', 'promised events say Promised; staff see the Drive link apart from the plan link',
    (select i->>'state_words' from jsonb_array_elements(v->'items') i where i->>'kind' = 'promised') || ' '
      || (select (i->>'drive_url') || ' ' || (i #>> '{link,url}') || ' ' || (i #>> '{link,site}') from jsonb_array_elements(v->'items') i where i->>'kind' = 'post'),
    'Promised https://drive.google.com/p4270-secret https://www.canva.com/p4270 canva.com');
  perform pg_temp.tp_like('P-STAFF', 'a window over 120 days is refused',
    pg_temp.tp_person('growth', format($q$select public.ops_brand_plan('42730000-0000-4000-c0f0-000000000001', %L, %L)::text$q$, v_from, v_from + 121)), 'ERR:22023:invalid_window:%');

  v := pg_temp.tp_j(pg_temp.tp_as('annie', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, v_from, v_to)));
  perform pg_temp.tp_check('P-HOST', 'a member sees the post, the card it can see and every one of its events that is not cancelled (no promised event)',
    (select string_agg((i->>'kind') || ':' || replace(i->>'title', 'P4270 ', ''), ',' order by i->>'on') from jsonb_array_elements(v->'items') i),
    'post:Menu reveal carousel,task:Share the poster,event:Supper Club,event:Private Night');
  v_post := (select i from jsonb_array_elements(v->'items') i where i->>'kind' = 'post');
  perform pg_temp.tp_check('P-HOST', 'a post carries exactly these keys (no Drive link, copy, notes, owners or stage)',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_post) k),
    'at,by,can_edit,id,kind,link,live_url,mine,on,revision,state,state_words,title');
  perform pg_temp.tp_check('P-HOST', 'a task carries exactly these keys',
    (select string_agg(k, ',' order by k) from jsonb_object_keys((select i from jsonb_array_elements(v->'items') i where i->>'kind' = 'task')) k),
    'at,by,can_edit,id,kind,link,mine,on,revision,state,state_words,title');
  perform pg_temp.tp_check('P-HOST', 'the link is the plan link; no staff address, Drive link, notes or copy anywhere',
    (v_post #>> '{link,url}') || ' ' || (v::text ~ '(@|drive\.google|Staff notes|Staff copy)')::text, 'https://www.canva.com/p4270 false');
  perform pg_temp.tp_check('P-HOST', 'a Mingla item is not the host''s own', (v_post->>'by') || '/' || (v_post->>'mine') || '/' || (v->>'can_add'), 'mingla/false/true');
  v := pg_temp.tp_j(pg_temp.tp_as('sam', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, v_from, v_to)));
  perform pg_temp.tp_check('P-MEMBER', 'a scanner can read the plan but not add', (jsonb_array_length(v->'items') > 0)::text || '/' || (v->>'can_add'), 'true/false');
  v_t := pg_temp.tp_as('nina', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, v_from, v_to));
  perform pg_temp.tp_check('P-MEMBER', 'someone outside the brand gets not_found', v_t, 'ERR:P0002:not_found: This plan is not here.');
  v_t := pg_temp.tp_as('nina', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-0000000000ff', %L, %L)::text$q$, v_from, v_to));
  perform pg_temp.tp_check('P-MEMBER', 'a brand that does not exist gets the same answer', v_t, 'ERR:P0002:not_found: This plan is not here.');
  v_t := pg_temp.tp_as('bea', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, v_from, v_to));
  perform pg_temp.tp_check('P-MEMBER', 'a member of another brand too', v_t, 'ERR:P0002:not_found: This plan is not here.');
  perform pg_temp.tp_check('P-MEMBER', 'anon cannot run any host plan function',
    (has_function_privilege('anon', 'public.brand_plan_for_host(uuid,date,date)', 'EXECUTE') or has_function_privilege('anon', 'public.brand_plan_host_add(uuid,jsonb,text)', 'EXECUTE')
      or has_function_privilege('anon', 'public.brand_plan_host_update(text,uuid,jsonb,bigint)', 'EXECUTE') or has_function_privilege('anon', 'public.brand_plan_host_remove(text,uuid,bigint)', 'EXECUTE'))::text, 'false');
end;
$read$;

-- ---------------------------------------------------------------------------
-- P-HADD, P-HTASK, P-CLASH, P-LINE
-- ---------------------------------------------------------------------------
do $hadd$
declare v jsonb; v_t text; v_id uuid; v_on date := pg_temp.tp_day(10); v_lines integer := pg_temp.tp_line_count();
begin
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Our new menu', 'on', %L, 'link', 'https://photos.example.com/menu', 'note', 'Use the blue photos'), 'p4270-hadd-0001')::text$q$, v_on)));
  perform pg_temp.tp_check('P-HADD', 'a host''s post is added and is theirs', (v->>'status') || '/' || (v #>> '{item,mine}') || '/' || (v #>> '{item,by}') || '/' || (v #>> '{item,state}'), 'added/true/host/planned');
  v_id := (v #>> '{item,id}')::uuid;
  perform pg_temp.tp_check('P-HADD', 'it is a Calendar Idea for brand A at 12:00 UTC on its date, owned by the host card''s owners',
    (select stage || '|' || brand_id::text || '|' || (publish_at = (v_on::timestamp + time '12:00') AT TIME ZONE 'UTC')::text || '|' || array_to_string(owner_emails, ',')
            || '|' || brand_plan_source || '|' || (brand_plan_author_id = '42730000-0000-4000-a0f1-000000000002')::text || '|' || plan_link_url
       from public.content_calendar_items where id = v_id),
    'idea|42730000-0000-4000-b0f0-000000000001|true|gia.p4270@test.local|host_app|true|https://photos.example.com/menu');
  perform pg_temp.tp_check('P-HADD', 'the note says who added it', (select notes from public.content_calendar_items where id = v_id), 'Added by Tobi P in the Host app. Note: Use the blue photos');
  perform pg_temp.tp_check('P-LINE', 'a quiet line goes into the Brand group',
    (select m.message_type || '/' || coalesce(m.sender_id::text, 'no sender') || '/' || m.sender_kind || '/' || m.content from public.messages m
      where m.conversation_id = '42730000-0000-4000-e0f0-000000000001' order by m.created_at desc, m.id desc limit 1),
    format('system/no sender/system/Tobi P added “P4270 Our new menu” to the plan for %s.', public.brand_plan_day_words(v_on)));
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Our new menu', 'on', %L, 'link', 'https://photos.example.com/menu', 'note', 'Use the blue photos'), 'p4270-hadd-0001')::text$q$, v_on));
  perform pg_temp.tp_check('P-HADD', 'the same request again is a replay, not a second post',
    (pg_temp.tp_j(v_t)->>'replayed') || '/' || (select count(*) from public.content_calendar_items where title = 'P4270 Our new menu · P4270 Palm Brand')::text, 'true/1');

  -- D24: the title is taken on the Calendar (brand B's post) -> " · brand"
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Dress code post', 'on', %L), 'p4270-hadd-0002')::text$q$, v_on)));
  perform pg_temp.tp_check('P-CLASH', 'a host item is always stored with the brand name; the host sees it without, and is told nothing about other titles',
    (v #>> '{item,title}') || '/' || (v->>'title_changed') || '/' || (select title from public.content_calendar_items where id = (v #>> '{item,id}')::uuid),
    'P4270 Dress code post/false/P4270 Dress code post · P4270 Palm Brand');
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Dress code post', 'on', %L), 'p4270-hadd-0003')::text$q$, v_on));
  perform pg_temp.tp_check('P-CLASH', 'and when that is taken too, the host is asked to change it',
    v_t, 'ERR:23505:duplicate_title: Something with this name is already planned. Change the name a little.');

  -- a task: a Work card in To do for the host card's owners, watched by the other host record's owners
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'task', 'title', 'P4270 Print the menus', 'on', %L, 'link', 'https://files.example.com/menus'), 'p4270-hadd-0004')::text$q$, v_on)));
  v_id := (v #>> '{item,id}')::uuid;
  perform pg_temp.tp_check('P-HTASK', 'a host''s task is a To do card the host sees, theirs',
    (select status || '|' || on_brand_plan::text || '|' || brand_plan_source || '|' || due_on::text || '|' || files_url || '|' || done_means
       from public.ops_work_cards where id = v_id),
    format('todo|true|host_app|%s|https://files.example.com/menus|Done and the host is told in the Brand group.', v_on));
  perform pg_temp.tp_check('P-HTASK', 'owned by the host card''s owners, watched by the other host record''s owners, on the host card',
    (select string_agg(p.role || ':' || p.email, ',' order by p.role, p.email) from public.ops_work_people p where p.card_id = v_id) || '|'
      || (select string_agg(l.kind || ':' || l.target_id::text, ',') from public.ops_work_links l where l.card_id = v_id),
    'owner:gia.p4270@test.local,watcher:kunle.p4270@test.local|host:42730000-0000-4000-c0f0-000000000001');
  perform pg_temp.tp_check('P-HTASK', 'Mingla writes the instructions', (select instructions from public.ops_work_cards where id = v_id), 'Added by Tobi P from the Brand group plan.');
  perform pg_temp.tp_check('P-HTASK', 'the task answer names no staff', (v::text ~ '(gia|kunle|@)')::text, 'false');
  perform pg_temp.tp_check('P-LINE', 'every add posted one line', (pg_temp.tp_line_count() - v_lines)::text, '3');

  v_t := pg_temp.tp_as('sam', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Scanner idea', 'on', %L), null)::text$q$, v_on));
  perform pg_temp.tp_like('P-MEMBER', 'a scanner cannot add', v_t, 'ERR:42501:read_only:%');
  v_t := pg_temp.tp_as('nina', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Outsider idea', 'on', %L), null)::text$q$, v_on));
  perform pg_temp.tp_check('P-MEMBER', 'someone outside the brand cannot add', v_t, 'ERR:P0002:not_found: This plan is not here.');
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Http idea', 'on', %L, 'link', 'http://example.com'), null)::text$q$, v_on));
  perform pg_temp.tp_check('P-LINK', 'only https links', v_t, 'ERR:22023:invalid_link: Links start with https://');
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Late idea', 'on', %L), null)::text$q$, pg_temp.tp_day(-1)));
  perform pg_temp.tp_check('P-HADD', 'a past date is refused', v_t, 'ERR:22023:invalid_date: Pick today or a later date.');
  v_t := pg_temp.tp_as('tobi', $q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', '{"type":"post","title":"P4270 x","on":"2030-01-01","owner_emails":["a@b.c"]}'::jsonb, null)::text$q$);
  perform pg_temp.tp_like('P-HADD', 'any other key is refused', v_t, 'ERR:22023:unknown_field:%');
end;
$hadd$;

-- ---------------------------------------------------------------------------
-- P-OWN (D7): hosts change and remove only their own items
-- ---------------------------------------------------------------------------
do $own$
declare v jsonb; v_t text; v_post uuid; v_task uuid; v_rev bigint; v_on date := pg_temp.tp_day(14);
begin
  select id, revision into v_post, v_rev from public.content_calendar_items where title = 'P4270 Our new menu · P4270 Palm Brand';
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_update('post', %L, jsonb_build_object('on', %L), %s)::text$q$, v_post, v_on, v_rev)));
  perform pg_temp.tp_check('P-OWN', 'a host moves their own idea; the plan reads the Calendar row itself (no copy)',
    (v #>> '{item,on}') || '/' || (select ((publish_at AT TIME ZONE 'UTC')::date)::text from public.content_calendar_items where id = v_post)
      || '/' || (select count(*) from public.content_calendar_items where title = 'P4270 Our new menu · P4270 Palm Brand')::text, format('%s/%s/1', v_on, v_on));
  perform pg_temp.tp_like('P-LINE', 'moving it posts a line', pg_temp.tp_lines(), format('%%Tobi P moved “P4270 Our new menu” to %s.%%', public.brand_plan_day_words(v_on)));
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_update('post', %L, jsonb_build_object('on', %L), %s)::text$q$, v_post, v_on, v_rev));
  perform pg_temp.tp_like('P-OWN', 'an old revision is a PT409 stale write', v_t, 'ERR:PT409:stale_write:%');
  v_t := pg_temp.tp_as('annie', format($q$select public.brand_plan_host_update('post', %L, '{"title":"P4270 Annie renames it"}'::jsonb, %s)::text$q$, v_post, v_rev + 1));
  perform pg_temp.tp_check('P-OWN', 'another host of the brand cannot change it', v_t, 'ERR:P0002:not_found: This item is not on your plan.');
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_update('post', %L, '{"title":"P4270 Tobi renames staff"}'::jsonb, 1)::text$q$, '42730000-0000-4000-d0f0-000000000001'));
  perform pg_temp.tp_check('P-OWN', 'nor can a host change Mingla''s item', v_t, 'ERR:P0002:not_found: This item is not on your plan.');
  -- Mingla starts on it: locked
  update public.content_calendar_items set stage = 'writing' where id = v_post;
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_remove('post', %L, %s)::text$q$, v_post, (select revision from public.content_calendar_items where id = v_post)));
  perform pg_temp.tp_like('P-OWN', 'once Mingla is working on it, the host cannot remove it', v_t, 'ERR:22023:locked:%');
  update public.content_calendar_items set stage = 'idea' where id = v_post;
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_remove('post', %L, %s)::text$q$, v_post, (select revision from public.content_calendar_items where id = v_post))));
  perform pg_temp.tp_check('P-OWN', 'the host removes their own idea (soft delete) and the chat is told',
    (v->>'removed') || '/' || (select (deleted_at is not null)::text from public.content_calendar_items where id = v_post) || '/' || (pg_temp.tp_lines() like '%Tobi P removed “P4270 Our new menu” from the plan.%')::text, 'true/true/true');
  select id, revision into v_task, v_rev from public.ops_work_cards where title = 'P4270 Print the menus · P4270 Palm Brand';
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_update('task', %L, '{"link":null,"note":"Two hundred copies"}'::jsonb, %s)::text$q$, v_task, v_rev)));
  perform pg_temp.tp_check('P-OWN', 'a host changes their own task while it is in To do',
    (select coalesce(files_url, '<none>') || '|' || instructions from public.ops_work_cards where id = v_task), '<none>|Added by Tobi P from the Brand group plan. Note: Two hundred copies');
  perform pg_temp.tp_like('P-LINE', 'removing a link posts a line', pg_temp.tp_lines(), '%Tobi P removed the link from “P4270 Print the menus”.%');
  update public.ops_work_cards set status = 'doing' where id = v_task;
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_remove('task', %L, %s)::text$q$, v_task, (select revision from public.ops_work_cards where id = v_task)));
  perform pg_temp.tp_like('P-OWN', 'a task Mingla started is locked', v_t, 'ERR:22023:locked:%');
end;
$own$;

-- ---------------------------------------------------------------------------
-- P-SADD, P-SLINK: staff add to the plan and set links (D12, D13)
-- ---------------------------------------------------------------------------
do $sadd$
declare v jsonb; v_t text; v_id uuid; v_on date := pg_temp.tp_day(20);
begin
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_brand_plan_add('42730000-0000-4000-c0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Staff teaser', 'on', %L, 'link', 'https://canva.com/teaser'), 'p4270-sadd-0001')::text$q$, v_on)));
  v_id := (v #>> '{item,id}')::uuid;
  perform pg_temp.tp_check('P-SADD', 'a staff post is a Calendar Idea for the brand; the link is the plan link, the Drive link untouched',
    (select stage || '|' || brand_id::text || '|' || plan_link_url || '|' || coalesce(drive_url, '<none>') || '|' || brand_plan_source || '|' || array_to_string(owner_emails, ',')
       from public.content_calendar_items where id = v_id),
    'idea|42730000-0000-4000-b0f0-000000000001|https://canva.com/teaser|<none>|host_card|gia.p4270@test.local');
  perform pg_temp.tp_like('P-LINE', 'staff lines use the first name only', pg_temp.tp_lines(), '%Gia added “P4270 Staff teaser” to the plan for%');
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_brand_plan_add('42730000-0000-4000-c0f0-000000000001',
    jsonb_build_object('type', 'task', 'title', 'P4270 Staff books the photographer', 'on', %L, 'note', 'Ask for two hours'), 'p4270-sadd-0002')::text$q$, v_on)));
  v_id := (v #>> '{item,id}')::uuid;
  perform pg_temp.tp_check('P-SADD', 'a staff task: To do, the host sees it, owned by the host card''s owners, Mingla writes the text',
    (v->>'status') || '|' || (select status || '|' || on_brand_plan::text || '|' || brand_plan_source || '|' || done_means from public.ops_work_cards where id = v_id)
      || '|' || pg_temp.tp_owners_of(v_id),
    'added|todo|true|host_card|Done and the host is told in the Brand group.|gia.p4270@test.local');
  perform pg_temp.tp_like('P-SADD', 'the note is in the instructions', (select instructions from public.ops_work_cards where id = v_id), '%Note: Ask for two hours');
  v_t := pg_temp.tp_agent('growth', format($q$select public.ops_brand_plan_add('42730000-0000-4000-c0f0-000000000001',
    jsonb_build_object('type', 'post', 'title', 'P4270 Agent post', 'on', %L), 'p4270-sadd-0003')::text$q$, v_on));
  perform pg_temp.tp_like('P-SADD', 'an agent cannot add to a plan', v_t, 'ERR:42501:people_only:%');

  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_brand_plan_set_link('task', %L, 'https://www.figma.com/p4270', %s)::text$q$,
    pg_temp.tp_id('C1'), pg_temp.tp_rev('C1'))));
  perform pg_temp.tp_check('P-SLINK', 'staff change the link on any task on the plan',
    (v #>> '{item,link,site}') || '|' || (select files_url from public.ops_work_cards where id = pg_temp.tp_id('C1')), 'figma.com|https://www.figma.com/p4270');
  perform pg_temp.tp_like('P-LINE', 'and the chat is told', pg_temp.tp_lines(), '%Gia changed the link on “P4270 Share the poster”.%');
  v_t := pg_temp.tp_person('growth', format($q$select public.ops_brand_plan_set_link('task', %L, 'javascript:alert(1)', %s)::text$q$, pg_temp.tp_id('C1'), pg_temp.tp_rev('C1')));
  perform pg_temp.tp_check('P-SLINK', 'only https', v_t, 'ERR:22023:invalid_link: Links start with https://');
  v_t := pg_temp.tp_person('growth', format($q$select public.ops_brand_plan_set_link('task', %L, 'https://x.example.com/a', %s)::text$q$, pg_temp.tp_id('C2'), pg_temp.tp_rev('C2')));
  perform pg_temp.tp_like('P-SLINK', 'a card the host cannot see is not on the plan', v_t, 'ERR:P0002:not_found:%');
end;
$sadd$;

-- ---------------------------------------------------------------------------
-- P-CAL: the Calendar's brand, collaborator, plan link and lines (OQ-5)
-- ---------------------------------------------------------------------------
do $cal$
declare v jsonb; v_t text; v_id uuid := '42730000-0000-4000-d0f0-000000000002'; v_rev bigint;
begin
  select revision into v_rev from public.content_calendar_items where id = v_id;
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.content_calendar_update(%L, jsonb_build_object(
    'collaborator_record_id', '42730000-0000-4000-c0f0-000000000009', 'plan_link_url', 'https://canva.com/undated'), %s, null)::text$q$, v_id, v_rev)));
  perform pg_temp.tp_check('P-CAL', 'the drawer reads brand, collaborator, plan link and host state (an undated Idea is not on the plan)',
    (v #>> '{item,brand_name}') || '|' || (v #>> '{item,collaborator,name}') || '|' || (v #>> '{item,plan_link_url}') || '|' || coalesce(v #>> '{item,host_state}', '<off>'),
    'P4270 Palm Brand|P4270 Creator Kemi|https://canva.com/undated|<off>');
  perform pg_temp.tp_check('P-CAL', 'the audit names the fields, never the link',
    (select (metadata ? 'plan_link_url')::text || '/' || (metadata->'changed_fields' ? 'plan_link_url')::text from public.content_calendar_audit where item_id = v_id order by created_at desc limit 1), 'false/true');
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.content_calendar_update(%L, jsonb_build_object('publish_at', %L), %s, null)::text$q$,
    v_id, (pg_temp.tp_day(30)::timestamp + time '09:00') AT TIME ZONE 'UTC', v_rev + 1)));
  perform pg_temp.tp_check('P-CAL', 'a date puts it on the plan as Planned, and the chat is told it was added',
    (v #>> '{item,host_state_words}') || '|' || (pg_temp.tp_lines() like format('%%Gia added “P4270 Undated idea” to the plan for %s.%%', public.brand_plan_day_words(pg_temp.tp_day(30))))::text, 'Planned|true');
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.content_calendar_update(%L, jsonb_build_object('publish_at', %L, 'title', 'P4270 Dated idea'), %s, null)::text$q$,
    v_id, (pg_temp.tp_day(31)::timestamp + time '09:00') AT TIME ZONE 'UTC', v_rev + 2)));
  perform pg_temp.tp_check('P-CAL', 'staff moving or renaming a brand post tell the chat',
    (pg_temp.tp_lines() like format('%%Gia moved “P4270 Dated idea” to %s.%%', public.brand_plan_day_words(pg_temp.tp_day(31))))::text || '/'
      || (pg_temp.tp_lines() like '%Gia renamed “P4270 Undated idea” to “P4270 Dated idea”.%')::text, 'true/true');
  v_t := pg_temp.tp_person('growth', format($q$select public.content_calendar_update(%L, '{"collaborator_record_id":"42730000-0000-4000-c0f0-000000000001"}'::jsonb, %s, null)::text$q$, v_id, v_rev + 3));
  perform pg_temp.tp_like('P-CAL', 'a collaborator is a Creators record', v_t, 'ERR:22023:invalid_collaborator:%');
  v_t := pg_temp.tp_person('growth', format($q$select public.content_calendar_update(%L, '{"plan_link_url":"http://example.com"}'::jsonb, %s, null)::text$q$, v_id, v_rev + 3));
  perform pg_temp.tp_like('P-CAL', 'the plan link is https only', v_t, 'ERR:22023:invalid_link:%');
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_calendar(%L, %L)::text$q$, pg_temp.tp_day(0), pg_temp.tp_day(40))));
  perform pg_temp.tp_check('P-CAL', 'the Calendar''s content rows carry the brand',
    (select c->>'brand_name' from jsonb_array_elements(v->'content') c where c->>'title' = 'P4270 Dated idea'), 'P4270 Palm Brand');
end;
$cal$;

-- ---------------------------------------------------------------------------
-- P-WHEN: the date an event is on now or next (W3 test P2-1)
-- ---------------------------------------------------------------------------
do $when$
declare v_host jsonb; v_staff jsonb; v_card jsonb;
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text) values
    ('42730000-0000-4000-f0f0-000000000011', '42730000-0000-4000-b0f0-000000000001', 'P4270 Weekly Jazz', 'p4270-weekly', 'discover', 'scheduled', 'UTC', now() - interval '20 days', 'event', 'P4270 Street'),
    ('42730000-0000-4000-f0f0-000000000012', '42730000-0000-4000-b0f0-000000000001', 'P4270 Pottery Course', 'p4270-course', 'discover', 'scheduled', 'UTC', now() - interval '50 days', 'experience', 'P4270 Street');
  insert into public.event_dates (event_id, start_at, end_at, is_master) values
    ('42730000-0000-4000-f0f0-000000000011', (pg_temp.tp_day(-14)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.tp_day(-14)::timestamp + time '22:00') AT TIME ZONE 'UTC', true),
    ('42730000-0000-4000-f0f0-000000000011', (pg_temp.tp_day(6)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.tp_day(6)::timestamp + time '22:00') AT TIME ZONE 'UTC', false),
    ('42730000-0000-4000-f0f0-000000000012', now() - interval '40 days', now() + interval '30 days', true);
  set local session_replication_role = origin;
  v_host := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, pg_temp.tp_day(-7), pg_temp.tp_day(60))));
  v_staff := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_brand_plan('42730000-0000-4000-c0f0-000000000001', %L, %L)::text$q$, pg_temp.tp_day(-7), pg_temp.tp_day(60))));
  perform pg_temp.tp_check('P-WHEN', 'a weekly event between dates is not live and sits on its next date, on both plans',
    (select (i->>'on') || '/' || (i->>'state') from jsonb_array_elements(v_host->'items') i where i->>'title' = 'P4270 Weekly Jazz') || ' ' ||
    (select (i->>'on') || '/' || (i->>'state') from jsonb_array_elements(v_staff->'items') i where i->>'title' = 'P4270 Weekly Jazz'),
    format('%s/on_mingla %s/on_mingla', pg_temp.tp_day(6), pg_temp.tp_day(6)));
  perform pg_temp.tp_check('P-WHEN', 'a course that started weeks ago and is still running is on today, Live now, on both plans',
    (select (i->>'on') || '/' || (i->>'state_words') from jsonb_array_elements(v_host->'items') i where i->>'title' = 'P4270 Pottery Course') || ' ' ||
    (select (i->>'on') || '/' || (i->>'state_words') from jsonb_array_elements(v_staff->'items') i where i->>'title' = 'P4270 Pottery Course'),
    format('%s/Live now %s/Live now', pg_temp.tp_day(0), pg_temp.tp_day(0)));
end;
$when$;

-- ---------------------------------------------------------------------------
-- P-RW: the Wave 3 test fixes
-- ---------------------------------------------------------------------------
create function pg_temp.tp_race() returns trigger
language plpgsql as $fn$
begin
  raise unique_violation using message = 'duplicate key value violates unique constraint "content_calendar_items_title_key"';
end;
$fn$;

do $rw$
declare v jsonb; v_t text; v_bad text; v_out text := ''; v_id uuid; v_rev bigint; v_card uuid; v_a jsonb; v_b jsonb; v_n integer := 0; v_lines integer; v_on date := pg_temp.tp_day(12); i integer;
begin
  -- Hidden characters and anything before the site name are refused (P3-2).
  foreach v_bad in array array[
      'https://canva.com' || chr(8238) || 'moc.live', 'https://canva.com' || chr(8203) || '/x', 'https://canva.com/' || chr(7),
      'https://canva.com' || chr(160) || '/x', 'https://canva.com/' || chr(917505), 'https://canva.com:x@evil.example', 'https://canva.com@evil.example/', 'https://canva.com\@evil.example'] loop
    v_out := v_out || left(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','post','title','P4270 Sneaky link','on',%L,'link',%L), 'p4270-rw-link-' || md5(%L))::text$q$, v_on, v_bad, v_bad)), 22) || ' ';
  end loop;
  perform pg_temp.tp_check('P-RW', 'a link with hidden characters, or with anything before the site name, is refused', btrim(v_out), btrim(repeat('ERR:22023:invalid_link ', 8)));
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','post','title','P4270 At in the path','on',%L,'link','https://canva.com/@tobi/x'), 'p4270-rw-at-0001')::text$q$, v_on)));
  perform pg_temp.tp_check('P-RW', 'an @ after the site name is fine', v #>> '{item,link,site}', 'canva.com');

  -- What a host is told never depends on titles they cannot see (P3-3).
  insert into public.content_calendar_items (title, owner_emails, created_by, updated_by) values ('P4270 Secret launch', ARRAY[]::text[], 'gia.p4270@test.local', 'gia.p4270@test.local');
  v_a := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','post','title','P4270 Secret launch','on',%L), 'p4270-rw-oracle-1')::text$q$, v_on)));
  v_b := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','post','title','P4270 Nothing like it','on',%L), 'p4270-rw-oracle-2')::text$q$, v_on)));
  perform pg_temp.tp_check('P-RW', 'a taken title and a free title answer the same', (v_a->>'title_changed') || '/' || (v_b->>'title_changed') || '/' || (v_a #>> '{item,title}'), 'false/false/P4270 Secret launch');

  -- A raced title gets the D24 words, not the raw constraint (P3-8).
  create trigger tp_race_trigger before insert on public.content_calendar_items for each row when (new.title like 'P4270 Raced%') execute function pg_temp.tp_race();
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','post','title','P4270 Raced host','on',%L), 'p4270-rw-race-01')::text$q$, v_on));
  perform pg_temp.tp_check('P-RW', 'a host add that loses a race on the title is told in plain words', v_t, 'ERR:23505:duplicate_title: Something with this name is already planned. Change the name a little.');
  v_t := pg_temp.tp_person('growth', format($q$select public.ops_brand_plan_add('42730000-0000-4000-c0f0-000000000001', jsonb_build_object('type','post','title','P4270 Raced staff','on',%L), 'p4270-rw-race-02')::text$q$, v_on));
  perform pg_temp.tp_check('P-RW', 'a staff add that loses a race on the title is told in plain words', v_t, 'ERR:23505:duplicate_title: Something with this name is already planned. Change the name a little.');
  drop trigger tp_race_trigger on public.content_calendar_items;

  -- The form shows what will be saved; [] means nobody (P3-9).
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_brand_plan('42730000-0000-4000-c0f0-000000000001', %L, %L)::text$q$, pg_temp.tp_day(0), pg_temp.tp_day(30))));
  perform pg_temp.tp_check('P-RW', 'the staff plan says who owns and watches a new task', (v->'task_defaults')::text, '{"owners": ["gia.p4270@test.local"], "watchers": ["kunle.p4270@test.local"]}');
  v := pg_temp.tp_j(pg_temp.tp_person('growth', format($q$select public.ops_brand_plan_add('42730000-0000-4000-c0f0-000000000001', jsonb_build_object('type','task','title','P4270 Nobody watches','on',%L,'watchers','[]'::jsonb), 'p4270-rw-watch-1')::text$q$, v_on)));
  perform pg_temp.tp_check('P-RW', 'a task sent with no watchers has none', (select count(*)::text from public.ops_work_people p where p.card_id = (v #>> '{item,id}')::uuid and p.role = 'watcher'), '0');

  -- Staff switching Host can see this: the card leaves, and the host can no longer change it (P3-1); the chat is told (P4).
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','task','title','P4270 Hidden later','on',%L), 'p4270-rw-hide-01')::text$q$, v_on)));
  v_card := (v #>> '{item,id}')::uuid;
  update public.ops_work_cards set on_brand_plan = false, updated_by = 'gia.p4270@test.local' where id = v_card returning revision into v_rev;
  perform pg_temp.tp_like('P-RW', 'switching it off tells the chat', pg_temp.tp_lines(), '%Gia removed “P4270 Hidden later” from the plan.%');
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_update('task', %L, '{"title":"P4270 Still mine"}'::jsonb, %s)::text$q$, v_card, v_rev));
  perform pg_temp.tp_check('P-RW', 'a host cannot rename their task once hidden', v_t, 'ERR:P0002:not_found: This item is not on your plan.');
  v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_remove('task', %L, %s)::text$q$, v_card, v_rev));
  perform pg_temp.tp_check('P-RW', 'nor remove it', v_t, 'ERR:P0002:not_found: This item is not on your plan.');
  update public.ops_work_cards set on_brand_plan = true, updated_by = 'gia.p4270@test.local' where id = v_card;
  perform pg_temp.tp_like('P-RW', 'switching it on tells the chat', pg_temp.tp_lines(), format('%%Gia added “P4270 Hidden later” to the plan for %s.%%', public.brand_plan_day_words(v_on)));

  -- can_edit needs write rank (P3-5).
  update public.brand_team_members set role = 'scanner' where brand_id = '42730000-0000-4000-b0f0-000000000001' and user_id = '42730000-0000-4000-a0f1-000000000002';
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, pg_temp.tp_day(0), pg_temp.tp_day(30))));
  perform pg_temp.tp_check('P-RW', 'a host demoted to scanner keeps their items but cannot edit them',
    (select (x->>'mine') || '/' || (x->>'can_edit') from jsonb_array_elements(v->'items') x where x->>'title' = 'P4270 Nothing like it') || '/' || (v->>'can_add'), 'true/false/false');
  update public.brand_team_members set role = 'marketing_manager' where brand_id = '42730000-0000-4000-b0f0-000000000001' and user_id = '42730000-0000-4000-a0f1-000000000002';

  -- Venue staff read the plan (D14), never write, and get no private events (P3-6).
  v := pg_temp.tp_j(pg_temp.tp_as('vic', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, pg_temp.tp_day(0), pg_temp.tp_day(30))));
  perform pg_temp.tp_check('P-RW', 'venue staff read the plan, cannot add, and see public events but no private one',
    (v->>'can_add') || '/' || (select count(*)::text from jsonb_array_elements(v->'items') x where x->>'title' = 'P4270 Supper Club') || '/' || (select count(*)::text from jsonb_array_elements(v->'items') x where x->>'title' = 'P4270 Private Night'), 'false/1/0');
  v_t := pg_temp.tp_as('vic', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','post','title','P4270 Vic post','on',%L), 'p4270-rw-vic-001')::text$q$, v_on));
  perform pg_temp.tp_like('P-RW', 'venue staff cannot add', v_t, 'ERR:42501:read_only:%');
  update public.brand_team_members set removed_at = now() where brand_id = '42730000-0000-4000-b0f0-000000000001' and user_id = '42730000-0000-4000-a0f1-000000000006';
  v_t := pg_temp.tp_as('vic', format($q$select public.brand_plan_for_host('42730000-0000-4000-b0f0-000000000001', %L, %L)::text$q$, pg_temp.tp_day(0), pg_temp.tp_day(30)));
  perform pg_temp.tp_check('P-RW', 'removed venue staff get the same not_found', v_t, 'ERR:P0002:not_found: This plan is not here.');

  -- A limit on changes, so renames cannot flood the chat (P3-4). Last: it uses up Tobi's hour.
  v := pg_temp.tp_j(pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_add('42730000-0000-4000-b0f0-000000000001', jsonb_build_object('type','post','title','P4270 Rename me','on',%L), 'p4270-rw-flood-1')::text$q$, v_on)));
  v_id := (v #>> '{item,id}')::uuid;
  v_lines := pg_temp.tp_line_count();
  for i in 1..16 loop
    select revision into v_rev from public.content_calendar_items where id = v_id;
    v_t := pg_temp.tp_as('tobi', format($q$select public.brand_plan_host_update('post', %L, jsonb_build_object('title', %L), %s)::text$q$, v_id, 'P4270 Rename me ' || i, v_rev));
    exit when v_t like 'ERR:%';
    v_n := v_n + 1;
  end loop;
  perform pg_temp.tp_like('P-RW', 'too many changes in an hour are refused', v_t, 'ERR:22023:too_many:%');
  perform pg_temp.tp_check('P-RW', 'so at most 12 changes post lines', ((pg_temp.tp_line_count() - v_lines) <= 12 and v_n between 1 and 12)::text, 'true');
end;
$rw$;

select count(*) as tp_total, count(*) filter (where not ok) as tp_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tp_failures
  from tp_results \gset
rollback;

select (:tp_total < 50 or :tp_failed > 0) as tp_bad \gset
\if :tp_bad
  \echo 'ISSUE-4270 W3 FAILED:' :tp_failed 'of' :tp_total
  \echo :tp_failures
  do $$ begin raise exception 'ISSUE-4270 W3 FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W3 PASS:' :tp_total 'checks, 0 failed'
