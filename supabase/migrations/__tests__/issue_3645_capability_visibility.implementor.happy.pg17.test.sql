-- Issue #3645 / #4040 — trip payment plan capability and the publish belt (PG17).
--
-- Proves:
--   1. pg_trip_installments_supported: stripe → true, paystack → the switch
--      (false today), other/unknown → false.
--   2. #4040: with the switch OFF, a scheduled PUBLIC Paystack trip with a saved
--      plan can be set to hidden through admin_set_offering_visibility (the exact
--      production transition); hidden→public, private→public and
--      draft→scheduled(public) stay refused.
--   3. With the switch ON every one of those transitions succeeds.
--   4. biz_trip_installments_supported_for_brand answers the same rule for a
--      member and false for a non-member.

BEGIN;

CREATE FUNCTION pg_temp.i3645_switch(p_on boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_on THEN
    CREATE OR REPLACE FUNCTION public.issue_3645_paystack_installments_enabled()
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    AS $on$ SELECT true $on$;
  ELSE
    CREATE OR REPLACE FUNCTION public.issue_3645_paystack_installments_enabled()
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    AS $off$ SELECT false $off$;
  END IF;
END $f$;

-- A Paystack trip with a saved plan (authored while supported, as in production).
CREATE FUNCTION pg_temp.i3645_trip(p_tag text, p_status text, p_visibility text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'cap-' || p_tag || '-' || v_owner || '@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'cap-' || p_tag || '-' || v_owner || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, pricing_currency)
  VALUES (v_brand, v_owner, 'Cap ' || p_tag, 'issue-3645-cap-' || p_tag || '-' || v_brand, 'USD', 'stripe', 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, charges_enabled, payouts_enabled,
    country, default_currency)
  VALUES (v_brand, 'acct_i3645cap_' || replace(v_brand::text, '-', ''), true, true, 'US', 'usd');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_event, v_brand, v_owner, 'Cap trip', 'issue-3645-cap-trip-' || v_event, 'trip', 'draft', 'public', 'UTC', 'USD');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, '2030-01-10T10:00:00Z', '2030-01-12T18:00:00Z', 'UTC', true);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person)
  VALUES (v_tt, v_event, 'Standard', 100000, 'USD', false, 20, 1, true, false);
  INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
  VALUES (v_event, v_tt, 'Standard', jsonb_build_object('installments', jsonb_build_object(
    'deposit_pct', 25, 'installments', jsonb_build_array(jsonb_build_object('ordinal', 1, 'pct', 75,
      'days_after_booking', 30)))));
  UPDATE public.events SET status = p_status, visibility = p_visibility WHERE id = v_event;
  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = v_brand;
  RETURN jsonb_build_object('owner', v_owner, 'brand', v_brand, 'event', v_event);
END $f$;

CREATE FUNCTION pg_temp.i3645_refused(p_event uuid, p_status text, p_visibility text) RETURNS boolean
LANGUAGE plpgsql AS $f$
DECLARE v_msg text;
BEGIN
  UPDATE public.events SET status = p_status, visibility = p_visibility WHERE id = p_event;
  RETURN false;
EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  IF v_msg <> 'installment_capability_unavailable' THEN RAISE; END IF;
  RETURN true;
END $f$;

DO $test$
DECLARE
  a jsonb := pg_temp.i3645_trip('a', 'scheduled', 'public');
  b jsonb := pg_temp.i3645_trip('b', 'scheduled', 'hidden');
  c jsonb := pg_temp.i3645_trip('c', 'scheduled', 'private');
  d jsonb := pg_temp.i3645_trip('d', 'draft', 'public');
  v_admin uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  r jsonb;
