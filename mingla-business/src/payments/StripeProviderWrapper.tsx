// ORCH-0849 (2026-05-15): web-safe stub. Passthrough Fragment so checkout
// payment route wrappers compose identically on web — mingla-business web
// buyers go through Stripe Hosted Checkout (no PaymentSheet, no StripeProvider
// needed). Must NOT import @mingla/payments-native or any module that
// transitively pulls @stripe/stripe-react-native — I-PROPOSED-AE /
// ORCH-0778. The real implementation lives in
// StripeProviderWrapper.native.tsx.

import React from "react";

export const StripeProviderWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;
