// ORCH-1297 [bunny-tus-patch-auth-headers] — implementor regression test.
//
// Bunny's TUS PATCH requires the SAME auth headers as the CREATE
// (AuthorizationSignature / AuthorizationExpire / LibraryId / VideoId). ORCH-1295
// built `patchHeaders` with only the TUS headers, so the PATCH returned 400
// "Library ID missing or invalid" on device. The fix spreads
// `input.upload.fields` into `patchHeaders`. Both transports (native expo/fetch
// and web XHR) consume `patchHeaders`, so this single object must carry the auth
// headers.
//
// This behavioral test drives the native path of uploadEventCoverVideoSourceViaTus
// with the transport module mocked, and asserts the headers handed to the PATCH
// transport include LibraryId + AuthorizationSignature (+ the TUS headers).
//
// Fails-on-revert: on origin/main `patchHeaders` omits `...input.upload.fields`,
// so LibraryId / AuthorizationSignature never reach the transport → the
// assertions below fail. Runs under jest.orch1297.cfg.cjs (isolatedModules) — the
// service trips a pre-existing baseline type error under the default config.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

interface PatchInput {
  url: string;
  body: Uint8Array;
  headers: Record<string, string>;
  signal?: AbortSignal;
}

const mockReadChunk = jest.fn<(uri: string, offset: number, length: number) => Promise<Uint8Array>>();
const mockPatchBunny =
  jest.fn<(input: PatchInput) => Promise<{ status: number; bodyText: string }>>();

// Mock the native transport module the service imports — captures the headers.
jest.mock("../eventCoverVideoTusPatch", () => ({
  readEventCoverVideoChunk: mockReadChunk,
  patchBunnyTusNative: mockPatchBunny,
}));

// Importing the service pulls in ./supabase; stub it.
jest.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

// Force the NATIVE dispatch.
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

import { uploadEventCoverVideoSourceViaTus } from "../eventCoverVideoProcessingService";

const RESUMABLE_URL = "https://video.bunnycdn.com/tus/upload-xyz-123";

describe("ORCH-1297 — TUS PATCH re-sends Bunny auth headers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadChunk.mockResolvedValue(new Uint8Array([2, 3]));
    mockPatchBunny.mockResolvedValue({ status: 204, bodyText: "" });
    // [TEST-MOD-APPROVED #2715] HEAD returns the durable resource's resume offset.
    const offsets = [1, 3];
    global.fetch = jest.fn(
      async (_url: unknown, init?: { method?: string }): Promise<unknown> => {
        if (init?.method === "HEAD") {
          return {
            ok: true,
            headers: { get: (name: string): string | null => name === "Upload-Offset" ? String(offsets.shift() ?? 3) : null },
          };
        }
        throw new Error("unexpected fetch call");
      },
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("carries LibraryId + AuthorizationSignature alongside the TUS headers on the PATCH", async () => {
    await uploadEventCoverVideoSourceViaTus({
      upload: {
        url: RESUMABLE_URL,
        fields: {
          AuthorizationSignature: "sig-abc",
          AuthorizationExpire: "1750000000",
          LibraryId: "696626",
          VideoId: "vid-1",
        },
        protocol: "tus",
        metadata: { filetype: "video/mp4", title: "job-1" },
      },
      uri: "file:///tmp/cover.mp4",
      bytes: 3,
    });

    expect(mockPatchBunny).toHaveBeenCalledTimes(1);
    const { headers } = mockPatchBunny.mock.calls[0][0];

    // The regression: Bunny 400 "Library ID missing or invalid" without these.
    expect(headers.LibraryId).toBe("696626");
    expect(headers.AuthorizationSignature).toBe("sig-abc");
    expect(headers.AuthorizationExpire).toBe("1750000000");
    expect(headers.VideoId).toBe("vid-1");

    // The explicit TUS headers still present (and win on any key collision).
    expect(headers["Upload-Offset"]).toBe("1");
    expect(headers["Tus-Resumable"]).toBe("1.0.0");
    expect(headers["Content-Type"]).toBe("application/offset+octet-stream");
  });
});
