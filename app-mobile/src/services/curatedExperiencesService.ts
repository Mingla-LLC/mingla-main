import { supabase, trackedInvoke } from './supabase';
import type { CuratedExperienceCard, CuratedSummary } from '../types/curatedExperience';
import { createCuratedRequestGate } from './curatedRequestGate';
import { useAppStore } from '../store/appStore';

interface GenerateCuratedParams {
  experienceType: 'adventurous' | 'first-date' | 'romantic' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
  location: { lat: number; lng: number };
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  // ORCH-1113 [curated-experience-empty-deck-regression]: the user's date choice
  // ("Now/Today/This Weekend/Pick a Date") + any picked dates. Threaded to the
  // edge fn so the open-hours cascade honors the date option (live clock for
  // today) instead of the stale stored datetime_pref.
  dateOption?: string;
  selectedDates?: string[] | null;
  limit?: number;
  skipDescriptions?: boolean;
  sessionId?: string;
  batchSeed?: number;
  selectedCategories?: string[];
  // Issue #4275: which client path started this call, logged by the function so
  // the next burst can be attributed.
  source?: 'deck' | 'map';
  // #4347: the viewer's currency, so brand experiences on the curated path
  // carry their price converted from the host's currency (never sent as a
  // default: absent = the app shows the host's own currency).
  displayCurrency?: string;
}

// ORCH-0677 RC-2: return shape now carries optional `summary` so deckService
// can route curated-only empty results to the mobile EMPTY UI state. Legacy
// edge fn responses without `summary` are treated as `pool_empty` upstream.
export interface CuratedResponse {
  cards: CuratedExperienceCard[];
  summary?: CuratedSummary;
}

// Issue #4275: at most CURATED_MAX_CONCURRENT calls in flight per device, and
// identical requests share one call. This is the only path to the function
// from the app. The key carries the user, and sign-out resets it (authCleanup), so one
// account can never share another's in-flight answer.
const curatedGate = createCuratedRequestGate<CuratedResponse>();

export function resetCuratedRequests(): void {
  curatedGate.reset();
}

class CuratedExperiencesService {
  async generateCuratedExperiences(params: GenerateCuratedParams): Promise<CuratedResponse> {
    const { sessionId, selectedCategories, dateOption, selectedDates, ...edgeParams } = params;
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
    // ORCH-1113: forward date context only when present (don't send undefined /
    // empty). The edge fn defaults dateOption→undefined (→ live-clock 'today'
    // policy) and selectedDates→null when omitted.
    if (dateOption) {
      body.dateOption = dateOption;
    }
    if (selectedDates && selectedDates.length > 0) {
      body.selectedDates = selectedDates;
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
    return curatedGate.run(JSON.stringify([useAppStore.getState().user?.id ?? null, body]), async () => {
      const { data, error } = await trackedInvoke('generate-curated-experiences', { body });
      if (error) throw error;
      const cards = (data?.cards ?? []) as CuratedExperienceCard[];
      const summary = data?.summary as CuratedSummary | undefined;
      return { cards, summary };
    });
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
