import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// Night-out venue types mapped to Google Places API (New) types
// All use Nearby Search with strict locationRestriction for accurate local results
const NIGHT_OUT_SEARCHES: { label: string; types: string[] }[] = [
  { label: "Night Clubs", types: ["night_club"] },
  { label: "Bars & Lounges", types: ["bar"] },
  { label: "Live Music", types: ["live_music_venue"] },
  { label: "Event Venues", types: ["event_venue"] },
  { label: "Karaoke", types: ["karaoke"] },
];

// Tags to assign based on venue type and data
const VENUE_TYPE_TAGS: { [key: string]: string[] } = {
  "Night Clubs": ["Dancing", "DJ", "Energetic", "Late Night"],
  "Bars & Lounges": ["Social", "Cocktails", "Chill", "Trendy"],
  "Live Music": ["Live Music", "Performance", "Intimate", "Vibey"],
  "Event Venues": ["Events", "Social", "Community", "Gathering"],
  "Karaoke": ["Karaoke", "Fun", "Group", "Interactive"],
};

// Valid genre IDs that the client uses for filtering
const VALID_GENRE_IDS = [
  "afrobeats", "hiphop-rnb", "house", "techno", "jazz-blues",
  "latin-salsa", "reggae", "kpop", "lounge-ambient", "acoustic-indie",
];

// Fallback genre assignment when AI doesn't provide one
const VENUE_GENRE_FALLBACK: { [key: string]: string[] } = {
  "Night Clubs": ["house", "techno", "hiphop-rnb"],
  "Bars & Lounges": ["jazz-blues", "lounge-ambient", "acoustic-indie"],
  "Live Music": ["acoustic-indie", "jazz-blues", "reggae"],
  "Event Venues": ["hiphop-rnb", "afrobeats", "latin-salsa"],
  "Karaoke": ["kpop", "hiphop-rnb", "latin-salsa"],
};

interface NightOutRequest {
  location: { lat: number; lng: number };
  radius?: number;
}

interface NightOutPlace {
  id: string;
  name: string;
  venueType: string;
  location: { lat: number; lng: number };
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
  images: string[];
  placeId: string;
  priceLevel: number;
  price_min: number;
  price_max: number;
  tags: string[];
  openingHours: {
    open_now: boolean;
    weekday_text: string[];
  } | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const request: NightOutRequest = await req.json();
    const { location, radius = 10000 } = request;

