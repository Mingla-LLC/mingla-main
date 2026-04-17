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

export interface DeckParams {
  location: { lat: number; lng: number };
  categories: string[];
  intents?: string[];
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  batchSeed?: number;
  limit?: number;
  excludeCardIds?: string[];
  dateWindows?: string[];  // ORCH-0446: array of date windows for AND intersection (collab only)
  sessionId?: string;      // ORCH-0446: optional, for analytics tracking (collab only)
}

export interface DeckResponse {
  cards: Recommendation[];
  deckMode: 'nature' | 'icebreakers' | 'drinks_and_music' | 'brunch_lunch_casual' | 'upscale_fine_dining' | 'movies_theatre' | 'creative_arts' | 'play' | 'curated' | 'mixed';
  activePills: string[];
  total: number;
  hasMore: boolean;
}

interface DeckPill {
  id: string;
  type: 'category' | 'curated';
}

// ── Pill ID → display name for the unified edge function ─────────────────
// ORCH-0434: Updated to new canonical slugs.
const PILL_TO_CATEGORY_NAME: Record<string, string> = {
  nature: 'Nature & Views',
  icebreakers: 'Icebreakers',
  drinks_and_music: 'Drinks & Music',
  brunch_lunch_casual: 'Brunch, Lunch & Casual',
  upscale_fine_dining: 'Upscale & Fine Dining',
  movies_theatre: 'Movies & Theatre',
  creative_arts: 'Creative & Arts',
  play: 'Play',
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
    // ORCH-0434: Updated to new canonical slugs with backward compat for old slugs.
    const CATEGORY_PILL_MAP: Record<string, string> = {
      // New canonical slugs
      'nature': 'nature',
      'nature & views': 'nature',
      'icebreakers': 'icebreakers',
      'drinks_and_music': 'drinks_and_music',
      'drinks & music': 'drinks_and_music',
      'brunch_lunch_casual': 'brunch_lunch_casual',
      'brunch, lunch & casual': 'brunch_lunch_casual',
      'upscale_fine_dining': 'upscale_fine_dining',
      'upscale & fine dining': 'upscale_fine_dining',
      'movies_theatre': 'movies_theatre',
      'movies & theatre': 'movies_theatre',
      'creative_arts': 'creative_arts',
      'creative & arts': 'creative_arts',
      'play': 'play',
      // Old slugs → new slugs (backward compat)
      'first_meet': 'icebreakers',
      'first meet': 'icebreakers',
      'picnic_park': 'nature',
      'picnic park': 'nature',
      'picnic': 'nature',
      'drink': 'drinks_and_music',
      'casual_eats': 'brunch_lunch_casual',
      'casual eats': 'brunch_lunch_casual',
      'fine_dining': 'upscale_fine_dining',
      'fine dining': 'upscale_fine_dining',
      'watch': 'movies_theatre',
      'live_performance': 'movies_theatre',
      'live performance': 'movies_theatre',
      'wellness': 'brunch_lunch_casual',
      'flowers': 'nature',
      'nature_views': 'nature',
      // Legacy compat
      'groceries & flowers': 'nature',
      'groceries_flowers': 'nature',
      'work & business': 'icebreakers',
      'work_business': 'icebreakers',
      'play & move': 'play',
      'stroll': 'nature',
      'sip & chill': 'drinks_and_music',
      'sip and chill': 'drinks_and_music',
      'dining': 'upscale_fine_dining',
      'screen & relax': 'movies_theatre',
      'creative & hands-on': 'creative_arts',
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

  // onSinglesReady fires BEFORE the full result when singles resolve first.
  // This lets the UI show cards in ~1s while curated loads in the background.
  // Do NOT remove — users see cards in ~1s instead of waiting for curated. See ORCH-0340.
  async fetchDeck(
    params: DeckParams,
    onSinglesReady?: (cards: Recommendation[]) => void,
  ): Promise<DeckResponse> {
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
          // 15s timeout: discover-cards is pool-served (~1s warm) but Deno isolate
          // cold start adds 4-9s on first invocation. 15s accommodates cold start.
          // Do NOT reduce below 10s without verifying cold-start latency. See ORCH-0342.
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
                travelMode: params.travelMode,
                travelConstraintType: params.travelConstraintType,
                travelConstraintValue: params.travelConstraintValue,
                datetimePref: params.datetimePref,
                dateOption: params.dateOption,
                batchSeed: params.batchSeed,
                limit: categoryLimit,
                excludeCardIds: params.excludeCardIds,
                dateWindows: params.dateWindows,  // ORCH-0446: AND date intersection (collab only)
                sessionId: params.sessionId,       // ORCH-0446: analytics tracking (collab only)
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
            const curatedLimit = limit; // Give curated the same limit as categories — interleave balances them
            const cards = await curatedExperiencesService.generateCuratedExperiences({
              experienceType: pill.id as any,
              location: params.location,
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

    // ── Singles-first pattern: deliver partial results early ──────────
    // Fire both in parallel but await singles FIRST so onSinglesReady can
    // deliver partial results to the UI within ~1s. Curated settles later.
    // Catches convert rejections to tagged objects so we can await without throwing.
    const singlesSettled = categoryPromise
      .then((cards): { ok: true; value: Recommendation[] } => ({ ok: true, value: cards }))
      .catch((err): { ok: false; error: unknown } => ({ ok: false, error: err }));

    const curatedSettled = curatedPromise
      .then((arrays): { ok: true; value: Recommendation[][] } => ({ ok: true, value: arrays }))
      .catch((err): { ok: false; error: unknown } => ({ ok: false, error: err }));

    // Await singles first — deliver partial results immediately
    const singlesResult = await singlesSettled;

    const categoryArrays: Recommendation[][] = [];
    if (singlesResult.ok && singlesResult.value.length > 0) {
      const byCategory: Record<string, Recommendation[]> = {};
      for (const card of singlesResult.value) {
        const cat = card.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(card);
      }
      for (const group of Object.values(byCategory)) {
        categoryArrays.push(group);
      }
      // Deliver singles to UI immediately — user sees cards in ~1s
      const partialStream = roundRobinInterleave(categoryArrays);
      if (partialStream.length > 0) {
        onSinglesReady?.(partialStream);
      }
    }
    const regularStream = roundRobinInterleave(categoryArrays);

    // Now await curated (may already be settled)
    const curatedResult = await curatedSettled;

    const curatedArrays: Recommendation[][] = [];
    if (curatedResult.ok) {
      curatedArrays.push(...curatedResult.value);
    }
    const curatedStream = roundRobinInterleave(curatedArrays);

    // If both fetches failed, throw so React Query sees the error
    const regularFailed = !singlesResult.ok;
    const curatedFailed = !curatedResult.ok;
    if (regularFailed && curatedFailed) {
      throw (singlesResult.error as Error) || new Error('All deck fetches failed');
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

}

export const deckService = new DeckService();
