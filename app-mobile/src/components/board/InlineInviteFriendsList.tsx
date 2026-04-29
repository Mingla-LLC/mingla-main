/**
 * InlineInviteFriendsList — friend-picker invite rendered inline (ORCH-0520).
 *
 * Extracted from the deleted InviteParticipantsModal.tsx. Keeps identical
 * behavior: multi-select with checkboxes, search-as-you-type, "Send Invites (N)"
 * button, Mixpanel + AppsFlyer events, Alert confirmations. Removes modal
 * chrome (overlay, Modal wrapper, close button) so it can render inside the
 * BoardSettingsDropdown accordion.
 *
 * i18n keys migrated from board:inviteParticipantsModal.* to
 * board:inlineInviteFriendsList.* across all 7 locale files.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { Icon } from "../ui/Icon";
import { getDisplayName } from "../../utils/getDisplayName";
import { supabase } from "../../services/supabase";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/appStore";
import { addFriendsToSessions } from "../../services/sessionMembershipService";

interface FriendItem {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
}

interface InlineInviteFriendsListProps {
  sessionId: string;
  sessionName: string;
  existingParticipantIds: string[];
  onInvitesSent?: () => void;
}

export const InlineInviteFriendsList: React.FC<InlineInviteFriendsListProps> = ({
  sessionId,
  sessionName,
  existingParticipantIds,
  onInvitesSent,
}) => {
  const { user } = useAppStore();
  const { t } = useTranslation(["board", "common"]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<FriendItem[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [availableFriends, setAvailableFriends] = useState<FriendItem[]>([]);

  const loadFriendsFromDB = useCallback(async () => {
    if (!user?.id) return;
    setLoadingFriends(true);

    try {
      const { data: rawFriends, error: friendsError } = await supabase
        .from("friends")
        .select("*")
        .eq("status", "accepted")
        .or(`user_id.eq.${user.id},friend_user_id.eq.${user.id}`);

      if (friendsError) throw friendsError;

      const friendUserIds = (rawFriends || []).map((f: { user_id: string; friend_user_id: string }) =>
        f.user_id === user.id ? f.friend_user_id : f.user_id
      );

      const uniqueIds = [...new Set(friendUserIds)];

      if (uniqueIds.length === 0) {
        setAvailableFriends([]);
        setLoadingFriends(false);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, first_name, last_name, display_name, avatar_url")
        .in("id", uniqueIds);

      if (profilesError) throw profilesError;

      const transformed: FriendItem[] = (profiles || [])
        .map((p: { id: string; username?: string; avatar_url?: string }) => ({
          id: p.id,
          name: getDisplayName(p, "Unknown"),
          username: p.username,
          avatar: p.avatar_url,
        }))
        .filter((f: FriendItem) => !existingParticipantIds.includes(f.id));

      setAvailableFriends(transformed);
    } catch (err) {
      console.error("[InlineInviteFriendsList] loadFriends error:", err);
    } finally {
      setLoadingFriends(false);
    }
  }, [user?.id, existingParticipantIds]);

  // Load on mount (accordion expanded)
  useEffect(() => {
    setSelectedFriends([]);
    setSearchQuery("");
    loadFriendsFromDB();
  }, [loadFriendsFromDB]);

  const displayList = searchQuery.trim()
    ? availableFriends.filter(
        (f) =>
          f.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          (f.username &&
            f.username.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      )
    : availableFriends;

  const toggleFriendSelection = (friend: FriendItem): void => {
    setSelectedFriends((prev) => {
      const isSelected = prev.some((f) => f.id === friend.id);
      if (isSelected) {
        return prev.filter((f) => f.id !== friend.id);
      }
      return [...prev, friend];
    });
  };

  const handleSendInvites = useCallback(async (): Promise<void> => {
    if (!user?.id || !sessionId || selectedFriends.length === 0) return;

    // ORCH-0666: Refactored to delegate to `addFriendsToSessions`. The previous
    // inline triplet (insert participant + insert invite + invoke push edge fn)
    // is now atomic via the `add_friend_to_session` SECURITY DEFINER RPC. The
    // service emits Mixpanel + AppsFlyer telemetry single-owner.
    setSending(true);
    try {
      let successCount = 0;

      for (const friend of selectedFriends) {
        const { results } = await addFriendsToSessions({
          sessionIds: [sessionId],
          friendUserId: friend.id,
          sessionNames: { [sessionId]: sessionName },
        });
        if (results[0]?.outcome === "invited") successCount++;
      }

      if (successCount > 0) {
        Alert.alert(
          t("board:inlineInviteFriendsList.invitesSent"),
          t("board:inlineInviteFriendsList.invitesSentMsg", {
            count: successCount,
            plural: successCount > 1 ? "s" : "",
            name: sessionName,
          })
        );
        setSelectedFriends([]);
        onInvitesSent?.();
      } else {
        Alert.alert(
          t("board:inlineInviteFriendsList.error"),
          t("board:inlineInviteFriendsList.errorSendInvites")
        );
      }
    } catch (err) {
      console.error("[InlineInviteFriendsList] Error sending invites:", err);
      Alert.alert(
        t("board:inlineInviteFriendsList.error"),
        t("board:inlineInviteFriendsList.errorSendInvites")
      );
    } finally {
      setSending(false);
    }
  }, [user?.id, sessionId, sessionName, selectedFriends, onInvitesSent, t]);

  const getInitials = (name: string): string => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={16} color="#9ca3af" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={t("board:inlineInviteFriendsList.searchPlaceholder")}
          placeholderTextColor="#9ca3af"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          accessibilityLabel={t("board:inlineInviteFriendsList.searchPlaceholder")}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Icon name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>

      {/* Friends list */}
      <View style={styles.friendsList}>
        {loadingFriends ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#eb7825" />
            <Text style={styles.loadingText}>Loading friends...</Text>
          </View>
        ) : displayList.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="users" size={28} color="#9ca3af" />
            <Text style={styles.emptyStateTitle}>
              {searchQuery
                ? t("board:inlineInviteFriendsList.noUsersFound")
                : availableFriends.length === 0
                ? t("board:inlineInviteFriendsList.allFriendsInBoard")
                : t("board:inlineInviteFriendsList.noFriendsAvailable")}
            </Text>
            <Text style={styles.emptyStateText}>
              {searchQuery
                ? t("board:inlineInviteFriendsList.tryDifferentName")
                : t("board:inlineInviteFriendsList.addMoreFriends")}
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.friendsScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {displayList.map((friend) => {
              const isSelected = selectedFriends.some((f) => f.id === friend.id);
              return (
                <TouchableOpacity
                  key={friend.id}
                  style={[styles.friendItem, isSelected && styles.friendItemSelected]}
                  onPress={() => toggleFriendSelection(friend)}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={friend.name}
                >
                  <View style={styles.friendAvatar}>
                    {friend.avatar ? (
                      <Image source={{ uri: friend.avatar }} style={styles.friendAvatarImage} />
                    ) : (
                      <Text style={styles.friendAvatarText}>{getInitials(friend.name)}</Text>
                    )}
                  </View>
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{friend.name}</Text>
                  </View>
                  {isSelected && (
                    <View style={styles.friendCheckmark}>
                      <Icon name="checkmark" size={14} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Send button */}
      {selectedFriends.length > 0 && (
        <TouchableOpacity
          style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          onPress={handleSendInvites}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={t("board:inlineInviteFriendsList.sendInvites", { count: selectedFriends.length })}
        >
          {sending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Icon name="send" size={16} color="white" />
              <Text style={styles.sendButtonText}>
                {t("board:inlineInviteFriendsList.sendInvites", { count: selectedFriends.length })}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    gap: 10,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
    paddingVertical: 0,
  },
  friendsList: {
    maxHeight: 240,
  },
  friendsScroll: {
    maxHeight: 240,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 6,
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    textAlign: "center",
  },
  emptyStateText: {
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  friendItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 10,
    padding: 10,
    gap: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  friendItemSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb782533",
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  friendAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  friendAvatarText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  friendCheckmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    flexDirection: "row",
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  sendButtonDisabled: {
    backgroundColor: "#d1d5db",
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
});

export default InlineInviteFriendsList;
