// orch-strict-grep-allow safearea-on-fullscreen-routes — the inbox screen it loads renders its own SafeScreen.
import React from "react";
import { StyleSheet, View } from "react-native";

import { createRetryableLazyErrorBoundary } from "../../src/components/ui/RetryableLazyBoundary";
import { canvas } from "../../src/constants/designSystem";

/**
 * #4304 — the inbox screen (src/components/messages/BrandGroupInboxScreen.tsx)
 * loads through the Brand-group thread route's own module. That route already
 * renders the inbox list as its desktop rail, so on web both routes share ONE
 * lazy chunk and the inbox list, tiles, thread model and chat tokens are never
 * hoisted into the eager __common boot chunk (bundle-baseline-movement). Do
 * not import any Brand-group inbox module statically here.
 */
const LazyBrandGroupInboxScreen = createRetryableLazyErrorBoundary<Record<string, never>>(
  async () => ({ default: (await import("./[conversationId]")).BrandGroupInboxScreen }),
  { loadingLabel: "Loading messages", style: { flex: 1 } },
);

export default function MessagesIndexRoute(): React.ReactElement {
  return (
    <View style={styles.screen} testID="brand-groups-messages-route">
      <LazyBrandGroupInboxScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  // Same dark canvas as the inbox (brandGroupChat.screenBg) while its chunk loads.
  screen: { flex: 1, backgroundColor: canvas.discover },
});
