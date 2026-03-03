/**
 * Unified Deck Service — single entry point for the solo swipeable deck.
 *
 * Pipeline (after rewrite):
 *   1. Resolve user preferences into pills (category + curated)
 *   2. ALL category pills → 1 HTTP call to discover-cards (not 11 separate calls)
 *   3. Curated pills → still use generate-curated-experiences (multi-stop itineraries)
 *   4. Round-robin interleave results from both pipelines
 *
 * Performance: 1 HTTP call + 0-N curated calls, down from 11+ HTTP calls.
 * Latency: <500ms from pool, <2s from Google API cold start.
 */
import { supabase } from './supabase';
import { curatedExperiencesService } from './curatedExperiencesService';
import {
  separateIntentsAndCategories,
  curatedToRecommendation,
  roundRobinInterleave,
} from '../utils/cardConverters';
import { getCategoryIcon } from '../utils/categoryUtils';
import type { Recommendation } from '../types/recommendation';

export interface DeckParams {
  location: { lat: number; lng: number };
  categories: string[];
  intents?: string[];
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
  deckMode: 'nature' | 'first_meet' | 'picnic_park' | 'drink' | 'casual_eats' | 'fine_dining' | 'watch' | 'creative_arts' | 'play' | 'wellness' | 'groceries_flowers' | 'work_business' | 'curated' | 'mixed';
  activePills: string[];
  total: number;
  hasMore: boolean;
}

interface DeckPill {
  id: string;
  type: 'category' | 'curated';
}

// ── Pill ID → display name for the unified edge function ─────────────────
const PILL_TO_CATEGORY_NAME: Record<string, string> = {
  nature: 'Nature',
  first_meet: 'First Meet',
  picnic_park: 'Picnic',
  drink: 'Drink',
  casual_eats: 'Casual Eats',
  fine_dining: 'Fine Dining',
  watch: 'Watch',
  creative_arts: 'Creative & Arts',
  play: 'Play',
  wellness: 'Wellness',
  groceries_flowers: 'Groceries & Flowers',
  work_business: 'Work & Business',
};

/**
 * Generic converter: transforms a card from the unified discover-cards edge function
 * into a Recommendation. The card already includes `category` so we derive the
 * icon and experienceType dynamically.
 */
function unifiedCardToRecommendation(card: any): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  const category = card.category || 'Nature';
  const experienceType = category.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');

  return {
    id: card.id,
    title: card.title,
    category,
    categoryIcon: getCategoryIcon(category) || 'compass',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images?.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType,
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: card.openingHours && Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel].filter(Boolean),
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

class DeckService {
  private resolvePills(categories: string[], dedicatedIntents?: string[]): {
    pills: DeckPill[];
    categoryFilters: string[];
  } {
    // If dedicatedIntents is provided (new DB schema), use it directly.
    // Otherwise, fall back to parsing the mixed categories array (backwards compat).
    const { intents: parsedIntents, categories: parsedCats } = separateIntentsAndCategories(categories);
    const intents = dedicatedIntents && dedicatedIntents.length > 0 ? dedicatedIntents : parsedIntents;
    const cats = dedicatedIntents && dedicatedIntents.length > 0 ? categories : parsedCats;
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
      'work & business': 'work_business',
      'work_business': 'work_business',
      'work business': 'work_business',
      'work and business': 'work_business',
      // Legacy category names (pre-v2) → map to current slugs
      'play & move': 'play',
      'play and move': 'play',
      'stroll': 'nature',
      'sip & chill': 'drink',
      'sip and chill': 'drink',
      'dining': 'fine_dining',
      'screen & relax': 'watch',
      'screen and relax': 'watch',
      'creative & hands-on': 'creative_arts',
      'creative and hands-on': 'creative_arts',
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

    // If we have curated intent pills but no category pills, add default categories
    // so the user always gets single-place cards alongside curated itineraries.
    const hasCategoryPill = pills.some(p => p.type === 'category');
    if (!hasCategoryPill) {
      const DEFAULT_CATEGORIES = ['nature', 'casual_eats', 'drink'];
      for (const cat of DEFAULT_CATEGORIES) {
        pills.push({ id: cat, type: 'category' });
      }
    }

    // Final fallback: if STILL nothing (shouldn't happen), add defaults
    if (pills.length === 0) {
      pills.push({ id: 'nature', type: 'category' });
      pills.push({ id: 'casual_eats', type: 'category' });
      pills.push({ id: 'drink', type: 'category' });
    }

    return { pills, categoryFilters };
  }

