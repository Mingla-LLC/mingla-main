// META-ORCH-1270 (Phase 1) — implementor happy-path test: the Bunny library
// webhook drives a processing job to `ready` via the REUSED provider-agnostic
// core (assertProcessedDerivative + eventCoverVideoReadyUpdate). A signed
// {VideoGuid, Status:3} finds the job by source_asset_id, picks the best <=720p
// MP4, HEAD-confirms its bytes, and writes processed_url + processed_bytes.
//
// FAILS ON REVERT: delete the Bunny dispatch/branch and the handler runs the
// Cloudinary path (no bunny job lookup / no ready write) → the ready assertions
// throw. Also asserts the idempotent unknown-guid ignore.
//
// Run: deno test --allow-env --allow-net --no-check
//   supabase/functions/event-cover-video-webhook/__tests__/bunny-webhook.test.ts

import { handleEventCoverVideoWebhook } from "../index.ts";
import { hmacSha256Hex } from "../../_shared/bunnyStream.ts";

const JOB_ID = "dde19eac-9810-4e0d-b8f6-63fe235fc5af";
const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const VIDEO_GUID = "bunny-video-guid-777";
const WEBHOOK_KEY = "bunny-readonly-webhook-signing-input";
const CDN_HOST = "vz-unit-test.b-cdn.net";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const withBunnyEnv = async (fn: () => Promise<void>): Promise<void> => {
  const env: Record<string, string> = {
    EVENT_COVER_VIDEO_PROVIDER: "bunny",
    BUNNY_STREAM_WEBHOOK_KEY: WEBHOOK_KEY,
    BUNNY_STREAM_LIBRARY_ID: "778899",
    BUNNY_STREAM_API_KEY: "bunny-library-api-key",
    BUNNY_STREAM_CDN_HOSTNAME: CDN_HOST,
  };
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

type UpdateCall = { payload: Record<string, unknown>; eqColumn?: string; eqValue?: unknown };

const createSupabaseStub = (options: { existingJob: Record<string, unknown> | null }) => {
  const updates: UpdateCall[] = [];
  const client = {
    from: (_table: string) => ({
      select: () => ({
        eq: (_column: string, _value: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: options.existingJob, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        const call: UpdateCall = { payload };
        updates.push(call);
        const result = { data: null, error: null };
        return {
          eq: (column: string, value: unknown) => {
            call.eqColumn = column;
            call.eqValue = value;
            return {
              then: (resolve: (value: typeof result) => unknown) =>
                Promise.resolve(result).then(resolve),
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: JOB_ID,
                      event_id: EVENT_ID,
                      target_kind: "event",
                      apply_mode: "published_manual",
                    },
                    error: null,
                  }),
              }),
            };
          },
        };
      },
    }),
  };
  return { client, updates };
};

const bunnyVideo = {
  guid: VIDEO_GUID,
  status: 3,
  length: 12,
  storageSize: 8_000_000,
  availableResolutions: "720p,480p",
  encodeProgress: 100,
};

const createDeps = (stub: ReturnType<typeof createSupabaseStub>) =>
  ({
    bunnyGetVideo: () => Promise.resolve({ ok: true as const, video: bunnyVideo }),
    destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
    serviceRoleClient: () => stub.client,
    verifyWebhook: () => Promise.resolve({ ok: true as const }),
  }) as never;

const makeSignedRequest = async (payload: Record<string, unknown>): Promise<Request> => {
  const rawBody = JSON.stringify(payload);
  return new Request("https://example.test/functions/v1/event-cover-video-webhook", {
    body: rawBody,
    headers: {
      "Content-Type": "application/json",
      "x-bunnystream-signature": await hmacSha256Hex(WEBHOOK_KEY, rawBody),
      // META-ORCH-1270 — Bunny's confirmed v1 signing envelope headers.
      "x-bunnystream-signature-version": "v1",
      "x-bunnystream-signature-algorithm": "hmac-sha256",
    },
    method: "POST",
  });
};

