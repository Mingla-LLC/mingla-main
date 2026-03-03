import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import { serveCardsFromPipeline, upsertPlaceToPool, insertCardToPool, recordImpressions } from '../_shared/cardPoolService.ts';
import { resolveCategories } from '../_shared/categoryPlaceTypes.ts';

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

// All 12 discover categories
const DISCOVER_CATEGORIES = [
  "Nature",
  "First Meet",
  "Picnic",
  "Drink",
  "Casual Eats",
  "Fine Dining",
  "Watch",
  "Creative & Arts",
  "Play",
  "Wellness",
  "Groceries & Flowers",
  "Work & Business",
];

// Category to Google Places type mapping (using CONFIRMED valid Google Places API New types)
// Reference: https://developers.google.com/maps/documentation/places/web-service/place-types
// Each category uses distinct types where possible to avoid duplicates
const CATEGORY_TO_PLACE_TYPES: { [key: string]: string[] } = {
  "Nature": [
    "park",
    "hiking_area",
    "botanical_garden",
    "national_park",
    "state_park",
    "beach",
    "zoo",
    "wildlife_park",
  ],
  "First Meet": [
    "bookstore",
    "bar",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
    "planetarium",
  ],
  "Picnic": [
    "picnic_ground",
    "park",
    "beach",
    "botanical_garden",
  ],
  "Drink": [
    "bar",
    "pub",
    "wine_bar",
    "tea_house",
    "coffee_shop",
  ],
  "Casual Eats": [
    "sandwich_shop",
    "fast_food_restaurant",
    "pizza_restaurant",
    "hamburger_restaurant",
    "american_restaurant",
    "mexican_restaurant",
    "diner",
  ],
  "Fine Dining": [
    "fine_dining_restaurant",
    "steak_house",
    "french_restaurant",
    "italian_restaurant",
  ],
  "Watch": [
    "movie_theater",
    "comedy_club",
  ],
  "Creative & Arts": [
    "art_gallery",
    "museum",
    "planetarium",
    "karaoke",
  ],
  "Play": [
    "bowling_alley",
    "amusement_park",
    "water_park",
    "video_arcade",
    "escape_room",
    "mini_golf_course",
    "ice_skating_rink",
  ],
  "Wellness": [
    "spa",
    "sauna",
    "hot_spring",
  ],
  "Groceries & Flowers": [
    "grocery_store",
    "supermarket",
  ],
  "Work & Business": [
    "tea_house",
    "coffee_shop",
    "cafe",
  ],
};

// Excluded types to filter out unwanted places
const EXCLUDED_TYPES = new Set([
  "atm",
  "bank",
  "gas_station",
  "parking",
  "car_wash",
  "car_repair",
  "car_dealer",
  "post_office",
  "government_office",
  "police",
  "fire_station",
  "courthouse",
  "city_hall",
  "storage",
  "moving_company",
  "locksmith",
  "plumber",
  "electrician",
  "roofing_contractor",
  "apartment_building",
  "housing_complex",
  "airport",
  "bus_station",
  "train_station",
  "transit_station",
]);

interface DiscoverRequest {
  location: { lat: number; lng: number };
  radius?: number; // Optional radius in meters, default 10km
  selectedCategories?: string[]; // Optional: only fetch these categories (IDs or labels)
  heroCategories?: string[]; // Optional: user's top 2 categories for hero cards
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
    const { location, radius = 10000, selectedCategories } = request;
    const usDateKey = getUsDateKey();

