/**
 * ISSUE-866 WP3 — adCreative.ts resolver + upload-adapter tests (implementor
 * happy-path suite; APPEND-ONLY). ZERO live platform calls — every network
 * seam is an injected fetch stub (deps.fetchImpl) or a scoped globalThis.fetch
 * stub (metaGraph, which resolves fetch globally by WP1 design).
 *
 * Contract coverage:
 *   RT-1/AC-4  content-hash cache keying: a cached `ready` ref with a MATCHING
 *              hash returns with ZERO adapter/upload calls; a hash MISMATCH
 *              forces a fresh upload (A1-1/GR-53).
 *   RT-2/AC-5  fail-close: adapter failure → ref `failed` + typed throw; the
 *              matrix gate blocks BEFORE any platform call.
 *   A1-2       Snap token minted per call from SNAPCHAT_REFRESH_TOKEN/
 *              _CLIENT_ID/_CLIENT_SECRET names; the invented static-token
 *              name appears nowhere (issue-866 strict-grep gate).
 *   A1-3       Snap envelope double-assert: request_status AND every
 *              sub_request_status.
 *   A1-5       Google unique asset names auto-suffix on duplicate-name errors.
 *   A1-9       TikTok captures BOTH the raw id AND material_id; file-name
 *              collision → timestamp suffix.
 *   A1-1       Reddit adapter is a typed fail-close stub.
 *   COMMS-0102 crawler-UA URL check: robots-blocked → fail; 200 media → pass.
 *   RT-4       schema pins: place_pool FK, no new venue table, 'snapchat' not
 *              'snap', content_hash NOT NULL (reads the migration file).
 *   AC-8       no token value ever appears in normalized errors.
 *
 * Run: deno test --allow-env --allow-read --no-check \
 *   supabase/functions/_shared/__tests__/adCreative.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow, Lane, Platform } from "../adChannel.ts";
import {
  type AdCreativeRow,
  assertSnapEnvelope,
  checkCreativeUrlCrawlerAccessible,
  CREATIVE_UPLOAD_ADAPTERS,
  CreativeConnectionError,
  CreativeLaneNotProvisionedError,
  CreativeNotFoundError,
  type CreativeRefDb,
  CreativeRefLockedError,
  type CreativeRefRow,
  CreativeUploadError,
  type CreativeUploadAdapter,
  type CreativeUploadedRef,
  CreativeValidationError,
  googleAssetName,
  googleCreativeAdapter,
  metaCreativeAdapter,
  mintSnapAccessToken,
  normalizeCreativeError,
  resolveCreativeRef,
  resolveVideoByteSourceUrl,
  robotsDisallows,
  scrubCreativeSecrets,
  snapchatCreativeAdapter,
  tiktokCreativeAdapter,
  redditCreativeAdapter,
} from "../adCreative.ts";
import { makeJpeg, makeMp4, makePng } from "./adCreativeProbe.test.ts";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const NO_SLEEP = (): Promise<void> => Promise.resolve();

function connection(platform: Platform, overrides: Partial<AdConnectionRow> = {}): AdConnectionRow {
  return {
    id: "00000000-0000-0000-0000-00000000c001",
    platform,
    lane: "consumer",
    display_name: `${platform} · Consumer`,
    external_account_id: "acct-123",
    external_org_id: null,
    auth_kind: "system_user_token",
    token_env_var: "META_SYSTEM_USER_TOKEN",
    extra: { page_id: "page-1" },
    status: "connected",
    currency: "USD",
    timezone: null,
    min_daily_budget_cents: 100,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
    ...overrides,
  };
}

function imageCreative(overrides: Partial<AdCreativeRow> = {}): AdCreativeRow {
  return {
    id: "00000000-0000-0000-0000-00000000a001",
    kind: "image",
    name: "rooftop-venue-shot",
    source_url: "https://cdn.example.com/rooftop.jpg",
    storage_bucket: "meta-ad-creatives",
    storage_path: "creatives/rooftop.jpg",
    bunny_video_id: null,
    poster_url: null,
    mp4_master_url: null,
    place_id: null,
    brand_id: null,
    width: 1440,
    height: 1800,
    aspect_ratio: 0.8,
    duration_seconds: null,
    mime_type: "image/jpeg",
    byte_size: 2 * 1024 * 1024,
    has_audio: null,
    content_hash: "hash-current",
    ai_generated: true,
    variants: {},
    status: "active",
    ...overrides,
  };
}

function videoCreative(overrides: Partial<AdCreativeRow> = {}): AdCreativeRow {
  return imageCreative({
    id: "00000000-0000-0000-0000-00000000a002",
    kind: "video",
    name: "venue-teaser",
    source_url: "https://vz-x.b-cdn.net/teaser/playlist.m3u8",
    bunny_video_id: "bunny-1",
    poster_url: "https://cdn.example.com/poster.jpg",
    mp4_master_url: "https://cdn.example.com/teaser-master.mp4",
    duration_seconds: 30,
    mime_type: "video/mp4",
    byte_size: 10 * 1024 * 1024,
    has_audio: true,
    aspect_ratio: 0.5625,
    width: 1080,
    height: 1920,
    ...overrides,
  });
}

interface FakeDbState {
  connection: AdConnectionRow | null;
  creative: AdCreativeRow | null;
  ref: CreativeRefRow | null;
  uploadingUpserts: number;
  readyMarks: { ref: CreativeUploadedRef; contentHash: string }[];
  failedMarks: string[];
}

function fakeDb(state: FakeDbState): CreativeRefDb {
  return {
    // deno-lint-ignore require-await
    getConnection: async () => state.connection,
    // deno-lint-ignore require-await
    getCreative: async () => state.creative,
    // deno-lint-ignore require-await
    getRef: async () => state.ref,
    // deno-lint-ignore require-await
    upsertRefUploading: async () => {
      state.uploadingUpserts++;
    },
    // deno-lint-ignore require-await
    markRefReady: async (_c, _p, _l, _a, ref, contentHash) => {
      state.readyMarks.push({ ref, contentHash });
    },
    // deno-lint-ignore require-await
    markRefFailed: async (_c, _p, _l, _a, error) => {
      state.failedMarks.push(error);
    },
  };
}

function readyRef(contentHash: string, overrides: Partial<CreativeRefRow> = {}): CreativeRefRow {
  return {
    id: "00000000-0000-0000-0000-00000000r001",
    creative_id: "00000000-0000-0000-0000-00000000a001",
    platform: "meta",
    lane: "consumer",
    external_account_id: "acct-123",
    external_kind: "image",
    external_ref: "cached-hash-abc",
    external_ref_extra: { cached: true },
    content_hash: contentHash,
    status: "ready",
    error: null,
    uploaded_at: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

function countingAdapter(platform: Platform): { adapter: CreativeUploadAdapter; calls: () => number } {
  let count = 0;
  return {
    adapter: {
      platform,
      // deno-lint-ignore require-await
      upload: async (): Promise<CreativeUploadedRef> => {
        count++;
        return {
          external_kind: "image",
          external_ref: `fresh-upload-${count}`,
          external_ref_extra: {},
          external_account_id: "acct-123",
        };
      },
    },
    calls: () => count,
  };
}

function adaptersWith(platform: Platform, adapter: CreativeUploadAdapter): Record<Platform, CreativeUploadAdapter> {
  return { ...CREATIVE_UPLOAD_ADAPTERS, [platform]: adapter };
}

// ── RT-1 / AC-4: content-hash cache keying ────────────────────────────────────

Deno.test("resolver: a cached ready ref with a MATCHING content hash returns with ZERO uploads", async () => {
  // PROTECTED GUARD (RT-1): reverting the SELECT-ready-ref-before-upload guard
  // in resolveCreativeRef makes this fail — every ad would re-upload the asset
  // (double storage spend; on Google, immutable-asset churn that restarts review).
  const { adapter, calls } = countingAdapter("meta");
  const state: FakeDbState = {
    connection: connection("meta"),
    creative: imageCreative({ content_hash: "hash-current" }),
    ref: readyRef("hash-current"),
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  const result = await resolveCreativeRef(fakeDb(state), state.creative!.id, "meta", "consumer", {
    adapters: adaptersWith("meta", adapter),
    sleep: NO_SLEEP,
  });
  assertEquals(result.external_ref, "cached-hash-abc");
  assertEquals(calls(), 0); // THE idempotency win — zero platform calls
  assertEquals(state.uploadingUpserts, 0);
});

Deno.test("resolver: a cached ready ref with a MISMATCHED hash forces a FRESH upload (A1-1)", async () => {
  const { adapter, calls } = countingAdapter("meta");
  const state: FakeDbState = {
    connection: connection("meta"),
    creative: imageCreative({ content_hash: "hash-NEW" }),
    ref: readyRef("hash-STALE"),
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  const result = await resolveCreativeRef(fakeDb(state), state.creative!.id, "meta", "consumer", {
    adapters: adaptersWith("meta", adapter),
    sleep: NO_SLEEP,
  });
  assertEquals(calls(), 1);
  assertEquals(result.external_ref, "fresh-upload-1");
  assertEquals(state.uploadingUpserts, 1);
  assertEquals(state.readyMarks.length, 1);
  assertEquals(state.readyMarks[0].contentHash, "hash-NEW"); // hash snapshot updated
});

Deno.test("resolver: a `failed` ref re-uploads (retry path)", async () => {
  const { adapter, calls } = countingAdapter("meta");
  const state: FakeDbState = {
    connection: connection("meta"),
    creative: imageCreative(),
    ref: readyRef("hash-current", { status: "failed", external_ref: null }),
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  await resolveCreativeRef(fakeDb(state), state.creative!.id, "meta", "consumer", {
    adapters: adaptersWith("meta", adapter),
    sleep: NO_SLEEP,
  });
  assertEquals(calls(), 1);
});

Deno.test("resolver: a persistent `uploading` lock throws retryable CreativeRefLockedError", async () => {
  const { adapter, calls } = countingAdapter("meta");
  const state: FakeDbState = {
    connection: connection("meta"),
    creative: imageCreative(),
    ref: readyRef("hash-current", { status: "uploading", external_ref: null }),
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  await assertRejects(
    () =>
      resolveCreativeRef(fakeDb(state), state.creative!.id, "meta", "consumer", {
        adapters: adaptersWith("meta", adapter),
        sleep: NO_SLEEP,
      }),
    CreativeRefLockedError,
  );
  assertEquals(calls(), 0); // never double-uploads through a held lock
});

// ── Fail-close legs (AC-5 / SC-SEC-5) ─────────────────────────────────────────

Deno.test("resolver: missing/invalid connection fails close BEFORE anything else", async () => {
  const { adapter, calls } = countingAdapter("meta");
  const state: FakeDbState = {
    connection: null,
    creative: imageCreative(),
    ref: null,
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  await assertRejects(
    () =>
      resolveCreativeRef(fakeDb(state), state.creative!.id, "meta", "consumer", {
        adapters: adaptersWith("meta", adapter),
        sleep: NO_SLEEP,
      }),
    CreativeConnectionError,
  );
  assertEquals(calls(), 0);
});

Deno.test("resolver: an archived creative fails close (CreativeNotFoundError)", async () => {
  const state: FakeDbState = {
    connection: connection("meta"),
    creative: imageCreative({ status: "archived" }),
    ref: null,
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  await assertRejects(
    () => resolveCreativeRef(fakeDb(state), state.creative!.id, "meta", "consumer", { sleep: NO_SLEEP }),
    CreativeNotFoundError,
    "archived",
  );
});

Deno.test("resolver: the matrix gate blocks a silent video for TikTok BEFORE any upload", async () => {
  const { adapter, calls } = countingAdapter("tiktok");
  const state: FakeDbState = {
    connection: connection("tiktok", { token_env_var: "TIKTOK_ACCESS_TOKEN" }),
    creative: videoCreative({ has_audio: false }),
    ref: null,
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  await assertRejects(
    () =>
      resolveCreativeRef(fakeDb(state), state.creative!.id, "tiktok", "consumer", {
        adapters: adaptersWith("tiktok", adapter),
        sleep: NO_SLEEP,
      }),
    CreativeValidationError,
    "no sound",
  );
  assertEquals(calls(), 0); // fail-close BEFORE the platform call
  assertEquals(state.uploadingUpserts, 0);
});

Deno.test("resolver: adapter failure → ref marked `failed` + typed CreativeUploadError (no orphan)", async () => {
  const failing: CreativeUploadAdapter = {
    platform: "meta",
    // deno-lint-ignore require-await
    upload: async () => {
      throw new Error("Graph exploded (fbtrace 123)");
    },
  };
  const state: FakeDbState = {
    connection: connection("meta"),
    creative: imageCreative(),
    ref: null,
    uploadingUpserts: 0,
    readyMarks: [],
    failedMarks: [],
  };
  await assertRejects(
    () =>
      resolveCreativeRef(fakeDb(state), state.creative!.id, "meta", "consumer", {
        adapters: adaptersWith("meta", failing),
        sleep: NO_SLEEP,
      }),
    CreativeUploadError,
  );
  assertEquals(state.readyMarks.length, 0);
  assertEquals(state.failedMarks.length, 1);
  assertStringIncludes(state.failedMarks[0], "Graph exploded");
});

// ── Snap: envelope double-assert (A1-3 step 5, S-P5) ──────────────────────────

Deno.test("Snap envelope: request_status SUCCESS + a sub_request_status FAILURE still THROWS", () => {
  let threw = false;
  try {
    assertSnapEnvelope({
      request_status: "SUCCESS",
      media: [{ sub_request_status: "FAILURE", media: { id: "m1" } }],
    }, "test");
  } catch (err) {
    threw = true;
    assert(err instanceof CreativeUploadError);
    assertStringIncludes(err.message, "sub_request_status=FAILURE");
  }
  assert(threw, "the 200/SUCCESS envelope smuggled a per-entity failure past the assert");
});

Deno.test("Snap envelope: DEEPLY NESTED sub_request_status failures are still caught", () => {
  let threw = false;
  try {
    assertSnapEnvelope({
      request_status: "SUCCESS",
      result: { batch: [{ inner: { sub_request_status: "FAILURE" } }] },
    }, "test");
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("Snap envelope: request_status FAILURE throws even with no sub statuses", () => {
  let threw = false;
  try {
    assertSnapEnvelope({ request_status: "FAILURE" }, "test");
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("Snap envelope: all-SUCCESS passes", () => {
  assertSnapEnvelope({
    request_status: "SUCCESS",
    media: [{ sub_request_status: "SUCCESS", media: { id: "m1" } }],
  }, "test");
});

// ── Snap: token mint (A1-2 — no static token exists) ──────────────────────────

function withSnapEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const names = ["SNAPCHAT_REFRESH_TOKEN", "SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET"];
    const prior = names.map((n) => [n, Deno.env.get(n)] as const);
    Deno.env.set("SNAPCHAT_REFRESH_TOKEN", "refresh-tok-XYZXYZXYZXYZ");
    Deno.env.set("SNAPCHAT_CLIENT_ID", "client-id-1");
    Deno.env.set("SNAPCHAT_CLIENT_SECRET", "client-secret-SSSSSSSSSSSS");
    try {
      await fn();
    } finally {
      for (const [name, value] of prior) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  };
}

Deno.test(
  "Snap mint: refresh-grant POST with the A1-2 env NAMES; token lives in memory only",
  withSnapEnv(async () => {
    let capturedBody = "";
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      assertStringIncludes(url, "accounts.snapchat.com/login/oauth2/access_token");
      capturedBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "minted-access-AAAA", expires_in: 3600 }), { status: 200 }),
      );
    }) as typeof fetch;
    const token = await mintSnapAccessToken({ fetchImpl });
    assertEquals(token, "minted-access-AAAA");
    assertStringIncludes(capturedBody, "grant_type=refresh_token");
    assertStringIncludes(capturedBody, "refresh-tok-XYZXYZXYZXYZ");
  }),
);

Deno.test("Snap mint: missing SNAPCHAT_REFRESH_TOKEN fails close, naming the env var (name, not value)", async () => {
  const prior = Deno.env.get("SNAPCHAT_REFRESH_TOKEN");
  Deno.env.delete("SNAPCHAT_REFRESH_TOKEN");
  try {
    await assertRejects(() => mintSnapAccessToken({ fetchImpl: (() => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch }), CreativeConnectionError, "SNAPCHAT_REFRESH_TOKEN");
  } finally {
    if (prior !== undefined) Deno.env.set("SNAPCHAT_REFRESH_TOKEN", prior);
  }
});

Deno.test(
  "uploadToSnap (image ≤32 MB): create → multipart upload → poll READY → media_id ref",
  withSnapEnv(async () => {
    const seen: string[] = [];
    let statusPolls = 0;
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      seen.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("accounts.snapchat.com")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "minted-BBBB" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/rooftop.jpg")) {
        return Promise.resolve(new Response(makeJpeg(1080, 1920) as unknown as BodyInit, { status: 200 }));
      }
      if (url.endsWith("/adaccounts/acct-123/media")) {
        assert(init?.body && typeof init.body === "string");
        return Promise.resolve(new Response(
          JSON.stringify({
            request_status: "SUCCESS",
            media: [{ sub_request_status: "SUCCESS", media: { id: "media-777", media_status: "PENDING_UPLOAD" } }],
          }),
          { status: 200 },
        ));
      }
      if (url.includes("/media/media-777/upload")) {
        // multipart/form-data, NOT JSON (A1-3) — FormData bodies are not strings.
        assert(init?.body instanceof FormData, "Snap upload must be multipart/form-data");
        return Promise.resolve(new Response(JSON.stringify({ request_status: "SUCCESS" }), { status: 200 }));
      }
      if (url.endsWith("/media/media-777")) {
        statusPolls++;
        const mediaStatus = statusPolls >= 2 ? "READY" : "PENDING_UPLOAD";
        return Promise.resolve(new Response(
          JSON.stringify({
            request_status: "SUCCESS",
            media: [{ sub_request_status: "SUCCESS", media: { id: "media-777", media_status: mediaStatus } }],
          }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await snapchatCreativeAdapter.upload(
      imageCreative(),
      { lane: "consumer" as Lane, external_account_id: "acct-123", tokenEnvVar: "SNAPCHAT_REFRESH_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "media-777");
    assertEquals(result.external_kind, "image");
    assert(statusPolls >= 2, "polled media_status until READY");
  }),
);

// ── Google: unique-name auto-suffix (A1-5) + resumable video (A1-4) ───────────

function withGoogleEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const pairs: [string, string][] = [
      ["GOOGLE_ADS_REFRESH_TOKEN", "g-refresh-RRRR"],
      ["GOOGLE_ADS_OAUTH_CLIENT_ID", "g-client-id"],
      ["GOOGLE_ADS_OAUTH_CLIENT_SECRET", "g-client-secret-GGGG"],
      ["GOOGLE_ADS_DEVELOPER_TOKEN", "g-dev-token-DDDD"],
    ];
    const prior = pairs.map(([n]) => [n, Deno.env.get(n)] as const);
    for (const [n, v] of pairs) Deno.env.set(n, v);
    try {
      await fn();
    } finally {
      for (const [name, value] of prior) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  };
}

Deno.test("googleAssetName: deterministic mingla_{id}_{ratio}_{hash12} shape", () => {
  const name = googleAssetName("abc-123", "1.91:1", "0123456789abcdef0123");
  assertEquals(name, "mingla_abc-123_1_91_1_0123456789ab");
});

Deno.test(
  "uploadToGoogle (image): duplicate asset name → ONE auto-suffixed retry (A1-5)",
  withGoogleEnv(async () => {
    const mutateNames: string[] = [];
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "g-access-CCCC" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/variant-191.jpg")) {
        return Promise.resolve(new Response(makeJpeg(1200, 628) as unknown as BodyInit, { status: 200 }));
      }
      if (url.includes("cdn.example.com/rooftop.jpg")) {
        // The 4:5 master classifies to Google's 4:5 slot and uploads too.
        return Promise.resolve(new Response(makeJpeg(1440, 1800) as unknown as BodyInit, { status: 200 }));
      }
      if (url.includes("assets:mutate")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          operations: { create: { name: string } }[];
        };
        const name = body.operations[0].create.name;
        mutateNames.push(name);
        if (mutateNames.length === 1) {
          return Promise.resolve(new Response(
            JSON.stringify({ error: { message: "Asset with the same name already exists (DUPLICATE_ASSET_NAME)." } }),
            { status: 400 },
          ));
        }
        return Promise.resolve(new Response(
          JSON.stringify({ results: [{ resourceName: `customers/123/assets/99${mutateNames.length}` }] }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const asset = imageCreative({
      variants: {
        "1.91:1": {
          source_url: "https://cdn.example.com/variant-191.jpg",
          width: 1200,
          height: 628,
          content_hash: "vhash",
        },
      },
    });
    const result = await googleCreativeAdapter.upload(
      asset,
      { lane: "consumer", external_account_id: "123", tokenEnvVar: "GOOGLE_ADS_REFRESH_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    // Calls: #1 = 1.91:1 (duplicate name), #2 = 1.91:1 suffixed retry (wins),
    // #3 = the master's own 4:5 slot. external_ref = the 1.91:1 marketing asset.
    assertEquals(mutateNames.length, 3);
    assert(mutateNames[1].startsWith(mutateNames[0] + "_"), "second attempt is the suffixed name");
    assert(mutateNames[1] !== mutateNames[0]);
    assertEquals(result.external_ref, "customers/123/assets/992");
    const ratioMap = result.external_ref_extra.ratio_resource_names as Record<string, string>;
    assertEquals(ratioMap["4:5"], "customers/123/assets/993");
  }),
);

Deno.test(
  "uploadToGoogle (image): NO pre-cropped 1.91:1 slot → typed needs_transcode error, never a half-crop",
  withGoogleEnv(async () => {
    const fetchImpl = ((input: URL | Request | string): Promise<Response> => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "g-access" }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    // Master is 4:5 (0.8) — classifies to Google's 4:5 slot, but the required
    // primary 1.91:1 marketing asset has no source; the edge runtime cannot crop.
    await assertRejects(
      () =>
        googleCreativeAdapter.upload(
          imageCreative(),
          { lane: "consumer", external_account_id: "123", tokenEnvVar: "GOOGLE_ADS_REFRESH_TOKEN" },
          { fetchImpl, sleep: NO_SLEEP },
        ),
      CreativeValidationError,
      "1.91:1",
    );
  }),
);

Deno.test(
  "uploadToGoogle (video): resumable start → upload/finalize → poll PENDING→PROCESSED → youtube video id",
  withGoogleEnv(async () => {
    let polls = 0;
    const commands: string[] = [];
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "g-access" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/teaser-master.mp4")) {
        return Promise.resolve(new Response(
          makeMp4({ durationSeconds: 30, width: 1080, height: 1920, withAudio: true }) as unknown as BodyInit,
          { status: 200 },
        ));
      }
      if (url.includes("youTubeVideoUploads:create")) {
        const headers = new Headers(init?.headers ?? {});
        commands.push(headers.get("X-Goog-Upload-Command") ?? "");
        assertEquals(headers.get("X-Goog-Upload-Protocol"), "resumable");
        return Promise.resolve(new Response("{}", {
          status: 200,
          headers: { "X-Goog-Upload-URL": "https://googleads.googleapis.com/upload-session/42" },
        }));
      }
      if (url.includes("upload-session/42")) {
        const headers = new Headers(init?.headers ?? {});
        commands.push(headers.get("X-Goog-Upload-Command") ?? "");
        assertEquals(headers.get("X-Goog-Upload-Offset"), "0");
        return Promise.resolve(new Response(
          JSON.stringify({ resourceName: "customers/123/youTubeVideoUploads/77" }),
          { status: 200 },
        ));
      }
      if (url.includes("customers/123/youTubeVideoUploads/77")) {
        polls++;
        const state = polls === 1 ? "PENDING" : polls === 2 ? "UPLOADED" : "PROCESSED";
        return Promise.resolve(new Response(
          JSON.stringify({ resourceName: "customers/123/youTubeVideoUploads/77", state, videoId: "yt-video-55" }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await googleCreativeAdapter.upload(
      videoCreative(),
      { lane: "consumer", external_account_id: "123", tokenEnvVar: "GOOGLE_ADS_REFRESH_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "yt-video-55");
    assertEquals(result.external_kind, "video");
    assertEquals(commands, ["start", "upload, finalize"]);
    assertEquals(polls, 3); // PENDING → UPLOADED → PROCESSED
  }),
);

// ── TikTok (A1-9) ─────────────────────────────────────────────────────────────

function withTiktokEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prior = Deno.env.get("TIKTOK_ACCESS_TOKEN");
    Deno.env.set("TIKTOK_ACCESS_TOKEN", "tiktok-token-TTTT");
    try {
      await fn();
    } finally {
      if (prior === undefined) Deno.env.delete("TIKTOK_ACCESS_TOKEN");
      else Deno.env.set("TIKTOK_ACCESS_TOKEN", prior);
    }
  };
}

Deno.test(
  "uploadToTikTok (image): captures BOTH image_id AND material_id; external_ref = material_id",
  withTiktokEnv(async () => {
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("/file/name/check/")) {
        return Promise.resolve(new Response(
          JSON.stringify({ code: 0, message: "OK", data: { is_exist: false } }),
          { status: 200 },
        ));
      }
      if (url.includes("/file/image/ad/upload/")) {
        const headers = new Headers(init?.headers ?? {});
        assertEquals(headers.get("Access-Token"), "tiktok-token-TTTT");
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        assertEquals(body.upload_type, "UPLOAD_BY_URL");
        return Promise.resolve(new Response(
          JSON.stringify({ code: 0, message: "OK", data: { image_id: "img-11", material_id: "mat-22" } }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await tiktokCreativeAdapter.upload(
      imageCreative(),
      { lane: "consumer", external_account_id: "adv-1", tokenEnvVar: "TIKTOK_ACCESS_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "mat-22");
    assertEquals(result.external_ref_extra.image_id, "img-11");
  }),
);

Deno.test(
  "uploadToTikTok: file-name collision → timestamp suffix (A1-9 unique-per-advertiser)",
  withTiktokEnv(async () => {
    let uploadedFileName = "";
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("/file/name/check/")) {
        return Promise.resolve(new Response(
          JSON.stringify({ code: 0, message: "OK", data: { is_exist: true } }),
          { status: 200 },
        ));
      }
      if (url.includes("/file/video/ad/upload/")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        uploadedFileName = String(body.file_name);
        assertEquals(body.flaw_detect, true); // A1-9: Smart Fix ON
        assertEquals(body.auto_fix_enabled, true);
        return Promise.resolve(new Response(
          JSON.stringify({ code: 0, message: "OK", data: [{ video_id: "vid-1", material_id: "mat-1" }] }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await tiktokCreativeAdapter.upload(
      videoCreative(),
      { lane: "consumer", external_account_id: "adv-1", tokenEnvVar: "TIKTOK_ACCESS_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "mat-1");
    assert(/venue-teaser_\d+\.mp4$/.test(uploadedFileName), `suffixed name, got: ${uploadedFileName}`);
  }),
);

Deno.test(
  "uploadToTikTok: a non-zero envelope code fails close with the 10-second-fetch hint",
  withTiktokEnv(async () => {
    const fetchImpl = ((input: URL | Request | string): Promise<Response> => {
      const url = String(input);
      if (url.includes("/file/name/check/")) {
        return Promise.resolve(new Response(JSON.stringify({ code: 0, data: { is_exist: false } }), { status: 200 }));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ code: 40002, message: "url fetch timeout" }),
        { status: 200 },
      ));
    }) as typeof fetch;
    await assertRejects(
      () =>
        tiktokCreativeAdapter.upload(
          imageCreative(),
          { lane: "consumer", external_account_id: "adv-1", tokenEnvVar: "TIKTOK_ACCESS_TOKEN" },
          { fetchImpl, sleep: NO_SLEEP },
        ),
      CreativeUploadError,
      "10-second",
    );
  }),
);

// ── Meta (image bytes → image_hash; video poll; scoped global-fetch stub) ─────

function withMetaEnvAndFetch(
  router: (url: string, init?: RequestInit) => Response | null,
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const envPairs: [string, string][] = [
      ["META_SYSTEM_USER_TOKEN", "EAAtesttokenvalue1234567890abcd"],
      ["META_AD_ACCOUNT_ID", "acct-123"],
      ["META_PAGE_ID", "page-1"],
    ];
    const prior = envPairs.map(([n]) => [n, Deno.env.get(n)] as const);
    for (const [n, v] of envPairs) Deno.env.set(n, v);
    const priorFetch = globalThis.fetch;
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const routed = router(url, init);
      if (routed) return Promise.resolve(routed);
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = priorFetch;
      for (const [name, value] of prior) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  };
}

Deno.test(
  "uploadToMeta (image): source bytes → POST /adimages → image_hash ref",
  withMetaEnvAndFetch(
    (url) => {
      if (url.includes("cdn.example.com/rooftop.jpg")) {
        return new Response(makeJpeg(1440, 1800) as unknown as BodyInit, { status: 200 });
      }
      if (url.includes("act_acct-123/adimages")) {
        return new Response(JSON.stringify({ images: { bytes: { hash: "meta-hash-42" } } }), { status: 200 });
      }
      return null;
    },
    async () => {
      const result = await metaCreativeAdapter.upload(
        imageCreative(),
        {
          lane: "consumer",
          external_account_id: "acct-123",
          tokenEnvVar: "META_SYSTEM_USER_TOKEN",
          connection: connection("meta"),
        },
        { sleep: NO_SLEEP },
      );
      assertEquals(result.external_ref, "meta-hash-42");
      assertEquals(result.external_kind, "image");
    },
  ),
);

Deno.test(
  "uploadToMeta (video): /advideos → poll video_status ready → poster → thumbnail hash in extra (A1-10)",
  (() => {
    let statusPolls = 0;
    return withMetaEnvAndFetch(
      (url, init) => {
        if (url.includes("act_acct-123/advideos")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          assertEquals(body.file_url, "https://cdn.example.com/teaser-master.mp4");
          return new Response(JSON.stringify({ id: "vid-900" }), { status: 200 });
        }
        if (url.includes("/vid-900?fields=status")) {
          statusPolls++;
          const videoStatus = statusPolls >= 2 ? "ready" : "processing";
          return new Response(JSON.stringify({ status: { video_status: videoStatus } }), { status: 200 });
        }
        if (url.includes("cdn.example.com/poster.jpg")) {
          return new Response(makeJpeg(1080, 1920) as unknown as BodyInit, { status: 200 });
        }
        if (url.includes("act_acct-123/adimages")) {
          return new Response(JSON.stringify({ images: { bytes: { hash: "thumb-hash-7" } } }), { status: 200 });
        }
        return null;
      },
      async () => {
        const result = await metaCreativeAdapter.upload(
          videoCreative(),
          {
            lane: "consumer",
            external_account_id: "acct-123",
            tokenEnvVar: "META_SYSTEM_USER_TOKEN",
            connection: connection("meta"),
          },
          { sleep: NO_SLEEP },
        );
        assertEquals(result.external_ref, "vid-900");
        assertEquals(result.external_kind, "video");
        assertEquals(result.external_ref_extra.thumbnail_image_hash, "thumb-hash-7");
        assert(statusPolls >= 2, "polled until video_status=ready");
      },
    );
  })(),
);

// ── Reddit — A1-1 fail-close stub ─────────────────────────────────────────────

Deno.test("uploadToReddit: typed lane-not-provisioned throw (no media id exists on a Reddit ad)", async () => {
  await assertRejects(
    () =>
      redditCreativeAdapter.upload(
        imageCreative(),
        { lane: "consumer", external_account_id: "a2_x", tokenEnvVar: "REDDIT_ADS_REFRESH_TOKEN" },
      ),
    CreativeLaneNotProvisionedError,
    "t3_ post",
  );
});

// ── COMMS-0102: crawler-UA URL check ──────────────────────────────────────────

Deno.test("robotsDisallows: facebookexternalhit-specific Disallow / blocks", () => {
  const robots = "User-agent: facebookexternalhit\nDisallow: /\n";
  assertEquals(robotsDisallows(robots, "facebookexternalhit", "/img/a.jpg"), true);
});

Deno.test("robotsDisallows: star-group Disallow blocks; a longer Allow wins", () => {
  const robots = "User-agent: *\nDisallow: /private/\nAllow: /private/ads/\n";
  assertEquals(robotsDisallows(robots, "facebookexternalhit", "/private/x.jpg"), true);
  assertEquals(robotsDisallows(robots, "facebookexternalhit", "/private/ads/x.jpg"), false);
  assertEquals(robotsDisallows(robots, "facebookexternalhit", "/public/x.jpg"), false);
});

Deno.test("robotsDisallows: a specific facebookexternalhit group overrides the star group", () => {
  const robots = "User-agent: *\nDisallow: /\n\nUser-agent: facebookexternalhit\nAllow: /\n";
  assertEquals(robotsDisallows(robots, "facebookexternalhit", "/img/a.jpg"), false);
});

Deno.test("crawler check: robots-blocked host → tier FAIL with the COMMS-0102 subcode context", async () => {
  const fetchImpl = ((input: URL | Request | string): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) {
      return Promise.resolve(new Response("User-agent: facebookexternalhit\nDisallow: /\n", { status: 200 }));
    }
    throw new Error(`asset fetch must not run after a robots block: ${url}`);
  }) as typeof fetch;
  const result = await checkCreativeUrlCrawlerAccessible("https://blocked.example.com/ad.jpg", {
    deps: { fetchImpl },
    strict: true,
  });
  assertEquals(result.tier, "fail");
  assertEquals(result.robotsBlocked, true);
  assertStringIncludes(result.detail, "3858258");
});

Deno.test("crawler check: robots 404 + crawler-UA 200 image/* → PASS", async () => {
  let assetUa = "";
  const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return Promise.resolve(new Response("not found", { status: 404 }));
    assetUa = new Headers(init?.headers ?? {}).get("User-Agent") ?? "";
    return Promise.resolve(new Response("binary", { status: 200, headers: { "content-type": "image/jpeg" } }));
  }) as typeof fetch;
  const result = await checkCreativeUrlCrawlerAccessible("https://ok.example.com/ad.jpg", {
    deps: { fetchImpl },
  });
  assertEquals(result.tier, "pass");
  assertStringIncludes(assetUa, "facebookexternalhit"); // fetched AS the crawler
});

Deno.test("crawler check: crawler-UA 403 → FAIL (Meta's crawler sees the same)", async () => {
  const fetchImpl = ((input: URL | Request | string): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(new Response("forbidden", { status: 403 }));
  }) as typeof fetch;
  const result = await checkCreativeUrlCrawlerAccessible("https://gated.example.com/ad.jpg", {
    deps: { fetchImpl },
    strict: true,
  });
  assertEquals(result.tier, "fail");
  assertEquals(result.httpStatus, 403);
});

Deno.test("crawler check: 200 with an HTML interstitial content-type → WARN (never silently pass)", async () => {
  const fetchImpl = ((input: URL | Request | string): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
  }) as typeof fetch;
  const result = await checkCreativeUrlCrawlerAccessible("https://interstitial.example.com/ad.jpg", {
    deps: { fetchImpl },
  });
  assertEquals(result.tier, "warn");
});

Deno.test("crawler check: non-strict (non-Meta channels) maps failures to WARN", async () => {
  const fetchImpl = ((input: URL | Request | string): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) {
      return Promise.resolve(new Response("User-agent: *\nDisallow: /\n", { status: 200 }));
    }
    return Promise.resolve(new Response("x", { status: 200, headers: { "content-type": "image/png" } }));
  }) as typeof fetch;
  const result = await checkCreativeUrlCrawlerAccessible("https://blocked.example.com/v.mp4", {
    deps: { fetchImpl },
    strict: false,
  });
  assertEquals(result.tier, "warn");
  assertEquals(result.robotsBlocked, true);
});

// ── Byte-source rules (A1-3) ──────────────────────────────────────────────────

Deno.test("resolveVideoByteSourceUrl: mp4_master_url wins; HLS-only fails close with the A1-3 message", () => {
  assertEquals(resolveVideoByteSourceUrl(videoCreative()), "https://cdn.example.com/teaser-master.mp4");
  let threw = false;
  try {
    resolveVideoByteSourceUrl(videoCreative({ mp4_master_url: null }));
  } catch (err) {
    threw = true;
    assertStringIncludes((err as Error).message, "Bunny serves HLS");
  }
  assert(threw);
});

Deno.test("resolveVideoByteSourceUrl: a direct-MP4 source_url is accepted when no master exists", () => {
  const url = resolveVideoByteSourceUrl(
    videoCreative({ mp4_master_url: null, source_url: "https://cdn.example.com/direct.mp4?v=1" }),
  );
  assertEquals(url, "https://cdn.example.com/direct.mp4?v=1");
});

// ── AC-8: no token leak ───────────────────────────────────────────────────────

Deno.test("scrub: Meta EAA tokens and Bearer credentials never survive into normalized errors", () => {
  const dirty =
    "Graph call failed with Authorization: Bearer EAAtesttokenvalue1234567890abcd and header Bearer sk_live_abcdefghijklmnop";
  const clean = scrubCreativeSecrets(dirty);
  assert(!clean.includes("EAAtesttokenvalue1234567890abcd"));
  assert(!clean.includes("sk_live_abcdefghijklmnop"));
  const normalized = normalizeCreativeError("meta", new Error(dirty));
  assert(!normalized.message.includes("EAAtesttokenvalue"));
});

// ── RT-4 + A1-1 schema pins (reads the WP3 migration — allow-read) ────────────

const MIGRATION_PATH = new URL(
  "../../../migrations/20261231000866_issue_866_creative_library.sql",
  import.meta.url,
);

Deno.test("RT-4: ad_creatives.place_id FKs the EXISTING public.place_pool — no new venue table", async () => {
  const sql = await Deno.readTextFile(MIGRATION_PATH);
  assertStringIncludes(sql, "REFERENCES public.place_pool(id)");
  assert(!/CREATE TABLE[^;]*\b(venues|ad_venues)\b/i.test(sql), "a fabricated venue table appeared");
});

Deno.test("A1-1: the platform CHECK says 'snapchat' (never 'snap') and includes 'reddit'", async () => {
  const sql = await Deno.readTextFile(MIGRATION_PATH);
  assertStringIncludes(sql, "'meta','tiktok','snapchat','google','reddit'");
  assert(!/'snap'/.test(sql), "the bare 'snap' literal silently breaks the cache key (GR-14)");
});

Deno.test("A1-1: content_hash is NOT NULL on BOTH tables; the ref cache is UNIQUE on the idempotency key", async () => {
  const sql = await Deno.readTextFile(MIGRATION_PATH);
  const hashCols = sql.match(/content_hash\s+text NOT NULL/g) ?? [];
  assertEquals(hashCols.length, 2);
  assertStringIncludes(sql, "UNIQUE (creative_id, platform, lane, external_account_id)");
});

Deno.test("OD-4/A1-8c: the video poster CHECK stands; ads.creative_id FK is the WP1-promised constraint", async () => {
  const sql = await Deno.readTextFile(MIGRATION_PATH);
  assertStringIncludes(sql, "kind <> 'video' OR (bunny_video_id IS NOT NULL AND poster_url IS NOT NULL)");
  assertStringIncludes(sql, "ADD CONSTRAINT ads_creative_id_fkey");
  assertStringIncludes(sql, "ai_generated       boolean NOT NULL DEFAULT false");
});
