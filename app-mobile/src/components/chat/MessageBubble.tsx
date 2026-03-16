import React from 'react';
import { View, Text, StyleSheet, Dimensions, Image } from 'react-native';
import { Icon } from '../ui/Icon';
import { colors, typography, fontWeights, radius, spacing } from '../../constants/designSystem';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MessageData {
  id: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file';
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  isMe: boolean;
  failed?: boolean;
}

interface MessageBubbleProps {
  message: MessageData;
  isMe: boolean;
  groupPosition: 'solo' | 'first' | 'middle' | 'last';
  showTimestamp: boolean;
  isRead: boolean;
}

function formatTimestampForPill(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekAgo = new Date(todayStart);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (date.getTime() >= todayStart.getTime()) {
    return timeStr;
  }

  if (date.getTime() >= weekAgo.getTime()) {
    const dayStr = date.toLocaleDateString([], { weekday: 'short' });
    return `${dayStr} ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}

// Pre-computed border radius constants (8 variants: sent/received × 4 positions)
const FULL = 16;
const SMALL = 4;

const BORDER_RADIUS = {
  sent: {
    solo: { borderTopLeftRadius: FULL, borderTopRightRadius: FULL, borderBottomLeftRadius: FULL, borderBottomRightRadius: SMALL },
    first: { borderTopLeftRadius: FULL, borderTopRightRadius: FULL, borderBottomLeftRadius: FULL, borderBottomRightRadius: SMALL },
    middle: { borderTopLeftRadius: FULL, borderTopRightRadius: SMALL, borderBottomLeftRadius: FULL, borderBottomRightRadius: SMALL },
    last: { borderTopLeftRadius: FULL, borderTopRightRadius: SMALL, borderBottomLeftRadius: FULL, borderBottomRightRadius: FULL },
  },
  received: {
    solo: { borderTopLeftRadius: SMALL, borderTopRightRadius: FULL, borderBottomLeftRadius: FULL, borderBottomRightRadius: FULL },
    first: { borderTopLeftRadius: SMALL, borderTopRightRadius: FULL, borderBottomLeftRadius: FULL, borderBottomRightRadius: FULL },
    middle: { borderTopLeftRadius: SMALL, borderTopRightRadius: FULL, borderBottomLeftRadius: SMALL, borderBottomRightRadius: FULL },
    last: { borderTopLeftRadius: SMALL, borderTopRightRadius: FULL, borderBottomLeftRadius: FULL, borderBottomRightRadius: FULL },
  },
} as const;

export function MessageBubble({ message, isMe, groupPosition, showTimestamp, isRead }: MessageBubbleProps) {
  const borderRadius = BORDER_RADIUS[isMe ? 'sent' : 'received'][groupPosition];
  const isGroupEnd = groupPosition === 'last' || groupPosition === 'solo';
  const isDelivered = !message.id.startsWith('temp-');
  const isFailed = message.failed === true;

  return (
    <View style={isGroupEnd ? styles.spacingGroupEnd : styles.spacingGroupContinue}>
      {/* Timestamp pill */}
      {showTimestamp && (
        <View style={styles.timestampContainer}>
          <View style={styles.timestampPill}>
            <Text style={styles.timestampText}>
              {formatTimestampForPill(message.timestamp)}
            </Text>
          </View>
        </View>
      )}

      {/* Bubble */}
      <View
        style={[
          styles.bubbleRow,
          isMe ? styles.bubbleRowRight : styles.bubbleRowLeft,
        ]}
        accessibilityLabel={`${isMe ? 'You' : 'Friend'} said: ${message.content}, ${formatTimestampForPill(message.timestamp)}`}
        accessibilityRole="text"
      >
        <View
          style={[
            styles.bubble,
            isMe ? styles.bubbleSent : styles.bubbleReceived,
            borderRadius,
            isFailed && styles.bubbleFailed,
            !isDelivered && !isFailed && styles.bubbleSending,
          ]}
        >
          {message.type === 'text' && (
            <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
              {message.content}
            </Text>
          )}

          {message.type === 'image' && message.fileUrl && (
            <View style={styles.mediaContainer}>
              {message.content && message.content !== message.fileName && (
                <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived, styles.mediaCaption]}>
                  {message.content}
                </Text>
              )}
              <Image
                source={{ uri: message.fileUrl }}
                style={[styles.mediaImage, borderRadius]}
                resizeMode="cover"
              />
            </View>
          )}

          {message.type === 'video' && (
            <View style={styles.mediaContainer}>
              {message.content && message.content !== message.fileName && (
                <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived, styles.mediaCaption]}>
                  {message.content}
                </Text>
              )}
              <View style={[styles.videoPlaceholder, borderRadius]}>
                <Icon name="play-circle" size={40} color={isMe ? 'white' : colors.primary[500]} />
              </View>
            </View>
          )}

          {message.type === 'file' && (
            <View style={styles.fileContainer}>
              <Icon name="document-text" size={16} color={isMe ? 'white' : colors.primary[500]} />
              <View style={styles.fileInfo}>
                <Text style={[styles.fileName, isMe ? styles.textSent : styles.textReceived]} numberOfLines={1}>
                  {message.fileName || 'Document'}
                </Text>
                <Text style={[styles.fileSize, isMe ? { color: 'rgba(255,255,255,0.7)' } : { color: colors.text.tertiary }]}>
                  {message.fileSize || 'Unknown size'}
                </Text>
              </View>
            </View>
          )}

          {/* Failed indicator */}
          {isFailed && (
            <View style={styles.failedIcon}>
              <Icon name="alert-circle" size={14} color={colors.error[500]} />
            </View>
          )}
        </View>
      </View>

      {/* Read receipt — only on last sent message in group */}
      {isMe && (groupPosition === 'solo' || groupPosition === 'last') && (
        <View style={styles.readReceiptContainer}>
          {isFailed ? (
            <Text style={styles.failedText}>Failed</Text>
          ) : !isDelivered ? (
            <Icon name="checkmark" size={12} color={colors.gray[400]} />
          ) : isRead ? (
            <Icon name="checkmark-done" size={12} color={colors.primary[500]} />
          ) : (
            <Icon name="checkmark-done" size={12} color={colors.gray[400]} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  spacingGroupEnd: {
    marginBottom: 12,
  },
  spacingGroupContinue: {
    marginBottom: 2,
  },
  timestampContainer: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  timestampPill: {
    backgroundColor: colors.chat.timestampPill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  timestampText: {
    fontSize: typography.xs.fontSize,
    lineHeight: typography.xs.lineHeight,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
  },
  bubbleRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
  },
  bubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: SCREEN_WIDTH * 0.78,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleSent: {
    backgroundColor: colors.chat.bubbleSent,
  },
  bubbleReceived: {
    backgroundColor: colors.chat.bubbleReceived,
  },
  bubbleFailed: {
    borderWidth: 1,
    borderColor: colors.error[400],
  },
  bubbleSending: {
    opacity: 0.7,
  },
  messageText: {
    fontSize: typography.md.fontSize,
    lineHeight: 21,
  },
  textSent: {
    color: colors.text.inverse,
  },
  textReceived: {
    color: colors.text.primary,
  },
  mediaContainer: {
    gap: 4,
  },
  mediaCaption: {
    marginBottom: 4,
  },
  mediaImage: {
    width: 240,
    height: 200,
    margin: -9, // near edge-to-edge (12px padding - 3px desired)
    marginTop: 0,
  },
  videoPlaceholder: {
    width: 240,
    height: 160,
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    margin: -9,
    marginTop: 0,
  },
  fileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
  },
  fileSize: {
    fontSize: 12,
    marginTop: 1,
  },
  failedIcon: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  readReceiptContainer: {
    alignItems: 'flex-end',
    paddingRight: 14,
    marginTop: 2,
  },
  failedText: {
    fontSize: typography.xs.fontSize,
    color: colors.error[500],
    fontWeight: fontWeights.medium,
  },
});
