import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BoardSession } from "../../hooks/useBoardSession";
import { useBoardSession } from "../../hooks/useBoardSession";
import { InviteLinkShare } from "./InviteLinkShare";
import { QRCodeDisplay } from "./QRCodeDisplay";
import { InviteCodeDisplay } from "./InviteCodeDisplay";
import { supabase } from "../../services/supabase";
import { useAppStore } from "../../store/appStore";

interface BoardSettingsModalProps {
  visible: boolean;
  sessionId: string;
  onClose: () => void;
  onDelete?: () => void;
}

export const BoardSettingsModal: React.FC<BoardSettingsModalProps> = ({
  visible,
  sessionId,
  onClose,
  onDelete,
}) => {
  const { user } = useAppStore();
  const { session, loading, getInviteLink } = useBoardSession(sessionId);
  const [sessionName, setSessionName] = useState(session?.name || "");
  const [maxParticipants, setMaxParticipants] = useState<string>(
    session?.max_participants?.toString() || ""
  );
  const [isActive, setIsActive] = useState(session?.is_active ?? true);
  const [showInviteOptions, setShowInviteOptions] = useState(false);
  const [inviteLinkData, setInviteLinkData] = useState<{
    inviteCode: string;
    inviteLink: string;
  } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  React.useEffect(() => {
    if (session) {
      setSessionName(session.name);
      setMaxParticipants(session.max_participants?.toString() || "");
      setIsActive(session.is_active);
    }
  }, [session]);

  const handleSave = async () => {
    if (!sessionId || !user) {
      Alert.alert("Error", "Unable to save settings");
      return;
    }

    try {
      const updates: any = {
        name: sessionName.trim(),
        is_active: isActive,
        last_activity_at: new Date().toISOString(),
      };

      if (maxParticipants.trim()) {
        const max = parseInt(maxParticipants);
        if (isNaN(max) || max < 2) {
          Alert.alert("Error", "Max participants must be at least 2");
          return;
        }
        updates.max_participants = max;
      } else {
        updates.max_participants = null;
      }

      const { error } = await supabase
        .from("collaboration_sessions")
        .update(updates)
        .eq("id", sessionId);

      if (error) throw error;

      Alert.alert("Success", "Settings saved successfully");
      onClose();
    } catch (error: any) {
      console.error("Error saving settings:", error);
      Alert.alert("Error", error.message || "Failed to save settings");
    }
  };

  const handleLoadInviteLink = async () => {
    const linkData = await getInviteLink();
    if (linkData) {
      setInviteLinkData({
        inviteCode: linkData.inviteCode,
        inviteLink: linkData.inviteLink,
      });
      setShowInviteOptions(true);
    }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    onDelete?.();
    setShowDeleteConfirm(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Board Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#666" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {showInviteOptions && inviteLinkData ? (
            <View style={styles.inviteSection}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setShowInviteOptions(false)}
              >
                <Ionicons name="arrow-back" size={20} color="#eb7825" />
                <Text style={styles.backButtonText}>Back to Settings</Text>
              </TouchableOpacity>

              <InviteLinkShare
                inviteLink={inviteLinkData.inviteLink}
                inviteCode={inviteLinkData.inviteCode}
              />

              <View style={styles.qrSection}>
                <Text style={styles.sectionTitle}>QR Code</Text>
                <QRCodeDisplay data={inviteLinkData.inviteLink} />
              </View>

              <View style={styles.codeSection}>
                <InviteCodeDisplay inviteCode={inviteLinkData.inviteCode} />
              </View>
            </View>
          ) : (
            <>
              {/* Session Name */}
              <View style={styles.section}>
                <Text style={styles.label}>Session Name</Text>
                <TextInput
                  style={styles.input}
                  value={sessionName}
                  onChangeText={setSessionName}
                  placeholder="Enter session name"
                  maxLength={50}
                />
              </View>

              {/* Max Participants */}
              <View style={styles.section}>
                <Text style={styles.label}>Max Participants</Text>
                <TextInput
                  style={styles.input}
                  value={maxParticipants}
                  onChangeText={setMaxParticipants}
                  placeholder="Leave empty for unlimited"
                  keyboardType="numeric"
                />
                <Text style={styles.hint}>
                  Set a limit on the number of participants (optional)
                </Text>
              </View>

              {/* Active Status */}
              <View style={styles.section}>
                <View style={styles.switchRow}>
                  <View style={styles.switchLabelContainer}>
                    <Text style={styles.label}>Active Session</Text>
                    <Text style={styles.hint}>
                      Inactive sessions are archived and hidden
                    </Text>
                  </View>
                  <Switch
                    value={isActive}
                    onValueChange={setIsActive}
                    trackColor={{ false: "#e5e7eb", true: "#eb7825" }}
                    thumbColor={isActive ? "#eb7825" : "#f4f4f5"}
                  />
                </View>
              </View>

              {/* Invite Options */}
              <View style={styles.section}>
                <Text style={styles.label}>Invite Options</Text>
                <TouchableOpacity
                  style={styles.inviteButton}
                  onPress={handleLoadInviteLink}
                >
                  <Ionicons name="share-outline" size={20} color="#eb7825" />
                  <Text style={styles.inviteButtonText}>
                    View Invite Options
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Danger Zone */}
              <View style={styles.section}>
                <Text style={styles.dangerLabel}>Danger Zone</Text>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={handleDelete}
                >
                  <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                  <Text style={styles.deleteButtonText}>Delete Session</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>

        {!showInviteOptions && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              disabled={loading}
            >
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {/* Delete confirmation modal */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <View style={styles.confirmOverlay}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={() => setShowDeleteConfirm(false)}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Delete Session</Text>
            <Text style={styles.confirmText}>
              Are you sure you want to delete this board session? This action
              cannot be undone.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                onPress={() => setShowDeleteConfirm(false)}
                style={styles.confirmCancel}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDelete}
                style={styles.confirmDelete}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    paddingVertical: 24,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e1e5e9",
    backgroundColor: "white",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#e1e5e9",
  },
  hint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e1e5e9",
  },
  switchLabelContainer: {
    flex: 1,
  },
  inviteButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eb7825",
    gap: 8,
  },
  inviteButtonText: {
    fontSize: 16,
    color: "#eb7825",
    fontWeight: "600",
  },
  dangerLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FF3B30",
    marginBottom: 8,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FF3B30",
    gap: 8,
  },
  deleteButtonText: {
    fontSize: 16,
    color: "#FF3B30",
    fontWeight: "600",
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#e1e5e9",
    backgroundColor: "white",
  },
  saveButton: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  saveButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  inviteSection: {
    paddingTop: 20,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: "#eb7825",
    fontWeight: "600",
  },
  qrSection: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 16,
    textAlign: "center",
  },
  codeSection: {
    marginTop: 24,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  confirmText: {
    fontSize: 14,
    color: "#4b5563",
    marginBottom: 20,
  },
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  confirmCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
  },
  confirmCancelText: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "600",
  },
  confirmDelete: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#FF3B30",
  },
  confirmDeleteText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
});
