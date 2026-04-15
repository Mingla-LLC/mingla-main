import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import { serveCardsFromPipeline, upsertPlaceToPool, insertCardToPool } from '../_shared/cardPoolService.ts';
import { resolveCategories } from '../_shared/categoryPlaceTypes.ts';
import { googleLevelToTierSlug, priceLevelToRange } from '../_shared/priceTiers.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '');

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

    // ── Pool-first pipeline: try to serve from card_pool before hitting Google ──
    try {
      const poolResult = await serveCardsFromPipeline(
        {
          supabaseAdmin: supabaseAdmin,
          userId: 'anonymous',
          lat: location.lat,
          lng: location.lng,
          radiusMeters: radius,
          categories: ['Drink'], // Night-out maps to Drink category in pool
          limit: 15,
          cardType: 'single',
        },
        GOOGLE_API_KEY!,
      );

      if (poolResult.fromPool >= 10) {
        console.log(`[pool-first] Serving ${poolResult.cards.length} night-out cards from pool (${poolResult.fromPool} pool, ${poolResult.fromApi} API)`);
        // Convert pool cards to night-out card format
        const poolNightOutCards = poolResult.cards.map((card: any, index: number) => {
          const now = new Date();
          const dayOffset = index % 7;
          const eventDate = new Date(now);
          eventDate.setDate(eventDate.getDate() + dayOffset);
          const dateOptions: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
          const dateStr = eventDate.toLocaleDateString("en-US", dateOptions);
          const startHour = 20 + (index % 4);
          const endHour = startHour + 3;
          const formatHour = (h: number) => {
            const hr = h % 24;
            const ampm = hr >= 12 ? "PM" : "AM";
            const display = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr;
            return `${display}:00 ${ampm}`;
          };

          return {
            id: `${card.placeId || card.id}_evt_${dayOffset}`,
            placeName: card.title,
            eventName: "Night Out",
            hostName: card.title,
            image: card.image || "https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800",
            images: card.images || [],
            price: card.priceRange || "Free",
            matchPercentage: card.matchScore || 80,
            date: dateStr,
            time: formatHour(startHour),
            timeRange: `${formatHour(startHour)} - ${formatHour(endHour)}`,
            location: card.address?.split(",").slice(-2).join(",").trim() || card.address || "",
            tags: ["Night Out", "Social"],
            musicGenre: "house",
            peopleGoing: Math.max(20, Math.min(500, Math.round((card.reviewCount || 0) * 0.3))),
            address: card.address || "",
            description: card.description || "",
            rating: card.rating || 4.0,
            reviewCount: card.reviewCount || 0,
            coordinates: { lat: card.lat, lng: card.lng },
            distance: card.distance || "Unknown",
            travelTime: card.travelTime || "Unknown",
          };
        });

        return new Response(
          JSON.stringify({
            venues: poolNightOutCards,
            meta: {
              totalResults: poolNightOutCards.length,
              totalCandidates: poolResult.totalPoolSize,
              poolFirst: true,
              fromPool: poolResult.fromPool,
              fromApi: poolResult.fromApi,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`[pool-first] Pool has ${poolResult.fromPool} cards, need >= 10. Falling back to Google API.`);
    } catch (poolError) {
      console.warn("[pool-first] Pool query failed, falling back to Google API:", poolError);
    }

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

    // ── Pool storage: store generated venue cards in card_pool (fire-and-forget) ──
    (async () => {
      try {
        for (const card of cards) {
          const placePoolId = await upsertPlaceToPool(
            supabaseAdmin,
            {
              id: card.id?.split('_evt_')[0] || card.id,
              placeId: card.id?.split('_evt_')[0] || card.id,
              displayName: { text: card.placeName },
              name: card.placeName,
              formattedAddress: card.address,
              location: { latitude: card.coordinates?.lat, longitude: card.coordinates?.lng },
              rating: card.rating,
              userRatingCount: card.reviewCount,
              types: [],
              photos: [],
              priceLevel: 0,
              regularOpeningHours: null,
            },
            GOOGLE_API_KEY!,
            'night_out_experiences'
          );

          await insertCardToPool(supabaseAdmin, {
            placePoolId: placePoolId || undefined,
            googlePlaceId: card.id?.split('_evt_')[0] || card.id,
            cardType: 'single',
            title: card.placeName,
            category: 'Drink', // Night-out maps to Drink category
            categories: ['Drink'],
            description: card.description,
            imageUrl: card.image,
            images: card.images,
            address: card.address,
            lat: card.coordinates?.lat || 0,
            lng: card.coordinates?.lng || 0,
            rating: card.rating,
            reviewCount: card.reviewCount,
            priceMin: 0,
            priceMax: 0,
            priceTier: googleLevelToTierSlug(card.priceLevel),
            openingHours: null,
          });
        }
        console.log(`[pool-storage] Stored ${cards.length} night-out cards in pool`);
      } catch (e) {
        console.warn('[pool-storage] Error storing night-out cards:', e);
      }
    })();

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
    const { results: typeResults } = await batchSearchPlaces(
      supabaseAdmin,
      GOOGLE_API_KEY!,
      search.types,
      location.lat,
      location.lng,
      radius,
      { maxResultsPerType: 20, rankPreference: 'POPULARITY', ttlHours: 24 }
    );

    // Merge all results
    const allPlaces: any[] = [];
    for (const places of Object.values(typeResults)) {
      allPlaces.push(...places);
    }

    if (allPlaces.length === 0) {
      console.log(`No venues found for: ${search.label}`);
      return [];
    }

    // Sort by rating + review count score
    const sorted = allPlaces.sort((a: any, b: any) => {
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
  const imageUrl = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

  const images: string[] = [];

  const priceRange = priceLevelToRange(place.priceLevel);
  const price_min = priceRange.min;
  const price_max = priceRange.max;

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
    priceLevel: place.priceLevel,
    price_min,
    price_max,
    priceTier: googleLevelToTierSlug(place.priceLevel),
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
    return venues.map((v, i) => {
      const fallback = generateFallbackEvent(v, i);
      return { ...v, ...fallback, musicGenre: assignFallbackGenre(v.venueType, i) };
    });
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
            content: `You are creating realistic upcoming EVENT listings for nightlife venues. Each venue hosts a specific event happening in the next 7 days. Return valid JSON array only, no markdown.

Each item must have:
- "eventName": A specific, creative event name (e.g. "Neon Pulse Friday", "Salsa Fever Night", "Acoustic Sessions Vol.12", "R&B Sundays"). NOT generic like "Club Night".
- "hostName": A realistic DJ, performer, or organizer name (e.g. "DJ Mello", "The Lagos Collective", "MC Blaze & Friends"). NOT the venue type.
- "description": 1-2 sentences describing what happens at this specific event (~120 chars).
- "dayOffset": Number 0-6 representing days from today this event takes place (spread them across the week, not all 0).
- "startHour": Event start hour in 24h format (18-23). Bars: 18-20, Clubs: 21-23, Live music: 19-21.
- "musicGenre": Exactly one of: afrobeats, hiphop-rnb, house, techno, jazz-blues, latin-salsa, reggae, kpop, lounge-ambient, acoustic-indie.

Make each event feel unique and real — like an actual party, show, or gathering someone would attend.`,
          },
          {
            role: "user",
            content: `Generate event listings for these ${venues.length} venues:\n${venueList}\n\nReturn JSON array of ${venues.length} objects. Spread dayOffset values across 0-6 so events appear on different upcoming nights.`,
          },
        ],
        max_tokens: 2500,
        temperature: 0.85,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the JSON from the AI response
    let enrichments: {
      eventName: string;
      hostName?: string;
      description: string;
      dayOffset?: number;
      startHour?: number;
      musicGenre?: string;
    }[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        enrichments = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error("Failed to parse AI enrichment:", parseErr);
    }

    return venues.map((v, i) => {
      const e = enrichments[i];
      const aiGenre = e?.musicGenre;
      const validGenre = aiGenre && VALID_GENRE_IDS.includes(aiGenre) ? aiGenre : null;
      const fallback = generateFallbackEvent(v, i);
      return {
        ...v,
        eventName: e?.eventName || fallback.eventName,
        hostName: e?.hostName || fallback.hostName,
        description: e?.description || fallback.description,
        dayOffset: (typeof e?.dayOffset === "number" && e.dayOffset >= 0 && e.dayOffset <= 6) ? e.dayOffset : fallback.dayOffset,
        startHour: (typeof e?.startHour === "number" && e.startHour >= 18 && e.startHour <= 23) ? e.startHour : fallback.startHour,
        musicGenre: validGenre || assignFallbackGenre(v.venueType, i),
      };
    });
  } catch (error) {
    console.error("Error enriching venues with AI:", error);
    return venues.map((v, i) => {
      const fallback = generateFallbackEvent(v, i);
      return { ...v, ...fallback, musicGenre: assignFallbackGenre(v.venueType, i) };
    });
  }
}

/**
 * Generate realistic fallback event details when AI is unavailable
 */
function generateFallbackEvent(venue: NightOutPlace, index: number): {
  eventName: string;
  hostName: string;
  description: string;
  dayOffset: number;
  startHour: number;
} {
  const eventsByType: { [key: string]: { name: string; host: string; desc: string; hour: number }[] } = {
    "Night Clubs": [
      { name: "Neon Pulse Friday", host: "DJ Phantom", desc: "Non-stop dance floor energy with the hottest tracks all night long.", hour: 22 },
      { name: "Midnight Frequency", host: "DJ Nova & MC Blaze", desc: "Underground vibes meet mainstream heat — two rooms, two sounds.", hour: 23 },
      { name: "Bass Cathedral", host: "The Selecta Crew", desc: "Deep bass, strobe lights, and a crowd that knows how to move.", hour: 21 },
      { name: "Glow Party", host: "DJ Lumina", desc: "UV lights, body paint, and electrifying beats until sunrise.", hour: 22 },
    ],
    "Bars & Lounges": [
      { name: "Sunset Social Hour", host: "The Mixologists", desc: "Craft cocktails and curated conversations as the sun goes down.", hour: 18 },
      { name: "Jazz & Juleps", host: "The Velvet Trio", desc: "Smooth jazz melodies paired with signature bourbon cocktails.", hour: 19 },
      { name: "Wine Down Wednesday", host: "Sommelier Sarah", desc: "Curated wine tastings with live acoustic accompaniment.", hour: 18 },
      { name: "Speakeasy Sessions", host: "Bartender's Guild", desc: "Step back in time with Prohibition-era cocktails and swing music.", hour: 20 },
    ],
    "Live Music": [
      { name: "Acoustic Sessions Vol.8", host: "The Campfire Collective", desc: "Intimate stripped-back performances from local singer-songwriters.", hour: 20 },
      { name: "Rhythm & Roots", host: "Mama Afrika Band", desc: "Live afrobeat and world music fusion that gets everyone grooving.", hour: 19 },
      { name: "Open Mic Spotlight", host: "MC Tommy", desc: "Your stage, your moment — open mic for singers, poets, and comics.", hour: 19 },
      { name: "Soulful Saturdays", host: "The Soul Kitchen", desc: "Live soul, R&B, and neo-soul performed by top local talent.", hour: 20 },
    ],
    "Event Venues": [
      { name: "The Social Mixer", host: "Connect Events", desc: "Meet new people, make new friends — curated networking with music and drinks.", hour: 19 },
      { name: "Cultural Fusion Night", host: "Unity Collective", desc: "Art, dance, and music from around the world under one roof.", hour: 20 },
      { name: "Rooftop Rave", host: "Skyline DJs", desc: "Open-air dancing with city views and handpicked DJs.", hour: 21 },
      { name: "Dance Workshop & Party", host: "Groove Academy", desc: "Learn new moves then dance the night away — all levels welcome.", hour: 18 },
    ],
    "Karaoke": [
      { name: "Sing-Off Showdown", host: "Karaoke Kings", desc: "Compete for the crown in this high-energy karaoke competition.", hour: 20 },
      { name: "Pop Anthems Night", host: "DJ Encore", desc: "Belt out the biggest pop hits with a full backing track and lights show.", hour: 21 },
      { name: "Duet Battle Royale", host: "The Voice Club", desc: "Grab a partner and battle other duos for karaoke supremacy.", hour: 20 },
      { name: "Throwback Thursdays", host: "Retro Vibes", desc: "90s and 2000s classics — nostalgia hits and sing-along moments.", hour: 19 },
    ],
  };

  const events = eventsByType[venue.venueType] || eventsByType["Night Clubs"];
  const event = events[index % events.length];

  // Spread events across the next 7 days
  const dayOffset = index % 7;

  return {
    eventName: event.name,
    hostName: event.host,
    description: event.desc,
    dayOffset,
    startHour: event.hour,
  };
}

function assignFallbackGenre(venueType: string, index: number): string {
  const genres = VENUE_GENRE_FALLBACK[venueType] || ["house", "hiphop-rnb", "jazz-blues"];
  return genres[index % genres.length];
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
  const now = new Date();

  // Use AI-provided dayOffset to compute the actual event date
  const dayOffset = typeof venue.dayOffset === "number" ? venue.dayOffset : 0;
  const eventDate = new Date(now);
  eventDate.setDate(eventDate.getDate() + dayOffset);

  const dateOptions: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  const dateStr = eventDate.toLocaleDateString("en-US", dateOptions); // e.g. "Fri, Feb 21"

  // Use AI-provided start hour or default based on venue type
  const startHour = typeof venue.startHour === "number" ? venue.startHour : (venue.venueType === "Bars & Lounges" ? 18 : 21);
  const endHour = startHour >= 21 ? startHour + 4 : startHour + 3; // events last 3-4 hours
  const formatHour = (h: number) => {
    const hr = h % 24;
    const ampm = hr >= 12 ? "PM" : "AM";
    const display = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr;
    return `${display}:00 ${ampm}`;
  };
  const timeRange = `${formatHour(startHour)} - ${formatHour(endHour)}`;

  // Estimate attendees from review count (events, not venues)
  const peopleGoing = Math.max(20, Math.min(500, Math.round((venue.reviewCount || 0) * 0.3)));

  const priceRange = formatPriceRange(venue.price_min, venue.price_max);

  return {
    id: `${venue.placeId}_evt_${dayOffset}`,
    placeName: venue.name,
    eventName: venue.eventName || "Night Out",
    hostName: venue.hostName || venue.name,
    image: venue.imageUrl || "https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800",
    images: venue.images || [],
    price: priceRange,
    matchPercentage: calculateMatchScore(venue),
    date: dateStr,
    time: formatHour(startHour),
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
