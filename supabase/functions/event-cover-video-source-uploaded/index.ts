import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  destroyCoverVideoAsset,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  MAX_SOURCE_VIDEO_BYTES,
  requireBrandCoverManager,
  requireCoverVideoTargetManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";
// #966 — Bunny is the sole cover-video provider (Cloudinary ack path removed).
import {
  bunnyGetVideo,
  bunnyPresignTusUpload,
} from "../_shared/bunnyStream.ts";

type ProviderUploadResponse = {
  asset_id?: unknown;
  public_id?: unknown;
  bytes?: unknown;
  duration?: unknown;
  format?: unknown;
  resource_type?: unknown;
};

const safeString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const mergeProviderPayload = (
  existing: unknown,
  sourceUpload: Record<string, unknown>,
): Record<string, unknown> => ({
  ...(existing !== null && typeof existing === "object"
    ? existing as Record<string, unknown>
    : {}),
  source_upload: sourceUpload,
});

// ── #2967 THE ACKNOWLEDGEMENT DEADLINE ──────────────────────────────────────
// #2715's storage-metadata repair (PR #2843) returns an UNCHANGED canonical
// `source_uploading` with HTTP 200 when the TUS offsets are exact but Bunny's
// `storageSize` is still zero, deliberately so the client's ~2s loop retries.
// That is correct for a transient registration lag. It had NO bound, so a
// provider-side stall — bytes fully delivered, object never committed — was
// indistinguishable from a two-second lag: 120 acknowledgements in 346 seconds,
// every one HTTP 200, every one a database no-op, `updated_at` frozen at job
// creation, and the user watching "Finishing upload…" forever.
//
// WHY 90 SECONDS:
//   • This deadline covers a transfer that is ALREADY COMPLETE (exact TUS
//     offset equality against Bunny's own HEAD is the precondition for
//     reaching it). It is not an encoding deadline — #2905's 12h stall sweep
//     owns encoding and is deliberately untouched here.
//   • The slowest HEALTHY job on this pipeline had its full derivative set
//     live ~21s after TUS completion (#2905 recovery job e055c562); a positive
//     `storageSize` appears well before the derivatives do. 90s is >4x the
//     slowest healthy case end-to-end.
//   • It is ~45 client poll cycles at the 2s loop interval, so a genuinely
//     slow-but-alive Bunny gets dozens of chances before we call it dead.
//   • It bounds the user's wait at a minute and a half instead of eleven more
//     hours of spinner (the #2967 job's TUS resource died at 14:30:08 and the
//     12h sweep would not have touched it until 01:30).
export const SOURCE_ACK_DEADLINE_MS = Number.parseInt(
  Deno.env.get("EVENT_COVER_SOURCE_ACK_DEADLINE_MS") ?? "90000",
  10,
);

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

// The acknowledgement clock lives under its own `source_ack` key so it can
// never collide with the `source_upload` receipt the success path writes (that
// receipt is what `sourceUploadedAtFromPayload` reads for `sourceUploadedAt`).
const mergeAckPayload = (
  existing: unknown,
  ack: Record<string, unknown>,
): Record<string, unknown> => ({
  ...asRecord(existing),
  source_ack: { ...asRecord(asRecord(existing).source_ack), ...ack },
});

