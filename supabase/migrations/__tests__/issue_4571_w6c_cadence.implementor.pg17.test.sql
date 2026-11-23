-- Issue #4571 W6c (the nightly cadence sweep on the server) -- implementor
-- suite for 20281126084571_issue_4571_w6c_cadence_sweep.sql on the fully
-- replayed PG17 schema. The fixtures mirror ~/.mingla-agent/cadence_sweep.py's
-- cases. Everything is rolled back.
--
-- INVARIANT crm-cadence-counts-prospect-contacted-only | gate crm_4571_cadence | test this file
--
--   STATE    calls and emails count outbound touches since the restart made
--            in Prospect or Contacted only (decision 8); emails = max(logged,
--            distinct days of info@ mail to the card's busiest address);
--            round = min + 1 (emails + 1 with no phone); the card carries it.
--   SWEEP    the script's cases: team owners only; first touch Prospect to
--            Contacted; 6 + 6 to Lost with the script's reason; 6 emails and
--            no phone to Lost; touches in Replied do not count (decision 8);
--            back in Contacted the count resumes; info@ days count; never
--            Replied, Demo booked, Onboarded, Live or archived; touched today
--            and due: due_on + 2 working days and "Round n+1 of 6..."; overdue
--            counted by first owner; the summary line is the script's.
--   DAYS     2 working days over a weekend.
--   DRYRUN   a dry run changes no card and writes its plan; the real run
--            applies it through the system path (history, audit) and posts
--            the report on the named Work card.
--   SWITCH   off by default: the cron entry does nothing; owner-only switch;
--            the panel and a dry run now are owner or admin; the job is
--            scheduled weekdays 20:00 UTC.
--
-- FAILS-ON-REVERT: deleting the stage_at IN ('prospect','contacted') filter in
-- crm_4571_cadence counts the Replied touches and moves "Quiet In Replied" to
-- Lost (SWEEP fails); without the migration nothing here exists.
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
create function pg_temp.rk() returns text language sql as $fn$ select 'w6-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.ident(p_k text, p_kind text, p_value text) returns void
language sql as $fn$
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
  values (pg_temp.id(p_k), p_kind, p_value, public.crm_ident_key(p_kind, p_value), 'seth.w64571@test.local')
$fn$;
-- n outbound touches on a channel, made while the card was in p_stage, days ago.
create function pg_temp.touches(p_k text, p_channel text, p_n integer, p_stage text, p_days_ago integer default 3) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, stage_at, occurred_at, created_at)
  select pg_temp.id(p_k), 'touch', 'tao.w64571@test.local', p_channel, 'outbound', p_stage,
         now() - make_interval(days => p_days_ago) - make_interval(mins => g), now()
    from generate_series(1, p_n) g
$fn$;
create function pg_temp.mail_days(p_k text, p_addr text, p_n integer, p_stage text) returns void
language sql as $fn$
  insert into public.crm_email_log (message_id, record_id, matched_address, direction, mailbox, from_address, sent_at, stage_at, logged_by)
  select 'w6c-' || p_k || '-' || g || '-' || p_stage, pg_temp.id(p_k), p_addr, 'outbound', 'info@usemingla.com', 'info@usemingla.com',
         now() - make_interval(days => g + 1), p_stage, 'tao.w64571@test.local'
    from generate_series(1, p_n) g
$fn$;
create function pg_temp.owned(p_k text, p_who text) returns void
language sql as $fn$
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (pg_temp.id(p_k), pg_temp.email(p_who), 'x')
  on conflict do nothing
$fn$;
create function pg_temp.act(p_run uuid, p_k text) returns text
language sql as $fn$
  select coalesce(string_agg(a.action || ':' || a.status, ',' order by a.action), '<none>')
    from public.crm_cadence_sweep_actions a where a.run_id = p_run and a.record_id = pg_temp.id(p_k)
$fn$;

-- The sweep's team and restart date for this suite (config, not code).
update public.ops_settings
   set value = value || jsonb_build_object('team', jsonb_build_array('tao.w64571@test.local', 'kemi.w64571@test.local'),
                                           'since', ((now() at time zone 'Africa/Lagos')::date - 30)::text)
 where key = 'cadence_sweep';

