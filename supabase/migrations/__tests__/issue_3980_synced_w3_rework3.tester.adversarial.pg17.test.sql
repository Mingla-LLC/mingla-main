-- Issue #3980 synced program, Wave 3 rework 3 retest: tester adversarial suite, on the fully replayed PG17 schema.
--
-- Different angles from the implementor's rework 3 suite (each check is recorded and reported together):
--   PH     35 phone pairs as people type them: a side with no country on
--          record never borrows the other side's country (Lagos, London,
--          Ireland, Ghana, Toronto, Madrid), different known countries never
--          match on the same digits, numbers too short or too long or with a
--          +1 area code starting 1 are never numbers; and the links that must
--          still happen (Ghana, Ireland with (0), the US and Canada sharing
--          one number plan, 00 dial-outs, spaces, dots, dashes, brackets,
--          both sides in full international form, a known country on both
--          sides). Never NULL.
--   E2E    through the brand run: a London-style number on a card with no
--          region and a Lagos +234 brand link nothing and keep the stage; a
--          Lagos card and a Lagos brand with the same number still link
--   WORDS  each pick card says why: no country on record, the same digits
--          with no country, or a different full number
--   DEC    a person's close holds; a near new card does not ask again; a new
--          exact card asks again on the same card; closing it again holds
--   AGENT  a Codex close of a reopen card for a Lost host opens it again
--   BUDGET 30 decided brands that each gain a near card hold 3 new brands
--          back for at most one run, and are not looked at again after

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

create temp table t3980w3t3_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w3t3_people (who, id, email) values
  ('owner',  '3a970000-0000-4000-a000-000000000001', 'ed.w3t33980@test.local'),
  ('growth', '3a970000-0000-4000-a000-000000000003', 'ada.w3t33980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w3t3_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3t33980@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3t33980@test.local', 'growth', 'active', now());

create temp table t3980w3t3_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w3t3_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t3980w3t3_people where who = p_who;
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

create function pg_temp.w3t3_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.w3t3_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.w3t3_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3t3_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w3t3_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3t3_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w3t3_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.w3t3_today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;

