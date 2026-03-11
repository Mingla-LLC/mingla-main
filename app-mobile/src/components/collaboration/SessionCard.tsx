import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
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

interface SessionCardProps {
  session: CollaborationSession;
  currentMode: 'solo' | string;
  onJoinSession: (sessionId: string, sessionName: string) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
}

const SessionCard = ({ session, currentMode, onJoinSession, onNavigateToBoard }: SessionCardProps) => {
  const styles = StyleSheet.create({
    sessionCard: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 16,
      padding: 16,
    },
    sessionCardContent: {
      marginBottom: 12,
    },
    sessionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    sessionName: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
    },
    sessionStatusIndicator: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    statusActive: {
      backgroundColor: '#10b981',
    },
    statusVoting: {
      backgroundColor: '#f59e0b',
    },
    statusInactive: {
      backgroundColor: '#9ca3af',
    },
    sessionStats: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      marginBottom: 8,
    },
    sessionStatsText: {
      fontSize: 14,
      color: '#6b7280',
    },
    sessionLastActivity: {
      fontSize: 12,
      color: '#eb7825',
    },
    participantsSection: {
      marginBottom: 16,
    },
    participantsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    participantsTitle: {
      fontSize: 14,
      fontWeight: '500',
      color: '#374151',
    },
    participantsList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    participantContainer: {
      position: 'relative',
    },
    participantAvatar: {
      width: 40,
      height: 40,
      backgroundColor: '#eb7825',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    participantAvatarText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 16,
    },
    adminBadge: {
      position: 'absolute',
      top: -4,
      right: -4,
      width: 16,
      height: 16,
      backgroundColor: '#fbbf24',
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    adminBadgeText: {
      fontSize: 10,
    },
    participantTooltip: {
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: [{ translateX: -50 }],
      marginBottom: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: 'black',
      borderRadius: 4,
      opacity: 0,
      zIndex: 10,
    },
    participantTooltipText: {
      color: 'white',
      fontSize: 12,
    },
    kickButton: {
      position: 'absolute',
      top: -4,
      right: -4,
      width: 20,
      height: 20,
      backgroundColor: '#ef4444',
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: 0,
    },
    currentUserContainer: {
      position: 'relative',
    },
    currentUserAvatar: {
      width: 40,
      height: 40,
      backgroundColor: '#eb7825',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'rgba(235, 120, 37, 0.3)',
    },
    currentUserAvatarText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 16,
    },
    currentUserAdminBadge: {
      position: 'absolute',
      top: -4,
      right: -4,
      width: 16,
      height: 16,
      backgroundColor: '#fbbf24',
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    currentUserAdminBadgeText: {
      fontSize: 10,
    },
    currentUserTooltip: {
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: [{ translateX: -50 }],
      marginBottom: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: 'black',
      borderRadius: 4,
      opacity: 0,
      zIndex: 10,
    },
    currentUserTooltipText: {
      color: 'white',
      fontSize: 12,
    },
    moreParticipantsBadge: {
      width: 40,
      height: 40,
      backgroundColor: '#e5e7eb',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moreParticipantsText: {
      color: '#6b7280',
      fontSize: 12,
      fontWeight: '500',
    },
    sessionActions: {
      flexDirection: 'row',
      gap: 8,
    },
    joinSessionButton: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 12,
    },
    joinSessionButtonActive: {
      backgroundColor: '#eb7825',
    },
    joinSessionButtonInactive: {
      backgroundColor: '#fef3e2',
    },
    joinSessionButtonText: {
      fontSize: 14,
      fontWeight: '500',
      textAlign: 'center',
    },
    joinSessionButtonTextActive: {
      color: 'white',
    },
    joinSessionButtonTextInactive: {
      color: '#eb7825',
    },
    viewBoardButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    preferencesWarning: {
      marginTop: 12,
      backgroundColor: '#fefce8',
      borderWidth: 1,
      borderColor: '#fde047',
      borderRadius: 12,
      padding: 12,
    },
    preferencesWarningContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    preferencesWarningText: {
      fontSize: 14,
      color: '#b45309',
    },
  });

  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionCardContent}>
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionName}>{session.name}</Text>
          <View style={[
            styles.sessionStatusIndicator,
            session.status === 'active' ? styles.statusActive : 
            session.status === 'voting' ? styles.statusVoting : styles.statusInactive
          ]} />
        </View>
        <View style={styles.sessionStats}>
          <Text style={styles.sessionStatsText}>{session.participants.length} people</Text>
          <Text style={styles.sessionStatsText}>{session.boardCards} cards</Text>
        </View>
        <Text style={styles.sessionLastActivity}>
          Active {session.lastActivity}
        </Text>
      </View>

      <View style={styles.participantsSection}>
        <View style={styles.participantsHeader}>
          <Ionicons name="people" size={16} color="#eb7825" />
          <Text style={styles.participantsTitle}>Collaborating Users</Text>
        </View>
        <View style={styles.participantsList}>
          {session.participants.slice(0, 5).map((participant, i) => {
            const isAdmin = session.admins && session.admins.includes(participant.id);
            const isCurrentUser = participant.id === 'you';
            return (
              <View key={participant.id} style={styles.participantContainer}>
                <TrackedTouchableOpacity logComponent="SessionCard"
                  onPress={() => {}}
                  style={styles.participantAvatar}
                >
                  <Text style={styles.participantAvatarText}>
                    {participant.name[0]}
                  </Text>
                  {isAdmin && (
                    <View style={styles.adminBadge}>
                      <Text style={styles.adminBadgeText}>👑</Text>
                    </View>
                  )}
                </TrackedTouchableOpacity>
                
                <View style={styles.participantTooltip}>
                  <Text style={styles.participantTooltipText}>
                    {participant.name}
                    {isAdmin && ' (Admin)'}
                    {isCurrentUser && ' (You)'}
                  </Text>
                </View>

                {session.adminId === 'current-user' && !isCurrentUser && (
                  <TrackedTouchableOpacity logComponent="SessionCard"
                    onPress={(e) => {
                      e.stopPropagation();
                    }}
                    style={styles.kickButton}
                  >
                    <Ionicons name="close" size={12} color="white" />
                  </TrackedTouchableOpacity>
                )}
              </View>
            );
          })}
          
          {/* Current user avatar */}
          <View style={styles.currentUserContainer}>
            <View style={styles.currentUserAvatar}>
              <Text style={styles.currentUserAvatarText}>Y</Text>
              {session.admins && session.admins.includes('you') && (
                <View style={styles.currentUserAdminBadge}>
                  <Text style={styles.currentUserAdminBadgeText}>👑</Text>
                </View>
              )}
            </View>
            <View style={styles.currentUserTooltip}>
              <Text style={styles.currentUserTooltipText}>
                You{session.admins && session.admins.includes('you') && ' (Admin)'}
              </Text>
            </View>
          </View>

          {session.participants.length > 4 && (
            <View style={styles.moreParticipantsBadge}>
              <Text style={styles.moreParticipantsText}>+{session.participants.length - 4}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.sessionActions}>
        <TrackedTouchableOpacity logComponent="SessionCard" 
          onPress={() => onJoinSession(session.id, session.name)}
          style={[
            styles.joinSessionButton,
            currentMode === session.name ? styles.joinSessionButtonActive : styles.joinSessionButtonInactive
          ]}
        >
          <Text style={[
            styles.joinSessionButtonText,
            currentMode === session.name ? styles.joinSessionButtonTextActive : styles.joinSessionButtonTextInactive
          ]}>
            {currentMode === session.name ? 'Current Session' : 'Join Session'}
          </Text>
        </TrackedTouchableOpacity>
        <TrackedTouchableOpacity logComponent="SessionCard" 
          onPress={() => {
            if (onNavigateToBoard) {
              onNavigateToBoard(session, 'discussion');
            }
          }}
          style={styles.viewBoardButton}
        >
          <Ionicons name="chatbubble" size={16} color="#6b7280" />
        </TrackedTouchableOpacity>
      </View>

      {!session.hasCollabPreferences && (
        <View style={styles.preferencesWarning}>
          <View style={styles.preferencesWarningContent}>
            <Ionicons name="alert-circle" size={16} color="#b45309" />
            <Text style={styles.preferencesWarningText}>Set preferences for this session - separate from solo mode</Text>
          </View>
        </View>
      )}
    </View>
  );
};

export default SessionCard;
