// ISSUE-1184 [Campaign Builder video Phase A] — INDEPENDENT TESTER adversarial
// regression (admin). DIFFERENT ANGLE than the implementor happy-path suite
// (issue1184_video_phase_a.test.js): that file proves the sequential/subset
// happy path and a positive terminal-502 normalization; this file ATTACKS the
// negative space — create-path safety (TikTok/Google/Reddit can NEVER build a
// video even when "ready"), the ready-gate, terminal-state queue stop, the
// terminal-502 guard BOUNDARIES (so a cached 200 / 503 / non-failed body is
// never mis-normalized into a duplicate alert), generation-freshness discard of
// a stale slow response for the SAME creative, and the client Bunny-poster SSRF
// mirror. Pure/runtime — zero provider calls, zero network, zero ad objects.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPreparationResponse,
  buildVideoSourcePayload,
  createPreparationSession,
  deriveBunnyPosterUrl,
  normalizePreparationInvoke,
  pendingQueue,
  previewRequestFingerprint,
  readyVideoSubset,
  videoPreparationGate,
} from "../lib/adBuilder/preparationState.js";
import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
} from "../lib/adBuilder/creativeGate.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const okChannel = (platform) => ({
  platform,
  label: platform,
  eligible: true,
  ok: true,
  needsTranscode: false,
});

describe("ISSUE-1184 adversarial: create is Meta/Snap/TikTok-only; Google/Reddit can NEVER build a video (#997 C)", () => {
  // [TEST-MOD-APPROVED ORCH-0997] #997 C wires TikTok paused-video, so a READY
  // tiktok now BUILDS (it leaves the excluded set). Google/Reddit stay excluded and
  // their reasons/flags are unchanged — the negative-space guard on THEM is intact.
  it("builds a READY TikTok too, but still excludes Google/Reddit even when their prep says ready (#997 C)", () => {
    const funded = ["meta", "snapchat", "tiktok", "google", "reddit"];
    const channels = funded.map(okChannel);
    const rows = Object.fromEntries(funded.map((p) => [p, { state: "ready" }]));
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: funded,
      channels,
      kind: "video",
      preparationByPlatform: rows,
    });
    assert.deepEqual(buildable.sort(), ["meta", "snapchat", "tiktok"]);
    const reasonOf = (p) => excluded.find((e) => e.platform === p)?.reason;
    assert.equal(reasonOf("tiktok"), undefined); // READY tiktok now builds
    assert.equal(reasonOf("google"), "approximation_only");
    assert.equal(reasonOf("reddit"), "video_not_creatable");
    // Belt-and-braces: the flag table enables tiktok, still forbids google/reddit.
    assert.equal(VIDEO_CREATE_ENABLED.tiktok, true);
    assert.equal(VIDEO_CREATE_ENABLED.google, false);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, false);
  });

  it("gates Meta/Snap on an exact READY preparation — non-ready is excluded, not built", () => {
    const build = (metaState) =>
      partitionFundedCreative({
        fundedPlatforms: ["meta"],
        channels: [okChannel("meta")],
        kind: "video",
        preparationByPlatform: metaState ? { meta: { state: metaState } } : {},
      });
    for (const state of ["uploading", "processing", "failed", "timed_out"]) {
      const r = build(state);
      assert.deepEqual(r.buildable, []);
      assert.equal(r.excluded[0].reason, `preparation_${state}`);
    }
    // No preparation row at all → not_started, still excluded.
    assert.equal(build(null).excluded[0].reason, "preparation_not_started");
    // READY prep but the byte-probe validation rejected the channel → blocked.
    const blocked = partitionFundedCreative({
      fundedPlatforms: ["meta"],
      channels: [{ ...okChannel("meta"), ok: false }],
      kind: "video",
      preparationByPlatform: { meta: { state: "ready" } },
    });
    assert.deepEqual(blocked.buildable, []);
    assert.equal(blocked.excluded[0].reason, "blocked");
    // READY prep but needs_transcode (resolver blocks at create) → excluded.
    const transcode = partitionFundedCreative({
      fundedPlatforms: ["meta"],
      channels: [{ ...okChannel("meta"), needsTranscode: true }],
      kind: "video",
      preparationByPlatform: { meta: { state: "ready" } },
    });
    assert.equal(transcode.excluded[0].reason, "needs_transcode");
  });

  it("image creatives are unaffected by the video preparation gate", () => {
    const r = partitionFundedCreative({
      fundedPlatforms: ["meta", "tiktok"],
      channels: [okChannel("meta"), okChannel("tiktok")],
      kind: "image",
      preparationByPlatform: {},
    });
    assert.deepEqual(r.buildable, ["meta", "tiktok"]);
  });
});

