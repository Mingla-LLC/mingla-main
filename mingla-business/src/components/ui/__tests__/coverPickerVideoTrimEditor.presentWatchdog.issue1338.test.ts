import { afterEach, describe, expect, jest, test } from "@jest/globals";

/**
 * issue #1338 — presentation watchdog for the native trim editor.
 *
 * Root cause (proven on Seth's production iPhone via idevicesyslog): iOS New
 * Architecture silently refuses to present a 2nd native modal while the
 * CoverPickerSheet modal is up. `showEditor` then fires NO callback and the
 * trim promise would hang forever, pinning the picker's `uploading` state.
 *
 * The watchdog (coverPickerVideoTrimEditor.ts) guarantees the promise always
 * settles: it rejects if `onShow` never fires within the window, and is
 * disarmed the instant `onShow` confirms the editor is visible (so a legitimate,
 * arbitrarily-long trim session is never interrupted). These behavioral tests
 * model the mock on the existing T-SUBE-TRIM-02 doMock pattern.
 */

afterEach(() => {
  jest.dontMock("react-native-video-trim");
  jest.resetModules();
  jest.useRealTimers();
});

describe("coverPickerVideoTrimEditor presentation watchdog", () => {
  test("T-1338-05 rejects when the editor never presents (no onShow within the window)", async () => {
    const remove = jest.fn();
    // showEditor no-ops and NO callback (incl. onShow) ever fires — the exact
    // production failure where iOS refuses the modal present.
    jest.doMock("react-native-video-trim", () => ({
      __esModule: true,
      default: {
        onShow: () => ({ remove }),
        onCancel: () => ({ remove }),
        onCancelTrimming: () => ({ remove }),
        onError: () => ({ remove }),
        onFinishTrimming: () => ({ remove }),
      },
      showEditor: jest.fn(),
    }));

    const editorModule = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const promise = editorModule.trimVideoWithDedicatedEditor(
      "file:///clip.mov",
      29_000,
    );
    // Attach the rejection handler BEFORE advancing timers (no unhandled reject).
    const expectation = expect(promise).rejects.toThrow(
      "The trim screen didn't open",
    );
    // Advance past the bounded watchdog window (PRESENTATION_WATCHDOG_MS = 2500).
    jest.advanceTimersByTime(2_500);
    await expectation;
  });

  test("T-1338-06 resolves null (no spurious reject) when onShow fires then the user cancels", async () => {
    const remove = jest.fn();
    const callbacks: {
      onShow?: () => void;
      onCancel?: () => void;
    } = {};
    // onShow registers the "editor is visible" signal; onCancel the user Back.
    jest.doMock("react-native-video-trim", () => ({
      __esModule: true,
      default: {
        onShow: (cb: () => void) => {
          callbacks.onShow = cb;
          return { remove };
        },
        onCancel: (cb: () => void) => {
          callbacks.onCancel = cb;
          return { remove };
        },
        onCancelTrimming: () => ({ remove }),
        onError: () => ({ remove }),
        onFinishTrimming: () => ({ remove }),
      },
      showEditor: jest.fn(),
    }));

    const editorModule = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const promise = editorModule.trimVideoWithDedicatedEditor(
      "file:///clip.mov",
      29_000,
    );

    // Editor becomes visible → watchdog must be disarmed.
    callbacks.onShow?.();
    // Advance FAR past the watchdog window — a disarmed watchdog must NOT fire.
    jest.advanceTimersByTime(10_000);
    // The user then trims for a while and presses Back → genuine cancel.
    callbacks.onCancel?.();

    await expect(promise).resolves.toBeNull();
  });
});
