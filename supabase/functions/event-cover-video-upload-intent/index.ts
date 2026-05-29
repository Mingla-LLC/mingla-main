import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  cloudinarySignature,
  corsHeaders,
  isValidUuid,
  jsonResponse,
  MAX_DURATION_MS,
  MAX_SOURCE_VIDEO_BYTES,
  MAX_SOURCE_VIDEO_DURATION_MS,
  providerConfigured,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
  validateTrimRange,
} from "../_shared/eventCoverVideo.ts";

export const SOURCE_CEILING_MS = 33_000;

const clampBitrate = (durationMs: number): string => {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  const targetBits = 25 * 1024 * 1024 * 8 * 0.86;
  const kbps = Math.floor(targetBits / seconds / 1000);
  return `${Math.max(900, Math.min(9000, kbps))}k`;
};

const logInfo = (requestId: string, stage: string, payload: Record<string, unknown> = {}) => {
  console.log("[event-cover-video-upload-intent]", JSON.stringify({
    requestId,
    stage,
    ...payload,
  }));
};

const logWarn = (requestId: string, stage: string, payload: Record<string, unknown> = {}) => {
  console.warn("[event-cover-video-upload-intent]", JSON.stringify({
    requestId,
    stage,
    ...payload,
  }));
};

const defaultDeps = {
  cloudinarySignature,
  providerConfigured,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
};

