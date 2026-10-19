// Issue #3040 (T-B11, B-11, B-9) — a database object that is not deployed yet
// skips its step, destroys nothing, and is reported on the health rail.
// MINGLA-INVARIANT: I-VIDEO-NO-DESTROY-WHILE-REFERENCED | issue #3040 | an unknown reference answer never destroys
//
// FAILS ON REVERT: treat a failed reference read as "no references" and the
// expired job's asset below is destroyed without proof.
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

Deno.test("#3040 a missing cover_video_guid_live_references never destroys and the tick continues", async () => {
  const reaper = makeReaper([
    {
      id: "trip-old", status: "ready", provider: "bunny", target_kind: "trip_day_media", event_id: "event-1",
      brand_id: "brand-1", source_asset_id: "guid-trip-old", processed_url: "https://cdn.test/a.mp4",
      completed_at: isoAgo(25 * 60 * 60_000), created_at: isoAgo(26 * 60 * 60_000), reaped_at: null, application_version: 0,
    },
    {
      id: "cancelled", status: "cancelled", provider: "bunny", target_kind: "event", source_asset_id: "guid-cancelled",
      reaped_at: null, completed_at: isoAgo(60_000), created_at: isoAgo(120_000),
    },
  ], {
    events: [{ id: "event-1", deleted_at: null }],
    missingRpcs: ["cover_video_guid_live_references"],
  });
  const body = await quietly(reaper.tick);
  assert(body.ok === true, `the tick failed: ${JSON.stringify(body)}`);
  assert(!reaper.destroyed.includes("guid-trip-old"), "a destroy was forced without a reference answer");
  assert(reaper.job("trip-old").status === "ready", "the job was expired without a reference answer");
  // [TEST-MOD-APPROVED #3040] P1-1 ruling: a cancelled job's reap is guarded
  // too, so with no reference answer it is KEPT (and the tick still runs on).
  assert(!reaper.destroyed.includes("guid-cancelled"), "a cancelled asset was destroyed without a reference answer");
  assert(reaper.job("cancelled").reaped_at == null && Number(body.guardedSkipped) >= 1, `cancelled row: ${JSON.stringify(reaper.job("cancelled"))}`);
  assert((body.stepFailures as string[]).includes("migration_not_applied"), JSON.stringify(body.stepFailures));
  const rail = reaper.db.tables.api_health_checks.filter((row) => row.detail?.signal === "cover_video_reaper_step_failed");
  assert(rail.some((row) => row.detail.stage === "migration_not_applied" && row.status === "degraded"), JSON.stringify(rail));
});
