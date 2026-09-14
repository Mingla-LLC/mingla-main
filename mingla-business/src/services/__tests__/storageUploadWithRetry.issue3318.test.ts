/**
 * Issue #3318 — the storage upload had no deadline and no retry.
 *
 * The 2026-09-14 photo never reached the server: the request waited out the
 * platform default (~60 s) and failed once, for good. `uploadEventCoverMedia`
 * and `uploadBrandCover` now bound each attempt and retry ONCE on a network
 * failure, to the SAME storage path (random per upload, `upsert: true`).
 *
 * REAL CODE: the real services against a mocked Supabase client.
 *
 *   T2  a storage upload that never settles → rejects after the timeout, having
 *       retried once to the same path; the failure says it was a timeout
 *   +   a network error retries once and a second-attempt success resolves
 *   +   an HTTP error from storage is an answer and is NOT retried
 *   +   every stage is announced in order (read → upload → verify)
 *
 * FAILS-ON-REVERT: proven in the #3318 implementation record.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockStorageUpload = jest.fn<
  (path: string, body: unknown, options: { contentType?: string; upsert?: boolean }) => Promise<{
    error: { message: string; name?: string } | null;
  }>
>();

jest.mock("../supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (path: string, body: unknown, options: { contentType?: string; upsert?: boolean }) =>
          mockStorageUpload(path, body, options),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.test/${path}` } }),
      }),
    },
  },
}));

jest.mock("../eventCoverFileReader", () => ({
  readEventCoverFileBytes: async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    return { bytes, byteLength: 2_400_000 };
  },
}));

jest.mock("../brandCoverFileReader", () => ({
  readBrandCoverFileBytes: async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    return { bytes, byteLength: 2_400_000 };
  },
}));

import { uploadBrandCover } from "../brandCoverService";
import { uploadEventCoverMedia } from "../eventCoverMediaService";
import {
  storageUploadTimeoutMs,
  StorageUploadError,
  StorageUploadTimeoutError,
  uploadToStorageWithRetry,
} from "../storageUploadWithRetry";

const okResponse = (): Response =>
  ({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === "content-type") return "image/jpeg";
        if (key === "content-length") return "2400000";
        return null;
      },
    },
    arrayBuffer: async () => new ArrayBuffer(1),
    blob: async () => ({ size: 1 }),
  }) as unknown as Response;

const originalFetch = global.fetch;

beforeEach(() => {
  mockStorageUpload.mockReset();
  global.fetch = jest.fn(async () => okResponse()) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

const eventInput = {
  uri: "file:///picked/IMG_0412.jpg",
  brandId: "brand-1",
  eventId: "event-1",
  mimeType: "image/jpeg",
  fileName: "IMG_0412.jpg",
  fileSize: 2_400_000,
  durationMs: null,
  pickerType: "image",
};

const NETWORK_ERROR = { name: "StorageUnknownError", message: "Network request failed" };
const HTTP_ERROR = { name: "StorageApiError", message: "new row violates row-level security policy" };

describe("T2 — a storage upload that never settles fails after its timeout, once retried", () => {
  test("event cover media: rejects after two attempts to the SAME path, and says it timed out", async () => {
    jest.useFakeTimers();
    mockStorageUpload.mockImplementation(() => new Promise(() => undefined));
    const timeout = storageUploadTimeoutMs(2_400_000);
    expect(timeout).toBe(26_000);

    let caught: unknown = null;
    const uploading = uploadEventCoverMedia(eventInput).catch((error: unknown) => {
      caught = error;
    });
    await jest.advanceTimersByTimeAsync(timeout - 1);
    expect(caught).toBeNull();
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(timeout);
    await uploading;

    expect(caught).toMatchObject({ name: "EventCoverMediaError", code: "upload_failed" });
    const cause = (caught as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(StorageUploadError);
    expect(cause).toMatchObject({ retryable: true, timedOut: true, attempts: 2 });
    const [firstPath, , firstOptions] = mockStorageUpload.mock.calls[0];
    const [secondPath, , secondOptions] = mockStorageUpload.mock.calls[1];
    expect(secondPath).toBe(firstPath);
    expect(firstOptions.upsert).toBe(true);
    expect(secondOptions.upsert).toBe(true);
  });

  test("brand cover: the same bound, the same path, and the original code and copy for existing callers", async () => {
    jest.useFakeTimers();
    mockStorageUpload.mockImplementation(() => new Promise(() => undefined));
    let caught: unknown = null;
    const uploading = uploadBrandCover(
      "brand-1",
      { uri: "file:///picked/a.jpg", mimeType: "image/jpeg", fileName: "a.jpg", fileSize: 2_400_000 },
      { previousPublicUrl: null },
    ).catch((error: unknown) => {
      caught = error;
    });
    await jest.advanceTimersByTimeAsync(2 * storageUploadTimeoutMs(2_400_000));
    await uploading;
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    expect(mockStorageUpload.mock.calls[1][0]).toBe(mockStorageUpload.mock.calls[0][0]);
    expect(caught).toMatchObject({
      name: "BrandCoverError",
      code: "upload_failed",
      message: "Couldn't upload cover. Tap to try again.",
    });
    expect((caught as { cause?: unknown }).cause).toMatchObject({ timedOut: true, attempts: 2 });
  });
});

describe("retry policy", () => {
  test("a network error is retried once, and a second-attempt success resolves the upload", async () => {
    mockStorageUpload
      .mockResolvedValueOnce({ error: NETWORK_ERROR })
      .mockResolvedValueOnce({ error: null });
    const stages: string[] = [];
    const result = await uploadEventCoverMedia(eventInput, { onStage: (stage) => stages.push(stage) });
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    expect(result.storagePath).toBe(mockStorageUpload.mock.calls[0][0]);
    expect(stages).toEqual(["read", "upload", "verify"]);
  });

  test("an HTTP error from storage is not retried", async () => {
    mockStorageUpload.mockResolvedValue({ error: HTTP_ERROR });
    await expect(uploadEventCoverMedia(eventInput)).rejects.toMatchObject({
      code: "upload_failed",
      cause: expect.objectContaining({ retryable: false, timedOut: false, attempts: 1 }),
    });
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
  });

  test("two network errors in a row give up after exactly one retry", async () => {
    mockStorageUpload.mockResolvedValue({ error: NETWORK_ERROR });
    await expect(
      uploadBrandCover("brand-1", { uri: "file:///a.jpg", mimeType: "image/jpeg", fileName: "a.jpg", fileSize: 10 }),
    ).rejects.toMatchObject({ code: "upload_failed", cause: expect.objectContaining({ retryable: true, attempts: 2 }) });
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
  });

  test("the per-attempt timeout scales with size and is clamped", () => {
    expect(storageUploadTimeoutMs(0)).toBe(20_000);
    expect(storageUploadTimeoutMs(null)).toBe(20_000);
    expect(storageUploadTimeoutMs(8 * 1024 * 1024)).toBe(38_000);
    expect(storageUploadTimeoutMs(30 * 1024 * 1024)).toBe(84_000);
    expect(storageUploadTimeoutMs(10_000_000_000)).toBe(90_000);
  });

  test("a thrown attempt counts as a failure, and the timeout error names itself", async () => {
    await expect(
      uploadToStorageWithRetry({
        attempt: () => {
          throw NETWORK_ERROR;
        },
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ retryable: true, attempts: 2 });
    expect(new StorageUploadTimeoutError(26_000).message).toMatch(/26 s/);
  });
});
