import { resolveCategories, mapPrimaryTypeToMinglaCategory, mapCategoryToSlug, SLUG_TO_DISPLAY } from "./categoryPlaceTypes.ts";
import { googleLevelToTierSlug, type PriceTierSlug } from "./priceTiers.ts";
import { getCompositionForHolidayKey, COMBO_EMPTY_REASON, type CompositionRule } from "./personHeroComposition.ts";
import { TRAVEL_CONFIG } from "./distanceMath.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PersonHeroSectionRequest {
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  isCustomHoliday?: boolean;
  yearsElapsed?: number;
}

export interface FriendLocation {
  lat: number;
  lng: number;
  capturedAt: string | null;
}

export interface Card {
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
  isOpenNow?: boolean | null;
  distanceM?: number | null;
  signalId?: string | null;
  signalScore?: number | null;
}

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

interface PreferenceContext {
  effectiveMode: "default" | "shuffle" | "bilateral" | "individual";
  blendedCategories: string[];
  priceTierFilter: string[] | null;
  initialRadius: number;
  maxRadius: number;
}

const DISTANCE_RADIUS_MAP: Record<string, { initial: number; max: number }> = {
  walking: { initial: 5000, max: 15000 },
  near: { initial: 15000, max: 30000 },
  medium: { initial: 25000, max: 50000 },
  far: { initial: 40000, max: 100000 },
};

const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ["icebreakers", "drinks_and_music", "nature", "upscale_fine_dining"],
  adventurous: [
    "nature",
    "play",
    "creative_arts",
    "brunch_lunch_casual",
    "drinks_and_music",
    "icebreakers",
    "movies_theatre",
    "flowers",
  ],
  friendly: [
    "play",
    "brunch_lunch_casual",
    "drinks_and_music",
    "nature",
    "creative_arts",
    "movies_theatre",
  ],
};

const CATEGORY_SLUG_TO_SIGNAL_ID: Record<string, string> = {
  upscale_fine_dining: "fine_dining",
  drinks_and_music: "drinks",
  brunch_lunch_casual: "casual_food",
  nature: "nature",
  play: "play",
  creative_arts: "creative_arts",
  movies_theatre: "movies",
  icebreakers: "icebreakers",
  flowers: "flowers",
};

const SIGNAL_ID_TO_CATEGORY_SLUG: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [slug, sig] of Object.entries(CATEGORY_SLUG_TO_SIGNAL_ID)) out[sig] = slug;
  out.brunch = "brunch_lunch_casual";
  out.theatre = "movies_theatre";
  out.casual_food = "brunch_lunch_casual";
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

