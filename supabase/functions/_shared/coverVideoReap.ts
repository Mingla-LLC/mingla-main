// Issue #3040 — the ONE place a provider asset that may still be in use is
// reclaimed. Every such destroy asks the database first which live surfaces
// still serve the asset (cover_video_guid_live_references) and destroys only
// when the answer is an empty list. An unknown answer (RPC error, migration not
// yet applied) never destroys: a leaked asset is recoverable, a deleted live
// video is not.
//
// MINGLA-INVARIANT: I-VIDEO-NO-DESTROY-WHILE-REFERENCED | issue #3040 | no code path destroys a provider asset whose guid has a live reference; prior reaps are scoped to the same target_kind and target
// MINGLA-INVARIANT: I-VIDEO-SINGLE-GUARDED-DELETE | issue #3040 | destroyIfUnreferenced is the only caller of the provider delete; every reaper, cancel, apply, supersede, fail and purge path goes through it (enforced by coverVideoReap.singleDeletePath.issue3040.test.ts)
// MINGLA-INVARIANT: I-VENUE-DRAFT-VIDEO-RETAINED | issue #3040 | a venue-draft video that reached ready lives in the host's local draft, which no database reference can see; it is never destroyed by expiry, terminal reap, cancel or supersede (only an explicitly enabled, draft-aware orphan reclaim may ever touch it)
import { destroyCoverVideoAsset } from "./eventCoverVideo.ts";

// deno-lint-ignore no-explicit-any
type Supabase = any;

export type ReapableRow = {
  id: string;
  provider?: string | null;
  source_asset_id?: unknown;
  source_public_id?: unknown;
  target_kind?: string | null;
  processed_url?: string | null;
};

// #3040 (P1-2) — a venue-draft video that reached `ready` has been handed to
// the host's device, which keeps it in a local draft until the venue is
// published. No database row references it, so the live-reference answer
// would be "unreferenced". It is client-owned and kept, exactly as before
// #3040. The database guard (cover_video_guid_live_references, arm
// `venue_draft`) enforces the same rule for callers that do not carry the
// job's kind.
export const isClientRetainedAsset = (row: ReapableRow): boolean =>
  row.target_kind === "venue_draft" &&
  typeof row.processed_url === "string" && row.processed_url.length > 0;

export type GuidReferences =
  | { ok: true; kinds: string[] }
  | {
    ok: false;
    reason: "migration_not_applied" | "reference_check_failed" | "guid_invalid";
  };

export type ReapDeps = {
  destroyCoverVideoAsset: typeof destroyCoverVideoAsset;
};

const defaultReapDeps: ReapDeps = { destroyCoverVideoAsset };

const log = (stage: string, fields: Record<string, unknown>): void => {
  console.warn("[cover-video-reap]", JSON.stringify({ stage, ...fields }));
};

export const isMissingRpc = (
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean =>
  !!error && (error.code === "PGRST202" || error.code === "42883");

export async function readGuidLiveReferences(
  supabase: Supabase,
  guid: string,
  excludeJobId: string | null,
): Promise<GuidReferences> {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(guid)) {
    return { ok: false, reason: "guid_invalid" };
  }
  try {
    const { data, error } = await supabase.rpc(
      "cover_video_guid_live_references",
      { p_guid: guid, p_exclude_job_id: excludeJobId },
    );
    if (error) {
      const reason = isMissingRpc(error)
        ? "migration_not_applied"
        : "reference_check_failed";
      log(reason, { guid, code: error.code ?? null });
      return { ok: false, reason };
    }
    if (!Array.isArray(data)) {
      log("reference_check_failed", { guid, reason: "malformed" });
      return { ok: false, reason: "reference_check_failed" };
    }
    return { ok: true, kinds: data.map(String) };
  } catch (error) {
    log("reference_check_failed", {
      guid,
      error: error instanceof Error ? error.name : "error",
    });
    return { ok: false, reason: "reference_check_failed" };
  }
}

export type GuardedDestroyOutcome =
  | { outcome: "destroyed" }
  | { outcome: "referenced"; kinds: string[] }
  | { outcome: "unknown"; reason: string }
  | { outcome: "destroy_failed"; reason: string }
  | { outcome: "retained" }
  | { outcome: "no_asset" };

