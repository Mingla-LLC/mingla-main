// META-ORCH-1009 Sub-E — business-app supply-side feeder.
//
// Gemini structured JSON contract:
// https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash
// https://ai.google.dev/gemini-api/docs/structured-output

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { bounce } from "../_shared/bouncer.ts";

const GEMINI_MODEL = "gemini-2.5-flash";
const PROMPT_VERSION = "v4";
const FACET_COLUMNS = new Set([
  "serves_brunch",
  "serves_lunch",
  "serves_dinner",
  "serves_breakfast",
  "serves_beer",
  "serves_wine",
  "serves_cocktails",
  "serves_coffee",
  "serves_dessert",
  "serves_vegetarian_food",
  "outdoor_seating",
  "live_music",
  "good_for_groups",
  "good_for_children",
  "good_for_watching_sports",
  "allows_dogs",
  "has_restroom",
  "reservable",
  "menu_for_children",
  "dine_in",
  "takeout",
  "delivery",
  "curbside_pickup",
]);

type Action =
  | "upsert_tier1_place"
  | "run_tier2_pipeline"
  | "regenerate_sales_bio"
  | "confirm_ai_outputs"
  | "refresh_deck_readiness"
  | "get_authoring_context"
  | "sync_hero_media";
type VenueCategory = "restaurant" | "play" | "creative_and_arts";

interface Tier1Draft {
  name?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  countryCode?: string | null;
  venueCategory?: VenueCategory | null;
  coverMediaUrl?: string | null;
  coverMediaType?: "image" | "video" | "gif" | null;
  website?: string | null;
  openingHours?: unknown | null;
  hours?: unknown | null;
  photoUrls?: string[];
  tagline?: string | null;
  description?: string | null;
  priceTier?: string | null;
  vibeAnswers?: Record<string, unknown> | null;
}

interface RequestBody {
  action?: Action;
  brand_id?: string;
  selected_place_pool_id?: string | null;
  place_pool_id?: string | null;
  draft?: Tier1Draft;
  tier2?: Record<string, unknown>;
  sales_bio?: string;
  facets?: Record<string, boolean | null>;
  cover_media_url?: string | null;
  cover_media_type?: "image" | "video" | "gif" | null;
}

interface OwnedBrand {
  id: string;
  account_id: string;
  name: string | null;
  description: string | null;
  place_pool_id: string | null;
  google_place_id: string | null;
  venue_category: VenueCategory | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
}

interface SignalRow {
  id: string;
  label: string | null;
}

interface AiEvaluation {
  signal_id: string;
  score_0_to_100: number;
  inappropriate_for: boolean;
  reasoning: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { kind: "error", code, message });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function categoryTypes(category: VenueCategory | null | undefined): {
  primaryType: string;
  types: string[];
} {
  if (category === "play") {
    return { primaryType: "amusement_center", types: ["amusement_center"] };
  }
  if (category === "creative_and_arts") {
    return { primaryType: "art_gallery", types: ["art_gallery", "point_of_interest"] };
  }
  return { primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"] };
}

function coachingForReasons(reasons: string[]): Array<{
  code: string;
  title: string;
  body: string;
  fix: string;
}> {
  return reasons.map((reason) => {
    const code = reason.split(":")[0] ?? reason;
    switch (code) {
      case "B3":
        return {
          code,
          title: "Add the missing venue basics",
          body: "We need a venue name and map location before this can enter the deck.",
          fix: "edit_address",
        };
      case "B4":
        return {
          code,
          title: "Add your website",
          body: "Commercial venues need an official website so guests can verify the place.",
          fix: "edit_website",
        };
      case "B5":
        return {
          code,
          title: "Use an official domain",
          body: "A social-only link is not enough for deck readiness. Add the venue's own website.",
          fix: "edit_website",
        };
      case "B6":
        return {
          code,
          title: "Confirm opening hours",
          body: "We need clear hours before we can recommend this venue.",
          fix: "edit_hours",
        };
      case "B8":
        return {
          code,
          title: "Add a hero photo or video",
          body: "The deck needs at least one saved visual for this place.",
          fix: "edit_cover",
        };
      case "CONFIRM":
        return {
          code,
          title: "Confirm your AI bio",
          body: "Review the generated sales bio and approve it before it becomes public.",
          fix: "confirm_ai_outputs",
        };
      default:
        return {
          code,
          title: "Fix deck readiness",
          body: "This venue needs one more quality check before it can enter the deck.",
          fix: "review_pipeline",
        };
    }
  });
}

function fullStageStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    menu_ocr: "not_applicable_or_existing",
    activity_extraction: "not_applicable_or_existing",
    photo_analysis: "pending",
    sales_bio_generation: "pending_confirmation",
    structured_facet_inference: "pending_confirmation",
    signal_pre_evaluation: "pending",
    google_cross_validation: "not_applicable_or_pending",
    bouncer_servability: "pending",
    ...overrides,
  };
}

