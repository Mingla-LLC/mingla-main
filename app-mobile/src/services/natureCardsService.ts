import { supabase } from './supabase';

/**
 * Nature Card — flat single-place format returned by discover-nature edge function.
 */
export interface NatureCard {
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

export interface DiscoverNatureParams {
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

class NatureCardsService {
  async discoverNature(params: DiscoverNatureParams): Promise<NatureCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-nature', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as NatureCard[];
  }

  /** Pre-warm the nature card pool in the background (fire-and-forget) */
  async warmNaturePool(params: Omit<DiscoverNatureParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-nature', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const natureCardsService = new NatureCardsService();
