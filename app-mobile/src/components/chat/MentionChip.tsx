import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface MentionChipProps {
  name: string;
  onPress?: () => void;
  variant: 'sent' | 'received';
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

  const chip = (
    <View style={[styles.chip, isSent ? styles.chipSent : styles.chipReceived]}>
      <Text style={[styles.text, isSent ? styles.textSent : styles.textReceived]} numberOfLines={1}>
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
  textSent: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
