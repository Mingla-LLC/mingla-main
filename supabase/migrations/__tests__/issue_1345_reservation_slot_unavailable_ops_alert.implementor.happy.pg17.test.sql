-- Issue #1345 — reservation slot-unavailable ops-alert outbox (PG17 happy).
-- Proves enqueue idempotency, claim lease + claim_id complete, stale-claim
-- rejection, stale-lease reclaim, and atomic record+enqueue.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_session_a constant uuid := '13450000-0000-4000-8000-000000000001';
  v_session_b constant uuid := '13450000-0000-4000-8000-000000000002';
  v_session_c constant uuid := '13450000-0000-4000-8000-000000000003';
  v_user constant uuid := '13450000-0000-4000-8000-0000000000u1';
  v_brand constant uuid := '13450000-0000-4000-8000-0000000000b1';
  v_venue constant uuid := '13450000-0000-4000-8000-0000000000v1';
  v_id_1 uuid;
  v_id_2 uuid;
  v_id_3 uuid;
  v_id_dup uuid;
  v_claim_a uuid;
  v_claim_b uuid;
  v_claim_stale uuid;
  v_status text;
  v_n integer;
  v_claimed integer;
BEGIN
  -- ── Enqueue idempotency + claim lease (outbox has no FK to sessions) ──
  v_id_1 := public.enqueue_reservation_slot_unavailable_alert(
    v_session_a, 'mingla_resv_1345_ref_a', 537500, 'NGN'
  );
  IF v_id_1 IS NULL THEN
    RAISE EXCEPTION '#1345 happy: enqueue returned NULL';
  END IF;

  v_id_dup := public.enqueue_reservation_slot_unavailable_alert(
    v_session_a, 'mingla_resv_1345_ref_a_replay', 999, 'NGN'
  );
  IF v_id_dup IS DISTINCT FROM v_id_1 THEN
    RAISE EXCEPTION '#1345 happy: re-enqueue did not collapse on session_id';
  END IF;
  SELECT count(*) INTO v_n
  FROM public.reservation_slot_unavailable_alert_outbox
  WHERE session_id = v_session_a;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#1345 happy: expected 1 outbox row for session_a, got %', v_n;
  END IF;
  IF (SELECT reference FROM public.reservation_slot_unavailable_alert_outbox
      WHERE id = v_id_1) IS DISTINCT FROM 'mingla_resv_1345_ref_a' THEN
    RAISE EXCEPTION '#1345 happy: conflict rewrite mutated reference';
  END IF;
  IF (SELECT status FROM public.reservation_slot_unavailable_alert_outbox
      WHERE id = v_id_1) IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION '#1345 happy: fresh row not pending';
  END IF;

  v_id_2 := public.enqueue_reservation_slot_unavailable_alert(
    v_session_b, 'mingla_resv_1345_ref_b', 10000, 'NGN'
  );
  IF v_id_2 IS NULL OR v_id_2 = v_id_1 THEN
    RAISE EXCEPTION '#1345 happy: second session did not get its own row';
  END IF;

  SELECT count(*) INTO v_claimed
  FROM public.claim_reservation_slot_unavailable_alerts(
    50, '2027-07-30 00:00:00+00'
  );
  IF v_claimed < 2 THEN
    RAISE EXCEPTION '#1345 happy: claim listed % pending rows (want >=2)', v_claimed;
  END IF;

  SELECT dispatch_claim_id INTO v_claim_a
  FROM public.reservation_slot_unavailable_alert_outbox WHERE id = v_id_1;
  SELECT dispatch_claim_id INTO v_claim_b
  FROM public.reservation_slot_unavailable_alert_outbox WHERE id = v_id_2;
  IF v_claim_a IS NULL OR v_claim_b IS NULL THEN
    RAISE EXCEPTION '#1345 happy: claim did not stamp dispatch_claim_id';
  END IF;
  IF (SELECT status FROM public.reservation_slot_unavailable_alert_outbox WHERE id = v_id_1)
       IS DISTINCT FROM 'dispatching' THEN
    RAISE EXCEPTION '#1345 happy: claimed row not in dispatching';
  END IF;

  -- Young lease must not be reclaimed.
  IF EXISTS (
    SELECT 1 FROM public.claim_reservation_slot_unavailable_alerts(
      50, '2027-07-30 00:05:00+00'
    )
    WHERE alert_id = v_id_1
  ) THEN
    RAISE EXCEPTION '#1345 happy: young dispatching lease was stolen';
  END IF;

  v_status := public.record_reservation_slot_unavailable_alert_delivery(
    v_id_1, v_claim_a, 'provider_accepted', NULL, '2027-07-30 00:06:00+00'
  );
  IF v_status IS DISTINCT FROM 'provider_accepted' THEN
    RAISE EXCEPTION '#1345 happy: complete returned % (want provider_accepted)', v_status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.claim_reservation_slot_unavailable_alerts(
      50, '2027-07-30 00:07:00+00'
    )
    WHERE alert_id = v_id_1
  ) THEN
    RAISE EXCEPTION '#1345 happy: completed row still claimed';
  END IF;

  -- Stale claim token must be rejected.
  BEGIN
    PERFORM public.record_reservation_slot_unavailable_alert_delivery(
      v_id_2, gen_random_uuid(), 'provider_accepted', NULL, '2027-07-30 00:08:00+00'
    );
    RAISE EXCEPTION '#1345 happy: stale claim was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%stale_reservation_slot_unavailable_alert_claim%' THEN
      RAISE;
    END IF;
  END;

  -- Matching claim completes the second row.
  v_status := public.record_reservation_slot_unavailable_alert_delivery(
    v_id_2, v_claim_b, 'provider_accepted', NULL, '2027-07-30 00:09:00+00'
  );
  IF v_status IS DISTINCT FROM 'provider_accepted' THEN
    RAISE EXCEPTION '#1345 happy: second complete returned %', v_status;
  END IF;

  -- Stale-lease reclaim: reset to pending-like dispatching aged past 10m.
  UPDATE public.reservation_slot_unavailable_alert_outbox
  SET status = 'pending',
      dispatch_claim_id = NULL,
      dispatch_claimed_at = NULL,
      notified_at = NULL,
      updated_at = '2027-07-30 00:00:00+00'
  WHERE id = v_id_2;

  SELECT claim_id INTO v_claim_stale
  FROM public.claim_reservation_slot_unavailable_alerts(1, '2027-07-30 01:00:00+00')
  WHERE alert_id = v_id_2;
  IF v_claim_stale IS NULL THEN
    RAISE EXCEPTION '#1345 happy: re-pending row was not claimed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.claim_reservation_slot_unavailable_alerts(
      1, '2027-07-30 01:05:00+00'
    )
    WHERE alert_id = v_id_2
  ) THEN
    RAISE EXCEPTION '#1345 happy: young dispatching lease was stolen (reclaim phase)';
  END IF;

  SELECT claim_id INTO v_claim_b
  FROM public.claim_reservation_slot_unavailable_alerts(1, '2027-07-30 01:11:00+00')
  WHERE alert_id = v_id_2;
  IF v_claim_b IS NULL OR v_claim_b = v_claim_stale THEN
    RAISE EXCEPTION '#1345 happy: stale lease was not reclaimed with a new claim_id';
  END IF;

  BEGIN
    PERFORM public.record_reservation_slot_unavailable_alert_delivery(
      v_id_2, v_claim_stale, 'provider_accepted', NULL, '2027-07-30 01:12:00+00'
    );
    RAISE EXCEPTION '#1345 happy: superseded claim was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%stale_reservation_slot_unavailable_alert_claim%' THEN
      RAISE;
    END IF;
  END;

  -- ── Atomic record+enqueue (needs a real reservation_checkout_sessions row) ──
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'owner-1345@example.test', now(), now()
  );
  INSERT INTO public.creator_accounts (id, created_at) VALUES (v_user, now());
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, payment_provider,
    created_at, updated_at
  ) VALUES (
    v_brand, v_user, 'Issue 1345 Brand', 'issue1345brand', 'NGN', 'paystack',
    now(), now()
  );
  INSERT INTO public.venue_listings (
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES (
    v_venue, v_brand, 'venue1345', 'Venue 1345', 6.45, 3.47,
    'restaurant', 'verified'
  );
  INSERT INTO public.reservation_checkout_sessions (
    id, brand_id, venue_id, reserved_for, party_size, buyer_name, buyer_email,
    buyer_phone_e164, amount_cents, currency, created_via, status,
    application_fee_amount_cents
  ) VALUES (
    v_session_c, v_brand, v_venue, now() + interval '1 day', 2, 'C',
    'c@example.com', '+15555550147', 2500, 'NGN', 'web', 'pending', 0
  );

  v_id_3 := public.record_reservation_slot_unavailable_refund_due(
    v_session_c, 'mingla_resv_1345_ref_c', 2500, 'NGN'
  );
  IF v_id_3 IS NULL THEN
    RAISE EXCEPTION '#1345 happy: atomic record returned NULL';
  END IF;
  IF (SELECT status FROM public.reservation_checkout_sessions WHERE id = v_session_c)
       IS DISTINCT FROM 'failed'
     OR (SELECT failure_reason FROM public.reservation_checkout_sessions
         WHERE id = v_session_c)
       IS DISTINCT FROM 'slot_unavailable_after_charge_refund_due' THEN
    RAISE EXCEPTION '#1345 happy: session_c not marked slot-unavailable failed';
  END IF;
  v_id_dup := public.record_reservation_slot_unavailable_refund_due(
    v_session_c, 'mingla_resv_1345_ref_c_replay', 999, 'NGN'
  );
  IF v_id_dup IS DISTINCT FROM v_id_3 THEN
    RAISE EXCEPTION '#1345 happy: atomic re-record did not collapse';
  END IF;
END
$test$;

ROLLBACK;
\echo 'issue_1345_reservation_slot_unavailable_ops_alert.implementor.happy.pg17: PASS'
