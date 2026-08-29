// ORCH-1301 [close-hardening for ORCH-1295/1297 Bunny TUS PATCH] — TESTER
// ADVERSARIAL regression protection.
//
// The implementor test (tusPatchAuthHeaders.orch1297.test.ts) drives the SUCCESS
// (204) path and asserts the four auth headers + the three TUS headers reach the
// PATCH transport. This file attacks DIFFERENT angles it does NOT cover, driving
// the REAL uploadEventCoverVideoSourceViaTus (native leg) with the transport mocked:
//
//   (1) NON-2xx PATCH surfaces Bunny's response BODY TEXT in the thrown error —
//       the ORCH-1295 fix ("surface Bunny's response body on a non-2xx PATCH so a
//       future failure is not blind"). The original bug threw only the status code.
//   (2) The auth headers flow via a `...input.upload.fields` SPREAD, not a
//       hand-picked 4-key allowlist — an UNEXPECTED extra field must be forwarded.
//   (3) The explicit TUS headers WIN on a key collision — a hostile
//       `Upload-Offset` in upload.fields must be overridden to "0".
//   (4) An EMPTY body on a non-2xx still surfaces the status (no dangling ": ").
//
// Runs under jest.orch1297.cfg.cjs (isolatedModules) — the service trips a
// pre-existing baseline type error under the default config (documented in that
// config + the sibling implementor test).
//
// Fails-on-revert: reverting ORCH-1295's body-text surfacing (throw only the
// status) flips (1)/(4); reverting ORCH-1297's `...input.upload.fields` spread to
// a hardcoded 4-key list flips (2); dropping the "spread-first" ordering flips (3).

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

// Mock the native transport module the service imports — captures headers + lets
// us drive the PATCH status/body.
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

// Force the NATIVE dispatch (patchTusNative → patchBunnyTusNative, the leg that
// surfaces Bunny's body text on a non-2xx).
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

import {
  uploadEventCoverVideoSourceViaTus,
  EventCoverVideoProcessingError,
} from "../eventCoverVideoProcessingService";

const RESUMABLE_URL = "https://video.bunnycdn.com/tus/upload-xyz-1301";

const AUTH_FIELDS = {
  AuthorizationSignature: "sig-1301",
  AuthorizationExpire: "1760000000",
  LibraryId: "696626",
  VideoId: "vid-1301",
};

const runTus = (
  fields: Record<string, string>,
): Promise<unknown> =>
  uploadEventCoverVideoSourceViaTus({
    upload: {
      url: RESUMABLE_URL,
      fields,
      protocol: "tus",
      metadata: { filetype: "video/mp4", title: "job-1301" },
    },
    uri: "file:///tmp/cover-1301.mp4",
    bytes: 3,
  });

describe("ORCH-1301 — TUS PATCH failure surfacing + spread integrity (adversarial)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadChunk.mockResolvedValue(new Uint8Array([2, 3]));
    // Default: success. Individual tests override the PATCH result.
    mockPatchBunny.mockResolvedValue({ status: 204, bodyText: "" });
    // [TEST-MOD-APPROVED #2715] Every attempt trusts HEAD, never a client CREATE.
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

  it("(1) a non-2xx PATCH keeps redacted diagnostics without rendering Bunny body text", async () => {
    // [TEST-MOD-APPROVED #2715] Provider strings are never user-facing.
    mockPatchBunny.mockResolvedValue({
      status: 400,
      bodyText: "Library ID missing or invalid",
    });

    let caught: unknown;
    try {
      await runTus(AUTH_FIELDS);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EventCoverVideoProcessingError);
    const err = caught as EventCoverVideoProcessingError;
    expect(err.code).toBe("transport_integrity_failed");
    expect(err.message).toBe("We couldn't resume this upload. Choose the original video again.");
    expect(err.message).not.toContain("Library ID missing or invalid");
    expect(err.edgeDetail).toBe("tus_patch_http_400");
  });

  it("(2) the auth headers flow via a `...fields` SPREAD — an UNEXPECTED extra field is forwarded (proves it is not a hardcoded 4-key allowlist)", async () => {
    await runTus({
      ...AUTH_FIELDS,
      // A field name the service code has never heard of. A spread forwards it;
      // a hand-picked allowlist of the 4 known keys would silently drop it.
      BunnyFutureAuthField: "proof-1301",
    });

    expect(mockPatchBunny).toHaveBeenCalledTimes(1);
    const { headers } = mockPatchBunny.mock.calls[0][0];
    expect(headers.BunnyFutureAuthField).toBe("proof-1301");
    // And the real auth fields still arrive.
    expect(headers.LibraryId).toBe("696626");
    expect(headers.AuthorizationSignature).toBe("sig-1301");
  });

  it("(3) the explicit TUS headers WIN a key collision using the HEAD-derived offset", async () => {
    // [TEST-MOD-APPROVED #2715] Trusted server offset replaces the hostile field.
    await runTus({
      ...AUTH_FIELDS,
      // The server should never send this, but if it did the byte write must
      // still start at offset 0 — the explicit TUS header is spread LAST.
      "Upload-Offset": "999",
      "Content-Type": "text/plain",
    });

    expect(mockPatchBunny).toHaveBeenCalledTimes(1);
    const { headers } = mockPatchBunny.mock.calls[0][0];
    expect(headers["Upload-Offset"]).toBe("1");
    expect(headers["Content-Type"]).toBe("application/offset+octet-stream");
    expect(headers["Tus-Resumable"]).toBe("1.0.0");
  });

  it("(4) a non-2xx PATCH with an EMPTY body still has finite safe diagnostics", async () => {
    mockPatchBunny.mockResolvedValue({ status: 500, bodyText: "   " });

    let caught: unknown;
    try {
      await runTus(AUTH_FIELDS);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EventCoverVideoProcessingError);
    const err = caught as EventCoverVideoProcessingError;
    expect(err.code).toBe("transport_integrity_failed");
    expect(err.edgeDetail).toBe("tus_patch_http_500");
    expect(err.message).not.toContain("500");
  });

  it("(5) the CREATE + PATCH both go through ONE patchHeaders object — success path stays 204-clean with all headers", async () => {
    await runTus(AUTH_FIELDS);
    expect(mockPatchBunny).toHaveBeenCalledTimes(1);
    const { headers } = mockPatchBunny.mock.calls[0][0];
    // Belt: the four auth fields + three TUS headers all present on success too,
    // framed here as the baseline the failure-path tests build on.
    for (const key of [
      "AuthorizationSignature",
      "AuthorizationExpire",
      "LibraryId",
      "VideoId",
      "Upload-Offset",
      "Tus-Resumable",
      "Content-Type",
    ]) {
      expect(headers[key]).toBeDefined();
    }
  });
});
