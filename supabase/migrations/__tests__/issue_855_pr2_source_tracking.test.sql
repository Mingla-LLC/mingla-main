-- ISSUE-855 PR-2 — SQL contract + aggregation probe for the source-tracking
-- rollup extension (migration 20270121000855_issue_855_pr2_source_tracking.sql).
--
-- Run (LOCAL Postgres only — NEVER remote), AFTER applying ALL migrations in
-- ls|sort order (mirrors .github/workflows/supabase-migrations-and-stripe-deno.yml):
--   psql "$DATABASE_URL" -f issue_855_pr2_source_tracking.test.sql
-- Whole script runs in ONE transaction and ROLLS BACK — no residue. Hand-run
-- probe, same convention as issue_855_pr1_numbers_engine_rollups.test.sql (CI's
-- migration step applies migrations but does not glob __tests__/).
--
-- Covers:
--   S-1  the entry_source column exists with the CHECK on the 6 allowed values
--        (and referrer_host exists).
--   S-2  brand_mingla_drove_rollup by_source now splits the non-ad slice by the
--        touch entry_source (ad/search/social/organic/direct), organic is the
--        honest catch-all (entry_source organic|unknown + pre-capture no-touch),
--        legacy click_id-with-no-touch stays 'ad', and by_platform (ad slice) +
--        the honest TOTAL are byte-stable.
--   S-3  the INVARIANT: ad + (search+social+organic+direct) distinct-customers
--        equals the PR-1 ad-vs-organic total (PR-2 only SUBDIVIDES, never fabricates).
--   S-4  entity_conversion_rollup gives the same split at listing scope.
--
-- fails-on-revert anchors:
--   · make entry_source non-authoritative (drop the entry_source WHENs) → the
--     organic touch (which carries a click_id) misclassifies as 'ad' → S-2 fails.
--   · drop the NULL-entry_source handle fallback → the legacy row (click_id, no
--     touch) drops out of 'ad' → S-2 legacy assertion fails.

\set ON_ERROR_STOP on
begin;

-- ── S-1 · schema: entry_source CHECK + referrer_host exist ─────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ad_attribution_touches'
      and column_name='entry_source'
  ) then raise exception 'S-1 FAIL: ad_attribution_touches.entry_source missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ad_attribution_touches'
      and column_name='referrer_host'
  ) then raise exception 'S-1 FAIL: ad_attribution_touches.referrer_host missing'; end if;
  if not exists (
    select 1 from pg_constraint
    where conname='ad_attribution_touches_entry_source_check'
      and conrelid='public.ad_attribution_touches'::regclass
  ) then raise exception 'S-1 FAIL: entry_source CHECK constraint missing'; end if;
  -- the CHECK must reject a bad value.
  begin
    insert into public.ad_attribution_touches (click_id, network, surface, entry_source)
      values ('s1-badval-'||substr(md5(random()::text),1,8), 'other', 'web', 'billboard');
    raise exception 'S-1 FAIL: CHECK allowed an out-of-set entry_source';
  exception when check_violation then
    null; -- expected
  end;
  raise notice 'S-1 PASS: entry_source + referrer_host + CHECK present';
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- Seed: one brand + owner + event, 8 online-checkout orders each with a distinct
-- buyer, and (for all but one) a touch+conversion exercising every source path.
-- ══════════════════════════════════════════════════════════════════════════════
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0855-4200-8000-000000000a01','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','probe-855pr2-owner@example.com', now(), now());
insert into public.creator_accounts (id, created_at)
  values ('00000000-0855-4200-8000-000000000a01', now());
insert into public.place_pool (id, name, lat, lng, created_at)
  values ('00000000-0855-4200-8000-000000000c01','Probe PP 855pr2', 40.7, -74.0, now());
insert into public.brands (id, account_id, place_pool_id, default_currency, name, slug, created_at)
  values ('00000000-0855-4200-8000-000000000b01','00000000-0855-4200-8000-000000000a01',
          '00000000-0855-4200-8000-000000000c01','GBP','Probe Brand 855pr2',
          'probe-brand-855pr2-'||substr(md5(random()::text),1,8), now());
insert into public.events (id, brand_id, created_by, title, slug, timezone, event_type, created_at)
  values ('00000000-0855-4200-8000-0000000000e1','00000000-0855-4200-8000-000000000b01',
          '00000000-0855-4200-8000-000000000a01','E1','probe-e1-855pr2-'||substr(md5(random()::text),1,8),
          'UTC','event', now());

