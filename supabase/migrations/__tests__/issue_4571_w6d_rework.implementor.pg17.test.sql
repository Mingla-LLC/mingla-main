-- Issue #4571 rework (after the final test, FAIL at ffcb44bc6d) -- implementor
-- suite for 20281126094571_issue_4571_w6d_rework.sql on the fully replayed
-- PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-demo-before-demo-booked | gate crm_record_unmerge + crm_4571_demo_stage_guard | test this file
--
--   UNDO-DEMO  the tester's repro: duplicate D at Demo booked with a linked
--              demo, kept K at Replied; merge moves K to Demo booked; undo is
--              refused (demo_in_use) and writes nothing; K moved back to
--              Replied, the undo works and D keeps its demo. A kept card with
--              its own demo undoes freely.
--   MAIL       merge moves D's crm_email_log rows to K (a message K already
--              has stays on D); undo moves them back.
--   STAGE-AT   a call dated before the move to Replied counts in Contacted
--              (cadence_sweep.py's history rule); a call dated now is Replied.
--   NUMBERS    Emails sent counts hand-logged email touches, once when the
--              mail log has the same card's mail that day.
--   CONFIG     the report card is kept when not passed; the cron entry exists
--              only in Dry run or On (ships unscheduled).
--   INGEST     a bad email identifier still matches (Mac script parity).
--
-- FAILS-ON-REVERT: without the demo_in_use block UNDO-DEMO fails (K left in
-- meeting with no demo); without the crm_email_log UPDATEs MAIL fails;
-- without the history branch in ops_4571_activity_stage_at STAGE-AT fails;
-- without the hand CTE NUMBERS fails; with the old configure CONFIG fails.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45770000-0000-4000-c000-000000000001', 'seth.w6d4571@test.local'),
  ('tao',  '45770000-0000-4000-c000-000000000002', 'tao.w6d4571@test.local'),
  ('kemi', '45770000-0000-4000-c000-000000000003', 'kemi.w6d4571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('seth.w6d4571@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who <> 'seth';

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
create function pg_temp.agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'move_stage', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.svc(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role service_role;
    -- Signed out: no person's claims carry over from an earlier call.
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
create function pg_temp.try(p_sql text) returns text
language plpgsql as $fn$
begin
  begin
    execute p_sql;
    return 'OK';
  exception when others then
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
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
create function pg_temp.stage(p_k text) returns text language sql as $fn$ select stage from public.crm_records where id = pg_temp.id(p_k) $fn$;
create function pg_temp.move(p_who text, p_k text, p_to text, p_reason text default null) returns text
language sql as $fn$
  select pg_temp.person(p_who, format('select public.crm_record_move_stage(%L::uuid, %L, %L, null)::text', pg_temp.id(p_k), p_to, p_reason))
$fn$;
-- A host card owned by tao, at a stage below the band (the trigger refuses an insert at meeting or later).
create function pg_temp.host(p_k text, p_name text, p_stage text default 'replied') returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by)
  values (v_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, 'seth.w6d4571@test.local', 'seth.w6d4571@test.local');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (v_id, 'tao.w6d4571@test.local', 'seth.w6d4571@test.local');
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
-- A host booking (/schedule). Never a staff or test address.
create function pg_temp.booking(p_k text, p_name text, p_email text, p_venue text, p_created timestamptz default now(),
                                p_phone text default null, p_audience text default 'host') returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.book_call_leads (id, booking_key, audience, name, email, venue, icp, city, creator_makes,
                                      social_platform, social_url, call_at, created_at, phone_e164)
  values (v_id, 'slot:w6d-' || p_k, p_audience, p_name, p_email, case when p_audience = 'host' then p_venue end,
          case when p_audience = 'host' then 'restaurants' end, case when p_audience = 'host' then null else 'Lagos' end,
          case when p_audience = 'creator' then 'video' end,
          'instagram', 'https://instagram.com/' || p_k, p_created + interval '2 days', p_created, p_phone);
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
create function pg_temp.link_token(p_booking text, p_card text) returns text
language sql as $fn$
  select pg_temp.svc(format('select public.crm_demo_link_from_token(%L, %L::uuid)::text',
    'slot:w6d-' || p_booking, (select schedule_token from public.crm_records where id = pg_temp.id(p_card))))
$fn$;
create function pg_temp.gw(p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform pg_temp.next_request();
  begin
    set local role service_role;
    execute format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_tool, p_args, 'w6d4571-test/1.0') into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.call(p_who text, p_card text, p_at timestamptz) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, occurred_at, created_at)
  values (pg_temp.id(p_card), 'touch', pg_temp.email(p_who), 'phone', 'outbound', p_at, p_at)
$fn$;

create function pg_temp.rk() returns text language sql as $fn$ select 'w6d-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.add(p_k text, p_title text, p_links jsonb default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'due_on', (now() at time zone 'UTC')::date + 3,
    'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth')));
  if p_links is not null then v_item := v_item || jsonb_build_object('links', p_links); end if;
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.n_act(p_k text, p_kinds text[]) returns text
language sql as $fn$ select count(*)::text from public.crm_activity a where a.record_id = pg_temp.id(p_k) and a.kind = any(p_kinds) $fn$;
create function pg_temp.ident(p_k text, p_kind text, p_value text) returns void
language sql as $fn$
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
  values (pg_temp.id(p_k), p_kind, p_value, public.crm_ident_key(p_kind, p_value), 'seth.w6d4571@test.local')
