// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * #4382 Wave 5 — /support: Help & Support (new request + your requests).
 * Opened from Profile, from Account settings → Contact support, and by a
 * bare `mingla://support` link.
 */
import React from "react";

import { HelpSupportScreen } from "../../src/components/support/HelpSupportScreen";

export default function HelpSupportRoute(): React.ReactElement {
  return <HelpSupportScreen />;
}
