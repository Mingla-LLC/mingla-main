// orch-strict-grep-allow safearea-on-fullscreen-routes — renders GroupChatPanel (via LazyGroupChatPanel), which wraps in SafeScreen
// #4459 — the brand's one Guest chat, opened from Messages → Guests.
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyGroupChatPanel } from "../../../src/components/groupChat/LazyGroupChatPanel";

export default function BrandGuestChatRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return <LazyGroupChatPanel brandId={id} />;
}
