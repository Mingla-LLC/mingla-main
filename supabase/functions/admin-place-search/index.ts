import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timeoutFetch } from "../_shared/timeoutFetch.ts";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ORCH-0550.1 — Mirrors admin-seed-places.FIELD_MASK (48 fields) plus
// `places.addressComponents` (needed locally in handleSearch to extract
// country + countryCode). Kept as a benign superset per spec §4:
// admin-place-search requests identical signal data as bulk seeding.
//
// I-FIELD-MASK-SINGLE-OWNER: admin-seed-places is authoritative; this list
// mirrors it. If you add a field there, add it here.
const FIELD_MASK = [
  // Identity
  "places.id",
  "places.displayName",
  "places.primaryTypeDisplayName",
  "places.formattedAddress",
  "places.addressComponents", // local: country extraction in handleSearch
  "places.location",
  "places.types",
  "places.primaryType",

  // Ratings & price
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.priceRange",

  // Hours & photos
  "places.regularOpeningHours",
  "places.secondaryOpeningHours",
  "places.utcOffsetMinutes",
  "places.photos",

  // Links
  "places.websiteUri",
  "places.googleMapsUri",
  "places.nationalPhoneNumber",

  // Operational state
  "places.businessStatus",

  // Content (AI-heavy)
  "places.editorialSummary",
  "places.generativeSummary",
  "places.reviews",

  // Meal service booleans
  "places.servesBrunch",
  "places.servesLunch",
  "places.servesDinner",
  "places.servesBreakfast",
  "places.servesBeer",
  "places.servesWine",
  "places.servesCocktails",
  "places.servesCoffee",
  "places.servesDessert",
  "places.servesVegetarianFood",

  // Ambience & amenities
  "places.outdoorSeating",
  "places.liveMusic",
  "places.goodForGroups",
  "places.goodForChildren",
  "places.goodForWatchingSports",
  "places.allowsDogs",
  "places.restroom",
  "places.reservable",
  "places.menuForChildren",

  // Service options
  "places.dineIn",
  "places.takeout",
  "places.delivery",
  "places.curbsidePickup",

  // Access & facilities
  "places.accessibilityOptions",
  "places.parkingOptions",
  "places.paymentOptions",
].join(",");

