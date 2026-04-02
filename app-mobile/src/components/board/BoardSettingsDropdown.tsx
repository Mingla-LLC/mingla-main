import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { Icon } from "../ui/Icon";
import { supabase } from "../../services/supabase";
import { useKeyboard } from "../../hooks/useKeyboard";

interface BoardSettingsDropdownProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  sessionName: string;
  sessionCreatorId?: string;
  currentUserId?: string;
  isAdmin?: boolean;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
  onManageMembers?: () => void;
  onInviteParticipants?: () => void;
  onExitBoard?: () => void;
  onSessionDeleted?: () => void;
  onSessionNameUpdated?: (newName: string) => void;
  // For positioning (used when rendering as absolute positioned dropdown)
  position?: { x: number; y: number };
  // Style variant: 'overlay' for full-screen overlay, 'positioned' for absolute positioned
  variant?: "overlay" | "positioned";
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
  onToggleNotifications,
  onManageMembers,
  onInviteParticipants,
  onExitBoard,
  onSessionDeleted,
  onSessionNameUpdated,
  position,
  variant = "overlay",
}) => {
  const [showEditSessionModal, setShowEditSessionModal] = useState(false);
  const [editSessionName, setEditSessionName] = useState("");
  const [savingSessionName, setSavingSessionName] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [exitingBoard, setExitingBoard] = useState(false);
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  const editNameInputRef = useRef<TextInput>(null);

  // Deferred focus: autoFocus inside Modal crashes on iOS Fabric.
  // Focus manually after the Modal's native view hierarchy has committed.
  useEffect(() => {
    if (showEditSessionModal) {
      const timer = setTimeout(() => editNameInputRef.current?.focus(), 400);
      return () => clearTimeout(timer);
    }
  }, [showEditSessionModal]);

  // Check if current user can manage session (is creator or admin)
  const canManageSession = currentUserId && (sessionCreatorId === currentUserId || isAdmin);

  // Handle exit board by delegating to parent handler
  // Parent owns source-of-truth leave logic and post-exit refresh behavior.
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
        "Error",
        error?.message || "Failed to leave the board. Please try again."
      );
    } finally {
      setExitingBoard(false);
    }
  }, [exitingBoard, onClose, onExitBoard]);

  // Handle edit session name
  const handleEditSessionName = useCallback(() => {
    if (!canManageSession) {
      Alert.alert("Permission denied", "Only the session creator or admins can edit the session name.");
      return;
    }
    setEditSessionName(sessionName);
    setShowEditSessionModal(true);
    onClose();
  }, [canManageSession, sessionName, onClose]);

  // Handle save session name
  const handleSaveSessionName = useCallback(async () => {
    if (!sessionId || !editSessionName.trim()) {
      Alert.alert("Error", "Session name cannot be empty.");
      return;
    }

    try {
      setSavingSessionName(true);
      const { error } = await supabase
        .from("collaboration_sessions")
        .update({ name: editSessionName.trim() })
        .eq("id", sessionId);

      if (error) throw error;

      setShowEditSessionModal(false);
      
      // Notify parent of the update
      if (onSessionNameUpdated) {
        onSessionNameUpdated(editSessionName.trim());
      }
      
      // Show success toast
      Alert.alert("Success", "Session name updated successfully.");
    } catch (error: any) {
      console.error("Error updating session name:", error);
      Alert.alert(
        "Update failed",
        error?.message || "Unable to update session name."
      );
    } finally {
      setSavingSessionName(false);
    }
  }, [sessionId, editSessionName, onSessionNameUpdated]);

  // Handle delete session
  const handleDeleteSession = useCallback(async () => {
    if (deletingSession) return;
    if (!sessionId || !currentUserId) return;
    if (!isAdmin && sessionCreatorId !== currentUserId) {
      Alert.alert("Permission denied", "Only admins can delete this session.");
      return;
    }

    try {
      setDeletingSession(true);
      const { error } = await supabase
        .from("collaboration_sessions")
        .delete()
        .eq("id", sessionId);

      if (error) throw error;

      // Show success toast
      Alert.alert("Success", "Session deleted successfully.");

      // Notify parent
      if (onSessionDeleted) {
        onSessionDeleted();
      }
    } catch (error: any) {
      console.error("Error deleting session:", error);
      Alert.alert(
        "Delete failed",
        error?.message || "Unable to delete this session."
      );
    } finally {
      setDeletingSession(false);
    }
  }, [deletingSession, sessionId, currentUserId, isAdmin, sessionCreatorId, onSessionDeleted]);

  // Handle delete session with confirmation
  const handleDeleteSessionWithConfirmation = useCallback(() => {
    if (!canManageSession) {
      Alert.alert("Permission denied", "Only the session creator or admins can delete this session.");
      return;
    }

    onClose();

    Alert.alert(
      "Delete Session",
      `Are you sure you want to delete "${sessionName}"? This action cannot be undone and all cards, votes, and discussions will be permanently deleted.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: handleDeleteSession,
        },
      ]
    );
  }, [canManageSession, sessionName, onClose, handleDeleteSession]);

  const renderDropdownContent = () => (
    <View style={styles.dropdownMenu}>
      {/* Admin Privileges header - only for creator/admin */}
      {canManageSession && (
        <View style={styles.adminHeader}>
          <View style={styles.adminHeaderIcon}>
            <Icon name="shield" size={16} color="#eb7825" />
          </View>
          <Text style={styles.adminHeaderText}>Admin Privileges</Text>
        </View>
      )}

      {/* Manage Board - only for creator/admin */}
      {canManageSession && onManageMembers && (
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => {
            onManageMembers();
            onClose();
          }}
          activeOpacity={0.7}
        >
          <Icon name="settings" size={18} color="#6B7280" />
          <Text style={styles.menuItemText}>Manage Board</Text>
        </TouchableOpacity>
      )}

      {/* Rename Board - only for creator/admin */}
      {canManageSession && (
        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleEditSessionName}
          activeOpacity={0.7}
        >
          <Icon name="edit-2" size={18} color="#6B7280" />
          <Text style={styles.menuItemText}>Rename Board</Text>
        </TouchableOpacity>
      )}

      {/* Invite Participants - only for creator/admin */}
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

      {/* Turn off notifications */}
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
            {notificationsEnabled ? "Turn Off Notifications" : "Turn On Notifications"}
          </Text>
        </TouchableOpacity>
      )}

      {/* Divider */}
      <View style={styles.menuDivider} />

      {/* Leave Board */}
      <TouchableOpacity
        style={styles.menuItem}
        onPress={() => {
          onClose();
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
        }}
        activeOpacity={0.7}
        disabled={exitingBoard}
      >
        <Icon name="log-out" size={18} color="#6B7280" />
        <Text style={styles.menuItemText}>
          {exitingBoard ? "Leaving..." : "Leave Board"}
        </Text>
      </TouchableOpacity>

      {/* Delete Board - only for creator/admin */}
      {canManageSession && (
        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleDeleteSessionWithConfirmation}
          activeOpacity={0.7}
        >
          <Icon name="x" size={18} color="#EF4444" />
          <Text style={styles.menuItemTextDanger}>Delete Board</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (!visible && !showEditSessionModal) return null;

  return (
    <>
      {/* Dropdown Menu */}
      {visible && (
        <Modal
          visible={visible}
          transparent
          animationType="fade"
          onRequestClose={onClose}
        >
          <TouchableOpacity
            style={styles.overlay}
            activeOpacity={1}
            onPress={onClose}
          >
            {renderDropdownContent()}
          </TouchableOpacity>
        </Modal>
      )}

      {/* Edit Session Name Modal */}
      <Modal
        visible={showEditSessionModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditSessionModal(false)}
      >
        <TouchableOpacity
          style={styles.editModalOverlay}
          activeOpacity={1}
          onPress={() => setShowEditSessionModal(false)}
        >
          <View style={[styles.editModalContainer, keyboardHeight > 0 && { marginBottom: keyboardHeight }]} onStartShouldSetResponder={() => true}>
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>Edit Session Name</Text>
              <TouchableOpacity
                onPress={() => setShowEditSessionModal(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <TextInput
              ref={editNameInputRef}
              style={styles.editModalInput}
              value={editSessionName}
              onChangeText={setEditSessionName}
              placeholder="Enter session name"
              placeholderTextColor="#9ca3af"
              maxLength={100}
            />

            <View style={styles.editModalButtons}>
              <TouchableOpacity
                style={styles.editModalCancelButton}
                onPress={() => setShowEditSessionModal(false)}
              >
                <Text style={styles.editModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.editModalSaveButton,
                  (!editSessionName.trim() || savingSessionName) && styles.editModalSaveButtonDisabled
                ]}
                onPress={handleSaveSessionName}
                disabled={!editSessionName.trim() || savingSessionName}
              >
                {savingSessionName ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.editModalSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.1)",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  dropdownMenu: {
    position: "absolute",
    top: 50,
    right: 16,
    backgroundColor: "white",
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 240,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  positionedDropdown: {
    position: "absolute",
    backgroundColor: "white",
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 220,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  adminHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#eb7825",
    backgroundColor: "#FEF3E7",
    marginHorizontal: 8,
    marginBottom: 4,
    borderRadius: 4,
    gap: 8,
  },
  adminHeaderIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  adminHeaderText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemText: {
    fontSize: 15,
    color: "#374151",
    fontWeight: "400",
  },
  menuItemTextDanger: {
    fontSize: 15,
    color: "#EF4444",
    fontWeight: "400",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
    marginHorizontal: 16,
  },
  // Edit session name modal styles
  editModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  editModalContainer: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  editModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  editModalInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#F9FAFB",
    marginBottom: 20,
  },
  editModalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  editModalCancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  editModalCancelText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#6B7280",
  },
  editModalSaveButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#eb7825",
    minWidth: 80,
    alignItems: "center",
  },
  editModalSaveButtonDisabled: {
    backgroundColor: "#FCD5B5",
  },
  editModalSaveText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
});

export default BoardSettingsDropdown;
