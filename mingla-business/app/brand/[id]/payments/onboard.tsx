/**
 * /brand/[id]/payments/onboard — Stripe Connect onboarding shell.
 *
 * B2a (post-2026-05-06): Renders BrandOnboardView with the real flow.
 * Status updates flow via webhook → DB trigger → Realtime → React Query
 * invalidate. This route resolves brand detail first so stale list cache cannot
 * keep showing old Stripe country/status after onboarding.
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
// #1863 [error-toast-covers-bank-field] — role gate at the ROUTE, above the
// view's Paystack early return, so both rails are covered by one decision.
import { BrandPaymentsPermissionGate } from "../../../../src/components/brand/BrandPaymentsPermissionGate";
import { canvas } from "../../../../src/constants/designSystem";
import { useBrand } from "../../../../src/hooks/useBrands";
import { sanitizeBankSetupReturnPath } from "../../../../src/utils/bankSetupReturn";
import { setupFlowHop } from "../../../../src/services/brandSetupService";

export default function BrandOnboardRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    from?: string | string[];
    country?: string | string[];
    resume?: string | string[];
    choose?: string | string[];
  }>();
  // #3645 — set by Payments when the host tapped "Choose a different country".
  const chooseParam = Array.isArray(params.choose)
    ? params.choose[0]
    : params.choose;
  const countryChoiceRequested = chooseParam === "country";
  // #3645 — the creator screen the host came from ("Connect bank" at Publish).
  // Validated against the closed list of creator routes; anything else is null
  // and this route behaves exactly as it did before.
  const resumePath = sanitizeBankSetupReturnPath(params.resume);
  // #3645 — payout country chosen during brand creation; the view validates it.
  const countryParam = Array.isArray(params.country)
    ? params.country[0]
    : params.country;
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandId = typeof idParam === "string" && idParam.length > 0
    ? idParam
    : null;
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;
  const isBrandCreateFunnel = params.from === "brand-create";

  const handleBack = (): void => {
    if (isBrandCreateFunnel && brandId !== null) {
      router.replace(
        // #4389 — back to setup; F4 reads the account live (refresh_status).
        setupFlowHop(`/brand/${encodeURIComponent(brandId)}/setup?step=done`) as never,
      );
    } else if (router.canGoBack()) {
      // The creator that pushed this route is still mounted underneath, on the
      // step the host left; going back is the truest "same screen".
      router.back();
    } else if (resumePath !== null) {
      // No history (a reload, or the browser came back from hosted setup onto
      // this route): reopen the creator screen itself.
      router.replace(resumePath as never);
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

  // #3208 — when setup is refused for want of a usable email, the fix is a
  // brand contact email, so land the organiser on that field via Brand Edit's
  // ORCH-1256 `?section=` deep link (validated against the closed section set).
  const handleEditContact = (): void => {
    if (brandId === null) return;
    router.push(
      `/brand/${encodeURIComponent(brandId)}/edit?section=contact` as never,
    );
  };

  // #4389 S-11 — leaving the NATIVE secure setup from brand setup: progress
  // goes to F4 (which reads the account live through refresh_status); an early
  // close returns to F3 with K1 "Only free events for now?" open.
  const handleNativeExit = (exit: "finished" | "closed-early"): void => {
    if (brandId === null) return;
    const id = encodeURIComponent(brandId);
    router.replace(
      setupFlowHop(exit === "finished"
        ? `/brand/${id}/setup?step=done`
        : `/brand/${id}/setup?step=pay&k1=1`) as never,
    );
  };

  // #4271 — Tap to Pay setup for this brand, from the "all set" states.
  const handleOpenTapToPay = (): void => {
    if (brandId === null) return;
    router.push(`/account/tap-to-pay?brandId=${encodeURIComponent(brandId)}` as never);
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12
      }}
    >
      <BrandPaymentsPermissionGate
        brandId={brandId}
        title="Set up payments"
        onBack={handleBack}
      >
        <BrandOnboardView
          brand={brand}
          onCancel={handleBack}
          onAfterDone={handleAfterDone}
          onEditContact={brandId !== null ? handleEditContact : undefined}
          initialCountry={typeof countryParam === "string" ? countryParam : null}
          returnPath={isBrandCreateFunnel ? null : resumePath}
          countryChoiceRequested={countryChoiceRequested}
          onOpenTapToPay={brandId !== null ? handleOpenTapToPay : undefined}
          onNativeExit={isBrandCreateFunnel ? handleNativeExit : undefined}
          fromSetup={isBrandCreateFunnel}
        />
      </BrandPaymentsPermissionGate>
    </View>
  );
}
