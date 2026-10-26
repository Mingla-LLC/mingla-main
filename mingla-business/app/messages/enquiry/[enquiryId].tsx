// orch-strict-grep-allow safearea-on-fullscreen-routes — BrandEnquiryThreadScreen (loaded lazily) renders SafeScreen; the brief loading state has no content to inset
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { accent } from "../../../src/constants/designSystem";

// #4111 — the thread loads with this route, never in the boot chunk. Same
// module as the Messages list section, so the two share one lazy chunk.
const LazyBrandEnquiryThreadScreen = React.lazy(async () => ({
  default: (await import("../../../src/components/messages/BrandEnquiryScreens")).BrandEnquiryThreadScreen,
}));

/** #4111 — a customer enquiry thread (Messages list, Brand-group card, To-do, push). */
export default function BrandEnquiryThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ enquiryId?: string | string[] }>();
  const raw = Array.isArray(params.enquiryId) ? params.enquiryId[0] : params.enquiryId;
  return (
    <React.Suspense
      fallback={(
        <View style={styles.loading}>
          <ActivityIndicator color={accent.warm} />
        </View>
      )}
    >
      <LazyBrandEnquiryThreadScreen enquiryId={typeof raw === "string" ? raw : ""} />
    </React.Suspense>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
