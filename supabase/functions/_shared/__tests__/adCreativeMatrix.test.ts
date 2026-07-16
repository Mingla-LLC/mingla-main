/**
 * ISSUE-866 WP3 — adCreativeMatrix.ts tier tests (implementor happy-path
 * suite; APPEND-ONLY).
 *
 * Contract under test (A1-6b/c):
 *   - HARD-REJECT rows BITE only when tagged [SPEC]/[OFFICIAL];
 *   - [3P]/[SECONDARY]/[HOUSE] rows are WARN-only via the CENTRAL downgrade —
 *     all of Reddit's pixel/byte numbers must never reject;
 *   - deterministic-fix gaps surface as typed needs_transcode (the edge
 *     runtime cannot transcode);
 *   - DO-NOT-BUILD rows are ABSENT (no Meta bitrate rule, no 60/90 Reels cap,
 *     no Meta text-density rule).
 *
 * REGRESSION CONTRACT (fails-on-revert): the audio-required HARD-REJECT
 * (TikTok "video.audio_required" + Snap missing_audio) — deleting that block
 * from adCreativeMatrix.ts makes the audio tests below FAIL.
 *
 * Run: deno test --allow-env --allow-read --no-check \
 *   supabase/functions/_shared/__tests__/adCreativeMatrix.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  classifyRatio,
  type CreativeMediaFacts,
  validateCreativeForChannel,
  validateCreativeForChannels,
} from "../adCreativeMatrix.ts";

// ── Fact fixtures ─────────────────────────────────────────────────────────────

function videoFacts(overrides: Partial<CreativeMediaFacts> = {}): CreativeMediaFacts {
  return {
    kind: "video",
    mimeType: "video/mp4",
    container: "mp4/isom",
    width: 1080,
    height: 1920,
    aspectRatio: 0.5625,
    durationSeconds: 30,
    hasAudio: true,
    byteSize: 10 * 1024 * 1024,
    overallBitrateKbps: 2500,
    posterPresent: true,
    variantRatios: [],
    ...overrides,
  };
}

function imageFacts(overrides: Partial<CreativeMediaFacts> = {}): CreativeMediaFacts {
  return {
    kind: "image",
    mimeType: "image/jpeg",
    container: null,
    width: 1440,
    height: 1800,
    aspectRatio: 0.8,
    durationSeconds: null,
    hasAudio: null,
    byteSize: 2 * 1024 * 1024,
    overallBitrateKbps: null,
    posterPresent: false,
    variantRatios: [],
    ...overrides,
  };
}

function ruleLevels(platform: Parameters<typeof validateCreativeForChannel>[0], facts: CreativeMediaFacts): Map<string, string> {
  const result = validateCreativeForChannel(platform, facts);
  return new Map(result.checks.map((c) => [c.rule, c.level]));
}

// ── THE fails-on-revert anchor: audio-required HARD-REJECT bites ──────────────

Deno.test("TikTok: silent video HARD-REJECTS (audio is REQUIRED — [OFFICIAL])", () => {
  const result = validateCreativeForChannel("tiktok", videoFacts({ hasAudio: false }));
  assertEquals(result.ok, false);
  const check = result.checks.find((c) => c.rule === "video.audio_required");
  assert(check, "audio_required check must exist");
  assertEquals(check.level, "reject");
  assert(check.message.includes("no sound"), "carries the §1.5 operator message");
});

Deno.test("Snapchat: silent video HARD-REJECTS as missing_audio (Low-Quality Creative)", () => {
  const result = validateCreativeForChannel("snapchat", videoFacts({ hasAudio: false }));
  assertEquals(result.ok, false);
  const check = result.checks.find((c) => c.rule === "video.audio_required");
  assert(check);
  assertEquals(check.level, "reject");
  assert(check.message.includes("missing_audio"));
});

Deno.test("audio present: neither TikTok nor Snap fires the audio reject", () => {
  for (const platform of ["tiktok", "snapchat"] as const) {
    const result = validateCreativeForChannel(platform, videoFacts({ hasAudio: true }));
    const audio = result.checks.find((c) => c.rule === "video.audio_required");
    assertEquals(audio?.level ?? "pass", audio ? audio.level : "pass");
    assert(!result.checks.some((c) => c.rule === "video.audio_required" && c.level === "reject"));
  }
});

Deno.test("audio UNPROBEABLE (null): surfaced as not_evaluable, never silently passed", () => {
  const result = validateCreativeForChannel("tiktok", videoFacts({ hasAudio: null }));
  const check = result.checks.find((c) => c.rule === "video.audio_required");
  assert(check);
  assertEquals(check.level, "not_evaluable");
});

// ── TikTok tiers ──────────────────────────────────────────────────────────────

Deno.test("TikTok: 3-minute video HARD-REJECTS on the 5–60 s POLICY (the 10-min trap)", () => {
  const result = validateCreativeForChannel("tiktok", videoFacts({ durationSeconds: 180 }));
  const check = result.checks.find((c) => c.rule === "video.duration_policy");
  assert(check);
  assertEquals(check.level, "reject");
  assert(check.message.includes("advertising policy is 5–60 seconds"));
  assert(check.message.includes("rejected in review"));
});

Deno.test("TikTok: 4-second video also rejects (below the 5 s floor)", () => {
  const result = validateCreativeForChannel("tiktok", videoFacts({ durationSeconds: 4 }));
  assertEquals(result.ok, false);
});

Deno.test("TikTok: 30-second 9:16 video with audio passes the duration/ratio gates", () => {
  const result = validateCreativeForChannel("tiktok", videoFacts());
  assert(!result.checks.some((c) => c.level === "reject"), JSON.stringify(result.checks));
});

Deno.test("TikTok: off-list ratio (4:5) without a variant → typed needs_transcode, NOT a half-transcode", () => {
  const result = validateCreativeForChannel("tiktok", videoFacts({ aspectRatio: 0.8, width: 960, height: 1200 }));
  const check = result.checks.find((c) => c.rule === "video.ratio");
  assert(check);
  assertEquals(check.level, "needs_transcode");
  assertEquals(result.needsTranscode, true);
});

Deno.test("TikTok: off-list ratio WITH a covering variant slot downgrades to warn", () => {
  const result = validateCreativeForChannel(
    "tiktok",
    videoFacts({ aspectRatio: 0.8, width: 960, height: 1200, variantRatios: ["9:16"] }),
  );
  const check = result.checks.find((c) => c.rule === "video.ratio");
  assert(check);
  assertEquals(check.level, "warn");
  assertEquals(result.needsTranscode, false);
});

Deno.test("TikTok: sub-516 kbps bitrate rejects (TikTok's number IS official)", () => {
  const result = validateCreativeForChannel("tiktok", videoFacts({ overallBitrateKbps: 400 }));
  const check = result.checks.find((c) => c.rule === "video.min_bitrate");
  assert(check);
  assertEquals(check.level, "reject");
});

Deno.test("TikTok: 540×960 vertical passes the floor but WARNS below 720p", () => {
  const levels = ruleLevels("tiktok", videoFacts({ width: 540, height: 960 }));
  assertEquals(levels.get("video.min_resolution"), undefined);
  assertEquals(levels.get("video.recommended_resolution"), "warn");
});

Deno.test("TikTok: 480×854 vertical rejects below the 540×960 floor", () => {
  const levels = ruleLevels("tiktok", videoFacts({ width: 480, height: 854, aspectRatio: 0.5621 }));
  assertEquals(levels.get("video.min_resolution"), "reject");
});

Deno.test("TikTok: watermark + black-bar rules surface as not_evaluable (frame decode impossible in edge)", () => {
  const levels = ruleLevels("tiktok", videoFacts());
  assertEquals(levels.get("video.watermarks"), "not_evaluable");
  assertEquals(levels.get("video.black_bars"), "not_evaluable");
});

Deno.test("TikTok: safe-zone defaults are HOUSE numbers — warn, never reject", () => {
  const check = validateCreativeForChannel("tiktok", videoFacts())
    .checks.find((c) => c.rule === "video.safe_zone");
  assert(check);
  assertEquals(check.level, "warn");
  assertEquals(check.confidence, "HOUSE");
});

Deno.test("TikTok image: WebP rejects (jpg/jpeg/png only)", () => {
  const result = validateCreativeForChannel("tiktok", imageFacts({ mimeType: "image/webp" }));
  assertEquals(result.ok, false);
});

// ── Snapchat tiers ────────────────────────────────────────────────────────────

Deno.test("Snapchat: 16:9 video → needs_transcode on the exact-9:16 rule (|w/h−0.5625|≤0.01)", () => {
  const result = validateCreativeForChannel(
    "snapchat",
    videoFacts({ aspectRatio: 1.7778, width: 1920, height: 1080 }),
  );
  const check = result.checks.find((c) => c.rule === "video.aspect_ratio");
  assert(check);
  assertEquals(check.level, "needs_transcode");
  assert(check.message.includes("invalid_aspect_ratio"));
});

Deno.test("Snapchat: 200-second Top Snap rejects (3–180 s; the 1800 s figure is LONGFORM)", () => {
  const result = validateCreativeForChannel("snapchat", videoFacts({ durationSeconds: 200 }));
  const check = result.checks.find((c) => c.rule === "video.duration");
  assert(check);
  assertEquals(check.level, "reject");
  assert(check.message.includes("3 to 180 seconds"));
});

Deno.test("Snapchat: 720×1280 video rejects below the 1080×1920 floor", () => {
  const result = validateCreativeForChannel("snapchat", videoFacts({ width: 720, height: 1280 }));
  const check = result.checks.find((c) => c.rule === "video.resolution");
  assert(check);
  assertEquals(check.level, "reject");
});

Deno.test("Snapchat: 6 MB image HARD-REJECTS at the 5 MB cap (the 30 MB-bucket trap)", () => {
  const result = validateCreativeForChannel(
    "snapchat",
    imageFacts({ byteSize: 6 * 1024 * 1024, width: 1080, height: 1920, aspectRatio: 0.5625 }),
  );
  const check = result.checks.find((c) => c.rule === "image.max_bytes");
  assert(check);
  assertEquals(check.level, "reject");
  assert(check.message.includes("image_too_large"));
});

Deno.test("Snapchat: codec row is [SECONDARY] → centrally downgraded to warn", () => {
  const check = validateCreativeForChannel("snapchat", videoFacts())
    .checks.find((c) => c.rule === "video.codec");
  assert(check);
  assertEquals(check.confidence, "SECONDARY");
  assertEquals(check.level, "warn"); // written as reject in the row; the downgrade is structural
});

Deno.test("Snapchat: 40 MB video warns about the chunked path but does not reject", () => {
  const levels = ruleLevels("snapchat", videoFacts({ byteSize: 40 * 1024 * 1024 }));
  assertEquals(levels.get("video.chunked_path"), "warn");
  assertEquals(levels.get("video.max_bytes"), undefined);
});

Deno.test("Snapchat: >1 GB video rejects (32 × 32 MB ceiling)", () => {
  const levels = ruleLevels("snapchat", videoFacts({ byteSize: 1100 * 1024 * 1024 }));
  assertEquals(levels.get("video.max_bytes"), "reject");
});

// ── Meta tiers ────────────────────────────────────────────────────────────────

Deno.test("Meta: 35 MB image rejects at the 30 MB cap", () => {
  const result = validateCreativeForChannel("meta", imageFacts({ byteSize: 35 * 1024 * 1024 }));
  assertEquals(result.ok, false);
});

Deno.test("Meta: 500 px-wide image rejects the 600 px API floor", () => {
  const result = validateCreativeForChannel(
    "meta",
    imageFacts({ width: 500, height: 625, aspectRatio: 0.8 }),
  );
  const check = result.checks.find((c) => c.rule === "image.min_width");
  assert(check);
  assertEquals(check.level, "reject");
});

Deno.test("Meta: GIF image rejects (not in the supported list)", () => {
  const result = validateCreativeForChannel("meta", imageFacts({ mimeType: "image/gif" }));
  assertEquals(result.ok, false);
});

Deno.test("Meta: off-list ratio (16:9 image) → needs_transcode without a variant", () => {
  const result = validateCreativeForChannel(
    "meta",
    imageFacts({ aspectRatio: 1.7778, width: 1920, height: 1080 }),
  );
  const check = result.checks.find((c) => c.rule === "image.ratio");
  assert(check);
  assertEquals(check.level, "needs_transcode");
});

Deno.test("Meta: 200-second video rejects the Advantage+ 5–180 s intersection", () => {
  const result = validateCreativeForChannel("meta", videoFacts({ durationSeconds: 200 }));
  const check = result.checks.find((c) => c.rule === "video.duration");
  assert(check);
  assertEquals(check.level, "reject");
});

Deno.test("Meta: NO 60/90-second Reels cap — a 120 s video passes duration (A1-7 DO-NOT-BUILD)", () => {
  const result = validateCreativeForChannel("meta", videoFacts({ durationSeconds: 120 }));
  assert(!result.checks.some((c) => c.rule === "video.duration" && c.level === "reject"));
});

Deno.test("Meta: NO video-bitrate rule exists (folklore — A1-7 DO-NOT-BUILD)", () => {
  const result = validateCreativeForChannel("meta", videoFacts({ overallBitrateKbps: 100 }));
  assert(!result.checks.some((c) => c.rule.includes("bitrate")));
});

Deno.test("Meta: NO text-density (20%) rule exists anywhere (DEAD since ~Sept 2020)", () => {
  for (const facts of [imageFacts(), videoFacts()]) {
    const result = validateCreativeForChannel("meta", facts);
    assert(!result.checks.some((c) => c.rule.includes("text_density") || c.message.includes("20%")));
  }
});

Deno.test("Meta: missing poster on video rejects (OD-4 / video_data thumbnail)", () => {
  const result = validateCreativeForChannel("meta", videoFacts({ posterPresent: false }));
  const check = result.checks.find((c) => c.rule === "video.thumbnail");
  assert(check);
  assertEquals(check.level, "reject");
});

Deno.test("Meta: 9:16 video carries the exact §1.5 safe-zone WARN", () => {
  const check = validateCreativeForChannel("meta", videoFacts())
    .checks.find((c) => c.rule === "video.safe_zone_9_16");
  assert(check);
  assertEquals(check.level, "warn");
  assert(check.message.includes("top 14% and bottom 35%"));
});

// ── Google tiers ──────────────────────────────────────────────────────────────

Deno.test("Google: GIF HARD-REJECTS with the exact §1.5 message (enum broader than policy)", () => {
  const result = validateCreativeForChannel("google", imageFacts({ mimeType: "image/gif" }));
  const check = result.checks.find((c) => c.rule === "image.mime");
  assert(check);
  assertEquals(check.level, "reject");
  assert(check.message.includes("GIF and WEBP get rejected even though the format list suggests otherwise"));
});

Deno.test("Google: WEBP also rejects", () => {
  const result = validateCreativeForChannel("google", imageFacts({ mimeType: "image/webp" }));
  assertEquals(result.ok, false);
});

Deno.test("Google: a 6 MB JPG rejects the 5,120 KB cap", () => {
  const result = validateCreativeForChannel("google", imageFacts({ byteSize: 6 * 1024 * 1024 }));
  const check = result.checks.find((c) => c.rule === "image.max_bytes");
  assert(check);
  assertEquals(check.level, "reject");
});

Deno.test("Google: 500×262 (1.91:1) rejects below the 600×314 minimum", () => {
  const result = validateCreativeForChannel(
    "google",
    imageFacts({ width: 500, height: 262, aspectRatio: 1.9084 }),
  );
  const check = result.checks.find((c) => c.rule === "image.min_resolution");
  assert(check);
  assertEquals(check.level, "reject");
});

Deno.test("Google: 800×800 square passes the 300 min but warns below the 1200×1200 recommendation", () => {
  const levels = ruleLevels("google", imageFacts({ width: 800, height: 800, aspectRatio: 1 }));
  assertEquals(levels.get("image.min_resolution"), undefined);
  assertEquals(levels.get("image.recommended_resolution"), "warn");
});

Deno.test("Google video: the YouTube path is an AUTO/warn note, never a blocker (A1-4 — OD-2 CLOSED)", () => {
  const result = validateCreativeForChannel("google", videoFacts({ aspectRatio: 1.7778, width: 1920, height: 1080 }));
  const check = result.checks.find((c) => c.rule === "video.youtube_hosted");
  assert(check);
  assertEquals(check.level, "warn");
  assert(check.message.includes("We'll upload this to YouTube for you"));
  assert(result.ok);
});

// ── Reddit — ONLY [SPEC] rows may bite; every pixel/byte number is [3P] ⇒ WARN ─

Deno.test("Reddit: a 5 MB image WARNS, never rejects (the 3 MB figure is [3P])", () => {
  const result = validateCreativeForChannel(
    "reddit",
    imageFacts({ byteSize: 5 * 1024 * 1024 }),
  );
  const check = result.checks.find((c) => c.rule === "image.max_bytes");
  assert(check);
  assertEquals(check.level, "warn"); // written reject in the row; [3P] downgrade is central
  assertEquals(check.confidence, "3P");
  assert(result.ok, "Reddit [3P] rows must NEVER block");
});

Deno.test("Reddit: a 20-minute video WARNS, never rejects ([3P] duration)", () => {
  const result = validateCreativeForChannel("reddit", videoFacts({ durationSeconds: 1200 }));
  const check = result.checks.find((c) => c.rule === "video.duration");
  assert(check);
  assertEquals(check.level, "warn");
  assert(result.ok);
});

Deno.test("Reddit: the ONE media [SPEC] row bites — video without a thumbnail REJECTS", () => {
  const result = validateCreativeForChannel("reddit", videoFacts({ posterPresent: false }));
  const check = result.checks.find((c) => c.rule === "video.thumbnail_required");
  assert(check);
  assertEquals(check.level, "reject");
  assertEquals(check.confidence, "SPEC");
  assertEquals(result.ok, false);
});

Deno.test("Reddit: safe-zone (bottom ~20%) is a [3P] warn", () => {
  const check = validateCreativeForChannel("reddit", imageFacts())
    .checks.find((c) => c.rule === "image.safe_zone");
  assert(check);
  assertEquals(check.level, "warn");
});

// ── Cross-channel plumbing ────────────────────────────────────────────────────

Deno.test("validateCreativeForChannels: one result per requested platform, order preserved", () => {
  const results = validateCreativeForChannels(["meta", "tiktok", "snapchat", "google", "reddit"], videoFacts());
  assertEquals(results.map((r) => r.platform), ["meta", "tiktok", "snapchat", "google", "reddit"]);
});

Deno.test("classifyRatio: exact and near matches resolve; far misses do not", () => {
  assertEquals(classifyRatio(0.5625, ["9:16", "1:1"]), "9:16");
  assertEquals(classifyRatio(1.0, ["9:16", "1:1"]), "1:1");
  assertEquals(classifyRatio(0.8, ["9:16", "1:1"]), null);
  assertEquals(classifyRatio(null, ["9:16"]), null);
});

Deno.test("central downgrade: NO reject-level check ever carries a non-[SPEC]/[OFFICIAL] confidence", () => {
  const factsList = [
    videoFacts({ hasAudio: false, durationSeconds: 999, byteSize: 2_000 * 1024 * 1024, posterPresent: false }),
    imageFacts({ byteSize: 200 * 1024 * 1024, mimeType: "image/gif", width: 10, height: 10, aspectRatio: 1 }),
  ];
  for (const facts of factsList) {
    for (const platform of ["meta", "tiktok", "snapchat", "google", "reddit"] as const) {
      for (const check of validateCreativeForChannel(platform, facts).checks) {
        if (check.level === "reject") {
          assert(
            check.confidence === "SPEC" || check.confidence === "OFFICIAL",
            `${platform}/${check.rule} rejects at confidence ${check.confidence} — A1-6b violated`,
          );
        }
      }
    }
  }
});
