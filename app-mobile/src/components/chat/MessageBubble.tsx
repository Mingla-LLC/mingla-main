import React from 'react';
import { View, Text, StyleSheet, Dimensions, Image, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { colors, typography, fontWeights, radius, spacing } from '../../constants/designSystem';
import { MentionChip } from './MentionChip';
import { ReplyQuoteBlock } from './ReplyQuoteBlock';
import { ChatCardChip } from './ChatCardChip';
import { CollabLocationChips } from '../collab/CollabLocationChips';
import type { CardPayload, CardTagEntry, MentionEntry } from '../../services/messagingService';
import type { CollabDeadEndBannerPayload } from '../../services/collabDeadEndBannerService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MessageData {
  id: string;
  senderName?: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file' | 'card';
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  cardPayload?: CardPayload;  // ORCH-0667
  mentions?: Array<MentionEntry | string>;
  cardTags?: CardTagEntry[];
  marketingCampaignId?: string | null;
  isMe: boolean;
  failed?: boolean;
  // ORCH-0898: set true when the upstream message has sender_id === null (e.g., ORCH-0899
  // "Plan another outing" round-start announcements). Renders as a centered muted system
  // row with no chrome (no reactions, no replies, no swipe actions). The data-transform
  // layer that builds MessageData populates this from messages.sender_id === null.
  isSystem?: boolean;
  // ORCH-1058B: structured collab dead-end banner payload. When present (and
  // isSystem), the system row renders participant·City/ST chips + a tappable
  // prefs button FROM DATA instead of parsing prose. Populated by the data
  // transform when card_payload?.kind === 'collab_dead_end'.
  systemPayload?: CollabDeadEndBannerPayload;
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
  onMentionTap?: (userId: string) => void;
  onCardTagTap?: (cardTag: CardTagEntry) => void;
  onSystemTokenPress?: (token: CollabSystemToken) => void;
}

export type CollabSystemToken =
  | { type: 'open-prefs'; section: CollabSystemPrefSection; userId: string }
  | { type: 'open-prefs-self'; section: CollabSystemPrefSection }
  | { type: 'open-dismissed' }
  | { type: 'compose-mention'; userId: string; text: string };

// ORCH-1058B: the structured banner `action` IS a CollabSystemToken. Sharing
// this one type between the poster (collabDeadEndBannerService.ts) and the
// renderer means a poster/renderer divergence is a TypeScript error, not a
// runtime drift — killing the two-mirrors problem (CF-1) for the action.
export type CollabSystemAction = CollabSystemToken;

type CollabSystemPrefSection = 'travel' | 'location' | 'categories' | 'dates';
const SYSTEM_TOKEN_REGEX = /(\[\[[a-z\-]+(?::[a-zA-Z0-9\-_,]+)*\]\])/g;
const VALID_PREF_SECTIONS = new Set(['travel', 'location', 'categories', 'dates']);

function isStructuredMention(entry: MentionEntry | string): entry is MentionEntry {
  return typeof entry !== 'string';
}

/**
 * Render message content with @mention chips.
 * Returns a View (flex-wrap) when mentions present, plain Text otherwise.
 */
