import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  destroyCoverVideoAsset,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireBrandCoverManager,
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
  job: { id: string; provider?: string | null; target_kind?: string | null; event_id?: string | null; brand_id: string },
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
      { id: string; provider?: string | null; source_asset_id?: unknown; source_public_id?: unknown }
    >
  ) {
    const destroyed = await destroyCoverVideoAsset(row);
    if (destroyed.ok) {
      await supabase
        .from("event_cover_video_jobs")
        .update({ reaped_at: new Date().toISOString() })
        .eq("id", row.id);
    } else {
      console.warn("[event-cover-video-apply] prior cover reap failed:", { jobId: row.id, reason: destroyed.reason });
    }
  }
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
    console.error("[event-cover-video-apply] job read failed:", jobError);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!job) return jsonResponse({ error: "not_found", detail: "job_not_found" }, 404);
  const isBrandTarget = job.target_kind === "brand";
  // ORCH-0989: brand-target gates on brand_admin; event-target keeps event_manager.
  const allowed = isBrandTarget
    ? await requireBrandCoverManager(supabase, job.brand_id, userId)
    : await requireEventManager(supabase, job.event_id, job.brand_id, userId);
  if (allowed instanceof Response) return allowed;
  if (job.status !== "ready" || !job.processed_url) {
    return jsonResponse({
      error: "job_not_ready",
      status: mapEventCoverVideoStatus(job),
    }, 409);
  }

  // META-ORCH-1270 (Phase 2) — reclaim the prior applied Bunny cover for this
  // target BEFORE overwriting cover_media_url, so the replaced asset is not left
  // orphaned in the library.
  await reapPriorAppliedBunnyCover(supabase, job);

  if (isBrandTarget) {
    // ORCH-0989: brand target writes brands.cover_media_url (not events).
    const { error: brandUpdateError } = await supabase
      .from("brands")
      .update({
        cover_media_type: "video",
        cover_media_url: job.processed_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.brand_id)
      .is("deleted_at", null);
    if (brandUpdateError) {
      console.error("[event-cover-video-apply] brand update failed:", brandUpdateError);
      return jsonResponse({ error: "internal_error" }, 500);
    }
  } else {
    const { error: updateError } = await supabase
      .from("events")
      .update({
        cover_media_type: "video",
        cover_media_url: job.processed_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.event_id)
      .is("deleted_at", null);
    if (updateError) {
      console.error("[event-cover-video-apply] event update failed:", updateError);
      return jsonResponse({ error: "internal_error" }, 500);
    }
  }
  await supabase
    .from("event_cover_video_jobs")
    .update({
      applied_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: "applied",
    })
    .eq("id", job.id);

  return jsonResponse({ ok: true, processedUrl: job.processed_url });
});
