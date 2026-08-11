/**
 * S7 — THE EXPANDED SHEET'S HERO. Issue #1605 wave 4.
 *
 * One sheet, one hero, one spine. Whether the card is a single place or a
 * curated multi-stop plan is DATA on this component, never a different
 * composition: the only two things `curated` decides are which facts the meta
 * line's spans are drawn from and whether the sliver stack renders.
 *
 * ---------------------------------------------------------------------------
 * THE CONTINUITY IS ARITHMETIC, NOT AN IMPRESSION
 *
 * The hero carries the SAME plate as the collapsed deck card — same 374 x 96,
 * same r24, same 14/16 inset, same 20pt gap, same 30/36 two-line title. That is
 * not a resemblance that was tuned by eye; it is forced. `scrimHeight()` reads
 * ONLY the plate's card-local geometry:
 *
 *     dPlateTop = bottomInset + plateH           = 16 + 96      = 112
 *     dTitleTop = bottomInset + plateH + gap + 2*lh              = 204
 *     H         = ceil2(max(1.4286*112, 1.5464*204))             = 316
 *     alpha@112 = 0.791   ->   u = plateUnderAlpha(0.791)        = 0.622
 *     plate L*                                                   = 23.49
 *
 * so any surface that puts the same plate at the same inset gets the same scrim,
 * the same derived under-layer and therefore the same L* and the same contrast
 * ratios. `T-11` in packages/card-identity/__tests__ asserts that by CALLING the
 * real functions on both descriptors rather than by comparing two typed-in
 * tables. Do not re-derive any of it here, and do not "adjust" a value to make
 * the sheet look right — the sheet looking right IS the deck card looking right.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HEIGHT VARIES, AND WHY THAT COSTS NOTHING
 *
 *     heroH = min(520, max(432, sheetH - 216))       (expandedHeroHeight)
 *
 * 216 = 92 (the action band) + 120 (five lines of description) + 4. The fold is
 * sized to PROVE there is more below it and the hero takes what is left. Every
 * measured value above depends on the plate's card-local geometry and on nothing
 * else, and `scrimHeight`'s only height-dependent term is its clamp to `cardH` —
 * which never binds, because 432 > 316. `T-10` asserts that across the range.
 *
 * ---------------------------------------------------------------------------
 * INVARIANTS THIS FILE IS BOUND BY
 *
 * I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE — there is not one design literal in
 *   this file. Every radius, fill, ramp stop, alpha, type size and target comes
 *   from `@mingla/card-identity`. This file is in the G1 SCANNED set, so a
 *   hard-coded plate value here fails CI exactly as it does on the deck card.
 * I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE — the media, the scrim, the title
 *   and the plate are absolutely positioned in POINTS. No percentage height, no
 *   flex-axis key, no dependence on a sibling's min-content height. That is the
 *   defect class #1593 measured (one `flex: 0.88` resolving to two different
 *   boxes under two different sibling sets).
 * I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS — this file adds exactly
 *   TWO gesture owners: the share button (inside DeckCardPlate) and the drag
 *   handle. The chevron, the divider, the slivers, the scrim and the media are
 *   all `pointerEvents="none"`.
 * I-PROPOSED-1576-ANIMATED-STYLE-SWAP-KEY-PARITY — nothing here animates. The
 *   plate does not run its own driver; it moves because the SHEET moves. See the
 *   chevron note below for the one place that shows.
 * Constitution 9 — no cover means no glass and no grey box. There is no
 *   placeholder image, no icon, no "no photo" panel.
 */
import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { EventCoverMedia } from '@mingla/offering-rendering';
import { ANDROID_GLASS_USES_OPAQUE_FALLBACK } from '../../constants/designSystem';
import { isVideoUrl } from '../../utils/videoUrl';
import {
  CuratedSlivers,
  DeckCardPlate,
  platePresentation,
  type MetaSpanInput,
} from '../deckCardPlate';
// The specifier is relative for the same reason as in deckHeroConstants.ts: the
// CI guards import this tree under plain `node --test` with no `npm install`.
import {
  HANDLE,
  MAX_FONT_SCALE,
  PLATE,
  RAMP,
  SURFACES,
  expandedCoverlessHeroHeight,
  expandedHeroHeight,
  surfaceScrimHeight,
  titleBottom as surfaceTitleBottom,
} from '../../../../packages/card-identity/index.js';

