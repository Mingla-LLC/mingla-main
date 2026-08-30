// ORCH-0770 shared helpers for event-cover video processing edge functions.
// @ts-ignore - Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore - Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
// #966 — Bunny is the sole cover-video provider; the Cloudinary upload/config/
// webhook residue was removed (dead post-META-1270). bunnyDeleteVideo is the
// only provider delete path.
import { bunnyDeleteVideo } from "./bunnyStream.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export const FINAL_MAX_BYTES = Number.parseInt(
  Deno.env.get("EVENT_COVER_FINAL_MAX_BYTES") ?? "26214400",
  10,
);
export const MAX_DURATION_MS = Number.parseInt(
  Deno.env.get("EVENT_COVER_MAX_DURATION_MS") ?? "15000",
  10,
);
export const MAX_SOURCE_VIDEO_BYTES = Number.parseInt(
  Deno.env.get("EVENT_COVER_MAX_SOURCE_VIDEO_BYTES") ?? "104857600",
  10,
);
export const MAX_SOURCE_VIDEO_DURATION_MS = Number.parseInt(
  Deno.env.get("EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS") ?? "15000",
  10,
);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORCH_0978_AUTH_FAILURE_REASON_HEADER = "x-orch-0978-auth-failure-reason";
const ORCH_0978_AUTH_FAILURE_EXP_DELTA_HEADER =
  "x-orch-0978-auth-exp-delta-sec"; // ggignore — public diagnostic header name, not a credential

type AuthFailureReason =
  | "token_absent"
  | "token_malformed"
  | "token_expired"
  | "token_invalid_signature"
  | "userid_missing";

const logWarn = (
  requestId: string,
  stage: string,
  payload: Record<string, unknown> = {},
) => {
  console.warn(
    "[event-cover-video]",
    JSON.stringify({
      requestId,
      stage,
      ...payload,
    }),
  );
};

const authHeaderPrefix = (authHeader: string): string | null => {
  if (authHeader.length === 0) return null;
  return authHeader.slice(0, 24);
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const segments = token.split(".");
  if (
    segments.length !== 3 || segments.some((segment) => segment.length === 0)
  ) {
    return null;
  }
  try {
    const padded = segments[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segments[1].length / 4) * 4, "=");
    const decoded = atob(padded);
    const payload = JSON.parse(decoded);
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
};

const expDeltaSecFromPayload = (
  payload: Record<string, unknown> | null,
): number | null => {
  const exp = payload?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return Math.floor(exp - Date.now() / 1000);
};

const unauthenticatedResponse = (
  reason: AuthFailureReason,
  authHeader: string,
  expDeltaSec: number | null,
): Response => {
  const requestId = crypto.randomUUID();
  logWarn(requestId, "auth_failed", {
    reason,
    expDeltaSec,
    hasAuthHeader: authHeader.length > 0,
    authHeaderPrefix: authHeaderPrefix(authHeader),
  });
  const response = jsonResponse({ error: "unauthenticated" }, 401);
  response.headers.set(ORCH_0978_AUTH_FAILURE_REASON_HEADER, reason);
  if (expDeltaSec !== null) {
    response.headers.set(
      ORCH_0978_AUTH_FAILURE_EXP_DELTA_HEADER,
      String(expDeltaSec),
    );
  }
  return response;
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isValidUuid(input: unknown): input is string {
  return typeof input === "string" && UUID_REGEX.test(input);
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export async function requireUserId(req: Request): Promise<string | Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.length === 0) {
    return unauthenticatedResponse("token_absent", authHeader, null);
  }
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return unauthenticatedResponse("token_malformed", authHeader, null);
  }

  const token = tokenMatch[1];
  const jwtPayload = decodeJwtPayload(token);
  const expDeltaSec = expDeltaSecFromPayload(jwtPayload);
  if (!jwtPayload || expDeltaSec === null) {
    return unauthenticatedResponse("token_malformed", authHeader, expDeltaSec);
  }
  if (expDeltaSec <= 0) {
    return unauthenticatedResponse("token_expired", authHeader, expDeltaSec);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await userClient.auth.getUser(token);
  if (error) {
    return unauthenticatedResponse(
      "token_invalid_signature",
      authHeader,
      expDeltaSec,
    );
  }
  if (!data.user?.id) {
    return unauthenticatedResponse("userid_missing", authHeader, expDeltaSec);
  }
  return data.user.id;
}

