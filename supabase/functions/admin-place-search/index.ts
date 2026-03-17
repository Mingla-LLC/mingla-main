import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.regularOpeningHours",
  "places.photos",
  "places.websiteUri",
].join(",");

const DETAIL_FIELD_MASK =
  "id,displayName,formattedAddress,location,types,primaryType,rating,userRatingCount,priceLevel,regularOpeningHours,photos,websiteUri";

const PRICE_LEVEL_MAP: Record<string, { tier: string; min: number; max: number }> = {
  PRICE_LEVEL_FREE: { tier: "chill", min: 0, max: 0 },
  PRICE_LEVEL_INEXPENSIVE: { tier: "chill", min: 5, max: 15 },
  PRICE_LEVEL_MODERATE: { tier: "comfy", min: 15, max: 40 },
  PRICE_LEVEL_EXPENSIVE: { tier: "bougie", min: 40, max: 100 },
  PRICE_LEVEL_VERY_EXPENSIVE: { tier: "lavish", min: 100, max: 500 },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  return {
    google_place_id: gPlace.id as string,
    name: displayName?.text ?? "Unknown",
    address: (gPlace.formattedAddress as string) ?? null,
    lat: location?.latitude ?? 0,
    lng: location?.longitude ?? 0,
    types: (gPlace.types as string[]) ?? [],
    primary_type: (gPlace.primaryType as string) ?? null,
    rating: (gPlace.rating as number) ?? null,
    review_count: (gPlace.userRatingCount as number) ?? 0,
    price_level: priceLevel ?? null,
    price_min: priceInfo.min,
    price_max: priceInfo.max,
    price_tier: priceInfo.tier,
    opening_hours: gPlace.regularOpeningHours ?? null,
    photos: photos.map((p) => ({
      name: p.name,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
    })),
    website: (gPlace.websiteUri as string) ?? null,
    raw_google_data: gPlace,
    fetched_via: "text_search",
    last_detail_refresh: new Date().toISOString(),
    refresh_failures: 0,
    is_active: true,
  };
}

// deno-lint-ignore no-explicit-any
async function handleSearch(body: any) {
  const { textQuery, city, country, postcode, maxResults } = body;
  const locationParts = [city, postcode, country].filter(Boolean).join(", ");
  const fullQuery = textQuery
    ? `${textQuery} in ${locationParts}`
    : locationParts;

  if (!fullQuery.trim()) {
    throw new Error("At least one of city or country must be provided.");
  }

  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: fullQuery,
        maxResultCount: Math.min(maxResults || 20, 20),
        languageCode: "en",
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  // deno-lint-ignore no-explicit-any
  const places = (data.places || []).map((p: any) => ({
    googlePlaceId: p.id,
    name: p.displayName?.text || "Unknown",
    address: p.formattedAddress || "",
    lat: p.location?.latitude,
    lng: p.location?.longitude,
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
  }));

  return { places, totalFound: places.length };
}

// deno-lint-ignore no-explicit-any
async function handlePush(body: any) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { places } = body;

  if (!Array.isArray(places) || places.length === 0) {
    throw new Error("No places provided to push.");
  }

  // deno-lint-ignore no-explicit-any
  const rows = places.map((p: any) => {
    if (!p.rawGoogleData) {
      throw new Error(`Missing rawGoogleData for place: ${p.name || "unknown"}`);
    }
    return transformGooglePlace(p.rawGoogleData);
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

// deno-lint-ignore no-explicit-any
async function handleRefresh(body: any) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { googlePlaceIds } = body;

  if (!Array.isArray(googlePlaceIds) || googlePlaceIds.length === 0) {
    throw new Error("No place IDs provided to refresh.");
  }

  let refreshed = 0;
  const errors: string[] = [];

  for (const placeId of googlePlaceIds) {
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}?languageCode=en`,
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": DETAIL_FIELD_MASK,
          },
        }
      );

      if (!response.ok) {
        errors.push(`Failed to refresh ${placeId}: ${response.status}`);
        // Increment refresh_failures
        const { data: existing } = await supabase
          .from("place_pool")
          .select("refresh_failures")
          .eq("google_place_id", placeId)
          .single();
        await supabase
          .from("place_pool")
          .update({
            refresh_failures: (existing?.refresh_failures ?? 0) + 1,
          })
          .eq("google_place_id", placeId);
        continue;
      }

      const gPlace = await response.json();
      const transformed = transformGooglePlace(gPlace);
      // Don't overwrite first_fetched_at — only update refreshable fields
      const { ...updateFields } = transformed;

      await supabase
        .from("place_pool")
        .update(updateFields)
        .eq("google_place_id", placeId);

      refreshed++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Error refreshing ${placeId}: ${msg}`);
    }
  }

  return { refreshed, failed: errors.length, errors };
}

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
      case "refresh":
        result = await handleRefresh(body);
        break;
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
