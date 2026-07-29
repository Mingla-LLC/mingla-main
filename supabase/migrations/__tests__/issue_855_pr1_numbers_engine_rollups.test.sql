-- ISSUE-855 PR1 — SQL contract + aggregation suite for the numbers-engine rollups
-- (migration 20270120000855_issue_855_pr1_numbers_engine_rollups.sql).
--
-- Run (LOCAL Postgres only — NEVER remote), AFTER applying ALL migrations in
-- ls|sort order (mirrors .github/workflows/supabase-migrations-and-stripe-deno.yml):
--   psql "$DATABASE_URL" -f issue_855_pr1_numbers_engine_rollups.test.sql
-- Whole script runs in ONE transaction and ROLLS BACK — no residue. (Hand-run
-- probe, same convention as issue_865_pr1_rollup_rls.test.sql + the venue
-- intelligence probe; CI's migration step does not glob __tests__/.)
--
-- Covers:
--   T-1  the 4 RPCs exist + are SECURITY DEFINER (they bypass RLS → MUST self-auth).
--   T-2  anon holds NO EXECUTE (ORCH-1392 gate); authenticated holds EXECUTE.
--   T-3  UNAUTHORIZED (a non-member caller) → authorized:false + zero/empty shape,
--        NEVER another brand's numbers, even though the brand HAS data (no leak);
--        NULL arg → NULL.
--   T-4  AUTHORIZED owner aggregation: honest spine union counts, DISTINCT-customer
--        (a repeat buyer counts once), per-currency value NEVER cross-summed
--        (GBP + NGN separate), ad-vs-organic by_source + by_platform, free-RSVP
--        count-only (£0), reservation covers/no-show/by-source, and masked regulars
--        (repeat-across-listings surfaces; single-listing does not; NO raw PII).
--
-- fails-on-revert anchors:
--   · drop the internal `v_authorized` gate → T-3 leaks (authorized flips / counts>0).
--   · count transactions instead of DISTINCT customer_key → T-4 mingla_drove flips
--     (alice's 2 orders would double-count).
--   · cross-sum currencies → T-4 GBP/NGN merge (value_cents_lifetime wrong).
--   · return raw email in regulars → T-4 "no raw PII" assertion fires.

\set ON_ERROR_STOP on
begin;

-- ── T-1 · the 4 RPCs exist + are SECURITY DEFINER + take one uuid arg ──────────
do $$
declare
  pname text;
begin
  foreach pname in array array[
    'brand_mingla_drove_rollup','entity_conversion_rollup',
    'reservation_metrics_rollup','brand_regulars_rollup'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = pname and p.prosecdef
        and pg_get_function_arguments(p.oid) like '%uuid'
    ) then
      raise exception 'T-1 FAIL: % missing, not SECURITY DEFINER, or wrong signature', pname;
    end if;
  end loop;
end $$;

-- ── T-2 · anon must NOT hold EXECUTE; authenticated MUST ──────────────────────
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.brand_mingla_drove_rollup(uuid)',
    'public.entity_conversion_rollup(uuid)',
    'public.reservation_metrics_rollup(uuid)',
    'public.brand_regulars_rollup(uuid)'
  ] loop
    if has_function_privilege('anon', sig, 'EXECUTE') then
      raise exception 'T-2 FAIL: anon can EXECUTE % (SECURITY DEFINER anon leak)', sig;
    end if;
    if not has_function_privilege('authenticated', sig, 'EXECUTE') then
      raise exception 'T-2 FAIL: authenticated cannot EXECUTE %', sig;
    end if;
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- Seed a throwaway brand + owner + listings + orders/reservations/rsvps + one
-- ad-driven conversion. Fixed UUIDs so every assertion block references the same
-- rows. Everything rolls back at the end of the txn.
-- ══════════════════════════════════════════════════════════════════════════════
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0855-4000-8000-000000000a01','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','probe-855-owner@example.com', now(), now());
insert into public.creator_accounts (id, created_at)
  values ('00000000-0855-4000-8000-000000000a01', now());
insert into public.place_pool (id, name, lat, lng, created_at)
  values ('00000000-0855-4000-8000-000000000c01','Probe PP 855', 40.7, -74.0, now());
insert into public.brands (id, account_id, place_pool_id, default_currency, name, slug, created_at)
  values ('00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000a01',
          '00000000-0855-4000-8000-000000000c01','GBP','Probe Brand 855','probe-brand-855-'||substr(md5(random()::text),1,8), now());
insert into public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category)
  values ('00000000-0855-4000-8000-000000000d01','00000000-0855-4000-8000-000000000b01',
          'probevl855'||substr(md5(random()::text),1,8),'Probe VL 855', 40.7, -74.0, 'restaurant');