-- ───────────────────────────── fixtures ─────────────────────────────
do $t$
begin
  -- 1. first touch today, still in Prospect, with a phone: Contacted + round dated.
  perform pg_temp.host('first', 'First Touch W6c', 'prospect');
  perform pg_temp.ident('first', 'phone', '+2348035550001');
  perform pg_temp.touches('first', 'phone', 1, 'prospect', 0);
  -- 2. 6 calls and 6 emails in Contacted: Lost.
  perform pg_temp.host('done', 'Six And Six W6c', 'contacted');
  perform pg_temp.ident('done', 'phone', '+2348035550002');
  perform pg_temp.touches('done', 'phone', 6, 'contacted');
  perform pg_temp.touches('done', 'email', 6, 'contacted');
  -- 3. no phone, 6 emails: Lost.
  perform pg_temp.host('nophone', 'No Phone W6c', 'contacted');
  perform pg_temp.touches('nophone', 'email', 6, 'contacted');
  -- 4. decision 8: 3 + 3 in Contacted and 3 + 3 made while in Replied; back in Contacted.
  perform pg_temp.host('quiet', 'Quiet In Replied W6c', 'contacted');
  perform pg_temp.ident('quiet', 'phone', '+2348035550004');
  perform pg_temp.touches('quiet', 'phone', 3, 'contacted', 10);
  perform pg_temp.touches('quiet', 'email', 3, 'contacted', 10);
  perform pg_temp.touches('quiet', 'phone', 3, 'replied', 5);
  perform pg_temp.touches('quiet', 'email', 3, 'replied', 5);
  -- 5. the count resumes back in Contacted: 3 + 3, 2 + 2 in Replied, 3 + 3 again.
  perform pg_temp.host('resume', 'Resumed W6c', 'contacted');
  perform pg_temp.ident('resume', 'phone', '+2348035550005');
  perform pg_temp.touches('resume', 'phone', 3, 'contacted', 12);
  perform pg_temp.touches('resume', 'email', 3, 'contacted', 12);
  perform pg_temp.touches('resume', 'phone', 2, 'replied', 8);
  perform pg_temp.touches('resume', 'email', 2, 'replied', 8);
  perform pg_temp.touches('resume', 'phone', 3, 'contacted', 4);
  perform pg_temp.touches('resume', 'email', 3, 'contacted', 4);
  -- 6. emails from the info@ log: 6 calls logged, no email touches, 6 days of mail (and 2 in Replied that do not count).
  perform pg_temp.host('maildays', 'Mail Days W6c', 'contacted');
  perform pg_temp.ident('maildays', 'phone', '+2348035550006');
  perform pg_temp.ident('maildays', 'email', 'desk@maildays-w6c.test');
  perform pg_temp.touches('maildays', 'phone', 6, 'contacted');
  perform pg_temp.mail_days('maildays', 'desk@maildays-w6c.test', 6, 'contacted');
  perform pg_temp.host('mailhalf', 'Mail Half W6c', 'contacted');
  perform pg_temp.ident('mailhalf', 'phone', '+2348035550007');
  perform pg_temp.touches('mailhalf', 'phone', 6, 'contacted');
  perform pg_temp.mail_days('mailhalf', 'desk@mailhalf-w6c.test', 4, 'contacted');
  perform pg_temp.mail_days('mailhalf', 'desk@mailhalf-w6c.test', 2, 'replied');
  -- 7. never touched: Replied, Demo booked, Onboarded, Live, Lost and archived, all at 6 + 6.
  perform pg_temp.host('replied', 'Stage Replied W6c', 'replied');
  perform pg_temp.host('archived', 'Archived W6c', 'contacted');
  perform pg_temp.touches('archived', 'phone', 6, 'contacted');
  perform pg_temp.touches('archived', 'email', 6, 'contacted');
  update public.crm_records set archived_at = now(), archived_by = 'x', archived_reason = 'pruned' where id = pg_temp.id('archived');
  perform pg_temp.touches('replied', 'phone', 6, 'contacted');
  perform pg_temp.touches('replied', 'email', 6, 'contacted');
  alter table public.crm_records disable trigger crm_4571_demo_stage_guard;
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('45760000-0000-4000-e000-0000000c0001', 'hosts', 'Stage Meeting W6c', 'meeting', 'x', 'x'),
    ('45760000-0000-4000-e000-0000000c0002', 'hosts', 'Stage Onboarded W6c', 'onboarded', 'x', 'x'),
    ('45760000-0000-4000-e000-0000000c0003', 'hosts', 'Stage Live W6c', 'live', 'x', 'x');
  alter table public.crm_records enable trigger crm_4571_demo_stage_guard;
  perform pg_temp.keep('meeting', '45760000-0000-4000-e000-0000000c0001');
  perform pg_temp.keep('onboarded', '45760000-0000-4000-e000-0000000c0002');
  perform pg_temp.keep('live', '45760000-0000-4000-e000-0000000c0003');
  perform pg_temp.owned('meeting', 'tao'); perform pg_temp.owned('onboarded', 'tao'); perform pg_temp.owned('live', 'tao');
  perform pg_temp.touches('meeting', 'phone', 6, 'contacted'); perform pg_temp.touches('meeting', 'email', 6, 'contacted');
  perform pg_temp.touches('live', 'phone', 6, 'contacted'); perform pg_temp.touches('live', 'email', 6, 'contacted');
  -- 8. not the team's: an outsider owns it.
  perform pg_temp.host('other', 'Not Ours W6c', 'prospect');
  delete from public.crm_record_owners where record_id = pg_temp.id('other');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (pg_temp.id('other'), 'outsider.w64571@test.local', 'x');
  perform pg_temp.touches('other', 'phone', 1, 'prospect', 0);
  -- 9. overdue: due 3 days ago, last touch before that; owned by kemi and tao (first owner alphabetically: kemi).
  perform pg_temp.host('late', 'Overdue W6c', 'contacted');
  perform pg_temp.owned('late', 'kemi');
  perform pg_temp.touches('late', 'phone', 1, 'contacted', 6);
  update public.crm_records set due_on = (now() at time zone 'Africa/Lagos')::date - 3 where id = pg_temp.id('late');
  -- 10. touched today but due in the future: not re-dated.
  perform pg_temp.host('ahead', 'Due Ahead W6c', 'contacted');
  perform pg_temp.ident('ahead', 'phone', '+2348035550010');
  perform pg_temp.touches('ahead', 'phone', 2, 'contacted', 1);
  perform pg_temp.touches('ahead', 'email', 1, 'contacted', 0);
  update public.crm_records set due_on = (now() at time zone 'Africa/Lagos')::date + 1 where id = pg_temp.id('ahead');
  -- 11. touches before the restart date do not count.
  perform pg_temp.host('old', 'Before Restart W6c', 'contacted');
  perform pg_temp.ident('old', 'phone', '+2348035550011');
  perform pg_temp.touches('old', 'phone', 6, 'contacted', 40);
  perform pg_temp.touches('old', 'email', 6, 'contacted', 40);
