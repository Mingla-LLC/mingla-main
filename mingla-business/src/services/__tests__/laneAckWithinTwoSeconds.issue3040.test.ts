// MINGLA-INVARIANT: I-VIDEO-ACK-NEVER-BEHIND-SIGN-IN | issue #3040 | once the server accepts the final byte the client calls event-cover-video-source-uploaded within 2 s, and no video-lane edge call waits on the auth lock for more than 2 s
/**
 * #3040 — observed 2026-10-19 on job 2ad825b6 (Host web, trip-day video).
 * Every lane edge call used to go through `supabase.functions.invoke`, whose
 * fetch wrapper awaits `auth.getSession()` before sending — queued, with no
 * bound, behind whatever holds the auth lock in the tab (the boot `getUser()`
 * probe timed out after 5 s in that session). These tests replay a stalled
 * lock with fake timers and a fake TUS server.
 *
 * FAILS ON REVERT:
 *   A1  the lane calls go back to `supabase.functions.invoke` (the held token
 *       is never used, the request waits on getSession forever)
 *   A2  `resolveLaneAccessToken` loses its SESSION_ACQUIRE_TIMEOUT_MS race
 *   A3  the web upload's confirming HEAD is unbounded again
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  acknowledgeEventCoverVideoSourceUploaded,
  uploadEventCoverVideoSource,
} from "../eventCoverVideoProcessingService";
import { resetLaneSessionForTests, resolveLaneAccessToken, SESSION_ACQUIRE_TIMEOUT_MS } from "../laneEdgeInvoke";
import { supabase } from "../supabase";
import { BusinessAuthNotReadyError } from "../../utils/authReadiness";

type AuthListener = (event: string, session: { access_token: string; expires_at: number } | null) => void;
const mockAuthListeners: AuthListener[] = [];

jest.mock("../supabase", () => ({
  laneEdgeEndpoint: {
    functionsUrl: "https://project.supabase.co/functions/v1",
    anonKey: "anon-key",
    headers: {},
  },
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn((listener: AuthListener) => {
        mockAuthListeners.push(listener);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
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

const getSession = supabase.auth.getSession as unknown as jest.Mock;
const invoke = supabase.functions.invoke as unknown as jest.Mock;

const ACK_URL = "https://project.supabase.co/functions/v1/event-cover-video-source-uploaded";
const TUS_URL = "https://video.bunnycdn.com/tusupload";

const acknowledged = {
  applyMode: "published_manual", brandId: "brand_1", canCancel: true, eventId: "event_1",
  isTerminal: false, jobId: "job_1", progressKind: "indeterminate", stageLabel: "Preparing",
  status: "source_uploaded", sourceUploadedAt: new Date(0).toISOString(),
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

/** A lock that is never released while the test runs. */
const stalledLock = (): Promise<never> => new Promise<never>(() => undefined);

const announce = (expiresInMs: number): void => {
  for (const listener of mockAuthListeners) {
    listener("TOKEN_REFRESHED", { access_token: "held-jwt", expires_at: (Date.now() + expiresInMs) / 1000 });
  }
};

type FetchCall = { url: string; method: string; at: number; headers: Record<string, string> };
let fetchCalls: FetchCall[] = [];
let tusOffset = 0;
let hangConfirmingHead = false;

const jsonResponse = (body: unknown): Response => ({
  ok: true,
  status: 200,
  headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
}) as unknown as Response;