insert into public.events (id, brand_id, created_by, title, slug, timezone, event_type, created_at) values
  ('00000000-0855-4000-8000-0000000000e1','00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000a01','E1','probe-e1-855-'||substr(md5(random()::text),1,8),'UTC','event', now()),
  ('00000000-0855-4000-8000-0000000000e3','00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000a01','E3','probe-e3-855-'||substr(md5(random()::text),1,8),'UTC','event', now()),
  ('00000000-0855-4000-8000-0000000000e2','00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000a01','E2','probe-e2-855-'||substr(md5(random()::text),1,8),'UTC','rsvp', now());

-- Orders (all on E1 unless noted). alice buys twice (O1 GBP ad, O3 NGN organic)
-- + once more on E3 (O6) → distinct-customer + regular fixture.
insert into public.orders (id, event_id, buyer_email, buyer_phone_e164, confirmed_at, created_at, total_cents, refunded_amount_cents, payment_status, currency, source) values
  ('00000000-0855-4000-8000-0000000000f1','00000000-0855-4000-8000-0000000000e1','alice@x.com','+15551230001', now(), now(), 5000, 0,'paid','GBP','online_checkout'), -- O1 ad
  (gen_random_uuid(),                     '00000000-0855-4000-8000-0000000000e1','bob@x.com',  '+15551230002', now(), now(), 3000, 0,'paid','GBP','online_checkout'), -- O2 organic
  (gen_random_uuid(),                     '00000000-0855-4000-8000-0000000000e1','alice@x.com','+15551230001', now(), now(), 900000,0,'paid','NGN','online_checkout'), -- O3 alice NGN organic
  (gen_random_uuid(),                     '00000000-0855-4000-8000-0000000000e1','carol@x.com','+15551230003', now(), now(), 2000, 0,'refunded','GBP','online_checkout'), -- O4 excluded (refunded)
  (gen_random_uuid(),                     '00000000-0855-4000-8000-0000000000e1','dave@x.com',  NULL,          now(), now(), 1000, 0,'paid','GBP','door_sale'),      -- O5 excluded (source)
  (gen_random_uuid(),                     '00000000-0855-4000-8000-0000000000e3','alice@x.com','+15551230001', now(), now(), 2000, 0,'paid','GBP','online_checkout'); -- O6 alice on E3

-- One ad-driven conversion for O1 (carries click_id → resolvable ad).
insert into public.ad_conversions (order_id, click_id, platform, event_type, event_name, surface, event_id, currency, value_cents)
  values ('00000000-0855-4000-8000-0000000000f1','ck-o1-855','meta','purchase','Purchase','web','conv-855-o1','GBP', 5000);

-- Reservations (venue_id NOT NULL → the seeded venue_listing). R3 cancelled +
-- R5 phone-source exercise the exclusions.
insert into public.reservations (id, brand_id, venue_id, reserved_for, party_size, status, source, guest_email, guest_phone_e164, fee_cents, fee_currency, payment_status, created_at) values
  (gen_random_uuid(),'00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000d01', now(), 4,'completed','mingla','eve@x.com',  '+15551230010', 1500,'GBP','paid', now()), -- R1 paid
  (gen_random_uuid(),'00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000d01', now(), 2,'no_show',  'mingla','frank@x.com','+15551230011', NULL, NULL,'none', now()), -- R2 no_show
  (gen_random_uuid(),'00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000d01', now(), 3,'cancelled_by_guest','mingla','grace@x.com','+15551230012', NULL, NULL,'none', now()), -- R3 excluded
  (gen_random_uuid(),'00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000d01', now(), 5,'seated',   'mingla','heidi@x.com','+15551230013', NULL, NULL,'none', now()), -- R4 seated
  (gen_random_uuid(),'00000000-0855-4000-8000-000000000b01','00000000-0855-4000-8000-000000000d01', now(), 2,'completed','phone', 'ivan@x.com', '+15551230014', NULL, NULL,'none', now()); -- R5 phone (not mingla)

