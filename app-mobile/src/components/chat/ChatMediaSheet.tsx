/**
 * Issue #4114 Wave 3: "Photos, videos and cards" for one chat — the menu row
 * the 1:1 menu and group info both open. One read of the chat's media rows
 * (messagingService.getConversationMedia), newest first. Every state is drawn:
 * loading, error with retry, empty, and the grid.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import {
  messagingService,
  isContentShareCardPayload,
  type CardPayload,
  type DirectMessage,
} from "../../services/messagingService";

const MEDIA_SHEET_SNAP = ["70%"];

interface ChatMediaSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string | null;
  onOpenImage: (url: string) => void;
  onOpenVideo: (url: string) => void;
  onOpenCard: (payload: CardPayload, messageId: string) => void;
}

function cardThumb(payload: CardPayload | undefined): { image: string | null; title: string } {
  if (!payload) return { image: null, title: "" };
  if (isContentShareCardPayload(payload)) {
    return { image: payload.image ?? null, title: payload.facts?.title ?? payload.title ?? "" };
  }
  return { image: payload.image ?? null, title: payload.title ?? "" };
}

export function ChatMediaSheet({
  visible,
  onClose,
  conversationId,
  onOpenImage,
  onOpenVideo,
  onOpenCard,
}: ChatMediaSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const [items, setItems] = useState<DirectMessage[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error" | "ready">("idle");

  const load = useCallback(async () => {
    if (!conversationId) return;
    setState("loading");
    const result = await messagingService.getConversationMedia(conversationId);
    if (result.error) {
      setState("error");
      return;
    }
    setItems(result.items);
    setState("ready");
  }, [conversationId]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={MEDIA_SHEET_SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      accessibilityLabel={t("chat:menuMedia")}
      header={<Text style={styles.title}>{t("chat:menuMedia")}</Text>}
    >
      <View style={styles.body}>
        {state === "loading" || state === "idle" ? (
          <ActivityIndicator color={chatTokens.accent} style={styles.status} />
        ) : state === "error" ? (
          <TouchableOpacity
            style={styles.status}
            onPress={() => void load()}
            accessibilityRole="button"
            accessibilityLabel={t("chat:mediaLoadFailed")}
          >
            <Text style={styles.statusText}>{t("chat:mediaLoadFailed")}</Text>
          </TouchableOpacity>
        ) : items.length === 0 ? (
          <View style={styles.status}>
            <Icon name="images-outline" size={28} color={chatTokens.textMuted} />
            <Text style={styles.statusText}>{t("chat:mediaEmpty")}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((item) => {
              const isCard = item.message_type === "card";
              const thumb = isCard ? cardThumb(item.card_payload) : { image: item.message_type === "image" ? item.file_url ?? null : null, title: "" };
              const label = isCard
                ? t("chat:a11yOpenSharedCard", { title: thumb.title })
                : item.message_type === "video"
                  ? t("chat:video")
                  : t("chat:photo");
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.tile}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={() => {
                    if (isCard && item.card_payload) {
                      onClose();
                      onOpenCard(item.card_payload, item.id);
                    } else if (item.message_type === "video" && item.file_url) {
                      onOpenVideo(item.file_url);
                    } else if (item.file_url) {
                      onOpenImage(item.file_url);
                    }
                  }}
                >
                  {thumb.image ? (
                    <Image source={{ uri: thumb.image }} style={styles.tileImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.tileImage, styles.tilePlaceholder]}>
                      <Icon
                        name={item.message_type === "video" ? "play-circle" : isCard ? "bookmark" : "image"}
                        size={22}
                        color={chatTokens.textMuted}
                      />
                    </View>
                  )}
                  {isCard && thumb.title ? (
                    <Text style={styles.tileTitle} numberOfLines={1}>
                      {thumb.title}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
    textAlign: "center",
    paddingTop: 4,
    paddingBottom: 12,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  status: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 10,
  },
  statusText: {
    color: chatTokens.textSoft,
    fontSize: 14,
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tile: {
    width: "32%",
  },
  tileImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: chatTokens.surfaceRaised,
  },
  tilePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  tileTitle: {
    marginTop: 4,
    fontSize: 11.5,
    color: chatTokens.textSecondary,
  },
});
