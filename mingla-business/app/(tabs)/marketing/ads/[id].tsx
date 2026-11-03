/**
 * /marketing/ads/<id> — one Host ad — #4238: the screen lives in src/screens/hostAds/HostAdDetailScreen.tsx and loads
 * with the one Host Ads chunk (HostAdScreens), never in the boot payload.
 */
import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { accent, canvas } from "../../../../src/constants/designSystem";

const HostAdDetailScreen = React.lazy(async () => ({
  default: (await import("../../../../src/screens/hostAds/HostAdScreens")).HostAdDetailScreen,
}));

export default function HostAdDetailRoute(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator color={accent.warm} />
        </View>
      }
    >
      <HostAdDetailScreen />
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
