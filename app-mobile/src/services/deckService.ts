/**
 * Unified Deck Service — single entry point for the solo swipeable deck.
 *
 * Routes to existing edge functions (discover-nature / generate-curated-experiences)
 * based on user preferences. The client has one service call, one response shape.
 *
 * This replaces the 7-hook orchestra with a single deterministic pipeline:
 * 1. Parse categories → determine deckMode (nature vs curated)
 * 2. Call the appropriate edge function(s)
 * 3. Return unified response with deckMode discriminator
 */
import { natureCardsService } from './natureCardsService';
import type { NatureCard } from './natureCardsService';
import { curatedExperiencesService } from './curatedExperiencesService';
import type { CuratedExperienceCard } from '../types/curatedExperience';
import { separateIntentsAndCategories, isNatureMode, shuffleArray } from '../utils/cardConverters';

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
  cards: NatureCard[] | CuratedExperienceCard[];
  deckMode: 'nature' | 'curated';
  total: number;
}

class DeckService {
  async fetchDeck(params: DeckParams): Promise<DeckResponse> {
    const { intents, categories } = separateIntentsAndCategories(params.categories);
    const isNature = isNatureMode(params.categories);

    if (isNature) {
      return this.fetchNatureDeck(params);
    } else {
      return this.fetchCuratedDeck(params, intents, categories);
    }
  }

  private async fetchNatureDeck(params: DeckParams): Promise<DeckResponse> {
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
      limit: params.limit ?? 20,
    });

    return {
      cards,
      deckMode: 'nature',
      total: cards.length,
    };
  }

  private async fetchCuratedDeck(
    params: DeckParams,
    intents: string[],
    categories: string[]
  ): Promise<DeckResponse> {
    // Default to solo-adventure if no intents selected
    const activeTypes = intents.length > 0 ? intents : ['solo-adventure'];
    const limit = params.limit ?? 20;
    const perTypeLimit = Math.ceil(limit / activeTypes.length);

    // Fetch all active types in parallel
    const results = await Promise.all(
      activeTypes.map(type =>
        curatedExperiencesService.generateCuratedExperiences({
          experienceType: type as any,
          location: params.location,
          budgetMin: params.budgetMin,
          budgetMax: params.budgetMax,
          travelMode: params.travelMode,
          travelConstraintType: params.travelConstraintType,
          travelConstraintValue: params.travelConstraintValue,
          datetimePref: params.datetimePref,
          batchSeed: params.batchSeed,
          selectedCategories: categories.length > 0 ? categories : undefined,
          limit: perTypeLimit,
          skipDescriptions: true,
        }).catch(err => {
          console.warn(`[DeckService] Failed to fetch ${type}:`, err);
          return [] as CuratedExperienceCard[];
        })
      )
    );

    // Merge all types, shuffle, and limit to requested count
    const allCards = results.flat();
    const shuffled = shuffleArray(allCards).slice(0, limit);

    return {
      cards: shuffled,
      deckMode: 'curated',
      total: allCards.length,
    };
  }

  /** Pre-warm the appropriate pool based on preferences */
  async warmDeckPool(params: Omit<DeckParams, 'limit' | 'batchSeed'>): Promise<void> {
    const isNature = isNatureMode(params.categories);

    try {
      if (isNature) {
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
          experienceType: 'solo-adventure',
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
  }
}

export const deckService = new DeckService();
