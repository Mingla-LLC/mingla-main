// META-ORCH-1270 (Phase 1) — implementor happy-path unit tests for bunnyStream.ts.
// Covers the TUS signature recipe, status mapping, webhook HMAC verify, and the
// URL builders / best-MP4 picker. Each assertion FAILS ON REVERT of the helper
// it exercises (delete the recipe / mapping / verify and the test throws).
//
// Run: deno test --allow-env --allow-net --no-check supabase/functions/_shared/bunnyStream.test.ts

import {
  bunnyBestMp4,
  bunnyPlayUrl,
  bunnyPresignTusUpload,
  bunnyThumbnailUrl,
  bunnyApiVideoStatusAsWebhookStatus,
  hmacSha256Hex,
  mapBunnyStatusFromApiVideo,
  mapBunnyStatusFromWebhook,
  sha256Hex,
  verifyBunnyWebhookSignature,
  type BunnyVideo,
} from "./bunnyStream.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const withEnv = async (
  env: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> => {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = Deno.env.get(key);
    Deno.env.set(key, env[key]);
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(env)) {
      const prior = saved[key];
      if (prior === undefined) Deno.env.delete(key);
      else Deno.env.set(key, prior);
    }
  }
};

const makeVideo = (overrides: Partial<BunnyVideo> = {}): BunnyVideo => ({
  guid: "vid-guid",
  status: 3,
  length: 12,
  storageSize: 8_000_000,
  availableResolutions: "720p,480p",
  encodeProgress: 100,
  ...overrides,
});

Deno.test("TUS presign signature = sha256Hex(libraryId + apiKey + expire + videoId)", async () => {
  await withEnv(
    { BUNNY_STREAM_LIBRARY_ID: "12345", BUNNY_STREAM_API_KEY: "lib-api-key" },
    async () => {
      const guid = "abcd-1234-guid";
      const presign = await bunnyPresignTusUpload(guid);
      assert(presign.tusEndpoint === "https://video.bunnycdn.com/tusupload", "tus endpoint");
      assert(presign.libraryId === "12345", "library id echoed");
      assert(presign.videoId === guid, "videoId echoed");
      const expected = await sha256Hex(`12345lib-api-key${presign.authorizationExpire}${guid}`);
      assert(
        presign.authorizationSignature === expected,
        `signature must equal the verbatim SHA-256 recipe (got ${presign.authorizationSignature})`,
      );
      // Expiry is UNIX seconds in the near future (~1h), not milliseconds.
      const nowSeconds = Math.floor(Date.now() / 1000);
      assert(
        presign.authorizationExpire > nowSeconds && presign.authorizationExpire <= nowSeconds + 3601,
        "expire must be UNIX seconds ~1h out",
      );
    },
  );
});

// [TEST-MOD-APPROVED #2905] Rename only — `mapBunnyStatus` became
// `mapBunnyStatusFromWebhook` because Bunny publishes TWO numeric status enums
// under the same name and this one is the WEBHOOK enum. Every assertion below
// keeps its original expected value: 17 production rows prove real Bunny
// webhooks send Status 3 on finish, so this mapping is correct and must not
// change. Only the misleading comment on case 4 is corrected — it is
// ResolutionFinished in the WEBHOOK enum, which is genuinely not terminal there.
Deno.test("mapBunnyStatusFromWebhook maps the documented Bunny WEBHOOK status enum", () => {
  assert(mapBunnyStatusFromWebhook(0) === "processing", "0 Queued → processing");
  assert(mapBunnyStatusFromWebhook(1) === "processing", "1 Processing → processing");
  assert(mapBunnyStatusFromWebhook(2) === "processing", "2 Encoding → processing");
  assert(mapBunnyStatusFromWebhook(3) === "ready", "webhook 3 Finished → ready");
  assert(
    mapBunnyStatusFromWebhook(4) === "processing",
    "webhook 4 ResolutionFinished → processing (the webhook stream still owes a 3)",
  );
  assert(mapBunnyStatusFromWebhook(5) === "failed", "5 Failed → failed");
  assert(mapBunnyStatusFromWebhook(6) === "ignore", "6+ → ignore");
  assert(mapBunnyStatusFromWebhook(99) === "ignore", "unknown → ignore");
});

// [TEST-MOD-APPROVED #2905] The API video-object enum is a DIFFERENT enum and
// gets its own mapper. 3 and 4 are inverted relative to the webhook enum above;
// asserting both in one file is the point — the seam is visible here.
Deno.test("mapBunnyStatusFromApiVideo maps the Bunny API VIDEO-OBJECT status enum", () => {
  assert(mapBunnyStatusFromApiVideo(0) === "processing", "0 Created → processing");
  assert(mapBunnyStatusFromApiVideo(1) === "processing", "1 Uploaded → processing");
  assert(mapBunnyStatusFromApiVideo(2) === "processing", "2 Processing → processing");
  assert(
    mapBunnyStatusFromApiVideo(3) === "processing",
    "api 3 Transcoding → processing (NOT ready — the webhook enum's 3 is finished)",
  );
  assert(
    mapBunnyStatusFromApiVideo(4) === "ready",
    "api 4 Finished → ready (NOT processing — this is the #2905 wedge)",
  );
  assert(mapBunnyStatusFromApiVideo(5) === "failed", "5 Error → failed");
  assert(mapBunnyStatusFromApiVideo(6) === "failed", "6 UploadFailed → failed");
  assert(mapBunnyStatusFromApiVideo(7) === "processing", "7 JitSegmenting → processing");
  assert(mapBunnyStatusFromApiVideo(8) === "processing", "8 JitPlaylistsCreated → processing");
  assert(mapBunnyStatusFromApiVideo(99) === "ignore", "unknown → ignore");
});

