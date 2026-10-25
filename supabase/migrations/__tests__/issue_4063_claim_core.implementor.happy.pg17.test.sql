\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4063-OWNER-PROOF | issue #4063 | Owner columns may attach only to an account that proved the purchase contact; signed-in non-owners remain the purchaser/booker, not the owner.

BEGIN;

DO $test$
DECLARE
  v_host uuid := '40630000-0000-4000-8000-000000001001';
  v_payer uuid := '40630000-0000-4000-8000-000000001002';
  v_guest uuid := '40630000-0000-4000-8000-000000001003';
  v_brand uuid := '40630000-0000-4000-8000-000000001004';
  v_event uuid := '40630000-0000-4000-8000-000000001005';
  v_detached_order uuid := '40630000-0000-4000-8000-000000001006';
  v_owned_order uuid := '40630000-0000-4000-8000-000000001007';
  v_claim_order uuid := '40630000-0000-4000-8000-000000001008';
  v_ticket_type uuid := '40630000-0000-4000-8000-000000001009';
  v_rsvp_event uuid := '40630000-0000-4000-8000-000000001010';
  v_rsvp uuid := '40630000-0000-4000-8000-000000001011';
  v_guest_event uuid := '40630000-0000-4000-8000-000000001012';
  v_parent_rsvp uuid := '40630000-0000-4000-8000-000000001013';
  v_plus_one uuid := '40630000-0000-4000-8000-000000001014';
  v_result jsonb;
  v_i integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_host), (v_payer), (v_guest);
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider
  ) VALUES (
    v_brand, v_host, 'Issue 4063 claim core', 'issue-4063-claim-core',
    'USD', 'USD', 'stripe'
  );
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency
  ) VALUES (
    v_event, v_brand, 'Issue 4063 event', 'issue-4063-claim-core-event',
    'event', 'scheduled', 'private', 'UTC', 'USD'
  );

  INSERT INTO public.orders(
    id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source
  ) VALUES (
    v_detached_order, v_event, v_payer, 'guest@example.test', '+12025551003',
    1000, 'USD', 'online_card', 'paid', 'online_checkout'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = v_detached_order
       AND buyer_user_id IS NULL
       AND purchased_by_user_id = v_payer
       AND attendance_identity_claim_armed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'signed-in non-owner was not detached and armed';
  END IF;

  INSERT INTO public.account_claim_contacts(
    user_id, channel, value, verified_via
  ) VALUES (
    v_guest, 'email', 'guest@example.test', 'email_code'
  );
  IF NOT public.account_owns_contact(
    v_guest, 'GUEST@example.test', NULL
  ) THEN
    RAISE EXCEPTION 'extra verified contact was not accepted';
  END IF;

  INSERT INTO public.orders(
    id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source
  ) VALUES (
    v_owned_order, v_event, v_guest, 'guest@example.test', '+12025551003', 1000, 'USD',
    'online_card', 'paid', 'online_checkout'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = v_owned_order AND buyer_user_id = v_guest
       AND purchased_by_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'proved owner was detached';
  END IF;

  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_ticket_type, v_event, 'General', 1000, 'USD');
  INSERT INTO public.orders(
    id, event_id, buyer_email, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source
  ) VALUES (
    v_claim_order, v_event, 'guest@example.test', '+12025551003', 1000,
    'USD', 'online_card', 'paid', 'online_checkout'
  );
  INSERT INTO public.tickets(
    order_id, ticket_type_id, event_id, qr_code, status, approval_status
  ) VALUES (
    v_claim_order, v_ticket_type, v_event, 'issue-4063-sweep-qr',
    'valid', 'auto'
  );

  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency
  ) VALUES
    (
      v_rsvp_event, v_brand, 'Issue 4063 unlisted RSVP',
      'issue-4063-unlisted-rsvp', 'rsvp', 'scheduled', 'hidden', 'UTC', 'USD'
    ),
    (
      v_guest_event, v_brand, 'Issue 4063 private plus one',
      'issue-4063-private-plus-one', 'rsvp', 'scheduled', 'private', 'UTC',
      'USD'
    );
  INSERT INTO public.event_rsvps(
    id, event_id, guest_name, guest_email, guest_phone, rsvp_status,
    approval_status
  ) VALUES
    (
      v_rsvp, v_rsvp_event, 'Claimed primary', 'guest@example.test',
      '+12025551003', 'going', 'approved'
    ),
    (
      v_parent_rsvp, v_guest_event, 'Other primary', 'other@example.test',
      '+12025551099', 'going', 'approved'
    );
  INSERT INTO public.event_rsvp_guests(
    id, rsvp_id, name, email, phone
  ) VALUES (
    v_plus_one, v_parent_rsvp, 'Claimed plus one', 'guest@example.test',
    '+12025551003'
  );

  v_result := public.claim_attendance_by_verified_identity(v_guest);
  IF (v_result->>'count')::integer <> 3
     OR coalesce((v_result->>'more')::boolean, true) IS NOT FALSE
     OR v_result->'claimed'->0->>'kind' <> 'order'
     OR v_result->'claimed'->0->>'routeKind' <> 'order'
     OR v_result->'claimed'->0->>'offeringType' <> 'event'
     OR v_result->'claimed'->0->>'noun' <> 'ticket'
     OR v_result->'claimed'->0->>'orderId' <> v_claim_order::text
     OR v_result->'claimed'->0->>'eventId' <> v_event::text
     OR NOT EXISTS (
       SELECT 1 FROM public.orders
        WHERE id = v_claim_order AND buyer_user_id = v_guest
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.event_rsvps
        WHERE id = v_rsvp AND user_id = v_guest
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.event_rsvp_guests
        WHERE id = v_plus_one AND matched_user_id = v_guest
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_result->'claimed') item
        WHERE item->>'kind' = 'rsvp'
          AND item->>'routeId' = v_rsvp::text
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_result->'claimed') item
        WHERE item->>'kind' = 'rsvp_guest'
          AND item->>'routeId' = v_parent_rsvp::text
     ) THEN
    RAISE EXCEPTION 'identity sweep missed a private/unlisted claim kind: %',
      v_result;
  END IF;
  v_result := public.claim_attendance_by_verified_identity(v_guest);
  IF (v_result->>'count')::integer <> 0 THEN
    RAISE EXCEPTION 'identity sweep was not idempotent: %', v_result;
  END IF;

  BEGIN
    UPDATE public.orders
       SET buyer_user_id = v_payer
     WHERE id = v_detached_order;
    RAISE EXCEPTION 'unproved UPDATE attached an order owner';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  INSERT INTO public.account_claim_contacts(
    user_id, channel, value, verified_via
  ) VALUES (
    v_payer, 'phone', '+12025551009', 'twilio_verify'
  );
  v_result := public.record_verified_phone(v_guest, '+12025551009');
  IF v_result->>'result' <> 'recorded'
     OR EXISTS (
       SELECT 1 FROM public.account_claim_contacts
        WHERE user_id = v_payer AND channel = 'phone'
          AND value = '+12025551009' AND revoked_at IS NULL
     )
     OR NOT public.account_owns_contact(v_guest, NULL, '+12025551009') THEN
    RAISE EXCEPTION 'verified-phone ownership did not revoke the old extra contact';
  END IF;

  FOR v_i IN 1..30 LOOP
    v_result := public.begin_attendance_claim_attempt(v_guest, 'identity');
    IF coalesce((v_result->>'allowed')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'identity budget rejected attempt %: %', v_i, v_result;
    END IF;
  END LOOP;
  v_result := public.begin_attendance_claim_attempt(v_guest, 'identity');
  IF coalesce((v_result->>'allowed')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'identity budget allowed attempt 31: %', v_result;
  END IF;
  v_result := public.begin_attendance_claim_attempt(v_guest, 'order');
  IF coalesce((v_result->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'identity attempts consumed token-claim budget: %', v_result;
  END IF;

  IF position(
       'e.visibility' IN pg_get_functiondef(
         'public.issue_order_attendance_claim_proof_v2(uuid,uuid,bytea,text,boolean)'::regprocedure
       )
     ) > 0
     OR position(
       'e.visibility' IN pg_get_functiondef(
         'public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure
       )
     ) > 0
     OR position(
       'e.visibility' IN pg_get_functiondef(
         'public.mint_attendance_claim_handoff(text,uuid,uuid,bytea,bytea,bytea,text)'::regprocedure
       )
     ) > 0 THEN
    RAISE EXCEPTION 'an attendance ownership predicate still reads visibility';
  END IF;

  IF has_table_privilege('anon', 'public.account_claim_contacts', 'SELECT')
     OR has_table_privilege(
       'authenticated', 'public.account_claim_contacts', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'extra claim contacts are readable outside service role';
  END IF;
END;
$test$;

ROLLBACK;
