import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import {
  normalizeThemeOverrides,
  themeOverridesToColumns,
} from "../../../services/offeringTheme";

/**
 * #1043 — TESTER adversarial suite. DIFFERENT ANGLE from the implementor's
 * `issue1043RsvpThemeWrite.test.ts`.
 *
 * The implementor pins that the rsvpMode branch CALLS `patchPublishedEventTheme`
 * gated on `patch.themeOverrides !== undefined`. It does NOT exercise the
 * CLEAR case: an organiser who had a custom theme on a published RSVP and
 * removes it (reverts to brand default). On a clear, `editableDraftToPatch`
 * emits `patch.themeOverrides === null` (a real change from non-null -> null),
 * which is `!== undefined`, so the gate MUST let it through and the write MUST
 * forward an explicit `null` — otherwise clearing a theme would silently keep
 * the old colour. A "fix" that gated on truthiness (`if (patch.themeOverrides)`)
 * or forwarded `patch.themeOverrides` without the `?? null` coalesce would pass
 * the implementor's substring pin yet DROP the clear.
 *
 * This suite proves the clear-persists contract two ways:
 *   1. Behaviourally, on the pure spine the fix's write depends on
 *      (`normalizeThemeOverrides` + `themeOverridesToColumns`): a `null`
 *      override maps to three explicit `null` columns — i.e. a clear is written,
 *      not skipped.
 *   2. Source-gate (comment-stripped, fails-on-revert): the rsvpMode branch
 *      forwards `patch.themeOverrides ?? null` — so a null clear is forwarded.
 *
 * fails-on-revert: reverting EditPublishedScreen's rsvpMode theme write removes
 * the `patch.themeOverrides ?? null` forward from the rsvp region -> the
 * source-gate assertions turn red.
 */

const SCREEN_PATH = path.resolve(__dirname, "..", "EditPublishedScreen.tsx");

/** Strip block + line comments so the protective comments never satisfy greps. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("#1043 (tester) — clearing an RSVP theme persists as explicit nulls", () => {
  test("BEHAVIOUR: a null override maps to three explicit null columns (a clear is WRITTEN, not skipped)", () => {
    // This is exactly what the rsvp-branch write sends when patch.themeOverrides
    // is null (the clear case): patchOfferingTheme -> themeOverridesToColumns(null).
    expect(themeOverridesToColumns(null)).toEqual({
      theme_color_override: null,
      theme_font_override: null,
      theme_animation_override: null,
    });
  });

  test("BEHAVIOUR: undefined (untouched) and null (cleared) both normalise to null but the gate distinguishes them", () => {
    // The gate is `patch.themeOverrides !== undefined`. `editableDraftToPatch`
    // omits the key entirely (undefined) when the theme was untouched, and emits
    // `null` when it was actively cleared. Both normalise to null downstream, so
    // the WRITE payload is identical — but only the cleared case (!== undefined)
    // ever reaches the write. This asserts the normaliser can't collapse the two
    // inputs into something that would change the payload.
    expect(normalizeThemeOverrides(undefined)).toBeNull();
    expect(normalizeThemeOverrides(null)).toBeNull();
    // A partial override (colour only) is preserved, so a set-then-save is not
    // mistaken for a clear.
    expect(
      normalizeThemeOverrides({ color: "#2563eb", font: null, animation: null }),
    ).toEqual({ color: "#2563eb", font: null, animation: null });
    expect(
      themeOverridesToColumns({ color: "#2563eb", font: null, animation: null }),
    ).toEqual({
      theme_color_override: "#2563eb",
      theme_font_override: null,
      theme_animation_override: null,
    });
  });

  test("FAILS-ON-REVERT: the rsvpMode branch forwards `patch.themeOverrides ?? null` (a null clear is forwarded, not dropped)", () => {
    const source = stripComments(readFileSync(SCREEN_PATH, "utf8"));
    const rsvpBranchStart = source.indexOf("if (rsvpMode) {");
    const eventPathMarker = source.indexOf(
      "const validation = validateLiveEventFieldUpdate",
    );
    expect(rsvpBranchStart).toBeGreaterThanOrEqual(0);
    expect(eventPathMarker).toBeGreaterThan(rsvpBranchStart);
    const rsvpRegion = source.slice(rsvpBranchStart, eventPathMarker);
    // The clear-forwarding coalesce — the implementor's `patch.themeOverrides`
    // substring would match with OR without `?? null`; this pins the coalesce.
    expect(rsvpRegion).toMatch(/themeOverrides:\s*patch\.themeOverrides\s*\?\?\s*null/);
    // The gate is an explicit undefined check (so a null clear passes), NOT a
    // truthiness gate that would drop the clear.
    expect(rsvpRegion).toMatch(/patch\.themeOverrides\s*!==\s*undefined/);
  });
});
