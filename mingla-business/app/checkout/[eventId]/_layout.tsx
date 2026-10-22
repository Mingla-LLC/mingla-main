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

import { CartProvider } from "../../../src/components/checkout/CartContext";
import { TicketQuoteController } from "../../../src/components/checkout/TicketQuoteController";

const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const CheckoutStack = (): React.ReactElement => {
  const params = useLocalSearchParams<{
    eventId?: string | string[];
    ticketLink?: string | string[];
  }>();
  return (
    <>
      <TicketQuoteController
        eventId={firstParam(params.eventId)}
        ticketLinkToken={firstParam(params.ticketLink) || null}
      />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
};

export default function CheckoutLayout(): React.ReactElement {
  return (
    <CartProvider>
      <CheckoutStack />
    </CartProvider>
  );
}
