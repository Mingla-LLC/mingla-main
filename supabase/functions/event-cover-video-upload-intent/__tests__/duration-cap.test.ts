// [TEST-MOD-APPROVED #2715 A8] Exact 15-second server contract. Restoring the
// former 33-second ceiling or trim clamping makes these executable proofs fail.
import {
  handleEventCoverVideoUploadIntent,
  SOURCE_CEILING_MS,
} from "../index.ts";

const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const OP_ID = "33a18413-bfbf-4087-9ba7-45f70deba0f3";
const SHA = "a".repeat(64);
type Input = {
  sourceDurationMs: number;
  trimEndMs?: number;
  trimStartMs?: number;
};
type Capture = { rpc?: Record<string, unknown>; allocations: number };

const makeRequest = (body: Input) =>
  new Request(
    "https://example.test/functions/v1/event-cover-video-upload-intent",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        applyMode: "published_manual",
        brandId: BRAND_ID,
        eventId: EVENT_ID,
        clientOperationId: OP_ID,
        sourceBytes: 289420,
        sourceDurationMs: body.sourceDurationMs,
        trimEndMs: body.trimEndMs ?? body.sourceDurationMs,
        trimStartMs: body.trimStartMs ?? 0,
        sourceFileName: "cover.mp4",
        sourceMimeType: "video/mp4",
        sourceExtension: "mp4",
        sourceSha256: SHA,
      }),
    },
  );

const createHarness = (capture: Capture) => {
  const job = {
    id: "job_source_ceiling",
    status: "source_uploading",
    source_bytes: 289420,
    source_asset_id: null,
    tus_resource_url: null,
    tus_upload_offset: 0,
  };
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        capture.rpc = args;
        return Promise.resolve({
          data: args.p_accept_new === false ? null : job,
          error: null,
        });
      }
      if (name === "cover_video_claim_provider_allocation") {
        return Promise.resolve({
          data: { ...job, provider_allocation_token: "lease-token" },
          error: null,
        });
      }
      // [TEST-MOD-APPROVED #2715 A15] Fixture-only durable uncertainty claim for
      // the exact/sub-cap happy paths; rejection ordering remains untouched.
      if (name === "cover_video_begin_provider_create") {
        return Promise.resolve({
          data: {
            ...job,
            provider_allocation_token: "lease-token",
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
            source_asset_id: "guid",
            provider_allocation_token: "lease-token",
          },
          error: null,
        });
      }
      if (name === "cover_video_commit_provider_allocation") {
        return Promise.resolve({
          data: {
            ...job,
            source_asset_id: "guid",
            tus_resource_url: "https://video.bunnycdn.com/tusupload/resource",
          },
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return {
    bunnyCreateVideo: () => {
      capture.allocations += 1;
      return Promise.resolve({ ok: true as const, guid: "guid" });
    },
    bunnyPresignTusUpload: () =>
      Promise.resolve({
        tusEndpoint: "https://video.bunnycdn.com/tusupload",
        libraryId: "lib",
        videoId: "guid",
        authorizationSignature: "sig",
        authorizationExpire: 2_000_000_000,
      }),
    checkBunnyCapacity: () =>
      Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
    providerConfigured: () => true,
    reapSupersededBunnyAssets: () => Promise.resolve(),
    requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
    requireUserId: () =>
      Promise.resolve("44a18413-bfbf-4087-9ba7-45f70deba0f3"),
    serviceRoleClient: () => supabase,
  };
};

const withTusCreate = async (fn: () => Promise<void>) => {
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 201,
        headers: { location: "/tusupload/resource" },
      }),
    )) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = old;
  }
};
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("#2715 accepts the exact 15000ms boundary", async () =>
  withTusCreate(async () => {
    const capture: Capture = { allocations: 0 };
    const response = await handleEventCoverVideoUploadIntent(
      makeRequest({ sourceDurationMs: SOURCE_CEILING_MS }),
      createHarness(capture) as never,
    );
    assert(SOURCE_CEILING_MS === 15_000, "ceiling must be exactly 15000");
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(capture.allocations === 1, "expected one allocation");
    assert(
      capture.rpc?.p_source_duration_ms === 15_000 &&
        capture.rpc?.p_trim_end_ms === 15_000,
      "exact boundary must persist unchanged",
    );
  }));

Deno.test("#2715 rejects 15001ms before provider allocation", async () => {
  const capture: Capture = { allocations: 0 };
  const response = await handleEventCoverVideoUploadIntent(
    makeRequest({ sourceDurationMs: 15_001 }),
    createHarness(capture) as never,
  );
  assert(response.status === 422, `expected 422, got ${response.status}`);
  assert(capture.allocations === 0, "over-cap source allocated provider asset");
});

Deno.test("#2715 rejects an above-cap source instead of clamping its trim", async () => {
  const capture: Capture = { allocations: 0 };
  const response = await handleEventCoverVideoUploadIntent(
    makeRequest({ sourceDurationMs: 31_000, trimEndMs: 31_000 }),
    createHarness(capture) as never,
  );
  assert(response.status === 422, `expected 422, got ${response.status}`);
  assert(
    capture.rpc === undefined,
    "above-cap source reached durable job creation",
  );
  assert(capture.allocations === 0, "above-cap source reached provider");
});

Deno.test("#2715 preserves a valid sub-cap source and trim exactly", async () =>
  withTusCreate(async () => {
    const capture: Capture = { allocations: 0 };
    const response = await handleEventCoverVideoUploadIntent(
      makeRequest({ sourceDurationMs: 12_400, trimEndMs: 12_400 }),
      createHarness(capture) as never,
    );
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(
      capture.rpc?.p_source_duration_ms === 12_400,
      "source duration changed",
    );
    assert(
      capture.rpc?.p_trim_end_ms === 12_400,
      "trim was clamped or changed",
    );
  }));
