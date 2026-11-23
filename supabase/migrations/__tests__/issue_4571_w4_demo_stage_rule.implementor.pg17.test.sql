-- Issue #4571 W4 (demo bookings and the Demo booked stage rule) -- implementor
-- suite for 20281126044571_issue_4571_w4_demo_bookings_stage_rule.sql on the
-- fully replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-demo-before-demo-booked | gate crm_4571_demo_stage_guard (crm_4571_demo_move_ok) | test this file
-- INVARIANT crm-booking-one-card | gate crm_record_demos_pkey | test this file
-- INVARIANT crm-demo-exempt-clears-on-leaving | gate crm_4571_demo_stage_guard | test this file
--
--   LABEL    meeting reads "Demo booked (Google Meet)"; the id stays meeting.
--   GATE     a host at Replied cannot reach meeting, onboarded or live from a
--            person's move, the connector's move_stage, crm_record_update, a
--            direct write or the #4452 automation (which skips, audited); the
--            refusal is the plain sentence; lost is always allowed; a new
--            host cannot be inserted at meeting or later.
--   EXEMPT   a grandfathered card moves inside the band; leaving it (below
--            meeting, or lost) clears the stamp and coming back is refused.
--   UNDO     undoing a move back into the band without a demo is refused.
--   TOKEN    a booking made with the card's token links itself (service role
--            only); a forged or unknown token, or a creator call, does not; a
--            retried write answers true and adds nothing.
--   ONE      one booking belongs to one card.
--   SUGGEST  the viewer's own call 2 h before to 15 min after the booking
--            ranks first (with minutes before), then email, phone, venue
--            name; the window edges (2 h + 1 s, 15 min + 1 s) are out;
--            another person's call is not the viewer's; a bad email is not
--            matched; no email or phone in any answer.
--   INBOX    Needs linking, its count, the Calendar flag and record agree;
--            staff and test bookings are left out; Confirm, Pick another,
--            Create host card and Not a host each take the booking off.
--   UNLINK   refused while the card sits at Demo booked on that demo alone.
--   RESCHED  a moved booking keeps its link; a cancelled one keeps the card
--            where it is and lists it under Demos cancelled.
--   READS    the card's read carries demos and the token; the connector's
--            get_record carries demos and never the token.
--   GRANTS   no client touches the new tables; internal helpers and the token
--            link are the server's only.
--
-- FAILS-ON-REVERT: on W3 crm_record_demos, the trigger and every crm_demo_*
-- function do not exist; deleting the trigger lets Replied move to meeting.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45740000-0000-4000-c000-000000000001', 'seth.w44571@test.local'),
  ('tao',  '45740000-0000-4000-c000-000000000002', 'tao.w44571@test.local'),
  ('kemi', '45740000-0000-4000-c000-000000000003', 'kemi.w44571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('seth.w44571@test.local', 'owner', 'active', now());
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
  values (v_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, 'seth.w44571@test.local', 'seth.w44571@test.local');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (v_id, 'tao.w44571@test.local', 'seth.w44571@test.local');
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
  values (v_id, 'slot:w4-' || p_k, p_audience, p_name, p_email, case when p_audience = 'host' then p_venue end,
          case when p_audience = 'host' then 'restaurants' end, case when p_audience = 'host' then null else 'Lagos' end,
          case when p_audience = 'creator' then 'video' end,
          'instagram', 'https://instagram.com/' || p_k, p_created + interval '2 days', p_created, p_phone);
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
create function pg_temp.link_token(p_booking text, p_card text) returns text
language sql as $fn$
  select pg_temp.svc(format('select public.crm_demo_link_from_token(%L, %L::uuid)::text',
    'slot:w4-' || p_booking, (select schedule_token from public.crm_records where id = pg_temp.id(p_card))))
$fn$;
create function pg_temp.gw(p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform pg_temp.next_request();
  begin
    set local role service_role;
    execute format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_tool, p_args, 'w44571-test/1.0') into v_out;
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

-- ───────────────────────────── LABEL ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('LABEL', 'meeting reads Demo booked (Google Meet)', public.crm_stage_def('hosts', 'meeting')->>'label', 'Demo booked (Google Meet)');
  perform pg_temp.chk('LABEL', 'its hint names the scheduler link', public.crm_stage_def('hosts', 'meeting')->>'hint', 'A Google Meet booked through the scheduler is linked');
  perform pg_temp.chk('LABEL', 'the stage ids are unchanged',
    (select string_agg(s->>'id', ',') from jsonb_array_elements(public.crm_pipeline_def('hosts')->'stages') s),
    'prospect,contacted,replied,meeting,onboarded,live,lost');
end;
$t$;

-- ───────────────────────────── GATE ─────────────────────────────
do $t$
declare v text; v_key text; v_n integer;
begin
  perform pg_temp.host('rb', 'Replied Bar');
  v := pg_temp.move('tao', 'rb', 'meeting');
  perform pg_temp.chk('GATE', 'a person cannot move Replied to Demo booked without a linked demo', v,
    'ERR:22023:demo_required: Demo booked needs a Google Meet booked through the scheduler and linked to this card. Send the card''s scheduler link, or link the booking on Needs linking.');
  perform pg_temp.lk('GATE', 'nor to Onboarded', pg_temp.move('tao', 'rb', 'onboarded'), 'ERR:22023:demo_required:%');
  perform pg_temp.lk('GATE', 'nor to Live by a direct write (Live sets itself; the rule still holds)',
    pg_temp.try(format('update public.crm_records set stage = %L where id = %L', 'live', pg_temp.id('rb'))), 'ERR:22023:demo_required:%');
  perform pg_temp.lk('GATE', 'a direct write to meeting is refused too',
    pg_temp.try(format('update public.crm_records set stage = %L where id = %L', 'meeting', pg_temp.id('rb'))), 'ERR:22023:demo_required:%');
  perform pg_temp.lk('GATE', 'crm_record_update never moves a stage',
    pg_temp.person('tao', format($q$select public.crm_record_update(%L::uuid, '{"stage":"meeting"}'::jsonb)::text$q$, pg_temp.id('rb'))), 'ERR:%');
  perform pg_temp.lk('GATE', 'an agent of the person is refused the same way',
    pg_temp.agent('tao', format('select public.crm_record_move_stage(%L::uuid, %L, null, %L)::text', pg_temp.id('rb'), 'meeting', 'replied')), 'ERR:22023:demo_required:%');
  -- The connector's move_stage, through the real gateway.
  v := pg_temp.person('tao', $q$select public.team_agent_key_create('claude')::text$q$);
  if v like 'ERR:%' then raise exception 'key not made: %', v; end if;
  v_key := (v::jsonb)->>'key';
  v := pg_temp.gw(v_key, 'move_stage',
         jsonb_build_object('moves', jsonb_build_array(jsonb_build_object('id', pg_temp.id('rb'), 'to', 'meeting', 'expected_from', 'replied'))));
  perform pg_temp.lk('GATE', 'the connector''s move_stage answers demo_required for the item', v, '%demo_required%');
  perform pg_temp.lk('GATE', 'and its answer is the plain sentence', v, '%Send the card''s scheduler link, or link the booking on Needs linking.%');
  perform pg_temp.chk('GATE', 'the card stayed at Replied', pg_temp.stage('rb'), 'replied');
  -- The #4452 form automation skips, never forced, and says so.
  select count(*) into v_n from public.admin_audit_log where action = 'crm.stage_move_skipped' and target_id = pg_temp.id('rb')::text;
  perform pg_temp.chk('GATE', 'the form automation skips a move the rule refuses, without an error',
    pg_temp.try(format('select public.forms_move_stage(%L::uuid, %L, %L)', pg_temp.id('rb'), 'meeting', 'form-hosts')), 'OK');
  perform pg_temp.chk('GATE', 'the automation left the card at Replied', pg_temp.stage('rb'), 'replied');
  perform pg_temp.chk('GATE', 'and the skip is audited with its reason',
    (select string_agg(metadata->>'reason', ',') from public.admin_audit_log where action = 'crm.stage_move_skipped' and target_id = pg_temp.id('rb')::text),
    'demo_required');
  perform pg_temp.chk('GATE', 'the automation still moves below the band', pg_temp.try(format('select public.forms_move_stage(%L::uuid, %L, %L)', pg_temp.id('rb'), 'contacted', 'form-hosts')) || '/' || pg_temp.stage('rb'), 'OK/contacted');
  update public.crm_records set stage = 'replied' where id = pg_temp.id('rb');
  -- Lost is always allowed.
  perform pg_temp.lk('GATE', 'a move to Lost is never refused', pg_temp.move('tao', 'rb', 'lost', 'They closed'), '{%');
  perform pg_temp.chk('GATE', 'the card is Lost', pg_temp.stage('rb'), 'lost');
  -- A new host cannot start at meeting or later.
  perform pg_temp.lk('GATE', 'a new host cannot be inserted at Demo booked',
    pg_temp.try($q$insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values ('hosts', 'Straight In', 'meeting', 'x', 'x')$q$),
    'ERR:22023:demo_required:%');
  perform pg_temp.lk('GATE', 'nor at Onboarded',
    pg_temp.try($q$insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values ('hosts', 'Straight In', 'onboarded', 'x', 'x')$q$),
    'ERR:22023:demo_required:%');
  perform pg_temp.chk('GATE', 'a new card may be written below the band',
    pg_temp.try($q$insert into public.crm_records (pipeline, name, stage, created_by, updated_by, demo_rule_exempt_at) values ('hosts', 'Sneaky Start', 'replied', 'x', 'x', now())$q$), 'OK');
  perform pg_temp.chk('GATE', 'but it never starts exempt',
    (select (demo_rule_exempt_at is null)::text from public.crm_records where name = 'Sneaky Start'), 'true');
  perform pg_temp.chk('GATE', 'creators are not touched by the rule',
    pg_temp.try($q$insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values ('creators', 'Free Creator', 'identified', 'x', 'x')$q$), 'OK');
end;
$t$;

-- ───────────────────────────── EXEMPT ─────────────────────────────
do $t$
begin
  -- A card that was at Demo booked when W4 was applied (as the migration stamps it).
  alter table public.crm_records disable trigger crm_4571_demo_stage_guard;
  perform pg_temp.host('gf', 'Grandfather Grill');
  update public.crm_records set stage = 'meeting', demo_rule_exempt_at = now() - interval '1 day' where id = pg_temp.id('gf');
  perform pg_temp.host('gl', 'Grandfather Lounge');
  update public.crm_records set stage = 'onboarded', demo_rule_exempt_at = now() - interval '1 day' where id = pg_temp.id('gl');
  alter table public.crm_records enable trigger crm_4571_demo_stage_guard;

  perform pg_temp.lk('EXEMPT', 'a grandfathered card moves up inside the band', pg_temp.move('tao', 'gf', 'onboarded'), '{%');
  perform pg_temp.lk('EXEMPT', 'and back down inside it', pg_temp.move('tao', 'gf', 'meeting'), '{%');
  perform pg_temp.chk('EXEMPT', 'it keeps its stamp inside the band', (select (demo_rule_exempt_at is not null)::text from public.crm_records where id = pg_temp.id('gf')), 'true');
  perform pg_temp.lk('EXEMPT', 'it may leave the band', pg_temp.move('tao', 'gf', 'replied'), '{%');
  perform pg_temp.chk('EXEMPT', 'leaving clears the stamp', (select (demo_rule_exempt_at is null)::text from public.crm_records where id = pg_temp.id('gf')), 'true');
  perform pg_temp.lk('EXEMPT', 'coming back now needs a demo', pg_temp.move('tao', 'gf', 'meeting'), 'ERR:22023:demo_required:%');
  perform pg_temp.lk('EXEMPT', 'Lost from the band is allowed', pg_temp.move('tao', 'gl', 'lost', 'Closed for good'), '{%');
  perform pg_temp.chk('EXEMPT', 'and clears the stamp', (select (demo_rule_exempt_at is null)::text from public.crm_records where id = pg_temp.id('gl')), 'true');
  perform pg_temp.lk('EXEMPT', 'so a Lost card cannot come straight back to Onboarded', pg_temp.move('tao', 'gl', 'onboarded'), 'ERR:22023:demo_required:%');
  perform pg_temp.chk('EXEMPT', 'crm_demo_stage_allowed answers the same test',
    public.crm_demo_stage_allowed(pg_temp.id('gl'), 'onboarded')::text || '/' || public.crm_demo_stage_allowed(pg_temp.id('gl'), 'contacted')::text, 'false/true');
end;
$t$;

-- ───────────────────────────── TOKEN and ONE ─────────────────────────────
do $t$
declare v text; v_n integer;
begin
  perform pg_temp.host('tk', 'Token Terrace');
  perform pg_temp.host('t2', 'Second Card');
  perform pg_temp.booking('btk', 'Femi Ade', 'femi@terrace.ng', 'Token Terrace Ltd');
  perform pg_temp.chk('TOKEN', 'the token is not the record id', ((select schedule_token from public.crm_records where id = pg_temp.id('tk')) <> pg_temp.id('tk'))::text, 'true');
  perform pg_temp.lk('TOKEN', 'a signed-in person cannot call the token link',
    pg_temp.person('tao', format('select public.crm_demo_link_from_token(%L, %L::uuid)::text', 'slot:w4-btk', gen_random_uuid())), 'ERR:42501:%');
  perform pg_temp.chk('TOKEN', 'a forged token books normally and links nothing',
    pg_temp.svc(format('select public.crm_demo_link_from_token(%L, %L::uuid)::text', 'slot:w4-btk', gen_random_uuid())), 'false');
  perform pg_temp.chk('TOKEN', 'an unknown booking links nothing',
    pg_temp.svc(format('select public.crm_demo_link_from_token(%L, %L::uuid)::text', 'slot:w4-nothing', (select schedule_token from public.crm_records where id = pg_temp.id('tk')))), 'false');
  perform pg_temp.chk('TOKEN', 'the forged booking waits on Needs linking', public.crm_demo_needs_linking(pg_temp.id('btk'))::text, 'true');
  perform pg_temp.chk('TOKEN', 'the card''s own token links the booking', pg_temp.link_token('btk', 'tk'), 'true');
  perform pg_temp.chk('TOKEN', 'as card_link, by nobody', (select link_source || '/' || coalesce(linked_by, '<none>') from public.crm_record_demos where booking_id = pg_temp.id('btk')), 'card_link/<none>');
  perform pg_temp.chk('TOKEN', 'a retried booking write answers true and adds nothing',
    pg_temp.link_token('btk', 'tk') || '/' || (select count(*)::text from public.crm_record_demos where booking_id = pg_temp.id('btk')), 'true/1');
  perform pg_temp.chk('TOKEN', 'the card says so in its log',
    (select count(*)::text from public.crm_activity where record_id = pg_temp.id('tk') and kind = 'note' and body like '%scheduler link%'), '1');
  perform pg_temp.chk('TOKEN', 'it is off Needs linking', public.crm_demo_needs_linking(pg_temp.id('btk'))::text, 'false');
  perform pg_temp.lk('TOKEN', 'now the card can move to Demo booked', pg_temp.move('tao', 'tk', 'meeting'), '{%');
  perform pg_temp.chk('TOKEN', 'and it is there', pg_temp.stage('tk'), 'meeting');
  -- A creator call is never linked by a token.
  perform pg_temp.booking('bcr', 'Ngozi Films', 'ngozi@films.ng', null, now(), '+2348090000001', 'creator');
  perform pg_temp.chk('TOKEN', 'a creator call is never linked by a card token', pg_temp.link_token('bcr', 't2'), 'false');
  -- ONE: the same booking cannot go to a second card.
  perform pg_temp.chk('ONE', 'the token of another card does not steal a linked booking', pg_temp.link_token('btk', 't2'), 'false');
  v := pg_temp.person('tao', format('select public.crm_demo_link(%L::uuid, %L::uuid, %L)::text', pg_temp.id('btk'), pg_temp.id('t2'), 'picked'));
  perform pg_temp.chk('ONE', 'a person cannot link a booking that belongs to another card', v,
    'ERR:22023:booking_linked: This demo is already linked to Token Terrace. Unlink it there first.');
  begin
    insert into public.crm_record_demos (booking_id, record_id, link_source, linked_by) values (pg_temp.id('btk'), pg_temp.id('t2'), 'picked', 'x');
    perform pg_temp.chk('ONE', 'the table refuses a second card for one booking', 'stored', 'refused');
  exception when unique_violation then
    perform pg_temp.chk('ONE', 'the table refuses a second card for one booking', 'refused', 'refused');
  end;
end;
$t$;

-- ───────────────────────────── SUGGEST ─────────────────────────────
do $t$
declare v text; v_t timestamptz := now() - interval '1 hour';
begin
  perform pg_temp.host('sa', 'Called Cafe', 'contacted');      -- tao called 12 minutes before
  perform pg_temp.host('sb', 'Too Early Bar', 'contacted');    -- 2 h + 1 s before: out
  perform pg_temp.host('sc', 'Too Late Bar', 'contacted');     -- 15 min + 1 s after: out
  perform pg_temp.host('sd', 'Edge Early', 'contacted');       -- 2 h - 1 s before: in
  perform pg_temp.host('se', 'Edge Late', 'contacted');        -- 15 min - 1 s after: in
  perform pg_temp.host('sk', 'Kemis Call', 'contacted');       -- kemi's call, not tao's
  perform pg_temp.host('sm', 'Mail Match', 'contacted');
  perform pg_temp.host('sp', 'Phone Match', 'contacted');
  perform pg_temp.host('sv', 'The Vault Lounge', 'contacted');
  perform pg_temp.host('sx', 'Bad Mail Match', 'contacted');
  perform pg_temp.booking('bsg', 'Ngozi Bello', 'ngozi@vaultlounge.ng', 'The Vault Lounge', v_t, '+2348012345678');
  perform pg_temp.call('tao', 'sa', v_t - interval '12 minutes');
  perform pg_temp.call('tao', 'sb', v_t - interval '2 hours 1 second');
  perform pg_temp.call('tao', 'sc', v_t + interval '15 minutes 1 second');
  perform pg_temp.call('tao', 'sd', v_t - interval '1 hour 59 minutes 59 seconds');
  perform pg_temp.call('tao', 'se', v_t + interval '14 minutes 59 seconds');
  perform pg_temp.call('kemi', 'sk', v_t - interval '5 minutes');
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
    (pg_temp.id('sm'), 'email', 'Ngozi@VaultLounge.ng', public.crm_ident_key('email', 'Ngozi@VaultLounge.ng'), 'x'),
    (pg_temp.id('sp'), 'phone', '0801 234 5678', public.crm_ident_key('phone', '0801 234 5678'), 'x');
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by, status, bad_reason, bad_at, bad_by) values
    (pg_temp.id('sx'), 'email', 'ngozi@vaultlounge.ng', public.crm_ident_key('email', 'ngozi@vaultlounge.ng'), 'x', 'bad', 'bounced', now(), 'x');

  v := pg_temp.person('tao', format('select public.crm_demo_suggestions(%L::uuid)::text', pg_temp.id('bsg')));
  perform pg_temp.chk('SUGGEST', 'the viewer''s own call ranks first, then email, phone and venue name; the edges decide',
    (select string_agg((e->>'name') || ':' || (e->>'reason'), ', ' order by o) from jsonb_array_elements(v::jsonb) with ordinality t(e, o)),
    'Edge Late:your_call, Called Cafe:your_call, Edge Early:your_call, Mail Match:email, Phone Match:phone, The Vault Lounge:venue_name');
  perform pg_temp.chk('SUGGEST', 'your_call says how many minutes before the booking the call was logged',
    (select e->>'minutes_before' from jsonb_array_elements(v::jsonb) e where e->>'name' = 'Called Cafe'), '12');
  perform pg_temp.chk('SUGGEST', 'a call just after the booking is a negative number of minutes before',
    (select e->>'minutes_before' from jsonb_array_elements(v::jsonb) e where e->>'name' = 'Edge Late'), '-15');
  perform pg_temp.chk('SUGGEST', 'no email and no phone in the answer', (v like '%@%' or v like '%vaultlounge%' or v like '%2345678%')::text, 'false');
  perform pg_temp.chk('SUGGEST', 'a call 2 h 1 s before is out, as is one 15 min 1 s after, and a bad email is never matched',
    (v like '%Too Early%' or v like '%Too Late%' or v like '%Bad Mail%')::text, 'false');
  perform pg_temp.chk('SUGGEST', 'a call 2 h less 1 s before counts, 119 minutes before',
    (select e->>'minutes_before' from jsonb_array_elements(v::jsonb) e where e->>'name' = 'Edge Early'), '120');
  v := pg_temp.person('kemi', format('select public.crm_demo_suggestions(%L::uuid)::text', pg_temp.id('bsg')));
  perform pg_temp.chk('SUGGEST', 'another viewer sees their own call first, not tao''s',
    (select (e->>'name') || ':' || (e->>'reason') from jsonb_array_elements(v::jsonb) with ordinality t(e, o) where o = 1), 'Kemis Call:your_call');
  perform pg_temp.chk('SUGGEST', 'and never tao''s calls as theirs', (v like '%Called Cafe%')::text, 'false');
  perform pg_temp.chk('SUGGEST', 'a creator call is never matched to a host',
    pg_temp.person('tao', format('select public.crm_demo_suggestions(%L::uuid)::text', pg_temp.id('bcr'))), '[]');
  perform pg_temp.lk('SUGGEST', 'nobody signed out of leads and the Hosts area may ask',
    pg_temp.svc(format('select public.crm_demo_suggestions(%L::uuid)::text', pg_temp.id('bsg'))), 'ERR:42501:forbidden:%');
