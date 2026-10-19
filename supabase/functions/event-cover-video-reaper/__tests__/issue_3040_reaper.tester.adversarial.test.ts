// Issue #3040 — INDEPENDENT TESTER adversarial suite for the reaper.
// Written by the tester, not the implementor. It drives the REAL handleReaper
// (through the implementor's in-memory harness, whose RPCs follow the SQL
// contracts) at the boundaries and failure paths the implementor suites do not
// visit: a brand deleted under a finished ad video, a deleted parent whose
// asset is still served elsewhere, a lease extended by a resume, a TUS HEAD
// that stays unreadable across the 30-minute grace (status and network
// failures), a legacy event job with no baseline column at all, an unknown
// reference answer on a month-old job, and a backlog of 1,200 applied rows.
//
// Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): every non-terminal and ready job ends within its bound, and never on an unknown answer
// Invariant I-VIDEO-NO-DESTROY-WHILE-REFERENCED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_orphan_reclaim.test.ts): a deleted parent or an expired job never destroys an asset a live surface still serves
// Invariant I-VIDEO-SOFTDELETE-NO-WEDGE (declared in supabase/migrations/__tests__/issue_3040_softdelete_no_wedge.implementor.pg17.test.sql): a deleted brand ends its ad video job; it is never turned into a library creative
//
// FAILS ON REVERT (each test names the clause it guards):
//   A1  parentDeleted() branch removed       -> the ad job stays ready / is materialized
//   A2  target_deleted reaped unguarded      -> a still-served asset is destroyed
//   A3  sweep ignores tus_expires_at         -> an extended upload is failed mid-transfer
//   A4  unreadable HEAD fails at expiry      -> 202-window upload failed early
//       (or the grace never ends)            -> unreadable upload lives forever
//   A5  baseline guard `=== true` loosened   -> a legacy event job is auto-applied
//   A6  expire on unknown references         -> a month-old job's asset is destroyed blind
//   A7  orphan reclaim limit or flag removed -> >20 destroys per tick, or destroys with the flag off
import { assert, isoAgo, withEnv } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly, withTusHead } from "./issue3040_reaperHarness.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BRAND = "brand-3040-tester";
const EVENT = "event-3040-tester";

// Nothing in this suite may reach a real network: every fetch (TUS HEAD, CDN
// probe) answers from here.
const offline = (status = 404) => () => new Response(null, { status });
// deno-lint-ignore no-explicit-any
const tickWith = async (reaper: { tick: () => Promise<Record<string, any>> }, head: (url: string) => Response) => {
  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {};
  await withTusHead(head, async () => {
    body = await quietly(reaper.tick);
  });
  return body;
};

const readyAdJob = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: "ready",
  provider: "bunny",
  target_kind: "ad_creative",
  brand_id: BRAND,
  event_id: null,
  requested_by: "user-3040-tester",
  draft_owner_key: "host-ad:draft-tester",
  source_asset_id: `guid-${id}`,
  processed_url: `https://cdn.test/guid-${id}/play_1080p.mp4`,
  processed_poster_url: `https://cdn.test/guid-${id}/thumbnail.jpg`,
  completed_at: isoAgo(2 * MIN),
  created_at: isoAgo(4 * MIN),
  application_version: 0,
  reaped_at: null,
  ...overrides,
});

Deno.test("A1 #3040 a brand deleted under a finished ad video ends the job; it never becomes a library creative", async () => {
  const reaper = makeReaper([readyAdJob("ad-orphan")], {
    brands: [{ id: BRAND, deleted_at: isoAgo(MIN), cover_media_url: null }],
    references: { "guid-ad-orphan": [] },
  });
  await tickWith(reaper, offline());
  const job = reaper.job("ad-orphan");
  assert(job.status === "failed" && job.failure_code === "target_deleted", `ad job ended ${job.status}/${job.failure_code}`);
  assert(reaper.db.tables.ad_creatives.length === 0, "a deleted brand's ad video was materialized into the library");
  assert(!reaper.db.rpcs.some((rpc) => rpc.name === "cover_video_apply_once"), "a deleted brand's ad video was applied");
  assert(reaper.destroyed.includes("guid-ad-orphan"), "the unreferenced asset of a deleted brand was kept");
});

