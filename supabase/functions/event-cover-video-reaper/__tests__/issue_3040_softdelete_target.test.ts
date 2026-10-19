// Issue #3040 (E-8f, B-4) — a job whose event or brand was soft-deleted ends,
// named, and its asset is reclaimed only through the reference guard.
// MINGLA-INVARIANT: I-VIDEO-SOFTDELETE-NO-WEDGE | issue #3040 | a parent soft-delete never blocks a job, it ends it
//
// FAILS ON REVERT: remove the target_deleted step and the encoding job on the
// deleted event stays `processing` until its stall bound.
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

Deno.test("#3040 a live job on a soft-deleted event fails target_deleted and is reclaimed", async () => {
  const reaper = makeReaper([
    {
      id: "orphaned", status: "processing", provider: "bunny", target_kind: "event", event_id: "event-gone",
      brand_id: "brand-1", source_asset_id: "guid-orphaned", source_uploaded_at: isoAgo(60_000),
      created_at: isoAgo(120_000), reaped_at: null,
    },
    {
      id: "ready-brand", status: "ready", provider: "bunny", target_kind: "brand", brand_id: "brand-gone",
      source_asset_id: "guid-ready-brand", processed_url: "https://cdn.test/r.mp4", completed_at: isoAgo(60_000),
      created_at: isoAgo(120_000), reaped_at: null, application_version: 0,
    },
  ], {
    events: [{ id: "event-gone", deleted_at: isoAgo(30_000), cover_media_url: null }],
    brands: [
      { id: "brand-1", deleted_at: null, cover_media_url: null },
      { id: "brand-gone", deleted_at: isoAgo(30_000), cover_media_url: null },
    ],
    references: { "guid-ready-brand": [] },
  });
  const body = await quietly(reaper.tick);
  assert(reaper.job("orphaned").status === "failed" && reaper.job("orphaned").failure_code === "target_deleted", JSON.stringify(reaper.job("orphaned")));
  assert(reaper.job("ready-brand").failure_code === "target_deleted", "a ready job on a deleted brand stayed ready");
  assert(reaper.destroyed.includes("guid-orphaned") && reaper.destroyed.includes("guid-ready-brand"), reaper.destroyed.join(","));
  assert(body.targetDeleted === 2, JSON.stringify(body));
});
