import React from 'react';
import { View, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from '../ui/Icon';

interface ExpandedCardHeaderProps {
  onClose: () => void;
}

export default function ExpandedCardHeader({
  onClose,
}: ExpandedCardHeaderProps) {
  return (
    <View style={styles.header}>
      <TrackedTouchableOpacity logComponent="ExpandedCardHeader"
        onPress={onClose}
        style={styles.closeButton}
        activeOpacity={0.7}
      >
        <Icon name="close" size={16} color="rgba(255,255,255,0.70)" />
      </TrackedTouchableOpacity>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    zIndex: 1000,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    width: 32,
  },
});

