import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  EventCoverMediaError,
  EVENT_COVER_MAX_BYTES,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  classifyEventCoverMedia,
  eventCoverContentType,
  eventCoverExtension,
  normalizeEventCoverAsset,
  sniffEventCoverMimeType,
  validateEventCoverAsset,
  verifyEventCoverPublicUrl,
} from "../../utils/eventCoverMediaRules";
import { uploadEventCoverMedia } from "../eventCoverMediaService";
import { supabase } from "../supabase";

// [TEST-MOD-APPROVED ORCH-1062] B3c-style byte-read mock migration — the local
// file read moved off `expo-file-system` `new File(uri).arrayBuffer()` onto
// `readEventCoverFileBytes(uri)` (services/eventCoverFileReader.ts), which now
// reads via `fetch(uri).arrayBuffer()`. The old `expo-file-system.File` mock is
// dead (nothing imports it any more), so every upload test resolved 0 bytes and
// dead-ended at the "We couldn't read that file" guard. Mock the current read
// seam directly. This is plumbing only — zero `expect()` changed.
const mockReadEventCoverFileBytes = jest.fn<
  (uri: string) => Promise<{ bytes: Uint8Array; byteLength: number }>
>();

const fileBytes = (
  arr: number[],
): { bytes: Uint8Array; byteLength: number } => {
  const bytes = new Uint8Array(arr);
  return { bytes, byteLength: bytes.byteLength };
};

jest.mock("../supabase", () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
  },
}));

jest.mock("../eventCoverFileReader", () => ({
  readEventCoverFileBytes: (uri: string) => mockReadEventCoverFileBytes(uri),
}));

