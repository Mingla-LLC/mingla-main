import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareView } from '../ui/KeyboardAwareView';
import { SafeAreaView } from "react-native-safe-area-context";
import { useFriends } from "../../hooks/useFriends";

interface InviteFriendsStepProps {
  onNext: () => void | Promise<void>;
  onBack: () => void;
  invitedFriends: any[];
  onFriendInvite: (friend: any) => void;
}

const InviteFriendsStep = ({
  onNext,
  onBack,
  invitedFriends,
  onFriendInvite,
}: InviteFriendsStepProps) => {
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [error, setError] = useState("");
  const { addFriend } = useFriends();
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    progressSection: {
      paddingHorizontal: 24,

      paddingBottom: 8,
    },
    progressBarContainer: {
      marginBottom: 8,
    },
    progressBar: {
      height: 4,
      backgroundColor: "#e5e7eb",
      borderRadius: 2,
      overflow: "hidden",
    },
    progressFill: {
      height: 4,
      backgroundColor: "#eb7825",
      borderRadius: 2,
    },
    progressTextContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
    },
    progressTextLeft: {
      fontSize: 12,
      color: "#6b7280",
    },
    progressTextRight: {
      fontSize: 12,
      color: "#6b7280",
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 32,
      paddingBottom: 120,
    },
    titleSection: {
      marginBottom: 32,
      alignItems: "center",
    },
    title: {
      fontSize: 28,
      fontWeight: "bold",
      color: "#111827",
      marginBottom: 8,
      textAlign: "center",
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      textAlign: "center",
      lineHeight: 22,
    },
    contactsSection: {
      marginBottom: 24,
    },
    contactsTitle: {
      fontSize: 14,
      fontWeight: "400",
      color: "#111827",
      marginBottom: 16,
    },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: "#f3f4f6",
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: "#e5e7eb",
      marginVertical: 8,
      borderRadius: 12,
    },
    contactInfo: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
    },
    contactAvatar: {
      width: 40,
      height: 40,
      backgroundColor: "#eb7825",
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    contactAvatarText: {
      color: "#ffffff",
      fontSize: 16,
      fontWeight: "600",
    },
    contactDetails: {
      flex: 1,
    },
    contactName: {
      fontSize: 16,
      fontWeight: "400",
      color: "#111827",
      marginBottom: 4,
    },
    contactEmail: {
      fontSize: 14,
      color: "#6b7280",
    },
    inviteButton: {
      backgroundColor: "#eb7825",
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    inviteButtonText: {
      fontSize: 14,
      fontWeight: "500",
      color: "#ffffff",
    },
    inviteOptionsContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    inviteOptionButton: {
      flex: 1,
      borderWidth: 1.5,
      borderColor: "#d1d5db",
      borderStyle: "dashed",
      borderRadius: 12,
      padding: 20,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    inviteOptionButtonLast: {
      marginRight: 0,
    },
    inviteOptionIcon: {
      marginBottom: 8,
    },
    inviteOptionText: {
      fontSize: 14,
      fontWeight: "400",
      color: "#111827",
      textAlign: "center",
    },
    skipText: {
      fontSize: 12,
      color: "#9ca3af",
      textAlign: "center",
      marginTop: 8,
      marginBottom: 24,
    },
    navigationContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 16,
      backgroundColor: "white",
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
    },
    backButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 8,
      backgroundColor: "white",
    },
    backButtonText: {
      fontSize: 16,
      color: "#111827",
      fontWeight: "500",
      marginLeft: 4,
    },
    reviewButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: "#eb7825",
      minWidth: 100,
    },
    reviewButtonText: {
      fontSize: 16,
      fontWeight: "500",
      color: "#ffffff",
      marginRight: 4,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end",
    },
    backdropTouch: {
      ...StyleSheet.absoluteFillObject,
    },
    modalContent: {
      backgroundColor: "white",
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingTop: 20,
      paddingBottom: 40,
      maxHeight: "80%",
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: "#f3f4f6",
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "600",
      color: "#111827",
    },
    modalCloseButton: {
      padding: 4,
    },
    modalBody: {
      paddingHorizontal: 24,
      paddingTop: 24,
    },
    modalSubtitle: {
      fontSize: 14,
      color: "#6b7280",
      marginBottom: 16,
      lineHeight: 20,
    },
    emailInput: {
      borderWidth: 1,
      borderColor: "#d1d5db",
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: 16,
      color: "#111827",
      backgroundColor: "#ffffff",
      marginBottom: 16,
    },
    errorText: {
      fontSize: 14,
      color: "#ef4444",
      marginBottom: 16,
    },
    successContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#d1fae5",
      padding: 12,
      borderRadius: 8,
      marginBottom: 16,
      gap: 8,
    },
    successText: {
      fontSize: 14,
      color: "#065f46",
      fontWeight: "500",
    },
    sendButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#eb7825",
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 12,
      gap: 8,
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    sendButtonText: {
      fontSize: 16,
      fontWeight: "600",
      color: "#ffffff",
    },
  });

  // Mock friend suggestions - matching the image exactly
  const mockContacts = [
    { id: "1", name: "Alex Rivera", email: "alex.rivera@email.com" },
    { id: "2", name: "Taylor Kim", email: "taylor.kim@email.com" },
    { id: "3", name: "Morgan Chen", email: "morgan.chen@email.com" },
    { id: "4", name: "Casey Davis", email: "casey.davis@email.com" },
  ];

  const handleInviteByEmail = async () => {
    const email = emailInput.trim().toLowerCase();

    // Basic email validation
    if (!email) {
      setError("Please enter an email address");
      return;
    }

    if (!email.includes("@") || !email.includes(".")) {
      setError("Please enter a valid email address");
      return;
    }

    setIsSendingInvite(true);
    setError("");

    try {
      // Call addFriend with email (not a UUID, so it will be treated as email-only invite)
      await addFriend(
        email, // Email address (not a UUID)
        email, // receiverEmail
        undefined // No username for non-existent users
      );

      setInviteSent(true);

      // Reset form after success
      setTimeout(() => {
        setEmailInput("");
        setInviteSent(false);
        setEmailModalVisible(false);
      }, 2000);
    } catch (err: any) {
      console.error("Error sending invite:", err);
      setError(err.message || "Failed to send invite. Please try again.");
    } finally {
      setIsSendingInvite(false);
    }
  };

  const openEmailModal = () => {
    setEmailModalVisible(true);
    setEmailInput("");
    setError("");
    setInviteSent(false);
  };

  const closeEmailModal = () => {
    setEmailModalVisible(false);
    setEmailInput("");
    setError("");
    setInviteSent(false);
  };

  return (
    <View style={styles.container}>
      {/*  <StatusBar barStyle="dark-content" backgroundColor="white" /> */}

      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "90%" }]} />
          </View>
          <View style={styles.progressTextContainer}>
            <Text style={styles.progressTextLeft}>Step 9 of 10</Text>
            <Text style={styles.progressTextRight}>90% complete</Text>
          </View>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Invite Friends</Text>
          <Text style={styles.subtitle}>
            Mingla is better with friends! Invite people to join you.
          </Text>
        </View>

        {/* Invite Options */}
        <View style={styles.inviteOptionsContainer}>
          <TouchableOpacity
            style={styles.inviteOptionButton}
            activeOpacity={0.7}
            onPress={openEmailModal}
          >
            <Ionicons
              name="mail-outline"
              size={24}
              color="#6b7280"
              style={styles.inviteOptionIcon}
            />
            <Text style={styles.inviteOptionText}>Invite by Email</Text>
          </TouchableOpacity>
        </View>

        {/* Skip Option */}
        <Text style={styles.skipText}>
          You can skip this step and invite friends later
        </Text>
      </ScrollView>

      {/* Navigation Footer */}
      <View style={styles.navigationContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={18} color="#111827" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reviewButton}
          onPress={onNext}
          activeOpacity={0.7}
        >
          <Text style={styles.reviewButtonText}>Review</Text>
          <Ionicons name="arrow-forward" size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Email Invite Modal */}

      <Modal
        visible={emailModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={closeEmailModal}
      >
        <KeyboardAwareView
          style={{ flex: 1 }}
          dismissOnTap={false}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={styles.backdropTouch}
              activeOpacity={1}
              onPress={closeEmailModal}
            />
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Invite by Email</Text>
                <TouchableOpacity
                  onPress={closeEmailModal}
                  style={styles.modalCloseButton}
                >
                  <Ionicons name="close" size={24} color="#6b7280" />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                <Text style={styles.modalSubtitle}>
                  Enter the email address of the person you'd like to invite
                </Text>

                <TextInput
                  style={styles.emailInput}
                  placeholder="email@example.com"
                  placeholderTextColor="#9ca3af"
                  value={emailInput}
                  onChangeText={setEmailInput}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSendingInvite}
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                {inviteSent ? (
                  <View style={styles.successContainer}>
                    <Ionicons
                      name="checkmark-circle"
                      size={24}
                      color="#10b981"
                    />
                    <Text style={styles.successText}>
                      Invitation sent successfully!
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    (isSendingInvite || !emailInput.trim()) &&
                      styles.sendButtonDisabled,
                  ]}
                  onPress={handleInviteByEmail}
                  disabled={isSendingInvite || !emailInput.trim()}
                  activeOpacity={0.7}
                >
                  {isSendingInvite ? (
                    <>
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={styles.sendButtonText}>Sending...</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="mail" size={18} color="#ffffff" />
                      <Text style={styles.sendButtonText}>Send Invitation</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAwareView>
      </Modal>
    </View>
  );
};

export default InviteFriendsStep;
