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
import { supabase, trackedInvoke } from './supabase';
import { curatedExperiencesService } from './curatedExperiencesService';
import {
  curatedToRecommendation,
  roundRobinInterleave,
} from '../utils/cardConverters';
import { getCategoryIcon } from '../utils/categoryUtils';
import { PriceTierSlug, googleLevelToTierSlug, tierLabel } from '../constants/priceTiers';
import type { Recommendation } from '../types/recommendation';

// ── Warm pool deduplication timestamp ────────────────────────────────────────
let lastWarmPoolTimestamp: number = 0;

export function getLastWarmPoolTimestamp(): number {
  return lastWarmPoolTimestamp;
}

export interface DeckParams {
  location: { lat: number; lng: number };
  categories: string[];
  intents?: string[];
  priceTiers: PriceTierSlug[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed?: number;
  limit?: number;
  excludeCardIds?: string[];
}

export interface DeckResponse {
  cards: Recommendation[];
  deckMode: 'nature' | 'first_meet' | 'picnic_park' | 'drink' | 'casual_eats' | 'fine_dining' | 'watch' | 'live_performance' | 'creative_arts' | 'play' | 'wellness' | 'flowers' | 'curated' | 'mixed';
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
  nature: 'Nature & Views',
  first_meet: 'First Meet',
  picnic_park: 'Picnic Park',
  drink: 'Drink',
  casual_eats: 'Casual Eats',
  fine_dining: 'Fine Dining',
  watch: 'Watch',
  live_performance: 'Live Performance',
  creative_arts: 'Creative & Arts',
  play: 'Play',
  wellness: 'Wellness',
  flowers: 'Flowers',
};

/**
 * Generic converter: transforms a card from the unified discover-cards edge function
 * into a Recommendation. The card already includes `category` so we derive the
 * icon and experienceType dynamically.
 */
export function unifiedCardToRecommendation(card: any): Recommendation {
  // Defensive: ensure numeric fields are never undefined (edge fn may omit them)
  const distanceKm = card.distanceKm ?? 0;
  const travelTimeMin = card.travelTimeMin ?? 0;

  const priceTier: PriceTierSlug = card.priceTier ?? googleLevelToTierSlug(card.priceLevel);
  const priceText = tierLabel(priceTier);

  const category = card.category || 'Nature';
  const experienceType = category.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');

  return {
    id: card.id,
    title: card.title,
    category,
    categoryIcon: getCategoryIcon(category) || 'compass',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${Math.round(travelTimeMin)} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating ?? 0,
    image: card.image,
    images: card.images?.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: distanceKm > 0 ? `${distanceKm.toFixed(1)} km` : '',
    travelTime: travelTimeMin > 0 ? `${Math.round(travelTimeMin)} min` : '',
    travelMode: card.travelMode || undefined,
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
    matchScore: card.matchScore ?? 85,
    reviewCount: card.reviewCount ?? 0,
    website: card.website,
    placeId: card.placeId,
    priceTier,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: (card.rating ?? 0) > 4 ? 0.8 : 0.5,
    },
    oneLiner: card.oneLiner || null,
    tip: card.tip || null,
  };
}

class DeckService {
  private resolvePills(categories: string[], dedicatedIntents?: string[]): {
    pills: DeckPill[];
    categoryFilters: string[];
  } {
    // Post-migration: intents live in their own DB column. No fallback parsing.
    const intents = dedicatedIntents ?? [];
    const cats = categories;
    const pills: DeckPill[] = [];
    const categoryFilters: string[] = [];
    const seenPillIds = new Set<string>();

    // Category pills — lookup map handles all format variations (display names,
    // slugs, underscored slugs) so no category silently falls through.
    const CATEGORY_PILL_MAP: Record<string, string> = {
      'nature': 'nature',
      'nature & views': 'nature',
      'nature_views': 'nature',
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
      'live performance': 'live_performance',
      'live_performance': 'live_performance',
      'flowers': 'flowers',
      // Legacy compat
      'groceries & flowers': 'flowers',
      'groceries flowers': 'flowers',
      'groceries_flowers': 'flowers',
      'work & business': 'first_meet',
      'work_business': 'first_meet',
      'work business': 'first_meet',
      'work and business': 'first_meet',
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
        if (!seenPillIds.has(pillId)) {
          seenPillIds.add(pillId);
          pills.push({ id: pillId, type: 'category' });
        }
      } else {
        console.warn(`[DeckService] Unrecognized category: "${cat}" — adding as curated filter`);
        categoryFilters.push(cat);
      }
    }

    // Intent pills — one curated pill per selected intent (deduplicated)
    for (const intent of intents) {
      const key = `curated:${intent}`;
      if (!seenPillIds.has(key)) {
        seenPillIds.add(key);
        pills.push({ id: intent, type: 'curated' });
      }
    }

