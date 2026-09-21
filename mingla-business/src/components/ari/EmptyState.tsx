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
 *   - the DECORATIVE zone (orb, headline, body) is capped to whatever height is
 *     still visible and clips, so it is what gives way first;
 *   - the HINT zone never shrinks and is laid out immediately after it, so the
 *     attach hint is the LAST content dropped and is always inside the visible
 *     region — above the composer, never behind it.
 *
 * NOTHING IS EVER CLIPPED. A half-drawn shape reads as a rendering bug rather
 * than as a deliberate reduction, so every child is either drawn whole or not
 * drawn at all:
 *   - a TEXT ROW that cannot be shown in full is not shown (REWORK-4 shipped a
 *     sliver of headline ascenders on the Pixel 7 at font scale 1.5);
 *   - the ORB steps down through AriOrb's own designed sizes until it fits, and
 *     is hidden below the smallest one (REWORK-5 F-1: the orb was sliced
 *     through its lower half into a half-disc on the iPhone SE, six seconds
 *     after the keyboard settled).
 *
 * Because of that, the decorative zone carries no `overflow: hidden` at all —
 * there is nothing left for it to clip. The cap is a decision input, not a
 * blade.
 *
 * The centring is done with an explicit, keyboard-INDEPENDENT top offset rather
 * than `justifyContent: "center"`, which is what lets the decorative zone shrink
 * without dragging the orb with it. Two consequences, both deliberate:
 *   - at rest the offset resolves to exactly what centring produced, so the
 *     resting layout is pixel-identical to what shipped before;
 *   - while the keyboard is up the orb and headline do not move at all — the
 *     ORCH-1057 no-jump contract — and the hint row rises with the visible
 *     bottom edge instead of being trimmed off it.
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
import { AriOrb, type AriOrbSize } from "./AriOrb";

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

/**
 * How far each AriOrb size PAINTS below the top of its own layout box.
 *
 * The orb's host box is `dim` square, but its halo is an absolutely positioned
 * circle of `dim + halo * 2` offset by `-halo` on both axes — so the ink runs
 * `halo` past the box on every side. Fitting the box is therefore not the same
 * as fitting the orb, and measuring cannot tell us the difference: `onLayout`
 * reports the box, never the ink.
 *
 * The ink runs `halo` past the box ABOVE it too, which is why the top offset
 * below is floored at the halo: without that the halo is clipped by the chat
 * column's own top edge, which is exactly what it did on an iPhone SE at
 * accessibility-medium.
 *
 * AriOrb owns these numbers; this is a mirror, and AriOrb is outside this
 * rework's file allowlist. The mirror cannot drift silently — T-11 in
 * issue_3429_ari_rework4_empty_state_priority.implementor.test.tsx reads
 * AriOrb.tsx and fails if either table there stops agreeing with this one.
 *
 * Below the smallest entry the orb is hidden rather than shrunk further: `sm`
 * is the size the assistant bubble already uses, so it is a real designed
 * appearance; anything under it is a dot, not the Ari mark.
 */
const ORB_LADDER: { size: AriOrbSize; dimPx: number; haloPx: number }[] = [
  { size: "lg", dimPx: 56, haloPx: 18 },
  { size: "md", dimPx: 32, haloPx: 10 },
  { size: "sm", dimPx: 24, haloPx: 6 },
];

/**
 * How much room the decorative content leaves above itself, at minimum.
 *
 * It is the LARGEST halo on the ladder, not the chosen rung's — deliberately.
 * A per-rung floor would make the content's top position depend on which rung
 * won, so the hero would shift whenever the orb changed size. One constant
 * keeps the top edge a function of the measurements alone, and it clears every
 * rung's ink by construction.
 */
const ORB_INK_HEADROOM_PX = Math.max(...ORB_LADDER.map((step) => step.haloPx));

/** Track a subtree's measured height without re-rendering on equal values. */
function useMeasuredHeight(): [number, (event: LayoutChangeEvent) => void] {
  const [height, setHeight] = React.useState(0);
  const handleLayout = React.useCallback((event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.height);
    setHeight((previous) => (previous === next ? previous : next));
  }, []);
  return [height, handleLayout];
}

/**
 * Track how far a row's BOTTOM edge sits from the top of its parent, as a
 * high-water mark.
 *
 * High-water for the same reason `heroContentPx` is: a row that this component
 * stops rendering also stops reporting, so the latest value would vanish the
 * instant it is used, and the row would flicker back into view. The natural
 * offset only changes with font scale, which needs a cold relaunch (handbook
 * §8.7) and therefore a remount.
 */
function useRowBottom(): [number, (event: LayoutChangeEvent) => void] {
  const [bottom, setBottom] = React.useState(0);
  const handleLayout = React.useCallback((event: LayoutChangeEvent): void => {
    const { y, height } = event.nativeEvent.layout;
    const next = Math.round(y + height);
    setBottom((previous) => (next > previous ? next : previous));
  }, []);
  return [bottom, handleLayout];
}

