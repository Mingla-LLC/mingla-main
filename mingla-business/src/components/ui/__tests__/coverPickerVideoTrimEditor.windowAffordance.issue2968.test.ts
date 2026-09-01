import { describe, expect, it, jest } from "@jest/globals";

/**
 * issue #2968 [trim window affordance] — implementor happy-path regression.
 *
 * WHAT WAS ACTUALLY WRONG (runtime verdict on the issue, iOS 26.5, 45s clip):
 * the trim window is NOT broken. Dragging the BODY of the selection box moved it
 * 00:00.000–00:15.000 → 00:21.433–00:36.433, frame-precise and still exactly
 * 15.000s wide. `enablePreciseTrimming: false` is NOT the cause and must stay
 * false (#1350 — it avoids the h264 re-encode behind the Android
 * `h264_mediacodec` "rc 1" export failure).
 *
 * The defect is DISCOVERABILITY. Reading the shipped native sources of
 * `react-native-video-trim@8.1.0`:
 *   - iOS `VideoTrimmer.swift:470-474` arms the body range-drag on a
 *     UILongPressGestureRecognizer at its DEFAULT 0.5s press duration, while the
 *     two chevron grabbers set `minimumPressDuration = 0`.
 *   - Android `VideoTrimmerView.kt:247-252` arms the same range-drag from
 *     `GestureDetector.SimpleOnGestureListener.onLongPress`.
 * So a plain swipe on the body does nothing on EITHER platform — the user must
 * press and hold first. Only the chevrons look grabbable, and they no-op once
 * maxDuration is reached. Hence "the trimmer cannot be moved".
 *
 * `EditorConfig` cannot draw a grip on the window body, so the fix is the config
 * this suite pins: name the hidden gesture + the cap in the header line, brand
 * the window, keep the at-cap clamp haptic, and replace the library's
 * untranslated dialog defaults ("Confirmation!" / "Are you sure want to save?")
 * with Mingla copy.
 *
 * This attacks the RUNTIME options object rather than the source text, so it
 * cannot be satisfied by a comment or a differently-spelled constant.
 *
 * fails-on-revert: deleting any of the `headerText` / `trimmerColor` /
 * `enableHapticFeedback` / `saveDialog*` lines from the `showEditor(uri, {...})`
 * block makes the corresponding assertion resolve `undefined` and fails here.
 */

const showEditorSpy =
  jest.fn<(uri: string, options: Record<string, unknown>) => void>();

// Minimal native VideoTrim stub. `onShow` is intentionally OMITTED so the source
// never arms its 2.5s presentation watchdog (#1338) — the returned promise just
// stays pending, which is fine: `showEditor` is invoked synchronously inside the
// Promise executor, so the capture is complete the instant the call returns.
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
import { accent, colors } from "../../../constants/designSystem";
// eslint-disable-next-line import/first
import { trimVideoWithDedicatedEditor } from "../coverPickerVideoTrimEditor";

const captureOptions = (maxDurationMs: number): Record<string, unknown> => {
  showEditorSpy.mockClear();
  void trimVideoWithDedicatedEditor("file:///tmp/source.mp4", maxDurationMs);
  expect(showEditorSpy).toHaveBeenCalledTimes(1);
  return showEditorSpy.mock.calls[0]![1];
};

