// META-ORCH-1270 (Phase 2) — cover-video storage reaper.
//
// Cron-invoked (every 6h) backstop that reclaims Bunny video assets left behind
// by any terminal transition the inline paths missed or that failed transiently:
//   • cancelled / failed jobs with a provider asset id + reaped_at IS NULL;
//   • abandoned drafts (source_uploaded / ready, never applied, > 24h old).
//
// #2905 — this function also owns the two mechanisms that make a wedged job
// impossible: (1) it reconciles provider truth through the SAME finalize
// implementation the live webhook uses, translating the Bunny API video-object
// status into the webhook status with the one named crossing
// (bunnyApiVideoStatusAsWebhookStatus) instead of letting the two enums pass for
// each other; and (2) it enforces COVER_VIDEO_STALL_MS, after which a
// non-terminal job becomes a visible, retryable failure with a real
// failure_code. A job now always ends: promoted, failed, or reaped.
// For each: destroy the asset (provider-agnostic destroyCoverVideoAsset), then
// stamp reaped_at. reaped_at guards double-delete; a Bunny delete of an absent
// guid returns 404 → treated as ok → idempotent.
//
// FAIL-SAFE: a Bunny API outage must NOT wedge anything. If a destroy fails we
// leave reaped_at NULL and move on — the next run retries. It never throws into
// the cron tick (returns 200 so pg_cron does not retry-storm).
//
// Auth: service-role Bearer (pg_cron), like api-health-probe. verify_jwt=false in
// config.toml; the function enforces its own service-role-Bearer guard.
//
// SCOPE: the candidate query filters `source_asset_id IS NOT NULL`, so ONLY Bunny
// jobs (which persist the guid into source_asset_id) are ever reaped. Cloudinary
// jobs carry a NULL source_asset_id and are therefore untouched (Cloudinary
// reaping is out of scope until Phase 4).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  destroyCoverVideoAsset,
  jsonResponse,
  serviceRoleClient,
} from "../_shared/eventCoverVideo.ts";
import {
  bunnyApiVideoStatusAsWebhookStatus,
  bunnyFindVideoByTitle,
  bunnyGetVideo,
  bunnyPresignTusUpload,
  hmacSha256Hex,
  mapBunnyStatusFromApiVideo,
} from "../_shared/bunnyStream.ts";
import { handleBunnyWebhook } from "../event-cover-video-webhook/index.ts";
// #3040 — ONE implementation of "did the TUS transfer finish?", shared with the
// acknowledgement endpoint. The sweep below must not invent a second answer.
import { readTusTransfer } from "../event-cover-video-source-uploaded/index.ts";
// #3040 — guarded destroy and the ready owner (every ready job has a server
// owner; nothing still in use is ever destroyed).
import {
  destroyIfUnreferenced,
  readGuidLiveReferences,
} from "../_shared/coverVideoReap.ts";
import {
  decideReadyOwnership,
  executeReadyOwnership,
  type ReadyOwnerJob,
} from "../_shared/coverVideoReadyOwner.ts";

export type ReapCandidate = {
  id: string;
  status: string | null;
  provider?: string | null;
  source_asset_id?: unknown;
  source_public_id?: unknown;
  applied_at?: string | null;
  reaped_at?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  provider_allocation_identity?: string | null;
  provider_allocation_uncertain_at?: string | null;
  provider_allocation_token?: string | null;
  // #3040 — the fields the abandoned-source_uploading sweep needs.
  source_bytes?: number | null;
  tus_expires_at?: string | null;
  tus_resource_url?: string | null;
  // #3040 — owner fields.
  source_uploaded_at?: string | null;
  failure_code?: string | null;
  target_kind?: string | null;
  event_id?: string | null;
  brand_id?: string | null;
};

export type ReapTarget = {
  id: string;
  provider?: string | null;
  source_asset_id?: unknown;
  source_public_id?: unknown;
  action: "reap";
  // #3040 — reclaim only through the live-reference guard.
  guarded?: boolean;
};

const hasAssetId = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

// #3040 — terminal codes that can end a job whose asset was already verified
// and may be served somewhere (a finished video, a deleted parent). Their
// assets are reclaimed only when nothing live references them.
export const GUARDED_REAP_FAILURE_CODES: ReadonlySet<string> = new Set([
  "ready_unclaimed",
  "target_deleted",
  "creative_materialize_failed",
  "creative_source_untrusted",
]);

const toTarget = (job: ReapCandidate): ReapTarget => ({
  id: job.id,
  provider: job.provider,
  source_asset_id: job.source_asset_id,
  source_public_id: job.source_public_id,
  action: "reap",
  guarded: GUARDED_REAP_FAILURE_CODES.has(job.failure_code ?? ""),
});

