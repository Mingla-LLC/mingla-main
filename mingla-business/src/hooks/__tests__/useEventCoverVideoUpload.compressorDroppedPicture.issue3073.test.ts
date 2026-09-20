/**
 * Issue #3073 — two client-side dead ends on the cover-video preparation path,
 * both reproduced on the iOS 26.5 Simulator on 2026-09-17 with ordinary iPhone
 * clips (no job row was ever created for either).
 *
 * 1. "That clip came back without any video." `react-native-compressor` builds
 *    its H.264 writer input only when `AVAssetWriter.canApply` accepts its
 *    settings. The Simulator refuses `AVVideoAverageNonDroppableFrameRateKey`,
 *    so the exporter skipped the video track, exported the sound alone and
 *    RESOLVED. A 90 MB, 13.6 s clip came back as a 223 KB AAC-only MP4, the
 *    picture-less guard refused it, and "Try again" did the same thing again.
 *    Compression is an optimisation (#3128): when it produces no picture, the
 *    original is uploaded instead.
 *
 * 2. "Optimizing video…" forever. `cancel()` ("Discard upload") aborts the
 *    installed controller and leaves it installed. The next attempt that failed
 *    during preparation found that old aborted controller, took itself for
 *    cancelled, and returned without setting an error.
 *
 * Fails on revert:
 *   - drop the fallback in `startInternal` -> the fallback tests see
 *     `source_video_track_missing` and no upload intent;
 *   - restore `if (abortRef.current?.signal.aborted) return;` -> the
 *     after-discard test sees the sheet left without its error.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockStateSlots: unknown[] = [];
const mockRefSlots: Array<{ current: unknown }> = [];
let mockStateCursor = 0;
let mockRefCursor = 0;

jest.mock("react", () => ({
  useCallback: jest.fn((callback: unknown) => callback),
  useEffect: jest.fn(() => undefined),
  useMemo: jest.fn((factory: () => unknown) => factory()),
  useRef: jest.fn((initialValue: unknown) => {
    const index = mockRefCursor;
    mockRefCursor += 1;
    if (mockRefSlots[index] === undefined) mockRefSlots[index] = { current: initialValue };
    return mockRefSlots[index];
  }),
  useState: jest.fn((initialValue: unknown) => {
    const index = mockStateCursor;
    mockStateCursor += 1;
    if (mockStateSlots[index] === undefined) mockStateSlots[index] = initialValue;
    const setState = (nextValue: unknown): void => {
      mockStateSlots[index] = typeof nextValue === "function"
        ? (nextValue as (previous: unknown) => unknown)(mockStateSlots[index])
        : nextValue;
    };
    return [mockStateSlots[index], setState];
  }),
}));

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const compressVideoLocally = jest.fn<(input: unknown) => Promise<unknown>>();
const createEventCoverVideoUploadIntent = jest.fn<(input: unknown) => Promise<unknown>>();
const uploadEventCoverVideoSource = jest.fn(async () => null);
const acknowledgeEventCoverVideoSourceUploaded = jest.fn();
const waitForEventCoverVideoReady = jest.fn();
const fetchEventCoverVideoStatusByTarget = jest.fn(async () => null);

class MockEventCoverVideoProcessingError extends Error {
  readonly code: string;
  readonly lastStatus?: unknown;
  constructor(code: string, message: string, metadata?: { lastStatus?: unknown }) {
    super(message);
    this.name = "EventCoverVideoProcessingError";
    this.code = code;
    this.lastStatus = metadata?.lastStatus;
  }
}

jest.mock("../../services/eventCoverVideoProcessingService", () => ({
  acknowledgeEventCoverVideoSourceUploaded,
  applyEventCoverVideoJob: jest.fn(),
  cancelEventCoverVideoJob: jest.fn(),
  compressVideoLocally,
  createEventCoverVideoUploadIntent,
  EventCoverVideoProcessingError: MockEventCoverVideoProcessingError,
  fetchEventCoverVideoStatus: jest.fn(),
  fetchEventCoverVideoStatusByTarget,
  logEventCoverVideoUploadTelemetry: jest.fn(),
  uploadEventCoverVideoSource,
  waitForEventCoverVideoReady,
}));

const mockPersisted = new Map<string, unknown>();
jest.mock("../../services/eventCoverVideoJobPersistence", () => ({
  clearPersistedCoverVideoJobsForUser: jest.fn(),
  readPersistedCoverVideoJob: jest.fn(async (_userId: string, key: string) => mockPersisted.get(key) ?? null),
  removePersistedCoverVideoJob: jest.fn(async (_userId: string, key: string) => {
    mockPersisted.delete(key);
  }),
  writePersistedCoverVideoJob: jest.fn(async (job: { key: string }) => {
    mockPersisted.set(job.key, { ...job });
  }),
}));

type PrepareInput = {
  uri: string; bytes: number; durationMs: number;
  fileName?: string | null; mimeType?: string | null; operationId: string;
};
const prepareEventCoverVideoSource = jest.fn<(input: PrepareInput) => Promise<unknown>>();
jest.mock("../../services/eventCoverVideoPreparedSource", () => ({
  deletePreparedEventCoverVideoSource: jest.fn(async () => undefined),
  prepareEventCoverVideoSource,
}));

jest.mock("../../services/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-3073" } } } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  },
}));
jest.mock("../useBusinessEvents", () => ({
  businessEventKeys: { detail: (id: string) => ["e", id], list: (id: string) => ["es", id] },
}));
jest.mock("../useServerDraftEvents", () => ({
  eventDraftKeys: { detail: (id: string) => ["d", id], list: (id: string) => ["ds", id] },
}));
jest.mock("../usePublicEvents", () => ({ publicEventKeys: { detailById: (id: string) => ["p", id] } }));
jest.mock("../upcomingKeys", () => ({ upcomingKeys: { all: ["upcoming"] } }));
jest.mock("../useBrands", () => ({
  brandKeys: { detail: (id: string) => ["b", id], lists: () => ["bs"] },
}));

import { useEventCoverVideoUpload } from "../useEventCoverVideoUpload";

const renderHook = () => {
  mockStateCursor = 0;
  mockRefCursor = 0;
  // React is mocked above: this "render" replays the hook against stored slots.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useEventCoverVideoUpload(
    "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
    "22a18413-bfbf-4087-9ba7-45f70deba0f3",
    "draft_auto",
    "event",
    {},
  );
};

// The picked clip from the report: an iPhone 15 recording, 13.6 s, 90.5 MB.
const PICKED = {
  uri: "file:///Library/Caches/ImagePicker/A049FA36.MOV",
  bytes: 90_538_799,
  durationMs: 13_613,
  fileName: "IMG_4412.MOV",
  mimeType: "video/quicktime",
  trimStartMs: 0,
  trimEndMs: 13_613,
};
// What the compressor handed back on the Simulator: sound, no picture.
const COMPRESSED_WITHOUT_PICTURE = {
  uri: "file:///tmp/572CD4DC.mp4",
  bytes: 223_008,
  durationMs: 13_613,
  wasCompressed: true,
};

const noVideoTrack = (): Error => {
  const error = new Error("The trimmed clip has no video track.");
  error.name = "EventCoverVideoSourceHasNoVideoTrackError";
  return error;
};

const preparedFrom = (input: PrepareInput) => ({
  uri: `file:///Library/Caches/event-cover-${input.operationId}`,
  bytes: input.bytes,
  durationMs: input.durationMs,
  fileName: input.fileName ?? "",
  mimeType: input.mimeType ?? "",
  extension: input.mimeType === "video/quicktime" ? "mov" : "mp4",
  sha256: "c".repeat(64),
  fingerprint: `${"c".repeat(64)}:${input.bytes}`,
});

// A prepared-source step that refuses any picture-less file, like the real one.
const refusePictureless = (pictureless: Set<string>) => async (input: PrepareInput) => {
  if (pictureless.has(input.uri)) throw noVideoTrack();
  return preparedFrom(input);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStateSlots.length = 0;
  mockRefSlots.length = 0;
  mockPersisted.clear();
  fetchEventCoverVideoStatusByTarget.mockResolvedValue(null);
  // Stop right after the intent: these tests are about what gets that far.
  createEventCoverVideoUploadIntent.mockRejectedValue(
    new MockEventCoverVideoProcessingError("forbidden", "stop after intent"),
  );
});

describe("#3073 — a compressor result without a picture falls back to the original", () => {
  test("the original clip is prepared and offered to the upload intent", async () => {
    compressVideoLocally.mockResolvedValue(COMPRESSED_WITHOUT_PICTURE);
    prepareEventCoverVideoSource.mockImplementation(
      refusePictureless(new Set([COMPRESSED_WITHOUT_PICTURE.uri])),
    );

    await renderHook().start(PICKED);

    expect(prepareEventCoverVideoSource).toHaveBeenCalledTimes(2);
    expect(prepareEventCoverVideoSource.mock.calls[1][0]).toMatchObject({
      uri: PICKED.uri,
      bytes: PICKED.bytes,
      durationMs: PICKED.durationMs,
      fileName: PICKED.fileName,
      mimeType: PICKED.mimeType,
    });
    // Both attempts belong to the same durable operation.
    expect(prepareEventCoverVideoSource.mock.calls[1][0].operationId)
      .toBe(prepareEventCoverVideoSource.mock.calls[0][0].operationId);
    expect(createEventCoverVideoUploadIntent).toHaveBeenCalledTimes(1);
    expect(createEventCoverVideoUploadIntent.mock.calls[0][0]).toMatchObject({
      sourceBytes: PICKED.bytes,
      sourceFileName: PICKED.fileName,
      sourceMimeType: PICKED.mimeType,
      sourceExtension: "mov",
    });
    // The failure the host saw is gone; the only error left is the stub stop.
    const after = renderHook();
    expect(after.stage).not.toMatchObject({ message: expect.stringContaining("without any video") });
    expect(after.error).toMatchObject({ code: "forbidden" });
  });

  test("a picture-less result for an original over 100 MB fails honestly, without an upload", async () => {
    compressVideoLocally.mockResolvedValue(COMPRESSED_WITHOUT_PICTURE);
    prepareEventCoverVideoSource.mockImplementation(
      refusePictureless(new Set([COMPRESSED_WITHOUT_PICTURE.uri])),
    );

    await renderHook().start({ ...PICKED, bytes: 140_000_000 });

    expect(prepareEventCoverVideoSource).toHaveBeenCalledTimes(1);
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    const after = renderHook();
    expect(after.error).toMatchObject({ code: "video_compression_failed" });
    expect(after.stage).toMatchObject({ phase: "error", message: expect.stringContaining("100 MB") });
    expect(after.stage).not.toMatchObject({ message: expect.stringContaining("without any video") });
  });

  test("an UNcompressed clip without a picture is still refused (the #3073 guard stays)", async () => {
    compressVideoLocally.mockResolvedValue({ ...PICKED, bytes: 4_000_000, wasCompressed: false });
    prepareEventCoverVideoSource.mockImplementation(refusePictureless(new Set([PICKED.uri])));

    await renderHook().start({ ...PICKED, bytes: 4_000_000 });

    expect(prepareEventCoverVideoSource).toHaveBeenCalledTimes(1);
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(renderHook().error).toMatchObject({ code: "source_video_track_missing" });
  });

  test("an original that has no picture either is refused, not uploaded", async () => {
    compressVideoLocally.mockResolvedValue(COMPRESSED_WITHOUT_PICTURE);
    prepareEventCoverVideoSource.mockImplementation(
      refusePictureless(new Set([COMPRESSED_WITHOUT_PICTURE.uri, PICKED.uri])),
    );

    await renderHook().start(PICKED);

    expect(prepareEventCoverVideoSource).toHaveBeenCalledTimes(2);
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(renderHook().error).toMatchObject({ code: "source_video_track_missing" });
  });

  test("any other preparation failure of a compressed file is NOT retried with the original", async () => {
    compressVideoLocally.mockResolvedValue(COMPRESSED_WITHOUT_PICTURE);
    prepareEventCoverVideoSource.mockRejectedValue(new Error("video_source_size_changed"));

    await renderHook().start(PICKED);

    expect(prepareEventCoverVideoSource).toHaveBeenCalledTimes(1);
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(renderHook().stage).toMatchObject({ phase: "error" });
  });
});

describe("#3073 — a failure after \"Discard upload\" is shown, never left on a spinner", () => {
  const failPreparation = (): void => {
    compressVideoLocally.mockResolvedValue({ ...PICKED, bytes: 4_000_000, wasCompressed: false });
    prepareEventCoverVideoSource.mockImplementation(refusePictureless(new Set([PICKED.uri])));
  };

  test("discard, then a new clip that fails: the error reaches the sheet", async () => {
    // The sheet mounts and reconnects (installs its controller), then the host
    // taps "Discard upload" on the previous failure.
    await renderHook().resume();
    await renderHook().cancel();
    expect(renderHook().stage).toMatchObject({ phase: "idle" });

    failPreparation();
    await renderHook().start({ ...PICKED, bytes: 4_000_000 });

    const after = renderHook();
    expect(after.stage).toMatchObject({ phase: "error" });
    expect(after.error).toMatchObject({ code: "source_video_track_missing" });
  });

  test("discard twice, then a failing clip: still shown", async () => {
    await renderHook().resume();
    await renderHook().cancel();
    await renderHook().cancel();

    failPreparation();
    await renderHook().start({ ...PICKED, bytes: 4_000_000 });

    expect(renderHook().stage).toMatchObject({ phase: "error" });
  });

  test("adversarial: a cancel DURING this attempt's preparation still wins silently", async () => {
    await renderHook().resume();
    await renderHook().cancel(); // the stale, already-aborted controller

    let releaseCompression: (value: unknown) => void = () => undefined;
    compressVideoLocally.mockImplementation(
      () => new Promise((resolve) => { releaseCompression = resolve; }),
    );
    prepareEventCoverVideoSource.mockImplementation(refusePictureless(new Set([PICKED.uri])));

    const attempt = renderHook().start({ ...PICKED, bytes: 4_000_000 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(compressVideoLocally).toHaveBeenCalledTimes(1);
    await renderHook().cancel();
    releaseCompression({ ...PICKED, bytes: 4_000_000, wasCompressed: false });
    await attempt;

    const after = renderHook();
    expect(after.stage).toMatchObject({ phase: "idle" });
    expect(after.error).toBeNull();
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
  });
});
