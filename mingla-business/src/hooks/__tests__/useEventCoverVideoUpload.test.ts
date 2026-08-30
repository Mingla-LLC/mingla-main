import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

// [TEST-MOD-APPROVED #2715] Faithful controlled lifecycle harness: effects are
// captured per render and run only when a test explicitly flushes them.
const mockFlushEffects = async (): Promise<void> => {
  const pending = mockPendingEffects.splice(0);
  for (const effect of pending) {
    const cleanup = effect();
    if (typeof cleanup === "function") mockEffectCleanups.push(cleanup);
  }
  await Promise.resolve();
  await Promise.resolve();
};

const mockUnmountEffects = (): void => {
  for (const cleanup of mockEffectCleanups.splice(0)) cleanup();
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

// [TEST-MOD-APPROVED #2715] The hook needs only mutable platform truth; do not
// load the broad manual React Native component mock into this hook harness.
jest.mock("react-native", () => ({ Platform: mockPlatform }));

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

// [TEST-MOD-APPROVED #2715] Recovery classification exercises the production
// error shape rather than a broad Error-only stub.
class MockEventCoverVideoProcessingError extends Error {
  readonly code: string;
  readonly edgeDetail?: string;
  readonly lastStatus?: unknown;
  readonly metadata?: unknown;

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
    this.metadata = metadata;
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

// [TEST-MOD-APPROVED #2715] Persistence remains exact-keyed and prepared source
// output preserves every selected-file field plus the production fingerprint.
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
}) => {
  const sha256 = input.uri.includes("different") ? "b".repeat(64) : "a".repeat(64);
  return ({
  uri: input.uri,
  bytes: input.bytes,
  durationMs: input.durationMs,
  fileName: input.fileName ?? null,
  mimeType: input.mimeType ?? null,
  extension: "mp4",
  sha256,
  fingerprint: `${sha256}:${input.bytes}`,
  });
});
const deletePreparedEventCoverVideoSource = jest.fn(async () => undefined);

// [TEST-MOD-APPROVED #2715] The lifecycle harness supplies an authenticated
// owner and a real unsubscribe seam for namespaced persistence/logout cleanup.
jest.mock("../../services/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-2715" } } } })),
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
  publicEventKeys: {
    detailById: (eventId: string) => ["public-event", eventId],
  },
}));

jest.mock("../upcomingKeys", () => ({
  upcomingKeys: { all: ["upcoming"] },
}));

// ORCH-0989: the hook now imports brandKeys from useBrands for brand-target
// cache invalidation. Mock it so the test does not pull the real useBrands →
// supabase → expo-constants chain (untransformed in this node test env).
jest.mock("../useBrands", () => ({
  brandKeys: {
    detail: (brandId: string) => ["brands", "detail", brandId],
    lists: () => ["brands", "list"],
  },
}));

import { useEventCoverVideoUpload } from "../useEventCoverVideoUpload";

// [TEST-MOD-APPROVED #2715] Target and identity inputs remain explicit so the
// manual harness can prove distinct event/brand/venue/venue-draft ownership.
const renderHook = (input: {
  eventId?: string;
  brandId?: string;
  target?: "event" | "brand" | "experience" | "venue" | "venue_draft";
  identity?: { venueId?: string; draftOwnerKey?: string };
} = {}) => {
  mockResetRenderCursor();
  return useEventCoverVideoUpload(
    input.eventId ?? "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
    input.brandId ?? "22a18413-bfbf-4087-9ba7-45f70deba0f3",
    "published_manual",
    input.target ?? "event",
    input.identity ?? {},
  );
};

type LooseMock = {
  mockRejectedValue: (value: unknown) => void;
  mockResolvedValue: (value: unknown) => void;
};

const mockCompressVideoLocally = compressVideoLocally as unknown as LooseMock;
const mockCreateEventCoverVideoUploadIntent =
  createEventCoverVideoUploadIntent as unknown as LooseMock;
const mockUploadEventCoverVideoSource =
  uploadEventCoverVideoSource as unknown as LooseMock;
const mockAcknowledgeEventCoverVideoSourceUploaded =
  acknowledgeEventCoverVideoSourceUploaded as unknown as LooseMock;
const mockWaitForEventCoverVideoReady =
  waitForEventCoverVideoReady as unknown as LooseMock;
const mockFetchEventCoverVideoStatus =
  fetchEventCoverVideoStatus as unknown as LooseMock;
const mockFetchEventCoverVideoStatusByTarget = fetchEventCoverVideoStatusByTarget as unknown as LooseMock;
const mockApplyEventCoverVideoJob = applyEventCoverVideoJob as unknown as LooseMock;
const mockCancelEventCoverVideoJob = cancelEventCoverVideoJob as unknown as LooseMock;

const processingStatus = (overrides: Record<string, unknown> = {}) => ({
  applyMode: "published_manual",
  brandId: "22a18413-bfbf-4087-9ba7-45f70deba0f3",
  canCancel: true,
  canCheckAgain: false,
  canRetry: false,
  eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
  isTerminal: false,
  jobId: "job-1",
  processedPosterUrl: null,
  processedUrl: null,
  progressKind: "indeterminate",
  progressPercent: null,
  stageLabel: "Processing video…",
  status: "processing",
  ...overrides,
});