export const EmptyState: React.FC = () => {
  const { viewportBottomClampPx } = React.useContext(AriEmptyStateLayoutContext);
  // The host fills the screen's resting box, whose height is keyboard-
  // independent by construction, so this measures the RESTING height even while
  // the keyboard is up. That is what keeps the orb still.
  const [restingHeightPx, handleHostLayout] = useMeasuredHeight();
  // The decorative content's NATURAL height — the largest this box has ever
  // reported. It is deliberately NOT the latest value: once the cap below bites,
  // `onLayout` reports the CLAMPED height, and feeding that back into the offset
  // is a measurement loop that walks the orb down the screen. Measured on the
  // Pixel 7 before this was fixed: 196 → 184 → 182 → 181 → 180dp across four
  // frames, and the orb drifted 21px on a single keyboard open. `flexShrink: 0`
  // does not prevent it. A font-scale change needs a cold relaunch to re-measure
  // anything at all (handbook §8.7), and that remounts this component, so the
  // high-water mark is re-taken exactly when it should be.
  const [heroContentPx, setHeroContentPx] = React.useState(0);
  const handleHeroLayout = React.useCallback((event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.height);
    setHeroContentPx((previous) => (next > previous ? next : previous));
  }, []);
  const [hintHeightPx, handleHintLayout] = useMeasuredHeight();
  // Where each text row ENDS inside the decorative zone. A row is shown only if
  // the cap reaches its bottom edge.
  const [headlineBottomPx, handleHeadlineLayout] = useRowBottom();
  const [bodyBottomPx, handleBodyLayout] = useRowBottom();

  const measured = restingHeightPx > 0 && heroContentPx > 0 && hintHeightPx > 0;
  // What `justifyContent: "center"` used to resolve to for the whole group. It
  // does not reference the clamp, so it never moves.
  const centredTopOffsetPx = Math.round(
    (restingHeightPx - HOST_PADDING_BOTTOM - heroContentPx - hintHeightPx) / 2,
  );
  // How much of the resting box is still visible once the clamp lifts the
  // bottom edge to the composer's top.
  const visibleHeightPx = restingHeightPx - viewportBottomClampPx - HOST_PADDING_BOTTOM;

  // Where the decorative content starts, from the top of the resting box —
  // centred, but never so high that an orb's halo would be cut by the chat
  // column's own top edge. Keyboard-independent either way, so it never moves.
  const heroTopOffsetPx = measured
    ? Math.max(ORB_INK_HEADROOM_PX, centredTopOffsetPx)
    : 0;
  // What the decorative zone may occupy once the hint row has taken its share.
  // Capped, never margined: a margin is not shrinkable, so at an extreme clamp
  // (tall attachment tray + keyboard on a small phone) it would push the hint
  // row off the visible box — the exact failure REWORK-4 ended.
  const heroMaxHeightPx = measured
    ? Math.max(0, visibleHeightPx - hintHeightPx - heroTopOffsetPx)
    : 0;
  // The largest orb whose INK fits below that offset. Stepping down through
  // AriOrb's own sizes keeps the halo a circle at every keyboard height, and
  // the choice reads only the cap and the constants above — never a measurement
  // of the orb — so it cannot feed back into the layout that produced the cap.
  const orb = measured
    ? ORB_LADDER.find((step) => step.dimPx + step.haloPx <= heroMaxHeightPx)
    : ORB_LADDER[0];
  // A text row that cannot be shown IN FULL is not shown. The rows are in
  // document order, so hiding one always hides the ones below it and never
  // moves the ones above it — nothing reflows, it only disappears.
  const showHeadline = !measured || headlineBottomPx === 0 || headlineBottomPx <= heroMaxHeightPx;
  const showBody = showHeadline && (bodyBottomPx === 0 || bodyBottomPx <= heroMaxHeightPx);

  return (
    <View
      style={[styles.host, measured ? null : styles.hostBeforeMeasurement]}
      onLayout={handleHostLayout}
    >
      <View
        style={[
          styles.heroClip,
          measured ? { marginTop: heroTopOffsetPx, maxHeight: heroMaxHeightPx } : null,
        ]}
      >
        <View style={styles.heroContent} onLayout={handleHeroLayout}>
          {orb ? (
            <View style={styles.orbWrap}>
              <AriOrb size={orb.size} thinking decorative={false} accessibilityLabel="Ari" />
            </View>
          ) : null}
          {showHeadline ? (
            <Text style={styles.headline} onLayout={handleHeadlineLayout}>Hi, I&apos;m Ari.</Text>
          ) : null}
          {showBody ? (
            <Text style={styles.body} onLayout={handleBodyLayout}>
              I can create events, manage brands, and answer questions about your business.
            </Text>
          ) : null}
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
  // One frame only, before the three measurements land: centre the group the
  // way it used to be, so the first paint is never top-aligned or blank.
  hostBeforeMeasurement: {
    justifyContent: "center",
  },
  // #3429 REWORK-4 N-1 — the decorative zone: capped to what is still visible,
  // so it is the thing that gives way while the hint row below it does not.
  // #3429 REWORK-5 F-1 — and it carries no `overflow`, on purpose. Every child
  // is drawn whole or not drawn, so there is nothing left to clip; a clipping
  // box here is what sheared the orb's halo flat and sliced it in half on the
  // iPhone SE.
  heroClip: {
    width: "100%",
    alignItems: "center",
  },
  // The box whose height is measured. It overflows the cap above it on purpose
  // — the clip is the mechanism — and `flexShrink: 0` says so, though it is NOT
  // what keeps the measurement honest: see `heroContentPx`.
  heroContent: {
    width: "100%",
    alignItems: "center",
    flexShrink: 0,
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
