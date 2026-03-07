import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import { upsertPlaceToPool, insertCardToPool, recordImpressions } from '../_shared/cardPoolService.ts';
import {
  getPlaceTypesForCategory,
  ALL_CATEGORY_NAMES,
  DISCOVER_EXCLUDED_PLACE_TYPES,
} from '../_shared/categoryPlaceTypes.ts';
import { priceLevelToRange, googleLevelToTierSlug, priceTierFromAmount } from '../_shared/priceTiers.ts';
// resolveCategories no longer used — per-category selection handles this directly

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const US_TIMEZONE = "America/New_York";
const usDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: US_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getUsDateKey = (): string => usDateFormatter.format(new Date());

/**
 * Haversine distance between two lat/lng points in km
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface DiscoverRequest {
  location: { lat: number; lng: number };
  radius?: number; // Optional radius in meters, default 10km
  selectedCategories?: string[]; // Optional: only fetch these categories (IDs or labels)
  heroCategories?: string[]; // Optional: user's top 2 categories for hero cards
  travelMode?: string; // Optional: 'walking' | 'driving' | 'transit' | 'bicycling'
}

interface DiscoverPlace {
  id: string;
  name: string;
  category: string;
  location: { lat: number; lng: number };
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
  images: string[];
  placeId: string;
  openingHours: {
    open_now: boolean;
    weekday_text: string[];
  } | null;
  priceLevel: number;
  price_min: number;
  price_max: number;
  placeTypes: string[];
  website?: string | null;
}

interface DiscoverDailyCacheRow {
  cards: any[];
  featured_card: any | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const request: DiscoverRequest = await req.json();
    const { location, radius = 10000, selectedCategories, travelMode = 'walking' } = request;
    const usDateKey = getUsDateKey();

    // Validate heroCategories if provided
    if (request.heroCategories && (!Array.isArray(request.heroCategories) || !request.heroCategories.every((c: any) => typeof c === 'string'))) {
      return new Response(
        JSON.stringify({ error: 'heroCategories must be an array of strings' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map from preference IDs (snake_case) to discover category labels
    const PREF_ID_TO_DISCOVER_CATEGORY: Record<string, string> = {
      nature: "Nature",
      first_meet: "First Meet",
      picnic: "Picnic",
      drink: "Drink",
      casual_eats: "Casual Eats",
      fine_dining: "Fine Dining",
      watch: "Watch",
      creative_arts: "Creative & Arts",
      play: "Play",
      wellness: "Wellness",
      groceries_flowers: "Groceries & Flowers",
      work_business: "Work & Business",
    };

    // Resolve heroCategories through the same 3-step pipeline as selectedCategories
    // (display name → slug lookup → case-insensitive fallback)
    const resolveCategory = (cat: string): string | null => {
      if (ALL_CATEGORY_NAMES.includes(cat)) return cat;
      const mapped = PREF_ID_TO_DISCOVER_CATEGORY[cat];
      if (mapped) return mapped;
      const lowerCat = cat.toLowerCase();
      return ALL_CATEGORY_NAMES.find((dc) => dc.toLowerCase() === lowerCat) || null;
    };

    // Dynamic hero categories: resolve from request param or fall back to defaults
    let HERO_CATEGORIES_RESOLVED = ["Fine Dining", "Play"];
    if (request.heroCategories && request.heroCategories.length > 0) {
      const resolved = request.heroCategories
        .slice(0, 2)
        .map(resolveCategory)
        .filter((c): c is string => c !== null);
      if (resolved.length > 0) {
        HERO_CATEGORIES_RESOLVED = resolved;
      }
    }

    // Resolve which categories to fetch: filter DISCOVER_CATEGORIES by user selection
    let categoriesToFetch = ALL_CATEGORY_NAMES;
    if (selectedCategories && selectedCategories.length > 0) {
      const resolvedLabels = new Set<string>();
      for (const cat of selectedCategories) {
        const resolved = resolveCategory(cat);
        if (resolved) resolvedLabels.add(resolved);
      }
      if (resolvedLabels.size > 0) {
        categoriesToFetch = ALL_CATEGORY_NAMES.filter((c) => resolvedLabels.has(c));
      }
      console.log(`Filtered categories: ${categoriesToFetch.join(", ")} (from ${selectedCategories.length} requested)`);
    } else {
      console.log("No category filter provided – fetching all categories");
    }

    // Build a stable hash of selected categories to partition the cache
    const categoryHash = selectedCategories && selectedCategories.length > 0
      ? [...selectedCategories].sort().join(",")
      : "all";

    let userId: string | null = null;
    let adminClient: ReturnType<typeof createClient> | null = null;
    // Previous batch's place IDs — used to exclude cards from the last 24h batch
    let previousBatchPlaceIds: string[] = [];

    try {
      const authHeader = req.headers.get("Authorization");
      if (
        authHeader?.startsWith("Bearer ") &&
        SUPABASE_URL &&
        SUPABASE_ANON_KEY &&
        SUPABASE_SERVICE_ROLE_KEY
      ) {
        const token = authHeader.replace("Bearer ", "").trim();
        const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: authData } = await authClient.auth.getUser(token);
        userId = authData.user?.id || null;

        if (userId) {
          adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

          // ── 24-hour cache lookup: find a non-expired batch for this user ──
          const { data: cachedRows, error: cacheReadError } = await adminClient
            .from("discover_daily_cache")
            .select("id, cards, featured_card, generated_location, expires_at, all_place_ids, previous_batch_place_ids, us_date_key")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(5);

          if (cacheReadError) {
            console.warn("Discover daily cache read warning:", cacheReadError.message);
          } else if (cachedRows && cachedRows.length > 0) {
            // Find the most recent row that (a) matches categoryHash and (b) hasn't expired
            const now = new Date().toISOString();
            const matchingRow = cachedRows.find((row: any) => {
              const hashMatch = row.generated_location?.categoryHash === categoryHash;
              // Check timestamp-based expiry (24h). Falls back to date-key for legacy rows.
              const expiresAt = row.expires_at;
              const stillValid = expiresAt ? new Date(expiresAt) > new Date() : row.us_date_key === usDateKey;
              return hashMatch && stillValid;
            });

            if (matchingRow?.cards && matchingRow.cards.length > 0) {
              console.log(`Cache hit for user ${userId} (expires_at=${matchingRow.expires_at}, hash=${categoryHash}). Returning persisted For You cards.`);

              // Reconstruct hero cards from cached grid if the cache entry has none
              let cachedHeroCards = matchingRow.generated_location?.heroCards || [];
              let cachedGridCards = [...matchingRow.cards];

              if (cachedHeroCards.length < 2 && cachedGridCards.length > 0) {
                const heroUsedIds = new Set(cachedHeroCards.map((h: any) => h.id));
                const heroUsedCats = new Set(cachedHeroCards.map((h: any) => h.category));
                for (const heroCat of HERO_CATEGORIES_RESOLVED) {
                  if (cachedHeroCards.length >= 2) break;
                  if (heroUsedCats.has(heroCat)) continue;
                  const candidate = cachedGridCards.find((c: any) => c.category === heroCat && !heroUsedIds.has(c.id));
                  if (candidate) {
                    cachedHeroCards.push(candidate);
                    heroUsedIds.add(candidate.id);
                    heroUsedCats.add(heroCat);
                    console.log(`[cache-reconstruct] Hero for ${heroCat}: "${candidate.title}"`);
                  }
                }
                if (cachedHeroCards.length < 2) {
                  const remaining = cachedGridCards
                    .filter((c: any) => !heroUsedIds.has(c.id))
                    .sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));
                  for (const c of remaining) {
                    if (cachedHeroCards.length >= 2) break;
                    cachedHeroCards.push(c);
                    heroUsedIds.add(c.id);
                    console.log(`[cache-reconstruct] Filled hero with "${c.title}" (${c.category})`);
                  }
                }
                cachedGridCards = cachedGridCards.filter((c: any) => !heroUsedIds.has(c.id));
                console.log(`[cache-reconstruct] Reconstructed ${cachedHeroCards.length} heroes, ${cachedGridCards.length} grid cards`);
              }

              return new Response(
                JSON.stringify({
                  cards: cachedGridCards,
                  heroCards: cachedHeroCards,
                  featuredCard: cachedHeroCards[0] || matchingRow.featured_card,
                  expiresAt: matchingRow.expires_at || null,
                  meta: {
                    totalResults: cachedGridCards.length,
                    categories: categoriesToFetch,
                    successfulCategories: [],
                    failedCategories: [],
                    cacheHit: true,
                    usDateKey,
                  },
                }),
                {
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
              );
            }

            // ── No valid (non-expired) cache found — collect previous batch place IDs for exclusion ──
            // Use the most recent expired row to know what to exclude
            const mostRecentRow = cachedRows.find((row: any) =>
              row.generated_location?.categoryHash === categoryHash
            );
            if (mostRecentRow) {
              previousBatchPlaceIds = mostRecentRow.all_place_ids || [];
              // Fallback: reconstruct from cards + heroCards if all_place_ids was never set
              if (previousBatchPlaceIds.length === 0) {
                const prevCards = mostRecentRow.cards || [];
                const prevHeroes = mostRecentRow.generated_location?.heroCards || [];
                previousBatchPlaceIds = [
                  ...prevCards.map((c: any) => c.placeId || c.id),
                  ...prevHeroes.map((h: any) => h.placeId || h.id),
                ].filter(Boolean);
              }
              console.log(`[For You rotation] Previous batch had ${previousBatchPlaceIds.length} place IDs to exclude`);
            }
          }
        }
      }
    } catch (authCacheError) {
      console.warn("Discover auth/cache bootstrap warning:", authCacheError);
    }

    if (!location || !location.lat || !location.lng) {
      return new Response(
        JSON.stringify({
          error: "Location is required",
          cards: [],
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!GOOGLE_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "Google API key not configured",
          cards: [],
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Fetching discover experiences for location: ${location.lat}, ${location.lng} | categories: ${categoriesToFetch.join(", ")}`);

    // ── Pool-first pipeline: PER-CATEGORY pool query for guaranteed diversity ──
    // Instead of querying all categories in one blob (which returns top-popularity
    // cards biased toward a few categories), we query the full pool in the geo area
    // once, then pick the BEST card per category to guarantee 12 distinct categories.
    let poolCoveredCategories = new Set<string>();
    let poolMissedCategories: string[] = [];

    if (adminClient && userId) {
      try {
        const latDelta = radius / 111320;
        const lngDelta = radius / (111320 * Math.cos(location.lat * Math.PI / 180));

        // Single query: fetch ALL active single cards in the user's geo area (cap 500)
        const { data: allPoolCards, error: poolErr } = await adminClient
          .from('card_pool')
          .select('*')
          .eq('is_active', true)
          .eq('card_type', 'single')
          .gte('lat', location.lat - latDelta)
          .lte('lat', location.lat + latDelta)
          .gte('lng', location.lng - lngDelta)
          .lte('lng', location.lng + lngDelta)
          .order('popularity_score', { ascending: false })
          .limit(500);

        if (poolErr) throw poolErr;

        if (allPoolCards && allPoolCards.length > 0) {
          // Fetch preference timestamp for session-scoped filtering
          const { data: prefData } = await adminClient
            .from('preferences')
            .select('updated_at')
            .eq('profile_id', userId)
            .maybeSingle();
          const prefUpdatedAt = prefData?.updated_at || new Date(0).toISOString();

          // Session-scoped: only exclude cards seen since last preference change
          const { data: impressions } = await adminClient
            .from('user_card_impressions')
            .select('card_pool_id')
            .eq('user_id', userId)
            .gte('created_at', prefUpdatedAt);

          const seenIds = new Set((impressions || []).map((imp: any) => imp.card_pool_id));
          const prevExclude = new Set(previousBatchPlaceIds);

          // Filter: unseen + dedup by google_place_id
          const seenPlaces = new Set<string>();
          const availableCards = allPoolCards.filter((card: any) => {
            if (seenIds.has(card.id)) return false;
            const placeKey = card.google_place_id || card.id;
            if (seenPlaces.has(placeKey)) return false;
            seenPlaces.add(placeKey);
            return true;
          });

          console.log(`[pool-first] ${allPoolCards.length} total pool cards in area, ${availableCards.length} available after impression/dedup filter`);

          // Helper: find best pool card for a specific category
          const usedIds = new Set<string>();
          const findBestForCategory = (category: string): any | null => {
            // Prefer cards NOT in previous batch (24h rotation)
            let candidates = availableCards.filter(
              (c: any) => c.category === category && !usedIds.has(c.id) && !prevExclude.has(c.google_place_id || c.id)
            );
            if (candidates.length === 0) {
              // Category exhaustion fallback: allow previous batch cards
              candidates = availableCards.filter(
                (c: any) => c.category === category && !usedIds.has(c.id)
              );
              if (candidates.length > 0) {
                console.log(`⚠ [pool-first] "${category}" exhausted fresh places — reusing from previous batch`);
              }
            }
            // Already sorted by popularity_score DESC from the query
            return candidates.length > 0 ? candidates[0] : null;
          };

          // Helper: convert pool DB row to API card format
          const poolRowToApiCard = (card: any): any => {
            const distKm = (card.lat != null && card.lng != null)
              ? Math.round(haversineDistance(location.lat, location.lng, card.lat, card.lng) * 100) / 100
              : 0;
            const travelMin = Math.round(distKm / 5 * 60); // ~5 km/h walking default

            const parsedOH = card.opening_hours || null;
            const isOpenNow = parsedOH?._isOpenNow ?? parsedOH?.open_now ?? null;
            const hours = parsedOH ? { ...parsedOH } : null;
            if (hours) { delete hours._isOpenNow; }

            return {
              id: card.google_place_id || card.id,
              placeId: card.google_place_id || null,
              title: card.title,
              category: card.category,
              matchScore: card.base_match_score || 85,
              image: card.image_url || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
              images: card.images || [],
              rating: card.rating || 0,
              reviewCount: card.review_count || 0,
              priceMin: card.price_min ?? 0,
              priceMax: card.price_max ?? 0,
              priceRange: formatPriceRange(card.price_min ?? 0, card.price_max ?? 0),
              priceTier: card.price_tier || priceTierFromAmount(card.price_min ?? 0, card.price_max ?? 0),
              distanceKm: distKm,
              travelTimeMin: travelMin,
              travelTime: `${travelMin} min`,
              distance: `${distKm} km`,
              isOpenNow,
              openingHours: hours,
              description: card.description || '',
              highlights: card.highlights || [],
              address: card.address || '',
              website: card.website || null,
              lat: card.lat,
              lng: card.lng,
              heroImage: card.image_url || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
            };
          };

          // ── PASS 1: Hero cards (Fine Dining + Play) ──
          const poolHeroCards: any[] = [];
          for (const heroCategory of HERO_CATEGORIES_RESOLVED) {
            const card = findBestForCategory(heroCategory);
            if (card) {
              poolHeroCards.push(poolRowToApiCard(card));
              usedIds.add(card.id);
              poolCoveredCategories.add(heroCategory);
              console.log(`✓ [pool-first] Hero "${heroCategory}": "${card.title}" (rating: ${card.rating})`);
            } else {
              console.log(`✗ [pool-first] No pool card for hero: ${heroCategory}`);
            }
          }

          // ── PASS 2: One card per remaining category ──
          const poolGridCards: any[] = [];
          for (const category of categoriesToFetch) {
            if (HERO_CATEGORIES_RESOLVED.includes(category)) continue;
            if (poolCoveredCategories.has(category)) continue;

            const card = findBestForCategory(category);
            if (card) {
              poolGridCards.push(poolRowToApiCard(card));
              usedIds.add(card.id);
              poolCoveredCategories.add(category);
              console.log(`✓ [pool-first] Grid "${category}": "${card.title}"`);
            } else {
              console.log(`✗ [pool-first] No pool card for: ${category}`);
            }
          }

          poolMissedCategories = categoriesToFetch.filter((c) => !poolCoveredCategories.has(c));
          console.log(`[pool-first] Per-category coverage: ${poolCoveredCategories.size}/${categoriesToFetch.length} | missed: [${poolMissedCategories.join(', ')}]`);

          // If ALL 12 categories covered → serve entirely from pool (0 API calls)
          if (poolMissedCategories.length === 0) {
            const poolFeaturedCard = poolHeroCards[0] || poolGridCards[0] || null;
            const poolExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            const poolAllPlaceIds = [
              ...poolHeroCards.map((c: any) => c.placeId || c.id),
              ...poolGridCards.map((c: any) => c.placeId || c.id),
            ].filter(Boolean);

            // Record impressions for served pool cards
            const servedPoolCardIds = [...poolHeroCards, ...poolGridCards]
              .map((c: any) => allPoolCards.find((pc: any) => (pc.google_place_id || pc.id) === (c.placeId || c.id))?.id)
              .filter(Boolean);
            if (servedPoolCardIds.length > 0) {
              recordImpressions(adminClient, userId, servedPoolCardIds).catch(() => {});
            }

            // Persist to daily cache
            adminClient
              .from("discover_daily_cache")
              .delete()
              .eq("user_id", userId)
              .filter("generated_location->>categoryHash", "eq", categoryHash)
              .then(() =>
                adminClient!
                  .from("discover_daily_cache")
                  .insert({
                    user_id: userId,
                    us_date_key: usDateKey,
                    cards: poolGridCards,
                    featured_card: poolFeaturedCard,
                    expires_at: poolExpiresAt,
                    all_place_ids: poolAllPlaceIds,
                    previous_batch_place_ids: previousBatchPlaceIds,
                    generated_location: {
                      lat: location.lat,
                      lng: location.lng,
                      radius,
                      categoryHash,
                      heroCards: poolHeroCards,
                    },
                  })
              )
              .catch((e: any) => console.warn("[pool-first] Cache write error:", e));

            console.log(`[pool-first] Serving all 12 categories from pool (0 API calls): ${poolHeroCards.length} heroes + ${poolGridCards.length} grid`);

            return new Response(
              JSON.stringify({
                cards: poolGridCards,
                heroCards: poolHeroCards,
                featuredCard: poolFeaturedCard,
                expiresAt: poolExpiresAt,
                meta: {
                  totalResults: poolGridCards.length,
                  heroCount: poolHeroCards.length,
                  categories: categoriesToFetch,
                  successfulCategories: Array.from(poolCoveredCategories),
                  failedCategories: [],
                  poolFirst: true,
                  fromPool: poolHeroCards.length + poolGridCards.length,
                  fromApi: 0,
                },
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          // If >= 8 categories covered, fetch the missing ones from Google and combine
          if (poolCoveredCategories.size >= 8) {
            console.log(`[pool-first] ${poolCoveredCategories.size}/12 from pool, fetching ${poolMissedCategories.length} from Google API`);

            const missedPromises = poolMissedCategories.map((category) =>
              fetchCandidatesForCategory(category, location, radius, adminClient)
            );
            const missedResults = await Promise.all(missedPromises);

            const usedPlaceIds = new Set([
              ...poolHeroCards.map((c: any) => c.placeId || c.id),
              ...poolGridCards.map((c: any) => c.placeId || c.id),
            ].filter(Boolean));
            const previousBatchExcludeSet = new Set(previousBatchPlaceIds);

            const missedPlaces: DiscoverPlace[] = [];
            for (let i = 0; i < poolMissedCategories.length; i++) {
              const category = poolMissedCategories[i];
              const candidates = missedResults[i];
              if (!candidates || candidates.length === 0) continue;

              let available = candidates.filter(
                (c) => !usedPlaceIds.has(c.placeId) && !previousBatchExcludeSet.has(c.placeId)
              );
              if (available.length === 0) {
                available = candidates.filter((c) => !usedPlaceIds.has(c.placeId));
              }
              if (available.length > 0) {
                usedPlaceIds.add(available[0].placeId);
                missedPlaces.push(available[0]);
                poolCoveredCategories.add(category);
              }
            }

            // Annotate missed places with travel + AI
            let enrichedMissedCards: any[] = [];
            if (missedPlaces.length > 0) {
              const withTravel = await annotateWithTravel(missedPlaces, location, travelMode);
              const enriched = await enrichWithAI(withTravel);
              enrichedMissedCards = enriched.map((place) => convertToCard(place));
            }

            // Split enriched missed cards into hero vs grid
            for (const card of enrichedMissedCards) {
              if (HERO_CATEGORIES_RESOLVED.includes(card.category) && poolHeroCards.length < 2) {
                poolHeroCards.push(card);
              } else {
                poolGridCards.push(card);
              }
            }

            const poolFeaturedCard = poolHeroCards[0] || poolGridCards[0] || null;
            const poolExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            const poolAllPlaceIds = [
              ...poolHeroCards.map((c: any) => c.placeId || c.id),
              ...poolGridCards.map((c: any) => c.placeId || c.id),
            ].filter(Boolean);

            // Record impressions for pool-served cards
            const servedPoolCardIds = [...poolHeroCards, ...poolGridCards]
              .map((c: any) => allPoolCards.find((pc: any) => (pc.google_place_id || pc.id) === (c.placeId || c.id))?.id)
              .filter(Boolean);
            if (servedPoolCardIds.length > 0) {
              recordImpressions(adminClient, userId, servedPoolCardIds).catch(() => {});
            }

            // Persist to daily cache
            adminClient
              .from("discover_daily_cache")
              .delete()
              .eq("user_id", userId)
              .filter("generated_location->>categoryHash", "eq", categoryHash)
              .then(() =>
                adminClient!
                  .from("discover_daily_cache")
                  .insert({
                    user_id: userId,
                    us_date_key: usDateKey,
                    cards: poolGridCards,
                    featured_card: poolFeaturedCard,
                    expires_at: poolExpiresAt,
                    all_place_ids: poolAllPlaceIds,
                    previous_batch_place_ids: previousBatchPlaceIds,
                    generated_location: {
                      lat: location.lat,
                      lng: location.lng,
                      radius,
                      categoryHash,
                      heroCards: poolHeroCards,
                    },
                  })
              )
              .catch((e: any) => console.warn("[pool-first] Cache write error:", e));

            console.log(`[pool-first] Hybrid serve: ${poolCoveredCategories.size} categories (${poolHeroCards.length} heroes + ${poolGridCards.length} grid), ${enrichedMissedCards.length} from Google API`);

            return new Response(
              JSON.stringify({
                cards: poolGridCards,
                heroCards: poolHeroCards,
                featuredCard: poolFeaturedCard,
                expiresAt: poolExpiresAt,
                meta: {
                  totalResults: poolGridCards.length,
                  heroCount: poolHeroCards.length,
                  categories: categoriesToFetch,
                  successfulCategories: Array.from(poolCoveredCategories),
                  failedCategories: categoriesToFetch.filter((c) => !poolCoveredCategories.has(c)),
                  poolFirst: true,
                  fromPool: poolHeroCards.length + poolGridCards.length - enrichedMissedCards.length,
                  fromApi: enrichedMissedCards.length,
                },
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          console.log(`[pool-first] Only ${poolCoveredCategories.size}/12 categories in pool, need >= 8. Falling back to full Google API.`);
        } else {
          console.log(`[pool-first] No pool cards in geo area. Falling back to Google API.`);
        }
      } catch (poolError) {
        console.warn("[pool-first] Pool query failed, falling back to Google API:", poolError);
      }
    }

    // Fetch candidate places for filtered categories in parallel
    // Create an admin client for cache operations if we don't have one yet
    if (!adminClient && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    }
    const categoryPromises = categoriesToFetch.map((category) =>
      fetchCandidatesForCategory(category, location, radius, adminClient)
    );

    const allCategoryCandidates = await Promise.all(categoryPromises);

    // Select one unique place per category, avoiding duplicates
    // Hero categories are selected separately — exclude from grid
    const heroCategories = HERO_CATEGORIES_RESOLVED;
    const usedPlaceIds = new Set<string>();
    const places: DiscoverPlace[] = [];
    const successfulCategories: string[] = [];
    const failedCategories: string[] = [];

    // Set of place IDs from the previous 24h batch — exclude these for fresh rotation
    const previousBatchExcludeSet = new Set(previousBatchPlaceIds);
    if (previousBatchExcludeSet.size > 0) {
      console.log(`[For You rotation] Excluding ${previousBatchExcludeSet.size} place IDs from previous batch`);
    }

    for (let i = 0; i < categoriesToFetch.length; i++) {
      const category = categoriesToFetch[i];

      // Skip hero categories — they'll be selected as hero cards below
      if (heroCategories.includes(category)) continue;
      const candidates = allCategoryCandidates[i];

      if (!candidates || candidates.length === 0) {
        failedCategories.push(category);
        console.log(`✗ No candidates for category: ${category}`);
        continue;
      }

      // Filter out already-used places AND previous batch places
      let availableCandidates = candidates.filter(
        c => !usedPlaceIds.has(c.placeId) && !previousBatchExcludeSet.has(c.placeId)
      );

      // Category exhaustion fallback: if ALL candidates were excluded, allow previous batch
      // cards but still avoid duplicates within this batch
      if (availableCandidates.length === 0 && previousBatchExcludeSet.size > 0) {
        availableCandidates = candidates.filter(c => !usedPlaceIds.has(c.placeId));
        if (availableCandidates.length > 0) {
          console.log(`⚠ Category "${category}" exhausted fresh places — reusing from previous batch`);
        }
      }
      
      if (availableCandidates.length === 0) {
        failedCategories.push(category);
        console.log(`✗ All ${candidates.length} candidates for ${category} were already used`);
        continue;
      }

      // Select the single best candidate (sorted by quality score)
      // Top candidate = best-of-the-best from this category
      const selectedPlace = availableCandidates[0];
      
      usedPlaceIds.add(selectedPlace.placeId);
      places.push(selectedPlace);
      successfulCategories.push(category);
      console.log(`✓ Selected for ${category}: "${selectedPlace.name}" (rating: ${selectedPlace.rating}, reviews: ${selectedPlace.reviewCount})`);
    }

    console.log(`Successful categories (${successfulCategories.length}):`, successfulCategories);
    console.log(`Failed categories (${failedCategories.length}):`, failedCategories);
    console.log(`Found ${places.length} unique places across ${categoriesToFetch.length} categories`);

    // Select 2 hero cards: Fine Dining and Play
    const allUnusedCandidates: DiscoverPlace[] = [];
    for (const candidates of allCategoryCandidates) {
      if (candidates && candidates.length > 0) {
        const unusedFromCategory = candidates.filter(c => !usedPlaceIds.has(c.placeId));
        allUnusedCandidates.push(...unusedFromCategory);
      }
    }

    console.log(`Total unused candidates for hero cards: ${allUnusedCandidates.length}`);

    const heroCards: DiscoverPlace[] = [];

    for (const heroCategory of heroCategories) {
      // Filter candidates: not already used AND not in previous batch
      let heroCandidates = allUnusedCandidates.filter(
        (c) => c.category === heroCategory && !usedPlaceIds.has(c.placeId) && !previousBatchExcludeSet.has(c.placeId)
      );

      // Category exhaustion fallback for heroes: allow previous batch if no fresh candidates
      if (heroCandidates.length === 0 && previousBatchExcludeSet.size > 0) {
        heroCandidates = allUnusedCandidates.filter(
          (c) => c.category === heroCategory && !usedPlaceIds.has(c.placeId)
        );
        if (heroCandidates.length > 0) {
          console.log(`⚠ Hero "${heroCategory}" exhausted fresh places — reusing from previous batch`);
        }
      }

      if (heroCandidates.length > 0) {
        const sorted = heroCandidates.sort((a, b) => {
          const aScore = (a.rating || 0) * Math.log10((a.reviewCount || 1) + 1);
          const bScore = (b.rating || 0) * Math.log10((b.reviewCount || 1) + 1);
          return bScore - aScore;
        });
        const selected = sorted[0];
        usedPlaceIds.add(selected.placeId);
        heroCards.push(selected);
        console.log(`✓ Selected hero card for ${heroCategory}: "${selected.name}" (rating: ${selected.rating})`);
      } else {
        console.log(`✗ No candidates available for hero category: ${heroCategory}`);
      }
    }

    // For backward compatibility
    const featuredPlace = heroCards[0] || null;

    console.log(`Selected ${heroCards.length} hero cards`);

    // Actively remove any hero duplicates from grid cards (mutate in place)
    const heroPlaceIds = new Set(heroCards.map((h: any) => h.placeId));
    for (let i = places.length - 1; i >= 0; i--) {
      if (heroPlaceIds.has(places[i].placeId)) {
        places.splice(i, 1);
      }
    }

    if (places.length === 0) {
      return new Response(
        JSON.stringify({
          cards: [],
          featuredCard: null,
          meta: {
            totalResults: 0,
            message: "No places found near your location",
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Calculate travel times for all places (including hero cards)
    const allPlacesToProcess = [...places, ...heroCards];
    const placesWithTravel = await annotateWithTravel(allPlacesToProcess, location, travelMode);

    // Enrich with AI descriptions
    const enrichedPlaces = await enrichWithAI(placesWithTravel);

    // Separate grid cards from hero cards
    const gridPlaces = enrichedPlaces.slice(0, places.length);
    const enrichedHeroPlaces = enrichedPlaces.slice(places.length);

    // Convert to card format - grid cards (one per non-hero category)
    const cards = gridPlaces.map((place) => convertToCard(place));

    // Convert hero places to card format
    const heroCardResults = enrichedHeroPlaces.map((place) => convertToCard(place));

    // Backward compat: featuredCard = first hero
    const featuredCard = heroCardResults[0] || null;

    // Compute all place IDs in this batch (heroes + grid) for next-rotation exclusion
    const allBatchPlaceIds = [
      ...heroCardResults.map((c: any) => c.placeId || c.id),
      ...cards.map((c: any) => c.placeId || c.id),
    ].filter(Boolean);

    // 24-hour expiry timestamp
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    if (adminClient && userId && cards.length > 0) {
      // Delete only the cache row matching this categoryHash (not all rows for this user+date)
      await adminClient
        .from("discover_daily_cache")
        .delete()
        .eq("user_id", userId)
        .filter("generated_location->>categoryHash", "eq", categoryHash);

      const { error: cacheWriteError } = await adminClient
        .from("discover_daily_cache")
        .insert({
          user_id: userId,
          us_date_key: usDateKey,
          cards,
          featured_card: featuredCard,
          expires_at: expiresAt,
          all_place_ids: allBatchPlaceIds,
          previous_batch_place_ids: previousBatchPlaceIds,
          generated_location: {
            lat: location.lat,
            lng: location.lng,
            radius,
            categoryHash,
            heroCards: heroCardResults,
          },
        });

      if (cacheWriteError) {
        console.warn("Discover daily cache write warning:", cacheWriteError.message);
      } else {
        console.log(`Persisted discover daily cache for user ${userId} (${usDateKey})`);
      }
    }

    // ── Pool storage: store generated cards in card_pool (fire-and-forget) ──
    if (adminClient) {
      const allCardsToStore = [...cards, ...heroCardResults];
      const poolCardIds: string[] = [];
      (async () => {
        try {
          for (const card of allCardsToStore) {
            const placePoolId = await upsertPlaceToPool(
              adminClient,
              {
                id: card.placeId,
                placeId: card.placeId,
                displayName: { text: card.title },
                name: card.title,
                formattedAddress: card.address,
                location: { latitude: card.lat, longitude: card.lng },
                rating: card.rating,
                userRatingCount: card.reviewCount,
                types: [],
                photos: [],
                priceLevel: 0,
                regularOpeningHours: card.openingHours,
                websiteUri: card.website || null,
              },
              GOOGLE_API_KEY!,
              'discover_experiences'
            );

            const cardPoolId = await insertCardToPool(adminClient, {
              placePoolId: placePoolId || undefined,
              googlePlaceId: card.placeId,
              cardType: 'single',
              title: card.title,
              category: card.category,
              categories: [card.category],
              description: card.description,
              highlights: card.highlights,
              imageUrl: card.image,
              images: card.images,
              address: card.address,
              lat: card.lat,
              lng: card.lng,
              rating: card.rating,
              reviewCount: card.reviewCount,
              priceMin: 0,
              priceMax: 0,
              openingHours: card.openingHours,
              website: card.website || null,
            });

            if (cardPoolId) poolCardIds.push(cardPoolId);
          }

          if (userId && poolCardIds.length > 0) {
            await recordImpressions(adminClient, userId, poolCardIds);
          }

          console.log(`[pool-storage] Stored ${poolCardIds.length} discover cards in pool`);
        } catch (e) {
          console.warn('[pool-storage] Error storing discover cards:', e);
        }
      })();
    }

    console.log(`Returning ${cards.length} grid cards + ${heroCardResults.length} hero cards (expires: ${expiresAt})`);

    return new Response(
      JSON.stringify({
        cards,               // Grid cards (excluding Fine Dining and Play)
        heroCards: heroCardResults,  // [Fine Dining card, Play card]
        featuredCard,        // Backward compat: heroCards[0]
        expiresAt,           // 24h expiry timestamp for client-side caching
        meta: {
          totalResults: cards.length,
          heroCount: heroCardResults.length,
          categories: categoriesToFetch,
          successfulCategories,
          failedCategories,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in discover-experiences:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        cards: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Fetch candidate places for a specific category (returns multiple for deduplication)
 */
