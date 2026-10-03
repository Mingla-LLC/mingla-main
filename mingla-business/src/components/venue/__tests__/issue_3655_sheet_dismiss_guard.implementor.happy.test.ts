/**
 * #3655 / #1548 — Sheet dismissGuard + CompetitorAddSheet wiring.
 */

import * as fs from "node:fs";
import * as path from "node:path";

describe("#3655 SheetMobile dismissGuard", () => {
  test("CompetitorAddSheet uses dismissGuard + onRequestClose", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "insights", "CompetitorAddSheet.tsx"),
      "utf8",
    );
    expect(src).toContain("dismissGuard={() => dirty}");
    expect(src).toContain("onRequestClose={requestClose}");
    expect(src).toContain("Discard this competitor?");
    expect(src).toContain("Discard your changes?");
  });

  test("blackout remove asks first with destructiveOutline", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "VenueBlackoutSheet.tsx"),
      "utf8",
    );
    expect(src).toContain('variant="destructiveOutline"');
    expect(src).toContain("Remove this blackout?");
    expect(src).toContain("venue-blackout-delete-confirm");
  });

  test("tables Active/Inactive confirm announces and surfaces onError", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "VenueTablesModule.tsx"),
      "utf8",
    );
    expect(src).toContain("venue-tables-active-confirm");
    expect(src).toContain("announceForAccessibility");
    expect(src).toContain("venue-tables-mutation-error");
  });
});
