import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  MarkerView,
  RasterLayer,
  RasterSource,
  ShapeSource,
  type CameraRef,
  type CircleLayerStyle,
  type LineLayerStyle,
  type RegionPayload,
} from '@maplibre/maplibre-react-native';
import Supercluster, { type ClusterProperties } from 'supercluster';
import type { Recommendation } from '../../../types/recommendation';
import { PlacePinContent } from '../PlacePin';
import { PersonPinContent, SelfPinContent } from '../PersonPin';
import { layoutNearbyPeople } from '../layoutNearbyPeople';
import type { NearbyPerson } from '../../../hooks/useNearbyPeople';
import type { DiscoverMapProviderProps } from './types';

const FALLBACK_COORDINATE: [number, number] = [-78.6382, 35.7796];
const DEFAULT_LATITUDE_DELTA = 0.05;
const DEFAULT_LONGITUDE_DELTA = 0.05;
const CARTO_LIGHT_TILE_URL = 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png';
const MAP_STYLE_LIGHT_BLANK = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'discover-background',
      type: 'background',
      paint: {
        'background-color': '#f8fafc',
      },
    },
  ],
};

interface LegacyMapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

interface PlaceClusterProperties {
  cardId: string;
  isCurated: boolean;
}

interface RenderCluster {
  clusterId: number;
  coordinate: [number, number];
  pointCount: number;
  label: string;
}

interface ViewportState {
  bounds: [number, number, number, number];
  zoom: number;
}

type ClusteredPlaceFeature = GeoJSON.Feature<
  GeoJSON.Point,
  PlaceClusterProperties | ClusterProperties
>;
type RegionChangeFeature = GeoJSON.Feature<GeoJSON.Point, RegionPayload>;

function latitudeDeltaToZoom(latitudeDelta: number) {
  const safeLatitudeDelta = Math.min(Math.max(latitudeDelta, 0.0005), 160);
  const zoomLevel = Math.log2(360 / safeLatitudeDelta);
  return Math.min(Math.max(zoomLevel, 2), 18);
}

function boundsFromRegion(
  centerCoordinate: [number, number],
  latitudeDelta: number,
  longitudeDelta: number,
): [number, number, number, number] {
  const [longitude, latitude] = centerCoordinate;

  return [
    longitude - (longitudeDelta / 2),
    latitude - (latitudeDelta / 2),
    longitude + (longitudeDelta / 2),
    latitude + (latitudeDelta / 2),
  ];
}

function formatClusterLabel(pointCount: number, abbreviated?: string | number | null) {
  if (typeof abbreviated === 'string' && abbreviated.trim().length > 0) {
    return abbreviated.trim();
  }

  if (typeof abbreviated === 'number' && Number.isFinite(abbreviated)) {
    return String(abbreviated);
  }

  if (pointCount >= 1000) {
    return `${Math.round(pointCount / 100) / 10}k`;
  }

  return String(pointCount);
}

function getClusterDiameter(pointCount: number): 36 | 40 | 44 {
  if (pointCount >= 20) return 44;
  if (pointCount >= 8) return 40;
  return 36;
}

const CLUSTER_SIZE_STYLES = {
  36: StyleSheet.create({ size: { width: 36, height: 36, borderRadius: 18 } }).size,
  40: StyleSheet.create({ size: { width: 40, height: 40, borderRadius: 20 } }).size,
  44: StyleSheet.create({ size: { width: 44, height: 44, borderRadius: 22 } }).size,
};

function getPlaceRenderWeight(card: Recommendation, selectedCardId: string | null) {
  if (card.id === selectedCardId) return 2;
  if (card.strollData) return 1;
  return 0;
}

function isClusterFeatureProperties(
  properties: PlaceClusterProperties | ClusterProperties | null | undefined,
): properties is ClusterProperties {
  return !!properties && 'cluster' in properties && properties.cluster === true;
}

function toPlaceFeature(card: Recommendation): GeoJSON.Feature<GeoJSON.Point, PlaceClusterProperties> {
  return {
    type: 'Feature',
    id: card.id,
    properties: {
      cardId: card.id,
      isCurated: !!card.strollData,
    },
    geometry: {
      type: 'Point',
      coordinates: [card.lng!, card.lat!],
    },
  };
}

