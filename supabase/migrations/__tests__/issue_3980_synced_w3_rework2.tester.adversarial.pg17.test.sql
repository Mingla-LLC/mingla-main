-- Issue #3980 synced program, Wave 3 rework 2 retest: tester adversarial suite, on the fully replayed PG17 schema.
--
-- Different angles from the implementor's rework 2 suite (each check is recorded and reported together):
--   N2-T   phone numbers read in their own country, attacked with the pairs a
--          person would actually type: a card in a known country never
--          borrows the other side's country (a Memphis card and a Lagos
--          brand, a London card and a Lagos brand, both written nationally);
--          the country code is taken from the other side's number with its
--          real length (Ireland +353); the US and Canada share +1; a US
--          dial-out 011 is not read as a UK number; two different full
--          numbers are never the same; and a match that is not exact never
--          moves the host card's stage
--   SHARE  a number two cards share exactly, or exactly on one card and
--          nearly on another, always goes to a person
--   N3-T   a go-live card a person declined in an earlier round opens again
--          after a later weekly round; flipping weekly and back five times
--          keeps one go-live card in all, open once
--   N4-T   a monthly series that started 40 days ago keeps its next monthly
--          date; a weekly series whose next date is today keeps today
--   BUDGET 27 brands that stop the run and 3 new ones: the first run tries
--          25, the second reaches the 3 new ones; the wait doubles from 1
--          hour to a 7 day ceiling; a brand settled on its next try loses
--          its wait
--   SYS    a pick card Mingla itself closed is not a person's decision: the
--          brand is asked about again

\set ON_ERROR_STOP on
begin;

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  identity_data jsonb
);
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create temp table t3980w3t2_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w3t2_people (who, id, email) values
  ('owner',  '3a910000-0000-4000-a000-000000000001', 'ed.w3t23980@test.local'),
  ('growth', '3a910000-0000-4000-a000-000000000003', 'ada.w3t23980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w3t2_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3t23980@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3t23980@test.local', 'growth', 'active', now());

create temp table t3980w3t2_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w3t2_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t3980w3t2_people where who = p_who;
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

create function pg_temp.w3t2_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.w3t2_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.w3t2_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3t2_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w3t2_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3t2_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w3t2_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.w3t2_today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;

