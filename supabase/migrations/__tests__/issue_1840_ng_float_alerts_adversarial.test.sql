-- Issue #1840 — INDEPENDENT ADVERSARIAL contract guard (append-only, tester).
--
-- Deliberately a DIFFERENT angle from
-- supabase/migrations/__tests__/issue_1840_ng_payout_float_alerts.test.sql:
-- that file proves the happy path (a park alerts, the drain returns it, one
-- worked example of the arithmetic). This file attacks the arithmetic itself,
-- because the forecast is a claim about money and there is no live data to
-- lean on — zero Nigerian releases have ever executed in production.
--
-- What is attacked here, and why each direction matters:
--   A1  exactly WHICH release statuses count, via a power-of-two bitmask, so
--       any drift in the eligible set is identified uniquely rather than
--       merely changing a total. Under-counting is what leaves an organiser
--       unpaid; over-counting only costs a conservative top-up.
--   A2  the horizon boundary at exactly p_now + N days, in BOTH directions
--       (inclusive at the boundary, exclusive one microsecond past it), plus
--       an already-overdue release, which must be counted and must become the
--       anchor.
--   A3  partner legs with NO organiser legs — the arm of the CASE the
--       implementor's fixture never exercises on its own.
--   A4  the double-count attack: a partially succeeded multi-chunk release
--       must contribute its outstanding legs ONLY — never the pool as well,
--       never the settled chunks again.
--   A5  zero obligation, balance exactly equal to the obligation, and a
--       single kobo of shortfall (the alert/no-alert knife edge).
--   A6  dedupe in BOTH directions: a rotated anchor must raise a fresh alert,
--       and a sticky anchor must not spam. This section also PINS the known
--       suppression edge so it can never regress unnoticed.
--   A7  the drain, adversarially: the alert_kind allowlist must be
--       load-bearing (a kind outside it is NOT delivered) and the claim must
--       actually mutate the row, not merely select it.
--   A8  the forecast must not move one naira: the ledger tables are
--       byte-identical before and after a full forecast + alert cycle.
--   A9  the dedupe is enforced by the DATABASE, not by the writer — which is
--       what makes two concurrent sweeps racing the same insert safe.
--   A10 bigint arithmetic above the int4 ceiling and at the NGN 10,000,000
--       transfer chunk cap.
--   A11 a release already carrying a transfer code is excluded (parity with
--       claim_paystack_payout_releases).
--
-- VACUITY GUARDS. Every positive assertion here is paired with something that
-- would change if the behaviour were reverted:
--   * A0 proves the fixture starts from an empty ledger, so a non-zero
--     obligation later cannot come from pre-existing rows;
--   * A1/A2 use power-of-two and distinct-magnitude amounts, so an included
--     or excluded row is identified uniquely by the total;
--   * A4 asserts the two WRONG answers (pool-instead-of-legs and
--     pool-plus-legs) explicitly, not just the right one;
--   * A7 proves the drain's allowlist actually rejects something, so the
--     "it returned my row" assertions are not passing against a filter that
--     lets everything through;
--   * A8 asserts the alert outbox DID change in the same window the ledger
--     did not, so "nothing changed" cannot pass by the code never running.
--
-- Fails-on-revert (each verified by a real line deletion, not a comment-out):
--   * drop 'in_flight' from the obligation status list        -> A1;
--   * change releasable_at<=v_horizon_end to <                -> A2;
--   * drop the partner-leg term from per_release              -> A3, A4;
--   * remove the NOT IN ('succeeded','failed','reversed')     -> A4;
--   * change v_shortfall<=0 to v_shortfall<0                  -> A5;
--   * remove either new kind from the drain IN-list           -> A7;
--   * remove the blocked_balance outbox INSERT                -> A7.
--
-- Runs against the CI PostgreSQL with every migration applied. Each section is
-- isolated by a SAVEPOINT so no section can borrow another's rows, and the
-- whole file rolls back. session_replication_role=replica disables FK triggers
-- so only the rows under test are seeded; CHECK constraints stay enforced.
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

-- ── A0: the fixture starts empty (anti-vacuity for every total below) ──────
DO $t$
DECLARE v jsonb;
BEGIN
  v := public.paystack_payout_float_obligation(90, '2027-06-01 00:00:00+00');
  IF (v->>'obligation_kobo')::bigint <> 0
     OR (v->>'release_count')::integer <> 0
     OR v->>'anchor_release_id' IS NOT NULL THEN
    RAISE EXCEPTION
      'A0 the ledger is not empty at fixture start (%); every total below would be unsound',
      v;
  END IF;
END;
$t$;

-- ── A1: exactly which release statuses are owed (power-of-two bitmask) ─────
-- Each status carries a distinct power of two, so the total names the included
-- set uniquely: a drift that adds or drops one status cannot coincidentally
-- reproduce the expected number.
SAVEPOINT a1;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
)
SELECT
  ('18401840-0001-0000-0000-' || lpad(s.ord::text, 12, '0'))::uuid,
  '18401840-0000-0000-0000-0000000000b1'::uuid,
  'adv-a1-' || s.status_name,
  'order', 'paystack', 'ngn',
  '2027-05-30 00:00:00+00', '2027-06-02 00:00:00+00',
  s.amount, s.amount, s.status_name
