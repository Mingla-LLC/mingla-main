import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Clipboard,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { BaseBottomSheet } from '../ui/BaseBottomSheet';
import { Icon } from '../ui/Icon';
import * as Haptics from 'expo-haptics';
import { chatTokens } from '../../constants/chatTokens';
import {
  messageActionGroups,
  messageActions,
  NEEDS_CONNECTION_ACTIONS,
  type MessageActionId,
} from '../../utils/threadModel';

const EMOJI_OPTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

// Issue #4456: the menu sizes to its content (a labelled action list, modelled
// on the plan card menu), up to 86% of the screen; past that it scrolls.
const SNAP_POINTS = ['86%'] as const;

interface MessageContextMenuProps {
  visible: boolean;
  onClose: () => void;
  messageId: string;
  messageContent: string;
  isOwnMessage: boolean;
  /** Issue #4114 Wave 3: Copy only for text (never on card bubbles). */
  messageType?: string;
  /** Issue #4114 Wave 3: the message reached the server. */
  isSent?: boolean;
  /** Issue #4456: a bubble that never reached the server ("Not sent"). */
  isFailed?: boolean;
  /** Issue #4456: the unsent line (Delete for me only). */
  isTombstone?: boolean;
  /** Issue #4456: a view-once photo or video (no reactions, Reply or Copy). */
  isViewOnce?: boolean;
  /** Issue #4456: I am an admin of this friend group (Remove for everyone). */
  isGroupAdmin?: boolean;
  /** Issue #4456: how many photos an album action covers (1 for a single message). */
  albumCount?: number;
  /** Issue #4456: the delete actions need a connection; offline they are dimmed and explain. */
  isOffline?: boolean;
  existingReactions?: string[];
  onReaction: (messageId: string, emoji: string) => void;
  onReply: (messageId: string) => void;
  onCopy: (content: string) => void;
  /** Issue #4456: Unsend for everyone (your own message; opens the confirm). */
  onUnsend?: (messageId: string) => void;
  /** Issue #4456: Remove for everyone (a group admin; opens the confirm). */
  onRemoveForEveryone?: (messageId: string) => void;
  /** Issue #4456: Delete for me (no confirm; Undo for 5 seconds). */
  onDeleteForMe?: (messageId: string) => void;
  /** Issue #4456: a delete action tapped while offline. */
  onNeedsConnection?: () => void;
  /** Issue #4114 Wave 3: report someone else's message. */
  onReport?: (messageId: string) => void;
}

const ICONS: Record<MessageActionId, string> = {
  reply: 'arrow-undo-outline',
  copy: 'copy-outline',
  report: 'flag-outline',
  deleteForMe: 'trash-outline',
  unsend: 'remove-circle-outline',
  removeForEveryone: 'shield-outline',
};

const DANGER: ReadonlySet<MessageActionId> = new Set<MessageActionId>(['report', 'unsend', 'removeForEveryone']);

