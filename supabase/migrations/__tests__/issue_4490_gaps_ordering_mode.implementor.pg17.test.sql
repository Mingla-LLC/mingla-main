-- #4490 gap list 07-D (20281203264490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-ORDER-MODE-DERIVED | issue #4490 | a venue's ordering mode is derived from venue_ordering_settings.table_service_enabled and counter_pickup_enabled (table, counter or both) and at least one of them is always on; only managers of the venue's brand (event manager and up, finance managers, venue.manage_offers staff) may change it.
--
-- D-1 the CHECK refuses both switches off.  D-2 set_mode writes both switches.
-- D-3 an outsider and anon are refused.  D-4 the public state returns table_service_enabled + order_mode.
-- D-5 a bad mode is refused.
--
-- FAILS-ON-REVERT (seen 19 Nov): before 20281203264490 biz_venue_ordering_set_mode does not exist and D-2 fails.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '44902700-0000-4000-8000-000000000001';
  v_outsider uuid := '44902700-0000-4000-8000-000000000005';
  v_brand uuid := '44902700-0000-4000-9000-000000000010';
  v_venue uuid := '44902700-0000-4000-9000-0000000000a1';
  v_code text;
  v_state jsonb;
  v_failed boolean;
  v_row record;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'order-mode-4490@example.test'), (v_outsider, 'order-mode-out-4490@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'order-mode-4490@example.test'), (v_outsider, 'order-mode-out-4490@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Order mode 4490', 'order-mode-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
    VALUES (v_venue, v_brand, 'ordermode4490', 'Palm Order', 6.45, 3.41, 'play', 'verified', 'NG');
  INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled) VALUES (v_venue, v_brand, true);
  INSERT INTO public.qr_spots (brand_id, venue_id, serving_venue_id, label, kind, is_active)
    VALUES (v_brand, v_venue, v_venue, 'Bar rail', 'custom', true) RETURNING code INTO v_code;

  -- D-1 both off is refused by the CHECK
  v_failed := false;
  BEGIN
    UPDATE public.venue_ordering_settings SET table_service_enabled = false, counter_pickup_enabled = false WHERE venue_id = v_venue;
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'D-1 FAIL: both switches off was accepted'; END IF;
  RAISE NOTICE 'PASS  D-1 at least one way to get an order is always on';

  -- D-2 the owner sets each mode
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM public.biz_venue_ordering_set_mode(v_venue, 'counter');
  SELECT table_service_enabled, counter_pickup_enabled INTO v_row FROM public.venue_ordering_settings WHERE venue_id = v_venue;
  IF v_row.table_service_enabled OR NOT v_row.counter_pickup_enabled THEN RAISE EXCEPTION 'D-2 FAIL: counter = %', row_to_json(v_row); END IF;
  PERFORM public.biz_venue_ordering_set_mode(v_venue, 'table');
  SELECT table_service_enabled, counter_pickup_enabled INTO v_row FROM public.venue_ordering_settings WHERE venue_id = v_venue;
  IF NOT v_row.table_service_enabled OR v_row.counter_pickup_enabled THEN RAISE EXCEPTION 'D-2 FAIL: table = %', row_to_json(v_row); END IF;
  PERFORM public.biz_venue_ordering_set_mode(v_venue, 'both');
  SELECT table_service_enabled, counter_pickup_enabled INTO v_row FROM public.venue_ordering_settings WHERE venue_id = v_venue;
  IF NOT (v_row.table_service_enabled AND v_row.counter_pickup_enabled) THEN RAISE EXCEPTION 'D-2 FAIL: both = %', row_to_json(v_row); END IF;
  RAISE NOTICE 'PASS  D-2 set_mode writes table / counter / both';

  -- D-5 a bad mode
  v_failed := false;
  BEGIN PERFORM public.biz_venue_ordering_set_mode(v_venue, 'delivery');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'order_mode_invalid';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'D-5 FAIL: a bad mode was accepted'; END IF;
  RAISE NOTICE 'PASS  D-5 a bad mode is refused';

  -- D-3 outsider refused
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM public.biz_venue_ordering_set_mode(v_venue, 'counter');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'D-3 FAIL: an outsider changed the mode'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  v_failed := false;
  BEGIN PERFORM public.biz_venue_ordering_set_mode(v_venue, 'counter');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'not_authorized';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'D-3 FAIL: anon changed the mode'; END IF;
  IF NOT has_function_privilege('anon', 'public.biz_venue_ordering_set_mode(uuid,text)', 'EXECUTE') IS FALSE THEN
    RAISE EXCEPTION 'D-3 FAIL: anon may execute set_mode';
  END IF;
  RAISE NOTICE 'PASS  D-3 outsider and anon are refused';

  -- D-4 public state
  v_state := public.pg_public_venue_ordering_state('order-mode-4490', 'ordermode4490', v_code);
  IF v_state->>'order_mode' <> 'both' OR (v_state->>'table_service_enabled')::boolean IS NOT TRUE
     OR v_state->>'spot_state' <> 'ok' THEN
    RAISE EXCEPTION 'D-4 FAIL: both state %', v_state;
  END IF;
  UPDATE public.venue_ordering_settings SET table_service_enabled = false WHERE venue_id = v_venue;
  v_state := public.pg_public_venue_ordering_state('order-mode-4490', 'ordermode4490', NULL);
  IF v_state->>'order_mode' <> 'counter' OR (v_state->>'table_service_enabled')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D-4 FAIL: counter state %', v_state;
  END IF;
  UPDATE public.venue_ordering_settings SET table_service_enabled = true, counter_pickup_enabled = false WHERE venue_id = v_venue;
  v_state := public.pg_public_venue_ordering_state('order-mode-4490', 'ordermode4490', NULL);
  IF v_state->>'order_mode' <> 'table' THEN RAISE EXCEPTION 'D-4 FAIL: table state %', v_state; END IF;
  RAISE NOTICE 'PASS  D-4 public state returns table_service_enabled and order_mode';
END
$test$;

ROLLBACK;
\echo 'issue #4490 07-D: all cases passed'
