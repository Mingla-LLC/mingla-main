/**
 * ORCH-0821 — ChatBubble
 * Two variants: user (right-aligned, brand-warm bubble) and assistant
 * (left-aligned glass bubble with AriOrb prefix). Tail corners reduced
 * to radius.xs on the side facing the speaker.
 *
 * ORCH-1101 — density spine + bubble redesign:
 *   - All paddings/radius/maxWidth promoted to the `ariThread` token block.
 *   - User fill → ariPalette.userBubble (= accent.warm #eb7825, the Mingla
 *     brand action color; operator brand-consistency decision 2026-06-08).
 *     iOS subtle ember shadow; Android opaque + overflow:hidden + no shadow;
 *     web no shadow.
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
import { SemanticRevealText } from "./SemanticRevealText";

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
  reveal?: boolean;
  revealSkipSignal?: number;
  surface?: "main" | "website";
}

export interface AriBubbleSegment {
  kind: "paragraph" | "bullet";
  text: string;
}

type Segment = AriBubbleSegment;

const BULLET_LINE = /^\s*[•-]\s+/;

/** Split already-parsed plain text into paragraph / bullet segments.
 *  Container-level formatting only (no inline markdown).
 *  #3429 REWORK-1 P2-4: the ONE segmenter — the semantic reveal renders these
 *  same segments, so a revealed answer and its settled row never differ. */
export function toSegments(raw: string): Segment[] {
  const paragraphs = raw.split(/\n\n+/);
  const out: Segment[] = [];
  for (const para of paragraphs) {
    const lines = para.split("\n");
    // #3429 REWORK-2 R-6: a paragraph is split AT its first bullet, not
    // all-or-nothing. Requiring every line to be a bullet meant the single most
    // common shape an answer takes — an intro line, then bullets, with no blank
    // line between them — fell through to one plain paragraph and rendered the
    // literal "- " dashes the writer meant as a list. Consecutive non-bullet
    // lines still group into one paragraph, so an all-prose paragraph and an
    // all-bullet paragraph are byte-for-byte what they were before.
    let prose: string[] = [];
    const flushProse = (): void => {
      if (prose.length === 0) return;
      out.push({ kind: "paragraph", text: prose.join("\n") });
      prose = [];
    };
    for (const line of lines) {
      if (BULLET_LINE.test(line)) {
        flushProse();
        out.push({ kind: "bullet", text: line.replace(BULLET_LINE, "") });
      } else {
        prose.push(line);
      }
    }
    flushProse();
  }
  return out;
}

/** The SPOKEN form of a bubble, built from the SAME segments the renderer uses.
 *  #3429 REWORK-4 N-2: the visible rows render "- item" as a real bullet row
 *  (R-6), but the accessibility label was still built from the raw text, so
 *  TalkBack and VoiceOver announced "dash" before every list item while the
 *  screen showed a bullet — sighted users got the R-6 fix and screen-reader
 *  users did not. Taking the label from `toSegments` strips the list markers
 *  and means the announcement cannot drift from what is on screen. */
export function toAccessibleText(raw: string): string {
  return toSegments(raw)
    .map((segment) => segment.text)
    .join("\n");
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
  reveal = false,
  revealSkipSignal = 0,
  surface = "main",
}) => {
  if (role === "user") {
    return (
      <View
        style={styles.userRow}
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel ?? `You said: ${toAccessibleText(text)}`}
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
      accessible={!reveal}
      accessibilityRole="text"
      accessibilityLabel={!reveal ? accessibilityLabel ?? `Ari said: ${toAccessibleText(text)}` : undefined}
    >
      <View style={styles.orbWrap}>
        {!hideOrb ? <AriOrb size="sm" decorative /> : <View style={styles.orbSpacer} />}
      </View>
      <View
        style={[styles.ariBubble, tail ? styles.ariTail : styles.noTail]}
      >
        {reveal ? (
          <SemanticRevealText
            text={text}
            textStyle={styles.ariText}
            skipSignal={revealSkipSignal}
            surface={surface}
          />
        ) : <BubbleText text={text} style={styles.ariText} />}
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
    maxWidth: "84%",
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
    maxWidth: ariThread.bubbleMaxWidth,
    flexShrink: 1,
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
    color: ariThread.onUserBubble,
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
