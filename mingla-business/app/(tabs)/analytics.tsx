import React, { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../src/hooks/useCurrentBrandRole";
import {
  useCurrentBrandHasHydrated,
  useCurrentBrandId,
} from "../../src/store/currentBrandStore";
import {
  sanitizeBusinessAnalyticsEntryPoint,
} from "../../src/analytics/businessAnalyticsEvents";
import { BrandAnalyticsScreen } from "../../src/components/analytics/BrandAnalyticsScreen";
import { SafeScreen } from "../../src/components/ui/SafeScreen";

export default function AnalyticsRoute(): React.ReactElement | null {
  const router = useRouter();
  const params = useLocalSearchParams<{ entry?: string | string[] }>();
  const currentBrandId = useCurrentBrandId();
  const hasCurrentBrandHydrated = useCurrentBrandHasHydrated();
  const brand = useCurrentBrand();
  const role = useCurrentBrandRole(brand?.id ?? null);

  useEffect(() => {
    if (hasCurrentBrandHydrated && currentBrandId === null) {
      router.replace("/(tabs)/home" as never);
    }
  }, [currentBrandId, hasCurrentBrandHydrated, router]);

  if (
    !hasCurrentBrandHydrated ||
    currentBrandId === null ||
    brand === null
  ) {
    return null;
  }

  const back = (): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/home" as never);
  };

  return (
    <SafeScreen>
      <BrandAnalyticsScreen
        brand={brand}
        rank={role.rank}
        roleLoading={role.isLoading}
        entryPoint={sanitizeBusinessAnalyticsEntryPoint(params.entry)}
        onBack={back}
        onBackToHome={() => router.replace("/(tabs)/home" as never)}
      />
    </SafeScreen>
  );
}
