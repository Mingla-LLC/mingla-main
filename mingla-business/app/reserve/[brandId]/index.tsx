import React from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { space, type, color } from "../../../src/constants/designSystem";
import { Button } from "../../../src/components/ui/Button";
import { useSignedInHostViewer } from "../../../src/components/venue/guestViewHostSession";

// #4420 (round-3 item 18) — "Guest view · Back to Mingla Host" for a signed-in
// host (chrome only; a guest sees the page unchanged). The bar loads lazily,
// only when a host session is found.
const LazyGuestViewHostBar = React.lazy(() =>
  import("../../../src/components/venue/GuestViewHostBar").then((m) => ({
    default: m.GuestViewHostBar,
  })),
);

export default function VenueReservationCancelledRoute(): React.ReactElement {
  const router = useRouter();
  const hostViewer = useSignedInHostViewer();
  return (
    <SafeAreaView
      style={styles.host}
      edges={["top", "bottom", "left", "right"]}
    >
      {hostViewer ? (
        <View style={styles.hostBarWrap}>
          <React.Suspense fallback={null}>
            <LazyGuestViewHostBar />
          </React.Suspense>
        </View>
      ) : null}
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
          else if (Platform.OS === "web" && typeof window !== "undefined") {
            window.location.assign("https://usemingla.com");
          } else {
            void Linking.openURL("https://usemingla.com");
          }
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
  hostBarWrap: { paddingHorizontal: space[4], paddingTop: space[2] },
  scrollContent: {
    // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
    padding: space[7],
  },
  title: { ...type.h1, color: color.text1, textAlign: "center" },
  body: {
    ...type.body,
    color: color.text2,
    textAlign: "center",
  },
});
