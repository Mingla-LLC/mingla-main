import { describe, expect, it, jest } from "@jest/globals";

/**
 * issue #1350 — TESTER ADVERSARIAL regression (different axis than the
 * implementor's source-grep in `coverPickerVideoTrimEditor.keyframeCopy.issue1350.test.ts`).
 *
 * The implementor's test asserts the SOURCE STRING `enablePreciseTrimming: false`
 * is present (and `: true` is absent). That is a static-text check: it would be
 * fooled by a computed/aliased value (`enablePreciseTrimming: RE_ENCODE` where
 * `RE_ENCODE = true`), by whitespace/formatting drift, or by the flag being
 * moved behind a helper.
 *
 * This test attacks the RUNTIME instead. It drives `trimVideoWithDedicatedEditor`
 * with a mocked native `react-native-video-trim` and captures the ACTUAL options
 * object handed to the native `showEditor(uri, options)`. It then asserts the
 * live value is `false` — a keyframe stream-copy (`-c copy`), never a precise
 * re-encode (the slow iOS path + the Android `h264_mediacodec` "rc 1" failure).
 *
 * fails-on-revert: restoring Fix B (`enablePreciseTrimming: true`) makes
 * `options.enablePreciseTrimming` resolve to `true` at runtime, so
 * `expect(options.enablePreciseTrimming).toBe(false)` fails here even if the
 * source spelling is changed to something a grep would miss.
 *
 * Also re-asserts the orch-0978 C1 duration-cap forwarding at runtime (the cap
 * MUST survive alongside the flip), and that the save/cancel button labels are
 * the pinned copy.
 */

const showEditorSpy =
  jest.fn<(uri: string, options: Record<string, unknown>) => void>();

// A minimal native VideoTrim stub. `onShow` is intentionally OMITTED so the
// source never arms its 2.5s presentation watchdog timer — the returned promise
// simply stays pending (no callback fires), which is fine: `showEditor` is
// invoked synchronously inside the Promise executor, so the capture is complete
// the instant `trimVideoWithDedicatedEditor(...)` returns.
const subscription = { remove: jest.fn() };
jest.mock("react-native-video-trim", () => ({
  __esModule: true,
  default: {
    onFinishTrimming: jest.fn(() => subscription),
    onCancelTrimming: jest.fn(() => subscription),
    onCancel: jest.fn(() => subscription),
    onError: jest.fn(() => subscription),
  },
  showEditor: (uri: string, options: Record<string, unknown>) =>
    showEditorSpy(uri, options),
}));

// eslint-disable-next-line import/first
import { trimVideoWithDedicatedEditor } from "../coverPickerVideoTrimEditor";

describe("cover trim editor — RUNTIME stream-copy options (issue #1350, tester adversarial)", () => {
  it("T-1350-TESTER-01 hands the native editor enablePreciseTrimming:false at RUNTIME", () => {
    showEditorSpy.mockClear();

    // Fire-and-forget: the promise never settles (no native callback fires in
    // this stub), but showEditor is called synchronously during the invocation.
    void trimVideoWithDedicatedEditor("file:///tmp/source.mp4", 29_000);

    expect(showEditorSpy).toHaveBeenCalledTimes(1);
    const [uri, options] = showEditorSpy.mock.calls[0]!;

    expect(uri).toBe("file:///tmp/source.mp4");
    // THE headline invariant, checked against the LIVE value (not the source
    // text): a keyframe stream-copy, never a precise/frame-accurate re-encode.
    expect(options.enablePreciseTrimming).toBe(false);
    expect(options.enablePreciseTrimming).not.toBe(true);
  });

  it("T-1350-TESTER-02 still forwards the orch-0978 C1 duration cap + pinned button labels at RUNTIME", () => {
    showEditorSpy.mockClear();

    void trimVideoWithDedicatedEditor("file:///tmp/other.mp4", 12_345);

    expect(showEditorSpy).toHaveBeenCalledTimes(1);
    const [, options] = showEditorSpy.mock.calls[0]!;

    // The duration cap the caller passes MUST reach the native editor verbatim.
    expect(options.maxDuration).toBe(12_345);
    // Pinned copy (orch-0978 C1) — the flip must not have disturbed these.
    expect(options.saveButtonText).toBe("Use clip");
    expect(options.cancelButtonText).toBe("Back");
  });
});
