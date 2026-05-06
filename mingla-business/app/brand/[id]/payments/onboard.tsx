/**
 * /brand/[id]/payments/onboard — Stripe Connect onboarding shell.
 *
 * B2a (post-2026-05-06): Renders BrandOnboardView with the real flow.
 * Status updates flow via webhook → DB trigger → Realtime → React Query
 * invalidate. This route's only job is to resolve the brand from the URL
 * segment and provide back-navigation handlers.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * Host-bg cascade per Cycle 2 invariant I-12.
 *
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.5.3.
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
} from "../../../../src/store/currentBrandStore";

export default function BrandOnboardRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
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

  // B2a: handleAfterDone simply navigates back. Real status updates flow
  // via webhook → DB trigger → Realtime → React Query invalidate per
  // useBrandStripeStatus hook. The previous stub mutated brand.stripeStatus
  // to "onboarding" via useUpdateBrand — that fictional state advance is
  // DELETED. Server is the source of truth.
  const handleAfterDone = (): void => {
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
