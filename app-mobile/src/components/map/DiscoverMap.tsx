import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Region, PROVIDER_GOOGLE } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import BottomSheet from '@gorhom/bottom-sheet';
import { Recommendation } from '../../types/recommendation';
import { PlacePin } from './PlacePin';
import { MapFilterBar } from './MapFilterBar';
import { MapBottomSheet } from './MapBottomSheet';
import { LayerToggles } from './LayerToggles';

interface DiscoverMapProps {
  cards: Recommendation[];
  savedCardIds: Set<string>;
  scheduledCardIds: Set<string>;
  onCardSave: (card: Recommendation) => void;
  onCardSchedule: (card: Recommendation) => void;
  onCardExpand: (card: Recommendation) => void;
  accountPreferences: { currency?: string; measurementSystem?: string };
  userLocation: { latitude: number; longitude: number } | null;
  isLoading: boolean;
}

export function DiscoverMap({
  cards,
  savedCardIds,
  scheduledCardIds,
  onCardSave,
  onCardSchedule,
  onCardExpand,
  accountPreferences,
  userLocation,
  isLoading,
}: DiscoverMapProps) {
  const [selectedCard, setSelectedCard] = useState<Recommendation | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [placesLayerOn, setPlacesLayerOn] = useState(true);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<any>(null);

  // Filter cards by active filters (client-side, instant)
  const filteredCards = useMemo(() => {
    if (!placesLayerOn) return [];
    return cards.filter(card => {
      if (!card.lat || !card.lng) return false;
      if (selectedCategories.size > 0 && !selectedCategories.has(card.category)) return false;
      if (selectedTier !== 'all' && card.priceTier !== selectedTier) return false;
      if (openNowOnly) {
        const oh = card.openingHours;
        if (typeof oh === 'object' && oh !== null && 'open_now' in oh) {
          if (!oh.open_now) return false;
        }
      }
      return true;
    });
  }, [cards, selectedCategories, selectedTier, openNowOnly, placesLayerOn]);

  const handlePinPress = useCallback((card: Recommendation) => {
    setSelectedCard(card);
    bottomSheetRef.current?.snapToIndex(0);
  }, []);

  const toggleCategory = useCallback((slug: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const initialRegion: Region = {
    latitude: userLocation?.latitude ?? 35.7796,
    longitude: userLocation?.longitude ?? -78.6382,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  return (
    <View style={styles.container}>
      <ClusteredMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        mapPadding={{ top: 50, right: 0, bottom: 0, left: 0 }}
        clusterColor="#eb7825"
        radius={50}
        maxZoom={16}
      >
        {filteredCards.map(card => (
          <PlacePin
            key={card.id}
            card={card}
            isSaved={savedCardIds.has(card.id)}
            isScheduled={scheduledCardIds.has(card.id)}
            onPress={() => handlePinPress(card)}
          />
        ))}
      </ClusteredMapView>

      <MapFilterBar
        selectedCategories={selectedCategories}
        onToggleCategory={toggleCategory}
        selectedTier={selectedTier}
        onTierChange={setSelectedTier}
        openNowOnly={openNowOnly}
        onOpenNowToggle={() => setOpenNowOnly(p => !p)}
      />

      <LayerToggles
        placesLayerOn={placesLayerOn}
        onTogglePlaces={() => setPlacesLayerOn(p => !p)}
      />

      <MapBottomSheet
        ref={bottomSheetRef}
        card={selectedCard}
        onSave={onCardSave}
        onSchedule={onCardSchedule}
        onExpand={onCardExpand}
        onClose={() => setSelectedCard(null)}
        accountPreferences={accountPreferences}
      />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#eb7825" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    zIndex: 20,
  },
});