// RELIABILITY: These ranges MUST match app-mobile/src/constants/priceTiers.ts
// and supabase/functions/_shared/priceTiers.ts. All three are the same source of truth.
// If you change ranges here, update both other files. If they disagree, the client
// tier constants win — they're what users see.
const PRICE_LEVEL_MAP: Record<string, { tier: string; min: number; max: number }> = {
  PRICE_LEVEL_FREE: { tier: "chill", min: 0, max: 0 },
  PRICE_LEVEL_INEXPENSIVE: { tier: "chill", min: 0, max: 50 },
  PRICE_LEVEL_MODERATE: { tier: "comfy", min: 50, max: 150 },
  PRICE_LEVEL_EXPENSIVE: { tier: "bougie", min: 150, max: 300 },
  PRICE_LEVEL_VERY_EXPENSIVE: { tier: "lavish", min: 300, max: 500 },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ORCH-0550.1 — Mirrors admin-seed-places.transformGooglePlaceForSeed.
// Any new Google field added there must also be persisted here, otherwise the
// admin-search → push path would leave new columns NULL on first-touch rows.
function transformGooglePlace(gPlace: Record<string, unknown>) {
  const priceLevel = gPlace.priceLevel as string | undefined;
  const priceInfo = PRICE_LEVEL_MAP[priceLevel ?? ""] ?? {
    tier: null,
    min: 0,
    max: 0,
  };
  const displayName = gPlace.displayName as
    | { text?: string }
    | undefined;
  const location = gPlace.location as
    | { latitude?: number; longitude?: number }
    | undefined;
  const photos = (gPlace.photos ?? []) as Array<{
    name?: string;
    widthPx?: number;
    heightPx?: number;
  }>;

  const editorialSummaryText =
    (gPlace.editorialSummary as { text?: string } | undefined)?.text ?? null;
  const generativeSummaryText =
    (gPlace.generativeSummary as { overview?: { text?: string } } | undefined)?.overview?.text ?? null;
  const primaryTypeDisplayNameText =
    (gPlace.primaryTypeDisplayName as { text?: string } | undefined)?.text ?? null;

  const priceRange = gPlace.priceRange as
    | {
        startPrice?: { currencyCode?: string; units?: string };
        endPrice?: { currencyCode?: string; units?: string };
      }
    | undefined;
  const priceRangeCurrency =
    priceRange?.startPrice?.currencyCode ?? priceRange?.endPrice?.currencyCode ?? null;
  const priceRangeStartCents = priceRange?.startPrice?.units
    ? parseInt(priceRange.startPrice.units, 10) * 100
    : null;
  const priceRangeEndCents = priceRange?.endPrice?.units
    ? parseInt(priceRange.endPrice.units, 10) * 100
    : null;

  return {
    google_place_id: gPlace.id as string,
    name: displayName?.text ?? "Unknown",
    address: (gPlace.formattedAddress as string) ?? null,
    lat: location?.latitude ?? 0,
    lng: location?.longitude ?? 0,
    types: (gPlace.types as string[]) ?? [],
    primary_type: (gPlace.primaryType as string) ?? null,
    primary_type_display_name: primaryTypeDisplayNameText,
    rating: (gPlace.rating as number) ?? null,
    review_count: (gPlace.userRatingCount as number) ?? 0,
    price_level: priceLevel ?? null,
    price_min: priceInfo.min,
    price_max: priceInfo.max,
    price_tier: priceInfo.tier,
    price_tiers: priceInfo.tier ? [priceInfo.tier] : [],
    price_range_currency: priceRangeCurrency,
    price_range_start_cents: priceRangeStartCents,
    price_range_end_cents: priceRangeEndCents,
    opening_hours: gPlace.regularOpeningHours ?? null,
    secondary_opening_hours: gPlace.secondaryOpeningHours ?? null,
    photos: photos.map((p) => ({
      name: p.name,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
    })),
    website: (gPlace.websiteUri as string) ?? null,
    google_maps_uri: (gPlace.googleMapsUri as string) ?? null,
    national_phone_number: (gPlace.nationalPhoneNumber as string) ?? null,
    business_status: (gPlace.businessStatus as string) ?? null,
    editorial_summary: editorialSummaryText,
    generative_summary: generativeSummaryText,
    reviews: gPlace.reviews ?? null,
    utc_offset_minutes: (gPlace.utcOffsetMinutes as number) ?? null,

    // Meal service booleans
    serves_brunch: gPlace.servesBrunch ?? null,
    serves_lunch: gPlace.servesLunch ?? null,
    serves_dinner: gPlace.servesDinner ?? null,
    serves_breakfast: gPlace.servesBreakfast ?? null,
    serves_beer: gPlace.servesBeer ?? null,
    serves_wine: gPlace.servesWine ?? null,
    serves_cocktails: gPlace.servesCocktails ?? null,
    serves_coffee: gPlace.servesCoffee ?? null,
    serves_dessert: gPlace.servesDessert ?? null,
    serves_vegetarian_food: gPlace.servesVegetarianFood ?? null,

    // Ambience & amenities
    outdoor_seating: gPlace.outdoorSeating ?? null,
    live_music: gPlace.liveMusic ?? null,
    good_for_groups: gPlace.goodForGroups ?? null,
    good_for_children: gPlace.goodForChildren ?? null,
    good_for_watching_sports: gPlace.goodForWatchingSports ?? null,
    allows_dogs: gPlace.allowsDogs ?? null,
    has_restroom: gPlace.restroom ?? null,
    reservable: gPlace.reservable ?? null,
    menu_for_children: gPlace.menuForChildren ?? null,

    // Service options
    dine_in: gPlace.dineIn ?? null,
    takeout: gPlace.takeout ?? null,
    delivery: gPlace.delivery ?? null,
    curbside_pickup: gPlace.curbsidePickup ?? null,

    // Access & facilities (JSONB)
    accessibility_options: gPlace.accessibilityOptions ?? null,
    parking_options: gPlace.parkingOptions ?? null,
    payment_options: gPlace.paymentOptions ?? null,

    raw_google_data: gPlace,
    fetched_via: "text_search",
    last_detail_refresh: new Date().toISOString(),
    refresh_failures: 0,
    is_active: true,
    seeding_category: null as string | null,
  };
}

// deno-lint-ignore no-explicit-any
async function handleSearch(body: any) {
  const { textQuery, city, country, postcode, maxResults, lat, lng, radius } = body;
  const locationParts = [city, postcode, country].filter(Boolean).join(", ");
  const fullQuery = textQuery
    ? `${textQuery} in ${locationParts}`
    : locationParts;

  if (!fullQuery.trim()) {
    throw new Error("At least one of city or country must be provided.");
  }

  // Build request body with optional locationBias
  // deno-lint-ignore no-explicit-any
  const requestBody: any = {
    textQuery: fullQuery,
    maxResultCount: Math.min(maxResults || 20, 20),
    languageCode: "en",
  };

  if (lat != null && lng != null && radius != null) {
    requestBody.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    };
  }

  const response = await timeoutFetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
      timeoutMs: 10000,
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  // deno-lint-ignore no-explicit-any
  const places = (data.places || []).map((p: any) => {
    // Extract country and country code from addressComponents
    // deno-lint-ignore no-explicit-any
    const countryComponent = (p.addressComponents || []).find((c: any) =>
      (c.types || []).includes("country")
    );
    return {
      googlePlaceId: p.id,
      name: p.displayName?.text || "Unknown",
      address: p.formattedAddress || "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      country: countryComponent?.longText || null,
      countryCode: countryComponent?.shortText || null,
      types: p.types || [],
      primaryType: p.primaryType || null,
      rating: p.rating || null,
      reviewCount: p.userRatingCount || 0,
      priceLevel: p.priceLevel || null,
      openingHours: p.regularOpeningHours || null,
      photos: (p.photos || []).map(
        (ph: { name?: string; widthPx?: number; heightPx?: number }) => ({
          name: ph.name,
          widthPx: ph.widthPx,
          heightPx: ph.heightPx,
        })
      ),
      website: p.websiteUri || null,
      rawGoogleData: p,
    };
  });

  return { places, totalFound: places.length };
}

