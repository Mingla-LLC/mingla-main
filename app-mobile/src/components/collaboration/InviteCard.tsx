import React from 'react';
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

interface ReceivedInviteCardProps {
  invite: CollaborationInvite;
  onAccept: (inviteId: string) => void;
  onDecline: (inviteId: string) => void;
}

export const ReceivedInviteCard = ({ invite, onAccept, onDecline }: ReceivedInviteCardProps) => {
  const styles = StyleSheet.create({
    receivedInviteCard: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 16,
      padding: 16,
    },
    receivedInviteHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 12,
    },
    receivedInviteAvatar: {
      width: 40,
      height: 40,
      backgroundColor: '#3b82f6',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    receivedInviteAvatarText: {
      color: 'white',
      fontWeight: '600',
      fontSize: 16,
    },
    receivedInviteContent: {
      flex: 1,
    },
    receivedInviteTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
    },
    receivedInviteSubtitle: {
      fontSize: 14,
      color: '#6b7280',
    },
    receivedInviteStatusIndicator: {
      width: 12,
      height: 12,
      backgroundColor: '#3b82f6',
      borderRadius: 6,
    },
    receivedInviteActions: {
      flexDirection: 'row',
      gap: 8,
    },
    acceptInviteButton: {
      flex: 1,
      backgroundColor: '#eb7825',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
    },
    acceptInviteButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '500',
    },
    declineInviteButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
    },
    declineInviteButtonText: {
      color: '#374151',
      fontSize: 14,
      fontWeight: '500',
    },
  });

  return (
    <View style={styles.receivedInviteCard}>
      <View style={styles.receivedInviteHeader}>
        <View style={styles.receivedInviteAvatar}>
          <Text style={styles.receivedInviteAvatarText}>
            {invite.fromUser.name[0]}
          </Text>
        </View>
        <View style={styles.receivedInviteContent}>
          <Text style={styles.receivedInviteTitle}>{invite.sessionName}</Text>
          <Text style={styles.receivedInviteSubtitle}>
            Invited by {invite.fromUser.name} • {invite.createdAt}
          </Text>
        </View>
        <View style={styles.receivedInviteStatusIndicator} />
      </View>

      <View style={styles.receivedInviteActions}>
        <TouchableOpacity 
          onPress={() => onAccept(invite.id)}
          style={styles.acceptInviteButton}
        >
          <Text style={styles.acceptInviteButtonText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => onDecline(invite.id)}
          style={styles.declineInviteButton}
        >
          <Text style={styles.declineInviteButtonText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface SentInviteCardProps {
  invite: CollaborationInvite;
  onCancel: (inviteId: string) => void;
}

export const SentInviteCard = ({ invite, onCancel }: SentInviteCardProps) => {
  const styles = StyleSheet.create({
    sentInviteCard: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 16,
      padding: 16,
    },
    sentInviteHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 12,
    },
    sentInviteAvatar: {
      width: 40,
      height: 40,
      backgroundColor: '#f97316',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sentInviteAvatarText: {
      color: 'white',
      fontWeight: '600',
      fontSize: 16,
    },
    sentInviteContent: {
      flex: 1,
    },
    sentInviteTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
    },
    sentInviteSubtitle: {
      fontSize: 14,
      color: '#6b7280',
    },
    sentInviteStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    sentInviteStatusText: {
      fontSize: 12,
      color: '#6b7280',
    },
    cancelInviteButton: {
      width: '100%',
      borderWidth: 1,
      borderColor: '#fecaca',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
    },
    cancelInviteButtonText: {
      fontSize: 14,
      fontWeight: '500',
      color: '#dc2626',
    },
  });

  return (
    <View style={styles.sentInviteCard}>
      <View style={styles.sentInviteHeader}>
        <View style={styles.sentInviteAvatar}>
          <Text style={styles.sentInviteAvatarText}>
            {invite.toUser.name[0]}
          </Text>
        </View>
        <View style={styles.sentInviteContent}>
          <Text style={styles.sentInviteTitle}>{invite.sessionName}</Text>
          <Text style={styles.sentInviteSubtitle}>
            Sent to {invite.toUser.name} • {invite.createdAt}
          </Text>
        </View>
        <View style={styles.sentInviteStatus}>
          <Ionicons name="time" size={12} color="#6b7280" />
          <Text style={styles.sentInviteStatusText}>{invite.expiresAt}</Text>
        </View>
      </View>

      <TouchableOpacity 
        onPress={() => onCancel(invite.id)}
        style={styles.cancelInviteButton}
      >
        <Text style={styles.cancelInviteButtonText}>Cancel Invite</Text>
      </TouchableOpacity>
    </View>
  );
};

interface PendingSessionCardProps {
  session: any;
  onLeaveSession: (sessionId: string) => void;
}

export const PendingSessionCard = ({ session, onLeaveSession }: PendingSessionCardProps) => {
  const styles = StyleSheet.create({
    pendingSessionCard: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 16,
      padding: 16,
    },
    pendingSessionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    pendingSessionName: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
    },
    pendingSessionStats: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      marginTop: 4,
    },
    pendingSessionStatsText: {
      fontSize: 14,
      color: '#6b7280',
    },
    pendingSessionStatusIndicator: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#f59e0b',
    },
    pendingSessionActions: {
      flexDirection: 'row',
      gap: 8,
    },
    cancelSessionButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: '#fecaca',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
    },
    cancelSessionButtonText: {
      fontSize: 14,
      fontWeight: '500',
      color: '#dc2626',
    },
    pendingSessionViewButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

  return (
    <View style={styles.pendingSessionCard}>
      <View style={styles.pendingSessionHeader}>
        <View>
          <Text style={styles.pendingSessionName}>{session.name}</Text>
          <View style={styles.pendingSessionStats}>
            <Text style={styles.pendingSessionStatsText}>{session.participants.length} members</Text>
            <Text style={styles.pendingSessionStatsText}>Created {session.createdAt}</Text>
          </View>
        </View>
        <View style={styles.pendingSessionStatusIndicator} />
      </View>

      <View style={styles.pendingSessionActions}>
        <TouchableOpacity 
          onPress={() => onLeaveSession(session.id)}
          style={styles.cancelSessionButton}
        >
          <Text style={styles.cancelSessionButtonText}>Cancel Session</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pendingSessionViewButton}>
          <Ionicons name="people" size={16} color="#6b7280" />
        </TouchableOpacity>
      </View>
    </View>
  );
};