describe("eventCoverMediaService", () => {
  const storageUpload = jest.fn() as jest.MockedFunction<
    (
      path: string,
      body: unknown,
      options: unknown,
    ) => Promise<{ error: { message: string } | null }>
  >;
  const storageGetPublicUrl = jest.fn();
  const storageFrom = supabase.storage.from as jest.Mock;
  const originalFetch = global.fetch;

  const fetchResponse = ({
    bodyBytes = 1,
    contentLength = "1",
    contentRange = null,
    contentType = "image/png",
    ok = true,
    status = 200,
  }: {
    bodyBytes?: number;
    contentLength?: string | null;
    contentRange?: string | null;
    contentType?: string | null;
    ok?: boolean;
    status?: number;
  }): Response =>
    ({
      arrayBuffer: async () => ({ byteLength: bodyBytes }),
      blob: async () => ({ size: bodyBytes }),
      headers: {
        get: (name: string) => {
          const normalized = name.toLowerCase();
          if (normalized === "content-type") return contentType;
          if (normalized === "content-length") return contentLength;
          if (normalized === "content-range") return contentRange;
          return null;
        },
      },
      ok,
      status,
    }) as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadEventCoverFileBytes.mockResolvedValue(
      fileBytes([0x89, 0x50, 0x4e, 0x47]),
    );
    storageUpload.mockResolvedValue({ error: null });
    storageGetPublicUrl.mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/cover.png" },
    });
    storageFrom.mockReturnValue({
      getPublicUrl: storageGetPublicUrl,
      upload: storageUpload,
    });
    global.fetch = jest.fn(async () =>
      fetchResponse({ contentType: "image/png" }),
    ) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test("classifies supported image, gif, and video covers", () => {
    expect(classifyEventCoverMedia("image/jpeg", "cover.jpg")).toBe("image");
    expect(classifyEventCoverMedia("image/png", "cover.png")).toBe("image");
    expect(classifyEventCoverMedia("image/webp", "cover.webp")).toBe("image");
    expect(classifyEventCoverMedia("image/gif", "cover.gif")).toBe("gif");
    expect(classifyEventCoverMedia("video/mp4", "cover.mp4")).toBe("video");
    expect(classifyEventCoverMedia("video/quicktime", "cover.mov")).toBe(
      "video",
    );
    expect(classifyEventCoverMedia(null, "cover.webm")).toBe("video");
    expect(
      classifyEventCoverMedia({
        byteHeader: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      }),
    ).toBe("image");
    expect(
      classifyEventCoverMedia({
        pickerType: "image",
        uri: "file:///picker-asset",
      }),
    ).toBe("image");
  });

  test("keeps storage extension aligned with selected media", () => {
    expect(
      eventCoverExtension({
        mediaType: "image",
        mimeType: "image/png",
        fileName: "cover.png",
      }),
    ).toBe("png");
    expect(
      eventCoverExtension({
        mediaType: "image",
        mimeType: "image/webp",
      }),
    ).toBe("webp");
    expect(
      eventCoverExtension({
        mediaType: "video",
        mimeType: "video/quicktime",
      }),
    ).toBe("mov");
    expect(
      eventCoverExtension({
        mediaType: "video",
        mimeType: "video/webm",
      }),
    ).toBe("webm");
    expect(
      eventCoverExtension({
        mediaType: "video",
        mimeType: "video/mp4",
        fileName: "iphone-export.mov",
      }),
    ).toBe("mp4");
  });

  test("treats generic MIME as absent when deriving upload content type", () => {
    expect(
      eventCoverContentType({
        blobMimeType: "image/png",
        fileName: "cover.jpg",
        mediaType: "image",
        mimeType: "application/octet-stream",
      }),
    ).toBe("image/jpeg");
    expect(
      eventCoverContentType({
        blobMimeType: "image/webp",
        mediaType: "image",
        mimeType: "application/octet-stream",
      }),
    ).toBe("image/webp");
  });

  test("sniffs common cover media byte headers", () => {
    expect(
      sniffEventCoverMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0x00])),
    ).toBe("image/jpeg");
    expect(
      sniffEventCoverMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    ).toBe("image/png");
    expect(
      sniffEventCoverMimeType(new Uint8Array([0x47, 0x49, 0x46, 0x38])),
    ).toBe("image/gif");
    expect(
      sniffEventCoverMimeType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
      ),
    ).toBe("image/webp");
    expect(
      sniffEventCoverMimeType(
        new Uint8Array([
          0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f,
          0x6d,
        ]),
      ),
    ).toBe("video/mp4");
    expect(
      sniffEventCoverMimeType(
        new Uint8Array([
          0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20,
          0x20,
        ]),
      ),
    ).toBe("video/quicktime");
    expect(
      sniffEventCoverMimeType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])),
    ).toBe("video/webm");
  });

  test("normalizes picker assets using URI, picker type, and bytes when MIME and filename are missing", () => {
    expect(
      normalizeEventCoverAsset({
        byteHeader: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
        pickerType: "image",
        uri: "file:///opaque-picker-asset",
      }),
    ).toMatchObject({
      inferredMimeType: "image/jpeg",
      mediaType: "image",
    });

    expect(
      normalizeEventCoverAsset({
        durationMs: 1_000,
        pickerType: "video",
        uri: "file:///cover.webm?cache=1",
      }),
    ).toMatchObject({
      inferredMimeType: "video/webm",
      mediaType: "video",
    });
  });

  test("rejects unsupported cover media types", () => {
    expect(() =>
      validateEventCoverAsset({
        mimeType: "application/pdf",
        fileName: "x.pdf",
      }),
    ).toThrow(EventCoverMediaError);
  });

  test("rejects oversized cover assets", () => {
    expect(() =>
      validateEventCoverAsset({
        mimeType: "image/png",
        fileSize: EVENT_COVER_MAX_BYTES + 1,
      }),
    ).toThrow("Covers must be 30 MB or smaller.");
  });

  test("rejects over-duration video covers", () => {
    // [TEST-MOD-APPROVED #2715] The direct validator shares the exact 15-second
    // owner with the processed cover-video pipeline.
    expect(() =>
      validateEventCoverAsset({
        mimeType: "video/mp4",
        durationMs: EVENT_COVER_MAX_VIDEO_DURATION_MS + 1,
      }),
    ).toThrow("Choose a video that is 15 seconds or shorter.");
  });

  test("rejects videos with missing duration using a precise error", () => {
    try {
      validateEventCoverAsset({
        mimeType: "video/mp4",
        fileName: "cover.mp4",
      });
      throw new Error("Expected missing duration to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EventCoverMediaError);
      expect((error as EventCoverMediaError).code).toBe(
        "video_duration_unknown",
      );
      // [TEST-MOD-APPROVED #2715] Exact actionable copy preserves fail-safe
      // missing-duration rejection without exposing implementation detail.
      expect((error as Error).message).toBe(
        "Choose a 15-second MP4, MOV, or WebM video.",
      );
    }
  });

  // [TEST-MOD-APPROVED #2715] Title follows the shared 15-second owner.
  test("accepts iOS MOV or QuickTime videos when they are within the 15-second cover limit", () => {
    expect(
      validateEventCoverAsset({
        mimeType: "video/quicktime",
        fileName: "cover.mov",
        durationMs: 8_000,
      }),
    ).toBe("video");
  });

  test("verifies public cover URLs before declaring upload success", async () => {
    const fetchOk = jest.fn(async () =>
      fetchResponse({ contentType: "image/png" }),
    ) as unknown as typeof fetch;

    await expect(
      verifyEventCoverPublicUrl(
        "https://cdn.example.com/cover.png",
        "image",
        fetchOk,
      ),
    ).resolves.toBeUndefined();

    const fetchBad = jest.fn(async () =>
      fetchResponse({ contentType: "text/html" }),
    ) as unknown as typeof fetch;

    await expect(
      verifyEventCoverPublicUrl(
        "https://cdn.example.com/cover.png",
        "image",
        fetchBad,
      ),
    ).rejects.toMatchObject({ code: "display_failed" });
  });

  test("rejects zero-byte public cover URLs", async () => {
    const fetchZero = jest.fn(async () =>
      fetchResponse({ contentLength: "0", contentType: "image/png" }),
    ) as unknown as typeof fetch;

    await expect(
      verifyEventCoverPublicUrl(
        "https://cdn.example.com/empty.png",
        "image",
        fetchZero,
      ),
    ).rejects.toMatchObject({ code: "display_failed" });
  });

  test("rejects zero-byte range fallback responses", async () => {
    const fetchZeroRange = jest.fn<() => Promise<Response>>();
    fetchZeroRange
      .mockResolvedValueOnce(
        fetchResponse({ contentLength: null, contentType: "image/png" }),
      )
      .mockResolvedValueOnce(
        fetchResponse({
          bodyBytes: 0,
          contentLength: null,
          contentType: "image/png",
        }),
      );

    await expect(
      verifyEventCoverPublicUrl(
        "https://cdn.example.com/empty.png",
        "image",
        fetchZeroRange as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: "display_failed" });
    expect(fetchZeroRange).toHaveBeenCalledTimes(2);
  });

  test("accepts range fallback responses only after non-empty bytes are proven", async () => {
    const fetchRange = jest.fn<() => Promise<Response>>();
    fetchRange
      .mockResolvedValueOnce(
        fetchResponse({ contentLength: null, contentType: "image/png" }),
      )
      .mockResolvedValueOnce(
        fetchResponse({
          bodyBytes: 1,
          contentLength: "1",
          contentRange: "bytes 0-0/128",
          contentType: "image/png",
          status: 206,
        }),
      );

    await expect(
      verifyEventCoverPublicUrl(
        "https://cdn.example.com/cover.png",
        "image",
        fetchRange as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
    expect(fetchRange).toHaveBeenCalledTimes(2);
  });

  test("rejects empty local file bytes before storage upload", async () => {
    mockReadEventCoverFileBytes.mockResolvedValueOnce({
      bytes: new Uint8Array(0),
      byteLength: 0,
    });

    await expect(
      uploadEventCoverMedia({
        brandId: "brand-1",
        eventId: "event-1",
        fileName: "cover.png",
        fileSize: 123,
        mimeType: "image/png",
        uri: "file:///cover.png",
      }),
    ).rejects.toMatchObject({ code: "upload_failed" });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test("uploads React Native-safe Uint8Array bytes instead of Blob", async () => {
    await expect(
      uploadEventCoverMedia({
        brandId: "brand-1",
        eventId: "event-1",
        fileName: "cover.png",
        fileSize: 4,
        mimeType: "image/png",
        pickerType: "image",
        uri: "file:///cover.png",
      }),
    ).resolves.toMatchObject({
      mediaType: "image",
      publicUrl: "https://cdn.example.com/cover.png",
    });

    expect(storageUpload).toHaveBeenCalledTimes(1);
    const body = storageUpload.mock.calls[0]?.[1];
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body).not.toBeInstanceOf(Blob);
  });

  test("routes over-duration videos through video_too_long before upload if trim returned an over-limit asset", async () => {
    mockReadEventCoverFileBytes.mockResolvedValueOnce(
      fileBytes([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f,
        0x6d,
      ]),
    );

    await expect(
      uploadEventCoverMedia({
        brandId: "brand-1",
        durationMs: EVENT_COVER_MAX_VIDEO_DURATION_MS + 1,
        eventId: "event-1",
        fileName: "cover.mp4",
        fileSize: 12,
        mimeType: "video/mp4",
        pickerType: "video",
        uri: "file:///cover.mp4",
      }),
    ).rejects.toMatchObject({ code: "video_too_long" });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  // [TEST-MOD-APPROVED #2715] Title follows the shared 15-second owner.
  test("keeps 15-second enforcement for iOS MOV videos before upload", async () => {
    mockReadEventCoverFileBytes.mockResolvedValueOnce(
      fileBytes([
        0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20,
        0x20,
      ]),
    );

    await expect(
      uploadEventCoverMedia({
        brandId: "brand-1",
        durationMs: EVENT_COVER_MAX_VIDEO_DURATION_MS + 1,
        eventId: "event-1",
        fileName: "cover.mov",
        fileSize: 12,
        mimeType: "video/quicktime",
        pickerType: "video",
        uri: "file:///cover.mov",
      }),
    ).rejects.toMatchObject({ code: "video_too_long" });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test("uploads short iOS MOV videos with QuickTime content type", async () => {
    mockReadEventCoverFileBytes.mockResolvedValueOnce(
      fileBytes([
        0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20,
        0x20,
      ]),
    );
    storageGetPublicUrl.mockReturnValueOnce({
      data: { publicUrl: "https://cdn.example.com/cover.mov" },
    });
    (global.fetch as jest.Mock).mockImplementation(async () =>
      fetchResponse({ contentType: "video/quicktime" }),
    );

    await expect(
      uploadEventCoverMedia({
        brandId: "brand-1",
        durationMs: 8_000,
        eventId: "event-1",
        fileName: "cover.mov",
        fileSize: 12,
        mimeType: "video/quicktime",
        pickerType: "video",
        uri: "file:///cover.mov",
      }),
    ).resolves.toMatchObject({
      mediaType: "video",
      publicUrl: "https://cdn.example.com/cover.mov",
    });

    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(storageUpload.mock.calls[0]?.[0]).toMatch(/\.mov$/);
    expect(storageUpload.mock.calls[0]?.[2]).toMatchObject({
      contentType: "video/quicktime",
    });
  });
});
