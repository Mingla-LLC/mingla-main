import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { useSessionManagement } from '../../hooks/useSessionManagement';
import { useNavigation } from '../../contexts/NavigationContext';

interface ModeToggleButtonProps {
  style?: any;
}

export const ModeToggleButton: React.FC<ModeToggleButtonProps> = ({ style }) => {
  const { isInSolo, currentSession, loading } = useSessionManagement();
  const { openSessionSwitcher } = useNavigation();

  const handlePress = () => {
    openSessionSwitcher();
  };

  const displayText = isInSolo
    ? 'Solo'
    : currentSession?.name || 'Collaboration';

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={loading}
    >
      <View style={styles.content}>
        <Icon
          name={isInSolo ? 'person' : 'people'}
          size={16}
          color="#007AFF"
        />
        <Text style={styles.text} numberOfLines={1}>
          {displayText}
        </Text>
        <Icon
          name="chevron-down"
          size={12}
          color="#007AFF"
          style={styles.chevron}
        />
      </View>
      {!isInSolo && currentSession && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {currentSession.participants?.length || 0}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F0F7FF',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    maxWidth: 120,
  },
  chevron: {
    marginLeft: 2,
  },
  badge: {
    marginLeft: 8,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'white',
  },
});

