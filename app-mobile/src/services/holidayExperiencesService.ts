import { supabase } from "./supabase";

export interface HolidayExperience {
  id: string;
  name: string;
  category: string;
  location: { lat: number; lng: number };
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
  images: string[];
  placeId: string;
  priceLevel: number;
}

export interface HolidayWithExperiences {
  id: string;
  name: string;
  description: string;
  date: string; // ISO date string
  daysAway: number;
  primaryCategory: string;
  categories: string[];
  gender: "male" | "female" | null;
  experiences: HolidayExperience[];
  isCustom?: boolean; // true if this is a custom holiday
}

export interface CustomHolidayInput {
  id: string;
  name: string;
  description: string;
  date: string; // ISO date string
  category: string;
}

export interface HolidayExperiencesResponse {
  holidays: HolidayWithExperiences[];
  customHolidays?: HolidayWithExperiences[];
  meta: {
    totalHolidays: number;
    totalCustomHolidays?: number;
    daysAhead: number;
    gender: "male" | "female" | null;
  };
}

export interface HolidayExperiencesRequest {
  location: { lat: number; lng: number };
  radius?: number;
  gender?: "male" | "female" | null;
  days?: number;
  customHolidays?: CustomHolidayInput[];
}

/**
 * Service to fetch holiday-specific experiences from the backend
 */
export class HolidayExperiencesService {
  /**
   * Fetch holidays with experiences for the given location and filters
   */
  static async getHolidayExperiences(
    request: HolidayExperiencesRequest
  ): Promise<HolidayExperiencesResponse> {
    try {
      console.log("[HolidayExperiencesService] Fetching holiday experiences:", request);

      const { data, error } = await supabase.functions.invoke(
        "holiday-experiences",
        {
          body: {
            location: request.location,
            radius: request.radius || 10000,
            gender: request.gender || null,
            days: request.days || 90,
            customHolidays: request.customHolidays || [],
          },
        }
      );

      if (error) {
        console.error("[HolidayExperiencesService] Error fetching holiday experiences:", error);
        throw new Error(`Failed to fetch holiday experiences: ${error.message}`);
      }

      if (!data) {
        console.warn("[HolidayExperiencesService] No data returned");
        return {
          holidays: [],
          meta: {
            totalHolidays: 0,
            daysAhead: request.days || 90,
            gender: request.gender || null,
          },
        };
      }

      console.log(`[HolidayExperiencesService] Received ${data.holidays?.length || 0} holidays`);
      return data as HolidayExperiencesResponse;
    } catch (error) {
      console.error("[HolidayExperiencesService] Exception:", error);
      throw error;
    }
  }
}
