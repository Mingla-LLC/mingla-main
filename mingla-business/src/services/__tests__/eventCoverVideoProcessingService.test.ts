import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  createEventCoverVideoUploadIntent,
  fetchEventCoverVideoStatus,
} from "../eventCoverVideoProcessingService";
import { supabase } from "../supabase";
import { BusinessAuthNotReadyError } from "../../utils/authReadiness";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const invoke = supabase.functions.invoke as unknown as jest.MockedFunction<
  (name: string, options?: unknown) => Promise<{ data: unknown; error: unknown }>
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
    ).rejects.toBeInstanceOf(BusinessAuthNotReadyError);
  });

  test("maps validation and provider errors distinctly", async () => {
    invoke.mockResolvedValue({
      data: { error: "validation_error", detail: "source_duration_out_of_range" },
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
      code: "validation_error",
      message: "Video duration metadata was missing or out of range. Try another 15-second clip.",
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
      code: "malformed_response",
      name: "EventCoverVideoProcessingError",
    });
  });
});
