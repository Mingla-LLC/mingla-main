// ISSUE-997 C — INDEPENDENT TESTER adversarial suite (TikTok paused-video create).
//
// Written from a DIFFERENT angle than the implementor happy-path
// (issue997_tiktok_video_create.test.ts). The implementor proved the SINGLE_VIDEO
// builder emits the right shape and the prepare adapter captures a cover on the
// SUCCESS path; this suite attacks the NEGATIVE space:
//   • SINGLE_IMAGE must NEVER leak a video_id even when a caller passes one.
//   • SINGLE_VIDEO trims the video_id and rejects whitespace / falsy cover ids.
//   • ad_format matching is EXACT-string (case/whitespace-sensitive) — no smuggling.
//   • the video COVER rides image_ids and the VIDEO rides video_id — never swapped.
//   • the duration policy gate bites at the 4/5/60/61 boundaries (+0/NaN/spark).
//   • a prepare that FAILS to capture a cover never reaches markProcessing → it can
//     never present a falsely-complete READY ref (the cover is hashed from the
//     POSTER bytes, never the video bytes).
//   • Google + Reddit video create remain HARD fail-closed in the create branch,
//     advertiser-scoped READY-ref resolution, BOTH-required completeness, and the
//     TikTok validate_only no-op are preserved (structural — the create branch is a
//     heavy serve() handler; these are backstopped by the live PAUSED probe).
//
// NO live provider calls, NO ad objects, NO spend: pure builders + mocked fetch +
// read-only source assertions only. Scope D (Google video) is NOT built and is only
// asserted to REMAIN fail-closed here.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow } from "../adChannel.ts";
import { AdApiError } from "../adChannel.ts";
import type { AdCreativeRow } from "../adCreative.ts";
import { md5Hex, PREPARE_PROVIDER_ADAPTERS } from "../adCreativePrepare.ts";
import {
  buildTikTokAdBody,
  TIKTOK_VIDEO_MAX_DURATION_SECONDS,
  TIKTOK_VIDEO_MIN_DURATION_SECONDS,
  validateTikTokVideoDuration,
} from "../tiktok.ts";

const ADVERTISER = "7627974536397766673";
const ADGROUP = "1234567890123456789";
const IDENTITY = "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5";
const LANDING = "https://host.usemingla.com/e/brand/event";

