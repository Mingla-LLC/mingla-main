import { supabase } from './supabase';

/**
 * Watch Card — flat single-place format returned by discover-watch edge function.
 */
export interface WatchCard {
  id: string;
  placeId: string;
  title: string;
  description: string;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceLevelLabel: string;
  priceMin: number;
  priceMax: number;
  address: string;
  openingHours: Record<string, string>;
  isOpenNow: boolean;
  website: string | null;
  lat: number;
  lng: number;
  placeType: string;
  placeTypeLabel: string;
  distanceKm: number;
  travelTimeMin: number;
  matchScore: number;
}

export interface DiscoverWatchParams {
  location: { lat: number; lng: number };
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed?: number;
  limit?: number;
}

class WatchCardsService {
  async discoverWatch(params: DiscoverWatchParams): Promise<WatchCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-watch', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as WatchCard[];
  }

  /** Pre-warm the watch card pool in the background (fire-and-forget) */
  async warmWatchPool(params: Omit<DiscoverWatchParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-watch', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const watchCardsService = new WatchCardsService();
