/**
 * #4111 Wave D — one enquiry thread in the Chats list (D3), in #4114's row.
 *
 * #4114 Wave 2a geometry: a flat 72pt row, 52pt avatar, 12pt gap, 14pt side
 * padding, a hairline from the text edge. The avatar is the brand logo in a
 * rounded square with the question badge (`EnquiryBrandAvatar`), the brand
 * name carries the "Enquiry" tag (`EnquiryTag`), then "{topic} · {last
 * message}". No swipe actions: an enquiry is not a member chat (no pin,
 * archive or mute). Enquiries are never merged with the brand's other chats
 * (chatListModel's "enquiry" row kind); a tap opens app/enquiry/[enquiryId].
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { glass } from "../../constants/designSystem";
import {
  CHAT_AVATAR_SIZE,
  CHAT_ROW_GAP,
  CHAT_ROW_HEIGHT,
  CHAT_ROW_SIDE_PADDING,
  CHAT_SEPARATOR_INSET,
  formatChatListTime,
} from "../connections/chatListModel";
import { EnquiryBrandAvatar, EnquiryTag } from "./EnquiryTag";
import type { EnquiryConversation } from "./enquiryChatRows";

const tk = glass.discover.chatList;

export function EnquiryChatListRow({
  conversation,
  onPress,
  showSeparator = false,
}: {
  conversation: EnquiryConversation;
  onPress: (conversation: EnquiryConversation) => void;
  /** Draw the hairline above this row (every row but the first in a section). */
  showSeparator?: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation(["enquiry", "connections"]);
  const { enquiry } = conversation;
  const unreadCount = conversation.unread_count ?? 0;
  const unread = unreadCount > 0;
  const body = (conversation.last_message?.content ?? "").replace(/\s+/g, " ").trim();
  const preview =
    body.length === 0
      ? t("enquiry:row_preview_empty")
      : enquiry.lastMessageFromBrand
        ? body
        : t("enquiry:row_preview_you", { text: body });
  const topic = enquiry.topicLabel?.trim() ?? "";
  const subline = topic.length > 0 ? `${topic} · ${preview}` : preview;
  const timeLabel = formatChatListTime(
    conversation.last_message?.created_at ?? conversation.created_at,
    new Date(),
    i18n.language,
    t("connections:time_yesterday"),
  );
  return (
    <Pressable
      onPress={() => onPress(conversation)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={t("enquiry:row_a11y", { brand: enquiry.brandName, topic: topic || preview })}
      testID={`enquiry-row-${enquiry.enquiryId}`}
    >
      {showSeparator ? <View style={styles.separator} /> : null}
      <EnquiryBrandAvatar brandName={enquiry.brandName} logoUrl={enquiry.brandLogoUrl} size={CHAT_AVATAR_SIZE} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={[styles.name, unread ? styles.nameUnread : null]} numberOfLines={1}>
            {enquiry.brandName}
          </Text>
          <EnquiryTag testID={`enquiry-row-${enquiry.enquiryId}-tag`} />
          <Text style={[styles.time, unread ? styles.timeUnread : null]} numberOfLines={1}>
            {timeLabel}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={[styles.preview, unread ? styles.previewUnread : null]} numberOfLines={1}>
            {subline}
          </Text>
          {unread ? (
            <View style={styles.badge} testID={`enquiry-row-${enquiry.enquiryId}-unread`}>
              <Text style={styles.badgeText} allowFontScaling={false}>
                {unreadCount > 99 ? "99+" : String(unreadCount)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: CHAT_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: CHAT_ROW_GAP,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    backgroundColor: glass.discover.screenBg,
  },
  rowPressed: {
    backgroundColor: tk.rowPressed,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: CHAT_SEPARATOR_INSET,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: tk.separator,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "600",
    color: tk.ink,
  },
  nameUnread: {
    fontWeight: "700",
  },
  time: {
    marginLeft: "auto",
    flexShrink: 0,
    fontSize: 13,
    color: tk.faint,
    fontVariant: ["tabular-nums"],
  },
  timeUnread: {
    color: tk.accent,
    fontWeight: "600",
  },
  preview: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: tk.dim,
  },
  previewUnread: {
    color: tk.ink,
  },
  badge: {
    flexShrink: 0,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tk.accent,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
