/**
 * #3040 — the controlled lifecycle harness for `useEventCoverVideoUpload`
 * regression suites (same shape as the #2715 harness in
 * `useEventCoverVideoUpload.test.ts`): React's hooks are replaced by slot
 * arrays, effects run only when a test flushes them, and every service the
 * hook calls is a jest.fn. Suites wire it with
 *   jest.mock("react", () => require("./issue3040HookHarness").reactMock)
 * and friends. Not a test file itself (no `.test.` in the name).
 */
import { jest } from "@jest/globals";

const stateSlots: unknown[] = [];
const refSlots: Array<{ current: unknown }> = [];
const pendingEffects: Array<() => void | (() => void)> = [];
const effectCleanups: Array<() => void> = [];
let stateCursor = 0;
let refCursor = 0;

export const platform = { OS: "ios" };

export const resetRenderCursor = (): void => {
  stateCursor = 0;
  refCursor = 0;
};

export const resetReactHarness = (): void => {
  stateSlots.length = 0;
  refSlots.length = 0;
  pendingEffects.length = 0;
  effectCleanups.length = 0;
  resetRenderCursor();
};

export const flushEffects = async (): Promise<void> => {
  const pending = pendingEffects.splice(0);
  for (const effect of pending) {
    const cleanup = effect();
    if (typeof cleanup === "function") effectCleanups.push(cleanup);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

export const unmountEffects = (): void => {
  for (const cleanup of effectCleanups.splice(0)) cleanup();
};

export const settle = async (rounds = 40): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

export const reactMock = {
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    pendingEffects.push(effect);
  },
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initialValue: unknown) => {
    const index = refCursor;
    refCursor += 1;
    if (refSlots[index] === undefined) refSlots[index] = { current: initialValue };
    return refSlots[index];
  },
  useState: (initialValue: unknown) => {
    const index = stateCursor;
    stateCursor += 1;
    if (stateSlots[index] === undefined) {
      stateSlots[index] = typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue;
    }
    const setState = (nextValue: unknown): void => {
      stateSlots[index] =
        typeof nextValue === "function"
          ? (nextValue as (previous: unknown) => unknown)(stateSlots[index])
          : nextValue;
    };
    return [stateSlots[index], setState];
  },
};

/** The production error's shape (code, edgeDetail, lastStatus). */
export class HarnessProcessingError extends Error {
  readonly code: string;
  readonly edgeDetail?: string;
  readonly lastStatus?: unknown;
  constructor(code: string, message: string, metadata?: { edgeDetail?: string; lastStatus?: unknown }) {
    super(message);
    this.name = "EventCoverVideoProcessingError";
    this.code = code;
    this.edgeDetail = metadata?.edgeDetail;
    this.lastStatus = metadata?.lastStatus;
  }
}

type AnyFn = (...args: never[]) => unknown;
const fn = (): jest.Mock<AnyFn> => jest.fn<AnyFn>();

export const service = {
  acknowledgeEventCoverVideoSourceUploaded: fn(),
  applyEventCoverVideoJob: fn(),
  cancelEventCoverVideoJob: fn(),
  compressVideoLocally: fn(),
  createEventCoverVideoUploadIntent: fn(),
  EventCoverVideoProcessingError: HarnessProcessingError,
  EVENT_COVER_SOURCE_CEILING_MS: 60_000,
  fetchEventCoverVideoStatus: fn(),
  fetchEventCoverVideoStatusByTarget: fn(),
  logEventCoverVideoUploadTelemetry: fn(),
  uploadEventCoverVideoSource: fn(),
  waitForEventCoverVideoReady: fn(),
};

