/**
 * Issue #3485 [stuck cover video] — regression 2 of 2: "Processing video…" never
 * settled after the app was backgrounded.
 *
 * Filmed on a Release build (2026-09-20). Server-side the job was finished —
 * `event_cover_video_jobs.status='applied'`, `events.cover_media_type='video'` —
 * and the foregrounded app still rendered "Processing video…" with an elapsed
 * timer at 4758m, over a thumbnail that was already the finished cover. Closing
 * and reopening the sheet did not clear it; only a full app restart did.
 *
 * WHY it could not clear itself: the hook had exactly three routes to the truth —
 * `resume()` on mount, the live `watch()` poll, and `checkNow`, which the sheet
 * renders ONLY in the `detached` phase (CoverPicker.tsx). There was no AppState
 * listener anywhere in the file, so a `processing` card whose watch had died had
 * no route back to the server at all.
 *
 * This suite drives the hook through the same controlled lifecycle harness the
 * neighbouring hook suites use (effects are captured per render and run only when
 * the test flushes them), with one addition: `AppState` is part of the
 * `react-native` mock, so the foreground signal can actually be fired.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockStateSlots: unknown[] = [];
const mockRefSlots: Array<{ current: unknown }> = [];
const mockPendingEffects: Array<() => void | (() => void)> = [];
const mockEffectCleanups: Array<() => void> = [];
const mockPlatform = { OS: "ios" };
let mockStateCursor = 0;
let mockRefCursor = 0;

const mockResetRenderCursor = (): void => {
  mockStateCursor = 0;
  mockRefCursor = 0;
};

const mockResetReactHarness = (): void => {
  mockStateSlots.length = 0;
  mockRefSlots.length = 0;
  mockPendingEffects.length = 0;
  mockEffectCleanups.length = 0;
  mockResetRenderCursor();
};

/** Runs the effects captured since the last flush, keeping their cleanups. */
const mockFlushEffects = async (): Promise<void> => {
  const pending = mockPendingEffects.splice(0);
  for (const effect of pending) {
    const cleanup = effect();
    if (typeof cleanup === "function") mockEffectCleanups.push(cleanup);
  }
  await Promise.resolve();
  await Promise.resolve();
};

/**
 * Drops effects captured by a re-render without running them. The mocked
 * `useEffect` ignores dependency arrays, so this is how the harness models an
 * effect whose deps did not change — without it, every re-render would re-run
 * `resume()` and re-subscribe to AppState.
 */
const mockDiscardPendingEffects = (): void => {
  mockPendingEffects.length = 0;
};

const mockUnmountEffects = (): void => {
  for (const cleanup of mockEffectCleanups.splice(0)) cleanup();
};

/** Drains the microtask queue so an unawaited async chain can finish. */
const mockSettle = async (): Promise<void> => {
  for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
};

jest.mock("react", () => ({
  useCallback: jest.fn((callback: unknown) => callback),
  useEffect: jest.fn((effect: () => void | (() => void)) => {
    mockPendingEffects.push(effect);
  }),
  useMemo: jest.fn((factory: () => unknown) => factory()),
  useRef: jest.fn((initialValue: unknown) => {
    const index = mockRefCursor;
    mockRefCursor += 1;
    if (mockRefSlots[index] === undefined) {
      mockRefSlots[index] = { current: initialValue };
    }
    return mockRefSlots[index];
  }),
  useState: jest.fn((initialValue: unknown) => {
    const index = mockStateCursor;
    mockStateCursor += 1;
    if (mockStateSlots[index] === undefined) {
      mockStateSlots[index] = initialValue;
    }
    const setState = (nextValue: unknown): void => {
      mockStateSlots[index] =
        typeof nextValue === "function"
          ? (nextValue as (previous: unknown) => unknown)(mockStateSlots[index])
          : nextValue;
    };
    return [mockStateSlots[index], setState];
  }),
}));

// The foreground signal under test, plus the mutable platform truth the hook
// reads. Everything else in react-native stays out of this hook harness for the
// reason the neighbouring suites give: the broad component mock has no business
// here.
const mockAppStateHandlers: Array<(state: string) => void> = [];
const mockAppStateRemove = jest.fn();
const mockAppState = {
  currentState: "active",
  addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
    mockAppStateHandlers.push(handler);
    return { remove: mockAppStateRemove };
  }),
};
jest.mock("react-native", () => ({ AppState: mockAppState, Platform: mockPlatform }));

const invalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const compressVideoLocally = jest.fn();
const createEventCoverVideoUploadIntent = jest.fn();
const uploadEventCoverVideoSource = jest.fn();
const acknowledgeEventCoverVideoSourceUploaded = jest.fn();
const waitForEventCoverVideoReady = jest.fn();
const cancelEventCoverVideoJob = jest.fn();
const logEventCoverVideoUploadTelemetry = jest.fn();
const applyEventCoverVideoJob = jest.fn();
const fetchEventCoverVideoStatus = jest.fn();
const fetchEventCoverVideoStatusByTarget = jest.fn();

class MockEventCoverVideoProcessingError extends Error {
  readonly code: string;
  readonly lastStatus?: unknown;

  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.name = "EventCoverVideoProcessingError";
    this.code = code;
    this.lastStatus = metadata?.lastStatus;
  }
}

jest.mock("../../services/eventCoverVideoProcessingService", () => ({
  acknowledgeEventCoverVideoSourceUploaded,
  applyEventCoverVideoJob,
  cancelEventCoverVideoJob,
  compressVideoLocally,
  createEventCoverVideoUploadIntent,
  EventCoverVideoProcessingError: MockEventCoverVideoProcessingError,
  fetchEventCoverVideoStatus,
  fetchEventCoverVideoStatusByTarget,
  logEventCoverVideoUploadTelemetry,
  uploadEventCoverVideoSource,
  waitForEventCoverVideoReady,
}));

type MockPersistedJob = {
  userId: string;
  key: string;
  jobId: string | null;
  clientOperationId: string;
  sourceUri: string | null;
  sourceFingerprint: string | null;
  sourceBytes: number;
  sourceDurationMs: number;
  sourceFileName: string | null;
  sourceMimeType: string | null;
  sourceExtension: string;
  sourceSha256: string;
  trimStartMs: number;
  trimEndMs: number;
  sourceAcknowledged: boolean;
};

const mockPersistedJobs = new Map<string, MockPersistedJob>();
const readPersistedCoverVideoJob = jest.fn(async (_userId: string, key: string) =>
  mockPersistedJobs.get(key) ?? null
);
const writePersistedCoverVideoJob = jest.fn(async (job: MockPersistedJob) => {
  mockPersistedJobs.set(job.key, { ...job });
});
const removePersistedCoverVideoJob = jest.fn(async (_userId: string, key: string) => {
  mockPersistedJobs.delete(key);
});

jest.mock("../../services/eventCoverVideoJobPersistence", () => ({
  clearPersistedCoverVideoJobsForUser: jest.fn(),
  readPersistedCoverVideoJob,
  removePersistedCoverVideoJob,
  writePersistedCoverVideoJob,
}));

jest.mock("../../services/eventCoverVideoPreparedSource", () => ({
  deletePreparedEventCoverVideoSource: jest.fn(async () => undefined),
  prepareEventCoverVideoSource: jest.fn(),
}));

jest.mock("../../services/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-3485" } } } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  },
}));

jest.mock("../useBusinessEvents", () => ({
  businessEventKeys: {
    detail: (eventId: string) => ["business-event", eventId],
    list: (brandId: string) => ["business-events", brandId],
  },
}));
jest.mock("../useServerDraftEvents", () => ({
  eventDraftKeys: {
    detail: (eventId: string) => ["draft-event", eventId],
    list: (brandId: string) => ["draft-events", brandId],
  },
}));
jest.mock("../usePublicEvents", () => ({
  publicEventKeys: { detailById: (eventId: string) => ["public-event", eventId] },
}));
jest.mock("../upcomingKeys", () => ({ upcomingKeys: { all: ["upcoming"] } }));
jest.mock("../useBrands", () => ({
  brandKeys: {
    detail: (brandId: string) => ["brands", "detail", brandId],
    lists: () => ["brands", "list"],
  },
}));

import { useEventCoverVideoUpload } from "../useEventCoverVideoUpload";

const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const PERSISTENCE_KEY = `event:${EVENT_ID}`;

const renderHook = () => {
  mockResetRenderCursor();
  return useEventCoverVideoUpload(EVENT_ID, BRAND_ID, "published_manual", "event", {});
};

type LooseMock = { mockResolvedValue: (value: unknown) => void; mockRejectedValue: (value: unknown) => void };
const mockWaitForEventCoverVideoReady = waitForEventCoverVideoReady as unknown as LooseMock;
const mockFetchEventCoverVideoStatus = fetchEventCoverVideoStatus as unknown as LooseMock;
const mockFetchEventCoverVideoStatusByTarget =
  fetchEventCoverVideoStatusByTarget as unknown as LooseMock;