FROM (VALUES
  (1, 'pending',           1),
  (2, 'released',          2),
  (3, 'in_flight',         4),
  (4, 'blocked_kyc',       8),
  (5, 'blocked_balance',  16),
  (6, 'blocked_otp',      32),
  (7, 'blocked_over_cap', 64),
  (8, 'fee_unreconciled',128),
  (9, 'blocked_anchor',  256),
  (10,'cancelled_event', 512),
  (11,'reanchored',     1024),
  (12,'failed',         2048)
) AS s(ord, status_name, amount);

DO $t$
DECLARE
  v jsonb;
  v_expected bigint := 1 + 4 + 16 + 32 + 64 + 128;  -- 245
BEGIN
  v := public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  IF (v->>'obligation_kobo')::bigint <> v_expected THEN
    RAISE EXCEPTION
      'A1 owed-status set drifted: obligation % (bitmask), expected % = pending+in_flight+blocked_balance+blocked_otp+blocked_over_cap+fee_unreconciled',
      v->>'obligation_kobo', v_expected;
  END IF;
  IF (v->>'release_count')::integer <> 6 THEN
    RAISE EXCEPTION 'A1 release_count %, expected 6', v->>'release_count';
  END IF;
  -- Named exclusions, so the intent is legible if this ever changes: a
  -- 'released' release is paid, and blocked_kyc / blocked_anchor /
  -- cancelled_event / reanchored / failed cannot be paid from the float
  -- without operator action, exactly as claim_paystack_payout_releases treats
  -- them. Any of them appearing here means the float is being over-reserved.
  IF ((v->>'obligation_kobo')::bigint & 2) <> 0 THEN
    RAISE EXCEPTION 'A1 a released (already paid) release was counted as owed';
  END IF;
  IF ((v->>'obligation_kobo')::bigint & 2048) <> 0 THEN
    RAISE EXCEPTION 'A1 a failed release was counted as owed';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a1;

-- ── A2: the horizon boundary, both directions, plus an overdue release ─────
-- horizon_end for p_now=2027-06-01T00:00:00Z and 7 days is 2027-06-08T00:00Z.
SAVEPOINT a2;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
-- ON the boundary: must be INCLUDED (the predicate is <=, not <).
('18401840-0002-0000-0000-00000000000a','18401840-0000-0000-0000-0000000000b1',
 'adv-a2-on-boundary','order','paystack','ngn',
 '2027-06-05 00:00:00+00','2027-06-08 00:00:00+00',1000,1000,'pending'),
-- One microsecond PAST the boundary: must be EXCLUDED.
('18401840-0002-0000-0000-00000000000b','18401840-0000-0000-0000-0000000000b1',
 'adv-a2-past-boundary','order','paystack','ngn',
 '2027-06-05 00:00:00.000001+00','2027-06-08 00:00:00.000001+00',2000,2000,'pending'),
-- Already overdue: the most urgent money there is. Must be INCLUDED and must
-- become the anchor, or the alert would name the wrong release.
('18401840-0002-0000-0000-00000000000c','18401840-0000-0000-0000-0000000000b1',
 'adv-a2-overdue','order','paystack','ngn',
 '2027-04-29 00:00:00+00','2027-05-02 00:00:00+00',4000,4000,'pending'),
-- One microsecond INSIDE the boundary: must be INCLUDED.
('18401840-0002-0000-0000-00000000000d','18401840-0000-0000-0000-0000000000b1',
 'adv-a2-inside-boundary','order','paystack','ngn',
 '2027-06-04 23:59:59.999999+00','2027-06-07 23:59:59.999999+00',8000,8000,'pending');

DO $t$
DECLARE v jsonb;
BEGIN
  v := public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  -- 1000 (on) + 4000 (overdue) + 8000 (inside) = 13000; 2000 (past) excluded.
  IF (v->>'obligation_kobo')::bigint <> 13000 THEN
    RAISE EXCEPTION
      'A2 horizon boundary is off by one: obligation % (13000 = on-boundary+overdue+inside; 15000 would mean the past-boundary row leaked in; 12000 would mean the on-boundary row was dropped)',
      v->>'obligation_kobo';
  END IF;
  IF (v->>'release_count')::integer <> 3 THEN
    RAISE EXCEPTION 'A2 release_count %, expected 3', v->>'release_count';
  END IF;
  IF (v->>'horizon_end')::timestamptz <> '2027-06-08 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'A2 horizon_end %, expected 2027-06-08T00:00:00Z',
      v->>'horizon_end';
  END IF;
  -- The overdue release is the most urgent and must anchor the alert.
  IF (v->>'anchor_release_id')::uuid
     <> '18401840-0002-0000-0000-00000000000c'::uuid THEN
    RAISE EXCEPTION 'A2 anchor is not the overdue release: %',
      v->>'anchor_release_id';
  END IF;
  IF (v->>'earliest_maturity_at')::timestamptz
     <> '2027-05-02 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'A2 earliest_maturity_at %', v->>'earliest_maturity_at';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a2;

-- ── A3: partner legs with NO organiser legs ───────────────────────────────
-- The pool arm of the CASE, exercised on its own. A release whose organiser
-- chunks are not planned yet but whose partner legs already are must still
-- reserve BOTH: they draw on the same Nigerian balance.
SAVEPOINT a3;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0003-0000-0000-000000000001','18401840-0000-0000-0000-0000000000b1',
 'adv-a3-partner-only','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',600000,500000,'pending');

INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status
) VALUES
-- outstanding partner leg: 50,000 + 1,000 + 500 = 51,500
('18401840-0003-0000-0000-0000000000a1','18401840-0003-0000-0000-000000000001',
 'partner',0,50000,1000,500,'tester-1840','planned'),
-- already settled partner leg: must NOT be reserved a second time
('18401840-0003-0000-0000-0000000000a2','18401840-0003-0000-0000-000000000001',
 'partner',1,70000,2000,0,'tester-1840','succeeded');

DO $t$
DECLARE v jsonb; v_kobo bigint;
BEGIN
  v := public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  v_kobo := (v->>'obligation_kobo')::bigint;
  IF v_kobo = 500000 THEN
    RAISE EXCEPTION
      'A3 partner legs were dropped when no organiser leg exists: obligation % is the pool alone, so partner money would never be funded',
      v_kobo;
  END IF;
  IF v_kobo = 623500 THEN
    RAISE EXCEPTION
      'A3 an already-succeeded partner leg was reserved again: obligation %',
      v_kobo;
  END IF;
  IF v_kobo <> 551500 THEN
    RAISE EXCEPTION 'A3 obligation %, expected 551500 (pool 500000 + outstanding partner 51500)', v_kobo;
  END IF;
  IF (v->>'release_count')::integer <> 1 THEN
    RAISE EXCEPTION 'A3 release_count %, expected 1', v->>'release_count';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a3;

-- ── A4: the double-count attack on a partially settled release ────────────
-- Five organiser chunks in five different states plus a partner leg. Only the
-- non-terminal legs may be reserved, and the pool must NOT be added on top.
SAVEPOINT a4;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0004-0000-0000-000000000001','18401840-0000-0000-0000-0000000000b2',
 'adv-a4-partial','order','paystack','ngn',
 '2027-05-31 00:00:00+00','2027-06-03 00:00:00+00',1000000,900000,'blocked_balance');

INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status
) VALUES
('18401840-0004-0000-0000-0000000000a0','18401840-0004-0000-0000-000000000001',
 'organiser',0,400000,2000,1000,'tester-1840','succeeded'),   -- paid: excluded
('18401840-0004-0000-0000-0000000000a1','18401840-0004-0000-0000-000000000001',
 'organiser',1,300000,2000,1000,'tester-1840','in_flight'),   -- 303000
('18401840-0004-0000-0000-0000000000a2','18401840-0004-0000-0000-000000000001',
 'organiser',2,200000,2000,1000,'tester-1840','planned'),     -- 203000
('18401840-0004-0000-0000-0000000000a3','18401840-0004-0000-0000-000000000001',
 'organiser',3,100000,1000,0,'tester-1840','failed'),         -- excluded
('18401840-0004-0000-0000-0000000000a4','18401840-0004-0000-0000-000000000001',
 'organiser',4, 50000, 500,0,'tester-1840','reversed'),       -- excluded
('18401840-0004-0000-0000-0000000000b0','18401840-0004-0000-0000-000000000001',
 'partner',0,20000,1000,0,'tester-1840','planned');           -- 21000

DO $t$
DECLARE v jsonb; v_kobo bigint;
BEGIN
  v := public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  v_kobo := (v->>'obligation_kobo')::bigint;
  -- The two WRONG answers, named explicitly so a regression is diagnosed and
  -- not merely detected.
  IF v_kobo = 921000 THEN
    RAISE EXCEPTION
      'A4 the pool was used instead of the planned legs (%): a partly paid release would be re-reserved in full',
      v_kobo;
  END IF;
  IF v_kobo = 1427000 THEN
    RAISE EXCEPTION
      'A4 DOUBLE COUNT: pool AND legs were both added (%)', v_kobo;
  END IF;
  IF v_kobo = 930000 THEN
    RAISE EXCEPTION
      'A4 an already-succeeded chunk was reserved again (%)', v_kobo;
  END IF;
  IF v_kobo <> 527000 THEN
    RAISE EXCEPTION
      'A4 obligation %, expected 527000 (in_flight 303000 + planned 203000 + partner 21000)',
      v_kobo;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a4;

-- ── A5: zero, exactly covered, and one kobo short ─────────────────────────
SAVEPOINT a5;

-- A5a: nothing owed at all. A zero balance against a zero obligation must not
-- manufacture a shortfall alert.
DO $t$
DECLARE v jsonb; n integer;
BEGIN
  v := public.raise_paystack_float_shortfall_alert(0, 7, '2027-06-01 00:00:00+00');
  IF v->>'alert' <> 'none' THEN
    RAISE EXCEPTION 'A5a zero obligation raised %', v->>'alert';
  END IF;
  IF (v->>'shortfall_kobo')::bigint <> 0 THEN
    RAISE EXCEPTION 'A5a zero obligation reported shortfall %',
      v->>'shortfall_kobo';
  END IF;
  SELECT count(*) INTO n FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF n <> 0 THEN RAISE EXCEPTION 'A5a wrote % outbox rows', n; END IF;
  -- A NULL balance is a hard input error, never a silently assumed zero (which
  -- would read as a total shortfall) and never a silently skipped check.
  BEGIN
    PERFORM public.raise_paystack_float_shortfall_alert(NULL, 7, '2027-06-01 00:00:00+00');
    RAISE EXCEPTION 'A5a a NULL balance was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