async function fetchCandidatesForCategory(
  category: string,
  location: { lat: number; lng: number },
  radius: number,
  adminClient: any
): Promise<DiscoverPlace[]> {
  const placeTypes = getPlaceTypesForCategory(category);
  if (!placeTypes || placeTypes.length === 0) {
    console.warn(`No place types defined for category: ${category}`);
    return [];
  }

  try {
    // Use batchSearchPlaces (each type searched separately for better caching)
    let allPlaces: any[] = [];

    if (adminClient) {
      const { results: typeResults } = await batchSearchPlaces(
        adminClient,
        GOOGLE_API_KEY!,
        placeTypes,
        location.lat,
        location.lng,
        radius,
        { maxResultsPerType: 20, rankPreference: 'POPULARITY', ttlHours: 24 }
      );

      // Merge and deduplicate results by place.id
      const seenIds = new Set<string>();
      for (const places of Object.values(typeResults)) {
        for (const place of places) {
          if (!seenIds.has(place.id)) {
            seenIds.add(place.id);
            allPlaces.push(place);
          }
        }
      }
    } else {
      // Fallback: direct API call if no admin client available
      const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";
      const fieldMask = [
        "places.id","places.displayName","places.location","places.formattedAddress",
        "places.priceLevel","places.rating","places.userRatingCount",
        "places.photos","places.types","places.regularOpeningHours",
        "places.websiteUri",
      ].join(",");

      const requestBody = {
        includedTypes: placeTypes,
        maxResultCount: 20,
        locationRestriction: {
          circle: { center: { latitude: location.lat, longitude: location.lng }, radius },
        },
        rankPreference: "POPULARITY",
      };

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY!,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Google Places API error for ${category}:`, response.status, errorText);
        return [];
      }

      const data = await response.json();
      allPlaces = data.places || [];
    }

    if (allPlaces.length === 0) {
      console.log(`No places found for category: ${category}`);
      return [];
    }

    // Filter out excluded types
    const validPlaces = allPlaces.filter((place: any) => {
      const placeTypeSet = new Set(place.types || []);
      return !DISCOVER_EXCLUDED_PLACE_TYPES.some((excluded) => placeTypeSet.has(excluded));
    });

    if (validPlaces.length === 0) {
      console.log(`All places filtered out for category: ${category}`);
      return [];
    }

    // Sort by best (highest rating with enough reviews)
    const sortedPlaces = validPlaces.sort((a: any, b: any) => {
      const aScore = (a.rating || 0) * Math.min(1, (a.userRatingCount || 0) / 100);
      const bScore = (b.rating || 0) * Math.min(1, (b.userRatingCount || 0) / 100);
      return bScore - aScore;
    });

    // Transform all valid places to DiscoverPlace format
    return sortedPlaces.map((place: any) => transformPlaceToDiscoverPlace(place, category, location));
  } catch (error) {
    console.error(`Error fetching places for category ${category}:`, error);
    return [];
  }
}

/**
 * Transform a Google Places API place to DiscoverPlace format
 */
function transformPlaceToDiscoverPlace(
  place: any,
  category: string,
  location: { lat: number; lng: number }
): DiscoverPlace {
  // Extract photo URL
  const primaryPhoto = place.photos?.[0];
  const imageUrl = primaryPhoto?.name
    ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
    : null;

  const images = (place.photos || [])
    .slice(0, 5)
    .map((photo: any) =>
      photo.name
        ? `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
        : null
    )
    .filter((img: string | null): img is string => img !== null);

  // Convert price level to min/max using shared tier system
  const priceRange = priceLevelToRange(place.priceLevel);
  const priceTier = googleLevelToTierSlug(place.priceLevel);

  return {
    id: place.id,
    name: place.displayName?.text || "Unknown Place",
    category: category,
    location: {
      lat: place.location?.latitude || location.lat,
      lng: place.location?.longitude || location.lng,
    },
    address: place.formattedAddress || "",
    rating: place.rating || 0,
    reviewCount: place.userRatingCount || 0,
    imageUrl,
    images,
    placeId: place.id,
    openingHours: place.regularOpeningHours
      ? {
          open_now: place.regularOpeningHours.openNow || false,
          weekday_text: place.regularOpeningHours.weekdayDescriptions || [],
        }
      : null,
    priceLevel: place.priceLevel,
    price_min: priceRange.min,
    price_max: priceRange.max,
    priceTier,
    placeTypes: place.types || [],
    website: place.websiteUri || null,
  };
}

/**
 * Add travel time and distance to places
 */
async function annotateWithTravel(
  places: DiscoverPlace[],
  origin: { lat: number; lng: number },
  travelMode: string = 'walking',
): Promise<(DiscoverPlace & { distance: string; travelTime: string; distanceKm: number; travelTimeMin: number })[]> {
  // Map Mingla travel modes to Google Distance Matrix API modes
  const GOOGLE_MODE_MAP: Record<string, string> = {
    walking: 'walking',
    driving: 'driving',
    transit: 'transit',
    bicycling: 'bicycling',
    biking: 'bicycling',
  };
  const googleMode = GOOGLE_MODE_MAP[travelMode] || 'walking';

  if (!GOOGLE_API_KEY || places.length === 0) {
    return places.map((p) => ({
      ...p,
      distance: "Unknown",
      travelTime: "Unknown",
      distanceKm: 0,
      travelTimeMin: 0,
    }));
  }

  try {
    const destinations = places
      .map((p) => `${p.location.lat},${p.location.lng}`)
      .join("|");

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destinations}&mode=${googleMode}&key=${GOOGLE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Distance Matrix API error:", response.status);
      return places.map((p) => ({
        ...p,
        distance: "Unknown",
        travelTime: "Unknown",
        distanceKm: 0,
        travelTimeMin: 0,
      }));
    }

    const data = await response.json();

    if (data.status !== "OK") {
      console.error("Distance Matrix API status:", data.status);
      return places.map((p) => ({
        ...p,
        distance: "Unknown",
        travelTime: "Unknown",
        distanceKm: 0,
        travelTimeMin: 0,
      }));
    }

    return places.map((place, index) => {
      const element = data.rows[0]?.elements[index];
      if (element?.status === "OK") {
        const distanceKm = element.distance.value / 1000;
        const travelTimeMin = Math.round(element.duration.value / 60);
        return {
          ...place,
          distance: `${distanceKm.toFixed(1)} km`,
          travelTime: `${travelTimeMin} min`,
          distanceKm,
          travelTimeMin,
        };
      }
      return {
        ...place,
        distance: "Unknown",
        travelTime: "Unknown",
        distanceKm: 0,
        travelTimeMin: 0,
      };
    });
  } catch (error) {
    console.error("Error getting travel times:", error);
    return places.map((p) => ({
      ...p,
      distance: "Unknown",
      travelTime: "Unknown",
      distanceKm: 0,
      travelTimeMin: 0,
    }));
  }
}

