-- Issue #3980 synced program, Wave 4 rework 2 -- tester adversarial suite
-- (retest 2), on the fully replayed PG17 schema. A different angle from the
-- implementor's suite:
--
--   W4R2T-PAGE   keyset paging under attack: 75 brands share ONE created_at
--                (with microseconds) across several page boundaries; between
--                every page the brand the cursor points at gains a host card,
--                four other shown brands gain one, and new brands arrive
--                (newest, the cursor's own created_at with a bigger and with
--                a smaller id, oldest). No brand is returned twice, every
--                brand still without a card is shown, page.left is exact on
--                every page, and the cursor is passed back as the text the
--                page returned (as Admin does)
--   W4R2T-LOOK   when the cron looks at a decided brand: once after the
--                person's close, not again with nothing new (23 h), again
--                after a day, on a contact point added to a host card (even
--                a handle on another platform), on a card edit and on a brand
--                edit; never while it backs off; and a change that adds no
--                contact point (a host link removed from the decided card)
--                is caught by the daily look, so the cron agrees with the
--                preview within a day
--   W4R2T-BUDGET at most 25 brands a run, brands nobody decided about first,
--                decided brands looked at in the next run (none starves)
--   W4R2T-BUSY   a run skips only the held brand and settles the rest; the
--                busy brand gets no wait and is settled by the next run
--   W4R2T-WORDS  the confirm's words for an agent-closed Lost card asked
--                again; digits not valid in the brand's country say so; a
--                re-ask row is selectable (not "decided"); a decided brand is
--                "unchanged" in the confirm's counts
--
-- Run from the repository root as supabase_admin. Everything is rolled back
-- (the second session only takes an advisory lock and rolls back).

\set ON_ERROR_STOP on
create extension if not exists dblink;
\getenv w4r2t_pw PGPASSWORD
begin;
create temp table t3980w4r2t_conn on commit drop as
select format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s', current_setting('port'), current_database(), current_user, :'w4r2t_pw') as conn;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

insert into auth.users (id, email, email_confirmed_at) values
  ('4e9a0000-0000-4000-a000-000000000001', 'oz.w4r2t3980@test.local', now());
insert into public.admin_users (email, role, status, accepted_at) values ('oz.w4r2t3980@test.local', 'owner', 'active', now());
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('4e9a0000-0000-4000-e000-000000000101', 'w4r2t-lagos', 'W4R2T Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5),
  ('4e9a0000-0000-4000-e000-000000000102', 'w4r2t-memphis', 'W4R2T Memphis', 'United States', 'US', 35.1, -90.0, 35.0, -90.1, 35.2, -89.9);
insert into public.ops_settings (key, value, updated_by) values ('brand_auto_since', to_jsonb(now() - interval '30 days'), 'w4r2t')
  on conflict (key) do update set value = excluded.value;

-- Only this suite's brands are new for the cron.
set local session_replication_role = replica;
update public.brands set deleted_at = now() where deleted_at is null;
set local session_replication_role = origin;

create temp table t3980w4r2t_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w4r2t_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4r2t_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 900), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w4r2t_rec(p_res jsonb, p_test text, p_label text, p_got text, p_want text) returns jsonb
language sql as $fn$
  select coalesce(p_res, '[]'::jsonb) || jsonb_build_array(jsonb_build_array(p_test, p_label, p_got, p_want))
$fn$;

create function pg_temp.w4r2t_flush(p_res jsonb) returns void
language plpgsql as $fn$
declare x jsonb;
begin
  for x in select e from jsonb_array_elements(coalesce(p_res, '[]'::jsonb)) e loop
    perform pg_temp.w4r2t_check(x->>0, x->>1, x->>2, x->>3);
  end loop;
end;
$fn$;

-- The owner, signed in as a person.
create function pg_temp.w4r2t_own(p_sql text) returns jsonb
language plpgsql as $fn$
declare v text;
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '4e9a0000-0000-4000-a000-000000000001', true);
  perform set_config('request.jwt.claim.email', 'oz.w4r2t3980@test.local', true);
  perform set_config('request.jwt.claims', '{"sub":"4e9a0000-0000-4000-a000-000000000001","email":"oz.w4r2t3980@test.local","role":"authenticated"}', true);
  perform set_config('request.jwt.claim.role', '', true);
  execute p_sql into v;
  reset role;
  return v::jsonb;
