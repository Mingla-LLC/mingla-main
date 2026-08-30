// META-ORCH-1270 (Phase 2) — cover-video storage reaper.
//
// Cron-invoked (every 6h) backstop that reclaims Bunny video assets left behind
// by any terminal transition the inline paths missed or that failed transiently:
//   • cancelled / failed jobs with a provider asset id + reaped_at IS NULL;
//   • abandoned drafts (source_uploaded / ready, never applied, > 24h old).
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
  bunnyFindVideoByTitle,
  bunnyGetVideo,
  hmacSha256Hex,
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
        if (typeof token !== "string") continue;
        const lookup = await deps.bunnyFindVideoByTitle(candidate.id);
        if (!lookup.ok) continue;
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
        continue;
      }
      const guid = typeof candidate.source_asset_id === "string"
        ? candidate.source_asset_id
        : "";
      const provider = await deps.bunnyGetVideo(guid);
      if (!provider.ok) continue;
      const rawBody = JSON.stringify({
        VideoGuid: guid,
        Status: provider.video.status,
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