$fn$;
create function pg_temp.note(p_k text, p_body text) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, body) values (pg_temp.id(p_k), 'note', 'tao.w6d4571@test.local', p_body)
$fn$;
create function pg_temp.board_has(p_k text) returns text
language sql as $fn$
  select (exists (select 1 from jsonb_array_elements((pg_temp.person('tao', $q$select public.crm_records_list('hosts')::text$q$)::jsonb)->'records') r
                  where (r->>'id')::uuid = pg_temp.id(p_k)))::text
$fn$;

create function pg_temp.merge(p_keep text, p_drop text) returns text
language sql as $fn$
  select pg_temp.person('tao', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id(p_keep), pg_temp.id(p_drop), pg_temp.rk()))
$fn$;
create function pg_temp.unmerge(p_merge text) returns text
language sql as $fn$
  select pg_temp.person('tao', format('select public.crm_record_unmerge(%L::uuid)::text', p_merge::uuid))
$fn$;
create function pg_temp.mail(p_id text, p_to text, p_dir text default 'outbound', p_at timestamptz default clock_timestamp()) returns text
language sql as $fn$
  select pg_temp.person('tao', format('select public.crm_email_log_ingest(%L, %L::jsonb)::text', 'info@usemingla.com',
    jsonb_build_array(case when p_dir = 'outbound'
      then jsonb_build_object('id', p_id, 'direction', 'outbound', 'from', 'Mingla <info@usemingla.com>', 'to', jsonb_build_array(p_to), 'at', p_at, 'subject', 'Hello')
      else jsonb_build_object('id', p_id, 'direction', 'inbound', 'from', p_to, 'to', jsonb_build_array('info@usemingla.com'), 'at', p_at, 'subject', 'Re: Hello') end)))
$fn$;
create function pg_temp.n_mail(p_k text) returns text
language sql as $fn$ select count(*)::text from public.crm_email_log e where e.record_id = pg_temp.id(p_k) $fn$;

