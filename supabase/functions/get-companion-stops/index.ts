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
    const companionStops = await findCompanionStops(anchor.location, maxDistance);

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
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Find companion stops (café/bakery/ice cream/food truck) near a stroll anchor
async function findCompanionStops(
  anchorLocation: { lat: number; lng: number },
  maxDistance: number = 500 // meters
): Promise<any[]> {
  const companionTypes = [
    "cafe",
    "coffee_shop",
    "bakery",
    "ice_cream_shop",
    "gelato_shop",
    "food_truck",
    "restaurant",
    "bistro",
    "bar",
    "wine_bar",
    "juice_bar",
    "smoothie_shop",
    "tea_house",
    "donut_shop",
    "pastry_shop",
    "deli",
    "sandwich_shop",
    "pizza_restaurant",
    "fast_food_restaurant",
    "meal_takeaway",
  ];

  const companionPromises = companionTypes.map(async (placeType) => {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${anchorLocation.lat},${anchorLocation.lng}&radius=${maxDistance}&type=${placeType}&key=${GOOGLE_API_KEY}`;

      const response = await fetch(url);
      if (!response.ok) return [];

      const data = await response.json();
      if (data.status === "OK" && data.results?.length) {
        return data.results.slice(0, 2).map((place: any) => ({
          id: place.place_id,
          name: place.name,
          location: {
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng,
          },
          address: place.vicinity || place.formatted_address,
          rating: place.rating,
          reviewCount: place.user_ratings_total || 0,
          imageUrl: place.photos?.[0]
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${place.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`
            : null,
          placeId: place.place_id,
          type: placeType,
        }));
      }
      return [];
    } catch (error) {
      console.error(`Error fetching companion stops for ${placeType}:`, error);
      return [];
    }
  });

  const results = await Promise.all(companionPromises);
  const allCompanions = results.flat();

  return allCompanions
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 1);
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
    title: "Start",
    location: companionStop,
    description: `Begin at ${companionStop.name}`,
    duration: 0,
  });

  const walkDuration = routeDuration - 5;
  timeline.push({
    step: 2,
    type: "walk",
    title: "Scenic Walk",
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
    title: "Wrap-Up",
    location: anchor,
    description: `End at ${anchor.name}`,
    duration: 0,
  });

  return timeline;
}

function calculateStrollRouteDuration(): number {
  return 30; // Solo: 25-35 minutes, average 30
}

