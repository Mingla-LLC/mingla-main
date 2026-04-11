import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  useLayoutEffect,
  useReducer,
} from 'react';
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
import { usePairedMapSavedCards } from '../../hooks/usePairedMapSavedCards';
import { supabase } from '../../services/supabase';
import { blockUser } from '../../services/blockService';
import { useAppStore } from '../../store/appStore';
import { MapBottomSheet } from './MapBottomSheet';
import { PersonBottomSheet } from './PersonBottomSheet';
import { ActivityStatusPicker } from './ActivityStatusPicker';
import { useCoachMark } from '../../hooks/useCoachMark';
import { ActivityFeedOverlay } from './ActivityFeedOverlay';
import { MapProviderSurface } from './providers/MapProviderSurface';
import ReportUserModal from '../ReportUserModal';
import { submitReport, type ReportReason } from '../../services/reportService';

interface DiscoverMapProps {
  cards: Recommendation[];
  savedCardIds: Set<string>;
  scheduledCardIds: Set<string>;
  onCardExpand: (card: Recommendation) => void;
  onPersonMessage?: (userId: string) => void;
  onPersonCards?: (userId: string) => void;
  onPersonProfile?: (userId: string) => void;
  accountPreferences: { currency?: string; measurementSystem?: string };
  userLocation: { latitude: number; longitude: number } | null;
  isLoading: boolean;
  centerTrigger?: number;
  paused?: boolean;
  activePairedUserIds?: string[];
  pendingFocusCardId?: string | null;
  onFocusCardHandled?: () => void;
}

const MAX_VISIBLE_MAP_CARDS = 30;
const MAX_VISIBLE_CURATED_CARDS = 8;

