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
  [key: string]: any;
}

export function ImageWithFallback(props: ImageWithFallbackProps) {
  const [didError, setDidError] = useState(false)

  const handleError = () => {
    setDidError(true)
    if (props.onError) {
      props.onError()
    }
  }

  const { source, src, style, alt, ...rest } = props
  const resolvedSource = source ?? (src ? { uri: src } : undefined);

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
