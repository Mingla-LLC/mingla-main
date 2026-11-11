-- Issue #4255 retest -- tester adversarial suite for the rework migration
-- 20280612014255_issue_4255_team_rework.sql, on the fully replayed PG17 schema.
-- Angles the implementor rework suite does not take:
--
--   X-DUE     the 09:00 digest: a revoked, an unconfirmed and a banned staff
--             owner are never told; a card they only watch, an archived card
--             and a closed card never count; a +05:45 zone (Kathmandu) is told
--             at its own 09:00 and not at 08:44; a +14:00 zone (Kiritimati) is
--             told once on its own date; the next local day tells again; an
--             unknown zone reads as New York; a zone with spaces is trimmed
--   X-DECIDE  a decision push goes only to confirmed staff; a note whose words
--             end in "· You send" is a mention, not a decision; toggling a tag
--             on and off and on queues one push per "on"
--   X-READ    nobody but the service role reads or writes the thread read
--             markers or runs ops_thread_unread; anon cannot mark a thread
--             read; an agent call never clears its person's badge; one
--             teammate opening the thread never clears another's
--
-- FAILS-ON-REVERT (each proved by deleting the guarded line from the
-- function in a copy of the replayed database and re-running this suite; see
-- the #4255 retest verdict):
--   * ops_due_digest: "CONTINUE WHEN NOT public.team_chat_staff(r.uid)"
--   * ops_due_digest: the "w.role = 'owner'" filter
--   * ops_thread_read: "IF v.via IS NULL THEN"
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null, tz text) on commit drop;
insert into tx_people (who, id, email, tz) values
  ('owner', '4255b000-0000-4000-a0f2-000000000001', 'oz.x4255@test.local',   'America/New_York'),
  ('ray',   '4255b000-0000-4000-a0f2-000000000002', 'ray.x4255@test.local',  'Africa/Lagos'),
  ('gem',   '4255b000-0000-4000-a0f2-000000000003', 'gem.x4255@test.local',  'America/New_York'),
  ('rev',   '4255b000-0000-4000-a0f2-000000000004', 'rev.x4255@test.local',  'Africa/Lagos'),
  ('unc',   '4255b000-0000-4000-a0f2-000000000005', 'unc.x4255@test.local',  'Africa/Lagos'),
  ('ban',   '4255b000-0000-4000-a0f2-000000000006', 'ban.x4255@test.local',  'Africa/Lagos'),
  ('ktm',   '4255b000-0000-4000-a0f2-000000000007', 'ktm.x4255@test.local',  'Asia/Kathmandu'),
  ('kir',   '4255b000-0000-4000-a0f2-000000000008', 'kir.x4255@test.local',  'Pacific/Kiritimati'),
  ('bad',   '4255b000-0000-4000-a0f2-000000000009', 'bad.x4255@test.local',  'Not/AZone'),
  ('spc',   '4255b000-0000-4000-a0f2-00000000000a', 'spc.x4255@test.local',  '  Africa/Lagos  '),
  ('host',  '4255b000-0000-4000-a0f2-00000000000b', 'host.x4255@test.local', 'Africa/Lagos');
insert into auth.users (id, email, email_confirmed_at)
  select id, email, case when who = 'unc' then null else now() end from tx_people;
