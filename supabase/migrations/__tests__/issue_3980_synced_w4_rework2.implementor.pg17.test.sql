-- Issue #3980 synced program, Wave 4 rework 2 -- the fixes for the Wave 4
-- rework retest, on the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   W4R2-PAGE   P2-A: "Show more" reads right after the last brand already
--               shown (keyset: created_at, id). When brands already shown
--               gain a host card between pages, no later brand is skipped
--               and none is shown twice; page.left counts what is left; the
--               keyset page is the owner's alone
--   W4R2-RULE   P2-B: the cron asks a person again on the very test the
--               preview and the confirm use (ops_brand_new_exact): an exact
--               host card added while the pick card was open, then the
--               person closed it (case F), is asked again by preview,
--               confirm and cron alike; decided, re-ask, agent-close and
--               near-only cases agree too
--   W4R2-BUSY   P2-C: a run never waits for a brand someone else holds (an
--               owner's confirm): it skips it as busy, writes no wait for
--               it, counts nothing for it and still settles the others; a
--               confirm that cannot get a brand says "busy, try again",
--               never "left for a person". Real second session (dblink)
--   W4R2-WORDS  P3-A: the confirm has words for a reopened card; P3-B: both
--               countries on record and digits not valid in one say so;
--               P3-C: a re-ask row in the preview says it asks again, why
--
-- Run from the repository root as supabase_admin. Everything is rolled back
-- (the second session only takes an advisory lock and rolls back).

\set ON_ERROR_STOP on
create extension if not exists dblink;
-- The second session signs in the way the lane's psql does (as 3040's suites do).
\getenv w4r2_pw PGPASSWORD
begin;
create temp table t3980w4r2_conn on commit drop as
select format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s', current_setting('port'), current_database(), current_user, :'w4r2_pw') as conn;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create temp table t3980w4r2_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w4r2_people (who, id, email) values
  ('owner', '3a9b0000-0000-4000-a000-000000000001', 'ed.w4r23980@test.local'),
  ('admin', '3a9b0000-0000-4000-a000-000000000002', 'di.w4r23980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w4r2_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w4r23980@test.local', 'owner', 'active', now()),
  ('di.w4r23980@test.local', 'admin', 'active', now());
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('3a9b0000-0000-4000-e000-000000000101', 'w4r2-lagos', 'W4R2 Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5),
  ('3a9b0000-0000-4000-e000-000000000102', 'w4r2-memphis', 'W4R2 Memphis', 'United States', 'US', 35.1, -90.0, 35.0, -90.1, 35.2, -89.9);
insert into public.ops_settings (key, value, updated_by) values ('brand_auto_since', to_jsonb(now() - interval '30 days'), 'w4r2')
  on conflict (key) do update set value = excluded.value;

create temp table t3980w4r2_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w4r2_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'anon' then
    select id, email into strict v_id, v_email from t3980w4r2_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
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

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.w4r2_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.w4r2_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.w4r2_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4r2_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 900), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

-- A case runs and is then undone; its checks are kept in a value and
-- recorded after the undo.
create function pg_temp.w4r2_rec(p_res jsonb, p_test text, p_label text, p_got text, p_want text) returns jsonb
language sql as $fn$
  select p_res || jsonb_build_array(jsonb_build_array(p_test, p_label, p_got, p_want))
$fn$;

create function pg_temp.w4r2_flush(p_res jsonb) returns void
language plpgsql as $fn$
declare x jsonb;
begin
  for x in select e from jsonb_array_elements(p_res) e loop
    perform pg_temp.w4r2_check(x->>0, x->>1, x->>2, x->>3);
  end loop;
end;
$fn$;

create function pg_temp.w4r2_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4r2_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 900), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w4r2_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 400));
end;
$fn$;

