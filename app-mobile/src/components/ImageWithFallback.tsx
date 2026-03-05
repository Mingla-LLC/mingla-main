import React, { useState } from 'react'
import { Text, View, Image, ImageSourcePropType, ImageStyle, StyleProp } from 'react-native';

// Simple error placeholder - no SVG with path elements
const ERROR_PLACEHOLDER_SIZE = 88;

interface ImageWithFallbackProps {
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  className?: string;
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

  const { source, style, className, alt, ...rest } = props

  return didError ? (
    <View
      className={`inline-block bg-gray-100 text-center align-middle ${className ?? ''}`}
      style={[style, { width: ERROR_PLACEHOLDER_SIZE, height: ERROR_PLACEHOLDER_SIZE }]}
    >
      <View className="flex items-center justify-center w-full h-full">
        <Text style={{ fontSize: 24, color: '#666' }}>📷</Text>
      </View>
    </View>
  ) : (
    <Image source={source} style={style} onError={handleError} {...rest} />
  )
}
