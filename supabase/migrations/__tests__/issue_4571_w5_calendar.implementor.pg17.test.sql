-- Issue #4571 W5 (the Calendar's Week view) -- implementor suite for
-- 20281130054571_issue_4571_w5_calendar_week.sql on the fully replayed PG17
-- schema. Everything is rolled back.
--
-- INVARIANT calendar-week-no-contact-details | gate ops_agent_call list_calendar projection | test this file
--
--   CALLBACKS  hosts and creators cards on the phone channel with a next
--              follow-up in the window, stage not lost, passed or live; the
--              window edges are in; email cards, deleted cards, other days and
--              cards with no date are out; owners by name only; earliest first.
--   WORKDUE    open Work cards and subtasks due in the window through the one
--              card shape (equal to ops_cards_json board); done, archived and
--              other days are out.
--   ACCESS     a window over 100 days is refused; signed out and a signed-in
--              person with no team role are refused; no anon grant.
--   CONNECTOR  list_calendar through the real gateway carries calls (demos with
--              the linked card or needs_linking, in the person's zone; call-backs)
--              and work_due; layers choose; an email address or phone number
--              never appears; a demo 95 days out (the second chunk) is there.
--
-- FAILS-ON-REVERT: before the migration the two functions do not exist; with the
-- list_calendar projection returning the whole booking row the no-contact-details
-- checks fail.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45750000-0000-4000-c000-000000000001', 'seth.w54571@test.local'),
  ('tao',  '45750000-0000-4000-c000-000000000002', 'tao.w54571@test.local'),
  ('kemi', '45750000-0000-4000-c000-000000000003', 'kemi.w54571@test.local'),
  ('out',  '45750000-0000-4000-c000-000000000004', 'outsider.w54571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('seth.w54571@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who in ('tao', 'kemi');

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;
create function pg_temp.as_(p_who text, p_sql text) returns text
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
create function pg_temp.anon(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role anon;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.gw(p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform pg_temp.next_request();
  begin
    set local role service_role;
    execute format('select public.ops_agent_call(%L, %L, %L::jsonb, %L)::text',
      encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_tool, p_args, 'w54571-test/1.0') into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.svc(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role service_role;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tx_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 'w5-' || md5(random()::text || clock_timestamp()::text) $fn$;
-- A card owned by tao.
create function pg_temp.card(p_k text, p_pipeline text, p_name text, p_stage text, p_channel text, p_due date) returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, channel, due_on, created_by, updated_by)
  values (v_id, p_pipeline, p_name, p_stage, case when p_stage in ('lost', 'passed') then 'Not now' end, p_channel, p_due,
          'seth.w54571@test.local', 'seth.w54571@test.local');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (v_id, 'tao.w54571@test.local', 'seth.w54571@test.local');
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
create function pg_temp.work(p_k text, p_title text, p_due date, p_parent text default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'due_on', p_due,
    'owners', jsonb_build_array('tao.w54571@test.local'), 'watchers', jsonb_build_array('kemi.w54571@test.local'));
  if p_parent is not null then v_item := v_item || jsonb_build_object('parent', pg_temp.id(p_parent)); end if;
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.booking(p_k text, p_name text, p_email text, p_venue text, p_at timestamptz, p_phone text default null) returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.book_call_leads (id, booking_key, audience, name, email, venue, icp, call_at, created_at, phone_e164,
                                      social_platform, social_url)
  values (v_id, 'slot:w5-' || p_k, 'host', p_name, p_email, p_venue, 'restaurants', p_at, now(), p_phone,
          'instagram', 'https://instagram.com/' || p_k);
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
create function pg_temp.rng(p_from date, p_to date) returns text
language sql as $fn$ select format('%L::date, %L::date', p_from, p_to) $fn$;

-- ───────────────────────────── fixtures ─────────────────────────────
do $t$
declare v_from date := current_date; v_to date := current_date + 6; v text;
begin
  -- Call-backs.
  perform pg_temp.card('cb_h', 'hosts', 'Lagos Jazz Nights', 'replied', 'phone', v_from + 1);
  perform pg_temp.card('cb_c', 'creators', 'Ngozi Films', 'negotiating', 'phone', v_from + 2);
  perform pg_temp.card('cb_edge1', 'hosts', 'Edge Start Bar', 'contacted', 'phone', v_from);
  perform pg_temp.card('cb_edge2', 'creators', 'Edge End Studio', 'identified', 'phone', v_to);
  perform pg_temp.card('cb_mail', 'hosts', 'Email Only Cafe', 'replied', 'email', v_from + 1);
  perform pg_temp.card('cb_lost', 'hosts', 'Lost Lounge', 'lost', 'phone', v_from + 1);
  perform pg_temp.card('cb_passed', 'creators', 'Passed Creator', 'passed', 'phone', v_from + 1);
  perform pg_temp.card('cb_live', 'hosts', 'Live Venue', 'replied', 'phone', v_from + 1);
  perform pg_temp.card('cb_later', 'hosts', 'Later Bar', 'replied', 'phone', v_to + 1);
  perform pg_temp.card('cb_earlier', 'hosts', 'Earlier Bar', 'replied', 'phone', v_from - 1);
  perform pg_temp.card('cb_none', 'hosts', 'No Date Bar', 'replied', 'phone', null);
  perform pg_temp.card('cb_del', 'hosts', 'Deleted Bar', 'replied', 'phone', v_from + 1);
  -- Live is behind the demo rule (W4): turn it off for this fixture only.
  alter table public.crm_records disable trigger crm_4571_demo_stage_guard;
  update public.crm_records set stage = 'live' where id = pg_temp.id('cb_live');
  alter table public.crm_records enable trigger crm_4571_demo_stage_guard;
  update public.crm_records set deleted_at = now(), deleted_by = 'seth.w54571@test.local' where id = pg_temp.id('cb_del');
  -- Work cards.
  v := pg_temp.work('w_a', 'W5 Send the launch note', v_from + 2);
  if v like 'ERR:%' then raise exception 'card not made: %', v; end if;
  perform pg_temp.work('w_edge', 'W5 Edge due card', v_to);
  perform pg_temp.work('w_sub', 'W5 A subtask due', v_from + 3, 'w_a');
  perform pg_temp.work('w_done', 'W5 Closed card', v_from + 2);
  perform pg_temp.work('w_arch', 'W5 Archived card', v_from + 2);
  perform pg_temp.work('w_out', 'W5 Due next month', v_to + 20);
  update public.ops_work_cards set status = 'done', closed_at = now(), closed_by = 'system@usemingla.com', closed_via = 'system', close_kind = 'system'
   where id = pg_temp.id('w_done');
  v := pg_temp.person('seth', format('select public.ops_work_archive(%L::uuid, %L)::text', pg_temp.id('w_arch'), 'Archived for the W5 fixture'));
  if v like 'ERR:%' then raise exception 'archive: %', v; end if;
end;
$t$;

-- ───────────────────────────── CALLBACKS ─────────────────────────────
do $t$
declare v text; j jsonb; v_from date := current_date; v_to date := current_date + 6; v_names text;
begin
  v := pg_temp.person('tao', format('select public.ops_calendar_callbacks(%s)::text', pg_temp.rng(v_from, v_to)));
  if v like 'ERR:%' then raise exception 'callbacks: %', v; end if;
  j := v::jsonb;
  select string_agg(r->>'name', ',' order by ord) into v_names from jsonb_array_elements(j->'rows') with ordinality t(r, ord);
  perform pg_temp.chk('CALLBACKS', 'the four phone cards in the window, earliest first (ties by name)', v_names,
    'Edge Start Bar,Lagos Jazz Nights,Ngozi Films,Edge End Studio');
  perform pg_temp.chk('CALLBACKS', 'the window start and end are both in', (j->>'total'), '4');
  perform pg_temp.chk('CALLBACKS', 'not truncated', j->>'truncated', 'false');
  perform pg_temp.chk('CALLBACKS', 'a host row carries record_id, pipeline, due_on, stage',
    (select (r - 'owners')::text from jsonb_array_elements(j->'rows') r where r->>'name' = 'Lagos Jazz Nights'),
    jsonb_build_object('name', 'Lagos Jazz Nights', 'stage', 'replied', 'due_on', (v_from + 1)::text, 'pipeline', 'hosts',
                       'record_id', pg_temp.id('cb_h'))::text);
  perform pg_temp.chk('CALLBACKS', 'a creator row says creators',
    (select r->>'pipeline' from jsonb_array_elements(j->'rows') r where r->>'name' = 'Ngozi Films'), 'creators');
  perform pg_temp.chk('CALLBACKS', 'owners are names, never an email address',
    (select r->'owners'->>0 from jsonb_array_elements(j->'rows') r where r->>'name' = 'Lagos Jazz Nights'), public.ops_name('tao.w54571@test.local'));
  perform pg_temp.chk('CALLBACKS', 'no @ anywhere in the answer', (position('@' in v) > 0)::text, 'false');
  perform pg_temp.chk('CALLBACKS', 'an email card is out', (v like '%Email Only Cafe%')::text, 'false');
  perform pg_temp.chk('CALLBACKS', 'lost, passed and live are out', (v like '%Lost Lounge%' or v like '%Passed Creator%' or v like '%Live Venue%')::text, 'false');
  perform pg_temp.chk('CALLBACKS', 'the day after and the day before are out', (v like '%Later Bar%' or v like '%Earlier Bar%')::text, 'false');
  perform pg_temp.chk('CALLBACKS', 'a card with no date is out', (v like '%No Date Bar%')::text, 'false');
  perform pg_temp.chk('CALLBACKS', 'a deleted card is out', (v like '%Deleted Bar%')::text, 'false');
  -- One day.
  v := pg_temp.person('tao', format('select public.ops_calendar_callbacks(%s)::text', pg_temp.rng(v_from + 1, v_from + 1)));
  perform pg_temp.chk('CALLBACKS', 'a one-day window holds that day only', (v::jsonb)->>'total', '1');
end;
$t$;

-- ───────────────────────────── WORKDUE ─────────────────────────────
do $t$
declare v text; j jsonb; v_from date := current_date; v_to date := current_date + 6; v_titles text;
begin
  v := pg_temp.person('tao', format('select public.ops_calendar_work_due(%s)::text', pg_temp.rng(v_from, v_to)));
  if v like 'ERR:%' then raise exception 'work due: %', v; end if;
  j := v::jsonb;
  select string_agg(c->>'title', ',' order by ord) into v_titles from jsonb_array_elements(j->'cards') with ordinality t(c, ord);
  perform pg_temp.chk('WORKDUE', 'open cards and the subtask due in the window, earliest first', v_titles,
    'W5 Send the launch note,W5 A subtask due,W5 Edge due card');
  perform pg_temp.chk('WORKDUE', 'done, archived and next month are out',
    (v like '%Closed card%' or v like '%Archived card%' or v like '%Due next month%')::text, 'false');
  perform pg_temp.chk('WORKDUE', 'the subtask names its parent',
    (select c->'parent'->>'title' from jsonb_array_elements(j->'cards') c where c->>'title' = 'W5 A subtask due'), 'W5 Send the launch note');
  perform pg_temp.chk('WORKDUE', 'one card shape: the card equals ops_cards_json board',
    (j->'cards'->0)::text,
    (select (public.ops_cards_json(array[pg_temp.id('w_a')], public.ops_today(null), 'board')->0)::text));
  perform pg_temp.chk('WORKDUE', 'total counts the open cards', j->>'total', '3');
  perform pg_temp.chk('WORKDUE', 'not truncated', j->>'truncated', 'false');
end;
$t$;

-- ───────────────────────────── ACCESS ─────────────────────────────
do $t$
declare v_from date := current_date; v_to date := current_date + 6; v_fn text;
begin
  perform pg_temp.lk('ACCESS', 'callbacks: 101 days is refused',
    pg_temp.person('tao', format('select public.ops_calendar_callbacks(%s)::text', pg_temp.rng(v_from, v_from + 100))), 'ERR:22023:invalid_window:%');
  perform pg_temp.chk('ACCESS', 'callbacks: 100 days is allowed',
    (pg_temp.person('tao', format('select public.ops_calendar_callbacks(%s)::text', pg_temp.rng(v_from, v_from + 99))) like 'ERR:%')::text, 'false');
  perform pg_temp.lk('ACCESS', 'work due: 101 days is refused',
    pg_temp.person('tao', format('select public.ops_calendar_work_due(%s)::text', pg_temp.rng(v_from, v_from + 100))), 'ERR:22023:invalid_window:%');
  perform pg_temp.lk('ACCESS', 'callbacks: to before from is refused',
    pg_temp.person('tao', format('select public.ops_calendar_callbacks(%s)::text', pg_temp.rng(v_to, v_from))), 'ERR:22023:invalid_window:%');
  perform pg_temp.lk('ACCESS', 'callbacks: a person with no team role is refused',
    pg_temp.person('out', format('select public.ops_calendar_callbacks(%s)::text', pg_temp.rng(v_from, v_to))), 'ERR:42501:forbidden:%');
  perform pg_temp.lk('ACCESS', 'work due: a person with no team role is refused',
    pg_temp.person('out', format('select public.ops_calendar_work_due(%s)::text', pg_temp.rng(v_from, v_to))), 'ERR:42501:forbidden:%');
  perform pg_temp.lk('ACCESS', 'callbacks: anon cannot run it',
    pg_temp.anon(format('select public.ops_calendar_callbacks(%s)::text', pg_temp.rng(v_from, v_to))), 'ERR:42501:%');
  perform pg_temp.lk('ACCESS', 'work due: anon cannot run it',
    pg_temp.anon(format('select public.ops_calendar_work_due(%s)::text', pg_temp.rng(v_from, v_to))), 'ERR:42501:%');
  foreach v_fn in array array['public.ops_calendar_callbacks(date,date)', 'public.ops_calendar_work_due(date,date)'] loop
    perform pg_temp.chk('ACCESS', v_fn || ': signed in only, never anon or PUBLIC',
      has_function_privilege('anon', v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', v_fn, 'EXECUTE')::text
        || '/' || (select coalesce(bool_or(a.grantee = 0), false)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = v_fn::regprocedure),
      'false/true/false');
    perform pg_temp.chk('ACCESS', v_fn || ': pins its search_path ending in pg_temp',
      (select (proconfig::text like '%pg_temp%')::text from pg_proc where oid = v_fn::regprocedure), 'true');
  end loop;
end;
$t$;

-- ───────────────────────────── CONNECTOR ─────────────────────────────
do $t$
declare v text; v_key text; j jsonb; v_from date := current_date; v_to date := current_date + 6; v_tz text := 'Africa/Lagos';
        v_at timestamptz; v_local text;
begin
  -- A booking linked to a card, one that needs linking, one in the second 90-day chunk.
  -- 23:30 UTC is the next local day in Lagos (UTC+1): the time is in the person's zone.
  v_at := (current_date + 2)::timestamp at time zone 'UTC' + interval '23 hours 30 minutes';
  perform pg_temp.booking('linked', 'Femi Ade', 'femi.ade@private-mail.ng', 'Linked Terrace', v_at, '+2348012345678');
  perform pg_temp.booking('loose', 'Joke @ Ade', 'joke.ade@private-mail.ng', 'Loose Venue joke@loose.ng', (current_date + 3)::timestamp at time zone 'UTC' + interval '10 hours', '+2348099999999');
  perform pg_temp.booking('far', 'Far Away', 'far.away@private-mail.ng', 'Far Venue', (current_date + 95)::timestamp at time zone 'UTC' + interval '12 hours');
  insert into public.crm_record_demos (booking_id, record_id, link_source, linked_by)
    values (pg_temp.id('linked'), pg_temp.id('cb_h'), 'picked', 'tao.w54571@test.local');

  v := pg_temp.person('tao', $q$select public.team_agent_key_create('claude')::text$q$);
  if v like 'ERR:%' then raise exception 'key not made: %', v; end if;
  v_key := (v::jsonb)->>'key';
  update public.team_agent_keys set time_zone = v_tz where key_hash = encode(sha256(convert_to(v_key, 'UTF8')), 'hex');

  v := pg_temp.gw(v_key, 'list_calendar', jsonb_build_object('from', v_from::text, 'to', v_to::text));
  if (v::jsonb)->>'ok' is distinct from 'true' then raise exception 'list_calendar: %', left(v, 400); end if;
  j := (v::jsonb)->'result';
  perform pg_temp.chk('CONNECTOR', 'the answer still carries events and expected',
    (j ? 'events')::text || '/' || (j ? 'expected')::text, 'true/true');
  perform pg_temp.chk('CONNECTOR', 'calls carry the person''s zone', j->'calls'->>'time_zone', v_tz);
  perform pg_temp.chk('CONNECTOR', 'two demos in the week, earliest first',
    (select string_agg(d->>'name', ',' order by ord) from jsonb_array_elements(j->'calls'->'demos') with ordinality t(d, ord)), 'Femi Ade,Joke [email hidden] Ade');
  perform pg_temp.chk('CONNECTOR', 'a linked demo names its card and does not need linking',
    (select (d->'record'->>'name') || '/' || (d->>'needs_linking') from jsonb_array_elements(j->'calls'->'demos') d where d->>'name' = 'Femi Ade'),
    'Lagos Jazz Nights/false');
  perform pg_temp.chk('CONNECTOR', 'an unlinked demo needs linking and has no card',
    (select coalesce((d->'record')::text, 'null') || '/' || (d->>'needs_linking') from jsonb_array_elements(j->'calls'->'demos') d where d->>'name' like 'Joke%'),
    'null/true');
  v_local := to_char(v_at at time zone v_tz, 'YYYY-MM-DD HH24:MI');
  perform pg_temp.chk('CONNECTOR', 'the demo time is also given in the person''s zone',
    (select d->>'call_at_local' from jsonb_array_elements(j->'calls'->'demos') d where d->>'name' = 'Femi Ade'), v_local);
  perform pg_temp.chk('CONNECTOR', '23:30 UTC is the next day in Lagos', (v_local like to_char(current_date + 3, 'YYYY-MM-DD') || ' 00:30')::text, 'true');
  perform pg_temp.chk('CONNECTOR', 'the demo carries only id, audience, name, venue, call_at, call_at_local, status, record, needs_linking',
    (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(d) k from jsonb_array_elements(j->'calls'->'demos') d) s),
    'audience,call_at,call_at_local,id,name,needs_linking,record,status,venue');
  perform pg_temp.chk('CONNECTOR', 'four call-backs, earliest first',
    (select string_agg(c->>'name', ',' order by ord) from jsonb_array_elements(j->'calls'->'callbacks') with ordinality t(c, ord)),
    'Edge Start Bar,Lagos Jazz Nights,Ngozi Films,Edge End Studio');
  perform pg_temp.chk('CONNECTOR', 'a call-back carries owners by name',
    (select c->'owners'->>0 from jsonb_array_elements(j->'calls'->'callbacks') c where c->>'name' = 'Ngozi Films'), public.ops_name('tao.w54571@test.local'));
  perform pg_temp.chk('CONNECTOR', 'Work due: the three open cards, earliest first',
    (select string_agg(c->>'title', ',' order by ord) from jsonb_array_elements(j->'work_due') with ordinality t(c, ord)),
    'W5 Send the launch note,W5 A subtask due,W5 Edge due card');
  perform pg_temp.chk('CONNECTOR', 'a Work due card has owners by name and no email',
    (select c->'owners'->>0 from jsonb_array_elements(j->'work_due') c where c->>'title' = 'W5 Send the launch note'), public.ops_name('tao.w54571@test.local'));
  perform pg_temp.chk('CONNECTOR', 'no @ anywhere in the whole answer', (position('@' in v) > 0)::text, 'false');
  perform pg_temp.chk('CONNECTOR', 'no phone number anywhere in the answer', (v like '%+234%' or v like '%2348012345678%' or v like '%8099999999%')::text, 'false');
  perform pg_temp.chk('CONNECTOR', 'no booking email appears', (v like '%private-mail%')::text, 'false');
  perform pg_temp.chk('CONNECTOR', 'the call summary counts demos, callbacks and work_due',
    (select (summary->>'demos') || '/' || (summary->>'callbacks') || '/' || (summary->>'work_due')
       from public.team_agent_calls where tool = 'list_calendar' order by started_at desc limit 1), '2/4/3');

  -- Layers choose.
  v := pg_temp.gw(v_key, 'list_calendar', jsonb_build_object('from', v_from::text, 'to', v_to::text, 'layers', jsonb_build_array('work_due')));
  j := (v::jsonb)->'result';
  perform pg_temp.chk('CONNECTOR', 'layers [work_due]: Work due only', (j ? 'work_due')::text || '/' || (j ? 'calls')::text || '/' || (j ? 'events')::text, 'true/false/false');
  v := pg_temp.gw(v_key, 'list_calendar', jsonb_build_object('from', v_from::text, 'to', v_to::text, 'layers', jsonb_build_array('calls')));
  j := (v::jsonb)->'result';
  perform pg_temp.chk('CONNECTOR', 'layers [calls]: calls only', (j ? 'work_due')::text || '/' || (j ? 'calls')::text || '/' || (j ? 'events')::text, 'false/true/false');
  v := pg_temp.gw(v_key, 'list_calendar', jsonb_build_object('from', v_from::text, 'to', v_to::text, 'layers', jsonb_build_array('live')));
  j := (v::jsonb)->'result';
  perform pg_temp.chk('CONNECTOR', 'layers [live]: events only, as before', (j ? 'work_due')::text || '/' || (j ? 'calls')::text || '/' || (j ? 'events')::text, 'false/false/true');

  -- The second 90-day chunk.
  v := pg_temp.gw(v_key, 'list_calendar', jsonb_build_object('from', v_from::text, 'to', (v_from + 99)::text, 'layers', jsonb_build_array('calls')));
  j := (v::jsonb)->'result';
  perform pg_temp.chk('CONNECTOR', 'a demo 95 days out (the second chunk) is listed',
    (select string_agg(d->>'name', ',' order by d->>'call_at') from jsonb_array_elements(j->'calls'->'demos') d), 'Femi Ade,Joke [email hidden] Ade,Far Away');
  -- A window over 100 days is refused in plain words, for the whole tool.
  v := pg_temp.gw(v_key, 'list_calendar', jsonb_build_object('from', v_from::text, 'to', (v_from + 100)::text));
  perform pg_temp.chk('CONNECTOR', 'a window over 100 days is refused', ((v::jsonb)->>'ok'), 'false');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 50 then raise exception '#4571 W5 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W5 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W5 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
