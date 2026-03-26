import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Dimensions,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Region, PROVIDER_GOOGLE } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import BottomSheet from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Recommendation } from '../../types/recommendation';
import { PlacePin } from './PlacePin';
import { AnimatedPlacePin } from './AnimatedPlacePin';
import { PersonPin } from './PersonPin';
import { CuratedRoute } from './CuratedRoute';
import { MapFilterBar } from './MapFilterBar';
import { MapBottomSheet } from './MapBottomSheet';
import { PersonBottomSheet } from './PersonBottomSheet';
import { LayerToggles } from './LayerToggles';
import { GoDarkFAB } from './GoDarkFAB';
import { ActivityStatusPicker } from './ActivityStatusPicker';
import { ActivityFeedOverlay } from './ActivityFeedOverlay';
import { PlaceHeatmap } from './PlaceHeatmap';
import { getCategorySlug } from '../../utils/categoryUtils';
import { useNearbyPeople, NearbyPerson } from '../../hooks/useNearbyPeople';
import { useMapLocation } from '../../hooks/useMapLocation';
import { useMapSettings } from '../../hooks/useMapSettings';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../services/supabase';
import { useAppStore } from '../../store/appStore';

interface DiscoverMapProps {
  cards: Recommendation[];
  savedCardIds: Set<string>;
  scheduledCardIds: Set<string>;
  onCardExpand: (card: Recommendation) => void;
  onPersonMessage?: (userId: string) => void;
  onPersonInvite?: (userId: string) => void;
  onPersonCards?: (userId: string) => void;
  onPersonProfile?: (userId: string) => void;
  accountPreferences: { currency?: string; measurementSystem?: string };
  userLocation: { latitude: number; longitude: number } | null;
  isLoading: boolean;
}

