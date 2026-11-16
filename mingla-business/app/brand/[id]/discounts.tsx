import React, { Suspense } from "react";
import { StyleSheet, View } from "react-native";
import { showAlert } from "../../../src/components/ui/showAlert";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TopBar } from "../../../src/components/ui/TopBar";

import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useBrand } from "../../../src/hooks/useBrands";
import { useAuth } from "../../../src/context/AuthContext";
import { createDiscountBlastDraft } from "../../../src/services/discountBlastService";

import { color, space } from "../../../src/constants/designSystem";
const LazyDiscountList = React.lazy(async () => {
  const mod =
    await import("../../../src/components/discounts/DiscountListView");
  return { default: mod.DiscountListView };
});

export default function DiscountsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { rank } = useCurrentBrandRole(brandId ?? null);
  const { data: brand } = useBrand(brandId ?? null);
  const { user } = useAuth();
  const blastInFlightRef = React.useRef(false);
  const shareInBlast = React.useCallback(
    (discountId: string): void => {
      if (
        brandId === undefined ||
        user?.id === undefined ||
        blastInFlightRef.current
      ) {
        if (user?.id === undefined) {
          showAlert(
            "Sign in again",
            "Your session is needed to create a Blast draft.",
          );
        }
        return;
      }
      blastInFlightRef.current = true;
      void createDiscountBlastDraft({
        accountId: user.id,
        brandId,
        discountId,
      })
        .then((draftId) => {
          router.push(
            `/(tabs)/marketing/campaigns/compose?draft=${draftId}` as never,
          );
        })
        .catch((error: unknown) => {
          showAlert(
            "Couldn't create the Blast",
            error instanceof Error ? error.message : "Try again in a moment.",
          );
        })
        .finally(() => {
          blastInFlightRef.current = false;
        });
    },
    [brandId, router, user?.id],
  );
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      {/* #4420 — the shared pushed-screen bar (centred title on phones). */}
      <View style={styles.header}>
        <TopBar
          leftKind="back"
          title="Discounts"
          onBack={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/account" as never)
          }
          rightSlot={<View />}
        />
      </View>
      {brandId ? (
        <Suspense fallback={null}>
          <LazyDiscountList
            brandId={brandId}
            rank={rank}
            currencyCode={
              brand?.pricingCurrency ?? brand?.defaultCurrency ?? null
            }
            onOpenReport={() =>
              router.push(`/brand/${brandId}/discounts/report` as never)
            }
            onOpenRoute={(route) => router.push(route as never)}
            onShareBlast={shareInBlast}
          />
        </Suspense>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  header: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
});
