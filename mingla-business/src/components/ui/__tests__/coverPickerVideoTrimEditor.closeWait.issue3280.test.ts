/**
 * #3280 (defect 1) — the picker must wait for the native trim editor to finish
 * DISMISSING before its sheet closes for a fresh one.
 *
 * `react-native-video-trim` sends its finish/cancel event to JavaScript first,
 * then dismisses its progress alert and itself (VideoTrim.swift: the
 * `onFinishTrimming` emit precedes `progressAlert.dismiss` → `closeEditor`,
 * whose completion emits `onHide`). Closing the sheet's native modal while the
 * editor is still on top of it would dismiss the editor instead and strand the
 * sheet (facebook/react-native#55005).
 *
 * Fails on revert of coverPickerVideoTrimEditor.ts: `waitForTrimEditorToClose`
 * does not exist / resolves before `onHide`.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type Emitters = {
  onShow?: () => void;
  onHide?: () => void;
  onFinishTrimming?: (payload: unknown) => void;
  onCancel?: () => void;
};

const mockTrimModule = (emitters: Emitters, withHide = true): jest.Mock => {
  const showEditor = jest.fn();
  const subscribe = (name: keyof Emitters) => (cb: never) => {
    emitters[name] = cb;
    return { remove: () => undefined };
  };
  jest.doMock("react-native-video-trim", () => ({
    __esModule: true,
    default: {
      onShow: subscribe("onShow"),
      ...(withHide ? { onHide: subscribe("onHide") } : {}),
      onCancel: subscribe("onCancel"),
      onCancelTrimming: () => ({ remove: () => undefined }),
      onError: () => ({ remove: () => undefined }),
      onFinishTrimming: subscribe("onFinishTrimming"),
    },
    showEditor,
  }));
  return showEditor;
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

afterEach(() => {
  jest.dontMock("react-native-video-trim");
  jest.resetModules();
  jest.useRealTimers();
});

describe("#3280 — waitForTrimEditorToClose", () => {
  test("waits past the finish event until the editor reports it has hidden", async () => {
    const emitters: Emitters = {};
    mockTrimModule(emitters);
    const editor = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const trim = editor.trimVideoWithDedicatedEditor("file:///clip.mov", 15_000);
    emitters.onShow?.();
    emitters.onFinishTrimming?.({ outputPath: "/out.mp4", startTime: 0, endTime: 15_000, duration: 40_000 });
    await expect(trim).resolves.toEqual(expect.objectContaining({ outputPath: "/out.mp4" }));

    let closed = false;
    void editor.waitForTrimEditorToClose().then(() => {
      closed = true;
    });
    await flush();
    jest.advanceTimersByTime(editor.TRIM_EDITOR_CLOSE_WAIT_MS - 1);
    await flush();
    // Finished, but still dismissing: not closed yet.
    expect(closed).toBe(false);

    emitters.onHide?.();
    await flush();
    expect(closed).toBe(true);
  });

  test("a cancel also waits for the editor to hide", async () => {
    const emitters: Emitters = {};
    mockTrimModule(emitters);
    const editor = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const trim = editor.trimVideoWithDedicatedEditor("file:///clip.mov", 15_000);
    emitters.onShow?.();
    emitters.onCancel?.();
    await expect(trim).resolves.toBeNull();

    let closed = false;
    void editor.waitForTrimEditorToClose().then(() => {
      closed = true;
    });
    await flush();
    expect(closed).toBe(false);
    emitters.onHide?.();
    await flush();
    expect(closed).toBe(true);
  });

  test("a build without onHide stops waiting after the bound", async () => {
    const emitters: Emitters = {};
    mockTrimModule(emitters, false);
    const editor = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const trim = editor.trimVideoWithDedicatedEditor("file:///clip.mov", 15_000);
    emitters.onShow?.();
    emitters.onFinishTrimming?.({ outputPath: "/out.mp4", startTime: 0, endTime: 15_000, duration: 40_000 });
    await trim;

    let closed = false;
    void editor.waitForTrimEditorToClose().then(() => {
      closed = true;
    });
    jest.advanceTimersByTime(editor.TRIM_EDITOR_CLOSE_WAIT_MS - 1);
    await flush();
    expect(closed).toBe(false);
    jest.advanceTimersByTime(1);
    await flush();
    expect(closed).toBe(true);
  });

  test("an editor that never presented has nothing to wait for", async () => {
    const emitters: Emitters = {};
    mockTrimModule(emitters);
    const editor = await import("../coverPickerVideoTrimEditor");
    jest.useFakeTimers();

    const trim = editor.trimVideoWithDedicatedEditor("file:///clip.mov", 15_000);
    const rejected = expect(trim).rejects.toThrow("The trim screen didn't open");
    jest.advanceTimersByTime(2_500);
    await rejected;

    let closed = false;
    void editor.waitForTrimEditorToClose().then(() => {
      closed = true;
    });
    await flush();
    expect(closed).toBe(true);
  });
});
