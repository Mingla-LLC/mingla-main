\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner uuid := '40630000-0000-4000-8000-000000006001';
  v_buyer uuid := '40630000-0000-4000-8000-000000006002';
  v_brand uuid := '40630000-0000-4000-8000-000000006003';
  v_venue uuid := '40630000-0000-4000-8000-000000006004';
  v_table_a uuid := '40630000-0000-4000-8000-000000006005';
  v_table_b uuid := '40630000-0000-4000-8000-000000006006';
  v_off uuid := '40630000-0000-4000-8000-000000006007';
  v_on uuid := '40630000-0000-4000-8000-000000006008';
  v_requested uuid := '40630000-0000-4000-8000-000000006009';
  v_quiet_count integer;
  v_rows jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-4063-reservation-owner@example.test'),
    (v_buyer, 'issue-4063-reservation-buyer@example.test');
  INSERT INTO public.account_claim_contacts(
    user_id, channel, value, verified_via
  ) VALUES (
    v_buyer, 'email', 'switch-on@example.test', 'email_code'
  );
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, default_currency
  ) VALUES (
    v_brand, v_owner, 'Wrong brand name', 'issue-4063-reservation-brand',
    'stripe', 'USD'
  );
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, address, city, country_code, lat, lng,
    venue_category, claim_status
  ) VALUES (
    v_venue, v_brand, 'issue4063reservation', 'Issue 4063 Supper Club',
    '17 Message Lane', 'Brooklyn', 'US', 40.7, -74.0,
    'restaurant', 'verified'
  );
  INSERT INTO public.venue_availability_config(
    brand_id, venue_id, iana_timezone, iana_timezone_source
  ) VALUES (v_brand, v_venue, 'America/New_York', 'operator');
  INSERT INTO public.venue_tables(id, brand_id, venue_id, name, capacity)
  VALUES
    (v_table_a, v_brand, v_venue, 'Window', 4),
    (v_table_b, v_brand, v_venue, 'Garden', 4);

  -- Switch-off replay keeps the existing single-row producer contract.
  INSERT INTO public.reservations(
    id, brand_id, venue_id, table_id, reserved_for, party_size, status,
    source, created_via, guest_name, guest_phone_e164, guest_email,
    consumer_user_id
  ) VALUES (
    v_off, v_brand, v_venue, v_table_a, now() + interval '2 days', 2,
    'confirmed', 'mingla', 'consumer', 'Switch Off Guest', '+12025550631',
    'SWITCH-OFF@EXAMPLE.TEST', v_buyer
  );
  IF (
    SELECT count(*) FROM public.notification_outbox
     WHERE idempotency_key = 'buyer_reservation_confirmed:' || v_off
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key LIKE 'buyer_reservation_confirmed:' || v_off || ':%'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key = 'buyer_reservation_confirmed:' || v_off
       AND contact = '+12025550631'
       AND NOT (payload ? 'venue_name')
       AND NOT (payload ? 'timezone')
  ) THEN
    RAISE EXCEPTION 'switch-off reservation producer contract drifted';
  END IF;

  UPDATE public.issue_4063_switches
     SET enabled = true, changed_at = now()
   WHERE name = 'messages_v2';

  -- A born-confirmed reservation gets one email row and one dedicated SMS row.
  INSERT INTO public.reservations(
    id, brand_id, venue_id, table_id, reserved_for, party_size, status,
    source, created_via, guest_name, guest_phone_e164, guest_email,
    consumer_user_id
  ) VALUES (
    v_on, v_brand, v_venue, v_table_a, now() + interval '3 days', 3,
    'confirmed', 'mingla', 'consumer', 'Switch On Guest', '+12025550632',
    'SWITCH-ON@EXAMPLE.TEST', v_buyer
  );
  IF (
    SELECT count(*) FROM public.notification_outbox
     WHERE idempotency_key IN (
       'buyer_reservation_confirmed:' || v_on || ':email',
       'buyer_reservation_confirmed:' || v_on || ':sms'
     )
  ) <> 2 THEN
    RAISE EXCEPTION 'reservation confirmation did not split into two rows';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key = 'buyer_reservation_confirmed:' || v_on || ':email'
       AND user_id = v_buyer
       AND contact = 'switch-on@example.test'
       AND country_code = 'US'
       AND payload->>'venue_id' = v_venue::text
       AND payload->>'venue_name' = 'Issue 4063 Supper Club'
       AND payload->>'venue_name' <> 'Wrong brand name'
       AND payload->>'venue_address' = '17 Message Lane'
       AND payload->>'venue_city' = 'Brooklyn'
       AND payload->>'timezone' = 'America/New_York'
       AND payload->>'created_via' = 'consumer'
       AND payload->>'claimed' = 'true'
       AND NOT (payload ? 'channel_hint')
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key = 'buyer_reservation_confirmed:' || v_on || ':sms'
       AND user_id IS NULL
       AND contact = '+12025550632'
       AND country_code = 'US'
       AND payload->>'channel_hint' = 'sms'
       AND payload->>'venue_name' = 'Issue 4063 Supper Club'
  ) THEN
    SELECT jsonb_agg(to_jsonb(outbox)) INTO v_rows
      FROM public.notification_outbox AS outbox
     WHERE outbox.payload->>'reservation_id' = v_on::text;
    RAISE EXCEPTION
      'reservation channel row authority or payload is malformed: %', v_rows;
  END IF;

  -- Table-only and status-only transitions stay quiet.
  SELECT count(*) INTO v_quiet_count
    FROM public.notification_outbox
   WHERE payload->>'reservation_id' = v_on::text;
  UPDATE public.reservations SET table_id = v_table_b WHERE id = v_on;
  UPDATE public.reservations SET status = 'seated' WHERE id = v_on;
  UPDATE public.reservations SET status = 'completed' WHERE id = v_on;
  UPDATE public.reservations SET status = 'no_show' WHERE id = v_on;
  IF (
    SELECT count(*) FROM public.notification_outbox
     WHERE payload->>'reservation_id' = v_on::text
  ) <> v_quiet_count THEN
    RAISE EXCEPTION 'quiet reservation transition emitted a message';
  END IF;

  -- A requested-to-confirmed transition uses the same stable channel keys,
  -- while a later party-size edit emits one changed row per channel.
  INSERT INTO public.reservations(
    id, brand_id, venue_id, reserved_for, party_size, status, source,
    created_via, guest_name, guest_phone_e164, guest_email
  ) VALUES (
    v_requested, v_brand, v_venue, now() + interval '4 days', 2,
    'requested', 'website', 'guest', 'Requested Guest', '+12025550633',
    'requested@example.test'
  );
  UPDATE public.reservations SET status = 'confirmed' WHERE id = v_requested;
  IF (
    SELECT count(*) FROM public.notification_outbox
     WHERE idempotency_key IN (
       'buyer_reservation_confirmed:' || v_requested || ':email',
       'buyer_reservation_confirmed:' || v_requested || ':sms'
     )
  ) <> 2 THEN
    RAISE EXCEPTION 'requested confirmation did not use stable channel keys';
  END IF;

  UPDATE public.reservations SET party_size = 4 WHERE id = v_requested;
  IF (
    SELECT count(*) FROM public.notification_outbox
     WHERE category_key = 'buyer_reservation_changed'
       AND payload->>'reservation_id' = v_requested::text
       AND payload->>'party_size' = '4'
       AND payload->>'previous_party_size' = '2'
       AND (
         idempotency_key LIKE 'buyer_reservation_changed:' || v_requested || ':%:email'
         OR idempotency_key LIKE 'buyer_reservation_changed:' || v_requested || ':%:sms'
       )
  ) <> 2 THEN
    RAISE EXCEPTION 'party-size edit did not create two changed channel rows';
  END IF;
END;
$test$;

ROLLBACK;
