/**
 * #4304 media speed (A) — photos are shrunk on the phone before a Brand-group
 * upload: long edge capped at 2048 px, JPEG ~0.8, small photos untouched,
 * GIF/video/PDF untouched, HEIC converted and renamed to .jpg / image/jpeg.
 *
 * fails-on-revert (true line deletion): delete the `tooBig` / HEIC branch in
 * planBrandGroupImageShrink → the big-photo and HEIC cases fail; delete the
 * `fromMediaShrunk` call in brandGroupFilePicker.native.ts → the picker case
 * fails (it would upload the 4032 px original).
 */
const mockSaveAsync = jest.fn();
const mockRenderAsync = jest.fn();
const mockResize = jest.fn();
const mockReset = jest.fn();
const mockManipulate = jest.fn();
const mockFileInfo = jest.fn();
const mockLaunchLibrary = jest.fn();

jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));
jest.mock("../../../utils/platformFileSystem", () => ({
  getFileInfoAsync: (...args: unknown[]) => mockFileInfo(...args),
}));
jest.mock("../../../utils/platformImagePicker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
// The native picker imports "./brandGroupImageShrink", which Metro resolves to
// the .native file on a phone; jest resolves the web file, so point it at the
// native executor explicitly.
jest.mock("../brandGroupImageShrink", () => jest.requireActual("../brandGroupImageShrink.native"));

import {
  BRAND_GROUP_IMAGE_JPEG_QUALITY,
  BRAND_GROUP_IMAGE_MAX_EDGE,
  planBrandGroupImageShrink,
} from "../brandGroupImageShrinkPlan";
import { shrinkBrandGroupPickedFile } from "../brandGroupImageShrink.native";
import { pickBrandGroupFiles } from "../brandGroupFilePicker.native";

function context(width: number, height: number) {
  const ref = { width, height, saveAsync: mockSaveAsync, release: jest.fn() };
  const ctx = {
    renderAsync: mockRenderAsync.mockResolvedValue(ref),
    reset: mockReset,
    resize: mockResize,
    release: jest.fn(),
  };
  mockReset.mockReturnValue(ctx);
  mockResize.mockImplementation((size: { width?: number; height?: number }) => {
    const scale = (size.width ?? size.height ?? 0) / Math.max(width, height);
    mockRenderAsync.mockResolvedValueOnce({ width: Math.round(width * scale), height: Math.round(height * scale), saveAsync: mockSaveAsync, release: jest.fn() });
    return ctx;
  });
  mockManipulate.mockReturnValue(ctx);
  return ctx;
}

describe("#4304 media speed — photo shrink decision", () => {
  it("resizes a big photo so the long edge is 2048 and re-encodes it as JPEG", () => {
    expect(planBrandGroupImageShrink({ name: "IMG_1.jpg", mimeType: "image/jpeg", width: 4032, height: 3024 })).toEqual({
      action: "reencode", resize: { width: BRAND_GROUP_IMAGE_MAX_EDGE }, format: "jpeg", name: "IMG_1.jpg", mimeType: "image/jpeg",
    });
    expect(planBrandGroupImageShrink({ name: "tall.webp", mimeType: "image/webp", width: 3000, height: 6000 })).toMatchObject({
      action: "reencode", resize: { height: 2048 }, format: "jpeg", name: "tall.jpg", mimeType: "image/jpeg",
    });
  });

  it("leaves a photo that is already small untouched", () => {
    expect(planBrandGroupImageShrink({ name: "small.jpg", mimeType: "image/jpeg", width: 2048, height: 1536 })).toEqual({ action: "keep" });
    expect(planBrandGroupImageShrink({ name: "icon.png", mimeType: "image/png", width: 512, height: 512 })).toEqual({ action: "keep" });
  });

  it("never touches GIFs, videos or documents, whatever their size", () => {
    expect(planBrandGroupImageShrink({ name: "party.gif", mimeType: "image/gif", width: 4000, height: 4000 })).toEqual({ action: "keep" });
    expect(planBrandGroupImageShrink({ name: "clip.mov", mimeType: "video/quicktime", width: 3840, height: 2160 })).toEqual({ action: "keep" });
    expect(planBrandGroupImageShrink({ name: "menu.pdf", mimeType: "application/pdf" })).toEqual({ action: "keep" });
    expect(planBrandGroupImageShrink({ name: "party.GIF", mimeType: null, width: 4000, height: 4000 })).toEqual({ action: "keep" });
  });

  it("always converts HEIC to JPEG and renames it, even when small", () => {
    expect(planBrandGroupImageShrink({ name: "IMG_2.HEIC", mimeType: "image/heic", width: 1200, height: 900 })).toEqual({
      action: "reencode", resize: null, format: "jpeg", name: "IMG_2.jpg", mimeType: "image/jpeg",
    });
    expect(planBrandGroupImageShrink({ name: "IMG_3.heif", mimeType: null, width: 4032, height: 3024 })).toMatchObject({
      resize: { width: 2048 }, name: "IMG_3.jpg", mimeType: "image/jpeg",
    });
  });

  it("measures a photo whose size the picker did not report", () => {
    expect(planBrandGroupImageShrink({ name: "x.jpg", mimeType: "image/jpeg" })).toEqual({ action: "measure" });
  });
});

describe("#4304 media speed — native shrink executor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveAsync.mockResolvedValue({ uri: "file:///cache/shrunk.jpg", width: 2048, height: 1536 });
    mockFileInfo.mockResolvedValue({ exists: true, size: 612_000 });
  });

  it("writes a resized JPEG at 0.8 and updates uri, size, name and mimeType", async () => {
    context(4032, 3024);
    const result = await shrinkBrandGroupPickedFile({ uri: "file:///pick/IMG_9.HEIC", name: "IMG_9.HEIC", mimeType: "image/heic", size: 5_400_000, width: 4032, height: 3024 });
    expect(mockResize).toHaveBeenCalledWith({ width: 2048 });
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: "jpeg", compress: BRAND_GROUP_IMAGE_JPEG_QUALITY });
    expect(result).toEqual({ uri: "file:///cache/shrunk.jpg", name: "IMG_9.jpg", mimeType: "image/jpeg", size: 612_000 });
  });

  it("returns a small JPEG exactly as picked, without decoding it", async () => {
    const file = { uri: "file:///pick/a.jpg", name: "a.jpg", mimeType: "image/jpeg", size: 300_000, width: 1600, height: 1200 };
    await expect(shrinkBrandGroupPickedFile(file)).resolves.toEqual({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size });
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it("measures an unknown-size photo and keeps it when it turns out small", async () => {
    context(1000, 800);
    const file = { uri: "file:///pick/b.jpg", name: "b.jpg", mimeType: "image/jpeg", size: 200_000 };
    await expect(shrinkBrandGroupPickedFile(file)).resolves.toEqual({ ...file });
    expect(mockSaveAsync).not.toHaveBeenCalled();
  });

  it("uploads the original if the photo cannot be decoded (never drops it)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockManipulate.mockImplementation(() => { throw new Error("decode failed"); });
    const file = { uri: "file:///pick/c.jpg", name: "c.jpg", mimeType: "image/jpeg", size: 9_000_000, width: 6000, height: 4000 };
    await expect(shrinkBrandGroupPickedFile(file)).resolves.toEqual({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("the native picker shrinks library photos and leaves videos alone", async () => {
    context(4032, 3024);
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///pick/big.jpg", fileName: "big.jpg", mimeType: "image/jpeg", fileSize: 4_800_000, width: 4032, height: 3024, type: "image" },
        { uri: "file:///pick/clip.mp4", fileName: "clip.mp4", mimeType: "video/mp4", fileSize: 30_000_000, width: 1920, height: 1080, type: "video" },
      ],
    });
    const files = await pickBrandGroupFiles("photos", 10);
    expect(files).toEqual([
      { uri: "file:///cache/shrunk.jpg", name: "big.jpg", mimeType: "image/jpeg", size: 612_000 },
      { uri: "file:///pick/clip.mp4", name: "clip.mp4", mimeType: "video/mp4", size: 30_000_000 },
    ]);
    expect(mockManipulate).toHaveBeenCalledTimes(1);
  });
});
