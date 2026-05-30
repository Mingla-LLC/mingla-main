import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Clipboard,
} from 'react-native';
import { BaseBottomSheet } from '../ui/BaseBottomSheet';
import { Icon } from '../ui/Icon';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/designSystem';

const EMOJI_OPTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

// META-ORCH-0991 Wave B Batch 5: compact fixed snap — this is a long-press
// message action menu, so it reads as an anchored context menu (a short
// bottom action sheet), NOT a tall pan-down sheet.
const SNAP_POINTS = ['28%'] as const;

interface MessageContextMenuProps {
  visible: boolean;
  onClose: () => void;
  position: { top: number };
  messageId: string;
  messageContent: string;
  isOwnMessage: boolean;
  existingReactions?: string[];
  onReaction: (messageId: string, emoji: string) => void;
  onReply: (messageId: string) => void;
  onCopy: (content: string) => void;
  onEdit?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

export function MessageContextMenu({
  visible,
  onClose,
  position,
  messageId,
  messageContent,
  isOwnMessage,
  existingReactions = [],
  onReaction,
  onReply,
  onCopy,
  onEdit,
  onDelete,
}: MessageContextMenuProps): React.ReactElement {
  // META-ORCH-0991 Wave B Batch 5: open haptic preserved. The custom
  // scale/fade Animated springs + the `position`-anchored absolute placement
  // were dropped for stock gorhom motion (the menu now rolls up from the
  // bottom as a compact action sheet; `position` is retained on the props for
  // caller compatibility but no longer drives placement).
  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [visible]);

  void position;

  const act = (fn: () => void): void => { fn(); onClose(); };

  // Action icons
  const actions: { icon: string; color: string; onPress: () => void; label: string }[] = [
    { icon: 'arrow-undo-outline', color: colors.gray[500], onPress: () => act(() => onReply(messageId)), label: 'Reply' },
    { icon: 'copy-outline', color: colors.gray[500], onPress: () => act(() => {
      try { Clipboard.setString(messageContent); } catch (e) { console.error(e); }
      onCopy(messageContent);
    }), label: 'Copy' },
  ];
  if (isOwnMessage && onEdit) {
    actions.push({ icon: 'create-outline', color: colors.gray[500], onPress: () => act(() => onEdit(messageId)), label: 'Edit' });
  }
  if (isOwnMessage && onDelete) {
    actions.push({ icon: 'trash-outline', color: '#EF4444', onPress: () => act(() => onDelete(messageId)), label: 'Delete' });
  }

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS as unknown as string[]}
      wrapInRNModal
      scrollMode="view"
      accessibilityLabel="Message actions"
    >
      <View style={styles.menu}>
        {/* Emoji row */}
        <View style={styles.emojiRow}>
          {EMOJI_OPTIONS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onReaction(messageId, emoji);
                onClose();
              }}
              style={[styles.emojiBtn, existingReactions.includes(emoji) && styles.emojiBtnUsed]}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Action icons — small, no text, aligned left */}
        <View style={styles.actionRow}>
          {actions.map((a) => (
            <TouchableOpacity
              key={a.icon}
              style={styles.actionBtn}
              onPress={a.onPress}
              accessibilityLabel={a.label}
            >
              <Icon name={a.icon} size={16} color={a.color} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  menu: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
  },
  emojiRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  emojiBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiBtnUsed: {
    backgroundColor: '#FFF0E8',
  },
  emojiText: {
    fontSize: 20,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 6,
    paddingTop: 8,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
