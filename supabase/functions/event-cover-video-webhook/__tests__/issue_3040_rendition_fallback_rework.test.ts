// Issue #3040 rework 1 (P1-4, tester D-4) — fall back on ABSENCE, not only on
// budget. Once Bunny reports the encode finished, the lane prefers
// play_1080p.mp4, waits a bounded window for it (RENDITION_WAIT_MS after the
// first absence, 3 HEADs per call), then delivers the highest served rendition
// <= 1080p, logs `rendition_fallback` with the reason, and records it. It never
// fails a job only because 1080p is missing. A source below 1080p uses its
// highest rendition at once. When nothing is served at all the answer stays
// retryable, and the reconciler's encode stall ends the job (bounded).
//
// MINGLA-INVARIANT: I-VIDEO-RENDITION-FALLBACK | issue #3040 | a missing or over-budget 1080p falls back to the highest served rendition once the wait window has passed; it never fails the job by itself
//
// FAILS ON REVERT: make selectRendition stop at an absent rendition regardless
// of `absentFallback` (the pre-rework walk) and "1080 missing -> 720" stays
// 503 forever; accept a missing content-length as in budget and the
// size-unknown case fails the job; drop the wait-window record and the
// fallback never starts.
import { handleBunnyWebhook, RENDITION_WAIT_MS } from "../index.ts";
import { hmacSha256Hex } from "../../_shared/bunnyStream.ts";
import {
  applyOnceHandler,
  assert,
  isoAgo,
  makeFakeDb,
  transitionJobHandler,
  withEnv,
  withFetch,
} from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "../../event-cover-video-reaper/__tests__/issue3040_reaperHarness.ts";

const KEY = "webhook-key-3040-rework";
const CDN = "vz-3040r.b-cdn.net";
const GUID = "guid-webhook-3040-rework";

const job = (overrides: Record<string, unknown> = {}) => ({
  id: "3040dddd-dddd-4ddd-8ddd-dddddddd0002",
  status: "processing",
  provider: "bunny",
  event_id: "3040dddd-dddd-4ddd-8ddd-dddddddd0001",
  brand_id: "brand-3040r",
  target_kind: "event",
  apply_mode: "published_manual",
  source_asset_id: GUID,
  source_sha256: null,
  provider_payload: {},
  application_version: 0,
  ...overrides,
});

const waitingSince = (ms: number) => ({ rendition_wait: { first_absent_at: isoAgo(ms), height: 1080 } });

type Served = Record<string, number | null | "no-length">;

const fire = async (row: Record<string, unknown>, served: Served, resolutions = "360p,720p,1080p") => {
  const db = makeFakeDb({ event_cover_video_jobs: [row] }, {
    cover_video_transition_job: transitionJobHandler,
    cover_video_apply_once: applyOnceHandler,
    cover_video_guid_live_references: () => ({ data: [], error: null }),
  });
  const body = JSON.stringify({ VideoLibraryId: 1, VideoGuid: GUID, Status: 3 });
  const logs: string[] = [];
  const { warn, log } = console;
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.log = () => {};
  let response: Response | null = null;
  try {
    await withEnv({ BUNNY_STREAM_WEBHOOK_KEY: KEY, BUNNY_STREAM_CDN_HOSTNAME: CDN }, () =>
      withFetch((input) => {
        const url = String(input instanceof Request ? input.url : input);
        const key = Object.keys(served).find((k) => url.endsWith(k));
        const size = key === undefined ? 1000 : served[key];
        if (size === null) return Promise.resolve(new Response(null, { status: 404 }));
        if (size === "no-length") return Promise.resolve(new Response(null, { status: 200 }));
        return Promise.resolve(new Response(null, { status: 200, headers: { "content-length": String(size) } }));
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
            bunnyGetVideo: () =>
              Promise.resolve({
                ok: true as const,
                video: { guid: GUID, status: 4, length: 30, storageSize: 1, availableResolutions: resolutions, encodeProgress: 100, outputCodecs: "x264", originalHash: null },
              }),
            destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
            serviceRoleClient: () => db.client as never,
            sleep: () => Promise.resolve(),
          },
        );
      })
    );
  } finally {
    console.warn = warn;
    console.log = log;
  }
  return { response: response as unknown as Response, row: db.tables.event_cover_video_jobs[0], logs };
};

const fallbackLog = (logs: string[], reason: string) =>
  logs.some((line) => line.includes("rendition_fallback") && line.includes(`"reason":"${reason}"`));

