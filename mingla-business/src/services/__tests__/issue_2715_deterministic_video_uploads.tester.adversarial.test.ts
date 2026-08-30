import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type HookInstance = {
  cleanups: Array<() => void>;
  effects: Array<() => void | (() => void)>;
  refs: Array<{ current: unknown }>;
  state: unknown[];
};

const mockHookInstances = new Map<string, HookInstance>();
let mockCurrentInstance = "";
let mockRefCursor = 0;
let mockStateCursor = 0;
const mockPlatform = { OS: "web" };

const mockInstance = (): HookInstance => {
  const instance = mockHookInstances.get(mockCurrentInstance);
  if (!instance) throw new Error(`missing hook instance ${mockCurrentInstance}`);
  return instance;
};

jest.mock("react", () => ({
  useCallback: jest.fn((callback: unknown) => callback),
  useEffect: jest.fn((effect: () => void | (() => void)) => {
    mockInstance().effects.push(effect);
  }),
  useMemo: jest.fn((factory: () => unknown) => factory()),
  useRef: jest.fn((initialValue: unknown) => {
    const instance = mockInstance();
    const index = mockRefCursor++;
    if (instance.refs[index] === undefined) instance.refs[index] = { current: initialValue };
    return instance.refs[index];
  }),
  useState: jest.fn((initialValue: unknown) => {
    const instance = mockInstance();
    const index = mockStateCursor++;
    if (instance.state[index] === undefined) instance.state[index] = initialValue;
    return [instance.state[index], (next: unknown) => {
      instance.state[index] = typeof next === "function"
        ? (next as (value: unknown) => unknown)(instance.state[index])
        : next;
    }];
  }),
}));

