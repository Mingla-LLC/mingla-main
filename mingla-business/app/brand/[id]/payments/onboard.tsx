/**
 * /brand/[id]/payments/onboard — Stripe Connect onboarding shell (J-A10 §5.3.8).
 *
 * Resolves the brand from the dynamic `id` segment and renders the
 * BrandOnboardView state machine. On Done, mutates `brand.stripeStatus`
 * to "onboarding" (the stub flow cannot reach "active" — only B2 webhooks
 * advance to active when real Stripe completes verification).
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * Host-bg cascade per Cycle 2 invariant I-12.
 *
 * Per spec §3.4.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandOnboardView } from "../../../../src/components/brand/BrandOnboardView";
import { canvas } from "../../../../src/constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../../../src/store/currentBrandStore";

export default function BrandOnboardRoute(): React.ReactElement {
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
    } else if (brand !== null) {
      router.replace(`/brand/${brand.id}/payments` as never);
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleAfterDone = (): void => {
    if (brand === null) {
      handleBack();
      return;
    }
    // Stub flow: any onboarding completion advances stripeStatus to
    // "onboarding". Cycle 2 cannot reach "active" — only B2 webhooks
    // advance via real Stripe verification. Smoke uses pre-seeded
    // "active" brand (Sunday Languor) to exercise that state.
    const next: Brand = { ...brand, stripeStatus: "onboarding" };
    setBrands(brands.map((b) => (b.id === next.id ? next : b)));
    if (currentBrand !== null && currentBrand.id === next.id) {
      setCurrentBrand(next);
    }
    handleBack();
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12
      }}
    >
      <BrandOnboardView
        brand={brand}
        onCancel={handleBack}
        onAfterDone={handleAfterDone}
      />
    </View>
  );
}
