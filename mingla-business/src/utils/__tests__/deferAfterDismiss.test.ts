/**
 * #1360 [payment-confirm-defer] — Tier 3 of #1342. Implementor happy-path
 * regression, LAYER 1: the deferAfterDismiss helper's timing contract (SPEC
 * §7 T-1/T-2, SC-4).
 *
 * Bug (proven line-by-line, class device-proven in #1338/#1356): the order
 * refund/cancel/door-refund success toast was fired in the SAME synchronous tick
 * that closed the sheet, so the closing sheet's native <Modal> still occupied the
 * iOS root VC and UIKit silently dropped the toast's own native <Modal>.
 *
 * Fix: deferAfterDismiss(fn) schedules fn PAST the longer of the Sheet (280ms)
 * and Modal (200ms) unmount windows (+60ms margin ≈ 340ms), so the toast presents
 * from a now-free root VC.
 *
 * FAILS-ON-REVERT (SPEC §9): make deferAfterDismiss synchronous (call fn()
 * directly instead of setTimeout) and T-1 + the override test go RED — fn is
 * observed before any timer advance.
 *
 * SheetMobile / Modal carry heavy native deps (reanimated / gesture-handler /
 * expo-blur) the node/ts-jest env cannot parse, so both are mocked to their bare
 * unmount-window constants (mirrors CoverPickerSheet.nestedToast.issue1356's
 * sibling-module mocks) — the real deferral math + timer behavior still run.
 *
 * I-PROPOSED-1360-PAYMENT-CONFIRM-DEFERRED-PAST-DISMISSAL.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../components/ui/SheetMobile", () => ({ UNMOUNT_DELAY_MS: 280 }));
jest.mock("../../components/ui/Modal", () => ({ UNMOUNT_DELAY_MS: 200 }));

// Imported AFTER the mocks so the bare constants are registered first.
// eslint-disable-next-line import/first
import { DEFER_SETTLE_MS, deferAfterDismiss } from "../deferAfterDismiss";

describe("#1360 deferAfterDismiss timing contract", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("DEFER_SETTLE_MS clears the longer (Sheet 280ms) unmount window with margin", () => {
    // max(280, 200) + 60 = 340 — the SPEC §4a default.
    expect(DEFER_SETTLE_MS).toBe(340);
    expect(DEFER_SETTLE_MS).toBeGreaterThan(280);
  });

  test("T-1 does NOT invoke fn before the sheet unmount window (279ms)", () => {
    const fn = jest.fn();
    deferAfterDismiss(fn);
    jest.advanceTimersByTime(279);
    expect(fn).not.toHaveBeenCalled();
  });

  test("T-2 invokes fn exactly once after the settle delay", () => {
    const fn = jest.fn();
    deferAfterDismiss(fn);
    jest.advanceTimersByTime(DEFER_SETTLE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("honors an explicit settleMs override", () => {
    const fn = jest.fn();
    deferAfterDismiss(fn, 500);
    jest.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
