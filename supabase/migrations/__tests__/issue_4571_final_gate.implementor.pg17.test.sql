-- Issue #4571 final gate (the tester's P2-1, P2-2, P3-1, P3-2, P3-3) --
-- implementor suite for 20281130114571_issue_4571_final_gate_fixes.sql on the
-- fully replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-demo-or-brand-before-onboarded | gate crm_4571_demo_stage_guard (crm_4571_stage_move_ok) | test this file
-- INVARIANT crm-archived-not-promoted | gate crm_reconcile_live (archived_at IS NULL) | test this file
--
--   LIVE     P2-1: crm_reconcile_live never promotes an archived card (no
--            stage, no went_live_at, no audit row); crm_apply_brand_link leaves
--            an archived card alone; a card on the board is still promoted.
--   MERGE    P2-2: merging a brand-linked Onboarded duplicate into a Replied
--            keeper with no brand moves the brand and lands the keeper at
--            Onboarded; the undo gives the brand back and puts the keeper back
--            at Replied.
--   MLIVE    the same with a listed brand: the keeper goes Live with
--            went_live_at; the undo clears both.
--   CONFLICT two different brands are refused with both names, nothing
--            written; the undo is refused when the keeper's brand changed.
--   EXISTS   P3-1: a brand id that is not in brands, or is deleted, opens
--            nothing and the gate does not call it linked.
--   DOWN     P3-2: a brand plus a cancelled demo cannot move down into Demo
--            booked; with a booked demo it can.
--   UNLINK   P3-3: unlinking a brand at Onboarded writes one activity line.
--
-- FAILS-ON-REVERT: on the W7 schema (without 20281130114571) LIVE, MERGE,
-- MLIVE, CONFLICT, EXISTS, DOWN and UNLINK fail.
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

