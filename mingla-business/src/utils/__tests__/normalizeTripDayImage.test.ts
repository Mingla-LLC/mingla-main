/**
 * ORCH-1119C [trip-day-media-gallery · HEIC fix] — regression test for the
 * client-side HEIC -> JPEG normalize helper.
 *
 * Proves: HEIC (by mime) converts; HEIC (by extension, null mime) converts;
 * jpeg/png/webp pass through untouched; GIF passes through untouched (converting
 * a GIF to JPEG would kill the animation); video passes through untouched.
 *
 * [TEST-MOD-APPROVED ORCH-1119] — append-only new test file.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockManipulateAsync =
  jest.fn<
    (
      uri: string,
      actions: unknown[],
      opts: unknown,
    ) => Promise<{ uri: string; width: number; height: number }>
  >();

jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (uri: string, actions: unknown[], opts: unknown) =>
    mockManipulateAsync(uri, actions, opts),
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

// eslint-disable-next-line import/first
import {
  isHeicAsset,
  normalizeTripDayImage,
} from "../normalizeTripDayImage";

beforeEach(() => {
  mockManipulateAsync.mockReset();
  mockManipulateAsync.mockResolvedValue({
    uri: "file:///tmp/converted.jpg",
    width: 4032,
    height: 3024,
  });
});

describe("normalizeTripDayImage — HEIC conversion", () => {
  test("HEIC by mimeType -> converts to JPEG (manipulateAsync called)", async () => {
    const out = await normalizeTripDayImage({
      uri: "file:///photos/IMG_0001.heic",
      mimeType: "image/heic",
      fileName: "IMG_0001.heic",
      fileSize: 2_000_000,
    });

    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    // Called with empty actions + JPEG @ compress 0.9.
    expect(mockManipulateAsync).toHaveBeenCalledWith(
      "file:///photos/IMG_0001.heic",
      [],
      { compress: 0.9, format: "jpeg" },
    );
    expect(out.uri).toBe("file:///tmp/converted.jpg");
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.fileName).toBe("IMG_0001.jpg");
    // Stale HEIC size is dropped so the service re-measures the real JPEG bytes.
    expect(out.fileSize).toBeNull();
  });

  test("HEIF by mimeType -> converts to JPEG", async () => {
    const out = await normalizeTripDayImage({
      uri: "file:///photos/IMG_0002.HEIF",
      mimeType: "image/heif",
      fileName: "IMG_0002.HEIF",
    });
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.fileName).toBe("IMG_0002.jpg");
  });

  test("HEIC by extension with NULL mimeType -> converts", async () => {
    const out = await normalizeTripDayImage({
      uri: "file:///photos/IMG_0003.HEIC",
      mimeType: null,
      fileName: null,
    });
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    expect(out.mimeType).toBe("image/jpeg");
    // No source fileName -> falls back to the default jpeg name.
    expect(out.fileName).toBe("trip-day-photo.jpg");
  });

  test("HEIC by fileName extension only (uri has none) -> converts", async () => {
    const out = await normalizeTripDayImage({
      uri: "content://media/12345",
      mimeType: null,
      fileName: "vacation.heic",
    });
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.fileName).toBe("vacation.jpg");
  });
});

describe("normalizeTripDayImage — passthrough (NOT converted)", () => {
  test("jpeg -> passthrough (no manipulate)", async () => {
    const asset = {
      uri: "file:///photos/p.jpg",
      mimeType: "image/jpeg",
      fileName: "p.jpg",
      fileSize: 100,
    };
    const out = await normalizeTripDayImage(asset);
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(out).toBe(asset);
  });

  test("png -> passthrough (no manipulate)", async () => {
    const out = await normalizeTripDayImage({
      uri: "file:///photos/p.png",
      mimeType: "image/png",
      fileName: "p.png",
    });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(out.mimeType).toBe("image/png");
  });

  test("webp -> passthrough (no manipulate)", async () => {
    const out = await normalizeTripDayImage({
      uri: "file:///photos/p.webp",
      mimeType: "image/webp",
      fileName: "p.webp",
    });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(out.mimeType).toBe("image/webp");
  });

  test("GIF -> passthrough (must NOT convert — converting kills the animation)", async () => {
    const asset = {
      uri: "file:///photos/anim.gif",
      mimeType: "image/gif",
      fileName: "anim.gif",
    };
    const out = await normalizeTripDayImage(asset);
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(out).toBe(asset);
    expect(out.mimeType).toBe("image/gif");
  });

  test("video (quicktime/.mov) -> passthrough (must NOT convert)", async () => {
    const asset = {
      uri: "file:///videos/clip.mov",
      mimeType: "video/quicktime",
      fileName: "clip.mov",
    };
    const out = await normalizeTripDayImage(asset);
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(out).toBe(asset);
  });

  test("video (mp4) -> passthrough", async () => {
    const out = await normalizeTripDayImage({
      uri: "file:///videos/clip.mp4",
      mimeType: "video/mp4",
      fileName: "clip.mp4",
    });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(out.mimeType).toBe("video/mp4");
  });
});

describe("isHeicAsset detection", () => {
  test("image/heic mime", () => {
    expect(isHeicAsset({ uri: "x", mimeType: "image/heic" })).toBe(true);
  });
  test("image/heif mime (mixed case, padded)", () => {
    expect(isHeicAsset({ uri: "x", mimeType: " IMAGE/HEIF " })).toBe(true);
  });
  test(".heic uri extension w/ null mime", () => {
    expect(isHeicAsset({ uri: "file:///a/b.HEIC", mimeType: null })).toBe(true);
  });
  test(".heic with query string still detected", () => {
    expect(isHeicAsset({ uri: "file:///a/b.heic?foo=1", mimeType: null })).toBe(
      true,
    );
  });
  test("jpeg is not heic", () => {
    expect(
      isHeicAsset({ uri: "file:///a/b.jpg", mimeType: "image/jpeg" }),
    ).toBe(false);
  });
  test("gif is not heic", () => {
    expect(isHeicAsset({ uri: "file:///a/b.gif", mimeType: "image/gif" })).toBe(
      false,
    );
  });
});
