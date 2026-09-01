// #2905 — implementor regression test: THE ENUM SEAM.
//
// The defect this pins: Bunny publishes two different numeric status enums under
// the same name, and the reconciler fed the API video-object number to a mapper
// written for the webhook number. API 4 (Finished) was read as "still encoding,
// wait for a 3 that can never come", so the reconciler could never complete a
// job; API 3 (Transcoding) was read as "ready", which would have published a
// half-encoded video.
//
// Why the pre-#2905 test could not catch it: bunnyStream.test.ts only ever
// asserted `mapBunnyStatus(n)` against the same premise the code encoded. The
// seam between `bunnyGetVideo().video.status` and the mapper was never crossed
// by a single test with real values on BOTH sides. Every assertion below starts
// from a REAL Bunny GET /library/{id}/videos/{guid} response body and ends at
// the webhook mapper, so a reverted crossing is caught at the boundary, not
// inside one enum's own vocabulary.
//
// FAILS ON REVERT: restore the crossing to pass `provider.video.status` through
// unchanged (i.e. make `bunnyApiVideoStatusAsWebhookStatus` the identity, or
// point the reconciler back at `mapBunnyStatusFromWebhook`) and the
// FINISHED-reaches-ready assertion throws — a finished asset maps to
// "processing" again.
//
// Run: deno test --allow-env --allow-net --no-check
//   supabase/functions/_shared/bunnyStream.issue2905.enum-seam.test.ts

import {
  bunnyApiVideoStatusAsWebhookStatus,
  bunnyGetVideo,
  mapBunnyStatusFromApiVideo,
  mapBunnyStatusFromWebhook,
} from "./bunnyStream.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

// The EXACT shape of the wedged production asset, read back from
// event_cover_video_jobs e055c562-ca7d-4680-a3b4-15671683e165 on 2026-09-01:
// provider_status 4 persisted together with provider_progress 100 and
// provider_payload.source_upload.storageSize 14,808,154 against a 3,050,776-byte
// source. encodeProgress 100 co-occurring with status 4 is the runtime proof
// that API status 4 is terminal. The 720p rendition genuinely 404s on the CDN
// for this asset, which is why availableResolutions stops at 480p.
const FINISHED_PRODUCTION_VIDEO = {
  guid: "fb9b25b7-df25-4e75-b41c-be8cd890e4bb",
  status: 4,
  length: 15,
  storageSize: 14808154,
  availableResolutions: "480p,360p,240p",
  encodeProgress: 100,
  outputCodecs: "x264",
  originalHash: "a".repeat(64),
} as const;

const TRANSCODING_PRODUCTION_VIDEO = {
  ...FINISHED_PRODUCTION_VIDEO,
  status: 3,
  encodeProgress: 41,
  availableResolutions: null,
  storageSize: 3050776,
} as const;

const withBunnyApi = async (
  body: Record<string, unknown>,
  fn: () => Promise<void>,
): Promise<void> => {
  const env: Record<string, string> = {
    BUNNY_STREAM_LIBRARY_ID: "696626",
    BUNNY_STREAM_API_KEY: "library-api-key",
  };
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = Deno.env.get(key);
    Deno.env.set(key, env[key]);
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    assert(
      url ===
        `https://video.bunnycdn.com/library/696626/videos/${FINISHED_PRODUCTION_VIDEO.guid}`,
      `unexpected Bunny API URL ${url}`,
    );
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(env)) {
      const prior = saved[key];
      if (prior === undefined) Deno.env.delete(key);
      else Deno.env.set(key, prior);
    }
  }
};

