import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';

const STATUS_PRESETS = [
  { key: 'exploring', label: 'Exploring', icon: 'compass-outline' },
  { key: 'plans', label: 'Looking for plans', icon: 'search-outline' },
  { key: 'meet', label: 'Open to meet', icon: 'hand-right-outline' },
  { key: 'busy', label: 'Busy', icon: 'close-circle-outline' },
] as const;

interface ActivityStatusPickerProps {
  currentStatus: string | null;
  onSetStatus: (status: string | null) => void;
}

export function ActivityStatusPicker({ currentStatus, onSetStatus }: ActivityStatusPickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState('');

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {STATUS_PRESETS.map(preset => {
          const isActive = currentStatus === preset.label;
          return (
            <TouchableOpacity
              key={preset.key}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => onSetStatus(isActive ? null : preset.label)}
              activeOpacity={0.7}
            >
              <Icon name={preset.icon} size={13} color={isActive ? '#FFF' : '#6b7280'} />
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{preset.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={[styles.chip, showCustom && styles.chipActive]}
          onPress={() => setShowCustom(p => !p)}
          activeOpacity={0.7}
        >
          <Icon name="create-outline" size={13} color={showCustom ? '#FFF' : '#6b7280'} />
          <Text style={[styles.chipText, showCustom && styles.chipTextActive]}>Custom</Text>
        </TouchableOpacity>
      </ScrollView>

      {showCustom && (
        <View style={styles.customRow}>
          <TextInput
            style={styles.customInput}
            value={customText}
            onChangeText={setCustomText}
            placeholder="What are you up to?"
            placeholderTextColor="#9ca3af"
            maxLength={50}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (customText.trim()) {
                onSetStatus(customText.trim());
                setShowCustom(false);
                setCustomText('');
              }
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 124,
    left: 0,
    right: 0,
    zIndex: 9,
    paddingHorizontal: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 16,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  chipActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#4b5563',
  },
  chipTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  customRow: {
    marginTop: 6,
    paddingHorizontal: 4,
  },
  customInput: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
});
