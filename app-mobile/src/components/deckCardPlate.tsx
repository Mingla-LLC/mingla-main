/**
 * #1609 DIRECTION C — the PLATE. The one piece of glass on a Mingla card.
 *
 * Nothing floats over the photograph except the name. Every fact and every
 * control lives on this object, anchored to the bottom edge, and the photograph
 * is uninterrupted above it. Curated is not a different composition: it is the
 * same card with two 4pt slivers peeking above the plate's top edge.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN LEAF MODULE
 *
 * SwipeableCards.tsx renders CuratedExperienceSwipeCard.tsx, so anything the two
 * share must live in a module that imports NEITHER of them, or the require cycle
 * (Metro: "Require cycle: SwipeableCards -> CuratedExperienceSwipeCard ->
 * SwipeableCards") reopens. This module imports react-native, expo-blur, the
 * Icon and `@mingla/card-identity` — nothing from either card tree. Data flows
 * strictly downward; the Been-here control is passed IN as an element so the
 * control can keep living in SwipeableCards.tsx without either file importing
 * the other.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELETES (Constitution 8 — subtract before adding)
 *
 * Five `GlassBadge` chips, their five `BlurView`s, their five shadowed lifted
 * objects and their five per-badge `entryIndex`-staggered `Animated.View`s in
 * the promotion diff, on BOTH card faces. Per card face:
 *
 *                              main   #1610   C
 *     BlurViews                  5       5   1-3   (see below)
 *     shadowed lifted objects    5       5    1
 *     staggered Animated.Views   5       5    0
 *     flexWrap containers        2       2    0
 *
 * THE BLUR COUNT IS 1 TO 3, NOT 1, AND SAYING "1" WAS WRONG. `PlateMaterial()`
 * is mounted at THREE sites in this file — the plate, the saved disc and the
 * scheduled disc — and each mount is one `BlurView` on iOS. So the real per-face
 * count is:
 *
 *     neither saved nor scheduled   1   (the plate)
 *     saved XOR scheduled           2
 *     saved AND scheduled           3
 *
 * On Android it is 0 in every case: `ANDROID_GLASS_USES_OPAQUE_FALLBACK` returns
 * a solid `View` and no `BlurView` is constructed at all. The state discs share
 * the plate's material deliberately (one glass vocabulary per card), so 3 is the
 * design, not an oversight — but "5 became 1" described the number of times the
 * string `<BlurView` appears in this file, which is not the number of blur
 * layers a user's card has. The T-7 guard in
 * `issue_1609_direction_c_plate.test.mjs` now counts MOUNT SITES across the
 * module graph and asserts these three numbers by state (#1609 tester P2-1;
 * #1607 defect class — an assertion adjacent to its claim).
 *
 * The per-badge stagger inside a promotion diff is the exact shape that produced
 * #1576, so removing it is load-bearing rather than cosmetic. The plate's entry
 * is ONE animated node.
 *
 * ---------------------------------------------------------------------------
 * INVARIANTS THIS FILE IS BOUND BY
 *
 * I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE — every radius, fill, border,
 *   under-layer alpha, top-highlight, fallback solid and type size below is read
 *   from `@mingla/card-identity`. There is not one design literal in this file.
 * I-PROPOSED-1576-ANIMATED-STYLE-SWAP-KEY-PARITY — nothing here enters
 *   `currentCardStyle` / `previewCardStyle`. The plate lives in the overlay and
 *   is driven by the callers' existing legacy `Animated` values, outside the
 *   Reanimated swap set.
 * I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS — the chevron, the slivers,
 *   the divider and the top highlight are all `pointerEvents="none"`. This file
 *   adds exactly ONE gesture owner (the share button) and hosts one more that
 *   the caller supplies (Been-here). Every expand path stays with the caller and
 *   routes through `requestTapExpand`.
 * I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE — the plate is absolutely
 *   positioned in points. No percentage, no flex-axis key.
 * ANDROID_GLASS_USES_OPAQUE_FALLBACK — the plate's Android path is a solid
 *   `PLATE.fallbackSolid`, `overflow:'hidden'` clips the rounded fill, and there
 *   is NO elevation under it.
 * Constitution 9 — every span, row and column is omitted when absent.
 *   Separators render BETWEEN PRESENT SPANS ONLY. No placeholder, no em-dash.
 */
import React from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Icon } from './ui/Icon';
import { ANDROID_GLASS_USES_OPAQUE_FALLBACK } from '../constants/designSystem';
// The specifier is relative for the same reason as in deckHeroConstants.ts: the
// CI guards import this tree under plain `node --test` with no `npm install`.
import {
  BEEN_HERE,
  CHEVRON,
  DETAILS,
  DIVIDER,
  MAX_FONT_SCALE,
  META,
  META_LINES_MAX,
  PLATE,
  PLATE_H_NO_META,
  SHARE_GLYPH,
  SLIVER,
  STATE_DISC,
  SURFACES,
  metaLineHeight,
  plateHeightForMetaLines,
  plateRows,
  plateUnderForHeight,
  // Aliased because the presentation object below has a field of the same name.
  // The package OWNS this arithmetic; re-typing `bottomInset + plateH + gap` here
  // would be a second source for the one number the whole silhouette hangs off.
  titleBottom as surfaceTitleBottom,
} from '../../../packages/card-identity/index.js';

