// ISSUE-992 [Campaign Builder targeting — Google age/gender (3a) + affinity/
// in-market audiences (3b); Snap city circles (3a) + SCLS interest segments
// (3a)] — INDEPENDENT TESTER ADVERSARIAL suite (node:test).
//
// Written by the independent tester (NOT the implementor). A DIFFERENT ANGLE
// from the implementor happy-path (issue992_google_snap_targeting.test.js),
// which asserts POSITIVE presence key-by-key. This suite attacks the NEGATIVE
// space — the money-adjacent integrity properties where a leak / a fabricated
// field / a stale broad build is wasted ad spend on the wrong audience:
//
//   A. G-4 SEAM (marquee): flip GOOGLE_AUDIENCES_ENABLED=false in an ISOLATED
//      copy of the real source and prove ALL of 3b drops (google leaves the
//      interest search; the Google payload sends NO `audiences`) while EVERY
//      3a piece (Google age/gender, Snap circles, Snap interests) stays intact.
//      Different from the happy-path, which only asserts the seam is ON.
//   B. BYTE-IDENTITY by DEEP-EQUAL of the WHOLE targeting object (not the
//      implementor's per-key `=== undefined`): a broad build's Google/Snap
//      targeting must equal the pre-#992 shape EXACTLY — any accidental key is
//      caught.
//   C. COORD / TOKEN SCRUB: deep-recurse the ENTIRE built payload and prove no
//      latitude/longitude/mapbox/token ever reaches the browser (create-time
//      server geocode is the only coordinate source).
//   D. CROSS-PLATFORM LEAK incl. the numeric-id collision trap the happy-path
//      mixed fixture hides — a google-tagged id equal to a snap-tagged id must
//      not bleed across the two NEW platforms.
//   E. snapCirclesFrom robustness — a chip missing label/country yields NO
//      partial circle; radius clamps at both bounds and units.
//   F. googleDemographicsFrom exact boundary behavior (18/19 floor, 64/65 top).
//
// FAILS-ON-REVERT (recorded in the QA verdict): deleting the seam guard
// `if (!GOOGLE_AUDIENCES_ENABLED) return [];` in targeting.js makes the flipped
// copy still return the google audience id → test A "seam OFF ⇒ googleAudience-
// IdsFrom returns []" goes RED. Restored ⇒ GREEN.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import {
  CITY_SEARCH_PLATFORMS,
  GOOGLE_AUDIENCES_ENABLED,
  googleAudienceIdsFrom,
  googleDemographicsFrom,
  INTEREST_SEARCH_PLATFORMS,
  snapCirclesFrom,
  snapInterestCategoryIdsFrom,
} from "../lib/adBuilder/targeting.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADBUILDER_DIR = path.join(__dirname, "../lib/adBuilder");

const LONDON_CHIP = {
  id: "812057",
  label: "London, England, GB",
  country: "GB",
  meta: { key: "812057" },
  google: { name: "London", country_code: "GB" },
  tiktok: { location_ids: ["9807434"] },
};

// A cross-platform interest set where the GOOGLE audience id and the SNAP SCLS
// id are numerically IDENTICAL ("777") but platform-tagged differently — the
// exact collision a naive id-only filter would let bleed across platforms.
const COLLISION_INTERESTS = [
  { platform: "google", id: "777", name: "Live Music Fans (Affinity)" },
  { platform: "snapchat", id: "777", name: "Nightlife & Bars (SCLS)" },
  { platform: "meta", id: "6003375995381", name: "nightlife" },
];

