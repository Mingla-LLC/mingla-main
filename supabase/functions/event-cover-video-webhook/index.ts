import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  assertProcessedDerivative,
  corsHeaders,
  destroyCoverVideoAsset,
  jsonResponse,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";
// #966 — Bunny is the sole cover-video webhook route (the Cloudinary
// signature/eager arm was removed as dead residue post-META-1270).
import {
  bunnyBestMp4,
  bunnyGetVideo,
  bunnyThumbnailUrl,
  mapBunnyStatusFromWebhook,
  verifyBunnyWebhookSignature,
} from "../_shared/bunnyStream.ts";

// #2905 — the webhook was completely silent: nine real Bunny callbacks for the
// wedged production job (2026-08-30 03:11:23 → 03:11:39) left ZERO function
// logs, and every one of them returned an indistinguishable HTTP 200. A dropped
// webhook, an ignored webhook and a genuine promotion all looked identical in
// the gateway log. Every exit below now names itself.
const logWebhook = (
  stage: string,
  fields: Record<string, unknown>,
  level: "info" | "warn" = "info",
): void => {
  const line = JSON.stringify({ stage, ...fields });
  if (level === "warn") console.warn("[event-cover-video-webhook]", line);
  else console.log("[event-cover-video-webhook]", line);
};

const defaultDeps = {
  bunnyGetVideo,
  destroyCoverVideoAsset,
  serviceRoleClient,
};

