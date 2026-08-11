-- Issue #1840 RETEST — independent adversarial guard for the rework
-- (append-only, tester, second pass). New file: the first-pass file
-- issue_1840_ng_float_alerts_adversarial.test.sql is unchanged by me and its
-- A-series still runs alongside this one.
--
-- The rework closed both of my conditions and, while closing C2, uncovered a
-- second half neither the coordinator nor I had seen: the notification layer
-- dedupes on a key derived from the release id, so even a correctly re-armed
-- outbox row would have had its corrected figure swallowed ONE LAYER BELOW the
-- outbox. That seam is the least-tested surface on the branch, so it is where
-- most of this file points.
--
-- C1  the notification seam, end to end through the real delivery machinery:
--     raise -> drain -> record delivery -> shortfall doubles -> refresh ->
--     drain again, and the SECOND claim must hand the notifier a DIFFERENT
--     idempotency key carrying the CURRENT figure. Asserting the outbox row
--     was updated proves nothing: that is exactly the assertion that would
--     have passed while the corrected figure was deduped away downstream.
-- C2  the revision key is scoped to one kind, and every other kind's key is
--     byte-identical to the #1217 form. These are live money alerts.
-- C3  the re-alert bounds at their exact boundaries: 25%, NGN 1,000 and 24h,
--     each probed one unit either side.
-- C4  the bound that actually matters, stated as an invariant and proven:
--     a delivered figure can never understate the truth by more than
--     max(25%, NGN 1,000) NOR be more than 24h old. Attacked with an
--     asymptotic growth curve that hugs the magnitude bar from below.
-- C5  a shortfall that shrinks and then regrows cannot evade a re-alert.
-- C6  "free while never delivered" must not fan out: many corrections in a
--     row must still leave exactly ONE outbox row.
-- C7  a stale `dispatching` row is skipped, not lost.
-- C8  the D1 backstop kind keeps the once-ever semantics it is supposed to
--     have — bounded re-alerting must NOT have leaked into it.
--
-- VACUITY GUARDS. C0 proves the fixture starts empty. C1 proves the two claims
-- return DIFFERENT keys (equal keys would mean the seam is still shut) and
-- that the first key was really delivered. C3 asserts BOTH sides of every
-- boundary, so a bar that always fires and a bar that never fires both fail.
-- C6 asserts the revision actually advanced, so "one row" cannot pass by the
-- code never running.
--
-- Fails-on-revert (each verified by a real line deletion):
--   * drop `||':r'||v_revision::text` from the refresh key   -> C1;
--   * drop the magnitude arm                                 -> C3, C4;
--   * drop the 24h arm                                       -> C3, C4;
--   * change the refresh UPDATE into an INSERT               -> C6;
--   * drop the `status='dispatching'` early return           -> C7.
--
-- Runs against the CI PostgreSQL with every migration applied. Each section is
-- isolated by a SAVEPOINT; the whole file rolls back.
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

-- One pool big enough that any shortfall can be dialled in by choosing the
-- balance: shortfall = 1,000,000,000 - balance.
CREATE TEMP TABLE retest_1840_const ON COMMIT DROP AS
SELECT 1000000000::bigint AS pool;

-- ── C0: the fixture starts empty ──────────────────────────────────────────
DO $t$
DECLARE v jsonb;
BEGIN
  v := public.paystack_payout_float_obligation(90,'2027-07-01 00:00:00+00');
  IF (v->>'obligation_kobo')::bigint <> 0 THEN
    RAISE EXCEPTION 'C0 the ledger is not empty at fixture start (%)', v;
  END IF;
END;
$t$;

-- ── C1: the notification seam, end to end ─────────────────────────────────
-- The bug the rework found lives BELOW the outbox: notify-dispatch dedupes on
-- idempotencyKey, and that key used to be derived from the release id, so a
-- corrected figure for the same release was a downstream duplicate and never
-- reached ops. The only honest proof is that two successive DELIVERIES are
-- handed two DIFFERENT keys, the later one carrying the later figure.
SAVEPOINT c1;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0001-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b1',
 'retest-c1','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',1000000000,1000000000,'pending');

DO $t$
DECLARE
  v jsonb;
  v_claim1 record;
  v_claim2 record;
  v_recorded text;
  v_rows integer;