export function MessageContextMenu({
  visible,
  onClose,
  messageId,
  messageContent,
  isOwnMessage,
  messageType = 'text',
  isSent = true,
  isFailed = false,
  isTombstone = false,
  isViewOnce = false,
  isGroupAdmin = false,
  albumCount = 1,
  isOffline = false,
  existingReactions = [],
  onReaction,
  onReply,
  onCopy,
  onUnsend,
  onRemoveForEveryone,
  onDeleteForMe,
  onNeedsConnection,
  onReport,
}: MessageContextMenuProps): React.ReactElement {
  const { t } = useTranslation(['chat']);
  const { height: windowHeight } = useWindowDimensions();
  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [visible]);

  const act = (fn: () => void): void => { fn(); onClose(); };

  // Edit is not offered: messages have no edited marker, so an edit would
  // change the text with no sign it was changed.
  const actionIds = messageActions({
    isOwnMessage,
    type: messageType,
    isSent,
    isFailed,
    isTombstone,
    isViewOnce,
    isGroupAdmin,
    canUnsend: isOwnMessage ? Boolean(onUnsend) : Boolean(onRemoveForEveryone),
    canReport: Boolean(onReport),
    canDeleteForMe: Boolean(onDeleteForMe),
  });
  const groups = messageActionGroups(actionIds);
  const showReactions = !isTombstone && !isFailed && !isViewOnce && isSent;
  const isAlbum = albumCount > 1;

  const run = (id: MessageActionId): void => {
    // A failed bubble is removed on this phone only, so it needs no connection.
    if (isOffline && NEEDS_CONNECTION_ACTIONS.has(id) && !isFailed) {
      act(() => onNeedsConnection?.());
      return;
    }
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
      case 'report':
        act(() => onReport?.(messageId));
        return;
      case 'deleteForMe':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        act(() => onDeleteForMe?.(messageId));
        return;
      case 'unsend':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        act(() => onUnsend?.(messageId));
        return;
      case 'removeForEveryone':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        act(() => onRemoveForEveryone?.(messageId));
        return;
      default: {
        const never: never = id;
        return never;
      }
    }
  };

  const labelFor = (id: MessageActionId): string => {
    switch (id) {
      case 'reply': return t('chat:actionReply');
      case 'copy': return t('chat:actionCopy');
      case 'report': return t('chat:actionReport');
      case 'deleteForMe': return isAlbum ? t('chat:actionDeleteForMeAlbum', { count: albumCount }) : t('chat:actionDeleteForMe');
      case 'unsend': return isAlbum ? t('chat:actionUnsendAlbum', { count: albumCount }) : t('chat:actionUnsend');
      case 'removeForEveryone': return t('chat:actionRemoveForEveryone');
      default: {
        const never: never = id;
        return never;
      }
    }
  };

  const captionFor = (id: MessageActionId): string | null => {
    const dimmed = isOffline && NEEDS_CONNECTION_ACTIONS.has(id) && !isFailed;
    if (dimmed) return t('chat:actionNeedsConnection');
    if (id === 'deleteForMe') return isFailed ? t('chat:actionNeverSentCaption') : t('chat:actionDeleteForMeCaption');
    if (id === 'unsend') return t('chat:actionUnsendCaption');
    if (id === 'removeForEveryone') return t('chat:actionRemoveCaption');
    return null;
  };

  const hintFor = (id: MessageActionId): string | undefined => {
    if (id === 'deleteForMe') return t('chat:a11yDeleteForMeHint');
    if (id === 'unsend') return t('chat:a11yUnsendHint');
    if (id === 'removeForEveryone') return t('chat:a11yRemoveHint');
    return undefined;
  };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS as unknown as string[]}
      enableDynamicSizing
      maxDynamicContentSize={Math.round(windowHeight * 0.86)}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      accessibilityLabel={t('chat:a11yMessageActions')}
    >
      <View style={styles.menu} testID="message-context-menu">
        {showReactions ? (
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
        ) : null}

        {groups.map((group, groupIndex) => (
          <View
            key={group.join('-')}
            style={[styles.group, groupIndex === 0 ? styles.groupFirst : styles.groupNext]}
          >
            {group.map((id, rowIndex) => {
              const danger = DANGER.has(id);
              const dimmed = isOffline && NEEDS_CONNECTION_ACTIONS.has(id) && !isFailed;
              const caption = captionFor(id);
              const label = labelFor(id);
              return (
                <React.Fragment key={id}>
                  {rowIndex > 0 ? <View style={styles.hairline} /> : null}
                  <TouchableOpacity
                    style={[styles.row, dimmed && styles.rowDimmed]}
                    onPress={() => run(id)}
                    activeOpacity={Platform.OS === 'ios' ? 0.6 : 0.8}
                    accessibilityRole="button"
                    accessibilityLabel={dimmed ? `${label}, ${t('chat:actionNeedsConnection')}` : label}
                    accessibilityHint={hintFor(id)}
                    testID={`message-action-${id}`}
                  >
                    <Icon name={ICONS[id]} size={20} color={danger ? chatTokens.danger : chatTokens.textPrimary} />
                    <View style={styles.rowText}>
                      <Text style={[styles.label, danger && styles.labelDanger]}>{label}</Text>
                      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>
        ))}
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  menu: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16,
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
  group: {
    borderRadius: 16,
    backgroundColor: chatTokens.surfaceRaised,
    overflow: 'hidden',
  },
  groupFirst: {
    marginTop: 12,
  },
  groupNext: {
    marginTop: 8,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  rowDimmed: {
    opacity: 0.45,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: chatTokens.hairline,
    marginLeft: 50,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: chatTokens.textPrimary,
  },
  labelDanger: {
    color: chatTokens.danger,
  },
  caption: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: chatTokens.textSoft,
  },
});
