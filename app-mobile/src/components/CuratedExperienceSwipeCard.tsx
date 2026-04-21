import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Icon } from './ui/Icon';
import { GlassBadge } from './ui/GlassBadge';
import type { CuratedExperienceCard } from '../types/curatedExperience';
import { googleLevelToTierSlug, tierLabel, formatTierLabel } from '../constants/priceTiers';
import { parseAndFormatDistance, formatCurrency, getCurrencySymbol, getCurrencyRate } from './utils/formatters';

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
  const durationHrs = (card.estimatedDurationMinutes / 60).toFixed(1);
  // Show tier label from the first non-optional stop's priceTier, or fallback to price range
  const firstMainStop = visibleStops.find(s => !s.optional);
  const firstStopTier = firstMainStop?.priceTier || visibleStops[0]?.priceTier;
  const effectiveCurrency = currencyCode || 'USD';
  const symbol = getCurrencySymbol(effectiveCurrency);
  const rate = getCurrencyRate(effectiveCurrency);
  const priceText = firstStopTier
    ? formatTierLabel(firstStopTier, symbol, rate)
    : card.totalPriceMin === 0 && card.totalPriceMax === 0
      ? 'Free'
      : `${formatCurrency(card.totalPriceMin, effectiveCurrency)}–${formatCurrency(card.totalPriceMax, effectiveCurrency)}`;

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

  return (
    <View style={styles.card}>
      {/* Image strip — adapts to any number of stops */}
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

      {/* Card info */}
      <View style={styles.infoSection}>
        {/* Category badge */}
        <View style={styles.categoryBadge}>
          <Icon name={categoryIcon} size={12} color="#fff" />
          <Text style={styles.categoryText}>{categoryLabel}</Text>
          <Text style={styles.stopCountText}> · {visibleStops.length} {visibleStops.length === 1 ? 'spot' : 'stops'}</Text>
        </View>

        {/* Title */}
        <Text style={styles.title} numberOfLines={2}>
          {card.title}
        </Text>

        {/* Meta row */}
        <View style={styles.metaRow}>
          {formattedDistance ? (
            <>
              <Icon name="location" size={11} color="rgba(255,255,255,0.7)" />
              <Text style={styles.metaText}> {formattedDistance}</Text>
              <Text style={styles.metaDot}> · </Text>
            </>
          ) : null}
          {formattedTravelTime ? (
            <>
              <Icon name={getTravelModeIcon(travelMode)} size={11} color="rgba(255,255,255,0.7)" />
              <Text style={styles.metaText}> {formattedTravelTime}</Text>
              <Text style={styles.metaDot}> · </Text>
            </>
          ) : null}
          <Text style={styles.metaText}>{priceText}</Text>
          <Text style={styles.metaDot}> · </Text>
          <Icon name="star" size={11} color="#F59E0B" />
          <Text style={styles.metaText}> {avgRating} avg</Text>
        </View>

        {/* CTA */}
        <TrackedTouchableOpacity logComponent="CuratedExperienceSwipeCard" style={styles.ctaButton} onPress={onSeePlan} activeOpacity={0.85}>
          <Text style={styles.ctaText}>{ctaText}</Text>
          <Icon name="arrow-forward" size={16} color="#fff" />
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
  imageStrip: {
    flexDirection: 'row',
    flex: 0.55,
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
  infoSection: {
    flex: 0.45,
    padding: 12,
    gap: 6,
    justifyContent: 'center',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  categoryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  stopCountText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '500',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  metaDot: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
  },
  ctaButton: {
    backgroundColor: '#F59E0B',
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  ctaText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
