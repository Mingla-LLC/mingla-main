// StripeNativeProvider — native Stripe SDK provider wrapper.
//
// Per META-ORCH-0827 Pass 2 (from mingla-business/src/payments/StripeNativeProvider.native.tsx).
// Native-only. Mounted near the root of each consuming app's component tree.
// Consumers pass the publishable key as a prop OR rely on the
// EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env var (recommended — both apps use
// the same Stripe Connect platform).
//
// ORCH-0834-rescoped (2026-05-14): extended with optional `merchantIdentifier`
// + `urlScheme` props per Stripe RN documented requirements.
//   - merchantIdentifier is required for Apple Pay support
//     (com.apple.developer.in-app-payments entitlement). Plain card payments
//     work without it; absence only disables Apple Pay row in PaymentSheet.
//   - urlScheme is required for 3D Secure return flows + Apple/Google Pay
//     redirect callbacks. Test card 4242 4242 4242 4242 does not trigger
//     3DS, so absence does not block plain card payments — but real production
//     cards that DO need 3DS will fail without it.
// Both props have EXPO_PUBLIC_* env-var fallbacks matching the publishableKey
// resolution pattern (Constants.expoConfig.extra → process.env).
//
// Invariant established at CLOSE: I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG —
// StripeProvider MUST receive merchantIdentifier + urlScheme in addition to
// publishableKey. CI gate via orch-0834-rescoped-regression-check.

import React from "react";
import Constants from "expo-constants";
import { StripeProvider } from "@stripe/stripe-react-native";

interface StripeNativeProviderProps {
  children: React.ReactNode;
  publishableKey?: string;
  /**
   * Apple Pay merchant identifier (e.g. "merchant.com.mingla.app.v2").
   * Falls back to EXPO_PUBLIC_STRIPE_MERCHANT_ID env var. Required for
   * Apple Pay; harmless for plain card flows.
   */
  merchantIdentifier?: string;
  /**
   * App URL scheme for Stripe redirect callbacks (e.g. "com.mingla.app.v2").
   * Falls back to EXPO_PUBLIC_STRIPE_URL_SCHEME env var. Required for 3D
   * Secure + Apple/Google Pay return flows; harmless for non-3DS cards.
   */
  urlScheme?: string;
}

const resolveEnvString = (
  expoExtraKey: string,
  processEnvKey: string,
): string | undefined => {
  const fromExtra = (
    Constants.expoConfig?.extra as Record<string, unknown> | undefined
  )?.[expoExtraKey];
  const fromEnv = process.env[processEnvKey];

  // Expo config is an untyped native boundary at runtime. A TypeScript cast
  // does not convert a malformed/object value into a string. Passing that
  // value through to Stripe crashes iOS in StripeSdkImpl.initialise (and
  // rejects on Android) before the signed-out screen can render.
  if (typeof fromExtra === "string") return fromExtra;
  if (typeof fromEnv === "string") return fromEnv;
  return undefined;
};

// #1732/#1733 — WHY THIS STILL ENDS IN `?? ""`, DELIBERATELY. Read before
// "fixing" it; the honest-looking change here is the dangerous one.
//
// The empty string is what turns "the key is absent" into "checkout is silently
// dead", so making it throw or warn was assessed at #1733. Verdict: DO NOT
// throw. Reasons, from a full consumer walk of this shared package:
//
//   · TWO mount sites, both native, neither passes `publishableKey`:
//     `app-mobile/app/_layout.tsx` mounts it at the ROOT of the consumer app,
//     and `mingla-business/src/payments/StripeProviderWrapper.native.tsx`
//     mounts it around the business checkout payment routes. A throw here is
//     therefore a throw during ROOT render on consumer — and issue #993 records
//     that boot-render throws are invisible behind the never-hidden splash. It
//     would convert a degraded-checkout state into a bricked app, which is the
//     #990 failure mode, on the app whose users are buyers.
//   · `mingla-business` can never reach the empty string: its `app.config.ts`
//     always emits a key into `extra` (a live key, or the sandbox literal on
//     local dev), so the only app a throw could ever fire on is the consumer.
//   · On `app-mobile` the empty string is now UNREACHABLE on any shipped build:
//     since #1733 the config emits this key into `extra`, and since the same
//     change a release-bound `EAS_BUILD_PROFILE` with the key missing FAILS THE
//     BUILD. The hole is closed where it should be — at build time, loudly —
//     rather than at mount, where the app is already in a user's hands.
//   · What remains is local dev with no env, where `extra` carries `null` and
//     the empty string is the correct, honest value: the root provider mounts
//     without a bundled key and every payment path calls `initStripe()` with a
//     SERVER-supplied key immediately before opening the sheet (`initStripe`
//     REPLACES the SDK config rather than merging), and the server side cannot
//     supply an empty one — `resolvePublishableKey()` in
//     `supabase/functions/_shared/stripeMode.ts` throws when no key is set.
//
// So a throw would break exactly the case where the empty string is right, on a
// package shared by both apps, to defend a case that can no longer occur.
// Changing this is a product decision with its own issue, not a drive-by.
const resolvePublishableKey = (): string =>
  resolveEnvString(
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  ) ?? "";

const resolveMerchantIdentifier = (): string | undefined =>
  resolveEnvString(
    "EXPO_PUBLIC_STRIPE_MERCHANT_ID",
    "EXPO_PUBLIC_STRIPE_MERCHANT_ID",
  );

const resolveUrlScheme = (): string | undefined =>
  resolveEnvString(
    "EXPO_PUBLIC_STRIPE_URL_SCHEME",
    "EXPO_PUBLIC_STRIPE_URL_SCHEME",
  );

export const StripeNativeProvider: React.FC<StripeNativeProviderProps> = ({
  children,
  publishableKey,
  merchantIdentifier,
  urlScheme,
  // ORCH-1387 (SC-11 triage, type-annotation-only + runtime-inert): explicit
  // props annotation. In the app tsc programs this package resolves at its
  // realpath (packages/payments-native/), where `react` cannot resolve —
  // React.FC degrades to an error type and the four binding elements went
  // implicitly-any (TS7031). Annotating the param binds them to the local
  // interface regardless of react resolution. Erased at transpile.
}: StripeNativeProviderProps) => {
  const key = publishableKey ?? resolvePublishableKey();
  const mid = merchantIdentifier ?? resolveMerchantIdentifier();
  const scheme = urlScheme ?? resolveUrlScheme();
  return (
    <StripeProvider
      publishableKey={key}
      merchantIdentifier={mid}
      urlScheme={scheme}
    >
      <>{children}</>
    </StripeProvider>
  );
};