const mockApplyEventCoverVideoJob = applyEventCoverVideoJob as unknown as LooseMock;

const processingStatus = (overrides: Record<string, unknown> = {}) => ({
  applyMode: "published_manual",
  brandId: BRAND_ID,
  canCancel: true,
  canCheckAgain: false,
  canRetry: false,
  createdAt: "2026-09-17T02:41:00.000Z",
  eventId: EVENT_ID,
  isTerminal: false,
  jobId: "job-3485",
  processedPosterUrl: null,
  processedUrl: null,
  progressKind: "indeterminate",
  progressPercent: null,
  sourceUploadedAt: "2026-09-17T02:41:30.000Z",
  stageLabel: "Processing video…",
  status: "processing",
  targetKind: "event",
  ...overrides,
});

const appliedStatus = () => processingStatus({
  canCancel: false,
  isTerminal: true,
  processedPosterUrl: "https://cdn.example.com/poster.jpg",
  processedUrl: "https://cdn.example.com/video.mp4",
  progressKind: "terminal",
  progressPercent: 100,
  status: "applied",
});

const persistedJob = (overrides: Partial<MockPersistedJob> = {}): MockPersistedJob => ({
  userId: "user-3485",
  key: PERSISTENCE_KEY,
  jobId: "job-3485",
  clientOperationId: "11111111-1111-4111-8111-111111111111",
  sourceUri: "file:///prepared.mp4",
  sourceFingerprint: `${"a".repeat(64)}:289420`,
  sourceBytes: 289420,
  sourceDurationMs: 12000,
  sourceFileName: "cover.mp4",
  sourceMimeType: "video/mp4",
  sourceExtension: "mp4",
  sourceSha256: "a".repeat(64),
  trimStartMs: 0,
  trimEndMs: 12000,
  sourceAcknowledged: true,
  ...overrides,
});

/** Fires the OS foreground transition and lets the re-check run to completion. */
const foreground = async (): Promise<void> => {
  for (const handler of mockAppStateHandlers) handler("active");
  await mockSettle();
};

/**
 * Mounts the sheet onto a live job whose watch has ended without a verdict —
 * the filmed state. Returns the hook as the sheet would then render it.
 */
const mountOntoStuckProcessingCard = async () => {
  mockPersistedJobs.set(PERSISTENCE_KEY, persistedJob());
  mockFetchEventCoverVideoStatus.mockResolvedValue(processingStatus());
  // The poll ends with the job still processing: the sheet keeps the phase and
  // nothing is watching any more.
  mockWaitForEventCoverVideoReady.mockResolvedValue(processingStatus());
  renderHook();
  await mockFlushEffects();
  await mockSettle();
  const mounted = renderHook();
  mockDiscardPendingEffects();
  return mounted;
};

