/**
 * ORCH-0821 — Ari tab route.
 * Renders the main chat screen.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — AriChatScreen handles SafeArea internally via useSafeAreaInsets + paddingTop: insets.top at AriChatScreen.tsx:130. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 16-ari-tab.png).

import React from "react";
import { AriChatScreen } from "../../src/screens/ari/AriChatScreen";

export default function AriTab(): React.ReactElement {
  return <AriChatScreen />;
}
