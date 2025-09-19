import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useNavigation } from '../contexts/NavigationContext';

export const SessionSwitcher: React.FC = () => {
  const {
    currentSession,
    availableSessions,
    pendingInvites,
    isInSolo,
    switchToSolo,
    switchToCollaborative,
    acceptInvite,
    declineInvite,
    loading,
  } = useSessionManagement();

  const { isSessionSwitcherOpen, closeSessionSwitcher } = useNavigation();

  const handleSwitchToSolo = async () => {
    const { error } = await switchToSolo();
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      closeSessionSwitcher();
    }
  };

  const handleSwitchToSession = async (sessionId: string) => {
    const { error } = await switchToCollaborative(sessionId);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      closeSessionSwitcher();
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    const { error } = await acceptInvite(inviteId);
    if (error) {
      Alert.alert('Error', error.message);
    }
  };

  const handleDeclineInvite = async (inviteId: string) => {
    const { error } = await declineInvite(inviteId);
    if (error) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <Modal
      visible={isSessionSwitcherOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeSessionSwitcher}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Switch Session</Text>
          <TouchableOpacity onPress={closeSessionSwitcher} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#666" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {/* Current Session */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Session</Text>
            {isInSolo ? (
              <View style={[styles.sessionCard, styles.activeSessionCard]}>
                <View style={styles.sessionHeader}>
                  <Ionicons name="person" size={20} color="#007AFF" />
                  <Text style={styles.sessionName}>Solo Mode</Text>
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>Active</Text>
                  </View>
                </View>
                <Text style={styles.sessionDescription}>
                  Explore and plan experiences on your own
                </Text>
              </View>
            ) : currentSession ? (
              <View style={[styles.sessionCard, styles.activeSessionCard]}>
                <View style={styles.sessionHeader}>
                  <Ionicons name="people" size={20} color="#007AFF" />
                  <Text style={styles.sessionName}>{currentSession.name}</Text>
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>Active</Text>
                  </View>
                </View>
                <Text style={styles.sessionDescription}>
                  Status: {currentSession.status}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Available Sessions */}
          {availableSessions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Available Sessions</Text>
              {availableSessions.map((session) => (
                <TouchableOpacity
                  key={session.id}
                  style={styles.sessionCard}
                  onPress={() => handleSwitchToSession(session.id)}
                  disabled={loading}
                >
                  <View style={styles.sessionHeader}>
                    <Ionicons name="people" size={20} color="#666" />
                    <Text style={styles.sessionName}>{session.name}</Text>
                  </View>
                  <Text style={styles.sessionDescription}>
                    Status: {session.status}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Pending Invites */}
          {pendingInvites.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pending Invites</Text>
              {pendingInvites.map((invite) => (
                <View key={invite.id} style={styles.inviteCard}>
                  <View style={styles.sessionHeader}>
                    <Ionicons name="mail" size={20} color="#FF9500" />
                    <Text style={styles.sessionName}>{invite.collaboration_sessions?.name}</Text>
                  </View>
                  <Text style={styles.sessionDescription}>
                    Invited by {invite.profiles?.display_name || 'Unknown'}
                  </Text>
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.acceptButton]}
                      onPress={() => handleAcceptInvite(invite.id)}
                      disabled={loading}
                    >
                      <Text style={styles.acceptButtonText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.declineButton]}
                      onPress={() => handleDeclineInvite(invite.id)}
                      disabled={loading}
                    >
                      <Text style={styles.declineButtonText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Solo Mode Option */}
          {!isInSolo && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sessionCard}
                onPress={handleSwitchToSolo}
                disabled={loading}
              >
                <View style={styles.sessionHeader}>
                  <Ionicons name="person" size={20} color="#666" />
                  <Text style={styles.sessionName}>Switch to Solo Mode</Text>
                </View>
                <Text style={styles.sessionDescription}>
                  Explore and plan experiences on your own
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    backgroundColor: 'white',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
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
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  activeSessionCard: {
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginLeft: 8,
    flex: 1,
  },
  sessionDescription: {
    fontSize: 14,
    color: '#666',
    marginLeft: 28,
  },
  activeBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  inviteCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FF9500',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inviteActions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: '#34C759',
  },
  declineButton: {
    backgroundColor: '#FF3B30',
  },
  acceptButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  declineButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