-- A host card, optionally with one contact point at a given time and region.
create function pg_temp.w4r2_host(p_id uuid, p_name text, p_stage text, p_kind text, p_value text, p_at timestamptz default now(), p_region uuid default null)
returns void language plpgsql as $fn$
begin
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by, region_id)
  values (p_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, 'w4r2', 'w4r2', p_region) on conflict (id) do nothing;
  if p_kind is not null then
    insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by, created_at)
    values (p_id, p_kind, p_value, public.crm_ident_key(p_kind, p_value), 'w4r2', p_at);
  end if;
end;
$fn$;

create function pg_temp.w4r2_brand(p_id uuid, p_name text, p_email text, p_phone text default null, p_cc text default null, p_at timestamptz default now() - interval '1 hour')
returns void language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, contact_email, contact_phone, country_code, created_at)
  values (p_id, gen_random_uuid(), p_name, 'w4r2-' || substr(md5(p_id::text), 1, 12), p_email, p_phone, p_cc, p_at);
  set local session_replication_role = origin;
end;
$fn$;

-- A person (or an agent, p_via) closes the brand's pick or reopen card.
create function pg_temp.w4r2_close(p_brand uuid, p_via text, p_at timestamptz, p_kind text default 'declined')
returns void language sql as $fn$
  update public.ops_work_cards set status = 'done', close_kind = p_kind, close_reason = 'Decided in the test.',
         closed_at = p_at, closed_by = case when p_via is null then 'ed.w4r23980@test.local' else 'system@usemingla.com' end, closed_via = p_via
   where auto_key in ('brand_pick:' || p_brand, 'brand_lost:' || p_brand) and status <> 'done';
$fn$;

-- What is true for a brand now: its host cards, and its pick/lost cards.
create function pg_temp.w4r2_state(p_brand uuid) returns text
language sql as $fn$
  select concat_ws(' ; ',
    'host=' || (select count(*) from public.crm_records h where h.brand_id = p_brand and h.pipeline = 'hosts' and h.deleted_at is null),
    'cards=' || coalesce((select string_agg(split_part(k.auto_key, ':', 1) || '/' || k.status || '/rev' || k.revision, ',' order by k.number)
                            from public.ops_work_cards k where k.auto_key in ('brand_pick:' || p_brand, 'brand_lost:' || p_brand)), 'none'))
$fn$;

-- The preview row for a brand, what the confirm did, and what the cron did,
-- each from the same starting point (the confirm and the cron are undone).
create function pg_temp.w4r2_compare(p_brand uuid, p_key text) returns jsonb
language plpgsql as $fn$
declare v_prev jsonb; v_row jsonb; v_conf jsonb; v_c text; v_k text; v_before text;
begin
  v_before := pg_temp.w4r2_state(p_brand);
  v_prev := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', 'select public.ops_brand_cards_preview_page(0, 100)::text'));
  select r into v_row from jsonb_array_elements(v_prev->'rows') r where (r->>'brand_id')::uuid = p_brand;
  begin
    v_conf := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', format('select public.ops_brand_cards_confirm(array[%L]::uuid[], %L)::text', p_brand, p_key)));
    v_c := pg_temp.w4r2_state(p_brand);
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  begin
    perform public.ops_brand_autolink();
    v_k := pg_temp.w4r2_state(p_brand);
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  return jsonb_build_object('before', v_before, 'action', v_row->>'action', 'reask', coalesce((v_row->>'reask')::boolean, false),
    'preview_words', v_row->>'words', 'confirm_status', v_conf->'results'->0->>'status', 'confirm_words', v_conf->'results'->0->>'words',
    'confirm_busy', v_conf->>'busy', 'after_confirm', v_c, 'after_cron', v_k);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- W4R2-PAGE: keyset paging while brands change between pages