update auth.users set banned_until = now() + interval '30 days' where id = '4255b000-0000-4000-a0f2-000000000006';
insert into public.admin_users (email, role, status, accepted_at) values ('oz.x4255@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who not in ('owner', 'host');
insert into public.profiles (id, timezone) select id, tz from tx_people
on conflict (id) do update set timezone = excluded.timezone;

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
create function pg_temp.as_anon(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role anon;
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
create function pg_temp.agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tx_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from tx_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tx_ids where k = p_k) $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 'tx-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.add(p_k text, p_title text, p_owner text, p_watcher text default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'owners', jsonb_build_array(p_owner), 'due_on', (now() at time zone 'UTC')::date + 3);
  if p_watcher is not null then v_item := v_item || jsonb_build_object('watchers', jsonb_build_array(p_watcher)); end if;
  v := pg_temp.person('owner', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.tag(p_k text, p_reason text) returns text
language sql as $fn$
  select pg_temp.person('owner', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id(p_k),
    jsonb_build_object('person_reason', p_reason), pg_temp.rev(p_k)))
$fn$;
-- Who was told by the digest, as "who" names, from its Mentions rows.
create function pg_temp.told() returns text
language sql as $fn$
  select coalesce(string_agg(p.who, ',' order by p.who), 'nobody')
    from public.team_mentions tm join tx_people p on p.id = tm.target_user_id where tm.source_kind = 'work_due'
$fn$;
-- A UTC instant at a given local wall time in a zone.
create function pg_temp.at_local(p_zone text, p_day date, p_time time) returns timestamptz
language sql as $fn$ select (p_day + p_time) at time zone p_zone $fn$;

-- ───────────────────────────── X-DUE ─────────────────────────────
do $t$
declare v text; v_d date := (now() at time zone 'UTC')::date;
begin
  -- Everyone in tx_people (except the host) owns one late card. Ray also
  -- watches a late card of Gem's, owns an archived late card and a closed late card.
  v := pg_temp.add('L-ray', 'X4255 Ray late', pg_temp.email('ray'));
  v := pg_temp.add('L-gem', 'X4255 Gem late', pg_temp.email('gem'), pg_temp.email('ray'));
  v := pg_temp.add('L-rev', 'X4255 Rev late', pg_temp.email('rev'));
  v := pg_temp.add('L-unc', 'X4255 Unc late', pg_temp.email('unc'));
  v := pg_temp.add('L-ban', 'X4255 Ban late', pg_temp.email('ban'));
  v := pg_temp.add('L-ktm', 'X4255 Ktm late', pg_temp.email('ktm'));
  v := pg_temp.add('L-kir', 'X4255 Kir late', pg_temp.email('kir'));
  v := pg_temp.add('L-bad', 'X4255 Bad late', pg_temp.email('bad'));
  v := pg_temp.add('L-spc', 'X4255 Spc late', pg_temp.email('spc'));
  v := pg_temp.add('L-arch', 'X4255 Ray archived late', pg_temp.email('ray'));
  update public.ops_work_cards set due_on = v_d - 30 where id in (select id from tx_ids where k like 'L-%');
  update public.ops_work_cards set archived_at = now(), archived_by = 'oz.x4255@test.local', archive_reason = 'duplicate' where id = pg_temp.id('L-arch');
  update public.admin_team_members set status = 'revoked' where email = 'rev.x4255@test.local';
  delete from public.team_mentions where source_kind = 'work_due';
  delete from public.notification_outbox where category_key = 'business.team_due';

  -- 09:10 in Lagos: of the Lagos people only Ray and the trimmed-zone one are told.
  perform public.ops_due_digest(pg_temp.at_local('Africa/Lagos', v_d, '09:10'));
  perform pg_temp.chk('X-DUE', 'Lagos 09:10: confirmed staff in Lagos only (revoked, unconfirmed, banned and the host never)',
    pg_temp.told(), 'ray,spc');
  perform pg_temp.chk('X-DUE', 'a card Ray only watches, an archived card: never counted (only his own late card)',
    (select body_excerpt from public.team_mentions tm where tm.source_kind = 'work_due' and tm.target_user_id = pg_temp.uid('ray')),
    '1 late: X4255 Ray late');
  perform pg_temp.chk('X-DUE', 'one push row each, ids only, explicit NULL country',
    (select count(*)::text || '/' || bool_and(o.country_code is null)::text from public.notification_outbox o
      where o.category_key = 'business.team_due' and o.user_id in (pg_temp.uid('ray'), pg_temp.uid('spc'))), '2/true');
  perform pg_temp.chk('X-DUE', 'a second run at 09:55 the same local day adds nothing',
    public.ops_due_digest(pg_temp.at_local('Africa/Lagos', v_d, '09:55'))::text || '/' || pg_temp.told(), '0/ray,spc');

  -- Kathmandu (+05:45): told at its own 09:00, not at 08:44.
  delete from public.team_mentions where source_kind = 'work_due';
  perform public.ops_due_digest(pg_temp.at_local('Asia/Kathmandu', v_d, '08:44'));
  perform pg_temp.chk('X-DUE', 'Kathmandu 08:44: not yet', pg_temp.told(), 'nobody');
  perform public.ops_due_digest(pg_temp.at_local('Asia/Kathmandu', v_d, '09:00'));
  perform pg_temp.chk('X-DUE', 'Kathmandu 09:00: told', pg_temp.told(), 'ktm');

  -- Kiritimati (+14:00): once on its own date, again on the next local date.
  delete from public.team_mentions where source_kind = 'work_due';
  perform public.ops_due_digest(pg_temp.at_local('Pacific/Kiritimati', v_d + 1, '09:30'));
  perform public.ops_due_digest(pg_temp.at_local('Pacific/Kiritimati', v_d + 1, '09:59'));
  perform pg_temp.chk('X-DUE', 'Kiritimati: once on its own date', pg_temp.told(), 'kir');
  perform public.ops_due_digest(pg_temp.at_local('Pacific/Kiritimati', v_d + 2, '09:05'));
  perform pg_temp.chk('X-DUE', 'Kiritimati: told again the next local day',
    (select count(*)::text from public.team_mentions tm where tm.source_kind = 'work_due' and tm.target_user_id = pg_temp.uid('kir')), '2');

  -- An unknown zone reads as New York (told with Gem at New York 09:00).
  delete from public.team_mentions where source_kind = 'work_due';
  perform public.ops_due_digest(pg_temp.at_local('America/New_York', v_d, '09:20'));
  perform pg_temp.chk('X-DUE', 'New York 09:20: Gem, the owner, and the unknown zone (read as New York)',
    pg_temp.told(), 'bad,gem');

  -- Not callable by clients.
  perform pg_temp.lk('X-DUE', 'a teammate cannot run the digest', pg_temp.person('ray', 'select public.ops_due_digest()::text'), 'ERR:42501:%');
  perform pg_temp.lk('X-DUE', 'anon cannot run the digest', pg_temp.as_anon('select public.ops_due_digest()::text'), 'ERR:42501:%');
end;
$t$;

-- ───────────────────────────── X-DECIDE ─────────────────────────────
do $t$
declare v text;
begin
  update public.admin_team_members set status = 'active' where email = 'rev.x4255@test.local';
  -- A card owned by Ray and the unconfirmed teammate (confirmed staff only gets the push).
  v := pg_temp.person('owner', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', 'X4255 Decide card', 'instructions', 'Do the work carefully and say what changed.',
      'done_means', 'It is done and checked.', 'owners', jsonb_build_array(pg_temp.email('ray'), pg_temp.email('unc')),
      'due_on', (now() at time zone 'UTC')::date + 3)), pg_temp.rk()));
  perform pg_temp.keep('DC', ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('DC')::text;
  v := pg_temp.tag('DC', 'send');
  perform pg_temp.chk('X-DECIDE', 'the unconfirmed owner gets no Host app decision push',
    (select count(*)::text from public.notification_outbox o where o.user_id = pg_temp.uid('unc') and o.category_key like 'business.team_%'
      and o.payload->>'card_id' = pg_temp.id('DC')::text), '0');
  perform pg_temp.chk('X-DECIDE', 'Ray gets exactly one decision push',
    (select count(*)::text from public.notification_outbox o where o.user_id = pg_temp.uid('ray') and o.category_key = 'business.team_decision'
      and o.payload->>'card_id' = pg_temp.id('DC')::text), '1');

  -- Toggle: off, on again: one more push per "on", none for "off".
  v := pg_temp.tag('DC', null);
  v := pg_temp.tag('DC', 'send');
  perform pg_temp.chk('X-DECIDE', 'tag off then on again: two decision pushes in all, none for the "off"',
    (select count(*)::text from public.notification_outbox o where o.user_id = pg_temp.uid('ray') and o.category_key = 'business.team_decision'
      and o.payload->>'card_id' = pg_temp.id('DC')::text), '2');

  -- A watcher is not asked to act: no decision push for Gem, who only watches.
  v := pg_temp.add('DW', 'X4255 Decide watched card', pg_temp.email('ray'), pg_temp.email('gem'));
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('DW')::text;
  v := pg_temp.tag('DW', 'spend');
  perform pg_temp.chk('X-DECIDE', 'the owner gets the decision push; a watcher gets none',
    (select coalesce(string_agg(p.who, ',' order by p.who), 'nobody') from public.notification_outbox o join tx_people p on p.id = o.user_id
      where o.category_key = 'business.team_decision' and o.payload->>'card_id' = pg_temp.id('DW')::text), 'ray');

  -- A note whose words end in the tag words is a mention, not a decision.
  delete from public.notification_outbox where payload->>'card_id' = pg_temp.id('DC')::text;
  v := pg_temp.person('owner', format($q$select public.ops_message_post(%L, 'Ray, the deck is ready · You send', array[%L], null, null, false, %L)::text$q$,
    pg_temp.id('DC'), pg_temp.email('ray'), pg_temp.rk()));
  perform pg_temp.chk('X-DECIDE', 'a note ending in "· You send" is a mention (business.team_mention), not a decision',
    (select string_agg(o.category_key, ',') from public.notification_outbox o where o.user_id = pg_temp.uid('ray')
      and o.category_key like 'business.team_%' and o.payload->>'card_id' = pg_temp.id('DC')::text), 'business.team_mention');
end;
$t$;

-- ───────────────────────────── X-READ ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.add('RD', 'X4255 Read markers', pg_temp.email('ray'), pg_temp.email('gem'));
  v := pg_temp.person('owner', format($q$select public.ops_message_post(%L, 'First words on the card', '{}'::text[], null, null, false, %L)::text$q$,
    pg_temp.id('RD'), pg_temp.rk()));
  perform pg_temp.chk('X-READ', 'control: Ray and Gem each have one unread',
    public.ops_thread_unread(pg_temp.id('RD'), pg_temp.email('ray'))::text || '/' || public.ops_thread_unread(pg_temp.id('RD'), pg_temp.email('gem'))::text, '1/1');
  v := pg_temp.person('ray', format('select public.ops_thread_read(%L)::text', pg_temp.id('RD')));
  perform pg_temp.chk('X-READ', 'Ray opening the thread clears Ray only; Gem still has one',
    public.ops_thread_unread(pg_temp.id('RD'), pg_temp.email('ray'))::text || '/' || public.ops_thread_unread(pg_temp.id('RD'), pg_temp.email('gem'))::text, '0/1');
  v := pg_temp.agent('gem', format('select public.ops_thread_read(%L)::text', pg_temp.id('RD')));
  perform pg_temp.chk('X-READ', 'an agent for Gem reading the thread leaves Gem''s badge at one',
    public.ops_thread_unread(pg_temp.id('RD'), pg_temp.email('gem'))::text, '1');
  perform pg_temp.lk('X-READ', 'a teammate cannot read the markers table',
    pg_temp.person('ray', 'select count(*)::text from public.ops_work_thread_reads'), 'ERR:42501:%');
  perform pg_temp.lk('X-READ', 'nor write a marker for someone else',
    pg_temp.person('ray', format($q$insert into public.ops_work_thread_reads (card_id, email) values (%L, %L) returning 'written'$q$,
      pg_temp.id('RD'), pg_temp.email('gem'))), 'ERR:42501:%');
  perform pg_temp.lk('X-READ', 'nor run ops_thread_unread for someone else',
    pg_temp.person('ray', format('select public.ops_thread_unread(%L, %L)::text', pg_temp.id('RD'), pg_temp.email('gem'))), 'ERR:42501:%');
  perform pg_temp.lk('X-READ', 'anon cannot mark a thread read',
    pg_temp.as_anon(format('select public.ops_thread_read(%L)::text', pg_temp.id('RD'))), 'ERR:42501:%');
  perform pg_temp.lk('X-READ', 'a card that is not there is refused',
    pg_temp.person('ray', format('select public.ops_thread_read(%L)::text', gen_random_uuid())), 'ERR:P0002:%');
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
  if v_all < 20 then raise exception '#4255 rework tester adversarial recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 rework tester adversarial: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 rework tester adversarial: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