function getCuratedStops(card: Recommendation) {
  if (!card.strollData) return [];

  const rawStops = Array.isArray((card as Recommendation & { _rawStops?: unknown })._rawStops)
    ? ((card as Recommendation & { _rawStops?: { location?: { lat?: number; lng?: number }; name?: string }[] })._rawStops ?? [])
    : null;

  const orderedStops =
    rawStops ??
    [
      card.strollData.anchor,
      ...card.strollData.companionStops,
    ];

  return orderedStops
    .map((stop, index) => {
      const lat = stop?.location?.lat;
      const lng = stop?.location?.lng;

      if (lat == null || lng == null) return null;

      return {
        step: index + 1,
        name: stop?.name ?? `Stop ${index + 1}`,
        coordinates: [lng, lat] as [number, number],
      };
    })
    .filter((stop): stop is { step: number; name: string; coordinates: [number, number] } => stop !== null);
}

function extractViewportState(feature: RegionChangeFeature): ViewportState | null {
  const visibleBounds = feature.properties?.visibleBounds;
  const zoom = feature.properties?.zoomLevel;

  if (!Array.isArray(visibleBounds) || visibleBounds.length !== 2 || typeof zoom !== 'number') {
    return null;
  }

  const [northEast, southWest] = visibleBounds;

  if (!Array.isArray(northEast) || !Array.isArray(southWest)) {
    return null;
  }

  const [east, north] = northEast;
  const [west, south] = southWest;

  if ([east, north, west, south].some((value) => typeof value !== 'number')) {
    return null;
  }

  if (east < west) {
    return {
      bounds: [-180, south, 180, north],
      zoom,
    };
  }

  return {
    bounds: [west, south, east, north],
    zoom,
  };
}

function hasViewportMeaningfullyChanged(currentViewport: ViewportState, nextViewport: ViewportState) {
  const zoomDelta = Math.abs(currentViewport.zoom - nextViewport.zoom);

  if (zoomDelta >= 0.18) {
    return true;
  }

  return currentViewport.bounds.some((value, index) => (
    Math.abs(value - nextViewport.bounds[index]) >= 0.0015
  ));
}

/* ─── Extracted memoized marker components (stable press handlers) ─── */

