import React from 'react';
import { View, Text, StyleSheet, Platform, AccessibilityInfo } from 'react-native';
// ORCH-1072: the experience card hero renders the brand's REAL cover (image OR
// video) via the SAME shared component the detail sheet + public event page use
// (expo-video, muted/autoplay per the event-card contract). One source of truth
// for cover rendering — never a parallel video player.
import { EventCoverMedia } from '@mingla/offering-rendering';
// ORCH-1042: curated stop photos render via expo-image (NOT react-native <Image>)
// so each stop gets a placeholder + fade transition + memory-disk cache +
// recyclingKey + an onError fallback (this path previously had NO fallback at all
// and would show a permanent dark `#2C2C2E` panel on a slow/failed stop image).
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from '../constants/designSystem';
// #1609 Direction C — the SAME plate the place card carries. Curated is not a
// different composition: it is this card plus two 4pt slivers. The shared module
// is a leaf, so importing it does NOT reopen the SwipeableCards <-> this-file
// require cycle (data flows down; the Been-here control is passed IN).
import {
  CuratedSlivers,
  DeckCardPlate,
  planPlatePresentation,
  platePresentation,
} from './deckCardPlate';
import { PHOTO_PAGER, STOP_STACK } from '../../../packages/card-identity/index.js';
import type { CuratedExperienceCard } from '../types/curatedExperience';
// `parseAndFormatDistance` moved with the rest of the span derivation into
// `expandedCard/expandedCardFacts` (#1605 P1-6).
/*
  #4347 wave 1 — the DECK's curated facts are `curatedFaceFacts` (N stops ·
  duration · travel · spend level, and a host experience's "From" pill). The
  same binding renders the behind face in SwipeableCards, so promotion never
  changes the line. The sheet keeps `curatedPlanSpans` until waves 2-3.
*/
import { curatedFaceFacts, curatedPlanPlate } from './deckCard/curatedFace';
import { pagerPresentation, stopStackPhotos, type DeckPhoto } from './deckCard/deckCardModel';

const NO_FAILURES: ReadonlySet<string> = new Set();
import {
  DeckTextColumn,
  NoPhotoFill,
  PhotoCapsule,
  PhotoPagerBars,
  photoBarsTop,
  photoLabelTop,
} from './deckCard/DeckCardChrome';
import {
  DECK_BOTTOM_SCRIM_HEIGHT_PT,
  DECK_HERO_PLACEHOLDER_BLURHASH,
  DECK_SCRIM_COLORS,
  DECK_SCRIM_LOCATIONS,
  DECK_TOP_SCRIM_COLORS,
  DECK_TOP_SCRIM_HEIGHT_PT,
  DECK_TOP_SCRIM_LOCATIONS,
} from './deckHeroConstants';
import { DECK_VISIBLE_POSTER_CACHE_POLICY } from './swipeDeck/deckHeroPolicy';

// ORCH-1042: fade-in within the spec's 180–300 ms band (mirrors SwipeableCards).
/**
 * #4347 wave 1 — one page of the curated / experience photo pager.
 *
 * Changing `uri` on the same mounted ExpoImage is the flip: expo-image
 * cross-fades over `transitionMs` (180ms; 0 under Reduce Motion). A load
 * failure is REPORTED so the pager skips to the next photo; the old stock
 * fallback photo is deleted (a picture of somewhere else is fabricated data).
 */
function CuratedStopImage({
  uri,
  transitionMs,
  onLoadFailed,
}: {
  uri: string;
  transitionMs: number;
  onLoadFailed?: (uri: string) => void;
}) {
  return (
    <ExpoImage
      source={{ uri }}
      style={styles.heroImage}
      contentFit="cover"
      cachePolicy={DECK_VISIBLE_POSTER_CACHE_POLICY}
      transition={transitionMs}
      placeholder={{ blurhash: DECK_HERO_PLACEHOLDER_BLURHASH }}
      placeholderContentFit="cover"
      onError={() => onLoadFailed?.(uri)}
    />
  );
}

