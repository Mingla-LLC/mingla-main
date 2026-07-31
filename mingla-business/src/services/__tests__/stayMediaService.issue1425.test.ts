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
jest.mock("../venueGalleryService", () => ({
  pickGalleryPhotos: jest.fn(),
  VenueGalleryError: class VenueGalleryError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
jest.mock("../../utils/brandAvatarRules", () => ({
  generateBrandAvatarPathToken: () => "stable-token",
}));

// The mocks must be declared before this import so Jest's hoisted factories can use them.
// eslint-disable-next-line import/first
import {
  stayOfferingMediaUrl,
  uploadStayOfferingPhoto,
} from "../stayMediaService";

describe("Issue #1425 Stay offering media", () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockGetPublicUrl.mockReset();
    mockReadBytes.mockReset();
    mockReadBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      byteLength: 3,
    });
    mockUpload.mockResolvedValue({
      data: {
        id: "storage-object-1",
        path: "brand-1/stays/venue-1/stable-token.jpg",
        fullPath: "brand_covers/brand-1/stays/venue-1/stable-token.jpg",
      },
      error: null,
    });
  });

  it("uploads under the exact brand/Stay path and returns the storage object id", async () => {
    const result = await uploadStayOfferingPhoto({
      brandId: "brand-1",
      venueId: "venue-1",
      asset: {
        uri: "file:///suite.jpg",
        mimeType: "image/jpeg",
        fileSize: 3,
      },
      isCover: true,
      altText: "Lagoon suite",
    });

    expect(mockUpload).toHaveBeenCalledWith(
      "brand-1/stays/venue-1/stable-token.jpg",
      expect.any(ArrayBuffer),
      { contentType: "image/jpeg", upsert: false },
    );
    expect(result).toEqual({
      storageObjectId: "storage-object-1",
      altText: "Lagoon suite",
      isCover: true,
    });
  });

  it("derives display URLs from the existing brand_covers bucket only", () => {
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: "https://example.test/suite.jpg" },
    });
    expect(stayOfferingMediaUrl("brand-1/stays/venue-1/suite.jpg")).toBe(
      "https://example.test/suite.jpg",
    );
    expect(mockGetPublicUrl).toHaveBeenCalledWith(
      "brand-1/stays/venue-1/suite.jpg",
    );
  });
});
