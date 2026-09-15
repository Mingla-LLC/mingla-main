/**
 * #3280 (defect 1) — a finished video cover never showed in the already-open
 * cover sheet when the clip had gone through the native trim editor.
 *
 * The open sheet's JavaScript did everything right (upload, processing,
 * applied, draft saved), but the sheet is a native iOS modal and the trim editor
 * had been stacked on top of it; the result never reached the screen until the
 * organiser closed and reopened the sheet. The clip that rendered correctly
 * never went through the editor.
 *
 * The fix: once the editor has been shown (iOS), the picker does NOT carry on in
 * that native window. It waits for the editor to finish dismissing, then hands
 * its outcome to the sheet, and a FRESH picker starts the upload once its own
 * reconnect has settled — the path a host takes when they open the sheet and
 * pick a short clip.
 *
 * The REAL CoverPicker is mounted (react-test-renderer, default node/ts-jest
 * project). Only boundaries are mocked: the native pickers, the trim editor, the
 * video upload hook, network services and leaf UI.
 *
 * Fails on revert:
 *   - CoverPicker starting the upload in place after the editor -> the hand-off
 *     tests see `start` called and no carry;
 *   - the hand-off not waiting for the editor to close -> the ordering test
 *     sees the carry before the editor has dismissed;
 *   - the fresh picker not continuing (or continuing during the reconnect, or
 *     twice) -> the continuation tests go red.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

type Stage = { phase: string; percent: number };

const harness: {
  start: jest.Mock;
  replace: jest.Mock;
  finishReattach: () => void;
  trimResult: unknown;
  trimError: Error | null;
  editorClosed: Deferred<void>;
  editorCloseCalls: number;
  pickedDurationMs: number;
} = {
  start: jest.fn(),
  replace: jest.fn(),
  finishReattach: () => undefined,
  trimResult: null,
  trimError: null,
  editorClosed: deferred<void>(),
  editorCloseCalls: 0,
  pickedDurationMs: 40_000,
};

jest.mock("expo-haptics", () => ({
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Warning: "warning" },
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactActual = require("react");
  return {
    ScrollView: ({ children }: { children?: unknown }) =>
      ReactActual.createElement("MockScroll", null, children),
  };
});
jest.mock("../coverPickerDeviceMedia", () => ({
  launchCoverImagePicker: () => Promise.resolve({ canceled: true, assets: [] }),
  launchCoverVideoPicker: () =>
    Promise.resolve({
      canceled: false,
      assets: [
        {
          uri: "/var/mobile/picked-clip.mov",
          duration: harness.pickedDurationMs,
          fileSize: 48_000_000,
          fileName: "picked-clip.mov",
          mimeType: "video/quicktime",
        },
      ],
    }),
  requestCoverMediaLibraryPermission: () => Promise.resolve({ granted: true }),
  revokeCoverPickedAssets: () => undefined,
}));
jest.mock("../coverPickerFileInfo", () => ({
  getCoverPickerFileInfoAsync: (uri: string) =>
    Promise.resolve({ exists: true, size: 1_097_262, uri }),
}));
jest.mock("../coverPickerElapsed", () => ({ useElapsedSince: () => null }));
jest.mock("../coverPickerVideoTrimEditor", () => ({
  trimVideoWithDedicatedEditor: () =>
    harness.trimError !== null ? Promise.reject(harness.trimError) : Promise.resolve(harness.trimResult),
  waitForTrimEditorToClose: () => {
    harness.editorCloseCalls += 1;
    return harness.editorClosed.promise;
  },
}));
jest.mock("../../../services/eventCoverMediaService", () => ({
  EventCoverMediaError: class EventCoverMediaError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  EVENT_COVER_MAX_BYTES: 30 * 1024 * 1024,
  EVENT_COVER_UPLOAD_LIMIT_COPY: "Up to 30 MB.",
  uploadEventCoverMedia: () => Promise.reject(new Error("not used")),
}));
jest.mock("../../../services/eventCoverVideoProcessingService", () => ({
  EVENT_COVER_MAX_VIDEO_DURATION_MS: 15_000,
  EVENT_COVER_SOURCE_CEILING_MS: 15_000,
  EVENT_COVER_VIDEO_PROCESSING_COPY: "Videos are processed for every screen.",
}));
jest.mock("../../../hooks/useEventCoverVideoUpload", () => {
  const ReactActual = require("react");
  return {
    // Mirrors the real hook's mount effect: it enters "reattaching" at once and
    // leaves it when its reconnect settles (the test decides when).
    useEventCoverVideoUpload: () => {
      const [stage, setStage] = ReactActual.useState({ phase: "idle", percent: 0 } as Stage);
      ReactActual.useEffect(() => {
        setStage({ phase: "reattaching", percent: 0 });
        harness.finishReattach = () => setStage({ phase: "idle", percent: 0 });
      }, []);
      return {
        acknowledgeApplied: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
        checkNow: () => Promise.resolve(),
        error: null,
        localPreviewUri: null,
        processedPosterUrl: null,
        processedUrl: null,
        replace: harness.replace,
        resume: () => Promise.resolve(),
        stage,
        start: harness.start,
        status: null,
      };
    },
  };
});
jest.mock("../../../services/giphyEventCoverService", () => ({
  searchGiphyEventCovers: () => Promise.resolve([]),
}));
jest.mock("../../../services/pexelsEventCoverService", () => ({
  searchPexelsEventCovers: () => Promise.resolve({ results: [] }),
}));
jest.mock("../../../services/coverProviderBrowseService", () => ({
  curatedPexelsCovers: () => Promise.resolve({ results: [] }),
  trendingGiphyCovers: () => Promise.resolve([]),
}));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: () => undefined }));
jest.mock("../../../hooks/useBrandCoverUpload", () => ({
  useBrandCoverUpload: () => ({ uploadCover: () => Promise.resolve(null) }),
}));
jest.mock("../../../services/coverGifPoster", () => ({
  extractCoverGifPoster: () => Promise.resolve(null),
}));
jest.mock("../../../services/brandCoverService", () => ({
  coverFromProviderRef: () => null,
  uploadBrandCover: () => Promise.reject(new Error("not used")),
}));
jest.mock("../../../services/storageUploadWithRetry", () => ({
  createStorageUploadWithRetry: () => () => Promise.reject(new Error("not used")),
  STORAGE_UPLOAD_MAX_TIMEOUT_MS: 90_000,
  storageUploadTimeoutMs: () => 20_000,
}));
jest.mock("../coverPickerGalleryTelemetry", () => ({ reportGalleryAddFailure: () => undefined }));
jest.mock("../Button", () => {
  const ReactActual = require("react");
  return {
    Button: (props: Record<string, unknown>) => ReactActual.createElement("MockButton", props),
  };
});
jest.mock("../Icon", () => ({ Icon: (): null => null }));
jest.mock("../EventCoverMedia", () => ({ EventCoverMedia: (): null => null }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));

// eslint-disable-next-line import/first
import { Platform } from "react-native";
// eslint-disable-next-line import/first
import { CoverPicker, type CoverPickerProps } from "../CoverPicker";
// eslint-disable-next-line import/first
import type { NativeEditorCarry } from "../coverPickerNativeEditorReturn";

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<HostNode | string>;
};
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const TRIMMED = { outputPath: "/Documents/trimmedVideo_1.mp4", startTime: 0, endTime: 15_000, duration: 40_000 };

const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};

// The picker waits ~300 ms (real timers) for the OS photo picker to dismiss
// before it presents the trim editor; poll until the flow reaches its next step.
const until = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition not reached in time");
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  await flush();
};

const baseProps = (overrides: Partial<CoverPickerProps> = {}): CoverPickerProps => ({
  target: {
    kind: "event",
    brandId: "brand-1",
    eventRowId: "7b0b6f0e-0000-4000-8000-000000000001",
    coverMediaApplyMode: "draft_auto",
  },
  initialMediaUrl: null,
  initialMediaType: null,
  initialProvider: null,
  initialSourceUrl: null,
  initialCredit: null,
  initialCreditUrl: null,
  initialAlt: null,
  onCoverChange: () => undefined,
  onShowToast: () => undefined,
  ...overrides,
});

const mount = async (props: CoverPickerProps): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(<CoverPicker {...props} />);
  });
  await flush();
  return tree as Tree;
};

const pressVideo = async (tree: Tree): Promise<void> => {
  const video = tree.root.findAll(
    (node) => node.type === "MockButton" && node.props.label === "Video",
  )[0];
  expect(video).toBeDefined();
  await TestRenderer.act(async () => {
    (video.props.onPress as () => void)();
  });
  await flush();
};

const textOf = (node: HostNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const shownText = (tree: Tree): string =>
  tree.root.findAll((node) => node.type === "Text").map(textOf).join(" | ");

const originalOS = Platform.OS;

beforeEach(() => {
  harness.start = jest.fn(() => Promise.resolve());
  harness.replace = jest.fn(() => Promise.resolve());
  harness.trimResult = TRIMMED;
  harness.trimError = null;
  harness.editorClosed = deferred<void>();
  harness.editorCloseCalls = 0;
  harness.pickedDurationMs = 40_000;
  (Platform as { OS: string }).OS = "ios";
});

afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
});

describe("#3280 — after the trim editor, the clip continues in a fresh sheet (iOS)", () => {
  test("the clip is handed to the sheet, not started inside the sheet the editor was stacked on", async () => {
    const onNativeEditorClosed = jest.fn<(carry: NativeEditorCarry) => void>();
    const tree = await mount(baseProps({ onNativeEditorClosed }));
    await TestRenderer.act(async () => harness.finishReattach());

    await pressVideo(tree);
    await until(() => harness.editorCloseCalls > 0);

    // The editor has not finished dismissing yet: nothing is handed over.
    expect(harness.editorCloseCalls).toBe(1);
    expect(onNativeEditorClosed).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();

    await TestRenderer.act(async () => harness.editorClosed.resolve());
    await flush();

    expect(onNativeEditorClosed).toHaveBeenCalledTimes(1);
    const carry = onNativeEditorClosed.mock.calls[0][0];
    expect(carry.upload).toEqual({
      file: expect.objectContaining({
        uri: "file:///Documents/trimmedVideo_1.mp4",
        durationMs: 15_000,
        bytes: 1_097_262,
      }),
      replacing: false,
    });
    expect(carry.notice).toBeNull();
    expect(carry.failedGalleryPhotos).toEqual([]);
    expect(carry.handedOffBy).not.toBeNull();
    // Never started in the old native window.
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.replace).not.toHaveBeenCalled();
    await TestRenderer.act(() => tree.unmount());
  });

  test("a cancelled trim hands its 'No video added' message to the fresh sheet", async () => {
    harness.trimResult = null;
    const onNativeEditorClosed = jest.fn<(carry: NativeEditorCarry) => void>();
    const tree = await mount(baseProps({ onNativeEditorClosed }));
    await TestRenderer.act(async () => harness.finishReattach());
    await pressVideo(tree);
    await until(() => harness.editorCloseCalls > 0);
    await TestRenderer.act(async () => harness.editorClosed.resolve());
    await flush();

    expect(onNativeEditorClosed).toHaveBeenCalledTimes(1);
    const carry = onNativeEditorClosed.mock.calls[0][0];
    expect(carry.upload).toBeNull();
    expect(carry.notice).toEqual({
      tone: "info",
      text: "No video added — trim to 15 seconds or pick a shorter clip.",
    });
    expect(harness.start).not.toHaveBeenCalled();
    await TestRenderer.act(() => tree.unmount());
  });

  test("a failed trim hands its error message over too", async () => {
    harness.trimError = new Error("The trim screen didn't open. Try again, or pick a shorter clip.");
    const onNativeEditorClosed = jest.fn<(carry: NativeEditorCarry) => void>();
    const tree = await mount(baseProps({ onNativeEditorClosed }));
    await TestRenderer.act(async () => harness.finishReattach());
    await pressVideo(tree);
    await until(() => harness.editorCloseCalls > 0);
    await TestRenderer.act(async () => harness.editorClosed.resolve());
    await flush();

    const carry = onNativeEditorClosed.mock.calls[0][0];
    expect(carry.notice).toEqual({
      tone: "error",
      text: "The trim screen didn't open. Try again, or pick a shorter clip.",
    });
    expect(carry.upload).toBeNull();
    await TestRenderer.act(() => tree.unmount());
  });

  test("a short clip never shows the editor, so it starts in place with no hand-off", async () => {
    harness.pickedDurationMs = 8_000;
    const onNativeEditorClosed = jest.fn<(carry: NativeEditorCarry) => void>();
    const tree = await mount(baseProps({ onNativeEditorClosed }));
    await TestRenderer.act(async () => harness.finishReattach());
    await pressVideo(tree);

    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(harness.editorCloseCalls).toBe(0);
    expect(onNativeEditorClosed).not.toHaveBeenCalled();
    await TestRenderer.act(() => tree.unmount());
  });

  test("Android keeps today's flow: the trimmed clip starts in place", async () => {
    (Platform as { OS: string }).OS = "android";
    const onNativeEditorClosed = jest.fn<(carry: NativeEditorCarry) => void>();
    const tree = await mount(baseProps({ onNativeEditorClosed }));
    await TestRenderer.act(async () => harness.finishReattach());
    await pressVideo(tree);
    await until(() => harness.start.mock.calls.length > 0);

    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(onNativeEditorClosed).not.toHaveBeenCalled();
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3280 — the fresh sheet continues from the hand-off", () => {
  const carryFor = (overrides: Partial<NativeEditorCarry> = {}): NativeEditorCarry => ({
    id: 9001,
    handedOffBy: {},
    notice: null,
    upload: {
      file: {
        uri: "file:///Documents/trimmedVideo_1.mp4",
        bytes: 1_097_262,
        durationMs: 15_000,
        fileName: "picked-clip.mov",
        mimeType: "video/quicktime",
        trimStartMs: 0,
        trimEndMs: 15_000,
      },
      replacing: false,
    },
    failedGalleryPhotos: [],
    ...overrides,
  });

  test("it starts the carried upload once its reconnect is over, exactly once, and tells the sheet", async () => {
    const carry = carryFor();
    const onResumeAfterNativeEditorConsumed = jest.fn<(id: number) => void>();
    const props = baseProps({ resumeAfterNativeEditor: carry, onResumeAfterNativeEditorConsumed });
    const tree = await mount(props);

    // Still reconnecting to any existing job: no upload yet.
    expect(harness.start).not.toHaveBeenCalled();
    expect(onResumeAfterNativeEditorConsumed).not.toHaveBeenCalled();

    await TestRenderer.act(async () => harness.finishReattach());
    await flush();

    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(harness.start).toHaveBeenCalledWith(carry.upload?.file);
    expect(harness.replace).not.toHaveBeenCalled();
    expect(onResumeAfterNativeEditorConsumed).toHaveBeenCalledWith(9001);

    // A re-render with the same carry never starts a second upload.
    await TestRenderer.act(() => tree.update(<CoverPicker {...props} />));
    await flush();
    expect(harness.start).toHaveBeenCalledTimes(1);
    await TestRenderer.act(() => tree.unmount());
  });

  test("a Replace hand-off replaces, and a message-only hand-off shows its message", async () => {
    const replaceTree = await mount(
      baseProps({ resumeAfterNativeEditor: carryFor({ upload: { ...carryFor().upload!, replacing: true } }) }),
    );
    await TestRenderer.act(async () => harness.finishReattach());
    await flush();
    expect(harness.replace).toHaveBeenCalledTimes(1);
    expect(harness.start).not.toHaveBeenCalled();
    await TestRenderer.act(() => replaceTree.unmount());

    const noticeTree = await mount(
      baseProps({
        resumeAfterNativeEditor: carryFor({
          id: 9002,
          upload: null,
          notice: { tone: "info", text: "No video added — trim to 15 seconds or pick a shorter clip." },
        }),
      }),
    );
    // The notice row shows once the reconnect is over (as for any picker).
    await TestRenderer.act(async () => harness.finishReattach());
    await flush();
    expect(shownText(noticeTree)).toContain(
      "No video added — trim to 15 seconds or pick a shorter clip.",
    );
    await TestRenderer.act(() => noticeTree.unmount());
  });

  test("the picker that handed off never continues from its own hand-off", async () => {
    let captured: NativeEditorCarry | null = null;
    const props = baseProps({
      onNativeEditorClosed: (carry) => {
        captured = carry;
      },
    });
    const tree = await mount(props);
    await TestRenderer.act(async () => harness.finishReattach());
    await pressVideo(tree);
    await until(() => harness.editorCloseCalls > 0);
    await TestRenderer.act(async () => harness.editorClosed.resolve());
    await flush();
    expect(captured).not.toBeNull();

    await TestRenderer.act(() =>
      tree.update(<CoverPicker {...props} resumeAfterNativeEditor={captured} />),
    );
    await flush();
    expect(harness.start).not.toHaveBeenCalled();
    await TestRenderer.act(() => tree.unmount());
  });
});
