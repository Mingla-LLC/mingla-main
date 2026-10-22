// MINGLA-INVARIANT: I-3697-META-IMAGE-CARRIES-LIBRARY-ID | issue #3697 | a Meta image create or validate request carries the creative-library id the server resolves its 1:1/4:5/9:16 placement variants from
/**
 * Issue #3697 — every Meta image campaign blocked at validate and create.
 *
 * Live evidence (2026-10-22, #3697 smoke): Meta Traffic / LANDING_PAGE_VIEWS
 * with library image 35f08b54-… → Review → "Validate shapes (nothing
 * created)" answered "Meta create failed — meta_placement_variants_required".
 * admin-ad-create-campaign (#4039) resolves Meta placement variants from the
 * creative-library row and rejects a request without `creative_library_id`;
 * the builder's Meta payload only sent the library id for video.
 *
 * Also pinned: a validate-only failure is titled "validation failed", not
 * "create failed" (nothing was being created).
 *
 * Run: node --test src/__tests__/issue3697_meta_image_carries_library_id.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");
const LIBRARY_ID = "35f08b54-45d5-480c-b0cf-3af7890ebac7";

const state = (creative, extra = {}) => ({
  lane: "consumer",
  name: "Apex beach unwind",
  goal: {
    metaObjective: "OUTCOME_TRAFFIC",
    metaOptimizationGoal: "LANDING_PAGE_VIEWS",
    platforms: {},
  },
  destination: { page_type: "event", brand_slug: "apex", entity_slug: "beach-unwind" },
  audience: {
    countries: ["US"], cities: [], interests: [], ageMin: 18, ageMax: 65,
    gender: "all", radius: 10, distanceUnit: "mile",
  },
  budget: { dailyCentsForChannel: 2000 },
  copy: { primary: "Unwind at the beach", headline: "Apex", cta: "LEARN_MORE" },
  specialAdCategory: "NONE",
  requestId: "req-3697",
  creative,
  ...extra,
});

const libraryImage = {
  kind: "image",
  imageUrl: "https://cdn.test/apex-1x1.jpg",
  creativeLibraryId: LIBRARY_ID,
  aiGenerated: false,
  brandName: "Apex",
};

describe("#3697 Meta image payload carries the creative-library id", () => {
  it("validate-only Meta image request sends creative_library_id", () => {
    const p = buildCreatePayload("meta", state(libraryImage, { validateOnly: true }));
    assert.equal(p.platform, "meta");
    assert.equal(p.validate_only, true);
    assert.equal(p.creative.creative_library_id, LIBRARY_ID);
    assert.equal(p.creative.image_url, "https://cdn.test/apex-1x1.jpg");
    assert.notEqual(p.creative.kind, "video");
  });

  it("real Meta image create sends creative_library_id too", () => {
    const p = buildCreatePayload("meta", state(libraryImage));
    assert.equal(p.creative.creative_library_id, LIBRARY_ID);
    assert.equal(p.validate_only, undefined);
  });

  it("an image with no library row sends no empty id (server fails closed)", () => {
    const p = buildCreatePayload("meta", state({ ...libraryImage, creativeLibraryId: null }));
    assert.equal("creative_library_id" in p.creative, false);
    assert.equal(p.creative.image_url, "https://cdn.test/apex-1x1.jpg");
  });

  it("the server still requires the id for Meta (the contract this pins)", () => {
    const fn = readFileSync(
      resolve(ADMIN_ROOT, "..", "supabase/functions/admin-ad-create-campaign/index.ts"),
      "utf8",
    );
    assert.match(fn, /if \(!creativeLibraryId\) \{\s*return json\(\{\s*error: "meta_placement_variants_required"/);
  });
});

describe("#3697 a validate-only failure is not called a create failure", () => {
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

  const props = (createResults) => ({
    summary: {
      headline: "Ready to create 1 paused image campaign",
      channels: [{
        platform: "meta", label: "Meta", dailyCents: 2000, dailyLabel: "$20.00/day",
        statusLine: "Paused → will go live on Launch",
        objectiveLabel: "OUTCOME_TRAFFIC · LANDING_PAGE_VIEWS", videoReadiness: null,
      }],
      blocked: [],
      destinationLine: "Apex beach unwind",
      creativeLine: "1 image",
      copyLine: "Checked",
      budgetLine: "$20.00/day total",
      capLabel: null,
      warnings: [],
    },
    name: "Apex beach unwind",
    onNameChange() {},
    submitting: false,
    validatingShapes: false,
    createResults,
    allExpectedPairsSucceeded: false,
    onCreate() {},
    onValidateShapes() {},
    onJumpToStep() {},
  });

  const failure = { code: "meta_placement_variants_required", message: "needs coverage" };

  it("titles a validate-only failure 'validation failed'", () => {
    const markup = renderToStaticMarkup(createElement(StepReview, props({
      meta: { platform: "meta", validateOnly: true, error: failure },
    })));
    assert.match(markup, /Meta validation failed — meta_placement_variants_required/);
    assert.doesNotMatch(markup, /create failed/);
  });

  it("keeps 'create failed' for a real create", () => {
    const markup = renderToStaticMarkup(createElement(StepReview, props({
      meta: { platform: "meta", error: failure },
    })));
    assert.match(markup, /Meta create failed — meta_placement_variants_required/);
  });

  it("the Builder marks validate-only failures on the result", () => {
    assert.match(
      SRC("pages/CampaignBuilderPage.jsx"),
      /\.\.\.\(validateOnly \? \{ validateOnly: true \} : \{\}\),\s*error: \{/,
    );
  });
});