const persistedJob = (
  key: string,
  overrides: Partial<MockPersistedJob> = {},
): MockPersistedJob => ({
  userId: "user-2715",
  key,
  jobId: "job-1",
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

describe("useEventCoverVideoUpload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetReactHarness();
    mockPersistedJobs.clear();
    mockPlatform.OS = "ios";
    mockCompressVideoLocally.mockResolvedValue({
      bytes: 289420,
      durationMs: 12000,
      uri: "file:///compressed.mp4",
      wasCompressed: false,
    });
    mockUploadEventCoverVideoSource.mockResolvedValue(null);
    mockAcknowledgeEventCoverVideoSourceUploaded.mockResolvedValue(
      processingStatus(),
    );
    mockWaitForEventCoverVideoReady.mockResolvedValue(
      processingStatus({
        canCancel: false,
        isTerminal: true,
        processedPosterUrl: "https://cdn.example.com/poster.jpg",
        processedUrl: "https://cdn.example.com/video.mp4",
        progressKind: "terminal",
        progressPercent: 100,
        status: "applied",
      }),
    );
    mockFetchEventCoverVideoStatus.mockResolvedValue(processingStatus());
    mockFetchEventCoverVideoStatusByTarget.mockResolvedValue(null);
    mockApplyEventCoverVideoJob.mockResolvedValue(processingStatus({ status: "applied" }));
    mockCancelEventCoverVideoJob.mockResolvedValue(
      processingStatus({ status: "cancelled", isTerminal: true }),
    );
  });

  test("clears local preview and never reaches cover change on upload-intent 401", async () => {
    const onCoverChange = jest.fn();
    const authError = Object.assign(
      new Error("Finishing sign-in. Try again in a moment."),
      { code: "unauthenticated" },
    );
    mockCreateEventCoverVideoUploadIntent.mockRejectedValue(authError);

    const firstRender = renderHook();
    await firstRender.start({
      bytes: 289420,
      durationMs: 12000,
      fileName: "cover.mp4",
      mimeType: "video/mp4",
      uri: "file:///cover.mp4",
    });

    const finalRender = renderHook();
    expect(finalRender.localPreviewUri).toBeNull();
    expect(finalRender.processedUrl).toBeNull();
    expect(finalRender.stage).toMatchObject({
      code: "video_upload_failed",
      phase: "error",
    });
    expect(uploadEventCoverVideoSource).not.toHaveBeenCalled();
    expect(waitForEventCoverVideoReady).not.toHaveBeenCalled();
    expect(onCoverChange).not.toHaveBeenCalled();
    expect(logEventCoverVideoUploadTelemetry).toHaveBeenCalledWith(
      "video_cover_upload_preview_rolled_back",
      expect.objectContaining({
        applyMode: "published_manual",
        errorCode: "unauthenticated",
        eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
        phase: "upload_intent",
      }),
    );
  });

  test("T-AMEND9-01 sends explicit trim bounds from the trimmer-built file", async () => {
    // [TEST-MOD-APPROVED #2715] The inclusive exact 15-second boundary keeps
    // the trim-plumbing proof valid while the real validator remains active.
    mockCompressVideoLocally.mockResolvedValue({
      bytes: 1_234_567,
      durationMs: 15_000,
      uri: "file:///Documents/trimmedVideo_1780000151.mp4",
      wasCompressed: false,
    });
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job_trimmed",
      provider: "cloudinary",
      upload: { fields: {}, url: "https://upload.example.com" },
    });
    mockUploadEventCoverVideoSource.mockResolvedValue({ public_id: "public_id" });
    mockAcknowledgeEventCoverVideoSourceUploaded.mockResolvedValue({
      progressPercent: 90,
      status: "processing",
    });
    mockWaitForEventCoverVideoReady.mockResolvedValue({
      processedUrl: "https://res.cloudinary.com/demo/video/upload/processed.mp4",
      status: "applied",
    });

    const hook = renderHook();
    await hook.start({
      bytes: 1_234_567,
      durationMs: 15_000,
      fileName: "trimmedVideo_1780000151.mp4",
      mimeType: "video/mp4",
      trimEndMs: 15_000,
      trimStartMs: 0,
      uri: "file:///Documents/trimmedVideo_1780000151.mp4",
    });

    expect(createEventCoverVideoUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBytes: 1_234_567,
        sourceDurationMs: 15_000,
        sourceFileName: "trimmedVideo_1780000151.mp4",
        sourceMimeType: "video/mp4",
        trimEndMs: 15_000,
        trimStartMs: 0,
      }),
    );
    expect(uploadEventCoverVideoSource).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: 1_234_567,
        fileName: "trimmedVideo_1780000151.mp4",
        mimeType: "video/mp4",
        uri: "file:///Documents/trimmedVideo_1780000151.mp4",
      }),
    );
  });

  // [TEST-MOD-APPROVED #2715] Acknowledged jobs reattach by authoritative ID;
  // transient status loss detaches without deleting resumable truth.
  test("reattaches one durable job and retains it across transient status failure", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    mockPersistedJobs.set(key, persistedJob(key));
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );
    const hook = renderHook();

    await hook.resume();
    expect(fetchEventCoverVideoStatus).toHaveBeenCalledWith("job-1", expect.any(AbortSignal));
    expect(waitForEventCoverVideoReady).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ pollIntervalMs: 2_000 }),
    );
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(uploadEventCoverVideoSource).not.toHaveBeenCalled();

    mockFetchEventCoverVideoStatus.mockRejectedValue(
      new MockEventCoverVideoProcessingError(
        "edge_error",
        "Could not refresh status.",
      ),
    );
    await hook.resume();
    const detached = renderHook();
    expect(detached.stage).toMatchObject({
      phase: "detached",
      sourceAcknowledged: true,
    });
    expect(mockPersistedJobs.get(key)?.jobId).toBe("job-1");
  });

  // [TEST-MOD-APPROVED #2715] The mount seam is explicitly flushed and its
  // registered cleanup executes without eager or cross-test effect leakage.
  test("captures mount reattachment and unmount cleanup deterministically", async () => {
    renderHook();
    expect(mockPendingEffects).toHaveLength(1);
    expect(readPersistedCoverVideoJob).not.toHaveBeenCalled();
    await mockFlushEffects();
    expect(readPersistedCoverVideoJob).toHaveBeenCalledWith(
      "user-2715",
      "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4",
    );
    expect(mockEffectCleanups).toHaveLength(1);
    mockUnmountEffects();
    expect(mockEffectCleanups).toHaveLength(0);
  });

  // [TEST-MOD-APPROVED #2715] Event, brand, venue, venue draft, and experience
  // operations keep distinct exact server identities and persistence buckets.
  test("keeps every target identity exact", async () => {
    const cases: Array<{
      target: "event" | "brand" | "experience" | "venue" | "venue_draft";
      identity: { venueId?: string; draftOwnerKey?: string };
      expectedKey: string;
      serverTarget: "event" | "brand" | "venue" | "venue_draft";
      eventId?: string;
      venueId?: string;
      draftOwnerKey?: string;
    }> = [
      { target: "event", identity: {}, expectedKey: "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4", serverTarget: "event", eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4" },
      { target: "experience", identity: {}, expectedKey: "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4", serverTarget: "event", eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4" },
      { target: "brand", identity: {}, expectedKey: "brand:22a18413-bfbf-4087-9ba7-45f70deba0f3", serverTarget: "brand" },
      { target: "venue", identity: { venueId: "venue-real-1" }, expectedKey: "venue:venue-real-1", serverTarget: "venue", venueId: "venue-real-1" },
      { target: "venue_draft", identity: { draftOwnerKey: "draft-owner-a" }, expectedKey: "venue-draft:22a18413-bfbf-4087-9ba7-45f70deba0f3:draft-owner-a", serverTarget: "venue_draft", draftOwnerKey: "draft-owner-a" },
    ];

    for (const item of cases) {
      mockResetReactHarness();
      mockPersistedJobs.clear();
      jest.clearAllMocks();
      mockCompressVideoLocally.mockResolvedValue({
        bytes: 289420,
        durationMs: 12000,
        uri: "file:///compressed.mp4",
        wasCompressed: false,
      });
      mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
        jobId: `job-${item.target}`,
        upload: { fields: {}, url: "https://upload.example.com" },
      });
      mockUploadEventCoverVideoSource.mockResolvedValue(null);
      mockAcknowledgeEventCoverVideoSourceUploaded.mockResolvedValue(processingStatus());
      mockWaitForEventCoverVideoReady.mockResolvedValue(
        processingStatus({ status: "applied", isTerminal: true }),
      );
      mockFetchEventCoverVideoStatus.mockResolvedValue(processingStatus());

      const hook = renderHook({ target: item.target, identity: item.identity });
      await hook.start({
        bytes: 289420,
        durationMs: 12000,
        fileName: "cover.mp4",
        mimeType: "video/mp4",
        uri: "file:///cover.mp4",
      });

      expect(createEventCoverVideoUploadIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          target: item.serverTarget,
          eventId: item.eventId,
          venueId: item.venueId,
          draftOwnerKey: item.draftOwnerKey,
        }),
      );
      expect(writePersistedCoverVideoJob).toHaveBeenCalledWith(
        expect.objectContaining({ key: item.expectedKey }),
      );
    }
  });

  // [TEST-MOD-APPROVED #2715] Cancel aborts its transport and deletes only the
  // exact operation key; successful apply cleans up, transient apply does not.
  test("cancel and apply cleanup preserve other target persistence", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    const otherKey = "venue-draft:22a18413-bfbf-4087-9ba7-45f70deba0f3:other";
    mockPersistedJobs.set(otherKey, persistedJob(otherKey, { jobId: "other-job" }));
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-cancel",
      upload: { fields: {}, url: "https://upload.example.com" },
    });
    const abortSpy = jest.spyOn(AbortController.prototype, "abort");
    const hook = renderHook();
    await hook.start({
      bytes: 289420,
      durationMs: 12000,
      fileName: "cover.mp4",
      mimeType: "video/mp4",
      uri: "file:///cover.mp4",
    });
    await hook.cancel();
    expect(abortSpy).toHaveBeenCalled();
    expect(cancelEventCoverVideoJob).toHaveBeenCalledTimes(1);
    expect(cancelEventCoverVideoJob).toHaveBeenCalledWith("job-cancel");
    expect(mockPersistedJobs.has(key)).toBe(false);
    expect(mockPersistedJobs.get(otherKey)?.jobId).toBe("other-job");
    expect(renderHook().localPreviewUri).toBeNull();
    abortSpy.mockRestore();

    mockResetReactHarness();
    mockPersistedJobs.clear();
    mockPersistedJobs.set(key, persistedJob(key));
    mockFetchEventCoverVideoStatus.mockResolvedValue(
      processingStatus({
        status: "ready",
        processedUrl: "https://cdn.example.com/video.mp4",
        applicationVersion: 4,
      }),
    );
    mockWaitForEventCoverVideoReady.mockResolvedValue(
      processingStatus({
        status: "ready",
        processedUrl: "https://cdn.example.com/video.mp4",
        applicationVersion: 4,
      }),
    );
    const applying = renderHook();
    await applying.resume();
    mockFetchEventCoverVideoStatus.mockResolvedValue(
      processingStatus({ status: "applied", processedUrl: "https://cdn.example.com/video.mp4" }),
    );
    await renderHook().acknowledgeApplied();
    expect(applyEventCoverVideoJob).toHaveBeenCalledWith(
      "job-1",
      4,
      "https://cdn.example.com/video.mp4",
    );
    expect(mockPersistedJobs.has(key)).toBe(false);

    mockResetReactHarness();
    mockPersistedJobs.set(key, persistedJob(key));
    const retrying = renderHook();
    await retrying.resume();
    mockPersistedJobs.set(key, persistedJob(key));
    mockApplyEventCoverVideoJob.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Try again."),
    );
    await expect(renderHook().acknowledgeApplied()).rejects.toThrow("Try again.");
    expect(mockPersistedJobs.has(key)).toBe(true);
  });

  // [TEST-MOD-APPROVED #2715] Platform behavior keeps acknowledged jobs keyed
  // by server ID, resumes native durable bytes, and requires web fingerprint truth.
  test("uses authoritative reattach and platform-correct unacknowledged resume", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    for (const os of ["ios", "web"]) {
      mockResetReactHarness();
      mockPersistedJobs.clear();
      mockPlatform.OS = os;
      mockPersistedJobs.set(key, persistedJob(key));
      const acknowledged = renderHook();
      await acknowledged.resume();
      expect(fetchEventCoverVideoStatus).toHaveBeenLastCalledWith("job-1", expect.any(AbortSignal));
    }

    mockResetReactHarness();
    mockPersistedJobs.clear();
    mockPlatform.OS = "ios";
    mockPersistedJobs.set(key, persistedJob(key, {
      jobId: null,
      sourceAcknowledged: false,
    }));
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-native-resume",
      upload: { fields: {}, url: "https://upload.example.com" },
    });
    await renderHook().resume();
    // [TEST-MOD-APPROVED #2715] Native resume uses the already prepared,
    // content-addressed file and must never run preparation/compression again.
    expect(prepareEventCoverVideoSource).not.toHaveBeenCalled();
    expect(compressVideoLocally).not.toHaveBeenCalled();
    expect(createEventCoverVideoUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientOperationId: "11111111-1111-4111-8111-111111111111",
      }),
    );

    mockResetReactHarness();
    mockPersistedJobs.clear();
    jest.clearAllMocks();
    mockPlatform.OS = "web";
    mockPersistedJobs.set(key, persistedJob(key, {
      jobId: "job-web-pending",
      sourceAcknowledged: false,
      sourceUri: null,
    }));
    const web = renderHook();
    await web.resume();
    expect(renderHook().stage).toMatchObject({
      phase: "detached",
      sourceAcknowledged: false,
    });
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    mockCompressVideoLocally.mockResolvedValue({
      bytes: 1,
      durationMs: 12000,
      uri: "blob:different",
      wasCompressed: false,
    });
    await web.start({
      bytes: 1,
      durationMs: 12000,
      fileName: "different.mp4",
      mimeType: "video/mp4",
      uri: "blob:different",
    });
    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(logEventCoverVideoUploadTelemetry).toHaveBeenCalledWith(
      "video_cover_upload_preview_rolled_back",
      expect.objectContaining({ errorCode: "source_mismatch" }),
    );
  });

  // [TEST-MOD-APPROVED #2715] Executable event/local happy path: provider
  // allocation, upload, authoritative acknowledgement, readiness, and atomic
  // apply occur in order before terminal persistence is removed.
  test("completes one event local-video operation through applied", async () => {
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-event-local",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });
    mockAcknowledgeEventCoverVideoSourceUploaded.mockResolvedValue(
      processingStatus({ jobId: "job-event-local", status: "processing" }),
    );
    mockWaitForEventCoverVideoReady.mockResolvedValue(
      processingStatus({
        applicationVersion: 7,
        jobId: "job-event-local",
        processedUrl: "https://cdn.example.com/event-local.mp4",
        status: "ready",
      }),
    );
    mockFetchEventCoverVideoStatus.mockResolvedValue(
      processingStatus({
        applicationVersion: 8,
        isTerminal: true,
        jobId: "job-event-local",
        processedUrl: "https://cdn.example.com/event-local.mp4",
        status: "applied",
      }),
    );

    await renderHook({ target: "event" }).start({
      bytes: 289420,
      durationMs: 12000,
      fileName: "local.mp4",
      mimeType: "video/mp4",
      uri: "file:///local.mp4",
    });

    expect(applyEventCoverVideoJob).toHaveBeenCalledWith(
      "job-event-local",
      7,
      "https://cdn.example.com/event-local.mp4",
    );
    expect(uploadEventCoverVideoSource.mock.invocationCallOrder[0]).toBeLessThan(
      acknowledgeEventCoverVideoSourceUploaded.mock.invocationCallOrder[0],
    );
    expect(acknowledgeEventCoverVideoSourceUploaded.mock.invocationCallOrder[0]).toBeLessThan(
      waitForEventCoverVideoReady.mock.invocationCallOrder[0],
    );
    expect(waitForEventCoverVideoReady.mock.invocationCallOrder[0]).toBeLessThan(
      applyEventCoverVideoJob.mock.invocationCallOrder[0],
    );
    expect(mockPersistedJobs.has("event:09b4ece6-eabc-4734-8ce3-3a25d90417e4")).toBe(false);
    expect(renderHook().stage).toMatchObject({ phase: "applied", percent: 100 });
  });

  // [TEST-MOD-APPROVED #2715] Executable venue-draft/cloud happy path: ready
  // remains unapplied until the host has durably saved the URL and explicitly
  // acknowledges it; only the exact user-owned draft operation is then applied.
  test("keeps a web venue draft ready until durable host acknowledgement", async () => {
    mockPlatform.OS = "web";
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-venue-cloud",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });
    mockWaitForEventCoverVideoReady.mockResolvedValue(
      processingStatus({
        applicationVersion: 3,
        draftOwnerKey: "draft-owner-cloud",
        eventId: null,
        jobId: "job-venue-cloud",
        processedUrl: "https://cdn.example.com/venue-cloud.mp4",
        status: "ready",
        targetKind: "venue_draft",
      }),
    );
    mockFetchEventCoverVideoStatus.mockResolvedValue(
      processingStatus({
        applicationVersion: 4,
        draftOwnerKey: "draft-owner-cloud",
        eventId: null,
        isTerminal: true,
        jobId: "job-venue-cloud",
        processedUrl: "https://cdn.example.com/venue-cloud.mp4",
        status: "applied",
        targetKind: "venue_draft",
      }),
    );

    const first = renderHook({
      target: "venue_draft",
      identity: { draftOwnerKey: "draft-owner-cloud" },
    });
    await first.start({
      bytes: 289420,
      durationMs: 12000,
      fileName: "cloud.mov",
      mimeType: "video/quicktime",
      uri: "blob:cloud",
    });
    expect(applyEventCoverVideoJob).not.toHaveBeenCalled();
    // [TEST-MOD-APPROVED #2715 A11] Venue-ready remains an active applying
    // state until durable host persistence and acknowledgement both finish.
    expect(renderHook({ target: "venue_draft", identity: { draftOwnerKey: "draft-owner-cloud" } }).stage)
      .toMatchObject({ phase: "applying", percent: 100 });

    await renderHook({
      target: "venue_draft",
      identity: { draftOwnerKey: "draft-owner-cloud" },
    }).acknowledgeApplied();
    expect(applyEventCoverVideoJob).toHaveBeenCalledWith(
      "job-venue-cloud",
      3,
      "https://cdn.example.com/venue-cloud.mp4",
    );
    expect(mockPersistedJobs.has(
      "venue-draft:22a18413-bfbf-4087-9ba7-45f70deba0f3:draft-owner-cloud",
    )).toBe(false);
  });

  // [TEST-MOD-APPROVED #2715] A detached browser selection must execute the
  // same-file digest gate and reuse the durable operation instead of minting a job.
  test("resumes an interrupted web upload only after the same file is selected", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    mockPlatform.OS = "web";
    mockPersistedJobs.set(key, persistedJob(key, {
      jobId: "job-web-resume",
      sourceAcknowledged: false,
      sourceUri: null,
    }));
    mockCompressVideoLocally.mockResolvedValue({
      bytes: 289420,
      durationMs: 12000,
      uri: "blob:same-file",
      wasCompressed: false,
    });
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-web-resume",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });

    const hook = renderHook();
    await hook.resume();
    expect(renderHook().stage).toMatchObject({ phase: "detached", sourceAcknowledged: false });
    await hook.start({
      bytes: 289420,
      durationMs: 12000,
      fileName: "cover.mp4",
      mimeType: "video/mp4",
      uri: "blob:same-file",
    });

    expect(createEventCoverVideoUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientOperationId: "11111111-1111-4111-8111-111111111111",
        sourceSha256: "a".repeat(64),
      }),
    );
  });

  // [TEST-MOD-APPROVED #2715] Server selector recovery owns ready work: a
  // manual event is applying until the authoritative applied row is observed.
  test("discovers and applies a ready manual-event job without local persistence", async () => {
    mockFetchEventCoverVideoStatusByTarget.mockResolvedValue(
      processingStatus({
        applicationVersion: 6,
        jobId: "job-discovered-ready",
        processedUrl: "https://cdn.example.com/discovered.mp4",
        status: "ready",
      }),
    );
    mockFetchEventCoverVideoStatus.mockResolvedValue(
      processingStatus({
        applicationVersion: 7,
        isTerminal: true,
        jobId: "job-discovered-ready",
        processedUrl: "https://cdn.example.com/discovered.mp4",
        status: "applied",
      }),
    );

    await renderHook({ target: "event" }).resume();

    expect(applyEventCoverVideoJob).toHaveBeenCalledWith(
      "job-discovered-ready",
      6,
      "https://cdn.example.com/discovered.mp4",
    );
    expect(renderHook({ target: "event" }).stage).toMatchObject({ phase: "applied" });
  });

  // [TEST-MOD-APPROVED #2715] Initialization/verification responses are safe
  // retryable projections and never become terminal raw-error UI.
  test.each(["upload_initializing", "upload_verification_pending"])(
    "keeps %s retryable and detached",
    async (code) => {
      mockCreateEventCoverVideoUploadIntent.mockRejectedValue(
        new MockEventCoverVideoProcessingError(code, "Try again shortly."),
      );
      await renderHook().start({
        bytes: 289420,
        durationMs: 12000,
        fileName: "cover.mp4",
        mimeType: "video/mp4",
        uri: "file:///cover.mp4",
      });
      const projected = renderHook();
      expect(projected.stage).toMatchObject({ phase: "detached" });
      expect(projected.error).toBeNull();
      expect(mockPersistedJobs.size).toBe(1);
    },
  );

  // [TEST-MOD-APPROVED #2715] A cancel/ready race projects the winning ready
  // state and applies it; cleanup happens only after authoritative applied truth.
  test("applies a ready winner when cancel loses the atomic race", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    mockPersistedJobs.set(key, persistedJob(key));
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );
    await renderHook().resume();
    mockCancelEventCoverVideoJob.mockResolvedValue(
      processingStatus({
        applicationVersion: 10,
        jobId: "job-1",
        processedUrl: "https://cdn.example.com/cancel-winner.mp4",
        status: "ready",
      }),
    );
    mockFetchEventCoverVideoStatus.mockResolvedValue(
      processingStatus({
        applicationVersion: 11,
        isTerminal: true,
        jobId: "job-1",
        processedUrl: "https://cdn.example.com/cancel-winner.mp4",
        status: "applied",
      }),
    );

    await renderHook().cancel();

    expect(applyEventCoverVideoJob).toHaveBeenCalledWith(
      "job-1",
      10,
      "https://cdn.example.com/cancel-winner.mp4",
    );
    expect(mockPersistedJobs.has(key)).toBe(false);
    expect(renderHook().stage).toMatchObject({ phase: "applied" });
  });

  // [TEST-MOD-APPROVED #2715] Replacement abandons only local resumable bytes
  // after provisional persistence and server acceptance; the server RPC performs
  // atomic supersession while the old operation remains recoverable beforehand.
  test("starts a distinct server-accepted replacement without cancelling first", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    mockPersistedJobs.set(key, persistedJob(key));
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );
    await renderHook().resume();
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-replacement",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });
    mockWaitForEventCoverVideoReady.mockResolvedValue(
      processingStatus({
        applicationVersion: 2,
        isTerminal: true,
        jobId: "job-replacement",
        processedUrl: "https://cdn.example.com/replacement.mp4",
        status: "applied",
      }),
    );

    await renderHook().replace({
      bytes: 289420,
      durationMs: 12000,
      fileName: "replacement.mp4",
      mimeType: "video/mp4",
      uri: "file:///replacement.mp4",
    });

    expect(cancelEventCoverVideoJob).not.toHaveBeenCalled();
    expect(createEventCoverVideoUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: expect.not.stringMatching(/^11111111-/) }),
    );
    const provisionalWrite = writePersistedCoverVideoJob.mock.calls.findIndex(
      ([job]) => job.key === `${key}:replacement` && job.jobId === null,
    );
    const acceptedWrite = writePersistedCoverVideoJob.mock.calls.findIndex(
      ([job]) => job.key === key && job.jobId === "job-replacement",
    );
    expect(provisionalWrite).toBeGreaterThanOrEqual(0);
    expect(acceptedWrite).toBeGreaterThan(provisionalWrite);
    expect(writePersistedCoverVideoJob.mock.invocationCallOrder[provisionalWrite])
      .toBeLessThan(createEventCoverVideoUploadIntent.mock.invocationCallOrder[0]);
    expect(createEventCoverVideoUploadIntent.mock.invocationCallOrder[0])
      .toBeLessThan(writePersistedCoverVideoJob.mock.invocationCallOrder[acceptedWrite]);
    expect(deletePreparedEventCoverVideoSource).toHaveBeenCalledWith("file:///prepared.mp4");
  });

  // [TEST-MOD-APPROVED #2715] A rejected replacement removes only its
  // provisional record/source and never deletes the still-authoritative target.
  test("keeps the old operation authoritative when replacement acceptance fails", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    mockPersistedJobs.set(key, persistedJob(key));
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );
    await renderHook().resume();
    mockCreateEventCoverVideoUploadIntent.mockRejectedValue(
      new MockEventCoverVideoProcessingError("capacity_exceeded", "Remove a video and try again."),
    );

    await expect(renderHook().replace({
      bytes: 289420,
      durationMs: 12000,
      fileName: "replacement.mp4",
      mimeType: "video/mp4",
      uri: "file:///replacement.mp4",
    })).rejects.toThrow("Remove a video and try again.");

    expect(mockPersistedJobs.get(key)?.jobId).toBe("job-1");
    expect(cancelEventCoverVideoJob).not.toHaveBeenCalled();
    expect(removePersistedCoverVideoJob).not.toHaveBeenCalledWith(
      "user-2715",
      key,
      expect.anything(),
    );
    expect(removePersistedCoverVideoJob).toHaveBeenCalledWith(
      "user-2715",
      `${key}:replacement`,
      { preserveSource: true },
    );
    expect(deletePreparedEventCoverVideoSource).not.toHaveBeenCalledWith("file:///prepared.mp4");
    expect(deletePreparedEventCoverVideoSource).toHaveBeenCalledWith("file:///compressed.mp4");
  });

  // [TEST-MOD-APPROVED #2715] Cleanup after acceptance is best effort: an old
  // source deletion failure cannot roll persistence back to the superseded job.
  test("keeps the accepted replacement authoritative when old-source cleanup fails", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    mockPersistedJobs.set(key, persistedJob(key));
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-replacement",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });
    deletePreparedEventCoverVideoSource.mockRejectedValueOnce(new Error("disk busy"));
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );

    await renderHook().replace({
      bytes: 289420,
      durationMs: 12000,
      fileName: "replacement.mp4",
      mimeType: "video/mp4",
      uri: "file:///replacement.mp4",
    });

    expect(mockPersistedJobs.get(key)).toMatchObject({
      jobId: "job-replacement",
      sourceUri: "file:///compressed.mp4",
    });
    expect(renderHook().stage).toMatchObject({ phase: "detached" });
    expect(deletePreparedEventCoverVideoSource).not.toHaveBeenCalledWith("file:///compressed.mp4");
  });

  // [TEST-MOD-APPROVED #2715] The deterministic replacement journal survives
  // an accepted response whose target-key write fails, then remount promotes
  // the server-selected job before resuming its prepared bytes.
  test("recovers an accepted replacement after target persistence fails", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    const provisionalKey = `${key}:replacement`;
    mockPersistedJobs.set(key, persistedJob(key));
    writePersistedCoverVideoJob
      .mockImplementationOnce(async (job: MockPersistedJob) => { mockPersistedJobs.set(job.key, { ...job }); })
      .mockImplementationOnce(async (job: MockPersistedJob) => { mockPersistedJobs.set(job.key, { ...job }); })
      .mockRejectedValueOnce(new Error("storage write interrupted"));
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-replacement",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });

    await renderHook().replace({
      bytes: 289420,
      durationMs: 12000,
      fileName: "replacement.mp4",
      mimeType: "video/mp4",
      uri: "file:///replacement.mp4",
    });

    expect(mockPersistedJobs.get(key)?.jobId).toBe("job-1");
    expect(mockPersistedJobs.get(provisionalKey)).toMatchObject({
      jobId: "job-replacement",
      sourceUri: "file:///compressed.mp4",
    });
    expect(deletePreparedEventCoverVideoSource).not.toHaveBeenCalledWith("file:///compressed.mp4");

    mockFetchEventCoverVideoStatusByTarget.mockResolvedValue(processingStatus({
      clientOperationId: mockPersistedJobs.get(provisionalKey)?.clientOperationId,
      jobId: "job-replacement",
      status: "source_uploading",
    }));
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );
    await renderHook().resume();

    expect(mockPersistedJobs.get(key)).toMatchObject({
      jobId: "job-replacement",
      sourceUri: "file:///compressed.mp4",
    });
    expect(mockPersistedJobs.has(provisionalKey)).toBe(false);
    expect(deletePreparedEventCoverVideoSource).toHaveBeenCalledWith("file:///prepared.mp4");
    expect(deletePreparedEventCoverVideoSource).not.toHaveBeenCalledWith("file:///compressed.mp4");
  });

  // [TEST-MOD-APPROVED #2715] Mount recovery may promote and upload only the
  // provisional bytes owned by the exact operation accepted by the server.
  test("mount recovers its own lost replacement acceptance and uploads its provisional bytes", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    const provisionalKey = `${key}:replacement`;
    const replacementOperationId = "55555555-5555-4555-8555-555555555555";
    mockPersistedJobs.set(key, persistedJob(key));
    mockPersistedJobs.set(provisionalKey, persistedJob(provisionalKey, {
      clientOperationId: replacementOperationId,
      jobId: null,
      sourceAcknowledged: false,
      sourceUri: "file:///replacement-prepared.mp4",
    }));
    mockFetchEventCoverVideoStatusByTarget.mockResolvedValue(processingStatus({
      clientOperationId: replacementOperationId,
      jobId: "job-own-replacement",
      status: "source_uploading",
    }));
    mockCreateEventCoverVideoUploadIntent.mockResolvedValue({
      jobId: "job-own-replacement",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });
    mockAcknowledgeEventCoverVideoSourceUploaded.mockResolvedValue(processingStatus({
      clientOperationId: replacementOperationId,
      jobId: "job-own-replacement",
      status: "processing",
    }));
    mockWaitForEventCoverVideoReady.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );

    renderHook();
    await mockFlushEffects();
    for (let index = 0; index < 100 && uploadEventCoverVideoSource.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(createEventCoverVideoUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: replacementOperationId }),
    );
    expect(uploadEventCoverVideoSource).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-own-replacement",
        uri: "file:///replacement-prepared.mp4",
      }),
    );
    expect(mockPersistedJobs.get(key)).toMatchObject({
      clientOperationId: replacementOperationId,
      jobId: "job-own-replacement",
      sourceUri: "file:///replacement-prepared.mp4",
    });
    expect(mockPersistedJobs.has(provisionalKey)).toBe(false);
  });

  // [TEST-MOD-APPROVED #2715] A different operation discovered by target is
  // external truth, never authority to consume this mount's provisional bytes.
  test("mount never consumes provisional bytes for a different-operation external replacement", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    const provisionalKey = `${key}:replacement`;
    const localOperationId = "55555555-5555-4555-8555-555555555555";
    mockPersistedJobs.set(key, persistedJob(key));
    mockPersistedJobs.set(provisionalKey, persistedJob(provisionalKey, {
      clientOperationId: localOperationId,
      jobId: null,
      sourceAcknowledged: false,
      sourceUri: "file:///local-provisional.mp4",
    }));
    mockFetchEventCoverVideoStatusByTarget.mockResolvedValue(processingStatus({
      clientOperationId: "66666666-6666-4666-8666-666666666666",
      jobId: "job-external-replacement",
      status: "source_uploading",
    }));
    mockFetchEventCoverVideoStatus.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );

    renderHook();
    await mockFlushEffects();
    for (let index = 0; index < 100 && fetchEventCoverVideoStatus.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(uploadEventCoverVideoSource).not.toHaveBeenCalled();
    expect(mockPersistedJobs.get(key)).toMatchObject({
      clientOperationId: "11111111-1111-4111-8111-111111111111",
      jobId: "job-1",
      sourceUri: "file:///prepared.mp4",
    });
    expect(mockPersistedJobs.has(provisionalKey)).toBe(false);
    expect(writePersistedCoverVideoJob).not.toHaveBeenCalledWith(
      expect.objectContaining({
        clientOperationId: localOperationId,
        jobId: "job-external-replacement",
        key,
      }),
    );
    expect(deletePreparedEventCoverVideoSource).not.toHaveBeenCalledWith("file:///prepared.mp4");
  });

  // [TEST-MOD-APPROVED #2715] Once a provisional journal records an accepted
  // job, even the same operation cannot bind its bytes to a different job.
  test("mount rejects a recovered job that conflicts with its provisional job id", async () => {
    const key = "event:09b4ece6-eabc-4734-8ce3-3a25d90417e4";
    const provisionalKey = `${key}:replacement`;
    const localOperationId = "55555555-5555-4555-8555-555555555555";
    mockPersistedJobs.set(key, persistedJob(key));
    mockPersistedJobs.set(provisionalKey, persistedJob(provisionalKey, {
      clientOperationId: localOperationId,
      jobId: "job-local-accepted",
      sourceAcknowledged: false,
      sourceUri: "file:///local-provisional.mp4",
    }));
    mockFetchEventCoverVideoStatusByTarget.mockResolvedValue(processingStatus({
      clientOperationId: localOperationId,
      jobId: "job-conflicting-recovery",
      status: "source_uploading",
    }));
    mockFetchEventCoverVideoStatus.mockRejectedValue(
      new MockEventCoverVideoProcessingError("edge_error", "Could not refresh status."),
    );

    renderHook();
    await mockFlushEffects();
    for (let index = 0; index < 100 && fetchEventCoverVideoStatus.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
    expect(uploadEventCoverVideoSource).not.toHaveBeenCalled();
    expect(mockPersistedJobs.get(key)?.jobId).toBe("job-1");
    expect(mockPersistedJobs.has(provisionalKey)).toBe(false);
    expect(writePersistedCoverVideoJob).not.toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-conflicting-recovery",
        key,
        sourceUri: "file:///local-provisional.mp4",
      }),
    );
  });

  test("delays the preparation card for 300ms without delaying the upload", async () => {
    jest.useFakeTimers();
    let acceptIntent!: (value: { jobId: string; upload: { protocol: string; uploadUrl: string } }) => void;
    (createEventCoverVideoUploadIntent as jest.Mock).mockImplementation(() =>
      new Promise((resolve) => { acceptIntent = resolve as typeof acceptIntent; })
    );

    const started = renderHook().start({
      bytes: 289420,
      durationMs: 12000,
      fileName: "cover.mp4",
      mimeType: "video/mp4",
      uri: "file:///cover.mp4",
    });
    for (let index = 0; index < 100 && createEventCoverVideoUploadIntent.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(createEventCoverVideoUploadIntent).toHaveBeenCalledTimes(1);
    expect(renderHook().stage).toMatchObject({ phase: "idle" });
    jest.advanceTimersByTime(299);
    expect(renderHook().stage).toMatchObject({ phase: "idle" });
    jest.advanceTimersByTime(1);
    expect(renderHook().stage.phase).not.toBe("idle");

    acceptIntent({
      jobId: "job-delayed-card",
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });
    await started;
    jest.useRealTimers();
  });
});
