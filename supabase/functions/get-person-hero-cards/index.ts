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
  personId?: string;         // DEPRECATED — saved_people.id
  pairedUserId?: string;     // NEW — auth.users.id of paired user
  viewerUserId?: string;     // For custom holidays: the creator's user ID
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
  mode?: "default" | "shuffle" | "bilateral"; // default = use provided categories; shuffle = personalize if ≥10 swipes; bilateral = blend both users' prefs
  isCustomHoliday?: boolean;
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
 * @param raw           The JSONB blob from to_jsonb(cp.*)
 * @param rowCardType   The standalone card_type TEXT column from the RPC row
 */
function mapPoolCardToCard(raw: Record<string, unknown>, rowCardType?: string): Card {
  const stopsArr = raw.stops;
  const stopsCount = Array.isArray(stopsArr) ? stopsArr.length : 0;
  const cardType = rowCardType ?? (raw.card_type as string) ?? "single";

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
    priceTier: (raw.price_tiers as string[])?.[0] ?? derivePriceTier(
      (raw.price_tier as string) ?? null,
      (raw.price_level as string) ?? null,
    ),
    priceTiers: (raw.price_tiers as string[])?.length ? (raw.price_tiers as string[]) : [(raw.price_tier as string) || 'chill'],
    description: (raw.description as string) ?? null,
    cardType: cardType as "single" | "curated",
    tagline: (raw.tagline as string) ?? null,
    stops: stopsCount,
    stopsData: cardType === "curated" && Array.isArray(stopsArr) ? stopsArr : null,
    totalPriceMin: (raw.total_price_min as number) ?? null,
    totalPriceMax: (raw.total_price_max as number) ?? null,
    website: (raw.website as string) ?? null,
    estimatedDurationMinutes: (raw.estimated_duration_minutes as number) ?? null,
    experienceType: (raw.experience_type as string) ?? null,
    categories: Array.isArray(raw.categories) ? (raw.categories as string[]) : null,
    shoppingList: Array.isArray(raw.shopping_list) ? (raw.shopping_list as unknown[]) : null,
  };
}

// ── Distance preference → radius mapping ────────────────────────────────────

const DISTANCE_RADIUS_MAP: Record<string, { initial: number; max: number }> = {
  walking: { initial: 5000, max: 15000 },
  near:    { initial: 15000, max: 30000 },
  medium:  { initial: 25000, max: 50000 },
  far:     { initial: 40000, max: 100000 },
};

// ── Intent → category mapping (matches mobile holidays.ts) ─────────────────