const installFetch = (): void => {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    fetchCalls.push({ url, method, at: Date.now(), headers: { ...(init.headers as Record<string, string>) } });
    if (url.startsWith("blob:")) {
      return { blob: async () => new Blob([new Uint8Array(6_064_284)]) } as unknown as Response;
    }
    if (url === TUS_URL && method === "HEAD") {
      if (hangConfirmingHead && tusOffset === 6_064_284) {
        // The HEAD that would confirm the FINAL byte never answers.
        return await new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return { ok: true, status: 200, headers: { get: (name: string) => (name === "Upload-Offset" ? String(tusOffset) : null) } } as unknown as Response;
    }
    if (url === ACK_URL) return jsonResponse(acknowledged);
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
};

/** Browser XHR: hands every byte to the "network" at once, answers 204 at once. */
class FakeXhr {
  upload: { onprogress?: (event: { loaded: number }) => void } = {};
  status = 0;
  onload?: () => void;
  onerror?: () => void;
  open(): void {}
  setRequestHeader(): void {}
  getResponseHeader(name: string): string | null { return name === "Upload-Offset" ? String(tusOffset) : null; }
  abort(): void {}
  send(blob: Blob): void {
    this.upload.onprogress?.({ loaded: blob.size });
    // Not queueMicrotask: jest's fake timers own it.
    void Promise.resolve().then(() => {
      tusOffset += blob.size;
      this.status = 204;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  resetLaneSessionForTests();
  mockAuthListeners.length = 0;
  getSession.mockReset();
  invoke.mockReset();
  fetchCalls = [];
  tusOffset = 0;
  hangConfirmingHead = false;
  installFetch();
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("#3040 — a finished upload is confirmed within seconds, never stuck behind sign-in", () => {
  test("A1 a stalled auth lock does not hold the acknowledgement: the held token is used at once", async () => {
    getSession.mockImplementation(stalledLock);
    let settled: unknown = null;
    // First lane call subscribes to auth events; the auth client then
    // announces the session it already holds.
    const first = acknowledgeEventCoverVideoSourceUploaded({ jobId: "job_1", brandId: "brand_1", eventId: "event_1", target: "trip_day_media" })
      .then((value) => { settled = value; });
    announce(60 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(SESSION_ACQUIRE_TIMEOUT_MS);
    await first;
    expect(settled).toMatchObject({ status: "source_uploaded" });

    fetchCalls = [];
    const startedAt = Date.now();
    const second = await acknowledgeEventCoverVideoSourceUploaded({ jobId: "job_1", brandId: "brand_1", eventId: "event_1", target: "trip_day_media" });
    expect(second.status).toBe("source_uploaded");
    const ack = fetchCalls.find((call) => call.url === ACK_URL);
    expect(ack?.at).toBe(startedAt);
    expect(ack?.headers.Authorization).toBe("Bearer held-jwt");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("A2 with a token about to expire and the lock stalled, the wait on the lock is at most 2 s", async () => {
    getSession.mockImplementation(stalledLock);
    const startedAt = Date.now();
    const pending = acknowledgeEventCoverVideoSourceUploaded({ jobId: "job_1", brandId: "brand_1", target: "event", eventId: "event_1" });
    // Valid for 10 more seconds: inside the reuse margin, so getSession is
    // asked first — but never for longer than its bound.
    announce(10_000);
    await jest.advanceTimersByTimeAsync(SESSION_ACQUIRE_TIMEOUT_MS - 1);
    expect(fetchCalls.some((call) => call.url === ACK_URL)).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ status: "source_uploaded" });
    const ack = fetchCalls.find((call) => call.url === ACK_URL);
    expect(ack?.at).toBe(startedAt + SESSION_ACQUIRE_TIMEOUT_MS);
    expect(SESSION_ACQUIRE_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });

  test("A2 no session at all and the lock stalled: a fast 'finishing sign-in', never a hang", async () => {
    getSession.mockImplementation(stalledLock);
    const pending = acknowledgeEventCoverVideoSourceUploaded({ jobId: "job_1", brandId: "brand_1", target: "event", eventId: "event_1" });
    const outcome = pending.then(() => "resolved", (error: unknown) => error);
    await jest.advanceTimersByTimeAsync(3 * SESSION_ACQUIRE_TIMEOUT_MS + 1_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(BusinessAuthNotReadyError);
    expect(fetchCalls.some((call) => call.url === ACK_URL)).toBe(false);
  });

  test("A3 final byte accepted, then the acknowledgement is sent within 2 s (slow confirming HEAD, stalled lock)", async () => {
    getSession.mockImplementation(stalledLock);
    // The auth client already announced its session (normal signed-in tab).
    resolveLaneAccessToken().catch(() => undefined);
    announce(60 * 60 * 1000);
    await flush();
    fetchCalls = [];
    hangConfirmingHead = true;

    const percents: number[] = [];
    let finalAcceptedAt: number | null = null;
    const flow = (async () => {
      await uploadEventCoverVideoSource({
        upload: { protocol: "tus", url: TUS_URL, fields: { AuthorizationSignature: "sig" } },
        uri: "blob:job-2ad825b6",
        bytes: 6_064_284,
        onProgress: (progress) => percents.push(progress.percent ?? -1),
      });
      // What the hook and the trip-day sheet both do next.
      return await acknowledgeEventCoverVideoSourceUploaded({ jobId: "job_1", brandId: "brand_1", target: "trip_day_media", eventId: "event_1" });
    })();
    for (let step = 0; step < 40 && finalAcceptedAt === null; step += 1) {
      await flush();
      if (tusOffset === 6_064_284) finalAcceptedAt = Date.now();
    }
    expect(finalAcceptedAt).not.toBeNull();
    await jest.advanceTimersByTimeAsync(2_000);
    const ack = fetchCalls.find((call) => call.url === ACK_URL);
    expect(ack).toBeDefined();
    expect((ack as FetchCall).at - (finalAcceptedAt as number)).toBeLessThanOrEqual(2_000);
    await expect(flow).resolves.toMatchObject({ status: "source_uploaded" });
    // 2 MB server-confirmed steps; 99 only after the server held every byte.
    const patches = Math.ceil(6_064_284 / (2 * 1024 * 1024));
    expect(patches).toBe(3);
    expect(percents.filter((value) => value >= 99 && value < 100)).toEqual([99]);
    expect(percents[percents.length - 1]).toBe(100);
  });
});
