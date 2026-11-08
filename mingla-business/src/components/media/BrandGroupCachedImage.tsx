/**
 * #4304 — media speed (C), web. The browser keeps drawing Brand-group media
 * through React Native's Image: web sources are short-lived object URLs owned
 * by MediaThumb / the viewer, and full files stay uncached on purpose.
 * The native file renders through expo-image with a disk cache.
 */
import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

import type { BrandGroupMediaVariant } from "./brandGroupMediaCache";

export interface BrandGroupCachedImageProps {
  /** Server media: the file id and which variant, for the cache key. */
  fileId?: string | null;
  variant?: BrandGroupMediaVariant;
  /** An authorized request, a local file uri, or (native only) a decoded poster. */
  source: { uri: string; headers?: Record<string, string> } | object;
  fit: "cover" | "contain";
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  onError?: () => void;
  testID?: string;
}

function isUriSource(source: BrandGroupCachedImageProps["source"]): source is { uri: string; headers?: Record<string, string> } {
  return typeof (source as { uri?: unknown }).uri === "string";
}

export function BrandGroupCachedImage({ source, fit, style, accessibilityLabel, onError, testID }: BrandGroupCachedImageProps): React.ReactElement | null {
  if (!isUriSource(source)) return null;
  return <Image source={source} resizeMode={fit} accessibilityLabel={accessibilityLabel} onError={onError} style={style} testID={testID} />;
}
