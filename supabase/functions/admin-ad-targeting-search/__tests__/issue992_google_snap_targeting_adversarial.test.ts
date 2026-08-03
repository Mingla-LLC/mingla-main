// ISSUE-992 [Campaign Builder targeting — Google age/gender (3a) + affinity/
// in-market audiences (3b); Snap city circles (3a) + SCLS interest segments
// (3a)] — INDEPENDENT TESTER ADVERSARIAL edge-fn suite (deno test, hermetic).
//
// Written by the independent tester (NOT the implementor). A DIFFERENT ANGLE
// from the implementor happy-path (issue992_google_snap_targeting_search.test.ts):
// where the implementor proves the ops it WANTS are present, this suite attacks
// the boundary math, the exclusion COMPLEMENT, the null/junk drop, the unit-token
// coercion, the ad-group SCOPE, and the byte-identity of the broad build — the
// places where a wrong operation = wasted spend or a policy rejection.
//
//   A. Age-band boundary math (13/18/24/25/64/65, single-year, inverted, open).
//   B. Exclusion is NEGATIVE criteria on buckets OUTSIDE the target — men ⇒
//      exclude FEMALE (the mirror of the implementor's women⇒MALE), both⇒none,
//      and every demographic/audience op is AD-GROUP-scoped (never campaign).
//   C. Full-range ⇒ ZERO demographic ops proven by DEEP-EQUAL of the whole ops
//      array to the no-demographic baseline (byte-identical broad build).
//   D. userInterest positive-criteria shape `userInterests/{id}`, junk-id drop.
//   E. buildSnapchatCircleGeos: null/junk ⇒ null (never fabricates); unit-token
//      coercion (the documented "mile|kilometer" vs "mi|km" contradiction);
//      case-fold + grouping.
//   F. buildSnapchatAdSquadBody: circles REPLACE country geos (the non-circle
//      country is DROPPED — "laser, not union").
//   G. parse tolerance (SCLS category_id / user_interest snake_case) + filter
//      prefix-ordering.
//   H. #1184 four-anchor adapter threading + the video-create 422 guard + the
//      create-time geocode null-drop are all still wired (source assertions).
//
// FAILS-ON-REVERT (recorded in the QA verdict):
//   - delete `if (targetAges.includes(band)) continue;` (google.ts) ⇒ test C RED
//     (full range would emit six exclusions instead of zero).
//   - neutralise the gender opposite (`const opposite = ...`) ⇒ test B RED.
//   - change `const geos = circleGeos ?? ...` to ignore circles ⇒ test F RED.

// adChannel.ts owns the adapter registry and forms a cycle with the leaf modules
// — evaluate it FIRST (as the edge-fn entrypoints do) to dodge a TDZ error.
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

const CUSTOMER = "9988776655";

function gInput(over: Partial<GoogleCreateFullCampaignInput> = {}): GoogleCreateFullCampaignInput {
  return {
    name: "adv-camp",
    dailyBudgetCents: 4200,
    finalUrl: "https://usemingla.com/e/brand/ev",
    headlines: ["h1", "h2", "h3"],
    descriptions: ["d1", "d2"],
    keywords: [{ text: "bars", matchType: "PHRASE" }],
    geoTargetCriterionIds: ["1006886"],
    ...over,
  };
}

/** The demographic/audience ad-group criteria the mutate emitted. */
function demoAudienceCriteria(ops: Record<string, unknown>[]): Record<string, unknown>[] {
  return ops
    .map((o) => (o.adGroupCriterionOperation as Record<string, unknown> | undefined)?.create)
    .filter((c): c is Record<string, unknown> =>
      !!c && (("ageRange" in c) || ("gender" in c) || ("userInterest" in c))
    );
}

