import React, { useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { BoardMessage } from "../../services/boardDiscussionService";
import { getDisplayName } from "../../utils/getDisplayName";
import { colors, typography, shadows } from "../../constants/designSystem";
import { MentionChip } from "../chat/MentionChip";
import { ReplyQuoteBlock } from "../chat/ReplyQuoteBlock";

interface ReplyToData {
  id: string;
  content: string;
  user_id: string | null;
  image_url?: string | null;
  deleted_at?: string | null;
  profiles?: { id: string; display_name?: string | null; first_name?: string | null; last_name?: string | null } | null;
}

interface MessageBubbleProps {
  message: BoardMessage & { reply_to?: ReplyToData };
  isOwnMessage: boolean;
  currentUserId: string;
  onLongPress: (messageId: string, pageY: number) => void;
  onReaction: (messageId: string, emoji: string) => void;
  participantNames: Record<string, string>;
  isLastOwnMessage?: boolean;
  onScrollToMessage?: (messageId: string) => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

/** Check if content contains @mentions that need chip rendering. */
function hasMentions(content: string): boolean {
  return /@[\w]/.test(content);
}

/**
 * Render message content with @mention chips and #card tags.
 * Returns a View with flex-wrap when mentions are present (View-based chips),
 * or plain Text nodes when no mentions exist (better performance).
 */
function renderContent(content: string, isOwn: boolean): React.ReactElement {
  if (!hasMentions(content)) {
    // Fast path: no mentions, render as plain text
    // Still handle #tags
    const tagRegex = /(#[\w\s]+?)(?=\s@|\s#|$)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<Text key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</Text>);
      }
      parts.push(<Text key={`c-${match.index}`} style={styles.cardTag}>{match[0]}</Text>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(<Text key={`t-${lastIndex}`}>{content.slice(lastIndex)}</Text>);
    }
    return <Text style={[styles.messageText, isOwn ? styles.messageTextOwn : styles.messageTextOther]}>{parts.length > 0 ? parts : content}</Text>;
  }

  // Mentions present: use View flex-wrap so MentionChip (View-based) renders properly
  const regex = /(@[\w\s]+?)(?=\s@|\s#|$)|(#[\w\s]+?)(?=\s@|\s#|$)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`t-${lastIndex}`} style={[styles.messageText, isOwn ? styles.messageTextOwn : styles.messageTextOther]}>
          {content.slice(lastIndex, match.index)}
        </Text>
      );
    }

    const matched = match[0];
    if (matched.startsWith("@")) {
      const mentionName = matched.slice(1).trim();
      parts.push(
        <MentionChip
          key={`m-${match.index}`}
          name={mentionName}
          variant={isOwn ? 'sent' : 'received'}
        />
      );
    } else {
      parts.push(
        <Text key={`c-${match.index}`} style={[styles.messageText, isOwn ? styles.messageTextOwn : styles.messageTextOther, styles.cardTag]}>
          {matched}
        </Text>
      );
    }
    lastIndex = match.index + matched.length;
  }

  if (lastIndex < content.length) {
    parts.push(
      <Text key={`t-${lastIndex}`} style={[styles.messageText, isOwn ? styles.messageTextOwn : styles.messageTextOther]}>
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

function MessageBubbleComponent({
  message,
  isOwnMessage,
  currentUserId,
  onLongPress,
  onReaction,
  participantNames,
  isLastOwnMessage,
  onScrollToMessage,
}: MessageBubbleProps) {
  const reactions = message.reactions ?? [];
  const readBy = message.read_by ?? [];
  const senderName = getDisplayName(message.user, '') || participantNames[message.user_id] || "Unknown";

  // Group reactions by emoji
  const groupedReactions = useMemo(() => {
    const map = new Map<string, { count: number; userReacted: boolean }>();
    for (const r of reactions) {
      const existing = map.get(r.emoji);
      if (existing) {
        existing.count++;
        if (r.user_id === currentUserId) existing.userReacted = true;
      } else {
        map.set(r.emoji, {
          count: 1,
          userReacted: r.user_id === currentUserId,
        });
      }
    }
    return map;
  }, [reactions, currentUserId]);

  // Read receipt text
  const readReceiptText = useMemo(() => {
    if (!isOwnMessage || !isLastOwnMessage || readBy.length === 0) return null;
    const otherReaders = readBy.filter((r) => r.user_id !== currentUserId);
    if (otherReaders.length === 0) return null;

    // Check if all non-self participants have read
    const participantIds = Object.keys(participantNames).filter(
      (id) => id !== currentUserId
    );
    if (
      participantIds.length > 0 &&
      participantIds.every((id) => otherReaders.some((r) => r.user_id === id))
    ) {
      return "Seen by everyone";
    }

    const names = otherReaders
      .map((r) => participantNames[r.user_id] ?? "Unknown")
      .join(", ");
    return `Seen by ${names}`;
  }, [isOwnMessage, isLastOwnMessage, readBy, currentUserId, participantNames]);

  const timestamp = formatTime(message.created_at);

  return (
    <View
      style={[
        styles.messageRow,
        isOwnMessage ? styles.messageRowOwn : styles.messageRowOther,
      ]}
    >
      {/* Avatar for other users */}
      {!isOwnMessage && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{senderName[0]?.toUpperCase()}</Text>
        </View>
      )}

      <View
        style={[
          styles.bubbleContainer,
          isOwnMessage ? styles.bubbleContainerOwn : styles.bubbleContainerOther,
        ]}
      >
        {/* Sender name for other users */}
        {!isOwnMessage && (
          <Text style={styles.senderName}>{senderName}</Text>
        )}

        {/* Bubble */}
        <TouchableOpacity
          activeOpacity={0.8}
          onLongPress={(e) =>
            onLongPress(message.id, e.nativeEvent.pageY)
          }
        >
          <View
            style={[
              styles.bubble,
              isOwnMessage ? styles.bubbleOwn : styles.bubbleOther,
            ]}
          >
            {/* Reply quote block */}
            {message.reply_to && (
              <ReplyQuoteBlock
                senderName={
                  message.reply_to.profiles
                    ? getDisplayName(message.reply_to.profiles, '')
                    : participantNames[message.reply_to.user_id ?? ''] || 'Unknown'
                }
                previewText={message.reply_to.content || ''}
                imageUrl={message.reply_to.image_url ?? undefined}
                variant={isOwnMessage ? 'sent' : 'received'}
                isDeleted={!!message.reply_to.deleted_at}
                onPress={onScrollToMessage ? () => onScrollToMessage(message.reply_to!.id) : undefined}
              />
            )}

            {/* Image */}
            {message.image_url && (
              <Image
                source={{ uri: message.image_url }}
                style={styles.messageImage}
                resizeMode="cover"
              />
            )}

            {/* Text content */}
            {message.content ? renderContent(message.content, isOwnMessage) : null}

            {/* Timestamp */}
            <Text
              style={[
                styles.timestamp,
                isOwnMessage
                  ? styles.timestampOwn
                  : styles.timestampOther,
              ]}
            >
              {timestamp}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Reaction pills */}
        {groupedReactions.size > 0 && (
          <View style={styles.reactionsRow}>
            {Array.from(groupedReactions.entries()).map(
              ([emoji, { count, userReacted }]) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => onReaction(message.id, emoji)}
                  style={[
                    styles.reactionPill,
                    userReacted && styles.reactionPillOwn,
                  ]}
                >
                  <Text style={styles.reactionText}>
                    {emoji} {count}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        )}

        {/* Read receipt */}
        {readReceiptText && (
          <Text style={styles.readReceipt}>{readReceiptText}</Text>
        )}
      </View>
    </View>
  );
}

const MessageBubble = React.memo(MessageBubbleComponent);
export default MessageBubble;

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  messageRowOwn: {
    justifyContent: "flex-end",
  },
  messageRowOther: {
    justifyContent: "flex-start",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.orange[100],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    ...typography.xs,
    fontWeight: "600",
    color: colors.orange[700],
  },
  bubbleContainer: {
    flex: 1,
  },
  bubbleContainerOwn: {
    alignItems: "flex-end",
    marginLeft: 48,
  },
  bubbleContainerOther: {
    alignItems: "flex-start",
    marginRight: 48,
  },
  senderName: {
    ...typography.xs,
    fontWeight: "600",
    color: colors.gray[700],
    marginBottom: 2,
  },
  bubble: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  bubbleOwn: {
    backgroundColor: "#eb7825",
    borderRadius: 18,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.gray[100],
    borderRadius: 18,
    borderBottomLeftRadius: 4,
  },
  messageImage: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    marginBottom: 4,
  },
  messageText: {
    ...typography.sm,
  },
  messageTextOwn: {
    color: "#FFFFFF",
  },
  messageTextOther: {
    color: colors.gray[900],
  },
  contentWithMentions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 2,
  },
  cardTag: {
    color: colors.primary[500],
    fontWeight: "600",
  },
  timestamp: {
    ...typography.xs,
    alignSelf: "flex-end",
    marginTop: 2,
  },
  timestampOwn: {
    color: "rgba(255,255,255,0.7)",
  },
  timestampOther: {
    color: colors.gray[400],
  },
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  reactionPill: {
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.gray[200],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  reactionPillOwn: {
    borderColor: "#eb7825",
  },
  reactionText: {
    fontSize: 13,
  },
  readReceipt: {
    ...typography.xs,
    color: colors.gray[400],
    marginTop: 4,
  },
});
