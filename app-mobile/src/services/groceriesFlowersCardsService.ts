import { supabase } from './supabase';

/**
 * Groceries & Flowers Card — flat single-place format returned by discover-experiences edge function
 * with categories=["Groceries & Flowers"].
 */
export interface GroceriesFlowersCard {
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

export interface DiscoverGroceriesFlowersParams {
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

class GroceriesFlowersCardsService {
  async discoverGroceriesFlowers(params: DiscoverGroceriesFlowersParams): Promise<GroceriesFlowersCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-experiences', {
      body: { ...params, categories: ['Groceries & Flowers'] },
    });
    if (error) throw error;
    return (data?.cards ?? []) as GroceriesFlowersCard[];
  }

  /** Pre-warm the groceries & flowers card pool in the background (fire-and-forget) */
  async warmGroceriesFlowersPool(params: Omit<DiscoverGroceriesFlowersParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-experiences', {
        body: { ...params, categories: ['Groceries & Flowers'], warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const groceriesFlowersCardsService = new GroceriesFlowersCardsService();
