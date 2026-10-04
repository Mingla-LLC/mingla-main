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

  test("blackout remove asks first with destructiveOutline nested in Sheet", () => {
    // [TEST-MOD-APPROVED #3655] confirm nests inside VenueBlackoutSheet (#1369)
    // so iOS New-Arch can present it; AvailabilityModule no longer hosts it.
    const sheetSrc = fs.readFileSync(
      path.join(__dirname, "..", "VenueBlackoutSheet.tsx"),
      "utf8",
    );
    const availSrc = fs.readFileSync(
      path.join(__dirname, "..", "VenueAvailabilityModule.tsx"),
      "utf8",
    );
    expect(sheetSrc).toContain('variant="destructiveOutline"');
    expect(sheetSrc).toContain("Remove this blackout?");
    expect(sheetSrc).toContain("venue-blackout-delete-confirm");
    expect(sheetSrc.indexOf("<Sheet")).toBeGreaterThanOrEqual(0);
    expect(sheetSrc.indexOf("venue-blackout-delete-confirm")).toBeGreaterThan(
      sheetSrc.indexOf("<Sheet"),
    );
    expect(sheetSrc.indexOf("venue-blackout-delete-confirm")).toBeLessThan(
      sheetSrc.lastIndexOf("</Sheet>"),
    );
    expect(availSrc).not.toContain("venue-blackout-delete-confirm");
    expect(availSrc).not.toContain("blackoutDeleteConfirmOpen");
  });

  test("MenuItemSheet dismissGuard holds dirty dish fields", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "MenuItemSheet.tsx"),
      "utf8",
    );
    expect(src).toContain("dismissGuard={() => itemDirty && !optionsSaving}");
    expect(src).toContain("onRequestClose={handleClose}");
    expect(src).toContain('testID="menu-item-leave-dialog"');
    expect(src).toContain('variant="leave"');
    // #3563 pin — options hold still disables pan.
    expect(src).toContain("dismissDisabled={optionsSaving}");
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