END;
$t$;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0005-0000-0000-000000000001','18401840-0000-0000-0000-0000000000b3',
 'adv-a5-knife-edge','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',250000,250000,'pending');

DO $t$
DECLARE v jsonb; n integer; msg text;
BEGIN
  -- Balance EXACTLY equal to the obligation: covered, so nobody is warned.
  v := public.raise_paystack_float_shortfall_alert(250000, 7, '2027-06-01 01:00:00+00');
  IF v->>'alert' <> 'none' OR (v->>'shortfall_kobo')::bigint <> 0 THEN
    RAISE EXCEPTION
      'A5b an exactly-covered float alerted (alert=%, shortfall=%)',
      v->>'alert', v->>'shortfall_kobo';
  END IF;
  -- One kobo MORE than needed: still covered.
  v := public.raise_paystack_float_shortfall_alert(250001, 7, '2027-06-01 02:00:00+00');
  IF v->>'alert' <> 'none' THEN
    RAISE EXCEPTION 'A5c one kobo of surplus alerted: %', v->>'alert';
  END IF;
  SELECT count(*) INTO n FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF n <> 0 THEN
    RAISE EXCEPTION 'A5b/c a covered float wrote % outbox rows', n;
  END IF;
  -- One kobo SHORT: this must alert. An organiser is short by NGN 0.01 and the
  -- copy has to say so rather than round it away to "0.00".
  v := public.raise_paystack_float_shortfall_alert(249999, 7, '2027-06-01 03:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'A5d one kobo of shortfall did not alert: %', v->>'alert';
  END IF;
  IF (v->>'shortfall_kobo')::bigint <> 1 THEN
    RAISE EXCEPTION 'A5d shortfall %, expected 1', v->>'shortfall_kobo';
  END IF;
  SELECT error_message INTO msg FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF position('top up NGN 0.01' in msg) = 0 THEN
    RAISE EXCEPTION
      'A5d a one-kobo shortfall is not actionable in the copy: %', msg;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a5;

-- ── A6: dedupe in BOTH directions, and the sticky-anchor edge ─────────────
SAVEPOINT a6;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
-- E is the earliest-maturing release and therefore the anchor.
('18401840-0006-0000-0000-00000000000e','18401840-0000-0000-0000-0000000000b4',
 'adv-a6-early','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',100000,100000,'pending'),
('18401840-0006-0000-0000-00000000000f','18401840-0000-0000-0000-0000000000b5',
 'adv-a6-late','order','paystack','ngn',
 '2027-06-03 00:00:00+00','2027-06-06 00:00:00+00',900000,900000,'pending');

DO $t$
DECLARE v jsonb; n integer; msg text;
BEGIN
  -- Tick 1: obligation 1,000,000 kobo = NGN 10,000.00, balance 0.
  v := public.raise_paystack_float_shortfall_alert(0, 7, '2027-06-01 00:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'A6 first shortfall did not raise: %', v->>'alert';
  END IF;
  IF (v->>'anchor_release_id')::uuid
     <> '18401840-0006-0000-0000-00000000000e'::uuid THEN
    RAISE EXCEPTION 'A6 wrong anchor: %', v->>'anchor_release_id';
  END IF;

  -- The drain delivers it; the outbox row is NEVER deleted, only marked.
  UPDATE public.payout_release_alert_outbox
  SET status='provider_accepted', provider_accepted_at='2027-06-01 00:05:00+00'
  WHERE alert_kind='paystack_float_shortfall';

  -- Tick 2: the shortfall grows 10x while E is still the earliest release.
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, net_release_cents, status
  ) VALUES (
    '18401840-0006-0000-0000-000000000010','18401840-0000-0000-0000-0000000000b6',
    'adv-a6-huge','order','paystack','ngn',
    '2027-06-04 00:00:00+00','2027-06-07 00:00:00+00',9000000,9000000,'pending'
  );
  v := public.raise_paystack_float_shortfall_alert(0, 7, '2027-06-01 01:00:00+00');
  IF (v->>'obligation_kobo')::bigint <> 10000000 THEN
    RAISE EXCEPTION 'A6 obligation did not grow: %', v->>'obligation_kobo';
  END IF;
  -- INVERTED [TEST-MOD-APPROVED #1840]: this section used to require 'deduped'
  -- here, and to require the stored message to still carry the ORIGINAL,
  -- ten-times-too-small figure. That pinned exactly the defect the coordinator
  -- then promoted to a condition: because outbox rows are keyed on
  -- (release_id, alert_kind) and are never deleted anywhere in the repo, a
  -- stuck anchor made that key once-ever, so the only artefact ops ever
  -- received kept understating the shortfall while it grew underneath. The
  -- rework bounds the suppression instead of removing it: a MATERIALLY worse
  -- shortfall (>= 25% of the last figure, or >= NGN 1,000, whichever is larger)
  -- always surfaces, and a flat one still surfaces every 24 hours.
  IF v->>'alert' <> 'refreshed' THEN
    RAISE EXCEPTION
      'A6 a ten-fold worse shortfall did not surface (%) — ops would keep the stale number',
      v->>'alert';
  END IF;
  -- Bounded re-alerting must still never fan out into a pile of rows.
  SELECT count(*) INTO n FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF n <> 1 THEN RAISE EXCEPTION 'A6 sticky anchor wrote % rows', n; END IF;
  SELECT error_message INTO msg FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF position('100,000.00' in msg) = 0 THEN
    RAISE EXCEPTION
      'A6 the row does not carry the CURRENT figure — a delivered artefact would understate the shortfall: %',
      msg;
  END IF;
  IF position('10,000.00' in msg) <> 0 THEN
    RAISE EXCEPTION 'A6 the row still carries the superseded figure: %', msg;
  END IF;
  -- Re-armed with a revision-bearing key, or notify-dispatch would dedupe the
  -- corrected figure away one layer below this table and ops would never see it.
  IF (SELECT status FROM public.payout_release_alert_outbox
      WHERE alert_kind='paystack_float_shortfall') <> 'pending' THEN
    RAISE EXCEPTION 'A6 an already-delivered row was not re-armed for delivery';
  END IF;
  IF (SELECT idempotency_key FROM public.payout_release_alert_outbox
      WHERE alert_kind='paystack_float_shortfall') NOT LIKE '%:r2' THEN
    RAISE EXCEPTION 'A6 the refreshed row kept a stale idempotency key';
  END IF;
  -- ANTI-SPAM, the other half of the bound: a trivial drift after the refresh
  -- must go quiet again. Keying on the raw amount would fire here every tick,
  -- which is its own way of burying a real alert.
  UPDATE public.payout_release_alert_outbox SET status='provider_accepted'
  WHERE alert_kind='paystack_float_shortfall';
  v := public.raise_paystack_float_shortfall_alert(1, 7, '2027-06-01 01:10:00+00');
  IF v->>'alert' <> 'suppressed' THEN
    RAISE EXCEPTION 'A6 a one-kobo drift re-alerted (%) — that is spam', v->>'alert';
  END IF;

  -- Tick 3: the anchor rotates (E is paid). A NEW anchor must raise a NEW
  -- alert — suppression here would be the dangerous failure.
  UPDATE public.brand_payout_releases SET status='released'
  WHERE id='18401840-0006-0000-0000-00000000000e';
  v := public.raise_paystack_float_shortfall_alert(0, 7, '2027-06-01 02:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION
      'A6 a ROTATED anchor was suppressed (%) — a real, still-unfunded shortfall would be silent',
      v->>'alert';
  END IF;
  IF (v->>'anchor_release_id')::uuid
     <> '18401840-0006-0000-0000-00000000000f'::uuid THEN
    RAISE EXCEPTION 'A6 anchor did not rotate: %', v->>'anchor_release_id';
  END IF;
  SELECT count(*) INTO n FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF n <> 2 THEN
    RAISE EXCEPTION 'A6 after rotation there are % shortfall rows, expected 2', n;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a6;

-- ── A7: the drain, adversarially ──────────────────────────────────────────
-- The implementor's tests prove "my row came back". That assertion is only
-- meaningful if the allowlist rejects SOMETHING — otherwise it would also pass
-- against a drain with no filter at all. This section proves the filter is
-- load-bearing, and that claiming really mutates the row.
SAVEPOINT a7;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0007-0000-0000-000000000001','18401840-0000-0000-0000-0000000000b7',
 'adv-a7-one','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',10,10,'blocked_balance'),
('18401840-0007-0000-0000-000000000002','18401840-0000-0000-0000-0000000000b7',
 'adv-a7-two','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',10,10,'pending'),
('18401840-0007-0000-0000-000000000003','18401840-0000-0000-0000-0000000000b7',
 'adv-a7-three','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',10,10,'pending');

INSERT INTO public.payout_release_alert_outbox (
  release_id, alert_kind, idempotency_key, brand_id, error_message,
  created_at, updated_at
) VALUES
('18401840-0007-0000-0000-000000000001','paystack_balance_blocked',
 'adv-a7:balance','18401840-0000-0000-0000-0000000000b7','a7 balance',
 '2027-06-01 00:00:00+00','2027-06-01 00:00:00+00'),
('18401840-0007-0000-0000-000000000002','paystack_float_shortfall',
 'adv-a7:float','18401840-0000-0000-0000-0000000000b7','a7 float',
 '2027-06-01 00:00:01+00','2027-06-01 00:00:01+00'),
('18401840-0007-0000-0000-000000000003','stripe_attempt_cap',
 'adv-a7:stripe','18401840-0000-0000-0000-0000000000b7','a7 stripe',
 '2027-06-01 00:00:02+00','2027-06-01 00:00:02+00');

-- A kind the drain must NOT deliver. The CHECK is dropped only inside this
-- savepoint and is restored by the rollback below; nothing here survives.
ALTER TABLE public.payout_release_alert_outbox
  DROP CONSTRAINT payout_release_alert_outbox_alert_kind_check;
INSERT INTO public.payout_release_alert_outbox (
  release_id, alert_kind, idempotency_key, brand_id, error_message,
  created_at, updated_at
) VALUES
('18401840-0007-0000-0000-000000000001','issue_1840_never_allowed_kind',
 'adv-a7:bogus','18401840-0000-0000-0000-0000000000b7','a7 bogus',
 '2027-06-01 00:00:03+00','2027-06-01 00:00:03+00');

CREATE TEMP TABLE adv_a7_first ON COMMIT DROP AS
SELECT * FROM public.claim_payout_release_alerts(50, '2027-06-01 01:00:00+00');

DO $t$
DECLARE n integer; v_kinds text[]; v_status text; v_claim uuid;
BEGIN
  SELECT count(*) INTO n FROM adv_a7_first;
  IF n <> 3 THEN
    RAISE EXCEPTION 'A7 drain returned % rows, expected exactly 3', n;
  END IF;
  SELECT array_agg(alert_kind ORDER BY alert_kind) INTO v_kinds FROM adv_a7_first;
  IF v_kinds <> ARRAY[
    'paystack_balance_blocked','paystack_float_shortfall','stripe_attempt_cap'
  ]::text[] THEN
    RAISE EXCEPTION 'A7 drain returned the wrong kinds: %', v_kinds;
  END IF;
  -- THE VACUITY GUARD. If the allowlist were removed (or replaced by a filter
  -- that passes everything), the bogus kind would come back here — and every
  -- "my kind was delivered" assertion in this file and the implementor's would
  -- become meaningless. It must be rejected.
  IF EXISTS (SELECT 1 FROM adv_a7_first
             WHERE alert_kind='issue_1840_never_allowed_kind') THEN
    RAISE EXCEPTION
      'A7 the drain allowlist is not load-bearing: an unlisted kind was delivered, so every delivery assertion here is vacuous';
  END IF;
  -- Claiming must actually MUTATE the row, not merely select it: a row that
  -- comes back but stays 'pending' would be redelivered forever.
  FOR v_status, v_claim IN
    SELECT o.status, o.dispatch_claim_id
    FROM public.payout_release_alert_outbox o
    JOIN adv_a7_first c ON c.alert_id=o.id
  LOOP
    IF v_status <> 'dispatching' OR v_claim IS NULL THEN
      RAISE EXCEPTION 'A7 a claimed row was not marked dispatching (%, %)',
        v_status, v_claim;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.payout_release_alert_outbox o
    JOIN adv_a7_first c ON c.alert_id=o.id
    WHERE o.dispatch_claim_id IS DISTINCT FROM c.claim_id
  ) THEN
    RAISE EXCEPTION 'A7 the returned claim_id does not match the stored one';
  END IF;
  -- The bogus row was never touched.
  SELECT status INTO v_status FROM public.payout_release_alert_outbox
    WHERE idempotency_key='adv-a7:bogus';
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'A7 the unlisted kind was claimed anyway (%)', v_status;
  END IF;
END;
$t$;

-- A second claim inside the 10-minute in-flight window returns nothing: both
-- new kinds obey the same no-double-dispatch rule as every prior kind.
DO $t$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM public.claim_payout_release_alerts(50, '2027-06-01 01:05:00+00');
  IF n <> 0 THEN
    RAISE EXCEPTION 'A7 a second claim inside the window returned % rows', n;
  END IF;
  -- Past the window, the stale dispatching rows are reclaimable — and the
  -- unlisted kind still is not.
  SELECT count(*) INTO n
  FROM public.claim_payout_release_alerts(50, '2027-06-01 01:20:00+00');
  IF n <> 3 THEN
    RAISE EXCEPTION 'A7 stale reclaim returned % rows, expected 3', n;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a7;

-- ── A8: the forecast moves no money ───────────────────────────────────────
SAVEPOINT a8;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0008-0000-0000-000000000001','18401840-0000-0000-0000-0000000000b8',
 'adv-a8','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',400000,300000,'pending');
INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status
) VALUES
('18401840-0008-0000-0000-0000000000a1','18401840-0008-0000-0000-000000000001',
 'organiser',0,290000,2000,1000,'tester-1840','planned');
INSERT INTO public.payout_ledger_adjustments (
  release_id, brand_id, currency, kind, amount_cents, idempotency_key
) VALUES
('18401840-0008-0000-0000-000000000001','18401840-0000-0000-0000-0000000000b8',
 'ngn','maturity_recredit',7000,'adv-a8-recredit');

DO $t$
DECLARE
  v_before text;
  v_after text;
  v_alerts_before integer;
  v_alerts_after integer;
  v jsonb;
BEGIN
  SELECT md5(string_agg(t.row_text, '|' ORDER BY t.row_text)) INTO v_before
  FROM (
    SELECT r::text AS row_text FROM public.brand_payout_releases r
    UNION ALL SELECT l::text FROM public.payout_transfer_legs l
    UNION ALL SELECT a::text FROM public.payout_ledger_adjustments a
  ) t;
  SELECT count(*) INTO v_alerts_before FROM public.payout_release_alert_outbox;

  PERFORM public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  v := public.raise_paystack_float_shortfall_alert(0, 7, '2027-06-01 00:00:00+00');
  IF v->>'alert' <> 'raised' THEN
    RAISE EXCEPTION 'A8 setup is vacuous: the forecast did not alert (%)',
      v->>'alert';
  END IF;

  SELECT md5(string_agg(t.row_text, '|' ORDER BY t.row_text)) INTO v_after
  FROM (
    SELECT r::text AS row_text FROM public.brand_payout_releases r
    UNION ALL SELECT l::text FROM public.payout_transfer_legs l
    UNION ALL SELECT a::text FROM public.payout_ledger_adjustments a
  ) t;
  SELECT count(*) INTO v_alerts_after FROM public.payout_release_alert_outbox;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION
      'A8 the forecast MUTATED the payout ledger — observability moved money';
  END IF;
  -- Anti-vacuity: the outbox DID change in the same window, so "nothing
  -- changed" cannot pass because the code never ran.
  IF v_alerts_after <> v_alerts_before + 1 THEN
    RAISE EXCEPTION
      'A8 no alert was written, so the unchanged-ledger assertion proves nothing (% -> %)',
      v_alerts_before, v_alerts_after;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a8;

