import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { Icon } from '../ui/Icon';

export interface Participant {
  id: string;
  user_id: string;
  session_id: string;
  has_accepted: boolean;
  joined_at?: string;
  profiles?: {
    id: string;
    username: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
}

interface ParticipantAvatarsProps {
  participants: Participant[];
  maxVisible?: number;
  size?: number;
  showOnlineStatus?: boolean;
  onPress?: (participant: Participant) => void;
  onViewAll?: () => void;
}

export const ParticipantAvatars: React.FC<ParticipantAvatarsProps> = ({
  participants,
  maxVisible = 5,
  size = 32,
  showOnlineStatus = true,
  onPress,
  onViewAll,
}) => {
  const acceptedParticipants = participants.filter(p => p.has_accepted);
  const visibleParticipants = acceptedParticipants.slice(0, maxVisible);
  const remainingCount = acceptedParticipants.length - maxVisible;

  const getParticipantName = (participant: Participant): string => {
    if (participant.profiles?.display_name) {
      return participant.profiles.display_name;
    }
    if (participant.profiles?.first_name && participant.profiles?.last_name) {
      return `${participant.profiles.first_name} ${participant.profiles.last_name}`;
    }
    return participant.profiles?.username || 'User';
  };

  const getParticipantInitials = (participant: Participant): string => {
    const name = getParticipantName(participant);
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const renderAvatar = (participant: Participant, index: number) => {
    const avatarUrl = participant.profiles?.avatar_url;
    const isOnline = showOnlineStatus; // In real implementation, check presence

    return (
      <TouchableOpacity
        key={participant.id}
        style={[
          styles.avatarContainer,
          { width: size, height: size },
          index > 0 && { marginLeft: -size * 0.3 },
        ]}
        onPress={() => onPress?.(participant)}
        activeOpacity={0.7}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
            onError={() => {
              // Fallback handled by placeholder below
            }}
          />
        ) : (
          <View
            style={[
              styles.avatarPlaceholder,
              { width: size, height: size, borderRadius: size / 2 },
            ]}
          >
            <Text
              style={[
                styles.avatarText,
                { fontSize: size * 0.35 },
              ]}
            >
              {getParticipantInitials(participant)}
            </Text>
          </View>
        )}
        {isOnline && (
          <View
            style={[
              styles.onlineIndicator,
              {
                width: size * 0.3,
                height: size * 0.3,
                borderRadius: size * 0.15,
                borderWidth: 2,
              },
            ]}
          />
        )}
      </TouchableOpacity>
    );
  };

  if (acceptedParticipants.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Icon name="people-outline" size={size} color="#ccc" />
        <Text style={styles.emptyText}>No participants</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatarsRow}>
        {visibleParticipants.map((participant, index) => renderAvatar(participant, index))}
        
        {remainingCount > 0 && (
          <TouchableOpacity
            style={[
              styles.moreAvatars,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                marginLeft: -size * 0.3,
              },
            ]}
            onPress={onViewAll}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.moreContainer,
                { width: size, height: size, borderRadius: size / 2 },
              ]}
            >
              <Text style={[styles.moreText, { fontSize: size * 0.35 }]}>
                +{remainingCount}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
      
      {acceptedParticipants.length > 0 && (
        <Text style={styles.countText}>
          {acceptedParticipants.length} {acceptedParticipants.length === 1 ? 'participant' : 'participants'}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  avatarContainer: {
    position: 'relative',
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 16,
  },
  avatar: {
    borderWidth: 2,
    borderColor: 'white',
  },
  avatarPlaceholder: {
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  avatarText: {
    color: 'white',
    fontWeight: '600',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#34C759',
    borderColor: 'white',
  },
  moreAvatars: {
    borderWidth: 2,
    borderColor: 'white',
  },
  moreContainer: {
    backgroundColor: '#E1E5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    color: '#666',
    fontWeight: '600',
  },
  countText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 16,
  },
  emptyText: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
});

