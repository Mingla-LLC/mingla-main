/**
 * #2967 + #2974 — a definite server answer must never render as "still working".
 *
 * These tests drive the REAL acknowledgement loop and the REAL resume path in
 * `useEventCoverVideoUpload`. A one-shot mock cannot distinguish "returns
 * pending once" from "returns pending forever", which IS the bug, so the
 * acknowledgement mock here answers `source_uploading` on EVERY call and the
 * test advances a fake clock exactly as the production 2s loop did.
 */
import { beforeEach, afterEach, describe, expect, jest, test } from "@jest/globals";

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

const mockFlushEffects = async (): Promise<void> => {
  const pending = mockPendingEffects.splice(0);
  for (const effect of pending) {
    const cleanup = effect();
    if (typeof cleanup === "function") mockEffectCleanups.push(cleanup);
  }
  await Promise.resolve();
  await Promise.resolve();
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

jest.mock("react-native", () => ({ Platform: mockPlatform }));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
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
  readonly edgeDetail?: string;
  readonly lastStatus?: unknown;

  constructor(
    code: string,
    message: string,
    metadata?: { edgeDetail?: string } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "EventCoverVideoProcessingError";
    this.code = code;
    this.edgeDetail = metadata?.edgeDetail;
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
const persistedWrites: MockPersistedJob[] = [];
const readPersistedCoverVideoJob = jest.fn(async (_userId: string, key: string) =>
  mockPersistedJobs.get(key) ?? null
);
const writePersistedCoverVideoJob = jest.fn(async (job: MockPersistedJob) => {
  persistedWrites.push({ ...job });
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

const prepareEventCoverVideoSource = jest.fn(async (input: {
  uri: string;
  bytes: number;
  durationMs: number;
  fileName?: string | null;
  mimeType?: string | null;
}) => ({
  uri: input.uri,
  bytes: input.bytes,
  durationMs: input.durationMs,
  fileName: input.fileName ?? null,
  mimeType: input.mimeType ?? null,
  extension: "mp4",
  sha256: "a".repeat(64),
  fingerprint: `${"a".repeat(64)}:${input.bytes}`,
}));
const deletePreparedEventCoverVideoSource = jest.fn(async () => undefined);

jest.mock("../../services/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-2967" } } } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  },
}));

