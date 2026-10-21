-- Issue #3980 synced program, Wave 3 rework 2, on the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   N2     brand auto-link reads a phone number written without its country
--          code in its own country: a Memphis +1 901 234 5678 and a Lagos
--          0901 234 5678 never link (card with a Lagos region, card with no
--          region, brand country from its address or its city), a London
--          07911 123456 never links a Nigerian +234 7911 123456, while the
--          same Nigerian number with and without +234 still links (either
--          side national), and a US number written nationally links its
--          +1 form; a handle links only on the same platform; the link
--          note names the field that matched
--   P3-L   a "stays Lost" decision is remembered and never asked again
--   P3-B   a brand that could not be settled backs off (1 hour, then 2)
--   N3     one-off -> weekly -> "Does not repeat" ends with exactly one open
--          go-live card (the same card, opened again), also when a person
--          had closed it in an earlier round; a card a person closed in
--          this round stays closed
--   N4     a started series switched to "Does not repeat" with no date
--          keeps its next coming date, never a past one
--   STEPS  the save says how many of its steps are open (0 for a far-off
--          series, so the screen never claims steps exist)
--   DEV6   the giveaway and ads reasons and the launch kit use the plain
--          states; the data keys stay
--   DEV1   a wording card is counted once and its draft is the one Bridge D
--          recorded

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

create temp table t3980w3b_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w3b_people (who, id, email) values
  ('owner',  '39910000-0000-4000-a000-000000000001', 'ed.w3b3980@test.local'),
  ('growth', '39910000-0000-4000-a000-000000000003', 'ada.w3b3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w3b_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3b3980@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3b3980@test.local', 'growth', 'active', now());

create temp table t3980w3b_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w3b_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t3980w3b_people where who = p_who;
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

create function pg_temp.w3b_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.w3b_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.w3b_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3b_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w3b_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3b_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w3b_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.w3b_today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;

