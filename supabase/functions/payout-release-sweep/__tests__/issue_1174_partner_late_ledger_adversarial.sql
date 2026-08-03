\set ON_ERROR_STOP on

-- Tester-owned adversarial regression for issue #1174.
--
-- Reproduces the real ordering seam:
--   1. checkout finalizes the order;
--   2. the release sweep attaches its immutable ledger item;
--   3. the charge webhook records the held partner split slightly later.
--
-- Planning must reconcile the late partner principal into ledger truth before
-- organiser execution. Otherwise the organiser receives that principal while
-- Mingla separately funds the partner transfer from platform/main balance.

BEGIN;

INSERT INTO auth.users (id) VALUES
  ('11740000-0000-4000-8000-000000000001'),
  ('11740000-0000-4000-8000-000000000002');

INSERT INTO public.creator_accounts (id, email, partner_enabled) VALUES
  (
    '11740000-0000-4000-8000-000000000001',
    'issue-1174-owner@example.test',
    false
  ),
  (
    '11740000-0000-4000-8000-000000000002',
    'issue-1174-partner@example.test',
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
  '11740000-0000-4000-8000-000000000003',
  '11740000-0000-4000-8000-000000000001',
  'Issue 1174 Race Brand',
  'issue-1174-race-brand',
  'NGN',
  'paystack',
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
  '11740000-0000-4000-8000-000000000004',
  '11740000-0000-4000-8000-000000000003',
  'Issue 1174 Race Event',
  'issue-1174-race-event',
  'NGN',
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
) VALUES (
  '11740000-0000-4000-8000-000000000005',
  '11740000-0000-4000-8000-000000000004',
  1000000,
  'NGN',
  'paid',
  100000,
  '+15555550174',
  '2026-07-25T00:00:00Z'
);

INSERT INTO public.brand_team_members (
  brand_id,
  user_id,
  role,
  accepted_at
) VALUES (
  '11740000-0000-4000-8000-000000000003',
  '11740000-0000-4000-8000-000000000002',
  'brand_admin',
  '2026-07-25T00:30:00Z'
);

-- Simulate the dark sweep attaching before the partner webhook finishes.
INSERT INTO public.brand_payout_releases (
  id,
  brand_id,
  event_id,
  occurrence_key,
  surface,
  provider,
  currency,
  anchor_end_at,
  releasable_at,
  gross_cents,
  mingla_fee_cents,
  partner_share_cents,
  provider_fee_cents,
  net_release_cents,
  status
) VALUES (
  '11740000-0000-4000-8000-000000000006',
  '11740000-0000-4000-8000-000000000003',
  '11740000-0000-4000-8000-000000000004',
  'issue-1174-race',
  'order',
  'paystack',
  'ngn',
  '2026-07-20T00:00:00Z',
  '2026-07-23T00:00:00Z',
  1000000,
  100000,
  0,
  10000,
  890000,
  'pending'
);

INSERT INTO public.payout_release_items (
  release_id,
  source_type,
  source_id,
  gross_cents,
  mingla_fee_cents,
  partner_share_cents,
  provider_fee_cents,
  net_cents,
  source_finalized_at
) VALUES (
  '11740000-0000-4000-8000-000000000006',
  'order',
  '11740000-0000-4000-8000-000000000005',
  1000000,
  100000,
  0,
  10000,
  890000,
  '2026-07-25T00:00:00Z'
);

