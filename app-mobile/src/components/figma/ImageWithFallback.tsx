import React, { useState } from 'react'
import { Text, View, Image, ImageSourcePropType, ImageStyle, StyleProp } from 'react-native';

// Simple error placeholder - no SVG with path elements
const ERROR_PLACEHOLDER_SIZE = 88;

interface ImageWithFallbackProps {
  source?: ImageSourcePropType;
  src?: string;
  style?: StyleProp<ImageStyle>;
  alt?: string;
  onError?: () => void;
  /**
   * Issue #1636 — one recoverable retry before giving up on the image.
   *
   * When the primary `source`/`src` fails to load and `fallbackUri` is set,
   * this renders `fallbackUri` instead of dropping straight to the broken-image
   * placeholder, and `onError` is NOT fired (nothing has actually failed from
   * the caller's point of view yet).
   *
   * Its reason for existing: Likes now requests the 384px `_thumb.jpg` sibling
   * of each place photo, and thumb coverage is ~40 000 of 88 367 active places.
   * For an uncovered place the thumb 404s, and this retries the full-size
   * original rather than showing a broken image. Omit it and this component
   * behaves exactly as it always has.
   */
  fallbackUri?: string;
  [key: string]: any;
}

export function ImageWithFallback(props: ImageWithFallbackProps) {
  const [didError, setDidError] = useState(false)
  const [usedFallback, setUsedFallback] = useState(false)

  const { source, src, style, alt, fallbackUri, ...rest } = props
  const primarySource = source ?? (src ? { uri: src } : undefined);

  // The fallback is only meaningful while it points somewhere the primary
  // source does not already point.
  const primaryUri =
    primarySource && typeof primarySource === 'object' && !Array.isArray(primarySource)
      ? (primarySource as { uri?: string }).uri
      : undefined;
  const canRetryWithFallback =
    typeof fallbackUri === 'string' && fallbackUri.length > 0 && fallbackUri !== primaryUri;

  const handleError = () => {
    if (canRetryWithFallback && !usedFallback) {
      // Recoverable: swap to the original and let <Image> try once more.
      setUsedFallback(true)
      return
    }
    setDidError(true)
    if (props.onError) {
      props.onError()
    }
  }

  const resolvedSource =
    usedFallback && canRetryWithFallback ? { uri: fallbackUri } : primarySource;

  return didError || !resolvedSource ? (
    <View
      style={[style, { width: ERROR_PLACEHOLDER_SIZE, height: ERROR_PLACEHOLDER_SIZE, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' }]}
      accessibilityLabel={alt ?? 'Image unavailable'}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 24, color: '#666' }}>📷</Text>
      </View>
    </View>
  ) : (
    <Image source={resolvedSource} style={style} accessibilityLabel={alt} onError={handleError} {...rest} />
  )
}
