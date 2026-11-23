-- Issue #4571 W6b (email logged against cards, Replied suggested, the weekly
-- numbers, log_activity's suggest_stage) -- implementor suite for
-- 20281130074571_issue_4571_w6b_email_log_and_numbers.sql on the fully
-- replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-mail-touch-once | gate crm_email_log_once | test this file
--
--   INGEST   outbound mail matches To and Cc, inbound its From; a repeat logs
--            nothing twice; mail that matches no card is not stored; an
--            archived card is not matched; the snippet keeps 300 characters;
--            the stage at the time is stored (decision 8); a bad item is
--            refused alone; a bad mailbox refuses the batch.
--   REPLIED  an inbound email newer than the last stage move suggests Replied
--            on a Contacted card; a move afterwards clears it; never moved.
--   NUMBERS  per rep per Lagos day: calls, outcomes, connected, demos booked,
--            emails sent by From, replies by mailbox; rates null with nothing
--            to divide by (never 0), demo rate = demos booked / connected;
--            the window is 1 to 92 days.
--   GATEWAY  log_emails through the real gateway with an agent key: needs a
--            request_key, logs, replays; log_activity carries suggest_stage.
--   GRANTS   no client reads crm_email_log.
--
-- FAILS-ON-REVERT: before the migration crm_email_log and its functions do not
-- exist; dropping crm_email_log_once logs a repeat twice (INGEST fails).
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45760000-0000-4000-c000-000000000001', 'seth.w64571@test.local'),
  ('tao',  '45760000-0000-4000-c000-000000000002', 'tao.w64571@test.local'),
  ('kemi', '45760000-0000-4000-c000-000000000003', 'kemi.w64571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('seth.w64571@test.local', 'owner', 'active', now());
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
  values (v_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, 'seth.w64571@test.local', 'seth.w64571@test.local');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (v_id, 'tao.w64571@test.local', 'seth.w64571@test.local');
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
  values (v_id, 'slot:w6-' || p_k, p_audience, p_name, p_email, case when p_audience = 'host' then p_venue end,
          case when p_audience = 'host' then 'restaurants' end, case when p_audience = 'host' then null else 'Lagos' end,
          case when p_audience = 'creator' then 'video' end,
          'instagram', 'https://instagram.com/' || p_k, p_created + interval '2 days', p_created, p_phone);
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
create function pg_temp.link_token(p_booking text, p_card text) returns text
language sql as $fn$
  select pg_temp.svc(format('select public.crm_demo_link_from_token(%L, %L::uuid)::text',
    'slot:w6-' || p_booking, (select schedule_token from public.crm_records where id = pg_temp.id(p_card))))
$fn$;
create function pg_temp.gw(p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform pg_temp.next_request();
  begin
    set local role service_role;
    execute format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_tool, p_args, 'w64571-test/1.0') into v_out;
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
create function pg_temp.ident(p_k text, p_kind text, p_value text) returns void
language sql as $fn$
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
  values (pg_temp.id(p_k), p_kind, p_value, public.crm_ident_key(p_kind, p_value), 'seth.w64571@test.local')
$fn$;
create function pg_temp.ingest(p_who text, p_mailbox text, p_messages jsonb) returns text
language sql as $fn$
  select pg_temp.person(p_who, format('select public.crm_email_log_ingest(%L, %L::jsonb)::text', p_mailbox, p_messages))
$fn$;
create function pg_temp.msg(p_id text, p_dir text, p_from text, p_to jsonb, p_at timestamptz, p_subject text default 'Hello', p_snippet text default 'Hi there') returns jsonb
language sql as $fn$
  select jsonb_build_object('id', p_id, 'direction', p_dir, 'from', p_from, 'to', p_to, 'cc', '[]'::jsonb, 'at', p_at, 'subject', p_subject, 'snippet', p_snippet)
$fn$;
create function pg_temp.logged(p_k text) returns text
language sql as $fn$ select count(*)::text from public.crm_email_log where record_id = pg_temp.id(p_k) $fn$;

-- ───────────────────────────── INGEST ─────────────────────────────
do $t$
declare v text; j jsonb; v_long text := repeat('x', 400);
begin
  perform pg_temp.host('ea', 'Email Lounge W6b', 'contacted');
  perform pg_temp.host('eb', 'Second Email W6b', 'prospect');
  perform pg_temp.host('ez', 'Archived Email W6b', 'prospect');
  perform pg_temp.ident('ea', 'email', 'Ada@Lounge-w6b.test');
  perform pg_temp.ident('eb', 'email', 'bola@second-w6b.test');
  perform pg_temp.ident('ez', 'email', 'zed@archived-w6b.test');
  update public.crm_records set archived_at = now(), archived_by = 'x', archived_reason = 'old' where id = pg_temp.id('ez');

  v := pg_temp.ingest('tao', 'info@usemingla.com', jsonb_build_array(
    pg_temp.msg('m-out-1', 'outbound', 'Mingla <info@usemingla.com>', '["Ada <ada@lounge-w6b.test>"]', now() - interval '2 hours', 'Hosting on Mingla', v_long),
    pg_temp.msg('m-out-2', 'outbound', 'info@usemingla.com', '["stranger@nowhere-w6b.test"]', now() - interval '2 hours'),
    jsonb_build_object('id', 'm-cc-1', 'direction', 'outbound', 'from', 'tao.w64571@test.local', 'to', '["someone@else-w6b.test"]'::jsonb, 'cc', '["bola@second-w6b.test"]'::jsonb, 'at', now() - interval '1 hour', 'subject', 'Copy', 'snippet', 'cc you'),
    pg_temp.msg('m-arch', 'outbound', 'info@usemingla.com', '["zed@archived-w6b.test"]', now() - interval '1 hour'),
    pg_temp.msg('bad id!', 'outbound', 'info@usemingla.com', '["ada@lounge-w6b.test"]', now())));
  j := v::jsonb;
  perform pg_temp.chk('INGEST', 'counts: 2 logged, 2 with no card, 1 refused', (j->'counts')::text, '{"error": 1, "logged": 2, "no_card": 2, "already_logged": 0}');
  perform pg_temp.chk('INGEST', 'outbound matched by To (case-insensitive)', pg_temp.logged('ea'), '1');
  perform pg_temp.chk('INGEST', 'outbound matched by Cc', pg_temp.logged('eb'), '1');
  perform pg_temp.chk('INGEST', 'an archived card is not matched', pg_temp.logged('ez'), '0');
  perform pg_temp.chk('INGEST', 'mail that matches no card is not stored',
    (select count(*)::text from public.crm_email_log where message_id in ('m-out-2', 'm-arch')), '0');
  perform pg_temp.chk('INGEST', 'the bad item is refused alone with its reason', j->'results'->4->'error'->>'token', 'invalid_id');
  perform pg_temp.chk('INGEST', 'the snippet keeps 300 characters', (select char_length(snippet)::text from public.crm_email_log where message_id = 'm-out-1'), '300');
  perform pg_temp.chk('INGEST', 'the subject, From and mailbox are kept',
    (select subject || '|' || from_address || '|' || mailbox || '|' || matched_address from public.crm_email_log where message_id = 'm-out-1'),
    'Hosting on Mingla|info@usemingla.com|info@usemingla.com|ada@lounge-w6b.test');
  perform pg_temp.chk('INGEST', 'the card''s stage at the time is stored', (select stage_at from public.crm_email_log where message_id = 'm-out-1'), 'contacted');
  perform pg_temp.chk('INGEST', 'who logged it is kept', (select logged_by from public.crm_email_log where message_id = 'm-out-1'), 'tao.w64571@test.local');

  -- The same message again (another run of the agent): nothing twice.
  v := pg_temp.ingest('kemi', 'info@usemingla.com', jsonb_build_array(
    pg_temp.msg('m-out-1', 'outbound', 'info@usemingla.com', '["ada@lounge-w6b.test"]', now() - interval '2 hours')));
  perform pg_temp.chk('INGEST', 'a repeat is already_logged', (v::jsonb)->'results'->0->>'status', 'already_logged');
  perform pg_temp.chk('INGEST', 'a repeat logs nothing twice', pg_temp.logged('ea'), '1');
  v := pg_temp.try($q$insert into public.crm_email_log (message_id, record_id, matched_address, direction, mailbox, from_address, sent_at, stage_at, logged_by)
                      select 'm-out-1', id, 'ada@lounge-w6b.test', 'outbound', 'info@usemingla.com', 'info@usemingla.com', now(), 'contacted', 'x'
                        from public.crm_records where name = 'Email Lounge W6b'$q$);
  perform pg_temp.lk('INGEST', 'the table itself refuses a second row for a message and card', v, 'ERR:23505:%');

  -- The stage at the time: a message sent before a later move keeps the older stage.
  perform pg_temp.move('tao', 'eb', 'contacted');
  update public.crm_activity set occurred_at = now() - interval '30 minutes' where record_id = pg_temp.id('eb') and kind = 'stage_move';
  v := pg_temp.ingest('tao', 'info@usemingla.com', jsonb_build_array(
    pg_temp.msg('m-early', 'outbound', 'info@usemingla.com', '["bola@second-w6b.test"]', now() - interval '3 hours'),
    pg_temp.msg('m-late', 'outbound', 'info@usemingla.com', '["bola@second-w6b.test"]', now() - interval '5 minutes')));
  perform pg_temp.chk('INGEST', 'stage_at follows the card''s history',
    (select string_agg(stage_at, ',' order by sent_at) from public.crm_email_log where message_id in ('m-early', 'm-late')), 'prospect,contacted');

  v := pg_temp.ingest('tao', 'not an address', jsonb_build_array(pg_temp.msg('m-x', 'outbound', 'info@usemingla.com', '[]', now())));
  perform pg_temp.lk('INGEST', 'a bad mailbox refuses the batch', v, 'ERR:22023:invalid_mailbox:%');
  v := pg_temp.ingest('tao', 'info@usemingla.com', jsonb_build_array(pg_temp.msg('m-future', 'outbound', 'info@usemingla.com', '["ada@lounge-w6b.test"]', now() + interval '3 days')));
  perform pg_temp.chk('INGEST', 'a time in the future is refused', (v::jsonb)->'results'->0->'error'->>'token', 'invalid_at');
  v := pg_temp.ingest('tao', 'info@usemingla.com', jsonb_build_array(pg_temp.msg('m-body', 'outbound', 'info@usemingla.com', '["ada@lounge-w6b.test"]', now()) || '{"body":"all of it"}'));
  perform pg_temp.chk('INGEST', 'a body is refused', (v::jsonb)->'results'->0->'error'->>'token', 'unknown_field');
end;
$t$;

-- ───────────────────────────── REPLIED ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  perform pg_temp.chk('REPLIED', 'no reply yet: nothing suggested',
    (select (public.crm_record_json(c)->'suggest_replied')::text from public.crm_records c where c.id = pg_temp.id('ea')), 'null');
  v := pg_temp.ingest('tao', 'info@usemingla.com', jsonb_build_array(
    pg_temp.msg('m-in-1', 'inbound', 'Ada <ada@lounge-w6b.test>', '["info@usemingla.com"]', now() + interval '1 minute', 'Re: Hosting on Mingla', 'Sounds good')));
  perform pg_temp.chk('REPLIED', 'inbound matched by From', (v::jsonb)->'results'->0->>'status', 'logged');
  j := (select public.crm_record_json(c) from public.crm_records c where c.id = pg_temp.id('ea'));
  perform pg_temp.chk('REPLIED', 'a Contacted card suggests Replied, with the subject', j->'suggest_replied'->>'subject', 'Re: Hosting on Mingla');
  perform pg_temp.chk('REPLIED', 'it is never applied', pg_temp.stage('ea'), 'contacted');
  perform pg_temp.move('tao', 'ea', 'replied');
  perform pg_temp.chk('REPLIED', 'after the move nothing is suggested',
    (select (public.crm_record_json(c)->'suggest_replied')::text from public.crm_records c where c.id = pg_temp.id('ea')), 'null');
end;
$t$;

-- ───────────────────────────── NUMBERS ─────────────────────────────
do $t$
declare v text; j jsonb; r jsonb; v_day date := (now() at time zone 'Africa/Lagos')::date; v_at timestamptz;
begin
  v_at := (v_day::timestamp + interval '10 hours') at time zone 'Africa/Lagos';
  perform pg_temp.host('na', 'Numbers Host W6b', 'contacted');
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, call_outcome, occurred_at, created_at)
  select pg_temp.id('na'), 'touch', 'tao.w64571@test.local', 'phone', 'outbound', o, v_at, v_at
    from unnest(array['demo_booked','spoke_follow_up','call_back','not_interested','no_answer','no_answer','wrong_number','demo_booked']) o;
  -- kemi: calls with no answer only (connected 0: demo rate has nothing to divide by)
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, call_outcome, occurred_at, created_at)
  values (pg_temp.id('na'), 'touch', 'kemi.w64571@test.local', 'phone', 'outbound', 'no_answer', v_at, v_at);
  -- yesterday Lagos, late evening: another day
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, call_outcome, occurred_at, created_at)
  values (pg_temp.id('na'), 'touch', 'tao.w64571@test.local', 'phone', 'outbound', 'no_answer',
          ((v_day - 1)::timestamp + interval '23 hours 30 minutes') at time zone 'Africa/Lagos', now());

  v := pg_temp.person('seth', format('select public.crm_outreach_numbers(%L::date, %L::date)::text', v_day - 1, v_day));
  j := v::jsonb;
  r := (select x from jsonb_array_elements(j->'reps') x where x->>'rep' = 'tao.w64571@test.local');
  perform pg_temp.chk('NUMBERS', 'tao: 9 calls in the window', r->'totals'->>'calls', '9');
  perform pg_temp.chk('NUMBERS', 'connected = demo booked, spoke, call back, not interested', r->'totals'->>'connected', '5');
  perform pg_temp.chk('NUMBERS', 'demos booked', r->'totals'->>'demos_booked', '2');
  perform pg_temp.chk('NUMBERS', 'connect rate = connected / calls', r->'totals'->>'connect_rate', '0.5556');
  perform pg_temp.chk('NUMBERS', 'demo rate = demos booked / connected', r->'totals'->>'demo_rate', '0.4000');
  perform pg_temp.chk('NUMBERS', 'two Lagos days', (select string_agg(d->>'day' || ':' || (d->>'calls'), ',' order by d->>'day') from jsonb_array_elements(r->'days') d),
    (v_day - 1)::text || ':1,' || v_day::text || ':8');
  perform pg_temp.chk('NUMBERS', 'outcomes by name', r->'days'->1->'outcomes'->>'no_answer', '2');
  r := (select x from jsonb_array_elements(j->'reps') x where x->>'rep' = 'kemi.w64571@test.local');
  perform pg_temp.chk('NUMBERS', 'kemi: connect rate 0, not null', r->'totals'->>'connect_rate', '0.0000');
  perform pg_temp.chk('NUMBERS', 'kemi: demo rate null (nothing connected), never 0', (r->'totals'->'demo_rate')::text, 'null');
  r := (select x from jsonb_array_elements(j->'reps') x where x->>'rep' = 'info@usemingla.com');
  perform pg_temp.chk('NUMBERS', 'emails sent by From address (distinct stored messages)', r->'totals'->>'emails_sent', '3');
  perform pg_temp.chk('NUMBERS', 'replies by mailbox', r->'totals'->>'replies', '1');
  perform pg_temp.chk('NUMBERS', 'a mailbox with no calls has null rates', (r->'totals'->'connect_rate')::text || '/' || (r->'totals'->'demo_rate')::text, 'null/null');
  r := (select x from jsonb_array_elements(j->'reps') x where x->>'rep' = 'tao.w64571@test.local');
  perform pg_temp.chk('NUMBERS', 'a rep''s own address counts their sent mail', r->'totals'->>'emails_sent', '1');
  perform pg_temp.chk('NUMBERS', 'reps carry names, not only addresses', (r->>'name' is not null)::text, 'true');
  perform pg_temp.chk('NUMBERS', 'the mail log''s last time is given', (j->>'mail_last_logged_at' is not null)::text, 'true');
  v := pg_temp.person('seth', format('select public.crm_outreach_numbers(%L::date, %L::date)::text', v_day - 92, v_day));
  perform pg_temp.lk('NUMBERS', '93 days is refused', v, 'ERR:22023:invalid_window:%');
  v := pg_temp.anon(format('select public.crm_outreach_numbers(%L::date, %L::date)::text', v_day, v_day));
  perform pg_temp.lk('NUMBERS', 'signed out is refused', v, 'ERR:%');
