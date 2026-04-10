import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, LayoutAnimation, UIManager, Platform } from 'react-native';
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
  { key: 'everyone', label: 'Everyone', icon: 'globe-outline' },
  { key: 'friends_of_friends', label: 'Friends of friends', icon: 'people-circle-outline' },
  { key: 'friends', label: 'Friends', icon: 'people-outline' },
  { key: 'paired', label: 'Paired', icon: 'heart-outline' },
  { key: 'off', label: 'Nobody', icon: 'eye-off' },
];

interface ActivityStatusPickerProps {
  currentStatus: string | null;
  onSetStatus: (status: string | null) => void;
  peopleLayerOn: boolean;
  onTogglePeople: () => void;
  placesLayerOn: boolean;
  onTogglePlaces: () => void;
  feedOn: boolean;
  onToggleFeed: () => void;
  heatmapOn: boolean;
  onToggleHeatmap: () => void;
  visibility: VisibilityLevel;
  onVisibilityChange: (level: VisibilityLevel) => void;
  /** Coach mark ref — attaches to the FAB button for spotlight measurement */
  fabRef?: (node: any) => void;
}

export function ActivityStatusPicker({
  currentStatus, onSetStatus,
  peopleLayerOn, onTogglePeople,
  placesLayerOn, onTogglePlaces,
  feedOn, onToggleFeed,
  heatmapOn, onToggleHeatmap,
  visibility, onVisibilityChange,
  fabRef,
}: ActivityStatusPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const [visDropdownOpen, setVisDropdownOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  const toggleExpanded = () => {
    if (Platform.OS === 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(p => !p);
    if (expanded) {
      setShowCustom(false);
      setVisDropdownOpen(false);
      setStatusDropdownOpen(false);
    }
  };

  const selectStatus = (label: string) => {
    const isActive = currentStatus === label;
    onSetStatus(isActive ? null : label);
    if (Platform.OS === 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStatusDropdownOpen(false);
    setShowCustom(false);
  };

  const visibilityLabel = VISIBILITY_OPTIONS.find(o => o.key === visibility)?.label || 'Friends';
  const visibilityIcon = VISIBILITY_OPTIONS.find(o => o.key === visibility)?.icon || 'people-outline';
  const statusIcon = STATUS_PRESETS.find(p => p.label === currentStatus)?.icon || 'chatbubble-ellipses-outline';

  return (
    <View style={[styles.container, currentStatus && !expanded && styles.containerWithStatus]}>
      {expanded && (
        <View style={styles.dropdown}>
          {/* Who sees you — compact dropdown at top */}
          <Text style={styles.sectionLabel}>Who sees you</Text>
          <TouchableOpacity
            style={styles.visSelector}
            onPress={() => {
              if (Platform.OS === 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setVisDropdownOpen(p => !p);
            }}
            activeOpacity={0.7}
          >
            <Icon name={visibilityIcon} size={13} color="#eb7825" />
            <Text style={styles.visSelectorText}>{visibilityLabel}</Text>
            <Icon name={visDropdownOpen ? 'chevron-up' : 'chevron-down'} size={12} color="#9ca3af" />
          </TouchableOpacity>

          {visDropdownOpen && (
            <View style={styles.visOptions}>
              {VISIBILITY_OPTIONS.map(opt => {
                const isActive = visibility === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.visOption, isActive && styles.visOptionActive]}
                    onPress={() => {
                      onVisibilityChange(opt.key);
                      if (Platform.OS === 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                      setVisDropdownOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Icon name={opt.icon} size={12} color={isActive ? '#eb7825' : '#6b7280'} />
                    <Text style={[styles.visOptionText, isActive && styles.visOptionTextActive]}>{opt.label}</Text>
                    {isActive && <Icon name="checkmark" size={10} color="#eb7825" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={styles.divider} />

          {/* Map layers — toggles */}
          <Text style={styles.sectionLabel}>Show on map</Text>
          <ToggleRow label="People" icon="people-outline" on={peopleLayerOn} onToggle={onTogglePeople} />
          <ToggleRow label="Places" icon="location-outline" on={placesLayerOn} onToggle={onTogglePlaces} />
          <ToggleRow label="Feed" icon="notifications-outline" on={feedOn} onToggle={onToggleFeed} />
          <ToggleRow label="Heatmap" icon="flame-outline" on={heatmapOn} onToggle={onToggleHeatmap} />

          <View style={styles.divider} />

          {/* Your status — collapsible */}
          <Text style={styles.sectionLabel}>Your status</Text>
          <TouchableOpacity
            style={styles.visSelector}
            onPress={() => {
              if (Platform.OS === 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setStatusDropdownOpen(p => !p);
            }}
            activeOpacity={0.7}
          >
            <Icon name={statusIcon} size={13} color={currentStatus ? '#eb7825' : '#6b7280'} />
            <Text style={[styles.visSelectorText, !currentStatus && styles.visSelectorTextMuted]}>
              {currentStatus || 'None'}
            </Text>
            <Icon name={statusDropdownOpen ? 'chevron-up' : 'chevron-down'} size={12} color="#9ca3af" />
          </TouchableOpacity>

          {statusDropdownOpen && (
            <View style={styles.visOptions}>
              {currentStatus && (
                <TouchableOpacity
                  style={styles.visOption}
                  onPress={() => selectStatus(currentStatus)}
                  activeOpacity={0.7}
                >
                  <Icon name="close-circle-outline" size={12} color="#6b7280" />
                  <Text style={styles.visOptionText}>Clear status</Text>
                </TouchableOpacity>
              )}
              {STATUS_PRESETS.map(preset => {
                const isActive = currentStatus === preset.label;
                return (
                  <TouchableOpacity
                    key={preset.key}
                    style={[styles.visOption, isActive && styles.visOptionActive]}
                    onPress={() => selectStatus(preset.label)}
                    activeOpacity={0.7}
                  >
                    <Icon name={preset.icon} size={12} color={isActive ? '#eb7825' : '#6b7280'} />
                    <Text style={[styles.visOptionText, isActive && styles.visOptionTextActive]}>{preset.label}</Text>
                    {isActive && <Icon name="checkmark" size={10} color="#eb7825" />}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={styles.visOption}
                onPress={() => setShowCustom(p => !p)}
                activeOpacity={0.7}
              >
                <Icon name="create-outline" size={12} color="#6b7280" />
                <Text style={styles.visOptionText}>Custom...</Text>
              </TouchableOpacity>
              {showCustom && (
                <TextInput
                  style={styles.customInput}
                  value={customText}
                  onChangeText={setCustomText}
                  placeholder="What are you up to?"
                  placeholderTextColor="#9ca3af"
                  maxLength={30}
                  returnKeyType="done"
                  autoFocus
                  onSubmitEditing={() => {
                    if (customText.trim()) {
                      onSetStatus(customText.trim());
                      setStatusDropdownOpen(false);
                      setShowCustom(false);
                      setCustomText('');
                    }
                  }}
                />
              )}
            </View>
          )}
        </View>
      )}

      {/* Single FAB */}
      <TouchableOpacity ref={fabRef} style={styles.mainFab} onPress={toggleExpanded} activeOpacity={0.8}>
        <Icon name={expanded ? 'close' : 'options-outline'} size={22} color="#FFF" />
      </TouchableOpacity>
      {currentStatus && !expanded && (
        <View style={styles.statusLabel} pointerEvents="none">
          <View style={styles.statusDot} />
          <Text style={styles.statusLabelText}>{currentStatus}</Text>
        </View>
      )}
    </View>
  );
}

function ToggleRow({ label, icon, on, onToggle }: { label: string; icon: string; on: boolean; onToggle: () => void }) {
  return (
    <View style={styles.toggleRow}>
      <Icon name={icon} size={13} color={on ? '#eb7825' : '#6b7280'} />
      <Text style={[styles.toggleLabel, on && styles.toggleLabelActive]}>{label}</Text>
      <Switch
        value={on}
        onValueChange={onToggle}
        trackColor={{ true: '#eb7825', false: '#e5e7eb' }}
        thumbColor="#FFF"
        style={styles.toggle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    zIndex: 11,
    overflow: 'visible',
  },
  containerWithStatus: {
    bottom: 52,
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
    position: 'absolute',
    top: '100%',
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    minWidth: 120,
    maxWidth: 220,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginTop: 5,
  },
  statusLabelText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
  },
  dropdown: {
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 12,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    width: 200,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
  },

  /* Visibility dropdown selector */
  visSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    marginVertical: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(235,120,37,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(235,120,37,0.15)',
  },
  visSelectorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#eb7825',
    flex: 1,
  },
  visSelectorTextMuted: {
    color: '#9ca3af',
    fontWeight: '400',
  },
  visOptions: {
    marginHorizontal: 10,
    marginBottom: 2,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  visOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  visOptionActive: {
    backgroundColor: 'rgba(235,120,37,0.06)',
  },
  visOptionText: {
    fontSize: 11,
    color: '#374151',
    flex: 1,
  },
  visOptionTextActive: {
    color: '#eb7825',
    fontWeight: '600',
  },

  /* Toggle rows */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  toggleLabel: {
    fontSize: 12,
    color: '#374151',
    flex: 1,
  },
  toggleLabelActive: {
    color: '#eb7825',
    fontWeight: '600',
  },
  toggle: {
    transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }],
  },

  /* Status options */
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  optionActive: {
    backgroundColor: 'rgba(235,120,37,0.08)',
  },
  optionText: {
    fontSize: 12,
    color: '#374151',
    flex: 1,
  },
  optionTextActive: {
    color: '#eb7825',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginHorizontal: 10,
    marginVertical: 3,
  },
  customInput: {
    marginHorizontal: 10,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#FFF',
  },
});