jest.mock("react-native", () => ({ Platform: mockPlatform }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockCompressVideoLocally = jest.fn();
const mockCreateIntent = jest.fn();
const mockUploadSource = jest.fn();
const mockAcknowledgeSource = jest.fn();
const mockWaitForReady = jest.fn();
const mockFetchStatus = jest.fn();
const mockFetchStatusByTarget = jest.fn();
const mockApply = jest.fn();
const mockCancel = jest.fn();
type ConfigurableMock = {
  mockImplementation: (implementation: (...args: never[]) => unknown) => unknown;
  mockResolvedValue: (value: unknown) => unknown;
};
const configurable = (value: unknown): ConfigurableMock => value as ConfigurableMock;

class MockProcessingError extends Error {
  readonly code: string;
  readonly lastStatus?: { isTerminal?: boolean };
  constructor(code: string, message: string, lastStatus?: { isTerminal?: boolean }) {
    super(message);
    this.code = code;
    this.lastStatus = lastStatus;
  }
}

jest.mock("../eventCoverVideoProcessingService", () => ({
  acknowledgeEventCoverVideoSourceUploaded: mockAcknowledgeSource,
  applyEventCoverVideoJob: mockApply,
  cancelEventCoverVideoJob: mockCancel,
  compressVideoLocally: mockCompressVideoLocally,
  createEventCoverVideoUploadIntent: mockCreateIntent,
  EventCoverVideoProcessingError: MockProcessingError,
  fetchEventCoverVideoStatus: mockFetchStatus,
  fetchEventCoverVideoStatusByTarget: mockFetchStatusByTarget,
  logEventCoverVideoUploadTelemetry: jest.fn(),
  uploadEventCoverVideoSource: mockUploadSource,
  waitForEventCoverVideoReady: mockWaitForReady,
}));

type Persisted = {
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

const mockPersisted = new Map<string, Persisted>();
const mockReadPersisted = jest.fn(async (_userId: string, key: string) => mockPersisted.get(key) ?? null);
const mockWritePersisted = jest.fn(async (job: Persisted) => { mockPersisted.set(job.key, { ...job }); });
const mockRemovePersisted = jest.fn(async (_userId: string, key: string) => { mockPersisted.delete(key); });

jest.mock("../eventCoverVideoJobPersistence", () => ({
  clearPersistedCoverVideoJobsForUser: jest.fn(),
  readPersistedCoverVideoJob: mockReadPersisted,
  removePersistedCoverVideoJob: mockRemovePersisted,
  writePersistedCoverVideoJob: mockWritePersisted,
}));

const mockDeletePrepared = jest.fn(async () => undefined);
const mockPrepareSource = jest.fn(async (input: {
  uri: string; bytes: number; durationMs: number; fileName?: string | null; mimeType?: string | null;
}) => ({
  uri: `prepared://${input.uri.split("/").pop()}`,
  bytes: input.bytes,
  durationMs: input.durationMs,
  fileName: input.fileName ?? null,
  mimeType: input.mimeType ?? null,
  extension: "mp4",
  sha256: input.uri.includes("draft-a") ? "a".repeat(64) : "b".repeat(64),
  fingerprint: input.uri,
}));

jest.mock("../eventCoverVideoPreparedSource", () => ({
  deletePreparedEventCoverVideoSource: mockDeletePrepared,
  prepareEventCoverVideoSource: mockPrepareSource,
}));

jest.mock("../supabase", () => ({
  supabase: { auth: {
    getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-2715" } } } })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
  } },
}));

jest.mock("../../hooks/useBrands", () => ({ brandKeys: { detail: (id: string) => [id], lists: () => [] } }));
jest.mock("../../hooks/useBusinessEvents", () => ({ businessEventKeys: { detail: (id: string) => [id], list: (id: string) => [id] } }));
jest.mock("../../hooks/usePublicEvents", () => ({ publicEventKeys: { detailById: (id: string) => [id] } }));
jest.mock("../../hooks/useServerDraftEvents", () => ({ eventDraftKeys: { detail: (id: string) => [id], list: (id: string) => [id] } }));
jest.mock("../../hooks/upcomingKeys", () => ({ upcomingKeys: { all: [] } }));

import { useEventCoverVideoUpload } from "../../hooks/useEventCoverVideoUpload";

const BRAND = "27150000-0000-4000-8000-000000000002";
const KEY_A = `venue-draft:${BRAND}:draft-a`;
const KEY_B = `venue-draft:${BRAND}:draft-b`;
const JOB_A = "27150000-0000-4000-8000-000000000031";
const JOB_B = "27150000-0000-4000-8000-000000000032";

const status = (jobId: string, state: "processing" | "ready") => ({
  applyMode: "published_manual",
  applicationReceipt: null,
  applicationVersion: 0,
  brandId: BRAND,
  canCancel: state === "processing",
  canCheckAgain: state === "processing",
  canRetry: false,
  draftOwnerKey: jobId === JOB_A ? "draft-a" : "draft-b",
  eventId: null,
  failureCode: null,
  failureMessage: null,
  isTerminal: false,
  jobId,
  processedPosterUrl: state === "ready" ? `https://cdn.test/${jobId}.jpg` : null,
  processedUrl: state === "ready" ? `https://cdn.test/${jobId}.mp4` : null,
  progressKind: "indeterminate",
  progressPercent: null,
  safeJobCode: jobId.slice(0, 8),
  sourceUploadedAt: "2026-08-27T00:00:00.000Z",
  stageLabel: state === "ready" ? "Video ready." : "Processing video…",
  status: state,
  targetKind: "venue_draft",
  venueId: null,
});

const renderDraft = (instanceId: string, draftOwnerKey: string) => {
  if (!mockHookInstances.has(instanceId)) {
    mockHookInstances.set(instanceId, { cleanups: [], effects: [], refs: [], state: [] });
  }
  mockCurrentInstance = instanceId;
  mockRefCursor = 0;
  mockStateCursor = 0;
  return useEventCoverVideoUpload("unused-event", BRAND, "published_manual", "venue_draft", { draftOwnerKey });
};

const flushMount = async (instanceId: string): Promise<void> => {
  const instance = mockHookInstances.get(instanceId)!;
  for (const effect of instance.effects.splice(0)) {
    const cleanup = effect();
    if (typeof cleanup === "function") instance.cleanups.push(cleanup);
  }
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

const unmount = (instanceId: string): void => {
  const instance = mockHookInstances.get(instanceId)!;
  for (const cleanup of instance.cleanups.splice(0)) cleanup();
  mockHookInstances.delete(instanceId);
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let index = 0; index < 100 && !predicate(); index += 1) await Promise.resolve();
  if (!predicate()) throw new Error("hook lifecycle did not reach the expected checkpoint");
};

describe("#2715 tester adversarial: mounted durable venue-draft lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHookInstances.clear();
    mockPersisted.clear();
    mockPlatform.OS = "web";
    configurable(mockCompressVideoLocally).mockImplementation(async (input: { uri: string; bytes: number; durationMs: number }) => ({ ...input, wasCompressed: false }));
    configurable(mockUploadSource).mockResolvedValue(null);
    configurable(mockFetchStatusByTarget).mockResolvedValue(null);
    configurable(mockApply).mockResolvedValue(null);
    configurable(mockCancel).mockResolvedValue(null);
  });

  test("two same-brand drafts survive interrupted acknowledgement/status and remount without cross-attachment", async () => {
    const acknowledgementA = deferred<ReturnType<typeof status>>();
    let remounting = false;
    configurable(mockCreateIntent).mockImplementation(async (input: { draftOwnerKey: string }) => ({
      jobId: input.draftOwnerKey === "draft-a" ? JOB_A : JOB_B,
      upload: { fields: {}, url: "https://tus.test/files" },
    }));
    configurable(mockAcknowledgeSource).mockImplementation(async (input: { jobId: string }) =>
      input.jobId === JOB_A ? acknowledgementA.promise : status(JOB_B, "processing"));
    configurable(mockFetchStatus).mockImplementation(async (jobId: string) => status(jobId, "processing"));
    configurable(mockWaitForReady).mockImplementation((jobId: string, options: { signal: AbortSignal }) => {
      if (remounting) return Promise.resolve(status(jobId, "ready"));
      return new Promise((_, reject) => {
        const fail = () => reject(new MockProcessingError("aborted", "aborted"));
        if (options.signal.aborted) fail();
        else options.signal.addEventListener("abort", fail, { once: true });
      });
    });

    const draftA = renderDraft("mount-a", "draft-a");
    const draftB = renderDraft("mount-b", "draft-b");
    await Promise.all([flushMount("mount-a"), flushMount("mount-b")]);

    const startA = draftA.start({ uri: "file:///draft-a.mp4", bytes: 717_000, durationMs: 4_900, fileName: "a.mp4", mimeType: "video/mp4" });
    const startB = draftB.start({ uri: "file:///draft-b.mp4", bytes: 718_000, durationMs: 5_000, fileName: "b.mp4", mimeType: "video/mp4" });
    await waitUntil(() => mockPersisted.get(KEY_B)?.sourceAcknowledged === true);

    expect(mockPersisted.get(KEY_A)).toMatchObject({ jobId: JOB_A, sourceAcknowledged: false, sourceUri: "prepared://draft-a.mp4" });
    expect(mockPersisted.get(KEY_B)).toMatchObject({ jobId: JOB_B, sourceAcknowledged: true, sourceUri: "prepared://draft-b.mp4" });

    unmount("mount-a");
    unmount("mount-b");
    acknowledgementA.resolve(status(JOB_A, "processing"));
    await Promise.all([startA, startB]);
    expect(mockPersisted.get(KEY_A)).toMatchObject({ jobId: JOB_A, sourceAcknowledged: true });
    expect(mockPersisted.get(KEY_B)).toMatchObject({ jobId: JOB_B, sourceAcknowledged: true });

    remounting = true;
    renderDraft("remount-a", "draft-a");
    renderDraft("remount-b", "draft-b");
    await Promise.all([flushMount("remount-a"), flushMount("remount-b")]);
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    const recoveredA = renderDraft("remount-a", "draft-a");
    const recoveredB = renderDraft("remount-b", "draft-b");
    expect(recoveredA.status).toMatchObject({ jobId: JOB_A, draftOwnerKey: "draft-a", processedUrl: `https://cdn.test/${JOB_A}.mp4` });
    expect(recoveredB.status).toMatchObject({ jobId: JOB_B, draftOwnerKey: "draft-b", processedUrl: `https://cdn.test/${JOB_B}.mp4` });
    expect(recoveredA.stage.phase).toBe("applying");
    expect(recoveredB.stage.phase).toBe("applying");
    expect(mockReadPersisted).toHaveBeenCalledWith("user-2715", KEY_A);
    expect(mockReadPersisted).toHaveBeenCalledWith("user-2715", KEY_B);
    expect(mockFetchStatus).toHaveBeenCalledWith(JOB_A, expect.any(AbortSignal));
    expect(mockFetchStatus).toHaveBeenCalledWith(JOB_B, expect.any(AbortSignal));
    expect(mockCreateIntent).toHaveBeenCalledTimes(2);
  });
});
