// ORCH-1365 [location-search-relevance] — TESTER adversarial regression suite.
// DIFFERENT ANGLE from the implementor's T-1..T-9 (which test happy-path strip,
// place-builder shape, business byte-identical, and the DIRECT isolation of
// handleSuggest→buildPlaceSuggestUrl). This suite attacks two angles the
// implementor's tests do NOT cover:
//
//   ANGLE A — COUNTRY/STATE-NAME COLLISION MATRIX. The trailing-country strip is
//   a blunt English country-name map. It (a) OVER-STRIPS a US state whose name is
//   also a country ("atlanta georgia" → country=ge, which live-Mapbox returns
//   EMPTY — see evidence/ORCH-1365/tester_e2e_edge_handler_live_mapbox.txt), and
//   it (b) MUST NOT silently begin stripping non-country trailing words. This
//   suite LOCKS the documented over-strip so it stays VISIBLE + regression-tracked
//   (a future ambiguous-name exclusion set must consciously update these rows),
//   and GUARDS the non-country trailing words + casing/diacritics/whitespace edges
//   that T-3/T-4 do not enumerate.
//
//   ANGLE B — THE INDIRECT ISOLATION THE STATIC GATE MISSES. The scoped ORCH-1079
//   gate + T-5 both prove handleSuggest's BODY never calls buildPlaceSuggestUrl.
//   NEITHER proves the handler SWITCH still routes action "suggest" to
//   handleSuggest. A one-line reroute of `case "suggest": return
//   handleSuggestPlaces(...)` would silently push the BUSINESS venue-name action
//   through the place-type-FILTERED handler (POIs dropped → venue-name search
//   regressed, ORCH-1079 INV-3 broken) while leaving handleSuggest + its body
//   untouched — invisible to the gate and to T-5's body-scoped isolation. This
//   suite asserts the switch routing itself.
//
// FAILS-ON-REVERT anchors (verified by the tester — see the QA report Step 5):
//   - ANGLE A: revert/remove the parseTrailingCountry strip → the "atlanta
//     georgia"/"lekki chad"/mixed-case/multi-space STRIP rows FAIL.
//   - ANGLE B: reroute `case "suggest"` → handleSuggestPlaces (the exact indirect
//     regression the gate + T-5 both miss) → the switch-routing rows FAIL, while
//     the gate + T-5 stay GREEN. This is the unique guard this suite adds.
//
// Append-only, new file. Registered in the orch-1365 Deno CI job. No gate logic
// modified (no [TEST-MOD-APPROVED] token needed).
//
// Run: deno test --allow-read --no-check \
//   supabase/functions/mapbox-geocode/__tests__/orch1365-collision-and-switch-isolation.adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { parseTrailingCountry } from "../countryNames.ts";

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE A.1 — DOCUMENTED OVER-STRIP (state name == country name). LOCKED so the
// known limitation is visible; live Mapbox returns EMPTY for these (a real US
// query degraded), so a follow-on exclusion set MUST update these rows on fix.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV-A1: 'atlanta georgia' OVER-STRIPS to country=ge (documented limitation — locked)", () => {
  assertEquals(parseTrailingCountry("atlanta georgia"), {
    query: "atlanta",
    country: "ge",
  });
});

Deno.test("ADV-A1: 'savannah georgia' OVER-STRIPS to country=ge (same US-state collision)", () => {
  assertEquals(parseTrailingCountry("savannah georgia"), {
    query: "savannah",
    country: "ge",
  });
});

