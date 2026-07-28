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
import { CreativeUploadError } from "../adCreative.ts";
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
 * #1292: the documented v24 GAQL search envelope for a `you_tube_video_upload` row
 * (Google Ads REST = camelCase `results[].youTubeVideoUpload`). This is the ONLY
 * shape the fixed check() parser reads — a flat `{ state, videoId }` blob can never
 * satisfy it, so the pre-#1292 mock blind spot is now structurally impossible.
 * `upload` is the inner row (state + video_id); `null` = empty results (row not yet
 * materialized).
 */
function searchEnvelope(
  upload: Record<string, unknown> | null,
): Record<string, unknown> {
  return upload === null ? { results: [] } : {
    results: [{
      youTubeVideoUpload: { resourceName: RESOURCE_NAME, ...upload },
    }],
  };
}

/**
 * Stubs env + globalThis.fetch (google.ts::resolveGoogleClient mints via the
 * global fetch, not an injectable dep — so the adapter runs entirely through this
 * stub). `upload` is the inner `you_tube_video_upload` row (or `null` for empty
 * results) that the check() GAQL-search poll response is built from.
 */
function withEnvAndFetch(
  upload: Record<string, unknown> | null,
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
        // #1292: the CORRECT v24 poll transport — a GAQL search POST for the
        // you_tube_video_upload row. The stub asserts the request shape so a pass is
        // ONLY achievable against the real transport + envelope (never a flat blob at
        // a GET URL the real API 404s).
        if (url.includes("googleAds:search")) {
          assertEquals(init?.method, "POST");
          const q = String(
            (JSON.parse(String(init?.body)) as { query?: unknown }).query ?? "",
          );
          assertStringIncludes(q, "FROM you_tube_video_upload");
          assertStringIncludes(q, RESOURCE_NAME);
          return Promise.resolve(
            new Response(JSON.stringify(searchEnvelope(upload)), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        // REVERT-TRAP: the OLD non-routable GET on …/youTubeVideoUploads/{id}. Google's
        // real front door answers it with generic HTML 404 (not an Ads JSON NOT_FOUND).
        // If check() is reverted to the GET transport the poll routes here → HTML 404 →
        // responseJson {} → never PROCESSED → the ready assertions below FAIL on revert.
        if (url.includes(RESOURCE_NAME)) {
          return Promise.resolve(
            new Response(
              "<!DOCTYPE html><html><head><title>Error 404 (Not Found)</title></head><body><h1>Error 404</h1></body></html>",
              { status: 404, headers: { "Content-Type": "text/html" } },
            ),
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

// ── 3. check: ONE GAQL-search poll per call; PROCESSED → ready + youtube_video_id ─
// Fails-on-revert: reverting to the GET transport (the revert-trap HTML-404s it) or
// removing the mergeExtra youtube_video_id return fails these.
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
      // Exactly ONE googleAds:search POST querying you_tube_video_upload was made
      // (reverting check() to the GET transport records ZERO search POSTs → fails).
      const searchCalls = calls.filter((c) =>
        c.url.includes("googleAds:search") && c.init?.method === "POST"
      );
      assertEquals(searchCalls.length, 1);
      assertStringIncludes(
        String(
          (JSON.parse(String(searchCalls[0].init?.body)) as { query?: unknown })
            .query,
        ),
        "FROM you_tube_video_upload",
      );
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

// #1292 defensive: empty search results (the row has not yet materialized) must
// stay processing, never a false terminal — mirrors the real API returning no rows.
Deno.test(
  "ISSUE-997 D1: check() with EMPTY search results stays processing (row not yet materialized)",
  withEnvAndFetch(null, async () => {
    const result = await PREPARE_PROVIDER_ADAPTERS.google.check(
      RESOURCE_NAME,
      { upload_resource_name: RESOURCE_NAME },
      CONN,
    );
    assertEquals(result, { state: "processing", retryAfterSeconds: 10 });
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

// ── 5. GUARDRAIL: post-D2, Google video create is WIRED; only Reddit fail-closed ─
// [TEST-MOD-APPROVED ORCH-0997] D2 wired Google Demand Gen video create, so the
// D1-era "Google create stays fail-closed" assertion is obsolete. Updated to the
// new truth (Google now builds; the Demand Gen create fn is wired), while KEEPING
// the Reddit fail-closed assertion (the last remaining video create 422).
Deno.test("ISSUE-997 D2 guardrail: Google video CREATE is now WIRED (Demand Gen); only Reddit stays fail-closed", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  // Exactly ONE video create fail-closed seam remains: Reddit.
  assertEquals(src.match(/video_create_not_available_phase_a/g)?.length, 1);
  assert(
    /creativeR\.kind === "video"[\s\S]{0,160}video_create_not_available_phase_a/
      .test(src),
    "the Reddit video-create branch must still fail closed",
  );
  // D2 built: the Demand Gen create fn is wired into the create branch, consuming
  // the D1-prepared youtube_video_id.
  assertEquals(src.includes("googleCreateDemandGenVideoCampaign"), true);
  assertStringIncludes(src, "youtube_video_id");
  assertStringIncludes(src, 'objective: "DEMAND_GEN"');
});

// ── ISSUE-1288: Google video PREPARE finalize + masked-error regressions ──────
// The documented Google Ads YouTube resumable upload contract requires the START
// body to carry the video metadata (UNLISTED privacy + title) and the data/finalize
// leg to be a PUT with `Authorization: Bearer <token>`. The shipped adapter sent an
// empty START body and a POST with NO auth on the data leg — deterministic failure
// after a 200 START. The endpoint then masked every failure as a generic 502 and
// never logged the real CreativeUploadError. These tests pin all three seams.

/**
 * Env + fetch stub whose UPLOAD-SESSION response is caller-supplied — used to drive
 * the finalize-FAILURE path. initiate() throws before check(), so no poll payload
 * is needed. Mirrors withEnvAndFetch's env scaffolding exactly.
 */
function withEnvAndUploadResponse(
  uploadResponseFactory: () => Response,
  fn: (calls: RecordedCall[]) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const prior = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(GOOGLE_ENV)) {
      prior.set(name, Deno.env.get(name));
      Deno.env.set(name, value);
    }
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
          return Promise.resolve(uploadResponseFactory());
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

// ── 6. #1288: data leg is PUT + Bearer; START body carries UNLISTED metadata ──
// Fails-on-revert: reverting the data leg to POST/no-auth, or the START body to {},
// fails these assertions.
Deno.test(
  "ISSUE-1288: initiate uses PUT+Authorization on the finalize leg and sends UNLISTED START metadata",
  withEnvAndFetch({ state: "PENDING" }, async (calls) => {
    const { hooks } = recordingHooks();
    await PREPARE_PROVIDER_ADAPTERS.google.initiate(ASSET, CONN, BYTES, hooks);

    // RC-1 / RC-3: the data/finalize leg is a PUT carrying the bearer token.
    const uploadCall = calls.find((c) => c.url === UPLOAD_SESSION_URL);
    assert(uploadCall, "the resumable session URL must receive the data leg");
    assertEquals(uploadCall!.init?.method, "PUT");
    const uploadHeaders = new Headers(uploadCall!.init?.headers);
    assert(
      (uploadHeaders.get("Authorization") ?? "").startsWith("Bearer "),
      "the finalize leg must carry Authorization: Bearer <token>",
    );
    assertEquals(
      uploadHeaders.get("X-Goog-Upload-Command"),
      "upload, finalize",
    );

    // RC-2: the START body is the documented metadata, not {}.
    const startCall = calls.find((c) =>
      c.url.includes("youTubeVideoUploads:create")
    );
    assert(startCall, "a resumable-create call must be made");
    const startBody = JSON.parse(String(startCall!.init?.body)) as {
      customer_id?: unknown;
      you_tube_video_upload?: {
        video_title?: unknown;
        video_privacy?: unknown;
      };
    };
    assertEquals(startBody.customer_id, "3623860476");
    assertEquals(startBody.you_tube_video_upload?.video_privacy, "UNLISTED");
    assert(
      typeof startBody.you_tube_video_upload?.video_title === "string" &&
        (startBody.you_tube_video_upload!.video_title as string).length > 0,
      "the START body must carry a non-empty video_title",
    );
  }),
);

// ── 7. #1288: a 4xx finalize surfaces the real reason with the body SCRUBBED ──
// Fails-on-revert: reverting the finalize guard to the bare-status message (no
// scrubbed body read) fails this — the message loses the reason + redaction.
Deno.test(
  "ISSUE-1288: a 401 finalize throws google_yt_upload_failed with the status + a SCRUBBED body (no token leak)",
  withEnvAndUploadResponse(
    () =>
      new Response(
        "invalid authentication credentials Bearer ya29.SECRET-TOKEN-abcdefghijklmnop",
        { status: 401 },
      ),
    async () => {
      const { hooks } = recordingHooks();
      let thrown: unknown;
      try {
        await PREPARE_PROVIDER_ADAPTERS.google.initiate(
          ASSET,
          CONN,
          BYTES,
          hooks,
        );
      } catch (e) {
        thrown = e;
      }
      assert(
        thrown instanceof CreativeUploadError,
        "must throw CreativeUploadError",
      );
      assertEquals(
        (thrown as CreativeUploadError).detail,
        "google_yt_upload_failed",
      );
      const msg = (thrown as CreativeUploadError).message;
      // The HTTP status pins RC-1 (401/403 auth) vs RC-2 (400 metadata).
      assertStringIncludes(msg, "401");
      assertStringIncludes(msg, "invalid authentication credentials");
      // A Bearer token in the provider body is redacted before it reaches the log.
      assertStringIncludes(msg, "Bearer [redacted]");
      assert(
        !msg.includes("ya29.SECRET-TOKEN"),
        "a raw bearer token must never appear in the surfaced error",
      );
    },
  ),
);

// ── 8. #1288: the endpoint logs the real initiate failure; envelope stays generic ─
// Fails-on-revert: removing the console.error in the initiate catch fails this.
Deno.test("ISSUE-1288: the prepare endpoint console.errors the real initiate failure while keeping the generic envelope", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  // The initiate catch surfaces the real provider error to the SERVER log.
  assertStringIncludes(src, "[admin-ad-creative-prepare] initiate failed:");
  assertStringIncludes(src, "console.error(");
  // It reads the machine-readable code from CreativeUploadError.detail (NOT .code).
  assertStringIncludes(src, "error instanceof CreativeUploadError");
  assertStringIncludes(src, "error.detail");
  // CreativeUploadError must be imported into the endpoint to be instanceof-checked.
  assertStringIncludes(
    src,
    'import { CreativeUploadError } from "../_shared/adCreative.ts";',
  );
  // The log fires AFTER the specific-error early returns and BEFORE the generic
  // provider_init_failed CAS, and the user-facing envelope stays generic (502).
  const rateLimitIdx = src.indexOf("error instanceof ProviderRateLimitError");
  const logIdx = src.indexOf("[admin-ad-creative-prepare] initiate failed:");
  const genericCodeIdx = src.indexOf('error_code: "provider_init_failed"');
  assert(
    rateLimitIdx > -1 && logIdx > rateLimitIdx && genericCodeIdx > logIdx,
    "the log must sit inside the initiate catch, before the generic CAS",
  );
  assertStringIncludes(src, "502,");
});
