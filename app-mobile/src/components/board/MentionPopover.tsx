import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Participant } from './ParticipantAvatars';

interface MentionPopoverProps {
  participants: Participant[];
  onSelectParticipant: (participant: Participant) => void;
  onClose: () => void;
  visible: boolean;
}

export const MentionPopover: React.FC<MentionPopoverProps> = ({
  participants,
  onSelectParticipant,
  onClose,
  visible,
}) => {
  if (!visible || participants.length === 0) {
    return null;
  }

  const getParticipantDisplayName = (participant: Participant): string => {
    if (participant.profiles?.display_name) {
      return participant.profiles.display_name;
    }
    if (participant.profiles?.first_name && participant.profiles?.last_name) {
      return `${participant.profiles.first_name} ${participant.profiles.last_name}`;
    }
    return participant.profiles?.username || 'Unknown';
  };

  const getParticipantInitial = (participant: Participant): string => {
    const name = getParticipantDisplayName(participant);
    return name.charAt(0).toUpperCase();
  };

  return (
    <View style={styles.container}>
      <View style={styles.popover}>
        <View style={styles.header}>
          <Text style={styles.headerText}>Mention someone</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={20} color="#666" />
          </TouchableOpacity>
        </View>
        <FlatList
          data={participants}
          keyExtractor={(item) => item.user_id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.participantItem}
              onPress={() => {
                onSelectParticipant(item);
                onClose();
              }}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {getParticipantInitial(item)}
                </Text>
              </View>
              <View style={styles.participantInfo}>
                <Text style={styles.participantName}>
                  {getParticipantDisplayName(item)}
                </Text>
                {item.profiles?.username && (
                  <Text style={styles.participantUsername}>
                    @{item.profiles.username}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          style={styles.list}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80, // Position above input field
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  popover: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 4,
  },
  list: {
    maxHeight: 250,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eb7825',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  participantUsername: {
    fontSize: 13,
    color: '#666',
  },
});

