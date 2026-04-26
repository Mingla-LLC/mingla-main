import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCategories, mapPrimaryTypeToMinglaCategory, mapCategoryToSlug, SLUG_TO_DISPLAY } from "../_shared/categoryPlaceTypes.ts";
import { googleLevelToTierSlug, type PriceTierSlug } from "../_shared/priceTiers.ts";
import { getCompositionForHolidayKey, COMBO_EMPTY_REASON, type CompositionRule } from "../_shared/personHeroComposition.ts";

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
  // ORCH-0684 D-Q4: widened to add explicit "individual" force-off.
  // "default" = auto-decide bilateral if both users meet pref threshold.
  mode?: "default" | "shuffle" | "bilateral" | "individual";
  isCustomHoliday?: boolean;
  yearsElapsed?: number;     // ORCH-0684: anniversary detection for custom holidays
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
  // ORCH-0684 telemetry (optional, additive — not consumed by today's UI)
  isOpenNow?: boolean | null;
  distanceM?: number | null;
  signalId?: string | null;
  signalScore?: number | null;
}

// Shape returned by query_person_hero_places_by_signal.place JSONB (ORCH-0684).
// This is the raw place_pool row in snake_case Google shape.
interface PlacePoolRow {
  id: string;
  google_place_id: string | null;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  review_count: number | null;
  price_level: string | null;
  opening_hours: { openNow?: boolean } | null;
  website: string | null;
  photos: unknown[] | null;
  stored_photo_urls: string[] | null;
  types: string[] | null;
  primary_type: string | null;
  description: string | null;
}

// ── Mapper (ORCH-0684 RC-1 fix) ─────────────────────────────────────────────

/**
 * ORCH-0684 RC-1 fix: maps a place_pool JSONB row (snake_case Google shape)
 * to the mobile Card interface (camelCase). Replaces the legacy
 * mapPoolCardToCard which read deleted card_pool field names.
 *
 * NEVER FABRICATES (Constitution #9):
 *   - priceTier is null when place_pool.price_level is null
 *   - isOpenNow is null when opening_hours.openNow is undefined
 *   - title is "" only when place_pool.name is null/empty
 *   - category is "" when primary_type doesn't map to any Mingla category
 *
 * Mirrors transformServablePlaceToCard's field decisions for cross-surface
 * consistency with the discover-cards singles deck.
 */
function mapPlacePoolRowToCard(
  raw: PlacePoolRow,
  signalId: string,
  signalScore: number,
  distanceM: number,
): Card {
  const category = mapPrimaryTypeToMinglaCategory(raw.primary_type, raw.types ?? []) ?? "";
  const categorySlug = category ? mapCategoryToSlug(category) : "";

  // Photo: stored_photo_urls[0] when populated and not the sentinel.
  // Three-gate filter at the RPC layer guarantees this is non-null + non-sentinel
  // for served rows, but defensive null-check preserves Constitution #9.
  const imageUrl = (raw.stored_photo_urls
                    && raw.stored_photo_urls.length > 0
                    && raw.stored_photo_urls[0] !== "__backfill_failed__")
    ? raw.stored_photo_urls[0]
    : null;

  // priceTier: null when price_level unknown — no fabrication (D-Q5).
  const priceTier: PriceTierSlug | null = raw.price_level
    ? googleLevelToTierSlug(raw.price_level)
    : null;

  // isOpenNow: derived only from opening_hours.openNow. Never assume true.
  const isOpenNow: boolean | null = (raw.opening_hours
                                      && typeof raw.opening_hours.openNow === "boolean")
    ? raw.opening_hours.openNow
    : null;

  return {
    id: raw.id,
    title: raw.name ?? "",
    category,
    categorySlug,
    imageUrl,
    rating: raw.rating ?? null,
    priceLevel: raw.price_level,
    address: raw.address ?? null,
    googlePlaceId: raw.google_place_id,
    lat: raw.lat,
    lng: raw.lng,
    priceTier,
    description: raw.description ?? null,
    cardType: "single",
    tagline: null,                     // singles do not have a tagline
    stops: 0,
    stopsData: null,
    totalPriceMin: null,
    totalPriceMax: null,
    website: raw.website ?? null,
    estimatedDurationMinutes: null,
    experienceType: null,
    categories: null,
    shoppingList: null,
    isOpenNow,
    distanceM,
    signalId,
    signalScore,
  };
}

