import React, { memo } from 'react';
import { View, Text, StyleSheet, Dimensions, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { PlaceCuratedChatCard } from './PlaceCuratedChatCard';
import { colors, typography, fontWeights, radius, spacing } from '../../constants/designSystem';
import { MentionChip } from './MentionChip';
import { ReplyQuoteBlock } from './ReplyQuoteBlock';
import { ChatCardChip } from './ChatCardChip';
import { CollabLocationChips } from '../collab/CollabLocationChips';
import { isContentShareCardPayload, type CardPayload, type CardTagEntry, type LegacyCardPayload, type MentionEntry } from '../../services/messagingService';
import type { CollabDeadEndBannerPayload } from '../../services/collabDeadEndBannerService';
import { selectCompactPreviewFacts, shareKindLabel, statusLabel, validateNativeContentCardDescriptorV1 } from '@mingla/sharing';
import type { ReactionSummary } from '../../utils/threadModel';
import { chatTokens } from '../../constants/chatTokens';
import type { ViewOnceState } from '../../utils/chatMedia';
import { useChatMediaUrl } from './useChatMediaUrl';

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
  /** Issue #4114 Wave 4: this phone's own picked file while the send is local. */
  localUri?: string;
  /** Issue #4114 Wave 4: set for a view-once photo or video (who sees what). */
  viewOnce?: ViewOnceState;
  /** Issue #4114 Wave 4: 0..1 while the media uploads. */
  uploadProgress?: number;
  /** Issue #4114 Wave 4: group chats word the sender's view-once status as "Opened by N". */
  isGroupChat?: boolean;
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
  onCardBubbleTap?: (payload: CardPayload, messageId: string) => void;  // ORCH-0667
  onMentionTap?: (userId: string) => void;
  onCardTagTap?: (cardTag: CardTagEntry) => void;
  onSystemTokenPress?: (token: CollabSystemToken) => void;
  /** Issue #4114: present on a failed send — tapping the status resends it (same client id). */
  onRetry?: () => void;
  /**
   * Issue #4114 Wave 3: groups only, first bubble of a block, never your own
   * (threadModel.shouldShowSenderName). Defaults to hidden.
   */
  showSenderName?: boolean;
  /** Issue #4114 Wave 3: reaction pills under the bubble (aggregated by emoji). */
  reactions?: readonly ReactionSummary[];
  onReactionPress?: (messageId: string, emoji: string) => void;
  /** Issue #4114 Wave 4: cancel a media send while it uploads. */
  onCancelUpload?: () => void;
}

/**
 * Issue #4114 Wave 4: a chat photo. Stored paths resolve to a short-lived
 * signed link (cached); older public links and the sender's local file show as
 * they are. Loading and a tap-to-retry error state are drawn.
 */
function ChatMediaPhoto({ fileUrl, style }: { fileUrl: string | undefined; style: object }): React.ReactElement {
  const { t } = useTranslation(['chat']);
  const { url, status, retry } = useChatMediaUrl(fileUrl);
  if (status === 'error') {
    return (
      <TouchableOpacity
        style={[style, styles.mediaPending]}
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel={t('chat:mediaLoadFailed')}
      >
        <Icon name="refresh" size={22} color={chatTokens.textSecondary} />
      </TouchableOpacity>
    );
  }
  if (!url) {
    return (
      <View style={[style, styles.mediaPending]}>
        <ActivityIndicator size="small" color={chatTokens.textSecondary} />
      </View>
    );
  }
  return <Image source={{ uri: url }} style={style} resizeMode="cover" accessibilityIgnoresInvertColors />;
}

