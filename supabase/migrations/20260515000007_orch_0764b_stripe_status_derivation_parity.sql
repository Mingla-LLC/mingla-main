-- ORCH-0764B Stripe onboarding state reconciliation
--
-- Keep public.pg_derive_brand_stripe_status in parity with
-- mingla-business/src/utils/deriveBrandStripeStatus.ts: a connected account
-- with any requirements.disabled_reason is restricted even if charges_enabled
-- is true. This prevents the mobile app from briefly showing a green/active
-- status while Stripe still has actionable or terminal requirements.

CREATE OR REPLACE FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid")
RETURNS "text"
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN sca.detached_at IS NOT NULL THEN 'not_connected'::text
          WHEN sca.requirements ? 'disabled_reason'
            AND NULLIF(sca.requirements->>'disabled_reason', '') IS NOT NULL
            THEN 'restricted'::text
          WHEN sca.charges_enabled = true THEN 'active'::text
          ELSE 'onboarding'::text
        END
      FROM public.stripe_connect_accounts sca
      WHERE sca.brand_id = p_brand_id
      LIMIT 1
    ),
    'not_connected'::text
  );
$$;

COMMENT ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") IS
  'Returns brand.stripeStatus enum (not_connected, onboarding, active, restricted). ORCH-0764B parity fix: requirements.disabled_reason takes precedence over charges_enabled. TS twin at mingla-business/src/utils/deriveBrandStripeStatus.ts must stay equivalent.';