describe("ISSUE-1184 adversarial: READY subset & gate now include TikTok (#997 C)", () => {
  // [TEST-MOD-APPROVED ORCH-0997] a READY+funded TikTok is now IN the create subset.
  it("a READY+funded TikTok is in the create subset alongside Meta/Snap (#997 C)", () => {
    const rows = {
      meta: { state: "ready" },
      snapchat: { state: "ready" },
      tiktok: { state: "ready" },
    };
    assert.deepEqual(
      readyVideoSubset({
        fundedPlatforms: ["tiktok", "snapchat", "meta"],
        rows,
      }).sort(),
      ["meta", "snapchat", "tiktok"],
    );
  });

  // [TEST-MOD-APPROVED ORCH-0997] With Meta/Snap failed/timed_out but TikTok READY,
  // the gate can now continue on TikTok alone — TikTok is no longer preview-only.
  // Google/Reddit exclusion reasons and the Meta/Snap state reporting are unchanged.
  it("gate continues on a READY TikTok even when Meta/Snap are not ready, and names each exclusion (#997 C)", () => {
    const gate = videoPreparationGate({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      rows: {
        meta: { state: "failed" },
        snapchat: { state: "timed_out" },
        tiktok: { state: "ready" },
      },
    });
    assert.equal(gate.canContinue, true);
    assert.deepEqual(gate.ready, ["tiktok"]);
    const reasonOf = (p) => gate.excluded.find((e) => e.platform === p)?.reason;
    assert.equal(reasonOf("tiktok"), undefined); // READY tiktok now continues
    assert.equal(reasonOf("google"), "approximation_only");
    assert.equal(reasonOf("reddit"), "video_excluded");
    assert.equal(reasonOf("meta"), "preparation_failed");
    assert.equal(reasonOf("snapchat"), "preparation_timed_out");
  });
});

describe("ISSUE-1184 adversarial: the queue never re-runs a terminal platform", () => {
  it("ready/failed/timed_out are all terminal — the queue drains to empty", () => {
    assert.deepEqual(
      pendingQueue({
        fundedPlatforms: ["meta", "snapchat", "tiktok"],
        rows: {
          meta: { state: "ready" },
          snapchat: { state: "failed" },
          tiktok: { state: "timed_out" },
        },
      }),
      [],
    );
  });

  it("only active/not-started AND funded platforms are queued, in fixed order", () => {
    assert.deepEqual(
      pendingQueue({
        fundedPlatforms: ["snapchat", "meta"], // tiktok NOT funded
        rows: {
          meta: { state: "processing" },
          snapchat: { state: "not_started" },
          tiktok: { state: "not_started" },
        },
      }),
      ["meta", "snapchat"],
    );
  });
});

describe("ISSUE-1184 adversarial: only a genuine terminal 502 is authoritative (no duplicate alerts)", () => {
  const failed502 = {
    result: { data: null, error: new Error("edge 502") },
    parsed: {
      status: 502,
      body: {
        platform: "meta",
        state: "failed",
        cached: false,
        retryable: true,
        error: { code: "provider_terminal", message: "Retry Meta." },
      },
    },
  };

  it("normalizes a newly-discovered failed 502 into row data exactly once", () => {
    const out = normalizePreparationInvoke(failed502.result, failed502.parsed);
    assert.equal(out.terminalDiscovered, true);
    assert.equal(out.error, null);
    assert.equal(out.data.state, "failed");
    assert.equal(out.data.error.code, "provider_terminal");
  });

  it("does NOT re-fire on a later cached 502 (cached === true is not a discovery)", () => {
    const parsed = {
      ...failed502.parsed,
      body: { ...failed502.parsed.body, cached: true },
    };
    const out = normalizePreparationInvoke(failed502.result, parsed);
    assert.notEqual(out.terminalDiscovered, true);
    assert.ok(out.error, "the original transport error is preserved, not swallowed");
  });

  it("ignores non-502 transports and non-failed bodies", () => {
    const as503 = normalizePreparationInvoke(failed502.result, {
      ...failed502.parsed,
      status: 503,
    });
    assert.notEqual(as503.terminalDiscovered, true);

    const notFailed = normalizePreparationInvoke(failed502.result, {
      status: 502,
      body: { ...failed502.parsed.body, state: "processing" },
    });
    assert.notEqual(notFailed.terminalDiscovered, true);
  });

  it("passes a success result (a later cached 200) through untouched — no discovery", () => {
    const success = { data: { state: "failed", cached: true }, error: null };
    const out = normalizePreparationInvoke(success, null);
    assert.equal(out, success);
    assert.equal(out.terminalDiscovered, undefined);
  });
});