export type PersistedJob = {
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

export const persistedJobs = new Map<string, PersistedJob>();
export const persistence = {
  clearPersistedCoverVideoJobsForUser: fn(),
  readPersistedCoverVideoJob: jest.fn(async (_userId: string, key: string) => persistedJobs.get(key) ?? null),
  writePersistedCoverVideoJob: jest.fn(async (job: PersistedJob) => {
    persistedJobs.set(job.key, { ...job });
  }),
  removePersistedCoverVideoJob: jest.fn(async (_userId: string, key: string) => {
    persistedJobs.delete(key);
  }),
};

export const prepared = {
  prepareEventCoverVideoSource: jest.fn(async (input: {
    uri: string; bytes: number; durationMs: number; fileName?: string | null; mimeType?: string | null;
  }) => {
    const sha256 = input.uri.includes("different") ? "b".repeat(64) : "a".repeat(64);
    return {
      uri: input.uri,
      bytes: input.bytes,
      durationMs: input.durationMs,
      fileName: input.fileName ?? "clip.mp4",
      mimeType: input.mimeType ?? "video/mp4",
      extension: "mp4",
      sha256,
      fingerprint: `${sha256}:${input.bytes}`,
    };
  }),
  deletePreparedEventCoverVideoSource: jest.fn(async () => undefined),
};

export const presence = {
  preparedSourceStillExists: jest.fn(async () => true),
};

export const supabaseMock = {
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-3040" } } } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  },
};

export const keyMocks = {
  businessEvents: { businessEventKeys: { detail: (id: string) => ["be", id], list: (id: string) => ["bel", id] } },
  drafts: { eventDraftKeys: { detail: (id: string) => ["de", id], list: (id: string) => ["del", id] } },
  publicEvents: { publicEventKeys: { detailById: (id: string) => ["pe", id] } },
  upcoming: { upcomingKeys: { all: ["upcoming"] } },
  brands: { brandKeys: { detail: (id: string) => ["b", id], lists: () => ["bl"] } },
  queryClient: { useQueryClient: () => ({ invalidateQueries: jest.fn() }) },
};

export const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
export const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";

export const status = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  applyMode: "published_manual",
  applicationVersion: 1,
  brandId: BRAND_ID,
  canCancel: true,
  clientOperationId: "op-1",
  eventId: EVENT_ID,
  failureCode: null,
  failureMessage: null,
  isTerminal: false,
  jobId: "job-1",
  processedPosterUrl: null,
  processedUrl: null,
  progressKind: "indeterminate",
  progressPercent: null,
  sourceUploadedAt: null,
  status: "processing",
  targetKind: "event",
  ...overrides,
});

export const persistedJob = (key: string, overrides: Partial<PersistedJob> = {}): PersistedJob => ({
  userId: "user-3040",
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
  sourceAcknowledged: false,
  ...overrides,
});

/** Default happy wiring; suites override per test. */
export const resetAll = (): void => {
  jest.clearAllMocks();
  resetReactHarness();
  persistedJobs.clear();
  platform.OS = "ios";
  service.compressVideoLocally.mockImplementation((async (input: { uri: string; bytes: number; durationMs: number }) => ({
    uri: input.uri, bytes: input.bytes, durationMs: input.durationMs, wasCompressed: false,
  })) as unknown as AnyFn);
  service.createEventCoverVideoUploadIntent.mockImplementation((async () => ({
    jobId: "job-1",
    upload: { url: "https://tus.example/1", fields: {}, protocol: "tus" },
  })) as unknown as AnyFn);
  service.uploadEventCoverVideoSource.mockImplementation((async () => null) as unknown as AnyFn);
  service.acknowledgeEventCoverVideoSourceUploaded.mockImplementation((async () => status()) as unknown as AnyFn);
  service.waitForEventCoverVideoReady.mockImplementation((async () => status({
    status: "applied", isTerminal: true, processedUrl: "https://cdn.example/job-1/play_1080p.mp4",
  })) as unknown as AnyFn);
  service.fetchEventCoverVideoStatus.mockImplementation((async () => status()) as unknown as AnyFn);
  service.fetchEventCoverVideoStatusByTarget.mockImplementation((async () => null) as unknown as AnyFn);
  service.applyEventCoverVideoJob.mockImplementation((async () => "https://cdn.example/job-1/play_1080p.mp4") as unknown as AnyFn);
  service.cancelEventCoverVideoJob.mockImplementation((async () => status({ status: "cancelled", isTerminal: true })) as unknown as AnyFn);
  presence.preparedSourceStillExists.mockImplementation(async () => true);
};
