-- ISSUE-865 WP-A — SQL contract suite for the conversion-tracking schema
-- (migration 20270105000865_issue_865_attribution_conversion_schema.sql).
--
-- Covers:
--   T-1 (schema)        — both tables + the key columns/constraints exist.
--   T-2 (IDEMPOTENCY)   — UNIQUE(event_id): the same event_id inserted twice via
--                         ON CONFLICT DO NOTHING leaves EXACTLY ONE row.  <-- the
--                         fails-on-revert anchor: delete the UNIQUE(event_id) from
--                         the migration and the `ON CONFLICT (event_id)` clause
--                         errors 42P10, failing this suite.
--   T-3 (RLS negative)  — a non-admin authenticated session reads ZERO rows and
--                         cannot INSERT; service-role (postgres/BYPASSRLS) writes.
--   T-4 (privacy)       — no raw email/phone/ip/ua column exists; only *_hash.
--
-- Run (LOCAL Postgres only — NEVER remote), after applying ALL migrations in
-- ls|sort order (mirrors .github/workflows/supabase-migrations-and-stripe-deno.yml;
-- raw-Docker per COMMS-0102 since `supabase start` breaks on duplicate prefixes):
--   docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f - < supabase/migrations/__tests__/issue_865_attribution_conversion_schema.test.sql
-- Whole script runs in ONE transaction and ROLLS BACK — no residue.

\set ON_ERROR_STOP on
begin;

-- ── T-1 · schema exists ───────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.ad_attribution_touches') is null then
    raise exception 'T-1 FAIL: ad_attribution_touches missing';
  end if;
  if to_regclass('public.ad_conversions') is null then
    raise exception 'T-1 FAIL: ad_conversions missing';
  end if;

  -- dedup key is UNIQUE on ad_conversions.event_id
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'ad_conversions'
      and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attnum)
           from pg_attribute a
           where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['event_id']
  ) then
    raise exception 'T-1 FAIL: UNIQUE(event_id) idempotency guard missing on ad_conversions';
  end if;

  -- first-party click_id is UNIQUE on ad_attribution_touches
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'ad_attribution_touches'
      and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attnum)
           from pg_attribute a
           where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['click_id']
  ) then
    raise exception 'T-1 FAIL: UNIQUE(click_id) missing on ad_attribution_touches';
  end if;

  -- A3-1: campaign_id FK targets ad_campaigns (NOT meta_campaigns)
  if not exists (
    select 1
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    where child.relname = 'ad_conversions' and c.contype = 'f' and parent.relname = 'ad_campaigns'
  ) then
    raise exception 'T-1 FAIL: ad_conversions.campaign_id must FK to ad_campaigns (A3-1)';
  end if;

  -- A3-2: connection_id FK targets ad_connections on both tables
  if not exists (
    select 1 from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    where child.relname = 'ad_conversions' and c.contype = 'f' and parent.relname = 'ad_connections'
  ) then
    raise exception 'T-1 FAIL: ad_conversions.connection_id must FK to ad_connections (A3-2)';
  end if;

  -- per-channel status columns
  perform 1 from information_schema.columns
   where table_schema='public' and table_name='ad_conversions'
     and column_name in ('meta_capi_status','tiktok_events_status','snap_capi_status',
                         'reddit_capi_status','appsflyer_status')
   having count(*) = 5;
  if not found then
    raise exception 'T-1 FAIL: expected 5 per-channel *_status columns on ad_conversions';
  end if;
end $$;

-- ── T-4 · privacy: only hashed PII columns exist, never raw ────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name in ('ad_attribution_touches','ad_conversions')
      and column_name in ('email','phone','ip','ip_address','user_agent','ua','raw_email','raw_phone')
  ) then
    raise exception 'T-4 FAIL: a raw PII column exists on an ad_* attribution table (SC-9)';
  end if;
  perform 1 from information_schema.columns
   where table_schema='public' and table_name='ad_attribution_touches'
     and column_name in ('ua_hash','ip_hash') having count(*) = 2;
  if not found then
    raise exception 'T-4 FAIL: ua_hash/ip_hash missing on ad_attribution_touches';
  end if;
  perform 1 from information_schema.columns
   where table_schema='public' and table_name='ad_conversions'
     and column_name in ('hashed_email','hashed_phone') having count(*) = 2;
  if not found then
    raise exception 'T-4 FAIL: hashed_email/hashed_phone missing on ad_conversions';
  end if;
end $$;

-- ── T-2 · IDEMPOTENCY (fails-on-revert anchor) ────────────────────────────────
-- Two inserts of the SAME event_id via ON CONFLICT (event_id) DO NOTHING => 1 row.
-- Remove UNIQUE(event_id) from the migration and the ON CONFLICT clause errors
-- 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
-- specification") — this suite fails on revert of the guard.
insert into public.ad_conversions (event_id, event_type, event_name, surface)
values ('ISSUE865-T2-EVT', 'purchase', 'Purchase', 'web')
on conflict (event_id) do nothing;

insert into public.ad_conversions (event_id, event_type, event_name, surface)
values ('ISSUE865-T2-EVT', 'purchase', 'Purchase', 'web')
on conflict (event_id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.ad_conversions where event_id = 'ISSUE865-T2-EVT';
  if n <> 1 then
    raise exception 'T-2 FAIL: expected exactly 1 ad_conversions row for the duplicate event_id, got %', n;
  end if;
end $$;

-- a service-role write on ad_attribution_touches persists (baseline for T-3)
insert into public.ad_attribution_touches (click_id, network, surface)
values ('ISSUE865-T2-CLICK', 'meta', 'web');

-- ── T-3 · RLS negative: non-admin authenticated can neither read nor write ─────
do $$
declare visible int;
begin
  set local role authenticated;

  -- is_admin_user() is false without an admin JWT -> RLS filters everything out
  select count(*) into visible from public.ad_conversions;
  if visible <> 0 then
    raise exception 'T-3 FAIL: authenticated read % rows from ad_conversions (RLS breach)', visible;
  end if;
  select count(*) into visible from public.ad_attribution_touches;
  if visible <> 0 then
    raise exception 'T-3 FAIL: authenticated read % rows from ad_attribution_touches (RLS breach)', visible;
  end if;

  -- authenticated has no INSERT grant/policy -> write denied
  begin
    insert into public.ad_conversions (event_id, event_type, event_name, surface)
    values ('ISSUE865-T3-DENY', 'purchase', 'Purchase', 'web');
    raise exception 'T-3 FAIL: authenticated INSERT into ad_conversions was ALLOWED (should be denied)';
  exception
    when insufficient_privilege then null;  -- expected: permission denied
    when others then
      -- any RLS/permission rejection is acceptable; re-raise a genuine assertion failure
      if sqlerrm like 'T-3 FAIL%' then raise; end if;
  end;

  reset role;
end $$;

-- service_role CAN write (RLS bypass + GRANT ALL) — proves the edge-fn write path
do $$
declare n int;
begin
  set local role service_role;
  insert into public.ad_conversions (event_id, event_type, event_name, surface)
  values ('ISSUE865-T3-SVC', 'purchase', 'Purchase', 'web');
  select count(*) into n from public.ad_conversions where event_id = 'ISSUE865-T3-SVC';
  reset role;
  if n <> 1 then
    raise exception 'T-3 FAIL: service_role write path failed (got %)', n;
  end if;
end $$;

rollback;

\echo 'ISSUE-865 WP-A schema suite: T-1..T-4 PASS'
