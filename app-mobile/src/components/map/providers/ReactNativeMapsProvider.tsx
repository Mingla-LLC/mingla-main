import React from 'react';
import { View, Text, StyleSheet, Platform, UIManager } from 'react-native';
import { Marker, UrlTile } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import { Icon } from '../../ui/Icon';
import { AnimatedPlacePin } from '../AnimatedPlacePin';
import { CuratedRoute } from '../CuratedRoute';
import { PersonPin } from '../PersonPin';
import { PlaceHeatmap } from '../PlaceHeatmap';
import type { DiscoverMapProviderProps } from './types';

export function ReactNativeMapsProvider({
  mapRef,
  userLocation,
  userMarkerInitial,
  userMarkerDescription,
  allCards,
  filteredCards,
  savedCardIds,
  scheduledCardIds,
  selectedCard,
  nearbyPeople,
  peopleLayerOn,
  heatmapOn,
  onPlacePress,
  onPersonPress,
}: DiscoverMapProviderProps) {
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
          tracksViewChanges={true}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={999}
          title="This is you"
          description={userMarkerDescription}
        >
          <View style={styles.userMarker}>
            <View style={styles.userMarkerPulse} />
            <View style={styles.userAvatarRing}>
              <View style={styles.userAvatarFallback}>
                <Text style={styles.userAvatarInitials}>{userMarkerInitial}</Text>
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
          onPress={() => onPlacePress(card)}
        />
      ))}

      {selectedCard?.strollData && <CuratedRoute card={selectedCard} />}

      {peopleLayerOn && nearbyPeople.map((person) => (
        <PersonPin
          key={person.userId}
          person={person}
          onPress={() => onPersonPress(person)}
        />
      ))}
    </ClusteredMapView>
  );
}

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
});
