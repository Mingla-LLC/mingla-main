import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

import { validateNativeTrimmedEventCoverVideo } from "../../utils/eventCoverNativeVideo";
import { waitForEventCoverVideoReady } from "../eventCoverVideoProcessingService";
import { supabase } from "../supabase";

const SOURCE_LIMIT = 100 * 1024 * 1024;
const limits = { maxDurationMs: 15_000, maxSourceBytes: SOURCE_LIMIT, allowWebm: false };
const video = (overrides: Record<string, unknown> = {}) => ({
  duration: 4_900,
  fileName: "cover.mp4",
  fileSize: 717 * 1024,
  mimeType: "video/mp4",
  uri: "file:///cover.mp4",
  ...overrides,
});
type AsyncMock = {
  mockImplementation: (implementation: (...args: unknown[]) => unknown) => AsyncMock;
  mockResolvedValue: (value: unknown) => AsyncMock;
  mockResolvedValueOnce: (value: unknown) => AsyncMock;
  mockRejectedValueOnce: (value: unknown) => AsyncMock;
};
const invoke = supabase.functions.invoke as unknown as AsyncMock;
const getSession = supabase.auth.getSession as unknown as AsyncMock;

describe("#2715 deterministic cover-video runtime contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSession.mockResolvedValue({
      data: { session: { access_token: "user-session-jwt" } },
      error: null,
    });
  });

  test("accepts exactly 100 MiB and rejects the next byte before upload intent", () => {
    expect(validateNativeTrimmedEventCoverVideo(video({ fileSize: SOURCE_LIMIT }), limits)).toMatchObject({
      ok: true,
      uploadFields: { sourceBytes: SOURCE_LIMIT },
    });
    expect(validateNativeTrimmedEventCoverVideo(video({ fileSize: SOURCE_LIMIT + 1 }), limits)).toMatchObject({
      code: "video_file_too_large",
      ok: false,
    });
  });

  test("accepts exactly 15,000 ms and rejects 15,001 ms", () => {
    expect(validateNativeTrimmedEventCoverVideo(video({ duration: 15_000 }), limits)).toMatchObject({
      ok: true,
      uploadFields: { sourceDurationMs: 15_000, trimEndMs: 15_000, trimStartMs: 0 },
    });
    expect(validateNativeTrimmedEventCoverVideo(video({ duration: 15_001 }), limits)).toMatchObject({
      code: "video_too_long",
      ok: false,
    });
  });

  test("accepts native MP4/MOV/M4V identity and gates WebM by platform", () => {
    for (const [fileName, mimeType] of [
      ["cover.mp4", "video/mp4"],
      ["cover.mov", "video/quicktime"],
      ["cover.m4v", "video/x-m4v"],
    ]) {
      expect(validateNativeTrimmedEventCoverVideo(video({ fileName, mimeType, uri: `file:///${fileName}` }), limits)).toMatchObject({ ok: true });
    }
    expect(validateNativeTrimmedEventCoverVideo(video({ fileName: "cover.webm", mimeType: "video/webm" }), limits)).toMatchObject({ code: "video_format_unsupported", ok: false });
    expect(validateNativeTrimmedEventCoverVideo(video({ fileName: "cover.webm", mimeType: "video/webm" }), { ...limits, allowWebm: true })).toMatchObject({ ok: true });
  });

  test("keeps one provider job alive beyond 18m25s and resolves later server truth", async () => {
    // [TEST-MOD-APPROVED #2715] The former 120-second deadline must never
    // terminate authoritative provider work.
    jest.useFakeTimers({ now: 0 });
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      const processing = {
        applyMode: "draft_auto", brandId: "brand_1", canCancel: true,
        canCheckAgain: true, canRetry: false, eventId: "event_1",
        isTerminal: false, jobId: "job_2715", progressKind: "indeterminate",
        progressPercent: null, stageLabel: "Processing video", status: "processing",
      };
      const ready = {
        ...processing, canCancel: false, canCheckAgain: false, isTerminal: true,
        processedUrl: "https://cdn.example.com/final.mp4", progressKind: "terminal",
        progressPercent: 100, stageLabel: "Video ready.", status: "ready",
      };
      invoke.mockImplementation(async () => Date.now() <= 1_105_000
        ? { data: processing, error: null }
        : { data: ready, error: null });

      const seen: string[] = [];
      const pending = waitForEventCoverVideoReady("job_2715", {
        onStatus: (status) => seen.push(status.status),
        pollIntervalMs: 30_000,
        timeoutMs: 120_000,
      });
      let settled = false;
      void pending.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      await jest.advanceTimersByTimeAsync(1_104_999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(5_001);
      await expect(pending).resolves.toMatchObject({ jobId: "job_2715", status: "ready" });
      expect(seen.at(-1)).toBe("ready");
      expect(seen.filter((state) => state === "processing").length).toBeGreaterThan(30);
    } finally {
      random.mockRestore();
      jest.useRealTimers();
    }
  });
});
