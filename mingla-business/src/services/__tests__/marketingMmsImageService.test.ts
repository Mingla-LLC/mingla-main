/**
 * ORCH-1282 — marketingMmsImageService unit tests.
 *
 * Proves the MMS-specific guards + the verified-public-URL contract
 * (I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE): reject > 5 MB and
 * non-JPEG/PNG/GIF with the correct BrandCoverError; on success upload under the
 * `${brandId}/marketing-mms/…` prefix and return the VERIFIED getPublicUrl.
 *
 * Fails-on-revert: dropping the MMS_MAX_BYTES guard makes the oversized case
 * resolve instead of throwing file_too_large; widening the type set to include
 * webp makes the webp case resolve instead of throwing unsupported_type; removing
 * the verifyBrandCoverPublicUrl call makes the "verify called with the public
 * URL" assertion fail.
 */

const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockReadBytes = jest.fn();
const mockVerify = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
      })),
    },
  },
}));
jest.mock("../brandCoverService", () => ({ BRAND_COVERS_BUCKET: "brand_covers" }));
jest.mock("../brandCoverFileReader", () => ({
  readBrandCoverFileBytes: (...args: unknown[]) => mockReadBytes(...args),
}));
jest.mock("../../utils/brandCoverRules", () => {
  const actual = jest.requireActual("../../utils/brandCoverRules");
  return {
    ...actual,
    verifyBrandCoverPublicUrl: (...args: unknown[]) => mockVerify(...args),
  };
});

import {
  MMS_MAX_BYTES,
  uploadMarketingMmsImage,
} from "../marketingMmsImageService";
import { BrandCoverError } from "../../utils/brandCoverRules";

const BRAND_ID = "brand-123";

beforeEach(() => {
  mockUpload.mockReset();
  mockGetPublicUrl.mockReset();
  mockReadBytes.mockReset();
  mockVerify.mockReset();
});

describe("uploadMarketingMmsImage", () => {
  it("rejects a photo over 5 MB with file_too_large — no upload", async () => {
    await expect(
      uploadMarketingMmsImage(BRAND_ID, {
        uri: "file:///big.jpg",
        mimeType: "image/jpeg",
        fileSize: MMS_MAX_BYTES + 1,
      }),
    ).rejects.toMatchObject({
      name: "BrandCoverError",
      code: "file_too_large",
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("rejects webp (MMS-inconsistent) with unsupported_type — no upload", async () => {
    await expect(
      uploadMarketingMmsImage(BRAND_ID, {
        uri: "file:///pic.webp",
        mimeType: "image/webp",
        fileSize: 1000,
      }),
    ).rejects.toMatchObject({
      name: "BrandCoverError",
      code: "unsupported_type",
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("rejects a non-image (pdf) with unsupported_type", async () => {
    await expect(
      uploadMarketingMmsImage(BRAND_ID, {
        uri: "file:///doc.pdf",
        mimeType: "application/pdf",
        fileSize: 1000,
      }),
    ).rejects.toBeInstanceOf(BrandCoverError);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("accepts a PNG: uploads under marketing-mms/, verifies, returns the public URL", async () => {
    const publicUrl =
      "https://x.supabase.co/storage/v1/object/public/brand_covers/brand-123/marketing-mms/tok.png";
    mockReadBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      byteLength: 3,
    });
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl } });
    mockVerify.mockResolvedValue(undefined);

    const result = await uploadMarketingMmsImage(BRAND_ID, {
      uri: "file:///pic.png",
      mimeType: "image/png",
      fileSize: 2048,
    });

    expect(result).toBe(publicUrl);
    // Upload path is brand-keyed under the marketing-mms prefix.
    const uploadPath = mockUpload.mock.calls[0][0] as string;
    expect(uploadPath.startsWith(`${BRAND_ID}/marketing-mms/`)).toBe(true);
    expect(uploadPath.endsWith(".png")).toBe(true);
    // The returned URL was proven reachable BEFORE being handed back.
    expect(mockVerify).toHaveBeenCalledWith(publicUrl);
  });

  it("throws upload_failed when storage upload errors", async () => {
    mockReadBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      byteLength: 3,
    });
    mockUpload.mockResolvedValue({ error: { message: "boom" } });

    await expect(
      uploadMarketingMmsImage(BRAND_ID, {
        uri: "file:///pic.jpg",
        mimeType: "image/jpeg",
        fileSize: 2048,
      }),
    ).rejects.toMatchObject({ code: "upload_failed" });
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
