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
  /**
   * Issue #4114 Wave 6: the brand channel's "Next up" card — the same countdown,
   * pointed at the soonest upcoming event of the brand, with "+N more" for the
   * brand's other events (opens the brand page).
   */
  nextUp?: {
    dateLabel?: string | null;
    moreCount: number;
    onMorePress?: () => void;
  };
}

export const TripCountdownBanner: React.FC<TripCountdownBannerProps> = ({
  eventId,
  onPress,
  stackedWithChannel = false,
  nextUp,
}) => {
  const { t } = useTranslation(['chat']);
  const { days, status, eventName } = useTripCountdown(eventId);

  if (status === 'unknown' || status === 'past') return null;

  const safeName = eventName?.trim() || t('chat:countdownYourTrip');

  if (nextUp) {
    const kicker = status === 'today'
      ? t('chat:nextUpToday')
      : t('chat:nextUpInDays', { count: days ?? 0 });
    const line = nextUp.dateLabel ? `${safeName} · ${nextUp.dateLabel}` : safeName;
    return (
      <View style={styles.nextUpHost} testID="brand-channel-next-up">
        <TouchableOpacity
          style={styles.nextUpMain}
          activeOpacity={onPress ? 0.82 : 1}
          disabled={!onPress}
          onPress={onPress}
          accessibilityRole={onPress ? 'button' : 'text'}
          accessibilityLabel={onPress ? t('chat:countdownOpenEvent', { copy: `${kicker}, ${line}` }) : `${kicker}, ${line}`}
        >
          <View style={styles.iconShell}>
            <Icon name="calendar" size={17} color="#ffffff" />
          </View>
          <View style={styles.nextUpCopy}>
            <Text style={styles.nextUpKicker} numberOfLines={1}>{kicker}</Text>
            <Text style={styles.stackedText} numberOfLines={1}>{line}</Text>
          </View>
        </TouchableOpacity>
        {nextUp.moreCount > 0 ? (
          <TouchableOpacity
            style={styles.morePill}
            onPress={nextUp.onMorePress}
            disabled={!nextUp.onMorePress}
            accessibilityRole="button"
            accessibilityLabel={t('chat:moreEventsA11y', { count: nextUp.moreCount })}
            testID="brand-channel-next-up-more"
          >
            <Text style={styles.morePillText}>{t('chat:moreEvents', { count: nextUp.moreCount })}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

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
  nextUpHost: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 10,
  },
  nextUpMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nextUpCopy: {
    flex: 1,
    minWidth: 0,
  },
  nextUpKicker: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary[500],
    lineHeight: 16,
  },
  morePill: {
    flexShrink: 0,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  morePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
