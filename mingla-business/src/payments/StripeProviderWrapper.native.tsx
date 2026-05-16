// ORCH-0849 (2026-05-15): native variant — real <StripeNativeProvider>
// from @mingla/payments-native. Mounted at the root of mingla-business so
// PaymentSheet inherits the publishable key, merchant identifier, and URL
// scheme on iOS/Android. Parity with consumer (app-mobile/app/_layout.tsx).
// Metro picks this file on native; the sibling StripeProviderWrapper.tsx
// is a passthrough stub used on web + by tsc resolution.

import React from "react";
import { StripeNativeProvider } from "@mingla/payments-native";

export const StripeProviderWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <StripeNativeProvider
    merchantIdentifier="merchant.com.mingla.business.v2"
    urlScheme="com.mingla.business.v2"
  >
    {children}
  </StripeNativeProvider>
);
