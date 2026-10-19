// Issue #3040 (T-B5, B-5, B-14, C-5..C-8) — applying a cover reclaims only the
// cover it replaced; applying an ad video creates its library row first.
// Invariant I-VIDEO-NO-DESTROY-WHILE-REFERENCED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_orphan_reclaim.test.ts): prior reaps are scoped to the same target_kind and target, and never destroy a referenced asset
// Invariant I-CREATIVE-FROM-JOB-ONLY (declared in supabase/functions/_shared/__tests__/adCreativeMaterialize.issue3040.test.ts): video creatives are created only from a READY lane job
//
// FAILS ON REVERT: restore the event_id-only prior reap and the trip-day
// gallery assets below are destroyed; drop the reference guard and the
// referenced prior cover is destroyed.
import { handleEventCoverVideoApply } from "../index.ts";
import {
  applyOnceHandler,
  assert,
  makeFakeDb,
  type Row,
} from "../../_shared/__tests__/issue3040_fakeSupabase.ts";

const EVENT = "3040dddd-dddd-4ddd-8ddd-dddddddd0001";
const NEW_JOB = "3040dddd-dddd-4ddd-8ddd-dddddddd0002";
const USER = "user-3040";

const run = async (
  rows: Row[],
  references: Record<string, string[]>,
  materialize?: (supabase: { from: (t: string) => { insert: (r: Row) => PromiseLike<unknown> } }) => Promise<unknown>,
) => {
  const destroyed: string[] = [];
  const db = makeFakeDb({ event_cover_video_jobs: rows, ad_creatives: [] }, {
    cover_video_apply_once: applyOnceHandler,
    cover_video_guid_live_references: (args) => ({ data: references[args.p_guid] ?? [], error: null }),
  });
  const job = rows[0];
  const response = await handleEventCoverVideoApply(
    new Request("https://test/apply", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, expectedVersion: 0, expectedProcessedUrl: job.processed_url }),
    }),
    {
      destroyCoverVideoAsset: (row: { source_asset_id?: unknown }) => {
        destroyed.push(String(row.source_asset_id));
        return Promise.resolve({ ok: true as const });
      },
      materializeAdCreativeFromJob: (materialize ?? (() => Promise.reject(new Error("not an ad")))) as never,
      requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
      requireUserId: () => Promise.resolve(USER),
      serviceRoleClient: () => db.client,
    } as never,
  );
  return { response, db, destroyed };
};

const ready = (overrides: Row = {}): Row => ({
  id: NEW_JOB,
  status: "ready",
  provider: "bunny",
  target_kind: "event",
  event_id: EVENT,
  brand_id: "brand-3040",
  requested_by: USER,
  source_asset_id: "guid-new-cover",
  processed_url: "https://cdn.test/guid-new-cover/play_1080p.mp4",
  processed_poster_url: "https://cdn.test/guid-new-cover/thumbnail.jpg",
  application_version: 0,
  ...overrides,
});
const applied = (id: string, kind: string, guid: string): Row => ({
  id, status: "applied", provider: "bunny", target_kind: kind, event_id: EVENT, source_asset_id: guid, reaped_at: null,
});

Deno.test("#3040 an event cover apply never destroys the trip's gallery videos", async () => {
  const { response, db, destroyed } = await run([
    ready(),
    applied("gallery-1", "trip_day_media", "guid-gallery-1"),
    applied("gallery-2", "trip_day_media", "guid-gallery-2"),
    applied("old-cover", "event", "guid-old-cover"),
  ], {});
  assert(response.status === 200, `got ${response.status}`);
  assert(!destroyed.some((guid) => guid.startsWith("guid-gallery")), `gallery destroyed: ${destroyed.join(",")}`);
  assert(destroyed.includes("guid-old-cover"), "the replaced cover was not reclaimed");
  const stamped = db.tables.event_cover_video_jobs.find((row) => row.id === "old-cover");
  assert(typeof stamped?.reaped_at === "string", "the reclaimed cover was not stamped");
});

Deno.test("#3040 a prior cover still referenced by a live surface is kept", async () => {
  const { destroyed } = await run([ready(), applied("old-cover", "event", "guid-old-cover")], {
    "guid-old-cover": ["trip_day_media"],
  });
  assert(destroyed.length === 0, `a referenced prior cover was destroyed: ${destroyed.join(",")}`);
});

Deno.test("#3040 an unknown reference answer never destroys", async () => {
  const destroyed: string[] = [];
  const db = makeFakeDb({ event_cover_video_jobs: [ready(), applied("old-cover", "event", "guid-old-cover")] }, {
    cover_video_apply_once: applyOnceHandler,
    // cover_video_guid_live_references is not deployed: the fake answers PGRST202.
  });
  await handleEventCoverVideoApply(
    new Request("https://test/apply", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: NEW_JOB, expectedVersion: 0, expectedProcessedUrl: ready().processed_url }),
    }),
    {
      destroyCoverVideoAsset: (row: { source_asset_id?: unknown }) => {
        destroyed.push(String(row.source_asset_id));
        return Promise.resolve({ ok: true as const });
      },
      materializeAdCreativeFromJob: () => Promise.reject(new Error("no")),
      requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
      requireUserId: () => Promise.resolve(USER),
      serviceRoleClient: () => db.client,
    } as never,
  );
  assert(destroyed.length === 0, "a destroy ran without a reference answer");
});

Deno.test("#3040 applying an ad video materializes its library row and returns creativeId", async () => {
  const adJob = ready({ target_kind: "ad_creative", event_id: null, brand_id: null, draft_owner_key: `admin-library:${USER}` });
  let materialized = 0;
  const { response, db } = await run([adJob], {}, async (supabase) => {
    materialized += 1;
    await supabase.from("ad_creatives").insert({ id: "creative-3040", source_job_id: NEW_JOB });
    return { ok: true, creativeId: "creative-3040", created: true };
  });
  const payload = await response.json();
  assert(response.status === 200 && payload.creativeId === "creative-3040", JSON.stringify(payload));
  assert(materialized === 1 && db.tables.event_cover_video_jobs[0].status === "applied", "ad job not applied after materialize");
});

Deno.test("#3040 an ad video whose row cannot be made yet answers a retryable 503", async () => {
  const adJob = ready({ target_kind: "ad_creative", event_id: null, brand_id: null });
  const { response, db } = await run([adJob], {}, () =>
    Promise.resolve({ ok: false, retryable: true, code: "creative_materialize_pending", reason: "net" })
  );
  const payload = await response.json();
  assert(response.status === 503 && payload.error === "creative_materialize_pending", JSON.stringify(payload));
  assert(db.tables.event_cover_video_jobs[0].status === "ready", "the ad job applied without its row");
});
