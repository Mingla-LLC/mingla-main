/**
 * META-ORCH-1009 Sub-E — business-app place authoring pipeline client.
 */

import type { BrandHourEntry, VenueCategory } from "../types/brand";
import { supabase } from "./supabase";

export interface Tier1PlaceDraft {
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string | null;
  countryCode: string | null;
  venueCategory: VenueCategory;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  tagline: string;
  description: string;
  hours: BrandHourEntry[];
  // ORCH-1263 §B1 — claim-adoption extras (Leg A §A3.1 stage payload reads
  // draft.website / draft.priceTiers → tier2 seed, draft.adoptedGalleryUrls →
  // business_gallery_urls, draft.adoption → provenance). Optional: the
  // create-from-scratch path never sets them (SC-12 byte-compat).
  website?: string | null;
  priceTiers?: string[];
  /** Kept + added gallery, in c3 order (the public order). */
  adoptedGalleryUrls?: string[];
  adoption?: {
    source: "place_pool";
    adoptedAt: string;
    summarySource: "generative" | "editorial" | null;
    wantsReservations: boolean;
  } | null;
}

export interface Tier1PlaceResult {
  kind: "ok";
  action: "upsert_tier1_place";
  place_pool_id: string;
  claim_path: "existing" | "create_new";
}

export interface PipelineCoachingCard {
  code: string;
  title: string;
  body: string;
  fix: string;
}

export interface Tier2PipelineResult {
  kind: "ok";
  action: "run_tier2_pipeline" | "regenerate_sales_bio";
  place_pool_id: string;
  status: "processing" | "needs_fix" | "deck_eligible" | "failed";
  signals_evaluated: number;
  generated_bio: string;
  facets: Record<string, boolean | null>;
  coaching: PipelineCoachingCard[];
}

export interface ConfirmAiOutputsResult {
  kind: "ok";
  action: "confirm_ai_outputs";
  place_pool_id: string;
  status: "needs_fix" | "deck_eligible";
  coaching: PipelineCoachingCard[];
}

export interface RefreshDeckReadinessResult {
  kind: "ok";
  action: "refresh_deck_readiness";
  place_pool_id: string;
  status: "processing" | "needs_fix" | "deck_eligible";
  coaching: PipelineCoachingCard[];
}

// META-ORCH-1009 Sub-E (schema-align to SPEC §5.2): the pipeline-state row uses
// bouncer_reasons text[] (plural), tier1/tier2_completed_at, and
// last_error_code/last_error_message. `coaching` is an additive cache column.
export interface BrandPlacePipelineState {
  id: string;
  brand_id: string;
  // META-ORCH-1255 — the pipeline row is keyed one-per-VENUE.
  venue_id: string;
  place_pool_id: string | null;
  status: "draft" | "processing" | "needs_fix" | "deck_eligible" | "failed";
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
  stage_status: Record<string, unknown>;
  bouncer_reasons: string[];
  last_error_code: string | null;
  last_error_message: string | null;
  coaching: PipelineCoachingCard[];
  updated_at: string;
}

export interface BrandPlaceAuthoringContext {
  kind: "ok";
  action: "get_authoring_context";
  place_pool_id: string;
  status: BrandPlacePipelineState["status"];
  tier2: Record<string, unknown>;
  pending_ai_outputs: {
    generated_bio?: string;
    facets?: Record<string, boolean | null>;
  } | null;
  confirmed_ai_outputs: Record<string, unknown> | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  website: string | null;
  // META-ORCH-1009 Sub-E: required venue photo gallery (5–20, hero excluded).
  gallery_urls: string[];
  gallery_min: number;
  gallery_max: number;
  // ORCH-1040 (Sub-F WS7 results surface): the per-signal AI scores the venue
  // received + how many "Recommend me" changes remain (cap is initial + 3).
  // The edge `get_authoring_context` already returns these; the listing
  // management page renders them.
  ai_signal_scores: Record<string, AiSignalScore> | null;
  recommend_edits_remaining: number;
  coaching: PipelineCoachingCard[];
}

