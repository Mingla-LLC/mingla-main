/**
 * /event/[id]/door/sell — #4389 Door mode: the door sale as one full-screen
 * route (design "DM"). Opened from Event › Door "Sell at door", Home's Take a
 * payment and Ari's start_door_sale, always through openDoorSale
 * (src/utils/openDoorSale.ts). The screen loads with the door sale screens
 * chunk, on intent, so the Tap to Pay and pay code code stays out of the eager
 * web __common chunk.
 *
 * Params: ?pick=1 asks "Which event?" first; ?draft=<base64 json {lines}>
 * prefills tickets; ?method=cash|pay_code starts on that method; ?source= for
 * door_mode_opened.
 *
 * I-21: operator-side route (useAuth via the screen's hooks).
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — the screen component applies useSafeAreaInsets (paddingTop: insets.top).
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyDoorModeScreen } from "../../../../src/components/door/LazyDoorSaleScreens";

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

export default function DoorModeRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    id?: string | string[];
    pick?: string | string[];
    draft?: string | string[];
    method?: string | string[];
    source?: string | string[];
  }>();
  return (
    <LazyDoorModeScreen
      eventId={first(params.id) ?? ""}
      pick={first(params.pick) === "1"}
      rawDraft={first(params.draft)}
      methodParam={first(params.method)}
      source={first(params.source)}
    />
  );
}