create function pg_temp.w3t2_brand_of(p_record text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') from public.crm_records where id = p_record::uuid $fn$;

-- The open cards counted from a promised date, as "<count>:<kinds>".
create function pg_temp.w3t2_open(p_exp text) returns text
language sql as $fn$
  select count(*)::text || ':' || coalesce(string_agg(split_part(w.auto_key, ':', 1), ',' order by w.auto_key), '')
    from public.ops_work_cards w
   where w.status <> 'done' and w.archived_at is null and w.auto_key like '%' || p_exp
$fn$;

create function pg_temp.w3t2_stage(p_record text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') || '/' || stage from public.crm_records where id = p_record::uuid $fn$;

create function pg_temp.w3t2_same(p_card text, p_cc text, p_brand text, p_bc text) returns text
language sql as $fn$ select coalesce(public.ops_phone_same(public.crm_ident_key('phone', p_card), p_cc, public.crm_ident_key('phone', p_brand), p_bc)::text, 'null') $fn$;

-- ---------------------------------------------------------------------------
-- N2-T: phone numbers in their own country.
-- ---------------------------------------------------------------------------
do $n2t$
begin
  perform pg_temp.w3t2_check('N2-T', 'a Lagos card 0901 and a Memphis brand +1 901 are different numbers',
    pg_temp.w3t2_same('0901 234 5678', 'NG', '+1 901 234 5678', 'US'), 'false');
  perform pg_temp.w3t2_check('N2-T', 'a Memphis card (901) and a Lagos brand 0901, both written nationally, are different',
    pg_temp.w3t2_same('(901) 234-5678', 'US', '0901 234 5678', 'NG'), 'false');
  perform pg_temp.w3t2_check('N2-T', 'a London card 07911 and a Lagos brand 07911, both written nationally, are different',
    pg_temp.w3t2_same('07911 123456', 'GB', '07911 123456', 'NG'), 'false');
  perform pg_temp.w3t2_check('N2-T', 'a Lagos card written without its 0 and a Memphis brand +1 are different',
    pg_temp.w3t2_same('901 234 5678', 'NG', '+1 901 234 5678', 'US'), 'false');
  perform pg_temp.w3t2_check('N2-T', 'a London card 07911 and a brand with no country written +44 7911 are the same',
    pg_temp.w3t2_same('07911 123456', 'GB', '+44 7911 123456', null), 'true');
  perform pg_temp.w3t2_check('N2-T', 'a London card +44 (0)7911 and a London brand 07911 are the same',
    pg_temp.w3t2_same('+44 (0)7911 123456', 'GB', '07911 123456', 'GB'), 'true');
  perform pg_temp.w3t2_check('N2-T', 'a card with no country 087 and +353 87 take the 3-digit Irish code from that number',
    pg_temp.w3t2_same('087 123 4567', null, '+353 87 123 4567', null), 'true');
  perform pg_temp.w3t2_check('N2-T', 'a US card 1-901 (11 digits) and its +1 form are the same',
    pg_temp.w3t2_same('1 901 234 5678', 'US', '+1 901 234 5678', 'US'), 'true');
  perform pg_temp.w3t2_check('N2-T', 'a US card and a Canadian brand share +1',
    pg_temp.w3t2_same('901 234 5678', 'US', '901 234 5678', 'CA'), 'true');
  perform pg_temp.w3t2_check('N2-T', 'a US dial-out 011 44 is not read as the UK number',
    pg_temp.w3t2_same('011 44 7911 123456', 'US', '+44 7911 123456', 'GB'), 'false');
  perform pg_temp.w3t2_check('N2-T', 'two different full numbers are never the same, whatever the countries',
    pg_temp.w3t2_same('+1 901 234 5678', 'NG', '+234 901 234 5678', 'US'), 'false');
  perform pg_temp.w3t2_check('N2-T', 'a country not on the list never reads a national number',
    pg_temp.w3t2_same('0621 123 456', 'LU', '+352 621 123 456', 'LU'), 'false');
end;
$n2t$;

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('3a910000-0000-4000-e000-000000000001', 'w3t2-lagos', 'W3T2 Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5),
  ('3a910000-0000-4000-e000-000000000002', 'w3t2-memphis', 'W3T2 Memphis', 'United States', 'US', 35.1, -90.0, 35.0, -90.1, 35.2, -89.9),
  ('3a910000-0000-4000-e000-000000000003', 'w3t2-london', 'W3T2 London', 'United Kingdom', 'GB', 51.5, -0.1, 51.4, -0.2, 51.6, 0.0);
insert into public.crm_records (id, pipeline, name, stage, region_id, created_by, updated_by) values
  ('3a910000-0000-4000-c100-000000000001', 'hosts', 'W3T2 Memphis Host', 'contacted', '3a910000-0000-4000-e000-000000000002', 'w3t2', 'w3t2'),
  ('3a910000-0000-4000-c100-000000000002', 'hosts', 'W3T2 London Host', 'contacted', '3a910000-0000-4000-e000-000000000003', 'w3t2', 'w3t2'),
  ('3a910000-0000-4000-c100-000000000003', 'hosts', 'W3T2 Shared One', 'contacted', '3a910000-0000-4000-e000-000000000001', 'w3t2', 'w3t2'),
  ('3a910000-0000-4000-c100-000000000004', 'hosts', 'W3T2 Shared Two', 'contacted', '3a910000-0000-4000-e000-000000000001', 'w3t2', 'w3t2'),
  ('3a910000-0000-4000-c100-000000000005', 'hosts', 'W3T2 Exact Lagos', 'contacted', '3a910000-0000-4000-e000-000000000001', 'w3t2', 'w3t2'),
  ('3a910000-0000-4000-c100-000000000006', 'hosts', 'W3T2 Near Memphis', 'contacted', '3a910000-0000-4000-e000-000000000002', 'w3t2', 'w3t2'),
  ('3a910000-0000-4000-c100-000000000007', 'hosts', 'W3T2 System Twin A', 'contacted', null, 'w3t2', 'w3t2'),
  ('3a910000-0000-4000-c100-000000000008', 'hosts', 'W3T2 System Twin B', 'contacted', null, 'w3t2', 'w3t2');
insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by)
select r::uuid, k, null, val, public.crm_ident_key(k, val), 'w3t2' from (values
  ('3a910000-0000-4000-c100-000000000001', 'phone', '(901) 234-5678'),
  ('3a910000-0000-4000-c100-000000000002', 'phone', '07911 123456'),
  ('3a910000-0000-4000-c100-000000000003', 'phone', '0803 777 8899'),
  ('3a910000-0000-4000-c100-000000000004', 'phone', '+234 803 777 8899'),
  ('3a910000-0000-4000-c100-000000000005', 'phone', '0805 222 3344'),
  ('3a910000-0000-4000-c100-000000000006', 'phone', '(805) 222-3344'),
  ('3a910000-0000-4000-c100-000000000007', 'email', 'systwin@w3t23980.test'),
  ('3a910000-0000-4000-c100-000000000008', 'email', 'systwin@w3t23980.test')) t(r, k, val);

update public.ops_settings set value = to_jsonb(now() - interval '3 hours') where key = 'brand_auto_since';
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, contact_phone, social_links, created_at) values
  ('3a910000-0000-4000-b100-000000000001', '3a910000-0000-4000-b900-000000000001', 'W3T2 Lagos Lounge', 'w3t2-lagos-lounge', 'Lagos', 'NG', null, '0901 234 5678', '{}', now() - interval '170 minutes'),
  ('3a910000-0000-4000-b100-000000000002', '3a910000-0000-4000-b900-000000000002', 'W3T2 Lagos Seven', 'w3t2-lagos-seven', 'Lagos', 'NG', null, '07911 123456', '{}', now() - interval '169 minutes'),
  ('3a910000-0000-4000-b100-000000000003', '3a910000-0000-4000-b900-000000000003', 'W3T2 Shared Brand', 'w3t2-shared', 'Lagos', 'NG', null, '0803 777 8899', '{}', now() - interval '168 minutes'),
  ('3a910000-0000-4000-b100-000000000004', '3a910000-0000-4000-b900-000000000004', 'W3T2 Exact And Near', 'w3t2-exact-near', 'Lagos', 'NG', null, '+234 805 222 3344', '{}', now() - interval '167 minutes'),
  ('3a910000-0000-4000-b100-000000000005', '3a910000-0000-4000-b900-000000000005', 'W3T2 System Closed', 'w3t2-system-closed', 'Lagos', 'NG', 'systwin@w3t23980.test', null, '{}', now() - interval '166 minutes');
set local session_replication_role = origin;

do $share$
declare v jsonb;
begin
  v := public.ops_brand_autolink();
  perform pg_temp.w3t2_check('N2-T', 'a Lagos brand 0901 never links a Memphis-region card (901), and its stage stays',
    pg_temp.w3t2_stage('3a910000-0000-4000-c100-000000000001'), 'none/contacted');
  perform pg_temp.w3t2_check('N2-T', 'a Lagos brand 07911 never links a London-region card 07911, and its stage stays',
    pg_temp.w3t2_stage('3a910000-0000-4000-c100-000000000002'), 'none/contacted');
  perform pg_temp.w3t2_check('N2-T', 'both go to a person as cards to pick',
    (select count(*)::text from public.ops_work_cards where auto_key in ('brand_pick:3a910000-0000-4000-b100-000000000001',
       'brand_pick:3a910000-0000-4000-b100-000000000002') and status <> 'done'), '2');
  perform pg_temp.w3t2_check('SHARE', 'a number two Lagos cards share exactly links neither',
    pg_temp.w3t2_stage('3a910000-0000-4000-c100-000000000003') || ',' || pg_temp.w3t2_stage('3a910000-0000-4000-c100-000000000004'),
    'none/contacted,none/contacted');
  perform pg_temp.w3t2_like('SHARE', 'and a person picks between them',
    (select instructions from public.ops_work_cards where auto_key = 'brand_pick:3a910000-0000-4000-b100-000000000003' and status <> 'done'),
    '%share its email or phone%W3T2 Shared One, W3T2 Shared Two%');
  perform pg_temp.w3t2_check('SHARE', 'exact on a Lagos card and near on a Memphis card links neither',
    pg_temp.w3t2_stage('3a910000-0000-4000-c100-000000000005') || ',' || pg_temp.w3t2_stage('3a910000-0000-4000-c100-000000000006'),
    'none/contacted,none/contacted');
  perform pg_temp.w3t2_like('SHARE', 'and the person sees both cards',
    (select instructions from public.ops_work_cards where auto_key = 'brand_pick:3a910000-0000-4000-b100-000000000004' and status <> 'done'),
    '%W3T2 Exact Lagos%W3T2 Near Memphis%');

  -- SYS: Mingla closing the pick card is not a person's decision.
  update public.ops_work_cards set status = 'done', close_kind = 'system', close_reason = 'W3T2 closed by Mingla', closed_at = now(),
         closed_by = 'system@usemingla.com', closed_via = 'system'
   where auto_key = 'brand_pick:3a910000-0000-4000-b100-000000000005' and status <> 'done';
  delete from public.ops_brand_autolink_waits;
  v := public.ops_brand_autolink();
  perform pg_temp.w3t2_check('SYS', 'a pick card Mingla closed is asked again: one open pick card',
    (select count(*)::text from public.ops_work_cards where auto_key = 'brand_pick:3a910000-0000-4000-b100-000000000005' and status <> 'done'), '1');
end;
$share$;

-- ---------------------------------------------------------------------------
-- BUDGET: 25 a run, backoff, settling.
-- ---------------------------------------------------------------------------
create temp table w3t2_free (title text) on commit drop;
create function pg_temp.w3t2_stop() returns trigger language plpgsql as $t$
begin
  if new.title like 'Pick the host card for W3T2 Stuck %' and not exists (select 1 from w3t2_free f where f.title = new.title) then
    raise exception 'w3t2: the run stops on this brand';
  end if;
  return new;
end $t$;
create trigger w3t2_stop before insert on public.ops_work_cards for each row execute function pg_temp.w3t2_stop();

insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('3a920000-0000-4000-c100-000000000001', 'hosts', 'W3T2 Budget Twin A', 'contacted', 'w3t2', 'w3t2'),
  ('3a920000-0000-4000-c100-000000000002', 'hosts', 'W3T2 Budget Twin B', 'contacted', 'w3t2', 'w3t2');
insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by) values
  ('3a920000-0000-4000-c100-000000000001', 'email', null, 'budget@w3t23980.test', 'budget@w3t23980.test', 'w3t2'),
  ('3a920000-0000-4000-c100-000000000002', 'email', null, 'budget@w3t23980.test', 'budget@w3t23980.test', 'w3t2');