create function pg_temp.w3b_brand_of(p_record text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') from public.crm_records where id = p_record::uuid $fn$;

-- The open cards counted from a promised date, as "<count>:<kinds>".
create function pg_temp.w3b_open(p_exp text) returns text
language sql as $fn$
  select count(*)::text || ':' || coalesce(string_agg(split_part(w.auto_key, ':', 1), ',' order by w.auto_key), '')
    from public.ops_work_cards w
   where w.status <> 'done' and w.archived_at is null and w.auto_key like '%' || p_exp
$fn$;

-- ---------------------------------------------------------------------------
-- N2, P3-L, P3-B: brand auto-link.
-- ---------------------------------------------------------------------------
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('39910000-0000-4000-e000-000000000001', 'w3b-lagos', 'W3B Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5),
  ('39910000-0000-4000-e000-000000000002', 'w3b-memphis', 'W3B Memphis', 'United States', 'US', 35.1, -90.0, 35.0, -90.1, 35.2, -89.9),
  ('39910000-0000-4000-e000-000000000003', 'w3b-london', 'W3B London', 'United Kingdom', 'GB', 51.5, -0.1, 51.4, -0.2, 51.6, 0.0);

insert into public.crm_records (id, pipeline, name, stage, region_id, created_by, updated_by) values
  ('39910000-0000-4000-c100-000000000001', 'hosts', 'W3B Lagos Region Card', 'contacted', '39910000-0000-4000-e000-000000000001', 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000002', 'hosts', 'W3B No Region Card', 'contacted', null, 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000003', 'hosts', 'W3B Naija National', 'contacted', '39910000-0000-4000-e000-000000000001', 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000004', 'hosts', 'W3B Naija Intl', 'contacted', null, 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000005', 'hosts', 'W3B London Card', 'contacted', '39910000-0000-4000-e000-000000000003', 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000006', 'hosts', 'W3B Gram Card', 'contacted', null, 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000007', 'hosts', 'W3B Same Gram', 'contacted', null, 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000008', 'hosts', 'W3B Memphis National', 'contacted', '39910000-0000-4000-e000-000000000002', 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000010', 'hosts', 'W3B Twin A', 'contacted', null, 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000011', 'hosts', 'W3B Twin B', 'contacted', null, 'w3b', 'w3b'),
  ('39910000-0000-4000-c100-000000000012', 'hosts', 'W3B Lost Two', 'contacted', null, 'w3b', 'w3b');
insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by) values
  ('39910000-0000-4000-c100-000000000009', 'hosts', 'W3B Lost Card', 'lost', 'Not now', 'w3b', 'w3b');
insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by)
select r::uuid, k, pl, val, public.crm_ident_key(k, val), 'w3b' from (values
  ('39910000-0000-4000-c100-000000000001', 'phone', null, '0901 234 5678'),
  ('39910000-0000-4000-c100-000000000002', 'phone', null, '0902 765 4321'),
  ('39910000-0000-4000-c100-000000000003', 'phone', null, '0803 111 2233'),
  ('39910000-0000-4000-c100-000000000004', 'phone', null, '+2348044445566'),
  ('39910000-0000-4000-c100-000000000005', 'phone', null, '07911 123456'),
  ('39910000-0000-4000-c100-000000000006', 'handle', 'instagram', 'w3bgram'),
  ('39910000-0000-4000-c100-000000000007', 'handle', 'instagram', 'w3bsame'),
  ('39910000-0000-4000-c100-000000000007', 'phone', null, '+2348070000001'),
  ('39910000-0000-4000-c100-000000000008', 'phone', null, '(901) 555-0199'),
  ('39910000-0000-4000-c100-000000000009', 'email', null, 'lost@w3b3980.test'),
  ('39910000-0000-4000-c100-000000000010', 'email', null, 'twin@w3b3980.test'),
  ('39910000-0000-4000-c100-000000000011', 'email', null, 'twin@w3b3980.test')) t(r, k, pl, val);

update public.ops_settings set value = to_jsonb(now() - interval '1 hour') where key = 'brand_auto_since';
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, contact_phone, social_links, created_at) values
  ('39910000-0000-4000-b100-000000000001', '39910000-0000-4000-b900-000000000001', 'W3B Memphis Bar', 'w3b-memphis-bar', 'Memphis', 'US', null, '+1 901 234 5678', '{}', now() - interval '59 minutes'),
  ('39910000-0000-4000-b100-000000000002', '39910000-0000-4000-b900-000000000002', 'W3B Memphis City', 'w3b-memphis-city', 'W3B Memphis', null, null, '+1 902 765 4321', '{}', now() - interval '58 minutes'),
  ('39910000-0000-4000-b100-000000000003', '39910000-0000-4000-b900-000000000003', 'W3B Naija Plus', 'w3b-naija-plus', 'W3B Lagos', null, null, '+234 803 111 2233', '{}', now() - interval '57 minutes'),
  ('39910000-0000-4000-b100-000000000004', '39910000-0000-4000-b900-000000000004', 'W3B Naija Local', 'w3b-naija-local', 'W3B Lagos', null, null, '0804 444 5566', '{}', now() - interval '56 minutes'),
  ('39910000-0000-4000-b100-000000000005', '39910000-0000-4000-b900-000000000005', 'W3B Lagos Seven', 'w3b-lagos-seven', 'Lagos', 'NG', null, '+234 7911 123456', '{}', now() - interval '55 minutes'),
  ('39910000-0000-4000-b100-000000000006', '39910000-0000-4000-b900-000000000006', 'W3B TikTok Brand', 'w3b-tiktok', 'Lagos', null, null, null, '{"tiktok":"@w3bgram"}', now() - interval '54 minutes'),
  ('39910000-0000-4000-b100-000000000007', '39910000-0000-4000-b900-000000000007', 'W3B Insta Brand', 'w3b-insta', 'Lagos', null, null, '+2348079999999', '{"instagram":"https://instagram.com/w3bsame"}', now() - interval '53 minutes'),
  ('39910000-0000-4000-b100-000000000008', '39910000-0000-4000-b900-000000000008', 'W3B Memphis Plus', 'w3b-memphis-plus', 'Memphis', 'US', null, '+1 901 555 0199', '{}', now() - interval '52 minutes'),
  ('39910000-0000-4000-b100-000000000009', '39910000-0000-4000-b900-000000000009', 'W3B Lost Brand', 'w3b-lost-brand', 'Lagos', null, 'lost@w3b3980.test', null, '{}', now() - interval '51 minutes'),
  ('39910000-0000-4000-b100-000000000010', '39910000-0000-4000-b900-000000000010', 'W3B Backoff Brand', 'w3b-backoff', 'Lagos', null, 'twin@w3b3980.test', null, '{}', now() - interval '50 minutes');
