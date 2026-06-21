/**
 * ORCH-1184 — reservations command-center desktop: bare rail + full-width
 * workspace. Implementor-owned happy-path regression test.
 *
 * Two contract assertions, both on the REAL VenueSuiteShell source + the REAL
 * venueModules registry (no RTL needed → runs under the default node/ts-jest
 * config):
 *
 *  1. The desktop rail no longer renders the grey "Command" / "Booking" section
 *     CAPTIONS — the `railSection` caption element and style are gone — while
 *     all SIX menu items still derive in their existing order (Overview, Tables,
 *     Availability, Reservations, Waitlist, Settings).
 *  2. The `desktopCentered` style no longer applies the 1200px `maxWidth` cap
 *     (the workspace fills the page width) while KEEPING the left anchor
 *     (`alignSelf: "flex-start"`) and the edge gutters (`paddingHorizontal`).
 *
 * FAILS-ON-REVERT: re-adding `<Text style={styles.railSection}>Command</Text>` /
 * `Booking`, or restoring `maxWidth: venueSuiteMaxWidth` in `desktopCentered`,
 * flips the matching assertion → FAIL. Verified by true line-deletion of the
 * fix (NOT a comment-out) per the implementor fails-on-revert contract.
 *
 * Append-only: new file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business && npx jest venueSuiteShell.orch1184.fullwidth
 */

import { readFileSync } from "fs";
import { join } from "path";

import { VENUE_MODULES, deriveVenueModules } from "../venueModules";

const SHELL_SRC = readFileSync(
  join(__dirname, "..", "VenueSuiteShell.tsx"),
  "utf8",
);

/** Isolate the `desktopCentered: { ... }` style block from the source. */
function desktopCenteredBlock(src: string): string {
  const start = src.indexOf("desktopCentered: {");
  expect(start).toBeGreaterThan(-1);
  // Walk to the matching closing brace of the style object.
  let depth = 0;
  let i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(open, i + 1);
}

/** Strip `//` line comments so assertions test CODE, not explanatory prose. */
function stripLineComments(block: string): string {
  return block
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("ORCH-1184 — bare rail + full-width workspace", () => {
  describe("Change 1 — rail section captions removed, six items intact", () => {
    it("the rail renders NO `railSection` caption element", () => {
      // The two caption <Text style={styles.railSection}>…</Text> nodes are gone.
      expect(SHELL_SRC).not.toMatch(/styles\.railSection/);
      // Neither caption is rendered as rail section text.
      expect(SHELL_SRC).not.toMatch(
        /<Text style=\{styles\.railSection\}>Command<\/Text>/,
      );
      expect(SHELL_SRC).not.toMatch(
        /<Text style=\{styles\.railSection\}>Booking<\/Text>/,
      );
    });

    it("the `railSection` style object is removed (dead-style cleanup)", () => {
      expect(SHELL_SRC).not.toMatch(/^\s*railSection:\s*\{/m);
    });

    it("all rail items still derive in the existing order", () => {
      // Toggle ON → the full rail: Overview, booking band, Menu, Settings.
      // ORCH-1186-C [TEST-MOD-APPROVED ORCH-1186-C] added the command-band
      // "Menu" module (between Waitlist and Settings), so the ON rail is now 7
      // items; Settings still stays last. The ORCH-1184 full-width layout +
      // bare-rail intent is unchanged — only the item count moved.
      const ids = deriveVenueModules(true);
      const labels = ids.map((id) => VENUE_MODULES[id].label);
      expect(labels).toEqual([
        "Overview",
        "Tables",
        "Availability",
        "Reservations",
        "Waitlist",
        "Menu",
        "Settings",
      ]);
      expect(labels).toHaveLength(7);
    });
  });

  describe("Change 2 — workspace fills the page width", () => {
    it("`desktopCentered` no longer caps width at 1200px (no maxWidth)", () => {
      const block = stripLineComments(desktopCenteredBlock(SHELL_SRC));
      // No maxWidth STYLE KEY anywhere in the block (the 1200 cap is gone).
      // Comments are stripped first so the explanatory prose can name the
      // removed `maxWidth` without tripping the assertion.
      expect(block).not.toMatch(/maxWidth\s*:/);
      // ...and the dead constant is no longer imported into the shell.
      const importBlock = SHELL_SRC.slice(0, SHELL_SRC.indexOf("export "));
      expect(stripLineComments(importBlock)).not.toMatch(/venueSuiteMaxWidth/);
    });

    it("`desktopCentered` KEEPS the left anchor and the edge gutters", () => {
      const block = stripLineComments(desktopCenteredBlock(SHELL_SRC));
      expect(block).toMatch(/alignSelf:\s*"flex-start"/);
      expect(block).toMatch(/paddingHorizontal:\s*spacing\.md/);
    });
  });
});