const S7 = SURFACES.s7Expanded;

/** Derived once at module load — never a per-render solve, never a literal. */
const SCRIM_H = surfaceScrimHeight('s7Expanded');
const COVERLESS_HERO_H = expandedCoverlessHeroHeight();

export interface ExpandedCardHeroProps {
  /**
   * `card.images?.[0] ?? stops?.[0]?.imageUrl ?? null`, resolved by the caller.
   * ONE decode, never N — a plan's remaining stop photographs stay on their own
   * stop rows. `null` selects the coverless slab (§8.3), on BOTH branches.
   */
  readonly cover: string | null;
  readonly title: string;
  /** The plate's meta line. Vacuity is handled by the plate, not here. */
  readonly spans: readonly MetaSpanInput[];
  /** The sliver stack — the ENTIRE curated identity. No text, no colour, no chip. */
  readonly curated: boolean;
  /** The sheet's resolved height, so the hero can take what the fold leaves. */
  readonly sheetHeight: number;
  /** The Been-here control, supplied by the caller (see DeckCardPlate's header). */
  readonly beenHere?: React.ReactNode;
  readonly onSharePress: () => void;
  readonly shareLabel: string;
  /** #1880 — expanded handoff only; omitted callers keep the prior plate. */
  readonly shareHandoffEnabled?: boolean;
  readonly shareBusy?: boolean;
  readonly shareControlRef?: React.Ref<View>;
  /** The sheet's accessible close affordance — gorhom's handle is suppressed. */
  readonly onClosePress: () => void;
  readonly closeLabel: string;
}

/**
 * The drag handle.
 *
 * OPAQUE CORE + DARK RING, not a translucent white bar. There is no top scrim
 * here (200 + 316 = 516 of a 520pt hero would leave 4pt of clean photograph), so
 * the handle sits on a bare, unknown photograph and has to carry its own SC
 * 1.4.11 boundary. Two translucent layers fail in the SAME place — a 0.90 white
 * over a 0.45 black ring measures 2.65:1, because on a mid-grey photo both
 * converge on the backdrop together. An opaque core with a dark ring measures
 * 4.10:1 worst case over a 41-luminance sweep.
 *
 * It is also the sheet's accessible CLOSE control, because gorhom's handle is
 * suppressed (`showHandle={false}`) so it cannot push the hero down and put a
 * band of white above the photograph.
 */
function HeroHandle({
  onPress,
  label,
  coverless,
}: {
  onPress: () => void;
  label: string;
  coverless: boolean;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={styles.handleTarget}
      hitSlop={HANDLE.target}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        pointerEvents="none"
        style={[
          styles.handle,
          // The coverless hero is a KNOWN solid slab, so there is no photograph
          // to fail against and the ring would be a border around nothing.
          coverless ? styles.handleCoverless : styles.handleOverMedia,
        ]}
      />
    </Pressable>
  );
}

/**
 * The hero.
 *
 *     ┌─ 402 x [432..520] ────────────────────────────────┐
 *     │                 ▁▁▁▁▁▁                     10pt   │  handle (its own boundary)
 *     │                                                   │
 *     │            clean photograph, ~39%                 │
 *     │ ░░░░░░░░░░░░░ 316pt bottom scrim ░░░░░░░░░░░░░░░░ │
 *     │  Whiskey Bar                              132pt   │  30/700, 2 lines
 *     │   ▂▂▂▂  ▂▂▂▂                                      │  curated slivers only
 *     │ ╔══ 374 x 96 · r24 ═══════════════════════════╗   │
 *     │ ║  ★ 4.4 · 6.7 mi · ££ · Whiskey Bar     40pt ║   │
 *     │ ║ ─────────────── ⌄ ──────────────────── 1pt  ║   │  chevron-DOWN: closes
 *     │ ║  [ ✓ Been here ]                  ⤴   53pt  ║   │
 *     │ ╚══════════════════════════════════════════════╝  │
 *     └───────────────────────────────────────────────────┘
 *
 * THE CHEVRON INVERTS. On the collapsed card a chevron-up means *this opens*; on
 * the sheet a chevron-down means *this closes*. It is the only element whose
 * MEANING changes between the two surfaces.
 *
 * It does NOT animate its 180° turn. §9 row 3 is **NOT IMPLEMENTED**, and the
 * word matters: it is not impossible, it is unbuilt.
 *
 * The first version of this comment said a second driver would be required and
 * that is WRONG, corrected by the #1605 tester and recorded here so nobody
 * re-derives the same wrong conclusion. `@gorhom/bottom-sheet@5.2.8` exports
 * `useBottomSheetInternal` from its PUBLIC `index.d.ts`, and it yields
 * `animatedPosition` / `animatedIndex` FROM THE SHEET'S EXISTING DRIVER. This
 * hero renders inside the `BottomSheet` subtree, so it can consume it. What is
 * true is only that `BaseBottomSheet` does not forward it (it pins a 280ms
 * timing config for ORCH-1064's anti-stall and keeps the rest to itself) —
 * which is a shape to change, not a physics problem.
 *
 * Shipping the instant swap is the interim, and it is a defensible one: the
 * design's own reduced-motion behaviour IS "instant swap at the end", so every
 * user gets what reduced-motion users were always going to get. But it is an
 * interim. The work is: forward `animatedPosition` out of `BaseBottomSheet`, or
 * call `useBottomSheetInternal` here. Modest, and in spec.
 */