// [TEST-MOD-APPROVED #2905] The one sanctioned crossing, asserted end to end:
// an API number in, the equivalent WEBHOOK number out, and the webhook mapper
// agreeing on the lifecycle. This is the assertion whose absence let #2905 ship.
Deno.test("bunnyApiVideoStatusAsWebhookStatus crosses the two enums without inverting them", () => {
  assert(bunnyApiVideoStatusAsWebhookStatus(4) === 3, "api 4 Finished → webhook 3 Finished");
  assert(bunnyApiVideoStatusAsWebhookStatus(3) === 2, "api 3 Transcoding → webhook 2 Encoding");
  assert(bunnyApiVideoStatusAsWebhookStatus(5) === 5, "api 5 Error → webhook 5 Failed");
  assert(bunnyApiVideoStatusAsWebhookStatus(99) === null, "unknown api status is never laundered");
  for (const apiStatus of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const crossed = bunnyApiVideoStatusAsWebhookStatus(apiStatus);
    assert(crossed !== null, `api ${apiStatus} must translate`);
    assert(
      mapBunnyStatusFromWebhook(crossed as number) === mapBunnyStatusFromApiVideo(apiStatus),
      `api ${apiStatus} lost its lifecycle crossing the enum seam`,
    );
  }
});

Deno.test("verifyBunnyWebhookSignature accepts a valid HMAC and rejects tampering", async () => {
  const secret = "bunny-webhook-signing-input";
  const rawBody = '{"VideoLibraryId":12345,"VideoGuid":"vid-guid","Status":3}';
  const signature = await hmacSha256Hex(secret, rawBody);

  const ok = await verifyBunnyWebhookSignature({ rawBody, signatureHeader: signature, secret });
  assert(ok.ok, "expected the valid HMAC to pass");

  const wrong = await verifyBunnyWebhookSignature({
    rawBody,
    signatureHeader: "deadbeef",
    secret,
  });
  assert(!wrong.ok && wrong.code === "invalid_signature" && wrong.status === 403, "wrong sig → 403");

  const missing = await verifyBunnyWebhookSignature({ rawBody, signatureHeader: null, secret });
  assert(!missing.ok && missing.code === "missing_signature" && missing.status === 403, "no header → 403");

  const noSecret = await verifyBunnyWebhookSignature({ rawBody, signatureHeader: signature, secret: "" });
  assert(!noSecret.ok && noSecret.code === "missing_webhook_secret" && noSecret.status === 500, "no secret → 500");

  // A body edit invalidates the signature (tamper detection).
  const tampered = await verifyBunnyWebhookSignature({
    rawBody: rawBody.replace('"Status":3', '"Status":5'),
    signatureHeader: signature,
    secret,
  });
  assert(!tampered.ok && tampered.code === "invalid_signature", "tampered body → invalid");
});

Deno.test("URL builders + best-MP4 picker resolve the pull-zone CDN host", () => {
  const guid = "vid-guid";
  const run = () => {
    assert(
      bunnyThumbnailUrl(guid) === "https://vz-test-1.b-cdn.net/vid-guid/thumbnail.jpg",
      "thumbnail URL",
    );
    assert(
      bunnyPlayUrl(guid, 720) === "https://vz-test-1.b-cdn.net/vid-guid/play_720p.mp4",
      "play URL",
    );
    const best = bunnyBestMp4(makeVideo({ availableResolutions: "720p,480p,360p" }));
    assert(best !== null && best.heightP === 720, "picks the highest <=720");
    assert(
      best !== null && best.url === "https://vz-test-1.b-cdn.net/vid-guid/play_720p.mp4",
      "best URL points at the 720p rendition",
    );
    // Above-720 renditions are excluded (MP4 fallback caps at 720p).
    assert(bunnyBestMp4(makeVideo({ availableResolutions: "1080p" })) === null, "1080p only → null");
    // Missing rendition list → fail closed (null).
    assert(bunnyBestMp4(makeVideo({ availableResolutions: null })) === null, "null resolutions → null");
    // A 480-only video picks 480.
    const midBest = bunnyBestMp4(makeVideo({ availableResolutions: "480p,360p" }));
    assert(midBest !== null && midBest.heightP === 480, "picks 480 when 720 absent");
  };
  const saved = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME");
  Deno.env.set("BUNNY_STREAM_CDN_HOSTNAME", "vz-test-1.b-cdn.net");
  try {
    run();
  } finally {
    if (saved === undefined) Deno.env.delete("BUNNY_STREAM_CDN_HOSTNAME");
    else Deno.env.set("BUNNY_STREAM_CDN_HOSTNAME", saved);
  }
});
