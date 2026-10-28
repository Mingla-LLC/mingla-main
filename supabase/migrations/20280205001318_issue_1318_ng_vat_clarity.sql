-- #1318 — Nigeria's configured VAT is not a Stripe tax registration.
--
-- The canonical pricing writers previously required a fresh Stripe attestation
-- for every pass_tax=true write. That made the real Paystack/NG rail send hosts
-- to a provider they do not use. Admit only the configured-VAT branch already
-- owned by country_vat_config; every Stripe/other-market check remains byte-for-
-- byte equivalent to #1974's fail-closed attestation guard.
--
-- INVARIANT: {"id":"I-1318-CONFIGURED-VAT-NO-STRIPE-DETOUR","rule":"A Paystack brand may pass VAT without a Stripe tax attestation only when its payout country has an active country_vat_config row; every Stripe or unconfigured market still requires a fresh attestation tied to its active Stripe account."}

CREATE OR REPLACE FUNCTION public.issue_1974_require_fresh_tax_registration(
  p_brand_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.brands brand
    JOIN public.country_vat_config vat
      ON vat.country = brand.payment_country
    WHERE brand.id = p_brand_id
      AND brand.deleted_at IS NULL
      AND brand.payment_provider = 'paystack'
      AND vat.vat_rate_bps > 0
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_tax_registration_attestations attestation
    JOIN public.stripe_connect_accounts account
      ON account.brand_id = attestation.brand_id
     AND account.detached_at IS NULL
     AND account.stripe_account_id = attestation.stripe_account_id
    WHERE attestation.brand_id = p_brand_id
      AND attestation.has_active_registration
      AND attestation.source = 'brand-tax-registrations-list'
      AND attestation.observed_at >= clock_timestamp() - interval '5 minutes'
      AND attestation.observed_at <= clock_timestamp() + interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'tax_registration_required';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_1974_require_fresh_tax_registration(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1974_require_fresh_tax_registration(uuid)
  TO service_role;
