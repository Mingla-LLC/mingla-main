-- Issue #4270 (Wave 3) -- tester adversarial suite for
-- 20280403024270_issue_4270_w3_brand_plan.sql, on the fully replayed PG17
-- schema. Different angles from the implementor's happy path:
--
--   T-ANON    the anon role cannot run any of the four host functions, and
--             no brand_plan* or ops_brand_plan* function at all
--   T-DOOR    one answer for everyone outside: a signed-in outsider, an
--             invited (not accepted) member, a removed member, a member of
--             a deleted brand and a brand that does not exist all get the
--             same not_found words, before any check of the item, the window
--             or the request key (no oracle); nothing is written
--   T-RANK    D14 at its edges: scanner reads with can_add false and is
--             refused every write (42501); marketing_manager and
--             finance_manager add; venue staff never write; a host demoted
--             to scanner cannot change or remove their own item
--   T-FORGE   D7 with forged ids: a staff post, another host's post, a post
--             of brand B, a post staff moved to brand B, a task id sent as a
--             post, an unknown kind and a random id all get the same words;
--             a removed author is not found; nothing changes
--   T-LEAK    the host read of brand A: exactly these posts, tasks and
--             events; no other brand's, no undated idea, no deleted post, no
--             brandless post, no unflagged, archived or deleted-record card,
--             no cancelled or deleted event, never a promised event (D22);
--             not one address, staff name, Drive link, copy, note,
--             instructions or done means anywhere in the text; exact key
--             sets; live_url only when Posted; at only when Scheduled or
--             Posted
--   T-STAFF   the staff plan keeps private and hidden events off, shows the
--             promised event as Promised and the Drive link apart
--   T-READ    the plan is a read: a staff Calendar date move shows on the
--             host plan at once with the same id and no new row; switching
--             Host can see this off takes a card off at once
--   T-FN      every brand_plan*/ops_brand_plan* function has a pinned
--             search_path, no anon or PUBLIC EXECUTE, every internal helper
--             is closed to authenticated, the host four are SECURITY DEFINER
--             and closed to service_role; no function names 40001
--   T-CLASH   D24: a clash with another brand's post gets " · {brand}"; a
--             second clash asks to change the name (23505); a clash that is
--             only case and spaces counts; a done card does not clash; a
--             158-character title keeps the suffix within 160
--   T-NOON    D17: a host post is at 12:00 UTC on its date
--   T-OWN     D6/D21 on a brand with three host records (one deleted): the
--             oldest record's owners own a host task, the second record's
--             other owner watches, the deleted record's owner does not, and
--             nobody is both; a brand with no host record cannot add a task
--             but can add a post
--   T-TEXT    C-6: a host task's instructions and done means are written by
--             the server; the note goes into instructions
--   T-LINK    http, javascript:, "https://" alone, a space, 2,001 characters
--             and a number are refused on host add, host update, staff
--             set_link and the Calendar; a padded https link is trimmed; the
--             Drive link is never touched (D13)
--   T-LINE    D23: one quiet line per add, date move, link added and link
--             removed (host) and per staff Calendar date or title edit; none
--             for a notes-only edit; no sender, type system, the URL never in
--             the text, only in the brand's own group; the lines count as
--             unread in the brand's group list
--   T-409     an old revision is PT409 for update and remove
--   T-KEY     a replayed request key returns the first answer and writes
--             nothing; the same key with another item is refused
--   T-DEV     the deviations: a 2-character task is refused, a post is not;
--             a task far ahead goes in today's sprint; set_link refuses an
--             agent, an event id and a card not on the plan; the
--             collaborator must be a live Creators record
--
-- FAILS-ON-REVERT: see the w3 test report (membership statement removed
-- from brand_plan_for_host and brand_plan_host_add; the owner check removed
-- from brand_plan_host_update; drive_url read into the host post; the
-- plan_link check loosened to http).
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table ta_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into ta_people (who, id, email) values
  ('gia',      '42740000-0000-4000-a0a0-000000000001', 'gia.t4270@test.local'),
  ('kunle',    '42740000-0000-4000-a0a0-000000000002', 'kunle.t4270@test.local'),
  ('zed',      '42740000-0000-4000-a0a0-000000000003', 'zed.t4270@test.local'),
  ('ola',      '42740000-0000-4000-a0a1-000000000001', 'ola.t4270@test.local'),
  ('ife',      '42740000-0000-4000-a0a1-000000000002', 'ife.t4270@test.local'),
  ('fin',      '42740000-0000-4000-a0a1-000000000003', 'fin.t4270@test.local'),
  ('scan',     '42740000-0000-4000-a0a1-000000000004', 'scan.t4270@test.local'),
  ('venue',    '42740000-0000-4000-a0a1-000000000005', 'venue.t4270@test.local'),
  ('pending',  '42740000-0000-4000-a0a1-000000000006', 'pending.t4270@test.local'),
  ('removed',  '42740000-0000-4000-a0a1-000000000007', 'removed.t4270@test.local'),
  ('bob',      '42740000-0000-4000-a0a1-000000000008', 'bob.t4270@test.local'),
  ('outsider', '42740000-0000-4000-a0a1-000000000009', 'outsider.t4270@test.local'),
  ('ghost',    '42740000-0000-4000-a0a1-00000000000a', 'ghost.t4270@test.local'),
  ('nora',     '42740000-0000-4000-a0a1-00000000000b', 'nora.t4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ta_people;
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.t4270@test.local', 'growth', 'active', now()), ('kunle.t4270@test.local', 'growth', 'active', now()),
  ('zed.t4270@test.local', 'growth', 'active', now());
insert into public.ops_team_profiles (email, display_name, updated_by) values
  ('gia.t4270@test.local', 'Gia Okafor-Ade', 'system@usemingla.com'), ('kunle.t4270@test.local', 'Kunle Bello', 'system@usemingla.com'),
  ('zed.t4270@test.local', 'Zed Quinn', 'system@usemingla.com')
  on conflict (email) do update set display_name = excluded.display_name;

create temp table ta_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table ta_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.ta_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from ta_people where who = p_who;
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

create function pg_temp.ta_anon(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role anon;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.email', '', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.ta_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.ta_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.ta_next_request();
  return pg_temp.ta_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.ta_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.ta_next_request();
  select id, email into strict v_id, v_email from ta_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.ta_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.ta_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 700), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.ta_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 700), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.ta_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.ta_id(p_k text) returns uuid
language sql as $fn$ select id from ta_ids where k = p_k $fn$;
create function pg_temp.ta_day(p_n integer) returns date
language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date + p_n $fn$;
create function pg_temp.ta_rows() returns text
language sql as $fn$
  select (select count(*) from public.content_calendar_items where title like 'T4270%') || '/'
      || (select count(*) from public.ops_work_cards where title like 'T4270%') || '/'
      || (select count(*) from public.messages where conversation_id in ('42740000-0000-4000-e0a0-000000000001','42740000-0000-4000-e0a0-000000000002'))
$fn$;
create function pg_temp.ta_lines(p_conv text) returns text
language sql as $fn$
  -- one transaction gives every line the same created_at: compare in text order
  select coalesce(string_agg(m.content, ' | ' order by m.content), '') from public.messages m
   where m.conversation_id = p_conv::uuid and m.message_type = 'system'
$fn$;
create function pg_temp.ta_line_n(p_conv text) returns integer
language sql as $fn$ select count(*)::integer from public.messages m where m.conversation_id = p_conv::uuid $fn$;

-- ---------------------------------------------------------------------------
-- Fixtures. Brand A (three host records, one deleted), brand B (one), brand
-- N (no host record), brand D (deleted).
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at, default_timezone, deleted_at) values
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-b1a0-000000000001', 'T4270 Basil House', 't4270-basil', 'Lagos', now() - interval '90 days', 'UTC', null),
  ('42740000-0000-4000-b0a0-000000000002', '42740000-0000-4000-b1a0-000000000002', 'T4270 Cedar Bar', 't4270-cedar', 'Lagos', now() - interval '90 days', 'UTC', null),
  ('42740000-0000-4000-b0a0-000000000003', '42740000-0000-4000-b1a0-000000000003', 'T4270 Gone Brand', 't4270-gone', 'Lagos', now() - interval '90 days', 'UTC', now() - interval '1 day'),
  ('42740000-0000-4000-b0a0-000000000004', '42740000-0000-4000-b1a0-000000000004', 'T4270 New Brand', 't4270-new', 'Lagos', now() - interval '9 days', 'UTC', null);
