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
  coaching: PipelineCoachingCard[];
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
  selectedPlacePoolId: string | null;
  draft: Tier1PlaceDraft;
}): Promise<Tier1PlaceResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "upsert_tier1_place",
        brand_id: input.brandId,
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
  placePoolId: string;
  galleryUrls: string[];
}): Promise<SyncGalleryResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "sync_gallery",
        brand_id: input.brandId,
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
  placePoolId: string;
  tier2: Record<string, unknown>;
}): Promise<Tier2PipelineResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "run_tier2_pipeline",
        brand_id: input.brandId,
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
  placePoolId: string;
}): Promise<RefreshDeckReadinessResult> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "refresh_deck_readiness",
        brand_id: input.brandId,
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

export async function fetchBrandPlaceAuthoringContext(input: {
  brandId: string;
  placePoolId: string;
}): Promise<BrandPlaceAuthoringContext> {
  const { data, error } = await supabase.functions.invoke(
    "run-business-place-authoring-pipeline",
    {
      body: {
        action: "get_authoring_context",
        brand_id: input.brandId,
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

export async function fetchBrandPlacePipelineState(
  brandId: string,
): Promise<BrandPlacePipelineState | null> {
  const { data, error } = await supabase
    .from("brand_place_pipeline_state")
    .select("id, brand_id, place_pool_id, status, tier1_completed_at, tier2_completed_at, stage_status, bouncer_reasons, last_error_code, last_error_message, coaching, updated_at")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error !== null) throw error;
  return (data ?? null) as BrandPlacePipelineState | null;
}
