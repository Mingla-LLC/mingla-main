import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Icon } from "../ui/Icon";
import { FriendRequest } from "../../hooks/useFriends";

interface RequestsViewProps {
  requests: FriendRequest[];
  loading: boolean;
  onAccept: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}

function getInitials(name: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

function getDisplayName(request: FriendRequest): string {
  const sender = request.sender;
  if (!sender) return "Unknown";
  return (
    sender.display_name ||
    (sender.first_name && sender.last_name
      ? `${sender.first_name} ${sender.last_name}`
      : sender.username) ||
    "Unknown"
  );
}

export function RequestsView({
  requests,
  loading,
  onAccept,
  onDecline,
}: RequestsViewProps) {
  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="small" color="#eb7825" />
      </View>
    );
  }

  if (requests.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Icon name="people-outline" size={32} color="#d1d5db" />
        <Text style={styles.emptyText}>No pending requests</Text>
      </View>
    );
  }

  const renderRequest = ({ item }: { item: FriendRequest }) => {
    const displayName = getDisplayName(item);

    return (
      <View style={styles.requestRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            onPress={() => onAccept(item.id)}
            style={styles.acceptButton}
            activeOpacity={0.7}
          >
            <Text style={styles.acceptText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDecline(item.id)}
            style={styles.declineButton}
            activeOpacity={0.7}
          >
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={renderRequest}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    marginHorizontal: 16,
  },
  loadingState: {
    paddingVertical: 24,
    alignItems: "center",
    marginHorizontal: 16,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: "center",
    marginHorizontal: 16,
  },
  emptyText: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 8,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  userUsername: {
    fontSize: 13,
    color: "#9ca3af",
    marginTop: 1,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 8,
  },
  acceptButton: {
    backgroundColor: "#10b981",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  acceptText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  declineButton: {
    borderWidth: 1,
    borderColor: "#ef4444",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  declineText: {
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "600",
  },
});
