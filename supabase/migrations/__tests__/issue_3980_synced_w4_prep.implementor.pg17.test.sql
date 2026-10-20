-- Issue #3980 synced program, Wave 4 prep -- the cron's order for decided
-- brands (retest 2, P3-1), on the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   W4P-ORDER  a decided brand with a real reason to look again (a new exact
--              host card since its last look, or never looked at since the
--              person's close) is looked at in the first run, ahead of many
--              older decided brands that are due only for their daily look.
--              Brands nobody decided about still come first, a run still
--              takes at most 25 brands, a brand backing off is still left
--              alone, and the daily-only brands are all reached next run.
--              Among brands never looked at since their close, one with a
--              real change goes first.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

insert into auth.users (id, email, email_confirmed_at) values
  ('3a9c0000-0000-4000-a000-000000000001', 'po.w4p3980@test.local', now());
insert into public.admin_users (email, role, status, accepted_at) values ('po.w4p3980@test.local', 'owner', 'active', now());
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('3a9c0000-0000-4000-e000-000000000101', 'w4p-lagos', 'W4P Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5);
insert into public.ops_settings (key, value, updated_by) values ('brand_auto_since', to_jsonb(now() - interval '30 days'), 'w4p')
  on conflict (key) do update set value = excluded.value;

-- Only this suite's brands are new for the cron.
set local session_replication_role = replica;
update public.brands set deleted_at = now() where deleted_at is null;
set local session_replication_role = origin;

create temp table t3980w4p_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w4p_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4p_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 900), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w4p_host(p_id uuid, p_name text, p_email text, p_at timestamptz) returns void
language plpgsql as $fn$
begin
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, created_at, updated_at)
  values (p_id, 'hosts', p_name, 'contacted', 'w4p', 'w4p', p_at, p_at);
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by, created_at)
  values (p_id, 'email', p_email, public.crm_ident_key('email', p_email), 'w4p', p_at);
end;
$fn$;

create function pg_temp.w4p_brand(p_id uuid, p_name text, p_email text, p_at timestamptz) returns void
language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, contact_email, country_code, created_at, updated_at, social_links)
  values (p_id, gen_random_uuid(), p_name, 'w4p-' || substr(md5(p_id::text), 1, 12), p_email, 'NG', p_at, p_at, '{}'::jsonb);
  set local session_replication_role = origin;
end;
$fn$;

-- A brand two host cards share an email with: the cron opens a pick card
-- for it, and a person closes it (decided).
create function pg_temp.w4p_decided(p_brand uuid, p_n integer, p_tag text, p_created timestamptz, p_closed timestamptz) returns void
language plpgsql as $fn$
declare v_email text := p_tag || p_n || '@w4p3980.test';
begin
  perform pg_temp.w4p_host(('3a9c0000-0000-4000-c' || p_tag || '0-' || lpad((2 * p_n)::text, 12, '0'))::uuid, 'W4P Card A ' || p_tag || p_n, v_email, now() - interval '40 days');
  perform pg_temp.w4p_host(('3a9c0000-0000-4000-c' || p_tag || '0-' || lpad((2 * p_n + 1)::text, 12, '0'))::uuid, 'W4P Card B ' || p_tag || p_n, v_email, now() - interval '40 days');
  perform pg_temp.w4p_brand(p_brand, 'W4P Brand ' || p_tag || p_n, v_email, p_created);
  if public.ops_brand_autolink_one(p_brand)->>'status' <> 'pick' then
    raise exception 'w4p setup: brand % did not get a pick card', p_brand;
  end if;
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Decided in the test.',
         closed_at = p_closed, closed_by = 'po.w4p3980@test.local', closed_via = null
   where auto_key = 'brand_pick:' || p_brand and status <> 'done';
end;
$fn$;

create function pg_temp.w4p_looked(p uuid) returns text
language sql as $fn$
  select coalesce((select case when t.updated_at = now() then 'looked' else 'not looked' end || '/' || t.last_status
                     from public.ops_brand_autolink_waits t where t.brand_id = p), 'no row')
