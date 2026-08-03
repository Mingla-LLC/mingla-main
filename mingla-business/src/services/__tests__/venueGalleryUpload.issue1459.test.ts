const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockReadBytes = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  },
}));
jest.mock("../brandAvatarFileReader", () => ({
  readBrandAvatarFileBytes: mockReadBytes,
}));
jest.mock("../venueGalleryDeviceMedia", () => ({
  launchGalleryImagePicker: jest.fn(),
}));
jest.mock("../../utils/brandAvatarRules", () => ({
  generateBrandAvatarPathToken: () => "issue-1459-token",
}));

// Mocks must be installed before the service import.
// eslint-disable-next-line import/first
import {
  uploadGalleryPhoto,
  VENUE_GALLERY_MAX_BYTES,
} from "../venueGalleryService";

describe("Issue #1459 venue gallery upload contract", () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockGetPublicUrl.mockReset();
    mockReadBytes.mockReset();
    mockReadBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      byteLength: 3,
    });
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: "https://example.test/gallery/photo.heic" },
    });
  });

  it("accepts a real-iPhone HEIC asset and preserves its MIME and extension", async () => {
    await expect(
      uploadGalleryPhoto("brand-1", {
        uri: "file:///photo.heic",
        mimeType: "image/heic",
        fileName: "photo.heic",
        fileSize: 3,
      }),
    ).resolves.toBe("https://example.test/gallery/photo.heic");

    expect(mockUpload).toHaveBeenCalledWith(
      "brand-1/gallery/issue-1459-token.heic",
      expect.any(ArrayBuffer),
      { contentType: "image/heic", upsert: true },
    );
  });

  it("rejects above the exact 8 MiB bucket boundary before reading bytes", async () => {
    expect(VENUE_GALLERY_MAX_BYTES).toBe(8 * 1024 * 1024);
    await expect(
      uploadGalleryPhoto("brand-1", {
        uri: "file:///large.jpg",
        mimeType: "image/jpeg",
        fileSize: VENUE_GALLERY_MAX_BYTES + 1,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "file_too_large",
        message: "Each photo must be under 8 MB.",
      }),
    );
    expect(mockReadBytes).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
