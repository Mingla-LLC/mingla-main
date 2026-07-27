/**
 * ISSUE-997 D1 implementor regression — Google (YouTube) video PREPARATION wired
 * into the #1184 prepare state machine. Pure/hermetic: the global fetch is stubbed,
 * so ZERO real network, ZERO provider calls, ZERO ad objects, ZERO spend. Every
 * test names its fails-on-revert target.
 *
 * D1 scope ONLY: the googlePrepareAdapter (initiate + one-poll-per-check), the
 * capability/registry/type-guard plumbing, and the endpoint's READY-side
 * mergeExtra fold. Google video CREATE stays FAIL-CLOSED (that is 997-D2) and is
 * asserted so here.
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue997_google_video_prepare.test.ts
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow } from "../adChannel.ts";
import type { AdCreativeRow } from "../adCreative.ts";
import {
  capabilityFor,
  isPreparationPlatform,
  PREPARE_PROVIDER_ADAPTERS,
  type ProviderLifecycleHooks,
  type VerifiedCreativeBytes,
} from "../adCreativePrepare.ts";
import { resetGoogleTokenCacheForTests } from "../google.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-0000000009d1",
  platform: "google",
  lane: "consumer",
  display_name: "Google Ads · Consumer",
  external_account_id: "3623860476",
  external_org_id: "8284700017",
  auth_kind: "dev_token_oauth",
  token_env_var: "GOOGLE_ADS_REFRESH_TOKEN",
  extra: {},
  status: "connected",
  currency: "USD",
  timezone: "America/New_York",
  min_daily_budget_cents: null,
  account_status: "ENABLED",
  token_last_verified_at: null,
  connected: true,
};

const ASSET = {
  id: "creative-d1",
  name: "mingla_google_d1",
  kind: "video",
  mime_type: "video/mp4",
  content_hash: "hash-d1",
} as unknown as AdCreativeRow;

const BYTES: VerifiedCreativeBytes = {
  video: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
  poster: new Uint8Array([9, 9, 9]),
};

const GOOGLE_ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "test-dev-token",
  GOOGLE_ADS_REFRESH_TOKEN: "test-refresh-token",
  GOOGLE_ADS_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "8284700017",
  GOOGLE_ADS_CUSTOMER_ID: "3623860476",
} as const;

const RESOURCE_NAME = "customers/3623860476/youTubeVideoUploads/upl-d1";
const UPLOAD_SESSION_URL = "https://upload.example/session/d1";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function mintResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "ya29.d1-test", expires_in: 3600 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Stubs env + globalThis.fetch (google.ts::resolveGoogleClient mints via the
 * global fetch, not an injectable dep — so the adapter runs entirely through this
 * stub). `pollPayload` drives the check() poll response.
 */
