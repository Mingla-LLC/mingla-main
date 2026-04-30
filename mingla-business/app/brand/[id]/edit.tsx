/**
 * /brand/[id]/edit — founder-facing brand edit form (J-A8).
 *
 * Reads the dynamic `id` segment, resolves the brand from `useBrandList()`,
 * and renders BrandEditView. When `id` doesn't match any brand in the list,
 * BrandEditView's not-found state takes over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * DO NOT add normalization logic; the find() handles all ID shapes
 * (stub `lm`, user-created `b_<ts36>`, future UUIDs).
 *
 * Host-bg cascade per Cycle 2 invariant I-12.
 * Routes outside (tabs)/ do not inherit canvas.discover from the tabs
 * layout — each non-tab route MUST set it on the host View.
 * Established after D-IMPL-A7-6 regression on /brand/[id]/.
 *
 * Per spec §3.3.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandEditView } from "../../../src/components/brand/BrandEditView";
import { canvas } from "../../../src/constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";

export default function BrandEditRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
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

  const handleSave = (next: Brand): void => {
    // Replace the brand by id in the brand list. Mirror to currentBrand
    // when the edited brand is also the active one so the TopBar chip and
    // Home reflect the new displayName/etc. immediately.
    setBrands(brands.map((b) => (b.id === next.id ? next : b)));
    if (currentBrand !== null && currentBrand.id === next.id) {
      setCurrentBrand(next);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover,
      }}
    >
      <BrandEditView
        brand={brand}
        onCancel={handleBack}
        onSave={handleSave}
        onAfterSave={handleBack}
      />
    </View>
  );
}
