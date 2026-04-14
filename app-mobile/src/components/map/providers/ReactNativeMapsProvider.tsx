import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, UIManager, Pressable } from 'react-native';
import { Marker, UrlTile } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import { Icon } from '../../ui/Icon';
import { AnimatedPlacePin } from '../AnimatedPlacePin';
import { CuratedRoute } from '../CuratedRoute';
import { PersonPinContent, SelfPinContent } from '../PersonPin';
import { PlaceHeatmap } from '../PlaceHeatmap';
import { layoutNearbyPeople } from '../layoutNearbyPeople';
import type { DiscoverMapProviderProps } from './types';
import type { MapStyleElement } from 'react-native-maps';

// ORCH-0410: Clean Google Maps style for Android — hides all POIs, business labels,
// transit stations, road labels, and address numbers. Keeps road geometry, water,
// parks for spatial context. Only applied on Android (iOS uses CARTO tiles via UrlTile).
const GOOGLE_MAPS_CLEAN_STYLE: MapStyleElement[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

export function ReactNativeMapsProvider({
  mapRef,
  userLocation,
  userMarkerInitial,
  userMarkerDescription: _userMarkerDescription,
  userAvatarUrl,
  userActivityStatus,
  allCards,
  filteredCards,
  pairedSavedCards,
  savedCardIds,
  pairedSavedCardIds,
  scheduledCardIds,
  selectedCard,
  selectedPerson,
  nearbyPeople,
  peopleLayerOn,
  heatmapOn,
  onPlacePress,
  onPersonPress,
  onUserPress,
}: DiscoverMapProviderProps) {
  const renderedPeople = useMemo(
    () => layoutNearbyPeople(nearbyPeople, {
      userLocation,
      selectedPersonId: selectedPerson?.userId ?? null,
    }),
    [nearbyPeople, selectedPerson?.userId, userLocation],
  );

  // Allow person markers to re-render for 3s so avatar images load,
  // then disable tracksViewChanges for performance (ORCH-0361).
  // Resets only when the set of people actually changes (join/leave),
  // NOT on every refetch with identical data (ORCH-0385).
  const peopleFingerprint = useMemo(
    () => nearbyPeople.map(p => p.userId).sort().join(','),
    [nearbyPeople],
  );
  const [peopleTrackChanges, setPeopleTrackChanges] = useState(true);
  useEffect(() => {
    setPeopleTrackChanges(true);
    const timer = setTimeout(() => setPeopleTrackChanges(false), 3000);
    return () => clearTimeout(timer);
  }, [peopleFingerprint]);

  // ORCH-0409: Periodic heartbeat — briefly re-enable tracksViewChanges every 45s
  // to recover from native bitmap cache invalidation that causes markers to vanish.
  // Cost: 3s of active rendering out of every 45s = ~7% overhead. Acceptable for <50 markers.
  // History: tracksViewChanges=false optimization added in ORCH-0361. Heartbeat preserves
  // that optimization while preventing silent marker disappearance.
  // Revert: remove this useEffect if markers never disappear without it.
  useEffect(() => {
    const interval = setInterval(() => {
      setPeopleTrackChanges(true);
      setTimeout(() => setPeopleTrackChanges(false), 3000);
    }, 45_000);
    return () => clearInterval(interval);
  }, []);

  const visiblePlaceCards = useMemo(() => {
    const cardMap = new Map(filteredCards.map((card) => [card.id, card]));
    for (const pairedSavedCard of pairedSavedCards) {
      if (!cardMap.has(pairedSavedCard.id)) {
        cardMap.set(pairedSavedCard.id, pairedSavedCard);
      }
    }
    return Array.from(cardMap.values());
  }, [filteredCards, pairedSavedCards]);


  if (Platform.OS === 'android') {
    try {
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
      // If the view manager lookup itself fails, continue and let the map attempt to render.
    }
  }

  return (
    <ClusteredMapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={{
        latitude: userLocation?.latitude ?? 35.7796,
        longitude: userLocation?.longitude ?? -78.6382,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
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
      // iOS defaults to LayoutAnimation on every region settle — markers relayout and
      // taps on people pins are often lost until the animation finishes.
      animationEnabled={false}
      // ORCH-0410: Hide all Google Maps labels/POIs on Android so only Mingla pins show.
      // On iOS, Apple Maps POIs are hidden by showsPointsOfInterest={false}.
      // On Android, Google Maps needs customMapStyle to hide labels.
      // shouldReplaceMapContent on UrlTile is iOS-only (MapUrlTile.d.ts:66-68).
      {...(Platform.OS === 'android' ? { customMapStyle: GOOGLE_MAPS_CLEAN_STYLE } : {})}
    >
      {/* CARTO light tiles — iOS only. shouldReplaceMapContent is not supported on Android
          (MapUrlTile.d.ts:66-68). On Android, Google Maps base tiles are styled via
          customMapStyle above instead. */}
      {Platform.OS === 'ios' && (
        <UrlTile
          urlTemplate="https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          maximumZ={19}
          tileSize={256}
          shouldReplaceMapContent
        />
      )}

      {userLocation && (
        <Marker
          coordinate={userLocation}
          onPress={onUserPress}
          tracksViewChanges={false}
          anchor={{ x: 0.5, y: 0.35 }}
          zIndex={30}
          {...{ cluster: false }}
        >
          <View collapsable={false} style={styles.userMarker}>
            <View style={styles.userMarkerPulse} />
            <SelfPinContent
              avatarUrl={userAvatarUrl}
              initial={userMarkerInitial}
              activityStatus={userActivityStatus}
            />
          </View>
        </Marker>
      )}

      {heatmapOn && <PlaceHeatmap cards={allCards} savedCardIds={savedCardIds} />}

      {visiblePlaceCards.map((card, index) => (
        <AnimatedPlacePin
          key={card.id}
          card={card}
          index={index}
          isSaved={savedCardIds.has(card.id)}
          isPairedSaved={pairedSavedCardIds.has(card.id)}
          isScheduled={scheduledCardIds.has(card.id)}
          isSelected={selectedCard?.id === card.id}
          onPress={() => onPlacePress(card)}
        />
      ))}

      {selectedCard?.strollData && <CuratedRoute card={selectedCard} />}

      {peopleLayerOn && renderedPeople.map(({ person, coordinate, zIndex }) => (
        <Marker
          key={`person-${person.userId}`}
          coordinate={coordinate}
          tracksViewChanges={peopleTrackChanges}
          zIndex={zIndex}
          anchor={{ x: 0.5, y: 0.35 }}
          {...{ cluster: false }}
          tappable
        >
          <Pressable
            onPress={() => onPersonPress(person)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Open ${person.displayName}`}
            style={styles.personMarkerTouchTarget}
          >
            <View collapsable={false} pointerEvents="box-none">
              <PersonPinContent person={person} />
            </View>
          </Pressable>
        </Marker>
      ))}
    </ClusteredMapView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  userMarker: {
    width: 56,
    height: 68,
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
  /** Widen hit area so taps register while the map is still settling. */
  personMarkerTouchTarget: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
});
