/**
 * ORCH-1079 [Business-venue Google→Mapbox sweep] — brand creation swap (T-2A/T-2B/T-2D).
 *
 * Node-env Jest harness (no RN renderer) → source-characterizes the locked swap:
 * Step 2 address uses the shared MapboxAddressInput; on pick the geo is written
 * identically BUT googlePlaceId is forced to null (the mapbox_id `p.placeId` is
 * IGNORED) so a mapbox_id never lands in brands.google_place_id; and the Google
 * path is fully removed.
 *
 * Step 0.5: passes on the fix; MUST FAIL on revert (reintroducing
 * `googlePlaceId: p.googlePlaceId` / parseGooglePlaceResult / the Google input).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const src = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/brand/BrandCreationFlow.tsx"),
    "utf8",
  );

describe("ORCH-1079 — BrandCreationFlow uses the shared Mapbox picker", () => {
  test("T-2D: imports MapboxAddressInput + parseVenuePlaceResult, drops the Google path", () => {
    const s = src();
    expect(s).toMatch(
      /import\s*\{[^}]*\bMapboxAddressInput\b[^}]*\}\s*from\s*["'][^"']*location\/MapboxAddressInput["']/,
    );
    expect(s).toContain("parseVenuePlaceResult");
    expect(s).not.toContain("AddressAutocompleteInput");
    expect(s).not.toContain("googlePlacesService");
    expect(s).not.toContain("parseGooglePlaceResult");
  });

  test("T-2A: renders MapboxAddressInput for the step-2 address field", () => {
    expect(src()).toContain("<MapboxAddressInput");
  });

  test("T-2B: onPick sets googlePlaceId: null (never the mapbox_id p.placeId)", () => {
    const s = src();
    // The onPick body maps geo from parseVenuePlaceResult then nulls the id.
    const onPick = s.match(/onPick=\{[\s\S]*?parseVenuePlaceResult[\s\S]*?\}\}/);
    expect(onPick).not.toBeNull();
    const body = onPick?.[0] ?? "";
    expect(body).toContain("googlePlaceId: null");
    expect(body).not.toContain("googlePlaceId: p.placeId");
    expect(body).not.toContain("googlePlaceId: p.googlePlaceId");
    // geo still written from the parsed Mapbox details
    expect(body).toContain("lat: p.lat");
    expect(body).toContain("city: p.city");
    expect(body).toContain("countryCode: p.countryCode");
  });

  test("T-2C: persistAddress still gates googlePlaceId write on non-null (omit when null)", () => {
    // The pre-existing guard means a null googlePlaceId is simply not patched.
    expect(src()).toContain("if (geo.googlePlaceId !== null) patch.googlePlaceId = geo.googlePlaceId;");
  });
});