-- ───────────────────────────── UNDO-DEMO ─────────────────────────────
do $t$
declare v text; j jsonb; v_merge text;
begin
  perform pg_temp.host('dk', 'Keeper Grill W6d', 'replied');
  perform pg_temp.host('dd', 'Keeper Grill Lagos W6d', 'replied');
  perform pg_temp.booking('db', 'Ada', 'ada@keeper-w6d.test', 'Keeper Grill');
  perform pg_temp.chk('UNDO-DEMO', 'the duplicate links its demo from its token', pg_temp.link_token('db', 'dd'), 'true');
  v := pg_temp.move('tao', 'dd', 'meeting');
  perform pg_temp.chk('UNDO-DEMO', 'the duplicate is at Demo booked', pg_temp.stage('dd'), 'meeting');
  j := pg_temp.merge('dk', 'dd')::jsonb;
  v_merge := j->>'merge_id';
  perform pg_temp.chk('UNDO-DEMO', 'the merge moves the kept card to Demo booked', pg_temp.stage('dk') || '|' || coalesce(j->>'stage_to', '-'), 'meeting|meeting');
  v := pg_temp.unmerge(v_merge);
  perform pg_temp.lk('UNDO-DEMO', 'the undo is refused with a plain reason', v,
    'ERR:22023:demo_in_use: Keeper Grill W6d is in Demo booked (Google Meet) on the demo that came from Keeper Grill Lagos W6d, and undoing the merge sends that demo back. Move Keeper Grill W6d back to Replied first, then undo the merge.');
  perform pg_temp.chk('UNDO-DEMO', 'nothing changed: still merged, the kept card keeps the demo and its stage',
    (select (m.unmerged_at is null)::text from public.crm_record_merges m where m.id = v_merge::uuid)
      || '|' || pg_temp.stage('dk') || '|' || public.crm_record_has_demo(pg_temp.id('dk'))::text
      || '|' || (select (archived_at is not null)::text from public.crm_records where id = pg_temp.id('dd')), 'true|meeting|true|true');
  v := pg_temp.move('tao', 'dk', 'replied', 'Undoing a merge');
  perform pg_temp.chk('UNDO-DEMO', 'the person moves the kept card back', pg_temp.stage('dk'), 'replied');
  v := pg_temp.unmerge(v_merge);
  perform pg_temp.chk('UNDO-DEMO', 'then the undo works', (v not like 'ERR:%')::text, 'true');
  perform pg_temp.chk('UNDO-DEMO', 'the demo is back on the duplicate, which is back at Demo booked on the board',
    public.crm_record_has_demo(pg_temp.id('dd'))::text || '|' || public.crm_record_has_demo(pg_temp.id('dk'))::text
      || '|' || pg_temp.stage('dd') || '|' || (select (archived_at is null)::text from public.crm_records where id = pg_temp.id('dd')),
    'true|false|meeting|true');
  perform pg_temp.chk('UNDO-DEMO', 'no host is left in the band without a demo',
    (select count(*)::text from public.crm_records c where c.id in (pg_temp.id('dk'), pg_temp.id('dd'))
        and c.stage in ('meeting','onboarded','live') and c.demo_rule_exempt_at is null and not public.crm_record_has_demo(c.id)), '0');

  -- The kept card has its own booked demo: the undo is free.
  perform pg_temp.host('ok', 'Own Demo Bar W6d', 'replied');
  perform pg_temp.host('od', 'Own Demo Bar Lagos W6d', 'replied');
  perform pg_temp.booking('ob1', 'Bo', 'bo@owndemo-w6d.test', 'Own Demo Bar');
  perform pg_temp.booking('ob2', 'Bo', 'bo2@owndemo-w6d.test', 'Own Demo Bar');
  perform pg_temp.link_token('ob1', 'ok');
  perform pg_temp.link_token('ob2', 'od');
  perform pg_temp.move('tao', 'ok', 'meeting');
  perform pg_temp.move('tao', 'od', 'meeting');
  j := pg_temp.merge('ok', 'od')::jsonb;
  v := pg_temp.unmerge(j->>'merge_id');
  perform pg_temp.chk('UNDO-DEMO', 'a kept card with its own demo undoes freely and keeps Demo booked',
    (v not like 'ERR:%')::text || '|' || pg_temp.stage('ok') || '|' || public.crm_record_has_demo(pg_temp.id('ok'))::text, 'true|meeting|true');
end;
$t$;

