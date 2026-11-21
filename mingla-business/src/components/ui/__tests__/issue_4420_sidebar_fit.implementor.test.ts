// MINGLA-INVARIANT: I-4420-SIDEBAR-FITS | issue #4420 | the desktop side menu (rail and expanded) fits its measured panel height down to 432 px with every group open, never scrolls, and a 14th item still fits.
/**
 * #4420 — Host web side menu sizing is a pure function of the measured height.
 * FAILS-ON-REVERT: restore the ScrollViews / fixed 48 + 40 sizes and the
 * no-ScrollView source check fails; restore fixed sizes in the sizing
 * functions and the fit assertions fail at 432.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4420_sidebar_fit.implementor.test.ts
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

import {
  EXPANDED_BRAND_ROW_HEIGHT,
  EXPANDED_FIXED_CHROME,
  EXPANDED_ROW_MAX,
  RAIL_DIVIDER_HEIGHT,
  expandedAvailable,
  expandedLayout,
  railLayout,
  railVerticalPadding,
} from "../desktopSidebarState";

const PANELS = [432, 532, 692, 872, 1272];
const RAIL_LOGO_BLOCK = 26 + 12;

describe("#4420 collapsed rail sizing", () => {
  for (const slots of [13, 14]) {
    for (const panel of PANELS) {
      test(`${slots} slots fit a ${panel} panel; tile square, 20..48, inside its slot`, () => {
        const body = panel - 2 * railVerticalPadding(panel) - RAIL_LOGO_BLOCK;
        const m = railLayout(body, slots, 2);
        expect(m.tile).toBeGreaterThanOrEqual(20);
        expect(m.tile).toBeLessThanOrEqual(48);
        expect(m.tile).toBeLessThanOrEqual(m.slot);
        expect(slots * m.slot + 2 * RAIL_DIVIDER_HEIGHT).toBeLessThanOrEqual(body + 0.001);
        expect([16, 18, 20]).toContain(m.icon);
        if (panel >= 872) expect(m.tile).toBe(48);
      });
    }
  }
  test("padding is 12 under 700, else 20; icon steps down with the tile", () => {
    expect(railVerticalPadding(692)).toBe(12);
    expect(railVerticalPadding(700)).toBe(20);
    expect(railLayout(2000, 13, 2).icon).toBe(20);
    expect(railLayout(300, 13, 2).icon).toBe(16);
  });
});

describe("#4420 expanded sidebar sizing", () => {
  // 3 top + 6 Promote + 2 Audience + Account = 12 rows, 2 titles, 3 gaps; 13 adds a 14th page.
  for (const rows of [12, 13]) {
    for (const panel of PANELS) {
      test(`${rows} rows fit a ${panel} panel; row <= 64; leftover is never negative`, () => {
        const avail = expandedAvailable(panel, EXPANDED_BRAND_ROW_HEIGHT);
        const m = expandedLayout(avail, rows, 2, 3);
        expect(m.row).toBeLessThanOrEqual(EXPANDED_ROW_MAX);
        const used = m.row * rows + m.title * 2 + m.gap * 3;
        expect(used).toBeLessThanOrEqual(avail);
        expect(m.row).toBeGreaterThanOrEqual(20);
        expect(EXPANDED_FIXED_CHROME + EXPANDED_BRAND_ROW_HEIGHT + used).toBeLessThanOrEqual(panel);
        expect(m.labelSize).toBe(m.row < 34 ? 13 : 15);
        expect(m.icon).toBe(m.row < 32 ? 16 : 18);
      });
    }
  }
  test("folding a group gives its room to the rest", () => {
    const avail = expandedAvailable(532, EXPANDED_BRAND_ROW_HEIGHT);
    expect(expandedLayout(avail, 10, 2, 3).row).toBeGreaterThan(expandedLayout(avail, 12, 2, 3).row);
  });
});

describe("#4420 no scrolling in either sidebar file", () => {
  for (const file of ["../DesktopSidebar.tsx", "../DesktopSidebarRail.tsx"]) {
    test(`${file} has no ScrollView`, () => {
      const src = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(src).not.toMatch(/ScrollView/);
      expect(src).not.toMatch(/sidebar-rail-scroll/);
    });
  }
});
