/**
 * ISSUE-997 D1 — INDEPENDENT TESTER adversarial suite (Google video PREPARE).
 *
 * DIFFERENT ANGLE from the implementor happy-path (issue997_google_video_prepare
 * .test.ts). The implementor drove the SUCCESS path (start→upload→finalize→save,
 * PROCESSED→ready) and asserted the endpoint fold + create fail-closed via SOURCE
 * GREP. This suite attacks the NEGATIVE space and proves the invariants BEHAVIOURALLY:
 *
 *   - initiate ORDERING: markProcessing/saveProviderRef fire ONLY after a real
 *     upload resource — every failure seam (start !ok, missing upload-URL, upload
 *     !ok, missing resourceName, saveProviderRef-lost CAS) leaves ZERO ref saved
 *     and ZERO markProcessing.
 *   - initiate uploads the VIDEO bytes (identity) and IGNORES bytes.poster entirely.
 *   - check() poll-URL fallback to `ref` when extra.upload_resource_name is
 *     absent / non-string / empty; snake_case video_id; empty/non-string videoId
 *     is terminal; unknown/missing state stays processing; exactly-one poll.
 *   - mergeExtra no-op: proven by DRIVING the real google + tiktok + meta check()
 *     adapters and asserting only google emits mergeExtra (exactly {youtube_video_id}),
 *     then EXECUTING the endpoint's real READY fold to show a sibling result leaves
 *     external_ref_extra untouched (byte-identical no-op) while google merges,
 *     preserving the prior upload_resource_name.
 *   - Google video CREATE stays fail-closed: the create module has ZERO knowledge
 *     of youtube_video_id / Demand Gen — a READY ref can never build a create.
 *
 * Pure/hermetic: fetch is stubbed (globalThis for google's OAuth mint; deps.fetchImpl
 * for meta/tiktok). ZERO real network, ZERO provider calls, ZERO ad objects, ZERO spend.
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue997_google_video_prepare.adversarial.tester.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow } from "../adChannel.ts";
import type { AdCreativeRow } from "../adCreative.ts";
import { CreativeUploadError } from "../adCreative.ts";
import {
  PREPARE_PROVIDER_ADAPTERS,
  type ProviderCheckResult,
  type ProviderLifecycleHooks,
  type VerifiedCreativeBytes,
} from "../adCreativePrepare.ts";
import { resetGoogleTokenCacheForTests } from "../google.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GOOGLE_CONN: AdConnectionRow = {
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
  id: "creative-d1-adv",
  name: "mingla_google_d1_adv",
  kind: "video",
  mime_type: "video/mp4",
  content_hash: "hash-d1-adv",
} as unknown as AdCreativeRow;

// A distinctively-sized video (11 bytes) so byte-identity + content-length are
// provably not hardcoded, plus a poster we prove is NEVER touched.
const VIDEO_BYTES = new Uint8Array([
  10,
  20,
  30,
  40,
  50,
  60,
  70,
  80,
  90,
  100,
  110,
]);
const POSTER_BYTES = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
const BYTES: VerifiedCreativeBytes = {
  video: VIDEO_BYTES,
  poster: POSTER_BYTES,
};

const RESOURCE_NAME = "customers/3623860476/youTubeVideoUploads/upl-d1-adv";
const UPLOAD_SESSION_URL = "https://upload.example/session/d1-adv";

const GOOGLE_ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "test-dev-token",
  GOOGLE_ADS_REFRESH_TOKEN: "test-refresh-token",
  GOOGLE_ADS_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "8284700017",
  GOOGLE_ADS_CUSTOMER_ID: "3623860476",
} as const;

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

interface GoogleRoutes {
  startStatus?: number;
  startUploadUrl?: string | null;
  uploadStatus?: number;
  finalizeBody?: Record<string, unknown>;
  pollPayload?: Record<string, unknown>;
  pollStatus?: number;
}

/**
 * Stubs env + globalThis.fetch. resolveGoogleClient mints its OAuth token via the
 * GLOBAL fetch (not an injectable dep), so the whole google adapter runs through
 * this one stub. Routes are keyed by URL shape; every call is recorded.
 */
