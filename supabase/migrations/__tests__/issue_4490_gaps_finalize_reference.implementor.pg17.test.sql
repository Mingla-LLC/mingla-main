-- #4490 07 retest 3, N147 (20281203294490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-FINALIZE-OWN-REFERENCE | issue #4490 | pg_venue_order_finalize_payment pays an order only on provider evidence that belongs to it: a Paystack reference equal to the order's paystack_reference (a Stripe payment intent equal to the recorded one); anything else returns reference_mismatch and writes nothing.
--
-- F-1 another order's reference is refused and nothing changes.  F-2 a missing reference is refused.
-- F-3 the order's own reference pays it once; a replay says replayed.
--
-- FAILS-ON-REVERT (seen 20 Nov): with the 1790 body, F-1 returns finalized (the order is paid on a foreign reference).
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user uuid := '44903000-0000-4000-8000-000000000001';
  v_brand uuid := '44903000-0000-4000-9000-000000000010';
  v_venue uuid := '44903000-0000-4000-9000-0000000000a1';
  v_session uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  r jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'finalize-ref-4490@example.com');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_user, 'finalize-ref-4490@example.com');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_user, 'Finalize ref 4490', 'finalize-ref-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
    VALUES (v_venue, v_brand, 'finalizeref4490', 'Finalize Grill', 6.45, 3.41, 'play', 'verified', 'NG');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency) VALUES (v_session, v_brand, v_venue, 'NGN');
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, paystack_reference, pickup_code, idempotency_key)
  SELECT id, v_session, v_brand, v_venue, 'guest_page', 'Ada', 'ada@example.com', '+2348030000000',
    'mingla', 'NGN', 2800000, 0, 0, 0, 0, 0, 0, 0, true, true, false, 2800000, 0, 2800000,
    'paystack', 'pending', ref, code, 'idem:' || id::text
  FROM (VALUES (v_a, 'mingla_vo_a_ref', '41'), (v_b, 'mingla_vo_b_ref', '42')) AS x(id, ref, code);
  SET LOCAL session_replication_role = origin;

  -- F-1 order A finalized with order B's reference: refused, unchanged
  r := public.pg_venue_order_finalize_payment(v_a, 'paystack', 2800000, 'NGN', 'mingla_vo_b_ref', NULL, NULL, NULL);
  IF r->>'status' <> 'reference_mismatch' OR (SELECT payment_status FROM public.venue_orders WHERE id = v_a) <> 'pending' THEN
    RAISE EXCEPTION 'F-1 FAIL: a foreign reference was accepted %', r;
  END IF;
  RAISE NOTICE 'PASS  F-1 another order''s reference is refused and nothing changes';

  -- F-2 no reference
  r := public.pg_venue_order_finalize_payment(v_a, 'paystack', 2800000, 'NGN', NULL, NULL, NULL, NULL);
  IF r->>'status' <> 'reference_mismatch' THEN RAISE EXCEPTION 'F-2 FAIL: %', r; END IF;
  RAISE NOTICE 'PASS  F-2 a missing reference is refused';

  -- F-3 own reference pays once; replay
  r := public.pg_venue_order_finalize_payment(v_a, 'paystack', 2800000, 'NGN', 'mingla_vo_a_ref', NULL, NULL, NULL);
  IF r->>'status' <> 'finalized' OR (SELECT payment_status FROM public.venue_orders WHERE id = v_a) <> 'paid' THEN
    RAISE EXCEPTION 'F-3 FAIL: own reference %', r;
  END IF;
  r := public.pg_venue_order_finalize_payment(v_a, 'paystack', 2800000, 'NGN', 'mingla_vo_a_ref', NULL, NULL, NULL);
  IF r->>'status' <> 'replayed' THEN RAISE EXCEPTION 'F-3 FAIL: replay %', r; END IF;
  IF (SELECT payment_status FROM public.venue_orders WHERE id = v_b) <> 'pending' THEN RAISE EXCEPTION 'F-3 FAIL: B changed'; END IF;
  RAISE NOTICE 'PASS  F-3 the order''s own reference pays it once; a replay says replayed';
END
$test$;

ROLLBACK;
\echo 'issue #4490 N147: all cases passed'
