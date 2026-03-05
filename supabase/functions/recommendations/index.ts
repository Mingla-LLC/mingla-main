import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getPlaceTypesForCategory,
  getCategoryKeywords,
  resolveCategory,
} from '../_shared/categoryPlaceTypes.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const EVENTBRITE_TOKEN = Deno.env.get("EVENTBRITE_TOKEN");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// Enhanced Experience Type System with Structured Attributes
const EXPERIENCE_TYPE_ATTRIBUTES = {
  atmosphere: {
    noise_level: ["quiet", "moderate", "loud", "very_loud"],
    lighting: ["dim", "soft", "bright", "natural"],
    privacy: ["intimate", "semi_private", "open", "public"],
    ambience: ["romantic", "casual", "upscale", "cozy", "energetic", "relaxed"],
  },
  practicalities: {
    price_tier: ["budget", "moderate", "upscale", "luxury"],
    parking: ["free", "paid", "valet", "street", "none"],
    wifi: ["free", "paid", "none"],
    reservation_required: ["required", "recommended", "not_needed"],
  },
  activity_style: {
    team_based: ["yes", "no", "optional"],
    competitive: ["yes", "no", "optional"],
    kid_friendly: ["yes", "no", "adults_only"],
    solo_safe: ["yes", "no", "group_recommended"],
  },
  special_vibes: {
    scenic_view: ["yes", "no"],
    candlelight: ["yes", "no"],
    live_music: ["yes", "no", "occasional"],
    novelty: ["high", "medium", "low", "none"],
  },
};

// Deterministic Rules - Hard Gates
const EXPERIENCE_TYPE_RULES = {
  romantic: {
    required: [
      "romantic_ambience",
      "intimate_seating",
      "scenic_view",
      "candlelight",
      "date_spot",
    ],
    forbidden: [
      "kid_party_only",
      "sports_bar_only",
      "frat_vibe",
      "loud_music",
      "family_restaurant",
      "strip_club",
    ],
    min_score: 0.65,
  },
  first_date: {
    required: [
      "conversation_friendly",
      "comfortable_seating",
      "moderate_noise",
      "easy_parking",
    ],
    forbidden: [
      "explicitly_loud_only",
      "overly_logistical",
      "long_lines",
      "complex_gear",
      "high_energy_only",
    ],
    min_score: 0.6,
  },
  business: {
    required: [
      "wifi",
      "quiet",
      "reservation_possible",
      "work_friendly",
      "professional_setting",
    ],
    forbidden: [
      "strip_club",
      "loud_party_only",
      "nightclub",
      "dance_club",
      "sports_bar_only",
    ],
    min_score: 0.7,
  },
  group_fun: {
    required: [
      "team_based",
      "capacity_group_friendly",
      "multiplayer",
      "group_activity",
      "social",
    ],
    forbidden: ["intimate_only", "quiet_only", "solo_activity", "couples_only"],
    min_score: 0.65,
  },
  solo_adventure: {
    required: [
      "safe_solo",
      "individual_activity",
      "self_guided",
      "solo_friendly",
    ],
    forbidden: [
      "requires_pairing_only",
      "team_only",
      "group_required",
      "unsafe_solo",
    ],
    min_score: 0.6,
  },
  friendly: {
    required: ["casual", "budget_friendly", "easy_meetup"],
    forbidden: [
      "date_only",
      "couples_only",
      "members_only",
      "exclusive",
      "upscale_only",
    ],
    min_score: 0.5,
  },
};

// Feature-Based Scoring Recipes
const EXPERIENCE_TYPE_SCORING = {
  romantic: {
    ambience: 0.25,
    privacy: 0.2,
    photo_moments: 0.15,
    service_quality: 0.15,
    scenic_view: 0.1,
    candlelight: 0.1,
    intimate_seating: 0.05,
  },
  first_date: {
    conversation_friendly: 0.3,
    moderate_price: 0.2,
    no_heavy_logistics: 0.15,
    comfortable_seating: 0.15,
    easy_parking: 0.1,
    moderate_noise: 0.1,
  },
  business: {
    quiet_clarity: 0.25,
    wifi: 0.2,
    professional_setting: 0.2,
    reservations: 0.15,
    work_friendly: 0.1,
    meeting_space: 0.1,
  },
  group_fun: {
    capacity: 0.25,
    team_based: 0.2,
    celebratory_energy: 0.15,
    multiplayer: 0.15,
    social: 0.1,
    group_activity: 0.1,
    easy_multiplayer: 0.05,
  },
  friendly: {
    casual: 0.3,
    budget_friendly: 0.25,
    easy_meetup: 0.2,
    social: 0.15,
    accessible: 0.1,
  },
  solo_adventure: {
    safe: 0.3,
    individual_activity: 0.25,
    introspective_value: 0.2,
    self_guided: 0.15,
    solo_friendly: 0.1,
  },
};

// LLM cache for generated copy
const llmCache = new Map<
  string,
  { oneLiner: string; tip: string; expires: number }
>();

interface RecommendationsRequest {
  budget: { min: number; max: number; perPerson: boolean };
  categories: string[];
  experienceTypes?: string[];
  timeWindow: {
    kind: string;
    start?: string;
    end?: string;
    timeOfDay?: string;
  };
  travel: {
    mode: string;
    constraint: { type: string; maxMinutes?: number; maxDistance?: number };
  };
  origin: { lat: number; lng: number };
  units: string;
  groupSize?: number; // New group size field
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("🎯 Recommendations endpoint called");

