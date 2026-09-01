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
  hmacSha256Hex,
  mapBunnyStatusFromApiVideo,
} from "../_shared/bunnyStream.ts";
import { handleBunnyWebhook } from "../event-cover-video-webhook/index.ts";

export type ReapCandidate = {
  id: string;
  status: string | null;
  provider?: string | null;
  source_asset_id?: unknown;
  source_public_id?: unknown;
  applied_at?: string | null;
  reaped_at?: string | null;
  created_at?: string | null;
  provider_allocation_identity?: string | null;
  provider_allocation_uncertain_at?: string | null;
  provider_allocation_token?: string | null;
};

export type ReapTarget = {
  id: string;
  provider?: string | null;
  source_asset_id?: unknown;
  source_public_id?: unknown;
  action: "reap";
};

const hasAssetId = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

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
      targets.push({
        id: job.id,
        provider: job.provider,
        source_asset_id: job.source_asset_id,
        source_public_id: job.source_public_id,
        action: "reap",
      });
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

// ── #2905 STALL DEADLINE ────────────────────────────────────────────────────
//
// #2715 correctly stopped age from reaping durable work, but combined with a
// promotion path that could not fire it made a wedged job IMMORTAL: it never
// completed, never failed, never reaped. Production job e055c562-… sat in
// `processing` for 3 days with failure_code NULL and no user-visible affordance.
//
// A non-terminal job past this deadline becomes a VISIBLE, RETRYABLE failure
// (mapEventCoverVideoStatus sets canRetry for `failed`), never a silent delete.
//
// WHY 12 HOURS:
//   • The reconciler ticks every 6h, so 12h guarantees a job gets at least TWO
//     full provider-truth promotion attempts before it is ever called stalled.
//     Anything under 6h could declare a job stalled on the same tick that would
//     have promoted it.
//   • Bunny may legitimately encode well beyond 120s (#2715), so a
//     seconds-or-minutes deadline is wrong on its face. The slowest cover video
//     that ever reached `applied` in production took 93s (2026-08-12 18:03:43 →
//     18:05:16); 12h is ~465× that and ~1,700× the median (18s).
//   • It is HALF the pre-existing 24h abandoned-draft window, so a stalled job
//     surfaces to the host the same day they uploaded it — strictly sooner than
//     the old code, which silently deleted it at 24h with no explanation.
export const COVER_VIDEO_STALL_MS = 12 * 60 * 60 * 1000;

// Only non-terminal states are stallable. `ready` is authoritative provider
// truth waiting on its owner to apply it (and cover_video_transition_job has no
// ready→failed edge), so it is deliberately excluded.
const STALLABLE_STATUSES = [
  "source_uploading",
  "source_uploaded",
  "processing_queued",
  "processing",
];

export type StallVerdict =
  | { stalled: false; reason: string }
  | {
    stalled: true;
    failureCode: "processing_stalled" | "provider_asset_missing";
    failureMessage: string;
  };

// PURE. `providerRead` is how this tick's `bunnyGetVideo` resolved:
//   "non_terminal" — read succeeded, provider is still not finished/failed.
//   "absent"       — HTTP 404: the provider asset is definitively gone.
//   "unreadable"   — network / 5xx / not-configured. NEVER stalls: a Bunny
//                    outage must not convert healthy work into failure.
export function evaluateCoverVideoStall(input: {
  status: string | null;
  createdAt: string | null;
  nowMs: number;
  providerRead: "non_terminal" | "absent" | "unreadable";
}): StallVerdict {
  if (!STALLABLE_STATUSES.includes(input.status ?? "")) {
    return { stalled: false, reason: "not_stallable_status" };
  }
  if (input.providerRead === "unreadable") {
    return { stalled: false, reason: "provider_unreadable" };
  }
  const createdMs = input.createdAt === null
    ? Number.NaN
    : Date.parse(input.createdAt);
  if (!Number.isFinite(createdMs)) {
    return { stalled: false, reason: "created_at_unparseable" };
  }
  if (input.nowMs - createdMs < COVER_VIDEO_STALL_MS) {
    return { stalled: false, reason: "within_stall_window" };
  }
  return input.providerRead === "absent"
    ? {
      stalled: true,
      failureCode: "provider_asset_missing",
      failureMessage:
        "The uploaded video is no longer available at the media host.",
    }
    : {
      stalled: true,
      failureCode: "processing_stalled",
      failureMessage:
        "Video processing did not finish in time. Try uploading it again.",
    };
}

