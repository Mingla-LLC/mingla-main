import { supabase } from './supabase';

/**
 * Work & Business Card — flat single-place format returned by discover-experiences edge function
 * with categories=["Work & Business"].
 */
export interface WorkBusinessCard {
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

export interface DiscoverWorkBusinessParams {
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

class WorkBusinessCardsService {
  async discoverWorkBusiness(params: DiscoverWorkBusinessParams): Promise<WorkBusinessCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-experiences', {
      body: { ...params, categories: ['Work & Business'] },
    });
    if (error) throw error;
    return (data?.cards ?? []) as WorkBusinessCard[];
  }

  async warmWorkBusinessPool(params: Omit<DiscoverWorkBusinessParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-experiences', {
        body: { ...params, categories: ['Work & Business'], warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const workBusinessCardsService = new WorkBusinessCardsService();
