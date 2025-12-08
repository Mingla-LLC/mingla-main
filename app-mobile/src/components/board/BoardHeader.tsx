import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ParticipantAvatars, Participant } from './ParticipantAvatars';
import { BoardSession } from '../../hooks/useBoardSession';

interface BoardHeaderProps {
  session: BoardSession | null;
  participants: Participant[];
  onSettingsPress?: () => void;
  onInvitePress?: () => void;
  onParticipantPress?: (participant: Participant) => void;
  onViewAllParticipants?: () => void;
  loading?: boolean;
}

export const BoardHeader: React.FC<BoardHeaderProps> = ({
  session,
  participants,
  onSettingsPress,
  onInvitePress,
  onParticipantPress,
  onViewAllParticipants,
  loading = false,
}) => {
  if (!session) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Board Session</Text>
        </View>
      </View>
    );
  }

  const participantCount = participants.filter(p => p.has_accepted).length;
  const maxParticipants = session.max_participants || '∞';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* Left: Session Info */}
        <View style={styles.leftSection}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {session.name}
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="people" size={14} color="#666" />
              <Text style={styles.metaText}>
                {participantCount} / {maxParticipants}
              </Text>
            </View>
            {session.is_active && (
              <View style={[styles.statusBadge, styles.activeBadge]}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Active</Text>
              </View>
            )}
          </View>
        </View>

        {/* Right: Actions */}
        <View style={styles.rightSection}>
          {onInvitePress && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={onInvitePress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="person-add" size={20} color="#007AFF" />
            </TouchableOpacity>
          )}
          {onSettingsPress && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={onSettingsPress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="settings-outline" size={20} color="#666" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Participants Section */}
      {participants.length > 0 && (
        <View style={styles.participantsSection}>
          <ParticipantAvatars
            participants={participants}
            maxVisible={5}
            size={36}
            showOnlineStatus={true}
            onPress={onParticipantPress}
            onViewAll={onViewAllParticipants}
          />
        </View>
      )}

      {/* Loading Indicator */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <Ionicons name="sync" size={16} color="#007AFF" />
            <Text style={styles.loadingText}>Updating...</Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  leftSection: {
    flex: 1,
    marginRight: 12,
  },
  sessionName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#666',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  activeBadge: {
    backgroundColor: '#E8F5E9',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4CAF50',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  participantsSection: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
});

