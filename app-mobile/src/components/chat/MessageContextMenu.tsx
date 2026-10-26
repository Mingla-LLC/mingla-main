import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Clipboard,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { BaseBottomSheet } from '../ui/BaseBottomSheet';
import { Icon } from '../ui/Icon';
import * as Haptics from 'expo-haptics';
import { chatTokens } from '../../constants/chatTokens';
import { messageActions, type MessageActionId } from '../../utils/threadModel';

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
  /** Issue #4114 Wave 3: Copy only for text (never on card bubbles). */
  messageType?: string;
  /** Issue #4114 Wave 3: the message reached the server (unsend needs a real id). */
  isSent?: boolean;
  existingReactions?: string[];
  onReaction: (messageId: string, emoji: string) => void;
  onReply: (messageId: string) => void;
  onCopy: (content: string) => void;
  onEdit?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  /** Issue #4114 Wave 3: report someone else's message. */
  onReport?: (messageId: string) => void;
}

const ICONS: Record<MessageActionId, string> = {
  reply: 'arrow-undo-outline',
  copy: 'copy-outline',
  unsend: 'trash-outline',
  report: 'flag-outline',
};

export function MessageContextMenu({
  visible,
  onClose,
  position,
  messageId,
  messageContent,
  isOwnMessage,
  messageType = 'text',
  isSent = true,
  existingReactions = [],
  onReaction,
  onReply,
  onCopy,
  onDelete,
  onReport,
}: MessageContextMenuProps): React.ReactElement {
  const { t } = useTranslation(['chat']);
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

  // Issue #4114 Wave 3: labelled 44pt actions (they were 28pt icon-only dots).
  // Edit is not offered: messages have no edited marker, so an edit would
  // change the text with no sign it was changed.
  const actionIds = messageActions({
    isOwnMessage,
    type: messageType,
    isSent,
    canUnsend: Boolean(onDelete),
    canReport: Boolean(onReport),
  });
  const run = (id: MessageActionId): void => {
    switch (id) {
      case 'reply':
        act(() => onReply(messageId));
        return;
      case 'copy':
        act(() => {
          try {
            Clipboard.setString(messageContent);
            onCopy(messageContent);
          } catch (e) {
            console.error('[MessageContextMenu] copy failed', e);
          }
        });
        return;
      case 'unsend':
        act(() => onDelete?.(messageId));
        return;
      case 'report':
        act(() => onReport?.(messageId));
        return;
      default: {
        const never: never = id;
        return never;
      }
    }
  };
  const labelFor = (id: MessageActionId): string =>
    id === 'reply' ? t('chat:actionReply')
      : id === 'copy' ? t('chat:actionCopy')
        : id === 'unsend' ? t('chat:actionUnsend')
          : t('chat:actionReport');

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS as unknown as string[]}
      wrapInRNModal
      theme="dark"
      scrollMode="view"
      accessibilityLabel={t('chat:a11yMessageActions')}
    >
      <View style={styles.menu}>
        {/* Emoji row — Issue #4114 Wave 3: wired to the real reaction toggle. */}
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
              accessibilityRole="button"
              accessibilityLabel={t('chat:a11yReactWith', { emoji })}
              accessibilityState={{ selected: existingReactions.includes(emoji) }}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.actionRow}>
          {actionIds.map((id) => {
            const danger = id === 'unsend' || id === 'report';
            return (
              <TouchableOpacity
                key={id}
                style={styles.actionBtn}
                onPress={() => run(id)}
                accessibilityRole="button"
                accessibilityLabel={labelFor(id)}
                testID={`message-action-${id}`}
              >
                <Icon name={ICONS[id]} size={18} color={danger ? chatTokens.danger : chatTokens.textSecondary} />
                <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]} numberOfLines={1}>
                  {labelFor(id)}
                </Text>
              </TouchableOpacity>
            );
          })}
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
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  emojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiBtnUsed: {
    backgroundColor: chatTokens.accentSoft,
  },
  emojiText: {
    fontSize: 22,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
  },
  actionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: chatTokens.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: chatTokens.textPrimary,
  },
  actionLabelDanger: {
    color: chatTokens.danger,
  },
});
