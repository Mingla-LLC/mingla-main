import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BoardSession } from '../../hooks/useBoardSession';

interface BoardSessionListProps {
  sessions: BoardSession[];
  onSelectSession: (session: BoardSession) => void;
  onSettingsPress?: (session: BoardSession) => void;
  emptyMessage?: string;
}

export const BoardSessionList: React.FC<BoardSessionListProps> = ({
  sessions,
  onSelectSession,
  onSettingsPress,
  emptyMessage = 'No board sessions yet',
}) => {
  const renderSessionItem = ({ item }: { item: BoardSession }) => {
    const participantCount = item.participants?.length || 0;
    const maxParticipants = item.max_participants || '∞';

    return (
      <TouchableOpacity
        style={styles.sessionItem}
        onPress={() => onSelectSession(item)}
        activeOpacity={0.7}
      >
        <View style={styles.sessionContent}>
          <View style={styles.sessionHeader}>
            <Text style={styles.sessionName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.is_active ? (
              <View style={styles.activeBadge}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>Active</Text>
              </View>
            ) : (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveText}>Inactive</Text>
              </View>
            )}
          </View>

          <View style={styles.sessionInfo}>
            <View style={styles.infoItem}>
              <Ionicons name="people" size={16} color="#666" />
              <Text style={styles.infoText}>
                {participantCount} / {maxParticipants} participants
              </Text>
            </View>
            {item.last_activity_at && (
              <View style={styles.infoItem}>
                <Ionicons name="time" size={16} color="#666" />
                <Text style={styles.infoText}>
                  {formatLastActivity(item.last_activity_at)}
                </Text>
              </View>
            )}
          </View>

          {item.invite_code && (
            <View style={styles.inviteCodeContainer}>
              <Ionicons name="key" size={14} color="#007AFF" />
              <Text style={styles.inviteCodeText}>{item.invite_code}</Text>
            </View>
          )}
        </View>

        {onSettingsPress && (
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => onSettingsPress(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="settings-outline" size={20} color="#666" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const formatLastActivity = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (sessions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="grid-outline" size={48} color="#ccc" />
        <Text style={styles.emptyText}>{emptyMessage}</Text>
        <Text style={styles.emptySubtext}>
          Create a new board session to start planning together
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={sessions}
      renderItem={renderSessionItem}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContainer}
      showsVerticalScrollIndicator={false}
    />
  );
};

const styles = StyleSheet.create({
  listContainer: {
    padding: 16,
    gap: 12,
  },
  sessionItem: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e1e5e9',
    alignItems: 'center',
  },
  sessionContent: {
    flex: 1,
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
    color: '#1a1a1a',
    flex: 1,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
  },
  activeText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '600',
  },
  inactiveBadge: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  inactiveText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  sessionInfo: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: 12,
    color: '#666',
  },
  inviteCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  inviteCodeText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
    letterSpacing: 1,
  },
  settingsButton: {
    padding: 8,
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});

