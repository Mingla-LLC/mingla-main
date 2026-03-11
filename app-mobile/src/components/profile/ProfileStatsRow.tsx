import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';

interface ProfileStatsRowProps {
  savedCount: number;
  connectionsCount: number;
  boardsCount: number;
  onStatPress?: (stat: 'saved' | 'connections' | 'boards') => void;
}

interface StatItemProps {
  count: number;
  label: string;
  statKey: 'saved' | 'connections' | 'boards';
  onPress?: (stat: 'saved' | 'connections' | 'boards') => void;
}

const StatItem: React.FC<StatItemProps> = ({ count, label, statKey, onPress }) => {
  const content = (
    <View style={styles.statItem}>
      <Text style={[styles.statNumber, { color: count > 0 ? '#eb7825' : '#111827' }]}>
        {count}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  if (onPress) {
    return (
      <TrackedTouchableOpacity logComponent="ProfileStatsRow" style={styles.statFlex} onPress={() => onPress(statKey)} activeOpacity={0.7}>
        {content}
      </TrackedTouchableOpacity>
    );
  }

  return <View style={styles.statFlex}>{content}</View>;
};

const ProfileStatsRow: React.FC<ProfileStatsRowProps> = ({
  savedCount,
  connectionsCount,
  boardsCount,
  onStatPress,
}) => (
  <View style={styles.container}>
    <StatItem count={savedCount} label="Saved" statKey="saved" onPress={onStatPress} />
    <View style={styles.divider} />
    <StatItem count={connectionsCount} label="Connections" statKey="connections" onPress={onStatPress} />
    <View style={styles.divider} />
    <StatItem count={boardsCount} label="Boards" statKey="boards" onPress={onStatPress} />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  statFlex: { flex: 1 },
  statItem: { alignItems: 'center' },
  statNumber: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  divider: { width: 1, height: 32, backgroundColor: '#e5e7eb' },
});

export default ProfileStatsRow;
