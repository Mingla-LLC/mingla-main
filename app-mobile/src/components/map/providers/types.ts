import type { RefObject } from 'react';
import type { NearbyPerson } from '../../../hooks/useNearbyPeople';
import type { Recommendation } from '../../../types/recommendation';

export type DiscoverMapProviderKind = 'react-native-maps' | 'maplibre';

export interface DiscoverMapProviderProps {
  mapRef: RefObject<any>;
  userLocation: { latitude: number; longitude: number } | null;
  userMarkerInitial: string;
  userMarkerDescription: string;
  allCards: Recommendation[];
  filteredCards: Recommendation[];
  savedCardIds: Set<string>;
  scheduledCardIds: Set<string>;
  selectedCard: Recommendation | null;
  nearbyPeople: NearbyPerson[];
  peopleLayerOn: boolean;
  heatmapOn: boolean;
  onPlacePress: (card: Recommendation) => void;
  onPersonPress: (person: NearbyPerson) => void;
}
