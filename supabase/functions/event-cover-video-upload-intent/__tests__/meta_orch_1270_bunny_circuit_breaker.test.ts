// META-ORCH-1270 (Phase 2) — implementor test: pre-upload circuit-breaker.
//
// Two proofs:
//   1) evaluateCapacityBreaker — pure threshold: >=cap fails CLOSED, under-cap
//      passes, and an UNREADABLE usage (null) FAILS OPEN (a Bunny read outage
//      must not wedge all uploads).
//   2) handler — at/over the hard cap, upload-intent returns 503
//      {error:"capacity_reached"} and NEVER calls bunnyCreateVideo (no upload is
//      signed).
//
// FAILS ON REVERT: delete the capacity-check block in index.ts → the handler
// proceeds to create a Bunny video → status is not 503 / createCalled is true →
// the assertions throw.
//
// Run: deno test --allow-env --no-check
//   supabase/functions/event-cover-video-upload-intent/__tests__/meta_orch_1270_bunny_circuit_breaker.test.ts

import {
  evaluateCapacityBreaker,
  handleEventCoverVideoUploadIntent,
} from "../index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const OPERATION_ID = "33a18413-bfbf-4087-9ba7-45f70deba0f3";

Deno.test("evaluateCapacityBreaker: >= hard cap fails CLOSED", () => {
  assert(
    evaluateCapacityBreaker(90, 90).blocked === true,
    "90 >= 90 → blocked",
  );
  assert(
    evaluateCapacityBreaker(95, 90).blocked === true,
    "95 >= 90 → blocked",
  );
  assert(
    evaluateCapacityBreaker(90, 90).reason === "capacity_reached",
    "reason capacity_reached",
  );
});

Deno.test("evaluateCapacityBreaker: under cap passes", () => {
  const r = evaluateCapacityBreaker(50, 90);
  assert(r.blocked === false, "50 < 90 → not blocked");
  assert(r.reason === "under_cap", "reason under_cap");
});

Deno.test("evaluateCapacityBreaker: unreadable usage (null) FAILS OPEN", () => {
  const r = evaluateCapacityBreaker(null, 90);
  assert(r.blocked === false, "null usage must NOT block (fail-open)");
  assert(
    r.reason === "usage_unreadable_fail_open",
    "reason documents the fail-open",
  );
});

const withBunnyEnv = async (fn: () => Promise<void>): Promise<void> => {
  const env: Record<string, string> = { EVENT_COVER_VIDEO_PROVIDER: "bunny" };
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

const makeRequest = (): Request =>
  new Request(
    "https://example.test/functions/v1/event-cover-video-upload-intent",
    {
      body: JSON.stringify({
        applyMode: "published_manual",
        brandId: BRAND_ID,
        eventId: EVENT_ID,
        // [TEST-MOD-APPROVED #2715 A9] Supply mandatory immutable identity so
        // this test continues to isolate capacity behavior, not the 426 gate.
        clientOperationId: OPERATION_ID,
        sourceFileName: "cover.mp4",
        sourceExtension: "mp4",
        sourceSha256: "b".repeat(64),
        sourceBytes: 289_420,
        sourceDurationMs: 12_000,
        sourceMimeType: "video/mp4",
        trimEndMs: 12_000,
        trimStartMs: 0,
      }),
      headers: {
        Authorization: "Bearer user-session-jwt",
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

Deno.test("upload-intent: at the hard cap → 503 capacity_reached, no video created", async () => {
  await withBunnyEnv(async () => {
    let createCalled = false;
    const deps = {
      bunnyCreateVideo: () => {
        createCalled = true;
        return Promise.resolve({
          ok: true as const,
          guid: "should-not-happen",
        });
      },
      bunnyPresignTusUpload: () =>
        Promise.resolve({
          tusEndpoint: "x",
          libraryId: "x",
          videoId: "x",
          authorizationSignature: "x",
          authorizationExpire: 0,
        }),
      checkBunnyCapacity: () =>
        Promise.resolve({
          blocked: true,
          reason: "capacity_reached",
          usedPercent: 95,
        }),
      cloudinarySignature: () => Promise.resolve("unused"),
      providerConfigured: () => true,
      reapSupersededBunnyAssets: () => Promise.resolve(),
      requireBrandCoverManager: () => Promise.resolve({ brandId: BRAND_ID }),
      requireEventManager: () =>
        Promise.resolve({
          event: { brand_id: BRAND_ID, id: EVENT_ID, status: "published" },
        }),
      requireUserId: () => Promise.resolve("user_123"),
      requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
      // [TEST-MOD-APPROVED #2715 A9] The capacity proof crosses the mandatory
      // identity/create bridge before it reaches the provider capacity check.
      serviceRoleClient: () => ({
        rpc: (name: string, args: Record<string, unknown>) => {
          if (name !== "cover_video_create_or_replay_job") {
            throw new Error(`unexpected rpc ${name}`);
          }
          // [TEST-MOD-APPROVED #2715 A9] A genuine new operation probes without
          // mutation, so capacity rejects before the accepting/superseding call.
          return Promise.resolve({
            data: args.p_accept_new === false ? null : {
              id: "job_capacity",
              status: "source_uploading",
              source_asset_id: null,
              tus_resource_url: null,
              tus_upload_offset: 0,
            },
            error: null,
          });
        },
      }),
    };
    const response = await handleEventCoverVideoUploadIntent(
      makeRequest(),
      deps as never,
    );
    const body = await response.json();
    assert(
      response.status === 503,
      `expected 503, got ${response.status}: ${JSON.stringify(body)}`,
    );
    assert(
      body.error === "capacity_reached",
      `expected error capacity_reached, got ${String(body.error)}`,
    );
    assert(
      createCalled === false,
      "bunnyCreateVideo must NOT be called when at capacity",
    );
  });
});
