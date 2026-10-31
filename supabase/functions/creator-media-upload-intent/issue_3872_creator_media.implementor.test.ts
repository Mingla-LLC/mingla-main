import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  creatorDownloadUrl,
  creatorMediaConfig,
  creatorPlaybackUrl,
  deleteCreatorVideo,
  evaluateCreatorMediaCapacity,
  readCreatorMediaCapacity,
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

function deps(
  options: {
    blocked?: boolean;
    blockedReason?:
      | "usage_unreadable"
      | "capacity_reached"
      | "provider_not_configured"
      | "settings_invalid";
  } = {},
) {
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
            ? {
              blocked: true,
              reason: options.blockedReason ?? "usage_unreadable",
              usedPercent: null,
            }
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
      enabledResolutions: "240p,360p,480p,720p,1080p",
      mp4Fallback: true,
      keepOriginalFiles: false,
      tokenAuthentication: true,
      playerTokenAuthentication: true,
      allowDirectPlay: true,
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
      playerTokenAuthentication: true,
      allowDirectPlay: true,
    }),
    { blocked: true, reason: "settings_invalid" },
  );
  assertObjectMatch(
    evaluateCreatorMediaCapacity({
      storageUsage: 91,
      trafficUsage: 10,
      storageCapBytes: 100,
      trafficCapBytes: 100,
      enabledResolutions: "240p,360p,480p,720p,1080p",
      mp4Fallback: true,
      keepOriginalFiles: false,
      tokenAuthentication: true,
      playerTokenAuthentication: true,
      allowDirectPlay: true,
    }),
    { blocked: true, reason: "capacity_reached", usedPercent: 91 },
  );
});

Deno.test("#4182 creator media preflight requires every signed MP4 rendition", () => {
  assertEquals(
    evaluateCreatorMediaCapacity({
      storageUsage: 1,
      trafficUsage: 1,
      storageCapBytes: 100,
      trafficCapBytes: 100,
      enabledResolutions: "360p,480p,720p,1080p",
      mp4Fallback: true,
      keepOriginalFiles: false,
      tokenAuthentication: true,
      playerTokenAuthentication: true,
      allowDirectPlay: true,
    }),
    { blocked: true, reason: "settings_invalid", usedPercent: null },
  );
});

