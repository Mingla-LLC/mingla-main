import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
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

// ── #3040 THE ACKNOWLEDGEMENT GATE IS THE TRANSFER, NOT THE ENCODE ──────────
//
// THE DEFECT THIS REPLACES (#3039, proven from production):
//   `storageSize` is a POST-ENCODE signal and it was being used as a
//   TRANSFER-COMPLETE gate. Job e055c562 reported storageSize = 14,808,154
//   together with bunny_status = 4 (Finished) at 21s — the value became
//   non-zero BECAUSE encoding finished, not because the bytes landed. So
//   acknowledgement waited for the whole encode. #2967 then bounded that wait
//   at 90s and DESTROYED the Bunny asset on breach, which deleted videos Bunny
//   was still encoding (jobs 07d737b3 and aafe4ef9, 404 on everything).
//
// THE GATE THAT IS ACTUALLY CORRECT:
//   Exact TUS offset equality read from Bunny's OWN authoritative HEAD
//   (uploadOffset === uploadLength === source_bytes) is complete proof the
//   transfer finished. Nothing else is needed and nothing else is waited for.
//   Acknowledge there, advance the job to `source_uploaded`, and let the
//   webhook + reaper own encode completion — that path works and #2905
//   proved it (its 12h stall deadline is the encode bound and is untouched).
//
// THREE STRUCTURAL CONSEQUENCES, each load-bearing:
//   1. `bunnyGetVideo` is NEVER a gate any more. It is read best-effort for
//      provider metadata AFTER the transfer is already proven. The old
//      `bunny_get_pending` branch was a second unbounded 200/"keep waiting"
//      shape and it is gone.
//   2. THIS FUNCTION DESTROYS NOTHING, EVER. Asset reclamation has exactly one
//      owner — `event-cover-video-reaper`, which re-reads provider truth
//      before it deletes and skips anything still processing. An endpoint that
//      cannot see whether the provider is mid-encode must not be allowed to
//      delete (issue #3040 invariant 1). `destroyCoverVideoAsset` is therefore
//      not imported here.
//   3. There is no acknowledgement deadline, so there is no
//      `EVENT_COVER_SOURCE_ACK_DEADLINE_MS`. The 30-minute production override
//      that is currently suppressing the destruction is no longer read by
//      anything and can be removed once this deploys.
//
// The only remaining wait is on a transfer that is genuinely INCOMPLETE, and
// that is bounded by the TUS lease (`tus_expires_at`, 1h) — checked below and
// swept server-side by the reaper for a client that never returns.

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const expiresAtMs = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const defaultDeps = {
  bunnyGetVideo,
  bunnyPresignTusUpload,
  requireBrandCoverManager,
  requireCoverVideoTargetManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
};

// The authoritative transfer verdict, read from Bunny's own TUS HEAD.
//   "complete"   — uploadOffset === uploadLength === source_bytes. PROOF.
//   "incomplete" — the HEAD answered and the bytes are demonstrably not all
//                  there yet.
//   "unreadable" — we could not ask (no guid/resource yet, network failure).
//                  NEVER treated as either proof or failure.
export type TusTransferVerdict =
  | { kind: "complete"; uploadOffset: number; uploadLength: number }
  | { kind: "incomplete"; uploadOffset: number; uploadLength: number }
  | { kind: "unreadable"; reason: string };

