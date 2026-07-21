import { describe, expect, jest, test } from "@jest/globals";

/**
 * #1022 C-3 — the phantom theme diff.
 *
 * BUSINESS_EVENT_SELECT is "*", so `theme_*_override` are ALWAYS present (as
 * null) on a never-themed event. The old adapter's `!== undefined` guard was
 * therefore always true and produced a non-null {color:null,font:null,
 * animation:null}. The editor can only ever emit `null`. deepEqual is
 * JSON.stringify, so '{"color":null,...}' !== 'null' — a spurious patch, a
 * forced 10-200 char edit reason, a DB write of three nulls over three nulls,
 * and a false "Edited" badge on a theme nobody touched.
 *
 * Covers SPEC test case T-4.
 * Fails-on-revert target: remove normalizeThemeOverrides from either side of
 * the comparison in `editableDraftToPatch` and this suite goes red.
 */

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import { editableDraftToPatch, computeRichFieldDiffs } from "../liveEventAdapter";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

const baseFields = {
  name: "Rooftop Sessions",
  description: "A launch night.",
  visibility: "public" as const,
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
};

const original = (themeOverrides: unknown): LiveEvent =>
  ({ ...baseFields, themeOverrides } as unknown as LiveEvent);

const edited = (themeOverrides: unknown): DraftEvent =>
  ({ ...baseFields, themeOverrides } as unknown as DraftEvent);

describe("T-4 — a semantic no-op produces no themeOverrides patch key", () => {
  test("all-null original vs null edited yields NO patch key (the C-3 case)", () => {
    const patch = editableDraftToPatch(
      original({ color: null, font: null, animation: null }),
      edited(null),
    );
    expect(Object.prototype.hasOwnProperty.call(patch, "themeOverrides")).toBe(false);
  });

  test("null original vs all-null edited also yields NO patch key", () => {
    const patch = editableDraftToPatch(
      original(null),
      edited({ color: null, font: null, animation: null }),
    );
    expect(Object.prototype.hasOwnProperty.call(patch, "themeOverrides")).toBe(false);
  });

  test("undefined original vs null edited yields NO patch key (legacy rows)", () => {
    const patch = editableDraftToPatch(original(undefined), edited(null));
    expect(Object.prototype.hasOwnProperty.call(patch, "themeOverrides")).toBe(false);
  });

  test("a REAL colour change still produces a patch key", () => {
    const patch = editableDraftToPatch(
      original({ color: null, font: null, animation: null }),
      edited({ color: "#16a34a", font: null, animation: null }),
    );
    expect(patch.themeOverrides).toEqual({
      color: "#16a34a",
      font: null,
      animation: null,
    });
  });

  test("clearing a real override back to inherited still produces a patch key", () => {
    const patch = editableDraftToPatch(
      original({ color: "#16a34a", font: null, animation: null }),
      edited(null),
    );
    expect(Object.prototype.hasOwnProperty.call(patch, "themeOverrides")).toBe(true);
    expect(patch.themeOverrides).toBeNull();
  });

  test("the emitted patch value is normalised, never {null,null,null}", () => {
    const patch = editableDraftToPatch(
      original({ color: "#16a34a", font: null, animation: null }),
      edited({ color: null, font: null, animation: null }),
    );
    expect(patch.themeOverrides).toBeNull();
  });
});

describe("T-4 — the change summary shows no theme row for a no-op", () => {
  test("computeRichFieldDiffs reports no 'Public theme' diff for all-null vs null", () => {
    const diffs = computeRichFieldDiffs(
      original({ color: null, font: null, animation: null }),
      edited(null),
    );
    expect(diffs.some((d) => d.fieldKey === "themeOverrides")).toBe(false);
  });

  test("computeRichFieldDiffs DOES report a real theme change", () => {
    const diffs = computeRichFieldDiffs(
      original(null),
      edited({ color: "#16a34a", font: null, animation: null }),
    );
    expect(diffs.some((d) => d.fieldKey === "themeOverrides")).toBe(true);
  });
});