function renderContentWithMentions(
  content: string,
  mentions: Array<MentionEntry | string> | undefined,
  isMe: boolean,
  onMentionTap?: (userId: string) => void,
): React.ReactElement {
  const mentionEntries = Array.isArray(mentions) ? mentions : [];
  const structuredMentions = mentionEntries
    .filter(isStructuredMention)
    .filter((mention) =>
      Number.isInteger(mention.startOffset) &&
      Number.isInteger(mention.endOffset) &&
      mention.startOffset >= 0 &&
      mention.endOffset > mention.startOffset &&
      mention.startOffset < content.length,
    )
    .sort((a, b) => a.startOffset - b.startOffset);

  if (structuredMentions.length > 0) {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    structuredMentions.forEach((mention, index) => {
      const start = Math.max(mention.startOffset, lastIndex);
      const end = Math.min(mention.endOffset, content.length);
      if (start > lastIndex) {
        parts.push(
          <Text key={`t-${lastIndex}`} style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
            {content.slice(lastIndex, start)}
          </Text>
        );
      }
      parts.push(
        <MentionChip
          key={`m-${mention.userId}-${index}`}
          name={mention.displayName || 'unknown'}
          variant={isMe ? 'sent' : 'received'}
          onPress={onMentionTap ? () => onMentionTap(mention.userId) : undefined}
        />
      );
      lastIndex = end;
    });

    if (lastIndex < content.length) {
      parts.push(
        <Text key={`t-${lastIndex}`} style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
          {content.slice(lastIndex)}
        </Text>
      );
    }

    return <View style={styles.contentWithMentions}>{parts}</View>;
  }

  if (!/@[\w]/.test(content)) {
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

export function MessageBubble({
  message,
  isMe,
  groupPosition,
  showTimestamp,
  isRead,
  replyTo,
  onScrollToMessage,
  onCardBubbleTap,
  onMentionTap,
  onCardTagTap,
  onSystemTokenPress,
}: MessageBubbleProps) {
  const { t } = useTranslation(['chat', 'common']);

  // ORCH-0898: system-message render branch — messages with no sender (ORCH-0899
  // "Plan another outing" round-start announcements, etc.) render as a centered muted
  // row with no chrome. Bypasses all the bubble + avatar + reactions + reply UI.
  if (message.isSystem) {
    // ORCH-1058B: a structured collab dead-end payload draws chips + a real
    // tappable button FROM DATA (raw [[…]] tokens NEVER parsed/rendered here).
    // Any other system row (legacy prose, ORCH-0908 lifecycle) falls back to the
    // existing prose-token parser, which strips tokens into inline buttons.
    if (message.systemPayload?.kind === 'collab_dead_end') {
      return (
        <View style={chatSystemRowStyles.systemPayloadRow} accessible={false}>
          {renderCollabDeadEndBanner(message.systemPayload, onSystemTokenPress)}
        </View>
      );
    }
    return (
      <View style={chatSystemRowStyles.row} accessible={false}>
        {renderSystemBannerContent(message.content, onSystemTokenPress)}
      </View>
    );
  }

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
          <Text
            style={[
              styles.senderName,
              isMe ? styles.senderNameSent : styles.senderNameReceived,
            ]}
            numberOfLines={1}
          >
            {message.senderName?.trim() || (isMe ? 'You' : 'Unknown')}
          </Text>

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

          {message.type === 'text' && (
            <>
              {renderContentWithMentions(message.content, message.mentions, isMe, onMentionTap)}
              {(message.cardTags ?? []).map((cardTag) => (
                <ChatCardChip
                  key={cardTag.savedCardId}
                  cardTag={cardTag}
                  onPress={(tag) => {
                    if (onCardTagTap) {
                      onCardTagTap(tag);
                    } else {
                      onCardBubbleTap?.(tag.cardPayload);
                    }
                  }}
                />
              ))}
            </>
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
                  {message.fileName || t('chat:document')}
                </Text>
                <Text style={[styles.fileSize, isMe ? { color: 'rgba(255,255,255,0.7)' } : { color: colors.text.tertiary }]}>
                  {message.fileSize || t('chat:unknownSize')}
                </Text>
              </View>
            </View>
          )}

          {/* ORCH-0667: shared saved-card bubble */}
          {message.type === 'card' && message.cardPayload && (() => {
            // ORCH-0908: defensive legacy-payload normalizer. The first cut of
            // the combined lock-and-schedule RPC nested the card under
            // card_payload.card_data; migration 20260630000000 flattens it +
            // backfills existing rows, but if any nested row slips through we
            // still render correctly by reading from .card_data as a fallback.
            const raw = message.cardPayload as any;
            const legacy = raw.card_data && typeof raw.card_data === 'object' ? raw.card_data : null;
            const cp = {
              ...message.cardPayload,
              image: raw.image ?? legacy?.image ?? null,
              title: raw.title ?? legacy?.title ?? 'Saved experience',
              category: raw.category ?? legacy?.category ?? null,
              lockInEvent: raw.lockInEvent
                ?? (raw.event === 'card_locked_and_scheduled' ? 'card_locked_and_scheduled' : undefined),
              scheduledAt: raw.scheduledAt ?? raw.scheduled_at ?? undefined,
              cardType: raw.cardType ?? legacy?.cardType,
              stops: raw.stops ?? legacy?.stops,
            };
            const isIntentCard = cp.cardType === 'curated' || (Array.isArray((cp as any).stops) && (cp as any).stops.length > 0);
            const intentStopCount = isIntentCard ? ((cp as any).stops?.length ?? 0) : 0;
            const intentHeroImage = isIntentCard ? ((cp as any).stops?.[0]?.imageUrl ?? cp.image) : cp.image;
            const effectiveImage = isIntentCard ? intentHeroImage : cp.image;
            return (
            <TouchableOpacity
              onPress={() => onCardBubbleTap?.(message.cardPayload!)}
              activeOpacity={0.85}
              style={styles.cardBubbleContainer}
            >
              {/* ORCH-0908: locked-in banner — only when card was shared via lock-and-schedule */}
              {cp.lockInEvent === 'card_locked_and_scheduled' && cp.scheduledAt && (
                <View style={styles.cardBubbleLockedBanner}>
                  <Icon name="lock-closed" size={12} color="#fff" />
                  <Text style={styles.cardBubbleLockedBannerText} numberOfLines={1}>
                    {`Locked in · ${new Date(cp.scheduledAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                  </Text>
                </View>
              )}
              <View style={styles.cardBubbleImageWrap}>
                {effectiveImage ? (
                  <Image
                    source={{ uri: effectiveImage }}
                    style={styles.cardBubbleImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.cardBubbleImage, styles.cardBubblePlaceholder]}>
                    <Icon name="bookmark" size={24} color={isMe ? 'rgba(255,255,255,0.7)' : colors.text.tertiary} />
                  </View>
                )}
                {isIntentCard && intentStopCount > 0 && (
                  <View style={styles.cardBubbleIntentChip}>
                    <Icon name="arrow-forward" size={10} color="#fff" />
                    <Text style={styles.cardBubbleIntentChipText} numberOfLines={1}>
                      {`${intentStopCount} stops`}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.cardBubbleBody}>
                <Text
                  style={[styles.cardBubbleTitle, isMe ? styles.textSent : styles.textReceived]}
                  numberOfLines={2}
                >
                  {cp.title}
                </Text>
                {cp.category ? (
                  <View style={styles.cardBubbleChip}>
                    <Text style={styles.cardBubbleChipText} numberOfLines={1}>
                      {cp.category}
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
            );
          })()}

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

export function parseCollabSystemToken(segment: string): CollabSystemToken | null {
  const match = segment.match(/^\[\[([a-z\-]+)(?::([a-zA-Z0-9\-_,]+))?(?::([a-zA-Z0-9\-_,]+))?(?::([a-zA-Z0-9\-_,]+))?\]\]$/);
  if (!match) return null;
  const [, command, first, second, third] = match;

  if (command === 'open-dismissed') {
    return first ? null : { type: 'open-dismissed' };
  }

  if (command === 'open-prefs') {
    if (first === 'self' && second && VALID_PREF_SECTIONS.has(second)) {
      return { type: 'open-prefs-self', section: second as CollabSystemPrefSection };
    }
    if (first && second && VALID_PREF_SECTIONS.has(first)) {
      return { type: 'open-prefs', section: first as CollabSystemPrefSection, userId: second };
    }
    return null;
  }

  if (command === 'compose-mention' && first && second) {
    return {
      type: 'compose-mention',
      userId: first,
      text: [second, third].filter(Boolean).join('_').replace(/_/g, ' '),
    };
  }

  return null;
}

function renderSystemBannerContent(
  content: string,
  onSystemTokenPress?: (token: CollabSystemToken) => void,
): React.ReactElement {
  const parts = content.split(SYSTEM_TOKEN_REGEX).filter((part) => part.length > 0);
  return (
    <View style={chatSystemRowStyles.content}>
      {parts.map((part, index) => {
        const token = parseCollabSystemToken(part);
        if (!token) {
          return (
            <Text key={`${part}-${index}`} style={chatSystemRowStyles.text}>
              {part}
            </Text>
          );
        }
        const label = getSystemTokenLabel(token);
        return (
          <TouchableOpacity
            key={`${part}-${index}`}
            onPress={() => onSystemTokenPress?.(token)}
            accessibilityRole="link"
            accessibilityLabel={label}
            testID={`collab-system-token-${token.type}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={!onSystemTokenPress}
          >
            <Text style={chatSystemRowStyles.link}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * ORCH-1058B — render a collab dead-end banner FROM the structured payload:
 *   1. prose line (token-stripped degrade text)
 *   2. participant·City/ST chip row (reuses CollabLocationChips verbatim)
 *   3. a real tappable prefs BUTTON (not a raw inline link), routing the
 *      structured `action` through the same handleSystemTokenPress handler.
 * No prose is parsed for tokens here, so raw `[[…]]` can NEVER render.
 */
function renderCollabDeadEndBanner(
  payload: CollabDeadEndBannerPayload,
  onSystemTokenPress?: (token: CollabSystemToken) => void,
): React.ReactElement {
  const chips = payload.participants.map((p) => ({
    id: p.id,
    label: `${p.name} · ${p.label}`,
    kind: p.locationKind,
    a11yLabel: p.a11yLabel,
  }));
  const buttonLabel = getSystemTokenLabel(payload.action);
  return (
    <View style={chatSystemRowStyles.systemPayloadContent}>
      {payload.prose.length > 0 && (
        <Text style={chatSystemRowStyles.text}>{payload.prose}</Text>
      )}
      <CollabLocationChips chips={chips} />
      <TouchableOpacity
        onPress={() => onSystemTokenPress?.(payload.action)}
        accessibilityRole="link"
        accessibilityLabel={buttonLabel}
        testID={`collab-system-token-${payload.action.type}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={!onSystemTokenPress}
        activeOpacity={0.6}
        style={chatSystemRowStyles.bannerButton}
      >
        <Text style={chatSystemRowStyles.bannerButtonLabel}>{buttonLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function getSystemTokenLabel(token: CollabSystemToken): string {
  if (token.type === 'open-dismissed') return 'Review dismissed';
  if (token.type === 'compose-mention') return 'Message them';
  const section = token.section === 'categories' ? 'categories' : `${token.section} picks`;
  return token.type === 'open-prefs-self' ? `Open your ${section}` : `Open ${section}`;
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
  senderName: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.semibold,
    marginBottom: 4,
  },
  senderNameSent: {
    color: 'rgba(255,255,255,0.78)',
  },
  senderNameReceived: {
    color: colors.text.tertiary,
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
  cardBubbleImageWrap: {
    position: 'relative',
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
  cardBubbleIntentChip: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cardBubbleIntentChipText: {
    fontSize: 11,
    fontWeight: fontWeights.semibold,
    color: '#fff',
  },
  // ORCH-0908: locked-in card banner
  cardBubbleLockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'hsl(28, 80%, 45%)',
  },
  cardBubbleLockedBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: fontWeights.semibold,
    color: '#fff',
  },
});

// ORCH-0898: system-message render styles (centered, muted, no chrome).
const chatSystemRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 8,
  },
  content: {
    maxWidth: SCREEN_WIDTH - 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  text: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  link: {
    fontSize: 12,
    color: '#eb7825',
    textAlign: 'center',
    fontStyle: 'italic',
    textDecorationLine: 'underline',
  },
  // ORCH-1058B: a taller, centered, full-width system row for the structured
  // banner (prose + chip row + button stacked vertically).
  systemPayloadRow: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 8,
  },
  systemPayloadContent: {
    maxWidth: SCREEN_WIDTH - 48,
    flexDirection: 'column',
    alignItems: 'center',
  },
  // ORCH-1058B: a real tappable control (NOT a raw inline link). Outlined pill,
  // #eb7825 brand accent, ≥44pt hit target (padding + hitSlop), non-shifting
  // press feedback via activeOpacity. SPEC §3.6 locked floor.
  bannerButton: {
    minHeight: 36,
    marginTop: spacing.sm,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(235, 120, 37, 0.10)',
  },
  bannerButtonLabel: {
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: '#eb7825',
    textAlign: 'center',
  },
});
