// Issue #3040 (T-B-SM) — every non-terminal state, and `ready`, has a server
// exit once its bound has passed. `created` and `processing_queued` have no
// writer (B-15) and are excluded; terminal states have nothing to leave.
// Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): every non-terminal and ready job has a server owner with a finite bound
//
// FAILS ON REVERT: remove any single owner (allocation abandon, transfer
// expiry, encode stall, ready TTL) and its row below is still in its start
// state after a tick.
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly, withTusHead } from "./issue3040_reaperHarness.ts";

const MIN = 60_000;
const base = { provider: "bunny", target_kind: "event", event_id: "event-1", brand_id: "brand-1", reaped_at: null };

Deno.test("#3040 every live state leaves its state once its bound has passed", async () => {
  const rows = [
    { ...base, id: "s-alloc", status: "source_uploading", source_asset_id: null, provider_allocation_uncertain_at: null, created_at: isoAgo(11 * MIN) },
    { ...base, id: "s-transfer", status: "source_uploading", source_asset_id: "guid-transfer", source_bytes: 6_000_000,
      tus_resource_url: "https://video.bunnycdn.com/tusupload/r", tus_expires_at: isoAgo(5 * MIN), created_at: isoAgo(70 * MIN) },
    { ...base, id: "s-uploaded", status: "source_uploaded", source_asset_id: "guid-uploaded", source_uploaded_at: isoAgo(11 * MIN), created_at: isoAgo(12 * MIN) },
    { ...base, id: "s-processing", status: "processing", source_asset_id: "guid-processing", source_uploaded_at: isoAgo(11 * MIN), created_at: isoAgo(12 * MIN) },
    { ...base, id: "s-ready", status: "ready", target_kind: "trip_day_media", source_asset_id: "guid-ready",
      processed_url: "https://cdn.test/r.mp4", completed_at: isoAgo(25 * 60 * MIN), created_at: isoAgo(26 * 60 * MIN), application_version: 0 },
  ];
  const before = new Map(rows.map((row) => [row.id, row.status]));
  const reaper = makeReaper(rows.map((row) => ({ ...row })), {
    events: [{ id: "event-1", deleted_at: null, cover_media_url: null }],
    brands: [{ id: "brand-1", deleted_at: null, cover_media_url: null }],
    // The provider reads every encoding job as still encoding (API status 2).
    bunnyGetVideo: (guid: string) =>
      Promise.resolve({ ok: true, video: { guid, status: 2, length: null, storageSize: 0, availableResolutions: null, encodeProgress: 10 } }),
  });
  await withTusHead(
    () => new Response(null, { status: 200, headers: { "upload-offset": "512", "upload-length": "6000000" } }),
    () => withEnvKey(() => quietly(reaper.tick)),
  );
  for (const row of rows) {
    const after = reaper.job(row.id);
    assert(after.status !== before.get(row.id), `${row.id} (${before.get(row.id)}) had no exit: still ${after.status}`);
    assert(after.status === "failed" && typeof after.failure_code === "string", `${row.id} ended ${after.status}/${after.failure_code}`);
  }
});

// The replay path signs a synthetic webhook; give it a key.
const withEnvKey = async <T>(fn: () => Promise<T>): Promise<T> => {
  const prior = Deno.env.get("BUNNY_STREAM_WEBHOOK_KEY");
  Deno.env.set("BUNNY_STREAM_WEBHOOK_KEY", "webhook-key-3040-sm");
  try {
    return await fn();
  } finally {
    if (prior === undefined) Deno.env.delete("BUNNY_STREAM_WEBHOOK_KEY");
    else Deno.env.set("BUNNY_STREAM_WEBHOOK_KEY", prior);
  }
};
