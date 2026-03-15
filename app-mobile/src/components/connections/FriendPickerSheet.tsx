import React, { useState, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '../../hooks/useKeyboard';
import { Friend } from "../../hooks/useFriends";

interface FriendPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelectFriend: (friend: Friend) => void;
  friends: Friend[];
  loadingFriends: boolean;
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

function getFriendDisplayName(friend: Friend): string {
  return (
    friend.display_name ||
    (friend.first_name && friend.last_name
      ? `${friend.first_name} ${friend.last_name}`
      : friend.username) ||
    "Unknown"
  );
}

export function FriendPickerSheet({
  visible,
  onClose,
  onSelectFriend,
  friends,
  loadingFriends,
}: FriendPickerSheetProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingFriendId, setLoadingFriendId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const query = searchQuery.toLowerCase();
    return friends.filter((friend) => {
      const name = getFriendDisplayName(friend).toLowerCase();
      const username = (friend.username || "").toLowerCase();
      return name.includes(query) || username.includes(query);
    });
  }, [friends, searchQuery]);

  const handleSelectFriend = async (friend: Friend) => {
    setLoadingFriendId(friend.friend_user_id || friend.id);
    try {
      await onSelectFriend(friend);
    } finally {
      setLoadingFriendId(null);
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setLoadingFriendId(null);
    onClose();
  };

  const renderFriendRow = ({ item: friend }: { item: Friend }) => {
    const displayName = getFriendDisplayName(friend);
    const friendId = friend.friend_user_id || friend.id;
    const isLoading = loadingFriendId === friendId;

    return (
      <TouchableOpacity
        onPress={() => handleSelectFriend(friend)}
        style={styles.friendRow}
        activeOpacity={0.7}
        disabled={isLoading}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: "#7c3aed" },
          ]}
        >
          <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
        </View>
        <View style={styles.friendInfo}>
          <Text style={styles.friendName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        {isLoading && (
          <ActivityIndicator size="small" color="#eb7825" />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={handleClose}
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>New Message</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#111827" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={18}
              color="#9ca3af"
              style={styles.searchIcon}
            />
            <TextInput
              placeholder="Search friends..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
            />
          </View>

          {/* Friends list */}
          {loadingFriends ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color="#eb7825" />
            </View>
          ) : friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptySubtitle}>
                Add friends to start messaging
              </Text>
            </View>
          ) : filteredFriends.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="search" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>No results</Text>
              <Text style={styles.emptySubtitle}>
                Try a different search term
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredFriends}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              renderItem={renderFriendRow}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              ListFooterComponent={<View style={{ height: keyboardHeight > 0 ? keyboardHeight : insets.bottom }} />}
            />
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: "88%",
    paddingBottom: 0,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: "#d1d5db",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111827",
  },
  listContent: {
    paddingHorizontal: 8,
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    height: 60,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  friendInfo: {
    flex: 1,
    minWidth: 0,
  },
  friendName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  friendUsername: {
    fontSize: 13,
    color: "#9ca3af",
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
});
