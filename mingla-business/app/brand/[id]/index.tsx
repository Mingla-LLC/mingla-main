/**
 * /brand/[id]/ — founder view of a brand profile (J-A7).
 *
 * Reads the dynamic `id` segment, resolves the brand from `useBrandList()`,
 * and renders BrandProfileView. When `id` doesn't match any brand in the
 * list, BrandProfileView's not-found state takes over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * DO NOT add normalization logic; the find() handles all ID shapes
 * (stub `lm`, user-created `b_<ts36>`, future UUIDs).
 *
 * Per spec §3.3.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandProfileView } from "../../../src/components/brand/BrandProfileView";
import { canvas } from "../../../src/constants/designSystem";
import { useBrandList } from "../../../src/store/currentBrandStore";

export default function BrandProfileRoute(): React.ReactElement {
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

  const handleOpenEdit = (brandId: string): void => {
    router.push(`/brand/${brandId}/edit` as never);
  };

  const handleOpenTeam = (brandId: string): void => {
    router.push(`/brand/${brandId}/team` as never);
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
      <BrandProfileView
        brand={brand}
        onBack={handleBack}
        onEdit={handleOpenEdit}
        onTeam={handleOpenTeam}
      />
    </View>
  );
}