-- Orders (fixed ids so conversions can reference them). Distinct buyers.
insert into public.orders (id, event_id, buyer_email, buyer_phone_e164, confirmed_at, created_at, total_cents, refunded_amount_cents, payment_status, currency, source) values
  ('00000000-0855-4200-8000-0000000000f1','00000000-0855-4200-8000-0000000000e1','ad@x.com',     '+15554200001', now(), now(), 5000,0,'paid','GBP','online_checkout'), -- ad
  ('00000000-0855-4200-8000-0000000000f2','00000000-0855-4200-8000-0000000000e1','search@x.com',  '+15554200002', now(), now(), 3000,0,'paid','GBP','online_checkout'), -- search
  ('00000000-0855-4200-8000-0000000000f3','00000000-0855-4200-8000-0000000000e1','social@x.com',  '+15554200003', now(), now(), 2000,0,'paid','GBP','online_checkout'), -- social
  ('00000000-0855-4200-8000-0000000000f4','00000000-0855-4200-8000-0000000000e1','organic@x.com', '+15554200004', now(), now(), 1000,0,'paid','GBP','online_checkout'), -- organic
  ('00000000-0855-4200-8000-0000000000f5','00000000-0855-4200-8000-0000000000e1','direct@x.com',  '+15554200005', now(), now(),  500,0,'paid','GBP','online_checkout'), -- direct
  ('00000000-0855-4200-8000-0000000000f6','00000000-0855-4200-8000-0000000000e1','legacy@x.com',  '+15554200006', now(), now(),  700,0,'paid','GBP','online_checkout'), -- legacy ad (no touch)
  ('00000000-0855-4200-8000-0000000000f7','00000000-0855-4200-8000-0000000000e1','none@x.com',    '+15554200007', now(), now(),  400,0,'paid','GBP','online_checkout'), -- pre-capture (no conversion)
  ('00000000-0855-4200-8000-0000000000f8','00000000-0855-4200-8000-0000000000e1','unknown@x.com', '+15554200008', now(), now(),  600,0,'paid','GBP','online_checkout'); -- unknown → organic

-- Touches carrying entry_source (each with its own first-party click_id).
insert into public.ad_attribution_touches (id, click_id, network, surface, entry_source, referrer_host) values
  ('00000000-0855-4200-8000-000000000d01','ck-ad',     'meta',  'web','ad',      null),
  ('00000000-0855-4200-8000-000000000d02','ck-search', 'other', 'web','search',  'google.com'),
  ('00000000-0855-4200-8000-000000000d03','ck-social', 'other', 'web','social',  'instagram.com'),
  ('00000000-0855-4200-8000-000000000d04','ck-org',    'other', 'web','organic', 'usemingla.com'),
  ('00000000-0855-4200-8000-000000000d05','ck-dir',    'other', 'web','direct',  null),
  ('00000000-0855-4200-8000-000000000d06','ck-unk',    'other', 'web','unknown', 'some-blog.example.org');

-- Conversions: one per booking except O_none. touch_id links to the touch (so the
-- rollup reads entry_source); the legacy row has a click_id but NO touch_id +
-- NULL entry_source (proves the PR-1 handle fallback still => 'ad').
insert into public.ad_conversions (order_id, touch_id, click_id, platform, event_type, event_name, surface, event_id, currency, value_cents) values
  ('00000000-0855-4200-8000-0000000000f1','00000000-0855-4200-8000-000000000d01','ck-ad',    'meta',  'purchase','Purchase','web','conv-pr2-ad',     'GBP',5000),
  ('00000000-0855-4200-8000-0000000000f2','00000000-0855-4200-8000-000000000d02','ck-search', null,   'purchase','Purchase','web','conv-pr2-search', 'GBP',3000),
  ('00000000-0855-4200-8000-0000000000f3','00000000-0855-4200-8000-000000000d03','ck-social', null,   'purchase','Purchase','web','conv-pr2-social', 'GBP',2000),
  ('00000000-0855-4200-8000-0000000000f4','00000000-0855-4200-8000-000000000d04','ck-org',    null,   'purchase','Purchase','web','conv-pr2-org',    'GBP',1000),
  ('00000000-0855-4200-8000-0000000000f5','00000000-0855-4200-8000-000000000d05','ck-dir',    null,   'purchase','Purchase','web','conv-pr2-dir',    'GBP', 500),
  ('00000000-0855-4200-8000-0000000000f6', null,                                 'ck-legacy','tiktok','purchase','Purchase','web','conv-pr2-legacy', 'GBP', 700),
  ('00000000-0855-4200-8000-0000000000f8','00000000-0855-4200-8000-000000000d06','ck-unk',    null,   'purchase','Purchase','web','conv-pr2-unk',    'GBP', 600);

-- ── S-2/S-3 · brand_mingla_drove_rollup by_source split + invariant ────────────
do $$
declare
  v jsonb;
  v_ad bigint; v_search bigint; v_social bigint; v_organic bigint; v_direct bigint;
  v_meta bigint; v_tiktok bigint;