export async function requireEventManager(
  supabase: SupabaseClient,
  eventId: string,
  brandId: string,
  userId: string,
): Promise<
  { event: { id: string; brand_id: string; status: string | null } } | Response
> {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, brand_id, status")
    .eq("id", eventId)
    .eq("brand_id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (eventError) {
    console.error("[event-cover-video] event read failed:", eventError);
    return jsonResponse(
      { error: "internal_error", detail: "event_read_failed" },
      500,
    );
  }
  if (!event) {
    return jsonResponse({ error: "not_found", detail: "event_not_found" }, 404);
  }

  const { data: rank, error: rankError } = await supabase.rpc(
    "biz_brand_effective_rank",
    { p_brand_id: brandId, p_user_id: userId },
  );
  if (rankError) {
    console.error("[event-cover-video] role check failed:", rankError);
    return jsonResponse(
      { error: "internal_error", detail: "role_check_failed" },
      500,
    );
  }
  const { data: requiredRank, error: requiredRankError } = await supabase.rpc(
    "biz_role_rank",
    { p_role: "event_manager" },
  );
  if (requiredRankError) {
    console.error("[event-cover-video] role rank failed:", requiredRankError);
    return jsonResponse(
      { error: "internal_error", detail: "role_rank_failed" },
      500,
    );
  }
  if (Number(rank ?? 0) < Number(requiredRank ?? 40)) {
    return jsonResponse(
      { error: "forbidden", detail: "permission_denied" },
      403,
    );
  }
  return { event };
}

// ORCH-0989: brand-cover video target. A brand has no events-row, so the
// event-bound requireEventManager cannot gate a brand job. This sibling
// resolves the caller's effective rank on the brand directly and requires
// >= brand_admin (no events lookup). Mirrors requireEventManager's response
// vocabulary so each edge fn can dispatch on target_kind identically.
export async function requireBrandCoverManager(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
): Promise<{ brandId: string } | Response> {
  const { data: rank, error: rankError } = await supabase.rpc(
    "biz_brand_effective_rank",
    { p_brand_id: brandId, p_user_id: userId },
  );
  if (rankError) {
    console.error("[event-cover-video] brand role check failed:", rankError);
    return jsonResponse(
      { error: "internal_error", detail: "role_check_failed" },
      500,
    );
  }
  const { data: requiredRank, error: requiredRankError } = await supabase.rpc(
    "biz_role_rank",
    { p_role: "brand_admin" },
  );
  if (requiredRankError) {
    console.error(
      "[event-cover-video] brand role rank failed:",
      requiredRankError,
    );
    return jsonResponse(
      { error: "internal_error", detail: "role_rank_failed" },
      500,
    );
  }
  if (Number(rank ?? 0) < Number(requiredRank ?? 50)) {
    return jsonResponse(
      { error: "forbidden", detail: "permission_denied" },
      403,
    );
  }
  return { brandId };
}

export type CoverVideoTargetKind = "event" | "brand" | "venue" | "venue_draft";

export type CoverVideoTargetSelector = {
  targetKind: CoverVideoTargetKind;
  eventId: string | null;
  brandId: string;
  venueId: string | null;
  draftOwnerKey: string | null;
  requestedBy?: string | null;
};

export async function requireCoverVideoTargetManager(
  supabase: SupabaseClient,
  selector: CoverVideoTargetSelector,
  userId: string,
): Promise<{ target: CoverVideoTargetSelector } | Response> {
  if (selector.targetKind === "event") {
    if (!isValidUuid(selector.eventId)) {
      return jsonResponse({
        error: "validation_error",
        detail: "event_id_invalid_uuid",
      }, 400);
    }
    const allowed = await requireEventManager(
      supabase,
      selector.eventId,
      selector.brandId,
      userId,
    );
    return allowed instanceof Response ? allowed : { target: selector };
  }
  if (selector.targetKind === "venue") {
    if (!isValidUuid(selector.venueId)) {
      return jsonResponse({
        error: "validation_error",
        detail: "venue_id_invalid_uuid",
      }, 400);
    }
    const { data: venue, error } = await supabase
      .from("venue_listings")
      .select("id,brand_id")
      .eq("id", selector.venueId)
      .eq("brand_id", selector.brandId)
      .maybeSingle();
    if (error) {
      return jsonResponse({
        error: "internal_error",
        detail: "venue_read_failed",
      }, 500);
    }
    if (!venue) {
      return jsonResponse(
        { error: "not_found", detail: "venue_not_found" },
        404,
      );
    }
  }
  if (
    selector.targetKind === "venue_draft" &&
    (typeof selector.draftOwnerKey !== "string" ||
      selector.draftOwnerKey.trim().length < 3 ||
      selector.draftOwnerKey.length > 160)
  ) {
    return jsonResponse({
      error: "validation_error",
      detail: "draft_owner_key_invalid",
    }, 400);
  }
  if (
    selector.targetKind === "venue_draft" &&
    selector.requestedBy !== userId
  ) {
    return jsonResponse(
      { error: "forbidden", detail: "draft_owner_mismatch" },
      403,
    );
  }
  const allowed = await requireBrandCoverManager(
    supabase,
    selector.brandId,
    userId,
  );
  return allowed instanceof Response ? allowed : { target: selector };
}

