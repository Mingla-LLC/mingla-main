import { supabase } from './supabase';
import type { CuratedExperienceCard } from '../types/curatedExperience';

interface GenerateCuratedParams {
  experienceType: 'adventurous' | 'first-date' | 'romantic' | 'friendly' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
  location: { lat: number; lng: number };
  budgetMin: number;
  budgetMax: number;
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
    const { data, error } = await supabase.functions.invoke('generate-curated-experiences', {
      body,
    });
    if (error) throw error;
    return (data?.cards ?? []) as CuratedExperienceCard[];
  }

  async warmPool(params: {
    experienceType: string;
    location: { lat: number; lng: number };
    budgetMax: number;
    travelMode: string;
    travelConstraintType: string;
    travelConstraintValue: number;
  }): Promise<void> {
    try {
      await supabase.functions.invoke('generate-curated-experiences', {
        body: {
          experienceType: params.experienceType,
          location: params.location,
          budgetMax: params.budgetMax,
          travelMode: params.travelMode,
          travelConstraintType: params.travelConstraintType,
          travelConstraintValue: params.travelConstraintValue,
          warmPool: true,
          limit: 40,
        },
      });
    } catch (err) {
      // Fire and forget — don't throw
      console.warn('[warmPool] Failed:', err);
    }
  }
}

export const curatedExperiencesService = new CuratedExperiencesService();
