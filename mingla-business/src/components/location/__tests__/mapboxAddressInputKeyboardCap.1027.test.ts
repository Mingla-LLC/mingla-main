/**
 * issue #1027 — Thread A (native keyboard/viewport) · Symptom 1 regression.
 * Implementor-owned happy-path guard for the shared keyboard-aware dropdown cap.
 *
 * ROOT CAUSE (proven on a physical Samsung A72): the shared card-mode suggestion
 * list in `packages/location-input/src/MapboxAddressInput.tsx` rendered
 * `<Scroll style={{ maxHeight: tokens.dropdown.maxHeight }}>` — with the injected
 * token = 9999 on every business host — so the list laid out as one tall block
 * that overflowed BEHIND the soft keyboard; rows past the keyboard's top edge
 * were rendered but physically unreachable while typing. The fix caps the scroll
 * viewport to the measured space above the keyboard via the pure
 * `computeDropdownMaxHeight` (RN `Keyboard` API + `measureInWindow`), scrolling
 * within the cap. Fixes all 9 Class-A surfaces at the shared layer.
 *
 * WHY SOURCE-CHARACTERIZATION (not an import): `packages/*.tsx` do `import React
 * from "react"`, and `react`/`react-native` are unresolvable FROM the packages/
 * dir under this node/ts-jest config (mingla-business owns the only real copy —
 * see jest.config.cjs moduleNameMapper notes). Every shared-location regression
 * in this repo (BrandCreationFlow.mapbox, TripCreatorStep1Basics.mapbox,
 * orch-1361/1362) is therefore source-characterization. This suite pins the exact
 * cap formula + constants (the behavioral contract, SPEC §7 T-1..T-4) AND the
 * wiring (SPEC §9), reading the worktree package source directly.
 *
 * FAILS-ON-REVERT (proven by true line change in the implementation report):
 *   revert the `<Scroll>` back to `maxHeight: tokens.dropdown.maxHeight` (or delete
 *   the cap) → the WIRING assertions go RED; flip the formula's `-` to `+` / drop
 *   the iOS accessory / drop the MIN floor → the CAP-FORMULA assertions go RED.
 *
 * I-PROPOSED-1027-KEYBOARD-AWARE-DROPDOWN-CAP.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

// The worktree package source (process.cwd() === the worktree's mingla-business
// when jest runs; the shared package sits one level up in packages/).
const SRC = (): string =>
  readFileSync(
    path.join(
      process.cwd(),
      "../packages/location-input/src/MapboxAddressInput.tsx",
    ),
    "utf8",
  );

/** Strip // line comments (guarding https://) then /* *​/ blocks so the absence
 * assertions ignore the explanatory comments in the source. */
const stripComments = (src: string): string =>
  src
    .replace(/([^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

describe("issue #1027 · Symptom 1 — keyboard-aware cap formula (behavioral contract)", () => {
  test("the three cap constants are exported with the SPEC values (8 / 44 / 96)", () => {
    const s = stripComments(SRC());
    expect(s).toMatch(/export const DROPDOWN_SAFETY_MARGIN\s*=\s*8\b/);
    expect(s).toMatch(/export const DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE\s*=\s*44\b/);
    expect(s).toMatch(/export const MIN_DROPDOWN_HEIGHT\s*=\s*96\b/);
  });

  test("hidden keyboard / unmeasured card falls back to the token (T-3 — zero regression)", () => {
    const s = stripComments(SRC());
    // the guard clause returns the injected token unchanged when there is no
    // constraint (keyboard hidden → non-finite screenY, or cardTopY not measured)
    expect(s).toMatch(
      /if\s*\(\s*!Number\.isFinite\(keyboardScreenY\)\s*\|\|\s*cardTopY === null\s*\)\s*\{\s*return tokenMaxHeight;/,
    );
  });

  test("availableBelow subtracts the safety margin AND (iOS-only) the accessory allowance", () => {
    const s = stripComments(SRC());
    expect(s).toMatch(
      /const accessory\s*=\s*isIOS\s*\?\s*DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE\s*:\s*0;/,
    );
    // the exact subtraction — a flipped sign or dropped term fails this (T-1/T-2)
    expect(s).toMatch(
      /keyboardScreenY\s*-\s*cardTopY\s*-\s*DROPDOWN_SAFETY_MARGIN\s*-\s*accessory/,
    );
  });

  test("the result is floored at MIN and capped by the token upper bound (T-2 clamp)", () => {
    const s = stripComments(SRC());
    expect(s).toMatch(
      /Math\.max\(\s*MIN_DROPDOWN_HEIGHT\s*,\s*Math\.min\(\s*tokenMaxHeight\s*,\s*availableBelow\s*\)\s*\)/,
    );
  });
});

describe("issue #1027 · Symptom 1 — shared component wiring (fails-on-revert)", () => {
  test("the card-mode <Scroll> applies the COMPUTED cap, not the raw token", () => {
    const s = stripComments(SRC());
    // the fix: Scroll's maxHeight is the keyboard-aware computed value
    expect(s).toMatch(/maxHeight:\s*dropdownMaxHeight\b/);
    // the regression SPEC §9 names must NOT be present on the <Scroll>:
    // `maxHeight: tokens.dropdown.maxHeight` (case-sensitive — `tokenMaxHeight:`
    // in the compute call does NOT match this lowercase `maxHeight:` pattern).
    expect(s).not.toMatch(/maxHeight:\s*tokens\.dropdown\.maxHeight/);
  });

  test("the computed cap is fed from the pure computeDropdownMaxHeight()", () => {
    const s = stripComments(SRC());
    expect(s).toMatch(/const dropdownMaxHeight\s*=\s*computeDropdownMaxHeight\(/);
    expect(s).toContain("tokenMaxHeight: tokens.dropdown.maxHeight");
    expect(s).toContain('isIOS: Platform.OS === "ios"');
  });

  test("the RN Keyboard API is subscribed (no new dependency) and cleaned up", () => {
    const s = stripComments(SRC());
    expect(s).toMatch(/Keyboard\.addListener\(\s*"keyboardDidShow"/);
    expect(s).toMatch(/Keyboard\.addListener\(\s*"keyboardDidHide"/);
    expect(s).toMatch(/subs\.forEach\(\(s\)\s*=>\s*s\.remove\(\)\)/);
    // the fix must NOT pull in react-native-keyboard-controller (SPEC §4a hard rule)
    expect(s).not.toMatch(/react-native-keyboard-controller/);
  });

  test("the dropdown card is measured in window coords to derive cardTopY", () => {
    const s = stripComments(SRC());
    expect(s).toMatch(/measureInWindow/);
    expect(s).toMatch(/onLayout=\{measureCard\}/);
    expect(s).toMatch(/ref=\{cardRef\}/);
  });

  test("inline mode is untouched (cap applies only to the card branch)", () => {
    // the inline branch still flows rows directly with no scroll cap
    expect(SRC()).toContain("inline mode — rows flow directly on the host canvas");
  });
});
