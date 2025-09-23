import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CollaborationSession, SessionInvite } from '../types';

interface HeaderControlsProps {
  // UI props
  showNotifications: boolean;
  onToggleNotifications: () => void;
  onShowPreferences: () => void;
  
  // Session props
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  isInSolo: boolean;
  onSwitchToSolo: () => void;
  onSwitchToCollaborative: (sessionId: string) => void;
  onCreateSession: (participants: string[], sessionName: string) => Promise<void>;
  
  // Invite props
  pendingInvites: SessionInvite[];
  sentSessions: CollaborationSession[];
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
  onCancelSession: (sessionId: string) => void;
  
  loading?: boolean;
}

export const HeaderControls: React.FC<HeaderControlsProps> = ({
  showNotifications,
  onToggleNotifications,
  onShowPreferences,
  currentSession,
  availableSessions,
  isInSolo,
  onSwitchToSolo,
  onSwitchToCollaborative,
  onCreateSession,
  pendingInvites,
  sentSessions,
  onAcceptInvite,
  onDeclineInvite,
  onCancelSession,
  loading = false
}) => {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);

  const totalNotifications = pendingInvites?.length || 0;

  const handleCreateSession = () => {
    // For now, create a simple session with a default name
    // In a real implementation, you'd show a modal to input participants and session name
    onCreateSession([], `Session ${new Date().toLocaleDateString()}`);
  };

  return (
    <View style={styles.container}>
      {/* Notifications Bell */}
      <TouchableOpacity
        style={[styles.button, totalNotifications > 0 && styles.buttonWithBadge]}
        onPress={() => setInviteModalOpen(true)}
      >
        <Ionicons name="notifications-outline" size={20} color="#FF6B35" />
        {totalNotifications > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {totalNotifications > 9 ? '9+' : totalNotifications}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Session Mode */}
      <TouchableOpacity
        style={styles.sessionButton}
        onPress={() => setSessionModalOpen(true)}
      >
        {isInSolo ? (
          <>
            <Ionicons name="person-outline" size={20} color="#FF6B35" />
            <Text style={styles.sessionButtonText}>Solo</Text>
          </>
        ) : (
          <>
            <Ionicons name="people-outline" size={20} color="#FF6B35" />
            <Text style={styles.sessionButtonText}>Team</Text>
          </>
        )}
        {currentSession && (
          <View style={styles.sessionBadge}>
            <Text style={styles.sessionBadgeText}>
              {currentSession.participants?.length || 0}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Create Session Button */}
      <TouchableOpacity
        style={styles.createButton}
        onPress={handleCreateSession}
      >
        <Ionicons name="add" size={20} color="#FF6B35" />
      </TouchableOpacity>

      {/* Invite Modal */}
      <Modal
        visible={inviteModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInviteModalOpen(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Collaboration Invites</Text>
            <TouchableOpacity onPress={() => setInviteModalOpen(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            {(pendingInvites?.length || 0) === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="mail-outline" size={48} color="#ccc" />
                <Text style={styles.emptyStateText}>No pending invites</Text>
              </View>
            ) : (
              pendingInvites.map((invite) => (
                <View key={invite.id} style={styles.inviteCard}>
                  <View style={styles.inviteHeader}>
                    <Text style={styles.inviteTitle}>{invite.sessionName}</Text>
                    <Text style={styles.inviteFrom}>
                      from {invite.invitedBy.name}
                    </Text>
                  </View>
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      style={[styles.inviteButton, styles.acceptButton]}
                      onPress={() => {
                        onAcceptInvite(invite.id);
                        setInviteModalOpen(false);
                      }}
                    >
                      <Text style={styles.acceptButtonText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.inviteButton, styles.declineButton]}
                      onPress={() => {
                        onDeclineInvite(invite.id);
                        setInviteModalOpen(false);
                      }}
                    >
                      <Text style={styles.declineButtonText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      </Modal>

      {/* Session Modal */}
      <Modal
        visible={sessionModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSessionModalOpen(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Session Management</Text>
            <TouchableOpacity onPress={() => setSessionModalOpen(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            {/* Current Session */}
            {currentSession && (
              <View style={styles.currentSessionCard}>
                <Text style={styles.currentSessionTitle}>Current Session</Text>
                <Text style={styles.currentSessionName}>{currentSession.name}</Text>
                <Text style={styles.currentSessionParticipants}>
                  {currentSession.participants?.length || 0} participants
                </Text>
                <TouchableOpacity
                  style={styles.leaveButton}
                  onPress={() => {
                    onSwitchToSolo();
                    setSessionModalOpen(false);
                  }}
                >
                  <Text style={styles.leaveButtonText}>Leave Session</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Available Sessions */}
            {(availableSessions?.length || 0) > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Available Sessions</Text>
                {availableSessions.map((session) => (
                  <TouchableOpacity
                    key={session.id}
                    style={styles.sessionCard}
                    onPress={() => {
                      onSwitchToCollaborative(session.id);
                      setSessionModalOpen(false);
                    }}
                  >
                    <Text style={styles.sessionName}>{session.name}</Text>
                    <Text style={styles.sessionStatus}>
                      {session.status} • {session.participants?.length || 0} participants
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Create New Session */}
            <TouchableOpacity
              style={styles.createSessionButton}
              onPress={() => {
                handleCreateSession();
                setSessionModalOpen(false);
              }}
            >
              <Ionicons name="add" size={20} color="white" />
              <Text style={styles.createSessionButtonText}>Create New Session</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF5F2',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  buttonWithBadge: {
    // Additional styles for button with badge
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  sessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  sessionButtonText: {
    fontSize: 12,
    color: '#FF6B35',
    fontWeight: '600',
  },
  sessionBadge: {
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  sessionBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF5F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    backgroundColor: 'white',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  inviteCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inviteHeader: {
    marginBottom: 12,
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  inviteFrom: {
    fontSize: 14,
    color: '#666',
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 12,
  },
  inviteButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: '#10B981',
  },
  declineButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  acceptButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  declineButtonText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '600',
  },
  currentSessionCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  currentSessionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
  },
  currentSessionName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  currentSessionParticipants: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  leaveButton: {
    backgroundColor: '#EF4444',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  leaveButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  sessionCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sessionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  sessionStatus: {
    fontSize: 14,
    color: '#666',
  },
  createSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  createSessionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
