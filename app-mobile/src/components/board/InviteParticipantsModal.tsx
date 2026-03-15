import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import { supabase } from "../../services/supabase";
import { useAppStore } from "../../store/appStore";
import { mixpanelService } from "../../services/mixpanelService";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '../../hooks/useKeyboard';

interface FriendItem {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
}

interface InviteParticipantsModalProps {
  visible: boolean;
  sessionId: string;
  sessionName: string;
  existingParticipantIds: string[];
  onClose: () => void;
  onInvitesSent?: () => void;
}

export const InviteParticipantsModal: React.FC<InviteParticipantsModalProps> = ({
  visible,
  sessionId,
  sessionName,
  existingParticipantIds,
  onClose,
  onInvitesSent,
}) => {
  const { user } = useAppStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<FriendItem[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [availableFriends, setAvailableFriends] = useState<FriendItem[]>([]);
  const insets = useSafeAreaInsets();
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });

  // Load friends directly from DB when modal opens
  useEffect(() => {
    if (visible) {
      setSelectedFriends([]);
      setSearchQuery("");
      loadFriendsFromDB();
    }
  }, [visible]);

  const loadFriendsFromDB = async () => {
    if (!user?.id) return;
    setLoadingFriends(true);

    try {
      // Query friends table directly
      const { data: rawFriends, error: friendsError } = await supabase
        .from("friends")
        .select("*")
        .eq("status", "accepted")
        .or(`user_id.eq.${user.id},friend_user_id.eq.${user.id}`);

      if (friendsError) throw friendsError;

      // Normalize so friend_user_id always points to the OTHER user
      const friendUserIds = (rawFriends || []).map((f: any) =>
        f.user_id === user.id ? f.friend_user_id : f.user_id
      );

      // Remove duplicates
      const uniqueIds = [...new Set(friendUserIds)];

      if (uniqueIds.length === 0) {
        setAvailableFriends([]);
        setLoadingFriends(false);
        return;
      }

      // Batch-fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, first_name, last_name, display_name, avatar_url")
        .in("id", uniqueIds);

      if (profilesError) throw profilesError;

      const transformed: FriendItem[] = (profiles || [])
        .map((p: any) => ({
          id: p.id,
          name:
            (p.first_name && p.last_name
              ? `${p.first_name} ${p.last_name}`
              : null) ||
            p.display_name ||
            p.first_name ||
            p.username ||
            "Unknown",
          username: p.username,
          avatar: p.avatar_url,
        }))
        .filter((f: FriendItem) => !existingParticipantIds.includes(f.id));

      setAvailableFriends(transformed);
    } catch (err) {
      console.error("Error loading friends:", err);
    } finally {
      setLoadingFriends(false);
    }
  };

  // Filter friends locally by search query (instant, no DB call needed)
  const displayList = searchQuery.trim()
    ? availableFriends.filter(
        (f) =>
          f.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          (f.username &&
            f.username.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      )
    : availableFriends;

  const toggleFriendSelection = (friend: FriendItem) => {
    setSelectedFriends((prev) => {
      const isSelected = prev.some((f) => f.id === friend.id);
      if (isSelected) {
        return prev.filter((f) => f.id !== friend.id);
      }
      return [...prev, friend];
    });
  };

  const handleSendInvites = useCallback(async () => {
    if (!user?.id || !sessionId || selectedFriends.length === 0) return;

    setSending(true);
    try {
      let successCount = 0;

      for (const friend of selectedFriends) {
        // Get friend's email for notification
        const { data: friendProfile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", friend.id)
          .single();

        // Add as participant (not accepted yet)
        const { error: participantError } = await supabase
          .from("session_participants")
          .insert({
            session_id: sessionId,
            user_id: friend.id,
            has_accepted: false,
          });

        if (participantError) {
          console.error(
            `Error adding ${friend.name} as participant:`,
            participantError
          );
          continue;
        }

        // Create invite
        const { data: inviteData, error: inviteError } = await supabase
          .from("collaboration_invites")
          .insert({
            session_id: sessionId,
            inviter_id: user.id,
            invited_user_id: friend.id,
            status: "pending",
          })
          .select("id")
          .single();

        if (inviteError) {
          console.error(
            `Error creating invite for ${friend.name}:`,
            inviteError
          );
          continue;
        }

        // Send notification via Edge Function
        const friendEmail = friendProfile?.email;
        if (friendEmail && inviteData) {
          try {
            await supabase.functions.invoke("send-collaboration-invite", {
              body: {
                inviterId: user.id,
                invitedUserId: friend.id,
                invitedUserEmail: friendEmail,
                sessionId: sessionId,
                sessionName: sessionName,
                inviteId: inviteData.id,
              },
            });
          } catch (emailErr) {
            console.error(
              `Failed to send invite notification to ${friend.name}:`,
              emailErr
            );
          }
        }

        successCount++;
      }

      if (successCount > 0) {
        mixpanelService.trackCollaborationInvitesSent({
          sessionId,
          sessionName,
          invitedCount: selectedFriends.length,
          successCount,
        });
        Alert.alert(
          "Invites Sent",
          `Successfully invited ${successCount} friend${successCount > 1 ? "s" : ""} to "${sessionName}".`
        );
        onInvitesSent?.();
      } else {
        Alert.alert("Error", "Failed to send invites. Please try again.");
      }

      onClose();
    } catch (err: any) {
      console.error("Error sending invites:", err);
      Alert.alert("Error", "Failed to send invites. Please try again.");
    } finally {
      setSending(false);
    }
  }, [user?.id, sessionId, sessionName, selectedFriends, onClose, onInvitesSent]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View style={styles.headerIcon}>
                <Feather name="user-plus" size={18} color="white" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Invite Participants</Text>
                <Text style={styles.headerSubtitle}>
                  Add friends to "{sessionName}"
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Feather
              name="search"
              size={16}
              color="#9ca3af"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search friends..."
              placeholderTextColor="#9ca3af"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={18} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>

          {/* Selected Friends Tags */}
          {selectedFriends.length > 0 && (
            <View style={styles.selectedContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedScroll}
              >
                {selectedFriends.map((friend) => (
                  <View key={friend.id} style={styles.selectedTag}>
                    <View style={styles.selectedTagAvatar}>
                      {friend.avatar ? (
                        <Image
                          source={{ uri: friend.avatar }}
                          style={styles.selectedTagAvatarImage}
                        />
                      ) : (
                        <Text style={styles.selectedTagAvatarText}>
                          {friend.name[0]}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.selectedTagName} numberOfLines={1}>
                      {friend.name}
                    </Text>
                    <TouchableOpacity
                      onPress={() => toggleFriendSelection(friend)}
                      style={styles.selectedTagRemove}
                    >
                      <Ionicons name="close" size={12} color="#6B7280" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Friends List */}
          <ScrollView
            style={styles.friendsList}
            contentContainerStyle={styles.friendsListContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {loadingFriends ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#eb7825" />
                <Text style={styles.loadingText}>Loading friends...</Text>
              </View>
            ) : displayList.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="users" size={32} color="#9ca3af" />
                <Text style={styles.emptyStateTitle}>
                  {searchQuery
                    ? "No users found"
                    : availableFriends.length === 0
                    ? "All friends are already in this board"
                    : "No friends available"}
                </Text>
                <Text style={styles.emptyStateText}>
                  {searchQuery
                    ? "Try a different name or username"
                    : "Add more friends to invite them"}
                </Text>
              </View>
            ) : (
              displayList.map((friend) => {
                const isSelected = selectedFriends.some(
                  (f) => f.id === friend.id
                );
                return (
                  <TouchableOpacity
                    key={friend.id}
                    style={[
                      styles.friendItem,
                      isSelected && styles.friendItemSelected,
                    ]}
                    onPress={() => toggleFriendSelection(friend)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.friendAvatar}>
                      {friend.avatar ? (
                        <Image
                          source={{ uri: friend.avatar }}
                          style={styles.friendAvatarImage}
                        />
                      ) : (
                        <Text style={styles.friendAvatarText}>
                          {getInitials(friend.name)}
                        </Text>
                      )}
                    </View>
                    <View style={styles.friendInfo}>
                      <Text style={styles.friendName}>{friend.name}</Text>
                    </View>
                    {isSelected && (
                      <View style={styles.friendCheckmark}>
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color="#FFFFFF"
                        />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
            <View style={{ height: keyboardHeight > 0 ? keyboardHeight : 0 }} />
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.sendButton,
                selectedFriends.length === 0 && styles.sendButtonDisabled,
              ]}
              onPress={handleSendInvites}
              disabled={selectedFriends.length === 0 || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Feather name="send" size={16} color="white" />
                  <Text style={styles.sendButtonText}>
                    Invite{" "}
                    {selectedFriends.length > 0
                      ? `(${selectedFriends.length})`
                      : ""}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modal: {
    backgroundColor: "white",
    borderRadius: 16,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  headerIcon: {
    width: 36,
    height: 36,
    backgroundColor: "#eb7825",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#111827",
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 1,
  },
  closeButton: {
    padding: 8,
    borderRadius: 12,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 12,
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
  selectedContainer: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  selectedScroll: {
    gap: 8,
  },
  selectedTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderRadius: 20,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: "#eb782533",
    gap: 6,
  },
  selectedTagAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedTagAvatarImage: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  selectedTagAvatarText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  selectedTagName: {
    fontSize: 13,
    fontWeight: "500",
    color: "#374151",
    maxWidth: 80,
  },
  selectedTagRemove: {
    padding: 2,
  },
  friendsList: {
    flex: 1,
    maxHeight: 300,
    backgroundColor: "#f9fafb",
  },
  friendsListContent: {
    padding: 12,
    gap: 6,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#374151",
  },
  emptyStateText: {
    fontSize: 13,
    color: "#9ca3af",
  },
  friendItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 10,
    padding: 10,
    gap: 10,
  },
  friendItemSelected: {
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#eb782533",
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  friendAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  friendAvatarText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#111827",
  },
  friendUsername: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 1,
  },
  friendCheckmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    padding: 16,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#374151",
  },
  sendButton: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 12,
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
    fontSize: 15,
    fontWeight: "600",
    color: "white",
  },
});
