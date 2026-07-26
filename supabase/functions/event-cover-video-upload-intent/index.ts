import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  cloudinarySignature,
  corsHeaders,
  coverVideoProvider,
  destroyCoverVideoAsset,
  isValidUuid,
  jsonResponse,
  MAX_DURATION_MS,
  MAX_SOURCE_VIDEO_BYTES,
  MAX_SOURCE_VIDEO_DURATION_MS,
  providerConfigured,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
  validateTrimRange,
} from "../_shared/eventCoverVideo.ts";
// META-ORCH-1270 — Bunny provider branch (Cloudinary path unchanged).
import {
  bunnyCreateVideo,
  bunnyFetchLibraryUsage,
  bunnyPresignTusUpload,
  bunnyUsagePct,
} from "../_shared/bunnyStream.ts";
import { resolveRuntimeNumber } from "../_shared/runtimeConfig.ts";

export const SOURCE_CEILING_MS = 33_000;

const clampBitrate = (durationMs: number): string => {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  const targetBits = 25 * 1024 * 1024 * 8 * 0.86;
  const kbps = Math.floor(targetBits / seconds / 1000);
  return `${Math.max(900, Math.min(9000, kbps))}k`;
};

const logInfo = (requestId: string, stage: string, payload: Record<string, unknown> = {}) => {
  console.log("[event-cover-video-upload-intent]", JSON.stringify({
    requestId,
    stage,
    ...payload,
  }));
};

const logWarn = (requestId: string, stage: string, payload: Record<string, unknown> = {}) => {
  console.warn("[event-cover-video-upload-intent]", JSON.stringify({
    requestId,
    stage,
    ...payload,
  }));
};

// ── META-ORCH-1270 (Phase 2): pre-upload circuit-breaker ──
// A short in-process cache so concurrent intent calls don't each hit Bunny's
// account API when the hourly health row is stale. The freshest api_health_checks
// bunny row is the PRIMARY cache (costs zero Bunny calls); this covers the gap.
let bunnyUsageCache: { value: number | null; atMs: number } | null = null;
const BUNNY_USAGE_CACHE_TTL_MS = 60_000;
const BUNNY_HEALTH_ROW_FRESH_MS = 60 * 60 * 1000; // 1h

// PURE threshold decision. FAIL-OPEN on an unreadable usage (a Bunny read outage
// must NOT wedge ALL uploads permanently) — only a real numeric >= the hard cap
// fails CLOSED. This choice is deliberate + documented in the Phase-2 report.
export function evaluateCapacityBreaker(
  usedPercent: number | null,
  hardCapPct: number,
): { blocked: boolean; reason: string } {
  if (usedPercent == null) return { blocked: false, reason: "usage_unreadable_fail_open" };
  if (usedPercent >= hardCapPct) return { blocked: true, reason: "capacity_reached" };
  return { blocked: false, reason: "under_cap" };
}

// deno-lint-ignore no-explicit-any
async function readBunnyUsagePercent(supabase: any): Promise<number | null> {
  // 1) freshest api_health_checks bunny synthetic row < 1h wins (the hourly probe
  //    already wrote it — the primary cache, zero Bunny calls).
  try {
    const { data } = await supabase
      .from("api_health_checks")
      .select("detail,checked_at")
      .eq("service_key", "bunny")
      .eq("layer", "synthetic")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = (data ?? null) as { detail?: Record<string, unknown>; checked_at?: string } | null;
    if (row?.checked_at) {
      const ageMs = Date.now() - new Date(row.checked_at).getTime();
      if (ageMs >= 0 && ageMs < BUNNY_HEALTH_ROW_FRESH_MS) {
        const used = row.detail?.used_percent;
        if (typeof used === "number" && Number.isFinite(used)) return used;
        // A fresh but probe_unreadable row → unreadable (fail-open below).
        if (row.detail?.probe_unreadable === true) return null;
      }
    }
  } catch {
    // fall through to the live fetch
  }
  // 2) no fresh row → live fetch, module-cached 60s so a burst of intents does
  //    not hammer Bunny's account API.
  if (bunnyUsageCache && Date.now() - bunnyUsageCache.atMs < BUNNY_USAGE_CACHE_TTL_MS) {
    return bunnyUsageCache.value;
  }
  const storageCap = resolveRuntimeNumber("bunny_storage_cap_bytes", "BUNNY_STORAGE_CAP_BYTES") ??
    0;
  const trafficCap = resolveRuntimeNumber("bunny_traffic_cap_bytes", "BUNNY_TRAFFIC_CAP_BYTES") ??
    0;
  const usage = await bunnyFetchLibraryUsage();
  let value: number | null = null;
  if (usage.ok) {
    const pct = bunnyUsagePct({
      storageUsage: usage.usage.storageUsage,
      trafficUsage: usage.usage.trafficUsage,
      storageCapBytes: storageCap,
      trafficCapBytes: trafficCap,
    });
    value = pct ? pct.usedPercent : null;
  }
  bunnyUsageCache = { value, atMs: Date.now() };
  return value;
}