const g = glass.badge;

// Deterministic hue 0–359 from the brand name (stable monogram color across
// sessions). Same hash family as hueFromId.
function hueFromBrandName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

// Monogram fill per DESIGN §5.1: hsl(h, 58%, L) where L is band-clamped to 35%
// in the yellow-green danger band [45,75] (else 42%) so white text clears AA on
// every hue.
function monogramFill(hue: number): string {
  const lightness = hue >= 45 && hue <= 75 ? 35 : 42;
  return `hsl(${hue}, 58%, ${lightness}%)`;
}

interface BrandChipProps {
  brandName: string;
  brandLogoUrl: string | null;
  top: number;
  // ORCH-1155: when the chip is wrapped in a pressable that owns the absolute
  // positioning, the chip itself renders in normal flow (no self-position) and
  // ignores touches (the wrapper is the button). Default false → byte-identical
  // to the ORCH-1065 self-positioned badge for curated/non-pressable callers.
  wrapped?: boolean;
}

// Top-left glass lockup: [logo/monogram disc] + [brand name]. Copies the
// glass.badge five-layer vocabulary (DESIGN §2.2) so it reads as the same family
// as the metadata chips; degrades to the opaque solid fill on Android pre-blur /
// Reduce Transparency (ANDROID_GLASS_USES_OPAQUE_FALLBACK policy, DESIGN §2.6).
function BrandChip({ brandName, brandLogoUrl, top, wrapped = false }: BrandChipProps): React.ReactElement {
  const { t } = useTranslation(['cards']);
  const [reduceTransparency, setReduceTransparency] = React.useState(false);
  const [logoFailed, setLogoFailed] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rt = await AccessibilityInfo.isReduceTransparencyEnabled();
        if (mounted) setReduceTransparency(rt);
      } catch {
        if (mounted) setReduceTransparency(true);
      }
    })();
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (enabled: boolean) => setReduceTransparency(enabled),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const useGlass = !reduceTransparency && !ANDROID_GLASS_USES_OPAQUE_FALLBACK;
  const showMonogram = !brandLogoUrl || logoFailed;
  const trimmedName = (brandName ?? '').trim();
  const initial = trimmedName.length > 0 ? trimmedName.charAt(0).toUpperCase() : '';
  const hue = hueFromBrandName(trimmedName);

  return (
    <View
      style={
        wrapped
          ? styles.brandChipFlow
          : [styles.brandChip, { top }]
      }
      pointerEvents={wrapped ? 'none' : 'auto'}
      accessibilityRole={wrapped ? undefined : 'image'}
      accessibilityElementsHidden={wrapped}
      importantForAccessibility={wrapped ? 'no-hide-descendants' : 'auto'}
      accessibilityLabel={wrapped ? undefined : t('cards:deck.experience_by', { name: trimmedName })}
    >
      {/* L1 — blur or opaque solid fallback */}
      {useGlass ? (
        <BlurView
          intensity={g.blur.intensity}
          tint={g.blur.tint}
          pointerEvents="none"
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: g.fallback.solid }]}
        />
      )}
      {/* L2 — tint floor (glass path only) */}
      {useGlass ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: g.tint.floor }]} />
      ) : null}
      {/* L3 — top highlight */}
      <View pointerEvents="none" style={styles.brandChipTopHighlight} />

      {/* Disc: logo OR monogram */}
      {showMonogram || initial.length === 0 ? (
        initial.length > 0 ? (
          <View style={[styles.brandDisc, { backgroundColor: monogramFill(hue) }]}>
            <Text style={styles.brandMonogram}>{initial}</Text>
          </View>
        ) : null
      ) : (
        <View style={styles.brandDisc}>
          <ExpoImage
            source={{ uri: brandLogoUrl as string }}
            style={styles.brandLogo}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={brandLogoUrl as string}
            transition={180}
            placeholder={{ blurhash: DECK_HERO_PLACEHOLDER_BLURHASH }}
            onError={() => setLogoFailed(true)}
          />
        </View>
      )}

      <Text style={styles.brandName} numberOfLines={1} ellipsizeMode="tail" allowFontScaling>
        {trimmedName}
      </Text>
    </View>
  );
}
// ─── end ORCH-1065 brand badge ────────────────────────────────────────────────

