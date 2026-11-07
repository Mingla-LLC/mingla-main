/**
 * #4271 — the Tap to Pay mark. iPhone: Apple's SF Symbol only, loaded lazily, and
 * nothing at all if it can't load (Apple allows no home-made art for the feature).
 * Android: the app's own glyph.
 */
import React from "react";
import { Platform } from "react-native";

import { text as textTokens } from "../../../constants/designSystem";
import { Icon } from "../../ui/Icon";

interface SymbolViewProps {
  name: string;
  size: number;
  tintColor: string;
  testID?: string;
}

const loadSymbolView = (): React.ComponentType<SymbolViewProps> | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const symbols = require("expo-symbols") as { SymbolView?: React.ComponentType<SymbolViewProps> };
    return symbols.SymbolView ?? null;
  } catch {
    return null;
  }
};

export const TAP_TO_PAY_SF_SYMBOL = "wave.3.right.circle.fill";

export const TapToPayIcon = ({ size = 20 }: { size?: number }): React.ReactElement | null => {
  if (Platform.OS === "android") return <Icon name="tap" size={size} color={textTokens.primary} />;
  if (Platform.OS !== "ios") return null;
  const SymbolView = loadSymbolView();
  if (SymbolView === null) return null;
  return (
    <SymbolView
      name={TAP_TO_PAY_SF_SYMBOL}
      size={size}
      tintColor={textTokens.primary}
      testID="tap-to-pay-symbol"
    />
  );
};