function videoSpec(overrides: Record<string, unknown> = {}) {
  return {
    adName: "issue997 tester ad",
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

function imageSpec(overrides: Record<string, unknown> = {}) {
  return {
    adName: "issue997 tester image ad",
    identityType: "TT_USER",
    identityId: IDENTITY,
    adFormat: "SINGLE_IMAGE",
    imageIds: ["img-1"],
    adText: "Find your next experience on Mingla",
    landingPageUrl: LANDING,
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function creativeOf(body: Record<string, unknown>): Record<string, unknown> {
  return (body.creatives as Record<string, unknown>[])[0];
}

// Narrows the TikTokValidation union so a rejected duration exposes its detail code.
function durationDetail(seconds: number, opts?: { spark?: boolean }): string {
  const r = validateTikTokVideoDuration(seconds, opts);
  return r.ok ? "" : r.detail;
}

// ── A. Builder negative space ────────────────────────────────────────────────

// DIFFERENT ANGLE: the implementor proves SINGLE_IMAGE (with no videoId) omits
// video_id. The regression risk is the INVERSE — an image ad that is ALSO handed a
// stray videoId must still never emit video_id (else an image ad ships a phantom
// video reference). Fails-on-revert: change the create body's
// `...(adFormat === "SINGLE_VIDEO" ? { video_id } : {})` to always-emit → RED.
Deno.test("ISSUE-997 C adversarial: SINGLE_IMAGE never leaks a video_id even when one is passed", () => {
  const body = buildTikTokAdBody(
    ADVERTISER,
    ADGROUP,
    imageSpec({ videoId: "vid-should-be-ignored" }),
  );
  const creative = creativeOf(body);
  assertEquals(creative.ad_format, "SINGLE_IMAGE");
  assertEquals("video_id" in creative, false);
  assertEquals(creative.operation_status, "DISABLE");
});

// DIFFERENT ANGLE: implementor tests videoId:"" ; whitespace must ALSO be rejected
// (the builder .trim()s). A "   " video_id would otherwise create a video ad with
// no real asset. Fails-on-revert: drop the `.trim()`/video_id_required check → RED.
Deno.test("ISSUE-997 C adversarial: SINGLE_VIDEO rejects a whitespace-only video_id (trim enforced)", () => {
  const err = assertThrows(
    () => buildTikTokAdBody(ADVERTISER, ADGROUP, videoSpec({ videoId: "   " })),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "video_id_required");
});

// DIFFERENT ANGLE: implementor tests imageIds [] and ["a","b"]. A single FALSY
// element [""] is the sneaky one — length is 1 but there is no cover. Must still
// reject image_ids_invalid.
Deno.test("ISSUE-997 C adversarial: SINGLE_VIDEO rejects a single empty-string cover id", () => {
  const err = assertThrows(
    () => buildTikTokAdBody(ADVERTISER, ADGROUP, videoSpec({ imageIds: [""] })),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "image_ids_invalid");
});

// DIFFERENT ANGLE: the cover must ride image_ids and the video must ride video_id —
// never swapped, never merged. Proves the exact wire separation the live probe pins.
Deno.test("ISSUE-997 C adversarial: cover rides image_ids, the prepared video rides video_id (never swapped)", () => {
  const body = buildTikTokAdBody(
    ADVERTISER,
    ADGROUP,
    videoSpec({ imageIds: ["the-cover"], videoId: "the-video" }),
  );
  const creative = creativeOf(body);
  assertEquals(creative.ad_format, "SINGLE_VIDEO");
  assertEquals(creative.image_ids, ["the-cover"]);
  assertEquals(creative.video_id, "the-video");
  // never the reverse
  assert(creative.video_id !== "the-cover");
  assert((creative.image_ids as string[])[0] !== "the-video");
  // PAUSED at the ad level — nothing launches.
  assertEquals(creative.operation_status, "DISABLE");
});

// DIFFERENT ANGLE: ad_format is matched by EXACT string. Case/whitespace variants of
// SINGLE_VIDEO must NOT slip through the two-format allow-list — they hard-fail like
// any unsupported format. Guards against a loose (lowercased/normalized) comparison.
Deno.test("ISSUE-997 C adversarial: ad_format match is exact — case/whitespace variants are rejected", () => {
  for (
    const bad of [
      "single_video",
      "SINGLE_VIDEO ",
      " SINGLE_VIDEO",
      "Single_Video",
      "VIDEO",
      "SINGLE_CAROUSEL",
    ]
  ) {
    const err = assertThrows(
      () =>
        buildTikTokAdBody(ADVERTISER, ADGROUP, videoSpec({ adFormat: bad })),
      AdApiError,
      undefined,
      `ad_format="${bad}" must be rejected`,
    );
    assertEquals((err as AdApiError).code, "ad_format_unsupported_v1");
  }
});

// ── B. Duration policy gate boundaries (the 4/5/60/61 requirement + edges) ────
// The create branch calls validateTikTokVideoDuration(duration_seconds) as its
// 5–60 s gate. This pins the boundary math directly.
Deno.test("ISSUE-997 C adversarial: duration gate — 4s reject / 5s pass / 60s pass / 61s reject", () => {
  assertEquals(TIKTOK_VIDEO_MIN_DURATION_SECONDS, 5);
  assertEquals(TIKTOK_VIDEO_MAX_DURATION_SECONDS, 60);
  assertEquals(validateTikTokVideoDuration(4).ok, false);
  assertEquals(durationDetail(4), "video_duration_policy");
  assertEquals(validateTikTokVideoDuration(5).ok, true);
  assertEquals(validateTikTokVideoDuration(60).ok, true);
  assertEquals(validateTikTokVideoDuration(61).ok, false);
  assertEquals(durationDetail(61), "video_duration_policy");
});

Deno.test("ISSUE-997 C adversarial: duration gate — 0/negative/NaN/Infinity are invalid, not merely policy", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertEquals(
      validateTikTokVideoDuration(bad).ok,
      false,
      `duration ${bad} must be rejected`,
    );
    assertEquals(
      durationDetail(bad),
      "video_duration_invalid",
      `duration ${bad} is invalid, not policy`,
    );
  }
});

Deno.test("ISSUE-997 C adversarial: spark exception raises the ceiling to 600s but still rejects 601", () => {
  assertEquals(validateTikTokVideoDuration(600, { spark: true }).ok, true);
  assertEquals(validateTikTokVideoDuration(601, { spark: true }).ok, false);
  // 61s is fine under spark, but rejected on the default advertising path.
  assertEquals(validateTikTokVideoDuration(61, { spark: true }).ok, true);
  assertEquals(validateTikTokVideoDuration(61).ok, false);
});

// ── C. Prepare-side cover capture failure ordering ───────────────────────────

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

const VIDEO_BYTES = new Uint8Array([1, 2, 3]);
const POSTER_BYTES = new Uint8Array([9, 8, 7, 6]);

function videoOkResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 0,
      data: { list: [{ material_id: "mat-1", video_id: "vid-1" }] },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// DIFFERENT ANGLE: the implementor asserts the cover-missing case THROWS. The
// stronger invariant is that when it throws, the ref is NEVER promoted — saveProviderRef
// (video) happened but mergeProviderExtra + markProcessing did NOT. A "processing"/"ready"
// ref therefore can never exist without a cover. AND the cover is hashed from the POSTER
// bytes, not the video bytes.
Deno.test("ISSUE-997 C adversarial: a failed cover capture leaves the ref un-promoted (no merge, no markProcessing) + cover signs the POSTER bytes", async () => {
  Deno.env.set("TIKTOK_TEST_TOKEN", "test-token");
  const calls: string[] = [];
  let imageSignature = "";
  let imageUploadType = "";
  let imageAdvertiser = "";
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/file/video/ad/upload/")) {
      calls.push("video-upload");
      return Promise.resolve(videoOkResponse());
    }
    if (url.includes("/file/image/ad/upload/")) {
      calls.push("image-upload");
      const form = init?.body as FormData;
      imageSignature = String(form.get("image_signature") ?? "");
      imageUploadType = String(form.get("upload_type") ?? "");
      imageAdvertiser = String(form.get("advertiser_id") ?? "");
      // TikTok returns NO image_id for the cover.
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: 0, data: { material_id: "img-mat-1" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    );
  };

  let threw = false;
  try {
    await PREPARE_PROVIDER_ADAPTERS.tiktok.initiate(
      videoAsset,
      tiktokConnection,
      { video: VIDEO_BYTES, poster: POSTER_BYTES },
      {
        saveProviderRef: () => {
          calls.push("saveProviderRef");
          return Promise.resolve(true);
        },
        mergeProviderExtra: () => {
          calls.push("mergeProviderExtra");
          return Promise.resolve(true);
        },
        markProcessing: () => {
          calls.push("markProcessing");
          return Promise.resolve(true);
        },
      },
      { fetchImpl },
    );
  } catch (err) {
    threw = true;
    assertStringIncludes((err as Error).message, "cover image_id");
  }
  assert(threw, "a missing cover image_id must fail the prepare");
  // The video ref WAS saved, but the ref was never promoted to processing.
  assert(
    calls.includes("saveProviderRef"),
    "video ref should be saved before the cover attempt",
  );
  assertEquals(
    calls.includes("mergeProviderExtra"),
    false,
    "no cover ⇒ never merged",
  );
  assertEquals(
    calls.includes("markProcessing"),
    false,
    "no cover ⇒ never markProcessing (no falsely-complete ref)",
  );
  // The cover is signed from the POSTER bytes — never the video bytes.
  assertEquals(imageUploadType, "UPLOAD_BY_FILE");
  assertEquals(imageAdvertiser, ADVERTISER);
  assertEquals(imageSignature, md5Hex(POSTER_BYTES));
  assert(
    imageSignature !== md5Hex(VIDEO_BYTES),
    "cover must NOT be hashed from the video bytes",
  );
});

// DIFFERENT ANGLE: a TikTok API-level error (code != 0) on the cover upload must also
// abort BEFORE markProcessing — never a silent success.
Deno.test("ISSUE-997 C adversarial: a TikTok API error on the cover upload aborts before markProcessing", async () => {
  Deno.env.set("TIKTOK_TEST_TOKEN", "test-token");
  const calls: string[] = [];
  const fetchImpl = (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/file/video/ad/upload/")) {
      return Promise.resolve(videoOkResponse());
    }
    if (url.includes("/file/image/ad/upload/")) {
      calls.push("image-upload");
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: 40001, message: "bad image", data: {} }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    );
  };
  let threw = false;
  try {
    await PREPARE_PROVIDER_ADAPTERS.tiktok.initiate(
      videoAsset,
      tiktokConnection,
      { video: VIDEO_BYTES, poster: POSTER_BYTES },
      {
        saveProviderRef: () => Promise.resolve(true),
        mergeProviderExtra: () => {
          calls.push("mergeProviderExtra");
          return Promise.resolve(true);
        },
        markProcessing: () => {
          calls.push("markProcessing");
          return Promise.resolve(true);
        },
      },
      { fetchImpl },
    );
  } catch {
    threw = true;
  }
  assert(threw, "an API error on the cover upload must throw");
  assertEquals(calls.includes("mergeProviderExtra"), false);
  assertEquals(calls.includes("markProcessing"), false);
});