// ── Distance preference → radius mapping ────────────────────────────────────

const DISTANCE_RADIUS_MAP: Record<string, { initial: number; max: number }> = {
  walking: { initial: 5000, max: 15000 },
  near:    { initial: 15000, max: 30000 },
  medium:  { initial: 25000, max: 50000 },
  far:     { initial: 40000, max: 100000 },
};

// ── Intent → category mapping (matches mobile holidays.ts) ──────────────────
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

// ── Category slug → signal ID (mirrors discover-cards CATEGORY_TO_SIGNAL) ───
// ORCH-0640 ch06: Resolve category slugs to signal IDs.
const CATEGORY_SLUG_TO_SIGNAL_ID: Record<string, string> = {
  upscale_fine_dining: 'fine_dining',
  drinks_and_music: 'drinks',
  brunch_lunch_casual: 'casual_food',  // brunch/casual union — RPC supports multiple signalIds
  nature: 'nature',
  play: 'play',
  creative_arts: 'creative_arts',
  movies_theatre: 'movies',            // pair with 'theatre' on caller
  icebreakers: 'icebreakers',
  flowers: 'flowers',
};

// ── Combo helper (ORCH-0684 RC-2 fix per D-Q1) ──────────────────────────────
// Signal IDs → display names for the generate-curated-experiences "categories"
// array. Reverse of CATEGORY_SLUG_TO_SIGNAL_ID via SLUG_TO_DISPLAY.
const SIGNAL_ID_TO_CATEGORY_SLUG: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [slug, sig] of Object.entries(CATEGORY_SLUG_TO_SIGNAL_ID)) {
    out[sig] = slug;
  }
  // Add the fan-out signals that don't have a matching category slug:
  // 'brunch' is the second signal under brunch_lunch_casual; 'theatre' under movies_theatre.
  out['brunch'] = 'brunch_lunch_casual';
  out['theatre'] = 'movies_theatre';
  out['casual_food'] = 'brunch_lunch_casual';
  return out;
})();

function signalIdsToDisplayCategories(signalIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sig of signalIds) {
    const slug = SIGNAL_ID_TO_CATEGORY_SLUG[sig];
    if (!slug) continue;
    const display = SLUG_TO_DISPLAY[slug];
    if (display && !seen.has(display)) {
      seen.add(display);
      out.push(display);
    }
  }
  return out;
}

/**
 * Maps a curated-experience card from generate-curated-experiences into the
 * Card shape this edge fn returns. The curated edge fn already returns cards
 * in nearly the right shape — we just normalize field names and ensure
 * cardType is set to 'curated'.
 */
function curatedCardToCard(raw: Record<string, unknown>, experienceType: string): Card {
  const stopsArr = raw.stops;
  const stopsCount = Array.isArray(stopsArr) ? stopsArr.length : 0;
  return {
    id: (raw.id as string) ?? (raw.experience_id as string) ?? "",
    title: (raw.title as string) ?? "",
    category: (raw.category as string) ?? "Curated",
    categorySlug: (raw.category_slug as string) ?? "curated",
    imageUrl: (raw.image_url as string) ?? (raw.imageUrl as string) ?? null,
    rating: (raw.rating as number) ?? null,
    priceLevel: (raw.price_level as string) ?? null,
    address: (raw.address as string) ?? null,
    googlePlaceId: (raw.google_place_id as string) ?? null,
    lat: (raw.lat as number) ?? null,
    lng: (raw.lng as number) ?? null,
    priceTier: (raw.price_tier as PriceTierSlug | null) ?? null,
    description: (raw.description as string) ?? null,
    cardType: "curated",
    tagline: (raw.tagline as string) ?? null,
    stops: stopsCount,
    stopsData: Array.isArray(stopsArr) ? stopsArr : null,
    totalPriceMin: (raw.total_price_min as number) ?? null,
    totalPriceMax: (raw.total_price_max as number) ?? null,
    website: (raw.website as string) ?? null,
    estimatedDurationMinutes: (raw.estimated_duration_minutes as number) ?? null,
    experienceType,
    categories: Array.isArray(raw.categories) ? (raw.categories as string[]) : null,
    shoppingList: Array.isArray(raw.shopping_list) ? (raw.shopping_list as unknown[]) : null,
  };
}

