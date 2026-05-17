/**
 * ORCH-0821 — Ari Settings route.
 * Reached via the gear icon in the Ari tab header.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — AriSettingsScreen.tsx:27 calls useSafeAreaInsets internally; route is a thin render wrapper
import React from "react";
import { AriSettingsScreen } from "../../src/screens/ari/AriSettingsScreen";

export default function AriSettingsRoute(): React.ReactElement {
  return <AriSettingsScreen />;
}
