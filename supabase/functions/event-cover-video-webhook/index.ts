import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  assertProcessedDerivative,
  corsHeaders,
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  const webhookVerification = await verifyWebhook(req, rawBody);
  if (!webhookVerification.ok) {
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
  const jobId = contextValue(payload, "job_id");
  if (jobId === null) {
    return jsonResponse({ error: "validation_error", detail: "job_id_missing" }, 400);
  }

  const supabase = serviceRoleClient();
  const failed = Boolean(payload.error) || payload.status === "failed";
  if (failed) {
    await supabase
      .from("event_cover_video_jobs")
      .update({
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
  const durationRaw = eager.duration ?? eager.duration_ms ?? payload.duration ?? payload.duration_ms;
  const durationMs =
    typeof durationRaw === "number" && durationRaw < 1000 ? durationRaw * 1000 : durationRaw;
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
  const derivative = assertProcessedDerivative({
    audioCodec: audio.codec ?? eager.audio_codec ?? payload.audio_codec,
    bytes,
    durationMs,
    mimeType,
    url,
    videoCodec: video.codec ?? eager.video_codec ?? payload.video_codec,
  });
  if (!derivative.ok) {
    await supabase
      .from("event_cover_video_jobs")
      .update({
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
    .update({
      processed_at: new Date().toISOString(),
      processed_bytes: derivative.bytes,
      processed_duration_ms: derivative.durationMs,
      processed_mime_type: "video/mp4",
      processed_url: derivative.url,
      provider_payload: payload,
      status: "ready",
    })
    .eq("id", jobId)
    .select("id,event_id,apply_mode")
    .maybeSingle();
  if (jobError || !job) {
    console.error("[event-cover-video-webhook] ready update failed:", jobError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (job.apply_mode === "draft_auto") {
    await supabase
      .from("events")
      .update({
        cover_media_type: "video",
        cover_media_url: derivative.url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.event_id)
      .is("deleted_at", null);
    await supabase
      .from("event_cover_video_jobs")
      .update({ applied_at: new Date().toISOString(), status: "applied" })
      .eq("id", job.id);
  }

  return jsonResponse({ ok: true });
});
