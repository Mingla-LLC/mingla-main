import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    progressSection: {
      paddingHorizontal: 24,
      paddingTop: 8,
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
  });

  // Mock friend suggestions - matching the image exactly
  const mockContacts = [
    { id: "1", name: "Alex Rivera", email: "alex.rivera@email.com" },
    { id: "2", name: "Taylor Kim", email: "taylor.kim@email.com" },
    { id: "3", name: "Morgan Chen", email: "morgan.chen@email.com" },
    { id: "4", name: "Casey Davis", email: "casey.davis@email.com" },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />

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
      >
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Invite Friends</Text>
          <Text style={styles.subtitle}>
            Mingla is better with friends! Invite people to join you.
          </Text>
        </View>

        {/* Suggested Contacts */}
        <View style={styles.contactsSection}>
          <Text style={styles.contactsTitle}>Suggested Contacts</Text>
          {mockContacts.map((contact, index) => {
            const isInvited = invitedFriends?.some(
              (f: any) => f.id === contact.id
            );

            return (
              <View key={contact.id} style={styles.contactRow}>
                <View style={styles.contactInfo}>
                  <View style={styles.contactAvatar}>
                    <Text style={styles.contactAvatarText}>
                      {contact.name.charAt(0)}
                    </Text>
                  </View>
                  <View style={styles.contactDetails}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.contactEmail}>{contact.email}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => onFriendInvite(contact)}
                  style={styles.inviteButton}
                  activeOpacity={0.7}
                >
                  <Text style={styles.inviteButtonText}>
                    {isInvited ? "Invited" : "Invite"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* Invite Options */}
        <View style={styles.inviteOptionsContainer}>
          <TouchableOpacity
            style={styles.inviteOptionButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name="add-outline"
              size={24}
              color="#6b7280"
              style={styles.inviteOptionIcon}
            />
            <Text style={styles.inviteOptionText}>Invite by Email</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.inviteOptionButton, styles.inviteOptionButtonLast]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="call-outline"
              size={24}
              color="#6b7280"
              style={styles.inviteOptionIcon}
            />
            <Text style={styles.inviteOptionText}>Invite from Contacts</Text>
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
    </SafeAreaView>
  );
};

export default InviteFriendsStep;
