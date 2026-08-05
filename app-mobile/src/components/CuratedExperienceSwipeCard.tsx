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
  platePresentation,
  type MetaSpanInput,
} from './deckCardPlate';
import { MAX_FONT_SCALE, SURFACES } from '../../../packages/card-identity/index.js';
import type { CuratedExperienceCard } from '../types/curatedExperience';
import { parseAndFormatDistance, formatCurrency } from './utils/formatters';
// ORCH-1042: reuse the SAME hard-failure fallback URL + placeholder blurhash as the
// single-place deck hero (one source of truth — do not duplicate the literals).
// ORCH-1065 BUG-3: import from the leaf ./deckHeroConstants module, NOT from
// ./SwipeableCards — SwipeableCards imports THIS file (it renders the card), so
// importing back from it closed a require cycle. The leaf module has no such edge.
import {
  CARD_FALLBACK_IMAGE,
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
const CURATED_STOP_TRANSITION_MS = 220;

/**
 * Curated multi-stop hero image with placeholder + fade + onError fallback.
 *
 * ORCH-1042: a curated stop whose `imageUrl` is slow or hard-fails used to show a
 * permanent dark `#2C2C2E` panel (no placeholder, no onError). Now it renders via
 * expo-image with the same prop contract as the single-place CardHeroImage and
 * swaps to CARD_FALLBACK_IMAGE on a hard failure.
 */
function CuratedStopImage({ uri }: { uri: string }) {
  const [src, setSrc] = React.useState(uri);
  React.useEffect(() => {
    setSrc(uri);
  }, [uri]);
  return (
    <ExpoImage
      source={{ uri: src }}
      style={styles.heroImage}
      contentFit="cover"
      cachePolicy={DECK_VISIBLE_POSTER_CACHE_POLICY}
      recyclingKey={src}
      transition={CURATED_STOP_TRANSITION_MS}
      placeholder={{ blurhash: DECK_HERO_PLACEHOLDER_BLURHASH }}
      placeholderContentFit="cover"
      onError={() => {
        if (src !== CARD_FALLBACK_IMAGE) setSrc(CARD_FALLBACK_IMAGE);
      }}
    />
  );
}

// #1609 Direction C — `CURATED_ICON_MAP` is DELETED with the category chip it fed.
// The curated identity is the sliver stack, not an icon: a silhouette reads at
// every size and is colour-blind-safe, where an icon needs a chip to sit in.

// ─── ORCH-1065 [consumer-experience-deck-card]: brand badge + Book CTA ─────────
// Built to DESIGN_ORCH-1065_BRAND_EXPERIENCE_DECK_CARD.md. Both elements are
// gated behind the `brandExperience` / `ctaOverride` props being present, so
// curated callers (which pass neither) render byte-identically (SC-13).

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
      accessibilityLabel={wrapped ? undefined : `Experience by ${trimmedName}`}
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
  travelMode?: string;
  measurementSystem?: 'Metric' | 'Imperial';
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
  ctaOverride?: string;
  // #1609 Direction C — the plate's control row. The Been-here control is passed
  // IN as an element rather than imported, so this file never imports
  // SwipeableCards (which imports it back — that closes the require cycle).
  // Absent on the behind/preview face, which is pointerEvents="none" and where a
  // control would be a lie about affordance (Rule L1).
  beenHere?: React.ReactNode;
  onSharePress?: () => void;
  shareLabel?: string;
  // ORCH-1209: only the front/active deck card streams its cover video. When
  // false the cover mounts paused on its poster (playbackActive=false) and
  // downloads nothing. Defaults true so non-deck callers (none today) are
  // unaffected. Mirrors SwipeableCards CardHero isTopCard (I-1069).
  isTopCard?: boolean;
}

/** The behind face is `pointerEvents="none"`; its plate can never be pressed. */
const NOOP = (): void => {};

const S1 = SURFACES.s1Single;

