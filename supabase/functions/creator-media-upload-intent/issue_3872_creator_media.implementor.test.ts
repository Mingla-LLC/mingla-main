import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  creatorPlaybackUrl,
  deleteCreatorVideo,
  evaluateCreatorMediaCapacity,
} from "../_shared/creatorMedia.ts";
import { selectCreatorMediaReap } from "../creator-media-reaper/index.ts";
import { createCreatorMediaWebhookHandler } from "../creator-media-webhook/index.ts";
import {
  createCreatorMediaUploadIntentHandler,
  isVerticalEnough,
} from "./index.ts";

const ACTOR = "00000000-3872-4000-8000-000000000001";
const OPERATION = "00000000-3872-4000-8000-000000000002";

const request = (overrides: Record<string, unknown> = {}) =>
  new Request("http://local/creator-media-upload-intent", {
    method: "POST",
    headers: {
      authorization: "Bearer user-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ownerKind: "creator",
      purpose: "showcase",
      contractId: null,
      localMonthId: null,
      clientOperationId: OPERATION,
      sourceBytes: 12_000_000,
      durationSeconds: 42,
      width: 1080,
      height: 1920,
      ...overrides,
    }),
  });

function deps(options: { blocked?: boolean } = {}) {
  let job: Record<string, unknown> | null = null;
  let creates = 0;
  let alerts = 0;
  return {
    values: () => ({ job, creates, alerts }),
    deps: {
      actorId: () => Promise.resolve(ACTOR),
      uploadsEnabled: () => Promise.resolve(true),
      findJob: () => Promise.resolve(job),
      createJob: (input: Record<string, unknown>) => {
        job = {
          id: input.id,
          owner_id: input.ownerId,
          client_operation_id: input.clientOperationId,
          bunny_video_id: null,
          status: "awaiting_upload",
          aspect_warning: input.aspectWarning,
        };
        return Promise.resolve(job);
      },
      attachVideo: (_jobId: string, videoId: string) => {
        job = { ...job, bunny_video_id: videoId };
        return Promise.resolve(job);
      },
      readCapacity: () =>
        Promise.resolve(
          options.blocked
            ? { blocked: true, reason: "usage_unreadable", usedPercent: null }
            : { blocked: false, reason: "under_cap", usedPercent: 12 },
        ),
      findVideo: () => Promise.resolve({ ok: true, videoId: null }),
      createVideo: () => {
        creates++;
        return Promise.resolve({ ok: true, videoId: "video-3872" });
      },
      presign: (videoId: string) =>
        Promise.resolve({
          tusEndpoint: "https://video.bunnycdn.com/tusupload",
          libraryId: "creator-lib",
          videoId,
          authorizationExpire: 123,
          authorizationSignature: "sig",
        }),
      alert: () => {
        alerts++;
        return Promise.resolve();
      },
    },
  };
}

Deno.test("#3872 creator media capacity fails closed for unreadable, malformed and capped usage", () => {
  assertObjectMatch(
    evaluateCreatorMediaCapacity({
      storageUsage: "unknown",
      trafficUsage: 10,
      storageCapBytes: 100,
      trafficCapBytes: 100,
      enabledResolutions: "720p,1080p",
      mp4Fallback: true,
      keepOriginalFiles: false,
      tokenAuthentication: true,
    }),
    { blocked: true, reason: "usage_unreadable" },
  );
  assertObjectMatch(
    evaluateCreatorMediaCapacity({
      storageUsage: 10,
      trafficUsage: 10,
      storageCapBytes: 100,
      trafficCapBytes: 100,
      enabledResolutions: "720p",
      mp4Fallback: true,
      keepOriginalFiles: false,
      tokenAuthentication: true,
    }),
    { blocked: true, reason: "settings_invalid" },
  );
  assertObjectMatch(
    evaluateCreatorMediaCapacity({
      storageUsage: 91,
      trafficUsage: 10,
      storageCapBytes: 100,
      trafficCapBytes: 100,
      enabledResolutions: "720p,1080p",
      mp4Fallback: true,
      keepOriginalFiles: false,
      tokenAuthentication: true,
    }),
    { blocked: true, reason: "capacity_reached", usedPercent: 91 },
  );
});

Deno.test("#3872 creator media intent refuses before any allocation when capacity is unreadable", async () => {
  const fake = deps({ blocked: true });
  const response = await createCreatorMediaUploadIntentHandler(
    fake.deps as never,
  )(request());
  assertEquals(response.status, 503);
  assertObjectMatch(await response.json(), {
    error: "media_capacity",
    retryAfterSeconds: 300,
  });
  assertEquals(fake.values().job, null);
  assertEquals(fake.values().creates, 0);
  assertEquals(fake.values().alerts, 1);
});

Deno.test("#3872 creator media intent creates one deterministic provider object and replays it", async () => {
  const fake = deps();
  const handler = createCreatorMediaUploadIntentHandler(fake.deps as never);
  const first = await handler(request());
  assertEquals(first.status, 200);
  assertObjectMatch(await first.json(), {
    status: "awaiting_upload",
    aspectWarning: false,
    upload: { videoId: "video-3872", libraryId: "creator-lib" },
  });
  const second = await handler(request());
  assertEquals(second.status, 200);
  assertObjectMatch(await second.json(), { upload: { videoId: "video-3872" } });
  assertEquals(fake.values().creates, 1);
});