jest.mock("../../services/eventCoverVideoPreparedSource", () => ({
  deletePreparedEventCoverVideoSource,
  prepareEventCoverVideoSource,
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

import {
  EVENT_COVER_VIDEO_ACK_DEADLINE_MS,
  useEventCoverVideoUpload,
} from "../useEventCoverVideoUpload";

const SERVER_EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
// The exact local draft id the production repro sent to upload-intent.
const LOCAL_DRAFT_ID = "d_mtiqbzuwzsnhq9";

const renderHook = (eventId: string = SERVER_EVENT_ID) => {
  mockResetRenderCursor();
  return useEventCoverVideoUpload(eventId, BRAND_ID, "draft_auto", "event", {});
};

const uploadFile = {
  bytes: 1_819_005,
  durationMs: 12_000,
  fileName: "cover.mp4",
  mimeType: "video/mp4",
  uri: "file:///cover.mp4",
};

const status = (overrides: Record<string, unknown> = {}) => ({
  applyMode: "draft_auto",
  brandId: BRAND_ID,
  canCancel: true,
  canCheckAgain: true,
  canRetry: false,
  clientOperationId: null,
  eventId: SERVER_EVENT_ID,
  failureCode: null,
  failureMessage: null,
  isTerminal: false,
  jobId: "job-2967",
  processedBytes: null,
  processedDurationMs: null,
  processedMimeType: null,
  processedPosterUrl: null,
  processedUrl: null,
  progressKind: "indeterminate",
  progressPercent: null,
  safeJobCode: "JOB2967A",
  sourceUploadedAt: null,
  stageLabel: "Uploading video",
  status: "source_uploading",
  applicationVersion: 0,
  applicationReceipt: null,
  ...overrides,
});

/**
 * Drive the hook's own `while` loop: advance the fake clock by one poll
 * interval and let every awaited microtask settle, until the flow finishes or
 * the drive budget runs out. The budget is deliberately far larger than the
 * deadline needs, so an unbounded loop leaves the promise PENDING and the
 * assertions below fail rather than hanging the runner.
 */
const driveAckLoop = async (
  promise: Promise<unknown>,
  budgetTicks = 400,
): Promise<boolean> => {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  for (let tick = 0; tick < budgetTicks && !settled; tick += 1) {
    for (let micro = 0; micro < 12; micro += 1) await Promise.resolve();
    jest.advanceTimersByTime(2_000);
    for (let micro = 0; micro < 12; micro += 1) await Promise.resolve();
  }
  return settled;
};

describe("#2967 the acknowledgement loop is bounded on the client too", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetReactHarness();
    mockPersistedJobs.clear();
    persistedWrites.length = 0;
    mockPlatform.OS = "ios";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T13:30:08.000Z"));
    compressVideoLocally.mockImplementation((async (input: {
      uri: string; bytes: number; durationMs: number;
    }) => ({
      bytes: input.bytes,
      durationMs: input.durationMs,
      uri: input.uri,
      wasCompressed: false,
    })) as never);
    createEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-2967",
      upload: { fields: {}, url: "https://upload.example.com", protocol: "tus" },
    } as never);
    uploadEventCoverVideoSource.mockResolvedValue(null as never);
    waitForEventCoverVideoReady.mockResolvedValue(status({ status: "applied", isTerminal: true }) as never);
    fetchEventCoverVideoStatus.mockResolvedValue(status() as never);
    fetchEventCoverVideoStatusByTarget.mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("a server that answers source_uploading FOREVER produces a real error, not an endless spinner", async () => {
    // The exact production condition: every acknowledgement is HTTP 200 and a
    // database no-op. Not a one-shot mock — this answers pending every time.
    acknowledgeEventCoverVideoSourceUploaded.mockImplementation(async () => status());

    const hook = renderHook();
    const settled = await driveAckLoop(hook.start(uploadFile));
    expect(settled).toBe(true);

    const after = renderHook();
    expect(after.stage).toMatchObject({ phase: "error" });
    expect(after.stage).not.toMatchObject({ phase: "ack_pending" });

    // It really looped (this is not an immediate bail), and it really stopped.
    const calls = acknowledgeEventCoverVideoSourceUploaded.mock.calls.length;
    const expectedMax = Math.ceil(EVENT_COVER_VIDEO_ACK_DEADLINE_MS / 2_000) + 3;
    expect(calls).toBeGreaterThan(5);
    expect(calls).toBeLessThanOrEqual(expectedMax);

    // A source that was never acknowledged must never be recorded as one, and
    // the processing watcher must never start for a job stuck at upload.
    expect(waitForEventCoverVideoReady).not.toHaveBeenCalled();
    expect(persistedWrites.some((write) => write.sourceAcknowledged)).toBe(false);
  });

  test("a server that FAILS the job during acknowledgement surfaces its failure code", async () => {
    let call = 0;
    acknowledgeEventCoverVideoSourceUploaded.mockImplementation(async () => {
      call += 1;
      return call < 3
        ? status()
        : status({
            status: "failed",
            isTerminal: true,
            canRetry: true,
            failureCode: "source_ack_deadline_exceeded",
          });
    });

    const hook = renderHook();
    const settled = await driveAckLoop(hook.start(uploadFile));
    expect(settled).toBe(true);

    const after = renderHook();
    expect(after.stage).toMatchObject({ phase: "error" });
    expect(waitForEventCoverVideoReady).not.toHaveBeenCalled();
    expect(persistedWrites.some((write) => write.sourceAcknowledged)).toBe(false);
    // The terminal job cleaned up its own local record.
    expect(mockPersistedJobs.size).toBe(0);
  });
});

