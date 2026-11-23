/**
 * #4490 spec 08 O3 part B — on a native tablet every Host screen except the
 * floor screens (Till, kitchen and bar) keeps the phone layout in a centred
 * column `suiteFormMaxWidth` wide, so nothing stretches or clips at 768×1024
 * or 1024×768. Floor screens get the full window and lay themselves out with
 * useFloorLayout.
 *
 * Web is a pure passthrough (Platform.OS never changes at runtime, so the tree
 * is stable). On native the Stack always sits in the same View; only its width
 * changes, so rotating never remounts navigation.
 */
import React from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { usePathname } from "expo-router";

import { nativeTabletColumnWidth } from "../../utils/deviceOrientation";

const NativeColumn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { width, height } = useWindowDimensions();
  const pathname = usePathname();
  const maxWidth = nativeTabletColumnWidth({ platform: Platform.OS, window: { width, height }, pathname });
  return (
    <View style={[styles.slot, maxWidth !== null ? { maxWidth, width: "100%", alignSelf: "center" } : null]}
      testID="native-tablet-column">
      {children}
    </View>
  );
};

export const NativeTabletColumn: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  Platform.OS === "web" ? <>{children}</> : <NativeColumn>{children}</NativeColumn>;

const styles = StyleSheet.create({
  slot: { flex: 1 },
});
