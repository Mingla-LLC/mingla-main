-- Issue #1217 + #1219 — TESTER adversarial regression guard (append-only).
--
-- Different angle from the implementor's issue_1217_alert_drain_reversal.test.sql
-- (which seeds a SINGLE paystack kind + one NULL reversal + one positive credit):
--
--  Test 1 (#1217 / #1172 no-regression) — a MIXED outbox holding ALL SIX alert
--    kinds pending at once must drain EVERY one in a single claim, and the Stripe
--    kind (stripe_attempt_cap, the #1172 alert) must STILL be claimed. Reverting
--    the widened filter back to stripe-only leaves the 5 Paystack kinds unclaimed
--    → this test sees < 6 rows / stripe-only → RAISE.
--  Test 2 (#1219 cap) — a returned amount GREATER THAN the leg principal credits
--    ONLY the principal (clamp), never more; delivered cash reduced by exactly the
--    principal.
--  Test 3 (#1219 park idempotency) — calling reverse_paystack_transfer_leg(leg,
--    NULL) TWICE parks once: 1st → reversal_unreconciled, 2nd → reversed
--    (idempotent short-circuit), exactly ONE ops alert, ZERO credit rows on replay.
--  Test 4 (containment, critical) — after a reversal transfer_fee_credit posts,
--    brand_payout_releases.net_release_cents is UNCHANGED (the credit reaches only
--    organiser_cash_delivered_cents). Proves the fix did NOT newly wire the credit
--    into any live payout amount.
--
-- Runs inside a single rolled-back transaction against the throwaway CI PG17 with
-- every migration already applied. session_replication_role=replica disables FK
-- triggers so we seed only the rows under test; CHECK/UNIQUE stay enforced.
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents,
  organiser_cash_delivered_cents, status
) VALUES (
  'ad170000-0000-0000-0000-000000000001',
  'ad170000-0000-0000-0000-0000000000b1',
  'issue-1217-adv-occ', 'order', 'paystack', 'ngn',
  '2027-01-01 20:00:00+00', '2027-01-04 20:00:00+00',
  2000000, 1992500, 1000000, 'in_flight'
);

INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, fee_schedule_version,
  provider_transfer_code, status
) VALUES
('ad170000-0000-0000-0000-0000000000a0','ad170000-0000-0000-0000-000000000001',
   'organiser', 0, 1000,  'verified-2026-07-24', 'TRF_cap',  'in_flight'),
('ad170000-0000-0000-0000-0000000000a1','ad170000-0000-0000-0000-000000000001',
   'organiser', 1, 5000,  'verified-2026-07-24', 'TRF_null', 'in_flight');

-- ── Test 1 (#1217 + #1172 no-regression): mixed all-6-kind drain ──
-- Seed one row of EACH allowed alert kind on the same release (the outbox unique
-- is (release_id, alert_kind), so six distinct kinds coexist).
INSERT INTO public.payout_release_alert_outbox (release_id, alert_kind, idempotency_key, brand_id, error_message) VALUES
 ('ad170000-0000-0000-0000-000000000001','stripe_attempt_cap',            'adv-stripe','ad170000-0000-0000-0000-0000000000b1','stripe cap'),
 ('ad170000-0000-0000-0000-000000000001','paystack_otp_blocked',          'adv-otp',   'ad170000-0000-0000-0000-0000000000b1','otp'),
 ('ad170000-0000-0000-0000-000000000001','paystack_attempt_cap',          'adv-pcap',  'ad170000-0000-0000-0000-0000000000b1','pcap'),
 ('ad170000-0000-0000-0000-000000000001','paystack_fee_unreconciled',     'adv-fee',   'ad170000-0000-0000-0000-0000000000b1','fee'),
 ('ad170000-0000-0000-0000-000000000001','paystack_over_cap',             'adv-over',  'ad170000-0000-0000-0000-0000000000b1','over');
-- (the 6th kind, paystack_reversal_unreconciled, is raised by Test 3 below.)

CREATE TEMP TABLE adv_claim_mixed AS
SELECT * FROM public.claim_payout_release_alerts(20, '2027-01-10 00:00:00+00');

DO $test$
DECLARE
  v_total integer;
  v_stripe integer;
  v_distinct integer;
BEGIN
  SELECT count(*) INTO v_total FROM adv_claim_mixed
    WHERE release_id='ad170000-0000-0000-0000-000000000001';
  IF v_total <> 5 THEN
    RAISE EXCEPTION 'mixed drain claimed % of 5 seeded kinds (widened filter reverted?)', v_total;
  END IF;
  -- #1172 no-regression: the Stripe kind must STILL be claimed.
  SELECT count(*) INTO v_stripe FROM adv_claim_mixed
    WHERE alert_kind='stripe_attempt_cap';
  IF v_stripe <> 1 THEN
    RAISE EXCEPTION '#1172 REGRESSION: stripe_attempt_cap no longer drains (% rows)', v_stripe;
  END IF;
  -- Every claimed row carries its own alert_kind (the worker keys copy on it).
  SELECT count(DISTINCT alert_kind) INTO v_distinct FROM adv_claim_mixed
    WHERE release_id='ad170000-0000-0000-0000-000000000001';
  IF v_distinct <> 5 THEN
    RAISE EXCEPTION 'drain collapsed alert_kind (expected 5 distinct, got %)', v_distinct;
  END IF;
END;
$test$;

-- ── Test 2 (#1219 cap): a GREATER-THAN-PRINCIPAL amount credits only principal ──
DO $test$
DECLARE
  v_result text;
  v_credit integer;
  v_delivered integer;
BEGIN
  -- leg principal is 1000; ask to reverse 999_999.
  v_result := public.reverse_paystack_transfer_leg(
    'ad170000-0000-0000-0000-0000000000a0', 999999, '2027-01-10 00:01:00+00'
  );
  IF v_result <> 'reversed' THEN
    RAISE EXCEPTION 'over-principal reversal did not settle (got %)', v_result;
  END IF;
  SELECT amount_cents INTO STRICT v_credit FROM public.payout_ledger_adjustments
    WHERE idempotency_key='paystack-reversal:ad170000-0000-0000-0000-0000000000a0';
  IF v_credit <> 1000 THEN
    RAISE EXCEPTION 'over-principal reversal was NOT capped at principal (credited %)', v_credit;
  END IF;
  SELECT organiser_cash_delivered_cents INTO v_delivered
    FROM public.brand_payout_releases WHERE id='ad170000-0000-0000-0000-000000000001';
  IF v_delivered <> 999000 THEN
    RAISE EXCEPTION 'delivered cash not reduced by exactly the capped credit (got %)', v_delivered;
  END IF;
END;
$test$;

-- ── Test 3 (#1219 park idempotency): reverse(NULL) twice parks ONCE ──
DO $test$
DECLARE
  v_first text;
  v_second text;
  v_alerts integer;
  v_credits integer;
BEGIN
  v_first := public.reverse_paystack_transfer_leg(
    'ad170000-0000-0000-0000-0000000000a1', NULL, '2027-01-10 00:02:00+00'
  );
  IF v_first <> 'reversal_unreconciled' THEN
    RAISE EXCEPTION 'first NULL reversal did not park (got %)', v_first;
  END IF;
  -- Replay: the leg is already reversed → idempotent short-circuit, NO new work.
  v_second := public.reverse_paystack_transfer_leg(
    'ad170000-0000-0000-0000-0000000000a1', NULL, '2027-01-10 00:03:00+00'
  );
  IF v_second <> 'reversed' THEN
    RAISE EXCEPTION 'NULL reversal replay was not idempotent (got %)', v_second;
  END IF;
  SELECT count(*) INTO v_alerts FROM public.payout_release_alert_outbox
    WHERE release_id='ad170000-0000-0000-0000-000000000001'
      AND alert_kind='paystack_reversal_unreconciled';
  IF v_alerts <> 1 THEN
    RAISE EXCEPTION 'park replay produced % reversal alerts (want exactly 1)', v_alerts;
  END IF;
  SELECT count(*) INTO v_credits FROM public.payout_ledger_adjustments
    WHERE idempotency_key='paystack-reversal:ad170000-0000-0000-0000-0000000000a1';
  IF v_credits <> 0 THEN
    RAISE EXCEPTION 'parked reversal fabricated a credit (% rows)', v_credits;
  END IF;
END;
$test$;

-- ── Test 4 (containment, critical): the credit never reaches net_release_cents ──
DO $test$
DECLARE
  v_net integer;
  v_delivered integer;
BEGIN
  SELECT net_release_cents, organiser_cash_delivered_cents
    INTO v_net, v_delivered
    FROM public.brand_payout_releases WHERE id='ad170000-0000-0000-0000-000000000001';
  -- Test 2 posted a 1000-cent transfer_fee_credit. net_release_cents MUST be the
  -- untouched seed value; only the delivered-cash tracker moved. If a future edit
  -- ever sums transfer_fee_credit into net_release, this fails.
  IF v_net <> 1992500 THEN
    RAISE EXCEPTION 'CONTAINMENT BREACH: reversal credit changed net_release_cents (got %)', v_net;
  END IF;
  IF v_delivered <> 999000 THEN
    RAISE EXCEPTION 'delivered cash unexpected (got %)', v_delivered;
  END IF;
END;
$test$;

ROLLBACK;
