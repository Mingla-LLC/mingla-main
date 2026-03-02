import { supabase } from './supabase';

/**
 * First Meet Card — flat single-place format returned by discover-first-meet edge function.
 */
export interface FirstMeetCard {
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

export interface DiscoverFirstMeetParams {
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

class FirstMeetCardsService {
  async discoverFirstMeet(params: DiscoverFirstMeetParams): Promise<FirstMeetCard[]> {
    const { data, error } = await supabase.functions.invoke('discover-first-meet', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as FirstMeetCard[];
  }

  /** Pre-warm the first meet card pool in the background (fire-and-forget) */
  async warmFirstMeetPool(params: Omit<DiscoverFirstMeetParams, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-first-meet', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const firstMeetCardsService = new FirstMeetCardsService();