  try {
    const preferences: RecommendationsRequest = await req.json();
    console.log(
      "📝 Received preferences:",
      JSON.stringify(preferences, null, 2)
    );

    // Validate required fields
    if (!preferences.origin?.lat || !preferences.origin?.lng) {
      throw new Error("Origin coordinates are required");
    }

    if (!preferences.categories?.length) {
      throw new Error("At least one category must be selected");
    }

    // Fetch data from multiple sources in parallel
    const [places, events] = await Promise.allSettled([
      fetchGooglePlaces(preferences),
      fetchEventbriteEvents(preferences),
    ]);

    console.log("📊 Data fetching results:", {
      places:
        places.status === "fulfilled"
          ? places.value.length
          : `Error: ${places.reason}`,
      events:
        events.status === "fulfilled"
          ? events.value.length
          : `Error: ${events.reason}`,
    });

    // Combine and normalize candidates
    const allCandidates = [
      ...(places.status === "fulfilled" ? places.value : []),
      ...(events.status === "fulfilled" ? events.value : []),
    ];

    if (allCandidates.length === 0) {
      return new Response(
        JSON.stringify({
          cards: [],
          meta: {
            totalResults: 0,
            processingTimeMs: Date.now() - startTime,
            sources: { googlePlaces: 0, eventbrite: 0 },
            llmUsed: false,
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Add travel information using Distance Matrix API
    const candidatesWithTravel = await annotateWithTravel(
      allCandidates,
      preferences
    );
    console.log(
      "🚗 Travel annotation completed for",
      candidatesWithTravel.length,
      "candidates"
    );

    // Filter by constraints
    const filteredCandidates = filterByConstraints(
      candidatesWithTravel,
      preferences
    );
    console.log("🔍 Filtered down to", filteredCandidates.length, "candidates");

    // Score and rank candidates
    const rankedCandidates = scoreAndRank(filteredCandidates, preferences);
    console.log("📈 Scored and ranked", rankedCandidates.length, "candidates");

    // Apply diversity and take top results
    const diversifiedCandidates = applyDiversity(
      rankedCandidates,
      preferences.categories
    );
    const topCandidates = diversifiedCandidates.slice(0, 20);

    // Enrich with LLM-generated copy
    let llmUsed = false;
    if (OPENAI_API_KEY && topCandidates.length > 0) {
      try {
        await enrichWithLLM(topCandidates, preferences);
        llmUsed = true;
        console.log("🤖 LLM enrichment completed");
      } catch (error) {
        console.error("⚠️ LLM enrichment failed:", error);
        // Continue without LLM copy
        addFallbackCopy(topCandidates);
      }
    } else {
      addFallbackCopy(topCandidates);
    }

    // Convert to final card format
    const cards = await convertToCards(topCandidates, preferences);

    const response = {
      cards,
      meta: {
        totalResults: allCandidates.length,
        processingTimeMs: Date.now() - startTime,
        sources: {
          googlePlaces: places.status === "fulfilled" ? places.value.length : 0,
          eventbrite: events.status === "fulfilled" ? events.value.length : 0,
        },
        llmUsed,
      },
    };

    console.log(
      `✅ Returning ${cards.length} cards in ${Date.now() - startTime}ms`
    );
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("❌ Error in recommendations:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        cards: [],
        meta: {
          totalResults: 0,
          processingTimeMs: Date.now() - startTime,
          sources: { googlePlaces: 0, eventbrite: 0 },
          llmUsed: false,
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
  preferences: RecommendationsRequest
): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    console.warn("⚠️ Google API key not available");
    return [];
  }

  const allPlaces: any[] = [];
  const { lat, lng } = preferences.origin;
  const radius =
    preferences.travel.constraint.type === "DISTANCE"
      ? Math.min((preferences.travel.constraint.maxDistance || 5) * 1000, 50000)
      : 10000; // Default 10km radius

  for (const category of preferences.categories) {
    if (!resolveCategory(category)) continue;

    const placeTypes = getPlaceTypesForCategory(category);

    for (const placeType of placeTypes.slice(0, 3)) {
      try {
        // Enhanced Google Places API call with group size considerations
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${placeType}&key=${GOOGLE_API_KEY}`;

        const response = await fetch(url);
        if (!response.ok) continue;

        const data = await response.json();
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
            reviewCount: place.user_ratings_total,
            imageUrl: place.photos?.[0]
              ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${place.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`
              : null,
            placeId: place.place_id,
            openingHours: place.opening_hours,
            source: "google_places",
            description: "", // Will be used for activity matching
            placeTypes: place.types || [],
          }));

          allPlaces.push(...places);
        }
      } catch (error) {
        console.error(`Error fetching ${placeType}:`, error);
      }
    }
  }

  return allPlaces;
}

async function fetchEventbriteEvents(
  preferences: RecommendationsRequest
): Promise<any[]> {
  if (!EVENTBRITE_TOKEN) {
    console.warn("⚠️ Eventbrite token not available");
    return [];
  }

  try {
    const { lat, lng } = preferences.origin;
    const radius =
      preferences.travel.constraint.type === "DISTANCE"
        ? Math.min(preferences.travel.constraint.maxDistance || 5, 50)
        : 25; // Default 25km radius

    // Map time window to date range
    let startDate = new Date();
    let endDate = new Date();

    switch (preferences.timeWindow.kind) {
      case "Now":
        endDate.setHours(23, 59, 59);
        break;
      case "Tonight":
        startDate.setHours(17, 0, 0);
        endDate.setHours(23, 59, 59);
        break;
      case "ThisWeekend":
        const today = new Date();
        const dayOfWeek = today.getDay();
        const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
        startDate = new Date(today);
        startDate.setDate(today.getDate() + daysUntilFriday);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 2);
        break;
      case "Custom":
        if (preferences.timeWindow.start)
          startDate = new Date(preferences.timeWindow.start);
        if (preferences.timeWindow.end)
          endDate = new Date(preferences.timeWindow.end);
        break;
    }

    const eventbriteUrl = `https://www.eventbriteapi.com/v3/events/search/?location.latitude=${lat}&location.longitude=${lng}&location.within=${radius}km&start_date.range_start=${startDate.toISOString()}&start_date.range_end=${endDate.toISOString()}&expand=venue,ticket_availability&sort_by=date`;

    const response = await fetch(eventbriteUrl, {
      headers: {
        Authorization: `Bearer ${EVENTBRITE_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error("Eventbrite API error:", response.status);
      return [];
    }

    const data = await response.json();

    return (data.events || []).slice(0, 15).map((event: any) => ({
      id: event.id,
      name: event.name.text,
      category: "freestyle", // Default category for events
      location: {
        lat: parseFloat(event.venue?.latitude || lat),
        lng: parseFloat(event.venue?.longitude || lng),
      },
      address:
        event.venue?.address?.localized_address_display ||
        "Address not available",
      startTime: event.start.utc,
      endTime: event.end.utc,
      price: event.ticket_availability?.minimum_ticket_price?.major_value || 0,
      // Group size considerations: Eventbrite provides capacity data
      maxCapacity: event.capacity || null, // For group size filtering
      imageUrl: event.logo?.url || null,
      eventId: event.id,
      source: "eventbrite",
    }));
  } catch (error) {
    console.error("Error fetching Eventbrite events:", error);
    return [];
  }
}

async function annotateWithTravel(
  candidates: any[],
  preferences: RecommendationsRequest
): Promise<any[]> {
  if (!GOOGLE_API_KEY || candidates.length === 0) return candidates;

  const origin = `${preferences.origin.lat},${preferences.origin.lng}`;
  const destinations = candidates
    .slice(0, 25)
    .map((c) => `${c.location.lat},${c.location.lng}`)
    .join("|");

  const travelMode = preferences.travel.mode.toLowerCase();
  const mode =
    travelMode === "walking"
      ? "walking"
      : travelMode === "transit"
      ? "transit"
      : "driving";

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
      origin
    )}&destinations=${encodeURIComponent(destinations)}&mode=${mode}&units=${
      preferences.units
    }&key=${GOOGLE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return candidates;

    const data = await response.json();

    if (data.rows?.[0]?.elements) {
      data.rows[0].elements.forEach((element: any, index: number) => {
        if (index < candidates.length && element.status === "OK") {
          candidates[index].travel = {
            durationMinutes: Math.ceil(element.duration.value / 60),
            distanceText: element.distance.text,
            mode: preferences.travel.mode,
          };
        }
      });
    }
  } catch (error) {
    console.error("Error fetching travel data:", error);
  }

  return candidates;
}

// Group Size Scoring Function
function calculateGroupSizeScore(candidate: any, groupSize: number): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || "").toLowerCase();

  // Solo activities (groupSize = 1)
  if (groupSize === 1) {
    const soloKeywords = [
      "museum",
      "library",
      "gallery",
      "exhibit",
      "workshop",
      "class",
      "trail",
      "hiking",
      "walking",
      "solo",
      "individual",
    ];
    const soloTypes = [
      "museum",
      "library",
      "art_gallery",
      "park",
      "hiking_area",
    ];

    const soloMatch =
      soloKeywords.some(
        (keyword) =>
          candidateName.includes(keyword) || candidateAddress.includes(keyword)
      ) || soloTypes.some((type) => candidateTypes.includes(type));

    return soloMatch ? 1.0 : 0.3;
  }

  // Couple activities (groupSize = 2)
  if (groupSize === 2) {
    const coupleKeywords = [
      "romantic",
      "intimate",
      "cozy",
      "date",
      "couple",
      "dinner",
      "wine",
      "rooftop",
      "lounge",
      "candlelit",
    ];
    const coupleTypes = [
      "restaurant",
      "bar",
      "lounge",
      "wine_bar",
      "rooftop_bar",
      "romantic_spot",
    ];

    const coupleMatch =
      coupleKeywords.some(
        (keyword) =>
          candidateName.includes(keyword) || candidateAddress.includes(keyword)
      ) || coupleTypes.some((type) => candidateTypes.includes(type));

    return coupleMatch ? 1.0 : 0.5;
  }

  // Small group activities (3-6 people)
  if (groupSize >= 3 && groupSize <= 6) {
    const smallGroupKeywords = [
      "karaoke",
      "escape",
      "trivia",
      "game",
      "arcade",
      "bowling",
      "mini_golf",
      "group",
      "team",
      "social",
    ];
    const smallGroupTypes = [
      "entertainment",
      "recreation",
      "game_center",
      "bowling_alley",
      "karaoke_bar",
      "arcade",
    ];

    const smallGroupMatch =
      smallGroupKeywords.some(
        (keyword) =>
          candidateName.includes(keyword) || candidateAddress.includes(keyword)
      ) || smallGroupTypes.some((type) => candidateTypes.includes(type));

    return smallGroupMatch ? 1.0 : 0.6;
  }

  // Large group activities (7+ people)
  if (groupSize >= 7) {
    const largeGroupKeywords = [
      "brewery",
      "festival",
      "event",
      "venue",
      "hall",
      "convention",
      "party",
      "celebration",
      "group_friendly",
    ];
    const largeGroupTypes = [
      "brewery",
      "event_venue",
      "convention_center",
      "festival_grounds",
      "large_venue",
      "group_venue",
    ];

    const largeGroupMatch =
      largeGroupKeywords.some(
        (keyword) =>
          candidateName.includes(keyword) || candidateAddress.includes(keyword)
      ) || largeGroupTypes.some((type) => candidateTypes.includes(type));

    return largeGroupMatch ? 1.0 : 0.4;
  }

  return 0.5; // Default score
}

// Enhanced Experience Type Badge System
function calculateExperienceTypeBadges(candidate: any): {
  badges: string[];
  reasonCodes: Record<string, string>;
} {
  const badges: string[] = [];
  const reasonCodes: Record<string, string> = {};

  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || "").toLowerCase();

  // Check each experience type
  for (const [type, rules] of Object.entries(EXPERIENCE_TYPE_RULES)) {
    const score = calculateExperienceTypeScore(candidate, type);
    const hasRequired = checkRequiredAttributes(candidate, rules.required);
    const hasForbidden = checkForbiddenAttributes(candidate, rules.forbidden);

    if (score >= rules.min_score && hasRequired && !hasForbidden) {
      badges.push(type);
      reasonCodes[type] = generateReasonCode(candidate, type, score);
    }
  }

  return { badges, reasonCodes };
}

function calculateExperienceTypeScore(candidate: any, type: string): number {
  const scoring = EXPERIENCE_TYPE_SCORING[type];
  if (!scoring) return 0;

  let totalScore = 0;
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || "").toLowerCase();

  // Calculate weighted score based on features
  for (const [feature, weight] of Object.entries(scoring)) {
    const featureScore = calculateFeatureScore(candidate, feature, type);
    totalScore += featureScore * weight;
  }

  return Math.min(1.0, totalScore);
}

function calculateFeatureScore(
  candidate: any,
  feature: string,
  type: string
): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || "").toLowerCase();

  // Feature-specific scoring logic
  switch (feature) {
    case "ambience":
      return checkAmbienceFeatures(candidate, type);
    case "privacy":
      return checkPrivacyFeatures(candidate, type);
    case "conversation_friendly":
      return checkConversationFeatures(candidate);
    case "wifi":
      return checkWifiFeatures(candidate);
    case "capacity":
      return checkCapacityFeatures(candidate);
    case "safe":
      return checkSafetyFeatures(candidate);
    default:
      return 0.5; // Default score
  }
}

function checkAmbienceFeatures(candidate: any, type: string): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];

  if (type === "romantic") {
    const romanticKeywords = [
      "romantic",
      "intimate",
      "cozy",
      "candlelit",
      "scenic",
      "sunset",
      "rooftop",
      "wine",
    ];
    const romanticTypes = [
      "restaurant",
      "bar",
      "lounge",
      "wine_bar",
      "rooftop_bar",
    ];

    const keywordMatch = romanticKeywords.some((keyword) =>
      candidateName.includes(keyword)
    );
    const typeMatch = romanticTypes.some((type) =>
      candidateTypes.includes(type)
    );

    return (keywordMatch ? 0.7 : 0.3) + (typeMatch ? 0.3 : 0);
  }

  return 0.5;
}

function checkPrivacyFeatures(candidate: any, type: string): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];

  if (type === "romantic") {
    const intimateKeywords = [
      "booth",
      "private",
      "intimate",
      "corner",
      "quiet",
    ];
    const intimateTypes = ["restaurant", "lounge", "wine_bar"];

    const keywordMatch = intimateKeywords.some((keyword) =>
      candidateName.includes(keyword)
    );
    const typeMatch = intimateTypes.some((type) =>
      candidateTypes.includes(type)
    );

    return (keywordMatch ? 0.8 : 0.4) + (typeMatch ? 0.2 : 0);
  }

  return 0.5;
}

function checkConversationFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];

  const conversationKeywords = [
    "quiet",
    "cozy",
    "intimate",
    "conversation",
    "table",
  ];
  const conversationTypes = ["restaurant", "cafe", "lounge", "bar"];

  const keywordMatch = conversationKeywords.some((keyword) =>
    candidateName.includes(keyword)
  );
  const typeMatch = conversationTypes.some((type) =>
    candidateTypes.includes(type)
  );

  return (keywordMatch ? 0.7 : 0.3) + (typeMatch ? 0.3 : 0);
}

function checkWifiFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];

  const wifiKeywords = ["wifi", "internet", "coworking", "laptop", "work"];
  const wifiTypes = ["cafe", "restaurant", "coworking_space", "library"];

  const keywordMatch = wifiKeywords.some((keyword) =>
    candidateName.includes(keyword)
  );
  const typeMatch = wifiTypes.some((type) => candidateTypes.includes(type));

  return (keywordMatch ? 0.9 : 0.1) + (typeMatch ? 0.1 : 0);
}

function checkCapacityFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];

  const capacityKeywords = [
    "group",
    "party",
    "large",
    "venue",
    "hall",
    "space",
  ];
  const capacityTypes = [
    "entertainment",
    "recreation",
    "event_venue",
    "convention_center",
  ];

  const keywordMatch = capacityKeywords.some((keyword) =>
    candidateName.includes(keyword)
  );
  const typeMatch = capacityTypes.some((type) => candidateTypes.includes(type));

  return (keywordMatch ? 0.8 : 0.2) + (typeMatch ? 0.2 : 0);
}

function checkSafetyFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];

  const safeKeywords = ["safe", "secure", "well_lit", "public", "monitored"];
  const safeTypes = ["museum", "library", "park", "gallery", "cafe"];

  const keywordMatch = safeKeywords.some((keyword) =>
    candidateName.includes(keyword)
  );
  const typeMatch = safeTypes.some((type) => candidateTypes.includes(type));

  return (keywordMatch ? 0.8 : 0.2) + (typeMatch ? 0.2 : 0);
}

function checkRequiredAttributes(candidate: any, required: string[]): boolean {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || "").toLowerCase();

  return required.some((attr) => {
    const attrKeywords = getAttributeKeywords(attr);
    return attrKeywords.some(
      (keyword) =>
        candidateName.includes(keyword) ||
        candidateAddress.includes(keyword) ||
        candidateTypes.some((type) => type.includes(keyword))
    );
  });
}

function checkForbiddenAttributes(
  candidate: any,
  forbidden: string[]
): boolean {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || "").toLowerCase();

  return forbidden.some((attr) => {
    const attrKeywords = getAttributeKeywords(attr);
    return attrKeywords.some(
      (keyword) =>
        candidateName.includes(keyword) ||
        candidateAddress.includes(keyword) ||
        candidateTypes.some((type) => type.includes(keyword))
    );
  });
}

function getAttributeKeywords(attribute: string): string[] {
  const attributeMap: Record<string, string[]> = {
    romantic_ambience: ["romantic", "intimate", "cozy", "candlelit"],
    intimate_seating: ["booth", "corner", "private", "intimate"],
    scenic_view: ["view", "scenic", "sunset", "rooftop", "terrace"],
    candlelight: ["candle", "candlelit", "dim", "soft"],
    date_spot: ["date", "romantic", "couple"],
    conversation_friendly: ["quiet", "cozy", "intimate", "table"],
    comfortable_seating: ["comfortable", "seating", "chair", "booth"],
    moderate_noise: ["quiet", "moderate", "calm"],
    easy_parking: ["parking", "valet", "street"],
    wifi: ["wifi", "internet", "wireless"],
    quiet: ["quiet", "silent", "peaceful"],
    reservation_possible: ["reservation", "booking", "reserve"],
    work_friendly: ["work", "laptop", "business", "meeting"],
    professional_setting: ["professional", "business", "corporate"],
    team_based: ["team", "group", "multiplayer", "collaborative"],
    capacity_group_friendly: ["group", "party", "large", "venue"],
    multiplayer: ["multiplayer", "multi", "group", "team"],
    group_activity: ["group", "team", "social", "activity"],
    social: ["social", "party", "group", "community"],
    safe_solo: ["safe", "secure", "public", "monitored"],
    individual_activity: ["individual", "solo", "personal", "self"],
    self_guided: ["self", "guided", "tour", "walk"],
    solo_friendly: ["solo", "individual", "personal"],
    casual: ["casual", "relaxed", "informal", "easy"],
    budget_friendly: ["budget", "affordable", "cheap", "inexpensive"],
    easy_meetup: ["easy", "meetup", "accessible", "convenient"],
  };

  return attributeMap[attribute] || [attribute];
}

function generateReasonCode(
  candidate: any,
  type: string,
  score: number
): string {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || "").toLowerCase();

  const reasons: string[] = [];

  // Generate specific reason codes based on type and features
  switch (type) {
    case "romantic":
      if (
        candidateName.includes("candle") ||
        candidateName.includes("candlelit")
      ) {
        reasons.push("candlelit atmosphere");
      }
      if (candidateName.includes("rooftop") || candidateName.includes("view")) {
        reasons.push("scenic view");
      }
      if (
        candidateTypes.includes("restaurant") ||
        candidateTypes.includes("wine_bar")
      ) {
        reasons.push("intimate dining");
      }
      if (
        candidateName.includes("booth") ||
        candidateName.includes("private")
      ) {
        reasons.push("private seating");
      }
      break;

    case "first_date":
      if (candidateName.includes("quiet") || candidateName.includes("cozy")) {
        reasons.push("quiet conversation-friendly");
      }
      if (candidate.rating && candidate.rating >= 4.0) {
        reasons.push("highly rated");
      }
      if (
        candidateName.includes("parking") ||
        candidateAddress.includes("parking")
      ) {
        reasons.push("easy parking");
      }
      break;

    case "business":
      if (
        candidateName.includes("wifi") ||
        candidateName.includes("internet")
      ) {
        reasons.push("Wi-Fi available");
      }
      if (
        candidateName.includes("quiet") ||
        candidateName.includes("private")
      ) {
        reasons.push("quiet professional setting");
      }
      if (
        candidateName.includes("meeting") ||
        candidateName.includes("conference")
      ) {
        reasons.push("meeting space");
      }
      break;

    case "group_fun":
      if (
        candidateName.includes("bowling") ||
        candidateName.includes("arcade")
      ) {
        reasons.push("multiplayer activities");
      }
      if (
        candidateName.includes("karaoke") ||
        candidateName.includes("trivia")
      ) {
        reasons.push("group entertainment");
      }
      if (
        candidateName.includes("party") ||
        candidateName.includes("celebration")
      ) {
        reasons.push("celebratory vibe");
      }
      break;

    case "solo_adventure":
      if (
        candidateTypes.includes("museum") ||
        candidateTypes.includes("gallery")
      ) {
        reasons.push("self-paced exploration");
      }
      if (candidateName.includes("trail") || candidateName.includes("hiking")) {
        reasons.push("safe solo activity");
      }
      if (
        candidateName.includes("library") ||
        candidateName.includes("quiet")
      ) {
        reasons.push("introspective space");
      }
      break;

    case "friendly":
      if (
        candidateName.includes("casual") ||
        candidateName.includes("relaxed")
      ) {
        reasons.push("casual atmosphere");
      }
      if (candidate.rating && candidate.rating >= 4.0) {
        reasons.push("highly rated");
      }
      if (
        candidateName.includes("budget") ||
        candidateName.includes("affordable")
      ) {
        reasons.push("budget-friendly");
      }
      break;
  }

  return reasons.length > 0 ? reasons.join(", ") : `${type} suitable venue`;
}

function filterByConstraints(
  candidates: any[],
  preferences: RecommendationsRequest
): any[] {
  console.log(
    "🔍 Starting advanced filtering with",
    candidates.length,
    "candidates"
  );

  return candidates.filter((candidate) => {
    // 1. STRICT CATEGORY FILTER - Must match expected activities
    if (!matchesCategoryActivities(candidate, preferences.categories)) {
      console.log(
        `❌ Category mismatch: ${candidate.name} (${candidate.category})`
      );
      return false;
    }

    // 2. EXPERIENCE TYPE HARD FILTERS
    if (preferences.experienceTypes?.length) {
      if (!matchesExperienceTypes(candidate, preferences.experienceTypes)) {
        console.log(`❌ Experience type mismatch: ${candidate.name}`);
        return false;
      }
    }

    // 3. Travel constraint filter
    if (candidate.travel) {
      if (preferences.travel.constraint.type === "TIME") {
        const maxMinutes = preferences.travel.constraint.maxMinutes || 30;
        if (candidate.travel.durationMinutes > maxMinutes) return false;
      }
    }

    // 4. Enhanced Budget Filter with Group Size Scaling
    const budget = preferences.budget;
    let estimatedCost = 0;

    if (candidate.source === "google_places") {
      // Enhanced Google Maps price level mapping
      const priceLevelMapping = {
        1: { min: 10, max: 25, avg: 17 }, // $ = Budget
        2: { min: 25, max: 50, avg: 37 }, // $$ = Moderate
        3: { min: 50, max: 100, avg: 75 }, // $$$ = Expensive
        4: { min: 100, max: 200, avg: 150 }, // $$$$ = Very Expensive
      };

      const priceLevel = candidate.priceLevel || 2;
      const priceInfo = priceLevelMapping[priceLevel] || priceLevelMapping[2];
      estimatedCost = priceInfo.avg;

      // Store price range for better filtering
      candidate.priceRange = [priceInfo.min, priceInfo.max];
    } else if (candidate.source === "eventbrite") {
      // Enhanced Eventbrite price handling
      if (candidate.price) {
        estimatedCost = candidate.price;
      } else if (candidate.priceRange) {
        estimatedCost =
          (candidate.priceRange.min + candidate.priceRange.max) / 2;
      } else {
        estimatedCost = 30; // Default fallback
      }
    }

    const perPersonCost = budget.perPerson ? estimatedCost : estimatedCost / 2;

    // Group size scaling for total budget consideration
    const groupSize = preferences.groupSize || 2;
    const totalCost = perPersonCost * groupSize;

    // Enhanced budget filtering with fallback logic
    if (perPersonCost < budget.min || perPersonCost > budget.max) {
      // Check if we can expand the range slightly (±15%)
      const expandedMin = budget.min * 0.85;
      const expandedMax = budget.max * 1.15;

      if (perPersonCost < expandedMin || perPersonCost > expandedMax) {
        return false;
      }

      // Mark as near-miss for graceful handling
      candidate.budgetNearMiss = {
        originalRange: [budget.min, budget.max],
        actualCost: perPersonCost,
        expansion: true,
      };
    }

    candidate.estimatedCost = Math.round(perPersonCost);
    return true;
  });
}

function matchesCategoryActivities(
  candidate: any,
  selectedCategories: string[]
): boolean {
  for (const category of selectedCategories) {
    if (candidate.category !== category) continue;

    if (!resolveCategory(category)) continue;

    // For freestyle, allow everything
    if (category === "freestyle") return true;

    // Check if place name or description contains expected activities
    const candidateName = candidate.name.toLowerCase();
    const candidateDesc = (candidate.description || "").toLowerCase();
    const candidateTypes = candidate.placeTypes || [];

    const keywords = getCategoryKeywords(category);
    const placeTypes = getPlaceTypesForCategory(category);

    // Must match at least one expected activity keyword or place type
    const hasMatchingKeyword = keywords.some(
      (keyword) =>
        candidateName.includes(keyword.toLowerCase()) ||
        candidateDesc.includes(keyword.toLowerCase())
    );

    const hasMatchingPlaceType = placeTypes.some((placeType) =>
      candidateTypes.includes(placeType)
    );

    if (hasMatchingKeyword || hasMatchingPlaceType) return true;
  }

  return false;
}

function matchesExperienceTypes(
  candidate: any,
  experienceTypes: string[]
): boolean {
  for (const expType of experienceTypes) {
    const rules = EXPERIENCE_TYPE_RULES[expType];
    if (!rules) continue;

    const candidateName = candidate.name.toLowerCase();
    const candidateDesc = (candidate.description || "").toLowerCase();
    const candidateTypes = candidate.placeTypes || [];

    // Check forbidden attributes
    const hasForbidden = rules.forbidden.some(
      (attr) =>
        candidateName.includes(attr) ||
        candidateDesc.includes(attr) ||
        candidateTypes.some((type) => type.includes(attr))
    );

    if (hasForbidden) return false;

    // For business/romantic/etc, check if has required attributes
    if (rules.required.length > 0) {
      const hasRequired = rules.required.some(
        (attr) =>
          candidateName.includes(attr) ||
          candidateDesc.includes(attr) ||
          candidateTypes.some((type) => type.includes(attr)) ||
          // Special business logic
          (expType === "business" &&
            (candidateTypes.includes("cafe") ||
              candidateTypes.includes("library") ||
              candidateName.includes("hotel") ||
              candidateName.includes("co-working") ||
              candidateName.includes("quiet"))) ||
          // Special romantic logic
          (expType === "romantic" &&
            (candidateTypes.includes("restaurant") ||
              candidateTypes.includes("bar") ||
              candidateName.includes("rooftop") ||
              candidateName.includes("intimate") ||
              candidate.priceLevel >= 3))
      );

      if (!hasRequired) return false;
    }
  }

  return true;
}

function scoreAndRank(
  candidates: any[],
  preferences: RecommendationsRequest
): any[] {
  console.log(
    "📈 Starting advanced scoring for",
    candidates.length,
    "candidates"
  );

  // Category keywords now sourced from canonical _shared/categoryPlaceTypes.ts
  // getCategoryKeywords() handles both slug and display-name formats via resolveCategory()

  candidates.forEach((candidate) => {
    let score = 0;
    const candidateName = candidate.name.toLowerCase();
    const candidateAddress = (candidate.address || "").toLowerCase();
    const candidateTypes = candidate.placeTypes || [];

    // 1. CATEGORY MATCH (3.0 weight)
    const categoryMatch = preferences.categories.includes(candidate.category)
      ? 1
      : 0;
    score += 3.0 * categoryMatch;

    // 2. EXPERIENCE TYPE BADGE MATCH (2.5 weight) - Enhanced badge system
    let experienceMatch = 0;
    if (preferences.experienceTypes?.length) {
      // Calculate badges for this candidate
      const { badges, reasonCodes } = calculateExperienceTypeBadges(candidate);
      candidate.badges = badges;
      candidate.reasonCodes = reasonCodes;

      // Check if any of the user's preferred experience types match the candidate's badges
      experienceMatch = preferences.experienceTypes.some((expType) =>
        badges.includes(expType.toLowerCase())
      )
        ? 1
        : 0;

      // Bonus for multiple matching badges
      const matchingBadges = preferences.experienceTypes.filter((expType) =>
        badges.includes(expType.toLowerCase())
      ).length;
      if (matchingBadges > 1) {
        experienceMatch += 0.2; // Bonus for multiple badge matches
      }
    }
    score += 2.5 * experienceMatch;

    // 3. TAG OVERLAP (1.6 weight) - using name/address text matching
    const keywords = getCategoryKeywords(candidate.category);
    const tagOverlap =
      keywords.filter(
        (keyword) =>
          candidateName.includes(keyword) ||
          candidateAddress.includes(keyword) ||
          candidateTypes.some((type) =>
            type.includes(keyword.replace(" ", "_"))
          )
      ).length / Math.max(keywords.length, 1);
    score += 1.6 * tagOverlap;

    // 4. EMBEDDING SIMILARITY (1.3 weight) - approximate with text matching
    const queryTerms = [
      ...preferences.categories,
      ...(preferences.experienceTypes || []),
    ];
    const textSimilarity =
      queryTerms.filter(
        (term) =>
          candidateName.includes(term) || candidateAddress.includes(term)
      ).length / Math.max(queryTerms.length, 1);
    score += 1.3 * textSimilarity;

    // 5. POPULARITY (0.6 weight) - using rating and review count
    let popularity = 0;
    if (candidate.rating && candidate.reviewCount) {
      // Normalize: rating (0-1) * log of reviews (0-1)
      const ratingScore = candidate.rating / 5.0;
      const reviewScore = Math.min(
        Math.log10(candidate.reviewCount + 1) / 4,
        1
      );
      popularity = (ratingScore + reviewScore) / 2;
    }
    score += 0.6 * popularity;

    // 6. GROUP SIZE MATCH (1.2 weight) - venue suitability for group size
    let groupSizeScore = 0;
    if (preferences.groupSize) {
      groupSizeScore = calculateGroupSizeScore(
        candidate,
        preferences.groupSize
      );
    }
    score += 1.2 * groupSizeScore;

    // 7. QUALITY (0.4 weight) - data completeness
    let quality = 0;
    const hasImage = candidate.imageUrl ? 0.25 : 0;
    const hasRating = candidate.rating ? 0.25 : 0;
    const hasPrice = candidate.priceLevel ? 0.25 : 0;
    const hasHours = candidate.openingHours ? 0.25 : 0;
    quality = hasImage + hasRating + hasPrice + hasHours;
    score += 0.4 * quality;

    // 7. DISTANCE PENALTY (-0.3 weight per km beyond 5km)
    let distancePenalty = 0;
    if (candidate.travel?.distanceText) {
      const distanceMatch =
        candidate.travel.distanceText.match(/(\d+\.?\d*)\s*km/);
      if (distanceMatch) {
        const distanceKm = parseFloat(distanceMatch[1]);
        if (distanceKm > 5) {
          distancePenalty = (distanceKm - 5) * 0.3;
        }
        candidate.distanceKm = distanceKm; // Store for output
      }
    }
    score -= distancePenalty;

    // 8. FRESHNESS (0.2 weight) - approximate with rating recency
    const freshness =
      candidate.reviewCount && candidate.reviewCount > 50 ? 0.8 : 0.3;
    score += 0.2 * freshness;

    // CATEGORY BOOSTS
    if (candidate.category === "play_move") {
      const playMoveBoosts = [
        "bowling",
        "climbing",
        "dance",
        "skating",
        "kayak",
        "hike",
        "pickleball",
        "arcade",
        "trampoline",
        "mini golf",
        "go kart",
        "axe throwing",
        "laser tag",
        "escape room",
        "basketball",
        "tennis",
        "badminton",
      ];
      const hasBoost = playMoveBoosts.some(
        (activity) =>
          candidateName.includes(activity) ||
          candidateTypes.some((type) => type.includes(activity))
      );
      if (hasBoost) score += 0.7;
    }

    if (candidate.category === "dining") {
      const diningBoosts = [
        "tasting menu",
        "prix fixe",
        "chef counter",
        "omakase",
        "wine pairing",
        "tasting",
        "chef",
        "fine dining",
      ];
      const hasBoost = diningBoosts.some(
        (activity) =>
          candidateName.includes(activity) ||
          candidateAddress.includes(activity)
      );
      if (hasBoost) score += 0.7;
    }

    // Store scoring details for debugging
    candidate.score = score;
    candidate.scoreBreakdown = {
      categoryMatch: 3.0 * categoryMatch,
      experienceMatch: 2.0 * experienceMatch,
      tagOverlap: 1.6 * tagOverlap,
      textSimilarity: 1.3 * textSimilarity,
      popularity: 0.6 * popularity,
      quality: 0.4 * quality,
      distancePenalty: -distancePenalty,
      freshness: 0.2 * freshness,
    };
  });

  // Sort by score descending
  const sortedCandidates = candidates.sort(
    (a, b) => (b.score || 0) - (a.score || 0)
  );

  console.log(
    "🏆 Top 5 scored candidates:",
    sortedCandidates.slice(0, 5).map((c) => ({
      name: c.name,
      category: c.category,
      score: c.score?.toFixed(2),
      breakdown: c.scoreBreakdown,
    }))
  );

  return sortedCandidates;
}

function matchesExperienceTypeForScoring(
  candidate: any,
  expType: string
): boolean {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];

  switch (expType) {
    case "business":
      return (
        candidateTypes.includes("cafe") ||
        candidateTypes.includes("library") ||
        candidateName.includes("hotel") ||
        candidateName.includes("co-working") ||
        candidateName.includes("quiet")
      );

    case "romantic":
      return (
        candidateTypes.includes("restaurant") ||
        candidateTypes.includes("bar") ||
        candidateName.includes("rooftop") ||
        candidateName.includes("intimate") ||
        (candidate.priceLevel && candidate.priceLevel >= 3)
      );

    case "group_fun":
      return (
        candidateName.includes("bowling") ||
        candidateName.includes("arcade") ||
        candidateName.includes("karaoke") ||
        candidateName.includes("escape") ||
        candidateTypes.includes("amusement_park")
      );

    case "solo_adventure":
      return (
        candidateTypes.includes("museum") ||
        candidateTypes.includes("art_gallery") ||
        candidateTypes.includes("park") ||
        candidateName.includes("solo") ||
        candidateName.includes("self-guided")
      );

    case "first_date":
      return (
        candidateTypes.includes("cafe") ||
        candidateTypes.includes("restaurant") ||
        (candidateName.includes("quiet") && !candidateName.includes("loud"))
      );

    case "friendly":
      return (
        !candidateName.includes("members only") &&
        !candidateName.includes("exclusive") &&
        !candidateTypes.includes("night_club")
      );

    default:
      return false;
  }
}

function applyDiversity(
  candidates: any[],
  selectedCategories: string[]
): any[] {
  console.log(
    "🎯 Applying Maximal Marginal Relevance diversity to top candidates"
  );

  // Take top 40 for diversity processing
  const topCandidates = candidates.slice(0, 40);
  const diversified: any[] = [];
  const lambda = 0.75; // MMR parameter

  // Track diversity factors
  const categoryCount: Record<string, number> = {};
  const priceCount: Record<number, number> = {};
  const subCategoryCount: Record<string, number> = {};

  // Initialize counters
  selectedCategories.forEach((cat) => (categoryCount[cat] = 0));

  // Add first item (highest scoring)
  if (topCandidates.length > 0) {
    const first = topCandidates[0];
    diversified.push(first);
    updateDiversityCounters(first, categoryCount, priceCount, subCategoryCount);
  }

  // MMR selection for remaining items
  for (let i = 1; i < topCandidates.length && diversified.length < 20; i++) {
    let bestCandidate = null;
    let bestMMRScore = -Infinity;

    for (const candidate of topCandidates) {
      if (diversified.includes(candidate)) continue;

      // Relevance score (normalized to 0-1)
      const relevanceScore =
        (candidate.score || 0) / Math.max(topCandidates[0].score || 1, 1);

      // Diversity score - penalize similar items
      let diversityScore = 1.0;

      // Category diversity penalty
      const categoryPenalty = categoryCount[candidate.category] || 0;
      diversityScore *= Math.exp(-0.5 * categoryPenalty);

      // Price tier diversity penalty
      const pricePenalty = priceCount[candidate.priceLevel || 1] || 0;
      diversityScore *= Math.exp(-0.3 * pricePenalty);

      // Sub-category diversity penalty
      const subCategory = getSubCategory(candidate);
      const subCategoryPenalty = subCategoryCount[subCategory] || 0;
      diversityScore *= Math.exp(-0.4 * subCategoryPenalty);

      // MMR score: λ * relevance + (1-λ) * diversity
      const mmrScore = lambda * relevanceScore + (1 - lambda) * diversityScore;

      if (mmrScore > bestMMRScore) {
        bestMMRScore = mmrScore;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      diversified.push(bestCandidate);
      updateDiversityCounters(
        bestCandidate,
        categoryCount,
        priceCount,
        subCategoryCount
      );
    }
  }

  console.log("🎨 Diversity applied:", {
    original: topCandidates.length,
    diversified: diversified.length,
    categorySpread: Object.keys(categoryCount)
      .map((cat) => `${cat}: ${categoryCount[cat]}`)
      .join(", "),
  });

  return diversified;
}

function updateDiversityCounters(
  candidate: any,
  categoryCount: Record<string, number>,
  priceCount: Record<number, number>,
  subCategoryCount: Record<string, number>
): void {
  categoryCount[candidate.category] =
    (categoryCount[candidate.category] || 0) + 1;
  priceCount[candidate.priceLevel || 1] =
    (priceCount[candidate.priceLevel || 1] || 0) + 1;

  const subCategory = getSubCategory(candidate);
  subCategoryCount[subCategory] = (subCategoryCount[subCategory] || 0) + 1;
}

function getSubCategory(candidate: any): string {
  const name = candidate.name.toLowerCase();
  const types = candidate.placeTypes || [];

  // Determine sub-category for better diversity
  if (candidate.category === "play_move") {
    if (name.includes("bowling") || types.includes("bowling_alley"))
      return "bowling";
    if (name.includes("climb") || types.includes("climbing_gym"))
      return "climbing";
    if (name.includes("golf") || types.includes("golf_course")) return "golf";
    if (name.includes("gym") || types.includes("gym")) return "gym";
    return "other_activity";
  }

  if (candidate.category === "dining") {
    if (types.includes("fine_dining_restaurant")) return "fine_dining";
    if (name.includes("steakhouse") || types.includes("steakhouse"))
      return "steakhouse";
    if (name.includes("sushi") || types.includes("sushi_restaurant"))
      return "sushi";
    return "other_dining";
  }

  if (candidate.category === "sip") {
    if (name.includes("coffee") || types.includes("coffee_shop"))
      return "coffee";
    if (name.includes("wine") || types.includes("wine_bar")) return "wine";
    if (name.includes("brewery") || types.includes("brewery")) return "brewery";
    return "other_drink";
  }

  return candidate.category;
}

async function enrichWithLLM(
  candidates: any[],
  preferences: RecommendationsRequest
): Promise<void> {
  if (!OPENAI_API_KEY) return;

  const budget = 0.02; // $0.02 cap per request
  const timeout = 4000; // 4 second timeout

  const enrichPromises = candidates.slice(0, 10).map(async (candidate) => {
    const cacheKey = `${candidate.id}_${JSON.stringify(
      preferences.categories
    )}_${preferences.budget.min}_${preferences.budget.max}`;

    // Check cache first
    const cached = llmCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      candidate.copy = { oneLiner: cached.oneLiner, tip: cached.tip };
      return;
    }

    try {
      const prompt = `Generate personalized, engaging copy for this ${
        candidate.source === "eventbrite" ? "event" : "place"
      }:

Name: ${candidate.name}
Category: ${candidate.category}
Location: ${candidate.address}
${candidate.rating ? `Rating: ${candidate.rating}/5` : ""}
${candidate.estimatedCost ? `Cost: $${candidate.estimatedCost}` : ""}
${candidate.source === "eventbrite" ? `Event Time: ${candidate.startTime}` : ""}

User preferences: ${preferences.categories.join(", ")}, Budget: $${
        preferences.budget.min
      }-${preferences.budget.max}

Respond with JSON only:
{
  "oneLiner": "personalized description that speaks directly to the user (max 14 words)",
  "tip": "specific, actionable tip tailored to this place and user preferences (max 18 words)"
}

Guidelines:
- Write as if speaking directly to the user
- Use "you" and "your" to make it personal
- Reference the specific place name and location
- No hallucinated facts about hours, prices, or availability
- No promises about what will be available
- Focus on atmosphere, experience, and why this place is perfect for them
- Be concise and compelling`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0.7,
          }),
        }
      );

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0].message.content;

        try {
          const parsed = JSON.parse(content);
          candidate.copy = {
            oneLiner: parsed.oneLiner || `Great ${candidate.category} spot`,
            tip: parsed.tip || "Check ahead for current hours",
          };

          // Cache the result for 7 days
          llmCache.set(cacheKey, {
            oneLiner: candidate.copy.oneLiner,
            tip: candidate.copy.tip,
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
          });
        } catch {
          // Fallback if JSON parsing fails
          addFallbackCopyForCandidate(candidate);
        }
      } else {
        addFallbackCopyForCandidate(candidate);
      }
    } catch (error) {
      console.error("LLM enrichment error for candidate:", candidate.id, error);
      addFallbackCopyForCandidate(candidate);
    }
  });

  await Promise.all(enrichPromises);
}

function addFallbackCopy(candidates: any[]): void {
  candidates.forEach(addFallbackCopyForCandidate);
}

function addFallbackCopyForCandidate(candidate: any): void {
  const categoryDescriptions: Record<
    string,
    { oneLiner: string; tip: string }
  > = {
    'Nature': {
      oneLiner: "Perfect spot for your leisurely walk",
      tip: "You'll love the golden hour views here",
    },
    'First Meet': {
      oneLiner: "Great spot for meeting someone new",
      tip: "Relaxed vibes make conversation easy",
    },
    'Picnic': {
      oneLiner: "Beautiful outdoor spot for your picnic",
      tip: "Pack some snacks and enjoy the scenery",
    },
    'Drink': {
      oneLiner: "Cozy atmosphere you'll enjoy for drinks",
      tip: "Ask about their happy hour specials",
    },
    'Casual Eats': {
      oneLiner: "Delicious casual dining you'll love",
      tip: "Don't miss their most popular dish",
    },
    'Fine Dining': {
      oneLiner: "Memorable dining experience awaits you",
      tip: "Reserve ahead for your special evening",
    },
    'Watch': {
      oneLiner: "Perfect place for you to unwind",
      tip: "Book ahead to secure your spot",
    },
    'Creative & Arts': {
      oneLiner: "Inspiring creative space you'll adore",
      tip: "Perfect match for your artistic side",
    },
    'Play': {
      oneLiner: "Active fun that's perfect for you",
      tip: "Wear comfortable clothes for best experience",
    },
    'Wellness': {
      oneLiner: "Rejuvenating wellness experience awaits",
      tip: "Arrive early to fully enjoy the session",
    },
    'Groceries & Flowers': {
      oneLiner: "Quality finds for your everyday needs",
      tip: "Check their seasonal specials",
    },
    'Work & Business': {
      oneLiner: "Professional space for productive meetings",
      tip: "Great wifi and quiet atmosphere",
    },
  };

  const defaults = categoryDescriptions[candidate.category] || {
    oneLiner: "Amazing local destination perfect for you",
    tip: "Handpicked to match your style and preferences",
  };

  candidate.copy = defaults;
}

async function convertToCards(
  candidates: any[],
  preferences: RecommendationsRequest
): Promise<any[]> {
  return candidates.map((candidate) => {
    const travelMode = preferences.travel.mode;
    const mapsMode =
      travelMode === "WALKING"
        ? "walking"
        : travelMode === "TRANSIT"
        ? "transit"
        : "driving";

    const mapsDeepLink = `https://www.google.com/maps/dir/?api=1&origin=${preferences.origin.lat},${preferences.origin.lng}&destination=${candidate.location.lat},${candidate.location.lng}&travelmode=${mapsMode}`;

    // Generate subtitle
    const priceSymbols = ["$", "$$", "$$$", "$$$$", "$$$$$"];
    const priceDisplay = candidate.priceLevel
      ? priceSymbols[candidate.priceLevel - 1]
      : "$";
    const categoryName =
      candidate.category.charAt(0).toUpperCase() +
      candidate.category.slice(1).replace("_", " & ");
    const etaText = candidate.travel
      ? `${candidate.travel.durationMinutes} min ${mapsMode}`
      : "Route available";

    const subtitle = `${categoryName} · ${priceDisplay} · ${etaText}`;

    // Determine duration and start time
    let startTime = new Date().toISOString();
    let durationMinutes = 90; // Default duration

    if (candidate.source === "eventbrite") {
      startTime = candidate.startTime;
      if (candidate.endTime) {
        const start = new Date(candidate.startTime);
        const end = new Date(candidate.endTime);
        durationMinutes = Math.max(
          30,
          (end.getTime() - start.getTime()) / (1000 * 60)
        );
      }
    } else {
      // For places, set start time based on preferences
      if (preferences.timeWindow.timeOfDay) {
        const today = new Date();
        const [hours, minutes] = preferences.timeWindow.timeOfDay.split(":");
        today.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        startTime = today.toISOString();
      }
    }

    // Generate reason codes based on scoring factors
    const reasonCodes: string[] = [];

    if (preferences.categories.includes(candidate.category)) {
      reasonCodes.push(
        `Matches ${candidate.category.replace("_", " ")} category`
      );
    }

    if (candidate.rating && candidate.rating >= 4.0) {
      reasonCodes.push(`Highly rated (${candidate.rating}/5)`);
    }

    if (
      candidate.travel?.durationMinutes &&
      candidate.travel.durationMinutes <= 15
    ) {
      reasonCodes.push(`Close by (${candidate.travel.durationMinutes} min)`);
    }

    if (candidate.priceLevel && candidate.priceLevel <= 2) {
      reasonCodes.push("Budget-friendly");
    }

    return {
      id: candidate.id,
      title: candidate.name,
      subtitle,
      primary_category: candidate.category,
      distance_km: candidate.distanceKm || null,
      price_tier: candidate.priceLevel
        ? priceSymbols[candidate.priceLevel - 1]
        : null,
      reason_codes: reasonCodes,
      category: candidate.category,
      priceLevel: candidate.priceLevel || 1,
      estimatedCostPerPerson: candidate.estimatedCost || 25,
      startTime,
      durationMinutes: Math.round(durationMinutes),
      imageUrl: candidate.imageUrl || "/api/placeholder/400/225",
      address: candidate.address,
      location: candidate.location,
      route: {
        mode: travelMode,
        etaMinutes: candidate.travel?.durationMinutes || 15,
        distanceText: candidate.travel?.distanceText || "Distance available",
        mapsDeepLink,
      },
      source: {
        provider: candidate.source,
        placeId: candidate.placeId,
        eventId: candidate.eventId,
      },
      copy: candidate.copy || {
        oneLiner: `Perfect ${candidate.category.replace(
          "_",
          " "
        )} spot you'll love`,
        tip: `Handpicked for your preferences and budget`,
      },
      actions: {
        invite: true,
        save: true,
        share: true,
      },
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
      openingHours: candidate.openingHours,
    };
  });
}
