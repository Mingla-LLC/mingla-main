-- Issue #4571 W7 (a linked brand counts too, Seth's decision (d)) --
-- implementor suite for 20281130104571_issue_4571_w7_brand_counts.sql on the
-- fully replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-demo-or-brand-before-onboarded | gate crm_4571_demo_stage_guard (crm_4571_stage_move_ok) | test this file
-- INVARIANT crm-demo-before-demo-booked | gate crm_4571_demo_stage_guard (crm_4571_stage_move_ok) | test this file
--
--   SELF     a self-serve brand sign-up (ops_brand_autolink_one, "create")
--            lands its new host card at Onboarded; an exact-match "link"
--            moves an existing Replied card to Onboarded; crm_apply_brand_link
--            moves a Contacted card to Onboarded.
--   NONE     a host with no demo and no brand cannot reach Onboarded (a
--            person's move, a direct write, an insert); the refusal names
--            Onboarded and says demo or brand.
--   MEETING  a brand only never opens Demo booked: not from Replied, not as
--            an insert, not down from Onboarded.
--   GATE     demo_gate: a brand-linked host below the band has only Demo
--            booked locked; a no-link host has all three; a brand-linked
--            Onboarded host is not "Needs linking" and not "Demo cancelled".
--   FORMS    the #4452 automation (forms_move_stage) moves a brand-linked
--            host to Onboarded; a no-link host is still skipped and audited.
--   UNLINK   a demo can be unlinked from a brand-linked Onboarded host; not
--            from a no-brand one.
--   GRANTS   the rule is the server's only.
--   UNMERGE  undoing a merge that leaves the kept Onboarded host with its
--            brand is allowed; without the brand it is refused.
--
-- FAILS-ON-REVERT: on the W6d schema (without 20281130104571) SELF, NONE's
-- wording, GATE, FORMS, UNLINK and UNMERGE fail: the brand never counts.
--
-- Run from the repository root as supabase_admin.


\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45780000-0000-4000-c000-000000000001', 'seth.w74571@test.local'),
  ('tao',  '45780000-0000-4000-c000-000000000002', 'tao.w74571@test.local'),
  ('kemi', '45780000-0000-4000-c000-000000000003', 'kemi.w74571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('seth.w74571@test.local', 'owner', 'active', now());
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
  values (v_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, 'seth.w74571@test.local', 'seth.w74571@test.local');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (v_id, 'tao.w74571@test.local', 'seth.w74571@test.local');
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
  values (v_id, 'slot:w7-' || p_k, p_audience, p_name, p_email, case when p_audience = 'host' then p_venue end,
          case when p_audience = 'host' then 'restaurants' end, case when p_audience = 'host' then null else 'Lagos' end,
          case when p_audience = 'creator' then 'video' end,
          'instagram', 'https://instagram.com/' || p_k, p_created + interval '2 days', p_created, p_phone);
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
create function pg_temp.link_token(p_booking text, p_card text) returns text
language sql as $fn$
  select pg_temp.svc(format('select public.crm_demo_link_from_token(%L, %L::uuid)::text',
    'slot:w7-' || p_booking, (select schedule_token from public.crm_records where id = pg_temp.id(p_card))))
$fn$;
create function pg_temp.gw(p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform pg_temp.next_request();
  begin
    set local role service_role;
    execute format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_tool, p_args, 'w74571-test/1.0') into v_out;
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

create function pg_temp.rk() returns text language sql as $fn$ select 'w7-' || md5(random()::text || clock_timestamp()::text) $fn$;
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
  values (pg_temp.id(p_k), p_kind, p_value, public.crm_ident_key(p_kind, p_value), 'seth.w74571@test.local')
$fn$;
create function pg_temp.note(p_k text, p_body text) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, body) values (pg_temp.id(p_k), 'note', 'tao.w74571@test.local', p_body)
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

-- Brands for the suite (no listing, so a linked host lands at Onboarded).
create function pg_temp.brand(p_k text, p_name text, p_email text) returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, contact_email, contact_phone)
  values (v_id, gen_random_uuid(), p_name, 'w74571-' || p_k || '-' || left(md5(v_id::text), 6), 'Lagos', p_email, null);
  set local session_replication_role = origin;
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
-- Link a brand the way the brand flow writes it: the column, then crm_apply_brand_link.
create function pg_temp.link_brand(p_card text, p_brand text) returns text
language plpgsql as $fn$
begin
  update public.crm_records set brand_id = pg_temp.id(p_brand), updated_at = now() where id = pg_temp.id(p_card);
  return coalesce(public.crm_apply_brand_link(pg_temp.id(p_card)), '<none>');
