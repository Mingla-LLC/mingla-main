import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  destroyCoverVideoAsset,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireCoverVideoTargetManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";
// #3040 (B-5, B-14) — the cover a new video replaces is reclaimed through ONE
// shared path, scoped to the same target kind and target and guarded by live
// references (a trip-day gallery video sharing the events-row is never touched).
import { reapPriorCoverAssets } from "../_shared/coverVideoReap.ts";
// #3040 (C-4..C-8) — an ad video's library row is created server-side from the
// READY job itself; the client only asks for it to happen.
import { materializeAdCreativeFromJob } from "../_shared/adCreativeMaterialize.ts";

const defaultDeps = {
  destroyCoverVideoAsset,
  materializeAdCreativeFromJob,
  requireCoverVideoTargetManager,
  requireUserId,
  serviceRoleClient,
};

// deno-lint-ignore no-explicit-any
const creativeIdForJob = async (supabase: any, jobId: string) => {
  const { data } = await supabase
    .from("ad_creatives")
    .select("id")
    .eq("source_job_id", jobId)
    .maybeSingle();
  return typeof data?.id === "string" ? data.id : null;
};

export const handleEventCoverVideoApply = async (
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
    jobId?: string;
    expectedVersion?: number;
    expectedProcessedUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }
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
    console.error("[event-cover-video-apply] job read failed", {
      code: jobError.code,
    });
    return jsonResponse({ error: "internal_error" }, 500);
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
  const isAdVideo = job.target_kind === "ad_creative";
  if (job.status === "applied") {
    return jsonResponse({
      ok: true,
      replay: true,
      processedUrl: job.processed_url,
      posterUrl: job.processed_poster_url,
      status: mapEventCoverVideoStatus(job),
      ...(isAdVideo
        ? { creativeId: await creativeIdForJob(supabase, job.id) }
        : {}),
    });
  }
  if (
    job.status !== "ready" || !job.processed_url || !job.processed_poster_url
  ) {
    return jsonResponse({
      error: "job_not_ready",
      status: mapEventCoverVideoStatus(job),
    }, 409);
  }

  if (
    !Number.isInteger(body.expectedVersion) ||
    typeof body.expectedProcessedUrl !== "string"
  ) {
    return jsonResponse({
      error: "validation_error",
      detail: "apply_precondition_required",
    }, 400);
  }
  // #3040 (E-6c) — an ad video applies only once its library row exists; the
  // row is built from the job's own media, never from anything in this request.
  let creativeId: string | null = null;
  if (isAdVideo) {
    const made = await deps.materializeAdCreativeFromJob(supabase, job);
    if (!made.ok && made.retryable) {
      return jsonResponse({
        error: "creative_materialize_pending",
        retryable: true,
        status: mapEventCoverVideoStatus(job),
      }, 503);
    }
    if (!made.ok) {
      const terminal = made.code === "creative_source_untrusted";
      return jsonResponse({
        error: terminal ? "creative_source_untrusted" : "job_not_ready",
        status: mapEventCoverVideoStatus(job),
      }, 409);
    }
    creativeId = made.creativeId;
  }
  const { data: applied, error: applyError } = await supabase.rpc(
    "cover_video_apply_once",
    {
      p_job_id: job.id,
      p_expected_version: typeof body.expectedVersion === "number"
        ? body.expectedVersion
        : null,
      p_expected_url: typeof body.expectedProcessedUrl === "string"
        ? body.expectedProcessedUrl
        : null,
      p_expected_requested_by:
        job.target_kind === "venue_draft" || job.target_kind === "ad_creative"
          ? userId
          : null,
    },
  );
  if (applyError || !applied || applied.status !== "applied") {
    return jsonResponse({
      error: "job_not_ready",
      status: mapEventCoverVideoStatus(applied ?? job),
    }, 409);
  }
  // The target CAS and applied receipt are durable before any prior asset is
  // reclaimed. A stale/failed apply can therefore never delete the live cover.
  if (job.target_kind === "event" || job.target_kind === "brand") {
    await reapPriorCoverAssets(supabase, job, {
      destroyCoverVideoAsset: deps.destroyCoverVideoAsset,
    });
  }
  return jsonResponse({
    ok: true,
    processedUrl: applied.processed_url,
    posterUrl: applied.processed_poster_url,
    status: mapEventCoverVideoStatus(applied),
    ...(isAdVideo ? { creativeId } : {}),
  });
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoApply(req));
}
