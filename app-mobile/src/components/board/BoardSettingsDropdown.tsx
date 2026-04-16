import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { Icon } from "../ui/Icon";
import { supabase } from "../../services/supabase";
import { useTranslation } from "react-i18next";
import { getDisplayName } from "../../utils/getDisplayName";
import { truncateString } from "../../utils/general";
import { notifyMemberLeft, notifySessionDeleted } from "../../services/boardNotificationService";
import { colors } from "../../constants/colors";

interface Participant {
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

interface BoardSettingsDropdownProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  sessionName: string;
  sessionCreatorId?: string;
  currentUserId?: string;
  isAdmin?: boolean;
  notificationsEnabled?: boolean;
  participants?: Participant[];
  onToggleNotifications?: () => void;
  onInviteParticipants?: () => void;
  onExitBoard?: () => void;
  onSessionDeleted?: () => void;
  onSessionNameUpdated?: (newName: string) => void;
  onParticipantsChange?: () => void;
}

export const BoardSettingsDropdown: React.FC<BoardSettingsDropdownProps> = ({
  visible,
  onClose,
  sessionId,
  sessionName,
  sessionCreatorId,
  currentUserId,
  isAdmin = false,
  notificationsEnabled = true,
  participants = [],
  onToggleNotifications,
  onInviteParticipants,
  onExitBoard,
  onSessionDeleted,
  onSessionNameUpdated,
  onParticipantsChange,
}) => {
  const { t } = useTranslation(["board", "common"]);
  const [editSessionName, setEditSessionName] = useState(sessionName);
  const [savingName, setSavingName] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [exitingBoard, setExitingBoard] = useState(false);
  const [adminUsers, setAdminUsers] = useState<Set<string>>(new Set());
  const nameInputRef = useRef<TextInput>(null);

  // Sync admin users from participants
  useEffect(() => {
    if (participants.length > 0) {
      const admins = participants
        .filter((p) => p.is_admin)
        .map((p) => p.user_id);
      setAdminUsers(new Set(admins));
    }
  }, [participants]);

  // Sync local name when sheet opens or sessionName changes
  useEffect(() => {
    setEditSessionName(sessionName);
  }, [sessionName, visible]);

  const canManageSession =
    currentUserId &&
    (sessionCreatorId === currentUserId || isAdmin);

  const isUserAdmin =
    currentUserId === sessionCreatorId || adminUsers.has(currentUserId || "");

  // --- Handlers: Board actions ---

  const handleExitBoardWithRules = useCallback(async () => {
    if (exitingBoard) return;
    try {
      setExitingBoard(true);
      onClose();
      if (onExitBoard) {
        await Promise.resolve(onExitBoard());
      }
    } catch (error: any) {
      console.error("Error exiting board:", error);
      Alert.alert(
        t("board:boardSettingsDropdown.errorGeneric"),
        error?.message || t("board:boardSettingsDropdown.errorLeave")
      );
    } finally {
      setExitingBoard(false);
    }
  }, [exitingBoard, onClose, onExitBoard, t]);

  const handleLeaveBoard = useCallback(() => {
    Alert.alert(
      "Leave Board",
      `Are you sure you want to leave "${sessionName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: handleExitBoardWithRules,
        },
      ]
    );
  }, [sessionName, handleExitBoardWithRules]);

  const handleDeleteSession = useCallback(async () => {
    if (deletingSession) return;
    if (!sessionId || !currentUserId) return;
    try {
      setDeletingSession(true);

      // Notify participants BEFORE delete (they still exist in DB)
      notifySessionDeleted({
        sessionId,
        sessionName: sessionName || "Session",
        userId: currentUserId,
        userName: getDisplayName(
          participants.find((p) => p.user_id === currentUserId)?.profiles,
          "Someone"
        ),
      });

      const { error } = await supabase
        .from("collaboration_sessions")
        .delete()
        .eq("id", sessionId);
      if (error) throw error;

      if (onSessionDeleted) onSessionDeleted();
    } catch (error: any) {
      console.error("Error deleting session:", error);
      Alert.alert(
        t("board:boardSettingsDropdown.deleteFailed"),
        error?.message || t("board:boardSettingsDropdown.deleteFailedMsg")
      );
    } finally {
      setDeletingSession(false);
    }
  }, [deletingSession, sessionId, currentUserId, sessionName, participants, onSessionDeleted, t]);

  const handleDeleteSessionWithConfirmation = useCallback(() => {
    onClose();
    Alert.alert(
      t("board:boardSettingsDropdown.deleteSessionTitle"),
      t("board:boardSettingsDropdown.deleteSessionMsg", { name: sessionName }),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("common:delete"),
          style: "destructive",
          onPress: handleDeleteSession,
        },
      ]
    );
  }, [sessionName, onClose, handleDeleteSession, t]);

  // --- Handlers: Inline name save ---

  const handleSaveName = useCallback(async () => {
    const trimmed = editSessionName.trim();
    // No change or empty — revert silently
    if (!trimmed || trimmed === sessionName) {
      setEditSessionName(sessionName);
      return;
    }
    if (!sessionId) return;
    try {
      setSavingName(true);
      const { error } = await supabase
        .from("collaboration_sessions")
        .update({ name: trimmed })
        .eq("id", sessionId);
      if (error) throw error;
      if (onSessionNameUpdated) onSessionNameUpdated(trimmed);
    } catch (error: any) {
      console.error("Error updating session name:", error);
      setEditSessionName(sessionName); // revert on failure
      Alert.alert(
        t("board:boardSettingsDropdown.updateFailed"),
        error?.message || t("board:boardSettingsDropdown.updateFailedMsg")
      );
    } finally {
      setSavingName(false);
    }
  }, [sessionId, editSessionName, sessionName, onSessionNameUpdated, t]);

  // --- Handlers: Member management ---

  const handleToggleAdmin = useCallback(
    async (memberUserId: string, memberDisplayName: string, isCurrentlyAdmin: boolean) => {
      if (!currentUserId || !sessionId) return;

      if (memberUserId === sessionCreatorId) {
        Alert.alert(
          t("board:manageBoardModal.cannotModifyCreator"),
          t("board:manageBoardModal.cannotModifyCreatorMsg")
        );
        return;
      }

      if (isCurrentlyAdmin) {
        Alert.alert(
          "Remove Admin",
          `Remove admin privileges from ${memberDisplayName}?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: async () => {
                try {
                  const { error } = await supabase
                    .from("session_participants")
                    .update({ is_admin: false })
                    .eq("session_id", sessionId)
                    .eq("user_id", memberUserId);
                  if (error) throw error;
                  setAdminUsers((prev) => {
                    const s = new Set(prev);
                    s.delete(memberUserId);
                    return s;
                  });
                  onParticipantsChange?.();
                } catch (err: any) {
                  console.error("Error demoting member:", err);
                  Alert.alert("Error", err?.message || "Could not remove admin privileges.");
                }
              },
            },
          ]
        );
      } else {
        try {
          const { error } = await supabase
            .from("session_participants")
            .update({ is_admin: true })
            .eq("session_id", sessionId)
            .eq("user_id", memberUserId);
          if (error) throw error;
          setAdminUsers((prev) => new Set([...prev, memberUserId]));
          onParticipantsChange?.();
        } catch (err: any) {
          console.error("Error promoting member:", err);
          Alert.alert("Error", err?.message || "Could not promote to admin.");
        }
      }
    },
    [currentUserId, sessionId, sessionCreatorId, onParticipantsChange, t]
  );

  const handleRemoveMember = useCallback(
    (memberUserId: string, memberDisplayName: string) => {
      if (!currentUserId || !sessionId) return;

      if (memberUserId === sessionCreatorId) {
        Alert.alert(
          t("board:manageBoardModal.cannotRemoveCreator"),
          t("board:manageBoardModal.cannotRemoveCreatorMsg")
        );
        return;
      }
      if (memberUserId === currentUserId) {
        Alert.alert(
          t("board:manageBoardModal.cannotRemoveSelf"),
          t("board:manageBoardModal.cannotRemoveSelfMsg")
        );
        return;
      }

      Alert.alert(
        "Remove Member",
        `Remove ${memberDisplayName} from this board?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await supabase
                  .from("collaboration_invites")
                  .delete()
                  .eq("session_id", sessionId)
                  .eq("invited_user_id", memberUserId);

                const { error } = await supabase
                  .from("session_participants")
                  .delete()
                  .eq("session_id", sessionId)
                  .eq("user_id", memberUserId);
                if (error) throw error;

                notifyMemberLeft({
                  sessionId,
                  sessionName: sessionName || "Session",
                  userId: memberUserId,
                  userName: memberDisplayName,
                });

                onParticipantsChange?.();
                Alert.alert("Done", `${memberDisplayName} has been removed.`);
              } catch (err: any) {
                console.error("Error removing member:", err);
                Alert.alert("Error", err?.message || "Could not remove member.");
              }
            },
          },
        ]
      );
    },
    [currentUserId, sessionId, sessionCreatorId, sessionName, onParticipantsChange, t]
  );

  if (!visible) return null;

  return (
    <>
      {/* Bottom Sheet */}
      {visible && (
        <Modal
          visible={visible}
          transparent
          animationType="slide"
          onRequestClose={onClose}
        >
          <Pressable style={styles.sheetOverlay} onPress={onClose}>
            <Pressable style={styles.sheetContainer} onPress={() => {}}>
              {/* Handle */}
              <View style={styles.sheetHandleRow}>
                <View style={styles.sheetHandle} />
              </View>

              {/* Board Name — inline editable */}
              <View style={styles.boardNameRow}>
                {canManageSession ? (
                  <View style={styles.boardNameInputWrapper}>
                    <TextInput
                      ref={nameInputRef}
                      style={styles.boardNameInput}
                      value={editSessionName}
                      onChangeText={setEditSessionName}
                      onBlur={handleSaveName}
                      onSubmitEditing={handleSaveName}
                      returnKeyType="done"
                      maxLength={100}
                      selectTextOnFocus
                    />
                    {savingName && (
                      <ActivityIndicator
                        size="small"
                        color="#eb7825"
                        style={styles.savingIndicator}
                      />
                    )}
                  </View>
                ) : (
                  <Text style={styles.boardNameStatic} numberOfLines={1}>
                    {sessionName}
                  </Text>
                )}
              </View>

              <ScrollView
                style={styles.sheetScroll}
                showsVerticalScrollIndicator={false}
                bounces={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* Settings Menu Items */}
                <View style={styles.menuSection}>
                  {/* Invite Participants - admin only */}
                  {canManageSession && onInviteParticipants && (
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        onInviteParticipants();
                        onClose();
                      }}
                      activeOpacity={0.7}
                    >
                      <Icon name="user-plus" size={18} color="#6B7280" />
                      <Text style={styles.menuItemText}>Invite Participants</Text>
                    </TouchableOpacity>
                  )}

                  {/* Toggle notifications */}
                  {onToggleNotifications && (
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        onToggleNotifications();
                        onClose();
                      }}
                      activeOpacity={0.7}
                    >
                      <Icon
                        name={notificationsEnabled ? "bell-off" : "bell"}
                        size={18}
                        color="#6B7280"
                      />
                      <Text style={styles.menuItemText}>
                        {notificationsEnabled
                          ? "Turn Off Notifications"
                          : "Turn On Notifications"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Divider */}
                <View style={styles.menuDivider} />

                {/* Members Section */}
                <View style={styles.membersSection}>
                  <Text style={styles.membersSectionTitle}>
                    Members ({participants.length})
                  </Text>
                  {participants.map((participant) => {
                    const profile = participant.profiles;
                    const isCurrentUser = participant.user_id === currentUserId;
                    const originalName = getDisplayName(profile, "Unknown");
                    const displayName = isCurrentUser ? "You" : originalName;
                    const isCreator = participant.user_id === sessionCreatorId;
                    const isParticipantAdmin =
                      isCreator || adminUsers.has(participant.user_id);

                    return (
                      <View
                        key={participant.user_id || participant.id}
                        style={styles.memberRow}
                      >
                        <View style={styles.memberLeft}>
                          <View style={styles.memberAvatar}>
                            <Text style={styles.memberAvatarText}>
                              {originalName.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.memberInfo}>
                            <View style={styles.memberNameRow}>
                              <Text style={styles.memberName}>
                                {truncateString(displayName, 15)}
                              </Text>
                              {isCreator && (
                                <View style={styles.creatorBadge}>
                                  <Icon name="crown-outline" size={10} color="white" />
                                  <Text style={styles.badgeText}>Creator</Text>
                                </View>
                              )}
                              {!isCreator && isParticipantAdmin && (
                                <View style={styles.adminBadge}>
                                  <Icon name="shield" size={9} color="white" />
                                  <Text style={styles.badgeText}>Admin</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>

                        {/* Action buttons — admin can manage non-creator, non-self */}
                        {isUserAdmin && !isCreator && !isCurrentUser && (
                          <View style={styles.memberActions}>
                            <TouchableOpacity
                              style={[
                                styles.memberActionBtn,
                                isParticipantAdmin && styles.memberActionBtnActive,
                              ]}
                              onPress={() =>
                                handleToggleAdmin(
                                  participant.user_id,
                                  originalName,
                                  isParticipantAdmin
                                )
                              }
                            >
                              <Icon
                                name="shield"
                                size={16}
                                color={isParticipantAdmin ? "#eb7825" : "#9CA3AF"}
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.memberActionBtn}
                              onPress={() =>
                                handleRemoveMember(participant.user_id, originalName)
                              }
                            >
                              <Icon name="user-minus" size={16} color="#EF4444" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Divider */}
                <View style={styles.menuDivider} />

                {/* Leave & Delete Buttons */}
                <View style={styles.actionButtonsRow}>
                  <TouchableOpacity
                    style={styles.leaveButton}
                    onPress={handleLeaveBoard}
                    activeOpacity={0.8}
                    disabled={exitingBoard}
                  >
                    <Icon name="log-out" size={16} color="#EF4444" />
                    <Text style={styles.leaveButtonText}>
                      {exitingBoard ? "Leaving..." : "Leave"}
                    </Text>
                  </TouchableOpacity>
                  {canManageSession && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={handleDeleteSessionWithConfirmation}
                      activeOpacity={0.8}
                      disabled={deletingSession}
                    >
                      <Icon name="trash-outline" size={16} color="white" />
                      <Text style={styles.deleteButtonText}>
                        {deletingSession ? "Deleting..." : "Delete"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}

    </>
  );
};

const styles = StyleSheet.create({
  // --- Bottom sheet ---
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingBottom: 34,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandleRow: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
  sheetScroll: {
    paddingHorizontal: 4,
  },

  // --- Menu items ---
  menuSection: {
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 15,
    color: "#374151",
    fontWeight: "400",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 6,
    marginHorizontal: 20,
  },

  // --- Members ---
  membersSection: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  membersSectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    marginBottom: 6,
  },
  memberLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  memberAvatarText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
  memberInfo: {
    marginLeft: 10,
    flex: 1,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  creatorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  adminBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#6B7280",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "white",
  },
  memberActions: {
    flexDirection: "row",
    gap: 6,
  },
  memberActionBtn: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  memberActionBtnActive: {
    backgroundColor: "#FEF3C7",
  },

  // --- Action buttons ---
  actionButtonsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  leaveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#EF4444",
    backgroundColor: "white",
  },
  leaveButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#EF4444",
  },
  deleteButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: "#EF4444",
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },

  // --- Board name ---
  boardNameRow: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  boardNameInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1.5,
    borderBottomColor: "#E5E7EB",
  },
  boardNameInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  savingIndicator: {
    marginLeft: 8,
  },
  boardNameStatic: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    paddingVertical: 6,
  },
});

export default BoardSettingsDropdown;