Deno.test("A2 #3040 a deleted parent's job ends, but an asset still served elsewhere is never destroyed", async () => {
  const reaper = makeReaper([
    {
      id: "trip-served", status: "processing", provider: "bunny", target_kind: "trip_day_media",
      event_id: EVENT, brand_id: BRAND, source_asset_id: "guid-trip-served",
      source_uploaded_at: isoAgo(MIN), created_at: isoAgo(2 * MIN), reaped_at: null,
    },
  ], {
    events: [{ id: EVENT, deleted_at: isoAgo(MIN), cover_media_url: null }],
    brands: [{ id: BRAND, deleted_at: null, cover_media_url: null }],
    // The same guid is still the cover of ANOTHER live event (a host reused it).
    references: { "guid-trip-served": ["event_cover"] },
  });
  await tickWith(reaper, offline());
  const job = reaper.job("trip-served");
  assert(job.status === "failed" && job.failure_code === "target_deleted", `${job.status}/${job.failure_code}`);
  assert(reaper.destroyed.length === 0, `a still-served asset was destroyed: ${reaper.destroyed.join(",")}`);
  assert(job.reaped_at == null, "a referenced asset was stamped reaped");
  // The next tick still does not destroy it while the reference stands.
  job.reconcile_lease_until = null;
  await tickWith(reaper, offline());
  assert(reaper.destroyed.length === 0, "a later tick destroyed the still-served asset");
});

const uploadingJob = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: "source_uploading",
  provider: "bunny",
  target_kind: "event",
  event_id: EVENT,
  brand_id: BRAND,
  source_asset_id: `guid-${id}`,
  source_bytes: 5_000_000,
  tus_resource_url: `https://video.bunnycdn.com/tusupload/${id}`,
  reaped_at: null,
  ...overrides,
});
const tusAt = (offset: number) => () =>
  new Response(null, { status: 200, headers: { "upload-offset": String(offset), "upload-length": "5000000" } });

Deno.test("A3 #3040 a resume that extended the lease keeps a 3-hour-old upload alive; an expired lease ends it", async () => {
  const reaper = makeReaper([
    uploadingJob("resumed", { created_at: isoAgo(3 * HOUR), tus_expires_at: new Date(Date.now() + 50 * MIN).toISOString() }),
    uploadingJob("lapsed", { created_at: isoAgo(3 * HOUR), tus_expires_at: isoAgo(MIN) }),
  ], { events: [{ id: EVENT, deleted_at: null, cover_media_url: null }] });
  await tickWith(reaper, tusAt(1_000_000));
  const resumed = reaper.job("resumed");
  assert(resumed.status === "source_uploading" && resumed.failure_code == null, `an extended upload was ended: ${resumed.status}/${resumed.failure_code}`);
  assert(!reaper.destroyed.includes("guid-resumed"), "an extended upload's asset was destroyed");
  const lapsed = reaper.job("lapsed");
  assert(lapsed.status === "failed" && lapsed.failure_code === "source_transport_expired", `${lapsed.status}/${lapsed.failure_code}`);
  assert(reaper.destroyed.includes("guid-lapsed"), "the expired transfer's asset was kept");
});

Deno.test("A4 #3040 an unreadable TUS HEAD after the lease gets exactly 30 minutes, for HTTP and network failures alike", async () => {
  const jobs = [
    uploadingJob("http-29", { created_at: isoAgo(2 * HOUR), tus_expires_at: isoAgo(29 * MIN) }),
    uploadingJob("http-31", { created_at: isoAgo(2 * HOUR), tus_expires_at: isoAgo(31 * MIN) }),
  ];
  const reaper = makeReaper(jobs, { events: [{ id: EVENT, deleted_at: null, cover_media_url: null }] });
  await tickWith(reaper, offline(503));
  assert(reaper.job("http-29").status === "source_uploading", `inside the grace: ${reaper.job("http-29").status}`);
  assert(!reaper.destroyed.includes("guid-http-29"), "an upload inside the unreadable grace lost its asset");
  const late = reaper.job("http-31");
  assert(late.status === "failed" && late.failure_code === "source_unverifiable", `${late.status}/${late.failure_code}`);

  const net = makeReaper([
    uploadingJob("net-29", { created_at: isoAgo(2 * HOUR), tus_expires_at: isoAgo(29 * MIN) }),
    uploadingJob("net-31", { created_at: isoAgo(2 * HOUR), tus_expires_at: isoAgo(31 * MIN) }),
  ], { events: [{ id: EVENT, deleted_at: null, cover_media_url: null }] });
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError("network down"))) as typeof fetch;
  try {
    await quietly(net.tick);
  } finally {
    globalThis.fetch = original;
  }
  assert(net.job("net-29").status === "source_uploading", `network failure inside the grace ended the upload: ${net.job("net-29").status}`);
  assert(net.job("net-31").failure_code === "source_unverifiable", `network failure past the grace: ${net.job("net-31").failure_code}`);
});

