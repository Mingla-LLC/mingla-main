/**
 * BlockedUsersModal
 * 
 * Full-screen bottom sheet modal for viewing and managing blocked users.
 * Shows all blocked users with unblock functionality.
 * Matches the design language of NotificationsModal and SessionViewModal.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Dimensions,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useFriends, BlockedUser } from "../hooks/useFriends";

interface BlockedUsersModalProps {
  visible: boolean;
  onClose: () => void;
  onUnblockUser?: (user: BlockedUser) => Promise<void>;
}

export default function BlockedUsersModal({
  visible,
  onClose,
  onUnblockUser,
}: BlockedUsersModalProps) {
  const insets = useSafeAreaInsets();
  const { blockedUsers = [], fetchBlockedUsers, unblockFriend } = useFriends();
  const [loading, setLoading] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Refresh blocked users when modal opens
  useEffect(() => {
    if (visible) {
      setLoading(true);
      fetchBlockedUsers().finally(() => setLoading(false));
    }
  }, [visible, fetchBlockedUsers]);

  const handleUnblock = async (user: BlockedUser) => {
    Alert.alert(
      "Unblock User",
      `Are you sure you want to unblock ${user.name || user.username || "this user"}?\n\nThey will be able to:\n• Find your profile in search\n• Send you messages\n• Send you friend requests\n\nNote: They will NOT be automatically added back to your friends list.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Unblock",
          style: "default",
          onPress: async () => {
            setUnblockingId(user.id);
            try {
              if (onUnblockUser) {
                await onUnblockUser(user);
              } else {
                await unblockFriend(user.id);
              }
              // Refresh the list
              await fetchBlockedUsers();
            } catch (error) {
              console.error("Error unblocking user:", error);
              Alert.alert("Error", "Failed to unblock user. Please try again.");
            } finally {
              setUnblockingId(null);
            }
          },
        },
      ]
    );
  };

  const getInitials = (name?: string, username?: string): string => {
    if (name && name !== "Unknown") {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (username) {
      return username.slice(0, 2).toUpperCase();
    }
    return "?";
  };

  const getAvatarColor = (id: string): string => {
    const colors = ["#eb7825", "#374151", "#059669", "#7c3aed", "#dc2626"];
    const hash = id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  const formatBlockedTime = (blockedAt?: string): string => {
    if (!blockedAt) return "";
    
    const now = new Date();
    const blockedDate = new Date(blockedAt);
    const diffMs = now.getTime() - blockedDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffMins < 1) return "Blocked just now";
    if (diffMins < 60) return `Blocked ${diffMins} ${diffMins === 1 ? "minute" : "minutes"} ago`;
    if (diffHours < 24) return `Blocked ${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
    if (diffDays < 7) return `Blocked ${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
    if (diffWeeks < 4) return `Blocked ${diffWeeks} ${diffWeeks === 1 ? "week" : "weeks"} ago`;
    if (diffMonths < 12) return `Blocked ${diffMonths} ${diffMonths === 1 ? "month" : "months"} ago`;
    return `Blocked ${diffYears} ${diffYears === 1 ? "year" : "years"} ago`;
  };

  const renderBlockedUser = ({ item: user }: { item: BlockedUser }) => (
    <View style={styles.userCard}>
      <View style={styles.userInfo}>
        <View style={styles.avatarContainer}>
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: getAvatarColor(user.id) }]}>
              <Text style={styles.avatarText}>
                {getInitials(user.name, user.username)}
              </Text>
            </View>
          )}
          <View style={styles.blockedBadge}>
            <Feather name="user-x" size={12} color="white" />
          </View>
        </View>
        <View style={styles.userDetails}>
          <Text style={styles.userName} numberOfLines={1}>
            {user.name || "Unknown User"}
          </Text>
          {user.username && (
            <Text style={styles.userUsername} numberOfLines={1}>
              @{user.username}
            </Text>
          )}
          {user.blocked_at && (
            <Text style={styles.blockedTime} numberOfLines={1}>
              {formatBlockedTime(user.blocked_at)}
            </Text>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={[
          styles.unblockButton,
          unblockingId === user.id && styles.unblockButtonDisabled,
        ]}
        onPress={() => handleUnblock(user)}
        disabled={unblockingId === user.id}
      >
        {unblockingId === user.id ? (
          <ActivityIndicator size="small" color="#eb7825" />
        ) : (
          <Text style={styles.unblockButtonText}>Unblock</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Feather name="shield" size={32} color="#d1d5db" />
      </View>
      <Text style={styles.emptyTitle}>No Blocked Users</Text>
      <Text style={styles.emptySubtitle}>
        You haven't blocked anyone yet.{"\n"}
        When you block someone, they'll appear here.
      </Text>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.sheetOverlay}>
        {/* Tap backdrop to close */}
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={[styles.sheetContent, { paddingBottom: insets.bottom }]}>
          {/* Drag Handle */}
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View style={styles.headerSidePlaceholder} />
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Blocked Users</Text>
                <Text style={styles.headerSubtitle}>
                  {blockedUsers.length} {blockedUsers.length === 1 ? "user" : "users"} blocked
                </Text>
              </View>
              <View style={styles.headerSidePlaceholder} />
            </View>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
              <Text style={styles.loadingText}>Loading blocked users...</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.contentContainer}
              style={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {blockedUsers.length === 0 ? (
                renderEmptyState()
              ) : (
                <View style={styles.listContainer}>
                  {blockedUsers.map((item) => renderBlockedUser({ item, index: 0 }))}
                </View>
              )}
            </ScrollView>
            )}
        </View>
      </View>
    </Modal>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContent: {
    height: SHEET_HEIGHT,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 30,
  },
  dragHandleContainer: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginTop: 2,
    textAlign: "center",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  headerSidePlaceholder: {
    width: 36,
    height: 36,
  },
  content: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  contentContainer: {
    flexGrow: 1,
    padding: 16,
  },

  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    padding: 64,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    minHeight: 200,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  listContainer: {
    gap: 12,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 12,
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  avatarContainer: {
    position: "relative",
    flexShrink: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  blockedBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "white",
  },
  userDetails: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  userUsername: {
    fontSize: 13,
    color: "#9ca3af",
  },
  blockedTime: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 2,
  },
  unblockButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#eb7825",
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
    flexShrink: 0,
  },
  unblockButtonDisabled: {
    opacity: 0.6,
  },
  unblockButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "white",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    lineHeight: 22,
  },
});