-- ---------------------------------------------------------------------------
-- 120 brands with no host card, newer than anything else in the database;
-- two share one created_at (a tie the keyset must order by id).
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, contact_email, created_at)
select ('3a9b0000-0000-4000-b100-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2 Page Brand ' || lpad(g::text, 3, '0'),
       'w4r2-page-brand-' || g, 'page' || g || '@w4r23980.test',
       now() + interval '2 days' + (case when g = 61 then 60 else g end) * interval '1 second'
  from generate_series(1, 120) g;
set local session_replication_role = origin;

create temp table t3980w4r2_page (p2 jsonb, seen uuid[]) on commit drop;
do $page$
declare p1 jsonb; p2 jsonb; p3 jsonb; v_seen uuid[] := ARRAY[]::uuid[]; v_dup integer; v_missing text; v_left_truth integer; v_i integer;
begin
  p1 := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', 'select public.ops_brand_cards_preview()::text'));
  v_seen := v_seen || ARRAY(select (r->>'brand_id')::uuid from jsonb_array_elements(p1->'rows') r);
  perform pg_temp.w4r2_check('W4R2-PAGE', 'the first page is the 50 newest; page.next is the last of them (created_at, id)',
    concat_ws('|', jsonb_array_length(p1->'rows'), p1->'page'->>'more',
              (p1->'page'->'next'->>'id') = '3a9b0000-0000-4000-b100-000000000071',
              (p1->'page'->'next'->>'created_at')::timestamptz = (select created_at from public.brands where id = '3a9b0000-0000-4000-b100-000000000071')),
    '50|true|t|t');
  -- Meanwhile the cron (or another confirm) gives three brands already shown a host card.
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, brand_id)
  select gen_random_uuid(), 'hosts', 'W4R2 Linked Meanwhile ' || g, 'contacted', 'w4r2', 'w4r2', ('3a9b0000-0000-4000-b100-' || lpad(g::text, 12, '0'))::uuid
    from generate_series(118, 120) g;
  p2 := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', format('select public.ops_brand_cards_preview_page(%L::timestamptz, %L::uuid, 50)::text',
          p1->'page'->'next'->>'created_at', p1->'page'->'next'->>'id')));
  select count(*) into v_dup from jsonb_array_elements(p2->'rows') r where (r->>'brand_id')::uuid = any (v_seen);
  v_seen := v_seen || ARRAY(select (r->>'brand_id')::uuid from jsonb_array_elements(p2->'rows') r);
  perform pg_temp.w4r2_check('W4R2-PAGE', 'Show more after 3 shown brands gained a card: the next 50 start right after the last shown, none repeated',
    concat_ws('|', jsonb_array_length(p2->'rows'), v_dup,
              (select min(r->>'name') from jsonb_array_elements(p2->'rows') r), (select max(r->>'name') from jsonb_array_elements(p2->'rows') r)),
    '50|0|W4R2 Page Brand 021|W4R2 Page Brand 070');
  insert into t3980w4r2_page (p2, seen) values (p2, v_seen);
end;
$page$;