end;
$fn$;
create function pg_temp.gate(p_k text) returns jsonb
language sql as $fn$ select public.crm_record_json(c)->'demo_gate' from public.crm_records c where c.id = pg_temp.id(p_k) $fn$;

-- ───────────────────────────── SELF ─────────────────────────────
do $t$
declare v jsonb; v_card uuid;
begin
  perform pg_temp.brand('b_new', 'W7 Fresh Rooftop', 'hello@w7-fresh-rooftop.test');
  v := public.ops_brand_autolink_one(pg_temp.id('b_new'));
  perform pg_temp.chk('SELF', 'a self-serve brand with no host card makes one', v->>'status', 'created');
  select c.id into v_card from public.crm_records c where c.brand_id = pg_temp.id('b_new') and c.pipeline = 'hosts' and c.deleted_at is null;
  perform pg_temp.keep('c_new', v_card);
  perform pg_temp.chk('SELF', 'the new host card lands at Onboarded, not Prospect', pg_temp.stage('c_new'), 'onboarded');
  perform pg_temp.chk('SELF', 'its log says why',
    (select count(*)::text from public.crm_activity a where a.record_id = v_card and a.kind = 'stage_move' and a.to_stage = 'onboarded'
        and a.body = 'Linked to W7 Fresh Rooftop. Stage moved to Onboarded.'), '1');
  perform pg_temp.chk('SELF', 'and it is not Needs linking', (pg_temp.gate('c_new')->>'needs_linking'), 'false');

  -- An existing Replied card matched exactly by email links by itself and moves.
  perform pg_temp.host('c_old', 'W7 Matched Lounge', 'replied');
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
  values (pg_temp.id('c_old'), 'email', 'owner@w7-matched.test', public.crm_ident_key('email', 'owner@w7-matched.test'), 'seth.w74571@test.local');
  perform pg_temp.brand('b_match', 'W7 Matched Lounge Brand', 'owner@w7-matched.test');
  v := public.ops_brand_autolink_one(pg_temp.id('b_match'));
  perform pg_temp.chk('SELF', 'the exact match links by itself', v->>'status', 'linked');
  perform pg_temp.chk('SELF', 'and the Replied card moves to Onboarded', pg_temp.stage('c_old'), 'onboarded');

  -- crm_apply_brand_link, the brand link every path calls.
  perform pg_temp.host('c_link', 'W7 Linked By Hand', 'contacted');
  perform pg_temp.brand('b_link', 'W7 Linked By Hand Brand', 'hand@w7-link.test');
  perform pg_temp.chk('SELF', 'linking a brand moves a Contacted host to Onboarded', pg_temp.link_brand('c_link', 'b_link') || '|' || pg_temp.stage('c_link'), 'onboarded|onboarded');
end;
$t$;

