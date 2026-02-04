/**
 * BlockedUsersModal
 * 
 * Full-screen modal for viewing and managing blocked users.
 * Shows all blocked users with unblock functionality.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
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

  const renderBlockedUser = ({ item: user }: { item: BlockedUser }) => (
    <View style={styles.userCard}>
      <View style={styles.userInfo}>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {getInitials(user.name, user.username)}
            </Text>
          </View>
        )}
        <View style={styles.userDetails}>
          <Text style={styles.userName} numberOfLines={1}>
            {user.name || "Unknown User"}
          </Text>
          {user.username && (
            <Text style={styles.userUsername} numberOfLines={1}>
              @{user.username}
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
        <Feather name="shield" size={48} color="#d1d5db" />
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
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.title}>Blocked Users</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle" size={20} color="#3b82f6" />
          <Text style={styles.infoText}>
            Blocked users cannot see your profile, send you messages, or add you
            as a friend.
          </Text>
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#eb7825" />
            <Text style={styles.loadingText}>Loading blocked users...</Text>
          </View>
        ) : (
          <FlatList
            data={blockedUsers}
            renderItem={renderBlockedUser}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              blockedUsers.length === 0
                ? styles.emptyListContainer
                : styles.listContainer
            }
            ListEmptyComponent={renderEmptyState}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  headerSpacer: {
    width: 40,
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#dbeafe",
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: "#1e40af",
    lineHeight: 18,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  emptyListContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  userUsername: {
    fontSize: 13,
    color: "#6b7280",
  },
  unblockButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#fff7ed",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fed7aa",
    minWidth: 80,
    alignItems: "center",
  },
  unblockButtonDisabled: {
    opacity: 0.6,
  },
  unblockButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ea580c",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
});
