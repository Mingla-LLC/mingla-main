// ISSUE-992 [Campaign Builder targeting — Google age/gender (3a) + affinity/
// in-market audiences (3b); Snap city circles (3a) + SCLS interest segments
// (3a)] — IMPLEMENTOR HAPPY-PATH regression suite (node:test — pure-logic module
// tests + fs source assertions, no DOM; the #989 house pattern).
//
// What this pins:
//   - targeting.js NEW mappers: googleDemographicsFrom (G-1 bucket thresholds +
//     G-2 kept-included behavior), googleGendersFor, googleAudienceIdsFrom (3b
//     seam), snapInterestCategoryIdsFrom, snapCirclesFrom (name+country, radius
//     clamp — NO coords client-side).
//   - CITY/INTEREST_SEARCH_PLATFORMS gain snapchat (3a) + google (3b, seam-gated).
//   - payload.js sends the REAL new shapes: Google targeting.{age_min,age_max,
//     genders,audiences}; Snap targeting.{circles,interests}. Empty selections
//     omit the keys (broad build byte-identical). Google NEVER gets a CTA (A4.b).
//   - StepAudience honesty copy flipped (Google honors age/gender; radius = Meta
//     & Snap; Google whole-city) + the radius label relabel.
//
// FAILS-ON-REVERT anchors (each fails if the fix line is DELETED):
//   - deleting the Google demographics spread in payload.js drops age_min/genders
//     from the Google payload (assert genders===["FEMALE"] for a women target).
//   - deleting the Snap circles spread drops targeting.circles (assert present).
//   - deleting "snapchat" from CITY_SEARCH_PLATFORMS fails the membership assert.
//   - flipping the honesty copy back re-introduces "Google Search ignores both".

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import {
  CITY_SEARCH_PLATFORMS,
  GOOGLE_AUDIENCES_ENABLED,
  googleAudienceIdsFrom,
  googleDemographicsFrom,
  googleGendersFor,
  INTEREST_SEARCH_PLATFORMS,
  snapCirclesFrom,
  snapInterestCategoryIdsFrom,
} from "../lib/adBuilder/targeting.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LONDON_CHIP = {
  id: "812057",
  label: "London, England, GB",
  country: "GB",
  meta: { key: "812057" },
  google: { name: "London", country_code: "GB" },
  tiktok: null,
};
// Interest chips as the widened Audience step builds them (platform-tagged).
const INTERESTS = [
  { platform: "meta", id: "6003375995381", name: "nightlife" },
  { platform: "google", id: "80546", name: "Live Music Fans (Affinity)" },
  { platform: "snapchat", id: "1417", name: "Nightlife & Bars" },
];

