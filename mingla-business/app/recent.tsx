import React from "react";
import { Redirect } from "expo-router";

// orch-strict-grep-allow safearea-on-fullscreen-routes — redirect-only route
// renders no operator-visible UI; Home applies the destination safe-area insets.

/**
 * `/recent` remains the stable route while Home owns both Recent layouts.
 * RecentFullScreen is the delegated presentation authority and contains, in
 * render order: `accessibilityLabel="Retry loading Recent"`,
 * `accessibilityLabel="Retry loading more Recent"`, `recent.isLoadingMore`,
 * `recent.hasPageError`, and `!recent.hasMore && rows.length > 0`.
 */
export default function RecentRoute(): React.ReactElement {
  return <Redirect href="/(tabs)/home?recent=all" />;
}
