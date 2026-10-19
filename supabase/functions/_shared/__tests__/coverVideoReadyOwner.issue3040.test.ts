// Issue #3040 (T-B3, B-3, B-9, C-8) — every `ready` job has a server owner.
// MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040 | every non-terminal and ready job has a server owner with a finite bound
//
// FAILS ON REVERT: make decideReadyOwnership return "wait" (the pre-#3040
// reaper skipped ready jobs) and every non-wait row below fails.
import {
  decideReadyOwnership,
  executeReadyOwnership,
  READY_GRACE_MS,
  READY_TTL_MS,
  type ReadyOwnerJob,
} from "../coverVideoReadyOwner.ts";
import {
  applyOnceHandler,
  assert,
  isoAgo,
  makeFakeDb,
  transitionJobHandler,
} from "./issue3040_fakeSupabase.ts";

const MIN = 60_000;
const job = (overrides: Partial<ReadyOwnerJob>): ReadyOwnerJob => ({
  id: "job-3040",
  status: "ready",
  target_kind: "brand",
  brand_id: "brand-1",
  source_asset_id: "guid-ready-3040",
  processed_url: "https://cdn.test/guid-ready-3040/play_1080p.mp4",
  processed_poster_url: "https://cdn.test/guid-ready-3040/thumbnail.jpg",
  target_cover_base_url: "https://cdn.test/old/cover.jpg",
  target_cover_base_captured: true,
  completed_at: isoAgo(16 * MIN),
  ready_alerted_at: null,
  application_version: 0,
  provider: "bunny",
  ...overrides,
});

Deno.test("#3040 decideReadyOwnership: the full owner table", () => {
  const now = Date.now();
  const cases: Array<[string, Parameters<typeof decideReadyOwnership>[0], string]> = [
    ["brand 16 min, cover unchanged", { job: job({}), references: [], targetCoverNow: "https://cdn.test/old/cover.jpg", nowMs: now }, "apply_server"],
    ["event 16 min, cover unchanged (no cover)", { job: job({ target_kind: "event", target_cover_base_url: null }), references: [], targetCoverNow: null, nowMs: now }, "apply_server"],
    ["brand 16 min, host changed the cover", { job: job({}), references: [], targetCoverNow: "https://cdn.test/new/photo.jpg", nowMs: now }, "alert"],
    ["brand 10 min", { job: job({ completed_at: isoAgo(10 * MIN) }), references: [], targetCoverNow: "https://cdn.test/old/cover.jpg", nowMs: now }, "wait"],
    ["brand cover unreadable", { job: job({}), references: [], targetCoverNow: undefined, nowMs: now }, "alert"],
    // Conductor rule (prod check 2026-10-19): no recorded baseline, or past the TTL, never auto-applies.
    ["legacy brand job, no recorded baseline, brand has no cover", { job: job({ target_cover_base_captured: false, target_cover_base_url: null, completed_at: isoAgo(31 * 24 * 60 * MIN) }), references: [], targetCoverNow: null, nowMs: now }, "expire"],
    ["legacy brand job, no recorded baseline, 16 min", { job: job({ target_cover_base_captured: false, target_cover_base_url: null }), references: [], targetCoverNow: null, nowMs: now }, "expire"],
    ["legacy brand job, host set an image cover since", { job: job({ target_cover_base_captured: undefined, target_cover_base_url: null, completed_at: isoAgo(7 * 24 * 60 * MIN) }), references: [], targetCoverNow: "https://cdn.test/new/image.jpg", nowMs: now }, "expire"],
    ["stale brand job (25 h), recorded no-cover baseline, brand still has no cover", { job: job({ target_cover_base_url: null, completed_at: isoAgo(25 * 60 * MIN) }), references: [], targetCoverNow: null, nowMs: now }, "expire"],
    ["legacy job, references unknown", { job: job({ target_cover_base_captured: false }), references: null, targetCoverNow: null, nowMs: now }, "alert"],
    ["trip day 25 h unreferenced", { job: job({ target_kind: "trip_day_media", completed_at: isoAgo(25 * 60 * MIN) }), references: [], targetCoverNow: undefined, nowMs: now }, "expire"],
    ["trip day referenced by its gallery", { job: job({ target_kind: "trip_day_media", completed_at: isoAgo(2 * MIN) }), references: ["trip_day_media"], targetCoverNow: undefined, nowMs: now }, "apply_observed"],
    ["event whose cover already IS this video", { job: job({ target_kind: "event" }), references: ["event_cover"], targetCoverNow: "https://cdn.test/guid-ready-3040/play_1080p.mp4", nowMs: now }, "apply_observed"],
    ["venue draft 25 h, references unknown", { job: job({ target_kind: "venue_draft", completed_at: isoAgo(25 * 60 * MIN) }), references: null, targetCoverNow: undefined, nowMs: now }, "alert"],
    ["venue draft 25 h, already alerted, references unknown", { job: job({ target_kind: "venue_draft", completed_at: isoAgo(25 * 60 * MIN), ready_alerted_at: isoAgo(MIN) }), references: null, targetCoverNow: undefined, nowMs: now }, "wait"],
    ["ad video, any age", { job: job({ target_kind: "ad_creative", completed_at: isoAgo(5_000) }), references: [], targetCoverNow: undefined, nowMs: now }, "materialize"],
  ];
  for (const [name, input, expected] of cases) {
    const decision = decideReadyOwnership(input);
    assert(decision.action === expected, `${name}: expected ${expected}, got ${decision.action}`);
  }
  assert(READY_GRACE_MS === 15 * MIN && READY_TTL_MS === 24 * 60 * MIN, "bounds changed");
});