export interface AiSignalScore {
  score_0_to_100: number;
  inappropriate_for: boolean;
  reasoning: string;
}

type PipelineErrorBody = { kind?: string; code?: string; message?: string };

function assertPipelineOk<T extends { kind: string }>(
  body: T | PipelineErrorBody,
  fallback: string,
): T {
  const maybeError = body as PipelineErrorBody;
  if (maybeError.kind === "error") {
    throw new Error(maybeError.message ?? maybeError.code ?? fallback);
  }
  return body as T;
}

// META-ORCH-1009 Sub-E B6 — supabase-js surfaces a non-2xx edge response as a
// FunctionsHttpError whose `.message` is the opaque "Edge Function returned a
// non-2xx status code" string and stashes the real Response on `.context`.
// This reads the structured `{ code, message }` body our edge function returns
// via bad() so the venue-submit flow shows the REAL reason instead of a generic
// "Could not submit. Try again." Falls back to the original error when the body
// can't be parsed.
async function pipelineInvokeError(
  error: { message?: string; context?: unknown } | null,
  fallback: string,
): Promise<Error> {
  if (error === null) return new Error(fallback);
  const ctx = (error as { context?: unknown }).context;
  if (ctx !== null && ctx !== undefined &&
      typeof (ctx as Response).json === "function") {
    try {
      const parsed = (await (ctx as Response).json()) as PipelineErrorBody;
      const real = parsed?.message ?? parsed?.code;
      if (typeof real === "string" && real.length > 0) {
        return new Error(real);
      }
    } catch {
      // fall through to the opaque message
    }
  }
  return new Error(error.message ?? fallback);
}

export async function upsertTier1Place(input: {
  brandId: string;
  // META-ORCH-1255 Leg B — the pipeline is venue-keyed; venue_id is REQUIRED
  // on every edge-fn action (the fn 400s without it — a structured error the
  // caller surfaces). Optional at the TYPE level only so the pinned
  // append-only error-surfacing test's legacy call shape keeps compiling;
  // every live caller passes it.
  venueId?: string;
  selectedPlacePoolId: string | null;
  draft: Tier1PlaceDraft;
}): Promise<Tier1PlaceResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "upsert_tier1_place",
        brand_id: input.brandId,
        venue_id: input.venueId ?? null,
        selected_place_pool_id: input.selectedPlacePoolId,
        draft: input.draft,
      },
    },
  );
  // B6: surface the real server error (code/message) rather than the opaque
  // FunctionsHttpError string the user was seeing.
  if (error !== null) throw await pipelineInvokeError(error, "tier1_place_failed");
  return assertPipelineOk(data as Tier1PlaceResult | PipelineErrorBody, "tier1_place_failed");
}

export async function syncHeroMedia(input: {
  brandId: string;
  venueId: string;
  placePoolId: string;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "sync_hero_media",
        brand_id: input.brandId,
        venue_id: input.venueId,
        place_pool_id: input.placePoolId,
        cover_media_url: input.coverMediaUrl,
        cover_media_type: input.coverMediaType,
      },
    },
  );
  if (error !== null) throw error;
  assertPipelineOk(data as { kind: "ok" } | PipelineErrorBody, "sync_hero_media_failed");
}

export interface SyncGalleryResult {
  kind: "ok";
  gallery_count: number;
  gallery_min: number;
  gallery_max: number;
}

// META-ORCH-1009 Sub-E: persist the venue gallery (the operator already uploaded
// the photos to storage; this writes the authoritative URL set server-side).
export async function syncGallery(input: {
  brandId: string;
  venueId: string;
  placePoolId: string;
  galleryUrls: string[];
}): Promise<SyncGalleryResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "sync_gallery",
        brand_id: input.brandId,
        venue_id: input.venueId,
        place_pool_id: input.placePoolId,
        gallery_urls: input.galleryUrls,
      },
    },
  );
  if (error !== null) throw await pipelineInvokeError(error, "sync_gallery_failed");
  return assertPipelineOk(
    data as SyncGalleryResult | PipelineErrorBody,
    "sync_gallery_failed",
  );
}

