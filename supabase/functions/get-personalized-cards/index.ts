import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getPlaceTypesForCategory,
  resolveCategory,
} from "../_shared/categoryPlaceTypes.ts";
import {
  upsertPlaceToPool,
  insertCardToPool,
} from "../_shared/cardPoolService.ts";
import { googleLevelToTierSlug } from "../_shared/priceTiers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");

// ── UUID validation ──────────────────────────────────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Default fallback category ────────────────────────────────────────────────
const DEFAULT_PAD_CATEGORY = "Fine Dining";

// ── Google Places field mask ─────────────────────────────────────────────────
const FIELD_MASK =
  "places.id,places.displayName,places.location,places.rating,places.priceLevel,places.photos,places.formattedAddress";

// ── Interfaces ───────────────────────────────────────────────────────────────

interface RequestBody {
  linkedUserId: string;
  occasion: string;
  location: { latitude: number; longitude: number };
  radius?: number;
  isBirthday?: boolean;
}

interface CategoryScore {
  category: string;
  score: number;
}

interface CardResponse {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  location: { latitude: number; longitude: number };
  address: string | null;
  googlePlaceId: string;
  cardType?: "curated";
  stops?: Array<{
    name: string;
    category: string;
    address: string;
    imageUrl: string | null;
  }>;
}