function stateFor(audiencePatch = {}) {
  return {
    lane: "consumer",
    name: "Adversarial-992 — camp",
    goal: {
      metaObjective: "OUTCOME_TRAFFIC",
      metaOptimizationGoal: "LINK_CLICKS",
      platforms: { snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" } },
    },
    destination: { page_type: "brand", brand_slug: "test-brand", entity_slug: null },
    audience: {
      countries: ["GB"],
      cities: [LONDON_CHIP],
      interests: COLLISION_INTERESTS,
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
    requestId: "req-adv-992",
  };
}

/** Deep-recurse an object; return every string key and every string value. */
function collectKeysAndStringValues(node, keys = [], vals = []) {
  if (node == null) return { keys, vals };
  if (Array.isArray(node)) {
    for (const el of node) collectKeysAndStringValues(el, keys, vals);
    return { keys, vals };
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      keys.push(k);
      if (typeof v === "string") vals.push(v);
      collectKeysAndStringValues(v, keys, vals);
    }
  }
  return { keys, vals };
}

// ── A. G-4 SEAM — flip GOOGLE_AUDIENCES_ENABLED=false in an isolated copy ──────
describe("ISSUE-992 adversarial — G-4 seam: false drops ALL 3b, 3a stays intact", () => {
  // Build an isolated, seam-OFF copy of the real adBuilder modules at runtime.
  // We read the COMMITTED source, flip only the one const, and import the copy
  // from the OS temp dir — the repo source is never mutated, and this runs
  // portably in CI (no hardcoded paths).
  async function loadSeamOffModules() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "issue992-seam-"));
    for (const f of ["audienceRules.js", "payload.js", "targeting.js"]) {
      let src = fs.readFileSync(path.join(ADBUILDER_DIR, f), "utf8");
      if (f === "targeting.js") {
        const flipped = src.replace(
          /export const GOOGLE_AUDIENCES_ENABLED = true;/,
          "export const GOOGLE_AUDIENCES_ENABLED = false;",
        );
        assert.notEqual(flipped, src, "seam const must be present to flip (guards the test itself)");
        src = flipped;
      }
      fs.writeFileSync(path.join(tmp, f), src);
    }
    const targeting = await import(pathToFileURL(path.join(tmp, "targeting.js")).href);
    const payload = await import(pathToFileURL(path.join(tmp, "payload.js")).href);
    return { targeting, payload, tmp };
  }

  it("control (seam ON, real module): google IS searchable + audiences DO ship", () => {
    // The byte-difference the seam gates. If this ever flips, the seam is moot.
    assert.equal(GOOGLE_AUDIENCES_ENABLED, true);
    assert.ok(INTEREST_SEARCH_PLATFORMS.includes("google"));
    assert.deepEqual(googleAudienceIdsFrom(COLLISION_INTERESTS), ["777"]);
    const g = buildCreatePayload("google", stateFor());
    assert.deepEqual(g.targeting.audiences, ["777"]);
  });

  it("seam OFF ⇒ google leaves interest search + googleAudienceIdsFrom returns [] (FAILS-ON-REVERT)", async () => {
    const { targeting } = await loadSeamOffModules();
    assert.equal(targeting.GOOGLE_AUDIENCES_ENABLED, false);
    assert.ok(!targeting.INTEREST_SEARCH_PLATFORMS.includes("google"),
      "google must NOT be searchable for interests when the seam is off");
    assert.deepEqual(targeting.googleAudienceIdsFrom(COLLISION_INTERESTS), [],
      "seam off ⇒ NO google audience ids leave the mapper");
  });

  it("seam OFF ⇒ the Google payload carries NO `audiences` key (3b fully dropped)", async () => {
    const { payload } = await loadSeamOffModules();
    const g = payload.buildCreatePayload("google", stateFor());
    assert.equal(g.targeting.audiences, undefined, "3b audiences must not reach the payload when seam off");
    // 3a on Google is UNAFFECTED by the audience seam — age/gender still ship.
    assert.equal(g.targeting.age_min, 21);
    assert.equal(g.targeting.age_max, 45);
    assert.deepEqual(g.targeting.genders, ["FEMALE"]);
  });

  it("seam OFF ⇒ ALL Snap 3a (city search, circles, SCLS interests) stays intact", async () => {
    const { targeting, payload } = await loadSeamOffModules();
    // Snap city search never depended on the Google-audience seam.
    assert.ok(targeting.CITY_SEARCH_PLATFORMS.includes("snapchat"));
    assert.ok(targeting.INTEREST_SEARCH_PLATFORMS.includes("snapchat"));
    assert.deepEqual(targeting.snapInterestCategoryIdsFrom(COLLISION_INTERESTS), ["777"]);
    assert.deepEqual(targeting.snapCirclesFrom([LONDON_CHIP], 12, "mile"), [
      { name: "London, England, GB", country_code: "GB", radius: 12, unit: "mile" },
    ]);
    const s = payload.buildCreatePayload("snapchat", stateFor());
    assert.deepEqual(s.targeting.circles, [
      { name: "London, England, GB", country_code: "GB", radius: 12, unit: "mile" },
    ]);
    assert.deepEqual(s.targeting.interests, ["777"]);
    // And Google 3a demographics survive too (they never keyed off the seam).
    assert.deepEqual(
      targeting.googleDemographicsFrom({ ageMin: 21, ageMax: 45, gender: "women" }),
      { age_min: 21, age_max: 45, genders: ["FEMALE"] },
    );
  });
});