Deno.test("ADV-A1: a genuine city+country still strips ('lekki chad' → td)", () => {
  assertEquals(parseTrailingCountry("lekki chad"), {
    query: "lekki",
    country: "td",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE A.2 — BARE collision tokens (single token) are NEVER stripped, so a user
// who types just the ambiguous word searches it as text (safe).
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV-A2: bare 'georgia' (state OR country) NOT stripped — single token", () => {
  assertEquals(parseTrailingCountry("georgia"), { query: "georgia" });
  assert(!("country" in parseTrailingCountry("georgia")));
});

Deno.test("ADV-A2: bare 'jordan' (given-name OR country) NOT stripped — single token", () => {
  assertEquals(parseTrailingCountry("jordan"), { query: "jordan" });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE A.3 — GUARD: non-country trailing words must NEVER start stripping. If a
// future map edit accidentally adds one of these, these rows go RED.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV-A3: 'lekki heights' NOT stripped ('heights' is not a country)", () => {
  assertEquals(parseTrailingCountry("lekki heights"), { query: "lekki heights" });
});

Deno.test("ADV-A3: 'victoria island' NOT stripped ('island' singular is not a country)", () => {
  // NB: 'marshall islands'/'solomon islands' (plural) ARE countries; singular is not.
  assertEquals(parseTrailingCountry("victoria island"), {
    query: "victoria island",
  });
});

Deno.test("ADV-A3: 'lekki phase 1' NOT stripped (trailing numeric, non-country)", () => {
  assertEquals(parseTrailingCountry("lekki phase 1"), { query: "lekki phase 1" });
});

Deno.test("ADV-A3: 'lekki london' NOT stripped (trailing CITY, cross-check of probe L)", () => {
  const r = parseTrailingCountry("lekki london");
  assertEquals(r, { query: "lekki london" });
  assert(!("country" in r));
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE A.4 — casing / whitespace / diacritics in the country map.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV-A4: mixed-case tail matches; leading text case is PRESERVED verbatim", () => {
  assertEquals(parseTrailingCountry("BROOKLYN nIgErIa"), {
    query: "BROOKLYN",
    country: "ng",
  });
});

Deno.test("ADV-A4: multiple spaces between tokens still strip ('lekki   nigeria' → ng)", () => {
  assertEquals(parseTrailingCountry("lekki   nigeria"), {
    query: "lekki",
    country: "ng",
  });
});

Deno.test("ADV-A4: DIACRITIC country name NOT matched — documents English-only v1 (no accent-fold)", () => {
  // "côte d'ivoire" (with the circumflex) != map key "cote d'ivoire" → not stripped.
  // If a future change adds diacritic normalization it MUST update this row.
  const r = parseTrailingCountry("abidjan côte d'ivoire");
  assert(!("country" in r), "accented country name is not accent-folded in v1");
});

Deno.test("ADV-A4: strip NEVER yields an empty query (the load-bearing safety invariant)", () => {
  // The one guarantee that must hold for EVERY input: a strip can never leave an
  // empty query (the ≥1-leading-token guard). Covers bare countries, over-strips,
  // and collision cases alike.
  for (
    const q of [
      "nigeria",
      "south africa",
      "united arab emirates",
      "united states of america",
      "great britain",
      "dr congo",
      "atlanta georgia",
      "lekki nigeria",
    ]
  ) {
    const r = parseTrailingCountry(q);
    assert(r.query.length > 0, `'${q}' must keep a non-empty query`);
  }
});

Deno.test("ADV-A4: simple bare country names are NOT stripped (kept as searchable text)", () => {
  // A trailing alias-key that is NOT a suffix of the bare name → no strip.
  for (const q of ["nigeria", "south africa", "united states", "united kingdom"]) {
    const r = parseTrailingCountry(q);
    assertEquals(r, { query: q });
  }
});

Deno.test("ADV-A4: bare MULTI-WORD country whose suffix is an alias-key OVER-STRIPS (documented quirk — locked)", () => {
  // Same collision class as 'atlanta georgia': the map holds short alias keys
  // ('emirates','america','britain','congo') that are SUFFIXES of longer bare
  // country names, so the bare name loses its suffix. Result stays country-biased
  // (low severity), but LOCK it so a future ambiguous-name fix updates it knowingly.
  assertEquals(parseTrailingCountry("united arab emirates"), {
    query: "united arab",
    country: "ae",
  });
  assertEquals(parseTrailingCountry("great britain"), {
    query: "great",
    country: "gb",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE B — SWITCH-LEVEL ISOLATION. The gate + T-5 only inspect handleSuggest's
// BODY; they cannot see a reroute in the handler switch. Assert the switch itself
// routes each action to the correct handler. `handleSuggest(` (open paren) is a
// distinct token from `handleSuggestPlaces(` — "handleSuggestPlaces" has "Places"
// before the paren — so the two are unambiguous.
// ─────────────────────────────────────────────────────────────────────────────
function stripComments(src: string): string {
  return src
    .replace(/([^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

async function readIndex(): Promise<string> {
  return stripComments(
    await Deno.readTextFile(new URL("../index.ts", import.meta.url).pathname),
  );
}

/** Slice the switch region for a given `case "<action>":` up to the next `case `
 *  / `default:` label. Returns "" when the case is absent. */
function caseRegion(src: string, action: string): string {
  const start = src.indexOf(`case "${action}":`);
  if (start === -1) return "";
  const rest = src.slice(start + `case "${action}":`.length);
  const nextCase = rest.search(/\bcase\s+"|default\s*:/);
  return nextCase === -1 ? rest : rest.slice(0, nextCase);
}

Deno.test("ADV-B: the handler switch routes action 'suggest' → handleSuggest (NOT the filtered places handler)", async () => {
  const src = await readIndex();
  const region = caseRegion(src, "suggest");
  assert(region.length > 0, "the `case \"suggest\":` arm must exist");
  assert(
    region.includes("handleSuggest("),
    "business action 'suggest' must dispatch to handleSuggest (filter-free, POIs resolve)",
  );
  assert(
    !region.includes("handleSuggestPlaces("),
    "business action 'suggest' must NOT be rerouted through the place-FILTERED handler (ORCH-1079 INV-3 / the switch-level regression the static gate + T-5 both miss)",
  );
});

Deno.test("ADV-B: the handler switch routes action 'suggest_places' → handleSuggestPlaces", async () => {
  const src = await readIndex();
  const region = caseRegion(src, "suggest_places");
  assert(region.length > 0, "the `case \"suggest_places\":` arm must exist");
  assert(
    region.includes("handleSuggestPlaces("),
    "consumer action 'suggest_places' must dispatch to the place-search handler",
  );
});

Deno.test("ADV-B: exactly ONE switch arm dispatches to handleSuggestPlaces (no leak into other actions)", async () => {
  const src = await readIndex();
  for (const action of ["suggest", "retrieve", "reverse", "forward"]) {
    const region = caseRegion(src, action);
    assert(
      !region.includes("handleSuggestPlaces("),
      `action '${action}' must not dispatch to the place-filtered handler`,
    );
  }
});
