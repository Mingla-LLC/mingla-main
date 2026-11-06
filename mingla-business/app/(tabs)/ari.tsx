/**
 * ORCH-0821 — Ari tab route.
 * Renders the main chat screen.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — AriChatScreen handles SafeArea internally via useSafeAreaInsets + paddingTop: insets.top at AriChatScreen.tsx:130. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 16-ari-tab.png).

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { accent, spacing, text as textTokens } from "../../src/constants/designSystem";

/*
 * #2830 — AriChatScreen loads as one on-demand chunk, used by this route and
 * Website setup. Metro resolves two inline `import()` calls of the same module
 * to one chunk, so nothing is hoisted into `__common`. A STATIC importer plus a
 * lazy one would duplicate the graph (133 KB, measured); a shared owner file
 * would itself hoist. Enforced by I-ARI-CHAT-ONE-CHUNK in
 * issue-2830-sites-foundation.mjs.
 */
const LazyAriChatScreen = React.lazy(() =>
  import("../../src/screens/ari/AriChatScreen").then((m) => ({ default: m.AriChatScreen })),
);

// #3355 — the local QA catalog. `__DEV__` folds this branch out of production
// dependencies, so its graph never reaches a shipped chunk.
const LazyAriRenditionGallery = __DEV__
  ? React.lazy(() =>
      import("../../src/screens/ari/AriRenditionGalleryScreen").then((m) => ({
        default: m.AriRenditionGalleryScreen,
      })),
    )
  : null;

export default function AriTab(): React.ReactElement {
  const params = useLocalSearchParams<{
    renditions?: string | string[];
  }>();
  const renditionMode = Array.isArray(params.renditions)
    ? params.renditions[0]
    : params.renditions;

  return (
    <React.Suspense
      fallback={
        <View
          style={styles.loading}
          accessibilityRole="progressbar"
          accessibilityLabel="Opening Ari conversation"
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator color={accent.warm} />
          <Text style={styles.loadingCopy}>Opening conversation…</Text>
        </View>
      }
    >
      {LazyAriRenditionGallery && renditionMode === "gallery" ? <LazyAriRenditionGallery /> : <LazyAriChatScreen />}
    </React.Suspense>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingCopy: { color: textTokens.secondary, fontSize: 14, lineHeight: 20, fontWeight: "500" },
});
