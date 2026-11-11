// orch-strict-grep-allow safearea-on-fullscreen-routes — the Mingla team screen it loads renders its own SafeScreen.
import React from "react";
import { StyleSheet, View } from "react-native";

import { createRetryableLazyErrorBoundary } from "../../src/components/ui/RetryableLazyBoundary";
import { canvas } from "../../src/constants/designSystem";

/**
 * #4255 W5 — Mingla team (staff only; not a bottom tab: staff is not a brand
 * role, the same reason as support/inbox.tsx). Every team route loads one
 * shared lazy module, so none of team chat joins the bundle every Host app
 * screen loads. A host who is not staff sees "This space is for the Mingla
 * team" there.
 */
const LazyTeamThreadScreen = createRetryableLazyErrorBoundary<Record<string, never>>(
  async () => ({ default: (await import("../../src/components/minglaTeam/TeamScreens")).TeamThreadScreen }),
  { loadingLabel: "Loading the chat", style: { flex: 1 } },
);

export default function TeamRoute(): React.ReactElement {
  return (
    <View style={styles.screen} testID="team-thread-route">
      <LazyTeamThreadScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.discover },
});
