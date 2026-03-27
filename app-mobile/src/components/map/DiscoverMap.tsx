import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Region, UrlTile, Marker } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import BottomSheet from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Recommendation } from '../../types/recommendation';
import { AnimatedPlacePin } from './AnimatedPlacePin';
import { Icon } from '../ui/Icon';
import { PersonPin } from './PersonPin';
import { CuratedRoute } from './CuratedRoute';
// MapFilterBar removed — all cards shown, filtered by open-now only
import { MapBottomSheet } from './MapBottomSheet';
import { PersonBottomSheet } from './PersonBottomSheet';
import { LayerToggles } from './LayerToggles';
import { ActivityStatusPicker } from './ActivityStatusPicker';
import { ActivityFeedOverlay } from './ActivityFeedOverlay';
import { PlaceHeatmap } from './PlaceHeatmap';
import { useNearbyPeople, NearbyPerson } from '../../hooks/useNearbyPeople';
import { useMapLocation } from '../../hooks/useMapLocation';
import { useMapSettings } from '../../hooks/useMapSettings';
import { useMapCards } from '../../hooks/useMapCards';
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
  centerTrigger?: number;
  paused?: boolean;  // true when PersonHolidayView is showing — stops polling
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
  centerTrigger,
  paused = false,
}: DiscoverMapProps) {
  const [selectedCard, setSelectedCard] = useState<Recommendation | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<NearbyPerson | null>(null);
  const [placesLayerOn, setPlacesLayerOn] = useState(true);
  const [peopleLayerOn, setPeopleLayerOn] = useState(true); // default ON — visibility defaults to 'friends'
  const [feedOn, setFeedOn] = useState(false);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const personSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<any>(null);

  // Center on user location when For You pill is tapped
  useEffect(() => {
    if (centerTrigger && centerTrigger > 0 && userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }, 500);
    }
  }, [centerTrigger, userLocation]);

  // People layer hooks
  const { settings, updateSettings } = useMapSettings();
  const isDark = !!(settings?.go_dark_until && new Date(settings.go_dark_until) > new Date());
  const { data: nearbyPeople = [] } = useNearbyPeople(peopleLayerOn && !isDark && !paused, userLocation);
  // Always update location when map is visible and not paused
  useMapLocation(!isDark && !paused && settings?.visibility_level !== 'off');


  // Warm edge functions before map cards query fires
  useEffect(() => {
    supabase.functions.invoke('keep-warm').catch(() => {});
  }, []);

  // Fetch ALL cards from pool for the map (200 limit, not the 20 from discover)
  const { data: mapCards, isLoading: mapCardsLoading } = useMapCards(userLocation);
  const allCards = (mapCards && mapCards.length > 0) ? mapCards : cards; // fallback to prop cards

  const isStopClosed = useCallback((stop: any) => {
    if (stop?.isOpenNow === false) return true;

    const oh = stop?.openingHours ?? stop?.opening_hours;
    if (typeof oh === 'object' && oh !== null) {
      if ('open_now' in oh) return oh.open_now === false;
      if ('_isOpenNow' in oh) return oh._isOpenNow === false;
    }

    return false;
  }, []);

  // Filter cards for map display:
  // 1. Must have valid lat/lng
  // 2. Must have a title
  // 3. Single cards: must be open now (if hours available)
  // 4. Curated cards: ALL stops must be open now (if hours available)
  const filteredCards = useMemo(() => {
    if (!placesLayerOn) return [];
    return allCards.filter(card => {
      // Valid coordinates
      if (card.lat == null || card.lng == null) return false;

      // Photos not required for map pins (pins show category icons, not photos).
      // Photos are only needed when user taps a pin and opens the bottom sheet.

      // Must have a title
      if (!card.title || card.title.trim() === '') return false;

      // Curated card — check all stops are open
      if (card.strollData) {
        const rawStops = Array.isArray((card as any)._rawStops) ? (card as any)._rawStops : null;
        const stops = rawStops ?? [card.strollData.anchor, ...card.strollData.companionStops];
        return !stops.some(isStopClosed);
      }

      // Single card — check open_now
      const oh = card.openingHours;
      if (typeof oh === 'object' && oh !== null && 'open_now' in oh) {
        return oh.open_now !== false;
      }

      // No hours data — show it
      return true;
    }).slice(0, 30); // Cap at 30 markers for performance
  }, [allCards, isStopClosed, placesLayerOn]);

  const handlePinPress = useCallback((card: Recommendation) => {
    setSelectedPerson(null);
    personSheetRef.current?.close();
    setSelectedCard(card);
    bottomSheetRef.current?.snapToIndex(1); // 45% — middle snap
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
  const profile = useAppStore(s => s.profile);
  const queryClient = useQueryClient();

  // Seed location on first map load — always fires to ensure user_map_settings row exists
  useEffect(() => {
    if (userLocation && user?.id) {
      supabase.functions.invoke('update-map-location', {
        body: { lat: userLocation.latitude, lng: userLocation.longitude },
      }).catch(() => {});
    }
  }, [user?.id, !!userLocation]);

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


  const initialRegion: Region = {
    latitude: userLocation?.latitude ?? 35.7796,
    longitude: userLocation?.longitude ?? -78.6382,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  // Android: react-native-maps requires a native rebuild (npx expo prebuild).
  // In Expo Go, the AIRMap native component is not available — show fallback.
  if (Platform.OS === 'android') {
    try {
      // Test if MapView is available by checking the native module registry
      const { UIManager } = require('react-native');
      if (!UIManager.getViewManagerConfig || !UIManager.getViewManagerConfig('AIRMap')) {
        return (
          <View style={[styles.container, styles.androidFallback]}>
            <Icon name="map-outline" size={48} color="#d1d5db" />
            <Text style={styles.androidFallbackTitle}>Map requires native build</Text>
            <Text style={styles.androidFallbackText}>
              Run: npx expo prebuild --clean && npx expo run:android
            </Text>
          </View>
        );
      }
    } catch {
      // UIManager check failed — proceed and hope for the best
    }
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <ClusteredMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={false}
        showsBuildings={false}
        showsIndoors={false}
        showsPointsOfInterest={false}
        mapPadding={{ top: 60, right: 0, bottom: 80, left: 0 }}
        clusterColor="#eb7825"
        radius={50}
        maxZoom={16}
      >
        {/* CartoDB Positron — clean map with city names. Replaces native map. */}
        <UrlTile
          urlTemplate="https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          maximumZ={19}
          tileSize={256}
          shouldReplaceMapContent
        />
        {/* User avatar marker — uses initials only (remote images + tracksViewChanges=false = glitchy) */}
        {userLocation && (
          <Marker
            coordinate={userLocation}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={999}
            title="This is you"
            description={profile?.first_name ? `Hey ${profile.first_name} 👋` : "You're here"}
          >
            <View style={styles.userMarker}>
              <View style={styles.userMarkerPulse} />
              <View style={styles.userAvatarRing}>
                <View style={styles.userAvatarFallback}>
                  <Text style={styles.userAvatarInitials}>
                    {(profile?.first_name || profile?.display_name || 'Y')[0].toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>
          </Marker>
        )}

        {heatmapOn && <PlaceHeatmap cards={allCards} savedCardIds={savedCardIds} />}
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
        {peopleLayerOn && nearbyPeople.map(person => (
          <PersonPin
            key={person.userId}
            person={person}
            onPress={() => handlePersonPinPress(person)}
          />
        ))}
      </ClusteredMapView>


      <ActivityStatusPicker
          currentStatus={settings?.activity_status || null}
          peopleLayerOn={peopleLayerOn}
          onTogglePeople={() => setPeopleLayerOn(p => !p)}
          visibility={settings?.visibility_level || 'friends'}
          onVisibilityChange={async (level) => {
            await updateSettings({ visibility_level: level });
            if (level === 'off') setPeopleLayerOn(false);
          }}
          onSetStatus={async (status) => {
            if (status && !peopleLayerOn) setPeopleLayerOn(true); // auto-enable people layer
            await updateSettings({
              activity_status: status,
              activity_status_expires_at: null,
            });
          }}
        />

      <LayerToggles
        placesLayerOn={placesLayerOn}
        onTogglePlaces={() => setPlacesLayerOn(p => !p)}
        peopleLayerOn={peopleLayerOn}
        onTogglePeople={() => setPeopleLayerOn(p => !p)}
        isDark={isDark}
        onToggleGoDark={handleToggleGoDark}
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

      {feedOn && <ActivityFeedOverlay enabled={feedOn} nearbyPeople={nearbyPeople} />}

      {(isLoading || mapCardsLoading) && allCards.length === 0 && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#eb7825" />
        </View>
      )}
    </GestureHandlerRootView>
  );
}

// Clean map style — hides POIs, transit, road labels. Only terrain + water + Mingla pins.
// Works on Google Maps (Android). Apple Maps uses showsPointsOfInterest={false} prop instead.
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  userMarker: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMarkerPulse: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(235,120,37,0.15)',
  },
  userAvatarRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  userAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  userAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  androidFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
    gap: 12,
    padding: 32,
  },
  androidFallbackTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
  },
  androidFallbackText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
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
