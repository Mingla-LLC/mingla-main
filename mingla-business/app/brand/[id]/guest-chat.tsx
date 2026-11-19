// orch-strict-grep-allow safearea-on-fullscreen-routes — renders GroupChatPanel (via LazyGroupChatPanel), which wraps in SafeScreen
// #4459 — the brand's one Guest chat. #4420 — it is now the Guests side of the
// brand's one thread: this route redirects to /messages/<Team chat>?side=guests,
// and shows the Guest chat on its own only when the brand has no Team chat the
// viewer can open (Team then says why it is missing).
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";

import { LazyGroupChatPanel } from "../../../src/components/groupChat/LazyGroupChatPanel";
import { color } from "../../../src/constants/designSystem";
import { useBrandGroups } from "../../../src/hooks/useBrandGroups";

/**
 * The brand's Team chat with Guests selected, or null. Same rule as
 * guestChatRedirectHref (src/utils/brandMessagesInbox.ts), kept inline so this
 * route's chunk never shares the Messages model with the Messages chunk (a
 * module two lazy chunks import is hoisted into the eager web __common chunk).
 */
function guestsSideHref(brandId: string, groups: readonly { brand_id: string; conversation_id: string; access_kind: string }[]): string | null {
  const group = groups.find((item) => item.brand_id === brandId && item.access_kind === "brand");
  return group ? `/messages/${group.conversation_id}?mode=brand&side=guests` : null;
}

export default function BrandGuestChatRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { groups, loading } = useBrandGroups();
  if (typeof id !== "string" || id.length === 0) return null;
  const href = guestsSideHref(id, groups);
  if (href) return <Redirect href={href as never} />;
  if (loading) {
    return (
      <View style={styles.loading} accessibilityLabel="Opening the Guests room">
        <ActivityIndicator color={color.text2} />
      </View>
    );
  }
  return <LazyGroupChatPanel brandId={id} teamUnavailableReason="This brand has no Team chat you can open yet." />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.canvas },
});
