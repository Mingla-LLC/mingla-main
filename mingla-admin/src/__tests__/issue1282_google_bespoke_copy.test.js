// ISSUE-1282 [Google video Demand Gen bespoke copy] — implementor regression.
//
// Follow-up from #997 D2. The Google Demand Gen VIDEO create branch already
// ACCEPTS explicit `creative.long_headlines` (≤90) + `creative.business_name`
// (≤25) and DERIVES them (RSA headlines / title-cased brand slug) when absent.
// #1282 wires the wizard so the operator can WRITE bespoke long headlines + a
// business name and have them threaded through payload.js into the create
// branch — while an empty field sends NOTHING so the derivation fallback (and the
// SEARCH/RSA path) are byte-identical.
//
// Pure/source-only; ZERO provider calls, ZERO ad objects, no spend.
//
// FAILS-ON-REVERT (proven by line-deletion):
//   - Deleting the `long_headlines`/`business_name` spread in payload.js's google
//     branch fails "explicit copy threads into creative.long_headlines/business_name".
//   - Removing the `creativeIsVideo &&` gate fails "the image (Search/RSA) path
//     never carries long_headlines/business_name".
//   - Reverting the StepCopy Demand Gen block or the CampaignBuilderPage wiring
//     fails the source-assertion suite.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

// The create branch's char caps (validateGoogleDemandGenAd, _shared/google.ts):
// long headline ≤90, business name ≤25. The wizard counters mirror these.
const LONG_HEADLINE_MAX = 90;
const BUSINESS_NAME_MAX = 25;

// A base wizard state; each test overrides creative/copy as needed. Mirrors the
// #864 payload-contract fixture, plus a READY video library ref for the Demand
// Gen (video) path.
const baseState = () => ({
  lane: "consumer",
  name: "Lorne — Tuesdays — 2026-07-27",
  goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS" },
  destination: { page_type: "event", brand_slug: "lorne", entity_slug: "tuesdays" },
  audience: { countries: ["US"], ageMin: 18, ageMax: 65, gender: "all" },
  budget: { dailyCentsForChannel: 500 },
  creative: { kind: "video", creativeLibraryId: "lib-abc", aiGenerated: false },
  copy: {
    primary: "The room only holds 40.",
    headline: "Book the night",
    description: "Tuesdays",
    cta: "BUY_TICKETS",
    googleHeadlines: ["Book Tuesday", "Live music", "Small room"],
    googleDescriptions: ["A night worth planning.", "Doors at 8."],
    keywords: ["lorne", "tuesday live music"],
    negativeKeywords: [],
    googleLongHeadlines: [""],
    googleBusinessName: "",
  },
  specialAdCategory: "NONE",
  requestId: "11111111-2222-3333-4444-555555555555",
});

