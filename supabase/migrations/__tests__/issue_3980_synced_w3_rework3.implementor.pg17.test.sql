-- Issue #3980 synced program, Wave 3 rework 3, on the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   P1     a phone number read in a borrowed country never links by itself:
--          a side with no country on record is never read in the other
--          side's country. Exact only when both sides give the same full
--          number from their own known country, or both are written in full
--          international form. The tester's 24 pairs, plus the same Nigerian
--          number with and without +234 where the card's country is known.
--          End to end: a Memphis "(901) 234-5678" on a card with no region
--          and a Lagos brand "0901 234 5678" link nothing, the stage stays,
--          and a person gets a card to pick
--   WORDS  the pick card says plainly why a person must pick, and never says
--          "not the same number" when the digits are the same
--   DEC    a person's decision on a pick card is remembered, and asked again
--          (the same card, opened again, nothing linked) when a new exact
--          host card appears that was not on the card when they decided
--   AGENT  an agent closing a pick card is not a person's decision: the card
--          opens again on the next run
--   STEPS3 the save says how many of a promised date's steps a person
--          already finished or declined ("settled")

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

create temp table t3980w3c_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w3c_people (who, id, email) values
  ('owner',  '39920000-0000-4000-a000-000000000001', 'ed.w3c3980@test.local'),
  ('growth', '39920000-0000-4000-a000-000000000003', 'ada.w3c3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w3c_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3c3980@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3c3980@test.local', 'growth', 'active', now());

create temp table t3980w3c_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w3c_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t3980w3c_people where who = p_who;
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

create function pg_temp.w3c_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.w3c_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.w3c_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3c_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w3c_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w3c_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w3c_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.w3c_today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;

