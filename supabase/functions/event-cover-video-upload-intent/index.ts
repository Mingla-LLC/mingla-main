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
  requireEventManager,
  requireUserId,
  serviceRoleClient,
  validateTrimRange,
} from "../_shared/eventCoverVideo.ts";

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

serve(async (req) => {
  let requestId: string = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    logWarn(requestId, "method_not_allowed", { method: req.method });
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) {
    logWarn(requestId, "auth_failed", { status: userIdOrResponse.status });
    return userIdOrResponse;
  }
  const userId = userIdOrResponse;

  let body: {
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

  logInfo(requestId, "received", {
    applyMode: body.applyMode,
    brandId: body.brandId,
    eventId: body.eventId,
    sourceBytes: body.sourceBytes,
    sourceDurationMs: body.sourceDurationMs,
    sourceFileName: body.sourceFileName,
    sourceMimeType: body.sourceMimeType,
    trimEndMs: body.trimEndMs,
    trimStartMs: body.trimStartMs,
  });

  if (!providerConfigured()) {
    logWarn(requestId, "provider_not_configured");
    return jsonResponse({
      error: "provider_not_configured",
      detail: "Video cover processing is not configured yet. Images and GIFs still work.",
    });
  }

  const eventId = body.eventId;
  const brandId = body.brandId;
  if (!isValidUuid(eventId)) {
    logWarn(requestId, "event_id_invalid_uuid", { eventId });
    return jsonResponse({ error: "validation_error", detail: "event_id_invalid_uuid" }, 400);
  }
  if (!isValidUuid(brandId)) {
    logWarn(requestId, "brand_id_invalid_uuid", { brandId });
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }
  const applyMode = body.applyMode === "published_manual" ? "published_manual" : "draft_auto";
  const sourceBytes = Number(body.sourceBytes ?? 0);
  const sourceDurationMs = Number(body.sourceDurationMs ?? 0);
  const trimStartMs = Number(body.trimStartMs ?? 0);
  const trimEndMs = Number(body.trimEndMs ?? Math.min(sourceDurationMs, MAX_DURATION_MS));

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

  const supabase = serviceRoleClient();
  const allowed = await requireEventManager(supabase, eventId, brandId, userId);
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
  });

  const { error: cancelError } = await supabase
    .from("event_cover_video_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      failure_code: "superseded",
      failure_message: "Superseded by a newer cover video upload.",
    })
    .eq("event_id", eventId)
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
      event_id: eventId,
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
    return jsonResponse({ error: "internal_error" }, 500);
  }
  logInfo(requestId, "job_insert_pass", { jobId: job.id });

  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME") ?? "";
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY") ?? "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const trimDurationMs = trimEndMs - trimStartMs;
  const publicId = `event-covers/raw/${brandId}/${eventId}/${job.id}`;
  const eager = [
    `so_${(trimStartMs / 1000).toFixed(3)}`,
    `du_${(trimDurationMs / 1000).toFixed(3)}`,
    "c_limit,w_1280,h_720",
    "vc_h264",
    "ac_aac",
    `br_${clampBitrate(trimDurationMs)}`,
    "f_mp4",
    "q_auto:good",
  ].join(",");
  const eagerNotificationUrl =
    `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/event-cover-video-webhook`;
  const context = `job_id=${job.id}|event_id=${eventId}|brand_id=${brandId}|apply_mode=${applyMode}`;
  const signature = await cloudinarySignature({
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
    trimDurationMs,
  });

  const { error: payloadUpdateError } = await supabase
    .from("event_cover_video_jobs")
    .update({ provider_payload: { public_id: publicId, eager } })
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
});
