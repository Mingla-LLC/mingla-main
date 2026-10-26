-- Issue #4063 Wave 5b / M9 — host booking phone enforcement.
--
-- MINGLA-INVARIANT: I-4063-HOST-BOOKING-HAS-PHONE | issue #4063 | every direct host booking source supplies a valid E.164 guest phone; waitlist conversion remains a separate compatibility path

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '40630000-0000-4000-8000-000000005501';
  v_brand constant uuid := '40630000-0000-4000-8000-000000005502';
  v_venue constant uuid := '40630000-0000-4000-8000-000000005503';
  v_wait constant uuid := '40630000-0000-4000-8000-000000005504';
  v_source text;
  v_state text;
  v_message text;
  v_before bigint;
  v_after bigint;
  v_created public.reservations;
  v_converted public.reservations;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'host-booking-4063@example.test'
  );
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'Issue 4063 Booking', 'issue-4063-booking');
  INSERT INTO public.venue_listings (
    id, brand_id, slug, name, lat, lng, venue_category
  ) VALUES (
    v_venue, v_brand, 'issue4063bookingvenue',
    'Issue 4063 Booking Venue', 40.7128, -74.0060, 'restaurant'
  );

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT count(*) INTO v_before FROM public.reservations WHERE venue_id = v_venue;

  FOREACH v_source IN ARRAY ARRAY['mingla','phone','walk_in','website','instagram']::text[] LOOP
    v_state := NULL;
    v_message := NULL;
    BEGIN
      PERFORM public.biz_reservation_create(
        v_venue, now() + interval '2 hours', 2, v_source,
        'No Phone ' || v_source, NULL
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;
    END;
    IF v_state IS DISTINCT FROM '22023'
       OR v_message IS DISTINCT FROM 'reservation_phone_required' THEN
      RAISE EXCEPTION
        'T5-10 FAIL [FAILS-ON-REVERT CONFIRMED]: source % without a phone returned state %, message %',
        v_source, coalesce(v_state, 'none'), coalesce(v_message, 'none');
    END IF;
  END LOOP;

  SELECT count(*) INTO v_after FROM public.reservations WHERE venue_id = v_venue;
  IF v_after <> v_before THEN
    RAISE EXCEPTION
      'T5-10 FAIL: refused direct bookings wrote reservation rows (% -> %)',
      v_before, v_after;
  END IF;
  RAISE NOTICE
    'PASS T5-10 every direct source, including walk_in, refuses a missing phone without writing';

  v_state := NULL;
  v_message := NULL;
  BEGIN
    PERFORM public.biz_reservation_create(
      v_venue, now() + interval '3 hours', 2, 'phone',
      'Blank Phone', '   '
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_state = RETURNED_SQLSTATE,
      v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '22023'
     OR v_message IS DISTINCT FROM 'reservation_phone_required' THEN
    RAISE EXCEPTION
      'T5-10 FAIL: a blank phone returned state %, message %',
      coalesce(v_state, 'none'), coalesce(v_message, 'none');
  END IF;
  RAISE NOTICE 'PASS T5-10 blank phone input is treated as missing';

  v_created := public.biz_reservation_create(
    v_venue, now() + interval '4 hours', 2, 'walk_in',
    'Valid Walk In', '+12025554063'
  );
  IF v_created.id IS NULL
     OR v_created.guest_phone_e164 IS DISTINCT FROM '+12025554063'
     OR v_created.source IS DISTINCT FROM 'walk_in' THEN
    RAISE EXCEPTION 'T5-10 FAIL: a valid walk_in phone did not create normally';
  END IF;
  RAISE NOTICE 'PASS T5-10 a valid E.164 walk_in booking still succeeds';

  INSERT INTO public.venue_waitlist (
    id, brand_id, venue_id, party_size, guest_name, guest_phone_e164, status
  ) VALUES (
    v_wait, v_brand, v_venue, 3, 'Waitlist Guest', NULL, 'waiting'
  );
  v_converted := public.biz_waitlist_convert_to_reservation(
    v_wait, now() + interval '5 hours', NULL
  );
  IF v_converted.id IS NULL
     OR v_converted.source IS DISTINCT FROM 'walk_in'
     OR v_converted.guest_phone_e164 IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.venue_waitlist
        WHERE id = v_wait
          AND status = 'converted'
          AND converted_reservation_id = v_converted.id
     ) THEN
    RAISE EXCEPTION
      'T5-9 FAIL: phone-less waitlist conversion did not preserve the compatibility path';
  END IF;
  RAISE NOTICE
    'PASS T5-9 waitlist conversion without a phone remains allowed and atomic';
END;
$test$;

ROLLBACK;
