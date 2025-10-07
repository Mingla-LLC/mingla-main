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
  const styles = StyleSheet.create({
    sessionsContainer: {
      gap: 24,
    },
    currentModeCard: {
      backgroundColor: '#fef3e2',
      borderWidth: 1,
      borderColor: '#fed7aa',
      borderRadius: 16,
      padding: 16,
    },
    currentModeHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    currentModeTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
    },
    currentModeDescription: {
      fontSize: 14,
      color: '#6b7280',
      marginTop: 2,
    },
    modeBadge: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
    },
    modeBadgeSolo: {
      backgroundColor: '#dbeafe',
    },
    modeBadgeCollaboration: {
      backgroundColor: '#eb7825',
    },
    modeBadgeText: {
      fontSize: 12,
      fontWeight: '500',
    },
    modeBadgeTextSolo: {
      color: '#1d4ed8',
    },
    modeBadgeTextCollaboration: {
      color: 'white',
    },
    switchModeButton: {
      marginTop: 12,
      width: '100%',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      alignItems: 'center',
    },
    switchModeButtonDisabled: {
      backgroundColor: '#f3f4f6',
    },
    switchModeButtonText: {
      fontSize: 14,
      fontWeight: '500',
      color: '#374151',
    },
    switchModeButtonTextDisabled: {
      color: '#9ca3af',
    },
    activeSessionsTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: '#111827',
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    sessionsList: {
      gap: 12,
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
      paddingVertical: 8,
      paddingHorizontal: 24,
      borderRadius: 12,
    },
    startCollaborationButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    pendingSessionsTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: '#111827',
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    pendingSessionsList: {
      gap: 12,
    },
  });

  return (
    <View style={styles.sessionsContainer}>
      {/* Current Mode */}
      <View style={styles.currentModeCard}>
        <View style={styles.currentModeHeader}>
          <View>
            <Text style={styles.currentModeTitle}>Current Mode</Text>
            <Text style={styles.currentModeDescription}>
              {currentMode === 'solo' ? 'Solo discovery mode' : `Collaborating in "${currentMode}"`}
            </Text>
          </View>
          <View style={[
            styles.modeBadge,
            currentMode === 'solo' ? styles.modeBadgeSolo : styles.modeBadgeCollaboration
          ]}>
            <Text style={[
              styles.modeBadgeText,
              currentMode === 'solo' ? styles.modeBadgeTextSolo : styles.modeBadgeTextCollaboration
            ]}>
              {currentMode === 'solo' ? 'Solo' : 'Collaboration'}
            </Text>
          </View>
        </View>
        <TouchableOpacity 
          onPress={() => onModeChange('solo')}
          disabled={currentMode === 'solo'}
          style={[
            styles.switchModeButton,
            currentMode === 'solo' && styles.switchModeButtonDisabled
          ]}
        >
          <Text style={[
            styles.switchModeButtonText,
            currentMode === 'solo' && styles.switchModeButtonTextDisabled
          ]}>
            {currentMode === 'solo' ? '✓ Solo Mode Active' : 'Switch to Solo Mode →'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <View>
          <Text style={styles.activeSessionsTitle}>
            <Ionicons name="flash" size={20} color="#eb7825" />
            Active Sessions ({activeSessions.length})
          </Text>
          <View style={styles.sessionsList}>
            {activeSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                currentMode={currentMode}
                onJoinSession={onJoinSession}
                onNavigateToBoard={onNavigateToBoard}
              />
            ))}
          </View>
        </View>
      )}

      {/* Pending Sessions */}
      {pendingSessions.length > 0 && (
        <View>
          <Text style={styles.pendingSessionsTitle}>
            <Ionicons name="time" size={20} color="#d97706" />
            Pending Sessions ({pendingSessions.length})
          </Text>
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

// SessionCard component would be imported from a separate file
const SessionCard = ({ session, currentMode, onJoinSession, onNavigateToBoard }: any) => {
  // This would be a separate component file
  return null;
};

// PendingSessionCard component would be imported from a separate file  
const PendingSessionCard = ({ session, onLeaveSession }: any) => {
  // This would be a separate component file
  return null;
};

export default SessionsTab;