// ORCH-0434: Updated to new canonical slugs.
const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ["icebreakers", "drinks_and_music", "nature", "upscale_fine_dining"],
  adventurous: [
    "nature", "play", "creative_arts", "brunch_lunch_casual", "drinks_and_music",
    "icebreakers", "movies_theatre", "flowers",
  ],
  friendly: ["play", "brunch_lunch_casual", "drinks_and_music", "nature", "creative_arts",
    "movies_theatre"],
};

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Keep-warm ping: boot the isolate without running business logic ──
    const rawBody = await req.json();
    if (rawBody.warmPing) {
      return new Response(JSON.stringify({ status: 'warm' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
    const { personId, pairedUserId, viewerUserId, holidayKey, categorySlugs, curatedExperienceType, location, mode, isCustomHoliday, excludeCardIds } = rawBody as RequestBody;

    // Accept either personId (deprecated) or pairedUserId (new pairing flow)
    const effectivePersonId = pairedUserId ?? personId;
    const usingPairedUser = !!pairedUserId;
    const isShuffleMode = mode === "shuffle";
    const isBilateralMode = mode === "bilateral";

    if (!effectivePersonId || !UUID_RE.test(effectivePersonId)) {
      return new Response(
        JSON.stringify({ error: "personId or pairedUserId is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // --- Multi-dimension preference variables ---
    let priceTierFilter: string[] | null = null;
    let initialRadius = 15000;
    let maxRadius = 100000;

    // --- Shuffle mode: check swipe count and personalize if ≥10 ---
    let blendedCategories = categorySlugs;

    if (isBilateralMode && usingPairedUser) {
      // ── Bilateral mode: blend BOTH users' preferences ──
      try {
        const [{ data: pairedPrefs }, { data: viewerPrefs }] = await Promise.all([
          adminClient
            .from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "category")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.4)
            .order("preference_value", { ascending: false })
            .limit(10),
          adminClient
            .from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", userId)
            .eq("preference_type", "category")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.4)
            .order("preference_value", { ascending: false })
            .limit(10),
        ]);

        const pairedMap = new Map<string, number>();
        (pairedPrefs ?? []).forEach((p: { preference_key: string; preference_value: number }) => {
          pairedMap.set(p.preference_key, p.preference_value);
        });

        const viewerMap = new Map<string, number>();
        (viewerPrefs ?? []).forEach((p: { preference_key: string; preference_value: number }) => {
          viewerMap.set(p.preference_key, p.preference_value);
        });

        // Find intersection: categories both users like
        const intersection: { key: string; combined: number }[] = [];
        for (const [key, pairedVal] of pairedMap) {
          const viewerVal = viewerMap.get(key);
          if (viewerVal !== undefined) {
            intersection.push({ key, combined: (pairedVal + viewerVal) / 2 });
          }
        }
        intersection.sort((a, b) => b.combined - a.combined);

        if (intersection.length >= 3) {
          blendedCategories = intersection.slice(0, 6).map((i) => i.key);
          console.log(
            `[get-person-hero-cards] Bilateral mode: ${intersection.length} overlapping categories, using top ${blendedCategories.length}`,
          );
        } else {
          // Fallback: pad with paired user's top prefs
          const used = new Set(intersection.map((i) => i.key));
          const pairedExtra = (pairedPrefs ?? [])
            .filter((p: { preference_key: string }) => !used.has(p.preference_key))
            .slice(0, 6 - intersection.length)
            .map((p: { preference_key: string }) => p.preference_key);
          blendedCategories = [
            ...intersection.map((i) => i.key),
            ...pairedExtra,
          ];
          console.log(
            `[get-person-hero-cards] Bilateral mode: < 3 overlap, padded with paired user prefs. Total: ${blendedCategories.length}`,
          );
        }
      } catch (bilateralError) {
        console.warn("[get-person-hero-cards] Bilateral mode failed, using defaults:", bilateralError);
      }
    } else if (isCustomHoliday && usingPairedUser && viewerUserId) {
      // ── Custom holiday blending: merge both users' preferences ──
      try {
        const [{ data: pairedPrefs }, { data: creatorPrefs }] = await Promise.all([
          adminClient
            .from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "category")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.4)
            .order("preference_value", { ascending: false })
            .limit(5),
          adminClient
            .from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", viewerUserId)
            .eq("preference_type", "category")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.4)
            .order("preference_value", { ascending: false })
            .limit(5),
        ]);

        // Build blended list: paired user's categories + creator's (no duplicates)
        const seen = new Set<string>();
        const blended: string[] = [];
        for (const p of (pairedPrefs ?? [])) {
          if (!seen.has(p.preference_key)) {
            seen.add(p.preference_key);
            blended.push(p.preference_key);
          }
        }
        for (const p of (creatorPrefs ?? [])) {
          if (!seen.has(p.preference_key) && blended.length < 10) {
            seen.add(p.preference_key);
            blended.push(p.preference_key);
          }
        }

        // Pad with holiday defaults if < 10
        if (blended.length < 10) {
          for (const slug of categorySlugs) {
            if (!seen.has(slug) && blended.length < 10) {
              seen.add(slug);
              blended.push(slug);
            }
          }
        }

        if (blended.length > 0) {
          blendedCategories = blended;
          console.log(
            `[get-person-hero-cards] Custom holiday blending: ${blendedCategories.length} categories from both users`,
          );
        }

        // Also fetch both users' price tier prefs — use UNION (not intersection)
        const [{ data: pairedPricePrefs }, { data: creatorPricePrefs }] = await Promise.all([
          adminClient
            .from("user_preference_learning")
            .select("preference_key")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
          adminClient
            .from("user_preference_learning")
            .select("preference_key")
            .eq("user_id", viewerUserId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
        ]);

        const priceSet = new Set<string>();
        for (const p of (pairedPricePrefs ?? [])) priceSet.add(p.preference_key);
        for (const p of (creatorPricePrefs ?? [])) priceSet.add(p.preference_key);
        if (priceSet.size > 0) {
          priceTierFilter = [...priceSet];
          console.log(`[get-person-hero-cards] Custom holiday price tiers: [${priceTierFilter}]`);
        }
      } catch (customError) {
        console.warn("[get-person-hero-cards] Custom holiday blending failed:", customError);
      }
    } else if (isShuffleMode && usingPairedUser) {
      try {
        // Parallelize ALL preference queries for shuffle mode (RC-003 perf fix)
        const [swipeResult, categoryPrefs, pricePrefs1, pricePrefs2, timePrefs1, timePrefs2, distPrefs] = await Promise.all([
          // Swipe count
          adminClient.from("user_interactions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", pairedUserId)
            .in("interaction_type", ["swipe_left", "swipe_right"]),
          // Category preferences (always fetch, only use if swipes >= 10)
          adminClient.from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "category")
            .gte("confidence", 0.15)
            .gt("preference_value", 0)
            .order("preference_value", { ascending: false })
            .limit(6),
          // Price tier preferences (paired user)
          adminClient.from("user_preference_learning")
            .select("preference_key")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
          // Price tier preferences (viewer/creator)
          adminClient.from("user_preference_learning")
            .select("preference_key")
            .eq("user_id", userId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
          // ORCH-0434: Time-of-day preferences removed — no longer used for card selection.
          // Placeholder queries to preserve Promise.all destructure positions.
          Promise.resolve({ data: [], error: null }),
          Promise.resolve({ data: [], error: null }),
          // Distance preferences
          adminClient.from("user_preference_learning")
            .select("preference_key")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "distance")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(1),
        ]);

        const swipeCount = swipeResult.count ?? 0;
        console.log(
          `[get-person-hero-cards] Shuffle mode: paired user ${pairedUserId} has ${swipeCount} swipes`,
        );

        if (swipeCount >= 10 && categoryPrefs.data?.length) {
          blendedCategories = categoryPrefs.data.map((p: any) => p.preference_key);
          console.log(
            `[get-person-hero-cards] Personalized shuffle: using top ${blendedCategories.length} categories`,
          );
        } else {
          blendedCategories = [...categorySlugs].sort(() => Math.random() - 0.5);
          console.log("[get-person-hero-cards] Random shuffle: <10 swipes, randomizing categories");
        }

        // Build price tier filter from both users
        const priceSet = new Set<string>();
        for (const p of (pricePrefs1.data ?? [])) priceSet.add(p.preference_key);
        for (const p of (pricePrefs2.data ?? [])) priceSet.add(p.preference_key);
        if (priceSet.size > 0) {
          priceTierFilter = [...priceSet];
          console.log(`[get-person-hero-cards] Shuffle price tiers: [${priceTierFilter}]`);
        }

        // Log time prefs (used for future ranking, not filtering)
        const allTimePrefs = [...(timePrefs1.data ?? []), ...(timePrefs2.data ?? [])];
        if (allTimePrefs.length > 0) {
          console.log(
            `[get-person-hero-cards] Shuffle time preferences: [${allTimePrefs.map((p: any) => p.preference_key)}]`,
          );
        }

        // Apply distance preference to radius
        if (distPrefs.data && distPrefs.data.length > 0) {
          const distBucket = distPrefs.data[0].preference_key;
          const radiusConfig = DISTANCE_RADIUS_MAP[distBucket];
          if (radiusConfig) {
            initialRadius = radiusConfig.initial;
            maxRadius = radiusConfig.max;
            console.log(
              `[get-person-hero-cards] Shuffle distance pref '${distBucket}': initial=${initialRadius}m, max=${maxRadius}m`,
            );
          }
        }
      } catch (shuffleError) {
        console.warn("[get-person-hero-cards] Shuffle pref fetch failed:", shuffleError);
      }
    } else if (usingPairedUser) {
      // Default mode: blend learned preferences (D3: confidence threshold)
      try {
        const { data: learnedPrefs } = await adminClient
          .from("user_preference_learning")
          .select("preference_key, preference_value")
          .eq("user_id", pairedUserId)
          .eq("preference_type", "category")
          .gte("confidence", 0.15)
          .gt("preference_value", 0)
          .order("preference_value", { ascending: false })
          .limit(10);

        if (learnedPrefs && learnedPrefs.length > 0) {
          const existingSlugs = new Set(categorySlugs);
          const topLearned = learnedPrefs
            .map((p: { preference_key: string }) => p.preference_key)
            .filter((key: string) => !existingSlugs.has(key))
            .slice(0, 3);
          blendedCategories = [...categorySlugs, ...topLearned];
          console.log(
            `[get-person-hero-cards] Blended ${topLearned.length} learned preferences for paired user ${pairedUserId}`,
          );
        } else {
          console.log(
            `[get-person-hero-cards] No learned preferences for paired user ${pairedUserId} — using holiday categories only`,
          );
        }
      } catch (prefError) {
        console.warn("[get-person-hero-cards] Failed to fetch learned preferences:", prefError);
      }
    }

    // ── Fetch multi-dimension preferences (price, time, distance) for paired user ──
    // Skip if shuffle mode — already fetched in parallel above
    if (usingPairedUser && !isCustomHoliday && !isShuffleMode) {
      try {
        const [{ data: pricePrefs }, { data: timePrefs }, { data: distancePrefs }] = await Promise.all([
          adminClient
            .from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
          // ORCH-0434: Time-of-day query removed.
          Promise.resolve({ data: [], error: null }),
          adminClient
            .from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "distance")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(1),
        ]);

        // Apply price tier filter
        if (pricePrefs && pricePrefs.length > 0 && !priceTierFilter) {
          priceTierFilter = pricePrefs.map((p: { preference_key: string }) => p.preference_key);
          console.log(`[get-person-hero-cards] Price tier filter: [${priceTierFilter}]`);
        }

        // Log time prefs (used for future ranking, not filtering)
        if (timePrefs && timePrefs.length > 0) {
          console.log(
            `[get-person-hero-cards] Time preferences: [${timePrefs.map((p: { preference_key: string }) => p.preference_key)}]`,
          );
        }

        // Apply distance preference to radius
        if (distancePrefs && distancePrefs.length > 0) {
          const distBucket = distancePrefs[0].preference_key;
          const radiusConfig = DISTANCE_RADIUS_MAP[distBucket];
          if (radiusConfig) {
            initialRadius = radiusConfig.initial;
            maxRadius = radiusConfig.max;
            console.log(
              `[get-person-hero-cards] Distance pref '${distBucket}': initial=${initialRadius}m, max=${maxRadius}m`,
            );
          }
        }
      } catch (dimError) {
        console.warn("[get-person-hero-cards] Multi-dimension pref fetch failed:", dimError);
      }
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
    for (const slug of blendedCategories) {
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
      resolvedCategories.push("Brunch, Lunch & Casual", "Upscale & Fine Dining", "Play");
    }

    // --- Determine curated experience type ---
    let effectiveCuratedType: string | null = curatedExperienceType ?? null;
    if (!effectiveCuratedType) {
      if (categorySlugs.includes("romantic")) effectiveCuratedType = "romantic";
      else if (categorySlugs.includes("adventurous")) effectiveCuratedType = "adventurous";
    }

    // --- Call RPC ---
    console.log(
      `[get-person-hero-cards] userId=${userId}, ${usingPairedUser ? 'pairedUserId' : 'personId'}=${effectivePersonId}, ` +
      `holidayKey=${holidayKey}, categories=[${resolvedCategories}], ` +
      `curatedType=${effectiveCuratedType}`,
    );

    const { data: rpcRows, error: rpcError } = await adminClient.rpc(
      "query_person_hero_cards",
      {
        p_user_id: userId,
        p_person_id: effectivePersonId,
        p_lat: location.latitude,
        p_lng: location.longitude,
        p_categories: resolvedCategories,
        p_curated_experience_type: effectiveCuratedType,
        p_initial_radius_meters: initialRadius,
        p_max_radius_meters: maxRadius,
        p_exclude_card_ids: excludeCardIds || [],
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
      mapPoolCardToCard(row.card, row.card_type),
    );
    let totalAvailable = rows.length > 0 ? Number(rows[0].total_available) : 0;

    // --- Apply price tier filter if set ---
    if (priceTierFilter && priceTierFilter.length > 0) {
      const beforeCount = cards.length;
      cards = cards.filter(
        (c) => c.cardType === "curated" || !c.priceTier || priceTierFilter!.includes(c.priceTier),
      );
      if (cards.length < beforeCount) {
        console.log(
          `[get-person-hero-cards] Price tier filter removed ${beforeCount - cards.length} cards`,
        );
        totalAvailable = Math.max(0, totalAvailable - (beforeCount - cards.length));
      }
    }

    console.log(
      `[get-person-hero-cards] Mapped ${cards.length} cards — types: [${cards.map(c => c.cardType).join(", ")}]`,
    );

    // Pool-only: serve what card_pool RPC returned. No place_pool fallback.

    // --- Final dedup safety net (prevents any source of duplicate IDs) ---
    {
      const seen = new Set<string>();
      cards = cards.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    }

    // --- Record impressions ---
    if (cards.length > 0) {
      const impressionRows = cards.map((card) => ({
        user_id: userId,
        ...(usingPairedUser
          ? { paired_user_id: effectivePersonId }
          : { person_id: effectivePersonId }
        ),
        card_pool_id: card.id,
        holiday_key: holidayKey,
      }));

      // Fire-and-forget: don't block the response for impression recording
      adminClient
        .from("person_card_impressions")
        .upsert(impressionRows, {
          onConflict: usingPairedUser
            ? "user_id,paired_user_id,card_pool_id"
            : "user_id,person_id,card_pool_id",
          ignoreDuplicates: true,
        })
        .then(({ error }) => {
          if (error) console.warn("[get-person-hero-cards] Impression insert error:", error);
        });
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
