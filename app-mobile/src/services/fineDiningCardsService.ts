import { supabase } from './supabase';

/**
 * Fine Dining Card — flat single-place format returned by discover-fine-dining edge function.
 */
export interface FineDiningCard {
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

export interface DiscoverFineDiningParams {
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

class FineDiningCardsService {
  async discoverFineDining(params: DiscoverFineDiningParams): Promise<FineDiningCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-fine-dining', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as FineDiningCard[];
  }

  /** Pre-warm the fine dining card pool in the background (fire-and-forget) */
  async warmFineDiningPool(params: Omit<DiscoverFineDiningParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-fine-dining', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const fineDiningCardsService = new FineDiningCardsService();