// META-ORCH-1270 — auto-apply a ready event-target draft_auto job to its event.
// Extracted so the Bunny finalize can reuse the SAME write path the Cloudinary
// branch performs inline (spec §3.4 step 5). No behavior change for Cloudinary.
const autoApplyEventCover = async (
  supabase: ReturnType<typeof serviceRoleClient>,
  job: {
    id: string;
    event_id: string | null;
    target_kind: string | null;
    apply_mode: string | null;
  },
  processedUrl: string,
  posterUrl: string,
): Promise<{ ok: true } | { ok: false }> => {
  if (job.target_kind !== "event" || job.apply_mode !== "draft_auto") {
    return { ok: true };
  }
  const { data, error } = await supabase.rpc("cover_video_apply_once", {
    p_job_id: job.id,
    p_expected_url: processedUrl,
    p_expected_version: 0,
    p_expected_requested_by: null,
  });
  return !error && data?.status === "applied" ? { ok: true } : { ok: false };
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
  const signatureAlgorithm = req.headers.get(
    "x-bunnystream-signature-algorithm",
  );
  const secret = Deno.env.get("BUNNY_STREAM_WEBHOOK_KEY") ?? "";

  let payload: {
    VideoLibraryId?: unknown;
    VideoGuid?: unknown;
    Status?: unknown;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }
  const videoGuid = typeof payload.VideoGuid === "string"
    ? payload.VideoGuid.trim()
    : "";
  const status = typeof payload.Status === "number"
    ? payload.Status
    : Number(payload.Status);
  if (videoGuid.length === 0 || !Number.isFinite(status)) {
    return jsonResponse({
      error: "validation_error",
      detail: "bunny_payload_invalid",
    }, 400);
  }

  // Bunny v1 signs the exact raw request body. There is deliberately no
  // unsigned compatibility path: a missing secret is a deployment error and a
  // missing/invalid signature is unauthenticated input.
  const verification = await verifyBunnyWebhookSignature({
    rawBody,
    signatureHeader,
    signatureVersion,
    signatureAlgorithm,
    secret,
  });
  if (!verification.ok) {
    const detail = verification.code === "missing_signature"
      ? "unverified_unsigned_webhook"
      : verification.code;
    return jsonResponse(
      { error: "forbidden", detail },
      verification.status,
    );
  }

  // 2) Look up the owning job by source_asset_id = VideoGuid (new index). A
  //    foreign video (no job row) is idempotently ignored — never a 500.
  const supabase = deps.serviceRoleClient();
  const { data: existingJob, error: existingJobError } = await supabase
    .from("event_cover_video_jobs")
    .select(
      "id,status,event_id,target_kind,apply_mode,trim_start_ms,trim_end_ms,provider,source_public_id,source_asset_id,source_sha256,provider_payload,processed_poster_url",
    )
    .eq("source_asset_id", videoGuid)
    .maybeSingle();
  if (existingJobError) {
    console.error("[event-cover-video-webhook] bunny job read failed", {
      code: existingJobError.code,
    });
    return jsonResponse(
      { error: "internal_error", detail: "job_read_failed" },
      500,
    );
  }
  if (!existingJob) {
    // #2905 — a guid we do not own is a legitimate no-op, but it MUST NOT be
    // indistinguishable from a promotion in the log. This is the only place a
    // real finish signal can be dropped without a trace, so it logs at warn.
    logWebhook("unknown_guid", { videoGuid, providerStatus: status }, "warn");
    return jsonResponse({ ok: true, ignored: "unknown_guid" });
  }

  // 3) Terminal guards (idempotent late webhooks).
  if (
    existingJob.status === "cancelled" || existingJob.status === "superseded"
  ) {
    logWebhook("terminal_ignored", {
      jobId: existingJob.id,
      jobStatus: existingJob.status,
      providerStatus: status,
      videoGuid,
    });
    return jsonResponse({ ok: true, ignored: existingJob.status });
  }
  if (existingJob.status === "applied") {
    logWebhook("terminal_ignored", {
      jobId: existingJob.id,
      jobStatus: "applied",
      providerStatus: status,
      videoGuid,
    });
    return jsonResponse({ ok: true, ignored: "already_applied" });
  }
  if (existingJob.status === "failed") {
    logWebhook("terminal_ignored", {
      jobId: existingJob.id,
      jobStatus: "failed",
      providerStatus: status,
      videoGuid,
    });
    return jsonResponse({ ok: true, ignored: "already_failed" });
  }
  if (existingJob.status === "ready") {
    logWebhook("terminal_ignored", {
      jobId: existingJob.id,
      jobStatus: "ready",
      providerStatus: status,
      videoGuid,
    });
    return jsonResponse({ ok: true, ignored: "already_ready" });
  }

  // 4) Map the numeric Bunny WEBHOOK Status to our lifecycle. #2905: this is the
  //    webhook enum ONLY (3 = Finished). An API video-object status must be
  //    translated by bunnyApiVideoStatusAsWebhookStatus before it reaches here.
  const mapped = mapBunnyStatusFromWebhook(status);
  if (mapped === "processing") {
    const progress = await deps.bunnyGetVideo(videoGuid);
    const { data: processingJob } = await supabase.rpc(
      "cover_video_transition_job",
      {
        p_job_id: existingJob.id,
        p_from_statuses: [
          "source_uploading",
          "source_uploaded",
          "processing_queued",
          "processing",
        ],
        p_to_status: "processing",
        p_provider_status: status,
        p_provider_progress:
          progress.ok && typeof progress.video.encodeProgress === "number"
            ? Math.max(
              0,
              Math.min(100, Math.round(progress.video.encodeProgress)),
            )
            : null,
        p_patch: {},
      },
    );
    // #2905 — cover_video_transition_job returns the UNCHANGED row when its
    // CAS does not apply (e.g. source_uploading has no legal edge to
    // processing). Silently discarding that made every one of the nine real
    // 2026-08-30 webhooks look successful. A lost progress update is not
    // load-bearing (the reconciler re-reads provider truth), so this stays 200
    // — but it is now named in the log and in the body.
    if (processingJob && processingJob.status !== "processing") {
      logWebhook("transition_lost", {
        attemptedTo: "processing",
        jobId: existingJob.id,
        jobStatus: processingJob.status,
        providerStatus: status,
        videoGuid,
      }, "warn");
      return jsonResponse({
        ok: true,
        ignored: "transition_lost",
        from: processingJob.status,
      });
    }
    logWebhook("processing", {
      jobId: existingJob.id,
      providerStatus: status,
      videoGuid,
    });
    return jsonResponse({ ok: true });
  }
  if (mapped === "failed") {
    const { data: failedJob } = await supabase.rpc(
      "cover_video_transition_job",
      {
        p_job_id: existingJob.id,
        p_from_statuses: [
          "source_uploading",
          "source_uploaded",
          "processing_queued",
          "processing",
        ],
        p_to_status: "failed",
        p_provider_status: status,
        p_provider_progress: null,
        p_patch: {
          failure_code: "provider_failed",
          failure_message: "Video processing failed.",
        },
      },
    );
    if (failedJob?.status === "failed") {
      await deps.destroyCoverVideoAsset(existingJob);
    }
    logWebhook("provider_failed", {
      jobId: existingJob.id,
      jobStatus: failedJob?.status ?? null,
      providerStatus: status,
      videoGuid,
    }, "warn");
    return jsonResponse({ ok: true });
  }
  if (mapped === "ignore") {
    logWebhook("status_ignored", {
      jobId: existingJob.id,
      providerStatus: status,
      videoGuid,
    });
    return jsonResponse({ ok: true, ignored: `status_${status}` });
  }

  const video = await deps.bunnyGetVideo(videoGuid);
  if (!video.ok) {
    logWebhook("provider_unavailable", {
      jobId: existingJob.id,
      reason: video.reason,
      videoGuid,
    }, "warn");
    return jsonResponse({
      error: "provider_temporarily_unavailable",
      detail: video.reason,
    }, 503);
  }
  if (existingJob.source_sha256 && !video.video.originalHash) {
    logWebhook("source_identity_pending", {
      jobId: existingJob.id,
      videoGuid,
    }, "warn");
    return jsonResponse({ error: "source_identity_pending" }, 503);
  }
  if (
    existingJob.source_sha256 &&
    video.video.originalHash !== existingJob.source_sha256
  ) {
    const { data: failedJob } = await supabase.rpc(
      "cover_video_transition_job",
      {
        p_job_id: existingJob.id,
        p_from_statuses: [
          "source_uploading",
          "source_uploaded",
          "processing_queued",
          "processing",
        ],
        p_to_status: "failed",
        p_provider_status: status,
        p_provider_progress: null,
        p_patch: {
          failure_code: "source_identity_mismatch",
          failure_message:
            "The uploaded video did not match the selected file.",
        },
      },
    );
    if (failedJob?.status === "failed") {
      await deps.destroyCoverVideoAsset(existingJob);
      return jsonResponse({ ok: true, status: "failed" });
    }
    return jsonResponse({
      ok: true,
      ignored: failedJob?.status ?? "transition_lost",
    });
  }
  const best = bunnyBestMp4(video.video);
  // #2905 — logged BEFORE the guard so the retryable 503 branches below keep the
  // exact `if (x === null) { return jsonResponse({error:"derivative_not_ready"},503); }`
  // shape that orch-0770b WH-6 pins (no mutation, no destroy, stable 503).
  logWebhook("derivative_probe", {
    availableResolutions: video.video.availableResolutions,
    heightP: best?.heightP ?? null,
    jobId: existingJob.id,
    ready: best !== null,
    videoGuid,
  }, best === null ? "warn" : "info");
  if (best === null) {
    return jsonResponse({ error: "derivative_not_ready" }, 503);
  }
  const head = await headWithRetry(best.url, 3, 2000);
  logWebhook("derivative_head", {
    jobId: existingJob.id,
    reachable: head !== null,
    url: best.url,
    videoGuid,
  }, head === null ? "warn" : "info");
  if (head === null) {
    return jsonResponse({ error: "derivative_not_ready" }, 503);
  }
  const bytes = Number(head.headers.get("content-length"));
  const lengthSeconds =
    typeof video.video.length === "number" && video.video.length > 0
      ? video.video.length
      : 0;
  const durationMs = lengthSeconds * 1000;
  if (durationMs <= 0) {
    // Missing provider evidence is not authoritative invalidity. Never
    // fabricate output duration from the client's requested trim.
    return jsonResponse({
      error: "derivative_not_ready",
      detail: "duration_pending",
    }, 503);
  }
  const derivative = assertProcessedDerivative({
    url: best.url,
    mimeType: "video/mp4",
    bytes,
    durationMs,
    videoCodec: video.video.outputCodecs,
  });
  if (!derivative.ok) {
    const { data: failedJob } = await supabase.rpc(
      "cover_video_transition_job",
      {
        p_job_id: existingJob.id,
        p_from_statuses: [
          "source_uploading",
          "source_uploaded",
          "processing_queued",
          "processing",
        ],
        p_to_status: "failed",
        p_provider_status: status,
        p_provider_progress: 100,
        p_patch: {
          failure_code: derivative.code,
          failure_message: derivative.message,
        },
      },
    );
    if (failedJob?.status === "failed") {
      await deps.destroyCoverVideoAsset(existingJob);
      return jsonResponse({
        ok: true,
        status: "failed",
        failureCode: derivative.code,
      });
    }
    return jsonResponse({
      ok: true,
      ignored: failedJob?.status ?? "transition_lost",
    });
  }

  const posterUrl = bunnyThumbnailUrl(videoGuid);
  const posterHead = await headWithRetry(posterUrl, 3, 2000);
  if (posterHead === null) {
    logWebhook("poster_not_ready", {
      jobId: existingJob.id,
      posterUrl,
      videoGuid,
    }, "warn");
    return jsonResponse({ error: "poster_not_ready" }, 503);
  }
  const providerPayload = mergeBunnyPayload(existingJob.provider_payload, {
    bunny_webhook: payload,
    bunny_thumbnail: posterUrl,
  });
  const { data: readyJob, error: readyError } = await supabase.rpc(
    "cover_video_transition_job",
    {
      p_job_id: existingJob.id,
      p_from_statuses: [
        "source_uploading",
        "source_uploaded",
        "processing_queued",
        "processing",
      ],
      p_to_status: "ready",
      p_provider_status: status,
      p_provider_progress: 100,
      p_patch: {
        processed_url: derivative.url,
        processed_poster_url: posterUrl,
        processed_mime_type: "video/mp4",
        processed_bytes: derivative.bytes,
        processed_duration_ms: derivative.durationMs,
        processed_video_codec: video.video.outputCodecs,
        provider_payload: providerPayload,
      },
    },
  );
  if (readyError || !readyJob) {
    console.error("[event-cover-video-webhook] bunny ready update failed", {
      code: readyError?.code,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  // #2905 — the finish signal is the one thing that must never be lost. When the
  // CAS does not apply, cover_video_transition_job returns the UNCHANGED row, so
  // `readyJob` is truthy and the old code fell straight through to auto-apply and
  // answered 200. That silently discarded a Finished callback (this is exactly
  // what a source_uploading→ready webhook does: the RPC has no such edge). A
  // retryable 503 instead makes Bunny redeliver and keeps the reconciler tick
  // counting it as unreconciled, so the promotion is retried rather than lost.
  if (readyJob.status !== "ready") {
    logWebhook("ready_transition_lost", {
      attemptedTo: "ready",
      jobId: existingJob.id,
      jobStatus: readyJob.status,
      providerStatus: status,
      videoGuid,
    }, "warn");
    return jsonResponse({
      error: "ready_transition_lost",
      detail: String(readyJob.status ?? "unknown"),
    }, 503);
  }

  const applied = await autoApplyEventCover(
    supabase,
    readyJob,
    derivative.url,
    posterUrl,
  );
  if (!applied.ok) {
    logWebhook("ready_apply_failed", {
      jobId: existingJob.id,
      providerStatus: status,
      videoGuid,
    }, "warn");
    return jsonResponse({ ok: true, status: "ready", applyFailed: true });
  }
  logWebhook("ready", {
    jobId: existingJob.id,
    processedUrl: derivative.url,
    providerStatus: status,
    videoGuid,
  });
  return jsonResponse({ ok: true });
};

export const handleEventCoverVideoWebhook = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const rawBody = await req.text();

  // #966 — Bunny is the sole cover-video provider, so the webhook routes
  // unconditionally to the Bunny library-level handler. The Cloudinary
  // signature/eager arm was removed as dead residue post-META-1270.
  return await handleBunnyWebhook(req, rawBody, deps);
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoWebhook(req));
}