insert into public.profiles (id, email, display_name, first_name)
select id, email, initcap(who) || ' Host', initcap(who) from ta_people where who not in ('gia','kunle','zed')
  on conflict (id) do update set display_name = excluded.display_name, first_name = excluded.first_name;
insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at) values
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000001', 'marketing_manager', now() - interval '30 days', now() - interval '30 days', null),
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000002', 'marketing_manager', now() - interval '30 days', now() - interval '30 days', null),
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000003', 'finance_manager', now() - interval '30 days', now() - interval '30 days', null),
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000004', 'scanner', now() - interval '30 days', now() - interval '30 days', null),
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000005', 'venue_staff', now() - interval '30 days', now() - interval '30 days', null),
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000006', 'marketing_manager', now() - interval '3 days', null, null),
  ('42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000007', 'marketing_manager', now() - interval '30 days', now() - interval '30 days', now() - interval '1 day'),
  ('42740000-0000-4000-b0a0-000000000002', '42740000-0000-4000-a0a1-000000000008', 'brand_owner', now() - interval '30 days', now() - interval '30 days', null),
  ('42740000-0000-4000-b0a0-000000000003', '42740000-0000-4000-a0a1-00000000000a', 'brand_owner', now() - interval '30 days', now() - interval '30 days', null),
  ('42740000-0000-4000-b0a0-000000000004', '42740000-0000-4000-a0a1-00000000000b', 'marketing_manager', now() - interval '9 days', now() - interval '9 days', null);
insert into public.conversations (id, type, linked_entity_type, brand_id, name, is_enabled) values
  ('42740000-0000-4000-e0a0-000000000001', 'group', 'brand', '42740000-0000-4000-b0a0-000000000001', 'T4270 Basil House · Brand group', true),
  ('42740000-0000-4000-e0a0-000000000002', 'group', 'brand', '42740000-0000-4000-b0a0-000000000002', 'T4270 Cedar Bar · Brand group', true),
  ('42740000-0000-4000-e0a0-000000000004', 'group', 'brand', '42740000-0000-4000-b0a0-000000000004', 'T4270 New Brand · Brand group', true);
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by, created_at, deleted_at, deleted_by) values
  ('42740000-0000-4000-c0a0-000000000001', 'hosts', 'T4270 Basil Main', 'live', '42740000-0000-4000-b0a0-000000000001', 'event_organizer', 't-fixture', 't-fixture', now() - interval '80 days', null, null),
  ('42740000-0000-4000-c0a0-000000000002', 'hosts', 'T4270 Basil Annex', 'onboarded', '42740000-0000-4000-b0a0-000000000001', 'event_organizer', 't-fixture', 't-fixture', now() - interval '40 days', null, null),
  ('42740000-0000-4000-c0a0-000000000003', 'hosts', 'T4270 Basil Old', 'live', '42740000-0000-4000-b0a0-000000000001', 'event_organizer', 't-fixture', 't-fixture', now() - interval '20 days', now() - interval '2 days', 't-fixture'),
  ('42740000-0000-4000-c0a0-000000000004', 'hosts', 'T4270 Cedar Main', 'live', '42740000-0000-4000-b0a0-000000000002', 'event_organizer', 't-fixture', 't-fixture', now() - interval '80 days', null, null);
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, deleted_at, deleted_by) values
  ('42740000-0000-4000-c0a0-000000000009', 'creators', 'T4270 Creator Live', 'identified', 't-fixture', 't-fixture', null, null),
  ('42740000-0000-4000-c0a0-00000000000a', 'creators', 'T4270 Creator Gone', 'identified', 't-fixture', 't-fixture', now() - interval '1 day', 't-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('42740000-0000-4000-c0a0-000000000001', 'gia.t4270@test.local', 't-fixture'),
  ('42740000-0000-4000-c0a0-000000000002', 'kunle.t4270@test.local', 't-fixture'),
  ('42740000-0000-4000-c0a0-000000000002', 'gia.t4270@test.local', 't-fixture'),
  ('42740000-0000-4000-c0a0-000000000003', 'zed.t4270@test.local', 't-fixture'),
  ('42740000-0000-4000-c0a0-000000000004', 'kunle.t4270@test.local', 't-fixture');

do $fx$
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text, deleted_at) values
    ('42740000-0000-4000-f0a0-000000000001', '42740000-0000-4000-b0a0-000000000001', 'T4270 Open Night', 't4270-open', 'discover', 'scheduled', 'UTC', now() - interval '5 days', 'event', 'T4270 Street', null),
    ('42740000-0000-4000-f0a0-000000000002', '42740000-0000-4000-b0a0-000000000001', 'T4270 Private Dinner', 't4270-private', 'private', 'scheduled', 'UTC', now() - interval '5 days', 'event', 'T4270 Street', null),
    ('42740000-0000-4000-f0a0-000000000003', '42740000-0000-4000-b0a0-000000000001', 'T4270 Hidden Tasting', 't4270-hidden', 'hidden', 'scheduled', 'UTC', now() - interval '5 days', 'event', 'T4270 Street', null),
    ('42740000-0000-4000-f0a0-000000000004', '42740000-0000-4000-b0a0-000000000001', 'T4270 Called Off', 't4270-off', 'discover', 'cancelled', 'UTC', now() - interval '5 days', 'event', 'T4270 Street', null),
    ('42740000-0000-4000-f0a0-000000000005', '42740000-0000-4000-b0a0-000000000001', 'T4270 Deleted Gig', 't4270-deleted', 'discover', 'scheduled', 'UTC', now() - interval '5 days', 'event', 'T4270 Street', now() - interval '1 day'),
    ('42740000-0000-4000-f0a0-000000000006', '42740000-0000-4000-b0a0-000000000001', 'T4270 Pottery Week', 't4270-pottery', 'discover', 'scheduled', 'UTC', now() - interval '9 days', 'experience', 'T4270 Street', null),
    ('42740000-0000-4000-f0a0-000000000007', '42740000-0000-4000-b0a0-000000000002', 'T4270 Cedar Party', 't4270-cedar-party', 'discover', 'scheduled', 'UTC', now() - interval '5 days', 'event', 'T4270 Street', null);
  insert into public.event_dates (event_id, start_at, end_at, is_master) values
    ('42740000-0000-4000-f0a0-000000000001', (pg_temp.ta_day(8)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.ta_day(8)::timestamp + time '23:00') AT TIME ZONE 'UTC', true),
    ('42740000-0000-4000-f0a0-000000000002', (pg_temp.ta_day(9)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.ta_day(9)::timestamp + time '23:00') AT TIME ZONE 'UTC', true),
    ('42740000-0000-4000-f0a0-000000000003', (pg_temp.ta_day(10)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.ta_day(10)::timestamp + time '23:00') AT TIME ZONE 'UTC', true),
    ('42740000-0000-4000-f0a0-000000000004', (pg_temp.ta_day(11)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.ta_day(11)::timestamp + time '23:00') AT TIME ZONE 'UTC', true),
    ('42740000-0000-4000-f0a0-000000000005', (pg_temp.ta_day(12)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.ta_day(12)::timestamp + time '23:00') AT TIME ZONE 'UTC', true),
    ('42740000-0000-4000-f0a0-000000000006', now() - interval '2 days', now() + interval '3 days', true),
    ('42740000-0000-4000-f0a0-000000000007', (pg_temp.ta_day(8)::timestamp + time '19:00') AT TIME ZONE 'UTC', (pg_temp.ta_day(8)::timestamp + time '23:00') AT TIME ZONE 'UTC', true);
  set local session_replication_role = origin;
end;
$fx$;

