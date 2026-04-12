import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { getDisplayName } from '../../utils/getDisplayName';
import { Participant } from './ParticipantAvatars';
import { useTranslation } from 'react-i18next';

interface MentionPopoverProps {
  participants: Participant[];
  onSelectParticipant: (participant: Participant) => void;
  onClose: () => void;
  visible: boolean;
  keyboardHeight?: number;
}

export const MentionPopover: React.FC<MentionPopoverProps> = ({
  participants,
  onSelectParticipant,
  onClose,
  visible,
  keyboardHeight,
}) => {
  const { t } = useTranslation(['board', 'common']);
  if (!visible || participants.length === 0) {
    return null;
  }

  // When keyboardHeight is 0, the popover is rendered inside a relative anchor
  // above the input bar — no offset needed. Otherwise, use legacy absolute positioning.
  const bottomOffset = keyboardHeight ? keyboardHeight + 48 + 8 : 0;

  const getParticipantDisplayName = (participant: Participant): string => {
    const { display_name, first_name, last_name, username } = participant.profiles ?? {};

    const looksLikeEmail = (val: string | undefined | null): boolean => {
      if (!val) return false;
      if (val.includes("@")) return true;
      if (/^[a-z0-9_.]+_[a-f0-9]{4}$/.test(val)) return true;
      return false;
    };

    const humanize = (val: string): string => {
      let clean = val.includes("@") ? val.split("@")[0] : val;
      clean = clean.replace(/_[a-f0-9]{4}$/, "");
      return clean
        .replace(/[_.]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || "Unknown";
    };

    if (display_name && !looksLikeEmail(display_name)) return display_name;
    if (first_name && !looksLikeEmail(first_name)) {
      return last_name && !looksLikeEmail(last_name)
        ? `${first_name} ${last_name}`
        : first_name;
    }
    if (username && !looksLikeEmail(username)) return username;

    return humanize(getDisplayName(participant.profiles ?? {}, "Unknown"));
  };

  const getParticipantInitial = (participant: Participant): string => {
    const name = getParticipantDisplayName(participant);
    return name.charAt(0).toUpperCase();
  };

  return (
    <View style={[styles.container, { bottom: bottomOffset }]}>
      <View style={styles.popover}>
        <View style={styles.header}>
          <Text style={styles.headerText}>{t('board:mentionPopover.mentionSomeone')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={20} color="#666" />
          </TouchableOpacity>
        </View>
        <FlatList
          data={participants}
          keyExtractor={(item) => item.user_id}
          keyboardShouldPersistTaps="handled"
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
    bottom: 64, // Default fallback — overridden by dynamic inline style
    left: 0,
    right: 0,
    zIndex: 1000,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  popover: {
    backgroundColor: 'white',
    borderRadius: 12,
    maxHeight: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 4,
  },
  list: {
    maxHeight: 140,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eb7825',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  participantUsername: {
    fontSize: 13,
    color: '#666',
  },
});