BEGIN
  -- 1. Capability matrix.
  IF public.pg_trip_installments_supported((a->>'event')::uuid) IS NOT FALSE THEN
    RAISE EXCEPTION 'cap_1_paystack_must_follow_switch_off';
  END IF;
  UPDATE public.brands SET payment_provider = 'stripe' WHERE id = (a->>'brand')::uuid;
  IF public.pg_trip_installments_supported((a->>'event')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'cap_1_stripe_true';
  END IF;
  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = (a->>'brand')::uuid;
  IF public.pg_trip_installments_supported(gen_random_uuid()) IS NOT FALSE
     OR public.pg_trip_installments_supported(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'cap_1_unknown_false';
  END IF;

  -- 2. #4040 exact production transition via the Admin RPC.
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645-cap@example.test');
  INSERT INTO public.admin_users(email, status) VALUES ('admin-3645-cap@example.test', 'active');
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  r := public.admin_set_offering_visibility((a->>'event')::uuid, 'hidden', 'Hide the cancelled demo trip');
  IF r->>'visibility' <> 'hidden' THEN RAISE EXCEPTION 'cap_2_hide_failed_%', r; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  -- Leaving public for draft / private also allowed.
  IF pg_temp.i3645_refused((a->>'event')::uuid, 'scheduled', 'draft') THEN RAISE EXCEPTION 'cap_2_to_draft_refused'; END IF;
  -- Increasing exposure stays refused.
  IF NOT pg_temp.i3645_refused((b->>'event')::uuid, 'scheduled', 'public') THEN RAISE EXCEPTION 'cap_2_hidden_to_public_allowed'; END IF;
  IF NOT pg_temp.i3645_refused((c->>'event')::uuid, 'scheduled', 'public') THEN RAISE EXCEPTION 'cap_2_private_to_public_allowed'; END IF;
  IF NOT pg_temp.i3645_refused((d->>'event')::uuid, 'scheduled', 'public') THEN RAISE EXCEPTION 'cap_2_draft_to_scheduled_public_allowed'; END IF;
  IF NOT pg_temp.i3645_refused((b->>'event')::uuid, 'scheduled', 'private') THEN RAISE EXCEPTION 'cap_2_hidden_to_private_allowed'; END IF;
  -- Publishing a hidden trip (no buyer exposure) is not refused.
  IF pg_temp.i3645_refused((d->>'event')::uuid, 'scheduled', 'hidden') THEN RAISE EXCEPTION 'cap_2_draft_to_scheduled_hidden_refused'; END IF;
  IF pg_temp.i3645_refused((c->>'event')::uuid, 'scheduled', 'hidden') THEN RAISE EXCEPTION 'cap_2_private_to_hidden_refused'; END IF;

  -- 3. Switch ON: everything allowed.
  PERFORM pg_temp.i3645_switch(true);
  IF public.pg_trip_installments_supported((b->>'event')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'cap_3_switch_on'; END IF;
  IF pg_temp.i3645_refused((b->>'event')::uuid, 'scheduled', 'public') THEN RAISE EXCEPTION 'cap_3_hidden_to_public_refused'; END IF;
  IF pg_temp.i3645_refused((a->>'event')::uuid, 'scheduled', 'public') THEN RAISE EXCEPTION 'cap_3_draft_to_public_refused'; END IF;
  PERFORM pg_temp.i3645_switch(false);

  -- 4. Brand capability for members only.
  INSERT INTO auth.users(id, email) VALUES (v_other, 'other-3645-cap@example.test');
  PERFORM set_config('request.jwt.claim.sub', (a->>'owner'), true);
  IF public.biz_trip_installments_supported_for_brand((a->>'brand')::uuid) IS NOT FALSE THEN
    RAISE EXCEPTION 'cap_4_member_paystack_off';
  END IF;
  PERFORM pg_temp.i3645_switch(true);
  IF public.biz_trip_installments_supported_for_brand((a->>'brand')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'cap_4_member_paystack_on';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  IF public.biz_trip_installments_supported_for_brand((a->>'brand')::uuid) IS NOT FALSE THEN
    RAISE EXCEPTION 'cap_4_non_member_must_be_false';
  END IF;
  PERFORM pg_temp.i3645_switch(false);
  PERFORM set_config('request.jwt.claim.sub', (a->>'owner'), true);
  UPDATE public.brands SET payment_provider = 'stripe' WHERE id = (a->>'brand')::uuid;
  IF public.biz_trip_installments_supported_for_brand((a->>'brand')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'cap_4_member_stripe_true';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF NOT has_function_privilege('authenticated', 'public.biz_trip_installments_supported_for_brand(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.biz_trip_installments_supported_for_brand(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cap_4_grants';
  END IF;
END
$test$;

ROLLBACK;
