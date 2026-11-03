/**
 * /marketing/ads/create — the Host ad builder — #4238: the screen lives in src/screens/hostAds/HostAdCreateScreen.tsx and loads
 * with the one Host Ads chunk (HostAdScreens), never in the boot payload.
 */
import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { accent, canvas } from "../../../../src/constants/designSystem";

const HostAdCreateScreen = React.lazy(async () => ({
  default: (await import("../../../../src/screens/hostAds/HostAdScreens")).HostAdCreateScreen,
}));

export default function HostAdCreateRoute(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator color={accent.warm} />
        </View>
      }
    >
      <HostAdCreateScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: canvas.discover,
  },
});