Deno.test("#2905 a FINISHED Bunny API video crosses the seam and reaches the webhook mapper's `ready`", async () => {
  await withBunnyApi(FINISHED_PRODUCTION_VIDEO, async () => {
    // LEFT of the seam: a real bunnyGetVideo parse of a real API response body.
    const provider = await bunnyGetVideo(FINISHED_PRODUCTION_VIDEO.guid);
    assert(provider.ok, "bunnyGetVideo must parse the production response");
    if (!provider.ok) return;
    assert(
      provider.video.status === 4 && provider.video.encodeProgress === 100,
      "fixture must carry the production status/progress pair",
    );

    // THE CROSSING: API enum → webhook enum, once, by name.
    const webhookStatus = bunnyApiVideoStatusAsWebhookStatus(
      provider.video.status,
    );
    assert(
      webhookStatus === 3,
      `API 4 Finished must cross to webhook 3 Finished, got ${
        String(webhookStatus)
      }`,
    );

    // RIGHT of the seam: the untouched webhook mapper the finalize path uses.
    assert(
      mapBunnyStatusFromWebhook(webhookStatus as number) === "ready",
      "a FINISHED Bunny asset must reach `ready` through the webhook mapper",
    );

    // And the same conclusion from the API mapper directly — the two sides of
    // the seam must never disagree about a finished asset.
    assert(
      mapBunnyStatusFromApiVideo(provider.video.status) === "ready",
      "the API mapper must call a finished asset ready",
    );

    // The shipped defect, stated as an assertion: handing the raw API number to
    // the webhook mapper reads FINISHED as still-encoding. This is the exact
    // wedge, and it must never be the path the reconciler takes.
    assert(
      mapBunnyStatusFromWebhook(provider.video.status) === "processing",
      "the raw API number fed to the webhook mapper is the #2905 wedge",
    );
    assert(
      mapBunnyStatusFromWebhook(provider.video.status) !==
        mapBunnyStatusFromApiVideo(provider.video.status),
      "the two enums disagree on 4 — that is why the crossing must be explicit",
    );
  });
});

Deno.test("#2905 a TRANSCODING Bunny API video never reaches ready (no half-encoded publish)", async () => {
  await withBunnyApi(TRANSCODING_PRODUCTION_VIDEO, async () => {
    const provider = await bunnyGetVideo(FINISHED_PRODUCTION_VIDEO.guid);
    assert(provider.ok, "bunnyGetVideo must parse the transcoding response");
    if (!provider.ok) return;
    assert(provider.video.status === 3, "fixture must be API 3 Transcoding");

    const webhookStatus = bunnyApiVideoStatusAsWebhookStatus(
      provider.video.status,
    );
    assert(
      webhookStatus === 2,
      `API 3 Transcoding must cross to webhook 2 Encoding, got ${
        String(webhookStatus)
      }`,
    );
    assert(
      mapBunnyStatusFromWebhook(webhookStatus as number) === "processing",
      "a mid-encode Bunny asset must stay `processing`",
    );

    // The other direction of the shipped defect: the raw API 3 handed to the
    // webhook mapper says READY, which would publish a half-encoded video. Only
    // the accident that the MP4/poster HEAD 503s while the derivative is absent
    // was hiding this in production.
    assert(
      mapBunnyStatusFromWebhook(provider.video.status) === "ready",
      "the raw API 3 fed to the webhook mapper is the premature-publish wedge",
    );
    assert(
      mapBunnyStatusFromApiVideo(provider.video.status) !== "ready",
      "a transcoding asset must never be called ready",
    );
  });
});

Deno.test("#2905 every API status keeps its lifecycle across the crossing", () => {
  // A total round-trip: for every API status the reconciler can observe, the
  // webhook mapper must arrive at the SAME lifecycle the API mapper does. Any
  // future edit that re-inverts a pair, or that quietly widens one enum without
  // the other, breaks here rather than in production three weeks later.
  for (const apiStatus of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const crossed = bunnyApiVideoStatusAsWebhookStatus(apiStatus);
    assert(crossed !== null, `API status ${apiStatus} must translate`);
    assert(
      mapBunnyStatusFromWebhook(crossed as number) ===
        mapBunnyStatusFromApiVideo(apiStatus),
      `API status ${apiStatus} lost its lifecycle crossing the seam`,
    );
  }
  // Exactly one API status is terminal-ready, and it is 4.
  const readyApiStatuses = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(
    (status) => mapBunnyStatusFromApiVideo(status) === "ready",
  );
  assert(
    readyApiStatuses.length === 1 && readyApiStatuses[0] === 4,
    `exactly API 4 is terminal-finished, got [${readyApiStatuses.join(",")}]`,
  );
  // Exactly one WEBHOOK status is terminal-ready, and it is 3. Eight production
  // rows of provider_payload.bunny_webhook prove it.
  const readyWebhookStatuses = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(
    (status) => mapBunnyStatusFromWebhook(status) === "ready",
  );
  assert(
    readyWebhookStatuses.length === 1 && readyWebhookStatuses[0] === 3,
    `exactly webhook 3 is Finished, got [${readyWebhookStatuses.join(",")}]`,
  );
  // An unknown provider number is never laundered into a lifecycle-bearing body.
  assert(
    bunnyApiVideoStatusAsWebhookStatus(99) === null,
    "an unknown API status must not synthesize a webhook status",
  );
});
