import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  destroyCoverVideoAsset,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireBrandCoverManager,
  requireCoverVideoTargetManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";

// META-ORCH-1270 (Phase 2) — cover-replace reaping. Before a new cover overwrites
// a prior applied one, reclaim the PRIOR applied Bunny asset for this target so
// it does not linger. Bunny-only (Cloudinary rows carry no source_asset_id; their
// reaping is out of scope until Phase 4). Best-effort; never fails the apply.
// deno-lint-ignore no-explicit-any
const reapPriorAppliedBunnyCover = async (
  supabase: any,
  job: {
    id: string;
    provider?: string | null;
    target_kind?: string | null;
    event_id?: string | null;
    brand_id: string;
  },
): Promise<void> => {
  if (job.provider !== "bunny") return;
  const base = supabase
    .from("event_cover_video_jobs")
    .select("id,provider,source_asset_id,source_public_id")
    .eq("status", "applied")
    .eq("provider", "bunny")
    .neq("id", job.id)
    .not("source_asset_id", "is", null)
    .is("reaped_at", null);
  const scoped = job.target_kind === "brand"
    ? base.eq("brand_id", job.brand_id).eq("target_kind", "brand")
    : base.eq("event_id", job.event_id as string);
  const { data, error } = await scoped;
  if (error) return;
  for (
    const row of (data ?? []) as Array<
      {
        id: string;
        provider?: string | null;
        source_asset_id?: unknown;
        source_public_id?: unknown;
      }
    >
  ) {
    const destroyed = await destroyCoverVideoAsset(row);
    if (destroyed.ok) {
      await supabase
        .from("event_cover_video_jobs")
        .update({ reaped_at: new Date().toISOString() })
        .eq("id", row.id);
    } else {
      console.warn("[event-cover-video-apply] prior cover reap failed:", {
        jobId: row.id,
        reason: destroyed.reason,
      });
    }
  }
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

  const supabase = serviceRoleClient();
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
  const allowed = await requireCoverVideoTargetManager(supabase, {
    targetKind: job.target_kind,
    eventId: job.event_id,
    brandId: job.brand_id,
    venueId: job.venue_id,
    draftOwnerKey: job.draft_owner_key,
    requestedBy: job.requested_by,
  }, userId);
  if (allowed instanceof Response) return allowed;
  if (job.status === "applied") {
    return jsonResponse({
      ok: true,
      replay: true,
      processedUrl: job.processed_url,
      posterUrl: job.processed_poster_url,
      status: mapEventCoverVideoStatus(job),
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
      p_expected_requested_by: job.target_kind === "venue_draft"
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
    await reapPriorAppliedBunnyCover(supabase, job);
  }
  return jsonResponse({
    ok: true,
    processedUrl: applied.processed_url,
    posterUrl: applied.processed_poster_url,
    status: mapEventCoverVideoStatus(applied),
  });
});