// Destroy `row`'s provider asset only when nothing live still serves it, then
// stamp reaped_at so no path tries again.
export async function destroyIfUnreferenced(
  supabase: Supabase,
  row: ReapableRow,
  deps: ReapDeps = defaultReapDeps,
): Promise<GuardedDestroyOutcome> {
  const guid = typeof row.source_asset_id === "string"
    ? row.source_asset_id.trim()
    : "";
  if (guid.length === 0) return { outcome: "no_asset" };
  if (isClientRetainedAsset(row)) {
    log("reap_skipped_client_retained", { jobId: row.id });
    return { outcome: "retained" };
  }
  // An asset that is on no job row (a freshly created, never-recorded upload)
  // passes an empty id: nothing is excluded and nothing is stamped.
  const ownJobId = typeof row.id === "string" && row.id.length > 0
    ? row.id
    : null;
  const references = await readGuidLiveReferences(supabase, guid, ownJobId);
  if (!references.ok) return { outcome: "unknown", reason: references.reason };
  if (references.kinds.length > 0) {
    log("reap_skipped_referenced", { jobId: row.id, kinds: references.kinds });
    return { outcome: "referenced", kinds: references.kinds };
  }
  const destroyed = await deps.destroyCoverVideoAsset(row);
  if (!destroyed.ok) {
    log("reap_destroy_failed", { jobId: row.id, reason: destroyed.reason });
    return { outcome: "destroy_failed", reason: destroyed.reason };
  }
  if (ownJobId !== null) {
    // The asset is gone either way. A failed stamp only means a later tick
    // asks again, and a Bunny delete of an absent guid is idempotent (404 ok),
    // so the stamp must never turn a done destroy into a caller failure.
    try {
      const { error } = await supabase
        .from("event_cover_video_jobs")
        .update({ reaped_at: new Date().toISOString() })
        .eq("id", ownJobId);
      if (error) log("reap_stamp_failed", { jobId: ownJobId, code: error.code ?? null });
    } catch (error) {
      log("reap_stamp_failed", {
        jobId: ownJobId,
        error: error instanceof Error ? error.name : "error",
      });
    }
  }
  return { outcome: "destroyed" };
}

export type PriorReapJob = {
  id: string;
  provider?: string | null;
  target_kind?: string | null;
  event_id?: string | null;
  brand_id?: string | null;
};

export type PriorReapSummary = {
  considered: number;
  destroyed: number;
  skippedReferenced: number;
  skippedUnknown: number;
  failed: number;
};

// After `job` has been applied to its cover, reclaim the cover it replaced.
// Scope is the SAME target kind and the SAME target: an event cover never
// reaps a trip-day gallery video that shares its events-row (B-5). Only event
// and brand covers have a "prior" — trip-day media, venues, venue drafts and ad
// videos are independent assets and never reap one another.
export async function reapPriorCoverAssets(
  supabase: Supabase,
  job: PriorReapJob,
  deps: ReapDeps = defaultReapDeps,
): Promise<PriorReapSummary> {
  const summary: PriorReapSummary = {
    considered: 0,
    destroyed: 0,
    skippedReferenced: 0,
    skippedUnknown: 0,
    failed: 0,
  };
  if (job.provider !== "bunny") return summary;
  let query = supabase
    .from("event_cover_video_jobs")
    .select("id,provider,source_asset_id,source_public_id")
    .eq("status", "applied")
    .eq("provider", "bunny")
    .neq("id", job.id)
    .not("source_asset_id", "is", null)
    .is("reaped_at", null);
  if (job.target_kind === "event" && typeof job.event_id === "string") {
    query = query.eq("target_kind", "event").eq("event_id", job.event_id);
  } else if (job.target_kind === "brand" && typeof job.brand_id === "string") {
    query = query.eq("target_kind", "brand").eq("brand_id", job.brand_id);
  } else {
    return summary;
  }
  const { data, error } = await query;
  if (error) {
    log("prior_reap_read_failed", { jobId: job.id, code: error.code ?? null });
    return summary;
  }
  for (const row of (data ?? []) as ReapableRow[]) {
    summary.considered += 1;
    const outcome = await destroyIfUnreferenced(supabase, row, deps);
    if (outcome.outcome === "destroyed") summary.destroyed += 1;
    else if (outcome.outcome === "referenced") {
      summary.skippedReferenced += 1;
      log("prior_reap_skipped_referenced", {
        jobId: job.id,
        priorJobId: row.id,
        kinds: outcome.kinds,
      });
    } else if (outcome.outcome === "unknown") summary.skippedUnknown += 1;
    else if (outcome.outcome === "destroy_failed") summary.failed += 1;
  }
  return summary;
}
