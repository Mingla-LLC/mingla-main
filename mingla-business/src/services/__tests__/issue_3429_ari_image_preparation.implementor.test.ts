/**
 * #3429 REWORK-1 implementor proof — D-5 client image preparation.
 * Photos are re-encoded on the device to a 1,600 px long edge (never upscaled)
 * before upload; PNG/WebP become WebP, everything else JPEG, and the size sent
 * is the prepared file's real size.
 */

const mockManipulate = jest.fn();
const mockReadSize = jest.fn<Promise<number | null>, [{ uri: string }]>();

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
  manipulateAsync: (uri: string, actions: unknown[], options: unknown) => mockManipulate(uri, actions, options),
}));
jest.mock("../ariAttachmentFileReader", () => ({
  readAriAttachmentSize: (source: { uri: string }) => mockReadSize(source),
}));

import {
  ARI_IMAGE_PREPARED_LONG_EDGE,
  ariPreparedDimensions,
  planAriImagePreparation,
} from "../ariImagePreparation";
import { prepareAriImage } from "../ariPrepareImage.native";

describe("#3429 D-5 image preparation planner", () => {
  it("plans a 12 MP HEIC as a 1600x1200 JPEG at 0.85", () => {
    expect(planAriImagePreparation({ name: "IMG_0001.HEIC", mimeType: "image/heic", sizeBytes: 1_700_000, width: 4032, height: 3024 }))
      .toEqual({
        kind: "prepare",
        source: "heic",
        format: "jpeg",
        mimeType: "image/jpeg",
        name: "IMG_0001.jpg",
        compress: 0.85,
        resize: { width: 1600, height: 1200 },
      });
  });

  it("keeps transparency-capable sources as WebP and floors the short edge", () => {
    expect(planAriImagePreparation({ name: "logo.png", mimeType: "image/png", sizeBytes: 5_000_000, width: 3000, height: 2000 }))
      .toMatchObject({ format: "webp", mimeType: "image/webp", name: "logo.webp", resize: { width: 1600, height: 1066 } });
    expect(ariPreparedDimensions(2000, 3000)).toEqual({ width: 1066, height: 1600 });
    expect(ariPreparedDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("refuses sources above 60 MB or 120 MP before any decode, and lets 48 MP photos through", () => {
    expect(planAriImagePreparation({ name: "huge.jpg", mimeType: "image/jpeg", sizeBytes: 61 * 1024 * 1024 }))
      .toEqual({ kind: "refuse", code: "IMAGE_SOURCE_TOO_LARGE" });
    expect(planAriImagePreparation({ name: "panorama.jpg", mimeType: "image/jpeg", sizeBytes: 9_000_000, width: 20_000, height: 6_001 }))
      .toEqual({ kind: "refuse", code: "IMAGE_SOURCE_TOO_LARGE" });
    expect(planAriImagePreparation({ name: "pro.heic", mimeType: "image/heic", sizeBytes: 6_000_000, width: 8064, height: 6048 }))
      .toMatchObject({ kind: "prepare", resize: { width: 1600, height: 1200 } });
    expect(planAriImagePreparation({ name: "report.pdf", mimeType: "application/pdf", sizeBytes: 10 })).toBeNull();
  });
});

describe("#3429 D-5 native image preparation", () => {
  beforeEach(() => {
    mockManipulate.mockReset();
    mockReadSize.mockReset();
  });

  it("resizes a 12 MP HEIC to 1600 px, saves JPEG at 0.85, and sends the output file's size", async () => {
    mockManipulate.mockResolvedValue({ uri: "file:///cache/prepared.jpg", width: 1600, height: 1200 });
    mockReadSize.mockResolvedValue(812_345);
    const prepared = await prepareAriImage({
      uri: "file:///picked/IMG_0001.HEIC",
      name: "IMG_0001.HEIC",
      mimeType: "image/heic",
      sizeBytes: 1_700_000,
      width: 4032,
      height: 3024,
    });
    expect(mockManipulate).toHaveBeenCalledTimes(1);
    expect(mockManipulate).toHaveBeenCalledWith(
      "file:///picked/IMG_0001.HEIC",
      [{ resize: { width: 1600, height: 1200 } }],
      { compress: 0.85, format: "jpeg" },
    );
    expect(mockReadSize).toHaveBeenCalledWith({ uri: "file:///cache/prepared.jpg" });
    expect(prepared).toEqual({
      uri: "file:///cache/prepared.jpg",
      name: "IMG_0001.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 812_345,
      width: 1600,
      height: 1200,
    });
  });

  it("re-encodes a PNG as WebP at 1600x1066", async () => {
    mockManipulate.mockResolvedValue({ uri: "file:///cache/logo.webp", width: 1600, height: 1066 });
    mockReadSize.mockResolvedValue(90_000);
    await expect(prepareAriImage({ uri: "file:///logo.png", name: "logo.png", mimeType: "image/png", sizeBytes: 5_000_000, width: 3000, height: 2000 }))
      .resolves.toMatchObject({ mimeType: "image/webp", name: "logo.webp", sizeBytes: 90_000 });
    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { width: 1600, height: 1066 } }]);
    expect(mockManipulate.mock.calls[0][2]).toEqual({ compress: 0.85, format: "webp" });
  });

  it("still re-encodes a small photo (metadata stripped) without resizing", async () => {
    mockManipulate.mockResolvedValue({ uri: "file:///cache/small.jpg", width: 800, height: 600 });
    mockReadSize.mockResolvedValue(40_000);
    await prepareAriImage({ uri: "file:///small.jpg", name: "small.jpg", mimeType: "image/jpeg", sizeBytes: 60_000, width: 800, height: 600 });
    expect(mockManipulate).toHaveBeenCalledTimes(1);
    expect(mockManipulate.mock.calls[0][1]).toEqual([]);
    expect(mockManipulate.mock.calls[0][2]).toEqual({ compress: 0.85, format: "jpeg" });
  });

  it("measures an unknown-size photo and scales it down after the first encode", async () => {
    mockManipulate
      .mockResolvedValueOnce({ uri: "file:///cache/first.jpg", width: 3024, height: 4032 })
      .mockResolvedValueOnce({ uri: "file:///cache/second.jpg", width: 1200, height: 1600 });
    mockReadSize.mockResolvedValue(700_000);
    const prepared = await prepareAriImage({ uri: "file:///portrait.jpg", name: "portrait.jpg", mimeType: "image/jpeg", sizeBytes: null });
    expect(mockManipulate).toHaveBeenCalledTimes(2);
    expect(mockManipulate.mock.calls[1]).toEqual([
      "file:///cache/first.jpg",
      [{ resize: { width: 1200, height: 1600 } }],
      { compress: 0.85, format: "jpeg" },
    ]);
    expect(Math.max(prepared.width, prepared.height)).toBeLessThanOrEqual(ARI_IMAGE_PREPARED_LONG_EDGE);
  });
});
