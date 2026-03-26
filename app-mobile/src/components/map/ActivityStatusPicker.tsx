import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, Switch, StyleSheet, LayoutAnimation, UIManager, Platform } from 'react-native';
import { Icon } from '../ui/Icon';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const STATUS_PRESETS = [
  { key: 'exploring', label: 'Exploring', icon: 'compass-outline' },
  { key: 'plans', label: 'Looking for plans', icon: 'search-outline' },
  { key: 'meet', label: 'Open to meet', icon: 'hand-right-outline' },
  { key: 'busy', label: 'Busy', icon: 'close-circle-outline' },
] as const;

export type VisibilityLevel = 'off' | 'paired' | 'friends' | 'friends_of_friends' | 'everyone';

const VISIBILITY_OPTIONS: { key: VisibilityLevel; label: string; icon: string }[] = [
  { key: 'everyone', label: 'Everyone nearby', icon: 'globe-outline' },
  { key: 'friends_of_friends', label: 'Friends of friends', icon: 'people-circle-outline' },
  { key: 'friends', label: 'Friends only', icon: 'people-outline' },
  { key: 'paired', label: 'Paired only', icon: 'heart-outline' },
  { key: 'off', label: 'Hidden', icon: 'eye-off' },
];

interface ActivityStatusPickerProps {
  currentStatus: string | null;
  onSetStatus: (status: string | null) => void;
  peopleLayerOn: boolean;
  onTogglePeople: () => void;
  visibility: VisibilityLevel;
  onVisibilityChange: (level: VisibilityLevel) => void;
}

export function ActivityStatusPicker({
  currentStatus, onSetStatus,
  peopleLayerOn, onTogglePeople,
  visibility, onVisibilityChange,
}: ActivityStatusPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState('');

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(p => !p);
    if (expanded) setShowCustom(false);
  };

  const selectStatus = (label: string) => {
    const isActive = currentStatus === label;
    onSetStatus(isActive ? null : label);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(false);
    setShowCustom(false);
  };

  const visibilityLabel = VISIBILITY_OPTIONS.find(o => o.key === visibility)?.label || 'Friends only';

  return (
    <View style={styles.container}>
      {/* Expanded options — backdrop closes on tap outside */}
      {expanded && (
        <View style={styles.dropdown}>
          {showCustom && (
            <TextInput
              style={styles.customInput}
              value={customText}
              onChangeText={setCustomText}
              placeholder="What are you up to?"
              placeholderTextColor="#9ca3af"
              maxLength={50}
              returnKeyType="done"
              autoFocus
              onSubmitEditing={() => {
                if (customText.trim()) {
                  onSetStatus(customText.trim());
                  setExpanded(false);
                  setShowCustom(false);
                  setCustomText('');
                }
              }}
            />
          )}

          {/* Who sees you */}
          <Text style={styles.sectionLabel}>Who sees you</Text>
          {VISIBILITY_OPTIONS.map(opt => {
            const isActive = visibility === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.option, isActive && styles.optionActive]}
                onPress={() => onVisibilityChange(opt.key)}
                activeOpacity={0.7}
              >
                <Icon name={opt.icon} size={16} color={isActive ? '#eb7825' : '#6b7280'} />
                <Text style={[styles.optionText, isActive && styles.optionTextActive]}>{opt.label}</Text>
                {isActive && <Icon name="checkmark" size={14} color="#eb7825" />}
              </TouchableOpacity>
            );
          })}

          <View style={styles.divider} />

          {/* Show people toggle */}
          <View style={styles.toggleRow}>
            <Icon name="map-outline" size={16} color={peopleLayerOn ? '#eb7825' : '#6b7280'} />
            <Text style={[styles.optionText, peopleLayerOn && styles.optionTextActive]}>Show people on map</Text>
            <Switch
              value={peopleLayerOn}
              onValueChange={onTogglePeople}
              trackColor={{ true: '#eb7825', false: '#e5e7eb' }}
              thumbColor="#FFF"
              style={styles.toggle}
            />
          </View>

          <View style={styles.divider} />

          {/* Your status */}
          <Text style={styles.sectionLabel}>Your status</Text>
          {STATUS_PRESETS.map(preset => {
            const isActive = currentStatus === preset.label;
            return (
              <TouchableOpacity
                key={preset.key}
                style={[styles.option, isActive && styles.optionActive]}
                onPress={() => selectStatus(preset.label)}
                activeOpacity={0.7}
              >
                <Icon name={preset.icon} size={16} color={isActive ? '#eb7825' : '#6b7280'} />
                <Text style={[styles.optionText, isActive && styles.optionTextActive]}>{preset.label}</Text>
                {isActive && <Icon name="checkmark" size={14} color="#eb7825" />}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.option}
            onPress={() => setShowCustom(p => !p)}
            activeOpacity={0.7}
          >
            <Icon name="create-outline" size={16} color="#6b7280" />
            <Text style={styles.optionText}>Custom...</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main FAB — matches LayerToggles style */}
      <TouchableOpacity style={styles.mainFab} onPress={toggleExpanded} activeOpacity={0.8}>
        <Icon name={currentStatus ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={22} color="#FFF" />
      </TouchableOpacity>
      {currentStatus && (
        <View style={styles.statusLabel}>
          <View style={styles.statusDot} />
          <Text style={styles.statusLabelText} numberOfLines={1}>{currentStatus}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    left: 14,
    zIndex: 11,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  mainFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
  },
  statusLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    maxWidth: 160,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  statusLabelText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
  },
  dropdown: {
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 14,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    width: 220,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionActive: {
    backgroundColor: 'rgba(235,120,37,0.08)',
  },
  optionText: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
  optionTextActive: {
    color: '#eb7825',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toggle: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
  divider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginHorizontal: 10,
    marginVertical: 2,
  },
  customInput: {
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#FFF',
  },
});
