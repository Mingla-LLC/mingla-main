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
    const picnic = body?.picnic || body?.picnicLocation;
    const maxDistance = body?.maxDistance ?? 2000; // meters, default 2km for grocery stores

    // Handle both full picnic object and simple location object
    const picnicLocation = picnic?.location || picnic;

    if (!picnicLocation?.lat || !picnicLocation?.lng) {
      return new Response(
        JSON.stringify({
          error: "Picnic location is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!GOOGLE_API_KEY) {
      console.warn("⚠️ Google API key not available for picnic grocery search");
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

    // Find grocery stores and markets near the picnic location
    const groceryStore = await findGroceryStore(picnicLocation, maxDistance);

    if (!groceryStore) {
      return new Response(
        JSON.stringify({
          picnicData: null,
          message: "No grocery stores or markets found within range",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Normalize picnic object to have consistent structure
    const normalizedPicnic = picnic?.name
      ? picnic
      : {
          id: picnic?.id || "picnic-location",
          name: picnic?.name || picnic?.title || "Picnic Location",
          location: picnicLocation,
          address: picnic?.address || "",
        };

    const routeDuration = calculatePicnicRouteDuration();
    const timeline = buildPicnicRouteTimeline(
      groceryStore,
      normalizedPicnic,
      routeDuration
    );

    return new Response(
      JSON.stringify({
        picnicData: {
          picnic: normalizedPicnic,
          groceryStore,
          route: {
            duration: routeDuration,
            startLocation: groceryStore.location,
            endLocation: picnicLocation,
          },
          timeline,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in get-picnic-grocery:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Find grocery stores and markets near a picnic location
async function findGroceryStore(
  picnicLocation: { lat: number; lng: number },
  maxDistance: number = 2000 // meters
): Promise<any | null> {
  const groceryTypes = [
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
      includedTypes: groceryTypes,
      maxResultCount: 10,
      locationRestriction: {
        circle: {
          center: {
            latitude: picnicLocation.lat,
            longitude: picnicLocation.lng,
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
        "Error fetching grocery stores:",
        response.status,
        errorText
      );
      return null;
    }

    const data = await response.json();
    if (!data.places?.length) {
      return null;
    }

    // Filter and map places to grocery stores
    // When "store" type is used, filter to only include grocery-related stores
    const groceryRelatedKeywords = [
      "grocery",
      "supermarket",
      "market",
      "food",
      "convenience",
      "deli",
      "butcher",
      "bakery",
      "produce",
    ];

    const allGroceryStores = data.places
      .filter((place: any) => {
        // If place has explicit grocery types, include it
        const hasGroceryType = place.types?.some((type: string) =>
          [
            "grocery_store",
            "supermarket",
            "food_store",
            "convenience_store",
          ].includes(type)
        );
        if (hasGroceryType) return true;

        // If place only has "store" type, check if it's grocery-related
        const isOnlyStore =
          place.types?.includes("store") &&
          !place.types?.some((type: string) =>
            [
              "grocery_store",
              "supermarket",
              "food_store",
              "convenience_store",
            ].includes(type)
          );

        if (isOnlyStore) {
          // Check if name or types suggest it's a grocery store
          const name = (place.displayName?.text || "").toLowerCase();
          const typesString = (place.types || []).join(" ").toLowerCase();
          return groceryRelatedKeywords.some(
            (keyword) => name.includes(keyword) || typesString.includes(keyword)
          );
        }

        return true; // Include other explicitly requested types
      })
      .map((place: any) => {
        // Extract photo reference from new API format
        const primaryPhoto = place.photos?.[0];
        const imageUrl = primaryPhoto?.name
          ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=400&key=${GOOGLE_API_KEY}`
          : null;

        // Calculate distance from picnic location
        const distance = calculateDistance(
          picnicLocation.lat,
          picnicLocation.lng,
          place.location?.latitude || picnicLocation.lat,
          place.location?.longitude || picnicLocation.lng
        );

        // Determine the primary type from the place's types array
        const primaryType =
          place.types?.find((type: string) =>
            [
              "grocery_store",
              "supermarket",
              "food_store",
              "convenience_store",
            ].includes(type)
          ) ||
          place.types?.find((type: string) => groceryTypes.includes(type)) ||
          place.types?.[0] ||
          "grocery_store";

        return {
          id: place.id,
          name: place.displayName?.text || "Unknown Store",
          location: {
            lat: place.location?.latitude || picnicLocation.lat,
            lng: place.location?.longitude || picnicLocation.lng,
          },
          address: place.formattedAddress || "",
          rating: place.rating || 0,
          reviewCount: place.userRatingCount || 0,
          imageUrl: imageUrl,
          placeId: place.id,
          type: primaryType,
          types: place.types || [],
          distance: distance, // distance in meters
        };
      });

    if (allGroceryStores.length === 0) {
      return null;
    }

    // Sort by distance (closest first), then by rating
    const sortedStores = allGroceryStores.sort((a, b) => {
      // First prioritize by distance
      if (Math.abs(a.distance - b.distance) > 100) {
        // If distance difference is more than 100m, prefer closer one
        return a.distance - b.distance;
      }
      // If distances are similar, prefer higher rating
      return (b.rating || 0) - (a.rating || 0);
    });

    // Return the closest grocery store
    return sortedStores[0];
  } catch (error) {
    console.error("Error fetching grocery stores:", error);
    return null;
  }
}

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Build route timeline for picnic cards
function buildPicnicRouteTimeline(
  groceryStore: any,
  picnic: any,
  routeDuration: number
): any[] {
  const timeline: any[] = [];

  // Step 1: Grocery Stop (Start)
  timeline.push({
    step: 1,
    type: "start",
    title: "Grocery Stop",
    location: groceryStore,
    description: `Pick up picnic supplies at ${groceryStore.name}`,
    duration: 20, // 15-20 minutes for shopping
  });

  // Step 2: Travel to Picnic Location
  const travelDuration = Math.max(10, routeDuration - 95); // Travel time, minimum 10 minutes
  timeline.push({
    step: 2,
    type: "travel",
    title: "Travel to Picnic Spot",
    location: picnic,
    description: `Head to ${picnic.name || "your picnic location"}`,
    duration: travelDuration,
  });

  // Step 3: Main Picnic Activity
  timeline.push({
    step: 3,
    type: "activity",
    title: "Picnic",
    location: picnic,
    description: `Set up and enjoy your picnic at ${
      picnic.name || "the picnic spot"
    }`,
    duration: 60, // 1 hour for the main picnic experience
  });

  // Step 4: Wrap-Up
  timeline.push({
    step: 4,
    type: "wrap-up",
    title: "Wrap-Up",
    location: picnic,
    description: `Clean up and enjoy final views before leaving`,
    duration: 15, // 15 minutes for cleanup
  });

  return timeline;
}

function calculatePicnicRouteDuration(): number {
  // Total duration: 20 min shopping + travel + 60 min picnic + 15 min cleanup
  // Average travel time: 15-20 minutes
  // Total: ~110-115 minutes, rounded to 120 minutes (2 hours)
  return 120;
}
