import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

interface ReplyQuoteBlockProps {
  senderName: string;
  previewText: string;
  imageUrl?: string;
  variant: 'sent' | 'received';
  onPress?: () => void;
  isDeleted?: boolean;
}

/**
 * Compact quoted block rendered inside a reply message bubble.
 * Shows the original message's sender name and truncated content
 * with a colored accent bar on the left edge.
 */
export function ReplyQuoteBlock({
  senderName,
  previewText,
  imageUrl,
  variant,
  onPress,
  isDeleted = false,
}: ReplyQuoteBlockProps): React.ReactElement {
  const isSent = variant === 'sent';

  const handlePress = (): void => {
    if (onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  return (
    <TouchableOpacity
      style={[styles.container, isSent ? styles.containerSent : styles.containerReceived]}
      onPress={handlePress}
      disabled={!onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Replying to ${senderName}: ${isDeleted ? 'Message deleted' : previewText}. Double-tap to scroll to original.`}
    >
      {/* Accent bar */}
      <View style={[styles.accentBar, isSent ? styles.accentBarSent : styles.accentBarReceived]} />

      {/* Content */}
      <View style={styles.content}>
        <Text
          style={[styles.senderName, isSent ? styles.senderNameSent : styles.senderNameReceived]}
          numberOfLines={1}
        >
          {senderName}
        </Text>
        {isDeleted ? (
          <Text style={[styles.previewText, styles.deletedText]}>
            Message deleted
          </Text>
        ) : (
          <Text
            style={[styles.previewText, isSent ? styles.previewTextSent : styles.previewTextReceived]}
            numberOfLines={2}
          >
            {previewText}
          </Text>
        )}
      </View>

      {/* Image thumbnail (if original was an image) */}
      {imageUrl && !isDeleted && (
        <Image
          source={{ uri: imageUrl }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 8,
    paddingLeft: 0, // Accent bar provides the left edge
    paddingRight: 8,
    paddingVertical: 6,
    marginBottom: 6,
    overflow: 'hidden',
  },
  containerReceived: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  containerSent: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  accentBar: {
    width: 2.5,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    marginRight: 8,
  },
  accentBarReceived: {
    backgroundColor: '#eb7825',
  },
  accentBarSent: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
  },
  senderNameReceived: {
    color: '#1A1A1A',
  },
  senderNameSent: {
    color: '#FFFFFF',
  },
  previewText: {
    fontSize: 12,
    marginTop: 1,
  },
  previewTextReceived: {
    color: '#6B6B6B',
  },
  previewTextSent: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  deletedText: {
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  thumbnail: {
    width: 32,
    height: 32,
    borderRadius: 4,
    marginLeft: 8,
  },
});
