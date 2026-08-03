// ISSUE-997 C implementor regression — TikTok paused-video create.
// NO live provider calls, NO ad objects, NO spend: mocked fetch + pure builders +
// create-branch source assertions only. Fails-on-revert targets are called out
// per test. Scope D (Google video) is a separate sub-wave and is NOT exercised here.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow } from "../adChannel.ts";
import { AdApiError } from "../adChannel.ts";
import type { AdCreativeRow } from "../adCreative.ts";
import {
  capabilityFor,
  PREPARE_PROVIDER_ADAPTERS,
} from "../adCreativePrepare.ts";
import { buildTikTokAdBody } from "../tiktok.ts";

const ADVERTISER = "7627974536397766673";
const IDENTITY = "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5";
const LANDING = "https://business.usemingla.com/e/brand/event";

const tiktokConnection: AdConnectionRow = {
  id: "connection",
  platform: "tiktok",
  lane: "consumer",
  display_name: "TikTok",
  external_account_id: ADVERTISER,
  external_org_id: null,
  auth_kind: "dev_token_oauth",
  token_env_var: "TIKTOK_TEST_TOKEN",
  extra: {},
  status: "connected",
  currency: "USD",
  timezone: "UTC",
  min_daily_budget_cents: 100,
  account_status: "ACTIVE",
  token_last_verified_at: null,
  connected: true,
};

const videoAsset: AdCreativeRow = {
  id: "creative",
  kind: "video",
  name: "video",
  source_url: null,
  storage_bucket: null,
  storage_path: null,
  bunny_video_id: "bunny",
  poster_url: "https://cdn/poster.jpg",
  mp4_master_url: "https://cdn/master.mp4",
  place_id: null,
  brand_id: null,
  width: 1080,
  height: 1920,
  aspect_ratio: 0.5625,
  duration_seconds: 10,
  mime_type: "video/mp4",
  byte_size: 3,
  has_audio: true,
  content_hash: "hash",
  poster_content_hash: "poster-hash",
  ai_generated: false,
  variants: {},
  status: "active",
};

