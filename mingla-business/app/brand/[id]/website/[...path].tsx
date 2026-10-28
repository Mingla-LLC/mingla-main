// orch-strict-grep-allow safearea-on-fullscreen-routes — WebsiteApp (loaded lazily) renders SafeScreen; the brief loading state has no content to inset
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { accent, canvas } from "../../../../src/constants/designSystem";

/*
 * #2829 W9r — /brand/<id>/website/<section>[/<entry|new>] and
 * /website/preview, plus the old addresses (look, domains, plan?part=…),
 * which the Website app redirects. Same lazy chunk as website.tsx.
 */
const LazyWebsiteApp = React.lazy(() => import("../../../../src/components/sites/website/WebsiteApp"));

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export default function BrandWebsiteSectionRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    id: string | string[];
    path?: string | string[];
    part?: string | string[];
    device?: string | string[];
    orientation?: string | string[];
    studioResult?: string | string[];
  }>();
  const brandId = first(params.id);
  const segments = Array.isArray(params.path) ? params.path : typeof params.path === "string" ? params.path.split("/") : [];
  return (
    <React.Suspense fallback={<View style={styles.loading}><ActivityIndicator color={accent.warm} accessibilityLabel="Loading your website" /></View>}>
      <LazyWebsiteApp
        brandId={typeof brandId === "string" ? brandId : ""}
        segments={segments}
        search={{ part: first(params.part), device: first(params.device), orientation: first(params.orientation), studioResult: first(params.studioResult) }}
      />
    </React.Suspense>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: canvas.discover },
});
