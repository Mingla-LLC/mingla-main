/**
 * #4579 retest P2-3 — the Mingla Team sheet opens with Remove and Cancel fully
 * visible on a standard iPhone.
 *
 * The device failure: the sheet opened at "half" (50% of the screen, 437pt on
 * an iPhone 17 Pro) while its content (title, pill, status, the "What Mingla
 * Team does" card, the removal line, Remove and Cancel) needs about 560pt, so
 * Remove showed as a thin red sliver at the fold.
 *
 * fails-on-revert: put `snapPoint="half"` back on the sheet (or drop the
 * content measurement) and the source and geometry assertions go red.
 */
import fs from "node:fs";
import path from "node:path";

import { computeSheetHeight } from "../../ui/sheetSnapHeight";
import { MINGLA_TEAM_SHEET_CHROME_TOP, minglaTeamSheetSnap } from "../minglaTeamSheetSnap";

const SPACE_6 = 24;

const code = fs
  .readFileSync(path.resolve(__dirname, "../MinglaTeamSection.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("#4579 P2-3 — the Mingla Team sheet is sized to its content", () => {
  it("the sheet's snap point is the measured content, never the fixed half", () => {
    const sheet = code.slice(code.indexOf("<Sheet\n"), code.indexOf("</Sheet>"));
    expect(sheet).toMatch(/snapPoint=\{minglaTeamSheetSnap\(sheetContentHeight, insets\.bottom\)\}/);
    expect(sheet).not.toMatch(/snapPoint="half"/);
    expect(sheet).toMatch(/onContentSizeChange=/);
  });

  it("the chrome above the content matches the sheet's handle band", () => {
    const sheetMobile = fs.readFileSync(path.resolve(__dirname, "../../ui/SheetMobile.tsx"), "utf8");
    // SHEET_TOP_INSET = HANDLE_REGION_HEIGHT = pad top (space[2] + 2 = 10)
    // + the 5pt handle bar + pad bottom (space[2] + 1 = 9) = 24.
    expect(sheetMobile).toMatch(/const HANDLE_PAD_TOP = space\[2\] \+ 2;/);
    expect(sheetMobile).toMatch(/const HANDLE_PAD_BOTTOM = space\[2\] \+ 1;/);
    expect(sheetMobile).toMatch(/const HANDLE_REGION_HEIGHT = HANDLE_PAD_TOP \+ HANDLE_HEIGHT \+ HANDLE_PAD_BOTTOM;/);
    expect(sheetMobile).toMatch(/export const SHEET_TOP_INSET = HANDLE_REGION_HEIGHT;/);
    // The body under the content keeps space[6] + the bottom safe area.
    expect(sheetMobile).toMatch(/paddingBottom: keyboardBottomPad > 0 \? keyboardBottomPad : space\[6\] \+ bottomInset/);
    expect(MINGLA_TEAM_SHEET_CHROME_TOP).toBe(10 + 5 + 9);
  });

  it.each([
    { phone: "iPhone 17 Pro", screen: 874, inset: 34, content: 512 },
    { phone: "iPhone 16e", screen: 844, inset: 34, content: 532 },
    { phone: "iPhone SE", screen: 667, inset: 0, content: 540 },
  ])("on $phone the panel holds the whole content with the body's breathing room", ({ screen, inset, content }) => {
    const snap = minglaTeamSheetSnap(content, inset);
    expect(typeof snap).toBe("number");
    const panel = computeSheetHeight(snap, screen);
    // Half would have clipped it (the device failure).
    expect(computeSheetHeight("half", screen)).toBeLessThan(MINGLA_TEAM_SHEET_CHROME_TOP + content + SPACE_6 + inset);
    // Fits: handle band + content + space[6] + bottom inset.
    expect(panel).toBeGreaterThanOrEqual(MINGLA_TEAM_SHEET_CHROME_TOP + content + SPACE_6 + inset);
  });

  it("never opens clipped before it is measured, and caps at 95% where the body scrolls", () => {
    expect(minglaTeamSheetSnap(null, 34)).toBe("full");
    expect(minglaTeamSheetSnap(0, 34)).toBe("full");
    expect(minglaTeamSheetSnap(Number.NaN, 34)).toBe("full");
    expect(computeSheetHeight(minglaTeamSheetSnap(2000, 34), 874)).toBeCloseTo(874 * 0.95);
    expect(minglaTeamSheetSnap(500, Number.NaN)).toBe(24 + 500 + SPACE_6);
  });
});
