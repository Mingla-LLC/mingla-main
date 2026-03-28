import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import BottomSheet from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useQueryClient } from '@tanstack/react-query';
import { Recommendation } from '../../types/recommendation';
import { useNearbyPeople, NearbyPerson } from '../../hooks/useNearbyPeople';
import { useMapLocation } from '../../hooks/useMapLocation';
import { useMapSettings } from '../../hooks/useMapSettings';
import { useMapCards } from '../../hooks/useMapCards';
import { supabase } from '../../services/supabase';
import { useAppStore } from '../../store/appStore';
import { MapBottomSheet } from './MapBottomSheet';
import { PersonBottomSheet } from './PersonBottomSheet';
import { ActivityStatusPicker } from './ActivityStatusPicker';
import { ActivityFeedOverlay } from './ActivityFeedOverlay';
import { MapProviderSurface } from './providers/MapProviderSurface';

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
  paused?: boolean;
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
  const [peopleLayerOn, setPeopleLayerOn] = useState(true);
  const [feedOn, setFeedOn] = useState(false);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const personSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (centerTrigger && centerTrigger > 0 && userLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        },
        500,
      );
    }
  }, [centerTrigger, userLocation]);

  const { settings, updateSettings } = useMapSettings();
  const isHidden = settings?.visibility_level === 'off';
  const { data: nearbyPeople = [] } = useNearbyPeople(
    peopleLayerOn && !isHidden && !paused,
    userLocation,
  );
  useMapLocation(!isHidden && !paused);

  useEffect(() => {
    supabase.functions.invoke('keep-warm').catch((err) => {
      console.warn('[DiscoverMap] keep-warm failed:', err?.message || err);
    });
  }, []);

  const { data: mapCards, isLoading: mapCardsLoading } = useMapCards(userLocation);
  const allCards = mapCards && mapCards.length > 0 ? mapCards : cards;

  const isStopClosed = useCallback((stop: any) => {
    if (stop?.isOpenNow === false) return true;

    const oh = stop?.openingHours ?? stop?.opening_hours;
    if (typeof oh === 'object' && oh !== null) {
      if ('open_now' in oh) return oh.open_now === false;
      if ('_isOpenNow' in oh) return oh._isOpenNow === false;
    }

    return false;
  }, []);

  const filteredCards = useMemo(() => {
    if (!placesLayerOn) return [];

    return allCards
      .filter((card) => {
        if (card.lat == null || card.lng == null) return false;
        if (!card.title || card.title.trim() === '') return false;

        if (card.strollData) {
          const rawStops = Array.isArray((card as any)._rawStops) ? (card as any)._rawStops : null;
          const stops = rawStops ?? [card.strollData.anchor, ...card.strollData.companionStops];
          return !stops.some(isStopClosed);
        }

        const oh = card.openingHours;
        if (typeof oh === 'object' && oh !== null && 'open_now' in oh) {
          return oh.open_now !== false;
        }

        return true;
      })
      .slice(0, 30);
  }, [allCards, isStopClosed, placesLayerOn]);

  const handlePinPress = useCallback((card: Recommendation) => {
    setSelectedPerson(null);
    personSheetRef.current?.close();
    setSelectedCard(card);
    bottomSheetRef.current?.snapToIndex(1);
  }, []);

  const handlePersonPinPress = useCallback((person: NearbyPerson) => {
    setSelectedCard(null);
    bottomSheetRef.current?.close();
    setSelectedPerson(person);
    personSheetRef.current?.snapToIndex(0);
  }, []);

  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (userLocation && user?.id) {
      supabase.functions
        .invoke('update-map-location', {
          body: { lat: userLocation.latitude, lng: userLocation.longitude },
        })
        .catch((err) => {
          console.warn('[DiscoverMap] update-map-location failed:', err?.message || err);
        });
    }
  }, [user?.id, userLocation]);

  const handleAddFriendFromMap = useCallback(
    async (userId: string) => {
      try {
        await supabase
          .from('friend_requests')
          .upsert(
            { sender_id: user!.id, receiver_id: userId, status: 'pending', source: 'map' },
            { onConflict: 'sender_id,receiver_id' },
          );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
      } catch {
        Alert.alert('Error', 'Could not send friend request. Try again later.');
      }
    },
    [user, queryClient],
  );

  const handleBlockFromMap = useCallback(
    async (userId: string) => {
      Alert.alert('Block User', "They won't be able to see you or contact you.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('blocked_users').upsert(
                { blocker_id: user!.id, blocked_user_id: userId },
                { onConflict: 'blocker_id,blocked_user_id' },
              );
              personSheetRef.current?.close();
              queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
            } catch {}
          },
        },
      ]);
    },
    [user, queryClient],
  );

  const handleReportFromMap = useCallback(
    async (userId: string) => {
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
    },
    [user],
  );

  const handleNext = useCallback(() => {
    if (filteredCards.length === 0) return;

    const currentIdx = selectedCard
      ? filteredCards.findIndex((card) => card.id === selectedCard.id)
      : -1;
    const nextIdx = (currentIdx + 1) % filteredCards.length;
    const nextCard = filteredCards[nextIdx];

    setSelectedCard(nextCard);

    if (nextCard.lat != null && nextCard.lng != null) {
      mapRef.current?.animateToRegion(
        {
          latitude: nextCard.lat,
          longitude: nextCard.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        400,
      );
    }
  }, [filteredCards, selectedCard]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <MapProviderSurface
        mapRef={mapRef}
        userLocation={userLocation}
        userMarkerInitial={(profile?.first_name || profile?.display_name || 'Y')[0].toUpperCase()}
        userMarkerDescription={profile?.first_name ? `Hey ${profile.first_name}` : "You're here"}
        allCards={allCards}
        filteredCards={filteredCards}
        savedCardIds={savedCardIds}
        scheduledCardIds={scheduledCardIds}
        selectedCard={selectedCard}
        nearbyPeople={nearbyPeople}
        peopleLayerOn={peopleLayerOn}
        heatmapOn={heatmapOn}
        onPlacePress={handlePinPress}
        onPersonPress={handlePersonPinPress}
      />

      <ActivityStatusPicker
        currentStatus={settings?.activity_status || null}
        peopleLayerOn={peopleLayerOn}
        onTogglePeople={() => setPeopleLayerOn((prev) => !prev)}
        placesLayerOn={placesLayerOn}
        onTogglePlaces={() => setPlacesLayerOn((prev) => !prev)}
        feedOn={feedOn}
        onToggleFeed={() => setFeedOn((prev) => !prev)}
        heatmapOn={heatmapOn}
        onToggleHeatmap={() => setHeatmapOn((prev) => !prev)}
        visibility={settings?.visibility_level || 'friends'}
        onVisibilityChange={async (level) => {
          await updateSettings({ visibility_level: level });
          if (level === 'off') setPeopleLayerOn(false);
        }}
        onSetStatus={async (status) => {
          if (status && !peopleLayerOn) setPeopleLayerOn(true);
          await updateSettings({
            activity_status: status,
            activity_status_expires_at: null,
          });
        }}
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
