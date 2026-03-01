/**
 * Unified Deck Service — single entry point for the solo swipeable deck.
 *
 * Multi-pill parallel pipeline: resolves user's selections into independent
 * "pills" (Nature, solo-adventure, romantic, etc.), fetches ALL pills in
 * parallel via Promise.all, then round-robin interleaves the results.
 *
 * Latency = max(pill1, pill2, ...) — NOT sum(). Graceful degradation:
 * if one pill fails, the others still serve cards.
 */
import { natureCardsService } from './natureCardsService';
import { curatedExperiencesService } from './curatedExperiencesService';
import {
  separateIntentsAndCategories,
  natureToRecommendation,
  curatedToRecommendation,
  roundRobinInterleave,
} from '../utils/cardConverters';
import type { Recommendation } from '../types/recommendation';

export interface DeckParams {
  location: { lat: number; lng: number };
  categories: string[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed?: number;
  limit?: number;
}

export interface DeckResponse {
  cards: Recommendation[];
  deckMode: 'nature' | 'curated' | 'mixed';
  activePills: string[];
  total: number;
}

interface DeckPill {
  id: string;
  type: 'category' | 'curated';
}

class DeckService {
  private resolvePills(categories: string[]): {
    pills: DeckPill[];
    categoryFilters: string[];
  } {
    const { intents, categories: cats } = separateIntentsAndCategories(categories);
    const pills: DeckPill[] = [];
    const categoryFilters: string[] = [];

    // Category pills — currently only Nature has its own edge function
    for (const cat of cats) {
      if (cat.toLowerCase() === 'nature') {
        pills.push({ id: 'nature', type: 'category' });
      } else {
        // No dedicated edge function yet — pass as filter to curated pills
        categoryFilters.push(cat);
      }
    }

    // Intent pills — one curated pill per selected intent
    for (const intent of intents) {
      pills.push({ id: intent, type: 'curated' });
    }

    // Fallback: if nothing resolved, default to solo-adventure
    if (pills.length === 0) {
      pills.push({ id: 'solo-adventure', type: 'curated' });
    }

    return { pills, categoryFilters };
  }

  async fetchDeck(params: DeckParams): Promise<DeckResponse> {
    const { pills, categoryFilters } = this.resolvePills(params.categories);
    const limit = params.limit ?? 20;
    const perPillLimit = Math.ceil(limit / pills.length);

    // Fetch ALL pills in parallel — latency = max(pill), not sum(pill)
    const results = await Promise.all(
      pills.map(async (pill): Promise<Recommendation[]> => {
        try {
          if (pill.type === 'category') {
            const cards = await natureCardsService.discoverNature({
              location: params.location,
              budgetMax: params.budgetMax,
              travelMode: params.travelMode,
              travelConstraintType: params.travelConstraintType,
              travelConstraintValue: params.travelConstraintValue,
              datetimePref: params.datetimePref,
              dateOption: params.dateOption,
              timeSlot: params.timeSlot,
              batchSeed: params.batchSeed,
              limit: perPillLimit,
            });
            return cards.map(natureToRecommendation);
          } else {
            const cards = await curatedExperiencesService.generateCuratedExperiences({
              experienceType: pill.id as any,
              location: params.location,
              budgetMin: params.budgetMin,
              budgetMax: params.budgetMax,
              travelMode: params.travelMode,
              travelConstraintType: params.travelConstraintType,
              travelConstraintValue: params.travelConstraintValue,
              datetimePref: params.datetimePref,
              batchSeed: params.batchSeed,
              selectedCategories: categoryFilters.length > 0 ? categoryFilters : undefined,
              limit: perPillLimit,
              skipDescriptions: true,
            });
            return cards.map(curatedToRecommendation);
          }
        } catch (err) {
          console.warn(`[DeckService] Pill ${pill.id} failed:`, err);
          return []; // Graceful degradation
        }
      })
    );

    const interleaved = roundRobinInterleave(results);

    const deckMode: DeckResponse['deckMode'] =
      pills.length === 1
        ? (pills[0].type === 'category' ? 'nature' : 'curated')
        : 'mixed';

    return {
      cards: interleaved,
      deckMode,
      activePills: pills.map(p => p.id),
      total: interleaved.length,
    };
  }

  /** Pre-warm ALL active pill pools in parallel */
  async warmDeckPool(params: Omit<DeckParams, 'limit' | 'batchSeed'>): Promise<void> {
    const { pills } = this.resolvePills(params.categories);

    await Promise.all(
      pills.map(async (pill) => {
        try {
          if (pill.type === 'category') {
            await natureCardsService.warmNaturePool({
              location: params.location,
              budgetMax: params.budgetMax,
              travelMode: params.travelMode,
              travelConstraintType: params.travelConstraintType,
              travelConstraintValue: params.travelConstraintValue,
              datetimePref: params.datetimePref,
              dateOption: params.dateOption,
              timeSlot: params.timeSlot,
            });
          } else {
            await curatedExperiencesService.warmPool({
              experienceType: pill.id as any,
              location: params.location,
              budgetMax: params.budgetMax,
              travelMode: params.travelMode,
              travelConstraintType: params.travelConstraintType as string,
              travelConstraintValue: params.travelConstraintValue,
            });
          }
        } catch {
          // Silent — non-critical background operation
        }
      })
    );
  }
}

export const deckService = new DeckService();
