// MINGLA-INVARIANT: I-3697-REVIEW-NEVER-GREEN-WHEN-BLOCKED | issue #3697 | the Builder review shows each platform's daily budget in money, and a platform that cannot run for the market or budget is greyed with its reason or explained in one line, never a green Ready card
/**
 * Issue #3697 — Builder review step: preview, placement gaps, budget split.
 *
 * Live evidence (2026-10-20): "Open preview in new tab" opened Meta's
 * "Not Found" because the preview URL kept HTML-escaped `&amp;t=`; the
 * embedded frame showed a broken icon; placement gaps were only found in
 * Ads Manager; and platforms that cannot run here looked ready.
 *
 * Run: node --test src/__tests__/issue3697_ads_ui_builder_review.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { decodeHtmlEntities, safeMetaPreviewUrl } from "../lib/adBuilder/previewUrl.js";
import {
  placementGapsLine,
  reviewPlacementGaps,
} from "../lib/adBuilder/reviewPlacementGaps.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

let vite;
let StepReview;

before(async () => {
  vite = await createServer({
    root: ADMIN_ROOT,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ StepReview } = await vite.ssrLoadModule(
    "/src/components/campaign-builder/StepReview.jsx",
  ));
});

after(async () => {
  await vite?.close();
});

function reviewProps(overrides = {}) {
  return {
    summary: {
      headline: "Ready to create 2 paused video campaigns across 2 platforms",
      channels: [
        {
          platform: "meta",
          label: "Meta",
          dailyCents: 3000,
          dailyLabel: "$30.00/day",
          statusLine: "Paused → will go live on Launch",
          objectiveLabel: "OUTCOME_TRAFFIC · LINK_CLICKS",
          videoReadiness: null,
        },
        {
          platform: "google",
          label: "Google",
          dailyCents: 1500,
          dailyLabel: "$15.00/day",
          statusLine: "Paused → will go live on Launch",
          objectiveLabel: "DEMAND_GEN",
          videoReadiness: null,
        },
      ],
      blocked: [
        {
          platform: "tiktok",
          label: "TikTok",
          reason: "At $45.00/day we're leaving TikTok out — its minimum is $50.00/day.",
        },
        {
          platform: "reddit",
          label: "Reddit",
          reason: "Not available: Reddit can't bill in naira (its funding-currency enum has no NGN) — Nigeria campaigns don't route to Reddit.",
        },
      ],
      destinationLine: "Deserted Island 6.0",
      creativeLine: "1 video",
      copyLine: "Checked",
      budgetLine: "$45.00/day total",
      capLabel: "$240.00",
      warnings: [],
    },
    name: "Deserted Island 6.0",
    onNameChange() {},
    submitting: false,
    validatingShapes: false,
    createResults: null,
    allExpectedPairsSucceeded: false,
    onCreate() {},
    onValidateShapes() {},
    onJumpToStep() {},
    ...overrides,
  };
}

describe("#3697 the Meta preview link opens the real preview", () => {
  it("decodes &amp; so Meta receives both d and t", () => {
    const url = safeMetaPreviewUrl(
      "https://www.facebook.com/ads/api/preview_iframe.php?d=AQKzX1&amp;t=AWm9Q2",
    );
    assert.equal(url, "https://www.facebook.com/ads/api/preview_iframe.php?d=AQKzX1&t=AWm9Q2");
    assert.equal(new URL(url).searchParams.get("t"), "AWm9Q2");
    assert.equal(decodeHtmlEntities("a&#38;b"), "a&b");
  });

  it("refuses anything that is not an https Meta URL", () => {
    assert.equal(safeMetaPreviewUrl("http://www.facebook.com/x"), null);
    assert.equal(safeMetaPreviewUrl("https://evil.example/x"), null);
    assert.equal(safeMetaPreviewUrl("https://facebook.com.evil.example/x"), null);
    assert.equal(safeMetaPreviewUrl(null), null);
  });

  it("the frame and the link both use the guarded URL, with a clear fallback", () => {
    const preview = SRC("components/campaign-builder/AdPreview.jsx");
    assert.match(preview, /const metaPreviewUrl = safeMetaPreviewUrl\(visibleMetaPreview\.url\)/);
    assert.match(preview, /src=\{metaPreviewUrl\}/);
    assert.match(preview, /href=\{metaPreviewUrl\}/);
    assert.doesNotMatch(preview, /src=\{visibleMetaPreview\.url\}/);
    assert.match(preview, /Rendered by Meta/);
    assert.match(preview, /Open full preview/);
    assert.match(preview, /stays blank/);
    assert.match(preview, /can&apos;t open safely/);
  });
});

describe("#3697 placement gaps before create", () => {
  it("lists the placements a 9:16 image will not fill", () => {
    const gaps = reviewPlacementGaps({
      kind: "image",
      probe: { aspect_ratio: 0.5625, width: 1080, height: 1920 },
      platforms: ["meta"],
    });
    assert.deepEqual(
      gaps.map((gap) => gap.placement),
      ["Meta Feed (square)", "Meta Feed (portrait)", "Meta Right column / Search"],
    );
    assert.equal(
      placementGapsLine(gaps.slice(2)),
      "Won't show in 1 place: Meta Right column / Search (needs a 1.91:1 version).",
    );
  });

  it("omits gaps it has no data for (videos, no probe)", () => {
    assert.deepEqual(reviewPlacementGaps({ kind: "video", probe: { aspect_ratio: 0.5625 }, platforms: ["meta"] }), []);
    assert.deepEqual(reviewPlacementGaps({ kind: "image", probe: null, platforms: ["meta"] }), []);
    assert.equal(placementGapsLine([]), null);
  });

  it("a covering variant removes the gap", () => {
    const gaps = reviewPlacementGaps({
      kind: "image",
      probe: { aspect_ratio: 0.5625, width: 1080, height: 1920 },
      platforms: ["meta"],
      variants: { "1.91:1": { source_url: "https://cdn.test/wide.jpg" } },
    });
    assert.ok(!gaps.some((gap) => /Right column/.test(gap.placement)));
  });
});

describe("#3697 where the money goes", () => {
  it("shows a dollar card per funded platform and never a green card for a blocked one", () => {
    const markup = renderToStaticMarkup(
      createElement(StepReview, reviewProps({
        placementGapsText: "Won't show in 1 place: Meta Right column / Search (needs a 1.91:1 version).",
      })),
    );
    assert.match(markup, /Where the money goes/);
    assert.match(markup, /\$45\.00\/day total · cap \$240\.00/);
    assert.match(markup, /\$30\.00\/day/);
    assert.match(markup, /\$15\.00\/day/);
    assert.equal((markup.match(/>Ready</g) ?? []).length, 2, "only funded platforms are Ready");
    assert.match(markup, /TikTok[\s\S]*Can(&#x27;|')t run[\s\S]*its minimum is \$50\.00\/day/);
    assert.match(markup, /Reddit isn(&#x27;|')t shown for this market — Reddit can(&#x27;|')t bill in naira/);
    assert.doesNotMatch(markup, /Not available:/);
    assert.match(markup, /Won(&#x27;|')t show in 1 place: Meta Right column/);
  });

  it("the Builder passes placement gaps and Preflight greys blocked channels", () => {
    const page = SRC("pages/CampaignBuilderPage.jsx");
    assert.match(page, /placementGapsText=\{placementGapsLine\(/);
    assert.match(page, /reviewPlacementGaps\(\{/);
    const preflight = SRC("components/campaign-builder/StepPreflight.jsx");
    assert.match(preflight, /variant=\{selectable \? \(OVERALL_BADGE\[row\.overall\] \?\? "default"\) : "default"\}/);
    assert.match(preflight, /can't run here/);
    const summary = SRC("lib/adBuilder/launchSummary.js");
    assert.match(summary, /capLabel: cap != null \? moneyLabel\(cap\) : null/);
  });
});
