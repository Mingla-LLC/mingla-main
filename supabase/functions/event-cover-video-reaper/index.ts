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

const REAP_ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

export type ReapCandidate = {
  id: string;
  status: string | null;
  provider?: string | null;
  source_asset_id?: unknown;
  source_public_id?: unknown;
  applied_at?: string | null;
  reaped_at?: string | null;
  created_at?: string | null;
};

export type ReapTarget = {
  id: string;
  provider?: string | null;
  source_asset_id?: unknown;
  source_public_id?: unknown;
  action: "reap" | "reap_abandoned";
};

const hasAssetId = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

// PURE selection: which un-reaped, asset-bearing jobs to reclaim, and whether an
// abandoned draft also needs its terminal state flipped to failed. Idempotent by
// reaped_at (already-reaped rows are skipped → never a double-delete).
export function selectReapTargets(jobs: ReapCandidate[], nowMs: number): ReapTarget[] {
  const targets: ReapTarget[] = [];
  for (const job of jobs) {
    if (job.reaped_at != null) continue;             // already reaped — never double-delete
    if (!hasAssetId(job.source_asset_id)) continue;   // only provider-asset-bearing (Bunny) rows
    const status = job.status ?? "";
    if (status === "cancelled" || status === "failed") {
      targets.push({
        id: job.id,
        provider: job.provider,
        source_asset_id: job.source_asset_id,
        source_public_id: job.source_public_id,
        action: "reap",
      });
      continue;
    }
    if (status === "source_uploaded" || status === "ready") {
      if (job.applied_at != null) continue;           // an applied cover is live — never reap
      const createdMs = job.created_at ? new Date(job.created_at).getTime() : NaN;
      if (Number.isFinite(createdMs) && nowMs - createdMs >= REAP_ABANDONED_AFTER_MS) {
        targets.push({
          id: job.id,
          provider: job.provider,
          source_asset_id: job.source_asset_id,
          source_public_id: job.source_public_id,
          action: "reap_abandoned",
        });
      }
    }
  }
  return targets;
}

const defaultDeps = {
  destroyCoverVideoAsset,
  serviceRoleClient,
};

export const handleReaper = async (
  req: Request,
  deps: typeof defaultDeps = defaultDeps,
): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
      .select("id,status,provider,source_asset_id,source_public_id,applied_at,reaped_at,created_at")
      .is("reaped_at", null)
      .not("source_asset_id", "is", null)
      .limit(1000);
    if (error) {
      console.error("[event-cover-video-reaper] candidate read failed:", error);
      return jsonResponse({ ok: false, error: error.message });
    }
    const targets = selectReapTargets((data ?? []) as ReapCandidate[], nowMs);

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
      const patch: Record<string, unknown> = { reaped_at: new Date().toISOString() };
      if (target.action === "reap_abandoned") {
        patch.status = "failed";
        patch.completed_at = new Date().toISOString();
        patch.failure_code = "reaped_abandoned";
        patch.failure_message = "Abandoned cover-video draft reclaimed by the reaper.";
      }
      await supabase.from("event_cover_video_jobs").update(patch).eq("id", target.id);
      reaped += 1;
    }

    return jsonResponse({
      ok: true,
      candidates: (data ?? []).length,
      targets: targets.length,
      reaped,
      failed,
      timestamp: new Date(nowMs).toISOString(),
    });
  } catch (err) {
    console.error("[event-cover-video-reaper] tick failed:", err);
    // 200 so pg_cron does not retry-storm.
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

if (import.meta.main) {
  serve((req) => handleReaper(req));
}
