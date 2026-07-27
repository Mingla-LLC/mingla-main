// #1180 tester render-proof — headless stub for expo-blur's BlurView.
// The real BlurView is a native module (no headless backend); GlassChrome only
// needs it to render children, so a plain View is a faithful headless stand-in.
import React from "react";
import { View } from "react-native";

export const BlurView: React.FC<React.PropsWithChildren<Record<string, unknown>>> = ({
  children,
  ...rest
}) => <View {...rest}>{children}</View>;

export default { BlurView };
