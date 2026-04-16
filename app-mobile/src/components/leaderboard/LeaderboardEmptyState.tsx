/**
 * ORCH-0437: Empty state when nobody is nearby on the leaderboard.
 * Motivational message + expand radius CTA.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { glass, colors } from '../../constants/designSystem';

interface LeaderboardEmptyStateProps {
  onExpandRadius: () => void;
}

export function LeaderboardEmptyState({ onExpandRadius }: LeaderboardEmptyStateProps): React.ReactElement {
  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        <Icon name="compass-outline" size={48} color={colors.gray[300]} />
        <Text style={styles.headline}>No one exploring nearby... yet</Text>
        <Text style={styles.subtext}>
          Expand your radius to find more people, or check back soon!
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={onExpandRadius}
          activeOpacity={0.8}
          accessibilityLabel="Expand search radius"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Expand Radius</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 32,
    paddingTop: 40,
    alignItems: 'center',
  },
  card: {
    ...glass.leaderboard.card,
    ...glass.shadowLight,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
  },
  headline: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: 16,
  },
  subtext: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.gray[500],
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  button: {
    marginTop: 20,
    backgroundColor: colors.accent,
    borderRadius: 12,
    height: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
});