/**
 * Plan a single curated combo for a paired-person CardRow by invoking
 * generate-curated-experiences over internal HTTP.
 *
 * NOTE (ORCH-0684 deviation from spec §3.2 option b): the spec recommended
 * extracting the combo planner into _shared/curatedComboPlanner.ts. The
 * implementor chose option (a) — internal HTTP call — to ship one wave with
 * lower blast radius. T-24 regression-lock for the curated-deck path becomes
 * trivially N/A (we don't touch generate-curated-experiences). Cost: ~one
 * extra HTTP round-trip per paired-person view mount (+100-200ms). If
 * telemetry shows this matters, file follow-up ORCH for extraction.
 */
async function planComboForHoliday(args: {
  authHeader: string;
  composition: CompositionRule;
  location: { latitude: number; longitude: number };
  excludeCardIds: string[];
  supabaseUrl: string;
}): Promise<{ combo: Card | null; emptyReason: string | null }> {
  if (args.composition.comboCount === 0) {
    return { combo: null, emptyReason: null };
  }

  const displayCategories = signalIdsToDisplayCategories(args.composition.comboAnchors);
  if (displayCategories.length === 0) {
    return { combo: null, emptyReason: COMBO_EMPTY_REASON };
  }

  try {
    const response = await fetch(
      `${args.supabaseUrl}/functions/v1/generate-curated-experiences`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: args.authHeader,
        },
        body: JSON.stringify({
          categories: displayCategories,
          experienceTypes: [args.composition.experienceType],
          location: { lat: args.location.latitude, lng: args.location.longitude },
          travelMode: "walking",
          travelConstraintValue: 30,
          dateOption: "today",
          batchSeed: 0,
          limit: 5,                  // get a few to pick best, but only return 1
          excludeCardIds: args.excludeCardIds,
        }),
      },
    );

    if (!response.ok) {
      console.warn(
        `[get-person-hero-cards] combo planner returned non-ok: ${response.status}`,
      );
      return { combo: null, emptyReason: COMBO_EMPTY_REASON };
    }

    const body = await response.json();
    const cards = Array.isArray(body?.cards) ? body.cards : [];
    if (cards.length === 0) {
      return { combo: null, emptyReason: COMBO_EMPTY_REASON };
    }

    // Take the highest-scoring curated card. The planner may return singles
    // mixed in; filter to curated only.
    const curatedOnly = cards.filter(
      (c: { cardType?: string; card_type?: string; stops?: number; experience_type?: string }) =>
        c.cardType === "curated" || c.card_type === "curated" || (typeof c.stops === "number" && c.stops > 1),
    );
    if (curatedOnly.length === 0) {
      return { combo: null, emptyReason: COMBO_EMPTY_REASON };
    }
    return {
      combo: curatedCardToCard(curatedOnly[0], args.composition.experienceType),
      emptyReason: null,
    };
  } catch (err) {
    console.warn(`[get-person-hero-cards] combo planner threw:`, err);
    return { combo: null, emptyReason: COMBO_EMPTY_REASON };
  }
}

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
    const {
      personId, pairedUserId, viewerUserId, holidayKey, categorySlugs,
      curatedExperienceType, location, mode, isCustomHoliday, yearsElapsed,
      excludeCardIds,
    } = rawBody as RequestBody;

    // Accept either personId (deprecated) or pairedUserId (new pairing flow)
    const effectivePersonId = pairedUserId ?? personId;
    const usingPairedUser = !!pairedUserId;

    if (!effectivePersonId || !UUID_RE.test(effectivePersonId)) {
      return new Response(
        JSON.stringify({ error: "personId or pairedUserId is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // ── ORCH-0684 D-Q4: Auto-bilateral mode detection ─────────────────────
    // When mode === "default" and BOTH users have ≥10 confident
    // user_preference_learning rows, automatically promote to bilateral.
    // User force-individual via mode === "individual"; force-bilateral via
    // mode === "bilateral".
    let effectiveMode: "default" | "shuffle" | "bilateral" | "individual" = mode ?? "default";
    if (effectiveMode === "default" && usingPairedUser && pairedUserId) {
      const PREF_THRESHOLD = 10;
      try {
        const [{ count: viewerCount }, { count: pairedCount }] = await Promise.all([
          adminClient.from("user_preference_learning")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("confidence", 0.15),
          adminClient.from("user_preference_learning")
            .select("id", { count: "exact", head: true })
            .eq("user_id", pairedUserId)
            .gte("confidence", 0.15),
        ]);
        if ((viewerCount ?? 0) >= PREF_THRESHOLD && (pairedCount ?? 0) >= PREF_THRESHOLD) {
          effectiveMode = "bilateral";
          console.log(
            `[get-person-hero-cards] auto-bilateral active for pair (${userId}, ${pairedUserId}) — viewer=${viewerCount}, paired=${pairedCount}`,
          );
        }
      } catch (autoBilateralErr) {
        console.warn(
          `[get-person-hero-cards] auto-bilateral check failed, defaulting to individual:`,
          autoBilateralErr,
        );
      }
    }

    const isShuffleMode = effectiveMode === "shuffle";
    const isBilateralMode = effectiveMode === "bilateral";

    // --- Multi-dimension preference variables ---
    let priceTierFilter: string[] | null = null;
    let initialRadius = 15000;
    let maxRadius = 100000;

    // --- Category blending (modulated by effectiveMode) ---
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
        const [swipeResult, categoryPrefs, pricePrefs1, pricePrefs2, _t1, _t2, distPrefs] = await Promise.all([
          adminClient.from("user_interactions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", pairedUserId)
            .in("interaction_type", ["swipe_left", "swipe_right"]),
          adminClient.from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "category")
            .gte("confidence", 0.15)
            .gt("preference_value", 0)
            .order("preference_value", { ascending: false })
            .limit(6),
          adminClient.from("user_preference_learning")
            .select("preference_key")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
          adminClient.from("user_preference_learning")
            .select("preference_key")
            .eq("user_id", userId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
          // ORCH-0434: Time-of-day removed.
          Promise.resolve({ data: [], error: null }),
          Promise.resolve({ data: [], error: null }),
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
          blendedCategories = categoryPrefs.data.map((p: { preference_key: string }) => p.preference_key);
          console.log(
            `[get-person-hero-cards] Personalized shuffle: using top ${blendedCategories.length} categories`,
          );
        } else {
          blendedCategories = [...categorySlugs].sort(() => Math.random() - 0.5);
          console.log("[get-person-hero-cards] Random shuffle: <10 swipes, randomizing categories");
        }

        const priceSet = new Set<string>();
        for (const p of (pricePrefs1.data ?? [])) priceSet.add(p.preference_key);
        for (const p of (pricePrefs2.data ?? [])) priceSet.add(p.preference_key);
        if (priceSet.size > 0) {
          priceTierFilter = [...priceSet];
          console.log(`[get-person-hero-cards] Shuffle price tiers: [${priceTierFilter}]`);
        }

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

    // ── Multi-dimension preferences (price, distance) for paired user ─────
    if (usingPairedUser && !isCustomHoliday && !isShuffleMode) {
      try {
        const [{ data: pricePrefs }, _timePrefs, { data: distancePrefs }] = await Promise.all([
          adminClient
            .from("user_preference_learning")
            .select("preference_key, preference_value")
            .eq("user_id", pairedUserId)
            .eq("preference_type", "price_tier")
            .gte("confidence", 0.15)
            .gt("preference_value", 0.5)
            .order("preference_value", { ascending: false })
            .limit(2),
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

        if (pricePrefs && pricePrefs.length > 0 && !priceTierFilter) {
          priceTierFilter = pricePrefs.map((p: { preference_key: string }) => p.preference_key);
          console.log(`[get-person-hero-cards] Price tier filter: [${priceTierFilter}]`);
        }

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
      resolvedCategories.push("Brunch, Lunch & Casual", "Upscale & Fine Dining", "Play");
    }

    // --- Determine effective curated experience type ---
    let effectiveCuratedType: string | null = curatedExperienceType ?? null;
    if (!effectiveCuratedType) {
      if (categorySlugs.includes("romantic")) effectiveCuratedType = "romantic";
      else if (categorySlugs.includes("adventurous")) effectiveCuratedType = "adventurous";
    }

    // ── Resolve category slugs to signal IDs ──────────────────────────────
    const signalIds = Array.from(new Set(
      blendedCategories
        .flatMap((slug: string) => INTENT_CATEGORY_MAP[slug] ?? [slug])
        .map((s: string) => CATEGORY_SLUG_TO_SIGNAL_ID[s])
        .filter(Boolean)
    ));
    if (blendedCategories.includes('brunch_lunch_casual') && !signalIds.includes('brunch')) signalIds.push('brunch');
    if (blendedCategories.includes('movies_theatre') && !signalIds.includes('theatre')) signalIds.push('theatre');

    if (signalIds.length === 0) {
      console.warn(`[get-person-hero-cards] No signal_ids resolved from categories=[${blendedCategories}]`);
      return new Response(
        JSON.stringify({ cards: [], hasMore: false, summary: { emptyReason: 'no_signals_resolved' } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    console.log(
      `[get-person-hero-cards] userId=${userId}, ${usingPairedUser ? 'pairedUserId' : 'personId'}=${effectivePersonId}, ` +
      `holidayKey=${holidayKey}, signalIds=[${signalIds}], initialRadius=${initialRadius}m, mode=${effectiveMode}`,
    );

    // ── ORCH-0684: Resolve composition rule (D-Q1) ─────────────────────────
    const composition = getCompositionForHolidayKey({
      holidayKey,
      isCustomHoliday: !!isCustomHoliday,
      yearsElapsed,
      resolvedSectionSignals: signalIds,
    });

    // ── ORCH-0684 ch06+: call pool-only RPC (now personalization-aware) ────
    const excludeUuids: string[] = Array.isArray(excludeCardIds)
      ? excludeCardIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
      : [];

    const rpcStart = Date.now();
    const { data: rpcRows, error: rpcError } = await adminClient.rpc(
      "query_person_hero_places_by_signal",
      {
        p_user_id: userId,
        p_person_id: effectivePersonId,
        p_lat: location.latitude,
        p_lng: location.longitude,
        p_signal_ids: signalIds,
        p_exclude_place_ids: excludeUuids,
        p_initial_radius_m: initialRadius,
        p_max_radius_m: maxRadius,
        p_per_signal_limit: 3,
        p_total_limit: 9,
      },
    );
    const rpcDurationMs = Date.now() - rpcStart;

    if (rpcError) {
      const isTimeout = (rpcError as { code?: string }).code === '57014';
      console.error(
        "[get-person-hero-cards] RPC error:",
        JSON.stringify({
          code: (rpcError as { code?: string }).code,
          message: (rpcError as { message?: string }).message,
          duration_ms: rpcDurationMs,
          signal_count: signalIds.length,
          isTimeout,
        }),
      );
      return new Response(
        JSON.stringify({ error: isTimeout ? "rpc_timeout" : "rpc_failed" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: isTimeout ? 503 : 500,
        },
      );
    }

    console.log(
      "[get-person-hero-cards] RPC duration:",
      rpcDurationMs,
      "ms, signal_count:",
      signalIds.length,
      "rows:",
      (rpcRows ?? []).length,
    );

    // --- Map RPC rows to single Cards (ORCH-0684 RC-1 fix) ---
    type RpcRow = {
      place: PlacePoolRow;
      signal_id: string;
      signal_score: number | string;
      total_available: number | string;
      distance_m: number | string;
      personalization_boost: number | string | null;
      boost_reasons: string[] | null;
    };
    const rows: RpcRow[] = (rpcRows ?? []) as RpcRow[];
    let singles: Card[] = rows.map((row) =>
      mapPlacePoolRowToCard(
        row.place,
        row.signal_id,
        Number(row.signal_score),
        Number(row.distance_m),
      ),
    );
    let totalAvailable = rows.length > 0 ? Number(rows[0].total_available) : 0;

    // Optional telemetry log of personalization boost activity
    const boostedCount = rows.filter((r) =>
      Array.isArray(r.boost_reasons) && r.boost_reasons.length > 0
    ).length;
    if (boostedCount > 0) {
      console.log(
        `[get-person-hero-cards] personalization: ${boostedCount} of ${rows.length} cards received boost`,
      );
    }

    // --- Apply price tier filter (ORCH-0684 HF-4 fix: null priceTier passes through) ---
    if (priceTierFilter && priceTierFilter.length > 0) {
      const beforeCount = singles.length;
      singles = singles.filter(
        (c) => c.cardType === "curated"
          || c.priceTier === null
          || priceTierFilter!.includes(c.priceTier),
      );
      if (singles.length < beforeCount) {
        console.log(
          `[get-person-hero-cards] Price tier filter removed ${beforeCount - singles.length} cards`,
        );
        totalAvailable = Math.max(0, totalAvailable - (beforeCount - singles.length));
      }
    }

    // --- Trim singles to composition.singlesMax (after combo) ---
    const trimmedSingles = singles.slice(0, composition.singlesMax);

    // --- ORCH-0684 RC-2 fix: plan combo per D-Q1 holiday rule ---
    const { combo, emptyReason: comboEmptyReason } = await planComboForHoliday({
      authHeader,
      composition,
      location,
      excludeCardIds: Array.isArray(excludeCardIds) ? excludeCardIds : [],
      supabaseUrl,
    });

    // --- Compose final array: combo first, then singles in score order ---
    let cards: Card[] = combo
      ? [combo, ...trimmedSingles]
      : [...trimmedSingles];

    console.log(
      `[get-person-hero-cards] Composed ${cards.length} cards — types: [${cards.map(c => c.cardType).join(", ")}], composition.holidayKey=${composition.holidayKey}`,
    );

    // --- Final dedup safety net (prevents any source of duplicate IDs) ---
    {
      const seen = new Set<string>();
      cards = cards.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    }

    // ── Impressions write — fire-and-forget (place_pool_id keyed) ─────────
    const singleCardsForImpression = cards.filter((c) => c.cardType === "single");
    if (singleCardsForImpression.length > 0) {
      const impressionRows = singleCardsForImpression.map((card) => ({
        user_id: userId,
        ...(usingPairedUser
          ? { paired_user_id: effectivePersonId }
          : { person_id: effectivePersonId }
        ),
        place_pool_id: card.id,
        holiday_key: holidayKey,
      }));

      adminClient
        .from("person_card_impressions")
        .upsert(impressionRows, {
          onConflict: usingPairedUser
            ? "user_id,paired_user_id,place_pool_id"
            : "user_id,person_id,place_pool_id",
          ignoreDuplicates: true,
        })
        .then(({ error }: { error: { message?: string } | null }) => {
          if (error) console.warn("[get-person-hero-cards] Impression insert error:", error);
        });
    }

    // --- Build response with optional emptyReason (mirrors ORCH-0677) ---
    const hasMore = totalAvailable > singles.length;
    const responseBody: {
      cards: Card[];
      hasMore: boolean;
      summary?: { emptyReason: string };
    } = { cards, hasMore };
    if (cards.length === 0) {
      responseBody.summary = { emptyReason: 'no_viable_results' };
    } else if (comboEmptyReason && composition.comboCount > 0) {
      // We have singles but the combo branch came up empty.
      responseBody.summary = { emptyReason: comboEmptyReason };
    }

    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
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
