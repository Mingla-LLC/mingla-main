import React, { useRef, useCallback, useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
  Image,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useTranslation } from 'react-i18next';
import { Icon } from "../ui/Icon";
import { Conversation } from "../../hooks/useMessages";
import { getDisplayName } from "../../utils/getDisplayName";
import type { BusinessEventCard } from "../../types/mergedDiscover";

/**
 * ORCH-0898: extended Conversation shape with type + name + session_id so ChatListItem
 * can branch on direct vs group rendering. The base `Conversation` (from useMessages —
 * locked for ORCH-0900 scope) stays unchanged; the extra fields are optional and
 * populated by ConnectionsPage's transform layer for post-ORCH-0898 group conversations.
 * Direct conversations leave them undefined; ChatListItem renders the legacy direct path.
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
};

interface ChatListItemProps {
  conversation: ChatListItemConversation;
  currentUserId: string;
  onPress: (conversation: ChatListItemConversation) => void;
  isMuted?: boolean;
  onAvatarPress?: (userId: string) => void;
  /** ORCH-0435: Pair status for the other participant */
  pairStatus?: 'paired' | 'pending' | 'unpaired' | 'not-friend';
  /** ORCH-0435: Send pair request */
  onPairPress?: (userId: string) => void;
  /** ORCH-0435: Unpair */
  onUnpairPress?: (userId: string) => void;
  /** ORCH-0435: Loading state for pair request */
  pairLoading?: boolean;
  /** ORCH-0435: Cancel pending pair request */
  onPendingPairPress?: (userId: string) => void;
  /** ORCH-0435: Archive chat */
  onArchive?: (conversationId: string) => void;
  /** ORCH-0435: Delete chat */
  onDelete?: (conversationId: string) => void;
}

/**
 * Format a timestamp into "seen X ago" string.
 */