// #1609 Direction C — `getTravelModeIcon` is DELETED. Travel time leaves the
// collapsed card (D-2), so nothing needs a mode icon here any more.

// #1609 — the ratios are DELETED here for the same reason as in SwipeableCards: a
// flex-axis key resolves differently under different sibling sets, which is #1593.
// The hero is a full-bleed absolute fill and the tray is gone.
//

interface Props {
  card: CuratedExperienceCard;
  currencyCode?: string;
  // ORCH-1065: present ONLY for brand experiences. Curated callers omit both →
  // byte-identical render (SC-13).
  brandExperience?: { brandName: string; brandLogoUrl: string | null };
  // ORCH-1155 [public-brand-page]: when present, the brand badge becomes a button
  // that opens the brand page (/b/{slug}). Sibling of brandExperience so curated
  // callers (which pass neither) render byte-identically (SC-12). No dead taps.
  onBrandPress?: () => void;
  // ORCH-1072: the experience's REAL cover (separate prop so the ORCH-1065
  // brandExperience contract stays byte-identical). When present, the card hero
  // shows the cover (image/video) with the stop photos as a strip below — not
  // the stop strip AS the hero. Curated callers omit it → unchanged stop-strip.
  experienceCover?: {
    coverMediaUrl: string | null;
    coverMediaType: 'image' | 'video' | 'gif' | null;
    coverHue?: number;
  };
  // #1609 Direction C — the plate's control row. The Been-here control is passed
  // IN as an element rather than imported, so this file never imports
  // SwipeableCards (which imports it back — that closes the require cycle).
  // Absent on the behind/preview face, which is pointerEvents="none" and where a
  // control would be a lie about affordance (Rule L1).
  beenHere?: React.ReactNode;
  onSharePress?: () => void;
  shareLabel?: string;
  /**
   * #1701 — the Details control. Supplied by the caller because the caller owns
   * the deck's one expand path (`requestTapExpand`); this card must not grow a
   * second. Absent -> the control does not render, which is correct on any
   * surface that has no expand path at all.
   */
  onDetailsPress?: () => void;
  detailsLabel?: string;
  // ORCH-1209: only the front/active deck card streams its cover video. When
  // false the cover mounts paused on its poster (playbackActive=false) and
  // downloads nothing. Defaults true so non-deck callers (none today) are
  // unaffected. Mirrors SwipeableCards CardHero isTopCard (I-1069).
  isTopCard?: boolean;
  /**
   * #4347 wave 1 — the photo pager, OWNED BY THE CALLER (SwipeableCards owns
   * the one tap path that flips it). `photos` is `curatedDeckPhotos` /
   * `experienceDeckPhotos`; `photoIndex` the page showing. Absent -> page 0 of
   * the card's own stops (the behaviour of every non-deck caller).
   */
  photos?: readonly DeckPhoto[];
  photoIndex?: number;
  onPhotoFailed?: (uri: string) => void;
  /** Photo uris already known to fail; the face never renders them. */
  failedPhotos?: ReadonlySet<string>;
  /** 0 under Reduce Motion, else PHOTO_PAGER.crossfadeMs. */
  photoTransitionMs?: number;
  /** The kicker above the title (one owner: deckKickerFor). */
  kicker?: string | null;
  /** The ONE smart chip, already worded by the caller. */
  smartChip?: { text: string; tone: 'warn' | 'info' } | null;
  /** The one-time "Tap the sides…" hint text, when it should show. */
  photoHint?: string | null;
  /** "Stop 2 · Café Neo" for the page showing (curated only). */
  stopLabel?: string | null;
}