-- RSVP guests on E2 (going+approved count; not_going excluded).
insert into public.event_rsvps (event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status) values
  ('00000000-0855-4000-8000-0000000000e2','Judy','judy@x.com','+15551230020','going','approved'),      -- V1
  ('00000000-0855-4000-8000-0000000000e2','Ken', 'ken@x.com', '+15551230021','going','approved'),      -- V2
  ('00000000-0855-4000-8000-0000000000e2','Laura','laura@x.com','+15551230022','not_going','approved'); -- V3 excluded

-- ── T-3 · UNAUTHORIZED (non-member) → honest-empty, no leak; NULL → NULL ───────
do $$
declare
  v jsonb;
begin
  -- Impersonate a random authenticated user who is NOT a member of the brand.
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);

  v := public.brand_mingla_drove_rollup('00000000-0855-4000-8000-000000000b01');
  if (v->>'authorized')::boolean is distinct from false then
    raise exception 'T-3 FAIL: brand_mingla_drove_rollup leaked to non-member: %', v;
  end if;
  if (v->>'mingla_drove_lifetime')::bigint <> 0 or (v->>'mingla_drove_30d')::bigint <> 0 then
    raise exception 'T-3 FAIL: brand_mingla_drove_rollup leaked counts: %', v;
  end if;
  if not (v ? 'value_cents_30d' and v ? 'value_cents_lifetime' and v ? 'by_source' and v ? 'by_platform') then
    raise exception 'T-3 FAIL: brand_mingla_drove_rollup shape missing keys: %', v;
  end if;

  v := public.entity_conversion_rollup('00000000-0855-4000-8000-0000000000e1');
  if (v->>'authorized')::boolean is distinct from false or (v->>'mingla_drove_count')::bigint <> 0 then
    raise exception 'T-3 FAIL: entity_conversion_rollup leaked: %', v;
  end if;

  v := public.reservation_metrics_rollup('00000000-0855-4000-8000-000000000b01');
  if (v->>'authorized')::boolean is distinct from false or (v->>'covers_lifetime')::bigint <> 0 then
    raise exception 'T-3 FAIL: reservation_metrics_rollup leaked: %', v;
  end if;

  v := public.brand_regulars_rollup('00000000-0855-4000-8000-000000000b01');
  if (v->>'authorized')::boolean is distinct from false or (v->>'regulars_count')::bigint <> 0 then
    raise exception 'T-3 FAIL: brand_regulars_rollup leaked: %', v;
  end if;
  if position('alice@x.com' in v::text) <> 0 then
    raise exception 'T-3 FAIL: brand_regulars_rollup leaked raw PII to non-member: %', v;
  end if;

  -- NULL arg → NULL (no crash) for all four.
  if public.brand_mingla_drove_rollup(NULL) is not null
     or public.entity_conversion_rollup(NULL) is not null
     or public.reservation_metrics_rollup(NULL) is not null
     or public.brand_regulars_rollup(NULL) is not null then
    raise exception 'T-3 FAIL: NULL arg should return NULL for all rollups';
  end if;

  raise notice 'T-3 PASS: unauthorized honest-empty + no leak + NULL->NULL';
end $$;

-- ── T-4 · AUTHORIZED owner aggregation ────────────────────────────────────────
do $$
declare
  v      jsonb;
  v_ad_cust      bigint;
  v_org_cust     bigint;
  v_meta_cust    bigint;
  v_mingla_resv  int;
  v_mingla_cov   bigint;
  v_phone_resv   int;
  v_phone_cov    bigint;
