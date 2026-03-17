import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchSearchByCategory, searchPlacesWithCache } from '../_shared/placesCache.ts';
import { upsertPlaceToPool, insertCardToPool, recordImpressions } from '../_shared/cardPoolService.ts';
import {
  getPlaceTypesForCategory,
  getExcludedTypesForCategory,
  ALL_CATEGORY_NAMES,
  DISCOVER_EXCLUDED_PLACE_TYPES,
  CATEGORY_MIN_PRICE_TIER,
  getTextKeywords,
} from '../_shared/categoryPlaceTypes.ts';
import { priceLevelToRange, googleLevelToTierSlug, priceTierFromAmount, tierMeetsMinimum, slugMeetsMinimum } from '../_shared/priceTiers.ts';
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
    const body = await req.json();

    // ── Keep-warm ping: boot the isolate without running business logic ──
    if (body.warmPing) {
      return new Response(JSON.stringify({ status: 'warm' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const request: DiscoverRequest = body;
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

        // Per-category queries to prevent popularity starvation (Fix 3A)
        const CARDS_PER_CATEGORY = 50;
        let allPoolCards: any[] = [];

        await Promise.all(
          categoriesToFetch.map(async (cat) => {
            const { data } = await adminClient!
              .from('card_pool')
              .select('id, google_place_id, title, category, image_url, images, rating, review_count, price_min, price_max, price_tier, lat, lng, opening_hours, address, website, description, highlights, base_match_score, popularity_score')
              .eq('is_active', true)
              .eq('card_type', 'single')
              .eq('category', cat)
              .gte('lat', location.lat - latDelta)
              .lte('lat', location.lat + latDelta)
              .gte('lng', location.lng - lngDelta)
              .lte('lng', location.lng + lngDelta)
              .order('popularity_score', { ascending: false })
              .limit(CARDS_PER_CATEGORY);

            if (data && data.length > 0) {
              allPoolCards = allPoolCards.concat(data);
            }
          })
        );

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
            // Per-category price floor (e.g. Fine Dining = bougie+)
            const minTier = CATEGORY_MIN_PRICE_TIER[category];
            const priceFilter = (c: any) => !minTier || slugMeetsMinimum(c.price_tier, minTier);

            // Prefer cards NOT in previous batch (24h rotation)
            let candidates = availableCards.filter(
              (c: any) => c.category === category && !usedIds.has(c.id) && !prevExclude.has(c.google_place_id || c.id) && priceFilter(c)
            );
            if (candidates.length === 0) {
              // Category exhaustion fallback: allow previous batch cards
              candidates = availableCards.filter(
                (c: any) => c.category === category && !usedIds.has(c.id) && priceFilter(c)
              );
              if (candidates.length > 0) {
                console.log(`⚠ [pool-first] "${category}" exhausted fresh places — reusing from previous batch`);
              }
            }
            // Already sorted by popularity_score DESC from the query
            return candidates.length > 0 ? candidates[0] : null;
          };

          // Helper: convert pool DB row to API card format
          const POOL_SPEED_KMH: Record<string, number> = { walking: 4.5, driving: 40, transit: 25, public_transit: 25, bicycling: 15, biking: 15 };
          const poolRowToApiCard = (card: any): any => {
            const distKm = (card.lat != null && card.lng != null)
              ? Math.round(haversineDistance(location.lat, location.lng, card.lat, card.lng) * 100) / 100
              : 0;
            const poolSpeed = POOL_SPEED_KMH[travelMode] || 4.5;
            const travelMin = Math.max(1, Math.round((distKm / poolSpeed) * 60));

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

          // ── TIER DECISION: Pool-only, rotation, or cold-start ────────────
          const servedCardsCount = poolHeroCards.length + poolGridCards.length;

          // Impression rotation: if pool has cards but all are seen, re-pick
          // from least-recently-seen (mirrors query_pool_cards Change 8)
          if (servedCardsCount === 0 && allPoolCards.length > 0) {
            console.log(`[pool-first] Impression saturation — rotating least-recently-seen cards`);

            // Fetch impression timestamps for rotation ordering
            const { data: impTimestamps } = await adminClient
              .from('user_card_impressions')
              .select('card_pool_id, created_at')
              .eq('user_id', userId)
              .in('card_pool_id', allPoolCards.map((c: any) => c.id));

            const impMap = new Map((impTimestamps || []).map((i: any) => [i.card_pool_id, i.created_at]));

            // Dedup by google_place_id, sort by oldest impression first
            const rotationPlaces = new Set<string>();
            const rotationCards = allPoolCards
              .filter((card: any) => {
                const placeKey = card.google_place_id || card.id;
                if (rotationPlaces.has(placeKey)) return false;
                rotationPlaces.add(placeKey);
                return true;
              })
              .sort((a: any, b: any) => {
                const aTime = impMap.get(a.id) || '1970-01-01';
                const bTime = impMap.get(b.id) || '1970-01-01';
                return (aTime as string).localeCompare(bTime as string);
              });

            // Re-pick hero + grid from rotated cards
            const rotationUsedIds = new Set<string>();
            const rotationFindBest = (category: string): any | null => {
              const candidates = rotationCards.filter(
                (c: any) => c.category === category && !rotationUsedIds.has(c.id)
              );
              return candidates.length > 0 ? candidates[0] : null;
            };

            for (const heroCategory of HERO_CATEGORIES_RESOLVED) {
              const card = rotationFindBest(heroCategory);
              if (card) {
                poolHeroCards.push(poolRowToApiCard(card));
                rotationUsedIds.add(card.id);
                poolCoveredCategories.add(heroCategory);
              }
            }
            for (const category of categoriesToFetch) {
              if (HERO_CATEGORIES_RESOLVED.includes(category)) continue;
              if (poolCoveredCategories.has(category)) continue;
              const card = rotationFindBest(category);
              if (card) {
                poolGridCards.push(poolRowToApiCard(card));
                rotationUsedIds.add(card.id);
                poolCoveredCategories.add(category);
              }
            }

            console.log(`[pool-first] Rotation serve: ${poolCoveredCategories.size}/${categoriesToFetch.length} categories, ${poolHeroCards.length} heroes + ${poolGridCards.length} grid`);
          }

          if (poolHeroCards.length + poolGridCards.length > 0) {
            // Pool has coverage — serve from pool, zero Google calls.
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

            console.log(`[pool-first] Pool-only serve: ${poolCoveredCategories.size}/${categoriesToFetch.length} categories, ${poolHeroCards.length} heroes + ${poolGridCards.length} grid (0 Google API calls)`);

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
                  fromPool: poolHeroCards.length + poolGridCards.length,
                  fromApi: 0,
                },
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

        } else {
          console.log(`[pool-first] No pool cards in geo area.`);
        }

          console.log(`[pool-first] Pool completely empty at this location. Cold-start API fallback.`);
      } catch (poolError) {
        console.warn("[pool-first] Pool query failed, falling back to Google API:", poolError);
      }
    }

    // ── Place pool fallback — build cards from existing places, no Google ──
    if (adminClient) {
      try {
        const ppLatDelta = radius / 111320;
        const ppLngDelta = radius / (111320 * Math.cos(location.lat * Math.PI / 180));
        const ppHeroCards: any[] = [];
        const ppGridCards: any[] = [];
        const ppServedPlaceIds = new Set<string>();
        const ppCoveredCategories = new Set<string>();

        // Query place_pool per category using types overlap
        for (const category of categoriesToFetch) {
          const placeTypes = getPlaceTypesForCategory(category);
          if (placeTypes.length === 0) continue;

          const { data: places } = await adminClient
            .from('place_pool')
            .select('id, google_place_id, name, address, lat, lng, types, primary_type, rating, review_count, price_level, price_min, price_max, price_tier, opening_hours, photos, website, stored_photo_urls')
            .eq('is_active', true)
            .gte('lat', location.lat - ppLatDelta)
            .lte('lat', location.lat + ppLatDelta)
            .gte('lng', location.lng - ppLngDelta)
            .lte('lng', location.lng + ppLngDelta)
            .overlaps('types', placeTypes)
            .order('rating', { ascending: false })
            .limit(5);

          if (!places || places.length === 0) continue;

          for (const place of places) {
            const gpid = place.google_place_id;
            if (!gpid || ppServedPlaceIds.has(gpid)) continue;
            ppServedPlaceIds.add(gpid);

            const distKm = haversineDistance(location.lat, location.lng, place.lat, place.lng);
            const SPEED_KMH: Record<string, number> = { walking: 4.5, driving: 40, transit: 25, public_transit: 25, bicycling: 15, biking: 15 };
            const speed = SPEED_KMH[travelMode] || 4.5;
            const travelMin = Math.max(1, Math.round((distKm / speed) * 60));

            const storedUrls = place.stored_photo_urls;
            const imageUrl = (storedUrls && storedUrls.length > 0)
              ? storedUrls[0]
              : 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

            const parsedOH = place.opening_hours || null;
            const isOpenNow = parsedOH?._isOpenNow ?? null;
            const hours = parsedOH ? { ...parsedOH } : null;
            if (hours) delete hours._isOpenNow;

            const card = {
              id: gpid,
              placeId: gpid,
              title: place.name,
              category,
              matchScore: 85,
              image: imageUrl || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
              images: [],
              rating: place.rating || 0,
              reviewCount: place.review_count || 0,
              priceMin: place.price_min ?? 0,
              priceMax: place.price_max ?? 0,
              priceRange: formatPriceRange(place.price_min ?? 0, place.price_max ?? 0),
              priceTier: place.price_tier || priceTierFromAmount(place.price_min ?? 0, place.price_max ?? 0),
              distanceKm: Math.round(distKm * 100) / 100,
              travelTimeMin: travelMin,
              travelTime: `${travelMin} min`,
              distance: `${Math.round(distKm * 10) / 10} km`,
              isOpenNow,
              openingHours: hours,
              description: '',
              highlights: [],
              address: place.address || '',
              website: place.website || null,
              lat: place.lat,
              lng: place.lng,
              heroImage: imageUrl || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
            };

            // Hero categories go to hero cards, rest to grid
            if (HERO_CATEGORIES_RESOLVED.includes(category) && ppHeroCards.length < 2) {
              ppHeroCards.push(card);
            } else {
              ppGridCards.push(card);
            }
            ppCoveredCategories.add(category);

            // Insert into card_pool for future requests (fire-and-forget)
            insertCardToPool(adminClient, {
              placePoolId: place.id,
              googlePlaceId: gpid,
              cardType: 'single',
              title: place.name,
              category,
              categories: [category],
              imageUrl: imageUrl || undefined,
              images: [],
              address: place.address || '',
              lat: place.lat,
              lng: place.lng,
              rating: place.rating || 0,
              reviewCount: place.review_count || 0,
              priceMin: place.price_min ?? 0,
              priceMax: place.price_max ?? 0,
              openingHours: place.opening_hours,
              website: place.website,
              priceTier: place.price_tier || googleLevelToTierSlug(place.price_level),
              priceLevel: place.price_level,
            }).catch(() => {});
            break; // One place per category for the grid
          }
        }

        if (ppHeroCards.length + ppGridCards.length > 0) {
          const ppFeaturedCard = ppHeroCards[0] || ppGridCards[0] || null;
          const ppExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          const ppAllPlaceIds = [
            ...ppHeroCards.map((c: any) => c.placeId || c.id),
            ...ppGridCards.map((c: any) => c.placeId || c.id),
          ].filter(Boolean);

          // Impressions: cards were just inserted into card_pool (fire-and-forget),
          // so IDs aren't available yet. The daily cache prevents re-calling for 24h.
          // On the next request (after cache expires), cards will be in card_pool
          // and the normal impression recording path handles it.

          // Write to daily cache so mobile doesn't call again for 24h
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
                  cards: ppGridCards,
                  featured_card: ppFeaturedCard,
                  expires_at: ppExpiresAt,
                  all_place_ids: ppAllPlaceIds,
                  previous_batch_place_ids: previousBatchPlaceIds,
                  generated_location: {
                    lat: location.lat,
                    lng: location.lng,
                    radius,
                    categoryHash,
                    heroCards: ppHeroCards,
                  },
                })
            )
            .catch((e: any) => console.warn("[place-pool-fallback] Cache write error:", e));

          console.log(`[place-pool-fallback] Served ${ppCoveredCategories.size}/${categoriesToFetch.length} categories from place_pool (0 Google API calls)`);

          return new Response(
            JSON.stringify({
              cards: ppGridCards,
              heroCards: ppHeroCards,
              featuredCard: ppFeaturedCard,
              expiresAt: ppExpiresAt,
              meta: {
                totalResults: ppGridCards.length,
                heroCount: ppHeroCards.length,
                categories: categoriesToFetch,
                successfulCategories: Array.from(ppCoveredCategories),
                failedCategories: categoriesToFetch.filter(c => !ppCoveredCategories.has(c)),
                poolFirst: true,
                fromPool: ppHeroCards.length + ppGridCards.length,
                fromApi: 0,
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`[place-pool-fallback] No matching places in place_pool for this area`);
      } catch (ppErr) {
        console.warn("[place-pool-fallback] Place pool fallback failed:", ppErr);
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
  const textKeywords = getTextKeywords(category);
  const placeTypes = getPlaceTypesForCategory(category);

  if (!textKeywords && (!placeTypes || placeTypes.length === 0)) {
    console.warn(`No place types or text keywords defined for category: ${category}`);
    return [];
  }

  try {
    let allPlaces: any[] = [];
    const seenIds = new Set<string>();

    if (textKeywords && adminClient) {
      // ── Text Search path (e.g. Fine Dining) ──────────────────────────
      const keywordResults = await Promise.all(
        textKeywords.map(keyword =>
          searchPlacesWithCache({
            supabaseAdmin: adminClient,
            apiKey: GOOGLE_API_KEY!,
            placeType: `text:${category.toLowerCase().replace(/\s+/g, '_')}:${keyword.replace(/\s+/g, '_')}`,
            lat: location.lat,
            lng: location.lng,
            radiusMeters: radius,
            maxResults: 20,
            strategy: 'text',
            textQuery: keyword,
          })
        )
      );

      for (const result of keywordResults) {
        for (const place of result.places) {
          if (place.id && !seenIds.has(place.id)) {
            seenIds.add(place.id);
            allPlaces.push(place);
          }
        }
      }
      console.log(`[${category}] Text search: ${textKeywords.length} keywords → ${allPlaces.length} unique places`);
    } else if (adminClient) {
      // ── Nearby Search path (all other categories) ─────────────────────
      const categoryTypeMap = { [category]: placeTypes! };
      const { results: catResults } = await batchSearchByCategory(
        adminClient,
        GOOGLE_API_KEY!,
        categoryTypeMap,
        location.lat,
        location.lng,
        radius,
        { maxResultsPerCategory: 20, rankPreference: 'POPULARITY', ttlHours: 24 }
      );

      for (const places of Object.values(catResults)) {
        for (const place of places) {
          if (!seenIds.has(place.id)) {
            seenIds.add(place.id);
            allPlaces.push(place);
          }
        }
      }
    } else {
      // Fallback: direct Nearby Search API call if no admin client
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

    // Filter out excluded types (discovery-level + category-specific)
    const categoryExcluded = getExcludedTypesForCategory(category);
    const allExcluded = new Set([...DISCOVER_EXCLUDED_PLACE_TYPES, ...categoryExcluded]);
    const validPlaces = allPlaces.filter((place: any) => {
      const placeTypes = place.types || [];
      return !placeTypes.some((t: string) => allExcluded.has(t));
    });

    if (validPlaces.length === 0) {
      console.log(`All places filtered out for category: ${category}`);
      return [];
    }

    // Apply per-category price floor (e.g. Fine Dining = bougie+)
    const minTier = CATEGORY_MIN_PRICE_TIER[category];
    const pricedPlaces = minTier
      ? validPlaces.filter((p: any) => tierMeetsMinimum(p.priceLevel, minTier))
      : validPlaces;

    if (minTier && pricedPlaces.length < validPlaces.length) {
      console.log(`[${category}] Price floor (${minTier}+): ${validPlaces.length} → ${pricedPlaces.length} places`);
    }

    if (pricedPlaces.length === 0) {
      console.log(`All places below price floor for category: ${category}`);
      return [];
    }

    // Sort by best (highest rating with enough reviews)
    const sortedPlaces = pricedPlaces.sort((a: any, b: any) => {
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
  const imageUrl = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

  const images: string[] = [];

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
 * Add travel time and distance to places (haversine-based estimation)
 */
async function annotateWithTravel(
  places: DiscoverPlace[],
  origin: { lat: number; lng: number },
  travelMode: string = 'walking',
): Promise<(DiscoverPlace & { distance: string; travelTime: string; distanceKm: number; travelTimeMin: number })[]> {
  // Speed estimates in km/h for haversine-based travel time estimation
  const SPEED_KMH: Record<string, number> = {
    walking: 4.5,
    driving: 40,
    transit: 25,
    public_transit: 25,
    bicycling: 15,
    biking: 15,
  };

  return places.map((p) => {
    const distKm = haversineDistance(origin.lat, origin.lng, p.location.lat, p.location.lng);
    const speedKmh = SPEED_KMH[travelMode] || 4.5;
    const travelMin = Math.max(1, Math.round((distKm / speedKmh) * 60));

    return {
      ...p,
      distance: `${Math.round(distKm * 10) / 10} km`,
      travelTime: `${travelMin} min`,
      distanceKm: Math.round(distKm * 100) / 100,
      travelTimeMin: travelMin,
    };
  });
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
