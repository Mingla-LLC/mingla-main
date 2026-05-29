import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: { jobId?: string; eventId?: string; brandId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }

  const supabase = serviceRoleClient();
  let query = supabase.from("event_cover_video_jobs").select("*");
  if (isValidUuid(body.jobId)) {
    query = query.eq("id", body.jobId);
  } else if (isValidUuid(body.eventId)) {
    query = query.eq("event_id", body.eventId).order("created_at", { ascending: false }).limit(1);
  } else {
    return jsonResponse({ error: "validation_error", detail: "job_or_event_required" }, 400);
  }
  const { data: rows, error } = await query;
  if (error) {
    console.error("[event-cover-video-status] job read failed:", error);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  const job = Array.isArray(rows) ? rows[0] : rows;
  if (!job) return jsonResponse({ error: "not_found", detail: "job_not_found" }, 404);

  // ORCH-0989: brand-target gates on brand_admin; event-target on event_manager.
  const allowed =
    job.target_kind === "brand"
      ? await requireBrandCoverManager(supabase, job.brand_id, userId)
      : await requireEventManager(supabase, job.event_id, job.brand_id, userId);
  if (allowed instanceof Response) return allowed;

  return jsonResponse(mapEventCoverVideoStatus(job));
});
