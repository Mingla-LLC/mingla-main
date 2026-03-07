import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Conversation } from "../../hooks/useMessages";

interface ChatListItemProps {
  conversation: Conversation;
  currentUserId: string;
  onPress: (conversation: Conversation) => void;
  isMuted?: boolean;
  onAvatarPress?: (userId: string) => void;
}

/**
 * Format a timestamp into a relative time string.
 * < 1min → "now", < 60min → "Xm", < 24h → "Xh",
 * < 7d → day name, else → short date.
 */
function formatRelativeTime(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return dayNames[date.getDay()];
  }
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
 * Generate a consistent background color from a string (user ID or name).
 */
function getAvatarColor(seed: string): string {
  const colors = [
    "#7c3aed", "#3b82f6", "#10b981", "#f59e0b",
    "#ef4444", "#ec4899", "#6366f1", "#14b8a6",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function ChatListItem({
  conversation,
  currentUserId,
  onPress,
  isMuted = false,
  onAvatarPress,
}: ChatListItemProps) {
  // Find the other participant (for direct conversations)
  const otherParticipant = conversation.participants.find(
    (p) => p.id !== currentUserId
  );

  const displayName =
    otherParticipant?.display_name ||
    (otherParticipant?.first_name && otherParticipant?.last_name
      ? `${otherParticipant.first_name} ${otherParticipant.last_name}`
      : otherParticipant?.username) ||
    "Unknown";

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
      messagePreview = "\ud83d\udcf7 Photo";
    } else if (lastMessage.message_type === "file") {
      messagePreview = "\ud83d\udcce File";
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

  return (
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
        <View style={styles.topRow}>
          <Text
            style={[styles.name, hasUnread && styles.nameBold]}
            numberOfLines={1}
          >
            {cleanedName}
          </Text>
          <View style={styles.metaRow}>
            {isMuted && (
              <Ionicons
                name="volume-mute"
                size={14}
                color="#9ca3af"
                style={styles.muteIcon}
              />
            )}
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>
        </View>
        <View style={styles.bottomRow}>
          <Text
            style={[styles.preview, hasUnread && styles.previewBold]}
            numberOfLines={1}
          >
            {messagePreview || "No messages yet"}
          </Text>
          {hasUnread && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    height: 72,
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
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    flex: 1,
    marginRight: 8,
  },
  nameBold: {
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  muteIcon: {
    marginRight: 4,
  },
  timestamp: {
    fontSize: 12,
    color: "#9ca3af",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  preview: {
    fontSize: 14,
    color: "#6b7280",
    flex: 1,
    marginRight: 8,
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
});
