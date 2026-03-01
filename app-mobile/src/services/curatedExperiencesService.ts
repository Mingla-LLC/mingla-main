import { supabase } from './supabase';
import type { CuratedExperienceCard } from '../types/curatedExperience';

interface GenerateCuratedParams {
  experienceType: 'solo-adventure' | 'first-dates' | 'romantic' | 'friendly' | 'group-fun';
  location: { lat: number; lng: number };
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
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
    const { sessionId, ...edgeParams } = params;
    const { data, error } = await supabase.functions.invoke('generate-curated-experiences', {
      body: { ...edgeParams, session_id: sessionId },
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
