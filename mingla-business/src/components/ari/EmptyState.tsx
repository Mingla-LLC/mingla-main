/**
 * ORCH-0821 — Ari empty state (first run).
 * Big orb + headline + body.
 *
 * ORCH-1057 — removed the always-on 3-chip wall.
 * #3355 — the follow-on `+` instruction was removed as well. The composer
 * already communicates its attachment affordance; repeating it in the hero
 * made Ari's first impression feel instructional instead of intelligent.
 *
 * #3429 REWORK-4 N-1 — PRIORITY, not trimming. The hero draws inside a box
 * whose visible bottom edge is clamped to the composer's top edge while the
 * keyboard is up (AriChatScreen owns that clamp). REWORK-2 satisfied the
 * no-overlap criterion by letting the whole empty state overflow that edge and
 * clipping it, which cut first-run content on compact phones at the exact
 * moment the composer opened.
 *
 * The hero (orb, headline and body) is capped to the space that remains above
 * the composer. Children step down or disappear whole rather than clipping.
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
 *     ORCH-1057 no-jump contract.
 */

import React from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  AriOrb,
  type AriOrbSize,
  HALO_MULT_PX as ARI_ORB_HALO_PX,
  SIZE_PX as ARI_ORB_DIM_PX,
} from "./AriOrb";

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
 * AriOrb owns these numbers and exports them; nothing is copied here. The
 * rungs are the sizes this screen is willing to use, in descending order —
 * below the smallest the orb is hidden rather than shrunk further, because `sm`
 * is the size the assistant bubble already uses and anything under it is a dot,
 * not the Ari mark.
 *
 */
const ORB_LADDER: { size: AriOrbSize; dimPx: number; haloPx: number }[] = (
  ["lg", "md", "sm"] as const
).map((size) => ({
  size,
  dimPx: ARI_ORB_DIM_PX[size],
  haloPx: ARI_ORB_HALO_PX[size],
}));

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
  const { viewportBottomClampPx } = React.useContext(
    AriEmptyStateLayoutContext,
  );
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
  const handleHeroLayout = React.useCallback(
    (event: LayoutChangeEvent): void => {
      const next = Math.round(event.nativeEvent.layout.height);
      setHeroContentPx((previous) => (next > previous ? next : previous));
    },
    [],
  );
  // Where each text row ENDS inside the decorative zone. A row is shown only if
  // the cap reaches its bottom edge.
  const [headlineBottomPx, handleHeadlineLayout] = useRowBottom();
  const [bodyBottomPx, handleBodyLayout] = useRowBottom();

  const measured = restingHeightPx > 0 && heroContentPx > 0;
  // What `justifyContent: "center"` used to resolve to for the whole group. It
  // does not reference the clamp, so it never moves.
  const centredTopOffsetPx = Math.round(
    (restingHeightPx - HOST_PADDING_BOTTOM - heroContentPx) / 2,
  );
  // How much of the resting box is still visible once the clamp lifts the
  // bottom edge to the composer's top.
  const visibleHeightPx =
    restingHeightPx - viewportBottomClampPx - HOST_PADDING_BOTTOM;

  // Where the decorative content starts, from the top of the resting box —
  // centred, but never so high that an orb's halo would be cut by the chat
  // column's own top edge. Keyboard-independent either way, so it never moves.
  const heroTopOffsetPx = measured
    ? Math.max(ORB_INK_HEADROOM_PX, centredTopOffsetPx)
    : 0;
  // What the hero may occupy above the composer.
  const heroMaxHeightPx = measured
    ? Math.max(0, visibleHeightPx - heroTopOffsetPx)
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
  const showHeadline =
    !measured || headlineBottomPx === 0 || headlineBottomPx <= heroMaxHeightPx;
  const showBody =
    showHeadline && (bodyBottomPx === 0 || bodyBottomPx <= heroMaxHeightPx);

  return (
    <View
      style={[styles.host, measured ? null : styles.hostBeforeMeasurement]}
      onLayout={handleHostLayout}
    >
      <View
        style={[
          styles.heroClip,
          measured
            ? { marginTop: heroTopOffsetPx, maxHeight: heroMaxHeightPx }
            : null,
        ]}
      >
        <View style={styles.heroContent} onLayout={handleHeroLayout}>
          {orb ? (
            <View style={styles.orbWrap}>
              <AriOrb
                size={orb.size}
                decorative={false}
                accessibilityLabel="Ari"
              />
            </View>
          ) : null}
          {showHeadline ? (
            <Text style={styles.headline} onLayout={handleHeadlineLayout}>
              What should we tackle?
            </Text>
          ) : null}
          {showBody ? (
            <Text style={styles.body} onLayout={handleBodyLayout}>
              Tell me the outcome. I&apos;ll make a plan, use the right tools,
              and ask before anything important.
            </Text>
          ) : null}
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
  // #3429 REWORK-4 N-1 — the decorative zone is capped to what is visible.
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
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.7,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    marginTop: spacing.md,
    fontSize: typography.body.fontSize,
    lineHeight: 24,
    color: textTokens.secondary,
    textAlign: "center",
    maxWidth: 360,
  },
});

export default EmptyState;