-- Two brands sign up meanwhile: newer than the first page, so the next
-- page does not show them (Preview again does); nothing is skipped.
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, created_at)
select ('3a9b0000-0000-4000-b101-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2 Page New ' || g, 'w4r2-page-new-' || g, now() + interval '3 days'
  from generate_series(1, 2) g;
set local session_replication_role = origin;

do $page2$
declare p2 jsonb; p3 jsonb; v_seen uuid[]; v_dup integer; v_missing text; v_left_truth integer; v_i integer;
begin
  select t.p2, t.seen into p2, v_seen from t3980w4r2_page t;
  select count(*) into v_left_truth from public.brands br
   where br.deleted_at is null and br.name like 'W4R2 Page Brand %'
     and not exists (select 1 from public.crm_records h where h.brand_id = br.id and h.pipeline = 'hosts' and h.deleted_at is null)
     and br.id <> all (v_seen);
  perform pg_temp.w4r2_check('W4R2-PAGE', 'page.left counts the brands without a card after the last shown',
    ((p2->'page'->>'left')::integer >= v_left_truth and (p2->'page'->>'more')::boolean)::text, 'true');
  -- Show more until nothing more comes (other brands in the database come
  -- after these, so this may take more than one page).
  p3 := p2; v_dup := 0;
  for v_i in 1..50 loop
    exit when not coalesce((p3->'page'->>'more')::boolean, false);
    p3 := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', format('select public.ops_brand_cards_preview_page(%L::timestamptz, %L::uuid, 100)::text',
            p3->'page'->'next'->>'created_at', p3->'page'->'next'->>'id')));
    v_dup := v_dup + (select count(*) from jsonb_array_elements(p3->'rows') r where (r->>'brand_id')::uuid = any (v_seen));
    v_seen := v_seen || ARRAY(select (r->>'brand_id')::uuid from jsonb_array_elements(p3->'rows') r);
  end loop;
  select coalesce(string_agg(br.name, ', ' order by br.name), 'none') into v_missing from public.brands br
   where br.deleted_at is null and br.name like 'W4R2 Page Brand %'
     and not exists (select 1 from public.crm_records h where h.brand_id = br.id and h.pipeline = 'hosts' and h.deleted_at is null)
     and br.id <> all (v_seen);
  perform pg_temp.w4r2_check('W4R2-PAGE', 'together the pages show every one of the 117 brands still without a card, none twice',
    concat_ws('|', v_missing, v_dup, (select count(distinct x) from unnest(v_seen) x where x::text like '3a9b0000-0000-4000-b100-%')),
    'none|0|120');
  perform pg_temp.w4r2_check('W4R2-PAGE', 'the last page says nothing more comes after it',
    concat_ws('|', (p3->'page'->>'more'), (p3->'page'->>'left')), 'false|0');
  -- The tie at one created_at sits on a page boundary in keyset order.
  perform pg_temp.w4r2_check('W4R2-PAGE', 'two brands with one created_at are both shown, ordered by id',
    (select count(*) from unnest(v_seen) x where x in ('3a9b0000-0000-4000-b100-000000000060', '3a9b0000-0000-4000-b100-000000000061'))::text, '2');
  -- After the last brand of the whole list: an empty page, nothing more.
  p3 := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', format('select public.ops_brand_cards_preview_page(%L::timestamptz, %L::uuid, 50)::text',
          '1900-01-01T00:00:00Z', '00000000-0000-4000-8000-000000000000')));
  perform pg_temp.w4r2_check('W4R2-PAGE', 'a page after the oldest brand is empty and has no next',
    concat_ws('|', jsonb_array_length(p3->'rows'), p3->'page'->>'more', coalesce(p3->'page'->>'next', 'none')), '0|false|none');
  -- Owner only, and a page needs the brand it reads after.
  perform pg_temp.w4r2_like('W4R2-PAGE', 'an admin cannot read a keyset page',
    pg_temp.w4r2_person('admin', format('select public.ops_brand_cards_preview_page(%L::timestamptz, %L::uuid, 50)::text', now(), gen_random_uuid())),
    'ERR:42501:forbidden: Only the owner adds host cards%');
  perform pg_temp.w4r2_like('W4R2-PAGE', 'a signed-out caller cannot run it',
    pg_temp.w4r2_as('anon', format('select public.ops_brand_cards_preview_page(%L::timestamptz, %L::uuid, 50)::text', now(), gen_random_uuid())),
    'ERR:42501:permission denied%');
  perform pg_temp.w4r2_like('W4R2-PAGE', 'a keyset page without the brand to read after is refused',
    pg_temp.w4r2_person('owner', 'select public.ops_brand_cards_preview_page(null::timestamptz, null::uuid, 50)::text'),
    'ERR:22023:invalid_page:%');
  perform pg_temp.w4r2_check('W4R2-PAGE', 'the keyset reader itself is service_role only',
    concat_ws('/', has_function_privilege('authenticated', 'public.ops_brand_cards_rows(timestamptz,uuid,integer)', 'EXECUTE'),
              has_function_privilege('authenticated', 'public.ops_brand_cards_page(integer,timestamptz,uuid,integer)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.ops_brand_cards_rows(timestamptz,uuid,integer)', 'EXECUTE')),
    'f/f/t');
