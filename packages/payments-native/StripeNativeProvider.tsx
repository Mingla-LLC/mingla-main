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
    Constants.expoConfig?.extra as Record<string, string | undefined> | undefined
  )?.[expoExtraKey];
  const fromEnv = process.env[processEnvKey];
  return fromExtra ?? fromEnv ?? undefined;
};

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
}) => {
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
