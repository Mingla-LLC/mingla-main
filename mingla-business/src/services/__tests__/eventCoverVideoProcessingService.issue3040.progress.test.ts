/**
 * #3040 T-A8 (native) [A-8] — upload progress is a truthful byte count:
 * 2 MiB chunks, a point after EVERY server-confirmed chunk, never 100 before
 * the final HEAD agrees; a one-chunk source is indeterminate, not 0% → 100%.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockReadChunk = jest.fn<(uri: string, offset: number, length: number) => Promise<Uint8Array>>();
const mockPatch = jest.fn<(input: { headers: Record<string, string> }) => Promise<{ status: number; bodyText: string }>>();
jest.mock("../eventCoverVideoTusPatch", () => ({
  readEventCoverVideoChunk: mockReadChunk,
  patchBunnyTusNative: mockPatch,
}));
jest.mock("../supabase", () => ({
  supabase: { auth: { getSession: jest.fn() }, functions: { invoke: jest.fn() } },
}));
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { uploadEventCoverVideoSourceViaTus, type EventCoverVideoUploadProgress } from "../eventCoverVideoProcessingService";

const MiB = 1024 * 1024;

describe("#3040 T-A8 — truthful native progress", () => {
  const originalFetch = global.fetch;
  let serverOffset = 0;
  beforeEach(() => {
    serverOffset = 0;
    mockReadChunk.mockImplementation(async (_uri, _offset, length) => new Uint8Array(length));
    mockPatch.mockImplementation(async (input) => {
      serverOffset += Number(input.headers["Content-Length"]);
      return { status: 204, bodyText: "" };
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => (name === "Upload-Offset" ? String(serverOffset) : null) },
    })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const run = async (bytes: number): Promise<EventCoverVideoUploadProgress[]> => {
    const events: EventCoverVideoUploadProgress[] = [];
    await uploadEventCoverVideoSourceViaTus({
      upload: { url: "https://tus.example/1", fields: {}, protocol: "tus" },
      uri: "file:///clip.mp4",
      bytes,
      onProgress: (event) => events.push({ ...event }),
    });
    return events;
  };

  test("a 6 MiB upload reports at least 3 points, chunked at 2 MiB, 100 only at the end", async () => {
    const events = await run(6 * MiB);
    expect(mockPatch).toHaveBeenCalledTimes(3);
    expect(mockPatch.mock.calls.map((call) => call[0].headers["Content-Length"])).toEqual([String(2 * MiB), String(2 * MiB), String(2 * MiB)]);
    expect(events.length).toBeGreaterThanOrEqual(3);
    const hundred = events.filter((event) => event.percent === 100);
    expect(hundred).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({ percent: 100, final: true });
    expect(events.slice(0, -1).every((event) => event.percent <= 99)).toBe(true);
    for (let i = 1; i < events.length; i += 1) expect(events[i].percent).toBeGreaterThanOrEqual(events[i - 1].percent);
  });

  test("a source of one chunk or less is indeterminate until it is done", async () => {
    const events = await run(1 * MiB);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.slice(0, -1).every((event) => event.indeterminate === true)).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ percent: 100, final: true });
  });
});
