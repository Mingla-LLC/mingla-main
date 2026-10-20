-- Issue #3980 synced program, Wave 4 -- INDEPENDENT TESTER adversarial suite
-- for the owner's opt-in backfills, on the fully replayed PG17 schema.
--
-- A different angle from the implementor's happy path:
--   W4T-WHO     callers the happy path does not try: a signed-in person who
--               is not on the team, an invited (not yet active) owner, the
--               service role with no person, the owner's Codex agent, and an
--               owner whose earlier request row is from another transaction
--               (still a person). The helpers, ops_brand_match and
--               ops_brand_autolink_one stay closed to every client role.
--   W4T-QUIET   a preview writes nothing anywhere: every public table keeps
--               its row count and the tables a backfill could touch keep
--               their exact contents (md5), including the agent log, request
--               keys and the brand auto-link wait list.
--   W4T-SAME    the preview ALWAYS says what brand auto-link then does, over
--               the W3 rework 2 phone rules: US, Nigerian and UK numbers read
--               across countries, a leading trunk 0, a leading 1, a side with
--               no country, a shared number, handles on the same and another
--               platform, a sign-in email, a Lost card, a card of the same
--               name (Lost or not, any case or punctuation), a deleted card,
--               a creator with the same email, a public listing. Each brand
--               is confirmed alone and rolled back, so order never matters.
--   W4T-LOST    a Lost card is never linked or reopened: not by a confirm, not
--               after the card was matched by email or by phone, and not when
--               the owner confirms the same brand twice with two keys.
--   W4T-CAP     the 100 cap counts distinct brands (101 refused, 101 entries
--               naming 100 brands accepted), a NULL entry is refused, an
--               unknown brand is "gone", a brand with a card is "has_card".
--   W4T-KEY     a brand confirm with the same brands in another order is the
--               same request (replayed); a malformed key is refused; the same
--               key for a roadmap confirm is never mixed with a brand confirm.
--   W4T-ROAD    roadmap: exactly 50 is accepted and 51 refused even when they
--               are duplicates; a number Mingla knows as a pull request is
--               invalid even written as an issue link; a card linked to
--               another issue is listed again with a new issue and keeps its
--               link after the confirm; a card title with quotes, percent
--               signs and markup comes back as plain data in the words.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

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

create temp table t3980w4t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w4t_people (who, id, email) values
  ('owner',    '4e4a0000-0000-4000-a000-000000000001', 'ola.w4t3980@test.local'),
  ('admin',    '4e4a0000-0000-4000-a000-000000000002', 'bisi.w4t3980@test.local'),
  ('growth',   '4e4a0000-0000-4000-a000-000000000003', 'tunde.w4t3980@test.local'),
  ('stranger', '4e4a0000-0000-4000-a000-000000000004', 'nobody.w4t3980@test.local'),
  ('invited',  '4e4a0000-0000-4000-a000-000000000005', 'soon.w4t3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w4t_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ola.w4t3980@test.local', 'owner', 'active', now()),
  ('bisi.w4t3980@test.local', 'admin', 'active', now()),
  ('soon.w4t3980@test.local', 'owner', 'invited', null);
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('tunde.w4t3980@test.local', 'growth', 'active', now());

create temp table t3980w4t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w4t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 900), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w4t_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4t_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 900), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w4t_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 400));
end;
$fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.w4t_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

-- Runs p_sql as p_who: a signed-in person, 'anon', or 'service' (the service
-- role with no person at all). Returns the text result or ERR:<state>:<msg>.
create function pg_temp.w4t_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w4t_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
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

create function pg_temp.w4t_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.w4t_next_request();
  return pg_temp.w4t_as(p_who, p_sql);
end;
$fn$;

