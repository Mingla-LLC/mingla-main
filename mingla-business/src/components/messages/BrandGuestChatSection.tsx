/**
 * #4459 — Messages → Guests: one row per brand Guest chat the signed-in person
 * runs, above "Your Brand groups". Told apart from the team-only Brand group
 * by its name ("<Brand> Guests"), the orange guests badge on the tile and the
 * Guests tag (design v2).
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { color, space } from "../../constants/designSystem";
import type { BrandGuestChatSummary } from "../../services/brandGuestChatList";
import { Icon } from "../ui/Icon";
import { BrandGroupTile } from "./BrandGroupTile";

const TILE = 48;

export function BrandGuestChatRow({
  chat,
  selected,
  onPress,
}: {
  chat: BrandGuestChatSummary;
  selected?: boolean;
  onPress: () => void;
}): React.ReactElement {
  const name = `${chat.brand_name} Guests`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, Guest chat, ${chat.member_count} members${chat.is_broadcast_only ? ", announcements only" : ""}`}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, selected && styles.rowSelected]}
      testID={`brand-guest-chat-row-${chat.conversation_id}`}
    >
      <View>
        <BrandGroupTile name={chat.brand_name} photoUrl={chat.brand_logo_url} seed={chat.brand_id} size={TILE} />
        <View style={styles.guestsBadge} testID="brand-guest-chat-badge">
          <Icon name="users" size={11} color={color.onAccent} />
        </View>
      </View>
      <View style={styles.copy}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.tag}><Text style={styles.tagText}>Guests</Text></View>
          {chat.is_broadcast_only ? <Icon name="megaphone" size={14} color={brandGroupChat.textMuted} /> : null}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {chat.member_count} {chat.member_count === 1 ? "member" : "members"} · posts as {chat.brand_name}
        </Text>
      </View>
    </Pressable>
  );
}

export function BrandGuestChatSection({
  chats,
  loading,
  error,
  onRetry,
  selectedConversationId,
  onOpen,
}: {
  chats: readonly BrandGuestChatSummary[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedConversationId?: string | null;
  onOpen: (chat: BrandGuestChatSummary) => void;
}): React.ReactElement | null {
  if (!loading && !error && chats.length === 0) return null;
  return (
    <View style={styles.section} testID="brand-guest-chat-section">
      <Text style={styles.heading} accessibilityRole="header">Guests</Text>
      {loading && chats.length === 0 ? (
        <ActivityIndicator color={brandGroupChat.accent} />
      ) : error ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading Guest chats" onPress={onRetry} style={styles.error}>
          <Text style={styles.errorText}>{error} Tap to try again.</Text>
        </Pressable>
      ) : (
        chats.map((chat) => (
          <BrandGuestChatRow
            key={chat.conversation_id}
            chat={chat}
            selected={selectedConversationId === chat.conversation_id}
            onPress={() => onOpen(chat)}
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 2 },
  heading: {
    marginHorizontal: space[4],
    marginTop: space[2],
    color: brandGroupChat.textSoft,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  row: {
    minHeight: brandGroupChat.inboxRowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: space[4],
  },
  rowPressed: { backgroundColor: brandGroupChat.strip },
  rowSelected: { backgroundColor: brandGroupChat.accentSoft },
  guestsBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: brandGroupChat.accent,
    borderWidth: 2,
    borderColor: brandGroupChat.screenBg,
  },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flexShrink: 1, color: brandGroupChat.textPrimary, fontSize: 16, fontWeight: "600" },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: brandGroupChat.accentSoft },
  tagText: { color: color.accentText, fontSize: 11, fontWeight: "700" },
  sub: { color: brandGroupChat.textSoft, fontSize: 13 },
  error: { marginHorizontal: space[4], paddingVertical: space[2] },
  errorText: { color: brandGroupChat.textSecondary, fontSize: 13 },
});
