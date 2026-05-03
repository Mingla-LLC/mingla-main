/**
 * Checkout route group layout.
 *
 * Lives OUTSIDE `app/(tabs)/` so:
 *   - Bottom tab bar is suppressed automatically (route is not in the
 *     tabs group)
 *   - Anon-tolerant: never calls useAuth; buyers without a Mingla
 *     account walk through (Q-C1 — guest checkout)
 *   - Native swipe-back works between J-C1 → J-C2 → J-C3 → J-C5;
 *     J-C5 disables it explicitly (Cycle 8b)
 *
 * Wraps every checkout screen in a CartProvider so the 5 screens share
 * one in-memory cart. Per Q-C3: NO Zustand, NO AsyncStorage. Cart
 * lifetime = single tab session. Closing the tab abandons the cart.
 *
 * Per Cycle 8 spec §4.2.
 */

import React from "react";
import { Stack } from "expo-router";

import { CartProvider } from "../../../src/components/checkout/CartContext";

export default function CheckoutLayout(): React.ReactElement {
  return (
    <CartProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          // iOS: native swipe-back enabled by default. Confirmation
          // screen (J-C5) blocks it explicitly via usePreventRemove
          // in Cycle 8b. J-C1 / J-C2 / J-C3 keep default behaviour.
        }}
      />
    </CartProvider>
  );
}
