/**
 * Issue #4114 Wave 2a — one chat in the Chats list.
 *
 * A flat 72pt row (no card chrome): 52pt avatar, 12pt gap, 14pt side padding,
 * a hairline from the text edge. Name 16/600 (700 when unread) with the time
 * right-aligned on the same line; a one-line 14pt preview (white when unread);
 * a 20pt unread badge that is orange, or grey when the chat is muted. One tag
 * slot: "Event" (or the next event's date) for event and trip chats, and
 * "Enquiry" reserved for #4111. No Pair button, no "Broadcast" label, no
 * "Collab session" pill — the avatar shape says what kind of chat it is.
 *
 * Swipe left for Mute and Archive, swipe right for Pin and Mark unread
 * (react-native-gesture-handler's Reanimated swipeable, the newer gesture API).
 * Long-press opens the same actions in a sheet owned by the page.
 */
import React, { useCallback, useMemo, useRef } from "react";
import {
  AccessibilityActionEvent,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { Conversation } from "../../hooks/useMessages";
import { getDisplayName } from "../../utils/getDisplayName";
import type { BusinessEventCard } from "../../types/mergedDiscover";
import { glass } from "../../constants/designSystem";
import { ChatAvatar } from "./ChatAvatar";
import {
  CHAT_ROW_GAP,
  CHAT_ROW_HEIGHT,
  CHAT_ROW_SIDE_PADDING,
  CHAT_SEPARATOR_INSET,
  chatKind,
  formatChatListTime,
  formatUpcomingEventTag,
  isUnreadChat,
  unreadBadge,
} from "./chatListModel";

const tk = glass.discover.chatList;
const SWIPE_ACTION_WIDTH = 72;

/**
 * ORCH-0898: extended Conversation shape with the group / event extras the
 * ConnectionsPage transform passes through. Issue #4114 adds the member's
 * private list state (pinned_at, marked_unread_at).
 */
export type ChatListItemConversation = Conversation & {
  type?: 'direct' | 'group';
  name?: string | null;
  session_id?: string | null;
  event_id?: string | null;
  linked_entity_type?: 'direct' | 'session' | 'trip' | 'event';
  eventBrandName?: string | null;
  eventBrandAccountId?: string | null;
  eventCoverMediaUrl?: string | null;
  eventPublicCard?: BusinessEventCard | null;
  is_broadcast_only?: boolean;
  isPendingCreatorCollab?: boolean;
  pinned_at?: string | null;
  marked_unread_at?: string | null;
  /** Reserved for #4111 enquiry threads: renders the Enquiry tag. */
  isEnquiry?: boolean;
};

export interface ChatListItemProps {
  conversation: ChatListItemConversation;
  currentUserId: string;
  onPress: (conversation: ChatListItemConversation) => void;
  onLongPress?: (conversation: ChatListItemConversation) => void;
  isMuted?: boolean;
  /** Direct chats only: mute / unmute the other person. */
  onToggleMute?: (conversation: ChatListItemConversation) => void;
  onArchive?: (conversationId: string) => void;
  onTogglePin?: (conversation: ChatListItemConversation) => void;
  onToggleUnread?: (conversation: ChatListItemConversation) => void;
  lifecycleBusy?: boolean;
  /** Row in the archived list: the archive action becomes Unarchive. */
  isArchived?: boolean;
  /** Draw the hairline above this row (every row but the first in a section). */
  showSeparator?: boolean;
}

function ChatListItemImpl({
  conversation,
  currentUserId,
  onPress,
  onLongPress,
  isMuted = false,
  onToggleMute,
  onArchive,
  onTogglePin,
  onToggleUnread,
  lifecycleBusy = false,
  isArchived = false,
  showSeparator = false,
}: ChatListItemProps): React.ReactElement {
  const { t, i18n } = useTranslation(['connections', 'chat', 'common']);
  const swipeRef = useRef<SwipeableMethods>(null);

  const kind = chatKind(conversation);
  const isGroup = conversation.type === 'group';
  const isEvent = kind === 'event';
  const isPinned = Boolean(conversation.pinned_at);
  const unread = isUnreadChat(conversation);
  // "Mark unread" is a private flag (it never touches read receipts). It is
  // offered when nothing is unread, and "Mark read" clears the flag. A chat
  // with real unread messages is read by opening it.
  const markedUnread = Boolean(conversation.marked_unread_at);
  const canToggleUnread = Boolean(onToggleUnread) && (markedUnread || (conversation.unread_count ?? 0) === 0);
  const badge = unreadBadge(conversation, isMuted);

  const others = conversation.participants.filter((p) => p.id !== currentUserId);
  const otherParticipant = others[0];

  const rawName = isGroup
    ? conversation.name?.trim() || t('connections:group_fallback_name')
    : getDisplayName(otherParticipant);
  const displayName = !isGroup && rawName.includes('@')
    ? rawName.substring(0, rawName.indexOf('@')).trim()
    : rawName;

  const lastMessage = conversation.last_message;
  const timeLabel = formatChatListTime(
    lastMessage?.created_at,
    new Date(),
    i18n.language,
    t('connections:time_yesterday'),
  );

  const preview = useMemo(() => {
    let text = '';
    if (lastMessage) {
      if (lastMessage.message_type === 'image') text = t('chat:photoPreview');
      else if (lastMessage.message_type === 'file') text = t('chat:filePreview');
      else if (lastMessage.message_type === 'video') text = t('chat:videoPreview');
      else text = (lastMessage.content || '').replace(/\s+/g, ' ').trim();
    }
    if (text && lastMessage) {
      if (lastMessage.sender_id && lastMessage.sender_id === currentUserId) {
        return t('connections:preview_you', { text });
      }
      if (isGroup && lastMessage.sender_name) {
        const brandName = conversation.eventBrandName?.trim();
        const fromBrand = isEvent && brandName && (
          (lastMessage as { marketing_campaign_id?: string | null }).marketing_campaign_id ||
          (conversation.eventBrandAccountId && lastMessage.sender_id === conversation.eventBrandAccountId)
        );
        return `${fromBrand ? brandName : lastMessage.sender_name}: ${text}`;
      }
      return text;
    }
    if (isEvent) return t('connections:preview_event_ready');
    if (conversation.isPendingCreatorCollab) return t('connections:preview_pending_collab');
    if (isGroup) {
      return conversation.participants.length > 1
        ? t('connections:preview_group_people', { count: conversation.participants.length })
        : t('connections:preview_collab_ready');
    }
    return t('connections:preview_start');
  }, [conversation, currentUserId, isEvent, isGroup, lastMessage, t]);

  const tagLabel = isEvent
    ? formatUpcomingEventTag(conversation.eventPublicCard?.masterDateUtc, new Date(), i18n.language)
      ?? t('connections:tag_event')
    : conversation.isEnquiry
      ? t('connections:tag_enquiry')
      : null;

  const avatarPeople = (isGroup ? others : otherParticipant ? [otherParticipant] : []).slice(0, 2).map((p) => ({
    id: p.id,
    name: getDisplayName(p),
    avatarUrl: p.avatar_url ?? null,
  }));

  const close = useCallback(() => swipeRef.current?.close(), []);

  const runAction = useCallback((action: 'pin' | 'unread' | 'mute' | 'archive') => {
    close();
    if (action === 'pin') onTogglePin?.(conversation);
    else if (action === 'unread') onToggleUnread?.(conversation);
    else if (action === 'mute') onToggleMute?.(conversation);
    else onArchive?.(conversation.id);
  }, [close, conversation, onArchive, onToggleMute, onTogglePin, onToggleUnread]);

  const renderLeftActions = useCallback(() => (
    <View style={styles.swipeActions}>
      <SwipeAction
        icon={isPinned ? 'pin-off-outline' : 'pin-outline'}
        label={isPinned ? t('connections:action_unpin') : t('connections:action_pin')}
        color={tk.swipePin}
        onPress={() => runAction('pin')}
      />
      {canToggleUnread ? (
        <SwipeAction
          icon={markedUnread ? 'mail-open-outline' : 'mail-outline'}
          label={markedUnread ? t('connections:action_mark_read') : t('connections:action_mark_unread')}
          color={tk.swipeUnread}
          onPress={() => runAction('unread')}
        />
      ) : null}
    </View>
  ), [canToggleUnread, isPinned, markedUnread, runAction, t]);

  const renderRightActions = useCallback(() => (
    <View style={styles.swipeActions}>
      {!isGroup && onToggleMute ? (
        <SwipeAction
          icon={isMuted ? 'notifications-outline' : 'volume-mute'}
          label={isMuted ? t('connections:action_unmute') : t('connections:action_mute')}
          color={tk.swipeMute}
          onPress={() => runAction('mute')}
        />
      ) : null}
      <SwipeAction
        icon="archive-outline"
        label={isArchived ? t('connections:action_unarchive') : t('connections:action_archive')}
        color={tk.swipeArchive}
        busy={lifecycleBusy}
        onPress={() => runAction('archive')}
      />
    </View>
  ), [isArchived, isGroup, isMuted, lifecycleBusy, onToggleMute, runAction, t]);

  const a11yParts = [
    displayName,
    isPinned ? t('connections:pinned_a11y') : null,
    tagLabel,
    badge.visible
      ? badge.label
        ? t('connections:unread_a11y', { count: conversation.unread_count ?? 0 })
        : t('connections:marked_unread_a11y')
      : null,
    isMuted ? t('connections:muted_a11y') : null,
    timeLabel,
    preview,
  ].filter(Boolean);

  const accessibilityActions = [
    { name: 'pin', label: isPinned ? t('connections:action_unpin') : t('connections:action_pin') },
    ...(canToggleUnread
      ? [{ name: 'unread', label: markedUnread ? t('connections:action_mark_read') : t('connections:action_mark_unread') }]
      : []),
    ...(!isGroup && onToggleMute
      ? [{ name: 'mute', label: isMuted ? t('connections:action_unmute') : t('connections:action_mute') }]
      : []),
    { name: 'archive', label: isArchived ? t('connections:action_unarchive') : t('connections:action_archive') },
    { name: 'longpress', label: t('connections:actions_more') },
  ];

  const onAccessibilityAction = (event: AccessibilityActionEvent): void => {
    const name = event.nativeEvent.actionName;
    if (name === 'longpress') onLongPress?.(conversation);
    else if (name === 'pin' || name === 'unread' || name === 'mute' || name === 'archive') runAction(name);
  };

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
    >
      <Pressable
        onPress={() => onPress(conversation)}
        onLongPress={onLongPress ? () => onLongPress(conversation) : undefined}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={a11yParts.join(', ')}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={onAccessibilityAction}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        testID={`chat-row-${conversation.id}`}
      >
        {showSeparator ? <View style={styles.separator} /> : null}
        <ChatAvatar
          people={avatarPeople}
          shape={isEvent ? 'square' : isGroup ? 'group' : 'circle'}
          label={displayName}
          coverUrl={isEvent ? conversation.eventCoverMediaUrl : null}
          deckBadge={kind === 'group' || kind === 'direct_collab'}
        />
        <View style={styles.body}>
          <View style={styles.line}>
            <Text style={[styles.name, unread ? styles.nameUnread : null]} numberOfLines={1}>
              {displayName}
            </Text>
            {tagLabel ? (
              <View style={[styles.tag, conversation.isEnquiry && !isEvent ? styles.tagEnquiry : styles.tagEvent]}>
                <Text
                  style={[styles.tagText, conversation.isEnquiry && !isEvent ? styles.tagTextEnquiry : null]}
                  numberOfLines={1}
                >
                  {tagLabel}
                </Text>
              </View>
            ) : null}
            {isPinned ? <Icon name="pin-outline" size={12} color={tk.faint} style={styles.lineIcon} /> : null}
            <Text style={[styles.time, unread && !isMuted ? styles.timeUnread : null]} numberOfLines={1}>
              {timeLabel}
            </Text>
          </View>
          <View style={styles.line}>
            <Text style={[styles.preview, unread ? styles.previewUnread : null]} numberOfLines={1}>
              {preview}
            </Text>
            {isMuted ? <Icon name="volume-mute" size={13} color={tk.faint} style={styles.lineIcon} /> : null}
            {badge.visible ? (
              <View
                style={[
                  styles.badge,
                  badge.tone === 'muted' ? styles.badgeMuted : styles.badgeAccent,
                  badge.label ? null : styles.badgeDot,
                ]}
                testID={`chat-row-badge-${badge.tone}`}
              >
                {badge.label ? <Text style={styles.badgeText} allowFontScaling={false}>{badge.label}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function SwipeAction({
  icon,
  label,
  color,
  busy = false,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  busy?: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      style={[styles.swipeAction, { backgroundColor: color }]}
    >
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name={icon} size={20} color="#FFFFFF" />}
      <Text style={styles.swipeActionText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export const ChatListItem = React.memo(ChatListItemImpl);

const styles = StyleSheet.create({
  row: {
    height: CHAT_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHAT_ROW_GAP,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    backgroundColor: glass.discover.screenBg,
  },
  rowPressed: {
    backgroundColor: tk.rowPressed,
  },
  separator: {
    position: 'absolute',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: tk.ink,
  },
  nameUnread: {
    fontWeight: '700',
  },
  lineIcon: {
    flexShrink: 0,
  },
  time: {
    marginLeft: 'auto',
    flexShrink: 0,
    fontSize: 13,
    color: tk.faint,
    fontVariant: ['tabular-nums'],
  },
  timeUnread: {
    color: tk.accent,
    fontWeight: '600',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeAccent: {
    backgroundColor: tk.accent,
  },
  badgeMuted: {
    backgroundColor: tk.badgeMutedBg,
  },
  badgeDot: {
    minWidth: 12,
    width: 12,
    height: 12,
    borderRadius: 6,
    paddingHorizontal: 0,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tag: {
    flexShrink: 0,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagEvent: {
    backgroundColor: tk.eventTagBg,
  },
  tagEnquiry: {
    backgroundColor: tk.enquiryTagBg,
  },
  tagText: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: tk.eventTagLabel,
  },
  tagTextEnquiry: {
    color: tk.dim,
  },
  swipeActions: {
    flexDirection: 'row',
    height: CHAT_ROW_HEIGHT,
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    height: CHAT_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeActionText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