end;
$page2$;

-- The page brands are out of the way of the cases below.
-- (replica: the test brands' made-up accounts are not re-checked on update)
set local session_replication_role = replica;
update public.brands set deleted_at = now() where name like 'W4R2 Page %';
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- W4R2-RULE: preview == confirm == cron, case by case (each rolled back)
-- ---------------------------------------------------------------------------
-- F. an exact card appeared while the pick card was open, before the person
-- decided; it is not on the card.
do $f$
declare r jsonb; res jsonb := '[]'::jsonb;
begin
  begin
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00f-000000000001', 'W4R2 F One', 'contacted', 'email', 'f@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00f-000000000002', 'W4R2 F Two', 'contacted', 'email', 'f@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b00f-000000000001', 'W4R2 F Brand', 'f@w4r23980.test');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'F setup: a card asks a person to pick',
      public.ops_brand_autolink_one('3a9b0000-0000-4000-b00f-000000000001')->>'status', 'pick');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00f-000000000003', 'W4R2 F Three', 'contacted', 'email', 'f@w4r23980.test', now() - interval '10 days');
    perform pg_temp.w4r2_close('3a9b0000-0000-4000-b00f-000000000001', null, now() - interval '5 days');
    r := pg_temp.w4r2_compare('3a9b0000-0000-4000-b00f-000000000001', 'w4r2-rule-f-0001');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'F: the preview asks again (pick, re-ask)', concat_ws('|', r->>'action', r->>'reask'), 'pick|true');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'F: the confirm opens the person''s card again', r->>'after_confirm', 'host=0 ; cards=brand_pick/todo/rev2');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'F: the cron does exactly what the confirm does (the card opens again)', r->>'after_cron', r->>'after_confirm');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'F: cron and preview ask the one shared test, ops_brand_new_exact',
      (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ~ 'ops_brand_new_exact\(' and p.proname in ('ops_brand_autolink', 'ops_brand_match')),
      'ops_brand_autolink,ops_brand_match');
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  perform pg_temp.w4r2_flush(res);
end;
$f$;

-- A. decided 20 days ago, nothing new: all three leave it as it is.
do $a$
declare r jsonb; res jsonb := '[]'::jsonb;
begin
  begin
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00a-000000000001', 'W4R2 A One', 'contacted', 'email', 'a@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00a-000000000002', 'W4R2 A Two', 'contacted', 'email', 'a@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b00a-000000000001', 'W4R2 A Brand', 'a@w4r23980.test');
    perform public.ops_brand_autolink_one('3a9b0000-0000-4000-b00a-000000000001');
    perform pg_temp.w4r2_close('3a9b0000-0000-4000-b00a-000000000001', null, now() - interval '20 days');
    r := pg_temp.w4r2_compare('3a9b0000-0000-4000-b00a-000000000001', 'w4r2-rule-a-0001');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'A decided: preview decided, confirm decided, nothing opens in either, nor in the cron',
      concat_ws('|', r->>'action', r->>'confirm_status', r->>'after_confirm', r->>'after_cron'),
      'decided|decided|host=0 ; cards=brand_pick/done/rev1|host=0 ; cards=brand_pick/done/rev1');
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  perform pg_temp.w4r2_flush(res);
end;
$a$;

