import React, { useRef, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useTranslation } from 'react-i18next';
import { Icon } from "../ui/Icon";
import { Conversation } from "../../hooks/useMessages";
import { getDisplayName } from "../../utils/getDisplayName";

interface ChatListItemProps {
  conversation: Conversation;
  currentUserId: string;
  onPress: (conversation: Conversation) => void;
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
  // Find the other participant (for direct conversations)
  const otherParticipant = conversation.participants.find(
    (p) => p.id !== currentUserId
  );

  const displayName = getDisplayName(otherParticipant);

  // Clean email-like names
  const cleanedName = displayName.includes("@")
    ? displayName.substring(0, displayName.indexOf("@")).trim()
    : displayName;

  const lastMessage = conversation.last_message;
  const unreadCount = conversation.unread_count || 0;
  const hasUnread = unreadCount > 0 && !isMuted;

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

  // Timestamp
  const timestamp = lastMessage?.created_at
    ? formatRelativeTime(lastMessage.created_at)
    : "";

  const swipeableRef = useRef<Swipeable>(null);

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
    >
      <TouchableOpacity
        onPress={() => onPress(conversation)}
        style={styles.container}
        activeOpacity={0.7}
      >
        {/* Avatar */}
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
          {otherParticipant?.is_online && <View style={styles.onlineDot} />}
        </TouchableOpacity>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.name, hasUnread && styles.nameBold]}
              numberOfLines={1}
            >
              {cleanedName}
            </Text>
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
            style={[styles.preview, hasUnread && styles.previewBold]}
            numberOfLines={1}
          >
            {messagePreview || t('chat:noMessagesYet')}
          </Text>
          {timestamp ? (
            <Text style={styles.seenAgo}>{timestamp}</Text>
          ) : null}
        </View>

        {/* Pair/Unpair button — centered in row (ORCH-0435) */}
        {pairStatus === 'paired' && onUnpairPress && (
          <TouchableOpacity
            onPress={() => { if (otherParticipant?.id) onUnpairPress(otherParticipant.id); }}
            style={styles.unpairBtn}
            activeOpacity={0.7}
          >
            <Icon name="star" size={14} color="#10b981" />
            <Text style={styles.unpairBtnText}>Unpair</Text>
          </TouchableOpacity>
        )}
        {pairStatus === 'unpaired' && onPairPress && (
          <TouchableOpacity
            onPress={() => { if (otherParticipant?.id) onPairPress(otherParticipant.id); }}
            disabled={pairLoading}
            style={styles.pairBtn}
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
        {pairStatus === 'pending' && (
          <TouchableOpacity
            style={styles.pendingPairBadge}
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
    paddingVertical: 12,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    ...Platform.select({
      ios: {
        backgroundColor: 'rgba(255, 255, 255, 0.70)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.45)',
        shadowColor: 'rgba(0, 0, 0, 0.06)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: {
        backgroundColor: '#ffffff',
        elevation: 2,
      },
    }),
  },
  avatarContainer: {
    position: "relative",
    marginRight: 12,
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
    marginBottom: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    flex: 1,
    marginRight: 6,
  },
  nameBold: {
    fontWeight: "700",
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  muteIcon: {
    marginRight: 4,
  },
  seenAgo: {
    fontSize: 11,
    fontWeight: "500",
    color: "#b0b5bc",
    marginTop: 2,
  },
  preview: {
    fontSize: 14,
    color: "#6b7280",
  },
  previewBold: {
    fontWeight: "600",
    color: "#111827",
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
