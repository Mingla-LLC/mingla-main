// orch-strict-grep-allow safearea-on-fullscreen-routes — renders the event scanner route, which applies useSafeAreaInsets to every render state
// Issue #1447 — RSVP events reuse the existing event-scoped scanner manager.
// event_scanners is offering-type agnostic and the route reads the same [id].
//
// #4304 — loaded with import() of the event route's own module, so on web
// both URLs share that route's lazy chunk. A static re-export put the whole
// scanner manager in two route chunks, and Metro hoisted it into the eager
// __common boot chunk (bundle-baseline-movement).
import React from "react";
import { StyleSheet, View } from "react-native";

import { createRetryableLazyErrorBoundary } from "../../../../src/components/ui/RetryableLazyBoundary";
import { canvas } from "../../../../src/constants/designSystem";

const LazyEventScannersRoute = createRetryableLazyErrorBoundary<Record<string, never>>(
  async () => ({ default: (await import("../../../event/[id]/scanners/index")).default }),
  { loadingLabel: "Loading scanners", style: { flex: 1 } },
);

export default function RsvpScannersRoute(): React.ReactElement {
  return (
    <View style={styles.screen}>
      <LazyEventScannersRoute />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.discover },
});
