-- Issue #3645 PR6 — sell-before-bank charge readiness (PG17).
-- Proves stamped Paystack hold-rail can collect without a subaccount, while
-- unstamped Paystack without subaccount cannot; payout helper requires bank.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-0000000000f1';
  v_hold    constant uuid := '36450000-0000-4000-8000-0000000000f2';
  v_legacy  constant uuid := '36450000-0000-4000-8000-0000000000f3';
  v_unstamp constant uuid := '36450000-0000-4000-8000-0000000000f4';
  v_stripe  constant uuid := '36450000-0000-4000-8000-0000000000f5';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-sbb@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency,
    paystack_subaccount_code, payout_hold_cutover_at
  ) VALUES
    (v_hold, v_owner, 'Hold Rail', '3645-sbb-hold', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', NULL, now()),
    (v_legacy, v_owner, 'Legacy Split', '3645-sbb-legacy', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', 'ACCT_legacy', NULL),
    (v_unstamp, v_owner, 'Unstamped NG', '3645-sbb-unstamp', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', NULL, NULL),
    (v_stripe, v_owner, 'Stripe Charges', '3645-sbb-stripe', 'GBP',
     'stripe', NULL, 'GB', 'GBP', NULL, NULL);

  INSERT INTO public.stripe_connect_accounts (
    brand_id, stripe_account_id, charges_enabled, payouts_enabled,
    country, default_currency
  ) VALUES (
    v_stripe, 'acct_3645_sbb', true, false,
    'GB', 'gbp'
  );

  IF public.pg_brand_can_collect(v_hold) IS NOT TRUE THEN
    RAISE EXCEPTION 'hold-rail stamped without subaccount must collect';
  END IF;
  IF public.pg_brand_can_payout(v_hold) IS NOT FALSE THEN
    RAISE EXCEPTION 'hold-rail without bank must NOT payout';
  END IF;

  IF public.pg_brand_can_collect(v_legacy) IS NOT TRUE THEN
    RAISE EXCEPTION 'legacy Paystack subaccount must collect';
  END IF;
  IF public.pg_brand_can_payout(v_legacy) IS NOT TRUE THEN
    RAISE EXCEPTION 'legacy Paystack subaccount must payout';
  END IF;

  IF public.pg_brand_can_collect(v_unstamp) IS NOT FALSE THEN
    RAISE EXCEPTION 'unstamped Paystack without subaccount must NOT collect';
  END IF;

  IF public.pg_brand_can_collect(v_stripe) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stripe charges_enabled must collect (sell before bank)';
  END IF;
  IF public.pg_brand_can_charge(v_stripe) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stripe charges_enabled must charge';
  END IF;
  IF public.pg_brand_can_payout(v_stripe) IS NOT FALSE THEN
    RAISE EXCEPTION 'Stripe charges without payouts_enabled must NOT payout';
  END IF;

  -- Recipient-only Paystack brand (no subaccount) must payout.
  INSERT INTO public.brand_paystack_recipients (
    brand_id, recipient_code, bank_code, account_fingerprint,
    account_number_masked, account_name, is_active
  ) VALUES (
    v_hold,
    'RCP_3645sbbhold',
    '058',
    'hmac-sha256:' || repeat('a', 64),
    '••••1234',
    'Hold Rail Recipient',
    true
  );
  IF public.pg_brand_can_payout(v_hold) IS NOT TRUE THEN
    RAISE EXCEPTION 'active Paystack recipient must payout without subaccount';
  END IF;

  RAISE NOTICE 'issue_3645_sell_before_bank charge readiness PASS';
END
$test$;

ROLLBACK;
