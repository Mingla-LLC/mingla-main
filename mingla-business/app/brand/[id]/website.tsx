// orch-strict-grep-allow safearea-on-fullscreen-routes — WebsiteApp (loaded lazily) renders SafeScreen; the brief loading state has no content to inset
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";



import { color } from "../../../src/constants/designSystem";
/*
 * #2829 W9r — the Website section. Every Website address renders the ONE
 * Website app (overview here; sections, editors and the full-screen preview
 * under website/[...path]), loaded lazily so none of it reaches the boot
 * payload, and shared by both route files as one lazy chunk.
 */
const LazyWebsiteApp = React.lazy(() => import("../../../src/components/sites/website/WebsiteApp"));

export default function BrandWebsiteRoute(): React.ReactElement {
  // #4453 — mode, panel and request say where in the workspace to land
  // (Ari / Edit / Design, a "more" screen, a team request from a notification).
  const params = useLocalSearchParams<{
    id: string | string[];
    studioResult?: string | string[];
    mode?: string | string[];
    panel?: string | string[];
    request?: string | string[];
  }>();
  const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const brandId = first(params.id);
  const studioResult = first(params.studioResult);
  return (
    <React.Suspense fallback={<View style={styles.loading}><ActivityIndicator color={color.text1} accessibilityLabel="Loading your website" /></View>}>
      <LazyWebsiteApp brandId={typeof brandId === "string" ? brandId : ""} segments={[]} search={{ studioResult, mode: first(params.mode), panel: first(params.panel), request: first(params.request) }} />
    </React.Suspense>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.canvas },
});