/** Issue #4114 Wave 4: the progress + cancel layer over a media send that is uploading. */
function UploadOverlay({ progress, onCancel }: { progress: number; onCancel?: () => void }): React.ReactElement {
  const { t } = useTranslation(['chat']);
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <View style={styles.uploadOverlay}>
      <View style={styles.uploadPill}>
        <ActivityIndicator size="small" color={chatTokens.textPrimary} />
        <Text style={styles.uploadText} accessibilityLiveRegion="polite">
          {`${percent}%`}
        </Text>
        {onCancel ? (
          <TouchableOpacity
            onPress={onCancel}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('chat:a11yCancelUpload')}
            testID="chat-upload-cancel"
          >
            <Icon name="close" size={14} color={chatTokens.textPrimary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.uploadTrack}>
        <View style={[styles.uploadFill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

function formatFileSizeLabel(size: string | undefined): string {
  const bytes = size ? Number(size) : NaN;
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatOpenedTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Issue #4114 Wave 4: a view-once bubble. No preview before opening.
 * Recipient: "Tap to view once", then "Opened" (greyed, can't reopen) or "Expired".
 * Sender: "Opened 9:40" in a 1:1, "Opened by N" in a group, "Not opened yet".
 */
function ViewOnceBubble({
  state,
  kind,
  isGroup,
  isMe,
  uploadProgress,
  onCancelUpload,
}: {
  state: ViewOnceState;
  kind: 'image' | 'video';
  isGroup: boolean;
  isMe: boolean;
  uploadProgress?: number;
  onCancelUpload?: () => void;
}): React.ReactElement {
  const { t } = useTranslation(['chat']);
  const kindLabel = kind === 'video' ? t('chat:video') : t('chat:photo');
  let title: string;
  let subtitle: string;
  let spent = false;
  if (state.role === 'recipient') {
    if (state.status === 'unopened') {
      title = t('chat:viewOnceTapToView');
      subtitle = kindLabel;
    } else {
      spent = true;
      title = kindLabel;
      subtitle = state.status === 'opened' ? t('chat:viewOnceOpened') : t('chat:viewOnceExpired');
    }
  } else {
    title = kindLabel;
    if (state.status === 'not_opened') {
      subtitle = t('chat:viewOnceNotOpened');
    } else if (isGroup) {
      subtitle = t('chat:viewOnceOpenedBy', { count: state.openedCount });
    } else {
      const time = formatOpenedTime(state.openedAt);
      subtitle = time ? t('chat:viewOnceOpenedAt', { time }) : t('chat:viewOnceOpened');
    }
    if (uploadProgress !== undefined) subtitle = `${Math.round(Math.max(0, Math.min(1, uploadProgress)) * 100)}%`;
  }
  return (
    <View style={[styles.viewOnceRow, spent && styles.viewOnceSpent]} testID="chat-view-once-bubble">
      <View style={[styles.viewOnceIcon, spent && styles.viewOnceIconSpent]}>
        <Icon
          name={spent ? 'checkmark-done' : kind === 'video' ? 'play' : 'eye'}
          size={16}
          color={spent ? chatTokens.textMuted : isMe ? 'white' : chatTokens.accent}
        />
      </View>
      <View style={styles.viewOnceText}>
        <Text style={[styles.viewOnceTitle, isMe ? styles.textSent : styles.textReceived, spent && styles.viewOnceMuted]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.viewOnceSubtitle, spent && styles.viewOnceMuted]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {uploadProgress !== undefined && onCancelUpload ? (
        <TouchableOpacity
          onPress={onCancelUpload}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('chat:a11yCancelUpload')}
        >
          <Icon name="close" size={14} color="white" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
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

function MessageBubbleImpl({
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
  onRetry,
  showSenderName = false,
  reactions,
  onReactionPress,
  onCancelUpload,
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
          {showSenderName ? (
            <Text
              style={[
                styles.senderName,
                isMe ? styles.senderNameSent : styles.senderNameReceived,
              ]}
              numberOfLines={1}
            >
              {message.senderName?.trim() || t('chat:unknownSender')}
            </Text>
          ) : null}

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
                      onCardBubbleTap?.(tag.cardPayload, message.id);
                    }
                  }}
                />
              ))}
            </>
          )}

          {/* Issue #4114 Wave 4: view once draws no preview at all. */}
          {(message.type === 'image' || message.type === 'video') && message.viewOnce ? (
            <ViewOnceBubble
              state={message.viewOnce}
              kind={message.type}
              isGroup={message.isGroupChat === true}
              isMe={isMe}
              uploadProgress={message.uploadProgress}
              onCancelUpload={onCancelUpload}
            />
          ) : null}

          {message.type === 'image' && !message.viewOnce && (message.localUri || message.fileUrl) && (
            <View style={styles.mediaContainer}>
              {message.content && message.content !== message.fileName && (
                <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived, styles.mediaCaption]}>
                  {message.content}
                </Text>
              )}
              <View>
                <ChatMediaPhoto
                  fileUrl={message.localUri ?? message.fileUrl}
                  style={[styles.mediaImage, borderRadius]}
                />
                {message.uploadProgress !== undefined ? (
                  <UploadOverlay progress={message.uploadProgress} onCancel={onCancelUpload} />
                ) : null}
              </View>
            </View>
          )}

          {message.type === 'video' && !message.viewOnce && (
            <View style={styles.mediaContainer}>
              {message.content && message.content !== message.fileName && (
                <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived, styles.mediaCaption]}>
                  {message.content}
                </Text>
              )}
              <View
                style={[styles.videoPlaceholder, borderRadius]}
                accessibilityRole="button"
                accessibilityLabel={t('chat:a11yPlayVideo')}
              >
                <Icon name="play-circle" size={40} color={isMe ? 'white' : colors.primary[500]} />
                <Text style={styles.videoLabel}>{t('chat:video')}</Text>
                {message.uploadProgress !== undefined ? (
                  <UploadOverlay progress={message.uploadProgress} onCancel={onCancelUpload} />
                ) : null}
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
                <Text style={[styles.fileSize, isMe ? styles.fileSizeSent : styles.fileSizeReceived]}>
                  {message.uploadProgress !== undefined
                    ? `${Math.round(message.uploadProgress * 100)}%`
                    : formatFileSizeLabel(message.fileSize) || t('chat:unknownSize')}
                </Text>
              </View>
              {message.uploadProgress !== undefined && onCancelUpload ? (
                <TouchableOpacity
                  onPress={onCancelUpload}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat:a11yCancelUpload')}
                >
                  <Icon name="close" size={14} color={isMe ? 'white' : colors.text.tertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* ORCH-0667: shared saved-card bubble */}
          {message.type === 'card' && message.cardPayload && (() => {
            const payload = message.cardPayload;
            if (isContentShareCardPayload(payload)) {
              const nativeCard = validateNativeContentCardDescriptorV1(payload.nativeCard);
              if (nativeCard) {
                const preview = nativeCard.preview;
                return <PlaceCuratedChatCard title={preview.title} category={preview.category} image={preview.image ?? payload.image}
                  stopCount={preview.stopCount} senderNote={payload.senderNote} isMe={isMe} hint={t('chat:cardBubbleTapHint')}
                  onPress={() => onCardBubbleTap?.(payload, message.id)} />;
              }
              const facts = payload.facts;
              const mediaKind = payload.media?.kind;
              const factLine = selectCompactPreviewFacts(facts, 3).join(' · ');
              const status = statusLabel(facts.status);
              return (
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${facts.title}`}
                  onPress={() => onCardBubbleTap?.(payload, message.id)}
                  activeOpacity={0.85}
                  style={styles.contentShareCard}
                >
                  {payload.senderNote ? <View style={styles.contentShareNote}><Text style={styles.contentShareNoteText}>{payload.senderNote}</Text></View> : null}
                  <View style={styles.cardBubbleImageWrap}>
                    {payload.image ? <Image source={{ uri: payload.image }} style={styles.contentSharePoster} resizeMode="cover" /> : <View style={[styles.contentSharePoster, styles.cardBubblePlaceholder]}><Icon name="bookmark" size={24} color="#6B7280" /></View>}
                    {mediaKind === 'gif' || mediaKind === 'video' ? <View style={styles.contentShareMediaTag}><Text style={styles.contentShareMediaTagText}>{mediaKind === 'gif' ? 'GIF' : 'Video'}</Text></View> : null}
                  </View>
                  <View style={styles.contentShareBody}>
                    <Text style={styles.contentShareKind}>{shareKindLabel(facts.kind)}{status ? ` · ${status}` : ''}</Text>
                    <Text numberOfLines={2} style={styles.contentShareTitle}>{facts.title}</Text>
                    {factLine ? <Text numberOfLines={2} style={styles.contentShareFacts}>{factLine}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            }
            // ORCH-0908: defensive legacy-payload normalizer. The first cut of
            // the combined lock-and-schedule RPC nested the card under
            // card_payload.card_data; migration 20260630000000 flattens it +
            // backfills existing rows, but if any nested row slips through we
            // still render correctly by reading from .card_data as a fallback.
            const raw = payload as LegacyCardPayload & {
              card_data?: Partial<LegacyCardPayload>;
              event?: string;
              scheduled_at?: string;
            };
            const legacy = raw.card_data && typeof raw.card_data === 'object' ? raw.card_data : null;
            const effectiveStops = raw.stops ?? legacy?.stops;
            const sourceCardType = raw.cardType ?? legacy?.cardType;
            const cp = {
              ...payload,
              image: raw.image ?? legacy?.image ?? null,
              title: raw.title ?? legacy?.title ?? 'Saved experience',
              category: raw.category ?? legacy?.category ?? null,
              lockInEvent: raw.lockInEvent
                ?? (raw.event === 'card_locked_and_scheduled' ? 'card_locked_and_scheduled' : undefined),
              scheduledAt: raw.scheduledAt ?? raw.scheduled_at ?? undefined,
              // Legacy curated payloads predate cardType but do contain stops.
              // Normalize that old shape once so the renderer can keep one
              // explicit curated-card boundary below.
              cardType: sourceCardType === 'curated'
                || (Array.isArray(effectiveStops) && effectiveStops.length > 0)
                ? 'curated'
                : sourceCardType,
              stops: effectiveStops,
            };
            const isIntentCard = cp.cardType === 'curated';
            const intentStopCount = isIntentCard ? (cp.stops?.length ?? 0) : 0;
            const intentHeroImage = isIntentCard ? (cp.stops?.[0]?.imageUrl ?? cp.image) : cp.image;
            const effectiveImage = isIntentCard ? intentHeroImage : cp.image;
            // PlaceCuratedChatCard owns the legacy cardBubbleIntentChip and its
            // arrow-forward affordance; this boundary supplies its effective
            // first-stop image and stop count without duplicating the design.
            return <PlaceCuratedChatCard title={cp.title} category={cp.category} image={effectiveImage}
              stopCount={intentStopCount || undefined} lockedAt={cp.lockInEvent === 'card_locked_and_scheduled' ? cp.scheduledAt : undefined}
              isMe={isMe} hint={t('chat:cardBubbleTapHint')} onPress={() => onCardBubbleTap?.(payload, message.id)} />;
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

      {/* Issue #4114 Wave 3: reactions, one pill per emoji with its count;
          yours shows its count in the accent colour and tapping a pill toggles your reaction. */}
      {reactions && reactions.length > 0 ? (
        <View style={[styles.reactionRow, isMe ? styles.reactionRowRight : styles.reactionRowLeft]}>
          {reactions.map((reaction) => (
            <TouchableOpacity
              key={reaction.emoji}
              style={styles.reactionPill}
              hitSlop={REACTION_PILL_HIT_SLOP}
              onPress={onReactionPress ? () => onReactionPress(message.id, reaction.emoji) : undefined}
              disabled={!onReactionPress}
              accessibilityRole="button"
              accessibilityLabel={t('chat:a11yReaction', { emoji: reaction.emoji, count: reaction.count })}
              accessibilityState={{ selected: reaction.mine }}
              testID={`reaction-pill-${reaction.emoji}`}
            >
              <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
              {reaction.count > 1 || reaction.mine ? (
                <Text style={[styles.reactionCount, reaction.mine && styles.reactionCountMine]}>{reaction.count}</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Issue #4114: every failed send says so and offers tap-to-retry,
          wherever it sits in its group. */}
      {isMe && isFailed && (
        onRetry ? (
          <TouchableOpacity
            style={styles.readReceiptContainer}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t('chat:failedTapToRetry')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.failedText}>{t('chat:failedTapToRetry')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.readReceiptContainer}>
            <Text style={styles.failedText}>{t('chat:failed')}</Text>
          </View>
        )
      )}

      {/* Read receipt — only on last sent message in group */}
      {isMe && !isFailed && (groupPosition === 'solo' || groupPosition === 'last') && (
        <View style={styles.readReceiptContainer}>
          {!isDelivered ? (
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

/**
 * Issue #4114 Wave 3: memoised, so a keystroke in the composer (which re-renders
 * the chat screen) does not re-render every visible bubble. MessageInterface
 * passes stable callbacks and a stable renderItem for this to hold.
 */
export const MessageBubble = memo(MessageBubbleImpl);

/** 24pt pill + 10pt above/below and 6pt each side = a 44pt hit area. */
const REACTION_PILL_HIT_SLOP = { top: 10, bottom: 10, left: 6, right: 6 } as const;

const styles = StyleSheet.create({
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    // Sits just under the bubble; an overlap left a visible seam once the pill lost its outline.
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 18,
  },
  reactionRowRight: {
    justifyContent: 'flex-end',
  },
  reactionRowLeft: {
    justifyContent: 'flex-start',
  },
  reactionPill: {
    minHeight: 24,
    minWidth: 32,
    paddingHorizontal: 7,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    // Solid neutral fill, no outline and no shadow: distinct from the light
    // received bubble, the orange sent bubble and the dark screen.
    backgroundColor: chatTokens.surfaceRaised,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: chatTokens.textSecondary,
  },
  // Your reaction shows only through its count colour; no orange fill or ring.
  reactionCountMine: {
    color: chatTokens.accent,
    fontWeight: '700',
  },
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
  fileSizeSent: {
    color: 'rgba(255,255,255,0.7)',
  },
  fileSizeReceived: {
    color: colors.text.tertiary,
  },
  // Issue #4114 Wave 4: media states, upload progress and view once.
  mediaPending: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: fontWeights.medium,
    color: 'rgba(255,255,255,0.72)',
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    margin: -9,
    marginTop: 0,
    justifyContent: 'flex-end',
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  uploadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  uploadText: {
    fontSize: 12,
    fontWeight: fontWeights.medium,
    color: '#FFFFFF',
  },
  uploadTrack: {
    marginTop: 8,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  uploadFill: {
    height: 3,
    backgroundColor: chatTokens.accent,
  },
  viewOnceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 180,
    paddingVertical: 2,
  },
  viewOnceSpent: {
    opacity: 0.7,
  },
  viewOnceIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  viewOnceIconSpent: {
    borderColor: 'rgba(255,255,255,0.2)',
  },
  viewOnceText: {
    flexShrink: 1,
  },
  viewOnceTitle: {
    fontSize: 15,
    fontWeight: fontWeights.semibold,
  },
  viewOnceSubtitle: {
    fontSize: 12,
    marginTop: 1,
    color: 'rgba(255,255,255,0.6)',
  },
  viewOnceMuted: {
    color: 'rgba(255,255,255,0.45)',
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
  contentShareCard: {
    width: SCREEN_WIDTH * 0.68,
    maxWidth: 320,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  contentShareNote: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  contentShareNoteText: { fontSize: 14, lineHeight: 20, color: '#111827' },
  contentSharePoster: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#F3F4F6' },
  contentShareMediaTag: { position:'absolute',right:8,bottom:8,borderRadius:8,paddingHorizontal:7,paddingVertical:3,backgroundColor:'#0C0E12' },
  contentShareMediaTagText: { fontSize:11,fontWeight:'700',color:'#FFFFFF' },
  contentShareBody: { padding: 12, gap: 4 },
  contentShareKind: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#9A470A' },
  contentShareTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: '#111827' },
  contentShareFacts: { fontSize: 13, lineHeight: 18, color: '#4B5563' },
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
