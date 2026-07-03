import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  assertProcessedDerivative,
  corsHeaders,
  coverVideoProvider,
  destroyCoverVideoAsset,
  eventCoverVideoReadyUpdate,
  isValidUuid,
  jsonResponse,
  serviceRoleClient,
  verifyCloudinaryNotificationSignature,
} from "../_shared/eventCoverVideo.ts";
// META-ORCH-1270 — Bunny library-level webhook branch (Cloudinary path unchanged).
import {
  bunnyBestMp4,
  bunnyGetVideo,
  bunnyThumbnailUrl,
  mapBunnyStatus,
  verifyBunnyWebhookSignature,
} from "../_shared/bunnyStream.ts";

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
  bunnyGetVideo,
  destroyCoverVideoAsset,
  serviceRoleClient,
  verifyWebhook,
};

// META-ORCH-1270 — auto-apply a ready event-target draft_auto job to its event.
// Extracted so the Bunny finalize can reuse the SAME write path the Cloudinary
// branch performs inline (spec §3.4 step 5). No behavior change for Cloudinary.
const autoApplyEventCover = async (
  supabase: ReturnType<typeof serviceRoleClient>,
  job: { id: string; event_id: string | null; target_kind: string | null; apply_mode: string | null },
  processedUrl: string,
): Promise<{ ok: true } | { ok: false }> => {
  if (job.target_kind === "brand" || job.apply_mode !== "draft_auto") {
    return { ok: true };
  }
  const { error: eventUpdateError } = await supabase
    .from("events")
    .update({
      cover_media_type: "video",
      cover_media_url: processedUrl,
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
    return { ok: false };
  }
  await supabase
    .from("event_cover_video_jobs")
    .update({
      applied_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: "applied",
    })
    .eq("id", job.id);
  return { ok: true };
};

const headWithRetry = async (
  url: string,
  attempts: number,
  delayMs: number,
): Promise<Response | null> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(url, { method: "HEAD" });
    } catch {
      response = null;
    }
    if (response !== null && response.ok) return response;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
};

const mergeBunnyPayload = (
  existing: unknown,
  extra: Record<string, unknown>,
): Record<string, unknown> => ({
  ...(existing !== null && typeof existing === "object"
    ? existing as Record<string, unknown>
    : {}),
  ...extra,
});

