import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTripCountdown } from '../../hooks/useTripCountdown';
import { colors, radius, spacing, typography, fontWeights } from '../../constants/designSystem';
import { Icon } from '../ui/Icon';

interface TripCountdownBannerProps {
  eventId: string;
  onPress?: () => void;
  stackedWithChannel?: boolean;
}

export const TripCountdownBanner: React.FC<TripCountdownBannerProps> = ({
  eventId,
  onPress,
  stackedWithChannel = false,
}) => {
  const { t } = useTranslation(['chat']);
  const { days, status, eventName } = useTripCountdown(eventId);

  if (status === 'unknown' || status === 'past') return null;

  const safeName = eventName?.trim() || t('chat:countdownYourTrip');

  const copy =
    status === 'today'
      ? t('chat:countdownToday', { name: safeName })
      : t('chat:countdownDaysOut', { count: days ?? 0, name: safeName });
  const displayCopy = onPress ? `${copy} · ${t('chat:countdownViewDetails')}` : copy;

  const content = stackedWithChannel ? (
    <>
      <View style={styles.iconShell}>
        <Icon name="calendar" size={17} color="#ffffff" />
      </View>
      <Text style={styles.stackedText} numberOfLines={1}>
        {displayCopy}
      </Text>
    </>
  ) : (
    <Text style={styles.text} numberOfLines={1}>
      {displayCopy}
    </Text>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.host, stackedWithChannel && styles.hostStackedWithChannel]}
        activeOpacity={0.82}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('chat:countdownOpenEvent', { copy })}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={[styles.host, stackedWithChannel && styles.hostStackedWithChannel]}
      accessibilityRole="text"
      accessibilityLabel={copy}
    >
      {content}
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
  hostStackedWithChannel: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: spacing.sm,
    backgroundColor: 'transparent',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  text: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
    textAlign: 'center',
  },
  iconShell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  stackedText: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 20,
  },
});
