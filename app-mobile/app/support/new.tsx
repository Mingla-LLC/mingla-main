// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * #4382 Wave 5 — /support/new: the three-step new request (topic, words or
 * voice note, screenshots). `?from=<screen>` names the screen it came from.
 */
import React from "react";

import { SupportNewRequestScreen } from "../../src/components/support/SupportNewRequestScreen";

export default function SupportNewRequestRoute(): React.ReactElement {
  return <SupportNewRequestScreen />;
}
