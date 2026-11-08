/**
 * #4304 part 2 — one Brand-group message, styled like the Explorer chats
 * (app-mobile components/chat/MessageBubble.tsx): clustered bubbles with tail
 * corners, the sender's avatar on the last bubble of a cluster, name + role on
 * the first, an orange-bar quote block, styled @mentions, reaction pills, and
 * the time only at the end of a cluster.
 *
 * The message menu opens from a long-press (phones), right-click or the hover
 * "⋯" (web). Phones also swipe right to reply and double-tap to heart.
 */
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import type { BrandGroupMessage } from "../../services/brandGroupsService";
import {
  brandGroupClockTime,
  splitBrandGroupMentions,
  type BrandGroupClusterPosition,
  type BrandGroupReactionPill,
} from "../../utils/brandGroupThreadModel";
import { Icon } from "../ui/Icon";
import { BrandGroupBubbleGestures } from "./BrandGroupBubbleGestures";
import { BrandGroupPersonAvatar } from "./BrandGroupTile";

const AVATAR = 28;
const TAIL = brandGroupChat.bubbleTail;
const RADIUS = brandGroupChat.bubbleRadius;

export function brandGroupBubbleCorners(
  position: BrandGroupClusterPosition,
  mine: boolean,
): { borderTopLeftRadius: number; borderTopRightRadius: number; borderBottomLeftRadius: number; borderBottomRightRadius: number } {
  const joinsAbove = position === "middle" || position === "last";
  const top = joinsAbove ? TAIL : RADIUS;
  const bottom = TAIL; // every bubble's sender-side bottom is tight; the last one is the tail
  return mine
    ? { borderTopLeftRadius: RADIUS, borderBottomLeftRadius: RADIUS, borderTopRightRadius: top, borderBottomRightRadius: bottom }
    : { borderTopRightRadius: RADIUS, borderBottomRightRadius: RADIUS, borderTopLeftRadius: top, borderBottomLeftRadius: bottom };
}

export function BrandGroupMessageText({
  content,
  mine,
  mentionNames,
}: {
  content: string;
  mine: boolean;
  mentionNames: readonly string[];
}): React.ReactElement {
  const segments = splitBrandGroupMentions(content, mentionNames);
  if (segments.length <= 1 && !segments[0]?.mention) {
    return <Text style={[styles.text, mine && styles.textMine]}>{content}</Text>;
  }
  return (
    <Text style={[styles.text, mine && styles.textMine]}>
      {segments.map((segment, index) => segment.mention ? (
        <Text key={index} style={[styles.mention, mine && styles.mentionMine]}>{segment.text}</Text>
      ) : segment.text)}
    </Text>
  );
}