function placeForBouncer(
  placePoolId: string,
  place: Record<string, unknown>,
  tier2: Record<string, unknown> = {},
) {
  return {
    id: placePoolId,
    name: (place as { name?: string | null }).name ?? null,
    lat: (place as { lat?: number | null }).lat ?? null,
    lng: (place as { lng?: number | null }).lng ?? null,
    types: (place as { types?: string[] | null }).types ?? null,
    business_status: (place as { business_status?: string | null }).business_status ?? null,
    website: (tier2.website as string | undefined) ?? (place as { website?: string | null }).website ?? null,
    opening_hours: (place as { opening_hours?: unknown }).opening_hours ?? null,
    photos: (place as { photos?: unknown[] | null }).photos ?? null,
    stored_photo_urls: (place as { stored_photo_urls?: string[] | null }).stored_photo_urls ?? null,
    review_count: (place as { review_count?: number | null }).review_count ?? null,
    rating: (place as { rating?: number | null }).rating ?? null,
  };
}

async function requireUser(req: Request): Promise<
  | { userId: string; authHeader: string; serviceClient: SupabaseClient }
  | Response
> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return errorResponse(401, "UNAUTHORIZED", "Missing authorization");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return errorResponse(500, "INTERNAL", "Supabase config missing");
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(tokenMatch[1]);
  if (userErr || !userData?.user) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or expired session");
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { userId: userData.user.id, authHeader, serviceClient };
}

async function loadOwnedBrand(
  client: SupabaseClient,
  brandId: string,
  userId: string,
): Promise<OwnedBrand | Response> {
  const { data, error } = await client
    .from("brands")
    .select("id, account_id, name, description, place_pool_id, google_place_id, venue_category, cover_media_url, cover_media_type")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return errorResponse(500, "BRAND_READ_FAILED", error.message);
  if (!data) return errorResponse(404, "BRAND_NOT_FOUND", "Brand not found");
  const brand = data as OwnedBrand;
  if (brand.account_id !== userId) {
    return errorResponse(403, "FORBIDDEN", "Brand not owned by caller");
  }
  return brand;
}