-- ── A9: dedupe is enforced by the DATABASE (concurrent-sweep safety) ──────
-- ON CONFLICT (release_id, alert_kind) DO NOTHING is only safe against two
-- sweeps racing the same insert if a real unique arbiter backs it. Prove the
-- constraint exists on exactly those columns, and that a raw duplicate is
-- rejected by the engine rather than by the writer's own logic.
SAVEPOINT a9;

DO $t$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid
  WHERE t.relname='payout_release_alert_outbox'
    AND c.contype='u'
    AND (
      SELECT array_agg(a.attname ORDER BY a.attname)
      FROM unnest(c.conkey) k
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k
    ) = ARRAY['alert_kind','release_id']::name[];
  IF n <> 1 THEN
    RAISE EXCEPTION
      'A9 there is no single UNIQUE (release_id, alert_kind) arbiter (found %) — two concurrent sweeps could both insert',
      n;
  END IF;
END;
$t$;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0009-0000-0000-000000000001','18401840-0000-0000-0000-0000000000b9',
 'adv-a9','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',10,10,'pending');

DO $t$
BEGIN
  INSERT INTO public.payout_release_alert_outbox (
    release_id, alert_kind, idempotency_key, brand_id, error_message
  ) VALUES (
    '18401840-0009-0000-0000-000000000001','paystack_float_shortfall',
    'adv-a9:one','18401840-0000-0000-0000-0000000000b9','a9'
  );
  BEGIN
    INSERT INTO public.payout_release_alert_outbox (
      release_id, alert_kind, idempotency_key, brand_id, error_message
    ) VALUES (
      '18401840-0009-0000-0000-000000000001','paystack_float_shortfall',
      'adv-a9:two','18401840-0000-0000-0000-0000000000b9','a9 again'
    );
    RAISE EXCEPTION
      'A9 a duplicate (release_id, alert_kind) was accepted — the ON CONFLICT dedupe has no teeth under concurrency';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$t$;