    // If both intents and categories are empty, return zero pills.
    // The caller (useDeckCards) should be disabled in this state,
    // but even if reached, an empty deck is correct — never inject defaults.
    if (pills.length === 0) {
      console.warn('[DeckService] Zero pills resolved — both intents and categories empty. Returning empty deck.');
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
        const categoryLimit = limit;

        let fetchTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          // supabase.functions.invoke() does not accept an AbortSignal.
          // Use Promise.race to enforce 15s timeout.
          const timeoutPromise = new Promise<never>((_, reject) => {
            fetchTimer = setTimeout(() => {
              const err = new Error('discover-cards timed out after 15s');
              err.name = 'AbortError';
              reject(err);
            }, 15000);
          });

          const { data, error } = await Promise.race([
            trackedInvoke('discover-cards', {
              body: {
                categories: categoryNames,
                location: params.location,
                priceTiers: params.priceTiers,
                budgetMax: params.budgetMax,
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                timeSlot: params.timeSlot,
                batchSeed: params.batchSeed,
                limit: categoryLimit,
                excludeCardIds: params.excludeCardIds,
              },
            }),
            timeoutPromise,
          ]);

          if (!error && data?.cards) {
            const cards = (data.cards as any[]).map(unifiedCardToRecommendation);
            hasMoreFromEdge = data.metadata?.hasMore ?? true;
            if (__DEV__) {
              console.log(`[DeckService] discover-cards → ${cards.length} cards (source: ${data.source}, hasMore: ${hasMoreFromEdge})`);
              if (data.sourceBreakdown) {
                const sb = data.sourceBreakdown;
                console.log(
                  `[DeckService] SOURCE BREAKDOWN:\n` +
                  `  Path: ${sb.path}\n` +
                  `  From pool: ${sb.fromPool} | From Google API: ${sb.fromApi} | Total served: ${sb.totalServed}\n` +
                  `  Google API calls: ${sb.apiCallsMade} | Cache hits: ${sb.cacheHits}\n` +
                  `  Gap-filled categories: ${sb.gapCategories?.length > 0 ? sb.gapCategories.join(', ') : 'none'}\n` +
                  `  Reason: ${sb.reason}`
                );
              }
            }
            return cards;
          } else {
            const msg = typeof error === 'string' ? error : (error as any)?.message || 'Unknown error';
            console.warn('[DeckService] discover-cards error:', msg);
            throw new Error(`Deck fetch failed: ${msg}`);
          }
        } catch (err) {
          if ((err as any)?.name === 'AbortError') {
            console.warn('[DeckService] discover-cards timed out after 15s');
          } else {
            console.warn('[DeckService] discover-cards failed:', (err as any)?.message || err);
          }
          throw err;
        } finally {
          clearTimeout(fetchTimer);
        }
      } catch (err) {
        console.warn('[DeckService] discover-cards outer error:', (err as any)?.message || err);
        throw err;
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

    // Merge category groups into one "regular" stream via round-robin
    const categoryArrays: Recommendation[][] = [];
    if (categoryResult.status === 'fulfilled' && categoryResult.value.length > 0) {
      const byCategory: Record<string, Recommendation[]> = {};
      for (const card of categoryResult.value) {
        const cat = card.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(card);
      }
      for (const group of Object.values(byCategory)) {
        categoryArrays.push(group);
      }
    }
    const regularStream = roundRobinInterleave(categoryArrays);

    // Merge curated arrays into one "curated" stream via round-robin
    const curatedArrays: Recommendation[][] = [];
    if (curatedResult.status === 'fulfilled') {
      curatedArrays.push(...curatedResult.value);
    }
    const curatedStream = roundRobinInterleave(curatedArrays);

    // If both fetches failed, throw so React Query sees the error
    const regularFailed = categoryResult.status === 'rejected';
    const curatedFailed = curatedResult.status === 'rejected';
    if (regularFailed && curatedFailed) {
      throw (categoryResult as PromiseRejectedResult).reason || new Error('All deck fetches failed');
    }

    // 1:1 interleave: alternate regular and curated
    const interleaved: Recommendation[] = [];
    const maxLen = Math.max(regularStream.length, curatedStream.length);
    const seen = new Set<string>();
    for (let i = 0; i < maxLen && interleaved.length < limit; i++) {
      if (i < regularStream.length) {
        const id = regularStream[i].placeId || regularStream[i].id;
        if (!seen.has(id)) {
          seen.add(id);
          interleaved.push(regularStream[i]);
        }
      }
      if (i < curatedStream.length && interleaved.length < limit) {
        const id = curatedStream[i].id;
        if (!seen.has(id)) {
          seen.add(id);
          interleaved.push(curatedStream[i]);
        }
      }
    }

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

  /** Pre-warm is disabled — pool is now admin-managed, no autonomous Google calls */
  async warmDeckPool(_params: Omit<DeckParams, 'limit' | 'batchSeed'>): Promise<void> {
    lastWarmPoolTimestamp = Date.now();
    // No-op: warm pool concept is dead. Admins manage the pool directly.
  }
}

export const deckService = new DeckService();
