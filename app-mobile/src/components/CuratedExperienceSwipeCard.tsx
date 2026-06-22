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
import * as Haptics from 'expo-haptics';
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
import { CARD_FALLBACK_IMAGE, DECK_HERO_PLACEHOLDER_BLURHASH } from './deckHeroConstants';

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
      style={styles.stopImage}
      contentFit="cover"
      cachePolicy="memory-disk"
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

// Matches SwipeableCards.tsx IMAGE_SECTION_RATIO — shared single-card chrome.
const IMAGE_SECTION_RATIO = 0.88;
const DETAILS_SECTION_RATIO = 1 - IMAGE_SECTION_RATIO;

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
  // ORCH-0991: deck is full-bleed under the floating glass top bar (HomePage safeArea has
  // no top inset). Push the per-stop number badges below the chrome so they aren't clipped
  // behind the status bar / Dynamic Island / preferences button. +62 matches the codebase's
  // established "just below the glass top bar" offset.
  const stopBadgeTop = insets.top + 62;

  // Compact card shows only main (non-optional) stops
  const mainStops = card.stops.filter(s => !s.optional);
  const visibleStops = mainStops.length > 0 ? mainStops : card.stops;

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
  const isBookCta = ctaOverride != null;

  const handleCtaPressIn = (): void => {
    // ORCH-1065 DESIGN §3.3: Light haptic on the commerce action (iOS only).
    if (isBookCta && Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

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
      {/* Image section (88%) — cover hero + stop strip (experience) OR full stop
          strip (curated / cover-less experience). */}
      <View style={styles.imageContainer}>
        {showCoverHero ? (
          <View style={styles.coverHeroSection}>
            {/* Cover hero — the experience's real cover (image/video/gif). */}
            <View style={styles.coverHeroMedia}>
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
            </View>
            {/* Stop strip — smaller row of stop photos beneath the cover. */}
            {visibleStops.length > 0 ? (
              <View style={styles.stopStripRow}>
                {visibleStops.map((stop, idx) => (
                  <View key={`${stop.placeId}_${idx}`} style={styles.stopStripCell}>
                    {stop.imageUrl ? (
                      <CuratedStopImage uri={stop.imageUrl} />
                    ) : (
                      <View style={[styles.stopImage, styles.imagePlaceholder]} />
                    )}
                    {!isSingleStop && (
                      <View style={styles.stopStripBadge}>
                        <GlassBadge variant="circular" accessibilityLabel={`Stop ${idx + 1}`}>
                          {idx + 1}
                        </GlassBadge>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.imageStrip}>
            {visibleStops.map((stop, idx) => (
              <View key={`${stop.placeId}_${idx}`} style={styles.imageWrapper}>
                {stop.imageUrl ? (
                  <CuratedStopImage uri={stop.imageUrl} />
                ) : (
                  <View style={[styles.stopImage, styles.imagePlaceholder]} />
                )}
                {!isSingleStop && (
                  <View style={[styles.stopBadgeWrapper, { top: stopBadgeTop }]}>
                    <GlassBadge variant="circular" accessibilityLabel={`Stop ${idx + 1}`}>
                      {idx + 1}
                    </GlassBadge>
                  </View>
                )}
              </View>
            ))}
          </View>
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

        {/* Hero gradient — dark fade behind title + labels for legibility */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.55)']}
          locations={[0, 0.5, 1]}
          pointerEvents="none"
          style={styles.heroGradient}
        />

        {/* Title + labels overlay — bottom-left of image, matches single-card anatomy */}
        <View style={styles.titleOverlay} pointerEvents="box-none">
          <Text style={styles.cardTitle} numberOfLines={2}>{card.title}</Text>
          {card.tagline && card.tagline.trim().length > 0 ? (
            <Text style={styles.oneLiner} numberOfLines={1}>{card.tagline}</Text>
          ) : null}

          {/* Label chips — same GlassBadge vocabulary as single cards.
              Order matches SwipeableCards.tsx: location → travel → rating → price → category. */}
          <View style={styles.detailsBadges}>
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
        </View>
      </View>

      {/* Details tray (12%) — share-style CTA for curated; filled "Book"
          commerce CTA for brand experiences (ORCH-1065 DESIGN §3). */}
      <View style={styles.cardDetails}>
        {isBookCta ? (
          <TrackedTouchableOpacity
            logComponent="CuratedExperienceSwipeCard"
            style={styles.bookButton}
            onPress={onSeePlan}
            onPressIn={handleCtaPressIn}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Book ${card.title}`}
          >
            <Icon name="ticket-outline" size={18} color="#FFFFFF" />
            <Text style={styles.bookButtonText}>{ctaText}</Text>
          </TrackedTouchableOpacity>
        ) : (
          <TrackedTouchableOpacity
            logComponent="CuratedExperienceSwipeCard"
            style={styles.seePlanButton}
            onPress={onSeePlan}
            activeOpacity={0.7}
          >
            <Icon name="list-outline" size={18} color="#6b7280" />
            <Text style={styles.seePlanButtonText}>{ctaText}</Text>
          </TrackedTouchableOpacity>
        )}
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
  // Hero image section — 88% of card (matches single-card IMAGE_SECTION_RATIO)
  imageContainer: {
    flex: IMAGE_SECTION_RATIO,
    position: 'relative',
  },
  imageStrip: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  // ORCH-1072: cover hero (top) + stop strip (bottom) for brand experiences.
  coverHeroSection: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  coverHeroMedia: {
    flex: 0.74, // cover takes ~3/4 of the image section
    width: '100%',
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
  },
  stopStripRow: {
    flex: 0.26, // stop photos as a smaller strip beneath the cover
    flexDirection: 'row',
  },
  stopStripCell: {
    flex: 1,
    position: 'relative',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(0,0,0,0.25)',
  },
  stopStripBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
  },
  imageWrapper: {
    flex: 1,
    position: 'relative',
  },
  stopImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    backgroundColor: '#2C2C2E',
  },
  // ORCH-0566: position-only wrapper — GlassBadge (variant=circular) provides its own skin.
  // ORCH-0991: `top` is set at runtime (safe-area inset + 62) so the badge clears the
  // floating glass top bar; `left` is static.
  stopBadgeWrapper: {
    position: 'absolute',
    left: 8,
  },
  // Hero fade — matches SwipeableCards.tsx heroGradient
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
    zIndex: 1,
  },
  // Title + labels overlay — matches SwipeableCards.tsx titleOverlay
  titleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 24,
    zIndex: 2,
  },
  cardTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  oneLiner: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 4,
    marginBottom: 10,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  detailsBadges: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  // Details tray — 12%, matches SwipeableCards.tsx cardDetails
  cardDetails: {
    flex: DETAILS_SECTION_RATIO,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0, 0, 0, 0.06)',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    justifyContent: 'center',
  },
  // "See Full Plan" — matches SwipeableCards.tsx shareButton chrome exactly
  seePlanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: 'rgba(249, 250, 251, 0.7)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  seePlanButtonText: {
    fontSize: 15,
    color: '#6b7280',
    fontWeight: '500',
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
  bookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,             // space.sm
    paddingVertical: 12, // space.md
    minHeight: 44,       // guaranteed tap target
    backgroundColor: '#FF6B35', // brand.primary
    borderRadius: 12,    // radius.md
  },
  bookButtonText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: '#FFFFFF',
  },
});
