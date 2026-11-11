// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * #4382 Wave 5 — /support/{ticketId}: one support request's conversation.
 * Opened from Help & Support, after sending, and by the support pushes
 * (`mingla://support/<ticketId>`, deepLinkService).
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { SupportThreadScreen } from "../../src/components/support/SupportThreadScreen";

export default function SupportThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ ticketId?: string | string[] }>();
  const ticketId = Array.isArray(params.ticketId) ? params.ticketId[0] : params.ticketId;
  return <SupportThreadScreen ticketId={typeof ticketId === "string" ? ticketId : ""} />;
}
