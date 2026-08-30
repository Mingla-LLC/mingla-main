// META-ORCH-1270 (Phase 1) — implementor happy-path test: upload-intent Bunny
// provider dispatch. With EVENT_COVER_VIDEO_PROVIDER=bunny the handler creates a
// Bunny video, stamps provider="bunny" + source_asset_id=guid, and returns a TUS
// descriptor whose AuthorizationSignature is the verbatim SHA-256 recipe — with
// NO AccessKey/library API key in the client-facing response.
//
// FAILS ON REVERT: delete the Bunny branch in index.ts and the handler falls
// through to the Cloudinary path → `upload.protocol` is undefined and the guid
// is never persisted → the assertions below throw.
//
// Run: deno test --allow-env --allow-net --no-check
//   supabase/functions/event-cover-video-upload-intent/__tests__/bunny-provider.test.ts

import { handleEventCoverVideoUploadIntent } from "../index.ts";
import { bunnyPresignTusUpload, sha256Hex } from "../../_shared/bunnyStream.ts";

const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const BUNNY_GUID = "bunny-guid-abcdef";
const LIBRARY_ID = "778899";
const API_KEY = "bunny-library-api-key-secret";
const CDN_HOST = "vz-unit-test.b-cdn.net";
const OPERATION_ID = "33a18413-bfbf-4087-9ba7-45f70deba0f3";
const SOURCE_SHA256 = "a".repeat(64);

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const withBunnyEnv = async (fn: () => Promise<void>): Promise<void> => {
  const env: Record<string, string> = {
    EVENT_COVER_VIDEO_PROVIDER: "bunny",
    BUNNY_STREAM_LIBRARY_ID: LIBRARY_ID,
    BUNNY_STREAM_API_KEY: API_KEY,
    BUNNY_STREAM_CDN_HOSTNAME: CDN_HOST,
    SUPABASE_URL: "https://example.supabase.co",
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

type Captured = {
  insert?: Record<string, unknown>;
  bunnyUpdate?: Record<string, unknown>;
};

const createSupabaseStub = (captured: Captured) => {
  const updateResult = { error: null };
  const eqResult = {
    not: () => Promise.resolve(updateResult),
    then: (resolve: (value: typeof updateResult) => unknown) =>
      Promise.resolve(updateResult).then(resolve),
  };
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      const job = {
        id: "job_bunny",
        status: "source_uploading",
        source_bytes: 289_420,
        source_asset_id: null,
        tus_resource_url: null,
        tus_upload_offset: 0,
      };
      if (name === "cover_video_create_or_replay_job") {
        captured.insert = args;
        return Promise.resolve({
          data: args.p_accept_new === false ? null : job,
          error: null,
        });
      }
      if (name === "cover_video_claim_provider_allocation") {
        return Promise.resolve({
          data: { ...job, provider_allocation_token: "lease" },
          error: null,
        });
      }
      // [TEST-MOD-APPROVED #2715 A15] Fixture-only durable uncertainty claim.
      if (name === "cover_video_begin_provider_create") {
        return Promise.resolve({
          data: {
            ...job,
            provider_allocation_token: "lease",
            provider_allocation_identity: job.id,
            provider_allocation_uncertain_at: new Date().toISOString(),
          },
          error: null,
        });
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        return Promise.resolve({
          data: {
            ...job,
            source_asset_id: BUNNY_GUID,
            provider_allocation_token: "lease",
          },
          error: null,
        });
      }
      if (name === "cover_video_commit_provider_allocation") {
        captured.bunnyUpdate = args;
        return Promise.resolve({
          data: {
            ...job,
            source_asset_id: BUNNY_GUID,
            tus_resource_url: "https://video.bunnycdn.com/tusupload/resource",
          },
          error: null,
        });
      }
      throw new Error(`Unexpected rpc ${name}`);
    },
  };
};

