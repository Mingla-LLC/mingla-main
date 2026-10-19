/**
 * #3040 T-A12 [A-12] — trip-day video uses the lane contract: a 60 MB, 45 s
 * clip is compressed (never refused at 25 MB, never read through JS), the
 * watch has an abort signal and a deadline, the same file resumes the same
 * operation, and no raw code reaches a toast.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type AnyFn = (...args: never[]) => unknown;
const mockRuntime = {
  applyEventCoverVideoJob: jest.fn<AnyFn>(),
  acknowledgeEventCoverVideoSourceUploaded: jest.fn<AnyFn>(),
  compressVideoLocally: jest.fn<AnyFn>(),
  createEventCoverVideoUploadIntent: jest.fn<AnyFn>(),
  deletePreparedEventCoverVideoSource: jest.fn<AnyFn>(async () => undefined),
  EVENT_COVER_MAX_VIDEO_DURATION_MS: 60_000,
  EventCoverVideoProcessingError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  prepareEventCoverVideoSource: jest.fn<AnyFn>(),
  uploadEventCoverVideoSource: jest.fn<AnyFn>(),
  waitForEventCoverVideoReady: jest.fn<AnyFn>(),
};
jest.mock("../eventCoverVideoAuthoringRuntime", () => mockRuntime);
const mockStore = new Map<string, { clientOperationId: string; jobId: string | null }>();
jest.mock("../eventCoverVideoJobPersistence", () => ({
  readPersistedCoverVideoJob: jest.fn(async (_u: string, key: string) => mockStore.get(key) ?? null),
  writePersistedCoverVideoJob: jest.fn(async (job: { key: string; clientOperationId: string; jobId: string | null }) => {
    mockStore.set(job.key, job);
  }),
  removePersistedCoverVideoJob: jest.fn(async (_u: string, key: string) => {
    mockStore.delete(key);
  }),
}));
const mockReadBytes = jest.fn();
jest.mock("../brandCoverFileReader", () => ({ readBrandCoverFileBytes: mockReadBytes }));
jest.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: "user-1" } } } })) },
    storage: { from: jest.fn() },
  },
}));

import {
  TRIP_DAY_MEDIA_IMAGE_MAX_BYTES,
  TRIP_DAY_VIDEO_WATCH_DEADLINE_MS,
  tripDayVideoErrorCopy,
  uploadTripDayMedia,
} from "../tripDayMediaService";

const SIXTY_MB = 60 * 1024 * 1024;

describe("#3040 T-A12 — trip-day lane contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    mockRuntime.compressVideoLocally.mockImplementation((async (input: { uri: string; bytes: number; durationMs: number }) => ({
      uri: "file:///cache/compressed.mp4", bytes: 30 * 1024 * 1024, durationMs: input.durationMs, wasCompressed: true,
    })) as never);
    mockRuntime.prepareEventCoverVideoSource.mockImplementation((async (input: { uri: string; bytes: number; durationMs: number; fileName: string; mimeType: string }) => ({
      ...input, extension: "mp4", sha256: "c".repeat(64), fingerprint: "fp",
    })) as never);
    mockRuntime.createEventCoverVideoUploadIntent.mockImplementation((async () => ({
      jobId: "job-t", upload: { url: "https://tus.example/t", fields: {}, protocol: "tus" },
    })) as never);
    mockRuntime.uploadEventCoverVideoSource.mockImplementation((async () => null) as never);
    mockRuntime.acknowledgeEventCoverVideoSourceUploaded.mockImplementation((async () => ({ status: "processing", progressPercent: null })) as never);
    mockRuntime.waitForEventCoverVideoReady.mockImplementation((async () => ({
      jobId: "job-t", status: "applied", applicationVersion: 1, processedUrl: "https://cdn.example/t/play_1080p.mp4",
    })) as never);
  });

  test("a 60 MB, 45 s video is compressed and uploaded, not refused, and never read through JS", async () => {
    const media = await uploadTripDayMedia("brand-1", "event-1", {
      uri: "file:///library/day.mov", mimeType: "video/quicktime", fileName: "day.mov", fileSize: SIXTY_MB, durationMs: 45_000,
    }, undefined, { dayKey: "day-2" });
    expect(media).toMatchObject({ type: "video", provider: "bunny", url: "https://cdn.example/t/play_1080p.mp4" });
    expect(mockRuntime.compressVideoLocally).toHaveBeenCalledWith(expect.objectContaining({ bytes: SIXTY_MB }));
    expect(mockReadBytes).not.toHaveBeenCalled();
    expect(mockRuntime.prepareEventCoverVideoSource).toHaveBeenCalledWith(expect.objectContaining({ ownedTemporary: true }));
  });

  test("the ready watch gets an abort signal and an 11-minute deadline", async () => {
    await uploadTripDayMedia("brand-1", "event-1", {
      uri: "file:///library/day.mp4", mimeType: "video/mp4", fileName: "day.mp4", fileSize: 1000, durationMs: 9_000,
    });
    const options = mockRuntime.waitForEventCoverVideoReady.mock.calls[0]?.[1] as unknown as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(TRIP_DAY_VIDEO_WATCH_DEADLINE_MS).toBe(660_000);
  });

  test("the same file resumes the same operation", async () => {
    mockRuntime.waitForEventCoverVideoReady.mockImplementation((async () => {
      throw Object.assign(new Error("network"), { code: "edge_error" });
    }) as never);
    await expect(uploadTripDayMedia("brand-1", "event-1", {
      uri: "file:///library/day.mp4", mimeType: "video/mp4", fileName: "day.mp4", fileSize: 1000, durationMs: 9_000,
    }, undefined, { dayKey: "d" })).rejects.toThrow();
    const first = (mockRuntime.createEventCoverVideoUploadIntent.mock.calls[0]?.[0] as unknown as { clientOperationId: string }).clientOperationId;
    mockRuntime.waitForEventCoverVideoReady.mockImplementation((async () => ({
      jobId: "job-t", status: "applied", applicationVersion: 1, processedUrl: "https://cdn.example/t/play_1080p.mp4",
    })) as never);
    await uploadTripDayMedia("brand-1", "event-1", {
      uri: "file:///library/day.mp4", mimeType: "video/mp4", fileName: "day.mp4", fileSize: 1000, durationMs: 9_000,
    }, undefined, { dayKey: "d" });
    const second = (mockRuntime.createEventCoverVideoUploadIntent.mock.calls[1]?.[0] as unknown as { clientOperationId: string }).clientOperationId;
    expect(second).toBe(first);
  });

  test("raw codes become host copy with no snake_case tokens", () => {
    const copy = tripDayVideoErrorCopy(new Error("video_source_type_unknown"));
    expect(copy).toBe("That video couldn't be used. Use MP4, MOV, M4V or WebM under 100 MB.");
    expect(copy).not.toMatch(/[a-z]+_[a-z]+/);
    expect(tripDayVideoErrorCopy(new Error("some_new_code"))).toBe("Couldn't upload that video. Try again.");
    expect(tripDayVideoErrorCopy(new Error("We couldn't read that video's duration. Choose it again."))).toContain("duration");
  });

  test("photos keep their 25 MB cap", () => {
    expect(TRIP_DAY_MEDIA_IMAGE_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