delete from public.ops_brand_autolink_waits;
set local session_replication_role = replica;
update public.brands set deleted_at = now() where id::text like '3a910000-0000-4000-b100-%';
insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, created_at, social_links)
select ('3a920000-0000-4000-b100-0000000000' || lpad(g::text, 2, '0'))::uuid, gen_random_uuid(), 'W3T2 Stuck ' || g, 'w3t2-stuck-' || g, 'Lagos', 'NG',
       'budget@w3t23980.test', now() - interval '100 minutes' + g * interval '1 minute', '{}'
  from generate_series(1, 27) g;
insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, created_at, social_links)
select ('3a920000-0000-4000-b200-0000000000' || lpad(g::text, 2, '0'))::uuid, gen_random_uuid(), 'W3T2 Fresh ' || g, 'w3t2-fresh-' || g, 'Lagos', 'NG',
       'fresh' || g || '@w3t23980.test', now() - interval '30 minutes' + g * interval '1 minute', '{}'
  from generate_series(1, 3) g;
set local session_replication_role = origin;

do $budget$
declare v jsonb; i integer; v_waits text := '';
begin
  v := public.ops_brand_autolink();
  perform pg_temp.w3t2_check('BUDGET', 'the first run tries the 25 oldest; each that stopped waits an hour',
    (select count(*)::text || '/' || min(tries)::text || '/' || max(tries)::text || '/' || min(last_status) || '/' ||
            bool_and(next_at - now() between interval '59 minutes' and interval '61 minutes')::text
       from public.ops_brand_autolink_waits where brand_id::text like '3a920000-0000-4000-b100-%'), '25/1/1/stopped/true');
  perform pg_temp.w3t2_check('BUDGET', 'the first run did not reach the new brands',
    (select count(*)::text from public.crm_records c join public.brands b on b.id = c.brand_id where b.name like 'W3T2 Fresh %'), '0');
  v := public.ops_brand_autolink();
  perform pg_temp.w3t2_check('BUDGET', 'the second run skips the waiting 25 and reaches the 2 left and the 3 new ones',
    (v->>'created') || '/' || (select count(*)::text from public.crm_records c join public.brands b on b.id = c.brand_id where b.name like 'W3T2 Fresh %')
      || '/' || (select count(*)::text from public.ops_brand_autolink_waits where brand_id::text like '3a920000-0000-4000-b100-%'), '3/3/27');
  for i in 1..10 loop
    update public.ops_brand_autolink_waits set next_at = now() - interval '1 second' where brand_id = '3a920000-0000-4000-b100-000000000001';
    v := public.ops_brand_autolink();
    v_waits := v_waits || (select extract(epoch from (next_at - now()))::bigint / 3600 from public.ops_brand_autolink_waits
                            where brand_id = '3a920000-0000-4000-b100-000000000001')::text || ',';
  end loop;
  perform pg_temp.w3t2_check('BUDGET', 'each next wait doubles, up to 7 days (hours)', v_waits, '2,4,8,16,32,64,128,168,168,168,');
  insert into w3t2_free values ('Pick the host card for W3T2 Stuck 2');
  update public.ops_brand_autolink_waits set next_at = now() - interval '1 second' where brand_id = '3a920000-0000-4000-b100-000000000002';
  v := public.ops_brand_autolink();
  perform pg_temp.w3t2_check('BUDGET', 'a brand settled on its next try loses its wait and has its pick card',
    (select count(*)::text from public.ops_brand_autolink_waits where brand_id = '3a920000-0000-4000-b100-000000000002') || '/' ||
    (select count(*)::text from public.ops_work_cards where auto_key = 'brand_pick:3a920000-0000-4000-b100-000000000002' and status <> 'done'), '0/1');