-- C. a new exact card after the decision: all three ask again (and the
-- words: P3-A confirm, P3-C preview).
do $c$
declare r jsonb; res jsonb := '[]'::jsonb;
begin
  begin
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00c-000000000001', 'W4R2 C One', 'contacted', 'email', 'c@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00c-000000000002', 'W4R2 C Two', 'contacted', 'email', 'c@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b00c-000000000001', 'W4R2 C Brand', 'c@w4r23980.test');
    perform public.ops_brand_autolink_one('3a9b0000-0000-4000-b00c-000000000001');
    perform pg_temp.w4r2_close('3a9b0000-0000-4000-b00c-000000000001', null, now() - interval '20 days');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00c-000000000003', 'W4R2 C Three', 'contacted', 'email', 'c@w4r23980.test');
    r := pg_temp.w4r2_compare('3a9b0000-0000-4000-b00c-000000000001', 'w4r2-rule-c-0001');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'C re-ask: confirm and cron both open the card again',
      concat_ws('|', r->>'action', r->>'reask', r->>'after_confirm', r->>'after_cron'),
      'pick|true|host=0 ; cards=brand_pick/todo/rev2|host=0 ; cards=brand_pick/todo/rev2');
    res := pg_temp.w4r2_rec(res, 'W4R2-WORDS', 'P3-C: the re-ask row in the preview says it asks again, and why',
      r->>'preview_words',
      'Asks again: a person decided before, and since then W4R2 C Three matches exactly (not on that card). The card for a person opens again.');
    res := pg_temp.w4r2_rec(res, 'W4R2-WORDS', 'P3-A: the confirm says the card asks a person again because of a new exact match',
      concat_ws('|', r->>'confirm_status', r->>'confirm_words'),
      'pick|A card asks a person again: a host card now matches exactly that was not on the card they closed.');
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  perform pg_temp.w4r2_flush(res);
end;
$c$;

-- D. an agent closed the pick card: all three ask again on that card.
do $d$
declare r jsonb; res jsonb := '[]'::jsonb;
begin
  begin
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00d-000000000001', 'W4R2 D One', 'contacted', 'email', 'd@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00d-000000000002', 'W4R2 D Two', 'contacted', 'email', 'd@w4r23980.test', now() - interval '30 days');
    perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b00d-000000000001', 'W4R2 D Brand', 'd@w4r23980.test');
    perform public.ops_brand_autolink_one('3a9b0000-0000-4000-b00d-000000000001');
    perform pg_temp.w4r2_close('3a9b0000-0000-4000-b00d-000000000001', 'claude', now() - interval '20 days');
    r := pg_temp.w4r2_compare('3a9b0000-0000-4000-b00d-000000000001', 'w4r2-rule-d-0001');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'D agent close: confirm and cron both open the card again',
      concat_ws('|', r->>'action', r->>'after_confirm', r->>'after_cron'),
      'pick|host=0 ; cards=brand_pick/todo/rev2|host=0 ; cards=brand_pick/todo/rev2');
    res := pg_temp.w4r2_rec(res, 'W4R2-WORDS', 'P3-A: the confirm says the card asks a person again because an agent closed it',
      r->>'confirm_words', 'A card asks a person again: an agent closed it, and only a person decides which host card a brand belongs to.');
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  perform pg_temp.w4r2_flush(res);
end;
$d$;

-- H. decided, then only a near phone appears: all three leave it.
do $h$
declare r jsonb; res jsonb := '[]'::jsonb;
begin
  begin
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00e-000000000001', 'W4R2 H One', 'contacted', 'phone', '+2348012345678', now() - interval '30 days');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00e-000000000002', 'W4R2 H Two', 'contacted', 'phone', '+2348012345678', now() - interval '30 days');
    perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b00e-000000000001', 'W4R2 H Brand', null, '+2348012345678', 'NG');
    perform public.ops_brand_autolink_one('3a9b0000-0000-4000-b00e-000000000001');
    perform pg_temp.w4r2_close('3a9b0000-0000-4000-b00e-000000000001', null, now() - interval '20 days');
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c00e-000000000003', 'W4R2 H Near', 'contacted', 'phone', '+447712345678');
    r := pg_temp.w4r2_compare('3a9b0000-0000-4000-b00e-000000000001', 'w4r2-rule-h-0001');
    res := pg_temp.w4r2_rec(res, 'W4R2-RULE', 'H near only after the decision: all three leave it as it is',
      concat_ws('|', r->>'action', r->>'confirm_status', r->>'after_confirm', r->>'after_cron'),
      'decided|decided|host=0 ; cards=brand_pick/done/rev1|host=0 ; cards=brand_pick/done/rev1');
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  perform pg_temp.w4r2_flush(res);
end;
$h$;