const readyEventJob = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: "ready",
  provider: "bunny",
  target_kind: "event",
  event_id: EVENT,
  brand_id: BRAND,
  requested_by: "user-3040-tester",
  source_asset_id: `guid-${id}`,
  processed_url: `https://cdn.test/guid-${id}/play_1080p.mp4`,
  processed_poster_url: `https://cdn.test/guid-${id}/thumbnail.jpg`,
  application_version: 0,
  reaped_at: null,
  ...overrides,
});

Deno.test("A5 #3040 a legacy EVENT ready job with no baseline column at all expires, never applies (even when the cover 'matches')", async () => {
  // A row read before M-1's columns exist has neither target_cover_base_url
  // nor target_cover_base_captured. The event has no cover, so a loose
  // `baseline === current` check would see null === null and apply it.
  const legacy = readyEventJob("legacy-event", { completed_at: isoAgo(20 * MIN), created_at: isoAgo(22 * MIN) });
  const reaper = makeReaper([legacy], {
    events: [{ id: EVENT, deleted_at: null, cover_media_url: null }],
    brands: [{ id: BRAND, deleted_at: null, cover_media_url: null }],
    references: { "guid-legacy-event": [] },
  });
  await tickWith(reaper, offline());
  const job = reaper.job("legacy-event");
  assert(!reaper.db.rpcs.some((rpc) => rpc.name === "cover_video_apply_once"), "a legacy job was offered to the event cover");
  assert(job.status === "failed" && job.failure_code === "ready_unclaimed", `${job.status}/${job.failure_code}`);
});

Deno.test("A6 #3040 a month-old ready job is never expired or destroyed while its references are unknown", async () => {
  const old = readyEventJob("blind", {
    target_cover_base_captured: false,
    completed_at: isoAgo(30 * DAY),
    created_at: isoAgo(30 * DAY),
  });
  const reaper = makeReaper([old], {
    events: [{ id: EVENT, deleted_at: null, cover_media_url: null }],
    brands: [{ id: BRAND, deleted_at: null, cover_media_url: null }],
    missingRpcs: ["cover_video_guid_live_references"],
  });
  await tickWith(reaper, offline());
  const job = reaper.job("blind");
  assert(job.status === "ready", `an unknown reference answer ended the job: ${job.status}/${job.failure_code}`);
  assert(reaper.destroyed.length === 0, "an asset was destroyed on an unknown reference answer");
  assert(typeof job.ready_alerted_at === "string", "the stuck job was not alerted");
});

