// ISSUE-989 [Campaign Builder real targeting] — HAPPY-PATH regression suite
// (node:test — the house admin pattern: pure-logic module tests + fs source
// assertions, no DOM).
//
// What this pins:
//   - targeting.js per-platform mappers: gender (closes the Snap/TikTok/Reddit
//     SILENT DROP — Lane D finding #2), city → per-platform geo shapes,
//     interest → per-platform id/name lists, Snap demographics (STRINGS),
//     radius clamp.
//   - payload.js sends the REAL targeting shape per platform (not just
//     {countries}): Meta cities[{key,radius,distance_unit}] + interests; TikTok
//     location_ids + interest_category_ids + correct gender; Reddit genders +
//     passthrough interests; Snap demographics; Google locations.
//   - flags.TARGETING_SEARCH_PROXY_ENABLED is FLIPPED on.
//   - ISSUE-987 P3: CampaignBuilderPage passes plannedRows (the PICKED set), not
//     the candidate channelRows, to StepPolicy.
//
// FAILS-ON-REVERT: reverting tiktokGenderFor to the old "female"/"male" check
// drops TikTok gender (test asserts GENDER_FEMALE); deleting metaCitiesFrom /
// metaInterestIdsFrom spreads in payload.js drops Meta city/interest targeting;
// reverting StepPolicy to channelRows fails the #987 source assertion.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { TARGETING_SEARCH_PROXY_ENABLED } from "../lib/adBuilder/flags.js";
import {
  clampRadius,
  googleLocationsFrom,
  metaCitiesFrom,
  metaInterestIdsFrom,
  redditGendersFor,
  redditInterestNamesFrom,
  snapDemographicsFrom,
  snapGendersFor,
  tiktokGenderFor,
  tiktokInterestCategoryIdsFrom,
  tiktokLocationIdsFrom,
} from "../lib/adBuilder/targeting.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A London chip resolved across platforms (as the Audience step builds it).
const LONDON_CHIP = {
  id: "812057",
  label: "London, England, GB",
  country: "GB",
  meta: { key: "812057" },
  google: { name: "London", country_code: "GB" },
  tiktok: { location_ids: ["9807434"] },
};
const INTERESTS = [
  { platform: "meta", id: "6003375995381", name: "nightlife (bars, clubs and nightlife)" },
  { platform: "tiktok", id: "27", name: "Food & Beverage" },
  { platform: "reddit", id: "nightlife", name: "nightlife" },
];

function stateFor(audiencePatch = {}) {
  return {
    lane: "consumer",
    name: "Test — camp",
    goal: {
      metaObjective: "OUTCOME_TRAFFIC",
      metaOptimizationGoal: "LINK_CLICKS",
      platforms: {
        tiktok: { objective: "TRAFFIC" },
        reddit: { objective: "CLICKS" },
        snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" },
      },
    },
    destination: { page_type: "brand", brand_slug: "test-brand", entity_slug: null },
    audience: {
      countries: ["GB"],
      cities: [LONDON_CHIP],
      interests: INTERESTS,
      radius: 10,
      distanceUnit: "mile",
      ageMin: 21,
      ageMax: 45,
      gender: "women",
      ...audiencePatch,
    },
    budget: { dailyCentsForChannel: 5000 },
    creative: { imageUrl: "https://x/y.jpg", aiGenerated: false, brandName: "Test" },
    copy: {
      primary: "Come through",
      headline: "Tonight",
      description: "d",
      cta: "LEARN_MORE",
      googleHeadlines: ["a", "b", "c"],
      googleDescriptions: ["d1", "d2"],
      keywords: ["nightlife london"],
      negativeKeywords: [],
    },
    specialAdCategory: "NONE",
    requestId: "req-1",
  };
}

// ── targeting.js mappers ──────────────────────────────────────────────────────
describe("targeting.js — per-platform mappers", () => {
  it("gender maps to each platform's enum (women/men/all)", () => {
    assert.equal(tiktokGenderFor("women"), "GENDER_FEMALE");
    assert.equal(tiktokGenderFor("men"), "GENDER_MALE");
    assert.equal(tiktokGenderFor("all"), undefined);
    assert.deepEqual(redditGendersFor("men"), ["MALE"]);
    assert.equal(redditGendersFor("all"), undefined);
    assert.deepEqual(snapGendersFor("women"), ["FEMALE"]);
  });

  it("city chips → per-platform geo shapes", () => {
    assert.deepEqual(metaCitiesFrom([LONDON_CHIP], 10, "mile"), [
      { key: "812057", radius: 10, distance_unit: "mile" },
    ]);
    assert.deepEqual(googleLocationsFrom([LONDON_CHIP]), [{ name: "London", country_code: "GB" }]);
    assert.deepEqual(tiktokLocationIdsFrom([LONDON_CHIP]), ["9807434"]);
    // a city missing a TikTok tag contributes no location_id (falls back to country)
    assert.deepEqual(tiktokLocationIdsFrom([{ ...LONDON_CHIP, tiktok: null }]), []);
  });

  it("radius clamps to Meta's 1-50mi bounds", () => {
    assert.equal(clampRadius(500, "mile"), 50);
    assert.equal(clampRadius(0, "mile"), 1);
    assert.equal(clampRadius(12, "mile"), 12);
  });

  it("interest chips → per-platform id/name lists", () => {
    assert.deepEqual(metaInterestIdsFrom(INTERESTS), ["6003375995381"]);
    assert.deepEqual(tiktokInterestCategoryIdsFrom(INTEREST_ONLY_TIKTOK()), ["27"]);
    assert.deepEqual(redditInterestNamesFrom(INTERESTS), ["nightlife"]);
  });

  it("snap demographics are STRINGS; open top at the 65 band", () => {
    assert.deepEqual(snapDemographicsFrom({ ageMin: 21, ageMax: 45, gender: "women" }), [
      { min_age: "21", max_age: "45", genders: ["FEMALE"] },
    ]);
    // ageMax 65 → open-ended top (no max_age)
    assert.deepEqual(snapDemographicsFrom({ ageMin: 18, ageMax: 65, gender: "all" }), [
      { min_age: "18" },
    ]);
  });
});