-- Posts. P1 a dated Idea of A with every staff-only field filled; P2 In
-- review; P3 Posted; P4 an undated Idea; P5 brand B; P6 no brand; P7 deleted;
-- P8 brand B's host's own post; P9 another A host's own post.
insert into public.content_calendar_items (id, title, stage, owner_emails, publish_at, notes, drive_url, live_url, copy_text, copy_approved_by, copy_approved_at,
    design_approved_by, design_approved_at, channels, brand_id, plan_link_url, brand_plan_author_id, brand_plan_source, created_by, updated_by, deleted_at) values
  ('42740000-0000-4000-d0a0-000000000001', 'T4270 Menu teaser', 'idea', ARRAY['gia.t4270@test.local'], (pg_temp.ta_day(3)::timestamp + time '18:00') AT TIME ZONE 'UTC',
   'SECRET-NOTES-T4270', 'https://drive.google.com/SECRET-DRIVE-T4270', 'https://instagram.com/SECRET-LIVE-T4270', 'SECRET-COPY-T4270', null, null, null, null, ARRAY[]::text[],
   '42740000-0000-4000-b0a0-000000000001', 'https://www.canva.com/t4270-plan', null, 'host_card', 'gia.t4270@test.local', 'gia.t4270@test.local', null),
  ('42740000-0000-4000-d0a0-000000000002', 'T4270 Chef reel', 'review', ARRAY['kunle.t4270@test.local'], (pg_temp.ta_day(4)::timestamp + time '10:00') AT TIME ZONE 'UTC',
   null, null, null, 'SECRET-COPY2-T4270', 'kunle.t4270@test.local', now(), null, null, ARRAY['instagram'],
   '42740000-0000-4000-b0a0-000000000001', null, null, null, 'kunle.t4270@test.local', 'kunle.t4270@test.local', null),
  ('42740000-0000-4000-d0a0-000000000003', 'T4270 Launch post', 'published', ARRAY['gia.t4270@test.local'], (pg_temp.ta_day(-2)::timestamp + time '17:30') AT TIME ZONE 'UTC',
   null, null, 'https://instagram.com/p/t4270-live', 'SECRET-COPY3-T4270', 'gia.t4270@test.local', now(), 'gia.t4270@test.local', now(), ARRAY['instagram'],
   '42740000-0000-4000-b0a0-000000000001', null, null, null, 'gia.t4270@test.local', 'gia.t4270@test.local', null),
  ('42740000-0000-4000-d0a0-000000000004', 'T4270 Someday idea', 'idea', ARRAY['gia.t4270@test.local'], null,
   null, null, null, null, null, null, null, null, ARRAY[]::text[], '42740000-0000-4000-b0a0-000000000001', null, null, null, 'gia.t4270@test.local', 'gia.t4270@test.local', null),
  ('42740000-0000-4000-d0a0-000000000005', 'T4270 Cedar promo', 'idea', ARRAY['gia.t4270@test.local'], (pg_temp.ta_day(5)::timestamp + time '12:00') AT TIME ZONE 'UTC',
   null, null, null, null, null, null, null, null, ARRAY[]::text[], '42740000-0000-4000-b0a0-000000000002', null, null, null, 'gia.t4270@test.local', 'gia.t4270@test.local', null),
  ('42740000-0000-4000-d0a0-000000000006', 'T4270 Investor update', 'idea', ARRAY['gia.t4270@test.local'], (pg_temp.ta_day(5)::timestamp + time '12:00') AT TIME ZONE 'UTC',
   null, null, null, null, null, null, null, null, ARRAY[]::text[], null, null, null, null, 'gia.t4270@test.local', 'gia.t4270@test.local', null),
  ('42740000-0000-4000-d0a0-000000000007', 'T4270 Dropped post', 'idea', ARRAY['gia.t4270@test.local'], (pg_temp.ta_day(5)::timestamp + time '12:00') AT TIME ZONE 'UTC',
   null, null, null, null, null, null, null, null, ARRAY[]::text[], '42740000-0000-4000-b0a0-000000000001', null, null, null, 'gia.t4270@test.local', 'gia.t4270@test.local', now()),
  ('42740000-0000-4000-d0a0-000000000008', 'T4270 Bob own post', 'idea', ARRAY[]::text[], (pg_temp.ta_day(6)::timestamp + time '12:00') AT TIME ZONE 'UTC',
   null, null, null, null, null, null, null, null, ARRAY[]::text[], '42740000-0000-4000-b0a0-000000000002', null, '42740000-0000-4000-a0a1-000000000008', 'host_app', 'bob.t4270@test.local', 'bob.t4270@test.local', null),
  ('42740000-0000-4000-d0a0-000000000009', 'T4270 Ife own post', 'idea', ARRAY[]::text[], (pg_temp.ta_day(6)::timestamp + time '12:00') AT TIME ZONE 'UTC',
   null, null, null, null, null, null, null, null, ARRAY[]::text[], '42740000-0000-4000-b0a0-000000000001', null, '42740000-0000-4000-a0a1-000000000002', 'host_app', 'ife.t4270@test.local', 'ife.t4270@test.local', null);

-- Cards. K1 seen, on the second record; K2 not seen; K3 seen but archived;
-- K4 seen but only on the deleted record; K5 brand B; K6 seen and done.
do $cards$
declare v_id uuid; v_k text; v_t text; v_r uuid; v_on boolean; v_due integer; v_status text;
begin
  for v_k, v_t, v_r, v_on, v_due, v_status in values
    ('K1', 'T4270 Print the menus', '42740000-0000-4000-c0a0-000000000002'::uuid, true, 6, 'todo'),
    ('K2', 'T4270 Chase the invoice', '42740000-0000-4000-c0a0-000000000001'::uuid, false, 4, 'todo'),
    ('K3', 'T4270 Old archived task', '42740000-0000-4000-c0a0-000000000001'::uuid, true, 4, 'todo'),
    ('K4', 'T4270 Deleted record task', '42740000-0000-4000-c0a0-000000000003'::uuid, true, 4, 'todo'),
    ('K5', 'T4270 Cedar task', '42740000-0000-4000-c0a0-000000000004'::uuid, true, 4, 'todo'),
    ('K6', 'T4270 Finished task', '42740000-0000-4000-c0a0-000000000001'::uuid, true, 2, 'done') loop
    insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id, files_url, on_brand_plan, brand_plan_source,
      created_by, updated_by, archived_at, archived_by, archive_reason, closed_at, closed_by, close_kind, proof)
    values (v_t, 'SECRET-INSTRUCTIONS-T4270 do this well and say what changed.', 'SECRET-DONE-T4270 it is done and checked.', v_status, pg_temp.ta_day(v_due), 'explicit',
      public.ops_sprint_ensure(pg_temp.ta_day(0)), case when v_k = 'K1' then 'https://dropbox.com/t4270-files' end, v_on, 'host_card',
      'gia.t4270@test.local', 'gia.t4270@test.local',
      case when v_k = 'K3' then now() end, case when v_k = 'K3' then 'gia.t4270@test.local' end, case when v_k = 'K3' then 'T4270 fixture' end,
      case when v_status = 'done' then now() end, case when v_status = 'done' then 'gia.t4270@test.local' end, case when v_status = 'done' then 'done' end,
      case when v_status = 'done' then jsonb_build_array(jsonb_build_object('kind','note','text','SECRET-PROOF-T4270 sent and confirmed by the host.')) else '[]'::jsonb end)
    returning id into v_id;
    insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, 'gia.t4270@test.local', 'owner', 'gia.t4270@test.local');
    insert into public.ops_work_links (card_id, kind, target_id, label, added_by) values (v_id, 'host', v_r, 'host', 'gia.t4270@test.local');
    insert into ta_ids (k, id) values (v_k, v_id);
  end loop;
end;
$cards$;

insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by)
values ('42740000-0000-4000-d1a0-000000000001', '42740000-0000-4000-c0a0-000000000001', 'T4270 Promised Brunch', 'event', pg_temp.ta_day(14), 'none', 'gia.t4270@test.local', 'gia.t4270@test.local');