async function handleTier1(
  client: SupabaseClient,
  userId: string,
  brand: OwnedBrand,
  body: RequestBody,
): Promise<Response> {
  const draft = body.draft ?? {};
  const selectedPlacePoolId = body.selected_place_pool_id ?? null;
  const category = draft.venueCategory ?? brand.venue_category ?? "restaurant";
  const name = asString(draft.name, brand.name ?? "");
  const address = asString(draft.address, "");
  const lat = typeof draft.lat === "number" ? draft.lat : null;
  const lng = typeof draft.lng === "number" ? draft.lng : null;
  const coverMediaType = draft.coverMediaType ?? (brand.cover_media_type as Tier1Draft["coverMediaType"]) ?? null;
  const coverMediaUrl = draft.coverMediaUrl ?? brand.cover_media_url ?? null;

  if (selectedPlacePoolId !== null) {
    if (!isUuid(selectedPlacePoolId)) {
      return errorResponse(400, "BAD_REQUEST", "selected_place_pool_id must be a uuid");
    }

    const { data: place, error: placeErr } = await client
      .from("place_pool")
      .select("id, google_place_id")
      .eq("id", selectedPlacePoolId)
      .eq("is_active", true)
      .maybeSingle();
    if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
    if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Selected place not found");

    const { error: placeUpdateErr } = await client
      .from("place_pool")
      .update({
        is_claimed: true,
        claimed_by: userId,
        business_hero_video_present: coverMediaType === "video",
        business_authoring_status: "processing",
        opening_hours: draft.hours ?? draft.openingHours ?? null,
        business_authoring_inputs: { tier1: draft, selected_place_pool_id: selectedPlacePoolId },
      })
      .eq("id", selectedPlacePoolId);
    if (placeUpdateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", placeUpdateErr.message);

    const { error: brandUpdateErr } = await client
      .from("brands")
      .update({
        place_pool_id: selectedPlacePoolId,
        google_place_id: (place as { google_place_id: string | null }).google_place_id,
      })
      .eq("id", brand.id);
    if (brandUpdateErr) return errorResponse(500, "BRAND_UPDATE_FAILED", brandUpdateErr.message);

    await upsertPipelineState(client, brand.id, selectedPlacePoolId, "processing", {
      tier1: "linked_existing",
    }, [], null);

    return jsonResponse(200, {
      kind: "ok",
      action: "upsert_tier1_place",
      place_pool_id: selectedPlacePoolId,
      claim_path: "existing",
    });
  }

  if (!name || lat === null || lng === null) {
    return errorResponse(400, "BAD_REQUEST", "name, lat, and lng are required");
  }

  const typeInfo = categoryTypes(category);
  const storedPhotoUrls = coverMediaUrl ? [coverMediaUrl] : [];
  const { data: inserted, error: insertErr } = await client
    .from("place_pool")
    .insert({
      google_place_id: null,
      name,
      address,
      lat,
      lng,
      city: asString(draft.city, ""),
      country: asString(draft.countryCode, ""),
      types: typeInfo.types,
      primary_type: typeInfo.primaryType,
      fetched_via: "business_authored",
      raw_google_data: {
        source: "business_authored",
        not_google_reviewed: true,
      },
      business_status: "OPERATIONAL",
      is_claimed: true,
      claimed_by: userId,
      is_active: true,
      is_servable: false,
      bouncer_reason: "pending_business_pipeline",
      opening_hours: draft.hours ?? draft.openingHours ?? null,
      stored_photo_urls: storedPhotoUrls,
      business_author_brand_id: brand.id,
      business_authoring_status: "processing",
      business_hero_video_present: coverMediaType === "video",
      business_authoring_inputs: { tier1: draft },
      generative_summary: asString(draft.description) || null,
    })
    .select("id")
    .single();
  if (insertErr) return errorResponse(500, "PLACE_INSERT_FAILED", insertErr.message);

  const placePoolId = (inserted as { id: string }).id;
  const { error: brandUpdateErr } = await client
    .from("brands")
    .update({
      place_pool_id: placePoolId,
      google_place_id: null,
      lat,
      lng,
      city: asString(draft.city, ""),
      country_code: asString(draft.countryCode, ""),
    })
    .eq("id", brand.id);
  if (brandUpdateErr) return errorResponse(500, "BRAND_UPDATE_FAILED", brandUpdateErr.message);

  await upsertPipelineState(client, brand.id, placePoolId, "processing", {
    tier1: "created_business_authored",
  }, [], null);

  return jsonResponse(200, {
    kind: "ok",
    action: "upsert_tier1_place",
    place_pool_id: placePoolId,
    claim_path: "create_new",
  });
}

async function upsertPipelineState(
  client: SupabaseClient,
  brandId: string,
  placePoolId: string | null,
  status: "draft" | "processing" | "needs_fix" | "deck_eligible" | "failed",
  stageStatus: Record<string, unknown>,
  coaching: unknown[],
  bouncerReason: string | null,
): Promise<void> {
  await client
    .from("brand_place_pipeline_state")
    .upsert({
      brand_id: brandId,
      place_pool_id: placePoolId,
      status,
      stage_status: stageStatus,
      coaching,
      bouncer_reason: bouncerReason,
      readiness: {
        status,
        bouncer_reason: bouncerReason,
      },
      last_completed_at: status === "deck_eligible" || status === "needs_fix" ? new Date().toISOString() : null,
    }, { onConflict: "brand_id" });
}

async function loadSignals(client: SupabaseClient): Promise<SignalRow[]> {
  const { data, error } = await client
    .from("signal_definitions")
    .select("id, label")
    .eq("is_active", true)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SignalRow[];
}

async function callGeminiForEvaluations(input: {
  brand: OwnedBrand;
  place: Record<string, unknown>;
  signals: SignalRow[];
  tier2: Record<string, unknown>;
}): Promise<{
  bio: string;
  photo_analysis: Record<string, unknown>;
  facets: Record<string, unknown>;
  evaluations: AiEvaluation[];
}> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("gemini_unconfigured");
  }

  const prompt = {
    instruction:
      "Generate a sales bio, photo/facet analysis, and one Q2 score per active Mingla signal. Return strict JSON only.",
    model_contract: {
      model: GEMINI_MODEL,
      prompt_version: PROMPT_VERSION,
      score_keys: ["score_0_to_100", "inappropriate_for", "reasoning"],
    },
    brand: input.brand,
    place: input.place,
    tier2: input.tier2,
    signals: input.signals,
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: JSON.stringify(prompt) }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini_failed:${res.status}:${body.slice(0, 200)}`);
  }
  const payload = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("gemini_empty");
  const parsed = JSON.parse(text) as {
    bio?: unknown;
    photo_analysis?: unknown;
    facets?: unknown;
    evaluations?: unknown;
  };
  if (!Array.isArray(parsed.evaluations)) {
    throw new Error("gemini_missing_evaluations");
  }
  return {
    bio: asString(parsed.bio, ""),
    photo_analysis: parsed.photo_analysis && typeof parsed.photo_analysis === "object"
      ? parsed.photo_analysis as Record<string, unknown>
      : {},
    facets: parsed.facets && typeof parsed.facets === "object"
      ? parsed.facets as Record<string, unknown>
      : {},
    evaluations: parsed.evaluations.map((ev) => {
      const row = ev as Record<string, unknown>;
      return {
        signal_id: asString(row.signal_id),
        score_0_to_100: Math.max(0, Math.min(100, Number(row.score_0_to_100) || 0)),
        inappropriate_for: row.inappropriate_for === true,
        reasoning: asString(row.reasoning, "No reasoning returned."),
      };
    }).filter((ev) => ev.signal_id.length > 0),
  };
}

function buildAiSignalScores(
  signals: SignalRow[],
  evaluations: AiEvaluation[],
  evaluatedAt: string,
): Record<string, {
  score_0_to_100: number;
  inappropriate_for: boolean;
  reasoning: string;
  evaluated_at: string;
  prompt_version: string;
  model: string;
}> {
  const bySignal = new Map(evaluations.map((ev) => [ev.signal_id, ev]));
  const out: Record<string, {
    score_0_to_100: number;
    inappropriate_for: boolean;
    reasoning: string;
    evaluated_at: string;
    prompt_version: string;
    model: string;
  }> = {};
  for (const signal of signals) {
    const ev = bySignal.get(signal.id);
    if (!ev) {
      throw new Error(`gemini_missing_signal:${signal.id}`);
    }
    out[signal.id] = {
      score_0_to_100: ev.score_0_to_100,
      inappropriate_for: ev.inappropriate_for,
      reasoning: ev.reasoning,
      evaluated_at: evaluatedAt,
      prompt_version: PROMPT_VERSION,
      model: GEMINI_MODEL,
    };
  }
  return out;
}

async function handleTier2(
  client: SupabaseClient,
  brand: OwnedBrand,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? brand.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }

  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("*")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const signals = await loadSignals(client);
  const tier2 = body.tier2 ?? {};
  const gemini = await callGeminiForEvaluations({ brand, place, signals, tier2 });
  const evaluatedAt = new Date().toISOString();
  const aiSignalScores = buildAiSignalScores(signals, gemini.evaluations, evaluatedAt);
  const facetPatch = Object.fromEntries(
    Object.entries(gemini.facets).filter(([key, value]) =>
      FACET_COLUMNS.has(key) && (typeof value === "boolean" || value === null)
    ),
  );

  const mergedInputs = {
    ...((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {}),
    tier2,
    pending_ai_outputs: {
      generated_bio: gemini.bio,
      facets: gemini.facets,
      generated_at: evaluatedAt,
      prompt_version: PROMPT_VERSION,
      model: GEMINI_MODEL,
    },
  };

  const bouncerPlace = placeForBouncer(placePoolId, place as Record<string, unknown>, tier2);
  const verdict = bounce(bouncerPlace);
  const reasons = verdict.reasons;
  const nextStatus = verdict.is_servable ? "processing" : "needs_fix";
  const coaching = verdict.is_servable
    ? coachingForReasons(["CONFIRM:ai_outputs"])
    : coachingForReasons(reasons);

  const { error: updateErr } = await client
    .from("place_pool")
    .update({
      ai_signal_scores: aiSignalScores,
      photo_analysis: gemini.photo_analysis,
      business_authoring_inputs: mergedInputs,
      business_authoring_status: nextStatus,
      is_servable: false,
      bouncer_reason: reasons.join(",") || null,
      bouncer_validated_at: evaluatedAt,
      website: bouncerPlace.website,
    })
    .eq("id", placePoolId);
  if (updateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", updateErr.message);

  await upsertPipelineState(client, brand.id, placePoolId, nextStatus, fullStageStatus({
    photo_analysis: "complete",
    sales_bio_generation: "generated_pending_confirmation",
    structured_facet_inference: "generated_pending_confirmation",
    signal_pre_evaluation: "complete",
    google_cross_validation: "complete_or_not_applicable",
    bouncer_servability: verdict.is_servable ? "passed_pending_confirmation" : "needs_fix",
  }), coaching, reasons[0] ?? null);

  return jsonResponse(200, {
    kind: "ok",
    action: body.action === "regenerate_sales_bio" ? "regenerate_sales_bio" : "run_tier2_pipeline",
    place_pool_id: placePoolId,
    status: nextStatus,
    signals_evaluated: signals.length,
    generated_bio: gemini.bio,
    facets: facetPatch,
    coaching,
  });
}

async function handleConfirmAiOutputs(
  client: SupabaseClient,
  brand: OwnedBrand,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? brand.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const salesBio = asString(body.sales_bio);
  if (salesBio.length < 20) {
    return errorResponse(400, "BAD_REQUEST", "sales_bio must be at least 20 characters");
  }

  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("*")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const submittedFacets = body.facets ?? {};
  const facetPatch = Object.fromEntries(
    Object.entries(submittedFacets).filter(([key, value]) =>
      FACET_COLUMNS.has(key) && (typeof value === "boolean" || value === null)
    ),
  );
  const tier2 = body.tier2 ?? {};
  const mergedInputs = {
    ...((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {}),
    tier2,
    confirmed_ai_outputs: {
      sales_bio: salesBio,
      facets: facetPatch,
      confirmed_at: new Date().toISOString(),
      prompt_version: PROMPT_VERSION,
      model: GEMINI_MODEL,
    },
  };
  const bouncerPlace = placeForBouncer(placePoolId, place as Record<string, unknown>, tier2);
  const verdict = bounce(bouncerPlace);
  const reasons = verdict.reasons;
  const nextStatus = verdict.is_servable ? "deck_eligible" : "needs_fix";
  const coaching = coachingForReasons(reasons);

  const { error: updateErr } = await client
    .from("place_pool")
    .update({
      business_authoring_inputs: mergedInputs,
      business_authoring_status: nextStatus,
      generative_summary: salesBio,
      is_servable: verdict.is_servable,
      bouncer_reason: reasons.join(",") || null,
      bouncer_validated_at: new Date().toISOString(),
      website: bouncerPlace.website,
      ...facetPatch,
    })
    .eq("id", placePoolId);
  if (updateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", updateErr.message);

  await upsertPipelineState(client, brand.id, placePoolId, nextStatus, fullStageStatus({
    photo_analysis: "complete",
    sales_bio_generation: "confirmed",
    structured_facet_inference: "confirmed",
    signal_pre_evaluation: "complete",
    google_cross_validation: "complete_or_not_applicable",
    bouncer_servability: verdict.is_servable ? "passed" : "needs_fix",
  }), coaching, reasons[0] ?? null);

  return jsonResponse(200, {
    kind: "ok",
    action: "confirm_ai_outputs",
    place_pool_id: placePoolId,
    status: nextStatus,
    coaching,
  });
}

async function handleRefreshDeckReadiness(
  client: SupabaseClient,
  brand: OwnedBrand,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? brand.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("*")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const inputs =
    ((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {});
  const tier2 = typeof inputs.tier2 === "object" && inputs.tier2 !== null
    ? inputs.tier2 as Record<string, unknown>
    : {};
  const confirmed = typeof inputs.confirmed_ai_outputs === "object" &&
      inputs.confirmed_ai_outputs !== null;
  const verdict = bounce(placeForBouncer(placePoolId, place as Record<string, unknown>, tier2));
  const reasons = verdict.reasons;
  const status = verdict.is_servable && confirmed ? "deck_eligible" : "needs_fix";
  const coaching = verdict.is_servable && !confirmed
    ? coachingForReasons(["CONFIRM:ai_outputs"])
    : coachingForReasons(reasons);

  const { error: updateErr } = await client
    .from("place_pool")
    .update({
      business_authoring_status: status,
      bouncer_reason: reasons.join(",") || null,
      bouncer_validated_at: new Date().toISOString(),
    })
    .eq("id", placePoolId);
  if (updateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", updateErr.message);

  await upsertPipelineState(client, brand.id, placePoolId, status, fullStageStatus({
    photo_analysis: "complete_or_not_applicable",
    sales_bio_generation: confirmed ? "confirmed" : "pending_confirmation",
    structured_facet_inference: confirmed ? "confirmed" : "pending_confirmation",
    signal_pre_evaluation: "complete_or_pending",
    google_cross_validation: "complete_or_not_applicable",
    bouncer_servability: verdict.is_servable ? "passed" : "needs_fix",
  }), coaching, reasons[0] ?? null);

  return jsonResponse(200, {
    kind: "ok",
    action: "refresh_deck_readiness",
    place_pool_id: placePoolId,
    status,
    coaching,
  });
}

async function handleGetAuthoringContext(
  client: SupabaseClient,
  brand: OwnedBrand,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? brand.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("id, business_authoring_status, business_authoring_inputs, stored_photo_urls, business_hero_video_present, website")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const { data: pipeline } = await client
    .from("brand_place_pipeline_state")
    .select("status, coaching")
    .eq("brand_id", brand.id)
    .maybeSingle();
  const inputs =
    ((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {});
  const tier2 = typeof inputs.tier2 === "object" && inputs.tier2 !== null
    ? inputs.tier2 as Record<string, unknown>
    : {};
  const pending = typeof inputs.pending_ai_outputs === "object" &&
      inputs.pending_ai_outputs !== null
    ? inputs.pending_ai_outputs as Record<string, unknown>
    : null;
  const confirmed = typeof inputs.confirmed_ai_outputs === "object" &&
      inputs.confirmed_ai_outputs !== null
    ? inputs.confirmed_ai_outputs as Record<string, unknown>
    : null;
  const storedPhotoUrls = (place as { stored_photo_urls?: string[] | null }).stored_photo_urls ?? [];
  return jsonResponse(200, {
    kind: "ok",
    action: "get_authoring_context",
    place_pool_id: placePoolId,
    status:
      (pipeline as { status?: string } | null)?.status ??
      (place as { business_authoring_status?: string | null }).business_authoring_status ??
      "processing",
    tier2,
    pending_ai_outputs: pending,
    confirmed_ai_outputs: confirmed,
    cover_media_url: storedPhotoUrls[0] ?? null,
    cover_media_type: (place as { business_hero_video_present?: boolean | null }).business_hero_video_present === true
      ? "video"
      : storedPhotoUrls.length > 0
        ? "image"
        : null,
    website: (place as { website?: string | null }).website ?? null,
    coaching: (pipeline as { coaching?: unknown[] } | null)?.coaching ?? [],
  });
}

async function handleSyncHeroMedia(
  client: SupabaseClient,
  brand: OwnedBrand,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? brand.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const mediaType = body.cover_media_type ?? null;
  const mediaUrl = asString(body.cover_media_url ?? "");
  const { error } = await client
    .from("place_pool")
    .update({
      business_hero_video_present: mediaType === "video",
      stored_photo_urls: mediaUrl.length > 0 ? [mediaUrl] : [],
    })
    .eq("id", placePoolId);
  if (error) return errorResponse(500, "PLACE_UPDATE_FAILED", error.message);
  return jsonResponse(200, {
    kind: "ok",
    action: "sync_hero_media",
    place_pool_id: placePoolId,
    business_hero_video_present: mediaType === "video",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "POST required");
  }

  const userResult = await requireUser(req);
  if (userResult instanceof Response) return userResult;

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!isUuid(body.brand_id)) {
    return errorResponse(400, "BAD_REQUEST", "brand_id must be a uuid");
  }
  const brand = await loadOwnedBrand(userResult.serviceClient, body.brand_id, userResult.userId);
  if (brand instanceof Response) return brand;

  try {
    if (body.action === "upsert_tier1_place") {
      return await handleTier1(userResult.serviceClient, userResult.userId, brand, body);
    }
    if (body.action === "run_tier2_pipeline" || body.action === "regenerate_sales_bio") {
      return await handleTier2(userResult.serviceClient, brand, body);
    }
    if (body.action === "confirm_ai_outputs") {
      return await handleConfirmAiOutputs(userResult.serviceClient, brand, body);
    }
    if (body.action === "refresh_deck_readiness") {
      return await handleRefreshDeckReadiness(userResult.serviceClient, brand, body);
    }
    if (body.action === "get_authoring_context") {
      return await handleGetAuthoringContext(userResult.serviceClient, brand, body);
    }
    if (body.action === "sync_hero_media") {
      return await handleSyncHeroMedia(userResult.serviceClient, brand, body);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pipeline failed";
    console.error("[run-business-place-authoring-pipeline]", msg.slice(0, 400));
    return errorResponse(500, "PIPELINE_FAILED", msg);
  }

  return errorResponse(400, "BAD_REQUEST", "Unknown action");
});
