// #1180 tester render-proof — headless stub for expo-linear-gradient (native
// gradient has no headless backend; a plain View preserves the tree shape).
import React from "react";
import { View } from "react-native";

export const LinearGradient: React.FC<React.PropsWithChildren<Record<string, unknown>>> = ({
  children,
  ...rest
}) => <View {...rest}>{children}</View>;

export default { LinearGradient };
