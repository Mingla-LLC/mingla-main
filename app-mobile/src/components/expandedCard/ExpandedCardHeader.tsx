import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ExpandedCardHeaderProps {
  onClose: () => void;
}

export default function ExpandedCardHeader({
  onClose,
}: ExpandedCardHeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onClose}
        style={styles.closeButton}
        activeOpacity={0.7}
      >
        <Ionicons name="close" size={16} color="#6b7280" />
      </TouchableOpacity>
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
    backgroundColor: '#ffffff',
    zIndex: 1000,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    width: 32,
  },
});

