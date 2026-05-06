/**
 * /brand/[id]/payments — payments dashboard (J-A11 + B2 issue #47).
 *
 * UUID brands: live payouts, refunds, Stripe balances, disconnect Stripe.
 * Stub ids: in-memory brand fixtures only.
 */

import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandPaymentsView } from "../../../../src/components/brand/BrandPaymentsView";
import { ConfirmDialog } from "../../../../src/components/ui/ConfirmDialog";
import { canvas } from "../../../../src/constants/designSystem";
import { useAuth } from "../../../../src/context/AuthContext";
import { brandKeys } from "../../../../src/hooks/useBrands";
import {
  brandPaymentKeys,
  useBrandPayoutsQuery,
  useBrandRefundsQuery,
  useBrandStripeBalancesQuery,
} from "../../../../src/hooks/useBrandPayments";
import { getBrand } from "../../../../src/services/brandsService";
import { supabase } from "../../../../src/services/supabase";
import { useBrandList } from "../../../../src/store/currentBrandStore";
import { useCurrentBrandStore } from "../../../../src/store/currentBrandStore";
import { BRAND_ID_UUID_RE } from "../../../../src/utils/stripeConnectStatus";

export default function BrandPaymentsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);

  const baseBrand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const live = baseBrand !== null && BRAND_ID_UUID_RE.test(baseBrand.id);
  const defaultCc = baseBrand?.defaultCurrency ?? "GBP";

  const payoutsQ = useBrandPayoutsQuery(baseBrand?.id ?? null, live);
  const balancesQ = useBrandStripeBalancesQuery(baseBrand?.id ?? null, live);
  const refundsQ = useBrandRefundsQuery(baseBrand?.id ?? null, defaultCc, live);

  const mergedBrand = useMemo(() => {
    if (baseBrand === null) return null;
    const cc =
      balancesQ.isSuccess && balancesQ.data !== undefined
        ? balancesQ.data.currency
        : defaultCc;

    const payouts =
      live && payoutsQ.isSuccess && payoutsQ.data !== undefined
        ? payoutsQ.data
        : (baseBrand.payouts ?? []);

    const refunds =
      live && refundsQ.isSuccess && refundsQ.data !== undefined
        ? refundsQ.data
        : (baseBrand.refunds ?? []);

    let availableMajor = baseBrand.availableBalanceGbp ?? 0;
    let pendingMajor = baseBrand.pendingBalanceGbp ?? 0;
    if (live && balancesQ.isSuccess && balancesQ.data !== undefined) {
      availableMajor = balancesQ.data.availableMinor / 100;
      pendingMajor = balancesQ.data.pendingMinor / 100;
    }

    const lastPayoutAt =
      payouts.length > 0 ? payouts[0]?.arrivedAt : baseBrand.lastPayoutAt;

    return {
      ...baseBrand,
      defaultCurrency: cc,
      payouts,
      refunds,
      availableBalanceGbp: availableMajor,
      pendingBalanceGbp: pendingMajor,
      lastPayoutAt,
    };
  }, [
    baseBrand,
    live,
    defaultCc,
    payoutsQ.isSuccess,
    payoutsQ.data,
    balancesQ.isSuccess,
    balancesQ.data,
    refundsQ.isSuccess,
    refundsQ.data,
  ]);

  const [confirmDetach, setConfirmDetach] = useState(false);

  const detachMutation = useMutation({
    mutationFn: async (brandId: string) => {
      const { error } = await supabase.functions.invoke("brand-stripe-detach", {
        body: { brandId },
      });
      if (error !== null) throw new Error(error.message);
    },
    onError: (e) => {
      if (__DEV__) console.error("[BrandPaymentsRoute] detach:", e);
    },
    onSuccess: async (_data, brandId) => {
      if (user?.id !== undefined) {
        await queryClient.invalidateQueries({ queryKey: brandKeys.list(user.id) });
        await queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
      }
      await queryClient.invalidateQueries({ queryKey: brandPaymentKeys.all });
      const fresh = await getBrand(brandId);
      if (
        fresh !== null &&
        currentBrand !== null &&
        currentBrand.id === fresh.id
      ) {
        setCurrentBrand({ ...fresh, role: currentBrand.role });
      }
      setConfirmDetach(false);
    },
  });

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleOpenOnboard = (): void => {
    if (baseBrand === null) return;
    router.push(`/brand/${baseBrand.id}/payments/onboard` as never);
  };

  const handleOpenReports = (): void => {
    if (baseBrand === null) return;
    router.push(`/brand/${baseBrand.id}/payments/reports` as never);
  };

  const onDisconnectStripe = useCallback((): void => {
    setConfirmDetach(true);
  }, []);

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover,
      }}
    >
      <BrandPaymentsView
        brand={mergedBrand}
        onBack={handleBack}
        onOpenOnboard={handleOpenOnboard}
        onOpenReports={handleOpenReports}
        onDisconnectStripe={live ? onDisconnectStripe : undefined}
        disconnectBusy={detachMutation.isPending}
      />

      <ConfirmDialog
        visible={confirmDetach}
        onClose={() => setConfirmDetach(false)}
        title="Disconnect Stripe?"
        description="You will need to connect again before selling paid tickets. Local payout history may not match Stripe until you reconnect."
        confirmLabel={detachMutation.isPending ? "Disconnecting…" : "Disconnect"}
        cancelLabel="Cancel"
        variant="simple"
        destructive
        onConfirm={async () => {
          if (baseBrand === null) return;
          await detachMutation.mutateAsync(baseBrand.id);
        }}
      />
    </View>
  );
}