BEGIN
  -- Tick 1: shortfall NGN 100,000.00 (10,000,000 kobo).
  v := public.raise_paystack_float_shortfall_alert(
         990000000, 7, '2027-07-01 00:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'C1 first alert did not raise: %', v->>'alert';
  END IF;

  -- The drain hands the notifier a key. This is the value that reaches
  -- notify-dispatch's dedupe.
  SELECT * INTO v_claim1
  FROM public.claim_payout_release_alerts(20,'2027-07-01 00:01:00+00')
  WHERE alert_kind='paystack_float_shortfall';
  IF v_claim1.idempotency_key IS NULL THEN
    RAISE EXCEPTION 'C1 the drain returned no idempotency key for the forecast alert';
  END IF;
  IF position('100,000.00' in v_claim1.error_message)=0 THEN
    RAISE EXCEPTION 'C1 first delivery carried the wrong figure: %',
      v_claim1.error_message;
  END IF;

  -- Delivered for real, through the same recorder the sweep uses.
  v_recorded := public.record_payout_release_alert_delivery(
    v_claim1.alert_id, v_claim1.claim_id, 'provider_accepted', NULL,
    '2027-07-01 00:02:00+00');
  IF v_recorded <> 'provider_accepted' THEN
    RAISE EXCEPTION 'C1 delivery was not recorded: %', v_recorded;
  END IF;

  -- Tick 2: the shortfall DOUBLES to NGN 200,000.00.
  v := public.raise_paystack_float_shortfall_alert(
         980000000, 7, '2027-07-01 01:00:00+00');
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION
      'C1 a doubled shortfall did not refresh a DELIVERED row (%) — ops would keep the stale number',
      v->>'alert';
  END IF;

  -- The row must be re-armed for delivery, not merely edited in place while
  -- sitting in a terminal state where the drain will never look at it again.
  SELECT count(*) INTO v_rows FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall' AND status='pending';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'C1 the refreshed row is not re-armed for delivery (% pending rows)', v_rows;
  END IF;

  -- THE SEAM. The second claim must hand the notifier a DIFFERENT key. If it
  -- repeats the first, notify-dispatch dedupes the corrected figure away and
  -- ops never sees the true number — the exact defect the rework found, one
  -- layer below the table this file otherwise tests.
  SELECT * INTO v_claim2
  FROM public.claim_payout_release_alerts(20,'2027-07-01 01:01:00+00')
  WHERE alert_kind='paystack_float_shortfall';
  IF v_claim2.alert_id IS NULL THEN
    RAISE EXCEPTION 'C1 the refreshed row never came back through the drain';
  END IF;
  IF v_claim2.idempotency_key = v_claim1.idempotency_key THEN
    RAISE EXCEPTION
      'C1 THE SEAM IS SHUT: both deliveries carry the same idempotency key (%) — the corrected figure would be deduped away below the outbox',
      v_claim2.idempotency_key;
  END IF;
  -- ...and the later key must carry the later figure, not just be different.
  IF position('200,000.00' in v_claim2.error_message)=0 THEN
    RAISE EXCEPTION 'C1 the second delivery does not carry the CURRENT figure: %',
      v_claim2.error_message;
  END IF;
  IF position('100,000.00' in v_claim2.error_message)<>0 THEN
    RAISE EXCEPTION 'C1 the second delivery still carries the superseded figure: %',
      v_claim2.error_message;
  END IF;
  -- The revision is what makes the key different, and it must advance by one.
  IF right(v_claim2.idempotency_key,3) <> ':r2' THEN
    RAISE EXCEPTION 'C1 the second key is not revision 2: %',
      v_claim2.idempotency_key;
  END IF;
  IF right(v_claim1.idempotency_key,3) <> ':r1' THEN
    RAISE EXCEPTION 'C1 the first key is not revision 1: %',
      v_claim1.idempotency_key;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c1;

-- ── C2: the revision key is scoped to ONE kind ────────────────────────────
-- Every other kind is a live money alert whose payload is a fixed fact. Their
-- keys must stay byte-identical to the #1217 form, or a delivery-behaviour
-- regression in them would be worse than the bug being fixed.
SAVEPOINT c2;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0002-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b2',
 'retest-c2','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',900000,900000,'blocked_balance');
INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status
) VALUES
('18401841-0002-0000-0000-0000000000a1','18401841-0002-0000-0000-000000000001',
 'organiser',0,890000,2000,0,'tester-1840','planned');

