import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// Category to Google Places type mapping
// Maps category IDs from preferences sheets to Google Places API types
// All keys are lowercase to support case-insensitive lookups
// Includes multiple format variations for each category
const CATEGORY_MAPPINGS: { [key: string]: string[] } = {
  // Nature variations
  nature: ["park", "botanical_garden", "hiking_area", "national_park", "state_park", "beach", "zoo", "wildlife_park"],
  "nature-outdoor": ["park", "botanical_garden", "hiking_area", "national_park", "state_park", "beach", "zoo", "wildlife_park"],
  // First Meet variations
  first_meet: ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "first meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "First Meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  "first-meet": ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  firstmeet: ["bookstore", "bar", "pub", "wine_bar", "tea_house", "coffee_shop", "planetarium"],
  // Picnic variations
  picnic: ["picnic_ground", "park", "beach", "botanical_garden"],
  "Picnic": ["picnic_ground", "park", "beach", "botanical_garden"],
  // Drink variations
  drink: ["bar", "pub", "wine_bar", "tea_house", "coffee_shop"],
  "Drink": ["bar", "pub", "wine_bar", "tea_house", "coffee_shop"],
  // Casual Eats variations
  casual_eats: [
    "buffet_restaurant", "brunch_restaurant", "diner", "fast_food_restaurant", "food_court",
    "hamburger_restaurant", "pizza_restaurant", "ramen_restaurant", "sandwich_shop", "sushi_restaurant",
    "afghani_restaurant", "african_restaurant", "american_restaurant", "asian_restaurant",
    "barbecue_restaurant", "brazilian_restaurant", "breakfast_restaurant", "indian_restaurant",
    "indonesian_restaurant", "japanese_restaurant", "korean_restaurant", "lebanese_restaurant",
    "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant", "seafood_restaurant",
    "spanish_restaurant", "thai_restaurant", "turkish_restaurant", "vegan_restaurant",
    "vegetarian_restaurant", "vietnamese_restaurant", "chinese_restaurant",
  ],
  "casual eats": [
    "buffet_restaurant", "brunch_restaurant", "diner", "fast_food_restaurant", "food_court",
    "hamburger_restaurant", "pizza_restaurant", "ramen_restaurant", "sandwich_shop", "sushi_restaurant",
    "afghani_restaurant", "african_restaurant", "american_restaurant", "asian_restaurant",
    "barbecue_restaurant", "brazilian_restaurant", "breakfast_restaurant", "indian_restaurant",
    "indonesian_restaurant", "japanese_restaurant", "korean_restaurant", "lebanese_restaurant",
    "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant", "seafood_restaurant",
    "spanish_restaurant", "thai_restaurant", "turkish_restaurant", "vegan_restaurant",
    "vegetarian_restaurant", "vietnamese_restaurant", "chinese_restaurant",
  ],
  "Casual Eats": [
    "buffet_restaurant", "brunch_restaurant", "diner", "fast_food_restaurant", "food_court",
    "hamburger_restaurant", "pizza_restaurant", "ramen_restaurant", "sandwich_shop", "sushi_restaurant",
    "afghani_restaurant", "african_restaurant", "american_restaurant", "asian_restaurant",
    "barbecue_restaurant", "brazilian_restaurant", "breakfast_restaurant", "indian_restaurant",
    "indonesian_restaurant", "japanese_restaurant", "korean_restaurant", "lebanese_restaurant",
    "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant", "seafood_restaurant",
    "spanish_restaurant", "thai_restaurant", "turkish_restaurant", "vegan_restaurant",
    "vegetarian_restaurant", "vietnamese_restaurant", "chinese_restaurant",
  ],
  "casual-eats": [
    "buffet_restaurant", "brunch_restaurant", "diner", "fast_food_restaurant", "food_court",
    "hamburger_restaurant", "pizza_restaurant", "ramen_restaurant", "sandwich_shop", "sushi_restaurant",
    "afghani_restaurant", "african_restaurant", "american_restaurant", "asian_restaurant",
    "barbecue_restaurant", "brazilian_restaurant", "breakfast_restaurant", "indian_restaurant",
    "indonesian_restaurant", "japanese_restaurant", "korean_restaurant", "lebanese_restaurant",
    "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant", "seafood_restaurant",
    "spanish_restaurant", "thai_restaurant", "turkish_restaurant", "vegan_restaurant",
    "vegetarian_restaurant", "vietnamese_restaurant", "chinese_restaurant",
  ],
  casualeats: [
    "buffet_restaurant", "brunch_restaurant", "diner", "fast_food_restaurant", "food_court",
    "hamburger_restaurant", "pizza_restaurant", "ramen_restaurant", "sandwich_shop", "sushi_restaurant",
    "afghani_restaurant", "african_restaurant", "american_restaurant", "asian_restaurant",
    "barbecue_restaurant", "brazilian_restaurant", "breakfast_restaurant", "indian_restaurant",
    "indonesian_restaurant", "japanese_restaurant", "korean_restaurant", "lebanese_restaurant",
    "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant", "seafood_restaurant",
    "spanish_restaurant", "thai_restaurant", "turkish_restaurant", "vegan_restaurant",
    "vegetarian_restaurant", "vietnamese_restaurant", "chinese_restaurant",
  ],
  // Fine Dining variations
  fine_dining: ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "fine dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "Fine Dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  "fine-dining": ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  finedining: ["fine_dining_restaurant", "steak_house", "french_restaurant", "greek_restaurant", "italian_restaurant"],
  // Watch variations
  watch: ["movie_theater", "comedy_club"],
  "Watch": ["movie_theater", "comedy_club"],
  // Creative & Arts variations
  creative_arts: ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative & arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "Creative & Arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative-arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  creativearts: ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  "creative arts": ["art_gallery", "museum", "planetarium", "karaoke", "coffee_roastery"],
  // Play variations
  play: [
    "bowling_alley", "amusement_park", "water_park", "video_arcade", "karaoke", "casino",
    "trampoline_park", "mini_golf_course", "ice_skating_rink", "skate_park", "escape_room", "adventure_park",
  ],
  "Play": [
    "bowling_alley", "amusement_park", "water_park", "video_arcade", "karaoke", "casino",
    "trampoline_park", "mini_golf_course", "ice_skating_rink", "skate_park", "escape_room", "adventure_park",
  ],
  // Wellness variations
  wellness: ["spa", "sauna", "hot_spring"],
  "Wellness": ["spa", "sauna", "hot_spring"],
  // Groceries & Flowers variations
  groceries_flowers: ["grocery_store", "supermarket"],
  "groceries & flowers": ["grocery_store", "supermarket"],
  "Groceries & Flowers": ["grocery_store", "supermarket"],
  "groceries-flowers": ["grocery_store", "supermarket"],
  groceriesflowers: ["grocery_store", "supermarket"],
  // Work & Business variations
  work_business: ["tea_house", "coffee_shop", "cafe"],
  "Work & Business": ["tea_house", "coffee_shop", "cafe"],
  "work & business": ["tea_house", "coffee_shop", "cafe"],
  "work-business": ["tea_house", "coffee_shop", "cafe"],
  workbusiness: ["tea_house", "coffee_shop", "cafe"],
};