const harness = (row: Record<string, unknown>) =>
  makeFakeDb(
    { event_cover_video_jobs: [row], api_health_checks: [], ad_creatives: [] },
    { cover_video_transition_job: transitionJobHandler, cover_video_apply_once: applyOnceHandler },
  );

Deno.test("#3040 apply_server applies the cover, stamps the receipt and reaps the prior cover", async () => {
  const row = job({});
  const db = harness(row);
  const reaped: unknown[] = [];
  const outcome = await executeReadyOwnership(db.client, row, { action: "apply_server", reason: "t" }, Date.now(), {
    materializeAdCreativeFromJob: () => Promise.reject(new Error("not an ad")),
    reapPriorCoverAssets: (_s, j) => {
      reaped.push(j);
      return Promise.resolve({ considered: 0, destroyed: 0, skippedReferenced: 0, skippedUnknown: 0, failed: 0 });
    },
  });
  const stored = db.tables.event_cover_video_jobs[0];
  assert(outcome === "applied" && stored.status === "applied", `outcome ${outcome}, status ${stored.status}`);
  assert(stored.application_receipt?.source === "reaper_server_apply", "receipt does not name the server owner");
  assert(reaped.length === 1, "the replaced cover was not handed to the scoped reap");
});

Deno.test("#3040 alert happens once and lands on the Bunny health rail", async () => {
  const row = job({ target_kind: "venue_draft" });
  const db = harness(row);
  const first = await executeReadyOwnership(db.client, row, { action: "alert", reason: "t" }, Date.now());
  const second = await executeReadyOwnership(db.client, row, { action: "alert", reason: "t" }, Date.now());
  assert(first === "alerted" && second === "lost", `got ${first}/${second}`);
  const rows = db.tables.api_health_checks;
  assert(rows.length === 1 && rows[0].detail.signal === "cover_video_ready_unclaimed" && rows[0].status === "degraded", JSON.stringify(rows));
});

Deno.test("#3040 expire fails a ready job with ready_unclaimed and destroys nothing itself", async () => {
  const row = job({ target_kind: "trip_day_media", completed_at: isoAgo(25 * 60 * MIN) });
  const db = harness(row);
  const outcome = await executeReadyOwnership(db.client, row, { action: "expire", reason: "t" }, Date.now());
  const stored = db.tables.event_cover_video_jobs[0];
  assert(outcome === "expired" && stored.status === "failed" && stored.failure_code === "ready_unclaimed", JSON.stringify(stored));
});

Deno.test("#3040 an ad video that cannot be materialized ends at the TTL, not before", async () => {
  const pending = () => Promise.resolve({ ok: false as const, retryable: true as const, code: "creative_materialize_pending" as const, reason: "x" });
  const deps = {
    materializeAdCreativeFromJob: pending,
    reapPriorCoverAssets: () => Promise.reject(new Error("never")),
  };
  const young = job({ target_kind: "ad_creative", brand_id: null, completed_at: isoAgo(MIN) });
  const youngDb = harness(young);
  assert(await executeReadyOwnership(youngDb.client, young, { action: "materialize", reason: "t" }, Date.now(), deps as never) === "materialize_pending", "young ad failed early");
  assert(youngDb.tables.event_cover_video_jobs[0].status === "ready", "young ad left ready");
  const old = job({ target_kind: "ad_creative", brand_id: null, completed_at: isoAgo(25 * 60 * MIN) });
  const oldDb = harness(old);
  assert(await executeReadyOwnership(oldDb.client, old, { action: "materialize", reason: "t" }, Date.now(), deps as never) === "failed", "old ad not failed");
  assert(oldDb.tables.event_cover_video_jobs[0].failure_code === "creative_materialize_failed", "wrong failure code");
});

Deno.test("#3040 a materialized ad video is applied by the server owner", async () => {
  const row = job({ target_kind: "ad_creative", brand_id: null, requested_by: "admin-1" });
  const db = harness(row);
  const outcome = await executeReadyOwnership(db.client, row, { action: "materialize", reason: "t" }, Date.now(), {
    materializeAdCreativeFromJob: (s) => {
      s.from("ad_creatives").insert({ source_job_id: row.id }).then(() => undefined);
      return Promise.resolve({ ok: true as const, creativeId: "creative-1", created: true });
    },
    reapPriorCoverAssets: () => Promise.reject(new Error("ads never reap priors")),
  });
  assert(outcome === "applied", `got ${outcome}`);
  assert(db.tables.event_cover_video_jobs[0].status === "applied", "ad job not applied after its row existed");
});
