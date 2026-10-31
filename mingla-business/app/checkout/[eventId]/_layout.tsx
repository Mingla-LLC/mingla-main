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
import { Stack, useLocalSearchParams } from "expo-router";

// Lazy so CartContext (and byDate cart growth) stays off the eager __common
// chunk; checkout layouts already Suspense TicketQuoteController the same way.
const CartProvider = React.lazy(() =>
  import("../../../src/components/checkout/CartContext").then((module) => ({
    default: module.CartProvider,
  })),
);

const TicketQuoteController = React.lazy(() =>
  import("../../../src/components/checkout/TicketQuoteController").then(
    (module) => ({ default: module.TicketQuoteController }),
  ),
);

const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const CheckoutStack = (): React.ReactElement => {
  const params = useLocalSearchParams<{
    eventId?: string | string[];
    ticketLink?: string | string[];
  }>();
  return (
    <React.Suspense fallback={null}>
      <TicketQuoteController
        eventId={firstParam(params.eventId)}
        ticketLinkToken={firstParam(params.ticketLink) || null}
      />
      <Stack screenOptions={{ headerShown: false }} />
    </React.Suspense>
  );
};

export default function CheckoutLayout(): React.ReactElement {
  return (
    <React.Suspense fallback={null}>
      <CartProvider>
        <CheckoutStack />
      </CartProvider>
    </React.Suspense>
  );
}