-- The person's own connected agent (p_agent claude or codex) in this request.
create function pg_temp.w4t_agent(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.w4t_next_request();
  select id, email into strict v_id, v_email from t3980w4t_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'list_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.w4t_as(p_who, p_sql);
end;
$fn$;

-- Every public table's row count, and the exact contents of every table a
-- backfill or brand auto-link could touch. One string, compared before/after.
-- team_agent_calls is left out: this suite's agent stand-in writes it.
create function pg_temp.w4t_world() returns text
language plpgsql as $fn$
declare r record; v_n bigint; v_parts text[] := array[]::text[]; v_md5 text;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p')
              and c.relname <> 'team_agent_calls' -- written by this suite's own agent stand-in, never by a backfill
            order by c.relname loop
    execute format('select count(*) from public.%I', r.relname) into v_n;
    v_parts := v_parts || (r.relname || '=' || v_n);
  end loop;
  for r in select unnest(array['crm_records', 'crm_activity', 'crm_record_identifiers', 'crm_record_owners', 'ops_work_cards',
                               'ops_work_links', 'ops_work_people', 'ops_roadmap_links', 'ops_agent_log', 'ops_request_keys',
                               'ops_brand_autolink_waits', 'ops_settings', 'ops_github_items', 'community_roadmap_cards',
                               'brands', 'product_capabilities', 'ops_work_events']) as t loop
    if to_regclass('public.' || r.t) is not null then
      execute format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) from public.%I x', r.t) into v_md5;
      v_parts := v_parts || (r.t || '#' || v_md5);
    end if;
  end loop;
  return array_to_string(v_parts, ',');
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Brand fixtures: three launch cities, host cards with phones, emails and
-- handles, and brands that sign up with them.
-- ---------------------------------------------------------------------------
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('4e4a0000-0000-4000-e000-000000000001', 'w4t-lagos', 'W4T Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5),
  ('4e4a0000-0000-4000-e000-000000000002', 'w4t-memphis', 'W4T Memphis', 'United States', 'US', 35.1, -90.0, 35.0, -90.1, 35.2, -89.9),
  ('4e4a0000-0000-4000-e000-000000000003', 'w4t-london', 'W4T London', 'United Kingdom', 'GB', 51.5, -0.1, 51.4, -0.2, 51.6, 0.0);

create temp table t3980w4t_h (n int, name text, stage text, region int, kind text, plat text, val text) on commit drop;
insert into t3980w4t_h values
  (1,  'W4T US Intl',             'contacted', 2,    'phone',  null,        '+1 901 234 5678'),
  (2,  'W4T US National',         'contacted', 2,    'phone',  null,        '(901) 234-5600'),
  (3,  'W4T NG Trunk',            'contacted', 1,    'phone',  null,        '0803 123 4567'),
  (4,  'W4T Regionless UK Trunk', 'contacted', null, 'phone',  null,        '07700 900123'),
  (5,  'W4T Regionless UK Two',   'contacted', null, 'phone',  null,        '07700 900555'),
  (6,  'W4T Regionless Bare',     'contacted', null, 'phone',  null,        '9015551234'),
  (7,  'W4T Shared A',            'contacted', 1,    'phone',  null,        '+234 800 000 0001'),
  (8,  'W4T Shared B',            'contacted', 1,    'phone',  null,        '0800 000 0001'),
  (9,  'W4T London Landline',     'contacted', 3,    'phone',  null,        '020 7946 0018'),
  (10, 'W4T Lost Email',          'lost',      null, 'email',  null,        'lost@w4t3980.test'),
  (11, 'W4T Lost Phone',          'lost',      1,    'phone',  null,        '0809 999 0001'),
  (12, 'W4T Near Of Lost',        'contacted', 2,    'phone',  null,        '+1 202 999 0001'),
  (13, 'W4T US DC',               'contacted', 2,    'phone',  null,        '+1 202 555 0100'),
  (14, 'W4T US Trunk One',        'contacted', 2,    'phone',  null,        '1-901-555-0000'),
  (15, 'W4T Name Twin',           'prospect',  null, 'email',  null,        'nametwin-card@w4t3980.test'),
  (16, 'W4T Taken Card',          'onboarded', null, 'email',  null,        'taken@w4t3980.test'),
  (17, 'W4T Deleted Name',        'prospect',  null, 'email',  null,        'deleted@w4t3980.test'),
  (18, 'W4T Insta Card',          'contacted', null, 'handle', 'instagram', 'w4tgram'),
  (19, 'the rooftop!',            'prospect',  null, 'email',  null,        'rooftop-card@w4t3980.test'),
  (20, 'W4T Lost Name',           'lost',      null, 'email',  null,        'lostname-card@w4t3980.test'),
  (21, 'W4T Live Card',           'live',      null, 'email',  null,        'livecard@w4t3980.test'),
  (22, 'W4T NG Lagos Card',       'contacted', 1,    'phone',  null,        '0901 234 5678'),
  (23, 'W4T Regionless US Style', 'contacted', null, 'phone',  null,        '(901) 234-5678');
insert into public.crm_records (id, pipeline, name, stage, stage_reason, region_id, created_by, updated_by)
select ('4e4a0000-0000-4000-c100-' || lpad(n::text, 12, '0'))::uuid, 'hosts', name, stage,
       case when stage = 'lost' then 'Not now' end,
       case when region is null then null else ('4e4a0000-0000-4000-e000-' || lpad(region::text, 12, '0'))::uuid end, 'w4t', 'w4t'
  from t3980w4t_h;
insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by)
select ('4e4a0000-0000-4000-c100-' || lpad(n::text, 12, '0'))::uuid, kind, plat, val, public.crm_ident_key(kind, val), 'w4t'
  from t3980w4t_h;
insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
  ('4e4a0000-0000-4000-c100-000000000002', 'email', 'hello@w4tdual.test', public.crm_ident_key('email', 'hello@w4tdual.test'), 'w4t');
update public.crm_records set deleted_at = now(), deleted_by = 'w4t' where id = '4e4a0000-0000-4000-c100-000000000017';
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('4e4a0000-0000-4000-c100-000000000099', 'creators', 'W4T Creator Same', 'identified', 'w4t', 'w4t');
insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
  ('4e4a0000-0000-4000-c100-000000000099', 'email', 'creator@w4t3980.test', public.crm_ident_key('email', 'creator@w4t3980.test'), 'w4t');

-- want: the action the preview must show. NULL where the answer belongs to the
-- W3 phone rules still being reworked (a card with no region read in a
-- borrowed country, brands 1, 4, 5, 6): those brands are still checked by
-- W4T-SAME (the preview equals what auto-link does), whatever the rule says.
create temp table t3980w4t_b (n int, name text, city text, cc text, pay text, email text, phone text, social jsonb, want text) on commit drop;
insert into t3980w4t_b values
  (1,  'W4T B Lagos Local Vs US',            'Lagos',   'NG', null, null, '0901 234 5678',    '{}', null),
  (2,  'W4T B US Intl Vs National',          'Memphis', 'US', null, null, '+1 901 234 5600',  '{}', 'link'),
  (3,  'W4T B Regionless Intl NG',           null,      null, null, null, '+2348031234567',   '{}', 'link'),
  (4,  'W4T B GB Intl',                      'London',  'GB', null, null, '+447700900123',    '{}', null),
  (5,  'W4T B Regionless Intl UK',           null,      null, null, null, '+44 7700 900555',  '{}', null),
  (6,  'W4T B Regionless NG Bare',           null,      null, null, null, '+2349015551234',   '{}', null),
  (7,  'W4T B Shared',                       'Lagos',   'NG', null, null, '08000000001',      '{}', 'pick'),
  (8,  'W4T B UK Pay',                       null,      null, 'GB', null, '+44 20 7946 0018', '{}', 'link'),
  (9,  'W4T B Lost Email',                   'Lagos',   null, null, 'LOST@w4t3980.test', null, '{}', 'reopen'),
  (10, 'W4T B Lost Phone',                   'Lagos',   'NG', null, null, '+2348099990001',   '{}', 'reopen'),
  (11, 'W4T B GB Vs DC',                     'London',  'GB', null, null, '020 2555 0100',    '{}', 'pick'),
  (12, 'W4T B US Trunk',                     'Memphis', 'US', null, null, '+19015550000',     '{}', 'link'),
  (13, 'W4T Name Twin',                      'Lagos',   null, null, 'nametwin-brand@w4t3980.test', null, '{}', 'pick'),
  (14, 'W4T B Fresh',                        'Lagos',   null, null, 'fresh@w4t3980.test', null, '{}', 'create'),
  (15, 'W4T B Fresh Live',                   'Lagos',   null, null, 'freshlive@w4t3980.test', null, '{}', 'create'),
  (16, 'W4T B Taken',                        'Lagos',   null, null, 'taken@w4t3980.test', null, '{}', 'pick'),
  (17, 'W4T Deleted Name',                   'Lagos',   null, null, 'deleted@w4t3980.test', null, '{}', 'create'),
  (18, 'W4T B Creator Email',                'Lagos',   null, null, 'creator@w4t3980.test', null, '{}', 'create'),
  (19, 'The Rooftop',                        'Lagos',   null, null, 'rooftop-brand@w4t3980.test', null, '{}', 'pick'),
  (20, 'W4T Lost Name',                      'Lagos',   null, null, 'lostname-brand@w4t3980.test', null, '{}', 'pick'),
  (21, 'W4T B Insta Other Platform',         'Lagos',   null, null, null, null, '{"tiktok":"@w4tgram"}', 'pick'),
  (22, 'W4T B Insta Same',                   'Lagos',   null, null, null, null, '{"instagram":"https://instagram.com/w4tgram"}', 'link'),
  (23, 'W4T B Bad Email',                    'Lagos',   null, null, 'not-an-email', null, '{}', 'create'),
  (24, 'W4T B Bad Phone',                    'Lagos',   null, null, null, '12', '{}', 'create'),
  (25, 'W4T B Live Past Only',               'Lagos',   null, null, 'pastlive@w4t3980.test', null, '{}', 'create'),
  (26, 'W4T B Account Email',                'Lagos',   null, null, null, null, '{}', 'link'),
  (27, 'W4T B Live Card Email',              'Lagos',   null, null, 'livecard@w4t3980.test', null, '{}', 'link'),
  (29, 'W4T B Lost Phone Plus Near',         'Memphis', 'US', null, null, '+1 202 999 0001', '{}', 'link'),
  (30, 'W4T B Email And Phone Two Cards',    'Lagos',   'NG', null, 'hello@w4tdual.test', '+1 202 555 0100', '{}', 'pick'),
  (31, 'W4T B Other Brand Owns Card 16',     'Lagos',   null, null, 'owner16@w4t3980.test', null, '{}', null);
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, country_code, payment_country, contact_email, contact_phone, social_links)
select ('4e4a0000-0000-4000-b100-' || lpad(n::text, 12, '0'))::uuid, ('4e4a0000-0000-4000-b900-' || lpad(n::text, 12, '0'))::uuid,
       name, 'w4t-brand-' || n, city, cc, pay, email, phone, social from t3980w4t_b;