end;
$t$;

-- ───────────────────────────── GATEWAY ─────────────────────────────
do $t$
declare v text; v_key text; j jsonb;
begin
  v := pg_temp.person('tao', $q$select public.team_agent_key_create('claude')::text$q$);
  v_key := (v::jsonb)->>'key';
  v := pg_temp.gw(v_key, 'log_emails', jsonb_build_object('mailbox', 'info@usemingla.com',
    'messages', jsonb_build_array(pg_temp.msg('m-gw-1', 'inbound', 'bola@second-w6b.test', '["info@usemingla.com"]', now() - interval '1 minute', 'Re: hi', 'yes'))));
  perform pg_temp.chk('GATEWAY', 'log_emails needs a request_key', (v::jsonb)->'error'->>'token', 'request_key_required');
  v := pg_temp.gw(v_key, 'log_emails', jsonb_build_object('mailbox', 'info@usemingla.com', 'request_key', 'w6b-gw-key-0001',
    'messages', jsonb_build_array(pg_temp.msg('m-gw-1', 'inbound', 'bola@second-w6b.test', '["info@usemingla.com"]', now() - interval '1 minute', 'Re: hi', 'yes'))));
  j := v::jsonb;
  perform pg_temp.chk('GATEWAY', 'logged through the gateway', j->'result'->'counts'->>'logged', '1');
  perform pg_temp.chk('GATEWAY', 'the agent is recorded', (select logged_via from public.crm_email_log where message_id = 'm-gw-1'), 'claude');
  perform pg_temp.chk('GATEWAY', 'the call is counted with its items', (select items::text from public.team_agent_calls where tool = 'log_emails' and outcome = 'ok' order by started_at desc limit 1), '1');
  v := pg_temp.gw(v_key, 'log_emails', jsonb_build_object('mailbox', 'info@usemingla.com', 'request_key', 'w6b-gw-key-0001',
    'messages', jsonb_build_array(pg_temp.msg('m-gw-1', 'inbound', 'bola@second-w6b.test', '["info@usemingla.com"]', now() - interval '1 minute', 'Re: hi', 'yes'))));
  perform pg_temp.chk('GATEWAY', 'the same request replays: already logged', (v::jsonb)->'result'->'results'->0->>'status', 'already_logged');
  v := pg_temp.gw(v_key, 'log_emails', jsonb_build_object('mailbox', 'info@usemingla.com', 'request_key', 'w6b-gw-key-0001',
    'messages', jsonb_build_array(pg_temp.msg('m-gw-2', 'inbound', 'bola@second-w6b.test', '[]', now()))));
  perform pg_temp.chk('GATEWAY', 'the key with other messages is refused', (v::jsonb)->'error'->>'token', 'request_key_reused');
  v := pg_temp.gw(v_key, 'log_emails', jsonb_build_object('mailbox', 'info@usemingla.com', 'request_key', 'w6b-gw-key-0002', 'token', 'ya29',
    'messages', jsonb_build_array(pg_temp.msg('m-gw-3', 'inbound', 'bola@second-w6b.test', '[]', now()))));
  perform pg_temp.chk('GATEWAY', 'an extra argument is refused', (v::jsonb)->'error'->>'token', 'unknown_field');

  -- log_activity: the answer carries suggest_stage (a first call, not interested).
  perform pg_temp.host('gs', 'Suggest Host W6b', 'prospect');
  v := pg_temp.gw(v_key, 'log_activity', jsonb_build_object('request_key', 'w6b-gw-key-0003', 'entries', jsonb_build_array(
    jsonb_build_object('id', pg_temp.id('gs'), 'kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'not_interested', 'body', 'Not for us'))));
  j := v::jsonb;
  perform pg_temp.chk('GATEWAY', 'log_activity logged', j->'result'->'results'->0->>'status', 'logged');
  perform pg_temp.chk('GATEWAY', 'log_activity carries suggest_stage to the agent', j->'result'->'results'->0->'suggest_stage'->>'stage', 'lost');
  perform pg_temp.chk('GATEWAY', 'the card is not moved', pg_temp.stage('gs'), 'prospect');
end;
$t$;

-- ───────────────────────────── GRANTS ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('GRANTS', 'authenticated cannot read crm_email_log', has_table_privilege('authenticated', 'public.crm_email_log', 'select')::text, 'false');
  perform pg_temp.chk('GRANTS', 'anon cannot ingest', has_function_privilege('anon', 'public.crm_email_log_ingest(text,jsonb)', 'execute')::text, 'false');
  perform pg_temp.chk('GRANTS', 'helpers are the server''s', has_function_privilege('authenticated', 'public.crm_4571_stage_at(uuid,timestamptz)', 'execute')::text, 'false');
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
  if v_all < 45 then raise exception '#4571 W6b implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W6b implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W6b implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
