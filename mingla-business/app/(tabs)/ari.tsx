/**
 * ORCH-0821 — Ari tab route.
 * Renders the main chat screen.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — AriChatScreen handles SafeArea internally via useSafeAreaInsets + paddingTop: insets.top at AriChatScreen.tsx:130. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 16-ari-tab.png).

import React from "react";
import { useLocalSearchParams } from "expo-router";
import { AriChatScreen } from "../../src/screens/ari/AriChatScreen";
import { AriRenditionGalleryScreen } from "../../src/screens/ari/AriRenditionGalleryScreen";

export default function AriTab(): React.ReactElement {
  const params = useLocalSearchParams<{
    renditions?: string | string[];
  }>();
  const renditionMode = Array.isArray(params.renditions)
    ? params.renditions[0]
    : params.renditions;

  // #3355 — keep the local QA catalog inside Ari's sole route consumer. A
  // second route importing the thread graph makes Metro hoist it into the
  // eager public boot chunk (see the identical #2830 redirect contract).
  if (__DEV__ && renditionMode === "gallery") {
    return <AriRenditionGalleryScreen />;
  }
  return <AriChatScreen />;
}