end;
$t$;

-- ───────────────────────────── STATE ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  v := pg_temp.person('tao', format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('quiet')));
  j := v::jsonb;
  perform pg_temp.chk('STATE', 'decision 8: Replied touches do not count (3 calls, 3 emails)', (j->>'calls') || '/' || (j->>'emails'), '3/3');
  perform pg_temp.chk('STATE', 'round = min + 1', j->>'round', '4');
  perform pg_temp.chk('STATE', 'not finished', j->>'finished', 'false');
  perform pg_temp.chk('STATE', 'the sweep applies to it now', j->>'counts', 'true');
  v := pg_temp.person('tao', format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('resume')));
  perform pg_temp.chk('STATE', 'back in Contacted the count resumes (6 + 6)', ((v::jsonb)->>'calls') || '/' || ((v::jsonb)->>'emails'), '6/6');
  v := pg_temp.person('tao', format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('maildays')));
  perform pg_temp.chk('STATE', 'emails = days of info@ mail when more than the logged touches', (v::jsonb)->>'emails', '6');
  v := pg_temp.person('tao', format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('mailhalf')));
  perform pg_temp.chk('STATE', 'info@ days in Replied do not count', (v::jsonb)->>'emails', '4');
  v := pg_temp.person('tao', format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('nophone')));
  perform pg_temp.chk('STATE', 'no phone: finished at 6 emails', ((v::jsonb)->>'has_phone') || '/' || ((v::jsonb)->>'finished'), 'false/true');
  v := pg_temp.person('tao', format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('old')));
  perform pg_temp.chk('STATE', 'touches before the restart date do not count', ((v::jsonb)->>'calls') || '/' || ((v::jsonb)->>'emails'), '0/0');
  v := pg_temp.person('tao', format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('ahead')));
  perform pg_temp.chk('STATE', 'steps say what is done and left', ((v::jsonb)->'steps')::text, '["call done", "email to send"]');
  perform pg_temp.chk('STATE', 'round 2 with 2 calls and 1 email', (v::jsonb)->>'round', '2');
  j := (select public.crm_record_json(c) from public.crm_records c where c.id = pg_temp.id('quiet'));
  perform pg_temp.chk('STATE', 'the card carries the round the tile shows', (j->'cadence'->>'round') || ' of ' || (j->'cadence'->>'of'), '4 of 6');
  j := (select public.crm_record_json(c) from public.crm_records c where c.id = pg_temp.id('replied'));
  perform pg_temp.chk('STATE', 'a Replied card carries no cadence', (j->'cadence')::text, 'null');
  v := pg_temp.anon(format('select public.crm_cadence_state(%L::uuid)::text', pg_temp.id('quiet')));
  perform pg_temp.lk('STATE', 'signed out is refused', v, 'ERR:%');
