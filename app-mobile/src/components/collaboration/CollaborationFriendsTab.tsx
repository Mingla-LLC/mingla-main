import React, { useState, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status?: "online" | "offline" | "away";
  mutualFriends?: number;
  isMuted?: boolean;
}

interface CollaborationFriendsTabProps {
  friends: Friend[];
  onShowAddFriendModal: () => void;
  onShowFriendRequests: () => void;
  onShowQRCode: () => void;
  onCopyInvite: () => void;
  onSelectFriend: (friend: Friend) => void;
  onSendCollabInvite: (friend: Friend) => void;
  onAddToBoard: (friend: Friend) => void;
  onShareSavedCard: (friend: Friend) => void;
  onMuteUser?: (friend: Friend) => void;
  onRemoveFriend: (friend: Friend) => void;
  onBlockUser: (friend: Friend) => void;
  onReportUser: (friend: Friend) => void;
  showQRCode: boolean;
  inviteCopied: boolean;
  friendRequestsCount: number;
  muteLoadingFriendId?: string | null;
}

export default function CollaborationFriendsTab({
  friends,
  onShowAddFriendModal,
  onShowFriendRequests,
  onShowQRCode,
  onCopyInvite,
  onSelectFriend,
  onSendCollabInvite,
  onAddToBoard,
  onShareSavedCard,
  onMuteUser,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  showQRCode,
  inviteCopied,
  friendRequestsCount,
  muteLoadingFriendId,
}: CollaborationFriendsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [friendsListExpanded, setFriendsListExpanded] = useState(true);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isBlockingUser, setIsBlockingUser] = useState(false);
  const buttonRefs = useRef<{ [key: string]: View | null }>({});

  // Filter friends based on search query
  const filteredFriends = friends.filter(
    (friend) =>
      friend.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (friend.username &&
        friend.username.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Show only first 3 friends when collapsed, all when expanded
  const displayedFriends = friendsListExpanded
    ? filteredFriends
    : filteredFriends.slice(0, 3);

  const handleToggleDropdown = (friendId: string) => {
    if (openDropdownId === friendId) {
      setOpenDropdownId(null);
      setDropdownPosition(null);
    } else {
      const buttonRef = buttonRefs.current[friendId];
      if (buttonRef) {
        buttonRef.measure((x, y, width, height, pageX, pageY) => {
          // Always position dropdown below the button
          const dropdownY = pageY + height + 8;
          const dropdownX = pageX + width - 200; // Align right edge with button right edge

          setDropdownPosition({ x: dropdownX, y: dropdownY });
          setOpenDropdownId(friendId);
        });
      } else {
        setOpenDropdownId(friendId);
        setDropdownPosition(null);
      }
    }
  };

  const handleCloseDropdown = () => {
    setOpenDropdownId(null);
    setDropdownPosition(null);
  };

  const handleBlockUser = (friend: Friend) => {
    setIsBlockingUser(true);

    Alert.alert(
      "Block User",
      `Block ${friend.name}? They will be removed from your friends and won't be able to contact you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => onBlockUser(friend),
        },
      ]
    );

    handleCloseDropdown();
  };

  const getStatusColor = (status?: "online" | "offline" | "away") => {
    switch (status) {
      case "online":
        return "#10B981";
      case "away":
        return "#F59E0B";
      case "offline":
        return "#9CA3AF";
      default:
        return "#9CA3AF";
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header with View Requests */}
      <View style={styles.headerSection}>
        <Text style={styles.friendsTitle}>Friends</Text>
        <TouchableOpacity
          onPress={onShowFriendRequests}
          style={styles.viewRequestsButton}
        >
          <Text style={styles.viewRequestsText}>View Requests</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={20}
          color="#9CA3AF"
          style={styles.searchIcon}
        />
        <TextInput
          placeholder="Search friends..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          onPress={onShowAddFriendModal}
          style={styles.actionButton}
        >
          <View
            style={[styles.actionIconContainer, { backgroundColor: "#3B82F6" }]}
          >
            <Ionicons name="person-add" size={24} color="#FFFFFF" />
          </View>
          <Text style={styles.actionButtonText}>Add Friend</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onShowQRCode} style={styles.actionButton}>
          <View
            style={[styles.actionIconContainer, { backgroundColor: "#8B5CF6" }]}
          >
            <Ionicons name="qr-code" size={24} color="#FFFFFF" />
          </View>
          <Text style={styles.actionButtonText}>QR Code</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onCopyInvite} style={styles.actionButton}>
          <View
            style={[styles.actionIconContainer, { backgroundColor: "#10B981" }]}
          >
            {inviteCopied ? (
              <Ionicons name="checkmark" size={24} color="#FFFFFF" />
            ) : (
              <Ionicons name="link" size={24} color="#FFFFFF" />
            )}
          </View>
          <Text style={styles.actionButtonText}>Invite Link</Text>
        </TouchableOpacity>
      </View>

      {/* QR Code Display */}
      {showQRCode && (
        <View style={styles.qrCodeContainer}>
          <View style={styles.qrCode}>
            <View style={styles.qrGrid}>
              {Array.from({ length: 64 }).map((_, i) => (
                <View
                  key={`qr-dot-${i}`}
                  style={[
                    styles.qrDot,
                    {
                      backgroundColor:
                        Math.random() > 0.5 ? "#111827" : "white",
                    },
                  ]}
                />
              ))}
            </View>
          </View>
          <View style={styles.qrTextContainer}>
            <Text style={styles.qrTitle}>Scan to Add Me</Text>
            <Text style={styles.qrSubtitle}>
              Have friends scan this code to instantly connect
            </Text>
          </View>
        </View>
      )}

      {/* Friends List Header */}
      <View style={styles.friendsListHeader}>
        <Text style={styles.friendsCountText}>
          {filteredFriends.length}{" "}
          {filteredFriends.length === 1 ? "Friend" : "Friends"}
        </Text>
        {filteredFriends.length > 3 && (
          <TouchableOpacity
            onPress={() => setFriendsListExpanded(!friendsListExpanded)}
            style={styles.expandButton}
          >
            <Text style={styles.showLessText}>
              {friendsListExpanded ? "Show Less" : "Show More"}
            </Text>
            <Ionicons
              name={friendsListExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color="#eb7825"
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Friends List */}
      <View style={styles.friendsList}>
        {displayedFriends.map((friend) => (
          <View key={friend.id} style={styles.friendCard}>
            <View style={styles.friendContent}>
              <View style={styles.avatarContainer}>
                {friend.avatar ? (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {getInitials(friend.name)}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.avatar, { backgroundColor: "#8B5CF6" }]}>
                    <Text style={styles.avatarText}>
                      {getInitials(friend.name)}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: getStatusColor(friend.status) },
                  ]}
                />
              </View>

              <View style={styles.friendInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.friendName}>{friend.name}</Text>
                  {friend.isMuted && (
                    <View style={styles.mutedIndicator}>
                      <Ionicons name="notifications-off" size={12} color="#6b7280" />
                    </View>
                  )}
                </View>
                <Text style={styles.friendUsername}>
                  @
                  {friend.username ||
                    friend.name.toLowerCase().replace(" ", "")}
                </Text>
                {friend.mutualFriends !== undefined &&
                  friend.mutualFriends > 0 && (
                    <Text style={styles.mutualFriends}>
                      {friend.mutualFriends} mutual{" "}
                      {friend.mutualFriends === 1 ? "friend" : "friends"}
                    </Text>
                  )}
              </View>

              <View style={styles.friendActions}>
                <TouchableOpacity
                  onPress={() => onSelectFriend(friend)}
                  style={styles.chatButton}
                >
                  <Ionicons name="chatbubble" size={18} color="#eb7825" />
                </TouchableOpacity>

                <View style={styles.dropdownContainer}>
                  <View
                    ref={(ref) => {
                      buttonRefs.current[friend.id] = ref;
                    }}
                    collapsable={false}
                  >
                    <TouchableOpacity
                      onPress={() => handleToggleDropdown(friend.id)}
                      style={styles.menuButton}
                    >
                      <Ionicons
                        name="ellipsis-horizontal"
                        size={18}
                        color="#6B7280"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </View>
        ))}

        {!friendsListExpanded && filteredFriends.length > 3 && (
          <TouchableOpacity
            onPress={() => setFriendsListExpanded(true)}
            style={styles.showMoreButton}
          >
            <Text style={styles.showMoreText}>
              Show {filteredFriends.length - 3} more friends
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {filteredFriends.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyStateTitle}>No Friends Found</Text>
          <Text style={styles.emptyStateText}>
            {searchQuery
              ? "Try adjusting your search"
              : "Add friends to start collaborating"}
          </Text>
        </View>
      )}

      {/* Dropdown Modal */}
      <Modal
        visible={openDropdownId !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseDropdown}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleCloseDropdown}
        >
          {dropdownPosition && openDropdownId && (
            <View
              style={[
                styles.dropdownModalContainer,
                {
                  left: dropdownPosition.x,
                  top: dropdownPosition.y,
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.dropdown}>
                {displayedFriends
                  .filter((f) => f.id === openDropdownId)
                  .map((friend) => (
                    <React.Fragment key={friend.id}>
                      <TouchableOpacity
                        onPress={() => {
                          onAddToBoard(friend);
                          handleCloseDropdown();
                        }}
                        style={styles.dropdownItem}
                      >
                        <Ionicons
                          name="bookmark-outline"
                          size={16}
                          color="#111827"
                        />
                        <Text style={styles.dropdownItemText}>
                          Add to Board
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          if (muteLoadingFriendId !== friend.id) {
                            onMuteUser?.(friend);
                          }
                        }}
                        style={[
                          styles.dropdownItem,
                          muteLoadingFriendId === friend.id && styles.dropdownItemDisabled
                        ]}
                        disabled={muteLoadingFriendId === friend.id}
                      >
                        {muteLoadingFriendId === friend.id ? (
                          <ActivityIndicator size={16} color="#6b7280" />
                        ) : (
                          <Ionicons
                            name={friend.isMuted ? "notifications-outline" : "notifications-off-outline"}
                            size={16}
                            color="#111827"
                          />
                        )}
                        <Text style={styles.dropdownItemText}>
                          {friend.isMuted ? "Unmute" : "Mute"}
                        </Text>
                        {friend.isMuted && (
                          <View style={styles.mutedBadgeSmall}>
                            <Text style={styles.mutedBadgeText}>Muted</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                      <View style={styles.divider} />
                      <TouchableOpacity
                        onPress={() => handleBlockUser(friend)}
                        style={styles.dropdownItem}
                      >
                        <Ionicons
                          name="shield-outline"
                          size={16}
                          color="#EF4444"
                        />
                        {isBlockingUser ? (
                          <ActivityIndicator size="small" color="#EF4444" />
                        ) : (
                          ""
                        )}
                        <Text
                          style={[styles.dropdownItemText, styles.dangerText]}
                        >
                          Block User
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          onReportUser(friend);
                          handleCloseDropdown();
                        }}
                        style={styles.dropdownItem}
                      >
                        <Ionicons
                          name="flag-outline"
                          size={16}
                          color="#EF4444"
                        />
                        <Text
                          style={[styles.dropdownItemText, styles.dangerText]}
                        >
                          Report User
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          onRemoveFriend(friend);
                          handleCloseDropdown();
                        }}
                        style={styles.dropdownItem}
                      >
                        <Ionicons
                          name="person-remove-outline"
                          size={16}
                          color="#EF4444"
                        />
                        <Text
                          style={[styles.dropdownItemText, styles.dangerText]}
                        >
                          Remove Friend
                        </Text>
                      </TouchableOpacity>
                    </React.Fragment>
                  ))}
              </View>
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  friendsTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  viewRequestsButton: {
    backgroundColor: "#FEF3E7",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  viewRequestsText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
  },
  searchContainer: {
    position: "relative",
    marginBottom: 16,
  },
  searchInput: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    paddingLeft: 48,
  },
  searchIcon: {
    position: "absolute",
    left: 16,
    top: "50%",
    transform: [{ translateY: -10 }],
    zIndex: 1,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  actionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
    textAlign: "center",
  },
  qrCodeContainer: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
  },
  qrCode: {
    width: 192,
    height: 192,
    backgroundColor: "#F3F4F6",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  qrGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 160,
    height: 160,
    gap: 2,
  },
  qrDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  qrTextContainer: {
    alignItems: "center",
    gap: 8,
  },
  qrTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  qrSubtitle: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
  },
  friendsListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  friendsCountText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  expandButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  showLessText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
  },
  friendsList: {
    gap: 12,
  },
  friendCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    padding: 16,
  },
  friendContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  statusDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  friendInfo: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  friendName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  mutedIndicator: {
    backgroundColor: "#f3f4f6",
    padding: 4,
    borderRadius: 4,
  },
  friendUsername: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 4,
  },
  mutualFriends: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  friendActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chatButton: {
    width: 36,
    height: 36,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownContainer: {
    position: "relative",
  },
  menuButton: {
    width: 36,
    height: 36,
    backgroundColor: "#F3F4F6",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "transparent",
  },
  dropdownModalContainer: {
    position: "absolute",
    width: 200,
  },
  dropdown: {
    width: 200,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 9999,
    zIndex: 9999,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dropdownItemDisabled: {
    opacity: 0.6,
  },
  dropdownItemText: {
    fontSize: 14,
    color: "#111827",
  },
  mutedBadgeSmall: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: "auto",
  },
  mutedBadgeText: {
    fontSize: 10,
    color: "#6b7280",
    fontWeight: "500",
  },
  dangerText: {
    color: "#EF4444",
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    marginVertical: 4,
  },
  showMoreButton: {
    width: "100%",
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderStyle: "dashed",
    borderRadius: 16,
    marginTop: 8,
  },
  showMoreText: {
    fontSize: 14,
    color: "#6B7280",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
  },
});
