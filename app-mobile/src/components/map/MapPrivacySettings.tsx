import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import Toggle from '../profile/Toggle';
import type { MapSettings } from '../../hooks/useMapSettings';

const VISIBILITY_LEVELS = ['off', 'paired', 'friends', 'friends_of_friends', 'everyone'] as const;
const VISIBILITY_LABELS: Record<string, string> = {
  off: 'Hidden',
  paired: 'Paired only',
  friends: 'Friends',
  friends_of_friends: 'Friends of friends',
  everyone: 'Everyone nearby',
};

interface MapPrivacySettingsProps {
  settings: MapSettings;
  onUpdate: (updates: Partial<MapSettings>) => void;
}

export function MapPrivacySettings({ settings, onUpdate }: MapPrivacySettingsProps) {
  const cycleVisibility = () => {
    const idx = VISIBILITY_LEVELS.indexOf(settings.visibility_level);
    const next = VISIBILITY_LEVELS[(idx + 1) % VISIBILITY_LEVELS.length];
    onUpdate({ visibility_level: next });
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>Map privacy</Text>

      <TouchableOpacity
        style={[styles.row, styles.rowMultiline]}
        onPress={cycleVisibility}
        activeOpacity={0.7}
      >
        <View style={styles.rowLabelWrap}>
          <Text style={styles.rowLabel}>Map Visibility</Text>
          <Text style={styles.rowHint}>Who sees your approximate location on the map</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.rowValueBold}>{VISIBILITY_LABELS[settings.visibility_level]}</Text>
          <Icon name="chevron-forward" size={16} color="#9ca3af" />
        </View>
      </TouchableOpacity>

      <View style={styles.rowDivider} />

      <View style={[styles.row, styles.rowMultiline]}>
        <View style={styles.rowLabelWrap}>
          <Text style={styles.rowLabel}>Show Saved Places</Text>
          <Text style={styles.rowHint}>Saved pins can appear on your map presence</Text>
        </View>
        <Toggle
          value={settings.show_saved_places}
          onToggle={() => onUpdate({ show_saved_places: !settings.show_saved_places })}
        />
      </View>

      <View style={styles.rowDivider} />

      <View style={[styles.row, styles.rowMultiline]}>
        <View style={styles.rowLabelWrap}>
          <Text style={styles.rowLabel}>Show Scheduled</Text>
          <Text style={styles.rowHint}>Upcoming plans visible on the map</Text>
        </View>
        <Toggle
          value={settings.show_scheduled_places}
          onToggle={() => onUpdate({ show_scheduled_places: !settings.show_scheduled_places })}
        />
      </View>
    </View>
  );
}

/** Matches AccountSettings accordion rows (padding, type, toggles). */
const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  rowMultiline: {
    alignItems: 'flex-start',
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginHorizontal: 16,
  },
  rowLabelWrap: {
    flex: 1,
    marginRight: 16,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  rowHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    lineHeight: 16,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  rowValueBold: {
    fontSize: 14,
    fontWeight: '700',
    color: '#eb7825',
  },
});