// PURE selection: which un-reaped, asset-bearing jobs to reclaim, and whether an
// abandoned draft also needs its terminal state flipped to failed. Idempotent by
// reaped_at (already-reaped rows are skipped → never a double-delete).
export function selectReapTargets(
  jobs: ReapCandidate[],
  _nowMs: number,
): ReapTarget[] {
  const targets: ReapTarget[] = [];
  for (const job of jobs) {
    if (job.reaped_at != null) continue; // already reaped — never double-delete
    if (!hasAssetId(job.source_asset_id)) continue; // only provider-asset-bearing (Bunny) rows
    const status = job.status ?? "";
    if (
      status === "cancelled" || status === "failed" || status === "superseded"
    ) {
      targets.push(toTarget(job));
      continue;
    }
    // Active and ready/unapplied jobs are durable. Reconciliation below owns
    // them; elapsed time never converts healthy work into failure (#2715).
  }
  return targets;
}

export const selectReconciliationCandidates = (
  jobs: ReapCandidate[],
): ReapCandidate[] =>
  jobs.filter((job) =>
    job.reaped_at == null && hasAssetId(job.source_asset_id) &&
    ["source_uploaded", "processing_queued", "processing", "ready"].includes(
      job.status ?? "",
    )
  );

// ── #2905 / #3040 STALL DEADLINE ───────────────────────────────────────────
//
// #2715 correctly stopped age from reaping durable work, but combined with a
// promotion path that could not fire it made a wedged job IMMORTAL. A
// non-terminal job past its deadline becomes a VISIBLE, RETRYABLE failure
// (mapEventCoverVideoStatus sets canRetry for `failed`), never a silent delete.
//
// #3040 — the product promise is 60 s from the final byte to ready, so the
// encode bound is measured from `source_uploaded_at` and is 10 × that SLO
// (COVER_VIDEO_UPLOADED_STALL_MS). Last-30-day p99 for clips over 30 s was
// 62 s, so 10 minutes leaves room for 1080p encodes and still fails the job in
// the same session. A provider 404 on an uploaded job fails on the first tick.
//
// COVER_VIDEO_STALL_MS keeps its original meaning: the backstop for a job
// that has no final-byte clock (an upload still in transfer, which is bounded
// first by its TUS lease, or a legacy row). It stays 12 hours.
export const COVER_VIDEO_STALL_MS = 12 * 60 * 60 * 1000;
export const COVER_VIDEO_UPLOADED_STALL_MS = 10 * 60 * 1000;
// #3040 — allocation that never started / never resolved (B-13).
export const COVER_VIDEO_ALLOCATION_ABANDON_MS = 10 * 60 * 1000;
export const COVER_VIDEO_ALLOCATION_UNRESOLVED_MS = 30 * 60 * 1000;
// #3040 — a lease that expired while Bunny's HEAD was unreadable gets 30 more
// minutes of HEAD retries before the upload is called unverifiable (B-8).
export const COVER_VIDEO_UNVERIFIABLE_GRACE_MS = 30 * 60 * 1000;
// #3040 — the reaper stops starting new work after this much of its 60 s
// lease; unworked leases simply expire and are claimed next tick (B-6).
export const REAPER_TICK_BUDGET_MS = 45_000;
// #3040 — applied assets nothing references for this long are orphans (B-14).
export const COVER_VIDEO_ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const COVER_VIDEO_ORPHAN_RECLAIM_LIMIT = 20;
export const ORPHAN_RECLAIM_FLAG_KEY = "cover_video_orphan_reclaim_enabled";
const SCAN_LIMIT = 200;

// Only non-terminal states are stallable. `ready` is owned by the ready owner
// (coverVideoReadyOwner), never by the stall deadline.
const STALLABLE_STATUSES = [
  "source_uploading",
  "source_uploaded",
  "processing_queued",
  "processing",
];
const NON_TERMINAL_OR_READY = [...STALLABLE_STATUSES, "ready"];

export type StallVerdict =
  | { stalled: false; reason: string }
  | {
    stalled: true;
    failureCode: "processing_stalled" | "provider_asset_missing";
    failureMessage: string;
  };

const parseMs = (value: string | null | undefined): number =>
  typeof value === "string" ? Date.parse(value) : Number.NaN;

// PURE. `providerRead` is how this tick's `bunnyGetVideo` resolved:
//   "non_terminal" — read succeeded, provider is still not finished/failed.
//   "absent"       — HTTP 404: the provider asset is definitively gone.
//   "unreadable"   — network / 5xx / not-configured. NEVER stalls: a Bunny
//                    outage must not convert healthy work into failure.
export function evaluateCoverVideoStall(input: {
  status: string | null;
  createdAt: string | null;
  sourceUploadedAt?: string | null;
  nowMs: number;
  providerRead: "non_terminal" | "absent" | "unreadable";
}): StallVerdict {
  if (!STALLABLE_STATUSES.includes(input.status ?? "")) {
    return { stalled: false, reason: "not_stallable_status" };
  }
  if (input.providerRead === "unreadable") {
    return { stalled: false, reason: "provider_unreadable" };
  }
  const missing: StallVerdict = {
    stalled: true,
    failureCode: "provider_asset_missing",
    failureMessage:
      "The uploaded video is no longer available at the media host.",
  };
  // #3040 (B-10) — bytes were acknowledged on the provider and the provider now
  // says the asset does not exist: that is definitive on the first tick.
  if (input.providerRead === "absent" && input.status !== "source_uploading") {
    return missing;
  }
  const uploadedMs = parseMs(input.sourceUploadedAt ?? null);
  const createdMs = parseMs(input.createdAt);
  const [anchorMs, windowMs] = Number.isFinite(uploadedMs)
    ? [uploadedMs, COVER_VIDEO_UPLOADED_STALL_MS]
    : [createdMs, COVER_VIDEO_STALL_MS];
  if (!Number.isFinite(anchorMs)) {
    return { stalled: false, reason: "created_at_unparseable" };
  }
  if (input.nowMs - anchorMs < windowMs) {
    return { stalled: false, reason: "within_stall_window" };
  }
  return input.providerRead === "absent" ? missing : {
    stalled: true,
    failureCode: "processing_stalled",
    failureMessage:
      "Video processing did not finish in time. Try uploading it again.",
  };
}