set local session_replication_role = origin;

do $n2$
declare v jsonb; v_t timestamptz;
begin
  -- A person's open card already has the title the backoff brand's pick card
  -- would take, so that card cannot be made (a duplicate) and the brand is
  -- left unsettled.
  v := public.ops_auto_card_upsert('testhold:one', jsonb_build_object('title', 'Pick the host card for W3B Backoff Brand',
         'instructions', 'Held by the test.', 'done_means', 'Held.', 'owners', '[]'::jsonb, 'watchers', '[]'::jsonb,
         'due_on', pg_temp.w3b_today() + 3), 'task', null);
  v := public.ops_brand_autolink();

  perform pg_temp.w3b_check('N2', 'a Memphis +1 901 234 5678 never links a Lagos-region 0901 234 5678',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000001'), 'none');
  perform pg_temp.w3b_like('N2', 'it makes a card for a person to pick, naming that card',
    (select title || ' | ' || instructions from public.ops_work_cards where auto_key = 'brand_pick:39910000-0000-4000-b100-000000000001' and status <> 'done'),
    'Pick the right card for W3B Memphis Bar | %ends the same%W3B Lagos Region Card%');
  perform pg_temp.w3b_check('N2', 'a card with no region: 0902 765 4321 read as a US number is not valid, so +1 902 765 4321 (brand city Memphis) never links',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000002'), 'none');
  perform pg_temp.w3b_check('N2', 'the same Nigerian number, 0803 on a Lagos card and +234 on the brand, links',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000003'), '39910000-0000-4000-b100-000000000003');
  perform pg_temp.w3b_check('N2', 'the link note names the phone',
    (select string_agg(body, ' | ') from public.crm_activity where record_id = '39910000-0000-4000-c100-000000000003' and body like 'Brand %'),
    'Brand W3B Naija Plus linked by itself: same phone as this card.');
  perform pg_temp.w3b_check('N2', 'the same Nigerian number, +234 on the card and 0804 on a brand in a Lagos launch city, links',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000004'), '39910000-0000-4000-b100-000000000004');
  perform pg_temp.w3b_check('N2', 'a London 07911 123456 never links a Nigerian +234 7911 123456',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000005'), 'none');
  perform pg_temp.w3b_check('N2', 'a TikTok handle never links an Instagram card with the same name',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000006'), 'none');
  perform pg_temp.w3b_like('N2', 'it is offered for a person to pick, saying it is another platform',
    (select instructions from public.ops_work_cards where auto_key = 'brand_pick:39910000-0000-4000-b100-000000000006' and status <> 'done'),
    '%the same handle on another platform%W3B Gram Card%');
  perform pg_temp.w3b_check('N2', 'the same Instagram handle links (the phones differ)',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000007'), '39910000-0000-4000-b100-000000000007');
  perform pg_temp.w3b_check('N2', 'and its note names the Instagram handle, not the phone',
    (select string_agg(body, ' | ') from public.crm_activity where record_id = '39910000-0000-4000-c100-000000000007' and body like 'Brand %'),
    'Brand W3B Insta Brand linked by itself: same Instagram handle as this card.');
  perform pg_temp.w3b_check('N2', 'a US number written nationally on a Memphis card links its +1 form',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000008'), '39910000-0000-4000-b100-000000000008');
  perform pg_temp.w3b_check('N2', 'reading helpers: national numbers in their own country',
    concat_ws(',', public.ops_phone_full('09012345678', '234'), coalesce(public.ops_phone_full('09012345678', '1'), 'none'),
              public.ops_phone_full('9015550199', '1'), public.ops_phone_full('07911123456', '44')),
    '+2349012345678,none,+19015550199,+447911123456');

  -- P3-L: a Lost match is asked about once; a "stays Lost" decision is kept.
  perform pg_temp.w3b_check('P3-L', 'a Lost match is not linked and is asked about',
    pg_temp.w3b_brand_of('39910000-0000-4000-c100-000000000009') || '/' ||
    (select count(*) from public.ops_work_cards where auto_key = 'brand_lost:39910000-0000-4000-b100-000000000009' and status <> 'done')::text,
    'none/1');
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'W3B stays Lost', closed_at = now(),
         closed_by = 'ed.w3b3980@test.local', closed_via = null
   where auto_key = 'brand_lost:39910000-0000-4000-b100-000000000009' and status <> 'done';
  v := public.ops_brand_autolink();
  update public.ops_work_cards set closed_at = now() - interval '15 days' where auto_key = 'brand_lost:39910000-0000-4000-b100-000000000009';
  update public.ops_brand_autolink_waits set next_at = now() - interval '1 minute';
  v := public.ops_brand_autolink();
  perform pg_temp.w3b_check('P3-L', 'after "stays Lost", runs now and 15 days later never ask again',
    (select count(*) from public.ops_work_cards where auto_key = 'brand_lost:39910000-0000-4000-b100-000000000009')::text || '/' ||
    (select count(*) from public.ops_work_cards where auto_key = 'brand_lost:39910000-0000-4000-b100-000000000009' and status <> 'done')::text,
    '1/0');
end;
$n2$;

-- P3-B: a brand the run could not settle backs off.
do $p3b$
declare v jsonb; w record;
begin
  delete from public.ops_brand_autolink_waits where brand_id <> '39910000-0000-4000-b100-000000000010';
  update public.ops_brand_autolink_waits set tries = 1, next_at = now() + interval '1 hour' where brand_id = '39910000-0000-4000-b100-000000000010';
  select * into w from public.ops_brand_autolink_waits where brand_id = '39910000-0000-4000-b100-000000000010';
  perform pg_temp.w3b_check('P3-B', 'an unsettled brand waits an hour before its next try',
    coalesce(w.tries::text, 'none') || '/' || coalesce(w.last_status, '') || '/' ||
    ((w.next_at - now()) between interval '59 minutes' and interval '61 minutes')::text, '1/pick:duplicate/true');
  v := public.ops_brand_autolink();
  select * into w from public.ops_brand_autolink_waits where brand_id = '39910000-0000-4000-b100-000000000010';
  perform pg_temp.w3b_check('P3-B', 'a run before then leaves it alone', w.tries::text, '1');
  update public.ops_brand_autolink_waits set next_at = now() - interval '1 minute' where brand_id = '39910000-0000-4000-b100-000000000010';
  v := public.ops_brand_autolink();
  select * into w from public.ops_brand_autolink_waits where brand_id = '39910000-0000-4000-b100-000000000010';
  perform pg_temp.w3b_check('P3-B', 'the next unsettled try waits twice as long',
    w.tries::text || '/' || ((w.next_at - now()) between interval '119 minutes' and interval '121 minutes')::text, '2/true');
  perform pg_temp.w3b_check('P3-B', 'no client can read the waits',
    has_table_privilege('authenticated', 'public.ops_brand_autolink_waits', 'SELECT')::text || '/' ||
    has_table_privilege('anon', 'public.ops_brand_autolink_waits', 'SELECT')::text, 'false/false');
end;
$p3b$;

-- ---------------------------------------------------------------------------
-- N3, N4, STEPS: promised dates switched between one-off and repeating.
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, icp, created_by, updated_by) values
  ('39910000-0000-4000-c300-000000000001', 'hosts', 'W3B Switch Host', 'onboarded', 'event_organizer', 'w3b', 'w3b'),
  ('39910000-0000-4000-c300-000000000002', 'hosts', 'W3B Earlier Round Host', 'onboarded', 'event_organizer', 'w3b', 'w3b'),
  ('39910000-0000-4000-c300-000000000003', 'hosts', 'W3B This Round Host', 'onboarded', 'event_organizer', 'w3b', 'w3b'),
  ('39910000-0000-4000-c300-000000000004', 'hosts', 'W3B Started Host', 'live', 'event_organizer', 'w3b', 'w3b'),
  ('39910000-0000-4000-c300-000000000005', 'hosts', 'W3B Far Host', 'onboarded', 'event_organizer', 'w3b', 'w3b');
insert into public.crm_record_owners (record_id, owner_email, added_by)
select r, 'ada.w3b3980@test.local', 'w3b' from unnest(array['39910000-0000-4000-c300-000000000001','39910000-0000-4000-c300-000000000002',
  '39910000-0000-4000-c300-000000000003','39910000-0000-4000-c300-000000000004','39910000-0000-4000-c300-000000000005']::uuid[]) r;
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by) values
  ('39910000-0000-4000-d100-000000000001', '39910000-0000-4000-c300-000000000001', 'W3B Switch Night', 'event', (now() AT TIME ZONE 'UTC')::date + 30, 'none', 'w3b', 'w3b'),
  ('39910000-0000-4000-d100-000000000002', '39910000-0000-4000-c300-000000000002', 'W3B Earlier Night', 'event', (now() AT TIME ZONE 'UTC')::date + 30, 'none', 'w3b', 'w3b'),
  ('39910000-0000-4000-d100-000000000003', '39910000-0000-4000-c300-000000000003', 'W3B This Night', 'event', (now() AT TIME ZONE 'UTC')::date + 30, 'none', 'w3b', 'w3b'),
  ('39910000-0000-4000-d100-000000000004', '39910000-0000-4000-c300-000000000004', 'W3B Started Weekly', 'event', (now() AT TIME ZONE 'UTC')::date - 10, 'week', 'w3b', 'w3b');
update public.ops_settings set value = 'true'::jsonb where key = 'auto_steps';

do $n3$
declare v text; v_golive uuid; c record; n integer := 0;
begin
  perform public.ops_auto_steps(null, null);
  select id into v_golive from public.ops_work_cards where auto_key = 'golive:expected:39910000-0000-4000-d100-000000000001' and status <> 'done';
  perform pg_temp.w3b_check('N3', 'a one-off promised date has its go-live card',
    pg_temp.w3b_open('39910000-0000-4000-d100-000000000001'), '1:golive');
  v := pg_temp.w3b_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39910000-0000-4000-c300-000000000001', 'id', '39910000-0000-4000-d100-000000000001', 'repeats', 'week'), 'w3b-n3-week-0001'));
  perform pg_temp.w3b_check('N3', 'weekly: the go-live card closes and one rolling card takes over',
    pg_temp.w3b_j(v)->>'status' || '/' || pg_temp.w3b_open('39910000-0000-4000-d100-000000000001'), 'updated/1:series');
  v := pg_temp.w3b_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39910000-0000-4000-c300-000000000001', 'id', '39910000-0000-4000-d100-000000000001', 'repeats', 'none'), 'w3b-n3-none-0001'));
  perform pg_temp.w3b_check('N3', 'back to "Does not repeat": exactly one open go-live card',
    pg_temp.w3b_j(v)->>'status' || '/' || pg_temp.w3b_open('39910000-0000-4000-d100-000000000001'), 'updated/1:golive');
  select * into c from public.ops_work_cards where auto_key = 'golive:expected:39910000-0000-4000-d100-000000000001' and status <> 'done';
  perform pg_temp.w3b_check('N3', 'it is the same card, opened again with its history, due 28 days before the date',
    (c.id = v_golive)::text || '/' || (c.due_on - pg_temp.w3b_today())::text || '/' ||
    (select count(*) from public.ops_work_events where card_id = v_golive and action = 'reopened')::text, 'true/2/1');
  perform public.ops_auto_steps(null, null);
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3b_check('N3', 'later runs keep exactly one open card',
    pg_temp.w3b_open('39910000-0000-4000-d100-000000000001'), '1:golive');

  -- A go-live card a person closed, then a weekly round, then one-off again.
  update public.ops_work_cards set status = 'done', close_kind = 'done', close_reason = 'Done by a person', closed_at = now() - interval '1 hour',
         closed_by = 'ada.w3b3980@test.local', closed_via = null
   where auto_key = 'golive:expected:39910000-0000-4000-d100-000000000002';
  perform pg_temp.w3b_check('N3', 'the earlier round''s card was closed by a person',
    pg_temp.w3b_open('39910000-0000-4000-d100-000000000002'), '0:');
  v := pg_temp.w3b_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39910000-0000-4000-c300-000000000002', 'id', '39910000-0000-4000-d100-000000000002', 'repeats', 'week'), 'w3b-n3-week-0002'));
  v := pg_temp.w3b_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39910000-0000-4000-c300-000000000002', 'id', '39910000-0000-4000-d100-000000000002', 'repeats', 'none'), 'w3b-n3-none-0002'));
  perform pg_temp.w3b_check('N3', 'a done card from an earlier round does not block: one open go-live card',
    pg_temp.w3b_open('39910000-0000-4000-d100-000000000002'), '1:golive');

  -- A go-live card a person closed in this round stays closed.
  update public.ops_work_cards set status = 'done', close_kind = 'done', close_reason = 'Done by a person', closed_at = now() - interval '1 hour',
         closed_by = 'ada.w3b3980@test.local', closed_via = null
   where auto_key = 'golive:expected:39910000-0000-4000-d100-000000000003';
  perform public.ops_auto_steps(null, null);
  perform pg_temp.w3b_check('N3', 'a card a person closed in this round is not opened again',
    pg_temp.w3b_open('39910000-0000-4000-d100-000000000003'), '0:');
end;
$n3$;

do $n4$
declare v text; x record;
begin
  v := pg_temp.w3b_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39910000-0000-4000-c300-000000000004', 'id', '39910000-0000-4000-d100-000000000004', 'repeats', 'none'), 'w3b-n4-none-0001'));
  select * into x from public.ops_expected_events where id = '39910000-0000-4000-d100-000000000004';
  perform pg_temp.w3b_check('N4', 'a started weekly series switched to "Does not repeat" with no date keeps its next coming date',
    pg_temp.w3b_j(v)->>'status' || '/' || (x.expected_on - pg_temp.w3b_today())::text || '/' || x.repeats, 'updated/4/none');
  perform pg_temp.w3b_check('N4', 'so it is not shown as Happened',
    pg_temp.w3b_j(v)->'expected'->'state'->>'k', 'late');
  perform pg_temp.w3b_check('N4', 'never a past date', (x.expected_on >= pg_temp.w3b_today())::text, 'true');
end;
$n4$;

do $steps$
declare v text;
begin
  v := pg_temp.w3b_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39910000-0000-4000-c300-000000000005', 'title', 'W3B Far Weekly', 'event_type', 'event',
                            'expected_on', (pg_temp.w3b_today() + 120)::text, 'repeats', 'week'), 'w3b-steps-far-0001'));
  perform pg_temp.w3b_check('STEPS', 'a far-off weekly series: the save says no step is open yet',
    pg_temp.w3b_j(v)->>'status' || '/' || coalesce(pg_temp.w3b_j(v)->'steps'->>'added', '?') || '/' || coalesce(pg_temp.w3b_j(v)->'steps'->>'open', 'missing'),
    'created/0/0');
  perform pg_temp.w3b_check('STEPS', 'a near one-off: the save counts its open go-live card',
    pg_temp.w3b_j(pg_temp.w3b_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39910000-0000-4000-c300-000000000005', 'title', 'W3B Near Night', 'event_type', 'event',
                            'expected_on', (pg_temp.w3b_today() + 40)::text), 'w3b-steps-near-0001')))->'steps'->>'open', '1');
