-- Issue #4270 (Wave 3 rework + Wave 4) -- tester adversarial suite for what the
-- Host app relies on, on the fully replayed PG17 schema. Angles the implementor
-- and Wave 3 tester suites do not take:
--
--   V-MATRIX  venue staff against every visibility and status of event: only
--             events anyone can open; team members see all but cancelled ones
--   V-DEMOTE  an author demoted to venue staff keeps "mine", loses can_edit,
--             is refused writes, and their view of private events narrows
--   V-DOOR    the staff functions and the internal helpers are shut to a host
--   L-CLASS   link characters by class, through all four doors (host add, host
--             update, staff set_link, the Calendar); what may follow the site
--             name stays allowed
--   S-SHOWN   the stored title always carries the suffix within 160, and a title
--             that cannot fit is refused, never cut; the shown title never
--             carries it; plan lines use the shown title
--   R-LIMIT   12 changes an hour is per person and per brand, is shared by
--             posts and tasks, and a refused change writes nothing
--   F-FLAG    the card flag trigger: no Brand group, done and archived cards,
--             no host link, unrelated edits
--   K-KEYS    the exact keys a host receives for each kind, for every role
--
-- FAILS-ON-REVERT: see w4-test.md. Run from the repository root as
-- supabase_admin. Everything is rolled back.
-- MINGLA-INVARIANT: I-4270-VENUE-STAFF-PUBLIC-EVENTS-ONLY | issue #4270 | a reader below read rank gets only events anyone can open from the host plan

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table v_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into v_people (who, id, email) values
  ('gia',   '42750000-0000-4000-a0a0-000000000001', 'gia.v4270@test.local'),
  ('ola',   '42750000-0000-4000-a0a1-000000000001', 'ola.v4270@test.local'),
  ('ife',   '42750000-0000-4000-a0a1-000000000002', 'ife.v4270@test.local'),
  ('scan',  '42750000-0000-4000-a0a1-000000000003', 'scan.v4270@test.local'),
  ('venue', '42750000-0000-4000-a0a1-000000000004', 'venue.v4270@test.local'),
  ('dem',   '42750000-0000-4000-a0a1-000000000005', 'dem.v4270@test.local'),
  ('bob',   '42750000-0000-4000-a0a1-000000000006', 'bob.v4270@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from v_people;
insert into public.admin_team_members (email, role, status, accepted_at) values ('gia.v4270@test.local', 'growth', 'active', now());
insert into public.ops_team_profiles (email, display_name, updated_by) values ('gia.v4270@test.local', 'Gia Okafor-Ade', 'system@usemingla.com')
  on conflict (email) do update set display_name = excluded.display_name;

create temp table v_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table v_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.v_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from v_people where who = p_who;
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
create function pg_temp.v_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into v_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want, format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;
create function pg_temp.v_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into v_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false), format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
end;
$fn$;
create function pg_temp.v_day(p_n integer) returns date
language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date + p_n $fn$;
create function pg_temp.v_read(p_who text, p_brand text) returns jsonb
language plpgsql as $fn$
begin
  return pg_temp.v_as(p_who, format($q$select public.brand_plan_for_host(%L, %L::date, %L::date)::text$q$, p_brand, pg_temp.v_day(-20), pg_temp.v_day(90)))::jsonb;
end;
$fn$;
create function pg_temp.v_add(p_who text, p_brand text, p_item jsonb, p_key text) returns text
language sql as $fn$
  select pg_temp.v_as(p_who, format($q$select public.brand_plan_host_add(%L, %L::jsonb, %L)::text$q$, p_brand, p_item::text, p_key))
$fn$;
create function pg_temp.v_lines(p_conv text) returns integer
language sql as $fn$ select count(*)::integer from public.messages m where m.conversation_id = p_conv::uuid and m.message_type = 'system' $fn$;

-- Brand A has a Brand group and a host record; brand B likewise; brand N has a
-- host record and no Brand group.
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, created_at, default_timezone) values
  ('42750000-0000-4000-b0a0-000000000001', '42750000-0000-4000-b1a0-000000000001', 'V4270 Basil', 'v4270-basil', 'Lagos', now() - interval '90 days', 'UTC'),
  ('42750000-0000-4000-b0a0-000000000002', '42750000-0000-4000-b1a0-000000000002', 'V4270 Cedar', 'v4270-cedar', 'Lagos', now() - interval '90 days', 'UTC'),
  ('42750000-0000-4000-b0a0-000000000003', '42750000-0000-4000-b1a0-000000000003', 'V4270 Quiet', 'v4270-quiet', 'Lagos', now() - interval '90 days', 'UTC');
