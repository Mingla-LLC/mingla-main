import { supabase, trackedInvoke } from './supabase';
import type { CuratedExperienceCard } from '../types/curatedExperience';

interface GenerateCuratedParams {
  experienceType: 'adventurous' | 'first-date' | 'romantic' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
  location: { lat: number; lng: number };
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  limit?: number;
  skipDescriptions?: boolean;
  sessionId?: string;
  batchSeed?: number;
  selectedCategories?: string[];
}

class CuratedExperiencesService {
  async generateCuratedExperiences(params: GenerateCuratedParams): Promise<CuratedExperienceCard[]> {
    const { sessionId, selectedCategories, ...edgeParams } = params;
    const body: Record<string, any> = {
      ...edgeParams,
    };
    // Only include session_id if it's a real session (not solo mode)
    if (sessionId) {
      body.session_id = sessionId;
    }
    // Only include selectedCategories if there are actual filters
    if (selectedCategories && selectedCategories.length > 0) {
      body.selectedCategories = selectedCategories;
    }

    // Timeout handled by global fetchWithTimeout (20s) in supabase.ts.
    // Previous 15s Promise.race wrapper was dead code — the global timeout
    // always fired first. Removed in ORCH-0366.
    //
    // ORCH-0490 Phase 2.2: the 20s ceiling is no longer a UX blocker on the
    // deck-render path. When FEATURE_FLAG_PROGRESSIVE_DELIVERY is true, the
    // fetchDeck race delivers singles (if non-empty and faster) at ~1s while
    // this call can complete up to 20s later — the user sees cards already,
    // and curated merges in when it arrives. On the zero-singles branch,
    // curated delivers as soon as THIS call returns; no 20s dead-wait.
    // The ceiling only matters for curated-only decks; shrinking it further
    // is ORCH-0495 territory (client warm-ping of discover-cards, deferred).
    const { data, error } = await trackedInvoke('generate-curated-experiences', { body });
    if (error) throw error;
    return (data?.cards ?? []) as CuratedExperienceCard[];
  }

  async warmPool(params: {
    experienceType: string;
    location: { lat: number; lng: number };
    travelMode: string;
    travelConstraintType: string;
    travelConstraintValue: number;
  }): Promise<void> {
    try {
      // Timeout handled by global fetchWithTimeout (20s) in supabase.ts.
      // Previous 15s Promise.race wrapper removed in ORCH-0366.
      await trackedInvoke('generate-curated-experiences', {
        body: {
          experienceType: params.experienceType,
          location: params.location,
          travelMode: params.travelMode,
          travelConstraintType: params.travelConstraintType,
          travelConstraintValue: params.travelConstraintValue,
          warmPool: true,
          limit: 40,
        },
      });
    } catch (err) {
      // Fire and forget — don't throw. Timeout errors expected under slow network.
      console.warn('[warmPool] Failed:', err);
    }
  }
}

export const curatedExperiencesService = new CuratedExperiencesService();
