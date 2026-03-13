import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCategories } from "../_shared/categoryPlaceTypes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Interfaces ──────────────────────────────────────────────────────────────

interface RequestBody {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
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
  priceTier: string | null;
  description: string | null;
  cardType: "single" | "curated";
  tagline: string | null;
  stops: number;
  totalPriceMin: number | null;
  totalPriceMax: number | null;
  website: string | null;
}

// ── Utilities ───────────────────────────────────────────────────────────────

function derivePriceTier(
  priceTier: string | null,
  priceLevel: string | null,
): string | null {
  if (priceTier) return priceTier;
  if (!priceLevel) return "chill";
  const mapping: Record<string, string> = {
    PRICE_LEVEL_FREE: "chill",
    PRICE_LEVEL_INEXPENSIVE: "chill",
    PRICE_LEVEL_MODERATE: "comfy",
    PRICE_LEVEL_EXPENSIVE: "bougie",
    PRICE_LEVEL_VERY_EXPENSIVE: "lavish",
  };
  return mapping[priceLevel] ?? "chill";
}

/**
 * Maps a raw card_pool JSONB row (snake_case) to the Card interface (camelCase).
 */
function mapPoolCardToCard(raw: Record<string, unknown>): Card {
  const stopsArr = raw.stops;
  const stopsCount = Array.isArray(stopsArr) ? stopsArr.length : 0;
  const cardType = (raw.card_type as string) ?? "single";

  return {
    id: (raw.id as string) ?? "",
    title: (raw.title as string) ?? "Unknown",
    category: (raw.category as string) ?? (cardType === "curated" ? "Curated" : ""),
    categorySlug: (raw.category_slug as string) ?? (raw.category as string)?.toLowerCase().replace(/\s+/g, "_") ?? "",
    imageUrl: (raw.image_url as string) ?? null,
    rating: (raw.rating as number) ?? null,
    priceLevel: (raw.price_level as string) ?? null,
    address: (raw.address as string) ?? null,
    googlePlaceId: (raw.google_place_id as string) ?? null,
    lat: (raw.lat as number) ?? null,
    lng: (raw.lng as number) ?? null,
    priceTier: derivePriceTier(
      (raw.price_tier as string) ?? null,
      (raw.price_level as string) ?? null,
    ),
    description: (raw.description as string) ?? null,
    cardType: cardType as "single" | "curated",
    tagline: (raw.tagline as string) ?? null,
    stops: stopsCount,
    totalPriceMin: (raw.total_price_min as number) ?? null,
    totalPriceMax: (raw.total_price_max as number) ?? null,
    website: (raw.website as string) ?? null,
  };
}

// ── Intent → category mapping (matches mobile holidays.ts) ─────────────────