describe("ISSUE-1282 · Google video Demand Gen bespoke long-headline + business-name threading", () => {
  it("explicit long headlines + business name thread into creative.long_headlines/business_name (video)", () => {
    // Fails-on-revert: deleting the payload.js spread drops these keys.
    const state = baseState();
    state.copy.googleLongHeadlines = [
      "The Tuesday night the whole city is talking about",
      "Live music in a room that only holds forty",
    ];
    state.copy.googleBusinessName = "Lorne";
    const payload = buildCreatePayload("google", state);

    assert.deepEqual(payload.creative.long_headlines, [
      "The Tuesday night the whole city is talking about",
      "Live music in a room that only holds forty",
    ]);
    assert.equal(payload.creative.business_name, "Lorne");
    // The Demand Gen short headlines/descriptions (reused from RSA) are unchanged.
    assert.deepEqual(payload.creative.headlines, ["Book Tuesday", "Live music", "Small room"]);
    assert.equal(payload.creative.descriptions.length, 2);
    // Still a video creative (library ref), never an inline image_url.
    assert.equal(payload.creative.kind, "video");
    assert.equal(payload.creative.creative_library_id, "lib-abc");
    // Google is NEVER a CTA field (A4.b) — the bespoke copy did not sneak one in.
    assert.ok(!JSON.stringify(payload).includes("call_to_action_type"));
  });

  it("omitting the fields sends NOTHING → the create branch's derivation fallback stays intact", () => {
    // Fails-on-revert: an unconditional spread would emit empty keys here.
    const state = baseState(); // googleLongHeadlines: [""], googleBusinessName: ""
    const payload = buildCreatePayload("google", state);

    assert.ok(
      !("long_headlines" in payload.creative),
      "empty long headlines must NOT be sent — the branch derives from the RSA headlines",
    );
    assert.ok(
      !("business_name" in payload.creative),
      "empty business name must NOT be sent — the branch derives from the brand slug",
    );
    // The rest of the video creative is byte-identical to before #1282.
    assert.equal(payload.creative.kind, "video");
    assert.deepEqual(payload.creative.headlines, ["Book Tuesday", "Live music", "Small room"]);
  });

  it("long headlines are trimmed and blank entries dropped (matches the branch's non-empty contract)", () => {
    const state = baseState();
    state.copy.googleLongHeadlines = ["  A bespoke long headline  ", "", "   "];
    state.copy.googleBusinessName = "  Lorne  ";
    const payload = buildCreatePayload("google", state);

    assert.deepEqual(payload.creative.long_headlines, ["A bespoke long headline"]);
    assert.equal(payload.creative.business_name, "Lorne");
  });

  it("a whitespace-only business name sends nothing (falls back to derivation)", () => {
    const state = baseState();
    state.copy.googleBusinessName = "   ";
    const payload = buildCreatePayload("google", state);
    assert.ok(!("business_name" in payload.creative));
  });

  it("the IMAGE (Search/RSA) path NEVER carries long_headlines/business_name — video-scoped", () => {
    // Fails-on-revert: removing the `creativeIsVideo &&` gate leaks these onto the
    // Search/RSA path, which #1282 must not touch.
    const state = baseState();
    state.creative = { kind: "image", imageUrl: "https://x/y.png", aiGenerated: false };
    state.copy.googleLongHeadlines = ["This must not leak to a Search RSA"];
    state.copy.googleBusinessName = "Lorne";
    const payload = buildCreatePayload("google", state);

    assert.ok(!("long_headlines" in payload.creative), "Search RSA must not carry long_headlines");
    assert.ok(!("business_name" in payload.creative), "Search RSA must not carry business_name");
    // The RSA fields still build exactly as before.
    assert.deepEqual(payload.creative.headlines, ["Book Tuesday", "Live music", "Small room"]);
    assert.deepEqual(payload.keywords, ["lorne", "tuesday live music"]);
  });

  it("other platforms are untouched by the Google Demand Gen fields", () => {
    const state = baseState();
    state.copy.googleLongHeadlines = ["a bespoke google long headline"];
    state.copy.googleBusinessName = "Lorne";
    const meta = buildCreatePayload("meta", state);
    const tiktok = buildCreatePayload("tiktok", state);
    assert.ok(!JSON.stringify(meta).includes("long_headlines"));
    assert.ok(!JSON.stringify(meta).includes("business_name"));
    assert.ok(!JSON.stringify(tiktok).includes("long_headlines"));
  });
});

describe("ISSUE-1282 · wizard wiring (source assertions)", () => {
  it("StepCopy renders the Demand Gen bespoke-copy block gated on isVideo", () => {
    const src = read(path.join(ADMIN_SRC, "components/campaign-builder/StepCopy.jsx"));
    assert.ok(src.includes("isVideo = false"), "StepCopy accepts the isVideo prop (default false)");
    assert.ok(
      src.includes("googleEligible && isVideo"),
      "the Demand Gen block is gated on the Google-video path",
    );
    assert.ok(src.includes("Google Video (Demand Gen)"), "the block is labeled Demand Gen");
    assert.ok(src.includes("googleLongHeadlines"), "long-headline field bound to googleLongHeadlines");
    assert.ok(src.includes("googleBusinessName"), "business-name field bound to googleBusinessName");
  });

  it("StepCopy uses the Demand Gen char caps (long headline ≤90, business name ≤25)", () => {
    const src = read(path.join(ADMIN_SRC, "components/campaign-builder/StepCopy.jsx"));
    // The long-headline RepeatableFields caps at 90; the business-name Counter at 25.
    assert.ok(src.includes(`cap={${LONG_HEADLINE_MAX}}`), "long headlines cap at 90");
    assert.ok(src.includes(`cap={${BUSINESS_NAME_MAX}}`), "business name caps at 25");
  });

  it("CampaignBuilderPage passes isVideo and defaults the new copy fields", () => {
    const src = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
    assert.ok(
      src.includes('isVideo={creative.kind === "video"}'),
      "the page threads the video flag into StepCopy",
    );
    assert.ok(src.includes("googleLongHeadlines:"), "copy state defaults googleLongHeadlines");
    assert.ok(src.includes("googleBusinessName:"), "copy state defaults googleBusinessName");
  });

  it("payload.js gates the bespoke keys on a video creative only", () => {
    const src = read(path.join(ADMIN_SRC, "lib/adBuilder/payload.js"));
    assert.ok(
      src.includes("creativeIsVideo && googleLongHeadlines.length > 0"),
      "long_headlines only for a non-empty video creative",
    );
    assert.ok(
      src.includes("creativeIsVideo && googleBusinessName"),
      "business_name only for a non-empty video creative",
    );
  });
});
