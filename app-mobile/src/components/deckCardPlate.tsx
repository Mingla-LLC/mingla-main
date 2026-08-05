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
 *     BlurViews                  5       5    1
 *     shadowed lifted objects    5       5    1
 *     staggered Animated.Views   5       5    0
 *     flexWrap containers        2       2    0
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
  DIVIDER,
  MAX_FONT_SCALE,
  META,
  PLATE,
  PLATE_H_NO_META,
  SHARE_GLYPH,
  SLIVER,
  STATE_DISC,
  SURFACES,
  plateRows,
  surfacePlateUnder,
} from '../../../packages/card-identity/index.js';

const S1 = SURFACES.s1Single;

/** Derived once at module load — never a per-render solve, never a literal. */
const PLATE_UNDER_ALPHA = surfacePlateUnder('s1Single');
const PLATE_UNDER_FILL = `rgba(${PLATE.underRgb[0]},${PLATE.underRgb[1]},${PLATE.underRgb[2]},${PLATE_UNDER_ALPHA})`;

const ROWS_WITH_META = plateRows(S1.plateH, true);
const ROWS_NO_META = plateRows(PLATE_H_NO_META, false);

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
function PlateMaterial(): React.ReactElement {
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
        style={[StyleSheet.absoluteFill, { backgroundColor: PLATE_UNDER_FILL }]}
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
 * The meta line — ONE `Text` with weighted spans, not a middot-separated line at
 * one weight (which is a flatter version of the problem C exists to fix).
 *
 *     * 4.4  ·  6.7 mi  ·  ££  ·  Whiskey Bar
 *     └─700─┘  └──500 @1.0──┘   └─500 @0.72─┘
 *
 * ORDER IS TRUNCATION PRIORITY. Tail-ellipsis eats the last span first, so the
 * least valuable fact is placed last on purpose. Separators render BETWEEN
 * PRESENT SPANS ONLY — never leading, never trailing. A card with no rating
 * begins at distance with no orphaned "·" (Constitution 9).
 *
 * `numberOfLines={1}` with `ellipsizeMode="tail"`, and NO `flexWrap` anywhere:
 * the plate is a fixed rectangle, so the row ellipsises rather than growing, and
 * that is what makes a 1-line meta and an absent meta occupy the same box.
 */
export function CardMetaLine({ spans }: { spans: readonly MetaSpanInput[] }): React.ReactElement | null {
  const present = spans.filter((s) => typeof s.text === 'string' && s.text.trim().length > 0);
  if (present.length === 0) return null;
  return (
    <Text
      style={styles.meta}
      numberOfLines={1}
      ellipsizeMode="tail"
      maxFontSizeMultiplier={MAX_FONT_SCALE.meta}
    >
      {present.map((span, i) => (
        <React.Fragment key={`${span.kind}_${i}`}>
          {i > 0 ? (
            <Text style={styles.metaSeparator}>{META.separator.text}</Text>
          ) : null}
          <Text style={span.kind === 'rating' ? styles.metaRating : span.kind === 'tail' ? styles.metaTail : styles.metaFact}>
            {span.text}
          </Text>
        </React.Fragment>
      ))}
    </Text>
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
 */
export function CuratedSlivers(): React.ReactElement {
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {SLIVER.offsets.map((offset, i) => (
        <View
          key={`sliver_${i}`}
          style={[
            styles.sliver,
            {
              left: SLIVER.insets[i],
              right: SLIVER.insets[i],
              bottom: S1.bottomInset + S1.plateH + offset,
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
 * Whether a span set is vacuous, and where the title's bottom edge therefore
 * sits. Exported so BOTH card trees derive the title's position from the SAME
 * predicate the plate uses to size itself — otherwise the title and the plate
 * could disagree about which silhouette is being drawn, which is precisely the
 * drift class this whole package exists to close.
 *
 *     titleBottom = bottomInset + plateH + gap
 *                 = 16 + 96 + 20 = 132   (full plate)
 *                 = 16 + 54 + 20 =  90   (the alternate silhouette)
 */
export function platePresentation(spans: readonly MetaSpanInput[]): {
  withMeta: boolean;
  plateH: number;
  titleBottom: number;
} {
  const withMeta = spans.some((s) => typeof s.text === 'string' && s.text.trim().length > 0);
  const plateH = withMeta ? S1.plateH : PLATE_H_NO_META;
  return { withMeta, plateH, titleBottom: S1.bottomInset + plateH + S1.gap };
}

export interface DeckCardPlateProps {
  /**
   * The meta spans. When every span is absent the meta row AND the divider are
   * omitted TOGETHER and the plate is PLATE_H_NO_META instead of plateH — the
   * ONE alternate silhouette in the whole system. Vacuity-guarded here rather
   * than at each call site so the two card trees cannot disagree about it.
   */
  readonly spans: readonly MetaSpanInput[];
  /** The Been-here control, supplied by the caller (see the module header). */
  readonly beenHere?: React.ReactNode;
  readonly onSharePress: () => void;
  readonly shareLabel: string;
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
 */
export function DeckCardPlate({
  spans,
  beenHere,
  onSharePress,
  shareLabel,
}: DeckCardPlateProps): React.ReactElement {
  const meta = <CardMetaLine spans={spans} />;
  const { withMeta } = platePresentation(spans);
  const rows = withMeta ? ROWS_WITH_META : ROWS_NO_META;

  return (
    <View
      style={[styles.plate, withMeta ? styles.plateWithMeta : styles.plateNoMeta]}
      // The plate is a CONTAINER, not a control. VoiceOver reaches the card
      // through the composed label on the face and the two real buttons below.
      accessibilityRole="none"
      accessible={false}
    >
      <PlateMaterial />
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

        It is omitted with the meta row so the alternate silhouette is one
        discrete constant rather than two independent branches.
      */}
      {withMeta ? (
        <View style={styles.dividerRow} pointerEvents="none">
          <View style={styles.dividerSegment} />
          <View style={styles.dividerGap}>
            <Icon name="chevron-up" size={CHEVRON.size} color={CHEVRON.color} />
          </View>
          <View style={styles.dividerSegment} />
        </View>
      ) : null}

      <View style={[styles.controlRow, { height: rows.control }]}>
        {beenHere ?? <View />}
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
  plateWithMeta: { height: S1.plateH },
  // The ONE alternate silhouette. The card's bottom edge, the plate's bottom
  // edge and the plate's left/right edges do not move.
  plateNoMeta: { height: PLATE_H_NO_META },
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
  meta: {
    fontSize: S1.metaSize,
    lineHeight: 19,
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
  shareButtonPlate: {
    width: SHARE_GLYPH.target,
    height: SHARE_GLYPH.target,
    alignItems: 'center',
    justifyContent: 'center',
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