function withEnvAndFetch(
  pollPayload: Record<string, unknown>,
  fn: (calls: RecordedCall[]) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const prior = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(GOOGLE_ENV)) {
      prior.set(name, Deno.env.get(name));
      Deno.env.set(name, value);
    }
    // Force the default api base/version so URL dispatch is deterministic.
    for (const name of ["GOOGLE_ADS_API_BASE", "GOOGLE_ADS_API_VERSION"]) {
      prior.set(name, Deno.env.get(name));
      Deno.env.delete(name);
    }
    resetGoogleTokenCacheForTests();
    const calls: RecordedCall[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url;
        calls.push({ url, init });
        if (url.includes("oauth2.googleapis.com/token")) {
          return Promise.resolve(mintResponse());
        }
        if (url.includes("youTubeVideoUploads:create")) {
          return Promise.resolve(
            new Response(JSON.stringify({}), {
              status: 200,
              headers: { "X-Goog-Upload-URL": UPLOAD_SESSION_URL },
            }),
          );
        }
        if (url === UPLOAD_SESSION_URL) {
          return Promise.resolve(
            new Response(JSON.stringify({ resourceName: RESOURCE_NAME }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url.includes(RESOURCE_NAME)) {
          return Promise.resolve(
            new Response(JSON.stringify(pollPayload), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(new Response("unexpected", { status: 500 }));
      }) as typeof fetch;
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of prior) {
        if (value !== undefined) Deno.env.set(name, value);
        else Deno.env.delete(name);
      }
      resetGoogleTokenCacheForTests();
    }
  };
}

function recordingHooks(): {
  hooks: ProviderLifecycleHooks;
  calls: {
    savedRef: string | null;
    savedExtra: Record<string, unknown> | null;
    merged: Record<string, unknown>[];
    processing: number;
  };
} {
  const calls = {
    savedRef: null as string | null,
    savedExtra: null as Record<string, unknown> | null,
    merged: [] as Record<string, unknown>[],
    processing: 0,
  };
  return {
    calls,
    hooks: {
      saveProviderRef: (ref, extra = {}) => {
        calls.savedRef = ref;
        calls.savedExtra = extra;
        return Promise.resolve(true);
      },
      mergeProviderExtra: (extra) => {
        calls.merged.push(extra);
        return Promise.resolve(true);
      },
      markProcessing: () => {
        calls.processing += 1;
        return Promise.resolve(true);
      },
    },
  };
}

// ── 1. Plumbing: google is a first-class preparation platform ────────────────
// Fails-on-revert: dropping "google" from the type guard / registry fails this.
Deno.test("ISSUE-997 D1: google is an accepted preparation platform with an adapter", () => {
  assert(
    isPreparationPlatform("google"),
    "google must be a preparation platform",
  );
  assert(
    typeof PREPARE_PROVIDER_ADAPTERS.google?.initiate === "function",
    "google prepare adapter must be registered",
  );
  assert(typeof PREPARE_PROVIDER_ADAPTERS.google?.check === "function");
  // Meta/Snap/TikTok registry untouched.
  assert(isPreparationPlatform("meta"));
  assert(isPreparationPlatform("snapchat"));
  assert(isPreparationPlatform("tiktok"));
  assertEquals(isPreparationPlatform("reddit"), false);
});

// Fails-on-revert: removing the google capabilityFor branch fails this.
Deno.test("ISSUE-997 D1: capabilityFor(google) is create_and_approx_preview; tiktok stays preview_only", () => {
  assertEquals(capabilityFor("google"), "create_and_approx_preview");
  assertEquals(capabilityFor("meta"), "create_and_real_preview");
  assertEquals(capabilityFor("snapchat"), "create_and_approx_preview");
  assertEquals(capabilityFor("tiktok"), "preview_only");
});

// ── 2. initiate: resumable start → upload/finalize → save ref + mark processing ─
// Fails-on-revert: deleting the googlePrepareAdapter fails this.
Deno.test(
  "ISSUE-997 D1: initiate does the YouTube resumable upload and records the resource name",
  withEnvAndFetch({ state: "PENDING" }, async (calls) => {
    const { hooks, calls: hookCalls } = recordingHooks();
    await PREPARE_PROVIDER_ADAPTERS.google.initiate(ASSET, CONN, BYTES, hooks);

    assertEquals(hookCalls.savedRef, RESOURCE_NAME);
    assertEquals(hookCalls.savedExtra, { upload_resource_name: RESOURCE_NAME });
    assertEquals(hookCalls.processing, 1);
    // Google needs NO cover — bytes.poster is never uploaded (no mergeProviderExtra).
    assertEquals(hookCalls.merged.length, 0);

    const startCall = calls.find((c) =>
      c.url.includes("youTubeVideoUploads:create")
    );
    assert(startCall, "a resumable-create call must be made");
    const headers = new Headers(startCall!.init?.headers);
    assertEquals(headers.get("X-Goog-Upload-Command"), "start");
    assertEquals(headers.get("X-Goog-Upload-Protocol"), "resumable");
    assertEquals(
      headers.get("X-Goog-Upload-Header-Content-Length"),
      String(BYTES.video.byteLength),
    );
    assertStringIncludes(headers.get("Authorization") ?? "", "Bearer ");
    assertEquals(headers.get("developer-token"), "test-dev-token");
    assertEquals(headers.get("login-customer-id"), "8284700017");

    const uploadCall = calls.find((c) => c.url === UPLOAD_SESSION_URL);
    assert(uploadCall, "the resumable session URL must be POSTed the bytes");
    const uploadHeaders = new Headers(uploadCall!.init?.headers);
    assertEquals(
      uploadHeaders.get("X-Goog-Upload-Command"),
      "upload, finalize",
    );
  }),
);

// ── 3. check: ONE poll per call; PROCESSED → ready carrying youtube_video_id ──
// Fails-on-revert: removing the mergeExtra youtube_video_id return fails this.
Deno.test(
  "ISSUE-997 D1: check() PROCESSED returns ready with mergeExtra.youtube_video_id (one poll)",
  withEnvAndFetch(
    { state: "PROCESSED", videoId: "yt-d1-123" },
    async (calls) => {
      const result = await PREPARE_PROVIDER_ADAPTERS.google.check(
        RESOURCE_NAME,
        { upload_resource_name: RESOURCE_NAME },
        CONN,
      );
      assertEquals(result, {
        state: "ready",
        preview: null,
        mergeExtra: { youtube_video_id: "yt-d1-123" },
      });
      // Exactly ONE poll GET against the resource (mint may add one token call).
      const pollCalls = calls.filter((c) =>
        c.url.includes(RESOURCE_NAME) && !c.url.includes(":create")
      );
      assertEquals(pollCalls.length, 1);
    },
  ),
);

Deno.test(
  "ISSUE-997 D1: check() UPLOADED/PENDING is processing with a bounded retry",
  withEnvAndFetch({ state: "UPLOADED" }, async () => {
    const result = await PREPARE_PROVIDER_ADAPTERS.google.check(
      RESOURCE_NAME,
      { upload_resource_name: RESOURCE_NAME },
      CONN,
    );
    assertEquals(result, { state: "processing", retryAfterSeconds: 10 });
  }),
);

Deno.test(
  "ISSUE-997 D1: check() FAILED/REJECTED/UNAVAILABLE fails closed as terminal",
  withEnvAndFetch({ state: "FAILED" }, async () => {
    const result = await PREPARE_PROVIDER_ADAPTERS.google.check(
      RESOURCE_NAME,
      { upload_resource_name: RESOURCE_NAME },
      CONN,
    );
    assertEquals(result, {
      state: "terminal",
      terminalCode: "google_yt_processing_failed",
    });
  }),
);

Deno.test(
  "ISSUE-997 D1: check() PROCESSED without a videoId is terminal, never a false ready",
  withEnvAndFetch({ state: "PROCESSED" }, async () => {
    const result = await PREPARE_PROVIDER_ADAPTERS.google.check(
      RESOURCE_NAME,
      { upload_resource_name: RESOURCE_NAME },
      CONN,
    );
    assertEquals(result, {
      state: "terminal",
      terminalCode: "google_yt_video_id_missing",
    });
  }),
);

// ── 4. Endpoint folds a check-discovered mergeExtra into external_ref_extra ───
// Fails-on-revert: removing the ready-branch mergeExtra fold fails this.
Deno.test("ISSUE-997 D1: the prepare endpoint folds checked.mergeExtra into external_ref_extra on READY", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  // The ready CAS spreads the check-time extra so the READY ref carries the
  // youtube_video_id learned only at PROCESSED time.
  assertStringIncludes(src, "...checked.mergeExtra");
  const readyIdx = src.indexOf('checked.state === "ready"');
  const foldIdx = src.indexOf("...checked.mergeExtra");
  const terminalIdx = src.indexOf('checked.state === "terminal"');
  assert(
    readyIdx > -1 && foldIdx > readyIdx && foldIdx < terminalIdx,
    "the mergeExtra fold must live inside the ready branch, before the terminal branch",
  );
});

// ── 5. GUARDRAIL: Google video CREATE is STILL fail-closed (D2 not built) ─────
// This is an invariant guard, not a D1 seam: it proves the create branch was NOT
// touched — Google video create still returns the 422 phase-a seam.
Deno.test("ISSUE-997 D1 guardrail: Google video CREATE stays fail-closed (422); only Google+Reddit still closed", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  // Exactly two video create fail-closed seams remain: Google + Reddit.
  assertEquals(src.match(/video_create_not_available_phase_a/g)?.length, 2);
  assert(
    /creativeG\.kind === "video"[\s\S]{0,160}video_create_not_available_phase_a/
      .test(src),
    "the Google video-create branch must still return video_create_not_available_phase_a (422)",
  );
  assert(
    /creativeR\.kind === "video"[\s\S]{0,160}video_create_not_available_phase_a/
      .test(src),
    "the Reddit video-create branch must still fail closed",
  );
  // D2 not built: no Demand Gen builder wired into the create fn.
  assertEquals(src.includes("buildGoogleDemandGenMutateOperations"), false);
  assertEquals(src.includes("googleCreateDemandGenVideoCampaign"), false);
});