export const handleEventCoverVideoUploadIntent = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  let requestId: string = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    logWarn(requestId, "method_not_allowed", { method: req.method });
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await deps.requireUserId(req);
  if (userIdOrResponse instanceof Response) {
    logWarn(requestId, "auth_response_returned", { status: userIdOrResponse.status });
    return userIdOrResponse;
  }
  const userId = userIdOrResponse;

  let body: {
    // ORCH-0989: target discriminator. Absent/"event" => event-target
    // (eventId required); "brand" => brand-target (eventId absent).
    target?: string;
    eventId?: string;
    brandId?: string;
    applyMode?: string;
    sourceFileName?: string | null;
    sourceMimeType?: string | null;
    sourceBytes?: number | null;
    sourceDurationMs?: number | null;
    trimStartMs?: number;
    trimEndMs?: number;
    clientRequestId?: string;
  };
  try {
    body = await req.json();
  } catch {
    logWarn(requestId, "invalid_json");
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  if (typeof body.clientRequestId === "string" && body.clientRequestId.trim().length > 0) {
    requestId = body.clientRequestId.trim();
  }

  const targetKind = body.target === "brand" ? "brand" : "event";

  logInfo(requestId, "received", {
    applyMode: body.applyMode,
    brandId: body.brandId,
    eventId: body.eventId,
    targetKind,
    sourceBytes: body.sourceBytes,
    sourceDurationMs: body.sourceDurationMs,
    sourceFileName: body.sourceFileName,
    sourceMimeType: body.sourceMimeType,
    trimEndMs: body.trimEndMs,
    trimStartMs: body.trimStartMs,
  });

  if (!deps.providerConfigured()) {
    logWarn(requestId, "provider_not_configured");
    return jsonResponse({
      error: "provider_not_configured",
      detail: "Video cover processing is not configured yet. Images and GIFs still work.",
    });
  }

  const eventId = body.eventId;
  const brandId = body.brandId;
  // ORCH-0989: event-target requires a valid eventId; brand-target must NOT
  // carry one (the job is keyed on brand_id alone).
  if (targetKind === "event" && !isValidUuid(eventId)) {
    logWarn(requestId, "event_id_invalid_uuid", { eventId });
    return jsonResponse({ error: "validation_error", detail: "event_id_invalid_uuid" }, 400);
  }
  if (!isValidUuid(brandId)) {
    logWarn(requestId, "brand_id_invalid_uuid", { brandId });
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }
  // ORCH-0989: a brand is always "live", so brand video uses published_manual
  // apply semantics (apply step writes brands.cover_media_url on ready).
  const applyMode =
    targetKind === "brand"
      ? "published_manual"
      : body.applyMode === "published_manual"
        ? "published_manual"
        : "draft_auto";
  const sourceBytes = Number(body.sourceBytes ?? 0);
  const sourceDurationMs = Number(body.sourceDurationMs ?? 0);
  const trimStartMs = Number(body.trimStartMs ?? 0);
  const rawTrimEndMs = Number(body.trimEndMs ?? sourceDurationMs);
  // Accept a generous source window for native keyframe overshoot, but persist a
  // processed trim window capped at MAX_DURATION_MS. (ORCH-0978 AMENDMENT 8.)
  const trimEndMs = Math.min(rawTrimEndMs, MAX_DURATION_MS);

  if (!Number.isFinite(sourceBytes) || sourceBytes <= 0 || sourceBytes > MAX_SOURCE_VIDEO_BYTES) {
    logWarn(requestId, "source_size_out_of_range", {
      maxSourceBytes: MAX_SOURCE_VIDEO_BYTES,
      sourceBytes,
    });
    return jsonResponse({ error: "validation_error", detail: "source_size_out_of_range" }, 422);
  }
  if (
    !Number.isFinite(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > MAX_SOURCE_VIDEO_DURATION_MS
  ) {
    logWarn(requestId, "source_duration_out_of_range", {
      maxSourceDurationMs: MAX_SOURCE_VIDEO_DURATION_MS,
      sourceDurationMs,
    });
    return jsonResponse({ error: "validation_error", detail: "source_duration_out_of_range" }, 422);
  }
  if (sourceDurationMs > SOURCE_CEILING_MS) {
    logWarn(requestId, "duration_over_cap", {
      ceiling: SOURCE_CEILING_MS,
      sourceDurationMs,
    });
    return jsonResponse(
      {
        error: "duration_over_cap",
        detail: { sourceDurationMs, ceilingMs: SOURCE_CEILING_MS },
      },
      422,
    );
  }
  const trimError = validateTrimRange({ sourceDurationMs, trimStartMs, trimEndMs });
  if (trimError !== null) {
    let detail: unknown = "trim_invalid";
    try {
      detail = (await trimError.clone().json() as { detail?: unknown }).detail ?? detail;
    } catch {
      // Keep fallback detail for malformed diagnostic body.
    }
    logWarn(requestId, "trim_range_rejected", {
      detail,
      sourceDurationMs,
      trimEndMs,
      trimStartMs,
    });
    return trimError;
  }
  logInfo(requestId, "validation_pass", {
    applyMode,
    sourceBytes,
    sourceDurationMs,
    trimEndMs,
    trimStartMs,
  });

  const supabase = deps.serviceRoleClient();
  // ORCH-0989: brand-target gates on brand_admin (no events lookup);
  // event-target keeps the byte-for-byte event_manager gate.
  const allowed =
    targetKind === "brand"
      ? await deps.requireBrandCoverManager(supabase, brandId as string, userId)
      : await deps.requireEventManager(supabase, eventId as string, brandId as string, userId);
  if (allowed instanceof Response) {
    let detail: unknown = null;
    let error: unknown = null;
    try {
      const body = await allowed.clone().json() as { error?: unknown; detail?: unknown };
      detail = body.detail ?? null;
      error = body.error ?? null;
    } catch {
      // Response body is best-effort diagnostics only.
    }
    logWarn(requestId, "permission_rejected", {
      detail,
      error,
      status: allowed.status,
    });
    return allowed;
  }
  logInfo(requestId, "permission_pass", {
    brandId,
    eventId,
    targetKind,
  });

  // ORCH-0989: supersede prior active jobs. Event-target keys on event_id
  // (filter order preserved: .eq() then .not()); brand-target keys on
  // brand_id + target_kind='brand' (no event_id).
  const supersedeBase = supabase
    .from("event_cover_video_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      failure_code: "superseded",
      failure_message: "Superseded by a newer cover video upload.",
    });
  const { error: cancelError } =
    targetKind === "brand"
      ? await supersedeBase
          .eq("brand_id", brandId as string)
          .eq("target_kind", "brand")
          .not("status", "in", "(failed,cancelled,applied)")
      : await supersedeBase
          .eq("event_id", eventId as string)
          .not("status", "in", "(failed,cancelled,applied)");
  if (cancelError) {
    logWarn(requestId, "active_job_cancel_failed", {
      code: cancelError.code,
      details: cancelError.details,
      hint: cancelError.hint,
      message: cancelError.message,
    });
  } else {
    logInfo(requestId, "active_jobs_cancelled", { eventId });
  }

  const { data: job, error: insertError } = await supabase
    .from("event_cover_video_jobs")
    .insert({
      // ORCH-0989: brand-target jobs carry no event_id (row CHECK enforces it).
      event_id: targetKind === "brand" ? null : eventId,
      target_kind: targetKind,
      brand_id: brandId,
      requested_by: userId,
      provider: "cloudinary",
      status: "source_uploading",
      apply_mode: applyMode,
      source_file_name: body.sourceFileName ?? null,
      source_mime_type: body.sourceMimeType ?? null,
      source_bytes: sourceBytes,
      source_duration_ms: sourceDurationMs,
      trim_start_ms: trimStartMs,
      trim_end_ms: trimEndMs,
    })
    .select("id")
    .single();
  if (insertError || !job) {
    console.error("[event-cover-video-upload-intent]", JSON.stringify({
      brandId,
      code: insertError?.code,
      details: insertError?.details,
      eventId,
      hint: insertError?.hint,
      message: insertError?.message,
      requestId,
      stage: "job_insert_failed",
    }));
    return jsonResponse(
      { error: "internal_error", detail: "job_insert_failed" },
      500,
    );
  }
  logInfo(requestId, "job_insert_pass", { jobId: job.id });

  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME") ?? "";
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY") ?? "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // ORCH-0989: brand-target uses a brandId-keyed public_id (no eventId
  // segment); the webhook recovers job_id from either template (recoverJobIdFromPayload).
  const publicId =
    targetKind === "brand"
      ? `brand-covers/raw/${brandId}/${job.id}`
      : `event-covers/raw/${brandId}/${eventId}/${job.id}`;
  const durationBudgetMs = Math.min(trimEndMs - trimStartMs, MAX_DURATION_MS);
  const durationBudgetSeconds = Math.ceil(durationBudgetMs / 1000);
  // du_<seconds> caps processed duration server-side as defense-in-depth alongside client trim.
  // Reference: https://cloudinary.com/documentation/video_manipulation_and_delivery_reference#video_transformation_url_parameters
  const eager = [
    "c_limit,w_1280,h_720",
    `du_${durationBudgetSeconds}`,
    "vc_h264",
    "ac_aac",
    `br_${clampBitrate(durationBudgetMs)}`,
    "f_mp4",
    "q_auto:good",
  ].join(",");
  const eagerNotificationUrl =
    `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/event-cover-video-webhook`;
  // ORCH-0989: brand-target context carries target_kind + brand_id (no event_id);
  // event-target keeps the original event_id-bearing context.
  const context =
    targetKind === "brand"
      ? `job_id=${job.id}|target_kind=brand|brand_id=${brandId}|apply_mode=${applyMode}`
      : `job_id=${job.id}|event_id=${eventId}|brand_id=${brandId}|apply_mode=${applyMode}`;
  const signature = await deps.cloudinarySignature({
    // Cloudinary signed upload params:
    // https://cloudinary.com/documentation/upload_images
    // https://cloudinary.com/documentation/authentication_signatures
    context,
    eager,
    eager_async: "true",
    eager_notification_url: eagerNotificationUrl,
    public_id: publicId,
    timestamp,
  });
  logInfo(requestId, "cloudinary_signature_generated", {
    jobId: job.id,
    publicId,
    durationBudgetMs,
  });

  const { error: payloadUpdateError } = await supabase
    .from("event_cover_video_jobs")
    .update({
      provider_payload: { public_id: publicId, eager },
      source_public_id: publicId,
    })
    .eq("id", job.id);
  if (payloadUpdateError) {
    logWarn(requestId, "provider_payload_update_failed", {
      code: payloadUpdateError.code,
      details: payloadUpdateError.details,
      hint: payloadUpdateError.hint,
      jobId: job.id,
      message: payloadUpdateError.message,
    });
  }
  logInfo(requestId, "returned", { jobId: job.id, provider: "cloudinary" });

  return jsonResponse({
    jobId: job.id,
    provider: "cloudinary",
    maxDurationMs: MAX_DURATION_MS,
    finalMaxBytes: 25 * 1024 * 1024,
    upload: {
      url: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      fields: {
        // Cloudinary Upload API parameters:
        // https://cloudinary.com/documentation/upload_images
        // https://cloudinary.com/documentation/upload_parameters
        api_key: apiKey,
        context,
        eager,
        eager_async: "true",
        eager_notification_url: eagerNotificationUrl,
        public_id: publicId,
        resource_type: "video",
        signature,
        timestamp,
      },
    },
  });
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoUploadIntent(req));
}