function withGoogle(
  routes: GoogleRoutes,
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
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "ya29.adv", expires_in: 3600 }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url.includes("youTubeVideoUploads:create")) {
          const headers = new Headers({ "Content-Type": "application/json" });
          const uploadUrl = routes.startUploadUrl === undefined
            ? UPLOAD_SESSION_URL
            : routes.startUploadUrl;
          if (uploadUrl) headers.set("X-Goog-Upload-URL", uploadUrl);
          return Promise.resolve(
            new Response(JSON.stringify({}), {
              status: routes.startStatus ?? 200,
              headers,
            }),
          );
        }
        if (url === UPLOAD_SESSION_URL) {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                routes.finalizeBody ?? { resourceName: RESOURCE_NAME },
              ),
              {
                status: routes.uploadStatus ?? 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
        // Anything else is the status poll GET.
        return Promise.resolve(
          new Response(
            JSON.stringify(routes.pollPayload ?? { state: "PENDING" }),
            {
              status: routes.pollStatus ?? 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
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

function recordingHooks(saveResult = true): {
  hooks: ProviderLifecycleHooks;
  calls: {
    savedRef: string | null;
    savedExtra: Record<string, unknown> | null;
    saveCount: number;
    merged: Record<string, unknown>[];
    processing: number;
  };
} {
  const calls = {
    savedRef: null as string | null,
    savedExtra: null as Record<string, unknown> | null,
    saveCount: 0,
    merged: [] as Record<string, unknown>[],
    processing: 0,
  };
  return {
    calls,
    hooks: {
      saveProviderRef: (ref, extra = {}) => {
        calls.saveCount += 1;
        calls.savedRef = ref;
        calls.savedExtra = extra;
        return Promise.resolve(saveResult);
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

const google = () => PREPARE_PROVIDER_ADAPTERS.google;

// ══ 1. initiate ORDERING — no ref / no markProcessing without a real resource ══

Deno.test(
  "ADV D1: initiate — resumable START !ok throws, saves NO ref, never marks processing",
  withGoogle({ startStatus: 500 }, async (calls) => {
    const { hooks, calls: h } = recordingHooks();
    const err = await assertRejects(
      () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
      CreativeUploadError,
    );
    assertEquals(
      (err as CreativeUploadError).detail,
      "google_yt_upload_start_failed",
    );
    assertEquals(h.saveCount, 0);
    assertEquals(h.processing, 0);
    // Never reached the upload-session POST.
    assertEquals(calls.some((c) => c.url === UPLOAD_SESSION_URL), false);
  }),
);

Deno.test(
  "ADV D1: initiate — START ok but MISSING X-Goog-Upload-URL throws, no ref/processing",
  withGoogle({ startUploadUrl: null }, async (_calls) => {
    const { hooks, calls: h } = recordingHooks();
    const err = await assertRejects(
      () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
      CreativeUploadError,
    );
    assertEquals(
      (err as CreativeUploadError).detail,
      "google_yt_upload_url_missing",
    );
    assertEquals(h.saveCount, 0);
    assertEquals(h.processing, 0);
  }),
);

Deno.test(
  "ADV D1: initiate — upload/finalize !ok throws, no ref/processing",
  withGoogle({ uploadStatus: 500 }, async (_calls) => {
    const { hooks, calls: h } = recordingHooks();
    const err = await assertRejects(
      () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
      CreativeUploadError,
    );
    assertEquals(
      (err as CreativeUploadError).detail,
      "google_yt_upload_failed",
    );
    assertEquals(h.saveCount, 0);
    assertEquals(h.processing, 0);
  }),
);

Deno.test(
  "ADV D1: initiate — finalize returns NO resourceName throws; markProcessing NEVER fires",
  withGoogle({ finalizeBody: {} }, async (_calls) => {
    const { hooks, calls: h } = recordingHooks();
    const err = await assertRejects(
      () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
      CreativeUploadError,
    );
    assertEquals(
      (err as CreativeUploadError).detail,
      "google_yt_resource_missing",
    );
    assertEquals(h.saveCount, 0);
    // The core ordering invariant: no upload resource => no processing transition.
    assertEquals(h.processing, 0);
  }),
);

Deno.test(
  "ADV D1: initiate — saveProviderRef CAS lost (false) short-circuits BEFORE markProcessing",
  withGoogle({}, async (_calls) => {
    const { hooks, calls: h } = recordingHooks(false); // saveProviderRef => false
    await google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks); // returns, no throw
    assertEquals(h.saveCount, 1); // it WAS attempted
    assertEquals(h.savedRef, RESOURCE_NAME);
    assertEquals(h.processing, 0); // but processing NOT marked on a lost CAS
  }),
);

Deno.test(
  "ADV D1: initiate — NESTED youTubeVideoUpload.resourceName is honored (implementor tested only flat)",
  withGoogle(
    { finalizeBody: { youTubeVideoUpload: { resourceName: RESOURCE_NAME } } },
    async (_calls) => {
      const { hooks, calls: h } = recordingHooks();
      await google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks);
      assertEquals(h.savedRef, RESOURCE_NAME);
      assertEquals(h.savedExtra, { upload_resource_name: RESOURCE_NAME });
      assertEquals(h.processing, 1);
    },
  ),
);

Deno.test(
  "ADV D1: initiate — the finalize body is the VIDEO bytes (identity); poster is NEVER uploaded",
  withGoogle({}, async (calls) => {
    const { hooks, calls: h } = recordingHooks();
    await google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks);

    const uploadCall = calls.find((c) => c.url === UPLOAD_SESSION_URL);
    assert(uploadCall, "the resumable session must be POSTed");
    // Body identity: exactly the video bytes, byte-for-byte.
    const body = uploadCall!.init?.body as Uint8Array;
    assertEquals(Array.from(body), Array.from(VIDEO_BYTES));
    // Content-Length announced at START equals the video length (not hardcoded).
    const startCall = calls.find((c) =>
      c.url.includes("youTubeVideoUploads:create")
    );
    const startHeaders = new Headers(startCall!.init?.headers);
    assertEquals(
      startHeaders.get("X-Goog-Upload-Header-Content-Length"),
      String(VIDEO_BYTES.byteLength),
    );
    // Poster is structurally ignored: no mergeProviderExtra, no call carries it.
    assertEquals(h.merged.length, 0);
    const posterStr = Array.from(POSTER_BYTES).join(",");
    for (const c of calls) {
      const b = c.init?.body;
      if (b instanceof Uint8Array) {
        assert(
          Array.from(b).join(",") !== posterStr,
          "no request body may equal the poster bytes",
        );
      }
    }
  }),
);

// ══ 2. check() poll-URL fallback + state machine ══

async function pollUrlFor(
  extra: Record<string, unknown>,
  ref: string,
): Promise<string> {
  let captured = "";
  await withGoogle({ pollPayload: { state: "PENDING" } }, async (calls) => {
    await google().check(ref, extra, GOOGLE_CONN);
    const poll = calls.find(
      (c) =>
        !c.url.includes("oauth2.googleapis.com") &&
        !c.url.includes(":create") &&
        c.url !== UPLOAD_SESSION_URL,
    );
    captured = poll?.url ?? "";
  })();
  return captured;
}

Deno.test("ADV D1: check() polls `ref` when extra.upload_resource_name is ABSENT", async () => {
  const url = await pollUrlFor({}, RESOURCE_NAME);
  assert(
    url.endsWith("/" + RESOURCE_NAME),
    `poll url should end with ref, got ${url}`,
  );
});

Deno.test("ADV D1: check() falls back to `ref` for a NON-STRING upload_resource_name", async () => {
  const fallbackRef = "customers/x/youTubeVideoUploads/FALLBACK";
  const url = await pollUrlFor({ upload_resource_name: 12345 }, fallbackRef);
  assert(url.endsWith("/" + fallbackRef), `expected ref fallback, got ${url}`);
});

Deno.test("ADV D1: check() falls back to `ref` for an EMPTY-STRING upload_resource_name", async () => {
  const fallbackRef = "customers/x/youTubeVideoUploads/EMPTYFALLBACK";
  const url = await pollUrlFor({ upload_resource_name: "" }, fallbackRef);
  assert(url.endsWith("/" + fallbackRef), `expected ref fallback, got ${url}`);
});

Deno.test("ADV D1: check() prefers a valid string upload_resource_name over ref", async () => {
  const url = await pollUrlFor(
    { upload_resource_name: RESOURCE_NAME },
    "IGNORED_REF",
  );
  assert(url.endsWith("/" + RESOURCE_NAME));
  assertEquals(url.includes("IGNORED_REF"), false);
});

Deno.test(
  "ADV D1: check() PROCESSED with snake_case video_id ALSO yields ready (implementor tested only camelCase)",
  withGoogle(
    { pollPayload: { state: "PROCESSED", video_id: "snake-yt-9" } },
    async () => {
      const res = await google().check(RESOURCE_NAME, {
        upload_resource_name: RESOURCE_NAME,
      }, GOOGLE_CONN);
      assertEquals(res, {
        state: "ready",
        preview: null,
        mergeExtra: { youtube_video_id: "snake-yt-9" },
      });
    },
  ),
);

Deno.test(
  "ADV D1: check() PROCESSED with EMPTY-STRING videoId is terminal, never a false ready",
  withGoogle({ pollPayload: { state: "PROCESSED", videoId: "" } }, async () => {
    const res = await google().check(RESOURCE_NAME, {
      upload_resource_name: RESOURCE_NAME,
    }, GOOGLE_CONN);
    assertEquals(res, {
      state: "terminal",
      terminalCode: "google_yt_video_id_missing",
    });
  }),
);

Deno.test(
  "ADV D1: check() PROCESSED with a NON-STRING videoId (and no video_id) is terminal",
  withGoogle({ pollPayload: { state: "PROCESSED", videoId: 42 } }, async () => {
    const res = await google().check(RESOURCE_NAME, {
      upload_resource_name: RESOURCE_NAME,
    }, GOOGLE_CONN);
    assertEquals(res, {
      state: "terminal",
      terminalCode: "google_yt_video_id_missing",
    });
  }),
);

Deno.test(
  "ADV D1: check() UNKNOWN/garbage state stays processing (never false ready/terminal)",
  withGoogle({ pollPayload: { state: "SOMETHING_NEW" } }, async () => {
    const res = await google().check(RESOURCE_NAME, {
      upload_resource_name: RESOURCE_NAME,
    }, GOOGLE_CONN);
    assertEquals(res, { state: "processing", retryAfterSeconds: 10 });
  }),
);

Deno.test(
  "ADV D1: check() with a MISSING state field stays processing",
  withGoogle({ pollPayload: { note: "no state here" } }, async () => {
    const res = await google().check(RESOURCE_NAME, {
      upload_resource_name: RESOURCE_NAME,
    }, GOOGLE_CONN);
    assertEquals(res, { state: "processing", retryAfterSeconds: 10 });
  }),
);

Deno.test(
  "ADV D1: check() performs EXACTLY ONE poll GET per call",
  withGoogle(
    { pollPayload: { state: "PROCESSED", videoId: "yt-one" } },
    async (calls) => {
      await google().check(RESOURCE_NAME, {
        upload_resource_name: RESOURCE_NAME,
      }, GOOGLE_CONN);
      const polls = calls.filter(
        (c) =>
          !c.url.includes("oauth2.googleapis.com") &&
          !c.url.includes(":create") &&
          c.url !== UPLOAD_SESSION_URL,
      );
      assertEquals(polls.length, 1);
    },
  ),
);

// ══ 3. mergeExtra is GOOGLE-ONLY — behavioural no-op proof for Meta/Snap/TikTok ══

Deno.test(
  "ADV D1: the REAL google check() ready result carries mergeExtra = {youtube_video_id} ONLY",
  withGoogle(
    { pollPayload: { state: "PROCESSED", videoId: "yt-only" } },
    async () => {
      const res = await google().check(RESOURCE_NAME, {
        upload_resource_name: RESOURCE_NAME,
      }, GOOGLE_CONN);
      assertEquals(res.state, "ready");
      // Exactly one key — so folding it can never clobber upload_resource_name.
      assertEquals(Object.keys(res.mergeExtra ?? {}), ["youtube_video_id"]);
      assertEquals(res.mergeExtra, { youtube_video_id: "yt-only" });
    },
  ),
);

Deno.test("ADV D1: the REAL tiktok check() READY result carries NO mergeExtra", async () => {
  const priorTok = Deno.env.get("TIKTOK_ADV_TOKEN");
  Deno.env.set("TIKTOK_ADV_TOKEN", "tok-adv");
  try {
    const tiktokConn = {
      ...GOOGLE_CONN,
      platform: "tiktok",
      external_account_id: "adv123",
      token_env_var: "TIKTOK_ADV_TOKEN",
    } as unknown as AdConnectionRow;
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const deps = {
      fetchImpl: ((_i: unknown, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: 0,
              data: {
                list: [{
                  video_id: "tv1",
                  displayable: true,
                  preview_url: "https://p.tiktok.example/x",
                  preview_url_expire_time: future,
                }],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )) as typeof fetch,
    };
    const res = await PREPARE_PROVIDER_ADAPTERS.tiktok.check(
      "tv1",
      { video_id: "tv1" },
      tiktokConn,
      deps,
    );
    assertEquals(res.state, "ready");
    assertEquals("mergeExtra" in res, false);
  } finally {
    if (priorTok !== undefined) Deno.env.set("TIKTOK_ADV_TOKEN", priorTok);
    else Deno.env.delete("TIKTOK_ADV_TOKEN");
  }
});

Deno.test("ADV D1: the REAL meta check() READY result carries NO mergeExtra", async () => {
  const restore = new Map<string, string | undefined>();
  const setEnv = (k: string, v: string) => {
    restore.set(k, Deno.env.get(k));
    Deno.env.set(k, v);
  };
  setEnv("META_ADV_TOKEN", "meta-tok");
  setEnv("META_AD_ACCOUNT_ID", "act_adv");
  setEnv("META_PAGE_ID", "page_adv");
  try {
    const metaConn = {
      ...GOOGLE_CONN,
      platform: "meta",
      external_account_id: "act_adv",
      token_env_var: "META_ADV_TOKEN",
    } as unknown as AdConnectionRow;
    const deps = {
      fetchImpl: ((_i: unknown, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ status: { video_status: "ready" } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )) as typeof fetch,
    };
    const res = await PREPARE_PROVIDER_ADAPTERS.meta.check(
      "mv1",
      {},
      metaConn,
      deps,
    );
    assertEquals(res.state, "ready");
    assertEquals("mergeExtra" in res, false);
  } finally {
    for (const [k, v] of restore) {
      if (v !== undefined) Deno.env.set(k, v);
      else Deno.env.delete(k);
    }
  }
});

// ══ 4. The endpoint's REAL READY fold — no-op for siblings, merge for google ══

// Replica of the exact conditional spread in
// admin-ad-creative-prepare/index.ts's READY-transition CAS. A source-substring
// guard (below) fails this suite if the endpoint expression ever drifts from the
// replica, so this executes the REAL reconciliation semantics — not a paraphrase.
function buildReadyUpdate(
  currentExtra: Record<string, unknown>,
  checked: ProviderCheckResult,
): Record<string, unknown> {
  return {
    status: "ready",
    ...(checked.mergeExtra
      ? { external_ref_extra: { ...currentExtra, ...checked.mergeExtra } }
      : {}),
  };
}

Deno.test("ADV D1: endpoint fold — a SIBLING ready result (no mergeExtra) leaves external_ref_extra UNTOUCHED", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  // Guard the replica against source drift — assert the real expression exists.
  assert(
    src.includes("...(checked.mergeExtra"),
    "endpoint must gate the fold on checked.mergeExtra",
  );
  assert(
    src.includes("...row.current_external_ref_extra,"),
    "fold must spread the prior extra first",
  );
  assert(
    src.includes("...checked.mergeExtra,"),
    "fold must spread the check-time extra second",
  );

  // Meta / Snap / TikTok never set mergeExtra => the CAS update omits
  // external_ref_extra ENTIRELY, so a partial .update() leaves the column exactly
  // as persisted at upload. Even a rich prior extra can never be inherited/dropped.
  for (
    const sibling of [
      { state: "ready" } as ProviderCheckResult,
      {
        state: "ready",
        preview: { external_url: "x", expires_at: "y" },
      } as ProviderCheckResult,
    ]
  ) {
    const update = buildReadyUpdate(
      { video_id: "vid", cover_image_id: "cov" },
      sibling,
    );
    assertEquals(
      Object.prototype.hasOwnProperty.call(update, "external_ref_extra"),
      false,
      "no external_ref_extra key => the DB column is never written (byte-identical no-op)",
    );
  }
});

Deno.test("ADV D1: endpoint fold — google MERGES youtube_video_id and PRESERVES the prior upload_resource_name", () => {
  const googleReady: ProviderCheckResult = {
    state: "ready",
    preview: null,
    mergeExtra: { youtube_video_id: "yt-merge-1" },
  };
  const update = buildReadyUpdate(
    { upload_resource_name: RESOURCE_NAME },
    googleReady,
  );
  assertEquals(update.external_ref_extra, {
    upload_resource_name: RESOURCE_NAME,
    youtube_video_id: "yt-merge-1",
  });
});

Deno.test(
  "ADV D1: the REAL google check() output folds end-to-end into a complete READY extra",
  withGoogle(
    { pollPayload: { state: "PROCESSED", videoId: "yt-e2e" } },
    async () => {
      const checked = await google().check(RESOURCE_NAME, {
        upload_resource_name: RESOURCE_NAME,
      }, GOOGLE_CONN);
      const update = buildReadyUpdate(
        { upload_resource_name: RESOURCE_NAME },
        checked,
      );
      assertEquals(update.external_ref_extra, {
        upload_resource_name: RESOURCE_NAME,
        youtube_video_id: "yt-e2e",
      });
    },
  ),
);

Deno.test("ADV D1: no sibling adapter check() body references mergeExtra (source of the no-op)", async () => {
  const src = await Deno.readTextFile(
    new URL("../adCreativePrepare.ts", import.meta.url),
  );
  // Isolate ONLY the meta/snap/tiktok adapter bodies (from the first adapter up to
  // the google adapter marker) and assert mergeExtra appears nowhere in them. The
  // `mergeExtra?` field on the ProviderCheckResult interface above is intentionally
  // excluded — this targets the sibling RETURN sites, which is what makes the fold
  // a no-op for meta/snap/tiktok.
  const start = src.indexOf("const metaPrepareAdapter");
  const marker = "ISSUE-997 D1: Google (YouTube) video prepare adapter";
  const idx = src.indexOf(marker);
  assert(start > -1, "metaPrepareAdapter must be present");
  assert(idx > start, "google adapter marker must follow the siblings");
  const siblingRegion = src.slice(start, idx);
  assertEquals(
    siblingRegion.includes("mergeExtra"),
    false,
    "meta/snap/tiktok adapters must never emit mergeExtra — that is what makes the fold a no-op",
  );
});

// ══ 5. GUARDRAIL — post-D2, Google video CREATE consumes the prepared id; Reddit stays closed ══

// [TEST-MOD-APPROVED ORCH-0997] D2 wired Google Demand Gen video create, so the
// D1-era "create is BLIND to the prepared id / D2 not built" adversarial guard is
// obsolete. Updated to the new truth (the create module now consumes the prepared
// youtube_video_id through the Demand Gen create fn), while KEEPING Reddit
// fail-closed and asserting the create side stays a READY-ref consumer (never an
// inline uploader). D1's prepare-side assertions (§1–§4) are untouched.
Deno.test("ADV D2 guardrail: the create module consumes the prepared youtube_video_id (Demand Gen wired); Reddit stays fail-closed", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  // The create side now knows the Demand Gen create fn + the prepared id.
  for (
    const symbol of [
      "youtube_video_id",
      "googleCreateDemandGenVideoCampaign",
      "DEMAND_GEN",
    ]
  ) {
    assertEquals(
      src.includes(symbol),
      true,
      `create module must now contain D2 symbol: ${symbol}`,
    );
  }
  // But it stays a READY-ref CONSUMER — it never uploads google video bytes inline
  // (the prepare adapter owns the YouTube resumable upload). A stale/incomplete ref
  // fails closed; the ref is advertiser + content-hash scoped.
  const gStart = src.indexOf('if (platform === "google")');
  const gEnd = src.indexOf('if (platform === "snapchat")');
  assert(gStart >= 0 && gEnd > gStart, "could not bound the google branch");
  const googleBranch = src.slice(gStart, gEnd);
  assertStringIncludes(googleBranch, "creative_ref_incomplete");
  assertStringIncludes(googleBranch, '.eq("external_account_id", gconnGV.external_account_id)');
  assertStringIncludes(googleBranch, '.eq("content_hash", libCreativeGV.content_hash)');
  // The google branch no longer fail-closes; only Reddit does.
  assert(
    !googleBranch.includes("video_create_not_available_phase_a"),
    "google video create must no longer fail closed",
  );
  assert(
    /creativeR\.kind === "video"[\s\S]{0,200}video_create_not_available_phase_a/
      .test(src),
    "Reddit video create must still fail closed (422)",
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// ISSUE-1288 — INDEPENDENT TESTER adversarial suite (the finalize FIX + REDACTION)
//
// DIFFERENT ANGLE from the #1288 implementor happy-path (issue997_google_video_
// prepare.test.ts §6-8, which drove the SUCCESS finalize + a single 401 redaction
// case + endpoint source-grep). This suite attacks the NEGATIVE space of the fix:
//
//   - the data/finalize leg is a PUT that carries ONLY `Authorization: Bearer`
//     (RC-1/RC-3) and does NOT over-send the Ads developer-token / login-customer-id
//     (per the documented contract the data leg needs the bearer alone) — while the
//     START leg keeps its full Ads auth headers;
//   - the START metadata (RC-2) carries customer_id + UNLISTED + a video_title that
//     is a faithful passthrough of asset.name — proven with a 1000-char name (no
//     overflow / no truncation by our code) AND an empty name (no crash; fail-closed
//     metadata still present) — see the report Discovery on the missing non-empty
//     title guard;
//   - REDACTION (security, highest value): a finalize error body that echoes a
//     `Bearer <token>` OR a Meta `EAA…` token is scrubbed before it reaches the
//     surfaced error / server log; the raw token NEVER appears in the thrown message
//     NOR in the endpoint's `${platform}/${detail}: ${message}` log composition; and
//     the slice(0,300) bounds the surface so a token beyond 300 chars never leaks;
//   - a 400 metadata rejection is fail-closed terminal (throws, ZERO ref, ZERO
//     markProcessing) — the RC-1-vs-RC-2 discriminator the contract relies on;
//   - a finalize HTTP 200 whose resourceName is a NON-STRING or an EMPTY STRING goes
//     TERMINAL (google_yt_resource_missing) — never a false-ready ref;
//   - CROSS-PLATFORM no-regression: the endpoint's new initiate-catch console.error
//     is platform-AGNOSTIC, sits AFTER the trust + rate-limit early-returns, and does
//     NOT alter the generic provider_init_failed / 502 envelope for Meta/Snap/TikTok;
//     the only new value import is CreativeUploadError.
//
// Pure/hermetic: globalThis.fetch is stubbed; ZERO network, ZERO provider calls,
// ZERO ad objects, ZERO spend, ZERO real YouTube upload.

/**
 * Like withGoogle, but the UPLOAD-SESSION (finalize) response is a caller-supplied
 * RAW status + body — used to drive the finalize-FAILURE + redaction paths with
 * exact control of the response TEXT (JSON.stringify would escape the token shapes
 * the scrub regexes target). START always succeeds (200 + upload URL) so control
 * reaches the finalize leg. initiate() throws before check(), so no poll is needed.
 */
function withGoogleRawFinalize(
  finalizeStatus: number,
  finalizeBodyText: string,
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
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "ya29.adv", expires_in: 3600 }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
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
            new Response(finalizeBodyText, { status: finalizeStatus }),
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

// A realistic-shaped Google OAuth access token used ONLY as leak bait in a stubbed
// finalize body. It is NOT a real credential.
const LEAK_BAIT_TOKEN =
  "ya29.a0AfB_LEAKMARKER_abcdefghijklmnopqrstuvwxyz0123456789";

// ── #1288.1: data leg = PUT + ONLY-bearer; START leg keeps full Ads auth ──────
// Fails-on-revert: reverting the data leg to POST, or dropping the Authorization
// header, fails this. Also pins that the data leg does NOT over-send the Ads
// developer-token / login-customer-id (contract: data leg needs the bearer alone).
Deno.test(
  "ADV #1288: finalize leg is PUT carrying ONLY Bearer; dev-token/login-customer-id stay on the START leg",
  withGoogle({}, async (calls) => {
    const { hooks } = recordingHooks();
    await google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks);

    const uploadCall = calls.find((c) => c.url === UPLOAD_SESSION_URL);
    assert(uploadCall, "the data/finalize leg must be sent");
    assertEquals(uploadCall!.init?.method, "PUT");
    const uh = new Headers(uploadCall!.init?.headers);
    assert(
      (uh.get("Authorization") ?? "").startsWith("Bearer "),
      "the data leg must carry Authorization: Bearer <token>",
    );
    // The data leg must NOT leak the Ads developer-token / login-customer-id.
    assertEquals(uh.get("developer-token"), null);
    assertEquals(uh.get("login-customer-id"), null);
    assertEquals(uh.get("X-Goog-Upload-Command"), "upload, finalize");

    // …but the START leg IS the Ads-authenticated one and keeps the full headers.
    const startCall = calls.find((c) =>
      c.url.includes("youTubeVideoUploads:create")
    );
    const sh = new Headers(startCall!.init?.headers);
    assert((sh.get("Authorization") ?? "").startsWith("Bearer "));
    assertEquals(sh.get("developer-token"), "test-dev-token");
    assertEquals(sh.get("login-customer-id"), "8284700017");
  }),
);

// ── #1288.2: START body = customer_id + UNLISTED + faithful title (1000 chars) ──
// Fails-on-revert: reverting the START body to {} fails (customer_id/UNLISTED/title
// all vanish). Proves a very long asset.name is passed through, not truncated/over-
// flowed by our code.
Deno.test(
  "ADV #1288: START body carries customer_id + UNLISTED + the full (1000-char) video_title, valid JSON",
  withGoogle({}, async (calls) => {
    const longName = "z".repeat(1000);
    const longAsset = { ...ASSET, name: longName } as unknown as typeof ASSET;
    const { hooks } = recordingHooks();
    await google().initiate(longAsset, GOOGLE_CONN, BYTES, hooks);

    const startCall = calls.find((c) =>
      c.url.includes("youTubeVideoUploads:create")
    );
    assert(startCall, "a resumable START must be sent");
    const body = JSON.parse(String(startCall!.init?.body)) as {
      customer_id?: unknown;
      you_tube_video_upload?: {
        video_title?: unknown;
        video_privacy?: unknown;
      };
    };
    assertEquals(body.customer_id, "3623860476");
    assertEquals(body.you_tube_video_upload?.video_privacy, "UNLISTED");
    // Faithful passthrough — the full 1000-char title, no truncation on our side.
    assertEquals(body.you_tube_video_upload?.video_title, longName);
  }),
);

// ── #1288.3: an EMPTY asset.name does not crash; fail-closed metadata still sent ─
// The adapter passes asset.name straight through with NO non-empty fallback (see the
// report Discovery). This test locks only that the request stays well-formed and the
// UNLISTED privacy + customer_id are ALWAYS present — it deliberately does NOT assert
// the (currently empty) title value, so a future non-empty-title guard is not blocked.
Deno.test(
  "ADV #1288: an empty asset.name still produces a valid UNLISTED START body (no crash)",
  withGoogle({}, async (calls) => {
    const blankAsset = { ...ASSET, name: "" } as unknown as typeof ASSET;
    const { hooks, calls: h } = recordingHooks();
    await google().initiate(blankAsset, GOOGLE_CONN, BYTES, hooks);
    assertEquals(h.processing, 1); // finalize still succeeded

    const startCall = calls.find((c) =>
      c.url.includes("youTubeVideoUploads:create")
    );
    const body = JSON.parse(String(startCall!.init?.body)) as {
      customer_id?: unknown;
      you_tube_video_upload?: { video_privacy?: unknown };
    };
    assertEquals(body.customer_id, "3623860476");
    assertEquals(body.you_tube_video_upload?.video_privacy, "UNLISTED");
  }),
);

// ── #1288.4: a 401 finalize surfaces the status + SCRUBBED bearer (NO token leak) ─
// Different token + raw body than the implementor's §7. Also proves the ACTUAL log
// line the endpoint composes (`${platform}/${detail}: ${message}`) carries no token.
// Fails-on-revert: reverting the finalize guard to the bare `HTTP {status}.` message
// (no scrubbed body read) fails this — reason + redaction marker disappear.
Deno.test(
  "ADV #1288: a 401 finalize throws with the status + a SCRUBBED Bearer; raw token never reaches the log line",
  withGoogleRawFinalize(
    401,
    `Request had invalid authentication credentials. Authorization: Bearer ${LEAK_BAIT_TOKEN} expected OAuth2`,
    async (_calls) => {
      const { hooks, calls: h } = recordingHooks();
      const err = await assertRejects(
        () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
        CreativeUploadError,
      );
      const ce = err as CreativeUploadError;
      assertEquals(ce.detail, "google_yt_upload_failed");
      assertStringIncludes(ce.message, "401");
      assertStringIncludes(ce.message, "invalid authentication credentials");
      assertStringIncludes(ce.message, "Bearer [redacted]");
      assert(
        !ce.message.includes(LEAK_BAIT_TOKEN),
        "the raw bearer token must never appear in the surfaced error",
      );
      // The EXACT string the endpoint console.errors — must also be token-free.
      const logLine = `${ce.platform}/${ce.detail}: ${ce.message}`;
      assert(
        !logLine.includes(LEAK_BAIT_TOKEN),
        "the composed endpoint log line must not leak the token",
      );
      // Fail-closed: a rejected finalize saves NO ref and never marks processing.
      assertEquals(h.saveCount, 0);
      assertEquals(h.processing, 0);
    },
  ),
);

// ── #1288.5: a Meta-shaped EAA token in the finalize body is ALSO redacted ────
// scrubCreativeSecrets composes scrubMetaTokens (EAA…) + the Bearer redaction, so a
// stray EAA-shaped token in a provider body is scrubbed too (defense-in-depth).
Deno.test(
  "ADV #1288: a Meta EAA-shaped token in the finalize body is redacted, never surfaced raw",
  withGoogleRawFinalize(
    400,
    "metadata rejected near token EAABsomeReallyLongMetaTokenValue1234567890 please retry",
    async (_calls) => {
      const { hooks } = recordingHooks();
      const err = await assertRejects(
        () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
        CreativeUploadError,
      );
      const ce = err as CreativeUploadError;
      assertEquals(ce.detail, "google_yt_upload_failed");
      assertStringIncludes(ce.message, "400");
      assert(
        !ce.message.includes("EAABsomeReallyLongMetaTokenValue1234567890"),
        "a Meta EAA-shaped token must be scrubbed from the surfaced error",
      );
      assertStringIncludes(ce.message, "[redacted]");
    },
  ),
);

// ── #1288.6: a 400 metadata rejection is fail-closed TERMINAL (RC-2 discriminator) ─
// The status surfaced pins RC-2 (400 metadata) vs RC-1 (401/403 auth). No ref, no
// processing — a bad START metadata can never leak a half-ready asset.
Deno.test(
  "ADV #1288: a 400 metadata rejection throws google_yt_upload_failed with the reason; ZERO ref, ZERO processing",
  withGoogleRawFinalize(
    400,
    '{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"you_tube_video_upload.video_privacy is required"}}',
    async (_calls) => {
      const { hooks, calls: h } = recordingHooks();
      const err = await assertRejects(
        () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
        CreativeUploadError,
      );
      const ce = err as CreativeUploadError;
      assertEquals(ce.detail, "google_yt_upload_failed");
      assertStringIncludes(ce.message, "400");
      assertStringIncludes(ce.message, "INVALID_ARGUMENT");
      assertEquals(h.saveCount, 0);
      assertEquals(h.processing, 0);
    },
  ),
);

// ── #1288.7: the surfaced finalize body is length-bounded (slice(0,300) caps leak) ─
// A token beyond the 300-char window is TRUNCATED AWAY entirely — it never reaches
// the message, so even an unredacted shape past the window cannot leak.
Deno.test(
  "ADV #1288: a token beyond the 300-char finalize slice is truncated away, never surfaced",
  withGoogleRawFinalize(
    500,
    "x".repeat(350) + " Bearer " + "FARLEAKMARKER_ya29.wontshow0123456789",
    async (_calls) => {
      const { hooks } = recordingHooks();
      const err = await assertRejects(
        () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
        CreativeUploadError,
      );
      const ce = err as CreativeUploadError;
      assertStringIncludes(ce.message, "500");
      assert(
        !ce.message.includes("FARLEAKMARKER"),
        "a body token beyond the 300-char slice must be truncated away",
      );
      // Sanity: the message is bounded (prefix + status + <=300 body chars).
      assert(ce.message.length < 420, "surfaced message must stay bounded");
    },
  ),
);

// ── #1288.8: a 200 finalize whose resourceName is NON-STRING is terminal ──────
// Type-guard attack: neither a numeric top-level resourceName nor a null nested one
// is a valid resource — must go terminal, never a false-ready ref.
Deno.test(
  "ADV #1288: a 200 finalize with a NON-STRING resourceName is terminal (no false ready)",
  withGoogle(
    {
      finalizeBody: {
        resourceName: 12345,
        youTubeVideoUpload: { resourceName: null },
      },
    },
    async (_calls) => {
      const { hooks, calls: h } = recordingHooks();
      const err = await assertRejects(
        () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
        CreativeUploadError,
      );
      assertEquals(
        (err as CreativeUploadError).detail,
        "google_yt_resource_missing",
      );
      assertEquals(h.saveCount, 0);
      assertEquals(h.processing, 0);
    },
  ),
);

// ── #1288.9: a 200 finalize with an EMPTY-STRING resourceName is terminal ─────
// An empty string is `typeof === "string"` but falsy — the `!resourceName` guard
// must still reject it, never persist an empty ref.
Deno.test(
  "ADV #1288: a 200 finalize with an EMPTY-STRING resourceName is terminal (no empty ref persisted)",
  withGoogle({ finalizeBody: { resourceName: "" } }, async (_calls) => {
    const { hooks, calls: h } = recordingHooks();
    const err = await assertRejects(
      () => google().initiate(ASSET, GOOGLE_CONN, BYTES, hooks),
      CreativeUploadError,
    );
    assertEquals(
      (err as CreativeUploadError).detail,
      "google_yt_resource_missing",
    );
    assertEquals(h.saveCount, 0);
    assertEquals(h.processing, 0);
  }),
);

// ── #1288.10: endpoint no-regression — the new log is platform-agnostic & ordered ─
// Cross-platform proof by SOURCE (the endpoint is not runtime-invokable in a
// hermetic Deno test without the full serve harness). The initiate-catch change must
// NOT alter Meta/Snap/TikTok behavior: the console.error sits AFTER the trust +
// rate-limit early-returns, BEFORE the single generic CAS, is not gated on platform,
// and the only new value import is CreativeUploadError.
Deno.test("ADV #1288: the endpoint initiate-catch log is platform-agnostic, ordered after trust+rate-limit, envelope unchanged", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );

  const trustIdx = src.indexOf("error instanceof CreativeTrustError");
  const rateIdx = src.indexOf("error instanceof ProviderRateLimitError");
  const logIdx = src.indexOf("[admin-ad-creative-prepare] initiate failed:");
  const casIdx = src.indexOf('error_code: "provider_init_failed"');
  assert(trustIdx > -1, "trust early-return must exist");
  assert(rateIdx > trustIdx, "rate-limit early-return must follow trust");
  assert(logIdx > rateIdx, "the log must sit AFTER both early-returns");
  assert(casIdx > logIdx, "the generic CAS must follow the log");

  // Exactly ONE generic failure envelope — no per-platform divergence was added.
  assertEquals(src.match(/error_code: "provider_init_failed"/g)?.length, 1);
  assertEquals(
    src.match(/\n {8}502,/g)?.length ?? src.match(/ 502,/g)?.length,
    1,
  );

  // The failure path between the log and the CAS is NOT gated on platform.
  const between = src.slice(logIdx, casIdx);
  assert(
    !between.includes("platform ==="),
    "the generic failure path must stay platform-agnostic",
  );

  // The console.error has a non-CreativeUploadError fallback arm, so a Meta/Snap/
  // TikTok initiate error that is NOT a CreativeUploadError still logs AND still
  // falls through to the SAME generic envelope (behavior unchanged for them).
  assertStringIncludes(src, "error instanceof CreativeUploadError");
  assertStringIncludes(src, "error instanceof Error");
  assertStringIncludes(src, "String(error)");

  // Blast radius: the ONLY new value import from adCreative.ts is CreativeUploadError.
  assertStringIncludes(
    src,
    'import { CreativeUploadError } from "../_shared/adCreative.ts";',
  );
});