exception when others then
  reset role;
  return jsonb_build_object('err', sqlstate || ':' || sqlerrm);
end;
$fn$;

create function pg_temp.w4r2t_host(p_id uuid, p_name text, p_kind text, p_value text, p_at timestamptz default now() - interval '40 days',
                                   p_region uuid default null, p_stage text default 'contacted', p_platform text default null)
returns void language plpgsql as $fn$
begin
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by, region_id, created_at, updated_at)
  values (p_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, 'w4r2t', 'w4r2t', p_region, p_at, p_at)
  on conflict (id) do nothing;
  if p_kind is not null then
    insert into public.crm_record_identifiers (record_id, kind, value, value_key, platform, created_by, created_at)
    values (p_id, p_kind, p_value, public.crm_ident_key(p_kind, p_value), p_platform, 'w4r2t', p_at);
  end if;
end;
$fn$;

create function pg_temp.w4r2t_brand(p_id uuid, p_name text, p_email text, p_phone text default null, p_cc text default null,
                                    p_at timestamptz default now() - interval '1 hour', p_social jsonb default null)
returns void language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, contact_email, contact_phone, country_code, created_at, updated_at, social_links)
  values (p_id, gen_random_uuid(), p_name, 'w4r2t-' || substr(md5(p_id::text), 1, 12), p_email, p_phone, p_cc, p_at, p_at, coalesce(p_social, '{}'::jsonb));
  set local session_replication_role = origin;
end;
$fn$;

create function pg_temp.w4r2t_brand_touch(p_id uuid, p_at timestamptz) returns void
language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  update public.brands set updated_at = p_at where id = p_id;
  set local session_replication_role = origin;
end;
$fn$;

create function pg_temp.w4r2t_close(p_brand uuid, p_via text, p_at timestamptz) returns void
language sql as $fn$
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Decided in the test.',
         closed_at = p_at, closed_by = case when p_via is null then 'oz.w4r2t3980@test.local' else 'system@usemingla.com' end, closed_via = p_via
   where auto_key in ('brand_pick:' || p_brand, 'brand_lost:' || p_brand) and status <> 'done';
$fn$;

create function pg_temp.w4r2t_state(p_brand uuid) returns text
language sql as $fn$
  select concat_ws(' ; ',
    'host=' || (select count(*) from public.crm_records h where h.brand_id = p_brand and h.pipeline = 'hosts' and h.deleted_at is null),
    'cards=' || coalesce((select string_agg(split_part(k.auto_key, ':', 1) || '/' || k.status, ',' order by k.number)
                            from public.ops_work_cards k where k.auto_key in ('brand_pick:' || p_brand, 'brand_lost:' || p_brand)), 'none'))
$fn$;

-- Did the run that just happened look at this decided brand? A look keeps
-- its time (now()) on the brand's wait row.
create function pg_temp.w4r2t_looked(p uuid) returns text
language sql as $fn$
  select coalesce((select case when t.updated_at = now() then 'looked' else 'not looked' end || '/' || t.last_status
                     from public.ops_brand_autolink_waits t where t.brand_id = p), 'no row')
$fn$;

create function pg_temp.w4r2t_look_ago(p uuid, p_ago interval) returns void
language sql as $fn$
  update public.ops_brand_autolink_waits set updated_at = now() - p_ago where brand_id = p
$fn$;