insert into public.profiles (id, email, display_name, first_name)
select id, email, initcap(who) || ' Host', initcap(who) from v_people where who <> 'gia'
  on conflict (id) do update set display_name = excluded.display_name, first_name = excluded.first_name;
insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
select '42750000-0000-4000-b0a0-000000000001'::uuid, p.id, r.role, now() - interval '30 days', now() - interval '30 days', null
  from v_people p join (values ('ola','marketing_manager'),('ife','marketing_manager'),('scan','scanner'),('venue','venue_staff'),('dem','marketing_manager')) r(who, role) on r.who = p.who;
insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
select '42750000-0000-4000-b0a0-000000000002'::uuid, p.id, 'marketing_manager', now() - interval '30 days', now() - interval '30 days', null
  from v_people p where p.who in ('ola','bob');
insert into public.conversations (id, type, linked_entity_type, brand_id, name, is_enabled) values
  ('42750000-0000-4000-e0a0-000000000001', 'group', 'brand', '42750000-0000-4000-b0a0-000000000001', 'V4270 Basil · Brand group', true),
  ('42750000-0000-4000-e0a0-000000000002', 'group', 'brand', '42750000-0000-4000-b0a0-000000000002', 'V4270 Cedar · Brand group', true);
create temp table v_ev (title text, vis text, st text) on commit drop;
insert into v_ev values
  ('V4270 discover scheduled', 'discover', 'scheduled'), ('V4270 discover live', 'discover', 'live'),
  ('V4270 discover draft', 'discover', 'draft'), ('V4270 discover cancelled', 'discover', 'cancelled'),
  ('V4270 private scheduled', 'private', 'scheduled'), ('V4270 private draft', 'private', 'draft'),
  ('V4270 hidden scheduled', 'hidden', 'scheduled'), ('V4270 hidden draft', 'hidden', 'draft');
do $$
declare r record; v_id uuid;
begin
  for r in select * from v_ev loop
    v_id := gen_random_uuid();
    insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
    values (v_id, '42750000-0000-4000-b0a0-000000000001', r.title, 'v4270-' || left(v_id::text, 8), r.vis, r.st, 'UTC',
            case when r.st = 'draft' then null else now() - interval '9 days' end, 'event', 'Lekki');
    insert into public.event_dates (event_id, start_at, end_at, is_master)
    values (v_id, date_trunc('day', now()) + interval '5 days 18 hours', date_trunc('day', now()) + interval '5 days 22 hours', true);
  end loop;
end $$;
set local session_replication_role = origin;
insert into public.crm_records (id, pipeline, name, stage, brand_id, icp, created_by, updated_by) values
  ('42750000-0000-4000-c0a0-000000000001', 'hosts', 'V4270 Basil', 'live', '42750000-0000-4000-b0a0-000000000001', 'event_organizer', 'gia.v4270@test.local', 'gia.v4270@test.local'),
  ('42750000-0000-4000-c0a0-000000000002', 'hosts', 'V4270 Cedar', 'live', '42750000-0000-4000-b0a0-000000000002', 'event_organizer', 'gia.v4270@test.local', 'gia.v4270@test.local'),
  ('42750000-0000-4000-c0a0-000000000003', 'hosts', 'V4270 Quiet', 'live', '42750000-0000-4000-b0a0-000000000003', 'event_organizer', 'gia.v4270@test.local', 'gia.v4270@test.local');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('42750000-0000-4000-c0a0-000000000001', 'gia.v4270@test.local', 'gia.v4270@test.local'),
  ('42750000-0000-4000-c0a0-000000000002', 'gia.v4270@test.local', 'gia.v4270@test.local'),
  ('42750000-0000-4000-c0a0-000000000003', 'gia.v4270@test.local', 'gia.v4270@test.local');

