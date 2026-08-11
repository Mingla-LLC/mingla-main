-- Issue #1840 — migration-level regression guard (append-only).
--
-- D1: a blocked_balance park now raises a paystack_balance_blocked ops alert,
--     deduped per release, and the DRAIN actually returns it.
-- D2: paystack_payout_float_obligation reads the maturing NGN obligation from
--     the payout ledger (never a balance), excluding already-settled legs; and
--     raise_paystack_float_shortfall_alert raises exactly one drainable
--     paystack_float_shortfall alert when the balance cannot cover it.
--
-- THE VACUITY GUARD. Tests C and H do NOT assert "an outbox row exists" — that
-- assertion would pass against the #1217 defect, where rows are written and
-- deduped and then NEVER DELIVERED because claim_payout_release_alerts filters
-- on a hardcoded alert_kind IN (...) list. They call the drain and require it to
-- RETURN the row. Reverting either kind out of the drain list fails them (and
-- the migration's own advisory block aborts before they ever run).
--
-- Fails-on-revert:
--   * remove the blocked_balance outbox INSERT      → Test A raises;
--   * remove either kind from the drain IN-list     → Test C / Test H raise;
--   * count succeeded legs in the obligation        → Test D raises;
--   * derive the obligation from the balance        → Test E/F raise;
--   * drop the shortfall dedupe                     → Test G raises.
--
-- Runs inside a single rolled-back transaction against the throwaway CI PG17
-- (all migrations already applied). session_replication_role=replica disables FK
-- triggers so we seed only the rows under test; CHECK constraints stay enforced.
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

-- ── Seeds ──────────────────────────────────────────────────────────────────
-- "now" for every assertion below is 2027-02-01T00:00:00Z.
--
--   D1  releasable 2027-04-02 (+60d) — outside a 7-day horizon on purpose, so
--       the D1 park does not perturb the D2 arithmetic; it reappears at 90 days.
--   R1  releasable 2027-02-02 (+1d)  — no legs planned yet ⇒ pool + recredit.
--   R2  releasable 2027-02-05 (+4d)  — legs planned; one organiser leg already
--       succeeded, so only the outstanding organiser leg + the partner leg
--       count. net_release_cents is deliberately NOT the leg sum: if the
--       obligation fell back to the pool for a planned release, Test D fails.
--   R3  releasable 2027-03-05 (+32d) — outside 7 days, inside 90.
--   R4  status 'released'            — already paid; never counted.
INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents,
  organiser_cash_delivered_cents, status
) VALUES
(
  '18400000-0000-0000-0000-0000000000d1',
  '18400000-0000-0000-0000-0000000000b1',
  'issue-1840-d1','order','paystack','ngn',
  '2027-03-30 00:00:00+00','2027-04-02 00:00:00+00',
  2000000, 2000000, 0, 'pending'
),
(
  '18400000-0000-0000-0000-000000000001',
  '18400000-0000-0000-0000-0000000000b1',
  'issue-1840-r1','order','paystack','ngn',
  '2027-01-30 00:00:00+00','2027-02-02 00:00:00+00',
  1100000, 1000000, 0, 'pending'
),
(
  '18400000-0000-0000-0000-000000000002',
  '18400000-0000-0000-0000-0000000000b2',
  'issue-1840-r2','order','paystack','ngn',
  '2027-02-02 00:00:00+00','2027-02-05 00:00:00+00',
  900000, 802500, 0, 'blocked_balance'
),
(
  '18400000-0000-0000-0000-000000000003',
  '18400000-0000-0000-0000-0000000000b3',
  'issue-1840-r3','order','paystack','ngn',
  '2027-03-02 00:00:00+00','2027-03-05 00:00:00+00',
  800000, 777000, 0, 'pending'
),
(
  '18400000-0000-0000-0000-000000000004',
  '18400000-0000-0000-0000-0000000000b4',
  'issue-1840-r4','order','paystack','ngn',
  '2027-01-31 00:00:00+00','2027-02-03 00:00:00+00',
  600000, 600000, 600000, 'released'
);

INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status
) VALUES
-- D1's single planned organiser chunk (principal + fee + stamp = 2,000,000).
(
  '18400000-0000-0000-0000-0000000000a0',
  '18400000-0000-0000-0000-0000000000d1',
  'organiser', 0, 1992500, 2500, 5000, 'verified-2026-07-24', 'planned'
),
-- R2 chunk 0 already succeeded — it must NOT be counted again.
(
  '18400000-0000-0000-0000-0000000000a1',
  '18400000-0000-0000-0000-000000000002',
  'organiser', 0, 500000, 2500, 5000, 'verified-2026-07-24', 'succeeded'
),
-- R2 chunk 1 still outstanding — 300,000 + 2,500 + 0 = 302,500.
(
  '18400000-0000-0000-0000-0000000000a2',
  '18400000-0000-0000-0000-000000000002',
  'organiser', 1, 300000, 2500, 0, 'verified-2026-07-24', 'planned'
),
-- R2's partner leg draws on the same balance — 50,000 + 1,000 + 0 = 51,000.
(
  '18400000-0000-0000-0000-0000000000a3',
  '18400000-0000-0000-0000-000000000002',
  'partner', 0, 50000, 1000, 0, 'verified-2026-07-24', 'planned'
);

-- R1's matured recredit (+25,000) is part of the pool it will be chunked from.
INSERT INTO public.payout_ledger_adjustments (
  release_id, brand_id, currency, kind, amount_cents, idempotency_key
) VALUES (
  '18400000-0000-0000-0000-000000000001',
  '18400000-0000-0000-0000-0000000000b1',
  'ngn','maturity_recredit',25000,'issue-1840-r1-recredit'
);

-- ── Test A (D1): the park raises a paystack_balance_blocked alert ──────────
DO $test$
DECLARE
  v_result text;
  v_status text;
  v_alerts integer;
BEGIN
  v_result := public.record_paystack_transfer_leg_outcome(
    '18400000-0000-0000-0000-0000000000a0',
    '18400000-0000-0000-0000-0000000000d1',
    'blocked_balance', NULL, NULL, NULL,
    '2027-02-01 00:00:00+00'
  );
  IF v_result <> 'blocked_balance' THEN
    RAISE EXCEPTION 'park did not return blocked_balance (got %)', v_result;
  END IF;
  SELECT status INTO v_status FROM public.brand_payout_releases
    WHERE id='18400000-0000-0000-0000-0000000000d1';
  IF v_status <> 'blocked_balance' THEN
    RAISE EXCEPTION 'release not parked (got %)', v_status;
  END IF;
  SELECT count(*) INTO v_alerts FROM public.payout_release_alert_outbox
    WHERE release_id='18400000-0000-0000-0000-0000000000d1'
      AND alert_kind='paystack_balance_blocked';
  IF v_alerts <> 1 THEN
    RAISE EXCEPTION 'blocked_balance raised no alert (% rows)', v_alerts;
  END IF;
END;
$test$;

-- ── Test B (D1): blocking on every tick raises ONE alert, not one per tick ──
DO $test$
DECLARE
  v_alerts integer;
  v_leg_status text;