const defaultDeps = {
  bunnyFindVideoByTitle,
  bunnyGetVideo,
  destroyCoverVideoAsset,
  serviceRoleClient,
};

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
  try {
    const supabase = deps.serviceRoleClient();
    // Candidate window: un-reaped rows that carry a provider asset id. The pure
    // selector applies the terminal/abandoned predicates. Bounded by the partial
    // index (reaped_at IS NULL AND source_asset_id IS NOT NULL).
    const { data, error } = await supabase
      .from("event_cover_video_jobs")
      .select(
        "id,status,provider,source_asset_id,source_public_id,applied_at,reaped_at,created_at",
      )
      .is("reaped_at", null)
      .not("source_asset_id", "is", null)
      .limit(1000);
    if (error) {
      console.error("[event-cover-video-reaper] candidate read failed", {
        code: error.code,
      });
      return jsonResponse({ ok: false, error: "candidate_read_failed" });
    }
    const targets = selectReapTargets((data ?? []) as ReapCandidate[], nowMs);

    const { data: claimed, error: claimError } = await supabase.rpc(
      "cover_video_claim_reconcile_jobs",
      { p_limit: 100, p_lease_seconds: 60 },
    );
    if (claimError) {
      return jsonResponse({ ok: false, error: "reconcile_claim_failed" });
    }
    let reconciled = 0;
    let stalled = 0;
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
      if (!targets.some((target) => target.id === candidate.id)) {
        targets.push({
          id: candidate.id,
          provider: candidate.provider,
          source_asset_id: candidate.source_asset_id,
          source_public_id: candidate.source_public_id,
          action: "reap",
        });
      }
    };
    for (const candidate of (claimed ?? []) as ReapCandidate[]) {
      if (
        ["cancelled", "failed", "superseded"].includes(candidate.status ?? "")
      ) {
        if (!targets.some((target) => target.id === candidate.id)) {
          targets.push({
            id: candidate.id,
            provider: candidate.provider,
            source_asset_id: candidate.source_asset_id,
            source_public_id: candidate.source_public_id,
            action: "reap",
          });
        }
        continue;
      }
      if (candidate.status === "ready") {
        // Ready is already authoritative provider truth. Keep it durable for its
        // target owner; counting it here feeds ready-unapplied operations alerts.
        reconciled += 1;
        continue;
      }
      if (
        candidate.status === "source_uploading" &&
        candidate.provider_allocation_uncertain_at != null &&
        candidate.provider_allocation_identity === candidate.id &&
        !hasAssetId(candidate.source_asset_id)
      ) {
        const allocation = await supabase.rpc(
          "cover_video_claim_provider_allocation",
          { p_job_id: candidate.id, p_lease_seconds: 60 },
        );
        const token = allocation.data?.provider_allocation_token;
        // #2905 — an unresolvable allocation is the OTHER immortality hole: no
        // asset id means the promotion path can never run for this row. The
        // deadline is the only thing that can end it. A provider lookup that
        // failed is transient ("unreadable" → never stalls); a lookup that
        // authoritatively found nothing is "absent".
        if (typeof token !== "string") {
          await failStalledIf(candidate, "non_terminal");
          continue;
        }
        const lookup = await deps.bunnyFindVideoByTitle(candidate.id);
        if (!lookup.ok) {
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
      // WEBHOOK enum (3 = Finished, 4 = ResolutionFinished). Passing the raw
      // API number across (the shipped bug) read a FINISHED video as "still
      // encoding, wait for 3" — a 3 that can never arrive after a 4 — so the
      // reconciler could never complete a job, and read a TRANSCODING video as
      // ready, which would have published a half-encoded video. The crossing is
      // now made exactly once, by one function named for both enums.
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
      // on what the provider claims. Gating it on `providerLifecycle` alone
      // would re-open the wedge for the case where Bunny reports Finished but
      // the promotion still cannot complete — e.g. `availableResolutions`
      // advertises a rendition the CDN does not actually serve (play_720p.mp4
      // 404s for the wedged production asset right now), which 503s the ready
      // branch on every tick, forever, with the job never leaving `processing`.
      if (response.ok) {
        // The promotion path ran to completion. Only a provider that is itself
        // still mid-encode can be stalled here.
        if (providerLifecycle !== "ready" && providerLifecycle !== "failed") {
          await failStalledIf(candidate, "non_terminal");
        }
      } else {
        // The promotion could not complete. A provider read that failed INSIDE
        // the replay is transient and must never fail a job; every other
        // incompletion (unfetchable derivative or poster, refused transition) is
        // a genuine stall once the deadline has passed.
        const replayBody = await response.clone().json().catch(() => null);
        const transient = replayBody !== null &&
          typeof replayBody === "object" &&
          (replayBody as Record<string, unknown>).error ===
            "provider_temporarily_unavailable";
        await failStalledIf(candidate, transient ? "unreadable" : "non_terminal");
      }
    }

    let reaped = 0;
    let failed = 0;
    for (const target of targets) {
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

    return jsonResponse({
      ok: true,
      candidates: (data ?? []).length,
      targets: targets.length,
      reaped,
      failed,
      reconciled,
      stalled,
      timestamp: new Date(nowMs).toISOString(),
    });
  } catch (err) {
    console.error("[event-cover-video-reaper] tick failed");
    // 200 so pg_cron does not retry-storm.
    return jsonResponse({
      ok: false,
      error: "reaper_tick_failed",
    });
  }
};

if (import.meta.main) {
  serve((req) => handleReaper(req));
}
