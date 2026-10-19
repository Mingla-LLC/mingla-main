import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  requireCoverVideoTargetManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";

// #3040 (A-3, A-6) — a client opening a sheet asks only for work still in
// flight (or finished and waiting to be applied). A finished, failed or
// cancelled job from an earlier visit is never handed back to be re-emitted.
// Without the flag the latest job is returned exactly as before (old clients).
// MINGLA-INVARIANT: I-VIDEO-NO-RESURRECT | issue #3040 | opening a sheet never re-emits a finished, failed or cancelled job not started by this device
export const ACTIVE_STATUS_SET = [
  "source_uploading",
  "source_uploaded",
  "processing_queued",
  "processing",
  "ready",
];

const TARGET_KINDS = [
  "event",
  "brand",
  "venue",
  "venue_draft",
  "trip_day_media",
  "ad_creative",
] as const;

const defaultDeps = {
  requireCoverVideoTargetManager,
  requireUserId,
  serviceRoleClient,
};

export const handleEventCoverVideoStatus = async (
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
    target?: (typeof TARGET_KINDS)[number];
    eventId?: string;
    brandId?: string | null;
    venueId?: string;
    draftOwnerKey?: string;
    activeOnly?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }

  const supabase = deps.serviceRoleClient();
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
    !(TARGET_KINDS as readonly string[]).includes(body.target ?? "")
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
    const targetKind = body.target ?? "event";
    // #3040 — only an ad_creative selector may be brandless (house library).
    const brandId = targetKind === "ad_creative" &&
        (body.brandId === undefined || body.brandId === null)
      ? null
      : body.brandId;
    if (brandId !== null && !isValidUuid(brandId)) {
      return jsonResponse({
        error: "validation_error",
        detail: "brand_id_invalid_uuid",
      }, 400);
    }
    const privateTarget = targetKind === "venue_draft" ||
      targetKind === "ad_creative";
    const selector = {
      targetKind,
      eventId: targetKind === "event" || targetKind === "trip_day_media"
        ? body.eventId ?? null
        : null,
      brandId,
      venueId: targetKind === "venue" ? body.venueId ?? null : null,
      draftOwnerKey: privateTarget ? body.draftOwnerKey ?? null : null,
      requestedBy: privateTarget ? userId : null,
    } as const;
    const selectorAllowed = await deps.requireCoverVideoTargetManager(
      supabase,
      selector,
      userId,
    );
    if (selectorAllowed instanceof Response) return selectorAllowed;
    query = query.eq("target_kind", targetKind);
    query = brandId === null
      ? query.is("brand_id", null)
      : query.eq("brand_id", brandId);
    if (targetKind === "event" || targetKind === "trip_day_media") {
      query = query.eq("event_id", body.eventId);
    }
    if (targetKind === "venue") query = query.eq("venue_id", body.venueId);
    if (privateTarget) {
      query = query.eq("draft_owner_key", body.draftOwnerKey).eq(
        "requested_by",
        userId,
      );
    }
    if (body.activeOnly === true) {
      query = query.in("status", ACTIVE_STATUS_SET);
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
  const allowed = await deps.requireCoverVideoTargetManager(supabase, {
    targetKind: job.target_kind,
    eventId: job.event_id,
    brandId: job.brand_id,
    venueId: job.venue_id,
    draftOwnerKey: job.draft_owner_key,
    requestedBy: job.requested_by,
  }, userId);
  if (allowed instanceof Response) return allowed;

  const payload = mapEventCoverVideoStatus(job);
  // #3040 (E-10b) — the library row an ad video became, once it exists.
  if (job.target_kind === "ad_creative") {
    const { data: creative, error: creativeError } = await supabase
      .from("ad_creatives")
      .select("id")
      .eq("source_job_id", job.id)
      .maybeSingle();
    if (creativeError) {
      console.error("[event-cover-video-status] creative read failed", {
        code: creativeError.code,
      });
    }
    payload.creativeId = typeof creative?.id === "string" ? creative.id : null;
  }
  return jsonResponse(payload);
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoStatus(req));
}
