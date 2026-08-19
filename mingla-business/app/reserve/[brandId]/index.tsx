import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
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
      {/*
        #2211 — this region SCROLLS. `host` was `flex: 1` +
        `justifyContent: "center"` with no scroll container around an h2, two
        sentences of body copy and the sole "Go back" Button.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // #2211 — `host` keeps only the frame; centring moved to `scrollContent`.
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1, overflow: "hidden" },
  scrollContent: {
    // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  title: { ...typography.h2, color: textTokens.primary, textAlign: "center" },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
