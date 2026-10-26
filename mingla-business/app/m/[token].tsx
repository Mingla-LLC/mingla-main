/**
 * /m/{token} — #4111 the signed-out guest's conversation with a brand (the link
 * in the enquiry receipt and reply emails, https://host.usemingla.com/m/{token}).
 *
 * ANON ROUTE: `/m/` is on PUBLIC_BUYER_ROUTE_PREFIXES (coldLoadAuthGates.ts), so
 * the root layout never bounces a guest to sign-in. NO useAuth here or in the
 * screen — the emailed token is the only key. The screen loads lazily (and web
 * async routes split this route), so nothing here touches the boot payload.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — GuestThreadScreen applies useSafeAreaInsets (paddingTop: insets.top + 12 on the header, insets.top + 48 on state views, insets.bottom on the composer); the Suspense fallback is a centered spinner.
import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

const GuestThreadScreen = React.lazy(
  () => import("../../src/components/brandContact/GuestThreadScreen"),
);

export default function GuestThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] ?? null : params.token ?? null;
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator color="#ff7a45" />
        </View>
      }
    >
      <GuestThreadScreen token={token} />
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