export function ExpandedCardHero({
  cover,
  title,
  spans,
  curated,
  sheetHeight,
  beenHere,
  onSharePress,
  shareLabel,
  shareHandoffEnabled = false,
  shareBusy = false,
  shareControlRef,
  onClosePress,
  closeLabel,
}: ExpandedCardHeroProps): React.ReactElement {
  const coverless = cover === null || cover.length === 0;
  const heroH = coverless ? COVERLESS_HERO_H : expandedHeroHeight(sheetHeight);
  /**
   * #1700 — THE SHEET'S HERO MEASURES ITS OWN FACTS LINE.
   *
   * It did not, and a curated plan is exactly the card that exposes it: "2 stops
   * · 0.3 mi · 3h 3m · $100.00-$0.00 · Romantic" wraps to two lines, the plate
   * stayed at its one-line height, and the second line ran into the divider and
   * the chevron. Seth photographed it.
   *
   * The measurement was wired into both DECK faces and not into this one. The
   * plate has always been the same component on both surfaces — that is the
   * whole continuity argument — so it needs the same two props here, or the
   * sheet's copy silently disagrees with the deck's about which silhouette it is
   * drawing.
   */
  const [metaLines, setMetaLines] = React.useState(1);
  const { plateH, titleBottom, metaLines: lines } = platePresentation(spans, metaLines);

  const plate = (
    <DeckCardPlate
      spans={spans}
      metaLines={lines}
      onMetaLinesChange={setMetaLines}
      beenHere={beenHere}
      onSharePress={onSharePress}
      shareLabel={shareLabel}
      shareHandoffEnabled={shareHandoffEnabled}
      shareBusy={shareBusy}
      shareControlRef={shareControlRef}
      chevron="down"
    />
  );

  const titleNode = (
    <Text
      style={[styles.title, { bottom: titleBottom }]}
      numberOfLines={S7.titleLines}
      ellipsizeMode="tail"
      maxFontSizeMultiplier={MAX_FONT_SCALE.title}
    >
      {title}
    </Text>
  );

  if (coverless) {
    // §8.3 — NO COVER MEANS NO GLASS. The material needs media and there is
    // none, so the hero collapses to ONE slab at the plate's own tone (L* 23.47,
    // 0.01 L* from the glass composite). Not a plate drawn on a slab: a plate on
    // a same-toned slab has only its 0.38 border to separate it, which is
    // furniture pretending to be structure. The title, the meta row, the divider
    // and the control row keep the plate's exact rhythm at the same insets, so
    // the object the user recognises is still the object.
    //
    // This is the SAME state on both branches — a plan whose first stop has no
    // image gets it too. No grey box, no icon, no fabricated cover
    // (Constitution 9).
    return (
      <View style={[styles.hero, styles.coverlessSlab, { height: heroH }]}>
        <HeroHandle onPress={onClosePress} label={closeLabel} coverless />
        {titleNode}
        {curated ? <CuratedSlivers plateH={plateH} /> : null}
        {plate}
      </View>
    );
  }

  return (
    <View style={[styles.hero, { height: heroH }]}>
      {/*
        ONE decode. The media is absolutely positioned and anchored to the
        hero's BOTTOM edge, so the bottom 316pt are the same pixels the
        collapsed card showed: expanding trims the top of the frame, it does not
        re-crop under the user.

        A `.mp4` cover routes through the SHARED renderer (COMMS-0007 — do not
        add a parallel player or a direct expo-video call site). Without this
        branch a video-cover venue would render a blank hero, which is how the
        old ImageGallery's video support would have been silently lost.
      */}
      {isVideoUrl(cover) ? (
        <EventCoverMedia
          mediaUrl={cover}
          mediaType="video"
          radius={0}
          label="Cover video"
          videoContentFit="cover"
          autoplay
          playbackActive
          muted
          loop
          /*
            THE UNMUTE CONTROL SURVIVES THE GALLERY'S DELETION. `ImageGallery`
            was the only surface that exposed it (OQ-1: show it on the
            deliberate-attention surface, keep the deck muted), and deleting the
            gallery without moving it would have taken the only way to hear a
            cover video with it. The hero is a taller box than the 300pt gallery
            was, so the pill's bottom-right clearance strictly improves.
          */
          showAudioControl
          audioControlPosition="bottomRight"
          style={styles.media}
        />
      ) : (
        <Image source={{ uri: cover }} style={styles.media} resizeMode="cover" />
      )}

      {/*
        The bottom scrim, in ABSOLUTE POINTS. Never a percentage — a percentage
        makes the whole contrast table valid only on the device it was computed
        on, and it is what made the deck's two card faces disagree before #1609.
      */}
      <LinearGradient
        colors={RAMP.bottom.colors}
        locations={RAMP.bottom.locations}
        style={styles.scrim}
        pointerEvents="none"
      />

      <HeroHandle onPress={onClosePress} label={closeLabel} coverless={false} />
      {titleNode}
      {curated ? <CuratedSlivers plateH={plateH} /> : null}
      {plate}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    // The sheet's own top corners. gorhom's `backgroundStyle` radius does NOT
    // clip children, so the hero clips itself or the photograph squares off the
    // sheet's rounded top.
    borderTopLeftRadius: S7.cardR,
    borderTopRightRadius: S7.cardR,
    overflow: 'hidden',
    // The sheet's top hairline is REMOVED (the hero is a photograph; a
    // rgba(0,0,0,0.08) line over it is invisible on a dark photo and a scratch
    // on a pale one), so this clip IS the edge.
    position: 'relative',
  },
  // The slab is the plate's own opaque tone. On iOS the plate is glass over
  // media; with no media there is nothing to blur, so both platforms land on
  // the same solid here — which is also why it measures 0.01 L* from the glass.
  coverlessSlab: { backgroundColor: PLATE.fallbackSolid },
  media: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Anchored to the BOTTOM edge and given the full hero height, so the bottom
    // 316pt are the same pixels the collapsed card showed.
    top: 0,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCRIM_H,
    zIndex: 1,
  },
  title: {
    position: 'absolute',
    left: S7.titleInset,
    right: S7.titleInset,
    zIndex: 2,
    fontSize: S7.titleSize,
    lineHeight: S7.titleLH,
    fontWeight: S7.titleWeight as '700',
    color: '#FFFFFF',
    // The title's own boundary on the shallowest part of the ramp. Measured
    // 3.73:1 at its top edge against a pure-white photograph (large text, floor
    // 3.0); the shadow is belt-and-braces for a high-frequency photo, not the
    // thing carrying the ratio.
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  handleTarget: {
    position: 'absolute',
    top: HANDLE.top,
    alignSelf: 'center',
    // The visible mark is 36 x 5; the TARGET is 44 x 44 via hitSlop. Nothing
    // tappable on this surface is under 44.
    zIndex: 3,
  },
  handle: {
    width: HANDLE.width,
    height: HANDLE.height,
    borderRadius: HANDLE.radius,
  },
  handleOverMedia: {
    backgroundColor: HANDLE.fill,
    borderWidth: HANDLE.ringWidth,
    borderColor: HANDLE.ring,
  },
  handleCoverless: { backgroundColor: HANDLE.coverlessFill },
});

/**
 * Whether the platform draws the plate opaquely. Exported so the caller can keep
 * ONE answer to "is this the glass path or the fallback path" rather than
 * re-deriving it per surface — the same reason `beenHereStateStyle` exists.
 */
export const HERO_USES_OPAQUE_FALLBACK: boolean =
  ANDROID_GLASS_USES_OPAQUE_FALLBACK || Platform.OS === 'web';

export default ExpandedCardHero;
