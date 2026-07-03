// META-ORCH-1270 (Phase 2) — implementor test: reaper selection logic.
//
// FAILS ON REVERT: change the predicate in selectReapTargets (e.g. drop the
// `reaped_at != null` skip, or the 24h abandoned cutoff, or the source_asset_id
// gate) → the assertions below throw.
//
// Run: deno test --allow-none --no-check
//   supabase/functions/event-cover-video-reaper/__tests__/meta_orch_1270_reaper_selection.test.ts

import { selectReapTargets, type ReapCandidate } from "../index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const NOW = Date.UTC(2026, 6, 3, 12, 0, 0); // 2026-07-03T12:00:00Z
const HOURS = (n: number) => new Date(NOW - n * 60 * 60 * 1000).toISOString();

Deno.test("selectReapTargets: cancelled + failed with a guid are reaped", () => {
  const jobs: ReapCandidate[] = [
    { id: "a", status: "cancelled", source_asset_id: "guid-a", reaped_at: null, provider: "bunny" },
    { id: "b", status: "failed", source_asset_id: "guid-b", reaped_at: null, provider: "bunny" },
  ];
  const t = selectReapTargets(jobs, NOW);
  assert(t.length === 2, `expected 2 targets, got ${t.length}`);
  assert(t.every((x) => x.action === "reap"), "cancelled/failed → action reap");
});

Deno.test("selectReapTargets: already-reaped rows are skipped (no double-delete)", () => {
  const jobs: ReapCandidate[] = [
    { id: "a", status: "cancelled", source_asset_id: "guid-a", reaped_at: HOURS(1), provider: "bunny" },
  ];
  assert(selectReapTargets(jobs, NOW).length === 0, "reaped_at set → skipped");
});

Deno.test("selectReapTargets: rows with no source_asset_id (Cloudinary) are never reaped", () => {
  const jobs: ReapCandidate[] = [
    { id: "cloud", status: "failed", source_asset_id: null, source_public_id: "event-covers/raw/x", reaped_at: null, provider: "cloudinary" },
    { id: "empty", status: "cancelled", source_asset_id: "   ", reaped_at: null, provider: "bunny" },
  ];
  assert(selectReapTargets(jobs, NOW).length === 0, "no/blank source_asset_id → skipped");
});

Deno.test("selectReapTargets: abandoned draft (>24h, unapplied) → reap_abandoned", () => {
  const jobs: ReapCandidate[] = [
    { id: "old", status: "ready", source_asset_id: "guid-old", reaped_at: null, applied_at: null, created_at: HOURS(25), provider: "bunny" },
    { id: "src", status: "source_uploaded", source_asset_id: "guid-src", reaped_at: null, applied_at: null, created_at: HOURS(30), provider: "bunny" },
  ];
  const t = selectReapTargets(jobs, NOW);
  assert(t.length === 2, `expected 2 abandoned targets, got ${t.length}`);
  assert(t.every((x) => x.action === "reap_abandoned"), "old unapplied drafts → reap_abandoned");
});

Deno.test("selectReapTargets: fresh draft (<24h) is NOT reaped", () => {
  const jobs: ReapCandidate[] = [
    { id: "fresh", status: "ready", source_asset_id: "guid-fresh", reaped_at: null, applied_at: null, created_at: HOURS(2), provider: "bunny" },
  ];
  assert(selectReapTargets(jobs, NOW).length === 0, "young draft → not reaped");
});

Deno.test("selectReapTargets: applied cover is NEVER reaped (it is live)", () => {
  const jobs: ReapCandidate[] = [
    { id: "live", status: "ready", source_asset_id: "guid-live", reaped_at: null, applied_at: HOURS(48), created_at: HOURS(50), provider: "bunny" },
    { id: "applied", status: "applied", source_asset_id: "guid-app", reaped_at: null, applied_at: HOURS(48), created_at: HOURS(50), provider: "bunny" },
  ];
  assert(selectReapTargets(jobs, NOW).length === 0, "applied/live cover → not reaped");
});

Deno.test("selectReapTargets: active in-progress jobs are NOT reaped", () => {
  const jobs: ReapCandidate[] = [
    { id: "up", status: "source_uploading", source_asset_id: "guid-up", reaped_at: null, applied_at: null, created_at: HOURS(0.1), provider: "bunny" },
    { id: "proc", status: "processing", source_asset_id: "guid-proc", reaped_at: null, applied_at: null, created_at: HOURS(0.1), provider: "bunny" },
  ];
  assert(selectReapTargets(jobs, NOW).length === 0, "uploading/processing → not reaped");
});