// ── B. Broad build byte-identity by WHOLE-object deep-equal ────────────────────
describe("ISSUE-992 adversarial — broad build targeting is byte-identical (deep-equal)", () => {
  const broad = stateFor({ cities: [], interests: [], ageMin: 18, ageMax: 65, gender: "all" });

  it("Google broad targeting deep-equals EXACTLY { countries } — no #992 key leaked", () => {
    const g = buildCreatePayload("google", broad);
    assert.deepEqual(g.targeting, { countries: ["GB"] });
    assert.deepEqual(Object.keys(g.targeting).sort(), ["countries"]);
  });

  it("Snap broad targeting deep-equals EXACTLY the #991 shape (countries + demographics only)", () => {
    const s = buildCreatePayload("snapchat", broad);
    // #991 baseline: demographics default [{min_age:"18"}]; #992 adds NOTHING here.
    assert.deepEqual(s.targeting, { countries: ["GB"], demographics: [{ min_age: "18" }] });
    assert.ok(!("circles" in s.targeting), "no circles key on a broad Snap build");
    assert.ok(!("interests" in s.targeting), "no interests key on a broad Snap build");
  });
});

// ── C. Coordinate / token scrub across the WHOLE payload ───────────────────────
describe("ISSUE-992 adversarial — no coordinate or Mapbox token ever reaches the browser", () => {
  const FORBIDDEN_KEY = /^(lat|lng|latitude|longitude)$/i;
  const FORBIDDEN_SUBSTR = /(mapbox|latitude|longitude|access_token)/i;

  for (const platform of ["google", "snapchat"]) {
    it(`${platform} payload (city + interests picked) carries no coord/token anywhere`, () => {
      const p = buildCreatePayload(platform, stateFor());
      const { keys, vals } = collectKeysAndStringValues(p);
      const leakedKey = keys.find((k) => FORBIDDEN_KEY.test(k));
      assert.equal(leakedKey, undefined, `no coordinate key (found: ${leakedKey})`);
      const leakedVal = vals.find((v) => FORBIDDEN_SUBSTR.test(v));
      assert.equal(leakedVal, undefined, `no coord/token string value (found: ${leakedVal})`);
    });
  }

  it("Snap circle carries ONLY {name, country_code, radius, unit} — never coords", () => {
    const s = buildCreatePayload("snapchat", stateFor());
    for (const c of s.targeting.circles) {
      assert.deepEqual(Object.keys(c).sort(), ["country_code", "name", "radius", "unit"]);
      assert.equal(c.latitude, undefined);
      assert.equal(c.longitude, undefined);
    }
  });
});

// ── D. Cross-platform interest leak — the numeric-collision trap ───────────────
describe("ISSUE-992 adversarial — google/snap interest ids never bleed across platforms", () => {
  it("id '777' tagged google → ONLY google audiences; tagged snapchat → ONLY snap interests", () => {
    // Same numeric id on two platforms; platform-tag isolation must keep them apart.
    assert.deepEqual(googleAudienceIdsFrom(COLLISION_INTERESTS), ["777"]);
    assert.deepEqual(snapInterestCategoryIdsFrom(COLLISION_INTERESTS), ["777"]);
    // A meta-only chip must never surface on either NEW platform's list.
    assert.deepEqual(googleAudienceIdsFrom([{ platform: "meta", id: "6003375995381" }]), []);
    assert.deepEqual(snapInterestCategoryIdsFrom([{ platform: "meta", id: "6003375995381" }]), []);
  });

  it("at the payload boundary the two lists do not intersect on foreign ids", () => {
    const mixed = [
      { platform: "google", id: "111", name: "g" },
      { platform: "snapchat", id: "222", name: "s" },
      { platform: "meta", id: "333", name: "m" },
    ];
    const g = buildCreatePayload("google", stateFor({ interests: mixed }));
    const s = buildCreatePayload("snapchat", stateFor({ interests: mixed }));
    assert.deepEqual(g.targeting.audiences, ["111"]);
    assert.deepEqual(s.targeting.interests, ["222"]);
    // Neither list may contain the other platform's id or meta's.
    assert.ok(!g.targeting.audiences.includes("222") && !g.targeting.audiences.includes("333"));
    assert.ok(!s.targeting.interests.includes("111") && !s.targeting.interests.includes("333"));
  });
});