-- ───────────────────────────── NONE ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.host('n1', 'W7 No Links Cafe', 'replied');
  v := pg_temp.move('tao', 'n1', 'onboarded');
  perform pg_temp.chk('NONE', 'no demo and no brand: Onboarded is refused, naming demo or brand', v,
    'ERR:22023:demo_required: Onboarded needs a demo booked through the scheduler and linked to this card, or the host''s Mingla brand linked. Send the card''s scheduler link, or link the brand on the card.');
  perform pg_temp.chk('NONE', 'and the card stays at Replied', pg_temp.stage('n1'), 'replied');
  perform pg_temp.lk('NONE', 'a direct write is refused too',
    pg_temp.try(format('update public.crm_records set stage = %L where id = %L::uuid', 'onboarded', pg_temp.id('n1'))), 'ERR:22023:demo_required: Onboarded needs%');
  perform pg_temp.lk('NONE', 'a new host cannot be inserted at Onboarded without a brand',
    pg_temp.try($q$insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
                   values ('hosts', 'W7 Insert No Brand', 'onboarded', 'seth.w74571@test.local', 'seth.w74571@test.local')$q$),
    'ERR:22023:demo_required: Onboarded needs%');
  perform pg_temp.brand('b_ins', 'W7 Insert Brand', 'ins@w7-ins.test');
  perform pg_temp.chk('NONE', 'a new host carrying a brand may start at Onboarded',
    pg_temp.try(format($q$insert into public.crm_records (pipeline, name, stage, brand_id, created_by, updated_by)
                   values ('hosts', 'W7 Insert With Brand', 'onboarded', %L::uuid, 'seth.w74571@test.local', 'seth.w74571@test.local')$q$, pg_temp.id('b_ins'))),
    'OK');
  perform pg_temp.chk('NONE', 'crm_demo_stage_allowed answers the same',
    public.crm_demo_stage_allowed(pg_temp.id('n1'), 'onboarded')::text, 'false');
end;
$t$;

-- ───────────────────────────── MEETING ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.host('m1', 'W7 Brand Only Bar', 'replied');
  perform pg_temp.brand('b_m1', 'W7 Brand Only Bar Brand', 'm1@w7-m1.test');
  -- The brand column alone (no stage write yet).
  update public.crm_records set brand_id = pg_temp.id('b_m1') where id = pg_temp.id('m1');
  v := pg_temp.move('tao', 'm1', 'meeting');
  perform pg_temp.chk('MEETING', 'a brand only: Demo booked is refused with the demo sentence', v,
    'ERR:22023:demo_required: Demo booked needs a Google Meet booked through the scheduler and linked to this card. Send the card''s scheduler link, or link the booking on Needs linking.');
  perform pg_temp.chk('MEETING', 'the card stays at Replied', pg_temp.stage('m1'), 'replied');
  perform pg_temp.chk('MEETING', 'crm_demo_stage_allowed: Demo booked no, Onboarded yes',
    public.crm_demo_stage_allowed(pg_temp.id('m1'), 'meeting')::text || '/' || public.crm_demo_stage_allowed(pg_temp.id('m1'), 'onboarded')::text, 'false/true');
  perform pg_temp.lk('MEETING', 'a person can move a brand-linked host to Onboarded', pg_temp.move('tao', 'm1', 'onboarded'), '{%');
  perform pg_temp.chk('MEETING', 'it is there', pg_temp.stage('m1'), 'onboarded');
  perform pg_temp.lk('MEETING', 'down from Onboarded into Demo booked is refused for a brand-only host',
    pg_temp.move('tao', 'm1', 'meeting'), 'ERR:22023:demo_required: Demo booked needs%');
  perform pg_temp.lk('MEETING', 'an insert at Demo booked is refused even with a brand',
    pg_temp.try(format($q$insert into public.crm_records (pipeline, name, stage, brand_id, created_by, updated_by)
                   values ('hosts', 'W7 Insert Meeting', 'meeting', %L::uuid, 'seth.w74571@test.local', 'seth.w74571@test.local')$q$, pg_temp.id('b_m1'))),
    'ERR:22023:demo_required: Demo booked needs%');
end;
$t$;

