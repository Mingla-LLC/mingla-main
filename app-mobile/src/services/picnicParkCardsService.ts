import { supabase } from './supabase';

/**
 * Picnic Park Card — flat single-place format returned by discover-picnic-park edge function.
 */
export interface PicnicParkCard {
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

export interface DiscoverPicnicParkParams {
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

class PicnicParkCardsService {
  async discoverPicnicPark(params: DiscoverPicnicParkParams): Promise<PicnicParkCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-picnic-park', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as PicnicParkCard[];
  }

  /** Pre-warm the picnic park card pool in the background (fire-and-forget) */
  async warmPicnicParkPool(params: Omit<DiscoverPicnicParkParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-picnic-park', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const picnicParkCardsService = new PicnicParkCardsService();
