/**
 * #4389 (device r4, Nigeria F3) — opening the keyboard in the bank picker
 * pushed its "Search banks" header up into the status bar: the raw Modal's
 * avoiding view padded the root by the keyboard height while the sheet kept a
 * fixed height (64% of the window). The picker root now starts under the top
 * safe area (+ a gap) and the sheet's height is only its preferred size
 * (flexShrink), so it shrinks into the room left instead.
 *
 * Source test: the bank picker is a raw RN Modal inside a view whose render
 * suites run only under the render configs.
 * FAILS ON REVERT: drop the root's top inset or the sheet's flexShrink → T1.
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

const src = fs.readFileSync(path.join(__dirname, "../BrandPaystackOnboardView.tsx"), "utf8");

describe("#4389 — the bank picker stays under the top safe area with the keyboard up", () => {
  test("T1: root padded by the top inset; the sheet shrinks instead of overflowing", () => {
    expect(src).toMatch(/paddingTop: safeArea\.top \+ spacing\.sm/);
    expect(src).toMatch(/style=\{\[styles\.modalRoot, modalRootInsetStyle\]\}/);
    const dyn = src.slice(src.indexOf("const sheetDynamicStyle"), src.indexOf("const modalRootInsetStyle"));
    expect(dyn).toMatch(/flexShrink: 1/);
    expect(dyn).toMatch(/minHeight: 0/);
    // The avoiding view still lifts the sheet with the keyboard (iOS).
    expect(src).toMatch(/behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);
  });
});