-- ---------------------------------------------------------------------------
-- W4R2T-PAGE
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
-- 75 brands with one created_at (microseconds), ids in a scrambled order.
insert into public.brands (id, account_id, name, slug, created_at)
select ('4e9a0000-0000-4000-b000-' || lpad(((g * 7919) % 1000)::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2T Tie ' || lpad(g::text, 3, '0'),
       'w4r2t-tie-' || g, timestamptz '2026-10-19 10:00:00.123457+00'
  from generate_series(1, 75) g;
-- 40 older brands, one microsecond apart.
insert into public.brands (id, account_id, name, slug, created_at)
select ('4e9a0000-0000-4000-b001-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2T Old ' || lpad(g::text, 3, '0'),
       'w4r2t-old-' || g, timestamptz '2026-10-19 10:00:00.123457+00' - g * interval '1 microsecond'
  from generate_series(1, 40) g;
set local session_replication_role = origin;

create temp table t3980w4r2t_seen (id uuid, page integer) on commit drop;
create temp table t3980w4r2t_start on commit drop as
select id from public.brands where id::text like '4e9a0000-0000-4000-b00%' and deleted_at is null;

do $page$
declare p jsonb; n integer := 1; c jsonb; v_truth integer; v_bad_left integer := 0; v_err text;
begin
  p := pg_temp.w4r2t_own('select public.ops_brand_cards_preview_page(0, 50)::text');
  insert into t3980w4r2t_seen select (r->>'brand_id')::uuid, 1 from jsonb_array_elements(p->'rows') r;
  perform pg_temp.w4r2t_check('W4R2T-PAGE', 'the first page is 50 of the tie, and its next is the last of them as text with microseconds',
    concat_ws('|', jsonb_array_length(p->'rows'), p->'page'->>'more', p->'page'->'next'->>'created_at'),
    '50|true|2026-10-19T10:00:00.123457+00:00');
  loop
    exit when not coalesce((p->'page'->>'more')::boolean, false) or n > 20;
    n := n + 1;
    c := p->'page'->'next';
    -- Between pages: the cursor's own brand gains a host card, and four more shown brands.
    insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, brand_id)
    values (gen_random_uuid(), 'hosts', 'W4R2T Cursor Card ' || n, 'contacted', 'w4r2t', 'w4r2t', (c->>'id')::uuid);
    insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, brand_id)
    select gen_random_uuid(), 'hosts', 'W4R2T Shown Card ' || s.id, 'contacted', 'w4r2t', 'w4r2t', s.id
      from (select distinct id from t3980w4r2t_seen) s
     where not exists (select 1 from public.crm_records h where h.brand_id = s.id) order by s.id limit 4;
    -- New brands arrive: the newest, two at the cursor's created_at (bigger and smaller id), and the oldest.
    set local session_replication_role = replica;
    insert into public.brands (id, account_id, name, slug, created_at) values
      (('4e9a0000-0000-4000-b002-' || lpad((n * 10 + 1)::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2T New Newest ' || n, 'w4r2t-nn-' || n, now()),
      (('4e9a0000-0000-4000-bfff-' || lpad((n * 10 + 2)::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2T New Tie Bigger ' || n, 'w4r2t-ntb-' || n, (c->>'created_at')::timestamptz),
      (('4e9a0000-0000-4000-a000-' || lpad((n * 10 + 3)::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2T New Tie Smaller ' || n, 'w4r2t-nts-' || n, (c->>'created_at')::timestamptz),
      (('4e9a0000-0000-4000-b003-' || lpad((n * 10 + 4)::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R2T New Oldest ' || n, 'w4r2t-no-' || n, timestamptz '2026-10-01');
    set local session_replication_role = origin;
    -- The cursor goes back exactly as the text the page gave (Admin passes the string).
    p := pg_temp.w4r2t_own(format('select public.ops_brand_cards_preview_page(%L::timestamptz, %L::uuid, 30)::text', c->>'created_at', c->>'id'));
    v_err := coalesce(v_err, p->>'err');
    exit when p ? 'err';
    select count(*) into v_truth from public.brands br
     where br.deleted_at is null
       and not exists (select 1 from public.crm_records h where h.brand_id = br.id and h.pipeline = 'hosts' and h.deleted_at is null)
       and (br.created_at < (p->'page'->'next'->>'created_at')::timestamptz
            or (br.created_at = (p->'page'->'next'->>'created_at')::timestamptz and br.id > (p->'page'->'next'->>'id')::uuid));
    if p->'page'->'next' is not null and (p->'page'->>'left')::integer <> v_truth then v_bad_left := v_bad_left + 1; end if;
    insert into t3980w4r2t_seen select (r->>'brand_id')::uuid, n from jsonb_array_elements(p->'rows') r;
  end loop;
  perform pg_temp.w4r2t_check('W4R2T-PAGE', 'every Show more answered (no error) and the walk ended with nothing more and nothing left',
    concat_ws('|', coalesce(v_err, 'ok'), p->'page'->>'more', p->'page'->>'left', (n between 3 and 20)::text), 'ok|false|0|true');
  perform pg_temp.w4r2t_check('W4R2T-PAGE', 'page.left equals the brands without a card after the page''s last brand, on every page',
    v_bad_left::text, '0');
end;
$page$;

select pg_temp.w4r2t_check('W4R2T-PAGE', 'no brand is returned on two pages (before Admin drops repeats)',
  (select count(*) from (select id from t3980w4r2t_seen group by id having count(*) > 1) d)::text, '0');
select pg_temp.w4r2t_check('W4R2T-PAGE', 'every brand that started without a card and still has none was shown (cursor gaining a card skips nothing)',
  (select coalesce(string_agg(b.name, ', ' order by b.name), 'none') from t3980w4r2t_start s join public.brands b on b.id = s.id
    where s.id not in (select id from t3980w4r2t_seen)
      and not exists (select 1 from public.crm_records h where h.brand_id = s.id and h.pipeline = 'hosts' and h.deleted_at is null)),
  'none');
select pg_temp.w4r2t_check('W4R2T-PAGE', 'all 115 starting brands were shown once, the 75-way tie across page boundaries included',
  (select count(distinct s.id) from t3980w4r2t_seen s join t3980w4r2t_start t on t.id = s.id)::text, '115');
select pg_temp.w4r2t_check('W4R2T-PAGE', 'a new brand behind the cursor (same created_at, bigger id; or older) is shown once; one before it waits for Preview',
  (select concat_ws('|',
     (select count(*) from public.brands b where b.name like 'W4R2T New Tie Bigger %' and b.id not in (select id from t3980w4r2t_seen)
        and not exists (select 1 from public.crm_records h where h.brand_id = b.id)),
     (select count(*) from public.brands b where b.name like 'W4R2T New Oldest %' and b.id not in (select id from t3980w4r2t_seen)),
     (select count(*) from t3980w4r2t_seen s join public.brands b on b.id = s.id where b.name like 'W4R2T New Newest %' or b.name like 'W4R2T New Tie Smaller %'))),
  '0|0|0');

-- The page brands are out of the way of the cases below.
set local session_replication_role = replica;
update public.brands set deleted_at = now() where id::text like '4e9a0000-0000-4000-%' and deleted_at is null;
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- W4R2T-LOOK: when the cron looks at a decided brand
-- ---------------------------------------------------------------------------
do $look$
declare res jsonb := '[]'::jsonb; v jsonb; v_prev jsonb;
begin
  begin
    -- Brand D: its email on two host cards (a person picks); every card and
    -- contact point 40 days old; the person closed the card 5 days ago.
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c100-000000000001', 'W4R2T Look One', 'email', 'look@w4r2t3980.test');
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c100-000000000002', 'W4R2T Look Two', 'email', 'look@w4r2t3980.test');
    perform pg_temp.w4r2t_brand('4e9a0000-0000-4000-b100-000000000001', 'W4R2T Look Brand', 'look@w4r2t3980.test', null, null,
                                now() - interval '20 days', '{"instagram":"lookbrand3980"}');
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'setup: a card asks a person to pick',
      public.ops_brand_autolink_one('4e9a0000-0000-4000-b100-000000000001')->>'status', 'pick');
    perform pg_temp.w4r2t_close('4e9a0000-0000-4000-b100-000000000001', null, now() - interval '5 days');
    perform pg_temp.w4r2t_brand_touch('4e9a0000-0000-4000-b100-000000000001', now() - interval '20 days');

    v := public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'the first run after the person''s close looks once, and leaves it decided (no wait, no card)',
      concat_ws('|', pg_temp.w4r2t_looked('4e9a0000-0000-4000-b100-000000000001'),
                (select next_at <= now() from public.ops_brand_autolink_waits where brand_id = '4e9a0000-0000-4000-b100-000000000001'),
                pg_temp.w4r2t_state('4e9a0000-0000-4000-b100-000000000001'), v->>'pick'),
      'looked/decided|t|host=0 ; cards=brand_pick/done|0');

    perform pg_temp.w4r2t_look_ago('4e9a0000-0000-4000-b100-000000000001', '23 hours');
    perform public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', '23 hours after that look, with nothing new, the run does not look',
      pg_temp.w4r2t_looked('4e9a0000-0000-4000-b100-000000000001'), 'not looked/decided');

    perform pg_temp.w4r2t_look_ago('4e9a0000-0000-4000-b100-000000000001', '25 hours');
    perform public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'a day after the last look the run looks again (the daily look)',
      pg_temp.w4r2t_looked('4e9a0000-0000-4000-b100-000000000001'), 'looked/decided');

    perform pg_temp.w4r2t_look_ago('4e9a0000-0000-4000-b100-000000000001', '1 hour');
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c100-000000000003', 'W4R2T Look Tiktok', 'handle', 'lookbrand3980', now() - interval '10 minutes',
                               null, 'contacted', 'tiktok');
    perform public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'a host card gained the brand''s handle (on another platform) since the look: looked, and still decided',
      concat_ws('|', pg_temp.w4r2t_looked('4e9a0000-0000-4000-b100-000000000001'), pg_temp.w4r2t_state('4e9a0000-0000-4000-b100-000000000001')),
      'looked/decided|host=0 ; cards=brand_pick/done');
    update public.crm_record_identifiers set created_at = now() - interval '40 days' where record_id = '4e9a0000-0000-4000-c100-000000000003';

    perform pg_temp.w4r2t_look_ago('4e9a0000-0000-4000-b100-000000000001', '1 hour');
    update public.crm_records set updated_at = now() - interval '5 minutes' where id = '4e9a0000-0000-4000-c100-000000000002';
    perform public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'a matching host card edited since the look: looked',
      pg_temp.w4r2t_looked('4e9a0000-0000-4000-b100-000000000001'), 'looked/decided');
    update public.crm_records set updated_at = now() - interval '40 days' where id::text like '4e9a0000-0000-4000-c100-%';

    perform pg_temp.w4r2t_look_ago('4e9a0000-0000-4000-b100-000000000001', '1 hour');
    perform pg_temp.w4r2t_brand_touch('4e9a0000-0000-4000-b100-000000000001', now() - interval '5 minutes');
    perform public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'the brand edited since the look: looked',
      pg_temp.w4r2t_looked('4e9a0000-0000-4000-b100-000000000001'), 'looked/decided');
    perform pg_temp.w4r2t_brand_touch('4e9a0000-0000-4000-b100-000000000001', now() - interval '20 days');

    -- Backing off: a brand whose next try is later is never looked at, due or not.
    update public.ops_brand_autolink_waits set updated_at = now() - interval '2 days', next_at = now() + interval '1 hour', last_status = 'stopped'
     where brand_id = '4e9a0000-0000-4000-b100-000000000001';
    perform public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'a brand backing off is not looked at before its next try',
      pg_temp.w4r2t_looked('4e9a0000-0000-4000-b100-000000000001'), 'not looked/stopped');
    update public.ops_brand_autolink_waits set updated_at = now() - interval '1 hour', next_at = now(), last_status = 'decided'
     where brand_id = '4e9a0000-0000-4000-b100-000000000001';

    -- A change that adds no contact point: a host link removed from the
    -- decided card. The preview asks again at once; the cron agrees within a day.
    delete from public.ops_work_links
     where card_id = (select id from public.ops_work_cards where auto_key = 'brand_pick:4e9a0000-0000-4000-b100-000000000001')
       and kind = 'host' and target_id = '4e9a0000-0000-4000-c100-000000000002';
    v_prev := pg_temp.w4r2t_own('select public.ops_brand_cards_preview_page(0, 100)::text');
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'a link removed from the decided card: the preview asks again at once',
      (select concat_ws('|', r->>'action', r->>'reask') from jsonb_array_elements(v_prev->'rows') r where r->>'brand_id' = '4e9a0000-0000-4000-b100-000000000001'),
      'pick|true');
    perform pg_temp.w4r2t_look_ago('4e9a0000-0000-4000-b100-000000000001', '25 hours');
    v := public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-LOOK', 'and the cron asks again by the daily look at the latest (the card opens again)',
      concat_ws('|', v->>'pick', pg_temp.w4r2t_state('4e9a0000-0000-4000-b100-000000000001')), '1|host=0 ; cards=brand_pick/todo');
    raise exception 'w4r2t_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2t_undo' then raise; end if;
  end;
  perform pg_temp.w4r2t_flush(res);
end;
$look$;

-- ---------------------------------------------------------------------------
-- W4R2T-BUDGET: 25 a run, nobody-decided brands first, nobody starves
-- ---------------------------------------------------------------------------
do $budget$
declare res jsonb := '[]'::jsonb; v1 jsonb; v2 jsonb; v3 jsonb; g integer;
begin
  begin
    -- five decided brands, closed a day ago (each looked at after its close)
    for g in 1..5 loop
      perform pg_temp.w4r2t_host(('4e9a0000-0000-4000-c200-' || lpad((2 * g)::text, 12, '0'))::uuid, 'W4R2T Budget Card A' || g, 'email', 'budget' || g || '@w4r2t3980.test');
      perform pg_temp.w4r2t_host(('4e9a0000-0000-4000-c200-' || lpad((2 * g + 1)::text, 12, '0'))::uuid, 'W4R2T Budget Card B' || g, 'email', 'budget' || g || '@w4r2t3980.test');
      perform pg_temp.w4r2t_brand(('4e9a0000-0000-4000-b200-' || lpad(g::text, 12, '0'))::uuid, 'W4R2T Budget Decided ' || g, 'budget' || g || '@w4r2t3980.test',
                                  null, null, now() - interval '25 days' + g * interval '1 minute');
      perform public.ops_brand_autolink_one(('4e9a0000-0000-4000-b200-' || lpad(g::text, 12, '0'))::uuid);
      perform pg_temp.w4r2t_close(('4e9a0000-0000-4000-b200-' || lpad(g::text, 12, '0'))::uuid, null, now() - interval '1 day');
    end loop;
    -- thirty new brands nobody decided about, all newer than the decided ones
    for g in 1..30 loop
      perform pg_temp.w4r2t_brand(('4e9a0000-0000-4000-b201-' || lpad(g::text, 12, '0'))::uuid, 'W4R2T Budget New ' || lpad(g::text, 2, '0'),
                                  'budgetnew' || g || '@w4r2t3980.test', null, null, now() - interval '2 hours' + g * interval '1 minute');
    end loop;
    v1 := public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-BUDGET', 'run 1: 25 brands, all of them new ones nobody decided about; no decided brand looked at yet',
      concat_ws('|', v1->>'created', (select count(*) from public.ops_brand_autolink_waits where brand_id::text like '4e9a0000-0000-4000-b200-%')),
      '25|0');
    v2 := public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-BUDGET', 'run 2: the last 5 new brands, and all 5 decided brands looked at (none starves)',
      concat_ws('|', v2->>'created',
                (select count(*) from public.ops_brand_autolink_waits where brand_id::text like '4e9a0000-0000-4000-b200-%' and last_status = 'decided' and updated_at = now()),
                (select count(*) from public.brands b where b.id::text like '4e9a0000-0000-4000-b201-%'
                    and not exists (select 1 from public.crm_records h where h.brand_id = b.id))),
      '5|5|0');
    v3 := public.ops_brand_autolink();
    res := pg_temp.w4r2t_rec(res, 'W4R2T-BUDGET', 'run 3: nothing left to do, and no decided brand is opened again',
      concat_ws('|', v3->>'created', v3->>'pick', v3->>'linked',
                (select count(*) from public.ops_work_cards where auto_key like 'brand_pick:4e9a0000-0000-4000-b200-%' and status <> 'done')),
      '0|0|0|0');
    raise exception 'w4r2t_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2t_undo' then raise; end if;
  end;
  perform pg_temp.w4r2t_flush(res);
