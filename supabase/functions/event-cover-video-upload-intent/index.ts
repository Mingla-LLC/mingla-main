import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  coverVideoProvider,
  destroyCoverVideoAsset,
  isValidUuid,
  jsonResponse,
  mapEventCoverVideoStatus,
  MAX_DURATION_MS,
  MAX_SOURCE_VIDEO_BYTES,
  MAX_SOURCE_VIDEO_DURATION_MS,
  providerConfigured,
  requireBrandCoverManager,
  requireCoverVideoTargetManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
  validateTrimRange,
} from "../_shared/eventCoverVideo.ts";
// META-ORCH-1270 — Bunny provider branch (Cloudinary path unchanged).
import {
  bunnyCreateVideo,
  bunnyFetchLibraryUsage,
  bunnyFindVideoByTitle,
  bunnyPresignTusUpload,
  bunnyUsagePct,
} from "../_shared/bunnyStream.ts";
import { resolveRuntimeNumber } from "../_shared/runtimeConfig.ts";

export const SOURCE_CEILING_MS = 15_000;
const SOURCE_MIME_EXTENSIONS = new Map([
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/x-m4v", "m4v"],
  ["video/webm", "webm"],
]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const TERMINAL_JOB_STATUSES = new Set([
  "failed",
  "cancelled",
  "superseded",
  "applied",
]);
const NO_UPLOAD_REPLAY_STATUSES = new Set(["ready", ...TERMINAL_JOB_STATUSES]);

const canonicalJobResponse = (
  job: Record<string, unknown>,
  status = 200,
): Response =>
  jsonResponse({
    jobId: job.id,
    provider: job.provider,
    status: mapEventCoverVideoStatus(
      job as Parameters<typeof mapEventCoverVideoStatus>[0],
    ),
  }, status);

const initializingJobResponse = (job: Record<string, unknown>): Response => {
  const leaseUntil = typeof job.provider_allocation_lease_until === "string"
    ? Date.parse(job.provider_allocation_lease_until)
    : Number.NaN;
  const remaining = Number.isFinite(leaseUntil)
    ? Math.max(250, leaseUntil - Date.now())
    : 1_000;
  return jsonResponse({
    initializing: true,
    jobId: job.id,
    provider: job.provider,
    retryAfterMs: Math.min(2_000, remaining),
    status: mapEventCoverVideoStatus(
      job as Parameters<typeof mapEventCoverVideoStatus>[0],
    ),
  }, 202);
};

const logInfo = (
  requestId: string,
  stage: string,
  payload: Record<string, unknown> = {},
) => {
  console.log(
    "[event-cover-video-upload-intent]",
    JSON.stringify({
      requestId,
      stage,
      ...payload,
    }),
  );
};

const logWarn = (
  requestId: string,
  stage: string,
  payload: Record<string, unknown> = {},
) => {
  console.warn(
    "[event-cover-video-upload-intent]",
    JSON.stringify({
      requestId,
      stage,
      ...payload,
    }),
  );
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
  if (usedPercent == null) {
    return { blocked: false, reason: "usage_unreadable_fail_open" };
  }
  if (usedPercent >= hardCapPct) {
    return { blocked: true, reason: "capacity_reached" };
  }
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
    const row = (data ?? null) as {
      detail?: Record<string, unknown>;
      checked_at?: string;
    } | null;
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
  if (
    bunnyUsageCache &&
    Date.now() - bunnyUsageCache.atMs < BUNNY_USAGE_CACHE_TTL_MS
  ) {
    return bunnyUsageCache.value;
  }
  const storageCap = resolveRuntimeNumber(
    "bunny_storage_cap_bytes",
    "BUNNY_STORAGE_CAP_BYTES",
  ) ??
    0;
  const trafficCap = resolveRuntimeNumber(
    "bunny_traffic_cap_bytes",
    "BUNNY_TRAFFIC_CAP_BYTES",
  ) ??
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
  const rawCap = Number(
    Deno.env.get("EVENT_COVER_UPLOAD_HARD_CAP_PCT") ?? "90",
  );
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
  filter: {
    targetKind: "event" | "brand";
    eventId: string | null;
    brandId: string;
    provider: string;
  },
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
    }
  }
}