create function pg_temp.w3t3_brand_of(p_record text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') from public.crm_records where id = p_record::uuid $fn$;

-- The open cards counted from a promised date, as "<count>:<kinds>".
create function pg_temp.w3t3_open(p_exp text) returns text
language sql as $fn$
  select count(*)::text || ':' || coalesce(string_agg(split_part(w.auto_key, ':', 1), ',' order by w.auto_key), '')
    from public.ops_work_cards w
   where w.status <> 'done' and w.archived_at is null and w.auto_key like '%' || p_exp
$fn$;

create function pg_temp.w3t3_stage(p_record text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') || '/' || stage from public.crm_records where id = p_record::uuid $fn$;

create function pg_temp.w3t3_same(p_card text, p_cc text, p_brand text, p_bc text) returns text
language sql as $fn$ select coalesce(public.ops_phone_same(public.crm_ident_key('phone', p_card), p_cc, public.crm_ident_key('phone', p_brand), p_bc)::text, 'null') $fn$;

-- Phone pairs as a person types them. #3980 W3 rework 3: a side with no
-- country on record is never read in the other side's country, while a known
-- country on both sides, or full international form on both, still links.
create temp table t3980w3t3_pairs (n integer, label text, card text, cc text, brand text, bc text, want text) on commit drop;
insert into t3980w3t3_pairs values
  (1, 'a card with no region (901) 234-5678 and a Lagos brand 0901 234 5678', '(901) 234-5678', null, '0901 234 5678', 'NG', 'false'),
  (2, 'a card with no region 207 123 4567 and a London brand 020 7123 4567', '207 123 4567', null, '020 7123 4567', 'GB', 'false'),
  (3, 'a card with no region 0901 and a Lagos brand 0901, the very same digits', '0901 234 5678', null, '0901 234 5678', 'NG', 'false'),
  (4, 'a US card 901 and a brand with no country 0901', '(901) 234-5678', 'US', '0901 234 5678', null, 'false'),
  (5, 'two sides with no country and identical 0901', '0901 234 5678', null, '0901 234 5678', null, 'false'),
  (6, 'a card with no region 9012345678 and +234 901 with no country', '9012345678', null, '+234 901 234 5678', null, 'false'),
  (7, 'a card with no region 07911 and a Lagos brand +234 7911', '07911 123456', null, '+234 7911 123456', 'NG', 'false'),
  (8, 'a card with no region 7911123456 and a Lagos brand 07911123456', '7911123456', null, '07911 123456', 'NG', 'false'),
  (9, 'a card with no region 087 and an Irish brand +353 87', '087 123 4567', null, '+353 87 123 4567', 'IE', 'false'),
  (10, 'a card with no region 020 and a brand +233 20 with no country (Ghana)', '020 123 4567', null, '+233 20 123 4567', null, 'false'),
  (11, 'a card with no region 416.555.0199 and a Toronto brand 416 555 0199', '416.555.0199', null, '416 555 0199', 'CA', 'false'),
  (12, 'a card with no region 612 345 678 and a Madrid brand 612345678', '612 345 678', null, '612345678', 'ES', 'false'),
  (13, 'an Irish card 087 and a British brand 087, the very same digits', '087 123 4567', 'IE', '087 123 4567', 'GB', 'false'),
  (14, 'a Ghana card 020 and a Lagos brand +234 20', '020 123 4567', 'GH', '+234 20 123 4567', 'NG', 'false'),
  (15, 'a US card 901 and a London brand 0901', '901 234 5678', 'US', '0901 234 5678', 'GB', 'false'),
  (16, 'a card whose country code is not known (ZZ) never borrows the brand''s', '0901 234 5678', 'ZZ', '+234 901 234 5678', 'NG', 'false'),
  (17, 'a short 01234 is too short to be a number', '01234', 'GB', '+44 1234', 'GB', 'false'),
  (18, 'a 16-digit number is too long to be a number', '0901234567890123', 'NG', '+234901234567890123', 'NG', 'false'),
  (19, 'a +1 number with an area code starting 1 is not a number', '(123) 456-7890', 'US', '+1 123 456 7890', 'US', 'false'),
  (20, 'two full numbers with different codes and the same national digits', '+234 901 234 5678', null, '+1 901 234 5678', null, 'false'),
  (21, 'a Ghana card 020 and a Ghana brand +233 20', '020 123 4567', 'GH', '+233 20 123 4567', 'GH', 'true'),
  (22, 'a Ghana card 024 and +233 24 with no country', '024 412 3456', 'GH', '+233 24 412 3456', null, 'true'),
  (23, 'an Irish card 087 and an Irish brand +353 (0)87', '087 123 4567', 'IE', '+353 (0)87 123 4567', 'IE', 'true'),
  (24, 'a US card 901 and a Canadian brand 901: one North American number plan', '901 234 5678', 'US', '901 234 5678', 'CA', 'true'),
  (25, 'a Canadian card (416) 555-0199 and a US brand +1 416', '(416) 555-0199', 'CA', '+1 416 555 0199', 'US', 'true'),
  (26, 'a US card 1 (901) and a Canadian brand 1-901', '1 (901) 234-5678', 'US', '1-901-234-5678', 'CA', 'true'),
  (27, 'a London card 0044 7911 (00 dial-out) and +44 7911', '0044 7911 123456', 'GB', '+44 7911 123456', 'GB', 'true'),
  (28, 'a Lagos card 00234 901 and +234 901', '00234 901 234 5678', 'NG', '+234 901 234 5678', 'NG', 'true'),
  (29, 'a Lagos card 0(901)-234-5678 and +234-901-234-5678', '0(901)-234-5678', 'NG', '+234-901-234-5678', 'NG', 'true'),
  (30, 'a London card 07911.123.456 and +44 7911 123 456', '07911.123.456', 'GB', '+44 7911 123 456', 'GB', 'true'),
  (31, 'two full +234 numbers with no country on either side', '+234 901 234 5678', null, '+2349012345678', null, 'true'),
  (32, 'a Lagos card 0901 and a Lagos brand 0901', '0901 234 5678', 'NG', '0901 234 5678', 'NG', 'true'),
  (33, 'a Lagos card 901 with the 0 left off and a Lagos brand +234 901', '901 234 5678', 'NG', '+234 901 234 5678', 'NG', 'true'),
  (34, 'a Lagos card written in lower case ng and +234 901', '0901 234 5678', 'ng', '+234 901 234 5678', 'NG', 'true'),
  (35, 'a Madrid card 612 345 678 and a Madrid brand +34 612', '612 345 678', 'ES', '+34 612 345 678', 'ES', 'true');

do $ph$
declare r record;
begin
  for r in select * from t3980w3t3_pairs order by n loop
    perform pg_temp.w3t3_check('PH', format('%s: %s', r.n, r.label), pg_temp.w3t3_same(r.card, r.cc, r.brand, r.bc), r.want);
  end loop;
  -- never NULL, whatever the sides are
  perform pg_temp.w3t3_check('PH', 'the answer is true or false, never empty, for every pair and for a number that cannot be read',
    (select count(*) from t3980w3t3_pairs where public.ops_phone_same(public.crm_ident_key('phone', card), cc, public.crm_ident_key('phone', brand), bc) is null)::text
      || '/' || coalesce(public.ops_phone_same('abc', null, '+2349012345678', null)::text, 'null'), '0/false');
end;
$ph$;

-- ---------------------------------------------------------------------------
-- E2E and WORDS: end to end through the brand run, and the words of each
-- pick card.
-- ---------------------------------------------------------------------------
do $e2e$
declare v jsonb;
begin
  insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
    ('3a970000-0000-4000-e000-000000000001', 'w3t3-london', 'W3T3 London', 'United Kingdom', 'GB', 51.5, -0.1, 51.4, -0.2, 51.6, 0.0),
    ('3a970000-0000-4000-e000-000000000002', 'w3t3-lagos', 'W3T3 Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5);
  insert into public.crm_records (id, pipeline, name, stage, region_id, created_by, updated_by) values
    ('3a970000-0000-4000-c100-000000000001', 'hosts', 'W3T3 London Seven No Region', 'contacted', null, 't', 't'),
    ('3a970000-0000-4000-c100-000000000002', 'hosts', 'W3T3 Twin No Region', 'contacted', null, 't', 't'),
    ('3a970000-0000-4000-c100-000000000003', 'hosts', 'W3T3 Known London Seven', 'contacted', '3a970000-0000-4000-e000-000000000001', 't', 't'),
    ('3a970000-0000-4000-c100-000000000004', 'hosts', 'W3T3 Known Lagos', 'contacted', '3a970000-0000-4000-e000-000000000002', 't', 't');
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by, created_at)
  select r::uuid, 'phone', null, val, public.crm_ident_key('phone', val), 't', now() - interval '3 hours' from (values
    ('3a970000-0000-4000-c100-000000000001', '07922 123456'),
    ('3a970000-0000-4000-c100-000000000002', '0803 777 1212'),
    ('3a970000-0000-4000-c100-000000000003', '07933 123456'),
    ('3a970000-0000-4000-c100-000000000004', '0905 333 4444')) t(r, val);
  update public.ops_settings set value = to_jsonb(now() - interval '10 hours') where key = 'brand_auto_since';
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, contact_phone, social_links, created_at) values
    ('3a970000-0000-4000-b100-000000000001', '3a970000-0000-4000-b900-000000000001', 'W3T3 Lagos Seven', 'w3t3-lagos-seven', 'Lagos', 'NG', null, '+234 7922 123456', '{}', now() - interval '9 hours'),
    ('3a970000-0000-4000-b100-000000000002', '3a970000-0000-4000-b900-000000000002', 'W3T3 Unknown Twin', 'w3t3-unknown-twin', 'Nowhere', null, null, '0803 777 1212', '{}', now() - interval '9 hours' + interval '1 second'),
    ('3a970000-0000-4000-b100-000000000003', '3a970000-0000-4000-b900-000000000003', 'W3T3 Lagos Other Seven', 'w3t3-lagos-other', 'Lagos', 'NG', null, '+234 7933 123456', '{}', now() - interval '9 hours' + interval '2 seconds'),
    ('3a970000-0000-4000-b100-000000000004', '3a970000-0000-4000-b900-000000000004', 'W3T3 Lagos Same', 'w3t3-lagos-same', 'Lagos', 'NG', null, '+234 905 333 4444', '{}', now() - interval '9 hours' + interval '3 seconds');
  set local session_replication_role = origin;
  v := public.ops_brand_autolink();
  perform pg_temp.w3t3_check('E2E', 'a London-style 07922 on a card with no region and a Lagos +234 7922: nothing linked, the stage stays, one pick card names the card',
    pg_temp.w3t3_stage('3a970000-0000-4000-c100-000000000001') || '/' ||
    (select count(*) from public.ops_work_cards w join public.ops_work_links l on l.card_id = w.id and l.kind = 'host'
      where w.auto_key = 'brand_pick:3a970000-0000-4000-b100-000000000001' and w.status <> 'done' and l.target_id = '3a970000-0000-4000-c100-000000000001')::text,
    'none/contacted/1');
  perform pg_temp.w3t3_check('E2E', 'the same Nigerian number on a Lagos card (0905) and a Lagos brand (+234 905) still links by itself',
    pg_temp.w3t3_brand_of('3a970000-0000-4000-c100-000000000004'), '3a970000-0000-4000-b100-000000000004');
  perform pg_temp.w3t3_check('E2E', 'no host card in this test moved stage except the one that linked',
    (select string_agg(name || '=' || stage, ',' order by name) from public.crm_records where id::text like '3a970000-0000-4000-c100-%'),
    'W3T3 Known Lagos=onboarded,W3T3 Known London Seven=contacted,W3T3 London Seven No Region=contacted,W3T3 Twin No Region=contacted');
  perform pg_temp.w3t3_like('WORDS', 'a number on a side with no country says no country is on record to tell if it is the same number',
    (select instructions from public.ops_work_cards where auto_key = 'brand_pick:3a970000-0000-4000-b100-000000000001'),
    '%a phone number that ends the same, and no country is on record to tell if it is the same number%');
  perform pg_temp.w3t3_like('WORDS', 'identical digits with no country on either side say it is the same number written without a country code',
    (select instructions from public.ops_work_cards where auto_key = 'brand_pick:3a970000-0000-4000-b100-000000000002'),
    '%the same phone number written without a country code, and no country is on record to tell whose number it is%');
  perform pg_temp.w3t3_like('WORDS', 'a London 07933 and a Lagos +234 7933 (both countries known) say it is a different full number',
    (select instructions from public.ops_work_cards where auto_key = 'brand_pick:3a970000-0000-4000-b100-000000000003'),
    '%a phone number that ends the same but is a different full number%');
  perform pg_temp.w3t3_check('WORDS', 'no pick card in this test ever says "not the same number"',
    (select count(*) from public.ops_work_cards where auto_key like 'brand_pick:3a970000-%' and instructions like '%not the same number%')::text, '0');
end;
$e2e$;

-- ---------------------------------------------------------------------------
-- DEC: a person's close is remembered; only a new exact host card asks
-- again (the same card, nothing linked); a near new card does not; closing
-- the asked-again card holds over more runs. AGENT: a Codex close of a
-- reopen (Lost) card opens it again.
-- ---------------------------------------------------------------------------
do $dec$
declare v jsonb; v_id uuid; v_lost uuid;
begin
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by) values
    ('3a970000-0000-4000-c200-000000000001', 'hosts', 'W3T3 Decide A', 'contacted', null, 't', 't'),
    ('3a970000-0000-4000-c200-000000000002', 'hosts', 'W3T3 Decide B', 'contacted', null, 't', 't'),
    ('3a970000-0000-4000-c200-000000000003', 'hosts', 'W3T3 Lost Exact', 'lost', 'Not now', 't', 't');
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by, created_at) values
    ('3a970000-0000-4000-c200-000000000001', 'email', null, 'decide@w3t3.test', 'decide@w3t3.test', 't', now() - interval '3 hours'),
    ('3a970000-0000-4000-c200-000000000002', 'email', null, 'decide@w3t3.test', 'decide@w3t3.test', 't', now() - interval '3 hours'),
    ('3a970000-0000-4000-c200-000000000003', 'email', null, 'lost@w3t3.test', 'lost@w3t3.test', 't', now() - interval '3 hours');
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, contact_phone, social_links, created_at) values
    ('3a970000-0000-4000-b200-000000000001', '3a970000-0000-4000-b900-000000000011', 'W3T3 Decide Brand', 'w3t3-decide', null, 'NG', 'decide@w3t3.test', null, '{"instagram":"w3t3decide"}', now() - interval '8 hours'),
    ('3a970000-0000-4000-b200-000000000002', '3a970000-0000-4000-b900-000000000012', 'W3T3 Lost Brand', 'w3t3-lost', null, 'NG', 'lost@w3t3.test', null, '{}', now() - interval '8 hours' + interval '1 second');
  set local session_replication_role = origin;
  v := public.ops_brand_autolink();
  select id into v_id from public.ops_work_cards where auto_key = 'brand_pick:3a970000-0000-4000-b200-000000000001';
  select id into v_lost from public.ops_work_cards where auto_key = 'brand_lost:3a970000-0000-4000-b200-000000000002';
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Neither', closed_at = now() - interval '2 hours',
         closed_by = 'ada.w3t33980@test.local', closed_via = null where id = v_id;
  update public.ops_work_cards set status = 'done', close_kind = 'done', close_reason = 'agent: stays lost', closed_at = now() - interval '2 hours',
         closed_by = 'ed.w3t33980@test.local', closed_via = 'codex' where id = v_lost;
  v := public.ops_brand_autolink();
  v := public.ops_brand_autolink();
  perform pg_temp.w3t3_check('AGENT', 'a Codex close of the reopen card for a Lost host opens that same card again, once',
    (select string_agg(status || '/' || (id = v_lost)::text, ',') from public.ops_work_cards where auto_key like 'brand_%:3a970000-0000-4000-b200-000000000002'), 'todo/true');
  perform pg_temp.w3t3_check('DEC', 'a person''s close holds over two more runs: still closed, no second card, the brand never waits',
    (select string_agg(status, ',') from public.ops_work_cards where auto_key like 'brand_%:3a970000-0000-4000-b200-000000000001') || '/' ||
    (select count(*) from public.ops_brand_autolink_waits where brand_id = '3a970000-0000-4000-b200-000000000001' and next_at > now())::text, 'done/0');
  -- a near new card: the brand's instagram handle on TikTok
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('3a970000-0000-4000-c200-000000000004', 'hosts', 'W3T3 Decide Near', 'contacted', 't', 't');
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by, created_at) values
    ('3a970000-0000-4000-c200-000000000004', 'handle', 'tiktok', 'w3t3decide', public.crm_ident_key('handle', 'w3t3decide'), 't', now() - interval '1 hour');
  v := public.ops_brand_autolink();
  perform pg_temp.w3t3_check('DEC', 'a near new card (the handle on another platform) does not ask again, and the brand never waits',
    (select status from public.ops_work_cards where id = v_id) || '/' ||
    (select last_status || ':' || (next_at <= now())::text from public.ops_brand_autolink_waits where brand_id = '3a970000-0000-4000-b200-000000000001'),
    'done/decided:true');
  -- the real host card with the exact email
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('3a970000-0000-4000-c200-000000000005', 'hosts', 'W3T3 Decide Real', 'contacted', 't', 't');
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by, created_at) values
    ('3a970000-0000-4000-c200-000000000005', 'email', null, 'decide@w3t3.test', 'decide@w3t3.test', 't', now() + interval '1 second');
  v := public.ops_brand_autolink();
  perform pg_temp.w3t3_check('DEC', 'a new exact card asks again on the same card, which now names it, and links nothing',
    (select status || '/' || (id = v_id)::text from public.ops_work_cards where auto_key = 'brand_pick:3a970000-0000-4000-b200-000000000001') || '/' ||
    (select count(*) from public.ops_work_links where card_id = v_id and kind = 'host' and target_id = '3a970000-0000-4000-c200-000000000005')::text || '/' ||
    pg_temp.w3t3_brand_of('3a970000-0000-4000-c200-000000000005'), 'todo/true/1/none');
  perform pg_temp.w3t3_like('DEC', 'its words name the new card and say a person decides again',
    (select instructions from public.ops_work_cards where id = v_id), '%Since then W3T3 Decide Real has the same email, phone or handle, so a person decides again and nothing was linked.%');
  -- the person closes it again; nothing new appears
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Still neither', closed_at = now() + interval '2 seconds',
         closed_by = 'ada.w3t33980@test.local', closed_via = null where id = v_id;
  update public.crm_record_identifiers set created_at = now() - interval '1 minute' where record_id in ('3a970000-0000-4000-c200-000000000004', '3a970000-0000-4000-c200-000000000005');
  v := public.ops_brand_autolink();
  v := public.ops_brand_autolink();
  v := public.ops_brand_autolink();
  perform pg_temp.w3t3_check('DEC', 'closing the asked-again card holds over three more runs: one card, closed',
    (select count(*)::text || '/' || string_agg(status, ',') from public.ops_work_cards where auto_key like 'brand_%:3a970000-0000-4000-b200-000000000001'), '1/done');
