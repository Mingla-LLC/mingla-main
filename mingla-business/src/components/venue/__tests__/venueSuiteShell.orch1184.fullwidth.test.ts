/**
 * ORCH-1184 — reservations command-center desktop: bare rail + full-width
 * workspace. Implementor-owned happy-path regression test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * [TEST-MOD-APPROVED ORCH-1484] — RELOCATION AMENDMENT (2026-08-02), granted by
 * Seth for issue #1484 [stay-desktop-shell] only.
 *
 * WHAT MOVED: #1484 extracted the ORCH-1184 desktop layout out of
 * `VenueSuiteShell.tsx` into the SHARED `../../suite/SuiteDesktopShell.tsx`, so
 * the Stay suite renders the identical rail + full-width workspace instead of
 * its own phone-first template (approved decision D2). The `desktopCentered` /
 * `desktopRail` / `desktopWorkspace` / `railInner` / `railActiveBar` styles and
 * the rail component now live in the shared file. The venue shell's RENDERED
 * OUTPUT is unchanged (byte-identical react-test-renderer tree, proved in the
 * #1484 implementation report).
 *
 * WHAT CHANGED IN THIS FILE: only WHERE the source text is read from. Every
 * protected rule is PRESERVED, and two are STRENGTHENED (the `railSection` and
 * `venueSuiteMaxWidth` assertions now run against BOTH the venue shell AND the
 * shared shell, so the caption/cap cannot creep back through either file):
 *   - `desktopCentered` still has NO `maxWidth` (the ORCH-1184 1200 cap stays
 *     deleted) — now asserted on the shared shell, where the style lives.
 *   - `desktopCentered` still KEEPS `alignSelf: "flex-start"` and
 *     `paddingHorizontal: spacing.md`.
 *   - `railSection` captions stay removed.
 *   - `venueSuiteMaxWidth` stays un-imported.
 *   - the seven-item rail derive order is untouched.
 * NOTHING is weakened or deleted.
 * ─────────────────────────────────────────────────────────────────────────────
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

// [TEST-MOD-APPROVED ORCH-1484] — the ORCH-1184 desktop layout styles + rail now
// live in the SHARED shell that BOTH the venue and stay suites consume.
const SHARED_SHELL_SRC = readFileSync(
  join(__dirname, "..", "..", "suite", "SuiteDesktopShell.tsx"),
  "utf8",
);

// Both files together — used where a rule must hold no matter which file the
// layout lives in (strictly stronger than the pre-#1484 single-file check).
const BOTH_SHELL_SRC = `${SHELL_SRC}\n${SHARED_SHELL_SRC}`;

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
      // [TEST-MOD-APPROVED ORCH-1484] asserted across BOTH the venue shell and
      // the shared shell the rail moved into — the caption cannot creep back
      // through either file.
      expect(BOTH_SHELL_SRC).not.toMatch(/styles\.railSection/);
      // Neither caption is rendered as rail section text.
      expect(BOTH_SHELL_SRC).not.toMatch(
        /<Text style=\{styles\.railSection\}>Command<\/Text>/,
      );
      expect(BOTH_SHELL_SRC).not.toMatch(
        /<Text style=\{styles\.railSection\}>Booking<\/Text>/,
      );
    });

    it("the `railSection` style object is removed (dead-style cleanup)", () => {
      expect(BOTH_SHELL_SRC).not.toMatch(/^\s*railSection:\s*\{/m);
    });

    it("all rail items still derive in the existing order", () => {
      // Toggle ON → the full rail: Overview, booking band, Menu, Settings.
      // ORCH-1186-C [TEST-MOD-APPROVED ORCH-1186-C] added the command-band
      // "Menu" module (between Waitlist and Settings), so the ON rail is now 7
      // items; Settings still stays last. The ORCH-1184 full-width layout +
      // bare-rail intent is unchanged — only the item count moved.
      // Issue #1735 [TEST-MOD-APPROVED #1735] — the command-band "Insights"
      // module lands between Menu and Settings (the ORCH-1186-C precedent);
      // the ON rail is now 8 items, Settings still last, ORCH-1184's
      // full-width + bare-rail intent unchanged.
      // Issue #1791 [TEST-MOD-APPROVED #1791] — the command-band "Orders"
      // module lands between Insights and Settings, same precedent; the ON
      // rail is now 9 items, Settings STILL last, ORCH-1184's full-width +
      // bare-rail intent still unchanged (only the item count moved).
      const ids = deriveVenueModules(true);
      const labels = ids.map((id) => VENUE_MODULES[id].label);
      expect(labels).toEqual([
        "Overview",
        "Tables",
        "Availability",
        "Reservations",
        "Waitlist",
        "Menu",
        "Insights",
        "Orders",
        "Settings",
      ]);
      expect(labels).toHaveLength(9);
    });
  });

  describe("Change 2 — workspace fills the page width", () => {
    it("`desktopCentered` no longer caps width at 1200px (no maxWidth)", () => {
      // [TEST-MOD-APPROVED ORCH-1484] — read from the SHARED shell, which now
      // owns this style. Assertion text is otherwise verbatim.
      const block = stripLineComments(desktopCenteredBlock(SHARED_SHELL_SRC));
      // No maxWidth STYLE KEY anywhere in the block (the 1200 cap is gone).
      // Comments are stripped first so the explanatory prose can name the
      // removed `maxWidth` without tripping the assertion.
      expect(block).not.toMatch(/maxWidth\s*:/);
      // ...and the dead constant is no longer imported into EITHER shell.
      for (const src of [SHELL_SRC, SHARED_SHELL_SRC]) {
        const importBlock = src.slice(0, src.indexOf("export "));
        expect(stripLineComments(importBlock)).not.toMatch(/venueSuiteMaxWidth/);
      }
    });

    it("`desktopCentered` KEEPS the left anchor and the edge gutters", () => {
      const block = stripLineComments(desktopCenteredBlock(SHARED_SHELL_SRC));
      expect(block).toMatch(/alignSelf:\s*"flex-start"/);
      expect(block).toMatch(/paddingHorizontal:\s*spacing\.md/);
    });
  });
});
