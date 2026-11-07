/**
 * #4304 part 2 — the message menu (app-mobile components/chat/
 * MessageContextMenu.tsx, ported): a row of reactions and the message's
 * actions. Opens from a long-press on phones and from right-click or the
 * hover "⋯" on web. Every action shown is wired by the thread.
 */
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import type { BrandGroupMessage } from "../../services/brandGroupsService";
import {
  BRAND_GROUP_REACTION_EMOJI,
  brandGroupClockTime,
  brandGroupDayLabel,
  type BrandGroupMenuAction,
  type BrandGroupMenuActionKey,
} from "../../utils/brandGroupThreadModel";
import { Icon, type IconName } from "../ui/Icon";

const ACTION_ICON: Record<BrandGroupMenuActionKey, IconName> = {
  reply: "reply",
  copy: "copy",
  signal: "flag",
  select: "check",
};

export function BrandGroupMessageMenu({
  message,
  actions,
  myReactions,
  onReact,
  onAction,
  onClose,
}: {
  message: BrandGroupMessage | null;
  actions: BrandGroupMenuAction[];
  myReactions: readonly string[];
  onReact: (emoji: string) => void;
  onAction: (key: BrandGroupMenuActionKey) => void;
  onClose: () => void;
}): React.ReactElement | null {
  if (!message) return null;
  const preview = message.file_name || message.content;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close message menu" style={styles.scrim} onPress={onClose}>
        {/* Claims the touch so a tap inside the card never reaches the scrim. */}
        <View style={styles.card} onStartShouldSetResponder={() => true} testID="brand-group-message-menu">
          <View style={styles.reactions} accessibilityLabel="React to this message">
            {BRAND_GROUP_REACTION_EMOJI.map((emoji) => {
              const active = myReactions.includes(emoji);
              return (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={active ? `Remove ${emoji} reaction` : `React with ${emoji}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => onReact(emoji)}
                  style={({ pressed }) => [styles.emoji, active && styles.emojiActive, pressed && styles.emojiPressed]}
                  testID={`brand-group-react-${emoji}`}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.previewBox}>
            <Text style={styles.previewMeta} numberOfLines={1}>
              {message.sender_display_name} · {brandGroupDayLabel(message.created_at)} {brandGroupClockTime(message.created_at)}
            </Text>
            <Text style={styles.previewText} numberOfLines={3}>{preview}</Text>
          </View>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              onPress={() => onAction(action.key)}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              testID={`brand-group-menu-${action.key}`}
            >
              <Icon name={ACTION_ICON[action.key]} size={18} color={brandGroupChat.textSecondary} />
              <Text style={styles.actionText}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: brandGroupChat.scrim },
  card: { width: "100%", maxWidth: 360, overflow: "hidden", borderRadius: 20, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  reactions: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  emoji: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emojiActive: { backgroundColor: brandGroupChat.accentSoft, borderWidth: 1, borderColor: brandGroupChat.accent },
  emojiPressed: { transform: [{ scale: 1.15 }] },
  emojiText: { fontSize: 24 },
  previewBox: { gap: 4, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  previewMeta: { color: brandGroupChat.textMuted, fontSize: 12 },
  previewText: { color: brandGroupChat.textSecondary, fontSize: 14, lineHeight: 19 },
  action: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  actionPressed: { backgroundColor: brandGroupChat.strip },
  actionText: { color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "600" },
});