DO $$
BEGIN
  IF public.resolve_partner_for_brand_at_time(
    '11740000-0000-4000-8000-000000000003',
    '2026-07-25T00:00:00Z'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'partner must not exist at order creation';
  END IF;
  IF public.resolve_partner_for_brand_at_time(
    '11740000-0000-4000-8000-000000000003',
    '2026-07-25T01:00:00Z'
  ) IS DISTINCT FROM '11740000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'partner must exist at provider payment time';
  END IF;
END;
$$;

DO $$
DECLARE
  v_plan jsonb;
BEGIN
  v_plan := public.plan_pending_payout_partner_legs(100);
  IF (v_plan->>'blocked_partner_attributions')::integer <> 1 THEN
    RAISE EXCEPTION
      'missing provider-sale outcome did not block execution: %',
      v_plan;
  END IF;
END;
$$;

-- Provider-sale attribution and its held obligation commit together. There is
-- no service-role-visible state in which planning can reserve principal but
-- omit the transfer obligation.
SELECT public.record_payout_partner_outcome(
  'paystack:issue-1174-late-partner',
  '11740000-0000-4000-8000-000000000005',
  '11740000-0000-4000-8000-000000000003',
  '11740000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z',
  100000,
  10000,
  'ngn',
  'paystack'
);

SELECT public.plan_pending_payout_partner_legs(100);
SELECT public.plan_pending_payout_partner_legs(100);

DO $$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_item public.payout_release_items%ROWTYPE;
  v_correction integer;
  v_correction_count integer;
  v_leg_count integer;
BEGIN
  SELECT * INTO STRICT v_release
  FROM public.brand_payout_releases
  WHERE id = '11740000-0000-4000-8000-000000000006';

  SELECT * INTO STRICT v_item
  FROM public.payout_release_items
  WHERE source_type = 'order'
    AND source_id = '11740000-0000-4000-8000-000000000005';

  SELECT coalesce(sum(amount_cents), 0)::integer, count(*)::integer
    INTO v_correction, v_correction_count
  FROM public.payout_ledger_adjustments
  WHERE release_id = v_release.id
    AND kind = 'partner_principal_correction';

  SELECT count(*)::integer INTO v_leg_count
  FROM public.payout_transfer_legs
  WHERE release_id = v_release.id
    AND kind = 'partner';

  IF v_item.partner_share_cents <> 0 THEN
    RAISE EXCEPTION
      'immutable item was rewritten after late split: expected 0, got %',
      v_item.partner_share_cents;
  END IF;

  IF v_correction <> 10000 OR v_correction_count <> 1 THEN
    RAISE EXCEPTION
      'partner correction not exactly-once: amount %, rows %',
      v_correction,
      v_correction_count;
  END IF;

  IF v_leg_count <> 1 THEN
    RAISE EXCEPTION
      'partner transfer leg not exactly-once: expected 1, got %',
      v_leg_count;
  END IF;

  IF v_release.partner_share_cents <> 10000 THEN
    RAISE EXCEPTION
      'late partner principal missing from release: expected 10000, got %',
      v_release.partner_share_cents;
  END IF;

  -- ₦10,000 gross - ₦1,000 Mingla fee - ₦100 partner principal
  -- - ₦100 processing fee - ₦10 partner transfer fee = ₦8,790.
  IF v_release.net_release_cents <> 879000 THEN
    RAISE EXCEPTION
      'organiser cash overpays late partner principal: expected 879000, got %',
      v_release.net_release_cents;
  END IF;
END;
$$;

-- Inverse boundary: the partner exists when the order is created, but is
-- removed before the provider confirms payment. Persisting the canonical
-- no-partner sale outcome must prevent a phantom correction or transfer leg.
UPDATE public.brand_team_members
SET removed_at = '2026-07-25T01:30:00Z'
WHERE brand_id = '11740000-0000-4000-8000-000000000003'
  AND user_id = '11740000-0000-4000-8000-000000000002';

INSERT INTO public.orders (
  id,
  event_id,
  total_cents,
  currency,
  payment_status,
  stripe_application_fee_amount_cents,
  buyer_phone_e164,
  created_at
) VALUES (
  '11740000-0000-4000-8000-000000000007',
  '11740000-0000-4000-8000-000000000004',
  1000000,
  'NGN',
  'paid',
  100000,
  '+15555550175',
  '2026-07-25T01:00:00Z'
);

INSERT INTO public.brand_payout_releases (
  id,
  brand_id,
  event_id,
  occurrence_key,
  surface,
  provider,
  currency,
  anchor_end_at,
  releasable_at,
  gross_cents,
  mingla_fee_cents,
  partner_share_cents,
  provider_fee_cents,
  net_release_cents,
  status
) VALUES (
  '11740000-0000-4000-8000-000000000008',
  '11740000-0000-4000-8000-000000000003',
  '11740000-0000-4000-8000-000000000004',
  'issue-1174-inverse',
  'order',
  'paystack',
  'ngn',
  '2026-07-20T00:00:00Z',
  '2026-07-23T00:00:00Z',
  1000000,
  100000,
  0,
  10000,
  890000,
  'pending'
);

INSERT INTO public.payout_release_items (
  release_id,
  source_type,
  source_id,
  gross_cents,
  mingla_fee_cents,
  partner_share_cents,
  provider_fee_cents,
  net_cents,
  source_finalized_at
) VALUES (
  '11740000-0000-4000-8000-000000000008',
  'order',
  '11740000-0000-4000-8000-000000000007',
  1000000,
  100000,
  0,
  10000,
  890000,
  '2026-07-25T01:00:00Z'
);

DO $$
BEGIN
  IF public.resolve_partner_for_brand_at_time(
    '11740000-0000-4000-8000-000000000003',
    '2026-07-25T01:00:00Z'
  ) IS DISTINCT FROM '11740000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'inverse partner must exist at order creation';
  END IF;
  IF public.resolve_partner_for_brand_at_time(
    '11740000-0000-4000-8000-000000000003',
    '2026-07-25T02:00:00Z'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'inverse partner must be absent at provider payment time';
  END IF;
END;
$$;

SELECT public.record_payout_partner_outcome(
  'paystack:issue-1174-no-partner',
  '11740000-0000-4000-8000-000000000007',
  '11740000-0000-4000-8000-000000000003',
  NULL,
  '2026-07-25T02:00:00Z',
  100000,
  0,
  'ngn',
  'paystack'
);

SELECT public.plan_pending_payout_partner_legs(100);
SELECT public.plan_pending_payout_partner_legs(100);

DO $$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_correction_count integer;
  v_leg_count integer;
BEGIN
  SELECT * INTO STRICT v_release
  FROM public.brand_payout_releases
  WHERE id = '11740000-0000-4000-8000-000000000008';

  SELECT count(*)::integer INTO v_correction_count
  FROM public.payout_ledger_adjustments
  WHERE release_id = v_release.id
    AND kind = 'partner_principal_correction';

  SELECT count(*)::integer INTO v_leg_count
  FROM public.payout_transfer_legs
  WHERE release_id = v_release.id
    AND kind = 'partner';

  IF v_correction_count <> 0 OR v_leg_count <> 0 THEN
    RAISE EXCEPTION
      'no-partner sale gained phantom accounting: corrections %, legs %',
      v_correction_count,
      v_leg_count;
  END IF;
  IF v_release.partner_share_cents <> 0
     OR v_release.net_release_cents <> 890000 THEN
    RAISE EXCEPTION
      'no-partner sale was underpaid: share %, net %',
      v_release.partner_share_cents,
      v_release.net_release_cents;
  END IF;
END;
$$;

ROLLBACK;
