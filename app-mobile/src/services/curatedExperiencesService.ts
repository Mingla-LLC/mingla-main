import { supabase, trackedInvoke } from './supabase';
import type { CuratedExperienceCard } from '../types/curatedExperience';

interface GenerateCuratedParams {
  experienceType: 'adventurous' | 'first-date' | 'romantic' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
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

    // 15s timeout: generate-curated-experiences is DB-only (~1-3s warm) but Deno
    // isolate cold start adds 4-9s on first invocation. 15s accommodates cold start.
    // Do NOT reduce below 10s without verifying cold-start latency. See ORCH-0342.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('generate-curated-experiences timed out after 15s');
        err.name = 'AbortError';
        reject(err);
      }, 15000);
    });

    try {
      const { data, error } = await Promise.race([
        trackedInvoke('generate-curated-experiences', { body }),
        timeoutPromise,
      ]);
      if (error) throw error;
      return (data?.cards ?? []) as CuratedExperienceCard[];
    } finally {
      clearTimeout(timer);
    }
  }

  async warmPool(params: {
    experienceType: string;
    location: { lat: number; lng: number };
    budgetMax: number;
    travelMode: string;
    travelConstraintType: string;
    travelConstraintValue: number;
  }): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 15s timeout: warm pool may hit cold Deno isolate. See ORCH-0342.
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('generate-curated-experiences warmPool timed out after 15s');
          err.name = 'AbortError';
          reject(err);
        }, 15000);
      });

      await Promise.race([
        trackedInvoke('generate-curated-experiences', {
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
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      // Fire and forget — don't throw. AbortError from timeout is expected under slow network.
      console.warn('[warmPool] Failed:', err);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const curatedExperiencesService = new CuratedExperiencesService();