BEGIN
  PERFORM public.record_paystack_transfer_leg_outcome(
    '18400000-0000-0000-0000-0000000000a0',
    '18400000-0000-0000-0000-0000000000d1',
    'blocked_balance', NULL, NULL, NULL,
    '2027-02-01 00:05:00+00'
  );
  PERFORM public.record_paystack_transfer_leg_outcome(
    '18400000-0000-0000-0000-0000000000a0',
    '18400000-0000-0000-0000-0000000000d1',
    'blocked_balance', NULL, NULL, NULL,
    '2027-02-01 00:10:00+00'
  );
  SELECT count(*) INTO v_alerts FROM public.payout_release_alert_outbox
    WHERE release_id='18400000-0000-0000-0000-0000000000d1'
      AND alert_kind='paystack_balance_blocked';
  IF v_alerts <> 1 THEN
    RAISE EXCEPTION 'blocked_balance alert is not deduped (% rows)', v_alerts;
  END IF;
  -- Money-safety: parking never touches the leg, so nothing about the release
  -- amount, chunk plan or attempt budget moved.
  SELECT status INTO v_leg_status FROM public.payout_transfer_legs
    WHERE id='18400000-0000-0000-0000-0000000000a0';
  IF v_leg_status <> 'planned' THEN
    RAISE EXCEPTION 'park mutated the leg (got %)', v_leg_status;
  END IF;
  IF (SELECT attempt_count FROM public.payout_transfer_legs
      WHERE id='18400000-0000-0000-0000-0000000000a0') <> 0 THEN
    RAISE EXCEPTION 'park burned a transfer attempt';
  END IF;
END;
$test$;

-- ── Test C (D1 VACUITY GUARD): the drain actually RETURNS the new kind ─────
-- Asserting the outbox row exists is worthless on its own — that is exactly the
-- #1217 defect. This claims through claim_payout_release_alerts instead.
CREATE TEMP TABLE issue_1840_claim_one AS
SELECT * FROM public.claim_payout_release_alerts(20, '2027-02-01 01:00:00+00');

DO $test$
DECLARE
  v_kind text;
BEGIN
  SELECT alert_kind INTO STRICT v_kind
  FROM issue_1840_claim_one
  WHERE release_id='18400000-0000-0000-0000-0000000000d1';
  IF v_kind <> 'paystack_balance_blocked' THEN
    RAISE EXCEPTION 'drain returned wrong alert_kind: %', v_kind;
  END IF;
END;
$test$;

-- ── Test D (D2): the obligation is ledger-only and excludes settled legs ───
DO $test$
DECLARE
  v jsonb;
BEGIN
  v := public.paystack_payout_float_obligation(7, '2027-02-01 00:00:00+00');
  -- R1 pool 1,000,000 + recredit 25,000 = 1,025,000
  -- R2 outstanding organiser 302,500 + partner 51,000 = 353,500
  --    (the succeeded 507,500 chunk is excluded; the 802,500 pool is ignored
  --     because the legs are already planned)
  IF (v->>'obligation_kobo')::bigint <> 1378500 THEN
    RAISE EXCEPTION 'wrong horizon obligation: %', v->>'obligation_kobo';
  END IF;
  IF (v->>'release_count')::integer <> 2 THEN
    RAISE EXCEPTION 'wrong release count: %', v->>'release_count';
  END IF;
  IF (v->>'anchor_release_id')::uuid
     <> '18400000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'wrong anchor release: %', v->>'anchor_release_id';
  END IF;
  IF (v->>'earliest_maturity_at')::timestamptz
     <> '2027-02-02 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'wrong earliest maturity: %', v->>'earliest_maturity_at';
  END IF;
  IF (v->>'horizon_days')::integer <> 7 THEN
    RAISE EXCEPTION 'wrong horizon: %', v->>'horizon_days';
  END IF;
END;
$test$;

-- ── Test E (D2): the horizon is configurable and widens the window ─────────
DO $test$
DECLARE
  v jsonb;