-- ---------------------------------------------------------------------------
-- W4R2-WORDS P3-B: both countries on record, digits not valid in one
-- ---------------------------------------------------------------------------
do $words$
declare m jsonb; res jsonb := '[]'::jsonb;
begin
  begin
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c0b0-000000000001', 'W4R2 Memphis Card With A Lagos Number', 'contacted', 'phone', '0901 555 0123',
                              now(), '3a9b0000-0000-4000-e000-000000000102');
    perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b0b0-000000000001', 'W4R2 Lagos Brand Same Digits', null, '0901 555 0123', 'NG');
    m := public.ops_brand_match('3a9b0000-0000-4000-b0b0-000000000001');
    res := pg_temp.w4r2_rec(res, 'W4R2-WORDS', 'P3-B: a Memphis card and a Lagos brand with 0901 555 0123 say the digits are not a US number, never "no country is on record"',
      concat_ws('|', m->>'status', m->>'near_words'), 'pick|the same digits, but they do not read as a phone number in United States');
    -- A card with no region keeps the old words: there no country is on record.
    perform pg_temp.w4r2_host('3a9b0000-0000-4000-c0b0-000000000002', 'W4R2 No Region Same Digits', 'contacted', 'phone', '0802 555 0199');
    perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b0b0-000000000002', 'W4R2 Lagos Brand No Region', null, '0802 555 0199', 'NG');
    res := pg_temp.w4r2_rec(res, 'W4R2-WORDS', 'P3-B: with no country on record for the card the words still say so',
      public.ops_brand_match('3a9b0000-0000-4000-b0b0-000000000002')->>'near_words',
      'the same phone number written without a country code, and no country is on record to tell whose number it is');
    raise exception 'w4r2_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2_undo' then raise; end if;
  end;
  perform pg_temp.w4r2_flush(res);
end;
$words$;

