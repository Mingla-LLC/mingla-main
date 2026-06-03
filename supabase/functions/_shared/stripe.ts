/**
 * Shared Stripe client wrapper for B2a Connect onboarding edge functions.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.2.1.
 *
 * PIN: D-B2-5 — Accounts v2 is in PUBLIC PREVIEW per Stripe's 2025-05-07
 * release-channel announcement. The .preview API version is required to
 * access POST /v2/core/accounts with controller properties.
 *
 * Verify at IMPL Phase 0 that 2026-04-30.preview is the current latest .preview
 * version (check docs.stripe.com/changelog). To upgrade: register a separate
 * ORCH cycle with regression test of B2a + B3 + B4 surfaces.
 *
 * I-PROPOSED-O (DRAFT post-B2a CLOSE): Stripe Embedded Components are exposed
 * via either Stripe's prescribed native preview SDK (Path A future) or a
 * Mingla-hosted web page rendering the web SDK opened via expo-web-browser
 * (Path B current). DIY-wrapping @stripe/connect-js in react-native-webview
 * is FORBIDDEN.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime
import Stripe from "https://esm.sh/stripe@18.0.0?target=denonext";
import { resolveStripeKey, type StripeRole } from "./stripeMode.ts";

// 2026-05-07 hotfix: was "2026-04-30.preview" — that version does NOT exist in
// Stripe's API catalog and is rejected by the SDK with "Invalid Stripe API version".
// Switched to latest stable. V1 `accounts.create` with `controller` properties
// (the marketplace controller-mode shape we use) IS supported in dahlia stable —
// Accounts v2 was the original motivator for preview-channel pinning, but our
// integration uses V1 controller properties, not the v2 endpoint.
export const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

/**
 * Legacy direct-env-var key resolution. RETAINED for backward compatibility
 * with callers that haven't migrated yet, but ORCH-1056 deprecates this
 * shape — new call sites MUST go through `createStripeClientForRole` so the
 * key is mode-routed by `resolveStripeKey(role)`.
 *
 * Forbidden outside this module + `stripeBlueprintClient.ts` per the strict-
 * grep gate `orch-1056-stripe-rak-via-helper.mjs`.
 */
export function createStripeClient(envVarName: string): Stripe {
  const key = Deno.env.get(envVarName);
  if (!key) {
    throw new Error(
      `${envVarName} environment variable is not set. Configure the function-specific Stripe Restricted API Key in Supabase Edge Function secrets.`,
    );
  }

  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      // B2a Path C V3 forensics C-1: was `name: "Mingla", url: "https://mingla.com"` —
      // domain isn't Mingla-owned. Canonical is usemingla.com per ORCH-0350 +
      // Stripe platform business_profile.url.
      name: "Mingla Business",
      version: "1.0.0",
      url: "https://usemingla.com",
    },
  });
}

/**
 * ORCH-1056 canonical client constructor. Resolves the per-role restricted
 * API key from `MINGLA_STRIPE_MODE` + `STRIPE_RAK_{role}_{mode}` via
 * `_shared/stripeMode.ts`. All `stripe*()` helpers below route through this.
 */
export function createStripeClientForRole(role: StripeRole): Stripe {
  const key = resolveStripeKey(role);
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: "Mingla Business",
      version: "1.0.0",
      url: "https://usemingla.com",
    },
  });
}

export const stripeOnboard = () => createStripeClientForRole("ONBOARD");
export const stripeWebhook = () => createStripeClientForRole("WEBHOOK");
export const stripeRefreshStatus = () =>
  createStripeClientForRole("REFRESH_STATUS");
export const stripeDetach = () => createStripeClientForRole("DETACH");
export const stripeBalances = () => createStripeClientForRole("BALANCES");
export const stripeKycReminder = () =>
  createStripeClientForRole("KYC_REMINDER");
export const stripeTicketCheckout = () =>
  createStripeClientForRole("TICKET_CHECKOUT");
// ORCH-0787: Refund issuance uses platform-account refunds with reverse_transfer.
// Restricted API key must grant refunds:write + application_fees:read on the platform account.
export const stripeTicketRefund = () =>
  createStripeClientForRole("TICKET_REFUND");

export type StripeClient = ReturnType<typeof createStripeClient>;
