import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandPayoutDetailView } from "../../../../src/components/brand/BrandPayoutDetailView";
import { BrandPaymentsPermissionGate } from "../../../../src/components/brand/BrandPaymentsPermissionGate";
import { canvas } from "../../../../src/constants/designSystem";

const param = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

export default function BrandPayoutDetailRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[]; releaseId: string | string[] }>();
  const brandId = param(params.id);
  const releaseId = param(params.releaseId);
  const back = (): void => router.canGoBack() ? router.back() : router.replace(`/brand/${brandId}/payments` as never);
  if (brandId === null || releaseId === null) return <View />;
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
      <BrandPaymentsPermissionGate brandId={brandId} title="Payout" onBack={back} mode="view">
        <BrandPayoutDetailView
          brandId={brandId}
          releaseId={releaseId}
          onBack={back}
          onOpenSale={(eventId, orderId) => router.push(`/event/${eventId}/orders/${orderId}` as never)}
          onOpenBank={() => router.push(`/brand/${brandId}/payments/onboard` as never)}
          onOpenVerification={() => router.push(`/brand/${brandId}/payments/onboard` as never)}
          onContactSupport={() => router.push("/account/support?tab=support" as never)}
        />
      </BrandPaymentsPermissionGate>
    </View>
  );
}