export async function runTier2Pipeline(input: {
  brandId: string;
  venueId: string;
  placePoolId: string;
  tier2: Record<string, unknown>;
}): Promise<Tier2PipelineResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "run_tier2_pipeline",
        brand_id: input.brandId,
        venue_id: input.venueId,
        place_pool_id: input.placePoolId,
        tier2: input.tier2,
      },
    },
  );
  // META-ORCH-1009 Sub-E: surface the REAL server reason (e.g. gemini_failed:429,
  // gemini_incomplete_coverage) instead of the opaque "Edge Function returned a
  // non-2xx status code" string, matching the other pipeline calls.
  if (error !== null) throw await pipelineInvokeError(error, "tier2_pipeline_failed");
  return assertPipelineOk(
    data as Tier2PipelineResult | PipelineErrorBody,
    "tier2_pipeline_failed",
  );
}

export async function confirmAiOutputs(input: {
  brandId: string;
  venueId: string;
  placePoolId: string;
  salesBio: string;
  facets: Record<string, boolean | null>;
  tier2: Record<string, unknown>;
}): Promise<ConfirmAiOutputsResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "confirm_ai_outputs",
        brand_id: input.brandId,
        venue_id: input.venueId,
        place_pool_id: input.placePoolId,
        sales_bio: input.salesBio,
        facets: input.facets,
        tier2: input.tier2,
      },
    },
  );
  if (error !== null) throw await pipelineInvokeError(error, "confirm_ai_outputs_failed");
  return assertPipelineOk(
    data as ConfirmAiOutputsResult | PipelineErrorBody,
    "confirm_ai_outputs_failed",
  );
}

export async function refreshDeckReadiness(input: {
  brandId: string;
  venueId: string;
  placePoolId: string;
}): Promise<RefreshDeckReadinessResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "refresh_deck_readiness",
        brand_id: input.brandId,
        venue_id: input.venueId,
        place_pool_id: input.placePoolId,
      },
    },
  );
  if (error !== null) throw await pipelineInvokeError(error, "refresh_deck_readiness_failed");
  return assertPipelineOk(
    data as RefreshDeckReadinessResult | PipelineErrorBody,
    "refresh_deck_readiness_failed",
  );
}

// META-ORCH-1290 Leg B (D-3/D-5) — the true current pitch for the listing page.
// `get_authoring_context` returns only the AI-generated bio; the owner-authored
// pitch lives in `place_pool.generative_summary` (live) or the staged
// `business_authoring_inputs.tier1.description` (pending). Read both so the
// listing seeds the real pitch, not a stale generated one. RLS SELECT is open to
// authenticated (`authenticated_read_place_pool`).
export interface VenuePitchSource {
  generativeSummary: string | null;
  tier1Description: string | null;
}

export async function fetchVenuePitchSource(
  placePoolId: string,
): Promise<VenuePitchSource> {
  const { data, error } = await supabase
    .from("place_pool")
    .select("generative_summary, business_authoring_inputs")
    .eq("id", placePoolId)
    .maybeSingle();
  if (error !== null) throw error;
  const row = (data ?? null) as {
    generative_summary?: string | null;
    business_authoring_inputs?: { tier1?: { description?: unknown } } | null;
  } | null;
  const t1 = row?.business_authoring_inputs?.tier1;
  const desc =
    t1 !== null &&
    t1 !== undefined &&
    typeof t1 === "object" &&
    typeof (t1 as { description?: unknown }).description === "string"
      ? (t1 as { description: string }).description
      : null;
  return {
    generativeSummary:
      typeof row?.generative_summary === "string"
        ? row.generative_summary
        : null,
    tier1Description: desc,
  };
}

