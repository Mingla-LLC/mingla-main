import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPlaceTypesForCategory, resolveCategory } from "../_shared/categoryPlaceTypes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  categorySlug: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
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

    // Resolve slugs to display names (card_pool stores display names, not slugs)
    const resolvedCategories = slugs.map((slug) => ({
      slug,
      displayName: resolveCategory(slug) ?? slug,
    }));

    // --- Fetch linked user saved categories for boosting ---
    const linkedSavedCategorySet = new Set<string>();
    const linkedSavedCardIds = new Set<string>();

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

    for (const resolved of resolvedCategories) {
      // Query card_pool for this category within bounding box
      // card_pool stores display names and uses lat/lng columns
      const { data: poolCards } = await adminClient
        .from("card_pool")
        .select(
          "id, title, category, image_url, rating, price_level, address, google_place_id, lat, lng"
        )
        .eq("category", resolved.displayName)
        .gte("lat", latMin)
        .lte("lat", latMax)
        .gte("lng", lngMin)
        .lte("lng", lngMax)
        .order("rating", { ascending: false })
        .limit(5);

      if (poolCards && poolCards.length > 0) {
        // Take up to 3 cards, boosting linked user's saved cards to the top
        let sorted = [...poolCards];
        if (linkedUserId && linkedSavedCardIds.size > 0) {
          sorted.sort((a: any, b: any) => {
            const aLinked = linkedSavedCardIds.has(a.id) ? 1 : 0;
            const bLinked = linkedSavedCardIds.has(b.id) ? 1 : 0;
            if (aLinked !== bLinked) return bLinked - aLinked;
            return (b.rating || 0) - (a.rating || 0);
          });
        }

        for (const chosen of sorted.slice(0, 3)) {
          cards.push({
            id: chosen.id,
            title: chosen.title,
            category: chosen.category,
            categorySlug: resolved.slug,
            imageUrl: chosen.image_url ?? null,
            rating: chosen.rating ?? null,
            priceLevel: chosen.price_level ?? null,
            address: chosen.address ?? null,
            googlePlaceId: chosen.google_place_id ?? null,
            lat: chosen.lat ?? null,
            lng: chosen.lng ?? null,
          });
        }
      } else {
        // --- Fallback: Google Places Nearby Search ---
        const googleApiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
        if (!googleApiKey) {
          // Skip this category if no API key
          continue;
        }

        const includedTypes = getPlaceTypesForCategory(resolved.displayName);
        if (includedTypes.length === 0) continue;

        // Google Places API limits includedTypes — use first 5 types
        const typesToSend = includedTypes.slice(0, 5);

        try {
          const placesRes = await fetch(
            "https://places.googleapis.com/v1/places:searchNearby",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": googleApiKey,
                "X-Goog-FieldMask":
                  "places.id,places.displayName,places.rating,places.priceLevel,places.formattedAddress,places.photos,places.location",
              },
              body: JSON.stringify({
                includedTypes: typesToSend,
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
              const topPlaces = places.slice(0, 3);
              for (const p of topPlaces) {
                const photoRef = p.photos?.[0]?.name;
                const imageUrl = photoRef
                  ? `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=400&key=${googleApiKey}`
                  : null;

                cards.push({
                  id: p.id ?? "",
                  title: p.displayName?.text ?? "Unknown",
                  category: resolved.displayName,
                  categorySlug: resolved.slug,
                  imageUrl,
                  rating: p.rating ?? null,
                  priceLevel: p.priceLevel ?? null,
                  address: p.formattedAddress ?? null,
                  googlePlaceId: p.id ?? null,
                  lat: p.location?.latitude ?? null,
                  lng: p.location?.longitude ?? null,
                });
              }
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