ROLLBACK TO SAVEPOINT a9;

-- ── A10: bigint arithmetic above int4, and at the NGN 10m chunk cap ───────
SAVEPOINT a10;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0010-0000-0000-000000000001','18401840-0000-0000-0000-0000000000c1',
 'adv-a10-1','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',2000000000,2000000000,'pending'),
('18401840-0010-0000-0000-000000000002','18401840-0000-0000-0000-0000000000c2',
 'adv-a10-2','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',2000000000,2000000000,'pending'),
('18401840-0010-0000-0000-000000000003','18401840-0000-0000-0000-0000000000c3',
 'adv-a10-3','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',2000000000,2000000000,'pending'),
-- A release chunked at exactly the NGN 10,000,000 Paystack transfer cap.
('18401840-0010-0000-0000-000000000004','18401840-0000-0000-0000-0000000000c4',
 'adv-a10-cap','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',2010000000,2000000000,'pending');

INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status
) VALUES
('18401840-0010-0000-0000-0000000000a1','18401840-0010-0000-0000-000000000004',
 'organiser',0,1000000000,5000000,0,'tester-1840','planned'),
('18401840-0010-0000-0000-0000000000a2','18401840-0010-0000-0000-000000000004',
 'organiser',1,1000000000,5000000,0,'tester-1840','planned');

DO $t$
DECLARE v jsonb; v_kobo bigint; msg text;
BEGIN
  v := public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  v_kobo := (v->>'obligation_kobo')::bigint;
  -- 3 x 2,000,000,000 (pool) + 2 x 1,005,000,000 (capped chunks) = 8,010,000,000
  -- which is well past the int4 ceiling of 2,147,483,647.
  IF v_kobo <> 8010000000 THEN
    RAISE EXCEPTION
      'A10 obligation % — expected 8010000000; a wrapped or truncated value here would UNDER-fund the float',
      v_kobo;
  END IF;
  IF v_kobo <= 2147483647 THEN
    RAISE EXCEPTION
      'A10 the total did not exceed the int4 ceiling, so this test proves nothing';
  END IF;
  v := public.raise_paystack_float_shortfall_alert(10, 7, '2027-06-01 00:00:00+00');
  IF (v->>'shortfall_kobo')::bigint <> 8009999990 THEN
    RAISE EXCEPTION 'A10 shortfall %, expected 8009999990',
      v->>'shortfall_kobo';
  END IF;
  SELECT error_message INTO msg FROM public.payout_release_alert_outbox
    WHERE alert_kind='paystack_float_shortfall';
  IF position('80,100,000.00' in msg) = 0 THEN
    RAISE EXCEPTION
      'A10 a large obligation is mis-rendered in the copy (thousand separators / overflow): %',
      msg;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a10;