create function pg_temp.brand_of(p_k text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') from public.crm_records where id = pg_temp.id(p_k) $fn$;
-- Pretend every existing brand has a public listing, until live_off().
create function pg_temp.live_on() returns void
language plpgsql as $fn$
begin
  create temp table if not exists tx_live_def (def text) on commit drop;
  insert into tx_live_def select pg_get_functiondef('public.crm_brand_is_live(uuid)'::regprocedure);
  execute $q$create or replace function public.crm_brand_is_live(p_brand_id uuid) returns boolean language sql stable set search_path = ''
    as $b$ select exists (select 1 from public.brands b where b.id = p_brand_id) $b$$q$;
end;
$fn$;
create function pg_temp.live_off() returns void
language plpgsql as $fn$
begin
  execute (select def from tx_live_def limit 1);
  delete from tx_live_def;
end;
$fn$;
-- A host at Onboarded through a booked demo (the scheduler link).
create function pg_temp.onboarded_by_demo(p_k text, p_name text) returns void
language plpgsql as $fn$
begin
  perform pg_temp.host(p_k, p_name, 'replied');
  perform pg_temp.booking('b' || p_k, 'Ada', p_k || '@w7f-demo.test', p_name);
  perform pg_temp.link_token('b' || p_k, p_k);
  perform pg_temp.move('tao', p_k, 'meeting');
  perform pg_temp.move('tao', p_k, 'onboarded');
end;
$fn$;

-- ───────────────────────────── LIVE (P2-1) ─────────────────────────────
do $t$
declare v_before integer;
begin
  perform pg_temp.host('la', 'W7F Archived Brand Host', 'replied');
  perform pg_temp.brand('b_la', 'W7F Archived Brand', 'la@w7f-la.test');
  perform pg_temp.link_brand('la', 'b_la');
  perform pg_temp.chk('LIVE', 'set-up: the brand-linked host is at Onboarded', pg_temp.stage('la'), 'onboarded');
  update public.crm_records set archived_at = now(), archived_by = 'tao.w74571@test.local', archived_reason = 'Pruned' where id = pg_temp.id('la');
  perform pg_temp.host('lb', 'W7F Board Brand Host', 'replied');
  perform pg_temp.brand('b_lb', 'W7F Board Brand', 'lb@w7f-lb.test');
  perform pg_temp.link_brand('lb', 'b_lb');
  select count(*) into v_before from public.admin_audit_log l where l.action = 'crm.stage_auto_live' and l.target_id = pg_temp.id('la')::text;
  perform pg_temp.live_on();
  perform public.crm_reconcile_live();
  perform pg_temp.chk('LIVE', 'the archived card stays at Onboarded with no went_live_at',
    (select stage || '|' || coalesce(went_live_at::text, 'none') from public.crm_records where id = pg_temp.id('la')), 'onboarded|none');
  perform pg_temp.chk('LIVE', 'and no auto-live audit row',
    (select count(*)::integer - v_before from public.admin_audit_log l where l.action = 'crm.stage_auto_live' and l.target_id = pg_temp.id('la')::text)::text, '0');
  perform pg_temp.chk('LIVE', 'and no "went live" line',
    (select count(*)::text from public.crm_activity a where a.record_id = pg_temp.id('la') and a.to_stage = 'live'), '0');
  perform pg_temp.chk('LIVE', 'one card asked by id: 0 promoted', public.crm_reconcile_live(pg_temp.id('la'))::text, '0');
  perform pg_temp.chk('LIVE', 'crm_apply_brand_link leaves the archived card alone',
    coalesce(public.crm_apply_brand_link(pg_temp.id('la')), '<none>') || '|' || pg_temp.stage('la'), '<none>|onboarded');
  perform pg_temp.chk('LIVE', 'the card on the board is still promoted', pg_temp.stage('lb'), 'live');
  perform pg_temp.live_off();
end;
$t$;

-- ───────────────────────────── MERGE (P2-2) ─────────────────────────────
do $t$
declare v text; j jsonb; u jsonb;
begin
  perform pg_temp.host('mk', 'W7F Keeper Rooftop', 'replied');
  perform pg_temp.host('md', 'W7F Keeper Rooftop Lagos', 'replied');
  perform pg_temp.brand('b_md', 'W7F Rooftop Co', 'md@w7f-md.test');
  perform pg_temp.chk('MERGE', 'set-up: the duplicate is Onboarded on its brand', pg_temp.link_brand('md', 'b_md') || '|' || pg_temp.stage('md'), 'onboarded|onboarded');
  v := pg_temp.merge('mk', 'md');
  perform pg_temp.lk('MERGE', 'the merge goes through', v, '{%');
  j := v::jsonb;
  perform pg_temp.chk('MERGE', 'the brand moved to the kept card, off the duplicate',
    (pg_temp.brand_of('mk') = pg_temp.id('b_md')::text)::text || '|' || pg_temp.brand_of('md'), 'true|none');
  perform pg_temp.chk('MERGE', 'and the brand rule moved the kept card to Onboarded', pg_temp.stage('mk') || '|' || (j->>'stage_to'), 'onboarded|onboarded');
  perform pg_temp.chk('MERGE', 'no stage note: nothing was left behind', coalesce(j->>'stage_note', '<none>'), '<none>');
  perform pg_temp.chk('MERGE', 'the kept card''s log names the brand',
    (select count(*)::text from public.crm_activity a where a.record_id = pg_temp.id('mk') and a.kind = 'note'
        and a.body = 'Merged W7F Keeper Rooftop Lagos into this card. Its Mingla brand W7F Rooftop Co is now linked here.'), '1');
  perform pg_temp.chk('MERGE', 'the kept card is not Needs linking', pg_temp.gate('mk')->>'needs_linking', 'false');
  u := pg_temp.unmerge(j->>'merge_id')::jsonb;
  perform pg_temp.chk('MERGE', 'undo: the brand is back on the duplicate, off the kept card',
    (pg_temp.brand_of('md') = pg_temp.id('b_md')::text)::text || '|' || pg_temp.brand_of('mk'), 'true|none');
  perform pg_temp.chk('MERGE', 'undo: the kept card is back at Replied, the duplicate at Onboarded on the board',
    pg_temp.stage('mk') || '|' || pg_temp.stage('md') || '|' || (select (archived_at is null)::text from public.crm_records where id = pg_temp.id('md')),
    'replied|onboarded|true');
  perform pg_temp.chk('MERGE', 'undo says so', u->>'stage_note',
    'W7F Keeper Rooftop is back in Replied, where it was before the merge, and W7F Keeper Rooftop Lagos has its Mingla brand again.');
  perform pg_temp.chk('MERGE', 'and the kept card''s log has the move back',
    (select count(*)::text from public.crm_activity a where a.record_id = pg_temp.id('mk') and a.kind = 'stage_move'
        and a.from_stage = 'onboarded' and a.to_stage = 'replied'
        and a.body = 'Undid the merge: the Mingla brand went back to W7F Keeper Rooftop Lagos. Stage moved back to Replied.'), '1');
end;
$t$;

-- ───────────────────────────── MLIVE ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  perform pg_temp.host('lk', 'W7F Listed Keeper', 'contacted');
  perform pg_temp.host('ld', 'W7F Listed Keeper Two', 'replied');
  perform pg_temp.brand('b_ld', 'W7F Listed Co', 'ld@w7f-ld.test');
  perform pg_temp.link_brand('ld', 'b_ld');
  perform pg_temp.live_on();
  v := pg_temp.merge('lk', 'ld');
  j := v::jsonb;
  perform pg_temp.chk('MLIVE', 'a listed brand takes the kept card to Live, with went_live_at',
    (select stage || '|' || (went_live_at is not null)::text from public.crm_records where id = pg_temp.id('lk')) || '|' || (j->>'stage_to'), 'live|true|live');
  perform pg_temp.unmerge(j->>'merge_id');
  perform pg_temp.chk('MLIVE', 'undo: back at Contacted with no went_live_at, brand on the duplicate',
    (select stage || '|' || coalesce(went_live_at::text, 'none') from public.crm_records where id = pg_temp.id('lk')) || '|' ||
    (pg_temp.brand_of('ld') = pg_temp.id('b_ld')::text)::text, 'contacted|none|true');
  perform pg_temp.live_off();
end;
$t$;

-- ───────────────────────────── CONFLICT ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  perform pg_temp.host('ck', 'W7F Two Brands A', 'replied');
  perform pg_temp.host('cd', 'W7F Two Brands B', 'replied');
  perform pg_temp.brand('b_ck', 'W7F Brand Alpha', 'ck@w7f-ck.test');
  perform pg_temp.brand('b_cd', 'W7F Brand Beta', 'cd@w7f-cd.test');
  perform pg_temp.link_brand('ck', 'b_ck');
  perform pg_temp.link_brand('cd', 'b_cd');
  v := pg_temp.merge('ck', 'cd');
  perform pg_temp.chk('CONFLICT', 'two different brands: refused with both names', v,
    'ERR:22023:brand_conflict: W7F Two Brands A and W7F Two Brands B are linked to different Mingla brands (W7F Brand Alpha and W7F Brand Beta), so they are not the same host. Unlink the wrong brand from one card first, then merge.');
  perform pg_temp.chk('CONFLICT', 'nothing written: the duplicate is on the board with its brand',
    (select (archived_at is null)::text from public.crm_records where id = pg_temp.id('cd')) || '|' || (pg_temp.brand_of('cd') = pg_temp.id('b_cd')::text)::text, 'true|true');
  -- The undo after the kept card's brand changed.
  perform pg_temp.host('xk', 'W7F Changed Keeper', 'replied');
  perform pg_temp.host('xd', 'W7F Changed Keeper Two', 'replied');
  perform pg_temp.brand('b_xd', 'W7F Changed Co', 'xd@w7f-xd.test');
  perform pg_temp.brand('b_x2', 'W7F Other Co', 'x2@w7f-xd.test');
  perform pg_temp.link_brand('xd', 'b_xd');
  j := pg_temp.merge('xk', 'xd')::jsonb;
  update public.crm_records set brand_id = pg_temp.id('b_x2') where id = pg_temp.id('xk');
  perform pg_temp.lk('CONFLICT', 'the undo is refused when the kept card''s brand changed', pg_temp.unmerge(j->>'merge_id'),
    'ERR:22023:brand_conflict: The Mingla brand on W7F Changed Keeper changed since the merge%');
  perform pg_temp.chk('CONFLICT', 'and the duplicate stays merged', (select (archived_at is not null)::text from public.crm_records where id = pg_temp.id('xd')), 'true');
end;
$t$;

-- ───────────────────────────── EXISTS (P3-1) ─────────────────────────────
do $t$
begin
  perform pg_temp.host('e1', 'W7F Random Brand Id', 'replied');
  perform pg_temp.lk('EXISTS', 'a brand id that is in no brand opens nothing (direct write)',
    pg_temp.try(format('update public.crm_records set brand_id = gen_random_uuid(), stage = %L where id = %L::uuid', 'onboarded', pg_temp.id('e1'))),
    'ERR:22023:demo_required: Onboarded needs%');
  update public.crm_records set brand_id = gen_random_uuid() where id = pg_temp.id('e1');
  perform pg_temp.chk('EXISTS', 'and the gate does not call it linked, Onboarded locked',
    (pg_temp.gate('e1')->>'brand_linked') || '|' || (pg_temp.gate('e1')->'locked_stages' ? 'onboarded')::text, 'false|true');
  perform pg_temp.host('e2', 'W7F Deleted Brand', 'replied');
  perform pg_temp.brand('b_e2', 'W7F Deleted Co', 'e2@w7f-e2.test');
  set local session_replication_role = replica;
  update public.brands set deleted_at = now() where id = pg_temp.id('b_e2');
  set local session_replication_role = origin;
  update public.crm_records set brand_id = pg_temp.id('b_e2') where id = pg_temp.id('e2');
  perform pg_temp.lk('EXISTS', 'a deleted brand opens nothing',
    pg_temp.try(format('update public.crm_records set stage = %L where id = %L::uuid', 'onboarded', pg_temp.id('e2'))),
    'ERR:22023:demo_required: Onboarded needs%');
  perform pg_temp.chk('EXISTS', 'crm_demo_stage_allowed answers the same', public.crm_demo_stage_allowed(pg_temp.id('e2'), 'onboarded')::text, 'false');
  perform pg_temp.brand('b_e3', 'W7F Real Co', 'e3@w7f-e3.test');
  perform pg_temp.chk('EXISTS', 'a brand that exists still opens it (control)',
    pg_temp.try(format('update public.crm_records set brand_id = %L::uuid, stage = %L where id = %L::uuid', pg_temp.id('b_e3'), 'onboarded', pg_temp.id('e2'))), 'OK');
end;
$t$;

-- ───────────────────────────── DOWN (P3-2) ─────────────────────────────
do $t$
begin
  perform pg_temp.onboarded_by_demo('d1', 'W7F Cancelled Down');
  perform pg_temp.brand('b_d1', 'W7F Cancelled Down Co', 'd1@w7f-d1.test');
  update public.crm_records set brand_id = pg_temp.id('b_d1') where id = pg_temp.id('d1');
  update public.book_call_leads set status = 'cancelled', status_changed_at = now() where id = pg_temp.id('bd1');
  perform pg_temp.lk('DOWN', 'brand and a cancelled demo: down into Demo booked is refused', pg_temp.move('tao', 'd1', 'meeting'),
    'ERR:22023:demo_required: Demo booked needs%');
  perform pg_temp.lk('DOWN', 'a direct write too',
    pg_temp.try(format('update public.crm_records set stage = %L where id = %L::uuid', 'meeting', pg_temp.id('d1'))), 'ERR:22023:demo_required: Demo booked needs%');
  perform pg_temp.chk('DOWN', 'the card stays at Onboarded; the gate locks Demo booked',
    pg_temp.stage('d1') || '|' || (pg_temp.gate('d1')->'locked_stages' ? 'meeting')::text, 'onboarded|true');
  perform pg_temp.onboarded_by_demo('d2', 'W7F Booked Down');
  perform pg_temp.lk('DOWN', 'with a booked demo the move down is allowed (control)', pg_temp.move('tao', 'd2', 'meeting'), '{%');
end;
$t$;

-- ───────────────────────────── UNLINK (P3-3) ─────────────────────────────
do $t$
begin
  perform pg_temp.host('n1', 'W7F Unlinked Onboarded', 'replied');
  perform pg_temp.brand('b_n1', 'W7F Unlinked Co', 'n1@w7f-n1.test');
  perform pg_temp.link_brand('n1', 'b_n1');
  update public.crm_records set brand_id = null where id = pg_temp.id('n1');
  perform pg_temp.chk('UNLINK', 'unlinking at Onboarded: the card stays', coalesce(public.crm_apply_brand_link(pg_temp.id('n1')), '<none>') || '|' || pg_temp.stage('n1'), '<none>|onboarded');
  perform pg_temp.chk('UNLINK', 'and one line says it shows Needs linking',
    (select count(*)::text from public.crm_activity a where a.record_id = pg_temp.id('n1') and a.kind = 'note' and a.via = 'system'
        and a.body = 'Brand link removed. The card stays in Onboarded with no booked demo or Mingla brand linked, so it shows Needs linking. Link the brand or a booked demo.'), '1');
  perform pg_temp.chk('UNLINK', 'the card shows Needs linking', pg_temp.gate('n1')->>'needs_linking', 'true');
  perform pg_temp.onboarded_by_demo('n2', 'W7F Unlinked With Demo');
  perform pg_temp.brand('b_n2', 'W7F Unlinked Demo Co', 'n2@w7f-n2.test');
  perform pg_temp.link_brand('n2', 'b_n2');
  update public.crm_records set brand_id = null where id = pg_temp.id('n2');
  perform public.crm_apply_brand_link(pg_temp.id('n2'));
  perform pg_temp.chk('UNLINK', 'with a booked demo the line says the demo holds it',
    (select count(*)::text from public.crm_activity a where a.record_id = pg_temp.id('n2') and a.kind = 'note'
        and a.body = 'Brand link removed. The card stays in Onboarded on its linked demo.'), '1');
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
  if v_all < 35 then raise exception '#4571 final-gate implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 final-gate implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 final-gate implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