-- ---------------------------------------------------------------------------
-- W4R2-BUSY: a second session holds a brand (as an owner's confirm does)
-- ---------------------------------------------------------------------------
do $busy$
declare
  v_conn text := (select conn from t3980w4r2_conn);
  v jsonb; p jsonb; v_t0 timestamptz; v_ms numeric;
begin
  perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b0c0-000000000001', 'W4R2 Busy Brand', 'busy@w4r23980.test', null, null, now() - interval '3 hours');
  perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b0c0-000000000002', 'W4R2 Free Brand', 'free@w4r23980.test', null, null, now() - interval '2 hours');
  perform pg_temp.w4r2_brand('3a9b0000-0000-4000-b0c0-000000000003', 'W4R2 Busy Confirm Brand', 'busyc@w4r23980.test', null, null, now() - interval '1 hour');
  -- Only these brands are new for the cron in this test.
  set local session_replication_role = replica;
  update public.brands set deleted_at = now()
   where id::text not like '3a9b0000-0000-4000-b0c0-%' and deleted_at is null and created_at >= now() - interval '30 days'
     and not exists (select 1 from public.crm_records h where h.brand_id = brands.id and h.pipeline = 'hosts' and h.deleted_at is null);
  set local session_replication_role = origin;
  perform dblink_connect('w4r2_other', v_conn);
  perform dblink_exec('w4r2_other', 'BEGIN');
  perform x from dblink('w4r2_other', format('SELECT pg_advisory_xact_lock(hashtextextended(%L, 0))::text', 'ops_brand_autolink:3a9b0000-0000-4000-b0c0-000000000001')) as t(x text);
  perform x from dblink('w4r2_other', format('SELECT pg_advisory_xact_lock(hashtextextended(%L, 0))::text', 'ops_brand_autolink:3a9b0000-0000-4000-b0c0-000000000003')) as t(x text);

  -- The run: it must not wait (lock_timeout would end a wait after 3 s).
  perform set_config('lock_timeout', '3s', true);
  v_t0 := clock_timestamp();
  v := public.ops_brand_autolink();
  v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
  perform pg_temp.w4r2_check('W4R2-BUSY', 'the run does not wait for the held brand (well under the 3 s lock timeout)',
    (v_ms < 1500)::text, 'true');
  perform pg_temp.w4r2_check('W4R2-BUSY', 'it counts the two held brands as busy and settles the free one',
    concat_ws('|', v->>'busy', v->>'created', v->>'pick', v->>'linked'), '2|1|0|0');
  perform pg_temp.w4r2_check('W4R2-BUSY', 'a busy brand gets no wait, no card and no stop: the next run simply tries it',
    concat_ws('|', (select count(*) from public.ops_brand_autolink_waits where brand_id::text like '3a9b0000-0000-4000-b0c0-%'),
              pg_temp.w4r2_state('3a9b0000-0000-4000-b0c0-000000000001'), pg_temp.w4r2_state('3a9b0000-0000-4000-b0c0-000000000002')),
    '0|host=0 ; cards=none|host=1 ; cards=none');

  -- A confirm that cannot get its brand in time says busy, not "left for a person".
  perform set_config('lock_timeout', '300ms', true);
  p := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', $q$select public.ops_brand_cards_confirm(array['3a9b0000-0000-4000-b0c0-000000000003']::uuid[], 'w4r2-busy-confirm-1')::text$q$));
  perform set_config('lock_timeout', '0', true);
  perform pg_temp.w4r2_check('W4R2-BUSY', 'the confirm reports the held brand as busy, try again, and counts it apart',
    concat_ws('|', p->>'busy', p->>'skipped', p->>'created', p->'results'->0->>'status', p->'results'->0->>'words'),
    '1|0|0|busy|Busy: Mingla was working on this brand at the same moment. Nothing changed; try again.');

  perform dblink_exec('w4r2_other', 'ROLLBACK');
  perform dblink_disconnect('w4r2_other');
  -- Released: the next run settles it.
  v := public.ops_brand_autolink();
  perform pg_temp.w4r2_check('W4R2-BUSY', 'once the other session lets go, the next run settles the brand it skipped',
    concat_ws('|', v->>'busy', pg_temp.w4r2_state('3a9b0000-0000-4000-b0c0-000000000001')), '0|host=1 ; cards=none');
exception when others then
  begin perform dblink_disconnect('w4r2_other'); exception when others then null; end;
  raise;
end;
$busy$;

-- The confirm's "unchanged" count: an already-carded brand is not for a person.
do $unchanged$
declare p jsonb;
begin
  p := pg_temp.w4r2_j(pg_temp.w4r2_person('owner', $q$select public.ops_brand_cards_confirm(array['3a9b0000-0000-4000-b0c0-000000000002']::uuid[], 'w4r2-unchanged-1')::text$q$));
  perform pg_temp.w4r2_check('W4R2-BUSY', 'a brand that already has a host card is counted as unchanged (still within skipped)',
    concat_ws('|', p->>'skipped', p->>'unchanged', p->>'busy', p->'results'->0->>'status'), '1|1|0|has_card');
end;
$unchanged$;

select count(*) as w4r2_total, count(*) filter (where not ok) as w4r2_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4r2_failures
  from t3980w4r2_results \gset
rollback;

select (:w4r2_total < 30 or :w4r2_failed > 0) as w4r2_bad \gset
\if :w4r2_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 REWORK 2 FAILED:' :w4r2_failed 'of' :w4r2_total
  \echo :w4r2_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 REWORK 2 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 REWORK 2 PASS:' :w4r2_total 'checks, 0 failed'