Deno.test("A7 #3040 1,200 applied rows: orphan reclaim never runs with the flag off, takes at most 20 unreferenced per tick with it on, and a terminal job is still reaped in the same tick", async () => {
  const applied = Array.from({ length: 1_200 }, (_, i) => ({
    id: `applied-${i}`,
    status: "applied",
    provider: "bunny",
    target_kind: i % 2 === 0 ? "event" : "trip_day_media",
    event_id: EVENT,
    brand_id: BRAND,
    source_asset_id: `guid-applied-${i}`,
    completed_at: isoAgo(40 * DAY - i * MIN),
    applied_at: isoAgo(40 * DAY - i * MIN),
    created_at: isoAgo(41 * DAY - i * MIN),
    reaped_at: null,
  }));
  // Every third applied asset is still on a live surface.
  const references: Record<string, string[]> = {};
  for (let i = 0; i < 1_200; i += 3) references[`guid-applied-${i}`] = ["trip_day_media"];
  const failedNow = {
    id: "failed-now", status: "failed", failure_code: "processing_stalled", provider: "bunny",
    target_kind: "event", event_id: EVENT, brand_id: BRAND, source_asset_id: "guid-failed-now",
    completed_at: isoAgo(MIN), created_at: isoAgo(20 * MIN), reaped_at: null,
  };
  const flagOff = makeReaper([...applied.map((r) => ({ ...r })), { ...failedNow }], {
    events: [{ id: EVENT, deleted_at: null, cover_media_url: null }],
    references,
  });
  const offBody = await tickWith(flagOff, offline());
  assert(!flagOff.destroyed.some((g) => g.startsWith("guid-applied-")), "orphan reclaim destroyed with the flag off");
  assert(flagOff.destroyed.includes("guid-failed-now"), "a terminal job starved behind 1,200 applied rows");
  assert(offBody.orphanReclaim?.enabled === false && offBody.orphanReclaim?.destroyed === 0, JSON.stringify(offBody.orphanReclaim));

  const flagOn = makeReaper(applied.map((r) => ({ ...r })), {
    events: [{ id: EVENT, deleted_at: null, cover_media_url: null }],
    adminConfig: [{ key: "cover_video_orphan_reclaim_enabled", value: true }],
    references,
  });
  await tickWith(flagOn, offline());
  assert(flagOn.destroyed.length > 0, "orphan reclaim did nothing with the flag on");
  assert(flagOn.destroyed.length <= 20, `orphan reclaim destroyed ${flagOn.destroyed.length} assets in one tick`);
  const referencedDestroyed = flagOn.destroyed.filter((g) => references[g] !== undefined);
  assert(referencedDestroyed.length === 0, `referenced applied assets were destroyed: ${referencedDestroyed.join(",")}`);
});

// A8 [B-5] — the SERVER apply path (E-9 apply_server), not the apply endpoint
// the implementor tested: a trip whose host left a finished cover video is
// applied by the reaper, and the cover it replaced is reclaimed. The trip's
// gallery videos share the events-row; even with NO live reference recorded
// for them (the day was not saved yet), the prior-cover reap must not touch
// them, because they are a different target kind.
// FAILS ON REVERT: drop `.eq("target_kind", "event")` from reapPriorCoverAssets.
Deno.test("A8 #3040 a trip cover applied by the server never reaps the trip's gallery videos", async () => {
  const appliedRow = (id: string, kind: string) => ({
    id, status: "applied", provider: "bunny", target_kind: kind, event_id: EVENT, brand_id: BRAND,
    source_asset_id: `guid-${id}`, completed_at: isoAgo(2 * DAY), applied_at: isoAgo(2 * DAY),
    created_at: isoAgo(2 * DAY), reaped_at: null,
  });
  const reaper = makeReaper([
    appliedRow("prior-cover", "event"),
    appliedRow("gallery-1", "trip_day_media"),
    appliedRow("gallery-2", "trip_day_media"),
    readyEventJob("new-cover", {
      target_cover_base_captured: true,
      target_cover_base_url: "https://cdn.test/guid-prior-cover/play_720p.mp4",
      completed_at: isoAgo(20 * MIN),
      created_at: isoAgo(22 * MIN),
    }),
  ], {
    events: [{ id: EVENT, deleted_at: null, cover_media_url: "https://cdn.test/guid-prior-cover/play_720p.mp4" }],
    brands: [{ id: BRAND, deleted_at: null, cover_media_url: null }],
    references: {},
  });
  // The ready owner reclaims through the shared module's own destroy (not the
  // reaper's injected one), so observe the provider calls themselves.
  const providerCalls: string[] = [];
  await withEnv({ BUNNY_STREAM_LIBRARY_ID: "lib-3040", BUNNY_STREAM_API_KEY: "key-3040" }, async () => {
    await tickWith(reaper, (url: string) => {
      providerCalls.push(url);
      return new Response(null, { status: 404 });
    });
  });
  assert(reaper.job("new-cover").status === "applied", `the server did not apply: ${reaper.job("new-cover").status}`);
  assert(typeof reaper.job("prior-cover").reaped_at === "string", "the replaced cover was not reclaimed");
  for (const id of ["gallery-1", "gallery-2"]) {
    assert(reaper.job(id).reaped_at == null, `trip gallery video ${id} was reaped by a cover apply`);
    assert(!providerCalls.some((url) => url.includes(`guid-${id}`)), `a provider call touched ${id}`);
  }
});