end;
$budget$;
drop trigger w3t2_stop on public.ops_work_cards;

-- ---------------------------------------------------------------------------
-- N3-T, N4-T: promised dates switched between one-off and repeating.
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, icp, created_by, updated_by) values
  ('3a930000-0000-4000-c300-000000000001', 'hosts', 'W3T2 Round Host', 'onboarded', 'event_organizer', 'w3t2', 'w3t2'),
  ('3a930000-0000-4000-c300-000000000002', 'hosts', 'W3T2 Month Host', 'live', 'event_organizer', 'w3t2', 'w3t2'),
  ('3a930000-0000-4000-c300-000000000003', 'hosts', 'W3T2 Today Host', 'live', 'event_organizer', 'w3t2', 'w3t2');
insert into public.crm_record_owners (record_id, owner_email, added_by)
select r, 'ada.w3t23980@test.local', 'w3t2' from unnest(array['3a930000-0000-4000-c300-000000000001','3a930000-0000-4000-c300-000000000002',
  '3a930000-0000-4000-c300-000000000003']::uuid[]) r;
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by) values
  ('3a930000-0000-4000-d100-000000000001', '3a930000-0000-4000-c300-000000000001', 'W3T2 Round Night', 'event', (now() AT TIME ZONE 'UTC')::date + 30, 'none', 'w3t2', 'w3t2'),
  ('3a930000-0000-4000-d100-000000000002', '3a930000-0000-4000-c300-000000000002', 'W3T2 Month Night', 'event', (now() AT TIME ZONE 'UTC')::date - 40, 'month', 'w3t2', 'w3t2'),
  ('3a930000-0000-4000-d100-000000000003', '3a930000-0000-4000-c300-000000000003', 'W3T2 Today Weekly', 'event', (now() AT TIME ZONE 'UTC')::date - 7, 'week', 'w3t2', 'w3t2');