// ── D. Create-branch structural safety (Google/Reddit fail-closed; scoping) ──
// The TikTok video create branch is inside a heavy serve() handler with deep Supabase
// deps, so these are read-only SOURCE assertions (the LIVE PAUSED probe is the runtime
// gate). They attack the SAFETY invariants from angles the happy-path .ts did not: the
// SINGLE_VIDEO seam is confined to the TikTok branch, and the READY-ref resolve is
// advertiser-scoped.
async function createSource(): Promise<string> {
  return await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
}

Deno.test("ISSUE-997 C/D2/#1185 adversarial [structural]: NO video create stays hard fail-closed — Reddit is now wired too", async () => {
  const src = await createSource();
  // [TEST-MOD-APPROVED ORCH-1185] D2 wired Google Demand Gen video create; #1185
  // then wired Reddit paused-video create (the last platform still closed). So the
  // "only Reddit stays fail-closed" assertion is obsolete — ZERO blanket phase-A
  // 422s remain. Reddit's guard is now the #866-hosted structured-post video build.
  assert(
    !src.includes("video_create_not_available_phase_a"),
    "no video-create phase-A 422 may remain — every platform is wired",
  );
  // Reddit video is now wired (no 422): it resolves the #866 clip → type:"VIDEO".
  assertStringIncludes(src, "reddit_video_library_required");
  // The SINGLE_VIDEO (TikTok) seam must NOT appear in the Google or Reddit branches;
  // Google video is a Demand Gen ad (demandGenVideoResponsiveAd), not SINGLE_VIDEO.
  const gStart = src.indexOf('if (platform === "google")');
  const gEnd = src.indexOf('if (platform === "snapchat")');
  const rStart = src.indexOf('if (platform === "reddit")');
  assert(
    gStart >= 0 && gEnd > gStart && rStart > gEnd,
    "could not bound the google/reddit branches",
  );
  const googleBranch = src.slice(gStart, gEnd);
  const redditBranch = src.slice(rStart);
  assert(
    !googleBranch.includes("SINGLE_VIDEO"),
    "no SINGLE_VIDEO seam in the Google branch",
  );
  assert(
    !redditBranch.includes("SINGLE_VIDEO"),
    "no SINGLE_VIDEO seam in the Reddit branch",
  );
  // Google is now wired as a Demand Gen video create (not a phase-A 422).
  assertStringIncludes(googleBranch, "googleCreateDemandGenVideoCampaign");
  assert(
    !googleBranch.includes("video_create_not_available_phase_a"),
    "Google video create must no longer fail closed",
  );
});

