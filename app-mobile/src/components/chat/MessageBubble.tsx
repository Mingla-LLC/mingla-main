import React from 'react';
import { View, Text, StyleSheet, Dimensions, Image, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { colors, typography, fontWeights, radius, spacing } from '../../constants/designSystem';
import { MentionChip } from './MentionChip';
import { ReplyQuoteBlock } from './ReplyQuoteBlock';
import type { CardPayload } from '../../services/messagingService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MessageData {
  id: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file' | 'card';
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  cardPayload?: CardPayload;  // ORCH-0667
  isMe: boolean;
  failed?: boolean;
}

interface ReplyToData {
  senderName: string;
  content: string;
  imageUrl?: string;
  isDeleted?: boolean;
  messageId?: string;
}

interface MessageBubbleProps {
  message: MessageData;
  isMe: boolean;
  groupPosition: 'solo' | 'first' | 'middle' | 'last';
  showTimestamp: boolean;
  isRead: boolean;
  replyTo?: ReplyToData;
  onScrollToMessage?: (messageId: string) => void;
  onCardBubbleTap?: (payload: CardPayload) => void;  // ORCH-0667
}

/** Check if content has @mentions. */
function hasMentions(content: string): boolean {
  return /@[\w]/.test(content);
}

/**
 * Render message content with @mention chips.
 * Returns a View (flex-wrap) when mentions present, plain Text otherwise.
 */
function renderContentWithMentions(content: string, isMe: boolean): React.ReactElement {
  if (!hasMentions(content)) {
    return (
      <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
        {content}
      </Text>
    );
  }

  const regex = /(@[\w\s]+?)(?=\s@|\s#|$)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`t-${lastIndex}`} style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
          {content.slice(lastIndex, match.index)}
        </Text>
      );
    }
    const mentionName = match[0].slice(1).trim();
    parts.push(
      <MentionChip
        key={`m-${match.index}`}
        name={mentionName}
        variant={isMe ? 'sent' : 'received'}
      />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(
      <Text key={`t-${lastIndex}`} style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
        {content.slice(lastIndex)}
      </Text>
    );
  }

  return (
    <View style={styles.contentWithMentions}>
      {parts}
    </View>
  );
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

export function MessageBubble({ message, isMe, groupPosition, showTimestamp, isRead, replyTo, onScrollToMessage, onCardBubbleTap }: MessageBubbleProps) {
  const { t } = useTranslation(['chat', 'common']);
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
        accessibilityLabel={isMe ? t('chat:youSaid', { content: message.content, time: formatTimestampForPill(message.timestamp) }) : t('chat:friendSaid', { content: message.content, time: formatTimestampForPill(message.timestamp) })}
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
          {/* Reply quote block (Wave 2 will wire data; renders when replyTo prop is provided) */}
          {replyTo && (
            <ReplyQuoteBlock
              senderName={replyTo.senderName}
              previewText={replyTo.content}
              imageUrl={replyTo.imageUrl}
              variant={isMe ? 'sent' : 'received'}
              isDeleted={replyTo.isDeleted}
              onPress={replyTo.messageId && onScrollToMessage ? () => onScrollToMessage(replyTo.messageId!) : undefined}
            />
          )}

          {message.type === 'text' && renderContentWithMentions(message.content, isMe)}

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
                  {message.fileName || t('chat:document')}
                </Text>
                <Text style={[styles.fileSize, isMe ? { color: 'rgba(255,255,255,0.7)' } : { color: colors.text.tertiary }]}>
                  {message.fileSize || t('chat:unknownSize')}
                </Text>
              </View>
            </View>
          )}

          {/* ORCH-0667: shared saved-card bubble */}
          {message.type === 'card' && message.cardPayload && (
            <TouchableOpacity
              onPress={() => onCardBubbleTap?.(message.cardPayload!)}
              activeOpacity={0.85}
              style={styles.cardBubbleContainer}
            >
              {message.cardPayload.image ? (
                <Image
                  source={{ uri: message.cardPayload.image }}
                  style={styles.cardBubbleImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.cardBubbleImage, styles.cardBubblePlaceholder]}>
                  <Icon name="bookmark" size={24} color={isMe ? 'rgba(255,255,255,0.7)' : colors.text.tertiary} />
                </View>
              )}
              <View style={styles.cardBubbleBody}>
                <Text
                  style={[styles.cardBubbleTitle, isMe ? styles.textSent : styles.textReceived]}
                  numberOfLines={2}
                >
                  {message.cardPayload.title}
                </Text>
                {message.cardPayload.category ? (
                  <View style={styles.cardBubbleChip}>
                    <Text style={styles.cardBubbleChipText} numberOfLines={1}>
                      {message.cardPayload.category}
                    </Text>
                  </View>
                ) : null}
                <Text
                  style={[styles.cardBubbleHint, isMe ? styles.textSent : styles.textReceived]}
                >
                  {t('chat:cardBubbleTapHint')}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* ORCH-0667: defense-in-depth — card-type message with missing payload */}
          {message.type === 'card' && !message.cardPayload && (
            <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
              {t('chat:cardBubbleUnavailable')}
            </Text>
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
            <Text style={styles.failedText}>{t('chat:failed')}</Text>
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
    marginBottom: 6,
  },
  spacingGroupContinue: {
    marginBottom: 1,
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
  contentWithMentions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 2,
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
  // ORCH-0667: shared-card bubble styles
  cardBubbleContainer: {
    width: SCREEN_WIDTH * 0.6,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  cardBubbleImage: {
    width: '100%',
    aspectRatio: 16 / 10,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  cardBubblePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBubbleBody: {
    padding: 10,
    gap: 4,
  },
  cardBubbleTitle: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
  },
  cardBubbleChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 2,
  },
  cardBubbleChipText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
  },
  cardBubbleHint: {
    fontSize: 11,
    opacity: 0.7,
    marginTop: 2,
  },
});
