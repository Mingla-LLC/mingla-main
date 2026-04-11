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
  const [peopleTrackChanges, setPeopleTrackChanges] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setPeopleTrackChanges(false), 3000);
    return () => clearTimeout(timer);
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
    >
      <UrlTile
        urlTemplate="https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        maximumZ={19}
        tileSize={256}
        shouldReplaceMapContent
      />

      {userLocation && (
        <Marker
          coordinate={userLocation}
          onPress={onUserPress}
          tracksViewChanges={false}
          anchor={{ x: 0.5, y: 0.35 }}
          zIndex={30}
          {...{ cluster: false }}
        >
          <View style={styles.userMarker}>
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