const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ["first_meet", "drink", "picnic", "wellness", "nature"],
  adventurous: [
    "nature", "play", "creative_arts", "casual_eats", "drink",
    "first_meet", "picnic", "watch", "wellness", "groceries_flowers",
    "work_business",
  ],
};

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth verification
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    const userId = user.id;

    // Admin client for RPC + impression inserts
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parse & validate body ---
    const body: RequestBody = await req.json();
    const { personId, holidayKey, categorySlugs, curatedExperienceType, location } = body;

    if (!personId || !UUID_RE.test(personId)) {
      return new Response(
        JSON.stringify({ error: "personId is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    if (!holidayKey || typeof holidayKey !== "string") {
      return new Response(
        JSON.stringify({ error: "holidayKey is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    if (!Array.isArray(categorySlugs) || categorySlugs.length === 0) {
      return new Response(
        JSON.stringify({ error: "categorySlugs is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    if (
      !location ||
      typeof location.latitude !== "number" ||
      typeof location.longitude !== "number"
    ) {
      return new Response(
        JSON.stringify({ error: "location is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // --- Resolve categories ---
    // Expand intent-based slugs (romantic, adventurous) into concrete categories,
    // then resolve all to canonical Mingla category names
    const expandedSlugs: string[] = [];
    for (const slug of categorySlugs) {
      const intentCategories = INTENT_CATEGORY_MAP[slug];
      if (intentCategories) {
        expandedSlugs.push(...intentCategories);
      } else {
        expandedSlugs.push(slug);
      }
    }

    const resolvedCategories = resolveCategories(expandedSlugs);
    if (resolvedCategories.length === 0) {
      // Fallback to common categories if resolution fails
      resolvedCategories.push("Casual Eats", "Fine Dining", "Play");
    }

    // --- Determine curated experience type ---
    let effectiveCuratedType: string | null = curatedExperienceType ?? null;
    if (!effectiveCuratedType) {
      if (categorySlugs.includes("romantic")) effectiveCuratedType = "romantic";
      else if (categorySlugs.includes("adventurous")) effectiveCuratedType = "adventurous";
    }

    // --- Call RPC ---
    console.log(
      `[get-person-hero-cards] userId=${userId}, personId=${personId}, ` +
      `holidayKey=${holidayKey}, categories=[${resolvedCategories}], ` +
      `curatedType=${effectiveCuratedType}`,
    );

    const { data: rpcRows, error: rpcError } = await adminClient.rpc(
      "query_person_hero_cards",
      {
        p_user_id: userId,
        p_person_id: personId,
        p_lat: location.latitude,
        p_lng: location.longitude,
        p_categories: resolvedCategories,
        p_curated_experience_type: effectiveCuratedType,
        p_initial_radius_meters: 15000,
        p_max_radius_meters: 100000,
      },
    );

    if (rpcError) {
      console.error("[get-person-hero-cards] RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: "Database query failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    // --- Map rows to Card[] ---
    const rows = rpcRows ?? [];
    let cards: Card[] = rows.map((row: { card: Record<string, unknown>; card_type: string; total_available: number }) =>
      mapPoolCardToCard(row.card),
    );
    const totalAvailable = rows.length > 0 ? Number(rows[0].total_available) : 0;

    // --- Gap-fill if < 6 cards ---
    if (cards.length < 6) {
      console.log(
        `[get-person-hero-cards] Only ${cards.length} cards from pool, attempting gap-fill`,
      );

      try {
        // Import and use serveCardsFromPipeline for gap-fill
        const { serveCardsFromPipeline } = await import("../_shared/cardPoolService.ts");
        const googleApiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";

        if (googleApiKey) {
          const gapCount = 6 - cards.length;
          const gapResult = await serveCardsFromPipeline(
            {
              supabaseAdmin: adminClient,
              userId,
              lat: location.latitude,
              lng: location.longitude,
              radiusMeters: 50000,
              categories: resolvedCategories,
              budgetMin: 0,
              budgetMax: 99999,
              limit: gapCount,
              excludeCardIds: cards.map((c) => c.id),
            },
            googleApiKey,
          );

          if (gapResult.cards.length > 0) {
            console.log(
              `[get-person-hero-cards] Gap-fill added ${gapResult.cards.length} cards from pipeline`,
            );

            // Re-run RPC to get fresh results including gap-filled cards
            const { data: rpcRows2 } = await adminClient.rpc(
              "query_person_hero_cards",
              {
                p_user_id: userId,
                p_person_id: personId,
                p_lat: location.latitude,
                p_lng: location.longitude,
                p_categories: resolvedCategories,
                p_curated_experience_type: effectiveCuratedType,
                p_initial_radius_meters: 15000,
                p_max_radius_meters: 100000,
              },
            );

            if (rpcRows2 && rpcRows2.length > cards.length) {
              cards = rpcRows2.map(
                (row: { card: Record<string, unknown>; card_type: string; total_available: number }) =>
                  mapPoolCardToCard(row.card),
              );
            }
          }
        }
      } catch (gapFillError) {
        // Gap-fill failure is non-fatal — return pool-only results
        console.warn("[get-person-hero-cards] Gap-fill failed:", gapFillError);
      }
    }

    // --- Record impressions ---
    if (cards.length > 0) {
      const impressionRows = cards.map((card) => ({
        user_id: userId,
        person_id: personId,
        card_pool_id: card.id,
        holiday_key: holidayKey,
      }));

      const { error: impressionError } = await adminClient
        .from("person_card_impressions")
        .upsert(impressionRows, { onConflict: "user_id,person_id,card_pool_id", ignoreDuplicates: true });

      if (impressionError) {
        // Non-fatal: log but don't fail the request
        console.warn("[get-person-hero-cards] Impression insert error:", impressionError);
      }
    }

    // --- Return response ---
    const hasMore = totalAvailable > cards.length;

    return new Response(
      JSON.stringify({ cards, hasMore }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("[get-person-hero-cards] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
