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
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '');

// Category to Google Places type mapping (same as generate-experiences)
const CATEGORY_MAPPINGS: { [key: string]: string[] } = {
  // Nature
  nature: ["park", "botanical_garden", "hiking_area", "national_park", "state_park", "beach", "zoo", "wildlife_park"],
  "nature-outdoor": ["park", "botanical_garden", "hiking_area", "national_park", "state_park", "beach", "zoo", "wildlife_park"],
  // First Meet
  first_meet: ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "first meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "First Meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "first-meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  firstmeet: ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  // Picnic
  picnic: ["picnic_ground", "park", "beach", "botanical_garden"],
  Picnic: ["picnic_ground", "park", "beach", "botanical_garden"],
  // Drink
  drink: ["bar", "pub", "wine_bar", "tea_house", "coffee_shop"],
  Drink: ["bar", "pub", "wine_bar", "tea_house", "coffee_shop"],
  // Casual Eats
  casual_eats: ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  "casual eats": ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  "Casual Eats": ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  "casual-eats": ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  casualeats: ["sandwich_shop", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "ramen_restaurant", "noodle_restaurant", "sushi_restaurant", "american_restaurant", "mexican_restaurant", "chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "indian_restaurant", "diner", "food_court"],
  // Fine Dining
  fine_dining: ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "fine dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "Fine Dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "fine-dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  finedining: ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  // Watch
  watch: ["movie_theater", "comedy_club"],
  Watch: ["movie_theater", "comedy_club"],
  // Creative & Arts
  creative_arts: ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative & arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "Creative & Arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative-arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  creativearts: ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  // Play
  play: ["bowling_alley", "amusement_park", "water_park", "video_arcade", "karaoke", "casino", "trampoline_park", "mini_golf_course", "ice_skating_rink", "skate_park", "escape_room", "adventure_park"],
  Play: ["bowling_alley", "amusement_park", "water_park", "video_arcade", "karaoke", "casino", "trampoline_park", "mini_golf_course", "ice_skating_rink", "skate_park", "escape_room", "adventure_park"],
  // Wellness
  wellness: ["spa", "sauna", "hot_spring"],
  Wellness: ["spa", "sauna", "hot_spring"],
};

// Excluded types for specific categories
const EXCLUDED_TYPES: { [key: string]: string[] } = {
  nature: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "movie_theater", "video_arcade", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  first_meet: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "gas_station", "car_wash", "car_repair", "parking", "atm", "bank", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "bus_station", "train_station", "transit_station"],
  picnic: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "movie_theater", "video_arcade", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  drink: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "gas_station", "car_wash", "car_repair", "parking", "atm", "bank", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "bus_station", "train_station", "transit_station"],
  casual_eats: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  fine_dining: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "diner", "food_court", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  watch: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  creative_arts: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  play: ["dog_park", "cycling_park", "park_and_ride", "bus_stop", "bus_station", "bar", "night_club", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
  wellness: ["dog_park", "cycling_park", "amusement_park", "park_and_ride", "water_park", "bus_stop", "bus_station", "bar", "night_club", "casino", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "atm", "bank", "accounting", "storage", "post_office", "government_office", "courthouse", "police", "fire_station", "city_hall", "gas_station", "car_wash", "car_repair", "car_dealer", "parking", "electric_vehicle_charging_station", "moving_company", "courier_service", "locksmith", "plumber", "electrician", "roofing_contractor", "apartment_building", "housing_complex", "condominium_complex", "airport", "train_station", "transit_station"],
};

interface UserPreferences {
  mode: string;
  budget_min: number;
  budget_max: number;
  people_count: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_type: string;
  travel_constraint_value: number;
  datetime_pref: string;
  location?: string;
}

interface AggregatedPreferences {
  budget_min: number;
  budget_max: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_type: string;
  travel_constraint_value: number;
  location: { lat: number; lng: number };
  datetime_pref?: string;
}

