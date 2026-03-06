import * as React from "react";
import { useState, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../services/supabase";
import { extractFunctionError } from "../../utils/edgeFunctionError";
import { useAppState } from "../AppStateManager";
import { mixpanelService } from "../../services/mixpanelService";

export default function AccountSettings() {
  const insets = useSafeAreaInsets();
  const {
    setShowAccountSettings,
    user,
    handleSignOut,
  } = useAppState();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'deleting' | 'success' | 'error'>('confirm');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInProgressRef = useRef(false);

  const handleDeleteAccount = () => {
    setDeleteStep('confirm');
    setDeleteError(null);
    setShowDeleteConfirmModal(true);
  };

  const executeDeleteAccount = async () => {
    // Prevent duplicate requests
    if (deleteInProgressRef.current) return;

    if (!user?.id) {
      setDeleteError("You must be signed in to delete your account.");
      setDeleteStep('error');
      return;
    }

    deleteInProgressRef.current = true;
    setDeleteStep('deleting');
    setIsDeleting(true);

    try {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        method: "POST",
        body: { userId: user.id },
      });

      if (error) {
        const errorMessage = await extractFunctionError(
          error,
          "An error occurred while deleting your account."
        );
        throw new Error(errorMessage);
      }
      if (data?.error) throw new Error(data.error);

      // Show success state briefly before signing out
      setDeleteStep('success');

      // Wait a moment to show success message, then sign out
      setTimeout(async () => {
        setShowDeleteConfirmModal(false);
        setShowAccountSettings(false);
        await handleSignOut();
      }, 2000);
    } catch (e: unknown) {
      console.error("Delete account error:", e);
      const errorMsg = e instanceof Error ? e.message : "Could not delete account. Please try again.";
      setDeleteError(errorMsg);
      setDeleteStep('error');
    } finally {
      setIsDeleting(false);
      deleteInProgressRef.current = false;
    }
  };

  const closeDeleteModal = () => {
    if (deleteStep === 'deleting') return; // Don't allow closing while deleting
    setShowDeleteConfirmModal(false);
    setDeleteStep('confirm');
    setDeleteError(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity
            onPress={() => setShowAccountSettings(false)}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Account Settings</Text>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {/* App Information */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="information-circle" size={20} color="#eb7825" />
            <Text style={styles.sectionTitle}>App Information</Text>
          </View>

          <View style={styles.appInfoContainer}>
            <View style={styles.appInfoRow}>
              <Text style={styles.appInfoLabel}>App Version</Text>
              <Text style={styles.appInfoValue}>1.0.0</Text>
            </View>
          </View>
        </View>

        {/* Delete Account */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="trash" size={20} color="#ef4444" />
            <Text style={styles.sectionTitle}>Delete Account</Text>
          </View>

          <Text style={styles.sectionDescription}>
            Permanently delete your Mingla account and all associated data.
          </Text>

          <TouchableOpacity
            onPress={handleDeleteAccount}
            style={[
              styles.deleteButton,
              isDeleting && styles.deleteButtonDisabled,
            ]}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#dc2626" />
            ) : (
              <Ionicons name="trash" size={16} color="#dc2626" />
            )}
            <Text style={styles.deleteButtonText}>
              {isDeleting ? "Deleting…" : "Delete Account"}
            </Text>
          </TouchableOpacity>

          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              <Text style={styles.warningBold}>Warning:</Text> Account deletion
              is permanent and cannot be reversed. Make sure to save any
              important information before proceeding.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Delete Account Confirmation Modal */}
      <Modal
        visible={showDeleteConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={closeDeleteModal}
          />
          <View style={styles.modalContainer}>
            {deleteStep === 'confirm' && (
              <>
                <View style={styles.modalIconContainer}>
                  <Ionicons name="warning" size={48} color="#ef4444" />
                </View>
                <Text style={styles.modalTitle}>Delete Your Account?</Text>
                <Text style={styles.modalDescription}>
                  This action is <Text style={styles.modalBold}>permanent</Text> and cannot be undone.
                </Text>
                <Text style={styles.modalSubDescription}>
                  • All your saved experiences, preferences, and activity history will be erased{"\n"}
                  • You will be removed from all collaboration boards{"\n"}
                  • You will no longer appear in search, connections, or member lists{"\n"}
                  • You cannot sign in again with these credentials
                </Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.modalCancelButton}
                    onPress={closeDeleteModal}
                  >
                    <Text style={styles.modalCancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalDeleteButton}
                    onPress={executeDeleteAccount}
                  >
                    <Text style={styles.modalDeleteButtonText}>Delete Account</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {deleteStep === 'deleting' && (
              <>
                <ActivityIndicator size="large" color="#ef4444" style={styles.modalLoader} />
                <Text style={styles.modalTitle}>Deleting Account...</Text>
                <Text style={styles.modalDescription}>
                  Please wait while we remove your account and all associated data.
                </Text>
                <Text style={styles.modalSubDescription}>
                  This may take a moment. Do not close the app.
                </Text>
              </>
            )}

            {deleteStep === 'success' && (
              <>
                <View style={styles.modalIconContainerSuccess}>
                  <Ionicons name="checkmark-circle" size={48} color="#10b981" />
                </View>
                <Text style={styles.modalTitle}>Account Deleted</Text>
                <Text style={styles.modalDescription}>
                  Your account has been permanently deleted.
                </Text>
                <Text style={styles.modalSubDescription}>
                  You will be signed out momentarily. Thank you for using Mingla.
                </Text>
              </>
            )}

            {deleteStep === 'error' && (
              <>
                <View style={styles.modalIconContainer}>
                  <Ionicons name="close-circle" size={48} color="#ef4444" />
                </View>
                <Text style={styles.modalTitle}>Deletion Failed</Text>
                <Text style={styles.modalDescription}>
                  {deleteError || "Something went wrong. Please try again."}
                </Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.modalCancelButton}
                    onPress={closeDeleteModal}
                  >
                    <Text style={styles.modalCancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalRetryButton}
                    onPress={() => {
                      setDeleteStep('confirm');
                      setDeleteError(null);
                    }}
                  >
                    <Text style={styles.modalRetryButtonText}>Try Again</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    paddingTop: 8,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  content: {
    flex: 1,
    gap: 24,
    padding: 12,
  },
  section: {
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  sectionDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
    lineHeight: 20,
  },
  appInfoContainer: {
    gap: 12,
  },
  appInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  appInfoLabel: {
    fontSize: 16,
    color: "#374151",
  },
  appInfoValue: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  deleteButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    marginBottom: 16,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#dc2626",
  },
  warningBox: {
    padding: 12,
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
  },
  warningText: {
    fontSize: 14,
    color: "#eb7825",
    lineHeight: 20,
  },
  warningBold: {
    fontWeight: "600",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
  modalIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#fef2f2",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalIconContainerSuccess: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#d1fae5",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalLoader: {
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 12,
    textAlign: "center",
  },
  modalDescription: {
    fontSize: 16,
    color: "#4b5563",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 22,
  },
  modalBold: {
    fontWeight: "bold",
    color: "#ef4444",
  },
  modalSubDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "left",
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  modalDeleteButton: {
    flex: 1,
    backgroundColor: "#ef4444",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalDeleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  modalRetryButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalRetryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
});
