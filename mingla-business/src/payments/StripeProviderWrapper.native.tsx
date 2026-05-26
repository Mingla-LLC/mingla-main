// ORCH-0849 (2026-05-15): native variant — real <StripeNativeProvider>
// from @mingla/payments-native. Mounted around native checkout payment routes
// so PaymentSheet inherits the publishable key, merchant identifier, and URL
// scheme on iOS/Android without forcing Stripe SDK cold-init on Home startup.
// Metro picks this file on native; the sibling StripeProviderWrapper.tsx
// is a passthrough stub used on web + by tsc resolution.

import React from "react";
import { StripeNativeProvider } from "@mingla/payments-native";

export const StripeProviderWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  // ORCH-0849 HOTFIX (round 4, 2026-05-16): merchantIdentifier MUST match
  // app.json's @stripe/stripe-react-native plugin config (app.json:99 =
  // `merchant.com.sethogieva.minglabusiness`) because that's what's actually
  // registered with Apple Developer + has the Stripe Apple Pay cert uploaded.
  // Mismatch makes iOS stall Apple Pay at confirm. urlScheme matches the iOS
  // bundleIdentifier for return-URL deep links.
  <StripeNativeProvider
    merchantIdentifier="merchant.com.sethogieva.minglabusiness"
    urlScheme="com.sethogieva.minglabusiness"
  >
    {children}
  </StripeNativeProvider>
);