Deno.test("#3040 P1-4 1080p missing after the encode finished: wait once, then deliver 720p and say why", async () => {
  // First sighting: retryable, and the wait window starts.
  const first = await fire(job(), { "play_1080p.mp4": null, "play_720p.mp4": 30_000_000 });
  assert(first.response.status === 503, `first sighting answered ${first.response.status}`);
  assert(first.row.status === "processing", `first sighting moved the job to ${first.row.status}`);
  assert(typeof first.row.provider_payload?.rendition_wait?.first_absent_at === "string", `wait window not started: ${JSON.stringify(first.row.provider_payload)}`);
  // After the window: 720p is delivered, logged and recorded.
  const later = await fire(job({ provider_payload: waitingSince(RENDITION_WAIT_MS + 1_000) }), { "play_1080p.mp4": null, "play_720p.mp4": 30_000_000 });
  assert(later.response.status === 200, `after the window answered ${later.response.status}`);
  assert(later.row.status === "ready" && String(later.row.processed_url).endsWith("/play_720p.mp4"), `${later.row.status} ${later.row.processed_url}`);
  assert(later.row.provider_payload.rendition_height === 720, JSON.stringify(later.row.provider_payload));
  assert(later.row.provider_payload.rendition_fallback?.reason === "absent" && later.row.provider_payload.rendition_fallback?.fromHeightP === 1080, JSON.stringify(later.row.provider_payload.rendition_fallback));
  assert(fallbackLog(later.logs, "absent"), `no rendition_fallback log:\n${later.logs.join("\n")}`);
});

Deno.test("#3040 P1-4 inside the wait window a lagging 1080p is never downgraded", async () => {
  const { response, row } = await fire(job({ provider_payload: waitingSince(30_000) }), { "play_1080p.mp4": null, "play_720p.mp4": 30_000_000 });
  assert(response.status === 503 && row.status === "processing", `${response.status} ${row.status}`);
});

Deno.test("#3040 P1-4 1080p over budget falls to 720p at once", async () => {
  const { row, logs } = await fire(job(), { "play_1080p.mp4": 70_000_000, "play_720p.mp4": 30_000_000 });
  assert(row.status === "ready" && String(row.processed_url).endsWith("/play_720p.mp4"), `${row.status} ${row.processed_url}`);
  assert(row.provider_payload.rendition_fallback?.reason === "over_budget", JSON.stringify(row.provider_payload));
  assert(fallbackLog(logs, "over_budget"), "over-budget fallback not logged");
});

Deno.test("#3040 P1-4 a 1080p whose size the CDN does not state falls to 720p instead of failing the job", async () => {
  const { row, logs } = await fire(job(), { "play_1080p.mp4": "no-length", "play_720p.mp4": 30_000_000 });
  assert(row.status === "ready" && String(row.processed_url).endsWith("/play_720p.mp4"), `${row.status} ${row.failure_code ?? ""} ${row.processed_url}`);
  assert(fallbackLog(logs, "size_unknown"), "size-unknown fallback not logged");
});

Deno.test("#3040 P1-4 a source below 1080p uses its highest rendition at once", async () => {
  const { row } = await fire(job(), { "play_720p.mp4": 20_000_000 }, "240p,360p,720p");
  assert(row.status === "ready" && String(row.processed_url).endsWith("/play_720p.mp4"), `${row.status} ${row.processed_url}`);
  assert(row.provider_payload.rendition_fallback === null, "a native 720p source was reported as a fallback");
});

Deno.test("#3040 P1-4 nothing served: the webhook stays retryable and never fails the job itself", async () => {
  const { response, row } = await fire(job({ provider_payload: waitingSince(RENDITION_WAIT_MS * 3) }), { "play_1080p.mp4": null, "play_720p.mp4": null, "play_360p.mp4": null });
  assert(response.status === 503, `answered ${response.status}`);
  assert(row.status === "processing", `the webhook ended the job: ${row.status}/${row.failure_code}`);
});

Deno.test("#3040 P1-4 nothing served: the reconciler ends the job at the encode stall bound, not before", async () => {
  const MIN = 60_000;
  for (const [uploadedAgo, expected] of [[2 * MIN, "processing"], [11 * MIN, "failed"]] as const) {
    const reaper = makeReaper([job({ source_uploaded_at: isoAgo(uploadedAgo), created_at: isoAgo(uploadedAgo + MIN), reaped_at: null, provider_payload: waitingSince(RENDITION_WAIT_MS * 3) })], {
      events: [{ id: "3040dddd-dddd-4ddd-8ddd-dddddddd0001", deleted_at: null, cover_media_url: null }],
      brands: [{ id: "brand-3040r", deleted_at: null, cover_media_url: null }],
      bunnyGetVideo: () => Promise.resolve({ ok: true, video: { guid: GUID, status: 4, length: 30, storageSize: 1, availableResolutions: "720p,1080p", encodeProgress: 100, outputCodecs: "x264", originalHash: null } }),
    });
    await withEnv({ BUNNY_STREAM_WEBHOOK_KEY: KEY, BUNNY_STREAM_CDN_HOSTNAME: CDN }, () =>
      withFetch(() => Promise.resolve(new Response(null, { status: 404 })), () => quietly(reaper.tick).then(() => undefined))
    );
    const after = reaper.job("3040dddd-dddd-4ddd-8ddd-dddddddd0002");
    assert(after.status === expected, `uploaded ${uploadedAgo / MIN} min ago: ${after.status}/${after.failure_code}`);
    if (expected === "failed") assert(after.failure_code === "processing_stalled", `failure code ${after.failure_code}`);
  }
});