function INTEREST_ONLY_TIKTOK() {
  return INTERESTS; // helper keeps the filter honest across platforms
}

// ── payload.js — the real per-platform targeting shapes ───────────────────────
describe("payload.js — real targeting per platform", () => {
  it("Meta carries cities[{key,radius,distance_unit}] + interests + age/genders", () => {
    const p = buildCreatePayload("meta", stateFor());
    assert.deepEqual(p.targeting.cities, [{ key: "812057", radius: 10, distance_unit: "mile" }]);
    assert.deepEqual(p.targeting.interests, ["6003375995381"]);
    assert.equal(p.targeting.age_min, 21);
    assert.deepEqual(p.targeting.genders, [2]); // women → Meta [2]
    assert.deepEqual(p.targeting.countries, ["GB"]); // country stays the fallback geo
  });

  it("TikTok carries city location_ids + interest_category_ids + CORRECT gender", () => {
    const p = buildCreatePayload("tiktok", stateFor());
    assert.deepEqual(p.targeting.location_ids, ["9807434"]);
    assert.deepEqual(p.targeting.interest_category_ids, ["27"]);
    // THE bug fix: women → GENDER_FEMALE (the old "female" check produced nothing)
    assert.equal(p.targeting.gender, "GENDER_FEMALE");
  });

  it("Reddit carries genders + passthrough interests (was {countries} only)", () => {
    const p = buildCreatePayload("reddit", stateFor());
    assert.deepEqual(p.targeting.genders, ["FEMALE"]);
    assert.deepEqual(p.targeting.passthrough.reddit.interests, ["nightlife"]);
    assert.equal(p.targeting.age_min, undefined); // Reddit never gets age (R-8)
  });

  it("Snapchat carries demographics (age/gender — was silently dropped)", () => {
    const p = buildCreatePayload("snapchat", stateFor());
    assert.deepEqual(p.targeting.demographics, [{ min_age: "21", max_age: "45", genders: ["FEMALE"] }]);
  });

  it("Google carries named locations (backend re-resolves by name)", () => {
    const p = buildCreatePayload("google", stateFor());
    assert.deepEqual(p.targeting.locations, [{ name: "London", country_code: "GB" }]);
    assert.equal(p.targeting.call_to_action_type, undefined); // A4.b — Google never gets a CTA
  });

  it("no city/interest picked → broad country targeting is unchanged", () => {
    const state = stateFor({ cities: [], interests: [], gender: "all" });
    const meta = buildCreatePayload("meta", state);
    assert.equal(meta.targeting.cities, undefined);
    assert.equal(meta.targeting.interests, undefined);
    assert.deepEqual(meta.targeting.countries, ["GB"]);
    const tiktok = buildCreatePayload("tiktok", state);
    assert.equal(tiktok.targeting.location_ids, undefined);
    assert.equal(tiktok.targeting.interest_category_ids, undefined);
    assert.equal(tiktok.targeting.gender, undefined);
  });
});

// ── Flag flip + #987 P3 (source assertions) ───────────────────────────────────
describe("ISSUE-989 flag flip + ISSUE-987 P3", () => {
  it("TARGETING_SEARCH_PROXY_ENABLED is flipped on", () => {
    assert.equal(TARGETING_SEARCH_PROXY_ENABLED, true);
  });

  it("CampaignBuilderPage passes plannedRows (the picked set) to StepPolicy — #987 P3", () => {
    const src = fs.readFileSync(path.join(__dirname, "../pages/CampaignBuilderPage.jsx"), "utf8");
    const policyBlock = src.slice(src.indexOf("<StepPolicy"), src.indexOf("<StepPolicy") + 400);
    assert.match(policyBlock, /channelRows=\{plannedRows\}/);
    assert.doesNotMatch(policyBlock, /channelRows=\{channelRows\}/);
  });

  it("StepAudience calls the targeting-search proxy (real city/interest pickers)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../components/campaign-builder/StepAudience.jsx"),
      "utf8",
    );
    assert.match(src, /searchTargeting/);
    assert.match(src, /kind:\s*"city"/);
    assert.match(src, /kind:\s*"interest"/);
  });
});
