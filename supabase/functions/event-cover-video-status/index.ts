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
    target?: "event" | "brand" | "venue" | "venue_draft";
    eventId?: string;
    brandId?: string;
    venueId?: string;
    draftOwnerKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }

  const supabase = serviceRoleClient();
  const hasJobSelector = body.jobId !== undefined;
  const hasTargetSelector = body.target !== undefined ||
    body.eventId !== undefined || body.brandId !== undefined ||
    body.venueId !== undefined || body.draftOwnerKey !== undefined;
  if (hasJobSelector === hasTargetSelector) {
    return jsonResponse({
      error: "validation_error",
      detail: "exactly_one_status_selector_required",
    }, 400);
  }
  if (hasJobSelector && !isValidUuid(body.jobId)) {
    return jsonResponse({
      error: "validation_error",
      detail: "job_id_invalid_uuid",
    }, 400);
  }
  if (
    hasTargetSelector &&
    !["event", "brand", "venue", "venue_draft"].includes(body.target ?? "")
  ) {
    return jsonResponse({
      error: "validation_error",
      detail: "target_kind_invalid",
    }, 400);
  }
  let query = supabase.from("event_cover_video_jobs").select("*");
  if (isValidUuid(body.jobId)) {
    query = query.eq("id", body.jobId);
  } else {
    if (!isValidUuid(body.brandId)) {
      return jsonResponse({
        error: "validation_error",
        detail: "brand_id_invalid_uuid",
      }, 400);
    }
    const targetKind = body.target ?? "event";
    const selector = {
      targetKind,
      eventId: targetKind === "event" ? body.eventId ?? null : null,
      brandId: body.brandId,
      venueId: targetKind === "venue" ? body.venueId ?? null : null,
      draftOwnerKey: targetKind === "venue_draft"
        ? body.draftOwnerKey ?? null
        : null,
      requestedBy: targetKind === "venue_draft" ? userId : null,
    } as const;
    const selectorAllowed = await requireCoverVideoTargetManager(
      supabase,
      selector,
      userId,
    );
    if (selectorAllowed instanceof Response) return selectorAllowed;
    query = query.eq("target_kind", targetKind).eq("brand_id", body.brandId);
    if (targetKind === "event") query = query.eq("event_id", body.eventId);
    if (targetKind === "venue") query = query.eq("venue_id", body.venueId);
    if (targetKind === "venue_draft") {
      query = query.eq("draft_owner_key", body.draftOwnerKey).eq(
        "requested_by",
        userId,
      );
    }
    query = query.order("created_at", { ascending: false }).limit(1);
  }
  const { data: rows, error } = await query;
  if (error) {
    console.error("[event-cover-video-status] job read failed", {
      code: error.code,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  const job = Array.isArray(rows) ? rows[0] : rows;
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

  return jsonResponse(mapEventCoverVideoStatus(job));
});
