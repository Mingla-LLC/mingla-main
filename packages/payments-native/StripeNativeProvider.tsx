// StripeNativeProvider — native Stripe SDK provider wrapper.
//
// Per META-ORCH-0827 Pass 2 (from mingla-business/src/payments/StripeNativeProvider.native.tsx).
// Native-only. Mounted near the root of each consuming app's component tree.
// Consumers pass the publishable key as a prop OR rely on the
// EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env var (recommended — both apps use
// the same Stripe Connect platform).

import React from "react";
import Constants from "expo-constants";
import { StripeProvider } from "@stripe/stripe-react-native";

interface StripeNativeProviderProps {
  children: React.ReactNode;
  publishableKey?: string;
}

const resolvePublishableKey = (): string => {
  const fromExpoExtra = (
    Constants.expoConfig?.extra as Record<string, string | undefined> | undefined
  )?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return fromExpoExtra ?? fromEnv ?? "";
};

export const StripeNativeProvider: React.FC<StripeNativeProviderProps> = ({
  children,
  publishableKey,
}) => {
  const key = publishableKey ?? resolvePublishableKey();
  return (
    <StripeProvider publishableKey={key}>
      <>{children}</>
    </StripeProvider>
  );
};
