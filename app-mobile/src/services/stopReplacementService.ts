import { supabase } from './supabase';
import type { StopAlternative } from '../utils/mutateCuratedCard';
import type { StrollData, PicnicData } from '../types/expandedCardTypes';

interface GetAlternativesParams {
  categoryId: string;
  location: { lat: number; lng: number };
  travelMode: string;
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

// ORCH-0640 ch09: moved from experienceGenerationService.ts (DELETED).
// These two methods power the Expanded Card modal's curated-stroll companion + picnic
// grocery-list features. get-companion-stops + get-picnic-grocery edge fns remain KEEP
// (§5.3 audit — implementor verifies their bodies are card_pool-free post-cutover).
interface StrollAnchor {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  address?: string;
}
interface PicnicAnchor {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  address?: string;
  title?: string;
}

class StopReplacementService {
  async fetchCompanionStrollData(anchor: StrollAnchor): Promise<StrollData | null> {
    try {
      const { data, error } = await supabase.functions.invoke('get-companion-stops', { body: { anchor } });
      if (error) { console.error('[stopReplacementService] get-companion-stops error:', error); return null; }
      const typed = data as { strollData?: StrollData } | null;
      return typed?.strollData ?? null;
    } catch (err) {
      console.error('[stopReplacementService] get-companion-stops threw:', err);
      return null;
    }
  }

  async fetchPicnicGroceryData(picnic: PicnicAnchor): Promise<PicnicData | null> {
    try {
      const { data, error } = await supabase.functions.invoke('get-picnic-grocery', { body: { picnic } });
      if (error) { console.error('[stopReplacementService] get-picnic-grocery error:', error); return null; }
      const typed = data as { picnicData?: PicnicData } | null;
      return typed?.picnicData ?? null;
    } catch (err) {
      console.error('[stopReplacementService] get-picnic-grocery threw:', err);
      return null;
    }
  }

  async getAlternatives(params: GetAlternativesParams): Promise<StopAlternative[]> {
    const { data, error } = await supabase.functions.invoke('replace-curated-stop', {
      body: {
        categoryId: params.categoryId,
        location: params.location,
        travelMode: params.travelMode,
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
