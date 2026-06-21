-- ORCH-1186-B — aggregation-correctness probe for venue_intelligence_overview.
--
-- Hand-run after the 20261117000000_orch_1186b migration is applied:
--   psql "$DATABASE_URL" -f orch_1186b_venue_intelligence_overview.test.sql
-- (or paste into the SQL editor). Self-contained: seeds a throwaway venue +
-- orders inside a transaction, calls the RPC, asserts every bucket, and ALWAYS
-- ROLLS BACK (the final RAISE is the sentinel — no test data survives).
--
-- Covers SPEC §7 T-1..T-7:
--   T-1 timezone-local hour bucketing (NOT raw UTC)
--   T-2 day-of-week, 0=Mon..6=Sun remap
--   T-3 the (dow+6)%7 remap is the fails-on-revert anchor (Sunday must be 6)
--   T-4 per-currency revenue (USD + GBP separate; trend currency = default)
--   T-5 authorization fail-close (non-owner -> 42501)
--   T-6 refunded order excluded from order_count/buckets
--   T-7 partial-refund netted (counted; net = total - refunded)
--
-- fails-on-revert: reverting `AT TIME ZONE v_tz` to raw UTC flips T-1 (h21);
--   reverting `((dow+6)%7)` to raw pg dow flips T-2/T-3 (Sunday -> 0 not 6);
--   reverting per-currency bucketing to a cross-currency SUM flips T-4.

\set ON_ERROR_STOP on

