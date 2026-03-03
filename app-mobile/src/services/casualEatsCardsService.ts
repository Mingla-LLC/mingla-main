import { supabase } from './supabase';

/**
 * Casual Eats Card — flat single-place format returned by discover-casual-eats edge function.
 */
export interface CasualEatsCard {
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

export interface DiscoverCasualEatsParams {
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

class CasualEatsCardsService {
  async discoverCasualEats(params: DiscoverCasualEatsParams): Promise<CasualEatsCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-casual-eats', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as CasualEatsCard[];
  }

  /** Pre-warm the casual eats card pool in the background (fire-and-forget) */
  async warmCasualEatsPool(params: Omit<DiscoverCasualEatsParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-casual-eats', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const casualEatsCardsService = new CasualEatsCardsService();
