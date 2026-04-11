import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TypingIndicator } from './TypingIndicator';
import { colors, typography, fontWeights, radius } from '../../constants/designSystem';

interface ChatStatusLineProps {
  // DM mode
  isOnline?: boolean;
  isTyping?: boolean;
  lastSeenAt?: string | null;

  // Group chat mode
  onlineCount?: number;
  totalParticipants?: number;
  typingUserNames?: string[];
}

function formatLastSeen(lastSeenAt: string | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!lastSeenAt) return t('chat:offline');

  const now = Date.now();
  const seen = new Date(lastSeenAt).getTime();
  const diffMs = now - seen;

  if (diffMs < 60_000) return t('chat:lastSeenJustNow');
  if (diffMs < 3_600_000) return t('chat:lastSeenMinutes', { count: Math.floor(diffMs / 60_000) });

  const seenDate = new Date(lastSeenAt);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const timeStr = seenDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (seen >= todayStart.getTime()) return t('chat:lastSeenToday', { time: timeStr });
  if (seen >= yesterdayStart.getTime()) return t('chat:lastSeenYesterday', { time: timeStr });

  const monthStr = seenDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return t('chat:lastSeenDate', { date: monthStr, time: timeStr });
}

export function ChatStatusLine({
  isOnline,
  isTyping,
  lastSeenAt,
  onlineCount,
  totalParticipants,
  typingUserNames,
}: ChatStatusLineProps) {
  const { t } = useTranslation(['chat', 'common']);
  const isGroupMode = totalParticipants != null && totalParticipants > 1;

  if (isGroupMode) {
    // Group chat mode
    const typingNames = typingUserNames || [];

    if (typingNames.length > 0) {
      let label: string;
      if (typingNames.length === 1) {
        label = t('chat:isTyping', { name: typingNames[0] });
      } else if (typingNames.length === 2) {
        label = t('chat:twoTyping', { name1: typingNames[0], name2: typingNames[1] });
      } else {
        label = t('chat:multiTyping', { name: typingNames[0], count: typingNames.length - 1 });
      }
      return <TypingIndicator isVisible={true} label={label} />;
    }

    const online = onlineCount || 0;
    if (online === 0) {
      return <Text style={styles.offlineText}>{t('chat:noOneOnline')}</Text>;
    }
    // We don't have participant names here, so just show count
    return (
      <View style={styles.onlineContainer}>
        <View style={styles.onlineDot} />
        <Text style={styles.onlineText}>
          {t('chat:onlineCount', { count: online })}
        </Text>
      </View>
    );
  }

  // DM mode — typing takes priority
  if (isTyping) {
    return <TypingIndicator isVisible={true} />;
  }

  if (isOnline) {
    return (
      <View style={styles.onlineContainer}>
        <View style={styles.onlineDot} />
        <Text style={styles.onlineText}>{t('chat:online')}</Text>
      </View>
    );
  }

  return (
    <Text style={styles.offlineText}>
      {t('chat:lastSeen', { time: formatLastSeen(lastSeenAt || null, t) })}
    </Text>
  );
}

const styles = StyleSheet.create({
  onlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.success[500],
  },
  onlineText: {
    fontSize: typography.xs.fontSize,
    lineHeight: typography.xs.lineHeight,
    color: colors.success[600],
  },
  offlineText: {
    fontSize: typography.xs.fontSize,
    lineHeight: typography.xs.lineHeight,
    color: colors.text.tertiary,
  },
});
