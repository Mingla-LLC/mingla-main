\set ON_ERROR_STOP on

-- Implementor-owned PostgreSQL regression for issue #1174 P0-1 (QA RETEST 3):
-- the post-provider ledger-commit boundary must be atomic. After Stripe accepts
-- the partner transfer, settle_partner_split_transfer commits the split marker
-- AND its normalized transfer leg together. A database failure at that boundary
-- must roll BOTH back so the split stays selectable and the next sweep replays
-- the same idempotency key to the same transfer id.

BEGIN;

INSERT INTO auth.users (id) VALUES
  ('1174c000-0000-4000-8000-000000000001'),
  ('1174c000-0000-4000-8000-000000000002');

INSERT INTO public.creator_accounts (id, email, partner_enabled) VALUES
  (
    '1174c000-0000-4000-8000-000000000001',
    'issue-1174-settle-owner@example.test',
    false
  ),
  (
    '1174c000-0000-4000-8000-000000000002',
    'issue-1174-settle-partner@example.test',
    true
  );

INSERT INTO public.brands (
  id,
  account_id,
  name,
  slug,
  default_currency,
  payment_provider,
  payout_hold_cutover_at
) VALUES (
  '1174c000-0000-4000-8000-000000000010',
  '1174c000-0000-4000-8000-000000000001',
  'Issue 1174 Settle Brand',
  'issue-1174-settle-brand',
  'USD',
  'stripe',
  '2026-07-24T00:00:00Z'
);

INSERT INTO public.events (
  id,
  brand_id,
  title,
  slug,
  currency,
  status,
  visibility
) VALUES (
  '1174c000-0000-4000-8000-000000000020',
  '1174c000-0000-4000-8000-000000000010',
  'Issue 1174 Settle Event',
  'issue-1174-settle-event',
  'USD',
  'scheduled',
  'private'
);

INSERT INTO public.orders (
  id,
  event_id,
  total_cents,
  currency,
  payment_status,
  stripe_application_fee_amount_cents,
  buyer_phone_e164,
  created_at
) VALUES
  (
    '1174c000-0000-4000-8000-00000000003a',
    '1174c000-0000-4000-8000-000000000020',
    100000, 'USD', 'paid', 10000, '+15555553001', '2026-07-25T00:01:00Z'
  ),
  (
    '1174c000-0000-4000-8000-00000000003b',
    '1174c000-0000-4000-8000-000000000020',
    100000, 'USD', 'paid', 10000, '+15555553002', '2026-07-25T00:02:00Z'
  ),
  (
    '1174c000-0000-4000-8000-00000000003c',
    '1174c000-0000-4000-8000-000000000020',
    100000, 'USD', 'paid', 10000, '+15555553003', '2026-07-25T00:03:00Z'
  );

INSERT INTO public.brand_payout_releases (
  id, brand_id, event_id, occurrence_key, surface, provider, currency,
  anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
  partner_share_cents, provider_fee_cents, net_release_cents, status
) VALUES (
  '1174c000-0000-4000-8000-000000000040',
  '1174c000-0000-4000-8000-000000000010',
  '1174c000-0000-4000-8000-000000000020',
  'issue-1174-settle-release',
  'order', 'stripe', 'usd',
  '2026-07-20T00:00:00Z', '2026-07-23T00:00:00Z',
  300000, 30000, 12600, 3000, 254400, 'released'
);