end;
$t$;

-- ───────────────────────────── INBOX ─────────────────────────────
do $t$
declare v text; v_cal text;
begin
  perform pg_temp.booking('bnew', 'Kunle Ade', 'kunle@sunsetroof.ng', 'Sunset Roof');
  perform pg_temp.booking('bnot', 'Random Caller', 'random@caller.ng', 'Not A Venue');
  perform pg_temp.booking('btest', 'Staff Check', 'seth.w44571@test.local', 'Staff Place');
  v := pg_temp.person('tao', 'select public.crm_demo_inbox()::text');
  perform pg_temp.chk('INBOX', 'the count is the list''s length', (v::jsonb)->>'count', jsonb_array_length((v::jsonb)->'needs_linking')::text);
  perform pg_temp.chk('INBOX', 'the banner count is the same number', pg_temp.person('tao', 'select public.crm_demo_inbox_count()::text'), (v::jsonb)->>'count');
  perform pg_temp.chk('INBOX', 'a staff or test booking is left out', (v like '%Staff Place%')::text, 'false');
  perform pg_temp.chk('INBOX', 'the unlinked bookings are listed, the linked one is not',
    ((v like '%Sunset Roof%') and (v like '%Not A Venue%') and (v like '%The Vault Lounge%') and not (v like '%Token Terrace Ltd%'))::text, 'true');
  perform pg_temp.chk('INBOX', 'no email and no phone anywhere in the inbox', (v like '%@%' or v like '%2345678%' or v like '%sunsetroof%')::text, 'false');
  perform pg_temp.chk('INBOX', 'each booking carries the viewer''s suggestions',
    (select e->'suggestions'->0->>'reason' from jsonb_array_elements((v::jsonb)->'needs_linking') e where e->>'booking_id' = pg_temp.id('bsg')::text), 'your_call');
  -- The Calendar reads the same rule.
  v_cal := pg_temp.person('seth', format('select public.admin_calendar_calls(%L::timestamptz, %L::timestamptz, true)::text', now() - interval '3 days', now() + interval '5 days'));
  perform pg_temp.chk('INBOX', 'the Calendar flags the same bookings as Needs linking',
    (select string_agg(e->>'id', ',' order by e->>'id') from jsonb_array_elements((v_cal::jsonb)->'rows') e where (e->>'needs_linking')::boolean),
    (select string_agg(e->>'booking_id', ',' order by e->>'booking_id') from jsonb_array_elements((v::jsonb)->'needs_linking') e));
  perform pg_temp.chk('INBOX', 'and names the card of a linked booking',
    (select e->'record'->>'name' from jsonb_array_elements((v_cal::jsonb)->'rows') e where e->>'id' = pg_temp.id('btk')::text), 'Token Terrace');
  -- Confirm the top suggestion.
  v := pg_temp.person('tao', format('select public.crm_demo_link(%L::uuid, %L::uuid, %L)::text', pg_temp.id('bsg'), pg_temp.id('sa'), 'confirmed_suggestion'));
  perform pg_temp.chk('INBOX', 'Confirm links the booking to the suggested card', (v::jsonb)->>'changed', 'true');
  perform pg_temp.chk('INBOX', 'as a confirmed suggestion, by the person',
    (select link_source || '/' || linked_by from public.crm_record_demos where booking_id = pg_temp.id('bsg')), 'confirmed_suggestion/tao.w44571@test.local');
  perform pg_temp.chk('INBOX', 'confirming twice changes nothing',
    (pg_temp.person('tao', format('select public.crm_demo_link(%L::uuid, %L::uuid, %L)::text', pg_temp.id('bsg'), pg_temp.id('sa'), 'confirmed_suggestion'))::jsonb)->>'changed', 'false');
  perform pg_temp.lk('INBOX', 'an agent cannot link a demo',
    pg_temp.agent('tao', format('select public.crm_demo_link(%L::uuid, %L::uuid, %L)::text', pg_temp.id('bnew'), pg_temp.id('sa'), 'picked')), 'ERR:42501:needs_a_person:%');
  perform pg_temp.lk('INBOX', 'only confirmed_suggestion or picked',
    pg_temp.person('tao', format('select public.crm_demo_link(%L::uuid, %L::uuid, %L)::text', pg_temp.id('bnew'), pg_temp.id('sa'), 'card_link')), 'ERR:22023:invalid_arguments:%');
  -- Not a host.
  v := pg_temp.person('tao', format('select public.crm_demo_not_a_host(%L::uuid)::text', pg_temp.id('bnot')));
  perform pg_temp.chk('INBOX', 'Not a host takes the booking off the list', public.crm_demo_needs_linking(pg_temp.id('bnot'))::text, 'false');
  -- Create host card.
  v := pg_temp.person('tao', format('select public.crm_demo_create_record(%L::uuid)::text', pg_temp.id('bnew')));
  perform pg_temp.chk('INBOX', 'Create host card makes a host named after the venue and links the demo',
    (v::jsonb)->>'status' || '/' || ((v::jsonb)->'record'->>'name') || '/' ||
    (select link_source from public.crm_record_demos where booking_id = pg_temp.id('bnew')), 'created/Sunset Roof/created_from_booking');
  perform pg_temp.chk('INBOX', 'the new card is the caller''s, with the booking''s email as a contact',
    ((v::jsonb)->'record'->'owners'->>0) || '/' ||
    (select count(*)::text from public.crm_record_identifiers i where i.record_id = ((v::jsonb)->'record'->>'id')::uuid and i.kind = 'email'),
    'tao.w44571@test.local/1');
  perform pg_temp.chk('INBOX', 'and it starts at the first stage, with Demo booked unlocked',
    ((v::jsonb)->'record'->>'stage') || '/' || ((v::jsonb)->'record'->'demo_gate'->>'locked'), 'prospect/false');
  perform pg_temp.booking('bdup', 'Kunle Again', 'kunle2@sunsetroof.ng', 'Sunset Roof');
  v := pg_temp.person('tao', format('select public.crm_demo_create_record(%L::uuid)::text', pg_temp.id('bdup')));
  perform pg_temp.chk('INBOX', 'a second booking for the same venue links the existing card, never a second one',
    (v::jsonb)->>'status' || '/' || (select count(*)::text from public.crm_records where pipeline = 'hosts' and name = 'Sunset Roof' and deleted_at is null), 'linked_existing/1');
  v := pg_temp.person('tao', 'select public.crm_demo_inbox()::text');
  perform pg_temp.chk('INBOX', 'each decision took its booking off the list',
    ((v like '%Sunset Roof%') or (v like '%Not A Venue%') or (v like '%The Vault Lounge%'))::text, 'false');
  perform pg_temp.chk('INBOX', 'the banner follows', pg_temp.person('tao', 'select public.crm_demo_inbox_count()::text'), (v::jsonb)->>'count');
  perform pg_temp.chk('INBOX', 'a grandfathered card that left Demo booked is not listed as without a demo',
    (select string_agg(e->>'name', ',') from jsonb_array_elements((v::jsonb)->'without_demo') e where e->>'name' like 'Grandfather%'), null);
