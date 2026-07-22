import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

// [TEST-MOD-APPROVED ORCH-1062] jest resolves the `.ts` (web) variant of
// platformFileSystem (moduleFileExtensions has no `.native`), whose multipart
// stub throws → the service falls back to its XHR path (needs XMLHttpRequest +
// supabase.auth, neither present in this node/ts-jest env). This suite mocks
// Platform.OS="ios" and the expo-file-system/legacy createUploadTask — i.e. it
// exercises the NATIVE multipart shim. Double the platform-shim boundary with a
// thin mock that delegates to the (already-mocked) expo-file-system/legacy,
// mirroring platformFileSystem.native.ts's runtime contract, so the intended
// native path runs. (requireActual of the .native.ts file is unusable here —
// ts-jest type-checks it and its own expo-file-system typing error fails the
// compile.) Plumbing only — zero expect() changed.
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
const createUploadTask = FileSystem.createUploadTask as unknown as jest.MockedFunction<
  (
    url: string,
    fileUri: string,
    options?: unknown,
    callback?: (event: {
      totalBytesSent: number;
      totalBytesExpectedToSend: number;
    }) => void,
  ) => { uploadAsync: () => Promise<unknown>; cancelAsync: () => Promise<void> }
>;
const getInfoAsync = FileSystem.getInfoAsync as unknown as jest.MockedFunction<
  (uri: string, options?: unknown) => Promise<{ exists: boolean; size?: number }>
>;

describe("ORCH-0978 event cover video compression happy path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invoke.mockReset();
    createUploadTask.mockReset();
    getInfoAsync.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "user-session-jwt" } },
      error: null,
    });
  });

  test("compresses locally, uploads compressed bytes, and reaches applied status", async () => {
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
    createUploadTask.mockImplementation((_url, _fileUri, _options, callback) => ({
      cancelAsync: async () => undefined,
      uploadAsync: async () => {
        callback?.({
          totalBytesExpectedToSend: 6_270_000,
          totalBytesSent: 6_270_000,
        });
        return {
          body: JSON.stringify({
            asset_id: "asset_1",
            bytes: 6_270_000,
            duration: 30,
            format: "mp4",
            public_id: "event-covers/raw/brand/event/job",
            resource_type: "video",
          }),
          status: 200,
        };
      },
    }));
    invoke
      .mockResolvedValueOnce({
        data: {
          jobId: "job_1",
          provider: "cloudinary",
          upload: {
            fields: { api_key: "key", signature: "sig", timestamp: "123" },
            url: "https://api.cloudinary.com/v1_1/demo/video/upload",
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
          progressPercent: 45,
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
          progressPercent: 70,
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
          processedUrl: "https://res.cloudinary.com/demo/video/upload/processed.mp4",
          progressKind: "terminal",
          progressPercent: 100,
          stageLabel: "Cover video updated.",
          status: "applied",
        },
        error: null,
      });

    const compressed = await compressVideoLocally({
      bytes: 389_150_000,
      durationMs: 30_000,
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
      processedUrl: "https://res.cloudinary.com/demo/video/upload/processed.mp4",
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
          sourceDurationMs: 30_000,
        }),
      }),
    );
    expect(createUploadTask).toHaveBeenCalledWith(
      "https://api.cloudinary.com/v1_1/demo/video/upload",
      "file:///compressed.mp4",
      expect.any(Object),
      expect.any(Function),
    );
  });
});
