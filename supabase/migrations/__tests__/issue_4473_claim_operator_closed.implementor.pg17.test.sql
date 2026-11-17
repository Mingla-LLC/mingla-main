\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4473-CLAIM-CLEARS-OPERATOR-CLOSURE | issue #4473 | Claiming an order whose recovery item was operator-closed attaches the order, clears the closure on that item, and never aborts the rest of the identity sweep or a link claim.

BEGIN;

INSERT INTO public.attendance_claim_recovery_operator_closures(
  closure_id, expected_count, set_sha256, decision_reference
) VALUES (
  'issue_3060_no_current_buyers', 1, repeat('a', 64),
  'https://github.com/Mingla-LLC/mingla-main/issues/2979#issuecomment-5514866755'
) ON CONFLICT (closure_id) DO NOTHING;

DO $test$
DECLARE
  v_host uuid := '44730000-0000-4000-8000-000000000001';
  v_guest uuid := '44730000-0000-4000-8000-000000000002';
  v_link_guest uuid := '44730000-0000-4000-8000-000000000003';
  v_brand uuid := '44730000-0000-4000-8000-000000000004';
  v_event uuid := '44730000-0000-4000-8000-000000000005';
  v_ticket_type uuid := '44730000-0000-4000-8000-000000000006';
  v_closed_order uuid := '44730000-0000-4000-8000-000000000007';
  v_new_order uuid := '44730000-0000-4000-8000-000000000008';
  v_link_order uuid := '44730000-0000-4000-8000-000000000009';
  v_digest bytea := sha256(convert_to('issue-4473-link-token', 'UTF8'));
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_host), (v_guest), (v_link_guest);
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider
  ) VALUES (
    v_brand, v_host, 'Issue 4473 brand', 'issue-4473-brand', 'USD', 'USD',
    'stripe'
  );
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency
  ) VALUES (
    v_event, v_brand, 'Issue 4473 event', 'issue-4473-event', 'event',
    'scheduled', 'public', 'UTC', 'USD'
  );
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_ticket_type, v_event, 'General', 50, 'USD');

  INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via)
  VALUES
    (v_guest, 'phone', '+12025554473', 'twilio_verify'),
    (v_link_guest, 'email', 'link-guest@example.test', 'email_code');

  -- An older guest order whose recovery item operators closed (#3060), and a
  -- new guest order bought with the same phone.
  INSERT INTO public.orders(
    id, event_id, buyer_email, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source
  ) VALUES
    (v_closed_order, v_event, 'old@example.test', '+12025554473', 50, 'USD',
     'online_card', 'paid', 'online_checkout'),
    (v_new_order, v_event, 'new@example.test', '+12025554473', 50, 'USD',
     'online_card', 'paid', 'online_checkout'),
    (v_link_order, v_event, 'link-guest@example.test', NULL, 50, 'USD',
     'online_card', 'paid', 'online_checkout');
  INSERT INTO public.tickets(
    order_id, ticket_type_id, event_id, qr_code, status, approval_status
  ) VALUES
    (v_closed_order, v_ticket_type, v_event, 'issue-4473-qr-closed', 'valid', 'auto'),
    (v_new_order, v_ticket_type, v_event, 'issue-4473-qr-new', 'valid', 'auto'),
    (v_link_order, v_ticket_type, v_event, 'issue-4473-qr-link', 'valid', 'auto');

  INSERT INTO public.attendance_claim_recovery_items(
    order_id, selected_token_created_at, state, resolved_via, operator_closure_id
  ) VALUES
    (v_closed_order, now() - interval '60 days', 'legacy_retired',
     'operator_confirmed_no_current_buyer', 'issue_3060_no_current_buyers'),
    (v_link_order, now() - interval '60 days', 'legacy_retired',
     'operator_confirmed_no_current_buyer', 'issue_3060_no_current_buyers');

  -- Identity rail: the operator-closed order must not abort the sweep.
  v_result := public.claim_attendance_by_verified_identity(v_guest);
  IF (v_result->>'count')::integer <> 2 THEN
    RAISE EXCEPTION 'identity sweep did not claim both orders: %', v_result;
  END IF;
  IF (SELECT count(*) FROM public.orders
       WHERE id IN (v_closed_order, v_new_order) AND buyer_user_id = v_guest) <> 2 THEN
    RAISE EXCEPTION 'identity sweep left an order detached';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items
     WHERE order_id = v_closed_order AND state = 'claimed'
       AND resolved_via = 'verified_identity' AND operator_closure_id IS NULL
  ) THEN
    RAISE EXCEPTION 'operator-closed recovery item was not resolved by the claim';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_operator_closures
     WHERE closure_id = 'issue_3060_no_current_buyers'
  ) THEN
    RAISE EXCEPTION 'operator closure history was removed';
  END IF;

  -- Link rail: the same shape through claim_attendance_internal_v2.
  UPDATE public.orders
     SET attendance_claim_token_digest = v_digest,
         attendance_claim_token_generation = 'governed_v2',
         attendance_claim_token_created_at = now()
   WHERE id = v_link_order;
  v_result := public.claim_attendance_internal_v2(
    v_link_guest, 'order', v_event, v_link_order, v_digest, NULL
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = v_link_order AND buyer_user_id = v_link_guest
  ) THEN
    RAISE EXCEPTION 'link claim did not attach the operator-closed order: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items
     WHERE order_id = v_link_order AND state = 'claimed'
       AND operator_closure_id IS NULL
       AND resolved_via IS DISTINCT FROM 'operator_confirmed_no_current_buyer'
  ) THEN
    RAISE EXCEPTION 'link claim did not resolve the operator-closed recovery item';
  END IF;
END;
$test$;

ROLLBACK;
