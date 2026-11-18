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
    // [TEST-MOD-APPROVED #4420] — the same 24 gutter, written any of the ways
    // the wizards use while they move to the Graphite `space` scale.
    const gutter = /paddingHorizontal: (?:(?:spacing\.md|space\[4\]) \+ 8|space\[6\])/;
    expect(styleBlock(tripWizard, "body")).toMatch(gutter);
    expect(styleBlock(eventWizard, "body")).toMatch(gutter);
  });

  // [TEST-MOD-APPROVED #4420] native run: the step title row sat on 16 while
  // the fields sat on 24, so "Basics" hung left of its own form.
  it("puts the phone step title row on the same 24 gutter as the body", () => {
    expect(styleBlock(tripWizard, "subtitleRow")).toContain("paddingHorizontal: space[6]");
  });

  it("does not add a nested horizontal gutter inside trip Step 1", () => {
    const host = styleBlock(tripStep1, "host");
    // [TEST-MOD-APPROVED #4420] the same values as space[4] / space[2].
    expect(host).toContain("gap: space[4]");
    expect(host).toContain("paddingTop: space[2]");
    expect(host).not.toContain("paddingHorizontal");
  });
});