-- ---------------------------------------------------------------------------
-- T-ANON, T-FN
-- ---------------------------------------------------------------------------
do $fn$
declare v_t text; v_bad text;
begin
  v_t := concat_ws(' ',
    left(pg_temp.ta_anon($q$select public.brand_plan_for_host('42740000-0000-4000-b0a0-000000000001', current_date, current_date + 30)::text$q$), 9),
    left(pg_temp.ta_anon($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 anon","on":"2099-01-01"}'::jsonb, null)::text$q$), 9),
    left(pg_temp.ta_anon($q$select public.brand_plan_host_update('post', '42740000-0000-4000-d0a0-000000000009', '{"title":"T4270 anon"}'::jsonb, 1)::text$q$), 9),
    left(pg_temp.ta_anon($q$select public.brand_plan_host_remove('post', '42740000-0000-4000-d0a0-000000000009', 1)::text$q$), 9));
  perform pg_temp.ta_check('T-ANON', 'anon cannot run read, add, update or remove (permission denied, 42501)', v_t, 'ERR:42501 ERR:42501 ERR:42501 ERR:42501');
  perform pg_temp.ta_check('T-ANON', 'and nothing was written', pg_temp.ta_rows(), '9/6/0');

  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'brand\_plan%' or p.proname like 'ops\_brand\_plan%')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          or not coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false));
  perform pg_temp.ta_check('T-FN', 'every plan function pins search_path and is closed to anon and PUBLIC', coalesce(v_bad, 'none'), 'none');

  select string_agg(p.proname, ', ' order by 1) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'brand\_plan%'
     and p.proname not in ('brand_plan_for_host','brand_plan_host_add','brand_plan_host_update','brand_plan_host_remove')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform pg_temp.ta_check('T-FN', 'no internal helper is callable by a signed-in user', coalesce(v_bad, 'none'), 'none');

  select string_agg(p.proname || ':' || p.prosecdef || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    || ':' || has_function_privilege('service_role', p.oid, 'EXECUTE'), ', ' order by 1) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('brand_plan_for_host','brand_plan_host_add','brand_plan_host_update','brand_plan_host_remove');
  perform pg_temp.ta_check('T-FN', 'the host four: SECURITY DEFINER, signed-in users yes, service_role no',
    v_t, 'brand_plan_for_host:true:true:false, brand_plan_host_add:true:true:false, brand_plan_host_remove:true:true:false, brand_plan_host_update:true:true:false');

  select string_agg(p.proname, ', ' order by 1) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'brand\_plan%' or p.proname like 'ops\_brand\_plan%' or p.proname = 'content_calendar_update')
     and p.prosrc like '%40001%';
  perform pg_temp.ta_check('T-FN', 'no plan function raises 40001', coalesce(v_bad, 'none'), 'none');
  perform pg_temp.ta_check('T-FN', 'the Calendar save stays signed-in only',
    has_function_privilege('anon', 'public.content_calendar_update(uuid,jsonb,bigint,text)', 'EXECUTE')::text || '/'
    || has_function_privilege('authenticated', 'public.content_calendar_update(uuid,jsonb,bigint,text)', 'EXECUTE')::text, 'false/true');
end;
$fn$;

-- ---------------------------------------------------------------------------
-- T-DOOR
-- ---------------------------------------------------------------------------
do $door$
declare v_t text; v_words text := 'ERR:P0002:not_found: This plan is not here.'; v_who text; v_brand text; v_set text := '';
begin
  for v_who, v_brand in values ('outsider', '42740000-0000-4000-b0a0-000000000001'), ('pending', '42740000-0000-4000-b0a0-000000000001'),
      ('removed', '42740000-0000-4000-b0a0-000000000001'), ('ghost', '42740000-0000-4000-b0a0-000000000003'),
      ('ola', '42740000-0000-4000-b0a0-0000000000ff'), ('bob', '42740000-0000-4000-b0a0-000000000001') loop
    -- a bad window, an item with an unknown key and a bad request key: still the door's answer first
    v_set := v_set || v_who || '='
      || (pg_temp.ta_person(v_who, format($q$select public.brand_plan_for_host(%L, current_date, current_date + 400)::text$q$, v_brand)) = v_words)::text || ','
      || (pg_temp.ta_person(v_who, format($q$select public.brand_plan_host_add(%L, '{"type":"post","title":"T4270 knock","on":"1999-01-01","x":1}'::jsonb, 'bad')::text$q$, v_brand)) = v_words)::text || ' ';
  end loop;
  perform pg_temp.ta_check('T-DOOR', 'outsider, invited, removed, deleted brand, missing brand and another brand''s owner: the same not_found, before any other check',
    btrim(v_set), 'outsider=true,true pending=true,true removed=true,true ghost=true,true ola=true,true bob=true,true');
  perform pg_temp.ta_check('T-DOOR', 'nothing was written', pg_temp.ta_rows(), '9/6/0');
end;
$door$;

