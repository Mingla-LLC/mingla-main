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

// All 10 discover categories
const DISCOVER_CATEGORIES = [
  "Stroll",
  "Sip & Chill",
  "Casual Eats",
  "Screen & Relax",
  "Creative & Hands-On",
  "Picnics",
  "Play & Move",
  "Dining Experiences",
  "Wellness Dates",
  "Freestyle",
];

// Category to Google Places type mapping (using CONFIRMED valid Google Places API New types)
// Reference: https://developers.google.com/maps/documentation/places/web-service/place-types
// Each category uses distinct types where possible to avoid duplicates
const CATEGORY_TO_PLACE_TYPES: { [key: string]: string[] } = {
  "Stroll": [
    "park",
    "hiking_area",
  ],
  "Sip & Chill": [
    "bar",
    "cafe",
  ],
  "Casual Eats": [
    "restaurant",
  ],
  "Screen & Relax": [
    "movie_theater",
  ],
  "Creative & Hands-On": [
    "art_gallery",
    "museum",
  ],
  "Picnics": [
    "beach", // outdoor spots good for picnics
    "marina",
    "park", // Fallback
  ],
  "Play & Move": [
    "bowling_alley",
    "amusement_park",
  ],
  "Dining Experiences": [
    "bakery",
    "ice_cream_shop",
  ],
  "Wellness Dates": [
    "spa",
    "gym",
  ],
  "Freestyle": [
    "tourist_attraction",
    "night_club",
    "aquarium",
    "zoo",
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
    const { location, radius = 10000 } = request;
    const usDateKey = getUsDateKey();

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

          const { data: cachedRow, error: cacheReadError } = await adminClient
            .from("discover_daily_cache")
            .select("cards, featured_card")
            .eq("user_id", userId)
            .eq("us_date_key", usDateKey)
            .maybeSingle<DiscoverDailyCacheRow>();

          if (cacheReadError) {
            console.warn("Discover daily cache read warning:", cacheReadError.message);
          } else if (cachedRow?.cards && cachedRow.cards.length > 0) {
            console.log(`Cache hit for user ${userId} on ${usDateKey}. Returning persisted discover cards.`);
            return new Response(
              JSON.stringify({
                cards: cachedRow.cards,
                featuredCard: cachedRow.featured_card,
                meta: {
                  totalResults: cachedRow.cards.length,
                  categories: DISCOVER_CATEGORIES,
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

    console.log(`Fetching discover experiences for location: ${location.lat}, ${location.lng}`);

    // Fetch candidate places for all categories in parallel
    const categoryPromises = DISCOVER_CATEGORIES.map((category) =>
      fetchCandidatesForCategory(category, location, radius)
    );

    const allCategoryCandidates = await Promise.all(categoryPromises);

    // Select one unique place per category, avoiding duplicates
    const usedPlaceIds = new Set<string>();
    const places: DiscoverPlace[] = [];
    const successfulCategories: string[] = [];
    const failedCategories: string[] = [];

    for (let i = 0; i < DISCOVER_CATEGORIES.length; i++) {
      const category = DISCOVER_CATEGORIES[i];
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
    console.log(`Found ${places.length} unique places across ${DISCOVER_CATEGORIES.length} categories`);

    // Select an 11th unique card as the featured card - MUST be a dining experience
    // Collect all unused candidates across all categories
    const allUnusedCandidates: DiscoverPlace[] = [];
    for (const candidates of allCategoryCandidates) {
      if (candidates && candidates.length > 0) {
        const unusedFromCategory = candidates.filter(c => !usedPlaceIds.has(c.placeId));
        allUnusedCandidates.push(...unusedFromCategory);
      }
    }

    console.log(`Total unused candidates for featured card: ${allUnusedCandidates.length}`);

    // Filter to only dining experiences (ONLY "Dining Experiences" category, not "Casual Eats")
    const diningCategories = ["Dining Experiences"];
    const unusedDiningCandidates = allUnusedCandidates.filter(
      (c) => c.category === "Dining Experiences"
    );

    console.log(`Dining Experience candidates for featured card: ${unusedDiningCandidates.length}`);

    // Sort dining candidates by rating/popularity score and pick the best
    const sortedDining = unusedDiningCandidates.sort((a, b) => {
      const aScore = (a.rating || 0) * Math.log10((a.reviewCount || 1) + 1);
      const bScore = (b.rating || 0) * Math.log10((b.reviewCount || 1) + 1);
      return bScore - aScore;
    });

    // If no dining candidates available, fall back to any unused candidate
    let featuredPlace = sortedDining[0] || null;
    
    if (!featuredPlace) {
      console.log(`No dining candidates available, falling back to any category`);
      const sortedUnused = allUnusedCandidates.sort((a, b) => {
        const aScore = (a.rating || 0) * Math.log10((a.reviewCount || 1) + 1);
        const bScore = (b.rating || 0) * Math.log10((b.reviewCount || 1) + 1);
        return bScore - aScore;
      });
      featuredPlace = sortedUnused[0] || null;
    }

    if (featuredPlace) {
      // Add featured to used set to ensure it's tracked
      usedPlaceIds.add(featuredPlace.placeId);
      const isDiningExperience = featuredPlace.category === "Dining Experiences";
      console.log(`✓ Selected featured card: "${featuredPlace.name}" (category: ${featuredPlace.category}, ${isDiningExperience ? 'DINING EXPERIENCE ✓' : 'FALLBACK - not Dining Experience'}, id: ${featuredPlace.id}, placeId: ${featuredPlace.placeId}) from ${allUnusedCandidates.length} unused candidates`);
    } else {
      console.log(`✗ No unused candidates available for featured card`);
    }

    // Verify featured is different from all grid cards
    const gridPlaceIds = places.map(p => p.placeId);
    if (featuredPlace && gridPlaceIds.includes(featuredPlace.placeId)) {
      console.error(`BUG: Featured card placeId ${featuredPlace.placeId} is in grid cards!`);
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

    // Calculate travel times for all places (including featured)
    const allPlacesToProcess = featuredPlace ? [...places, featuredPlace] : places;
    const placesWithTravel = await annotateWithTravel(allPlacesToProcess, location);

    // Enrich with AI descriptions
    const enrichedPlaces = await enrichWithAI(placesWithTravel);

    // Separate the featured card from the grid cards
    const gridPlaces = featuredPlace ? enrichedPlaces.slice(0, -1) : enrichedPlaces;
    const enrichedFeaturedPlace = featuredPlace ? enrichedPlaces[enrichedPlaces.length - 1] : null;

    // Convert to card format - these are the 10 small cards (one per category)
    const cards = gridPlaces.map((place) => convertToCard(place));

    // Convert featured place to card format (separate from grid cards)
    const featuredCard = enrichedFeaturedPlace ? convertToCard(enrichedFeaturedPlace) : null;

    if (adminClient && userId && cards.length > 0) {
      const { error: cacheWriteError } = await adminClient
        .from("discover_daily_cache")
        .upsert(
          {
            user_id: userId,
            us_date_key: usDateKey,
            cards,
            featured_card: featuredCard,
            generated_location: {
              lat: location.lat,
              lng: location.lng,
              radius,
            },
          },
          { onConflict: "user_id,us_date_key" }
        );

      if (cacheWriteError) {
        console.warn("Discover daily cache write warning:", cacheWriteError.message);
      } else {
        console.log(`Persisted discover daily cache for user ${userId} (${usDateKey})`);
      }
    }

    console.log(`Returning ${cards.length} grid cards + featured card: "${featuredCard?.title}"`);

    return new Response(
      JSON.stringify({
        cards, // 10 category cards for grid display
        featuredCard, // 11th unique card for featured display (NOT in cards array)
        meta: {
          totalResults: cards.length,
          categories: DISCOVER_CATEGORIES,
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
  radius: number
): Promise<DiscoverPlace[]> {
  const placeTypes = CATEGORY_TO_PLACE_TYPES[category];
  if (!placeTypes || placeTypes.length === 0) {
    console.warn(`No place types defined for category: ${category}`);
    return [];
  }

  try {
    // Use Nearby Search (New) for better results
    const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";
    
    const fieldMask = [
      "places.id",
      "places.displayName",
      "places.location",
      "places.formattedAddress",
      "places.priceLevel",
      "places.rating",
      "places.userRatingCount",
      "places.photos",
      "places.types",
      "places.regularOpeningHours",
    ].join(",");

    const requestBody = {
      includedTypes: placeTypes,
      maxResultCount: 20, // Get more to allow for deduplication and featured card selection
      locationRestriction: {
        circle: {
          center: {
            latitude: location.lat,
            longitude: location.lng,
          },
          radius: radius,
        },
      },
      rankPreference: "POPULARITY", // Prioritize popular places
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

    if (!data.places || data.places.length === 0) {
      console.log(`No places found for category: ${category}`);
      return [];
    }

    // Filter out excluded types
    const validPlaces = data.places.filter((place: any) => {
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
    "Stroll": "Scenic walking adventure through beautiful surroundings. Perfect for relaxation and exploration.",
    "Sip & Chill": "Cozy spot for great drinks and conversation in a relaxed atmosphere.",
    "Casual Eats": "Delicious food in a welcoming environment. Great for any occasion.",
    "Screen & Relax": "Entertainment and relaxation combined for a perfect outing.",
    "Creative & Hands-On": "Engage your creativity in an inspiring artistic environment.",
    "Picnics": "Beautiful outdoor space perfect for a relaxing picnic experience.",
    "Play & Move": "Fun and active entertainment for an exciting time out.",
    "Dining Experiences": "Exceptional culinary journey with outstanding service.",
    "Wellness Dates": "Relax and rejuvenate in a peaceful wellness setting.",
    "Freestyle": "Unique experience waiting to be discovered.",
  };
  return descriptions[place.category] || "An amazing experience waiting for you.";
}

function generateFallbackHighlights(place: any): string[] {
  const highlights: { [key: string]: string[] } = {
    "Stroll": ["Scenic Views", "Nature Trail"],
    "Sip & Chill": ["Great Atmosphere", "Quality Drinks"],
    "Casual Eats": ["Tasty Food", "Good Service"],
    "Screen & Relax": ["Entertainment", "Comfortable"],
    "Creative & Hands-On": ["Artistic", "Interactive"],
    "Picnics": ["Outdoor", "Relaxing"],
    "Play & Move": ["Fun Activities", "Exciting"],
    "Dining Experiences": ["Fine Cuisine", "Elegant"],
    "Wellness Dates": ["Relaxing", "Rejuvenating"],
    "Freestyle": ["Unique", "Memorable"],
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
