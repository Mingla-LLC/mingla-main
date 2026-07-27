// ISSUE-1184 implementor regression — pure/source-only; zero provider calls.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPreparationResponse,
  createPreparationSession,
  normalizePreparation,
  normalizePreparationInvoke,
  pendingQueue,
  buildVideoSourcePayload,
  deriveBunnyPosterUrl,
  previewRequestFingerprint,
  readyVideoSubset,
  videoPreparationGate,
} from "../lib/adBuilder/preparationState.js";
import { partitionFundedCreative } from "../lib/adBuilder/creativeGate.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("ISSUE-1184 preparation state is sequential, resumable, and stale-safe", () => {
  it("orders exactly Meta → Snapchat → TikTok and Stop suppresses the queue", () => {
    const rows = {
      meta: { state: "not_started" },
      snapchat: { state: "not_started" },
      tiktok: { state: "not_started" },
    };
    assert.deepEqual(
      pendingQueue({ fundedPlatforms: ["tiktok", "snapchat", "meta"], rows }),
      ["meta", "snapchat", "tiktok"],
    );
    assert.deepEqual(
      pendingQueue({ fundedPlatforms: ["meta", "snapchat"], rows, stopped: true }),
      [],
    );
  });

  it("discards a response from the previous creative generation", () => {
    const current = createPreparationSession("creative-new", 2);
    assert.equal(applyPreparationResponse(current, {
      creativeId: "creative-old",
      platform: "meta",
      generation: 1,
      response: { state: "ready" },
    }), current);
  });

  it("READY Meta/Snap is the only video-create subset", () => {
    const rows = {
      meta: { state: "ready" },
      snapchat: { state: "failed" },
      tiktok: { state: "ready" },
    };
    assert.deepEqual(
      readyVideoSubset({ fundedPlatforms: ["meta", "snapchat", "tiktok", "google"], rows }),
      ["meta"],
    );
    const gate = videoPreparationGate({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      rows,
    });
    assert.equal(gate.canContinue, true);
    assert.deepEqual(gate.ready, ["meta"]);
    assert.equal(gate.excluded.find((x) => x.platform === "tiktok").reason, "preview_only");
  });
});

describe("ISSUE-1184 canonical failed 502 stays authoritative", () => {
  const body = {
    platform: "meta",
    state: "failed",
    cached: false,
    retryable: true,
    trace_id: "trace-one",
    error: { code: "provider_terminal", message: "Retry Meta.", trace_id: "trace-one" },
  };

  it("normalizes newly discovered terminality into row data exactly once", () => {
    const normalized = normalizePreparationInvoke(
      { data: null, error: new Error("edge 502") },
      { status: 502, body },
    );
    assert.equal(normalized.error, null);
    assert.equal(normalized.terminalDiscovered, true);
    assert.equal(normalized.data.state, "failed");
    assert.equal(normalized.data.error.code, "provider_terminal");
  });

  it("later cached 200 renders the same failed state without an announcement", () => {
    const cached = normalizePreparation({ ...body, cached: true, trace_id: "trace-two" }, "meta");
    assert.equal(cached.state, "failed");
    assert.equal(cached.error.code, "provider_terminal");
    assert.equal(cached.cached, true);
  });
});

describe("ISSUE-1184 build and review count only prepared destinations × platforms", () => {
  const channels = ["meta", "snapchat", "tiktok"].map((platform) => ({
    platform,
    label: platform,
    eligible: true,
    ok: true,
    needsTranscode: false,
  }));
  const rows = {
    meta: { state: "ready" },
    snapchat: { state: "ready" },
    tiktok: { state: "ready" },
  };

  it("creative partition builds Meta/Snap and never TikTok video", () => {
    const result = partitionFundedCreative({
      fundedPlatforms: ["meta", "snapchat", "tiktok"],
      channels,
      kind: "video",
      preparationByPlatform: rows,
    });
    assert.deepEqual(result.buildable, ["meta", "snapchat"]);
  });

  it("two destinations × two READY platforms produces four paused campaigns", () => {
    const summary = buildLaunchSummary({
      channelRows: channels.slice(0, 2),
      allocations: [
        { platform: "meta", dailyCents: 1000 },
        { platform: "snapchat", dailyCents: 1000 },
      ],
      destinations: [
        { title: "One", dest_url: "https://business.usemingla.com/e/a/one" },
        { title: "Two", dest_url: "https://business.usemingla.com/e/a/two" },
      ],
      creative: { kind: "video", name: "Hero" },
      preparationByPlatform: rows,
      totalDailyCents: 2000,
    });
    assert.equal(summary.campaignCount, 4);
    assert.match(summary.headline, /4 paused video campaigns across 2 platforms/);
    assert.equal(summary.primaryActionLabel, "Create 4 campaigns (paused)");
  });
});

