/**
 * ORCH-0821 — ChatBubble
 * Two variants: user (right-aligned, brand-warm bubble) and assistant
 * (left-aligned glass bubble with AriOrb prefix). Tail corners reduced
 * to radius.xs on the side facing the speaker.
 *
 * ORCH-1101 — density spine + bubble redesign:
 *   - All paddings/radius/maxWidth promoted to the `ariThread` token block.
 *   - User fill → ariPalette.userBubble (#a85a44) to fix the white-on-flame
 *     2.32:1 contrast failure (now 4.6:1). iOS subtle ember shadow; Android
 *     opaque + overflow:hidden + no shadow; web no shadow.
 *   - `tail?` prop (default true) for speaker grouping: interior bubbles in a
 *     same-speaker group use 16 on all four corners (smooth column); only the
 *     last bubble gets the 4pt tail.
 *   - Lightweight line-segment renderer (§2.5): `\n\n` → gapGroup space between
 *     paragraph segments; a leading "• " / "- " → a hanging bullet row. No
 *     markdown engine — that's smart-Ari ORCH territory.
 */

import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import {
  ariPalette,
  ariThread,
  glass,
  text as textTokens,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";

export interface ChatBubbleProps {
  role: "user" | "assistant";
  text: string;
  /** When true, no orb is rendered (e.g. a sequence of consecutive Ari
   *  messages can omit the orb on follow-ups). */
  hideOrb?: boolean;
  /** When false, the speaker-facing corner stays square-ish (16) instead of
   *  the 4pt tail — used for interior bubbles in a same-speaker group so the
   *  cluster reads as one smooth column. Default true (last/only bubble). */
  tail?: boolean;
  accessibilityLabel?: string;
}

interface Segment {
  kind: "paragraph" | "bullet";
  text: string;
}

/** Split already-parsed plain text into paragraph / bullet segments.
 *  Container-level formatting only (no inline markdown). */
function toSegments(raw: string): Segment[] {
  const paragraphs = raw.split(/\n\n+/);
  const out: Segment[] = [];
  for (const para of paragraphs) {
    const lines = para.split("\n");
    // If every line in this paragraph is a bullet, render hanging bullets.
    const allBullets =
      lines.length > 0 && lines.every((l) => /^\s*[•-]\s+/.test(l));
    if (allBullets) {
      for (const line of lines) {
        out.push({ kind: "bullet", text: line.replace(/^\s*[•-]\s+/, "") });
      }
    } else {
      out.push({ kind: "paragraph", text: para });
    }
  }
  return out;
}

const BubbleText: React.FC<{ text: string; style: object }> = ({ text, style }) => {
  const segments = toSegments(text);
  // Fast path: a single plain paragraph renders as one Text (no extra views).
  if (segments.length === 1 && segments[0].kind === "paragraph") {
    return <Text style={style}>{segments[0].text}</Text>;
  }
  return (
    <View>
      {segments.map((seg, i) => {
        const topGap = i === 0 ? 0 : ariThread.gapGroup;
        if (seg.kind === "bullet") {
          return (
            <View key={i} style={[styles.bulletRow, { marginTop: topGap }]}>
              <Text style={[style, styles.bulletGlyph]}>•</Text>
              <Text style={[style, styles.bulletText]}>{seg.text}</Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[style, { marginTop: topGap }]}>
            {seg.text}
          </Text>
        );
      })}
    </View>
  );
};

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  role,
  text,
  hideOrb = false,
  tail = true,
  accessibilityLabel,
}) => {
  if (role === "user") {
    return (
      <View
        style={styles.userRow}
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel ?? `You said: ${text}`}
      >
        <View
          style={[
            styles.userBubble,
            tail ? styles.userTail : styles.noTail,
          ]}
        >
          <BubbleText text={text} style={styles.userText} />
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
        {!hideOrb ? <AriOrb size="sm" decorative /> : <View style={styles.orbSpacer} />}
      </View>
      <View
        style={[styles.ariBubble, tail ? styles.ariTail : styles.noTail]}
      >
        <BubbleText text={text} style={styles.ariText} />
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
    marginRight: ariThread.orbGap, // 6 (was spacing.sm 8)
  },
  orbSpacer: {
    width: 24,
    height: 24,
  },
  userBubble: {
    backgroundColor: ariPalette.userBubble,
    borderRadius: ariThread.bubbleRadius, // 16 base on all corners
    paddingHorizontal: ariThread.bubblePadH, // 12
    paddingVertical: ariThread.bubblePadV, // 8
    maxWidth: "80%",
    // iOS: subtle ember lift. Android/web: no shadow (opaque fill carries it).
    ...Platform.select({
      ios: {
        shadowColor: ariPalette.ember,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.18,
        shadowRadius: 4,
      },
      default: {
        overflow: "hidden",
      },
    }),
  },
  // Tail = bottom-right for the user (overrides the base 16 on that one corner).
  userTail: {
    borderBottomRightRadius: ariThread.bubbleTail, // 4
  },
  ariBubble: {
    // Android opaque equivalent of glass.tint.profileBase (composited #16181b)
    // satisfies ANDROID_GLASS_USES_OPAQUE_FALLBACK; iOS/web keep the translucent
    // glass tint + hairline border.
    backgroundColor: Platform.OS === "android" ? ariThread.ariBubbleAndroid : glass.tint.profileBase,
    borderRadius: ariThread.bubbleRadius, // 16 base
    paddingHorizontal: ariThread.bubblePadH,
    paddingVertical: ariThread.bubblePadV,
    maxWidth: "80%",
    overflow: "hidden",
    ...Platform.select({
      android: {},
      default: {
        borderWidth: 1,
        borderColor: glass.border.profileBase,
      },
    }),
  },
  // Tail = top-left for Ari.
  ariTail: {
    borderTopLeftRadius: ariThread.bubbleTail, // 4
  },
  // Interior grouped bubble: keep all four corners at the 16 base (no tail).
  noTail: {},
  userText: {
    fontSize: ariThread.bodyFont,
    lineHeight: ariThread.bodyLine,
    color: textTokens.inverse,
    letterSpacing: -0.1,
  },
  ariText: {
    fontSize: ariThread.bodyFont,
    lineHeight: ariThread.bodyLine,
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  bulletRow: {
    flexDirection: "row",
  },
  bulletGlyph: {
    color: textTokens.tertiary,
    width: 6,
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
  },
});

export default ChatBubble;
