\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4473-PURCHASE-SHOWS-ON-EVERY-PROVING-ACCOUNT | issue #4473 | A purchase owned by one account also shows, read-only, on every other account that proves its email or phone now; the owner is unchanged and only the owner can act on it.
--
-- Happy paths for every purchase kind the identity sweep handles: ticket
-- order, RSVP primary, RSVP plus-one, venue reservation, stay group and food
-- order. Runs as supabase_admin; fixture rows are written with replication
-- triggers off so the venue kinds need no booking pipeline.

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
  v_linker uuid := '44730000-0000-4000-8000-000000000110';
  v_code text;
  v_challenge uuid;
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
    (v_linker, 'linker-4473@example.test');
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

  -- The owner proved the phone at sign-in; the second account proves the
  -- purchase email with its own code.
  PERFORM public.record_verified_phone(v_owner, v_phone);
  v_result := public.issue_4063_record_claim_contact(v_second, 'email', v_email);
  IF v_result->>'result' <> 'recorded' THEN
    RAISE EXCEPTION 'S0 the second account could not record the email: %', v_result;
  END IF;

  -- S1. One sweep shares every kind, marks each entry, changes no owner.
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_second);
  IF (v_result->>'count')::integer <> 6
     OR (v_result->>'more')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'S1 expected 6 shared purchases: %', v_result;
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_result->'claimed') e
   WHERE (e->>'sharedWithAnotherAccount')::boolean IS TRUE AND e->>'role' = 'shared';
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'S1 an entry was not marked shared: %', v_result;
  END IF;
  SELECT count(DISTINCT e->>'kind') INTO v_n FROM jsonb_array_elements(v_result->'claimed') e;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'S1 a purchase kind was missing: %', v_result;
  END IF;
  IF (SELECT buyer_user_id FROM public.orders WHERE id = v_order) <> v_owner
     OR (SELECT user_id FROM public.event_rsvps WHERE id = v_rsvp) <> v_owner
     OR (SELECT matched_user_id FROM public.event_rsvp_guests WHERE id = v_plus_one) <> v_owner
     OR (SELECT consumer_user_id FROM public.reservations WHERE id = v_reservation) <> v_owner
     OR (SELECT user_id FROM public.stay_reservation_groups WHERE id = v_stay) <> v_owner
     OR (SELECT buyer_user_id FROM public.venue_orders WHERE id = v_food) <> v_owner THEN
    RAISE EXCEPTION 'S1 sharing changed an owner';
  END IF;
  SELECT e INTO v_order_item FROM jsonb_array_elements(v_result->'claimed') e
   WHERE e->>'kind' = 'order';
  IF v_order_item->>'title' IS NULL
     OR (v_order_item->>'quantity')::integer <> 2 THEN
    RAISE EXCEPTION 'S1 order entry is missing its title or quantity: %', v_order_item;
  END IF;
  -- The second account joined the event's chat through the single writer.
  IF (v_order_item->>'chatJoined')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S1 the second account did not join the chat: %', v_order_item;
  END IF;

  -- S2. A second sweep is idempotent.
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_second);
  IF (v_result->>'count')::integer <> 0 THEN
    RAISE EXCEPTION 'S2 the sweep was not idempotent: %', v_result;
  END IF;

  -- S3. The second account reads all six through its RPC, with the QR codes.
  PERFORM pg_temp.as_user(v_second);
  v_items := public.pg_my_shared_purchases();
  PERFORM pg_temp.as_admin();
  IF jsonb_array_length(v_items) <> 6 THEN
    RAISE EXCEPTION 'S3 expected 6 shared purchases, got %', v_items;
  END IF;
  SELECT e INTO v_order_item FROM jsonb_array_elements(v_items) e WHERE e->>'kind' = 'order';
  IF jsonb_array_length(v_order_item->'tickets') <> 2
     OR v_order_item->'tickets'->0->>'qrCode' <> 'issue-4473-share-qr-1'
     OR v_order_item->>'paymentStatus' <> 'paid'
     OR v_order_item->>'title' <> 'Issue 4473 shared event' THEN
    RAISE EXCEPTION 'S3 order item is incomplete: %', v_order_item;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                  WHERE e->>'kind' = 'rsvp' AND e->>'qrCode' = 'issue-4473-rsvp-qr')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                  WHERE e->>'kind' = 'rsvp_guest' AND e->>'qrCode' = 'issue-4473-plus-one-qr')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                  WHERE e->>'kind' = 'reservation' AND (e->>'partySize')::integer = 4)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                  WHERE e->>'kind' = 'stay_group' AND e->>'publicReference' = 'ST-4473000000000000000A')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                  WHERE e->>'kind' = 'venue_order' AND e->>'pickupCode' = '47') THEN
    RAISE EXCEPTION 'S3 a kind is missing its pass or reference: %', v_items;
  END IF;

  -- S4. The owner sees which purchases also show on another account.
  PERFORM pg_temp.as_user(v_owner);
  SELECT count(*) INTO v_n FROM public.pg_my_purchase_share_flags();
  PERFORM pg_temp.as_admin();
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'S4 owner share flags returned % rows', v_n;
  END IF;
  PERFORM pg_temp.as_user(v_second);
  SELECT count(*) INTO v_n FROM public.pg_my_purchase_share_flags();
  PERFORM pg_temp.as_admin();
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'S4 a shared holder saw owner flags';
  END IF;

  -- S5. The event (private) is readable to the shared holder for detail screens.
  PERFORM pg_temp.as_user(v_second);
  IF NOT public.consumer_can_read_event_for_caller(v_event)
     OR NOT public.consumer_can_read_event_for_caller(v_rsvp_event)
     OR NOT public.issue_4420_caller_reads_exact_stops(v_event) THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'S5 the shared holder cannot read the event';
  END IF;
  PERFORM pg_temp.as_admin();

  -- S6. The second account may also prove the owner's primary phone. A
  -- re-verification by the owner keeps it; the brand Guest chat helper agrees.
  v_result := public.issue_4063_record_claim_contact(v_second, 'phone', v_phone);
  IF v_result->>'result' <> 'recorded' THEN
    RAISE EXCEPTION 'S6 co-holding the owner phone was refused: %', v_result;
  END IF;
  PERFORM public.record_verified_phone(v_owner, v_phone);
  IF NOT EXISTS (
    SELECT 1 FROM public.account_claim_contacts
     WHERE user_id = v_second AND channel = 'phone' AND value = v_phone
       AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'S6 the owner re-verifying revoked the other account''s extra';
  END IF;
  IF NOT public.issue_4473_shared_brand_guest(v_brand, v_second) THEN
    RAISE EXCEPTION 'S6 the shared holder is not a brand guest';
  END IF;

  -- S7. A re-proof restarts the yearly clock.
  UPDATE public.account_claim_contacts
     SET last_proved_at = now() - interval '11 months'
   WHERE user_id = v_second AND channel = 'email';
  PERFORM public.issue_4063_record_claim_contact(v_second, 'email', v_email);
  IF (SELECT last_proved_at FROM public.account_claim_contacts
       WHERE user_id = v_second AND channel = 'email' AND revoked_at IS NULL)
     < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'S7 a fresh code did not refresh last_proved_at';
  END IF;

  -- S8. "Is this your ticket?": a signed-in account opens the order's claim
  -- link and proves the order's own contact. The value comes from the
  -- purchase, never from the client.
  v_code := public.mint_claim_link('order', v_order)->>'code';
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'S8 setup: no claim link for the order';
  END IF;
  IF public.issue_4473_begin_claim_link_contact_challenge(
       gen_random_uuid(), v_linker, 'ZZZZZZZZZZ', 'email', 'h', 'ip')->>'outcome'
     <> 'invalid' THEN
    RAISE EXCEPTION 'S8 an unknown code started a challenge';
  END IF;
  IF public.issue_4473_begin_claim_link_contact_challenge(
       gen_random_uuid(), v_second, v_code, 'email', 'h', 'ip')->>'outcome'
     <> 'already_on_this_account' THEN
    RAISE EXCEPTION 'S8 an account that already proves the email was challenged';
  END IF;
  v_challenge := gen_random_uuid();
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    v_challenge, v_linker, v_code, 'phone', NULL, 'ip-s8');
  IF v_result->>'outcome' <> 'started' OR v_result->>'target' <> v_phone THEN
    RAISE EXCEPTION 'S8 the phone challenge did not target the order phone: %', v_result;
  END IF;
  IF public.issue_4473_claim_link_challenge_for_user(v_challenge, v_second)->>'outcome'
     <> 'invalid'
     OR public.issue_4473_claim_link_challenge_for_user(v_challenge, v_linker)->>'value'
     <> v_phone THEN
    RAISE EXCEPTION 'S8 the challenge is readable by another account';
  END IF;
  v_challenge := gen_random_uuid();
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    v_challenge, v_linker, v_code, 'email', 'digest-s8', 'ip-s8');
  IF v_result->>'outcome' <> 'started' OR v_result->>'target' <> v_email THEN
    RAISE EXCEPTION 'S8 the email challenge did not target the order email: %', v_result;
  END IF;
  v_result := public.issue_4063_settle_contact_challenge(v_challenge, 'digest-s8', false);
  IF v_result->>'outcome' <> 'ok' OR v_result->>'value' <> v_email
     OR (v_result->>'userId')::uuid <> v_linker THEN
    RAISE EXCEPTION 'S8 the email challenge did not settle: %', v_result;
  END IF;
  v_result := public.issue_4063_record_claim_contact(
    v_linker, v_result->>'channel', v_result->>'value');
  IF v_result->>'result' <> 'recorded' THEN
    RAISE EXCEPTION 'S8 the proved contact was not recorded: %', v_result;
  END IF;
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_linker);
  IF (v_result->>'count')::integer <> 6 THEN
    RAISE EXCEPTION 'S8 the linked account did not get the purchases: %', v_result;
  END IF;

  -- S9. Guest chat backfill: a no-op without #4459's sync, one sync per
  -- (brand, holder) with it. A recording stand-in replaces the sync for the
  -- rest of this rolled-back transaction.
  DROP FUNCTION IF EXISTS public.issue_4459_safe_sync(uuid, uuid, text);
  IF public.issue_4473_backfill_shared_guest_sync() <> 0 THEN
    RAISE EXCEPTION 'S9 the backfill did work without the Guest chat sync';
  END IF;
  CREATE TABLE pg_temp.i4473_sync_calls(brand_id uuid, user_id uuid, source text);
  -- The syncs run inside definer functions owned by another role.
  GRANT SELECT, INSERT, DELETE ON pg_temp.i4473_sync_calls TO PUBLIC;
  CREATE FUNCTION public.issue_4459_safe_sync(p_brand_id uuid, p_user_id uuid, p_source text)
  RETURNS void LANGUAGE sql AS
    'INSERT INTO pg_temp.i4473_sync_calls VALUES ($1, $2, $3)';
  v_n := public.issue_4473_backfill_shared_guest_sync();
  IF v_n <> 2
     OR (SELECT count(*) FROM pg_temp.i4473_sync_calls
          WHERE brand_id = v_brand AND source = 'purchase_share'
            AND user_id IN (v_second, v_linker)) <> 2 THEN
    RAISE EXCEPTION 'S9 the backfill synced % holders: %', v_n,
      (SELECT jsonb_agg(to_jsonb(c)) FROM pg_temp.i4473_sync_calls c);
  END IF;

  -- S10. Expiry sweep: the linked account's only proof passes 12 months with
  -- no row changing. The sweep revokes its shares and re-syncs it; the second
  -- account, still proved, is left alone. A second run does nothing.
  DELETE FROM pg_temp.i4473_sync_calls;
  UPDATE public.account_claim_contacts
     SET last_proved_at = now() - interval '13 months'
   WHERE user_id = v_linker;
  v_n := public.issue_4473_sweep_lapsed_shared_holders(500);
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'S10 the sweep revoked % rows, expected the 6 lapsed ones', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_shared_holders
              WHERE user_id = v_linker
                AND (revoked_at IS NULL OR revoked_reason <> 'contact_lost'))
     OR (SELECT count(*) FROM public.purchase_shared_holders
          WHERE user_id = v_second AND revoked_at IS NULL) <> 6 THEN
    RAISE EXCEPTION 'S10 the sweep revoked the wrong holders';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.i4473_sync_calls
              WHERE user_id <> v_linker OR source <> 'purchase_share_expiry')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.i4473_sync_calls
                     WHERE user_id = v_linker AND brand_id = v_brand) THEN
    RAISE EXCEPTION 'S10 the lapse did not re-sync exactly the lapsed holder: %',
      (SELECT jsonb_agg(to_jsonb(c)) FROM pg_temp.i4473_sync_calls c);
  END IF;
  IF public.issue_4473_sweep_lapsed_shared_holders(500) <> 0 THEN
    RAISE EXCEPTION 'S10 a second sweep changed rows';
  END IF;
  -- The bound holds.
  UPDATE public.account_claim_contacts
     SET last_proved_at = now() - interval '13 months'
   WHERE user_id = v_second;
  DELETE FROM public.account_claim_contacts WHERE user_id = v_second AND channel = 'phone';
  IF public.issue_4473_sweep_lapsed_shared_holders(4) <> 4
     OR public.issue_4473_sweep_lapsed_shared_holders(4) <> 2 THEN
    RAISE EXCEPTION 'S10 the sweep ignored its batch limit';
  END IF;

  -- S11. The hourly job is registered when pg_cron is present.
  IF to_regnamespace('cron') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'issue_4473_shared_holder_expiry'
       AND schedule = '23 * * * *'
       AND command ILIKE '%issue_4473_sweep_lapsed_shared_holders%'
  ) THEN
    RAISE EXCEPTION 'S11 the expiry job is not scheduled hourly';
  END IF;
END;
$test$;

ROLLBACK;
