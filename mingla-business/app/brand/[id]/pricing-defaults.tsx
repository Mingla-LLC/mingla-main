/**
 * /brand/[id]/pricing-defaults — ORCH-1006 Surface 2.
 *
 * Brand-level all-in pricing defaults (who covers VAT / Mingla fee / service
 * fee by default). Sibling to the brand edit + payments settings screens.
 * Resolves the dynamic `id` segment and renders BrandPricingDefaultsView.
 *
 * Host-bg cascade per Cycle 2 invariant I-12 (non-tab routes set canvas).
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandPricingDefaultsView } from "../../../src/components/brand/BrandPricingDefaultsView";
import { color, space, type } from "../../../src/constants/designSystem";
import { TopBar } from "../../../src/components/ui/TopBar";

export default function BrandPricingDefaultsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;

  const handleBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as never);
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: color.canvas,
      }}
    >
      {/* #4420 — the shared pushed-screen bar carries the one title. */}
      <View style={styles.header}>
        <TopBar
          leftKind="back"
          title="Pricing defaults"
          onBack={handleBack}
          rightSlot={<View />}
        />
      </View>
      {typeof idParam === "string" && idParam.length > 0 ? (
        <BrandPricingDefaultsView brandId={idParam} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
});
