import React, { Suspense } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../../src/components/ui/Icon";
import {
  canvas,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useBrand } from "../../../src/hooks/useBrands";
import { useAuth } from "../../../src/context/AuthContext";
import { createDiscountBlastDraft } from "../../../src/services/discountBlastService";

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
          Alert.alert(
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
          Alert.alert(
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
      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/account" as never)
          }
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Icon name="chevL" size={22} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.title}>Discounts</Text>
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
  page: { flex: 1, backgroundColor: canvas.profile },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
});