$fn$;

create function pg_temp.w4p_open(p uuid) returns text
language sql as $fn$
  select coalesce((select string_agg(k.status, ',' order by k.number) from public.ops_work_cards k
                    where k.auto_key = 'brand_pick:' || p and k.status <> 'done'), 'none')
$fn$;

-- ---------------------------------------------------------------------------
-- Setup
--   30 decided brands (aa1..aa30, oldest first), closed 3 days ago, each
--     looked at 25 hours ago: due only for their daily look.
--   aa30, the NEWEST of them, also gains a new exact host card 10 minutes ago.
--   bb1: decided 1 day ago and never looked at since; newer than all the aa.
--   cc1: decided, backing off (its wait is in the future), with a new exact
--     card: left alone.
--   dd1: a brand nobody decided about, the newest of all.
-- ---------------------------------------------------------------------------
do $setup$
declare g integer;
begin
  for g in 1..30 loop
    perform pg_temp.w4p_decided(('3a9c0000-0000-4000-baa0-' || lpad(g::text, 12, '0'))::uuid, g, 'aa',
                                now() - interval '25 days' + g * interval '1 minute', now() - interval '3 days');
  end loop;
  perform pg_temp.w4p_decided('3a9c0000-0000-4000-bbb0-000000000001', 1, 'bb', now() - interval '20 days', now() - interval '1 day');
  perform pg_temp.w4p_decided('3a9c0000-0000-4000-bcc0-000000000001', 1, 'cc', now() - interval '19 days', now() - interval '3 days');
  insert into public.ops_brand_autolink_waits (brand_id, tries, next_at, last_status, updated_at)
  select b.id, 1, now() - interval '25 hours', 'decided', now() - interval '25 hours'
    from public.brands b where b.id::text like '3a9c0000-0000-4000-baa0-%';
  insert into public.ops_brand_autolink_waits (brand_id, tries, next_at, last_status, updated_at)
  values ('3a9c0000-0000-4000-bcc0-000000000001', 3, now() + interval '2 hours', 'pick:kept', now() - interval '2 hours');
  perform pg_temp.w4p_host('3a9c0000-0000-4000-cff0-000000000001', 'W4P New Exact aa30', 'aa30@w4p3980.test', now() - interval '10 minutes');
  perform pg_temp.w4p_host('3a9c0000-0000-4000-cff0-000000000002', 'W4P New Exact cc1', 'cc1@w4p3980.test', now() - interval '10 minutes');
  perform pg_temp.w4p_brand('3a9c0000-0000-4000-bdd0-000000000001', 'W4P Brand dd1', 'dd1@w4p3980.test', now() - interval '1 hour');
end;
$setup$;

