/**
 * Issue #3291 — a looked-up place with no full address must still name itself.
 *
 * THE DEFECT: Mapbox gives streets, cities and venues no `full_address`, and
 * their `place_formatted` is only the SURROUNDING AREA ("Lagos 10, Lagos,
 * Nigeria") — it never repeats the feature's own name. `featureToDetails` in
 * the mapbox-geocode edge function fell back to `place_formatted` alone, so
 * the address it returned had lost the street or city the host picked.
 *
 * The rule lives in a PURE module so this required jest lane executes it; the
 * edge function's wiring to it is pinned from source below (index.ts imports a
 * remote Deno module and cannot load under jest).
 *
 * FAILS-ON-REVERT: restore `props.full_address ?? props.place_formatted ?? city`
 * in featureToDetails and the wiring case goes red; drop the no-doubling guard
 * and the doubling case goes red.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

import { namedAreaAddress } from "../../../supabase/functions/mapbox-geocode/namedAreaAddress";

const ROOT = path.resolve(__dirname, "../../..");
const edgeSource = fs.readFileSync(
  path.resolve(ROOT, "supabase/functions/mapbox-geocode/index.ts"),
  "utf8",
);

/** The body of `featureToDetails`, so a match elsewhere in the file can't pass. */
function featureToDetailsBody(): string {
  const start = edgeSource.indexOf("export function featureToDetails(");
  expect(start).toBeGreaterThan(-1);
  const end = edgeSource.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return edgeSource.slice(start, end);
}

describe("Issue #3291 — the edge no-full-address fallback", () => {
  test("a street with no full address keeps its name", () => {
    expect(namedAreaAddress("Ozumba Mbadiwe Avenue", "Lagos 10, Lagos, Nigeria")).toBe(
      "Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria",
    );
  });

  test("a venue with no full address keeps its name", () => {
    expect(namedAreaAddress("Harmattan Club", "Victoria Island, Lagos, Nigeria")).toBe(
      "Harmattan Club, Victoria Island, Lagos, Nigeria",
    );
  });

  test("no doubling when the area already begins with the name", () => {
    expect(namedAreaAddress("Lagos", "Lagos, Nigeria")).toBe("Lagos, Nigeria");
    expect(namedAreaAddress("lagos ", " Lagos ,Nigeria")).toBe("Lagos ,Nigeria");
  });

  test("an area merely containing the name is not the name", () => {
    expect(namedAreaAddress("London", "Greater London, England, United Kingdom")).toBe(
      "London, Greater London, England, United Kingdom",
    );
  });

  test("missing parts never fabricate text", () => {
    expect(namedAreaAddress(undefined, undefined)).toBeNull();
    expect(namedAreaAddress("  ", "")).toBeNull();
    expect(namedAreaAddress(null, "Lagos, Nigeria")).toBe("Lagos, Nigeria");
    expect(namedAreaAddress("Lagos", undefined)).toBe("Lagos");
  });

  test("featureToDetails uses it, and a full address still wins", () => {
    const body = featureToDetailsBody();
    expect(body).toMatch(
      /formattedAddress:\s*props\.full_address\s*\?\?\s*namedAreaAddress\(props\.name,\s*props\.place_formatted\)\s*\?\?\s*city,/,
    );
    expect(body).not.toMatch(/props\.full_address\s*\?\?\s*props\.place_formatted\s*\?\?\s*city/);
    expect(edgeSource).toContain('import { namedAreaAddress } from "./namedAreaAddress.ts";');
  });
});
