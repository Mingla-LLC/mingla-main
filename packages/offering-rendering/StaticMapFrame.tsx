/**
 * #4334 F-1 — the ONE renderer of a static map image.
 *
 * Google's Static Maps image carries Google's logo in its bottom-left corner
 * and "Map data ©Google" in its bottom-right. Google's terms require both to
 * stay visible and unobscured. Every caller used to request a 600-wide image
 * and show it `resizeMode="cover"` in a narrower full-width box, so a phone
 * cropped both corners off.
 *
 * This component measures its box (onLayout) and only then requests the image
 * at the box's own width × height (the proxy asks Google for scale=2). The
 * image and the box therefore have the same aspect ratio and `cover` crops
 * nothing: both corners survive at every width. Until the box is measured it
 * draws only the box (no request, no wrong-aspect image), so a map is fetched
 * once, at the right size.
 *
 * Overlays (pills, badges, pins) are passed as children and drawn above the
 * image; keep them out of the bottom corners.
 */
import React, { useCallback, useState } from "react";
import {
  Image,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import {
  coverCropFraction,
  STATIC_MAP_PROXY_MAX_SIDE,
  staticMapUriForBox,
} from "./staticMapBox";

export { coverCropFraction, STATIC_MAP_PROXY_MAX_SIDE, staticMapUriForBox };

export interface StaticMapImageProps {
  /** The proxy URL from buildStaticMapUrl (its w/h are replaced by the box's). */
  uri: string;
  /** The box: size, border, radius, background. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  onError?: () => void;
  /** Overlays drawn above the map (keep them off the bottom corners). */
  children?: React.ReactNode;
}

export function StaticMapImage({
  uri,
  style,
  accessibilityLabel,
  testID,
  onError,
  children,
}: StaticMapImageProps): React.ReactElement {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.round(width);
    const h = Math.round(height);
    setBox((prev) => (prev !== null && prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);
  const sized = box !== null ? staticMapUriForBox(uri, box.w, box.h) : null;
  return (
    <View style={[style, styles.clip]} onLayout={onLayout} testID={testID}>
      {sized !== null ? (
        <Image
          source={{ uri: sized }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel={accessibilityLabel}
          onError={onError}
          testID={testID !== undefined ? `${testID}-image` : "static-map-image"}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
});

export default StaticMapImage;