describe("ISSUE-1184 adversarial: a stale slow response never overwrites the current one", () => {
  it("discards a stale generation for the SAME creative, applies the matching one", () => {
    const session = createPreparationSession("creative-x", 2);
    // A slow response from generation 1 of the SAME creative must be dropped.
    const stale = applyPreparationResponse(session, {
      creativeId: "creative-x",
      platform: "meta",
      generation: 1,
      response: { state: "ready" },
    });
    assert.equal(stale, session);
    assert.equal(stale.rows.meta.state, "not_started");
    // A different creative is also dropped.
    assert.equal(
      applyPreparationResponse(session, {
        creativeId: "creative-y",
        platform: "meta",
        generation: 2,
        response: { state: "ready" },
      }),
      session,
    );
    // The current generation applies and is normalized.
    const applied = applyPreparationResponse(session, {
      creativeId: "creative-x",
      platform: "meta",
      generation: 2,
      response: { state: "ready", cached: true },
    });
    assert.notEqual(applied, session);
    assert.equal(applied.rows.meta.state, "ready");
  });

  it("fingerprint changes on creative, destination, copy, CTA, placement, or platform", () => {
    const base = {
      creative_library_id: "c",
      platform: "meta",
      placement_id: "meta_reels_9x16",
      destination: { page_type: "event", brand_slug: "a", entity_slug: "one" },
      preview_input: { primary_text: "Hi", call_to_action_type: "BOOK_NOW" },
    };
    const fp = previewRequestFingerprint(base);
    // Identical input → identical fingerprint (idempotent).
    assert.equal(fp, previewRequestFingerprint({ ...base }));
    const changed = [
      { ...base, creative_library_id: "c2" },
      { ...base, platform: "tiktok" },
      { ...base, placement_id: "meta_feed_1x1" },
      { ...base, destination: { ...base.destination, entity_slug: "two" } },
      {
        ...base,
        preview_input: { ...base.preview_input, primary_text: "Bye" },
      },
      {
        ...base,
        preview_input: { ...base.preview_input, call_to_action_type: "LEARN_MORE" },
      },
    ];
    for (const variant of changed) {
      assert.notEqual(previewRequestFingerprint(variant), fp);
    }
  });
});

describe("ISSUE-1184 adversarial: client Bunny-poster derivation is fail-close (SSRF mirror)", () => {
  const ID = "video-123";
  const HAPPY = "https://cdn.example.com/video-123/play_1080p.mp4";

  it("derives the exact same-origin thumbnail path for a valid recorded video", () => {
    assert.equal(
      deriveBunnyPosterUrl(HAPPY, ID),
      "https://cdn.example.com/video-123/thumbnail.jpg",
    );
  });

  it("returns empty (blocking prepare) for every unsafe or mismatched input", () => {
    const rejects = [
      ["http://cdn.example.com/video-123/x.mp4", ID], // not https
      ["https://cdn.example.com:8443/video-123/x.mp4", ID], // port
      ["https://u:p@cdn.example.com/video-123/x.mp4", ID], // credentials
      ["https://cdn.example.com/video-123/x.mp4?q=1", ID], // query
      ["https://cdn.example.com/video-123/x.mp4#h", ID], // fragment
      ["https://cdn.example.com/other/x.mp4", ID], // id not in path
      [HAPPY, "bad/id"], // id has a slash
      [HAPPY, "bad id"], // id has whitespace
      [HAPPY, "x".repeat(129)], // id too long
      ["", ID], // unparseable url
      ["not-a-url", ID], // unparseable url
    ];
    for (const [url, id] of rejects) {
      assert.equal(deriveBunnyPosterUrl(url, id), "", `${url} / ${id}`);
    }
  });

  it("buildVideoSourcePayload trims and mirrors mp4 into source_url with no extra keys", () => {
    const payload = buildVideoSourcePayload({
      bunnyVideoId: "  video-123  ",
      mp4MasterUrl: "  https://cdn.example.com/video-123/play.mp4  ",
      posterUrl: "  https://cdn.example.com/video-123/thumbnail.jpg  ",
    });
    assert.deepEqual(payload, {
      bunny_video_id: "video-123",
      poster_url: "https://cdn.example.com/video-123/thumbnail.jpg",
      mp4_master_url: "https://cdn.example.com/video-123/play.mp4",
      source_url: "https://cdn.example.com/video-123/play.mp4",
    });
  });
});

