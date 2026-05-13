/**
 * brandAvatarRules tests — ORCH-0807 SPEC §6.1 + §10 T-18 (revised 2026-05-12).
 *
 * Covers:
 *   - resolveBrandAvatarContentType (MIME by direct, filename, URI extension)
 *   - generateBrandAvatarPathToken (uniqueness + shape)
 *   - brandAvatarStoragePath (folder-style path)
 *   - extractBrandAvatarStoragePath (regex extraction)
 *
 * Square enforcement was REMOVED 2026-05-12 per operator decision — the
 * picker offers a native 1:1 crop UI via `allowsEditing: true, aspect: [1, 1]`
 * and we trust the user with that mechanism. No service-side square assertion.
 */

import {
  BrandAvatarError,
  BRAND_AVATAR_ALLOWED_MIME_TYPES,
  BRAND_AVATAR_MAX_BYTES,
  brandAvatarStoragePath,
  extractBrandAvatarStoragePath,
  generateBrandAvatarPathToken,
  resolveBrandAvatarContentType,
} from "../brandAvatarRules";

describe("BRAND_AVATAR_ALLOWED_MIME_TYPES", () => {
  it("excludes image/gif and image/heic (static images only)", () => {
    expect(BRAND_AVATAR_ALLOWED_MIME_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(BRAND_AVATAR_ALLOWED_MIME_TYPES as readonly string[]).not.toContain(
      "image/gif",
    );
    expect(BRAND_AVATAR_ALLOWED_MIME_TYPES as readonly string[]).not.toContain(
      "image/heic",
    );
  });
});

describe("BRAND_AVATAR_MAX_BYTES", () => {
  it("is 5 MB (smaller than the brand cover 15 MB cap)", () => {
    expect(BRAND_AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("resolveBrandAvatarContentType", () => {
  it("returns the MIME when input declares image/jpeg", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://a.dat", mimeType: "image/jpeg" }),
    ).toBe("image/jpeg");
  });

  it("returns the MIME when input declares image/png", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://a.dat", mimeType: "image/png" }),
    ).toBe("image/png");
  });

  it("normalizes image/jpg → image/jpeg", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://a.dat", mimeType: "image/jpg" }),
    ).toBe("image/jpeg");
  });

  it("returns null for image/gif (gif disallowed for avatars)", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://a.gif", mimeType: "image/gif" }),
    ).toBeNull();
  });

  it("returns null for image/heic (HEIC disallowed)", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://a.heic", mimeType: "image/heic" }),
    ).toBeNull();
  });

  it("returns null for video/mp4", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://a.mp4", mimeType: "video/mp4" }),
    ).toBeNull();
  });

  it("falls back to fileName extension when MIME is generic", () => {
    expect(
      resolveBrandAvatarContentType({
        uri: "file://photo",
        mimeType: "application/octet-stream",
        fileName: "photo.jpeg",
      }),
    ).toBe("image/jpeg");
  });

  it("falls back to URI extension when MIME and fileName are missing", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://photo.webp" }),
    ).toBe("image/webp");
  });

  it("returns null when nothing resolves", () => {
    expect(
      resolveBrandAvatarContentType({ uri: "file://unknown" }),
    ).toBeNull();
  });
});

describe("generateBrandAvatarPathToken", () => {
  it("returns a non-empty string", () => {
    const token = generateBrandAvatarPathToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("returns unique values across calls (defeats stale image cache)", () => {
    const a = generateBrandAvatarPathToken();
    const b = generateBrandAvatarPathToken();
    expect(a).not.toBe(b);
  });
});

describe("brandAvatarStoragePath", () => {
  it("returns {brandId}/{token}.{ext} folder-style", () => {
    expect(brandAvatarStoragePath("abc-123", "image/jpeg", "tok1")).toBe(
      "abc-123/tok1.jpg",
    );
    expect(brandAvatarStoragePath("xyz", "image/png", "tok2")).toBe(
      "xyz/tok2.png",
    );
    expect(brandAvatarStoragePath("uuid", "image/webp", "t")).toBe("uuid/t.webp");
  });
});

describe("extractBrandAvatarStoragePath", () => {
  it("extracts the bucket-relative path from a public URL", () => {
    expect(
      extractBrandAvatarStoragePath(
        "https://example.supabase.co/storage/v1/object/public/brand_avatars/uuid/tok.jpg",
      ),
    ).toBe("uuid/tok.jpg");
  });

  it("strips query params + hash", () => {
    expect(
      extractBrandAvatarStoragePath(
        "https://example.supabase.co/storage/v1/object/public/brand_avatars/uuid/tok.jpg?v=2",
      ),
    ).toBe("uuid/tok.jpg");
  });

  it("returns null for a URL pointing at a different bucket", () => {
    expect(
      extractBrandAvatarStoragePath(
        "https://example.supabase.co/storage/v1/object/public/brand_covers/uuid/tok.jpg",
      ),
    ).toBeNull();
  });

  it("returns null for null/undefined/empty", () => {
    expect(extractBrandAvatarStoragePath(null)).toBeNull();
    expect(extractBrandAvatarStoragePath(undefined)).toBeNull();
    expect(extractBrandAvatarStoragePath("")).toBeNull();
  });
});

describe("BrandAvatarError", () => {
  it("preserves the code field", () => {
    const err = new BrandAvatarError("unsupported_type", "bad mime");
    expect(err.code).toBe("unsupported_type");
    expect(err.name).toBe("BrandAvatarError");
    expect(err.message).toBe("bad mime");
  });

  it("is an Error subclass", () => {
    const err = new BrandAvatarError("upload_failed", "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BrandAvatarError);
  });
});
