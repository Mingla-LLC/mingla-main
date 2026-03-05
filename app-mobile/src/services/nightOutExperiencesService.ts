import { supabase } from "./supabase";

export interface NightOutVenue {
  id: string;
  eventName: string;
  artistName: string;
  venueName: string;
  image: string;
  images: string[];
  priceMin: number | null;
  priceMax: number | null;
  priceCurrency: string;
  price: string;
  date: string;
  time: string;
  localDate: string;
  dateTimeUTC: string;
  location: string;
  address: string;
  coordinates: { lat: number; lng: number };
  genre: string;
  subGenre: string;
  tags: string[];
  ticketUrl: string;
  ticketStatus: string;
  distance?: number;
  seatMapUrl?: string;
}

export interface EventsMeta {
  totalResults: number;
  page: number;
  pageSize: number;
  totalPages: number;
  fromCache: boolean;
  keywords: string[];
}

/**
 * Service to fetch real Ticketmaster events for Night Out tab.
 * Replaces the old Google Places + OpenAI night-out-experiences flow.
 */
export class NightOutExperiencesService {
  /**
   * Fetch real events from Ticketmaster via the ticketmaster-events edge function
   */
  static async getEvents(
    location: { lat: number; lng: number },
    options?: {
      radius?: number;
      keywords?: string[];
      startDate?: string;
      endDate?: string;
      sort?: string;
      page?: number;
    }
  ): Promise<{ events: NightOutVenue[]; meta: EventsMeta }> {
    try {
      console.log("[NightOutService] Fetching Ticketmaster events:", location);

      const { data, error } = await supabase.functions.invoke(
        "ticketmaster-events",
        {
          body: {
            location,
            radius: options?.radius || 50,
            keywords: options?.keywords || [],
            startDate: options?.startDate,
            endDate: options?.endDate,
            sort: options?.sort || "date,asc",
            page: options?.page || 0,
            size: 20,
          },
        }
      );

      if (error) {
        console.error("[NightOutService] Error:", error);
        throw new Error(`Failed to fetch events: ${error.message}`);
      }

      if (!data || !data.events) {
        console.log("[NightOutService] No events returned");
        return {
          events: [],
          meta: {
            totalResults: 0,
            page: 0,
            pageSize: 20,
            totalPages: 0,
            fromCache: false,
            keywords: options?.keywords || [],
          },
        };
      }

      console.log(
        `[NightOutService] Received ${data.events.length} events (fromCache: ${data.meta?.fromCache})`
      );
      return { events: data.events as NightOutVenue[], meta: data.meta as EventsMeta };
    } catch (error) {
      console.error("[NightOutService] Failed:", error);
      throw error;
    }
  }
}
