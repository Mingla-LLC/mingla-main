import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { SafeScreen } from "../../src/components/ui/SafeScreen";

const TicketLinkLanding = React.lazy(
  () => import("../../src/components/ticketLinks/TicketLinkLanding"),
);

export default function TicketLinkRoute(): React.ReactElement {
  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      <Suspense
        fallback={
          <View style={styles.loading}>
            <ActivityIndicator color="#ff7a45" />
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
    backgroundColor: "#0c0e12",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0c0e12",
  },
});
