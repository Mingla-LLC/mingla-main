\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

INSERT INTO public.brands (id, account_id, name, slug)
VALUES (
  '11720000-0000-0000-0000-000000000001',
  '11720000-0000-0000-0000-000000000002',
  'Issue 1172',
  'issue-1172'
);

INSERT INTO public.events (id, brand_id, created_by, title, slug, status)
VALUES (
  '11720000-0000-0000-0000-000000000003',
  '11720000-0000-0000-0000-000000000001',
  '11720000-0000-0000-0000-000000000004',
  'Ledger payout proof',
  'ledger-payout-proof',
  'ended'
);

INSERT INTO public.event_dates (id, event_id, start_at, end_at)
VALUES (
  '11720000-0000-0000-0000-000000000005',
  '11720000-0000-0000-0000-000000000003',
  '2027-01-01 17:00:00+00',
  '2027-01-01 20:00:00+00'
);

INSERT INTO public.stripe_connect_accounts (
  id,
  brand_id,
  stripe_account_id,
  country,
  default_currency,
  payouts_enabled
) VALUES (
  '11720000-0000-0000-0000-000000000006',
  '11720000-0000-0000-0000-000000000001',
  'acct_issue1172',
  'US',
  'USD',
  true
);

INSERT INTO public.brand_payout_releases (
  id,
  brand_id,
  event_id,
  event_date_id,
  occurrence_key,
  surface,
  provider,
  currency,
  anchor_end_at,
  releasable_at,
  gross_cents,
  attempt_count,
  net_release_cents
) VALUES (
  '11720000-0000-0000-0000-000000000007',
  '11720000-0000-0000-0000-000000000001',
  '11720000-0000-0000-0000-000000000003',
  '11720000-0000-0000-0000-000000000005',
  'issue-1172-occurrence',
  'order',
  'stripe',
  'usd',
  '2027-01-01 20:00:00+00',
  '2027-01-04 20:00:00+00',
  10000,
  1,
  7000
);

INSERT INTO public.payout_ledger_adjustments (
  release_id,
  brand_id,
  currency,
  kind,
  amount_cents,
  idempotency_key
) VALUES (
  '11720000-0000-0000-0000-000000000007',
  '11720000-0000-0000-0000-000000000001',
  'usd',
  'maturity_recredit',
  500,
  'issue-1172-maturity-recredit'
);

SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE issue_1172_claim AS
SELECT *
FROM public.claim_stripe_payout_releases(
  20,
  '2027-01-10 00:00:00+00'
);

DO $test$
DECLARE
  v_claim record;
BEGIN
  SELECT * INTO STRICT v_claim FROM issue_1172_claim;

  IF v_claim.release_id <> '11720000-0000-0000-0000-000000000007'::uuid
    OR v_claim.stripe_account_id <> 'acct_issue1172'
    OR v_claim.net_release_cents <> 7000
    OR v_claim.maturity_recredit_cents <> 500
    OR v_claim.attempt_count <> 1
    OR v_claim.claim_id IS NULL
  THEN
    RAISE EXCEPTION 'claim did not preserve the exact ledger release';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_claim_id uuid;
  v_result text;
BEGIN
  SELECT claim_id INTO STRICT v_claim_id FROM issue_1172_claim;

  BEGIN
    PERFORM public.record_stripe_payout_execution(
      '11720000-0000-0000-0000-000000000007',
      v_claim_id,
      'accepted',
      'po_wrong_amount',
      7499,
      NULL,
      '2027-01-10 00:00:01+00'
    );
    RAISE EXCEPTION 'wrong ledger amount was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'stripe_release_amount_not_ledger_exact' THEN
        RAISE;
      END IF;
  END;

  v_result := public.record_stripe_payout_execution(
    '11720000-0000-0000-0000-000000000007',
    v_claim_id,
    'accepted',
    'po_issue1172',
    7500,
    NULL,
    '2027-01-10 00:00:02+00'
  );

  IF v_result <> 'released' THEN
    RAISE EXCEPTION 'accepted Stripe payout was not released';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_release public.brand_payout_releases;
BEGIN
  SELECT * INTO STRICT v_release
  FROM public.brand_payout_releases
  WHERE id = '11720000-0000-0000-0000-000000000007';

  IF v_release.status <> 'released'
    OR v_release.stripe_payout_id <> 'po_issue1172'
    OR v_release.organiser_cash_delivered_cents <> 7500
    OR v_release.maturity_recredit_cents <> 500
    OR v_release.released_at <> '2027-01-10 00:00:02+00'
    OR v_release.stripe_execution_claim_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'accepted payout was not reconciled to the release';
  END IF;
END;
$test$;

ROLLBACK;