-- ───────────────────────────── GATE ─────────────────────────────
do $t$
declare g jsonb;
begin
  perform pg_temp.host('g1', 'W7 Gate No Links', 'replied');
  g := pg_temp.gate('g1');
  perform pg_temp.chk('GATE', 'no links: all three band stages locked', g->>'locked_stages', '["meeting", "onboarded", "live"]');
  perform pg_temp.chk('GATE', 'locked, with the brand hint in the reason', (g->>'locked') || '|' || (g->>'reason'),
    'true|Demo booked means a Google Meet booked through the scheduler and linked here. Send the scheduler link, or link a demo they already booked. Onboarded also opens once the host''s Mingla brand is linked.');
  perform pg_temp.chk('GATE', 'a reason per locked stage', g->'reasons'->>'onboarded',
    'Onboarded needs a demo booked through the scheduler and linked to this card, or the host''s Mingla brand linked. Send the card''s scheduler link, or link the brand on the card.');
  perform pg_temp.host('g2', 'W7 Gate Brand Below', 'replied');
  perform pg_temp.brand('b_g2', 'W7 Gate Brand', 'g2@w7-g2.test');
  update public.crm_records set brand_id = pg_temp.id('b_g2') where id = pg_temp.id('g2');
  g := pg_temp.gate('g2');
  perform pg_temp.chk('GATE', 'brand linked below the band: only Demo booked is locked',
    (g->>'locked_stages') || '|' || (g->>'locked') || '|' || (g->>'brand_linked'), '["meeting"]|true|true');
  perform pg_temp.chk('GATE', 'and the reason says Onboarded is open', g->>'reason',
    'Demo booked means a Google Meet booked through the scheduler and linked here. This host''s Mingla brand is linked, so Onboarded is open.');
  -- A brand-linked Onboarded host whose demo was cancelled.
  perform pg_temp.host('g3', 'W7 Gate Cancelled', 'replied');
  perform pg_temp.booking('bg3', 'Ife', 'ife@w7-g3.test', 'W7 Gate Cancelled');
  perform pg_temp.link_token('bg3', 'g3');
  perform pg_temp.move('tao', 'g3', 'meeting');
  perform pg_temp.move('tao', 'g3', 'onboarded');
  perform pg_temp.brand('b_g3', 'W7 Gate Cancelled Brand', 'g3@w7-g3.test');
  update public.crm_records set brand_id = pg_temp.id('b_g3') where id = pg_temp.id('g3');
  update public.book_call_leads set status = 'cancelled', status_changed_at = now() where id = pg_temp.id('bg3');
  g := pg_temp.gate('g3');
  perform pg_temp.chk('GATE', 'brand-linked Onboarded with a cancelled demo: not Needs linking, not Demo cancelled',
    (g->>'needs_linking') || '|' || (g->>'demo_cancelled'), 'false|false');
  perform pg_temp.chk('GATE', 'and not on Demos cancelled',
    (select count(*)::text from jsonb_array_elements((pg_temp.person('tao', 'select public.crm_demo_inbox()::text')::jsonb)->'cancelled') x
      where (x->>'record_id')::uuid = pg_temp.id('g3')), '0');
  -- The same card with its brand unlinked is missing both.
  update public.crm_records set brand_id = null where id = pg_temp.id('g3');
  g := pg_temp.gate('g3');
  perform pg_temp.chk('GATE', 'unlinked brand: Needs linking and Demo cancelled again',
    (g->>'needs_linking') || '|' || (g->>'demo_cancelled'), 'true|true');
end;
$t$;

-- ───────────────────────────── FORMS ─────────────────────────────
do $t$
begin
  perform pg_temp.host('f1', 'W7 Form Brand Host', 'replied');
  perform pg_temp.brand('b_f1', 'W7 Form Brand', 'f1@w7-f1.test');
  update public.crm_records set brand_id = pg_temp.id('b_f1') where id = pg_temp.id('f1');
  perform public.forms_move_stage(pg_temp.id('f1'), 'onboarded', 'form_w7');
  perform pg_temp.chk('FORMS', 'the #4452 automation moves a brand-linked host to Onboarded', pg_temp.stage('f1'), 'onboarded');
  perform pg_temp.host('f2', 'W7 Form No Links', 'replied');
  perform public.forms_move_stage(pg_temp.id('f2'), 'onboarded', 'form_w7');
  perform pg_temp.chk('FORMS', 'a no-link host is still skipped, and audited',
    pg_temp.stage('f2') || '|' || (select count(*)::text from public.admin_audit_log l
      where l.action = 'crm.stage_move_skipped' and l.target_id = pg_temp.id('f2')::text and l.metadata->>'reason' = 'demo_required'), 'replied|1');
end;
$t$;

