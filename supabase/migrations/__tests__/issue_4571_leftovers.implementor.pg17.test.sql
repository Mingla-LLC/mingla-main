-- Issue #4571 last leftovers: implementor suite for 20281126124571_issue_4571_leftovers.sql
-- on the fully replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-archived-not-counted | gate crm_team_pulse + ops_brand_exact_rows (archived_at IS NULL) | test this file
--
--   PULSE  the Team dashboard's "went live" numbers (hosts_onboarded and
--          moves.hosts.live) drop a card once it is archived; a card on the
--          board still counts.
--   MATCH  ops_brand_match never offers to link a brand to an archived card
--          through an exact email match; a card on the board still links.
--
-- FAILS-ON-REVERT: on the schema without 20281126124571, PULSE and MATCH fail.
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


-- ───────────────────────────── PULSE ─────────────────────────────
create function pg_temp.pulse(p_path text[]) returns text
language sql as $fn$
  select pg_temp.person('seth', format('select (public.crm_team_pulse(now() - interval ''1 day'', now() + interval ''1 hour'') #>> %L)', p_path))
$fn$;
do $t$
begin
  perform pg_temp.host('pa', 'W7L Live Board Host', 'replied');
  perform pg_temp.host('pb', 'W7L Live Archived Host', 'replied');
  perform pg_temp.brand('b_pa', 'W7L Board Brand', 'pa@w7l-pa.test');
  perform pg_temp.brand('b_pb', 'W7L Archived Brand', 'pb@w7l-pb.test');
  perform pg_temp.link_brand('pa', 'b_pa');
  perform pg_temp.link_brand('pb', 'b_pb');
  perform pg_temp.live_on();
  perform public.crm_reconcile_live();
  perform pg_temp.chk('PULSE', 'set-up: both hosts went Live', pg_temp.stage('pa') || '|' || pg_temp.stage('pb'), 'live|live');
  perform pg_temp.chk('PULSE', 'before archiving, both count as onboarded or live (>= 2)',
    (coalesce(pg_temp.pulse('{now,hosts_onboarded}')::int, 0) >= 2)::text, 'true');
  perform pg_temp.chk('PULSE', 'before archiving, both count in the Live moves (>= 2)',
    (coalesce(pg_temp.pulse('{now,moves,hosts,live}')::int, 0) >= 2)::text, 'true');
  create temp table tx_pulse_before on commit drop as
    select pg_temp.pulse('{now,hosts_onboarded}')::int as onb, pg_temp.pulse('{now,moves,hosts,live}')::int as lv;
  update public.crm_records set archived_at = now(), archived_by = 'tao.w74571@test.local', archived_reason = 'Pruned' where id = pg_temp.id('pb');
  perform pg_temp.chk('PULSE', 'archiving one card drops hosts_onboarded by exactly one',
    ((select onb from tx_pulse_before) - pg_temp.pulse('{now,hosts_onboarded}')::int)::text, '1');
  perform pg_temp.chk('PULSE', 'archiving one card drops the Live move count by exactly one',
    ((select lv from tx_pulse_before) - pg_temp.pulse('{now,moves,hosts,live}')::int)::text, '1');
end;
$t$;

-- ───────────────────────────── MATCH ─────────────────────────────
do $t$
declare v_s text;
begin
  perform pg_temp.host('ma', 'W7L Archived Match Host', 'replied');
  perform pg_temp.ident('ma', 'email', 'ma@w7l-ma.test');
  perform pg_temp.brand('b_ma', 'W7L Match Brand A', 'ma@w7l-ma.test');
  perform pg_temp.chk('MATCH', 'a card on the board matching exactly is offered as a link',
    public.ops_brand_match(pg_temp.id('b_ma'))->>'status', 'link');
  update public.crm_records set archived_at = now(), archived_by = 'tao.w74571@test.local', archived_reason = 'Pruned' where id = pg_temp.id('ma');
  v_s := public.ops_brand_match(pg_temp.id('b_ma'))->>'status';
  perform pg_temp.chk('MATCH', 'once archived, the brand is never offered a link to it', (v_s <> 'link')::text, 'true');
  perform pg_temp.chk('MATCH', 'and the exact-match helper returns no rows for it',
    (public.ops_brand_exact_rows(public.ops_brand_idents(pg_temp.id('b_ma')), public.ops_brand_country(pg_temp.id('b_ma'))))::text, '[]');
  perform pg_temp.chk('MATCH', 'and no new-exact host is listed', cardinality(public.ops_brand_new_exact(pg_temp.id('b_ma'), gen_random_uuid()))::text, '0');
end;
$t$;

do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 9 then raise exception '#4571 leftovers implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 leftovers implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 leftovers implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
