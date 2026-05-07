-- B2a Path C V3 — revoke anon GRANT on pg_derive_brand_stripe_status per D-V3-6 (V2 D-V2-6).
-- Per outputs/SPEC_B2_PATH_C_V3.md §2 D-V3-6.
-- Per Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md CF-5 (information disclosure surface).
--
-- WHY this migration exists:
-- The original B2a migration 20260508000000 granted EXECUTE on pg_derive_brand_stripe_status
-- to anon role. Forensics CF-5 flagged this as a gratuitous information-disclosure surface:
-- anonymous users can probe whether arbitrary brands have Stripe configured. SECURITY DEFINER
-- bypasses RLS, so the function reads stripe_connect_accounts directly. No legitimate caller
-- needs anon access to this helper.
--
-- This migration revokes the anon GRANT. Authenticated + service_role grants preserved.

REVOKE EXECUTE ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") FROM "anon";

COMMENT ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") IS
  'Returns brand stripeStatus enum (not_connected, onboarding, active, restricted). Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.1.1 + DEC-15. TS twin at mingla-business/src/utils/deriveBrandStripeStatus.ts must stay byte-for-byte equivalent. ANON GRANT REVOKED 2026-05-06 per D-V3-6.';
