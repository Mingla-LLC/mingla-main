/**
 * #4490 spec 07 B — structural UI contract for table deposits. The arithmetic
 * and payload behavior live in venueFloorP5; this pins the four visible choices
 * and the disabled share option so it cannot regress into a hidden or dead tap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const floorDir = join(__dirname, "..", "features", "floor");

describe("table deposit host UI", () => {
  it("lists all four modes and explains why minimum-spend share is disabled", () => {
    const src = readFileSync(join(floorDir, "TableForm.tsx"), "utf8");
    for (const label of [
      "Your usual deposit rule",
      "Per guest",
      "Per table",
      "Share of the minimum spend",
    ]) {
      expect(src).toContain(label);
    }
    expect(src).toContain("disabled: !shareReady");
    expect(src).toContain("Turn on Minimum spend tables and set a minimum spend first.");
    expect(src).toContain("Paid when they book. Take it off their bill at the venue.");
    expect(src).toContain("step={5}");
  });

  it("the shared select makes a disabled row truly non-interactive and accessible", () => {
    const src = readFileSync(join(__dirname, "..", "..", "ui", "SelectSheet.tsx"), "utf8");
    expect(src).toContain("disabled={option.disabled === true}");
    expect(src).toContain("accessibilityState={{ checked: on, disabled: option.disabled === true }}");
    expect(src).toContain("accessibilityHint={option.helper}");
  });
});
