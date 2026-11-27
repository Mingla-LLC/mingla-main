/**
 * #4459 design v2 — the booking card's Guest chat action: Open guest chat,
 * Rejoin guest chat (after a sticky leave), or Message <Brand> when the brand
 * removed you. Reads issue_4459_my_brand_guest_status; nothing shows while
 * there is nothing to do.
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { chatKeys, chatListKeys } from "../../hooks/queryKeys";
import { messagingService } from "../../services/messagingService";
import { useMessageBrandFromGuestChat } from "../brandEnquiry/useMessageBrandFromGuestChat";
import { brandGuestBookingAction } from "../chat/brandGuestBooking";
import { announceBrandGuestRejoin } from "../chat/brandGuestRejoin";
import { openShellDestination } from "../../services/deepLinkService";
import { Icon } from "../ui/Icon";
import { toastManager } from "../ui/Toast";

export function BrandGuestChatBookingAction({
  brandId,
  brandSlug,
  brandName,
  onOpened,
}: {
  brandId: string;
  brandSlug: string | null;
  brandName: string;
  onOpened?: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation(["chat", "enquiry"]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: chatKeys.brandGuestStatus(brandId),
    queryFn: async () => {
      const result = await messagingService.getMyBrandGuestStatus(brandId);
      if (result.error) throw new Error(result.error);
      return result.status;
    },
    staleTime: 30_000,
  });
  const [rejoining, setRejoining] = useState(false);
  const message = useMessageBrandFromGuestChat({ brandId, brandSlug, brandName });
  const action = brandGuestBookingAction(status.data);

  // #4459 (QA D1-b): go back to the EXISTING home shell and open the chat
  // there. Replacing onto "/" mounted a second home screen (two Chats pages,
  // two live channels). Only with no shell mounted (opened cold from a link)
  // does the route land on a new root.
  const openChat = useCallback((conversationId: string) => {
    onOpened?.();
    if (openShellDestination({ kind: "conversation", conversationId })) return;
    router.replace({ pathname: "/", params: { tab: "messages", conversationId } });
  }, [onOpened, router]);

  const rejoin = useCallback(async () => {
    setRejoining(true);
    const result = await messagingService.rejoinBrandGuestChat(brandId);
    setRejoining(false);
    if (result.error || !result.conversationId) {
      toastManager.show(t("chat:brandChatRejoinFailed"), "error");
      return;
    }
    // History restarts at the rejoin (server history_visible_from): drop the
    // cached thread and refetch this chat's queries before opening it.
    announceBrandGuestRejoin(result.conversationId);
    void queryClient.invalidateQueries({ queryKey: chatKeys.brandGuestStatus(brandId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.brandGuestMembers(result.conversationId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.participants(result.conversationId) });
    void queryClient.invalidateQueries({ queryKey: chatListKeys.all });
    openChat(result.conversationId);
  }, [brandId, openChat, queryClient, t]);

  if (action === null) return null;
  const label = action === "open"
    ? t("chat:brandChatOpen", { brand: brandName })
    : action === "rejoin"
      ? t("chat:brandChatRejoin", { brand: brandName })
      : t("enquiry:message_brand", { brand: brandName });
  const busy = rejoining || (action === "message" && message.busy);
  const onPress = action === "open"
    ? () => { if (status.data?.conversationId) openChat(status.data.conversationId); }
    : action === "rejoin"
      ? () => { void rejoin(); }
      : message.messageBrand;

  return (
    <View>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID={`booking-guest-chat-${action}`}
      >
        {busy ? (
          <ActivityIndicator size="small" color={ICON_COLOR} />
        ) : (
          <Icon name={action === "message" ? "chatbubble-outline" : "chatbubbles-outline"} size={19} color={ICON_COLOR} />
        )}
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      {message.overlays}
    </View>
  );
}

// Matches the ticket screen's QuietAction rows (app/purchases/[kind]/[id].tsx):
// same inset, icon, text weight, divider and chevron.
const ICON_COLOR = "rgba(255,255,255,0.56)";
const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  pressed: { opacity: 0.68 },
  label: { flex: 1, color: "rgba(255,255,255,0.70)", fontSize: 14, fontWeight: "600" },
  chevron: { color: "rgba(255,255,255,0.28)", fontSize: 24 },
});