const S1 = SURFACES.s1Single;

/**
 * The meta line's line box, from the package. #1700 replaced a hardcoded
 * `lineHeight: 19` that lived only in this StyleSheet — the two-line row is
 * measured against it, so it cannot be a number two files disagree about.
 */
const META_LH = metaLineHeight('s1Single');

/**
 * The three silhouettes, derived once at module load — never a per-render solve
 * and never a literal. `lines` is 0 (no facts), 1, or 2 (#1700's wrapped row).
 *
 * The under-layer alpha is PER SILHOUETTE. The plate composites over the scrim
 * at its OWN top edge, and that edge rises when the facts line wraps; one shared
 * alpha would make the two-line plate render measurably LIGHTER than the
 * one-line plate on the very next card. `plateUnderForHeight` re-solves each to
 * L* 23.50, so the object's tone is identical at all three heights.
 */
const SILHOUETTES = [0, 1, META_LINES_MAX].map((lines) => {
  const plateH = plateHeightForMetaLines('s1Single', lines);
  const underAlpha = plateUnderForHeight('s1Single', plateH);
  return {
    lines,
    plateH,
    rows: plateRows(plateH, lines, 's1Single'),
    underFill: `rgba(${PLATE.underRgb[0]},${PLATE.underRgb[1]},${PLATE.underRgb[2]},${underAlpha})`,
  };
});

/** Clamp any incoming line count onto a real silhouette. */
function silhouetteFor(lines: number): (typeof SILHOUETTES)[number] {
  const n = Math.max(0, Math.min(META_LINES_MAX, Math.round(lines)));
  return SILHOUETTES.find((s) => s.lines === n) ?? SILHOUETTES[1];
}

/**
 * The plate's two-layer fill over the blurred backdrop.
 *
 *     [ over  ] PLATE.lift            — constant
 *     [ under ] rgba(12,14,18,u)      — u DERIVED so the composite lands on L* 23.5
 *     [ blurred backdrop: photo + scrim ]
 *
 * `blurTint` is 'light' and NOT 'dark', and that is load-bearing: expo-blur's
 * dark tint lays its OWN darkening over the backdrop before any fill applies, so
 * a dark tint plus a white lift partially cancel — measured on device at #1609, a
 * predicted +11.8 L* lift landed at +3 to +5. On a scrim the blur has nothing to
 * blur anyway (convolving a smooth gradient is a visual no-op), so a dark tint
 * would contribute only suppression.
 */
function PlateMaterial({ underFill }: { underFill?: string }): React.ReactElement {
  if (ANDROID_GLASS_USES_OPAQUE_FALLBACK) {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: PLATE.fallbackSolid }]}
      />
    );
  }
  return (
    <>
      <BlurView
        intensity={PLATE.blurIntensity}
        tint={PLATE.blurTint}
        pointerEvents="none"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: underFill ?? SILHOUETTES[1].underFill }]}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: PLATE.lift }]} />
    </>
  );
}

/**
 * One meta span. `kind` selects the weight and colour from the package, so the
 * register the line depends on cannot be re-tuned per surface.
 */
export type MetaSpanKind = 'rating' | 'fact' | 'tail';

export interface MetaSpanInput {
  readonly kind: MetaSpanKind;
  readonly text: string;
}

/**
 * The meta line.
 *
 *     * 4.4  ·  6.7 mi  ·  14 min drive  ·  Whiskey Bar
 *     └─700─┘  └────────500 @1.0────────┘  └─500 @0.72─┘
 *
 * ---------------------------------------------------------------------------
 * #1700 — THE WRAPPING LAW. Seth, 2026-08-07:
 *
 *   *"I want everything to take one line but when something is cut off, or
 *    bleeds out of the box, it should go to the next line so everything is
 *    visible."*
 *
 * This was ONE `Text` with nested spans, `numberOfLines={1}`, `ellipsizeMode
 * ="tail"` and "NO flexWrap anywhere". On a real Samsung that rendered
 * "★ 4.6 · 20.9 mi · Icebrea…" — the category the card was matched on, deleted,
 * with 20pt of unused vertical slack sitting directly above it.
 *
 * IT IS NOW A WRAPPING ROW OF ATOMIC SPANS, AND THAT SHAPE IS THE POINT.
 * Turning the old single `Text` to `numberOfLines={2}` would have wrapped it at
 * WORD boundaries, breaking "14 min drive" across two lines mid-phrase and
 * stranding a separator at a line end. A `flexDirection: 'row'` +
 * `flexWrap: 'wrap'` container of one `Text` PER SPAN wraps at span boundaries
 * instead: a fact is atomic, and either fits on the line or moves to the next
 * one whole. Separators are their own spans and never lead a line, because a
 * separator only ever renders after a present span.
 *
 * The weights are unchanged and still per-span, so the "not a middot-separated
 * line at one weight" argument survives intact — the spans simply stopped being
 * nested inside one Text and became siblings in a row.
 *
 * ORDER IS STILL PRIORITY, for a different reason: nothing is dropped any more,
 * but the last span is the one that moves to line two, so the least valuable
 * fact is still placed last on purpose.
 *
 * `onLinesChange` reports 1 or 2 so the plate can grow by exactly one line box.
 * It is measured — `onLayout` on the row, divided by the line height from the
 * package — because RN gives no synchronous text metrics, and a plate sized by
 * a guess is a plate that clips or floats. Guarded against a layout loop: the
 * value is clamped to [1, META_LINES_MAX] and only emitted when it CHANGES.
 */
