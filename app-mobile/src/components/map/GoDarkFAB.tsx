import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';

interface GoDarkFABProps {
  isDark: boolean;
  onToggle: () => void;
}

export function GoDarkFAB({ isDark, onToggle }: GoDarkFABProps) {
  return (
    <TouchableOpacity
      style={[styles.fab, isDark && styles.fabDark]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <Icon name={isDark ? 'eye-off' : 'moon-outline'} size={20} color={isDark ? '#FFF' : '#6b7280'} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  fabDark: { backgroundColor: '#1f2937' },
});
