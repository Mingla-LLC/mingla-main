import type { MutableRefObject } from 'react';
import type { NearbyPerson } from '../../../hooks/useNearbyPeople';
import type { Recommendation } from '../../../types/recommendation';

export type DiscoverMapProviderKind = 'react-native-maps' | 'maplibre';

export interface DiscoverMapProviderProps {
  mapRef: MutableRefObject<any>;
  userLocation: { latitude: number; longitude: number } | null;
  userMarkerInitial: string;
  userMarkerDescription: string;
  userAvatarUrl: string | null;
  userActivityStatus: string | null;
  allCards: Recommendation[];
  filteredCards: Recommendation[];
  pairedSavedCards: Recommendation[];
  savedCardIds: Set<string>;
  pairedSavedCardIds: Set<string>;
  scheduledCardIds: Set<string>;
  selectedCard: Recommendation | null;
  selectedPerson: NearbyPerson | null;
  nearbyPeople: NearbyPerson[];
  peopleLayerOn: boolean;
  heatmapOn: boolean;
  onPlacePress: (card: Recommendation) => void;
  onPersonPress: (person: NearbyPerson) => void;
  onUserPress: () => void;
}
