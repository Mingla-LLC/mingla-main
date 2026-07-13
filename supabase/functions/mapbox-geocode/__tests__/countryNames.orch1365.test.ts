// ORCH-1365 [location-search-relevance] — trailing-country parser guard
// (implementor-owned happy-path; SPEC §7 T-3/T-4, §8.1). Deno-runnable — the
// parser is pure (no network, no env).
//
// PROTECTIVE COMMENT — the CONSUMER place search strips a recognized TRAILING
// COUNTRY token from the query and re-applies it as a Mapbox `country` ISO bias
// (runtime-proven fix for "lekki nigeria" → Lekki Lagos #1; evidence probe G/N).
// This parser is used ONLY by the `suggest_places` action; the BUSINESS `suggest`
// path never imports it and stays byte-identical + filter-free (INV-3 / ORCH-1079).
//
// SAFETY (OQ-1): strip ONLY a recognized country name/alias, ONLY when ≥1 leading
// token remains — a trailing CITY word ("lekki london") or non-geographic word
// ("lekki phase") and a SINGLE-token query ("lekki") are NEVER stripped.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - delete the trailing-country match/strip in parseTrailingCountry → the
//     "lekki nigeria" → { query:"lekki", country:"ng" } assertions FAIL;
//   - loosen the ≥2-token guard so single/bare-country queries strip → the
//     "lekki"/"nigeria"/"south africa" no-strip assertions FAIL.
//
// Run: deno test --allow-none \
//   supabase/functions/mapbox-geocode/__tests__/countryNames.orch1365.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { COUNTRY_NAME_TO_ISO, parseTrailingCountry } from "../countryNames.ts";

// ── T-3: trailing country stripped → { query, country } ───────────────────────
Deno.test("T-3: 'lekki nigeria' → { query:'lekki', country:'ng' } (the reported bug)", () => {
  assertEquals(parseTrailingCountry("lekki nigeria"), {
    query: "lekki",
    country: "ng",
  });
});

Deno.test("T-3: multi-word country name stripped ('lekki south africa' → za)", () => {
  assertEquals(parseTrailingCountry("lekki south africa"), {
    query: "lekki",
    country: "za",
  });
});

Deno.test("T-3: 3-word official form ('dubai united arab emirates' → ae)", () => {
  assertEquals(parseTrailingCountry("dubai united arab emirates"), {
    query: "dubai",
    country: "ae",
  });
});

Deno.test("T-3: comma separator tolerated ('lekki, nigeria' → ng)", () => {
  assertEquals(parseTrailingCountry("lekki, nigeria"), {
    query: "lekki",
    country: "ng",
  });
});

Deno.test("T-3: aliases + case-insensitivity (UK→gb, USA→us, UAE→ae)", () => {
  assertEquals(parseTrailingCountry("lekki UK"), { query: "lekki", country: "gb" });
  assertEquals(parseTrailingCountry("brooklyn USA"), {
    query: "brooklyn",
    country: "us",
  });
  assertEquals(parseTrailingCountry("marina UAE"), {
    query: "marina",
    country: "ae",
  });
  assertEquals(parseTrailingCountry("amman JORDAN"), {
    query: "amman",
    country: "jo",
  });
});

// ── T-4: safety — a non-country trailing token is NEVER stripped ───────────────
Deno.test("T-4: 'lekki phase' NOT stripped ('phase' is not a country — probe M)", () => {
  assertEquals(parseTrailingCountry("lekki phase"), { query: "lekki phase" });
  assert(!("country" in parseTrailingCountry("lekki phase")));
});

Deno.test("T-4: 'lekki london' NOT stripped ('london' is a CITY, not a country — probe L)", () => {
  assertEquals(parseTrailingCountry("lekki london"), { query: "lekki london" });
});

Deno.test("T-4: single-token query NEVER stripped ('lekki')", () => {
  assertEquals(parseTrailingCountry("lekki"), { query: "lekki" });
});

Deno.test("T-4: bare country name NOT stripped (no leading token to keep — OQ-3 fallback)", () => {
  // single-token country → searched as text (returns the country/region).
  assertEquals(parseTrailingCountry("nigeria"), { query: "nigeria" });
  // 2-word bare country → no leading place token remains → not stripped.
  assertEquals(parseTrailingCountry("south africa"), { query: "south africa" });
});

Deno.test("T-4: longest trailing match wins; leading text preserved verbatim", () => {
  // "new york united states" → us, query "new york" (2-word place kept intact).
  assertEquals(parseTrailingCountry("new york united states"), {
    query: "new york",
    country: "us",
  });
});

Deno.test("T-4: empty / whitespace input is safe", () => {
  assertEquals(parseTrailingCountry("   "), { query: "" });
});

// ── Map integrity ─────────────────────────────────────────────────────────────
Deno.test("map: keys lowercase, values 2-letter lowercase ISO", () => {
  for (const [name, iso] of Object.entries(COUNTRY_NAME_TO_ISO)) {
    assertEquals(name, name.toLowerCase(), `key '${name}' must be lowercase`);
    assert(/^[a-z]{2}$/.test(iso), `value '${iso}' for '${name}' must be alpha-2 lowercase`);
  }
  // spot-checks of the load-bearing entries.
  assertEquals(COUNTRY_NAME_TO_ISO["nigeria"], "ng");
  assertEquals(COUNTRY_NAME_TO_ISO["united kingdom"], "gb");
  assertEquals(COUNTRY_NAME_TO_ISO["united states"], "us");
});