-- Three released, selectable partner splits (already flipped to 'pending' with a
-- release id, mirroring release_partner_splits_for_organiser_release's output).
INSERT INTO public.partner_splits (
  id, order_id, brand_id, partner_account_id, mingla_fee_cents,
  partner_share_cents, transfer_currency, stripe_application_fee_id, status,
  provider, release_id
) VALUES
  (
    '1174c000-0000-4000-8000-0000000000a1',
    '1174c000-0000-4000-8000-00000000003a',
    '1174c000-0000-4000-8000-000000000010',
    '1174c000-0000-4000-8000-000000000002',
    10000, 4200, 'usd', 'stripe:1174c-A', 'pending', 'stripe',
    '1174c000-0000-4000-8000-000000000040'
  ),
  (
    '1174c000-0000-4000-8000-0000000000b1',
    '1174c000-0000-4000-8000-00000000003b',
    '1174c000-0000-4000-8000-000000000010',
    '1174c000-0000-4000-8000-000000000002',
    10000, 4200, 'usd', 'stripe:1174c-B', 'pending', 'stripe',
    '1174c000-0000-4000-8000-000000000040'
  ),
  (
    '1174c000-0000-4000-8000-0000000000c1',
    '1174c000-0000-4000-8000-00000000003c',
    '1174c000-0000-4000-8000-000000000010',
    '1174c000-0000-4000-8000-000000000002',
    10000, 4200, 'usd', 'stripe:1174c-C', 'pending', 'stripe',
    '1174c000-0000-4000-8000-000000000040'
  );

-- Planned partner legs for splits A and B (C is deliberately leg-less).
INSERT INTO public.payout_transfer_legs (
  release_id, partner_split_id, kind, chunk_index, principal_cents,
  fee_schedule_version
) VALUES
  (
    '1174c000-0000-4000-8000-000000000040',
    '1174c000-0000-4000-8000-0000000000a1',
    'partner', 0, 4200, 'stripe-platform-transfer-v1'
  ),
  (
    '1174c000-0000-4000-8000-000000000040',
    '1174c000-0000-4000-8000-0000000000b1',
    'partner', 0, 4200, 'stripe-platform-transfer-v1'
  );

--------------------------------------------------------------------------------
-- Scenario A — happy convergence, then idempotent exact replay.
--------------------------------------------------------------------------------
SELECT public.settle_partner_split_transfer('stripe:1174c-A', 'tr_1174c_A');
SELECT public.settle_partner_split_transfer('stripe:1174c-A', 'tr_1174c_A');

DO $$
DECLARE
  v_status text;
  v_transfer text;
  v_legs integer;
  v_attempt integer;
BEGIN
  SELECT status, stripe_transfer_id INTO v_status, v_transfer
  FROM public.partner_splits
  WHERE id = '1174c000-0000-4000-8000-0000000000a1';
  IF v_status <> 'transferred' OR v_transfer <> 'tr_1174c_A' THEN
    RAISE EXCEPTION 'settle did not converge split A: status %, transfer %',
      v_status, v_transfer;
  END IF;

  SELECT count(*)::integer, max(attempt_count)::integer INTO v_legs, v_attempt
  FROM public.payout_transfer_legs
  WHERE partner_split_id = '1174c000-0000-4000-8000-0000000000a1'
    AND kind = 'partner'
    AND status = 'succeeded'
    AND provider_transfer_code = 'tr_1174c_A';
  IF v_legs <> 1 THEN
    RAISE EXCEPTION 'split A must have exactly one succeeded leg, found %', v_legs;
  END IF;
  -- Exact replay is a pure no-op: attempt_count is not double-incremented.
  IF v_attempt <> 1 THEN
    RAISE EXCEPTION 'idempotent replay changed attempt_count to %', v_attempt;
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- Scenario B — a real DB failure injected at the leg write AFTER the split is
-- marked. Both writes must roll back, the split must stay selectable, and the
-- same-transfer-id retry must converge with no duplicate leg.
--------------------------------------------------------------------------------
CREATE FUNCTION public.issue_1174c_fail_leg_settle()
RETURNS trigger
LANGUAGE plpgsql
AS $trg$
BEGIN
  IF NEW.partner_split_id = '1174c000-0000-4000-8000-0000000000b1'
     AND NEW.status = 'succeeded' THEN
    RAISE EXCEPTION 'issue_1174c_injected_leg_write_failure';
  END IF;
  RETURN NEW;
END;
$trg$;

CREATE TRIGGER issue_1174c_fail_leg_settle
  BEFORE UPDATE ON public.payout_transfer_legs
  FOR EACH ROW EXECUTE FUNCTION public.issue_1174c_fail_leg_settle();

DO $$
DECLARE
  v_split_status text;
  v_leg_status text;
  v_succeeded integer;
  v_selectable integer;
BEGIN
  BEGIN
    PERFORM public.settle_partner_split_transfer('stripe:1174c-B', 'tr_1174c_B');
    RAISE EXCEPTION 'expected injected leg write failure did not fire';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%issue_1174c_injected_leg_write_failure%' THEN
        RAISE;
      END IF;
  END;

  -- Both state changes rolled back together.
  SELECT status INTO v_split_status
  FROM public.partner_splits
  WHERE id = '1174c000-0000-4000-8000-0000000000b1';
  IF v_split_status <> 'pending' THEN
    RAISE EXCEPTION
      'split B marker survived a rolled-back settle: status %', v_split_status;
  END IF;

  SELECT status INTO v_leg_status
  FROM public.payout_transfer_legs
  WHERE partner_split_id = '1174c000-0000-4000-8000-0000000000b1'
    AND kind = 'partner';
  IF v_leg_status <> 'planned' THEN
    RAISE EXCEPTION
      'leg B changed after a rolled-back settle: status %', v_leg_status;
  END IF;

  SELECT count(*)::integer INTO v_succeeded
  FROM public.payout_transfer_legs
  WHERE partner_split_id = '1174c000-0000-4000-8000-0000000000b1'
    AND status = 'succeeded';
  IF v_succeeded <> 0 THEN
    RAISE EXCEPTION 'a leg was succeeded despite the rolled-back settle: %',
      v_succeeded;
  END IF;

  -- The next sweep re-selects exactly this still-pending split.
  SELECT count(*)::integer INTO v_selectable
  FROM public.release_partner_splits_for_organiser_release(
    '1174c000-0000-4000-8000-000000000040'
  )
  WHERE id = '1174c000-0000-4000-8000-0000000000b1';
  IF v_selectable <> 1 THEN
    RAISE EXCEPTION
      'rolled-back split B is not selectable by the next sweep: %', v_selectable;
  END IF;
END;
$$;

DROP TRIGGER issue_1174c_fail_leg_settle ON public.payout_transfer_legs;
DROP FUNCTION public.issue_1174c_fail_leg_settle();

-- One atomic retry with the SAME transfer id converges: transferred split +
-- exactly one succeeded leg carrying that exact provider transfer code.
SELECT public.settle_partner_split_transfer('stripe:1174c-B', 'tr_1174c_B');

DO $$
DECLARE
  v_status text;
  v_transfer text;
  v_legs integer;
BEGIN
  SELECT status, stripe_transfer_id INTO v_status, v_transfer
  FROM public.partner_splits
  WHERE id = '1174c000-0000-4000-8000-0000000000b1';
  IF v_status <> 'transferred' OR v_transfer <> 'tr_1174c_B' THEN
    RAISE EXCEPTION 'retry did not converge split B: status %, transfer %',
      v_status, v_transfer;
  END IF;

  SELECT count(*)::integer INTO v_legs
  FROM public.payout_transfer_legs
  WHERE partner_split_id = '1174c000-0000-4000-8000-0000000000b1'
    AND kind = 'partner';
  IF v_legs <> 1 THEN
    RAISE EXCEPTION 'retry duplicated split B legs: %', v_legs;
  END IF;

  SELECT count(*)::integer INTO v_legs
  FROM public.payout_transfer_legs
  WHERE partner_split_id = '1174c000-0000-4000-8000-0000000000b1'
    AND kind = 'partner'
    AND status = 'succeeded'
    AND provider_transfer_code = 'tr_1174c_B';
  IF v_legs <> 1 THEN
    RAISE EXCEPTION
      'converged split B lacks exactly one succeeded leg for its code: %', v_legs;
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- Scenario C — fail closed: a split can never be marked transferred without a
-- settled leg. A leg-less split raises the invariant and rolls the marker back.
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_status text;
BEGIN
  BEGIN
    PERFORM public.settle_partner_split_transfer('stripe:1174c-C', 'tr_1174c_C');
    RAISE EXCEPTION 'leg-less settle unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%exactly one succeeded partner leg%' THEN
        RAISE;
      END IF;
  END;

  SELECT status INTO v_status
  FROM public.partner_splits
  WHERE id = '1174c000-0000-4000-8000-0000000000c1';
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION
      'leg-less split C was marked transferred without a leg: status %', v_status;
  END IF;
END;
$$;

ROLLBACK;