describe("#2974 a 4xx is never a spinner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetReactHarness();
    mockPersistedJobs.clear();
    persistedWrites.length = 0;
    mockPlatform.OS = "ios";
    compressVideoLocally.mockImplementation((async (input: {
      uri: string; bytes: number; durationMs: number;
    }) => ({
      bytes: input.bytes,
      durationMs: input.durationMs,
      uri: input.uri,
      wasCompressed: false,
    })) as never);
    uploadEventCoverVideoSource.mockResolvedValue(null as never);
    acknowledgeEventCoverVideoSourceUploaded.mockResolvedValue(
      status({ status: "source_uploaded" }) as never,
    );
    waitForEventCoverVideoReady.mockResolvedValue(
      status({ status: "applied", isTerminal: true }) as never,
    );
    fetchEventCoverVideoStatus.mockResolvedValue(status() as never);
    fetchEventCoverVideoStatusByTarget.mockResolvedValue(null as never);
  });

  test("mount recovery of a job the server never created ENDS in an error, not in 'Reconnecting to your video…'", async () => {
    // The wedged state from the field: a local record whose source was never
    // acknowledged and whose jobId is null, because upload-intent 400'd.
    mockPersistedJobs.set(`event:${SERVER_EVENT_ID}`, {
      userId: "user-2967",
      key: `event:${SERVER_EVENT_ID}`,
      jobId: null,
      clientOperationId: "11111111-1111-4111-8111-111111111111",
      sourceUri: "file:///prepared.mp4",
      sourceFingerprint: `${"a".repeat(64)}:1819005`,
      sourceBytes: 1_819_005,
      sourceDurationMs: 12_000,
      sourceFileName: "cover.mp4",
      sourceMimeType: "video/mp4",
      sourceExtension: "mp4",
      sourceSha256: "a".repeat(64),
      trimStartMs: 0,
      trimEndMs: 12_000,
      sourceAcknowledged: false,
    });
    createEventCoverVideoUploadIntent.mockRejectedValue(
      new MockEventCoverVideoProcessingError(
        "validation_error",
        "This event is still syncing. Reopen the draft and try again.",
      ) as never,
    );

    renderHook();
    await mockFlushEffects();
    for (let micro = 0; micro < 20; micro += 1) await Promise.resolve();

    const after = renderHook();
    expect(after.stage).toMatchObject({ phase: "error" });
    // The reported symptom, pinned: the sheet must NOT be left reattaching.
    expect(after.stage).not.toMatchObject({ phase: "reattaching" });
    // And the phantom record is gone, so the next pick starts clean instead of
    // trying to "reconnect" to a job that was never created.
    expect(mockPersistedJobs.size).toBe(0);
  });

  test("a client-only d_* draft id never reaches upload-intent and surfaces a finite error", async () => {
    createEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-2967",
      upload: { fields: {}, url: "https://upload.example.com", protocol: "tus" },
    } as never);

    const hook = renderHook(LOCAL_DRAFT_ID);
    await hook.start(uploadFile);

    const after = renderHook(LOCAL_DRAFT_ID);
    expect(after.stage).toMatchObject({ phase: "error" });
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(uploadEventCoverVideoSource).not.toHaveBeenCalled();
    // Nothing was staged for a target that cannot own a job.
    expect(mockPersistedJobs.size).toBe(0);
  });

  test("a terminal upload-intent rejection drops the local record it wrote moments earlier", async () => {
    createEventCoverVideoUploadIntent.mockRejectedValue(
      new MockEventCoverVideoProcessingError(
        "validation_error",
        "This event is still syncing. Reopen the draft and try again.",
      ) as never,
    );

    const hook = renderHook();
    await hook.start(uploadFile);

    // It DID write a record before calling upload-intent…
    expect(persistedWrites.length).toBeGreaterThan(0);
    // …and that record is gone, along with its staged bytes.
    expect(mockPersistedJobs.size).toBe(0);
    expect(deletePreparedEventCoverVideoSource).toHaveBeenCalled();
    expect(renderHook().stage).toMatchObject({ phase: "error" });
  });
});