// META-ORCH-1270 — build a raw-body POST with an arbitrary header set (the
// signed-envelope cases need explicit control over the version/algorithm/sig).
const buildRequest = (rawBody: string, headers: Record<string, string>): Request =>
  new Request("https://example.test/functions/v1/event-cover-video-webhook", {
    body: rawBody,
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });

const processingJob = (): Record<string, unknown> => ({
  id: JOB_ID,
  status: "processing",
  event_id: EVENT_ID,
  target_kind: "event",
  apply_mode: "published_manual",
  trim_start_ms: 0,
  trim_end_ms: 12_000,
  provider: "bunny",
  source_public_id: null,
  source_asset_id: VIDEO_GUID,
  provider_payload: { bunny: { videoId: VIDEO_GUID } },
});

Deno.test("bunny webhook Finished (Status 3) drives the job to ready via the shared core", async () => {
  await withBunnyEnv(async () => {
    const originalFetch = globalThis.fetch;
    // HEAD of the delivery MP4 returns its byte size.
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "8000000" }),
      } as unknown as Response)) as typeof fetch;
    const stub = createSupabaseStub({
      existingJob: {
        id: JOB_ID,
        status: "processing",
        event_id: EVENT_ID,
        target_kind: "event",
        apply_mode: "published_manual",
        trim_start_ms: 0,
        trim_end_ms: 12_000,
        provider: "bunny",
        source_public_id: null,
        source_asset_id: VIDEO_GUID,
        provider_payload: { bunny: { videoId: VIDEO_GUID } },
      },
    });
    try {
      const response = await handleEventCoverVideoWebhook(
        await makeSignedRequest({ VideoLibraryId: 778899, VideoGuid: VIDEO_GUID, Status: 3 }),
        createDeps(stub),
      );
      const body = await response.json() as Record<string, unknown>;
      assert(response.status === 200, `expected 200, received ${response.status}`);
      assert(body.ok === true, "expected ok:true");

      const ready = stub.updates.find((call) => call.payload.status === "ready");
      assert(ready !== undefined, "expected a ready update via eventCoverVideoReadyUpdate");
      assert(
        ready?.payload.processed_url === `https://${CDN_HOST}/${VIDEO_GUID}/play_720p.mp4`,
        `expected processed_url to be the 720p delivery MP4, got ${String(ready?.payload.processed_url)}`,
      );
      assert(ready?.payload.processed_bytes === 8_000_000, "expected processed_bytes from the HEAD content-length");
      assert(ready?.payload.processed_mime_type === "video/mp4", "expected processed_mime_type video/mp4");
      const payload = ready?.payload.provider_payload as { bunny_thumbnail?: unknown };
      assert(
        payload?.bunny_thumbnail === `https://${CDN_HOST}/${VIDEO_GUID}/thumbnail.jpg`,
        "expected the Bunny thumbnail poster in provider_payload",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("bunny webhook for an unknown VideoGuid is idempotently ignored (200, no 500)", async () => {
  await withBunnyEnv(async () => {
    const stub = createSupabaseStub({ existingJob: null });
    const response = await handleEventCoverVideoWebhook(
      await makeSignedRequest({ VideoLibraryId: 778899, VideoGuid: "foreign-guid", Status: 3 }),
      createDeps(stub),
    );
    const body = await response.json() as Record<string, unknown>;
    assert(response.status === 200, `expected 200 for a foreign video, received ${response.status}`);
    assert(body.ignored === "unknown_guid", "expected unknown_guid ignore");
    assert(stub.updates.length === 0, "no job state change for a foreign video");
  });
});

// META-ORCH-1270 — Bunny's confirmed v1 signing envelope: a signed POST carries
// X-BunnyStream-Signature-Version=v1 + X-BunnyStream-Signature-Algorithm=hmac-sha256
// alongside the HMAC. A present signature with a wrong/missing envelope is a hard
// 403 (never silently accepted). FAILS ON REVERT: delete the version/algorithm
// checks in verifyBunnyWebhookSignature and the v2 / md5 requests pass verify →
// the handler returns 200 (unknown_guid) instead of 403, so these assertions throw.

Deno.test("bunny webhook with a valid v1 + hmac-sha256 envelope + correct signature is accepted", async () => {
  await withBunnyEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "8000000" }),
      } as unknown as Response)) as typeof fetch;
    const stub = createSupabaseStub({ existingJob: processingJob() });
    try {
      const rawBody = JSON.stringify({ VideoLibraryId: 778899, VideoGuid: VIDEO_GUID, Status: 3 });
      const response = await handleEventCoverVideoWebhook(
        buildRequest(rawBody, {
          "x-bunnystream-signature": await hmacSha256Hex(WEBHOOK_KEY, rawBody),
          "x-bunnystream-signature-version": "v1",
          "x-bunnystream-signature-algorithm": "hmac-sha256",
        }),
        createDeps(stub),
      );
      const body = await response.json() as Record<string, unknown>;
      assert(response.status === 200, `expected 200 for a valid v1 envelope, received ${response.status}`);
      assert(body.ok === true, "expected ok:true for the valid v1 envelope");
      assert(stub.updates.some((call) => call.payload.status === "ready"), "expected a ready update");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("bunny webhook with a correct signature but version != v1 is rejected 403", async () => {
  await withBunnyEnv(async () => {
    const stub = createSupabaseStub({ existingJob: processingJob() });
    const rawBody = JSON.stringify({ VideoLibraryId: 778899, VideoGuid: VIDEO_GUID, Status: 3 });
    const response = await handleEventCoverVideoWebhook(
      buildRequest(rawBody, {
        "x-bunnystream-signature": await hmacSha256Hex(WEBHOOK_KEY, rawBody),
        "x-bunnystream-signature-version": "v2",
        "x-bunnystream-signature-algorithm": "hmac-sha256",
      }),
      createDeps(stub),
    );
    const body = await response.json() as Record<string, unknown>;
    assert(response.status === 403, `expected 403 for version!=v1, received ${response.status}`);
    assert(
      body.detail === "unsupported_signature_version",
      `expected unsupported_signature_version, got ${String(body.detail)}`,
    );
    assert(!stub.updates.some((call) => call.payload.status === "ready"), "no ready write on a rejected envelope");
  });
});

Deno.test("bunny webhook with a correct signature but algorithm != hmac-sha256 is rejected 403", async () => {
  await withBunnyEnv(async () => {
    const stub = createSupabaseStub({ existingJob: processingJob() });
    const rawBody = JSON.stringify({ VideoLibraryId: 778899, VideoGuid: VIDEO_GUID, Status: 3 });
    const response = await handleEventCoverVideoWebhook(
      buildRequest(rawBody, {
        "x-bunnystream-signature": await hmacSha256Hex(WEBHOOK_KEY, rawBody),
        "x-bunnystream-signature-version": "v1",
        "x-bunnystream-signature-algorithm": "sha256",
      }),
      createDeps(stub),
    );
    const body = await response.json() as Record<string, unknown>;
    assert(response.status === 403, `expected 403 for algorithm!=hmac-sha256, received ${response.status}`);
    assert(
      body.detail === "unsupported_signature_algorithm",
      `expected unsupported_signature_algorithm, got ${String(body.detail)}`,
    );
    assert(!stub.updates.some((call) => call.payload.status === "ready"), "no ready write on a rejected envelope");
  });
});

Deno.test("bunny webhook with an ABSENT signature still authenticates via the bunnyGetVideo re-fetch fallback", async () => {
  await withBunnyEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "8000000" }),
      } as unknown as Response)) as typeof fetch;
    const stub = createSupabaseStub({ existingJob: processingJob() });
    try {
      const rawBody = JSON.stringify({ VideoLibraryId: 778899, VideoGuid: VIDEO_GUID, Status: 3 });
      // No signature/version/algorithm headers at all → unsigned webhook path.
      const response = await handleEventCoverVideoWebhook(
        buildRequest(rawBody, {}),
        createDeps(stub),
      );
      const body = await response.json() as Record<string, unknown>;
      assert(response.status === 200, `expected 200 via the re-fetch fallback, received ${response.status}`);
      assert(body.ok === true, "expected ok:true from the unsigned-webhook re-fetch fallback");
      assert(stub.updates.some((call) => call.payload.status === "ready"), "expected a ready update via fallback");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