end;
$budget$;

-- ---------------------------------------------------------------------------
-- W4R2T-BUSY: only the held brand is skipped; the next run settles it
-- ---------------------------------------------------------------------------
do $busy$
declare v_conn text := (select conn from t3980w4r2t_conn); v jsonb; g integer; v_t0 timestamptz;
begin
  for g in 1..6 loop
    perform pg_temp.w4r2t_brand(('4e9a0000-0000-4000-b300-' || lpad(g::text, 12, '0'))::uuid, 'W4R2T Busy ' || g, 'busy' || g || '@w4r2t3980.test',
                                null, null, now() - interval '3 hours' + g * interval '1 minute');
  end loop;
  perform dblink_connect('w4r2t_other', v_conn);
  perform dblink_exec('w4r2t_other', 'BEGIN');
  -- the oldest brand (the run's first) is held by another session
  perform x from dblink('w4r2t_other', format('SELECT pg_advisory_xact_lock(hashtextextended(%L, 0))::text',
                                              'ops_brand_autolink:4e9a0000-0000-4000-b300-000000000001')) as t(x text);
  perform set_config('lock_timeout', '2s', true);
  v_t0 := clock_timestamp();
  v := public.ops_brand_autolink();
  perform pg_temp.w4r2t_check('W4R2T-BUSY', 'the held brand (first in line) is busy; the five behind it are settled, without waiting',
    concat_ws('|', v->>'busy', v->>'created', (extract(epoch from clock_timestamp() - v_t0) < 1.5)::text), '1|5|true');
  perform pg_temp.w4r2t_check('W4R2T-BUSY', 'the busy brand has no wait row and no card',
    concat_ws('|', (select count(*) from public.ops_brand_autolink_waits where brand_id = '4e9a0000-0000-4000-b300-000000000001'),
              pg_temp.w4r2t_state('4e9a0000-0000-4000-b300-000000000001')), '0|host=0 ; cards=none');
  perform dblink_exec('w4r2t_other', 'ROLLBACK');
  perform dblink_disconnect('w4r2t_other');
  perform set_config('lock_timeout', '0', true);
  v := public.ops_brand_autolink();
  perform pg_temp.w4r2t_check('W4R2T-BUSY', 'once let go, the next run settles it',
    concat_ws('|', v->>'busy', v->>'created', pg_temp.w4r2t_state('4e9a0000-0000-4000-b300-000000000001')), '0|1|host=1 ; cards=none');
exception when others then
  begin perform dblink_disconnect('w4r2t_other'); exception when others then null; end;
  raise;
end;
$busy$;

-- ---------------------------------------------------------------------------
-- W4R2T-WORDS
-- ---------------------------------------------------------------------------
do $words$
declare res jsonb := '[]'::jsonb; p jsonb; r jsonb;
begin
  begin
    -- An agent closed the "reopen the Lost card?" card: asked again, with words.
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c400-000000000001', 'W4R2T Lost One', 'email', 'lost@w4r2t3980.test', now() - interval '40 days', null, 'lost');
    perform pg_temp.w4r2t_brand('4e9a0000-0000-4000-b400-000000000001', 'W4R2T Lost Brand', 'lost@w4r2t3980.test');
    res := pg_temp.w4r2t_rec(res, 'W4R2T-WORDS', 'setup: a card asks whether to reopen the Lost card',
      public.ops_brand_autolink_one('4e9a0000-0000-4000-b400-000000000001')->>'status', 'ask_reopen');
    perform pg_temp.w4r2t_close('4e9a0000-0000-4000-b400-000000000001', 'claude', now() - interval '2 days');
    p := pg_temp.w4r2t_own($q$select public.ops_brand_cards_confirm(array['4e9a0000-0000-4000-b400-000000000001']::uuid[], 'w4r2t-words-lost-1')::text$q$);
    res := pg_temp.w4r2t_rec(res, 'W4R2T-WORDS', 'P3-A: an agent-closed reopen card asked again says so, and the card opens again',
      concat_ws('|', p->'results'->0->>'status', p->'results'->0->>'words', pg_temp.w4r2t_state('4e9a0000-0000-4000-b400-000000000001'), p->>'skipped', p->>'unchanged'),
      'ask_reopen|A card asks a person again whether to reopen the Lost host card: an agent closed it, and only a person decides.|host=0 ; cards=brand_lost/todo|1|0');

    -- A US brand and a Lagos card with 0803 555 0177: the digits are not a US number.
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c400-000000000002', 'W4R2T Lagos Card', 'phone', '0803 555 0177', now() - interval '40 days',
                               '4e9a0000-0000-4000-e000-000000000101');
    perform pg_temp.w4r2t_brand('4e9a0000-0000-4000-b400-000000000002', 'W4R2T US Brand Same Digits', null, '0803 555 0177', 'US');
    res := pg_temp.w4r2t_rec(res, 'W4R2T-WORDS', 'P3-B: digits not valid in the brand''s country (US) say so, never "no country is on record"',
      (select concat_ws('|', m->>'status', m->>'near_words') from (select public.ops_brand_match('4e9a0000-0000-4000-b400-000000000002') m) s),
      'pick|the same digits, but they do not read as a phone number in United States');

    -- A re-ask row can be ticked in Admin (it is not "decided"), and a decided brand counts as unchanged.
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c400-000000000003', 'W4R2T Reask One', 'email', 'reask@w4r2t3980.test');
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c400-000000000004', 'W4R2T Reask Two', 'email', 'reask@w4r2t3980.test');
    perform pg_temp.w4r2t_brand('4e9a0000-0000-4000-b400-000000000003', 'W4R2T Reask Brand', 'reask@w4r2t3980.test');
    perform public.ops_brand_autolink_one('4e9a0000-0000-4000-b400-000000000003');
    perform pg_temp.w4r2t_close('4e9a0000-0000-4000-b400-000000000003', null, now() - interval '3 days');
    p := pg_temp.w4r2t_own($q$select public.ops_brand_cards_confirm(array['4e9a0000-0000-4000-b400-000000000003']::uuid[], 'w4r2t-words-dec-1')::text$q$);
    res := pg_temp.w4r2t_rec(res, 'W4R2T-WORDS', 'a decided brand confirmed: skipped and unchanged, not left for a person',
      concat_ws('|', p->'results'->0->>'status', p->>'skipped', p->>'unchanged', p->>'busy'), 'decided|1|1|0');
    perform pg_temp.w4r2t_host('4e9a0000-0000-4000-c400-000000000005', 'W4R2T Reask Three', 'email', 'reask@w4r2t3980.test', now() - interval '1 day');
    p := pg_temp.w4r2t_own('select public.ops_brand_cards_preview_page(0, 100)::text');
    select x into r from jsonb_array_elements(p->'rows') x where x->>'brand_id' = '4e9a0000-0000-4000-b400-000000000003';
    res := pg_temp.w4r2t_rec(res, 'W4R2T-WORDS', 'P3-C: the re-ask row says it asks again, is not marked decided, and has no open card',
      concat_ws('|', r->>'action', r->>'reask', coalesce(r->>'decided', 'none'), coalesce(r->>'open_card', 'none'), r->>'words'),
      'pick|true|none|none|Asks again: a person decided before, and since then W4R2T Reask Three matches exactly (not on that card). The card for a person opens again.');
    raise exception 'w4r2t_undo';
  exception when raise_exception then if sqlerrm <> 'w4r2t_undo' then raise; end if;
  end;
  perform pg_temp.w4r2t_flush(res);
end;
$words$;

select count(*) as w4r2t_total, count(*) filter (where not ok) as w4r2t_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4r2t_failures
  from t3980w4r2t_results \gset
rollback;

\echo 'ISSUE-3980 SYNCED WAVE 4 REWORK 2 TESTER:' :w4r2t_total 'checks,' :w4r2t_failed 'failed'
select (:w4r2t_total < 27 or :w4r2t_failed > 0) as w4r2t_bad \gset
\if :w4r2t_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 REWORK 2 TESTER FAILED:' :w4r2t_failed 'of' :w4r2t_total
  \echo :w4r2t_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 REWORK 2 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 REWORK 2 TESTER PASS'