end;
$t$;

-- ───────────────────────────── SWEEP (dry run) ─────────────────────────────
do $t$
declare j jsonb; v_run uuid; v_today date := (now() at time zone 'Africa/Lagos')::date;
        v_before text;
begin
  v_before := (select string_agg(id::text || stage || coalesce(due_on::text, '') || coalesce(next_action, ''), ',' order by id) from public.crm_records where name like '%W6c');
  j := public.crm_cadence_sweep(true, 'manual');
  v_run := (j->>'run_id')::uuid;
  perform pg_temp.chk('DRYRUN', 'a dry run changes no card',
    (select string_agg(id::text || stage || coalesce(due_on::text, '') || coalesce(next_action, ''), ',' order by id) from public.crm_records where name like '%W6c'), v_before);
  perform pg_temp.chk('DRYRUN', 'its plan is written as planned', (select count(*) filter (where status <> 'planned')::text from public.crm_cadence_sweep_actions where run_id = v_run), '0');
  perform pg_temp.chk('SWEEP', 'first touch: Prospect to Contacted and the next round dated', pg_temp.act(v_run, 'first'), 'advance:planned,contacted:planned');
  perform pg_temp.chk('SWEEP', 'the next round is 2 working days after today',
    (select due_on::text from public.crm_cadence_sweep_actions where run_id = v_run and record_id = pg_temp.id('first') and action = 'advance'),
    public.crm_4571_working_days_after(v_today, 2)::text);
  perform pg_temp.chk('SWEEP', 'the script''s next action text',
    (select next_action from public.crm_cadence_sweep_actions where run_id = v_run and record_id = pg_temp.id('first') and action = 'advance'),
    'Round 1 of 6: call from PressOne, then send email 1. 1 calls and 0 emails so far');
  perform pg_temp.chk('SWEEP', '6 + 6: Lost', pg_temp.act(v_run, 'done'), 'lost:planned');
  perform pg_temp.chk('SWEEP', 'the script''s Lost reason',
    (select reason from public.crm_cadence_sweep_actions where run_id = v_run and record_id = pg_temp.id('done')),
    format('No meeting after 6 calls and 6 emails (cadence from %s)', to_char(v_today - 30, 'FMDD Mon YYYY')));
  perform pg_temp.chk('SWEEP', 'no phone and 6 emails: Lost', pg_temp.act(v_run, 'nophone'), 'lost:planned');
  perform pg_temp.chk('SWEEP', 'decision 8: touches in Replied do not count, so no Lost', pg_temp.act(v_run, 'quiet'), '<none>');
  perform pg_temp.chk('SWEEP', 'back in Contacted the count resumes: Lost', pg_temp.act(v_run, 'resume'), 'lost:planned');
  perform pg_temp.chk('SWEEP', 'info@ mail days count toward 6 + 6', pg_temp.act(v_run, 'maildays'), 'lost:planned');
  perform pg_temp.chk('SWEEP', 'info@ mail in Replied does not', pg_temp.act(v_run, 'mailhalf'), '<none>');
  perform pg_temp.chk('SWEEP', 'never Replied', pg_temp.act(v_run, 'replied'), '<none>');
  perform pg_temp.chk('SWEEP', 'never Demo booked', pg_temp.act(v_run, 'meeting'), '<none>');
  perform pg_temp.chk('SWEEP', 'never Onboarded', pg_temp.act(v_run, 'onboarded'), '<none>');
  perform pg_temp.chk('SWEEP', 'never Live', pg_temp.act(v_run, 'live'), '<none>');
  perform pg_temp.chk('SWEEP', 'never an archived card', pg_temp.act(v_run, 'archived'), '<none>');
  perform pg_temp.chk('SWEEP', 'never a card no team member owns', pg_temp.act(v_run, 'other'), '<none>');
  perform pg_temp.chk('SWEEP', 'touched today but due later: not re-dated', pg_temp.act(v_run, 'ahead'), '<none>');
  perform pg_temp.chk('SWEEP', 'touches before the restart do not finish a card', pg_temp.act(v_run, 'old'), '<none>');
  perform pg_temp.chk('SWEEP', 'overdue counted for the first owner', j->'overdue'->>'kemi.w64571@test.local', '1');
  perform pg_temp.lk('SWEEP', 'the summary line is the script''s', j->>'summary',
    v_today::text || ' sweep (dry run): % active cards; to Lost 4; Prospect->Contacted 1; next round dated 1; overdue by owner {"kemi.w64571@test.local": 1}');
  perform pg_temp.chk('SWEEP', 'the run is stored with the line', (select summary from public.crm_cadence_sweep_runs where id = v_run), j->>'summary');
