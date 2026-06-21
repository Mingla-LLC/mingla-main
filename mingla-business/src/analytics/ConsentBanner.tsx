/**
 * ConsentBanner.tsx — NATIVE no-op stub.
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (buyer web).
 *
 * Metro resolves the sibling `ConsentBanner.web.tsx` on web and THIS file on
 * native, so native NEVER renders a web-style cookie banner. Native consent
 * (ATT + an in-app Settings opt-out) is handled separately in LEG 3 (§4.F).
 */

import type React from "react";

export function ConsentBanner(): React.ReactElement | null {
  return null;
}
