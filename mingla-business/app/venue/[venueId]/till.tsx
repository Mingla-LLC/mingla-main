// orch-strict-grep-allow safearea-on-fullscreen-routes — renders TillGate → TillScreen / WhoIsSelling, which pad their roots with useSafeAreaInsets (top and bottom)
/**
 * #4490 spec 08 O1 — the Till route (`/venue/[venueId]/till`). Full screen,
 * outside the venue rail. On web this route is its own chunk (expo-router
 * async routes), so the Till never ships in the eager bundle; every caller
 * only navigates here.
 *
 * Optional params (opaque ids only, never personal data): `tab=entry`,
 * `offer`, `option`, `count`, `entry` (a guest-list name sold at the reduced
 * price, spec 07 §11 B3); `checks=1` opens on Open checks (the Orders
 * screen's "Open checks", where tabs opened before the Till also appear).
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { TillGate } from "../../../src/components/venue/till/TillGate";
import { tillPrefillFrom, tillUuid } from "../../../src/components/venue/till/tillModel";

export default function VenueTillRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  const checks = Array.isArray(params.checks) ? params.checks[0] : params.checks;
  // #4490 O5: a Till device login opens on "Who's selling?" (TillGate);
  // every other account gets the Till exactly as before.
  return <TillGate venueId={venueId} prefill={tillPrefillFrom(params)} openChecksOnStart={checks === "1"} />;
}