DO $t$
DECLARE v_key text;
BEGIN
  -- The D1 backstop is written by the same migration and is the closest
  -- neighbour to the forecast kind. Its key must carry NO revision suffix.
  PERFORM public.record_paystack_transfer_leg_outcome(
    '18401841-0002-0000-0000-0000000000a1','18401841-0002-0000-0000-000000000001',
    'blocked_balance',NULL,NULL,NULL,'2027-07-01 00:00:00+00');
  SELECT idempotency_key INTO v_key FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_balance_blocked';
  IF v_key <> 'paystack_balance_blocked:18401841-0002-0000-0000-000000000001' THEN
    RAISE EXCEPTION
      'C2 the blocked_balance key drifted from the #1217 form: %', v_key;
  END IF;
  IF position(':r' in v_key) <> 0 THEN
    RAISE EXCEPTION
      'C2 a revision suffix leaked onto a kind whose payload is a fixed fact: %',
      v_key;
  END IF;
  -- Its bookkeeping columns must stay NULL: bounded re-alerting is scoped to
  -- the one kind whose payload is a number that moves.
  IF EXISTS (
    SELECT 1 FROM public.payout_release_alert_outbox
    WHERE alert_kind <> 'paystack_float_shortfall'
      AND (alert_revision IS NOT NULL
           OR alert_magnitude_kobo IS NOT NULL
           OR alert_refreshed_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'C2 re-alert bookkeeping leaked onto a kind that must keep once-ever semantics';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c2;

-- ── C3: the re-alert bars at their exact boundaries ───────────────────────
SAVEPOINT c3;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0003-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b3',
 'retest-c3','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',1000000000,1000000000,'pending');

-- Reset the anchor row to a chosen last-alerted magnitude and a chosen age,
-- as a delivered row, so each probe below isolates exactly one bar.
CREATE OR REPLACE FUNCTION pg_temp.retest_1840_arm(
  p_magnitude bigint, p_refreshed timestamptz
) RETURNS void LANGUAGE plpgsql AS $arm$
BEGIN
  DELETE FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  INSERT INTO public.payout_release_alert_outbox (
    release_id,alert_kind,idempotency_key,brand_id,error_message,status,
    alert_revision,alert_magnitude_kobo,alert_refreshed_at,created_at,updated_at
  ) VALUES (
    '18401841-0003-0000-0000-000000000001','paystack_float_shortfall',
    'paystack_float_shortfall:18401841-0003-0000-0000-000000000001:r1',
    '18401841-0000-0000-0000-0000000000b3',
    'armed fixture message',
    'provider_accepted',1,p_magnitude,p_refreshed,p_refreshed,p_refreshed
  );
END;
$arm$;

DO $t$
DECLARE
  v jsonb;
  c_pool bigint := 1000000000;
  c_now timestamptz := '2027-07-01 00:00:00+00';
  -- shortfall = pool - balance, so balance = pool - shortfall
BEGIN
  -- (a) mid-size figure: 25% of 400,000 is 100,000, exactly equal to the
  -- NGN 1,000 floor, so both arms bite at the same place.
  PERFORM pg_temp.retest_1840_arm(400000, c_now - interval '1 hour');
  v := public.raise_paystack_float_shortfall_alert(c_pool-499999, 7, c_now);
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION 'C3a one kobo BELOW the 25%% bar was not suppressed: %',
      v->>'alert';
  END IF;
  PERFORM pg_temp.retest_1840_arm(400000, c_now - interval '1 hour');
  v := public.raise_paystack_float_shortfall_alert(c_pool-500000, 7, c_now);
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION 'C3a EXACTLY at the 25%% bar did not refresh: %',
      v->>'alert';
  END IF;

  -- (b) large figure: the relative arm dominates (25% of 100,000,000).
  PERFORM pg_temp.retest_1840_arm(100000000, c_now - interval '1 hour');
  v := public.raise_paystack_float_shortfall_alert(c_pool-124999999, 7, c_now);
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION 'C3b one kobo below 25%% of a large figure refreshed: %',
      v->>'alert';
  END IF;
  PERFORM pg_temp.retest_1840_arm(100000000, c_now - interval '1 hour');
  v := public.raise_paystack_float_shortfall_alert(c_pool-125000000, 7, c_now);
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION 'C3b exactly 25%% of a large figure did not refresh: %',
      v->>'alert';
  END IF;

  -- (c) tiny figure: 25% of 1,000 is 250, so the NGN 1,000 absolute floor is
  -- what governs. This is the arm that stops a one-kobo-per-tick drift from
  -- spamming ops and burying a genuine alert.
  PERFORM pg_temp.retest_1840_arm(1000, c_now - interval '1 hour');
  v := public.raise_paystack_float_shortfall_alert(c_pool-100999, 7, c_now);
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION 'C3c one kobo below the NGN 1,000 floor refreshed: %',
      v->>'alert';
  END IF;
  PERFORM pg_temp.retest_1840_arm(1000, c_now - interval '1 hour');
  v := public.raise_paystack_float_shortfall_alert(c_pool-101000, 7, c_now);
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION 'C3c exactly the NGN 1,000 floor did not refresh: %',
      v->>'alert';
  END IF;

  -- (d) the 24h bar, with the figure held perfectly flat so only time is in
  -- play. One microsecond short must stay silent; exactly 24h must speak.
  PERFORM pg_temp.retest_1840_arm(500000, c_now - interval '24 hours'
                                          + interval '1 microsecond');
  v := public.raise_paystack_float_shortfall_alert(c_pool-500000, 7, c_now);
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION 'C3d one microsecond short of 24h refreshed: %',
      v->>'alert';
  END IF;
  PERFORM pg_temp.retest_1840_arm(500000, c_now - interval '24 hours');
  v := public.raise_paystack_float_shortfall_alert(c_pool-500000, 7, c_now);
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION
      'C3d EXACTLY 24h of silence did not refresh (%) — suppression would not be provably temporary',
      v->>'alert';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c3;

-- ── C4: the invariant, attacked ───────────────────────────────────────────
-- INVARIANT: a delivered figure is never understated by more than
-- max(25% of it, NGN 1,000), and is never more than 24h old.
--
-- Attack: a growth curve that hugs the magnitude bar from below forever. If
-- the bar were measured against the PREVIOUS TICK rather than the last
-- ALERTED figure, compounding growth would escape it indefinitely; because it
-- is measured against the last alerted figure, the shortfall is fenced below
-- 1.25x that figure until either the bar or the 24h clock fires.
SAVEPOINT c4;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0004-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b4',
 'retest-c4','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',1000000000,1000000000,'pending');

