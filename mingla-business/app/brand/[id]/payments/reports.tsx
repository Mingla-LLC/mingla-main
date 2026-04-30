/**
 * /brand/[id]/payments/reports — finance reports surface (J-A12 §5.3.7-reports).
 *
 * Reads the dynamic `id` segment, resolves the brand from useBrandList(),
 * and renders BrandFinanceReportsView. When `id` doesn't match any brand,
 * the view's not-found state takes over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * Host-bg cascade per Cycle 2 invariant I-12.
 *
 * Per spec §3.5.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandFinanceReportsView } from "../../../../src/components/brand/BrandFinanceReportsView";
import { canvas } from "../../../../src/constants/designSystem";
import { useBrandList } from "../../../../src/store/currentBrandStore";

export default function BrandFinanceReportsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (brand !== null) {
      router.replace(`/brand/${brand.id}/payments` as never);
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12
      }}
    >
      <BrandFinanceReportsView brand={brand} onBack={handleBack} />
    </View>
  );
}