function formatRelativeTime(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Get the initials from a name string (max 2 characters).
 */
function getInitials(name: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

/**
 * Consistent orange avatar background for all users without profile pictures.
 */
function getAvatarColor(_seed: string): string {
  return "#eb7825";
}

function formatEventListDate(card?: BusinessEventCard | null): string | null {
  const value = card?.masterDateUtc;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatEventListCountdown(card?: BusinessEventCard | null): string | null {
  const value = card?.masterDateUtc;
  if (!value) return null;
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return null;

  const now = new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startDay.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) return "Past";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return `${diffDays}d out`;
}

export function ChatListItem({
  conversation,
  currentUserId,
  onPress,
  isMuted = false,
  onAvatarPress,
  pairStatus,
  onPairPress,
  onUnpairPress,
  pairLoading,
  onPendingPairPress,
  onArchive,
  onDelete,
}: ChatListItemProps) {
  const { t } = useTranslation(['chat', 'common']);

  // ORCH-0898: group vs direct branch. Group conversations have `type === 'group'` (passed
  // through by ConnectionsPage transform from messagingService.getConversations server-shape).
  // Direct conversations either omit `type` (legacy field) or have `type === 'direct'`.
  const isGroup = conversation.type === 'group';
  const isTripEventGroup =
    isGroup && (conversation.linked_entity_type === 'trip' || conversation.linked_entity_type === 'event');
  const isCollaborationGroup = isGroup && !isTripEventGroup;
  const isBroadcastOnly = isTripEventGroup && conversation.is_broadcast_only === true;
  const eventKind = conversation.linked_entity_type === 'trip' ? 'Trip' : 'Event';

  // For direct conversations: find the other participant; for group conversations: collect
  // up to 3 non-self participants for the multi-avatar stack.
  const otherParticipant = conversation.participants.find(
    (p) => p.id !== currentUserId,
  );
  const groupAvatarParticipants = isGroup
    ? conversation.participants.filter((p) => p.id !== currentUserId).slice(0, 3)
    : [];

  const displayName = isGroup
    ? conversation.name?.trim() || 'Collaboration chat'
    : getDisplayName(otherParticipant);

  // Clean email-like names (direct path only — group names are user-set + don't contain emails).
  const cleanedName = isGroup
    ? displayName
    : displayName.includes('@')
      ? displayName.substring(0, displayName.indexOf('@')).trim()
      : displayName;

  const lastMessage = conversation.last_message;
  const unreadCount = conversation.unread_count || 0;
  const hasUnread = unreadCount > 0 && !isMuted;
  const eventDate = formatEventListDate(conversation.eventPublicCard);
  const eventCountdown = formatEventListCountdown(conversation.eventPublicCard);
  const eventDefaultPreview = [eventCountdown, eventDate].filter(Boolean).join(" · ");
  const collaborationDefaultPreview =
    conversation.participants.length > 1
      ? `${conversation.participants.length} people planning together`
      : "Collaboration space ready";
  const directDefaultPreview = "Start the conversation";

  // Message preview
  let messagePreview = "";
  if (lastMessage) {
    if (lastMessage.message_type === "image") {
      messagePreview = t('chat:photoPreview');
    } else if (lastMessage.message_type === "file") {
      messagePreview = t('chat:filePreview');
    } else {
      const content = lastMessage.content || "";
      messagePreview =
        content.length > 40 ? content.substring(0, 40) + "..." : content;
    }
  }
  if (isGroup && messagePreview && lastMessage?.sender_name) {
    const brandName = conversation.eventBrandName?.trim();
    const brandSenderName =
      isTripEventGroup &&
      brandName &&
      (
        (lastMessage as any).marketing_campaign_id ||
        (conversation.eventBrandAccountId && lastMessage.sender_id === conversation.eventBrandAccountId)
      )
        ? brandName
        : null;
    messagePreview = `${brandSenderName ?? lastMessage.sender_name}: ${messagePreview}`;
  }
  const fallbackPreview = isTripEventGroup
    ? eventDefaultPreview || (isBroadcastOnly ? `${conversation.eventBrandName?.trim() || 'Organiser'} updates only` : `${eventKind} broadcast ready`)
    : isCollaborationGroup
      ? collaborationDefaultPreview
      : directDefaultPreview;

  const rowMetaLabel = isTripEventGroup
    ? "Broadcast"
    : isCollaborationGroup
      ? "Collab session"
      : null;

  // Timestamp
  const timestamp = lastMessage?.created_at
    ? formatRelativeTime(lastMessage.created_at)
    : "";

  const swipeableRef = useRef<Swipeable>(null);
  const [isSwipeInteracting, setIsSwipeInteracting] = useState(false);

  const hideTrailingChromeForSwipe = useCallback(() => {
    setIsSwipeInteracting(true);
  }, []);

  const restoreTrailingChromeAfterSwipe = useCallback(() => {
    setIsSwipeInteracting(false);
  }, []);

  const renderRightActions = useCallback(
    (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
      const translateArchive = dragX.interpolate({
        inputRange: [-160, -80, 0],
        outputRange: [0, 0, 80],
        extrapolate: 'clamp',
      });
      const translateDelete = dragX.interpolate({
        inputRange: [-160, -80, 0],
        outputRange: [0, 0, 160],
        extrapolate: 'clamp',
      });
      return (
        <View style={styles.swipeActions}>
          <Animated.View style={{ transform: [{ translateX: translateArchive }] }}>
            <TouchableOpacity
              style={styles.swipeArchive}
              onPress={() => {
                swipeableRef.current?.close();
                onArchive?.(conversation.id);
              }}
            >
              <Icon name="archive-outline" size={20} color="#ffffff" />
              <Text style={styles.swipeActionText}>Archive</Text>
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={{ transform: [{ translateX: translateDelete }] }}>
            <TouchableOpacity
              style={styles.swipeDelete}
              onPress={() => {
                swipeableRef.current?.close();
                onDelete?.(conversation.id);
              }}
            >
              <Icon name="trash-outline" size={20} color="#ffffff" />
              <Text style={styles.swipeActionText}>Delete</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      );
    },
    [conversation.id, onArchive, onDelete],
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
      onSwipeableOpenStartDrag={hideTrailingChromeForSwipe}
      onSwipeableWillOpen={hideTrailingChromeForSwipe}
      onSwipeableClose={restoreTrailingChromeAfterSwipe}
    >
      <TouchableOpacity
        onPress={() => onPress(conversation)}
        style={[
          styles.container,
          isTripEventGroup && styles.eventContainer,
          isCollaborationGroup && styles.collaborationContainer,
          !isGroup && styles.directContainer,
        ]}
        activeOpacity={0.7}
      >
        <View style={styles.avatarColumn}>
          {/* Avatar — ORCH-0898 branches on conversation.type */}
          {isGroup ? (
            // Group: multi-avatar stack (up to 3 participants in a layered fan).
            // Tapping opens the conversation (no per-participant route for groups in v1).
            <TouchableOpacity
              style={styles.avatarContainer}
              onPress={() => onPress(conversation)}
              activeOpacity={0.7}
              accessibilityLabel={t('chat:groupChatAvatarLabel', { defaultValue: 'Group chat with {{count}} people', count: conversation.participants.length })}
            >
              <View style={[styles.groupAvatarStack, isTripEventGroup && styles.eventGroupAvatarStack]}>
                {conversation.eventCoverMediaUrl ? (
                  <Image
                    source={{ uri: conversation.eventCoverMediaUrl }}
                    style={[styles.avatar, styles.groupCoverAvatar, styles.eventCoverAvatar]}
                    resizeMode="cover"
                  />
                ) : groupAvatarParticipants.length === 0 ? (
                  // Fallback: empty group (host hasn't accepted anyone yet) — single placeholder avatar.
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: getAvatarColor(conversation.id) },
                    ]}
                  >
                    <Text style={styles.avatarText}>{getInitials(cleanedName)}</Text>
                  </View>
                ) : (
                  groupAvatarParticipants.map((p, idx) => (
                    <View
                      key={p.id}
                      style={[
                        styles.avatar,
                        styles.groupAvatarSegment,
                        {
                          backgroundColor: getAvatarColor(p.id),
                          // Layer offset — successive avatars shift right by half-width.
                          left: idx * 14,
                          zIndex: groupAvatarParticipants.length - idx,
                        },
                      ]}
                    >
                      {p.avatar_url ? (
                        <Image
                          source={{ uri: p.avatar_url }}
                          style={styles.groupAvatarImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <Text style={styles.avatarText}>{getInitials(getDisplayName(p))}</Text>
                      )}
                    </View>
                  ))
                )}
              </View>
            </TouchableOpacity>
          ) : (
            // Direct: single avatar.
            <TouchableOpacity
              style={styles.avatarContainer}
              onPress={() => {
                if (onAvatarPress && otherParticipant?.id) {
                  onAvatarPress(otherParticipant.id);
                } else {
                  onPress(conversation);
                }
              }}
              activeOpacity={0.7}
            >
              {otherParticipant?.avatar_url ? (
                <Image
                  source={{ uri: otherParticipant.avatar_url }}
                  style={[styles.avatar, styles.directAvatarImage]}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    {
                      backgroundColor: getAvatarColor(
                        otherParticipant?.id || conversation.id
                      ),
                    },
                  ]}
                >
                  <Text style={styles.avatarText}>{getInitials(cleanedName)}</Text>
                </View>
              )}
              {otherParticipant?.is_online && <View style={styles.onlineDot} />}
            </TouchableOpacity>
          )}
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.name,
                isTripEventGroup && styles.eventName,
                hasUnread && styles.nameBold,
              ]}
              numberOfLines={1}
            >
              {cleanedName}
            </Text>
            {rowMetaLabel ? (
              <View
                style={[
                  styles.rowTypePill,
                  isTripEventGroup && styles.eventTypePill,
                  isSwipeInteracting && styles.trailingRowElementHidden,
                ]}
              >
                <Icon
                  name={isTripEventGroup ? "megaphone" : "users"}
                  size={11}
                  color={isTripEventGroup ? "#ffffff" : "#f97316"}
                />
                <Text style={[styles.rowTypePillText, isTripEventGroup && styles.eventTypePillText]}>
                  {rowMetaLabel}
                </Text>
              </View>
            ) : null}
            {isMuted && (
              <Icon name="volume-mute" size={13} color="#9ca3af" style={styles.muteIcon} />
            )}
            {hasUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.preview,
              isTripEventGroup && styles.eventPreview,
              isCollaborationGroup && styles.collaborationPreview,
              hasUnread && styles.previewBold,
              isSwipeInteracting && styles.trailingRowElementHidden,
            ]}
            numberOfLines={1}
          >
            {messagePreview || fallbackPreview || t('chat:noMessagesYet')}
          </Text>
          {timestamp ? (
            <Text style={[styles.seenAgo, isSwipeInteracting && styles.trailingRowElementHidden]}>
              {timestamp}
            </Text>
          ) : null}
        </View>

        {/* Pair/Unpair button — centered in row (ORCH-0435).
            ORCH-0898: HIDDEN for group conversations (pairing is a 1-on-1 social-graph concept). */}
        {!isGroup && pairStatus === 'paired' && onUnpairPress && (
          <TouchableOpacity
            onPress={() => { if (otherParticipant?.id) onUnpairPress(otherParticipant.id); }}
            style={[styles.unpairBtn, isSwipeInteracting && styles.trailingRowElementHidden]}
            activeOpacity={0.7}
          >
            <Icon name="star" size={14} color="#10b981" />
            <Text style={styles.unpairBtnText}>Unpair</Text>
          </TouchableOpacity>
        )}
        {!isGroup && pairStatus === 'unpaired' && onPairPress && (
          <TouchableOpacity
            onPress={() => { if (otherParticipant?.id) onPairPress(otherParticipant.id); }}
            disabled={pairLoading}
            style={[styles.pairBtn, isSwipeInteracting && styles.trailingRowElementHidden]}
            activeOpacity={0.7}
          >
            {pairLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Icon name="star" size={14} color="#ffffff" />
                <Text style={styles.pairBtnText}>Pair</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {!isGroup && pairStatus === 'pending' && (
          <TouchableOpacity
            style={[styles.pendingPairBadge, isSwipeInteracting && styles.trailingRowElementHidden]}
            onPress={() => { if (otherParticipant?.id) onPendingPairPress?.(otherParticipant.id); }}
            activeOpacity={0.7}
          >
            <Icon name="star" size={14} color="#9ca3af" />
            <Text style={styles.pendingPairText}>Pending</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Swipeable>
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
    backgroundColor: 'rgba(255, 255, 255, 0.075)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: {
        backgroundColor: 'rgba(255, 255, 255, 0.09)',
        elevation: 2,
      },
    }),
  },
  directContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.085)',
  },
  collaborationContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  eventContainer: {
    backgroundColor: 'rgba(249, 115, 22, 0.085)',
    borderColor: 'rgba(249, 115, 22, 0.24)',
  },
  avatarColumn: {
    width: 82,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
    flexShrink: 0,
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  // ORCH-0898: layered fan stack of up to 3 participant avatars for group conversations.
  groupAvatarStack: {
    width: 78, // accommodates 3 × 50px avatars with 14px overlap = 50 + 2*14 = 78
    height: 50,
    position: 'relative',
  },
  eventGroupAvatarStack: {
    width: 56,
    height: 56,
  },
  groupAvatarSegment: {
    position: 'absolute',
    top: 0,
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#ffffff',
    overflow: 'hidden',
  },
  groupAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 25,
  },
  groupCoverAvatar: {
    borderWidth: 2,
    borderColor: '#ffffff',
    overflow: 'hidden',
  },
  eventCoverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.88)',
  },
  directAvatarImage: {
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    backgroundColor: "#10b981",
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
    flex: 1,
    marginRight: 6,
  },
  eventName: {
    fontWeight: "700",
    color: "#fff7ed",
  },
  nameBold: {
    fontWeight: "700",
  },
  rowTypePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    marginRight: 6,
  },
  eventTypePill: {
    backgroundColor: "rgba(249, 115, 22, 0.14)",
    borderColor: "rgba(249, 115, 22, 0.28)",
  },
  rowTypePillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.72)",
    letterSpacing: 0,
  },
  eventTypePillText: {
    color: "#fed7aa",
  },
  pairBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#eb7825",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    marginLeft: 8,
  },
  pairBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  unpairBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    marginLeft: 8,
  },
  unpairBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#10b981",
  },
  pendingPairBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    marginLeft: 8,
  },
  pendingPairText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9ca3af",
  },
  trailingRowElementHidden: {
    opacity: 0,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  muteIcon: {
    marginRight: 4,
  },
  seenAgo: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.36)",
    marginTop: 2,
  },
  preview: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.56)",
    lineHeight: 18,
  },
  eventPreview: {
    color: "#fdba74",
    fontWeight: "600",
  },
  collaborationPreview: {
    color: "rgba(255, 255, 255, 0.58)",
  },
  previewBold: {
    fontWeight: "600",
    color: "#f8fafc",
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    backgroundColor: "#eb7825",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadText: {
    fontSize: 11,
    color: "#ffffff",
    fontWeight: "700",
  },
  // Swipe actions
  swipeActions: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
    marginRight: 12,
  },
  swipeArchive: {
    backgroundColor: "#6366f1",
    justifyContent: "center",
    alignItems: "center",
    width: 72,
    height: "100%",
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    gap: 4,
  },
  swipeDelete: {
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    width: 72,
    height: "100%",
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    gap: 4,
  },
  swipeActionText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ffffff",
  },
});
