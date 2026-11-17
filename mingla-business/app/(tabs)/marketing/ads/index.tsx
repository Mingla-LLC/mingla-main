/**
 * /marketing/ads — the Host Ads list — #4238: the screen lives in src/screens/hostAds/HostAdListScreen.tsx and loads
 * with the one Host Ads chunk (HostAdScreens), never in the boot payload.
 */
import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { color } from "../../../../src/constants/designSystem";

const HostAdListScreen = React.lazy(async () => ({
  default: (await import("../../../../src/screens/hostAds/HostAdScreens")).HostAdListScreen,
}));

export default function MarketingAdsRoute(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator color={color.text2} />
        </View>
      }
    >
      <HostAdListScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.canvas,
  },
});
