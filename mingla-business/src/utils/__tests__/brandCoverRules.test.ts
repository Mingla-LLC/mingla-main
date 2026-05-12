import { describe, expect, test } from "@jest/globals";

import {
  BRAND_COVER_ALLOWED_MIME_TYPES,
  BRAND_COVER_MAX_BYTES,
  BrandCoverError,
  brandCoverMediaTypeFromMime,
  brandCoverStoragePath,
  extractBrandCoverStoragePath,
  generateBrandCoverPathToken,
  resolveBrandCoverContentType,
  validateBrandCoverProviderUrl,
} from "../brandCoverRules";

describe("BRAND_COVER_ALLOWED_MIME_TYPES", () => {
  test("contains jpeg, png, webp, gif", () => {
    expect([...BRAND_COVER_ALLOWED_MIME_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ]);
  });

  test("max bytes is 15 MB", () => {
    expect(BRAND_COVER_MAX_BYTES).toBe(15 * 1024 * 1024);
  });
});

describe("resolveBrandCoverContentType", () => {
  test("returns mime when provided as image/jpeg", () => {
    expect(
      resolveBrandCoverContentType({
        uri: "file:///tmp/a.jpg",
        mimeType: "image/jpeg",
      }),
    ).toBe("image/jpeg");
  });

  test("returns image/gif for animated cover", () => {
    expect(
      resolveBrandCoverContentType({
        uri: "file:///tmp/a.gif",
        mimeType: "image/gif",
      }),
    ).toBe("image/gif");
  });

  test("normalises image/jpg → image/jpeg", () => {
    expect(
      resolveBrandCoverContentType({
        uri: "file:///tmp/a.jpg",
        mimeType: "image/jpg",
      }),
    ).toBe("image/jpeg");
  });

  test("rejects HEIC (unsupported)", () => {
    expect(
      resolveBrandCoverContentType({
        uri: "file:///tmp/a.heic",
        mimeType: "image/heic",
      }),
    ).toBeNull();
  });

  test("falls back to URI extension when MIME is generic octet-stream", () => {
    expect(
      resolveBrandCoverContentType({
        uri: "file:///tmp/a.webp",
        mimeType: "application/octet-stream",
      }),
    ).toBe("image/webp");
  });

  test("falls back to file name extension when no MIME at all", () => {
    expect(
      resolveBrandCoverContentType({
        uri: "file:///tmp/blob",
        fileName: "cover.png",
      }),
    ).toBe("image/png");
  });

  test("returns null when nothing resolves", () => {
    expect(
      resolveBrandCoverContentType({
        uri: "file:///tmp/blob",
      }),
    ).toBeNull();
  });
});

describe("brandCoverMediaTypeFromMime", () => {
  test("image/jpeg → image", () => {
    expect(brandCoverMediaTypeFromMime("image/jpeg")).toBe("image");
  });
  test("image/png → image", () => {
    expect(brandCoverMediaTypeFromMime("image/png")).toBe("image");
  });
  test("image/webp → image", () => {
    expect(brandCoverMediaTypeFromMime("image/webp")).toBe("image");
  });
  test("image/gif → gif", () => {
    expect(brandCoverMediaTypeFromMime("image/gif")).toBe("gif");
  });
});

describe("brandCoverStoragePath", () => {
  test("composes {brandId}/{token}.{ext}", () => {
    expect(
      brandCoverStoragePath(
        "11111111-2222-3333-4444-555555555555",
        "image/png",
        "abc123",
      ),
    ).toBe("11111111-2222-3333-4444-555555555555/abc123.png");
  });

  test("gif extension for image/gif", () => {
    expect(
      brandCoverStoragePath(
        "11111111-2222-3333-4444-555555555555",
        "image/gif",
        "tok",
      ),
    ).toBe("11111111-2222-3333-4444-555555555555/tok.gif");
  });
});

describe("generateBrandCoverPathToken", () => {
  test("produces unique-ish tokens", () => {
    const t1 = generateBrandCoverPathToken();
    const t2 = generateBrandCoverPathToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThan(4);
  });
});

describe("extractBrandCoverStoragePath", () => {
  test("parses bucket path from public URL", () => {
    const path = extractBrandCoverStoragePath(
      "https://gqno.supabase.co/storage/v1/object/public/brand_covers/abc-123/tok.jpg",
    );
    expect(path).toBe("abc-123/tok.jpg");
  });

  test("strips query string", () => {
    const path = extractBrandCoverStoragePath(
      "https://gqno.supabase.co/storage/v1/object/public/brand_covers/x/y.png?t=1",
    );
    expect(path).toBe("x/y.png");
  });

  test("returns null on non-cover URL", () => {
    expect(
      extractBrandCoverStoragePath(
        "https://gqno.supabase.co/storage/v1/object/public/creator_avatars/u.jpg",
      ),
    ).toBeNull();
  });

  test("returns null on null / empty", () => {
    expect(extractBrandCoverStoragePath(null)).toBeNull();
    expect(extractBrandCoverStoragePath("")).toBeNull();
  });
});

describe("validateBrandCoverProviderUrl", () => {
  test("Pexels happy path — images.pexels.com", () => {
    const out = validateBrandCoverProviderUrl({
      provider: "pexels",
      publicUrl: "https://images.pexels.com/photos/123/abc.jpg",
      attribution: { name: "Foo", url: "https://www.pexels.com/foo" },
    });
    expect(out.mediaType).toBe("image");
    expect(out.publicUrl).toBe("https://images.pexels.com/photos/123/abc.jpg");
  });

  test("Giphy happy path — media.giphy.com", () => {
    const out = validateBrandCoverProviderUrl({
      provider: "giphy",
      publicUrl: "https://media.giphy.com/media/abc/giphy.gif",
      attribution: { name: "GIPHY", url: null as unknown as string },
    });
    expect(out.mediaType).toBe("gif");
  });

  test("Giphy happy path — media0.giphy.com (CDN subdomain)", () => {
    const out = validateBrandCoverProviderUrl({
      provider: "giphy",
      publicUrl: "https://media0.giphy.com/media/abc/giphy.gif",
      attribution: null,
    });
    expect(out.mediaType).toBe("gif");
  });

  test("rejects non-Pexels host for Pexels provider", () => {
    expect(() =>
      validateBrandCoverProviderUrl({
        provider: "pexels",
        publicUrl: "https://evil.example.com/x.jpg",
        attribution: null,
      }),
    ).toThrow(BrandCoverError);
  });

  test("rejects non-Giphy host for Giphy provider", () => {
    expect(() =>
      validateBrandCoverProviderUrl({
        provider: "giphy",
        publicUrl: "https://evil.example.com/x.gif",
        attribution: null,
      }),
    ).toThrow(BrandCoverError);
  });

  test("rejects HTTP (non-HTTPS) URL", () => {
    expect(() =>
      validateBrandCoverProviderUrl({
        provider: "pexels",
        publicUrl: "http://images.pexels.com/x.jpg",
        attribution: null,
      }),
    ).toThrow(BrandCoverError);
  });

  test("rejects malformed URL", () => {
    expect(() =>
      validateBrandCoverProviderUrl({
        provider: "pexels",
        publicUrl: "not a url",
        attribution: null,
      }),
    ).toThrow(BrandCoverError);
  });
});

describe("BrandCoverError", () => {
  test("carries its code", () => {
    const err = new BrandCoverError("file_too_large", "Too big.");
    expect(err.code).toBe("file_too_large");
    expect(err.message).toBe("Too big.");
    expect(err.name).toBe("BrandCoverError");
    expect(err instanceof Error).toBe(true);
  });
});
