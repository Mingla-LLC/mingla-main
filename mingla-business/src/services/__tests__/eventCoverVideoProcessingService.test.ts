import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  acknowledgeEventCoverVideoSourceUploaded,
  cancelEventCoverVideoJob,
  createEventCoverVideoUploadIntent,
  EventCoverVideoProcessingError,
  fetchEventCoverVideoStatus,
  uploadEventCoverVideoSource,
  waitForEventCoverVideoReady,
} from "../eventCoverVideoProcessingService";
import { supabase } from "../supabase";
import { BusinessAuthNotReadyError } from "../../utils/authReadiness";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
    functions: {
      invoke: jest.fn(),
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

// [TEST-MOD-APPROVED ORCH-1062] jest resolves the `.ts` (web) variant of
// platformFileSystem (moduleFileExtensions has no `.native`), whose multipart
// stub throws → the service falls back to its XHR path (needs XMLHttpRequest,
// absent in this node/ts-jest env). This suite mocks Platform.OS="ios" and the
// expo-file-system/legacy createUploadTask — i.e. it exercises the NATIVE
// multipart shim. Double the platform-shim boundary with a thin mock that
// delegates to the (already-mocked) expo-file-system/legacy, mirroring
// platformFileSystem.native.ts's runtime contract, so the intended native path
// runs. (requireActual of the .native.ts file is unusable — ts-jest type-checks
// it and its own expo-file-system typing error fails the compile.) Plumbing only
// — zero expect() changed.
jest.mock("../../utils/platformFileSystem", () => {
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
  ) => { uploadAsync: () => Promise<unknown> }
>;

describe("event cover video processing service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invoke.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "user-session-jwt" } },
      error: null,
    });
    createUploadTask.mockReset();
  });

  test("maps upload-intent unauthenticated response to auth-not-ready", async () => {
    invoke.mockResolvedValue({
      data: { error: "unauthenticated" },
      error: null,
    });

    let thrown: unknown = null;
    try {
      await createEventCoverVideoUploadIntent({
        applyMode: "draft_auto",
        brandId: "brand_id",
        eventId: "event_id",
        sourceBytes: 1,
        sourceDurationMs: 1_000,
        trimEndMs: 1_000,
        trimStartMs: 0,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BusinessAuthNotReadyError);
    expect(thrown).toMatchObject({
      edgeError: "unauthenticated",
      phase: "upload_intent",
      requestId: expect.any(String),
    });
  });

  test("maps validation and provider errors distinctly", async () => {
    invoke.mockResolvedValue({
      data: { error: "validation_error", detail: "source_duration_out_of_range" },
      error: null,
    });

    let thrown: unknown = null;
    try {
      await createEventCoverVideoUploadIntent({
        applyMode: "draft_auto",
        brandId: "brand_id",
        eventId: "event_id",
        sourceBytes: 1,
        sourceDurationMs: 1_000,
        trimEndMs: 1_000,
        trimStartMs: 0,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "validation_error",
      edgeDetail: "source_duration_out_of_range",
      edgeError: "validation_error",
      // [TEST-MOD-APPROVED #2715] Validation copy follows the binding 15-second ceiling.
      message: "Choose another 15-second clip and try again.",
      phase: "upload_intent",
      requestId: expect.any(String),
    });
  });

  test("preserves request id and safe edge detail for upload-intent invoke errors", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          json: async () => ({
            detail: "job_insert_failed",
            error: "internal_error",
          }),
          status: 500,
        },
        message: "Edge Function returned a non-2xx status code",
      },
    });

    let thrown: unknown = null;
    try {
      await createEventCoverVideoUploadIntent({
        applyMode: "draft_auto",
        brandId: "brand_id",
        eventId: "event_id",
        sourceBytes: 1,
        sourceDurationMs: 1_000,
        trimEndMs: 1_000,
        trimStartMs: 0,
      });
    } catch (error) {
      thrown = error;
    }

    const requestBody = (
      invoke.mock.calls[0][1] as { body: { clientRequestId: string } }
    ).body;
    expect(thrown).toBeInstanceOf(EventCoverVideoProcessingError);
    expect(thrown).toMatchObject({
      code: "internal_error",
      edgeDetail: "job_insert_failed",
      edgeError: "internal_error",
      edgeStatus: 500,
      message: "Could not create a video processing job. Try again.",
      phase: "upload_intent",
      requestId: requestBody.clientRequestId,
    });
  });

  test("keeps deployed-v2 upload-intent internal errors on generic prepare copy", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          json: async () => ({
            error: "internal_error",
          }),
          status: 500,
        },
        message: "Edge Function returned a non-2xx status code",
      },
    });

    await expect(
      createEventCoverVideoUploadIntent({
        applyMode: "draft_auto",
        brandId: "brand_id",
        eventId: "event_id",
        sourceBytes: 1,
        sourceDurationMs: 1_000,
        trimEndMs: 1_000,
        trimStartMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      edgeDetail: undefined,
      edgeError: "internal_error",
      edgeStatus: 500,
      message: "Could not prepare video upload. Try again.",
      phase: "upload_intent",
      requestId: expect.any(String),
    });
  });

  test("maps upload-intent internal error details without generic prepare copy", async () => {
    invoke.mockResolvedValue({
      data: { detail: "role_check_failed", error: "internal_error" },
      error: null,
    });

    await expect(
      createEventCoverVideoUploadIntent({
        applyMode: "draft_auto",
        brandId: "brand_id",
        eventId: "event_id",
        sourceBytes: 1,
        sourceDurationMs: 1_000,
        trimEndMs: 1_000,
        trimStartMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      edgeDetail: "role_check_failed",
      edgeError: "internal_error",
      message: "Could not verify your event permissions before upload. Try again.",
      phase: "upload_intent",
      requestId: expect.any(String),
    });
  });

  test("keeps upload-intent request body aligned to the returned native-trimmed clip", async () => {
    invoke.mockResolvedValue({
      data: {
        jobId: "job_1",
        provider: "cloudinary",
        upload: { fields: { api_key: "key" }, url: "https://upload.example.com" },
      },
      error: null,
    });

    await expect(
      createEventCoverVideoUploadIntent({
        applyMode: "draft_auto",
        brandId: "brand_id",
        eventId: "event_id",
        sourceBytes: 12_345,
        sourceDurationMs: 8_000,
        sourceFileName: "trimmed.mov",
        sourceMimeType: "video/quicktime",
        trimEndMs: 8_000,
        trimStartMs: 0,
      }),
    ).resolves.toMatchObject({
      jobId: "job_1",
    });

    expect(invoke).toHaveBeenCalledWith(
      "event-cover-video-upload-intent",
      expect.objectContaining({
        body: expect.objectContaining({
          sourceBytes: 12_345,
          sourceDurationMs: 8_000,
          sourceFileName: "trimmed.mov",
          sourceMimeType: "video/quicktime",
          trimEndMs: 8_000,
          trimStartMs: 0,
        }),
      }),
    );
  });

  test("fetches a fresh session token for each upload-intent retry", async () => {
    getSession
      .mockResolvedValueOnce({
        data: { session: { access_token: "first-session-jwt" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { session: { access_token: "retry-session-jwt" } },
        error: null,
      });
    invoke.mockResolvedValue({
      data: {
        jobId: "job_1",
        provider: "cloudinary",
        upload: { fields: { api_key: "key" }, url: "https://upload.example.com" },
      },
      error: null,
    });

    const input = {
      applyMode: "draft_auto" as const,
      brandId: "brand_id",
      eventId: "event_id",
      sourceBytes: 12_345,
      sourceDurationMs: 8_000,
      trimEndMs: 8_000,
      trimStartMs: 0,
    };

    await createEventCoverVideoUploadIntent(input);
    await createEventCoverVideoUploadIntent(input);

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "event-cover-video-upload-intent",
      expect.objectContaining({
        headers: { Authorization: "Bearer first-session-jwt" },
      }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "event-cover-video-upload-intent",
      expect.objectContaining({
        headers: { Authorization: "Bearer retry-session-jwt" },
      }),
    );
  });

  test("maps status provider failure without hiding the provider code", async () => {
    invoke.mockResolvedValue({
      data: {
        applyMode: "draft_auto",
        brandId: "brand_1",
        canCancel: false,
        canCheckAgain: false,
        canRetry: true,
        createdAt: "2026-05-10T00:00:00.000Z",
        eventId: "event_1",
        failureCode: "provider_failed",
        failureMessage: "Cloudinary failed.",
        isTerminal: true,
        jobId: "job_1",
        processedBytes: null,
        processedDurationMs: null,
        processedMimeType: null,
        processedUrl: null,
        progressKind: "terminal",
        progressPercent: null,
        sourceUploadedAt: null,
        stageLabel: "Video processing failed.",
        status: "failed",
        updatedAt: "2026-05-10T00:00:01.000Z",
      },
      error: null,
    });

    await expect(fetchEventCoverVideoStatus("job_1")).resolves.toMatchObject({
      failureCode: "provider_failed",
      failureMessage: "Cloudinary failed.",
      status: "failed",
    });
  });

  test("keeps malformed edge responses distinct from source upload failures", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });

    let thrown: unknown = null;
    try {
      await createEventCoverVideoUploadIntent({
        applyMode: "draft_auto",
        brandId: "brand_id",
        eventId: "event_id",
        sourceBytes: 1,
        sourceDurationMs: 1_000,
        trimEndMs: 1_000,
        trimStartMs: 0,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "malformed_response",
      name: "EventCoverVideoProcessingError",
      phase: "upload_intent",
      requestId: expect.any(String),
    });
  });

  test("acknowledges source upload after Cloudinary accepts the source", async () => {
    invoke.mockResolvedValue({
      data: {
        applyMode: "draft_auto",
        brandId: "brand_1",
        canCancel: true,
        canCheckAgain: true,
        canRetry: false,
        eventId: "event_1",
        failureCode: null,
        failureMessage: null,
        isTerminal: false,
        jobId: "job_1",
        processedBytes: null,
        processedDurationMs: null,
        processedMimeType: null,
        processedUrl: null,
        progressKind: "indeterminate",
        // [TEST-MOD-APPROVED #2715] Unknown provider progress stays indeterminate.
        progressPercent: null,
        sourceUploadedAt: "2026-05-10T00:00:00.000Z",
        stageLabel: "Upload complete. Preparing processing...",
        status: "source_uploaded",
      },
      error: null,
    });

    await expect(
      acknowledgeEventCoverVideoSourceUploaded({
        brandId: "brand_1",
        eventId: "event_1",
        jobId: "job_1",
        providerUploadResponse: {
          asset_id: "asset_1",
          bytes: 1234,
          duration: 8,
          format: "mov",
          public_id: "event-covers/raw/brand/event/job",
          resource_type: "video",
        },
      }),
    ).resolves.toMatchObject({
      jobId: "job_1",
      progressPercent: null,
      stageLabel: "Upload complete. Preparing processing...",
      status: "source_uploaded",
    });

    expect(invoke).toHaveBeenCalledWith(
      "event-cover-video-source-uploaded",
      expect.objectContaining({
        body: expect.objectContaining({
          brandId: "brand_1",
          eventId: "event_1",
          jobId: "job_1",
          providerUploadResponse: expect.objectContaining({
            asset_id: "asset_1",
            public_id: "event-covers/raw/brand/event/job",
          }),
        }),
      }),
    );
  });

  test("keeps the same processing job alive beyond the former deadline and later resolves", async () => {
    // [TEST-MOD-APPROVED #2715] A client clock or transient status failure cannot
    // terminate authoritative provider work; later server truth settles the job.
    jest.useFakeTimers({ now: 0 });
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      const processing = {
        applyMode: "draft_auto", brandId: "brand_1", canCancel: true,
        canCheckAgain: true, canRetry: false, eventId: "event_1",
        isTerminal: false, jobId: "job_1", progressKind: "indeterminate",
        progressPercent: null, stageLabel: "Processing video", status: "processing",
      };
      const ready = {
        ...processing, canCancel: false, canCheckAgain: false, isTerminal: true,
        processedUrl: "https://cdn.example.com/final.mp4", progressKind: "terminal",
        progressPercent: 100, stageLabel: "Video ready.", status: "ready",
      };
      invoke
        .mockResolvedValueOnce({ data: processing, error: null })
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ data: ready, error: null });

      const seen: string[] = [];
      const waitPromise = waitForEventCoverVideoReady("job_1", {
        onStatus: (status) => seen.push(status.status),
        pollIntervalMs: 1,
        timeoutMs: 2, // deprecated input is intentionally ignored
      });
      await jest.advanceTimersByTimeAsync(1_105_000);
      await expect(waitPromise).resolves.toMatchObject({ jobId: "job_1", status: "ready" });
      expect(seen).toEqual(["processing", "ready"]);
      expect(invoke).toHaveBeenCalledTimes(3);
    } finally {
      random.mockRestore();
      jest.useRealTimers();
    }
  });

  test("wait resolves ready status and cancel returns enriched terminal status", async () => {
    invoke
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
          processedUrl: "https://cdn.example.com/processed.mp4",
          progressKind: "terminal",
          progressPercent: 100,
          stageLabel: "Cover video updated.",
          status: "applied",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          applyMode: "draft_auto",
          brandId: "brand_1",
          canCancel: false,
          canCheckAgain: false,
          canRetry: true,
          eventId: "event_1",
          isTerminal: true,
          jobId: "job_2",
          progressKind: "terminal",
          stageLabel: "Video processing cancelled.",
          status: "cancelled",
        },
        error: null,
      });

    await expect(
      waitForEventCoverVideoReady("job_1", { timeoutMs: 10 }),
    ).resolves.toMatchObject({
      processedUrl: "https://cdn.example.com/processed.mp4",
      status: "applied",
    });
    await expect(cancelEventCoverVideoJob("job_2")).resolves.toMatchObject({
      canRetry: true,
      stageLabel: "Video processing cancelled.",
      status: "cancelled",
    });
  });

  // #966 [TEST-MOD-APPROVED ORCH-0966] — the Cloudinary multipart/XHR/chunked
  // upload legs (createMultipartUploadTask + cloudinaryUploadFailureDetail +
  // sanitizeProviderUploadResponse) were removed as dead residue post-META-1270.
  // The two Cloudinary-upload tests ("signed Cloudinary fields" success + the
  // Cloudinary 401 failure-mapping) are retired in place. What remains proves the
  // dead path is GONE: uploadEventCoverVideoSource fails LOUD for any non-"tus"
  // (former Cloudinary) descriptor rather than silently attempting a retired path.
  // The live TUS transport is covered by eventCoverVideoProcessingService.bunnyTus
  // / .orch1295 / tusPatch* suites.
  test("#966 uploadEventCoverVideoSource is Bunny/TUS-only — a non-tus descriptor fails loud", async () => {
    await expect(
      uploadEventCoverVideoSource({
        upload: {
          fields: { api_key: "key", signature: "sig", timestamp: "123" },
          url: "https://api.cloudinary.com/v1_1/demo/video/upload",
        },
        uri: "file:///cover.mov",
      }),
    ).rejects.toMatchObject({
      code: "provider_not_configured",
    });
  });
});
