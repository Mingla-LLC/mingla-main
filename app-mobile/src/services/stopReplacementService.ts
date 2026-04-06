import { supabase } from './supabase';
import type { StopAlternative } from '../utils/mutateCuratedCard';

interface GetAlternativesParams {
  categoryId: string;
  location: { lat: number; lng: number };
  travelMode: string;
  budgetMax: number;
  excludePlaceIds: string[];
  siblingStops: Array<{ lat: number; lng: number }>;
  limit?: number;
}

interface AlternativesResponse {
  alternatives: StopAlternative[];
  meta: {
    totalAvailable: number;
    categoryId: string;
  };
}

class StopReplacementService {
  async getAlternatives(params: GetAlternativesParams): Promise<StopAlternative[]> {
    const { data, error } = await supabase.functions.invoke('replace-curated-stop', {
      body: {
        categoryId: params.categoryId,
        location: params.location,
        travelMode: params.travelMode,
        budgetMax: params.budgetMax,
        excludePlaceIds: params.excludePlaceIds,
        siblingStops: params.siblingStops,
        limit: params.limit ?? 10,
      },
    });

    if (error) {
      throw new Error(`Failed to fetch alternatives: ${error.message}`);
    }

    const response = data as AlternativesResponse;

    // Supabase JS SDK v2 does NOT set `error` for HTTP 4xx/5xx from edge functions —
    // it returns the parsed JSON body as `data` with `error = null`.
    // Check for error in the response body itself.
    if ((response as any)?.error && typeof (response as any).error === 'string') {
      throw new Error((response as any).error);
    }

    if (!response?.alternatives) {
      return [];
    }

    return response.alternatives;
  }
}

export const stopReplacementService = new StopReplacementService();
