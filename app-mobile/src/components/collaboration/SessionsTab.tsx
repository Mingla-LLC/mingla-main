import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
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
  status: 'pending' | 'active' | 'voting' | 'locked' | 'archived';
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
  onCreateSession?: () => void;
  isLoading?: boolean;
}

const styles = StyleSheet.create({
  sessionsContainer: {
    gap: 24,
    paddingBottom: 24,
  },
  soloExplorerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  soloExplorerCardActive: {
    backgroundColor: '#FEF3E7',
    borderWidth: 2,
    borderColor: '#eb7825',
  },
  soloAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  soloAvatarIcon: {
    color: '#FFFFFF',
  },
  soloInfo: {
    flex: 1,
  },
  soloTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  soloSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  soloCheckmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeSessionsSection: {
    gap: 16,
  },
  activeSessionsHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  sessionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 12,
  },
  sessionCardActive: {
    backgroundColor: '#FEF3E7',
    borderWidth: 2,
    borderColor: '#eb7825',
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sessionTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusVoting: {
    backgroundColor: '#F3F4F6',
  },
  statusVotingText: {
    color: '#6B7280',
  },
  statusActive: {
    backgroundColor: '#D1FAE5',
  },
  statusActiveText: {
    color: '#059669',
  },
  statusLocked: {
    backgroundColor: '#F3F4F6',
  },
  statusLockedText: {
    color: '#6B7280',
  },
  sessionDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  sessionDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sessionDetailText: {
    fontSize: 13,
    color: '#6B7280',
  },
  sessionDetailIcon: {
    color: '#6B7280',
  },
  participantsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  participantAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginLeft: -8,
  },
  participantAvatarFirst: {
    marginLeft: 0,
  },
  participantInitial: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  participantRemainder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginLeft: -8,
  },
  participantRemainderText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  sessionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  switchButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  switchButtonActive: {
    backgroundColor: '#eb7825',
  },
  switchButtonText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '600',
  },
  switchButtonTextActive: {
    color: '#FFFFFF',
  },
  activeHeaderIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    position: 'relative',
  },
  activeHeaderCheckmarkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  actionButton: {
    width: 40,
    height: 40,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonIcon: {
    color: '#6B7280',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    backgroundColor: '#F3F4F6',
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
    color: '#6B7280',
    marginBottom: 16,
    textAlign: 'center',
  },
  startCollaborationButton: {
    backgroundColor: '#eb7825',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startCollaborationButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#6B7280',
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
  pendingSessions,
  onCreateSession,
  isLoading = false
}: SessionsTabProps) => {
  const isSoloMode = currentMode === 'solo';
  
  const isSessionActive = (session: CollaborationSession) => {
    return currentMode === session.id || currentMode === session.name;
  };

  // Show loading spinner when sessions are loading
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'voting':
        return styles.statusVoting;
      case 'active':
        return styles.statusActive;
      case 'locked':
        return styles.statusLocked;
      default:
        return styles.statusVoting;
    }
  };

  const getStatusBadgeTextStyle = (status: string) => {
    switch (status) {
      case 'voting':
        return styles.statusVotingText;
      case 'active':
        return styles.statusActiveText;
      case 'locked':
        return styles.statusLockedText;
      default:
        return styles.statusVotingText;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minutes ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} hours ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} days ago`;
    } catch {
      return timestamp;
    }
  };

  const getParticipantInitials = (participants: Friend[]) => {
    return participants.map(p => {
      const nameParts = p.name.split(' ');
      if (nameParts.length > 1) {
        return (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
      }
      return p.name.substring(0, 2).toUpperCase();
    });
  };

  return (
    <View style={styles.sessionsContainer}>
      {/* Solo Explorer Section */}
      <TouchableOpacity
        style={[
          styles.soloExplorerCard,
          isSoloMode && styles.soloExplorerCardActive
        ]}
        onPress={() => onModeChange('solo')}
        activeOpacity={0.7}
      >
        <View style={styles.soloAvatar}>
          <Ionicons name="person-outline" size={24} color="#FFFFFF" />
        </View>
        <View style={styles.soloInfo}>
          <Text style={styles.soloTitle}>Solo Explorer</Text>
          <Text style={styles.soloSubtitle}>Browse experiences just for you</Text>
        </View>
        {isSoloMode && (
          <View style={styles.soloCheckmark}>
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
          </View>
        )}
      </TouchableOpacity>

      {/* Active Sessions Section */}
      {activeSessions.length > 0 && (
        <View style={styles.activeSessionsSection}>
          <Text style={styles.activeSessionsHeader}>Active Sessions</Text>
          {activeSessions.map((session) => {
            const participantInitials = getParticipantInitials(session.participants || []);
            const cardsCount = session.boardCards || 0;
            const membersCount = session.totalParticipants || session.participants?.length || 0;
            const isActive = isSessionActive(session);
            
            return (
              <View key={session.id} style={[
                styles.sessionCard,
                isActive && styles.sessionCardActive
              ]}>
                <View style={styles.sessionHeader}>
                  <View style={styles.sessionTitleRow}>
                    <Text style={styles.sessionTitle}>{session.name}</Text>
                    <View style={[styles.statusBadge, getStatusBadgeStyle(session.status)]}>
                      <Text style={[styles.statusBadgeText, getStatusBadgeTextStyle(session.status)]}>
                        {session.status}
                      </Text>
                    </View>
                  </View>
                  {isActive && (
                    <View style={styles.activeHeaderIcon}>
                      <Ionicons name="person-outline" size={14} color="#FFFFFF" />
                      <View style={styles.activeHeaderCheckmarkBadge}>
                        <Ionicons name="checkmark" size={6} color="#FFFFFF" />
                      </View>
                    </View>
                  )}
                </View>
                
                <View style={styles.sessionDetails}>
                  <View style={styles.sessionDetail}>
                    <Ionicons name="people" size={14} color="#6B7280" />
                    <Text style={styles.sessionDetailText}>{membersCount} members</Text>
                  </View>
                  <View style={styles.sessionDetail}>
                    <Ionicons name="calendar" size={14} color="#6B7280" />
                    <Text style={styles.sessionDetailText}>{cardsCount} cards</Text>
                  </View>
                  {session.lastActivity && (
                    <View style={styles.sessionDetail}>
                      <Ionicons name="time" size={14} color="#6B7280" />
                      <Text style={styles.sessionDetailText}>
                        {formatTimestamp(session.lastActivity)}
                      </Text>
                    </View>
                  )}
                </View>

                {participantInitials.length > 0 && (
                  <View style={styles.participantsRow}>
                    {participantInitials.slice(0, 3).map((initial, index) => (
                      <View 
                        key={index} 
                        style={[
                          styles.participantAvatar,
                          index === 0 && styles.participantAvatarFirst
                        ]}
                      >
                        <Text style={styles.participantInitial}>{initial}</Text>
                      </View>
                    ))}
                    {participantInitials.length > 3 && (
                      <View style={styles.participantRemainder}>
                        <Text style={styles.participantRemainderText}>
                          +{participantInitials.length - 3}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.sessionActions}>
                  <TouchableOpacity
                    style={[
                      styles.switchButton,
                      isActive && styles.switchButtonActive
                    ]}
                    onPress={async () => {
                      if (!isActive) {
                        // Use the proper session switching handler
                        if (onJoinSession) {
                          await onJoinSession(session.id, session.name);
                        } else {
                          // Fallback to mode change if handler not provided
                          onModeChange(session.name);
                          if (onNavigateToBoard) {
                            onNavigateToBoard(session.id);
                          }
                        }
                      }
                    }}
                  >
                    <Ionicons 
                      name="flash" 
                      size={16} 
                      color={isActive ? "#FFFFFF" : "#6B7280"} 
                    />
                    <Text style={[
                      styles.switchButtonText,
                      isActive && styles.switchButtonTextActive
                    ]}>
                      {isActive ? 'Active' : 'Switch to this session'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => {
                      if (onNavigateToBoard) {
                        onNavigateToBoard(session.id, 'discussion');
                      }
                    }}
                  >
                    <Ionicons name="chatbubble-outline" size={18} color="#6B7280" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => {
                      if (onNavigateToBoard) {
                        onNavigateToBoard(session.id, 'settings');
                      }
                    }}
                  >
                    <Ionicons name="settings-outline" size={18} color="#6B7280" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Empty State */}
      {activeSessions.length === 0 && (
        <View style={styles.emptyState}>
          <View style={styles.emptyStateIcon}>
            <Ionicons name="people" size={32} color="#9CA3AF" />
          </View>
          <Text style={styles.emptyStateTitle}>No Active Sessions</Text>
          <Text style={styles.emptyStateSubtitle}>
            You don't have any active sessions yet. Create one to start collaborating with friends!
          </Text>
          <TouchableOpacity 
            onPress={() => {
              if (onCreateSession) {
                onCreateSession();
              } else {
                onStartCollaboration();
              }
            }}
            style={styles.startCollaborationButton}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.startCollaborationButtonText}>Create Session</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default SessionsTab;
