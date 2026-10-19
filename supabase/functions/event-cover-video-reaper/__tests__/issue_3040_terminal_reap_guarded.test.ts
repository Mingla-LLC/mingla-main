// Issue #3040 (P1-1 rework, tester D-1) — every TERMINAL reap is guarded.
// A superseded, cancelled or failed job whose asset is still served anywhere
// keeps its asset; the reap is deferred (not retried every tick) and the row
// stays un-reaped so a later tick can still reclaim it once nothing serves it.
//
// The product story (tester repro): the host saves a venue cover while its
// job is `ready` (venue jobs are never applied by the client), starts a
// replacement — which supersedes the ready job — and then cancels the
// replacement. The live venue cover must survive.
//
// Invariant I-VIDEO-NO-DESTROY-WHILE-REFERENCED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_orphan_reclaim.test.ts): no code path destroys a provider asset whose guid has a live reference
//
// FAILS ON REVERT: restore the reaper's unguarded `deps.destroyCoverVideoAsset(target)`
// for non-"guarded" failure codes (or any status), and the live cover is destroyed.
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

const MIN = 60_000;
const LIVE = "guid-venue-live-0001";
const NEW = "guid-venue-new-00002";

Deno.test("#3040 replace a venue cover, cancel the replacement: the live cover survives, the cancelled upload is reclaimed", async () => {
  const reaper = makeReaper([
    { id: "venue-old", status: "superseded", provider: "bunny", target_kind: "venue", brand_id: "b1",
      source_asset_id: LIVE, processed_url: `https://cdn.test/${LIVE}/play_1080p.mp4`,
      completed_at: isoAgo(5 * MIN), created_at: isoAgo(60 * MIN), reaped_at: null },
    { id: "venue-new", status: "cancelled", provider: "bunny", target_kind: "venue", brand_id: "b1",
      source_asset_id: NEW, completed_at: isoAgo(MIN), created_at: isoAgo(4 * MIN), reaped_at: null },
  ], {
    brands: [{ id: "b1", deleted_at: null, cover_media_url: null }],
    references: { [LIVE]: ["venue_cover"], [NEW]: [] },
  });
  await quietly(reaper.tick);
  assert(!reaper.destroyed.includes(LIVE), `the live venue cover was destroyed: ${reaper.destroyed.join(",")}`);
  assert(reaper.job("venue-old").reaped_at == null, "a kept asset was stamped reaped");
  assert(reaper.destroyed.includes(NEW) && typeof reaper.job("venue-new").reaped_at === "string", "the cancelled upload was not reclaimed");
});

for (const [status, code] of [["superseded", null], ["cancelled", null], ["failed", "processing_stalled"], ["failed", "source_transport_expired"], ["failed", "source_identity_mismatch"]] as const) {
  Deno.test(`#3040 a ${status}${code ? `(${code})` : ""} job whose guid is still an event cover is never destroyed`, async () => {
    const reaper = makeReaper([{
      id: "j", status, failure_code: code, provider: "bunny", target_kind: "event", event_id: "e1", brand_id: "b1",
      source_asset_id: "guid-live-cover-0001", completed_at: isoAgo(MIN), created_at: isoAgo(2 * MIN), reaped_at: null,
    }], {
      events: [{ id: "e1", deleted_at: null, cover_media_url: "https://cdn.test/guid-live-cover-0001/play_720p.mp4" }],
      references: { "guid-live-cover-0001": ["event_cover"] },
    });
    await quietly(reaper.tick);
    assert(reaper.destroyed.length === 0, `destroyed a live cover: ${reaper.destroyed.join(",")}`);
  });
}

Deno.test("#3040 a still-referenced terminal row is deferred, so it never fills the claim or the reap window", async () => {
  const reaper = makeReaper([{
    id: "kept", status: "superseded", provider: "bunny", target_kind: "event", event_id: "e1", brand_id: "b1",
    source_asset_id: "guid-kept-cover-001", completed_at: isoAgo(MIN), created_at: isoAgo(2 * MIN), reaped_at: null,
  }], {
    events: [{ id: "e1", deleted_at: null, cover_media_url: "https://cdn.test/guid-kept-cover-001/play_720p.mp4" }],
    references: { "guid-kept-cover-001": ["event_cover"] },
  });
  await quietly(reaper.tick);
  const leaseUntil = Date.parse(String(reaper.job("kept").reconcile_lease_until));
  assert(leaseUntil - Date.now() > 5 * 60 * MIN, `no back-off recorded: ${reaper.job("kept").reconcile_lease_until}`);
  const before = reaper.db.rpcs.filter((call) => call.name === "cover_video_guid_live_references").length;
  await quietly(reaper.tick);
  const after = reaper.db.rpcs.filter((call) => call.name === "cover_video_guid_live_references").length;
  assert(after === before, `a deferred row was asked about again on the next tick (${after - before} checks)`);
});