function signalIdsToCategorySlugs(signalIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sig of signalIds) {
    const slug = SIGNAL_ID_TO_CATEGORY_SLUG[sig];
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

function firstStopField(raw: Record<string, unknown>, key: string): unknown {
  const stops = raw.stops;
  if (!Array.isArray(stops)) return null;
  const stop = stops.find((item) => {
    if (!item || typeof item !== "object") return false;
    const value = (item as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0;
  });
  return stop && typeof stop === "object"
    ? (stop as Record<string, unknown>)[key]
    : null;
}

function coalesceNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function mapPlacePoolRowToCard(
  raw: PlacePoolRow,
  signalId: string,
  signalScore: number,
  distanceM: number,
): Card {
  const category = mapPrimaryTypeToMinglaCategory(raw.primary_type, raw.types ?? []) ?? "";
  const categorySlug = category ? mapCategoryToSlug(category) : "";
  const imageUrl =
    raw.stored_photo_urls &&
    raw.stored_photo_urls.length > 0 &&
    raw.stored_photo_urls[0] !== "__backfill_failed__"
      ? raw.stored_photo_urls[0]
      : null;
  const priceTier: PriceTierSlug | null = raw.price_level
    ? googleLevelToTierSlug(raw.price_level)
    : null;
  const isOpenNow =
    raw.opening_hours && typeof raw.opening_hours.openNow === "boolean"
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
    tagline: null,
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

export function curatedCardToCard(raw: Record<string, unknown>, experienceType: string): Card {
  const stopsArr = raw.stops;
  const stopsCount = Array.isArray(stopsArr) ? stopsArr.length : 0;
  const priceTier =
    (raw.priceTier as PriceTierSlug | null) ??
    (raw.price_tier as PriceTierSlug | null) ??
    (firstStopField(raw, "priceTier") as PriceTierSlug | null) ??
    null;

  return {
    id: (raw.id as string) ?? (raw.experience_id as string) ?? "",
    title: (raw.title as string) ?? "",
    category: (raw.categoryLabel as string) ?? (raw.category as string) ?? "Curated",
    categorySlug: (raw.categorySlug as string) ?? (raw.category_slug as string) ?? "curated",
    imageUrl:
      (raw.imageUrl as string) ??
      (raw.image_url as string) ??
      (firstStopField(raw, "imageUrl") as string | null) ??
      null,
    rating: (raw.rating as number) ?? null,
    priceLevel: (raw.priceLevel as string) ?? (raw.price_level as string) ?? null,
    address: (raw.address as string) ?? null,
    googlePlaceId: (raw.googlePlaceId as string) ?? (raw.google_place_id as string) ?? null,
    lat: (raw.lat as number) ?? null,
    lng: (raw.lng as number) ?? null,
    priceTier,
    description: (raw.description as string) ?? null,
    cardType: "curated",
    tagline: (raw.tagline as string) ?? null,
    stops: stopsCount,
    stopsData: Array.isArray(stopsArr) ? stopsArr : null,
    totalPriceMin: coalesceNumber(raw.totalPriceMin, raw.total_price_min),
    totalPriceMax: coalesceNumber(raw.totalPriceMax, raw.total_price_max),
    website: (raw.website as string) ?? null,
    estimatedDurationMinutes: coalesceNumber(
      raw.estimatedDurationMinutes,
      raw.estimated_duration_minutes,
    ),
    experienceType,
    categories: Array.isArray(raw.categories) ? (raw.categories as string[]) : null,
    shoppingList: Array.isArray(raw.shoppingList)
      ? (raw.shoppingList as unknown[])
      : Array.isArray(raw.shopping_list)
        ? (raw.shopping_list as unknown[])
        : null,
  };
}

export function resolveSignalIds(blendedCategories: string[]): string[] {
  const signalIds = Array.from(
    new Set(
      blendedCategories
        .flatMap((slug: string) => INTENT_CATEGORY_MAP[slug] ?? [slug])
        .map((slug: string) => CATEGORY_SLUG_TO_SIGNAL_ID[slug])
        .filter(Boolean),
    ),
  );
  if (blendedCategories.includes("brunch_lunch_casual") && !signalIds.includes("brunch")) {
    signalIds.push("brunch");
  }
  if (blendedCategories.includes("movies_theatre") && !signalIds.includes("theatre")) {
    signalIds.push("theatre");
  }
  return signalIds;
}

export function resolveHolidayCategorySlugs(section: PersonHeroSectionRequest): string[] {
  const providedSlugs = Array.isArray(section.categorySlugs)
    ? section.categorySlugs.filter((slug): slug is string => typeof slug === "string" && slug.length > 0)
    : [];
  const providedSignals = resolveSignalIds(providedSlugs);
  const composition = getCompositionForHolidayKey({
    holidayKey: section.holidayKey,
    isCustomHoliday: !!section.isCustomHoliday,
    yearsElapsed: section.yearsElapsed,
    resolvedSectionSignals: providedSignals,
  });
  const compositionSlugs = signalIdsToCategorySlugs(
    composition.singlesSectionBias.length > 0
      ? composition.singlesSectionBias
      : composition.comboAnchors,
  );
  if (compositionSlugs.length > 0) return compositionSlugs;
  if (providedSlugs.length > 0) return providedSlugs;
  return ["upscale_fine_dining", "play", "drinks_and_music"];
}

export async function resolveFriendLocation(
  adminClient: any,
  viewerId: string,
  friendId: string,
): Promise<FriendLocation | null> {
  const { data, error } = await adminClient.rpc("get_paired_friend_last_location", {
    p_viewer_id: viewerId,
    p_friend_id: friendId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (
    !row ||
    typeof row.latitude !== "number" ||
    typeof row.longitude !== "number"
  ) {
    return null;
  }
  return {
    lat: row.latitude,
    lng: row.longitude,
    capturedAt: typeof row.captured_at === "string" ? row.captured_at : null,
  };
}

export async function resolveBlendedPreferences(args: {
  adminClient: any;
  viewerId: string;
  pairedUserId: string;
  categorySlugs: string[];
  mode?: "default" | "shuffle" | "bilateral" | "individual";
  isCustomHoliday?: boolean;
  viewerUserId?: string;
}): Promise<PreferenceContext> {
  const {
    adminClient,
    viewerId,
    pairedUserId,
    categorySlugs,
    isCustomHoliday,
    viewerUserId,
  } = args;
  let effectiveMode: PreferenceContext["effectiveMode"] = args.mode ?? "default";
  let blendedCategories = categorySlugs;
  let priceTierFilter: string[] | null = null;
  let initialRadius = 15000;
  let maxRadius = 100000;

  if (effectiveMode === "default") {
    const PREF_THRESHOLD = 10;
    try {
      const [{ count: viewerCount }, { count: pairedCount }] = await Promise.all([
        adminClient.from("user_preference_learning")
          .select("id", { count: "exact", head: true })
          .eq("user_id", viewerId)
          .gte("confidence", 0.15),
        adminClient.from("user_preference_learning")
          .select("id", { count: "exact", head: true })
          .eq("user_id", pairedUserId)
          .gte("confidence", 0.15),
      ]);
      if ((viewerCount ?? 0) >= PREF_THRESHOLD && (pairedCount ?? 0) >= PREF_THRESHOLD) {
        effectiveMode = "bilateral";
      }
    } catch (error) {
      console.warn("[personHeroCards] auto-bilateral check failed:", error);
    }
  }

  if (effectiveMode === "bilateral") {
    try {
      const [{ data: pairedPrefs }, { data: viewerPrefs }] = await Promise.all([
        adminClient.from("user_preference_learning")
          .select("preference_key, preference_value")
          .eq("user_id", pairedUserId)
          .eq("preference_type", "category")
          .gte("confidence", 0.15)
          .gt("preference_value", 0.4)
          .order("preference_value", { ascending: false })
          .limit(10),
        adminClient.from("user_preference_learning")
          .select("preference_key, preference_value")
          .eq("user_id", viewerId)
          .eq("preference_type", "category")
          .gte("confidence", 0.15)
          .gt("preference_value", 0.4)
          .order("preference_value", { ascending: false })
          .limit(10),
      ]);
      const pairedMap = new Map<string, number>();
      (pairedPrefs ?? []).forEach((p: { preference_key: string; preference_value: number }) =>
        pairedMap.set(p.preference_key, p.preference_value)
      );
      const viewerMap = new Map<string, number>();
      (viewerPrefs ?? []).forEach((p: { preference_key: string; preference_value: number }) =>
        viewerMap.set(p.preference_key, p.preference_value)
      );
      const intersection: { key: string; combined: number }[] = [];
      for (const [key, pairedVal] of pairedMap) {
        const viewerVal = viewerMap.get(key);
        if (viewerVal !== undefined) intersection.push({ key, combined: (pairedVal + viewerVal) / 2 });
      }
      intersection.sort((a, b) => b.combined - a.combined);
      if (intersection.length >= 3) {
        blendedCategories = intersection.slice(0, 6).map((item) => item.key);
      } else {
        const used = new Set(intersection.map((item) => item.key));
        const pairedExtra = (pairedPrefs ?? [])
          .filter((p: { preference_key: string }) => !used.has(p.preference_key))
          .slice(0, 6 - intersection.length)
          .map((p: { preference_key: string }) => p.preference_key);
        blendedCategories = [...intersection.map((item) => item.key), ...pairedExtra];
      }
    } catch (error) {
      console.warn("[personHeroCards] bilateral blend failed:", error);
    }
  } else if (isCustomHoliday && viewerUserId) {
    try {
      const [{ data: pairedPrefs }, { data: creatorPrefs }] = await Promise.all([
        adminClient.from("user_preference_learning")
          .select("preference_key, preference_value")
          .eq("user_id", pairedUserId)
          .eq("preference_type", "category")
          .gte("confidence", 0.15)
          .gt("preference_value", 0.4)
          .order("preference_value", { ascending: false })
          .limit(5),
        adminClient.from("user_preference_learning")
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
      for (const p of pairedPrefs ?? []) {
        if (!seen.has(p.preference_key)) {
          seen.add(p.preference_key);
          blended.push(p.preference_key);
        }
      }
      for (const p of creatorPrefs ?? []) {
        if (!seen.has(p.preference_key) && blended.length < 10) {
          seen.add(p.preference_key);
          blended.push(p.preference_key);
        }
      }
      for (const slug of categorySlugs) {
        if (!seen.has(slug) && blended.length < 10) {
          seen.add(slug);
          blended.push(slug);
        }
      }
      if (blended.length > 0) blendedCategories = blended;
    } catch (error) {
      console.warn("[personHeroCards] custom blend failed:", error);
    }
  } else if (effectiveMode === "shuffle") {
    try {
      const [swipeResult, categoryPrefs, pricePrefs1, pricePrefs2, distancePrefs] = await Promise.all([
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
          .eq("user_id", viewerId)
          .eq("preference_type", "price_tier")
          .gte("confidence", 0.15)
          .gt("preference_value", 0.5)
          .order("preference_value", { ascending: false })
          .limit(2),
        adminClient.from("user_preference_learning")
          .select("preference_key")
          .eq("user_id", pairedUserId)
          .eq("preference_type", "distance")
          .gte("confidence", 0.15)
          .gt("preference_value", 0.5)
          .order("preference_value", { ascending: false })
          .limit(1),
      ]);
      if ((swipeResult.count ?? 0) >= 10 && categoryPrefs.data?.length) {
        blendedCategories = categoryPrefs.data.map((p: { preference_key: string }) => p.preference_key);
      } else {
        blendedCategories = [...categorySlugs].sort(() => Math.random() - 0.5);
      }
      const priceSet = new Set<string>();
      for (const p of pricePrefs1.data ?? []) priceSet.add(p.preference_key);
      for (const p of pricePrefs2.data ?? []) priceSet.add(p.preference_key);
      if (priceSet.size > 0) priceTierFilter = [...priceSet];
      const distBucket = distancePrefs.data?.[0]?.preference_key;
      if (distBucket && DISTANCE_RADIUS_MAP[distBucket]) {
        initialRadius = DISTANCE_RADIUS_MAP[distBucket].initial;
        maxRadius = DISTANCE_RADIUS_MAP[distBucket].max;
      }
    } catch (error) {
      console.warn("[personHeroCards] shuffle blend failed:", error);
    }
  } else {
    try {
      const { data: learnedPrefs } = await adminClient.from("user_preference_learning")
        .select("preference_key, preference_value")
        .eq("user_id", pairedUserId)
        .eq("preference_type", "category")
        .gte("confidence", 0.15)
        .gt("preference_value", 0)
        .order("preference_value", { ascending: false })
        .limit(10);
      if (learnedPrefs?.length) {
        const existingSlugs = new Set(categorySlugs);
        const topLearned = learnedPrefs
          .map((p: { preference_key: string }) => p.preference_key)
          .filter((key: string) => !existingSlugs.has(key))
          .slice(0, 3);
        blendedCategories = [...categorySlugs, ...topLearned];
      }
    } catch (error) {
      console.warn("[personHeroCards] default blend failed:", error);
    }
  }

  if (!isCustomHoliday && effectiveMode !== "shuffle") {
    try {
      const [{ data: pricePrefs }, { data: distancePrefs }] = await Promise.all([
        adminClient.from("user_preference_learning")
          .select("preference_key, preference_value")
          .eq("user_id", pairedUserId)
          .eq("preference_type", "price_tier")
          .gte("confidence", 0.15)
          .gt("preference_value", 0.5)
          .order("preference_value", { ascending: false })
          .limit(2),
        adminClient.from("user_preference_learning")
          .select("preference_key, preference_value")
          .eq("user_id", pairedUserId)
          .eq("preference_type", "distance")
          .gte("confidence", 0.15)
          .gt("preference_value", 0.5)
          .order("preference_value", { ascending: false })
          .limit(1),
      ]);
      if (pricePrefs?.length && !priceTierFilter) {
        priceTierFilter = pricePrefs.map((p: { preference_key: string }) => p.preference_key);
      }
      const distBucket = distancePrefs?.[0]?.preference_key;
      if (distBucket && DISTANCE_RADIUS_MAP[distBucket]) {
        initialRadius = DISTANCE_RADIUS_MAP[distBucket].initial;
        maxRadius = DISTANCE_RADIUS_MAP[distBucket].max;
      }
    } catch (error) {
      console.warn("[personHeroCards] distance/price prefs failed:", error);
    }
  }

  return { effectiveMode, blendedCategories, priceTierFilter, initialRadius, maxRadius };
}

export async function planComboForHoliday(args: {
  authHeader: string;
  composition: CompositionRule;
  location: { latitude: number; longitude: number };
  excludeCardIds: string[];
  supabaseUrl: string;
  initialRadiusM: number;
}): Promise<{ combo: Card | null; emptyReason: string | null }> {
  if (args.composition.comboCount === 0) return { combo: null, emptyReason: null };

  const displayCategories = signalIdsToDisplayCategories(args.composition.comboAnchors);
  if (displayCategories.length === 0) return { combo: null, emptyReason: COMBO_EMPTY_REASON };

  const driving = TRAVEL_CONFIG.driving;
  const targetMinutes = Math.max(
    20,
    Math.min(30, Math.round(((args.initialRadiusM / 1000) / (driving.speed * driving.factor)) * 60)),
  );

  try {
    const response = await fetch(`${args.supabaseUrl}/functions/v1/generate-curated-experiences`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: args.authHeader,
      },
      body: JSON.stringify({
        categories: displayCategories,
        experienceTypes: [args.composition.experienceType],
        location: { lat: args.location.latitude, lng: args.location.longitude },
        travelMode: "driving",
        travelConstraintValue: targetMinutes,
        dateOption: "today",
        batchSeed: 0,
        limit: 5,
        skipDescriptions: true,
        excludeCardIds: args.excludeCardIds,
        excludePlacePoolIds: args.excludeCardIds,
      }),
    });
    if (!response.ok) {
      console.warn(`[personHeroCards] combo planner non-ok: ${response.status}`);
      return { combo: null, emptyReason: COMBO_EMPTY_REASON };
    }
    const body = await response.json();
    const cards = Array.isArray(body?.cards) ? body.cards : [];
    const curatedOnly = cards.filter(
      (card: { cardType?: string; card_type?: string; stops?: unknown }) =>
        card.cardType === "curated" ||
        card.card_type === "curated" ||
        (Array.isArray(card.stops) && card.stops.length > 1) ||
        (typeof card.stops === "number" && card.stops > 1),
    );
    if (curatedOnly.length === 0) return { combo: null, emptyReason: COMBO_EMPTY_REASON };
    return {
      combo: curatedCardToCard(curatedOnly[0], args.composition.experienceType),
      emptyReason: null,
    };
  } catch (error) {
    console.warn("[personHeroCards] combo planner threw:", error);
    return { combo: null, emptyReason: COMBO_EMPTY_REASON };
  }
}

export async function buildPersonHeroCardsForSection(args: {
  adminClient: any;
  authHeader: string;
  supabaseUrl: string;
  viewerId: string;
  pairedUserId: string;
  viewerUserId?: string;
  section: PersonHeroSectionRequest;
  location: { latitude: number; longitude: number };
  mode?: "default" | "shuffle" | "bilateral" | "individual";
  excludeCardIds?: string[];
  preferenceContext?: PreferenceContext;
}): Promise<{ cards: Card[]; hasMore: boolean; summary?: { emptyReason: string } }> {
  const { adminClient, viewerId, pairedUserId, location } = args;
  const section = {
    ...args.section,
    categorySlugs: resolveHolidayCategorySlugs(args.section),
  };
  const preferenceContext = args.preferenceContext ??
    await resolveBlendedPreferences({
      adminClient,
      viewerId,
      pairedUserId,
      viewerUserId: args.viewerUserId,
      categorySlugs: section.categorySlugs,
      mode: args.mode,
      isCustomHoliday: section.isCustomHoliday,
    });

  const signalIds = resolveSignalIds(preferenceContext.blendedCategories);
  if (signalIds.length === 0) {
    return { cards: [], hasMore: false, summary: { emptyReason: "no_signals_resolved" } };
  }

  const expandedSlugs = preferenceContext.blendedCategories.flatMap((slug) =>
    INTENT_CATEGORY_MAP[slug] ?? [slug]
  );
  const resolvedCategories = resolveCategories(expandedSlugs);
  if (resolvedCategories.length === 0) {
    resolvedCategories.push("Brunch, Lunch & Casual", "Upscale & Fine Dining", "Play");
  }

  const composition = getCompositionForHolidayKey({
    holidayKey: section.holidayKey,
    isCustomHoliday: !!section.isCustomHoliday,
    yearsElapsed: section.yearsElapsed,
    resolvedSectionSignals: signalIds,
  });

  const excludeUuids = Array.isArray(args.excludeCardIds)
    ? args.excludeCardIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];

  const { data: rpcRows, error: rpcError } = await adminClient.rpc(
    "query_person_hero_places_by_signal",
    {
      p_user_id: viewerId,
      p_person_id: pairedUserId,
      p_lat: location.latitude,
      p_lng: location.longitude,
      p_signal_ids: signalIds,
      p_exclude_place_ids: excludeUuids,
      p_initial_radius_m: preferenceContext.initialRadius,
      p_max_radius_m: preferenceContext.maxRadius,
      p_per_signal_limit: 3,
      p_total_limit: 9,
    },
  );
  if (rpcError) throw rpcError;

  type RpcRow = {
    place: PlacePoolRow;
    signal_id: string;
    signal_score: number | string;
    total_available: number | string;
    distance_m: number | string;
  };
  const rows: RpcRow[] = (rpcRows ?? []) as RpcRow[];
  let singles = rows.map((row) =>
    mapPlacePoolRowToCard(
      row.place,
      row.signal_id,
      Number(row.signal_score),
      Number(row.distance_m),
    )
  );
  let totalAvailable = rows.length > 0 ? Number(rows[0].total_available) : 0;

  if (preferenceContext.priceTierFilter?.length) {
    const beforeCount = singles.length;
    singles = singles.filter((card) =>
      card.priceTier === null ||
      preferenceContext.priceTierFilter!.includes(card.priceTier)
    );
    totalAvailable = Math.max(0, totalAvailable - (beforeCount - singles.length));
  }

  const trimmedSingles = singles.slice(0, composition.singlesMax);
  const { combo, emptyReason: comboEmptyReason } = await planComboForHoliday({
    authHeader: args.authHeader,
    composition,
    location,
    excludeCardIds: Array.isArray(args.excludeCardIds) ? args.excludeCardIds : [],
    supabaseUrl: args.supabaseUrl,
    initialRadiusM: preferenceContext.initialRadius,
  });

  let cards: Card[] = combo ? [combo, ...trimmedSingles] : [...trimmedSingles];
  const seen = new Set<string>();
  cards = cards.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });

  const hasMore = totalAvailable > singles.length;
  if (cards.length === 0) {
    return { cards, hasMore, summary: { emptyReason: "no_viable_results" } };
  }
  if (comboEmptyReason && composition.comboCount > 0) {
    return { cards, hasMore, summary: { emptyReason: comboEmptyReason } };
  }
  return { cards, hasMore };
}

export function recordPersonCardImpressions(args: {
  adminClient: any;
  viewerId: string;
  pairedUserId: string;
  holidayKey: string;
  cards: Card[];
}) {
  const singleCards = args.cards.filter((card) => card.cardType === "single");
  if (singleCards.length === 0) return;
  const rows = singleCards.map((card) => ({
    user_id: args.viewerId,
    paired_user_id: args.pairedUserId,
    place_pool_id: card.id,
    holiday_key: args.holidayKey,
  }));
  args.adminClient
    .from("person_card_impressions")
    .upsert(rows, {
      onConflict: "user_id,paired_user_id,place_pool_id",
      ignoreDuplicates: true,
    })
    .then(({ error }: { error: { message?: string } | null }) => {
      if (error) console.warn("[personHeroCards] Impression insert error:", error);
    });
}