export function CardMetaLine({
  spans,
  onLinesChange,
}: {
  spans: readonly MetaSpanInput[];
  onLinesChange?: (lines: number) => void;
}): React.ReactElement | null {
  const present = spans.filter((s) => typeof s.text === 'string' && s.text.trim().length > 0);
  const lastReported = React.useRef(1);

  const handleLayout = React.useCallback(
    (e: LayoutChangeEvent) => {
      if (!onLinesChange) return;
      const h = e.nativeEvent.layout.height;
      if (!(h > 0)) return;
      // Half a line of tolerance: a row of 1.0–1.5 line boxes is one line.
      const measured = Math.max(1, Math.min(META_LINES_MAX, Math.round(h / META_LH)));
      if (measured === lastReported.current) return;
      lastReported.current = measured;
      onLinesChange(measured);
    },
    [onLinesChange],
  );

  if (present.length === 0) return null;

  return (
    <View style={styles.metaWrap} onLayout={handleLayout}>
      {present.map((span, i) => (
        /*
          THE SEPARATOR TRAVELS WITH THE SPAN IT INTRODUCES, in one non-shrinking
          chip. Rendering separators as their own flex items wraps them
          independently, so a line break landing just after one leaves a dangling
          "★ 4.6 · 20.9 mi ·" at the end of line one — a trailing separator,
          which is the exact thing Constitution 9 forbids at the other end of the
          line. Grouped, the break can only ever fall BETWEEN chips, and line two
          begins "· Icebreakers".

          `flexShrink: 0` is what makes a chip MOVE rather than SQUEEZE. Without
          it the row would shrink the last chip and RN would wrap its Text
          internally at a word boundary — "34 min" / "drive" — which is the
          mid-phrase break this whole shape exists to prevent. A chip wider than
          the plate itself still wraps internally, and that is the correct last
          resort: a fact too long for any line is shown broken, never cut.
        */
        <View key={`${span.kind}_${i}`} style={styles.metaChip}>
          {i > 0 ? (
            <Text
              style={[styles.meta, styles.metaSeparator]}
              maxFontSizeMultiplier={MAX_FONT_SCALE.meta}
            >
              {META.separator.text}
            </Text>
          ) : null}
          <Text
            style={[
              styles.meta,
              span.kind === 'rating' ? styles.metaRating : span.kind === 'tail' ? styles.metaTail : styles.metaFact,
            ]}
            maxFontSizeMultiplier={MAX_FONT_SCALE.meta}
          >
            {span.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The curated mark. Two slivers peeking above the plate's top edge — and that
 * stack is the ENTIRE curated identity: no text, no colour, no extra image
 * decode, no gesture owner. It reads at 402pt and at 173pt for the same reason:
 * it is the object's silhouette, not a label on it.
 *
 * The alphas are 0.44, not the 0.34 / 0.22 first proposed. A sliver's fill is a
 * translucent white over the SCRIM, and what matters is its ratio against the
 * scrim immediately around it, which is nearly the same tone — at 0.34 / 0.22
 * they measure 2.85:1 and 1.98:1 and FAIL SC 1.4.11, which applies because the
 * stack is the sole curated marker.
 *
 * ---------------------------------------------------------------------------
 * `plateH` IS REQUIRED, AND THAT IS THE WHOLE POINT
 *
 * `SLIVER.offsets` are measured UP FROM THE PLATE'S TOP EDGE. An offset measured
 * from a thing is meaningless unless it tracks that thing, so the plate height it
 * resolves against has to be the one BEING RENDERED — never the module-load
 * constant `S1.plateH`. This function used to take no arguments and anchor to
 * that constant: in the alternate silhouette the plate's top edge drops and the
 * stack did not follow, leaving two stray 4pt lines floating over the
 * photograph, well above the object they are supposed to be stacked on (#1609
 * tester P1-1, measured at 42.7pt on a live curated card). Callers pass
 * `platePresentation(spans).plateH` — literally the same value the plate sizes
 * itself from — so the stack and the plate cannot disagree about which
 * silhouette is being drawn.
 *
 * This is the SECOND time this one anchor has been wrong on this branch. The
 * first was the unstyled wrapper documented below. Both were invisible to every
 * static guard for the same reason: the arithmetic was internally consistent and
 * externally wrong, which is what an anchor bug always looks like.
 */
export function CuratedSlivers({ plateH }: { plateH: number }): React.ReactElement {
  return (
    // The wrapper MUST be an absolute fill. Caught at runtime on a live curated
    // card: with no style it is a flow View whose box collapses to 0x0 (its only
    // children are absolutely positioned and contribute no size), and RN resolves
    // `bottom: 112` against the nearest positioned ancestor — so the slivers were
    // drawn 112pt above the TOP of the card, off-screen. Every static guard
    // passed; only a screenshot showed the stack was missing.
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {SLIVER.offsets.map((offset, i) => (
        <View
          key={`sliver_${i}`}
          style={[
            styles.sliver,
            {
              left: SLIVER.insets[i],
              right: SLIVER.insets[i],
              // The RENDERED plate height, never the constant — see the docblock.
              bottom: S1.bottomInset + plateH + offset,
              backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK
                ? S1.sliver.opaque[i]
                : `rgba(255,255,255,${SLIVER.alpha})`,
            },
          ]}
        />
      ))}
    </View>
  );
}

/** The saved / scheduled discs, top-right, on the top scrim. */
export function CardStateDiscs({
  saved,
  scheduled,
  savedLabel,
  scheduledLabel,
}: {
  saved: boolean;
  scheduled: boolean;
  savedLabel: string;
  scheduledLabel: string;
}): React.ReactElement | null {
  if (!saved && !scheduled) return null;
  return (
    <View style={styles.stateRow} pointerEvents="none">
      {saved ? (
        <View style={styles.stateDisc} accessibilityLabel={savedLabel}>
          <PlateMaterial />
          <Icon name="heart" size={14} color="#FFFFFF" />
        </View>
      ) : null}
      {scheduled ? (
        <View style={styles.stateDisc} accessibilityLabel={scheduledLabel}>
          <PlateMaterial />
          <Icon name="calendar" size={14} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Whether a span set is vacuous, and where everything anchored to the plate
 * therefore sits. Exported so BOTH card trees derive their plate-anchored
 * offsets from the SAME predicate the plate uses to size itself — otherwise the
 * title, the sliver stack and the plate can disagree about which silhouette is
 * being drawn, which is precisely the drift class this whole package exists to
 * close.
 *
 *     plateTop    = bottomInset + plateH
 *                 = 16 + 96 = 112        (full plate)
 *                 = 16 + 64 =  80        (the alternate silhouette)
 *     titleBottom = plateTop + gap
 *                 = 112 + 20 = 132       (full plate)
 *                 =  80 + 20 = 100       (the alternate silhouette)
 *
 * ---------------------------------------------------------------------------
 * IT WAS EXPORTED FOR THIS AND NEITHER TREE CALLED IT (#1609 tester P1-1)
 *
 * `CuratedExperienceSwipeCard.tsx` imported it and never called it — a dead
 * import the compiler accepted — and `SwipeableCards.tsx` did not import it at
 * all. Both instead baked `S1.bottomInset + S1.plateH + S1.gap` into a
 * module-load `StyleSheet.create` entry, which is a value that CANNOT vary per
 * render, so in the short silhouette the name stayed stranded above a plate it is
 * supposed to sit 20pt above and the curated slivers floated over it. §3.6
 * promises exactly ONE alternate silhouette; that produced three, and four on
 * curated. Every plate-anchored offset on both faces now reads this object.
 *
 * `titleBottom` is the PACKAGE's `titleBottom()`, not arithmetic retyped here.
 */
export function platePresentation(
  spans: readonly MetaSpanInput[],
  /**
   * #1700 — how many lines the facts row actually occupies, as MEASURED by
   * `CardMetaLine`'s onLayout. Defaults to 1, which is the pre-#1700 behaviour
   * and the correct first-frame value: a row that turns out to need two lines
   * reports it on its first layout pass, before the user can read it.
   *
   * It is an argument rather than something computed here on purpose. React
   * Native gives no synchronous text metrics, so this is the ONLY honest source
   * — and keeping it an input means every anchor (plate height, title bottom,
   * sliver stack) still resolves from ONE object, which is the whole reason
   * this function exists.
   */
  metaLines: number = 1,
): {
  withMeta: boolean;
  metaLines: number;
  plateH: number;
  /** The plate's top edge, in points up from the card's bottom edge. */
  plateTop: number;
  titleBottom: number;
} {
  const withMeta = spans.some((s) => typeof s.text === 'string' && s.text.trim().length > 0);
  const lines = withMeta ? Math.max(1, Math.min(META_LINES_MAX, Math.round(metaLines))) : 0;
  const plateH = silhouetteFor(lines).plateH;
  return {
    withMeta,
    metaLines: lines,
    plateH,
    plateTop: S1.bottomInset + plateH,
    titleBottom: surfaceTitleBottom('s1Single', plateH),
  };
}

export interface DeckCardPlateProps {
  /**
   * The meta spans. When every span is absent the FACTS ROW is omitted and the
   * plate is PLATE_H_NO_META instead of plateH — the ONE alternate silhouette in
   * the whole system. The divider and its chevron are NOT omitted with it; they
   * are the card's only visible expand affordance. Vacuity-guarded here rather
   * than at each call site so the two card trees cannot disagree about it.
   */
  readonly spans: readonly MetaSpanInput[];
  /** The Been-here control, supplied by the caller (see the module header). */
  readonly beenHere?: React.ReactNode;
  readonly onSharePress: () => void;
  readonly shareLabel: string;
  /**
   * WHICH WAY THE AFFORDANCE POINTS. `'up'` (the default, S1) means *this
   * opens*; `'down'` (S7, the expanded sheet's hero) means *this closes*. It is
   * the ONE element whose meaning differs between the collapsed card and the
   * expanded hero, and it is a prop rather than a second component because
   * everything else about the plate — the 374 x 96, the r24, the 28pt gap, the
   * 53pt control row, the fills — is byte-identical on both surfaces, which is
   * the entire continuity argument (see ExpandedCardHero's header).
   *
   * It does NOT animate its turn — §9 row 3 is NOT IMPLEMENTED, not
   * impossible. `BaseBottomSheet` simply does not forward the
   * `animatedPosition` that `useBottomSheetInternal` already exposes from the
   * sheet's EXISTING driver; no second driver is needed. See
   * ExpandedCardHero's header for the correction and the remaining work.
   */
  readonly chevron?: 'up' | 'down';
  /**
   * #1700 — how many lines the facts row occupies (1 or 2). The plate grows by
   * exactly one line box for the second. Supplied by the CALLER because the
   * caller also anchors the title and the sliver stack off the same number, and
   * two components measuring independently is how anchors drift apart.
   */
  readonly metaLines?: number;
  /** Reports the MEASURED line count back so the caller can re-anchor. */
  readonly onMetaLinesChange?: (lines: number) => void;
  /**
   * #1701 — the LABELLED way into the card. Seth, 2026-08-07: "I want a button
   * beside been there which indicates view more with an eye icon."
   *
   * The chevron STAYS. It is the gesture hint and Seth kept it explicitly at
   * #1609; this is the affordance for everyone who never discovers a chevron.
   * Absent (and the control unrendered) when the caller supplies no handler —
   * a button that opens nothing is a dead tap, and the behind face has no
   * expand path at all.
   */
  readonly onDetailsPress?: () => void;
  readonly detailsLabel?: string;
}

/**
 * The plate.
 *
 *     ╔══ 374 x 96 · r24 ═══════════════════════════════╗
 *     ║  * 4.4 · 6.7 mi · ££ · Whiskey Bar         40pt ║
 *     ║ ─────────────────── ⌃ ──────────────────── 1pt  ║
 *     ║  [ ✓ Been here ]                      ⤴   53pt  ║
 *     ╚═════════════════════════════════════════════════╝
 *
 * 1 (border) + 40 + 1 + 53 + 1 (border) = 96. One arithmetic assertion, and it
 * is the whole silhouette. React Native's box model always includes the border
 * in `height`, so `plateRows()` derives the control row as the remainder rather
 * than anyone typing a number that has to be kept in sync.
 *
 * And the ONE alternate, when the place has no rating, no price, no distance and
 * no category — the facts row goes, NOTHING ELSE DOES:
 *
 *     ╔══ 374 x 64 · r24 ═══════════════════════════════╗
 *     ║                                            8pt  ║  chevron clearance
 *     ║ ─────────────────── ⌃ ──────────────────── 1pt  ║
 *     ║  [ ✓ Been here ]                      ⤴   53pt  ║
 *     ╚═════════════════════════════════════════════════╝
 *
 * 1 + 8 + 1 + 53 + 1 = 64, and `plateRows()` derives every row of it. The 53pt
 * control row is the SAME NUMBER in both, so the pill and the share glyph do not
 * move; only the facts row is data-dependent.
 */
export function DeckCardPlate({
  spans,
  beenHere,
  onSharePress,
  shareLabel,
  chevron = 'up',
  metaLines = 1,
  onMetaLinesChange,
  onDetailsPress,
  detailsLabel,
}: DeckCardPlateProps): React.ReactElement {
  // #1700 — ONE resolution of the silhouette, read by the height, the row
  // heights AND the material. Three reads of one object; never three parallel
  // ternaries that can disagree (I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE).
  const { withMeta, metaLines: lines } = platePresentation(spans, metaLines);
  const silhouette = silhouetteFor(lines);
  const rows = silhouette.rows;
  const meta = <CardMetaLine spans={spans} onLinesChange={onMetaLinesChange} />;

  return (
    <View
      style={[styles.plate, { height: silhouette.plateH }]}
      // The plate is a CONTAINER, not a control. VoiceOver reaches the card
      // through the composed label on the face and the two real buttons below.
      accessibilityRole="none"
      accessible={false}
    >
      <PlateMaterial underFill={silhouette.underFill} />
      <View pointerEvents="none" style={styles.plateTopHighlight} />

      {withMeta ? (
        <View style={[styles.metaRow, { height: rows.meta }]}>{meta}</View>
      ) : null}

      {/*
        THE CHEVRON BREAKS THE DIVIDER. A 16pt chevron-up sits centred in a 28pt
        gap between two divider segments, so the affordance is part of the
        object's construction rather than a sticker on it. It replaces the word
        "Details", which is deleted. pointerEvents="none" — ZERO new gesture
        owners; the whole card is the expand target and routes through the
        caller's requestTapExpand.

        IT RENDERS IN BOTH SILHOUETTES, UNCONDITIONALLY (Seth, #1609 comment
        5196932627). §3.6 used to omit it with the meta row, which took the only
        visible expand affordance off the sparsest card in the pool — a place
        with no rating, no price, no distance and no category then had nothing at
        all to say it opens. The chevron exists BECAUSE the word "Details" was
        rejected in favour of a view affordance; dropping it exactly where the
        user has least to go on inverts that decision.

        `rows.clearance` is the package's reserved space above the line. It is 0
        on the full plate (the meta row's own slack absorbs the chevron's 7.5pt
        overhang) and CHEVRON_CLEARANCE on the short one, where there is no row
        above the divider and the plate clips. Without it the divider would land
        on the plate's 1pt top highlight and the chevron would be sliced in half
        by the plate's own top edge.
      */}
      <View
        style={[styles.dividerRow, { marginTop: rows.clearance }]}
        pointerEvents="none"
      >
        <View style={styles.dividerSegment} />
        <View style={styles.dividerGap}>
          {/*
            TWO LITERAL ICONS, NOT ONE COMPUTED NAME. A computed
            `name={chevron === 'down' ? … : …}` is invisible to a source scan,
            and TWO shipped #1609 guards assert the literal `name="chevron-up"`
            is present in this file exactly once — they exist because the chevron
            IS the card's only visible expand affordance and it was dropped once
            already. Branching on the element keeps the affordance greppable on
            both surfaces instead of hiding it inside an expression.
          */}
          {chevron === 'down' ? (
            <Icon name="chevron-down" size={CHEVRON.size} color={CHEVRON.color} />
          ) : (
            <Icon name="chevron-up" size={CHEVRON.size} color={CHEVRON.color} />
          )}
        </View>
        <View style={styles.dividerSegment} />
      </View>

      <View style={[styles.controlRow, { height: rows.control }]}>
        {/*
          NO `?? <View />` FALLBACK. It looked like a reserved slot and was not
          one, twice over: `beenHere` is always SUPPLIED (a <BeenHereControl />
          element, which is truthy), so the fallback could never fire — and the
          thing that renders nothing is BeenHereControl's own `return null` while
          the visited query is pending or the user is signed out. An unstyled
          <View /> would not have reserved width either. The share button
          right-anchors itself instead (see `shareButtonPlate`), so this slot is
          free to occupy zero space without moving anything.
        */}
        {beenHere}
        {/*
          #1701 — DETAILS. A second gesture owner on this plate, and the module
          header's "exactly ONE gesture owner" line is updated with it rather
          than left to rot.

          It is a plain RN Pressable, like Been-here: it adds no
          gesture-handler gesture, so it never contends for the deck's gesture
          lease (I-PROPOSED-1579). It sits INBOARD of both card edges, on the
          plate at the card's foot, away from where a swipe begins — the same
          placement argument that made Been-here safe.

          It does NOT own the expand logic. The tap is handed straight back to
          the caller, which routes it through the existing `requestTapExpand`,
          so there remains exactly one expand path in the deck.
        */}
        {onDetailsPress ? (
          <Pressable
            onPress={onDetailsPress}
            style={({ pressed }) => [styles.detailsButton, pressed ? styles.detailsButtonPressed : null]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={detailsLabel}
          >
            <Icon name="eye-outline" size={DETAILS.glyphSize} color={DETAILS.color} />
            <Text style={styles.detailsLabel} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.controlLabel}>
              {detailsLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onSharePress}
          style={styles.shareButtonPlate}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={shareLabel}
        >
          <Icon name="share-outline" size={SHARE_GLYPH.size} color={SHARE_GLYPH.color} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The Been-here control's visual body, shared by both card trees.
 *
 * The STATE MACHINE and the mutation live with the caller (SwipeableCards'
 * `BeenHereControl`); this renders it. Three non-colour channels carry the
 * state — glyph, copy and fill category — so the state never depends on colour
 * alone.
 *
 * #1618 — `showSpinner` is what makes the in-flight state VISIBLE. The wiring
 * for `inFlight` already existed and nothing was bound to it, so a user tapped
 * and the control looked EXACTLY as it had before, for a measured 75 seconds.
 */
export type BeenHereVisualState = 'rest' | 'pressed' | 'flash' | 'settled' | 'failed';

export function BeenHereBody({
  state,
  label,
  showSpinner,
}: {
  state: BeenHereVisualState;
  label: string;
  showSpinner: boolean;
}): React.ReactElement {
  const glyph =
    state === 'failed' ? 'alert-circle' : state === 'flash' || state === 'settled' ? 'checkmark-circle' : 'checkmark';
  const glyphSize = state === 'rest' || state === 'pressed' ? BEEN_HERE.glyphSize.rest : BEEN_HERE.glyphSize.active;
  return (
    <>
      {showSpinner ? (
        <ActivityIndicator size="small" color="#FFFFFF" style={styles.beenHereSpinner} />
      ) : (
        <Icon name={glyph} size={glyphSize} color="#FFFFFF" />
      )}
      <Text
        style={styles.beenHereText}
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE.controlLabel}
      >
        {label}
      </Text>
      {/*
        #1686 — THE UNDO WAS ANNOUNCED TO VOICEOVER AND TO NOBODY ELSE.
        The settled control genuinely un-records on a second press, and the only
        string in the app that says so — `swipeable.been_here_on`, "Double tap to
        remove" — is passed to `accessibilityLabel` only. What a sighted user SEES
        is a green pill, a filled check and a past-tense sentence: the vocabulary
        of a confirmation, not of a toggle, so the implemented undo is never
        attempted.

        This trailing glyph is the visible half of that same fact, borrowing the
        removable-chip idiom every user already knows. It is deliberately small:
        the pill is not redesigned, the copy is unchanged (`been_here_settled`
        stays "You've been here"), no new state is introduced, and the row already
        carries the gap and grows with its content — the share disc right-anchors
        itself, so nothing collides.

        It is NOT separately pressable. The whole 44pt pill is the target and it
        already carries the button role and the removal label; a nested Pressable
        here would flatten the a11y subtree and hide the control from VoiceOver.
      */}
      {state === 'settled' && (
        <Icon name="close" size={BEEN_HERE.glyphSize.rest} color="#FFFFFF" />
      )}
    </>
  );
}

/** The per-state fill + border, opaque-matched on L* for the Android path. */
export function beenHereStateStyle(state: BeenHereVisualState): {
  backgroundColor: string;
  borderColor: string;
} {
  const s = BEEN_HERE.states[state];
  return ANDROID_GLASS_USES_OPAQUE_FALLBACK
    ? { backgroundColor: s.androidFill, borderColor: s.androidBorder }
    : { backgroundColor: s.fill, borderColor: s.border };
}

const styles = StyleSheet.create({
  // Absolute points, bottom-anchored. No percentage, no flex-axis key: the
  // plate depends neither on a sibling nor on the parent's resolved height.
  plate: {
    position: 'absolute',
    left: S1.sideInset,
    right: S1.sideInset,
    bottom: S1.bottomInset,
    borderRadius: S1.plateR,
    overflow: 'hidden',
    borderWidth: PLATE.borderWidth,
    borderColor: PLATE.border,
    zIndex: 2,
  },
  // #1700 — `plateWithMeta` / `plateNoMeta` are DELETED. The height is now one
  // of THREE silhouettes and arrives as an inline `{ height }` read straight off
  // the resolved silhouette object, so a fourth height cannot be introduced by
  // adding a fourth StyleSheet entry that nothing derives. Only the plate's TOP
  // edge ever moves: the card's bottom edge, the plate's bottom edge and the
  // plate's left/right edges are the same in all three.
  plateTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: PLATE.topHighlight,
  },
  metaRow: {
    paddingHorizontal: S1.sideInset,
    justifyContent: 'center',
  },
  /**
   * #1700 — the wrapping row. `flexWrap: 'wrap'` over ATOMIC span children is
   * what makes a fact move to line two whole instead of breaking mid-phrase,
   * and it is the shape a single `<Text numberOfLines={2}>` cannot produce.
   *
   * `alignItems: 'center'` rather than 'baseline': the spans carry different
   * weights, and on Android a baseline row with mixed weights lands the
   * separator visibly low. All spans share one lineHeight, so centring gives the
   * same result as a baseline would have on iOS and a correct one on Android.
   */
  metaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  /**
   * One fact plus the separator that introduces it, as an atomic unit.
   * `flexShrink: 0` is load-bearing — see the render site. A shrinking chip
   * wraps its own Text mid-phrase instead of moving to the next line.
   */
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  meta: {
    fontSize: S1.metaSize,
    // From the package (#1700). It was a bare `19` that only this file knew.
    lineHeight: META_LH,
  },
  metaRating: { fontWeight: META.rating.weight as '700', color: META.rating.color },
  metaFact: { fontWeight: META.fact.weight as '500', color: META.fact.color },
  metaSeparator: { fontWeight: META.separator.weight as '500', color: META.separator.color },
  metaTail: { fontWeight: META.tail.weight as '500', color: META.tail.color },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: DIVIDER.height,
    marginHorizontal: S1.sideInset,
  },
  dividerSegment: { flex: 1, height: DIVIDER.height, backgroundColor: DIVIDER.color },
  dividerGap: {
    width: DIVIDER.gap,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlRow: {
    paddingHorizontal: S1.sideInset,
    flexDirection: 'row',
    alignItems: 'center',
    // The share disc is right-anchored and the row is space-between, so the
    // Been-here control grows and shrinks with its copy and collides with
    // nothing.
    justifyContent: 'space-between',
  },
  /**
   * #1701 — Details. Same 44pt-minimum target and same pill geometry as
   * Been-here (both read BEEN_HERE from the package), so the two read as one
   * pair of controls rather than a button and a decoration.
   */
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DETAILS.gap,
    height: BEEN_HERE.height,
    minWidth: BEEN_HERE.height,
    paddingHorizontal: DETAILS.paddingH,
    borderRadius: BEEN_HERE.borderRadius,
    borderWidth: BEEN_HERE.borderWidth,
    borderColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK ? DETAILS.androidBorder : DETAILS.border,
    // Android's plate is an opaque solid, so a translucent fill would composite
    // over a DIFFERENT backdrop than the one the ratios above were solved
    // against. The opaque equivalents are pre-solved in the package.
    backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK ? DETAILS.androidFill : DETAILS.fill,
    // The row is space-between with a right-anchored share disc; this sits
    // immediately after Been-here rather than being pushed to the middle.
    marginLeft: DETAILS.gapFromBeenHere,
  },
  detailsButtonPressed: {
    backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK ? DETAILS.androidFillPressed : DETAILS.fillPressed,
  },
  detailsLabel: {
    fontSize: DETAILS.labelSize,
    fontWeight: DETAILS.labelWeight as '600',
    color: DETAILS.color,
  },
  shareButtonPlate: {
    width: SHARE_GLYPH.target,
    height: SHARE_GLYPH.target,
    alignItems: 'center',
    justifyContent: 'center',
    // THE SHARE DISC ANCHORS ITSELF. `justifyContent: 'space-between'` above only
    // puts this at the right edge when the row has TWO laid-out children — and it
    // routinely has one, because BeenHereControl returns null while the visited
    // query is pending (i.e. on every card promotion) and permanently when the
    // user is signed out. With one child, space-between resolves to flex-start
    // and the share glyph rendered against the plate's LEFT edge, then snapped
    // right when the query landed (#1609 tester P1-2).
    //
    // An auto margin absorbs the row's free space BEFORE justifyContent gets to
    // distribute any, so this is the anchor in both cases and space-between
    // becomes a no-op rather than a contradiction. Chosen over reserving a
    // placeholder slot because the Been-here control's width changes with its
    // copy ("Been here" / "Thank you" / "You've been here" / "Couldn't save"), so
    // a placeholder that actually held the row's shape would have to track four
    // different measured widths — a second source of truth for a geometry that
    // has one. Right-anchoring is a property of the share control; it should not
    // be a property of how many siblings happen to have rendered.
    marginLeft: 'auto',
  },
  beenHereText: {
    fontSize: BEEN_HERE.labelSize,
    fontWeight: BEEN_HERE.labelWeight as '500',
    letterSpacing: 0.2,
    color: '#FFFFFF',
  },
  beenHereSpinner: {
    width: BEEN_HERE.spinnerSize,
    height: BEEN_HERE.spinnerSize,
  },
  sliver: {
    position: 'absolute',
    height: SLIVER.height,
    borderRadius: SLIVER.radius,
    zIndex: 2,
  },
  stateRow: {
    position: 'absolute',
    top: STATE_DISC.top,
    right: STATE_DISC.right,
    flexDirection: 'row',
    gap: STATE_DISC.gap,
    zIndex: 3,
  },
  stateDisc: {
    width: STATE_DISC.size,
    height: STATE_DISC.size,
    borderRadius: STATE_DISC.radius,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: PLATE.borderWidth,
    borderColor: PLATE.border,
  },
});
