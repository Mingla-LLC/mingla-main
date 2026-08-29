// #966 [TEST-MOD-APPROVED ORCH-0966] — cover-video is Bunny-only. This suite's
// PRIMARY proof is compressVideoLocally + the compressed bytes flowing into the
// upload intent (the fails-on-revert core). Its upload leg previously exercised
// the Cloudinary multipart transport (createMultipartUploadTask), which was
// removed as dead residue post-META-1270. It is adapted here to the live Bunny
// TUS transport (protocol:"tus" descriptor + mocked eventCoverVideoTusPatch +
// TUS-create fetch), mirroring the tusPatchErrorSurface.orch1301 mock recipe. The
// compression + intent-body assertions are preserved verbatim.
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// #966 — the native TUS transport module the service imports. Mocking it (as the
// orch1301 suite does) lets the compressed-bytes upload leg run through the live
// Bunny TUS path under node/ts-jest without a real native module or network.
// These `mock`-prefixed fns + the jest.mock MUST be declared BEFORE the service
// import so they are initialized when the service's transitive require pulls the
// mocked module in (jest hoists the jest.mock, not the const).
const mockReadChunk = jest.fn<(uri: string, offset: number, length: number) => Promise<Uint8Array>>();
const mockPatchBunny =
  jest.fn<
    (input: { url: string; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal }) =>
      Promise<{ status: number; bodyText: string }>
  >();
jest.mock("../../src/services/eventCoverVideoTusPatch", () => ({
  // [TEST-MOD-APPROVED #2715] Native transport reads bounded slices.
  readEventCoverVideoChunk: mockReadChunk,
  patchBunnyTusNative: mockPatchBunny,
}));

