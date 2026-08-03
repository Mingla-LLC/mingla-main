/**
 * #1360 [payment-confirm-defer] — Tier 3 of #1342. TESTER adversarial regression
 * (RESTORED — the original was lost when its push failed silently at #1360's
 * close, so PR #1366 shipped with only the implementor's tests).
 *
 * ADVERSARIAL ANGLE — the SINGLE-SOURCE-OF-TRUTH DERIVATION invariant, distinct
 * from the two implementor tests:
 *   - deferAfterDismiss.test.ts pins the EXACT real timing (mocks 280/200, asserts
 *     DEFER_SETTLE_MS === 340). Because it feeds the REAL constants, a magic
 *     `DEFER_SETTLE_MS = 340` substitution still yields 340 → it CANNOT catch it.
 *   - paymentConfirmDefer.issue1360.test.ts pins the SOURCE WIRING over text
 *     (imports/setTimeout present) but never executes the derivation math.
 *
 * This test feeds the two primitive unmount windows values that DIFFER from the
 * real 280/200, re-imports deferAfterDismiss fresh, and proves DEFER_SETTLE_MS
 * TRACKS `max(SheetUnmount, ModalUnmount) + margin` in BOTH directions
 * (Sheet>Modal AND Modal>Sheet). A hardcoded 340 (or any single-source /
 * dropped-max variant) fails this.
 *
 * FAILS-ON-REVERT: replace the derivation in deferAfterDismiss.ts with a magic
 * literal `export const DEFER_SETTLE_MS = 340;` (dropping the max()+margin over
 * the imported primitives) and every "derivation" assertion below goes RED —
 * with mocked 500/100 the derivation is 560 but the literal is 340.
 *
 * Re-import mechanism mirrors src/config/__tests__/featureFlags.test.ts:
 * jest.resetModules() + jest.doMock(primitive) + `await import(...)`, so each
 * case evaluates the module top-level against freshly-mocked primitives. Sheet /
 * Modal carry heavy native deps (reanimated / gesture-handler / expo-blur) the
 * node/ts-jest env cannot parse, so both are mocked to bare unmount constants
 * (same shape as the implementor test's jest.mock).
 *
 * I-PROPOSED-1360-PAYMENT-CONFIRM-DEFERRED-PAST-DISMISSAL.
 */
import {
  afterEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// The safety margin is part of the contract (deferAfterDismiss.ts SETTLE_MARGIN_MS).
// Declared here as the KNOWN margin so the derivation is checked against
// max(window) + margin, not re-read from the module under test.
const CONTRACT_MARGIN_MS = 60;

const SHEET_PATH = "../../components/ui/SheetMobile";
const MODAL_PATH = "../../components/ui/Modal";

/**
 * Reset the module registry, mock BOTH primitives to the given unmount windows,
 * and import a FRESH copy of deferAfterDismiss so its module-top-level derivation
 * runs against exactly these values.
 */
async function loadWithUnmountWindows(
  sheetMs: number,
  modalMs: number,
): Promise<typeof import("../deferAfterDismiss")> {
  jest.resetModules();
  jest.doMock(SHEET_PATH, () => ({ UNMOUNT_DELAY_MS: sheetMs }));
  jest.doMock(MODAL_PATH, () => ({ UNMOUNT_DELAY_MS: modalMs }));
  return import("../deferAfterDismiss");
}

afterEach(() => {
  jest.dontMock(SHEET_PATH);
  jest.dontMock(MODAL_PATH);
  jest.resetModules();
});

describe("#1360 DEFER_SETTLE_MS is DERIVED from the primitives (single source of truth)", () => {
  test("tracks the Sheet window when Sheet > Modal (500/100 → 560, not 340)", async () => {
    const { DEFER_SETTLE_MS } = await loadWithUnmountWindows(500, 100);
    // Derivation: max(500, 100) + 60 = 560. A magic `340` literal fails here.
    expect(DEFER_SETTLE_MS).toBe(500 + CONTRACT_MARGIN_MS);
    expect(DEFER_SETTLE_MS).toBe(560);
    expect(DEFER_SETTLE_MS).not.toBe(340);
    // Clears BOTH mocked windows.
    expect(DEFER_SETTLE_MS).toBeGreaterThan(500);
    expect(DEFER_SETTLE_MS).toBeGreaterThan(100);
  });

  test("tracks the Modal window when Modal > Sheet (100/500 → 560, not 340)", async () => {
    const { DEFER_SETTLE_MS } = await loadWithUnmountWindows(100, 500);
    // Same 560 from the OTHER direction: it takes whichever window is longer, so
    // a "always add the Sheet window" / "always add the Modal window" variant
    // fails one of the two directions. A magic `340` literal fails both.
    expect(DEFER_SETTLE_MS).toBe(500 + CONTRACT_MARGIN_MS);
    expect(DEFER_SETTLE_MS).toBe(560);
    expect(DEFER_SETTLE_MS).not.toBe(340);
    expect(DEFER_SETTLE_MS).toBeGreaterThan(500);
    expect(DEFER_SETTLE_MS).toBeGreaterThan(100);
  });

  test("re-derives on a third, asymmetric pairing (900/450 → 960)", async () => {
    const { DEFER_SETTLE_MS } = await loadWithUnmountWindows(900, 450);
    // Proves the value is COMPUTED per-import, not a constant that happened to
    // equal one earlier case.
    expect(DEFER_SETTLE_MS).toBe(Math.max(900, 450) + CONTRACT_MARGIN_MS);
    expect(DEFER_SETTLE_MS).toBe(960);
    expect(DEFER_SETTLE_MS).not.toBe(340);
  });

  test("equal windows still add the margin exactly once (300/300 → 360)", async () => {
    const { DEFER_SETTLE_MS } = await loadWithUnmountWindows(300, 300);
    expect(DEFER_SETTLE_MS).toBe(300 + CONTRACT_MARGIN_MS);
    expect(DEFER_SETTLE_MS).toBe(360);
  });
});

describe("#1360 deferAfterDismiss is fire-and-forget past the derived delay", () => {
  test("returns void and invokes fn exactly once after the DERIVED settle delay", async () => {
    // Mock to windows that differ from the real 280/200 so the delay actually
    // exercised is the derived one (max(500,100)+60 = 560), not a baked 340.
    const { deferAfterDismiss, DEFER_SETTLE_MS } =
      await loadWithUnmountWindows(500, 100);
    expect(DEFER_SETTLE_MS).toBe(560);

    jest.useFakeTimers();
    try {
      const fn = jest.fn();
      const returned = deferAfterDismiss(fn);

      // Fire-and-forget: no handle / promise handed back.
      expect(returned).toBeUndefined();

      // Not called one tick before the derived delay.
      jest.advanceTimersByTime(DEFER_SETTLE_MS - 1);
      expect(fn).not.toHaveBeenCalled();

      // Fires exactly once at the derived delay.
      jest.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);

      // Stays fired-once: no repeat / interval behavior.
      jest.advanceTimersByTime(DEFER_SETTLE_MS * 3);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
