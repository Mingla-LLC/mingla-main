/**
 * #4271 — Tap to Pay route group (setup + sale).
 *
 * Stripe Terminal is mounted HERE and nowhere else, so the SDK only starts when
 * a host opens Tap to Pay at the door. Both screens share one Terminal session,
 * so the reader stays connected from setup into the sale.
 */
import React from "react";
import { Stack, useLocalSearchParams } from "expo-router";

import { TapToPayTerminalBoundary } from "../../../../../src/components/door/tap/TapToPayTerminalBoundary";
import { useManagedEventRoute } from "../../../../../src/hooks/useManagedEventRoute";

export default function DoorTapLayout(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const eventId = Array.isArray(params.id) ? (params.id[0] ?? null) : (params.id ?? null);
  const route = useManagedEventRoute(eventId);
  const brandId = route.brand?.id ?? route.event?.brandId ?? null;
  const merchantDisplayName = route.brand?.displayName ?? "Mingla Host";
  return (
    <TapToPayTerminalBoundary
      eventId={eventId}
      brandId={brandId}
      merchantDisplayName={merchantDisplayName}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </TapToPayTerminalBoundary>
  );
}