Deno.test("#4182 creator media preflight reads CDN token protection from the authoritative pull zone", async () => {
  const urls: string[] = [];
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/videolibrary/4182")) {
      return Promise.resolve(new Response(JSON.stringify({
        StorageUsage: 10,
        TrafficUsage: 20,
        PullZoneId: 99182,
        EnabledResolutions: "240p,360p,480p,720p,1080p",
        EnableMP4Fallback: true,
        KeepOriginalFiles: false,
        EnableTokenAuthentication: null,
        PlayerTokenAuthenticationEnabled: true,
        AllowDirectPlay: true,
      }), { status: 200 }));
    }
    if (url.endsWith("/pullzone/99182")) {
      return Promise.resolve(new Response(JSON.stringify({
        ZoneSecurityEnabled: true,
      }), { status: 200 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  const result = await readCreatorMediaCapacity({
    libraryId: "4182",
    apiKey: "library-key",
    accountApiKey: "account-key",
    cdnHostname: "creator.example.test",
    tokenKey: "token-key",
    webhookKey: "webhook-key",
    storageCapBytes: 100,
    trafficCapBytes: 100,
  }, fetchImpl as typeof fetch);
  assertEquals(result, {
    blocked: false,
    reason: "under_cap",
    usedPercent: 20,
  });
  assertEquals(urls, [
    "https://api.bunny.net/videolibrary/4182",
    "https://api.bunny.net/pullzone/99182",
  ]);
});

Deno.test("#4182 creator media config resolves from the governed shared credential bundle", () => {
  const names = [
    "CREATOR_BUNNY_ACCOUNT_API_KEY",
    "CREATOR_BUNNY_STORAGE_CAP_BYTES",
    "CREATOR_BUNNY_STREAM_API_KEY",
    "CREATOR_BUNNY_STREAM_CDN_HOSTNAME",
    "CREATOR_BUNNY_STREAM_LIBRARY_ID",
    "CREATOR_BUNNY_STREAM_TOKEN_KEY",
    "CREATOR_BUNNY_STREAM_WEBHOOK_KEY",
    "CREATOR_BUNNY_TRAFFIC_CAP_BYTES",
  ];
  const before = new Map(
    [...names, "AD_CONVERSION_TOKENS"].map((
      name,
    ) => [name, Deno.env.get(name)]),
  );
  try {
    for (const name of names) Deno.env.set(name, `stale-${name}`);
    Deno.env.set(
      "AD_CONVERSION_TOKENS",
      JSON.stringify({
        CREATOR_BUNNY_ACCOUNT_API_KEY: "account-key",
        CREATOR_BUNNY_STORAGE_CAP_BYTES: "1000000",
        CREATOR_BUNNY_STREAM_API_KEY: "library-key",
        CREATOR_BUNNY_STREAM_CDN_HOSTNAME: "creator.example.test",
        CREATOR_BUNNY_STREAM_LIBRARY_ID: "4182",
        CREATOR_BUNNY_STREAM_TOKEN_KEY: "token-key",
        CREATOR_BUNNY_STREAM_WEBHOOK_KEY: "webhook-key",
        CREATOR_BUNNY_TRAFFIC_CAP_BYTES: "2000000",
      }),
    );
    assertEquals(creatorMediaConfig(), {
      libraryId: "4182",
      apiKey: "library-key",
      accountApiKey: "account-key",
      cdnHostname: "creator.example.test",
      tokenKey: "token-key",
      webhookKey: "webhook-key",
      storageCapBytes: 1_000_000,
      trafficCapBytes: 2_000_000,
    });
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("#4182 creator media intent distinguishes provider outage from exhausted capacity", async () => {
  const fake = deps({ blocked: true });
  const response = await createCreatorMediaUploadIntentHandler(
    fake.deps as never,
  )(request());
  assertEquals(response.status, 503);
  assertObjectMatch(await response.json(), {
    error: "media_unavailable",
  });
  assertEquals(fake.values().job, null);
  assertEquals(fake.values().creates, 0);
  assertEquals(fake.values().alerts, 1);

  const capped = deps({ blocked: true, blockedReason: "capacity_reached" });
  const cappedResponse = await createCreatorMediaUploadIntentHandler(
    capped.deps as never,
  )(request());
  assertEquals(cappedResponse.status, 503);
  assertObjectMatch(await cappedResponse.json(), {
    error: "media_capacity",
    retryAfterSeconds: 300,
  });
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
  const expectedToken = [
    "15e336c746ba010e7598265dbf75884bf",
    "61a3a5e891be3e3fc4dd1d813def08b",
  ].join("");
  assertEquals(
    playback?.url,
    `https://player.mediadelivery.net/embed/3872/00000000-3872-4000-8000-000000000099?token=${expectedToken}&expires=1793019600`,
  );
  assertEquals(playback?.url.includes("token-secret"), false);
});

Deno.test("#4182 approved-master grants sign one MP4 path for fifteen minutes", async () => {
  const grant = await creatorDownloadUrl(
    "00000000-3872-4000-8000-000000000099",
    1080,
    1920,
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
    Date.parse("2026-10-26T12:00:00.000Z"),
  );
  assertEquals(grant?.expiresAt, "2026-10-26T12:15:00.000Z");
  assertEquals(grant?.url.includes("play_1080p.mp4"), true);
  assertEquals(grant?.url.includes("token=HS256-"), true);
  assertEquals(grant?.url.includes("token-secret"), false);
});

Deno.test("#4182 approved-master rendition uses the source short edge", async () => {
  const config = {
    libraryId: "3872",
    apiKey: "api",
    accountApiKey: "account",
    cdnHostname: "creator.example.test",
    tokenKey: "token-secret",
    webhookKey: "webhook-secret",
    storageCapBytes: 100,
    trafficCapBytes: 100,
  };
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const portrait = await creatorDownloadUrl(
    "00000000-3872-4000-8000-000000000099",
    360,
    640,
    config,
    now,
  );
  const landscape = await creatorDownloadUrl(
    "00000000-3872-4000-8000-000000000099",
    640,
    360,
    config,
    now,
  );
  const portraitHd = await creatorDownloadUrl(
    "00000000-3872-4000-8000-000000000099",
    1080,
    1920,
    config,
    now,
  );
  assertEquals(portrait?.url.includes("play_360p.mp4"), true);
  assertEquals(landscape?.url.includes("play_360p.mp4"), true);
  assertEquals(portraitHd?.url.includes("play_1080p.mp4"), true);
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
