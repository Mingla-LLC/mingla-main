// Issue #3040 — `ready` always has a server owner.
//
// Before this, only an event draft_auto video applied itself; every other
// finished video (brand, venue draft, Host Ads, trip day, published event)
// waited for the uploading client to come back, and five production jobs sat
// at `ready` for up to 31 days. The reaper now runs this decision for every
// claimed `ready` job, every tick:
//
//   materialize    ad_creative: create its library row, then apply. Every tick
//                  until it succeeds; failing past the TTL ends the job.
//   apply_observed a live surface already serves this video: record it.
//   apply_server   event/brand cover, older than the grace, younger than the
//                  TTL, with a baseline cover RECORDED at upload that the
//                  target still shows: the server applies it. A job without
//                  a recorded baseline (legacy, pre-migration) or past the
//                  TTL is never auto-applied; it expires.
//   expire         older than the TTL: ready -> failed(ready_unclaimed); the
//                  asset is reclaimed only through the guarded destroy.
//   alert          older than the grace with nothing else to do: one durable
//                  alert on the Bunny health rail.
//   retain         venue_draft: the finished video lives in the host's local
//                  draft (no database row can see it). It is client-owned and
//                  kept, as before #3040: never expired, never alerted, never
//                  destroyed (I-VENUE-DRAFT-VIDEO-RETAINED).
//   wait           younger than the grace.
//
// Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): every non-terminal and ready job has a server owner with a finite bound
import {
  type MaterializableJob,
  materializeAdCreativeFromJob,
} from "./adCreativeMaterialize.ts";
import { reapPriorCoverAssets } from "./coverVideoReap.ts";

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const READY_GRACE_MS = 15 * 60 * 1000;
export const READY_TTL_MS = 24 * 60 * 60 * 1000;

export type ReadyOwnerAction =
  | "materialize"
  | "apply_observed"
  | "apply_server"
  | "expire"
  | "alert"
  | "retain"
  | "wait";

export type ReadyOwnerJob = MaterializableJob & {
  completed_at?: string | null;
  created_at?: string | null;
  target_cover_base_url?: string | null;
  target_cover_base_captured?: boolean | null;
  ready_alerted_at?: string | null;
  application_version?: number | null;
  application_receipt?: unknown;
  provider?: string | null;
  event_id?: string | null;
  source_public_id?: unknown;
};

export const readyAgeMs = (job: ReadyOwnerJob, nowMs: number): number => {
  const anchor = job.completed_at ?? job.created_at ?? null;
  const at = anchor === null ? Number.NaN : Date.parse(anchor);
  return Number.isFinite(at) ? Math.max(0, nowMs - at) : 0;
};

const coverTargets = new Set(["event", "brand"]);

// PURE. `references` is the live-reference answer for this job's asset
// (excluding the job itself), or null when it could not be read — an unknown
// answer never leads to an observed apply or an expiry. `targetCoverNow` is the
// current event/brand cover URL (null = no cover), or undefined when it could
// not be read or the target has no cover.
export function decideReadyOwnership(input: {
  job: ReadyOwnerJob;
  references: string[] | null;
  targetCoverNow: string | null | undefined;
  nowMs: number;
}): { action: ReadyOwnerAction; reason: string } {
  const { job, references, targetCoverNow, nowMs } = input;
  const age = readyAgeMs(job, nowMs);
  const kind = job.target_kind ?? "event";
  if (kind === "ad_creative") {
    return { action: "materialize", reason: "ad_creative_ready" };
  }
  const guid = typeof job.source_asset_id === "string"
    ? job.source_asset_id
    : "";
  // The database's own venue-draft retention arm is not a surface serving
  // the video; it never counts as an observed reference.
  const observed = references === null
    ? null
    : references.filter((kind) => kind !== "venue_draft");
  if (observed !== null && observed.length > 0) {
    // An event/brand apply rewrites the cover, so it is "observed" only when the
    // cover already IS this video; other targets only record a receipt.
    const onTarget = !coverTargets.has(kind) ||
      (typeof targetCoverNow === "string" && guid.length > 0 &&
        targetCoverNow.includes(`/${guid}/`));
    if (onTarget) {
      return { action: "apply_observed", reason: observed.join(",") };
    }
  }
  if (kind === "venue_draft") {
    return { action: "retain", reason: "client_owned_draft" };
  }
  // Server auto-apply needs proof the host still wants it: a baseline cover
  // recorded at upload, the target still showing exactly that baseline, and a
  // job inside the TTL. Nothing else is ever auto-applied.
  if (
    coverTargets.has(kind) && job.target_cover_base_captured === true &&
    age >= READY_GRACE_MS && age < READY_TTL_MS &&
    targetCoverNow !== undefined &&
    targetCoverNow === (job.target_cover_base_url ?? null)
  ) {
    return { action: "apply_server", reason: "cover_unchanged_since_upload" };
  }
  if (age >= READY_TTL_MS && references !== null) {
    return { action: "expire", reason: "ready_ttl_elapsed" };
  }
  // A cover job with no recorded baseline can never be auto-applied, so once
  // its grace has passed it is ended rather than left waiting.
  if (
    coverTargets.has(kind) && job.target_cover_base_captured !== true &&
    age >= READY_GRACE_MS && references !== null
  ) {
    return { action: "expire", reason: "no_recorded_baseline" };
  }
  if (age >= READY_GRACE_MS && !job.ready_alerted_at) {
    return { action: "alert", reason: "ready_unclaimed" };
  }
  return { action: "wait", reason: age >= READY_GRACE_MS ? "alerted" : "grace" };
}

