-- Issue #1345 — reservation slot-unavailable ops-alert outbox (PG17 happy).
-- Proves enqueue idempotency (session_id unique) + claim/complete drain shape.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_session_a constant uuid := '13450000-0000-4000-8000-000000000001';
  v_session_b constant uuid := '13450000-0000-4000-8000-000000000002';
  v_id_1 uuid;
  v_id_2 uuid;
  v_id_dup uuid;
  v_n integer;
  v_claimed integer;
BEGIN
  v_id_1 := public.enqueue_reservation_slot_unavailable_alert(
    v_session_a, 'mingla_resv_1345_ref_a', 537500, 'NGN'
  );
  IF v_id_1 IS NULL THEN
    RAISE EXCEPTION '#1345 happy: enqueue returned NULL';
  END IF;

  -- Idempotent re-enqueue for the same session returns the same row.
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
  -- Original reference/amount are preserved (ON CONFLICT DO NOTHING).
  IF (SELECT reference FROM public.reservation_slot_unavailable_alert_outbox
      WHERE id = v_id_1) IS DISTINCT FROM 'mingla_resv_1345_ref_a' THEN
    RAISE EXCEPTION '#1345 happy: conflict rewrite mutated reference';
  END IF;

  v_id_2 := public.enqueue_reservation_slot_unavailable_alert(
    v_session_b, 'mingla_resv_1345_ref_b', 10000, 'NGN'
  );
  IF v_id_2 IS NULL OR v_id_2 = v_id_1 THEN
    RAISE EXCEPTION '#1345 happy: second session did not get its own row';
  END IF;

  SELECT count(*) INTO v_claimed
  FROM public.claim_reservation_slot_unavailable_alerts(50);
  IF v_claimed < 2 THEN
    RAISE EXCEPTION '#1345 happy: claim listed % pending rows (want >=2)', v_claimed;
  END IF;

  v_n := public.complete_reservation_slot_unavailable_alerts(ARRAY[v_id_1]);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#1345 happy: complete returned % (want 1)', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.claim_reservation_slot_unavailable_alerts(50)
    WHERE alert_id = v_id_1
  ) THEN
    RAISE EXCEPTION '#1345 happy: completed row still claimed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.claim_reservation_slot_unavailable_alerts(50)
    WHERE alert_id = v_id_2
  ) THEN
    RAISE EXCEPTION '#1345 happy: unfinished row disappeared from claim';
  END IF;

  -- Completing again is a no-op (already notified).
  v_n := public.complete_reservation_slot_unavailable_alerts(ARRAY[v_id_1]);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '#1345 happy: second complete should be 0, got %', v_n;
  END IF;
END
$test$;

ROLLBACK;
\echo 'issue_1345_reservation_slot_unavailable_ops_alert.implementor.happy.pg17: PASS'