// Excluded types for specific categories
const EXCLUDED_TYPES: { [key: string]: string[] } = {
  nature: [
    "bar", "night_club", "casino", "movie_theater", "video_arcade",
    "bowling_alley", "fine_dining_restaurant", "fast_food_restaurant",
    "food_court", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office", "government_office",
    "courthouse", "police", "fire_station", "city_hall",
    "apartment_building", "housing_complex",
  ],
  first_meet: [
    "amusement_park", "water_park", "bowling_alley", "spa", "sauna",
    "fine_dining_restaurant", "fast_food_restaurant", "food_court",
    "night_club", "casino", "parking", "atm", "bank", "gas_station",
  ],
  picnic: [
    "dog_park", "cycling_park", "amusement_park", "park_and_ride",
    "water_park", "bar", "night_club", "casino", "movie_theater",
    "video_arcade", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office", "government_office",
    "courthouse", "police", "fire_station", "city_hall", "apartment_building",
  ],
  "Picnic": [
    "dog_park", "cycling_park", "amusement_park", "park_and_ride",
    "water_park", "bar", "night_club", "casino", "movie_theater",
    "video_arcade", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office", "government_office",
    "courthouse", "police", "fire_station", "city_hall", "apartment_building",
  ],
  drink: [
    "fine_dining_restaurant", "spa", "sauna", "amusement_park",
    "water_park", "bowling_alley", "atm", "bank", "parking", "gas_station",
    "airport", "car_repair",
  ],
  "Drink": [
    "fine_dining_restaurant", "spa", "sauna", "amusement_park",
    "water_park", "bowling_alley", "atm", "bank", "parking", "gas_station",
    "airport", "car_repair",
  ],
  casual_eats: [
    "fine_dining_restaurant", "bar", "night_club", "spa", "amusement_park",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police",
  ],
  "casual eats": [
    "fine_dining_restaurant", "bar", "night_club", "spa", "amusement_park",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police",
  ],
  "Casual Eats": [
    "fine_dining_restaurant", "bar", "night_club", "spa", "amusement_park",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police",
  ],
  fine_dining: [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "video_arcade", "night_club",
    "atm", "bank", "parking", "gas_station", "car_repair",
  ],
  "fine dining": [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "video_arcade", "night_club",
    "atm", "bank", "parking", "gas_station", "car_repair",
  ],
  "Fine Dining": [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "video_arcade", "night_club",
    "atm", "bank", "parking", "gas_station", "car_repair",
  ],
  watch: [
    "spa", "sauna", "botanical_garden", "park", "beach", "restaurant",
    "atm", "bank", "parking", "gas_station", "government_office",
  ],
  "Watch": [
    "spa", "sauna", "botanical_garden", "park", "beach", "restaurant",
    "atm", "bank", "parking", "gas_station", "government_office",
  ],
  creative_arts: [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "spa", "sauna", "night_club",
    "atm", "bank", "parking", "gas_station", "government_office",
  ],
  "creative & arts": [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "spa", "sauna", "night_club",
    "atm", "bank", "parking", "gas_station", "government_office",
  ],
  "Creative & Arts": [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "spa", "sauna", "night_club",
    "atm", "bank", "parking", "gas_station", "government_office",
  ],
  play: [
    "spa", "sauna", "botanical_garden", "fine_dining_restaurant",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police", "fire_station", "city_hall",
  ],
  "Play": [
    "spa", "sauna", "botanical_garden", "fine_dining_restaurant",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police", "fire_station", "city_hall",
  ],
  wellness: [
    "bar", "night_club", "casino", "bowling_alley", "amusement_park",
    "water_park", "video_arcade", "fast_food_restaurant", "food_court",
    "atm", "bank", "parking", "gas_station", "government_office", "airport",
  ],
  "Wellness": [
    "bar", "night_club", "casino", "bowling_alley", "amusement_park",
    "water_park", "video_arcade", "fast_food_restaurant", "food_court",
    "atm", "bank", "parking", "gas_station", "government_office", "airport",
  ],
  groceries_flowers: [
    "bar", "night_club", "casino", "movie_theater", "video_arcade",
    "bowling_alley", "fine_dining_restaurant", "fast_food_restaurant",
    "food_court", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office",
    "government_office", "courthouse", "police", "fire_station",
    "city_hall", "apartment_building", "housing_complex",
  ],
  "Groceries & Flowers": [
    "bar", "night_club", "casino", "movie_theater", "video_arcade",
    "bowling_alley", "fine_dining_restaurant", "fast_food_restaurant",
    "food_court", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office",
    "government_office", "courthouse", "police", "fire_station",
    "city_hall", "apartment_building", "housing_complex",
  ],
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
}