const ackClockStartedAtMs = (providerPayload: unknown): number | null => {
  const value = asRecord(asRecord(providerPayload).source_ack).tus_complete_at;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const expiresAtMs = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const defaultDeps = {
  bunnyGetVideo,
  bunnyPresignTusUpload,
  destroyCoverVideoAsset,
  requireBrandCoverManager,
  requireCoverVideoTargetManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
};

export const handleEventCoverVideoSourceUploaded = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await deps.requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: {
    target?: string;
    jobId?: string;
    eventId?: string;
    brandId?: string;
    providerUploadResponse?: ProviderUploadResponse | null;
    clientRequestId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }

  const requestId = safeString(body.clientRequestId) ?? crypto.randomUUID();
  const targetKind = body.target === "brand" || body.target === "venue" ||
      body.target === "venue_draft"
    ? body.target
    : "event";
  if (!isValidUuid(body.jobId)) {
    return jsonResponse({
      error: "validation_error",
      detail: "job_id_invalid_uuid",
    }, 400);
  }
  const supabase = deps.serviceRoleClient();
  const { data: job, error: jobError } = await supabase
    .from("event_cover_video_jobs")
    .select("*")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) {
    console.error(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        code: jobError.code,
        requestId,
        stage: "job_read_failed",
      }),
    );
    return jsonResponse(
      { error: "internal_error", detail: "job_read_failed" },
      500,
    );
  }
  if (!job) {
    return jsonResponse({ error: "not_found", detail: "job_not_found" }, 404);
  }
  const allowed = await deps.requireCoverVideoTargetManager(supabase, {
    targetKind: job.target_kind,
    eventId: job.event_id,
    brandId: job.brand_id,
    venueId: job.venue_id,
    draftOwnerKey: job.draft_owner_key,
    requestedBy: job.requested_by,
  }, userId);
  if (allowed instanceof Response) return allowed;
  // ORCH-0989: context match. Brand-target verifies brand_id + target_kind
  // (event_id is NULL); event-target verifies the event_id + brand_id pair.
  const contextMismatch = job.target_kind !== targetKind ||
    (body.brandId !== undefined && job.brand_id !== body.brandId) ||
    (body.eventId !== undefined && job.event_id !== body.eventId);
  if (contextMismatch) {
    return jsonResponse(
      { error: "forbidden", detail: "job_context_mismatch" },
      403,
    );
  }
  if (
    job.status === "failed" || job.status === "cancelled" ||
    job.status === "superseded"
  ) {
    return jsonResponse({
      error: "job_not_active",
      detail: job.status,
      status: mapEventCoverVideoStatus(job),
    }, 409);
  }

  if (job.status !== "source_uploading") {
    return jsonResponse(mapEventCoverVideoStatus(job));
  }

  // #966 — Bunny is the sole cover-video provider: IGNORE the client-declared
  // providerUpload payload; read the truth from Bunny (real bytes, real status).
  // The Vector-C source byte cap is enforced HERE against Bunny's storageSize,
  // never the client number. (The Cloudinary ack tail was removed as dead
  // residue post-META-1270.)
  const guid = safeString(job.source_asset_id);
  const video = await deps.bunnyGetVideo(guid ?? "");
  if (!video.ok) {
    // The video may not be registered yet — keep the job at source_uploading
    // and return its mapped status so the client re-acks / polls.
    console.log(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        jobId: job.id,
        reason: video.reason,
        requestId,
        stage: "bunny_get_pending",
      }),
    );
    return jsonResponse(mapEventCoverVideoStatus(job));
  }
  const storageSize = typeof video.video.storageSize === "number"
    ? video.video.storageSize
    : 0;
  const nowMs = Date.now();

  // #2967 — a job still in `source_uploading` whose TUS resource has EXPIRED
  // while Bunny reports NO committed object is a definite, detectable death:
  // the resumable resource is gone, so those bytes can never be re-offered
  // against this job and no later acknowledgement can ever succeed. Fail it
  // here instead of leaving it to #2905's 12h stall sweep — the production job
  // in this issue expired at 14:30:08 with `failure_code = NULL`, and the sweep
  // would not have touched it until 01:30 the next morning while the sheet said
  // "The video is uploaded."
  //
  // A POSITIVE storageSize means Bunny DID commit the object, so an expired
  // transport is irrelevant and this branch never fires — a user who returns to
  // a backgrounded upload an hour later still gets acknowledged, not killed.
  const tusExpiresAt = expiresAtMs(job.tus_expires_at);
  if (storageSize <= 0 && tusExpiresAt !== null && nowMs >= tusExpiresAt) {
    const { data: expiredJob } = await supabase.rpc(
      "cover_video_transition_job",
      {
        p_job_id: job.id,
        p_from_statuses: ["source_uploading"],
        p_to_status: "failed",
        p_provider_status: video.video.status,
        p_provider_progress: null,
        p_patch: {
          failure_code: "source_transport_expired",
          failure_message:
            "The upload session expired before the video service confirmed it.",
        },
      },
    );
    if (expiredJob?.status === "failed") await deps.destroyCoverVideoAsset(job);
    console.warn(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        jobId: job.id,
        requestId,
        stage: "tus_transport_expired",
        tusExpiresAt: job.tus_expires_at,
      }),
    );
    return jsonResponse(mapEventCoverVideoStatus(expiredJob ?? job));
  }

  const presign = await deps.bunnyPresignTusUpload(guid ?? "");
  let tusHead: Response;
  try {
    tusHead = await fetch(String(job.tus_resource_url ?? ""), {
      method: "HEAD",
      headers: {
        AuthorizationSignature: presign.authorizationSignature,
        AuthorizationExpire: String(presign.authorizationExpire),
        LibraryId: presign.libraryId,
        VideoId: presign.videoId,
        "Tus-Resumable": "1.0.0",
      },
    });
  } catch {
    return jsonResponse({ error: "upload_verification_pending" }, 503);
  }
  const uploadOffset = Number(tusHead.headers.get("upload-offset"));
  const uploadLength = Number(tusHead.headers.get("upload-length"));
  if (
    !tusHead.ok || uploadOffset !== job.source_bytes ||
    uploadLength !== job.source_bytes
  ) {
    return jsonResponse({
      error: "upload_incomplete",
      detail: { uploadOffset, uploadLength },
    }, 409);
  }
  if (storageSize <= 0) {
    // Bunny can acknowledge the exact completed TUS offset before its video
    // metadata exposes storageSize. This is provider registration lag, not an
    // incomplete upload: preserve canonical source_uploading truth so the
    // client's acknowledgement loop retries instead of failing a fully
    // uploaded source.
    //
    // #2967 — but BOUNDED. The offsets matching is the moment the transfer is
    // provably complete, so that is where the clock starts. It is recorded on
    // the job (this used to be a pure database no-op, which is why `updated_at`
    // stayed frozen through 120 acknowledgements) and read back on every later
    // pass.
    let ackStartedAtMs = ackClockStartedAtMs(job.provider_payload);
    if (ackStartedAtMs === null) {
      const { data: markedJob, error: markError } = await supabase
        .from("event_cover_video_jobs")
        .update({
          provider_payload: mergeAckPayload(job.provider_payload, {
            tus_complete_at: new Date(nowMs).toISOString(),
            tus_offset: uploadOffset,
          }),
        })
        .eq("id", job.id)
        .eq("status", "source_uploading")
        .select("*")
        .maybeSingle();
      if (markError || !markedJob) {
        // The clock could not be written. Do NOT silently pretend it was: say
        // so, and keep answering canonical retryable truth. The client-side
        // deadline is the backstop for exactly this case — that is why the
        // bound exists on both sides.
        console.warn(
          "[event-cover-video-source-uploaded]",
          JSON.stringify({
            code: markError?.code ?? null,
            jobId: job.id,
            requestId,
            stage: "ack_clock_write_failed",
          }),
        );
        return jsonResponse(mapEventCoverVideoStatus(job));
      }
      ackStartedAtMs = ackClockStartedAtMs(markedJob.provider_payload) ?? nowMs;
      console.log(
        "[event-cover-video-source-uploaded]",
        JSON.stringify({
          deadlineMs: SOURCE_ACK_DEADLINE_MS,
          jobId: job.id,
          requestId,
          stage: "ack_clock_started",
        }),
      );
      return jsonResponse(mapEventCoverVideoStatus(markedJob));
    }
    const waitedMs = nowMs - ackStartedAtMs;
    if (waitedMs >= SOURCE_ACK_DEADLINE_MS) {
      // Bunny took the bytes and never committed the object. This is not a lag
      // any longer: stop answering "still working" and give the caller a real,
      // retryable terminal failure it can act on.
      const { data: deadlineJob } = await supabase.rpc(
        "cover_video_transition_job",
        {
          p_job_id: job.id,
          p_from_statuses: ["source_uploading"],
          p_to_status: "failed",
          p_provider_status: video.video.status,
          p_provider_progress: null,
          p_patch: {
            failure_code: "source_ack_deadline_exceeded",
            failure_message:
              "The video service never confirmed this upload arrived.",
          },
        },
      );
      if (deadlineJob?.status === "failed") {
        await deps.destroyCoverVideoAsset(job);
      }
      console.warn(
        "[event-cover-video-source-uploaded]",
        JSON.stringify({
          deadlineMs: SOURCE_ACK_DEADLINE_MS,
          jobId: job.id,
          requestId,
          stage: "bunny_storage_metadata_deadline_exceeded",
          waitedMs,
        }),
      );
      return jsonResponse(mapEventCoverVideoStatus(deadlineJob ?? job));
    }
    console.log(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        deadlineMs: SOURCE_ACK_DEADLINE_MS,
        jobId: job.id,
        requestId,
        stage: "bunny_storage_metadata_pending",
        waitedMs,
      }),
    );
    return jsonResponse(mapEventCoverVideoStatus(job));
  }
  if (storageSize > MAX_SOURCE_VIDEO_BYTES) {
    const { data: failedJob } = await supabase.rpc(
      "cover_video_transition_job",
      {
        p_job_id: job.id,
        p_from_statuses: ["source_uploading"],
        p_to_status: "failed",
        p_provider_status: video.video.status,
        p_provider_progress: null,
        p_patch: {
          failure_code: "source_over_cap",
          failure_message: "Video source exceeded the maximum allowed size.",
        },
      },
    );
    if (failedJob?.status === "failed") await deps.destroyCoverVideoAsset(job);
    console.warn(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        jobId: job.id,
        maxSourceBytes: MAX_SOURCE_VIDEO_BYTES,
        requestId,
        stage: "bunny_source_over_cap",
        storageSize,
      }),
    );
    return jsonResponse(
      {
        error: "source_over_cap",
        detail: "source_over_cap",
        status: mapEventCoverVideoStatus(failedJob ?? job),
      },
      413,
    );
  }
  const bunnySourceUpload: Record<string, unknown> = {
    acknowledged_at: new Date().toISOString(),
    storageSize,
    length: typeof video.video.length === "number" ? video.video.length : null,
    bunny_status: video.video.status,
  };
  const { data: bunnyUpdatedJob, error: bunnyUpdateError } = await supabase
    .from("event_cover_video_jobs")
    .update({
      provider_payload: mergeProviderPayload(
        job.provider_payload,
        bunnySourceUpload,
      ),
      status: "source_uploaded",
      tus_upload_offset: uploadOffset,
    })
    .eq("id", job.id)
    .eq("status", "source_uploading")
    .select("*")
    .maybeSingle();
  if (bunnyUpdateError || !bunnyUpdatedJob) {
    // A webhook/cancel may win the source-upload CAS. Re-read and project that
    // canonical truth instead of turning a valid race into a synthetic 500.
    const { data: canonical, error: canonicalError } = await supabase
      .from("event_cover_video_jobs")
      .select("*")
      .eq("id", job.id)
      .maybeSingle();
    if (!canonicalError && canonical) {
      return jsonResponse(mapEventCoverVideoStatus(canonical));
    }
    console.error("[event-cover-video-source-uploaded] canonical read failed", {
      code: canonicalError?.code ?? bunnyUpdateError?.code,
      requestId,
    });
    return jsonResponse({
      error: "internal_error",
      detail: "source_uploaded_canonical_read_failed",
    }, 500);
  }
  console.log(
    "[event-cover-video-source-uploaded]",
    JSON.stringify({
      jobId: job.id,
      requestId,
      stage: "bunny_source_uploaded_acknowledged",
      status: bunnyUpdatedJob.status,
    }),
  );
  return jsonResponse(mapEventCoverVideoStatus(bunnyUpdatedJob));
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoSourceUploaded(req));
}
