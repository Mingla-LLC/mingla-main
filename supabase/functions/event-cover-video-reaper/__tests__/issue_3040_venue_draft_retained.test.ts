// Issue #3040 (P1-2 rework, tester D-2/D-6) — a venue-draft video is
// client-owned and kept. It lives in the host's persisted local draft until
// the venue is published, which no database reference can see. So, exactly as
// on main before #3040:
//   - a READY venue-draft job is never expired at 24 h and never alerted;
//   - its asset is never destroyed by a terminal reap (superseded, cancelled,
//     failed after it was handed to the device), nor by orphan reclaim;
//   - it is looked at again only after a long back-off, so retained rows never
//     crowd live work out of the claim;
//   - a venue-draft upload that never reached ready (the device never got a
//     URL) is reclaimed normally.
//
// MINGLA-INVARIANT: I-VENUE-DRAFT-VIDEO-RETAINED | issue #3040 | a venue_draft target video that reached ready is never destroyed by expiry, terminal reap, cancel or supersede
//
// FAILS ON REVERT: drop the venue_draft `retain` branch in decideReadyOwnership
// (the ready job expires and its asset is destroyed), drop isClientRetainedAsset
// from destroyIfUnreferenced (the superseded draft video is destroyed), or drop
// it from selectOrphanCandidates (orphan reclaim takes it).
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

const H = 60 * 60_000;
const DRAFT = "guid-venue-draft-0001";

const readyDraft = (overrides: Record<string, unknown> = {}) => ({
  id: "vd", status: "ready", provider: "bunny", target_kind: "venue_draft", brand_id: "b1",
  draft_owner_key: "draft-123", requested_by: "u1", source_asset_id: DRAFT,
  processed_url: `https://cdn.test/${DRAFT}/play_1080p.mp4`, completed_at: isoAgo(25 * H),
  created_at: isoAgo(25 * H), application_version: 0, reaped_at: null, ...overrides,
});

Deno.test("#3040 a 25 h old ready venue-draft video is kept: not expired, not destroyed, not alerted", async () => {
  const reaper = makeReaper([readyDraft()], {
    brands: [{ id: "b1", deleted_at: null, cover_media_url: null }],
    references: { [DRAFT]: [] },
  });
  const body = await quietly(reaper.tick);
  assert(!reaper.destroyed.includes(DRAFT), "the persisted venue draft's cover video was destroyed");
  assert(reaper.job("vd").status === "ready", `the draft video was moved to ${reaper.job("vd").status}`);
  const alerts = reaper.db.tables.api_health_checks.filter((row) => row.detail?.signal === "cover_video_ready_unclaimed");
  assert(alerts.length === 0, `a retained venue draft raised the ready-unclaimed alert: ${JSON.stringify(alerts)}`);
  assert(body.readyOwner?.retained === 1, JSON.stringify(body.readyOwner));
  const until = Date.parse(String(reaper.job("vd").reconcile_lease_until));
  assert(until - Date.now() > 24 * H, `retained row not backed off: ${reaper.job("vd").reconcile_lease_until}`);
});

Deno.test("#3040 a venue-draft video that the device received keeps its asset when the job is superseded or cancelled", async () => {
  for (const status of ["superseded", "cancelled", "failed"]) {
    const reaper = makeReaper([readyDraft({ status, failure_code: status === "failed" ? "target_deleted" : null, completed_at: isoAgo(H) })], {
      brands: [{ id: "b1", deleted_at: null, cover_media_url: null }],
      references: { [DRAFT]: [] },
    });
    await quietly(reaper.tick);
    assert(!reaper.destroyed.includes(DRAFT), `a ${status} venue-draft video still in a host draft was destroyed`);
    assert(reaper.job("vd").reaped_at == null, `${status}: stamped reaped`);
  }
});

Deno.test("#3040 a venue-draft upload that never reached ready is reclaimed normally", async () => {
  const reaper = makeReaper([readyDraft({ status: "cancelled", processed_url: null, completed_at: isoAgo(H) })], {
    brands: [{ id: "b1", deleted_at: null, cover_media_url: null }],
    references: { [DRAFT]: [] },
  });
  await quietly(reaper.tick);
  assert(reaper.destroyed.includes(DRAFT), "a venue-draft upload the device never received was leaked");
});

Deno.test("#3040 orphan reclaim, even when enabled, never takes a venue-draft video", async () => {
  const reaper = makeReaper([readyDraft({ status: "applied", completed_at: isoAgo(9 * 24 * H) })], {
    adminConfig: [{ key: "cover_video_orphan_reclaim_enabled", value: true }],
    brands: [{ id: "b1", deleted_at: null, cover_media_url: null }],
    references: { [DRAFT]: [] },
  });
  await quietly(reaper.tick);
  assert(!reaper.destroyed.includes(DRAFT), "orphan reclaim destroyed a venue-draft video");
});
