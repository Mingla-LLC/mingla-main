import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTripCountdown } from '../../hooks/useTripCountdown';
import { colors, radius, spacing, typography, fontWeights } from '../../constants/designSystem';

interface TripCountdownBannerProps {
  eventId: string;
}

export const TripCountdownBanner: React.FC<TripCountdownBannerProps> = ({ eventId }) => {
  const { days, status, eventName } = useTripCountdown(eventId);

  if (status === 'unknown' || status === 'past') return null;

  const safeName = eventName?.trim() || 'your trip';
  const copy =
    status === 'today'
      ? `Today is ${safeName}`
      : `${days ?? 0} ${(days ?? 0) === 1 ? 'day' : 'days'} until ${safeName}`;

  return (
    <View
      style={styles.host}
      accessibilityRole="text"
      accessibilityLabel={copy}
    >
      <Text style={styles.text} numberOfLines={1}>
        {copy}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary[500],
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  text: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
    textAlign: 'center',
  },
});