interface SessionGenerationRequest {
  session_id: string;
  user_id?: string; // Optional: for auth
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let request: SessionGenerationRequest;
    try {
      request = await req.json();
    } catch (jsonError) {
      console.error("❌ Error parsing JSON request:", jsonError);
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

    if (!request.session_id) {
      return new Response(
        JSON.stringify({
          error: "session_id is required",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all user preferences for this session
    const { data: allPreferences, error: prefsError } = await supabase
      .from("board_session_preferences")
      .select("*")
      .eq("session_id", request.session_id);

    if (prefsError) {
      console.error("❌ Error fetching preferences:", prefsError);
      return new Response(
        JSON.stringify({
          error: "Failed to fetch session preferences",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!allPreferences || allPreferences.length === 0) {
      return new Response(
        JSON.stringify({
          cards: [],
          meta: {
            totalResults: 0,
            message:
              "No preferences found for this session. Users need to set their preferences first.",
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Aggregate preferences
    const aggregated = aggregatePreferences(allPreferences);

    // Find central location
    const location = await findCentralLocation(
      allPreferences,
      aggregated.location
    );
    if (!location) {
      return new Response(
        JSON.stringify({
          error: "Could not determine a location for the session",
          cards: [],
          meta: { totalResults: 0 },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Filter out experience types from categories array
    // Experience types are: "first-dates", "romantic", "friendly", "group-fun", "business"
    const experienceTypeIds = new Set([
      "first-dates",
      "romantic",
      "friendly",
      "group-fun",
      "business",
      "solo-adventure", // Include for completeness, though not in collaboration
    ]);

    const filteredCategories = aggregated.categories
      ? aggregated.categories.filter(
          (category: string) => !experienceTypeIds.has(category)
        )
      : aggregated.categories;

    // Convert aggregated preferences to UserPreferences format
    const preferences: UserPreferences = {
      mode: "collaboration",
      budget_min: aggregated.budget_min,
      budget_max: aggregated.budget_max,
      people_count: allPreferences.length, // Number of participants
      categories: filteredCategories,
      travel_mode: aggregated.travel_mode,
      travel_constraint_type: aggregated.travel_constraint_type,
      travel_constraint_value: aggregated.travel_constraint_value,
      datetime_pref: aggregated.datetime_pref || new Date().toISOString(),
    };

    // ── Pool-first pipeline for session cards ───────────────────────
    if (supabaseAdmin) {
      try {
        const sessionUserId = request.user_id || 'anonymous';
        const poolRadiusMeters = aggregated.travel_constraint_type === 'distance'
          ? Math.min((aggregated.travel_constraint_value || 5) * 1000, 50000)
          : 10000;

        const poolResult = await serveCardsFromPipeline({
          supabaseAdmin,
          userId: sessionUserId,
          lat: location.lat,
          lng: location.lng,
          radiusMeters: poolRadiusMeters,
          categories: resolveCategories(aggregated.categories || []),
          budgetMin: aggregated.budget_min || 0,
          budgetMax: aggregated.budget_max || 1000,
          limit: 20,
          cardType: 'single',
        }, GOOGLE_API_KEY!);

        if (poolResult.cards.length >= 15) {
          console.log(`[pool-first-session] Served ${poolResult.cards.length} cards from pool`);
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
        console.log(`[pool-first-session] Pool had only ${poolResult.cards.length} cards, falling back`);
      } catch (poolError) {
        console.warn('[pool-first-session] Pool query failed, falling back:', poolError);
      }
    }
    // ── End pool-first pipeline ─────────────────────────────────────

    // Fetch places from Google Places API (reuse logic from generate-experiences)
    let places: any[] = [];
    try {
      places = await fetchGooglePlaces(preferences, location);
    } catch (error) {
      console.error("❌ Error fetching Google Places:", error);
      return new Response(
        JSON.stringify({
          cards: [],
          meta: {
            totalResults: 0,
            error: "Failed to fetch places from Google",
            message: "No places found matching the aggregated preferences",
          },
        }),
        {
          status: 200,
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
            message: "No places found matching the aggregated preferences",
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
        "❌ Error annotating with travel, using places without travel info:",
        error
      );
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
      console.error(
        "❌ Error enriching with AI, using fallback content:",
        error
      );
      enriched = topResults.map((place) => ({
        ...place,
        description: generateFallbackDescription(place),
        highlights: generateFallbackHighlights(place),
      }));
    }

    // Convert to card format
    const cards = enriched.map((place) => convertToCard(place, preferences));

    // ── Store session cards in pool for future reuse ────────────────
    if (supabaseAdmin && cards.length > 0) {
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
              types: [],
              photos: [],
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
              openingHours: card.openingHours,
            });
            if (cardId) cardPoolIds.push(cardId);
          }
          const sessionUserId = request.user_id || 'anonymous';
          if (sessionUserId !== 'anonymous' && cardPoolIds.length > 0) {
            await recordImpressions(supabaseAdmin, sessionUserId, cardPoolIds);
          }
          console.log(`[pool-store-session] Stored ${cardPoolIds.length} session cards in pool`);
        } catch (storeError) {
          console.warn('[pool-store-session] Error storing session cards:', storeError);
        }
      })();
    }
    // ── End store session cards ─────────────────────────────────────

    return new Response(
      JSON.stringify({
        cards,
        meta: {
          totalResults: cards.length,
          aggregatedPreferences: aggregated,
          participantCount: allPreferences.length,
          processingTimeMs: Date.now(),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Error generating session experiences:", error);
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

/**
 * Aggregate all user preferences into a single preference set
 */
function aggregatePreferences(allPreferences: any[]): AggregatedPreferences {
  if (allPreferences.length === 0) {
    // Return defaults if no preferences
    return {
      budget_min: 0,
      budget_max: 1000,
      categories: [],
      travel_mode: "walking",
      travel_constraint_type: "time",
      travel_constraint_value: 30,
      location: { lat: 0, lng: 0 },
    };
  }

  // Budget: min = lowest min, max = highest max
  const budget_min = Math.min(
    ...allPreferences
      .map((p) => p.budget_min ?? 0)
      .filter((v) => typeof v === "number")
  );
  const budget_max = Math.max(
    ...allPreferences
      .map((p) => p.budget_max ?? 1000)
      .filter((v) => typeof v === "number")
  );

  // Categories: union of all categories
  const allCategories = new Set<string>();
  allPreferences.forEach((p) => {
    if (Array.isArray(p.categories)) {
      p.categories.forEach((cat: string) => allCategories.add(cat));
    }
  });

  // Travel mode: use most common, default to 'walking'
  const travelModes = allPreferences
    .map((p) => p.travel_mode || "walking")
    .filter(Boolean);
  const travelModeCounts: { [key: string]: number } = {};
  travelModes.forEach((mode) => {
    travelModeCounts[mode] = (travelModeCounts[mode] || 0) + 1;
  });
  const travel_mode =
    Object.keys(travelModeCounts).reduce((a, b) =>
      travelModeCounts[a] > travelModeCounts[b] ? a : b
    ) || "walking";

  // Travel constraint type: use most common, default to 'time'
  const constraintTypes = allPreferences
    .map((p) => p.travel_constraint_type || "time")
    .filter(Boolean);
  const constraintTypeCounts: { [key: string]: number } = {};
  constraintTypes.forEach((type) => {
    constraintTypeCounts[type] = (constraintTypeCounts[type] || 0) + 1;
  });
  const travel_constraint_type =
    Object.keys(constraintTypeCounts).reduce((a, b) =>
      constraintTypeCounts[a] > constraintTypeCounts[b] ? a : b
    ) || "time";

  // Travel constraint value: use most restrictive (lowest value)
  const travel_constraint_value = Math.min(
    ...allPreferences
      .map((p) => p.travel_constraint_value ?? 30)
      .filter((v) => typeof v === "number")
  );

  // Datetime: use the earliest preference if available
  const datetimes = allPreferences
    .map((p) => p.datetime_pref)
    .filter(Boolean)
    .sort();
  const datetime_pref = datetimes.length > 0 ? datetimes[0] : undefined;

  // Location will be calculated separately
  return {
    budget_min,
    budget_max,
    categories: Array.from(allCategories),
    travel_mode,
    travel_constraint_type,
    travel_constraint_value,
    location: { lat: 0, lng: 0 }, // Will be calculated
    datetime_pref,
  };
}

/**
 * Find a central location that fits all users
 * Strategy:
 * 1. If all users have coordinates in their location field, calculate midpoint
 * 2. If some have city names, geocode them and calculate midpoint
 * 3. Fallback to first user's location or default
 */
async function findCentralLocation(
  allPreferences: any[],
  fallbackLocation: { lat: number; lng: number }
): Promise<{ lat: number; lng: number } | null> {
  const locations: { lat: number; lng: number }[] = [];

  for (const pref of allPreferences) {
    if (!pref.location) continue;

    const locationStr = pref.location.trim();

    // Check if it's coordinates (format: "lat, lng" or "lat,lng")
    const coordMatch = locationStr.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        locations.push({ lat, lng });
        continue;
      }
    }

    // Otherwise, treat as city name and geocode
    try {
      const geocoded = await geocodeLocation(locationStr);
      if (geocoded) {
        locations.push(geocoded);
      } else {
        // If geocoding fails, try to use a fallback location for this user
        // This prevents the entire function from failing if one user's location can't be geocoded
      }
    } catch (error) {
      console.error(`Failed to geocode location "${locationStr}":`, error);
      // Continue processing other locations even if one fails
    }
  }

  if (locations.length === 0) {
    console.warn(
      "⚠️ No valid locations found after geocoding, trying fallbacks..."
    );

    // Fallback 1: use custom_lat/custom_lng if available
    const firstWithCoords = allPreferences.find(
      (p) => p.custom_lat && p.custom_lng
    );
    if (firstWithCoords) {
      return {
        lat: firstWithCoords.custom_lat,
        lng: firstWithCoords.custom_lng,
      };
    }

    // Fallback 2: Try to use any location string as-is (might be coordinates already)
    const firstLocationStr = allPreferences.find((p) => p.location)?.location;
    if (firstLocationStr) {
      // Check if it's already coordinates
      const coordMatch = firstLocationStr.match(
        /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/
      );
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lng)) {
          return { lat, lng };
        }
      }
    }

    // Fallback 3: Use fallback location if provided
    if (fallbackLocation.lat !== 0 && fallbackLocation.lng !== 0) {
      return fallbackLocation;
    }

    // Fallback 4: Use a default location (Lagos, Nigeria) if geocoding fails
    // This ensures the function doesn't completely fail
    console.warn(
      "⚠️ All geocoding failed, using default location (Lagos, Nigeria)"
    );
    return {
      lat: 6.5244, // Lagos, Nigeria coordinates
      lng: 3.3792,
    };
  }

  // Calculate midpoint (centroid) of all locations
  const sumLat = locations.reduce((sum, loc) => sum + loc.lat, 0);
  const sumLng = locations.reduce((sum, loc) => sum + loc.lng, 0);
  const avgLat = sumLat / locations.length;
  const avgLng = sumLng / locations.length;

  return { lat: avgLat, lng: avgLng };
}

/**
 * Geocode a location string (city name) to coordinates
 */
async function geocodeLocation(
  locationStr: string
): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY) {
    console.error("Google API key not available for geocoding");
    return null;
  }

  try {
    const encodedLocation = encodeURIComponent(locationStr);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedLocation}&key=${GOOGLE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Geocoding API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Handle different response statuses
    if (data.status === "OK" && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        lat: location.lat,
        lng: location.lng,
      };
    }

    // Log the error with more details
    if (data.status === "REQUEST_DENIED") {
      console.error(
        `Geocoding API REQUEST_DENIED for "${locationStr}": ${
          data.error_message ||
          "API key may be invalid or Geocoding API not enabled"
        }`
      );
      console.error(
        `Check: 1) API key is valid, 2) Geocoding API is enabled in Google Cloud Console, 3) Billing is enabled, 4) API key restrictions allow this request`
      );
    } else if (data.status === "ZERO_RESULTS") {
      console.warn(`No geocoding results found for "${locationStr}"`);
    } else {
      console.error(
        `Geocoding failed for "${locationStr}": ${data.status} - ${
          data.error_message || ""
        }`
      );
    }

    return null;
  } catch (error) {
    console.error(`Error geocoding "${locationStr}":`, error);
    return null;
  }
}

// Reuse all the helper functions from generate-experiences
async function fetchGooglePlaces(
  preferences: UserPreferences,
  location: { lat: number; lng: number }
): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    console.error(
      "❌ Google API key not available - check environment variables"
    );
    throw new Error(
      "Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY in Supabase Edge Functions secrets."
    );
  }

  const radius =
    preferences.travel_constraint_type === "distance"
      ? Math.min((preferences.travel_constraint_value || 5) * 1000, 50000)
      : 10000; // Default 10km

  // Collect all place types from all categories
  const allIncludedTypes: string[] = [];
  const allExcludedTypes = new Set<string>();

  for (const category of preferences.categories || []) {
    const categoryKey = category.toLowerCase();
    const placeTypes = CATEGORY_MAPPINGS[categoryKey] ||
      CATEGORY_MAPPINGS[category] || ["tourist_attraction"];

    allIncludedTypes.push(...placeTypes);

    const excludedTypes = EXCLUDED_TYPES[categoryKey] || [];
    excludedTypes.forEach((type) => allExcludedTypes.add(type));
  }

  // Remove duplicates from included types
  const uniqueIncludedTypes = Array.from(new Set(allIncludedTypes));

  if (uniqueIncludedTypes.length === 0) {
    return [];
  }

  // Remove any excluded types that conflict with included types
  const includedTypesSet = new Set(uniqueIncludedTypes);
  const filteredExcludedTypes = Array.from(allExcludedTypes).filter(
    (type) => !includedTypesSet.has(type)
  );

  try {
    // Use batchSearchPlaces to search each type individually with caching
    const { results: typeResults } = await batchSearchPlaces(
      supabaseAdmin,
      GOOGLE_API_KEY,
      uniqueIncludedTypes.slice(0, 50),
      location.lat,
      location.lng,
      radius,
      {
        maxResultsPerType: 20,
        excludedTypes: filteredExcludedTypes.slice(0, 50),
        ttlHours: 24,
      }
    );

    // Merge all results from all types
    const allRawPlaces: any[] = [];
    for (const places of Object.values(typeResults)) {
      allRawPlaces.push(...places);
    }

    // Deduplicate by place id
    const seenIds = new Set<string>();
    const dedupedPlaces: any[] = [];
    for (const place of allRawPlaces) {
      if (!seenIds.has(place.id)) {
        seenIds.add(place.id);
        dedupedPlaces.push(place);
      }
    }

    if (dedupedPlaces.length === 0) {
      return [];
    }

    // Map places to our format (same transformation as before)
    const places = dedupedPlaces.map((place: any) => {
      const primaryPhoto = place.photos?.[0];
      const imageUrl = primaryPhoto?.name
        ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
        : null;

      const images =
        place.photos
          ?.slice(0, 5)
          .map((photo: any) =>
            photo.name
              ? `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
              : null
          )
          .filter((img: string | null) => img !== null) || [];

      // Determine category based on place types - match to user's selected categories
      const placeTypeSet = new Set(place.types || []);
      let matchedCategory = preferences.categories?.[0] || "general";

      for (const category of preferences.categories || []) {
        const categoryKey = category.toLowerCase();
        const categoryTypes =
          CATEGORY_MAPPINGS[categoryKey] || CATEGORY_MAPPINGS[category] || [];
        if (categoryTypes.some((type) => placeTypeSet.has(type))) {
          matchedCategory = category;
          break;
        }
      }

      return {
        id: place.id,
        name: place.displayName?.text || "Unknown Place",
        category: matchedCategory,
        location: {
          lat: place.location?.latitude || location.lat,
          lng: place.location?.longitude || location.lng,
        },
        address: place.formattedAddress || "",
        priceLevel: place.priceLevel,
        rating: place.rating || 0,
        reviewCount: place.userRatingCount || 0,
        imageUrl: imageUrl,
        images: images,
        placeId: place.id,
        openingHours: place.regularOpeningHours
          ? {
              open_now: place.regularOpeningHours.openNow || false,
              weekday_text: place.regularOpeningHours.weekdayDescriptions || [],
            }
          : null,
        placeTypes: place.types || [],
        price_min:
          place.priceLevel === undefined || place.priceLevel === null
            ? 0
            : place.priceLevel === 0
            ? 0
            : place.priceLevel === 1
            ? 0
            : place.priceLevel === 2
            ? 15
            : place.priceLevel === 3
            ? 50
            : 100,
        price_max:
          place.priceLevel === undefined || place.priceLevel === null
            ? 0
            : place.priceLevel === 0
            ? 0
            : place.priceLevel === 1
            ? 25
            : place.priceLevel === 2
            ? 75
            : place.priceLevel === 3
            ? 150
            : 500,
      };
    });

    return places;
  } catch (error) {
    console.error(`   ❌ Error fetching Google Places:`, error);
    return [];
  }
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
          `❌ Distance Matrix API error (batch ${batchIndex + 1}):`,
          response.status
        );
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
          `❌ Distance Matrix API returned error status: ${data.status}`,
          data.error_message
        );
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
        `❌ Error getting travel times for batch ${batchIndex + 1}:`,
        error
      );
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

  // Stage 1: Filter by travel constraint
  remaining = remaining.filter((place) => {
    if (preferences.travel_constraint_type === "time" && place.travelTimeMin) {
      return place.travelTimeMin <= preferences.travel_constraint_value;
    } else if (
      preferences.travel_constraint_type === "distance" &&
      place.distanceKm
    ) {
      return place.distanceKm <= preferences.travel_constraint_value;
    }
    return true;
  });

  // Stage 2: Filter by budget
  remaining = remaining.filter((place) => {
    // Check if this is a nature card - skip budget filtering for nature cards
    const categoryKey = place.category?.toLowerCase() || "";
    const isNatureCard =
      categoryKey === "nature" ||
      categoryKey.includes("stroll") ||
      categoryKey === "take a stroll" ||
      categoryKey === "take-a-stroll" ||
      categoryKey === "take_a_stroll";

    // Skip budget filtering for nature cards
    if (isNatureCard) {
      return true;
    }

    // Apply budget filter for non-nature cards
    return !(
      place.price_min > preferences.budget_max ||
      place.price_max < preferences.budget_min
    );
  });

  // Stage 3: Filter by category
  remaining = remaining.filter((place) => {
    return preferences.categories.includes(place.category);
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

  if (preferences.travel_constraint_type === "time") {
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
  } else if (preferences.travel_constraint_type === "distance") {
    const maxDistance = preferences.travel_constraint_value || 5;
    if (distance <= 0.5) {
      locationScore = 1.0;
    } else if (distance >= maxDistance) {
      locationScore = 0.0;
    } else {
      const range = maxDistance - 0.5;
      const excess = distance - 0.5;
      locationScore = 1.0 - excess / range;
    }
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
  // Places API (New) uses regularOpeningHours.openNow instead of opening_hours.open_now
  const isOpenNow = place.openingHours?.open_now || false;

  if (isOpenNow) {
    timeScore += 0.6;
  }

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
    return places.map((place) => ({
      ...place,
      description: generateFallbackDescription(place),
      highlights: generateFallbackHighlights(place),
    }));
  }

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
  };
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
