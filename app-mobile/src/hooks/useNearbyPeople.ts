import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';

export interface NearbyPerson {
  userId: string;
  displayName: string;
  firstName: string | null;
  avatarUrl: string | null;
  approximateLat: number;
  approximateLng: number;
  activityStatus: string | null;
  lastActiveAt: string;
  relationship: 'paired' | 'friend' | 'stranger';
  tasteMatchPct: number | null;
  sharedCategories: string[];
  sharedTiers: string[];
  canSendFriendRequest: boolean;
  mapFriendRequestsRemaining: number;
}

export function useNearbyPeople(
  enabled: boolean,
  location: { latitude: number; longitude: number } | null,
  radiusKm: number = 15,
) {
  const tourMode = useAppStore(s => s.tourMode);

  return useQuery<NearbyPerson[]>({
    queryKey: ['nearby-people', location?.latitude?.toFixed(2), location?.longitude?.toFixed(2), radiusKm],
    queryFn: async () => {
      // In tour mode, return empty — real data comes from pre-seeded cache in mockTourData
      if (tourMode) return [];
      if (!location) return [];
      const { data, error } = await supabase.functions.invoke('get-nearby-people', {
        body: { lat: location.latitude, lng: location.longitude, radiusKm },
      });
      if (error) throw error;
      return data as NearbyPerson[];
    },
    enabled: enabled && !!location,
    refetchInterval: tourMode ? false : 60_000,
    staleTime: tourMode ? Infinity : 30_000,
  });
}
