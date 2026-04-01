import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCategory, ALL_CATEGORY_NAMES } from "../_shared/categoryPlaceTypes.ts";

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
  description?: string;
  mode?: "holiday" | "hero" | "generate_more";
  excludeCardIds?: string[];
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
  stopsData: unknown[] | null;
  totalPriceMin: number | null;
  totalPriceMax: number | null;
  website: string | null;
  estimatedDurationMinutes: number | null;
  experienceType: string | null;
  categories: string[] | null;
  shoppingList: unknown[] | null;
}

interface PoolCard {
  id: string;
  title: string;
  category: string;
  image_url: string | null;
  rating: number | null;
  price_level: string | null;
  price_tier?: string | null;
  price_tiers?: string[] | null;
  description?: string | null;
  card_type?: string | null;
  address: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  tagline?: string | null;
  categories?: string[] | null;
  stops?: unknown[] | null;
  total_price_min?: number | null;
  total_price_max?: number | null;
  website?: string | null;
  estimated_duration_minutes?: number | null;
  experience_type?: string | null;
  shopping_list?: unknown[] | null;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function derivePriceTier(priceTier: string | null, priceLevel: string | null): string | null {
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

function validateCategory(input: string): string {
  const resolved = resolveCategory(input);
  if (resolved && ALL_CATEGORY_NAMES.includes(resolved)) return resolved;
  return "Casual Eats";
}

function mapPoolCardToResponseCard(
  chosen: PoolCard,
  categorySlug: string,
): Card {
  const isCurated = chosen.card_type === "curated";
  const stopsArr = Array.isArray(chosen.stops) ? chosen.stops : null;
  const stopsCount = stopsArr ? stopsArr.length : 0;
  const catName = chosen.category ?? (isCurated ? "Curated" : "");

  return {
    id: chosen.id,
    title: chosen.title,
    category: catName,
    categorySlug: isCurated ? "curated" : categorySlug,
    imageUrl: chosen.image_url ?? null,
    rating: chosen.rating ?? null,
    priceLevel: chosen.price_level ?? null,
    address: chosen.address ?? null,
    googlePlaceId: chosen.google_place_id ?? null,
    lat: chosen.lat ?? null,
    lng: chosen.lng ?? null,
    priceTier: chosen.price_tiers?.[0] ?? derivePriceTier(chosen.price_tier ?? null, chosen.price_level ?? null),
    priceTiers: chosen.price_tiers?.length ? chosen.price_tiers : [chosen.price_tier || 'chill'],
    description: chosen.description ?? `A great ${catName} spot to explore.`,
    cardType: (chosen.card_type as "single" | "curated") ?? "single",
    tagline: chosen.tagline ?? null,
    stops: stopsCount,
    stopsData: isCurated ? stopsArr : null,
    totalPriceMin: chosen.total_price_min ?? null,
    totalPriceMax: chosen.total_price_max ?? null,
    website: chosen.website ?? null,
    estimatedDurationMinutes: chosen.estimated_duration_minutes ?? null,
    experienceType: chosen.experience_type ?? null,
    categories: Array.isArray(chosen.categories) ? chosen.categories : null,
    shoppingList: Array.isArray(chosen.shopping_list) ? chosen.shopping_list : null,
  };
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

    // Determine effective mode (backward compatible)
    const effectiveMode: "holiday" | "hero" | "generate_more" =
      body.mode === "hero" || body.mode === "generate_more"
        ? body.mode
        : "holiday";

    // Sanitize excludeCardIds
    const excludeCardIds: string[] = Array.isArray(body.excludeCardIds)
      ? body.excludeCardIds
      : [];

    // Sanitize description
    const description: string =
      typeof body.description === "string" ? body.description : "";

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

    // categorySlugs validation: only require non-empty for holiday mode
    if (effectiveMode === "holiday") {
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
    } else {
      // For hero/generate_more, categorySlugs can be empty but must be an array of strings if present
      if (
        !Array.isArray(categorySlugs) ||
        categorySlugs.some((s) => typeof s !== "string")
      ) {
        return new Response(
          JSON.stringify({ error: "categorySlugs must be a string array" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
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

    // --- Bounding box (shared across modes) ---
    const DEGREE_OFFSET = 0.09; // ~10km
    const latMin = location.latitude - DEGREE_OFFSET;
    const latMax = location.latitude + DEGREE_OFFSET;
    const lngMin = location.longitude - DEGREE_OFFSET;
    const lngMax = location.longitude + DEGREE_OFFSET;

    // --- Fetch linked user saved categories for boosting (shared) ---
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

    // =====================================================================
    // MODE: hero
    // =====================================================================
    if (effectiveMode === "hero") {
      // Step 1: Resolve category slugs — replace "description_match" with GPT-derived category
      let resolvedSlugs = [...categorySlugs];

      const descMatchIdx = resolvedSlugs.indexOf("description_match");
      if (descMatchIdx !== -1) {
        // Deterministic fallback — no GPT needed
        const fallbacks = ["Casual Eats", "Drink", "Nature"];
        const matchedCategory = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        resolvedSlugs[descMatchIdx] = matchedCategory.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
      }

      // Resolve all slugs to display names
      const heroCategories = resolvedSlugs.map((slug) => ({
        slug,
        displayName: resolveCategory(slug) ?? validateCategory(slug),
      }));

      // Step 2: Query card_pool for each category, pick 1 per category
      const heroCards: Card[] = [];
      const excludeSet = new Set(excludeCardIds);

      for (const cat of heroCategories) {
        const { data: poolCards } = await adminClient
          .from("card_pool")
          .select(
            "id, title, category, image_url, rating, price_level, price_tier, price_tiers, description, card_type, address, google_place_id, lat, lng, website, tagline, categories, stops, total_price_min, total_price_max, estimated_duration_minutes, experience_type, shopping_list"
          )
          .eq("category", cat.displayName)
          .gte("lat", latMin)
          .lte("lat", latMax)
          .gte("lng", lngMin)
          .lte("lng", lngMax)
          .order("rating", { ascending: false })
          .limit(5);

        if (poolCards && poolCards.length > 0) {
          // Boost linked user saved cards
          let sorted = [...poolCards];
          if (linkedUserId && linkedSavedCardIds.size > 0) {
            sorted.sort((a: PoolCard, b: PoolCard) => {
              const aLinked = linkedSavedCardIds.has(a.id) ? 1 : 0;
              const bLinked = linkedSavedCardIds.has(b.id) ? 1 : 0;
              if (aLinked !== bLinked) return bLinked - aLinked;
              return (b.rating || 0) - (a.rating || 0);
            });
          }

          // Pick first non-excluded card
          const chosen = sorted.find((c: PoolCard) => !excludeSet.has(c.id));
          if (chosen) {
            excludeSet.add(chosen.id);
            heroCards.push(mapPoolCardToResponseCard(chosen, cat.slug));
          }
        }

      }

      // Step 3: Query curated card
      let curatedCard: Card | null = null;
      {
        const { data: curatedCards } = await adminClient
          .from("card_pool")
          .select(
            "id, title, category, image_url, rating, price_level, price_tier, price_tiers, description, card_type, address, google_place_id, lat, lng, website, tagline, categories, stops, total_price_min, total_price_max, estimated_duration_minutes, experience_type, shopping_list"
          )
          .eq("card_type", "curated")
          .gte("lat", latMin)
          .lte("lat", latMax)
          .gte("lng", lngMin)
          .lte("lng", lngMax)
          .limit(5);

        if (curatedCards && curatedCards.length > 0) {
          // Score by keyword overlap with description
          const descWords = description.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          let bestScore = -1;
          let bestCard: PoolCard | null = null;

          for (const cc of curatedCards) {
            if (excludeSet.has(cc.id)) continue;
            let score = 0;
            const cardText = [
              cc.title ?? "",
              cc.description ?? "",
              cc.tagline ?? "",
              ...(Array.isArray(cc.categories) ? cc.categories : []),
            ]
              .join(" ")
              .toLowerCase();

            for (const w of descWords) {
              if (cardText.includes(w)) score++;
            }
            if (score > bestScore) {
              bestScore = score;
              bestCard = cc;
            }
          }

          if (bestCard) {
            excludeSet.add(bestCard.id);
            curatedCard = mapPoolCardToResponseCard(bestCard, "curated");
          }
        }
      }

      // Step 4: Assemble final list [curated, description-matched, Fine Dining, Watch, Play]
      const finalCards: Card[] = [];
      if (curatedCard) finalCards.push(curatedCard);
      for (const hc of heroCards) {
        finalCards.push(hc);
      }

      return new Response(JSON.stringify({ cards: finalCards, hasMore: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =====================================================================
    // MODE: generate_more
    // =====================================================================
    if (effectiveMode === "generate_more") {
      // Resolve categories from request slugs (no GPT)
      let resolvedCategories: string[] = [];

      // Fall back to categorySlugs from request
      if (resolvedCategories.length === 0) {
        resolvedCategories = categorySlugs
          .map((slug) => resolveCategory(slug) ?? validateCategory(slug))
          .filter((c, i, arr) => arr.indexOf(c) === i);

        // If still empty, use default set
        if (resolvedCategories.length === 0) {
          resolvedCategories = ["Casual Eats", "Nature", "Drink"];
        }
      }

      // Step 2: Query card_pool up to 5 per category, exclude excludeCardIds
      const excludeSet = new Set(excludeCardIds);
      const categoryBuckets: Map<string, Card[]> = new Map();
      let totalAvailable = 0;

      for (const catName of resolvedCategories) {
        const { data: poolCards } = await adminClient
          .from("card_pool")
          .select(
            "id, title, category, image_url, rating, price_level, price_tier, price_tiers, description, card_type, address, google_place_id, lat, lng, website, tagline, categories, stops, total_price_min, total_price_max, estimated_duration_minutes, experience_type, shopping_list"
          )
          .eq("category", catName)
          .gte("lat", latMin)
          .lte("lat", latMax)
          .gte("lng", lngMin)
          .lte("lng", lngMax)
          .order("rating", { ascending: false })
          .limit(5);

        const bucket: Card[] = [];

        if (poolCards && poolCards.length > 0) {
          // Boost linked user saved cards
          let sorted = [...poolCards];
          if (linkedUserId && linkedSavedCardIds.size > 0) {
            sorted.sort((a: PoolCard, b: PoolCard) => {
              const aLinked = linkedSavedCardIds.has(a.id) ? 1 : 0;
              const bLinked = linkedSavedCardIds.has(b.id) ? 1 : 0;
              if (aLinked !== bLinked) return bLinked - aLinked;
              return (b.rating || 0) - (a.rating || 0);
            });
          }

          for (const chosen of sorted) {
            if (excludeSet.has(chosen.id)) continue;
            totalAvailable++;
            const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
            bucket.push(mapPoolCardToResponseCard(chosen, slug));
          }
        }

        categoryBuckets.set(catName, bucket);
      }

      // Round-robin to pick up to 2 per category, total up to 5
      const generateMoreCards: Card[] = [];
      let poolCardsUsed = 0;
      const maxPerCategory = 2;
      const maxTotal = 5;

      // Round-robin: take 1 from each, then 1 more from each, until we hit 5
      for (let round = 0; round < maxPerCategory; round++) {
        for (const catName of resolvedCategories) {
          if (generateMoreCards.length >= maxTotal) break;
          const bucket = categoryBuckets.get(catName) ?? [];
          if (bucket.length > round) {
            excludeSet.add(bucket[round].id);
            generateMoreCards.push(bucket[round]);
            poolCardsUsed++;
          }
        }
        if (generateMoreCards.length >= maxTotal) break;
      }

      // hasMore = pool had more cards than we actually used from it
      const hasMore = totalAvailable > poolCardsUsed;

      return new Response(JSON.stringify({ cards: generateMoreCards, hasMore }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =====================================================================
    // MODE: holiday (default — existing code path, untouched logic)
    // =====================================================================

    // Limit to 3 categories
    const slugs = categorySlugs.slice(0, 3);

    // Resolve slugs to display names (card_pool stores display names, not slugs)
    const resolvedCategories = slugs.map((slug) => ({
      slug,
      displayName: resolveCategory(slug) ?? slug,
    }));

    // --- Query card_pool per category ---
    const cards: Card[] = [];

    for (const resolved of resolvedCategories) {
      // Query card_pool for this category within bounding box
      // card_pool stores display names and uses lat/lng columns
      const { data: poolCards } = await adminClient
        .from("card_pool")
        .select(
          "id, title, category, image_url, rating, price_level, price_tier, price_tiers, description, card_type, address, google_place_id, lat, lng, website, tagline, categories, stops, total_price_min, total_price_max, estimated_duration_minutes, experience_type, shopping_list"
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
          sorted.sort((a: PoolCard, b: PoolCard) => {
            const aLinked = linkedSavedCardIds.has(a.id) ? 1 : 0;
            const bLinked = linkedSavedCardIds.has(b.id) ? 1 : 0;
            if (aLinked !== bLinked) return bLinked - aLinked;
            return (b.rating || 0) - (a.rating || 0);
          });
        }

        for (const chosen of sorted.slice(0, 3)) {
          cards.push(mapPoolCardToResponseCard(chosen, resolved.slug));
        }
      }
      // No else — if pool is empty for this category, skip it
    }

    return new Response(JSON.stringify({ cards, hasMore: false }), {
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
