import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { Button } from "../../../src/components/ui/Button";

export default function VenueReservationCancelledRoute(): React.ReactElement {
  const router = useRouter();
  return (
    <SafeAreaView
      style={styles.host}
      edges={["top", "bottom", "left", "right"]}
    >
      <Text style={styles.title}>Payment cancelled</Text>
      <Text style={styles.body}>
        You haven’t been charged. Return to the venue when you’re ready to pick
        another time.
      </Text>
      <Button
        label="Go back"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/" as never);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: "#0c0e12",
  },
  title: { ...typography.h2, color: textTokens.primary, textAlign: "center" },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
