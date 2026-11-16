import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { SafeScreen } from "../../src/components/ui/SafeScreen";

import { color } from "../../src/constants/designSystem";
const TicketLinkLanding = React.lazy(
  () => import("../../src/components/ticketLinks/TicketLinkLanding"),
);

export default function TicketLinkRoute(): React.ReactElement {
  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      <Suspense
        fallback={
          <View style={styles.loading}>
            <ActivityIndicator color={color.accentText} />
          </View>
        }
      >
        <TicketLinkLanding />
      </Suspense>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: color.canvas,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.canvas,
  },
});
