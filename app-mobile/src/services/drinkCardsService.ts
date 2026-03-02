import { supabase } from './supabase';

/**
 * Drink Card — flat single-place format returned by discover-drink edge function.
 */
export interface DrinkCard {
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

export interface DiscoverDrinkParams {
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

class DrinkCardsService {
  async discoverDrink(params: DiscoverDrinkParams): Promise<DrinkCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-drink', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as DrinkCard[];
  }

  /** Pre-warm the drink card pool in the background (fire-and-forget) */
  async warmDrinkPool(params: Omit<DiscoverDrinkParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-drink', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const drinkCardsService = new DrinkCardsService();
