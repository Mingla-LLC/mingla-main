/**
 * Unified Deck Service — single entry point for the solo swipeable deck.
 *
 * Multi-pill parallel pipeline: resolves user's selections into independent
 * "pills" (Nature, adventurous, romantic, etc.), fetches ALL pills in
 * parallel via Promise.all, then round-robin interleaves the results.
 *
 * Latency = max(pill1, pill2, ...) — NOT sum(). Graceful degradation:
 * if one pill fails, the others still serve cards.
 */
import { natureCardsService } from './natureCardsService';
import { firstMeetCardsService } from './firstMeetCardsService';
import { picnicParkCardsService } from './picnicParkCardsService';
import { curatedExperiencesService } from './curatedExperiencesService';
import { drinkCardsService } from './drinkCardsService';
import { casualEatsCardsService } from './casualEatsCardsService';
import { fineDiningCardsService } from './fineDiningCardsService';
import { watchCardsService } from './watchCardsService';
import { creativeArtsCardsService } from './creativeArtsCardsService';
import { playCardsService } from './playCardsService';
import { wellnessCardsService } from './wellnessCardsService';
import { groceriesFlowersCardsService } from './groceriesFlowersCardsService';
import {
  separateIntentsAndCategories,
  natureToRecommendation,
  firstMeetToRecommendation,
  picnicParkToRecommendation,
  curatedToRecommendation,
  roundRobinInterleave,
  drinkToRecommendation,
  casualEatsToRecommendation,
  fineDiningToRecommendation,
  watchToRecommendation,
  creativeArtsToRecommendation,
  playToRecommendation,
  wellnessToRecommendation,
  groceriesFlowersToRecommendation,
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
  deckMode: 'nature' | 'first_meet' | 'picnic_park' | 'drink' | 'casual_eats' | 'fine_dining' | 'watch' | 'creative_arts' | 'play' | 'wellness' | 'groceries_flowers' | 'curated' | 'mixed';
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

    // Category pills — lookup map handles all format variations (display names,
    // slugs, underscored slugs) so no category silently falls through.
    const CATEGORY_PILL_MAP: Record<string, string> = {
      'nature': 'nature',
      'first meet': 'first_meet',
      'first_meet': 'first_meet',
      'picnic park': 'picnic_park',
      'picnic_park': 'picnic_park',
      'picnic': 'picnic_park',
      'drink': 'drink',
      'casual eats': 'casual_eats',
      'casual_eats': 'casual_eats',
      'fine dining': 'fine_dining',
      'fine_dining': 'fine_dining',
      'watch': 'watch',
      'creative & arts': 'creative_arts',
      'creative arts': 'creative_arts',
      'creative_arts': 'creative_arts',
      'play': 'play',
      'wellness': 'wellness',
      'groceries & flowers': 'groceries_flowers',
      'groceries flowers': 'groceries_flowers',
      'groceries_flowers': 'groceries_flowers',
    };

    for (const cat of cats) {
      const normalized = cat.replace(/_/g, ' ').toLowerCase();
      const pillId = CATEGORY_PILL_MAP[normalized] ?? CATEGORY_PILL_MAP[cat.toLowerCase()];
      if (pillId) {
        pills.push({ id: pillId, type: 'category' });
      } else {
        console.warn(`[DeckService] Unrecognized category: "${cat}" — adding as curated filter`);
        categoryFilters.push(cat);
      }
    }

    // Intent pills — one curated pill per selected intent
    for (const intent of intents) {
      pills.push({ id: intent, type: 'curated' });
    }

    // Fallback: if nothing resolved, default to adventurous
    if (pills.length === 0) {
      pills.push({ id: 'adventurous', type: 'curated' });
    }

    return { pills, categoryFilters };
  }

  async fetchDeck(params: DeckParams): Promise<DeckResponse> {
    const { pills, categoryFilters } = this.resolvePills(params.categories);
    const limit = params.limit ?? 20;
    const perPillLimit = Math.ceil(limit / pills.length);

    // Fetch ALL pills in parallel — latency = max(pill), not sum(pill)
    const fetchStart = Date.now();
    const results = await Promise.all(
      pills.map(async (pill): Promise<Recommendation[]> => {
        try {
          if (pill.type === 'category') {
            if (pill.id === 'first_meet') {
              const cards = await firstMeetCardsService.discoverFirstMeet({
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
              return cards.map(firstMeetToRecommendation);
            } else if (pill.id === 'picnic_park') {
              const cards = await picnicParkCardsService.discoverPicnicPark({
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
              return cards.map(picnicParkToRecommendation);
            } else if (pill.id === 'drink') {
              const cards = await drinkCardsService.discoverDrink({
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
              return cards.map(drinkToRecommendation);
            } else if (pill.id === 'casual_eats') {
              const cards = await casualEatsCardsService.discoverCasualEats({
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
              return cards.map(casualEatsToRecommendation);
            } else if (pill.id === 'fine_dining') {
              const cards = await fineDiningCardsService.discoverFineDining({
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
              return cards.map(fineDiningToRecommendation);
            } else if (pill.id === 'watch') {
              const cards = await watchCardsService.discoverWatch({
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
              return cards.map(watchToRecommendation);
            } else if (pill.id === 'creative_arts') {
              const cards = await creativeArtsCardsService.discoverCreativeArts({
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
              return cards.map(creativeArtsToRecommendation);
            } else if (pill.id === 'play') {
              const cards = await playCardsService.discoverPlay({
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
              return cards.map(playToRecommendation);
            } else if (pill.id === 'wellness') {
              const cards = await wellnessCardsService.discoverWellness({
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
              return cards.map(wellnessToRecommendation);
            } else if (pill.id === 'groceries_flowers') {
              const cards = await groceriesFlowersCardsService.discoverGroceriesFlowers({
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
              return cards.map(groceriesFlowersToRecommendation);
            }
            // Default: Nature
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

    const interleaved = roundRobinInterleave(results).slice(0, limit);

    if (__DEV__) {
      console.log(
        `[DeckService] Fetched ${pills.length} pills in ${Date.now() - fetchStart}ms, ` +
        `${interleaved.length} cards total: ${pills.map(p => p.id).join(', ')}`
      );
    }

    const deckMode: DeckResponse['deckMode'] =
      pills.length === 1
        ? (pills[0].type === 'category'
            ? (pills[0].id as DeckResponse['deckMode'])
            : 'curated')
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
            if (pill.id === 'first_meet') {
              await firstMeetCardsService.warmFirstMeetPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'picnic_park') {
              await picnicParkCardsService.warmPicnicParkPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'drink') {
              await drinkCardsService.warmDrinkPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'casual_eats') {
              await casualEatsCardsService.warmCasualEatsPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'fine_dining') {
              await fineDiningCardsService.warmFineDiningPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'watch') {
              await watchCardsService.warmWatchPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'creative_arts') {
              await creativeArtsCardsService.warmCreativeArtsPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'play') {
              await playCardsService.warmPlayPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'wellness') {
              await wellnessCardsService.warmWellnessPool({
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
              });
            } else if (pill.id === 'groceries_flowers') {
              await groceriesFlowersCardsService.warmGroceriesFlowersPool({
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
            }
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