begin
  -- Impersonate the brand owner.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0855-4000-8000-000000000a01','role','authenticated')::text, true);

  -- ── 4a · brand_mingla_drove_rollup ─────────────────────────────────────────
  v := public.brand_mingla_drove_rollup('00000000-0855-4000-8000-000000000b01');
  if (v->>'authorized')::boolean is distinct from true then
    raise exception 'T-4a FAIL: owner not authorized: %', v;
  end if;
  -- distinct customers: alice,bob,eve,frank,heidi,judy,ken = 7 (alice's 3 orders count once).
  if (v->>'mingla_drove_lifetime')::bigint <> 7 then
    raise exception 'T-4a FAIL distinct customers: expected 7, got % (%)', v->>'mingla_drove_lifetime', v;
  end if;
  -- per-currency value NEVER cross-summed: GBP=5000+3000+2000+1500=11500, NGN=900000.
  if (v->'value_cents_lifetime'->>'GBP')::bigint <> 11500 then
    raise exception 'T-4a FAIL GBP value: expected 11500, got %', v->'value_cents_lifetime'->>'GBP';
  end if;
  if (v->'value_cents_lifetime'->>'NGN')::bigint <> 900000 then
    raise exception 'T-4a FAIL NGN value: expected 900000 (separate bucket), got %', v->'value_cents_lifetime'->>'NGN';
  end if;
  -- ad-vs-organic: ad={alice}=1, organic={alice,bob,eve,frank,heidi,judy,ken}=7 (overlap on alice).
  select (s->>'customers')::bigint into v_ad_cust  from jsonb_array_elements(v->'by_source') s where s->>'source'='ad';
  select (s->>'customers')::bigint into v_org_cust from jsonb_array_elements(v->'by_source') s where s->>'source'='organic';
  if v_ad_cust <> 1 then raise exception 'T-4a FAIL ad customers: expected 1, got %', v_ad_cust; end if;
  if v_org_cust <> 7 then raise exception 'T-4a FAIL organic customers: expected 7, got %', v_org_cust; end if;
  -- by_platform ad slice: meta customers=1, value GBP 5000.
  select (p->>'customers')::bigint into v_meta_cust from jsonb_array_elements(v->'by_platform') p where p->>'platform'='meta';
  if v_meta_cust is distinct from 1 then raise exception 'T-4a FAIL meta by_platform customers: expected 1, got %', v_meta_cust; end if;
  if (SELECT (p->'value_cents'->>'GBP')::bigint FROM jsonb_array_elements(v->'by_platform') p WHERE p->>'platform'='meta') <> 5000 then
    raise exception 'T-4a FAIL meta by_platform value GBP: expected 5000';
  end if;

  -- ── 4b · entity_conversion_rollup(E1) — per-listing scope ──────────────────
  v := public.entity_conversion_rollup('00000000-0855-4000-8000-0000000000e1');
  if (v->>'mingla_drove_count')::bigint <> 2 then
    raise exception 'T-4b FAIL E1 count: expected 2 (alice,bob), got %', v->>'mingla_drove_count';
  end if;
  if (v->'value_cents'->>'GBP')::bigint <> 8000 or (v->'value_cents'->>'NGN')::bigint <> 900000 then
    raise exception 'T-4b FAIL E1 value: expected GBP 8000 + NGN 900000, got %', v->'value_cents';
  end if;
  select (s->>'customers')::bigint into v_ad_cust from jsonb_array_elements(v->'by_source') s where s->>'source'='ad';
  if v_ad_cust <> 1 then raise exception 'T-4b FAIL E1 ad customers: expected 1, got %', v_ad_cust; end if;

  -- ── 4c · entity_conversion_rollup(E2) — free RSVP count-only (£0) ───────────
  v := public.entity_conversion_rollup('00000000-0855-4000-8000-0000000000e2');
  if (v->>'mingla_drove_count')::bigint <> 2 then
    raise exception 'T-4c FAIL E2 rsvp count: expected 2 (judy,ken), got %', v->>'mingla_drove_count';
  end if;
  if v->'value_cents' <> '{}'::jsonb then
    raise exception 'T-4c FAIL E2 rsvp value: expected {} (free, £0), got %', v->'value_cents';
  end if;

  -- ── 4d · reservation_metrics_rollup ────────────────────────────────────────
  v := public.reservation_metrics_rollup('00000000-0855-4000-8000-000000000b01');
  -- covers = SUM(party_size) seated/completed = R1(4)+R4(5)+R5(2) = 11.
  if (v->>'covers_lifetime')::bigint <> 11 then
    raise exception 'T-4d FAIL covers_lifetime: expected 11, got %', v->>'covers_lifetime';
  end if;
  if (v->>'covers_30d')::bigint <> 11 then
    raise exception 'T-4d FAIL covers_30d: expected 11, got %', v->>'covers_30d';
  end if;
  -- avg_party_size over non-cancelled (R1,R2,R4,R5) = 13/4 = 3.25.
  if (v->>'avg_party_size')::numeric <> 3.25 then
    raise exception 'T-4d FAIL avg_party_size: expected 3.25, got %', v->>'avg_party_size';
  end if;
  -- no_show_rate = 1 / (seated+completed+no_show = 4) = 0.25.
  if (v->>'no_show_rate')::numeric <> 0.25 then
    raise exception 'T-4d FAIL no_show_rate: expected 0.25, got %', v->>'no_show_rate';
  end if;
  -- paid-fee value: only R1 (1500 GBP).
  if (v->'value_cents_lifetime'->>'GBP')::bigint <> 1500 then
    raise exception 'T-4d FAIL reservation value GBP: expected 1500, got %', v->'value_cents_lifetime'->>'GBP';
  end if;
  -- by_source native: mingla (R1,R2,R4 = 3 resv, covers 9) + phone (R5 = 1 resv, covers 2).
  select (s->>'reservations')::int, (s->>'covers')::bigint into v_mingla_resv, v_mingla_cov
    from jsonb_array_elements(v->'by_source') s where s->>'source'='mingla';
  select (s->>'reservations')::int, (s->>'covers')::bigint into v_phone_resv, v_phone_cov
    from jsonb_array_elements(v->'by_source') s where s->>'source'='phone';
  if v_mingla_resv <> 3 or v_mingla_cov <> 9 then
    raise exception 'T-4d FAIL by_source mingla: expected 3 resv / 9 covers, got % / %', v_mingla_resv, v_mingla_cov;
  end if;
  if v_phone_resv <> 1 or v_phone_cov <> 2 then
    raise exception 'T-4d FAIL by_source phone: expected 1 resv / 2 covers, got % / %', v_phone_resv, v_phone_cov;
  end if;

  -- ── 4e · brand_regulars_rollup — repeat-across-listings + mask + no PII ─────
  v := public.brand_regulars_rollup('00000000-0855-4000-8000-000000000b01');
  -- only alice has >1 distinct listing (event:E1 + event:E3); others 1 each.
  if (v->>'regulars_count')::bigint <> 1 then
    raise exception 'T-4e FAIL regulars_count: expected 1 (alice), got % (%)', v->>'regulars_count', v;
  end if;
  if jsonb_array_length(v->'top_regulars') <> 1 then
    raise exception 'T-4e FAIL top_regulars length: expected 1, got %', jsonb_array_length(v->'top_regulars');
  end if;
  if (v->'top_regulars'->0->>'masked_contact') <> 'a***@x***.com' then
    raise exception 'T-4e FAIL masked_contact: expected a***@x***.com, got %', v->'top_regulars'->0->>'masked_contact';
  end if;
  if (v->'top_regulars'->0->>'listings')::bigint <> 2 or (v->'top_regulars'->0->>'visits')::bigint <> 3 then
    raise exception 'T-4e FAIL alice listings/visits: expected 2/3, got %/%',
      v->'top_regulars'->0->>'listings', v->'top_regulars'->0->>'visits';
  end if;
  -- per-currency lifetime value: GBP=5000(O1)+2000(O6)=7000, NGN=900000(O3).
  if (v->'top_regulars'->0->'lifetime_value_cents'->>'GBP')::bigint <> 7000
     or (v->'top_regulars'->0->'lifetime_value_cents'->>'NGN')::bigint <> 900000 then
    raise exception 'T-4e FAIL alice lifetime value: expected GBP 7000 + NGN 900000, got %',
      v->'top_regulars'->0->'lifetime_value_cents';
  end if;
  -- PRIVACY: NO raw email/phone anywhere in the payload.
  if position('alice@x.com' in v::text) <> 0 or position('+1555123' in v::text) <> 0 then
    raise exception 'T-4e FAIL: raw PII present in regulars payload: %', v;
  end if;

  raise notice 'T-4 PASS: aggregation, distinct-customer, per-currency, ad/organic, covers, masked regulars';
end $$;

rollback;
