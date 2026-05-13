/**
 * ORCH-0821 — ChatBubble
 * Two variants: user (right-aligned, brand-warm bubble) and assistant
 * (left-aligned glass bubble with AriOrb prefix). Tail corners reduced
 * to radius.xs on the side facing the speaker.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  ariPalette,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";

// Premium chat typography — tighter than typography.body (16/24).
// 14pt with 19pt line-height reads as polished and "designed for chat",
// not generic body copy. Matches the visual weight of iMessage / Linear /
// modern AI chat surfaces.
const CHAT_FONT_SIZE = 14;
const CHAT_LINE_HEIGHT = 19;
const BUBBLE_PADDING_H = 14;
const BUBBLE_PADDING_V = 9;

export interface ChatBubbleProps {
  role: "user" | "assistant";
  text: string;
  /** When true, no orb is rendered (e.g. a sequence of consecutive Ari
   *  messages can omit the orb on follow-ups). */
  hideOrb?: boolean;
  accessibilityLabel?: string;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  role,
  text,
  hideOrb = false,
  accessibilityLabel,
}) => {
  if (role === "user") {
    return (
      <View
        style={styles.userRow}
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel ?? `You said: ${text}`}
      >
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View
      style={styles.ariRow}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `Ari said: ${text}`}
    >
      <View style={styles.orbWrap}>
        {!hideOrb ? <AriOrb size="sm" decorative /> : <View style={{ width: 24, height: 24 }} />}
      </View>
      <View style={styles.ariBubble}>
        <Text style={styles.ariText}>{text}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  ariRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  orbWrap: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  userBubble: {
    backgroundColor: ariPalette.flame,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: BUBBLE_PADDING_H,
    paddingVertical: BUBBLE_PADDING_V,
    maxWidth: "78%",
  },
  ariBubble: {
    backgroundColor: glass.tint.profileBase,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    paddingHorizontal: BUBBLE_PADDING_H,
    paddingVertical: BUBBLE_PADDING_V,
    maxWidth: "78%",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  userText: {
    fontSize: CHAT_FONT_SIZE,
    lineHeight: CHAT_LINE_HEIGHT,
    color: textTokens.inverse,
    letterSpacing: -0.1,
  },
  ariText: {
    fontSize: CHAT_FONT_SIZE,
    lineHeight: CHAT_LINE_HEIGHT,
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
});

export default ChatBubble;