describe("ISSUE-1184 UI/service wiring remains truthful", () => {
  const page = read("pages/CampaignBuilderPage.jsx");
  const panel = read("components/campaign-builder/VideoPreparationPanel.jsx");
  const preview = read("components/campaign-builder/AdPreview.jsx");
  const flags = read("lib/adBuilder/flags.js");
  const service = read("services/adEngineService.js");
  const creativeStep = read("components/campaign-builder/StepCreative.jsx");
  const workflow = read("../../.github/workflows/issue-1184-video-phase-a-tests.yml");

  it("runs one awaitable platform at a time and exposes Stop/Resume/Retry", () => {
    assert.match(page, /for \(const platform of preparationPlatforms\)/);
    assert.match(page, /await runPreparationPlatform\(platform/);
    assert.match(panel, /Stop waiting/);
    assert.match(panel, /Resume preparation/);
    assert.match(panel, /Retry/);
  });

  it("uses a safe Meta iframe and new-tab TikTok link", () => {
    assert.match(flags, /VIDEO_API_AD_PREVIEWS_ENABLED/);
    assert.match(flags, /meta: true/);
    assert.match(flags, /tiktok: true/);
    assert.match(flags, /snapchat: false/);
    assert.match(flags, /google: false/);
    assert.match(preview, /sandbox="allow-scripts allow-same-origin allow-presentation"/);
    assert.match(preview, /referrerPolicy="no-referrer"/);
    // ISSUE-903: the TikTok new-tab link now routes through the openExternal owner
    // (bare window.open(dest,"_blank") + win.opener = null) instead of an inline
    // window.open(...,"noopener,noreferrer"). Tab-nabbing safety is preserved by the
    // owner's opener severance; the inline feature string was the ORCH-1381 double-nav
    // bug (noopener/noreferrer null the return even on success) and is now banned
    // repo-wide by orch-1381-open-external-no-double-nav.mjs. Same intent, safer wiring.
    assert.match(preview, /openExternal\(/);
    assert.match(preview, /from ["'][^"']*\/openExternal["']/);
    assert.doesNotMatch(preview, /window\.open\(/);
    assert.doesNotMatch(preview, /srcDoc/);
    assert.match(preview, /Mingla approximation/);
  });

  it("service recognizes the canonical terminal envelope", () => {
    assert.match(service, /normalizePreparationInvoke/);
    assert.match(service, /admin-ad-creative-prepare/);
    assert.match(service, /admin-ad-preview/);
  });

  it("derives and sends the exact Bunny poster path accepted by the server", () => {
    const posterUrl = deriveBunnyPosterUrl(
      "https://video-cdn.example/video-123/play_1080p.mp4",
      "video-123",
    );
    assert.equal(
      posterUrl,
      "https://video-cdn.example/video-123/thumbnail.jpg",
    );
    assert.deepEqual(
      buildVideoSourcePayload({
        bunnyVideoId: "video-123",
        mp4MasterUrl: "https://video-cdn.example/video-123/play_1080p.mp4",
        posterUrl,
      }),
      {
        bunny_video_id: "video-123",
        poster_url: "https://video-cdn.example/video-123/thumbnail.jpg",
        mp4_master_url: "https://video-cdn.example/video-123/play_1080p.mp4",
        source_url: "https://video-cdn.example/video-123/play_1080p.mp4",
      },
    );
    assert.match(creativeStep, /buildVideoSourcePayload/);
    assert.match(creativeStep, /Bunny poster URL \(required\)/);
    assert.doesNotMatch(creativeStep, /handlePosterPicked|Poster upload failed/);
  });

  it("fingerprints Meta requests and discards slow responses after identity changes", () => {
    const first = previewRequestFingerprint({
      creative_library_id: "creative-a",
      destination: { page_type: "event", brand_slug: "a", entity_slug: "one" },
      preview_input: { primary_text: "First" },
    });
    const changedCreative = previewRequestFingerprint({
      creative_library_id: "creative-b",
      destination: { page_type: "event", brand_slug: "a", entity_slug: "one" },
      preview_input: { primary_text: "First" },
    });
    const changedDestination = previewRequestFingerprint({
      creative_library_id: "creative-a",
      destination: { page_type: "event", brand_slug: "a", entity_slug: "two" },
      preview_input: { primary_text: "First" },
    });
    const changedCopy = previewRequestFingerprint({
      creative_library_id: "creative-a",
      destination: { page_type: "event", brand_slug: "a", entity_slug: "one" },
      preview_input: { primary_text: "Second" },
    });
    assert.notEqual(first, changedCreative);
    assert.notEqual(first, changedDestination);
    assert.notEqual(first, changedCopy);
    assert.match(preview, /metaPreviewGeneration/);
    assert.match(preview, /currentMetaFingerprint/);
    assert.match(preview, /metaPreview\.fingerprint === metaPreviewFingerprint/);
    assert.match(preview, /metaPreviewGeneration\.current !== generation/);
    assert.match(preview, /currentMetaFingerprint\.current !== metaPreviewFingerprint/);
  });

  it("workflow watches config and every allowlisted shared runtime dependency", () => {
    assert.match(workflow, /supabase\/config\.toml/);
    assert.match(workflow, /_shared\/adCreative\.ts/);
    assert.match(workflow, /_shared\/adCreativeProbe\.ts/);
    assert.match(workflow, /_shared\/adCreativePrepare\.ts/);
    assert.match(workflow, /_shared\/adDestination\.ts/);
    assert.match(workflow, /_shared\/meta\.ts/);
  });
});