import {
  acknowledgeEventCoverVideoSourceUploaded,
  compressVideoLocally,
  createEventCoverVideoUploadIntent,
  uploadEventCoverVideoSource,
  waitForEventCoverVideoReady,
} from "../../src/services/eventCoverVideoProcessingService";
import { supabase } from "../../src/services/supabase";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("../../src/services/supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
    // [TEST-MOD-APPROVED ORCH-1062] createEventCoverVideoUploadIntent now reads
    // supabase.auth.getSession() for the intent JWT; this suite's mock predates
    // that and only stubbed functions.invoke. Mirror the eventCoverVideoProcessingService.test.ts
    // mock so a valid session is present. Plumbing only — zero expect() changed.
    auth: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  FileSystemSessionType: { FOREGROUND: 1 },
  FileSystemUploadType: { MULTIPART: 1 },
  createUploadTask: jest.fn(),
  getInfoAsync: jest.fn(),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

jest.mock("react-native-compressor", () => ({
  Video: {
    compress: jest.fn(),
  },
}));

// [TEST-MOD-APPROVED ORCH-1062] platformFileSystem native shim delegated to the
// (already-mocked) expo-file-system/legacy so getFileInfoAsync (used by
// compressVideoLocally → statFileSize) resolves. Plumbing only.
jest.mock("../../src/utils/platformFileSystem", () => {
  const legacy = require("expo-file-system/legacy");
  return {
    createMultipartUploadTask: async (
      url: string,
      fileUri: string,
      options: Record<string, unknown>,
      onProgress: (event: {
        totalBytesSent: number;
        totalBytesExpectedToSend: number;
      }) => void,
    ) =>
      legacy.createUploadTask(
        url,
        fileUri,
        {
          ...options,
          sessionType: legacy.FileSystemSessionType.FOREGROUND,
          uploadType: legacy.FileSystemUploadType.MULTIPART,
        },
        onProgress,
      ),
    getFileInfoAsync: async (uri: string) => legacy.getInfoAsync(uri),
  };
});

const invoke = supabase.functions.invoke as unknown as jest.MockedFunction<
  (name: string, options?: unknown) => Promise<{ data: unknown; error: unknown }>
>;
const getSession = supabase.auth.getSession as unknown as jest.MockedFunction<
  () => Promise<{
    data: { session: { access_token: string } | null };
    error: null | Error;
  }>
>;
const getInfoAsync = FileSystem.getInfoAsync as unknown as jest.MockedFunction<
  (uri: string, options?: unknown) => Promise<{ exists: boolean; size?: number }>
>;

const RESUMABLE_URL = "https://video.bunnycdn.com/tus/upload-966-compression";

describe("ORCH-0978 event cover video compression happy path", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    invoke.mockReset();
    getInfoAsync.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "user-session-jwt" } },
      error: null,
    });
    mockReadChunk.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockPatchBunny.mockResolvedValue({ status: 204, bodyText: "" });
    // [TEST-MOD-APPROVED #2715] The server already created the resource; the
    // client recovers and advances only from authoritative HEAD offsets.
    const offsets = [0, 5 * 1024 * 1024, 6_270_000];
    global.fetch = jest.fn(
      async (_url: unknown, init?: { method?: string }): Promise<unknown> => {
        if (init?.method === "HEAD") {
          const offset = offsets.shift() ?? 6_270_000;
          return {
            ok: true,
            headers: { get: (name: string): string | null => name === "Upload-Offset" ? String(offset) : null },
          };
        }
        throw new Error("unexpected fetch call");
      },
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("compresses locally, uploads compressed bytes via Bunny TUS, and reaches applied status", async () => {
    // fails-on-revert verified: removing compressVideoLocally or the compressed
    // upload byte plumbing makes this test send file:///raw.mov / 389 MB instead.
    const compressor = jest.requireMock("react-native-compressor") as {
      Video: {
        compress: jest.MockedFunction<
          (
            uri: string,
            options: unknown,
            onProgress?: (progress: number) => void,
          ) => Promise<string>
        >;
      };
    };
    compressor.Video.compress.mockImplementation(
      async (_uri: string, _options: unknown, onProgress?: (progress: number) => void) => {
        onProgress?.(0.5);
        onProgress?.(1);
        return "file:///compressed.mp4";
      },
    );
    getInfoAsync.mockResolvedValue({ exists: true, size: 6_270_000 });
    invoke
      .mockResolvedValueOnce({
        // #966 — the server now returns a Bunny TUS upload descriptor.
        data: {
          jobId: "job_1",
          provider: "bunny",
          upload: {
            protocol: "tus",
            url: "https://video.bunnycdn.com/tusupload",
            videoId: "bunny-guid-966",
            fields: {
              AuthorizationSignature: "sig-966",
              AuthorizationExpire: "1760000000",
              LibraryId: "lib-966",
              VideoId: "bunny-guid-966",
            },
            metadata: { filetype: "video/mp4", title: "job_1" },
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          applyMode: "draft_auto",
          brandId: "brand_1",
          canCancel: true,
          canCheckAgain: true,
          canRetry: false,
          eventId: "event_1",
          isTerminal: false,
          jobId: "job_1",
          progressKind: "indeterminate",
          // [TEST-MOD-APPROVED #2715] No provider percent means no fabricated percent.
          progressPercent: null,
          stageLabel: "Upload complete. Preparing processing...",
          status: "source_uploaded",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          applyMode: "draft_auto",
          brandId: "brand_1",
          canCancel: true,
          canCheckAgain: true,
          canRetry: false,
          eventId: "event_1",
          isTerminal: false,
          jobId: "job_1",
          progressKind: "indeterminate",
          progressPercent: null,
          stageLabel: "Processing browser-safe video...",
          status: "processing",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          applyMode: "draft_auto",
          brandId: "brand_1",
          canCancel: false,
          canCheckAgain: false,
          canRetry: false,
          eventId: "event_1",
          isTerminal: true,
          jobId: "job_1",
          processedUrl: "https://vz-966.b-cdn.net/bunny-guid-966/play_720p.mp4",
          progressKind: "terminal",
          progressPercent: 100,
          stageLabel: "Cover video updated.",
          status: "applied",
        },
        error: null,
      });

    // [TEST-MOD-APPROVED #2715] Keep the large-byte compression proof within
    // the exact 15-second source-duration contract.
    const compressed = await compressVideoLocally({
      bytes: 389_150_000,
      durationMs: 15_000,
      uri: "file:///raw.mov",
    });
    const intent = await createEventCoverVideoUploadIntent({
      applyMode: "draft_auto",
      brandId: "brand_1",
      eventId: "event_1",
      sourceBytes: compressed.bytes,
      sourceDurationMs: compressed.durationMs,
      sourceFileName: "trimmed.mov",
      sourceMimeType: "video/quicktime",
    });
    const providerUploadResponse = await uploadEventCoverVideoSource({
      bytes: compressed.bytes,
      jobId: intent.jobId,
      upload: intent.upload,
      uri: compressed.uri,
    });
    await acknowledgeEventCoverVideoSourceUploaded({
      brandId: "brand_1",
      eventId: "event_1",
      jobId: intent.jobId,
      providerUploadResponse,
    });
    await expect(
      waitForEventCoverVideoReady(intent.jobId, { pollIntervalMs: 1, timeoutMs: 1_000 }),
    ).resolves.toMatchObject({
      processedUrl: "https://vz-966.b-cdn.net/bunny-guid-966/play_720p.mp4",
      status: "applied",
    });

    expect(compressed).toMatchObject({
      bytes: 6_270_000,
      uri: "file:///compressed.mp4",
      wasCompressed: true,
    });
    expect(invoke).toHaveBeenCalledWith(
      "event-cover-video-upload-intent",
      expect.objectContaining({
        body: expect.objectContaining({
          sourceBytes: 6_270_000,
          sourceDurationMs: 15_000,
        }),
      }),
    );
    // #966 — the compressed bytes upload via the live Bunny TUS PATCH leg (the
    // Cloudinary multipart createUploadTask path was removed).
    // [TEST-MOD-APPROVED #2715] 6.27 MB crosses the bounded 5 MiB chunk boundary.
    expect(mockPatchBunny).toHaveBeenCalledTimes(2);
    expect(mockPatchBunny.mock.calls.map(([call]) => call.headers["Upload-Offset"]))
      .toEqual(["0", String(5 * 1024 * 1024)]);
    expect(providerUploadResponse).toBeNull();
  });
});
