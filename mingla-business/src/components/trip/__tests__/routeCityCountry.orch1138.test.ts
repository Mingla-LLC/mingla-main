// ORCH-1138 [trip-page-redesign] — regression test for the shared "City, Country"
// route-leg normalizer + the single-line layout contract on BOTH trip surfaces.
//
// Seth device feedback: the "Leaving from / Destination" addresses on the trip
// page were too long + ragged. They must ALWAYS render as "City, Country" only,
// on ONE aligned row (no wrapping). This test pins:
//   1. normalizeCityCountry produces "City, Country" for the spec example inputs.
//   2. BOTH the business/web TripPreview AND the consumer ConsumerTripDetailScreen
//      apply numberOfLines={1}+ellipsis on the routePlace so a long city
//      truncates rather than wraps the row (the same-line guarantee).
//
// Imported by relative path — normalizeCityCountry.ts is a pure util with no app
// src imports (I-MOR-0827-PACKAGE-ISOLATION), so it resolves under the default
// mingla-business ts-jest config without a moduleNameMapper (matching the
// precedent in createThemePalette.parity.orch1138.test.ts).
//
// fails-on-revert: delete the normalizer's USA-collapse / airport-strip logic, or
// delete the numberOfLines={1} props from either render block, and the matching
// assertion below fails.

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import { normalizeCityCountry } from "../../../../../packages/offering-rendering/normalizeCityCountry";

describe("ORCH-1138 normalizeCityCountry — standardize to 'City, Country'", () => {
  test("US free text with state + full country → 'Raleigh, USA'", () => {
    expect(normalizeCityCountry("Raleigh, North Carolina, United States")).toBe(
      "Raleigh, USA",
    );
  });

  test("US free text with USPS state abbr → 'Raleigh, USA'", () => {
    expect(normalizeCityCountry("Raleigh, NC, USA")).toBe("Raleigh, USA");
    expect(normalizeCityCountry("Raleigh, NC")).toBe("Raleigh, USA");
  });

  test("Washington DC variants → 'Washington DC, USA'", () => {
    expect(
      normalizeCityCountry("Washington DC, District of Columbia, United States"),
    ).toBe("Washington DC, USA");
    expect(normalizeCityCountry("Washington DC, United States of America")).toBe(
      "Washington DC, USA",
    );
  });

  test("Italian city free text → 'Positano, Italy'", () => {
    expect(normalizeCityCountry("Positano, Province of Salerno, Italy")).toBe(
      "Positano, Italy",
    );
    expect(normalizeCityCountry("Positano, Italy")).toBe("Positano, Italy");
  });

  test("airport code + Intl noise via structured fields → 'Naples, Italy'", () => {
    expect(
      normalizeCityCountry("Naples Intl (NAP)", { city: "Naples", country: "Italy" }),
    ).toBe("Naples, Italy");
  });

  test("airport noise stripped from free text → 'Naples, Italy'", () => {
    expect(normalizeCityCountry("Naples Intl (NAP), Italy")).toBe("Naples, Italy");
  });

  test("structured fields are PREFERRED over free text", () => {
    expect(
      normalizeCityCountry("some long messy street address, region, US", {
        city: "Lagos",
        country: "Nigeria",
      }),
    ).toBe("Lagos, Nigeria");
  });

  test("US country aliases all collapse to 'USA'", () => {
    for (const alias of [
      "United States",
      "United States of America",
      "US",
      "U.S.A.",
      "USA",
    ]) {
      expect(normalizeCityCountry(`Austin, ${alias}`)).toBe("Austin, USA");
    }
  });

  test("city-only resolvable value shows the city (no fabricated country)", () => {
    expect(normalizeCityCountry("Positano")).toBe("Positano");
  });

  test("unresolvable / empty value → null (rule 9, leg is hidden)", () => {
    expect(normalizeCityCountry(null)).toBeNull();
    expect(normalizeCityCountry(undefined)).toBeNull();
    expect(normalizeCityCountry("   ")).toBeNull();
  });

  test("leading street line is skipped — city + country remain", () => {
    expect(
      normalizeCityCountry("123 Glenwood Ave, Raleigh, North Carolina, United States"),
    ).toBe("Raleigh, USA");
  });
});

// ---------------------------------------------------------------------------
// Single-line layout contract — both surfaces must carry numberOfLines={1} +
// ellipsizeMode on the routePlace Text so a long City,Country truncates instead
// of wrapping the aligned row (Fix 2). Source-string assertions; fail on revert.
// ---------------------------------------------------------------------------

const TRIP_PREVIEW = path.resolve(__dirname, "../TripPreview.tsx");
const CONSUMER_TRIP = path.resolve(
  __dirname,
  "../../../../../app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
);

describe("ORCH-1138 route block stays on ONE aligned row (no wrap)", () => {
  test("business/web TripPreview routePlace is numberOfLines={1} + ellipsis", () => {
    const src = readFileSync(TRIP_PREVIEW, "utf8");
    // The FOUNDATION-mode route block: count the routePlace Texts that carry
    // numberOfLines={1} (both legs).
    const block = src.slice(src.indexOf("{/* route line"));
    const single = block.match(/numberOfLines=\{1\}/g) ?? [];
    expect(single.length).toBeGreaterThanOrEqual(2);
    expect(block).toContain('ellipsizeMode="tail"');
    // and it consumes the normalized values, not the raw *LocationText.
    expect(block).toContain("departureCityCountry");
    expect(block).toContain("destinationCityCountry");
  });

  test("business/web TripPreview imports + applies the shared normalizer", () => {
    const src = readFileSync(TRIP_PREVIEW, "utf8");
    expect(src).toContain("normalizeCityCountry");
    expect(src).toContain('from "@mingla/offering-rendering"');
  });

  test("consumer ConsumerTripDetailScreen routePlace is numberOfLines={1} + ellipsis", () => {
    const src = readFileSync(CONSUMER_TRIP, "utf8");
    const block = src.slice(src.indexOf("{/* route — leaving from"));
    const single = block.match(/numberOfLines=\{1\}/g) ?? [];
    expect(single.length).toBeGreaterThanOrEqual(2);
    expect(block).toContain('ellipsizeMode="tail"');
  });

  test("consumer foundation adapter applies the shared normalizer to both legs", () => {
    const adapter = path.resolve(
      __dirname,
      "../../../../../app-mobile/src/hooks/useConsumerTripFoundation.ts",
    );
    const src = readFileSync(adapter, "utf8");
    expect(src).toContain("normalizeCityCountry");
    expect(src).toContain("departureCityCountry");
    expect(src).toContain("destinationCityCountry");
  });
});
