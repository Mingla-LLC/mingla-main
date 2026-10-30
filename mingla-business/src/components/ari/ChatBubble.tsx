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
import {
  parseInlineRuns,
  toAccessibleText,
  toSegments,
  type AriBubbleSegment,
  type AriInlineRun,
} from "./ariBubbleSegments";
import { SemanticRevealText } from "./SemanticRevealText";
import { ariUserFacingReplyText } from "./renditions/ariRenditionProtocol";

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

/** The segmenter lives in its own leaf module so neither this file nor
 *  `SemanticRevealText` has to import the other (I-PROPOSED-K). Re-exported
 *  here because this is where callers have always imported it from. */
export type { AriBubbleSegment } from "./ariBubbleSegments";
export {
  ariTextLeaksMarkdown,
  parseInlineRuns,
  stripRawMarkdownDelimiters,
  toAccessibleText,
  toSegments,
} from "./ariBubbleSegments";

const InlineRuns: React.FC<{ text: string; style: object | object[] }> = ({
  text,
  style,
}) => {
  const runs = parseInlineRuns(text);
  const onlyPlain = runs.length === 1 && runs[0].kind === "plain";
  if (onlyPlain) {
    return (
      <Text selectable style={style}>
        {runs[0].text}
      </Text>
    );
  }
  return (
    <Text selectable style={style}>
      {runs.map((run: AriInlineRun, i) => {
        if (run.kind === "strong") {
          return (
            <Text key={i} style={[style, styles.strong]}>
              {run.text}
            </Text>
          );
        }
        if (run.kind === "em") {
          return (
            <Text key={i} style={[style, styles.em]}>
              {run.text}
            </Text>
          );
        }
        if (run.kind === "code") {
          return (
            <Text key={i} style={[style, styles.code]}>
              {run.text}
            </Text>
          );
        }
        return <Text key={i}>{run.text}</Text>;
      })}
    </Text>
  );
};

const SegmentView: React.FC<{
  seg: AriBubbleSegment;
  style: object;
  topGap: number;
}> = ({ seg, style, topGap }) => {
  if (seg.kind === "section_label") {
    return (
      <View accessibilityRole="header" style={{ marginTop: topGap }}>
        <InlineRuns text={seg.text} style={[style, styles.sectionLabel]} />
      </View>
    );
  }
  if (seg.kind === "bullet") {
    return (
      <View style={[styles.bulletRow, { marginTop: topGap }]}>
        <Text style={[style, styles.bulletGlyph]}>•</Text>
        <View style={styles.bulletText}>
          <InlineRuns text={seg.text} style={style} />
        </View>
      </View>
    );
  }
  if (seg.kind === "numbered") {
    return (
      <View style={[styles.bulletRow, { marginTop: topGap }]}>
        <Text style={[style, styles.numberGlyph]}>{seg.n ?? 1}.</Text>
        <View style={styles.bulletText}>
          <InlineRuns text={seg.text} style={style} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ marginTop: topGap }}>
      <InlineRuns text={seg.text} style={style} />
    </View>
  );
};

const BubbleText: React.FC<{ text: string; style: object }> = ({
  text,
  style,
}) => {
  const segments = toSegments(text);
  // Fast path: a single plain paragraph with no inline markup.
  if (
    segments.length === 1 &&
    segments[0].kind === "paragraph" &&
    parseInlineRuns(segments[0].text).every((r) => r.kind === "plain")
  ) {
    return <InlineRuns text={segments[0].text} style={style} />;
  }
  if (segments.length === 0) {
    return <InlineRuns text={text} style={style} />;
  }
  return (
    <View>
      {segments.map((seg, i) => (
        <SegmentView
          key={i}
          seg={seg}
          style={style}
          topGap={i === 0 ? 0 : ariThread.gapGroup}
        />
      ))}
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
        accessibilityLabel={
          accessibilityLabel ?? `You said: ${toAccessibleText(text)}`
        }
      >
        <View
          style={[styles.userBubble, tail ? styles.userTail : styles.noTail]}
        >
          <BubbleText text={text} style={styles.userText} />
        </View>
      </View>
    );
  }
  const publicText = ariUserFacingReplyText(text);
  return (
    <View
      style={styles.ariRow}
      accessible={!reveal}
      accessibilityRole="text"
      accessibilityLabel={
        !reveal
          ? (accessibilityLabel ?? `Ari said: ${toAccessibleText(publicText)}`)
          : undefined
      }
    >
      <View style={styles.orbWrap}>
        {!hideOrb ? (
          <AriOrb size="sm" decorative />
        ) : (
          <View style={styles.orbSpacer} />
        )}
      </View>
      <View style={[styles.ariBubble, tail ? styles.ariTail : styles.noTail]}>
        {reveal ? (
          <SemanticRevealText
            text={publicText}
            textStyle={styles.ariText}
            skipSignal={revealSkipSignal}
            surface={surface}
          />
        ) : (
          <BubbleText text={publicText} style={styles.ariText} />
        )}
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
    backgroundColor:
      Platform.OS === "android"
        ? ariThread.ariBubbleAndroid
        : glass.tint.profileBase,
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
  numberGlyph: {
    color: textTokens.tertiary,
    width: 18,
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
  },
  sectionLabel: {
    fontWeight: "600",
    color: textTokens.secondary,
    letterSpacing: 0.2,
  },
  strong: {
    fontWeight: "700",
  },
  em: {
    fontStyle: "italic",
  },
  code: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});

export default ChatBubble;
