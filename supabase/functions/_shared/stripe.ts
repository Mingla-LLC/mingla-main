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
 * I-PROPOSED-J (DRAFT post-B2a CLOSE): Stripe Embedded Components are exposed
 * via either Stripe's prescribed native preview SDK (Path A future) or a
 * Mingla-hosted web page rendering the web SDK opened via expo-web-browser
 * (Path B current). DIY-wrapping @stripe/connect-js in react-native-webview
 * is FORBIDDEN.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime
import Stripe from "https://esm.sh/stripe@18.0.0?target=denonext";

export const STRIPE_API_VERSION = "2026-04-30.preview" as const;

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

if (!STRIPE_SECRET_KEY) {
  throw new Error(
    "STRIPE_SECRET_KEY environment variable is not set. Configure in Supabase Dashboard → Project Settings → Edge Functions → Secrets.",
  );
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  appInfo: {
    name: "Mingla",
    version: "1.0.0",
    url: "https://mingla.com",
  },
});

export type StripeClient = typeof stripe;