export function BrandGroupMessageRow({
  message,
  mine,
  position,
  showSender,
  showAvatar,
  showTime,
  senderLabel,
  selected,
  highlighted,
  reactions,
  seenBy,
  onOpenMenu,
  onReply,
  onHeart,
  onToggleReaction,
  renderBody,
}: {
  message: BrandGroupMessage;
  mine: boolean;
  position: BrandGroupClusterPosition;
  showSender: boolean;
  showAvatar: boolean;
  showTime: boolean;
  /** "Ada · Mingla Support" — the role after the name when there is one. */
  senderLabel: string;
  selected: boolean;
  highlighted: boolean;
  reactions: BrandGroupReactionPill[];
  seenBy: string | null;
  onOpenMenu: () => void;
  onReply: () => void;
  onHeart: () => void;
  onToggleReaction: (emoji: string) => void;
  /** The bubble body; file/media bodies open the menu on long-press too. */
  renderBody: (openMenu: () => void) => React.ReactNode;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const web = Platform.OS === "web";
  const corners = brandGroupBubbleCorners(position, mine);
  const endsCluster = position === "solo" || position === "last";

  const openFromContextMenu = (event: GestureResponderEvent): void => {
    (event as unknown as { preventDefault?: () => void }).preventDefault?.();
    onOpenMenu();
  };

  const bubble = (
    <Pressable
      accessibilityRole="text"
      accessibilityHint="Long-press for reactions, reply and more"
      onLongPress={onOpenMenu}
      delayLongPress={320}
      {...(web ? { onContextMenu: openFromContextMenu } : null)}
      style={[
        styles.bubble,
        corners,
        mine ? styles.bubbleMine : styles.bubbleOther,
        selected && styles.bubbleSelected,
        highlighted && styles.bubbleHighlighted,
      ]}
      testID={`brand-group-bubble-${message.id}`}
    >
      {message.reply_content ? (
        <View style={[styles.quote, mine && styles.quoteMine]}>
          <View style={[styles.quoteBar, mine && styles.quoteBarMine]} />
          <View style={styles.quoteCopy}>
            <Text style={[styles.quoteName, mine && styles.textMine]} numberOfLines={1}>{message.reply_sender_display_name || "Message"}</Text>
            <Text style={[styles.quoteText, mine && styles.quoteTextMine]} numberOfLines={2}>{message.reply_content}</Text>
          </View>
        </View>
      ) : null}
      {renderBody(onOpenMenu)}
    </Pressable>
  );

  const content = (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther, endsCluster ? styles.rowClusterEnd : styles.rowClusterJoined]}>
      {!mine ? (
        <View style={styles.avatarSlot}>
          {showAvatar ? <BrandGroupPersonAvatar name={message.sender_display_name} seed={message.sender_id ?? message.sender_display_name} size={AVATAR} /> : null}
        </View>
      ) : null}
      <View style={[styles.column, mine ? styles.columnMine : styles.columnOther]}>
        {showSender ? <Text style={styles.sender} numberOfLines={1}>{senderLabel}</Text> : null}
        <View style={[styles.bubbleLine, mine && styles.bubbleLineMine]}>
          <BrandGroupBubbleGestures onReply={onReply} onDoubleTap={onHeart} enabled={!web}>
            {bubble}
          </BrandGroupBubbleGestures>
          {web ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${message.sender_display_name}'s message`}
              onPress={onOpenMenu}
              style={[styles.more, !hovered && styles.moreHidden]}
              testID={`brand-group-more-${message.id}`}
            >
              <Icon name="moreH" size={16} color={brandGroupChat.textSoft} />
            </Pressable>
          ) : null}
        </View>
        {reactions.length > 0 ? (
          <View style={[styles.reactions, mine && styles.reactionsMine]}>
            {reactions.map((pill) => (
              <Pressable
                key={pill.emoji}
                accessibilityRole="button"
                accessibilityLabel={`${pill.emoji} ${pill.count}${pill.mine ? ", you reacted. Tap to remove" : ". Tap to react"}`}
                accessibilityState={{ selected: pill.mine }}
                onPress={() => onToggleReaction(pill.emoji)}
                style={[styles.pill, pill.mine && styles.pillMine]}
              >
                <Text style={styles.pillEmoji}>{pill.emoji}</Text>
                {pill.count > 1 ? <Text style={styles.pillCount}>{pill.count}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {showTime || seenBy ? (
          <Text style={[styles.meta, mine && styles.metaMine]}>
            {showTime ? brandGroupClockTime(message.created_at) : ""}
            {seenBy ? `${showTime ? " · " : ""}${seenBy}` : ""}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!web) return content;
  return (
    <Pressable
      accessible={false}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={styles.hoverWrap}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hoverWrap: {},
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  rowMine: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  rowClusterEnd: { marginBottom: 10 },
  rowClusterJoined: { marginBottom: 2 },
  avatarSlot: { width: AVATAR, alignItems: "center", marginBottom: 18 },
  column: { maxWidth: "78%", minWidth: 0 },
  columnMine: { alignItems: "flex-end" },
  columnOther: { alignItems: "flex-start" },
  sender: { color: brandGroupChat.senderName, fontSize: 12, fontWeight: "700", marginLeft: 12, marginBottom: 3 },
  // #4304 — the line may never be wider than its column, and the bubble is the
  // part that gives way: React Native row items do not shrink by default, so a
  // long message otherwise grows past the 78% column and is cut off.
  bubbleLine: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", minWidth: 0 },
  bubbleLineMine: { flexDirection: "row-reverse" },
  bubble: { flexShrink: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 9, gap: 6, borderWidth: 1, borderColor: "transparent" },
  bubbleMine: { backgroundColor: brandGroupChat.mineBubble },
  bubbleOther: { backgroundColor: brandGroupChat.otherBubble },
  bubbleSelected: { borderColor: brandGroupChat.selected, borderWidth: 2 },
  bubbleHighlighted: { borderColor: brandGroupChat.accent, borderWidth: 2, shadowColor: brandGroupChat.accent, shadowOpacity: 0.45, shadowRadius: 8 },
  text: { color: brandGroupChat.otherText, fontSize: 15, lineHeight: 21 },
  textMine: { color: brandGroupChat.mineText },
  mention: { color: brandGroupChat.mentionText, backgroundColor: brandGroupChat.mentionBg, fontWeight: "700", borderRadius: 4 },
  mentionMine: { color: brandGroupChat.mineText, backgroundColor: brandGroupChat.mentionMineBg },
  quote: { flexDirection: "row", gap: 8, padding: 8, borderRadius: 10, backgroundColor: brandGroupChat.quoteBg },
  quoteMine: { backgroundColor: brandGroupChat.quoteMineBg },
  quoteBar: { width: 3, borderRadius: 2, backgroundColor: brandGroupChat.quoteBar },
  quoteBarMine: { backgroundColor: brandGroupChat.quoteBarMine },
  quoteCopy: { flex: 1, minWidth: 0, gap: 2 },
  quoteName: { color: brandGroupChat.textPrimary, fontSize: 12, fontWeight: "700" },
  quoteText: { color: brandGroupChat.textSecondary, fontSize: 12, lineHeight: 16 },
  quoteTextMine: { color: brandGroupChat.mineTextSecondary },
  more: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: brandGroupChat.surfaceRaised },
  moreHidden: { opacity: 0 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: -4, marginLeft: 8 },
  reactionsMine: { marginLeft: 0, marginRight: 8, justifyContent: "flex-end" },
  pill: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, borderRadius: 12, borderWidth: 1, borderColor: brandGroupChat.screenBg, backgroundColor: brandGroupChat.surfaceRaised },
  pillMine: { borderColor: brandGroupChat.accent, backgroundColor: "#2A1C12" },
  pillEmoji: { fontSize: 13 },
  pillCount: { color: brandGroupChat.textSecondary, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  meta: { color: brandGroupChat.textMuted, fontSize: 11, marginTop: 3, marginLeft: 12 },
  metaMine: { marginLeft: 0, marginRight: 4 },
});