describe("cover trim editor — window affordance + Mingla dialog copy (issue #2968)", () => {
  it("T-2968-01 the header line names the hidden press-and-hold gesture", () => {
    const options = captureOptions(15_000);
    const headerText = options.headerText;

    expect(typeof headerText).toBe("string");
    // The body drag is a LONG PRESS on both platforms. A hint that only said
    // "drag the middle" would leave the user exactly as stuck as before, so the
    // hold is the non-negotiable half of this copy.
    expect(headerText).toMatch(/hold/i);
    expect(headerText).toMatch(/slide/i);
    // The header label is single-line inside a horizontal scroll view (iOS
    // VideoTrimmerViewController.swift:329 `numberOfLines = 1`); anything long
    // is pushed off-screen and silently unread.
    expect((headerText as string).length).toBeLessThanOrEqual(48);
    expect(options.headerTextSize).toBe(14);
    expect(options.headerTextColor).toBe(colors.text.inverse);
  });

  it("T-2968-02 the header states the cap and is DERIVED from maxDuration, not hardcoded", () => {
    expect(captureOptions(15_000).headerText).toContain("15s max");
    // A hardcoded "15s" would still pass the line above. Changing the cap must
    // change the hint, or the editor can advertise a limit it does not enforce.
    expect(captureOptions(8_000).headerText).toContain("8s max");
    expect(captureOptions(8_000).headerText).not.toContain("15s");
  });

  it("T-2968-03 the window is branded so the draggable frame reads as a Mingla control", () => {
    const options = captureOptions(15_000);
    // `trimmerColor` paints the WHOLE frame — leading + trailing + top + bottom
    // (iOS VideoTrimmerThumb.updateTrimmerColor), i.e. the press-and-hold
    // surface, not just the chevrons.
    expect(options.trimmerColor).toBe(accent.warm);
    expect(options.trimmerColor).not.toBe("#f1d247"); // library default chrome
    expect(options.handleIconColor).toBe(colors.text.primary);
  });

  it("T-2968-04 at-cap clamp feedback stays armed", () => {
    // The only "this handle will not go further" signal the library emits is a
    // heavy impact haptic on the clamp transition (iOS VideoTrimmer.swift
    // 1019-1022 / 1078-1081). Pinned explicitly so a library default flip
    // cannot silently remove it.
    expect(captureOptions(15_000).enableHapticFeedback).toBe(true);
  });

  it("T-2968-05 the save dialog is Mingla copy, not the library's ungrammatical default", () => {
    const options = captureOptions(15_000);

    expect(options.saveDialogTitle).toBe("Use this clip?");
    expect(options.saveDialogMessage).toBe(
      "We'll cut your video down to the part inside the box and use it as your cover.",
    );
    expect(options.saveDialogCancelText).toBe("Keep trimming");
    expect(options.saveDialogConfirmText).toBe("Use clip");

    // The exact shipped defaults that reached users (lib/module/index.js:84-88).
    expect(options.saveDialogTitle).not.toBe("Confirmation!");
    expect(options.saveDialogMessage).not.toBe("Are you sure want to save?");
    expect(options.saveDialogCancelText).not.toBe("Close");
    expect(options.saveDialogConfirmText).not.toBe("Proceed");
  });

  it("T-2968-06 the cancel dialogs on the same screen carry Mingla copy too", () => {
    const options = captureOptions(15_000);

    expect(options.cancelDialogTitle).toBe("Leave without a cover?");
    expect(options.cancelDialogCancelText).toBe("Keep trimming");
    expect(options.cancelDialogConfirmText).toBe("Discard");
    expect(options.cancelTrimmingDialogTitle).toBe("Stop trimming?");
    expect(options.cancelTrimmingDialogCancelText).toBe("Keep going");
    expect(options.cancelTrimmingDialogConfirmText).toBe("Stop");

    // No "Warning!" / "Are you sure want to cancel?" / Close / Proceed left.
    for (const key of [
      "cancelDialogTitle",
      "cancelDialogMessage",
      "cancelDialogCancelText",
      "cancelDialogConfirmText",
      "cancelTrimmingDialogTitle",
      "cancelTrimmingDialogMessage",
      "cancelTrimmingDialogCancelText",
      "cancelTrimmingDialogConfirmText",
    ]) {
      expect(options[key]).toEqual(expect.any(String));
      expect(options[key]).not.toMatch(/^(Warning!|Close|Proceed)$/);
      expect(options[key]).not.toMatch(/Are you sure want to/);
    }
  });

  it("T-2968-07 the affordance pass did NOT disturb the pinned #1350 / orch-0978 contracts", () => {
    const options = captureOptions(15_000);

    // #1350: keyframe stream-copy, never a precise re-encode. Proven at runtime
    // in the #2968 pass NOT to be the cause of the reported symptom.
    expect(options.enablePreciseTrimming).toBe(false);
    // orch-0978 C1: the caller's cap reaches the native editor verbatim.
    expect(options.maxDuration).toBe(15_000);
    expect(options.saveButtonText).toBe("Use clip");
    expect(options.cancelButtonText).toBe("Back");
  });
});