function videoSpec(overrides: Record<string, unknown> = {}) {
  return {
    adName: "issue997 ad",
    identityType: "TT_USER",
    identityId: IDENTITY,
    adFormat: "SINGLE_VIDEO",
    imageIds: ["cover-1"],
    videoId: "vid-1",
    adText: "Find your next experience on Mingla",
    landingPageUrl: LANDING,
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

// ── Capability label (surfaced by admin-ad-creative-prepare) ─────────────────
// The capability string is COSMETIC — no code gates create on it (create is gated
// by the admin VIDEO_CREATE_ENABLED / VIDEO_CREATE_PLATFORMS lists + the create-branch
// READY-ref resolve). Flipping it to "create_and_real_preview" (spec §2.4) would force
// a TEST-MOD on the core #1184 edge regression for zero functional gain, so it is
// DEFERRED to the orchestrator. This test pins the deliberate current value so the
// deferral is explicit and a future flip is a conscious decision, not a silent drift.
Deno.test("ISSUE-997 C capabilityFor(tiktok) label is intentionally deferred at preview_only (cosmetic, non-gating)", () => {
  assertEquals(capabilityFor("tiktok"), "preview_only");
});

// ── Prepare-side cover capture (D-C1: prepare-side, keeps create ref-pure) ────
// Fails-on-revert: deleting the `await uploadTiktokCover(...)` line in
// tiktokPrepareAdapter.initiate drops the image upload + cover_image_id merge +
// markProcessing → the ordered-calls / merged assertions below FAIL.
Deno.test("ISSUE-997 C prepare uploads the ad video AND captures the cover image_id", async () => {
  Deno.env.set("TIKTOK_TEST_TOKEN", "test-token");
  const calls: string[] = [];
  const merged: Record<string, unknown>[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const which = url.includes("/file/video/ad/upload/")
      ? "video"
      : url.includes("/file/image/ad/upload/")
      ? "image"
      : "other";
    calls.push(`${init?.method}:${which}`);
    if (which === "video") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 0,
            data: { list: [{ material_id: "mat-1", video_id: "vid-1" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (which === "image") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 0,
            data: { image_id: "cover-1", material_id: "img-mat-1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    );
  };
  await PREPARE_PROVIDER_ADAPTERS.tiktok.initiate(
    videoAsset,
    tiktokConnection,
    { video: new Uint8Array([1, 2, 3]), poster: new Uint8Array([4, 5, 6]) },
    {
      saveProviderRef: (ref, extra) => {
        calls.push(`save:${ref}:${JSON.stringify(extra ?? {})}`);
        return Promise.resolve(true);
      },
      mergeProviderExtra: (extra) => {
        merged.push(extra);
        return Promise.resolve(true);
      },
      markProcessing: () => {
        calls.push("markProcessing");
        return Promise.resolve(true);
      },
    },
    { fetchImpl },
  );
  // Order: video upload → saveProviderRef(video_id) → cover image upload →
  // mergeProviderExtra(cover_image_id) → markProcessing.
  assertEquals(calls[0], "POST:video");
  assertStringIncludes(calls[1], "save:mat-1");
  assertStringIncludes(calls[1], "vid-1");
  assertEquals(calls[2], "POST:image");
  assertEquals(calls[3], "markProcessing");
  assertEquals(merged.length, 1);
  assertEquals(merged[0].cover_image_id, "cover-1");
});

Deno.test("ISSUE-997 C prepare fails closed when TikTok returns no cover image_id", async () => {
  Deno.env.set("TIKTOK_TEST_TOKEN", "test-token");
  const fetchImpl = (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/file/video/ad/upload/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 0,
            data: { list: [{ material_id: "mat-1", video_id: "vid-1" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    // image upload returns no image_id
    return Promise.resolve(
      new Response(
        JSON.stringify({ code: 0, data: { material_id: "img-mat-1" } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  };
  let threw = false;
  try {
    await PREPARE_PROVIDER_ADAPTERS.tiktok.initiate(
      videoAsset,
      tiktokConnection,
      { video: new Uint8Array([1, 2, 3]), poster: new Uint8Array([4, 5, 6]) },
      {
        saveProviderRef: () => Promise.resolve(true),
        mergeProviderExtra: () => Promise.resolve(true),
        markProcessing: () => Promise.resolve(true),
      },
      { fetchImpl },
    );
  } catch (err) {
    threw = true;
    assertStringIncludes((err as Error).message, "cover image_id");
  }
  assert(
    threw,
    "a missing cover image_id must fail the prepare, never a silent ready",
  );
});

// ── SINGLE_VIDEO ad-object builder ────────────────────────────────────────────
// Fails-on-revert: reverting the SINGLE_VIDEO branch in buildTikTokAdBody (back to
// the SINGLE_IMAGE-only hard-fail) makes the happy-path build throw → this FAILS.
Deno.test("ISSUE-997 C buildTikTokAdBody emits a PAUSED SINGLE_VIDEO creative (video_id + cover image_ids)", () => {
  const body = buildTikTokAdBody(
    ADVERTISER,
    "1234567890123456789",
    videoSpec(),
  );
  const creative = (body.creatives as Record<string, unknown>[])[0];
  assertEquals(creative.ad_format, "SINGLE_VIDEO");
  assertEquals(creative.video_id, "vid-1");
  assertEquals(creative.image_ids, ["cover-1"]);
  // PAUSED at the ad level — nothing ever launches.
  assertEquals(creative.operation_status, "DISABLE");
});

Deno.test("ISSUE-997 C SINGLE_VIDEO requires a prepared video_id", () => {
  const err = assertThrows(
    () =>
      buildTikTokAdBody(
        ADVERTISER,
        "1234567890123456789",
        videoSpec({ videoId: "" }),
      ),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "video_id_required");
});

Deno.test("ISSUE-997 C SINGLE_VIDEO requires exactly one cover image_id", () => {
  const zero = assertThrows(
    () =>
      buildTikTokAdBody(
        ADVERTISER,
        "1234567890123456789",
        videoSpec({ imageIds: [] }),
      ),
    AdApiError,
  );
  assertEquals((zero as AdApiError).code, "image_ids_invalid");
  const two = assertThrows(
    () =>
      buildTikTokAdBody(
        ADVERTISER,
        "1234567890123456789",
        videoSpec({ imageIds: ["a", "b"] }),
      ),
    AdApiError,
  );
  assertEquals((two as AdApiError).code, "image_ids_invalid");
});

Deno.test("ISSUE-997 C SINGLE_IMAGE is UNREGRESSED — no video_id key emitted", () => {
  const body = buildTikTokAdBody(ADVERTISER, "1234567890123456789", {
    adName: "issue997 image ad",
    identityType: "TT_USER",
    identityId: IDENTITY,
    adFormat: "SINGLE_IMAGE",
    imageIds: ["img-1"],
    adText: "Find your next experience on Mingla",
    landingPageUrl: LANDING,
    // deno-lint-ignore no-explicit-any
  } as any);
  const creative = (body.creatives as Record<string, unknown>[])[0];
  assertEquals(creative.ad_format, "SINGLE_IMAGE");
  assertEquals("video_id" in creative, false);
  assertEquals(creative.operation_status, "DISABLE");
});

Deno.test("ISSUE-997 C an unsupported ad_format still hard-fails ad_format_unsupported_v1", () => {
  const err = assertThrows(
    () =>
      buildTikTokAdBody(
        ADVERTISER,
        "1234567890123456789",
        videoSpec({ adFormat: "SINGLE_CAROUSEL" }),
      ),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "ad_format_unsupported_v1");
});

// ── Create-branch wiring (source assertions — the branch has heavy Supabase deps
//    that make a full runtime call impractical here; the tester's adversarial
//    suite + the downstream PAUSED acceptance probe exercise it live). ──────────
async function createSource(): Promise<string> {
  return await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
}

Deno.test("ISSUE-997 C the TikTok video seam is OPENED (no blanket phase-A 422)", async () => {
  const source = await createSource();
  // The blanket TikTok video 422 must be gone from the TikTok branch. (Google and
  // Reddit keep their own phase-A 422s — scope D / out of scope — so bound the
  // slice to the TikTok branch, which ends where the Reddit branch begins.)
  const start = source.indexOf('if (platform === "tiktok")');
  const end = source.indexOf('platform === "reddit"', start);
  assert(
    start >= 0 && end > start,
    "could not locate the TikTok branch bounds",
  );
  const tiktokBranch = source.slice(start, end);
  assert(
    !tiktokBranch.includes("video_create_not_available_phase_a"),
    "the TikTok branch must no longer hard-fail video create",
  );
  assertStringIncludes(
    source,
    'const creativeKindT = creativeT.kind === "video" ? "video" : "image";',
  );
});

Deno.test("ISSUE-997 C the create branch resolves an exact READY video ref and enforces completeness + duration + PAUSED", async () => {
  const source = await createSource();
  // READY-ref resolution keyed on content + external_kind=video + status=ready.
  assertStringIncludes(source, '.eq("external_kind", "video")');
  assertStringIncludes(
    source,
    '.eq("content_hash", libCreativeVT.content_hash)',
  );
  assertStringIncludes(source, '.eq("status", "ready")');
  // BOTH the prepared video_id and cover_image_id are required (fail-closed).
  assertStringIncludes(source, "creative_ref_incomplete");
  assertStringIncludes(source, "refExtraVT.video_id");
  assertStringIncludes(source, "refExtraVT.cover_image_id");
  // 5–60 s advertising-policy duration gate.
  assertStringIncludes(
    source,
    "validateTikTokVideoDuration(libCreativeVT.duration_seconds)",
  );
  // The ad object is built as SINGLE_VIDEO and threads the prepared video_id.
  assertStringIncludes(
    source,
    'const adFormatT = creativeKindT === "video" ? "SINGLE_VIDEO" : "SINGLE_IMAGE";',
  );
  assertStringIncludes(source, "adFormat: adFormatT");
  assertStringIncludes(source, "...(videoIdT ? { videoId: videoIdT } : {})");
  // TikTok has NO validate_only — the named-skipped no-op is preserved.
  assertStringIncludes(source, "tiktok_no_validate_only");
});
