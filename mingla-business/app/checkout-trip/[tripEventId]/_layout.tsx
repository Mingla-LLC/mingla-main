/**
 * Checkout-trip route group layout. ORCH-0876 [Trip CRUD + Purchase Flow
 * Completion] — mirror of `app/checkout/[eventId]/_layout.tsx`.
 *
 * Lives OUTSIDE `app/(tabs)/` so:
 *   - Bottom tab bar is suppressed automatically
 *   - Anon-tolerant: never calls useAuth; buyers without a Mingla
 *     account walk through (per `feedback_anon_buyer_routes.md`)
 *   - Native swipe-back works between index → buyer → payment;
 *     confirm.tsx disables it explicitly (mirror Cycle 8b)
 *
 * Wraps every trip-checkout screen in a CartProvider so the 5 screens
 * share one in-memory cart. NO Zustand, NO AsyncStorage. Cart lifetime =
 * single tab session.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §8.1.
 */

import React from "react";
import { Stack } from "expo-router";

import { CartProvider } from "../../../src/components/checkout/CartContext";

export default function CheckoutTripLayout(): React.ReactElement {
  return (
    <CartProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </CartProvider>
  );
}