-- ---------------------------------------------------------------------------
-- T-RANK
-- ---------------------------------------------------------------------------
do $rank$
declare v jsonb; v_t text;
begin
  v := pg_temp.ta_j(pg_temp.ta_person('scan', $q$select public.brand_plan_for_host('42740000-0000-4000-b0a0-000000000001', current_date - 7, current_date + 60)::text$q$));
  perform pg_temp.ta_check('T-RANK', 'a scanner reads the plan and is told it cannot add', (v->>'can_add') || '/' || (jsonb_array_length(v->'items') > 0)::text, 'false/true');
  v_t := pg_temp.ta_person('scan', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 scanner post","on":"%s"}'::jsonb, 'scan-key-0001')::text$q$, pg_temp.ta_day(3)));
  perform pg_temp.ta_like('T-RANK', 'a scanner cannot add (42501 read_only)', v_t, 'ERR:42501:read_only:%');
  v_t := pg_temp.ta_person('venue', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 venue post","on":"%s"}'::jsonb, 'venue-key-0001')::text$q$, pg_temp.ta_day(3)));
  perform pg_temp.ta_like('T-RANK', 'venue staff never write', v_t, 'ERR:%');
  v := pg_temp.ta_j(pg_temp.ta_person('fin', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 Finance post","on":"%s"}'::jsonb, 'fin-key-00001')::text$q$, pg_temp.ta_day(3))));
  perform pg_temp.ta_check('T-RANK', 'a finance manager (above marketing manager) adds', v->>'status', 'added');
  perform pg_temp.ta_check('T-RANK', 'only the finance post was written', pg_temp.ta_rows(), '10/6/1');

  -- Ife added her own post (P9). Demoted to scanner, she cannot change or remove it.
  update public.brand_team_members set role = 'scanner' where user_id = '42740000-0000-4000-a0a1-000000000002';
  v_t := pg_temp.ta_person('ife', $q$select public.brand_plan_host_update('post', '42740000-0000-4000-d0a0-000000000009', '{"title":"T4270 Ife demoted edit"}'::jsonb, 1)::text$q$)
    || ' ' || pg_temp.ta_person('ife', $q$select public.brand_plan_host_remove('post', '42740000-0000-4000-d0a0-000000000009', 1)::text$q$);
  perform pg_temp.ta_like('T-RANK', 'a host demoted to scanner cannot change or remove their own item', v_t, 'ERR:42501:read_only:% ERR:42501:read_only:%');
  perform pg_temp.ta_check('T-RANK', 'the item is unchanged',
    (select title || '/' || revision || '/' || (deleted_at is null)::text from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000009'), 'T4270 Ife own post/1/true');
  update public.brand_team_members set role = 'marketing_manager' where user_id = '42740000-0000-4000-a0a1-000000000002';
end;
$rank$;

-- ---------------------------------------------------------------------------
-- T-FORGE
-- ---------------------------------------------------------------------------
do $forge$
declare v_words text := 'ERR:P0002:not_found: This item is not on your plan.'; v_t text := ''; v_k text; v_kind text; v_id text; v_rows text;
begin
  -- Ola adds her own post, then staff move it to brand B.
  perform pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 Ola moved post","on":"%s"}'::jsonb, 'ola-key-moved1')::text$q$, pg_temp.ta_day(4)));
  update public.content_calendar_items set brand_id = '42740000-0000-4000-b0a0-000000000002' where title like 'T4270 Ola moved post · %';
  v_rows := pg_temp.ta_rows();
  for v_k, v_kind, v_id in values
    ('staff post', 'post', '42740000-0000-4000-d0a0-000000000001'),
    ('another host''s post', 'post', '42740000-0000-4000-d0a0-000000000009'),
    ('brand B host''s post', 'post', '42740000-0000-4000-d0a0-000000000008'),
    ('own post moved to brand B', 'post', (select id::text from public.content_calendar_items where title like 'T4270 Ola moved post · %')),
    ('a staff task', 'task', (select id::text from ta_ids where k = 'K1')),
    ('a post id sent as a task', 'task', '42740000-0000-4000-d0a0-000000000009'),
    ('an unknown kind', 'event', '42740000-0000-4000-f0a0-000000000001'),
    ('a random id', 'post', '42740000-0000-4000-d0a0-0000000000ff') loop
    v_t := v_t || v_k || '='
      || (pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update(%L, %L, '{"title":"T4270 hijack"}'::jsonb, 1)::text$q$, v_kind, v_id)) = v_words)::text || ','
      || (pg_temp.ta_person('ola', format($q$select public.brand_plan_host_remove(%L, %L, 1)::text$q$, v_kind, v_id)) = v_words)::text || '; ';
  end loop;
  perform pg_temp.ta_check('T-FORGE', 'every forged id gets the same not_found for update and remove', v_t,
    'staff post=true,true; another host''s post=true,true; brand B host''s post=true,true; own post moved to brand B=true,true; a staff task=true,true; a post id sent as a task=true,true; an unknown kind=true,true; a random id=true,true; ');
  perform pg_temp.ta_check('T-FORGE', 'nothing changed', pg_temp.ta_rows() || '/' || (select count(*) from public.content_calendar_items where title like '%hijack%'), v_rows || '/0');

  -- The removed member's own post is gone from them too.
  insert into public.content_calendar_items (id, title, owner_emails, publish_at, brand_id, brand_plan_author_id, brand_plan_source, created_by, updated_by)
  values ('42740000-0000-4000-d0a0-00000000000a', 'T4270 Removed own post', ARRAY[]::text[], (pg_temp.ta_day(6)::timestamp + time '12:00') AT TIME ZONE 'UTC',
          '42740000-0000-4000-b0a0-000000000001', '42740000-0000-4000-a0a1-000000000007', 'host_app', 'removed.t4270@test.local', 'removed.t4270@test.local');
  perform pg_temp.ta_check('T-FORGE', 'a removed member cannot change their old post',
    pg_temp.ta_person('removed', $q$select public.brand_plan_host_update('post', '42740000-0000-4000-d0a0-00000000000a', '{"title":"T4270 still mine"}'::jsonb, 1)::text$q$), v_words);
end;
$forge$;

-- ---------------------------------------------------------------------------
-- T-LEAK, T-STAFF
-- ---------------------------------------------------------------------------
do $leak$
declare v jsonb; v_text text; v_post jsonb; v_posted jsonb; v_task jsonb; v_event jsonb;
begin
  v := pg_temp.ta_j(pg_temp.ta_person('scan', format($q$select public.brand_plan_for_host('42740000-0000-4000-b0a0-000000000001', %L, %L)::text$q$, pg_temp.ta_day(-7), pg_temp.ta_day(60))));
  v_text := v::text;
  perform pg_temp.ta_check('T-LEAK', 'exactly the brand''s dated posts, its flagged cards (done too), its events incl. private and hidden; never a promised event',
    (select string_agg((i->>'kind') || ':' || replace(i->>'title', 'T4270 ', ''), ',' order by i->>'kind', i->>'title') from jsonb_array_elements(v->'items') i),
    'event:Hidden Tasting,event:Open Night,event:Private Dinner,experience:Pottery Week,post:Chef reel,post:Finance post,post:Ife own post,post:Launch post,post:Menu teaser,post:Removed own post,task:Finished task,task:Print the menus');
  perform pg_temp.ta_check('T-LEAK', 'no address, staff name, Drive link, copy, note, instructions, done means, proof or Live link of an unposted post anywhere',
    concat_ws(',', (v_text like '%@%')::text, (v_text like '%SECRET%')::text, (v_text like '%drive.google%')::text, (v_text like '%Gia%')::text,
      (v_text like '%Kunle%')::text, (v_text like '%Okafor%')::text, (v_text like '%instagram.com/SECRET%')::text), 'false,false,false,false,false,false,false');
  select i into v_post from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Menu teaser';
  select i into v_posted from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Launch post';
  select i into v_task from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Print the menus';
  select i into v_event from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Pottery Week';
  perform pg_temp.ta_check('T-LEAK', 'the post''s keys are exactly the contract''s',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_post) k), 'at,by,can_edit,id,kind,link,live_url,mine,on,revision,state,state_words,title');
  perform pg_temp.ta_check('T-LEAK', 'the task''s keys are exactly the contract''s',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_task) k), 'at,by,can_edit,id,kind,link,mine,on,revision,state,state_words,title');
  perform pg_temp.ta_check('T-LEAK', 'an Idea: the plan link, no time, no live link; Posted: the time and the live link',
    concat_ws(' | ', v_post #>> '{link,url}', coalesce(v_post->>'at', '-'), coalesce(v_post->>'live_url', '-'), v_post->>'state_words',
      v_posted->>'state_words', (v_posted->>'at' is not null)::text, v_posted->>'live_url'),
    'https://www.canva.com/t4270-plan | - | - | Planned | Posted | true | https://instagram.com/p/t4270-live');
  perform pg_temp.ta_check('T-LEAK', 'In review is In review; the running experience is Live now; the task link is its Files link',
    (select i->>'state_words' from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Chef reel') || ' | ' || (v_event->>'state_words') || ' | ' || (v_task #>> '{link,url}'),
    'In review | Live now | https://dropbox.com/t4270-files');
  perform pg_temp.ta_check('T-LEAK', 'brand B''s plan has none of brand A''s items',
    (select string_agg(replace(i->>'title', 'T4270 ', ''), ',' order by i->>'title')
       from jsonb_array_elements(pg_temp.ta_j(pg_temp.ta_person('bob', format($q$select public.brand_plan_for_host('42740000-0000-4000-b0a0-000000000002', %L, %L)::text$q$, pg_temp.ta_day(-7), pg_temp.ta_day(60))))->'items') i),
    'Bob own post,Cedar Party,Cedar promo,Cedar task,Ola moved post · Basil House');

  v := pg_temp.ta_j(pg_temp.ta_person('gia', format($q$select public.ops_brand_plan('42740000-0000-4000-c0a0-000000000002', %L, %L)::text$q$, pg_temp.ta_day(-7), pg_temp.ta_day(60))));
  perform pg_temp.ta_check('T-STAFF', 'the staff plan (from the second host record): private and hidden events off, the promised event as Promised, the Drive link apart',
    concat_ws(' | ',
      (select string_agg(replace(i->>'title', 'T4270 ', ''), ',' order by i->>'title') from jsonb_array_elements(v->'items') i where i->>'kind' in ('event','experience','promised')),
      (select i->>'state_words' from jsonb_array_elements(v->'items') i where i->>'kind' = 'promised'),
      (select (i->>'drive_url') || ' ' || (i #>> '{link,url}') from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Menu teaser')),
    'Open Night,Pottery Week,Promised Brunch | Promised | https://drive.google.com/SECRET-DRIVE-T4270 https://www.canva.com/t4270-plan');
end;
$leak$;

-- ---------------------------------------------------------------------------
-- T-READ
-- ---------------------------------------------------------------------------
do $read$
declare v jsonb; v_rev bigint; v_rows bigint;
begin
  select revision into v_rev from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000001';
  select count(*) into v_rows from public.content_calendar_items;
  perform pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000001', jsonb_build_object('publish_at', %L), %s, null)::text$q$,
    (pg_temp.ta_day(20)::timestamp + time '18:00') AT TIME ZONE 'UTC', v_rev));
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_for_host('42740000-0000-4000-b0a0-000000000001', %L, %L)::text$q$, pg_temp.ta_day(-7), pg_temp.ta_day(60))));
  perform pg_temp.ta_check('T-READ', 'a staff date move shows on the host plan at once, same id, no new row',
    (select (i->>'id') || ' ' || (i->>'on') from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Menu teaser') || ' ' || ((select count(*) from public.content_calendar_items) - v_rows)::text,
    '42740000-0000-4000-d0a0-000000000001 ' || pg_temp.ta_day(20) || ' 0');
  update public.ops_work_cards set on_brand_plan = false where id = pg_temp.ta_id('K1');
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_for_host('42740000-0000-4000-b0a0-000000000001', %L, %L)::text$q$, pg_temp.ta_day(-7), pg_temp.ta_day(60))));
  perform pg_temp.ta_check('T-READ', 'switching Host can see this off takes the card off the host plan at once',
    (select count(*) from jsonb_array_elements(v->'items') i where i->>'title' = 'T4270 Print the menus')::text, '0');
  update public.ops_work_cards set on_brand_plan = true where id = pg_temp.ta_id('K1');
end;
$read$;