// deno-lint-ignore no-explicit-any
async function handlePush(body: any) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { places, seedingCategory, cityId } = body;

  if (!Array.isArray(places) || places.length === 0) {
    throw new Error("No places provided to push.");
  }

  // deno-lint-ignore no-explicit-any
  const rows = places.map((p: any) => {
    if (!p.rawGoogleData) {
      throw new Error(`Missing rawGoogleData for place: ${p.name || "unknown"}`);
    }
    const row = transformGooglePlace(p.rawGoogleData);
    // Apply seeding category from admin selection (or per-place override)
    if (p.seedingCategory || seedingCategory) {
      row.seeding_category = p.seedingCategory || seedingCategory;
    }
    // Link to canonical city if provided
    if (cityId) {
      row.city_id = cityId;
    }
    return row;
  });

  const { data, error } = await supabase
    .from("place_pool")
    .upsert(rows, { onConflict: "google_place_id", ignoreDuplicates: false })
    .select("google_place_id");

  if (error) {
    throw new Error(`Supabase upsert error: ${error.message}`);
  }

  return {
    total: data?.length || 0,
    failed: 0,
    errors: [],
  };
}

// NOTE: "refresh" action removed — use admin-refresh-places edge function instead.

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate the token belongs to a real user
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ADMIN CHECK ──────────────────────────────────────────────────
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();

    if (!adminRow) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // ── END ADMIN CHECK ──────────────────────────────────────────────

    const body = await req.json();
    let result;

    switch (body.action) {
      case "search":
        result = await handleSearch(body);
        break;
      case "push":
        result = await handlePush(body);
        break;
      // "refresh" action removed — use admin-refresh-places instead
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${body.action}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