do $main$
declare
  A constant text := '42750000-0000-4000-b0a0-000000000001';
  B constant text := '42750000-0000-4000-b0a0-000000000002';
  CA constant text := '42750000-0000-4000-e0a0-000000000001';
  CB constant text := '42750000-0000-4000-e0a0-000000000002';
  v jsonb; v_t text; v_id uuid; v_rev bigint; v_n integer; v_good text; v_bad text[]; v_i integer := 0; r record;
  v_card uuid; v_today date := public.ops_today(NULL); v_titles text;
begin
  -- V-MATRIX ----------------------------------------------------------------
  v := pg_temp.v_read('venue', A);
  v_titles := (select string_agg(i->>'title', ',' order by i->>'title') from jsonb_array_elements(v->'items') i where i->>'kind' = 'event');
  perform pg_temp.v_check('V-MATRIX', 'venue staff see only events anyone can open', v_titles, 'V4270 discover live,V4270 discover scheduled');
  perform pg_temp.v_check('V-MATRIX', 'venue staff cannot add', (v->>'can_add'), 'false');
  v := pg_temp.v_read('scan', A);
  v_titles := (select string_agg(i->>'title', ',' order by i->>'title') from jsonb_array_elements(v->'items') i where i->>'kind' = 'event');
  perform pg_temp.v_check('V-MATRIX', 'a read rank sees all but cancelled', v_titles,
    'V4270 discover draft,V4270 discover live,V4270 discover scheduled,V4270 hidden draft,V4270 hidden scheduled,V4270 private draft,V4270 private scheduled');

  -- V-DEMOTE ----------------------------------------------------------------
  v := pg_temp.v_add('dem', A, jsonb_build_object('type', 'post', 'title', 'V4270 demote', 'on', pg_temp.v_day(9)), 'vdemote0001')::jsonb;
  v_id := (v #>> '{item,id}')::uuid; v_rev := (v #>> '{item,revision}')::bigint;
  perform pg_temp.v_check('V-DEMOTE', 'the author can edit', v #>> '{item,can_edit}', 'true');
  update public.brand_team_members set role = 'venue_staff' where brand_id = A::uuid and user_id = (select id from v_people where who = 'dem');
  v := pg_temp.v_read('dem', A);
  perform pg_temp.v_check('V-DEMOTE', 'demoted: still mine, no edit',
    (select (i->>'mine') || '/' || (i->>'can_edit') from jsonb_array_elements(v->'items') i where i->>'id' = v_id::text), 'true/false');
  perform pg_temp.v_check('V-DEMOTE', 'demoted: private events go', (v::text like '%V4270 private%')::text, 'false');
  v_t := pg_temp.v_as('dem', format($q$select public.brand_plan_host_update('post', %L, %L::jsonb, %s)::text$q$, v_id, jsonb_build_object('on', pg_temp.v_day(12))::text, v_rev));
  perform pg_temp.v_like('V-DEMOTE', 'demoted: change refused', v_t, 'ERR:42501:read_only:%');
  v_t := pg_temp.v_as('dem', format($q$select public.brand_plan_host_remove('post', %L, %s)::text$q$, v_id, v_rev));
  perform pg_temp.v_like('V-DEMOTE', 'demoted: remove refused', v_t, 'ERR:42501:read_only:%');
  v_t := pg_temp.v_add('dem', A, jsonb_build_object('type', 'post', 'title', 'V4270 demote two', 'on', pg_temp.v_day(9)), 'vdemote0002');
  perform pg_temp.v_like('V-DEMOTE', 'demoted: add refused', v_t, 'ERR:42501:read_only:%');
  perform pg_temp.v_check('V-DEMOTE', 'demoted: nothing moved',
    (select revision::text || '/' || (deleted_at is null)::text from public.content_calendar_items where id = v_id), v_rev::text || '/true');
  update public.brand_team_members set role = 'marketing_manager' where brand_id = A::uuid and user_id = (select id from v_people where who = 'dem');

  -- V-DOOR ------------------------------------------------------------------
  for r in select * from (values
      ($q$select public.ops_brand_plan('42750000-0000-4000-c0a0-000000000001', current_date, current_date + 5)::text$q$),
      ($q$select public.ops_brand_plan_add('42750000-0000-4000-c0a0-000000000001', '{"type":"post","title":"x","on":"2099-01-01"}', 'vdoorkey0001')::text$q$),
      ($q$select public.ops_host_on_mingla('42750000-0000-4000-c0a0-000000000001')::text$q$),
      ($q$select public.ops_brand_host_record('42750000-0000-4000-b0a0-000000000001')::text$q$),
      ($q$select public.brand_plan_line('42750000-0000-4000-b0a0-000000000001', 'forged')::text$q$),
      ($q$select count(*)::text from public.brand_plan_cards('42750000-0000-4000-b0a0-000000000001', current_date, current_date + 5)$q$),
      ($q$select public.brand_plan_host_title('post', 'x', '42750000-0000-4000-b0a0-000000000001', null)$q$),
      ($q$select public.brand_plan_free_title('post', 'x', 'y', null)$q$),
      ($q$select public.brand_plan_host_record('42750000-0000-4000-b0a0-000000000001')::text$q$),
      ($q$select count(*)::text from public.content_calendar_items$q$)
    ) q(sql) loop
    perform pg_temp.v_like('V-DOOR', 'venue staff refused: ' || left(r.sql, 50), pg_temp.v_as('venue', r.sql), 'ERR:42501:%');
    perform pg_temp.v_like('V-DOOR', 'marketing manager refused: ' || left(r.sql, 50), pg_temp.v_as('ola', r.sql), 'ERR:42501:%');
  end loop;
  perform pg_temp.v_check('V-DOOR', 'no forged line', (select count(*)::text from public.messages where content = 'forged'), '0');

  -- L-CLASS -----------------------------------------------------------------
  v_bad := ARRAY[
    'https://canva.com' || U&'\200B' || '.evil.example/', 'https://canva.com/' || U&'\202E' || 'x', 'https://canva.com/' || U&'\00AD' || 'x',
    'https://canva.com/' || U&'\00A0' || 'x', 'https://canva.com/' || U&'\FEFF' || 'x', 'https://canva.com/' || U&'\+0E0061' || 'x',
    'https://canva.com/' || U&'\2060' || 'x', 'https://canva.com/' || U&'\3000' || 'x', 'https://canva.com/' || U&'\180E' || 'x',
    'https://user@evil.example/', 'https://canva.com:x@evil.example/', 'https://canva.com%2F@evil.example/', 'https://canva.com\@evil.example/',
    'https://canva.com\evil.example/', 'HTTPS://canva.com/x', 'http://canva.com/x', 'javascript:alert(1)', 'https://', 'https://a b.example/',
    'https:///evil.example', 'https://:443/evil', 'https://?x=1', 'https://#x',
    'https://canva.com' || U&'\+01D173' || '.evil.example'];
  foreach v_good in array v_bad loop
    v_i := v_i + 1;
    v_t := pg_temp.v_add('ola', A, jsonb_build_object('type', 'post', 'title', 'V4270 link ' || v_i, 'on', pg_temp.v_day(9), 'link', v_good), 'vlinkkey' || lpad(v_i::text, 4, '0'));
    perform pg_temp.v_like('L-CLASS', 'host add refuses link ' || v_i, v_t, 'ERR:22023:invalid_link:%');
  end loop;
  v := pg_temp.v_add('ola', A, jsonb_build_object('type', 'post', 'title', 'V4270 link door', 'on', pg_temp.v_day(9)), 'vlinkdoor01')::jsonb;
  v_id := (v #>> '{item,id}')::uuid; v_rev := (v #>> '{item,revision}')::bigint;
  v_i := 0;
  foreach v_good in array v_bad loop
    v_i := v_i + 1;
    v_t := pg_temp.v_as('ola', format($q$select public.brand_plan_host_update('post', %L, %L::jsonb, %s)::text$q$, v_id, jsonb_build_object('link', v_good)::text, v_rev));
    perform pg_temp.v_like('L-CLASS', 'host update refuses link ' || v_i, v_t, 'ERR:22023:invalid_link:%');
  end loop;
  perform pg_temp.v_check('L-CLASS', 'a stored link that slipped in is never shown', public.brand_plan_link_json('https://user@evil.example/')::text, null);
  perform pg_temp.v_check('L-CLASS', 'nor one with a hidden character', public.brand_plan_link_json('https://canva.com' || U&'\200B' || '.evil.example/')::text, null);
  foreach v_good in array ARRAY['https://canva.com/a@b', 'https://canva.com/x?who=@me', 'https://canva.com/#@', 'https://canva.com:8443/x'] loop
    perform pg_temp.v_check('L-CLASS', 'allowed and labelled by its site: ' || v_good, public.brand_plan_link_json(v_good)->>'site', 'canva.com');
  end loop;
  perform pg_temp.v_check('L-CLASS', 'www is dropped from the label', public.brand_plan_link_json('https://WWW.Canva.com/x')->>'site', 'canva.com');

  -- S-SHOWN -----------------------------------------------------------------
  v := pg_temp.v_add('ola', A, jsonb_build_object('type', 'post', 'title', 'V4270 shown', 'on', pg_temp.v_day(9)), 'vshown00001')::jsonb;
  perform pg_temp.v_check('S-SHOWN', 'stored with the suffix',
    (select title from public.content_calendar_items where id = (v #>> '{item,id}')::uuid), 'V4270 shown · V4270 Basil');
  perform pg_temp.v_check('S-SHOWN', 'shown without it', v #>> '{item,title}', 'V4270 shown');
  perform pg_temp.v_check('S-SHOWN', 'the answer no longer speaks of a changed title', (v ? 'title_changed')::text, 'false');
  v := pg_temp.v_read('venue', A);
  perform pg_temp.v_check('S-SHOWN', 'nobody reads the suffix on their own brand',
    (select count(*)::text from jsonb_array_elements(v->'items') i where i->>'title' like '% · V4270 Basil'), '0');
  perform pg_temp.v_like('S-SHOWN', 'the plan line uses the shown title',
    (select string_agg(content, '|') from public.messages where conversation_id = CA::uuid and content like '%V4270 shown%'), '%“V4270 shown” to the plan for%');
  perform pg_temp.v_check('S-SHOWN', 'and never the suffix',
    (select count(*)::text from public.messages where conversation_id = CA::uuid and message_type = 'system' and content like '%· V4270 Basil%'), '0');
  v_t := pg_temp.v_add('ola', A, jsonb_build_object('type', 'post', 'title', repeat('L', 160), 'on', pg_temp.v_day(9)), 'vshown00002');
  perform pg_temp.v_like('S-SHOWN', '160 characters: refused, never cut', v_t, 'ERR:22023:title_too_long: Keep this to 141 characters.');
  v := pg_temp.v_add('ola', A, jsonb_build_object('type', 'task', 'title', 'V4270 long task ' || repeat('T', 141 - 16), 'on', pg_temp.v_day(9)), 'vshown00003')::jsonb;
  perform pg_temp.v_check('S-SHOWN', 'a task at the limit is whole',
    (select title from public.ops_work_cards where id = (v #>> '{item,id}')::uuid), 'V4270 long task ' || repeat('T', 141 - 16) || ' · V4270 Basil');
  perform pg_temp.v_check('S-SHOWN', 'the plan tells the form the limit', pg_temp.v_read('ola', A) ->> 'title_max', '141');
  perform set_config('session_replication_role', 'replica', true);
  update public.brands set name = repeat('N', 200) where id = B::uuid;
  perform set_config('session_replication_role', 'origin', true);
  v_t := pg_temp.v_add('bob', B, jsonb_build_object('type', 'post', 'title', 'V4270 long brand', 'on', pg_temp.v_day(9)), 'vshown00004');
  perform pg_temp.v_check('S-SHOWN', 'a very long brand name keeps within 160 and is stripped', v_t::jsonb #>> '{item,title}', 'V4270 long brand');
  perform set_config('session_replication_role', 'replica', true);
  update public.brands set name = 'V4270 Cedar' where id = B::uuid;
  perform set_config('session_replication_role', 'origin', true);
  perform pg_temp.v_check('S-SHOWN', 'the same title on another brand is free',
    (pg_temp.v_add('bob', B, jsonb_build_object('type', 'post', 'title', 'V4270 shown', 'on', pg_temp.v_day(9)), 'vshown00005')::jsonb #>> '{item,title}'), 'V4270 shown');
  perform pg_temp.v_like('S-SHOWN', 'twice on one brand: the D24 words',
    pg_temp.v_add('ola', A, jsonb_build_object('type', 'post', 'title', 'v4270   SHOWN', 'on', pg_temp.v_day(9)), 'vshown00006'), 'ERR:23505:duplicate_title:%');

  -- R-LIMIT -----------------------------------------------------------------
  v := pg_temp.v_add('ife', A, jsonb_build_object('type', 'post', 'title', 'V4270 rate post', 'on', pg_temp.v_day(20)), 'vrate000001')::jsonb;
  v_id := (v #>> '{item,id}')::uuid; v_rev := (v #>> '{item,revision}')::bigint;
  v := pg_temp.v_add('ife', A, jsonb_build_object('type', 'task', 'title', 'V4270 rate task', 'on', pg_temp.v_day(20)), 'vrate000002')::jsonb;
  v_card := (v #>> '{item,id}')::uuid;
  for v_i in 1..6 loop
    v_t := pg_temp.v_as('ife', format($q$select public.brand_plan_host_update('post', %L, %L::jsonb, %s)::text$q$, v_id, jsonb_build_object('on', pg_temp.v_day(20 + v_i))::text, v_rev));
    v_rev := v_rev + 1;
    v_t := pg_temp.v_as('ife', format($q$select public.brand_plan_host_update('task', %L, %L::jsonb, %s)::text$q$, v_card, jsonb_build_object('on', pg_temp.v_day(20 + v_i))::text, (select revision from public.ops_work_cards where id = v_card)));
  end loop;
  perform pg_temp.v_like('R-LIMIT', 'twelve went through', v_t, '{%');
  v_n := pg_temp.v_lines(CA);
  v_t := pg_temp.v_as('ife', format($q$select public.brand_plan_host_update('post', %L, %L::jsonb, %s)::text$q$, v_id, jsonb_build_object('on', pg_temp.v_day(40))::text, v_rev));
  perform pg_temp.v_like('R-LIMIT', 'the thirteenth post change is refused', v_t, 'ERR:22023:too_many:%an hour%');
  v_t := pg_temp.v_as('ife', format($q$select public.brand_plan_host_update('task', %L, %L::jsonb, %s)::text$q$, v_card, jsonb_build_object('on', pg_temp.v_day(40))::text, (select revision from public.ops_work_cards where id = v_card)));
  perform pg_temp.v_like('R-LIMIT', 'so is a task change: the limit is shared', v_t, 'ERR:22023:too_many:%');
  perform pg_temp.v_check('R-LIMIT', 'a refused change writes no line', pg_temp.v_lines(CA)::text, v_n::text);
  perform pg_temp.v_check('R-LIMIT', 'a refused change moves nothing', (select revision::text from public.content_calendar_items where id = v_id), v_rev::text);
  v := pg_temp.v_add('ola', A, jsonb_build_object('type', 'post', 'title', 'V4270 rate other', 'on', pg_temp.v_day(20)), 'vrate000003')::jsonb;
  v_t := pg_temp.v_as('ola', format($q$select public.brand_plan_host_update('post', %L, %L::jsonb, %s)::text$q$, (v #>> '{item,id}'), jsonb_build_object('on', pg_temp.v_day(30))::text, (v #>> '{item,revision}')));
  perform pg_temp.v_like('R-LIMIT', 'another person on the brand is not limited', v_t, '{%');

  -- F-FLAG ------------------------------------------------------------------
  for r in select * from (values ('Q', '42750000-0000-4000-c0a0-000000000003'::uuid), ('A', '42750000-0000-4000-c0a0-000000000001'::uuid), ('NOLINK', NULL::uuid)) x(k, rec) loop
    insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id, created_by, updated_by)
    values ('V4270 flag ' || r.k, 'Do this task carefully and say what changed.', 'It is done and checked.', 'todo', v_today + 3, 'explicit', public.ops_sprint_ensure(v_today + 3), 'gia.v4270@test.local', 'gia.v4270@test.local')
    returning id into v_card;
    insert into v_ids values (r.k, v_card);
    if r.rec is not null then insert into public.ops_work_links (card_id, kind, target_id, label, added_by) values (v_card, 'host', r.rec, 'host', 'gia.v4270@test.local'); end if;
  end loop;
  v_n := (select count(*) from public.conversations where brand_id = '42750000-0000-4000-b0a0-000000000003');
  update public.ops_work_cards set on_brand_plan = true, updated_by = 'gia.v4270@test.local' where id = (select id from v_ids where k = 'Q');
  perform pg_temp.v_check('F-FLAG', 'no Brand group: the save works and starts none',
    (select on_brand_plan::text from public.ops_work_cards where id = (select id from v_ids where k = 'Q')) || '/' ||
    (select count(*) from public.conversations where brand_id = '42750000-0000-4000-b0a0-000000000003')::text, 'true/' || v_n);
  v_n := (select count(*) from public.messages where message_type = 'system' and content like '%V4270 flag%');
  update public.ops_work_cards set on_brand_plan = true, updated_by = 'gia.v4270@test.local' where id = (select id from v_ids where k = 'NOLINK');
  perform pg_temp.v_check('F-FLAG', 'no host link: no line', (select count(*) from public.messages where message_type = 'system' and content like '%V4270 flag%')::text, v_n::text);
  update public.ops_work_cards set on_brand_plan = true, updated_by = 'gia.v4270@test.local' where id = (select id from v_ids where k = 'A');
  perform pg_temp.v_like('F-FLAG', 'switched on: first name only',
    (select string_agg(content, '|') from public.messages where conversation_id = CA::uuid and content like '%V4270 flag A%'), 'Gia added “V4270 flag A” to the plan for %');
  v_n := pg_temp.v_lines(CA);
  update public.ops_work_cards set instructions = 'Do this task carefully and say what changed again.' where id = (select id from v_ids where k = 'A');
  perform pg_temp.v_check('F-FLAG', 'another edit: no line', pg_temp.v_lines(CA)::text, v_n::text);
  update public.ops_work_cards set status = 'done', closed_at = now(), closed_by = 'gia.v4270@test.local', close_kind = 'done', on_brand_plan = false where id = (select id from v_ids where k = 'A');
  perform pg_temp.v_check('F-FLAG', 'a done card switched off: no line', pg_temp.v_lines(CA)::text, v_n::text);

  -- K-KEYS ------------------------------------------------------------------
  v := pg_temp.v_add('ola', A, jsonb_build_object('type', 'task', 'title', 'V4270 keys task', 'on', pg_temp.v_day(10), 'link', 'https://canva.com/k'), 'vkeys000001')::jsonb;
  for r in select * from (values ('ola'), ('scan'), ('venue')) x(who) loop
    v := pg_temp.v_read(r.who, A);
    perform pg_temp.v_check('K-KEYS', r.who || ': top keys', (select string_agg(k, ',' order by k) from jsonb_object_keys(v) k), 'brand,can_add,from,items,title_max,to,today');
    perform pg_temp.v_check('K-KEYS', r.who || ': post keys', (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(v->'items') i, jsonb_object_keys(i) k where i->>'kind' = 'post'),
      'at,by,can_edit,id,kind,link,live_url,mine,on,revision,state,state_words,title');
    perform pg_temp.v_check('K-KEYS', r.who || ': task keys', (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(v->'items') i, jsonb_object_keys(i) k where i->>'kind' = 'task'),
      'at,by,can_edit,id,kind,link,mine,on,revision,state,state_words,title');
    perform pg_temp.v_check('K-KEYS', r.who || ': event keys', (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(v->'items') i, jsonb_object_keys(i) k where i->>'kind' = 'event'),
      'at,by,can_link,event_type,id,kind,link,mine,on,state,state_words,title');
    perform pg_temp.v_check('K-KEYS', r.who || ': no address anywhere', (v::text like '%@%')::text, 'false');
    perform pg_temp.v_check('K-KEYS', r.who || ': no line says who added it to another brand', (v::text like '%V4270 Cedar%')::text, 'false');
  end loop;
end;
$main$;

select count(*) as v_total, count(*) filter (where not ok) as v_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as v_failures
  from v_results \gset
rollback;

select (:v_total < 60 or :v_failed > 0) as v_bad \gset
\if :v_bad
  \echo 'ISSUE-4270 W4 TESTER FAILED:' :v_failed 'of' :v_total
  \echo :v_failures
  do $$ begin raise exception 'ISSUE-4270 W4 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-4270 W4 TESTER PASS:' :v_total 'checks, 0 failed'