// ── A. Age-band boundary math ──────────────────────────────────────────────────
Deno.test("adv A: googleAgeRangesForRange boundaries — 18/24/25/64/65 land in the right bands", () => {
  assertEquals(googleAgeRangesForRange(18, 18), ["AGE_RANGE_18_24"]);
  assertEquals(googleAgeRangesForRange(24, 24), ["AGE_RANGE_18_24"]); // 24 is the top of band 1
  assertEquals(googleAgeRangesForRange(25, 25), ["AGE_RANGE_25_34"]); // 25 is the floor of band 2
  assertEquals(googleAgeRangesForRange(24, 25), ["AGE_RANGE_18_24", "AGE_RANGE_25_34"]); // straddle
  assertEquals(googleAgeRangesForRange(64, 64), ["AGE_RANGE_55_64"]);
  assertEquals(googleAgeRangesForRange(65, 65), ["AGE_RANGE_65_UP"]); // 65 → open top band only
  assertEquals(googleAgeRangesForRange(64, 65), ["AGE_RANGE_55_64", "AGE_RANGE_65_UP"]);
  assertEquals(googleAgeRangesForRange(40, 40), ["AGE_RANGE_35_44"]); // single-year inside a band
});

Deno.test("adv A: inverted range ⇒ [] and below-floor young range ⇒ [] (no bands overlap)", () => {
  // Inverted (max<min): the server 422s BEFORE this is called, but the pure fn
  // must not invent a band. Below Google's 18 floor likewise yields no band.
  assertEquals(googleAgeRangesForRange(45, 25), []);
  assertEquals(googleAgeRangesForRange(13, 17), []);
});

Deno.test("adv A: open-ended bounds default to the widest span (unset never narrows)", () => {
  assertEquals(googleAgeRangesForRange(30, undefined), [
    "AGE_RANGE_25_34", "AGE_RANGE_35_44", "AGE_RANGE_45_54", "AGE_RANGE_55_64", "AGE_RANGE_65_UP",
  ]);
  assertEquals(googleAgeRangesForRange(undefined, 40), [
    "AGE_RANGE_18_24", "AGE_RANGE_25_34", "AGE_RANGE_35_44",
  ]);
  assertEquals(googleAgeRangesForRange(undefined, undefined).length, 6);
});

// ── B. Exclusion complement + ad-group scope ───────────────────────────────────
Deno.test("adv B: target MEN ⇒ exclude FEMALE (mirror of women⇒MALE); never a positive gender op", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER, gInput({
    ageRanges: googleAgeRangesForRange(25, 34),
    genders: ["MALE"], // target men
  }));
  const crit = demoAudienceCriteria(ops);
  const genderOps = crit.filter((c) => "gender" in c);
  assertEquals(genderOps.length, 1);
  assertEquals((genderOps[0].gender as Record<string, unknown>).type, "FEMALE"); // exclude the OPPOSITE
  assertEquals(genderOps[0].negative, true);
  // No positive gender criterion is EVER emitted (a positive would over-narrow).
  assert(!crit.some((c) => "gender" in c && c.negative !== true), "no positive gender op");
});

Deno.test("adv B: both genders (all) ⇒ ZERO gender ops; empty ⇒ ZERO gender ops", () => {
  const both = buildGoogleMutateOperations(CUSTOMER, gInput({ genders: ["MALE", "FEMALE"] }));
  assertEquals(demoAudienceCriteria(both).filter((c) => "gender" in c).length, 0);
  const none = buildGoogleMutateOperations(CUSTOMER, gInput({ genders: [] }));
  assertEquals(demoAudienceCriteria(none).filter((c) => "gender" in c).length, 0);
});

Deno.test("adv B: age exclusions are EXACTLY the complement; UNDETERMINED kept (G-2 default)", () => {
  // Target 25-44 ⇒ include 25_34 + 35_44; exclude the other four; keep UNDETERMINED.
  const ops = buildGoogleMutateOperations(CUSTOMER, gInput({
    ageRanges: googleAgeRangesForRange(25, 44),
  }));
  const excluded = demoAudienceCriteria(ops)
    .filter((c) => "ageRange" in c)
    .map((c) => (c.ageRange as Record<string, unknown>).type)
    .sort();
  assertEquals(excluded, ["AGE_RANGE_18_24", "AGE_RANGE_45_54", "AGE_RANGE_55_64", "AGE_RANGE_65_UP"]);
  assert(!excluded.includes("AGE_RANGE_UNDETERMINED"), "UNDETERMINED must stay INCLUDED by default");
});

