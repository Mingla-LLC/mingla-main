import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { Icon } from '../ui/Icon';
import type { MapSettings } from '../../hooks/useMapSettings';

const VISIBILITY_LEVELS = ['off', 'paired', 'friends', 'everyone'] as const;
const VISIBILITY_LABELS: Record<string, string> = {
  off: 'Hidden',
  paired: 'Paired only',
  friends: 'Friends',
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
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Map Privacy</Text>

      <TouchableOpacity style={styles.row} onPress={cycleVisibility} activeOpacity={0.7}>
        <View style={styles.rowLeft}>
          <Icon name="eye-outline" size={18} color="#6b7280" />
          <View>
            <Text style={styles.rowLabel}>Map Visibility</Text>
            <Text style={styles.rowHint}>Who sees your approximate location</Text>
          </View>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.rowValue}>{VISIBILITY_LABELS[settings.visibility_level]}</Text>
          <Icon name="chevron-forward" size={16} color="#9ca3af" />
        </View>
      </TouchableOpacity>

      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Icon name="heart-outline" size={18} color="#6b7280" />
          <Text style={styles.rowLabel}>Show Saved Places</Text>
        </View>
        <Switch
          value={settings.show_saved_places}
          onValueChange={(v) => onUpdate({ show_saved_places: v })}
          trackColor={{ true: '#eb7825', false: '#e5e7eb' }}
          thumbColor="#FFF"
        />
      </View>

      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Icon name="calendar-outline" size={18} color="#6b7280" />
          <Text style={styles.rowLabel}>Show Scheduled</Text>
        </View>
        <Switch
          value={settings.show_scheduled_places}
          onValueChange={(v) => onUpdate({ show_scheduled_places: v })}
          trackColor={{ true: '#eb7825', false: '#e5e7eb' }}
          thumbColor="#FFF"
        />
      </View>

      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Icon name="time-outline" size={18} color="#6b7280" />
          <View>
            <Text style={styles.rowLabel}>Time Delay</Text>
            <Text style={styles.rowHint}>Show position from 30 min ago</Text>
          </View>
        </View>
        <Switch
          value={settings.time_delay_enabled}
          onValueChange={(v) => onUpdate({ time_delay_enabled: v })}
          trackColor={{ true: '#eb7825', false: '#e5e7eb' }}
          thumbColor="#FFF"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 10, marginLeft: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowLabel: { fontSize: 15, color: '#111827' },
  rowHint: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#eb7825' },
});