const createDeps = (captured: Captured) => ({
  bunnyCreateVideo: () =>
    Promise.resolve({ ok: true as const, guid: BUNNY_GUID }),
  bunnyPresignTusUpload,
  checkBunnyCapacity: () =>
    Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
  destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
  providerConfigured: () => true,
  requireBrandCoverManager: () => Promise.resolve({ brandId: BRAND_ID }),
  requireEventManager: () =>
    Promise.resolve({
      event: { brand_id: BRAND_ID, id: EVENT_ID, status: "published" },
    }),
  requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
  requireUserId: () => Promise.resolve("44a18413-bfbf-4087-9ba7-45f70deba0f3"),
  serviceRoleClient: () => createSupabaseStub(captured),
});

const makeRequest = (withIdentity = true): Request =>
  new Request(
    "https://example.test/functions/v1/event-cover-video-upload-intent",
    {
      body: JSON.stringify({
        applyMode: "published_manual",
        brandId: BRAND_ID,
        eventId: EVENT_ID,
        // [TEST-MOD-APPROVED #2715 A9] Immutable identity fixture required to
        // reach the preserved Bunny descriptor/provider assertions.
        ...(withIdentity
          ? {
            clientOperationId: OPERATION_ID,
            sourceSha256: SOURCE_SHA256,
            sourceExtension: "mp4",
            sourceFileName: "cover.mp4",
          }
          : {}),
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

Deno.test("upload-intent routes to Bunny: TUS descriptor + persisted guid + provider=bunny", async () => {
  await withBunnyEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {
          status: 201,
          headers: { location: "/tusupload/resource" },
        }),
      )) as typeof fetch;
    const captured: Captured = {};
    const response = await handleEventCoverVideoUploadIntent(
      makeRequest(),
      createDeps(captured) as never,
    );
    const body = await response.json();

    assert(
      response.status === 200,
      `expected 200, received ${response.status}: ${JSON.stringify(body)}`,
    );
    assert(
      body.provider === "bunny",
      `expected provider bunny, got ${String(body.provider)}`,
    );
    assert(
      body.upload?.protocol === "tus",
      `expected upload.protocol tus, got ${String(body.upload?.protocol)}`,
    );
    assert(
      body.upload?.url === "https://video.bunnycdn.com/tusupload/resource",
      `expected the TUS endpoint, got ${String(body.upload?.url)}`,
    );
    assert(
      body.upload?.videoId === BUNNY_GUID,
      "expected the videoId to be the guid",
    );

    // The signature is the verbatim SHA-256 recipe over the SAME expiry returned.
    const expire = body.upload?.fields?.AuthorizationExpire;
    const expected = await sha256Hex(
      `${LIBRARY_ID}${API_KEY}${expire}${BUNNY_GUID}`,
    );
    assert(
      body.upload?.fields?.AuthorizationSignature === expected,
      "AuthorizationSignature must equal sha256Hex(lib+key+expire+guid)",
    );
    assert(
      body.upload?.fields?.LibraryId === LIBRARY_ID,
      "LibraryId header present",
    );
    assert(
      body.upload?.fields?.VideoId === BUNNY_GUID,
      "VideoId header present",
    );

    // I-MOR-1270-NO-ACCESSKEY-IN-CLIENT: no library API key / AccessKey leaks.
    const serialized = JSON.stringify(body);
    assert(
      !serialized.includes(API_KEY),
      "the Bunny API key must NEVER appear in the response",
    );
    assert(
      !serialized.includes("AccessKey"),
      "no AccessKey header in the client response",
    );

    // Persistence: provider=bunny on insert, guid stored in source_asset_id.
    assert(
      captured.insert?.p_provider === "bunny",
      "job row stamped provider=bunny",
    );
    assert(
      captured.bunnyUpdate?.p_source_asset_id === BUNNY_GUID,
      "guid stored in source_asset_id",
    );
    globalThis.fetch = originalFetch;
  });
});

Deno.test("#2715 missing immutable identity returns 426 before provider allocation", async () => {
  let creates = 0;
  const captured: Captured = {};
  const deps = createDeps(captured);
  const response = await handleEventCoverVideoUploadIntent(
    makeRequest(false),
    {
      ...deps,
      bunnyCreateVideo: () => {
        creates += 1;
        return Promise.resolve({ ok: true as const, guid: BUNNY_GUID });
      },
    } as never,
  );
  assert(response.status === 426, `expected 426, got ${response.status}`);
  assert(creates === 0, "provider allocated without identity");
  assert(captured.insert === undefined, "job created without identity");
});