describe("ISSUE-1184 adversarial: launch summary tells the truth about video readiness", () => {
  const channels = ["meta", "snapchat"].map((platform) => ({
    platform,
    label: platform,
    eligible: true,
  }));

  it("labels a not-ready platform 'Video not ready' and never claims a fake real preview", () => {
    const summary = buildLaunchSummary({
      channelRows: channels,
      allocations: [
        { platform: "meta", dailyCents: 1000 },
        { platform: "snapchat", dailyCents: 1000 },
      ],
      destinations: [
        { title: "One", dest_url: "https://business.usemingla.com/e/a/one" },
      ],
      creative: { kind: "video", name: "Hero" },
      preparationByPlatform: {
        meta: { state: "ready" },
        snapchat: { state: "processing" },
      },
      totalDailyCents: 2000,
    });
    const readiness = (p) =>
      summary.channels.find((c) => c.platform === p)?.videoReadiness;
    assert.equal(readiness("meta"), "Video ready · real preview available");
    assert.equal(readiness("snapchat"), "Video not ready");
    // Snap is only ever a Mingla approximation, never "real preview".
    const snapReady = buildLaunchSummary({
      channelRows: channels,
      allocations: [{ platform: "snapchat", dailyCents: 1000 }],
      destinations: [{ title: "One", dest_url: "https://x/e/a/one" }],
      creative: { kind: "video", name: "Hero" },
      preparationByPlatform: { snapchat: { state: "ready" } },
      totalDailyCents: 1000,
    });
    assert.equal(
      snapReady.channels.find((c) => c.platform === "snapchat").videoReadiness,
      "Video ready · Mingla approximation",
    );
  });
});

describe("ISSUE-1184 adversarial [structural]: page/preview wiring enforces the invariants", () => {
  const page = read("pages/CampaignBuilderPage.jsx");
  const preview = read("components/campaign-builder/AdPreview.jsx");
  const flags = read("lib/adBuilder/flags.js");

  it("the Review count is gated on the buildable (READY) subset, not raw allocations", () => {
    assert.match(
      page,
      /allocations\.filter\(\(a\) => creativePartition\.buildable\.includes\(a\.platform\)\)/,
    );
  });

  it("a terminal failure is announced once, keyed by a de-dupe set", () => {
    assert.match(page, /terminalAnnouncementsRef/);
  });

  it("resetting the creative discards prior preparation truth (generation reset)", () => {
    assert.match(page, /setPreparationRows\(\{\}\)/);
    assert.match(page, /creative\.creativeRow\?\.id/);
  });

  it("Meta preview DROPS a stale slow response by generation AND fingerprint before setState", () => {
    assert.match(
      preview,
      /metaPreviewGeneration\.current !== generation \|\|\s*currentMetaFingerprint\.current !== metaPreviewFingerprint\s*\)\s*return;/,
    );
    // and only renders a preview whose fingerprint matches the current request
    assert.match(
      preview,
      /metaPreview\.fingerprint === metaPreviewFingerprint/,
    );
    // TikTok likewise drops a response whose fingerprint is no longer current
    assert.match(
      preview,
      /currentTikTokFingerprint\.current !== requestFingerprint\)\s*return;/,
    );
  });

  it("Snapchat and Google previews are never wired to the real-preview endpoint", () => {
    assert.match(flags, /snapchat: false/);
    assert.match(flags, /google: false/);
  });
});