-- ───────────────────────────── MAIL ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  perform pg_temp.host('mk', 'Mail Keeper W6d', 'contacted');
  perform pg_temp.host('md', 'Mail Keeper Lagos W6d', 'contacted');
  perform pg_temp.ident('mk', 'email', 'keep@mail-w6d.test');
  perform pg_temp.ident('md', 'email', 'drop@mail-w6d.test');
  perform pg_temp.ident('md', 'email', 'both@mail-w6d.test');
  perform pg_temp.ident('mk', 'email', 'both@mail-w6d.test');
  v := pg_temp.mail('w6d-m1', 'drop@mail-w6d.test');
  v := pg_temp.mail('w6d-m2', 'drop@mail-w6d.test', 'inbound');
  v := pg_temp.mail('w6d-m3', 'both@mail-w6d.test');
  perform pg_temp.chk('MAIL', 'before: the duplicate has three logged emails, the keeper one', pg_temp.n_mail('md') || '/' || pg_temp.n_mail('mk'), '3/1');
  j := pg_temp.merge('mk', 'md')::jsonb;
  perform pg_temp.chk('MAIL', 'the merge moves the two the keeper lacks and says so', j->'moved'->>'emails', '2');
  perform pg_temp.chk('MAIL', 'after: the keeper has three, the shared message stays once on each',
    pg_temp.n_mail('mk') || '/' || pg_temp.n_mail('md'), '3/1');
  perform pg_temp.chk('MAIL', 'the keeper''s reply suggestion reads the moved inbound email',
    (public.crm_record_json((select c from public.crm_records c where c.id = pg_temp.id('mk')))->'suggest_replied'->>'subject'), 'Re: Hello');
  v := pg_temp.unmerge(j->>'merge_id');
  perform pg_temp.chk('MAIL', 'the undo moves them back', (v not like 'ERR:%')::text || '|' || pg_temp.n_mail('md') || '/' || pg_temp.n_mail('mk'), 'true|3/1');
end;
$t$;

-- ───────────────────────────── STAGE-AT ─────────────────────────────
do $t$
declare v_move timestamptz;
begin
  perform pg_temp.host('sa', 'Stage At Cafe W6d', 'contacted');
  perform pg_temp.move('tao', 'sa', 'replied');
  -- The move was made an hour ago, in an earlier request.
  update public.crm_activity set occurred_at = now() - interval '1 hour', created_at = now() - interval '1 hour'
   where record_id = pg_temp.id('sa') and kind = 'stage_move';
  v_move := (select occurred_at from public.crm_activity where record_id = pg_temp.id('sa') and kind = 'stage_move');
  perform pg_temp.call('tao', 'sa', v_move - interval '1 hour');
  perform pg_temp.chk('STAGE-AT', 'a call dated before the move to Replied was made in Contacted',
    (select stage_at from public.crm_activity where record_id = pg_temp.id('sa') and kind = 'touch' and occurred_at < v_move), 'contacted');
  perform pg_temp.call('tao', 'sa', clock_timestamp());
  perform pg_temp.chk('STAGE-AT', 'a call dated now is in Replied',
    (select stage_at from public.crm_activity where record_id = pg_temp.id('sa') and kind = 'touch' and occurred_at > v_move), 'replied');
  perform pg_temp.chk('STAGE-AT', 'the cadence counts the backdated call', (public.crm_cadence_state(pg_temp.id('sa'))->>'calls'), '1');
end;
$t$;