-- ─── Aggregation correctness (T-1/T-2/T-3/T-4/T-6/T-7) ──────────────────────
DO $probe$
DECLARE
  v_acct  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_pp    uuid := gen_random_uuid();
  v_ev    uuid := gen_random_uuid();
  v_res   jsonb;
  v_h21 int; v_h1 int; v_thu int; v_sun int;
  v_rev_usd bigint; v_rev_gbp bigint; v_trend_ccy text; v_count int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (v_acct, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'probe-1186b-'||substr(v_acct::text,1,8)||'@example.com', now(), now());
  INSERT INTO public.creator_accounts (id, created_at) VALUES (v_acct, now());
  INSERT INTO public.place_pool (id, name, lat, lng, created_at)
    VALUES (v_pp, 'Probe PP', 40.7, -74.0, now());
  INSERT INTO public.brands (id, account_id, place_pool_id, default_currency, name, slug, created_at)
    VALUES (v_brand, v_acct, v_pp, 'USD', 'Probe Venue', 'probe-venue-'||substr(v_brand::text,1,8), now());
  -- IANA America/New_York (UTC-4 EDT in May) — drives venue-local bucketing.
  INSERT INTO public.venue_availability_config (id, brand_id, place_pool_id, iana_timezone, created_at)
    VALUES (gen_random_uuid(), v_brand, v_pp, 'America/New_York', now());
  INSERT INTO public.events (id, brand_id, created_by, title, slug, timezone, created_at)
    VALUES (v_ev, v_brand, v_acct, 'Probe Event', 'probe-ev-'||substr(v_ev::text,1,8), 'America/New_York', now());

  -- T-1: UTC 2026-05-01 01:30 -> EDT 2026-04-30 21:30 (Thursday) -> hour 21, weekday Thu=3
  INSERT INTO public.orders (id, event_id, buyer_phone_e164, confirmed_at, created_at, total_cents, refunded_amount_cents, payment_status, currency)
    VALUES (gen_random_uuid(), v_ev, '+15551230001', '2026-05-01T01:30:00Z', '2026-05-01T01:30:00Z', 5000, 0, 'paid', 'USD');
  -- T-2/T-3: UTC 2026-05-04 03:00 -> EDT 2026-05-03 23:00 (Sunday) -> weekday Sun=6
  INSERT INTO public.orders (id, event_id, buyer_phone_e164, confirmed_at, created_at, total_cents, refunded_amount_cents, payment_status, currency)
    VALUES (gen_random_uuid(), v_ev, '+15551230002', '2026-05-04T03:00:00Z', '2026-05-04T03:00:00Z', 1000, 0, 'paid', 'USD');
  -- T-6: refunded -> excluded
  INSERT INTO public.orders (id, event_id, buyer_phone_e164, confirmed_at, created_at, total_cents, refunded_amount_cents, payment_status, currency)
    VALUES (gen_random_uuid(), v_ev, '+15551230003', '2026-05-01T01:30:00Z', '2026-05-01T01:30:00Z', 9999, 0, 'refunded', 'USD');
  -- T-7: partial refund -> counted; net = 8000 - 3000 = 5000
  INSERT INTO public.orders (id, event_id, buyer_phone_e164, confirmed_at, created_at, total_cents, refunded_amount_cents, payment_status, currency)
    VALUES (gen_random_uuid(), v_ev, '+15551230004', '2026-05-05T18:00:00Z', '2026-05-05T18:00:00Z', 8000, 3000, 'partial_refund', 'USD');
  -- T-4: GBP order -> separate currency bucket
  INSERT INTO public.orders (id, event_id, buyer_phone_e164, confirmed_at, created_at, total_cents, refunded_amount_cents, payment_status, currency)
    VALUES (gen_random_uuid(), v_ev, '+15551230005', '2026-05-06T18:00:00Z', '2026-05-06T18:00:00Z', 2000, 0, 'paid', 'GBP');

  -- impersonate the owner
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_acct::text, 'role', 'authenticated')::text, true);

  v_res := public.venue_intelligence_overview(v_brand);

  v_count    := (v_res->>'order_count')::int;
  v_h21      := (SELECT (e->>'orders')::int FROM jsonb_array_elements(v_res->'hours') e WHERE (e->>'hour')::int=21);
  v_h1       := (SELECT (e->>'orders')::int FROM jsonb_array_elements(v_res->'hours') e WHERE (e->>'hour')::int=1);
  v_thu      := (SELECT (e->>'orders')::int FROM jsonb_array_elements(v_res->'days')  e WHERE (e->>'weekday')::int=3);
  v_sun      := (SELECT (e->>'orders')::int FROM jsonb_array_elements(v_res->'days')  e WHERE (e->>'weekday')::int=6);
  v_rev_usd  := (v_res->'revenue_by_currency'->>'USD')::bigint;
  v_rev_gbp  := (v_res->'revenue_by_currency'->>'GBP')::bigint;
  v_trend_ccy:= v_res->'revenue_trend'->>'currency';

  IF v_count <> 4 THEN RAISE EXCEPTION 'T-6 FAIL order_count: expected 4 (refunded excluded), got %', v_count; END IF;
  IF v_h21 <> 1 THEN RAISE EXCEPTION 'T-1 FAIL hour21: expected 1 (EDT local), got %', v_h21; END IF;
  IF v_h1  <> 0 THEN RAISE EXCEPTION 'T-1 FAIL hour1: expected 0 (must NOT bucket in UTC hour), got %', v_h1; END IF;
  IF v_thu <> 1 THEN RAISE EXCEPTION 'T-2 FAIL Thursday(weekday 3): expected 1, got %', v_thu; END IF;
  IF v_sun <> 1 THEN RAISE EXCEPTION 'T-3 FAIL Sunday(weekday 6): expected 1 (remap (dow+6)%%7), got %', v_sun; END IF;
  IF v_rev_usd <> 11000 THEN RAISE EXCEPTION 'T-7 FAIL USD net: expected 11000 (5000+1000+5000), got %', v_rev_usd; END IF;
  IF v_rev_gbp <> 2000 THEN RAISE EXCEPTION 'T-4 FAIL GBP net: expected 2000 (separate bucket), got %', v_rev_gbp; END IF;
  IF v_trend_ccy <> 'USD' THEN RAISE EXCEPTION 'T-4 FAIL trend currency: expected USD (brand default), got %', v_trend_ccy; END IF;
  IF jsonb_array_length(v_res->'hours') <> 24 THEN RAISE EXCEPTION 'FAIL hours length: expected 24, got %', jsonb_array_length(v_res->'hours'); END IF;
  IF jsonb_array_length(v_res->'days')  <> 7  THEN RAISE EXCEPTION 'FAIL days length: expected 7, got %',  jsonb_array_length(v_res->'days'); END IF;

  RAISE NOTICE 'T-1..T-7 aggregation PASS (count=% h21=% Thu=% Sun=% USD=% GBP=% trend=%)',
    v_count, v_h21, v_thu, v_sun, v_rev_usd, v_rev_gbp, v_trend_ccy;

  -- ALWAYS rollback — sentinel exception leaves no seeded data behind.
  RAISE EXCEPTION 'ROLLBACK_PROBE_OK_1186B';
EXCEPTION
  WHEN sqlstate 'P0001' THEN
    IF SQLERRM = 'ROLLBACK_PROBE_OK_1186B' THEN
      RAISE NOTICE 'ORCH-1186B aggregation probe: ALL PASS (rolled back cleanly)';
    ELSE
      RAISE;  -- a real assertion failure
    END IF;
END
$probe$;

-- ─── T-5: authorization fail-close (non-owner -> 42501) ─────────────────────
DO $authz$
DECLARE
  v_other uuid := gen_random_uuid();
  v_brand uuid;
BEGIN
  SELECT id INTO v_brand FROM public.brands WHERE deleted_at IS NULL LIMIT 1;
  IF v_brand IS NULL THEN
    RAISE NOTICE 'T-5 SKIP: no brand present to probe authorization';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.venue_intelligence_overview(v_brand);
    RAISE EXCEPTION 'T-5 FAIL: non-owner was allowed to read brand %', v_brand;
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE 'T-5 PASS: non-owner rejected with 42501';
  END;
END
$authz$;
