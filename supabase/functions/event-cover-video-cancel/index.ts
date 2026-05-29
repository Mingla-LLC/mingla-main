import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  cloudinaryDestroy,
  corsHeaders,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";

const sourcePublicIdFromJob = (job: {
  source_public_id?: unknown;
  provider_payload?: unknown;
}): string | null => {
  if (typeof job.source_public_id === "string" && job.source_public_id.trim().length > 0) {
    return job.source_public_id.trim();
  }
  if (job.provider_payload === null || typeof job.provider_payload !== "object") {
    return null;
  }
  const payload = job.provider_payload as {
    public_id?: unknown;
    source_upload?: { public_id?: unknown };
  };
  const nestedPublicId = payload.source_upload?.public_id;
  if (typeof nestedPublicId === "string" && nestedPublicId.trim().length > 0) {
    return nestedPublicId.trim();
  }
  if (typeof payload.public_id === "string" && payload.public_id.trim().length > 0) {
    return payload.public_id.trim();
  }
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  if (!isValidUuid(body.jobId)) {
    return jsonResponse({ error: "validation_error", detail: "job_id_invalid_uuid" }, 400);
  }

  const supabase = serviceRoleClient();
  const { data: job, error: jobError } = await supabase
    .from("event_cover_video_jobs")
    .select("*")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) {
    console.error("[event-cover-video-cancel] job read failed:", jobError);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!job) return jsonResponse({ error: "not_found", detail: "job_not_found" }, 404);
  // ORCH-0989: brand-target gates on brand_admin; event-target on event_manager.
  const allowed =
    job.target_kind === "brand"
      ? await requireBrandCoverManager(supabase, job.brand_id, userId)
      : await requireEventManager(supabase, job.event_id, job.brand_id, userId);
  if (allowed instanceof Response) return allowed;
  if (["ready", "failed", "cancelled", "applied"].includes(job.status)) {
    return jsonResponse(mapEventCoverVideoStatus(job));
  }

  const { data: updatedJob, error: updateError } = await supabase
    .from("event_cover_video_jobs")
    .update({
      cancelled_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      failure_code: "user_cancelled",
      failure_message: "Cancelled by user.",
      status: "cancelled",
    })
    .eq("id", job.id)
    .select("*")
    .maybeSingle();
  if (updateError || !updatedJob) {
    console.error("[event-cover-video-cancel] cancel failed:", updateError);
    return jsonResponse({ error: "internal_error", detail: "cancel_failed" }, 500);
  }

  const sourcePublicId = sourcePublicIdFromJob(job);
  if (sourcePublicId !== null) {
    const destroyResult = await cloudinaryDestroy(sourcePublicId);
    if (!destroyResult.ok) {
      console.warn("[event-cover-video-cancel] cloudinary destroy failed:", {
        jobId: job.id,
        publicId: sourcePublicId,
        reason: destroyResult.reason,
      });
    }
  }

  return jsonResponse(mapEventCoverVideoStatus(updatedJob));
});