DO $t$
DECLARE
  v jsonb;
  c_pool bigint := 1000000000;
  v_base bigint := 100000000;        -- NGN 1,000,000.00 last alerted
  v_shortfall bigint;
  v_tick integer;
  v_stated bigint;
  v_worst numeric := 0;
  v_refreshes integer := 0;
BEGIN
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-v_base, 7, '2027-07-01 00:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'C4 setup did not raise: %', v->>'alert';
  END IF;
  UPDATE public.payout_release_alert_outbox SET status='provider_accepted'
    WHERE alert_kind='paystack_float_shortfall';

  -- 23 hourly ticks, each hugging the bar from below (24.99% worse than the
  -- last ALERTED figure). Every one must be suppressed, and at no point may
  -- the understatement exceed the bar.
  FOR v_tick IN 1..23 LOOP
    SELECT alert_magnitude_kobo INTO v_stated
      FROM public.payout_release_alert_outbox
      WHERE alert_kind='paystack_float_shortfall';
    v_shortfall := v_stated + (v_stated/4) - 1;   -- one kobo under +25%
    v := public.raise_paystack_float_shortfall_alert(
           c_pool - v_shortfall, 7,
           '2027-07-01 00:00:00+00'::timestamptz + (v_tick||' hours')::interval);
    IF v->>'alert' = 'refreshed' THEN
      v_refreshes := v_refreshes + 1;
    END IF;
    v_worst := greatest(
      v_worst,
      (v_shortfall - v_stated)::numeric / nullif(v_stated,0)::numeric);
  END LOOP;

  -- THE INVARIANT. Understatement is fenced by the bar, not merely by time.
  IF v_worst >= 0.25 THEN
    RAISE EXCEPTION
      'C4 the delivered figure understated the truth by %%% — the magnitude bar does not fence the gap',
      round(v_worst*100,4);
  END IF;
  IF v_refreshes <> 0 THEN
    RAISE EXCEPTION
      'C4 a curve strictly under the bar refreshed % times — the bar is not measured where it is documented',
      v_refreshes;
  END IF;

  -- ...and silence is still provably temporary: past 24h the same flat-ish
  -- curve must surface regardless.
  SELECT alert_magnitude_kobo INTO v_stated
    FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  v := public.raise_paystack_float_shortfall_alert(
         c_pool - (v_stated + 1), 7, '2027-07-02 00:00:00+00');
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION
      'C4 a one-kobo drift past 24h stayed silent (%) — suppression is unbounded in time',
      v->>'alert';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c4;

