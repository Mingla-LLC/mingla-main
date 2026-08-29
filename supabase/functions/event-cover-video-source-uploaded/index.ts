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
    !tusHead.ok || storageSize <= 0 || uploadOffset !== job.source_bytes ||
    uploadLength !== job.source_bytes
  ) {
    return jsonResponse({
      error: "upload_incomplete",
      detail: { uploadOffset, uploadLength },
    }, 409);
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
