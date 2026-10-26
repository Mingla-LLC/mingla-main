import React, { Suspense } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../../src/components/ui/Icon";
import {
  canvas,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useBrand } from "../../../src/hooks/useBrands";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";

const LazyReferralHome = React.lazy(async () => {
  const mod =
    await import("../../../src/components/referrals/ReferralHomeView");
  return { default: mod.ReferralHomeView };
});

export default function ReferralsRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { rank } = useCurrentBrandRole(brandId ?? null);
  const { data: brand } = useBrand(brandId ?? null);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/account" as never)
          }
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Icon name="chevL" size={22} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.title}>Referrals</Text>
      </View>
      {brandId ? (
        <Suspense fallback={null}>
          <LazyReferralHome
            brandId={brandId}
            rank={rank}
            currency={brand?.pricingCurrency ?? brand?.defaultCurrency ?? "USD"}
          />
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
    gap: spacing.sm,
    padding: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
});