/** "2h 15m" / "45m" — never "0m", which would be a fabricated duration. */
function formatDuration(totalMinutes: number | null | undefined): string | null {
  if (typeof totalMinutes !== 'number' || !Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  const mins = Math.round(totalMinutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function CuratedExperienceSwipeCard({ card, travelMode, measurementSystem, currencyCode, brandExperience, onBrandPress, experienceCover, ctaOverride, isTopCard = true, beenHere, onSharePress, shareLabel }: Props) {
  const { t } = useTranslation(['common']);
  const insets = useSafeAreaInsets();
  // ORCH-0991: deck is full-bleed under the floating glass top bar. Keeps the brand
  // chip below the chrome so it is not clipped behind the status bar / Dynamic Island.
  // #1609: the per-stop number badges that also used this are gone with the strip.
  const stopBadgeTop = insets.top + 62;

  // Compact card shows only main (non-optional) stops
  const mainStops = card.stops.filter(s => !s.optional);
  const visibleStops = mainStops.length > 0 ? mainStops : card.stops;

  // #1609 — the single hero for the non-cover path: the first stop that actually has a
  // photo. Null when no stop has one, in which case the placeholder canvas shows and
  // nothing is fabricated (Constitution rule 9).
  const heroImageUrl = visibleStops.find(s => typeof s.imageUrl === 'string' && s.imageUrl.length > 0)?.imageUrl ?? null;

  // #1609 Direction C — the stop RIBBON is deleted with the chips. The stop names
  // leave the collapsed card, and this is the design's single most arguable cut:
  // the 300ms question is "is this a plan, how long, how much", which the count,
  // duration and price answer; WHICH three bars is deliberation, one tap away in
  // the expanded card's stops accordion, where they appear in full with images.
  // The ribbon also cost a wrapping row — a variable-height element on a card whose
  // whole strength is a fixed silhouette (D-5).

  // ORCH-1065: this card is a brand experience when the brand-attribution prop is
  // present (curated callers omit it → byte-identical render, SC-13).
  const isBrandExperience = brandExperience != null;

  // #1609 Direction C — `avgRating` is DELETED. A mean of the stops' Google ratings
  // is not a rating OF THE PLAN, and the plan's characterising fact is its stop
  // COUNT, which now takes the meta line's leading 700 slot.

  // ORCH-0629: Cumulative price — sum from the displayed stops directly.
  // Do NOT trust `card.totalPriceMin/Max` (card-level totals can be stale or left at 0
  // by the generator). Local sum is the truth the user sees on the card.
  //
  // ORCH-1065 BUG-1: that "distrust the envelope total" rule is correct for CURATED
  // cards (whose per-stop prices ARE the source of truth), but WRONG for a brand
  // experience: an experience carries its all-in price as the envelope
  // total (`total_price_cents` → totalPriceMin/Max from discover-cards), and its
  // stops carry NO per-stop price (price_cents=0 each). Summing those stops yields
  // 0 → "Free" for a genuinely priced experience. So for an experience we read the
  // envelope total directly (the same currency-aware formatCurrency helper, no
  // fabrication — a 0 envelope total still shows "Free" honestly).
  const effectiveCurrency = currencyCode || 'USD';
  const experienceTotalMin = typeof card.totalPriceMin === 'number' ? card.totalPriceMin : 0;
  const experienceTotalMax = typeof card.totalPriceMax === 'number' ? card.totalPriceMax : 0;
  const cumulativePriceMin = isBrandExperience
    ? experienceTotalMin
    : visibleStops.reduce((sum, stop) => sum + (stop.priceMin || 0), 0);
  const cumulativePriceMax = isBrandExperience
    ? experienceTotalMax
    : visibleStops.reduce((sum, stop) => sum + (stop.priceMax || 0), 0);
  const priceLabel = (() => {
    if (cumulativePriceMin === 0 && cumulativePriceMax === 0) return 'Free';
    if (cumulativePriceMin === cumulativePriceMax) return formatCurrency(cumulativePriceMin, effectiveCurrency);
    // U+2013 en-dash (not hyphen) — typographic convention for ranges.
    return `${formatCurrency(cumulativePriceMin, effectiveCurrency)}–${formatCurrency(cumulativePriceMax, effectiveCurrency)}`;
  })();

  const isSingleStop = visibleStops.length === 1;
  const rawIntentKey = (card.experienceType || 'adventurous').replace(/-/g, '_');
  const categoryLabel = t(`common:intent_${rawIntentKey}`);
  // #1609 — isBookCta / handleCtaPressIn / ctaText are DELETED with the tray CTA
  // they served. That CTA called onSeePlan -> handleCardExpand DIRECTLY, bypassing
  // requestTapExpand and therefore the deck's gesture lease entirely. With it gone,
  // EVERY expand entry point on this card — tap, swipe-up and the VoiceOver expand
  // action — routes through requestTapExpand. That is a real hole closed
  // (I-PROPOSED-1579 corollary), not a side effect: the same sheet is one tap away
  // on the card itself, and the commerce "Book" action lives on it.

  // First stop distance (most relevant to the user). Travel time is NOT rendered —
  // D-2: "14 min" beside "6.7 mi" is the same fact twice.
  const firstStop = visibleStops[0];
  const distanceKm = firstStop?.distanceFromUserKm;
  const formattedDistance = distanceKm != null && distanceKm > 0
    ? parseAndFormatDistance(`${distanceKm.toFixed(1)} km`, measurementSystem)
    : null;

  /**
   * #1609 Direction C §3.4 — the curated meta line:
   *
   *     3 stops  ·  2h 15m  ·  £28–£54  ·  Adventurous
   *     └─700──┘  └──── 500 @1.0 ────┘   └─500 @0.72─┘
   *
   * The stop COUNT takes the 700 slot the rating takes on a place card, because
   * it is the fact that characterises a plan. Every span is omitted when its value
   * is absent and CardMetaLine renders separators between PRESENT SPANS ONLY, so a
   * plan with no price begins at duration with no orphaned "·" (Constitution 9).
   * A single-stop plan falls back to distance, which is the only positional fact
   * it has.
   */
  const formattedDuration = formatDuration(card.estimatedDurationMinutes);
  const curatedSpans: MetaSpanInput[] = [];
  if (!isSingleStop) {
    curatedSpans.push({ kind: 'rating', text: `${visibleStops.length} stops` });
  } else if (formattedDistance) {
    curatedSpans.push({ kind: 'rating', text: formattedDistance });
  }
  if (!isSingleStop && formattedDistance) curatedSpans.push({ kind: 'fact', text: formattedDistance });
  if (formattedDuration) curatedSpans.push({ kind: 'fact', text: formattedDuration });
  if (priceLabel) curatedSpans.push({ kind: 'fact', text: priceLabel });
  if (categoryLabel) curatedSpans.push({ kind: 'tail', text: categoryLabel });

  /**
   * #1609 tester P1-1 — THE SILHOUETTE IS DECIDED ONCE, HERE, AND EVERYTHING ON
   * THE FACE READS IT.
   *
   * `platePresentation()` is the SAME predicate `DeckCardPlate` uses to size
   * itself. This file imported it and never called it, and instead baked
   * `S1.bottomInset + S1.plateH + S1.gap` into a module-load `StyleSheet.create`
   * entry, so when the span set was vacuous the plate shrank and the name
   * and the sliver stack stayed where a 96pt plate had been. §3.6 promises
   * "exactly ONE alternate silhouette in the whole system"; that produced four.
   *
   * A module-load stylesheet cannot express a per-render value. So the anchor
   * leaves the stylesheet: `cardTitle` no longer carries `bottom` at all, and the
   * offset is applied at the render site from this one object.
   */
  const presentation = platePresentation(curatedSpans);

  // ORCH-1072: an experience with a real cover renders the COVER as the hero
  // (image/video via the shared EventCoverMedia) with the stop photos as a
  // smaller strip BELOW it. Curated cards (no cover prop) keep the full-bleed
  // stop strip hero unchanged (SC-13). The experience cover-fallback (no cover
  // url) also keeps the stop-strip hero so a cover-less experience still renders.
  const coverUrl = experienceCover?.coverMediaUrl ?? null;
  const coverType = experienceCover?.coverMediaType ?? null;
  const showCoverHero =
    isBrandExperience && typeof coverUrl === 'string' && coverUrl.length > 0;

  return (
    <View style={styles.card}>
      {/* #1609 — full-bleed hero, ONE image.
          The old `imageStrip` mounted one ExpoImage PER STOP as an absolute-fill row,
          so a 4-stop card was 4 decodes and two mounted cards were 8, against a
          performance bound of two raster posters. It also degraded badly at N>=4
          (100pt-wide crops of interiors are unreadable) and pinned its stop-number
          badges to the TOP of the card rather than over the slices they labelled.
          Curated now joins the same single-poster budget as a place card, and the
          stops are named in the ribbon below instead — strictly more informative than
          four unreadable crops. */}
      <View style={styles.heroFill}>
        {showCoverHero ? (
          <EventCoverMedia
            hue={experienceCover?.coverHue}
            mediaUrl={coverUrl}
            mediaType={coverType}
            // ORCH-1209 — only the front card streams (parity with the
            // venue deck CardHero, I-1069). Off-front: paused on poster.
            autoplay={isTopCard}
            playbackActive={isTopCard}
            muted
            loop
            radius={0}
            height="100%"
            width="100%"
            label={card.title}
          />
        ) : heroImageUrl ? (
          <CuratedStopImage uri={heroImageUrl} />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.imagePlaceholder]} />
        )}

        {/* ORCH-1065: brand badge (top-left, below the stop-badge baseline) —
            only when this is a brand experience.
            ORCH-1155: when onBrandPress is provided, wrap the badge in a button
            that opens the brand page (no dead tap). Curated callers pass neither
            prop → byte-identical (SC-12). */}
        {brandExperience ? (
          onBrandPress ? (
            <TrackedTouchableOpacity
              activeOpacity={0.8}
              onPress={onBrandPress}
              accessibilityRole="button"
              accessibilityLabel={`View ${brandExperience.brandName}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.brandChipPressable, { top: stopBadgeTop }]}
            >
              <BrandChip
                brandName={brandExperience.brandName}
                brandLogoUrl={brandExperience.brandLogoUrl}
                top={stopBadgeTop}
                wrapped
              />
            </TrackedTouchableOpacity>
          ) : (
            <BrandChip
              brandName={brandExperience.brandName}
              brandLogoUrl={brandExperience.brandLogoUrl}
              top={stopBadgeTop}
            />
          )
        ) : null}

        {/* #1609 Direction C — the scrim. IDENTICAL to the place card: same ramp AND
            same absolute point height. The 62%-vs-52% branch is DELETED. That branch
            existed because curated carried an extra row the place card did not, and it
            is exactly how the two card types drifted apart — a per-type geometry value
            is the drift, not a response to it. Curated is now the same rectangle with
            two extra 4pt views. */}
        <LinearGradient
          colors={DECK_SCRIM_COLORS}
          locations={DECK_SCRIM_LOCATIONS}
          pointerEvents="none"
          style={styles.heroScrim}
        />

        {/* #1609 amendment 4 — the top scrim. Identical ramp and identical absolute
            height to the place card: the deck chrome sits at the same absolute y over
            BOTH card types, so a per-type value here would be the same class of drift
            that made the place and curated scrims disagree before. Curated's bottom
            scrim is the taller one (62%), so non-overlap is tightest here: it holds for
            any card at least 200 / 0.38 = 526.4pt tall. */}
        <LinearGradient
          colors={DECK_TOP_SCRIM_COLORS}
          locations={DECK_TOP_SCRIM_LOCATIONS}
          pointerEvents="none"
          style={styles.topScrim}
        />

        {/* #1609 Direction C — the name on the photograph, then the plate, exactly as
            the place card. `tagline` leaves the collapsed card for the same reason
            `oneLiner` does on the place card: a second prose line under the title at
            identical colour flattens the register the plate exists to create. It
            survives in the expanded card. */}
        <View style={styles.faceOverlay} pointerEvents="box-none">
          <Text
            style={[styles.cardTitle, { bottom: presentation.titleBottom }]}
            numberOfLines={S1.titleLines}
            maxFontSizeMultiplier={MAX_FONT_SCALE.title}
          >
            {card.title}
          </Text>

          {/*
            #1609 Direction C — THE CURATED MARK IS THE SILHOUETTE, NOT A LABEL.

            Deleted here: the accent "Plan · N stops" GlassBadge and the four
            metadata chips, the vector stop ribbon, and the rail's "See Full Plan"
            text. All six chips were BlurViews with per-badge entryIndex staggers
            inside the promotion diff — the exact shape that produced #1576 — and
            the accent chip additionally carried a colour-only identity signal.

            What replaces them is two 4pt slivers peeking above the plate's top
            edge. No text, no colour, no extra image decode, no gesture owner, and
            it reads at 402pt for the same reason it will read at 173pt: it is the
            object's silhouette. The facts move into the plate's meta line, where
            "3 stops" leads at weight 700.
          */}
          <CuratedSlivers plateH={presentation.plateH} />

          <DeckCardPlate
            spans={curatedSpans}
            beenHere={beenHere}
            onSharePress={onSharePress ?? NOOP}
            shareLabel={shareLabel ?? card.title}
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
  imagePlaceholder: {
    backgroundColor: '#2C2C2E',
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
  // #1609 tester P1-1 — `bottom` IS DELIBERATELY ABSENT. It was
  // `S1.bottomInset + S1.plateH + S1.gap`, a module-load constant that is only
  // correct for the 96pt silhouette; in the short one it stranded the name well
  // above a plate it is supposed to sit 20pt above. It is now applied at the
  // render site from `platePresentation(curatedSpans).titleBottom`. Do not put it
  // back — a StyleSheet.create entry is evaluated once per module, and this value
  // is per render.
  cardTitle: {
    position: 'absolute',
    left: S1.titleInset,
    right: S1.titleInset,
    color: '#FFFFFF',
    fontSize: S1.titleSize,
    fontWeight: S1.titleWeight as '700',
    lineHeight: S1.titleLH,
    zIndex: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
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
  // the tap target is the chip box. `top` is supplied inline (stopBadgeTop).
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