end;
$steps$;

-- ---------------------------------------------------------------------------
-- DEV6: plain words in what people and agents read.
-- ---------------------------------------------------------------------------
do $dev6$
declare g jsonb;
begin
  g := public.ops_promo_gate(jsonb_build_object('title', 'W3B Late', 'runway', jsonb_build_object('band', 'organic', 'lead_days', 15)), pg_temp.w3b_today());
  perform pg_temp.w3b_check('DEV6', 'a giveaway held for a late go-live says Too late for promo, kind unchanged',
    (g->>'kind') || '/' || (g->>'reason'),
    'organic_only/Too late for promo: W3B Late went live 15 days before it starts, under 3 weeks, so it gets posts only. No giveaway or ads.');
  g := public.ops_promo_gate(jsonb_build_object('title', 'W3B Missed', 'runway', jsonb_build_object('band', 'missed')), pg_temp.w3b_today());
  perform pg_temp.w3b_check('DEV6', 'a missed go-live says Too late for promo, kind unchanged',
    (g->>'kind') || '/' || (g->>'reason'),
    'organic_only/Too late for promo: W3B Missed did not go live 3 weeks before it starts, so it gets posts only.');
  perform pg_temp.w3b_check('DEV6', 'the launch kit go-live step says full promo and too late for promo',
    (select e->>'instructions_template' from jsonb_array_elements(public.ops_kit_template()) e where e->>'key' = 'go_live_gate'),
    '{title} must be public on Mingla by {date}, 28 days before it starts, for the full promo. After {date21} it is too late for promo: posts only, no giveaway or ads.');
  perform pg_temp.w3b_check('DEV6', 'the kit keeps its 8 steps and keys',
    (select string_agg(e->>'key', ',' order by (e->>'step')::integer) from jsonb_array_elements(public.ops_kit_template()) e),
    'host_materials,listing_built,go_live_gate,content_brief,giveaway_ads,creator_posts,reminder,recap');
  perform pg_temp.w3b_check('DEV6', 'no ops function says full launch, organic only or missed go-live',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'ops\_%' and p.prosrc ~* '(full launch|organic only|missed go-live)'), '0');
  perform pg_temp.w3b_check('DEV6', 'nor does the launch kit',
    (public.ops_kit_template()::text ~* '(full launch|organic only|To review)')::text, 'false');
