import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordImpressions } from '../_shared/cardPoolService.ts';
import {
  ALL_CATEGORY_NAMES,
  CATEGORY_MIN_PRICE_TIER,
  HIDDEN_CATEGORIES,
  toSlug,
  toDisplay,
} from '../_shared/categoryPlaceTypes.ts';
import { priceTierFromAmount, slugMeetsMinimum } from '../_shared/priceTiers.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Environment variables
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
      nature: "Nature & Views",
      first_meet: "First Meet",
      picnic_park: "Picnic Park",
      picnic: "Picnic Park",           // legacy compat
      drink: "Drink",
      casual_eats: "Casual Eats",
      fine_dining: "Fine Dining",
      watch: "Watch",
      live_performance: "Live Performance",
      creative_arts: "Creative & Arts",
      play: "Play",
      wellness: "Wellness",
      flowers: "Flowers",
      groceries_flowers: "Flowers",    // legacy compat
      // groceries intentionally omitted — hidden category
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

    // Resolve which categories to fetch: filter by user selection, exclude hidden
    let categoriesToFetch = ALL_CATEGORY_NAMES.filter(c => !HIDDEN_CATEGORIES.has(c));
    if (selectedCategories && selectedCategories.length > 0) {
      const resolvedLabels = new Set<string>();
      for (const cat of selectedCategories) {
        const resolved = resolveCategory(cat);
        if (resolved) resolvedLabels.add(resolved);
      }
      if (resolvedLabels.size > 0) {
        categoriesToFetch = ALL_CATEGORY_NAMES.filter((c) => resolvedLabels.has(c) && !HIDDEN_CATEGORIES.has(c));
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
                  const candidate = cachedGridCards.find((c: any) => (c.category === heroCat || c.category === toSlug(heroCat)) && !heroUsedIds.has(c.id));
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

    // ── Auth guard: reject if auth failed ──
    if (!adminClient || !userId) {
      console.warn('[discover] Auth failed — returning 401. adminClient:', !!adminClient, 'userId:', !!userId);
      return new Response(
        JSON.stringify({
          error: 'auth_required',
          cards: [],
          heroCards: [],
          featuredCard: null,
          expiresAt: null,
          meta: { authFailed: true },
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
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
              .eq('category', toSlug(cat))
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

            const categorySlug = toSlug(category);
            // Prefer cards NOT in previous batch (24h rotation)
            let candidates = availableCards.filter(
              (c: any) => c.category === categorySlug && !usedIds.has(c.id) && !prevExclude.has(c.google_place_id || c.id) && priceFilter(c)
            );
            if (candidates.length === 0) {
              // Category exhaustion fallback: allow previous batch cards
              candidates = availableCards.filter(
                (c: any) => c.category === categorySlug && !usedIds.has(c.id) && priceFilter(c)
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
              category: toDisplay(card.category),
              matchScore: card.base_match_score || 85,
              image: card.image_url || null,
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
              heroImage: card.image_url || null,
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
              const rotSlug = toSlug(category);
              const candidates = rotationCards.filter(
                (c: any) => c.category === rotSlug && !rotationUsedIds.has(c.id)
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
      } catch (poolError) {
        console.warn("[pool-first] Pool query failed:", poolError);
      }
    }

    // Pool empty at this location — return empty (no Google/place_pool fallback)
    console.log('[pool-only] No cards available in card_pool for this location');
    return new Response(
      JSON.stringify({
        cards: [],
        heroCards: [],
        featuredCard: null,
        expiresAt: null,
        meta: {
          totalResults: 0,
          heroCount: 0,
          categories: categoriesToFetch,
          successfulCategories: [],
          failedCategories: categoriesToFetch,
          poolFirst: true,
          fromPool: 0,
          fromApi: 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
