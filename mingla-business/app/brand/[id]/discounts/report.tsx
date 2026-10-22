import React, { Suspense } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../../../src/components/ui/Icon";
import {
  canvas,
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";

const LazyReport = React.lazy(async () => {
  const mod =
    await import("../../../../src/components/discounts/DiscountReportView");
  return { default: mod.DiscountReportView };
});

export default function DiscountReportRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { rank } = useCurrentBrandRole(brandId ?? null);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Icon name="chevL" size={22} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.title}>Discount results</Text>
      </View>
      {brandId ? (
        <Suspense fallback={null}>
          <LazyReport brandId={brandId} rank={rank} />
        </Suspense>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: canvas.profile },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.sm,
    gap: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
});