function stateFor(audiencePatch = {}) {
  return {
    lane: "consumer",
    name: "Test — camp",
    goal: {
      metaObjective: "OUTCOME_TRAFFIC",
      metaOptimizationGoal: "LINK_CLICKS",
      platforms: {
        snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" },
      },
    },
    destination: { page_type: "brand", brand_slug: "test-brand", entity_slug: null },
    audience: {
      countries: ["GB"],
      cities: [LONDON_CHIP],
      interests: INTERESTS,
      radius: 12,
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
    requestId: "req-992",
  };
}

// ── targeting.js — the NEW mappers ────────────────────────────────────────────
describe("ISSUE-992 targeting.js — Google demographics + audiences, Snap circles + interests", () => {
  it("googleGendersFor maps women/men → TARGET gender (server excludes opposite)", () => {
    assert.deepEqual(googleGendersFor("women"), ["FEMALE"]);
    assert.deepEqual(googleGendersFor("men"), ["MALE"]);
    assert.equal(googleGendersFor("all"), undefined);
  });

  it("googleDemographicsFrom: narrowed age/gender → sent; full-range + all → null (G-1/G-2)", () => {
    // Narrowed within Google's targetable span (floor 18, top 65+ open).
    assert.deepEqual(googleDemographicsFrom({ ageMin: 21, ageMax: 45, gender: "women" }), {
      age_min: 21,
      age_max: 45,
      genders: ["FEMALE"],
    });
    // 18-65 = full targetable span, all gender → nothing to send (byte-identical broad).
    assert.equal(googleDemographicsFrom({ ageMin: 18, ageMax: 65, gender: "all" }), null);
    // ageMin below Google's floor (18) is not sent; only the real narrowing (max) is.
    assert.deepEqual(googleDemographicsFrom({ ageMin: 13, ageMax: 40, gender: "all" }), {
      age_max: 40,
    });
    // gender only, full age → just genders.
    assert.deepEqual(googleDemographicsFrom({ ageMin: 18, ageMax: 65, gender: "men" }), {
      genders: ["MALE"],
    });
  });

  it("googleAudienceIdsFrom returns google-tagged ids only (3b seam gated on)", () => {
    assert.equal(GOOGLE_AUDIENCES_ENABLED, true);
    assert.deepEqual(googleAudienceIdsFrom(INTERESTS), ["80546"]);
    // never leaks meta/snapchat interest ids onto the Google audience list.
    assert.deepEqual(googleAudienceIdsFrom([{ platform: "meta", id: "1" }]), []);
  });

  it("snapInterestCategoryIdsFrom returns snapchat-tagged SCLS ids only", () => {
    assert.deepEqual(snapInterestCategoryIdsFrom(INTERESTS), ["1417"]);
    assert.deepEqual(snapInterestCategoryIdsFrom([{ platform: "google", id: "80546" }]), []);
  });

  it("snapCirclesFrom carries NAME + country + clamped radius (NO coords client-side)", () => {
    assert.deepEqual(snapCirclesFrom([LONDON_CHIP], 12, "mile"), [
      { name: "London, England, GB", country_code: "GB", radius: 12, unit: "mile" },
    ]);
    // radius clamps to the Meta/Snap bounds; km bound differs.
    assert.equal(snapCirclesFrom([LONDON_CHIP], 500, "mile")[0].radius, 50);
    assert.equal(snapCirclesFrom([LONDON_CHIP], 500, "kilometer")[0].radius, 80);
    // no coordinate field EVER leaves the browser.
    const c = snapCirclesFrom([LONDON_CHIP], 10, "mile")[0];
    assert.equal(c.latitude, undefined);
    assert.equal(c.longitude, undefined);
  });

  it("search-platform arrays gain snapchat (city + interest) and google (interest)", () => {
    assert.ok(CITY_SEARCH_PLATFORMS.includes("snapchat"), "Snap city search enabled");
    assert.ok(INTEREST_SEARCH_PLATFORMS.includes("snapchat"), "Snap interest search enabled");
    assert.ok(INTEREST_SEARCH_PLATFORMS.includes("google"), "Google audience search enabled (seam on)");
  });
});

// ── payload.js — the REAL new per-platform shapes ─────────────────────────────
describe("ISSUE-992 payload.js — Google demographics/audiences + Snap circles/interests", () => {
  it("Google carries age_min/age_max/genders + audiences (and NEVER a CTA — A4.b)", () => {
    const p = buildCreatePayload("google", stateFor());
    assert.equal(p.targeting.age_min, 21);
    assert.equal(p.targeting.age_max, 45);
    assert.deepEqual(p.targeting.genders, ["FEMALE"]); // women target
    assert.deepEqual(p.targeting.audiences, ["80546"]); // 3b affinity/in-market
    assert.equal(p.targeting.call_to_action_type, undefined); // A4.b — Search RSAs have no CTA
    assert.deepEqual(p.targeting.countries, ["GB"]); // country stays the fallback geo
  });

  it("Snapchat carries circles (name+country, no coords) + SCLS interests + demographics", () => {
    const p = buildCreatePayload("snapchat", stateFor());
    assert.deepEqual(p.targeting.circles, [
      { name: "London, England, GB", country_code: "GB", radius: 12, unit: "mile" },
    ]);
    assert.deepEqual(p.targeting.interests, ["1417"]);
    // #991 demographics still travel unchanged.
    assert.deepEqual(p.targeting.demographics, [
      { min_age: "21", max_age: "45", genders: ["FEMALE"] },
    ]);
    // coords never client-side.
    assert.equal(p.targeting.circles[0].latitude, undefined);
  });

  it("no city/interest/narrowing picked → Google + Snap broad build is byte-identical", () => {
    const broad = stateFor({ cities: [], interests: [], ageMin: 18, ageMax: 65, gender: "all" });
    const g = buildCreatePayload("google", broad);
    assert.equal(g.targeting.age_min, undefined);
    assert.equal(g.targeting.age_max, undefined);
    assert.equal(g.targeting.genders, undefined);
    assert.equal(g.targeting.audiences, undefined);
    assert.equal(g.targeting.locations, undefined);
    const s = buildCreatePayload("snapchat", broad);
    assert.equal(s.targeting.circles, undefined);
    assert.equal(s.targeting.interests, undefined);
  });

  it("FAILS-ON-REVERT: a women-targeted Google build sends genders=['FEMALE']", () => {
    // Deleting the googleDemographicsFrom spread in payload.js drops this key.
    const p = buildCreatePayload("google", stateFor({ gender: "women" }));
    assert.deepEqual(p.targeting.genders, ["FEMALE"]);
  });
});

// ── StepAudience honesty copy + gates (source assertions) ─────────────────────
describe("ISSUE-992 StepAudience honesty copy + widened gates", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../components/campaign-builder/StepAudience.jsx"),
    "utf8",
  );
  // JSX wraps copy across lines — collapse whitespace for prose assertions.
  const prose = src.replace(/\s+/g, " ");

  it("age/gender honesty copy now names Google; no longer says 'Google Search ignores both'", () => {
    assert.doesNotMatch(prose, /Google Search ignores both/);
    assert.match(prose, /Age applies to Meta, TikTok, Snapchat and Google/);
    assert.match(prose, /City radius applies to Meta and Snapchat/);
  });

  it("radius control shows for Snap and is relabeled 'Radius (Meta & Snap)'", () => {
    assert.match(src, /pickedPlatforms\.includes\("snapchat"\)/);
    assert.match(prose, /Radius \(Meta &amp; Snap\)/);
  });

  it("interest typeahead fans out to google + snapchat", () => {
    assert.match(prose, /p === "google" \|\| p === "snapchat"/);
  });
});
