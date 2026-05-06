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
import { useAuth } from "../../../../src/context/AuthContext";
import {
  useBrandList,
  useCurrentBrandStore,
} from "../../../../src/store/currentBrandStore";
import { useUpdateBrand } from "../../../../src/hooks/useBrands";
import { joinBrandDescription } from "../../../../src/services/brandMapping";

export default function BrandOnboardRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
  const updateBrandMutation = useUpdateBrand();
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

  const handleAfterDone = async (): Promise<void> => {
    if (brand === null || user === null || user.id === undefined) {
      handleBack();
      return;
    }
    // Cycle 17e-A: useUpdateBrand mutation owns persistence + cache.
    // Stripe-status patches via UPDATE — server is source of truth.
    // Stub flow advances stripeStatus to "onboarding" until B2 webhooks
    // wire real Stripe verification (then advance to "active").
    try {
      const updated = await updateBrandMutation.mutateAsync({
        brandId: brand.id,
        patch: { stripeStatus: "onboarding" },
        existingDescription: joinBrandDescription(brand.tagline, brand.bio),
        accountId: user.id,
      });
      if (currentBrand !== null && currentBrand.id === updated.id) {
        setCurrentBrand(updated);
      }
    } catch (error) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error("[BrandOnboardRoute] update failed:", error);
      }
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
