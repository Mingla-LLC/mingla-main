import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import { Icon } from '../ui/Icon';
import { getCategoryIcon, getCategoryColor } from '../../utils/categoryUtils';
import { Recommendation } from '../../types/recommendation';

interface PlacePinProps {
  card: Recommendation;
  isSaved: boolean;
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
export function PlacePinContent({ card, isSaved, isScheduled }: Omit<PlacePinProps, 'onPress'>) {
  const categoryColor = getCategoryColor(card.category) || '#6b7280';
  const categoryIcon = getCategoryIcon(card.category) || 'location-outline';
  const tierColor = TIER_BORDER_COLORS[card.priceTier ?? 'chill'] || '#10B981';

  return (
    <View style={styles.wrapper}>
      <View style={[styles.pinOuter, { borderColor: tierColor }]}>
        <View style={[styles.pinInner, { backgroundColor: categoryColor }]}>
          <Icon name={categoryIcon} size={14} color="#FFF" />
        </View>
      </View>
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
}

// Full PlacePin with Marker wrapper — backward compatible
export function PlacePin({ card, isSaved, isScheduled, onPress }: PlacePinProps) {
  if (card.lat == null || card.lng == null) return null;

  return (
    <Marker
      coordinate={{ latitude: card.lat, longitude: card.lng }}
      onPress={onPress}
      tracksViewChanges={false}
    >
      <PlacePinContent card={card} isSaved={isSaved} isScheduled={isScheduled} />
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
  scheduledBadge: {
    backgroundColor: '#DBEAFE',
    right: -2,
    top: 20,
  },
});
