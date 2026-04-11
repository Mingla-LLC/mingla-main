import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from "../ui/Icon";
import { BlockedUser } from "../../hooks/useFriends";

interface BlockedUsersViewProps {
  blockedUsers: BlockedUser[];
  loading: boolean;
  onUnblock: (blockedUserId: string) => void;
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

export function BlockedUsersView({
  blockedUsers,
  loading,
  onUnblock,
}: BlockedUsersViewProps) {
  const { t } = useTranslation(['social', 'common']);
  const handleUnblock = (user: BlockedUser) => {
    const displayName = user.name || user.username || "this user";
    Alert.alert(
      t('social:unblockTitle', { name: displayName }),
      t('social:unblockMessage'),
      [
        { text: t('social:cancel'), style: "cancel" },
        {
          text: t('social:unblock'),
          style: "destructive",
          onPress: () => onUnblock(user.id),
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="small" color="#eb7825" />
      </View>
    );
  }

  if (blockedUsers.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Icon name="ban-outline" size={32} color="#d1d5db" />
        <Text style={styles.emptyText}>{t('social:noBlockedUsers')}</Text>
      </View>
    );
  }

  const renderBlockedUser = ({ item }: { item: BlockedUser }) => {
    const displayName = item.name || item.username || "Unknown";
    return (
      <View style={styles.userRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => handleUnblock(item)}
          style={styles.unblockButton}
          activeOpacity={0.7}
        >
          <Text style={styles.unblockText}>{t('social:unblock')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={blockedUsers}
        keyExtractor={(item) => item.id}
        renderItem={renderBlockedUser}
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
  userRow: {
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
  unblockButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  unblockText: {
    color: "#ef4444",
    fontSize: 14,
    fontWeight: "600",
  },
});
