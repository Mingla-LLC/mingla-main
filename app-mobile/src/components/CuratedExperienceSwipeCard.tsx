import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Icon } from './ui/Icon';
import { GlassBadge } from './ui/GlassBadge';
import type { CuratedExperienceCard } from '../types/curatedExperience';
import { parseAndFormatDistance, formatCurrency } from './utils/formatters';

const CURATED_ICON_MAP: Record<string, string> = {
  'Adventurous':   'compass-outline',
  'First Date':    'sparkles',
  'Romantic':      'heart',
  'Group Fun':     'people',
  'Picnic Dates':  'sandwich',
  'Take a Stroll': 'walk-outline',
};

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
}

export function CuratedExperienceSwipeCard({ card, onSeePlan, travelMode, measurementSystem, currencyCode }: Props) {
  const { t } = useTranslation(['common']);

  // Compact card shows only main (non-optional) stops
  const mainStops = card.stops.filter(s => !s.optional);
  const visibleStops = mainStops.length > 0 ? mainStops : card.stops;

  const avgRating = (visibleStops.reduce((s, st) => s + st.rating, 0) / visibleStops.length).toFixed(1);

  // ORCH-0629: Cumulative price — sum from the displayed stops directly.
  // Do NOT trust `card.totalPriceMin/Max` (card-level totals can be stale or left at 0
  // by the generator). Local sum is the truth the user sees on the card.
  const cumulativePriceMin = visibleStops.reduce((sum, stop) => sum + (stop.priceMin || 0), 0);
  const cumulativePriceMax = visibleStops.reduce((sum, stop) => sum + (stop.priceMax || 0), 0);
  const effectiveCurrency = currencyCode || 'USD';
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
  const ctaText = isSingleStop ? 'See Details' : 'See Full Plan';

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

  return (
    <View style={styles.card}>
      {/* Image section (88%) — multi-photo strip with overlay chrome */}
      <View style={styles.imageContainer}>
        <View style={styles.imageStrip}>
          {visibleStops.map((stop, idx) => (
            <View key={`${stop.placeId}_${idx}`} style={styles.imageWrapper}>
              {stop.imageUrl ? (
                <Image
                  source={{ uri: stop.imageUrl }}
                  style={styles.stopImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.stopImage, styles.imagePlaceholder]} />
              )}
              {!isSingleStop && (
                <View style={styles.stopBadgeWrapper}>
                  <GlassBadge variant="circular" accessibilityLabel={`Stop ${idx + 1}`}>
                    {idx + 1}
                  </GlassBadge>
                </View>
              )}
            </View>
          ))}
        </View>

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
            <GlassBadge iconName="star" entryIndex={2}>
              {avgRating}
            </GlassBadge>
            <GlassBadge iconName="pricetag" entryIndex={3}>
              {priceLabel}
            </GlassBadge>
            <GlassBadge iconName={categoryIcon as any} entryIndex={4}>
              {categoryChipLabel}
            </GlassBadge>
          </View>
        </View>
      </View>

      {/* Details tray (12%) — minimal white section with a share-style CTA */}
      <View style={styles.cardDetails}>
        <TrackedTouchableOpacity
          logComponent="CuratedExperienceSwipeCard"
          style={styles.seePlanButton}
          onPress={onSeePlan}
          activeOpacity={0.7}
        >
          <Icon name="list-outline" size={18} color="#6b7280" />
          <Text style={styles.seePlanButtonText}>{ctaText}</Text>
        </TrackedTouchableOpacity>
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
  stopBadgeWrapper: {
    position: 'absolute',
    top: 8,
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
});
