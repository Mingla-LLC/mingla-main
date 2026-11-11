// orch-strict-grep-allow safearea-on-fullscreen-routes — the Mingla team screen it loads renders its own SafeScreen.
import React from "react";
import { StyleSheet, View } from "react-native";

import { createRetryableLazyErrorBoundary } from "../../src/components/ui/RetryableLazyBoundary";
import { canvas } from "../../src/constants/designSystem";

/**
 * #4255 W5 — Mingla team: the chat list and Mentions, a chat (?thread=<id>)
 * and new chats (?compose=…), all on this one route (staff only; not a bottom tab: staff is not a brand
 * role, the same reason as support/inbox.tsx). Every team route loads the
 * Brand group route's lazy chunk (app/messages/[conversationId].tsx re-exports
 * the team screens), so none of team chat joins the bundle every Host app
 * screen loads, and nothing it shares with Brand groups is hoisted there. A host who is not staff sees "This space is for the Mingla
 * team" there.
 */
const LazyTeamScreen = createRetryableLazyErrorBoundary<Record<string, never>>(
  async () => ({ default: (await import("../messages/[conversationId]")).TeamScreen }),
  { loadingLabel: "Loading Mingla team", style: { flex: 1 } },
);

export default function TeamRoute(): React.ReactElement {
  return (
    <View style={styles.screen} testID="team-route">
      <LazyTeamScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.discover },
});