-- ───────────────────────────── UNLINK ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.host('u1', 'W7 Unlink Brand', 'replied');
  perform pg_temp.booking('bu1', 'Ola', 'ola@w7-u1.test', 'W7 Unlink Brand');
  perform pg_temp.link_token('bu1', 'u1');
  perform pg_temp.move('tao', 'u1', 'meeting');
  perform pg_temp.move('tao', 'u1', 'onboarded');
  perform pg_temp.brand('b_u1', 'W7 Unlink Brand Co', 'u1@w7-u1.test');
  update public.crm_records set brand_id = pg_temp.id('b_u1') where id = pg_temp.id('u1');
  v := pg_temp.person('tao', format('select public.crm_demo_unlink(%L::uuid)::text', pg_temp.id('bu1')));
  perform pg_temp.chk('UNLINK', 'a brand-linked Onboarded host may lose its only demo', (v not like 'ERR:%')::text || '|' || pg_temp.stage('u1'), 'true|onboarded');
  perform pg_temp.host('u2', 'W7 Unlink No Brand', 'replied');
  perform pg_temp.booking('bu2', 'Ola', 'ola2@w7-u2.test', 'W7 Unlink No Brand');
  perform pg_temp.link_token('bu2', 'u2');
  perform pg_temp.move('tao', 'u2', 'meeting');
  perform pg_temp.move('tao', 'u2', 'onboarded');
  v := pg_temp.person('tao', format('select public.crm_demo_unlink(%L::uuid)::text', pg_temp.id('bu2')));
  perform pg_temp.lk('UNLINK', 'without a brand it is still refused', v, 'ERR:22023:demo_in_use:%');
end;
$t$;

-- ───────────────────────────── UNMERGE ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  -- Kept K (brand linked) at Replied; duplicate D at Demo booked with its demo.
  perform pg_temp.host('k1', 'W7 Keeper Grill', 'replied');
  perform pg_temp.host('d1', 'W7 Keeper Grill Lagos', 'replied');
  perform pg_temp.booking('bd1', 'Ada', 'ada@w7-keeper.test', 'W7 Keeper Grill');
  perform pg_temp.link_token('bd1', 'd1');
  perform pg_temp.move('tao', 'd1', 'meeting');
  perform pg_temp.brand('b_k1', 'W7 Keeper Grill Co', 'k1@w7-keeper.test');
  update public.crm_records set brand_id = pg_temp.id('b_k1') where id = pg_temp.id('k1');
  j := pg_temp.merge('k1', 'd1')::jsonb;
  perform pg_temp.lk('UNMERGE', 'the kept card can then move to Onboarded', pg_temp.move('tao', 'k1', 'onboarded'), '{%');
  v := pg_temp.unmerge(j->>'merge_id');
  perform pg_temp.chk('UNMERGE', 'undoing leaves the kept Onboarded host with its brand: allowed',
    (v not like 'ERR:%')::text || '|' || pg_temp.stage('k1') || '|' || public.crm_record_has_demo(pg_temp.id('d1'))::text, 'true|onboarded|true');
  -- The same without a brand is refused.
  perform pg_temp.host('k2', 'W7 Keeper Two', 'replied');
  perform pg_temp.host('d2', 'W7 Keeper Two Lagos', 'replied');
  perform pg_temp.booking('bd2', 'Bo', 'bo@w7-keeper2.test', 'W7 Keeper Two');
  perform pg_temp.link_token('bd2', 'd2');
  perform pg_temp.move('tao', 'd2', 'meeting');
  j := pg_temp.merge('k2', 'd2')::jsonb;
  perform pg_temp.move('tao', 'k2', 'onboarded');
  v := pg_temp.unmerge(j->>'merge_id');
  perform pg_temp.lk('UNMERGE', 'without the brand the undo is refused', v, 'ERR:22023:demo_in_use:%');
end;
$t$;

-- ───────────────────────────── GRANTS ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('GRANTS', 'the rule and its words are the server''s only',
    has_function_privilege('authenticated', 'public.crm_4571_stage_move_ok(uuid,text,text,text,timestamptz,uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.crm_4571_stage_refusal(text)', 'EXECUTE')::text, 'false/false');
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
  if v_all < 30 then raise exception '#4571 W7 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W7 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W7 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
