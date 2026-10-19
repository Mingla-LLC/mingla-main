// Issue #3040 (T-B3, B-3, B-9) — the reaper owns every `ready` job.
// MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040 | every non-terminal and ready job has a server owner with a finite bound
//
// FAILS ON REVERT: restore `if (candidate.status === "ready") { reconciled += 1; continue; }`
// with no owner and every job below stays `ready` forever.
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

const MIN = 60_000;
const BRAND = "brand-3040-owner";
const readyJob = (id: string, overrides: Record<string, unknown>) => ({
  id,
  status: "ready",
  provider: "bunny",
  target_kind: "brand",
  brand_id: BRAND,
  event_id: null,
  source_asset_id: `guid-${id}`,
  processed_url: `https://cdn.test/guid-${id}/play_1080p.mp4`,
  processed_poster_url: `https://cdn.test/guid-${id}/thumbnail.jpg`,
  target_cover_base_url: "https://cdn.test/old/brand.jpg",
  completed_at: isoAgo(16 * MIN),
  created_at: isoAgo(17 * MIN),
  application_version: 0,
  reaped_at: null,
  ...overrides,
});

Deno.test("#3040 a brand video the host left behind is applied by the server after 15 minutes", async () => {
  const reaper = makeReaper([readyJob("brand-ready", {})], {
    brands: [{ id: BRAND, deleted_at: null, cover_media_url: "https://cdn.test/old/brand.jpg" }],
  });
  const body = await quietly(reaper.tick);
  const job = reaper.job("brand-ready");
  assert(body.ok === true, JSON.stringify(body));
  assert(job.status === "applied", `ended ${job.status}`);
  assert(job.application_receipt?.source === "reaper_server_apply", JSON.stringify(job.application_receipt));
  assert(reaper.destroyed.length === 0, "an applied video was destroyed");
});

Deno.test("#3040 a host who changed the cover keeps it; the finished video is alerted once", async () => {
  const reaper = makeReaper([readyJob("brand-changed", {})], {
    brands: [{ id: BRAND, deleted_at: null, cover_media_url: "https://cdn.test/new/photo.jpg" }],
  });
  await quietly(reaper.tick);
  const job = reaper.job("brand-changed");
  assert(job.status === "ready" && typeof job.ready_alerted_at === "string", `${job.status}/${job.ready_alerted_at}`);
  const alerts = reaper.db.tables.api_health_checks.filter((row) => row.detail?.signal === "cover_video_ready_unclaimed");
  assert(alerts.length === 1 && alerts[0].service_key === "bunny", JSON.stringify(alerts));
  job.reconcile_lease_until = null;
  await quietly(reaper.tick);
  assert(
    reaper.db.tables.api_health_checks.filter((row) => row.detail?.signal === "cover_video_ready_unclaimed").length === 1,
    "the ready-unclaimed alert repeated",
  );
});

Deno.test("#3040 an unreferenced trip-day video unclaimed for a day is ended and reclaimed", async () => {
  const reaper = makeReaper([
    readyJob("trip-old", { target_kind: "trip_day_media", event_id: "event-1", completed_at: isoAgo(25 * 60 * MIN) }),
  ], { events: [{ id: "event-1", deleted_at: null, cover_media_url: null }] });
  const body = await quietly(reaper.tick);
  const job = reaper.job("trip-old");
  assert(job.status === "failed" && job.failure_code === "ready_unclaimed", `${job.status}/${job.failure_code}`);
  assert(reaper.destroyed.includes("guid-trip-old") && typeof job.reaped_at === "string", "the expired asset was not reclaimed");
  assert(body.readyOwner?.expired === 1, JSON.stringify(body.readyOwner));
});

Deno.test("#3040 a trip-day video already in its gallery is recorded, never destroyed", async () => {
  const reaper = makeReaper([
    readyJob("trip-live", { target_kind: "trip_day_media", event_id: "event-1", completed_at: isoAgo(25 * 60 * MIN) }),
  ], {
    events: [{ id: "event-1", deleted_at: null, cover_media_url: null }],
    references: { "guid-trip-live": ["trip_day_media"] },
  });
  await quietly(reaper.tick);
  const job = reaper.job("trip-live");
  assert(job.status === "applied" && job.application_receipt?.source === "reaper_reference_observed", JSON.stringify(job));
  assert(reaper.destroyed.length === 0, "a referenced gallery video was destroyed");
});
