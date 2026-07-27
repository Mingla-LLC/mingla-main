// ISSUE-992 [Campaign Builder targeting — Google age/gender (3a) + affinity/
// in-market audiences (3b); Snap city circles (3a) + SCLS interest segments
// (3a)] — IMPLEMENTOR HAPPY-PATH edge-fn regression suite (deno test, hermetic).
//
// What this pins (fixtures + source assertions — NO network):
//   - buildGoogleMutateOperations emits demographic-EXCLUSION criteria (G-1
//     bucket-widening) + POSITIVE userInterest audience criteria; a full-range/
//     all-gender target emits ZERO demographic ops (byte-identical broad build).
//   - googleAgeRangesForRange bucket-widening (21-30 ⇒ 18-24 + 25-34).
//   - parseGoogleUserInterests / filterGoogleUserInterests over the search page.
//   - buildSnapchatCircleGeos groups circles under country_code (never fabricates)
//     + buildSnapchatAdSquadBody nests circles under targeting.geos and emits SCLS
//     targeting.interests[{category_id}].
//   - parseSnapchatInterests / filterSnapchatInterests over the SCLS page.
//   - create-campaign + targeting-search source wiring (the fn actually consumes
//     the new shapes + the Snap create-time geocode).
//
// FAILS-ON-REVERT anchors:
//   - Snap circle geo present ⇒ geos[0].circles[0].latitude exists.
//   - Google women-target ⇒ a negative gender.type==='MALE' op exists.
//   - full age range + all gender ⇒ ZERO demographic ops.

// adChannel.ts owns the adapter registry and forms a cycle with the leaf
// modules — evaluate it FIRST (as the edge-fn entrypoints do) to dodge a TDZ
// ReferenceError when importing the leaves.
import "../../_shared/adChannel.ts";
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildGoogleMutateOperations,
  filterGoogleUserInterests,
  googleAgeRangesForRange,
  type GoogleCreateFullCampaignInput,
  parseGoogleUserInterests,
} from "../../_shared/google.ts";
import {
  buildSnapchatAdSquadBody,
  buildSnapchatCircleGeos,
  filterSnapchatInterests,
  parseSnapchatInterests,
  type SnapchatAdSquadSpec,
  type SnapchatCircleGeo,
} from "../../_shared/snapchat.ts";

const CUSTOMER = "3623860476";

function googleInput(over: Partial<GoogleCreateFullCampaignInput> = {}): GoogleCreateFullCampaignInput {
  return {
    name: "camp",
    dailyBudgetCents: 5000,
    finalUrl: "https://usemingla.com/e/brand/event",
    headlines: ["h1", "h2", "h3"],
    descriptions: ["d1", "d2"],
    keywords: [{ text: "nightlife", matchType: "PHRASE" }],
    geoTargetCriterionIds: ["1006886"],
    ...over,
  };
}

/** Collect the ad-group demographic/audience criteria emitted by the mutate. */
function adGroupCriteria(ops: Record<string, unknown>[]): Record<string, unknown>[] {
  return ops
    .map((o) => (o.adGroupCriterionOperation as Record<string, unknown> | undefined)?.create)
    .filter((c): c is Record<string, unknown> =>
      !!c && (("ageRange" in c) || ("gender" in c) || ("userInterest" in c))
    );
}

// ── Google age-band mapping (G-1 bucket-widening ACCEPTED) ─────────────────────
Deno.test("googleAgeRangesForRange widens to every overlapping fixed band (G-1)", () => {
  // 21-30 overlaps 18-24 AND 25-34 (wider than asked — never hard-clamped).
  assertEquals(googleAgeRangesForRange(21, 30), ["AGE_RANGE_18_24", "AGE_RANGE_25_34"]);
  // 25-44 → 25-34 + 35-44 exactly.
  assertEquals(googleAgeRangesForRange(25, 44), ["AGE_RANGE_25_34", "AGE_RANGE_35_44"]);
  // full targetable span → all six bands.
  assertEquals(googleAgeRangesForRange(18, 65).length, 6);
});

