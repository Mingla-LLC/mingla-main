import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  createEventCoverVideoUploadIntent,
  EventCoverVideoProcessingError,
  fetchEventCoverVideoStatus,
  uploadEventCoverVideoSource,
} from "../eventCoverVideoProcessingService";
import { supabase } from "../supabase";
import { BusinessAuthNotReadyError } from "../../utils/authReadiness";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  FileSystemSessionType: { FOREGROUND: 1 },
  FileSystemUploadType: { MULTIPART: 1 },
  createUploadTask: jest.fn(),
}));

const invoke = supabase.functions.invoke as unknown as jest.MockedFunction<
  (name: string, options?: unknown) => Promise<{ data: unknown; error: unknown }>
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
      message: "Video duration metadata was missing or out of range. Try another 15-second clip.",
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

  test("maps status provider failure without hiding the provider code", async () => {
    invoke.mockResolvedValue({
      data: {
        applyMode: "draft_auto",
        failureCode: "provider_failed",
        failureMessage: "Cloudinary failed.",
        jobId: "job_1",
        processedBytes: null,
        processedDurationMs: null,
        processedMimeType: null,
        processedUrl: null,
        status: "failed",
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

  test("uploads source video with real byte progress and signed Cloudinary fields", async () => {
    const progress: number[] = [];
    createUploadTask.mockImplementation((_url, _fileUri, _options, callback) => ({
      uploadAsync: async () => {
        callback?.({ totalBytesExpectedToSend: 200, totalBytesSent: 50 });
        callback?.({ totalBytesExpectedToSend: 200, totalBytesSent: 220 });
        return {
          body: "{}",
          headers: {},
          mimeType: "application/json",
          status: 200,
        };
      },
    }));

    await uploadEventCoverVideoSource({
      fileName: "cover.mov",
      mimeType: "video/quicktime",
      onProgress: (event) => {
        progress.push(event.percent);
      },
      upload: {
        fields: {
          api_key: "key",
          eager: "vc_h264,f_mp4",
          resource_type: "video",
          signature: "sig",
          timestamp: "123",
        },
        url: "https://api.cloudinary.com/v1_1/demo/video/upload",
      },
      uri: "file:///cover.mov",
    });

    expect(progress).toEqual([25, 100, 100]);
    expect(createUploadTask).toHaveBeenCalledWith(
      "https://api.cloudinary.com/v1_1/demo/video/upload",
      "file:///cover.mov",
      expect.objectContaining({
        fieldName: "file",
        httpMethod: "POST",
        mimeType: "video/quicktime",
        parameters: expect.objectContaining({
          api_key: "key",
          eager: "vc_h264,f_mp4",
          signature: "sig",
          timestamp: "123",
        }),
        uploadType: 1,
      }),
      expect.any(Function),
    );
    expect(
      (createUploadTask.mock.calls[0][2] as { parameters?: Record<string, string> })
        .parameters,
    ).not.toHaveProperty("resource_type");
  });

  test("maps provider source upload failure without falling into fake processing progress", async () => {
    createUploadTask.mockReturnValue({
      uploadAsync: async () => ({
        body: JSON.stringify({ error: { message: "Invalid Signature" } }),
        headers: {},
        mimeType: "application/json",
        status: 401,
      }),
    });

    await expect(
      uploadEventCoverVideoSource({
        upload: {
          fields: { api_key: "key", signature: "bad", timestamp: "123" },
          url: "https://api.cloudinary.com/v1_1/demo/video/upload",
        },
        uri: "file:///cover.mov",
      }),
    ).rejects.toMatchObject({
      code: "source_upload_failed",
      message: "Invalid Signature",
    });
  });
});