// deno-lint-ignore no-explicit-any
async function checkBunnyCapacity(
  supabase: any,
): Promise<{ blocked: boolean; reason: string; usedPercent: number | null }> {
  const rawCap = Number(Deno.env.get("EVENT_COVER_UPLOAD_HARD_CAP_PCT") ?? "90");
  const hardCap = Number.isFinite(rawCap) ? rawCap : 90;
  const usedPercent = await readBunnyUsagePercent(supabase);
  return { ...evaluateCapacityBreaker(usedPercent, hardCap), usedPercent };
}

// ── META-ORCH-1270 (Phase 2): supersede reaping ──
// After the supersede UPDATE flips prior ACTIVE jobs to cancelled/superseded,
// reclaim their Bunny assets so an orphaned upload never lingers. Gated to
// bunny-provider rows: Cloudinary rows carry no source_asset_id and are left
// byte-for-byte unchanged (their reaping stays out of scope until Phase 4).
// deno-lint-ignore no-explicit-any
export async function reapSupersededBunnyAssets(
  supabase: any,
  filter: { targetKind: "event" | "brand"; eventId: string | null; brandId: string; provider: string },
): Promise<void> {
  if (filter.provider !== "bunny") return;
  const base = supabase
    .from("event_cover_video_jobs")
    .select("id,provider,source_asset_id,source_public_id")
    .eq("failure_code", "superseded")
    .eq("provider", "bunny")
    .not("source_asset_id", "is", null)
    .is("reaped_at", null);
  const scoped = filter.targetKind === "brand"
    ? base.eq("brand_id", filter.brandId).eq("target_kind", "brand")
    : base.eq("event_id", filter.eventId as string);
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
    }
  }
}

const defaultDeps = {
  bunnyCreateVideo,
  bunnyPresignTusUpload,
  checkBunnyCapacity,
  cloudinarySignature,
  providerConfigured,
  reapSupersededBunnyAssets,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
};