// ── E. snapCirclesFrom robustness — no partial circle, clamps at both bounds ───
describe("ISSUE-992 adversarial — snapCirclesFrom drop-on-incomplete + radius clamp", () => {
  it("a chip missing label OR country yields NO circle (never a half-built geo)", () => {
    const noCountry = { label: "Paris, FR" }; // no `country`
    const noLabel = { country: "FR" }; // no `label`
    assert.deepEqual(snapCirclesFrom([noCountry, noLabel]), []);
    // one good + two bad → only the good one survives.
    const out = snapCirclesFrom([noCountry, LONDON_CHIP, noLabel], 10, "mile");
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "London, England, GB");
  });

  it("radius clamps to bounds per unit; non-finite → default", () => {
    assert.equal(snapCirclesFrom([LONDON_CHIP], 0, "mile")[0].radius, 1); // below min → 1
    assert.equal(snapCirclesFrom([LONDON_CHIP], -5, "mile")[0].radius, 1);
    assert.equal(snapCirclesFrom([LONDON_CHIP], 9999, "mile")[0].radius, 50); // mile max
    assert.equal(snapCirclesFrom([LONDON_CHIP], 9999, "kilometer")[0].radius, 80); // km max
    assert.equal(snapCirclesFrom([LONDON_CHIP], "not-a-number", "mile")[0].radius, 10); // default
    // unit is echoed verbatim (the wizard's distanceUnit); coords are absent.
    assert.equal(snapCirclesFrom([LONDON_CHIP], 10, "kilometer")[0].unit, "kilometer");
  });

  it("non-array input → [] (never throws)", () => {
    assert.deepEqual(snapCirclesFrom(null), []);
    assert.deepEqual(snapCirclesFrom(undefined), []);
    assert.deepEqual(snapCirclesFrom("nope"), []);
  });
});

// ── F. googleDemographicsFrom exact floor/top boundaries ───────────────────────
describe("ISSUE-992 adversarial — googleDemographicsFrom floor(18)/top(65) boundaries", () => {
  it("age_min: 18 is NOT sent (== floor), 19 IS sent", () => {
    assert.equal(googleDemographicsFrom({ ageMin: 18, ageMax: 65, gender: "all" }), null);
    assert.deepEqual(googleDemographicsFrom({ ageMin: 19, ageMax: 65, gender: "all" }), { age_min: 19 });
  });

  it("age_max: 65 is NOT sent (== open top), 64 IS sent", () => {
    assert.deepEqual(googleDemographicsFrom({ ageMin: 18, ageMax: 64, gender: "all" }), { age_max: 64 });
    assert.equal(googleDemographicsFrom({ ageMin: 18, ageMax: 65, gender: "all" }), null);
  });

  it("single-year band + men only", () => {
    assert.deepEqual(googleDemographicsFrom({ ageMin: 30, ageMax: 30, gender: "men" }), {
      age_min: 30,
      age_max: 30,
      genders: ["MALE"],
    });
  });

  it("non-numeric age inputs are ignored (never NaN into the payload)", () => {
    assert.equal(googleDemographicsFrom({ ageMin: "abc", ageMax: "xyz", gender: "all" }), null);
    assert.deepEqual(googleDemographicsFrom({ ageMin: "abc", ageMax: 40, gender: "all" }), { age_max: 40 });
  });
});
