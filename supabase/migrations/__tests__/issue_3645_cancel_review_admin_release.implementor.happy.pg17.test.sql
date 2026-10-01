-- Issue #3645 — admin_get_offering exposes cancel-review hold status (PG17).
-- After prepare, the offering bundle reports awaiting_review + object_count so
-- the admin console can show the release control before anyone runs SQL by hand.
BEGIN;

DO $test$
DECLARE
  v_owner  constant uuid := '36450000-0000-4000-8000-0000000000a1';
  v_admin  constant uuid := '36450000-0000-4000-8000-0000000000a2';
  v_brand  constant uuid := '36450000-0000-4000-8000-0000000000b1';
  v_event  constant uuid := '36450000-0000-4000-8000-0000000000e1';
  v_tt     constant uuid := '36450000-0000-4000-8000-0000000000t1';
  v_order  constant uuid := '36450000-0000-4000-8000-0000000000o1';
  v_line   constant uuid := '36450000-0000-4000-8000-0000000000l1';
  v_bundle jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645-admin@example.test');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645-admin@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645-admin@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Admin Release Brand', 'issue-3645-admin-release',
    'stripe', 'US', 'USD', 'USD'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Held Cancel Event', 'issue-3645-admin-held', 'cancelled', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_tt, v_event, 'GA', 4000, 'USD');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source
  ) VALUES (v_order, v_event, 4000, 'USD', 'paid', 'pi_3645_admin', 'ch_3645_admin', 'legacy');
  INSERT INTO public.order_line_items(
    id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  ) VALUES (v_line, v_order, v_tt, 1, 4000, 4000);

  PERFORM public.cancel_event_refund_prepare(v_event);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_bundle := public.admin_get_offering(v_event);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF v_bundle IS NULL THEN
    RAISE EXCEPTION 'admin_get_offering_returned_null';
  END IF;
  IF v_bundle->>'cancel_refund_run_status' IS DISTINCT FROM 'awaiting_review' THEN
    RAISE EXCEPTION 'admin_get_offering_expected_awaiting_review_got_%',
      v_bundle->>'cancel_refund_run_status';
  END IF;
  IF (v_bundle->>'cancel_refund_object_count')::int < 1 THEN
    RAISE EXCEPTION 'admin_get_offering_expected_object_count_got_%',
      v_bundle->>'cancel_refund_object_count';
  END IF;

  RAISE NOTICE 'issue_3645_cancel_review_admin_release_read_pass';
END;
$test$;

ROLLBACK;
