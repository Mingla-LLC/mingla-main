import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
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
    .select("id,event_id,brand_id,status")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) {
    console.error("[event-cover-video-cancel] job read failed:", jobError);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!job) return jsonResponse({ error: "not_found", detail: "job_not_found" }, 404);
  const allowed = await requireEventManager(supabase, job.event_id, job.brand_id, userId);
  if (allowed instanceof Response) return allowed;
  if (job.status === "applied") return jsonResponse({ error: "already_applied" }, 409);

  await supabase
    .from("event_cover_video_jobs")
    .update({
      cancelled_at: new Date().toISOString(),
      failure_code: "user_cancelled",
      failure_message: "Cancelled by user.",
      status: "cancelled",
    })
    .eq("id", job.id);

  return jsonResponse({ ok: true });
});
