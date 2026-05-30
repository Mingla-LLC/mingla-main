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
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandPricingDefaultsView } from "../../../src/components/brand/BrandPricingDefaultsView";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { Icon } from "../../../src/components/ui/Icon";

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
        backgroundColor: canvas.profile,
      }}
    >
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.backBtn}
        >
          <Icon name="chevL" size={22} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pricing</Text>
      </View>
      {typeof idParam === "string" && idParam.length > 0 ? (
        <BrandPricingDefaultsView brandId={idParam} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
});
