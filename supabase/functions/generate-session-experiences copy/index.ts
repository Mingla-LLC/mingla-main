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

// Category to Google Places type mapping (same as generate-experiences)
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
    console.log("🎯 Generate session experiences endpoint called");

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
    console.log(`📋 Fetching preferences for session: ${request.session_id}`);
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
      console.log("⚠️ No preferences found for session");
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

    console.log(
      `✅ Found ${allPreferences.length} user preference(s) for session`
    );

    // Aggregate preferences
    const aggregated = aggregatePreferences(allPreferences);
    console.log(
      "📊 Aggregated preferences:",
      JSON.stringify(aggregated, null, 2)
    );

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

    console.log(`📍 Using central location: ${location.lat}, ${location.lng}`);

    // Convert aggregated preferences to UserPreferences format
    const preferences: UserPreferences = {
      mode: "collaboration",
      budget_min: aggregated.budget_min,
      budget_max: aggregated.budget_max,
      people_count: allPreferences.length, // Number of participants
      categories: aggregated.categories,
      travel_mode: aggregated.travel_mode,
      travel_constraint_type: aggregated.travel_constraint_type,
      travel_constraint_value: aggregated.travel_constraint_value,
      datetime_pref: aggregated.datetime_pref || new Date().toISOString(),
    };

    // Fetch places from Google Places API (reuse logic from generate-experiences)
    let places: any[] = [];
    try {
      places = await fetchGooglePlaces(preferences, location);
      console.log(`✅ Fetched ${places.length} places from Google`);
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
      console.log("⚠️ No places found, returning empty result");
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
      console.log(
        `✅ Annotated ${placesWithTravel.length} places with travel info`
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
        console.warn(
          `⚠️ Could not geocode "${locationStr}", skipping this location`
        );
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
      console.log(
        `✅ Using custom coordinates: ${firstWithCoords.custom_lat}, ${firstWithCoords.custom_lng}`
      );
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
          console.log(
            `✅ Using location string as coordinates: ${lat}, ${lng}`
          );
          return { lat, lng };
        }
      }
    }

    // Fallback 3: Use fallback location if provided
    if (fallbackLocation.lat !== 0 && fallbackLocation.lng !== 0) {
      console.log(
        `✅ Using provided fallback location: ${fallbackLocation.lat}, ${fallbackLocation.lng}`
      );
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

  // Places API (New) base URL
  const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";

  // Field mask for Places API (New) - specify which fields we need
  const fieldMask =
    "places.id,places.displayName,places.location,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount,places.photos,places.types,places.regularOpeningHours";

  for (const category of preferences.categories || []) {
    console.log(`\n🏷️ Processing category: "${category}"`);
    const placeTypes = CATEGORY_MAPPINGS[category] || ["tourist_attraction"];
    console.log(`   Mapped to place types: ${placeTypes.join(", ")}`);

    for (const placeType of placeTypes.slice(0, 3)) {
      try {
        console.log(`   🔎 Searching for type: ${placeType}`);

        const requestBody = {
          includedTypes: [placeType],
          maxResultCount: 10,
          locationRestriction: {
            circle: {
              center: {
                latitude: location.lat,
                longitude: location.lng,
              },
              radius: radius,
            },
          },
        };

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
            `Google Places API error for ${placeType}:`,
            response.status,
            response.statusText,
            errorText
          );
          continue;
        }

        const data = await response.json();

        if (data.error) {
          console.error(
            `   ❌ Google Places API returned error:`,
            data.error.message || data.error
          );
          continue;
        }

        console.log(
          `   ✅ Found ${data.places?.length || 0} places for ${placeType}`
        );

        if (data.places?.length) {
          const places = data.places.slice(0, 10).map((place: any) => {
            // Extract photo references from new API format
            const primaryPhoto = place.photos?.[0];
            const imageUrl = primaryPhoto?.name
              ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
              : null;

            const images =
              place.photos
                ?.slice(0, 5)
                .map(
                  (photo: any) =>
                    `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
                ) || [];

            return {
              id: place.id,
              name: place.displayName?.text || "Unknown Place",
              category,
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
              placeId: place.id, // In new API, place.id is the identifier
              openingHours: place.regularOpeningHours
                ? {
                    openNow: place.regularOpeningHours.openNow,
                    weekdayText: place.regularOpeningHours.weekdayDescriptions,
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
      console.log(`✅ Annotated batch ${batchIndex + 1}/${batches.length}`);
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
  const initialCount = places.length;

  console.log(`\n🔍 Starting filter process with ${initialCount} places`);

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
    return !(
      place.price_min > preferences.budget_max ||
      place.price_max < preferences.budget_min
    );
  });

  // Stage 3: Filter by category
  remaining = remaining.filter((place) => {
    return preferences.categories.includes(place.category);
  });

  const finalCount = remaining.length;
  console.log(`\n✅ Filter complete: ${initialCount} → ${finalCount} places`);

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
  const isOpenNow = place.openingHours?.openNow || false;

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
  };
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