const ClusterMarker = React.memo(function ClusterMarker({
  cluster,
  onPress,
}: {
  cluster: RenderCluster;
  onPress: (cluster: RenderCluster) => void;
}) {
  const handlePress = useCallback(() => onPress(cluster), [cluster, onPress]);
  return (
    <MarkerView
      coordinate={cluster.coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlap
    >
      <Pressable
        hitSlop={8}
        onPress={handlePress}
        style={[styles.clusterMarker, CLUSTER_SIZE_STYLES[getClusterDiameter(cluster.pointCount)]]}
      >
        <Text style={styles.clusterMarkerText}>{cluster.label}</Text>
      </Pressable>
    </MarkerView>
  );
});

const PlaceMarker = React.memo(function PlaceMarker({
  card,
  savedCardIds,
  pairedSavedCardIds,
  scheduledCardIds,
  isSelected,
  onPress,
}: {
  card: Recommendation;
  savedCardIds: Set<string>;
  pairedSavedCardIds: Set<string>;
  scheduledCardIds: Set<string>;
  isSelected: boolean;
  onPress: (cardId: string) => void;
}) {
  const handlePress = useCallback(() => onPress(card.id), [card.id, onPress]);
  return (
    <MarkerView
      coordinate={[card.lng!, card.lat!]}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlap
      isSelected={isSelected}
    >
      <Pressable
        hitSlop={8}
        onPress={handlePress}
        style={isSelected ? styles.selectedPlaceMarker : undefined}
      >
        <PlacePinContent
          card={card}
          isSaved={savedCardIds.has(card.id)}
          isPairedSaved={pairedSavedCardIds.has(card.id)}
          isScheduled={scheduledCardIds.has(card.id)}
        />
      </Pressable>
    </MarkerView>
  );
});

const PersonMarker = React.memo(function PersonMarker({
  person,
  coordinate,
  isSelected,
  onPress,
}: {
  person: NearbyPerson;
  coordinate: { longitude: number; latitude: number };
  isSelected: boolean;
  onPress: (userId: string) => void;
}) {
  const handlePress = useCallback(() => onPress(person.userId), [person.userId, onPress]);
  return (
    <MarkerView
      coordinate={[coordinate.longitude, coordinate.latitude]}
      anchor={{ x: 0.5, y: 0.35 }}
      allowOverlap
      isSelected={isSelected}
    >
      <Pressable
        hitSlop={20}
        onPress={handlePress}
        style={isSelected ? styles.selectedPersonMarker : undefined}
      >
        <View collapsable={false} style={styles.personMarkerTouchTarget}>
          <PersonPinContent person={person} />
        </View>
      </Pressable>
    </MarkerView>
  );
});

/* ─── Main provider ─── */

export function MapLibreProvider({
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
  const cameraRef = useRef<CameraRef>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const defaultCenterCoordinate = useMemo<[number, number]>(() => {
    if (!userLocation) return FALLBACK_COORDINATE;
    return [userLocation.longitude, userLocation.latitude];
  }, [userLocation]);

  const viewportRef = useRef<ViewportState>({
    bounds: boundsFromRegion(
      defaultCenterCoordinate,
      DEFAULT_LATITUDE_DELTA,
      DEFAULT_LONGITUDE_DELTA,
    ),
    zoom: latitudeDeltaToZoom(DEFAULT_LATITUDE_DELTA),
  });
  const [clusterViewport, setClusterViewport] = useState<ViewportState>(() => viewportRef.current);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (viewportRef.current.zoom !== latitudeDeltaToZoom(DEFAULT_LATITUDE_DELTA)) {
      return;
    }

    viewportRef.current = {
      bounds: boundsFromRegion(
        defaultCenterCoordinate,
        DEFAULT_LATITUDE_DELTA,
        DEFAULT_LONGITUDE_DELTA,
      ),
      zoom: viewportRef.current.zoom,
    };
    setClusterViewport(viewportRef.current);
  }, [defaultCenterCoordinate]);

  // Cleanup flush timer on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  const animateToRegion = useCallback(
    (region: LegacyMapRegion, duration = 500) => {
      cameraRef.current?.setCamera({
        centerCoordinate: [region.longitude, region.latitude],
        zoomLevel: latitudeDeltaToZoom(region.latitudeDelta),
        animationDuration: duration,
        animationMode: 'easeTo',
      });
    },
    [],
  );

  useEffect(() => {
    mapRef.current = {
      animateToRegion,
    };

    return () => {
      if (mapRef.current?.animateToRegion === animateToRegion) {
        mapRef.current = null;
      }
    };
  }, [animateToRegion, mapRef]);

  const visiblePlaceCards = useMemo(() => {
    const cardMap = new Map(filteredCards.map((card) => [card.id, card]));
    for (const pairedSavedCard of pairedSavedCards) {
      if (!cardMap.has(pairedSavedCard.id)) {
        cardMap.set(pairedSavedCard.id, pairedSavedCard);
      }
    }
    return Array.from(cardMap.values());
  }, [filteredCards, pairedSavedCards]);

  const placeCardMap = useMemo(
    () => new Map(visiblePlaceCards.map((card) => [card.id, card])),
    [visiblePlaceCards],
  );

  const placeFeatures = useMemo(
    () =>
      visiblePlaceCards
        .filter((card) => card.lat != null && card.lng != null)
        .map((card) => toPlaceFeature(card)),
    [visiblePlaceCards],
  );

  const placeClusters = useMemo(() => {
    const clusterIndex = new Supercluster<PlaceClusterProperties>({
      radius: 50,
      maxZoom: 16,
    });

    clusterIndex.load(placeFeatures);

    return clusterIndex;
  }, [placeFeatures]);

  const clusteredPlaceFeatures = useMemo<ClusteredPlaceFeature[]>(() => {
    if (placeFeatures.length === 0) return [];

    return placeClusters.getClusters(
      clusterViewport.bounds,
      Math.max(0, Math.round(clusterViewport.zoom)),
    ) as ClusteredPlaceFeature[];
  }, [placeClusters, placeFeatures.length, clusterViewport.bounds, clusterViewport.zoom]);

  const renderedClusters = useMemo<RenderCluster[]>(() => {
    return clusteredPlaceFeatures.flatMap((feature) => {
      const properties = feature.properties;

      if (!isClusterFeatureProperties(properties)) {
        return [];
      }

      return [
        {
          clusterId: properties.cluster_id,
          coordinate: feature.geometry.coordinates as [number, number],
          pointCount: properties.point_count,
          label: formatClusterLabel(
            properties.point_count,
            properties.point_count_abbreviated,
          ),
        },
      ];
    });
  }, [clusteredPlaceFeatures]);

  const renderedPlaceCards = useMemo(() => {
    const selectedCardId = selectedCard?.id ?? null;

    return clusteredPlaceFeatures
      .flatMap((feature) => {
        const properties = feature.properties;

        if (isClusterFeatureProperties(properties)) {
          return [];
        }

        const card = placeCardMap.get(properties.cardId);
        return card ? [card] : [];
      })
      .sort(
        (left, right) =>
          getPlaceRenderWeight(left, selectedCardId) - getPlaceRenderWeight(right, selectedCardId),
      );
  }, [clusteredPlaceFeatures, placeCardMap, selectedCard?.id]);

  const renderedPeople = useMemo(() => {
    if (!peopleLayerOn) return [];

    return layoutNearbyPeople(nearbyPeople, {
      userLocation,
      selectedPersonId: selectedPerson?.userId ?? null,
    });
  }, [nearbyPeople, peopleLayerOn, selectedPerson?.userId, userLocation]);

  const handleRegionDidChange = useCallback((feature: RegionChangeFeature) => {
    const nextViewport = extractViewportState(feature);
    if (!nextViewport) return;

    if (!hasViewportMeaningfullyChanged(viewportRef.current, nextViewport)) return;
    viewportRef.current = nextViewport;

    // Debounce: flush to render state after 400ms of quiet
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      setClusterViewport(viewportRef.current);
    }, 400);
  }, []);

  const handleClusterPress = useCallback(
    (cluster: RenderCluster) => {
      try {
        const expansionZoom = placeClusters.getClusterExpansionZoom(cluster.clusterId);

        cameraRef.current?.setCamera({
          centerCoordinate: cluster.coordinate,
          zoomLevel: Math.min(expansionZoom, 18),
          animationDuration: 350,
          animationMode: 'easeTo',
        });
      } catch (error) {
        console.warn('[MapLibreProvider] Failed to expand cluster:', error);
      }
    },
    [placeClusters],
  );

  const handlePlaceCardPress = useCallback((cardId: string) => {
    const card = placeCardMap.get(cardId);
    if (card) onPlacePress(card);
  }, [placeCardMap, onPlacePress]);

  const handlePersonMarkerPress = useCallback((userId: string) => {
    const positioned = renderedPeople.find((p) => p.person.userId === userId);
    if (positioned) onPersonPress(positioned.person);
  }, [renderedPeople, onPersonPress]);

  const curatedStops = useMemo(
    () => (selectedCard?.strollData ? getCuratedStops(selectedCard) : []),
    [selectedCard],
  );

  const curatedRouteLineShape = useMemo(() => {
    if (curatedStops.length < 2) return null;

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          id: `discover-curated-route-${selectedCard?.id ?? 'active'}`,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: curatedStops.map((stop) => stop.coordinates),
          },
        },
      ],
    };
  }, [curatedStops, selectedCard?.id]);

  const heatmapShape = useMemo(() => {
    if (!heatmapOn) return null;

    const features = allCards
      .filter((card) => card.lat != null && card.lng != null)
      .map((card) => ({
        type: 'Feature' as const,
        id: `discover-heat-${card.id}`,
        properties: {
          isSaved: savedCardIds.has(card.id),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [card.lng!, card.lat!] as [number, number],
        },
      }));

    if (features.length === 0) return null;

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [allCards, heatmapOn, savedCardIds]);

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        contentInset={[60, 0, 80, 0]}
        mapStyle={MAP_STYLE_LIGHT_BLANK}
        compassEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        surfaceView={false}
        logoEnabled={false}
        attributionEnabled
        attributionPosition={{ bottom: 12, left: 14 }}
        regionDidChangeDebounceTime={500}
        onWillStartLoadingMap={() => {
          setStyleLoaded(false);
          setLoadError(null);
        }}
        onDidFinishLoadingStyle={() => {
          setStyleLoaded(true);
          setLoadError(null);
        }}
        onDidFailLoadingMap={() => {
          setStyleLoaded(false);
          setLoadError('The map background failed to load.');
          console.warn('[MapLibreProvider] Failed to load light raster basemap');
        }}
        onRegionDidChange={handleRegionDidChange}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: defaultCenterCoordinate,
            zoomLevel: latitudeDeltaToZoom(DEFAULT_LATITUDE_DELTA),
          }}
        />

        <RasterSource
          id="discover-maplibre-basemap"
          tileUrlTemplates={[CARTO_LIGHT_TILE_URL]}
          tileSize={256}
          maxZoomLevel={19}
          attribution="© OpenStreetMap contributors © CARTO"
        >
          <RasterLayer
            id="discover-maplibre-basemap-layer"
            sourceID="discover-maplibre-basemap"
            style={basemapRasterStyle}
          />
        </RasterSource>

        {userLocation && (
          <MarkerView
            coordinate={[userLocation.longitude, userLocation.latitude]}
            anchor={{ x: 0.5, y: 0.35 }}
            allowOverlap
          >
            <Pressable hitSlop={8} onPress={onUserPress}>
              <View style={styles.userMarker}>
                <View style={styles.userMarkerPulse} />
                <SelfPinContent
                  avatarUrl={userAvatarUrl}
                  initial={userMarkerInitial}
                  activityStatus={userActivityStatus}
                />
              </View>
            </Pressable>
          </MarkerView>
        )}

        {heatmapShape && (
          <ShapeSource
            id="discover-maplibre-heatmap"
            shape={heatmapShape}
          >
            <CircleLayer
              id="discover-maplibre-heatmap-layer"
              style={heatmapCircleStyle}
            />
          </ShapeSource>
        )}

        {curatedRouteLineShape && (
          <ShapeSource
            id="discover-maplibre-curated-route"
            shape={curatedRouteLineShape}
          >
            <LineLayer
              id="discover-maplibre-curated-route-line"
              style={curatedRouteLineStyle}
            />
          </ShapeSource>
        )}

        {curatedStops.map((stop) => (
          <MarkerView
            key={`discover-maplibre-stop-${stop.step}`}
            coordinate={stop.coordinates}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View style={styles.routeStopMarker}>
              <Text style={styles.routeStopMarkerText}>{stop.step}</Text>
            </View>
          </MarkerView>
        ))}

        {renderedClusters.map((cluster) => (
          <ClusterMarker
            key={`discover-maplibre-cluster-${cluster.clusterId}`}
            cluster={cluster}
            onPress={handleClusterPress}
          />
        ))}

        {renderedPlaceCards.map((card) => (
          <PlaceMarker
            key={`discover-maplibre-card-${card.id}`}
            card={card}
            savedCardIds={savedCardIds}
            pairedSavedCardIds={pairedSavedCardIds}
            scheduledCardIds={scheduledCardIds}
            isSelected={selectedCard?.id === card.id}
            onPress={handlePlaceCardPress}
          />
        ))}

        {renderedPeople.map(({ person, coordinate }) => (
          <PersonMarker
            key={`discover-maplibre-person-${person.userId}`}
            person={person}
            coordinate={coordinate}
            isSelected={selectedPerson?.userId === person.userId}
            onPress={handlePersonMarkerPress}
          />
        ))}
      </MapView>

      {!styleLoaded && !loadError && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color="#eb7825" />
          <Text style={styles.loadingText}>Loading Discover map...</Text>
        </View>
      )}

      {loadError && (
        <View style={styles.errorOverlay} pointerEvents="none">
          <Text style={styles.errorTitle}>Map unavailable</Text>
          <Text style={styles.errorText}>{loadError}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    zIndex: 20,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  errorOverlay: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    maxWidth: 260,
    zIndex: 20,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6b7280',
    textAlign: 'center',
  },
  clusterMarker: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eb7825',
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 5,
  },
  clusterMarkerText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  selectedPlaceMarker: {
    transform: [{ scale: 1.04 }],
  },
  selectedPersonMarker: {
    transform: [{ scale: 1.04 }],
  },
  personMarkerTouchTarget: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  routeStopMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  routeStopMarkerText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFF',
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
});

const basemapRasterStyle = {
  rasterOpacity: 1,
  rasterFadeDuration: 0,
};

const heatmapCircleStyle: CircleLayerStyle = {
  circleColor: '#eb7825',
  circleRadius: [
    'case',
    ['==', ['get', 'isSaved'], true],
    16,
    12,
  ] as const,
  circleOpacity: [
    'case',
    ['==', ['get', 'isSaved'], true],
    0.5,
    0.35,
  ] as const,
  circleStrokeWidth: 0,
};

const curatedRouteLineStyle: LineLayerStyle = {
  lineColor: '#eb7825',
  lineWidth: 3,
  lineOpacity: 0.95,
  lineDasharray: [6, 3],
};
