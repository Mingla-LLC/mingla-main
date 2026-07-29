import { afterEach, describe, expect, jest, test } from "@jest/globals";

/**
 * issue #1338 — TESTER ADVERSARIAL regression (settle-once / cancel-vs-failure).
 *
 * DIFFERENT AXIS from the implementor's happy-path watchdog tests
 * (coverPickerVideoTrimEditor.presentWatchdog.issue1338.test.ts):
 *   - Implementor T-1338-05: never-presents -> rejects (single, no trailing native event).
 *   - Implementor T-1338-06: onShow -> long wait -> onCancel -> resolves null.
 *
 * Neither fires a native callback AFTER the watchdog has already fired, and
 * neither exercises a genuine trim FAILURE that arrives AFTER the editor
 * presented (the Samsung `rc 1 / TRIMMING_FAILED` seam observed in the #1338
 * investigation). This file attacks exactly those two untested seams:
 *
 *   T-ADV-1338-A (fails-on-revert): editor never presents -> watchdog rejects
 *     with the presentation-failed message; then a LATE native onError arrives.
 *     The promise must stay settled with the SAME watchdog message, the late
 *     callback must not throw, and `settle` must run exactly once (no
 *     double-settle -> no second reject, no subscription re-teardown).
 *     Reverting the watchdog (coverPickerVideoTrimEditor.ts §issue #1338 block)
 *     makes this HANG-then-timeout (nothing rejects on the timer) OR reject with
 *     the late TRIMMING error instead of the watchdog message -> FAILS.
 *
 *   T-ADV-1338-B (cancel-vs-failure after present): onShow disarms the watchdog;
 *     advancing FAR past the window fires no spurious reject; a subsequent
 *     onError must REJECT with the real trim error (NOT resolve null, NOT the
 *     "trim screen didn't open" presentation message). Guards the invariant that
 *     a post-present failure is surfaced as a failure, never swallowed as a
 *     cancel or mislabeled as a presentation failure.
 *
 * Mock models the existing T-SUBE-TRIM-02 / presentWatchdog doMock pattern.
 */

type Cb = (arg?: unknown) => void;

interface Captured {
  onShow?: Cb;
  onCancel?: Cb;
  onCancelTrimming?: Cb;
  onError?: Cb;
  onFinishTrimming?: Cb;
}

const installMock = (
  captured: Captured,
  remove: () => void,
): void => {
  jest.doMock("react-native-video-trim", () => ({
    __esModule: true,
    default: {
      onShow: (cb: Cb) => {
        captured.onShow = cb;
        return { remove };
      },
      onCancel: (cb: Cb) => {
        captured.onCancel = cb;
        return { remove };
      },
      onCancelTrimming: (cb: Cb) => {
        captured.onCancelTrimming = cb;
        return { remove };
      },
      onError: (cb: Cb) => {
        captured.onError = cb;
        return { remove };
      },
      onFinishTrimming: (cb: Cb) => {
        captured.onFinishTrimming = cb;
        return { remove };
      },
    },
    showEditor: jest.fn(),
  }));
};

afterEach(() => {
  jest.dontMock("react-native-video-trim");
  jest.resetModules();
  jest.useRealTimers();
});

describe("coverPickerVideoTrimEditor — settle-once / cancel-vs-failure (issue #1338 tester adversarial)", () => {
  test("T-ADV-1338-A a native callback AFTER the watchdog fires never double-settles or overrides the reason", async () => {
    const captured: Captured = {};
    const remove = jest.fn();
    installMock(captured, remove);

    const editorModule = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const promise = editorModule.trimVideoWithDedicatedEditor(
      "file:///never-presents.mov",
      29_000,
    );
    // Attach BEFORE advancing so there is no unhandled rejection window.
    const expectation = expect(promise).rejects.toThrow(
      "The trim screen didn't open",
    );
    // Editor never presents -> watchdog must reject at the bounded window.
    jest.advanceTimersByTime(2_500);
    await expectation;

    // Subscriptions were torn down exactly once by the single settle.
    const removeCallsAfterWatchdog = remove.mock.calls.length;
    expect(removeCallsAfterWatchdog).toBeGreaterThan(0);

    // A LATE native error now arrives (real hardware fires callbacks async, and
    // an already-refused present can still surface an error). It must be inert.
    expect(() =>
      captured.onError?.({
        errorCode: "TRIMMING_FAILED",
        message: "Command failed with state COMPLETED and rc 1.null",
      }),
    ).not.toThrow();

    // Idempotent settle: the late callback added ZERO new teardown/settle work.
    expect(remove.mock.calls.length).toBe(removeCallsAfterWatchdog);

    // The settled reason is still the watchdog message, never the late error.
    await expect(promise).rejects.toThrow("The trim screen didn't open");
    await expect(promise).rejects.not.toThrow("TRIMMING_FAILED");
  });

  test("T-ADV-1338-B a trim failure AFTER the editor presents rejects with the real error (not null, not the present-failed message)", async () => {
    const captured: Captured = {};
    const remove = jest.fn();
    installMock(captured, remove);

    const editorModule = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const promise = editorModule.trimVideoWithDedicatedEditor(
      "file:///presents-then-fails.mov",
      29_000,
    );

    // Editor becomes visible -> watchdog disarmed.
    captured.onShow?.();
    // Far past the watchdog window: a disarmed watchdog must NOT fire a reject.
    jest.advanceTimersByTime(10_000);
    // The native export then fails (Samsung rc-1 seam) AFTER a real present.
    captured.onError?.({
      errorCode: "TRIMMING_FAILED",
      message: "Command failed with state COMPLETED and rc 1.null",
    });

    // Surfaced as the genuine failure — never the presentation-failed message,
    // never a silent resolve(null) cancel.
    await expect(promise).rejects.toThrow(
      "Video trim failed (TRIMMING_FAILED)",
    );
    await expect(promise).rejects.not.toThrow("The trim screen didn't open");
  });
});
