import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchSearchByCategory } from '../_shared/placesCache.ts';
import { serveCardsFromPipeline, upsertPlaceToPool, insertCardToPool } from '../_shared/cardPoolService.ts';
import { resolveCategories, getExcludedTypesForCategory, getCategoryTypeMap, GLOBAL_EXCLUDED_PLACE_TYPES } from '../_shared/categoryPlaceTypes.ts';
import { googleLevelToTierSlug, priceLevelToRange } from '../_shared/priceTiers.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");


interface UserPreferences {
  mode: string;
  budget_min: number;
  budget_max: number;
  people_count: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_value: number;
  datetime_pref: string;
}

interface GenerationRequest {
  user_id: string;
  preferences: UserPreferences;
  location?: { lat: number; lng: number };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let request: GenerationRequest;
    try {
      request = await req.json();
    } catch (jsonError) {
      console.error("Error parsing JSON request:", jsonError);
      return new Response(
        JSON.stringify({
          error: "Invalid JSON in request body",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { preferences, location } = request;

    // ORCH-0434: Per-intent exclusions removed. Use global exclusions only.
    const excludedTypes = GLOBAL_EXCLUDED_PLACE_TYPES;

    if (!preferences) {
      console.error("Preferences are required");
      return new Response(
        JSON.stringify({
          error: "Preferences are required",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!location) {
      console.error("Location is required");
      return new Response(
        JSON.stringify({
          error: "Location is required",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Pool-first pipeline ─────────────────────────────────────────
    const userId = request.user_id || 'anonymous';
    const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    if (supabaseAdmin && userId !== 'anonymous') {
      try {
        const radiusMeters = 10000; // Always time-based

        const poolResult = await serveCardsFromPipeline({
          supabaseAdmin,
          userId,
          lat: location.lat,
          lng: location.lng,
          radiusMeters,
          categories: resolveCategories(preferences.categories || []),
          limit: 20,
          cardType: 'single',
        }, GOOGLE_API_KEY!);

        if (poolResult.cards.length >= 15) {
          console.log(`[pool-first] Served ${poolResult.cards.length} cards from pool (${poolResult.fromPool} pool, ${poolResult.fromApi} API)`);
          return new Response(
            JSON.stringify({
              cards: poolResult.cards,
              meta: {
                totalResults: poolResult.cards.length,
                fromPool: poolResult.fromPool,
                fromApi: poolResult.fromApi,
                poolSize: poolResult.totalPoolSize,
              },
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        console.log(`[pool-first] Pool had only ${poolResult.cards.length} cards, falling back to full pipeline`);
      } catch (poolError) {
        console.warn('[pool-first] Pool query failed, falling back:', poolError);
      }
    }
    // ── End pool-first pipeline (fallback continues below) ──────────

    // Fetch places from Google Places API
    let places: any[] = [];
    try {
      places = await fetchGooglePlaces(preferences, location, excludedTypes);
    } catch (error) {
      console.error("Error fetching Google Places:", error);
      // Return empty result instead of crashing
      return new Response(
        JSON.stringify({
          cards: [],
          meta: {
            totalResults: 0,
            error: "Failed to fetch places from Google",
            message: "No places found matching your preferences",
          },
        }),
        {
          status: 200, // Return 200 with empty results instead of error
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (places.length === 0) {
      return new Response(
        JSON.stringify({
          cards: [],
          meta: {
            totalResults: 0,
            message: "No places found matching your preferences",
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Calculate travel times and distances
    let placesWithTravel: any[] = [];
    try {
      placesWithTravel = await annotateWithTravel(
        places,
        location,
        preferences.travel_mode
      );
    } catch (error) {
      console.error(
        "Error annotating with travel, using places without travel info:",
        error
      );
      // Continue with places without travel info
      placesWithTravel = places.map((p) => ({
        ...p,
        distance: "Unknown",
        travelTime: "Unknown",
        distanceKm: 0,
        travelTimeMin: 0,
      }));
    }

    // Filter by constraints
    const filtered = filterByConstraints(placesWithTravel, preferences);

    // Calculate match scores
    const withMatchScores = filtered.map((place) => ({
      ...place,
      matchScore: calculateMatchScore(place, preferences, location),
      matchFactors: calculateMatchFactors(place, preferences, location),
    }));

    // Sort by match score
    const sorted = withMatchScores.sort((a, b) => b.matchScore - a.matchScore);

    // Generate AI content for top results
    const topResults = sorted.slice(0, 20);
    let enriched: any[] = [];
    try {
      enriched = await enrichWithAI(topResults, preferences);
    } catch (error) {
      console.error("Error enriching with AI, using fallback content:", error);
      // Use places with fallback descriptions
      enriched = topResults.map((place) => ({
        ...place,
        description: generateFallbackDescription(place),
        highlights: generateFallbackHighlights(place),
      }));
    }

    // Convert to card format
    const cards = enriched.map((place) => convertToCard(place, preferences));

    // ── Store fresh cards in pool for future reuse ──────────────────
    if (supabaseAdmin && cards.length > 0) {
      // Fire-and-forget: don't block the response
      (async () => {
        try {
          const cardPoolIds: string[] = [];
          for (const card of cards) {
            if (!card.placeId) continue;
            const placePoolId = await upsertPlaceToPool(supabaseAdmin, {
              id: card.placeId,
              displayName: { text: card.title },
              formattedAddress: card.address,
              location: { latitude: card.lat, longitude: card.lng },
              rating: card.rating,
              userRatingCount: card.reviewCount,
              priceLevel: null,
              types: [],
              photos: [],
              websiteUri: card.website || null,
            }, GOOGLE_API_KEY!);

            const cardId = await insertCardToPool(supabaseAdmin, {
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
              priceTier: card.priceTier,
            });
            if (cardId) cardPoolIds.push(cardId);
          }
          // ORCH-0410: Serve-time impression recording REMOVED. See generate-curated-experiences.
          console.log(`[pool-store] Stored ${cardPoolIds.length} cards in pool`);
        } catch (storeError) {
          console.warn('[pool-store] Error storing cards:', storeError);
        }
      })();
    }
    // ── End store fresh cards ───────────────────────────────────────

    return new Response(
      JSON.stringify({
        cards,
        meta: {
          totalResults: cards.length,
          processingTimeMs: Date.now(),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error generating experiences:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    return new Response(
      JSON.stringify({
        error: errorMessage,
        cards: [],
        meta: {
          totalResults: 0,
          error: errorMessage,
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function fetchGooglePlaces(
  preferences: UserPreferences,
  location: { lat: number; lng: number },
  globalExcludedTypes: string[] = GLOBAL_EXCLUDED_PLACE_TYPES
): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    console.error("Google API key not available - check environment variables");
    throw new Error(
      "Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY in Supabase Edge Functions secrets."
    );
  }

  const allPlaces: any[] = [];
  const radius = 10000; // Default 10km (always time-based)

  // Create admin client for cache operations
  const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

  // Build category → place types map (one Google API call per category)
  const catTypeMap = getCategoryTypeMap(preferences.categories || []);
  const resolvedCategories = Object.keys(catTypeMap);

  if (supabaseAdmin && resolvedCategories.length > 0) {
    // Use batch category search: one API call per category (all types bundled)
    const { results: catResults } = await batchSearchByCategory(
      supabaseAdmin,
      GOOGLE_API_KEY,
      catTypeMap,
      location.lat,
      location.lng,
      radius,
      { maxResultsPerCategory: 20, ttlHours: 24, excludedTypes: globalExcludedTypes }
    );

    // Map results back through the same transformation logic
    for (const category of resolvedCategories) {
      const places = catResults[category] || [];
      if (places.length > 0) {
        const transformed = places.map((place: any) => {
          const primaryPhoto = place.photos?.[0];
          const imageUrl = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

          const images: string[] = [];

          const priceRange = priceLevelToRange(place.priceLevel);

          return {
            id: place.id,
            name: place.displayName?.text || "Unknown Place",
            category,
            location: {
              lat: place.location?.latitude || location.lat,
              lng: place.location?.longitude || location.lng,
            },
            address: place.formattedAddress || "",
            priceLevel: place.priceLevel || null,
            rating: place.rating || 0,
            reviewCount: place.userRatingCount || 0,
            imageUrl: imageUrl,
            images: images.filter((img: string | null) => img !== null),
            placeId: place.id,
            openingHours: place.regularOpeningHours
              ? {
                  open_now: place.regularOpeningHours.openNow || false,
                  weekday_text:
                    place.regularOpeningHours.weekdayDescriptions || [],
                }
              : null,
            placeTypes: place.types || [],
            price_min: priceRange.min,
            price_max: priceRange.max,
            websiteUri: place.websiteUri || null,
          };
        });
        allPlaces.push(...transformed);
      }
    }
  } else {
    // Fallback: direct API calls per category (no cache available)
    const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";

    for (const category of resolvedCategories) {
      const placeTypes = catTypeMap[category] || [];
      if (placeTypes.length === 0) continue;

      try {
        const fieldMask =
          "places.id,places.displayName,places.location,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount,places.photos,places.types,places.regularOpeningHours,places.websiteUri";

        const requestBody: any = {
          includedTypes: placeTypes,
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: location.lat, longitude: location.lng },
              radius: radius,
            },
          },
        };

        // Merge category-specific exclusions with global/romantic exclusions
        const categoryExcludedTypes = getExcludedTypesForCategory(category);
        const mergedExcludedTypes = Array.from(new Set([
          ...categoryExcludedTypes,
          ...globalExcludedTypes,
        ]));
        if (mergedExcludedTypes.length > 0) {
          requestBody.excludedTypes = mergedExcludedTypes;
        }

        const response = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": fieldMask,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `Google Places API error for category ${category}:`,
            response.status,
            response.statusText,
            errorText
          );
          continue;
        }

        const data = await response.json();

        if (data.places?.length) {
          const places = data.places.map((place: any) => {
            const primaryPhoto = place.photos?.[0];
            const imageUrl = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

            const images: string[] = [];

            const priceRange2 = priceLevelToRange(place.priceLevel);

            return {
              id: place.id,
              name: place.displayName?.text || "Unknown Place",
              category,
              location: {
                lat: place.location?.latitude || location.lat,
                lng: place.location?.longitude || location.lng,
              },
              address: place.formattedAddress || "",
              priceLevel: place.priceLevel || null,
              rating: place.rating || 0,
              reviewCount: place.userRatingCount || 0,
              imageUrl: imageUrl,
              images: images.filter((img: string | null) => img !== null),
              placeId: place.id,
              openingHours: place.regularOpeningHours
                ? {
                    open_now: place.regularOpeningHours.openNow || false,
                    weekday_text:
                      place.regularOpeningHours.weekdayDescriptions || [],
                  }
                : null,
              placeTypes: place.types || [],
              price_min: priceRange2.min,
              price_max: priceRange2.max,
              websiteUri: place.websiteUri || null,
            };
          });

          allPlaces.push(...places);
        }
      } catch (error) {
        console.error(`Error fetching category ${category}:`, error);
      }
    }
  }

  // Post-fetch filter: remove any places with globally/romantically excluded types
  const excludedSet = new Set(globalExcludedTypes);
  const filteredPlaces = allPlaces.filter((place) => {
    const types: string[] = place.placeTypes || place.types || [];
    return !types.some((t: string) => excludedSet.has(t));
  });

  return filteredPlaces;
}

async function annotateWithTravel(
  places: any[],
  origin: { lat: number; lng: number },
  travelMode: string
): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    return places.map((p) => ({
      ...p,
      distance: "Unknown",
      travelTime: "Unknown",
      distanceKm: 0,
      travelTimeMin: 0,
    }));
  }

  // Distance Matrix API has a limit of 25 destinations per request
  // Split into batches if needed
  const BATCH_SIZE = 25;
  const batches: any[][] = [];
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    batches.push(places.slice(i, i + BATCH_SIZE));
  }

  const mode =
    travelMode === "walking"
      ? "walking"
      : travelMode === "driving"
      ? "driving"
      : "transit";

  const annotatedPlaces: any[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    try {
      const destinations = batch
        .map((p) => `${p.location.lat},${p.location.lng}`)
        .join("|");

      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destinations}&mode=${mode}&key=${GOOGLE_API_KEY}`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(
          `Distance Matrix API error (batch ${batchIndex + 1}):`,
          response.status
        );
        // Add places without travel info
        annotatedPlaces.push(
          ...batch.map((p) => ({
            ...p,
            distance: "Unknown",
            travelTime: "Unknown",
            distanceKm: 0,
            travelTimeMin: 0,
          }))
        );
        continue;
      }

      const data = await response.json();

      if (data.status && data.status !== "OK") {
        console.error(
          `Distance Matrix API returned error status: ${data.status}`,
          data.error_message
        );
        // Add places without travel info
        annotatedPlaces.push(
          ...batch.map((p) => ({
            ...p,
            distance: "Unknown",
            travelTime: "Unknown",
            distanceKm: 0,
            travelTimeMin: 0,
          }))
        );
        continue;
      }

      const batchAnnotated = batch.map((place, index) => {
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
        // If status is not OK, return place without travel info
        return {
          ...place,
          distance: "Unknown",
          travelTime: "Unknown",
          distanceKm: 0,
          travelTimeMin: 0,
        };
      });

      annotatedPlaces.push(...batchAnnotated);
    } catch (error) {
      console.error(
        `Error getting travel times for batch ${batchIndex + 1}:`,
        error
      );
      // Add places without travel info on error
      annotatedPlaces.push(
        ...batch.map((p) => ({
          ...p,
          distance: "Unknown",
          travelTime: "Unknown",
          distanceKm: 0,
          travelTimeMin: 0,
        }))
      );
    }
  }

  return annotatedPlaces;
}

function filterByConstraints(
  places: any[],
  preferences: UserPreferences
): any[] {
  let remaining = places;

  // Stage 1: Filter by travel constraint (always time-based)
  remaining = remaining.filter((place) => {
    if (place.travelTimeMin) {
      if (place.travelTimeMin > preferences.travel_constraint_value) {
        return false;
      }
    }
    return true;
  });

  // Stage 2: Filter by budget (skip for stroll cards)
  remaining = remaining.filter((place) => {
    // Check if this is a stroll card - skip budget filtering for stroll cards
    const categoryKey = place.category?.toLowerCase() || "";
    const isStrollCard =
      categoryKey.includes("stroll") ||
      categoryKey === "take a stroll" ||
      categoryKey === "take-a-stroll" ||
      categoryKey === "take_a_stroll";

    // Skip budget filtering for stroll cards
    if (isStrollCard) {
      return true;
    }

    // ORCH-0434: Budget filter removed — all price tiers are now included.

    return true;
  });

  // Stage 3: Filter by category
  remaining = remaining.filter((place) => {
    if (!preferences.categories.includes(place.category)) {
      return false;
    }
    return true;
  });

  // Stage 3.5: Hard filter for stroll cards - must have valid anchor
  remaining = remaining.filter((place) => {
    const categoryKey = place.category?.toLowerCase() || "";
    const isStrollCard =
      categoryKey.includes("stroll") ||
      categoryKey === "take a stroll" ||
      categoryKey === "take-a-stroll" ||
      categoryKey === "take_a_stroll";

    if (isStrollCard) {
      // Hard filter: Stroll cards must have valid anchor (park, trail, scenic area)
      const validAnchorTypes = [
        "park",
        "tourist_attraction",
        "point_of_interest",
        "natural_feature",
        "zoo",
        "aquarium",
        "botanical_garden",
        "hiking_area",
        "scenic_viewpoint",
      ];
      const hasValidAnchor = place.placeTypes?.some((type: string) =>
        validAnchorTypes.includes(type)
      );

      if (!hasValidAnchor) {
        return false;
      }
    }
    return true;
  });

  return remaining;
}

function calculateMatchScore(
  place: any,
  preferences: UserPreferences,
  userLocation: { lat: number; lng: number }
): number {
  const locationScore = calculateLocationScore(
    place,
    preferences,
    userLocation
  );
  const budgetScore = calculateBudgetScore(place, preferences);
  const categoryScore = calculateCategoryScore(place, preferences);
  const timeScore = calculateTimeScore(place, preferences);
  const popularityScore = calculatePopularityScore(place);

  const matchScore =
    (locationScore * 0.25 +
      budgetScore * 0.2 +
      categoryScore * 0.2 +
      timeScore * 0.2 +
      popularityScore * 0.15) *
    100;

  return Math.round(Math.max(0, Math.min(100, matchScore)));
}

function calculateMatchFactors(
  place: any,
  preferences: UserPreferences,
  userLocation: { lat: number; lng: number }
) {
  return {
    location: Math.round(
      calculateLocationScore(place, preferences, userLocation) * 100
    ),
    budget: Math.round(calculateBudgetScore(place, preferences) * 100),
    category: Math.round(calculateCategoryScore(place, preferences) * 100),
    time: Math.round(calculateTimeScore(place, preferences) * 100),
    popularity: Math.round(calculatePopularityScore(place) * 100),
  };
}

function calculateLocationScore(
  place: any,
  preferences: UserPreferences,
  userLocation: { lat: number; lng: number }
): number {
  if (!place.distanceKm || !place.travelTimeMin) return 0.5;

  const distance = place.distanceKm;
  const travelTime = place.travelTimeMin;

  let locationScore = 0;

  // Always time-based constraint
  const constraintValue = preferences.travel_constraint_value || 30;
  if (travelTime <= 5) {
    locationScore = 1.0;
  } else if (travelTime >= constraintValue) {
    locationScore = 0.0;
  } else {
    const range = constraintValue - 5;
    const excess = travelTime - 5;
    locationScore = 1.0 - excess / range;
  }

  if (distance < 1.0 && travelTime < 10) {
    locationScore = Math.min(1.0, locationScore * 1.1);
  }

  return Math.max(0, Math.min(1, locationScore));
}

function calculateBudgetScore(
  place: any,
  preferences: UserPreferences
): number {
  const expPriceMin = place.price_min ?? 0;
  const expPriceMax = place.price_max ?? 0;
  const userBudgetMin = preferences.budget_min || 0;
  const userBudgetMax = preferences.budget_max || 1000;

  if (expPriceMin >= userBudgetMin && expPriceMax <= userBudgetMax) {
    return 1.0;
  }

  const overlapStart = Math.max(userBudgetMin, expPriceMin);
  const overlapEnd = Math.min(userBudgetMax, expPriceMax);
  const overlap = Math.max(0, overlapEnd - overlapStart);

  if (overlap > 0) {
    const experienceRange = expPriceMax - expPriceMin;
    const overlapRatio = overlap / experienceRange;
    if (expPriceMin < userBudgetMin) {
      return overlapRatio * 0.7;
    } else if (expPriceMax > userBudgetMax) {
      return overlapRatio * 0.8;
    }
    return overlapRatio;
  }

  if (expPriceMax < userBudgetMin) {
    const gap = userBudgetMin - expPriceMax;
    const budgetRange = userBudgetMax - userBudgetMin;
    return Math.max(0, 0.3 - (gap / budgetRange) * 0.3);
  } else {
    const gap = expPriceMin - userBudgetMax;
    const budgetRange = userBudgetMax - userBudgetMin;
    return Math.max(0, 0.2 - (gap / budgetRange) * 0.2);
  }
}

function calculateCategoryScore(
  place: any,
  preferences: UserPreferences
): number {
  const userCategories = preferences.categories || [];
  if (userCategories.includes(place.category)) {
    return 1.0;
  }
  return 0.0;
}

function calculateTimeScore(place: any, preferences: UserPreferences): number {
  let timeScore = 0;
  const isOpenNow = place.openingHours?.open_now || false;

  if (isOpenNow) {
    timeScore += 0.6;
  }

  // Duration alignment (simplified)
  timeScore += 0.3;

  return Math.max(0, Math.min(1, timeScore));
}

function calculatePopularityScore(place: any): number {
  const rating = place.rating || 0;
  const reviewCount = place.reviewCount || 0;

  let ratingScore = 0;
  if (rating >= 4.5) {
    ratingScore = 1.0;
  } else if (rating >= 4.0) {
    ratingScore = 0.8;
  } else if (rating >= 3.5) {
    ratingScore = 0.6;
  } else if (rating >= 3.0) {
    ratingScore = 0.4;
  } else {
    ratingScore = rating / 5.0;
  }

  let reviewScore = 0;
  if (reviewCount >= 1000) {
    reviewScore = 1.0;
  } else if (reviewCount >= 500) {
    reviewScore = 0.9;
  } else if (reviewCount >= 100) {
    reviewScore = 0.7;
  } else if (reviewCount >= 50) {
    reviewScore = 0.5;
  } else if (reviewCount >= 10) {
    reviewScore = 0.3;
  } else if (reviewCount > 0) {
    reviewScore = 0.1;
  }

  const popularityScore = ratingScore * 0.6 + reviewScore * 0.4;

  if (rating >= 4.5 && reviewCount >= 500) {
    return Math.min(1.0, popularityScore * 1.1);
  }

  return popularityScore;
}

async function enrichWithAI(
  places: any[],
  preferences: UserPreferences
): Promise<any[]> {
  if (!OPENAI_API_KEY) {
    // Fallback descriptions
    return places.map((place) => ({
      ...place,
      description: generateFallbackDescription(place),
      highlights: generateFallbackHighlights(place),
    }));
  }

  // Generate descriptions and highlights using OpenAI
  const enriched = await Promise.all(
    places.map(async (place) => {
      try {
        const description = await generateDescription(place);
        const highlights = await generateHighlights(place);
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
  if (!OPENAI_API_KEY) return generateFallbackDescription(place);

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
    return (
      data.choices[0]?.message?.content || generateFallbackDescription(place)
    );
  } catch (error) {
    console.error("OpenAI error:", error);
    return generateFallbackDescription(place);
  }
}

async function generateHighlights(place: any): Promise<string[]> {
  if (!OPENAI_API_KEY) return generateFallbackHighlights(place);

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
    return highlights.length > 0
      ? highlights
      : generateFallbackHighlights(place);
  } catch (error) {
    console.error("OpenAI error:", error);
    return generateFallbackHighlights(place);
  }
}

function generateFallbackDescription(place: any): string {
  const descriptions: { [key: string]: string[] } = {
    "Sip & Chill": [
      "Experience an exquisite selection of local and imported wines while enjoying breathtaking sunset views from our rooftop terrace.",
      "Perfect spot for coffee and conversation in a cozy atmosphere.",
    ],
    Stroll: [
      "Scenic walking adventure through beautiful natural surroundings.",
      "Peaceful stroll in a serene environment perfect for relaxation.",
    ],
    Dining: [
      "Exceptional culinary journey with outstanding service and fine cuisine.",
      "Memorable gastronomic experience in an elegant atmosphere.",
    ],
    nature: ["Enjoy the beauty of the outdoors surrounded by nature."],
    first_meet: ["A relaxed and welcoming spot perfect for meeting someone new."],
    drink: ["Unwind with a perfectly crafted drink in a vibrant atmosphere."],
    casual_eats: ["Delicious, laid-back food to satisfy any craving."],
    fine_dining: ["Exceptional culinary journey with outstanding service and fine cuisine."],
    watch: ["Sit back and enjoy a great show or film."],
    creative_arts: ["Explore your creative side in an inspiring setting."],
    play: ["Fun and active experience for all ages."],
    wellness: ["Relax, recharge and take care of yourself."],
    picnic: ["A perfect open-air spot for a laid-back picnic."],
  };

  const categoryDescriptions = descriptions[place.category] || [
    "An amazing experience waiting for you.",
  ];
  return categoryDescriptions[0];
}

function generateFallbackHighlights(place: any): string[] {
  const highlights: { [key: string]: string[] } = {
    "Sip & Chill": ["Expert Sommeliers", "Sunset Views"],
    Stroll: ["Scenic Views", "Nature Trail"],
    Dining: ["Fine Cuisine", "Excellent Service"],
    nature: ["Scenic Views", "Nature Trail"],
    first_meet: ["Cozy Atmosphere", "Great Conversation Spot"],
    drink: ["Craft Drinks", "Relaxing Vibe"],
    casual_eats: ["Tasty Eats", "Friendly Atmosphere"],
    fine_dining: ["Fine Cuisine", "Excellent Service"],
    watch: ["Great Entertainment", "Comfortable Seating"],
    creative_arts: ["Artistic Experience", "Inspiring Setting"],
    play: ["Fun Activities", "Active Fun"],
    wellness: ["Deep Relaxation", "Self Care"],
    picnic: ["Outdoor Bliss", "Scenic Spot"],
  };

  return highlights[place.category] || ["Great Experience", "Highly Rated"];
}

function convertToCard(place: any, preferences: UserPreferences): any {
  return {
    id: place.id,
    title: place.name,
    category: place.category,
    matchScore: place.matchScore,
    image:
      place.imageUrl ||
      "https://images.unsplash.com/photo-1441986300917-64674bd600d8",
    images: place.images || [place.imageUrl] || [],
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
    matchFactors: place.matchFactors || {},
    openingHours: place.openingHours || null,
    website: place.websiteUri || null,
    priceTier: googleLevelToTierSlug(place.priceLevel),
  };
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
