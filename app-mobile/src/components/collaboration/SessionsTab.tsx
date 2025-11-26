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

interface CollaborationSession {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'archived';
  participants: Friend[];
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  hasCollabPreferences?: boolean;
  pendingParticipants: number;
  totalParticipants: number;
  boardCards: number;
  admins?: string[];
  adminId?: string;
}

interface SessionsTabProps {
  currentMode: 'solo' | string;
  onModeChange: (mode: 'solo' | string) => void;
  onJoinSession: (sessionId: string, sessionName: string) => void;
  onLeaveSession: (sessionId: string) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  onStartCollaboration: () => void;
  activeSessions: CollaborationSession[];
  pendingSessions: CollaborationSession[];
}

// Move styles outside the component
const styles = StyleSheet.create({
    sessionsContainer: {
      gap: 16,
    },
    collaboratingUsersSection: {
      backgroundColor: 'white',
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    },
    collaboratingUsersHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    collaboratingUsersTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
    },
    avatarsContainer: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: '#eb7825',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    avatarText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    avatarBadge: {
      position: 'absolute',
      top: -2,
      right: -2,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: '#fbbf24',
      alignItems: 'center',
      justifyContent: 'center',
    },
    joinSessionContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    joinSessionButton: {
      flex: 1,
      backgroundColor: '#eb7825',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    joinSessionButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    chatButton: {
      width: 40,
      height: 40,
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#fef3e2',
      padding: 12,
      borderRadius: 8,
      marginBottom: 16,
      gap: 8,
    },
    infoBannerText: {
      flex: 1,
      fontSize: 14,
      color: '#d97706',
    },
    pendingSessionsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    pendingSessionsTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: '#111827',
    },
    pendingSessionsList: {
      gap: 12,
    },
    pendingSessionCard: {
      backgroundColor: 'white',
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: '#e5e7eb',
    },
    pendingSessionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    pendingSessionInfo: {
      flex: 1,
    },
    pendingSessionName: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
    },
    pendingSessionDetails: {
      fontSize: 14,
      color: '#6b7280',
    },
    pendingSessionNotification: {
      marginLeft: 8,
    },
    notificationDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#fbbf24',
    },
    pendingSessionActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    cancelButton: {
      flex: 1,
      backgroundColor: '#ef4444',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    cancelButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '500',
    },
    membersButton: {
      width: 40,
      height: 40,
      backgroundColor: '#f3f4f6',
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: 32,
    },
    emptyStateIcon: {
      width: 64,
      height: 64,
      backgroundColor: '#f3f4f6',
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 8,
    },
    emptyStateSubtitle: {
      fontSize: 14,
      color: '#6b7280',
      marginBottom: 16,
      textAlign: 'center',
    },
    startCollaborationButton: {
      backgroundColor: '#eb7825',
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 12,
    },
    startCollaborationButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
  });

const SessionsTab = ({
  currentMode,
  onModeChange,
  onJoinSession,
  onLeaveSession,
  onNavigateToBoard,
  onStartCollaboration,
  activeSessions,
  pendingSessions
}: SessionsTabProps) => {
  // Debug logging

  return (
    <View style={styles.sessionsContainer}>
      {/* Debug: Add a visible indicator */}
      <Text style={{color: 'red', fontSize: 12, marginBottom: 8}}>SessionsTab Content Loaded</Text>
      {/* Collaborating Users Section */}
      <View style={styles.collaboratingUsersSection}>
        <View style={styles.collaboratingUsersHeader}>
          <Ionicons name="people" size={20} color="#6b7280" />
          <Text style={styles.collaboratingUsersTitle}>Collaborating Users</Text>
        </View>
        
        <View style={styles.avatarsContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>Y</Text>
            <View style={styles.avatarBadge}>
              <Ionicons name="people" size={8} color="white" />
            </View>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>M</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>R</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>Y</Text>
            <View style={styles.avatarBadge}>
              <Ionicons name="people" size={8} color="white" />
            </View>
          </View>
        </View>
        
        <View style={styles.joinSessionContainer}>
          <TouchableOpacity style={styles.joinSessionButton}>
            <Text style={styles.joinSessionButtonText}>Join Session</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatButton}>
            <Ionicons name="chatbubble" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Information Banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle" size={16} color="#d97706" />
        <Text style={styles.infoBannerText}>Set preferences for this session - separate from solo mode</Text>
      </View>

      {/* Pending Sessions */}
      {pendingSessions.length > 0 && (
        <View>
          <View style={styles.pendingSessionsHeader}>
            <Ionicons name="time" size={20} color="#d97706" />
            <Text style={styles.pendingSessionsTitle}>Pending Sessions ({pendingSessions.length})</Text>
          </View>
          <View style={styles.pendingSessionsList}>
            {pendingSessions.map((session) => (
              <PendingSessionCard
                key={session.id}
                session={session}
                onLeaveSession={onLeaveSession}
              />
            ))}
          </View>
        </View>
      )}

      {/* Empty State */}
      {activeSessions.length === 0 && pendingSessions.length === 0 && (
        <View style={styles.emptyState}>
          <View style={styles.emptyStateIcon}>
            <Ionicons name="people" size={32} color="#9ca3af" />
          </View>
          <Text style={styles.emptyStateTitle}>No Active Sessions</Text>
          <Text style={styles.emptyStateSubtitle}>Start collaborating with friends to discover experiences together</Text>
          <TouchableOpacity 
            onPress={onStartCollaboration}
            style={styles.startCollaborationButton}
          >
            <Text style={styles.startCollaborationButtonText}>Start Collaboration</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};


// PendingSessionCard component
const PendingSessionCard = ({ session, onLeaveSession }: any) => {
  return (
    <View style={styles.pendingSessionCard}>
      <View style={styles.pendingSessionHeader}>
        <View style={styles.pendingSessionInfo}>
          <Text style={styles.pendingSessionName}>{session.name}</Text>
          <Text style={styles.pendingSessionDetails}>
            {session.participants?.length || 0} members • Created {session.createdAt || '3 hours ago'}
          </Text>
        </View>
        <View style={styles.pendingSessionNotification}>
          <View style={styles.notificationDot} />
        </View>
      </View>
      
      <View style={styles.pendingSessionActions}>
        <TouchableOpacity 
          style={styles.cancelButton}
          onPress={() => onLeaveSession(session.id)}
        >
          <Text style={styles.cancelButtonText}>Cancel Session</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.membersButton}>
          <Ionicons name="people" size={16} color="#6b7280" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default SessionsTab;