create function pg_temp.w3c_brand_of(p_record text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') from public.crm_records where id = p_record::uuid $fn$;

-- The open cards counted from a promised date, as "<count>:<kinds>".
create function pg_temp.w3c_open(p_exp text) returns text
language sql as $fn$
  select count(*)::text || ':' || coalesce(string_agg(split_part(w.auto_key, ':', 1), ',' order by w.auto_key), '')
    from public.ops_work_cards w
   where w.status <> 'done' and w.archived_at is null and w.auto_key like '%' || p_exp
$fn$;

create function pg_temp.w3c_same(p_card text, p_cc text, p_brand text, p_bc text) returns text
language sql as $fn$ select coalesce(public.ops_phone_same(public.crm_ident_key('phone', p_card), p_cc, public.crm_ident_key('phone', p_brand), p_bc)::text, 'null') $fn$;

create function pg_temp.w3c_stage(p_record text) returns text
language sql as $fn$ select coalesce(brand_id::text, 'none') || '/' || stage from public.crm_records where id = p_record::uuid $fn$;

create function pg_temp.w3c_pick(p_brand text) returns public.ops_work_cards
language sql as $fn$ select w.* from public.ops_work_cards w where w.auto_key = 'brand_pick:' || p_brand order by w.number desc limit 1 $fn$;

-- ---------------------------------------------------------------------------
-- P1: the rule, pair by pair (the tester's 24 pairs, then the known-country links).
-- ---------------------------------------------------------------------------
do $p1$
declare r record;
begin
  for r in select * from (values
    ('regionless card US-style 901 vs NG brand 0901', '(901) 234-5678', null, '0901 234 5678', 'NG', 'false'),
    ('regionless card US-style 207 vs GB brand 020', '207 123 4567', null, '020 7123 4567', 'GB', 'false'),
    ('regionless card 0901 vs NG brand 0901 (same digits)', '0901 234 5678', null, '0901 234 5678', 'NG', 'false'),
    ('NG card no-trunk 9012345678 vs US brand +1 901', '9012345678', 'NG', '+1 901 234 5678', 'US', 'false'),
    ('US card 901 vs regionless brand 0901', '(901) 234-5678', 'US', '0901 234 5678', null, 'false'),
    ('NG card 0901 vs regionless brand US-style 901', '0901 234 5678', 'NG', '(901) 234-5678', null, 'false'),
    ('two regionless identical 0901', '0901 234 5678', null, '0901 234 5678', null, 'false'),
    ('two regionless identical 9012345678', '9012345678', null, '9012345678', null, 'false'),
    ('regionless card 9012345678 vs regionless +234 901', '9012345678', null, '+234 901 234 5678', null, 'false'),
    ('regionless card 9012345678 vs regionless +1 901', '9012345678', null, '+1 901 234 5678', null, 'false'),
    ('regionless card 0901 vs regionless +1 901', '0901 234 5678', null, '+1 901 234 5678', null, 'false'),
    ('GB card +44 7911 vs GB brand 07911', '+44 7911 123456', 'GB', '07911 123456', 'GB', 'true'),
    ('GB card 07911 vs regionless +44 7911', '07911 123456', 'GB', '+44 7911 123456', null, 'true'),
    ('GB card 07911 vs NG brand 07911', '07911 123456', 'GB', '07911 123456', 'NG', 'false'),
    ('regionless 07911 vs NG brand +234 7911', '07911 123456', null, '+234 7911 123456', 'NG', 'false'),
    ('regionless 7911123456 vs NG brand 07911123456', '7911123456', null, '07911 123456', 'NG', 'false'),
    ('US card 1-901 11 digits vs US brand +1', '1 901 234 5678', 'US', '+19012345678', 'US', 'true'),
    ('NG card 2349012345678 (no plus) vs +234', '2349012345678', 'NG', '+2349012345678', 'NG', 'false'),
    ('IE card 087 vs regionless +353 87 (3-digit code read at its length)', '087 123 4567', 'IE', '+353 87 123 4567', null, 'true'),
    ('regionless 087 vs regionless +353 87', '087 123 4567', null, '+353 87 123 4567', null, 'false'),
    ('regionless 020 vs regionless +233 20 (GH)', '020 123 4567', null, '+233 20 123 4567', null, 'false'),
    ('regionless 020 vs regionless +44 20', '020 1234 5678', null, '+44 20 1234 5678', null, 'false'),
    ('US card 901 vs CA brand 901 (both +1)', '901 234 5678', 'US', '901 234 5678', 'CA', 'true'),
    ('US card 011 44 dial-out vs GB +44', '011 44 7911 123456', 'US', '+44 7911 123456', 'GB', 'false'),
    -- The links that stay: the country of each national number is its own and on record.
    ('NG card 0901 vs NG brand +234 901', '0901 234 5678', 'NG', '+234 901 234 5678', 'NG', 'true'),
    ('NG card 0901 vs brand with no country +234 901', '0901 234 5678', 'NG', '+234 901 234 5678', null, 'true'),
    ('card with no country +234 901 vs NG brand 0901', '+234 901 234 5678', null, '0901 234 5678', 'NG', 'true'),
    ('both written in full, no countries', '+234 901 234 5678', null, '+2349012345678', null, 'true'),
    ('NG card without its 0 vs NG brand 0901', '901 234 5678', 'NG', '0901 234 5678', 'NG', 'true'),
    ('a side that cannot be read is false, never null', 'not a number', 'NG', '0901 234 5678', 'NG', 'false')
  ) t(label, card, cc, brand, bc, want) loop
    perform pg_temp.w3c_check('P1', r.label, pg_temp.w3c_same(r.card, r.cc, r.brand, r.bc), r.want);
  end loop;
end;
$p1$;

-- ---------------------------------------------------------------------------
-- P1 end to end, WORDS, DEC, AGENT.
-- ---------------------------------------------------------------------------
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('39920000-0000-4000-e000-000000000001', 'w3c-lagos', 'W3C Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5),
  ('39920000-0000-4000-e000-000000000002', 'w3c-memphis', 'W3C Memphis', 'United States', 'US', 35.1, -90.0, 35.0, -90.1, 35.2, -89.9);
insert into public.crm_records (id, pipeline, name, stage, region_id, created_by, updated_by) values
  ('39920000-0000-4000-c100-000000000001', 'hosts', 'W3C Memphis No Region', 'contacted', null, 'w3c', 'w3c'),
  ('39920000-0000-4000-c100-000000000002', 'hosts', 'W3C Twin No Region', 'contacted', null, 'w3c', 'w3c'),
  ('39920000-0000-4000-c100-000000000003', 'hosts', 'W3C Lagos Known', 'contacted', '39920000-0000-4000-e000-000000000001', 'w3c', 'w3c'),
  ('39920000-0000-4000-c100-000000000004', 'hosts', 'W3C Memphis Known', 'contacted', '39920000-0000-4000-e000-000000000002', 'w3c', 'w3c'),
  ('39920000-0000-4000-c100-000000000005', 'hosts', 'W3C Decide A', 'contacted', null, 'w3c', 'w3c'),
  ('39920000-0000-4000-c100-000000000006', 'hosts', 'W3C Decide B', 'contacted', null, 'w3c', 'w3c'),
  ('39920000-0000-4000-c100-000000000007', 'hosts', 'W3C Agent A', 'contacted', null, 'w3c', 'w3c'),
  ('39920000-0000-4000-c100-000000000008', 'hosts', 'W3C Agent B', 'contacted', null, 'w3c', 'w3c');
insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by)
select r::uuid, k, null, val, public.crm_ident_key(k, val), 'w3c' from (values
  ('39920000-0000-4000-c100-000000000001', 'phone', '(901) 234-5678'),
  ('39920000-0000-4000-c100-000000000002', 'phone', '0803 555 1212'),
  ('39920000-0000-4000-c100-000000000003', 'phone', '0805 444 3322'),
  ('39920000-0000-4000-c100-000000000004', 'phone', '(806) 111-2299'),
  ('39920000-0000-4000-c100-000000000005', 'email', 'decide@w3c3980.test'),
  ('39920000-0000-4000-c100-000000000006', 'email', 'decide@w3c3980.test'),
  ('39920000-0000-4000-c100-000000000007', 'email', 'agent@w3c3980.test'),
  ('39920000-0000-4000-c100-000000000008', 'email', 'agent@w3c3980.test')) t(r, k, val);

update public.ops_settings set value = to_jsonb(now() - interval '3 hours') where key = 'brand_auto_since';
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, country_code, contact_email, contact_phone, social_links, created_at) values
  ('39920000-0000-4000-b100-000000000001', '39920000-0000-4000-b900-000000000001', 'W3C Lagos Lounge', 'w3c-lagos-lounge', 'Lagos', 'NG', null, '0901 234 5678', '{}', now() - interval '170 minutes'),
  ('39920000-0000-4000-b100-000000000002', '39920000-0000-4000-b900-000000000002', 'W3C Unknown Place', 'w3c-unknown', 'Nowhere', null, null, '0803 555 1212', '{}', now() - interval '169 minutes'),
  ('39920000-0000-4000-b100-000000000003', '39920000-0000-4000-b900-000000000003', 'W3C Lagos Same', 'w3c-lagos-same', 'Lagos', 'NG', null, '+234 805 444 3322', '{}', now() - interval '168 minutes'),
  ('39920000-0000-4000-b100-000000000004', '39920000-0000-4000-b900-000000000004', 'W3C Lagos Other', 'w3c-lagos-other', 'Lagos', 'NG', null, '0806 111 2299', '{}', now() - interval '167 minutes'),
  ('39920000-0000-4000-b100-000000000005', '39920000-0000-4000-b900-000000000005', 'W3C Decided Brand', 'w3c-decided', 'Lagos', 'NG', 'decide@w3c3980.test', null, '{}', now() - interval '166 minutes'),
  ('39920000-0000-4000-b100-000000000006', '39920000-0000-4000-b900-000000000006', 'W3C Agent Brand', 'w3c-agent', 'Lagos', 'NG', 'agent@w3c3980.test', null, '{}', now() - interval '165 minutes');
set local session_replication_role = origin;

do $e2e$
declare v jsonb; c public.ops_work_cards; v_id uuid; v_n bigint;
begin
  v := public.ops_brand_autolink();
  -- P1 end to end.
  perform pg_temp.w3c_check('P1', 'a Memphis (901) on a card with no region never links a Lagos brand 0901, and its stage stays',
    pg_temp.w3c_stage('39920000-0000-4000-c100-000000000001'), 'none/contacted');
  c := pg_temp.w3c_pick('39920000-0000-4000-b100-000000000001');
  perform pg_temp.w3c_check('P1', 'and a person gets a card to pick naming that card',
    c.status || '/' || (select count(*) from public.ops_work_links l where l.card_id = c.id and l.kind = 'host'
                         and l.target_id = '39920000-0000-4000-c100-000000000001')::text, 'todo/1');
  perform pg_temp.w3c_check('P1', 'the same Nigerian number with and without +234 links where the card''s country is known',
    pg_temp.w3c_stage('39920000-0000-4000-c100-000000000003'), '39920000-0000-4000-b100-000000000003/onboarded');
  perform pg_temp.w3c_check('P1', 'a Memphis-region card and a Lagos brand with the same digits never link',
    pg_temp.w3c_stage('39920000-0000-4000-c100-000000000004'), 'none/contacted');

  -- WORDS.
  perform pg_temp.w3c_like('WORDS', 'a number that ends the same with no country on record says Mingla cannot tell',
    c.instructions, '%a phone number that ends the same, and no country is on record to tell if it is the same number%');
  c := pg_temp.w3c_pick('39920000-0000-4000-b100-000000000002');
  perform pg_temp.w3c_like('WORDS', 'the very same digits say they are the same number written without a country code',
    c.instructions, '%the same phone number written without a country code, and no country is on record to tell whose number it is%W3C Twin No Region%');
  perform pg_temp.w3c_check('WORDS', 'and never say "not the same number" or "different" for the same digits',
    (c.instructions !~* '(not the same number|different)')::text, 'true');
  c := pg_temp.w3c_pick('39920000-0000-4000-b100-000000000004');
  perform pg_temp.w3c_like('WORDS', 'two numbers from two known countries say they are different full numbers',
    c.instructions, '%a phone number that ends the same but is a different full number%W3C Memphis Known%');

  -- DEC: a person closes the pick card (neither card is right).
  c := pg_temp.w3c_pick('39920000-0000-4000-b100-000000000005');
  v_id := c.id;
  perform pg_temp.w3c_check('DEC', 'two cards share the brand''s email: a card to pick', c.status, 'todo');
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Neither card is this brand', closed_at = now(),
         closed_by = 'ed.w3c3980@test.local', closed_via = null where id = v_id;
  delete from public.ops_brand_autolink_waits;
  v := public.ops_brand_autolink();
  perform pg_temp.w3c_check('DEC', 'the person''s decision is remembered: nothing opens again with nothing new',
    (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39920000-0000-4000-b100-000000000005' and status <> 'done')::text, '0');
  perform pg_temp.w3c_check('DEC', 'a decided brand with nothing new is not even looked at (no try, no wait)',
    (select count(*) from public.ops_brand_autolink_waits where brand_id = '39920000-0000-4000-b100-000000000005')::text, '0');
  perform pg_temp.w3c_check('DEC', 'and the result says it is decided',
    (public.ops_brand_autolink_one('39920000-0000-4000-b100-000000000005')->>'status'), 'decided');
  -- The real host card with the brand's exact email is added later.
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('39920000-0000-4000-c100-000000000009', 'hosts', 'W3C The Real Host', 'contacted', 'w3c', 'w3c');
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by)
  values ('39920000-0000-4000-c100-000000000009', 'email', null, 'decide@w3c3980.test', 'decide@w3c3980.test', 'w3c');
  update public.crm_records set deleted_at = now(), deleted_by = 'w3c'
   where id in ('39920000-0000-4000-c100-000000000005', '39920000-0000-4000-c100-000000000006');
  v := public.ops_brand_autolink();
  c := pg_temp.w3c_pick('39920000-0000-4000-b100-000000000005');
  perform pg_temp.w3c_check('DEC', 'a new exact host card asks again: the same card is open again',
    (c.id = v_id)::text || '/' || c.status || '/' || coalesce(c.closed_via, 'none'), 'true/todo/none');
  perform pg_temp.w3c_check('DEC', 'and nothing was linked by itself',
    pg_temp.w3c_stage('39920000-0000-4000-c100-000000000009'), 'none/contacted');
  perform pg_temp.w3c_like('DEC', 'the card names the new host card and says a person decides again',
    c.title || ' | ' || c.instructions, 'Pick the host card for W3C Decided Brand again | %W3C The Real Host has the same email, phone or handle%');
  perform pg_temp.w3c_check('DEC', 'the new host card is linked on the card for the person to pick',
    (select count(*) from public.ops_work_links l where l.card_id = v_id and l.kind = 'host' and l.target_id = '39920000-0000-4000-c100-000000000009')::text, '1');
  perform pg_temp.w3c_check('DEC', 'its history says it opened again',
    (select count(*) from public.ops_work_events e where e.card_id = v_id and e.action = 'reopened')::text, '1');
  -- Closed again by a person: remembered again, the new card is now on it.
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Still not this brand', closed_at = now(),
         closed_by = 'ed.w3c3980@test.local', closed_via = null where id = v_id;
  v := public.ops_brand_autolink();
  perform pg_temp.w3c_check('DEC', 'closed again by a person, it stays closed',
    (select status from public.ops_work_cards where id = v_id), 'done');

  -- AGENT: an agent closes the pick card; that is not a person's decision.
  c := pg_temp.w3c_pick('39920000-0000-4000-b100-000000000006');
  v_id := c.id; v_n := c.number;
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Agent thinks neither', closed_at = now(),
         closed_by = 'ed.w3c3980@test.local', closed_via = 'claude' where id = v_id;
  delete from public.ops_brand_autolink_waits;
  v := public.ops_brand_autolink();
  c := pg_temp.w3c_pick('39920000-0000-4000-b100-000000000006');
  perform pg_temp.w3c_check('AGENT', 'an agent''s close is not a decision: the same card opens again for a person',
    (c.id = v_id)::text || '/' || c.status || '/' || coalesce(c.closed_via, 'none'), 'true/todo/none');
  perform pg_temp.w3c_check('AGENT', 'and no second card was made',
    (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39920000-0000-4000-b100-000000000006')::text, '1');
  perform pg_temp.w3c_check('AGENT', 'the brand never waits after it',
    (select count(*) from public.ops_brand_autolink_waits where brand_id = '39920000-0000-4000-b100-000000000006')::text, '0');
  -- Codex too.
  update public.ops_work_cards set status = 'done', close_kind = 'done', close_reason = 'Agent marked it done', closed_at = now(),
         closed_by = 'ed.w3c3980@test.local', closed_via = 'codex' where id = v_id;
  v := public.ops_brand_autolink();
  perform pg_temp.w3c_check('AGENT', 'a Codex agent''s close opens it again too',
    (select status from public.ops_work_cards where id = v_id), 'todo');
end;
$e2e$;

-- ---------------------------------------------------------------------------
-- STEPS3: the save counts the steps a person already closed.
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, icp, created_by, updated_by) values
  ('39920000-0000-4000-c300-000000000001', 'hosts', 'W3C Note Host', 'onboarded', 'event_organizer', 't', 't');
insert into public.crm_record_owners (record_id, owner_email, added_by) values ('39920000-0000-4000-c300-000000000001', 'ada.w3c3980@test.local', 't');
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by) values
  ('39920000-0000-4000-d100-000000000001', '39920000-0000-4000-c300-000000000001', 'W3C Note Night', 'event', (now() AT TIME ZONE 'UTC')::date + 30, 'none', 't', 't');
update public.ops_settings set value = 'true'::jsonb where key = 'auto_steps';
do $steps$
declare v text;
begin
  perform public.ops_auto_steps(null, null);
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Host runs it off Mingla', closed_at = now() - interval '1 hour',
         closed_by = 'ada.w3c3980@test.local', closed_via = null
   where auto_key = 'golive:expected:39920000-0000-4000-d100-000000000001' and status <> 'done';
  v := pg_temp.w3c_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39920000-0000-4000-c300-000000000001', 'id', '39920000-0000-4000-d100-000000000001', 'note', 'Doors at 9'), 'w3c-note-0001'));
  perform pg_temp.w3c_check('STEPS3', 'after a person declined the go-live step, the save says 0 open and 1 already closed',
    (pg_temp.w3c_j(v)->'steps'->>'open') || '/' || (pg_temp.w3c_j(v)->'steps'->>'settled'), '0/1');
end;
$steps$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
do $report$
declare r record; v_fail integer := 0; v_total integer := 0;
begin
  for r in select * from t3980w3c_results order by seq loop
    v_total := v_total + 1;
    if r.ok then raise notice 'PASS [%] %', r.test, r.label;
    else v_fail := v_fail + 1; raise warning 'FAIL [%] % -- %', r.test, r.label, r.detail; end if;
  end loop;
  if v_total = 0 then raise exception 'issue 3980 W3 rework 3: no checks ran'; end if;
  if v_fail > 0 then raise exception 'issue 3980 W3 rework 3: % of % checks failed', v_fail, v_total; end if;
  raise notice 'issue 3980 W3 rework 3: all % checks passed', v_total;
end;
$report$;

rollback;