end;
$dec$;

-- ---------------------------------------------------------------------------
-- BUDGET: 30 decided brands that each gain a near card cannot hold back 3
-- new brands for more than one run, and are not looked at again after.
-- ---------------------------------------------------------------------------
do $budget$
declare v jsonb; v_seen integer;
begin
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by)
  select ('3a970000-0000-4000-d' || lpad(to_hex(g), 3, '0') || '-00000000000' || s)::uuid, 'hosts', 'W3T3 B' || g || '-' || s, 'contacted', 't', 't'
    from generate_series(1, 30) g, generate_series(1, 2) s;
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by, created_at)
  select ('3a970000-0000-4000-d' || lpad(to_hex(g), 3, '0') || '-00000000000' || s)::uuid, 'email', null, 'b' || g || '@w3t3.test', 'b' || g || '@w3t3.test', 't', now() - interval '9 hours'
    from generate_series(1, 30) g, generate_series(1, 2) s;
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, contact_phone, social_links, created_at)
  select ('3a970000-0000-4000-b' || lpad(to_hex(768 + g), 3, '0') || '-000000000001')::uuid, ('3a970000-0000-4000-b' || lpad(to_hex(768 + g), 3, '0') || '-000000000009')::uuid,
         'W3T3 Budget ' || g, 'w3t3-budget-' || g, null, 'NG', 'b' || g || '@w3t3.test', null, jsonb_build_object('instagram', 'w3t3b' || g),
         now() - interval '7 hours' + g * interval '1 second'
    from generate_series(1, 30) g;
  set local session_replication_role = origin;
  v := public.ops_brand_autolink();
  v := public.ops_brand_autolink();
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Neither', closed_at = now() - interval '2 hours',
         closed_by = 'ada.w3t33980@test.local', closed_via = null
   where auto_key ~ '^brand_pick:3a970000-0000-4000-b3';
  perform pg_temp.w3t3_check('BUDGET', 'setup: 30 pick cards a person closed',
    (select count(*) from public.ops_work_cards where auto_key ~ '^brand_pick:3a970000-0000-4000-b3' and status = 'done')::text, '30');
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by)
  select ('3a970000-0000-4000-d' || lpad(to_hex(g), 3, '0') || '-000000000003')::uuid, 'hosts', 'W3T3 Near ' || g, 'contacted', 't', 't' from generate_series(1, 30) g;
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by, created_at)
  select ('3a970000-0000-4000-d' || lpad(to_hex(g), 3, '0') || '-000000000003')::uuid, 'handle', 'tiktok', 'w3t3b' || g, public.crm_ident_key('handle', 'w3t3b' || g), 't', now() - interval '1 hour'
    from generate_series(1, 30) g;
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, contact_phone, social_links, created_at)
  select ('3a970000-0000-4000-bf' || g || '0-000000000001')::uuid, ('3a970000-0000-4000-bf' || g || '0-000000000009')::uuid,
         'W3T3 Fresh ' || g, 'w3t3-fresh-' || g, null, 'NG', 'fresh' || g || '@w3t3.test', null, '{}', now() - interval '30 minutes'
    from generate_series(1, 3) g;
  set local session_replication_role = origin;
  v := public.ops_brand_autolink();
  v := public.ops_brand_autolink();
  perform pg_temp.w3t3_check('BUDGET', 'within two runs the 3 new brands each have a host card and all 30 decided brands were looked at once',
    (select count(*) from public.crm_records where brand_id::text like '3a970000-0000-4000-bf%')::text || '/' ||
    (select count(*) from public.ops_brand_autolink_waits where brand_id::text ~ '^3a970000-0000-4000-b3' and last_status = 'decided')::text, '3/30');
  create temp table t3980w3t3_wb on commit drop as select brand_id, updated_at from public.ops_brand_autolink_waits where brand_id::text ~ '^3a970000-0000-4000-b3';
  v := public.ops_brand_autolink();
  select count(*) into v_seen from public.ops_brand_autolink_waits w join t3980w3t3_wb b using (brand_id) where w.updated_at <> b.updated_at;
  perform pg_temp.w3t3_check('BUDGET', 'a third run looks at none of the 30 decided brands again and reopens none of their cards',
    v_seen::text || '/' || (select count(*) from public.ops_work_cards where auto_key ~ '^brand_pick:3a970000-0000-4000-b3' and status <> 'done')::text, '0/0');
end;
$budget$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
do $report$
declare r record; v_fail integer := 0; v_total integer := 0;
begin
  for r in select * from t3980w3t3_results order by seq loop
    v_total := v_total + 1;
    if r.ok then raise notice 'PASS [%] %', r.test, r.label;
    else v_fail := v_fail + 1; raise warning 'FAIL [%] % -- %', r.test, r.label, r.detail; end if;
  end loop;
  if v_total = 0 then raise exception 'issue 3980 W3 rework 3 tester: no checks ran'; end if;
  if v_fail > 0 then raise exception 'issue 3980 W3 rework 3 tester: % of % checks failed', v_fail, v_total; end if;
  raise notice 'issue 3980 W3 rework 3 tester: all % checks passed', v_total;
end;
$report$;

rollback;