Deno.test("#3872 creator media intent enforces the source limits and warns for non-vertical media", async () => {
  const invalid = deps();
  const refused = await createCreatorMediaUploadIntentHandler(
    invalid.deps as never,
  )(
    request({ sourceBytes: 150 * 1024 * 1024 + 1 }),
  );
  assertEquals(refused.status, 400);
  assertEquals(invalid.values().job, null);

  const landscape = deps();
  const accepted = await createCreatorMediaUploadIntentHandler(
    landscape.deps as never,
  )(
    request({ width: 1920, height: 1080 }),
  );
  assertEquals(accepted.status, 200);
  assertObjectMatch(await accepted.json(), { aspectWarning: true });
  assertEquals(isVerticalEnough(1080, 1920), true);
  assertEquals(isVerticalEnough(1920, 1080), false);
});

Deno.test("#3872 creator media playback grants are signed and expire after one hour", async () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const playback = await creatorPlaybackUrl(
    "00000000-3872-4000-8000-000000000099",
    {
      libraryId: "3872",
      apiKey: "api",
      accountApiKey: "account",
      cdnHostname: "creator.example.test",
      tokenKey: "token-secret",
      webhookKey: "webhook-secret",
      storageCapBytes: 100,
      trafficCapBytes: 100,
    },
    now,
  );
  assertEquals(playback?.expiresAt, "2026-10-26T13:00:00.000Z");
  assertEquals(playback?.url.includes("token-secret"), false);
  assertEquals(playback?.url.includes("token="), true);
});

Deno.test("#3872 creator media webhook authenticates before write and promotes verified provider truth", async () => {
  const updates: Record<string, unknown>[] = [];
  const body = JSON.stringify({
    VideoLibraryId: "3872",
    VideoGuid: "00000000-3872-4000-8000-000000000099",
    Status: 3,
  });
  const untrusted = createCreatorMediaWebhookHandler({
    verify: () => Promise.resolve(false),
    readJob: () => Promise.reject(new Error("must not read")),
    readProvider: () => Promise.reject(new Error("must not read provider")),
    updateJob: () => Promise.reject(new Error("must not update")),
  } as never);
  assertEquals(
    (await untrusted(new Request("http://local", { method: "POST", body })))
      .status,
    403,
  );

  const trusted = createCreatorMediaWebhookHandler({
    verify: () => Promise.resolve(true),
    readJob: () =>
      Promise.resolve({
        id: "job-1",
        purpose: "delivery",
        status: "processing",
        bunny_video_id: "00000000-3872-4000-8000-000000000099",
      }),
    readProvider: () =>
      Promise.resolve({
        ok: true,
        video: {
          videoId: "00000000-3872-4000-8000-000000000099",
          lifecycle: "ready",
          durationSeconds: 52,
          sourceBytes: 12_000_000,
          width: 1080,
          height: 1920,
        },
      }),
    updateJob: (_id: string, update: Record<string, unknown>) => {
      updates.push(update);
      return Promise.resolve();
    },
  } as never);
  const promoted = await trusted(
    new Request("http://local", { method: "POST", body }),
  );
  assertEquals(promoted.status, 200);
  assertObjectMatch(updates[0], {
    status: "ready",
    duration_s: 52,
    aspect_warning: false,
  });
});

Deno.test("#3872 creator media reaper selects abandoned and retention-expired jobs only", () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const rows = [
    {
      id: "old-upload",
      bunny_video_id: "one",
      status: "awaiting_upload",
      created_at: "2026-10-25T11:59:00.000Z",
      delete_after: null,
    },
    {
      id: "fresh-upload",
      bunny_video_id: "two",
      status: "awaiting_upload",
      created_at: "2026-10-26T11:59:00.000Z",
      delete_after: null,
    },
    {
      id: "expired",
      bunny_video_id: "three",
      status: "ready",
      created_at: "2026-10-01T00:00:00.000Z",
      delete_after: "2026-10-26T11:59:00.000Z",
    },
    {
      id: "showcase",
      bunny_video_id: "four",
      status: "ready",
      created_at: "2026-10-01T00:00:00.000Z",
      delete_after: null,
    },
  ];
  assertEquals(selectCreatorMediaReap(rows, now).map((row) => row.id), [
    "old-upload",
    "expired",
  ]);
});

Deno.test("#3872 creator cleanup uses the isolated library through the one Bunny delete transport", async () => {
  const calls: Array<
    { url: string; method: string; accessKey: string | null }
  > = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      accessKey: new Headers(init?.headers).get("AccessKey"),
    });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  const result = await deleteCreatorVideo(
    "00000000-3872-4000-8000-000000000099",
    {
      libraryId: "creator-3872",
      apiKey: "creator-key",
      accountApiKey: "account",
      cdnHostname: "creator.example.test",
      tokenKey: "token-secret",
      webhookKey: "webhook-secret",
      storageCapBytes: 100,
      trafficCapBytes: 100,
    },
    fetchImpl,
    async () => {},
  );
  assertEquals(result, { ok: true });
  assertEquals(calls, [{
    url:
      "https://video.bunnycdn.com/library/creator-3872/videos/00000000-3872-4000-8000-000000000099",
    method: "DELETE",
    accessKey: "creator-key",
  }]);
});
