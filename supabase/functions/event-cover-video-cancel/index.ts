import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireBrandCoverManager,
  requireCoverVideoTargetManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";
import { destroyIfUnreferenced } from "../_shared/coverVideoReap.ts";

const sourcePublicIdFromJob = (job: {
  source_public_id?: unknown;
  provider_payload?: unknown;
}): string | null => {
  if (
    typeof job.source_public_id === "string" &&
    job.source_public_id.trim().length > 0
  ) {
    return job.source_public_id.trim();
  }
  if (
    job.provider_payload === null || typeof job.provider_payload !== "object"
  ) {
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
  if (
    typeof payload.public_id === "string" && payload.public_id.trim().length > 0
  ) {
    return payload.public_id.trim();
  }
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: { jobId?: string };
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

  const supabase = serviceRoleClient();
  const { data: job, error: jobError } = await supabase
    .from("event_cover_video_jobs")
    .select("*")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) {
    console.error("[event-cover-video-cancel] job read failed", {
      code: jobError.code,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!job) {
    return jsonResponse({ error: "not_found", detail: "job_not_found" }, 404);
  }
  // ORCH-0989: brand-target gates on brand_admin; event-target on event_manager.
  const allowed = await requireCoverVideoTargetManager(supabase, {
    targetKind: job.target_kind,
    eventId: job.event_id,
    brandId: job.brand_id,
    venueId: job.venue_id,
    draftOwnerKey: job.draft_owner_key,
    requestedBy: job.requested_by,
  }, userId);
  if (allowed instanceof Response) return allowed;
  // #3040 (P2) — a READY ad video is still cancellable: the Host replaced it
  // before it reached the library. cover_video_cancel_once cancels it only
  // while no creative row exists for it, and a creative can never be created
  // for a cancelled job (trigger trg_ad_creatives_job_must_be_ready).
  const cancellableReadyAd = job.status === "ready" &&
    job.target_kind === "ad_creative";
  if (
    !cancellableReadyAd &&
    ["ready", "failed", "cancelled", "superseded", "applied"].includes(
      job.status,
    )
  ) {
    return jsonResponse(mapEventCoverVideoStatus(job));
  }

  const { data: updatedJob, error: updateError } = await supabase.rpc(
    "cover_video_cancel_once",
    { p_job_id: job.id },
  );
  if (updateError || !updatedJob) {
    console.error("[event-cover-video-cancel] cancel failed", {
      code: updateError?.code,
    });
    return jsonResponse(
      { error: "internal_error", detail: "cancel_failed" },
      500,
    );
  }

  // #3040 — the cancelled job's asset is reclaimed only through the
  // live-reference guard (I-VIDEO-SINGLE-GUARDED-DELETE), which also stamps
  // reaped_at. A referenced, retained or unknown answer leaves it for the
  // reaper, which asks again.
  if (updatedJob.status !== "cancelled") {
    return jsonResponse(mapEventCoverVideoStatus(updatedJob));
  }
  const outcome = await destroyIfUnreferenced(supabase, {
    id: job.id,
    provider: job.provider,
    source_asset_id: job.source_asset_id,
    source_public_id: sourcePublicIdFromJob(job),
    target_kind: job.target_kind,
    processed_url: job.processed_url,
  });
  if (outcome.outcome !== "destroyed" && outcome.outcome !== "no_asset") {
    console.warn("[event-cover-video-cancel] asset kept for the reaper:", {
      jobId: job.id,
      outcome: outcome.outcome,
    });
  }

  return jsonResponse(mapEventCoverVideoStatus(updatedJob));
});
