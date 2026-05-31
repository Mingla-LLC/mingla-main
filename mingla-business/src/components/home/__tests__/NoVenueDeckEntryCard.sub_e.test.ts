/**
 * META-ORCH-1009 Sub-E (Job A) — no-venue discoverability entry.
 *
 * Source-contract test (matches the existing Sub-E test pattern — pure
 * fs.readFileSync, no render library, so it runs in this jest setup):
 *  1. The component declares the discoverability copy + the CTA contract.
 *  2. home.tsx imports + renders <NoVenueDeckEntryCard> twice (desktop + mobile),
 *     gates it on the place-pipeline query having resolved to null (no venue),
 *     routes onPress to /venue/create, and never renders it INSIDE the
 *     ORCH-0974 mobile locked pane (the only pane with markers in this file).
 *
 * Fails-on-revert: reverting home.tsx removes the wiring/gate/route assertions
 * and the 2 render sites.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const CARD = join(__dirname, "..", "NoVenueDeckEntryCard.tsx");
const HOME = join(__dirname, "../../../..", "app/(tabs)/home.tsx");

describe("META-ORCH-1009 Sub-E Job A — no-venue deck entry", () => {
  test("component declares the discoverability copy + CTA contract", () => {
    const src = readFileSync(CARD, "utf8");
    expect(src).toContain("Get your venue into the deck");
    expect(src).toContain("no-venue-deck-entry-cta");
    expect(src).toContain("onPress={onPress}");
    expect(src).toContain('label="Add your venue"');
  });

  test("home wires the entry, gates on no-venue pipeline state, routes to /venue/create", () => {
    const src = readFileSync(HOME, "utf8");
    expect(src).toContain("NoVenueDeckEntryCard");
    expect(src).toContain("<NoVenueDeckEntryCard onPress={handleAddVenue} />");
    expect(src).toContain('router.push("/venue/create" as never)');
    expect(src).toContain("pipelineState.isFetched");
    expect(src).toContain("pipelineState.data === null");
    expect(src).toContain("const showNoVenueEntry");
  });

  test("entry renders twice and never inside the ORCH-0974 mobile locked pane", () => {
    const src = readFileSync(HOME, "utf8");
    const mBegin = src.indexOf("lock-pane:begin-mobile-populated");
    const mEnd = src.indexOf("lock-pane:end-mobile-populated");
    expect(mBegin).toBeGreaterThan(-1);
    expect(mEnd).toBeGreaterThan(mBegin);

    let idx = src.indexOf("<NoVenueDeckEntryCard");
    let count = 0;
    while (idx !== -1) {
      count += 1;
      // Must never sit inside the locked mobile pane.
      expect(idx > mBegin && idx < mEnd).toBe(false);
      idx = src.indexOf("<NoVenueDeckEntryCard", idx + 1);
    }
    // Rendered on both the desktop and mobile populated paths.
    expect(count).toBe(2);
  });
});