export type ReadyOwnerOutcome =
  | "applied"
  | "materialize_pending"
  | "failed"
  | "expired"
  | "alerted"
  | "waiting"
  | "retained"
  | "lost";

export type ReadyOwnerDeps = {
  materializeAdCreativeFromJob: typeof materializeAdCreativeFromJob;
  reapPriorCoverAssets: typeof reapPriorCoverAssets;
};

const defaultDeps: ReadyOwnerDeps = {
  materializeAdCreativeFromJob,
  reapPriorCoverAssets,
};

const log = (stage: string, fields: Record<string, unknown>): void => {
  console.warn("[cover-video-ready-owner]", JSON.stringify({ stage, ...fields }));
};

async function serverApply(
  supabase: Supabase,
  job: ReadyOwnerJob,
  source: string,
): Promise<Record<string, unknown> | null> {
  const { data: applied, error } = await supabase.rpc("cover_video_apply_once", {
    p_job_id: job.id,
    p_expected_version: job.application_version ?? 0,
    p_expected_url: job.processed_url ?? null,
    p_expected_requested_by: null,
  });
  if (error || applied?.status !== "applied") return null;
  const receipt = applied.application_receipt !== null &&
      typeof applied.application_receipt === "object"
    ? applied.application_receipt as Record<string, unknown>
    : {};
  await supabase
    .from("event_cover_video_jobs")
    .update({ application_receipt: { ...receipt, source } })
    .eq("id", job.id);
  return applied as Record<string, unknown>;
}

async function failReady(
  supabase: Supabase,
  job: ReadyOwnerJob,
  failureCode: string,
  failureMessage: string,
): Promise<boolean> {
  const { data } = await supabase.rpc("cover_video_transition_job", {
    p_job_id: job.id,
    p_from_statuses: ["ready"],
    p_to_status: "failed",
    p_provider_status: null,
    p_provider_progress: null,
    p_patch: { failure_code: failureCode, failure_message: failureMessage },
  });
  return data?.status === "failed";
}

// Executes one decision. Destroys nothing itself: an expired or failed job is
// handed back to the reaper's guarded destroy (it carries a guarded failure
// code), which asks for live references before deleting.
export async function executeReadyOwnership(
  supabase: Supabase,
  job: ReadyOwnerJob,
  decision: { action: ReadyOwnerAction; reason: string },
  nowMs: number,
  deps: ReadyOwnerDeps = defaultDeps,
): Promise<ReadyOwnerOutcome> {
  switch (decision.action) {
    case "materialize": {
      const made = await deps.materializeAdCreativeFromJob(supabase, job);
      if (made.ok) {
        const applied = await serverApply(supabase, job, "reaper_materialized");
        log(applied ? "ready_owner_materialized" : "ready_owner_apply_lost", {
          jobId: job.id,
          creativeId: made.creativeId,
        });
        return applied ? "applied" : "lost";
      }
      if (!made.retryable) {
        return made.code === "creative_source_untrusted" ? "failed" : "lost";
      }
      if (readyAgeMs(job, nowMs) >= READY_TTL_MS) {
        const failed = await failReady(
          supabase,
          job,
          "creative_materialize_failed",
          "The ad video could not be added to the library.",
        );
        log("ready_owner_materialize_failed", { jobId: job.id, failed });
        return failed ? "failed" : "lost";
      }
      return "materialize_pending";
    }
    case "apply_observed": {
      const applied = await serverApply(
        supabase,
        job,
        "reaper_reference_observed",
      );
      log("ready_owner_reference_observed", {
        jobId: job.id,
        applied: applied !== null,
        references: decision.reason,
      });
      return applied ? "applied" : "lost";
    }
    case "apply_server": {
      const applied = await serverApply(supabase, job, "reaper_server_apply");
      log("ready_owner_server_apply", {
        jobId: job.id,
        targetKind: job.target_kind,
        applied: applied !== null,
      });
      if (!applied) return "lost";
      await deps.reapPriorCoverAssets(supabase, {
        id: job.id,
        provider: job.provider ?? null,
        target_kind: job.target_kind ?? null,
        event_id: job.event_id ?? null,
        brand_id: job.brand_id ?? null,
      });
      return "applied";
    }
    case "expire": {
      const failed = await failReady(
        supabase,
        job,
        "ready_unclaimed",
        "The finished video was never added. Upload it again.",
      );
      log("ready_owner_expired", { jobId: job.id, failed });
      return failed ? "expired" : "lost";
    }
    case "alert": {
      const stamp = new Date(nowMs).toISOString();
      const { data: marked, error } = await supabase
        .from("event_cover_video_jobs")
        .update({ ready_alerted_at: stamp })
        .eq("id", job.id)
        .is("ready_alerted_at", null)
        .select("id");
      if (error || !Array.isArray(marked) || marked.length === 0) return "lost";
      const { error: healthError } = await supabase
        .from("api_health_checks")
        .insert({
          service_key: "bunny",
          layer: "passive",
          status: "degraded",
          latency_ms: readyAgeMs(job, nowMs),
          mode: null,
          http_status: null,
          detail: {
            signal: "cover_video_ready_unclaimed",
            job_id: job.id,
            target_kind: job.target_kind ?? null,
            completed_at: job.completed_at ?? null,
          },
          checked_at: stamp,
        });
      log("ready_owner_alerted", {
        jobId: job.id,
        healthRowWritten: !healthError,
      });
      return "alerted";
    }
    case "retain":
      return "retained";
    case "wait":
      return "waiting";
  }
}
