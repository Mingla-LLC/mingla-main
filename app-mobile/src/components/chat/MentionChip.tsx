import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { receivedBubbleTokens } from '../../constants/chatTokens';

interface MentionChipProps {
  name: string;
  onPress?: () => void;
  /** Issue #4114 Wave 7: 'receivedDark' sits inside the dark received chat bubble. */
  variant: 'sent' | 'received' | 'receivedDark';
}

const MAX_NAME_LENGTH = 20;

/**
 * Mention tag chip — solid orange pill with white text.
 * No @ prefix — the chip shape itself communicates "this is a tag."
 */
export function MentionChip({ name, onPress, variant }: MentionChipProps): React.ReactElement {
  const truncatedName = name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH)}...`
    : name;

  const isSent = variant === 'sent';
  const isDark = variant === 'receivedDark';

  const chip = (
    <View style={[styles.chip, isSent ? styles.chipSent : isDark ? styles.chipReceivedDark : styles.chipReceived]}>
      <Text
        style={[styles.text, isSent ? styles.textSent : isDark ? styles.textReceivedDark : styles.textReceived]}
        numberOfLines={1}
      >
        {truncatedName}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="link" accessibilityLabel={`Mentioned ${name}. Double-tap to view profile.`}>
        {chip}
      </TouchableOpacity>
    );
  }

  return chip;
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'baseline',
  },
  chipReceived: {
    backgroundColor: '#eb7825',
  },
  chipReceivedDark: {
    backgroundColor: receivedBubbleTokens.mentionBg,
  },
  chipSent: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 16,
  },
  textReceived: {
    color: '#FFFFFF',
  },
  textReceivedDark: {
    color: receivedBubbleTokens.mentionText,
  },
  textSent: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