describe("issue #3485 foreground re-check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetReactHarness();
    mockPersistedJobs.clear();
    mockAppStateHandlers.length = 0;
    mockPlatform.OS = "ios";
    mockFetchEventCoverVideoStatusByTarget.mockResolvedValue(null);
    mockApplyEventCoverVideoJob.mockResolvedValue("https://cdn.example.com/video.mp4");
    // Fake timers own the re-check window's clock (it is measured with
    // `Date.now()`), and keep `resume`'s 12s reattach deadline from outliving the
    // suite as an open handle.
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse("2026-09-17T02:42:00.000Z"));
  });

  afterEach(() => { jest.useRealTimers(); });

  test("the hook subscribes to the app returning to the foreground", async () => {
    await mountOntoStuckProcessingCard();
    expect(mockAppState.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mockAppStateHandlers).toHaveLength(1);
  });

  test("THE BUG: a job that finished while the app slept settles on foreground", async () => {
    const stuck = await mountOntoStuckProcessingCard();
    expect(stuck.stage.phase).toBe("processing");

    // The provider finished and the webhook applied the cover while the app was
    // suspended. Nothing in the app knows yet.
    mockFetchEventCoverVideoStatus.mockResolvedValue(appliedStatus());
    const readsBefore = fetchEventCoverVideoStatus.mock.calls.length;

    await foreground();

    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(readsBefore + 1);
    // The re-check reads by job id, with no abort signal — resume's own read
    // passes one, so this call could only have come from the foreground path.
    expect(fetchEventCoverVideoStatus.mock.calls.at(-1)).toEqual(["job-3485"]);

    const settled = renderHook();
    expect(settled.stage.phase).toBe("applied");
    expect(settled.processedUrl).toBe("https://cdn.example.com/video.mp4");
    expect(settled.status?.status).toBe("applied");
  });

  test("a job that really is still processing keeps its card", async () => {
    const stuck = await mountOntoStuckProcessingCard();
    const readsBefore = fetchEventCoverVideoStatus.mock.calls.length;

    await foreground();

    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(readsBefore + 1);
    const after = renderHook();
    expect(after.stage.phase).toBe("processing");
    expect(stuck.stage.phase).toBe("processing");
  });

  test("no re-check storm: repeated foregrounds inside the window read once", async () => {
    await mountOntoStuckProcessingCard();
    const readsBefore = fetchEventCoverVideoStatus.mock.calls.length;

    // An OS alert dismissing over the app, a share sheet closing, a fast
    // app-switch — several 'active' transitions in a moment.
    for (let attempt = 0; attempt < 6; attempt += 1) await foreground();

    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(readsBefore + 1);
  });

  test("once the window has passed, a foreground asks again", async () => {
    await mountOntoStuckProcessingCard();
    await foreground();
    const readsAfterFirst = fetchEventCoverVideoStatus.mock.calls.length;

    jest.advanceTimersByTime(5_001);
    mockFetchEventCoverVideoStatus.mockResolvedValue(appliedStatus());
    await foreground();

    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(readsAfterFirst + 1);
    expect(renderHook().stage.phase).toBe("applied");
  });

  test("a terminal phase does no work at all — there is nothing left to settle", async () => {
    mockPersistedJobs.set(PERSISTENCE_KEY, persistedJob());
    mockFetchEventCoverVideoStatus.mockResolvedValue(appliedStatus());
    renderHook();
    await mockFlushEffects();
    await mockSettle();
    const applied = renderHook();
    mockDiscardPendingEffects();
    expect(applied.stage.phase).toBe("applied");

    const readsBefore = fetchEventCoverVideoStatus.mock.calls.length;
    await foreground();
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(readsBefore);
  });

  test("an errored card is not re-read either", async () => {
    mockPersistedJobs.set(PERSISTENCE_KEY, persistedJob());
    mockFetchEventCoverVideoStatus.mockResolvedValue(
      processingStatus({ failureCode: "provider_failed", failureMessage: "Bunny gave up.", isTerminal: true, status: "failed" }),
    );
    renderHook();
    await mockFlushEffects();
    await mockSettle();
    const failed = renderHook();
    mockDiscardPendingEffects();
    expect(failed.stage.phase).toBe("error");

    const readsBefore = fetchEventCoverVideoStatus.mock.calls.length;
    await foreground();
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(readsBefore);
  });

  test("a detached card — the one with the Check now button — settles on foreground too", async () => {
    mockPersistedJobs.set(PERSISTENCE_KEY, persistedJob());
    mockFetchEventCoverVideoStatus.mockResolvedValue(processingStatus());
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );
    renderHook();
    await mockFlushEffects();
    await mockSettle();
    const detached = renderHook();
    mockDiscardPendingEffects();
    expect(detached.stage.phase).toBe("detached");

    mockFetchEventCoverVideoStatus.mockResolvedValue(appliedStatus());
    await foreground();

    const settled = renderHook();
    expect(settled.stage.phase).toBe("applied");
  });

  test("a re-check that cannot reach the server leaves the card exactly as it was", async () => {
    const stuck = await mountOntoStuckProcessingCard();
    expect(stuck.stage.phase).toBe("processing");

    mockFetchEventCoverVideoStatus.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not check video processing status."),
    );
    await foreground();

    const after = renderHook();
    // Never an error card: a failed re-check is not a failed job.
    expect(after.stage.phase).toBe("processing");
    expect(after.error).toBeNull();
  });

  test("unmounting removes the listener, and a late foreground writes nothing", async () => {
    await mountOntoStuckProcessingCard();
    mockUnmountEffects();
    expect(mockAppStateRemove).toHaveBeenCalledTimes(1);

    mockFetchEventCoverVideoStatus.mockResolvedValue(appliedStatus());
    const readsBefore = fetchEventCoverVideoStatus.mock.calls.length;
    // The OS handler is gone in production. Here the captured one is fired anyway
    // — an unmounted instance must not read, and must not write.
    await foreground();

    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(readsBefore);
    expect(renderHook().stage.phase).toBe("processing");
  });

  test("the web build subscribes to nothing — it has no AppState lifecycle", async () => {
    mockPlatform.OS = "web";
    await mountOntoStuckProcessingCard();
    expect(mockAppState.addEventListener).not.toHaveBeenCalled();
    expect(mockAppStateHandlers).toHaveLength(0);
  });
});