export function DiscoverMap({
  cards,
  savedCardIds,
  scheduledCardIds,
  onCardExpand,
  onPersonMessage,
  onPersonCards,
  onPersonProfile,
  accountPreferences,
  userLocation,
  isLoading,
  centerTrigger,
  paused = false,
  activePairedUserIds = [],
  pendingFocusCardId = null,
  onFocusCardHandled,
}: DiscoverMapProps) {
  const coachMapControls = useCoachMark(8, 12);
  const [selectedCard, setSelectedCard] = useState<Recommendation | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<NearbyPerson | null>(null);
  const [placesLayerOn, setPlacesLayerOn] = useState(true);
  const [peopleLayerOn, setPeopleLayerOn] = useState(true);
  const [feedOn, setFeedOn] = useState(false);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [reportTargetUserId, setReportTargetUserId] = useState<string | null>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const personSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<any>(null);
  /** Bumped on every person pin tap so useLayoutEffect re-runs even when React bails out of setSelectedPerson (same object ref). */
  const [personSheetOpenGen, bumpPersonSheetOpenGen] = useReducer((n: number) => n + 1, 0);

  const handleViewProfile = useCallback(
    (userId: string) => {
      setSelectedPerson(null);
      personSheetRef.current?.close();
      onPersonProfile?.(userId);
    },
    [onPersonProfile],
  );

  const handlePersonMessage = useCallback(
    (userId: string) => {
      setSelectedPerson(null);
      personSheetRef.current?.close();
      onPersonMessage?.(userId);
    },
    [onPersonMessage],
  );

  useEffect(() => {
    if (centerTrigger && centerTrigger > 0 && userLocation && mapRef.current) {
      // Delay centering to ensure map is fully laid out after visibility transition
      const timer = setTimeout(() => {
        mapRef.current?.animateToRegion(
          {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          },
          500,
        );
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [centerTrigger, userLocation]);

  const { settings, updateSettings } = useMapSettings();
  const isHidden = settings?.visibility_level === 'off';
  const currentUserActivityStatus = useMemo(() => {
    if (
      settings?.activity_status_expires_at &&
      new Date(settings.activity_status_expires_at) < new Date()
    ) {
      return null;
    }

    return settings?.activity_status ?? null;
  }, [settings?.activity_status, settings?.activity_status_expires_at]);

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
  const { cards: pairedSavedCards, pairedSavedCardIds, isLoading: pairedSavedCardsLoading } =
    usePairedMapSavedCards(activePairedUserIds);
  const baseCards = mapCards && mapCards.length > 0 ? mapCards : cards;
  const allCards = useMemo(() => {
    const cardMap = new Map(baseCards.map((card) => [card.id, card]));
    for (const pairedSavedCard of pairedSavedCards) {
      if (!cardMap.has(pairedSavedCard.id)) {
        cardMap.set(pairedSavedCard.id, pairedSavedCard);
      }
    }
    return Array.from(cardMap.values());
  }, [baseCards, pairedSavedCards]);
  const visiblePairedSavedCards = useMemo(
    () => (placesLayerOn ? pairedSavedCards : []),
    [pairedSavedCards, placesLayerOn],
  );

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

    const eligibleCards = allCards
      .filter((card) => {
        if (card.lat == null || card.lng == null) return false;
        if (!card.title || card.title.trim() === '') return false;

        if (card.strollData) {
          const rawStops = Array.isArray((card as Recommendation & { _rawStops?: unknown })._rawStops)
            ? (card as Recommendation & { _rawStops?: { location?: { lat?: number; lng?: number }; name?: string }[] })._rawStops ?? null
            : null;
          const stops = rawStops ?? [card.strollData.anchor, ...card.strollData.companionStops];
          return !stops.some(isStopClosed);
        }

        const oh = card.openingHours;
        if (typeof oh === 'object' && oh !== null && 'open_now' in oh) {
          return oh.open_now !== false;
        }

        return true;
      });

    const curatedCards = eligibleCards.filter((card) => !!card.strollData);
    const singleCards = eligibleCards.filter((card) => !card.strollData);

    if (curatedCards.length === 0) {
      return singleCards.slice(0, MAX_VISIBLE_MAP_CARDS);
    }

    // Reserve visible space for curated cards so they are never pushed out by singles.
    const visibleCuratedCount = Math.min(curatedCards.length, MAX_VISIBLE_CURATED_CARDS);
    const visibleSinglesCount = Math.max(0, MAX_VISIBLE_MAP_CARDS - visibleCuratedCount);

    return [
      ...singleCards.slice(0, visibleSinglesCount),
      ...curatedCards.slice(0, visibleCuratedCount),
    ];
  }, [allCards, isStopClosed, placesLayerOn]);

  const handlePinPress = useCallback((card: Recommendation) => {
    setSelectedPerson(null);
    personSheetRef.current?.close();
    setSelectedCard(card);
  }, []);

  const handlePersonPinPress = useCallback((person: NearbyPerson) => {
    setSelectedCard(null);
    bottomSheetRef.current?.close();
    setSelectedPerson(person);
    bumpPersonSheetOpenGen();
  }, []);

  // Snap after layout so PersonBottomSheet has `person` content. Must re-run on every
  // tap (personSheetOpenGen): re-tapping the same friend reuses the same NearbyPerson
  // reference, so setSelectedPerson can bail out and skip effects otherwise.
  useLayoutEffect(() => {
    if (!selectedPerson) return;

    const snap = () => personSheetRef.current?.snapToIndex(0);
    snap();

    const t1 = setTimeout(snap, 32);
    const t2 = setTimeout(snap, 120);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [selectedPerson?.userId, personSheetOpenGen]);

  useLayoutEffect(() => {
    if (!selectedCard) return;
    const id = requestAnimationFrame(() => {
      bottomSheetRef.current?.snapToIndex(0);
    });
    return () => cancelAnimationFrame(id);
  }, [selectedCard?.id]);

  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const queryClient = useQueryClient();

  const handleUserMarkerPress = useCallback(() => {
    const firstName = profile?.first_name || profile?.display_name?.split(' ')[0] || 'there';
    const statusMessage = currentUserActivityStatus
      ? `You're currently "${currentUserActivityStatus}".`
      : 'You found yourself. Very Mingla.';

    Alert.alert('Hey, this is you', `${statusMessage} Hi, ${firstName}.`);
  }, [currentUserActivityStatus, profile?.display_name, profile?.first_name]);

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
        // Seed users don't have auth.users rows — skip DB insert to avoid FK violation (DEC-013)
        const person = nearbyPeople.find(p => p.userId === userId);
        if (person?.isSeed) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
          return;
        }

        const { data: requestData } = await supabase
          .from('friend_requests')
          .upsert(
            { sender_id: user!.id, receiver_id: userId, status: 'pending', source: 'map' },
            { onConflict: 'sender_id,receiver_id' },
          )
          .select('id')
          .single();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: ['nearby-people'] });

        // Send push notification to the receiver (fire-and-forget, non-blocking)
        const senderName = profile?.display_name || profile?.first_name || 'Someone';
        supabase.functions.invoke('notify-dispatch', {
          body: {
            userId,
            type: 'friend_request_received',
            title: `${senderName} wants to connect`,
            body: 'Tap to accept or pass.',
            data: {
              deepLink: 'mingla://connections?tab=requests',
              type: 'friend_request',
              requestId: requestData?.id || userId,
              senderId: user!.id,
            },
            actorId: user!.id,
            relatedId: requestData?.id || userId,
            relatedType: 'friend_request',
            idempotencyKey: `friend_request_received:${user!.id}:${userId}:${Date.now()}`,
          },
        }).then((result) => {
          if (result.data && !result.data.pushSent) {
            console.warn('[DiscoverMap] Push not sent:', result.data.reason);
          }
        }).catch((e) => {
          console.warn('[DiscoverMap] Friend request notification failed:', e);
        });
      } catch {
        Alert.alert('Error', 'Could not send friend request. Try again later.');
      }
    },
    [user, profile, queryClient, nearbyPeople],
  );

  const handleBlockFromMap = useCallback(
    async (userId: string) => {
      Alert.alert('Block User', "They won't be able to see you or contact you.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const result = await blockUser(userId);
            if (result.success) {
              personSheetRef.current?.close();
              queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
              queryClient.invalidateQueries({ queryKey: ['friends'] });
            } else {
              Alert.alert('Error', result.error || 'Could not block user. Try again later.');
            }
          },
        },
      ]);
    },
    [queryClient],
  );

  const handleReportFromMap = useCallback((userId: string) => {
    setReportTargetUserId(userId);
  }, []);

  const handleReportSubmit = useCallback(
    async (userId: string, reason: string, details?: string) => {
      const result = await submitReport(userId, reason as ReportReason, details);
      setReportTargetUserId(null);
      if (result.success) {
        Alert.alert('Reported', 'Thanks for helping keep Mingla safe.');
        personSheetRef.current?.close();
      } else {
        Alert.alert('Report Failed', result.error || 'Unable to submit report.');
      }
    },
    [],
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

  const focusCardById = useCallback((cardId: string) => {
    const targetCard = allCards.find((card) => card.id === cardId || card.placeId === cardId);
    if (!targetCard) return false;

    setSelectedPerson(null);
    personSheetRef.current?.close();
    setSelectedCard(targetCard);

    if (targetCard.lat != null && targetCard.lng != null) {
      mapRef.current?.animateToRegion(
        {
          latitude: targetCard.lat,
          longitude: targetCard.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        400,
      );
    }

    return true;
  }, [allCards]);

  useEffect(() => {
    if (!pendingFocusCardId) return;

    if (focusCardById(pendingFocusCardId)) {
      onFocusCardHandled?.();
      return;
    }

    if (!isLoading && !mapCardsLoading && !pairedSavedCardsLoading) {
      onFocusCardHandled?.();
    }
  }, [
    focusCardById,
    isLoading,
    mapCardsLoading,
    onFocusCardHandled,
    pairedSavedCardsLoading,
    pendingFocusCardId,
  ]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <MapProviderSurface
        mapRef={mapRef}
        userLocation={userLocation}
        userMarkerInitial={(profile?.first_name || profile?.display_name || 'Y')[0].toUpperCase()}
        userMarkerDescription={profile?.first_name ? `Hey ${profile.first_name}` : "You're here"}
        userAvatarUrl={profile?.avatar_url ?? null}
        userActivityStatus={currentUserActivityStatus}
        allCards={allCards}
        filteredCards={filteredCards}
        pairedSavedCards={visiblePairedSavedCards}
        savedCardIds={savedCardIds}
        pairedSavedCardIds={pairedSavedCardIds}
        scheduledCardIds={scheduledCardIds}
        selectedCard={selectedCard}
        selectedPerson={selectedPerson}
        nearbyPeople={nearbyPeople}
        peopleLayerOn={peopleLayerOn}
        heatmapOn={heatmapOn}
        onPlacePress={handlePinPress}
        onPersonPress={handlePersonPinPress}
        onUserPress={handleUserMarkerPress}
      />

      <ActivityStatusPicker
        fabRef={coachMapControls.targetRef}
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
        onMessage={handlePersonMessage}
        onViewPairedCards={(userId) => onPersonCards?.(userId)}
        onViewProfile={handleViewProfile}
        onAddFriend={handleAddFriendFromMap}
        onBlock={handleBlockFromMap}
        onReport={handleReportFromMap}
      />

      <ReportUserModal
        isOpen={!!reportTargetUserId}
        onClose={() => setReportTargetUserId(null)}
        user={{
          id: reportTargetUserId || '',
          name: selectedPerson?.displayName || 'User',
          username: selectedPerson?.displayName || '',
        }}
        onReport={handleReportSubmit}
      />

      {feedOn && (
        <ActivityFeedOverlay
          enabled={feedOn}
          nearbyPeople={nearbyPeople}
          onActivityPress={(cardId) => {
            focusCardById(cardId);
          }}
        />
      )}

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
