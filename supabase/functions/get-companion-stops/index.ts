import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const anchor = body?.anchor;
    const maxDistance = body?.maxDistance ?? 500; // meters

    if (!anchor?.location?.lat || !anchor?.location?.lng) {
      return new Response(
        JSON.stringify({
          error: "Anchor location is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!GOOGLE_API_KEY) {
      console.warn("⚠️ Google API key not available for companion stops");
      return new Response(
        JSON.stringify({
          error: "Google Maps API key is not configured",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch companion stops in parallel and keep only the top result
    const companionStops = await findCompanionStops(
      anchor.location,
      maxDistance
    );

    if (!companionStops.length) {
      return new Response(
        JSON.stringify({
          strollData: null,
          message: "No companion stops found within range",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const companionStop = companionStops[0];
    const routeDuration = calculateStrollRouteDuration();
    const timeline = buildStrollRouteTimeline(
      companionStop,
      anchor,
      routeDuration
    );

    return new Response(
      JSON.stringify({
        strollData: {
          anchor,
          companionStops,
          route: {
            duration: routeDuration,
            startLocation: companionStop.location,
            endLocation: anchor.location,
          },
          timeline,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in get-companion-stops:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Find companion stops (café/bakery/ice cream/food truck) near a stroll anchor
async function findCompanionStops(
  anchorLocation: { lat: number; lng: number },
  maxDistance: number = 500 // meters
): Promise<any[]> {
  const companionTypes = [
    "supermarket",
    "food_store",
    "convenience_store",
    "store",
    "grocery_store",
    "meal_takeaway",
    "ice_cream_shop",
    "bakery",
    "deli",
  ];

  // Places API (New) base URL
  const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";

  // Field mask for Places API (New) - specify which fields we need
  const fieldMask =
    "places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.photos,places.types";

  try {
    const requestBody = {
      includedTypes: companionTypes,
      maxResultCount: 20, // Get more results since we're requesting all types at once
      locationRestriction: {
        circle: {
          center: {
            latitude: anchorLocation.lat,
            longitude: anchorLocation.lng,
          },
          radius: maxDistance,
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
        `Error fetching companion stops:`,
        response.status,
        errorText
      );
      return [];
    }

    const data = await response.json();
    if (!data.places?.length) {
      return [];
    }

    // Map places to our format
    const allCompanions = data.places.map((place: any) => {
      // Extract photo reference from new API format
      const primaryPhoto = place.photos?.[0];
      const imageUrl = primaryPhoto?.name
        ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=400&key=${GOOGLE_API_KEY}`
        : null;

      // Determine the type by matching place types with companion types
      const placeTypes = place.types || [];
      const matchedType =
        companionTypes.find((type) => placeTypes.includes(type)) ||
        companionTypes[0]; // Fallback to first type if no match

      return {
        id: place.id,
        name: place.displayName?.text || "Unknown Place",
        location: {
          lat: place.location?.latitude || anchorLocation.lat,
          lng: place.location?.longitude || anchorLocation.lng,
        },
        address: place.formattedAddress || "",
        rating: place.rating || 0,
        reviewCount: place.userRatingCount || 0,
        imageUrl: imageUrl,
        placeId: place.id, // In new API, place.id is the identifier
        type: matchedType,
      };
    });

    return allCompanions
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 1);
  } catch (error) {
    console.error(`Error fetching companion stops:`, error);
    return [];
  }
}

// Build route timeline for stroll cards (solo mode)
function buildStrollRouteTimeline(
  companionStop: any,
  anchor: any,
  routeDuration: number
): any[] {
  const timeline: any[] = [];

  timeline.push({
    step: 1,
    type: "start",
    title: "Arrival & Welcome",
    location: companionStop,
    description: `Begin at ${companionStop.name}`,
    duration: 0,
  });

  const walkDuration = routeDuration - 5;
  timeline.push({
    step: 2,
    type: "walk",
    title: "Main Activity",
    location: anchor,
    description: `Walk to ${anchor.name}`,
    duration: walkDuration,
  });

  if (routeDuration >= 30) {
    timeline.push({
      step: 3,
      type: "pause",
      title: "Pause & Enjoy",
      location: anchor,
      description: `Take a moment to enjoy ${anchor.name}`,
      duration: 5,
    });
  }

  timeline.push({
    step: timeline.length + 1,
    type: "wrap-up",
    title: "Closing Touch",
    location: anchor,
    description: `End at ${anchor.name}`,
    duration: 0,
  });

  return timeline;
}

function calculateStrollRouteDuration(): number {
  return 30; // Solo: 25-35 minutes, average 30
}
