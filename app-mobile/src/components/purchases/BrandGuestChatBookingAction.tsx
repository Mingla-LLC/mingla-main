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

  const openChat = useCallback((conversationId: string) => {
    onOpened?.();
    router.replace({ pathname: "/", params: { tab: "messages", conversationId } });
  }, [onOpened, router]);

  const rejoin = useCallback(async () => {
    setRejoining(true);
    const result = await messagingService.rejoinBrandGuestChat(brandId);
    setRejoining(false);
    if (result.error || !result.conversationId) {
      toastManager.show(t("chat:brandGuestsRejoinFailed"), "error");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: chatKeys.brandGuestStatus(brandId) });
    void queryClient.invalidateQueries({ queryKey: chatListKeys.all });
    openChat(result.conversationId);
  }, [brandId, openChat, queryClient, t]);

  if (action === null) return null;
  const label = action === "open"
    ? t("chat:brandGuestsOpenChat")
    : action === "rejoin"
      ? t("chat:brandGuestsRejoin")
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
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Icon name={action === "message" ? "chatbubble-outline" : "chatbubbles-outline"} size={18} color="#FFFFFF" />
        )}
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </Pressable>
      {message.overlays}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  pressed: { opacity: 0.7 },
  label: { flex: 1, color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
