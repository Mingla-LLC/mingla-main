/**
 * Issue #3073 — the cover sheet's feedback during a video cover, as a host saw
 * it on 2026-09-17 (iOS Simulator, RSVP creator, Step 4 Cover):
 *
 *   - picking a VIDEO spun the IMAGE button. `uploading` is shared by both
 *     flows and the Image button's spinner read it directly;
 *   - one failed video said the same sentence three times: in the status card
 *     (with Try again / Discard upload), again in red under the buttons, and as
 *     an "Upload failed - try again" button.
 *
 * The REAL CoverPicker is mounted (react-test-renderer); only boundaries are
 * mocked — the native pickers, the video upload hook, network services and
 * leaf UI (Button is a host element, so its `loading` prop is readable).
 *
 * Fails on revert:
 *   - `spinning={uploading}` -> the video-pick test sees the Image button
 *     loading and the Video button not;
 *   - the unconditional `videoErrorMessage` row -> the error test counts the
 *     message twice and finds the "Upload failed - try again" button.
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

type Stage = { phase: string; percent: number; code?: string; message?: string };
type PickResult = { canceled: boolean; assets: Array<Record<string, unknown>> };

const harness: {
  start: jest.Mock;
  setStage: (stage: Stage) => void;
  imagePick: Deferred<PickResult>;
  videoPick: Deferred<PickResult>;
} = {
  start: jest.fn(),
  setStage: () => undefined,
  imagePick: deferred<PickResult>(),
  videoPick: deferred<PickResult>(),
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
  launchCoverImagePicker: () => harness.imagePick.promise,
  launchCoverVideoPicker: () => harness.videoPick.promise,
  requestCoverMediaLibraryPermission: () => Promise.resolve({ granted: true }),
  revokeCoverPickedAssets: () => undefined,
}));
jest.mock("../coverPickerFileInfo", () => ({
  getCoverPickerFileInfoAsync: (uri: string) =>
    Promise.resolve({ exists: true, size: 1_097_262, uri }),
}));
jest.mock("../coverPickerElapsed", () => ({ useElapsedSince: () => null }));
jest.mock("../coverPickerVideoTrimEditor", () => ({
  trimVideoWithDedicatedEditor: () => Promise.resolve(null),
  waitForTrimEditorToClose: () => Promise.resolve(),
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
    // The real hook is covered by its own suites; here the test drives the
    // stage the sheet renders.
    useEventCoverVideoUpload: () => {
      const [stage, setStage] = ReactActual.useState({ phase: "idle", percent: 0 } as Stage);
      harness.setStage = setStage;
      return {
        acknowledgeApplied: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
        checkNow: () => Promise.resolve(),
        error: null,
        localPreviewUri: null,
        processedPosterUrl: null,
        processedUrl: null,
        replace: () => Promise.resolve(),
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

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<HostNode | string>;
};
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};

const props: CoverPickerProps = {
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
};

const mount = async (): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(<CoverPicker {...props} />);
  });
  await flush();
  return tree as Tree;
};

const buttons = (tree: Tree, label: string): HostNode[] =>
  tree.root.findAll((node) => node.type === "MockButton" && node.props.label === label);

const press = async (tree: Tree, label: string): Promise<void> => {
  const [button] = buttons(tree, label);
  expect(button).toBeDefined();
  await TestRenderer.act(async () => {
    (button.props.onPress as () => void)();
  });
  await flush();
};

const textOf = (node: HostNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const shownText = (tree: Tree): string =>
  tree.root.findAll((node) => node.type === "Text").map(textOf).join(" | ");
const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const SHORT_CLIP = {
  uri: "/var/mobile/cocktail.mov",
  duration: 13_613,
  fileSize: 90_538_799,
  fileName: "IMG_4412.MOV",
  mimeType: "video/quicktime",
};
const NO_PICTURE = "That clip came back without any video. Trim it again, or pick a different video.";

const originalOS = Platform.OS;

beforeEach(() => {
  harness.start = jest.fn(() => Promise.resolve());
  harness.setStage = () => undefined;
  harness.imagePick = deferred<PickResult>();
  harness.videoPick = deferred<PickResult>();
  (Platform as { OS: string }).OS = "ios";
});

afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
});

describe("#3073 — the spinner is on the button whose upload is running", () => {
  test("picking a video spins the Video button, never the Image button", async () => {
    const tree = await mount();
    await press(tree, "Video");

    // The iOS picker is still copying the clip: the cover is busy.
    const [image] = buttons(tree, "Image");
    const [video] = buttons(tree, "Video");
    expect(image.props.disabled).toBe(true);
    expect(video.props.disabled).toBe(true);
    expect(image.props.loading).toBe(false);
    expect(video.props.loading).toBe(true);

    await TestRenderer.act(async () => harness.videoPick.resolve({ canceled: true, assets: [] }));
    await flush();
    expect(buttons(tree, "Video")[0].props.loading).toBe(false);
    expect(buttons(tree, "Image")[0].props.loading).toBe(false);
    await TestRenderer.act(() => tree.unmount());
  });

  test("adversarial: picking an image still spins the Image button, and only it", async () => {
    const tree = await mount();
    await press(tree, "Image");

    expect(buttons(tree, "Image")[0].props.loading).toBe(true);
    expect(buttons(tree, "Video")[0].props.loading).toBe(false);

    await TestRenderer.act(async () => harness.imagePick.resolve({ canceled: true, assets: [] }));
    await flush();
    expect(buttons(tree, "Image")[0].props.loading).toBe(false);
    await TestRenderer.act(() => tree.unmount());
  });

  test("an image pick after a video pick spins Image again (the kind follows the latest pick)", async () => {
    const tree = await mount();
    await press(tree, "Video");
    await TestRenderer.act(async () => harness.videoPick.resolve({ canceled: true, assets: [] }));
    await flush();

    await press(tree, "Image");
    expect(buttons(tree, "Image")[0].props.loading).toBe(true);
    expect(buttons(tree, "Video")[0].props.loading).toBe(false);
    await TestRenderer.act(async () => harness.imagePick.resolve({ canceled: true, assets: [] }));
    await flush();
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3073 — a failed video says so once, with one retry", () => {
  const failAfterPick = async (): Promise<Tree> => {
    const tree = await mount();
    await press(tree, "Video");
    await TestRenderer.act(async () => harness.videoPick.resolve({ canceled: false, assets: [SHORT_CLIP] }));
    await flush();
    // The clip was handed to the upload (so a retry has something to retry)...
    expect(harness.start).toHaveBeenCalledTimes(1);
    // ...and the upload failed.
    await TestRenderer.act(async () =>
      harness.setStage({ phase: "error", percent: 0, code: "video_upload_failed", message: NO_PICTURE }),
    );
    await flush();
    return tree;
  };

  test("the message appears exactly once and the only retry is the card's Try again", async () => {
    const tree = await failAfterPick();
    const text = shownText(tree);

    expect(occurrences(text, NO_PICTURE)).toBe(1);
    expect(text).toContain("We couldn’t finish this video");
    expect(buttons(tree, "Try again")).toHaveLength(1);
    expect(buttons(tree, "Upload failed - try again")).toHaveLength(0);
    // Discard stays reachable (#2974).
    expect(buttons(tree, "Discard upload")).toHaveLength(1);
    await TestRenderer.act(() => tree.unmount());
  });

  test("Try again retries the same clip", async () => {
    const tree = await failAfterPick();
    await press(tree, "Try again");

    expect(harness.start).toHaveBeenCalledTimes(2);
    expect(harness.start.mock.calls[1][0]).toEqual(harness.start.mock.calls[0][0]);
    await TestRenderer.act(() => tree.unmount());
  });

  test("adversarial: the cover buttons come back after the failure so another clip can be picked", async () => {
    const tree = await failAfterPick();

    expect(buttons(tree, "Video")).toHaveLength(1);
    expect(buttons(tree, "Video")[0].props.disabled).toBe(false);
    expect(buttons(tree, "Video")[0].props.loading).toBe(false);
    expect(buttons(tree, "Image")[0].props.loading).toBe(false);
    await TestRenderer.act(() => tree.unmount());
  });
});
