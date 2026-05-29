import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  assertProcessedDerivative,
  corsHeaders,
  eventCoverVideoReadyUpdate,
  isValidUuid,
  jsonResponse,
  serviceRoleClient,
  verifyCloudinaryNotificationSignature,
} from "../_shared/eventCoverVideo.ts";

const contextValue = (payload: Record<string, unknown>, key: string): string | null => {
  const context = payload.context;
  if (typeof context === "object" && context !== null) {
    const custom = (context as Record<string, unknown>).custom;
    if (typeof custom === "object" && custom !== null) {
      const value = (custom as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  }
  if (typeof context === "string") {
    const parts = context.split("|");
    for (const part of parts) {
      const [k, v] = part.split("=");
      if (k === key && typeof v === "string") return v;
    }
  }
  const direct = payload[key];
  return typeof direct === "string" ? direct : null;
};

export const recoverJobIdFromPayload = (payload: Record<string, unknown>): string | null => {
  const fromContext = contextValue(payload, "job_id");
  if (fromContext !== null && isValidUuid(fromContext)) return fromContext;

  // ORCH-0989: both templates end in `${job.id}` as the last path segment —
  //   event:  event-covers/raw/${brandId}/${eventId}/${job.id}
  //   brand:  brand-covers/raw/${brandId}/${job.id}
  // so the last-segment recovery works for brand-target jobs unchanged.
  const publicId = typeof payload.public_id === "string" ? payload.public_id : null;
  if (publicId === null) return null;
  const lastSegment = publicId.split("/").at(-1) ?? null;
  if (lastSegment === null) return null;
  return isValidUuid(lastSegment) ? lastSegment : null;
};

const verifyWebhook = async (
  req: Request,
  rawBody: string,
): Promise<{ ok: true } | { ok: false; code: string; status: number; message: string }> => {
  const fallbackSecret = Deno.env.get("EVENT_COVER_VIDEO_WEBHOOK_SECRET") ?? "";
  const fallbackEnabled = Deno.env.get("EVENT_COVER_VIDEO_ALLOW_SHARED_SECRET_FALLBACK") === "true";
  if (
    fallbackEnabled &&
    fallbackSecret &&
    req.headers.get("x-mingla-webhook-secret") === fallbackSecret
  ) {
    return { ok: true };
  }
  return verifyCloudinaryNotificationSignature({
    apiSecret: Deno.env.get("CLOUDINARY_API_SECRET") ?? "",
    rawBody,
    signature: req.headers.get("x-cld-signature"),
    timestamp: req.headers.get("x-cld-timestamp"),
  });
};

const firstEager = (payload: Record<string, unknown>): Record<string, unknown> => {
  const eager = payload.eager;
  return Array.isArray(eager) && typeof eager[0] === "object" && eager[0] !== null
    ? eager[0] as Record<string, unknown>
    : {};
};

const eagerDurationOrFallback = (
  eager: Record<string, unknown>,
  payload: Record<string, unknown>,
  job: { trim_start_ms?: number | null; trim_end_ms?: number | null },
): number | null => {
  const raw = eager.duration ?? eager.duration_ms ?? payload.duration ?? payload.duration_ms;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1000 ? raw * 1000 : raw;
  }
  // Cloudinary's eager_notification payload is not contractually required to include duration.
  // Reference: https://cloudinary.com/documentation/upload_images#notification_url
  // The job's trim window is the authoritative source: upload-intent enforced the cap
  // before upload, and the eager transformation now also enforces du_<seconds>.
  const start = typeof job.trim_start_ms === "number" ? job.trim_start_ms : 0;
  const end = typeof job.trim_end_ms === "number" ? job.trim_end_ms : null;
  if (end === null || end <= start) return null;
  return end - start;
};

const defaultDeps = {
  serviceRoleClient,
  verifyWebhook,
};

export const handleEventCoverVideoWebhook = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  console.log("[event-cover-video-webhook]", JSON.stringify({
    hasSignature: Boolean(req.headers.get("x-cld-signature")),
    hasTimestamp: Boolean(req.headers.get("x-cld-timestamp")),
    stage: "webhook_received",
  }));
  const webhookVerification = await deps.verifyWebhook(req, rawBody);
  if (!webhookVerification.ok) {
    console.warn("[event-cover-video-webhook]", JSON.stringify({
      code: webhookVerification.code,
      stage: "webhook_rejected",
      status: webhookVerification.status,
    }));
    return jsonResponse({
      error: "forbidden",
      detail: webhookVerification.code,
      message: webhookVerification.message,
    }, webhookVerification.status);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  const jobId = recoverJobIdFromPayload(payload);
  if (jobId === null) {
    console.warn("[event-cover-video-webhook]", JSON.stringify({
      publicId: typeof payload.public_id === "string" ? payload.public_id : null,
      hasContext: typeof payload.context === "object" || typeof payload.context === "string",
      stage: "job_id_extraction_failed",
    }));
    return jsonResponse({ error: "validation_error", detail: "job_id_missing" }, 400);
  }

  const supabase = deps.serviceRoleClient();
  const { data: existingJob, error: existingJobError } = await supabase
    .from("event_cover_video_jobs")
    .select("id,status,event_id,target_kind,apply_mode,trim_start_ms,trim_end_ms")
    .eq("id", jobId)
    .maybeSingle();
  if (existingJobError || !existingJob) {
    console.error("[event-cover-video-webhook] job read failed:", existingJobError);
    return jsonResponse({ error: "internal_error", detail: "job_read_failed" }, 500);
  }
  if (existingJob.status === "cancelled") {
    console.log("[event-cover-video-webhook]", JSON.stringify({
      jobId,
      stage: "late_webhook_ignored_cancelled",
    }));
    return jsonResponse({ ok: true, ignored: "cancelled" });
  }
  if (existingJob.status === "applied") {
    return jsonResponse({ ok: true, ignored: "already_applied" });
  }

  const failed = Boolean(payload.error) || payload.status === "failed";
  if (failed) {
    await supabase
      .from("event_cover_video_jobs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        failure_code: "provider_failed",
        failure_message: typeof payload.error === "string" ? payload.error : "Video processing failed.",
        provider_payload: payload,
      })
      .eq("id", jobId);
    return jsonResponse({ ok: true });
  }

  const eager = firstEager(payload);
  const url = eager.secure_url ?? eager.url ?? payload.secure_url ?? payload.url;
  const bytes = eager.bytes ?? payload.bytes;
  const durationMs = eagerDurationOrFallback(eager, payload, existingJob);
  const mimeType =
    eager.format === "mp4" || String(url ?? "").toLowerCase().includes(".mp4")
      ? "video/mp4"
      : eager.mime_type ?? payload.mime_type;
  const video = typeof eager.video === "object" && eager.video !== null
    ? eager.video as Record<string, unknown>
    : {};
  const audio = typeof eager.audio === "object" && eager.audio !== null
    ? eager.audio as Record<string, unknown>
    : {};
  const fellBackToTrim =
    durationMs !== null &&
    eager.duration === undefined &&
    eager.duration_ms === undefined &&
    payload.duration === undefined &&
    payload.duration_ms === undefined;
  if (fellBackToTrim) {
    console.warn("[event-cover-video-webhook]", JSON.stringify({
      jobId,
      fallbackDurationMs: durationMs,
      publicId: typeof payload.public_id === "string" ? payload.public_id : null,
      stage: "duration_fallback_to_job_trim",
    }));
  }
  const derivative = assertProcessedDerivative({
    audioCodec: audio.codec ?? eager.audio_codec ?? payload.audio_codec,
    bytes,
    durationMs: durationMs ?? undefined,
    mimeType,
    url,
    videoCodec: video.codec ?? eager.video_codec ?? payload.video_codec,
  });
  if (!derivative.ok) {
    await supabase
      .from("event_cover_video_jobs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        failure_code: derivative.code,
        failure_message: derivative.message,
        provider_payload: payload,
      })
      .eq("id", jobId);
    return jsonResponse({ ok: true });
  }

  const { data: job, error: jobError } = await supabase
    .from("event_cover_video_jobs")
    .update(eventCoverVideoReadyUpdate({
      applyMode: existingJob.apply_mode,
      derivative,
      providerPayload: payload,
    }))
    .eq("id", jobId)
    .select("id,event_id,target_kind,apply_mode")
    .maybeSingle();
  if (jobError || !job) {
    console.error("[event-cover-video-webhook] ready update failed:", jobError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  // ORCH-0989: only event-target draft_auto jobs auto-apply to events here.
  // Brand-target jobs always use published_manual (no event_id), so they
  // stay at `ready` and the explicit apply fn writes brands.cover_media_url.
  if (job.target_kind !== "brand" && job.apply_mode === "draft_auto") {
    const { error: eventUpdateError } = await supabase
      .from("events")
      .update({
        cover_media_type: "video",
        cover_media_url: derivative.url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.event_id)
      .is("deleted_at", null);
    if (eventUpdateError) {
      console.error("[event-cover-video-webhook] event update failed:", eventUpdateError);
      await supabase
        .from("event_cover_video_jobs")
        .update({
          failure_code: "apply_failed",
          failure_message: "Processed video is ready, but Mingla could not apply it automatically.",
        })
        .eq("id", job.id);
      return jsonResponse({ ok: true, status: "ready", applyFailed: true });
    }
    await supabase
      .from("event_cover_video_jobs")
      .update({
        applied_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        status: "applied",
      })
      .eq("id", job.id);
  }

  return jsonResponse({ ok: true });
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoWebhook(req));
}
