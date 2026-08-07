// Issue #1704 — a seeded place's country comes from its seeded city, never from
// prose. Implementor happy-path suite.
//
// These import the REAL `seedCountryFields` from `countryLogic.ts`. There is no
// re-implementation here and no mock of the function under test: a suite that
// asserts against its own copy of the logic passes on a reverted tree, which is
// the defect class this repo has been finding all week.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { seedCountryFields } from "../countryLogic.ts";

Deno.test("#1704 — a live seeding_cities row yields its prose AND its ISO code", () => {
  // The eight real rows, verbatim from production on 2026-08-07.
  const cities = [
    { name: "Durham", country: "United States", country_code: "US" },
    { name: "London", country: "United Kingdom", country_code: "GB" },
    { name: "Lagos", country: "Nigeria", country_code: "NG" },
    { name: "Toronto", country: "Canada", country_code: "CA" },
    { name: "Paris", country: "France", country_code: "FR" },
    { name: "Berlin", country: "Germany", country_code: "DE" },
    { name: "Brussels", country: "Belgium", country_code: "BE" },
    { name: "Barcelona", country: "Spain", country_code: "ES" },
  ];

  for (const c of cities) {
    const got = seedCountryFields(c);
    assertEquals(got.country, c.country, `prose for ${c.name}`);
    assertEquals(got.countryCode, c.country_code, `code for ${c.name}`);
  }
});

Deno.test("#1704 — the prose is the city's spelling, not an abbreviation", () => {
  // The whole defect in one assertion. `parseCountry` turned Durham's places
  // into 'USA' and London's into 'UK' by reading the tail of the formatted
  // address. The city says 'United States' and 'United Kingdom', and that is
  // what a place must now carry.
  assertEquals(
    seedCountryFields({ country: "United States", country_code: "US" }).country,
    "United States",
  );
  assertEquals(
    seedCountryFields({ country: "United Kingdom", country_code: "GB" }).country,
    "United Kingdom",
  );
});

Deno.test("#1704 — a city with no usable code yields null, never a guess", () => {
  // Null is safe: `place_pool_fill_country_code_trg` derives the code from
  // `city_id` on write. A guess would defeat both the trigger and the CHECK.
  for (const bad of [undefined, null, "", "   ", "USA", "usa", "U", "GBR", "G1", "us"]) {
    const got = seedCountryFields({ country: "Somewhere", country_code: bad as string });
    assertEquals(got.countryCode, null, `code ${JSON.stringify(bad)} must not be accepted`);
  }
});

Deno.test("#1704 — a missing city row does not throw and does not invent a country", () => {
  for (const row of [null, undefined, {}]) {
    const got = seedCountryFields(row as never);
    assertEquals(got.country, "Unknown");
    assertEquals(got.countryCode, null);
  }
});

Deno.test("#1704 — surrounding whitespace is trimmed, not treated as absence", () => {
  const got = seedCountryFields({ country: "  Nigeria  ", country_code: " NG " });
  assertEquals(got.country, "Nigeria");
  assertEquals(got.countryCode, "NG");
});
