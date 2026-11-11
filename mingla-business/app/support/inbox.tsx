/**
 * Support inbox route (staff console) — META-ORCH-1104 Phase 3.
 *
 * #4382: the screen (src/components/support/SupportInboxScreen.tsx) loads
 * through the lazy support chunk with the other support screens, so none of
 * the support code they share sits in the eager web `__common` chunk.
 *
 * I-21: operator-side route. NEVER imported by anon-tolerant buyer routes.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — renders SupportInboxScreen, which applies paddingTop: insets.top on its root
import React from "react";

import { LazySupportInboxScreen } from "../../src/components/support/LazySupportScreens";

export default function SupportInboxRoute(): React.ReactElement {
  return <LazySupportInboxScreen />;
}
