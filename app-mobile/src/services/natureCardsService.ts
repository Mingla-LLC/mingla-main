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

interface DiscoverNatureParams {
  location: { lat: number; lng: number };
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
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
}

export const natureCardsService = new NatureCardsService();
