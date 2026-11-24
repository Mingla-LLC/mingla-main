/**
 * #4579 retest 2 — tester adversarial test for the Mingla Team sheet snap (P2-3).
 *
 * Angle (not covered by the implementor's three-phone happy path): hostile
 * measurements. The Sheet reads a numeric snapPoint in (0, 1] as a RATIO of the
 * screen and anything above 1 as absolute points, so a measured snap that ever
 * fell into (0, 1] would open a near-empty sheet. Non-finite, negative, zero
 * and sub-point heights and insets must never produce a ratio, NaN, or a panel
 * that clips Remove and Cancel; a huge content height must cap at 95% (the body
 * then scrolls); and the snap is monotonic, so more content never opens smaller.
 *
 * fails-on-revert (verified): removing the `contentHeight <= 0` /
 * `Number.isFinite(contentHeight)` guard, or the bottom-inset guard, in
 * `minglaTeamSheetSnap.ts` turns these assertions red.
 */
import { computeSheetHeight, MAX_SNAP_RATIO, MIN_SNAP_PX } from "../../ui/sheetSnapHeight";
import { MINGLA_TEAM_SHEET_CHROME_TOP, minglaTeamSheetSnap } from "../minglaTeamSheetSnap";

const SPACE_6 = 24;
const SCREENS = [568, 667, 812, 844, 874, 932, 1366];

describe("#4579 tester — Mingla Team sheet snap at hostile values", () => {
  it.each([null, 0, -0, -1, -10000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "content %p opens at full, never a ratio or NaN",
    (content) => {
      expect(minglaTeamSheetSnap(content as number | null, 34)).toBe("full");
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -34, -0, 0])(
    "bottom inset %p is treated as 0, never NaN or a shrink",
    (inset) => {
      const snap = minglaTeamSheetSnap(500, inset);
      expect(snap).toBe(MINGLA_TEAM_SHEET_CHROME_TOP + 500 + SPACE_6);
      expect(Number.isFinite(snap as number)).toBe(true);
    },
  );

  it.each([Number.MIN_VALUE, 1e-9, 0.4, 0.999, 1, 1.5])(
    "a tiny positive content %p never lands in the Sheet's ratio band (0, 1]",
    (content) => {
      const snap = minglaTeamSheetSnap(content, 0);
      expect(typeof snap).toBe("number");
      expect(snap as number).toBeGreaterThan(1);
      expect(Number.isInteger(snap)).toBe(true);
      for (const screen of SCREENS) {
        // Absolute points, clamped up to the Sheet's minimum, never a fraction of the screen.
        expect(computeSheetHeight(snap, screen)).toBe(MIN_SNAP_PX);
      }
    },
  );

  it("fractional measurements round UP, so the last pixel row of Cancel is never cut", () => {
    for (const content of [511.01, 511.5, 511.99]) {
      const snap = minglaTeamSheetSnap(content, 34.4) as number;
      expect(snap).toBeGreaterThanOrEqual(MINGLA_TEAM_SHEET_CHROME_TOP + content + SPACE_6 + 34.4);
      expect(Number.isInteger(snap)).toBe(true);
    }
  });

  it("content taller than the screen caps at 95% on every screen (the body scrolls)", () => {
    for (const screen of SCREENS) {
      for (const content of [screen, screen * 2, 1e9]) {
        expect(computeSheetHeight(minglaTeamSheetSnap(content, 34), screen)).toBeCloseTo(screen * MAX_SNAP_RATIO);
      }
    }
  });

  it("is monotonic: more content or a bigger inset never opens a smaller sheet", () => {
    let previous = 0;
    for (let content = 1; content <= 2000; content += 37) {
      const snap = minglaTeamSheetSnap(content, 34) as number;
      expect(snap).toBeGreaterThanOrEqual(previous);
      expect(snap).toBeGreaterThanOrEqual(minglaTeamSheetSnap(content, 0) as number);
      previous = snap;
    }
  });

  it("whenever the content fits under the cap, the panel holds content + chrome exactly (no clip)", () => {
    for (const screen of SCREENS) {
      for (const inset of [0, 20, 34, 48]) {
        for (let content = 80; content <= screen; content += 41) {
          const need = MINGLA_TEAM_SHEET_CHROME_TOP + content + SPACE_6 + inset;
          if (need > screen * MAX_SNAP_RATIO || need < MIN_SNAP_PX) continue;
          expect(computeSheetHeight(minglaTeamSheetSnap(content, inset), screen)).toBeGreaterThanOrEqual(need);
        }
      }
    }
  });
});
