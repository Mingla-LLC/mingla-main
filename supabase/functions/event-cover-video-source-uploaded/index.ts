import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";

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

const safeNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeProviderUpload = (
  providerUploadResponse: ProviderUploadResponse | null | undefined,
): Record<string, unknown> => ({
  acknowledged_at: new Date().toISOString(),
  asset_id: safeString(providerUploadResponse?.asset_id),
  bytes: safeNumber(providerUploadResponse?.bytes),
  duration: safeNumber(providerUploadResponse?.duration),
  format: safeString(providerUploadResponse?.format),
  public_id: safeString(providerUploadResponse?.public_id),
  resource_type: safeString(providerUploadResponse?.resource_type),
});

const mergeProviderPayload = (
  existing: unknown,
  sourceUpload: Record<string, unknown>,
): Record<string, unknown> => ({
  ...(existing !== null && typeof existing === "object"
    ? existing as Record<string, unknown>
    : {}),
  source_upload: sourceUpload,
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: {
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
  if (!isValidUuid(body.jobId)) {
    return jsonResponse({ error: "validation_error", detail: "job_id_invalid_uuid" }, 400);
  }
  if (!isValidUuid(body.eventId)) {
    return jsonResponse({ error: "validation_error", detail: "event_id_invalid_uuid" }, 400);
  }
  if (!isValidUuid(body.brandId)) {
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }

  const supabase = serviceRoleClient();
  const allowed = await requireEventManager(supabase, body.eventId, body.brandId, userId);
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
  if (job.event_id !== body.eventId || job.brand_id !== body.brandId) {
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

  const sourceUpload = sanitizeProviderUpload(body.providerUploadResponse);
  const sourcePublicId = safeString(body.providerUploadResponse?.public_id);
  const sourceAssetId = safeString(body.providerUploadResponse?.asset_id);
  const { data: updatedJob, error: updateError } = await supabase
    .from("event_cover_video_jobs")
    .update({
      provider_payload: mergeProviderPayload(job.provider_payload, sourceUpload),
      ...(sourceAssetId !== null ? { source_asset_id: sourceAssetId } : {}),
      ...(sourcePublicId !== null ? { source_public_id: sourcePublicId } : {}),
      status: "source_uploaded",
    })
    .eq("id", job.id)
    .eq("status", "source_uploading")
    .select("*")
    .maybeSingle();
  if (updateError || !updatedJob) {
    console.error("[event-cover-video-source-uploaded]", JSON.stringify({
      code: updateError?.code,
      details: updateError?.details,
      hint: updateError?.hint,
      jobId: job.id,
      message: updateError?.message,
      requestId,
      stage: "source_uploaded_update_failed",
    }));
    return jsonResponse(
      { error: "internal_error", detail: "source_uploaded_update_failed" },
      500,
    );
  }

  console.log("[event-cover-video-source-uploaded]", JSON.stringify({
    jobId: job.id,
    requestId,
    stage: "source_uploaded_acknowledged",
    status: updatedJob.status,
  }));
  return jsonResponse(mapEventCoverVideoStatus(updatedJob));
});