    // Validate heroCategories if provided
    if (request.heroCategories && !Array.isArray(request.heroCategories)) {
      return new Response(
        JSON.stringify({ error: 'heroCategories must be an array of strings' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Dynamic hero categories: use request param or fall back to defaults
    const HERO_CATEGORIES_RESOLVED = request.heroCategories && request.heroCategories.length > 0
      ? request.heroCategories.slice(0, 2)
      : ["Fine Dining", "Play"];

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

    // Resolve which categories to fetch: filter DISCOVER_CATEGORIES by user selection
    let categoriesToFetch = DISCOVER_CATEGORIES;
    if (selectedCategories && selectedCategories.length > 0) {
      // Build a set of valid discover-category labels from whatever format the client sends
      const resolvedLabels = new Set<string>();
      for (const cat of selectedCategories) {
        // Direct label match (e.g. "Nature")
        if (DISCOVER_CATEGORIES.includes(cat)) {
          resolvedLabels.add(cat);
          continue;
        }
        // Preference ID match (e.g. "nature", "fine_dining")
        const mapped = PREF_ID_TO_DISCOVER_CATEGORY[cat];
        if (mapped) {
          resolvedLabels.add(mapped);
          continue;
        }
        // Case-insensitive fallback
        const lowerCat = cat.toLowerCase();
        const found = DISCOVER_CATEGORIES.find((dc) => dc.toLowerCase() === lowerCat);
        if (found) resolvedLabels.add(found);
      }
      if (resolvedLabels.size > 0) {
        categoriesToFetch = DISCOVER_CATEGORIES.filter((c) => resolvedLabels.has(c));
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

          // Include category hash in cache lookup so different preference sets get separate caches
          const cacheQuery = adminClient
            .from("discover_daily_cache")
            .select("cards, featured_card, generated_location")
            .eq("user_id", userId)
            .eq("us_date_key", usDateKey);

          const { data: cachedRows, error: cacheReadError } = await cacheQuery;

          if (cacheReadError) {
            console.warn("Discover daily cache read warning:", cacheReadError.message);
          } else if (cachedRows && cachedRows.length > 0) {
            // Find a row whose generated_location.categoryHash matches the current request
            const matchingRow = cachedRows.find((row: any) =>
              row.generated_location?.categoryHash === categoryHash
            );
            if (matchingRow?.cards && matchingRow.cards.length > 0) {
              console.log(`Cache hit for user ${userId} on ${usDateKey} (hash=${categoryHash}). Returning persisted discover cards.`);
              return new Response(
                JSON.stringify({
                  cards: matchingRow.cards,
                  heroCards: matchingRow.generated_location?.heroCards || [],
                  featuredCard: matchingRow.featured_card,
                  meta: {
                    totalResults: matchingRow.cards.length,
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

    // ── Pool-first pipeline: try to serve from card_pool before hitting Google ──
    if (adminClient && userId) {
      try {
        const poolResult = await serveCardsFromPipeline(
          {
            supabaseAdmin: adminClient,
            userId,
            lat: location.lat,
            lng: location.lng,
            radiusMeters: radius,
            categories: categoriesToFetch,
            budgetMin: 0,
            budgetMax: 500,
            limit: 11, // 10 category cards + 1 featured
            cardType: 'single',
          },
          GOOGLE_API_KEY!,
        );

        if (poolResult.fromPool >= 8) {
          console.log(`[pool-first] Serving ${poolResult.cards.length} discover cards from pool (${poolResult.fromPool} pool, ${poolResult.fromApi} API)`);

          // ── Category-diverse selection from pool cards ──
          const poolHeroCards: any[] = [];
          const poolGridCards: any[] = [];
          const usedCategories = new Set<string>();
          const usedIds = new Set<string>();

          // PASS 1: Extract hero cards (user's preferred categories or defaults)
          for (const heroCategory of HERO_CATEGORIES_RESOLVED) {
            const heroCandidates = poolResult.cards.filter(
              (c: any) => c.category === heroCategory && !usedIds.has(c.id)
            );
            if (heroCandidates.length > 0) {
              const selected = heroCandidates[0]; // Already sorted by popularity from pool
              poolHeroCards.push(selected);
              usedIds.add(selected.id);
              usedCategories.add(heroCategory);
              console.log(`[pool-first] Hero card for ${heroCategory}: "${selected.title}"`);
            } else {
              console.log(`[pool-first] No pool card for hero category: ${heroCategory}`);
            }
          }

          // PASS 2: One card per non-hero category (round-robin diversity)
          for (const category of categoriesToFetch) {
            if (HERO_CATEGORIES_RESOLVED.includes(category)) continue; // Heroes already extracted
            if (usedCategories.has(category)) continue;
            if (poolGridCards.length >= 10) break;

            const candidates = poolResult.cards.filter(
              (c: any) => c.category === category && !usedIds.has(c.id)
            );
            if (candidates.length > 0) {
              const selected = candidates[0];
              poolGridCards.push(selected);
              usedIds.add(selected.id);
              usedCategories.add(category);
            }
          }

          // PASS 3: Fill remaining grid slots (if fewer than 10) from unused pool cards
          if (poolGridCards.length < 10) {
            const remaining = poolResult.cards.filter((c: any) => !usedIds.has(c.id));
            for (const card of remaining) {
              if (poolGridCards.length >= 10) break;
              poolGridCards.push(card);
              usedIds.add(card.id);
            }
          }

          // Backward compat: featuredCard = first hero
          const poolFeaturedCard = poolHeroCards[0] || poolGridCards[0] || null;

          // ── Persist to daily cache (same as Google API path) ──
          if (adminClient && userId) {
            adminClient
              .from("discover_daily_cache")
              .delete()
              .eq("user_id", userId)
              .eq("us_date_key", usDateKey)
              .then(() =>
                adminClient!
                  .from("discover_daily_cache")
                  .insert({
                    user_id: userId,
                    us_date_key: usDateKey,
                    cards: poolGridCards,
                    featured_card: poolFeaturedCard,
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
          }

          return new Response(
            JSON.stringify({
              cards: poolGridCards,
              heroCards: poolHeroCards,
              featuredCard: poolFeaturedCard,
              meta: {
                totalResults: poolGridCards.length,
                heroCount: poolHeroCards.length,
                categories: categoriesToFetch,
                successfulCategories: Array.from(usedCategories),
                failedCategories: categoriesToFetch.filter((c) => !usedCategories.has(c)),
                poolFirst: true,
                fromPool: poolResult.fromPool,
                fromApi: poolResult.fromApi,
              },
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        console.log(`[pool-first] Pool has ${poolResult.fromPool} cards, need >= 8. Falling back to Google API.`);
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

      // Filter out already-used places
      const availableCandidates = candidates.filter(c => !usedPlaceIds.has(c.placeId));
      
      if (availableCandidates.length === 0) {
        failedCategories.push(category);
        console.log(`✗ All ${candidates.length} candidates for ${category} were already used by other categories`);
        continue;
      }

      // Randomly select from top candidates (up to top 5) to add variety on refresh
      const topCandidatesCount = Math.min(5, availableCandidates.length);
      const topCandidates = availableCandidates.slice(0, topCandidatesCount);
      const randomIndex = Math.floor(Math.random() * topCandidates.length);
      const selectedPlace = topCandidates[randomIndex];
      
      usedPlaceIds.add(selectedPlace.placeId);
      places.push(selectedPlace);
      successfulCategories.push(category);
      console.log(`✓ Selected for ${category}: "${selectedPlace.name}" (rating: ${selectedPlace.rating}, reviews: ${selectedPlace.reviewCount}) [picked ${randomIndex + 1} of ${topCandidates.length} top candidates]`);
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
      const heroCandidates = allUnusedCandidates.filter(
        (c) => c.category === heroCategory && !usedPlaceIds.has(c.placeId)
      );

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

    // Verify heroes are different from all grid cards
    const gridPlaceIds = places.map(p => p.placeId);
    for (const hero of heroCards) {
      if (gridPlaceIds.includes(hero.placeId)) {
        console.error(`BUG: Hero card placeId ${hero.placeId} is in grid cards!`);
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
    const placesWithTravel = await annotateWithTravel(allPlacesToProcess, location);

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

    if (adminClient && userId && cards.length > 0) {
      // Delete any existing cache row for this user+date (since we can't use
      // upsert with the categoryHash stored inside a JSONB column).
      await adminClient
        .from("discover_daily_cache")
        .delete()
        .eq("user_id", userId)
        .eq("us_date_key", usDateKey);

      const { error: cacheWriteError } = await adminClient
        .from("discover_daily_cache")
        .insert({
          user_id: userId,
          us_date_key: usDateKey,
          cards,
          featured_card: featuredCard,
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

    console.log(`Returning ${cards.length} grid cards + ${heroCardResults.length} hero cards`);

    return new Response(
      JSON.stringify({
        cards,               // Grid cards (excluding Fine Dining and Play)
        heroCards: heroCardResults,  // [Fine Dining card, Play card]
        featuredCard,        // Backward compat: heroCards[0]
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
  const placeTypes = CATEGORY_TO_PLACE_TYPES[category];
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
      return !Array.from(EXCLUDED_TYPES).some((excluded) => placeTypeSet.has(excluded));
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

  // Convert price level to min/max
  const priceLevel = place.priceLevel || 0;
  const priceLevelNum = typeof priceLevel === 'string' 
    ? ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'].indexOf(priceLevel)
    : priceLevel;
  
  const price_min = priceLevelNum <= 0 ? 0 : priceLevelNum === 1 ? 0 : priceLevelNum === 2 ? 15 : priceLevelNum === 3 ? 50 : 100;
  const price_max = priceLevelNum <= 0 ? 0 : priceLevelNum === 1 ? 25 : priceLevelNum === 2 ? 75 : priceLevelNum === 3 ? 150 : 500;

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
    priceLevel: priceLevelNum,
    price_min,
    price_max,
    placeTypes: place.types || [],
  };
}

/**
 * Add travel time and distance to places
 */
async function annotateWithTravel(
  places: DiscoverPlace[],
  origin: { lat: number; lng: number }
): Promise<(DiscoverPlace & { distance: string; travelTime: string; distanceKm: number; travelTimeMin: number })[]> {
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

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destinations}&mode=walking&key=${GOOGLE_API_KEY}`;

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
    description: place.description || generateFallbackDescription(place),
    highlights: place.highlights || generateFallbackHighlights(place),
    address: place.address || "",
    lat: place.location.lat,
    lng: place.location.lng,
    placeId: place.placeId,
    openingHours: place.openingHours || null,
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