// PURE (B-13): a job created by the client that never got as far as asking the
// provider for an asset is owned by nothing else.
export function selectAbandonedAllocations(
  jobs: ReapCandidate[],
  nowMs: number,
): ReapCandidate[] {
  return jobs.filter((job) =>
    job.status === "source_uploading" && !hasAssetId(job.source_asset_id) &&
    job.provider_allocation_uncertain_at == null &&
    nowMs - parseMs(job.created_at) >= COVER_VIDEO_ALLOCATION_ABANDON_MS
  );
}

// PURE (B-14): applied, never reaped, old enough to be an orphan candidate.
export function selectOrphanCandidates(
  jobs: ReapCandidate[],
  nowMs: number,
): ReapCandidate[] {
  return jobs.filter((job) =>
    job.status === "applied" && job.reaped_at == null &&
    hasAssetId(job.source_asset_id) &&
    nowMs - parseMs(job.completed_at ?? job.applied_at ?? null) >=
      COVER_VIDEO_ORPHAN_AGE_MS
  ).slice(0, COVER_VIDEO_ORPHAN_RECLAIM_LIMIT);
}

const defaultDeps = {
  bunnyFindVideoByTitle,
  bunnyGetVideo,
  destroyCoverVideoAsset,
  serviceRoleClient,
};

const CANDIDATE_COLUMNS =
  "id,status,provider,source_asset_id,source_public_id,applied_at,reaped_at,created_at,completed_at,source_bytes,tus_expires_at,tus_resource_url,source_uploaded_at,failure_code,target_kind,event_id,brand_id,provider_allocation_uncertain_at";

const logReaper = (stage: string, fields: Record<string, unknown> = {}): void => {
  console.warn("[event-cover-video-reaper]", JSON.stringify({ stage, ...fields }));
};

type TargetState = { deleted: boolean; coverUrl: string | null };