// EXPORTED so `event-cover-video-reaper` can ask the SAME question with the
// SAME implementation when it sweeps an abandoned job (#3040 invariant 7).
// "Did the transfer finish?" must have exactly one answer in this codebase.
export const readTusTransfer = async (
  sourceBytes: number,
  guid: string | null,
  tusResourceUrl: string | null,
  deps: { bunnyPresignTusUpload: typeof bunnyPresignTusUpload },
): Promise<TusTransferVerdict> => {
  if (guid === null || tusResourceUrl === null) {
    return { kind: "unreadable", reason: "transport_not_allocated" };
  }
  const presign = await deps.bunnyPresignTusUpload(guid);
  let tusHead: Response;
  try {
    tusHead = await fetch(tusResourceUrl, {
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
    return { kind: "unreadable", reason: "tus_head_network" };
  }
  if (!tusHead.ok) {
    return { kind: "unreadable", reason: `tus_head_http_${tusHead.status}` };
  }
  const uploadOffset = Number(tusHead.headers.get("upload-offset"));
  const uploadLength = Number(tusHead.headers.get("upload-length"));
  const complete = uploadOffset === sourceBytes && uploadLength === sourceBytes;
  return complete
    ? { kind: "complete", uploadOffset, uploadLength }
    : { kind: "incomplete", uploadOffset, uploadLength };
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

  const guid = safeString(job.source_asset_id);
  const tusResourceUrl = safeString(job.tus_resource_url);
  const nowMs = Date.now();

  // ── #3040 STEP 1: read the ONLY signal that proves the transfer finished ──
  // Bunny's own TUS HEAD. This runs BEFORE any provider-metadata read, because
  // provider metadata is no longer allowed to gate anything.
  const transfer = await readTusTransfer(
    job.source_bytes,
    guid,
    tusResourceUrl,
    deps,
  );

  // ── #3040 STEP 2: exact offset equality IS the acknowledgement ────────────
  // Whatever Bunny's encode state, whatever `storageSize` says, and even if the
  // TUS lease has since expired: the bytes are on Bunny, verified against
  // Bunny's own HEAD. Advance the job and hand encoding to the webhook/reaper.
  if (transfer.kind === "complete") {
    // #966 — the source byte cap is still enforced against a PROVIDER number,
    // never the client's. `uploadLength` is Bunny's own record of the resource
    // size and `uploadOffset` proves that many bytes actually arrived, so it is
    // a strictly better cap subject than `storageSize` — which counts the
    // encoded renditions too (14,808,154 stored for a 3,050,776-byte source on
    // job e055c562) and therefore over-rejected large-but-legal sources.
    if (transfer.uploadLength > MAX_SOURCE_VIDEO_BYTES) {
      const { data: failedJob } = await supabase.rpc(
        "cover_video_transition_job",
        {
          p_job_id: job.id,
          p_from_statuses: ["source_uploading"],
          p_to_status: "failed",
          p_provider_status: null,
          p_provider_progress: null,
          p_patch: {
            failure_code: "source_over_cap",
            failure_message: "Video source exceeded the maximum allowed size.",
          },
        },
      );
      // #3040 — deliberately NO destroy. The job is terminal-failed and carries
      // its guid, so the reaper reclaims the asset on its next tick with
      // provider truth in hand. This endpoint cannot see whether Bunny is
      // mid-encode, so it is not allowed to delete.
      console.warn(
        "[event-cover-video-source-uploaded]",
        JSON.stringify({
          jobId: job.id,
          maxSourceBytes: MAX_SOURCE_VIDEO_BYTES,
          requestId,
          stage: "tus_source_over_cap",
          uploadLength: transfer.uploadLength,
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
    // Provider metadata is recorded for observability only. A failed read is
    // NOT a reason to withhold acknowledgement — that inversion is the whole
    // bug this issue exists to remove.
    const video = await deps.bunnyGetVideo(guid ?? "");
    const bunnySourceUpload: Record<string, unknown> = {
      acknowledged_at: new Date(nowMs).toISOString(),
      // #3040 — the acknowledged size is the TRANSFERRED size (Bunny's TUS
      // upload-length). `storageSize` is recorded beside it when it happens to
      // be available, purely as an encode-progress observation.
      transferredBytes: transfer.uploadLength,
      storageSize: video.ok && typeof video.video.storageSize === "number"
        ? video.video.storageSize
        : null,
      length: video.ok && typeof video.video.length === "number"
        ? video.video.length
        : null,
      bunny_status: video.ok ? video.video.status : null,
    };
    const { data: bunnyUpdatedJob, error: bunnyUpdateError } = await supabase
      .from("event_cover_video_jobs")
      .update({
        provider_payload: mergeProviderPayload(
          job.provider_payload,
          bunnySourceUpload,
        ),
        status: "source_uploaded",
        tus_upload_offset: transfer.uploadOffset,
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
      console.error(
        "[event-cover-video-source-uploaded] canonical read failed",
        {
          code: canonicalError?.code ?? bunnyUpdateError?.code,
          requestId,
        },
      );
      return jsonResponse({
        error: "internal_error",
        detail: "source_uploaded_canonical_read_failed",
      }, 500);
    }
    console.log(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        bunnyStatus: video.ok ? video.video.status : null,
        jobId: job.id,
        requestId,
        stage: "tus_transfer_proven_acknowledged",
        status: bunnyUpdatedJob.status,
        uploadOffset: transfer.uploadOffset,
      }),
    );
    return jsonResponse(mapEventCoverVideoStatus(bunnyUpdatedJob));
  }

  // ── #3040 STEP 3: the transfer is NOT complete. Is the transport dead? ────
  // Reaching here means the bytes are provably not all on Bunny (or we could
  // not ask). If the TUS lease has expired, the resumable resource is gone and
  // those bytes can never be re-offered against this job: that is a definite,
  // detectable death, so fail it now with a real `failure_code` rather than
  // leaving a spinner for the 12h stall sweep.
  //
  // ORDER IS LOAD-BEARING: this check sits AFTER the transfer proof, so a
  // completed upload whose lease expired while the user was away is
  // acknowledged (step 2), never killed. #2967 placed it before the HEAD and
  // gated it on `storageSize <= 0`, which made an expired lease lethal to a
  // fully-transferred, still-encoding video.
  const tusExpiresAt = expiresAtMs(job.tus_expires_at);
  if (tusExpiresAt !== null && nowMs >= tusExpiresAt) {
    const { data: expiredJob } = await supabase.rpc(
      "cover_video_transition_job",
      {
        p_job_id: job.id,
        p_from_statuses: ["source_uploading"],
        p_to_status: "failed",
        p_provider_status: null,
        p_provider_progress: null,
        p_patch: {
          failure_code: "source_transport_expired",
          failure_message:
            "The upload session expired before the video finished uploading.",
        },
      },
    );
    // #3040 — no destroy here either. See the header note: reclamation is the
    // reaper's, and only the reaper's.
    console.warn(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        jobId: job.id,
        requestId,
        stage: "tus_transport_expired",
        transfer: transfer.kind,
        tusExpiresAt: job.tus_expires_at,
      }),
    );
    return jsonResponse(mapEventCoverVideoStatus(expiredJob ?? job));
  }

  // ── #3040 STEP 4: transfer incomplete, transport still alive ─────────────
  // Answer definitely, never with a 200 that means "nothing happened". The
  // client resumes the TUS transfer from `uploadOffset`; the lease bounds it.
  if (transfer.kind === "unreadable") {
    console.log(
      "[event-cover-video-source-uploaded]",
      JSON.stringify({
        jobId: job.id,
        reason: transfer.reason,
        requestId,
        stage: "tus_head_unreadable",
      }),
    );
    return jsonResponse({
      error: "upload_verification_pending",
      detail: transfer.reason,
    }, 503);
  }
  return jsonResponse({
    error: "upload_incomplete",
    detail: {
      uploadOffset: transfer.uploadOffset,
      uploadLength: transfer.uploadLength,
    },
  }, 409);
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoSourceUploaded(req));
}