do $order$
declare v1 jsonb; v2 jsonb;
begin
  perform pg_temp.w4p_check('W4P-ORDER', 'setup: 32 decided brands, none with an open card',
    concat_ws('|', (select count(*) from public.brands br where br.id::text like '3a9c0000-%'
                      and (public.ops_brand_decided(br.id)).id is not null),
                   (select count(*) from public.ops_work_cards where auto_key like 'brand_pick:3a9c0000-%' and status <> 'done')),
    '32|0');

  v1 := public.ops_brand_autolink();
  perform pg_temp.w4p_check('W4P-ORDER', 'run 1: the brand nobody decided about is handled first (a new host card)',
    concat_ws('|', v1->>'created', (select count(*) from public.crm_records h where h.brand_id = '3a9c0000-0000-4000-bdd0-000000000001')),
    '1|1');
  perform pg_temp.w4p_check('W4P-ORDER', 'run 1: the newest decided brand with a new exact card is asked again now, not behind 29 daily looks',
    concat_ws('|', v1->>'pick', pg_temp.w4p_open('3a9c0000-0000-4000-baa0-000000000030')), '1|todo');
  perform pg_temp.w4p_check('W4P-ORDER', 'run 1: the decided brand never looked at since its close is looked at now',
    pg_temp.w4p_looked('3a9c0000-0000-4000-bbb0-000000000001'), 'looked/decided');
  perform pg_temp.w4p_check('W4P-ORDER', 'run 1: the brand backing off is left alone, even with a new exact card',
    concat_ws('|', pg_temp.w4p_looked('3a9c0000-0000-4000-bcc0-000000000001'), pg_temp.w4p_open('3a9c0000-0000-4000-bcc0-000000000001')),
    'not looked/pick:kept|none');
  perform pg_temp.w4p_check('W4P-ORDER', 'run 1: 25 brands in all: 3 with a reason, then the 22 oldest daily-only looks',
    concat_ws('|', (select count(*) from public.brands b where b.id::text like '3a9c0000-0000-4000-baa0-%'
                      and pg_temp.w4p_looked(b.id) = 'looked/decided'),
                   (select string_agg(right(b.id::text, 2), ',' order by b.id) from public.brands b where b.id::text like '3a9c0000-0000-4000-baa0-%'
                      and b.id <> '3a9c0000-0000-4000-baa0-000000000030' and pg_temp.w4p_looked(b.id) <> 'looked/decided')),
    '22|23,24,25,26,27,28,29');

  v2 := public.ops_brand_autolink();
  perform pg_temp.w4p_check('W4P-ORDER', 'run 2: the 7 daily-only brands left are reached, so all 29 are looked at (none starves); nothing new opens',
    concat_ws('|', (select count(*) from public.brands b where b.id::text like '3a9c0000-0000-4000-baa0-%'
                      and pg_temp.w4p_looked(b.id) = 'looked/decided'),
                   v2->>'pick', v2->>'created', pg_temp.w4p_looked('3a9c0000-0000-4000-bcc0-000000000001')),
    '29|0|0|not looked/pick:kept');
end;
$order$;

-- ---------------------------------------------------------------------------
-- A real change outranks brands merely never looked at since their close.
-- 26 decided brands (ee1..ee26), closed 2 days ago, none looked at since;
-- ee26, the newest, gains a new exact host card 10 minutes ago. Every brand
-- from the runs above was looked at in this transaction, so only the ee
-- brands are due.
-- ---------------------------------------------------------------------------
do $tier$
declare g integer; v3 jsonb;
begin
  for g in 1..26 loop
    perform pg_temp.w4p_decided(('3a9c0000-0000-4000-bee0-' || lpad(g::text, 12, '0'))::uuid, g, 'ee',
                                now() - interval '15 days' + g * interval '1 minute', now() - interval '2 days');
  end loop;
  perform pg_temp.w4p_host('3a9c0000-0000-4000-cff0-000000000003', 'W4P New Exact ee26', 'ee26@w4p3980.test', now() - interval '10 minutes');
  v3 := public.ops_brand_autolink();
  perform pg_temp.w4p_check('W4P-ORDER', 'run 3: among 26 brands never looked at since their close, the newest one with a real change goes first',
    concat_ws('|', v3->>'pick', pg_temp.w4p_open('3a9c0000-0000-4000-bee0-000000000026')), '1|todo');
  perform pg_temp.w4p_check('W4P-ORDER', 'run 3: the other 24 looks in the budget are the oldest of the rest; ee25 waits for the next run',
    concat_ws('|', (select count(*) from public.brands b where b.id::text like '3a9c0000-0000-4000-bee0-%'
                      and pg_temp.w4p_looked(b.id) = 'looked/decided'),
                   pg_temp.w4p_looked('3a9c0000-0000-4000-bee0-000000000025')),
    '24|no row');
end;
$tier$;

select count(*) as w4p_total, count(*) filter (where not ok) as w4p_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4p_failures
  from t3980w4p_results \gset
rollback;

select (:w4p_total < 9 or :w4p_failed > 0) as w4p_bad \gset
\if :w4p_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 PREP FAILED:' :w4p_failed 'of' :w4p_total
  \echo :w4p_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 PREP FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 PREP PASS:' :w4p_total 'checks, 0 failed'
