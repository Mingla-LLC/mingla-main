import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { supabase } from "../../services/supabase";
import { useAppStore } from "../../store/appStore";
import { colors } from "../../constants/colors";
import { truncateString } from "../../utils/general";

export interface Participant {
  id?: string;
  user_id: string;
  session_id: string;
  joined_at?: string;
  has_accepted?: boolean;
  is_admin?: boolean;
  profiles?: {
    id: string;
    username?: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
}

interface ManageBoardModalProps {
  visible: boolean;
  sessionId: string;
  sessionName: string;
  sessionCreatorId?: string;
  participants?: Participant[];
  onClose: () => void;
  onExitBoard?: () => void;
  onParticipantsChange?: () => void;
}

export const ManageBoardModal: React.FC<ManageBoardModalProps> = ({
  visible,
  sessionId,
  sessionName,
  sessionCreatorId,
  participants: externalParticipants,
  onClose,
  onExitBoard,
  onParticipantsChange,
}) => {
  const { user } = useAppStore();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<{ userId: string; displayName: string } | null>(null);
  const [memberToToggleAdmin, setMemberToToggleAdmin] = useState<{ userId: string; displayName: string; isCurrentlyAdmin: boolean } | null>(null);
  const [adminUsers, setAdminUsers] = useState<Set<string>>(new Set());
  const [creatorId, setCreatorId] = useState<string | undefined>(sessionCreatorId);

  // Load participants if not provided externally
  const loadParticipants = useCallback(async () => {
    if (!sessionId) return;
    
    // Use external participants if provided
    if (externalParticipants && externalParticipants.length > 0) {
      setParticipants(externalParticipants);
      // Also extract admin users from external participants
      const admins = externalParticipants
        .filter(p => p.is_admin)
        .map(p => p.user_id);
      setAdminUsers(new Set(admins));
      return;
    }

    setLoadingParticipants(true);
    try {
      const { data, error } = await supabase
        .from("session_participants")
        .select(`
          *,
          profiles (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq("session_id", sessionId)
        .eq("has_accepted", true);

      if (error) throw error;
      
      const participantData = (data || []) as Participant[];
      setParticipants(participantData);
      
      // Extract admin users from the fetched data
      const admins = participantData
        .filter(p => p.is_admin)
        .map(p => p.user_id);
      setAdminUsers(new Set(admins));
    } catch (err: any) {
      console.error("Error loading participants:", err);
    } finally {
      setLoadingParticipants(false);
    }
  }, [sessionId, externalParticipants]);

  // Load session creator if not provided
  const loadSessionCreator = useCallback(async () => {
    if (sessionCreatorId) {
      setCreatorId(sessionCreatorId);
      return;
    }

    if (!sessionId) return;

    try {
      const { data, error } = await supabase
        .from("collaboration_sessions")
        .select("created_by")
        .eq("id", sessionId)
        .single();

      if (error) throw error;
      setCreatorId(data?.created_by);
    } catch (err: any) {
      console.error("Error loading session creator:", err);
    }
  }, [sessionId, sessionCreatorId]);

  useEffect(() => {
    if (visible) {
      loadParticipants();
      loadSessionCreator();
    }
  }, [visible, loadParticipants, loadSessionCreator]);

  // Update participants when external data changes
  useEffect(() => {
    if (externalParticipants && externalParticipants.length > 0) {
      setParticipants(externalParticipants);
    }
  }, [externalParticipants]);

  const isAdmin = user?.id === creatorId || adminUsers.has(user?.id || "");

  // Handle removing a member from the board
  const handleRemoveMember = useCallback(
    (memberUserId: string, memberDisplayName: string) => {
      if (!user?.id || !sessionId) return;

      // Check if current user has permission to remove members
      const canRemove = isAdmin || creatorId === user.id;
      if (!canRemove) {
        Alert.alert(
          "Permission Denied",
          "Only admins can remove members from this board."
        );
        return;
      }

      // Prevent removing the session creator
      if (memberUserId === creatorId) {
        Alert.alert(
          "Cannot Remove",
          "The board creator cannot be removed. They can only leave the board themselves."
        );
        return;
      }

      // Prevent removing yourself - use exit board instead
      if (memberUserId === user.id) {
        Alert.alert(
          "Cannot Remove Yourself",
          "Use the 'Leave Board' option to remove yourself from this board."
        );
        return;
      }

      setMemberToRemove({ userId: memberUserId, displayName: memberDisplayName });
    },
    [user?.id, sessionId, isAdmin, creatorId]
  );

  // Confirm remove member action
  const confirmRemoveMember = useCallback(async () => {
    if (!memberToRemove || !sessionId) return;

    try {
      // Optimistic update - remove from local state immediately
      setParticipants((prev) =>
        prev.filter((p) => p.user_id !== memberToRemove.userId)
      );

      // Delete from database
      const { error } = await supabase
        .from("session_participants")
        .delete()
        .eq("session_id", sessionId)
        .eq("user_id", memberToRemove.userId);

      if (error) {
        // Rollback optimistic update on error
        loadParticipants();
        throw error;
      }

      // Clear the confirmation state
      setMemberToRemove(null);

      // Notify parent of changes
      onParticipantsChange?.();

      // Show success message
      Alert.alert(
        "Member Removed",
        `${memberToRemove.displayName} has been removed from the board.`
      );
    } catch (err: any) {
      console.error("Error removing member:", err);
      Alert.alert(
        "Error",
        err?.message || "Failed to remove member. Please try again."
      );
    }
  }, [memberToRemove, sessionId, loadParticipants, onParticipantsChange]);

  // Handle toggling admin status
  const handleToggleAdmin = useCallback(
    async (memberUserId: string, memberDisplayName: string, isCurrentlyAdmin: boolean) => {
      if (!user?.id || !sessionId) return;

      // Check if current user has permission to manage admins
      const canManageAdmins = creatorId === user.id;
      if (!canManageAdmins) {
        Alert.alert(
          "Permission Denied",
          "Only the board creator can manage admin privileges."
        );
        return;
      }

      // Cannot change creator's admin status
      if (memberUserId === creatorId) {
        Alert.alert(
          "Cannot Modify",
          "The board creator's admin status cannot be changed."
        );
        return;
      }

      if (isCurrentlyAdmin) {
        // Show confirmation to remove admin
        setMemberToToggleAdmin({ userId: memberUserId, displayName: memberDisplayName, isCurrentlyAdmin: true });
      } else {
        // Promote to admin - persist to database
        try {
          const { error } = await supabase
            .from("session_participants")
            .update({ is_admin: true })
            .eq("session_id", sessionId)
            .eq("user_id", memberUserId);

          if (error) throw error;

          // Update local state
          setAdminUsers((prev) => new Set([...prev, memberUserId]));
          
          // Update participants array to reflect change
          setParticipants((prev) =>
            prev.map((p) =>
              p.user_id === memberUserId ? { ...p, is_admin: true } : p
            )
          );

          // Notify parent of changes
          onParticipantsChange?.();
        } catch (err: any) {
          console.error("Error promoting member to admin:", err);
          Alert.alert(
            "Error",
            err?.message || "Failed to promote member to admin. Please try again."
          );
        }
      }
    },
    [user?.id, sessionId, creatorId, onParticipantsChange]
  );

  // Confirm remove admin action
  const confirmRemoveAdmin = useCallback(async () => {
    if (!memberToToggleAdmin || !sessionId) return;

    try {
      // Persist to database
      const { error } = await supabase
        .from("session_participants")
        .update({ is_admin: false })
        .eq("session_id", sessionId)
        .eq("user_id", memberToToggleAdmin.userId);

      if (error) throw error;

      // Remove from admin set
      setAdminUsers((prev) => {
        const newSet = new Set(prev);
        newSet.delete(memberToToggleAdmin.userId);
        return newSet;
      });

      // Update participants array to reflect change
      setParticipants((prev) =>
        prev.map((p) =>
          p.user_id === memberToToggleAdmin.userId ? { ...p, is_admin: false } : p
        )
      );

      // Clear the confirmation state
      setMemberToToggleAdmin(null);

      // Notify parent of changes
      onParticipantsChange?.();
    } catch (err: any) {
      console.error("Error removing admin privileges:", err);
      Alert.alert(
        "Error",
        err?.message || "Failed to remove admin privileges. Please try again."
      );
    }
  }, [memberToToggleAdmin, sessionId, onParticipantsChange]);

  const handleClose = () => {
    setMemberToRemove(null);
    setMemberToToggleAdmin(null);
    onClose();
  };

  const handleLeaveBoard = () => {
    handleClose();
    onExitBoard?.();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Manage Board</Text>
              <Text style={styles.subtitle}>{sessionName || "Board"}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClose}
            >
              <Feather name="x" size={24} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Members Section */}
          <View style={styles.membersSectionContainer}>
            <Text style={styles.membersSectionTitle}>Members</Text>
            <ScrollView style={styles.membersScrollView} showsVerticalScrollIndicator={true}>
              {participants.map((participant) => {
                const profile = participant.profiles;
                const isCurrentUser = participant.user_id === user?.id;
                const originalDisplayName = profile?.display_name || profile?.first_name || profile?.username || "Unknown";
                const displayName = isCurrentUser ? "You" : originalDisplayName;
                const isOnline = true; // TODO: Implement actual online status check
                const isCreator = participant.user_id === creatorId;
                const isParticipantAdmin = isCreator || adminUsers.has(participant.user_id);
                
                return (
                  <View key={participant.user_id || participant.id} style={styles.memberCard}>
                    <View style={styles.memberCardLeft}>
                      <View style={styles.memberAvatarPlaceholder}>
                        <Text style={styles.memberAvatarText}>
                          {originalDisplayName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.memberInfo}>
                        <View style={styles.memberNameRow}>
                          <Text style={styles.memberName}>{truncateString(displayName, 10)}</Text>
                          {isCreator && (
                            <View style={styles.creatorBadge}>
                              <MaterialCommunityIcons name="crown-outline" size={12} color="white" />
                              <Text style={styles.creatorBadgeText}>Creator</Text>
                            </View>
                          )}
                          {!isCreator && isParticipantAdmin && (
                            <View style={styles.adminBadge}>
                              <Feather name="shield" size={10} color="white" />
                              <Text style={styles.adminBadgeText}>Admin</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.memberStatusRow}>
                          <View style={[styles.onlineIndicator, isOnline ? styles.online : styles.offline]} />
                          <Text style={styles.memberStatus}>
                            {isOnline ? "Online" : "Offline"}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.memberActions}>
                      {isAdmin && !isCreator && !isCurrentUser && (
                        <TouchableOpacity
                          style={[
                            styles.memberActionButton,
                            isParticipantAdmin && styles.memberActionButtonActive
                          ]}
                          onPress={() => handleToggleAdmin(participant.user_id, originalDisplayName, isParticipantAdmin)}
                        >
                          <Feather 
                            name="shield" 
                            size={18} 
                            color={isParticipantAdmin ? "#eb7825" : "#9CA3AF"} 
                          />
                        </TouchableOpacity>
                      )}
                      {isAdmin && !isCreator && !isCurrentUser && (
                        <TouchableOpacity
                          style={styles.memberActionButton}
                          onPress={() => handleRemoveMember(participant.user_id, originalDisplayName)}
                        >
                          <Feather name="user-minus" size={18} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          {/* Board Info Section */}
          <View style={styles.boardInfoSection}>
            <Text style={styles.boardInfoTitle}>Board Info</Text>
            <View style={styles.boardInfoRow}>
              <Text style={styles.boardInfoLabel}>Total members:</Text>
              <Text style={styles.boardInfoValue}>{participants.length}</Text>
            </View>
            <View style={styles.boardInfoRow}>
              <Text style={styles.boardInfoLabel}>Admins:</Text>
              <Text style={styles.boardInfoValue}>
                {(creatorId ? 1 : 0) + adminUsers.size}
              </Text>
            </View>
            <View style={styles.boardWarning}>
              <Text style={styles.boardWarningText}>
                Board will be deleted if all members leave
              </Text>
            </View>
          </View>

          {/* Confirmation Section or Leave Board Button */}
          {memberToRemove ? (
            <View style={styles.confirmationSection}>
              <Text style={styles.confirmationText}>
                Remove <Text style={styles.confirmationHighlight}>{memberToRemove.displayName}</Text> from this board?
              </Text>
              <View style={styles.confirmationButtons}>
                <TouchableOpacity
                  style={styles.confirmationButtonRemove}
                  onPress={confirmRemoveMember}
                >
                  <Text style={styles.confirmationButtonRemoveText}>Remove member</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmationButtonCancel}
                  onPress={() => setMemberToRemove(null)}
                >
                  <Text style={styles.confirmationButtonCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : memberToToggleAdmin ? (
            <View style={styles.confirmationSection}>
              <Text style={styles.confirmationText}>
                Remove admin privileges from <Text style={styles.confirmationHighlight}>{memberToToggleAdmin.displayName}</Text>?
              </Text>
              <View style={styles.confirmationButtons}>
                <TouchableOpacity
                  style={styles.confirmationButtonRemove}
                  onPress={confirmRemoveAdmin}
                >
                  <Text style={styles.confirmationButtonRemoveText}>Remove admin</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmationButtonCancel}
                  onPress={() => setMemberToToggleAdmin(null)}
                >
                  <Text style={styles.confirmationButtonCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.leaveBoardButton}
              onPress={handleLeaveBoard}
            >
              <Feather name="user-minus" size={20} color="#EF4444" />
              <Text style={styles.leaveBoardButtonText}>Leave Board</Text>
            </TouchableOpacity>
          )}
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
    padding: 20,
  },
  modal: {
    backgroundColor: "white",
    borderRadius: 16,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    fontSize: 14,
    color: "#6B7280",
    marginTop: 4,
  },
  closeButton: {
    padding: 4,
  },
  membersSectionContainer: {
    marginBottom: 20,
  },
  membersSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
  },
  membersScrollView: {
    maxHeight: 200,
  },
  memberCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    marginBottom: 8,
  },
  memberCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  memberAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  memberInfo: {
    marginLeft: 12,
    flex: 1,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  creatorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  creatorBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "white",
  },
  adminBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#6B7280",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  adminBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "white",
  },
  memberStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  onlineIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  online: {
    backgroundColor: "#22C55E",
  },
  offline: {
    backgroundColor: "#9CA3AF",
  },
  memberStatus: {
    fontSize: 12,
    color: "#6B7280",
  },
  memberActions: {
    flexDirection: "row",
    gap: 8,
  },
  memberActionButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  memberActionButtonActive: {
    backgroundColor: "#FEF3C7",
  },
  boardInfoSection: {
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#FDBA74",
  },
  boardInfoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#EA580C",
    marginBottom: 12,
  },
  boardInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  boardInfoLabel: {
    fontSize: 14,
    color: "#9A3412",
  },
  boardInfoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#9A3412",
  },
  boardWarning: {
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  boardWarningText: {
    fontSize: 13,
    color: "#DC2626",
    textAlign: "center",
    fontWeight: "500",
  },
  confirmationSection: {
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FDBA74",
  },
  confirmationText: {
    fontSize: 14,
    fontWeight: "400",
    color: "#F97316",
    textAlign: "center",
    marginBottom: 16,
  },
  confirmationHighlight: {
    fontWeight: "700",
    color: "#EA580C",
  },
  confirmationButtons: {
    flexDirection: "row",
    gap: 10,
  },
  confirmationButtonRemove: {
    flex: 1,
    backgroundColor: "#EF4444",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  confirmationButtonRemoveText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
  confirmationButtonCancel: {
    flex: 1,
    backgroundColor: "#9CA3AF",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  confirmationButtonCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  leaveBoardButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#EF4444",
    backgroundColor: "white",
  },
  leaveBoardButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#EF4444",
  },
});

export default ManageBoardModal;