-- ───────────────────────────── NUMBERS ─────────────────────────────
do $t$
declare v text; j jsonb; v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  perform pg_temp.host('na', 'Numbers A W6d', 'contacted');
  perform pg_temp.host('nb', 'Numbers B W6d', 'contacted');
  perform pg_temp.ident('nb', 'email', 'b@numbers-w6d.test');
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, occurred_at)
  values (pg_temp.id('na'), 'touch', pg_temp.email('kemi'), 'email', 'outbound', now()),
         (pg_temp.id('nb'), 'touch', pg_temp.email('kemi'), 'email', 'outbound', now());
  v := pg_temp.mail('w6d-n1', 'b@numbers-w6d.test');
  j := pg_temp.person('tao', format('select public.crm_outreach_numbers(%L::date, %L::date)::text', v_today, v_today))::jsonb;
  perform pg_temp.chk('NUMBERS', 'a hand-logged email touch counts for who logged it; the one the log has is not counted twice',
    (select x->'totals'->>'emails_sent' from jsonb_array_elements(j->'reps') x where x->>'rep' = pg_temp.email('kemi')), '1');
  perform pg_temp.chk('NUMBERS', 'the logged mail counts for the mailbox, once per message',
    (select x->'totals'->>'emails_sent' from jsonb_array_elements(j->'reps') x where x->>'rep' = 'info@usemingla.com'),
    (select count(distinct message_id)::text from public.crm_email_log where direction = 'outbound'));
  perform pg_temp.chk('NUMBERS', 'the team total is the log plus the one hand-logged email',
    j->'totals'->>'emails_sent', (select (count(distinct message_id) + 1)::text from public.crm_email_log where direction = 'outbound'));
end;
$t$;

-- ───────────────────────────── CONFIG ─────────────────────────────
do $t$
declare v text; v_card uuid; v_item jsonb;
begin
  perform pg_temp.chk('CONFIG', 'it ships with no cron entry',
    (select count(*)::text from cron.job where jobname = 'issue_4571_crm_cadence_sweep'), '0');
  v_item := jsonb_build_object('title', 'W6d cadence report card', 'instructions', 'Read the nightly sweep report.',
    'done_means', 'It is read.', 'due_on', (now() at time zone 'UTC')::date + 3,
    'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth')));
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  v_card := ((v::jsonb)->'results'->0->'card'->>'id')::uuid;
  v := pg_temp.person('seth', format('select public.crm_cadence_sweep_configure(%L, %L::uuid)::text', 'dry_run', v_card));
  perform pg_temp.chk('CONFIG', 'Dry run with a report card', (v::jsonb)->>'report_card_id', v_card::text);
  perform pg_temp.chk('CONFIG', 'Dry run schedules the job weekdays at 20:00 UTC',
    (select schedule || '|' || command from cron.job where jobname = 'issue_4571_crm_cadence_sweep'), '0 20 * * 1-5|SELECT public.crm_cadence_sweep_cron()');
  v := pg_temp.person('seth', $q$select public.crm_cadence_sweep_configure('apply')::text$q$);
  perform pg_temp.chk('CONFIG', 'On without a report card keeps the stored one', (v::jsonb)->>'mode' || '|' || ((v::jsonb)->>'report_card_id'), 'apply|' || v_card::text);
  perform pg_temp.chk('CONFIG', 'one job, not two', (select count(*)::text from cron.job where jobname = 'issue_4571_crm_cadence_sweep'), '1');
  v := pg_temp.person('seth', $q$select public.crm_cadence_sweep_configure('off')::text$q$);
  perform pg_temp.chk('CONFIG', 'Off unschedules it and still keeps the report card',
    (select count(*)::text from cron.job where jobname = 'issue_4571_crm_cadence_sweep') || '|' || ((v::jsonb)->>'report_card_id'), '0|' || v_card::text);
end;
$t$;

-- ───────────────────────────── INGEST ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.host('ib', 'Bounced Address W6d', 'contacted');
  perform pg_temp.ident('ib', 'email', 'gone@bounced-w6d.test');
  update public.crm_record_identifiers set status = 'bad', bad_reason = 'bounced', bad_at = now(), bad_by = 'tao.w6d4571@test.local'
   where record_id = pg_temp.id('ib');
  v := pg_temp.mail('w6d-i1', 'gone@bounced-w6d.test');
  perform pg_temp.chk('INGEST', 'mail to a bad address is still logged, as cadence_sweep.py counts it', pg_temp.n_mail('ib'), '1');
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
  if v_all < 25 then raise exception '#4571 rework implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 rework implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 rework implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