Deno.test("adv B: EVERY demographic/audience op is AD-GROUP-scoped, never campaign-scoped", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER, gInput({
    ageRanges: googleAgeRangesForRange(25, 34),
    genders: ["FEMALE"],
    userInterestIds: ["80546"],
  }));
  const crit = demoAudienceCriteria(ops);
  assert(crit.length > 0);
  for (const c of crit) {
    assert(typeof c.adGroup === "string" && (c.adGroup as string).includes("/adGroups/"),
      "criterion must reference the ad group resource");
    assert(!("campaign" in c), "a demographic/audience criterion must NOT be campaign-scoped");
  }
});

// ── C. Full-range ⇒ ZERO demographic ops, by whole-array deep-equal ────────────
Deno.test("adv C: full age range + all gender ⇒ ops array is byte-identical to the no-demographic build", () => {
  const full = buildGoogleMutateOperations(CUSTOMER, gInput({
    ageRanges: googleAgeRangesForRange(18, 65), // all six bands
    genders: [], // all
  }));
  const bare = buildGoogleMutateOperations(CUSTOMER, gInput()); // no demographic input at all
  assertEquals(full, bare); // FAILS-ON-REVERT: the `continue` skip keeps these identical
  assertEquals(demoAudienceCriteria(full).length, 0);
});

// ── D. userInterest positive-criteria shape + junk drop ────────────────────────
Deno.test("adv D: audiences → POSITIVE userInterests/{id} criteria; blank/whitespace ids dropped", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER, gInput({
    userInterestIds: ["80546", "", "   ", "92011"],
  }));
  const aud = demoAudienceCriteria(ops).filter((c) => "userInterest" in c);
  assertEquals(aud.length, 2); // the two blanks are dropped
  assertEquals(
    aud.map((c) => (c.userInterest as Record<string, unknown>).userInterestCategory).sort(),
    ["userInterests/80546", "userInterests/92011"],
  );
  for (const c of aud) assertEquals(c.negative, undefined); // audiences are inclusions, not exclusions
});

// ── E. buildSnapchatCircleGeos — null/junk drop + unit-token coercion ──────────
Deno.test("adv E: buildSnapchatCircleGeos returns null on empty / all-junk (never fabricates)", () => {
  assertEquals(buildSnapchatCircleGeos(null), null);
  assertEquals(buildSnapchatCircleGeos(undefined), null);
  assertEquals(buildSnapchatCircleGeos([]), null);
  const allJunk: SnapchatCircleGeo[] = [
    { country_code: "FR", latitude: NaN, longitude: 2.3, radius: 5, unit: "mile" },
    { country_code: "US", latitude: 40.7, longitude: -74, radius: 0, unit: "mile" }, // radius 0 dropped
    { country_code: "", latitude: 1, longitude: 1, radius: 5, unit: "mile" }, // empty cc dropped
  ];
  assertEquals(buildSnapchatCircleGeos(allJunk), null);
});

Deno.test("adv E: unit token — mile/kilometer preserved; an unrecognised token defaults to 'mile'", () => {
  // The wire token emitted is EXACTLY what SNAPCHAT_CIRCLE_UNITS declares
  // ("mile"|"kilometer") — NOT "mi"/"km". A "mi"/"km" (the documented-shape
  // contradiction) is coerced to "mile"; the create fn's 422 gate keeps such a
  // token from ever reaching here, but this documents the builder's own default.
  const km = buildSnapchatCircleGeos([
    { country_code: "GB", latitude: 51.5, longitude: -0.1, radius: 20, unit: "kilometer" },
  ])!;
  assertEquals((km[0].circles as Record<string, unknown>[])[0].unit, "kilometer");
  const coerced = buildSnapchatCircleGeos([
    { country_code: "GB", latitude: 51.5, longitude: -0.1, radius: 20, unit: "mi" },
  ])!;
  assertEquals((coerced[0].circles as Record<string, unknown>[])[0].unit, "mile"); // "mi" → "mile"
});

