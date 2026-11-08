/**
 * #4304 media speed (C) — on a phone, Brand-group photos render through
 * expo-image with a stable cache key per file id (thumb and full apart) and
 * memory-disk caching; sign-out clears expo-image's memory and disk caches.
 *
 * fails-on-revert (true line deletion): delete the `cacheKey` spread or the
 * cachePolicy in BrandGroupCachedImage.native → the cache case fails; delete
 * the clearBrandGroupImageCaches() call in clearAllStores → the sign-out
 * wiring case fails; delete clearDiskCache from brandGroupImageCache.native →
 * the clear case fails.
 */
import React from "react";

const mockClearMemory = jest.fn(async () => true);
const mockClearDisk = jest.fn(async () => true);
const MockExpoImage = Object.assign(() => null, { clearMemoryCache: mockClearMemory, clearDiskCache: mockClearDisk });
jest.mock("expo-image", () => ({ Image: MockExpoImage }));

const mockClearBrandGroupImageCaches = jest.fn(async () => undefined);
jest.mock("../brandGroupImageCache", () => ({
  clearBrandGroupImageCaches: () => mockClearBrandGroupImageCaches(),
}));

import { brandGroupMediaCacheKey } from "../../components/media/brandGroupMediaCache";
import { BrandGroupCachedImage } from "../../components/media/BrandGroupCachedImage.native";
import { clearAllStores } from "../clearAllStores";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { clearBrandGroupImageCaches: clearNative } = require("../brandGroupImageCache.native") as typeof import("../brandGroupImageCache.native");

const request = { uri: "https://edge.example/functions/v1/brand-group-files?file_id=f-1", headers: { Authorization: "Bearer token-a" } };

function propsOf(element: React.ReactElement | null): Record<string, unknown> {
  expect(element).not.toBeNull();
  return (element as React.ReactElement<Record<string, unknown>>).props;
}

describe("#4304 media speed — native media cache", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keys the cache by file id, with thumb and full kept apart", () => {
    expect(brandGroupMediaCacheKey("f-1", "thumb")).toBe("brand-group-file:f-1:thumb");
    expect(brandGroupMediaCacheKey("f-1", "full")).toBe("brand-group-file:f-1:full");
    expect(brandGroupMediaCacheKey("f-1", "thumb")).not.toBe(brandGroupMediaCacheKey("f-1", "full"));
    expect(brandGroupMediaCacheKey("f-1", "thumb")).not.toBe(brandGroupMediaCacheKey("f-2", "thumb"));
  });

  it("renders server photos through expo-image with the per-file cacheKey and memory-disk policy", () => {
    const thumb = propsOf(BrandGroupCachedImage({ fileId: "f-1", variant: "thumb", source: request, fit: "cover" }));
    expect(thumb.source).toEqual({ ...request, cacheKey: "brand-group-file:f-1:thumb" });
    expect(thumb.cachePolicy).toBe("memory-disk");
    expect(thumb.contentFit).toBe("cover");

    const full = propsOf(BrandGroupCachedImage({ fileId: "f-1", variant: "full", source: { ...request, headers: { Authorization: "Bearer token-b" } }, fit: "contain" }));
    expect(full.source).toMatchObject({ cacheKey: "brand-group-file:f-1:full" });
    expect(full.cachePolicy).toBe("memory-disk");
    // The key never carries the signed request, so a new token still hits the cache.
    expect(String((full.source as { cacheKey: string }).cacheKey)).not.toContain("Bearer");
  });

  it("does not disk-cache a local file or a decoded poster", () => {
    const local = propsOf(BrandGroupCachedImage({ source: { uri: "file:///cache/shrunk.jpg" }, fit: "cover" }));
    expect(local.source).toEqual({ uri: "file:///cache/shrunk.jpg" });
    expect(local.cachePolicy).not.toBe("memory-disk");
    const poster = {};
    const fromPoster = propsOf(BrandGroupCachedImage({ source: poster, fit: "cover" }));
    expect(fromPoster.source).toBe(poster);
    expect(fromPoster.cachePolicy).toBe("none");
  });

  it("sign-out (clearAllStores) clears the Brand-group image caches", () => {
    clearAllStores();
    expect(mockClearBrandGroupImageCaches).toHaveBeenCalledTimes(1);
  });

  it("the native clear empties expo-image's memory and disk caches", async () => {
    await clearNative();
    expect(mockClearMemory).toHaveBeenCalledTimes(1);
    expect(mockClearDisk).toHaveBeenCalledTimes(1);
  });
});
