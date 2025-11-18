import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// Category to Google Places type mapping
const CATEGORY_MAPPINGS: { [key: string]: string[] } = {
  "Sip & Chill": [
    "bar",
    "wine_bar",
    "brewery",
    "cafe",
    "coffee_shop",
    "tea_house",
  ],
  Stroll: [
    "park",
    "tourist_attraction",
    "point_of_interest",
    "natural_feature",
    "zoo",
    "aquarium",
    "botanical_garden",
  ],
  Dining: [
    "restaurant",
    "fine_dining_restaurant",
    "steakhouse",
    "seafood_restaurant",
  ],
  "Screen & Relax": [
    "movie_theater",
    "spa",
    "beauty_salon",
    "massage_therapist",
  ],
  Creative: [
    "art_gallery",
    "museum",
    "pottery_studio",
    "craft_store",
    "art_studio",
    "library",
  ],
  "Play & Move": [
    "bowling_alley",
    "gym",
    "sports_complex",
    "recreation_center",
    "tennis_court",
    "basketball_court",
    "golf_course",
    "mini_golf",
    "climbing_gym",
    "skating_rink",
    "amusement_park",
  ],
  "Casual Eats": [
    "restaurant",
    "food_court",
    "meal_takeaway",
    "fast_food_restaurant",
    "food_truck",
    "sandwich_shop",
    "pizza_restaurant",
  ],
  Freestyle: [
    "restaurant",
    "bar",
    "cafe",
    "tourist_attraction",
    "art_gallery",
    "museum",
    "park",
    "movie_theater",
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
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🎯 Generate experiences endpoint called");
    console.log("📥 Request method:", req.method);
    console.log("📥 Request URL:", req.url);

    let request: GenerationRequest;
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
    console.log(
      "📝 Received request:",
      JSON.stringify({
        userId: request.user_id,
        hasPreferences: !!request.preferences,
        hasLocation: !!request.location,
      })
    );

    const { preferences, location } = request;

    // Detailed logging of preferences
    console.log(
      "📋 Full preferences object:",
      JSON.stringify(preferences, null, 2)
    );
    console.log("📍 Location:", JSON.stringify(location, null, 2));
    console.log("🏷️ Categories:", preferences?.categories);
    console.log(
      "💰 Budget:",
      `$${preferences?.budget_min} - $${preferences?.budget_max}`
    );
    console.log("🚶 Travel mode:", preferences?.travel_mode);
    console.log(
      "⏱️ Travel constraint:",
      `${preferences?.travel_constraint_type}: ${preferences?.travel_constraint_value}`
    );

    if (!preferences) {
      console.error("❌ Preferences are required");
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
      console.error("❌ Location is required");
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
    try {
      places = await fetchGooglePlaces(preferences, location);
      console.log(`✅ Fetched ${places.length} places from Google`);
    } catch (error) {
      console.error("❌ Error fetching Google Places:", error);
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
      console.log("⚠️ No places found, returning empty result");
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
      console.log(
        `✅ Annotated ${placesWithTravel.length} places with travel info`
      );
    } catch (error) {
      console.error(
        "❌ Error annotating with travel, using places without travel info:",
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
    console.log(
      `✅ Filtered to ${filtered.length} places matching constraints`
    );

    // Calculate match scores
    const withMatchScores = filtered.map((place) => ({
      ...place,
      matchScore: calculateMatchScore(place, preferences, location),
      matchFactors: calculateMatchFactors(place, preferences, location),
    }));

    // Sort by match score
    const sorted = withMatchScores.sort((a, b) => b.matchScore - a.matchScore);
    console.log(`✅ Sorted ${sorted.length} places by match score`);

    // Generate AI content for top results
    const topResults = sorted.slice(0, 20);
    let enriched: any[] = [];
    try {
      enriched = await enrichWithAI(topResults, preferences);
      console.log(`✅ Enriched ${enriched.length} places with AI content`);
    } catch (error) {
      console.error(
        "❌ Error enriching with AI, using fallback content:",
        error
      );
      // Use places with fallback descriptions
      enriched = topResults.map((place) => ({
        ...place,
        description: generateFallbackDescription(place),
        highlights: generateFallbackHighlights(place),
      }));
    }

    // Convert to card format
    const cards = enriched.map((place) => convertToCard(place, preferences));
    console.log(`✅ Converted ${cards.length} places to card format`);

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
    console.error("❌ Error generating experiences:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    const errorStack = error instanceof Error ? error.stack : String(error);

    console.error("Error details:", errorStack);

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

  const allPlaces: any[] = [];
  const radius =
    preferences.travel_constraint_type === "distance"
      ? Math.min((preferences.travel_constraint_value || 5) * 1000, 50000)
      : 10000; // Default 10km

  console.log(
    `🔍 Starting Google Places search for ${
      preferences.categories?.length || 0
    } categories`
  );
  console.log(`📍 Search location: ${location.lat}, ${location.lng}`);
  console.log(`📏 Search radius: ${radius}m`);
  console.log(`🔑 Google API Key present: ${!!GOOGLE_API_KEY}`);

  for (const category of preferences.categories || []) {
    console.log(`\n🏷️ Processing category: "${category}"`);
    const placeTypes = CATEGORY_MAPPINGS[category] || ["tourist_attraction"];
    console.log(`   Mapped to place types: ${placeTypes.join(", ")}`);

    for (const placeType of placeTypes.slice(0, 3)) {
      try {
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location.lat},${location.lng}&radius=${radius}&type=${placeType}&key=${GOOGLE_API_KEY}`;
        console.log(`   🔎 Searching for type: ${placeType}`);

        const response = await fetch(url);
        if (!response.ok) {
          console.error(
            `Google Places API error for ${placeType}:`,
            response.status,
            response.statusText
          );
          continue;
        }

        const data = await response.json();
        console.log(`   📊 API Response status: ${data.status}`);

        if (
          data.status &&
          data.status !== "OK" &&
          data.status !== "ZERO_RESULTS"
        ) {
          console.error(
            `   ❌ Google Places API returned error status: ${data.status}`,
            data.error_message
          );
          continue;
        }

        if (data.status === "ZERO_RESULTS") {
          console.log(`   ⚠️ No results found for ${placeType}`);
          continue;
        }

        console.log(
          `   ✅ Found ${data.results?.length || 0} places for ${placeType}`
        );

        if (data.results?.length) {
          const places = data.results.slice(0, 10).map((place: any) => ({
            id: place.place_id,
            name: place.name,
            category,
            location: {
              lat: place.geometry.location.lat,
              lng: place.geometry.location.lng,
            },
            address: place.vicinity || place.formatted_address,
            priceLevel: place.price_level,
            rating: place.rating,
            reviewCount: place.user_ratings_total || 0,
            imageUrl: place.photos?.[0]
              ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${place.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`
              : null,
            images:
              place.photos
                ?.slice(0, 5)
                .map(
                  (photo: any) =>
                    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photo.photo_reference}&key=${GOOGLE_API_KEY}`
                ) || [],
            placeId: place.place_id,
            openingHours: place.opening_hours,
            placeTypes: place.types || [],
            // Convert Google price_level (0-4) to dollar ranges
            // 0 = Free, 1 = $, 2 = $$, 3 = $$$, 4 = $$$$
            price_min:
              place.price_level === 0
                ? 0
                : place.price_level === 1
                ? 0
                : place.price_level === 2
                ? 15
                : place.price_level === 3
                ? 50
                : 100,
            price_max:
              place.price_level === 0
                ? 0
                : place.price_level === 1
                ? 25
                : place.price_level === 2
                ? 75
                : place.price_level === 3
                ? 150
                : 500,
          }));

          allPlaces.push(...places);
          console.log(`   ➕ Added ${places.length} places from ${placeType}`);
        }
      } catch (error) {
        console.error(`   ❌ Error fetching ${placeType}:`, error);
      }
    }
  }

  console.log(`\n📦 Total places fetched: ${allPlaces.length}`);
  return allPlaces;
}

async function annotateWithTravel(
  places: any[],
  origin: { lat: number; lng: number },
  travelMode: string
): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    console.log("⚠️ No Google API key, skipping travel annotation");
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

  console.log(
    `📦 Processing ${batches.length} batch(es) for travel annotation`
  );

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
          `❌ Distance Matrix API returned error status: ${data.status}`,
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
      console.log(`✅ Annotated batch ${batchIndex + 1}/${batches.length}`);
    } catch (error) {
      console.error(
        `❌ Error getting travel times for batch ${batchIndex + 1}:`,
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
  const initialCount = places.length;

  console.log(`\n🔍 Starting filter process with ${initialCount} places`);
  console.log(`📋 Filter criteria:`, {
    travel_constraint_type: preferences.travel_constraint_type,
    travel_constraint_value: preferences.travel_constraint_value,
    budget_min: preferences.budget_min,
    budget_max: preferences.budget_max,
    categories: preferences.categories,
  });

  // Stage 1: Filter by travel constraint
  const beforeTravelFilter = remaining.length;
  const travelFilteredPlaces: any[] = [];
  remaining = remaining.filter((place) => {
    if (preferences.travel_constraint_type === "time" && place.travelTimeMin) {
      if (place.travelTimeMin > preferences.travel_constraint_value) {
        travelFilteredPlaces.push(place);
        return false;
      }
    } else if (
      preferences.travel_constraint_type === "distance" &&
      place.distanceKm
    ) {
      if (place.distanceKm > preferences.travel_constraint_value) {
        travelFilteredPlaces.push(place);
        return false;
      }
    }
    return true;
  });
  const afterTravelFilter = remaining.length;
  const travelFilteredOut = beforeTravelFilter - afterTravelFilter;
  if (travelFilteredOut > 0) {
    console.log(
      `   ⏱️  Travel constraint filter: ${beforeTravelFilter} → ${afterTravelFilter} (removed ${travelFilteredOut} places)`
    );
    console.log(
      `      Constraint: ${preferences.travel_constraint_type} <= ${preferences.travel_constraint_value}`
    );
    if (travelFilteredPlaces.length > 0) {
      const example = travelFilteredPlaces[0];
      const constraintValue =
        preferences.travel_constraint_type === "time"
          ? `${example.travelTimeMin} min`
          : `${example.distanceKm} km`;
      console.log(
        `      Example filtered place: "${example.name}" (${constraintValue})`
      );
    }
  } else {
    console.log(
      `   ⏱️  Travel constraint filter: ${beforeTravelFilter} → ${afterTravelFilter} (no places removed)`
    );
  }

  // Stage 2: Filter by budget
  const beforeBudgetFilter = remaining.length;
  const budgetFilteredPlaces: any[] = [];
  remaining = remaining.filter((place) => {
    if (
      place.price_min > preferences.budget_max ||
      place.price_max < preferences.budget_min
    ) {
      budgetFilteredPlaces.push(place);
      return false;
    }
    return true;
  });
  const afterBudgetFilter = remaining.length;
  const budgetFilteredOut = beforeBudgetFilter - afterBudgetFilter;
  if (budgetFilteredOut > 0) {
    console.log(
      `   💰 Budget filter: ${beforeBudgetFilter} → ${afterBudgetFilter} (removed ${budgetFilteredOut} places)`
    );
    console.log(
      `      Budget range: $${preferences.budget_min} - $${preferences.budget_max}`
    );
    if (budgetFilteredPlaces.length > 0) {
      console.log(
        `      Example filtered place: "${budgetFilteredPlaces[0].name}" ($${budgetFilteredPlaces[0].price_min}-$${budgetFilteredPlaces[0].price_max})`
      );
    }
  } else {
    console.log(
      `   💰 Budget filter: ${beforeBudgetFilter} → ${afterBudgetFilter} (no places removed)`
    );
  }

  // Stage 3: Filter by category
  const beforeCategoryFilter = remaining.length;
  const categoryFilteredPlaces: any[] = [];
  remaining = remaining.filter((place) => {
    if (!preferences.categories.includes(place.category)) {
      categoryFilteredPlaces.push(place);
      return false;
    }
    return true;
  });
  const afterCategoryFilter = remaining.length;
  const categoryFilteredOut = beforeCategoryFilter - afterCategoryFilter;
  if (categoryFilteredOut > 0) {
    console.log(
      `   🏷️  Category filter: ${beforeCategoryFilter} → ${afterCategoryFilter} (removed ${categoryFilteredOut} places)`
    );
    console.log(
      `      Allowed categories: ${preferences.categories.join(", ")}`
    );
    if (categoryFilteredPlaces.length > 0) {
      const categoryCounts: { [key: string]: number } = {};
      categoryFilteredPlaces.forEach((place) => {
        categoryCounts[place.category] =
          (categoryCounts[place.category] || 0) + 1;
      });
      console.log(
        `      Filtered categories: ${Object.entries(categoryCounts)
          .map(([cat, count]) => `${cat} (${count})`)
          .join(", ")}`
      );
    }
  } else {
    console.log(
      `   🏷️  Category filter: ${beforeCategoryFilter} → ${afterCategoryFilter} (no places removed)`
    );
  }

  const finalCount = remaining.length;
  const totalFilteredOut = initialCount - finalCount;
  console.log(
    `\n✅ Filter complete: ${initialCount} → ${finalCount} places (removed ${totalFilteredOut} total)`
  );
  console.log(
    `   Breakdown: Travel=${travelFilteredOut}, Budget=${budgetFilteredOut}, Category=${categoryFilteredOut}\n`
  );

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
  };
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
