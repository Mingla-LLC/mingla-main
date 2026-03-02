import { supabase } from './supabase';

/**
 * Creative Arts Card — flat single-place format returned by discover-creative-arts edge function.
 */
export interface CreativeArtsCard {
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

export interface DiscoverCreativeArtsParams {
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

class CreativeArtsCardsService {
  async discoverCreativeArts(params: DiscoverCreativeArtsParams): Promise<CreativeArtsCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-creative-arts', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as CreativeArtsCard[];
  }

  /** Pre-warm the creative arts card pool in the background (fire-and-forget) */
  async warmCreativeArtsPool(params: Omit<DiscoverCreativeArtsParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-creative-arts', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const creativeArtsCardsService = new CreativeArtsCardsService();