export const handleEventCoverVideoUploadIntent = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  let requestId: string = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    logWarn(requestId, "method_not_allowed", { method: req.method });
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await deps.requireUserId(req);
  if (userIdOrResponse instanceof Response) {
    logWarn(requestId, "auth_response_returned", { status: userIdOrResponse.status });
    return userIdOrResponse;
  }
  const userId = userIdOrResponse;

  let body: {
    // ORCH-0989: target discriminator. Absent/"event" => event-target
    // (eventId required); "brand" => brand-target (eventId absent).
    target?: string;
    eventId?: string;
    brandId?: string;
    applyMode?: string;
    sourceFileName?: string | null;
    sourceMimeType?: string | null;
    sourceBytes?: number | null;
    sourceDurationMs?: number | null;
    trimStartMs?: number;
    trimEndMs?: number;
    clientRequestId?: string;
  };
  try {
    body = await req.json();
  } catch {
    logWarn(requestId, "invalid_json");
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  if (typeof body.clientRequestId === "string" && body.clientRequestId.trim().length > 0) {
    requestId = body.clientRequestId.trim();
  }

  const targetKind = body.target === "brand" ? "brand" : "event";

  logInfo(requestId, "received", {
    applyMode: body.applyMode,
    brandId: body.brandId,
    eventId: body.eventId,
    targetKind,
    sourceBytes: body.sourceBytes,
    sourceDurationMs: body.sourceDurationMs,
    sourceFileName: body.sourceFileName,
    sourceMimeType: body.sourceMimeType,
    trimEndMs: body.trimEndMs,
    trimStartMs: body.trimStartMs,
  });

  if (!deps.providerConfigured()) {
    logWarn(requestId, "provider_not_configured");
    return jsonResponse({
      error: "provider_not_configured",
      detail: "Video cover processing is not configured yet. Images and GIFs still work.",
    });
  }

  const eventId = body.eventId;
  const brandId = body.brandId;
  // ORCH-0989: event-target requires a valid eventId; brand-target must NOT
  // carry one (the job is keyed on brand_id alone).
  if (targetKind === "event" && !isValidUuid(eventId)) {
    logWarn(requestId, "event_id_invalid_uuid", { eventId });
    return jsonResponse({ error: "validation_error", detail: "event_id_invalid_uuid" }, 400);
  }
  if (!isValidUuid(brandId)) {
    logWarn(requestId, "brand_id_invalid_uuid", { brandId });
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }
  // ORCH-0989: a brand is always "live", so brand video uses published_manual
  // apply semantics (apply step writes brands.cover_media_url on ready).
  const applyMode =
    targetKind === "brand"
      ? "published_manual"
      : body.applyMode === "published_manual"
        ? "published_manual"
        : "draft_auto";
  // ORCH-1308: source_bytes/source_duration_ms/trim_*_ms are INTEGER (bytes are
  // bigint) columns. A browser reports `<video>.duration` in FRACTIONAL seconds,
  // so the web path can send a non-integer ms (e.g. 17971.995) — Postgres then
  // rejects the INSERT with "invalid input syntax for type integer" →
  // job_insert_failed → 500 (the true cause of web video covers "never
  // working"). Coerce every integer-bound field to a whole number here, at the
  // authoritative server gate, so no fractional value can ever reach the row
  // (native is unaffected — it already sends integers). Round after Number() and
  // before validation/insert.
  const sourceBytes = Math.round(Number(body.sourceBytes ?? 0));
  const sourceDurationMs = Math.round(Number(body.sourceDurationMs ?? 0));
  const trimStartMs = Math.round(Number(body.trimStartMs ?? 0));
  const rawTrimEndMs = Math.round(Number(body.trimEndMs ?? sourceDurationMs));
  // Accept a generous source window for native keyframe overshoot, but persist a
  // processed trim window capped at MAX_DURATION_MS. (ORCH-0978 AMENDMENT 8.)
  const trimEndMs = Math.min(rawTrimEndMs, MAX_DURATION_MS);

  if (!Number.isFinite(sourceBytes) || sourceBytes <= 0 || sourceBytes > MAX_SOURCE_VIDEO_BYTES) {
    logWarn(requestId, "source_size_out_of_range", {
      maxSourceBytes: MAX_SOURCE_VIDEO_BYTES,
      sourceBytes,
    });
    return jsonResponse({ error: "validation_error", detail: "source_size_out_of_range" }, 422);
  }
  if (
    !Number.isFinite(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > MAX_SOURCE_VIDEO_DURATION_MS
  ) {
    logWarn(requestId, "source_duration_out_of_range", {
      maxSourceDurationMs: MAX_SOURCE_VIDEO_DURATION_MS,
      sourceDurationMs,
    });
    return jsonResponse({ error: "validation_error", detail: "source_duration_out_of_range" }, 422);
  }
  if (sourceDurationMs > SOURCE_CEILING_MS) {
    logWarn(requestId, "duration_over_cap", {
      ceiling: SOURCE_CEILING_MS,
      sourceDurationMs,
    });
    return jsonResponse(
      {
        error: "duration_over_cap",
        detail: { sourceDurationMs, ceilingMs: SOURCE_CEILING_MS },
      },
      422,
    );
  }
  const trimError = validateTrimRange({ sourceDurationMs, trimStartMs, trimEndMs });
  if (trimError !== null) {
    let detail: unknown = "trim_invalid";
    try {
      detail = (await trimError.clone().json() as { detail?: unknown }).detail ?? detail;
    } catch {
      // Keep fallback detail for malformed diagnostic body.
    }
    logWarn(requestId, "trim_range_rejected", {
      detail,
      sourceDurationMs,
      trimEndMs,
      trimStartMs,
    });
    return trimError;
  }
  logInfo(requestId, "validation_pass", {
    applyMode,
    sourceBytes,
    sourceDurationMs,
    trimEndMs,
    trimStartMs,
  });

  const supabase = deps.serviceRoleClient();
  // ORCH-0989: brand-target gates on brand_admin (no events lookup);
  // event-target keeps the byte-for-byte event_manager gate.
  const allowed =
    targetKind === "brand"
      ? await deps.requireBrandCoverManager(supabase, brandId as string, userId)
      : await deps.requireEventManager(supabase, eventId as string, brandId as string, userId);
  if (allowed instanceof Response) {
    let detail: unknown = null;
    let error: unknown = null;
    try {
      const body = await allowed.clone().json() as { error?: unknown; detail?: unknown };
      detail = body.detail ?? null;
      error = body.error ?? null;
    } catch {
      // Response body is best-effort diagnostics only.
    }
    logWarn(requestId, "permission_rejected", {
      detail,
      error,
      status: allowed.status,
    });
    return allowed;
  }
  logInfo(requestId, "permission_pass", {
    brandId,
    eventId,
    targetKind,
  });

  // META-ORCH-1270 (Phase 2) — active provider decides host + upload descriptor.
  // Determined here (before supersede) so the circuit-breaker can refuse a new
  // upload WITHOUT cancelling the user's prior in-progress upload.
  const provider = coverVideoProvider();

  // META-ORCH-1270 (Phase 2) — pre-upload circuit-breaker (Bunny only). BEFORE
  // creating any Bunny video, refuse if usage% >= the hard cap so blowing past
  // the cap is structurally impossible even if the alert email never sends.
  // FAIL-OPEN on an unreadable usage (documented); a real reading >= cap fails
  // CLOSED with {error:"capacity_reached"}. Optional-chained so the Phase-1 test
  // deps (which omit checkBunnyCapacity) are unaffected.
  if (provider === "bunny" && deps.checkBunnyCapacity) {
    const capacity = await deps.checkBunnyCapacity(supabase);
    if (capacity.blocked) {
      logWarn(requestId, "capacity_reached", { usedPercent: capacity.usedPercent });
      return jsonResponse(
        {
          error: "capacity_reached",
          detail: "Cover video uploads are temporarily paused (storage/traffic cap reached). Try again later.",
        },
        503,
      );
    }
    if (capacity.reason === "usage_unreadable_fail_open") {
      logWarn(requestId, "bunny_usage_unreadable_fail_open", { usedPercent: capacity.usedPercent });
    }
  }

  // ORCH-0989: supersede prior active jobs. Event-target keys on event_id
  // (filter order preserved: .eq() then .not()); brand-target keys on
  // brand_id + target_kind='brand' (no event_id).
  const supersedeBase = supabase
    .from("event_cover_video_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      failure_code: "superseded",
      failure_message: "Superseded by a newer cover video upload.",
    });
  const { error: cancelError } =
    targetKind === "brand"
      ? await supersedeBase
          .eq("brand_id", brandId as string)
          .eq("target_kind", "brand")
          .not("status", "in", "(failed,cancelled,applied)")
      : await supersedeBase
          .eq("event_id", eventId as string)
          .not("status", "in", "(failed,cancelled,applied)");
  if (cancelError) {
    logWarn(requestId, "active_job_cancel_failed", {
      code: cancelError.code,
      details: cancelError.details,
      hint: cancelError.hint,
      message: cancelError.message,
    });
  } else {
    logInfo(requestId, "active_jobs_cancelled", { eventId });
    // META-ORCH-1270 (Phase 2) — reap the superseded Bunny assets so an orphaned
    // upload never lingers in the library. Optional-chained (Phase-1 test deps
    // omit it) and best-effort (never fails the intent).
    await deps.reapSupersededBunnyAssets?.(supabase, {
      targetKind,
      eventId: eventId ?? null,
      brandId: brandId as string,
      provider,
    });
  }

  // META-ORCH-1270 — stamp the active provider on the job row so the webhook +
  // destroy path route on the row's own provider value (not just the current env).
  const { data: job, error: insertError } = await supabase
    .from("event_cover_video_jobs")
    .insert({
      // ORCH-0989: brand-target jobs carry no event_id (row CHECK enforces it).
      event_id: targetKind === "brand" ? null : eventId,
      target_kind: targetKind,
      brand_id: brandId,
      requested_by: userId,
      provider,
      status: "source_uploading",
      apply_mode: applyMode,
      source_file_name: body.sourceFileName ?? null,
      source_mime_type: body.sourceMimeType ?? null,
      source_bytes: sourceBytes,
      source_duration_ms: sourceDurationMs,
      trim_start_ms: trimStartMs,
      trim_end_ms: trimEndMs,
    })
    .select("id")
    .single();
  if (insertError || !job) {
    console.error("[event-cover-video-upload-intent]", JSON.stringify({
      brandId,
      code: insertError?.code,
      details: insertError?.details,
      eventId,
      hint: insertError?.hint,
      message: insertError?.message,
      requestId,
      stage: "job_insert_failed",
    }));
    return jsonResponse(
      { error: "internal_error", detail: "job_insert_failed" },
      500,
    );
  }
  logInfo(requestId, "job_insert_pass", { jobId: job.id });

  // META-ORCH-1270 — Bunny branch. Create the Bunny video object, persist its
  // guid into source_asset_id (the webhook + destroy lookup key), and return a
  // TUS upload descriptor (the AccessKey NEVER reaches the client — only the
  // presigned AuthorizationSignature does). Cloudinary branch below is untouched.
  if (provider === "bunny") {
    const create = await deps.bunnyCreateVideo(job.id);
    if (!create.ok) {
      await supabase
        .from("event_cover_video_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          failure_code: "provider_create_failed",
          failure_message: "Could not create the video on the media host. Try again.",
        })
        .eq("id", job.id);
      logWarn(requestId, "bunny_create_failed", { jobId: job.id, reason: create.reason });
      return jsonResponse(
        { error: "internal_error", detail: "provider_create_failed" },
        500,
      );
    }
    const libraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID") ?? "";
    const cdnHostname = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME") ?? "";
    const { error: bunnyPayloadError } = await supabase
      .from("event_cover_video_jobs")
      .update({
        source_asset_id: create.guid,
        provider_payload: {
          bunny: { videoId: create.guid, libraryId, cdnHostname },
        },
      })
      .eq("id", job.id);
    if (bunnyPayloadError) {
      logWarn(requestId, "bunny_payload_update_failed", {
        code: bunnyPayloadError.code,
        jobId: job.id,
        message: bunnyPayloadError.message,
      });
    }
    const presign = await deps.bunnyPresignTusUpload(create.guid);
    logInfo(requestId, "returned", { jobId: job.id, provider: "bunny" });
    return jsonResponse({
      jobId: job.id,
      provider: "bunny",
      maxDurationMs: MAX_DURATION_MS,
      finalMaxBytes: 25 * 1024 * 1024,
      upload: {
        url: presign.tusEndpoint,
        // NEW discriminator the client branches on ("tus" vs the implicit
        // Cloudinary multipart path). The Cloudinary branch omits `protocol`;
        // the client treats any non-"tus" value (including absent) as Cloudinary.
        protocol: "tus",
        videoId: presign.videoId,
        // Sent as TUS creation request headers by the client. NO AccessKey here.
        fields: {
          AuthorizationSignature: presign.authorizationSignature,
          AuthorizationExpire: String(presign.authorizationExpire),
          LibraryId: presign.libraryId,
          VideoId: presign.videoId,
        },
        metadata: {
          filetype: body.sourceMimeType ?? "video/mp4",
          title: job.id,
        },
      },
    });
  }

  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME") ?? "";
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY") ?? "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // ORCH-0989: brand-target uses a brandId-keyed public_id (no eventId
  // segment); the webhook recovers job_id from either template (recoverJobIdFromPayload).
  const publicId =
    targetKind === "brand"
      ? `brand-covers/raw/${brandId}/${job.id}`
      : `event-covers/raw/${brandId}/${eventId}/${job.id}`;
  const durationBudgetMs = Math.min(trimEndMs - trimStartMs, MAX_DURATION_MS);
  const durationBudgetSeconds = Math.ceil(durationBudgetMs / 1000);
  // du_<seconds> caps processed duration server-side as defense-in-depth alongside client trim.
  // Reference: https://cloudinary.com/documentation/video_manipulation_and_delivery_reference#video_transformation_url_parameters
  const eager = [
    "c_limit,w_1280,h_720",
    `du_${durationBudgetSeconds}`,
    "vc_h264",
    "ac_aac",
    `br_${clampBitrate(durationBudgetMs)}`,
    "f_mp4",
    "q_auto:good",
  ].join(",");
  const eagerNotificationUrl =
    `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/event-cover-video-webhook`;
  // ORCH-0989: brand-target context carries target_kind + brand_id (no event_id);
  // event-target keeps the original event_id-bearing context.
  const context =
    targetKind === "brand"
      ? `job_id=${job.id}|target_kind=brand|brand_id=${brandId}|apply_mode=${applyMode}`
      : `job_id=${job.id}|event_id=${eventId}|brand_id=${brandId}|apply_mode=${applyMode}`;
  const signature = await deps.cloudinarySignature({
    // Cloudinary signed upload params:
    // https://cloudinary.com/documentation/upload_images
    // https://cloudinary.com/documentation/authentication_signatures
    context,
    eager,
    eager_async: "true",
    eager_notification_url: eagerNotificationUrl,
    public_id: publicId,
    timestamp,
  });
  logInfo(requestId, "cloudinary_signature_generated", {
    jobId: job.id,
    publicId,
    durationBudgetMs,
  });

  const { error: payloadUpdateError } = await supabase
    .from("event_cover_video_jobs")
    .update({
      provider_payload: { public_id: publicId, eager },
      source_public_id: publicId,
    })
    .eq("id", job.id);
  if (payloadUpdateError) {
    logWarn(requestId, "provider_payload_update_failed", {
      code: payloadUpdateError.code,
      details: payloadUpdateError.details,
      hint: payloadUpdateError.hint,
      jobId: job.id,
      message: payloadUpdateError.message,
    });
  }
  logInfo(requestId, "returned", { jobId: job.id, provider: "cloudinary" });

  return jsonResponse({
    jobId: job.id,
    provider: "cloudinary",
    maxDurationMs: MAX_DURATION_MS,
    finalMaxBytes: 25 * 1024 * 1024,
    upload: {
      url: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      fields: {
        // Cloudinary Upload API parameters:
        // https://cloudinary.com/documentation/upload_images
        // https://cloudinary.com/documentation/upload_parameters
        api_key: apiKey,
        context,
        eager,
        eager_async: "true",
        eager_notification_url: eagerNotificationUrl,
        public_id: publicId,
        resource_type: "video",
        signature,
        timestamp,
      },
    },
  });
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoUploadIntent(req));
}
