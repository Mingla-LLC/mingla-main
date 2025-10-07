import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface InviteFriendsStepProps {
  onNext: () => void;
  onBack: () => void;
  invitedFriends: any[];
  onFriendInvite: (friend: any) => void;
}

const InviteFriendsStep = ({ onNext, onBack, invitedFriends, onFriendInvite }: InviteFriendsStepProps) => {
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'white',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingVertical: 16,
      backgroundColor: 'white',
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
    },
    backButton: {
      padding: 8,
      borderRadius: 20,
    },
    headerCenter: {
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: '#111827',
    },
    headerSubtitle: {
      fontSize: 14,
      color: '#6b7280',
    },
    progressBar: {
      height: 8,
      backgroundColor: '#e5e7eb',
      borderRadius: 4,
      marginHorizontal: 24,
      marginVertical: 16,
    },
    progressFill: {
      height: 8,
      backgroundColor: '#eb7825',
      borderRadius: 4,
    },
    inviteMainContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    inviteIconContainer: {
      alignItems: 'center',
      marginBottom: 32,
    },
    inviteIcon: {
      width: 80,
      height: 80,
      backgroundColor: '#eb7825',
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleSection: {
      alignItems: 'center',
      marginBottom: 32,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: '#111827',
      textAlign: 'center',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: '#6b7280',
      textAlign: 'center',
    },
    contactsSection: {
      flex: 1,
      marginBottom: 24,
    },
    contactsTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 16,
    },
    contactsList: {
      flex: 1,
    },
    contactsContent: {
      paddingBottom: 20,
    },
    contactCard: {
      backgroundColor: '#f9fafb',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    contactInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    contactAvatar: {
      width: 40,
      height: 40,
      backgroundColor: '#eb7825',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    contactAvatarText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    contactDetails: {
      flex: 1,
    },
    contactName: {
      fontSize: 16,
      fontWeight: '500',
      color: '#111827',
      marginBottom: 2,
    },
    contactEmail: {
      fontSize: 14,
      color: '#6b7280',
    },
    inviteButton: {
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    inviteButtonDefault: {
      backgroundColor: '#eb7825',
    },
    inviteButtonInvited: {
      backgroundColor: '#f3f4f6',
    },
    inviteButtonText: {
      fontSize: 14,
      fontWeight: '500',
    },
    inviteButtonTextDefault: {
      color: 'white',
    },
    inviteButtonTextInvited: {
      color: '#6b7280',
    },
    inviteOptionsContainer: {
      marginBottom: 16,
    },
    emailInviteCard: {
      borderWidth: 2,
      borderColor: '#d1d5db',
      borderStyle: 'dashed',
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
      marginBottom: 12,
    },
    emailInviteText: {
      fontSize: 16,
      color: '#6b7280',
      marginTop: 8,
    },
    contactsInviteCard: {
      borderWidth: 2,
      borderColor: '#d1d5db',
      borderStyle: 'dashed',
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
    },
    contactsInviteText: {
      fontSize: 16,
      color: '#6b7280',
      marginTop: 8,
    },
    inviteDisclaimer: {
      fontSize: 12,
      color: '#9ca3af',
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 16,
    },
    continueButton: {
      backgroundColor: '#eb7825',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    continueButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
      marginRight: 8,
    },
  });

  // Mock friend suggestions
  const mockContacts = [
    { id: '1', name: 'Alex Rivera', email: 'alex.rivera@email.com', phone: '(555) 123-4567', avatar: null },
    { id: '2', name: 'Taylor Kim', email: 'taylor.kim@email.com', phone: '(555) 234-5678', avatar: null },
    { id: '3', name: 'Morgan Chen', email: 'morgan.chen@email.com', phone: '(555) 345-6789', avatar: null },
    { id: '4', name: 'Casey Davis', email: 'casey.davis@email.com', phone: '(555) 456-7890', avatar: null }
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Invite Friends</Text>
          <Text style={styles.headerSubtitle}>Step 6 of 7</Text>
        </View>
        
        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: '85.7%' }]} />
      </View>

      {/* Main Content */}
      <View style={styles.inviteMainContent}>
        {/* Large Invite Icon */}
        <View style={styles.inviteIconContainer}>
          <View style={styles.inviteIcon}>
            <Ionicons name="person-add" size={40} color="white" />
          </View>
        </View>

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
          <ScrollView 
            style={styles.contactsList}
            showsVerticalScrollIndicator={true}
            contentContainerStyle={styles.contactsContent}
          >
            {mockContacts.map((contact) => {
              const isInvited = invitedFriends?.some((f: any) => f.id === contact.id);
              
              return (
                <View key={contact.id} style={styles.contactCard}>
                  <View style={styles.contactInfo}>
                    <View style={styles.contactAvatar}>
                      <Text style={styles.contactAvatarText}>{contact.name.charAt(0)}</Text>
                    </View>
                    <View style={styles.contactDetails}>
                      <Text style={styles.contactName}>{contact.name}</Text>
                      <Text style={styles.contactEmail}>{contact.email}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => onFriendInvite(contact)}
                    style={[
                      styles.inviteButton,
                      isInvited ? styles.inviteButtonInvited : styles.inviteButtonDefault
                    ]}
                  >
                    <Text style={[
                      styles.inviteButtonText,
                      isInvited ? styles.inviteButtonTextInvited : styles.inviteButtonTextDefault
                    ]}>
                      {isInvited ? 'Invited' : 'Invite'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Invite Options */}
        <View style={styles.inviteOptionsContainer}>
          <TouchableOpacity style={styles.emailInviteCard}>
            <Ionicons name="add" size={24} color="#6b7280" />
            <Text style={styles.emailInviteText}>Invite by Email</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.contactsInviteCard}>
            <Ionicons name="call" size={24} color="#6b7280" />
            <Text style={styles.contactsInviteText}>Invite from Contacts</Text>
          </TouchableOpacity>
        </View>

        {/* Disclaimer */}
        <Text style={styles.inviteDisclaimer}>
          Selected contacts will auto-accept for demo purposes
        </Text>

        {/* Continue Button */}
        <TouchableOpacity
          onPress={onNext}
          style={styles.continueButton}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
          <Ionicons name="arrow-forward" size={20} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default InviteFriendsStep;
