import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: 'online' | 'offline';
  lastActive?: string;
}

interface CollaborationInvite {
  id: string;
  sessionName: string;
  fromUser: Friend;
  toUser: Friend;
  status: 'pending' | 'accepted' | 'declined' | 'canceled';
  createdAt: string;
  expiresAt?: string;
}

interface InvitesTabProps {
  sentInvites: CollaborationInvite[];
  receivedInvites: CollaborationInvite[];
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
  onCancelInvite: (inviteId: string) => void;
}

const InvitesTab = ({
  sentInvites,
  receivedInvites,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite
}: InvitesTabProps) => {
  const [showInviteType, setShowInviteType] = useState<'sent' | 'received'>('received');

  const styles = StyleSheet.create({
    invitesContainer: {
      gap: 16,
    },
    inviteTypeTabs: {
      flexDirection: 'row',
      backgroundColor: '#f3f4f6',
      borderRadius: 12,
      padding: 4,
    },
    inviteTypeTab: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    inviteTypeTabActive: {
      backgroundColor: 'white',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    inviteTypeTabInactive: {
      backgroundColor: 'transparent',
    },
    inviteTypeTabText: {
      fontSize: 14,
      fontWeight: '500',
      textAlign: 'center',
    },
    inviteTypeTabTextActive: {
      color: '#111827',
    },
    inviteTypeTabTextInactive: {
      color: '#6b7280',
    },
    receivedInvitesList: {
      gap: 12,
    },
    sentInvitesList: {
      gap: 12,
    },
    noInvitesState: {
      alignItems: 'center',
      paddingVertical: 32,
    },
    noInvitesIcon: {
      width: 48,
      height: 48,
      backgroundColor: '#f3f4f6',
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    noInvitesText: {
      fontSize: 14,
      color: '#6b7280',
    },
  });

  return (
    <View style={styles.invitesContainer}>
      {/* Invite Type Tabs */}
      <View style={styles.inviteTypeTabs}>
        <TouchableOpacity
          onPress={() => setShowInviteType('received')}
          style={[
            styles.inviteTypeTab,
            showInviteType === 'received' ? styles.inviteTypeTabActive : styles.inviteTypeTabInactive
          ]}
        >
          <Text style={[
            styles.inviteTypeTabText,
            showInviteType === 'received' ? styles.inviteTypeTabTextActive : styles.inviteTypeTabTextInactive
          ]}>
            Received ({receivedInvites.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowInviteType('sent')}
          style={[
            styles.inviteTypeTab,
            showInviteType === 'sent' ? styles.inviteTypeTabActive : styles.inviteTypeTabInactive
          ]}
        >
          <Text style={[
            styles.inviteTypeTabText,
            showInviteType === 'sent' ? styles.inviteTypeTabTextActive : styles.inviteTypeTabTextInactive
          ]}>
            Sent ({sentInvites.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Received Invites */}
      {showInviteType === 'received' && (
        <View style={styles.receivedInvitesList}>
          {receivedInvites.length > 0 ? (
            receivedInvites.map((invite) => (
              <ReceivedInviteCard
                key={invite.id}
                invite={invite}
                onAccept={onAcceptInvite}
                onDecline={onDeclineInvite}
              />
            ))
          ) : (
            <View style={styles.noInvitesState}>
              <View style={styles.noInvitesIcon}>
                <Ionicons name="checkmark-circle" size={24} color="#9ca3af" />
              </View>
              <Text style={styles.noInvitesText}>No pending invites</Text>
            </View>
          )}
        </View>
      )}

      {/* Sent Invites */}
      {showInviteType === 'sent' && (
        <View style={styles.sentInvitesList}>
          {sentInvites.length > 0 ? (
            sentInvites.map((invite) => (
              <SentInviteCard
                key={invite.id}
                invite={invite}
                onCancel={onCancelInvite}
              />
            ))
          ) : (
            <View style={styles.noInvitesState}>
              <View style={styles.noInvitesIcon}>
                <Ionicons name="send" size={24} color="#9ca3af" />
              </View>
              <Text style={styles.noInvitesText}>No sent invites</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

// ReceivedInviteCard component would be imported from a separate file
const ReceivedInviteCard = ({ invite, onAccept, onDecline }: any) => {
  // This would be a separate component file
  return null;
};

// SentInviteCard component would be imported from a separate file
const SentInviteCard = ({ invite, onCancel }: any) => {
  // This would be a separate component file
  return null;
};

export default InvitesTab;