-- ---------------------------------------------------------------------------
-- T-CLASH, T-NOON, T-OWN, T-TEXT
-- ---------------------------------------------------------------------------
do $add$
declare v jsonb; v_t text; v_long text := 'T4270 ' || repeat('x', 152); v_id uuid;
begin
  -- "T4270 Cedar promo" is brand B's post: brand A's host gets the suffix.
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"  t4270   CEDAR promo ","on":"%s"}'::jsonb, 'ola-key-clash1')::text$q$, pg_temp.ta_day(7))));
  perform pg_temp.ta_check('T-CLASH', 'a host item is always stored with " · {brand}", so a clash with another brand''s post tells the host nothing',
    (v #>> '{item,title}') || ' / ' || (v->>'title_changed') || ' / ' || (select title from public.content_calendar_items where id = (v #>> '{item,id}')::uuid),
    't4270 CEDAR promo / false / t4270 CEDAR promo · T4270 Basil House');
  v_t := pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 Cedar promo","on":"%s"}'::jsonb, 'ola-key-clash2')::text$q$, pg_temp.ta_day(7)));
  perform pg_temp.ta_check('T-CLASH', 'a clash that remains after the suffix asks to change the name (23505)', v_t,
    'ERR:23505:duplicate_title: Something with this name is already planned. Change the name a little.');
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"task","title":"T4270 Finished task","on":"%s"}'::jsonb, 'ola-key-clash3')::text$q$, pg_temp.ta_day(7))));
  perform pg_temp.ta_check('T-CLASH', 'a done card''s title is free for a new task', (v #>> '{item,title}') || '/' || (v->>'title_changed'), 'T4270 Finished task/false');
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"task","title":"T4270 Cedar task","on":"%s"}'::jsonb, 'ola-key-clash4')::text$q$, pg_temp.ta_day(7))));
  perform pg_temp.ta_check('T-CLASH', 'an open card of another brand: the task is stored with the suffix and shown without',
    (v #>> '{item,title}') || ' / ' || (select title from public.ops_work_cards where id = (v #>> '{item,id}')::uuid), 'T4270 Cedar task / T4270 Cedar task · T4270 Basil House');
  insert into public.content_calendar_items (title, owner_emails, created_by, updated_by) values (v_long, ARRAY[]::text[], 'gia.t4270@test.local', 'gia.t4270@test.local');
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', jsonb_build_object('type','post','title',%L,'on',%L), 'ola-key-clash5')::text$q$, v_long, pg_temp.ta_day(7))));
  perform pg_temp.ta_check('T-CLASH', 'a 158-character title keeps the suffix and stays within 160; the host is told it was shortened',
    (select char_length(title)::text || '/' || (title like '% · T4270 Basil House')::text from public.content_calendar_items where id = (v #>> '{item,id}')::uuid) || '/' || (v->>'title_changed'), '160/true/true');

  -- D17 noon UTC, D6 owners and D21 watchers, C-6 text.
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 Noon post","on":"%s"}'::jsonb, 'ola-key-noon01')::text$q$, pg_temp.ta_day(9))));
  perform pg_temp.ta_check('T-NOON', 'a host post is at 12:00 UTC on its date, owned by the oldest host record''s owners',
    (select to_char(publish_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' ' || array_to_string(owner_emails, ',') || ' ' || coalesce(drive_url, 'no-drive')
       from public.content_calendar_items where id = (v #>> '{item,id}')::uuid),
    to_char(pg_temp.ta_day(9), 'YYYY-MM-DD') || ' 12:00 gia.t4270@test.local no-drive');
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"task","title":"T4270 Bring the banners","on":"%s","note":"Two banners please"}'::jsonb, 'ola-key-task01')::text$q$, pg_temp.ta_day(9))));
  v_id := (v #>> '{item,id}')::uuid;
  perform pg_temp.ta_check('T-OWN', 'owners: the oldest record''s; watchers: the second record''s other owner, not the deleted record''s, nobody twice',
    (select string_agg(p.role || ':' || split_part(p.email, '.', 1), ',' order by p.role, p.email) from public.ops_work_people p where p.card_id = v_id),
    'owner:gia,watcher:kunle');
  perform pg_temp.ta_check('T-TEXT', 'the server writes instructions and done means; the note goes in instructions; Host can see this is on',
    (select instructions || ' | ' || done_means || ' | ' || on_brand_plan || ' | ' || brand_plan_source || ' | ' || status from public.ops_work_cards where id = v_id),
    'Added by Ola Host from the Brand group plan. Note: Two banners please | Done and the host is told in the Brand group. | true | host_app | todo');
  v_t := pg_temp.ta_person('nora', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000004', '{"type":"task","title":"T4270 New brand task","on":"%s"}'::jsonb, 'nora-key-0001')::text$q$, pg_temp.ta_day(3)));
  perform pg_temp.ta_like('T-OWN', 'a brand with no host record cannot add a task', v_t, 'ERR:22023:no_host_card:%');
  v := pg_temp.ta_j(pg_temp.ta_person('nora', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000004', '{"type":"post","title":"T4270 New brand post","on":"%s"}'::jsonb, 'nora-key-0002')::text$q$, pg_temp.ta_day(3))));
  perform pg_temp.ta_check('T-OWN', 'but can add a post, with no owners', (v->>'status') || '/' || (select cardinality(owner_emails) from public.content_calendar_items where title like 'T4270 New brand post · %'), 'added/0');
end;
$add$;

-- ---------------------------------------------------------------------------
-- T-LINK
-- ---------------------------------------------------------------------------
do $link$
declare v_bad jsonb; v_out text := ''; v jsonb; v_id uuid; v_rev bigint; v_card uuid; v_crev bigint;
begin
  select id, revision into v_id, v_rev from public.content_calendar_items where title like 'T4270 Noon post · %';
  select id, revision into v_card, v_crev from public.ops_work_cards where title like 'T4270 Bring the banners · %';
  for v_bad in select x from (values ('"http://example.com/a"'::jsonb), ('"javascript:alert(1)"'::jsonb), ('"https://"'::jsonb), ('"https://a b.com"'::jsonb),
      (to_jsonb('https://' || repeat('a', 1993))), ('5'::jsonb), ('"HTTPS://EXAMPLE.COM"'::jsonb)) t(x) loop
    v_out := v_out
      || left(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', jsonb_build_object('type','post','title','T4270 Link try','on',%L,'link',%L::jsonb), null)::text$q$, pg_temp.ta_day(5), v_bad)), 22) || ','
      || left(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update('post', %L, jsonb_build_object('link', %L::jsonb), %s)::text$q$, v_id, v_bad, v_rev)), 22) || ','
      || left(pg_temp.ta_person('gia', format($q$select public.ops_brand_plan_set_link('task', %L, %L, %s)::text$q$, v_card, v_bad #>> '{}', v_crev)), 22) || ','
      || left(pg_temp.ta_person('gia', format($q$select public.content_calendar_update(%L, jsonb_build_object('plan_link_url', %L::jsonb), %s, null)::text$q$, v_id, v_bad, v_rev)), 22) || ' ';
  end loop;
  perform pg_temp.ta_check('T-LINK', 'http, javascript:, https:// alone, a space, 2,001 characters, a number and upper case: refused by host add, host update, staff set_link and the Calendar',
    btrim(v_out), btrim(repeat('ERR:22023:invalid_link,ERR:22023:invalid_link,ERR:22023:invalid_link,ERR:22023:invalid_link ', 7)));
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update('post', %L, '{"link":"  https://www.canva.com/t4270-noon  "}'::jsonb, %s)::text$q$, v_id, v_rev)));
  perform pg_temp.ta_check('T-LINK', 'a padded https link is trimmed and is the plan link; the Drive link is untouched (D13)',
    (v #>> '{item,link,url}') || ' ' || (v #>> '{item,link,site}') || ' ' || (select coalesce(drive_url, 'no-drive') from public.content_calendar_items where id = v_id),
    'https://www.canva.com/t4270-noon canva.com no-drive');
  perform pg_temp.ta_person('gia', format($q$select public.ops_brand_plan_set_link('post', '42740000-0000-4000-d0a0-000000000001', 'https://www.figma.com/t4270', %s)::text$q$,
    (select revision from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000001')));
  perform pg_temp.ta_check('T-LINK', 'staff changing a post''s plan link leave its Drive link alone',
    (select plan_link_url || ' ' || drive_url from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000001'),
    'https://www.figma.com/t4270 https://drive.google.com/SECRET-DRIVE-T4270');
end;
$link$;

-- ---------------------------------------------------------------------------
-- T-LINE, T-409
-- ---------------------------------------------------------------------------
do $line$
declare v jsonb; v_id uuid; v_rev bigint; v_n0 integer; v_n integer; v_b0 integer; v_t text; v_lines text; v_unread bigint;
begin
  delete from public.messages where conversation_id in ('42740000-0000-4000-e0a0-000000000001', '42740000-0000-4000-e0a0-000000000002');
  v_b0 := pg_temp.ta_line_n('42740000-0000-4000-e0a0-000000000002');
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 Line post","on":"%s"}'::jsonb, 'ola-key-line01')::text$q$, pg_temp.ta_day(10))));
  v_id := (v #>> '{item,id}')::uuid; v_rev := (v #>> '{item,revision}')::bigint;
  perform pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update('post', %L, jsonb_build_object('on', %L), %s)::text$q$, v_id, pg_temp.ta_day(11), v_rev));
  perform pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update('post', %L, '{"link":"https://dropbox.com/t4270-secret-path"}'::jsonb, %s)::text$q$, v_id, v_rev + 1));
  perform pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update('post', %L, '{"link":null}'::jsonb, %s)::text$q$, v_id, v_rev + 2));
  perform pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update('post', %L, '{"note":"just a note"}'::jsonb, %s)::text$q$, v_id, v_rev + 3));
  v_lines := pg_temp.ta_lines('42740000-0000-4000-e0a0-000000000001');
  perform pg_temp.ta_check('T-LINE', 'host: one line each for add, date move, link added and link removed; none for a note',
    v_lines, (select string_agg(x, ' | ' order by x) from unnest(ARRAY[
      format('Ola Host added “T4270 Line post” to the plan for %s.', public.brand_plan_day_words(pg_temp.ta_day(10))),
      format('Ola Host moved “T4270 Line post” to %s.', public.brand_plan_day_words(pg_temp.ta_day(11))),
      'Ola Host added a link to “T4270 Line post”.', 'Ola Host removed the link from “T4270 Line post”.']) x));
  perform pg_temp.ta_check('T-LINE', 'the link''s address never goes into the chat', (v_lines like '%dropbox%')::text, 'false');

  v_n0 := pg_temp.ta_line_n('42740000-0000-4000-e0a0-000000000001');
  create temp table ta_seen on commit drop as select id from public.messages where conversation_id = '42740000-0000-4000-e0a0-000000000001';
  select revision into v_rev from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000002';
  perform pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000002', '{"notes":"only notes"}'::jsonb, %s, null)::text$q$, v_rev));
  perform pg_temp.ta_check('T-LINE', 'a staff notes-only edit posts no line', (pg_temp.ta_line_n('42740000-0000-4000-e0a0-000000000001') - v_n0)::text, '0');
  perform pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000002', jsonb_build_object('publish_at', %L), %s, null)::text$q$,
    (pg_temp.ta_day(12)::timestamp + time '10:00') AT TIME ZONE 'UTC', v_rev + 1));
  perform pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000002', '{"title":"T4270 Chef reel two"}'::jsonb, %s, null)::text$q$, v_rev + 2));
  -- the time of day moves, the day does not: no line
  perform pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000002', jsonb_build_object('publish_at', %L), %s, null)::text$q$,
    (pg_temp.ta_day(12)::timestamp + time '16:00') AT TIME ZONE 'UTC', v_rev + 3));
  v_t := (select string_agg(m.content, ' | ' order by m.content) from public.messages m
            where m.conversation_id = '42740000-0000-4000-e0a0-000000000001' and m.id not in (select id from ta_seen));
  perform pg_temp.ta_check('T-LINE', 'staff Calendar edits of date and title post one line each, by first name only (D19)', v_t,
    format('Gia moved “T4270 Chef reel” to %s. | Gia renamed “T4270 Chef reel” to “T4270 Chef reel two”.', public.brand_plan_day_words(pg_temp.ta_day(12))));
  perform pg_temp.ta_check('T-LINE', 'no staff surname or address in any line', (pg_temp.ta_lines('42740000-0000-4000-e0a0-000000000001') ~ '(Okafor|Ade|@)')::text, 'false');
  perform pg_temp.ta_check('T-LINE', 'every line: no sender, type system, sender kind system; none in brand B''s group',
    (select count(*) filter (where sender_id is null and message_type = 'system' and sender_kind = 'system' and sender_display_name_snapshot = 'Plan') || '/' || count(*)
       from public.messages where conversation_id = '42740000-0000-4000-e0a0-000000000001') || ' ' || (pg_temp.ta_line_n('42740000-0000-4000-e0a0-000000000002') - v_b0)::text,
    '6/6 0');
  insert into public.brand_group_reads (conversation_id, user_id, last_read_at)
  values ('42740000-0000-4000-e0a0-000000000001', '42740000-0000-4000-a0a1-000000000004', now() - interval '1 minute')
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  v_t := pg_temp.ta_person('scan', $q$select unread_count::text from public.issue_3720_list_brand_groups() where conversation_id = '42740000-0000-4000-e0a0-000000000001'$q$);
  perform pg_temp.ta_check('T-LINE', 'the lines count as unread in the brand''s group list (D23)', v_t, '6');

  v_t := pg_temp.ta_person('ola', format($q$select public.brand_plan_host_update('post', %L, '{"title":"T4270 Stale"}'::jsonb, %s)::text$q$, v_id, v_rev))
    || ' ' || pg_temp.ta_person('ola', format($q$select public.brand_plan_host_remove('post', %L, %s)::text$q$, v_id, v_rev));
  perform pg_temp.ta_check('T-409', 'an old revision is PT409 for update and remove', v_t,
    'ERR:PT409:stale_write: This changed. Showing the latest. ERR:PT409:stale_write: This changed. Showing the latest.');
end;
$line$;

-- ---------------------------------------------------------------------------
-- T-KEY, T-DEV
-- ---------------------------------------------------------------------------
do $dev$
declare v jsonb; v_t text; v_rows text; v_sprint uuid; v_card uuid;
begin
  v_rows := pg_temp.ta_rows();
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 Noon post","on":"%s"}'::jsonb, 'ola-key-noon01')::text$q$, pg_temp.ta_day(9))));
  perform pg_temp.ta_check('T-KEY', 'a replayed key returns the first answer and writes nothing', (v->>'status') || '/' || (pg_temp.ta_rows() = v_rows)::text, 'added/true');
  v_t := pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4270 Other noon","on":"%s"}'::jsonb, 'ola-key-noon01')::text$q$, pg_temp.ta_day(9)));
  perform pg_temp.ta_like('T-KEY', 'the same key with another item is refused', v_t, 'ERR:22023:request_key_reused:%');

  v_t := pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"task","title":"ab","on":"%s"}'::jsonb, null)::text$q$, pg_temp.ta_day(3)))
    || ' / ' || (pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"post","title":"T4","on":"%s"}'::jsonb, null)::text$q$, pg_temp.ta_day(3))))->>'status');
  perform pg_temp.ta_check('T-DEV', 'a 2-character task is refused; a 2-character post is added', v_t, 'ERR:22023:invalid_title: Say what it is in 3 to 160 characters. / added');
  v := pg_temp.ta_j(pg_temp.ta_person('ola', format($q$select public.brand_plan_host_add('42740000-0000-4000-b0a0-000000000001', '{"type":"task","title":"T4270 Far task","on":"%s"}'::jsonb, null)::text$q$, pg_temp.ta_day(200))));
  perform pg_temp.ta_check('T-DEV', 'a task far ahead goes in today''s sprint',
    (select (w.sprint_id = public.ops_sprint_for(pg_temp.ta_day(0), pg_temp.ta_day(0)))::text || '/' || w.due_on from public.ops_work_cards w where w.id = (v #>> '{item,id}')::uuid),
    'true/' || pg_temp.ta_day(200));
  v_t := pg_temp.ta_agent('gia', format($q$select public.ops_brand_plan_set_link('task', %L, 'https://x.com/t4270', 1)::text$q$, pg_temp.ta_id('K1')));
  perform pg_temp.ta_like('T-DEV', 'an agent cannot set a plan link', v_t, 'ERR:42501:people_only:%');
  v_t := pg_temp.ta_person('gia', $q$select public.ops_brand_plan_set_link('task', '42740000-0000-4000-f0a0-000000000001', 'https://x.com/t4270', 1)::text$q$)
    || ' / ' || pg_temp.ta_person('gia', format($q$select public.ops_brand_plan_set_link('task', %L, 'https://x.com/t4270', 1)::text$q$, pg_temp.ta_id('K2')))
    || ' / ' || pg_temp.ta_person('gia', format($q$select public.ops_brand_plan_set_link('event', %L, 'https://x.com/t4270', 1)::text$q$, '42740000-0000-4000-f0a0-000000000001'));
  perform pg_temp.ta_check('T-DEV', 'set_link: an event id, a card the host does not see, and the event kind are refused', v_t,
    'ERR:P0002:not_found: That item is no longer on the plan. / ERR:P0002:not_found: That item is no longer on the plan. / ERR:22023:invalid_kind: A plan link goes on a post or a task.');
  v_t := pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000006', '{"collaborator_record_id":"42740000-0000-4000-c0a0-00000000000a"}'::jsonb, %s, null)::text$q$,
           (select revision from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000006')))
    || ' / ' || pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000006', '{"collaborator_record_id":"42740000-0000-4000-c0a0-000000000001"}'::jsonb, %s, null)::text$q$,
           (select revision from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000006')));
  perform pg_temp.ta_like('T-DEV', 'the collaborator must be a live Creators record (a deleted creator and a host record are refused)', v_t,
    'ERR:22023:invalid_collaborator:% / ERR:22023:invalid_collaborator:%');
  v := pg_temp.ta_j(pg_temp.ta_person('gia', format($q$select public.content_calendar_update('42740000-0000-4000-d0a0-000000000006', '{"collaborator_record_id":"42740000-0000-4000-c0a0-000000000009"}'::jsonb, %s, null)::text$q$,
           (select revision from public.content_calendar_items where id = '42740000-0000-4000-d0a0-000000000006'))));
  update public.crm_records set deleted_at = now(), deleted_by = 't-fixture' where id = '42740000-0000-4000-c0a0-000000000009';
  perform pg_temp.ta_check('T-DEV', 'a creator deleted later reads as no collaborator',
    (v #>> '{item,collaborator,name}') || ' / ' || coalesce((select public.content_calendar_item_json(i)->>'collaborator' from public.content_calendar_items i where i.id = '42740000-0000-4000-d0a0-000000000006'), 'null'),
    'T4270 Creator Live / null');
end;
$dev$;

-- ---------------------------------------------------------------------------
-- T-W2R: the Wave 2 rework, from other angles (P1-1, P3-1, P3-3, P3-4, P3-5).
-- ---------------------------------------------------------------------------
do $w2r$
declare v jsonb; v_t text; v_rev bigint; v_ev uuid; v_tz text; v_ok text := '';
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text) values
    ('42740000-0000-4000-f0a0-000000000008', '42740000-0000-4000-b0a0-000000000001', 'T4270 Just Ended', 't4270-ended', 'discover', 'scheduled', 'UTC', now() - interval '9 days', 'event', 'T4270 Street');
  insert into public.event_dates (event_id, start_at, end_at, is_master) values
    ('42740000-0000-4000-f0a0-000000000008', now() - interval '1 day', now() - interval '1 hour', true);
  set local session_replication_role = origin;
  v := pg_temp.ta_j(pg_temp.ta_person('gia', $q$select public.ops_host_on_mingla('42740000-0000-4000-c0a0-000000000001', null, 'UTC')::text$q$));
  perform pg_temp.ta_check('T-W2R', 'P1-1: the running experience is listed once, Live now, and not under Past; the event that ended an hour ago is not live',
    concat_ws(' | ',
      (select count(*) || ':' || string_agg(e #>> '{state,name}', ',') from jsonb_array_elements(v->'events') e where e->>'title' = 'T4270 Pottery Week'),
      (select count(*)::text from jsonb_array_elements(v->'past') e where e->>'title' = 'T4270 Pottery Week'),
      (select string_agg((e->>'live') || ':' || coalesce(e #>> '{state,name}', '-'), ',') from jsonb_array_elements(v->'events') e where e->>'title' = 'T4270 Just Ended'),
      (select count(*)::text from jsonb_array_elements(v->'past') e where e->>'title' = 'T4270 Just Ended')),
    '1:Live now | 0 | false:' || (select coalesce(e #>> '{state,name}', '-') from jsonb_array_elements(v->'events') e where e->>'title' = 'T4270 Just Ended') || ' | 1');
  perform pg_temp.ta_check('T-W2R', 'P1-1: nothing in the read says Live now and Happened for one item',
    (select count(*)::text from jsonb_array_elements(v->'events') e where e #>> '{state,name}' = 'Live now' and e->>'title' in (select x->>'title' from jsonb_array_elements(v->'past') x)), '0');

  -- P3-1: a zone that is not a zone counts as UTC (the Monday 00:00 UTC).
  for v_tz in values (''), ('Mars/Olympus'), (repeat('A', 65)), ('UTC''; select 1; --') loop
    v := pg_temp.ta_j(pg_temp.ta_person('gia', format($q$select public.ops_host_on_mingla('42740000-0000-4000-c0a0-000000000001', null, %L)::text$q$, v_tz)));
    v_ok := v_ok || ((v->>'done_since')::timestamptz = (public.ops_monday(public.ops_today(null))::timestamp AT TIME ZONE 'UTC'))::text || ',';
  end loop;
  v := pg_temp.ta_j(pg_temp.ta_person('gia', $q$select public.ops_host_on_mingla('42740000-0000-4000-c0a0-000000000001', null, 'Pacific/Kiritimati')::text$q$));
  perform pg_temp.ta_check('T-W2R', 'P3-1: empty, unknown, over-long and injected zones read as UTC; Kiritimati''s Monday starts 14 hours earlier',
    v_ok || ((v->>'done_since')::timestamptz = (public.ops_monday(public.ops_today(null))::timestamp AT TIME ZONE 'Pacific/Kiritimati'))::text, 'true,true,true,true,true');

  -- P3-4: addresses that start with + . - and a display name that is an address.
  insert into public.crm_record_owners (record_id, owner_email, added_by) values
    ('42740000-0000-4000-c0a0-000000000001', '+plus.t4270@test.local', 't-fixture'),
    ('42740000-0000-4000-c0a0-000000000001', '.dot.t4270@test.local', 't-fixture'),
    ('42740000-0000-4000-c0a0-000000000001', 'named.t4270@test.local', 't-fixture');
  insert into public.ops_team_profiles (email, display_name, updated_by) values ('named.t4270@test.local', 'named.t4270@test.local', 'system@usemingla.com')
    on conflict (email) do update set display_name = excluded.display_name;
  update public.profiles set display_name = 'scan.t4270@test.local' where id = '42740000-0000-4000-a0a1-000000000004';
  v := pg_temp.ta_j(pg_temp.ta_person('gia', $q$select public.ops_host_on_mingla('42740000-0000-4000-c0a0-000000000001', null, 'UTC')::text$q$));
  perform pg_temp.ta_check('T-W2R', 'P3-4: no address anywhere in the host card read, owners and brand team included',
    (v::text ~ '@')::text || '/' || (select count(*) from jsonb_array_elements(v #> '{team,owners}') o where o->>'name' = 'A teammate')::text, 'false/3');
  v := pg_temp.ta_j(pg_temp.ta_person('gia', $q$select public.ops_brand_host_record('42740000-0000-4000-b0a0-000000000001')::text$q$));
  perform pg_temp.ta_check('T-W2R', 'P3-4: nor in the Brand group''s host record', (v::text ~ '@')::text, 'false');
  update public.profiles set display_name = 'Scan Host' where id = '42740000-0000-4000-a0a1-000000000004';
  delete from public.crm_record_owners where owner_email in ('+plus.t4270@test.local', '.dot.t4270@test.local', 'named.t4270@test.local');

  -- P3-5: an Undo of a title change and the flag together puts both back; an agent cannot undo.
  select revision into v_rev from public.ops_work_cards where id = pg_temp.ta_id('K2');
  v := pg_temp.ta_j(pg_temp.ta_person('gia', format($q$select public.ops_work_update(%L, '{"on_brand_plan":true,"title":"T4270 Chase the invoice now"}'::jsonb, %s)::text$q$, pg_temp.ta_id('K2'), v_rev)));
  v_ev := (v->>'event_id')::uuid;
  v_t := pg_temp.ta_agent('gia', format($q$select public.ops_work_undo(%L)::text$q$, v_ev));
  perform pg_temp.ta_like('T-W2R', 'P3-5: an agent cannot undo a person''s switch', v_t, 'ERR:42501:%');
  perform pg_temp.ta_person('gia', format($q$select public.ops_work_undo(%L)::text$q$, v_ev));
  perform pg_temp.ta_check('T-W2R', 'P3-5: Undo puts the title and Host can see this back together',
    (select title || '/' || on_brand_plan from public.ops_work_cards where id = pg_temp.ta_id('K2')), 'T4270 Chase the invoice/false');

  -- P3-3: no live function says to add a new promised date.
  perform pg_temp.ta_check('T-W2R', 'P3-3: no public function tells anyone to add a new promised date',
    coalesce((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prosrc ~* 'add a new one'), 'none'), 'none');
end;
$w2r$;

select count(*) as ta_total, count(*) filter (where not ok) as ta_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as ta_failures
  from ta_results \gset
rollback;

select (:ta_total < 40 or :ta_failed > 0) as ta_bad \gset
\if :ta_bad
  \echo 'ISSUE-4270 W3 TESTER FAILED:' :ta_failed 'of' :ta_total
  \echo :ta_failures
  do $$ begin raise exception 'ISSUE-4270 W3 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W3 TESTER PASS:' :ta_total 'checks, 0 failed'