/**
 * META-ORCH-1290 Leg B (D-3, F-13) + B2 addendum — the venue owner edits the
 * pitch on the listing/management page.
 *
 * B2 RESOLUTION: Leg B wrote the pitch by a DIRECT client place_pool
 * row-UPDATE call (via supabase-js) gated only by the row-level RLS
 * policy `place_pool_business_owner_update` + `GRANT ALL ON place_pool TO
 * authenticated`. That row-level UPDATE power lets an owner set ANY column of
 * their own place_pool row via PostgREST (self-publish `is_servable`, forge
 * `ai_signal_scores`), bypassing admin approval + the bouncer + scoring — a
 * violation of the authored-writes-are-RPC/service-role-only architecture
 * (META-ORCH-1255/1263). This now INVOKES the `update_pitch` pipeline action,
 * which owns all authored writes: it asserts ownership (requireUser →
 * loadOwnedBrand → loadOwnedVenue) and column-scopes the write to the pitch
 * ONLY. The stage-vs-apply split is decided SERVER-SIDE via `placeWriteMode`
 * (apply → `place_pool.generative_summary`; stage → the staged
 * `business_authoring_inputs.tier1.description`), so the client can no longer
 * force a live write onto a pre-approval claim
 * (I-PROPOSED-1290-PITCH-WRITES-VIA-PIPELINE-ACTION).
 */
export async function updateVenuePitch(input: {
  brandId: string;
  venueId: string;
  placePoolId: string;
  pitch: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "update_pitch",
        brand_id: input.brandId,
        venue_id: input.venueId,
        place_pool_id: input.placePoolId,
        pitch: input.pitch,
      },
    },
  );
  if (error !== null) throw await pipelineInvokeError(error, "update_pitch_failed");
  assertPipelineOk(data as { kind: "ok" } | PipelineErrorBody, "update_pitch_failed");
}

export async function fetchBrandPlaceAuthoringContext(input: {
  brandId: string;
  placePoolId: string;
  venueId: string;
}): Promise<BrandPlaceAuthoringContext> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "get_authoring_context",
        brand_id: input.brandId,
        venue_id: input.venueId,
        place_pool_id: input.placePoolId,
      },
    },
  );
  if (error !== null) throw error;
  return assertPipelineOk(
    data as BrandPlaceAuthoringContext | PipelineErrorBody,
    "get_authoring_context_failed",
  );
}

const PIPELINE_STATE_COLUMNS =
  "id, brand_id, venue_id, place_pool_id, status, tier1_completed_at, tier2_completed_at, stage_status, bouncer_reasons, last_error_code, last_error_message, coaching, updated_at";

/**
 * [TRANSITIONAL] legacy brand-keyed single-row read. Pre-1255 this was a
 * `.maybeSingle()` on the brand's ONE pipeline row; with N venue rows per
 * brand that errors, so it now returns the LATEST row (or null). Live
 * surfaces read `fetchVenuePipelineState` / `fetchBrandPipelineStates`.
 * Exit condition: pinned source-contract tests superseded → delete.
 */
export async function fetchBrandPlacePipelineState(
  brandId: string,
): Promise<BrandPlacePipelineState | null> {
  const { data, error } = await supabase
    .from("brand_place_pipeline_state")
    .select(PIPELINE_STATE_COLUMNS)
    .eq("brand_id", brandId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error !== null) throw error;
  const rows = (data ?? []) as BrandPlacePipelineState[];
  return rows[0] ?? null;
}

/** META-ORCH-1255 — the pipeline row for ONE venue. */
export async function fetchVenuePipelineState(
  venueId: string,
): Promise<BrandPlacePipelineState | null> {
  const { data, error } = await supabase
    .from("brand_place_pipeline_state")
    .select(PIPELINE_STATE_COLUMNS)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error !== null) throw error;
  return (data ?? null) as BrandPlacePipelineState | null;
}

/** META-ORCH-1255 — ALL pipeline rows of a brand (per-venue statuses). */
export async function fetchBrandPipelineStates(
  brandId: string,
): Promise<BrandPlacePipelineState[]> {
  const { data, error } = await supabase
    .from("brand_place_pipeline_state")
    .select(PIPELINE_STATE_COLUMNS)
    .eq("brand_id", brandId);
  if (error !== null) throw error;
  return (data ?? []) as BrandPlacePipelineState[];
}
