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

// Move styles outside the component
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
    inviteCard: {
      backgroundColor: 'white',
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: '#e5e7eb',
    },
    inviteHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    inviteInfo: {
      flex: 1,
    },
    inviteTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
    },
    inviteFrom: {
      fontSize: 14,
      color: '#6b7280',
      marginBottom: 2,
    },
    inviteTo: {
      fontSize: 14,
      color: '#6b7280',
      marginBottom: 2,
    },
    inviteTime: {
      fontSize: 12,
      color: '#9ca3af',
    },
    inviteExpiry: {
      fontSize: 12,
      color: '#f59e0b',
      marginTop: 2,
    },
    inviteStatus: {
      alignItems: 'flex-end',
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#fbbf24',
    },
    statusText: {
      fontSize: 12,
      color: '#6b7280',
      fontWeight: '500',
    },
    inviteActions: {
      flexDirection: 'row',
      gap: 8,
    },
    acceptButton: {
      flex: 1,
      backgroundColor: '#10b981',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    acceptButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '500',
    },
    declineButton: {
      flex: 1,
      backgroundColor: '#ef4444',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    declineButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '500',
    },
    cancelButton: {
      backgroundColor: '#6b7280',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    cancelButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '500',
    },
  });

const InvitesTab = ({
  sentInvites,
  receivedInvites,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite
}: InvitesTabProps) => {
  const [showInviteType, setShowInviteType] = useState<'sent' | 'received'>('received');

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

// ReceivedInviteCard component
const ReceivedInviteCard = ({ invite, onAccept, onDecline }: any) => {
  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteHeader}>
        <View style={styles.inviteInfo}>
          <Text style={styles.inviteTitle}>{invite.sessionName}</Text>
          <Text style={styles.inviteFrom}>From: {invite.fromUser.name}</Text>
          <Text style={styles.inviteTime}>{invite.createdAt}</Text>
        </View>
        <View style={styles.inviteStatus}>
          <View style={styles.statusDot} />
        </View>
      </View>
      
      <View style={styles.inviteActions}>
        <TouchableOpacity 
          style={styles.acceptButton}
          onPress={() => onAccept(invite.id)}
        >
          <Ionicons name="checkmark" size={16} color="white" />
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.declineButton}
          onPress={() => onDecline(invite.id)}
        >
          <Ionicons name="close" size={16} color="white" />
          <Text style={styles.declineButtonText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// SentInviteCard component
const SentInviteCard = ({ invite, onCancel }: any) => {
  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteHeader}>
        <View style={styles.inviteInfo}>
          <Text style={styles.inviteTitle}>{invite.sessionName}</Text>
          <Text style={styles.inviteTo}>To: {invite.toUser.name}</Text>
          <Text style={styles.inviteTime}>{invite.createdAt}</Text>
          {invite.expiresAt && (
            <Text style={styles.inviteExpiry}>Expires in {invite.expiresAt}</Text>
          )}
        </View>
        <View style={styles.inviteStatus}>
          <Text style={styles.statusText}>Pending</Text>
        </View>
      </View>
      
      <View style={styles.inviteActions}>
        <TouchableOpacity 
          style={styles.cancelButton}
          onPress={() => onCancel(invite.id)}
        >
          <Ionicons name="close" size={16} color="white" />
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default InvitesTab;
