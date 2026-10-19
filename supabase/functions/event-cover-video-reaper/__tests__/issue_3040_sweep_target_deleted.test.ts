// Issue #3040 rework 1 (D-8, B-4) — an upload still in transfer whose event or
// brand was soft-deleted ends at once as failed(target_deleted), not at its
// TUS lease expiry an hour later under the wrong code. Its asset is then
// reclaimed through the guarded destroy like every other terminal asset.
// Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): a deleted parent ends every live job of that parent, including uploads still in transfer
//
// FAILS ON REVERT: drop the parentDeleted check from the source_uploading sweep
// (or stop reading the sweep rows' parents) and the job stays source_uploading.
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly, withTusHead } from "./issue3040_reaperHarness.ts";

const MIN = 60_000;
const inTransfer = (overrides: Record<string, unknown>) => ({
  id: "up", status: "source_uploading", provider: "bunny", target_kind: "event", event_id: "e1", brand_id: "b1",
  source_asset_id: "guid-in-transfer-01", source_bytes: 6_000_000, tus_resource_url: "https://video.bunnycdn.com/tusupload/r",
  tus_expires_at: new Date(Date.now() + 40 * MIN).toISOString(), created_at: isoAgo(5 * MIN), reaped_at: null, ...overrides,
});

for (const [label, events, brands, row] of [
  ["event", [{ id: "e1", deleted_at: isoAgo(MIN), cover_media_url: null }], [{ id: "b1", deleted_at: null, cover_media_url: null }], {}],
  ["brand", [], [{ id: "b1", deleted_at: isoAgo(MIN), cover_media_url: null }], { target_kind: "brand", event_id: null }],
] as const) {
  Deno.test(`#3040 D-8 an upload in transfer for a deleted ${label} ends as target_deleted at once`, async () => {
    const reaper = makeReaper([inTransfer(row)], { events: [...events], brands: [...brands], references: { "guid-in-transfer-01": [] } });
    await withTusHead(() => new Response(null, { status: 200, headers: { "upload-offset": "512", "upload-length": "6000000" } }), () => quietly(reaper.tick).then(() => undefined));
    const after = reaper.job("up");
    assert(after.status === "failed" && after.failure_code === "target_deleted", `${after.status}/${after.failure_code}`);
    assert(reaper.destroyed.includes("guid-in-transfer-01"), "the dead upload's asset was not reclaimed");
  });
}

Deno.test("#3040 D-8 an upload in transfer for a live event is left alone", async () => {
  const reaper = makeReaper([inTransfer({})], { events: [{ id: "e1", deleted_at: null, cover_media_url: null }], brands: [{ id: "b1", deleted_at: null, cover_media_url: null }] });
  await withTusHead(() => new Response(null, { status: 200, headers: { "upload-offset": "512", "upload-length": "6000000" } }), () => quietly(reaper.tick).then(() => undefined));
  assert(reaper.job("up").status === "source_uploading", `a live upload was ended: ${reaper.job("up").status}`);
});
