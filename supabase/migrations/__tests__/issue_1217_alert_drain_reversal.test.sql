-- Issue #1217 + #1219 — migration-level regression guard (append-only).
--
-- #1217: claim_payout_release_alerts now drains the Paystack alert kinds (not
--   just stripe_attempt_cap) AND returns alert_kind. Fails-on-revert: reverting
--   the widened filter leaves the paystack row unclaimed → the STRICT select in
--   Test A finds 0 rows and RAISEs.
-- #1219: reverse_paystack_transfer_leg treats a NULL returned amount as unknown
--   → parks (leg reversed) + alerts paystack_reversal_unreconciled crediting
--   NOTHING; a positive amount credits only that (capped). Fails-on-revert:
--   restoring the old NULL RAISE aborts Test B.
--
-- Runs inside a single rolled-back transaction against the throwaway CI PG17
-- (all migrations already applied). session_replication_role=replica disables FK
-- triggers so we seed only the rows under test; CHECK constraints stay enforced.
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents,
  organiser_cash_delivered_cents, status
) VALUES (
  '12170000-0000-0000-0000-000000000001',
  '12170000-0000-0000-0000-0000000000b1',
  'issue-1217-occ',
  'order',
  'paystack',
  'ngn',
  '2027-01-01 20:00:00+00',
  '2027-01-04 20:00:00+00',
  2000000,
  1992500,
  1000000,
  'in_flight'
);

INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, fee_schedule_version,
  provider_transfer_code, status
) VALUES
(
  '12170000-0000-0000-0000-0000000000a0',
  '12170000-0000-0000-0000-000000000001',
  'organiser', 0, 1992500, 'verified-2026-07-24', 'TRF_park', 'in_flight'
),
(
  '12170000-0000-0000-0000-0000000000a1',
  '12170000-0000-0000-0000-000000000001',
  'organiser', 1, 1000, 'verified-2026-07-24', 'TRF_credit', 'in_flight'
);

-- A Paystack alert kind that #1177 writes but the pre-#1217 drain never claimed.
INSERT INTO public.payout_release_alert_outbox (
  release_id, alert_kind, idempotency_key, brand_id, error_message
) VALUES (
  '12170000-0000-0000-0000-000000000001',
  'paystack_otp_blocked',
  'paystack_otp_blocked:12170000-0000-0000-0000-000000000001',
  '12170000-0000-0000-0000-0000000000b1',
  'transfer OTP still enabled'
);

-- ── Test A (#1217): the drain claims the Paystack kind AND returns alert_kind ──
CREATE TEMP TABLE issue_1217_claim_one AS
SELECT * FROM public.claim_payout_release_alerts(20, '2027-01-10 00:00:00+00');

DO $test$
DECLARE
  v_kind text;
BEGIN
  SELECT alert_kind INTO STRICT v_kind
  FROM issue_1217_claim_one
  WHERE release_id='12170000-0000-0000-0000-000000000001';
  IF v_kind <> 'paystack_otp_blocked' THEN
    RAISE EXCEPTION 'drain returned wrong alert_kind: %', v_kind;
  END IF;
END;
$test$;

-- ── Test B (#1219): NULL returned amount parks + alerts, credits NOTHING ──
DO $test$
DECLARE
  v_result text;
  v_leg_status text;
  v_credit_count integer;
  v_alert_count integer;
BEGIN
  v_result := public.reverse_paystack_transfer_leg(
    '12170000-0000-0000-0000-0000000000a0', NULL, '2027-01-10 00:01:00+00'
  );
  IF v_result <> 'reversal_unreconciled' THEN
    RAISE EXCEPTION 'NULL reversal did not park (got %)', v_result;
  END IF;
  SELECT status INTO v_leg_status FROM public.payout_transfer_legs
    WHERE id='12170000-0000-0000-0000-0000000000a0';
  IF v_leg_status <> 'reversed' THEN
    RAISE EXCEPTION 'parked leg not marked reversed (got %)', v_leg_status;
  END IF;
  -- No credit adjustment for a parked (unknown-amount) reversal.
  SELECT count(*) INTO v_credit_count FROM public.payout_ledger_adjustments
    WHERE idempotency_key='paystack-reversal:12170000-0000-0000-0000-0000000000a0';
  IF v_credit_count <> 0 THEN
    RAISE EXCEPTION 'NULL reversal fabricated a credit (% rows)', v_credit_count;
  END IF;
  -- Ops alert raised for manual reconciliation.
  SELECT count(*) INTO v_alert_count FROM public.payout_release_alert_outbox
    WHERE release_id='12170000-0000-0000-0000-000000000001'
      AND alert_kind='paystack_reversal_unreconciled';
  IF v_alert_count <> 1 THEN
    RAISE EXCEPTION 'reversal-unreconciled alert not raised (% rows)', v_alert_count;
  END IF;
END;
$test$;

-- ── Test C (#1219): a positive returned amount credits ONLY that (capped) ──
DO $test$
DECLARE
  v_result text;
  v_amount integer;
  v_delivered integer;
BEGIN
  v_result := public.reverse_paystack_transfer_leg(
    '12170000-0000-0000-0000-0000000000a1', 700, '2027-01-10 00:02:00+00'
  );
  IF v_result <> 'reversed' THEN
    RAISE EXCEPTION 'positive reversal did not settle (got %)', v_result;
  END IF;
  SELECT amount_cents INTO STRICT v_amount FROM public.payout_ledger_adjustments
    WHERE idempotency_key='paystack-reversal:12170000-0000-0000-0000-0000000000a1'
      AND kind='transfer_fee_credit';
  IF v_amount <> 700 THEN
    RAISE EXCEPTION 'positive reversal credited wrong amount (got %)', v_amount;
  END IF;
  SELECT organiser_cash_delivered_cents INTO v_delivered
    FROM public.brand_payout_releases
    WHERE id='12170000-0000-0000-0000-000000000001';
  IF v_delivered <> 999300 THEN
    RAISE EXCEPTION 'delivered cash not reduced by the credit (got %)', v_delivered;
  END IF;
END;
$test$;

-- ── Test D (#1217+#1219): the new reversal alert kind is itself drainable ──
CREATE TEMP TABLE issue_1217_claim_two AS
SELECT * FROM public.claim_payout_release_alerts(20, '2027-01-10 00:03:00+00');

DO $test$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1217_claim_two
    WHERE release_id='12170000-0000-0000-0000-000000000001'
      AND alert_kind='paystack_reversal_unreconciled';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'reversal-unreconciled alert was not drainable (% rows)', v_count;
  END IF;
END;
$test$;

ROLLBACK;