// META-ORCH-1270 — Bunny library-level webhook. It identifies the asset only by
// VideoGuid (not our context), so the job lookup keys on source_asset_id.
export const handleBunnyWebhook = async (
  req: Request,
  rawBody: string,
  deps: typeof defaultDeps,
): Promise<Response> => {
  const signatureHeader = req.headers.get("x-bunnystream-signature");
  // META-ORCH-1270 — Bunny's confirmed v1 signing envelope (docs.bunny.net/stream/webhooks).
  const signatureVersion = req.headers.get("x-bunnystream-signature-version");
  const signatureAlgorithm = req.headers.get("x-bunnystream-signature-algorithm");
  const secret = Deno.env.get("BUNNY_STREAM_WEBHOOK_KEY") ?? "";

  let payload: { VideoLibraryId?: unknown; VideoGuid?: unknown; Status?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  const videoGuid = typeof payload.VideoGuid === "string" ? payload.VideoGuid.trim() : "";
  const status = typeof payload.Status === "number" ? payload.Status : Number(payload.Status);
  if (videoGuid.length === 0 || !Number.isFinite(status)) {
    return jsonResponse({ error: "validation_error", detail: "bunny_payload_invalid" }, 400);
  }

  // 1) Authenticity. If the signature header is present, verify the v1 envelope
  //    (X-BunnyStream-Signature-Version=v1, -Algorithm=hmac-sha256) + the HMAC
  //    over the exact raw body. A present signature with a wrong/missing version
  //    or algorithm is a hard 403 (never silently accepted). If the signature is
  //    ABSENT (older libraries send unsigned), fall back to fetch authenticity:
  //    the video must exist AND a job row must match (checked in step 2). A
  //    present-but-mismatched signature is a hard 403.
  if (signatureHeader !== null && signatureHeader.trim().length > 0) {
    const verification = await verifyBunnyWebhookSignature({
      rawBody,
      signatureHeader,
      signatureVersion,
      signatureAlgorithm,
      secret,
    });
    if (!verification.ok) {
      console.warn("[event-cover-video-webhook]", JSON.stringify({
        code: verification.code,
        provider: "bunny",
        stage: "webhook_rejected",
        status: verification.status,
      }));
      return jsonResponse(
        { error: "forbidden", detail: verification.code, message: verification.message },
        verification.status,
      );
    }
  } else {
    const probe = await deps.bunnyGetVideo(videoGuid);
    if (!probe.ok) {
      console.warn("[event-cover-video-webhook]", JSON.stringify({
        provider: "bunny",
        reason: probe.reason,
        stage: "unsigned_webhook_unverified",
      }));
      return jsonResponse(
        { error: "forbidden", detail: "unverified_unsigned_webhook", message: "Unsigned webhook could not be authenticated." },
        403,
      );
    }
  }

  // 2) Look up the owning job by source_asset_id = VideoGuid (new index). A
  //    foreign video (no job row) is idempotently ignored — never a 500.
  const supabase = deps.serviceRoleClient();
  const { data: existingJob, error: existingJobError } = await supabase
    .from("event_cover_video_jobs")
    .select("id,status,event_id,target_kind,apply_mode,trim_start_ms,trim_end_ms,provider,source_public_id,source_asset_id,provider_payload")
    .eq("source_asset_id", videoGuid)
    .maybeSingle();
  if (existingJobError) {
    console.error("[event-cover-video-webhook] bunny job read failed:", existingJobError);
    return jsonResponse({ error: "internal_error", detail: "job_read_failed" }, 500);
  }
  if (!existingJob) {
    return jsonResponse({ ok: true, ignored: "unknown_guid" });
  }

  // 3) Terminal guards (idempotent late webhooks).
  if (existingJob.status === "cancelled") {
    return jsonResponse({ ok: true, ignored: "cancelled" });
  }
  if (existingJob.status === "applied") {
    return jsonResponse({ ok: true, ignored: "already_applied" });
  }

  // 4) Map the numeric Bunny Status to our lifecycle.
  const mapped = mapBunnyStatus(status);
  if (mapped === "processing") {
    await supabase
      .from("event_cover_video_jobs")
      .update({ status: "processing" })
      .eq("id", existingJob.id);
    return jsonResponse({ ok: true });
  }
  if (mapped === "failed") {
    await deps.destroyCoverVideoAsset(existingJob);
    await supabase
      .from("event_cover_video_jobs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        failure_code: "provider_failed",
        failure_message: "Video processing failed.",
        provider_payload: mergeBunnyPayload(existingJob.provider_payload, { bunny_webhook: payload }),
      })
      .eq("id", existingJob.id);
    return jsonResponse({ ok: true });
  }
  if (mapped === "ignore") {
    return jsonResponse({ ok: true, ignored: `status_${status}` });
  }

  // 5) Finalize on Finished (Status 3). Fail closed on any missing MP4.
  const failJob = async (code: string, message: string): Promise<void> => {
    await deps.destroyCoverVideoAsset(existingJob);
    await supabase
      .from("event_cover_video_jobs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        failure_code: code,
        failure_message: message,
        provider_payload: mergeBunnyPayload(existingJob.provider_payload, { bunny_webhook: payload }),
      })
      .eq("id", existingJob.id);
  };

  const video = await deps.bunnyGetVideo(videoGuid);
  if (!video.ok) {
    await failJob("processed_mp4_unavailable", "Processed video could not be read from the media host.");
    return jsonResponse({ ok: true });
  }
  const best = bunnyBestMp4(video.video);
  if (best === null) {
    await failJob("processed_mp4_unavailable", "No playable MP4 rendition (MP4 fallback disabled or no <=720p rendition).");
    return jsonResponse({ ok: true });
  }
  const head = await headWithRetry(best.url, 3, 2000);
  if (head === null) {
    await failJob("processed_mp4_unavailable", "Processed MP4 was not reachable.");
    return jsonResponse({ ok: true });
  }
  const bytes = Number(head.headers.get("content-length"));
  const lengthSeconds =
    typeof video.video.length === "number" && video.video.length > 0 ? video.video.length : 0;
  let durationMs = lengthSeconds * 1000;
  if (durationMs <= 0) {
    const start = typeof existingJob.trim_start_ms === "number" ? existingJob.trim_start_ms : 0;
    const end = typeof existingJob.trim_end_ms === "number" ? existingJob.trim_end_ms : null;
    durationMs = end !== null && end > start ? end - start : 0;
  }
  const derivative = assertProcessedDerivative({
    url: best.url,
    mimeType: "video/mp4",
    bytes,
    durationMs,
  });
  if (!derivative.ok) {
    await failJob(derivative.code, derivative.message);
    return jsonResponse({ ok: true });
  }

  const providerPayload = mergeBunnyPayload(existingJob.provider_payload, {
    bunny_webhook: payload,
    bunny_thumbnail: bunnyThumbnailUrl(videoGuid),
  });
  const { data: readyJob, error: readyError } = await supabase
    .from("event_cover_video_jobs")
    .update(eventCoverVideoReadyUpdate({
      applyMode: existingJob.apply_mode,
      derivative,
      providerPayload,
    }))
    .eq("id", existingJob.id)
    .select("id,event_id,target_kind,apply_mode")
    .maybeSingle();
  if (readyError || !readyJob) {
    console.error("[event-cover-video-webhook] bunny ready update failed:", readyError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  const applied = await autoApplyEventCover(supabase, readyJob, derivative.url);
  if (!applied.ok) {
    return jsonResponse({ ok: true, status: "ready", applyFailed: true });
  }
  return jsonResponse({ ok: true });
};

export const handleEventCoverVideoWebhook = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const rawBody = await req.text();

  // META-ORCH-1270 — route to the Bunny library-level webhook when the active
  // provider is Bunny. Cloudinary path below is byte-for-byte unchanged.
  if (coverVideoProvider() === "bunny") {
    return await handleBunnyWebhook(req, rawBody, deps);
  }

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
