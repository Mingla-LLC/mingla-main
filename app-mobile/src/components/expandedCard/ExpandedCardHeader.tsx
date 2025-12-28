import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ExpandedCardHeaderProps {
  matchScore?: number;
  onClose: () => void;
}

export default function ExpandedCardHeader({
  matchScore,
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
      {matchScore !== undefined && (
        <View style={styles.matchBadge}>
          <Ionicons name="sparkles" size={16} color="#ffffff" />
          <Text style={styles.matchText}>{matchScore}% Match</Text>
        </View>
      )}
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
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eb7825',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  matchText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  headerSpacer: {
    width: 32,
  },
});

