// Issue #3040 (T-B2 webhook half, B-2, B-14, C-10) — the webhook delivers the
// highest served rendition up to 1080p within the 64 MB budget, records it, and
// an auto-applied cover reclaims only the cover it replaced.
// MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | the lane selects the highest served rendition <= 1080p within FINAL_MAX_BYTES
// MINGLA-INVARIANT: I-VIDEO-NO-DESTROY-WHILE-REFERENCED | issue #3040 | prior reaps are scoped to the same target_kind and target
//
// FAILS ON REVERT: restore bunnyBestMp4 (720 ceiling) and the first test
// promotes play_720p even though 1080p fits; drop the over-budget fallback and
// the 70 MB 1080p is either promoted (size check fails the job) or blocks.
import { handleBunnyWebhook } from "../index.ts";
import { hmacSha256Hex } from "../../_shared/bunnyStream.ts";
import {
  applyOnceHandler,
  assert,
  makeFakeDb,
  transitionJobHandler,
  withEnv,
  withFetch,
} from "../../_shared/__tests__/issue3040_fakeSupabase.ts";

const KEY = "webhook-key-3040";
const CDN = "vz-3040.b-cdn.net";
const GUID = "guid-webhook-3040";
const EVENT = "3040cccc-cccc-4ccc-8ccc-cccccccc0001";

const job = (overrides: Record<string, unknown> = {}) => ({
  id: "3040cccc-cccc-4ccc-8ccc-cccccccc0002",
  status: "processing",
  provider: "bunny",
  event_id: EVENT,
  brand_id: "brand-3040",
  target_kind: "event",
  apply_mode: "published_manual",
  source_asset_id: GUID,
  source_sha256: null,
  provider_payload: {},
  application_version: 0,
  ...overrides,
});

const video = { guid: GUID, status: 4, length: 30, storageSize: 1, availableResolutions: "360p,720p,1080p", encodeProgress: 100, outputCodecs: "x264", originalHash: null };

const fire = async (
  rows: Record<string, unknown>[],
  sizes: Record<string, number | null>,
  references: Record<string, string[]> = {},
) => {
  const destroyed: string[] = [];
  const db = makeFakeDb({ event_cover_video_jobs: rows }, {
    cover_video_transition_job: transitionJobHandler,
    cover_video_apply_once: applyOnceHandler,
    cover_video_guid_live_references: (args) => ({ data: references[args.p_guid] ?? [], error: null }),
  });
  const body = JSON.stringify({ VideoLibraryId: 1, VideoGuid: GUID, Status: 3 });
  let response: Response | null = null;
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await withEnv({ BUNNY_STREAM_WEBHOOK_KEY: KEY, BUNNY_STREAM_CDN_HOSTNAME: CDN }, async () => {
      await withFetch((input) => {
        const url = String(input instanceof Request ? input.url : input);
        const key = Object.keys(sizes).find((k) => url.endsWith(k));
        const size = key === undefined ? 1000 : sizes[key];
        return Promise.resolve(
          size === null
            ? new Response(null, { status: 404 })
            : new Response(null, { status: 200, headers: { "content-length": String(size) } }),
        );
      }, async () => {
        response = await handleBunnyWebhook(
          new Request("https://internal/webhook", {
            method: "POST",
            headers: {
              "x-bunnystream-signature": await hmacSha256Hex(KEY, body),
              "x-bunnystream-signature-version": "v1",
              "x-bunnystream-signature-algorithm": "hmac-sha256",
            },
            body,
          }),
          body,
          {
            bunnyGetVideo: () => Promise.resolve({ ok: true as const, video }),
            destroyCoverVideoAsset: (row: { source_asset_id?: unknown }) => {
              destroyed.push(String(row.source_asset_id));
              return Promise.resolve({ ok: true as const });
            },
            serviceRoleClient: () => db.client as never,
            sleep: () => Promise.resolve(),
          },
        );
      });
    });
  } finally {
    console.warn = originalWarn;
  }
  return { response: response as unknown as Response, db, destroyed, logs };
};

Deno.test("#3040 a served 1080p within budget is the delivered MP4, and its height is recorded", async () => {
  const { response, db } = await fire([job()], { "play_1080p.mp4": 40_000_000 });
  assert(response.status === 200, `got ${response.status}`);
  const row = db.tables.event_cover_video_jobs[0];
  assert(row.status === "ready" && row.processed_url === `https://${CDN}/${GUID}/play_1080p.mp4`, `${row.status} ${row.processed_url}`);
  assert(row.provider_payload.rendition_height === 1080, JSON.stringify(row.provider_payload));
});

Deno.test("#3040 a 1080p over the 64 MB budget falls back to 720p and says so", async () => {
  const { db, logs } = await fire([job()], { "play_1080p.mp4": 70_000_000, "play_720p.mp4": 30_000_000 });
  const row = db.tables.event_cover_video_jobs[0];
  assert(row.status === "ready" && row.processed_url.endsWith("/play_720p.mp4"), `${row.status} ${row.processed_url}`);
  assert(row.provider_payload.rendition_height === 720, "fallback height not recorded");
  assert(logs.some((line) => line.includes("rendition_over_budget_fallback")), "fallback was silent");
});

Deno.test("#3040 a 1080p the CDN does not serve yet is retried, never downgraded", async () => {
  const { response, db } = await fire([job()], { "play_1080p.mp4": null, "play_720p.mp4": 30_000_000 });
  const payload = await response.json();
  assert(response.status === 503 && payload.error === "derivative_not_ready", JSON.stringify(payload));
  assert(db.tables.event_cover_video_jobs[0].status === "processing", "a lagging rendition changed the job");
});

Deno.test("#3040 webhook auto-apply reclaims the replaced cover, never a trip-day video or a referenced one", async () => {
  const rows = [
    job({ apply_mode: "draft_auto" }),
    { id: "prior-cover", status: "applied", provider: "bunny", target_kind: "event", event_id: EVENT, source_asset_id: "guid-prior-cover", reaped_at: null },
    { id: "prior-shared", status: "applied", provider: "bunny", target_kind: "event", event_id: EVENT, source_asset_id: "guid-prior-shared", reaped_at: null },
    { id: "gallery", status: "applied", provider: "bunny", target_kind: "trip_day_media", event_id: EVENT, source_asset_id: "guid-gallery", reaped_at: null },
  ];
  const { db, destroyed } = await fire(rows, { "play_1080p.mp4": 10_000_000 }, { "guid-prior-shared": ["trip_day_media"] });
  assert(db.tables.event_cover_video_jobs[0].status === "applied", "draft_auto job not applied");
  assert(destroyed.includes("guid-prior-cover"), "the replaced cover was not reclaimed");
  assert(!destroyed.includes("guid-gallery"), "a trip-day gallery video was destroyed");
  assert(!destroyed.includes("guid-prior-shared"), "a still-referenced prior cover was destroyed");
});
