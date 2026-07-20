// ISSUE-989 [Campaign Builder real targeting] — TESTER ADVERSARIAL suite.
//
// A DIFFERENT ANGLE from the implementor's happy-path suite
// (issue989_targeting.test.js). Where the implementor asserts POSITIVE presence
// ("Meta carries cities", "TikTok carries location_ids", each platform gets its
// own shape), this suite attacks the NEGATIVE space — the money-adjacent
// integrity properties that make wrong targeting = wasted spend:
//
//   1. CROSS-PLATFORM LEAK: interest ids are platform-scoped taxonomies. A Meta
//      interest id (e.g. "6003375995381") is NUMERIC and would SILENTLY pass
//      TikTok's `/^\d+$/` interest_category_id filter — so if the platform-tag
//      isolation ever broke, a Meta interest would be sent to TikTok as a bogus
//      category id (spend on a category that does not exist). Prove the isolation
//      holds even for a numeric-id collision the implementor's mixed fixture hides.
//
//   2. DEFERRED-PLATFORM HONESTY (issue #989 scope split): Snapchat city-circle +
//      interest-segment consumption and Google interest/affinity + age/gender are
//      NOT built at create time. Prove a picked city / interest / age-gender does
//      NOT produce a payload that LOOKS targeted but isn't — the deferred
//      platforms must carry ONLY what they truly consume (Snap: countries +
//      demographics; Google: countries + city locations), never a fabricated
//      city/interest field.
//
// FAILS-ON-REVERT: removing the `.filter((i) => i?.platform === platform)`
// platform-isolation in targeting.js `interestsForPlatform` makes the numeric
// Meta id "6003375995381" leak into tiktokInterestCategoryIdsFrom → assertion in
// "a numeric Meta interest id must not leak into TikTok" FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import {
  metaInterestIdsFrom,
  redditInterestNamesFrom,
  tiktokInterestCategoryIdsFrom,
} from "../lib/adBuilder/targeting.js";

// A London chip resolved across Meta + Google + TikTok (as StepAudience builds it).
const LONDON_CHIP = {
  id: "812057",
  label: "London, England, GB",
  country: "GB",
  meta: { key: "812057" },
  google: { name: "London", country_code: "GB" },
  tiktok: { location_ids: ["9807434"] },
};

// Interest chips are per-platform taxonomies — NEVER cross-mappable.
const META_INTEREST = { platform: "meta", id: "6003375995381", name: "nightlife" }; // numeric id
const TIKTOK_INTEREST = { platform: "tiktok", id: "27", name: "Food & Beverage" };
const REDDIT_INTEREST = { platform: "reddit", id: "nightlife", name: "nightlife" };

function stateFor(audiencePatch = {}) {
  return {
    lane: "consumer",
    name: "Adversarial — camp",
    goal: {
      metaObjective: "OUTCOME_TRAFFIC",
      metaOptimizationGoal: "LINK_CLICKS",
      platforms: {
        tiktok: { objective: "TRAFFIC" },
        reddit: { objective: "CLICKS" },
        snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" },
        google: { objective: "CLICKS" },
      },
    },
    destination: { page_type: "brand", brand_slug: "test-brand", entity_slug: null },
    audience: {
      countries: ["GB"],
      cities: [LONDON_CHIP],
      interests: [META_INTEREST, TIKTOK_INTEREST, REDDIT_INTEREST],
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
    requestId: "req-adv-1",
  };
}

// ── (1) Cross-platform interest LEAK — the numeric-id collision trap ───────────
describe("ISSUE-989 adversarial — no cross-platform interest leak", () => {
  it("a numeric Meta interest id must NOT leak into TikTok's interest_category_ids", () => {
    // "6003375995381" is numeric → it WOULD pass TikTok's /^\d+$/ filter. Only the
    // platform-tag isolation stops it. This is the leak the implementor's mixed
    // fixture (one chip per platform) can never expose.
    const metaOnly = [META_INTEREST];
    assert.deepEqual(tiktokInterestCategoryIdsFrom(metaOnly), []);
    assert.deepEqual(redditInterestNamesFrom(metaOnly), []);
    // At the payload boundary: a TikTok campaign carrying only Meta interests
    // must omit interest_category_ids entirely (broad, not a bogus category).
    const tiktokPayload = buildCreatePayload("tiktok", stateFor({ interests: metaOnly, cities: [] }));
    assert.equal(tiktokPayload.targeting.interest_category_ids, undefined);
  });

  it("a TikTok interest id must NOT leak into Meta's flexible_spec interests", () => {
    const tiktokOnly = [TIKTOK_INTEREST];
    assert.deepEqual(metaInterestIdsFrom(tiktokOnly), []);
    assert.deepEqual(redditInterestNamesFrom(tiktokOnly), []);
    const metaPayload = buildCreatePayload("meta", stateFor({ interests: tiktokOnly, cities: [] }));
    assert.equal(metaPayload.targeting.interests, undefined);
  });

  it("each platform draws ONLY its own tagged interests from a mixed set", () => {
    const all = [META_INTEREST, TIKTOK_INTEREST, REDDIT_INTEREST];
    assert.deepEqual(metaInterestIdsFrom(all), ["6003375995381"]);
    assert.deepEqual(tiktokInterestCategoryIdsFrom(all), ["27"]);
    assert.deepEqual(redditInterestNamesFrom(all), ["nightlife"]);
  });
});

// ── (2) Deferred-platform honesty — no "looks targeted but isn't" payload ──────
describe("ISSUE-989 adversarial — deferred platforms never fabricate targeting", () => {
  it("Snapchat carries ONLY countries + demographics — never a fabricated city/interest", () => {
    // Snap city-circle + interest-segment consumption is deferred (#989 split).
    // A picked city + interests must NOT surface as any Snap targeting field.
    const p = buildCreatePayload("snapchat", stateFor());
    const t = p.targeting;
    // Honest positives: the country + the age/gender demographics that DO ship.
    assert.deepEqual(t.countries, ["GB"]);
    assert.deepEqual(t.demographics, [{ min_age: "21", max_age: "45", genders: ["FEMALE"] }]);
    // Dishonest fields that must be ABSENT (city/interest not consumed by Snap):
    for (const forbidden of [
      "cities",
      "location_ids",
      "interests",
      "interest_category_ids",
      "locations",
      "flexible_spec",
      "passthrough",
    ]) {
      assert.equal(t[forbidden], undefined, `Snap targeting must not carry ${forbidden}`);
    }
  });

  it("Google carries ONLY countries + city locations — never a fabricated interest / age-gender", () => {
    // Google interest/affinity + age/gender demographics are deferred (#989 split);
    // Google city (geoTargetConstants) IS shipped. Honest = the city travels, the
    // rest does not silently masquerade as targeted.
    const p = buildCreatePayload("google", stateFor());
    const t = p.targeting;
    assert.deepEqual(t.countries, ["GB"]);
    assert.deepEqual(t.locations, [{ name: "London", country_code: "GB" }]); // shipped
    for (const forbidden of [
      "interests",
      "interest_category_ids",
      "flexible_spec",
      "age_min",
      "age_max",
      "genders",
      "gender",
      "demographics",
      "passthrough",
    ]) {
      assert.equal(t[forbidden], undefined, `Google targeting must not carry ${forbidden}`);
    }
  });
});