end;
$t$;

-- ───────────────────────────── DAYS ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('DAYS', 'Friday + 2 working days is Tuesday', public.crm_4571_working_days_after(date '2026-11-27', 2)::text, '2026-12-01');
  perform pg_temp.chk('DAYS', 'Thursday + 2 is Monday', public.crm_4571_working_days_after(date '2026-11-26', 2)::text, '2026-11-30');
  perform pg_temp.chk('DAYS', 'Monday + 2 is Wednesday', public.crm_4571_working_days_after(date '2026-11-23', 2)::text, '2026-11-25');
  perform pg_temp.chk('DAYS', 'Saturday + 2 is Tuesday', public.crm_4571_working_days_after(date '2026-11-28', 2)::text, '2026-12-01');
end;
$t$;

-- ───────────────────────────── SWITCH ─────────────────────────────
do $t$
declare v text; j jsonb; n integer;
begin
  perform pg_temp.chk('SWITCH', 'off by default', public.crm_4571_cadence_config()->>'mode', 'off');
  n := (select count(*) from public.crm_cadence_sweep_runs);
  j := public.crm_cadence_sweep_cron();
  perform pg_temp.chk('SWITCH', 'off: the cron entry does nothing', j::text || '/' || ((select count(*) from public.crm_cadence_sweep_runs) - n)::text, '{"mode": "off"}/0');
  perform pg_temp.chk('SWITCH', 'the job runs weekdays at 20:00 UTC (9 PM Lagos)',
    (select schedule || '|' || command from cron.job where jobname = 'issue_4571_crm_cadence_sweep'), '0 20 * * 1-5|SELECT public.crm_cadence_sweep_cron()');
  perform pg_temp.chk('SWITCH', 'the sweep itself is the server''s only',
    has_function_privilege('authenticated', 'public.crm_cadence_sweep(boolean,text)', 'execute')::text || has_function_privilege('authenticated', 'public.crm_cadence_sweep_cron()', 'execute')::text, 'falsefalse');
  v := pg_temp.person('tao', $q$select public.crm_cadence_sweep_configure('apply')::text$q$);
  perform pg_temp.lk('SWITCH', 'a growth person cannot switch it', v, 'ERR:42501:%');
  v := pg_temp.agent('seth', $q$select public.crm_cadence_sweep_configure('apply')::text$q$);
  perform pg_temp.lk('SWITCH', 'an agent cannot switch it', v, 'ERR:42501:%');
  v := pg_temp.person('tao', $q$select public.crm_cadence_sweep_status()::text$q$);
  perform pg_temp.lk('SWITCH', 'a growth person cannot read the panel', v, 'ERR:42501:%');
  v := pg_temp.person('seth', $q$select public.crm_cadence_sweep_status()::text$q$);
  perform pg_temp.chk('SWITCH', 'the owner reads the panel with the last run''s actions', (jsonb_array_length((v::jsonb)->'actions') = 6)::text, 'true');
  v := pg_temp.person('seth', $q$select public.crm_cadence_sweep_configure('dry_run')::text$q$);
  perform pg_temp.chk('SWITCH', 'the owner sets Dry run', (v::jsonb)->>'mode', 'dry_run');
  perform pg_temp.chk('SWITCH', 'the team and restart date are kept', (v::jsonb)->'team'->>0, 'tao.w64571@test.local');
  j := public.crm_cadence_sweep_cron();
  perform pg_temp.chk('SWITCH', 'dry_run: the cron entry writes a dry run', j->>'dry_run', 'true');
  v := pg_temp.person('seth', $q$select public.crm_cadence_sweep_configure('sideways')::text$q$);
  perform pg_temp.lk('SWITCH', 'an unknown mode is refused', v, 'ERR:22023:invalid_setting:%');
  v := pg_temp.person('seth', $q$select public.crm_cadence_sweep_preview()::text$q$);
  perform pg_temp.chk('SWITCH', 'a dry run now', (v::jsonb)->>'dry_run', 'true');
