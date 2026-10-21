import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

const TicketLinkLanding = React.lazy(
  () => import("../../src/components/ticketLinks/TicketLinkLanding"),
);

export default function TicketLinkRoute(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator color="#ff7a45" />
        </View>
      }
    >
      <TicketLinkLanding />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0c0e12",
  },
});
