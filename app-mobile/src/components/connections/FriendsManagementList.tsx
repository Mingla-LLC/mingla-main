import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  TextInput,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  Platform,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from "../ui/Icon";
import { Friend } from "../../hooks/useFriends";
import { getDisplayName } from "../../utils/getDisplayName";
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
  /** ORCH-0435: Set of user IDs that are actively paired */
  pairedUserIds?: Set<string>;
  /** ORCH-0435: Set of user IDs with pending pair requests */
  pendingPairUserIds?: Set<string>;
  /** ORCH-0435: Send pair request to friend */
  onPairFriend?: (friendUserId: string) => void;
  /** ORCH-0435: Unpair a friend */
  onUnpairFriend?: (friendUserId: string) => void;
  /** ORCH-0435: User ID currently loading pair request */
  pairLoadingUserId?: string | null;
  /** ORCH-0435: Called when avatar is tapped */
  onAvatarPress?: (friendUserId: string) => void;
  /** ORCH-0435: Called when friend row (name) is tapped */
  onFriendPress?: (friendUserId: string) => void;
  /** ORCH-0435: Add friend to active collaboration session */
  onAddToSession?: (friendUserId: string) => void;
}

function getFriendDisplayName(friend: Friend): string {
  return getDisplayName(friend);
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
  pairedUserIds,
  pendingPairUserIds,
  onPairFriend,
  onUnpairFriend,
  pairLoadingUserId,
  onAvatarPress,
  onFriendPress,
  onAddToSession,
}: FriendsManagementListProps) {
  const { t } = useTranslation(['social', 'common']);
  const [searchQuery, setSearchQuery] = useState("");
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [sheetFriend, setSheetFriend] = useState<Friend | null>(null);
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
        <Icon name="people-outline" size={32} color={colors.gray[300]} />
        <Text style={styles.emptyText}>{t('social:noFriendsYet')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={colors.gray[400]} style={styles.searchIcon} />
        <TextInput
          placeholder={t('social:searchFriends')}
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
          <Text style={styles.emptyText}>{t('social:noMatchingFriends')}</Text>
        </View>
      ) : (
        filteredFriends.map((friend, index) => {
          const friendUserId = getFriendUserId(friend, currentUserId);
          const displayName = getFriendDisplayName(friend);
          const initials = getInitials(displayName);
          const isMuted = mutedUserIds.includes(friendUserId);
          const isDropdownOpen = openDropdownId === friend.id;
          const isMuteLoading = muteLoadingFriendId === friendUserId;

          return (
            <View key={friend.id} style={styles.friendRow}>
              {/* Avatar — tappable → opens profile */}
              <TouchableOpacity
                style={styles.avatarContainer}
                onPress={() => {
                  setOpenDropdownId(null);
                  onAvatarPress?.(friendUserId);
                }}
                activeOpacity={0.7}
              >
                {friend.avatar_url ? (
                  <Image source={{ uri: friend.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Name + muted badge — tappable → opens chat */}
              <TouchableOpacity
                style={styles.userInfo}
                onPress={() => {
                  setOpenDropdownId(null);
                  onFriendPress?.(friendUserId);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.nameRow}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {isMuted && (
                    <Icon
                      name="volume-mute"
                      size={13}
                      color={colors.gray[400]}
                      style={styles.mutedIcon}
                    />
                  )}
                </View>
              </TouchableOpacity>

              {/* Pair/Unpair button — ORCH-0435 */}
              {(() => {
                if (!pairedUserIds || !pendingPairUserIds) return null;
                const isPaired = pairedUserIds.has(friendUserId);
                const isPending = pendingPairUserIds.has(friendUserId);
                const isLoadingPair = pairLoadingUserId === friendUserId;

                if (isPaired) {
                  return (
                    <TouchableOpacity
                      onPress={() => onUnpairFriend?.(friendUserId)}
                      style={styles.unpairBtn}
                      activeOpacity={0.7}
                    >
                      <Icon name="star" size={12} color="#10b981" />
                      <Text style={styles.unpairBtnText}>Unpair</Text>
                    </TouchableOpacity>
                  );
                }
                if (isPending) {
                  return (
                    <View style={styles.pendingPairBadge}>
                      <Icon name="star" size={12} color="#9ca3af" />
                      <Text style={styles.pendingPairText}>Pending</Text>
                    </View>
                  );
                }
                return (
                  <TouchableOpacity
                    onPress={() => onPairFriend?.(friendUserId)}
                    disabled={isLoadingPair}
                    style={styles.pairBtn}
                    activeOpacity={0.7}
                  >
                    {isLoadingPair ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Icon name="star" size={12} color="#ffffff" />
                        <Text style={styles.pairBtnText}>Pair</Text>
                      </>
                    )}
                  </TouchableOpacity>
                );
              })()}

              {/* Three-dot menu → opens bottom sheet */}
              <TouchableOpacity
                onPress={() => setSheetFriend(friend)}
                style={styles.menuButton}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="ellipsis-vertical" size={18} color={colors.text.tertiary} />
              </TouchableOpacity>
            </View>
          );
        })
      )}
      <View style={{ height: keyboardHeight > 0 ? keyboardHeight : insets.bottom }} />

      {/* Bottom sheet menu */}
      <Modal
        visible={!!sheetFriend}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetFriend(null)}
      >
        <TouchableWithoutFeedback onPress={() => setSheetFriend(null)}>
          <View style={styles.sheetOverlay} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheetContainer, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          {sheetFriend && (() => {
            const sheetUserId = getFriendUserId(sheetFriend, currentUserId);
            const sheetName = getFriendDisplayName(sheetFriend);
            const sheetIsMuted = mutedUserIds.includes(sheetUserId);
            const sheetIsPaired = pairedUserIds?.has(sheetUserId);
            const sheetIsPending = pendingPairUserIds?.has(sheetUserId);
            const sheetMuteLoading = muteLoadingFriendId === sheetUserId;
            return (
              <>
                <Text style={styles.sheetTitle}>{sheetName}</Text>

                {/* Pair / Unpair */}
                {sheetIsPaired ? (
                  <TouchableOpacity
                    style={styles.sheetItem}
                    onPress={() => { setSheetFriend(null); onUnpairFriend?.(sheetUserId); }}
                    activeOpacity={0.7}
                  >
                    <Icon name="star" size={20} color="#10b981" style={styles.sheetItemIcon} />
                    <Text style={styles.sheetItemText}>Unpair</Text>
                  </TouchableOpacity>
                ) : sheetIsPending ? (
                  <View style={styles.sheetItem}>
                    <Icon name="star-outline" size={20} color="#9ca3af" style={styles.sheetItemIcon} />
                    <Text style={[styles.sheetItemText, { color: '#9ca3af' }]}>Pair request pending</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.sheetItem}
                    onPress={() => { setSheetFriend(null); onPairFriend?.(sheetUserId); }}
                    activeOpacity={0.7}
                  >
                    <Icon name="star-outline" size={20} color="#eb7825" style={styles.sheetItemIcon} />
                    <Text style={styles.sheetItemText}>Send pair request</Text>
                  </TouchableOpacity>
                )}

                {/* Add to session */}
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => { setSheetFriend(null); onAddToSession?.(sheetUserId); }}
                  activeOpacity={0.7}
                >
                  <Icon name="people-outline" size={20} color={colors.text.secondary} style={styles.sheetItemIcon} />
                  <Text style={styles.sheetItemText}>Add to session</Text>
                </TouchableOpacity>

                {/* Mute / Unmute */}
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => { setSheetFriend(null); onMuteUser(sheetFriend); }}
                  activeOpacity={0.7}
                  disabled={sheetMuteLoading}
                >
                  <Icon
                    name={sheetIsMuted ? "volume-high" : "volume-mute"}
                    size={20}
                    color={colors.text.secondary}
                    style={styles.sheetItemIcon}
                  />
                  <Text style={styles.sheetItemText}>
                    {sheetIsMuted ? t('social:unmute') : t('social:mute')}
                  </Text>
                </TouchableOpacity>

                <View style={styles.sheetDivider} />

                {/* Remove Friend */}
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => { setSheetFriend(null); onRemoveFriend(sheetFriend); }}
                  activeOpacity={0.7}
                >
                  <Icon name="person-remove" size={20} color={colors.error[500]} style={styles.sheetItemIcon} />
                  <Text style={styles.sheetItemTextDanger}>{t('social:removeFriend')}</Text>
                </TouchableOpacity>

                {/* Block User */}
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => { setSheetFriend(null); onBlockUser(sheetFriend); }}
                  activeOpacity={0.7}
                >
                  <Icon name="shield" size={20} color={colors.error[500]} style={styles.sheetItemIcon} />
                  <Text style={styles.sheetItemTextDanger}>{t('social:blockUserMenu')}</Text>
                </TouchableOpacity>

                {/* Report User */}
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => { setSheetFriend(null); onReportUser(sheetFriend); }}
                  activeOpacity={0.7}
                >
                  <Icon name="flag" size={20} color={colors.error[500]} style={styles.sheetItemIcon} />
                  <Text style={styles.sheetItemTextDanger}>{t('social:reportUserMenu')}</Text>
                </TouchableOpacity>
              </>
            );
          })()}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
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
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    paddingHorizontal: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    height: 40,
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
    paddingVertical: 8,
    paddingHorizontal: 16,
    position: "relative",
  },
  avatarContainer: {
    marginRight: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#eb7825",
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
  pairBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#eb7825",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    marginRight: 6,
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
    marginRight: 6,
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
    marginRight: 6,
  },
  pendingPairText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9ca3af",
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  // Bottom sheet styles
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  sheetContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 16,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  sheetItemIcon: {
    width: 28,
    textAlign: "center",
    marginRight: 14,
  },
  sheetItemText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  sheetItemTextDanger: {
    fontSize: 16,
    fontWeight: "500",
    color: colors.error[500],
  },
  sheetDivider: {
    height: 1,
    backgroundColor: "#f3f4f6",
    marginVertical: 4,
  },
});