end;
$t$;

-- ───────────────────────────── WITHOUT, UNLINK, RESCHED ─────────────────────────────
do $t$
declare v text; v_act uuid;
begin
  alter table public.crm_records disable trigger crm_4571_demo_stage_guard;
  perform pg_temp.host('wd', 'Hand Moved Hall');
  update public.crm_records set stage = 'meeting', demo_rule_exempt_at = now() where id = pg_temp.id('wd');
  alter table public.crm_records enable trigger crm_4571_demo_stage_guard;
  v := pg_temp.person('tao', 'select public.crm_demo_inbox()::text');
  perform pg_temp.chk('WITHOUT', 'a card moved to Demo booked by hand before W4 is listed',
    (select e->>'exempt' from jsonb_array_elements((v::jsonb)->'without_demo') e where e->>'record_id' = pg_temp.id('wd')::text), 'true');
  perform pg_temp.chk('WITHOUT', 'its card says it needs linking and is not locked',
    (select (public.crm_record_json(c)->'demo_gate'->>'needs_linking') || '/' || (public.crm_record_json(c)->'demo_gate'->>'locked') from public.crm_records c where c.id = pg_temp.id('wd')), 'true/false');

  -- UNLINK: Token Terrace sits at Demo booked on its only demo.
  v := pg_temp.person('tao', format('select public.crm_demo_unlink(%L::uuid)::text', pg_temp.id('btk')));
  perform pg_temp.chk('UNLINK', 'unlinking the demo a Demo booked card stands on is refused', v,
    'ERR:22023:demo_in_use: Token Terrace is in Demo booked (Google Meet) on this demo. Move the card back first, then unlink the demo.');
  perform pg_temp.lk('UNLINK', 'an agent cannot unlink', pg_temp.agent('tao', format('select public.crm_demo_unlink(%L::uuid)::text', pg_temp.id('bsg'))), 'ERR:42501:needs_a_person:%');
  perform pg_temp.lk('UNLINK', 'a card below the band can be unlinked', pg_temp.person('tao', format('select public.crm_demo_unlink(%L::uuid)::text', pg_temp.id('bsg'))), '{%');
  perform pg_temp.chk('UNLINK', 'and its booking is back on Needs linking', public.crm_demo_needs_linking(pg_temp.id('bsg'))::text, 'true');

  -- RESCHED: a moved booking keeps its link.
  update public.book_call_leads set original_call_at = call_at, call_at = call_at + interval '1 day', status = 'moved', status_changed_at = now()
   where id = pg_temp.id('btk');
  perform pg_temp.chk('RESCHED', 'a moved booking keeps its link', (select record_id::text from public.crm_record_demos where booking_id = pg_temp.id('btk')), pg_temp.id('tk')::text);
  perform pg_temp.chk('RESCHED', 'and still counts as a demo', public.crm_record_has_demo(pg_temp.id('tk'))::text, 'true');
  perform pg_temp.chk('RESCHED', 'the card shows the next demo at the new time',
    (select (public.crm_record_json(c)->'next_demo'->>'call_at')::timestamptz = k.call_at from public.crm_records c, public.book_call_leads k where c.id = pg_temp.id('tk') and k.id = pg_temp.id('btk'))::text, 'true');
  -- A cancelled one leaves the card where it is.
  update public.book_call_leads set status = 'cancelled', status_changed_at = now() where id = pg_temp.id('btk');
  perform pg_temp.chk('RESCHED', 'a cancelled demo leaves the card at Demo booked', pg_temp.stage('tk'), 'meeting');
  v := pg_temp.person('tao', 'select public.crm_demo_inbox()::text');
  perform pg_temp.chk('RESCHED', 'and lists it under Demos cancelled',
    (select (e->>'record_name') || '/' || (e->>'status') from jsonb_array_elements((v::jsonb)->'cancelled') e where e->>'booking_id' = pg_temp.id('btk')::text), 'Token Terrace/cancelled');
  perform pg_temp.chk('RESCHED', 'the card says its demo was cancelled',
    (select public.crm_record_json(c)->'demo_gate'->>'demo_cancelled' from public.crm_records c where c.id = pg_temp.id('tk')), 'true');
  perform pg_temp.chk('RESCHED', 'a cancelled booking is not a booking to link', public.crm_demo_needs_linking(pg_temp.id('btk'))::text, 'false');
  perform pg_temp.lk('RESCHED', 'the card may go down to Replied', pg_temp.move('tao', 'tk', 'replied'), '{%');
  perform pg_temp.lk('RESCHED', 'but not back up without a demo that is on', pg_temp.move('tao', 'tk', 'meeting'), 'ERR:22023:demo_required:%');
