/**
 * #4304 — media speed (C), native. Brand-group media through expo-image:
 * server photos carry a stable per-file `cacheKey` (thumb and full apart) and
 * `memory-disk` caching so a second view is instant; local file uris and
 * decoded video posters render as given, uncached. Sign-out clears both
 * caches (utils/brandGroupImageCache.native.ts). Videos never come through
 * here: they keep streaming with Range in the viewer.
 */
import { Image, type ImageSource } from "expo-image";
import type { SharedRefType } from "expo";
import React from "react";

import type { BrandGroupCachedImageProps } from "./BrandGroupCachedImage";
import { BRAND_GROUP_MEDIA_CACHE_POLICY, brandGroupMediaCacheKey } from "./brandGroupMediaCache";

export type { BrandGroupCachedImageProps } from "./BrandGroupCachedImage";

function isUriSource(source: BrandGroupCachedImageProps["source"]): source is { uri: string; headers?: Record<string, string> } {
  return typeof (source as { uri?: unknown }).uri === "string";
}

export function BrandGroupCachedImage({ fileId, variant = "thumb", source, fit, style, accessibilityLabel, onError, testID }: BrandGroupCachedImageProps): React.ReactElement {
  if (!isUriSource(source)) {
    return <Image source={source as SharedRefType<"image">} contentFit={fit} cachePolicy="none" accessibilityLabel={accessibilityLabel} onError={onError} style={style} testID={testID} />;
  }
  const cacheKey = fileId ? brandGroupMediaCacheKey(fileId, variant) : undefined;
  const imageSource: ImageSource = cacheKey ? { ...source, cacheKey } : source;
  return (
    <Image
      source={imageSource}
      cachePolicy={cacheKey ? BRAND_GROUP_MEDIA_CACHE_POLICY : "memory"}
      recyclingKey={cacheKey}
      contentFit={fit}
      transition={0}
      accessibilityLabel={accessibilityLabel}
      onError={onError}
      style={style}
      testID={testID}
    />
  );
}