begin
  -- Set BOTH claim forms so the probe is portable: some Supabase images' auth.uid()
  -- reads the dotted request.jwt.claim.sub, others the request.jwt.claims JSON.
  perform set_config('request.jwt.claim.sub', '00000000-0855-4200-8000-000000000a01', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0855-4200-8000-000000000a01','role','authenticated')::text, true);

  v := public.brand_mingla_drove_rollup('00000000-0855-4200-8000-000000000b01');
  if (v->>'authorized')::boolean is distinct from true then
    raise exception 'S-2 FAIL: owner not authorized: %', v;
  end if;

  -- Honest TOTAL byte-stable: 8 distinct customers, GBP value = sum of all orders.
  if (v->>'mingla_drove_lifetime')::bigint <> 8 then
    raise exception 'S-2 FAIL total customers: expected 8, got %', v->>'mingla_drove_lifetime';
  end if;
  if (v->'value_cents_lifetime'->>'GBP')::bigint <> (5000+3000+2000+1000+500+700+400+600) then
    raise exception 'S-2 FAIL total GBP value: got %', v->'value_cents_lifetime'->>'GBP';
  end if;

  select (s->>'customers')::bigint into v_ad      from jsonb_array_elements(v->'by_source') s where s->>'source'='ad';
  select (s->>'customers')::bigint into v_search  from jsonb_array_elements(v->'by_source') s where s->>'source'='search';
  select (s->>'customers')::bigint into v_social  from jsonb_array_elements(v->'by_source') s where s->>'source'='social';
  select (s->>'customers')::bigint into v_organic from jsonb_array_elements(v->'by_source') s where s->>'source'='organic';
  select (s->>'customers')::bigint into v_direct  from jsonb_array_elements(v->'by_source') s where s->>'source'='direct';

  -- ad = ad-touch + legacy-handle(no touch) = 2; NOT the search/social/organic/
  -- direct/unknown touches (which each carry a click_id but a non-ad entry_source).
  if v_ad <> 2 then raise exception 'S-2 FAIL ad: expected 2 (ad + legacy), got %', v_ad; end if;
  if v_search <> 1 then raise exception 'S-2 FAIL search: expected 1, got %', v_search; end if;
  if v_social <> 1 then raise exception 'S-2 FAIL social: expected 1, got %', v_social; end if;
  -- organic = organic-touch + unknown-touch + pre-capture(no conversion) = 3.
  if v_organic <> 3 then raise exception 'S-2 FAIL organic (catch-all): expected 3, got %', v_organic; end if;
  if v_direct <> 1 then raise exception 'S-2 FAIL direct: expected 1, got %', v_direct; end if;

  -- per-source GBP value.
  if (SELECT (s->'value_cents'->>'GBP')::bigint FROM jsonb_array_elements(v->'by_source') s WHERE s->>'source'='ad') <> 5700 then
    raise exception 'S-2 FAIL ad value: expected 5700 (5000+700)';
  end if;
  if (SELECT (s->'value_cents'->>'GBP')::bigint FROM jsonb_array_elements(v->'by_source') s WHERE s->>'source'='organic') <> 2000 then
    raise exception 'S-2 FAIL organic value: expected 2000 (1000+400+600)';
  end if;

  -- by_platform (the ad slice) byte-stable: meta 1 (5000), tiktok 1 (700).
  select (p->>'customers')::bigint into v_meta   from jsonb_array_elements(v->'by_platform') p where p->>'platform'='meta';
  select (p->>'customers')::bigint into v_tiktok from jsonb_array_elements(v->'by_platform') p where p->>'platform'='tiktok';
  if v_meta is distinct from 1 or v_tiktok is distinct from 1 then
    raise exception 'S-2 FAIL by_platform: expected meta 1 + tiktok 1, got % / %', v_meta, v_tiktok;
  end if;

  -- S-3 INVARIANT: PR-2 only SUBDIVIDES. ad + search + social + organic + direct
  -- distinct-customers == 8 == the honest total (all buyers distinct, no overlap),
  -- == what PR-1 called ad(7)+organic(1).
  if (v_ad + v_search + v_social + v_organic + v_direct) <> 8 then
    raise exception 'S-3 FAIL invariant: source buckets sum to % (expected 8)',
      v_ad + v_search + v_social + v_organic + v_direct;
  end if;

  raise notice 'S-2/S-3 PASS: by_source entry_source split + honest organic catch-all + legacy=ad + invariant';
end $$;

-- ── S-4 · entity_conversion_rollup(E1) — same split at listing scope ───────────
do $$
declare
  v jsonb; v_ad bigint; v_search bigint; v_organic bigint;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0855-4200-8000-000000000a01', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0855-4200-8000-000000000a01','role','authenticated')::text, true);

  v := public.entity_conversion_rollup('00000000-0855-4200-8000-0000000000e1');
  if (v->>'mingla_drove_count')::bigint <> 8 then
    raise exception 'S-4 FAIL E1 count: expected 8, got %', v->>'mingla_drove_count';
  end if;
  select (s->>'customers')::bigint into v_ad      from jsonb_array_elements(v->'by_source') s where s->>'source'='ad';
  select (s->>'customers')::bigint into v_search  from jsonb_array_elements(v->'by_source') s where s->>'source'='search';
  select (s->>'customers')::bigint into v_organic from jsonb_array_elements(v->'by_source') s where s->>'source'='organic';
  if v_ad <> 2 or v_search <> 1 or v_organic <> 3 then
    raise exception 'S-4 FAIL E1 by_source: expected ad 2 / search 1 / organic 3, got % / % / %', v_ad, v_search, v_organic;
  end if;
  raise notice 'S-4 PASS: entity_conversion_rollup by_source split at listing scope';
end $$;

rollback;