/**
 * Enrich places with AI-generated descriptions
 */
async function enrichWithAI(places: any[]): Promise<any[]> {
  if (!OPENAI_API_KEY) {
    return places.map((place) => ({
      ...place,
      description: generateFallbackDescription(place),
      highlights: generateFallbackHighlights(place),
    }));
  }

  // Generate descriptions in parallel for efficiency
  const enriched = await Promise.all(
    places.map(async (place) => {
      try {
        const [description, highlights] = await Promise.all([
          generateDescription(place),
          generateHighlights(place),
        ]);
        return {
          ...place,
          description,
          highlights,
        };
      } catch (error) {
        console.error(`Error enriching ${place.name}:`, error);
        return {
          ...place,
          description: generateFallbackDescription(place),
          highlights: generateFallbackHighlights(place),
        };
      }
    })
  );

  return enriched;
}

async function generateDescription(place: any): Promise<string> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a travel experience writer. Write engaging, concise descriptions (max 2 lines, 150 characters) for places and experiences.",
          },
          {
            role: "user",
            content: `Write a 2-line engaging description for "${place.name}", a ${place.category} experience. Include what makes it special. Keep it under 150 characters total.`,
          },
        ],
        max_tokens: 100,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || generateFallbackDescription(place);
  } catch (error) {
    return generateFallbackDescription(place);
  }
}

