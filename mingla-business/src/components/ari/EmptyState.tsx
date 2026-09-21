/**
 * ORCH-0821 — Ari empty state (first run).
 * Big orb + headline + body.
 *
 * ORCH-1057 — removed the always-on 3-chip wall (it duplicated the
 * `+`-triggered suggestions panel, the single intended entry point for
 * examples). Replaced with one quiet, non-tappable hint row that points at
 * the composer `+` so a first-run user is never stranded.
 *
 * #3429 REWORK-4 N-1 — PRIORITY, not trimming. The hero draws inside a box
 * whose visible bottom edge is clamped to the composer's top edge while the
 * keyboard is up (AriChatScreen owns that clamp). REWORK-2 satisfied the
 * no-overlap criterion by letting the whole empty state overflow that edge and
 * clipping it, which cost a first-run user the body sentence AND the entire
 * attach hint — on an iPhone SE, both — at the exact moment they tap the
 * composer. That is the one instruction this feature exists to ship.
 *
 * The empty state is now two zones with an explicit drop order:
 *   - the DECORATIVE zone (orb, headline, body) is clipped and shrinks as the
 *     clamp grows, so it is what gives way first. Its inner box keeps the
 *     keyboard-independent resting height, so the orb and headline do not move
 *     — the ORCH-1057 no-jump contract is untouched;
 *   - the HINT zone never shrinks and is laid out after it, so the attach hint
 *     is the LAST content dropped and always renders above the composer.
 */

import React from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Plus } from "lucide-react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";

/** The hero geometry the SCREEN owns and this component consumes. */
export interface AriEmptyStateLayout {
  /**
   * How far the hero's VISIBLE bottom edge sits above the bottom of its
   * resting box, in px — i.e. how much of this component is clipped away while
   * the keyboard is up. 0 when the keyboard is down and on web.
   */
  viewportBottomClampPx: number;
}

/**
 * Delivered as context rather than a prop: ORCH-1057's committed tests pin
 * `<EmptyState />` as propless in AriChatScreen (that is how they prove the
 * chip wall never comes back), so the geometry cannot travel as an attribute.
 * The screen stays the single owner of the number — this component only reads
 * it.
 */
export const AriEmptyStateLayoutContext =
  React.createContext<AriEmptyStateLayout>({ viewportBottomClampPx: 0 });

const HOST_PADDING_BOTTOM = spacing.xxl;

/** Track a subtree's measured height without re-rendering on equal values. */
function useMeasuredHeight(): [number, (event: LayoutChangeEvent) => void] {
  const [height, setHeight] = React.useState(0);
  const handleLayout = React.useCallback((event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.height);
    setHeight((previous) => (previous === next ? previous : next));
  }, []);
  return [height, handleLayout];
}

export const EmptyState: React.FC = () => {
  const { viewportBottomClampPx } = React.useContext(AriEmptyStateLayoutContext);
  // The host fills the screen's resting box, whose height is keyboard-
  // independent by construction, so this measures the RESTING height even
  // while the keyboard is up. That is what keeps the orb still.
  const [restingHeightPx, handleHostLayout] = useMeasuredHeight();
  const [hintHeightPx, handleHintLayout] = useMeasuredHeight();

  const measured = restingHeightPx > 0;
  // What the decorative zone occupies at rest: everything the hint row and the
  // host's own bottom padding do not.
  const heroRestingHeightPx = Math.max(
    0,
    restingHeightPx - HOST_PADDING_BOTTOM - hintHeightPx,
  );
  // ...and what is left of it once the clamp lifts the visible bottom edge.
  // Capped, never margined: a margin is not shrinkable, so at an extreme clamp
  // (tall attachment tray + keyboard on a small phone) it would push the hint
  // row off the visible box — the exact failure this fix exists to end.
  const heroVisibleHeightPx = Math.max(
    0,
    heroRestingHeightPx - viewportBottomClampPx,
  );

  return (
    <View style={styles.host} onLayout={handleHostLayout}>
      <View
        style={[
          styles.heroClip,
          measured ? { maxHeight: heroVisibleHeightPx } : null,
        ]}
      >
        <View
          style={[
            styles.heroAnchor,
            measured ? { minHeight: heroRestingHeightPx } : null,
          ]}
        >
          <View style={styles.orbWrap}>
            <AriOrb size="lg" thinking decorative={false} accessibilityLabel="Ari" />
          </View>
          <Text style={styles.headline}>Hi, I&apos;m Ari.</Text>
          <Text style={styles.body}>
            I can create events, manage brands, and answer questions about your business.
          </Text>
        </View>
      </View>
      {/* ORCH-1101 REWORK Bug #5: the hint must reference the ACTUAL + button, not
          a literal "+" character. The "word" is the button glyph itself, rendered
          as a chip that mirrors the InputBar "+" suggestions button (bordered
          circle, lucide Plus) inline in the sentence. accessibilityLabel keeps the
          spoken sentence natural. #3429 gives the + button to attachments.

          [TEST-MOD-APPROVED #3429] REWORK-2 R-3: this docblock deliberately does
          NOT quote the shipped sentence. Three suites assert the first-run copy is
          byte-stable by reading this file, and while the prose quoted the sentence
          those assertions were satisfied by the comment alone — the shipped copy
          could be changed to anything and all three still passed. Do not restore
          a quotation here; the copy is below, and the assertions are anchored to
          the <Text> element that renders it.

          #3429 REWORK-4 N-1: this row is the LAST thing dropped. Its zone does
          not shrink and is measured, so the decorative zone above can be sized
          around it. */}
      <View style={styles.hintZone} onLayout={handleHintLayout}>
        <View
          style={styles.hintRow}
          accessibilityRole="text"
          accessibilityLabel="Tap the plus button to attach context"
        >
          <Text style={styles.hintText}>Tap </Text>
          <View style={styles.hintChip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Plus size={13} color={textTokens.tertiary} strokeWidth={2.25} />
          </View>
          <Text style={styles.hintText}> to attach context</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: HOST_PADDING_BOTTOM,
  },
  // #3429 REWORK-4 N-1 — the decorative zone. `overflow: hidden` here (rather
  // than only on the screen's outer box) is what makes the hero the thing that
  // gives way: it is clipped at its OWN bottom edge, above the hint row,
  // instead of the hint row being clipped at the screen's edge.
  heroClip: {
    flex: 1,
    width: "100%",
    overflow: "hidden",
  },
  // Keeps the resting height whatever the clamp does, so the content centred
  // inside it never re-centres and the orb never moves.
  heroAnchor: {
    flexGrow: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  orbWrap: {
    marginBottom: spacing.lg,
  },
  headline: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    marginTop: spacing.sm,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    maxWidth: 280,
  },
  // `flexShrink: 0` is the whole contract: the attach hint outlives the hero.
  // The gap that used to be the hint row's marginTop lives here as padding so
  // the measured height includes it.
  hintZone: {
    flexShrink: 0,
    alignItems: "center",
    paddingTop: spacing.xl,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  // ORCH-1101 REWORK Bug #5: a bordered circle chip that visually quotes the
  // InputBar "+" suggestions button so the hint literally points at it.
  hintChip: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 2,
  },
  hintText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
  },
});

export default EmptyState;
