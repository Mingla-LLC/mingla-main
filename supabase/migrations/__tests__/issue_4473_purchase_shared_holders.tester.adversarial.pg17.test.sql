\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4473-SHARED-HOLDER-NEEDS-LIVE-PROOF | issue #4473 | A shared purchase is visible only to an account that proves the purchase contact right now, never exposes the owner's contact, name, card or notes, and never lets the shared holder act on it.
--
-- Tester-style adversarial checks for purchase_shared_holders: an account that
-- only knows the address, a revoked or expired extra, a phone that moved to a
-- new account, a ticket sent to a friend, a refund, owner-only actions, and
-- every direct table path a shared holder could try.

BEGIN;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;
CREATE FUNCTION pg_temp.as_admin() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'supabase_admin', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
-- Rows the current role can read from a table; no privilege counts as none.
CREATE FUNCTION pg_temp.visible(p_table text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM %s', p_table) INTO v;
  RETURN v;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 0;
END;
$$;
CREATE FUNCTION pg_temp.shared_items(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_user(p_user);
  v := public.pg_my_shared_purchases();
  PERFORM pg_temp.as_admin();
  RETURN v;
END;
$$;

DO $test$
DECLARE
  v_owner uuid := '44730000-0000-4000-8000-000000000101';
  v_second uuid := '44730000-0000-4000-8000-000000000102';
  v_host uuid := '44730000-0000-4000-8000-000000000103';
  v_brand uuid := '44730000-0000-4000-8000-000000000104';
  v_event uuid := '44730000-0000-4000-8000-000000000105';
  v_rsvp_event uuid := '44730000-0000-4000-8000-000000000106';
  v_ticket_type uuid := '44730000-0000-4000-8000-000000000107';
  v_order uuid := '44730000-0000-4000-8000-000000000108';
  v_rsvp uuid := '44730000-0000-4000-8000-000000000109';
  v_parent uuid := '44730000-0000-4000-8000-00000000010a';
  v_plus_one uuid := '44730000-0000-4000-8000-00000000010b';
  v_venue uuid := '44730000-0000-4000-8000-00000000010c';
  v_reservation uuid := '44730000-0000-4000-8000-00000000010d';
  v_stay uuid := '44730000-0000-4000-8000-00000000010e';
  v_food uuid := '44730000-0000-4000-8000-00000000010f';
  v_email constant text := 'shared-buyer-4473@example.test';
  v_phone constant text := '+12025557301';
  v_stranger uuid := '44730000-0000-4000-8000-000000000111';
  v_phone_holder uuid := '44730000-0000-4000-8000-000000000112';
  v_newcomer uuid := '44730000-0000-4000-8000-000000000113';
  v_friend uuid := '44730000-0000-4000-8000-000000000114';
  v_ticket_1 uuid;
  v_ticket_2 uuid;
  v_text text;
  v_state text;
  v_t text;
  v_result jsonb;
  v_items jsonb;
  v_order_item jsonb;
  v_n integer;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'owner-4473@example.test'),
    (v_second, 'second-4473@example.test'),
    (v_host, 'host-4473@example.test'),
    (v_stranger, 'shared-buyer-4473@example.test'),
    (v_phone_holder, 'phone-holder-4473@example.test'),
    (v_newcomer, 'newcomer-4473@example.test'),
    (v_friend, 'friend-4473@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency, payment_provider
  ) VALUES (v_brand, v_host, 'Issue 4473 share brand', 'issue-4473-share-brand',
    'USD', 'USD', 'stripe');
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES
    (v_event, v_brand, 'Issue 4473 shared event', 'issue-4473-shared-event',
     'event', 'scheduled', 'private', 'UTC', 'USD'),
    (v_rsvp_event, v_brand, 'Issue 4473 shared RSVP', 'issue-4473-shared-rsvp',
     'rsvp', 'scheduled', 'private', 'UTC', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_ticket_type, v_event, 'General', 1000, 'USD');
  INSERT INTO public.orders(
    id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source
  ) VALUES (v_order, v_event, v_owner, 'Owner Person', v_email, v_phone, 2000,
    'USD', 'online_card', 'paid', 'online_checkout');
  INSERT INTO public.tickets(
    order_id, ticket_type_id, event_id, qr_code, status, approval_status, created_at
  ) VALUES
    (v_order, v_ticket_type, v_event, 'issue-4473-share-qr-1', 'valid', 'auto', now() - interval '2 minutes'),
    (v_order, v_ticket_type, v_event, 'issue-4473-share-qr-2', 'valid', 'auto', now() - interval '1 minute');
  INSERT INTO public.event_rsvps(
    id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status,
    approval_status, qr_code
  ) VALUES
    (v_rsvp, v_rsvp_event, v_owner, 'Owner Person', v_email, v_phone, 'going',
     'approved', 'issue-4473-rsvp-qr'),
    (v_parent, v_rsvp_event, v_host, 'Other Person', 'other-4473@example.test',
     '+12025557399', 'going', 'approved', 'issue-4473-parent-qr');
  INSERT INTO public.event_rsvp_guests(id, rsvp_id, name, email, phone, matched_user_id, qr_code)
  VALUES (v_plus_one, v_parent, 'Owner Person', v_email, v_phone, v_owner,
    'issue-4473-plus-one-qr');
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category)
  VALUES (v_venue, v_brand, 'issue4473sharevenue', 'Issue 4473 Venue', 0, 0, 'restaurant');
  INSERT INTO public.reservations(
    id, brand_id, venue_id, reserved_for, party_size, status, guest_name,
    guest_email, guest_phone_e164, consumer_user_id, guest_notes
  ) VALUES (v_reservation, v_brand, v_venue, now() + interval '3 days', 4,
    'confirmed', 'Owner Person', v_email, v_phone, v_owner, 'owner private note');
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (v_stay, 'ST-4473000000000000000A', gen_random_uuid(), v_owner,
    repeat('a', 64), v_venue, v_brand, 'USD', 'instant', 'confirmed',
    jsonb_build_object('email', v_email, 'phone', v_phone, 'name', 'Owner Person'),
    1000, 0, 0, 1000, 'issue-4473-stay-key', repeat('b', 64));
  INSERT INTO public.venue_orders(
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_user_id,
    buyer_name, buyer_email, buyer_phone_e164, money_path, currency,
    subtotal_cents, effective_take_rate_bps, service_fee_bps,
    mingla_fee_cents, platform_service_fee_cents, pass_mingla_fee,
    pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents,
    tip_cents, total_cents, provider, payment_status, idempotency_key
  ) VALUES (v_food, gen_random_uuid(), v_brand, v_venue, 'guest_page', '47',
    v_owner, 'Owner Person', v_email, v_phone, 'mingla', 'USD', 1000, 0,
    0, 0, 0, false, false, false, 1000, 0, 0, 1000, 'stripe', 'paid',
    'issue-4473-food-key');
  PERFORM set_config('session_replication_role', 'origin', true);

  UPDATE public.orders
     SET payment_card_brand = 'visa', payment_card_last4 = '4242'
   WHERE id = v_order;
  SELECT id INTO v_ticket_1 FROM public.tickets WHERE qr_code = 'issue-4473-share-qr-1';
  SELECT id INTO v_ticket_2 FROM public.tickets WHERE qr_code = 'issue-4473-share-qr-2';

  PERFORM public.record_verified_phone(v_owner, v_phone);
  PERFORM public.issue_4063_record_claim_contact(v_second, 'email', v_email);
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_second);
  IF (v_result->>'count')::integer <> 6 THEN
    RAISE EXCEPTION 'setup: expected 6 shares, got %', v_result;
  END IF;

  -- X1. Knowing the address is not owning it: the stranger's account carries
  -- the purchase email but never read a code from it.
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_stranger);
  IF (v_result->>'count')::integer <> 0 THEN
    RAISE EXCEPTION 'X1 an unproved account gained a share: %', v_result;
  END IF;
  IF jsonb_array_length(pg_temp.shared_items(v_stranger)) <> 0 THEN
    RAISE EXCEPTION 'X1 an unproved account reads shared purchases';
  END IF;
  PERFORM pg_temp.as_user(v_stranger);
  IF public.consumer_can_read_event_for_caller(v_event) THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'X1 an unproved account reads the private event';
  END IF;
  PERFORM pg_temp.as_admin();

  -- X2. A share row cannot be written for an unproved account, and no client
  -- role reaches the table or the writer.
  BEGIN
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('order', v_order, v_stranger);
    RAISE EXCEPTION 'X2 a share row was written for an unproved account';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('order', v_order, v_owner);
    RAISE EXCEPTION 'X2 the owner was written as its own shared holder';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF has_table_privilege('authenticated', 'public.purchase_shared_holders', 'SELECT')
     OR has_table_privilege('authenticated', 'public.purchase_shared_holders', 'INSERT')
     OR has_table_privilege('anon', 'public.purchase_shared_holders', 'SELECT')
     OR has_function_privilege('authenticated',
       'public.issue_4473_share_purchases_by_verified_identity(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_holder_proves(text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_purchase_contact(text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_purchase_shared_with(text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.pg_my_shared_purchases()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.pg_my_purchase_share_flags()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.pg_my_shared_purchases()', 'EXECUTE') THEN
    RAISE EXCEPTION 'X2 shared-holder internals are reachable from a client role';
  END IF;

  -- X3. The shared holder reads nothing from the purchase tables directly, and
  -- its RPC carries no contact, name, card or note of the owner.
  PERFORM pg_temp.as_user(v_second);
  FOREACH v_t IN ARRAY ARRAY[
    'public.orders', 'public.tickets', 'public.order_line_items',
    'public.ticket_event_dates', 'public.event_rsvps', 'public.event_rsvp_guests',
    'public.reservations', 'public.stay_reservation_groups', 'public.venue_orders',
    'public.venue_order_items', 'public.purchase_shared_holders',
    'public.account_claim_contacts', 'public.verified_phone_identities'
  ] LOOP
    IF pg_temp.visible(v_t) <> 0 THEN
      PERFORM pg_temp.as_admin();
      RAISE EXCEPTION 'X3 the shared holder reads % directly', v_t;
    END IF;
  END LOOP;
  PERFORM pg_temp.as_admin();
  v_text := pg_temp.shared_items(v_second)::text;
  IF jsonb_array_length(v_text::jsonb) <> 6 THEN
    RAISE EXCEPTION 'X3 setup: shared holder lost its purchases';
  END IF;
  FOREACH v_t IN ARRAY ARRAY[
    v_email, v_phone, 'Owner Person', 'Other Person', '4242', 'visa',
    'owner private note', 'owner-4473@example.test'
  ] LOOP
    IF position(lower(v_t) IN lower(v_text)) > 0 THEN
      RAISE EXCEPTION 'X3 the shared read exposes owner data: %', v_t;
    END IF;
  END LOOP;

  -- X4. The shared holder cannot act for the owner.
  PERFORM pg_temp.as_user(v_second);
  BEGIN
    PERFORM public.pg_ticket_offer_to_friend(
      v_ticket_2, 'Someone', 'someone-4473@example.test', '+12025557388');
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'X4 a shared holder sent the owner''s ticket';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.pg_ticket_take_back(v_ticket_2);
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'X4 a shared holder took back the owner''s ticket';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  PERFORM pg_temp.as_admin();

  -- X5. Revoking the extra removes every shared purchase at once.
  UPDATE public.account_claim_contacts SET revoked_at = now()
   WHERE user_id = v_second AND revoked_at IS NULL;
  IF jsonb_array_length(pg_temp.shared_items(v_second)) <> 0 THEN
    RAISE EXCEPTION 'X5 a revoked contact still shows shared purchases';
  END IF;
  PERFORM pg_temp.as_user(v_second);
  IF public.consumer_can_read_event_for_caller(v_event) THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'X5 a revoked contact still reads the event';
  END IF;
  PERFORM pg_temp.as_user(v_owner);
  IF (SELECT count(*) FROM public.pg_my_purchase_share_flags()) <> 0 THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'X5 the owner is still told the purchase is shared';
  END IF;
  PERFORM pg_temp.as_admin();
  IF public.issue_4473_shared_brand_guest(v_brand, v_second) THEN
    RAISE EXCEPTION 'X5 a revoked contact is still a brand guest';
  END IF;
  -- Proving it again restores them.
  PERFORM public.issue_4063_record_claim_contact(v_second, 'email', v_email);
  IF jsonb_array_length(pg_temp.shared_items(v_second)) <> 6 THEN
    RAISE EXCEPTION 'X5 re-proving did not restore the shared purchases';
  END IF;

  -- X6. The yearly rule: an extra not proved for 12 months stops counting.
  UPDATE public.account_claim_contacts
     SET last_proved_at = now() - interval '13 months'
   WHERE user_id = v_second AND revoked_at IS NULL;
  IF public.account_owns_contact(v_second, v_email, NULL)
     OR jsonb_array_length(pg_temp.shared_items(v_second)) <> 0 THEN
    RAISE EXCEPTION 'X6 an expired extra still proves the contact';
  END IF;
  PERFORM pg_temp.as_user(v_second);
  IF EXISTS (SELECT 1 FROM public.pg_my_claim_identifiers() WHERE value = v_email) THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'X6 an expired extra is still listed as confirmed';
  END IF;
  PERFORM pg_temp.as_admin();
  PERFORM public.issue_4063_record_claim_contact(v_second, 'email', v_email);
  IF jsonb_array_length(pg_temp.shared_items(v_second)) <> 6 THEN
    RAISE EXCEPTION 'X6 a fresh code did not restore the shared purchases';
  END IF;

  -- X7. The number moves to a new account: everyone else's claim-only proof of
  -- it ends, and so do the shares that rested on it.
  v_result := public.issue_4063_record_claim_contact(v_phone_holder, 'phone', v_phone);
  IF v_result->>'result' <> 'recorded' THEN
    RAISE EXCEPTION 'X7 setup: phone extra refused: %', v_result;
  END IF;
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_phone_holder);
  IF (v_result->>'count')::integer <> 6 THEN
    RAISE EXCEPTION 'X7 setup: phone holder did not get shares: %', v_result;
  END IF;
  PERFORM public.record_verified_phone(v_newcomer, v_phone);
  IF EXISTS (SELECT 1 FROM public.account_claim_contacts
              WHERE user_id = v_phone_holder AND revoked_at IS NULL)
     OR jsonb_array_length(pg_temp.shared_items(v_phone_holder)) <> 0
     OR EXISTS (SELECT 1 FROM public.purchase_shared_holders
                 WHERE user_id = v_phone_holder AND revoked_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.purchase_shared_holders
                 WHERE user_id = v_phone_holder AND revoked_reason = 'contact_lost') THEN
    RAISE EXCEPTION 'X7 a moved number still shows purchases on the old extra holder';
  END IF;
  IF (SELECT buyer_user_id FROM public.orders WHERE id = v_order) <> v_owner
     OR jsonb_array_length(pg_temp.shared_items(v_second)) <> 6 THEN
    RAISE EXCEPTION 'X7 the move disturbed the owner or an email-proved holder';
  END IF;

  -- X8. A ticket the owner sent to a friend leaves the shared holder's view.
  UPDATE public.tickets
     SET holder_user_id = v_friend, holder_name = 'Friend Person',
         holder_email = 'friend-4473@example.test',
         holder_phone_e164 = '+12025557377', transfer_state = 'claimed',
         transfer_offered_at = now(), transfer_claimed_at = now(),
         qr_code = 'issue-4473-share-qr-2-rotated'
   WHERE id = v_ticket_2;
  v_text := pg_temp.shared_items(v_second)::text;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_text::jsonb) e,
                  jsonb_array_elements(e->'tickets') t
     WHERE e->>'kind' = 'order' AND t->>'id' = v_ticket_2::text
       AND t->>'transferState' = 'claimed' AND t->'qrCode' = 'null'::jsonb
  ) OR position('issue-4473-share-qr-2' IN v_text) > 0
    OR position('friend-4473' IN v_text) > 0
    OR position('Friend Person' IN v_text) > 0 THEN
    RAISE EXCEPTION 'X8 a sent ticket is still usable or named on the shared holder';
  END IF;

  -- X9. A refund shows on both accounts; the passes stop being valid.
  UPDATE public.tickets SET status = 'refunded' WHERE order_id = v_order;
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_order;
  v_text := pg_temp.shared_items(v_second)::text;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_text::jsonb) e
     WHERE e->>'kind' = 'order' AND e->>'paymentStatus' = 'refunded'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e->'tickets') t
                        WHERE t->>'status' = 'valid')
  ) THEN
    RAISE EXCEPTION 'X9 the refund is not shown to the shared holder';
  END IF;
  PERFORM pg_temp.as_user(v_owner);
  IF pg_temp.visible('public.orders') <> 1 THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'X9 the owner lost the refunded order';
  END IF;
  PERFORM pg_temp.as_admin();

  -- X10. If the shared holder becomes the owner, the share stops counting.
  UPDATE public.orders SET buyer_user_id = v_second WHERE id = v_order;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.shared_items(v_second)) e
              WHERE e->>'kind' = 'order') THEN
    RAISE EXCEPTION 'X10 an owner is also listed as its own shared holder';
  END IF;
END;
$test$;

ROLLBACK;