export function DiscoverMap({
  cards,
  savedCardIds,
  scheduledCardIds,
  onCardExpand,
  onPersonMessage,
  onPersonInvite,
  onPersonCards,
  onPersonProfile,
  accountPreferences,
  userLocation,
  isLoading,
}: DiscoverMapProps) {
  const [selectedCard, setSelectedCard] = useState<Recommendation | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<NearbyPerson | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [placesLayerOn, setPlacesLayerOn] = useState(true);
  const [peopleLayerOn, setPeopleLayerOn] = useState(false);
  const [feedOn, setFeedOn] = useState(false);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const personSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<any>(null);

  // People layer hooks
  const { settings, updateSettings } = useMapSettings();
  const isDark = !!(settings?.go_dark_until && new Date(settings.go_dark_until) > new Date());
  const { data: nearbyPeople = [] } = useNearbyPeople(peopleLayerOn && !isDark, userLocation);
  useMapLocation(peopleLayerOn && !isDark && settings?.visibility_level !== 'off');

  // Filter cards by active filters (client-side, instant)
  const filteredCards = useMemo(() => {
    if (!placesLayerOn) return [];
    return cards.filter(card => {
      // lat/lng can be 0 (valid coordinate) — check for undefined/null, not falsy
      if (card.lat == null || card.lng == null) return false;
      // Cards use readable names ("Casual Eats"), filters use slugs ("casual_eats")
      const slug = getCategorySlug(card.category);
      if (selectedCategories.size > 0 && !selectedCategories.has(slug)) return false;
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
    setSelectedPerson(null);
    personSheetRef.current?.close();
    setSelectedCard(card);
    bottomSheetRef.current?.snapToIndex(0);
  }, []);

  const handlePersonPinPress = useCallback((person: NearbyPerson) => {
    setSelectedCard(null);
    bottomSheetRef.current?.close();
    setSelectedPerson(person);
    personSheetRef.current?.snapToIndex(0);
  }, []);

  const handleToggleGoDark = useCallback(() => {
    if (!updateSettings) return;
    const newValue = isDark ? null : new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    updateSettings({ go_dark_until: newValue });
  }, [isDark, updateSettings]);

  const user = useAppStore(s => s.user);
  const queryClient = useQueryClient();

  const handleAddFriendFromMap = useCallback(async (userId: string) => {
    try {
      await supabase
        .from('friend_requests')
        .upsert(
          { sender_id: user!.id, receiver_id: userId, status: 'pending', source: 'map' },
          { onConflict: 'sender_id,receiver_id' }
        );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
    } catch {
      Alert.alert('Error', 'Could not send friend request. Try again later.');
    }
  }, [user, queryClient]);

  const handleBlockFromMap = useCallback(async (userId: string) => {
    Alert.alert('Block User', "They won't be able to see you or contact you.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        try {
          await supabase.from('blocked_users').upsert(
            { blocker_id: user!.id, blocked_user_id: userId },
            { onConflict: 'blocker_id,blocked_user_id' }
          );
          personSheetRef.current?.close();
          queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
        } catch {}
      }},
    ]);
  }, [user, queryClient]);

  const handleReportFromMap = useCallback(async (userId: string) => {
    try {
      await supabase.from('user_reports').insert({
        reporter_id: user!.id,
        reported_user_id: userId,
        reason: 'map_interaction',
        details: 'Reported from map discovery',
      });
    } catch {}
    Alert.alert('Reported', 'Thanks for helping keep Mingla safe.');
    personSheetRef.current?.close();
  }, [user]);

  const handleNext = useCallback(() => {
    if (filteredCards.length === 0) return;
    const currentIdx = selectedCard
      ? filteredCards.findIndex(c => c.id === selectedCard.id)
      : -1;
    const nextIdx = (currentIdx + 1) % filteredCards.length;
    const nextCard = filteredCards[nextIdx];
    setSelectedCard(nextCard);
    if (nextCard.lat != null && nextCard.lng != null) {
      mapRef.current?.animateToRegion({
        latitude: nextCard.lat,
        longitude: nextCard.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 400);
    }
  }, [filteredCards, selectedCard]);

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
    <GestureHandlerRootView style={styles.container}>
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
        {filteredCards.map((card, index) => (
          <AnimatedPlacePin
            key={card.id}
            card={card}
            index={index}
            isSaved={savedCardIds.has(card.id)}
            isScheduled={scheduledCardIds.has(card.id)}
            onPress={() => handlePinPress(card)}
          />
        ))}
        {selectedCard?.strollData && (
          <CuratedRoute card={selectedCard} />
        )}
        {heatmapOn && (
          <PlaceHeatmap cards={cards} savedCardIds={savedCardIds} />
        )}
        {peopleLayerOn && nearbyPeople.map(person => (
          <PersonPin
            key={person.userId}
            person={person}
            onPress={() => handlePersonPinPress(person)}
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

      {peopleLayerOn && (
        <ActivityStatusPicker
          currentStatus={settings?.activity_status || null}
          onSetStatus={async (status) => {
            await updateSettings({
              activity_status: status,
              activity_status_expires_at: status
                ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
                : null,
            });
          }}
        />
      )}

      <LayerToggles
        placesLayerOn={placesLayerOn}
        onTogglePlaces={() => setPlacesLayerOn(p => !p)}
        peopleLayerOn={peopleLayerOn}
        onTogglePeople={() => setPeopleLayerOn(p => !p)}
        feedOn={feedOn}
        onToggleFeed={() => setFeedOn(p => !p)}
        heatmapOn={heatmapOn}
        onToggleHeatmap={() => setHeatmapOn(p => !p)}
      />

      <MapBottomSheet
        ref={bottomSheetRef}
        card={selectedCard}
        onExpand={onCardExpand}
        onNext={handleNext}
        onClose={() => setSelectedCard(null)}
        accountPreferences={accountPreferences}
      />

      <PersonBottomSheet
        ref={personSheetRef}
        person={selectedPerson}
        onClose={() => setSelectedPerson(null)}
        onMessage={(userId) => onPersonMessage?.(userId)}
        onInviteToSession={(userId) => onPersonInvite?.(userId)}
        onViewPairedCards={(userId) => onPersonCards?.(userId)}
        onViewProfile={(userId) => onPersonProfile?.(userId)}
        onAddFriend={handleAddFriendFromMap}
        onBlock={handleBlockFromMap}
        onReport={handleReportFromMap}
      />

      <View style={styles.goDarkPosition}>
        <GoDarkFAB isDark={isDark} onToggle={handleToggleGoDark} />
      </View>

      <ActivityFeedOverlay enabled={feedOn} nearbyPeople={nearbyPeople} />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#eb7825" />
        </View>
      )}
    </GestureHandlerRootView>
  );
}

// Map is rendered inside a ScrollView which gives children infinite height.
// flex: 1 resolves to 0 — must use explicit height.
const MAP_HEIGHT = Dimensions.get('window').height - 200; // account for tabs + pills + tab bar

const styles = StyleSheet.create({
  container: {
    height: MAP_HEIGHT,
  },
  goDarkPosition: {
    position: 'absolute',
    bottom: 76,
    right: 16,
    zIndex: 10,
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