// ── Google demographics by EXCLUSION + audiences (POSITIVE) ────────────────────
Deno.test("buildGoogleMutateOperations: women+21-30 target → negative gender MALE + out-of-range age exclusions", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER, googleInput({
    ageRanges: googleAgeRangesForRange(21, 30), // 18-24 + 25-34 included
    genders: ["FEMALE"], // target women
  }));
  const crit = adGroupCriteria(ops);
  // FAILS-ON-REVERT: a women target emits a negative gender MALE op.
  const genderOps = crit.filter((c) => "gender" in c);
  assertEquals(genderOps.length, 1);
  assertEquals((genderOps[0].gender as Record<string, unknown>).type, "MALE");
  assertEquals(genderOps[0].negative, true);
  // Age: the four bands OUTSIDE [18-24,25-34] are excluded; the two inside are NOT.
  const excludedAges = crit
    .filter((c) => "ageRange" in c)
    .map((c) => (c.ageRange as Record<string, unknown>).type);
  assertEquals(excludedAges.sort(), [
    "AGE_RANGE_35_44",
    "AGE_RANGE_45_54",
    "AGE_RANGE_55_64",
    "AGE_RANGE_65_UP",
  ]);
  // G-2 default (excludeUndetermined false): UNDETERMINED is NOT excluded.
  assert(!excludedAges.includes("AGE_RANGE_UNDETERMINED"));
});

Deno.test("buildGoogleMutateOperations: FAILS-ON-REVERT full range + all gender ⇒ ZERO demographic ops", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER, googleInput({
    ageRanges: googleAgeRangesForRange(18, 65), // all 6 bands
    genders: [], // all
  }));
  const demoOps = adGroupCriteria(ops).filter((c) => "ageRange" in c || "gender" in c);
  assertEquals(demoOps.length, 0);
});

Deno.test("buildGoogleMutateOperations (3b): audiences emit POSITIVE userInterest criteria", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER, googleInput({ userInterestIds: ["80546", "92011"] }));
  const audienceOps = adGroupCriteria(ops).filter((c) => "userInterest" in c);
  assertEquals(audienceOps.length, 2);
  assertEquals(
    (audienceOps[0].userInterest as Record<string, unknown>).userInterestCategory,
    "userInterests/80546",
  );
  // positive (no negative flag) — an audience is an inclusion, not an exclusion.
  assertEquals(audienceOps[0].negative, undefined);
});

Deno.test("buildGoogleMutateOperations (G-2): excludeUndetermined flags add the UNDETERMINED negatives", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER, googleInput({
    ageRanges: googleAgeRangesForRange(25, 34),
    genders: ["MALE"],
    excludeUndeterminedAge: true,
    excludeUndeterminedGender: true,
  }));
  const crit = adGroupCriteria(ops);
  assert(
    crit.some((c) => (c.ageRange as Record<string, unknown> | undefined)?.type === "AGE_RANGE_UNDETERMINED"),
  );
  assert(
    crit.some((c) => (c.gender as Record<string, unknown> | undefined)?.type === "UNDETERMINED"),
  );
});

// ── Google user_interest search parse/filter ──────────────────────────────────
Deno.test("parseGoogleUserInterests + filterGoogleUserInterests over a search page", () => {
  const payload = {
    results: [
      { userInterest: { userInterestId: "80546", name: "Live Music Fans", taxonomyType: "AFFINITY" } },
      { userInterest: { userInterestId: "92011", name: "Event Ticket Buyers", taxonomyType: "IN_MARKET" } },
      { userInterest: { name: "no id — dropped" } },
      { userInterest: { userInterestId: "80546", name: "dup — dropped" } },
    ],
  };
  const parsed = parseGoogleUserInterests(payload);
  assertEquals(parsed.length, 2);
  assertEquals(parsed[0].id, "80546");
  assertEquals(parsed[0].taxonomyType, "AFFINITY");
  const music = filterGoogleUserInterests(parsed, { q: "music" });
  assertEquals(music.length, 1);
  assertEquals(music[0].id, "80546");
});

// ── Snap circle geos — grouped under country_code, never fabricated ────────────
Deno.test("buildSnapchatCircleGeos groups circles under country_code + drops junk", () => {
  const circles: SnapchatCircleGeo[] = [
    { country_code: "GB", latitude: 51.5, longitude: -0.12, radius: 10, unit: "mile" },
    { country_code: "gb", latitude: 53.4, longitude: -2.24, radius: 5, unit: "mile" },
    { country_code: "US", latitude: 40.7, longitude: -74, radius: 8, unit: "kilometer" },
    // junk (NaN coords) is dropped — never fabricated.
    { country_code: "FR", latitude: NaN, longitude: 2.3, radius: 5, unit: "mile" },
  ];
  const geos = buildSnapchatCircleGeos(circles)!;
  // GB (two circles, case-folded to one country) + US.
  assertEquals(geos.length, 2);
  const gb = geos.find((g) => g.country_code === "gb")!;
  assertEquals((gb.circles as unknown[]).length, 2);
  // empty ⇒ null (caller keeps country-only geos).
  assertEquals(buildSnapchatCircleGeos([]), null);
});

