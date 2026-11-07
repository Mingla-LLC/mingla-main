/**
 * /event/[id]/door/tap/[saleId] — #4271 Tap to Pay door sale (design T2, T3, H4).
 * saleId "new" + ?draft=<base64 json {lines, eventDateId, buyerPhone?}> starts a sale.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — the screen component applies useSafeAreaInsets (paddingTop: insets.top).
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyTapToPaySaleScreen } from "../../../../../src/components/door/LazyDoorSaleScreens";

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

export default function DoorTapSaleRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    id?: string | string[];
    saleId?: string | string[];
    draft?: string | string[];
  }>();
  return (
    <LazyTapToPaySaleScreen
      eventId={first(params.id) ?? ""}
      saleId={first(params.saleId) ?? ""}
      rawDraft={first(params.draft)}
    />
  );
}