export const handleReaper = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const nowMs = Date.now();
  const tickStartMs = nowMs;
  // #3040 (B-6) — stop STARTING new work past the budget; leases expire.
  let budgetExhausted = false;
  const overBudget = (): boolean => {
    if (Date.now() - tickStartMs > REAPER_TICK_BUDGET_MS) {
      budgetExhausted = true;
    }
    return budgetExhausted;
  };
  // #3040 (B-9) — internal step failures are reported, never swallowed.
  const stepFailures: string[] = [];
  const stepFailed = (stage: string, fields: Record<string, unknown> = {}) => {
    if (!stepFailures.includes(stage)) stepFailures.push(stage);
    logReaper(stage, fields);
  };
  const errorName = (error: unknown): string =>
    error instanceof Error ? error.name : "error";
  try {
    const supabase = deps.serviceRoleClient();
    // Issue #3040 — the reaper already owns the minute-cadence provider truth
    // loop. Record each unresolved final-byte-to-READY breach exactly once on
    // the existing Bunny health rail before doing provider I/O. The RPC is a
    // bounded SKIP LOCKED claim, so overlapping ticks cannot duplicate alerts.
    const { data: sloBreaches, error: sloBreachError } = await supabase.rpc(
      "cover_video_record_processing_slo_breaches",
      { p_limit: 100 },
    );
    if (sloBreachError) {
      console.warn(
        "[event-cover-video-reaper]",
        JSON.stringify({
          code: sloBreachError.code,
          stage: "processing_slo_record_failed",
        }),
      );
    }
    const processingSloBreaches = Array.isArray(sloBreaches)
      ? sloBreaches.length
      : 0;
    for (const breach of (sloBreaches ?? []) as Array<Record<string, unknown>>) {
      console.warn(
        "[event-cover-video-reaper]",
        JSON.stringify({
          jobId: breach.id,
          sourceUploadedAt: breach.source_uploaded_at,
          stage: "processing_slo_breached",
        }),
      );
    }
    // #3040 (B-12) — two bounded, ORDERED reads replace one unordered window
    // that only ever grew (applied rows were never reaped, so they filled the
    // 1000-row window and starved live work):
    //   reap  — terminal, un-reaped, asset-bearing; oldest completion first.
    //   sweep — in-transfer uploads with an asset; oldest first.
    // Every predicate is re-checked by the pure selectors below.
    const reapRead = await supabase
      .from("event_cover_video_jobs")
      .select(CANDIDATE_COLUMNS)
      .in("status", ["failed", "cancelled", "superseded"])
      .is("reaped_at", null)
      .not("source_asset_id", "is", null)
      .order("completed_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .limit(SCAN_LIMIT);
    if (reapRead.error) {
      console.error("[event-cover-video-reaper] candidate read failed", {
        code: reapRead.error.code,
      });
      return jsonResponse({ ok: false, error: "candidate_read_failed" });
    }
    const sweepRead = await supabase
      .from("event_cover_video_jobs")
      .select(CANDIDATE_COLUMNS)
      .in("status", ["source_uploading"])
      .is("reaped_at", null)
      .not("source_asset_id", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(SCAN_LIMIT);
    if (sweepRead.error) {
      console.error("[event-cover-video-reaper] candidate read failed", {
        code: sweepRead.error.code,
      });
      return jsonResponse({ ok: false, error: "candidate_read_failed" });
    }
    const reapRows = (reapRead.data ?? []) as ReapCandidate[];
    const sweepRows = ((sweepRead.data ?? []) as ReapCandidate[]).filter(
      (row) => row.status === "source_uploading",
    );
    const targets = selectReapTargets(reapRows, nowMs);
    const addTarget = (candidate: ReapCandidate, guarded = false): void => {
      const existing = targets.find((target) => target.id === candidate.id);
      if (existing) {
        if (guarded) existing.guarded = true;
        return;
      }
      targets.push({ ...toTarget(candidate), guarded: guarded || undefined });
    };

    const { data: claimed, error: claimError } = await supabase.rpc(
      "cover_video_claim_reconcile_jobs",
      { p_limit: 100, p_lease_seconds: 60 },
    );
    if (claimError) {
      return jsonResponse({ ok: false, error: "reconcile_claim_failed" });
    }
    let reconciled = 0;
    let stalled = 0;
    let allocationAbandoned = 0;
    let allocationUnresolved = 0;
    let targetDeleted = 0;
    const readyOwner: Record<string, number> = {};
    // #2905 — drive the stall deadline through the canonical transition RPC so a
    // stalled job becomes a real, visible, retryable terminal failure with a
    // failure_code (never a silent delete), and queue its asset for reclamation
    // in this same tick.
    const failStalledIf = async (
      candidate: ReapCandidate,
      providerRead: "non_terminal" | "absent" | "unreadable",
    ): Promise<void> => {
      const verdict = evaluateCoverVideoStall({
        createdAt: candidate.created_at ?? null,
        sourceUploadedAt: candidate.source_uploaded_at ?? null,
        nowMs,
        providerRead,
        status: candidate.status,
      });
      if (!verdict.stalled) return;
      const { data: failedJob } = await supabase.rpc(
        "cover_video_transition_job",
        {
          p_job_id: candidate.id,
          p_from_statuses: STALLABLE_STATUSES,
          p_to_status: "failed",
          p_provider_status: null,
          p_provider_progress: null,
          p_patch: {
            failure_code: verdict.failureCode,
            failure_message: verdict.failureMessage,
          },
        },
      );
      if (failedJob?.status !== "failed") return;
      stalled += 1;
      console.warn(
        "[event-cover-video-reaper]",
        JSON.stringify({
          createdAt: candidate.created_at,
          failureCode: verdict.failureCode,
          jobId: candidate.id,
          stage: "stall_deadline_failed_job",
        }),
      );
      addTarget(candidate);
    };
    const failSourceUploading = async (
      candidate: ReapCandidate,
      failureCode: string,
      failureMessage: string,
    ): Promise<boolean> => {
      const { data: failedJob } = await supabase.rpc(
        "cover_video_transition_job",
        {
          p_job_id: candidate.id,
          p_from_statuses: ["source_uploading"],
          p_to_status: "failed",
          p_provider_status: null,
          p_provider_progress: null,
          p_patch: {
            failure_code: failureCode,
            failure_message: failureMessage,
          },
        },
      );
      return failedJob?.status === "failed";
    };

    // ── #3040 (B-13) ALLOCATION ABANDONED ────────────────────────────────
    // A job whose client vanished between job creation and provider
    // allocation has no asset and no uncertainty marker, so neither the
    // sweep nor the claim can ever see it. Bound: 10 minutes after creation.
    try {
      const allocationRead = await supabase
        .from("event_cover_video_jobs")
        .select(CANDIDATE_COLUMNS)
        .in("status", ["source_uploading"])
        .is("source_asset_id", null)
        .is("provider_allocation_uncertain_at", null)
        .lt(
          "created_at",
          new Date(nowMs - COVER_VIDEO_ALLOCATION_ABANDON_MS).toISOString(),
        )
        .order("created_at", { ascending: true })
        .limit(SCAN_LIMIT);
      if (allocationRead.error) {
        stepFailed("allocation_abandoned_read_failed", {
          code: allocationRead.error.code ?? null,
        });
      }
      for (
        const candidate of selectAbandonedAllocations(
          (allocationRead.data ?? []) as ReapCandidate[],
          nowMs,
        )
      ) {
        if (overBudget()) break;
        if (
          await failSourceUploading(
            candidate,
            "allocation_abandoned",
            "The upload never started. Try uploading the video again.",
          )
        ) {
          allocationAbandoned += 1;
          logReaper("allocation_abandoned", { jobId: candidate.id });
        }
      }
    } catch (error) {
      stepFailed("allocation_abandoned_failed", { error: errorName(error) });
    }

    // ── #3040 ABANDONED source_uploading SWEEP ──────────────────────────
    // Invariant 7: a job whose client never comes back must still reach a
    // terminal state SERVER-SIDE. Every write goes through
    // `cover_video_transition_job`, whose CAS makes a concurrent or repeated
    // run a no-op.
    //
    //   RECOVER — Bunny's own TUS HEAD proves the transfer completed, so the
    //             ack was simply never made. Advance `source_uploading →
    //             source_uploaded`; the webhook still runs its identity check
    //             before any `ready` (the #2967 interlock is intact).
    //   FAIL    — the transfer is incomplete AND the TUS lease has expired.
    //   LEAVE   — lease still alive: the user may be mid-upload right now.
    //   (B-8)   — an UNREADABLE HEAD after the lease is not proof of anything;
    //             it gets 30 more minutes before the upload is unverifiable.
    let sweptSourceUploading = 0;
    for (const candidate of sweepRows) {
      if (overBudget()) break;
      if (candidate.reaped_at != null) continue;
      if (!hasAssetId(candidate.source_asset_id)) continue;
      const guid = typeof candidate.source_asset_id === "string"
        ? candidate.source_asset_id
        : null;
      const transfer = await readTusTransfer(
        typeof candidate.source_bytes === "number" ? candidate.source_bytes : -1,
        guid,
        typeof candidate.tus_resource_url === "string"
          ? candidate.tus_resource_url
          : null,
        { bunnyPresignTusUpload },
      );
      if (transfer.kind === "complete") {
        const { data: advanced } = await supabase.rpc(
          "cover_video_transition_job",
          {
            p_job_id: candidate.id,
            p_from_statuses: ["source_uploading"],
            p_to_status: "source_uploaded",
            p_provider_status: null,
            p_provider_progress: null,
            p_patch: { tus_upload_offset: transfer.uploadOffset },
          },
        );
        if (advanced?.status === "source_uploaded") {
          sweptSourceUploading += 1;
          console.warn(
            "[event-cover-video-reaper]",
            JSON.stringify({
              jobId: candidate.id,
              stage: "abandoned_source_upload_recovered",
              uploadOffset: transfer.uploadOffset,
            }),
          );
        }
        continue;
      }
      const expiresAt = typeof candidate.tus_expires_at === "string"
        ? Date.parse(candidate.tus_expires_at)
        : Number.NaN;
      if (!Number.isFinite(expiresAt) || nowMs < expiresAt) {
        // Lease alive (or unreadable expiry): never convert a live upload into
        // a failure. `failStalledIf` still owns the backstop.
        await failStalledIf(candidate, "non_terminal");
        continue;
      }
      if (
        transfer.kind === "unreadable" &&
        nowMs < expiresAt + COVER_VIDEO_UNVERIFIABLE_GRACE_MS
      ) {
        continue;
      }
      const unverifiable = transfer.kind === "unreadable";
      const failed = await failSourceUploading(
        candidate,
        unverifiable ? "source_unverifiable" : "source_transport_expired",
        unverifiable
          ? "The upload could not be verified. Try uploading the video again."
          : "The upload session expired before the video finished uploading.",
      );
      if (!failed) continue;
      sweptSourceUploading += 1;
      console.warn(
        "[event-cover-video-reaper]",
        JSON.stringify({
          jobId: candidate.id,
          stage: "abandoned_source_upload_expired",
          transfer: transfer.kind,
          tusExpiresAt: candidate.tus_expires_at,
        }),
      );
      addTarget(candidate);
    }

    const claimedRows = (claimed ?? []) as ReapCandidate[];
    // #3040 (B-4) — parent state for every claimed job: a soft-deleted event or
    // brand fails its jobs, and the ready owner needs the current cover. A
    // failed read is reported and leaves this tick's soft-delete and
    // server-apply decisions undecided (never guessed).
    const eventState = new Map<string, TargetState>();
    const brandState = new Map<string, TargetState>();
    let targetStateKnown = true;
    try {
      const eventIds = [
        ...new Set(
          claimedRows.flatMap((row) =>
            (row.target_kind === "event" ||
                row.target_kind === "trip_day_media") &&
              typeof row.event_id === "string"
              ? [row.event_id]
              : []
          ),
        ),
      ];
      const brandIds = [
        ...new Set(
          claimedRows.flatMap((row) =>
            typeof row.brand_id === "string" ? [row.brand_id] : []
          ),
        ),
      ];
      if (eventIds.length > 0) {
        const events = await supabase.from("events")
          .select("id,deleted_at,cover_media_url").in("id", eventIds)
          .limit(eventIds.length);
        if (events.error) throw new Error("event_read_failed");
        for (const row of (events.data ?? []) as Array<Record<string, unknown>>) {
          if (typeof row.id !== "string") continue;
          eventState.set(row.id, {
            deleted: row.deleted_at != null,
            coverUrl: typeof row.cover_media_url === "string"
              ? row.cover_media_url
              : null,
          });
        }
      }
      if (brandIds.length > 0) {
        const brands = await supabase.from("brands")
          .select("id,deleted_at,cover_media_url").in("id", brandIds)
          .limit(brandIds.length);
        if (brands.error) throw new Error("brand_read_failed");
        for (const row of (brands.data ?? []) as Array<Record<string, unknown>>) {
          if (typeof row.id !== "string") continue;
          brandState.set(row.id, {
            deleted: row.deleted_at != null,
            coverUrl: typeof row.cover_media_url === "string"
              ? row.cover_media_url
              : null,
          });
        }
      }
    } catch (error) {
      targetStateKnown = false;
      stepFailed("target_state_read_failed", { error: errorName(error) });
    }
    const parentDeleted = (row: ReapCandidate): boolean => {
      if (!targetStateKnown) return false;
      const event = typeof row.event_id === "string"
        ? eventState.get(row.event_id)
        : undefined;
      const brand = typeof row.brand_id === "string"
        ? brandState.get(row.brand_id)
        : undefined;
      return event?.deleted === true || brand?.deleted === true;
    };
    const currentCover = (row: ReapCandidate): string | null | undefined => {
      if (!targetStateKnown) return undefined;
      const state = row.target_kind === "event" && typeof row.event_id === "string"
        ? eventState.get(row.event_id)
        : row.target_kind === "brand" && typeof row.brand_id === "string"
        ? brandState.get(row.brand_id)
        : undefined;
      return state === undefined ? undefined : state.coverUrl;
    };

    for (const candidate of claimedRows) {
      if (overBudget()) break;
      if (
        ["cancelled", "failed", "superseded"].includes(candidate.status ?? "")
      ) {
        addTarget(candidate);
        continue;
      }
      // #3040 (B-4) — the parent was soft-deleted under a live job.
      if (
        NON_TERMINAL_OR_READY.includes(candidate.status ?? "") &&
        parentDeleted(candidate)
      ) {
        try {
          const { data: failedJob } = await supabase.rpc(
            "cover_video_transition_job",
            {
              p_job_id: candidate.id,
              p_from_statuses: NON_TERMINAL_OR_READY,
              p_to_status: "failed",
              p_provider_status: null,
              p_provider_progress: null,
              p_patch: {
                failure_code: "target_deleted",
                failure_message: "The item this video was for was deleted.",
              },
            },
          );
          if (failedJob?.status === "failed") {
            targetDeleted += 1;
            logReaper("target_deleted_failed_job", { jobId: candidate.id });
            addTarget({ ...candidate, failure_code: "target_deleted" }, true);
          }
        } catch (error) {
          stepFailed("target_deleted_failed", { error: errorName(error) });
        }
        continue;
      }
      if (candidate.status === "ready") {
        // Ready is already authoritative provider truth. Counting it here keeps
        // the existing reconcile metric; the ready owner below decides it.
        reconciled += 1;
        try {
          const guid = typeof candidate.source_asset_id === "string"
            ? candidate.source_asset_id
            : "";
          const references = await readGuidLiveReferences(
            supabase,
            guid,
            candidate.id,
          );
          if (!references.ok) {
            stepFailed(
              references.reason === "migration_not_applied"
                ? "migration_not_applied"
                : "ready_owner_references_unreadable",
              { jobId: candidate.id },
            );
          }
          const job = candidate as unknown as ReadyOwnerJob;
          const decision = decideReadyOwnership({
            job,
            references: references.ok ? references.kinds : null,
            targetCoverNow: currentCover(candidate),
            nowMs,
          });
          const outcome = await executeReadyOwnership(
            supabase,
            job,
            decision,
            nowMs,
          );
          readyOwner[outcome] = (readyOwner[outcome] ?? 0) + 1;
          if (outcome === "expired") {
            addTarget({ ...candidate, failure_code: "ready_unclaimed" }, true);
          }
        } catch (error) {
          stepFailed("ready_owner_failed", {
            jobId: candidate.id,
            error: errorName(error),
          });
        }
        continue;
      }
      if (
        candidate.status === "source_uploading" &&
        candidate.provider_allocation_uncertain_at != null &&
        candidate.provider_allocation_identity === candidate.id &&
        !hasAssetId(candidate.source_asset_id)
      ) {
        // #3040 (B-13) — an uncertain allocation that title lookup could not
        // resolve for 30 minutes is ended, named.
        const unresolvedTooLong = (): boolean =>
          nowMs - parseMs(candidate.provider_allocation_uncertain_at ?? null) >=
            COVER_VIDEO_ALLOCATION_UNRESOLVED_MS;
        const allocation = await supabase.rpc(
          "cover_video_claim_provider_allocation",
          { p_job_id: candidate.id, p_lease_seconds: 60 },
        );
        const token = allocation.data?.provider_allocation_token;
        // #2905 — an unresolvable allocation is the OTHER immortality hole: no
        // asset id means the promotion path can never run for this row. A
        // provider lookup that failed is transient ("unreadable" → never
        // stalls); a lookup that authoritatively found nothing is "absent".
        if (typeof token !== "string") {
          if (
            unresolvedTooLong() &&
            await failSourceUploading(
              candidate,
              "allocation_unresolved",
              "The upload could not be started. Try uploading the video again.",
            )
          ) {
            allocationUnresolved += 1;
            continue;
          }
          await failStalledIf(candidate, "non_terminal");
          continue;
        }
        const lookup = await deps.bunnyFindVideoByTitle(candidate.id);
        if (!lookup.ok) {
          if (
            unresolvedTooLong() &&
            await failSourceUploading(
              candidate,
              "allocation_unresolved",
              "The upload could not be started. Try uploading the video again.",
            )
          ) {
            allocationUnresolved += 1;
            continue;
          }
          await failStalledIf(candidate, "unreadable");
          continue;
        }
        const resolution = await supabase.rpc(
          "cover_video_resolve_provider_allocation",
          {
            p_job_id: candidate.id,
            p_token: token,
            p_source_asset_id: lookup.guid,
            p_absent: lookup.guid === null,
          },
        );
        if (!resolution.error && resolution.data) reconciled += 1;
        if (lookup.guid === null) await failStalledIf(candidate, "absent");
        continue;
      }
      const guid = typeof candidate.source_asset_id === "string"
        ? candidate.source_asset_id
        : "";
      const provider = await deps.bunnyGetVideo(guid);
      if (!provider.ok) {
        // A 404 is definitive provider absence; anything else is transient and
        // must never convert healthy work into failure.
        await failStalledIf(
          candidate,
          provider.status === 404 ? "absent" : "unreadable",
        );
        continue;
      }
      // ── #2905 THE ENUM SEAM ──────────────────────────────────────────────
      // `provider.video.status` is the Bunny API VIDEO-OBJECT enum (4 =
      // Finished, 3 = Transcoding). `handleBunnyWebhook` reads the Bunny
      // WEBHOOK enum (3 = Finished, 4 = ResolutionFinished). The crossing is
      // made exactly once, by one function named for both enums.
      const webhookStatus = bunnyApiVideoStatusAsWebhookStatus(
        provider.video.status,
      );
      const providerLifecycle = mapBunnyStatusFromApiVideo(
        provider.video.status,
      );
      if (webhookStatus === null) {
        // An unknown/ignorable API status is never laundered into a webhook
        // body, but it still counts as non-terminal for the stall deadline.
        await failStalledIf(candidate, "non_terminal");
        continue;
      }
      const rawBody = JSON.stringify({
        VideoGuid: guid,
        Status: webhookStatus,
      });
      const secret = Deno.env.get("BUNNY_STREAM_WEBHOOK_KEY") ?? "";
      if (secret.length === 0) continue;
      const signature = await hmacSha256Hex(secret, rawBody);
      const request = new Request(
        "https://internal/event-cover-video-webhook",
        {
          method: "POST",
          headers: {
            "x-bunnystream-signature": signature,
            "x-bunnystream-signature-version": "v1",
            "x-bunnystream-signature-algorithm": "hmac-sha256",
          },
          body: rawBody,
        },
      );
      const response = await handleBunnyWebhook(
        request,
        await request.clone().text(),
        {
          bunnyGetVideo: deps.bunnyGetVideo,
          destroyCoverVideoAsset: deps.destroyCoverVideoAsset,
          serviceRoleClient: deps.serviceRoleClient,
          // #3134 — the reconciler is already a retry; it must not also sit
          // through the webhook's identity re-poll. If the hash is not there
          // yet, the next tick (now one minute away) asks again.
          sleep: (): Promise<void> => Promise.resolve(),
        },
      );
      if (response.ok) reconciled += 1;
      console.log(
        "[event-cover-video-reaper]",
        JSON.stringify({
          apiStatus: provider.video.status,
          jobId: candidate.id,
          jobStatus: candidate.status,
          lifecycle: providerLifecycle,
          replayStatus: response.status,
          stage: "reconcile_replay",
          webhookStatus,
        }),
      );
      // #2905 — the stall deadline is keyed on THIS TICK'S ACTUAL OUTCOME, not
      // on what the provider claims: a Finished asset whose derivative the CDN
      // will not serve must still die at the deadline.
      if (response.ok) {
        if (providerLifecycle !== "ready" && providerLifecycle !== "failed") {
          await failStalledIf(candidate, "non_terminal");
        }
      } else {
        const replayBody = await response.clone().json().catch(() => null);
        const transient = replayBody !== null &&
          typeof replayBody === "object" &&
          (replayBody as Record<string, unknown>).error ===
            "provider_temporarily_unavailable";
        await failStalledIf(candidate, transient ? "unreadable" : "non_terminal");
      }
    }

    // ── #3040 (B-14) ORPHAN RECLAIM ─────────────────────────────────────
    // Applied assets that nothing has referenced for 7 days. Off by default:
    // with the flag off this is a dry run that only counts candidates.
    let orphanCandidates = 0;
    let orphanDestroyed = 0;
    let orphanReclaimEnabled = false;
    if (!overBudget()) {
      try {
        const flag = await supabase.from("admin_config").select("value")
          .eq("key", ORPHAN_RECLAIM_FLAG_KEY).maybeSingle();
        orphanReclaimEnabled = !flag.error && flag.data?.value === true;
        const orphanRead = await supabase
          .from("event_cover_video_jobs")
          .select(CANDIDATE_COLUMNS)
          .in("status", ["applied"])
          .is("reaped_at", null)
          .not("source_asset_id", "is", null)
          .lt(
            "completed_at",
            new Date(nowMs - COVER_VIDEO_ORPHAN_AGE_MS).toISOString(),
          )
          .order("completed_at", { ascending: true })
          .limit(COVER_VIDEO_ORPHAN_RECLAIM_LIMIT);
        if (orphanRead.error) {
          stepFailed("orphan_read_failed", { code: orphanRead.error.code ?? null });
        }
        for (
          const orphan of selectOrphanCandidates(
            (orphanRead.data ?? []) as ReapCandidate[],
            nowMs,
          )
        ) {
          if (overBudget()) break;
          const guid = String(orphan.source_asset_id);
          if (!orphanReclaimEnabled) {
            const references = await readGuidLiveReferences(
              supabase,
              guid,
              orphan.id,
            );
            if (references.ok && references.kinds.length === 0) {
              orphanCandidates += 1;
            }
            continue;
          }
          const outcome = await destroyIfUnreferenced(supabase, orphan, {
            destroyCoverVideoAsset: deps.destroyCoverVideoAsset,
          });
          if (outcome.outcome === "destroyed") {
            orphanCandidates += 1;
            orphanDestroyed += 1;
          }
        }
        logReaper("orphan_reclaim_candidate", {
          enabled: orphanReclaimEnabled,
          candidates: orphanCandidates,
          destroyed: orphanDestroyed,
        });
      } catch (error) {
        stepFailed("orphan_reclaim_failed", { error: errorName(error) });
      }
    }

    let reaped = 0;
    let failed = 0;
    let guardedSkipped = 0;
    for (const target of targets) {
      if (target.guarded) {
        // #3040 — a verified asset whose job ended without being applied may
        // be served somewhere; destroy only when nothing references it.
        const outcome = await destroyIfUnreferenced(supabase, target, {
          destroyCoverVideoAsset: deps.destroyCoverVideoAsset,
        });
        if (outcome.outcome === "destroyed") reaped += 1;
        else if (outcome.outcome === "destroy_failed") failed += 1;
        else if (outcome.outcome === "unknown") {
          guardedSkipped += 1;
          stepFailed(
            outcome.reason === "migration_not_applied"
              ? "migration_not_applied"
              : "guarded_reap_unknown",
            { jobId: target.id },
          );
        } else guardedSkipped += 1;
        continue;
      }
      const destroyed = await deps.destroyCoverVideoAsset(target);
      if (!destroyed.ok) {
        // Fail-safe: leave reaped_at NULL so the next run retries. Never wedge.
        failed += 1;
        console.warn("[event-cover-video-reaper] destroy failed:", {
          jobId: target.id,
          reason: destroyed.reason,
        });
        continue;
      }
      const patch: Record<string, unknown> = {
        reaped_at: new Date().toISOString(),
      };
      await supabase.from("event_cover_video_jobs").update(patch).eq(
        "id",
        target.id,
      );
      reaped += 1;
    }

    // #3040 (B-9) — a failed internal step reaches the Bunny health rail. Best
    // effort: the tick's own result must never depend on this write.
    if (stepFailures.length > 0) {
      try {
        const checkedAt = new Date().toISOString();
        const { error: healthError } = await supabase.from("api_health_checks")
          .insert(stepFailures.map((stage) => ({
            service_key: "bunny",
            layer: "passive",
            status: "degraded",
            latency_ms: null,
            mode: null,
            http_status: null,
            detail: { signal: "cover_video_reaper_step_failed", stage },
            checked_at: checkedAt,
          })));
        if (healthError) {
          logReaper("step_failure_health_write_failed", {
            code: healthError.code ?? null,
          });
        }
      } catch (error) {
        logReaper("step_failure_health_write_failed", {
          error: errorName(error),
        });
      }
    }
    if (budgetExhausted) logReaper("tick_budget_exhausted");

    return jsonResponse({
      ok: true,
      candidates: new Set([...reapRows, ...sweepRows].map((row) => row.id))
        .size,
      targets: targets.length,
      reaped,
      failed,
      guardedSkipped,
      reconciled,
      stalled,
      allocationAbandoned,
      allocationUnresolved,
      targetDeleted,
      readyOwner,
      orphanReclaim: {
        enabled: orphanReclaimEnabled,
        candidates: orphanCandidates,
        destroyed: orphanDestroyed,
      },
      processingSloBreaches,
      sweptSourceUploading,
      stepFailures,
      budgetExhausted,
      timestamp: new Date(nowMs).toISOString(),
    });
  } catch (err) {
    console.error("[event-cover-video-reaper] tick failed", {
      error: errorName(err),
    });
    // 200 so pg_cron does not retry-storm.
    return jsonResponse({
      ok: false,
      error: "reaper_tick_failed",
      stepFailures,
    });
  }
};

if (import.meta.main) {
  serve((req) => handleReaper(req));
}
