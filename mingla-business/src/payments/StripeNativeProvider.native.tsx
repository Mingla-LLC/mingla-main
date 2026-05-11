import React from "react";
import Constants from "expo-constants";
import { StripeProvider } from "@stripe/stripe-react-native";

const stripePublishableKey =
  (Constants.expoConfig?.extra as Record<string, string | undefined> | undefined)
    ?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
  "";

export const StripeNativeProvider = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => (
  <StripeProvider publishableKey={stripePublishableKey}>
    <>{children}</>
  </StripeProvider>
);