interface GenerationRequest {
  user_id: string;
  preferences: UserPreferences;
  location?: { lat: number; lng: number };
  pageToken?: string;
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

    const { preferences, location, pageToken } = request;

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

    // Fetch places from Google Places API
    let places: any[] = [];
    let nextPageToken: string | undefined;
    try {
      const result = await fetchGooglePlaces(preferences, location, pageToken);
      places = result.places;
      nextPageToken = result.nextPageToken;
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
            nextPageToken: nextPageToken,
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

    return new Response(
      JSON.stringify({
        cards,
        meta: {
          totalResults: cards.length,
          processingTimeMs: Date.now(),
          nextPageToken: nextPageToken,
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
  pageToken?: string
): Promise<{ places: any[]; nextPageToken?: string }> {
  if (!GOOGLE_API_KEY) {
    console.error("Google API key not available - check environment variables");
    throw new Error(
      "Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY in Supabase Edge Functions secrets."
    );
  }

  const radius =
    preferences.travel_constraint_type === "distance"
      ? Math.min((preferences.travel_constraint_value || 5) * 1000, 50000)
      : 10000; // Default 10km

  // Places API (New) base URL - using textSearch for pagination support
  const baseUrl = "https://places.googleapis.com/v1/places:searchText";

  // Collect all place types from all categories
  const allIncludedTypes: string[] = [];
  const allExcludedTypes = new Set<string>();

  for (const category of preferences.categories || []) {
    // Convert category to lowercase for case-insensitive lookup
    const categoryKey = category.toLowerCase();
    const placeTypes = CATEGORY_MAPPINGS[categoryKey] || ["tourist_attraction"];

    allIncludedTypes.push(...placeTypes);

    // Collect excluded types for this category
    const excludedTypes = EXCLUDED_TYPES[categoryKey] || [];
    excludedTypes.forEach((type) => allExcludedTypes.add(type));
  }

  // Remove duplicates from included types
  const uniqueIncludedTypes = Array.from(new Set(allIncludedTypes));

  if (uniqueIncludedTypes.length === 0) {
    return { places: [], nextPageToken: undefined };
  }

  // Remove any excluded types that conflict with included types
  const includedTypesSet = new Set(uniqueIncludedTypes);
  const filteredExcludedTypes = Array.from(allExcludedTypes).filter(
    (type) => !includedTypesSet.has(type)
  );

  // Construct text query from categories (for textSearch endpoint)
  // Fallback to a generic query if no categories
  const categoryNames = preferences.categories || [];

  const textQuery = categoryNames.length > 0

    ? `please recommend me ${Array.from(includedTypesSet).join(", ")} places for these categories ${categoryNames.join(", ")}`
    : "places near me";

  try {
    // Field mask for Places API (New) - specify which fields we need
    const fieldMask = "places.id,places.displayName,places.location,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount,places.photos,places.types,places.regularOpeningHours,nextPageToken";


    // Text Search API doesn't support includedTypes/excludedTypes in request
    // We'll filter results after receiving them
    // Request more results than needed to account for filtering
    const requestBody: any = {
      textQuery: textQuery,
      maxResultCount: 60, // Text Search supports up to 60 results
      locationBias: {
        circle: {
          center: {
            latitude: location.lat,
            longitude: location.lng,
          },
          radius: radius,
        },
      },
    };

    // Add pageToken if provided (for pagination)
    if (pageToken) {
      requestBody.pageToken = pageToken;
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
        `Google Places API error:`,
        response.status,
        response.statusText,
        errorText
      );
      return { places: [], nextPageToken: undefined };
    }

    const data = await response.json();

    // Extract nextPageToken from response for pagination
    const nextPageToken = data.nextPageToken;


    if (!data.places?.length) {
      return { places: [], nextPageToken };
    }

    // Filter places by included/excluded types (textSearch doesn't support this in request)
    const filteredPlaces = data.places.filter((place: any) => {
      const placeTypeSet = new Set(place.types || []);

      // Check if place matches any included types
      const matchesIncludedType = uniqueIncludedTypes.some((type) =>
        placeTypeSet.has(type)
      );

      // Check if place matches any excluded types
      const matchesExcludedType = filteredExcludedTypes.some((type) =>
        placeTypeSet.has(type)
      );

      // Include place if it matches included types and doesn't match excluded types
      return matchesIncludedType && !matchesExcludedType;
    });

    if (!filteredPlaces.length) {
      return { places: [], nextPageToken: nextPageToken };
    }

    // Map places to our format
    const places = filteredPlaces.map((place: any) => {
      // Extract photo reference from new API format
      const primaryPhoto = place.photos?.[0];
      const imageUrl = primaryPhoto?.name
        ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
        : null;

      const images =
        place.photos
          ?.slice(0, 5)
          .map((photo: any) => {
            return photo.name
              ? `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
              : null;
          })
          .filter((img: string | null) => img !== null) || [];

      // Convert price level (0-4) to dollar ranges
      const priceLevel = place.priceLevel || 0;
      const price_min =
        priceLevel === 0
          ? 0
          : priceLevel === 1
            ? 0
            : priceLevel === 2
              ? 15
              : priceLevel === 3
                ? 50
                : 100;
      const price_max =
        priceLevel === 0
          ? 0
          : priceLevel === 1
            ? 25
            : priceLevel === 2
              ? 75
              : priceLevel === 3
                ? 150
                : 500;

      // Determine category based on place types - match to user's selected categories
      const placeTypeSet = new Set(place.types || []);
      let matchedCategory = preferences.categories?.[0] || "general";

      // Try to match the place types to one of the user's selected categories
      for (const category of preferences.categories || []) {
        const categoryKey = category.toLowerCase();
        const categoryTypes = CATEGORY_MAPPINGS[categoryKey] || [];
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
        priceLevel: priceLevel,
        rating: place.rating || 0,
        reviewCount: place.userRatingCount || 0,
        imageUrl: imageUrl,
        images: images.filter((img: string | null) => img !== null),
        placeId: place.id,
        openingHours: place.regularOpeningHours
          ? {
            open_now: place.regularOpeningHours.openNow || false,
            weekday_text: place.regularOpeningHours.weekdayDescriptions || [],
          }
          : null,
        placeTypes: place.types || [],
        price_min,
        price_max,
      };
    });

    // Return all filtered results - pagination is handled via pageToken

    console.log("returned", places.length, nextPageToken);


    return {
      places: places,
      nextPageToken: nextPageToken,
    };
  } catch (error) {
    console.error(`Error fetching Google Places:`, error);
    return { places: [], nextPageToken: undefined };
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

  // Map travel mode to Routes API enum
  const routesTravelMode =
    travelMode === "walking"
      ? "WALK"
      : travelMode === "driving"
        ? "DRIVE"
        : "TRANSIT";

  // Routes API computeRouteMatrix supports up to 25 destinations per request
  const BATCH_SIZE = 25;
  const batches: any[][] = [];
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    batches.push(places.slice(i, i + BATCH_SIZE));
  }

  const annotatedPlaces: any[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    try {
      const requestBody = {
        origins: [
          {
            waypoint: {
              location: {
                latLng: {
                  latitude: origin.lat,
                  longitude: origin.lng,
                },
              },
            },
          },
        ],
        destinations: batch.map((p) => ({
          waypoint: {
            location: {
              latLng: {
                latitude: p.location.lat,
                longitude: p.location.lng,
              },
            },
          },
        })),
        travelMode: routesTravelMode,
      };

      const response = await fetch(
        "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask":
              "originIndex,destinationIndex,distanceMeters,duration,status,condition",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Routes API error (batch ${batchIndex + 1}):`,
          response.status,
          errorText
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

      // Routes API returns an array of route matrix elements
      const elements: any[] = await response.json();

      // Build a map of destinationIndex -> element for quick lookup
      const elementMap = new Map<number, any>();
      for (const el of elements) {
        if (el.destinationIndex !== undefined) {
          elementMap.set(el.destinationIndex, el);
        }
      }

      const batchAnnotated = batch.map((place, index) => {
        const element = elementMap.get(index);
        if (
          element &&
          element.condition === "ROUTE_EXISTS" &&
          element.distanceMeters !== undefined
        ) {
          const distanceKm = element.distanceMeters / 1000;
          // duration comes as "123s" string
          const durationStr = element.duration || "0s";
          const durationSeconds = parseInt(
            durationStr.replace("s", ""),
            10
          );
          const travelTimeMin = Math.round(durationSeconds / 60);

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
        `Error getting travel times for batch ${batchIndex + 1}:`,
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
      if (place.travelTimeMin > preferences.travel_constraint_value) {
        return false;
      }
    } else if (
      preferences.travel_constraint_type === "distance" &&
      place.distanceKm
    ) {
      if (place.distanceKm > preferences.travel_constraint_value) {
        return false;
      }
    }
    return true;
  });

  // Stage 2: Filter by budget (skip for nature cards)
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

    // Apply budget filter for non-stroll cards
    if (
      place.price_min > preferences.budget_max ||
      place.price_max < preferences.budget_min
    ) {
      return false;
    }

    return true;
  });

  // Stage 3: Filter by category
  remaining = remaining.filter((place) => {
    if (!preferences.categories.includes(place.category)) {
      return false;
    }
    return true;
  });

  // Stage 3.5: Hard filter for nature cards - must have valid anchor
  remaining = remaining.filter((place) => {
    const categoryKey = place.category?.toLowerCase() || "";
    const isNatureCard =
      categoryKey === "nature" ||
      categoryKey.includes("stroll") ||
      categoryKey === "take a stroll" ||
      categoryKey === "take-a-stroll" ||
      categoryKey === "take_a_stroll";

    if (isNatureCard) {
      // Hard filter: Nature cards must have valid anchor (park, trail, scenic area)
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
        "beach",
        "national_park",
        "state_park",
        "wildlife_park",
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
