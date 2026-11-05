/**
 * #4271 — Tap to Pay route group (setup + sale). Stripe Terminal lives in the
 * root host (TapToPayTerminalHost); this layout only says which event and brand
 * the session serves while these screens are open, so the reader stays connected
 * from setup into the sale.
 */
import React, { useEffect } from "react";
import { Stack, useLocalSearchParams } from "expo-router";

import { useManagedEventRoute } from "../../../../../src/hooks/useManagedEventRoute";
import { setTapToPayScope } from "../../../../../src/services/terminal/tapToPaySession";

export default function DoorTapLayout(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const eventId = Array.isArray(params.id) ? (params.id[0] ?? null) : (params.id ?? null);
  const route = useManagedEventRoute(eventId);
  const brandId = route.brand?.id ?? route.event?.brandId ?? null;
  const merchantDisplayName = route.brand?.displayName ?? null;
  useEffect(() => {
    setTapToPayScope({ brandId, eventId, merchantDisplayName });
    return () => setTapToPayScope(null);
  }, [brandId, eventId, merchantDisplayName]);
  return <Stack screenOptions={{ headerShown: false }} />;
}
