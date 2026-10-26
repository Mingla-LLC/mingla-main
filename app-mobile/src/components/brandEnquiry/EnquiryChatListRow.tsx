/**
 * #4111 Wave D — one enquiry thread in the Friends tab chat list (D3).
 *
 * Brand logo in a rounded square with a question badge, the brand name with
 * the "Enquiry" tag, then "{topic} · {last message}". Visually a sibling of
 * ChatListItem's rows (same glass card) but kept separate so the #4114 row
 * redesign can absorb `EnquiryTag` / `EnquiryBrandAvatar` without a merge
 * fight. Enquiries are never merged with the brand's other chats.
 */
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { EnquiryBrandAvatar, EnquiryTag } from "./EnquiryTag";
import type { EnquiryConversation } from "./enquiryChatRows";

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function EnquiryChatListRow({
  conversation,
  onPress,
}: {
  conversation: EnquiryConversation;
  onPress: (conversation: EnquiryConversation) => void;
}): React.ReactElement {
  const { t } = useTranslation("enquiry");
  const { enquiry } = conversation;
  const unread = (conversation.unread_count ?? 0) > 0;
  const body = (conversation.last_message?.content ?? "").replace(/\s+/g, " ").trim();
  const preview =
    body.length === 0
      ? t("enquiry:row_preview_empty")
      : enquiry.lastMessageFromBrand
        ? body
        : t("enquiry:row_preview_you", { text: body });
  const topic = enquiry.topicLabel?.trim() ?? "";
  const subline = topic.length > 0 ? `${topic} · ${preview}` : preview;
  return (
    <TouchableOpacity
      onPress={() => onPress(conversation)}
      activeOpacity={0.7}
      style={styles.container}
      accessibilityRole="button"
      accessibilityLabel={t("enquiry:row_a11y", { brand: enquiry.brandName, topic: topic || preview })}
      testID={`enquiry-row-${enquiry.enquiryId}`}
    >
      <View style={styles.avatarColumn}>
        <EnquiryBrandAvatar brandName={enquiry.brandName} logoUrl={enquiry.brandLogoUrl} />
      </View>
      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {enquiry.brandName}
          </Text>
          <EnquiryTag testID={`enquiry-row-${enquiry.enquiryId}-tag`} />
          <Text style={styles.time} numberOfLines={1}>
            {relativeTime(conversation.last_message?.created_at ?? conversation.created_at)}
          </Text>
        </View>
        <View style={styles.previewRow}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={2}>
            {subline}
          </Text>
          {unread ? (
            <View style={styles.unreadBadge} testID={`enquiry-row-${enquiry.enquiryId}-unread`}>
              <Text style={styles.unreadText}>
                {(conversation.unread_count ?? 0) > 99 ? "99+" : String(conversation.unread_count)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 18,
    marginHorizontal: 10,
    marginVertical: 4,
    minHeight: 100,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.085)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    overflow: "hidden",
    ...Platform.select({
      android: { backgroundColor: "rgba(255, 255, 255, 0.09)", elevation: 0 },
      default: {},
    }),
  },
  avatarColumn: {
    width: 82,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
  },
  time: {
    marginLeft: "auto",
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.36)",
    flexShrink: 0,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  preview: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: "rgba(255, 255, 255, 0.56)",
  },
  previewUnread: {
    color: "#f8fafc",
    fontWeight: "600",
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
  },
  unreadText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
});