end;
$t$;

-- ───────────────────────────── UNDO ─────────────────────────────
do $t$
declare v text; v_act text;
begin
  perform pg_temp.host('ud', 'Undo Diner');
  perform pg_temp.booking('bud', 'Bisi Undo', 'bisi@undodiner.ng', 'Undo Diner');
  perform pg_temp.chk('UNDO', 'linked through the card', pg_temp.link_token('bud', 'ud'), 'true');
  perform pg_temp.lk('UNDO', 'moved to Demo booked', pg_temp.move('tao', 'ud', 'meeting'), '{%');
  v := pg_temp.move('tao', 'ud', 'lost', 'Went quiet');
  v_act := (v::jsonb)->>'activity_id';
  update public.book_call_leads set status = 'cancelled', status_changed_at = now() where id = pg_temp.id('bud');
  v := pg_temp.person('tao', format('select public.crm_record_undo_stage_move(%L::uuid)::text', v_act));
  perform pg_temp.lk('UNDO', 'undoing Lost back into Demo booked is refused once the demo is cancelled', v, 'ERR:22023:demo_required:%');
  perform pg_temp.chk('UNDO', 'the card stays Lost', pg_temp.stage('ud'), 'lost');
end;
$t$;

-- ───────────────────────────── READS ─────────────────────────────
do $t$
declare v text; v_key text;
begin
  v := pg_temp.person('tao', format('select public.crm_record_get(%L::uuid)::text', pg_temp.id('tk')));
  perform pg_temp.chk('READS', 'the card''s read lists its demos with call time, status and link source',
    (select (e->>'status') || '/' || (e->>'link_source') || '/' || ((e->>'call_at') is not null)::text from jsonb_array_elements((v::jsonb)->'demos') e), 'cancelled/card_link/true');
  perform pg_temp.chk('READS', 'and carries the card''s token for its scheduler link',
    (v::jsonb)->>'schedule_token', (select schedule_token::text from public.crm_records where id = pg_temp.id('tk')));
  perform pg_temp.chk('READS', 'never an email in the card''s demos', (((v::jsonb)->'demos')::text like '%@%')::text, 'false');
  perform pg_temp.chk('READS', 'a Replied card is locked with the card''s words',
    (select (public.crm_record_json(c)->'demo_gate'->>'locked') || '/' || left(public.crm_record_json(c)->'demo_gate'->>'reason', 49) from public.crm_records c where c.id = pg_temp.id('gf')),
    'true/Demo booked means a Google Meet booked through th');
  perform pg_temp.chk('READS', 'a creator card carries no demo fields',
    (select (public.crm_record_json(c) ? 'demo_gate')::text from public.crm_records c where c.name = 'Free Creator'), 'false');
  -- The connector.
  v := pg_temp.person('tao', $q$select public.team_agent_key_create('claude')::text$q$);
  v_key := (v::jsonb)->>'key';
  v := pg_temp.gw(v_key, 'get_record', jsonb_build_object('id', pg_temp.id('tk')));
  perform pg_temp.chk('READS', 'the connector''s get_record carries the demos',
    (select (e->>'status') || '/' || (e->>'link_source') from jsonb_array_elements((v::jsonb)#>'{result,demos}') e), 'cancelled/card_link');
  perform pg_temp.chk('READS', 'and never the scheduler token',
    (v like '%' || (select schedule_token::text from public.crm_records where id = pg_temp.id('tk')) || '%')::text, 'false');
  perform pg_temp.chk('READS', 'nor an email from a booking', (((v::jsonb)#>'{result,demos}')::text like '%@%')::text, 'false');
end;
$t$;

-- ───────────────────────────── GRANTS ─────────────────────────────
do $t$
declare v_fn text; v_t text;
begin
  foreach v_t in array array['public.crm_record_demos', 'public.book_call_lead_triage'] loop
    perform pg_temp.chk('GRANTS', v_t || ': no client may touch it',
      (has_table_privilege('authenticated', v_t, 'SELECT') or has_table_privilege('anon', v_t, 'SELECT')
       or has_table_privilege('authenticated', v_t, 'INSERT'))::text, 'false');
    perform pg_temp.chk('GRANTS', v_t || ': row security is on',
      (select relrowsecurity::text from pg_class where oid = v_t::regclass), 'true');
  end loop;
  foreach v_fn in array array['public.crm_demo_link_from_token(text,uuid)', 'public.crm_record_has_demo(uuid)',
      'public.crm_4571_demo_move_ok(uuid,text,text,text,timestamptz)', 'public.crm_demo_stage_allowed(uuid,text)',
      'public.crm_record_demos_json(uuid)', 'public.crm_demo_gate(public.crm_records)', 'public.crm_demo_needs_linking(uuid)',
      'public.crm_demo_calendar_bits(uuid)', 'public.crm_4571_demo_candidates(uuid,text)',
      'public.crm_4571_demo_booking(uuid)', 'public.crm_4571_booking_icp(text)',
      'public.crm_4571_demo_link_core(public.book_call_leads,public.crm_records,text,text,text)'] loop
    perform pg_temp.chk('GRANTS', v_fn || ': the server only',
      has_function_privilege('anon', v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', v_fn, 'EXECUTE')::text, 'false/false');
  end loop;
  foreach v_fn in array array['public.crm_demo_suggestions(uuid)', 'public.crm_demo_link(uuid,uuid,text)', 'public.crm_demo_create_record(uuid)',
      'public.crm_demo_not_a_host(uuid)', 'public.crm_demo_unlink(uuid)', 'public.crm_demo_inbox()', 'public.crm_demo_inbox_count()'] loop
    perform pg_temp.chk('GRANTS', v_fn || ': signed in only, never anon',
      has_function_privilege('anon', v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', v_fn, 'EXECUTE')::text, 'false/true');
  end loop;
  perform pg_temp.chk('GRANTS', 'the trigger is ordinary (not ALWAYS) and fires before insert or a stage update',
    (select tgenabled::text || '/' || (tgtype & 2 > 0)::text from pg_trigger where tgname = 'crm_4571_demo_stage_guard'), 'O/true');
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
  if v_all < 80 then raise exception '#4571 W4 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W4 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W4 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
