import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORY_TYPE_MAP: Record<string, string[]> = {
  romantic: ["restaurant"],
  fine_dining: ["restaurant"],
  dining: ["restaurant"],
  play: ["amusement_park", "bowling_alley", "movie_theater"],
  entertainment: ["amusement_park", "bowling_alley", "movie_theater"],
  nature: ["park", "hiking_area", "campground"],
  outdoors: ["park", "hiking_area", "campground"],
  drink: ["bar", "night_club", "cafe"],
  nightlife: ["bar", "night_club", "cafe"],
  wellness: ["spa", "gym"],
  spa: ["spa", "gym"],
  watch: ["movie_theater", "performing_arts_theater", "museum"],
  arts: ["movie_theater", "performing_arts_theater", "museum"],
};

interface RequestBody {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
}

interface Card {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
}

function getIncludedTypes(slug: string): string[] {
  return CATEGORY_TYPE_MAP[slug] ?? ["restaurant"];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client for auth verification
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin client for cross-user reads
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parse & validate body ---
    const body: RequestBody = await req.json();
    const { personId, holidayKey, categorySlugs, location, linkedUserId } =
      body;

    if (!personId || !UUID_RE.test(personId)) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing personId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (!holidayKey || typeof holidayKey !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid or missing holidayKey" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (
      !Array.isArray(categorySlugs) ||
      categorySlugs.length === 0 ||
      categorySlugs.some((s) => typeof s !== "string")
    ) {
      return new Response(
        JSON.stringify({ error: "categorySlugs must be a non-empty string array" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (
      !location ||
      typeof location.latitude !== "number" ||
      typeof location.longitude !== "number"
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing location" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (linkedUserId && !UUID_RE.test(linkedUserId)) {
      return new Response(
        JSON.stringify({ error: "Invalid linkedUserId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Limit to 3 categories
    const slugs = categorySlugs.slice(0, 3);

    // --- Fetch linked user saved categories for boosting ---
    let linkedSavedCategorySet = new Set<string>();
    let linkedSavedCardIds = new Set<string>();

    if (linkedUserId) {
      const { data: savedCards } = await adminClient
        .from("saved_cards")
        .select("card_id, category")
        .eq("user_id", linkedUserId)
        .eq("status", "saved");

      if (savedCards && savedCards.length > 0) {
        for (const sc of savedCards) {
          if (sc.category) linkedSavedCategorySet.add(sc.category);
          if (sc.card_id) linkedSavedCardIds.add(sc.card_id);
        }
      }
    }

    // --- Query card_pool per category ---
    const DEGREE_OFFSET = 0.09; // ~10km
    const latMin = location.latitude - DEGREE_OFFSET;
    const latMax = location.latitude + DEGREE_OFFSET;
    const lngMin = location.longitude - DEGREE_OFFSET;
    const lngMax = location.longitude + DEGREE_OFFSET;

    const cards: Card[] = [];

    for (const slug of slugs) {
      // Query card_pool for this category within bounding box
      const { data: poolCards, error: poolError } = await adminClient
        .from("card_pool")
        .select(
          "id, title, category, image_url, rating, price_level, address, google_place_id"
        )
        .eq("category", slug)
        .gte("latitude", latMin)
        .lte("latitude", latMax)
        .gte("longitude", lngMin)
        .lte("longitude", lngMax)
        .order("rating", { ascending: false })
        .limit(5);

      if (poolCards && poolCards.length > 0) {
        // Pick the best card: linked user saved > highest rating > first
        let chosen = poolCards[0];

        if (linkedUserId && linkedSavedCardIds.size > 0) {
          const linkedMatch = poolCards.find((c: any) =>
            linkedSavedCardIds.has(c.id)
          );
          if (linkedMatch) {
            chosen = linkedMatch;
          }
        }

        cards.push({
          id: chosen.id,
          title: chosen.title,
          category: chosen.category,
          imageUrl: chosen.image_url ?? null,
          rating: chosen.rating ?? null,
          priceLevel: chosen.price_level ?? null,
          address: chosen.address ?? null,
          googlePlaceId: chosen.google_place_id ?? null,
        });
      } else {
        // --- Fallback: Google Places Nearby Search ---
        const googleApiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
        if (!googleApiKey) {
          // Skip this category if no API key
          continue;
        }

        const includedTypes = getIncludedTypes(slug);

        try {
          const placesRes = await fetch(
            "https://places.googleapis.com/v1/places:searchNearby",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": googleApiKey,
                "X-Goog-FieldMask":
                  "places.id,places.displayName,places.rating,places.priceLevel,places.formattedAddress,places.photos",
              },
              body: JSON.stringify({
                includedTypes,
                maxResultCount: 5,
                locationRestriction: {
                  circle: {
                    center: {
                      latitude: location.latitude,
                      longitude: location.longitude,
                    },
                    radius: 10000,
                  },
                },
                rankPreference: "POPULARITY",
              }),
            }
          );

          if (placesRes.ok) {
            const placesData = await placesRes.json();
            const places = placesData.places ?? [];

            if (places.length > 0) {
              const p = places[0];
              cards.push({
                id: p.id ?? "",
                title: p.displayName?.text ?? "Unknown",
                category: slug,
                imageUrl: null,
                rating: p.rating ?? null,
                priceLevel: p.priceLevel ?? null,
                address: p.formattedAddress ?? null,
                googlePlaceId: p.id ?? null,
              });
            }
          }
        } catch (_placesErr) {
          // Silently skip this category on Google Places failure
        }
      }
    }

    return new Response(JSON.stringify({ cards }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
