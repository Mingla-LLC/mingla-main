/**
 * /brand/[id]/payments — payments dashboard (J-A11 §5.3.7).
 *
 * Reads the dynamic `id` segment, resolves the brand from useBrandList(),
 * and renders BrandPaymentsView. When `id` doesn't match any brand, the
 * view's not-found state takes over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11. DO NOT add
 * normalization logic; the find() handles all ID shapes.
 *
 * Host-bg cascade per Cycle 2 invariant I-12 (canvas.discover required
 * on every non-tab route).
 *
 * Per spec §3.3.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandPaymentsView } from "../../../../src/components/brand/BrandPaymentsView";
import { canvas } from "../../../../src/constants/designSystem";
import { useBrandList } from "../../../../src/store/currentBrandStore";

export default function BrandPaymentsRoute(): React.ReactElement {
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
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleOpenOnboard = (): void => {
    if (brand === null) return;
    router.push(`/brand/${brand.id}/payments/onboard` as never);
  };

  const handleOpenReports = (): void => {
    if (brand === null) return;
    router.push(`/brand/${brand.id}/payments/reports` as never);
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12
      }}
    >
      <BrandPaymentsView
        brand={brand}
        onBack={handleBack}
        onOpenOnboard={handleOpenOnboard}
        onOpenReports={handleOpenReports}
      />
    </View>
  );
}