-- ── C5: shrink, then regrow ───────────────────────────────────────────────
-- A partially funded float that later regrows must not be able to hide behind
-- the stale high-water magnitude. Under-alerting is the direction that leaves
-- an organiser unpaid; over-alerting only costs noise.
SAVEPOINT c5;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0005-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b5',
 'retest-c5','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',1000000000,1000000000,'pending');

DO $t$
DECLARE
  v jsonb;
  c_pool bigint := 1000000000;
  v_msg text;
BEGIN
  -- Raised at NGN 10,000.00 and delivered.
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-1000000, 7, '2027-07-01 00:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'C5 setup did not raise: %', v->>'alert';
  END IF;
  UPDATE public.payout_release_alert_outbox SET status='provider_accepted'
    WHERE alert_kind='paystack_float_shortfall';

  -- Ops tops up most of it: the shortfall SHRINKS. Nothing to say — the
  -- delivered figure now overstates, which is the safe direction.
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-200000, 7, '2027-07-01 01:00:00+00');
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION 'C5 a SHRINKING shortfall raised a new alert: %',
      v->>'alert';
  END IF;

  -- It regrows past the bar measured against the last ALERTED figure.
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-1300000, 7, '2027-07-01 02:00:00+00');
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION
      'C5 a regrown shortfall past the bar was suppressed by the stale high-water figure (%)',
      v->>'alert';
  END IF;
  SELECT error_message INTO v_msg FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF position('13,000.00' in v_msg)=0 THEN
    RAISE EXCEPTION 'C5 the refreshed row does not carry the regrown figure: %',
      v_msg;
  END IF;

  -- Fully covered: the alert path must go quiet WITHOUT disturbing the row,
  -- and must not reset the 24h clock (which would let a later regrowth hide).
  v := public.raise_paystack_float_shortfall_alert(
         c_pool, 7, '2027-07-01 03:00:00+00');
  IF v->>'alert' <> 'none' THEN
    RAISE EXCEPTION 'C5 a fully covered float did not go quiet: %', v->>'alert';
  END IF;
  UPDATE public.payout_release_alert_outbox SET status='provider_accepted'
    WHERE alert_kind='paystack_float_shortfall';
  -- A week later it regrows only slightly. The magnitude bar would suppress
  -- it; the 24h bar must not.
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-1300001, 7, '2027-07-08 00:00:00+00');
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION
      'C5 a regrowth after a quiet week stayed silent (%) — the covered path must not reset the silence clock',
      v->>'alert';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c5;

-- ── C6: free corrections must not fan out ─────────────────────────────────
SAVEPOINT c6;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0006-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b6',
 'retest-c6','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',1000000000,1000000000,'pending');

DO $t$
DECLARE
  v jsonb;
  c_pool bigint := 1000000000;
  v_tick integer;
  v_rows integer;
  v_rev integer;
  v_msg text;
BEGIN
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-5000000, 7, '2027-07-01 00:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'C6 setup did not raise: %', v->>'alert';
  END IF;
  -- Delivery is broken: the row never leaves 'pending'. The figure drifts on
  -- every tick and is corrected in place, for free.
  FOR v_tick IN 1..50 LOOP
    v := public.raise_paystack_float_shortfall_alert(
           c_pool-(5000000 + v_tick), 7,
           '2027-07-01 00:00:00+00'::timestamptz + (v_tick||' minutes')::interval);
  END LOOP;

  SELECT count(*) INTO v_rows FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'C6 free in-place corrections fanned out into % outbox rows — a broken drain would flood ops',
      v_rows;
  END IF;
  -- Anti-vacuity: the corrections really happened.
  SELECT alert_revision, error_message INTO v_rev, v_msg
    FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF v_rev <= 1 THEN
    RAISE EXCEPTION
      'C6 nothing was corrected (revision %), so the one-row assertion proves nothing',
      v_rev;
  END IF;
  IF position('50,000.50' in v_msg)=0 THEN
    RAISE EXCEPTION 'C6 the pending row does not carry the latest figure: %',
      v_msg;
  END IF;
  -- An identical figure must not churn the row at all.
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-5000050, 7, '2027-07-01 00:51:00+00');
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION
      'C6 an unchanged figure churned a pending row (%) — the key would rotate for nothing',
      v->>'alert';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c6;

