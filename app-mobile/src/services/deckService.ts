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
import { FEATURE_FLAG_PROGRESSIVE_DELIVERY } from '../config/featureFlags';

/**
 * ORCH-0490 Phase 2.2 — Source discriminant for progressive delivery.
 * Fired with each partial cache update so consumers can branch (e.g. analytics,
 * dev logging) by which side of the race delivered first. The singles/curated
 * race is non-deterministic — either may win depending on network state.
 */
export type PartialDeliverySource = 'singles' | 'curated';

/**
 * ORCH-0490 Phase 2.2 — Merge helper for progressive delivery.
 *
 * Used by `useDeckCards.onPartialReady` to populate the React Query cache
 * incrementally as singles and curated settle. Dedupes by card `id`,
 * PRESERVES existing card positions, appends new cards to the tail.
 *
 * Example:
 *   mergeCardsByIdPreservingOrder([A, B, C], [B, D, E]) === [A, B, C, D, E]
 *   (B is deduplicated in-place, D and E appended; A and C keep positions 0, 2.)
 *
 * This preservation is load-bearing for I-PROGRESSIVE-DELIVERY-EXPANSION-NOT-REPLACEMENT
 * (Phase 2.3). Changing positions on merge would break the expansion-signal
 * invariant the SwipeableCards first-5-IDs check relies on.
 */
export function mergeCardsByIdPreservingOrder(
  prev: Recommendation[],
  incoming: Recommendation[],
): Recommendation[] {
  if (prev.length === 0) return incoming;
  if (incoming.length === 0) return prev;
  const prevIds = new Set<string>();
  for (const card of prev) prevIds.add(card.id);
  const toAppend: Recommendation[] = [];
  for (const card of incoming) {
    if (!prevIds.has(card.id)) toAppend.push(card);
  }
  if (toAppend.length === 0) return prev;
  return [...prev, ...toAppend];
}

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

/**
 * ORCH-0474: Discriminant from the `discover-cards` edge function's
 * sourceBreakdown.path. Consumers branch UI on this field rather than
 * inferring state from (cards.length, hasMore).
 *   - 'pipeline'       — normal populated or filtered-to-zero deck response
 *   - 'pool-empty'     — RPC succeeded with zero rows (genuine seeding gap)
 *   - 'auth-required'  — JWT sub unreadable; retry with a refreshed token
 *   - 'pipeline-error' — exception during server pipeline; retry
 * For curated-only decks the server doesn't run — serverPath is 'pipeline'.
 */
export type DeckServerPath =
  | 'pipeline'
  | 'pool-empty'
  | 'auth-required'
  | 'pipeline-error';

export interface DeckResponse {
  cards: Recommendation[];
  deckMode: 'nature' | 'icebreakers' | 'drinks_and_music' | 'brunch_lunch_casual' | 'upscale_fine_dining' | 'movies_theatre' | 'creative_arts' | 'play' | 'curated' | 'mixed';
  activePills: string[];
  total: number;
  hasMore: boolean;
  serverPath: DeckServerPath;
}

/**
 * ORCH-0474: Error class thrown by fetchDeck when the category fetch fails
 * in a way the UI must distinguish (auth vs pipeline). Carries the tagged
 * serverPath so the hook's onError can route into the right UI state.
 */
export class DeckFetchError extends Error {
  readonly serverPath: DeckServerPath;
  constructor(message: string, serverPath: DeckServerPath) {
    super(message);
    this.name = 'DeckFetchError';
    this.serverPath = serverPath;
  }
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
  upscale_fine_dining: 'Fine Dining',
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

