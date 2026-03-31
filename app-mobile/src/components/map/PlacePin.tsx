import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import { Icon } from '../ui/Icon';
import { getCategoryIcon, getCategoryColor, getCategorySlug } from '../../utils/categoryUtils';
import { Recommendation } from '../../types/recommendation';

// Direct slug → icon map matching preferences sheet exactly
const CATEGORY_ICON_MAP: Record<string, string> = {
  nature: 'trees',
  first_meet: 'handshake',
  picnic_park: 'tree-pine',
  drink: 'wine-outline',
  casual_eats: 'utensils-crossed',
  fine_dining: 'chef-hat',
  watch: 'film-new',
  live_performance: 'musical-notes-outline',
  creative_arts: 'color-palette-outline',
  play: 'game-controller-outline',
  wellness: 'heart-pulse',
  flowers: 'flower-outline',
};

interface PlacePinProps {
  card: Recommendation;
  isSaved: boolean;
  isPairedSaved?: boolean;
  isScheduled: boolean;
  onPress: () => void;
}

const TIER_BORDER_COLORS: Record<string, string> = {
  chill: '#10B981',
  comfy: '#3B82F6',
  bougie: '#8B5CF6',
  lavish: '#F59E0B',
};

// Extracted content — used by both PlacePin and AnimatedPlacePin
export const PlacePinContent = React.memo(function PlacePinContent({
  card,
  isSaved,
  isPairedSaved = false,
  isScheduled,
}: Omit<PlacePinProps, 'onPress'>) {
  const slug = getCategorySlug(card.category);
  const categoryColor = getCategoryColor(card.category) || '#6b7280';
  const categoryIcon = CATEGORY_ICON_MAP[slug] || getCategoryIcon(card.category) || 'compass-outline';
  const tierColor = TIER_BORDER_COLORS[card.priceTier ?? 'chill'] || '#10B981';
  const isCurated = !!card.strollData;

  return (
    <View style={isCurated ? styles.wrapperLarge : styles.wrapper}>
      <View style={[isCurated ? styles.pinOuterLarge : styles.pinOuter, { borderColor: tierColor }]}>
        <View style={[isCurated ? styles.pinInnerLarge : styles.pinInner, { backgroundColor: categoryColor }]}>
          <Icon name={isCurated ? 'map-outline' : categoryIcon} size={isCurated ? 20 : 14} color="#FFF" />
        </View>
      </View>
      {isPairedSaved && (
        <View style={[styles.badge, styles.pairedSavedBadge]}>
          <Icon name="people-outline" size={8} color="#eb7825" />
        </View>
      )}
      {isSaved && (
        <View style={[styles.badge, styles.savedBadge]}>
          <Icon name="heart" size={8} color="#ef4444" />
        </View>
      )}
      {isScheduled && (
        <View style={[styles.badge, styles.scheduledBadge]}>
          <Icon name="calendar" size={8} color="#3b82f6" />
        </View>
      )}
    </View>
  );
});

// Full PlacePin with Marker wrapper — backward compatible
export function PlacePin({ card, isSaved, isPairedSaved = false, isScheduled, onPress }: PlacePinProps) {
  if (card.lat == null || card.lng == null) return null;

  return (
    <Marker
      coordinate={{ latitude: card.lat, longitude: card.lng }}
      onPress={onPress}
      tracksViewChanges={false}
    >
      <PlacePinContent card={card} isSaved={isSaved} isPairedSaved={isPairedSaved} isScheduled={isScheduled} />
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 36,
    height: 36,
  },
  pinOuter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
  },
  pinInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Curated cards — larger pins
  wrapperLarge: {
    width: 50,
    height: 50,
  },
  pinOuterLarge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
  },
  pinInnerLarge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  savedBadge: {
    backgroundColor: '#FEE2E2',
  },
  pairedSavedBadge: {
    backgroundColor: '#FFF7ED',
    left: -2,
    right: 'auto',
  },
  scheduledBadge: {
    backgroundColor: '#DBEAFE',
    right: -2,
    top: 20,
  },
});