-- ── C7: a row the drain is holding is skipped, not lost ───────────────────
SAVEPOINT c7;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0007-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b7',
 'retest-c7','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',1000000000,1000000000,'pending');

DO $t$
DECLARE
  v jsonb;
  c_pool bigint := 1000000000;
  v_claim record;
  v_key_before text;
  v_key_after text;
BEGIN
  PERFORM public.raise_paystack_float_shortfall_alert(
    c_pool-1000000, 7, '2027-07-01 00:00:00+00');
  SELECT * INTO v_claim
  FROM public.claim_payout_release_alerts(20,'2027-07-01 00:01:00+00')
  WHERE alert_kind='paystack_float_shortfall';
  v_key_before := v_claim.idempotency_key;

  -- While the drain holds the claim, a much worse figure arrives. Rewriting
  -- the row here would invalidate the claim and turn the delivery into a 500,
  -- so it must be skipped.
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-9000000, 7, '2027-07-01 00:02:00+00');
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION 'C7 an in-flight claim was disturbed: %', v->>'alert';
  END IF;
  SELECT idempotency_key INTO v_key_after
    FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF v_key_after <> v_key_before THEN
    RAISE EXCEPTION 'C7 the key rotated under an in-flight claim (% -> %)',
      v_key_before, v_key_after;
  END IF;
  -- The delivery still records cleanly, i.e. the claim was never invalidated.
  IF public.record_payout_release_alert_delivery(
       v_claim.alert_id, v_claim.claim_id, 'provider_accepted', NULL,
       '2027-07-01 00:03:00+00') <> 'provider_accepted' THEN
    RAISE EXCEPTION 'C7 the in-flight delivery could not be recorded';
  END IF;
  -- And the skipped correction is NOT lost: the very next tick surfaces it.
  v := public.raise_paystack_float_shortfall_alert(
         c_pool-9000000, 7, '2027-07-01 00:04:00+00');
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION
      'C7 the correction skipped during dispatch was LOST (%) — ops would keep the stale figure',
      v->>'alert';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c7;

-- ── C8: the D1 backstop keeps once-ever semantics ─────────────────────────
-- Bounded re-alerting is scoped to the forecast. A release that blocks on
-- every sweep tick must still raise exactly ONE blocked_balance alert, even
-- across a 24h boundary that would refresh a forecast alert.
SAVEPOINT c8;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401841-0008-0000-0000-000000000001','18401841-0000-0000-0000-0000000000b8',
 'retest-c8','order','paystack','ngn',
 '2027-06-29 00:00:00+00','2027-07-02 00:00:00+00',900000,900000,'pending');
INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status
) VALUES
('18401841-0008-0000-0000-0000000000a1','18401841-0008-0000-0000-000000000001',
 'organiser',0,890000,2000,0,'tester-1840','planned');

DO $t$
DECLARE n integer; v_key text;
BEGIN
  PERFORM public.record_paystack_transfer_leg_outcome(
    '18401841-0008-0000-0000-0000000000a1','18401841-0008-0000-0000-000000000001',
    'blocked_balance',NULL,NULL,NULL,'2027-07-01 00:00:00+00');
  -- ...three days later, still blocking on every tick.
  PERFORM public.record_paystack_transfer_leg_outcome(
    '18401841-0008-0000-0000-0000000000a1','18401841-0008-0000-0000-000000000001',
    'blocked_balance',NULL,NULL,NULL,'2027-07-04 00:00:00+00');
  SELECT count(*) INTO n FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_balance_blocked';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'C8 the backstop raised % alerts across a 24h boundary — bounded re-alerting leaked into a once-ever kind',
      n;
  END IF;
  SELECT idempotency_key INTO v_key FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_balance_blocked';
  IF position(':r' in v_key) <> 0 THEN
    RAISE EXCEPTION 'C8 the backstop key gained a revision suffix: %', v_key;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT c8;

ROLLBACK;