update public.ops_settings set value = 'true'::jsonb where key = 'auto_steps';

create function pg_temp.w3t2_switch(p_rec text, p_exp text, p_rep text, p_key text) returns text language sql as $f$
  select pg_temp.w3t2_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', p_rec, 'id', p_exp, 'repeats', p_rep), p_key)) $f$;

do $n3t$
declare v text; i integer; v_seen text := '';
begin
  perform public.ops_auto_steps(null, null);
  v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000001', '3a930000-0000-4000-d100-000000000001', 'week', 'w3t2-r1-week-0001');
  v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000001', '3a930000-0000-4000-d100-000000000001', 'none', 'w3t2-r1-none-0001');
  perform pg_temp.w3t2_check('N3-T', 'round 1 back to once: one open go-live card',
    pg_temp.w3t2_open('3a930000-0000-4000-d100-000000000001'), '1:golive');
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'W3T2 not now', closed_at = now() - interval '1 hour',
         closed_by = 'ada.w3t23980@test.local', closed_via = null
   where auto_key = 'golive:expected:3a930000-0000-4000-d100-000000000001' and status <> 'done';
  v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000001', '3a930000-0000-4000-d100-000000000001', 'week', 'w3t2-r3-week-0001');
  v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000001', '3a930000-0000-4000-d100-000000000001', 'none', 'w3t2-r3-none-0001');
  perform pg_temp.w3t2_check('N3-T', 'declined in round 2, then a weekly round: back to once has one open go-live card',
    pg_temp.w3t2_open('3a930000-0000-4000-d100-000000000001'), '1:golive');
  for i in 1..5 loop
    v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000001', '3a930000-0000-4000-d100-000000000001', 'week', 'w3t2-flip-week-000' || i);
    v_seen := v_seen || pg_temp.w3t2_open('3a930000-0000-4000-d100-000000000001') || ' ';
    v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000001', '3a930000-0000-4000-d100-000000000001', 'none', 'w3t2-flip-none-000' || i);
    perform public.ops_auto_steps(null, null);
    v_seen := v_seen || pg_temp.w3t2_open('3a930000-0000-4000-d100-000000000001') || ' ';
  end loop;
  perform pg_temp.w3t2_check('N3-T', 'five more flips: always exactly one open card, the rolling one or the go-live one',
    v_seen, repeat('1:series 1:golive ', 5));
  perform pg_temp.w3t2_check('N3-T', 'and one go-live card in all, opened again each time',
    (select count(*)::text from public.ops_work_cards where auto_key = 'golive:expected:3a930000-0000-4000-d100-000000000001'), '1');

  v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000002', '3a930000-0000-4000-d100-000000000002', 'none', 'w3t2-month-none-0001');
  perform pg_temp.w3t2_check('N4-T', 'a monthly series that started 40 days ago keeps its next monthly date',
    pg_temp.w3t2_j(v)->>'status' || '/' ||
    (select expected_on::text from public.ops_expected_events where id = '3a930000-0000-4000-d100-000000000002'),
    'updated/' || (((now() AT TIME ZONE 'UTC')::date - 40) + interval '2 months')::date::text);
  v := pg_temp.w3t2_switch('3a930000-0000-4000-c300-000000000003', '3a930000-0000-4000-d100-000000000003', 'none', 'w3t2-today-none-0001');
  perform pg_temp.w3t2_check('N4-T', 'a weekly series whose next date is today keeps today, not next week',
    pg_temp.w3t2_j(v)->>'status' || '/' ||
    (select (expected_on - (now() AT TIME ZONE 'UTC')::date)::text from public.ops_expected_events where id = '3a930000-0000-4000-d100-000000000003'), 'updated/0');
end;
$n3t$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
do $report$
declare r record; v_fail integer := 0; v_total integer := 0;
begin
  for r in select * from t3980w3t2_results order by seq loop
    v_total := v_total + 1;
    if r.ok then raise notice 'PASS [%] %', r.test, r.label;
    else v_fail := v_fail + 1; raise warning 'FAIL [%] % -- %', r.test, r.label, r.detail; end if;
  end loop;
  if v_total = 0 then raise exception 'issue 3980 W3 rework 2 tester: no checks ran'; end if;
  if v_fail > 0 then raise exception 'issue 3980 W3 rework 2 tester: % of % checks failed', v_fail, v_total; end if;
  raise notice 'issue 3980 W3 rework 2 tester: all % checks passed', v_total;
end;
$report$;

rollback;
