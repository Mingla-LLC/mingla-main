import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  TextInput,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Friend } from "../../hooks/useFriends";
import { colors, spacing, radius, fontWeights } from "../../constants/designSystem";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '../../hooks/useKeyboard';

interface FriendsManagementListProps {
  friends: Friend[];
  loading: boolean;
  onRemoveFriend: (friend: Friend) => void;
  onBlockUser: (friend: Friend) => void;
  onReportUser: (friend: Friend) => void;
  onMuteUser: (friend: Friend) => void;
  muteLoadingFriendId: string | null;
  mutedUserIds: string[];
  currentUserId: string;
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

function getInitials(name: string): string {
  if (!name || name === "Unknown") return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

function getFriendUserId(friend: Friend, currentUserId: string): string {
  return friend.user_id === currentUserId ? friend.friend_user_id : friend.user_id;
}

export function FriendsManagementList({
  friends,
  loading,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  onMuteUser,
  muteLoadingFriendId,
  mutedUserIds,
  currentUserId,
}: FriendsManagementListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });

  const filteredFriends = friends.filter((friend) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const displayName = getFriendDisplayName(friend).toLowerCase();
    const username = (friend.username || "").toLowerCase();
    const fullName = `${friend.first_name || ""} ${friend.last_name || ""}`.toLowerCase();
    return displayName.includes(q) || username.includes(q) || fullName.includes(q);
  });

  const handleAction = (action: (friend: Friend) => void, friend: Friend) => {
    setOpenDropdownId(null);
    action(friend);
  };

  if (loading && friends.length === 0) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="small" color={colors.primary[600]} />
      </View>
    );
  }

  if (friends.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="people-outline" size={32} color={colors.gray[300]} />
        <Text style={styles.emptyText}>No friends yet</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      onStartShouldSetResponder={() => {
        if (openDropdownId !== null) {
          setOpenDropdownId(null);
          return true;
        }
        return false;
      }}
    >
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={14} color={colors.gray[400]} style={styles.searchIcon} />
        <TextInput
          placeholder="Search friends..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
          placeholderTextColor={colors.gray[400]}
          autoCapitalize="none"
        />
      </View>

      {/* Friends list */}
      {filteredFriends.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No matching friends</Text>
        </View>
      ) : (
        filteredFriends.map((friend, index) => {
          const friendUserId = getFriendUserId(friend, currentUserId);
          const displayName = getFriendDisplayName(friend);
          const initials = getInitials(displayName);
          const isMuted = mutedUserIds.includes(friendUserId);
          const isDropdownOpen = openDropdownId === friend.id;
          const isMuteLoading = muteLoadingFriendId === friendUserId;
          // Reverse z-index: earlier rows render on top of later ones
          // so dropdowns aren't clipped by subsequent sibling rows.
          const rowZIndex = isDropdownOpen ? 999 : filteredFriends.length - index;

          return (
            <View key={friend.id} style={[styles.friendRow, { zIndex: rowZIndex }]}>
              {/* Avatar */}
              <View style={styles.avatarContainer}>
                {friend.avatar_url ? (
                  <Image source={{ uri: friend.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
              </View>

              {/* Name + muted badge */}
              <View style={styles.userInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {isMuted && (
                    <Ionicons
                      name="volume-mute"
                      size={13}
                      color={colors.gray[400]}
                      style={styles.mutedIcon}
                    />
                  )}
                </View>
                {friend.username ? (
                  <Text style={styles.userUsername} numberOfLines={1}>
                    @{friend.username}
                  </Text>
                ) : null}
              </View>

              {/* Three-dot menu */}
              <TouchableOpacity
                onPress={() => setOpenDropdownId(isDropdownOpen ? null : friend.id)}
                style={styles.menuButton}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.text.tertiary} />
              </TouchableOpacity>

              {/* Dropdown menu */}
              {isDropdownOpen && (
                <View style={styles.dropdown}>
                  {/* Mute / Unmute */}
                  <TouchableOpacity
                    onPress={() => handleAction(onMuteUser, friend)}
                    style={styles.dropdownItem}
                    activeOpacity={0.7}
                    disabled={isMuteLoading}
                  >
                    {isMuteLoading ? (
                      <ActivityIndicator size="small" color={colors.text.tertiary} style={styles.dropdownIcon} />
                    ) : (
                      <Ionicons
                        name={isMuted ? "volume-high" : "volume-mute"}
                        size={16}
                        color={colors.text.tertiary}
                        style={styles.dropdownIcon}
                      />
                    )}
                    <Text style={styles.dropdownText}>
                      {isMuted ? "Unmute" : "Mute"}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.dropdownDivider} />

                  {/* Remove Friend */}
                  <TouchableOpacity
                    onPress={() => handleAction(onRemoveFriend, friend)}
                    style={styles.dropdownItem}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="person-remove"
                      size={16}
                      color={colors.error[500]}
                      style={styles.dropdownIcon}
                    />
                    <Text style={styles.dropdownTextDanger}>Remove Friend</Text>
                  </TouchableOpacity>

                  {/* Block User */}
                  <TouchableOpacity
                    onPress={() => handleAction(onBlockUser, friend)}
                    style={styles.dropdownItem}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="shield"
                      size={16}
                      color={colors.error[500]}
                      style={styles.dropdownIcon}
                    />
                    <Text style={styles.dropdownTextDanger}>Block User</Text>
                  </TouchableOpacity>

                  {/* Report User */}
                  <TouchableOpacity
                    onPress={() => handleAction(onReportUser, friend)}
                    style={styles.dropdownItem}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="flag"
                      size={16}
                      color={colors.error[500]}
                      style={styles.dropdownIcon}
                    />
                    <Text style={styles.dropdownTextDanger}>Report User</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })
      )}
      <View style={{ height: keyboardHeight > 0 ? keyboardHeight : insets.bottom }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 4,
    backgroundColor: colors.background.secondary,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
  },
  loadingState: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginHorizontal: spacing.md,
  },
  emptyState: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginHorizontal: spacing.md,
  },
  emptyText: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background.tertiary,
    borderRadius: 10,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text.primary,
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    position: "relative",
  },
  avatarContainer: {
    marginRight: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.text.inverse,
    fontSize: 15,
    fontWeight: fontWeights.semibold,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  userName: {
    fontSize: 15,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    flexShrink: 1,
  },
  mutedIcon: {
    marginLeft: 4,
  },
  userUsername: {
    fontSize: 13,
    color: colors.gray[400],
    marginTop: 1,
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdown: {
    position: "absolute",
    top: 44,
    right: 0,
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    paddingVertical: 4,
    minWidth: 170,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 100,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  dropdownIcon: {
    width: 20,
    textAlign: "center",
    marginRight: 10,
  },
  dropdownText: {
    fontSize: 14,
    color: colors.gray[700],
    fontWeight: fontWeights.medium,
  },
  dropdownTextDanger: {
    fontSize: 14,
    color: colors.error[500],
    fontWeight: fontWeights.medium,
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: colors.gray[200],
    marginHorizontal: 14,
  },
});
