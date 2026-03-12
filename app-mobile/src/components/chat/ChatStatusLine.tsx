import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'offline';

  const now = Date.now();
  const seen = new Date(lastSeenAt).getTime();
  const diffMs = now - seen;

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;

  const seenDate = new Date(lastSeenAt);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const timeStr = seenDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (seen >= todayStart.getTime()) return `today at ${timeStr}`;
  if (seen >= yesterdayStart.getTime()) return `yesterday at ${timeStr}`;

  const monthStr = seenDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${monthStr} at ${timeStr}`;
}

export function ChatStatusLine({
  isOnline,
  isTyping,
  lastSeenAt,
  onlineCount,
  totalParticipants,
  typingUserNames,
}: ChatStatusLineProps) {
  const isGroupMode = totalParticipants != null && totalParticipants > 1;

  if (isGroupMode) {
    // Group chat mode
    const typingNames = typingUserNames || [];

    if (typingNames.length > 0) {
      let label: string;
      if (typingNames.length === 1) {
        label = `${typingNames[0]} is typing`;
      } else if (typingNames.length === 2) {
        label = `${typingNames[0]} and ${typingNames[1]} are typing`;
      } else {
        label = `${typingNames[0]} and ${typingNames.length - 1} others are typing`;
      }
      return <TypingIndicator isVisible={true} label={label} />;
    }

    const online = onlineCount || 0;
    if (online === 0) {
      return <Text style={styles.offlineText}>No one online</Text>;
    }
    // We don't have participant names here, so just show count
    return (
      <View style={styles.onlineContainer}>
        <View style={styles.onlineDot} />
        <Text style={styles.onlineText}>
          {online} online
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
        <Text style={styles.onlineText}>Online</Text>
      </View>
    );
  }

  return (
    <Text style={styles.offlineText}>
      Last seen {formatLastSeen(lastSeenAt || null)}
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
