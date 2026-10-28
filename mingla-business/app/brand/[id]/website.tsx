// orch-strict-grep-allow safearea-on-fullscreen-routes — WebsiteApp (loaded lazily) renders SafeScreen; the brief loading state has no content to inset
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { accent, canvas } from "../../../src/constants/designSystem";

/*
 * #2829 W9r — the Website section. Every Website address renders the ONE
 * Website app (overview here; sections, editors and the full-screen preview
 * under website/[...path]), loaded lazily so none of it reaches the boot
 * payload, and shared by both route files as one lazy chunk.
 */
const LazyWebsiteApp = React.lazy(() => import("../../../src/components/sites/website/WebsiteApp"));

export default function BrandWebsiteRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string | string[]; studioResult?: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const studioResult = Array.isArray(params.studioResult) ? params.studioResult[0] : params.studioResult;
  return (
    <React.Suspense fallback={<View style={styles.loading}><ActivityIndicator color={accent.warm} accessibilityLabel="Loading your website" /></View>}>
      <LazyWebsiteApp brandId={typeof brandId === "string" ? brandId : ""} segments={[]} search={{ studioResult }} />
    </React.Suspense>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: canvas.discover },
});