  /**
   * ORCH-0490 Phase 2.2 — Progressive delivery contract.
   *
   * `onPartialReady(cards, { source })` fires up to TWICE per fetchDeck call:
   *   - Once when singles (category) resolves with ≥1 card.
   *   - Once when curated resolves with ≥1 card.
   * Order is RACE-DETERMINED — either may win on any given call. The second
   * arrival does NOT replace the first; `useDeckCards` merges via
   * `mergeCardsByIdPreservingOrder` to preserve existing card positions.
   *
   * When `FEATURE_FLAG_PROGRESSIVE_DELIVERY` is false, the old sequential
   * `await singlesSettled → fire if non-empty → await curatedSettled` path
   * runs for rollback parity. In that mode, `onPartialReady` fires at most
   * ONCE with `source: 'singles'` — identical to pre-Phase-2.2 behavior.
   *
   * ORCH-0485 RC#2 + RC#3 + ORCH-0486 closed by this rewrite.
   */
  async fetchDeck(
    params: DeckParams,
    onPartialReady?: (cards: Recommendation[], meta: { source: PartialDeliverySource }) => void,
  ): Promise<DeckResponse> {
    const { pills, categoryFilters } = this.resolvePills(params.categories, params.intents);
    const limit = params.limit ?? 20;
    let hasMoreFromEdge = true;
    // ORCH-0474: Capture the server's path discriminant so the hook can route
    // UI on it. Category fetch wins over curated — curated-only decks end up
    // 'pipeline' (server didn't run for the deck-cards key).
    let categoryServerPath: DeckServerPath = 'pipeline';

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
            // ORCH-0474: Capture serverPath discriminant from the response.
            const rawPath = data.sourceBreakdown?.path;
            if (
              rawPath === 'pipeline' ||
              rawPath === 'pool-empty' ||
              rawPath === 'auth-required' ||
              rawPath === 'pipeline-error'
            ) {
              categoryServerPath = rawPath;
            } else {
              // Unknown / legacy path — treat as pipeline (populated or filtered).
              categoryServerPath = 'pipeline';
            }
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
            // ORCH-0474: Classify the failure as auth-required vs pipeline-error
            // using the HTTP status code from FunctionsHttpError.context.status.
            // Status 401 → auth (matches edge fn's path:'auth-required').
            // Anything else (500 pipeline-error, timeout, network) → pipeline-error.
            const msg = typeof error === 'string' ? error : (error as any)?.message || 'Unknown error';
            const status = (error as any)?.context?.status;
            const serverPath: DeckServerPath = status === 401 ? 'auth-required' : 'pipeline-error';
            console.warn(`[DeckService] discover-cards error (serverPath=${serverPath}):`, msg);
            throw new DeckFetchError(`Deck fetch failed: ${msg}`, serverPath);
          }
        } catch (err) {
          if ((err as any)?.name === 'AbortError') {
            console.warn('[DeckService] discover-cards timed out after 15s');
            // ORCH-0474: Timeout is a pipeline failure, not an auth issue.
            throw new DeckFetchError('discover-cards timed out after 15s', 'pipeline-error');
          }
          // Re-throw DeckFetchError unchanged so the discriminant survives.
          if (err instanceof DeckFetchError) throw err;
          console.warn('[DeckService] discover-cards failed:', (err as any)?.message || err);
          throw new DeckFetchError(
            (err as Error)?.message || 'discover-cards failed',
            'pipeline-error',
          );
        } finally {
          clearTimeout(fetchTimer);
        }
      } catch (err) {
        if (err instanceof DeckFetchError) throw err;
        console.warn('[DeckService] discover-cards outer error:', (err as any)?.message || err);
        throw new DeckFetchError(
          (err as Error)?.message || 'discover-cards outer error',
          'pipeline-error',
        );
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

    // ── Settlement wrappers: convert rejections to tagged objects ─────
    // Both promises kick off in parallel (categoryPromise + curatedPromise
    // already started above). The wrappers let us await without throwing so
    // the race logic below can reason about ok/err uniformly.
    const singlesSettled = categoryPromise
      .then((cards): { ok: true; value: Recommendation[] } => ({ ok: true, value: cards }))
      .catch((err): { ok: false; error: unknown } => ({ ok: false, error: err }));

    const curatedSettled = curatedPromise
      .then((arrays): { ok: true; value: Recommendation[][] } => ({ ok: true, value: arrays }))
      .catch((err): { ok: false; error: unknown } => ({ ok: false, error: err }));

    // ── Progressive delivery: fire onPartialReady when each side settles ─
    // ORCH-0490 Phase 2.2 + I-PROGRESSIVE-DELIVERY-FIRST-WIN +
    // I-ZERO-SINGLES-NOT-20S-WAIT. When FEATURE_FLAG_PROGRESSIVE_DELIVERY is
    // true (default __DEV__; prod flipped after 1-week clean telemetry):
    //   - Each settled side fires onPartialReady independently with its source.
    //   - Singles empty + curated non-empty no longer waits 20s for curated.
    //   - Whichever of singles/curated settles first with ≥1 card wins the
    //     first UI paint.
    // When flag is false, the old sequential behavior runs for rollback parity
    // — onPartialReady fires at most once with source:'singles'.
    let singlesResult: { ok: true; value: Recommendation[] } | { ok: false; error: unknown };
    let curatedResult: { ok: true; value: Recommendation[][] } | { ok: false; error: unknown };

    const deliverSinglesPartial = (cards: Recommendation[]): Recommendation[][] => {
      if (cards.length === 0) return [];
      const byCategory: Record<string, Recommendation[]> = {};
      for (const card of cards) {
        const cat = card.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(card);
      }
      const arrays: Recommendation[][] = Object.values(byCategory);
      const interleaved = roundRobinInterleave(arrays);
      if (interleaved.length > 0) {
        onPartialReady?.(interleaved, { source: 'singles' });
      }
      return arrays;
    };

    const deliverCuratedPartial = (arrays: Recommendation[][]): void => {
      const interleaved = roundRobinInterleave(arrays);
      if (interleaved.length > 0) {
        onPartialReady?.(interleaved, { source: 'curated' });
      }
    };

    if (FEATURE_FLAG_PROGRESSIVE_DELIVERY) {
      // ── Race path: whichever resolves first delivers first ──
      // Tag each side so we can tell which won the race when Promise.race
      // returns. Both continue settling so we still get the final results.
      type RacerTag =
        | { tag: 'singles'; result: typeof singlesResult }
        | { tag: 'curated'; result: typeof curatedResult };

      const singlesRacer: Promise<RacerTag> = singlesSettled.then((r) => ({ tag: 'singles' as const, result: r }));
      const curatedRacer: Promise<RacerTag> = curatedSettled.then((r) => ({ tag: 'curated' as const, result: r }));

      const first = await Promise.race([singlesRacer, curatedRacer]);
      if (first.tag === 'singles') {
        singlesResult = first.result;
        if (singlesResult.ok) deliverSinglesPartial(singlesResult.value);
        // ORCH-0485 RC#3: if singles empty, we do NOT skip. Curated will
        // deliver on its own branch when it settles — no 20s ceiling wait.
        curatedResult = await curatedSettled;
        if (curatedResult.ok) deliverCuratedPartial(curatedResult.value);
      } else {
        curatedResult = first.result;
        if (curatedResult.ok) deliverCuratedPartial(curatedResult.value);
        // ORCH-0485 RC#2: curated won the race and delivered first even
        // though singles-first was the old hardcoded order. This is the
        // valid outcome on cold-isolate / slow-singles scenarios.
        singlesResult = await singlesSettled;
        if (singlesResult.ok) deliverSinglesPartial(singlesResult.value);
      }
    } else {
      // ── Sequential fallback: pre-2.2 behavior (flag off — kill switch) ──
      // Preserve the exact old semantics so rollback via flag flip is instant.
      // Only fires onPartialReady once, for singles, and only when non-empty.
      singlesResult = await singlesSettled;
      if (singlesResult.ok && singlesResult.value.length > 0) {
        deliverSinglesPartial(singlesResult.value);
      }
      curatedResult = await curatedSettled;
    }

    // ── Build final interleaved array (unchanged semantics) ──────────
    // The final return is the authoritative cache write. Partial deliveries
    // above were intermediate UX states that React Query will overwrite with
    // this return value. The interleaved order alternates regular+curated 1:1
    // as today — same positional result as pre-2.2.
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
    }
    const regularStream = roundRobinInterleave(categoryArrays);

    const curatedArrays: Recommendation[][] = [];
    if (curatedResult.ok) {
      curatedArrays.push(...curatedResult.value);
    }
    const curatedStream = roundRobinInterleave(curatedArrays);

    // ── Error handling: both-failed throws preserved ────────────────────
    // ORCH-0474 + INV-042 + INV-043: if BOTH sides failed, throw so React
    // Query sees the error and the hook routes to PIPELINE_ERROR state.
    if (!singlesResult.ok && !curatedResult.ok) {
      const singlesErr = singlesResult.error;
      if (singlesErr instanceof DeckFetchError) throw singlesErr;
      throw new DeckFetchError(
        (singlesErr as Error)?.message || 'All deck fetches failed',
        'pipeline-error',
      );
    }

    // ── ORCH-0486: mixed-deck serverPath carry-through ──────────────────
    // When singles failed with a tagged DeckFetchError (auth-required or
    // pipeline-error) but curated succeeded, the final return's serverPath
    // must carry the singles error's discriminant — not the default
    // 'pipeline' from the uninitialized categoryServerPath. Without this,
    // the UI renders curated-only cards with no retry affordance for the
    // failed category side. Rare in practice (auth/pipeline failures
    // typically hit both calls at once), but INV-042 / INV-043 require it.
    let finalServerPath: DeckServerPath = categoryServerPath;
    if (!singlesResult.ok && curatedResult.ok) {
      const singlesErr = singlesResult.error;
      if (singlesErr instanceof DeckFetchError) {
        finalServerPath = singlesErr.serverPath;
      }
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
      serverPath: finalServerPath,
    };
  }

}

export const deckService = new DeckService();