Deno.test("adv E: case-folds country + groups mixed valid/junk under one geo", () => {
  const geos = buildSnapchatCircleGeos([
    { country_code: "GB", latitude: 51.5, longitude: -0.12, radius: 10, unit: "mile" },
    { country_code: "gb", latitude: 53.4, longitude: -2.24, radius: 5, unit: "kilometer" },
    { country_code: "FR", latitude: NaN, longitude: 2.3, radius: 5, unit: "mile" }, // dropped
  ])!;
  assertEquals(geos.length, 1); // both GB circles folded to one "gb" geo; junk FR dropped
  assertEquals(geos[0].country_code, "gb");
  assertEquals((geos[0].circles as unknown[]).length, 2);
});

// ── F. buildSnapchatAdSquadBody — circles REPLACE the country-only geos ────────
function snapSpec(over: Partial<SnapchatAdSquadSpec> = {}): SnapchatAdSquadSpec {
  return { name: "adv — ad squad", optimizationGoal: "SWIPES", countries: ["GB"], ...over };
}

Deno.test("adv F: a circle REPLACES all country-only geos — the non-circle country is DROPPED", () => {
  // Countries GB + US, but only GB geocoded a circle. The union (GB-circle ∪ US-
  // country) would make the circle inert, so the builder emits ONLY the circle
  // geo. US country-only targeting is dropped entirely (documented laser rule).
  const body = buildSnapchatAdSquadBody("camp-id", snapSpec({
    countries: ["GB", "US"],
    circles: [{ country_code: "GB", latitude: 51.5, longitude: -0.12, radius: 12, unit: "mile" }],
  }));
  const targeting = body.targeting as Record<string, unknown>;
  const geos = targeting.geos as Record<string, unknown>[];
  assertEquals(geos.length, 1);
  assertEquals(geos[0].country_code, "gb");
  assert("circles" in geos[0], "the sole geo must be the circle geo");
  // The US country-only geo must be ABSENT (not unioned in).
  assert(!geos.some((g) => g.country_code === "us"), "non-circle country must be dropped");
});

Deno.test("adv F: no circles ⇒ country-only geos kept; interests key omitted when empty", () => {
  const body = buildSnapchatAdSquadBody("camp-id", snapSpec({ countries: ["GB", "US"] }));
  const targeting = body.targeting as Record<string, unknown>;
  assertEquals(targeting.geos, [{ country_code: "gb" }, { country_code: "us" }]);
  assertEquals(targeting.interests, undefined);
  // With interests present the SCLS shape is targeting.interests:[{category_id:[…]}].
  const withInt = buildSnapchatAdSquadBody("camp-id", snapSpec({ interestCategoryIds: ["1417", " 1502 "] }));
  assertEquals((withInt.targeting as Record<string, unknown>).interests, [{ category_id: ["1417", "1502"] }]);
});

// ── G. parse tolerance + filter ordering ───────────────────────────────────────
Deno.test("adv G: parseSnapchatInterests tolerates category_id key; filter is prefix-first", () => {
  const rows = [
    { scls: { category_id: "1417", name: "Nightlife & Bars" } }, // category_id (not id)
    { scls: { id: "1502", name: "Music Festivals" } },
    { scls: { id: "1600", name: "Alternative Music" } },
  ];
  const parsed = parseSnapchatInterests(rows);
  assertEquals(parsed.length, 3);
  assertEquals(parsed[0].id, "1417");
  // "music" matches both 1502 (prefix "Music…") and 1600 (substring "…Music"); prefix first.
  const m = filterSnapchatInterests(parsed, { q: "music" });
  assertEquals(m.map((i) => i.id), ["1502", "1600"]);
});

