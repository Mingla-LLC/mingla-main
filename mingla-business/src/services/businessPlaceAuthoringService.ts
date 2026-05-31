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
  if (error !== null) throw error;
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
  if (error !== null) throw error;
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
  if (error !== null) throw error;
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
  if (error !== null) throw error;
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
