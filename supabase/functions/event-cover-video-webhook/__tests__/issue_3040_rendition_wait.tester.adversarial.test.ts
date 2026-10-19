// Issue #3040 Retest 1 — INDEPENDENT TESTER adversarial suite for the bounded
// 1080p wait (rework P1-4). Written by the tester, not the implementor. The
// implementor suite drives single webhook calls with a hand-set wait anchor.
// This one attacks the anchor itself and the cron owner that must finish it:
//   RW1  a second (and third) "1080p still missing" call inside the window
//        never moves the wait anchor later; otherwise every retry restarts the
//        90 s clock and the fallback never happens.
//   RW2  driven ONLY by the reaper's reconcile replays (the client and Bunny's
//        own webhook retries gone): tick 1 starts the wait and keeps the job
//        processing; once the window has passed, the next tick delivers the
//        highest served rendition, records why, and the job is ready — never
//        failed for a missing 1080p.
//
// MINGLA-INVARIANT: I-VIDEO-RENDITION-FALLBACK | issue #3040 | the wait for a missing 1080p is anchored once and finished by the server owner within its bound
//
// FAILS ON REVERT:
//   RW1  drop the `!Number.isFinite(waitStartedMs)` guard before recording
//        rendition_wait (every absent call re-anchors)
//   RW2  pass `absentFallback: false` to selectRendition (the pre-rework walk)
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
import { makeReaper, quietly } from "../../event-cover-video-reaper/__tests__/issue3040_reaperHarness.ts";

const KEY = "webhook-key-3040-tester-wait";
const CDN = "vz-3040tw.b-cdn.net";
const GUID = "guid-webhook-3040-tester-wait";

const finishedVideo = () =>
  Promise.resolve({
    ok: true as const,
    video: {
      guid: GUID, status: 4, length: 30, storageSize: 1, availableResolutions: "360p,720p,1080p",
      encodeProgress: 100, outputCodecs: "x264", originalHash: null,
    },
  });

// 1080p never served; 720p served within budget; poster served.
const cdn = (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/play_1080p.mp4")) return Promise.resolve(new Response(null, { status: 404 }));
  if (url.endsWith("/play_720p.mp4")) {
    return Promise.resolve(new Response(null, { status: 200, headers: { "content-length": "30000000" } }));
  }
  return Promise.resolve(new Response(null, { status: 200, headers: { "content-length": "1000" } }));
};

const jobRow = () => ({
  id: "3040eeee-eeee-4eee-8eee-eeeeeeee0002",
  status: "processing",
  provider: "bunny",
  event_id: "3040eeee-eeee-4eee-8eee-eeeeeeee0001",
  brand_id: "brand-3040tw",
  target_kind: "event",
  apply_mode: "published_manual",
  source_asset_id: GUID,
  source_sha256: null,
  provider_payload: {},
  application_version: 0,
  source_uploaded_at: new Date(Date.now() - 60_000).toISOString(),
  created_at: new Date(Date.now() - 120_000).toISOString(),
  reaped_at: null,
});

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { warn, log, error } = console;
  console.warn = () => {};
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { warn, log, error });
  }
};

Deno.test("RW1 #3040 repeated 'still missing' calls never move the wait anchor later", async () => {
  const row = jobRow();
  const db = makeFakeDb({ event_cover_video_jobs: [row] }, {
    cover_video_transition_job: transitionJobHandler,
    cover_video_apply_once: applyOnceHandler,
    cover_video_guid_live_references: () => ({ data: [], error: null }),
  });
  const body = JSON.stringify({ VideoLibraryId: 1, VideoGuid: GUID, Status: 3 });
  const call = async () => {
    let status = 0;
    await withEnv({ BUNNY_STREAM_WEBHOOK_KEY: KEY, BUNNY_STREAM_CDN_HOSTNAME: CDN }, () =>
      withFetch(cdn, async () => {
        const response = await quiet(async () =>
          handleBunnyWebhook(
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
              bunnyGetVideo: finishedVideo,
              destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
              serviceRoleClient: () => db.client as never,
              sleep: () => Promise.resolve(),
            } as never,
          )
        );
        status = response.status;
      })
    );
    return status;
  };
  assert(await call() === 503, "first sighting was not retryable");
  const anchor = row.provider_payload?.rendition_wait?.first_absent_at;
  assert(typeof anchor === "string", `no anchor: ${JSON.stringify(row.provider_payload)}`);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert(await call() === 503, "second sighting inside the window was not retryable");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert(await call() === 503, "third sighting inside the window was not retryable");
  assert(row.provider_payload?.rendition_wait?.first_absent_at === anchor,
    `the wait anchor moved: ${anchor} -> ${row.provider_payload?.rendition_wait?.first_absent_at}`);
  assert(row.status === "processing", `the job left processing inside the window: ${row.status}`);
});

Deno.test("RW2 #3040 the reaper alone finishes a missing-1080p job at 720p once the wait has passed", async () => {
  const reaper = makeReaper([jobRow()], {
    events: [{ id: "3040eeee-eeee-4eee-8eee-eeeeeeee0001", deleted_at: null, cover_media_url: null }],
    brands: [{ id: "brand-3040tw", deleted_at: null, cover_media_url: null }],
    bunnyGetVideo: finishedVideo,
  });
  const id = "3040eeee-eeee-4eee-8eee-eeeeeeee0002";
  await withEnv({ BUNNY_STREAM_WEBHOOK_KEY: KEY, BUNNY_STREAM_CDN_HOSTNAME: CDN }, () =>
    withFetch(cdn, async () => {
      await quietly(reaper.tick);
      const afterFirst = reaper.job(id);
      assert(afterFirst.status === "processing", `tick 1 moved the job to ${afterFirst.status}/${afterFirst.failure_code}`);
      const anchor = afterFirst.provider_payload?.rendition_wait?.first_absent_at;
      assert(typeof anchor === "string", `tick 1 did not start the wait: ${JSON.stringify(afterFirst.provider_payload)}`);
      // Time passes: the window (90 s) is over by the next reconcile tick.
      afterFirst.provider_payload.rendition_wait.first_absent_at = new Date(Date.now() - 91_000).toISOString();
      afterFirst.reconcile_lease_until = null;
      await quietly(reaper.tick);
      const done = reaper.job(id);
      assert(done.status === "ready", `the reaper did not finish the job: ${done.status}/${done.failure_code}`);
      assert(String(done.processed_url).endsWith("/play_720p.mp4"), `delivered ${done.processed_url}`);
      assert(done.provider_payload?.rendition_height === 720, JSON.stringify(done.provider_payload));
      assert(done.provider_payload?.rendition_fallback?.reason === "absent", JSON.stringify(done.provider_payload?.rendition_fallback));
      assert(reaper.destroyed.length === 0, `an asset was destroyed: ${reaper.destroyed.join(",")}`);
    })
  );
});