-- ── A11: a release already carrying a transfer code is not re-reserved ────
-- Parity with claim_paystack_payout_releases, which uses the same guard. If
-- this ever diverges, the float would either double-fund a paid release or
-- (worse) drop one that is still owed.
SAVEPOINT a11;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status,
  paystack_transfer_code
) VALUES
('18401840-0011-0000-0000-000000000001','18401840-0000-0000-0000-0000000000d1',
 'adv-a11','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',500000,500000,'pending',
 'TESTER_1840_CODE');

DO $t$
DECLARE v jsonb;
BEGIN
  v := public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  IF (v->>'obligation_kobo')::bigint <> 0 THEN
    RAISE EXCEPTION
      'A11 a release already carrying a transfer code was reserved again: %',
      v->>'obligation_kobo';
  END IF;
  -- Anti-vacuity: without the code the very same row IS owed.
  UPDATE public.brand_payout_releases SET paystack_transfer_code=NULL
  WHERE id='18401840-0011-0000-0000-000000000001';
  v := public.paystack_payout_float_obligation(7, '2027-06-01 00:00:00+00');
  IF (v->>'obligation_kobo')::bigint <> 500000 THEN
    RAISE EXCEPTION
      'A11 the fixture is unsound: the row is not owed even without a transfer code (%)',
      v->>'obligation_kobo';
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a11;

-- ── A12: the D1 backstop under a leg that is NOT the first chunk ──────────
-- executePaystackRelease parks on pending[0]. Prove the alert is keyed on the
-- RELEASE (so it is raised exactly once however many chunks exist) and that
-- parking still burns no attempt and moves no leg, on a multi-chunk release.
SAVEPOINT a12;

INSERT INTO public.brand_payout_releases (
  id, brand_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, net_release_cents, status
) VALUES
('18401840-0012-0000-0000-000000000001','18401840-0000-0000-0000-0000000000d2',
 'adv-a12','order','paystack','ngn',
 '2027-05-30 00:00:00+00','2027-06-02 00:00:00+00',900000,900000,'pending');
INSERT INTO public.payout_transfer_legs (
  id, release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
  stamp_duty_cents, fee_schedule_version, status, attempt_count
) VALUES
('18401840-0012-0000-0000-0000000000a1','18401840-0012-0000-0000-000000000001',
 'organiser',0,300000,2000,0,'tester-1840','planned',3),
('18401840-0012-0000-0000-0000000000a2','18401840-0012-0000-0000-000000000001',
 'organiser',1,300000,2000,0,'tester-1840','planned',0);

DO $t$
DECLARE n integer; v_a1 record; v_a2 record;
BEGIN
  -- Park via chunk 0, then via chunk 1: still ONE alert for the release.
  PERFORM public.record_paystack_transfer_leg_outcome(
    '18401840-0012-0000-0000-0000000000a1','18401840-0012-0000-0000-000000000001',
    'blocked_balance',NULL,NULL,NULL,'2027-06-01 00:00:00+00');
  PERFORM public.record_paystack_transfer_leg_outcome(
    '18401840-0012-0000-0000-0000000000a2','18401840-0012-0000-0000-000000000001',
    'blocked_balance',NULL,NULL,NULL,'2027-06-01 00:10:00+00');
  SELECT count(*) INTO n FROM public.payout_release_alert_outbox
    WHERE release_id='18401840-0012-0000-0000-000000000001'
      AND alert_kind='paystack_balance_blocked';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'A12 parking different chunks of one release raised % alerts, expected 1', n;
  END IF;
  -- Neither leg moved and neither attempt budget was spent: the backstop is
  -- observability only.
  SELECT status, attempt_count, provider_reference, provider_transfer_code
    INTO v_a1 FROM public.payout_transfer_legs
    WHERE id='18401840-0012-0000-0000-0000000000a1';
  SELECT status, attempt_count, provider_reference, provider_transfer_code
    INTO v_a2 FROM public.payout_transfer_legs
    WHERE id='18401840-0012-0000-0000-0000000000a2';
  IF v_a1.status <> 'planned' OR v_a1.attempt_count <> 3
     OR v_a1.provider_reference IS NOT NULL
     OR v_a1.provider_transfer_code IS NOT NULL THEN
    RAISE EXCEPTION 'A12 chunk 0 was mutated by a park: %', v_a1;
  END IF;
  IF v_a2.status <> 'planned' OR v_a2.attempt_count <> 0
     OR v_a2.provider_reference IS NOT NULL
     OR v_a2.provider_transfer_code IS NOT NULL THEN
    RAISE EXCEPTION 'A12 chunk 1 was mutated by a park: %', v_a2;
  END IF;
  -- And the alert is drainable end to end, not merely written (#1217).
  SELECT count(*) INTO n
  FROM public.claim_payout_release_alerts(50,'2027-06-01 01:00:00+00') c
  WHERE c.alert_kind='paystack_balance_blocked'
    AND c.release_id='18401840-0012-0000-0000-000000000001';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'A12 the multi-chunk blocked_balance alert never reached the drain (% rows) — the #1217 defect',
      n;
  END IF;
END;
$t$;

ROLLBACK TO SAVEPOINT a12;

ROLLBACK;