async function generateHighlights(place: any): Promise<string[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Extract the top 2 most compelling highlights for a place. Return only 2 short phrases (max 3 words each), separated by commas.",
          },
          {
            role: "user",
            content: `Extract top 2 highlights for "${place.name}" (${place.category}). Rating: ${place.rating}, Reviews: ${place.reviewCount}. Return only 2 short phrases, comma-separated.`,
          },
        ],
        max_tokens: 30,
        temperature: 0.5,
      }),
    });

    const data = await response.json();
    const highlights =
      data.choices[0]?.message?.content
        ?.split(",")
        .map((h: string) => h.trim())
        .slice(0, 2) || [];
    return highlights.length > 0 ? highlights : generateFallbackHighlights(place);
  } catch (error) {
    return generateFallbackHighlights(place);
  }
}

function generateFallbackDescription(place: any): string {
  const descriptions: { [key: string]: string } = {
    "Nature": "Scenic outdoor adventure through beautiful natural surroundings. Perfect for relaxation and exploration.",
    "First Meet": "A welcoming spot to break the ice and spark great conversation.",
    "Picnic": "Beautiful outdoor space perfect for a relaxing picnic experience.",
    "Drink": "Cozy spot for great drinks and conversation in a relaxed atmosphere.",
    "Casual Eats": "Delicious food in a welcoming environment. Great for any occasion.",
    "Fine Dining": "Exceptional culinary journey with outstanding service.",
    "Watch": "Entertainment and relaxation combined for a perfect outing.",
    "Creative & Arts": "Engage your creativity in an inspiring artistic environment.",
    "Play": "Fun and active entertainment for an exciting time out.",
    "Wellness": "Relax and rejuvenate in a peaceful wellness setting.",
    "Groceries & Flowers": "Fresh groceries, produce, and flowers for every occasion.",
    "Work & Business": "Quiet cafe or tea house — perfect for focused work or a business meeting.",
  };
  return descriptions[place.category] || "An amazing experience waiting for you.";
}