/** The behind face is `pointerEvents="none"`; its plate can never be pressed. */
const NOOP = (): void => {};


/*
  `formatDuration` moved to `expandedCard/expandedCardFacts.formatPlanDuration`
  with the rest of the span derivation (#1605 P1-6). Two copies of a formatter
  either side of a producer split is how the split stays invisible.
*/

export function CuratedExperienceSwipeCard({
  card,
  currencyCode,
  brandExperience,
  onBrandPress,
  experienceCover,
  isTopCard = true,
  beenHere,
  onSharePress,
  shareLabel,
  onDetailsPress,
  detailsLabel,
  photos,
  photoIndex = 0,
  onPhotoFailed,
  failedPhotos,
  photoTransitionMs = PHOTO_PAGER.crossfadeMs,
  kicker = null,
  smartChip = null,
  photoHint = null,
  stopLabel = null,
}: Props) {
  const { t } = useTranslation(['common', 'cards']);
  const insets = useSafeAreaInsets();
  const brandChipTop = photoLabelTop(insets.top);

  const isBrandExperience = brandExperience != null;

  /**
   * #4347 wave 1 — the deck's curated fact line ("3 stops · 3h 30m · 8 min
   * away · Moderate") and, for a host experience, the plate's "From ≈ $74"
   * pill. One binding (`curatedFaceFacts`) for this face and the behind face.
   */
  const { spans: curatedSpans, fromPriceLabel } = curatedFaceFacts(card, {
    t,
    currencyCode,
    isBrandExperience,
  });

  /**
   * #1700 — the measured facts-line count, local because this component owns
   * its own title anchor: the number that sizes the plate and the number that
   * positions the column above it must be the same one.
   */
  const [metaLines, setMetaLines] = React.useState(1);
  /*
    #4347 round 2 (Direction B) — an AI plan gets the PLAN plate: route + stop
    photos, Time / Away / Spend tiles, a wide Details. No slivers, no stop stack
    above the title (the route lives on the plate now). A host experience keeps
    the place-style plate and its "From ≈ $74" pill.
  */
  const planPlate = isBrandExperience
    ? null
    : curatedPlanPlate(card, { t, currencyCode, photos: stopStackPhotos(card.stops, STOP_STACK.max) });
  const presentation = planPlate ? { ...planPlatePresentation(), metaLines: 1 } : platePresentation(curatedSpans, metaLines);

  // The pager's pages, decided by the caller (SwipeableCards owns the tap path).
  const pages = photos ?? [];
  const pager = pagerPresentation(pages, photoIndex, failedPhotos ?? NO_FAILURES);
  const hasPhoto = pager.hasPhoto;
  const showingUri = pager.playVideoUri ?? pager.posterUri;
  const coverUrl = experienceCover?.coverMediaUrl ?? null;
  // The experience's own cover (image or video) renders through the shared
  // EventCoverMedia; every other page is a stop photo.
  const showCover = isBrandExperience && hasPhoto && coverUrl !== null && showingUri === coverUrl;

  // #4347 round 2 — the AI plan's route moved onto its plate; nothing stacks above the title.
  const stack = null;

  return (
    <View style={styles.card}>
      <View style={styles.heroFill}>
        {showCover ? (
          <EventCoverMedia
            hue={experienceCover?.coverHue}
            mediaUrl={coverUrl}
            mediaType={experienceCover?.coverMediaType ?? null}
            autoplay={isTopCard}
            playbackActive={isTopCard}
            muted
            loop
            radius={0}
            height="100%"
            width="100%"
            label={card.title}
          />
        ) : hasPhoto && pager.posterUri ? (
          <CuratedStopImage uri={pager.posterUri} transitionMs={photoTransitionMs} onLoadFailed={onPhotoFailed} />
        ) : (
          <NoPhotoFill />
        )}

        {/* ORCH-1065 / ORCH-1155: the host chip of a brand experience, top-left.
            A button to the brand page when the caller supplies the handler. */}
        {brandExperience ? (
          onBrandPress ? (
            <TrackedTouchableOpacity
              activeOpacity={0.8}
              onPress={onBrandPress}
              accessibilityRole="button"
              accessibilityLabel={t('cards:deck.view_brand', { name: brandExperience.brandName })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.brandChipPressable, { top: brandChipTop }]}
            >
              <BrandChip
                brandName={brandExperience.brandName}
                brandLogoUrl={brandExperience.brandLogoUrl}
                top={brandChipTop}
                wrapped
              />
            </TrackedTouchableOpacity>
          ) : (
            <BrandChip
              brandName={brandExperience.brandName}
              brandLogoUrl={brandExperience.brandLogoUrl}
              top={brandChipTop}
            />
          )
        ) : null}

        {/* #1609 Direction C — the scrims, IDENTICAL to the place card: same ramp
            and the same absolute point heights. A no-photo card has none: its
            type is dark on the neutral fill. */}
        {hasPhoto ? (
          <>
            <LinearGradient
              colors={DECK_SCRIM_COLORS}
              locations={DECK_SCRIM_LOCATIONS}
              pointerEvents="none"
              style={styles.heroScrim}
            />
            <LinearGradient
              colors={DECK_TOP_SCRIM_COLORS}
              locations={DECK_TOP_SCRIM_LOCATIONS}
              pointerEvents="none"
              style={styles.topScrim}
            />
          </>
        ) : null}

        {/* #4347 wave 1 — the pager chrome: segment bars, "Stop 2 · Café Neo",
            and the one-time tap hint. All pointerEvents="none". */}
        <PhotoPagerBars count={hasPhoto ? pages.length : 0} index={pager.photoIndex} top={photoBarsTop(insets.top)} />
        {isBrandExperience ? null : <PhotoCapsule text={stopLabel} top={photoLabelTop(insets.top)} testID="deck-stop-label" />}
        <PhotoCapsule text={photoHint} top={photoLabelTop(insets.top) + PHOTO_PAGER.label.lineHeight * 2 + 4} align="center" testID="deck-photo-hint" />

        <View style={styles.faceOverlay} pointerEvents="box-none">
          <DeckTextColumn
            title={card.title}
            kicker={kicker}
            bottom={presentation.titleBottom}
            dark={!hasPhoto}
            smartChip={smartChip}
            stack={stack}
          />

          {/*
            #1609 Direction C — THE CURATED MARK IS THE SILHOUETTE: two 4pt slivers
            peeking above the plate. No text, no colour, no gesture owner.
          */}
          {planPlate ? null : <CuratedSlivers plateH={presentation.plateH} />}

          <DeckCardPlate
            spans={curatedSpans}
            plan={planPlate}
            metaLines={presentation.metaLines}
            onMetaLinesChange={setMetaLines}
            onDetailsPress={onDetailsPress}
            detailsLabel={detailsLabel}
            beenHere={beenHere}
            onSharePress={onSharePress ?? NOOP}
            shareLabel={shareLabel ?? card.title}
            fromPriceLabel={fromPriceLabel}
            opaque={!hasPhoto}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // #1609 Direction C — the SHARED SHELL. `borderRadius: 20` and
  // `backgroundColor: '#1C1C1E'` are DELETED: this card renders INSIDE
  // SwipeableCards' `cardInner`, which already clips at
  // glass.card.bezelRadius (40) with overflow:'hidden'. A second, smaller
  // radius on the inner box meant the curated card drew a 20pt corner inside a
  // 40pt one — two silhouettes for one object — and the opaque #1C1C1E slab
  // behind a full-bleed hero was a panel that could only ever be seen when
  // something else had already failed.
  card: {
    flex: 1,
  },
  // #1609 — full-bleed hero. Same absoluteFillObject as the place card's heroFill:
  // no flex-axis key, so it cannot disagree with the poster layer (#1593).
  heroFill: {
    ...StyleSheet.absoluteFillObject,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  // #1609 Direction C — IDENTICAL to the place card's heroScrim: same ramp, same
  // absolute point height from the package. The 62%-vs-52% branch is deleted.
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: DECK_BOTTOM_SCRIM_HEIGHT_PT,
    zIndex: 1,
  },
  // #1609 amendment 4 — mirror of SwipeableCards.styles.topScrim, absolute points,
  // no flex-axis key, no percentage.
  topScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: DECK_TOP_SCRIM_HEIGHT_PT,
    zIndex: 1,
  },
  // #1609 Direction C — an absolute FILL whose two children (the name and the
  // plate) are each bottom-anchored in absolute points. Identical to the place
  // card's faceOverlay, because curated is the same composition.
  faceOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  // #4347 wave 1 — `cardTitle` is DELETED: the title, the kicker, the smart chip
  // and the stop stack are one bottom-anchored column (DeckTextColumn), placed at
  // `platePresentation(...).titleBottom` per render, never by a stylesheet value.
  // #1609 Direction C — DELETED: `titleOverlay` (flow layout replaced by absolute
  // anchoring), `oneLiner` (the tagline; it flattens the register and survives in
  // expanded), `ribbon` / `ribbonNode` / `ribbonDot` / `ribbonConnector` /
  // `ribbonLabel` / `ribbonOverflow` (D-5 — the stop names move to the expanded
  // card's accordion), `detailsBadges` (the second and last `flexWrap` container
  // on a card face), and `actionRail` / `railHint` / `railHintText` (the rail moves
  // onto the plate and its text is replaced by the divider's chevron).
  // ─── ORCH-1065 brand badge + Book CTA (DESIGN §2, §3, §7) ───────────────────
  brandChip: {
    position: 'absolute',
    left: 8,           // space.sm
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,            // space.sm — disc→name
    paddingLeft: 4,    // space.xs
    paddingRight: 12,  // space.md
    paddingVertical: 4, // space.xs
    maxWidth: '60%',
    borderRadius: 9999, // radius.full
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: glass.badge.border.hairline,
    shadowColor: glass.badge.shadow.color,
    shadowOffset: glass.badge.shadow.offset,
    shadowOpacity: glass.badge.shadow.opacity,
    shadowRadius: glass.badge.shadow.radius,
    elevation: glass.badge.shadow.elevation,
  },
  brandChipTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: glass.badge.border.topHighlight,
  },
  // ORCH-1155: the pressable wrapper owns the absolute positioning the badge had,
  // so the inner BrandChip (rendered with `wrapped`) lays out in normal flow and
  // the tap target is the chip box. `top` is supplied inline (photoLabelTop).
  brandChipPressable: {
    position: 'absolute',
    left: 8,
    zIndex: 3,
    maxWidth: '60%',
  },
  // ORCH-1155: the chip's visual styling minus its own absolute positioning
  // (the wrapper positions it). Mirrors `brandChip` sans position/left/top/zIndex.
  brandChipFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
    borderRadius: 9999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: glass.badge.border.hairline,
    shadowColor: glass.badge.shadow.color,
    shadowOffset: glass.badge.shadow.offset,
    shadowOpacity: glass.badge.shadow.opacity,
    shadowRadius: glass.badge.shadow.radius,
    elevation: glass.badge.shadow.elevation,
  },
  brandDisc: {
    width: 28,
    height: 28,
    borderRadius: 9999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  brandLogo: {
    width: '100%',
    height: '100%',
  },
  brandMonogram: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 28,
  },
  brandName: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    lineHeight: 18,
    color: '#FFFFFF',
  },
});