Deno.test("ISSUE-997 C adversarial [structural]: the TikTok video READY-ref resolve is advertiser-scoped and requires BOTH ids", async () => {
  const src = await createSource();
  const tStart = src.indexOf('if (platform === "tiktok")');
  const tEnd = src.indexOf('if (platform === "reddit")', tStart);
  assert(tStart >= 0 && tEnd > tStart, "could not bound the TikTok branch");
  const tiktokBranch = src.slice(tStart, tEnd);
  // Advertiser-scoped + content-hash-keyed + kind/status-gated READY ref — a ref
  // prepared for a DIFFERENT advertiser or from DIFFERENT bytes can never serve.
  assertStringIncludes(
    tiktokBranch,
    '.eq("external_account_id", tconn.external_account_id)',
  );
  assertStringIncludes(tiktokBranch, '.eq("external_kind", "video")');
  assertStringIncludes(
    tiktokBranch,
    '.eq("content_hash", libCreativeVT.content_hash)',
  );
  assertStringIncludes(tiktokBranch, '.eq("status", "ready")');
  // BOTH video_id AND cover_image_id required (disjunctive guard) → creative_ref_incomplete.
  assertStringIncludes(
    tiktokBranch,
    "if (!preparedVideoIdT || !coverImageIdT)",
  );
  assertStringIncludes(tiktokBranch, "creative_ref_incomplete");
  assertStringIncludes(tiktokBranch, "creative_ref_stale");
  // The create-time UPLOAD_BY_URL path (if (!imageIdT)) is IMAGE-only — for video the
  // cover already sets imageIdT, so create never uploads provider media inline.
  assertStringIncludes(tiktokBranch, "create never uploads inline");
  // TikTok validate_only stays the named-skipped no-op (no create, no upload).
  assertStringIncludes(tiktokBranch, "tiktok_no_validate_only");
  // Duration gate is wired on the video path.
  assertStringIncludes(
    tiktokBranch,
    "validateTikTokVideoDuration(libCreativeVT.duration_seconds)",
  );
});
