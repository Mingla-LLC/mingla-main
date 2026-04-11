import React from "react";
import Svg, { Path } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";

interface BrandIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export const AppleLogo: React.FC<BrandIconProps> = ({ size = 24, color = "#000", style }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
    <Path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C3.79 16.17 4.36 9.02 8.7 8.76c1.25.07 2.12.72 2.86.76.99-.2 1.94-.77 3-.66 1.27.14 2.24.67 2.86 1.67-2.51 1.57-1.9 4.94.37 5.88-.47 1.27-.99 2.53-1.74 3.87ZM12.03 8.7C11.88 6.5 13.69 4.68 15.72 4.5c.3 2.55-2.31 4.45-3.69 4.2Z" />
  </Svg>
);
