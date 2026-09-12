/* eslint-disable react-hooks/rules-of-hooks -- the controlled harness invokes
   the hook as a plain function under a mocked `react`; no React tree is
   rendered, so the rules-of-hooks ordering guarantee is N/A here. Same
   convention as useSupportStaff.test.ts and useVenueOrders.issue1791.test.ts. */
/**
 * Issue #3280 [cover sheet stale state] — implementor happy-path regression.
 *
 * PRODUCTION EVENT BEING REPRODUCED (job 273fc0a7, 2026-09-11):
 *   20:00:50  source uploaded, acknowledged
 *   20:00:51 → 20:03:14  `watch()` polls status every ~2.4s
 *   20:03:14  the watch dies. 125 seconds of total silence.
 *   20:04:11  the job goes `ready` server-side
 *   20:04:12  the job goes `applied` server-side
 * The open sheet never learned any of it. Its only channel to the outcome was
 * that one abortable promise chain, it was never re-armed, and its death was
 * silent by construction (a bare `return` in `startInternal`'s catch). The card
 * sat on "Processing video…" until the sheet was closed and reopened.
 *
 * This test drives exactly that: a real start → intent → upload → ack → watch,
 * then `waitForEventCoverVideoReady` rejects with an abort-shaped error while
 * the job is still `processing`. It asserts the three things that were missing:
 *   1. the hook asks the server AGAIN after the abort (the re-arm);
 *   2. the sheet ends on `applied` with the processed URL, with no remount;
 *   3. the abort is not swallowed — the stage moves to `detached` (honest copy
 *      plus a reachable Check now control) and leaves a Sentry breadcrumb.
 *
 * The harness is the controlled React lifecycle mock established by #2715 in
 * `useEventCoverVideoUpload.test.ts`: hand-rolled useState/useRef/useEffect so
 * effects run only when a test flushes them, and renders happen only when a
 * test asks for one. `renderHook()` between steps is what a real React
 * re-render does for `stageRef`.
 */
import { beforeEach, afterEach, describe, expect, jest, test } from "@jest/globals";

const mockStateSlots: unknown[] = [];
const mockRefSlots: { current: unknown }[] = [];
const mockPendingEffects: (() => void | (() => void))[] = [];
const mockEffectCleanups: (() => void)[] = [];
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

const mockUnmountEffects = (): void => {
  for (const cleanup of mockEffectCleanups.splice(0)) cleanup();
};

/** Let every pending microtask chain settle without advancing fake timers. */
const mockDrain = async (): Promise<void> => {
  for (let index = 0; index < 200; index += 1) await Promise.resolve();
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

const reportNonFatal = jest.fn();
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal }));

const mockPersistedJobs = new Map<string, Record<string, unknown>>();
jest.mock("../../services/eventCoverVideoJobPersistence", () => ({
  clearPersistedCoverVideoJobsForUser: jest.fn(),
  readPersistedCoverVideoJob: jest.fn(async (_userId: string, key: string) =>
    mockPersistedJobs.get(key) ?? null
  ),
  removePersistedCoverVideoJob: jest.fn(async (_userId: string, key: string) => {
    mockPersistedJobs.delete(key);
  }),
  writePersistedCoverVideoJob: jest.fn(async (job: { key: string }) => {
    mockPersistedJobs.set(job.key, { ...job });
  }),
}));

jest.mock("../../services/eventCoverVideoPreparedSource", () => ({
  deletePreparedEventCoverVideoSource: jest.fn(async () => undefined),
  prepareEventCoverVideoSource: jest.fn(async (input: {
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
  })),
}));

jest.mock("../../services/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-3280" } } } })),
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
const JOB_ID = "job-3280";

const VENUE_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const renderHook = (
  target: "event" | "brand" | "venue" = "event",
): ReturnType<typeof useEventCoverVideoUpload> => {
  mockResetRenderCursor();
  return useEventCoverVideoUpload(
    EVENT_ID,
    BRAND_ID,
    target === "event" ? "draft_auto" : "published_manual",
    target,
    target === "venue" ? { venueId: VENUE_ID } : {},
  );
};

type LooseMock = {
  mockResolvedValue: (value: unknown) => void;
  mockRejectedValue: (value: unknown) => void;
  mockImplementation: (implementation: (...args: unknown[]) => unknown) => void;
};

const loose = (fn: unknown): LooseMock => fn as unknown as LooseMock;

const processingStatus = (overrides: Record<string, unknown> = {}) => ({
  applyMode: "draft_auto",
  brandId: BRAND_ID,
  canCancel: true,
  canCheckAgain: false,
  canRetry: false,
  clientOperationId: null,
  eventId: EVENT_ID,
  isTerminal: false,
  jobId: JOB_ID,
  processedPosterUrl: null,
  processedUrl: null,
  progressKind: "indeterminate",
  progressPercent: null,
  stageLabel: "Processing video…",
  status: "processing",
  ...overrides,
});