const defaultDeps = {
  bunnyCreateVideo,
  bunnyPresignTusUpload,
  checkBunnyCapacity,
  destroyCoverVideoAsset,
  bunnyFindVideoByTitle,
  providerConfigured,
  reapSupersededBunnyAssets,
  requireCoverVideoTargetManager,
  requireBrandCoverManager,
  requireEventManager,
  requireUserId,
  serviceRoleClient,
  sleep: (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

const isMissingDeterministicContract = (
  error: { code?: string; message?: string } | null,
): boolean =>
  error !== null && (
    ["PGRST202", "PGRST204", "42883", "42703"].includes(error.code ?? "") ||
    /cover_video_create_or_replay_job|client_operation_id|source_sha256/i.test(
      error.message ?? "",
    )
  );

// PostgREST serializes a SQL function returning a nullable composite as an
// object whose every field is null, not JavaScript null. Treat only a row with
// a concrete canonical identity as a replay; otherwise the first capability
// probe would try to format the all-null projection and crash before accepting
// a new operation.
const isConcreteJobRow = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" &&
  typeof (value as { id?: unknown }).id === "string" &&
  (value as { id: string }).id.length > 0 &&
  typeof (value as { status?: unknown }).status === "string";

const withAllocationLease = async <T>(
  supabase: ReturnType<typeof serviceRoleClient>,
  jobId: string,
  token: string,
  operation: () => Promise<T>,
): Promise<{ value: T; leaseOwned: boolean }> => {
  let leaseOwned = true;
  let renewal: Promise<void> | null = null;
  const renew = (): Promise<void> => {
    if (!leaseOwned) return Promise.resolve();
    if (renewal) return renewal;
    const pending = Promise.resolve(
      supabase.rpc("cover_video_renew_provider_allocation", {
        p_job_id: jobId,
        p_token: token,
        p_lease_seconds: 60,
      }),
    ).then(({ data, error }) => {
      if (error || data !== true) leaseOwned = false;
    }).catch(() => {
      leaseOwned = false;
    }).finally(() => {
      if (renewal === pending) renewal = null;
    });
    renewal = pending;
    return pending;
  };
  const timer = setInterval(() => {
    void renew();
  }, 20_000);
  try {
    const value = await operation();
    if (renewal) await renewal;
    return { value, leaseOwned };
  } finally {
    clearInterval(timer);
    if (renewal) await renewal;
  }
};

export const handleEventCoverVideoUploadIntent = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  let requestId: string = crypto.randomUUID();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    logWarn(requestId, "method_not_allowed", { method: req.method });
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await deps.requireUserId(req);
  if (userIdOrResponse instanceof Response) {
    logWarn(requestId, "auth_response_returned", {
      status: userIdOrResponse.status,
    });
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
    sourceExtension?: string | null;
    sourceSha256?: string | null;
    sourceBytes?: number | null;
    sourceDurationMs?: number | null;
    trimStartMs?: number;
    trimEndMs?: number;
    clientRequestId?: string;
    clientOperationId?: string;
    venueId?: string;
    draftOwnerKey?: string;
    refreshTransport?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    logWarn(requestId, "invalid_json");
    return jsonResponse(
      { error: "validation_error", detail: "invalid_json" },
      400,
    );
  }
  if (
    typeof body.clientRequestId === "string" &&
    body.clientRequestId.trim().length > 0
  ) {
    requestId = body.clientRequestId.trim();
  }

  const targetKind = body.target === "brand" || body.target === "venue" ||
      body.target === "venue_draft"
    ? body.target
    : "event";

  logInfo(requestId, "received", {
    applyMode: body.applyMode,
    brandId: body.brandId,
    eventId: body.eventId,
    targetKind,
    sourceBytes: body.sourceBytes,
    sourceDurationMs: body.sourceDurationMs,
    sourceMimeType: body.sourceMimeType,
    trimEndMs: body.trimEndMs,
    trimStartMs: body.trimStartMs,
  });

  const eventId = body.eventId;
  const brandId = body.brandId;
  if (!isValidUuid(body.clientOperationId)) {
    return jsonResponse({
      error: "client_version_required",
      detail: "client_operation_id_required",
    }, 426);
  }
  if (targetKind === "event" && !isValidUuid(eventId)) {
    logWarn(requestId, "event_id_invalid_uuid", { eventId });
    return jsonResponse({
      error: "validation_error",
      detail: "event_id_invalid_uuid",
    }, 400);
  }
  if (!isValidUuid(brandId)) {
    logWarn(requestId, "brand_id_invalid_uuid", { brandId });
    return jsonResponse({
      error: "validation_error",
      detail: "brand_id_invalid_uuid",
    }, 400);
  }
  if (targetKind === "venue" && !isValidUuid(body.venueId)) {
    return jsonResponse({
      error: "validation_error",
      detail: "venue_id_invalid_uuid",
    }, 400);
  }
  if (
    targetKind === "venue_draft" &&
    (typeof body.draftOwnerKey !== "string" ||
      body.draftOwnerKey.trim().length < 3 || body.draftOwnerKey.length > 160)
  ) {
    return jsonResponse({
      error: "validation_error",
      detail: "draft_owner_key_invalid",
    }, 400);
  }
  // ORCH-0989: a brand is always "live", so brand video uses published_manual
  // apply semantics (apply step writes brands.cover_media_url on ready).
  const applyMode = targetKind !== "event"
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
  const trimEndMs = rawTrimEndMs;
  const sourceMimeType = String(body.sourceMimeType ?? "").toLowerCase();
  const sourceExtension = String(body.sourceExtension ?? "").toLowerCase()
    .replace(/^\./, "");
  const sourceSha256 = String(body.sourceSha256 ?? "").toLowerCase();
  const sourceFileName = typeof body.sourceFileName === "string"
    ? body.sourceFileName.trim()
    : "";
  if (SOURCE_MIME_EXTENSIONS.get(sourceMimeType) !== sourceExtension) {
    return jsonResponse({
      error: "validation_error",
      detail: "source_type_not_allowed",
    }, 422);
  }
  if (
    sourceFileName.length === 0 || sourceFileName.length > 255 ||
    !sourceFileName.toLowerCase().endsWith(`.${sourceExtension}`)
  ) {
    return jsonResponse({
      error: "validation_error",
      detail: "source_file_name_invalid",
    }, 422);
  }
  if (!SHA256_RE.test(sourceSha256)) {
    return jsonResponse({
      error: "validation_error",
      detail: "source_sha256_invalid",
    }, 422);
  }

  if (
    !Number.isFinite(sourceBytes) || sourceBytes <= 0 ||
    sourceBytes > MAX_SOURCE_VIDEO_BYTES
  ) {
    logWarn(requestId, "source_size_out_of_range", {
      maxSourceBytes: MAX_SOURCE_VIDEO_BYTES,
      sourceBytes,
    });
    return jsonResponse({
      error: "validation_error",
      detail: "source_size_out_of_range",
    }, 422);
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
    return jsonResponse({
      error: "validation_error",
      detail: "source_duration_out_of_range",
    }, 422);
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
  const trimError = validateTrimRange({
    sourceDurationMs,
    trimStartMs,
    trimEndMs,
  });
  if (trimError !== null) {
    let detail: unknown = "trim_invalid";
    try {
      detail =
        (await trimError.clone().json() as { detail?: unknown }).detail ??
          detail;
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
  const allowed = await deps.requireCoverVideoTargetManager(supabase, {
    targetKind,
    eventId: targetKind === "event" ? eventId as string : null,
    brandId: brandId as string,
    venueId: targetKind === "venue" ? body.venueId as string : null,
    draftOwnerKey: targetKind === "venue_draft"
      ? body.draftOwnerKey!.trim()
      : null,
    requestedBy: userId,
  }, userId);
  if (allowed instanceof Response) {
    let detail: unknown = null;
    let error: unknown = null;
    try {
      const body = await allowed.clone().json() as {
        error?: unknown;
        detail?: unknown;
      };
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

  // Provider selection is deterministic configuration, not provider I/O. It is
  // needed to validate immutable replay identity, but provider health/config is
  // deliberately checked only after a same-operation terminal replay returns.
  const provider = coverVideoProvider();
  const operationArgs = {
    p_requested_by: userId,
    p_client_operation_id: body.clientOperationId,
    p_target_kind: targetKind,
    p_event_id: targetKind === "event" ? eventId : null,
    p_brand_id: brandId,
    p_venue_id: targetKind === "venue" ? body.venueId : null,
    p_draft_owner_key: targetKind === "venue_draft"
      ? body.draftOwnerKey?.trim()
      : null,
    p_apply_mode: applyMode,
    p_provider: provider,
    p_source_file_name: sourceFileName,
    p_source_mime_type: sourceMimeType,
    p_source_extension: sourceExtension,
    p_source_sha256: sourceSha256,
    p_source_bytes: sourceBytes,
    p_source_duration_ms: sourceDurationMs,
    p_trim_start_ms: trimStartMs,
    p_trim_end_ms: trimEndMs,
  };

  // Replay/schema probe. It cannot create or supersede. Therefore terminal and
  // active same-operation truth always wins before capacity/provider work, while
  // a genuinely new replacement remains non-destructive until capacity accepts.
  let { data: job, error: insertError } = await supabase.rpc(
    "cover_video_create_or_replay_job",
    {
      ...operationArgs,
      p_accept_new: false,
    },
  );
  if (insertError) {
    if (isMissingDeterministicContract(insertError)) {
      return jsonResponse({
        error: "upload_temporarily_unavailable",
        detail: "deterministic_upload_contract_pending",
      }, 503);
    }
    if (
      /cover_video_operation_identity_mismatch/i.test(
        insertError?.message ?? "",
      )
    ) {
      return jsonResponse({
        error: "operation_conflict",
        detail: "immutable_upload_identity_mismatch",
      }, 409);
    }
    console.error(
      "[event-cover-video-upload-intent]",
      JSON.stringify({
        brandId,
        code: insertError?.code,
        eventId,
        requestId,
        stage: "job_insert_failed",
      }),
    );
    return jsonResponse(
      { error: "internal_error", detail: "job_insert_failed" },
      500,
    );
  }
  const replayed = isConcreteJobRow(job);
  if (!replayed) job = null;
  if (replayed && NO_UPLOAD_REPLAY_STATUSES.has(String(job.status))) {
    logInfo(requestId, "terminal_replay", {
      jobId: job.id,
      status: job.status,
    });
    return canonicalJobResponse(job as Record<string, unknown>);
  }

  if (!deps.providerConfigured()) {
    logWarn(requestId, "provider_not_configured");
    return jsonResponse({
      error: "provider_not_configured",
      detail:
        "Video cover processing is not configured yet. Images and GIFs still work.",
    });
  }

  // META-ORCH-1270 (Phase 2) — pre-upload circuit-breaker (Bunny only). BEFORE
  // creating any Bunny video, refuse if usage% >= the hard cap so blowing past
  // the cap is structurally impossible even if the alert email never sends.
  // FAIL-OPEN on an unreadable usage (documented); a real reading >= cap fails
  // CLOSED with {error:"capacity_reached"}. Optional-chained so the Phase-1 test
  // deps (which omit checkBunnyCapacity) are unaffected.
  if (!replayed && provider === "bunny" && deps.checkBunnyCapacity) {
    const capacity = await deps.checkBunnyCapacity(supabase);
    if (capacity.blocked) {
      logWarn(requestId, "capacity_reached", {
        usedPercent: capacity.usedPercent,
      });
      return jsonResponse(
        {
          error: "capacity_reached",
          detail:
            "Cover video uploads are temporarily paused (storage/traffic cap reached). Try again later.",
        },
        503,
      );
    }
    if (capacity.reason === "usage_unreadable_fail_open") {
      logWarn(requestId, "bunny_usage_unreadable_fail_open", {
        usedPercent: capacity.usedPercent,
      });
    }
  }

  if (!replayed) {
    const accepted = await supabase.rpc("cover_video_create_or_replay_job", {
      ...operationArgs,
      p_accept_new: true,
    });
    job = accepted.data;
    insertError = accepted.error;
    if (insertError || !isConcreteJobRow(job)) {
      if (isMissingDeterministicContract(insertError)) {
        return jsonResponse({
          error: "upload_temporarily_unavailable",
          detail: "deterministic_upload_contract_pending",
        }, 503);
      }
      if (
        /cover_video_operation_identity_mismatch/i.test(
          insertError?.message ?? "",
        )
      ) {
        return jsonResponse({
          error: "operation_conflict",
          detail: "immutable_upload_identity_mismatch",
        }, 409);
      }
      return jsonResponse({
        error: "internal_error",
        detail: "job_insert_failed",
      }, 500);
    }
  }
  logInfo(requestId, "job_insert_pass", { jobId: job.id, replayed });

  // META-ORCH-1270 — Bunny branch. Create the Bunny video object, persist its
  // guid into source_asset_id (the webhook + destroy lookup key), and return a
  // TUS upload descriptor (the AccessKey NEVER reaches the client — only the
  // presigned AuthorizationSignature does). Cloudinary branch below is untouched.
  if (provider === "bunny") {
    let videoId = typeof job.source_asset_id === "string"
      ? job.source_asset_id
      : "";
    if (
      typeof job.tus_resource_url !== "string" ||
      job.tus_resource_url.length === 0
    ) {
      const claim = await supabase.rpc(
        "cover_video_claim_provider_allocation",
        {
          p_job_id: job.id,
          p_lease_seconds: 60,
        },
      );
      if (claim.error || !claim.data) {
        return jsonResponse({
          error: "upload_temporarily_unavailable",
          detail: "provider_allocation_claim_unavailable",
        }, 503);
      }
      const claimed = claim.data as Record<string, unknown>;
      if (TERMINAL_JOB_STATUSES.has(String(claimed.status))) {
        return canonicalJobResponse(claimed);
      }
      if (
        typeof claimed.tus_resource_url === "string" &&
        typeof claimed.source_asset_id === "string"
      ) {
        Object.assign(job, claimed);
        videoId = claimed.source_asset_id;
      } else if (typeof claimed.provider_allocation_token !== "string") {
        // A bounded edge request returns active canonical truth. The client
        // replays the same immutable operation using retryAfterMs; it is not a
        // loser failure and is not tied to an arbitrary ten-second timeout.
        return initializingJobResponse(claimed);
      } else {
        const leaseToken = claimed.provider_allocation_token;
        videoId = typeof claimed.source_asset_id === "string"
          ? claimed.source_asset_id
          : videoId;
        if (
          videoId.length === 0 &&
          claimed.provider_allocation_uncertain_at != null
        ) {
          if (claimed.provider_allocation_identity !== job.id) {
            return initializingJobResponse(claimed);
          }
          const lookup = await withAllocationLease(
            supabase,
            job.id,
            leaseToken,
            () => deps.bunnyFindVideoByTitle(job.id),
          );
          if (!lookup.leaseOwned || !lookup.value.ok) {
            return initializingJobResponse(claimed);
          }
          const resolution = await supabase.rpc(
            "cover_video_resolve_provider_allocation",
            {
              p_job_id: job.id,
              p_token: leaseToken,
              p_source_asset_id: lookup.value.guid,
              p_absent: lookup.value.guid === null,
            },
          );
          if (resolution.error || !resolution.data) {
            return initializingJobResponse(claimed);
          }
          Object.assign(job, resolution.data);
          videoId = typeof resolution.data.source_asset_id === "string"
            ? resolution.data.source_asset_id
            : "";
        }
        if (videoId.length === 0) {
          const begun = await supabase.rpc(
            "cover_video_begin_provider_create",
            {
              p_job_id: job.id,
              p_token: leaseToken,
              p_identity: job.id,
            },
          );
          if (begun.error || !begun.data) {
            return initializingJobResponse(claimed);
          }
          const created = await withAllocationLease(
            supabase,
            job.id,
            leaseToken,
            () => deps.bunnyCreateVideo(job.id),
          );
          const create = created.value;
          if (!created.leaseOwned) return initializingJobResponse(claimed);
          if (!create.ok) {
            await supabase.rpc(
              "cover_video_record_provider_allocation_attempt",
              {
                p_job_id: job.id,
                p_token: leaseToken,
                p_source_asset_id: null,
                p_error: create.reason,
              },
            );
            if (create.retryable !== false) {
              return initializingJobResponse(claimed);
            }
            const failed = await supabase.rpc("cover_video_transition_job", {
              p_job_id: job.id,
              p_from_statuses: ["source_uploading"],
              p_to_status: "failed",
              p_provider_status: null,
              p_provider_progress: null,
              p_patch: {
                failure_code: "provider_create_rejected",
                failure_message: "Video upload could not be created.",
              },
            });
            return failed.data
              ? canonicalJobResponse(failed.data as Record<string, unknown>)
              : initializingJobResponse(claimed);
          }
          videoId = create.guid;
          const recorded = await supabase.rpc(
            "cover_video_record_provider_allocation_attempt",
            {
              p_job_id: job.id,
              p_token: leaseToken,
              p_source_asset_id: videoId,
              p_error: null,
            },
          );
          if (recorded.error || !recorded.data) {
            // The pre-Create uncertainty marker remains durable. If the record
            // response was lost after commit, canonical readback recovers it;
            // otherwise the next claimant must provider-lookup by exact title.
            const reread = await supabase.from("event_cover_video_jobs")
              .select("*").eq("id", job.id).maybeSingle();
            if (reread.data?.source_asset_id === videoId) {
              Object.assign(job, reread.data);
            } else {
              return initializingJobResponse(claimed);
            }
          } else {
            Object.assign(job, recorded.data);
          }
        }

        const presign = await deps.bunnyPresignTusUpload(videoId);
        const createdTus = await withAllocationLease(
          supabase,
          job.id,
          leaseToken,
          async () => {
            try {
              const response = await fetch(presign.tusEndpoint, {
                method: "POST",
                headers: {
                  AuthorizationSignature: presign.authorizationSignature,
                  AuthorizationExpire: String(presign.authorizationExpire),
                  LibraryId: presign.libraryId,
                  VideoId: presign.videoId,
                  "Tus-Resumable": "1.0.0",
                  "Upload-Length": String(sourceBytes),
                  "Upload-Metadata": `filetype ${btoa(sourceMimeType)},title ${
                    btoa(job.id)
                  },sha256 ${btoa(sourceSha256)}`,
                },
              });
              return { response, networkError: null as string | null };
            } catch {
              return { response: null, networkError: "tus_create_network" };
            }
          },
        );
        const createTus = createdTus.value.response;
        const location = createTus?.headers.get("location") ?? null;
        const tusRetryable = createTus === null || createTus.status >= 500 ||
          createTus.status === 408 || createTus.status === 429 ||
          (createTus.status === 201 && location === null);
        if (!createdTus.leaseOwned || tusRetryable) {
          await supabase.rpc("cover_video_record_provider_allocation_attempt", {
            p_job_id: job.id,
            p_token: leaseToken,
            p_source_asset_id: videoId,
            p_error: createdTus.value.networkError ??
              `tus_create_http_${createTus?.status ?? "unknown"}`,
          });
          return initializingJobResponse({
            ...claimed,
            source_asset_id: videoId,
          });
        }
        if (createTus?.status !== 201 || location === null) {
          const failed = await supabase.rpc("cover_video_transition_job", {
            p_job_id: job.id,
            p_from_statuses: ["source_uploading"],
            p_to_status: "failed",
            p_provider_status: null,
            p_provider_progress: null,
            p_patch: {
              failure_code: "provider_transport_rejected",
              failure_message: "Video upload transport was rejected.",
            },
          });
          if (failed.data?.status === "failed") {
            await deps.destroyCoverVideoAsset({ source_asset_id: videoId });
          }
          return failed.data
            ? canonicalJobResponse(failed.data as Record<string, unknown>)
            : initializingJobResponse(claimed);
        }
        const tusResourceUrl = new URL(location, presign.tusEndpoint)
          .toString();
        const commitArgs = {
          p_job_id: job.id,
          p_token: leaseToken,
          p_source_asset_id: videoId,
          p_source_public_id: videoId,
          p_tus_url: tusResourceUrl,
          p_tus_length: sourceBytes,
          p_expires_at: new Date(presign.authorizationExpire * 1000)
            .toISOString(),
        };
        let commit = await supabase.rpc(
          "cover_video_commit_provider_allocation",
          commitArgs,
        );
        let committed = commit.data as Record<string, unknown> | null;
        let commitFailed = commit.error !== null || committed === null;
        for (let attempt = 0; commitFailed && attempt < 2; attempt += 1) {
          const reread = await supabase.from("event_cover_video_jobs").select(
            "*",
          ).eq("id", job.id).maybeSingle();
          if (reread.error || !reread.data) {
            return initializingJobResponse({
              ...claimed,
              source_asset_id: videoId,
            });
          }
          const canonical = reread.data as Record<string, unknown>;
          if (
            canonical.source_asset_id === videoId &&
            canonical.tus_resource_url === tusResourceUrl
          ) {
            committed = canonical;
            commitFailed = false;
            break;
          }
          if (
            canonical.provider_allocation_token === leaseToken &&
            canonical.source_asset_id === videoId &&
            canonical.status === "source_uploading"
          ) {
            commit = await supabase.rpc(
              "cover_video_commit_provider_allocation",
              commitArgs,
            );
            committed = commit.data as Record<string, unknown> | null;
            commitFailed = commit.error !== null || committed === null;
            continue;
          }
          // A different canonical owner/asset is definitive loss. Delete only
          // this caller's now-proven orphan, never an uncertain/canonical asset.
          if (
            canonical.source_asset_id !== videoId &&
            canonical.provider_allocation_token !== leaseToken
          ) {
            await deps.destroyCoverVideoAsset({ source_asset_id: videoId });
          }
          return TERMINAL_JOB_STATUSES.has(String(canonical.status))
            ? canonicalJobResponse(canonical)
            : initializingJobResponse(canonical);
        }
        if (commitFailed || committed === null) {
          return initializingJobResponse({
            ...claimed,
            source_asset_id: videoId,
          });
        }
        Object.assign(job, committed);
      }
    }
    const presign = await deps.bunnyPresignTusUpload(videoId);
    let tusResourceUrl = typeof job.tus_resource_url === "string"
      ? job.tus_resource_url
      : "";
    if (tusResourceUrl.length === 0) {
      return jsonResponse({
        error: "internal_error",
        detail: "transport_missing",
      }, 500);
    }
    if (body.refreshTransport === true) {
      if (Number(job.tus_upload_offset ?? 0) !== 0) {
        return jsonResponse({
          error: "transport_conflict",
          detail: "uploaded_transport_cannot_be_replaced",
        }, 409);
      }
      const createTus = await fetch(presign.tusEndpoint, {
        method: "POST",
        headers: {
          AuthorizationSignature: presign.authorizationSignature,
          AuthorizationExpire: String(presign.authorizationExpire),
          LibraryId: presign.libraryId,
          VideoId: presign.videoId,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(sourceBytes),
          "Upload-Metadata": `filetype ${btoa(sourceMimeType)},title ${
            btoa(job.id)
          },sha256 ${btoa(sourceSha256)}`,
        },
      });
      const location = createTus.headers.get("location");
      if (createTus.status !== 201 || location === null) {
        return jsonResponse({
          error: "transport_integrity_failed",
          detail: "tus_create_failed",
        }, 502);
      }
      const replacementUrl = new URL(location, presign.tusEndpoint).toString();
      const { data: replaced, error: replaceError } = await supabase.rpc(
        "cover_video_replace_transport",
        {
          p_job_id: job.id,
          p_expected_url: tusResourceUrl,
          p_new_url: replacementUrl,
          p_expires_at: new Date(presign.authorizationExpire * 1000)
            .toISOString(),
        },
      );
      if (replaceError || replaced?.tus_resource_url !== replacementUrl) {
        return jsonResponse({
          error: "transport_conflict",
          detail: "transport_replace_race",
        }, 409);
      }
      tusResourceUrl = replacementUrl;
    }
    logInfo(requestId, "returned", { jobId: job.id, provider: "bunny" });
    return jsonResponse({
      jobId: job.id,
      provider: "bunny",
      maxDurationMs: MAX_DURATION_MS,
      finalMaxBytes: 25 * 1024 * 1024,
      upload: {
        url: tusResourceUrl,
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
          filetype: sourceMimeType,
          sha256: sourceSha256,
          title: job.id,
        },
      },
    });
  }

  // #966 — Bunny is the sole provider (`provider` is the singleton `"bunny"`), so
  // the bunny branch above always returns. This terminal is unreachable; it exists
  // only to satisfy the Promise<Response> return contract. The Cloudinary
  // signature/URL response branch was removed (dead residue post-META-1270).
  throw new Error("unreachable: cover-video provider is bunny-only (#966)");
};

if (import.meta.main) {
  serve((req) => handleEventCoverVideoUploadIntent(req));
}
