import { supabase } from "./supabase";

export interface NightOutVenue {
  id: string;
  placeName: string;
  eventName: string;
  hostName: string;
  image: string;
  images: string[];
  price: string;
  matchPercentage: number;
  date: string;
  time: string;
  timeRange: string;
  location: string;
  tags: string[];
  musicGenre: string;
  peopleGoing: number;
  address: string;
  description: string;
  rating: number;
  reviewCount: number;
  coordinates: { lat: number; lng: number };
  distance?: string;
  travelTime?: string;
}

export interface NightOutResponse {
  venues: NightOutVenue[];
  meta: {
    totalResults: number;
    totalCandidates: number;
  };
}

/**
 * Service to fetch night-out experiences (clubs, bars, live music, etc.)
 */
export class NightOutExperiencesService {
  /**
   * Fetch night-out venues for the given location
   */
  static async getNightOutVenues(
    location: { lat: number; lng: number },
    radius?: number
  ): Promise<NightOutVenue[]> {
    try {
      console.log("[NightOutService] Fetching night-out venues:", location);

      const { data, error } = await supabase.functions.invoke(
        "night-out-experiences",
        {
          body: {
            location,
            radius: radius || 10000,
          },
        }
      );

      if (error) {
        console.error("[NightOutService] Error:", error);
        throw new Error(`Failed to fetch night-out venues: ${error.message}`);
      }

      if (!data || !data.venues || data.venues.length === 0) {
        console.log("[NightOutService] No venues returned");
        return [];
      }

      console.log(`[NightOutService] Received ${data.venues.length} venues`);
      return data.venues as NightOutVenue[];
    } catch (error) {
      console.error("[NightOutService] Failed:", error);
      throw error;
    }
  }
}
