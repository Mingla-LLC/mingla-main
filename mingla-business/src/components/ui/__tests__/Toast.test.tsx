// ORCH-0789 / I-PROPOSED-ERROR-TOAST-DISMISSIBLE: assert the per-kind
// auto-dismiss schedule keeps error toasts bounded. Full render tests
// (close-icon tap, body tap, timer advance, autoDismissMs=null) require
// @testing-library/react-native — not currently part of the
// mingla-business Jest harness. Those land with the TEST-phase
// infrastructure setup; see implementation report Discoveries §"Toast
// render-test infra".

import { describe, expect, test } from "@jest/globals";

import { AUTO_DISMISS } from "../toastTimings";

describe("Toast — auto-dismiss schedule", () => {
  test("error toasts have a bounded auto-dismiss timer (not null)", () => {
    // The bug that motivated ORCH-0789: error toasts were permanent
    // (`error: null`). Permanent error toasts strand buyers on iOS
    // because there is no Modal back affordance. The invariant
    // I-PROPOSED-ERROR-TOAST-DISMISSIBLE requires a bounded fallback.
    expect(AUTO_DISMISS.error).toBeGreaterThan(0);
    expect(Number.isFinite(AUTO_DISMISS.error)).toBe(true);
  });

  test("error timer ≥ 8 s — long enough to read", () => {
    expect(AUTO_DISMISS.error).toBeGreaterThanOrEqual(8000);
  });

  test("error timer ≤ 20 s — short enough to recover", () => {
    expect(AUTO_DISMISS.error).toBeLessThanOrEqual(20000);
  });

  test("success / info / warn timers unchanged from prior behaviour", () => {
    expect(AUTO_DISMISS.success).toBe(2600);
    expect(AUTO_DISMISS.info).toBe(2600);
    expect(AUTO_DISMISS.warn).toBe(6000);
  });

  test("every kind has a defined finite timer (no nulls)", () => {
    for (const kind of ["success", "info", "warn", "error"] as const) {
      expect(typeof AUTO_DISMISS[kind]).toBe("number");
      expect(Number.isFinite(AUTO_DISMISS[kind])).toBe(true);
    }
  });
});
