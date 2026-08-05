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
import { Icon } from './ui/Icon';
import { GlassBadge } from './ui/GlassBadge';
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from '../constants/designSystem';
import type { CuratedExperienceCard } from '../types/curatedExperience';
import { parseAndFormatDistance, formatCurrency } from './utils/formatters';
// ORCH-1042: reuse the SAME hard-failure fallback URL + placeholder blurhash as the
// single-place deck hero (one source of truth — do not duplicate the literals).
// ORCH-1065 BUG-3: import from the leaf ./deckHeroConstants module, NOT from
// ./SwipeableCards — SwipeableCards imports THIS file (it renders the card), so
// importing back from it closed a require cycle. The leaf module has no such edge.
import {
  CARD_FALLBACK_IMAGE,
  DECK_HERO_PLACEHOLDER_BLURHASH,
  DECK_SCRIM_COLORS,
  DECK_SCRIM_LOCATIONS,
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

const CURATED_ICON_MAP: Record<string, string> = {
  'Adventurous':   'compass-outline',
  'First Date':    'sparkles',
  'Romantic':      'heart',
  'Group Fun':     'people',
  'Picnic Dates':  'sandwich',
  'Take a Stroll': 'walk-outline',
};

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

function getTravelModeIcon(mode?: string): string {
  switch (mode) {
    case 'driving': return 'car';
    case 'transit': return 'bus-outline';
    case 'bicycling':
    case 'biking': return 'bicycle-outline';
    case 'walking':
    default: return 'walk-outline';
  }
}

// #1609 — the ratios are DELETED here for the same reason as in SwipeableCards: a
// flex-axis key resolves differently under different sibling sets, which is #1593.
// The hero is a full-bleed absolute fill and the tray is gone.
//
// The stop ribbon renders at most this many nodes; beyond it, 3 nodes + a "+N" chip.
const RIBBON_MAX_NODES = 4;

interface Props {
  card: CuratedExperienceCard;
  onSeePlan: () => void;
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
  // ORCH-1209: only the front/active deck card streams its cover video. When
  // false the cover mounts paused on its poster (playbackActive=false) and
  // downloads nothing. Defaults true so non-deck callers (none today) are
  // unaffected. Mirrors SwipeableCards CardHero isTopCard (I-1069).
  isTopCard?: boolean;
}

export function CuratedExperienceSwipeCard({ card, onSeePlan, travelMode, measurementSystem, currencyCode, brandExperience, onBrandPress, experienceCover, ctaOverride, isTopCard = true }: Props) {
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

  // #1609 — the stop ribbon's nodes. Pure text + Views: zero images, zero scrollables,
  // zero touchables, so it adds nothing to the swipe path. Beyond RIBBON_MAX_NODES it
  // shows the first 3 and a "+N" overflow chip.
  const ribbonStops = visibleStops.length > RIBBON_MAX_NODES
    ? visibleStops.slice(0, RIBBON_MAX_NODES - 1)
    : visibleStops;
  const ribbonOverflow = visibleStops.length - ribbonStops.length;

  // ORCH-1065: this card is a brand experience when the brand-attribution prop is
  // present (curated callers omit it → byte-identical render, SC-13).
  const isBrandExperience = brandExperience != null;

  const avgRating = (visibleStops.reduce((s, st) => s + st.rating, 0) / visibleStops.length).toFixed(1);

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
  const categoryIcon = CURATED_ICON_MAP[card.categoryLabel || 'Adventurous'] || 'compass-outline';
  // ORCH-1065: ctaOverride present ('Book') for experiences; curated keeps its
  // existing text byte-for-byte.
  const ctaText = ctaOverride ?? (isSingleStop ? 'See Details' : 'See Full Plan');
  // #1609 — isBookCta / handleCtaPressIn are DELETED with the tray CTA they served.
  // The commerce "Book" action is NOT lost: it lives on the expanded sheet, which the
  // whole card now opens through requestTapExpand. What is gone is the second,
  // lease-bypassing entry point to that same sheet.

  // First stop distance & travel time (most relevant to the user)
  const firstStop = visibleStops[0];
  const distanceKm = firstStop?.distanceFromUserKm;
  const travelMin = firstStop?.travelTimeFromUserMin;
  const formattedDistance = distanceKm != null && distanceKm > 0
    ? parseAndFormatDistance(`${distanceKm.toFixed(1)} km`, measurementSystem)
    : null;
  const formattedTravelTime = travelMin != null && travelMin > 0
    ? `${Math.round(travelMin)} min`
    : null;

  // Category chip copy: "Group Fun · N stops" (single chip carries identity + stop count)
  const categoryChipLabel = isSingleStop
    ? categoryLabel
    : `${categoryLabel} · ${visibleStops.length} stops`;

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

        {/* #1609 — the scrim, identical ramp to the place card but 62% tall because
            curated carries an extra row (the ribbon) above the badges. Same contrast
            derivation; see DECK_SCRIM_COLORS in SwipeableCards.tsx. */}
        <LinearGradient
          colors={DECK_SCRIM_COLORS}
          locations={DECK_SCRIM_LOCATIONS}
          pointerEvents="none"
          style={styles.heroScrim}
        />

        {/* Title + labels overlay — bottom-left of image, matches single-card anatomy */}
        <View style={styles.titleOverlay} pointerEvents="box-none">
          <Text style={styles.cardTitle} numberOfLines={2} maxFontSizeMultiplier={1.4}>{card.title}</Text>
          {card.tagline && card.tagline.trim().length > 0 ? (
            <Text style={styles.oneLiner} numberOfLines={2} maxFontSizeMultiplier={1.4}>{card.tagline}</Text>
          ) : null}

          {/* #1609 differentiator 2 — the stop ribbon. NAMING the stops is strictly more
              informative than four unreadable crops: "three photos of rooms" becomes
              "Bar Termini, Osteria, Dante". Static by design — animating it would add an
              Animated.View per node inside the promotion diff, which is the exact shape
              that produced #1576. */}
          {!isSingleStop && ribbonStops.length > 0 ? (
            <View style={styles.ribbon} pointerEvents="none">
              {ribbonStops.map((stop, idx) => (
                <React.Fragment key={`${stop.placeId}_${idx}`}>
                  {idx > 0 ? <View style={styles.ribbonConnector} /> : null}
                  <View style={styles.ribbonNode}>
                    <View style={styles.ribbonDot} />
                    <Text style={styles.ribbonLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {stop.placeName}
                    </Text>
                  </View>
                </React.Fragment>
              ))}
              {ribbonOverflow > 0 ? (
                <Text style={styles.ribbonOverflow} maxFontSizeMultiplier={1.2}>{`+${ribbonOverflow}`}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Label chips — same GlassBadge vocabulary as single cards.
              Order matches SwipeableCards.tsx: location → travel → rating → price → category. */}
          <View style={styles.detailsBadges}>
            {/* #1609 differentiator 1 — the LEADING chip is accent-tinted so a curated
                card is identifiable at a glance. Colour is NOT the only signal: the
                git-branch icon and the word "Plan" each carry it independently. */}
            <GlassBadge variant="accent" iconName="git-branch-outline" entryIndex={0}>
              {isSingleStop ? 'Plan' : `Plan · ${visibleStops.length} stops`}
            </GlassBadge>
            {formattedDistance ? (
              <GlassBadge iconName="location" entryIndex={0}>
                {formattedDistance}
              </GlassBadge>
            ) : null}
            {formattedTravelTime ? (
              <GlassBadge iconName={getTravelModeIcon(travelMode) as any} entryIndex={1}>
                {formattedTravelTime}
              </GlassBadge>
            ) : null}
            {/* ORCH-1065 BUG-2: brand experiences have NO star rating (their stops
                carry rating 0 → "0.0", which is meaningless, not a real score).
                Hide the rating chip entirely for the experience variant; curated
                cards (real Google ratings) keep it. */}
            {isBrandExperience ? null : (
              <GlassBadge iconName="star" entryIndex={2}>
                {avgRating}
              </GlassBadge>
            )}
            <GlassBadge iconName="pricetag" entryIndex={3}>
              {priceLabel}
            </GlassBadge>
            <GlassBadge iconName={categoryIcon as any} entryIndex={4}>
              {categoryChipLabel}
            </GlassBadge>
          </View>

          {/* #1609 — the action rail, replacing the deleted tray and its CTA.
              That CTA called onSeePlan -> handleCardExpand DIRECTLY, bypassing
              requestTapExpand and therefore the deck's gesture lease entirely. Deleting
              it means EVERY expand entry point on this card — tap, swipe-up, and the
              VoiceOver expand action — now routes through requestTapExpand. That is a
              real hole closed (I-PROPOSED-1579 corollary), not a side effect: the same
              sheet is one tap away on the card itself. */}
          <View style={styles.actionRail} pointerEvents="none">
            <View style={styles.railHint}>
              <Icon name="chevron-up" size={14} color="#FFFFFF" />
              <Text style={styles.railHintText} numberOfLines={1}>{ctaText}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    overflow: 'hidden',
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
  // #1609 — replaces heroGradient. 62% (vs the place card's 52%) because curated
  // carries the ribbon row above the badges; same contrast-derived ramp.
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
    zIndex: 1,
  },
  // Title + labels overlay — matches SwipeableCards.tsx titleOverlay
  titleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 28,
    zIndex: 2,
  },
  cardTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 30,
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  oneLiner: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 6,
    marginBottom: 0,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // #1609 — the stop ribbon. Views and Texts only.
  ribbon: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
    marginBottom: 12,
  },
  ribbonNode: {
    alignItems: 'center',
    flexShrink: 1,
    maxWidth: 96,
  },
  ribbonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  ribbonConnector: {
    height: 1.5,
    flex: 1,
    minWidth: 12,
    maxWidth: 28,
    backgroundColor: 'rgba(255,255,255,0.45)',
    marginTop: 3.25,
    marginHorizontal: 4,
  },
  ribbonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
    marginTop: 5,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  ribbonOverflow: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
    marginLeft: 6,
  },
  detailsBadges: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  // #1609 — the rail. Signifier only on curated: the whole card is the expand target
  // and routes through requestTapExpand, so there is no CTA here to bypass the lease.
  actionRail: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    marginTop: 16,
  },
  railHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  railHintText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
    color: '#FFFFFF',
    opacity: 0.88,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
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
