/**
 * Checkout-experience route group layout. META-ORCH-1059 Sub-D — mirror of
 * `app/checkout-trip/[tripEventId]/_layout.tsx`.
 *
 * Lives OUTSIDE `app/(tabs)/` so:
 *   - The bottom tab bar is suppressed automatically (and the hub-layout
 *     redirect effect can never hijack this stack — the fold-in nav-lock fix).
 *   - Anon-tolerant: never calls useAuth; buyers without a Mingla account walk
 *     through (feedback_anon_buyer_routes.md).
 *   - Native swipe-back works index → buyer → payment; confirm disables it.
 *
 * Wraps every screen in a CartProvider so the chain shares one in-memory cart.
 * NO Zustand, NO AsyncStorage — cart lifetime = single tab session.
 *
 * COMMS-0014/0016: the money path stays the shared `ticket-checkout-create`
 * edge fn (one experience ticket). No new payment UI, no parallel money fn.
 */

import React from "react";
import { Stack } from "expo-router";

import { CartProvider } from "../../../src/components/checkout/CartContext";

export default function CheckoutExperienceLayout(): React.ReactElement {
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