function generateFallbackHighlights(place: any): string[] {
  const highlights: { [key: string]: string[] } = {
    "Nature": ["Scenic Views", "Nature Trail"],
    "First Meet": ["Great Atmosphere", "Conversation Starter"],
    "Picnic": ["Outdoor", "Relaxing"],
    "Drink": ["Great Atmosphere", "Quality Drinks"],
    "Casual Eats": ["Tasty Food", "Good Service"],
    "Fine Dining": ["Fine Cuisine", "Elegant"],
    "Watch": ["Entertainment", "Comfortable"],
    "Creative & Arts": ["Artistic", "Interactive"],
    "Play": ["Fun Activities", "Exciting"],
    "Wellness": ["Relaxing", "Rejuvenating"],
    "Groceries & Flowers": ["Fresh Produce", "Convenient"],
    "Work & Business": ["WiFi Friendly", "Quiet Space"],
  };
  return highlights[place.category] || ["Great Experience", "Highly Rated"];
}

/**
 * Convert enriched place to card format
 */
function convertToCard(place: any): any {
  return {
    id: place.id,
    title: place.name,
    category: place.category,
    matchScore: calculateSimpleScore(place),
    image: place.imageUrl || "https://images.unsplash.com/photo-1441986300917-64674bd600d8",
    images: place.images || [],
    rating: place.rating || 4.0,
    reviewCount: place.reviewCount || 0,
    travelTime: place.travelTime || "15 min",
    distance: place.distance || "3 km",
    priceRange: formatPriceRange(place.price_min, place.price_max),
    priceTier: place.priceTier || priceTierFromAmount(place.price_min, place.price_max),
    description: place.description || generateFallbackDescription(place),
    highlights: place.highlights || generateFallbackHighlights(place),
    address: place.address || "",
    lat: place.location.lat,
    lng: place.location.lng,
    placeId: place.placeId,
    openingHours: place.openingHours || null,
    website: place.website || null,
  };
}

function calculateSimpleScore(place: any): number {
  // Simple score based on rating and review count
  const rating = place.rating || 0;
  const reviewCount = place.reviewCount || 0;
  
  const ratingScore = (rating / 5) * 60;
  const reviewScore = Math.min(40, (reviewCount / 500) * 40);
  
  return Math.round(ratingScore + reviewScore);
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
