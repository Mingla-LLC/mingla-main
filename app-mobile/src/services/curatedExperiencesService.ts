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
  limit?: number;
}

class CuratedExperiencesService {
  async generateCuratedExperiences(params: GenerateCuratedParams): Promise<CuratedExperienceCard[]> {
    const { data, error } = await supabase.functions.invoke('generate-curated-experiences', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as CuratedExperienceCard[];
  }
}

export const curatedExperiencesService = new CuratedExperiencesService();