// ── Snap ad-squad body — circles nested under geos + SCLS interests ────────────
function snapSpec(over: Partial<SnapchatAdSquadSpec> = {}): SnapchatAdSquadSpec {
  return {
    name: "camp — ad squad",
    optimizationGoal: "SWIPES",
    countries: ["GB"],
    ...over,
  };
}

Deno.test("buildSnapchatAdSquadBody: FAILS-ON-REVERT circle present ⇒ geos[0].circles[0].latitude exists", () => {
  const body = buildSnapchatAdSquadBody("camp-id", snapSpec({
    circles: [{ country_code: "GB", latitude: 51.5, longitude: -0.12, radius: 12, unit: "mile" }],
    interestCategoryIds: ["1417", "1502"],
  }));
  const targeting = body.targeting as Record<string, unknown>;
  const geos = targeting.geos as Record<string, unknown>[];
  assertEquals(geos[0].country_code, "gb");
  const circle = (geos[0].circles as Record<string, unknown>[])[0];
  assert(typeof circle.latitude === "number", "circle latitude must be present");
  assertEquals(circle.radius, 12);
  assertEquals(circle.unit, "mile");
  // SCLS interests ride as targeting.interests[{category_id:[...]}].
  assertEquals(targeting.interests, [{ category_id: ["1417", "1502"] }]);
});

Deno.test("buildSnapchatAdSquadBody: no circles ⇒ country-only geos (broad build unchanged)", () => {
  const body = buildSnapchatAdSquadBody("camp-id", snapSpec({ countries: ["GB", "US"] }));
  const targeting = body.targeting as Record<string, unknown>;
  assertEquals(targeting.geos, [{ country_code: "gb" }, { country_code: "us" }]);
  assertEquals(targeting.interests, undefined);
});

// ── Snap SCLS parse/filter ────────────────────────────────────────────────────
Deno.test("parseSnapchatInterests + filterSnapchatInterests over targeting_dimensions", () => {
  const rows = [
    { scls: { id: "1417", name: "Nightlife & Bars", source: "sc" }, sub_request_status: "SUCCESS" },
    { scls: { id: "1502", name: "Live Music", source: "sc" } },
    { scls: { name: "no id — dropped" } },
    { scls: { id: "1417", name: "dup — dropped" } },
  ];
  const parsed = parseSnapchatInterests(rows);
  assertEquals(parsed.length, 2);
  assertEquals(parsed[0].id, "1417");
  const music = filterSnapchatInterests(parsed, { q: "music" });
  assertEquals(music.length, 1);
  assertEquals(music[0].id, "1502");
});

// ── Source wiring — the fns actually consume the new shapes ───────────────────
Deno.test("create-campaign consumes Google demographics/audiences + Snap circles/interests + create-time geocode", async () => {
  const src = await Deno.readTextFile(new URL("../../admin-ad-create-campaign/index.ts", import.meta.url));
  // Google 3a/3b wiring.
  assert(src.includes("googleAgeRangesForRange"), "Google age-band mapping must be wired");
  assert(src.includes("ageRanges: googleAgeRanges"), "Google target age bands must reach createInput");
  assert(src.includes("userInterestIds: googleUserInterestIds"), "Google audiences must reach createInput");
  // Snap 3a wiring + create-time SERVER geocode (coords never client-side).
  assert(src.includes("forwardGeocodeText"), "Snap circles must be geocoded server-side at create");
  assert(src.includes("circles: geocodedCirclesS"), "geocoded circles must reach the Snap ad-squad targeting");
  assert(src.includes("interests: snapInterestIdsS"), "Snap SCLS interests must reach the ad-squad targeting");
});

Deno.test("targeting-search resolves Google audiences + Snap city/interest branches", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(src.includes("searchGoogleUserInterests"), "Google audience resolver must be wired (3b)");
  assert(src.includes("snapchatFetchInterests"), "Snap SCLS interest resolver must be wired (3a)");
  assert(src.includes("resolveSnapchat"), "Snap resolver must replace the fail-open stub");
  // the old deferred stubs must be gone.
  assert(!src.includes("aren't wired yet"), "the Google-audience 'aren't wired yet' stub must be removed");
  assert(!src.includes("interest segments are coming"), "the Snap 'coming' fail-open stub must be removed");
});