insert into auth.users (id, email, email_confirmed_at) values ('4e4a0000-0000-4000-b900-000000000026', 'nametwin-card@w4t3980.test', now());
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text) values
  ('4e4a0000-0000-4000-e100-000000000015', '4e4a0000-0000-4000-b100-000000000015', 'W4T Live Night', 'w4t-live-night', 'discover', 'scheduled', 'UTC', now() - interval '3 days', 'event', 'W4T Street'),
  ('4e4a0000-0000-4000-e100-000000000025', '4e4a0000-0000-4000-b100-000000000025', 'W4T Past Night', 'w4t-past-night', 'discover', 'scheduled', 'UTC', now() - interval '90 days', 'event', 'W4T Street');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('4e4a0000-0000-4000-e100-000000000015', now() + interval '40 days', now() + interval '40 days 3 hours', true),
  ('4e4a0000-0000-4000-e100-000000000025', now() - interval '60 days', now() - interval '60 days' + interval '3 hours', true);
set local session_replication_role = origin;
update public.crm_records set brand_id = '4e4a0000-0000-4000-b100-000000000031' where id = '4e4a0000-0000-4000-c100-000000000016';

-- ---------------------------------------------------------------------------
-- W4T-WHO: callers the happy path does not try
-- ---------------------------------------------------------------------------
do $who$
declare v_before text := pg_temp.w4t_world();
  c_links constant text := '''[{"card_id":"4e4a0000-0000-4000-d100-000000000001","issue":"#985001"}]''::jsonb';
  c_brands constant text := 'array[''4e4a0000-0000-4000-b100-000000000014''::uuid]';
  v text;
begin
  perform pg_temp.w4t_like('W4T-WHO', 'a signed-in person who is not on the team cannot preview brands',
    pg_temp.w4t_person('stranger', 'select public.ops_brand_cards_preview()::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'a signed-in person who is not on the team cannot confirm roadmap links',
    pg_temp.w4t_person('stranger', 'select public.ops_roadmap_links_confirm(' || c_links || ', ''w4t-stranger-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'an owner who is only invited (not active) cannot confirm brands',
    pg_temp.w4t_person('invited', 'select public.ops_brand_cards_confirm(' || c_brands || ', ''w4t-invited-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'the service role with no person cannot preview roadmap links',
    pg_temp.w4t_as('service', 'select public.ops_roadmap_links_preview(' || c_links || ')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'the service role with no person cannot confirm brands',
    pg_temp.w4t_as('service', 'select public.ops_brand_cards_confirm(' || c_brands || ', ''w4t-service-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'the owner''s Codex agent cannot preview brands',
    pg_temp.w4t_agent('owner', 'codex', 'select public.ops_brand_cards_preview()::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'the owner''s Codex agent cannot confirm roadmap links',
    pg_temp.w4t_agent('owner', 'codex', 'select public.ops_roadmap_links_confirm(' || c_links || ', ''w4t-codex-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'an admin''s own agent cannot confirm brands either',
    pg_temp.w4t_agent('admin', 'claude', 'select public.ops_brand_cards_confirm(' || c_brands || ', ''w4t-admagent-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4t_like('W4T-WHO', 'a signed-out caller cannot preview roadmap links',
    pg_temp.w4t_as('anon', 'select public.ops_roadmap_links_preview(' || c_links || ')::text'), 'ERR:42501:permission denied%');
  perform pg_temp.w4t_check('W4T-WHO', 'no refused caller wrote anything anywhere', pg_temp.w4t_world(), v_before);
  -- An agent request row from an earlier transaction does not make the owner an agent now.
  v := pg_temp.w4t_agent('owner', 'claude', 'select 1::text');
  v := pg_temp.w4t_person('owner', 'select public.ops_brand_cards_preview()::text');
  perform pg_temp.w4t_check('W4T-WHO', 'the owner, signed in as a person after an earlier agent request, can preview',
    coalesce(pg_temp.w4t_j(v)->'totals'->>'total', v), (select count(*)::text from public.brands br where br.deleted_at is null
      and not exists (select 1 from public.crm_records h where h.brand_id = br.id and h.pipeline = 'hosts' and h.deleted_at is null)));
  perform pg_temp.w4t_check('W4T-WHO', 'no client role can run the helpers, the decision or the auto-link of one brand',
    (select string_agg(r || ':' || f, ',' order by r, f) from unnest(array['anon', 'authenticated']) r,
       unnest(array['public.ops_roadmap_links_check(jsonb)', 'public.ops_brand_cards_rows()', 'public.ops_brand_match(uuid)',
                    'public.ops_brand_autolink_one(uuid)', 'public.ops_brand_autolink()']) f
      where has_function_privilege(r, f, 'EXECUTE')), null);
end;
$who$;

-- ---------------------------------------------------------------------------
-- W4T-QUIET: a preview writes nothing anywhere
-- ---------------------------------------------------------------------------
insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
  ('4e4a0000-0000-4000-d100-000000000001', 'W4T "Quoted" 100% <b>card</b> %s', 'q', 'now', 'published', 980),
  ('4e4a0000-0000-4000-d100-000000000002', 'W4T Linked Elsewhere', 'l', 'next', 'published', 981),
  ('4e4a0000-0000-4000-d100-000000000003', 'W4T Plain', 'p', 'later', 'published', 982);
insert into public.ops_github_items (number, kind, title, url, state, board_status, synced_at) values
  (985009, 'pull', 'A pull request Mingla knows', 'https://github.com/Mingla-LLC/mingla-main/pull/985009', 'MERGED', null, now());
insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values
  ('4e4a0000-0000-4000-d100-000000000002', 985002, 'ola.w4t3980@test.local');

do $quiet$
declare v_before text := pg_temp.w4t_world(); v text;
begin
  v := pg_temp.w4t_person('owner', 'select public.ops_brand_cards_preview()::text');
  perform pg_temp.w4t_check('W4T-QUIET', 'the brand preview answers', (pg_temp.w4t_j(v) ? 'rows')::text, 'true');
  v := pg_temp.w4t_person('owner', $q$select public.ops_roadmap_links_preview('[{"card_id":"4e4a0000-0000-4000-d100-000000000001","issue":"#985001"},
       {"card_id":"4e4a0000-0000-4000-d100-000000000002","issue":"#985003"}]'::jsonb)::text$q$);
  perform pg_temp.w4t_check('W4T-QUIET', 'the roadmap preview answers', pg_temp.w4t_j(v)->>'ready', '1');
  -- The previews three more times, and a refused preview.
  v := pg_temp.w4t_person('owner', 'select public.ops_brand_cards_preview()::text');
  v := pg_temp.w4t_person('owner', 'select public.ops_brand_cards_preview()::text');
  v := pg_temp.w4t_person('owner', $q$select public.ops_roadmap_links_preview('[{"card_id":"4e4a0000-0000-4000-d100-000000000003","issue":"#985004"}]'::jsonb)::text$q$);
  v := pg_temp.w4t_person('owner', 'select public.ops_roadmap_links_preview(''[]''::jsonb)::text');
  perform pg_temp.w4t_check('W4T-QUIET', 'every public table keeps its rows, and the backfill tables their exact contents',
    pg_temp.w4t_world(), v_before);
end;
$quiet$;

-- ---------------------------------------------------------------------------
-- W4T-SAME and W4T-LOST: the preview always says what brand auto-link does
-- ---------------------------------------------------------------------------
create temp table t3980w4t_same (n int primary key, preview text, done text, lost_after text) on commit drop;

do $same$
declare b record; p jsonb; v text; r jsonb; v_done text; v_lost text;
begin
  p := pg_temp.w4t_j(pg_temp.w4t_person('owner', 'select public.ops_brand_cards_preview()::text'));
  for b in select n from t3980w4t_b where n <> 31 order by n loop
    insert into t3980w4t_same (n, preview)
    select b.n, coalesce((select x->>'action' from jsonb_array_elements(p->'rows') x
                           where x->>'brand_id' = ('4e4a0000-0000-4000-b100-' || lpad(b.n::text, 12, '0'))), 'not listed');
    -- Confirm this brand alone, read what happened, and roll it back.
    begin
      v := pg_temp.w4t_person('owner', format('select public.ops_brand_cards_confirm(array[%L]::uuid[], %L)::text',
             '4e4a0000-0000-4000-b100-' || lpad(b.n::text, 12, '0'), 'w4t-same-' || b.n));
      r := pg_temp.w4t_j(v)->'results'->0;
      v_done := coalesce(r->>'status', v);
      v_lost := (select string_agg(coalesce(brand_id::text, 'none') || '/' || stage, ',' order by id) from public.crm_records
                  where id in ('4e4a0000-0000-4000-c100-000000000010', '4e4a0000-0000-4000-c100-000000000011', '4e4a0000-0000-4000-c100-000000000020'));
      raise exception using errcode = 'W4T01', message = v_done || '|' || v_lost;
    exception when sqlstate 'W4T01' then
      update t3980w4t_same set done = split_part(sqlerrm, '|', 1), lost_after = split_part(sqlerrm, '|', 2) where n = b.n;
    end;
  end loop;
end;
$same$;

do $same_check$
begin
  perform pg_temp.w4t_check('W4T-SAME', 'every brand''s confirm does exactly what its preview said (link=linked, create=created, pick=pick, reopen=ask_reopen)',
    (select coalesce(string_agg(n || ':' || preview || '->' || coalesce(done, '?'), ', ' order by n), 'none') from t3980w4t_same
      where coalesce(done, '?') is distinct from case preview when 'link' then 'linked' when 'create' then 'created'
                                                                when 'pick' then 'pick' when 'reopen' then 'ask_reopen' else preview end),
    'none');
  perform pg_temp.w4t_check('W4T-SAME', 'the preview reads each phone in its own country (US, Nigeria, UK, trunk 0, leading 1, shared; borrowed-country cases left to W3)',
    (select string_agg(s.n || '=' || s.preview, ',' order by s.n) from t3980w4t_same s join t3980w4t_b b using (n) where b.want is not null),
    (select string_agg(b.n || '=' || b.want, ',' order by b.n) from t3980w4t_b b where b.want is not null));
  perform pg_temp.w4t_check('W4T-LOST', 'no confirm ever linked or reopened a Lost card (email, phone, same name)',
    (select coalesce(string_agg(n || ':' || lost_after, ' ; ' order by n), 'none') from t3980w4t_same
      where lost_after is distinct from 'none/lost,none/lost,none/lost'), 'none');
end;
$same_check$;

do $lost$
declare v text; p jsonb;
begin
  -- The owner confirms the Lost-email brand twice, with two keys, and then the
  -- brand whose phone only nearly matches a Lost card.
  v := pg_temp.w4t_person('owner', 'select public.ops_brand_cards_confirm(array[''4e4a0000-0000-4000-b100-000000000009'',''4e4a0000-0000-4000-b100-000000000010'']::uuid[], ''w4t-lost-1'')::text');
  v := pg_temp.w4t_person('owner', 'select public.ops_brand_cards_confirm(array[''4e4a0000-0000-4000-b100-000000000009'']::uuid[], ''w4t-lost-2'')::text');
  p := pg_temp.w4t_j(v);
  perform pg_temp.w4t_check('W4T-LOST', 'a second confirm with a new key still only asks a person, and no second card is made',
    (p->'results'->0->>'status') || '|' || (select count(*) from public.ops_work_cards where auto_key = 'brand_lost:4e4a0000-0000-4000-b100-000000000009')::text,
    'ask_reopen|1');
  perform pg_temp.w4t_check('W4T-LOST', 'the Lost cards are still Lost with no brand',
    (select string_agg(coalesce(brand_id::text, 'none') || '/' || stage, ',' order by id) from public.crm_records
      where id in ('4e4a0000-0000-4000-c100-000000000010', '4e4a0000-0000-4000-c100-000000000011')), 'none/lost,none/lost');
  perform pg_temp.w4t_check('W4T-LOST', 'the reopen card goes to the owner and names the Lost card and the brand',
    (select count(*)::text from public.ops_work_cards w where w.auto_key = 'brand_lost:4e4a0000-0000-4000-b100-000000000010' and w.status <> 'done'
        and exists (select 1 from public.ops_work_links l where l.card_id = w.id and l.kind = 'host' and l.target_id = '4e4a0000-0000-4000-c100-000000000011')
        and exists (select 1 from public.ops_work_links l where l.card_id = w.id and l.kind = 'brand' and l.target_id = '4e4a0000-0000-4000-b100-000000000010')), '1');
end;
$lost$;

-- ---------------------------------------------------------------------------
-- W4T-CAP and W4T-KEY
-- ---------------------------------------------------------------------------
do $cap$
declare v text; p jsonb; v_101 text; v_100x text;
begin
  select 'array[' || string_agg(quote_literal(gen_random_uuid()::text), ',') || ']::uuid[]' into v_101 from generate_series(1, 101);
  perform pg_temp.w4t_like('W4T-CAP', '101 different brands are refused',
    pg_temp.w4t_person('owner', format('select public.ops_brand_cards_confirm(%s, %L)::text', v_101, 'w4t-cap-101')), 'ERR:22023:invalid_brands: Choose at most 100 brands at a time.');
  -- 101 entries naming 100 brands: the cap counts brands, not entries.
  select 'array[' || string_agg(quote_literal(case when g = 101 then '4e4a0000-0000-4000-cafe-000000000001' else ('4e4a0000-0000-4000-cafe-' || lpad(g::text, 12, '0')) end), ',') || ']::uuid[]'
    into v_100x from generate_series(1, 101) g;
  p := pg_temp.w4t_j(pg_temp.w4t_person('owner', format('select public.ops_brand_cards_confirm(%s, %L)::text', v_100x, 'w4t-cap-100x')));
  perform pg_temp.w4t_check('W4T-CAP', '101 entries naming 100 brands are accepted, each unknown brand is gone',
    concat_ws('/', jsonb_array_length(p->'results'), p->>'skipped', (select count(*) from jsonb_array_elements(p->'results') r where r->>'status' = 'gone')), '100/100/100');
  perform pg_temp.w4t_like('W4T-CAP', 'a NULL entry is refused',
    pg_temp.w4t_person('owner', 'select public.ops_brand_cards_confirm(array[''4e4a0000-0000-4000-b100-000000000014'', null]::uuid[], ''w4t-cap-null'')::text'), 'ERR:22023:invalid_brands:%');
  p := pg_temp.w4t_j(pg_temp.w4t_person('owner', 'select public.ops_brand_cards_confirm(array[''4e4a0000-0000-4000-b100-000000000031'']::uuid[], ''w4t-cap-hascard'')::text'));
  perform pg_temp.w4t_check('W4T-CAP', 'a brand that already has a host card is left as it is', p->'results'->0->>'status', 'has_card');
  -- W4T-KEY
  p := pg_temp.w4t_j(pg_temp.w4t_person('owner', 'select public.ops_brand_cards_confirm(array[''4e4a0000-0000-4000-b100-000000000014'',''4e4a0000-0000-4000-b100-000000000018'']::uuid[], ''w4t-key-order'')::text'));
  perform pg_temp.w4t_check('W4T-KEY', 'the first confirm adds both cards', concat_ws('/', p->>'created', p->>'replayed'), '2/false');
  p := pg_temp.w4t_j(pg_temp.w4t_person('owner', 'select public.ops_brand_cards_confirm(array[''4e4a0000-0000-4000-b100-000000000018'',''4e4a0000-0000-4000-b100-000000000014'',''4e4a0000-0000-4000-b100-000000000018'']::uuid[], ''w4t-key-order'')::text'));
  perform pg_temp.w4t_check('W4T-KEY', 'the same brands in another order (and one twice) are the same request: replayed, nothing new',
    concat_ws('/', p->>'created', p->>'replayed', (select count(*) from public.crm_records where brand_id in ('4e4a0000-0000-4000-b100-000000000014', '4e4a0000-0000-4000-b100-000000000018'))), '2/true/2');
  perform pg_temp.w4t_like('W4T-KEY', 'a key that is too short is refused',
    pg_temp.w4t_person('owner', 'select public.ops_brand_cards_confirm(array[''4e4a0000-0000-4000-b100-000000000002'']::uuid[], ''short'')::text'), 'ERR:22023:request_key_required:%');
  perform pg_temp.w4t_like('W4T-KEY', 'a brand confirm''s key cannot be reused for a roadmap confirm',
    pg_temp.w4t_person('owner', $q$select public.ops_roadmap_links_confirm('[{"card_id":"4e4a0000-0000-4000-d100-000000000003","issue":"#985004"}]'::jsonb, 'w4t-key-order')::text$q$),
    'ERR:22023:request_key_reused:%');
end;
$cap$;

-- ---------------------------------------------------------------------------
-- W4T-ROAD: roadmap edges
-- ---------------------------------------------------------------------------
do $road$
declare v text; p jsonb; v_50 text; v_51 text;
begin
  select '[' || string_agg('{"card_id":"4e4a0000-0000-4000-d100-000000000003","issue":"#985004"}', ',') || ']' into v_50 from generate_series(1, 50);
  select '[' || string_agg('{"card_id":"4e4a0000-0000-4000-d100-000000000003","issue":"#985004"}', ',') || ']' into v_51 from generate_series(1, 51);
  p := pg_temp.w4t_j(pg_temp.w4t_person('owner', format('select public.ops_roadmap_links_preview(%L::jsonb)::text', v_50)));
  perform pg_temp.w4t_check('W4T-ROAD', 'exactly 50 rows are accepted; the 49 repeats are invalid and only the first is ready',
    concat_ws('/', jsonb_array_length(p->'rows'), p->>'ready', (select count(*) from jsonb_array_elements(p->'rows') r where r->>'status' = 'invalid')), '50/1/49');
  perform pg_temp.w4t_like('W4T-ROAD', '51 rows are refused even when they are all the same line',
    pg_temp.w4t_person('owner', format('select public.ops_roadmap_links_preview(%L::jsonb)::text', v_51)), 'ERR:22023:invalid_links: Send at most 50 links at a time.');
  p := pg_temp.w4t_j(pg_temp.w4t_person('owner', $q$select public.ops_roadmap_links_preview('[
      {"card_id":"4e4a0000-0000-4000-d100-000000000001","issue":"https://github.com/Mingla-LLC/mingla-main/issues/985009"},
      {"card_id":"4e4a0000-0000-4000-d100-000000000003","issue":"#985001"}]'::jsonb)::text$q$));
  perform pg_temp.w4t_check('W4T-ROAD', 'a number Mingla knows as a pull request is invalid even written as an issue link',
    (p->'rows'->0->>'status') || '|' || (p->'rows'->0->>'words'), 'invalid|Link the issue, not a pull request.');
  perform pg_temp.w4t_check('W4T-ROAD', 'a card title with quotes, percent signs and markup comes back as plain data',
    (select r->>'title' from jsonb_array_elements(pg_temp.w4t_j(pg_temp.w4t_person('owner',
       $q$select public.ops_roadmap_links_preview('[{"card_id":"4e4a0000-0000-4000-d100-000000000001","issue":"#985001"}]'::jsonb)::text$q$))->'rows') r),
    'W4T "Quoted" 100% <b>card</b> %s');
  -- The card linked to #985002 is listed with a new issue, next to a ready one.
  v := pg_temp.w4t_person('owner', $q$select public.ops_roadmap_links_confirm('[
      {"card_id":"4e4a0000-0000-4000-d100-000000000002","issue":"#985003"},
      {"card_id":"4e4a0000-0000-4000-d100-000000000003","issue":"#985001"}]'::jsonb, 'w4t-road-keep-1')::text$q$);
  p := pg_temp.w4t_j(v);
  perform pg_temp.w4t_check('W4T-ROAD', 'the confirm links the ready card and skips the one already linked',
    concat_ws('/', p->>'linked', p->>'skipped', p->'results'->0->>'status'), '1/1/already_linked');
  perform pg_temp.w4t_check('W4T-ROAD', 'the card already linked keeps its link; the other is linked',
    (select string_agg(right(card_id::text, 1) || '=' || issue_number, ',' order by card_id) from public.ops_roadmap_links
      where card_id::text like '4e4a0000-0000-4000-d100-%'), '2=985002,3=985001');
  perform pg_temp.w4t_check('W4T-ROAD', 'the words of a quoted title in another card''s refusal stay inside the quotes',
    (select r->>'words' from jsonb_array_elements(pg_temp.w4t_j(pg_temp.w4t_person('owner',
       $q$select public.ops_roadmap_links_preview('[{"card_id":"4e4a0000-0000-4000-d100-000000000001","issue":"#985002"}]'::jsonb)::text$q$))->'rows') r),
    '#985002 is already linked to "W4T Linked Elsewhere".');
end;
$road$;

select count(*) as w4t_total, count(*) filter (where not ok) as w4t_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4t_failures
  from t3980w4t_results \gset
rollback;

select (:w4t_total < 35 or :w4t_failed > 0) as w4t_bad \gset
\if :w4t_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 TESTER FAILED:' :w4t_failed 'of' :w4t_total
  \echo :w4t_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 TESTER PASS:' :w4t_total 'checks, 0 failed'