end;
$t$;

-- ───────────────────────────── APPLY ─────────────────────────────
do $t$
declare v text; j jsonb; v_run uuid; v_card uuid; v_today date := (now() at time zone 'Africa/Lagos')::date; v_item jsonb;
begin
  v_item := jsonb_build_object('title', 'W6c cadence report card', 'instructions', 'Read the nightly sweep report.',
    'done_means', 'It is read.', 'due_on', v_today + 3,
    'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth')));
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  v_card := ((v::jsonb)->'results'->0->'card'->>'id')::uuid;
  v := pg_temp.person('seth', format('select public.crm_cadence_sweep_configure(%L, %L::uuid)::text', 'apply', v_card));
  perform pg_temp.chk('APPLY', 'the owner switches it on with a report card', (v::jsonb)->>'mode', 'apply');
  j := public.crm_cadence_sweep_cron();
  v_run := (j->>'run_id')::uuid;
  perform pg_temp.chk('APPLY', 'a real run', j->>'dry_run', 'false');
  perform pg_temp.chk('APPLY', 'Six And Six is Lost with the reason', (select stage || '|' || stage_reason from public.crm_records where id = pg_temp.id('done')),
    format('lost|No meeting after 6 calls and 6 emails (cadence from %s)', to_char(v_today - 30, 'FMDD Mon YYYY')));
  perform pg_temp.chk('APPLY', 'the move is in the history as system',
    (select coalesce(actor_email, '<null>') || '|' || via || '|' || from_stage || '>' || to_stage from public.crm_activity where record_id = pg_temp.id('done') and kind = 'stage_move'),
    '<null>|system|contacted>lost');
  perform pg_temp.chk('APPLY', 'and audited', (select count(*)::text from public.admin_audit_log where action = 'crm.stage_move' and target_id = pg_temp.id('done')::text and admin_email = 'system'), '1');
  perform pg_temp.chk('APPLY', 'First Touch is Contacted, due in 2 working days, with its next action',
    (select stage || '|' || due_on::text || '|' || next_action from public.crm_records where id = pg_temp.id('first')),
    'contacted|' || public.crm_4571_working_days_after(v_today, 2)::text || '|Round 1 of 6: call from PressOne, then send email 1. 1 calls and 0 emails so far');
  perform pg_temp.chk('APPLY', 'Quiet In Replied stays (decision 8)', pg_temp.stage('quiet'), 'contacted');
  perform pg_temp.chk('APPLY', 'Replied, Demo booked, Onboarded and Live stay',
    pg_temp.stage('replied') || ',' || pg_temp.stage('meeting') || ',' || pg_temp.stage('onboarded') || ',' || pg_temp.stage('live'), 'replied,meeting,onboarded,live');
  perform pg_temp.chk('APPLY', 'the archived card stays', pg_temp.stage('archived'), 'contacted');
  perform pg_temp.chk('APPLY', 'every action applied', (select string_agg(distinct status, ',') from public.crm_cadence_sweep_actions where run_id = v_run), 'applied');
  perform pg_temp.lk('APPLY', 'the report is posted on the Work card',
    (select body_md from public.ops_work_messages where card_id = v_card and via = 'system'), 'Nightly cadence sweep: ' || v_today::text || ' sweep (APPLY): %');
  perform pg_temp.chk('APPLY', 'the run names its message', (select (report_message_id is not null)::text || coalesce(report_error, '') from public.crm_cadence_sweep_runs where id = v_run), 'true');
  j := public.crm_cadence_sweep(true, 'manual');
  perform pg_temp.chk('APPLY', 'the next night nothing is moved twice', (j->'counts'->>'lost') || '/' || (j->'counts'->>'contacted'), '0/0');
  v := pg_temp.person('seth', $q$select public.crm_cadence_sweep_configure('off')::text$q$);
  perform pg_temp.chk('APPLY', 'switch-off', (v::jsonb)->>'mode', 'off');
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
  if v_all < 60 then raise exception '#4571 W6c implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W6c implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W6c implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