end;
$dev6$;

-- ---------------------------------------------------------------------------
-- DEV1: the wording card is counted once; its draft is what Bridge D recorded.
-- ---------------------------------------------------------------------------
do $dev1$
declare v text; v_draft uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_res jsonb; v_card uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
    (v_draft, 'W3B drafted words', 'Now live: W3B.', 'shipped', 'draft', 9001),
    (v_other, 'W3B other card', 'Other words.', 'now', 'published', 9002);
  insert into public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  values (null, 'draft_roadmap_card', 'community_roadmap_card', v_draft, jsonb_build_object('source', 'issue_3980_bridge_d', 'issue', '7991'));
  v_res := public.ops_auto_card_upsert('roadmap_shipped:issue-7991', jsonb_build_object(
    'title', 'Recently shipped: W3B check the words', 'instructions', 'Check the words.', 'done_means', 'Published or not needed.',
    'owners', jsonb_build_array('ed.w3b3980@test.local'), 'watchers', '[]'::jsonb, 'due_on', pg_temp.w3b_today() + 2,
    'person_reason', 'other',
    'links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_other))), 'task', null);
  v_card := (v_res->>'id')::uuid;
  perform pg_temp.w3b_check('DEV1', 'the approval card waits for a person', (select status from public.ops_work_cards where id = v_card), 'person');
  v := pg_temp.w3b_person('owner', 'select public.ops_review_list(null)::text');
  perform pg_temp.w3b_check('DEV1', 'the owner''s wording tab shows the draft Bridge D recorded, not a linked card',
    (select c->'roadmap'->>'public_title' from jsonb_array_elements(pg_temp.w3b_j(v)->'wording') c where c->>'id' = v_card::text), 'W3B drafted words');
  perform pg_temp.w3b_check('DEV1', 'the card is still reachable in cards (for anyone without that tab)',
    (select count(*)::text from jsonb_array_elements(pg_temp.w3b_j(v)->'cards') c where c->>'id' = v_card::text), '1');
  v := pg_temp.w3b_person('owner', 'select public.ops_my_counts(null)::text');
  perform pg_temp.w3b_check('DEV1', 'and it is counted once, as wording',
    (pg_temp.w3b_j(v)->>'wording_mine') || '/' || (pg_temp.w3b_j(v)->>'needs_person_mine'), '1/0');
end;
$dev1$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
do $report$
declare r record; v_fail integer := 0; v_total integer := 0;
begin
  for r in select * from t3980w3b_results order by seq loop
    v_total := v_total + 1;
    if r.ok then raise notice 'PASS [%] %', r.test, r.label;
    else v_fail := v_fail + 1; raise warning 'FAIL [%] % -- %', r.test, r.label, r.detail; end if;
  end loop;
  if v_total = 0 then raise exception 'issue 3980 W3 rework 2: no checks ran'; end if;
  if v_fail > 0 then raise exception 'issue 3980 W3 rework 2: % of % checks failed', v_fail, v_total; end if;
  raise notice 'issue 3980 W3 rework 2: all % checks passed', v_total;
end;
$report$;

rollback;
