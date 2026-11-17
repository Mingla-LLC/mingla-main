import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { receivedBubbleTokens } from '../../constants/chatTokens';

interface ReplyQuoteBlockProps {
  senderName: string;
  previewText: string;
  imageUrl?: string;
  variant: 'sent' | 'received';
  onPress?: () => void;
  isDeleted?: boolean;
  /**
   * Issue #4456: why the original is not shown. 'unsent' reads "Message
   * unsent"; anything else (deleted for me, not loaded) "Message not available".
   */
  deletedState?: 'unsent' | 'unavailable';
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
  deletedState = 'unavailable',
}: ReplyQuoteBlockProps): React.ReactElement {
  const { t } = useTranslation(['chat']);
  const isSent = variant === 'sent';
  const deletedText = deletedState === 'unsent' ? t('chat:replyQuoteUnsent') : t('chat:replyQuoteUnavailable');
  const a11yLabel = senderName
    ? t('chat:a11yReplyingTo', { name: senderName, text: isDeleted ? deletedText : previewText })
    : t('chat:a11yReplyingToUnknown', { text: isDeleted ? deletedText : previewText });

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
      accessibilityLabel={a11yLabel}
      accessibilityHint={onPress ? t('chat:a11yReplyJumpHint') : undefined}
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
          <Text style={[styles.previewText, isSent ? styles.deletedTextSent : styles.deletedText]}>
            {deletedText}
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
  // Issue #4114 Wave 7: the received variant sits in the dark received bubble.
  containerReceived: {
    backgroundColor: receivedBubbleTokens.quoteBg,
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
    backgroundColor: receivedBubbleTokens.quoteBar,
  },
  accentBarSent: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  content: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto' as const,
    minWidth: 0,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
  },
  senderNameReceived: {
    color: receivedBubbleTokens.quoteName,
  },
  senderNameSent: {
    color: '#FFFFFF',
  },
  previewText: {
    fontSize: 12,
    marginTop: 1,
  },
  previewTextReceived: {
    color: receivedBubbleTokens.quoteText,
  },
  previewTextSent: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  deletedTextSent: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontStyle: 'italic',
  },
  deletedText: {
    color: receivedBubbleTokens.quoteDeleted,
    fontStyle: 'italic',
  },
  thumbnail: {
    width: 32,
    height: 32,
    borderRadius: 4,
    marginLeft: 8,
  },
});