const appliedStatus = () => processingStatus({
  canCancel: false,
  isTerminal: true,
  processedPosterUrl: "https://cdn.example.com/poster.jpg",
  processedUrl: "https://cdn.example.com/processed.mp4",
  progressKind: "terminal",
  progressPercent: 100,
  status: "applied",
});

const sourceFile = {
  bytes: 289_420,
  durationMs: 12_000,
  fileName: "cover.mp4",
  mimeType: "video/mp4",
  uri: "file:///cover.mp4",
};

/** The shape the service throws when a watch's signal aborts. */
const abortShapedError = (): Error =>
  new MockEventCoverVideoProcessingError("source_upload_cancelled", "Video upload was cancelled.");

describe("issue #3280 — an abandoned cover-video watch re-arms itself", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockResetReactHarness();
    mockPersistedJobs.clear();
    mockPlatform.OS = "ios";
    loose(compressVideoLocally).mockResolvedValue({
      bytes: 289_420,
      durationMs: 12_000,
      uri: "file:///compressed.mp4",
      wasCompressed: false,
    });
    loose(createEventCoverVideoUploadIntent).mockResolvedValue({
      jobId: JOB_ID,
      upload: { protocol: "tus", uploadUrl: "https://video.bunnycdn.com/tusupload" },
    });
    loose(uploadEventCoverVideoSource).mockResolvedValue(null);
    loose(acknowledgeEventCoverVideoSourceUploaded).mockResolvedValue(processingStatus());
    loose(fetchEventCoverVideoStatusByTarget).mockResolvedValue(null);
    loose(fetchEventCoverVideoStatus).mockResolvedValue(processingStatus());
    loose(applyEventCoverVideoJob).mockResolvedValue(appliedStatus());
  });

  afterEach(() => {
    mockUnmountEffects();
    jest.useRealTimers();
  });

  test("a watch aborted mid-encode detaches honestly, then finishes the job without a remount", async () => {
    // The watch dies while the job is still `processing`, and the abort
    // reaches `startInternal` only as a thrown abort-shaped error. Before the
    // fix this route fell through to the generic error branch and showed a
    // "couldn't finish this video" card for a job that was about to succeed.
    // The controller-aborted route (the literal bare `return`) is the next test.
    loose(waitForEventCoverVideoReady).mockRejectedValue(abortShapedError());

    const hook = renderHook();
    // Mount: installs the re-arm interval (and runs the mount-time resume,
    // which finds no job for this target and settles to idle).
    await mockFlushEffects();
    await mockDrain();
    expect(mockEffectCleanups).toHaveLength(1);

    await hook.start(sourceFile);
    await mockDrain();

    // --- assertion 3: the abort is not swallowed -----------------------------
    // Before the fix this read `{ phase: "error" }` for a job that succeeds.
    const afterAbort = renderHook();
    expect(afterAbort.stage).toMatchObject({ phase: "detached", sourceAcknowledged: true });
    expect(waitForEventCoverVideoReady).toHaveBeenCalledTimes(1);

    // The single targeted breadcrumb. Without it the next recurrence needs
    // forensics against edge logs all over again.
    // `lastPhase` is read from `stageRef`, which real React refreshes on every
    // re-render. This controlled harness only renders when a test asks, so the
    // ref lags here in a way it never does in the app — assert the field is
    // carried and populated, not its harness-specific value.
    expect(reportNonFatal).toHaveBeenCalledWith(
      "coverPicker.video",
      expect.any(Error),
      expect.objectContaining({ jobId: JOB_ID, lastPhase: expect.any(String) }),
      expect.any(Array),
    );

    // --- assertion 1: the hook asks the server AGAIN -------------------------
    const statusCallsBeforeRearm = fetchEventCoverVideoStatus.mock.calls.length;
    loose(fetchEventCoverVideoStatus).mockResolvedValue(appliedStatus());

    // Re-render so `stageRef` carries the detached phase, exactly as React
    // would after `setStage`, then let the 5s interval fire.
    renderHook();
    jest.advanceTimersByTime(5_000);
    await mockDrain();

    expect(fetchEventCoverVideoStatus.mock.calls.length).toBeGreaterThan(statusCallsBeforeRearm);
    expect(fetchEventCoverVideoStatus).toHaveBeenCalledWith(JOB_ID);

    // --- assertion 2: the sheet lands on the finished video ------------------
    const settled = renderHook();
    expect(settled.stage).toMatchObject({ phase: "applied", percent: 100 });
    expect(settled.processedUrl).toBe("https://cdn.example.com/processed.mp4");
    expect(settled.processedPosterUrl).toBe("https://cdn.example.com/poster.jpg");
  });

  test("the production route: the flow's own controller aborts mid-encode — the card no longer freezes on processing", async () => {
    // This is the exact line the 2026-09-11 freeze went through. Something
    // aborted the controller the upload flow installed (an unmount of the
    // picker subtree, or a resume that superseded the watch) while the job was
    // still encoding. `waitForEventCoverVideoReady` then rejects the way the
    // real service does — its delay listener fires on the aborted signal — and
    // `startInternal`'s catch saw `abortRef.current.signal.aborted === true` and
    // hit a bare `return`: no stage change, no error, no notice.
    loose(waitForEventCoverVideoReady).mockImplementation((...args: unknown[]) => {
      const options = args[1] as { signal?: AbortSignal; onStatus?: (next: unknown) => void };
      options.onStatus?.(processingStatus());
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(abortShapedError()), { once: true });
      });
    });

    const hook = renderHook();
    await mockFlushEffects();
    await mockDrain();

    const started = hook.start(sourceFile);
    for (let index = 0; index < 500 && waitForEventCoverVideoReady.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(waitForEventCoverVideoReady).toHaveBeenCalledTimes(1);
    expect(renderHook().stage).toMatchObject({ phase: "processing" });

    // Abort the controller the flow installed — without an unmount, so the
    // mount and its generation are still live. It is the only AbortController
    // this hook keeps in a ref.
    const controllerSlot = mockRefSlots.find((slot) => slot.current instanceof AbortController);
    expect(controllerSlot).toBeDefined();
    (controllerSlot?.current as AbortController).abort();
    await started;
    await mockDrain();

    // Before the fix: `{ phase: "processing" }`, forever.
    expect(renderHook().stage).toMatchObject({ phase: "detached", sourceAcknowledged: true });
    expect(reportNonFatal).toHaveBeenCalledTimes(1);

    // And the re-arm finishes the job with no remount.
    loose(fetchEventCoverVideoStatus).mockResolvedValue(appliedStatus());
    renderHook();
    jest.advanceTimersByTime(5_000);
    await mockDrain();
    const settled = renderHook();
    expect(settled.stage).toMatchObject({ phase: "applied" });
    expect(settled.processedUrl).toBe("https://cdn.example.com/processed.mp4");
  });

  test("a terminal answer stops the re-arm instead of polling forever", async () => {
    loose(waitForEventCoverVideoReady).mockRejectedValue(abortShapedError());

    const hook = renderHook();
    await mockFlushEffects();
    await mockDrain();
    await hook.start(sourceFile);
    await mockDrain();

    loose(fetchEventCoverVideoStatus).mockResolvedValue(appliedStatus());
    const callsBeforeRearm = fetchEventCoverVideoStatus.mock.calls.length;
    renderHook();
    jest.advanceTimersByTime(5_000);
    await mockDrain();

    // Precondition: the re-arm really fired and settled the job. Without it the
    // silence asserted below would prove nothing.
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(callsBeforeRearm + 1);
    expect(renderHook().stage).toMatchObject({ phase: "applied" });
    const callsAfterFirstRearm = fetchEventCoverVideoStatus.mock.calls.length;
    // `applied` is terminal, so the phase leaves the re-armable set and the
    // interval must go quiet rather than hammering the status endpoint.
    renderHook();
    jest.advanceTimersByTime(20_000);
    await mockDrain();
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(callsAfterFirstRearm);
    // Exactly one watch subscription was ever created: the re-arm saw a
    // terminal status and did not resubscribe.
    expect(waitForEventCoverVideoReady).toHaveBeenCalledTimes(1);
  });

  test("a still-processing answer resubscribes, so a brand cover still gets applied client-side", async () => {
    // The brand target is the worse case: the Bunny webhook only auto-applies
    // `event` + `draft_auto` jobs, so a brand cover is applied by the CLIENT in
    // `settleCanonical`. A dead watch there means nothing applies the cover at
    // all until some later mount happens to resume.
    loose(waitForEventCoverVideoReady).mockRejectedValue(abortShapedError());

    const hook = renderHook("brand");
    await mockFlushEffects();
    await mockDrain();
    await hook.start(sourceFile);
    await mockDrain();
    expect(renderHook("brand").stage).toMatchObject({ phase: "detached" });

    // Still encoding when the re-arm checks: it must resubscribe, not give up.
    // The canonical re-read AFTER the client-side apply then reports `applied`.
    loose(fetchEventCoverVideoStatus).mockResolvedValue(appliedStatus());
    (fetchEventCoverVideoStatus as jest.Mock).mockResolvedValueOnce(
      processingStatus() as never,
    );
    loose(waitForEventCoverVideoReady).mockResolvedValue(processingStatus({
      isTerminal: true,
      processedPosterUrl: "https://cdn.example.com/poster.jpg",
      processedUrl: "https://cdn.example.com/processed.mp4",
      status: "ready",
    }));
    renderHook("brand");
    jest.advanceTimersByTime(5_000);
    await mockDrain();

    expect(waitForEventCoverVideoReady).toHaveBeenCalledTimes(2);
    // A brand `ready` is applied by this client, then re-read as canonical.
    expect(applyEventCoverVideoJob).toHaveBeenCalled();
    expect(renderHook("brand").stage).toMatchObject({ phase: "applied" });
  });

  test("a venue re-arm never acknowledges the job itself, so CoverPicker's persist-then-acknowledge order is untouched", async () => {
    // Venue is the one target where the OWNER persists first and acknowledges
    // second (`persistReadyVideo` in CoverPicker, pinned by
    // CoverPicker.videoReadyIdempotency.test.ts). The server does not treat
    // `ready` as terminal, so the re-arm can legitimately see `ready` and
    // resubscribe. It must never call apply/acknowledge on its own, and once
    // the hook projects `applying` the phase is outside the re-armable set, so
    // nothing here can race the owner's save.
    loose(waitForEventCoverVideoReady).mockRejectedValue(abortShapedError());

    const hook = renderHook("venue");
    await mockFlushEffects();
    await mockDrain();
    await hook.start(sourceFile);
    await mockDrain();
    expect(renderHook("venue").stage).toMatchObject({ phase: "detached" });

    const readyVenue = processingStatus({
      processedPosterUrl: "https://cdn.example.com/poster.jpg",
      processedUrl: "https://cdn.example.com/processed.mp4",
      progressKind: "terminal",
      progressPercent: 100,
      status: "ready",
      targetKind: "venue",
    });
    loose(fetchEventCoverVideoStatus).mockResolvedValue(readyVenue);
    loose(waitForEventCoverVideoReady).mockResolvedValue(readyVenue);
    renderHook("venue");
    jest.advanceTimersByTime(5_000);
    await mockDrain();

    const afterRearm = renderHook("venue");
    expect(afterRearm.stage).toMatchObject({ phase: "applying" });
    expect(afterRearm.status).toMatchObject({ status: "ready" });
    expect(afterRearm.processedUrl).toBe("https://cdn.example.com/processed.mp4");
    // The hook never applies a venue job; only CoverPicker's acknowledgeApplied does.
    expect(applyEventCoverVideoJob).not.toHaveBeenCalled();

    // `applying` is not re-armable: the interval goes quiet while the owner saves.
    const callsWhileOwnerSaves = fetchEventCoverVideoStatus.mock.calls.length;
    const watchesWhileOwnerSaves = waitForEventCoverVideoReady.mock.calls.length;
    jest.advanceTimersByTime(20_000);
    await mockDrain();
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(callsWhileOwnerSaves);
    expect(waitForEventCoverVideoReady.mock.calls.length).toBe(watchesWhileOwnerSaves);
    expect(applyEventCoverVideoJob).not.toHaveBeenCalled();
  });

  test("a deliberate cancel stays silent — it must not surface a detached card", async () => {
    loose(waitForEventCoverVideoReady).mockRejectedValue(abortShapedError());
    loose(cancelEventCoverVideoJob).mockResolvedValue(
      processingStatus({ isTerminal: true, status: "cancelled" }),
    );

    const hook = renderHook();
    await mockFlushEffects();
    await mockDrain();
    await hook.start(sourceFile);
    await mockDrain();
    expect(renderHook().stage).toMatchObject({ phase: "detached" });

    reportNonFatal.mockClear();
    await hook.cancel();
    await mockDrain();

    expect(renderHook().stage).toMatchObject({ phase: "idle" });
    expect(reportNonFatal).not.toHaveBeenCalled();
    // And a cancelled job must never be re-armed back to life.
    const callsBefore = fetchEventCoverVideoStatus.mock.calls.length;
    renderHook();
    jest.advanceTimersByTime(15_000);
    await mockDrain();
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(callsBefore);
  });

  test("unmount clears the re-arm interval", async () => {
    loose(waitForEventCoverVideoReady).mockRejectedValue(abortShapedError());

    const hook = renderHook();
    await mockFlushEffects();
    await mockDrain();
    await hook.start(sourceFile);
    await mockDrain();
    renderHook();

    // Precondition: the interval is live while mounted. The job is still
    // processing, so the re-arm checks and resubscribes (and that watch dies
    // again the same way).
    const callsWhileMounted = fetchEventCoverVideoStatus.mock.calls.length;
    jest.advanceTimersByTime(5_000);
    await mockDrain();
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBeGreaterThan(callsWhileMounted);

    mockUnmountEffects();
    const callsBefore = fetchEventCoverVideoStatus.mock.calls.length;
    jest.advanceTimersByTime(30_000);
    await mockDrain();
    expect(fetchEventCoverVideoStatus.mock.calls.length).toBe(callsBefore);
  });
});
