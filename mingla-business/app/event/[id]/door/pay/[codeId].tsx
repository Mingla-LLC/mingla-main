/**
 * /event/[id]/door/pay/[codeId] — "Scan to pay" (issue #4271, design H3–H6).
 * The screen (DoorPayCodeScreen.tsx) loads with the door sale screens chunk, on
 * intent, so its status pill and door tones stay out of the eager web __common.
 *
 * I-21: operator-side route (useAuth via the screen's hooks).
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — the screen component applies useSafeAreaInsets (paddingTop: insets.top).
import React from "react";

import { LazyDoorPayCodeScreen } from "../../../../../src/components/door/LazyDoorSaleScreens";

export default function DoorPayCodeRoute(): React.ReactElement {
  return <LazyDoorPayCodeScreen />;
}
