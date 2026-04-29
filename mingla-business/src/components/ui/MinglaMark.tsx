/**
 * MinglaMark — 32×32 brand monogram.
 * Source: `Mingla_Artifacts/design-package/.../primitives.jsx:88–99`.
 *
 * Renders a rounded gradient square (135° from #fb923c to #eb7825) with a
 * white M path on top. Each instance generates a unique gradient id via
 * React 19 `useId()` so SVG `<defs>` ids never collide when multiple marks
 * render on the same screen.
 */

import React, { useId } from "react";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";

export interface MinglaMarkProps {
  size?: number;
  /** Stroke colour for the M path. Default `#fff`. */
  color?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const MinglaMark: React.FC<MinglaMarkProps> = ({
  size = 28,
  color = "#fff",
  testID,
  style,
}) => {
  const gradientId = `minglaMark-${useId()}`;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      testID={testID}
      style={style}
    >
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#fb923c" />
          <Stop offset="1" stopColor="#eb7825" />
        </LinearGradient>
      </Defs>
      <Rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <Path
        d="M7 23 V10 L12 17 L16 11 L20 17 L25 10 V23"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
};

export default MinglaMark;