  async fetchDeck(params: DeckParams): Promise<DeckResponse> {
    const { pills, categoryFilters } = this.resolvePills(params.categories, params.intents);
    const limit = params.limit ?? 20;
    let hasMoreFromEdge = true;

    if (__DEV__) {
      console.log('[DeckService] Input categories:', JSON.stringify(params.categories));
      console.log('[DeckService] Resolved pills:', JSON.stringify(pills));
      if (categoryFilters.length > 0) {
        console.log('[DeckService] Category filters:', JSON.stringify(categoryFilters));
      }
    }

    const categoryPills = pills.filter(p => p.type === 'category');
    const curatedPills = pills.filter(p => p.type === 'curated');
    const fetchStart = Date.now();

    // ── Build parallel fetch promises ──────────────────────────────────
    const categoryPromise: Promise<Recommendation[]> = (async () => {
      if (categoryPills.length === 0) return [];
      try {
        const categoryNames = categoryPills.map(p =>
          PILL_TO_CATEGORY_NAME[p.id] || p.id
        );
        const categoryLimit = Math.ceil(limit * (categoryPills.length / pills.length));

        try {
          // supabase.functions.invoke() does not accept an AbortSignal.
          // Use Promise.race to enforce 15s timeout.
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => {
              const err = new Error('discover-cards timed out after 15s');
              err.name = 'AbortError';
              reject(err);
            }, 15000)
          );

          const { data, error } = await Promise.race([
            supabase.functions.invoke('discover-cards', {
              body: {
                categories: categoryNames,
                location: params.location,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
                batchSeed: params.batchSeed,
                limit: categoryLimit,
              },
            }),
            timeoutPromise,
          ]);

          if (!error && data?.cards) {
            const cards = (data.cards as any[]).map(unifiedCardToRecommendation);
            hasMoreFromEdge = data.metadata?.hasMore ?? true;
            if (__DEV__) {
              console.log(`[DeckService] discover-cards → ${cards.length} cards (source: ${data.source}, hasMore: ${hasMoreFromEdge})`);
            }
            return cards;
          } else {
            if (__DEV__) console.warn('[DeckService] discover-cards error:', error);
            return [];
          }
        } catch (err) {
          if ((err as any)?.name === 'AbortError') {
            console.warn('[DeckService] discover-cards timed out after 15s');
          } else {
            console.warn('[DeckService] discover-cards failed:', (err as any)?.message || err);
          }
          return [];
        }
      } catch (err) {
        console.warn('[DeckService] discover-cards outer error:', (err as any)?.message || err);
        return [];
      }
    })();

    const curatedPromise: Promise<Recommendation[][]> = (async () => {
      if (curatedPills.length === 0) return [];
      return Promise.all(
        curatedPills.map(async (pill): Promise<Recommendation[]> => {
          try {
            const curatedLimit = Math.ceil(limit * (1 / pills.length));
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
              limit: curatedLimit,
              skipDescriptions: true,
            });
            if (__DEV__) {
              console.log(`[DeckService] Curated pill "${pill.id}" → ${cards.length} cards`);
            }
            return cards.map(curatedToRecommendation);
          } catch (err) {
            console.warn(`[DeckService] Curated pill ${pill.id} failed:`, err);
            return [];
          }
        })
      );
    })();

    // ── Run BOTH pipelines in parallel ─────────────────────────────────
    const [categoryResult, curatedResult] = await Promise.allSettled([
      categoryPromise,
      curatedPromise,
    ]);

    const results: Recommendation[][] = [];

    if (categoryResult.status === 'fulfilled' && categoryResult.value.length > 0) {
      // Group by category for per-category round-robin
      const byCategory: Record<string, Recommendation[]> = {};
      for (const card of categoryResult.value) {
        const cat = card.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(card);
      }
      for (const group of Object.values(byCategory)) {
        results.push(group);
      }
    }
    if (curatedResult.status === 'fulfilled') {
      results.push(...curatedResult.value);
    }

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
      hasMore: hasMoreFromEdge,
    };
  }

  /** Pre-warm ALL active pill pools — ONE call for categories, individual for curated */
  async warmDeckPool(params: Omit<DeckParams, 'limit' | 'batchSeed'>): Promise<void> {
    const { pills, categoryFilters } = this.resolvePills(params.categories, params.intents);
    const categoryPills = pills.filter(p => p.type === 'category');
    const curatedPills = pills.filter(p => p.type === 'curated');

    const warmPromises: Promise<void>[] = [];

    // ONE warm call for all categories (with 15s timeout)
    if (categoryPills.length > 0) {
      const categoryNames = categoryPills.map(p =>
        PILL_TO_CATEGORY_NAME[p.id] || p.id
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          const err = new Error('discover-cards timed out after 15s');
          err.name = 'AbortError';
          reject(err);
        }, 15000)
      );
      warmPromises.push(
        Promise.race([
          supabase.functions.invoke('discover-cards', {
            body: {
              categories: categoryNames,
              location: params.location,
              budgetMax: params.budgetMax,
              travelMode: params.travelMode,
              travelConstraintType: params.travelConstraintType,
              travelConstraintValue: params.travelConstraintValue,
              datetimePref: params.datetimePref,
              dateOption: params.dateOption,
              timeSlot: params.timeSlot,
              warmPool: true,
              limit: 40,
            },
          }),
          timeoutPromise,
        ]).then(() => {}).catch(() => {})
      );
    }

    // Warm curated pools individually
    for (const pill of curatedPills) {
      warmPromises.push(
        curatedExperiencesService.warmPool({
          experienceType: pill.id as any,
          location: params.location,
          budgetMax: params.budgetMax,
          travelMode: params.travelMode,
          travelConstraintType: params.travelConstraintType as string,
          travelConstraintValue: params.travelConstraintValue,
        }).catch(() => {})
      );
    }

    await Promise.all(warmPromises);
  }
}

export const deckService = new DeckService();