BEGIN
  v := public.paystack_payout_float_obligation(90, '2027-02-01 00:00:00+00');
  -- adds R3 (777,000) and the parked D1 release (2,000,000).
  IF (v->>'obligation_kobo')::bigint <> 4155500 THEN
    RAISE EXCEPTION 'wrong 90-day obligation: %', v->>'obligation_kobo';
  END IF;
  IF (v->>'release_count')::integer <> 4 THEN
    RAISE EXCEPTION 'wrong 90-day release count: %', v->>'release_count';
  END IF;
  -- Out-of-range horizons clamp rather than silently forecasting nothing.
  v := public.paystack_payout_float_obligation(0, '2027-02-01 00:00:00+00');
  IF (v->>'horizon_days')::integer <> 1 THEN
    RAISE EXCEPTION 'horizon not clamped low: %', v->>'horizon_days';
  END IF;
  v := public.paystack_payout_float_obligation(9999, '2027-02-01 00:00:00+00');
  IF (v->>'horizon_days')::integer <> 90 THEN
    RAISE EXCEPTION 'horizon not clamped high: %', v->>'horizon_days';
  END IF;
END;
$test$;

-- ── Test F (D2): a covered float warns nobody ─────────────────────────────
DO $test$
DECLARE
  v jsonb;
  v_alerts integer;
BEGIN
  v := public.raise_paystack_float_shortfall_alert(
    2000000, 7, '2027-02-01 02:00:00+00'
  );
  IF v->>'alert' <> 'none' THEN
    RAISE EXCEPTION 'covered float raised an alert: %', v->>'alert';
  END IF;
  IF (v->>'shortfall_kobo')::bigint <> 0 THEN
    RAISE EXCEPTION 'covered float reported a shortfall: %', v->>'shortfall_kobo';
  END IF;
  SELECT count(*) INTO v_alerts FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF v_alerts <> 0 THEN
    RAISE EXCEPTION 'covered float wrote an outbox row (% rows)', v_alerts;
  END IF;
  -- A negative balance is a hard input error, never a silent shortfall.
  BEGIN
    PERFORM public.raise_paystack_float_shortfall_alert(
      -1, 7, '2027-02-01 02:00:00+00'
    );
    RAISE EXCEPTION 'negative balance was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
END;
$test$;

-- ── Test G (D2): a real shortfall raises ONE actionable, deduped alert ─────
DO $test$
DECLARE
  v jsonb;
  v_again jsonb;
  v_alerts integer;
  v_message text;
BEGIN
  v := public.raise_paystack_float_shortfall_alert(
    378500, 7, '2027-02-01 03:00:00+00'
  );
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'shortfall did not raise: %', v->>'alert';
  END IF;
  IF (v->>'shortfall_kobo')::bigint <> 1000000 THEN
    RAISE EXCEPTION 'wrong shortfall: %', v->>'shortfall_kobo';
  END IF;
  -- Anchored to the earliest-maturing unpaid release, so a persistent shortfall
  -- raises one alert rather than one per sweep tick.
  v_again := public.raise_paystack_float_shortfall_alert(
    378500, 7, '2027-02-01 04:00:00+00'
  );
  IF v_again->>'alert' <> 'deduped' THEN
    RAISE EXCEPTION 'shortfall alert is not deduped: %', v_again->>'alert';
  END IF;
  SELECT count(*) INTO v_alerts FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF v_alerts <> 1 THEN
    RAISE EXCEPTION 'shortfall wrote % outbox rows', v_alerts;
  END IF;
  SELECT error_message INTO v_message FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  -- Actionable: how much, by when, what the balance is, what to top up.
  IF position('13,785.00' in v_message)=0
     OR position('2027-02-08' in v_message)=0
     OR position('3,785.00' in v_message)=0
     OR position('top up NGN 10,000.00' in v_message)=0 THEN
    RAISE EXCEPTION 'shortfall message is not actionable: %', v_message;
  END IF;
END;
$test$;

-- ── Test H (D2 VACUITY GUARD): the forecast kind is itself drainable ───────
CREATE TEMP TABLE issue_1840_claim_two AS
SELECT * FROM public.claim_payout_release_alerts(20, '2027-02-01 05:00:00+00');

DO $test$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1840_claim_two
    WHERE alert_kind='paystack_float_shortfall';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'float-shortfall alert was not drainable (% rows)', v_count;
  END IF;
END;
$test$;

ROLLBACK;
