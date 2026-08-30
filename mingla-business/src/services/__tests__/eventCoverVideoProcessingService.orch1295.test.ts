// ORCH-1295 [bunny-tus-patch-upload-offset] — implementor regression test for
// the NATIVE TUS PATCH transport.
//
// On device the cover-video PATCH to Bunny returned 400 because it was routed
// through expo-file-system's BINARY_CONTENT upload task, which drops the TUS
// `Upload-Offset` header. The naive fix (fetch(uri).blob()) is also broken on RN
// iOS — it silently returns a size-0 Blob (ORCH-0786) → empty body. The shipped
// transport reads the clip with the native `File` API and streams it via
// `expo/fetch`, which sends the TUS headers VERBATIM.
//
// This test mocks `expo/fetch` + the `expo-file-system` `File` API and asserts
// the native transport (a) reads bytes via File (never fetch-blob) and (b) issues
// a PATCH through expo/fetch carrying `Upload-Offset` (+ Tus-Resumable +
// offset content-type) verbatim to the resumable URL.
//
// Fails-on-revert: on origin/main the module `../eventCoverVideoTusPatch.native`
// does not exist (the native PATCH went through createBinaryUploadTask), so this
// suite cannot even import → fails.

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockReadBytes = jest.fn<(length: number) => Uint8Array>();
const mockClose = jest.fn();
const mockHandle = { offset: 0, readBytes: mockReadBytes, close: mockClose };
const mockExpoFetch =
  jest.fn<
    (
      url: string,
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: Uint8Array;
        signal?: AbortSignal;
      },
    ) => Promise<{ status: number; text: () => Promise<string> }>
  >();

// [TEST-MOD-APPROVED #2715] Native FileHandle reads only the requested slice.
jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => ({ open: () => mockHandle })),
}));

// Native streaming fetch — sends request headers verbatim.
jest.mock("expo/fetch", () => ({ fetch: mockExpoFetch }));

import {
  patchBunnyTusNative,
  readEventCoverVideoChunk,
} from "../eventCoverVideoTusPatch.native";

const RESUMABLE_URL = "https://video.bunnycdn.com/tus/upload-abc-123";

describe("ORCH-1295 — native TUS PATCH transport (bounded FileHandle reads + expo/fetch)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reads only the requested chunk from a clip larger than one chunk", async () => {
    // [TEST-MOD-APPROVED #2715] The 12 MiB fixture is never allocated as one body.
    const chunk = new Uint8Array([1, 2, 3, 4]);
    mockReadBytes.mockReturnValue(chunk);

    const fetchSpy = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const out = await readEventCoverVideoChunk("file:///tmp/12mb-cover.mp4", 5 * 1024 * 1024, 4);
      expect(out).toBe(chunk);
      expect(mockHandle.offset).toBe(5 * 1024 * 1024);
      expect(mockReadBytes).toHaveBeenCalledWith(4);
      expect(mockClose).toHaveBeenCalledTimes(1);
      // The ORCH-0786 fix: no fetch(uri).blob() on native.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("PATCHes via expo/fetch carrying Upload-Offset + Tus-Resumable + offset content-type verbatim", async () => {
    const body = new Uint8Array([9, 8, 7]);
    mockExpoFetch.mockResolvedValue({ status: 204, text: async () => "" });

    const result = await patchBunnyTusNative({
      url: RESUMABLE_URL,
      body,
      headers: {
        "Content-Type": "application/offset+octet-stream",
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
      },
    });

    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = mockExpoFetch.mock.calls[0];
    expect(calledUrl).toBe(RESUMABLE_URL);
    expect(init?.method).toBe("PATCH");
    // The regression: Upload-Offset MUST reach Bunny (missing it → 400).
    expect(init?.headers?.["Upload-Offset"]).toBe("0");
    expect(init?.headers?.["Tus-Resumable"]).toBe("1.0.0");
    expect(init?.headers?.["Content-Type"]).toBe("application/offset+octet-stream");
    expect(init?.body).toBe(body);
    expect(result).toEqual({ status: 204, bodyText: "" });
  });

  it("returns the response status + body text so a non-2xx failure is not blind", async () => {
    mockExpoFetch.mockResolvedValue({
      status: 400,
      text: async () => "missing Upload-Offset header",
    });

    const result = await patchBunnyTusNative({
      url: RESUMABLE_URL,
      body: new Uint8Array([1]),
      headers: { "Upload-Offset": "0" },
    });

    expect(result).toEqual({
      status: 400,
      bodyText: "missing Upload-Offset header",
    });
  });
});
