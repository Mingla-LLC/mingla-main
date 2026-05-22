/**
 * Trip creator width parity regression.
 *
 * Pins the mobile create-trip form to the create-event wizard width rhythm:
 * the wizard body owns horizontal padding once, and TripCreatorStep1Basics
 * must not add a second nested side gutter that squeezes inputs/cards.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

function styleBlock(source: string, styleName: string): string {
  return source.match(new RegExp(`${styleName}: \\{[^}]*\\}`))?.[0] ?? "";
}

describe("Trip creator width parity with event creator", () => {
  const tripWizard = read("components/trip/TripCreatorWizard.tsx");
  const eventWizard = read("components/event/EventCreatorWizard.tsx");
  const tripStep1 = read("components/trip/TripCreatorStep1Basics.tsx");

  it("keeps both wizard ScrollView bodies on the same horizontal gutter", () => {
    expect(styleBlock(tripWizard, "body")).toContain(
      "paddingHorizontal: spacing.md + 8",
    );
    expect(styleBlock(eventWizard, "body")).toContain(
      "paddingHorizontal: spacing.md + 8",
    );
  });

  it("does not add a nested horizontal gutter inside trip Step 1", () => {
    const host = styleBlock(tripStep1, "host");
    expect(host).toContain("gap: spacing.md");
    expect(host).toContain("paddingTop: spacing.sm");
    expect(host).not.toContain("paddingHorizontal");
  });
});
