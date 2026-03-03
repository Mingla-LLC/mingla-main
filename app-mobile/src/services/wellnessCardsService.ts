import { supabase } from './supabase';

/**
 * Wellness Card — flat single-place format returned by discover-wellness edge function.
 */
export interface WellnessCard {
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

export interface DiscoverWellnessParams {
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

class WellnessCardsService {
  async discoverWellness(params: DiscoverWellnessParams): Promise<WellnessCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-wellness', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as WellnessCard[];
  }

  /** Pre-warm the wellness card pool in the background (fire-and-forget) */
  async warmWellnessPool(params: Omit<DiscoverWellnessParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-wellness', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const wellnessCardsService = new WellnessCardsService();
