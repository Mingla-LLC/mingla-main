// MINGLA-INVARIANT: I-VIDEO-STATUS-SEEN-WITHIN-5S | issue #3040 | once the bytes are acknowledged the client reflects a server ready or applied state within 5 s, polls at most every 3 s for 2 minutes and at most every 10 s after, and no single status request holds the watch
/**
 * #3040 D1 — observed 2026-10-19 on job a79a090d: the server applied the job
 * at 17:30:08, but one status request hung for 30.5 s and the loop then backed
 * off, so the sheet showed "Preparing 5%" until 17:30:45. These tests replay
 * that timeline with fake timers.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  nextStatusPollDelayMs,
  STATUS_REQUEST_TIMEOUT_MS,
  statusPollCapMs,
  waitForEventCoverVideoReady,
} from "../eventCoverVideoProcessingService";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));
jest.mock("expo-file-system/legacy", () => ({
  FileSystemSessionType: { FOREGROUND: 1 },
  FileSystemUploadType: { MULTIPART: 1 },
  createUploadTask: jest.fn(),
  getInfoAsync: jest.fn(),
}));
jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

type InvokeOptions = { body?: unknown; signal?: AbortSignal };
const invoke = supabase.functions.invoke as unknown as jest.MockedFunction<
  (name: string, options?: InvokeOptions) => Promise<{ data: unknown; error: unknown }>
>;

const base = {
  applyMode: "draft_auto", brandId: "brand_1", canCancel: true, canCheckAgain: true,
  canRetry: false, eventId: "event_1", isTerminal: false, jobId: "job_1",
  progressKind: "determinate", progressPercent: 5, stageLabel: "Processing video",
  status: "processing", sourceUploadedAt: new Date(0).toISOString(),
};
const applied = {
  ...base, canCancel: false, canCheckAgain: false, isTerminal: true,
  progressKind: "terminal", progressPercent: 100, stageLabel: "Video ready.",
  status: "applied", processedUrl: "https://cdn.example.com/final.mp4",
};

/** A request that never answers until it is aborted (the 30.5 s auth stall). */
const hangUntilAborted = (options?: InvokeOptions): Promise<{ data: unknown; error: unknown }> =>
  new Promise((_, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

describe("#3040 D1 — the status watch sees a finished job within seconds", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    invoke.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("server applied at T while a status request hangs → the watch resolves by T+5 s", async () => {
    const APPLIED_AT = 26_000; // job timeline: source uploaded at 0, applied 26 s later
    let hungOnce = false;
    invoke.mockImplementation((_name, options) => {
      const now = Date.now();
      // The first poll after the server applied hangs, exactly as observed.
      if (now >= APPLIED_AT - 2_000 && !hungOnce) {
        hungOnce = true;
        return hangUntilAborted(options);
      }
      return Promise.resolve({ data: now >= APPLIED_AT ? applied : base, error: null });
    });
    let resolvedAt: number | null = null;
    const watch = waitForEventCoverVideoReady("job_1", { pollIntervalMs: 2_000 })
      .then((status) => { resolvedAt = Date.now(); return status; });
    await jest.advanceTimersByTimeAsync(APPLIED_AT + 5_000);
    expect(hungOnce).toBe(true);
    expect(resolvedAt).not.toBeNull();
    expect((resolvedAt ?? Infinity) - APPLIED_AT).toBeLessThanOrEqual(5_000);
    await expect(watch).resolves.toMatchObject({ status: "applied" });
  });

  test("a hung request is abandoned after the request timeout", async () => {
    let calls = 0;
    invoke.mockImplementation((_name, options) => {
      calls += 1;
      return calls === 1 ? hangUntilAborted(options) : Promise.resolve({ data: applied, error: null });
    });
    const watch = waitForEventCoverVideoReady("job_1", { pollIntervalMs: 2_000 });
    await jest.advanceTimersByTimeAsync(STATUS_REQUEST_TIMEOUT_MS + 100);
    await expect(watch).resolves.toMatchObject({ status: "applied" });
    expect(calls).toBe(2);
  });

  test("polls never sit more than 3 s apart for the first 2 minutes, even through failures", async () => {
    const callTimes: number[] = [];
    invoke.mockImplementation(() => {
      callTimes.push(Date.now());
      // Every other request fails, which used to back off to 30 s.
      return callTimes.length % 2 === 0
        ? Promise.reject(new Error("edge 503"))
        : Promise.resolve({ data: base, error: null });
    });
    const controller = new AbortController();
    const watch = waitForEventCoverVideoReady("job_1", { pollIntervalMs: 2_000, signal: controller.signal });
    watch.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(119_000);
    controller.abort();
    await jest.advanceTimersByTimeAsync(10);
    const gaps = callTimes.slice(1).map((time, index) => time - callTimes[index]);
    expect(gaps.length).toBeGreaterThan(30);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(3_000);
  });

  test("after 2 minutes polls back off but never beyond 10 s, and a server hint is honoured within the caps", () => {
    expect(statusPollCapMs(0)).toBe(3_000);
    expect(statusPollCapMs(120_000)).toBe(10_000);
    expect(nextStatusPollDelayMs({ watchElapsedMs: 10_000, pollIntervalMs: 2_000 })).toBe(2_000);
    expect(nextStatusPollDelayMs({ watchElapsedMs: 10_000, pollIntervalMs: 2_000, failureCount: 6 })).toBe(3_000);
    expect(nextStatusPollDelayMs({ watchElapsedMs: 10_000, pollIntervalMs: 2_000, retryAfterMs: 2_500 })).toBe(2_500);
    expect(nextStatusPollDelayMs({ watchElapsedMs: 10_000, pollIntervalMs: 2_000, retryAfterMs: 60_000 })).toBe(3_000);
    expect(nextStatusPollDelayMs({ watchElapsedMs: 130_000, pollIntervalMs: 2_000 })).toBe(5_000);
    expect(nextStatusPollDelayMs({ watchElapsedMs: 130_000, pollIntervalMs: 2_000, failureCount: 9 })).toBe(10_000);
    expect(nextStatusPollDelayMs({ watchElapsedMs: 130_000, pollIntervalMs: 2_000, retryAfterMs: 90_000 })).toBe(10_000);
  });

  test("a server retry hint is carried on the status and slows the next poll", async () => {
    const callTimes: number[] = [];
    invoke.mockImplementation(() => {
      callTimes.push(Date.now());
      return Promise.resolve({
        data: callTimes.length >= 2 ? applied : { ...base, retryAfterMs: 2_800 },
        error: null,
      });
    });
    const watch = waitForEventCoverVideoReady("job_1", { pollIntervalMs: 2_000 });
    await jest.advanceTimersByTimeAsync(3_000);
    await expect(watch).resolves.toMatchObject({ status: "applied" });
    expect(callTimes[1] - callTimes[0]).toBe(2_800);
  });
});
