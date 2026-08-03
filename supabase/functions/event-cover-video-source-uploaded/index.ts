import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  destroyCoverVideoAsset,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  MAX_SOURCE_VIDEO_BYTES,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";
// #966 — Bunny is the sole cover-video provider (Cloudinary ack path removed).
import { bunnyGetVideo } from "../_shared/bunnyStream.ts";

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
  destroyCoverVideoAsset,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
};

export const handleEventCoverVideoSourceUploaded = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

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
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }

  const requestId = safeString(body.clientRequestId) ?? crypto.randomUUID();
  const targetKind = body.target === "brand" ? "brand" : "event";
  if (!isValidUuid(body.jobId)) {
    return jsonResponse({ error: "validation_error", detail: "job_id_invalid_uuid" }, 400);
  }
  // ORCH-0989: event-target requires eventId; brand-target has none.
  if (targetKind === "event" && !isValidUuid(body.eventId)) {
    return jsonResponse({ error: "validation_error", detail: "event_id_invalid_uuid" }, 400);
  }
  if (!isValidUuid(body.brandId)) {
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }

  const supabase = deps.serviceRoleClient();
  const allowed =
    targetKind === "brand"
      ? await deps.requireBrandCoverManager(supabase, body.brandId as string, userId)
      : await deps.requireEventManager(supabase, body.eventId as string, body.brandId as string, userId);
  if (allowed instanceof Response) return allowed;

  const { data: job, error: jobError } = await supabase
    .from("event_cover_video_jobs")
    .select("*")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) {
    console.error("[event-cover-video-source-uploaded]", JSON.stringify({
      code: jobError.code,
      details: jobError.details,
      hint: jobError.hint,
      message: jobError.message,
      requestId,
      stage: "job_read_failed",
    }));
    return jsonResponse({ error: "internal_error", detail: "job_read_failed" }, 500);
  }
  if (!job) return jsonResponse({ error: "not_found", detail: "job_not_found" }, 404);
  // ORCH-0989: context match. Brand-target verifies brand_id + target_kind
  // (event_id is NULL); event-target verifies the event_id + brand_id pair.
  const contextMismatch =
    targetKind === "brand"
      ? job.target_kind !== "brand" || job.brand_id !== body.brandId
      : job.event_id !== body.eventId || job.brand_id !== body.brandId;
  if (contextMismatch) {
    return jsonResponse({ error: "forbidden", detail: "job_context_mismatch" }, 403);
  }
  if (job.status === "failed" || job.status === "cancelled") {
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
    console.log("[event-cover-video-source-uploaded]", JSON.stringify({
      jobId: job.id,
      reason: video.reason,
      requestId,
      stage: "bunny_get_pending",
    }));
    return jsonResponse(mapEventCoverVideoStatus(job));
  }
  const storageSize =
    typeof video.video.storageSize === "number" ? video.video.storageSize : 0;
  if (storageSize > MAX_SOURCE_VIDEO_BYTES) {
    await deps.destroyCoverVideoAsset(job);
    const { data: failedJob } = await supabase
      .from("event_cover_video_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        failure_code: "source_over_cap",
        failure_message: "Video source exceeded the maximum allowed size.",
      })
      .eq("id", job.id)
      .select("*")
      .maybeSingle();
    console.warn("[event-cover-video-source-uploaded]", JSON.stringify({
      jobId: job.id,
      maxSourceBytes: MAX_SOURCE_VIDEO_BYTES,
      requestId,
      stage: "bunny_source_over_cap",
      storageSize,
    }));
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
      provider_payload: mergeProviderPayload(job.provider_payload, bunnySourceUpload),
      status: "source_uploaded",
    })
    .eq("id", job.id)
    .eq("status", "source_uploading")
    .select("*")
    .maybeSingle();
  if (bunnyUpdateError || !bunnyUpdatedJob) {
    console.error("[event-cover-video-source-uploaded]", JSON.stringify({
      code: bunnyUpdateError?.code,
      jobId: job.id,
      message: bunnyUpdateError?.message,
      requestId,
      stage: "bunny_source_uploaded_update_failed",
    }));
    return jsonResponse(
      { error: "internal_error", detail: "source_uploaded_update_failed" },
      500,
    );
  }
  console.log("[event-cover-video-source-uploaded]", JSON.stringify({
    jobId: job.id,
    requestId,
    stage: "bunny_source_uploaded_acknowledged",
    status: bunnyUpdatedJob.status,
  }));
  return jsonResponse(mapEventCoverVideoStatus(bunnyUpdatedJob));
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoSourceUploaded(req));
}