// #966 — Bunny is the sole cover-video provider. The runtime-config value is no
// longer read here, so a missing/invalid config can never route cover-video to
// the retired provider (was: `resolveRuntimeString(...) ?? "cloudinary"`).
export type CoverVideoProvider = "bunny";

export function coverVideoProvider(): CoverVideoProvider {
  return "bunny";
}

// providerConfigured() reports the sole provider's readiness. bunnyConfigured()
// is byte-for-byte unchanged from META-ORCH-1270.
export function providerConfigured(): boolean {
  return bunnyConfigured();
}

function bunnyConfigured(): boolean {
  return (
    Boolean(Deno.env.get("BUNNY_STREAM_LIBRARY_ID")) &&
    Boolean(Deno.env.get("BUNNY_STREAM_API_KEY")) &&
    Boolean(Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME"))
  );
}

// Provider-agnostic terminal cleanup. Bunny is the only provider; this is
// byte-for-byte what the prior code did for every (bunny) row. The param shape
// is retained so callers (cancel/reaper/apply/webhook) compile unchanged.
export async function destroyCoverVideoAsset(job: {
  provider?: string | null;
  source_public_id?: unknown;
  source_asset_id?: unknown;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  return bunnyDeleteVideo(String(job.source_asset_id ?? ""));
}

export async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function validateTrimRange(input: {
  sourceDurationMs: number | null;
  trimStartMs: number;
  trimEndMs: number;
}): Response | null {
  if (
    !Number.isFinite(input.trimStartMs) || !Number.isFinite(input.trimEndMs)
  ) {
    return jsonResponse(
      { error: "validation_error", detail: "trim_invalid" },
      400,
    );
  }
  if (input.trimStartMs < 0 || input.trimEndMs <= input.trimStartMs) {
    return jsonResponse(
      { error: "validation_error", detail: "trim_invalid" },
      400,
    );
  }
  if (input.trimEndMs - input.trimStartMs > MAX_DURATION_MS) {
    return jsonResponse({
      error: "validation_error",
      detail: "trim_over_duration",
    }, 422);
  }
  if (
    typeof input.sourceDurationMs === "number" &&
    input.sourceDurationMs > 0 &&
    input.trimEndMs > input.sourceDurationMs + 250
  ) {
    return jsonResponse({
      error: "validation_error",
      detail: "trim_out_of_range",
    }, 422);
  }
  return null;
}

export function assertProcessedDerivative(input: {
  url: unknown;
  mimeType: unknown;
  bytes: unknown;
  durationMs: unknown;
  videoCodec?: unknown;
}): { ok: true; url: string; bytes: number; durationMs: number } | {
  ok: false;
  code: string;
  message: string;
} {
  if (typeof input.url !== "string" || !/^https:\/\//i.test(input.url)) {
    return {
      ok: false,
      code: "processed_url_invalid",
      message: "Processed video URL was invalid.",
    };
  }
  if (input.mimeType !== "video/mp4") {
    return {
      ok: false,
      code: "processed_mime_invalid",
      message: "Processed video was not video/mp4.",
    };
  }
  const bytes = typeof input.bytes === "number"
    ? input.bytes
    : Number(input.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > FINAL_MAX_BYTES) {
    return {
      ok: false,
      code: "processed_size_invalid",
      message: "Processed video was over the final size budget.",
    };
  }
  const durationMs = typeof input.durationMs === "number"
    ? input.durationMs
    : typeof input.durationMs === "string" && input.durationMs.trim().length > 0
    ? Number(input.durationMs)
    : Number.NaN;
  if (!Number.isFinite(durationMs)) {
    return {
      ok: false,
      code: "processed_duration_missing",
      message:
        "Processed video duration was missing from the provider callback.",
    };
  }
  if (durationMs <= 0) {
    return {
      ok: false,
      code: "processed_duration_nonpositive",
      message: "Processed video duration was zero or negative.",
    };
  }
  if (durationMs > MAX_DURATION_MS) {
    return {
      ok: false,
      code: "processed_duration_over_cap",
      message: "Processed video was over the duration limit.",
    };
  }
  if (
    typeof input.videoCodec !== "string" ||
    !/h\.?264|avc(?:1)?|libx264|x264/i.test(input.videoCodec)
  ) {
    return {
      ok: false,
      code: "processed_codec_invalid",
      message: "Processed video was not H.264.",
    };
  }
  // Bunny outputCodecs is video-only evidence. Successful Bunny MP4 output
  // carries AAC audio by provider contract; inventing a second codec field from
  // outputCodecs rejects real x264 responses and fabricates evidence.
  return { ok: true, url: input.url, bytes, durationMs };
}

export type EventCoverVideoJobStatus =
  | "source_uploading"
  | "source_uploaded"
  | "processing_queued"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled"
  | "superseded"
  | "applied";

export type EventCoverVideoStatusPayload = {
  jobId: string;
  // ORCH-0989: null for brand-target jobs (brand jobs have no events-row).
  eventId: string | null;
  brandId: string;
  // ORCH-0989: 'event' (default) or 'brand'.
  targetKind: CoverVideoTargetKind;
  venueId: string | null;
  draftOwnerKey: string | null;
  clientOperationId: string | null;
  status: EventCoverVideoJobStatus;
  applyMode: "draft_auto" | "published_manual";
  stageLabel: string;
  progressKind: "determinate" | "indeterminate" | "terminal";
  progressPercent: number | null;
  isTerminal: boolean;
  canRetry: boolean;
  canCheckAgain: boolean;
  canCancel: boolean;
  processedUrl: string | null;
  processedPosterUrl: string | null;
  processedMimeType: string | null;
  processedBytes: number | null;
  processedDurationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  safeJobCode: string;
  createdAt: string | null;
  updatedAt: string | null;
  sourceUploadedAt: string | null;
  appliedAt: string | null;
  cancelledAt: string | null;
  applicationVersion: number;
  applicationReceipt: Record<string, unknown> | null;
};

export type EventCoverVideoReadyUpdateInput = {
  applyMode: "draft_auto" | "published_manual" | string | null;
  derivative: {
    bytes: number;
    durationMs: number;
    url: string;
  };
  providerPayload: Record<string, unknown>;
  posterUrl?: string;
};

export function eventCoverVideoReadyUpdate(
  input: EventCoverVideoReadyUpdateInput,
): Record<string, unknown> {
  return {
    processed_bytes: input.derivative.bytes,
    processed_duration_ms: input.derivative.durationMs,
    processed_mime_type: "video/mp4",
    processed_url: input.derivative.url,
    processed_poster_url: input.posterUrl ?? null,
    provider_payload: input.providerPayload,
    completed_at: input.applyMode === "published_manual"
      ? new Date().toISOString()
      : null,
    status: "ready",
  };
}

type EventCoverVideoJobRow = {
  id: string;
  // ORCH-0989: nullable for brand-target jobs.
  event_id: string | null;
  brand_id: string;
  target_kind?: string | null;
  venue_id?: string | null;
  draft_owner_key?: string | null;
  client_operation_id?: string | null;
  status: string | null;
  apply_mode: string | null;
  processed_url?: string | null;
  processed_poster_url?: string | null;
  processed_mime_type?: string | null;
  processed_bytes?: number | null;
  processed_duration_ms?: number | null;
  failure_code?: string | null;
  failure_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  applied_at?: string | null;
  cancelled_at?: string | null;
  provider_payload?: unknown;
  provider_progress?: number | null;
  application_version?: number | null;
  application_receipt?: unknown;
};

const stageForStatus = (
  status: EventCoverVideoJobStatus,
): {
  label: string;
  progressKind: "determinate" | "indeterminate" | "terminal";
  progressPercent: number | null;
} => {
  switch (status) {
    case "source_uploading":
      return {
        label: "Uploading video",
        progressKind: "indeterminate",
        progressPercent: null,
      };
    case "source_uploaded":
      return {
        label: "Upload complete. Preparing processing...",
        progressKind: "indeterminate",
        progressPercent: null,
      };
    case "processing_queued":
    case "processing":
      return {
        label: "Processing browser-safe video...",
        progressKind: "indeterminate",
        progressPercent: null,
      };
    case "ready":
      return {
        label: "Video ready.",
        progressKind: "terminal",
        progressPercent: 100,
      };
    case "applied":
      return {
        label: "Cover video updated.",
        progressKind: "terminal",
        progressPercent: 100,
      };
    case "failed":
      return {
        label: "Video processing failed.",
        progressKind: "terminal",
        progressPercent: null,
      };
    case "cancelled":
      return {
        label: "Video processing cancelled.",
        progressKind: "terminal",
        progressPercent: null,
      };
    case "superseded":
      return {
        label: "Using your newer video",
        progressKind: "terminal",
        progressPercent: null,
      };
  }
};

const sourceUploadedAtFromPayload = (
  providerPayload: unknown,
): string | null => {
  if (providerPayload === null || typeof providerPayload !== "object") {
    return null;
  }
  const sourceUpload =
    (providerPayload as { source_upload?: unknown }).source_upload;
  if (sourceUpload === null || typeof sourceUpload !== "object") return null;
  const value = (sourceUpload as { acknowledged_at?: unknown }).acknowledged_at;
  return typeof value === "string" ? value : null;
};

export function mapEventCoverVideoStatus(
  job: EventCoverVideoJobRow,
): EventCoverVideoStatusPayload {
  const knownStatuses: EventCoverVideoJobStatus[] = [
    "source_uploading",
    "source_uploaded",
    "processing_queued",
    "processing",
    "ready",
    "failed",
    "cancelled",
    "superseded",
    "applied",
  ];
  const status = knownStatuses.includes(job.status as EventCoverVideoJobStatus)
    ? job.status as EventCoverVideoJobStatus
    : "processing";
  const stage = stageForStatus(status);
  const trustedProgress =
    (status === "processing" || status === "processing_queued") &&
      typeof job.provider_progress === "number" &&
      job.provider_progress >= 0 && job.provider_progress <= 100
      ? job.provider_progress
      : null;
  const isTerminal = ["failed", "cancelled", "superseded", "applied"]
    .includes(status);
  const isActive = [
    "source_uploading",
    "source_uploaded",
    "processing_queued",
    "processing",
  ]
    .includes(status);
  return {
    appliedAt: job.applied_at ?? null,
    applyMode: job.apply_mode === "published_manual"
      ? "published_manual"
      : "draft_auto",
    brandId: job.brand_id,
    canCancel: isActive,
    canCheckAgain: isActive,
    canRetry: status === "failed" || status === "cancelled",
    cancelledAt: job.cancelled_at ?? null,
    clientOperationId: job.client_operation_id ?? null,
    createdAt: job.created_at ?? null,
    eventId: job.event_id ?? null,
    targetKind: job.target_kind === "brand" || job.target_kind === "venue" ||
        job.target_kind === "venue_draft"
      ? job.target_kind
      : "event",
    venueId: job.venue_id ?? null,
    draftOwnerKey: job.draft_owner_key ?? null,
    failureCode: job.failure_code ?? null,
    failureMessage: null,
    safeJobCode: job.id.replace(/-/g, "").slice(0, 8).toUpperCase(),
    isTerminal,
    jobId: job.id,
    processedBytes: typeof job.processed_bytes === "number"
      ? job.processed_bytes
      : null,
    processedDurationMs: typeof job.processed_duration_ms === "number"
      ? job.processed_duration_ms
      : null,
    processedMimeType: job.processed_mime_type ?? null,
    processedPosterUrl: job.processed_poster_url ?? null,
    processedUrl: job.processed_url ?? null,
    progressKind: trustedProgress === null ? stage.progressKind : "determinate",
    progressPercent: trustedProgress,
    sourceUploadedAt: sourceUploadedAtFromPayload(job.provider_payload),
    stageLabel: stage.label,
    status,
    updatedAt: job.updated_at ?? null,
    applicationVersion: typeof job.application_version === "number"
      ? job.application_version
      : 0,
    applicationReceipt: job.application_receipt !== null &&
        typeof job.application_receipt === "object"
      ? job.application_receipt as Record<string, unknown>
      : null,
  };
}
