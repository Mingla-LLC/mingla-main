/**
 * Issue #4456 — the quiet line an unsent message leaves behind: "You unsent a
 * message", "Ana unsent a message", "Sam removed a message", "Sam removed
 * your message". It sits on the same side as the original, outlined (no fill),
 * with the real bubble corners (16, with the 4pt tail on the sender's side).
 * No reactions, ticks, swipe-to-reply or double-tap. A long press, or the
 * screen reader's custom action, offers Delete for me only.
 */
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import type { GroupPosition } from "../../utils/threadModel";

const FULL = 16;
const SMALL = 4;
/** Same cap as a message bubble (MessageBubble: 78% of the screen). */
export const UNSENT_BUBBLE_MAX_WIDTH_RATIO = 0.78;

/** The same corner table as MessageBubble (sent tail bottom-right, received top-left). */
export function unsentBubbleCorners(isMe: boolean, position: GroupPosition): {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
} {
  if (isMe) {
    return {
      borderTopLeftRadius: FULL,
      borderTopRightRadius: position === "middle" || position === "last" ? SMALL : FULL,
      borderBottomLeftRadius: FULL,
      borderBottomRightRadius: position === "last" ? FULL : SMALL,
    };
  }
  return {
    borderTopLeftRadius: SMALL,
    borderTopRightRadius: FULL,
    borderBottomLeftRadius: position === "middle" ? SMALL : FULL,
    borderBottomRightRadius: FULL,
  };
}

interface UnsentBubbleProps {
  /** The resolved line ("You unsent a message", …). */
  text: string;
  /** Time for the screen reader ("Ana unsent a message, 9:41 PM"). */
  timeLabel: string;
  isMe: boolean;
  groupPosition: GroupPosition;
  onLongPress?: () => void;
  bottomGap?: number;
  topGap?: number;
}

export function UnsentBubble({
  text,
  timeLabel,
  isMe,
  groupPosition,
  onLongPress,
  bottomGap,
  topGap,
}: UnsentBubbleProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const { width } = useWindowDimensions();
  return (
    <View
      style={[
        styles.row,
        isMe ? styles.rowRight : styles.rowLeft,
        typeof bottomGap === "number" ? { marginBottom: bottomGap } : null,
        typeof topGap === "number" ? { marginTop: topGap } : null,
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.7}
        onLongPress={onLongPress}
        delayLongPress={500}
        disabled={!onLongPress}
        accessibilityRole="text"
        accessibilityLabel={`${text}, ${timeLabel}`}
        accessibilityActions={onLongPress ? [{ name: "deleteForMe", label: t("chat:actionDeleteForMe") }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "deleteForMe") onLongPress?.();
        }}
        style={[
          styles.bubble,
          { maxWidth: Math.round(width * UNSENT_BUBBLE_MAX_WIDTH_RATIO) },
          unsentBubbleCorners(isMe, groupPosition),
        ]}
        testID="chat-unsent-line"
      >
        <Icon name="remove-circle" size={14} color={chatTokens.textMuted} />
        {/* Device pass F-3: Android measured the italic line narrower than it
            draws and cut it to "Ana unsent a". The text wraps (no line cap),
            shrinks inside a numeric max width, and keeps a little room on its
            trailing edge for the italic overhang. */}
        <Text style={styles.text} textBreakStrategy={Platform.OS === "android" ? "simple" : undefined}>
          {text}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: 12,
  },
  rowRight: {
    justifyContent: "flex-end",
  },
  rowLeft: {
    justifyContent: "flex-start",
  },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    flexShrink: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: chatTokens.tombstoneBorder,
    backgroundColor: "transparent",
  },
  text: {
    flexShrink: 1,
    flexGrow: 0,
    paddingRight: 3,
    includeFontPadding: false,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: "italic",
    color: chatTokens.textSoft,
  },
});
