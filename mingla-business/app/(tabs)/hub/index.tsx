/**
 * (tabs)/hub/index — default landing redirect.
 *
 * Without this file, Expo Router resolves `/(tabs)/hub` to one of the
 * sibling sub-routes (`events.tsx` / `experiences.tsx` / `trips.tsx`)
 * non-deterministically based on file system order. Operator observed
 * the Hub tab landing on Trips instead of Events. This explicit redirect
 * forces the Events sub-route as the canonical Hub landing per SPEC §6.5.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.5
 */

import React from "react";
import { Redirect } from "expo-router";

export default function HubIndex(): React.ReactElement {
  return <Redirect href="/(tabs)/hub/events" />;
}