// ── Photo URL builder ────────────────────────────────────────────────────────
function buildPhotoUrl(photoName: string): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse body
    const body: RequestBody = await req.json();
    const { linkedUserId, occasion, location, radius: rawRadius = 10000, isBirthday: rawIsBirthday = false } = body;

    // ── Validation ─────────────────────────────────────────────────────────

    // Occasion
    if (!occasion || typeof occasion !== "string" || occasion.length > 100) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing occasion" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Sanitize radius and isBirthday
    const radius = typeof rawRadius === "number" && rawRadius > 0 && rawRadius <= 50000 ? rawRadius : 10000;
    const isBirthday = rawIsBirthday === true;

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const currentUserId = user.id;

    // Validate linkedUserId
    if (!linkedUserId || typeof linkedUserId !== "string" || !UUID_REGEX.test(linkedUserId)) {
      return new Response(
        JSON.stringify({ error: "Invalid linked user ID" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (linkedUserId === currentUserId) {
      return new Response(
        JSON.stringify({ error: "Cannot get personalized cards for yourself" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate location
    if (
      !location ||
      typeof location.latitude !== "number" ||
      typeof location.longitude !== "number" ||
      location.latitude < -90 ||
      location.latitude > 90 ||
      location.longitude < -180 ||
      location.longitude > 180
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid location coordinates" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Service-role client for reading another user's data
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Verify accepted link ───────────────────────────────────────────────

    const { data: acceptedLink, error: linkError } = await supabaseAdmin
      .from("friend_links")
      .select("id")
      .or(
        `and(requester_id.eq.${currentUserId},target_id.eq.${linkedUserId}),and(requester_id.eq.${linkedUserId},target_id.eq.${currentUserId})`
      )
      .eq("status", "accepted")
      .eq("link_status", "consented")
      .maybeSingle();

    if (linkError || !acceptedLink) {
      return new Response(
        JSON.stringify({ error: "No accepted link found between these users" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Count total swipes ─────────────────────────────────────────────────

    const { count: totalSwipes, error: swipeCountError } = await supabaseAdmin
      .from("user_card_impressions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", linkedUserId)
      .in("impression_type", ["swiped_left", "swiped_right"]);

    if (swipeCountError) {
      console.error("Swipe count error:", swipeCountError);
      return new Response(
        JSON.stringify({ error: "Failed to compute personalized cards" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const swipeCount = totalSwipes || 0;

    // ── Not enough data ────────────────────────────────────────────────────

    if (swipeCount < 10) {
      return new Response(
        JSON.stringify({
          personalized: false,
          totalSwipes: swipeCount,
          categoryRanking: [],
          cards: [],
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Compute category weights from all activity sources ─────────────────

    const categoryWeights: Record<string, number> = {};

    // Source 1: Swipe impressions
    const { data: impressions, error: impError } = await supabaseAdmin
      .from("user_card_impressions")
      .select("card_pool_id, impression_type")
      .eq("user_id", linkedUserId);

    if (!impError && impressions && impressions.length > 0) {
      // Get card_pool categories for these impression card IDs
      const cardPoolIds = [...new Set(impressions.map((i: any) => i.card_pool_id).filter(Boolean))];

      if (cardPoolIds.length > 0) {
        // Batch fetch categories from card_pool
        const { data: cardPoolRows } = await supabaseAdmin
          .from("card_pool")
          .select("id, category")
          .in("id", cardPoolIds);

        if (cardPoolRows) {
          const cardCategoryMap: Record<string, string> = {};
          for (const row of cardPoolRows) {
            cardCategoryMap[row.id] = row.category;
          }

          for (const imp of impressions) {
            const category = cardCategoryMap[imp.card_pool_id];
            if (!category) continue;

            let weight = 0;
            switch (imp.impression_type) {
              case "swiped_right":
                weight = 2;
                break;
              case "swiped_left":
                weight = -1;
                break;
              case "saved":
              case "expanded":
                weight = 1;
                break;
              default:
                weight = 0;
            }

            categoryWeights[category] = (categoryWeights[category] || 0) + weight;
          }
        }
      }
    }

    // Source 2: Saved cards
    const { data: savedCards, error: savedError } = await supabaseAdmin
      .from("saved_card")
      .select("category")
      .eq("profile_id", linkedUserId);

    if (!savedError && savedCards) {
      for (const sc of savedCards) {
        if (sc.category) {
          categoryWeights[sc.category] = (categoryWeights[sc.category] || 0) + 3;
        }
      }
    }

    // Source 3: Calendar entries (scheduled experiences)
    const { data: calEntries, error: calError } = await supabaseAdmin
      .from("calendar_entries")
      .select("card_data")
      .eq("user_id", linkedUserId)
      .neq("status", "cancelled");

    if (!calError && calEntries) {
      for (const entry of calEntries) {
        const category = entry.card_data?.category;
        if (category) {
          categoryWeights[category] = (categoryWeights[category] || 0) + 5;
        }
      }
    }

    // Source 4: Place reviews
    const { data: reviews, error: reviewError } = await supabaseAdmin
      .from("place_reviews")
      .select("place_category, rating")
      .eq("user_id", linkedUserId);

    if (!reviewError && reviews) {
      for (const review of reviews) {
        if (!review.place_category) continue;
        let weight: number;
        if (review.rating >= 4) {
          weight = 4;
        } else if (review.rating <= 2) {
          weight = -3;
        } else {
          weight = 1;
        }
        categoryWeights[review.place_category] =
          (categoryWeights[review.place_category] || 0) + weight;
      }
    }

    // ── Sort and rank categories ───────────────────────────────────────────

    const categoryRanking: CategoryScore[] = Object.entries(categoryWeights)
      .map(([category, score]) => ({ category, score }))
      .sort((a, b) => b.score - a.score);

    // Take top 4 categories with score > 0
    let topCategories = categoryRanking
      .filter((c) => c.score > 0)
      .slice(0, 4)
      .map((c) => c.category);

    // Pad with Fine Dining if fewer than 4
    while (topCategories.length < 4) {
      if (!topCategories.includes(DEFAULT_PAD_CATEGORY)) {
        topCategories.push(DEFAULT_PAD_CATEGORY);
      } else {
        break; // Avoid infinite loop if Fine Dining is already there
      }
    }

    // ── Generate cards ─────────────────────────────────────────────────────

    const cards: CardResponse[] = [];
    const lat = location.latitude;
    const lng = location.longitude;

    if (isBirthday) {
      // ── Birthday: curated multi-stop card from top 3 categories ──────
      const birthdayCategories = topCategories.slice(0, 3);
      const stops: Array<{
        name: string;
        category: string;
        address: string;
        imageUrl: string | null;
      }> = [];

      for (const category of birthdayCategories) {
        const card = await fetchBestCard(supabaseAdmin, category, lat, lng, radius, currentUserId);
        if (card) {
          stops.push({
            name: card.title,
            category: card.category,
            address: card.address || "",
            imageUrl: card.imageUrl,
          });
        }
      }

      if (stops.length > 0) {
        cards.push({
          id: crypto.randomUUID(),
          title: `Birthday Experience for ${occasion}`,
          category: stops[0].category,
          imageUrl: stops[0].imageUrl,
          rating: null,
          priceLevel: null,
          location: { latitude: lat, longitude: lng },
          address: stops[0].address,
          googlePlaceId: "",
          cardType: "curated",
          stops,
        });
      }
    } else {
      // ── Regular: one card per top category (up to 4) ──────────────────
      for (const category of topCategories) {
        const card = await fetchBestCard(supabaseAdmin, category, lat, lng, radius, currentUserId);
        if (card) {
          cards.push(card);
        }
      }
    }

    return new Response(
      JSON.stringify({
        personalized: true,
        totalSwipes: swipeCount,
        categoryRanking,
        cards,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("get-personalized-cards error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ── Helper: Fetch best card from card_pool or Google Places fallback ─────────

async function fetchBestCard(
  supabaseAdmin: any,
  category: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  requestingUserId: string
): Promise<CardResponse | null> {
  // Resolve category to canonical name
  const resolvedCategory = resolveCategory(category) || category;

  // Bounding box approximation
  const latDelta = radiusMeters / 111000;
  const lngDelta = radiusMeters / (111000 * Math.cos(lat * Math.PI / 180));

  // Try card_pool first — highest rated, not seen by requesting user
  const { data: seenCards } = await supabaseAdmin
    .from("user_card_impressions")
    .select("card_pool_id")
    .eq("user_id", requestingUserId);

  const seenIds = new Set(
    (seenCards || []).map((s: any) => s.card_pool_id).filter(Boolean)
  );

  const { data: poolCards, error: poolError } = await supabaseAdmin
    .from("card_pool")
    .select("*")
    .eq("category", resolvedCategory)
    .eq("is_active", true)
    .eq("card_type", "single")
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lng", lng - lngDelta)
    .lte("lng", lng + lngDelta)
    .order("rating", { ascending: false })
    .limit(10);

  if (!poolError && poolCards && poolCards.length > 0) {
    // Find highest-rated card not seen by requesting user
    const unseen = poolCards.filter((c: any) => !seenIds.has(c.id));
    const best = unseen.length > 0 ? unseen[0] : poolCards[0];

    const imageUrl = best.image_url || null;

    return {
      id: best.id,
      title: best.title,
      category: best.category,
      imageUrl,
      rating: best.rating || null,
      priceLevel: best.price_level || null,
      location: { latitude: best.lat, longitude: best.lng },
      address: best.address || null,
      googlePlaceId: best.google_place_id || "",
    };
  }

  // ── Google Places fallback ───────────────────────────────────────────────
  if (!GOOGLE_PLACES_API_KEY) {
    console.warn("No GOOGLE_PLACES_API_KEY, skipping fallback for:", resolvedCategory);
    return null;
  }

  const placeTypes = getPlaceTypesForCategory(resolvedCategory);
  if (placeTypes.length === 0) {
    console.warn("No place types for category:", resolvedCategory);
    return null;
  }

  // Use first 3 types for the search
  const includedTypes = placeTypes.slice(0, 3);

  try {
    const searchBody = {
      includedTypes,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
      maxResultCount: 5,
      rankPreference: "POPULARITY",
    };

    const searchResponse = await fetch(
      "https://places.googleapis.com/v1/places:searchNearby",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(searchBody),
      }
    );

    if (!searchResponse.ok) {
      console.error("Google Places error:", searchResponse.status, await searchResponse.text());
      return null;
    }

    const searchData = await searchResponse.json();
    const places = searchData.places || [];

    if (places.length === 0) {
      return null;
    }

    // Pick highest-rated result
    const bestPlace = places.sort(
      (a: any, b: any) => (b.rating || 0) - (a.rating || 0)
    )[0];

    // Upsert into place_pool and card_pool (fire-and-forget for pool storage)
    const placePoolId = await upsertPlaceToPool(
      supabaseAdmin,
      bestPlace,
      GOOGLE_PLACES_API_KEY,
      "personalized_search"
    );

    if (placePoolId) {
      insertCardToPool(supabaseAdmin, {
        placePoolId,
        googlePlaceId: bestPlace.id,
        cardType: "single",
        title: bestPlace.displayName?.text || "Unknown Place",
        category: resolvedCategory,
        categories: [resolvedCategory],
        description: `A great ${resolvedCategory} spot.`,
        highlights: ["Personalized Pick", "Top Rated"],
        imageUrl: bestPlace.photos?.[0]?.name
          ? buildPhotoUrl(bestPlace.photos[0].name)
          : undefined,
        address: bestPlace.formattedAddress || "",
        lat: bestPlace.location?.latitude || 0,
        lng: bestPlace.location?.longitude || 0,
        rating: bestPlace.rating || 0,
        reviewCount: bestPlace.userRatingCount || 0,
        priceTier: googleLevelToTierSlug(bestPlace.priceLevel),
      }).catch((e: any) => console.warn("Pool insert error:", e));
    }

    const photoName = bestPlace.photos?.[0]?.name;
    const imageUrl = photoName ? buildPhotoUrl(photoName) : null;

    return {
      id: bestPlace.id,
      title: bestPlace.displayName?.text || "Unknown Place",
      category: resolvedCategory,
      imageUrl,
      rating: bestPlace.rating || null,
      priceLevel: typeof bestPlace.priceLevel === "string" ? bestPlace.priceLevel : null,
      location: {
        latitude: bestPlace.location?.latitude || 0,
        longitude: bestPlace.location?.longitude || 0,
      },
      address: bestPlace.formattedAddress || null,
      googlePlaceId: bestPlace.id,
    };
  } catch (fetchErr: any) {
    console.error("Google Places fetch error:", fetchErr);
    return null;
  }
}