    if (!location || !location.lat || !location.lng) {
      return new Response(
        JSON.stringify({ error: "Location is required", venues: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!GOOGLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Google API key not configured", venues: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetching night-out venues for location: ${location.lat}, ${location.lng}`);

    // Fetch all venue types in parallel
    const searchPromises = NIGHT_OUT_SEARCHES.map((search) =>
      fetchVenuesForType(search, location, radius)
    );
    const allResults = await Promise.all(searchPromises);

    // Deduplicate across all categories
    const usedPlaceIds = new Set<string>();
    const allVenues: NightOutPlace[] = [];

    for (const venues of allResults) {
      for (const venue of venues) {
        if (!usedPlaceIds.has(venue.placeId)) {
          usedPlaceIds.add(venue.placeId);
          allVenues.push(venue);
        }
      }
    }

    // Sort by popularity (rating * log(reviewCount))
    allVenues.sort((a, b) => {
      const aScore = (a.rating || 0) * Math.log10((a.reviewCount || 1) + 1);
      const bScore = (b.rating || 0) * Math.log10((b.reviewCount || 1) + 1);
      return bScore - aScore;
    });

    // Limit to top 15 venues
    const topVenues = allVenues.slice(0, 15);

    console.log(`Found ${allVenues.length} unique venues, returning top ${topVenues.length}`);

    // Enrich with AI-generated event names and descriptions
    const enrichedVenues = await enrichVenuesWithAI(topVenues);

    // Calculate travel info
    const venuesWithTravel = await annotateWithTravel(enrichedVenues, location);

    // Convert to final card format
    const cards = venuesWithTravel.map((venue) => convertToNightOutCard(venue));

    return new Response(
      JSON.stringify({
        venues: cards,
        meta: {
          totalResults: cards.length,
          totalCandidates: allVenues.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in night-out-experiences:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        venues: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Fetch venues for a specific night-out category
 */
async function fetchVenuesForType(
  search: { label: string; types: string[] },
  location: { lat: number; lng: number },
  radius: number
): Promise<NightOutPlace[]> {
  try {
    // Always use Nearby Search with strict locationRestriction
    // This ensures results are strictly within the user's area
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
      includedTypes: search.types,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: location.lat, longitude: location.lng },
          radius: radius,
        },
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
      console.error(`Google Places API error for ${search.label}:`, response.status, errorText);
      return [];
    }

    const data = await response.json();

    if (!data.places || data.places.length === 0) {
      console.log(`No venues found for: ${search.label}`);
      return [];
    }

    // Sort by rating + review count score
    const sorted = data.places.sort((a: any, b: any) => {
      const aScore = (a.rating || 0) * Math.min(1, (a.userRatingCount || 0) / 50);
      const bScore = (b.rating || 0) * Math.min(1, (b.userRatingCount || 0) / 50);
      return bScore - aScore;
    });

    const tags = VENUE_TYPE_TAGS[search.label] || ["Night Out", "Social"];

    return sorted.map((place: any) => transformToNightOutPlace(place, search.label, tags, location));
  } catch (error) {
    console.error(`Error fetching venues for ${search.label}:`, error);
    return [];
  }
}

/**
 * Transform a Google Places result to NightOutPlace format
 */
function transformToNightOutPlace(
  place: any,
  venueType: string,
  baseTags: string[],
  location: { lat: number; lng: number }
): NightOutPlace {
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

  const priceLevel = place.priceLevel || 0;
  const priceLevelNum =
    typeof priceLevel === "string"
      ? [
          "PRICE_LEVEL_FREE",
          "PRICE_LEVEL_INEXPENSIVE",
          "PRICE_LEVEL_MODERATE",
          "PRICE_LEVEL_EXPENSIVE",
          "PRICE_LEVEL_VERY_EXPENSIVE",
        ].indexOf(priceLevel)
      : priceLevel;

  const price_min = priceLevelNum <= 0 ? 0 : priceLevelNum === 1 ? 10 : priceLevelNum === 2 ? 20 : priceLevelNum === 3 ? 50 : 100;
  const price_max = priceLevelNum <= 0 ? 0 : priceLevelNum === 1 ? 30 : priceLevelNum === 2 ? 60 : priceLevelNum === 3 ? 120 : 300;

  // Build Google Places types into tags
  const placeTypes = new Set(place.types || []);
  const extraTags: string[] = [];
  if (placeTypes.has("night_club")) extraTags.push("Clubbing");
  if (placeTypes.has("bar")) extraTags.push("Drinks");
  if (placeTypes.has("live_music_venue")) extraTags.push("Live Music");
  if (placeTypes.has("event_venue")) extraTags.push("Events");
  if (placeTypes.has("karaoke")) extraTags.push("Karaoke");

  // Combine and deduplicate tags
  const allTags = [...new Set([...baseTags, ...extraTags])].slice(0, 4);

  return {
    id: place.id,
    name: place.displayName?.text || "Unknown Venue",
    venueType,
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
    priceLevel: priceLevelNum,
    price_min,
    price_max,
    tags: allTags,
    openingHours: place.regularOpeningHours
      ? {
          open_now: place.regularOpeningHours.openNow || false,
          weekday_text: place.regularOpeningHours.weekdayDescriptions || [],
        }
      : null,
  };
}

/**
 * Enrich venues with AI-generated event names and descriptions
 */
async function enrichVenuesWithAI(venues: NightOutPlace[]): Promise<any[]> {
  if (!OPENAI_API_KEY || venues.length === 0) {
    return venues.map((v) => ({
      ...v,
      eventName: generateFallbackEventName(v),
      description: generateFallbackDescription(v),
    }));
  }

  // Batch all venues into a single AI call for efficiency
  try {
    const venueList = venues
      .map(
        (v, i) =>
          `${i + 1}. "${v.name}" (${v.venueType}, rating: ${v.rating}, reviews: ${v.reviewCount})`
      )
      .join("\n");

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
            content: `You generate creative event names, short descriptions, and assign a music genre for nightlife venues. Return valid JSON array only, no markdown. Each item: {"eventName": "...", "description": "...", "musicGenre": "..."}. Event names should be catchy (2-4 words). Descriptions should be 1-2 sentences max (~120 chars). musicGenre MUST be exactly one of: afrobeats, hiphop-rnb, house, techno, jazz-blues, latin-salsa, reggae, kpop, lounge-ambient, acoustic-indie. Choose the most fitting genre based on the venue type and name.`,
          },
          {
            role: "user",
            content: `Generate event names, descriptions, and music genres for these ${venues.length} venues:\n${venueList}\n\nReturn JSON array of ${venues.length} objects with "eventName", "description", and "musicGenre" keys. musicGenre must be one of: afrobeats, hiphop-rnb, house, techno, jazz-blues, latin-salsa, reggae, kpop, lounge-ambient, acoustic-indie.`,
          },
        ],
        max_tokens: 1500,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the JSON from the AI response
    let enrichments: { eventName: string; description: string; musicGenre?: string }[] = [];
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        enrichments = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error("Failed to parse AI enrichment:", parseErr);
    }

    return venues.map((v, i) => {
      const aiGenre = enrichments[i]?.musicGenre;
      const validGenre = aiGenre && VALID_GENRE_IDS.includes(aiGenre) ? aiGenre : null;
      return {
        ...v,
        eventName: enrichments[i]?.eventName || generateFallbackEventName(v),
        description: enrichments[i]?.description || generateFallbackDescription(v),
        musicGenre: validGenre || assignFallbackGenre(v.venueType, i),
      };
    });
  } catch (error) {
    console.error("Error enriching venues with AI:", error);
    return venues.map((v) => ({
      ...v,
      eventName: generateFallbackEventName(v),
      description: generateFallbackDescription(v),
    }));
  }
}

function generateFallbackEventName(venue: NightOutPlace): string {
  const names: { [key: string]: string[] } = {
    "Night Clubs": ["Electric Nights", "Club Night", "Late Night Vibes", "After Dark"],
    "Bars & Lounges": ["Happy Hour", "Cocktail Evening", "Lounge Sessions", "Sunset Drinks"],
    "Live Music": ["Live Sessions", "Music Night", "Open Stage", "Live & Loud"],
    "Event Venues": ["Social Night", "The Gathering", "Night Event", "Community Night"],
    "Karaoke": ["Karaoke Night", "Sing Along", "Open Mic", "Karaoke Party"],
  };
  const options = names[venue.venueType] || ["Night Out", "Evening Event"];
  return options[Math.floor(Math.random() * options.length)];
}

function assignFallbackGenre(venueType: string, index: number): string {
  const genres = VENUE_GENRE_FALLBACK[venueType] || ["house", "hiphop-rnb", "jazz-blues"];
  return genres[index % genres.length];
}

function generateFallbackDescription(venue: NightOutPlace): string {
  const descriptions: { [key: string]: string } = {
    "Night Clubs": "High-energy nightlife with great music and an electric atmosphere.",
    "Bars & Lounges": "Trendy spot with craft cocktails and a vibrant social scene.",
    "Live Music": "Intimate live performances in an unforgettable setting.",
    "Event Venues": "Exciting social events and gatherings in a dynamic space.",
    "Karaoke": "Fun karaoke sessions with friends in a lively atmosphere.",
  };
  return descriptions[venue.venueType] || "A great night out waiting for you.";
}

/**
 * Calculate travel times using Google Routes API
 */
async function annotateWithTravel(
  venues: any[],
  origin: { lat: number; lng: number }
): Promise<any[]> {
  if (!GOOGLE_API_KEY || venues.length === 0) {
    return venues.map((v) => ({ ...v, distance: "Unknown", travelTime: "Unknown" }));
  }

  try {
    // Use Routes Matrix API for batch travel times
    const destinations = venues.map((v) => ({
      waypoint: { location: { latLng: { latitude: v.location.lat, longitude: v.location.lng } } },
    }));

    const response = await fetch(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters",
        },
        body: JSON.stringify({
          origins: [
            {
              waypoint: {
                location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
              },
            },
          ],
          destinations,
          travelMode: "DRIVE",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Routes API error: ${response.status}`);
    }

    const routeResults = await response.json();

    // Map results back to venues
    return venues.map((venue, index) => {
      const result = Array.isArray(routeResults)
        ? routeResults.find((r: any) => r.destinationIndex === index)
        : null;

      if (result && result.distanceMeters && result.duration) {
        const distKm = result.distanceMeters / 1000;
        const durationMin = parseInt(result.duration.replace("s", "")) / 60;

        return {
          ...venue,
          distance: distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)} km`,
          travelTime: `${Math.round(durationMin)} min`,
        };
      }

      return { ...venue, distance: "Unknown", travelTime: "Unknown" };
    });
  } catch (error) {
    console.error("Error calculating travel times:", error);
    return venues.map((v) => ({ ...v, distance: "Unknown", travelTime: "Unknown" }));
  }
}

/**
 * Convert enriched venue to the final Night Out card format
 */
function convertToNightOutCard(venue: any): any {
  // Generate a time range based on current day
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

  const openHour = venue.venueType === "Bars & Lounges" ? "6:00 PM" : "9:00 PM";
  const closeHour = isWeekend ? "3:00 AM" : "1:00 AM";
  const timeRange = `${openHour} - ${closeHour}`;

  // Format next available date
  const dateOptions: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const todayStr = now.toLocaleDateString("en-US", dateOptions);

  // Estimate people-going from review count
  const peopleGoing = Math.max(20, Math.min(500, Math.round((venue.reviewCount || 0) * 0.3)));

  // Format price range
  const priceRange = formatPriceRange(venue.price_min, venue.price_max);

  return {
    id: venue.placeId,
    placeName: venue.name,
    eventName: venue.eventName || "Night Out",
    hostName: venue.venueType,
    image: venue.imageUrl || "https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800",
    images: venue.images || [],
    price: priceRange,
    matchPercentage: calculateMatchScore(venue),
    date: todayStr,
    time: openHour,
    timeRange,
    location: venue.address?.split(",").slice(-2).join(",").trim() || venue.address || "",
    tags: venue.tags || [],
    musicGenre: venue.musicGenre || "house",
    peopleGoing,
    address: venue.address || "",
    description: venue.description || "",
    rating: venue.rating || 4.0,
    reviewCount: venue.reviewCount || 0,
    coordinates: venue.location,
    distance: venue.distance || "Unknown",
    travelTime: venue.travelTime || "Unknown",
  };
}

function calculateMatchScore(venue: any): number {
  const rating = venue.rating || 0;
  const reviewCount = venue.reviewCount || 0;
  const ratingScore = (rating / 5) * 60;
  const reviewScore = Math.min(40, (reviewCount / 200) * 40);
  return Math.min(99, Math.max(60, Math.round(ratingScore + reviewScore)));
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}