Deno.test("adv G: parseGoogleUserInterests tolerates snake_case + drops idless/dup rows", () => {
  const payload = {
    results: [
      { user_interest: { user_interest_id: "80546", name: "Live Music Fans", taxonomy_type: "AFFINITY" } },
      { userInterest: { userInterestId: "92011", name: "Event Ticket Buyers", taxonomyType: "IN_MARKET" } },
      { userInterest: { name: "no id" } }, // dropped
      { userInterest: { userInterestId: "80546", name: "dup" } }, // dropped
    ],
  };
  const parsed = parseGoogleUserInterests(payload);
  assertEquals(parsed.length, 2);
  assertEquals(parsed[0].id, "80546");
  assertEquals(parsed[0].taxonomyType, "AFFINITY");
  assertEquals(filterGoogleUserInterests(parsed, { q: "event" }).map((i) => i.id), ["92011"]);
});

// ── H. #1184 adapter threading + video guard + geocode null-drop (source) ──────
Deno.test("adv H: #1184 four-anchor Snap threading is intact (targeting input → adapter → spec)", async () => {
  const snap = await Deno.readTextFile(new URL("../../_shared/snapchat.ts", import.meta.url));
  // 1. SnapchatAdSquadTargetingInput carries circles + interests.
  assert(/SnapchatAdSquadTargetingInput[\s\S]*?circles\?:/.test(snap), "targeting input type has circles");
  assert(/SnapchatAdSquadTargetingInput[\s\S]*?interests\?:/.test(snap), "targeting input type has interests");
  // 2. the adapter createAdSet maps t.circles → spec.circles and t.interests → interestCategoryIds.
  assert(snap.includes("circles: t.circles"), "adapter passes circles through");
  assert(snap.includes("interestCategoryIds: t.interests"), "adapter passes SCLS interests through");
  // 3. SnapchatAdSquadSpec carries circles + interestCategoryIds (the wire end).
  assert(/interestCategoryIds\?: string\[\]/.test(snap), "spec carries interestCategoryIds");
});

Deno.test("adv H: create fn preserves the #1184 video 422 guard + geocode NULL-DROP (never fabricates)", async () => {
  const src = await Deno.readTextFile(new URL("../../admin-ad-create-campaign/index.ts", import.meta.url));
  // The Google video-create branch must NOT be disturbed by #992.
  // [TEST-MOD-APPROVED ORCH-1185] The stale "422 error preserved" assertion is
  // obsolete: #997 D2 wired Google video create and #1185 wired Reddit — so NO
  // video_create_not_available_phase_a 422 remains anywhere. The invariant #992
  // must preserve is that the Google video branch still exists and routes to a real
  // Demand Gen create (never a fabricated "Created"), which is what this now asserts.
  assert(src.includes('if (creativeG.kind === "video")'), "Google video branch present");
  assert(
    src.includes("googleCreateDemandGenVideoCampaign"),
    "Google video routes to a real Demand Gen create (never fabricated)",
  );
  // The Snap circle geocode drops the circle on a null geocode — never fabricates.
  assert(/if \(!coords\) continue;/.test(src), "null geocode must drop the circle (Constitution #3)");
  assert(src.includes("forwardGeocodeText"), "circles geocoded server-side");
});

Deno.test("adv H: targeting-search Snap CITY passthrough never geocodes (no coords to the browser)", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(src.includes("async function resolveSnapchat"), "resolveSnapchat must exist");
  // The Snap city branch is a passthrough echo of the typed name.
  assert(src.includes("circle_passthrough"), "city branch echoes a passthrough chip");
  // The ENTIRE search fn never CALLS the geocoder — coordinates are resolved
  // only server-side at CREATE, so none can reach the browser via search.
  // (The Snap comment documents "no Mapbox call here"; the invariant we assert
  // is the absence of the geocode call + of any lat/lng field on the wire.)
  assert(!src.includes("forwardGeocodeText"), "the search fn must never call the geocoder");
  assert(!/\blat(itude)?\b\s*[:=]|\blng\b\s*[:=]|\blongitude\b\s*[:=]/i.test(src),
    "no latitude/longitude field is ever assigned in the search fn");
  // the old deferred stubs are gone.
  assert(!src.includes("aren't wired yet"), "Google-audience stub removed");
  assert(!src.includes("interest segments are coming"), "Snap 'coming' stub removed");
});
